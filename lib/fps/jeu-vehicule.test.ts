import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import { ControleurVehicule, commandesDepuisEntrees, recalerOccupants } from "./jeu-vehicule";
import type { EtatJoueurSnap } from "./protocole";
import type { EtatVehicule } from "./vehicule";
import { VEH, positionSiege } from "./vehicule";

const sceneReelle = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
function rect(x0: number, z0: number, x1: number, z1: number, h = 10): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
const monde = construireMonde({
  ...sceneReelle, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000), rect(60, -50, 70, 50)], pois: [],
});
const CAP_EST = -Math.PI / 2;
const depart: EtatVehicule = { p: [0, 0, 0], cap: CAP_EST, v: 0 };
const GAZ = { accel: 1, direction: 0, frein: false };

describe("commandesDepuisEntrees", () => {
  it("avant/arrière → accel, gauche/droite → direction, saut → frein à main", () => {
    expect(commandesDepuisEntrees({ avant: 1, droite: 0, saut: false })).toEqual({ accel: 1, direction: 0, frein: false });
    expect(commandesDepuisEntrees({ avant: -1, droite: 1, saut: true })).toEqual({ accel: -1, direction: 1, frein: true });
  });
  it("borne à [−1, 1] et ignore les NaN", () => {
    expect(commandesDepuisEntrees({ avant: 3, droite: -9, saut: false })).toEqual({ accel: 1, direction: -1, frein: false });
    expect(commandesDepuisEntrees({ avant: Number.NaN, droite: Number.NaN, saut: false })).toEqual({ accel: 0, direction: 0, frein: false });
  });
});

