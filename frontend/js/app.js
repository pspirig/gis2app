let map;
let appState = {
    markers: null,    // Ebene mit eigenem Standort (Punkt, Kreis, Blickrichtung)
    reports: null,    // Ebene mit Meldungen (rote Fahnen)
    track: null,      // Ebene mit dem aufgezeichneten Weg (blaue Linie)
    latLng: null,
    radius: null,
    accuracy: null,

    // Wegaufzeichnung
    tracking: false,
    trackPoints: [],  // [{lat, lng, time, seg}, ...] – seg = Nummer des Teilstücks
    trackGaps: [],    // [{from, to}, ...] – Unterbrüche (Zeit in ms)
    currentSeg: 0,    // aktuelles Teilstück (wird nach jeder Lücke erhöht)
    pendingGap: null, // erkannte Lücke, die beim nächsten Punkt verbucht wird
    lastTick: null,   // letzter «Herzschlag» des Timers → erkennt eingefrorene Seite
    hiddenAt: null,   // wann die App in den Hintergrund ging
    trackStart: null,
    timerInterval: null,
    wakeLock: null,

    heading: null,
    name: null,
    hasCentered: false,

    user: null        // Angaben vom Start-Bildschirm {user_id, gender, age_group, familiarity, ...}
};

/**
 * Draws the markers on the map.
 */
function drawMarkers() {
    // Standort ausgeblendet («Standort anzeigen» aus) → nichts zeichnen
    if (map && !map.hasLayer(appState.markers)) {
        return;
    }

    if (map && appState.markers && appState.latLng && appState.radius) {
        appState.markers.clearLayers();

        // Genauigkeitskreis: dezent im Hintergrund
        let circle = L.circle(appState.latLng, {
            radius: appState.radius,
            stroke: false,
            fillColor: '#3b7ddd',
            fillOpacity: 0.15
        });
        appState.markers.addLayer(circle);

        // Blauer Punkt mit weissem Rand (wie im Entwurf)
        let dot = L.circleMarker(appState.latLng, {
            radius: 8,
            color: '#ffffff',
            weight: 3,
            fillColor: '#3b7ddd',
            fillOpacity: 1,
            className: 'location-dot'
        });
        appState.markers.addLayer(dot);

        // Blickrichtung (optional – diesen Block löschen, falls nicht gewünscht)
        if (appState.heading !== null) {
            // Radius von Metern in Grad umrechnen (1° Breite ≈ 111 320 m)
            let radius = appState.radius / 111320;
            let startPointLat = appState.latLng.lat - radius * Math.cos(appState.heading);
            let startPointLng = appState.latLng.lng - radius * Math.sin(appState.heading);
            let endPointLat = appState.latLng.lat - radius * 3 * Math.cos(appState.heading);
            let endPointLng = appState.latLng.lng - radius * 3 * Math.sin(appState.heading);

            let latLngsHeading = [
                [startPointLat, startPointLng],
                [endPointLat, endPointLng]
            ];
            appState.markers.addLayer(L.polyline(latLngsHeading, {color: '#3b7ddd'}));
        }
    }
}

/**
 * Function to be called whenever a new position is available.
 * @param position The new position.
 */
function geoSuccess(position) {
    let lat = position.coords.latitude;
    let lng = position.coords.longitude;
    appState.latLng = L.latLng(lat, lng);
    appState.accuracy = position.coords.accuracy;
    appState.radius = position.coords.accuracy / 2;
    drawMarkers();

    // Standort funktioniert (wieder) → Fehlermeldung ausblenden
    $("#error-messages").hide();

    // Während einer Aufzeichnung: Punkt zum Weg hinzufügen
    if (appState.tracking) {
        addTrackPoint(appState.latLng, appState.accuracy, position.timestamp);
    }

    // Nur beim allerersten Standort automatisch hinspringen
    if (map && !appState.hasCentered) {
        map.setView(appState.latLng, 17);
        appState.hasCentered = true;
    }
}

/**
 * Function to be called if there is an error raised by the Geolocation API.
 * @param error Describing the error in more detail.
 */
