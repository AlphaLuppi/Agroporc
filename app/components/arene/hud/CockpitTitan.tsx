"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { EtatMonstresHud } from "@/lib/fps/jeu-types";
import { formatSecondes } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Cockpit du titan tigre (v3) : on pilote à la première personne, DANS le robot. Calque SVG léger (aucun coût 3D) : poutre haute,
 * montants fins en biais sur les côtés, console basse, armature de la vitre, deux écrans (intégrité du titan, recharge du dash) et le
 * temps restant ; consignes 8 s à la prise des commandes. La vitre centrale reste dégagée (≈ 80 % de l'écran).
 */
export interface PropsCockpitTitan {
  monstres(): EtatMonstresHud | null;
  maintenantServeur(): number;
}

function CockpitTitanBrut({ monstres, maintenantServeur }: PropsCockpitTitan) {
  const [etat, setEtat] = useState<EtatMonstresHud | null>(null);
  const [maintenant, setMaintenant] = useState(0);
  const [aide, setAide] = useState(true);
  const lire = useRef(monstres);
  lire.current = monstres;
  const horloge = useRef(maintenantServeur);
  horloge.current = maintenantServeur;
  useEffect(() => {
    const id = setInterval(() => { setEtat(lire.current()); setMaintenant(horloge.current()); }, 120);
    const m = setTimeout(() => setAide(false), 8000);
    return () => { clearInterval(id); clearTimeout(m); };
  }, []);
  const ti = etat?.titan ?? null;
  const pv = ti ? Math.max(0, ti.pv / Math.max(1, ti.pvMax)) : 1;
  const dash = ti?.dash ?? 1;

  return (
    <div className={styles.cockpit} aria-hidden="true">
      <svg className={styles.cockpitSvg} viewBox="0 0 1600 900" preserveAspectRatio="none">
        {/* poutre haute, montants latéraux, console basse */}
        <polygon className={styles.cockpitPanneau} points="0,0 1600,0 1600,46 1260,74 340,74 0,46" />
        <polygon className={styles.cockpitPanneau} points="0,46 92,52 150,520 104,900 0,900" />
        <polygon className={styles.cockpitPanneau} points="1600,46 1508,52 1450,520 1496,900 1600,900" />
        <polygon className={styles.cockpitPanneau} points="0,900 1600,900 1600,848 1180,808 420,808 0,848" />
        {/* armature de la vitre (traits fins) */}
        <polyline className={styles.cockpitArmature} points="340,74 300,180 360,808" />
        <polyline className={styles.cockpitArmature} points="1260,74 1300,180 1240,808" />
        <line className={styles.cockpitArmature} x1="560" y1="74" x2="600" y2="40" />
        <line className={styles.cockpitArmature} x1="1040" y1="74" x2="1000" y2="40" />
        {/* voyants de la poutre */}
        {[620, 660, 700, 900, 940, 980].map((x, i) => (
          <rect key={x} className={i % 3 === 1 ? styles.cockpitVoyantAmbre : styles.cockpitVoyant} x={x} y={18} width={22} height={10} />
        ))}
      </svg>
      <div className={`${styles.cockpitEcran} ${styles.cockpitEcranGauche}`}>
        <span>INTÉGRITÉ</span>
        <i className={styles.cockpitJauge}><b style={{ height: `${pv * 100}%` }} data-bas={pv < 0.3 ? "oui" : "non"} /></i>
        <span>{ti ? Math.round(ti.pv) : "—"}</span>
      </div>
      <div className={`${styles.cockpitEcran} ${styles.cockpitEcranDroite}`}>
        <span>DASH</span>
        <i className={styles.cockpitJauge}><b style={{ height: `${dash * 100}%` }} data-pret={dash >= 1 ? "oui" : "non"} /></i>
        <span>{dash >= 1 ? "PRÊT" : "…"}</span>
      </div>
      <div className={styles.cockpitConsole}>
        <b>TITAN TIGRE</b>
        <span>{ti ? formatSecondes(Math.max(0, ti.finT - maintenant) / 1000) : ""}</span>
        {aide && <em>Clic : canon · Maj : dash · Espace : saut (on écrase en retombant, on monte sur les toits)</em>}
      </div>
    </div>
  );
}

const CockpitTitan = memo(CockpitTitanBrut);
export default CockpitTitan;
