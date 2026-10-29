import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { creerMonde, fk, squelette } from "../tigre3d/squelette";
import type { Vec3 } from "./protocole";
import {
  RAGDOLL, ROLES_RAGDOLL, armeProjette, collisionsDuMonde, creerRagdoll, impulsionMort, osDeLaPose, ragdollPermis, ragdollsEveilles,
  type CollisionsRagdoll, type InfoMort, type RepereRagdoll,
} from "./ragdoll-tigre";
import { creerAnimZombie } from "./zombies-anim";
import { PLAFOND_INTERIEUR_M, construireMondeZombies } from "./zombies-carte";
import { plafondBatimentsCreux } from "./grenades";
import { ZOMBIES } from "./zombies-vagues";

const sq = squelette();
const ECHELLE = ZOMBIES.echelle;

/** Pose d'un tigre qui court (le moteur du jeu, 1 s de course), en repère du modèle. */
function osEnCourse(graine = 3) {
  const a = creerAnimZombie(graine);
  for (let k = 0; k < 60; k++) a.maj(1 / 60, 4, ECHELLE, false);
  return { os: osDeLaPose(sq, a.pose()), origineX: a.x() };
}

const solPlan: CollisionsRagdoll = { sol: () => 0, mur: () => false };
/** Sol plan et mur plan x = `xm` (plein au-delà). */
function murPlan(xm: number): CollisionsRagdoll {
  return {
    sol: () => 0,
    mur(x, _y, z, r, s) {
      if (x + r <= xm) return false;
      s.x = xm - r; s.z = z; s.nx = -1; s.nz = 0;
      return true;
    },
  };
}

function nouveau(col: CollisionsRagdoll, repere: Partial<RepereRagdoll> = {}, vitesse?: Vec3) {
  const { os, origineX } = osEnCourse();
  const rep: RepereRagdoll = { x: 0, z: 0, cap: 0, echelle: ECHELLE, origineX, ...repere };
  return creerRagdoll(sq, os, rep, col, { vitesse, graine: 1 });
}

function avancer(r: ReturnType<typeof nouveau>, s: number) {
  for (let t = 0; t < s; t += 1 / 60) r.pas(1 / 60);
}

/** Os du squelette entre deux particules (tête de l'os → tête de son enfant). */
const OS_RELIES = [
  ["racine", "thorax"], ["thorax", "lombaires"], ["lombaires", "hancheG"], ["thorax", "brasG"], ["brasG", "mainG"], ["mainG", "bout_mainG"],
  ["thorax", "brasD"], ["brasD", "mainD"], ["mainD", "bout_mainD"], ["hancheG", "cuisseG"], ["cuisseG", "jarretG"], ["jarretG", "piedG"],
  ["piedG", "bout_piedG"], ["hancheG", "cuisseD"], ["cuisseD", "jarretD"], ["jarretD", "piedD"], ["piedD", "bout_piedD"], ["thorax", "tete"],
  ["tete", "bout_tete"], ["tete", "bout_machoire"], ["hancheG", "queue2"], ["queue2", "queue3"], ["queue3", "queue4"], ["queue4", "queue5"],
  ["queue5", "queue6"], ["queue6", "bout_queue"],
] as const;

/** Écart relatif maximal des longueurs d'os. */
function ecartLongueurs(r: ReturnType<typeof nouveau>): number {
  let pire = 0;
  for (const [a, b] of OS_RELIES) {
    const repos = sq.pModele[sq.i[a]].distanceTo(sq.pModele[sq.i[b]]) * ECHELLE;
    const p = r.particule(a) as Vec3, q = r.particule(b) as Vec3;
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    pire = Math.max(pire, Math.abs(d - repos) / repos);
  }
  return pire;
}

