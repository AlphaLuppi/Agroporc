#!/usr/bin/env python3
"""Génère `public/agroparc/scene.json`, les données de la vue 3D « rayons X » d'Agroparc.

Sources (téléchargées puis mises en cache dans `scripts/agroparc/.cache/`, ignoré par git) :
- Bâtiments et hauteurs : IGN BD TOPO v3 via le WFS de la Géoplateforme
  (`https://data.geopf.fr/wfs/ows`, couche `BDTOPO_V3:batiment`, GeoJSON). Attention à
  l'ordre des axes de la BBOX : lon,lat avec `CRS:84` (ou lat,lon avec l'URN EPSG::4326) ;
  un ordre incohérent renvoie 0 objet sans erreur.
- Voirie, parkings, arbres, eau, arrêts de bus : OpenStreetMap via Overpass
  (`https://overpass-api.de/api/interpreter`).

Repère local : origine (lon0, lat0) = (4.8885, 43.9160), 1 unité = 1 m,
x vers l'est, z vers le sud (three.js : y vers le haut).
    x = (lon − lon0) · 111320·cos(lat0)      z = −(lat − lat0) · 111132

Sélection des bâtiments : on garde ceux dont le centroïde est à moins de MARGE mètres
de la boîte englobante des POI (un seul paramètre à ajuster visuellement, `--marge`).
Le bâtiment parallèle à CBA (4 m dans BD TOPO) prend la hauteur de CBA (16,1 m).

Relancer :
    python3 scripts/agroparc/build_scene.py            # utilise le cache s'il existe
    python3 scripts/agroparc/build_scene.py --refresh  # re-télécharge IGN + OSM
    python3 scripts/agroparc/build_scene.py --marge 150
    python3 scripts/agroparc/build_scene.py --offline  # n'accède jamais au réseau
Stdlib uniquement (urllib, json, math, argparse, pathlib).
"""
import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = Path(__file__).resolve().parent / ".cache"
IGN_CACHE = CACHE_DIR / "ign_batiments.json"
OSM_CACHE = CACHE_DIR / "osm_ctx.json"
OUTPUT = ROOT / "public" / "agroparc" / "scene.json"

# Anciennes captures de la 1re passe (peuvent disparaître) : secours si le réseau échoue.
SCRATCH = Path(
    "/private/tmp/claude-501/-Users-toam-Documents-PDJ-Master/"
    "42d997d7-8f1b-43e5-95ec-4ec9717e99e8/scratchpad"
)

# ── Repère local ────────────────────────────────────────────────────────────
LON0, LAT0 = 4.8885, 43.9160
MX = 111320 * math.cos(math.radians(LAT0))
MY = 111132


def xz(lon: float, lat: float) -> list[float]:
    return [round((lon - LON0) * MX, 1), round(-(lat - LAT0) * MY, 1)]


def lonlat(x: float, z: float) -> tuple[float, float]:
    return round(LON0 + x / MX, 7), round(LAT0 - z / MY, 7)


# ── Sources ─────────────────────────────────────────────────────────────────
IGN_URL = (
    "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
    "&TYPENAMES=BDTOPO_V3:batiment&OUTPUTFORMAT=application/json&COUNT=5000"
    "&BBOX=4.875,43.905,4.900,43.926,CRS:84"
)  # CRS:84 = axes lon,lat ; l'URN EPSG::4326 attendrait lat,lon
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_QL = """[out:json][timeout:90];
(
  way["highway"](43.911,4.880,43.921,4.896);
  way["amenity"="parking"](43.911,4.880,43.921,4.896);
  node["natural"="tree"](43.911,4.880,43.921,4.896);
  way["natural"="water"](43.911,4.880,43.921,4.896);
  way["waterway"](43.911,4.880,43.921,4.896);
  way["landuse"="grass"](43.911,4.880,43.921,4.896);
  way["leisure"="park"](43.911,4.880,43.921,4.896);
  node["amenity"~"restaurant|cafe|fast_food"](43.911,4.880,43.921,4.896);
  node["shop"](43.911,4.880,43.921,4.896);
  node["office"](43.911,4.880,43.921,4.896);
  way["office"](43.911,4.880,43.921,4.896);
  node["highway"="bus_stop"](43.911,4.880,43.921,4.896);
  way["name"~"Camille Claudel|Aérodrome|Traité de Rome"](43.905,4.875,43.926,4.900);
);
out geom;
"""
UA = {"User-Agent": "pdj-agroparc-scene/2.0 (github.com/AlphaLuppi/Agroporc)"}

