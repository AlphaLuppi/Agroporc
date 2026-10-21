import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Quaternion, Vector3 } from "three";
import { extraireSquelette, jsonGLB, nomThree } from "./extraction.mjs";
import donnees from "./donnees/squelette.json";
import { NOMS_OS, ROLES, DEF_PATTES, PATTES, miroir, GROUPE_DE } from "./os";
import { creerSquelette, squelette, nouvellePose, creerMonde, fk, deltaModele, viserOs, placerRacine, reposDe } from "./squelette";

const glb = readFileSync(fileURLToPath(new URL("../../public/tigre/tigre.glb", import.meta.url)));

describe("os du GLB", () => {
  it("chaque rôle désigne un os du GLB (noms three)", () => {
    const noms = new Set(jsonGLB(glb).nodes.map((n) => nomThree(n.name ?? "")));
    for (const r of ROLES) expect(noms.has(NOMS_OS[r]), r).toBe(true);
    expect(new Set(Object.values(NOMS_OS)).size).toBe(ROLES.length);
  });

  it("donnees/squelette.json correspond au GLB (relancer scripts/tigre/extraire_squelette.mjs sinon)", () => {
    // Via JSON : -0 et 0 s'écrivent pareil.
    expect(JSON.parse(JSON.stringify(extraireSquelette(glb)))).toEqual(JSON.parse(JSON.stringify(donnees)));
  });

  it("chaque os a un groupe, le miroir G/D est une involution", () => {
    for (const r of ROLES) {
      expect(GROUPE_DE[r]).toBeDefined();
      expect(miroir(miroir(r))).toBe(r);
    }
    expect(miroir("mainG")).toBe("mainD");
  });
});

describe("squelette", () => {
  const sq = squelette();
  it("la cinématique directe de repos redonne les positions du modèle (museau +Z, gauche +X, pieds au sol)", () => {
    expect(reposDe(sq, "bout_tete").z).toBeGreaterThan(0.4);
    expect(reposDe(sq, "bout_queue").z).toBeLessThan(-0.55);
    expect(reposDe(sq, "mainG").x).toBeGreaterThan(0.05);
    expect(reposDe(sq, "mainD").x).toBeLessThan(-0.05);
    for (const p of PATTES) expect(reposDe(sq, DEF_PATTES[p].bout).y).toBeLessThan(0.05);
    expect(reposDe(sq, "oreille_pointeG").y).toBeGreaterThan(0.6);
  });

  it("placerRacine place la racine où on le demande", () => {
    const pose = nouvellePose(sq), m = creerMonde(sq);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7).multiply(sq.qModele[sq.i.racine]);
    placerRacine(sq, pose, new Vector3(1, 0.3, -2), q);
    fk(sq, pose, m);
    expect(m.p[sq.i.racine].distanceTo(new Vector3(1, 0.3, -2))).toBeLessThan(1e-6);
    expect(m.q[sq.i.racine].angleTo(q)).toBeLessThan(1e-6);
  });

  it("un delta en repère du modèle tourne l'os autour de l'axe du modèle, quels que soient ses axes locaux", () => {
    const pose = nouvellePose(sq), m = creerMonde(sq);
    const k = sq.i.epauleG;
    // +X modèle : la patte avant part vers l'avant (le poignet avance en z).
    deltaModele(sq, k, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.5), pose.q[k]);
    fk(sq, pose, m);
    expect(m.p[sq.i.mainG].z).toBeGreaterThan(sq.pModele[sq.i.mainG].z + 0.05);
  });

  it("viserOs oriente l'os vers la direction voulue", () => {
    const pose = nouvellePose(sq), m = creerMonde(sq);
    fk(sq, pose, m);
    const dir = new Vector3(0, -0.3, 1).normalize();
    viserOs(sq, pose, m, sq.i.brasG, dir);
    fk(sq, pose, m);
    const reel = m.p[sq.i.mainG].clone().sub(m.p[sq.i.brasG]).normalize();
    expect(reel.angleTo(dir)).toBeLessThan(1e-4);
  });

  it("creerSquelette refuse des données dont un rôle manque", () => {
    const d = structuredClone(donnees);
    d.os[3].nom = "inconnu";
    expect(() => creerSquelette(d)).toThrow();
  });
});
