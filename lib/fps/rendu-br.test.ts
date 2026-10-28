import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { AvionBr, ObjetBr, ZoneBr } from "./protocole";
import { BUTIN_RENDU } from "./rendu-br-modele";
import { creerRenduBr, type EntreeRenduBr } from "./rendu-br";
import { creerAvatar } from "./rendu";
import { parachutesVivants } from "./rendu-avion";
import type { EtatJoueurSnap } from "./protocole";

/**
 * Rendu du Battle Royale sans contexte WebGL : on vérifie ce que three permet de contrôler sans lui (pool indexé par id sans fuite ni
 * recréation, instances, libération), pas l'aspect (captures).
 */

const zone: ZoneBr = { palier: 1, nbPaliers: 6, phase: "attente", t0: 0, t1: 120_000, t2: 180_000, c0: [0, 0], r0: 455, c1: [40, -20], r1: 250, degats: 1 };
const avion: AvionBr = { depart: [-300, 0], arrivee: [300, 0], altitude: 350, vitesse: 30, debutT: 0, finT: 20_000 };
const arme = (id: number, x: number, ref: ObjetBr["ref"] = "pistolet"): ObjetBr => ({ id, genre: "arme", ref, p: [x, 0, 0], });
const entree = (o: Partial<EntreeRenduBr> = {}): EntreeRenduBr => ({
  tsServeur: 1000, oeil: [0, 1.7, 0], avion: null, zone: null, butin: [], visible: true, ...o,
});
/** Nombre de maillages, groupes et géométries vivants dans la scène (détecte les fuites par image). */
function compte(scene: THREE.Scene) {
  let n = 0;
  scene.traverse(() => { n++; });
  return n;
}

describe("rendu du butin", () => {
  it("dessine les objets proches (colonne et halo instanciés), pas ceux au-delà de 60 m", () => {
    const scene = new THREE.Scene();
    const r = creerRenduBr(scene);
    r.maj(entree({ butin: [arme(1, 5), arme(2, 20, "sniper"), arme(3, 200)] }), 0.016);
    expect(r.etat().objets).toBe(2);
    expect(r.etat().modeles).toBe(2);
    r.dispose();
  });

  it("un modèle n'est jamais recréé tant que l'objet reste à portée, et le nombre d'objets de la scène ne grandit pas", () => {
    const scene = new THREE.Scene();
    const r = creerRenduBr(scene);
    const butin = [arme(1, 5), { id: 2, genre: "munitions", ref: "moyennes", p: [8, 0, 0] } as ObjetBr, { id: 3, genre: "potion", ref: null, p: [-6, 0, 3] } as ObjetBr];
    r.maj(entree({ butin }), 0.016);
    const apres1 = compte(scene);
    const modele = scene.getObjectByName("br")!.children.find((c) => c.type === "Group" && c !== scene.getObjectByName("br")!.children[0]);
    for (let i = 0; i < 120; i++) r.maj(entree({ butin }), 0.016);
    expect(compte(scene)).toBe(apres1);
    expect(scene.getObjectByName("br")!.children).toContain(modele);
    r.dispose();
  });

  it("un objet ramassé (disparu de la liste) libère son modèle ; un objet qui s'éloigne aussi", () => {
    const scene = new THREE.Scene();
    const r = creerRenduBr(scene);
    r.maj(entree({ butin: [arme(1, 5), arme(2, 7)] }), 0.016);
    const avant = compte(scene);
    r.maj(entree({ butin: [arme(2, 7)] }), 0.016);
    expect(r.etat().modeles).toBe(1);
    expect(compte(scene)).toBeLessThan(avant);
    r.maj(entree({ butin: [arme(2, 7)], oeil: [500, 1.7, 0] }), 0.016);
    expect(r.etat().objets).toBe(0);
    expect(r.etat().modeles).toBe(0);
    r.dispose();
  });

  it("au-delà de `modelesMax` objets proches, les plus lointains n'ont que la colonne et le halo", () => {
    const scene = new THREE.Scene();
    const r = creerRenduBr(scene);
    const butin = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, genre: "bandage", ref: null, p: [(i % 10) * 2, 0, Math.floor(i / 10) * 2] }) as ObjetBr);
    r.maj(entree({ butin }), 0.016);
    expect(r.etat().objets).toBe(100);
    expect(r.etat().modeles).toBe(BUTIN_RENDU.modelesMax);
    r.dispose();
  });

  it("l'arme lâchée par un mort (nouvel id) apparaît, et `visible` faux cache tout sans rien modifier", () => {
    const scene = new THREE.Scene();
    const r = creerRenduBr(scene);
    r.maj(entree({ butin: [arme(1, 5)] }), 0.016);
    r.maj(entree({ butin: [arme(1, 5), arme(450, 6, "railgun")] }), 0.016);
    expect(r.etat().modeles).toBe(2);
    r.maj(entree({ butin: [], visible: false }), 0.016);
    expect(scene.getObjectByName("br")!.visible).toBe(false);
    expect(r.etat().modeles).toBe(2);
    r.dispose();
  });
});

