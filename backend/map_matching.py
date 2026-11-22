"""
Map Matching für Safe Steps.

Ein gelaufener Weg (Tabelle actual_track) wird mit einem Hidden-Markov-Modell
(HMM, Bibliothek leuvenmapmatching) auf das OSM-Fussnetz gematcht.
Das Ergebnis ist eine zusammenhängende Route auf dem Netz. Sie wird in die
Tabelle matched_track geschrieben (eine Zeile pro Weg).

Ablauf von match_track(track_id):
  1. Rohweg aus actual_track lesen (MultiLineString, EPSG:4326)
  2. in LV95 (EPSG:2056, Meter) umrechnen und Punkte ausdünnen
  3. Ausschnitt des OSM-Fussnetzes rund um den Weg holen
  4. jedes Teilstück einzeln matchen, Lücken zwischen den Teilstücken
     mit dem kürzesten Weg auf dem Netz schliessen
  5. Route in matched_track speichern (überschreibt einen alten Eintrag)

Das OSM-Netz der Stadt Zürich wird beim ersten Aufruf heruntergeladen
(dauert einige Minuten) und in data/zurich_walk.graphml gespeichert.
Danach wird nur noch diese Datei gelesen.
"""
import os
import threading

import geopandas as gpd
import networkx as nx
import osmnx as ox
from leuvenmapmatching.map.inmem import InMemMap
from leuvenmapmatching.matcher.distance import DistanceMatcher
from shapely import wkt
from shapely.geometry import LineString, MultiLineString, Point

import db

# ------- Einstellungen -------

SCHEMA = "gta26_g1"
CRS_WGS84 = "EPSG:4326"   # so speichert die App die Geometrien
CRS_METRIC = "EPSG:2056"  # LV95, Einheit Meter – für alle Berechnungen

PLACE = "Zürich, Switzerland"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
GRAPH_FILE = os.path.join(DATA_DIR, "zurich_walk.graphml")

MIN_POINT_DIST = 10   # m: Punkte, die näher beieinander liegen, werden ausgelassen
GRAPH_BUFFER = 300    # m: so viel Netz rund um den Weg wird verwendet

# Parameter des HMM – an die GPS-Genauigkeit der Handys anpassen
MAX_DIST = 50         # m: maximale Distanz GPS-Punkt -> Weg
OBS_NOISE = 15        # m: erwartete GPS-Ungenauigkeit
MIN_PROB_NORM = 0.5   # wie streng unwahrscheinliche Pfade verworfen werden


class MapMatchingError(Exception):
    """Weg kann nicht gematcht werden (zu kurz, keine Geometrie, ...)."""


class TrackNotFound(MapMatchingError):
    """Es gibt keinen Weg mit dieser track_id."""


# ------- OSM-Fussnetz -------

_city_graph = None
_city_bounds = None
_graph_lock = threading.Lock()


def get_city_graph():
    """Gibt das Fussnetz von Zürich zurück (EPSG:2056).
    Wird nur einmal geladen und dann im Speicher behalten."""
    global _city_graph, _city_bounds
    with _graph_lock:
        if _city_graph is None:
            if os.path.exists(GRAPH_FILE):
                G = ox.load_graphml(GRAPH_FILE)
            else:
                # simplify=False: Jeder Stützpunkt bleibt ein Knoten. Das HMM
                # behandelt Kanten als gerade Linien, sonst würden Kurven abgeschnitten.
                G = ox.graph_from_place(PLACE, network_type="walk", simplify=False)
                G = ox.project_graph(G, to_crs=CRS_METRIC)
                os.makedirs(DATA_DIR, exist_ok=True)
                ox.save_graphml(G, GRAPH_FILE)
            xs = [d["x"] for _, d in G.nodes(data=True)]
            ys = [d["y"] for _, d in G.nodes(data=True)]
            _city_bounds = (min(xs), min(ys), max(xs), max(ys))
            _city_graph = G
    return _city_graph


