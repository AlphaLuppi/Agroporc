"use client";

import { useEffect, useState } from "react";
import {
  etatRecetteDepuisStatut, formaterDuree, formaterQuantite, heureParis, libelleDifficulte, MENTION_PANNEAU,
  messageRecetteAbsente, type RecetteComplete,
} from "@/lib/recettes";
import styles from "./menus.module.css";

const NB_INGREDIENTS = 6;

type Etat = { kind: "charge" } | { kind: "absente" } | { kind: "erreur" } | { kind: "ok"; recette: RecetteComplete };

/**
 * Section « Le refaire chez soi » du détail d'un plat (POC), repliée par défaut : la recette
 * maison n'est chargée (`/api/recette/<cle>`) qu'au premier dépliage, puis aperçu des
 * ingrédients et lien vers la fiche complète.
 * Le parent passe `key={cle}` : un autre plat repart replié, dans un état « charge » propre.
 */
export default function RecettePanneau({ cle, date, today }: { cle: string; date: string; today: string }) {
  const [etat, setEtat] = useState<Etat>({ kind: "charge" });
  const [essai, setEssai] = useState(0);
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    const ctrl = new AbortController();
    setEtat({ kind: "charge" });
    fetch(`/api/recette/${cle}`, { signal: ctrl.signal })
      .then(async (res) => {
        const e = etatRecetteDepuisStatut(res.status);
        if (e !== "ok") return setEtat({ kind: e });
        const data = (await res.json()) as { recette?: RecetteComplete };
        setEtat(data.recette ? { kind: "ok", recette: data.recette } : { kind: "erreur" });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setEtat({ kind: "erreur" });
      });
    return () => ctrl.abort();
  }, [cle, essai, ouvert]);

  if (!ouvert) {
    return (
      <button type="button" className={styles.recettePli} aria-expanded={false} onClick={() => setOuvert(true)}>
        <span className={styles.recetteTete}>Le refaire chez soi</span>
        <span className={styles.recettePliAction}>Voir la recette <span aria-hidden="true">▾</span></span>
      </button>
    );
  }

  const titre = (
    <div className={styles.recetteEntete}>
      <h3 className={styles.recetteTete}>Le refaire chez soi</h3>
      <button type="button" className={styles.recettePliAction} aria-expanded={true} onClick={() => setOuvert(false)}>
        Replier <span aria-hidden="true">▴</span>
      </button>
    </div>
  );

  if (etat.kind === "charge") {
    return (
      <section className={styles.recette} aria-busy="true">
        {titre}
        <p className={styles.recetteMention}>Chargement de la recette…</p>
      </section>
    );
  }
  if (etat.kind === "absente") {
    return (
      <section className={styles.recette}>
        {titre}
        <p className={styles.texte}>{messageRecetteAbsente(date, today, heureParis())}</p>
        <a href="/recettes" className={styles.recetteLien}>Parcourir les recettes</a>
      </section>
    );
  }
  if (etat.kind === "erreur") {
    return (
      <section className={styles.recette}>
        {titre}
        <p className={styles.texte}>Recette indisponible pour le moment.</p>
        <button type="button" className={styles.bouton} style={{ alignSelf: "flex-start" }} onClick={() => setEssai((n) => n + 1)}>
          Réessayer
        </button>
      </section>
    );
  }

  const r = etat.recette;
  const apercu = r.ingredients.slice(0, NB_INGREDIENTS);
  const autres = r.ingredients.length - apercu.length;
  return (
    <section className={styles.recette}>
      {titre}
      <p className={styles.recetteTitre}>{r.titre}</p>
      <ul className={styles.recettePuces}>
        <li>{r.personnes} pers.</li>
        <li>Préparation {formaterDuree(r.temps_preparation_min)}</li>
        <li>Cuisson {formaterDuree(r.temps_cuisson_min)}</li>
        <li>{libelleDifficulte(r.difficulte)}</li>
      </ul>
      <ul className={styles.recetteIngredients}>
        {apercu.map((i, n) => (
          <li key={n}>
            {i.quantite === null ? (
              <>{i.nom} <span className={styles.recetteAutres}>selon goût</span></>
            ) : (
              <><b>{formaterQuantite(i.quantite, i.unite)}</b> {i.nom}</>
            )}
          </li>
        ))}
        {autres > 0 && <li className={styles.recetteAutres}>… et {autres} autre{autres > 1 ? "s" : ""}</li>}
      </ul>
      <p className={styles.recetteMention}>{MENTION_PANNEAU}</p>
      <a href={`/recettes/${r.cle}`} className={styles.bouton} style={{ alignSelf: "flex-start", textDecoration: "none" }}>
        Voir la recette complète
      </a>
    </section>
  );
}
