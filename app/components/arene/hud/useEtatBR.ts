"use client";

/**
 * Lecture du Battle Royale par le HUD (hors du rendu à 60 Hz), calquée sur `useEtatZombies` :
 *  - `useEtatBR` interroge `JeuHandle.br()` toutes les 150 ms et ne rend que si un champ AFFICHÉ change (`memeEtatBrHud`) ;
 *  - `useProgressionUsage` écrit `HudLive.usage` dans la variable CSS `--usage` de la barre d'un soin en cours (aucun rendu React).
 * `useEphemere` (durée de vie d'un message) est celui de `useEtatZombies`.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { memeEtatBrHud } from "@/lib/fps/hud-modele";
import type { EtatBrHud, HudLive } from "@/lib/fps/jeu-types";

export const PERIODE_LECTURE_BR_MS = 150;

export function useEtatBR(lire: (() => EtatBrHud | null) | undefined, actif: boolean): EtatBrHud | null {
  // première lecture au montage : l'écran de mort ou de vol n'attend pas les 150 ms du premier battement
  const [etat, setEtat] = useState<EtatBrHud | null>(() => (actif ? lire?.() ?? null : null));
  const source = useRef(lire);
  source.current = lire;
  useEffect(() => {
    if (!actif) { setEtat(null); return; }
    const lireUneFois = () => {
      const e = source.current?.() ?? null;
      setEtat((precedent) => (memeEtatBrHud(precedent, e) ? precedent : e));
    };
    lireUneFois();
    const id = setInterval(lireUneFois, PERIODE_LECTURE_BR_MS);
    return () => clearInterval(id);
  }, [actif]);
  return actif ? etat : null;
}

/** Écrit l'avancement de l'usage d'un soin (0..1) sur `--usage` et `aria-valuenow` de sa barre, en rAF, tant que `actif`. */
export function useProgressionUsage(live: HudLive, cible: RefObject<HTMLElement | null>, actif: boolean): void {
  const liveRef = useRef(live);
  liveRef.current = live;
  useEffect(() => {
    if (!actif) return;
    let raf = 0;
    let dernier = -1;
    const boucle = () => {
      const v = Math.round(Math.max(0, Math.min(1, liveRef.current.usage ?? 0)) * 100) / 100;
      const el = cible.current;
      if (el && v !== dernier) {
        dernier = v;
        el.style.setProperty("--usage", String(v));
        el.setAttribute("aria-valuenow", String(Math.round(v * 100)));
      }
      raf = requestAnimationFrame(boucle);
    };
    raf = requestAnimationFrame(boucle);
    return () => cancelAnimationFrame(raf);
  }, [actif, cible]);
}
