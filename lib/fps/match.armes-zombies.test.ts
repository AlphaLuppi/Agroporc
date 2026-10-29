import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { Salle, type JoueurSalle, type OptionsSalle, type Sortie } from "./match";
import type { OptionsServiceZombies } from "./match-zombies";
import { segmentsRicochet } from "./effets-armes";
import { SILHOUETTE, copierEquipement, decoderZombies, type Equipement, type MessageServeur, type Vec3 } from "./protocole";
import { DEPARTS, construireMondeZombies } from "./zombies-carte";

/**
 * (v8) Intégration des armes du lot zr/armes dans une vraie `Salle` de zombies : validation serveur de la cadence d'une paire akimbo (une
 * cadence par main, main gauche refusée pour une arme seule), des ricochets (tronçon rejoué par le serveur), des tirs spéciaux (projectile :
 * aucune touche déclarée n'est lue) et l'arène inchangée.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMondeZombies(scene);
const T0 = 5_000_000;

function suite(graine = 3): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}
function partie(zombies: Partial<OptionsServiceZombies> = {}): Salle {
  const options: OptionsSalle = { zombies: { pauseMs: 1000, degatsGriffe: 0, total1: 3, ...zombies } };
  const s = new Salle(construireMondeZombies(scene), DEPARTS.map((d) => [d[0], d[1]] as [number, number]), suite(), T0, options);
  s.connecter("a", "Alice", T0);
  s.recevoir("a", { t: "lancerPartie" }, T0);
  s.recevoir("a", { t: "rejoindre" }, T0);
  return s;
}
const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
function avancer(s: Salle, t0: number, t1: number, pas = 50): Sortie[] {
  const out: Sortie[] = [];
  for (let t = t0; t <= t1; t += pas) {
    for (const x of s.joueurs()) if (x.enJeu) x.etatT = t;
    out.push(...s.tic(t));
  }
  return out;
}
function tigresDe(sorties: Sortie[]) {
  const snap = messages(sorties.filter((x) => x.a === "joueurs"), "snap").filter((m) => m.zombies).at(-1);
  return snap ? decoderZombies(snap.zombies!) : [];
}
/** Partie avancée jusqu'au premier tigre en chasse ; le joueur est posé à `d` m de lui, côté d'où il venait, et tient `arme`. */
function faceAUnTigre(arme: string, slot: "principale" | "secondaire", ameliore: boolean, d = 5) {
  const s = partie();
  let t = T0 + 50;
  let z: ReturnType<typeof tigresDe>[number] | undefined;
  for (; t < T0 + 60_000 && !z; t += 500) z = tigresDe(avancer(s, t, t + 450)).find((x) => x.mode === "chasse");
  expect(z).toBeDefined();
  const a = j(s, "a");
  const e: Equipement = copierEquipement(a.equip);
  if (slot === "principale") { e.principale = arme as Equipement["principale"]; delete e.sansPrincipale; } else e.secondaire = arme as Equipement["secondaire"];
  if (ameliore) e.ameliorees = [arme as Equipement["secondaire"]];
  s.equiper(a, e, slot, t - 2000);
  let dx = a.p[0] - z!.x, dz = a.p[2] - z!.z;
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  a.p = [z!.x + dx * d, 0, z!.z + dz * d];
  return { s, a, z: z!, id: `z${z!.id}`, t };
}
function regarder(s: Salle, id: string, point: Vec3): { o: Vec3; d: Vec3 } {
  const a = j(s, id);
  const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
  const v = [point[0] - o[0], point[1] - o[1], point[2] - o[2]];
  const l = Math.hypot(v[0], v[1], v[2]);
  const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
  a.lacet = Math.atan2(-d[0], -d[2]);
  a.tangage = Math.asin(d[1]);
  return { o, d };
}

