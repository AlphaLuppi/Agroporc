"use client";

import { LIBELLES_ACTIONS, type Action, type ConfigTouches } from "@/lib/fps/touches";
import type { ReglagesHud } from "@/lib/fps/reglages-hud";
import type { ArmeMeleeId, ArmePrincipaleId, ArmeSecondaireId, ModeSalle } from "@/lib/fps/protocole";
import type { ReglagesVoix } from "@/lib/fps/voix";
import type { EquipementChoisi } from "../contrats";
import ChoixEquipement from "../ChoixEquipement";
import ReglageTouches from "../ReglageTouches";
import ReglageInterface from "./ReglageInterface";
import styles from "../HudArene.module.css";

/**
 * Menu pause (Échap : la souris est libérée, la partie continue) : Reprendre, équipement de la prochaine apparition (`ChoixEquipement` compact),
 * nom de joueur, sensibilité, accroupi maintenir / basculer, chat vocal de proximité (activé, appuyer pour parler ou micro ouvert, v3 §5),
 * avertissement des actions sans touche, Quitter, puis « Interface » (mini-map,
 * taille, effets) au-dessus des touches groupées. La mini-map reste nette sous le voile pour juger les réglages (HUD §4.5).
 * Battle Royale (`mode` "br") : ni choix d'équipement (on ramasse ce qu'on trouve), chat vocal de proximité entre joueurs en vie et canal à part entre spectateurs, et « Quitter la partie » est un
 * abandon (le joueur est éliminé) tant qu'il n'est pas déjà éliminé (`elimine`).
 * Zombies (`mode`) : la partie continue pour les autres (« les tigres ne s'arrêtent pas »), pas de choix d'équipement (le départ est imposé,
 * les armes s'achètent) et « Quitter la partie » ramène au lobby.
 */
export interface PropsMenuPause {
  premiereFois: boolean;
  surReprendre(): void;
  surQuitter(): void;
  equipement: EquipementChoisi;
  surEquipement(principale: ArmePrincipaleId, secondaire: ArmeSecondaireId, melee?: ArmeMeleeId): void;
  pseudo: string;
  surPseudo(v: string): void;
  sensibilite: number;
  surSensibilite(x: number): void;
  accroupiBascule: boolean;
  surAccroupiBascule(b: boolean): void;
  voix: ReglagesVoix;
  surVoix(r: ReglagesVoix): void;
  voixErreur: string;
  /** libellé de la touche « parler » */
  toucheParler: string;
  actionsSansTouche: Action[];
  touches: ConfigTouches;
  surTouches(cfg: ConfigTouches): void;
  reglagesHud: ReglagesHud;
  surReglagesHud(r: ReglagesHud): void;
  /** mode de la salle (absent = arène) */
  mode?: ModeSalle;
  /** (BR) je suis déjà éliminé : quitter n'est plus un abandon */
  elimine?: boolean;
  /**
   * (v11, zombies) suspension de la partie : `actif` = figée (par `par`, pseudo), `compteS` = secondes restantes avant la reprise (0 = pas de compte à rebours).
   * `enPartie` : une partie est en cours (le bouton « mettre en pause » n'existe que là). `refus` : texte d'un refus de pause.
   */
  suspension?: { actif: boolean; par: string; compteS: number; enPartie: boolean; refus: string };
  /** `true` : suspendre pour tous (ou annuler la reprise en cours) ; `false` : reprendre la partie (redemande la souris) */
  surPauseZ?(actif: boolean): void;
  /** libellé de la touche de pause des zombies (vide = aucune) */
  touchePause?: string;
}

