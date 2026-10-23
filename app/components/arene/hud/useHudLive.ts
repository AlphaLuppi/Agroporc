"use client";

/**
 * Lit `JeuHandle.live` en rAF et écrit les variables CSS (`--recharge`, `--regen`) et les textes de vitesse SUR L'ÉLÉMENT concerné (pas sur la
 * racine du HUD, pour ne pas recalculer tout le sous-arbre) : aucun rendu React pour ce qui varie à 60 Hz. L'écriture elle-même
 * (`ecrireLive`, pure et testée) ne touche le DOM qu'à la valeur qui change. `live` peut être remplacé (valeur inerte avant le lancement du jeu) :
 * la boucle lit toujours la dernière valeur reçue. Les éléments absents (aucun rechargement en cours, à pied…) sont ignorés.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§3.1, §7.1)
 */
import { useEffect, useRef, type RefObject } from "react";
import { cacheLiveVide, ecrireLive, type CiblesLive } from "@/lib/fps/hud-modele";
import type { HudLive } from "@/lib/fps/jeu-types";

/** Éléments à piloter ; chacun est optionnel (absent du DOM selon l'état du HUD). */
export interface CiblesHudLive {
  anneauRecharge: RefObject<HTMLElement | null>;
  barreRecharge: RefObject<HTMLElement | null>;
  /** `data-duree` = durée du rechargement (s) ; le temps restant y est écrit */
  tempsRecharge: RefObject<HTMLElement | null>;
  traitRegen: RefObject<HTMLElement | null>;
  vitesse: RefObject<HTMLElement | null>;
  kmh: RefObject<HTMLElement | null>;
}

export function useHudLive(live: HudLive, cibles: CiblesHudLive, actif = true): void {
  const liveRef = useRef(live);
  liveRef.current = live;
  const ciblesRef = useRef(cibles);
  ciblesRef.current = cibles;
  useEffect(() => {
    if (!actif) return;
    const cache = cacheLiveVide();
    let raf = 0;
    const boucle = () => {
      ecrireLive(liveRef.current, ciblesRef.current as CiblesLive, cache);
      raf = requestAnimationFrame(boucle);
    };
    raf = requestAnimationFrame(boucle);
    return () => cancelAnimationFrame(raf);
  }, [actif]);
}
