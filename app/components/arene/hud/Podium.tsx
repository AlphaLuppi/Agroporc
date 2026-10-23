"use client";

import type { CSSProperties } from "react";
import { formaterNombre, hauteurMarche, ordinal, ratioKD, type PlacePodium } from "@/lib/fps/classement";
import styles from "./FinDeMatch.module.css";

/**
 * Podium (§10) : 1er au centre, 2e à gauche, 3e à droite (l'ordre du DOM reste 1, 2, 3 pour les lecteurs d'écran, la disposition
 * est faite en CSS), hauteurs 100 / 78 / 62 %, montée en cascade 3 → 2 → 1 en 1,2 s au total (d'un coup en mouvement réduit).
 * Moins de trois joueurs : seules les places occupées sont dessinées ; ex aequo : même rang, même hauteur.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 */
export interface PropsPodium {
  /** sortie de `podium(lignes)` */
  places: readonly PlacePodium[];
  moiId: string | null;
}

export default function Podium({ places, moiId }: PropsPodium) {
  if (places.length === 0) return null;
  const n = places.length;
  return (
    <ol className={styles.podium} aria-label="Podium">
      {places.map(({ ligne: l, rang }, i) => (
        <li
          key={l.id}
          className={styles.marche}
          data-position={i + 1}
          data-premier={rang === 1 ? "oui" : "non"}
          data-moi={l.id === moiId ? "oui" : "non"}
          style={{ "--hauteur": hauteurMarche(rang), "--delai": `${(n - 1 - i) * 0.4}s` } as CSSProperties}
        >
          <span className={styles.rang}>{ordinal(rang)}</span>
          <span className={styles.joueur}>
            <span className={styles.pastille} style={{ background: l.couleur }} aria-hidden="true" />
            <span className={styles.pseudo}>{l.pseudo}</span>
          </span>
          <span className={styles.score}>{formaterNombre(l.kills)} K · {formaterNombre(l.morts)} M</span>
          <span className={styles.detail}>K/D {ratioKD(l)}</span>
          {l.id === moiId && <span className={styles.etiquette}>Vous</span>}
        </li>
      ))}
    </ol>
  );
}
