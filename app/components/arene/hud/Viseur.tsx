"use client";

import { memo, type CSSProperties, type RefObject } from "react";
import styles from "../HudArene.module.css";

/**
 * Viseur STATIQUE (v2 §13.1 : aucune dispersion, le tir part exactement de l'axe de la vue) : quatre traits fixes et un point. Cyan quand
 * le joueur est protégé. Conducteur : `( + )` gris et libellé « CONDUITE : TIR IMPOSSIBLE ». Couteau : petit chevron de portée.
 * Sniper sans lunette (v3 §1) : cercle de dispersion de rayon `ecart` (part de la demi-hauteur de l'écran), les traits s'écartent sur lui.
 * Rechargement : anneau de progression autour du viseur (`--recharge` écrite en rAF sur cet élément par `useHudLive`, hors React).
 * (v8, zombies) En visée avec une arme améliorée à viseur optique : point rouge (point lumineux et halo) ou viseur holographique (cercle
 * cyan, graduations, point) à la place des quatre traits.
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
  /** rayon du cercle de dispersion (part de la demi-hauteur de l'écran), 0 = viseur statique */
  ecart?: number;
  /** (v8) viseur optique affiché (en visée seulement), absent = les quatre traits */
  optique?: "point_rouge" | "holo" | null;
}

function ViseurBrut({ protege, conduite, couteau, recharge, refAnneau, ecart = 0, optique = null }: PropsViseur) {
  if (conduite) {
    return (
      <div className={styles.viseurConduite}>
        <span className={styles.viseurParentheses} aria-hidden="true">( + )</span>
        <p className={styles.libelleConduite}>CONDUITE : TIR IMPOSSIBLE</p>
      </div>
    );
  }
  return (
    <div
      className={`${styles.viseur} ${protege ? styles.viseurProtege : ""}`}
      aria-hidden="true"
      data-disperse={ecart > 0 ? "oui" : undefined}
      style={ecart > 0 ? ({ "--ecart": `${ecart * 50}vh` } as CSSProperties) : undefined}
    >
      {ecart > 0 && !couteau && <span className={styles.cercleDispersion} />}
      {optique && !couteau ? (
        <span className={styles.viseurOptique} data-optique={optique}>
          {optique === "point_rouge"
            ? <><span className={styles.anneauRouge} /><span className={styles.pointRouge} /></>
            : <><span className={styles.holo} /><span className={styles.holoPoint} /></>}
        </span>
      ) : couteau ? (
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
