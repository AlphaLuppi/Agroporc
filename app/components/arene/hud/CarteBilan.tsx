"use client";

import { formaterNombre, ordinal, pourcentageTetes, precision, ratioKD, texteArmeFav, texteDegats, type Bilan } from "@/lib/fps/classement";
import styles from "./FinDeMatch.module.css";

/**
 * « Ton match » (§10) : rang final, K, M, K/D, précision, têtes, meilleure série, dégâts, arme favorite. Les statistiques absentes
 * (message `scores` pas encore reçu) s'affichent « — ». Les distinctions que j'ai gagnées (`gagnees`) ne s'affichent ici que sur
 * les petites fenêtres, où la colonne des distinctions est repliée.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 */
export interface PropsCarteBilan {
  /** mon bilan (`bilanJoueur`), null si je ne figure pas au classement */
  bilan: Bilan | null;
  gagnees: readonly string[];
}

export default function CarteBilan({ bilan, gagnees }: PropsCarteBilan) {
  if (!bilan) {
    return (
      <section className={styles.colonne} aria-label="Ton match">
        <h3 className={styles.titreColonne}>Ton match</h3>
        <p className={styles.vide}>Tu n&apos;as pas joué ce match.</p>
      </section>
    );
  }
  const { ligne: l, rang, total } = bilan;
  const cellules: [string, string, boolean?][] = [
    ["Éliminations (K)", formaterNombre(l.kills)],
    ["Morts (M)", formaterNombre(l.morts)],
    ["K/D", ratioKD(l)],
    ["Précision", precision(l)],
    ["Têtes", pourcentageTetes(l)],
    ["Série max", `×${l.serieMax}`],
    ["Dégâts", texteDegats(l)],
    ["Arme favorite", texteArmeFav(l, false), true],
  ];
  return (
    <section className={styles.colonne} aria-label="Ton match">
      <h3 className={styles.titreColonne}>Ton match ({ordinal(rang)}/{total})</h3>
      <dl className={styles.bilan}>
        {cellules.map(([nom, valeur, large]) => (
          <div key={nom} className={large ? styles.large : undefined}>
            <dt>{nom}</dt>
            <dd>{valeur}</dd>
          </div>
        ))}
      </dl>
      {gagnees.length > 0 && <p className={styles.gagnees}>Distinctions : {gagnees.join(" · ")}</p>}
    </section>
  );
}
