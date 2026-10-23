"use client";

/**
 * État React des réglages du HUD et de la mini-map : lecture au montage (`localStorage`, défauts sûrs), écriture à chaque changement.
 * L'hôte pose `attributsHud(reglages)` (`data-effets`, `--echelle-hud`) sur la racine du HUD ; le réglage « nord » par défaut vient de
 * `prefers-reduced-motion` (`useMouvementReduit` + `orientationEffective`).
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§4.5, §7.1)
 */
import { useCallback, useState } from "react";
import { ecrireReglagesHud, lireReglagesHud, type ReglagesHud } from "@/lib/fps/reglages-hud";

/**
 * Lecture à l'initialisation : l'arène n'existe que côté client (overlay ouvert après l'hydratation), et sur le serveur
 * `lireReglagesHud` rend les défauts sans toucher au stockage. Écriture à chaque changement, échec silencieux.
 */
export function useReglagesHud(): [ReglagesHud, (r: ReglagesHud) => void] {
  const [reglages, setReglages] = useState<ReglagesHud>(() => lireReglagesHud());
  const changer = useCallback((r: ReglagesHud) => {
    setReglages(r);
    ecrireReglagesHud(r);
  }, []);
  return [reglages, changer];
}

/** Réexporté : `prefers-reduced-motion` (hook partagé avec la mini-map, écrit dans `useMouvementReduit.ts`). */
export { useMouvementReduit } from "./useMouvementReduit";
