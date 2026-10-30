#!/usr/bin/env python3
"""Génère `public/agroparc/decor.json`, les détails de décor OpenStreetMap de la vue Palantir (issue #83).

`scene.json` n'est PAS touché : l'ordre de ses 142 bâtiments pilote les indices des zombies, du Battle Royale et des cachettes du tigre.
Ce fichier additif porte ce que `scene.json` ne garde pas : pelouses, haies, alignements d'arbres, bois, lampadaires, passages piétons,
stops, cédez-le-passage, feux, bancs, corbeilles, racks à vélos, portails. Format : `DecorOsm` de `lib/agroparc3d/types.ts`.

Même repère local que `build_scene.py` (origine lon0/lat0, 1 unité = 1 m, x est, z sud, coordonnées à 0,1 m). Même boîte que les arbres
de `scene.json` : bornes des bâtiments + 55 m. Aucune essence d'arbre n'est documentée dans OSM : le rendu choisit les types par règles.

Relancer (à la main, jamais dans la chaîne de build) :
    python3 scripts/agroparc/build_decor.py             # utilise le cache s'il existe
    python3 scripts/agroparc/build_decor.py --refresh   # re-télécharge OSM
    python3 scripts/agroparc/build_decor.py --offline   # n'accède jamais au réseau
Stdlib uniquement.
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
OSM_CACHE = CACHE_DIR / "osm_decor.json"
SCENE = ROOT / "public" / "agroparc" / "scene.json"
OUTPUT = ROOT / "public" / "agroparc" / "decor.json"

LON0, LAT0 = 4.8885, 43.9160
MX = 111320 * math.cos(math.radians(LAT0))
MY = 111132
MARGE_BOITE = 55.0  # m autour des bâtiments de scene.json (TREE_BOX de build_scene.py)
SIMPLIFICATION = 0.3  # m, Douglas-Peucker des anneaux et des lignes

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
B = "(43.911,4.880,43.921,4.896)"
OVERPASS_QL = f"""[out:json][timeout:60];
( node["highway"~"crossing|street_lamp|traffic_signals|stop|give_way"]{B};
  node["amenity"~"bench|waste_basket|bicycle_parking"]{B};
  node["barrier"~"gate|swing_gate"]{B};
  way["barrier"="hedge"]{B};
  way["landuse"~"grass|meadow"]{B};
  way["leisure"~"park|garden"]{B};
  way["natural"~"wood|tree_row|scrub"]{B};
  way["landuse"="forest"]{B};
); out geom;
"""
UA = {"User-Agent": "pdj-agroparc-decor/1.0 (github.com/AlphaLuppi/Agroporc)"}


def xz(lon: float, lat: float) -> list[float]:
    return [round((lon - LON0) * MX, 1), round(-(lat - LAT0) * MY, 1)]


def charger_osm(refresh: bool, offline: bool) -> dict:
    if OSM_CACHE.exists() and not refresh:
        print(f"OSM : cache {OSM_CACHE.relative_to(ROOT)}")
        return json.loads(OSM_CACHE.read_text(encoding="utf-8"))
    if offline:
        sys.exit("pas de cache OSM et --offline")
    print("OSM : requête Overpass…")
    corps = urllib.parse.urlencode({"data": OVERPASS_QL}).encode()
    data = None
    for essai in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(OVERPASS_URL, data=corps, headers=UA), timeout=120) as r:
                data = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 504) and essai < 2:
                print(f"  HTTP {e.code}, nouvel essai dans 20 s…")
                time.sleep(20)
                continue
            raise
    if not data or not data.get("elements"):
        sys.exit("Overpass : 0 élément")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    OSM_CACHE.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"  {len(data['elements'])} éléments mis en cache")
    return data


def dans_boite(p, b) -> bool:
    return b[0] <= p[0] <= b[2] and b[1] <= p[1] <= b[3]


def douglas_peucker(pts: list, eps: float) -> list:
    """Simplification d'une polyligne (les extrémités sont gardées)."""
    if len(pts) < 3:
        return pts
    garde = [False] * len(pts)
    garde[0] = garde[-1] = True
    pile = [(0, len(pts) - 1)]
    while pile:
        i, j = pile.pop()
        ax, az = pts[i]
        bx, bz = pts[j]
        ux, uz = bx - ax, bz - az
        l2 = ux * ux + uz * uz
        dmax, kmax = 0.0, -1
        for k in range(i + 1, j):
            px, pz = pts[k]
            if l2 == 0:
                d = math.hypot(px - ax, pz - az)
            else:
                t = max(0.0, min(1.0, ((px - ax) * ux + (pz - az) * uz) / l2))
                d = math.hypot(px - ax - t * ux, pz - az - t * uz)
            if d > dmax:
                dmax, kmax = d, k
        if dmax > eps and kmax >= 0:
            garde[kmax] = True
            pile.append((i, kmax))
            pile.append((kmax, j))
    return [p for p, g in zip(pts, garde) if g]


