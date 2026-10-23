import { describe, expect, it } from "vitest";
import { rugir } from "../tigre3d/gestes/rugir";
import { saut } from "../tigre3d/gestes/saut";
import { creerAnimTigreGeant, type EtatAnimTigre } from "./tigre-geant";

const ECHELLE = 40;
function jouer(a: ReturnType<typeof creerAnimTigreGeant>, s: number, v: number, e: EtatAnimTigre) {
  const vus = new Set<string>();
  for (let i = 0; i < s * 60; i++) {
    a.maj(1 / 60, v, ECHELLE, e);
    const g = a.geste();
    if (g) vus.add(g === rugir ? "rugir" : g === saut ? "saut" : "repos");
  }
  return vus;
}

describe("animation du tigre géant", () => {
  it("coup de patte : rugir ; saut : le bond ; pose toujours finie", () => {
    const a = creerAnimTigreGeant();
    expect(jouer(a, 0.5, 0, { attaque: "patte", laser: 0 })).toContain("rugir");
    expect(jouer(a, 1, 8, { attaque: "saut", laser: 0 })).toContain("saut");
    for (const q of a.pose().q) for (const x of [q.x, q.y, q.z, q.w]) expect(Number.isFinite(x)).toBe(true);
  });

  it("à l'arrêt, il enchaîne des gestes de repos variés ; en marche, aucun", () => {
    const a = creerAnimTigreGeant(3);
    expect(jouer(a, 4, 8, { laser: 0 }).size).toBe(0);
    const gestes: unknown[] = [];
    let dernier: unknown = null;
    for (let i = 0; i < 40 * 60; i++) {
      a.maj(1 / 60, 0, ECHELLE, { laser: 0 });
      const g = a.geste();
      if (g && g !== dernier) gestes.push(g);
      dernier = g;
    }
    expect(gestes.length).toBeGreaterThanOrEqual(4);
    expect(new Set(gestes).size).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < gestes.length; i++) expect(gestes[i]).not.toBe(gestes[i - 1]);
  });

  it("laser armé, charge et rage : poses finies, pas de geste de repos", () => {
    const a = creerAnimTigreGeant();
    expect(jouer(a, 3, 0, { laser: 0.8 }).size).toBe(0);
    expect(jouer(a, 3, 0, { attaque: "charge", laser: 0, rage: true }).size).toBe(0);
    for (const q of a.pose().q) expect(Number.isFinite(q.w)).toBe(true);
  });
});
