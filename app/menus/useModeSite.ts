"use client";

import { useCallback, useEffect, useState } from "react";
import type { Mode } from "@/lib/carte-tri";

/** Même clé que ClientScripts et la vue 3D : le mode suit d'une page à l'autre. */
const MODE_KEY = "pdj-mode";

function lireMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "goulaf" ? "goulaf" : "sportif";
  } catch {
    return "sportif";
  }
}

/**
 * Mode Sportif/Goulaf partagé avec le reste du site. Le rendu serveur part de Sportif (le
 * stockage n'est lisible qu'au montage) ; l'événement `pdj:mode-refresh` resynchronise quand
 * un autre composant (vue 3D, ClientScripts) change le mode.
 */
export function useModeSite(): [Mode, (m: Mode) => void] {
  const [mode, setMode] = useState<Mode>("sportif");

  useEffect(() => {
    const sync = () => setMode(lireMode());
    sync();
    window.addEventListener("pdj:mode-refresh", sync);
    return () => window.removeEventListener("pdj:mode-refresh", sync);
  }, []);

  const changer = useCallback((m: Mode) => {
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* stockage indisponible : le mode reste local à la page */
    }
    setMode(m);
    window.dispatchEvent(new Event("pdj:mode-refresh"));
  }, []);

  return [mode, changer];
}
