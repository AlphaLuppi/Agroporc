"use client";

import type { InfoTueur, JoueurPublic } from "@/lib/fps/protocole";
import type { HudEtat } from "@/lib/fps/jeu-types";
import type { ConfigTouches } from "@/lib/fps/touches";
import ChoixEquipement from "../ChoixEquipement";
import { useDisposition } from "../ReglageTouches";
import { toucheDe } from "./AideCommandes";
import Killcam from "../Killcam";
import type { DerniereMort, EquipementChoisi } from "../contrats";
import CarteTueur from "./CarteTueur";
import styles from "./EcranMort.module.css";

/**
 * Écran de mort (§5.5, §9), selon `hud.killcamPhase` :
 *  - `"rejeu"` : bandes noires, légende, bouton Passer, barre de progression (`Killcam`), titre « ÉLIMINÉ » et le choix d'équipement
 *    compact (pour la prochaine apparition) ;
 *  - `"carte"` : mêmes bandes, `CarteTueur` entre les deux ;
 *  - `""` avec `hud.mort` (repli sans rejeu : tueur absent du tampon, écrasé par un PNJ) : `CarteTueur` seule, sans bandes.
 * Le HUD de combat est masqué par l'orchestrateur pendant tout ceci (`hidden`). Rien hors mort.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 */
export interface PropsEcranMort {
  hud: HudEtat;
  derniereMort: DerniereMort | null;
  killcamInfo: InfoTueur | null;
  degatsAuTueur: number;
  /** touches du joueur : libellé de « Passer » (action `passer`, Espace par défaut) */
  touches: ConfigTouches;
  equipement: EquipementChoisi;
  surEquipement(principale: EquipementChoisi["principale"], secondaire: EquipementChoisi["secondaire"], melee?: EquipementChoisi["melee"]): void;
  surPasserKillcam(): void;
  /** présence : K et M du tueur sur sa carte (facultatif) */
  joueurs?: readonly Pick<JoueurPublic, "id" | "kills" | "morts">[];
  /** « 1 : arme principale suivante · 2 : … » : la souris est prise, les boutons du sélecteur ne sont pas cliquables (vide : rien) */
  aideEquipement?: string;
}

export default function EcranMort({
  hud, derniereMort, killcamInfo, degatsAuTueur, touches, equipement, surEquipement, surPasserKillcam, joueurs, aideEquipement,
}: PropsEcranMort) {
  const disposition = useDisposition();
  if (!hud.mort) return null;
  const phase = hud.killcamPhase;
  const tueurJoueur = joueurs?.find((j) => j.id === killcamInfo?.id) ?? null;
  const km = tueurJoueur ? { kills: tueurJoueur.kills, morts: tueurJoueur.morts } : null;
  const carte = (
    <CarteTueur tueur={killcamInfo} derniereMort={derniereMort} degatsAuTueur={degatsAuTueur} reapparitionDans={hud.reapparitionDans} kmTueur={km} />
  );
  const choix = (
    <div className={styles.equipement}>
      <p className={styles.equipementTitre}>Équipement de la prochaine apparition</p>
      {aideEquipement && <p className={styles.equipementAide}>{aideEquipement}</p>}
      <ChoixEquipement
        principale={equipement.principale}
        secondaire={equipement.secondaire}
        melee={equipement.melee}
        surChanger={surEquipement}
        variante="compact"
        idGroupe="mort"
      />
    </div>
  );

  if (phase === "rejeu" || phase === "carte") {
    return (
      <div className={styles.ecran}>
        <Killcam
          phase={phase}
          progression={Math.max(0, hud.killcam)}
          tueur={killcamInfo}
          derniereMort={derniereMort}
          surPasser={surPasserKillcam}
          touchePasser={toucheDe(touches, "passer", disposition)}
          reapparitionDans={hud.reapparitionDans}
        >
          {phase === "carte" && carte}
          {choix}
        </Killcam>
      </div>
    );
  }

  // repli sans rejeu : la carte seule (4 s), ou « Apparition… » quand rien n'est connu
  const apparition = hud.reapparitionDans <= 0 && !derniereMort && !killcamInfo;
  return (
    <div className={styles.repli}>
      {apparition ? <p className={styles.statut} role="status">Apparition…</p> : carte}
      {choix}
    </div>
  );
}
