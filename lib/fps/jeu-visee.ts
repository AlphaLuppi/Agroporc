/**
 * Visée de l'arène FPS (PUR : ni three ni DOM) : UNE seule fonction décide de l'orientation de la vue, la caméra ET les tirs la
 * lisent. « Ce qui est sous le réticule est touché » (v2 §13.1) et « tir et caméra dans la même direction » (§13.2.4) : le tangage
 * de la vue est le tangage du joueur plus le recul visuel (`kick`, poussé par ses propres tirs), jamais l'un sans l'autre.
 * La secousse des dégâts reçus n'entre PAS dans le tangage : elle ne fait que pencher la caméra (roulis), donc ne dévie aucun tir.
 * Utilisé par `jeu.ts`.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§13.2.4)
 */
import type { Vec3 } from "./protocole";
import { directionRegard } from "./vue";

/** Tangage maximal (rad) : un peu moins que la verticale pour que le lacet reste défini. */
export const TANGAGE_MAX = Math.PI / 2 - 0.01;

const borne = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Tangage de la vue (rad) : celui du joueur plus le recul visuel, borné. C'est le tangage de la caméra ET celui du tir. */
export function tangageDeVue(tangage: number, kick: number): number {
  return borne(tangage + kick, -TANGAGE_MAX, TANGAGE_MAX);
}

/** Direction unitaire du regard, donc de chaque tir de la détente (au centre du réticule). */
export function directionVisee(lacet: number, tangage: number, kick: number): Vec3 {
  return directionRegard(lacet, tangageDeVue(tangage, kick));
}

/**
 * Angles d'Euler (ordre YXZ de three) à donner à la caméra : [tangage de la vue, lacet, roulis]. Le roulis est l'inclinaison du
 * mouvement (wall-run, glissade) PLUS la secousse de dégât, qui n'écartent pas le regard.
 */
export function rotationCamera(lacet: number, tangage: number, kick: number, inclinaison: number, secousse: number): [number, number, number] {
  return [tangageDeVue(tangage, kick), lacet, -inclinaison + secousse];
}