function geoError(error) {
    // Nur die neueste Meldung zeigen (nicht anhängen, sonst wächst der Balken endlos)
    let texts = {
        1: "Standortzugriff verweigert – bitte in den Browser-Einstellungen erlauben.",
        2: "Standort momentan nicht verfügbar (schwaches GPS-Signal?).",
        3: "Standortabfrage dauert zu lange."
    };
    $("#error-messages").text(texts[error.code] || ("Standortfehler: " + error.message)).show();
}

let geoOptions = {
    enableHighAccuracy: true,
    maximumAge: 15000,  // The maximum age of a cached location (15 seconds).
    timeout: 12000   // A maximum of 12 seconds before timeout.
};

/**
 * The onload function is called when the HTML has finished loading.
 */
function onload() {
    let errMsg = $("#error-messages");

    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(geoSuccess, geoError, geoOptions);
    } else {
        errMsg.text(errMsg.text() + "Geolocation is leider auf diesem Gerät nicht verfügbar. ");
        errMsg.show();
    }

    if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', function (eventData) {
            appState.heading = eventData.alpha * (Math.PI / 180);
            drawMarkers();
        }, false);
    } else {
        errMsg.text(errMsg.text() + "DeviceOrientation ist leider nicht verfügbar. ");
        errMsg.show();
    }

    // Adding map layer: graue Landeskarte von swisstopo
    map = L.map('map', { zoomControl: false }).setView([47.376750, 8.540721], 16);

    // Knopf «zu meinem Standort» oben rechts
    map.addControl(new LocateControl());

    // Zoom-Knöpfe oben rechts (erscheinen unter dem Standort-Knopf)
    L.control.zoom({ position: 'topright' }).addTo(map);
    appState.markers = L.layerGroup();
    appState.reports = L.layerGroup();
    appState.track = L.layerGroup();
    L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.swisstopo.admin.ch">swisstopo</a>'
    }).addTo(map);
    map.addLayer(appState.track);   // zuunterst: Linie liegt unter Fahnen und Standortpunkt
    map.addLayer(appState.reports);
    map.addLayer(appState.markers);

    // Panel schliessen, wenn man auf die Karte tippt
    map.on("click", function () {
        setSheetOpen(false);
    });


    // ------- Fenster «Meldung erfassen» -------

    // Öffnen
    $("#fillInBtn").on("click", openModal);

    // Schliessen über das X
    $("#closeModalBtn").on("click", closeModal);

    // Schliessen per Klick auf den dunklen Hintergrund
    $("#poiModal").on("click", function (event) {
        if (event.target === this) {
            closeModal();
        }
    });

    // Absenden
    $("#fillInForm").on("submit", function (event) {
        event.preventDefault();
        formSubmit();
    });


    // ------- Panel «Anzeigeoptionen» -------
    initOptionsSheet();

    // ------- Leiste «Weg starten / beenden» -------
    initTrackBar();

    // ------- Start-Bildschirm (Angaben + Datenschutz) -------
    initOnboarding();
}

function openModal() {
    setSheetOpen(false);
    $("#fillInForm").trigger("reset");
    $("#poiModal").removeClass("hidden");
}

function closeModal() {
    $("#poiModal").addClass("hidden");
    $("#fillInForm").trigger("reset");
}

// Liest das Formular aus und schickt die Meldung an die Datenbank
function formSubmit() {
    if (!appState.latLng) {
        showDialog({ title: "Standort fehlt", text: "Dein Standort ist noch nicht bekannt. Bitte kurz warten." });
        return;
    }

    let safety = $("#safety").val();
    let categories = $("input[name='category']:checked")
        .map(function () { return this.value; })
        .get();
    let remark = $("#remark").val().trim();

    if (categories.length === 0) {
        showDialog({ title: "Kategorie fehlt", text: "Bitte mindestens eine Kategorie auswählen." });
        return;
    }

    let report = {
        userId: appState.user ? appState.user.user_id : null,
        time: new Date().toISOString(),
        safety: safety,
        categories: categories,
        remark: remark,
        lat: appState.latLng.lat,
        lng: appState.latLng.lng
    };
    console.log("Neue Meldung:", report);

    // In die Datenbank schreiben (wfs.js)
    dbInsertReport(report)
        .then(function (result) {
            showToast(result.pending
                ? "Meldung lokal gespeichert (Datenbank noch nicht verbunden)."
                : "Meldung gespeichert – danke!");
        })
        .catch(function (err) {
            showDialog({ title: "Fehler", text: "Die Meldung konnte nicht gespeichert werden.\n\n" + err.message });
        });

    // Meldung sofort als Fahne auf der Karte zeigen
    addReportMarker(report);

    closeModal();
}

