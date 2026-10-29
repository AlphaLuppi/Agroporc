"use client";

import { memo, type RefObject } from "react";
import { BR } from "@/lib/fps/br-regles";
import styles from "../HudArene.module.css";

/**
 * Inventaire de soins du Battle Royale (bas-gauche, au-dessus de la vie) : bandages et potions de bouclier avec leur touche RÉELLE (« [H] BANDAGE ×3 »),
 * ce que chacun rend, la touche pour lâcher l'arme en main, et, pendant un usage, la barre d'avancement (variable CSS `--usage` écrite hors React par
 * `useProgressionUsage`). Les armes sont dans le bloc d'armes. Ne reçoit que des scalaires.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (« Inventaire », « Interface »)
 */
export interface PropsBlocInventaire {
  bandage: number;
  potion: number;
  /** soin en cours d'usage ("" = aucun) */
  usage: "" | "bandage" | "potion";
  /** touches réellement assignées, vides si aucune */
  toucheBandage: string;
  touchePotion: string;
  toucheLacher: string;
  /** barre d'usage : sa variable `--usage` et son `aria-valuenow` sont écrits en rAF */
  refUsage: RefObject<HTMLDivElement | null>;
}

const NOMS = { bandage: "Bandage", potion: "Potion" } as const;

function BlocInventaireBrut({ bandage, potion, usage, toucheBandage, touchePotion, toucheLacher, refUsage }: PropsBlocInventaire) {
  const ligne = (objet: "bandage" | "potion", n: number, touche: string, detail: string) => (
    <li className={styles.invLigne} data-vide={n === 0 ? "oui" : "non"} data-usage={usage === objet ? "oui" : "non"}>
      <span className={styles.invTouche}>{touche ? `[${touche}]` : ""}</span>
      <span className={styles.invNom}>{NOMS[objet].toUpperCase()}</span>
      <b className={styles.invQte}>×{n}</b>
      <span className={styles.invDetail}>{detail}</span>
    </li>
  );
  return (
    <section className={`${styles.plaque} ${styles.inventaire}`} aria-label="Soins">
      <ul className={styles.invListe} aria-label="Soins en stock">
        {ligne("bandage", bandage, toucheBandage, `+${BR.usage.bandage.pv} PV · ${BR.usage.bandage.ms / 1000} s · sous ${BR.usage.bandage.plafondPv} PV`)}
        {ligne("potion", potion, touchePotion, `+${BR.usage.potion.bouclier} bouclier · ${BR.usage.potion.ms / 1000} s`)}
      </ul>
      {usage && (
        <div className={styles.invUsage}>
          <p className={styles.invUsageTexte} role="status">{usage === "bandage" ? "Bandage en cours…" : "Potion de bouclier en cours…"}</p>
          <div ref={refUsage} className={styles.invBarre} role="progressbar" aria-label="Avancement du soin" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
            <i />
          </div>
        </div>
      )}
      {toucheLacher && <p className={styles.invLacher}><kbd>{toucheLacher}</kbd> lâcher l&apos;arme en main</p>}
    </section>
  );
}

const BlocInventaire = memo(BlocInventaireBrut);
export default BlocInventaire;
