"use client";

import { LIBELLES_SKIN, SKINS, type SkinVoiture } from "@/lib/rocket/contrat";
import { apercuSkin, DESCRIPTIONS_SKIN } from "@/lib/rocket/skins";
import styles from "./Rocket.module.css";

/** Silhouette de profil d'une carrosserie (décorative : le nom est écrit à côté). */
export function ApercuSkin({ skin }: { skin: SkinVoiture }) {
  const a = apercuSkin(skin);
  return (
    <svg className={styles.apercuSkin} viewBox={a.vue} aria-hidden="true" focusable="false">
      <line x1="-0.66" y1="0.17" x2="0.84" y2="0.17" className={styles.apercuSol} />
      {a.chemins.map((d, i) => <path key={i} d={d} className={styles.apercuCaisse} />)}
      {a.traits.map(([x1, y1, x2, y2], i) => <line key={`t${i}`} x1={x1} y1={y1} x2={x2} y2={y2} className={styles.apercuTrait} />)}
      {a.roues.map((r, i) => <circle key={`r${i}`} cx={r.cx} cy={r.cy} r={r.r} className={styles.apercuRoue} />)}
    </svg>
  );
}

/**
 * Choix de la carrosserie (skin) de MA voiture : radios natives (flèches du clavier, un seul tabulable), chacune avec la silhouette de profil de
 * la voiture. Visuel seul : la hitbox reste celle de l'Octane, comme dans Rocket League.
 */
export default function ChoixSkinRocket({ nom, valeur, surChoix }: { nom: string; valeur: SkinVoiture; surChoix(s: SkinVoiture): void }) {
  return (
    <fieldset className={`${styles.segments} ${styles.skins}`}>
      <legend>Voiture</legend>
      {SKINS.map((s) => (
        <label key={s} className={`${styles.segment} ${styles.skin}`} title={DESCRIPTIONS_SKIN[s]}>
          <input type="radio" name={nom} value={s} checked={s === valeur} onChange={() => surChoix(s)} />
          <ApercuSkin skin={s} />
          <span>{LIBELLES_SKIN[s]}</span>
        </label>
      ))}
    </fieldset>
  );
}
