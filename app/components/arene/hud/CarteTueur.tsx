"use client";

import { nomArme } from "@/lib/fps/armes";
import { formaterNombre } from "@/lib/fps/classement";
import { JEU, type InfoTueur } from "@/lib/fps/protocole";
import { libelleCause } from "../armesInfo";
import type { DerniereMort } from "../contrats";
import styles from "./EcranMort.module.css";

/**
 * Carte du tueur (§5.5) : « ÉLIMINÉ PAR » et son pseudo (en `--ag-ink`, couleur serveur en pastille seulement), ses K/M du match, son arme,
 * la distance, « tir à la tête » (texte + `--ag-tete` + souligné), ses PV et son bouclier restants (jauges + chiffres), les dégâts que
 * je lui ai infligés pendant ma vie, le compte à rebours de réapparition et sa barre. Repli sans tueur joueur (écrasé par un PNJ, tueur
 * déconnecté sans photographie) : le titre est `libelleCause` (« Écrasé par la circulation », « Renversé par <pseudo> »).
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 */
export interface PropsCarteTueur {
  tueur: InfoTueur | null;
  derniereMort: DerniereMort | null;
  degatsAuTueur: number;
  /** s avant la réapparition */
  reapparitionDans: number;
  /** K et M du tueur dans le match (présence), s'ils sont connus */
  kmTueur?: { kills: number; morts: number } | null;
}

const NBSP = " ";
const fraction = (v: number, max: number) => `${Math.round(Math.min(1, Math.max(0, v / max)) * 100)}%`;

/** Une ligne de jauge : nom, piste (décorative, le chiffre dit la même chose), valeur. */
function Jauge({ nom, valeur, max, bouclier }: { nom: string; valeur: number; max: number; bouclier?: boolean }) {
  return (
    <>
      <span className={styles.jaugeNom}>{nom}</span>
      <span className={styles.piste} aria-hidden="true" data-bouclier={bouclier ? "oui" : "non"} data-bas={!bouclier && valeur <= 25 ? "oui" : "non"}>
        <i style={{ width: fraction(valeur, max) }} />
      </span>
      <span className={styles.jaugeValeur}>{Math.round(valeur)}</span>
    </>
  );
}

export default function CarteTueur({ tueur, derniereMort, degatsAuTueur, reapparitionDans, kmTueur }: PropsCarteTueur) {
  const cause = derniereMort?.cause ?? "arme";
  // tueur joueur : un tir d'arme, avec ou sans photographie (le tueur a pu quitter la partie)
  const parJoueurArme = cause === "arme" && (tueur !== null || derniereMort !== null);
  const pseudo = tueur?.pseudo ?? derniereMort?.par ?? "";
  const couleur = tueur?.couleur ?? derniereMort?.parCouleur;
  const arme = tueur?.arme ?? derniereMort?.arme;
  const tete = derniereMort?.zone === "tete";
  const delai = JEU.delaiReapparitionMs / 1000;
  const part = Math.min(1, Math.max(0, 1 - reapparitionDans / delai));
  const degats = Math.round(degatsAuTueur);

  return (
    <section className={styles.carte} aria-label="Carte du tueur">
      {parJoueurArme ? (
        <h2 className={styles.titre} role="status">
          <small>Éliminé par</small>
          <span className={styles.tueur}>
            {couleur && <span className={styles.pastille} style={{ background: couleur }} aria-hidden="true" />}
            <span className={styles.pseudo}>{pseudo}</span>
          </span>
        </h2>
      ) : (
        <h2 className={styles.titre} role="status">
          {derniereMort ? libelleCause(derniereMort.arme, derniereMort.cause, derniereMort.par) : "Éliminé"}
        </h2>
      )}

      {parJoueurArme && kmTueur && (
        <p className={styles.km}>{formaterNombre(kmTueur.kills)} K · {formaterNombre(kmTueur.morts)} M ce match</p>
      )}

      {parJoueurArme && arme && (
        <p className={styles.arme}>
          {nomArme(arme)}
          {tueur && <> · {formaterNombre(Math.round(tueur.distance))}{NBSP}m</>}
          {tete && <> · <span className={styles.tete}><span aria-hidden="true">◎ </span>tir à la tête</span></>}
        </p>
      )}

      {parJoueurArme && tueur && (
        <div className={styles.jauges}>
          <Jauge nom="PV" valeur={tueur.pv} max={JEU.pvMax} />
          <Jauge nom="Bouclier" valeur={tueur.bouclier} max={JEU.bouclierMax} bouclier />
        </div>
      )}

      {parJoueurArme && (
        <p className={styles.degats}>
          {degats > 0 ? <>Vous lui avez infligé <b>{formaterNombre(degats)}</b> dégât{degats > 1 ? "s" : ""}</> : "Vous ne l'avez pas touché"}
        </p>
      )}

      <p className={styles.reapparition}>
        {reapparitionDans > 0 ? <>Réapparition dans <b>{formaterNombre(reapparitionDans, 1)}</b>{NBSP}s</> : "Réapparition…"}
      </p>
      <div className={styles.barre} aria-hidden="true"><i style={{ width: `${Math.round(part * 100)}%` }} /></div>
    </section>
  );
}
