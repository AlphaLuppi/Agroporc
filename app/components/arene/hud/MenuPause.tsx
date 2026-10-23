"use client";

import { LIBELLES_ACTIONS, type Action, type ConfigTouches } from "@/lib/fps/touches";
import type { ReglagesHud } from "@/lib/fps/reglages-hud";
import type { ArmePrincipaleId, ArmeSecondaireId } from "@/lib/fps/protocole";
import type { EquipementChoisi } from "../contrats";
import ChoixEquipement from "../ChoixEquipement";
import ReglageTouches from "../ReglageTouches";
import ReglageInterface from "./ReglageInterface";
import styles from "../HudArene.module.css";

/**
 * Menu pause (Échap : la souris est libérée, la partie continue) : Reprendre, équipement de la prochaine apparition (`ChoixEquipement` compact),
 * nom de joueur, sensibilité, accroupi maintenir / basculer, avertissement des actions sans touche, Quitter, puis « Interface » (mini-map,
 * taille, effets) au-dessus des touches groupées. La mini-map reste nette sous le voile pour juger les réglages (HUD §4.5).
 */
export interface PropsMenuPause {
  premiereFois: boolean;
  surReprendre(): void;
  surQuitter(): void;
  equipement: EquipementChoisi;
  surEquipement(principale: ArmePrincipaleId, secondaire: ArmeSecondaireId): void;
  pseudo: string;
  surPseudo(v: string): void;
  sensibilite: number;
  surSensibilite(x: number): void;
  accroupiBascule: boolean;
  surAccroupiBascule(b: boolean): void;
  actionsSansTouche: Action[];
  touches: ConfigTouches;
  surTouches(cfg: ConfigTouches): void;
  reglagesHud: ReglagesHud;
  surReglagesHud(r: ReglagesHud): void;
}

export default function MenuPause(p: PropsMenuPause) {
  return (
    <div className={styles.pause} onClick={(e) => { if (e.target === e.currentTarget) p.surReprendre(); }}>
      <div className={styles.pausePanneau} role="group" aria-label="Menu pause">
        <h2>{p.premiereFois ? "Prêt ?" : "Pause"}</h2>
        <p className={styles.pauseTexte}>{p.premiereFois ? "Cliquez pour prendre la souris et jouer." : "La partie continue : vous êtes toujours dans l'arène."}</p>
        <button type="button" className={styles.reprendre} autoFocus onClick={p.surReprendre}>{p.premiereFois ? "Jouer" : "Reprendre"}</button>
        <div className={styles.pauseArmes}>
          <span>Équipement de la prochaine apparition</span>
          <ChoixEquipement
            principale={p.equipement.principale}
            secondaire={p.equipement.secondaire}
            surChanger={p.surEquipement}
            variante="compact"
            idGroupe="pause"
          />
        </div>
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
        {p.actionsSansTouche.length > 0 && (
          <p className={styles.avertissement} role="alert">
            Sans touche : {p.actionsSansTouche.map((a) => LIBELLES_ACTIONS[a]).join(", ")}. Assignez-en une ci-dessous.
          </p>
        )}
        <button type="button" className={styles.quitter} onClick={p.surQuitter}>Quitter l&apos;arène</button>
        <ReglageInterface reglages={p.reglagesHud} surReglages={p.surReglagesHud} />
        <ReglageTouches config={p.touches} surChange={p.surTouches} />
      </div>
    </div>
  );
}
