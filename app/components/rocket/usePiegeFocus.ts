"use client";

import { useEffect, type RefObject } from "react";

const FOCALISABLES = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Piège le focus clavier dans un dialogue (`role="dialog"` modal) : à l'ouverture le focus va sur `focusInitial` (sinon le premier contrôle),
 * Tab et Maj+Tab bouclent dans le dialogue, et à la fermeture le focus revient où il était. Comme les autres dialogues modaux du site.
 * `cle` relance l'initialisation quand le contenu du dialogue change de vue (le premier contrôle de la nouvelle vue prend le focus).
 */
export function usePiegeFocus(ref: RefObject<HTMLElement | null>, focusInitial?: RefObject<HTMLElement | null>, cle?: string): void {
  // focus d'ouverture et restitution : une fois par montage
  useEffect(() => {
    const precedent = document.activeElement as HTMLElement | null;
    return () => { if (precedent?.isConnected) precedent.focus({ preventScroll: true }); };
  }, [ref]);

  useEffect(() => {
    const dialogue = ref.current;
    if (!dialogue) return;
    const premier = focusInitial?.current ?? dialogue.querySelector<HTMLElement>(FOCALISABLES);
    premier?.focus({ preventScroll: true });
  }, [ref, focusInitial, cle]);

  useEffect(() => {
    const dialogue = ref.current;
    if (!dialogue) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const cibles = Array.from(dialogue.querySelectorAll<HTMLElement>(FOCALISABLES)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (cibles.length === 0) { e.preventDefault(); return; }
      const premier = cibles[0], dernier = cibles[cibles.length - 1];
      const actif = document.activeElement;
      if (!dialogue.contains(actif)) { e.preventDefault(); premier.focus(); return; }
      if (e.shiftKey && actif === premier) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && actif === dernier) { e.preventDefault(); premier.focus(); }
    };
    document.addEventListener("keydown", surTouche);
    return () => document.removeEventListener("keydown", surTouche);
  }, [ref]);
}