# ── Points d'intérêt (le `name` des restos = champ `restaurant` de l'API) ───
POIS = [
    {"id": "cba", "name": "CBA Informatique Libérale", "type": "home",
     "lon": 4.8859230, "lat": 43.9159077, "addr": "15 allée Camille Claudel"},
    {"id": "trefle", "name": "Le Bistrot Trèfle", "type": "resto",
     "lon": 4.8891882, "lat": 43.9155633, "addr": "1045 route de l'Aérodrome"},
    {"id": "pause", "name": "La Pause Gourmande", "type": "resto",
     "lon": 4.8893057, "lat": 43.9163848, "addr": "1045 route de l'Aérodrome"},
    {"id": "basilic", "name": "Basilic n'Go", "type": "resto",
     "lon": 4.8881547, "lat": 43.9165709, "addr": "775 route de l'Aérodrome"},
    {"id": "mijote", "name": "La Mijote", "type": "resto",
     "lon": 4.8886395, "lat": 43.9164806, "addr": "775 route de l'Aérodrome"},
    {"id": "dubble", "name": "Dubble", "type": "resto",
     "lon": 4.8903116, "lat": 43.916144, "addr": "1077 route de l'Aérodrome"},
    {"id": "truck", "name": "Le Truck Muche", "type": "truck",
     "addr": "parvis à l'est du bâtiment voisin de CBA"},
    # Épicerie avec bar à salades Picadeli : traitée comme un restaurant (cliquable, bâtiment ambre).
    {"id": "vival", "name": "Vival", "type": "resto",
     "lon": 4.8909944, "lat": 43.9160254, "addr": "1159 route de l'Aérodrome"},
]
# Truck garé sur le parvis à l'est du bâtiment parallèle à CBA (dont l'extrémité est ≈ (−139, 37)),
# juste derrière l'allée piétonne qui longe ce pignon.
TRUCK_XZ = (-125.0, 39.0)
# Points locaux forcés pour certains POI : le nœud OSM de La Mijote tombe à l'extrémité est du
# bâtiment qu'elle partage avec Basilic n'Go ; on recentre le marqueur sur la moitié est.
POI_XZ = {"mijote": (4.0, -57.0)}
# Point local à l'intérieur du bâtiment de CBA (le nœud OSM est ~34 m à côté, dans la rue) :
# le POI est posé au centroïde de ce bâtiment (rectangle ≈ 64 × 10 m, 16,1 m).
CBA_XZ = (-162.8, -12.7)
# Point local à l'intérieur du bâtiment parallèle à CBA (hauteur forcée = celle de CBA).
PARALLELE_XZ = (-175.7, 25.4)

MAJOR = {"motorway", "trunk", "primary", "secondary", "tertiary",
         "motorway_link", "trunk_link", "primary_link", "secondary_link"}
RESID = {"residential", "unclassified", "living_street"}
FOOT = {"footway", "path", "cycleway", "pedestrian", "steps", "track", "bridleway"}
DEFAULT_MARGE = 180.0
BUS_ROUTE_MIN_M = 150.0  # longueur minimale d'une ligne de bus après fusion des tronçons


# ── Réseau + cache ──────────────────────────────────────────────────────────

def _http(req: urllib.request.Request, retries: int = 1) -> bytes:
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 504) and attempt < retries:
                print(f"  HTTP {e.code}, nouvel essai dans 20 s…")
                time.sleep(20)
                continue
            raise
    raise RuntimeError("unreachable")


