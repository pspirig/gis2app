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
            results.append(map_matching.match_track(track_id))
        except Exception as err:
            errors.append({"track_id": track_id, "message": str(err)})
    return jsonify({"status": "ok", "matched": results, "errors": errors})


def create_app():
    return app


if __name__ == "__main__":
    app.run(debug=True, host="localhost", port=PORT)
