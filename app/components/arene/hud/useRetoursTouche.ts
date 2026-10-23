"use client";

/**
 * Transforme la liste `evenements` de `useArene` en retours de combat affichables : chiffres de dégâts cumulés (`degats-cumul.ts`),
 * marqueur de touche et X de kill. Chaque événement n'est traité qu'une fois (ids croissants) ; les chiffres sont retirés par minuterie.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§6.1)
 */
import { useEffect, useRef, useState } from "react";
import { DUREE_CHIFFRE_MS, cumulerConfirme, purgerChiffres, type ChiffreDegats } from "@/lib/fps/degats-cumul";
import type { EvenementHud } from "../contrats";
import type { MarqueurTouche } from "./RetoursTouche";

const DUREE_MARQUEUR_MS = 260;
const DUREE_KILL_MS = 950;

export function useRetoursTouche(evenements: readonly EvenementHud[]): { chiffres: ChiffreDegats[]; marqueur: MarqueurTouche | null; kill: number | null } {
  const [chiffres, setChiffres] = useState<ChiffreDegats[]>([]);
  const [marqueur, setMarqueur] = useState<MarqueurTouche | null>(null);
  const [kill, setKill] = useState<number | null>(null);
  const dernierId = useRef(0);
  const minuteurs = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const apres = (ms: number, f: () => void) => {
      const m = setTimeout(() => { minuteurs.current.delete(m); f(); }, ms);
      minuteurs.current.add(m);
    };
    for (const e of evenements) {
      if (e.id <= dernierId.current) continue;
      dernierId.current = e.id;
      if (e.type === "confirme") {
        setChiffres((l) => cumulerConfirme(purgerChiffres(l, e.t), e, e.id));
        const id = e.id;
        setMarqueur({ id, tete: e.zone === "tete" });
        apres(DUREE_MARQUEUR_MS, () => setMarqueur((m) => (m?.id === id ? null : m)));
        apres(DUREE_CHIFFRE_MS + 50, () => setChiffres((l) => purgerChiffres(l, performance.now())));
      } else if (e.type === "kill") {
        const id = e.id;
        setKill(id);
        apres(DUREE_KILL_MS, () => setKill((k) => (k === id ? null : k)));
      }
    }
  }, [evenements]);

  useEffect(() => {
    const liste = minuteurs.current;
    return () => { liste.forEach(clearTimeout); liste.clear(); };
  }, []);

  return { chiffres, marqueur, kill };
}
