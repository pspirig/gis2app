# Safe Steps – Backend (Flask)

Das Backend führt die **Analyse** der gesammelten Daten aus:
Daten aus der PostGIS-Datenbank lesen → in Python analysieren → Ergebnis zurück in die Datenbank schreiben.

Das **Speichern** von Meldungen und Wegen macht das Frontend direkt über GeoServer (WFS-T), nicht über Flask.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `app.py` | Flask-Routen (URLs), sonst nichts |
| `config.py` | Einstellungen: Schema, Tabellen, Buffer-Distanzen |
| `db.py` | Verbindung zur Datenbank, Hilfsfunktionen für Abfragen |
| `analysis/tracks.py` | gelaufene Wege lesen |
| `analysis/exposure.py` | Nähe eines Wegs zu unsicheren Orten |
| `map_matching.py` | gelaufene Wege auf das OSM-Fussnetz matchen → Tabelle `matched_track` |
| `data/zurich_walk.graphml` | OSM-Fussnetz von Zürich, wird beim ersten Map Matching erstellt (**nicht** auf GitHub) |
| `db_login.example.json` | Vorlage für die Login-Daten |
| `db_login.json` | eure echten Login-Daten (**nicht** auf GitHub, steht in `.gitignore`) |

## Einrichten

1. Conda-Umgebung aktivieren: `conda activate gta26`
2. Fehlende Pakete installieren: `pip install -r requirements.txt`
3. `db_login.example.json` kopieren, in `db_login.json` umbenennen und eure Login-Daten eintragen

## Starten und testen

```bash
cd backend
python app.py
```

| URL | Was passiert |
|---|---|
| http://localhost:8989/ | `"Safe Steps Backend läuft!"` |
| http://localhost:8989/db_test | Verbindung zur DB prüfen |
| http://localhost:8989/db_info | Koordinatensystem (SRID) der Tabellen anzeigen |
| http://localhost:8989/unsafe_exposure?track_id=1 | unsichere Orte im Umkreis von 50 m um Weg 1 zählen |
| http://localhost:8989/map_match/1 | Weg 1 auf das OSM-Fussnetz matchen und in `matched_track` speichern |
| http://localhost:8989/map_match_all | alle Wege matchen, die noch nicht in `matched_track` stehen |

## Map Matching

- Die App ruft `/map_match/<track_id>` automatisch auf, sobald ein Weg gespeichert ist
  (nur wenn `BACKEND_CONFIG.enabled = true` in `frontend/js/config.js`).
- Die Tabelle `matched_track` muss vorher existieren: `docs/sql/matched_track.sql`.
- **Erster Aufruf dauert einige Minuten:** Das OSM-Fussnetz von Zürich wird heruntergeladen und
  in `data/zurich_walk.graphml` gespeichert. Am besten nach dem Starten einmal
  `/map_match/<eine bestehende track_id>` im Browser aufrufen. Danach geht es schnell.
- Netz neu laden (z. B. wenn OSM aktualisiert wurde): `data/zurich_walk.graphml` löschen.
- Einstellungen (GPS-Genauigkeit, Puffer usw.) stehen oben in `map_matching.py`.