describe("ragdoll du tigre zombie", () => {
  it("lâché sans impulsion : il s'effondre au sol, rien ne passe dessous, les os gardent leur longueur, puis il s'endort", () => {
    const r = nouveau(solPlan);
    avancer(r, 3);
    for (let i = 0; i < r.n; i++) expect(r.pos[i * 3 + 1]).toBeGreaterThan(-1e-3);
    expect(ecartLongueurs(r)).toBeLessThan(0.03);
    expect(r.endormi()).toBe(true);
    // couché : le centre de masse est descendu (le tigre debout a le dos vers 0,9 m)
    expect(r.centre()[1]).toBeLessThan(0.55);
  });

  it("la pose reconstruite colle aux particules (cinématique directe à moins de 2 cm × échelle), cou et lombaires compris", () => {
    const r = nouveau(solPlan, { x: 3, z: -2, cap: 0.7 });
    r.impulsion(impulsionMort({ cause: "corps", arme: "pompe", p: [3, 0, -2], graine: 1 }, [0, 1.6, 4]));
    for (const duree of [0.05, 0.4, 2]) {
      avancer(r, duree);
      const m = fk(sq, r.pose(), creerMonde(sq));
      const { x, z, cap, echelle, origineX } = r.repere;
      const th = cap + Math.PI / 2, c = Math.cos(th), s = Math.sin(th);
      for (const role of ROLES_RAGDOLL) {
        const p = m.p[sq.i[role]];
        const px = (p.x - origineX) * echelle, pz = p.z * echelle;
        const w: Vec3 = [c * px + s * pz + x, p.y * echelle, -s * px + c * pz + z];
        const q = r.particule(role) as Vec3;
        expect(Math.hypot(w[0] - q[0], w[1] - q[1], w[2] - q[2]), `${role} à ${duree} s`).toBeLessThan(0.02 * echelle);
      }
    }
  });

  it("le torse reste rigide (racine ↔ bassin, épaules) même projeté", () => {
    const r = nouveau(solPlan);
    const d0 = (a: string, b: string) => {
      const p = r.particule(a as never) as Vec3, q = r.particule(b as never) as Vec3;
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    };
    const avant = [d0("racine", "brasG"), d0("brasG", "brasD"), d0("lombaires", "cuisseG")];
    r.impulsion(impulsionMort({ cause: "corps", arme: "rayon", p: [0, 0, 0], graine: 2 }, [-5, 1.6, 0]));
    avancer(r, 1);
    const apres = [d0("racine", "brasG"), d0("brasG", "brasD"), d0("lombaires", "cuisseG")];
    apres.forEach((d, k) => expect(Math.abs(d - avant[k]) / avant[k]).toBeLessThan(0.03));
  });

  it("le Pistolet à rayons projette le tigre loin et haut ; une balle de pistolet le fait juste tomber", () => {
    const fort = nouveau(solPlan);
    const c0 = fort.centre();
    fort.impulsion(impulsionMort({ cause: "corps", arme: "rayon", p: [0, 0, 0], graine: 1 }, [-3, 1.6, 0]));
    let hautMax = c0[1];
    for (let t = 0; t < 1; t += 1 / 60) { fort.pas(1 / 60); hautMax = Math.max(hautMax, fort.centre()[1]); }
    expect(fort.centre()[0] - c0[0]).toBeGreaterThan(4);
    expect(hautMax - c0[1]).toBeGreaterThan(0.4);

    const faible = nouveau(solPlan);
    const f0 = faible.centre();
    faible.impulsion(impulsionMort({ cause: "corps", arme: "pistolet", p: [0, 0, 0], graine: 1 }, [-3, 1.6, 0]));
    avancer(faible, 2);
    const dx = faible.centre()[0] - f0[0];
    expect(dx).toBeGreaterThan(0.05);
    expect(dx).toBeLessThan(1.5);
  });

  it("un tir à la tête envoie la tête en arrière (plus loin que le bassin)", () => {
    const r = nouveau(solPlan);
    const t0 = r.particule("tete") as Vec3, b0 = r.particule("hancheG") as Vec3;
    r.impulsion(impulsionMort({ cause: "tete", arme: "revolver", p: [0, 0, 0], graine: 1 }, [-6, 1.6, 0]));
    avancer(r, 0.15);
    const t1 = r.particule("tete") as Vec3, b1 = r.particule("hancheG") as Vec3;
    expect(t1[0] - t0[0]).toBeGreaterThan(b1[0] - b0[0] + 0.1);
  });

  it("projeté contre un mur : aucune particule ne le traverse et il rebondit", () => {
    const r = nouveau(murPlan(2));
    r.impulsion(impulsionMort({ cause: "corps", arme: "rayon", p: [0, 0, 0], graine: 1 }, [-3, 1.6, 0]));
    let rebond = false, contre = false;
    for (let t = 0; t < 2; t += 1 / 60) {
      r.pas(1 / 60);
      for (let i = 0; i < r.n; i++) expect(r.pos[i * 3]).toBeLessThan(2.02);
      const v = r.vitesseCentre()[0];
      if (r.centre()[0] > 1) contre = true;
      if (contre && v < -0.3) rebond = true;
    }
    expect(contre).toBe(true);
    expect(rebond).toBe(true);
  });

  it("souffle d'une explosion : radial depuis son centre et vers le haut", () => {
    const r = nouveau(solPlan);
    const c0 = r.centre();
    r.impulsion(impulsionMort({ cause: "explosion", arme: "lance_grenades", src: [0, 0.3, 2], p: [0, 0, 0], graine: 4 }, [9, 1.6, 9]));
    avancer(r, 0.25);
    const c1 = r.centre();
    expect(c1[2] - c0[2]).toBeLessThan(-0.8);
    expect(c1[1]).toBeGreaterThan(c0[1] + 0.3);
  });

  it("déterministe : même mort, même chute", () => {
    const a = nouveau(solPlan), b = nouveau(solPlan);
    const i = impulsionMort({ cause: "melee", arme: "epee", p: [0, 0, 0], graine: 7 }, [-1, 1.6, 0.5]);
    a.impulsion(i); b.impulsion(i);
    avancer(a, 1.5); avancer(b, 1.5);
    expect([...a.pos]).toEqual([...b.pos]);
  });

  it("dans la vraie carte : jamais à travers un mur ni sous le sol", () => {
    const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
    const monde = construireMondeZombies(scene);
    const col = collisionsDuMonde(monde);
    // l'open space du Pôle R&D, projeté par le rayon vers chaque direction
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const r = nouveau(col, { x: 118, z: -24.5, cap: a });
      r.impulsion(impulsionMort({ cause: "corps", arme: "rayon", ameliore: true, p: [118, 0, -24.5], graine: k }, [118 - Math.cos(a) * 3, 1.6, -24.5 - Math.sin(a) * 3]));
      avancer(r, 3);
      for (let i = 0; i < r.n; i++) expect(r.pos[i * 3 + 1]).toBeGreaterThan(-0.01);
      // le torse n'est jamais dans un mur
      for (const role of ["racine", "thorax", "lombaires", "hancheG"] as const) {
        const p = r.particule(role) as Vec3;
        const pousse = { x: 0, z: 0, nx: 0, nz: 0 };
        expect(col.mur(p[0], p[1], p[2], 0.05, pousse), `${role} dans un mur (direction ${k})`).toBe(false);
      }
    }
  });

  it("plafond : au-delà de 8 ragdolls éveillés, le nouveau mort n'en reçoit pas ; aucun ragdoll lancé n'est figé en l'air", () => {
    // 8 morts simultanées (nuke) projetées vers le haut
    const liste = Array.from({ length: RAGDOLL.actifsMax }, (_, k) => {
      const r = nouveau(solPlan);
      r.impulsion(impulsionMort({ cause: "nuke", p: [0, 0, 0], graine: k + 1 }, [-4, 1.6, 0]));
      return r;
    });
    expect(ragdollsEveilles([...liste, null])).toBe(RAGDOLL.actifsMax);
    expect(ragdollPermis(liste)).toBe(false);
    expect(ragdollPermis(liste.slice(1))).toBe(true);
    // chacun finit sa chute : tous au sol (aucune particule au-dessus de ~0,5 m), alors seulement de la place pour un nouveau
    for (const r of liste) avancer(r, RAGDOLL.vieMaxS + 0.5);
    for (const r of liste) {
      expect(r.endormi()).toBe(true);
      let haut = 0;
      for (let i = 0; i < r.n; i++) haut = Math.max(haut, r.pos[i * 3 + 1]);
      expect(haut).toBeLessThan(0.6);
    }
    expect(ragdollPermis(liste)).toBe(true);
  });

  it("impulsions : le rayon et les armes gratinées explosives projettent, pas les autres", () => {
    expect(armeProjette("rayon", false)).toBe(true);
    expect(armeProjette("pistolet", true)).toBe(true);
    expect(armeProjette("pistolet", false)).toBe(false);
    // (v8) la Pompe royale explose : seule une arme gratinée SANS souffle ne projette pas
    expect(armeProjette("pompe", true)).toBe(true);
    expect(armeProjette("mitraillette", true)).toBe(false);
    expect(armeProjette("soufflerie", false)).toBe(true);
    expect(armeProjette("epee", true)).toBe(false);
    const base: InfoMort = { cause: "corps", p: [0, 0, 0], graine: 1 };
    const cam: Vec3 = [-4, 1.6, 0];
    const v = (i: Partial<InfoMort>) => impulsionMort({ ...base, ...i }, cam).vitesse;
    expect(v({ arme: "pompe" })).toBeGreaterThan(v({ arme: "pistolet" }));
    expect(v({ arme: "rayon" })).toBeGreaterThanOrEqual(15);
    expect(v({ arme: "rayon", ameliore: true })).toBeGreaterThan(v({ arme: "rayon" }));
    expect(impulsionMort({ ...base, cause: "explosion", src: [1, 0, 0] }, cam).mode).toBe("radiale");
    expect(impulsionMort({ ...base, cause: "nuke" }, cam).mode).toBe("verticale");
    // coup de couteau : de côté (la direction n'est pas celle du joueur vers le tigre)
    const m = impulsionMort({ ...base, cause: "melee", arme: "couteau" }, cam);
    expect(Math.abs(m.d![2])).toBeGreaterThan(0.7);
    expect(impulsionMort({ ...base, cause: "tete", arme: "pistolet" }, cam).cible).toBe("tete");
  });

  it("un cadavre projeté par un souffle sous lui, dans l'open space, rebondit sous le faux plafond (3,4 m) au lieu de traverser le toit", () => {
    const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
    const monde = construireMondeZombies(scene);
    const plafond = plafondBatimentsCreux(monde, PLAFOND_INTERIEUR_M);
    expect(plafond(118, -24.5)).toBeLessThanOrEqual(PLAFOND_INTERIEUR_M);
    const hauteurMax = (col: CollisionsRagdoll) => {
      const r = nouveau(col, { x: 118, z: -24.5, cap: 0.3 });
      // Rayon Goulaf à bout portant : souffle au pied du tigre
      r.impulsion(impulsionMort({ cause: "explosion", arme: "rayon", ameliore: true, src: [118.2, 0.1, -24.3], p: [118, 0, -24.5], graine: 3 }, [116, 1.6, -26]));
      let haut = 0;
      for (let t = 0; t < 2; t += 1 / 60) {
        r.pas(1 / 60);
        for (let i = 0; i < r.n; i++) haut = Math.max(haut, r.pos[i * 3 + 1]);
      }
      return haut;
    };
    // sans plafond, il monte au-dessus des dalles (l'anomalie) ; avec, jamais
    expect(hauteurMax(collisionsDuMonde(monde))).toBeGreaterThan(plafond(118, -24.5));
    expect(hauteurMax(collisionsDuMonde(monde, plafond))).toBeLessThanOrEqual(plafond(118, -24.5) + 1e-6);
  });

  it("coût : moins de 0,3 ms par ragdoll et par image (10 ragdolls, 3 s à 60 Hz, dans la vraie carte, pose comprise)", () => {
    const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
    const col = collisionsDuMonde(construireMondeZombies(scene));
    const rs = Array.from({ length: 10 }, (_, k) => {
      const r = nouveau(col, { x: 118 + (k % 5) * 2, z: -24.5 + Math.floor(k / 5) * 2, cap: k });
      r.impulsion(impulsionMort({ cause: k % 2 ? "explosion" : "corps", arme: k % 3 ? "rayon" : "pompe", src: [116, 0.5, -27], p: [118, 0, -24.5], graine: k }, [116, 1.6, -27]));
      return r;
    });
    // chauffe du JIT
    const chauffe = nouveau(col, { x: 118, z: -24.5 });
    avancer(chauffe, 0.5);
    chauffe.pose();
    let images = 0;
    const t0 = performance.now();
    for (let t = 0; t < 3; t += 1 / 60) {
      for (const r of rs) { r.pas(1 / 60); if (!r.endormi()) r.pose(); }
      images++;
    }
    const msParRagdollImage = (performance.now() - t0) / (images * rs.length);
    // budget nominal 0,3 ms (mesure seule) ; vitest en parallèle sur une machine chargée peut doubler la mesure
    expect(msParRagdollImage).toBeLessThan(0.6);
    console.log(`ragdoll : ${msParRagdollImage.toFixed(3)} ms par ragdoll et par image`);
  });
});
