"use client";

import { memo, type RefObject } from "react";
import { COUTEAU, STATS, nomArme } from "@/lib/fps/armes";
import { formatNombre, niveauMunitions, parseSlots } from "@/lib/fps/hud-modele";
import type { ArmeId, Slot } from "@/lib/fps/protocole";
import Chargeur, { libelleBonusVitesse } from "./Chargeur";
import styles from "../HudArene.module.css";

/**
 * Bloc armes (bas-droite, §5.1) : nom de l'arme en main, munitions fixes (`Chargeur`), rack de slots `> [1] FUSIL 23/30`, `[2] PISTOLET 12/12`,
 * `[3] COUTEAU VITESSE +30 %`, `[4] RAILGUN 4` (étiquette « SPÉCIALE », présent seulement s'il est porté). Les noms courts restent complets en
 * permanence ; l'actif porte un cadre ambre et `aria-current="true"` ; pendant le dégainage (350 ms) la ligne du slot se remplit.
 * Conducteur : bloc lisible mais en `--ag-ink-dim`, avec la ligne « TIR IMPOSSIBLE ». Scalaires uniquement.
 */
export interface PropsBlocArmes {
  arme: ArmeId;
  slot: Slot;
  /** chaîne `HudEtat.slots` */
  slots: string;
  munitions: number;
  chargeur: number;
  reserve: number;
  recharge: boolean;
  degainage: boolean;
  /** conducteur : l'arme est indisponible */
  tireInterdit: boolean;
  bonusVitesse: number;
  /** touche réellement assignée à chaque slot (« 1 », « 2 »…), vide si aucune */
  toucheP: string;
  toucheS: string;
  toucheC: string;
  toucheSp: string;
  refBarre: RefObject<HTMLDivElement | null>;
  refTemps: RefObject<HTMLSpanElement | null>;
}

const LIBELLE_SLOT: Record<Slot, string> = { principale: "Principale", secondaire: "Secondaire", couteau: "Couteau", speciale: "Spéciale" };

function BlocArmesBrut(p: PropsBlocArmes) {
  const slots = parseSlots(p.slots);
  const touches: Record<Slot, string> = { principale: p.toucheP, secondaire: p.toucheS, couteau: p.toucheC, speciale: p.toucheSp };
  const couteau = p.arme === "couteau";
  return (
    <section className={`${styles.plaque} ${styles.armes}`} data-indisponible={p.tireInterdit ? "oui" : "non"} aria-label="Armes et munitions">
      <p className={styles.armeNom}>{nomArme(p.arme)}</p>
      {p.tireInterdit ? (
        <p className={styles.tirImpossible}>TIR IMPOSSIBLE</p>
      ) : null}
      <Chargeur
        munitions={p.munitions}
        chargeur={p.chargeur}
        reserve={p.reserve}
        sansRecharge={p.arme !== "couteau" && STATS[p.arme].sansRecharge}
        recharge={p.recharge}
        rechargeS={p.arme === "couteau" ? 0 : STATS[p.arme].rechargeS}
        couteau={couteau}
        bonusVitesse={p.bonusVitesse}
        refBarre={p.refBarre}
        refTemps={p.refTemps}
      />
      <ul className={styles.rack} aria-label="Équipement">
        {slots.map((s) => {
          const actif = s.slot === p.slot;
          const nomCourt = s.arme === "couteau" ? COUTEAU.nomCourt : STATS[s.arme].nomCourt;
          const niveau = s.slot === "couteau" ? "normal" : niveauMunitions(s.munitions, s.chargeur);
          return (
            <li
              key={s.slot}
              className={`${styles.slot} ${actif ? styles.slotActif : ""}`}
              aria-current={actif ? "true" : undefined}
              data-degainage={actif && p.degainage ? "oui" : "non"}
              data-niveau={niveau}
            >
              <span className={styles.slotTouche}>{touches[s.slot] ? `[${touches[s.slot]}]` : ""}</span>
              <span className={styles.slotNom}>
                {nomCourt.toUpperCase()}
                {s.slot === "speciale" && <em> SPÉCIALE</em>}
                <span className={styles.srSeul}> ({LIBELLE_SLOT[s.slot]})</span>
              </span>
              <span className={styles.slotMun}>
                {s.slot === "couteau"
                  ? `VITESSE ${libelleBonusVitesse(COUTEAU.vitesse)}`
                  : s.slot === "speciale"
                    ? formatNombre(s.munitions)
                    : `${formatNombre(s.munitions)}/${formatNombre(s.chargeur)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const BlocArmes = memo(BlocArmesBrut);
export default BlocArmes;
