// ======= Daten in die Datenbank schreiben (GeoServer / WFS-T) =======
//
// Funktionen, die app.js aufruft:
//   dbInsertUser(user)      → Tabelle user
//   dbInsertReport(report)  → Tabelle unsafe_point
//   dbInsertTrack(track)    → Tabelle actual_track
//
// Alle geben ein Promise zurück:
//   Erfolg: { id, pending }  id = neue ID aus der Datenbank (oder null)
//                            pending = true, wenn nur im Browser zwischengespeichert
//   Fehler: Error mit einer Meldung
//
// Platzhalter-Modus (WFS_CONFIG.enabled = false, siehe config.js):
// Nichts geht an den Server. Die Daten landen im Browser (localStorage, Schlüssel
// «safesteps_pending») und in der Konsole. Anschauen in der Browser-Konsole mit:
//   getPendingData()

const PENDING_KEY = "safesteps_pending";


// ------- Öffentliche Funktionen -------

function dbInsertUser(user) {
    return insertFeature(WFS_CONFIG.layers.user, {
        gender: user.gender,
        familiarity: user.familiarity
        // TODO: age – Tabelle hat «age integer», die App erfasst eine Altersgruppe (Text)
    }, null);
}

function dbInsertReport(report) {
    return insertFeature(WFS_CONFIG.layers.report, {
        user_id: report.userId,
        timestamp: report.time,
        reason_category: report.categories.join(", ")
        // TODO: Sicherheitsgefühl (1–5) und Bemerkung – dafür fehlen noch Spalten
        // TODO: track_id – Meldung während einer Aufzeichnung dem Weg zuordnen
    }, pointGml(report.lat, report.lng));
}

function dbInsertTrack(track) {
    return insertFeature(WFS_CONFIG.layers.track, {
        user_id: track.userId,
        start_time: track.startTime,
        end_time: track.endTime,
        length: track.lengthM
    }, multiLineGml(track.segments));
}


// ------- Ablauf: Platzhalter oder echter Insert -------

function insertFeature(layer, properties, geometryGml) {
    if (!WFS_CONFIG.enabled) {
        storePending(layer, properties, geometryGml);
        return Promise.resolve({ id: null, pending: true });
    }

    let xml = buildInsertXml(layer, properties, geometryGml);
    return sendTransaction(xml).then(function (id) {
        return { id: id, pending: false };
    });
}


// ------- XML für die WFS-Transaktion bauen -------

function buildInsertXml(layer, properties, geometryGml) {
    let ws = WFS_CONFIG.workspace;
    let fields = "";

    for (let [name, value] of Object.entries(properties)) {
        // Leere Werte weglassen → in der Datenbank steht dann NULL
        if (value === null || value === undefined) continue;
        fields += "      <" + ws + ":" + name + ">" + escapeXml(value) + "</" + ws + ":" + name + ">\n";
    }

    if (geometryGml) {
        fields += "      <" + ws + ":geometry>" + geometryGml + "</" + ws + ":geometry>\n";
    }

    return '<wfs:Transaction service="WFS" version="1.0.0"\n'
        + '    xmlns:wfs="http://www.opengis.net/wfs"\n'
        + '    xmlns:gml="http://www.opengis.net/gml"\n'
        + '    xmlns:' + ws + '="' + WFS_CONFIG.namespaceUri + '">\n'
        + '  <wfs:Insert>\n'
        + '    <' + ws + ':' + layer + '>\n'
        + fields
        + '    </' + ws + ':' + layer + '>\n'
        + '  </wfs:Insert>\n'
        + '</wfs:Transaction>';
}

// Geometrien im GML-Format. Achtung: Reihenfolge ist «Länge,Breite» (x,y)!

function coordinatesGml(points) {
    let coords = points.map(function (p) { return p.lng + "," + p.lat; }).join(" ");
    return '<gml:coordinates decimal="." cs="," ts=" ">' + coords + '</gml:coordinates>';
}

function pointGml(lat, lng) {
    return '<gml:Point srsName="' + WFS_CONFIG.srsName + '">'
        + coordinatesGml([{ lat: lat, lng: lng }])
        + '</gml:Point>';
}

// Ein Weg kann Lücken haben → jedes Teilstück ist eine eigene Linie
function multiLineGml(segments) {
    let members = segments
        .filter(function (seg) { return seg.length >= 2; }) // eine Linie braucht mind. 2 Punkte
        .map(function (seg) {
            return '<gml:lineStringMember><gml:LineString>'
                + coordinatesGml(seg)
                + '</gml:LineString></gml:lineStringMember>';
        })
        .join("");

    return '<gml:MultiLineString srsName="' + WFS_CONFIG.srsName + '">' + members + '</gml:MultiLineString>';
}


// ------- An den GeoServer schicken und Antwort auswerten -------

function sendTransaction(xml) {
    return new Promise(function (resolve, reject) {
        $.ajax({
            type: "POST",
            url: WFS_CONFIG.url,
            dataType: "xml",
            contentType: "text/xml",
            data: xml,
            success: function (response) {
                let exception = findXmlNode(response, "ServiceException");
                if (exception) {
                    console.error("WFS-Transaktion fehlgeschlagen:", exception.textContent);
                    reject(new Error(exception.textContent.trim()));
                    return;
                }

                if (!findXmlNode(response, "SUCCESS")) {
                    console.warn("Antwort erhalten, Erfolg aber nicht bestätigt:",
                        new XMLSerializer().serializeToString(response));
                }

                // Die neue ID steht in der Antwort, z. B. <ogc:FeatureId fid="unsafe_point.12"/>
                let fidNode = findXmlNode(response, "FeatureId");
                resolve(fidNode ? parseFeatureId(fidNode.getAttribute("fid")) : null);
            },
            error: function (xhr) {
                reject(new Error("Server nicht erreichbar (HTTP-Status " + xhr.status + ")"));
            }
        });
    });
}

// Sucht ein Element in der XML-Antwort, egal mit welchem Präfix (wfs:, ogc:, ...)
function findXmlNode(doc, tagName) {
    let nodes = doc.getElementsByTagNameNS("*", tagName);
    return nodes.length > 0 ? nodes[0] : null;
}

// «unsafe_point.12» → 12
function parseFeatureId(fid) {
    let id = parseInt(String(fid).split(".").pop(), 10);
    return isNaN(id) ? null : id;
}


// ------- Platzhalter-Modus: im Browser zwischenspeichern -------

function storePending(layer, properties, geometryGml) {
    let entry = {
        layer: layer,
        properties: properties,
        geometryGml: geometryGml,
        savedAt: new Date().toISOString()
    };
    console.log("Platzhalter-Modus – nicht in die Datenbank geschrieben:", entry);

    try {
        let list = JSON.parse(localStorage.getItem(PENDING_KEY)) || [];
        list.push(entry);
        localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    } catch (err) {
        console.warn("Zwischenspeichern im Browser fehlgeschlagen:", err);
    }
}

// Zum Nachschauen in der Browser-Konsole
function getPendingData() {
    try {
        return JSON.parse(localStorage.getItem(PENDING_KEY)) || [];
    } catch (err) {
        return [];
    }
}


// ------- Hilfsfunktion -------

// Sonderzeichen wie & < > würden das XML kaputt machen, darum ersetzen
function escapeXml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
