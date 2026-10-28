"use client";

import { useId } from "react";
import { choixApresChangement, groupeMelee, groupePrincipale, groupeSecondaire, largeurBarre, noteSur10, type GroupeArmes } from "./lobby-modele";
import type { PropsChoixEquipement } from "./contrats";
import styles from "./ChoixEquipement.module.css";

/**
 * Choix de l'équipement (arme principale, arme secondaire, arme blanche), dérivé de `STATS` / `INFOS_ARMES` / `MELEE` : variante « lobby » (trois `<fieldset>`
 * de cartes détaillées, radios natives navigables aux flèches, barres de stats `role="img"` « X sur 10 ») et variante « compact »
 * (boutons `aria-pressed` de l'écran de mort, de la killcam, de la pause et de l'entracte). Les armes spéciales (Elsa) n'y figurent pas.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.3, §2.4, §5.17, §6)
 */
export default function ChoixEquipement({ principale, secondaire, melee = "couteau", surChanger, variante, idGroupe }: PropsChoixEquipement) {
  const id = useId();
  const groupes = [
    { g: groupePrincipale() as GroupeArmes<string>, choisie: principale as string },
    { g: groupeSecondaire() as GroupeArmes<string>, choisie: secondaire as string },
    { g: groupeMelee() as GroupeArmes<string>, choisie: melee as string },
  ];
  const changer = (cle: GroupeArmes<string>["cle"], arme: string) => surChanger(...choixApresChangement({ principale, secondaire, melee }, cle, arme));

  if (variante === "compact") {
    return (
      <div className={styles.compact}>
        {groupes.map(({ g, choisie }) => {
          const idTitre = `${id}-${idGroupe}-${g.cle}`;
          return (
            <div key={g.cle} className={styles.ligne} role="group" aria-labelledby={idTitre}>
              <span id={idTitre} className={styles.ligneTitre}>{g.titre.replace("Arme ", "")}</span>
              <span className={styles.boutons}>
                {g.armes.map((info) => (
                  <button
                    key={info.id}
                    type="button"
                    className={`${styles.bouton} ${choisie === info.id ? styles.boutonChoisi : ""}`}
                    aria-pressed={choisie === info.id}
                    title={info.description}
                    onClick={() => changer(g.cle, info.id)}
                  >
                    {info.nom}
                  </button>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={styles.lobby}>
      {groupes.map(({ g, choisie }) => (
        <fieldset key={g.cle} className={styles.groupe}>
          <legend>{g.titre}</legend>
          <div className={`${styles.grille} ${g.compacte ? styles.grilleCompacte : ""}`}>
            {g.armes.map((info) => {
              const idCarte = `${id}-${idGroupe}-${info.id}`;
              const active = choisie === info.id;
              return (
                <label key={info.id} className={`${styles.carte} ${active ? styles.carteChoisie : ""}`}>
                  <input
                    type="radio"
                    name={`${idGroupe}-${g.cle}`}
                    value={info.id}
                    checked={active}
                    aria-labelledby={`${idCarte}-nom`}
                    aria-describedby={`${idCarte}-desc`}
                    onChange={() => changer(g.cle, info.id)}
                  />
                  <span id={`${idCarte}-nom`} className={styles.carteNom}>{info.nom}</span>
                  <span id={`${idCarte}-desc`} className={styles.carteDesc}>{info.description}</span>
                  <span className={styles.barres}>
                    {g.barres.map((b) => (
                      <span key={b.cle} className={styles.barre} role="img" aria-label={`${b.nom} ${noteSur10(info.barres[b.cle])} sur 10`}>
                        <span>{b.nom}</span>
                        <i><i style={{ width: `${largeurBarre(info.barres[b.cle])}%` }} /></i>
                      </span>
                    ))}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
