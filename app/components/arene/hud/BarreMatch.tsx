"use client";

import { memo, useEffect, useRef, useState } from "react";
import { chrono } from "@/lib/fps/vue";
import { formatKills, formatRang, palierFranchi, SEUIL_SERIE } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Barre de match (haut centre, §5.1), trois cellules : à gauche mon rang (« 3e ») et mes kills ; au centre la minuterie (ambre sous 60 s,
 * danger sous 10 s, doublée d'un libellé écrit), « PREMIER À 30 K » ou « POINT DE MATCH » et la jauge du leader vers l'objectif avec une
 * encoche à mon score ; à droite le leader (« ★ Lea 18 K »), « TU MÈNES +3 » ou « ÉGALITÉ EN TÊTE ». Série de 3 kills ou plus : puce « SÉRIE ×3 ».
 * La minuterie bat dans ce composant seul (un tick local de 250 ms), jamais dans l'orchestrateur ; les paliers 60, 30 et 10 s sont
 * rapportés par `surPalier` à la région vive.
 */
export interface PropsBarreMatch {
  /** 0 = je ne suis pas en jeu */
  rang: number;
  exAequo: boolean;
  mesKills: number;
  serie: number;
  leaderPseudo: string;
  leaderCouleur: string;
  leaderKills: number;
  jeMene: boolean;
  egalite: boolean;
  ecart: number;
  pointDeMatch: boolean;
  objectif: number;
  progressionLeader: number;
  maProgression: number;
  /** horodatage serveur (ms) de fin prévue, null = pas de minuterie */
  fin: number | null;
  maintenantServeur(): number;
  surPalier?(secondes: number): void;
}

function BarreMatchBrute(p: PropsBarreMatch) {
  const [, setTick] = useState(0);
  const maintenant = useRef(p.maintenantServeur);
  maintenant.current = p.maintenantServeur;
  const palier = useRef(p.surPalier);
  palier.current = p.surPalier;
  const precedent = useRef<number | null>(null);

  useEffect(() => {
    const i = setInterval(() => {
      setTick((n) => n + 1);
      if (p.fin === null) { precedent.current = null; return; }
      const s = (p.fin - maintenant.current()) / 1000;
      if (precedent.current !== null) {
        const franchi = palierFranchi(precedent.current, s);
        if (franchi !== null) palier.current?.(franchi);
      }
      precedent.current = s;
    }, 250);
    return () => clearInterval(i);
  }, [p.fin]);

  const restantMs = p.fin !== null ? p.fin - p.maintenantServeur() : null;
  const restantS = restantMs !== null ? restantMs / 1000 : null;
  const etatMinuterie = restantS === null ? "normal" : restantS <= 10 ? "critique" : restantS <= 60 ? "bas" : "normal";

  return (
    <section className={`${styles.plaque} ${styles.match}`} aria-label="Match">
      <div className={styles.matchRang} aria-label={p.rang > 0 ? `Rang ${p.rang}, ${p.mesKills} kills` : "Pas classé"}>
        <b className={styles.matchRangNum}>{p.rang > 0 ? `${p.exAequo ? "=" : ""}${formatRang(p.rang)}` : "—"}</b>
        <span className={styles.matchKills}>{formatKills(p.mesKills)}</span>
        {p.serie >= SEUIL_SERIE && <span className={styles.puceSerie}>SÉRIE ×{p.serie}</span>}
      </div>
      <div className={styles.matchCentre}>
        <b className={styles.minuterie} data-etat={etatMinuterie} aria-label="Temps restant">
          {restantMs !== null ? chrono(restantMs) : "—:——"}
        </b>
        {etatMinuterie !== "normal" && (
          <span className={styles.minuterieEtat} data-etat={etatMinuterie}>
            {etatMinuterie === "critique" ? "DERNIÈRES SECONDES" : "DERNIÈRE MINUTE"}
          </span>
        )}
        <span className={p.pointDeMatch ? styles.pointDeMatch : styles.matchObjectif}>
          {p.pointDeMatch ? "POINT DE MATCH" : `PREMIER À ${formatKills(p.objectif)}`}
        </span>
        <div
          className={styles.jaugeMatch}
          role="img"
          aria-label={`Le leader a ${p.leaderKills} kills sur ${p.objectif}`}
        >
          <i className={styles.jaugeMatchRemplie} style={{ width: `${p.progressionLeader * 100}%` }} />
          <i className={styles.jaugeMatchMoi} style={{ left: `${p.maProgression * 100}%` }} />
        </div>
      </div>
      <div className={styles.matchLeader}>
        {p.jeMene ? (
          <span className={styles.matchMene}>TU MÈNES +{p.ecart}</span>
        ) : p.egalite ? (
          <span className={styles.matchMene}>ÉGALITÉ EN TÊTE</span>
        ) : p.leaderPseudo ? (
          <span className={styles.leader}>
            <span aria-hidden="true">★ </span>
            <i className={styles.pastille} style={{ background: p.leaderCouleur }} aria-hidden="true" />
            <b>{p.leaderPseudo}</b>
            <span className={styles.leaderKills}> {formatKills(p.leaderKills)}</span>
            <span className={styles.srSeul}> en tête</span>
          </span>
        ) : (
          <span className={styles.matchObjectif}>—</span>
        )}
      </div>
    </section>
  );
}

const BarreMatch = memo(BarreMatchBrute);
export default BarreMatch;