def load_ign(refresh: bool, offline: bool) -> dict:
    if IGN_CACHE.exists() and not refresh:
        print(f"IGN : cache {IGN_CACHE.relative_to(ROOT)}")
        return json.loads(IGN_CACHE.read_text(encoding="utf-8"))
    data = None
    if not offline:
        try:
            print("IGN : téléchargement WFS BD TOPO…")
            data = json.loads(_http(urllib.request.Request(IGN_URL, headers=UA)))
            if not data.get("features"):
                print("  0 objet renvoyé (BBOX en lat,lon ?) → secours")
                data = None
        except Exception as e:  # noqa: BLE001
            print(f"  échec ({e}) → secours")
    if data is None:
        src = SCRATCH / "ign_batiments2.json"
        if not src.exists():
            sys.exit("IGN indisponible et pas de fichier de secours")
        print(f"  SECOURS : copie de {src}")
        data = json.loads(src.read_text(encoding="utf-8"))
    IGN_CACHE.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"  {len(data['features'])} objets IGN mis en cache")
    return data


def load_osm(refresh: bool, offline: bool) -> dict:
    if OSM_CACHE.exists() and not refresh:
        print(f"OSM : cache {OSM_CACHE.relative_to(ROOT)}")
        return json.loads(OSM_CACHE.read_text(encoding="utf-8"))
    data = None
    if not offline:
        try:
            print("OSM : requête Overpass…")
            body = urllib.parse.urlencode({"data": OVERPASS_QL}).encode()
            data = json.loads(_http(urllib.request.Request(OVERPASS_URL, data=body, headers=UA)))
            if not data.get("elements"):
                print("  0 élément → secours")
                data = None
        except Exception as e:  # noqa: BLE001
            print(f"  échec ({e}) → secours")
    if data is None:
        src, bus = SCRATCH / "osm_ctx.json", SCRATCH / "osm_bus.json"
        if not src.exists():
            sys.exit("Overpass indisponible et pas de fichier de secours")
        print(f"  SECOURS : copie de {src} + arrêts de bus de {bus.name}")
        data = json.loads(src.read_text(encoding="utf-8"))
        if bus.exists():
            stops = [e for e in json.loads(bus.read_text(encoding="utf-8"))["elements"]
                     if e["type"] == "node" and e.get("tags", {}).get("highway") == "bus_stop"]
            data["elements"].extend(stops)
    OSM_CACHE.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"  {len(data['elements'])} éléments OSM mis en cache")
    return data


# ── Géométrie ───────────────────────────────────────────────────────────────

def pip(pt, ring) -> bool:
    x, y = pt
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-9) + x1:
            inside = not inside
    return inside


def plen(p) -> float:
    return sum(math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) for i in range(len(p) - 1))


def grow(b, m):
    return (b[0] - m, b[1] - m, b[2] + m, b[3] + m)


def inside(p, b) -> bool:
    return b[0] <= p[0] <= b[2] and b[1] <= p[1] <= b[3]


def dist_to_box(p, b) -> float:
    dx = max(b[0] - p[0], 0, p[0] - b[2])
    dz = max(b[1] - p[1], 0, p[1] - b[3])
    return math.hypot(dx, dz)


def _ccw(a, b, c) -> bool:
    return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])


def seg_hits_ring(p, q, ring) -> bool:
    """True si le segment p–q coupe une arête du polygone `ring`."""
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        if _ccw(p, a, b) != _ccw(q, a, b) and _ccw(p, q, a) != _ccw(p, q, b):
            return True
    return False


