"use client";

import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { JEU } from "@/lib/fps/protocole";
import { formatSecondes, libellePvBas, niveauPv } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Bloc vie (bas-gauche, §5.1) : PV en grand + « PV », jauge continue de 10 segments (un par 10 PV) qui change de teinte ET de motif
 * (cyan, ambre, danger hachuré + libellé « PV BAS »), barre fantôme qui reste 600 ms derrière la barre quand on perd des PV, trait de
 * délai de régénération (`--regen`, écrit hors React) puis « RÉGÉNÉRATION +20/s », bouclier en 4 cellules de 25 hachurées avec
 * « BOUCLIER 62 » (la ligne disparaît à 0 après un flash), puces d'état écrites (ACCROUPI, GLISSE, WALL-RUN, PROTÉGÉ 2,5 s).
 * Ne reçoit que des scalaires : seul un changement de ces valeurs le rend.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 */
export interface PropsBlocVie {
  pv: number;
  bouclier: number;
  /** les PV remontent (délai de 5 s écoulé et PV < max) */
  regen: boolean;
  accroupi: boolean;
  glisse: boolean;
  mur: boolean;
  /** s de protection d'apparition restantes, 0 = pas protégé */
  protegeRestant: number;
  /** le bouclier vient de se rompre : flash de la barre */
  rupture: boolean;
  refTraitRegen: RefObject<HTMLDivElement | null>;
}

const FANTOME_MS = 600;

/** Part (0..100) de la jauge remplie. */
const pourcent = (pv: number) => Math.max(0, Math.min(100, (pv / JEU.pvMax) * 100));

function BlocVieBrut({ pv, bouclier, regen, accroupi, glisse, mur, protegeRestant, rupture, refTraitRegen }: PropsBlocVie) {
  const niveau = niveauPv(pv);
  // barre fantôme : suit tout de suite une hausse, attend 600 ms avant de rejoindre une baisse
  const [fantome, setFantome] = useState(pv);
  const fantomeRef = useRef(pv);
  useEffect(() => {
    if (pv >= fantomeRef.current) { fantomeRef.current = pv; setFantome(pv); return; }
    const m = setTimeout(() => { fantomeRef.current = pv; setFantome(pv); }, FANTOME_MS);
    return () => clearTimeout(m);
  }, [pv]);

  const puces: string[] = [];
  if (accroupi) puces.push("ACCROUPI");
  if (glisse) puces.push("GLISSE");
  if (mur) puces.push("WALL-RUN");
  if (protegeRestant > 0) puces.push(`PROTÉGÉ ${formatSecondes(protegeRestant)}`);

  const montrerBouclier = bouclier > 0 || rupture;
  const pvFr = Math.round(pv);

  return (
    <section className={`${styles.plaque} ${styles.vie}`} data-niveau={niveau} aria-label="Santé">
      {puces.length > 0 && (
        <ul className={styles.puces} aria-label="État">
          {puces.map((p) => (<li key={p}>{p}</li>))}
        </ul>
      )}
      <div className={styles.pvLigne}>
        <b className={styles.pvNum}>{pvFr}</b>
        <span className={styles.pvUnite}>PV</span>
        {libellePvBas(pv) && <span className={styles.pvBas}>PV BAS</span>}
      </div>
      <div className={styles.jaugePv}>
        <i className={styles.jaugeFantome} style={{ width: `${pourcent(fantome)}%` }} />
        <i className={styles.jaugeRemplie} style={{ width: `${pourcent(pv)}%` }} />
        <i className={styles.jaugeSegments} />
      </div>
      <div className={styles.delaiRegen} data-actif={!regen && pv < JEU.pvMax ? "oui" : "non"} aria-hidden="true">
        <i ref={refTraitRegen} />
      </div>
      {regen && pv < JEU.pvMax && (
        <p className={styles.regen}>
          <span className={styles.regenPlus} aria-hidden="true">+</span>RÉGÉNÉRATION +{JEU.regenPvParS}/s
        </p>
      )}
      {montrerBouclier && (
        <div className={`${styles.bouclier} ${rupture ? styles.bouclierRupture : ""}`}>
          <div className={styles.bouclierCellules} aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <i key={i} style={{ ["--plein" as string]: Math.max(0, Math.min(1, (bouclier - i * 25) / 25)) }} />
            ))}
          </div>
          <p className={styles.bouclierTexte}>BOUCLIER {Math.round(bouclier)}</p>
        </div>
      )}
    </section>
  );
}

const BlocVie = memo(BlocVieBrut);
export default BlocVie;
