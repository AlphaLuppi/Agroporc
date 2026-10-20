"use client";

import { useState } from "react";
import {
  ajusterIngredients, bornerPersonnes, grouperIngredients, PERSONNES_MAX, PERSONNES_MIN, type IngredientRecette,
} from "@/lib/recettes";
import styles from "../recettes.module.css";

/** Ingrédients groupés, recalculés pour le nombre de personnes choisi (arrondis de `ajusterQuantite`). */
export default function AjusteurRecette({ ingredients, personnes }: { ingredients: IngredientRecette[]; personnes: number }) {
  const base = bornerPersonnes(personnes);
  const [cible, setCible] = useState(base);
  const groupes = grouperIngredients(ajusterIngredients(ingredients, base, cible));

  return (
    <div className={styles.ajusteur}>
      <div className={styles.compteur}>
        <button
          type="button"
          aria-label="Une personne de moins"
          disabled={cible <= PERSONNES_MIN}
          onClick={() => setCible((n) => bornerPersonnes(n - 1))}
        >
          −
        </button>
        <span aria-live="polite">
          {cible} personne{cible > 1 ? "s" : ""}
        </span>
        <button
          type="button"
          aria-label="Une personne de plus"
          disabled={cible >= PERSONNES_MAX}
          onClick={() => setCible((n) => bornerPersonnes(n + 1))}
        >
          +
        </button>
      </div>
      {groupes.map((g, i) => (
        <div key={g.groupe ?? `sans-groupe-${i}`} className={styles.groupe}>
          {g.groupe && <h3>{g.groupe}</h3>}
          <ul className={styles.ingredients}>
            {g.ingredients.map((ing, j) => (
              <li key={j}>
                <span className={styles.quantite}>{ing.libelleQuantite}</span>
                <span>
                  {ing.nom}
                  {ing.note && <span className={styles.note}>, {ing.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
