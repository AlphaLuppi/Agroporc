import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { jsonGLB, nomThree, extraireSquelette } from "../tigre3d/extraction.mjs";
import { CLES_OS, ROLES, cleOs, indexerRoles, deCote } from "./os";
import { MESURES } from "./course";
import { creerSquelette, distanceRepos } from "./squelette";

const glb = readFileSync("public/macron/macron.glb");

describe("os du coureur", () => {
  it("cleOs retire le suffixe d'index Sketchfab, y compris l'atypique _00", () => {
    expect(cleOs("LeftHand_017")).toBe("LeftHand");
    expect(cleOs("RightHandMiddle2_00")).toBe("RightHandMiddle2");
    expect(cleOs("_rootJoint")).toBe("_rootJoint");
    expect(cleOs("Spine1_03")).toBe("Spine1");
  });

  it("chaque rôle désigne un os du GLB, une seule fois", () => {
    const noms = jsonGLB(glb).nodes.map((n) => nomThree(n.name ?? ""));
    const i = indexerRoles(noms);
    for (const r of ROLES) expect(cleOs(noms[i[r]]), r).toBe(CLES_OS[r]);
    expect(new Set(Object.values(CLES_OS)).size).toBe(ROLES.length);
    expect(CLES_OS[deCote("main", "G")]).toBe("LeftHand");
    expect(CLES_OS[deCote("orteils", "D")]).toBe("RightToeBase");
  });

  it("refuse un squelette où un os manque ou est en double", () => {
    expect(() => indexerRoles(["Hips_01"])).toThrow(/absent/);
    const noms = jsonGLB(glb).nodes.map((n) => nomThree(n.name ?? ""));
    expect(() => indexerRoles([...noms, "LeftHand_999"])).toThrow(/double/);
  });
});

describe("mesures du modèle", () => {
  const sq = creerSquelette(extraireSquelette(glb).os);
  const p = (r: Parameters<typeof deCote>[0], c: "G" | "D" = "G") => sq.pM[sq.i[deCote(r, c)]];

  it("repère : visage +Z, sa gauche +X, pieds au sol, 74 os", () => {
    expect(sq.noms).toHaveLength(74);
    expect(p("main").x).toBeGreaterThan(0.6);
    expect(p("main", "D").x).toBeLessThan(-0.6);
    expect(p("boutPied").z).toBeGreaterThan(p("pied").z + 0.15);
    expect(p("boutPied").y).toBeLessThan(0.05);
  });

  it("les mesures du cycle de course (lib/macron3d/course.ts) sont celles du GLB, à 2 mm près", () => {
    const b = sq.pM[sq.i.bassin];
    expect(b.y).toBeCloseTo(MESURES.hauteurBassin, 2);
    const h = p("cuisse").clone().sub(b);
    expect(h.x).toBeCloseTo(MESURES.hanche.x, 2);
    expect(h.y).toBeCloseTo(MESURES.hanche.y, 2);
    expect(h.z).toBeCloseTo(MESURES.hanche.z, 2);
    expect(distanceRepos(sq, "cuisseG", "tibiaG")).toBeCloseTo(MESURES.cuisse, 2);
    expect(distanceRepos(sq, "tibiaG", "piedG")).toBeCloseTo(MESURES.tibia, 2);
    expect(p("pied").y).toBeCloseTo(MESURES.cheville, 2);
    const vp = p("orteils").clone().sub(p("pied"));
    expect(Math.hypot(vp.x, vp.z)).toBeCloseTo(MESURES.plante.avant, 2);
    expect(-vp.y).toBeCloseTo(MESURES.plante.bas, 2);
    // Symétrie G / D.
    expect(p("pied", "D").x).toBeCloseTo(-p("pied").x, 2);
  });
});
