"use client";

import type { ReactNode } from "react";
import { nomArme } from "@/lib/fps/armes";
import { formatMetres, formatSecondes } from "@/lib/fps/hud-modele";
import type { InfoTueur } from "@/lib/fps/protocole";
import type { DerniereMort } from "./contrats";
import styles from "./Killcam.module.css";

/**
 * Habillage du rejeu de la killcam : bandes noires haut / bas (8 vh, elles glissent en 250 ms), légende « REJEU · vue de <pseudo> · <arme> · <distance> »,
 * bouton « Passer » (touche de l'action `passer`, Espace par défaut ; ≥ 40 px), barre `role="progressbar"` sur la bande basse et titre « ÉLIMINÉ » (`role="status"`) avec le compte à rebours de
 * réapparition. Les bandes restent pendant la carte du tueur (`hud/CarteTueur`) ; la légende et le bouton n'existent que pendant le rejeu.
 * `prefers-reduced-motion` respecté (bandes sans glissement). Le HUD de combat est absent pendant toute la killcam : aucun texte à faible contraste.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.5) et 2026-10-23-arene-hud-design.md (§5.5, §9)
 *
 * Contrat avec `EcranMort` (lot U2c) : il monte ce composant avec `phase`, `progression` (`hud.killcam`, 0..1), `tueur` (`killcamInfo`),
 * `derniereMort`, `surPasser` (`surPasserKillcam`), `reapparitionDans` (`hud.reapparitionDans`, facultatif) et, en enfants, la carte du tueur et
 * le choix d'équipement compact : ils sont posés ENTRE les deux bandes (rejeu : en bas de la scène pour ne pas la masquer ; carte : centrés).
 */
export interface PropsKillcam {
  phase: "rejeu" | "carte";
  /** 0..1 sur `KILLCAM.rejeuMs + carteMs` */
  progression: number;
  tueur: InfoTueur | null;
  derniereMort: DerniereMort | null;
  surPasser(): void;
  /** libellé de la touche de l'action `passer` (Espace par défaut) ; vide : pas de pastille */
  touchePasser?: string;
  /** s avant la réapparition (`HudEtat.reapparitionDans`) */
  reapparitionDans?: number;
  /** carte du tueur et choix d'équipement, posés entre les bandes (interactifs : ils réactivent eux-mêmes les événements souris) */
  children?: ReactNode;
  /**
   * Chat vocal avec le tueur le temps de la killcam : `etat` du micro ("" = chat vocal coupé), `lien` = pseudos du lien en cours ("" = pas
   * encore), `touche` = touche « parler ». Absent : pas de ligne.
   */
  voix?: { etat: "" | "pret" | "emet"; lien: string; touche: string; mode: "appuyer" | "ouvert" };
}

/** Ligne du chat vocal de la killcam : ce qu'il faut faire pour parler au tueur, ou qu'on lui parle. */
export function texteVoixKillcam(v: NonNullable<PropsKillcam["voix"]>, pseudo: string): string {
  const qui = v.lien || pseudo;
  if (v.etat === "") return `Chat vocal coupé : Échap, puis « Chat vocal », pour parler à ${qui}`;
  if (!v.lien) return `Chat vocal : connexion avec ${qui}… (il faut que son micro soit activé)`;
  if (v.etat === "emet") return `Vous parlez à ${qui}`;
  if (v.mode === "ouvert") return `Micro ouvert : ${qui} vous entend`;
  return v.touche && v.touche !== "—" ? `Maintenez ${v.touche} pour parler à ${qui}` : `Parler à ${qui}`;
}

export default function Killcam({ phase, progression, tueur, derniereMort, surPasser, touchePasser = "Espace", reapparitionDans, children, voix }: PropsKillcam) {
  const part = Math.max(0, Math.min(1, progression));
  // le texte est écrit en casse normale ; les majuscules viennent du CSS (`text-transform`)
  const pseudo = tueur?.pseudo || derniereMort?.par || "Agent";
  const couleur = tueur?.couleur || derniereMort?.parCouleur || "";
  const arme = tueur?.arme ?? derniereMort?.arme;
  const rejeu = phase === "rejeu";
  return (
    <div className={styles.killcam} data-phase={phase}>
      <div className={styles.bandeHaut}>
        {rejeu && (
          <>
            <p className={styles.legende}>
              <span className={styles.rec} aria-hidden="true">◎</span>
              <span>Rejeu</span>
              <span className={styles.legendeSuite}>
                · vue de {couleur && <i className={styles.pastille} style={{ background: couleur }} aria-hidden="true" />}<b>{pseudo}</b>
              </span>
              {arme && (
                <span className={styles.legendeSuite}>
                  · {nomArme(arme)}{tueur ? ` · ${formatMetres(tueur.distance)}` : ""}
                </span>
              )}
            </p>
            <button type="button" className={styles.passer} onClick={surPasser}>
              Passer {touchePasser && <kbd>{touchePasser}</kbd>}
            </button>
          </>
        )}
      </div>
      <div className={styles.centre}>{children}</div>
      <div className={styles.bandeBas}>
        <div
          className={styles.progression}
          role="progressbar"
          aria-label="Progression de la killcam"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(part * 50) * 2}
        >
          <i style={{ width: `${part * 100}%` }} />
        </div>
        {/* pendant la carte, le titre et le compte à rebours sont ceux de la carte du tueur (un seul role="status") */}
        {rejeu && <p className={styles.titre} role="status">Éliminé</p>}
        {rejeu && reapparitionDans !== undefined && reapparitionDans > 0 && (
          <span className={styles.delai}>· réapparition dans {formatSecondes(reapparitionDans)}</span>
        )}
        {voix && (tueur || derniereMort?.par) && (
          <span className={styles.voix} data-emet={voix.etat === "emet" ? "oui" : undefined}>
            <i aria-hidden="true" />{texteVoixKillcam(voix, pseudo)}
          </span>
        )}
      </div>
    </div>
  );
}
