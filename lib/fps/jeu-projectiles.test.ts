import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import { pointImpact, preparerProjectile } from "./effets-armes";
import { EXPLOSION_PROJECTILE_MAX_MS, PREDICTION_PROJECTILE_MAX_MS, creerControleurProjectiles } from "./jeu-projectiles";
import type { MessageServeur, Vec3 } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
const mur = construireMonde({ ...scene, buildings: [rect(10, -20, 11, 20, 6)], pois: [] });
const o: Vec3 = [0, 1.6, 0];

function messageDe(arme: "brochette" | "pistolet", ameliore: boolean, id: number, par: string, t0: number): Extract<MessageServeur, { t: "projectile" }> {
  const tir = preparerProjectile(mur, arme, ameliore, o, [1, 0, 0], t0)!;
  return {
    t: "projectile", id, par, arme, ...(ameliore ? { ameliore: true as const } : {}), o: tir.o, v: tir.v, t0, impactT: tir.impactT,
    explosionT: tir.explosionT, impact: pointImpact(tir),
  };
}

describe("projectiles côté client", () => {
  it("ma prédiction part tout de suite, puis le message du serveur la remplace (même arme) ; celui d'un autre s'ajoute", () => {
    const c = creerControleurProjectiles(mur);
    expect(c.predire("brochette", false, o, [1, 0, 0], 1000, "a")).not.toBeNull();
    expect(c.predire("perforeuse", false, o, [1, 0, 0], 1000, "a")).toBeNull();
    expect(c.affiches(1010)).toHaveLength(1);
    c.recevoir(messageDe("brochette", false, 7, "a", 1005), "a");
    expect(c.affiches(1020).map((x) => x.id)).toEqual([7]);
    c.recevoir(messageDe("pistolet", true, 8, "b", 1010), "a");
    expect(c.affiches(1020).map((x) => x.id).sort()).toEqual([7, 8]);
  });

  it("en vol il avance, planté il reste au point d'impact du serveur et clignote jusqu'à l'explosion, puis `exploser` le retire", () => {
    const c = creerControleurProjectiles(mur);
    const m = messageDe("brochette", false, 3, "b", 0);
    c.recevoir(m, "a");
    const vol = c.affiches(50)[0];
    expect(vol.plante).toBe(false);
    expect(vol.dir[0]).toBeGreaterThan(0.99);
    expect(vol.p[0]).toBeGreaterThan(o[0]);
    const plante = c.affiches(m.impactT + 200)[0];
    expect(plante.plante).toBe(true);
    expect(plante.p).toEqual(m.impact);
    expect(plante.attente).toBeGreaterThan(0);
    expect(plante.attente).toBeLessThan(1);
    expect(c.exploser(3)?.id).toBe(3);
    expect(c.affiches(m.impactT + 300)).toEqual([]);
  });

  it("planté dans un tigre, il suit le tigre affiché", () => {
    const c = creerControleurProjectiles(mur);
    const m = { ...messageDe("brochette", true, 4, "b", 0), cible: "z12" };
    c.recevoir(m, "a");
    const a = c.affiches(m.impactT + 100, (id) => (id === 12 ? [3, 0, 4] : null))[0];
    expect(a.cible).toBe(12);
    expect(a.p[0]).toBe(3);
    expect(a.p[2]).toBe(4);
  });

  it("purge : prédiction jamais confirmée, explosion jamais annoncée", () => {
    const c = creerControleurProjectiles(mur);
    c.predire("brochette", false, o, [1, 0, 0], 0, "a");
    expect(c.affiches(PREDICTION_PROJECTILE_MAX_MS + 1)).toEqual([]);
    const m = messageDe("pistolet", true, 9, "b", 0);
    c.recevoir(m, "a");
    expect(c.affiches(m.explosionT + EXPLOSION_PROJECTILE_MAX_MS + 1)).toEqual([]);
    c.recevoir(m, "a");
    c.vider();
    expect(c.affiches(10)).toEqual([]);
  });
});
