"use client";

/**
 * Largeur (px) d'un élément mesurée par `ResizeObserver` : choisit les colonnes visibles du tableau des scores (`colonnesVisibles`).
 * 0 tant que l'élément n'est pas monté (au rendu serveur et au premier rendu) ; ni débordement ni boucle de mesure.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§8.3, §7.1)
 */
import { useEffect, useState, type RefObject } from "react";

export function useLargeur(ref: RefObject<HTMLElement | null>): number {
  const [largeur, setLargeur] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mesurer = () => setLargeur(Math.round(el.getBoundingClientRect().width));
    mesurer();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", mesurer);
      return () => window.removeEventListener("resize", mesurer);
    }
    const o = new ResizeObserver(mesurer);
    o.observe(el);
    return () => o.disconnect();
  }, [ref]);
  return largeur;
}