def graph_around(geom_metric):
    """Ausschnitt des Fussnetzes rund um eine Geometrie (EPSG:2056).
    Liegt der Weg nicht ganz in Zürich, wird der Ausschnitt direkt von OSM geladen."""
    G = get_city_graph()
    minx, miny, maxx, maxy = geom_metric.buffer(GRAPH_BUFFER).bounds
    cminx, cminy, cmaxx, cmaxy = _city_bounds

    if minx >= cminx and miny >= cminy and maxx <= cmaxx and maxy <= cmaxy:
        nodes = [n for n, d in G.nodes(data=True)
                 if minx <= d["x"] <= maxx and miny <= d["y"] <= maxy]
        return G.subgraph(nodes).copy()

    area = gpd.GeoSeries([geom_metric.buffer(GRAPH_BUFFER)], crs=CRS_METRIC).to_crs(CRS_WGS84).iloc[0]
    G_local = ox.graph_from_polygon(area, network_type="walk", simplify=False)
    return ox.project_graph(G_local, to_crs=CRS_METRIC)


def build_inmem_map(G):
    """Überträgt den osmnx-Graphen in die Karte von leuvenmapmatching.
    Die Knoten-IDs bleiben die OSM-IDs."""
    m = InMemMap("osm_walk", use_latlon=False, use_rtree=True, index_edges=True)
    for nid, d in G.nodes(data=True):
        m.add_node(nid, (d["y"], d["x"]))  # Reihenfolge (y, x)!
    for u, v in G.edges():
        if u != v:
            m.add_edge(u, v)
            m.add_edge(v, u)  # zu Fuss in beide Richtungen begehbar
    return m


# ------- Rohweg lesen -------

def load_track_parts(track_id):
    """Liest einen Weg aus actual_track und gibt seine Teilstücke als
    Listen von Punkten in EPSG:2056 zurück (ein Weg mit Unterbrüchen hat mehrere)."""
    df = db.read_sql(
        f"SELECT ST_AsText(geometry) AS wkt FROM {SCHEMA}.actual_track WHERE track_id = %(track_id)s",
        params={"track_id": track_id},
    )
    if df.empty:
        raise TrackNotFound(f"Weg {track_id} existiert nicht.")
    if df["wkt"].iloc[0] is None:
        raise MapMatchingError(f"Weg {track_id} hat keine Geometrie.")

    # ST_AsText liefert die Koordinaten ohne Koordinatensystem. Die App schickt
    # immer EPSG:4326 – darum spielt es keine Rolle, welche SRID in der DB steht.
    geom = wkt.loads(df["wkt"].iloc[0])
    lines = list(geom.geoms) if isinstance(geom, MultiLineString) else [geom]

    parts = []
    for line in lines:
        pts = gpd.GeoSeries([Point(c[0], c[1]) for c in line.coords], crs=CRS_WGS84).to_crs(CRS_METRIC)
        parts.append(list(pts))
    return parts


def thin_points(points, min_dist=MIN_POINT_DIST):
    """Lässt Punkte weg, die näher als min_dist am zuletzt behaltenen Punkt liegen
    (entfernt das GPS-Zittern beim Stehen). Der letzte Punkt bleibt immer."""
    if not points:
        return []
    keep = [points[0]]
    for p in points[1:]:
        if p.distance(keep[-1]) >= min_dist:
            keep.append(p)
    if keep[-1] is not points[-1] and len(points) > 1:
        keep.append(points[-1])
    return keep


# ------- Matching -------

def match_points(inmem_map, points):
    """HMM-Matching einer Punktfolge.
    Rückgabe: (Knotenfolge, Anzahl gematchter Punkte)."""
    matcher = DistanceMatcher(
        inmem_map,
        max_dist=MAX_DIST,
        max_dist_init=MAX_DIST,
        obs_noise=OBS_NOISE,
        obs_noise_ne=OBS_NOISE * 2,
        min_prob_norm=MIN_PROB_NORM,
        non_emitting_states=True,  # erlaubt Kanten ohne eigenen GPS-Punkt
        max_lattice_width=10,
    )
    _, last_idx = matcher.match([(p.y, p.x) for p in points])
    return list(matcher.path_pred_onlynodes), last_idx + 1


