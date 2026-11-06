"use client";

import { useEffect, useState } from "react";
import { apprendreDisposition } from "@/lib/rocket/disposition";
import { useDisposition } from "../arene/ReglageTouches";

/**
 * Disposition du clavier pour écrire les touches du jeu : `getLayoutMap` quand le navigateur l'a (Chrome), sinon déduite des touches
 * que le joueur presse (Firefox, Safari : un AZERTY lit alors « Z Q S D » dès le premier appui sur une de ses lettres).
 */
export function useDispositionRocket(): ReadonlyMap<string, string> | null {
  const native = useDisposition();
  const [apprise, setApprise] = useState<ReadonlyMap<string, string> | null>(null);
  useEffect(() => {
    if (native) return;
    const surTouche = (e: KeyboardEvent) => setApprise((d) => apprendreDisposition(d, e.code, e.key));
    window.addEventListener("keydown", surTouche, true);
    return () => window.removeEventListener("keydown", surTouche, true);
  }, [native]);
  return native ?? apprise;
}
