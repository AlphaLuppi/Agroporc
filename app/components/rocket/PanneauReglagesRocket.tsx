"use client";

import { useId } from "react";
import { CAMERA_DEFAUT, type ParamsCamera, type ReglagesRocket } from "@/lib/rocket/contrat";
import type { PropsReglagesRocket } from "./contrats";
import LiaisonsRocket from "./LiaisonsRocket";
import styles from "./Rocket.module.css";

/**
 * Curseurs de la caméra, affichés dans les unités de Rocket League (distance et hauteur en « uu », 1 uu = 1 cm) alors que le jeu stocke des mètres :
 * un joueur de Rocket League retrouve ses chiffres habituels (270 / 100 / -4° / 110° / 0,45).
 */
interface DefCurseur {
  cle: keyof ParamsCamera;
  libelle: string;
  min: number;
  max: number;
  pas: number;
  /** valeur affichée = valeur stockée × facteur */
  facteur: number;
  unite: string;
  decimales: number;
  aide: string;
}
export const CURSEURS_CAMERA: readonly DefCurseur[] = [
  { cle: "fov", libelle: "Champ de vision", min: 60, max: 110, pas: 1, facteur: 1, unite: "°", decimales: 0, aide: "Champ horizontal ; 110° est le réglage par défaut de Rocket League." },
  { cle: "distance", libelle: "Distance", min: 100, max: 400, pas: 10, facteur: 100, unite: "", decimales: 0, aide: "Distance derrière la voiture, en unités de Rocket League (270 par défaut)." },
  { cle: "hauteur", libelle: "Hauteur", min: 40, max: 200, pas: 10, facteur: 100, unite: "", decimales: 0, aide: "Hauteur de la caméra, en unités de Rocket League (100 par défaut)." },
  { cle: "angle", libelle: "Angle", min: -15, max: 0, pas: 1, facteur: 1, unite: "°", decimales: 0, aide: "Inclinaison de la caméra vers le bas (-4° par défaut)." },
  { cle: "rigidite", libelle: "Rigidité", min: 0, max: 1, pas: 0.05, facteur: 1, unite: "", decimales: 2, aide: "0 : caméra souple, 1 : collée à la voiture (0,45 par défaut)." },
  { cle: "vitesseRegard", libelle: "Vitesse du regard", min: 1, max: 10, pas: 0.1, facteur: 1, unite: "", decimales: 1, aide: "Vitesse du regard libre (souris bouton du milieu, stick droit)." },
  { cle: "vitesseTransition", libelle: "Vitesse de transition", min: 1, max: 2, pas: 0.1, facteur: 1, unite: "", decimales: 1, aide: "Vitesse du passage entre ball cam et caméra voiture." },
];

const arrondir = (x: number, n: number): number => Math.round(x * 10 ** n) / 10 ** n;
const borner = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));
const virgule = (x: number, decimales: number): string => x.toFixed(decimales).replace(".", ",");

/** Un curseur natif (`<input type="range">`) avec son libellé, sa valeur lue en direct et son aide. */
function Curseur({ id, libelle, aide, min, max, pas, valeur, affichage, surChange }: {
  id: string; libelle: string; aide?: string; min: number; max: number; pas: number; valeur: number; affichage: string; surChange(v: number): void;
}) {
  return (
    <div className={styles.curseur}>
      <label htmlFor={id}>{libelle}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={pas}
        value={valeur}
        aria-describedby={aide ? `${id}-aide` : undefined}
        aria-valuetext={affichage}
        onChange={(e) => surChange(Number(e.target.value))}
      />
      <output htmlFor={id} aria-live="off">{affichage}</output>
      {aide && <span id={`${id}-aide`} className={styles.aideCurseur}>{aide}</span>}
    </div>
  );
}

/**
 * Réglages de Rocket Muche : caméra (les sept paramètres de Rocket League), ball cam par défaut, volume, manette (zone morte, tangage inversé,
 * vibrations), puis les liaisons de toutes les commandes (clavier, souris, boutons et sticks de la manette : `LiaisonsRocket`). Contrôlé : chaque changement part tout de suite à `surReglages` (le jeu l'applique en direct et le mémorise).
 */
export default function PanneauReglagesRocket({ reglages, surReglages }: PropsReglagesRocket) {
  const id = useId();
  const changer = (patch: Partial<ReglagesRocket>) => surReglages({ ...reglages, ...patch });
  const changerCamera = (patch: Partial<ParamsCamera>) => changer({ camera: { ...reglages.camera, ...patch } });
  const cameraParDefaut = CURSEURS_CAMERA.every((c) => Math.abs(reglages.camera[c.cle] - CAMERA_DEFAUT[c.cle]) < 1e-9);

  return (
    <div className={styles.reglages}>
      <fieldset className={styles.groupe}>
        <legend>Caméra</legend>
        {CURSEURS_CAMERA.map((c) => {
          const affiche = arrondir(reglages.camera[c.cle] * c.facteur, c.decimales);
          return (
            <Curseur
              key={c.cle}
              id={`${id}-${c.cle}`}
              libelle={c.libelle}
              aide={c.aide}
              min={c.min}
              max={c.max}
              pas={c.pas}
              valeur={borner(affiche, c.min, c.max)}
              affichage={`${virgule(affiche, c.decimales)}${c.unite}`}
              surChange={(v) => changerCamera({ [c.cle]: arrondir(borner(v, c.min, c.max) / c.facteur, 4) })}
            />
          );
        })}
        <button type="button" className={styles.boutonDiscret} disabled={cameraParDefaut} onClick={() => changer({ camera: { ...CAMERA_DEFAUT } })}>
          Rétablir la caméra de Rocket League
        </button>
        <label className={styles.caseAcocher}>
          <input type="checkbox" checked={reglages.balleCamParDefaut} onChange={(e) => changer({ balleCamParDefaut: e.target.checked })} />
          Ball cam activée au début et après chaque but
        </label>
      </fieldset>

      <fieldset className={styles.groupe}>
        <legend>Son</legend>
        <Curseur
          id={`${id}-volume`}
          libelle="Volume"
          min={0}
          max={100}
          pas={5}
          valeur={Math.round(reglages.volume * 100)}
          affichage={`${Math.round(reglages.volume * 100)} %`}
          surChange={(v) => changer({ volume: borner(v, 0, 100) / 100 })}
        />
      </fieldset>

      <fieldset className={styles.groupe}>
        <legend>Manette</legend>
        <Curseur
          id={`${id}-zone`}
          libelle="Zone morte des sticks"
          aide="Ignore les petits mouvements involontaires des sticks."
          min={0}
          max={40}
          pas={1}
          valeur={Math.round(reglages.zoneMorteManette * 100)}
          affichage={`${Math.round(reglages.zoneMorteManette * 100)} %`}
          surChange={(v) => changer({ zoneMorteManette: borner(v, 0, 40) / 100 })}
        />
        <label className={styles.caseAcocher}>
          <input type="checkbox" checked={reglages.inverserTangageManette} onChange={(e) => changer({ inverserTangageManette: e.target.checked })} />
          Inverser le tangage (stick vers le haut : nez vers le haut)
        </label>
        <label className={styles.caseAcocher}>
          <input type="checkbox" checked={reglages.vibrations} onChange={(e) => changer({ vibrations: e.target.checked })} />
          Vibrations (touches de balle, atterrissages, démolitions)
        </label>
      </fieldset>

      <LiaisonsRocket reglages={reglages} surReglages={surReglages} />
    </div>
  );
}