describe("rendu de l'avion et de la tempête", () => {
  it("l'avion est posé à sa position serveur et masqué après son arrivée", () => {
    const scene = new THREE.Scene();
    const r = creerRenduBr(scene);
    r.maj(entree({ avion, tsServeur: 10_000 }), 0.016);
    expect(r.etat().avion).toBe(true);
    r.maj(entree({ avion, tsServeur: 30_000 }), 0.016);
    expect(r.etat().avion).toBe(false);
    r.maj(entree({ avion: null }), 0.016);
    expect(r.etat().avion).toBe(false);
    r.dispose();
  });

  it("le mur suit le cercle de la zone par son échelle seule : la géométrie ne change jamais", () => {
    const scene = new THREE.Scene();
    const r = creerRenduBr(scene);
    r.maj(entree({ zone, tsServeur: 10_000 }), 0.016);
    expect(r.etat().mur).toEqual({ x: 0, z: 0, r: 455 });
    const mur = scene.getObjectByName("br")!.children.find((c) => (c as THREE.Mesh).isMesh && !(c as THREE.InstancedMesh).isInstancedMesh && (c as THREE.Mesh).material instanceof THREE.MeshBasicMaterial && ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).blending === THREE.CustomBlending) as THREE.Mesh;
    expect(mur).toBeDefined();
    const geo = mur.geometry;
    expect(mur.scale.x).toBe(455);
    r.maj(entree({ zone, tsServeur: 150_000 }), 0.016);
    expect(mur.geometry).toBe(geo);
    expect(mur.scale.x).toBeCloseTo((455 + 250) / 2, 6);
    expect((mur.material as THREE.Material).depthWrite).toBe(false);
    expect((mur.material as THREE.Material).side).toBe(THREE.DoubleSide);
    r.dispose();
  });

  it("l'anneau désigne le cercle visé, puis disparaît quand la zone est fermée ; sans zone, ni mur ni anneau", () => {
    const scene = new THREE.Scene();
    const r = creerRenduBr(scene);
    r.maj(entree({ zone, tsServeur: 1000 }), 0.016);
    expect(r.etat().anneau).toEqual({ x: 40, z: -20, r: 250 });
    r.maj(entree({ zone: { ...zone, phase: "fermee", c0: [3, 4], c1: [3, 4], r0: 0, r1: 0 } }), 0.016);
    expect(r.etat().anneau).toBeNull();
    r.maj(entree({ zone: null }), 0.016);
    expect(r.etat().mur).toBeNull();
    r.dispose();
  });
});

describe("dispose", () => {
  it("retire tout de la scène", () => {
    const scene = new THREE.Scene();
    const r = creerRenduBr(scene);
    r.maj(entree({ butin: [arme(1, 5)], zone, avion }), 0.016);
    r.dispose();
    expect(scene.children).toHaveLength(0);
  });
});

describe("parachute de l'avatar", () => {
  // la plaque de pseudo se dessine sur un canvas : faux contexte 2D qui accepte tout
  beforeAll(() => {
    const ctx = new Proxy({}, {
      get: (_, k) => (k === "measureText" ? () => ({ width: 10 }) : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}),
      set: () => true,
    });
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  });
  afterAll(() => { vi.unstubAllGlobals(); });
  const etat = (o: Partial<EtatJoueurSnap> = {}): EtatJoueurSnap => ({
    id: "j1", p: [0, 120, 0], v: [0, -6.5, 0], lacet: 0, tangage: 0, posture: "air", mur: 0, vivant: true, arme: "couteau", protege: false, ...o,
  } as EtatJoueurSnap);
  it("s'ouvre sous voile seulement, se referme à l'atterrissage et se libère avec l'avatar", () => {
    const av = creerAvatar("#ff8800", "Alice");
    const enfants = () => av.group.children.length;
    const n0 = enfants();
    av.maj(etat({ chute: "libre" }), 0.016);
    expect(enfants()).toBe(n0);
    expect(parachutesVivants()).toBe(0);
    av.maj(etat({ chute: "voile" }), 0.016);
    expect(enfants()).toBe(n0 + 1);
    const para = av.group.children[n0];
    expect(para.visible).toBe(true);
    av.maj(etat({ chute: "voile" }), 0.016);
    expect(enfants()).toBe(n0 + 1);
    av.maj(etat({ chute: undefined, posture: "sol" }), 0.016);
    expect(para.visible).toBe(false);
    av.maj(etat({ chute: "voile", vivant: false, posture: "mort" }), 0.016);
    expect(para.visible).toBe(false);
    av.dispose();
    expect(parachutesVivants()).toBe(0);
  });
});
