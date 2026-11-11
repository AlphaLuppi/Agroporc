"use client";

import { useSyncExternalStore } from "react";
import { EVENEMENT_VOTANT, lireVotant } from "@/lib/votant";

function abonner(rappel: () => void): () => void {
  window.addEventListener("storage", rappel);
  window.addEventListener(EVENEMENT_VOTANT, rappel);
  return () => {
    window.removeEventListener("storage", rappel);
    window.removeEventListener(EVENEMENT_VOTANT, rappel);
  };
}

/**
 * Personnage mémorisé (« en tant que »), partagé avec /idees, /ia et les commentaires :
 * null au rendu serveur, sans choix ou si le stockage est inaccessible. Se met à jour quand
 * un autre composant ou un autre onglet change de personnage.
 */
export function useVotant(): string | null {
  return useSyncExternalStore(abonner, () => lireVotant(), () => null);
}
