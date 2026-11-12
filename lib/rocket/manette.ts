/**
 * Rocket Muche : lecture des manettes du navigateur (PUR : ni DOM ni horloge, le `Gamepad` est passé en argument). Partagé par la source
 * d'entrées du jeu (`entrees.ts`) et par la capture des réglages (`app/components/rocket/useCaptureManette.ts`), qui ne doit pas importer le jeu.
 */
import type { InstantaneManette } from "./contrat";

/** Ce que la source lit d'une manette (sous-ensemble de `Gamepad`, injectable en test). */
export interface ManetteLue extends InstantaneManette {
  connected?: boolean;
  mapping?: string;
  vibrationActuator?: {
    playEffect(type: "dual-rumble", params: { startDelay?: number; duration: number; weakMagnitude: number; strongMagnitude: number }): Promise<unknown> | unknown;
  } | null;
}

/**
 * `Gamepad` du navigateur → `ManetteLue` : le navigateur expose `buttons`, le contrat lit `boutons`. Sans cette adaptation, la première
 * image avec une vraie manette branchée lirait `undefined[7]` et lèverait une exception dans la boucle.
 */
export function manetteDepuisGamepad(g: Gamepad | null): ManetteLue | null {
  if (!g) return null;
  return { axes: g.axes, boutons: g.buttons, connected: g.connected, mapping: g.mapping, vibrationActuator: (g as unknown as ManetteLue).vibrationActuator ?? null };
}

/** Première manette connectée au mapping « standard » (les autres n'ont pas des indices fiables), ou `null`. */
export function manetteStandard<T extends { connected?: boolean; mapping?: string }>(liste: readonly (T | null)[]): T | null {
  for (const g of liste) if (g && g.connected !== false && (g.mapping === undefined || g.mapping === "standard")) return g;
  return null;
}
