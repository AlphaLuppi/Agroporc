"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  COLONNES_TOUTES, colonnesVisibles, construireLignes, estLeader, palmares, phraseSituation, pointDeMatch, rangs, textePresence,
  type ColonneScore, type LigneScore as DonneesLigne, type Palmares,
} from "@/lib/fps/classement";
import { JEU, type InfoMatch, type JoueurPublic, type LigneClassement, type LigneStats } from "@/lib/fps/protocole";
import { chrono } from "@/lib/fps/vue";
import LigneScore, { CLASSE_COLONNE } from "./LigneScore";
import RailObjectif from "./RailObjectif";
import { useLargeur } from "./useLargeur";
import { useMouvementReduit } from "./useMouvementReduit";
import styles from "./TableauScores.module.css";

/**
 * Tableau des scores (§8) : vrai <table> avec caption, en-tête figé (match, objectif, minuterie, rail de course, phrase de situation),
 * ma ligne épinglée en bas de la zone visible, colonnes repliées selon la largeur mesurée du panneau, records en pied, réordonnancement
 * par FLIP (200 ms, aucun en mouvement réduit). Phase 1 : colonnes de la présence ; phase 2 : les cellules de stats affichent « — »
 * tant que le message `scores` n'est pas arrivé.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 */
export interface PropsTableauScores {
  joueurs: JoueurPublic[];
  stats: ReadonlyMap<string, LigneStats>;
  /** classement de fin de match (entracte), sinon null */
  classement: LigneClassement[] | null;
  monId: string | null;
  match: InfoMatch | null;
  maintenantServeur(): number;
  /** libellé de la touche des scores pour le rappel du pied (« Tab » par défaut) */
  toucheScores?: string;
  /** largeur du panneau imposée (tests de rendu) ; sinon mesurée */
  largeur?: number;
  /** coupe le FLIP (sinon : prefers-reduced-motion et `data-effets="reduits"` d'un ancêtre) */
  effetsReduits?: boolean;
}

const NBSP = " ";

/** Nom des colonnes : lettre de l'en-tête et libellé complet (lecteurs d'écran, infobulle). */
const ENTETES: Record<ColonneScore, { court: string; long: string }> = {
  rang: { court: "#", long: "Rang" },
  agent: { court: "Agent", long: "Agent" },
  k: { court: "K", long: "Éliminations" },
  m: { court: "M", long: "Morts" },
  kd: { court: "K/D", long: "Éliminations par mort" },
  ser: { court: "Sér", long: "Série d'éliminations en cours" },
  prec: { court: "Préc", long: "Précision (touches par tir)" },
  tete: { court: "Tête", long: "Part de tirs à la tête" },
  deg: { court: "Dég", long: "Dégâts infligés" },
  arme: { court: "Arme fav.", long: "Arme favorite" },
  ping: { court: "Ping", long: "Ping" },
};

/** Minuterie qui avance seule (le tableau ne dépend pas d'un rendu parent) ; ambre sous 60 s, rouge sous 10 s avec « N s » écrit. */
function Minuterie({ match, maintenantServeur }: { match: InfoMatch | null; maintenantServeur(): number }) {
  const [, setTic] = useState(0);
  const fin = match?.fin ?? null;
  useEffect(() => {
    if (fin === null) return;
    const i = setInterval(() => setTic((n) => n + 1), 500);
    return () => clearInterval(i);
  }, [fin]);
  if (match?.phase === "entracte") return <p className={styles.minuterie}>Terminé</p>;
  if (fin === null) return <p className={styles.minuterie} aria-label="Temps restant indisponible">—:——</p>;
  const ms = fin - maintenantServeur();
  const s = Math.max(0, Math.ceil(ms / 1000));
  const niveau = s < 10 ? "critique" : s < 60 ? "bas" : "normal";
  return (
    <p className={styles.minuterie} data-niveau={niveau} aria-label={`Temps restant ${chrono(ms)}`}>
      {chrono(ms)}
      {niveau === "critique" && <span className={styles.secondes}>{s}{NBSP}s</span>}
    </p>
  );
}

/** « série Lea ×5 · précision Zoe 52 % · têtes Max 31 % » (les records qui existent). */
function texteRecords(lignes: readonly DonneesLigne[], p: Palmares): string {
  const nom = (id: string) => lignes.find((l) => l.id === id)?.pseudo ?? "";
  const pc = (v: number) => `${Math.round(v * 100)}${NBSP}%`;
  const morceaux: string[] = [];
  if (p.serie) morceaux.push(`série ${nom(p.serie.id)} ×${p.serie.valeur}`);
  if (p.precision) morceaux.push(`précision ${nom(p.precision.id)} ${pc(p.precision.valeur)}`);
  if (p.tetes) morceaux.push(`têtes ${nom(p.tetes.id)} ${pc(p.tetes.valeur)}`);
  return morceaux.join(" · ");
}