// ------- Meldungen als rote Fahnen -------

const flagIcon = L.divIcon({
    className: 'report-flag',
    html: '<i class="fa-solid fa-flag"></i>',
    iconSize: [24, 24],
    iconAnchor: [5, 22],   // Fuss der Fahnenstange steht auf dem Punkt
    popupAnchor: [6, -22]
});

// Setzt eine Fahne für eine Meldung auf die Karte (Ebene «Vergangene Meldungen»)
// TODO: Später alle Meldungen per WFS GetFeature aus der Datenbank laden
//       und für jede Meldung diese Funktion aufrufen.
function addReportMarker(report) {
    let popup = "<b>Sicherheitsgefühl: " + escapeXml(report.safety) + "</b><br>"
        + escapeXml(report.categories.join(", "))
        + (report.remark ? "<br><i>" + escapeXml(report.remark) + "</i>" : "");

    L.marker([report.lat, report.lng], { icon: flagIcon })
        .bindPopup(popup)
        .addTo(appState.reports);
}

// ------- Weg aufzeichnen (Trajektorie) -------

const MIN_POINT_DISTANCE = 3;   // Meter: kleinere Bewegungen sind meist GPS-Rauschen
const MAX_ACCURACY = 50;        // Meter: ungenauere Positionen werden nicht aufgezeichnet
const GAP_SECONDS = 30;         // Sekunden: längerer Unterbruch = Lücke im Weg
const STORAGE_KEY = "safesteps_track";

function initTrackBar() {
    $("#trackBtn").on("click", function () {
        if (appState.tracking) {
            stopTracking();
        } else {
            startTracking();
        }
    });

    // App geht in den Hintergrund / kommt zurück
    document.addEventListener("visibilitychange", function () {
        if (!appState.tracking) return;

        if (document.visibilityState === "hidden") {
            appState.hiddenAt = Date.now();
        } else {
            if (appState.hiddenAt) {
                noteGap(appState.hiddenAt, Date.now());
                appState.hiddenAt = null;
            }
            requestWakeLock(); // Bildschirmsperre wird im Hintergrund aufgehoben → neu anfordern
        }
    });

    // Warnung, falls man die Seite während der Aufzeichnung schliesst oder neu lädt
    window.addEventListener("beforeunload", function (event) {
        if (appState.tracking) {
            saveTrack();
            event.preventDefault();
            event.returnValue = "";
        }
    });

    // Gibt es eine unterbrochene Aufzeichnung vom letzten Mal?
    restoreTrack();
}

function startTracking() {
    appState.tracking = true;
    appState.trackPoints = [];
    appState.trackGaps = [];
    appState.currentSeg = 0;
    appState.pendingGap = null;
    appState.hiddenAt = null;
    appState.trackStart = Date.now();

    // Aktuellen Standort gleich als Startpunkt nehmen (falls schon bekannt)
    if (appState.latLng) {
        addTrackPoint(appState.latLng, appState.accuracy, Date.now());
    }
    drawTrack();
    saveTrack();

    startTrackingUi();
    showToast("App geöffnet lassen – bei gesperrtem Bildschirm wird der Weg nicht aufgezeichnet.", 6000);
}

