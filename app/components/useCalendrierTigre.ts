"use client";

import { useEffect, useRef } from "react";
import { ecartAvantPassage, nombrePetits, tirerEvenement, type Evenement } from "@/lib/tigre-courant";
import { RETENTE_PASSAGE_MS } from "@/lib/tigre-reactions";

/** Ce que le calendrier de passages demande au tigre (sprite ou 3D). */
export interface RappelsCalendrier {
  /** Aucun passage ni réaction en cours (et le tigre est prêt) : un nouveau passage peut partir. */
  libre(): boolean;
  partir(evenement: Evenement, petits: number): void;
  /** Le calendrier s'arrête (changement de thème, démontage) : tout remettre à zéro. */
  arret(): void;
}

/**
 * Calendrier des passages du tigre : un départ toutes les 10 à 15 s (cf. lib/tigre-courant.ts),
 * le premier peu après l'arrivée sur le thème. Un onglet caché saute son passage plutôt que d'en
 * accumuler ; un passage ou une réaction en cours est attendu, jamais coupé.
 */
export function useCalendrierTigre(actif: boolean, rappels: RappelsCalendrier) {
  const ref = useRef(rappels);
  ref.current = rappels;

  useEffect(() => {
    if (!actif) return;
    let minuteur: ReturnType<typeof setTimeout>;
    const courir = () => {
      if (document.hidden) {
        minuteur = setTimeout(courir, ecartAvantPassage(Math.random()));
        return;
      }
      if (!ref.current.libre()) {
        minuteur = setTimeout(courir, RETENTE_PASSAGE_MS);
        return;
      }
      ref.current.partir(tirerEvenement(Math.random()), nombrePetits(Math.random()));
      minuteur = setTimeout(courir, ecartAvantPassage(Math.random()));
    };
    minuteur = setTimeout(courir, 2500);
    return () => {
      clearTimeout(minuteur);
      ref.current.arret();
    };
  }, [actif]);
}
