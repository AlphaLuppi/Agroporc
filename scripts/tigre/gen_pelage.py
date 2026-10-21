"""Génère public/textures/tigre.webp : pelage de tigre tuilable (thème Tigre).

Rayures = onde triangulaire verticale dont la phase est déformée par un bruit fractal,
seuillé par un second bruit : là où le seuil monte, la rayure s'amincit,
s'effile puis se coupe ; là où il descend, deux rayures voisines se
rejoignent (fourches, ponts). Un bruit fin rend les bords dentelés. Tous les
bruits sont des sommes de sinus à fréquences entières sur la tuile : le
motif se raccorde sans couture. Graine fixe : sortie stable.

Dépendances : numpy, Pillow (venv du pipeline).

    plats-du-jour/.venv/bin/python scripts/tigre/gen_pelage.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

TAILLE = 1024          # tuile carrée, en pixels
SURECH = 2             # suréchantillonnage (anticrénelage)
RAYURES = 7           # rayures par tuile (entier : périodicité)
GRAINE = 5
FAUVE = (204, 104, 18)
NOIR = (16, 8, 3)
SORTIE = Path(__file__).resolve().parents[2] / "public" / "textures" / "tigre.webp"


def bruit(rng, u, v, kx_max, ky_max, kmin, pente, n=48):
    """Bruit périodique sur la tuile ([0,1[²) : somme de sinus à vecteurs
    d'onde entiers (|kx| ≤ kx_max, |ky| ≤ ky_max, |k| ≥ kmin), amplitude
    ∝ |k|^-pente, normalisé dans [-1, 1]."""
    acc = np.zeros_like(u)
    for _ in range(n):
        while True:
            kx = int(rng.integers(-kx_max, kx_max + 1))
            ky = int(rng.integers(-ky_max, ky_max + 1))
            k = np.hypot(kx, ky)
            if k >= kmin:
                break
        acc += k ** -pente * np.sin(2 * np.pi * (kx * u + ky * v) + rng.uniform(0, 2 * np.pi))
    return acc / np.abs(acc).max()


def plancher(x, bas, douceur=12.0):
    """max(x, bas) sans arête (softplus) : pas de bord rectiligne là où il mord."""
    return bas + np.logaddexp(0, douceur * (x - bas)) / douceur


def main():
    rng = np.random.default_rng(GRAINE)
    n = TAILLE * SURECH
    v, u = np.mgrid[0:n, 0:n] / n

    # Phase : rayures verticales courbées en chevrons (déformation surtout
    # selon y) + ondulations moyennes qui rapprochent ou écartent les voisines.
    phase = (2 * np.pi * RAYURES * u
             + 3.2 * bruit(rng, u, v, 1, 2, 1, 1.0)
             + 1.6 * bruit(rng, u, v, 3, 5, 2, 1.0))
    # Onde triangulaire (sommet en pointe) : une rayure qui s'amincit
    # finit en aiguille, pas en goutte.
    s = 2 / np.pi * np.arcsin(np.sin(phase))
    # Seuil : varie vite le long d'une rayure (cassures, pointes effilées),
    # lentement d'une rayure à l'autre ; bas par endroits (ponts, fourches),
    # borné en douceur pour que deux rayures ne fusionnent jamais sur une grande surface.
    seuil = plancher(0.55
                     + 0.95 * bruit(rng, u, v, 4, 4, 2, 0.6)
                     + 0.25 * bruit(rng, u, v, 10, 5, 5, 0.5), -0.05)
    # Dentelure : flammèches sur les bords, allongées dans le sens du poil.
    dent = 0.06 * bruit(rng, u, v, 40, 6, 14, 0.2, n=160)
    # Poil : stries fines verticales, partagées par la couleur et les bords
    # des rayures (qui s'effrangent dans le sens du pelage).
    poil = bruit(rng, u, v, 220, 10, 60, 0.0, n=200)
    champ = s - seuil + dent + 0.09 * poil

    # Bord net partout (distance au bord ≈ champ / |gradient|), anticrénelé
    # sur ~1 px de sortie ; périodique comme le reste.
    gy = (np.roll(champ, -1, 0) - np.roll(champ, 1, 0)) / 2
    gx = (np.roll(champ, -1, 1) - np.roll(champ, 1, 1)) / 2
    distance = champ / np.maximum(np.hypot(gx, gy), 1e-6)
    alpha = np.clip(distance / SURECH + 0.5, 0, 1)[..., None]

    # Fourrure : fauve aux nuances lentes, grain de poils dans le sens du
    # pelage (stries fines verticales), rayures brun-noir à peine moirées.
    nuance = bruit(rng, u, v, 3, 3, 1, 0.8)[..., None]
    poil = poil[..., None]
    fauve = np.array(FAUVE) * (1 + 0.10 * nuance + 0.07 * poil)
    noir = np.array(NOIR) * (1 + 0.5 * poil)
    rgb = fauve * (1 - alpha) + noir * alpha
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").resize((TAILLE, TAILLE), Image.LANCZOS)
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    img.save(SORTIE, "WEBP", quality=78, method=6)
    couverture = float((alpha > 0.5).mean())
    print(f"{SORTIE} : {SORTIE.stat().st_size // 1024} Ko, rayures sur {couverture:.0%} de la surface")


if __name__ == "__main__":
    main()
