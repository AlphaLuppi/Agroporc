"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { EtatElsaMsg } from "@/lib/fps/protocole";
import type { RadarFrame } from "@/lib/fps/radar";
import { formatMetres, formatSecondes, texteOffreElsa } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Bandeau du cadeau d'Elsa (§5.8) : non modal, grand pendant 4 s (entrée par le haut) puis replié en puce sous la barre de match
 * (« ELSA 340 m · 27 s ») jusqu'au ramassage ou à l'expiration ; replié d'emblée si la fenêtre fait moins de 800 px de haut. Contenu en texte
 * (« SOIN COMPLET : PV 100 + BOUCLIER 100 » ou « ARME : RAILGUN, 6 tirs »), flèche vers Elsa (`--elsa-angle` écrite hors React d'après
 * `radar().elsa`, distance arrondie à 10 m) et barre de temps lue sur `offre.finT` (jamais une durée codée en dur).
 * L'annonce vocale passe par la région vive ; ce composant n'est pas `aria-live`.
 */
export interface PropsAnnoncesElsa {
  elsa: EtatElsaMsg | null;
  maintenantServeur(): number;
  radar(): RadarFrame;
}

const GRAND_MS = 4000;
const HAUTEUR_PETIT_ECRAN = 800;

function AnnoncesElsaBrutes({ elsa, maintenantServeur, radar }: PropsAnnoncesElsa) {
  const offre = elsa?.offre ?? null;
  const offreId = offre?.id ?? null;
  const [replie, setReplie] = useState(false);
  const [, setTick] = useState(0);
  const fleche = useRef<HTMLSpanElement | null>(null);
  const distance = useRef<HTMLSpanElement | null>(null);
  /** temps restant à la première vue de l'offre : base de la jauge (la durée réelle vient du serveur) */
  const base = useRef<{ id: number; ms: number }>({ id: -1, ms: 1 });
  const radarRef = useRef(radar);
  radarRef.current = radar;
  const maintenant = useRef(maintenantServeur);
  maintenant.current = maintenantServeur;
  const finT = offre?.finT ?? 0;

  // grand 4 s puis puce ; replié d'emblée sur un écran bas
  useEffect(() => {
    if (offreId === null) return;
    const petit = typeof window !== "undefined" && window.innerHeight < HAUTEUR_PETIT_ECRAN;
    setReplie(petit);
    if (petit) return;
    const m = setTimeout(() => setReplie(true), GRAND_MS);
    return () => clearTimeout(m);
  }, [offreId]);

  // temps restant (250 ms) et flèche vers Elsa (100 ms), hors rendu pour la flèche
  useEffect(() => {
    if (offreId === null) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    const f = setInterval(() => {
      const e = radarRef.current().elsa;
      if (!e) return;
      fleche.current?.style.setProperty("--elsa-angle", `${e.angle}rad`);
      if (distance.current) {
        const texte = formatMetres(e.distance);
        if (distance.current.textContent !== texte) distance.current.textContent = texte;
      }
    }, 100);
    return () => { clearInterval(t); clearInterval(f); };
  }, [offreId]);

  if (!offre) return null;
  const restantMs = Math.max(0, finT - maintenant.current());
  if (base.current.id !== offre.id) base.current = { id: offre.id, ms: Math.max(1, restantMs) };
  const part = Math.max(0, Math.min(1, restantMs / base.current.ms));
  const texte = texteOffreElsa(offre.genre, offre.arme);
  const genreMarque = offre.genre === "soin" ? "+" : "★";

  if (replie) {
    return (
      <div className={`${styles.plaque} ${styles.elsaPuce}`} data-genre={offre.genre}>
        <span ref={fleche} className={styles.elsaFleche} aria-hidden="true">➤</span>
        <span className={styles.elsaPuceTexte}>
          ELSA <span ref={distance} />
          {" · "}{formatSecondes(restantMs / 1000)}
          <span className={styles.srSeul}> : {texte}</span>
        </span>
      </div>
    );
  }
  return (
    <section className={`${styles.plaque} ${styles.elsa}`} data-genre={offre.genre} aria-label="Cadeau d'Elsa">
      <div className={styles.elsaTete}>
        <b>ELSA · TRUCK MUCHE</b>
        <span className={styles.elsaDistance}>
          <span ref={fleche} className={styles.elsaFleche} aria-hidden="true">➤</span>
          <span ref={distance} />
        </span>
      </div>
      <p className={styles.elsaTexte}><span aria-hidden="true">{genreMarque} </span>{texte}</p>
      <div className={styles.elsaBarre} role="progressbar" aria-label="Temps restant de l'offre" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(part * 100)}>
        <i style={{ width: `${part * 100}%` }} />
      </div>
      <span className={styles.elsaTemps}>{formatSecondes(restantMs / 1000)}</span>
    </section>
  );
}

const AnnoncesElsa = memo(AnnoncesElsaBrutes);
export default AnnoncesElsa;
