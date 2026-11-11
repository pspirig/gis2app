let map;
let appState = {
    markers: null,    
    reports: null,    
    track: null,      
    pastTracks: null, // NEU: Ebene für vergangene Wege
    latLng: null,
    radius: null,
    accuracy: null,

    // Wegaufzeichnung
    tracking: false,
    trackPoints: [],  
    trackGaps: [],    
    currentSeg: 0,    
    pendingGap: null, 
    lastTick: null,   
    hiddenAt: null,   
    trackStart: null,
    timerInterval: null,
    wakeLock: null,

    // NEU: Auto-Stop Tracking
    idleAnchor: null, 
    autoStopWarned: false,

    heading: null,
    hasCentered: false,
    user: null,

    // NEU: Pending Reports
    pendingReports: {} 
};

function drawMarkers() {
    if (map && !map.hasLayer(appState.markers)) return;
    if (map && appState.markers && appState.latLng && appState.radius) {
        appState.markers.clearLayers();
        let circle = L.circle(appState.latLng, { radius: appState.radius, stroke: false, fillColor: '#3b7ddd', fillOpacity: 0.15 });
        appState.markers.addLayer(circle);
        let dot = L.circleMarker(appState.latLng, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#3b7ddd', fillOpacity: 1, className: 'location-dot' });
        appState.markers.addLayer(dot);

        if (appState.heading !== null) {
            let radius = appState.radius / 111320;
            let startPointLat = appState.latLng.lat - radius * Math.cos(appState.heading);
            let startPointLng = appState.latLng.lng - radius * Math.sin(appState.heading);
            let endPointLat = appState.latLng.lat - radius * 3 * Math.cos(appState.heading);
            let endPointLng = appState.latLng.lng - radius * 3 * Math.sin(appState.heading);
            appState.markers.addLayer(L.polyline([[startPointLat, startPointLng], [endPointLat, endPointLng]], {color: '#3b7ddd'}));
        }
    }
}

function geoSuccess(position) {
    appState.latLng = L.latLng(position.coords.latitude, position.coords.longitude);
    appState.accuracy = position.coords.accuracy;
    appState.radius = position.coords.accuracy / 2;
    drawMarkers();
    $("#error-messages").hide();

    if (appState.tracking) {
        addTrackPoint(appState.latLng, appState.accuracy, position.timestamp);
    }

    if (map && !appState.hasCentered) {
        map.setView(appState.latLng, 17);
        appState.hasCentered = true;
    }
}

function geoError(error) {
    let texts = { 1: "Standortzugriff verweigert.", 2: "Standort momentan nicht verfügbar.", 3: "Standortabfrage dauert zu lange." };
    $("#error-messages").text(texts[error.code] || ("Standortfehler: " + error.message)).show();
}

let geoOptions = { enableHighAccuracy: true, maximumAge: 15000, timeout: 12000 };

function onload() {
    if ("geolocation" in navigator) navigator.geolocation.watchPosition(geoSuccess, geoError, geoOptions);
    if (window.DeviceOrientationEvent) window.addEventListener('deviceorientation', e => { appState.heading = e.alpha * (Math.PI / 180); drawMarkers(); });

    map = L.map('map', { zoomControl: false }).setView([47.376750, 8.540721], 16);
    map.addControl(new LocateControl());

    L.control.zoom({ position: 'topright' }).addTo(map);
    appState.markers = L.layerGroup();
    appState.reports = L.layerGroup();
    appState.track = L.layerGroup();
    appState.pastTracks = L.layerGroup(); // NEU

    L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg', { maxZoom: 19 }).addTo(map);
    
    map.addLayer(appState.pastTracks);
    map.addLayer(appState.track);
    map.addLayer(appState.reports);
    map.addLayer(appState.markers);

    map.on("click", () => setSheetOpen(false));

    // ------- Fenster «Meldung erfassen» -------
    $("#fillInBtn").on("click", initNewReport);
    $("#closeModalBtn").on("click", closeModal); // Schliessen verwirft die Meldung NICHT (bleibt weiss)
    $("#fillInForm").on("submit", e => { e.preventDefault(); saveModalReport(); });

    initOptionsSheet();
    initTrackBar();
    initOnboarding();
}

// ------- NEU: Später erfassen (leere Flagge) -------
const flagIconFull = L.divIcon({ className: 'report-flag', html: '<i class="fa-solid fa-flag"></i>', iconSize: [24,24], iconAnchor: [5,22], popupAnchor: [6,-22] });
const flagIconEmpty = L.divIcon({ className: 'report-flag-empty', html: '<i class="fa-regular fa-flag"></i>', iconSize: [24,24], iconAnchor: [5,22], popupAnchor: [6,-22] });

function initNewReport() {
    if (!appState.latLng) return showDialog({ title: "Standort fehlt", text: "Dein Standort ist noch nicht bekannt." });
    
    setSheetOpen(false);
    
    // Leere Meldung sofort anlegen
    let rId = Date.now().toString();
    appState.pendingReports[rId] = {
        id: rId, lat: appState.latLng.lat, lng: appState.latLng.lng, time: new Date().toISOString(),
        isFilled: false, marker: null
    };

    // Leeren Marker zeichnen
    let marker = L.marker([appState.latLng.lat, appState.latLng.lng], { icon: flagIconEmpty }).addTo(appState.reports);
    appState.pendingReports[rId].marker = marker;
    
    // Marker-Klick öffnet Modal wieder
    marker.on('click', () => openModalForReport(rId));

    openModalForReport(rId);
}

function openModalForReport(rId) {
    let rep = appState.pendingReports[rId];
    if (!rep) return;
    
    $("#fillInForm").trigger("reset");
    $("#fillInForm").data("report-id", rId);
    $("#poiModal").removeClass("hidden");
}

function closeModal() {
    $("#poiModal").addClass("hidden");
    showToast("Meldung auf der Karte gemerkt. Du kannst sie später ausfüllen.");
}

function saveModalReport() {
    let rId = $("#fillInForm").data("report-id");
    let rep = appState.pendingReports[rId];
    if (!rep) return;

    let safety = $("#safety").val();
    let categories = $("input[name='category']:checked").map(function(){ return this.value; }).get();
    let remark = $("#remark").val().trim();

    // Kategorien nicht zwingend bei Speicherung durch Formular
    rep.safety = safety;
    rep.categories = categories;
    rep.remark = remark;
    rep.isFilled = true;

    // Marker voll machen und Popup binden
    rep.marker.setIcon(flagIconFull);
    rep.marker.off('click'); 
    
    let popup = `<b>Sicherheitsgefühl: ${escapeXml(safety)}</b><br>` + escapeXml(categories.join(", ")) + (remark ? `<br><i>${escapeXml(remark)}</i>` : "");
    rep.marker.bindPopup(popup);

    // In DB schreiben
    sendReportToDB(rep);

    delete appState.pendingReports[rId];
    $("#poiModal").addClass("hidden");
    showToast("Meldung vollständig erfasst!");
}

function sendReportToDB(report) {
    let finalReport = {
        userId: appState.user ? appState.user.user_id : null,
        time: report.time, safety: report.safety || 'unbekannt', categories: report.categories || [],
        remark: report.remark || '', lat: report.lat, lng: report.lng
    };
    dbInsertReport(finalReport).catch(e => console.error(e));
}

// ------- Weg aufzeichnen -------
const MIN_POINT_DISTANCE = 3;
const MAX_ACCURACY = 50;
const GAP_SECONDS = 30;
const STORAGE_KEY = "safesteps_track";
const AUTOSTOP_DIST = 30; // Meter Radius
const AUTOSTOP_TIME = 30 * 60 * 1000; // 30 Minuten
const AUTOWARN_TIME = 25 * 60 * 1000; // 25 Minuten

function initTrackBar() {
    $("#trackBtn").on("click", () => appState.tracking ? attemptStopTracking() : startTracking());
    $("#discardBtn").on("click", discardTracking);

    document.addEventListener("visibilitychange", () => {
        if (!appState.tracking) return;
        if (document.visibilityState === "hidden") appState.hiddenAt = Date.now();
        else {
            if (appState.hiddenAt) { noteGap(appState.hiddenAt, Date.now()); appState.hiddenAt = null; }
            requestWakeLock();
        }
    });
    window.addEventListener("beforeunload", e => { if (appState.tracking) { saveTrack(); e.preventDefault(); e.returnValue = ""; } });
    restoreTrack();
}

function startTracking() {
    appState.tracking = true; appState.trackPoints = []; appState.trackGaps = [];
    appState.currentSeg = 0; appState.pendingGap = null; appState.hiddenAt = null;
    appState.trackStart = Date.now(); appState.idleAnchor = null; appState.autoStopWarned = false;

    if (appState.latLng) addTrackPoint(appState.latLng, appState.accuracy, Date.now());
    drawTrack(); saveTrack(); startTrackingUi();
}

function startTrackingUi() {
    appState.lastTick = Date.now();
    updateTimer();
    clearInterval(appState.timerInterval);
    appState.timerInterval = setInterval(updateTimer, 1000);
    setSheetOpen(false); setTrackUi(true); requestWakeLock();
}

// NEU: Check Pending Reports before stopping
async function attemptStopTracking() {
    let pendingCount = Object.keys(appState.pendingReports).length;
    if (pendingCount > 0) {
        let ok = await showDialog({ 
            title: "Meldungen offen", 
            text: `Du hast noch ${pendingCount} unbearbeitete Meldung(en). Möchtest du den Weg trotzdem abschliessen? (Die leeren Orte werden gespeichert)`,
            ok: "Abschliessen", cancel: "Weiter aufzeichnen"
        });
        if (!ok) return;
        
        // Speichere leere Meldungen ab
        for (let rId in appState.pendingReports) {
            let r = appState.pendingReports[rId];
            r.marker.setIcon(flagIconFull);
            r.marker.off('click');
            sendReportToDB(r);
        }
        appState.pendingReports = {};
    }
    stopTracking();
}

function stopTracking() {
    appState.tracking = false; clearInterval(appState.timerInterval); releaseWakeLock();
    setTrackUi(false); clearSavedTrack();

    let points = appState.trackPoints;
    if (points.length < 2) return showDialog({ title: "Kein Weg", text: "Es wurden zu wenige Punkte aufgezeichnet." });

    let distance = 0;
    for (let i = 1; i < points.length; i++) {
        if (points[i].seg === points[i - 1].seg) distance += map.distance([points[i - 1].lat, points[i - 1].lng], [points[i].lat, points[i].lng]);
    }

    showDialog({ title: "Weg beendet", text: "Dauer: " + $("#timer").text() + "\nDistanz: " + Math.round(distance) + " m\nPunkte: " + points.length });
    
    dbInsertTrack({
        userId: appState.user ? appState.user.user_id : null,
        startTime: new Date(appState.trackStart).toISOString(),
        endTime: new Date().toISOString(), lengthM: Math.round(distance), segments: groupBySegment(points)
    }).catch(e => console.error(e));
}

// NEU: Weg verwerfen
async function discardTracking() {
    let ok = await showDialog({ title: "Aufzeichnung verwerfen?", text: "Dieser Weg wird gelöscht und nicht gespeichert.", ok: "Verwerfen", cancel: "Abbrechen" });
    if (!ok) return;

    appState.tracking = false; clearInterval(appState.timerInterval); releaseWakeLock();
    setTrackUi(false); clearSavedTrack(); appState.track.clearLayers();
    $("#timer").text("00:00:00");
    showToast("Weg verworfen.");
}

function groupBySegment(points) {
    let segments = [];
    points.forEach(p => { if (!segments[p.seg]) segments[p.seg] = []; segments[p.seg].push({ lat: p.lat, lng: p.lng }); });
    return segments.filter(Boolean);
}

function noteGap(from, to) {
    if (to - from < GAP_SECONDS * 1000) return;
    if (appState.pendingGap) { appState.pendingGap.from = Math.min(appState.pendingGap.from, from); appState.pendingGap.to = Math.max(appState.pendingGap.to, to); } 
    else { appState.pendingGap = { from: from, to: to }; showToast("Aufzeichnung war unterbrochen.", 5000); }
}

function addTrackPoint(latLng, accuracy, time) {
    if (accuracy > MAX_ACCURACY) return;
    let points = appState.trackPoints;

    // NEU: Auto-Stop Logik (Anker aktualisieren)
    if (!appState.idleAnchor || map.distance([appState.idleAnchor.lat, appState.idleAnchor.lng], latLng) > AUTOSTOP_DIST) {
        appState.idleAnchor = { lat: latLng.lat, lng: latLng.lng, time: Date.now() };
        appState.autoStopWarned = false; // Reset Warnung
    }

    if (appState.pendingGap) {
        if (points.length > 0) { appState.currentSeg++; appState.trackGaps.push(appState.pendingGap); }
        appState.pendingGap = null;
    } else if (points.length > 0) {
        if (map.distance([points[points.length - 1].lat, points[points.length - 1].lng], latLng) < MIN_POINT_DISTANCE) return;
    }

    points.push({ lat: latLng.lat, lng: latLng.lng, time: time, seg: appState.currentSeg });
    drawTrack(); saveTrack();
}

function drawTrack() {
    appState.track.clearLayers();
    let segments = groupBySegment(appState.trackPoints);
    segments.forEach((seg, i) => {
        if (i > 0) L.polyline([segments[i-1][segments[i-1].length - 1], seg[0]], { color: '#8a93a8', weight: 3, dashArray: '4 8' }).addTo(appState.track);
        L.polyline(seg, { color: '#3b7ddd', weight: 5, opacity: 0.9 }).addTo(appState.track);
    });
}

function updateTimer() {
    let now = Date.now();
    if (appState.lastTick) noteGap(appState.lastTick, now);
    appState.lastTick = now;

    // NEU: Auto-Stop Überprüfung
    if (appState.idleAnchor) {
        let idleTime = now - appState.idleAnchor.time;
        if (idleTime >= AUTOSTOP_TIME) {
            showDialog({ title: "Automatisch gestoppt", text: "Du warst länger als 30 Minuten am selben Ort. Die Aufzeichnung wurde beendet." });
            attemptStopTracking();
            return;
        } else if (idleTime >= AUTOWARN_TIME && !appState.autoStopWarned) {
            let leftMin = Math.ceil((AUTOSTOP_TIME - idleTime) / 60000);
            showToast(`Du bist seit 25 Min am gleichen Ort. Stopp in ${leftMin} Minuten.`, 8000);
            appState.autoStopWarned = true;
        }
    }

    let seconds = Math.floor((now - appState.trackStart) / 1000);
    $("#timer").text([Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map(n => String(n).padStart(2, "0")).join(":"));
}

function setTrackUi(active) {
    $("#trackBar").toggleClass("active", active);
    $("#trackLabel").text(active ? "Weg beenden:" : "Weg starten:");
    $("#trackBtn").text(active ? "Stop" : "Los");
    $("#timer").toggleClass("hidden", !active);
    $("#discardBtn").toggleClass("hidden", !active); // Mülleimer anzeigen/verstecken
}

// Storage Functions
function saveTrack() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ trackStart: appState.trackStart, points: appState.trackPoints, gaps: appState.trackGaps, currentSeg: appState.currentSeg, savedAt: Date.now() })); } catch (err) {} }
function clearSavedTrack() { try { localStorage.removeItem(STORAGE_KEY); } catch (err) {} }
async function restoreTrack() {
    let saved; try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (err) { return; }
    if (!saved || !saved.trackStart) return;
    if (!(await showDialog({ title: "Weg fortsetzen?", text: "Es gibt eine unterbrochene Aufzeichnung.", ok: "Fortsetzen", cancel: "Verwerfen" }))) return clearSavedTrack();
    
    appState.tracking = true; appState.trackStart = saved.trackStart; appState.trackPoints = saved.points || [];
    appState.trackGaps = saved.gaps || []; appState.currentSeg = saved.currentSeg || 0;
    noteGap((appState.trackPoints.length > 0 ? appState.trackPoints[appState.trackPoints.length - 1].time : saved.savedAt), Date.now());
    drawTrack(); startTrackingUi();
}

