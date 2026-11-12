"use client";

import { useEffect, useRef } from "react";
import { baseDeCapture, debuterCapture, detecterEntree, toutRelache, type BaseCapture } from "@/lib/rocket/capture";
import { manetteDepuisGamepad, manetteStandard, type ManetteLue } from "@/lib/rocket/manette";

export type FinCaptureManette = "annulee" | "delai" | "absente" | "nonstandard" | "perdue";

/** Durée après laquelle une capture sans entrée est abandonnée. */
export const DELAI_CAPTURE_MANETTE_MS = 10_000;
/** Attente maximale du relâchement du bouton qui vient d'être affecté. */
const RELACHEMENT_MAX_MS = 1_500;

function lireManette(): ManetteLue | null {
  try {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return null;
    return manetteStandard(Array.from(navigator.getGamepads(), manetteDepuisGamepad));
  } catch {
    return null;
  }
}

/** Une manette est branchée mais n'a pas le mapping « standard » (indices des boutons non fiables : le jeu l'ignore aussi). */
function manetteNonStandardPresente(): boolean {
  try {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return false;
    return Array.from(navigator.getGamepads()).some((g) => g !== null && g.connected);
  } catch {
    return false;
  }
}

/**
 * Capture d'une entrée de manette pour les réglages. Tant que `actif`, lit la manette à chaque image et appelle `surEntree` avec le code du
 * premier bouton pressé ou demi-axe poussé (`B0`, `A0-`…), sans compter ce qui était déjà enfoncé à l'ouverture ; Échap annule (`surFin`),
 * Retour arrière / Suppr appellent `surEntree(null)` (vider l'emplacement), et une capture sans entrée est abandonnée au bout de 10 s.
 *
 * Le drapeau de `lib/rocket/capture.ts` reste levé jusqu'au RELÂCHEMENT du bouton affecté : sinon Start (par exemple) fermerait le menu pause
 * dès la fin de la capture.
 */
export function useCaptureManette(
  actif: boolean,
  surEntree: (code: string | null) => void,
  surFin: (raison: FinCaptureManette) => void,
): void {
  const rappels = useRef({ surEntree, surFin });
  rappels.current = { surEntree, surFin };

  useEffect(() => {
    if (!actif) return;
    const fermer = debuterCapture();
    let termine = false;
    let detecte = false;
    let raf = 0;
    let base: BaseCapture | null = null;
    const debut = performance.now();

    const finir = (raison: FinCaptureManette) => {
      if (termine) return;
      termine = true;
      rappels.current.surFin(raison);
    };

    const pad = lireManette();
    if (!pad) {
      // pas de manette visible : la Gamepad API n'en expose une qu'après un premier appui sur un de ses boutons
      finir(manetteNonStandardPresente() ? "nonstandard" : "absente");
    } else {
      base = baseDeCapture(pad);
      const boucle = () => {
        if (termine) return;
        const p = lireManette();
        if (!p) { finir("perdue"); return; }
        const r = detecterEntree(base as BaseCapture, p);
        base = r.base;
        if (r.code !== null) {
          termine = true;
          detecte = true;
          rappels.current.surEntree(r.code);
          return;
        }
        if (performance.now() - debut > DELAI_CAPTURE_MANETTE_MS) { finir("delai"); return; }
        raf = requestAnimationFrame(boucle);
      };
      raf = requestAnimationFrame(boucle);
    }

    const surTouche = (e: KeyboardEvent) => {
      if (e.code !== "Escape" && e.code !== "Backspace" && e.code !== "Delete") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat || termine) return;
      termine = true;
      if (e.code === "Escape") rappels.current.surFin("annulee");
      else rappels.current.surEntree(null);
    };
    window.addEventListener("keydown", surTouche, true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", surTouche, true);
      if (!detecte || !base) { fermer(); return; }
      // le bouton affecté est peut-être encore tenu : le jeu reste sourd jusqu'à son relâchement
      const t0 = performance.now();
      const attendre = () => {
        const p = lireManette();
        if (!p || toutRelache(base as BaseCapture, p) || performance.now() - t0 > RELACHEMENT_MAX_MS) { fermer(); return; }
        requestAnimationFrame(attendre);
      };
      attendre();
    };
  }, [actif]);
}