// Gemeinsamer Teil von «starten» und «fortsetzen»
function startTrackingUi() {
    appState.lastTick = Date.now();
    updateTimer();
    clearInterval(appState.timerInterval);
    appState.timerInterval = setInterval(updateTimer, 1000);

    setSheetOpen(false);
    setTrackUi(true);
    requestWakeLock();
}

function stopTracking() {
    appState.tracking = false;
    clearInterval(appState.timerInterval);
    releaseWakeLock();

    let duration = $("#timer").text();
    setTrackUi(false);
    clearSavedTrack();

    let points = appState.trackPoints;
    console.log("Weg beendet:", { points: points, gaps: appState.trackGaps });

    if (points.length < 2) {
        showDialog({ title: "Kein Weg", text: "Es wurden zu wenige Punkte aufgezeichnet, um einen Weg zu speichern." });
        return;
    }

    // Distanz nur innerhalb der Teilstücke (Lücken zählen nicht)
    let distance = 0;
    for (let i = 1; i < points.length; i++) {
        if (points[i].seg === points[i - 1].seg) {
            distance += map.distance(
                [points[i - 1].lat, points[i - 1].lng],
                [points[i].lat, points[i].lng]
            );
        }
    }

    let summary = "Dauer: " + duration + "\n"
        + "Distanz: " + Math.round(distance) + " m\n"
        + "Punkte: " + points.length;

    if (appState.trackGaps.length > 0) {
        let gapMs = appState.trackGaps.reduce((sum, g) => sum + (g.to - g.from), 0);
        summary += "\nUnterbrüche: " + appState.trackGaps.length
            + " (insgesamt " + formatDuration(gapMs) + ")";
    }
    showDialog({ title: "Weg beendet", text: summary });

    // In die Datenbank schreiben (wfs.js).
    // Jedes Teilstück (seg) wird eine eigene Linie → MultiLineString.
    let track = {
        userId: appState.user ? appState.user.user_id : null,
        startTime: new Date(appState.trackStart).toISOString(),
        endTime: new Date().toISOString(),
        lengthM: Math.round(distance),
        segments: groupBySegment(points)
    };

    dbInsertTrack(track)
        .then(function (result) {
            showToast(result.pending
                ? "Weg lokal gespeichert (Datenbank noch nicht verbunden)."
                : "Weg gespeichert – danke!");
        })
        .catch(function (err) {
            showDialog({ title: "Fehler", text: "Der Weg konnte nicht gespeichert werden.\n\n" + err.message });
        });
}

// Teilt die Punkte nach Teilstück auf: [[{lat, lng}, ...], [{lat, lng}, ...]]
function groupBySegment(points) {
    let segments = [];
    points.forEach(function (p) {
        if (!segments[p.seg]) segments[p.seg] = [];
        segments[p.seg].push({ lat: p.lat, lng: p.lng });
    });
    return segments.filter(Boolean);
}

// Merkt sich eine Lücke; sie wird beim nächsten Punkt verbucht
function noteGap(from, to) {
    if (to - from < GAP_SECONDS * 1000) return;

    if (appState.pendingGap) {
        // Mehrere Unterbrüche hintereinander → zu einer Lücke zusammenfassen
        appState.pendingGap.from = Math.min(appState.pendingGap.from, from);
        appState.pendingGap.to = Math.max(appState.pendingGap.to, to);
    } else {
        appState.pendingGap = { from: from, to: to };
        showToast("Aufzeichnung war " + formatDuration(to - from) + " unterbrochen.", 5000);
    }
}

// Fügt einen Punkt zum Weg hinzu – ausser er ist zu ungenau oder zu nah am letzten
function addTrackPoint(latLng, accuracy, time) {
    if (accuracy > MAX_ACCURACY) {
        return;
    }

    let points = appState.trackPoints;

    // Gab es seit dem letzten Punkt eine Lücke? → neues Teilstück beginnen
    if (appState.pendingGap) {
        if (points.length > 0) {
            appState.currentSeg++;
            appState.trackGaps.push(appState.pendingGap);
        }
        appState.pendingGap = null;
    } else if (points.length > 0) {
        let last = points[points.length - 1];
        if (map.distance([last.lat, last.lng], latLng) < MIN_POINT_DISTANCE) {
            return;
        }
    }

    points.push({ lat: latLng.lat, lng: latLng.lng, time: time, seg: appState.currentSeg });
    drawTrack();
    saveTrack();
}