def parse_buildings(ign: dict) -> list[dict]:
    c0 = ign["features"][0]["geometry"]["coordinates"]
    while isinstance(c0[0], list):
        c0 = c0[0]
    latlon = abs(c0[0]) > 40  # premier nombre ≈ 43.9 → ordre lat,lon
    ll = (lambda c: (c[1], c[0])) if latlon else (lambda c: (c[0], c[1]))
    out = []
    for f in ign["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            outer = [ll(c) for c in poly[0]]
            if len(outer) < 4:
                continue
            cx = sum(p[0] for p in outer) / len(outer)
            cy = sum(p[1] for p in outer) / len(outer)
            h = f["properties"].get("hauteur") or 4.0
            ring = [xz(*p) for p in outer]
            if ring[0] == ring[-1]:
                ring = ring[:-1]
            b = {"h": round(float(h), 1), "r": ring, "c": xz(cx, cy)}
            holes = []
            for hole in poly[1:]:
                hr = [xz(*ll(c)) for c in hole]
                if hr[0] == hr[-1]:
                    hr = hr[:-1]
                if len(hr) >= 3:
                    holes.append(hr)
            if holes:
                b["holes"] = holes
            out.append(b)
    return out


def _key(pt) -> tuple[float, float]:
    return (round(pt[0], 1), round(pt[1], 1))


def merge_named_ways(ways: list[dict]) -> list[dict]:
    """Chaîne les tronçons OSM de même `name` par extrémités communes, pour obtenir des
    lignes de bus longues plutôt que des fragments de 30 m.

    1. Dédoublonnage : deux tronçons de même nom reliant les mêmes extrémités (chaussées
       séparées, un sens chacune) sont fusionnés en un seul tronçon à double sens.
    2. Chaînage : à une extrémité, on continue seulement s'il reste exactement un
       tronçon de même nom qui la touche (sinon carrefour ambigu → on s'arrête).
    Entrée : [{"name", "oneway", "p"}] ; sortie : [{"p", "oneway"}] (oneway si toutes
    les parties le sont)."""
    by_name: dict[str, list[dict]] = {}
    for w in ways:
        if w.get("name"):
            by_name.setdefault(w["name"], []).append(dict(w))
    out = []
    for name, group in by_name.items():
        # 1. dédoublonnage des chaussées séparées
        seen: dict[tuple, dict] = {}
        for w in group:
            ends = frozenset((_key(w["p"][0]), _key(w["p"][-1])))
            if ends in seen and abs(plen(seen[ends]["p"]) - plen(w["p"])) < 0.3 * max(plen(w["p"]), 1):
                seen[ends]["oneway"] = False
                continue
            seen[ends] = w
        parts = list(seen.values())
        # 2. chaînage
        touch: dict[tuple, set[int]] = {}
        for i, w in enumerate(parts):
            for pt in (w["p"][0], w["p"][-1]):
                touch.setdefault(_key(pt), set()).add(i)
        used = [False] * len(parts)
        for i, w in enumerate(parts):
            if used[i]:
                continue
            used[i] = True
            chain, oneway = list(w["p"]), [w["oneway"]]
            for end in ("tail", "head"):
                while True:
                    pt = chain[-1] if end == "tail" else chain[0]
                    cands = [j for j in touch.get(_key(pt), ()) if not used[j]]
                    if len(cands) != 1:
                        break
                    j = cands[0]
                    used[j] = True
                    oneway.append(parts[j]["oneway"])
                    q = parts[j]["p"]
                    if end == "tail":
                        chain += (q[1:] if _key(q[0]) == _key(pt) else list(reversed(q))[1:])
                    else:
                        chain = (q[:-1] if _key(q[-1]) == _key(pt) else list(reversed(q))[:-1]) + chain
            out.append({"p": chain, "oneway": all(oneway)})
    return out


def building_at(buildings: list[dict], pt) -> tuple[int, float]:
    """Index du bâtiment contenant `pt`, sinon celui au centroïde le plus proche."""
    best, bd = None, 1e9
    for i, b in enumerate(buildings):
        if pip(pt, b["r"]):
            return i, 0.0
        d = math.hypot(b["c"][0] - pt[0], b["c"][1] - pt[1])
        if d < bd:
            best, bd = i, d
    return best, bd


# ── Construction ────────────────────────────────────────────────────────────

def build(marge: float, refresh: bool, offline: bool) -> dict:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ign = load_ign(refresh, offline)
    osm = load_osm(refresh, offline)

    B = parse_buildings(ign)
    print(f"{len(B)} bâtiments IGN parsés")

    # POI → bâtiment (jeu complet)
    pois = [dict(p) for p in POIS]
    for p in pois:
        if p["type"] == "truck":
            p["x"], p["z"] = TRUCK_XZ
            p["lon"], p["lat"] = lonlat(*TRUCK_XZ)
            continue
        p["x"], p["z"] = xz(p["lon"], p["lat"])
        if p["id"] in POI_XZ:
            p["x"], p["z"] = POI_XZ[p["id"]]
            p["lon"], p["lat"] = lonlat(*POI_XZ[p["id"]])
        if p["id"] == "cba":
            bi, d = building_at(B, CBA_XZ)
            p["x"], p["z"] = B[bi]["c"]
            p["lon"], p["lat"] = lonlat(p["x"], p["z"])
            p["b"] = bi
        else:
            p["b"], d = building_at(B, (p["x"], p["z"]))
        p["bh"] = B[p["b"]]["h"]
        print(f"  POI {p['id']:8s} ({p['x']:7.1f}, {p['z']:7.1f}) → bât. #{p['b']} h={p['bh']} "
              f"{'(contenu)' if d == 0 else f'(plus proche, {d:.1f} m)'}")
    cba = next(p for p in pois if p["id"] == "cba")
    truck = next(p for p in pois if p["id"] == "truck")
    truck["b"], truck["bh"] = cba["b"], cba["bh"]

    basilic = next(p for p in pois if p["id"] == "basilic")
    mijote = next(p for p in pois if p["id"] == "mijote")
    if basilic["b"] != mijote["b"]:
        print(f"  ATTENTION : Basilic n'Go (#{basilic['b']}) et La Mijote (#{mijote['b']}) "
              "ne partagent pas le même bâtiment (la spec l'attendait)")
    else:
        print(f"  Basilic n'Go et La Mijote partagent le bâtiment #{basilic['b']} (étiquettes décalées côté scene.ts)")

    # Hauteur du bâtiment parallèle à CBA
    par_i, par_d = building_at(B, PARALLELE_XZ)
    cba_b = B[cba["b"]]
    print(f"  CBA = bât. #{cba['b']} h={cba_b['h']} ; parallèle = bât. #{par_i} h={B[par_i]['h']} "
          f"{'(contenu)' if par_d == 0 else f'(plus proche, {par_d:.1f} m)'}")
    B[par_i]["h"] = cba_b["h"]
    print(f"  → parallèle forcé à h={B[par_i]['h']}")

    # Sélection par distance à la boîte des POI
    xs = [p["x"] for p in pois]
    zs = [p["z"] for p in pois]
    poi_box = (min(xs), min(zs), max(xs), max(zs))
    must = {p["b"] for p in pois if "b" in p} | {par_i}
    keep = sorted({i for i, b in enumerate(B) if dist_to_box(b["c"], poi_box) <= marge} | must)
    remap = {old: new for new, old in enumerate(keep)}
    buildings = [B[i] for i in keep]
    for p in pois:
        p["b"] = remap[p["b"]]
    print(f"{len(buildings)} bâtiments gardés (marge {marge:g} m autour de la boîte des POI "
          f"{tuple(round(v, 1) for v in poi_box)})")

    bx = [q[0] for b in buildings for q in b["r"]]
    bz = [q[1] for b in buildings for q in b["r"]]
    box = (min(bx), min(bz), max(bx), max(bz))
    TREE_BOX, ROAD_BOX, PARK_BOX = grow(box, 55), grow(box, 160), grow(box, 45)

    # OSM
    roads, routes, bus_stops = [], [], []
    major_ways = []  # tronçons classe M nommés, fusionnés ensuite en lignes de bus
    trees, parkings, water, wlines = [], [], [], []
    for e in osm["elements"]:
        t = e.get("tags", {})
        if e["type"] == "node":
            if "lon" not in e:
                continue
            q = xz(e["lon"], e["lat"])
            if t.get("natural") == "tree" and inside(q, TREE_BOX):
                trees.append(q)
            elif t.get("highway") == "bus_stop" and inside(q, ROAD_BOX):
                bus_stops.append(q)
            continue
        if e["type"] != "way" or "geometry" not in e:
            continue
        pts = [xz(p["lon"], p["lat"]) for p in e["geometry"]]
        if "highway" in t:
            if not any(inside(q, ROAD_BOX) for q in pts):
                continue
            hw = t["highway"]
            c = "M" if hw in MAJOR else "R" if hw in RESID else "F" if hw in FOOT else "S"
            roads.append({"c": c, "p": pts})
            if c in ("M", "R") and plen(pts) > 70:
                routes.append({"p": pts, "oneway": t.get("oneway") == "yes"})
            if c == "M":
                major_ways.append({"name": t.get("name"), "oneway": t.get("oneway") == "yes", "p": pts})
        elif t.get("amenity") == "parking":
            if any(inside(q, PARK_BOX) for q in pts):
                parkings.append(pts)
        elif t.get("natural") == "water":
            water.append(pts)
        elif "waterway" in t:
            wlines.append(pts)
    bus_routes = [r for r in merge_named_ways(major_ways) if plen(r["p"]) > BUS_ROUTE_MIN_M]
    print(f"voirie {len(roads)} · routes voitures {len(routes)} · routes bus {len(bus_routes)} · "
          f"arrêts {len(bus_stops)} · arbres {len(trees)} · parkings {len(parkings)} · "
          f"eau {len(water)}+{len(wlines)}")

    # Voie d'arrivée du truck : route carrossable la plus proche du stationnement dont
    # l'approche en ligne droite ne traverse aucun bâtiment (sinon le truck passerait
    # au travers de CBA ; le parking est entre deux bâtiments, l'accès se fait par le bout).
    best = None
    for r in roads:
        if r["c"] == "F":
            continue
        for i in range(len(r["p"]) - 1):
            a, b = r["p"][i], r["p"][i + 1]
            dx, dz = b[0] - a[0], b[1] - a[1]
            L = dx * dx + dz * dz or 1e-9
            u = max(0.0, min(1.0, ((TRUCK_XZ[0] - a[0]) * dx + (TRUCK_XZ[1] - a[1]) * dz) / L))
            q = (a[0] + u * dx, a[1] + u * dz)
            d = math.hypot(q[0] - TRUCK_XZ[0], q[1] - TRUCK_XZ[1])
            if (best is None or d < best[0]) and not any(seg_hits_ring(q, TRUCK_XZ, bb["r"]) for bb in buildings):
                best = (d, r)
    print(f"truck ({TRUCK_XZ[0]:g}, {TRUCK_XZ[1]:g}) : voie d'arrivée classe {best[1]['c']} "
          f"à {best[0]:.1f} m, {len(best[1]['p'])} points")

    return {
        "center": [LON0, LAT0],
        "buildings": buildings,
        "roads": roads,
        "routes": routes,
        "busRoutes": bus_routes,
        "busStops": bus_stops,
        "trees": trees,
        "parkings": parkings,
        "water": water,
        "wlines": wlines,
        "pois": pois,
        "truckRoad": best[1]["p"],
        "focus": [round((box[0] + box[2]) / 2, 1), round((box[1] + box[3]) / 2, 1)],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--marge", type=float, default=DEFAULT_MARGE,
                    help=f"distance max (m) du centroïde à la boîte des POI (défaut {DEFAULT_MARGE:g})")
    ap.add_argument("--refresh", action="store_true", help="re-télécharge IGN et OSM (ignore le cache)")
    ap.add_argument("--offline", action="store_true", help="n'accède jamais au réseau (cache ou secours)")
    ap.add_argument("--out", type=Path, default=OUTPUT, help="fichier de sortie")
    args = ap.parse_args()

    scene = build(args.marge, args.refresh, args.offline)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(scene, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"→ {args.out.relative_to(ROOT) if args.out.is_relative_to(ROOT) else args.out} "
          f"({args.out.stat().st_size / 1024:.0f} Ko)")


if __name__ == "__main__":
    main()
