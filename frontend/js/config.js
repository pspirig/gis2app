// ======= Einstellungen für das Speichern in der Datenbank (GeoServer / WFS-T) =======
//
// Solange der GeoServer nicht bereit ist: enabled = false lassen.
// Dann werden Meldungen, Wege und Angaben nur im Browser zwischengespeichert
// (Platzhalter-Modus, siehe wfs.js).
//
// Sobald der GeoServer bereit ist:
//   1. url, workspace und namespaceUri anpassen (stehen im GeoServer unter «Workspaces»)
//   2. Layer-Namen prüfen
//   3. enabled = true setzen

const WFS_CONFIG = {
    enabled: true,

    // TODO: Workspace-Namen im Link anpassen
    url: "https://baug-ikg-gis-01.ethz.ch:8443/geoserver/GTA26_project/wfs",

    // TODO: Name und Namespace-URI des Workspace im GeoServer
    workspace: "GTA26_project",
    namespaceUri: "https://www.gis.ethz.ch/GTA26_project",

    // Name der Layer im GeoServer (entspricht meist dem Tabellennamen)
    layers: {
        user: "user",
        report: "unsafe_point",
        track: "actual_track",
        matchedTrack: "matched_track"  // wird vom Backend befüllt, nur zum Anzeigen
    },

    // Koordinatensystem der Geometrien, die wir schicken (Länge/Breite vom GPS)
    srsName: "http://www.opengis.net/gml/srs/epsg.xml#4326"
};


// ======= Einstellungen für das Flask-Backend (Analyse) =======
//
// Nach «Stop» schickt die App die track_id an das Backend. Dieses matcht den Weg
// auf das OSM-Fussnetz und speichert ihn in der Tabelle matched_track.
//
// Solange das Backend nicht läuft: enabled = false lassen.
// Hinweis: Läuft die App über https, muss auch das Backend über https erreichbar
// sein, sonst blockiert der Browser die Anfrage.

const BACKEND_CONFIG = {
    enabled: false,

    // Lokal: http://localhost:8989 – auf dem Server: eure Adresse und Port-Nummer
    url: "http://localhost:8989"
};