// Zeichnet den Weg neu: jedes Teilstück blau, Lücken grau gestrichelt
function drawTrack() {
    appState.track.clearLayers();
    let points = appState.trackPoints;
    if (points.length === 0) return;

    // Punkte nach Teilstück gruppieren
    let segments = [];
    points.forEach(function (p) {
        if (!segments[p.seg]) segments[p.seg] = [];
        segments[p.seg].push([p.lat, p.lng]);
    });
    segments = segments.filter(Boolean);

    segments.forEach(function (seg, i) {
        // Lücke zum vorherigen Teilstück
        if (i > 0) {
            let prev = segments[i - 1];
            L.polyline([prev[prev.length - 1], seg[0]], {
                color: '#8a93a8',
                weight: 3,
                dashArray: '4 8'
            }).addTo(appState.track);
        }
        L.polyline(seg, {
            color: '#3b7ddd',
            weight: 5,
            opacity: 0.9
        }).addTo(appState.track);
    });
}

// Zeigt die vergangene Zeit als hh:mm:ss an – und erkennt eingefrorene Seiten
function updateTimer() {
    let now = Date.now();

    // Läuft der Timer nach einer Pause erst jetzt wieder, war die Seite eingefroren
    if (appState.lastTick) {
        noteGap(appState.lastTick, now);
    }
    appState.lastTick = now;

    let seconds = Math.floor((now - appState.trackStart) / 1000);
    let h = Math.floor(seconds / 3600);
    let m = Math.floor((seconds % 3600) / 60);
    let s = seconds % 60;
    $("#timer").text([h, m, s].map(n => String(n).padStart(2, "0")).join(":"));
}

// Macht aus Millisekunden z. B. «45 s» oder «3 Min.»
function formatDuration(ms) {
    let seconds = Math.round(ms / 1000);
    if (seconds < 60) return seconds + " s";
    let minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + " Min.";
    return Math.floor(minutes / 60) + " h " + (minutes % 60) + " Min.";
}

// Schaltet die Leiste zwischen «LOS» (weiss) und «STOP» (rot) um
function setTrackUi(active) {
    $("#trackBar").toggleClass("active", active);
    $("#trackLabel").text(active ? "Weg beenden:" : "Weg starten:");
    $("#trackBtn").text(active ? "Stop" : "Los");
    $("#timer").toggleClass("hidden", !active);
}

// ------- Zwischenspeichern im Browser (localStorage) -------
// Falls der Browser die Seite im Hintergrund schliesst, geht der Weg nicht verloren.

function saveTrack() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            trackStart: appState.trackStart,
            points: appState.trackPoints,
            gaps: appState.trackGaps,
            currentSeg: appState.currentSeg,
            savedAt: Date.now()
        }));
    } catch (err) {
        console.warn("Weg konnte nicht zwischengespeichert werden:", err);
    }
}

function clearSavedTrack() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
        // egal
    }
}

async function restoreTrack() {
    let saved;
    try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (err) {
        return;
    }
    if (!saved || !saved.trackStart) return;

    let startTime = new Date(saved.trackStart).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
    let resume = await showDialog({
        title: "Weg fortsetzen?",
        text: "Es gibt eine unterbrochene Aufzeichnung (gestartet um " + startTime + ").",
        ok: "Fortsetzen",
        cancel: "Verwerfen"
    });

    if (!resume) {
        clearSavedTrack();
        return;
    }

    appState.tracking = true;
    appState.trackStart = saved.trackStart;
    appState.trackPoints = saved.points || [];
    appState.trackGaps = saved.gaps || [];
    appState.currentSeg = saved.currentSeg || 0;
    appState.pendingGap = null;

    // Die Zeit, in der die Seite zu war, ist eine Lücke
    let lastTime = appState.trackPoints.length > 0
        ? appState.trackPoints[appState.trackPoints.length - 1].time
        : saved.savedAt;
    noteGap(lastTime, Date.now());

    drawTrack();
    startTrackingUi();
}

