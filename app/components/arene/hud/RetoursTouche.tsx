"use client";

import { memo } from "react";
import type { ChiffreDegats } from "@/lib/fps/degats-cumul";
import { formatNombre } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Retours de combat autour du viseur (§6.1), tous CONFIRMÉS par le serveur (événement `confirme`) : marqueur de touche (quatre barres,
 * plus grandes et dorées à la tête), chiffre de dégâts cumulé et X de kill. Trois codages distinguables sans la couleur :
 * tête = « ◎ » devant et chiffre souligné ; absorbé par le bouclier = crochets `[34]` ; dégâts aux PV = `−34`.
 * Décoratif (`aria-hidden`) : l'élimination est annoncée par le fil et la région vive.
 */
export interface MarqueurTouche { id: number; tete: boolean }
export interface PropsRetoursTouche {
  chiffres: readonly ChiffreDegats[];
  marqueur: MarqueurTouche | null;
  /** id du dernier kill (relance l'animation du X) ; null = aucun */
  kill: number | null;
}

/** Texte d'un chiffre : `◎ [34]`, `[34]`, `◎ −34`, `−34`. */
export function texteChiffre(c: Pick<ChiffreDegats, "degats" | "tete" | "bouclier">): string {
  const n = formatNombre(c.degats);
  return `${c.tete ? "◎ " : ""}${c.bouclier ? `[${n}]` : `−${n}`}`;
}

function RetoursToucheBrut({ chiffres, marqueur, kill }: PropsRetoursTouche) {
  return (
    <div className={styles.retours} aria-hidden="true">
      {marqueur && (
        <div key={marqueur.id} className={`${styles.marqueur} ${marqueur.tete ? styles.marqueurTete : ""}`}>
          <i /><i /><i /><i />
        </div>
      )}
      {kill !== null && (
        <div key={kill} className={styles.killX}>
          <i /><i />
          <b className={styles.plusUn}>+1</b>
        </div>
      )}
      {chiffres.map((c, i) => (
        <span
          key={`${c.id}-${c.nb}`}
          className={`${styles.chiffre} ${c.tete ? styles.chiffreTete : c.bouclier ? styles.chiffreBouclier : styles.chiffrePv}`}
          style={{ ["--rang" as string]: i }}
        >
          {texteChiffre(c)}
        </span>
      ))}
    </div>
  );
}

const RetoursTouche = memo(RetoursToucheBrut);
export default RetoursTouche;
