"use client";

import { libelleTouche, type Action, type ConfigTouches } from "@/lib/fps/touches";
import styles from "../HudArene.module.css";

/**
 * Aide du premier lancement (12 s après la prise de la souris), construite d'après les touches RÉELLES du joueur : une dizaine de commandes
 * sur deux colonnes, posée au-dessus du bas centre pour ne chevaucher ni le bloc vie ni le bloc armes. La dernière ligne rappelle où se règle
 * la mini-carte (HUD §4.5).
 */
export interface PropsAideCommandes {
  touches: ConfigTouches;
  disposition: ReadonlyMap<string, string> | null;
}

/** Touche principale d'une action (sinon la seconde), « » si aucune : pour les aides à l'écran. */
export function toucheDe(cfg: ConfigTouches, a: Action, d?: ReadonlyMap<string, string> | null): string {
  const e = cfg[a];
  const code = e?.[0] ?? e?.[1] ?? null;
  return code === null ? "" : libelleTouche(code, d);
}

export function commandes(cfg: ConfigTouches, d: ReadonlyMap<string, string> | null): [string, string][] {
  const t = (a: Action) => toucheDe(cfg, a, d);
  return [
    [[t("avant"), t("gauche"), t("arriere"), t("droite")].filter(Boolean).join(" "), "Se déplacer"],
    ["Souris", "Viser"],
    [t("tir"), "Tirer (maintenir : rafale)"],
    [t("visee"), "Viser / lunette"],
    [t("saut"), "Sauter, double saut, saut de mur ; en voiture : déraper"],
    [t("sprint"), "Sprinter"],
    [t("accroupi"), "S'accroupir (en sprint : glissade)"],
    [t("recharger"), "Recharger"],
    [[t("armePrincipale"), t("armeSecondaire"), t("couteau"), t("armeSpeciale")].filter(Boolean).join(" "), "Changer d'arme (3 : couteau ou épée)"],
    [t("couteauRapide"), "Arme blanche rapide (rappuyer : retour)"],
    [t("interagir"), "Monter / descendre d'une voiture"],
    [t("scores"), "Scores (maintenir)"],
    [t("carte"), "Grande carte (maintenir)"],
  ];
}

export default function AideCommandes({ touches, disposition }: PropsAideCommandes) {
  return (
    <div className={`${styles.plaque} ${styles.aide}`}>
      <div className={styles.aideListe}>
        {commandes(touches, disposition).filter(([k]) => k).map(([k, v]) => (<p key={v}><kbd>{k}</kbd> {v}</p>))}
      </div>
      <p className={styles.aideMinimap}>Mini-carte : Échap &gt; Interface pour la déplacer</p>
    </div>
  );
}
