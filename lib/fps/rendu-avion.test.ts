import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  PARACHUTE, balancementVoile, creerAvionFilDeFer, creerParachute, feuAEclats, geometriesAvion, geometriesParachute, parachutesVivants, rotationAvion,
} from "./rendu-avion";

const boite = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };

describe("avion et parachute en fil de fer", () => {
  it("l'avion fait environ 26 m de long (nez vers +x) et 30 m d'envergure", () => {
    const geos = geometriesAvion();
    const b = new THREE.Box3();
    for (const g of geos) b.union(boite(g));
    expect(b.max.x - b.min.x).toBeGreaterThan(24);
    expect(b.max.z - b.min.z).toBeGreaterThan(29);
    expect(b.max.z - b.min.z).toBeLessThan(31);
    for (const g of geos) g.dispose();
  });

  it("la voilure culmine à la hauteur du parachute et déborde de son rayon ; les suspentes partent de l'attache", () => {
    const { voilure, suspentes } = geometriesParachute();
    const v = boite(voilure);
    expect(v.max.y).toBeGreaterThanOrEqual(PARACHUTE.hauteur - 1e-6);
    expect(v.max.x).toBeGreaterThan(PARACHUTE.rayon - 0.2);
    const s = boite(suspentes);
    expect(s.min.y).toBe(0);
    expect(s.max.y).toBeCloseTo(PARACHUTE.hauteur);
    voilure.dispose(); suspentes.dispose();
  });

  it("le nez de l'avion suit le cap : tourné de cap + π/2", () => {
    expect(rotationAvion(0)).toBeCloseTo(Math.PI / 2);
    const a = creerAvionFilDeFer();
    expect(a.groupe.visible).toBe(false);
    a.poser([10, 350, -20], Math.PI, 0);
    expect(a.groupe.visible).toBe(true);
    expect(a.groupe.position.toArray()).toEqual([10, 350, -20]);
    expect(a.groupe.rotation.y).toBeCloseTo(rotationAvion(Math.PI));
    a.masquer();
    expect(a.groupe.visible).toBe(false);
    a.dispose();
  });

  it("le feu à éclats clignote et le balancement de la voilure reste petit", () => {
    const etats = new Set<boolean>();
    for (let t = 0; t < 2; t += 0.05) etats.add(feuAEclats(t));
    expect(etats.size).toBe(2);
    for (let t = 0; t < 30; t += 0.3) {
      const b = balancementVoile(t, 1.3);
      expect(Math.abs(b.z)).toBeLessThanOrEqual(0.06);
      expect(Math.abs(b.x)).toBeLessThanOrEqual(0.05);
    }
    expect(balancementVoile(2, 0)).not.toEqual(balancementVoile(2, 2));
  });

  it("les parachutes d'avatars partagent leur géométrie, comptée en références, et la libèrent avec le dernier", () => {
    expect(parachutesVivants()).toBe(0);
    const a = creerParachute(1.6), b = creerParachute(1.6);
    expect(parachutesVivants()).toBe(2);
    expect(a.groupe.position.y).toBe(1.6);
    const geoA = (a.groupe.children[0] as THREE.LineSegments).geometry;
    expect((b.groupe.children[0] as THREE.LineSegments).geometry).toBe(geoA);
    a.balancer(3);
    expect(a.groupe.rotation.z).not.toBe(0);
    a.dispose();
    a.dispose(); // idempotent
    expect(parachutesVivants()).toBe(1);
    b.dispose();
    expect(parachutesVivants()).toBe(0);
    // un parachute créé ensuite repart d'une géométrie neuve
    const c = creerParachute();
    expect((c.groupe.children[0] as THREE.LineSegments).geometry).not.toBe(geoA);
    c.dispose();
  });
});
