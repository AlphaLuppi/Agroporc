"use client";

import { useEffect, useState } from "react";
import type { InfoTueur, JoueurPublic } from "@/lib/fps/protocole";
import { ZOMBIES } from "@/lib/fps/zombies-vagues";
import { formatSecondes, secondesAvant } from "@/lib/fps/hud-modele";
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
 * Zombies (`hud.mode === "zombies"`) : ni rejeu, ni carte du tueur, ni choix d'équipement. « À TERRE » avec la barre de saignement (temps
 * avant l'élimination, `terreFinT`) tant qu'un coéquipier peut relever, puis « ÉLIMINÉ » avec le retour à la prochaine pause.
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
  /** (zombies) horodatage serveur de l'élimination d'un joueur à terre (0 = inconnu) */
  terreFinT?: number;
  /** (zombies) horloge serveur du saignement */
  maintenantServeur?(): number;
}

/** Barre de saignement : temps restant avant l'élimination, qui se vide ; le texte est écrit (jamais la barre seule). */
function BarreSaignement({ terreFinT, maintenantServeur }: { terreFinT: number; maintenantServeur: () => number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(i);
  }, []);
  const restantMs = Math.max(0, terreFinT - maintenantServeur());
  const part = Math.max(0, Math.min(1, restantMs / (ZOMBIES.terreMs)));
  return (
    <>
      <p className={styles.reapparition}>Éliminé dans <b>{formatSecondes(secondesAvant(terreFinT, maintenantServeur()))}</b></p>
      <div className={styles.barreSaignement} role="progressbar" aria-label="Temps avant l'élimination" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(part * 100)}>
        <i style={{ width: `${part * 100}%` }} />
      </div>
    </>
  );
}

export default function EcranMort({
  hud, derniereMort, killcamInfo, degatsAuTueur, touches, equipement, surEquipement, surPasserKillcam, joueurs, aideEquipement, terreFinT = 0, maintenantServeur,
}: PropsEcranMort) {
  const disposition = useDisposition();
  if (!hud.mort) return null;
  if (hud.mode === "zombies") {
    if (hud.aTerre) {
      return (
        <div className={styles.repli}>
          <section className={styles.carte} aria-label="À terre">
            <h2 className={styles.titre} role="status">À terre</h2>
            <p className={styles.degats}>Un coéquipier peut vous relever : il maintient la touche d&apos;action à moins de {ZOMBIES.reanimationPortee} m pendant {ZOMBIES.reanimationS} s.</p>
            {terreFinT > 0 && maintenantServeur ? <BarreSaignement terreFinT={terreFinT} maintenantServeur={maintenantServeur} /> : <p className={styles.reapparition}>Sans relève, vous serez éliminé.</p>}
          </section>
        </div>
      );
    }
    if (hud.elimine) {
      return (
        <div className={styles.repli}>
          <section className={styles.carte} aria-label="Éliminé">
            <h2 className={styles.titre} role="status">Éliminé</h2>
            <p className={styles.degats}>Retour à la prochaine pause entre deux manches, avec l&apos;équipement de départ.</p>
          </section>
        </div>
      );
    }
    return <div className={styles.repli}><p className={styles.statut} role="status">Apparition…</p></div>;
  }
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