function showDialog(options) {
    return new Promise(resolve => {
        $("#dialogTitle").text(options.title || ""); $("#dialogText").text(options.text || ""); $("#dialogOk").text(options.ok || "OK");
        if (options.cancel) $("#dialogCancel").text(options.cancel).show(); else $("#dialogCancel").hide();
        $("#dialog").removeClass("hidden"); $("#dialogOk").trigger("focus");
        let close = res => { $("#dialog").addClass("hidden"); $("#dialogOk, #dialogCancel").off("click"); resolve(res); };
        $("#dialogOk").on("click", () => close(true)); $("#dialogCancel").on("click", () => close(false));
    });
}

let toastTimeout = null;
function showToast(text, ms) {
    $("#toast").text(text).addClass("visible"); clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => $("#toast").removeClass("visible"), ms || 4000);
}

async function requestWakeLock() { if ("wakeLock" in navigator) try { appState.wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {} }
function releaseWakeLock() { if (appState.wakeLock) { appState.wakeLock.release(); appState.wakeLock = null; } }

// ------- Onboarding / Profil -------
const PROFILE_KEY = "safesteps_user";

function initOnboarding() {
    $("#onboardingForm").on("submit", e => { e.preventDefault(); submitOnboarding(); });
    $("#closeOnboardingBtn").on("click", () => $("#onboarding").addClass("hidden"));
    $("#editProfileBtn").on("click", () => { setSheetOpen(false); openOnboarding(true); });
    appState.user = loadProfile();
    
    if (!appState.user) openOnboarding(false);
    else updateUsernameDisplay(); // Username Banner aktualisieren
}

function openOnboarding(editMode) {
    let form = $("#onboardingForm"); form.trigger("reset"); form.data("editMode", editMode);
    if (appState.user) {
        $("#username").val(appState.user.username);
        $("#gender").val(appState.user.gender);
        $("#ageGroup").val(appState.user.age_group);
        $("input[name='familiarity'][value='" + appState.user.familiarity + "']").prop("checked", true);
        $("#consent").prop("checked", appState.user.consent === true);
    }
    $("#onboardingTitle").text(editMode ? "Meine Angaben" : "Willkommen bei Safe Steps");
    $("#onboardingSubmit").text(editMode ? "Speichern" : "Starten");
    $("#closeOnboardingBtn").toggle(editMode); $("#onboarding").removeClass("hidden");
}

function submitOnboarding() {
    let username = $("#username").val().trim();
    let gender = $("#gender").val();
    let ageGroup = $("#ageGroup").val();
    let familiarity = $("input[name='familiarity']:checked").val();
    let consent = $("#consent").prop("checked");

    if (!username || !gender || !ageGroup || familiarity === undefined) return showDialog({ title: "Angaben fehlen", text: "Bitte beantworte alle Fragen." });
    if (!consent) return showDialog({ title: "Einwilligung fehlt", text: "Ohne dein Einverständnis können wir keine Daten speichern." });

    let editMode = $("#onboardingForm").data("editMode");
    appState.user = {
        user_id: appState.user ? appState.user.user_id : null,
        username: username, gender: gender, age_group: ageGroup, familiarity: familiarity === "true", consent: true,
        created_at: appState.user ? appState.user.created_at : new Date().toISOString()
    };
    saveProfile(appState.user);
    updateUsernameDisplay();

    if (!editMode) dbInsertUser(appState.user).then(r => { if (r.id !== null) { appState.user.user_id = r.id; saveProfile(appState.user); } }).catch(e => console.error(e));
    $("#onboarding").addClass("hidden"); showToast(editMode ? "Angaben gespeichert." : "Danke! Du kannst jetzt loslegen.");
}

function updateUsernameDisplay() {
    if (appState.user && appState.user.username) {
        $("#topUsername").html('<i class="fa-solid fa-user"></i> ' + escapeXml(appState.user.username)).removeClass("hidden");
    }
}

function loadProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)); } catch (e) { return null; } }
function saveProfile(user) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(user)); } catch (e) {} }