export default function MenuPause(p: PropsMenuPause) {
  const zombies = p.mode === "zombies";
  const br = p.mode === "br";
  const susp = zombies ? p.suspension : undefined;
  const suspendue = !!susp?.actif;
  return (
    <div className={styles.pause} onClick={(e) => { if (e.target === e.currentTarget) p.surReprendre(); }}>
      <div className={styles.pausePanneau} role="group" aria-label="Menu pause">
        <h2>{suspendue ? "Partie en pause" : p.premiereFois ? "Prêt ?" : "Pause"}</h2>
        <p className={styles.pauseTexte}>{suspendue
          ? `Partie en pause${susp!.par ? ` (par ${susp!.par})` : ""} : tous les joueurs sont figés.`
          : p.premiereFois
          ? "Cliquez pour prendre la souris et jouer."
          : zombies ? "La partie continue : les tigres ne s'arrêtent pas, vos coéquipiers non plus."
          : br ? "La partie continue : la tempête et les autres joueurs ne s'arrêtent pas." : "La partie continue : vous êtes toujours dans l'arène."}</p>
        {suspendue && susp!.compteS > 0 && (
          <p className={styles.pauseCompte} role="status" aria-live="polite">Reprise dans {susp!.compteS}…</p>
        )}
        {suspendue ? (
          <>
            {/* « Reprendre la partie » lève la suspension pour tous ; « Reprendre » ci-dessous ne fait que re-verrouiller la souris */}
            <button type="button" className={styles.reprendre} autoFocus disabled={susp!.compteS > 0} onClick={() => p.surPauseZ?.(false)}>Reprendre la partie</button>
            {susp!.compteS > 0 && (
              <button type="button" className={styles.reprendreSouris} onClick={() => p.surPauseZ?.(true)}>Annuler la reprise</button>
            )}
            <button type="button" className={styles.reprendreSouris} onClick={p.surReprendre}>Reprendre la souris</button>
          </>
        ) : (
          <button type="button" className={styles.reprendre} autoFocus onClick={p.surReprendre}>{p.premiereFois ? "Jouer" : "Reprendre"}</button>
        )}
        {zombies && !suspendue && !p.premiereFois && susp?.enPartie && (
          <button type="button" className={styles.pauseTous} onClick={() => p.surPauseZ?.(true)}>Mettre la partie en pause pour tous{p.touchePause ? ` (${p.touchePause})` : ""}</button>
        )}
        {susp?.refus && <p className={styles.avertissement} role="alert">{susp.refus}</p>}
        {!zombies && !br && (
          <div className={styles.pauseArmes}>
            <span>Équipement de la prochaine apparition</span>
            <ChoixEquipement
              principale={p.equipement.principale}
              secondaire={p.equipement.secondaire}
              melee={p.equipement.melee}
              surChanger={p.surEquipement}
              variante="compact"
              idGroupe="pause"
            />
          </div>
        )}
        <label className={styles.sens}>
          <span>Nom de joueur</span>
          <input
            type="text"
            className={styles.nom}
            value={p.pseudo}
            maxLength={16}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => p.surPseudo(e.target.value)}
          />
        </label>
        <label className={styles.sens}>
          <span>Sensibilité de la souris <b>{p.sensibilite.toFixed(1)}</b></span>
          <input type="range" min={0.2} max={3} step={0.1} value={p.sensibilite} onChange={(e) => p.surSensibilite(Number(e.target.value))} />
        </label>
        <label className={styles.caseLigne}>
          <input type="checkbox" checked={p.accroupiBascule} onChange={(e) => p.surAccroupiBascule(e.target.checked)} />
          <span>Accroupi : basculer (sinon maintenir)</span>
        </label>
        <fieldset className={styles.voixReglage}>
          <legend>Chat vocal de proximité</legend>
          <label className={styles.caseLigne}>
            <input type="checkbox" checked={p.voix.actif} onChange={(e) => p.surVoix({ ...p.voix, actif: e.target.checked })} />
            <span>{br
              ? (p.elimine
                ? "Activer le micro : parler avec les autres spectateurs (les joueurs en vie ne vous entendent pas)"
                : "Activer le micro et entendre les joueurs proches (les spectateurs ne vous parlent pas)")
              : "Activer le micro et entendre les joueurs proches (et son tueur pendant la killcam)"}</span>
          </label>
          <div className={styles.voixModes} role="radiogroup" aria-label="Mode du micro">
            <label className={styles.caseLigne}>
              <input type="radio" name="voix-mode" checked={p.voix.mode === "appuyer"} onChange={() => p.surVoix({ ...p.voix, mode: "appuyer" })} />
              <span>Appuyer pour parler{p.toucheParler && p.toucheParler !== "—" ? ` (${p.toucheParler})` : ""}</span>
            </label>
            <label className={styles.caseLigne}>
              <input type="radio" name="voix-mode" checked={p.voix.mode === "ouvert"} onChange={() => p.surVoix({ ...p.voix, mode: "ouvert" })} />
              <span>Micro toujours ouvert</span>
            </label>
          </div>
          {p.voixErreur && <p className={styles.avertissement} role="alert">{p.voixErreur}</p>}
        </fieldset>
        {p.actionsSansTouche.length > 0 && (
          <p className={styles.avertissement} role="alert">
            Sans touche : {p.actionsSansTouche.map((a) => LIBELLES_ACTIONS[a]).join(", ")}. Assignez-en une ci-dessous.
          </p>
        )}
        {br && !p.elimine && <p className={styles.pauseTexte}>Quitter la partie compte comme un abandon : vous serez éliminé.</p>}
        <button type="button" className={styles.quitter} onClick={p.surQuitter}>{zombies || br ? "Quitter la partie" : "Quitter l'arène"}</button>
        <ReglageInterface reglages={p.reglagesHud} surReglages={p.surReglagesHud} />
        <ReglageTouches config={p.touches} surChange={p.surTouches} />
      </div>
    </div>
  );
}