// ------- Eigenes Dialogfenster (statt alert/confirm des Browsers) -------
// Gibt ein Promise zurück: true = OK gedrückt, false = Abbrechen.
// Beispiel:  let ja = await showDialog({ title: "...", text: "...", ok: "Ja", cancel: "Nein" });
// Ohne «cancel» erscheint nur der OK-Knopf (wie alert).

function showDialog(options) {
    return new Promise(function (resolve) {
        $("#dialogTitle").text(options.title || "");
        $("#dialogText").text(options.text || "");
        $("#dialogOk").text(options.ok || "OK");

        let cancelBtn = $("#dialogCancel");
        if (options.cancel) {
            cancelBtn.text(options.cancel).show();
        } else {
            cancelBtn.hide();
        }

        $("#dialog").removeClass("hidden");
        $("#dialogOk").trigger("focus");

        function close(result) {
            $("#dialog").addClass("hidden");
            $("#dialogOk, #dialogCancel").off("click");
            resolve(result);
        }

        $("#dialogOk").on("click", function () { close(true); });
        $("#dialogCancel").on("click", function () { close(false); });
    });
}

// ------- Kurze Hinweise unten auf der Karte -------

let toastTimeout = null;

function showToast(text, ms) {
    $("#toast").text(text).addClass("visible");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(function () {
        $("#toast").removeClass("visible");
    }, ms || 4000);
}

// ------- Bildschirm wach halten -------
// (bei gesperrtem Bildschirm liefert der Browser keine Positionen mehr)

async function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
        return;
    }
    try {
        appState.wakeLock = await navigator.wakeLock.request("screen");
    } catch (err) {
        console.warn("Bildschirm-Sperre konnte nicht verhindert werden:", err);
    }
}

function releaseWakeLock() {
    if (appState.wakeLock) {
        appState.wakeLock.release();
        appState.wakeLock = null;
    }
}

// ------- Start-Bildschirm: Angaben zur Person + Datenschutz -------
// Erscheint beim ersten Öffnen. Die Angaben werden im Browser gespeichert,
// damit man sie nicht jedes Mal neu eingeben muss.

const PROFILE_KEY = "safesteps_user";

function initOnboarding() {
    $("#onboardingForm").on("submit", function (event) {
        event.preventDefault();
        submitOnboarding();
    });

    $("#closeOnboardingBtn").on("click", closeOnboarding);

    $("#editProfileBtn").on("click", function () {
        setSheetOpen(false);
        openOnboarding(true);
    });

    appState.user = loadProfile();
    if (!appState.user) {
        openOnboarding(false); // erster Start
    }
}

// editMode = true: Angaben ändern (mit X zum Schliessen)
// editMode = false: erster Start (muss ausgefüllt werden)
function openOnboarding(editMode) {
    let form = $("#onboardingForm");
    form.trigger("reset");
    form.data("editMode", editMode);

    // Bisherige Angaben eintragen
    let user = appState.user;
    if (user) {
        $("#gender").val(user.gender);
        $("#ageGroup").val(user.age_group);
        $("input[name='familiarity'][value='" + user.familiarity + "']").prop("checked", true);
        $("#consent").prop("checked", user.consent === true);
    }

    $("#onboardingTitle").text(editMode ? "Meine Angaben" : "Willkommen bei Safe Steps");
    $("#onboardingSubmit").text(editMode ? "Speichern" : "Starten");
    $("#closeOnboardingBtn").toggle(editMode);
    $("#onboarding").removeClass("hidden");
}

function closeOnboarding() {
    $("#onboarding").addClass("hidden");
}

