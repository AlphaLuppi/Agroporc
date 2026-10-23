"use client";

/** Vrai pendant `dureeMs` après la rupture du bouclier (passage de > 0 à 0) : flash de la barre et vignette bleue. */
import { useEffect, useRef, useState } from "react";
import { etapeRupture } from "@/lib/fps/hud-modele";

export function useRupture(bouclier: number, actif: boolean, dureeMs = 400): boolean {
  const [rupture, setRupture] = useState(false);
  const avant = useRef(bouclier);
  // Le minuteur vit hors du cleanup de l'effet : un changement de `bouclier` ou de `actif` (mort moins de 400 ms après la rupture) ne doit
  // ni l'annuler sans remettre `rupture` à faux, ni laisser la vignette bleue affichée jusqu'à la prochaine rupture.
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const etape = etapeRupture(avant.current, bouclier, actif);
    avant.current = bouclier;
    if (etape === "rien") return;
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = null;
    if (etape === "annuler") {
      setRupture(false);
      return;
    }
    setRupture(true);
    minuteur.current = setTimeout(() => {
      minuteur.current = null;
      setRupture(false);
    }, dureeMs);
  }, [bouclier, actif, dureeMs]);
  useEffect(() => () => { if (minuteur.current) clearTimeout(minuteur.current); }, []);
  return rupture;
}