describe("ControleurVehicule", () => {
  it("inactif au départ : rien à lire, rien à envoyer", () => {
    const c = new ControleurVehicule(monde);
    expect(c.actif()).toBeNull();
    expect(c.etat()).toBeNull();
    expect(c.estConducteur()).toBe(false);
    expect(c.vitesseKmh()).toBe(0);
    expect(c.positionSiege()).toBeNull();
    expect(c.messageConduite(0, 0)).toBeNull();
    c.maj(0.016, GAZ); // sans effet ni erreur
    c.suivre(depart);
    expect(c.etat()).toBeNull();
  });

  it("conducteur : simule en local (accélère) et envoie des `conduite` à seq croissante", () => {
    const c = new ControleurVehicule(monde);
    c.entrer({ vehicule: 4, siege: 0 }, depart);
    expect(c.actif()).toEqual({ vehicule: 4, siege: 0 });
    expect(c.estConducteur()).toBe(true);
    for (let i = 0; i < 60; i++) c.maj(1 / 60, GAZ);
    expect(c.etat()!.v).toBeCloseTo(14, 1);
    expect(c.vitesseKmh()).toBeCloseTo(14 * 3.6, 0);
    const m0 = c.messageConduite(0.5, -0.1)!;
    const m1 = c.messageConduite(0.5, -0.1)!;
    expect(m0).toMatchObject({ t: "conduite", seq: 0, vehicule: 4, lacet: 0.5, tangage: -0.1, p: [m0.p[0], 0, 0] });
    expect(m1.seq).toBe(1);
    expect(m0.p[0]).toBeGreaterThan(5);
    expect(m0.v).toBeCloseTo(14, 1);
  });

  it("ré-entrer (changement de siège) repart d'une séquence neuve", () => {
    const c = new ControleurVehicule(monde);
    c.entrer({ vehicule: 0, siege: 0 }, depart);
    c.messageConduite(0, 0); c.messageConduite(0, 0);
    c.entrer({ vehicule: 0, siege: 1 }, depart);
    expect(c.messageConduite(0, 0)).toBeNull(); // passager
    c.entrer({ vehicule: 0, siege: 0 }, depart);
    expect(c.messageConduite(0, 0)!.seq).toBe(0);
  });

  it("passager : maj ne fait rien, suivre recopie l'état interpolé, aucun message", () => {
    const c = new ControleurVehicule(monde);
    c.entrer({ vehicule: 1, siege: 2 }, depart);
    expect(c.estConducteur()).toBe(false);
    c.maj(1 / 60, GAZ);
    expect(c.etat()).toEqual(depart);
    const e: EtatVehicule = { p: [10, 0, -3], cap: 0.5, v: 12 };
    c.suivre(e);
    expect(c.etat()).toEqual(e);
    expect(c.vitesseKmh()).toBeCloseTo(12 * 3.6, 9);
    expect(c.positionSiege()).toEqual(positionSiege(e, 2));
    expect(c.messageConduite(0, 0)).toBeNull();
  });

  it("conducteur : suivre est ignoré (l'état vient de la simulation locale)", () => {
    const c = new ControleurVehicule(monde);
    c.entrer({ vehicule: 0, siege: 0 }, depart);
    c.suivre({ p: [50, 0, 50], cap: 1, v: 20 });
    expect(c.etat()).toEqual(depart);
  });

  it("sortir efface tout", () => {
    const c = new ControleurVehicule(monde);
    c.entrer({ vehicule: 0, siege: 0 }, depart);
    c.sortir();
    expect(c.actif()).toBeNull();
    expect(c.etat()).toBeNull();
    expect(c.messageConduite(0, 0)).toBeNull();
  });

  it("l'état entré n'est pas aliasé", () => {
    const c = new ControleurVehicule(monde);
    const e: EtatVehicule = { p: [0, 0, 0], cap: CAP_EST, v: 0 };
    c.entrer({ vehicule: 0, siege: 0 }, e);
    c.maj(0.5, GAZ);
    expect(e.p[0]).toBe(0);
    c.etat()!.p[0] = 999;
    expect(c.etat()!.p[0]).not.toBe(999);
  });

  it("un dt d'image long est sous-découpé (même résultat qu'en pas de 1/60) et plafonné à 0,1 s", () => {
    const a = new ControleurVehicule(monde), b = new ControleurVehicule(monde);
    a.entrer({ vehicule: 0, siege: 0 }, depart); b.entrer({ vehicule: 0, siege: 0 }, depart);
    a.maj(0.05, GAZ);
    for (let i = 0; i < 3; i++) b.maj(0.05 / 3, GAZ);
    expect(a.etat()!.v).toBeCloseTo(b.etat()!.v, 6);
    a.maj(10, GAZ); // onglet resté caché 10 s : n'avance que de 0,1 s
    expect(a.etat()!.v).toBeCloseTo(0.05 * 14 + 0.1 * 14, 1);
  });

  it("contre un mur : s'arrête, remonte le choc pour le son, puis il retombe à un frottement", () => {
    const c = new ControleurVehicule(monde);
    c.entrer({ vehicule: 0, siege: 0 }, { p: [50, 0, 0], cap: CAP_EST, v: 22 });
    let choc = 0;
    for (let i = 0; i < 120; i++) { c.maj(1 / 60, GAZ); choc = Math.max(choc, c.choc()); }
    expect(choc).toBeGreaterThan(5);
    expect(c.etat()!.p[0]).toBeLessThanOrEqual(60 - VEH.rayonCercle - 1.2 + 1e-6);
    expect(c.choc()).toBeLessThan(1); // appuyé au mur à pleins gaz : seul reste l'élan d'un pas, sous tout seuil sonore
  });
});

describe("recalerOccupants (conducteur : ses passagers suivent la caisse locale)", () => {
  const snap = (id: string, p: [number, number, number], vehicule?: { id: number; siege: 0 | 1 | 2 | 3 }): EtatJoueurSnap => ({
    id, p, v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0, arme: "pistolet", pv: 100, vivant: true, protege: false, ...(vehicule ? { vehicule } : {}),
  });
  const locale: EtatVehicule = { p: [200, 0, 50], cap: CAP_EST, v: 24 };

  it("un passager de ma voiture est posé sur son siège de l'état local, pas sur la position retardée du snap", () => {
    const etats = new Map([["moi", snap("moi", [0, 0, 0], { id: 2, siege: 0 })], ["pass", snap("pass", [196, 0, 50], { id: 2, siege: 1 })]]);
    const res = recalerOccupants(etats, "moi", 2, locale);
    expect(res.get("pass")!.p).toEqual(positionSiege(locale, 1));
    expect(res.get("moi")).toBe(etats.get("moi"));
    expect(etats.get("pass")!.p).toEqual([196, 0, 50]); // l'entrée n'est pas modifiée
  });
  it("les occupants d'une autre voiture et les piétons ne bougent pas ; sans occupant, la même Map est rendue", () => {
    const etats = new Map([["a", snap("a", [1, 0, 1], { id: 5, siege: 1 })], ["b", snap("b", [2, 0, 2])]]);
    expect(recalerOccupants(etats, "moi", 2, locale)).toBe(etats);
  });
});
