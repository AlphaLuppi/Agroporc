"use client";

import { memo } from "react";
import { formatKills, libelleEnVie } from "@/lib/fps/hud-modele";
import type { PhaseBr } from "@/lib/fps/protocole";
import styles from "../HudArene.module.css";

/**
 * Barre du Battle Royale (haut centre, à la place de `BarreMatch`) : « 37 EN VIE » en grand, mes éliminations, puis le palier de la tempête
 * (« PALIER 2/6 ») ou, avant que la zone existe, « LARGAGE ». Ne reçoit que des scalaires : seul un changement de ces valeurs la rend.
 * Les minuteurs de la zone battent dans `BlocZone`, pas ici.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (« Interface », HUD)
 */
export interface PropsBarreBR {
  phase: PhaseBr;
  /** joueurs encore en vie et partants */
  vivants: number;
  total: number;
  /** mes éliminations */
  kills: number;
  /** palier de la tempête en cours (0 = pas de zone) */
  palier: number;
  nbPaliers: number;
}

function BarreBRBrute({ phase, vivants, total, kills, palier, nbPaliers }: PropsBarreBR) {
  const etape = palier > 0 ? `PALIER ${palier}/${nbPaliers}` : phase === "vol" || phase === "decompte" ? "LARGAGE" : "";
  return (
    <section className={`${styles.plaque} ${styles.barreBr}`} data-phase={phase} aria-label="Battle Royale">
      <b className={styles.brVivants}>{libelleEnVie(vivants)}</b>
      <span className={styles.brDetail}>
        <span className={styles.brKills} aria-label={`${kills} élimination${kills > 1 ? "s" : ""}`}>{formatKills(kills)}</span>
        {total > 0 && <span className={styles.brTotal}>{total} partants</span>}
        {etape && <span className={styles.brPalier}>{etape}</span>}
      </span>
    </section>
  );
}

const BarreBR = memo(BarreBRBrute);
export default BarreBR;
