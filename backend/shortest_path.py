"""
Kürzester Weg und Circuity Ratio für Safe Steps.

Wird direkt nach dem Map-Matching aufgerufen (siehe app.py, /map_match/<track_id>).
Was nur von diesem einen Weg abhängt, wird sofort gerechnet und gespeichert.
Die Bereinigung der Daten und die Auswertung über alle Wege passieren später
in einem separaten Notebook.

Ablauf von compute_shortest_path(track_id):
  1. Gematchten Weg aus matched_track lesen (geschrieben von map_matching.py)
  2. Start und Ziel = erster und letzter Netzknoten des gematchten Wegs
     (nicht das rohe GPS → beide Linien liegen auf demselben Netz)
  3. Kürzesten Weg auf demselben OSM-Fussnetz berechnen
  4. Circuity Ratio = Länge(matched) / Länge(shortest)
  5. In shortest_path und routeanalysis speichern (alte Einträge des Wegs werden ersetzt)

Es werden nur bestehende Tabellen und Spalten verwendet – die Datenbank muss nicht angepasst werden.
"""
import geopandas as gpd
import networkx as nx
from shapely import wkt
from shapely.geometry import LineString

import db
import map_matching
from map_matching import SCHEMA, CRS_WGS84, CRS_METRIC


# ------- Gematchten Weg lesen -------

def load_matched_line(track_id):
    """Liest den gematchten Weg aus matched_track (EPSG:4326) und gibt ihn in EPSG:2056 (Meter) zurück."""
    df = db.read_sql(
        f"SELECT ST_AsText(geometry) AS wkt FROM {SCHEMA}.matched_track WHERE track_id = %(track_id)s",
        params={"track_id": track_id},
    )
    if df.empty or df["wkt"].iloc[0] is None:
        raise map_matching.MapMatchingError(f"Weg {track_id} ist noch nicht gematcht.")
    line = wkt.loads(df["wkt"].iloc[0])
    return gpd.GeoSeries([line], crs=CRS_WGS84).to_crs(CRS_METRIC).iloc[0]


# ------- Kürzester Weg auf dem Netz -------

def nearest_node(G, x, y):
    """Knoten im Graphen, der am nächsten bei (x, y) liegt (EPSG:2056).
    Start und Ziel des gematchten Wegs sind selbst Netzknoten → Abstand 0."""
    return min(G.nodes, key=lambda n: (G.nodes[n]["x"] - x) ** 2 + (G.nodes[n]["y"] - y) ** 2)


def shortest_path_line(G, start_xy, end_xy):
    """Kürzester Weg auf dem Netz G zwischen den Knoten bei start_xy und end_xy.
    Rückgabe: LineString in EPSG:2056."""
    Gu = G.to_undirected()  # zu Fuss in beide Richtungen begehbar (wie beim Matching)
    start = nearest_node(Gu, *start_xy)
    end = nearest_node(Gu, *end_xy)
    if start == end:
        raise map_matching.MapMatchingError("Start und Ziel sind derselbe Netzknoten (Rundweg).")
    try:
        nodes = nx.shortest_path(Gu, start, end, weight="length")
    except nx.NetworkXNoPath:
        raise map_matching.MapMatchingError("Kein Weg zwischen Start und Ziel im Netz-Ausschnitt.")
    return LineString([(Gu.nodes[n]["x"], Gu.nodes[n]["y"]) for n in nodes])


# ------- Ablauf für einen Weg -------

def compute_shortest_path(track_id):
    """Berechnet kürzesten Weg und Circuity Ratio für einen gematchten Weg,
    speichert beides und gibt eine Zusammenfassung zurück."""
    matched_line = load_matched_line(track_id)

    # Dasselbe Netz wie beim Matching (Ausschnitt rund um den Weg)
    G = map_matching.graph_around(matched_line)
    sp_line = shortest_path_line(G, matched_line.coords[0], matched_line.coords[-1])

    # Beide Längen gleich gemessen: gerade Stücke zwischen Netzknoten, in Metern
    # → wirklich vergleichbar
    matched_len = matched_line.length
    shortest_len = sp_line.length
    ratio = matched_len / shortest_len

    sp_wgs84 = gpd.GeoSeries([sp_line], crs=CRS_METRIC).to_crs(CRS_WGS84).iloc[0]
    save_results(track_id, sp_wgs84, shortest_len, ratio)

    result = {
        "matched_length_m": round(matched_len, 1),
        "shortest_length_m": round(shortest_len, 1),
        "circuity_ratio": round(ratio, 3),
        "detour_percent": round((ratio - 1) * 100, 1),
    }
    if ratio < 0.99:
        result["warning"] = "Ratio < 1: Problem beim Matching oder Routing prüfen"
    return result


# ------- Speichern -------

def save_results(track_id, line_wgs84, length_m, ratio):
    """Schreibt den kürzesten Weg in shortest_path und die Ratio in routeanalysis.

    Alte Einträge desselben Wegs werden zuerst gelöscht, damit es pro Weg nur
    eine Zeile gibt (z. B. wenn ein Weg nochmals gerechnet wird).
    Die IDs werden als grösste vorhandene ID + 1 vergeben – so braucht es
    keine Änderung an der Datenbank.
    Alles läuft in einer Transaktion: Entweder wird alles gespeichert oder nichts.
    """
    db.execute(
        f"""
        DELETE FROM {SCHEMA}.routeanalysis WHERE track_id = %(track_id)s;
        DELETE FROM {SCHEMA}.shortest_path WHERE track_id = %(track_id)s;

        INSERT INTO {SCHEMA}.shortest_path (shortestpath_id, track_id, geometry, length, calculated_at)
        SELECT COALESCE(MAX(shortestpath_id), 0) + 1, %(track_id)s,
               ST_GeomFromText(%(wkt)s, 4326), %(length)s, now()
        FROM {SCHEMA}.shortest_path;

        INSERT INTO {SCHEMA}.routeanalysis (analysis_id, shortest_path_id, track_id, circuity_ratio)
        SELECT (SELECT COALESCE(MAX(analysis_id), 0) + 1 FROM {SCHEMA}.routeanalysis),
               s.shortestpath_id, %(track_id)s, %(ratio)s
        FROM {SCHEMA}.shortest_path s
        WHERE s.track_id = %(track_id)s;
        """,
        {"track_id": track_id, "wkt": line_wgs84.wkt, "length": round(length_m, 1), "ratio": round(ratio, 4)},
    )
