"""
Datenbank-Zugriff für das Safe-Steps-Backend.

Aufgebaut wie backend.py aus der Flask-Übung:
  - Login-Daten kommen aus db_login.json (nicht im Code, nicht auf GitHub)
  - Verbindung mit psycopg2
  - Abfragen mit pandas über eine SQLAlchemy-Engine

Alle anderen Module holen sich die Daten über diese Datei.
So steht der Verbindungs-Code nur an einer Stelle.
"""
import json
import os

import pandas as pd
import psycopg2
from sqlalchemy import create_engine

# Pfad relativ zu dieser Datei: funktioniert egal, aus welchem Ordner app.py gestartet wird
DB_LOGIN_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "db_login.json")

# Die Engine wird nur einmal erstellt und dann wiederverwendet
# (in der Übung wurde sie bei jedem Aufruf neu erstellt).
_engine = None


def load_db_login():
    """Liest die Login-Daten aus db_login.json."""
    with open(DB_LOGIN_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def get_engine():
    """Gibt die Datenbank-Engine zurück (wird beim ersten Aufruf erstellt)."""
    global _engine
    if _engine is None:
        dblogin = load_db_login()

        def get_con():
            return psycopg2.connect(**dblogin)

        _engine = create_engine("postgresql+psycopg2://", creator=get_con)
    return _engine


def read_sql(query):
    """Führt eine SELECT-Abfrage aus und gibt das Ergebnis als pandas-DataFrame zurück."""
    return pd.read_sql(query, get_engine())


def test_connection():
    """Prüft, ob die Datenbank erreichbar ist, und gibt die PostgreSQL- und PostGIS-Version zurück."""
    df = read_sql("SELECT version() AS postgres, postgis_version() AS postgis")
    return {
        "postgres": df["postgres"].iloc[0],
        "postgis": df["postgis"].iloc[0],
    }
