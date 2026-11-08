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
