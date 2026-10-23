"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { EtatMonstresHud } from "@/lib/fps/jeu-types";
import type { JoueurPublic } from "@/lib/fps/protocole";
import { formatSecondes } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Bandeau des événements (v3) : grande alerte à rayures pendant l'annonce (« LE TRUCK MUCHE EST DEVENU FOU ! », « TIGRE ROBOT GÉANT »)
 * avec le compte à rebours, puis une bande compacte pendant l'événement (temps restant du Truck, barre de vie du tigre), et l'état du
 * titan tigre (pilote, PV, temps restant ; consignes si c'est moi). Lit `monstres()` toutes les 150 ms, hors rendu du jeu.
 * Spec : docs/superpowers/specs/2026-10-24-arene-evenements-design.md
 */
export interface PropsBandeauEvenement {
  monstres(): EtatMonstresHud | null;
  maintenantServeur(): number;
  joueurs: JoueurPublic[];
  monId: string | null;
}

const TEXTES = {
  truck: { titre: "LE TRUCK MUCHE EST DEVENU FOU !", sous: "Il fonce sur tout le monde. Courez, montez sur un toit !", court: "TRUCK MUCHE FOU", icone: "🚚" },
  tigre: { titre: "ALERTE : TIGRE ROBOT GÉANT", sous: "Celui qui l'achève prend les commandes du TITAN TIGRE", court: "TIGRE ROBOT", icone: "🐯" },
} as const;

function BandeauEvenementBrut({ monstres, maintenantServeur, joueurs, monId }: PropsBandeauEvenement) {
  const [etat, setEtat] = useState<EtatMonstresHud | null>(null);
  const [maintenant, setMaintenant] = useState(0);
  const lire = useRef(monstres);
  lire.current = monstres;
  const horloge = useRef(maintenantServeur);
  horloge.current = maintenantServeur;
  /** consignes du pilote : affichées 8 s à la prise du titan */
  const [aideTitan, setAideTitan] = useState(false);
  const piloteDepuis = useRef<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setEtat(lire.current());
      setMaintenant(horloge.current());
    }, 150);
    return () => clearInterval(id);
  }, []);

  const cleTitan = etat?.titan && etat.titan.pilote === monId ? `${etat.titan.finT}` : null;
  useEffect(() => {
    if (!cleTitan || piloteDepuis.current === cleTitan) return;
    piloteDepuis.current = cleTitan;
    setAideTitan(true);
    const m = setTimeout(() => setAideTitan(false), 8000);
    return () => clearTimeout(m);
  }, [cleTitan]);

  if (!etat) return null;
  const ev = etat.evenement;
  const titan = etat.titan;
  const pseudo = (id: string) => joueurs.find((j) => j.id === id)?.pseudo ?? "Un agent";

  return (
    <>
      {ev && ev.phase === "annonce" && (
        <section className={styles.evtAlerte} data-type={ev.type} role="alert" aria-label={TEXTES[ev.type].titre}>
          <div className={styles.evtRayures} aria-hidden="true" />
          <p className={styles.evtTitre}><span aria-hidden="true">{TEXTES[ev.type].icone} </span>{TEXTES[ev.type].titre}</p>
          <p className={styles.evtSous}>{TEXTES[ev.type].sous}</p>
          <p className={styles.evtCompte}>dans {Math.max(0, Math.ceil((ev.debutT - maintenant) / 1000))} s</p>
        </section>
      )}
      {ev && ev.phase === "actif" && (
        <div className={`${styles.plaque} ${styles.evtBande}`} data-type={ev.type}>
          <span className={styles.evtBandeTitre}>
            <span aria-hidden="true">{TEXTES[ev.type].icone} </span>{TEXTES[ev.type].court}
            {ev.type === "tigre" && etat.tigre?.rage && <span className={styles.evtRage}> · ENRAGÉ</span>}
          </span>
          {ev.type === "tigre" && etat.tigre && (
            <span className={styles.evtVie} role="progressbar" aria-label="Vie du tigre robot" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={Math.round((100 * etat.tigre.pv) / Math.max(1, etat.tigre.pvMax))}>
              <i style={{ width: `${(100 * etat.tigre.pv) / Math.max(1, etat.tigre.pvMax)}%` }} />
            </span>
          )}
          <span className={styles.evtTemps}>{formatSecondes(Math.max(0, ev.finT - maintenant) / 1000)}</span>
        </div>
      )}
      {titan && (
        <div className={`${styles.plaque} ${styles.evtBande} ${styles.evtTitan}`} data-moi={titan.pilote === monId ? "oui" : "non"}>
          <span className={styles.evtBandeTitre}>
            <span aria-hidden="true">🐯 </span>
            {titan.pilote === monId ? "TU PILOTES LE TITAN TIGRE" : `TITAN TIGRE · ${pseudo(titan.pilote)}`}
          </span>
          <span className={styles.evtVie} role="progressbar" aria-label="Vie du titan" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round((100 * titan.pv) / Math.max(1, titan.pvMax))}>
            <i style={{ width: `${(100 * titan.pv) / Math.max(1, titan.pvMax)}%` }} />
          </span>
          <span className={styles.evtTemps}>{formatSecondes(Math.max(0, titan.finT - maintenant) / 1000)}</span>
          {titan.pilote === monId && aideTitan && <span className={styles.evtAide}>Clic : canon · Maj : dash · Espace : saut (on écrase en retombant, on monte sur les toits) · invulnérable tant que le titan tient</span>}
        </div>
      )}
    </>
  );
}

const BandeauEvenement = memo(BandeauEvenementBrut);
export default BandeauEvenement;
