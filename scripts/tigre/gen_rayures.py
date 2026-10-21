"""Génère public/textures/tigre.svg : rayures de tigre tuilables (thème Tigre).

Les rayures suivent un même « flux » ondulé (comme sur le flanc d'un tigre) :
chaque colonne est coupée en segments effilés aux deux bouts, aux bords
légèrement irréguliers, parfois doublés ou fourchus. Le flux est périodique
en x et en y et les formes qui débordent sont répétées sur le bord opposé :
la tuile se raccorde sans couture. Graine fixe : sortie stable.

    python scripts/tigre/gen_rayures.py
"""
import math
import random
from pathlib import Path

W, H = 720, 720
COLONNES = 10
GRAINE = 11
SORTIE = Path(__file__).resolve().parents[2] / "public" / "textures" / "tigre.svg"


def flux(x, y):
    """Décalage horizontal du flux en (x, y) : périodique sur la tuile."""
    return (26 * math.sin(2 * math.pi * y / H + 2 * math.pi * x / W)
            + 10 * math.sin(4 * math.pi * y / H - 2 * math.pi * x / W))


def fuseau(rng, centre, epaisseur, n=22):
    """Polygone d'une rayure le long de `centre(t)` (t ∈ [0, 1]) : ventre
    épais décentré, pointes fines, bords au bruit indépendant."""
    bruit = [(rng.uniform(0.03, 0.09), rng.uniform(1.5, 3.5), rng.uniform(0, math.tau)) for _ in range(4)]
    ventre = rng.uniform(0.3, 0.6)
    gauche, droite = [], []
    for i in range(n + 1):
        t = i / n
        (cx, cy), (ax, ay) = centre(t), centre(min(1, t + 0.01))
        if t >= 1:
            (bx, by) = centre(0.99)
            ax, ay = cx + (cx - bx), cy + (cy - by)
        lg = math.hypot(ax - cx, ay - cy) or 1
        nx, ny = (ay - cy) / lg, -(ax - cx) / lg
        u = t / ventre * 0.5 if t < ventre else 0.5 + (t - ventre) / (1 - ventre) * 0.5
        w = epaisseur * math.sin(math.pi * u) ** 1.1
        bg = 1 + sum(a * math.sin(f * math.pi * t + ph) for a, f, ph in bruit[:2])
        bd = 1 + sum(a * math.sin(f * math.pi * t + ph) for a, f, ph in bruit[2:])
        gauche.append((cx + nx * w / 2 * bg, cy + ny * w / 2 * bg))
        droite.append((cx - nx * w / 2 * bd, cy - ny * w / 2 * bd))
    return gauche + droite[::-1]


def chemin(points):
    """Courbe fermée lissée (Catmull-Rom → Bézier cubiques)."""
    n = len(points)
    d = f"M{points[0][0]:.0f} {points[0][1]:.0f}"
    for i in range(n):
        p0, p1, p2, p3 = (points[(i + k) % n] for k in (-1, 0, 1, 2))
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f"C{c1[0]:.0f} {c1[1]:.0f} {c2[0]:.0f} {c2[1]:.0f} {p2[0]:.0f} {p2[1]:.0f}"
    return d + "Z"


def segment(x0, y0, longueur, derive=0.0):
    """Centre d'un segment vertical qui suit le flux (+ dérive latérale)."""
    return lambda t: (x0 + flux(x0, y0 + longueur * t) + derive * math.sin(math.pi * t),
                      y0 + longueur * t)


def rayures(rng):
    formes = []
    pas = W / COLONNES
    for c in range(COLONNES):
        x = c * pas + rng.uniform(-6, 6)
        y = rng.uniform(0, H)
        fin = y + H
        while True:
            longueur = rng.uniform(200, 380)
            ecart = rng.uniform(26, 70)
            if y + longueur > fin - ecart:
                longueur = fin - ecart - y
                if longueur < 90:
                    break
            ep = rng.uniform(20, 34)
            formes.append(fuseau(rng, segment(x, y, longueur, rng.uniform(-10, 10)), ep))
            if rng.random() < 0.3:  # rayure doublée, plus fine et plus courte
                d = rng.choice((-1, 1)) * (ep * 0.5 + rng.uniform(9, 13))
                l2 = longueur * rng.uniform(0.45, 0.7)
                y2 = y + rng.uniform(0.1, 0.4) * longueur
                formes.append(fuseau(rng, segment(x + d, y2, l2), ep * 0.55))
            elif rng.random() < 0.3:  # fourche : branche courte qui s'écarte
                t0 = rng.uniform(0.25, 0.5)
                bx, by = segment(x, y, longueur)(t0)
                cote = rng.choice((-1, 1))
                l2 = longueur * rng.uniform(0.3, 0.42)
                formes.append(fuseau(rng, lambda t, bx=bx, by=by, l2=l2, cote=cote:
                                     (bx + cote * l2 * 0.28 * t ** 1.3, by + l2 * t), ep * 0.5))
            y += longueur + ecart
    return formes


def main():
    rng = random.Random(GRAINE)
    paths = []
    for pts in rayures(rng):
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        for ox in (-W, 0, W):
            for oy in (-H, 0, H):
                if max(xs) + ox < 0 or min(xs) + ox > W or max(ys) + oy < 0 or min(ys) + oy > H:
                    continue
                paths.append(chemin([(px + ox, py + oy) for px, py in pts]))
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
        f'<path fill="#0a0400" d="{"".join(paths)}"/></svg>\n'
    )
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(svg)
    print(f"{SORTIE} : {len(paths)} formes, {len(svg) // 1024} Ko")


if __name__ == "__main__":
    main()
