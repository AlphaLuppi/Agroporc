"use client";

/**
 * Lecture du mode zombies par le HUD (hors du rendu à 60 Hz) :
 *  - `useEtatZombies` interroge `JeuHandle.zombies()` toutes les 150 ms et ne rend que si un champ AFFICHÉ change (`memeEtatZombiesHud`) ;
 *  - `useEphemere` garde une valeur visible `dureeMs` après chaque changement de sa clé (gain d'argent, refus d'achat, bandeau de manche) ;
 *  - `useProgressionReanimation` écrit `HudLive.reanimation` dans la variable CSS `--reanim` de la barre de relève (aucun rendu React).
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { memeEtatZombiesHud } from "@/lib/fps/hud-modele";
import type { EtatZombiesHud, HudLive } from "@/lib/fps/jeu-types";

export const PERIODE_LECTURE_ZOMBIES_MS = 150;

export function useEtatZombies(lire: (() => EtatZombiesHud | null) | undefined, actif: boolean): EtatZombiesHud | null {
  const [etat, setEtat] = useState<EtatZombiesHud | null>(null);
  const source = useRef(lire);
  source.current = lire;
  useEffect(() => {
    if (!actif) { setEtat(null); return; }
    const lireUneFois = () => {
      const e = source.current?.() ?? null;
      setEtat((precedent) => (memeEtatZombiesHud(precedent, e) ? precedent : e));
    };
    lireUneFois();
    const id = setInterval(lireUneFois, PERIODE_LECTURE_ZOMBIES_MS);
    return () => clearInterval(id);
  }, [actif]);
  return actif ? etat : null;
}

/**
 * `valeur` tant qu'elle date de moins de `dureeMs` ; `cle` change = nouvel événement (même valeur redonnée, le minuteur repart).
 * `cle` null ou 0 : rien. La première valeur vue au montage n'est pas affichée si `ignorerPremiere` (état déjà ancien).
 */
export function useEphemere<T>(cle: number | string | null | undefined, valeur: T | null, dureeMs: number, ignorerPremiere = false): T | null {
  const [visible, setVisible] = useState<T | null>(null);
  const vue = useRef<number | string | null | undefined>(ignorerPremiere ? cle : undefined);
  const derniere = useRef(valeur);
  derniere.current = valeur;
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (cle === null || cle === undefined || cle === 0 || cle === vue.current) return;
    vue.current = cle;
    setVisible(derniere.current);
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => { minuteur.current = null; setVisible(null); }, dureeMs);
  }, [cle, dureeMs]);
  useEffect(() => () => { if (minuteur.current) clearTimeout(minuteur.current); }, []);
  return visible;
}

/** Écrit la progression de la relève (0..1) sur `--reanim` et `aria-valuenow` de la barre, en rAF, tant que `actif`. */
export function useProgressionReanimation(live: HudLive, cible: RefObject<HTMLElement | null>, actif: boolean): void {
  const liveRef = useRef(live);
  liveRef.current = live;
  useEffect(() => {
    if (!actif) return;
    let raf = 0;
    let dernier = -1;
    const boucle = () => {
      const v = Math.round(Math.max(0, Math.min(1, liveRef.current.reanimation ?? 0)) * 100) / 100;
      const el = cible.current;
      if (el && v !== dernier) {
        dernier = v;
        el.style.setProperty("--reanim", String(v));
        el.setAttribute("aria-valuenow", String(Math.round(v * 100)));
      }
      raf = requestAnimationFrame(boucle);
    };
    raf = requestAnimationFrame(boucle);
    return () => cancelAnimationFrame(raf);
  }, [actif, cible]);
}
