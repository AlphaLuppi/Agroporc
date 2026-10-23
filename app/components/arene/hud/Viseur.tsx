"use client";

import { memo, type RefObject } from "react";
import styles from "../HudArene.module.css";

/**
 * Viseur STATIQUE (v2 §13.1 : aucune dispersion, le tir part exactement de l'axe de la vue) : quatre traits fixes et un point. Cyan quand
 * le joueur est protégé. Conducteur : `( + )` gris et libellé « CONDUITE : TIR IMPOSSIBLE ». Couteau : petit chevron de portée.
 * Rechargement : anneau de progression autour du viseur (`--recharge` écrite en rAF sur cet élément par `useHudLive`, hors React).
 * Décoratif (`aria-hidden`), sauf le libellé de conduite, qui est une information.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§5.1, §5.4, §6.3)
 */
export interface PropsViseur {
  protege: boolean;
  /** conducteur d'un véhicule : le tir est impossible */
  conduite: boolean;
  couteau: boolean;
  /** rechargement en cours : l'anneau est affiché */
  recharge: boolean;
  refAnneau: RefObject<HTMLDivElement | null>;
}

function ViseurBrut({ protege, conduite, couteau, recharge, refAnneau }: PropsViseur) {
  if (conduite) {
    return (
      <div className={styles.viseurConduite}>
        <span className={styles.viseurParentheses} aria-hidden="true">( + )</span>
        <p className={styles.libelleConduite}>CONDUITE : TIR IMPOSSIBLE</p>
      </div>
    );
  }
  return (
    <div className={`${styles.viseur} ${protege ? styles.viseurProtege : ""}`} aria-hidden="true">
      {couteau ? (
        <i className={styles.chevronPortee} />
      ) : (
        <>
          <i className={styles.tHaut} /><i className={styles.tBas} /><i className={styles.tGauche} /><i className={styles.tDroite} />
          <i className={styles.point} />
        </>
      )}
      {recharge && <div ref={refAnneau} className={styles.anneau} />}
    </div>
  );
}

const Viseur = memo(ViseurBrut);
export default Viseur;
