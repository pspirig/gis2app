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
    hasCentered: false
};

let wfs = 'https://baug-ikg-gis-01.ethz.ch:8443/geoserver/GTA26_lab07/wfs';

/**
 * Draws the markers on the map.
 */
function drawMarkers() {
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
            let radius = circle.getBounds().getCenter().lat - circle.getBounds().getSouth();
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
        alert("Dein Standort ist noch nicht bekannt. Bitte kurz warten.");
        return;
    }

    let safety = $("#safety").val();
    let categories = $("input[name='category']:checked")
        .map(function () { return this.value; })
        .get();
    let remark = $("#remark").val().trim();

    if (categories.length === 0) {
        alert("Bitte mindestens eine Kategorie auswählen.");
        return;
    }

    let report = {
        safety: safety,
        categories: categories,
        remark: remark,
        lat: appState.latLng.lat,
        lng: appState.latLng.lng
    };
    console.log("Neue Meldung:", report);

    // VORLÄUFIG: Die Übungstabelle hat nur das Feld «name».
    // Darum schreiben wir alles zusammen hinein. Später mit eigener Tabelle → eigene Spalten.
    let name = "Sicherheit " + safety + " | " + categories.join(", ") + (remark ? " | " + remark : "");
    appState.name = name;

    insertPoint(report.lat, report.lng, name);

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
    if (!confirm("Weg wirklich beenden?")) {
        return;
    }

    appState.tracking = false;
    clearInterval(appState.timerInterval);
    releaseWakeLock();

    let duration = $("#timer").text();
    setTrackUi(false);
    clearSavedTrack();

    let points = appState.trackPoints;
    console.log("Weg beendet:", { points: points, gaps: appState.trackGaps });

    if (points.length < 2) {
        alert("Es wurden zu wenige Punkte aufgezeichnet, um einen Weg zu speichern.");
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

    let summary = "Weg beendet\n"
        + "Dauer: " + duration + "\n"
        + "Distanz: " + Math.round(distance) + " m\n"
        + "Punkte: " + points.length;

    if (appState.trackGaps.length > 0) {
        let gapMs = appState.trackGaps.reduce((sum, g) => sum + (g.to - g.from), 0);
        summary += "\nUnterbrüche: " + appState.trackGaps.length
            + " (insgesamt " + formatDuration(gapMs) + ")";
    }
    alert(summary);

    // TODO: Trajektorie in die Datenbank schreiben, sobald eure Tabelle steht.
    //       Jedes Teilstück (seg) ist eine eigene Linie → z. B. MultiLineString,
    //       oder einzelne Punkte mit Zeitstempel und Teilstück-Nummer.
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

function restoreTrack() {
    let saved;
    try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (err) {
        return;
    }
    if (!saved || !saved.trackStart) return;

    let startTime = new Date(saved.trackStart).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
    let resume = confirm("Es gibt eine unterbrochene Aufzeichnung (gestartet um " + startTime + ").\n\n"
        + "OK = fortsetzen\nAbbrechen = verwerfen");

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

// ------- Panel «Anzeigeoptionen» -------

function initOptionsSheet() {
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

// Sonderzeichen wie & < > würden das XML kaputt machen, darum ersetzen
function escapeXml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

// Inserts the point in the database
// TODO: Workspace "GTA26_lab07" und Layer "gta_u22_lab07" auf euer Projekt anpassen
function insertPoint(lat, lng, name) {
    let postData =
        '<wfs:Transaction\n'
        + '   service="WFS"\n'
        + '   version="1.0.0"\n'
        + '   xmlns:wfs="http://www.opengis.net/wfs"\n'
        + '   xmlns:gml="http://www.opengis.net/gml"\n'
        + '   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n'
        + '   xmlns:GTA26_lab07="https://www.gis.ethz.ch/GTA26_lab07">\n'
        + '   <wfs:Insert>\n'
        + '       <GTA26_lab07:gta_u22_lab07>\n'
        + '           <lon>' + lng + '</lon>\n'
        + '           <lat>' + lat + '</lat>\n'
        + '           <name>' + escapeXml(name) + '</name>\n'
        + '           <geometry>\n'
        + '               <gml:Point srsName="http://www.opengis.net/gml/srs/epsg.xml#4326">\n'
        + '                   <gml:coordinates decimal="." cs="," ts=" ">' + lng + ',' + lat + '</gml:coordinates>\n'
        + '               </gml:Point>\n'
        + '           </geometry>\n'
        + '       </GTA26_lab07:gta_u22_lab07>\n'
        + '   </wfs:Insert>\n'
        + '</wfs:Transaction>';

    $.ajax({
        type: "POST",
        url: wfs,
        dataType: "xml",
        contentType: "text/xml",
        data: postData,
        success: function (response) {
            console.log("AJAX request succeeded");

            // Check for WFS exception
            let exception = $(response).find("ServiceException");

            if (exception.length > 0) {
                let msg = exception.text();
                console.error("WFS Transaction failed:");
                console.error(msg);
                alert("WFS Error:\n" + msg);
                return;
            }

            // Check if transaction succeeded
            let successNode = response.getElementsByTagName("wfs:SUCCESS");

            if (successNode.length > 0) {
                console.log("WFS Transaction successful");
                alert("Data successfully inserted into database.");
            } else {
                console.log("Transaction response received, but success could not be verified.");
                alert("Response received from Geoserver. Please check the response details.");
            }

            console.log(new XMLSerializer().serializeToString(response));
        },
        error: function (xhr, errorThrown) {
            console.error("AJAX Error");
            console.error("HTTP Status:", xhr.status);
            console.error(errorThrown);
            alert("Connection to Geoserver failed.\n" + "HTTP Status: " + xhr.status);
        }
    });
}

// ------- Standort-Knopf -------

// Springt zurück zum eigenen Standort
function goToMyLocation() {
    if (appState.latLng) {
        map.flyTo(appState.latLng, 17);
    } else {
        alert("Dein Standort ist noch nicht bekannt.");
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