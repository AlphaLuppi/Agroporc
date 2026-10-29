/**
 * Rendu des aperçus par mode de la vue Palantir (three, chargé à la demande par `lib/agroparc3d/scene.ts`).
 * Spec : docs/superpowers/specs/2026-10-29-apercus-modes-design.md
 */
import type * as THREE from "three";
import type { SceneData } from "../agroparc3d/types";
import type { Bandeau, JoueurAerien, ModeleApercu, ApercuDirect } from "./apercu-source";
import type { ModeSalle } from "./protocole";

export interface ContexteRenduApercu {
  scene: THREE.Scene;
  data: SceneData;
  labelsEl: HTMLElement;
  reduit: boolean;
  decorArene: THREE.Object3D;
  joueurs(liste: readonly JoueurAerien[], o?: { lisser?: boolean; etiquettesMax?: number }): void;
  cible(): THREE.Vector3;
  surBandeau(b: Bandeau | null): void;
  surEvenement(tag: string, texte: string): void;
  surSource(src: "direct" | "simulation" | null): void;
}

export interface RenduApercu {
  decor(mode: ModeSalle): void;
  actif(b: boolean): void;
  mode(m: ModeSalle): void;
  direct(d: ApercuDirect | null): void;
  maj(dt: number, t: number): void;
  etat(): { tigres: number; modele: ModeleApercu | null };
  graine(n: number): void;
  avancer(s: number): void;
  dispose(): void;
}

export function creerRenduApercu(ctx: ContexteRenduApercu): RenduApercu {
  return {
    decor(mode) { ctx.decorArene.visible = mode === "arene"; },
    actif() {}, mode() {}, direct() {}, maj() {}, etat: () => ({ tigres: 0, modele: null }), graine() {}, avancer() {}, dispose() {},
  };
}