def connect(G_undirected, route, nodes):
    """Hängt eine Knotenfolge an die Route an. Wo zwei Knoten nicht direkt
    verbunden sind, wird die Lücke mit dem kürzesten Weg geschlossen."""
    for n in nodes:
        if route and route[-1] == n:
            continue
        if route and not G_undirected.has_edge(route[-1], n):
            try:
                route += nx.shortest_path(G_undirected, route[-1], n, weight="length")[1:]
                continue
            except nx.NetworkXNoPath:
                pass  # kein Weg im Ausschnitt: Knoten trotzdem anhängen
        route.append(n)
    return route


def match_track(track_id):
    """Matcht einen Weg und speichert das Ergebnis in matched_track.
    Gibt eine Zusammenfassung als dict zurück."""
    parts = [thin_points(p) for p in load_track_parts(track_id)]
    parts = [p for p in parts if len(p) >= 2]
    n_points = sum(len(p) for p in parts)
    if n_points < 2:
        raise MapMatchingError(f"Weg {track_id} hat zu wenige Punkte.")

    all_points = MultiLineString([LineString([(p.x, p.y) for p in part]) for part in parts])
    G = graph_around(all_points)
    if G.number_of_nodes() == 0:
        raise MapMatchingError(f"Kein OSM-Fussnetz rund um Weg {track_id} gefunden.")
    Gu = G.to_undirected()
    inmem_map = build_inmem_map(G)

    # Jedes Teilstück einzeln matchen: grosse Lücken (App im Hintergrund)
    # würden das HMM sonst abbrechen lassen.
    route, n_matched = [], 0
    for part in parts:
        nodes, n_ok = match_points(inmem_map, part)
        n_matched += n_ok
        route = connect(Gu, route, nodes)

    if len(route) < 2:
        raise MapMatchingError(f"Weg {track_id} konnte nicht auf das Netz gematcht werden.")

    line_metric = LineString([(G.nodes[n]["x"], G.nodes[n]["y"]) for n in route])
    line_wgs84 = gpd.GeoSeries([line_metric], crs=CRS_METRIC).to_crs(CRS_WGS84).iloc[0]
    result = {
        "track_id": track_id,
        "length_m": round(line_metric.length, 1),
        "matched_fraction": round(n_matched / n_points, 3),
        "num_points": n_points,
    }
    save_matched_track(track_id, line_wgs84, result["length_m"], result["matched_fraction"])
    return result


# ------- Speichern -------

def save_matched_track(track_id, line_wgs84, length_m, matched_fraction):
    """Schreibt die gematchte Route in matched_track.
    Gibt es für den Weg schon einen Eintrag, wird er überschrieben."""
    db.execute(
        f"""
        INSERT INTO {SCHEMA}.matched_track (track_id, geometry, length, matched_fraction, calculated_at)
        VALUES (%(track_id)s, ST_GeomFromText(%(wkt)s, 4326), %(length)s, %(fraction)s, now())
        ON CONFLICT (track_id) DO UPDATE SET
            geometry = EXCLUDED.geometry,
            length = EXCLUDED.length,
            matched_fraction = EXCLUDED.matched_fraction,
            calculated_at = now()
        """,
        {"track_id": track_id, "wkt": line_wgs84.wkt, "length": length_m, "fraction": matched_fraction},
    )


def unmatched_track_ids():
    """track_ids aller Wege, die noch keinen Eintrag in matched_track haben."""
    df = db.read_sql(
        f"""
        SELECT a.track_id
        FROM {SCHEMA}.actual_track a
        LEFT JOIN {SCHEMA}.matched_track m ON m.track_id = a.track_id
        WHERE m.track_id IS NULL AND a.geometry IS NOT NULL
        ORDER BY a.track_id
        """
    )
    return [int(t) for t in df["track_id"]]
