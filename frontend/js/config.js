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
    enabled: false,

    // TODO: Workspace-Namen im Link anpassen
    url: "https://baug-ikg-gis-01.ethz.ch:8443/geoserver/GTA26_g1/wfs",

    // TODO: Name und Namespace-URI des Workspace im GeoServer
    workspace: "GTA26_g1",
    namespaceUri: "https://www.gis.ethz.ch/GTA26_g1",

    // Name der Layer im GeoServer (entspricht meist dem Tabellennamen)
    layers: {
        user: "user",
        report: "unsafe_point",
        track: "actual_track"
    },

    // Koordinatensystem der Geometrien, die wir schicken (Länge/Breite vom GPS)
    srsName: "http://www.opengis.net/gml/srs/epsg.xml#4326"
};
