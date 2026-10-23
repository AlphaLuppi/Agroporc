"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { EtatMonstresHud } from "@/lib/fps/jeu-types";
import { formatSecondes } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Cockpit du titan tigre (v3) : on pilote à la première personne, DANS le robot. Calque CSS adaptatif, aucun coût 3D : verrière haute,
 * montants inclinés, cadre de visée, vitre (vignette, reflet, lignes de balayage) et tableau de bord à trois écrans (intégrité segmentée ;
 * compas, vitesse, altitude et temps ; dash et saut). Formes en `clip-path` en pourcentages et tailles en `clamp()` : il
 * tient sur un téléphone en portrait comme sur un écran large, sans jamais déformer. Flash rouge à chaque coup encaissé, alerte sous 25 %.
 * Lit `monstres()` toutes les 80 ms.
 */
export interface PropsCockpitTitan {
  monstres(): EtatMonstresHud | null;
  maintenantServeur(): number;
}

const SEGMENTS = 20;
const KMH = 3.6;
const POINTS_CARDINAUX: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SO", 270: "O", 315: "NO" };
/** Demi-champ du compas (°). */
const DEMI_COMPAS = 60;

/** Cap en degrés, sens horaire depuis le nord (−z) : lacet 0 = nord, lacet −π/2 = est (+x). */
const capDegres = (lacet: number) => ((((-lacet * 180) / Math.PI) % 360) + 360) % 360;

function CockpitTitanBrut({ monstres, maintenantServeur }: PropsCockpitTitan) {
  const [etat, setEtat] = useState<EtatMonstresHud | null>(null);
  const [maintenant, setMaintenant] = useState(0);
  const [aide, setAide] = useState(true);
  const [choc, setChoc] = useState(0);
  const lire = useRef(monstres);
  lire.current = monstres;
  const horloge = useRef(maintenantServeur);
  horloge.current = maintenantServeur;
  const pvAvant = useRef<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const e = lire.current();
      const pv = e?.titan?.pv ?? null;
      // coup encaissé : la vitre rougit (clé nouvelle = animation rejouée)
      if (pv !== null && pvAvant.current !== null && pv < pvAvant.current - 0.5) setChoc((c) => c + 1);
      pvAvant.current = pv;
      setEtat(e);
      setMaintenant(horloge.current());
    }, 80);
    const m = setTimeout(() => setAide(false), 8000);
    return () => { clearInterval(id); clearTimeout(m); };
  }, []);
  const ti = etat?.titan ?? null;
  const pv = ti ? Math.max(0, ti.pv / Math.max(1, ti.pvMax)) : 1;
  const dash = ti?.dash ?? 1;
  const critique = pv < 0.25;
  const cap = capDegres(ti?.cap ?? 0);
  const allumes = Math.ceil(pv * SEGMENTS);

  // graduations du compas visibles : tous les 15°, position en % de la bande
  const graduations: { deg: number; x: number; nom?: string }[] = [];
  for (let d = Math.ceil((cap - DEMI_COMPAS) / 15) * 15; d <= cap + DEMI_COMPAS; d += 15) {
    const n = ((d % 360) + 360) % 360;
    graduations.push({ deg: n, x: 50 + ((d - cap) / DEMI_COMPAS) * 50, nom: POINTS_CARDINAUX[n] });
  }

  return (
    <div className={styles.cockpit} data-critique={critique ? "oui" : "non"} aria-hidden="true">
      <div className={styles.cockpitVitre} />
      {choc > 0 && <div key={choc} className={styles.cockpitChoc} />}
      <div className={styles.cockpitCadre}>
        <div className={styles.cockpitCanopee} />
        <div className={styles.cockpitMontant} data-cote="g" />
        <div className={styles.cockpitMontant} data-cote="d" />
        <div className={styles.cockpitTableau} />
      </div>

      <div className={styles.cockpitVisee}><i /><i /><i /><i /></div>

      <div className={styles.cockpitBord}>
        <section className={styles.cockpitEcran} data-alerte={critique ? "oui" : "non"}>
          <header>INTÉGRITÉ</header>
          <div className={styles.cockpitSegments}>
            {Array.from({ length: SEGMENTS }, (_, i) => <i key={i} data-on={i < allumes ? "oui" : "non"} />)}
          </div>
          <strong>{ti ? Math.round(ti.pv) : "—"}<small> / {ti ? ti.pvMax : "—"}</small></strong>
        </section>
        <section className={`${styles.cockpitEcran} ${styles.cockpitEcranCentre}`}>
          <div className={styles.cockpitCompas}>
            {graduations.map((g) => (
              <span key={g.deg} style={{ left: `${g.x}%` }} data-nom={g.nom ? "oui" : "non"}>{g.nom ?? ""}</span>
            ))}
            <b>{Math.round(cap).toString().padStart(3, "0")}</b>
          </div>
          <div className={styles.cockpitMesures}>
            <span><strong>{Math.round((ti?.vitesse ?? 0) * KMH)}</strong><small>km/h</small></span>
            <span><strong>{Math.round(ti?.altitude ?? 0)}</strong><small>m alt.</small></span>
            <span><strong className={styles.cockpitTemps}>{ti ? formatSecondes(Math.max(0, ti.finT - maintenant) / 1000) : ""}</strong><small>titan</small></span>
          </div>
        </section>
        <section className={styles.cockpitEcran} data-pret={dash >= 1 ? "oui" : "non"}>
          <header>DASH</header>
          <div className={styles.cockpitDash}><i style={{ width: `${dash * 100}%` }} /></div>
          <strong>{dash >= 1 ? "PRÊT" : "RECHARGE"}</strong>
          <small className={styles.cockpitTouche}>Maj · dash · Espace · saut</small>
        </section>
      </div>

      {critique && <p className={styles.cockpitAlerte}>INTÉGRITÉ CRITIQUE</p>}
      {aide && <p className={styles.cockpitAide}>Clic : canon · Maj : dash · Espace : saut (on écrase en retombant, on monte sur les toits)</p>}
    </div>
  );
}

const CockpitTitan = memo(CockpitTitanBrut);
export default CockpitTitan;
