"""
Flask-App für Safe Steps.

Hier stehen nur die Routen (URLs). Die eigentliche Arbeit (Datenbank, Analyse)
passiert in eigenen Dateien, wie app.py und backend.py in der Flask-Übung.

Starten (im Ordner backend/):
    python app.py
Danach im Browser testen:
    http://localhost:8989/
    http://localhost:8989/db_test
"""
from flask import Flask, jsonify
from flask_cors import CORS  # pip install flask-cors

import db

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


def create_app():
    return app


if __name__ == "__main__":
    app.run(debug=True, host="localhost", port=PORT)
