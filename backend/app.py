"""
Flask-App für Safe Steps.

Hier stehen nur die Routen (URLs). Die eigentliche Arbeit (Datenbank, Analyse)
passiert in eigenen Dateien, wie app.py und backend.py in der Flask-Übung.

Starten (im Ordner backend/):
    python app.py
Danach im Browser testen:
    http://localhost:8989/
    http://localhost:8989/db_test
    http://localhost:8989/map_match/1
"""
from flask import Flask, jsonify
from flask_cors import CORS  # pip install flask-cors

import db
import map_matching
import shortest_path

# Lokal: 8989 (wie in der Übung).
# Auf dem Server: eure Nummer, z. B. 5012 für gta_u12.
PORT = 8989

app = Flask(__name__)
CORS(app, origins=["*", "null"])  # Anfragen vom Frontend erlauben (auch lokal geöffnete HTML-Datei)


@app.route("/", methods=["GET"])
def index_page():
    """Startseite: zeigt, dass das Backend läuft."""
    return jsonify("Safe Steps Backend läuft!")


@app.route("/db_test", methods=["GET"])
def db_test():
    """Prüft die Verbindung zur Datenbank."""
    try:
        versions = db.test_connection()
        return jsonify({"status": "ok", **versions})
    except Exception as err:
        return jsonify({"status": "error", "message": str(err)}), 500


@app.route("/map_match/<int:track_id>", methods=["GET", "POST"])
def map_match(track_id):
    """Matcht einen Weg auf das OSM-Fussnetz und speichert ihn in matched_track.
    Wird von der App nach «Stop» aufgerufen (POST), zum Testen geht auch der Browser (GET)."""
    try:
        result = map_matching.match_track(track_id)
        result.update(run_shortest_path(track_id))
        return jsonify({"status": "ok", **result})
    except map_matching.TrackNotFound as err:
        return jsonify({"status": "error", "message": str(err)}), 404
    except map_matching.MapMatchingError as err:
        return jsonify({"status": "error", "message": str(err)}), 422
    except Exception as err:
        app.logger.exception("Map Matching für Weg %s fehlgeschlagen", track_id)
        return jsonify({"status": "error", "message": str(err)}), 500


@app.route("/map_match_all", methods=["GET"])
def map_match_all():
    """Matcht alle Wege, die noch keinen Eintrag in matched_track haben
    (z. B. ältere Wege oder Wege, bei denen das Backend nicht lief)."""
    results, errors = [], []
    for track_id in map_matching.unmatched_track_ids():
        try:
            result = map_matching.match_track(track_id)
            result.update(run_shortest_path(track_id))
            results.append(result)
        except Exception as err:
            errors.append({"track_id": track_id, "message": str(err)})
    return jsonify({"status": "ok", "matched": results, "errors": errors})


def run_shortest_path(track_id):
    """Kürzester Weg und Circuity Ratio direkt nach dem Map-Matching.
    Ein Fehler hier (z. B. Rundweg) macht das Matching nicht ungültig:
    Er wird nur in der Antwort gemeldet."""
    try:
        return shortest_path.compute_shortest_path(track_id)
    except map_matching.MapMatchingError as err:
        return {"shortest_path_error": str(err)}


@app.route("/shortest_path_all", methods=["GET"])
def shortest_path_all():
    """Berechnet den kürzesten Weg für alle schon gematchten Wege nochmals
    (z. B. für Wege, die vor dieser Funktion gematcht wurden)."""
    df = db.read_sql(f"SELECT track_id FROM {map_matching.SCHEMA}.matched_track ORDER BY track_id")
    results = []
    for track_id in df["track_id"]:
        results.append({"track_id": int(track_id), **run_shortest_path(int(track_id))})
    return jsonify({"status": "ok", "results": results})


def create_app():
    return app


if __name__ == "__main__":
    app.run(debug=True, host="localhost", port=PORT)