// ------- Panel Optionen -------
function initOptionsSheet() {
    $("#toggleReports").prop("checked", true); $("#toggleLocation").prop("checked", true); $("#togglePastTracks").prop("checked", true);
    showLayer(appState.reports, true); showLayer(appState.markers, true); showLayer(appState.pastTracks, true);

    $("#sheetHandle").on("click", () => setSheetOpen(!$("#optionsSheet").hasClass("open")));
    let startY = null;
    $("#sheetHandle").on("touchstart", e => startY = e.originalEvent.touches[0].clientY);
    $("#sheetHandle").on("touchend", e => { if (startY === null) return; let dY = e.originalEvent.changedTouches[0].clientY - startY; if (dY < -30) setSheetOpen(true); if (dY > 30) setSheetOpen(false); startY = null; });

    $("#toggleReports").on("change", function () { showLayer(appState.reports, this.checked); });
    $("#togglePastTracks").on("change", function () { showLayer(appState.pastTracks, this.checked); }); // NEU
    $("#toggleLocation").on("change", function () { showLayer(appState.markers, this.checked); if (this.checked) drawMarkers(); });
    // Info-Knopf Klick-Logik
    $("#infoBtn").on("click", function() {
        setSheetOpen(false);
        $("#infoModal").removeClass("hidden");
    });
    
    $("#closeInfoBtn").on("click", function() {
        $("#infoModal").addClass("hidden");
    });
}

function setSheetOpen(open) { $("#optionsSheet").toggleClass("open", open); $("#sheetHandle").attr("aria-expanded", open); }
function showLayer(layer, visible) { visible ? map.addLayer(layer) : map.removeLayer(layer); }
function escapeXml(text) { return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
// ------- Standort-Knopf (oben rechts) -------

function goToMyLocation() {
    if (appState.latLng) {
        map.flyTo(appState.latLng, 17);
    } else {
        showToast("Dein Standort ist noch nicht bekannt.");
    }
}

const LocateControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
        let btn = L.DomUtil.create('button', 'locate-btn');
        btn.type = 'button';
        btn.title = 'Zu meinem Standort';
        btn.innerHTML = '<i class="fa-solid fa-location-arrow"></i>';
        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.on(btn, 'click', goToMyLocation);
        return btn;
    }
});