export default function TableauScores({
  joueurs, stats, classement, monId, match, maintenantServeur, toucheScores = "Tab", largeur: largeurImposee, effetsReduits,
}: PropsTableauScores) {
  const refPanneau = useRef<HTMLElement>(null);
  const refCorps = useRef<HTMLDivElement>(null);
  const ordrePrecedent = useRef<Map<string, number>>(new Map());
  const mouvementReduit = useMouvementReduit();
  const mesuree = useLargeur(refPanneau);
  const colonnes = colonnesVisibles(largeurImposee ?? mesuree);

  const lignes = useMemo(() => construireLignes(joueurs, stats, classement), [joueurs, stats, classement]);
  const r = useMemo(() => rangs(lignes), [lignes]);
  const objectif = match?.objectif ?? JEU.objectifKills;
  const entracte = match?.phase === "entracte";
  const records = useMemo(() => texteRecords(lignes, palmares(lignes)), [lignes]);
  const densite = lignes.length > 12 ? "dense" : "normale";

  // Réordonnancement par FLIP : chaque ligne qui a changé de place glisse depuis son ancienne position (index × hauteur, insensible
  // au `position: sticky` de ma ligne épinglée).
  useLayoutEffect(() => {
    const corps = refCorps.current;
    if (!corps) return;
    const lignesDom = Array.from(corps.querySelectorAll<HTMLElement>("tbody tr[data-id]"));
    const precedent = ordrePrecedent.current;
    const suivant = new Map<string, number>();
    lignesDom.forEach((el, i) => suivant.set(el.dataset.id ?? "", i));
    const reduit = effetsReduits ?? (mouvementReduit || !!corps.closest('[data-effets="reduits"]'));
    if (!reduit && precedent.size > 0 && lignesDom[0] && typeof lignesDom[0].animate === "function") {
      const hauteur = lignesDom[0].offsetHeight;
      lignesDom.forEach((el, i) => {
        const avant = precedent.get(el.dataset.id ?? "");
        if (avant === undefined || avant === i) return;
        el.animate([{ transform: `translateY(${(avant - i) * hauteur}px)` }, { transform: "translateY(0)" }], { duration: 200, easing: "ease-out" });
      });
    }
    ordrePrecedent.current = suivant;
  });

  const numero = match?.numero;
  const situation = phraseSituation(lignes, monId);
  const colonnesAffichees = colonnes.length ? colonnes : COLONNES_TOUTES;
  const nbColonnes = colonnesAffichees.length;

  return (
    <section ref={refPanneau} className={styles.panneau} aria-label="Tableau des scores">
      <header className={styles.entete}>
        <div className={styles.ligneTitre}>
          <h2 className={styles.titre}>{numero !== undefined ? `Match n°${numero}` : "Match"} · Chacun pour soi</h2>
          <p className={styles.objectif}>Premier à {objectif} kills</p>
          <Minuterie match={match} maintenantServeur={maintenantServeur} />
        </div>
        <RailObjectif lignes={lignes} objectif={objectif} moiId={monId} />
        <div className={styles.situation}>
          {situation && <p className={styles.phrase}>{situation}</p>}
          {!entracte && pointDeMatch(lignes, objectif) && <p className={styles.pointDeMatch}>Point de match</p>}
          <p className={styles.presence}>{textePresence(joueurs)}</p>
        </div>
      </header>

      <div ref={refCorps} className={styles.defile}>
        <table className={styles.table} data-densite={densite}>
          <caption className={styles.sr}>Tableau des scores{numero !== undefined ? `, match ${numero}` : ""}</caption>
          <colgroup>{colonnesAffichees.map((c) => <col key={c} className={CLASSE_COLONNE[c]} />)}</colgroup>
          <thead>
            <tr>
              {colonnesAffichees.map((c) => (
                <th key={c} scope="col" className={`${CLASSE_COLONNE[c]} ${c === "agent" ? styles.gauche : ""}`}>
                  {c === "rang" || c === "agent" ? ENTETES[c].court : <abbr title={ENTETES[c].long}>{ENTETES[c].court}</abbr>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.length === 0 && (
              <tr><td colSpan={nbColonnes} className={styles.vide}>Personne en jeu.</td></tr>
            )}
            {lignes.map((l, i) => (
              <LigneScore
                key={l.id}
                ligne={l}
                rang={r[i]}
                egalite={r[i - 1] === r[i] || r[i + 1] === r[i]}
                colonnes={colonnesAffichees}
                moi={l.id === monId}
                leader={estLeader(l, r[i])}
              />
            ))}
          </tbody>
        </table>
      </div>

      <footer className={styles.pied}>
        <p className={styles.records}>
          Records : {records || "aucun pour l'instant"}
        </p>
        <div className={styles.legende}>
          <p><span aria-hidden="true">★</span> en tête · <span aria-hidden="true">✕</span> éliminé · voiture = en véhicule · — = pas encore de statistique</p>
          <p><kbd>{toucheScores}</kbd> maintenir</p>
        </div>
      </footer>
    </section>
  );
}
