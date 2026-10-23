"use client";

import { memo } from "react";
import type { HudEtat } from "@/lib/fps/jeu-types";
import styles from "../HudArene.module.css";

/**
 * Invite d'interaction sous le viseur (centre, y = 62 %, une ligne) : « Avance vers Elsa (12 m) » (le cadeau est automatique, sans touche),
 * « [E] Monter (2/4) », « [E] Descendre » avec la touche RÉELLEMENT assignée (« touche non assignée » sinon), ou, à défaut, « [R] RECHARGER »
 * quand le chargeur est critique. Les annonces vocales passent par la région vive, pas par ici.
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
}

function Touche({ libelle }: { libelle: string }) {
  return libelle ? <kbd>{libelle}</kbd> : null;
}

function InvitesBrutes({ invite, inviteDetail, toucheInteragir, inviteRecharge, toucheRecharger }: PropsInvitesAction) {
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