function submitOnboarding() {
    let gender = $("#gender").val();
    let ageGroup = $("#ageGroup").val();
    let familiarity = $("input[name='familiarity']:checked").val();
    let consent = $("#consent").prop("checked");

    if (!gender || !ageGroup || familiarity === undefined) {
        showDialog({ title: "Angaben fehlen", text: "Bitte beantworte alle Fragen. Du kannst auch «keine Angabe» wählen." });
        return;
    }
    if (!consent) {
        showDialog({ title: "Einwilligung fehlt", text: "Ohne dein Einverständnis können wir keine Daten speichern." });
        return;
    }

    let editMode = $("#onboardingForm").data("editMode");
    let oldUser = appState.user;

    appState.user = {
        user_id: oldUser ? oldUser.user_id : null, // kommt später von der Datenbank
        gender: gender,
        age_group: ageGroup,
        familiarity: familiarity === "true",
        consent: true,
        created_at: oldUser ? oldUser.created_at : new Date().toISOString()
    };
    saveProfile(appState.user);
    console.log("Angaben gespeichert:", appState.user);

    // Erster Start: User in der Datenbank anlegen (wfs.js) und die neue ID merken.
    // TODO: Beim Bearbeiten den User per WFS-T Update ändern.
    if (!editMode) {
        dbInsertUser(appState.user)
            .then(function (result) {
                if (result.id !== null) {
                    appState.user.user_id = result.id;
                    saveProfile(appState.user);
                }
            })
            .catch(function (err) {
                console.error("User konnte nicht angelegt werden:", err);
            });
    }

    closeOnboarding();
    showToast(editMode ? "Angaben gespeichert." : "Danke! Du kannst jetzt loslegen.");
}

function loadProfile() {
    try {
        return JSON.parse(localStorage.getItem(PROFILE_KEY));
    } catch (err) {
        return null;
    }
}

function saveProfile(user) {
    try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
    } catch (err) {
        console.warn("Angaben konnten nicht gespeichert werden:", err);
    }
}

// ------- Panel «Anzeigeoptionen» -------

function initOptionsSheet() {
    // Startzustand: beide Schalter an, beide Ebenen sichtbar.
    // (Manche Browser, z. B. Firefox, merken sich sonst den alten Schalterstand
    //  beim Neuladen – dann passen Schalter und Karte nicht zusammen.)
    $("#toggleReports").prop("checked", true);
    $("#toggleLocation").prop("checked", true);
    showLayer(appState.reports, true);
    showLayer(appState.markers, true);

    // Auf-/Zuklappen durch Tippen auf den Kopf
    $("#sheetHandle").on("click", function () {
        setSheetOpen(!$("#optionsSheet").hasClass("open"));
    });

    // Wischen: nach oben = öffnen, nach unten = schliessen
    let startY = null;
    $("#sheetHandle").on("touchstart", function (e) {
        startY = e.originalEvent.touches[0].clientY;
    });
    $("#sheetHandle").on("touchend", function (e) {
        if (startY === null) return;
        let deltaY = e.originalEvent.changedTouches[0].clientY - startY;
        if (deltaY < -30) setSheetOpen(true);
        if (deltaY > 30) setSheetOpen(false);
        startY = null;
    });

    // Schalter «Vergangene Meldungen»
    $("#toggleReports").on("change", function () {
        showLayer(appState.reports, this.checked);
    });

    // Schalter «Standort anzeigen»
    $("#toggleLocation").on("change", function () {
        showLayer(appState.markers, this.checked);
        if (this.checked) {
            drawMarkers(); // beim Einblenden gleich die aktuelle Position zeichnen
        }
    });
}

function setSheetOpen(open) {
    $("#optionsSheet").toggleClass("open", open);
    $("#sheetHandle").attr("aria-expanded", open);
}

// Blendet eine Ebene auf der Karte ein oder aus
function showLayer(layer, visible) {
    if (visible) {
        map.addLayer(layer);
    } else {
        map.removeLayer(layer);
    }
}

// ------- Standort-Knopf -------

// Springt zurück zum eigenen Standort
function goToMyLocation() {
    if (appState.latLng) {
        map.flyTo(appState.latLng, 17);
    } else {
        showToast("Dein Standort ist noch nicht bekannt.");
    }
}

// Eigener Leaflet-Knopf mit Pfeil
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
