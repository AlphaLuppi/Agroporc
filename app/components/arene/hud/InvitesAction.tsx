"use client";

import { memo, type RefObject } from "react";
import type { HudEtat } from "@/lib/fps/jeu-types";
import { manqueInvite } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Invite d'interaction sous le viseur (centre, y = 62 %, une ligne) : « Avance vers Elsa (12 m) » (le cadeau est automatique, sans touche),
 * « [E] Monter (2/4) », « [E] Descendre » avec la touche RÉELLEMENT assignée (« touche non assignée » sinon), ou, à défaut, « [R] RECHARGER »
 * quand le chargeur est critique. Les annonces vocales passent par la région vive, pas par ici.
 * Zombies (v5) : « [E] Pompe — 900 $ », « [E] Ouvrir la porte — 1 250 $ », « [E] Boîte mystère — 950 $ », « [E] Soin — 400 $ » avec, quand l'argent
 * manque, la raison écrite (« Argent insuffisant »), et « [E] Réanimer Léa » avec la mention « maintenir » puis une barre de progression
 * (`--reanim`, écrite hors React) pendant que la touche est tenue.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§5.1, §5.4, §5.8)
 */
export interface PropsInvitesAction {
  invite: HudEtat["invite"];
  /** « 2/4 » pour monter, « 12 m » pour Elsa */
  inviteDetail: string;
  /** libellé de la touche « interagir » (vide = non assignée) */
  toucheInteragir: string;
  /** chargeur critique ou vide hors rechargement */
  inviteRecharge: boolean;
  toucheRecharger: string;
  /** (zombies) argent suffisant pour l'achat proposé (absent = oui) */
  assez?: boolean;
  /** (zombies) je maintiens la touche sur un coéquipier à terre */
  reanime?: boolean;
  /** (zombies) barre de la relève : sa variable `--reanim` est écrite en rAF par `useProgressionReanimation` */
  refReanim?: RefObject<HTMLSpanElement | null>;
}

function Touche({ libelle }: { libelle: string }) {
  return libelle ? <kbd>{libelle}</kbd> : null;
}

function InvitesBrutes({ invite, inviteDetail, toucheInteragir, inviteRecharge, toucheRecharger, assez = true, reanime = false, refReanim }: PropsInvitesAction) {
  if (invite === "acheter" || invite === "porte" || invite === "boite" || invite === "soin" || invite === "atout" || invite === "pap"
    || invite === "courant" || invite === "note") {
    const manque = manqueInvite(inviteDetail, assez);
    return (
      <p className={`${styles.plaque} ${styles.invite}`} data-assez={manque ? "non" : "oui"}>
        <Touche libelle={toucheInteragir} /> {inviteDetail}
        {manque && <span className={styles.inviteManque}> · {manque}</span>}
        {!toucheInteragir && <span className={styles.inviteSansTouche}> (touche non assignée)</span>}
      </p>
    );
  }
  if (invite === "reanimer" || invite === "reparer") {
    return (
      <p className={`${styles.plaque} ${styles.invite}`} data-reanime={reanime ? "oui" : "non"}>
        <Touche libelle={toucheInteragir} /> {inviteDetail}
        <span className={styles.inviteSansTouche}> · maintenir</span>
        {!toucheInteragir && <span className={styles.inviteSansTouche}> (touche non assignée)</span>}
        {reanime && (
          <span ref={refReanim} className={styles.reanimBarre} role="progressbar" aria-label="Réanimation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
            <i />
          </span>
        )}
      </p>
    );
  }
  if (invite === "elsa") {
    return <p className={`${styles.plaque} ${styles.invite}`}>Avance vers Elsa{inviteDetail ? ` (${inviteDetail})` : ""}</p>;
  }
  if (invite === "monter" || invite === "descendre") {
    return (
      <p className={`${styles.plaque} ${styles.invite}`}>
        <Touche libelle={toucheInteragir} /> {invite === "monter" ? "Monter" : "Descendre"}
        {invite === "monter" && inviteDetail ? ` (${inviteDetail})` : ""}
        {!toucheInteragir && <span className={styles.inviteSansTouche}> (touche non assignée)</span>}
      </p>
    );
  }
  if (inviteRecharge) {
    return (
      <p className={`${styles.plaque} ${styles.invite} ${styles.inviteDanger}`}>
        <Touche libelle={toucheRecharger} /> RECHARGER
        {!toucheRecharger && <span className={styles.inviteSansTouche}> (touche non assignée)</span>}
      </p>
    );
  }
  return null;
}

const InvitesAction = memo(InvitesBrutes);
export default InvitesAction;
