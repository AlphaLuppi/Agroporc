"use client";

import { memo } from "react";
import type { ModeVoix } from "@/lib/fps/voix";
import styles from "../HudArene.module.css";

/**
 * Chat vocal de proximité (v3 §5), au-dessus de la ligne de course : état du micro (« T : parler », « micro ouvert », allumé quand il émet)
 * et, s'il y en a, les joueurs qu'on entend parler en ce moment. Texte d'état, pas d'annonce vocale (`aria-live` off : il change sans cesse).
 */
export interface PropsBlocVoix {
  etat: "pret" | "emet";
  /** pseudos séparés par « · », "" = personne */
  parlants: string;
  mode: ModeVoix;
  toucheParler: string;
}

function BlocVoixBrut({ etat, parlants, mode, toucheParler }: PropsBlocVoix) {
  const libelle = mode === "ouvert" ? "Micro ouvert" : toucheParler && toucheParler !== "—" ? `${toucheParler} : parler` : "Micro";
  return (
    <div className={styles.voix} data-emet={etat === "emet" ? "oui" : undefined}>
      <span className={styles.voixMicro}><i aria-hidden="true" />{etat === "emet" ? "Vous parlez" : libelle}</span>
      {parlants && <span className={styles.voixParlants}>{parlants}</span>}
    </div>
  );
}

const BlocVoix = memo(BlocVoixBrut);
export default BlocVoix;