def anneau(pts: list) -> list:
    """Anneau non fermé, simplifié ; [] s'il dégénère."""
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    s = douglas_peucker(pts + [pts[0]], SIMPLIFICATION)[:-1] if len(pts) > 2 else pts
    return s if len(s) >= 3 else []


def build(refresh: bool, offline: bool) -> dict:
    scene = json.loads(SCENE.read_text(encoding="utf-8"))
    xs = [q[0] for b in scene["buildings"] for q in b["r"]]
    zs = [q[1] for b in scene["buildings"] for q in b["r"]]
    boite = (min(xs) - MARGE_BOITE, min(zs) - MARGE_BOITE, max(xs) + MARGE_BOITE, max(zs) + MARGE_BOITE)
    osm = charger_osm(refresh, offline)

    pelouses, bois, haies, alignements = [], [], [], []
    points = {k: [] for k in ("lampadaires", "passages", "stops", "cedez", "signaux", "bancs", "corbeilles", "velos", "portails")}
    for e in osm["elements"]:
        t = e.get("tags", {})
        if e["type"] == "node":
            if "lon" not in e:
                continue
            q = xz(e["lon"], e["lat"])
            if not dans_boite(q, boite):
                continue
            hw, am, ba = t.get("highway"), t.get("amenity"), t.get("barrier")
            if hw == "street_lamp":
                points["lampadaires"].append(q)
            elif hw == "crossing":
                points["passages"].append(q)
            elif hw == "stop":
                points["stops"].append(q)
            elif hw == "give_way":
                points["cedez"].append(q)
            elif hw == "traffic_signals":
                points["signaux"].append(q)
            elif am == "bench":
                points["bancs"].append(q)
            elif am == "waste_basket":
                points["corbeilles"].append(q)
            elif am == "bicycle_parking":
                points["velos"].append(q)
            elif ba in ("gate", "swing_gate"):
                points["portails"].append(q)
            continue
        if e["type"] != "way" or "geometry" not in e:
            continue
        pts = [xz(p["lon"], p["lat"]) for p in e["geometry"]]
        if not any(dans_boite(q, boite) for q in pts):
            continue
        if t.get("barrier") == "hedge":
            ligne = douglas_peucker(pts, SIMPLIFICATION)
            if len(ligne) >= 2:
                haies.append(ligne)
        elif t.get("natural") == "tree_row":
            ligne = douglas_peucker(pts, SIMPLIFICATION)
            if len(ligne) >= 2:
                alignements.append(ligne)
        elif t.get("natural") in ("wood", "scrub") or t.get("landuse") == "forest":
            a = anneau(pts)
            if a:
                bois.append(a)
        else:
            genre = t.get("landuse") or t.get("leisure")
            k = {"grass": "grass", "meadow": "meadow", "park": "park", "garden": "garden"}.get(genre)
            if k:
                a = anneau(pts)
                if a:
                    pelouses.append({"k": k, "r": a})

    # tableaux triés : fichier stable d'une exécution à l'autre
    cle = lambda p: (p[0], p[1])  # noqa: E731
    for k in points:
        points[k].sort(key=cle)
    pelouses.sort(key=lambda p: (p["k"], cle(p["r"][0])))
    bois.sort(key=lambda r: cle(r[0]))
    haies.sort(key=lambda r: cle(r[0]))
    alignements.sort(key=lambda r: cle(r[0]))
    out = {"v": 1, "pelouses": pelouses, "bois": bois, "haies": haies, "alignements": alignements, **points}
    print(" · ".join(f"{k} {len(v)}" for k, v in out.items() if isinstance(v, list)))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="re-télécharge OSM (ignore le cache)")
    ap.add_argument("--offline", action="store_true", help="n'accède jamais au réseau")
    ap.add_argument("--out", type=Path, default=OUTPUT, help="fichier de sortie")
    args = ap.parse_args()
    decor = build(args.refresh, args.offline)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(decor, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"→ {args.out} ({args.out.stat().st_size / 1024:.0f} Ko)")


if __name__ == "__main__":
    main()
