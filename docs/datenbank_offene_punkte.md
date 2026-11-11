# Datenbank: offene Punkte zum Besprechen

Abgleich zwischen dem Datenbankschema (`gta26_g1`) und dem, was die App erfasst.
Stand: 8. November 2026

## Tabelle `unsafe_point` (Meldungen)

1. **Sicherheitsgefühl fehlt.** Die App erfasst eine Stufe von 1 (sehr unsicher) bis 5 (sehr sicher).
   → Spalte ergänzen, z. B. `safety integer`.
2. **Bemerkung fehlt.** Die App hat ein Freitextfeld.
   → Spalte ergänzen, z. B. `remark text`.
3. **Mehrere Kategorien.** Man kann mehrere Kategorien gleichzeitig ankreuzen, die Tabelle hat aber nur `reason_category text`.
   Aktuell schreibt die App sie mit Komma getrennt hinein (`"Belästigung, Diebstahl"`).
   → So lassen, oder als Liste speichern (`text[]`), oder in einer eigenen Tabelle?
4. **`track_id` bei Meldungen während eines Wegs.** Der Weg wird erst beim «Stop» gespeichert, seine ID ist beim Melden also noch nicht bekannt.
   → Möglichkeiten: Weg schon beim «Los» anlegen und beim «Stop» ergänzen, Meldungen nachträglich zuordnen, oder `track_id` leer lassen und später über Zeit und Ort verknüpfen.

## Tabelle `user`

5. **Alter:** Die Tabelle hat `age integer`, die App erfasst Altersgruppen wie `"18-24"` oder `"keine Angabe"`.
   → Spalte ändern zu `age_group text`?
6. **`username`:** Laut Datenschutztext in der App ist sie anonym (ohne Namen).
   → Spalte entfernen oder immer leer lassen?
7. **`tackingactive`:** Tippfehler (`trackingactive`)? Und wird die Spalte gebraucht? Die App merkt sich eine laufende Aufzeichnung bereits im Browser.
8. **Einwilligung:** Die App fragt nach dem Einverständnis zur Datennutzung, die Tabelle speichert es aber nicht.
   → Für das Forschungsprojekt sinnvoll? z. B. `consent boolean`, `created_at timestamptz`.
9. **Tabellenname `user`:** Das ist in PostgreSQL ein reserviertes Wort und muss überall in Anführungszeichen stehen (`"user"`). Das kann im GeoServer und in SQL-Abfragen Probleme machen.
   → Umbenennen, z. B. in `app_user`?

## Alle Tabellen

10. **IDs automatisch vergeben:** `user_id`, `track_id` und `unsafe_point_id` müssen von der Datenbank selbst hochgezählt werden (`serial` oder `GENERATED ALWAYS AS IDENTITY`). Sonst funktioniert das Speichern über WFS-T nicht.
11. **Geometrie-Typ und Koordinatensystem festlegen:** Die App schickt Längen-/Breitengrade (EPSG:4326).
    - `unsafe_point.geometry` → `geometry(Point, 4326)`
    - `actual_track.geometry` → `geometry(MultiLineString, 4326)` (ein Weg kann durch Unterbrüche aus mehreren Teilstücken bestehen)
12. **Zeitstempel pro GPS-Punkt:** Gespeichert werden nur Start- und Endzeit des Wegs, die Zeit jedes einzelnen Punkts geht verloren.
    → Reicht das für die Analyse, oder braucht es die Punkte einzeln (z. B. eine eigene Tabelle `track_point`)?

## GeoServer

13. Die Tabellen `user`, `unsafe_point` und `actual_track` als Layer in einem Workspace veröffentlichen.
14. WFS mit Schreibrechten einschalten (Service-Level «Transactional») und das Schreiben auf die Layer erlauben.
15. Danach in `frontend/js/config.js` Workspace, Namespace-URI und Layer-Namen eintragen und `enabled: true` setzen.
