# Datenbank & GeoServer: Stand und offene Punkte

Abgleich zwischen dem Datenbankschema (`gta26_g1`) und der App.
Stand: 12. November 2026

## Erledigt

| # | Punkt | Entscheid / Umsetzung |
|---|---|---|
| 1 | Sicherheitsgefühl | wird nicht mehr erfasst, Feld aus dem Formular entfernt |
| 2 | Bemerkung | Feld aus dem Formular entfernt |
| 3 | Mehrere Kategorien | nur noch **eine** Kategorie wählbar (Radio-Buttons) → `reason_category`; leer erlaubt → NULL |
| 4 | `track_id` bei Meldungen | Meldungen während einer Aufzeichnung werden gesammelt und erst bei «Stop» gespeichert, dann mit der `track_id` des Wegs. Weg verworfen / zu kurz / Fehler → Meldungen werden trotzdem gespeichert, mit `track_id` = NULL |
| 5 | Alter | Eingabe als Zahl (10–110) → `age integer` |
| 6 | Username | wird gespeichert, Datenschutztext angepasst |
| 7 | `tackingactive` | Tippfehler bleibt. Die App verwendet die Spalte nicht. Falls doch einmal: genau so schreiben |
| 8 | Einwilligung | wird nicht gespeichert. Die App lässt sich nur mit Einwilligung starten |
| 9 | Tabellenname `user` | bleibt so (siehe unten) |
| 11 | Geometrie-Typ / Koordinatensystem | im Code gelöst (siehe unten) |
| 12 | Zeitstempel pro GPS-Punkt | nicht nötig. Für die Forschungsfrage braucht es nur den Weg, Start-/Endzeit sind gespeichert |
| 13 | Layer im GeoServer veröffentlicht | erledigt |
| 14 | WFS mit Schreibrechten | erledigt |

### Zu 9: Tabellenname `user`

Kein grosses Problem, darum bleibt er:
- **WFS / GeoServer:** keine Probleme. GeoServer setzt die Anführungszeichen selbst.
- **Eigenes SQL** (z. B. später in Python oder pgAdmin): immer `gta26_g1."user"` schreiben. Ohne Anführungszeichen meint PostgreSQL mit `user` den eingeloggten Datenbank-User.

### Zu 11: Geometrie

Die Spalten haben den allgemeinen Typ `geometry`, also ohne festen Typ und ohne Koordinatensystem. Das passt zur App:
- Meldungen werden als `Point` geschickt, Wege als `MultiLineString` (ein Weg mit Unterbrüchen besteht aus mehreren Teilstücken).
- Die App schickt immer Längen-/Breitengrade (**EPSG:4326**).
- Wichtig ist nur, dass die Layer im GeoServer das Koordinatensystem **EPSG:4326** haben (siehe offene Punkte).

## Offen

### A. IDs automatisch vergeben (Punkt 10) – wichtig, bevor die App live geht
`user_id`, `track_id` und `unsafe_point_id` muss die Datenbank selbst hochzählen, sonst funktioniert das Speichern über WFS-T nicht, und die App bekommt keine ID zurück.
- Prüfen und beheben mit `docs/sql/ids_automatisch.sql` (Anleitung in der Datei).
- Das ändert nur die ID-Spalten. Die WFS-Verbindung muss **nicht** neu gemacht werden. Danach im GeoServer beim Layer einmal «Speichern» bzw. den Store neu laden.
- Der letzte Block der SQL-Datei zeigt, ob es noch andere Pflichtfelder gibt (z. B. `tackingactive NOT NULL`), die die App nicht befüllt.

### B. GeoServer-Angaben in die App eintragen (Punkt 15)
In `frontend/js/config.js` eintragen:
- [ ] WFS-URL (z. B. `https://baug-ikg-gis-01.ethz.ch:8443/geoserver/<workspace>/wfs`)
- [ ] Workspace-Name
- [ ] Namespace-URI des Workspace
- [ ] Layer-Namen für `user`, `unsafe_point`, `actual_track`
- [ ] Koordinatensystem der Layer prüfen: «Declared SRS» = EPSG:4326
- [ ] `enabled: true` setzen und testen

### C. Später (Feinheiten)
- «Meine Angaben ändern» aktualisiert die Angaben bisher nur im Browser, nicht in der Datenbank (braucht WFS-T Update).
- Daten, die im Platzhalter-Modus nur im Browser gespeichert wurden, nachträglich hochladen.
- User ohne `user_id`: Wurde der User angelegt, als die Datenbank noch nicht verbunden war, haben seine Meldungen und Wege `user_id` = NULL.
