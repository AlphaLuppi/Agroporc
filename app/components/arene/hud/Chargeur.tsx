"use client";

import { memo, type RefObject } from "react";
import { formatNombre, niveauMunitions, pips } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Munitions de l'arme en main (§5.1), toujours visibles : chargeur courant en grand, taille du chargeur, réserve (« RÉSERVE ∞ » en v2, avec
 * `aria-label="réserve illimitée"`), pips de balles. Seuils : ambre à 25 % ou 3 balles, danger à 10 % ou moins, « VIDE » à 0. Pendant
 * le rechargement, la rangée de pips est remplacée par une barre de progression (`--recharge` écrite hors React) avec « RECHARGEMENT »
 * et le temps restant. Le couteau n'a pas de chiffres : puce « VITESSE +30 % ».
 */
export interface PropsChargeur {
  munitions: number;
  chargeur: number;
  /** −1 = infinie */
  reserve: number;
  /** arme spéciale d'Elsa : pas de rechargement ni de réserve, l'arme disparaît à 0 (« SANS RECHARGE » au lieu de « RÉSERVE ») */
  sansRecharge?: boolean;
  recharge: boolean;
  /** durée totale du rechargement de l'arme (s) : sert au temps restant écrit hors React */
  rechargeS: number;
  couteau: boolean;
  /** multiplicateur de course de l'arme (couteau 1,3) */
  bonusVitesse: number;
  refBarre: RefObject<HTMLDivElement | null>;
  refTemps: RefObject<HTMLSpanElement | null>;
}

/** « +30 % » pour un multiplicateur de course de 1,3. */
export function libelleBonusVitesse(mult: number): string {
  return `+${Math.round((mult - 1) * 100)} %`;
}

function ChargeurBrut({ munitions, chargeur, reserve, sansRecharge = false, recharge, rechargeS, couteau, bonusVitesse, refBarre, refTemps }: PropsChargeur) {
  if (couteau) {
    return (
      <div className={styles.chargeurCouteau}>
        <span className={styles.puceVitesse}>VITESSE {libelleBonusVitesse(bonusVitesse)}</span>
      </div>
    );
  }
  const niveau = niveauMunitions(munitions, chargeur);
  const p = pips(munitions, chargeur);
  return (
    <div className={styles.chargeur} data-niveau={niveau}>
      <div className={styles.chargeurLigne}>
        <b className={styles.chargeurNum} aria-label={`${munitions} munitions sur ${chargeur}`}>{formatNombre(munitions)}</b>
        <span className={styles.chargeurTaille} aria-hidden="true">/ {formatNombre(chargeur)}</span>
        {sansRecharge ? (
          <span className={styles.reserve} aria-label="sans rechargement : l'arme disparaît à zéro">SANS RECHARGE</span>
        ) : (
          <span className={styles.reserve} aria-label={reserve < 0 ? "réserve illimitée" : `réserve ${reserve}`}>
            RÉSERVE {reserve < 0 ? "∞" : formatNombre(reserve)}
          </span>
        )}
      </div>
      {niveau === "vide" && !recharge && <p className={styles.chargeurVide}>VIDE</p>}
      {recharge ? (
        <div className={styles.rechargeLigne}>
          <div
            ref={refBarre}
            className={styles.barreRecharge}
            role="progressbar"
            aria-label="Rechargement"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
          >
            <i />
          </div>
          <span className={styles.rechargeTexte}>RECHARGEMENT</span>
          <span ref={refTemps} className={styles.rechargeTemps} data-duree={rechargeS} />
        </div>
      ) : (
        <div className={styles.pips} aria-hidden="true">
          {Array.from({ length: p.crans }, (_, i) => (<i key={i} className={i < p.pleins ? styles.pipPlein : styles.pipVide} />))}
        </div>
      )}
    </div>
  );
}

const Chargeur = memo(ChargeurBrut);
export default Chargeur;
