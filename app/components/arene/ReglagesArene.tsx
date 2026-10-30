"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EVENEMENTS_ARENE, LIBELLES_EVENEMENTS, estParDefaut, type ReglagesArene as ReglagesAreneChoisis } from "@/lib/fps/reglages-arene";
import {
  CHOIX_FREQUENCES, TEXTE_FREQUENCE_SANS_EVENEMENT, TEXTE_REGLAGES_FIGES, aucunEvenement, avecEvenement, avecFrequence, ecrireReglagesArene, lireReglagesArene,
  resumeCreation, tousLesEvenements,
} from "./lobby-modele";
import styles from "./Arene.module.css";

/**
 * Panneau « Créer une arène » (2026-10-30) : le créateur choisit les événements de SA arène (cases à cocher natives, une par événement de
 * `EVENEMENTS_ARENE`), leur fréquence (radios natifs « Calme / Normal / Chaos ») et crée l'arène. Les réglages sont mémorisés dans `localStorage`
 * (`pdj-fps-arene-reglages`, relus par `normaliserReglages`) et proposés de nouveau à la création suivante ; ils sont fixés à la création (le serveur n'en
 * change pas après). Sans état serveur ni réseau : le rappel `surCreer` porte les réglages. Cibles de 40 px au moins, tokens `--ag-*` seulement.
 * Spec : docs/superpowers/specs/2026-10-30-arene-police-evenements-design.md (§7.3)
 */
export interface PropsReglagesArene {
  /** crée l'arène avec ces réglages */
  surCreer(reglages: ReglagesAreneChoisis): void;
  /** referme le panneau sans créer */
  surAnnuler(): void;
  /** réglages de départ ; absent : ceux mémorisés dans le navigateur (tous les événements, « Normal » la première fois) */
  initial?: ReglagesAreneChoisis;
  /** `id` du panneau, repris par `aria-controls` du bouton qui l'ouvre */
  id?: string;
  /** déconnecté : « Créer cette arène » grisé */
  desactive?: boolean;
}

export default function ReglagesEvenementsArene({ surCreer, surAnnuler, initial, id, desactive = false }: PropsReglagesArene) {
  const idUnique = useId();
  const idPanneau = id ?? `${idUnique}-reglages`;
  const [reglages, setReglages] = useState<ReglagesAreneChoisis>(() => initial ?? lireReglagesArene(typeof localStorage === "undefined" ? null : localStorage));
  const racine = useRef<HTMLElement>(null);

  // le panneau s'ouvre sur un clic : la première case prend le focus (clavier et lecteurs d'écran), et il se montre en entier
  useEffect(() => {
    const el = racine.current;
    el?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: "nearest" });
  }, []);

  const changer = (r: ReglagesAreneChoisis) => {
    setReglages(r);
    ecrireReglagesArene(typeof localStorage === "undefined" ? null : localStorage, r);
  };
  const aucun = reglages.evenements.length === 0;
  const tous = reglages.evenements.length === EVENEMENTS_ARENE.length;

  return (
    <section ref={racine} id={idPanneau} className={styles.reglagesArene} aria-labelledby={`${idPanneau}-titre`}>
      <h3 id={`${idPanneau}-titre`}>Créer une arène</h3>
      <p className={styles.aidePseudo}>{TEXTE_REGLAGES_FIGES}</p>

      <fieldset className={styles.groupeReglages}>
        <legend>Événements</legend>
        {EVENEMENTS_ARENE.map((e) => (
          <label key={e} className={styles.optionReglage}>
            <input type="checkbox" name={`${idPanneau}-evenement`} value={e} checked={reglages.evenements.includes(e)} onChange={(ev) => changer(avecEvenement(reglages, e, ev.target.checked))} />
            <span>{LIBELLES_EVENEMENTS[e].aide}</span>
          </label>
        ))}
        <div className={styles.rangeeReglages}>
          <button type="button" className={styles.boutonSecondaire} disabled={tous} onClick={() => changer(tousLesEvenements(reglages))}>Tout cocher</button>
          <button type="button" className={styles.boutonSecondaire} disabled={aucun} onClick={() => changer(aucunEvenement(reglages))}>Aucun événement</button>
        </div>
      </fieldset>

      <fieldset className={styles.groupeReglages} disabled={aucun} aria-describedby={aucun ? `${idPanneau}-sans` : undefined}>
        <legend>Fréquence</legend>
        {CHOIX_FREQUENCES.map((f) => (
          <label key={f.id} className={styles.optionReglage}>
            <input type="radio" name={`${idPanneau}-frequence`} value={f.id} checked={reglages.frequence === f.id} onChange={() => changer(avecFrequence(reglages, f.id))} />
            <span><b>{f.nom}</b> : {f.aide}</span>
          </label>
        ))}
        {aucun && <p id={`${idPanneau}-sans`} className={styles.aidePseudo}>{TEXTE_FREQUENCE_SANS_EVENEMENT}</p>}
      </fieldset>

      <p className={styles.resumeReglages} role="status" aria-live="polite">{resumeCreation(reglages)}</p>
      {estParDefaut(reglages) ? null : <p className={styles.aidePseudo}>Ce choix est gardé pour la prochaine arène que vous créerez.</p>}

      <div className={styles.actionsPartie}>
        <button type="button" className={styles.boutonPrincipal} disabled={desactive} onClick={() => surCreer(reglages)}>Créer cette arène</button>
        <button type="button" className={styles.boutonSecondaire} onClick={surAnnuler}>Annuler</button>
      </div>
    </section>
  );
}
