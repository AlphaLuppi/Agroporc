/**
 * Avatar assis dans une voiture : la tête reste sous le toit (1,5 m). À la 3ᵉ personne (caméra de poursuite du conducteur), une tête qui
 * dépasse du toit se voit en plein centre de l'écran ; chez les autres, elle sortait aussi de la caisse.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { creerAvatar } from "./rendu";
import { VOITURE } from "./circulation";
import type { EtatJoueurSnap } from "./protocole";

describe("avatar assis dans une voiture", () => {
  // la plaque de pseudo se dessine sur un canvas : faux contexte 2D qui accepte tout
  beforeAll(() => {
    const ctx = new Proxy({}, {
      get: (_, k) => (k === "measureText" ? () => ({ width: 10 }) : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}),
      set: () => true,
    });
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  });
  afterAll(() => { vi.unstubAllGlobals(); });

  /** boîte des maillages visibles (ni plaque de pseudo ni silhouette lointaine) après que la pose assise s'est établie */
  function boite(vehicule: boolean): THREE.Box3 {
    const av = creerAvatar("#ff8800", "Alice");
    const e = {
      id: "j1", p: [0, 0, 0], v: [0, 0, 0], lacet: 0, tangage: -0.3, posture: "sol", mur: 0, arme: "pistolet", vivant: true, protege: false,
      ...(vehicule ? { vehicule: { id: 1, siege: 0 } } : {}),
    } as unknown as EtatJoueurSnap;
    for (let i = 0; i < 120; i++) av.maj(e, 0.05);
    av.group.updateMatrixWorld(true);
    const b = new THREE.Box3();
    av.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || o instanceof THREE.Sprite) return;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
      b.expandByObject(o);
    });
    av.dispose();
    return b;
  }

  it("la tête reste sous le toit, les pieds pas plus bas qu'avant", () => {
    const assis = boite(true);
    expect(assis.max.y).toBeLessThan(VOITURE.hauteur - 0.03);
    // ancienne pose : pieds à −0,15 m (sous le châssis, cachés par la caisse) ; jamais plus bas
    expect(assis.min.y).toBeGreaterThan(-0.2);
    // debout : bien plus grand (la pose assise n'a pas rapetissé l'avatar)
    expect(boite(false).max.y).toBeGreaterThan(2);
  });
});