describe("(v8) paire akimbo : une cadence par main", () => {
  it("Perforeuses jumelles : main droite puis main gauche au même instant acceptées ; une troisième refusée ; main gauche d'une arme seule refusée", () => {
    const { s, z, id, t } = faceAUnTigre("perforeuse", "secondaire", true);
    const { o, d } = regarder(s, "a", [z.x, 1.0, z.z]);
    const tir = (main?: "g") => s.recevoir("a", { t: "tir", arme: "perforeuse", o, d: [d], touches: [{ cible: id, zone: "corps", plomb: 0 }], ...(main ? { main } : {}) }, t);
    const droite = tir();
    expect(messages(droite, "tir")).toHaveLength(1);
    const gauche = tir("g");
    expect(messages(gauche, "tir")[0]).toMatchObject({ arme: "perforeuse", main: "g" });
    // les deux mains ont tiré : la suivante attend sa cadence (crédit de rafale épuisé à la 3e de suite)
    let refuses = 0;
    for (let k = 0; k < 4; k++) if (tir().length === 0) refuses++;
    expect(refuses).toBeGreaterThan(0);
  });

  it("une arme seule n'a pas de main gauche", () => {
    const { s, z, id, t } = faceAUnTigre("perforeuse", "secondaire", false);
    const { o, d } = regarder(s, "a", [z.x, 1.0, z.z]);
    expect(s.recevoir("a", { t: "tir", arme: "perforeuse", o, d: [d], touches: [{ cible: id, zone: "corps", plomb: 0 }], main: "g" }, t)).toEqual([]);
  });
});

describe("(v8) ricochets rejoués par le serveur", () => {
  /** Tir vers le sol aux deux tiers du chemin : le rebond remonte vers le dos du tigre. */
  function tirRebond(arme: string, ameliore: boolean) {
    const r = faceAUnTigre(arme, "secondaire", ameliore, 6);
    const o: Vec3 = [r.a.p[0], r.a.p[1] + SILHOUETTE.oeil, r.a.p[2]];
    const sol: Vec3 = [o[0] + (r.z.x - o[0]) * 0.62, 0, o[2] + (r.z.z - o[2]) * 0.62];
    const { d } = regarder(r.s, "a", sol);
    return { ...r, o, d };
  }

  it("Uzi plancha : la touche déclarée sur le tronçon 1 (après le rebond au sol) est revalidée et compte", () => {
    const { s, id, o, d, t } = tirRebond("mini_uzi", true);
    const tr = segmentsRicochet(monde, o, d, 45, 2);
    expect(tr.length).toBeGreaterThanOrEqual(2);
    expect(tr[1].d[1]).toBeGreaterThan(0);
    const sorties = s.recevoir("a", { t: "tir", arme: "mini_uzi", o, d: [d], touches: [{ cible: id, zone: "corps", plomb: 0, seg: 1 }] }, t);
    expect(messages(sorties, "degats").some((m) => m.cible === id)).toBe(true);
  });

  it("sans ricochet (Uzi de base) le même tronçon est refusé ; un tronçon au-delà des rebonds de l'arme aussi", () => {
    const { s, id, o, d, t } = tirRebond("mini_uzi", false);
    expect(messages(s.recevoir("a", { t: "tir", arme: "mini_uzi", o, d: [d], touches: [{ cible: id, zone: "corps", plomb: 0, seg: 1 }] }, t), "degats")).toEqual([]);
    const r = tirRebond("mini_uzi", true);
    expect(messages(r.s.recevoir("a", { t: "tir", arme: "mini_uzi", o: r.o, d: [r.d], touches: [{ cible: r.id, zone: "corps", plomb: 0, seg: 3 }] }, r.t), "degats")).toEqual([]);
  });
});

describe("(v8) tir spécial", () => {
  it("projectile : les touches déclarées sont ignorées, le serveur diffuse `projectile` et résout l'impact lui-même", () => {
    const { s, z, id, t } = faceAUnTigre("pistolet", "secondaire", true, 4);
    const { o, d } = regarder(s, "a", [z.x, 0.8, z.z]);
    const sorties = s.recevoir("a", { t: "tir", arme: "pistolet", o, d: [d], touches: [{ cible: id, zone: "tete", plomb: 0 }] }, t);
    expect(messages(sorties, "degats")).toEqual([]);
    expect(messages(sorties, "projectile")).toHaveLength(1);
    expect(messages(sorties, "tir")).toHaveLength(1);
  });
});
