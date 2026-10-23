"use client";

/**
 * Touches du HUD lues au clavier OU à la souris (`Souris0`..., `codeSouris`), pendant que la souris est prise :
 *  - `useToucheMaintenue` : vrai tant qu'une touche (ou un bouton de souris) d'une action est maintenue : scores (Tab) et grande carte (M).
 *    Le navigateur ne déplace pas le focus (`preventDefault`) ; la perte du focus de la fenêtre relâche. Inactif : jamais vrai, aucun écouteur.
 *  - `useToucheAppui` : appelle `surAppui` au front montant (jamais en répétition) : coin de la mini-carte, équipement à l'écran de mort.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§4.4, §4.5, §8.5)
 */
import { useEffect, useRef, useState } from "react";
import { codeSouris } from "@/lib/fps/touches";

/** Écouteurs communs : `bas(code)` / `haut(code)` pour le clavier et les boutons de souris ; retourne le nettoyage. */
function ecouter(liste: string[], bas: () => void, haut: (() => void) | null, perdu: (() => void) | null): () => void {
  const kBas = (e: KeyboardEvent) => { if (liste.includes(e.code)) { e.preventDefault(); if (!e.repeat) bas(); } };
  const kHaut = (e: KeyboardEvent) => { if (liste.includes(e.code)) { e.preventDefault(); haut?.(); } };
  const mBas = (e: MouseEvent) => { if (liste.includes(codeSouris(e.button))) { e.preventDefault(); bas(); } };
  const mHaut = (e: MouseEvent) => { if (liste.includes(codeSouris(e.button))) { e.preventDefault(); haut?.(); } };
  window.addEventListener("keydown", kBas);
  window.addEventListener("keyup", kHaut);
  window.addEventListener("mousedown", mBas);
  window.addEventListener("mouseup", mHaut);
  if (perdu) window.addEventListener("blur", perdu);
  return () => {
    window.removeEventListener("keydown", kBas);
    window.removeEventListener("keyup", kHaut);
    window.removeEventListener("mousedown", mBas);
    window.removeEventListener("mouseup", mHaut);
    if (perdu) window.removeEventListener("blur", perdu);
  };
}

export function useToucheMaintenue(actif: boolean, codes: readonly (string | null)[]): boolean {
  const [maintenue, setMaintenue] = useState(false);
  const cle = codes.join(",");
  useEffect(() => {
    if (!actif) return;
    const liste = cle.split(",").filter(Boolean);
    if (liste.length === 0) return;
    const nettoyer = ecouter(liste, () => setMaintenue(true), () => setMaintenue(false), () => setMaintenue(false));
    return () => {
      nettoyer();
      setMaintenue(false);
    };
  }, [actif, cle]);
  return maintenue;
}

export function useToucheAppui(actif: boolean, codes: readonly (string | null)[], surAppui: () => void): void {
  const cle = codes.join(",");
  const rappel = useRef(surAppui);
  rappel.current = surAppui;
  useEffect(() => {
    if (!actif) return;
    const liste = cle.split(",").filter(Boolean);
    if (liste.length === 0) return;
    return ecouter(liste, () => rappel.current(), null, null);
  }, [actif, cle]);
}
