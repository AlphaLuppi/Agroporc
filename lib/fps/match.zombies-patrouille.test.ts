import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { Salle, type OptionsSalle, type Sortie } from "./match";
import type { ServiceZombies } from "./match-contexte";
import type { OptionsServiceZombies } from "./match-zombies";
import { PATROUILLE } from "./patrouille-zombies";
import { decoderZombies, type EvenementZombies, type MessageServeur } from "./protocole";
import { BORNES_ZOMBIES, DEPARTS, construireMondeZombies } from "./zombies-carte";

/**
 * Patrouille de police des zombies sur une vraie `Salle` (spec 2026-10-30, §6) : seulement en manche, jamais en manche du Truck, deux au plus,
 * figée par la suspension, sans toucher au hasard de la salle. Les règles pures sont dans patrouille-zombies.test.ts.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const T0 = 5_000_000;

function suite(graine = 3): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}
type Patrouille = Extract<EvenementZombies, { e: "patrouille" }>;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
const patrouilles = (sorties: Sortie[]): Patrouille[] =>
  messages(sorties, "zevt").map((m) => m.e).filter((e): e is Patrouille => e.e === "patrouille");

/** Partie de zombies lancée à T0 (manche 1 vide, ennemis inoffensifs aux manches suivantes). */
function partie(zombies: Partial<OptionsServiceZombies>, suspension: OptionsSalle["suspension"] = { compteMs: 0 }): Salle {
  const options: OptionsSalle = { zombies: { pauseMs: 1000, degatsGriffe: 0, total1: 0, ...zombies }, suspension };
  const s = new Salle(construireMondeZombies(scene), DEPARTS.map((d) => [d[0], d[1]] as [number, number]), suite(), T0, options);
  s.connecter("a", "Alice", T0);
  s.recevoir("a", { t: "lancerPartie" }, T0);
  s.recevoir("a", { t: "rejoindre" }, T0);
  return s;
}
function avancer(s: Salle, t0: number, t1: number, pas = 100): Sortie[] {
  const out: Sortie[] = [];
  for (let t = t0; t <= t1; t += pas) {
    for (const x of s.joueurs()) if (x.enJeu) x.etatT = t;
    out.push(...s.tic(t));
  }
  return out;
}
const serviceDe = (s: Salle) => (s as unknown as { zombies: ServiceZombies }).zombies;
const mancheDe = (s: Salle) => s.resumeZombies()?.manche ?? 0;

describe("patrouille de police des zombies (Salle)", () => {
  it("coupée (`patrouille: false`) : aucun passage, même avec toutes les conditions réunies", () => {
    const s = partie({ patrouille: false });
    expect(patrouilles(avancer(s, T0 + 100, T0 + 60_000))).toEqual([]);
  });

  it("jamais avant la manche éligible, puis un passage dès son début (délai 0), hors de la carte et daté", () => {
    const s = partie({ patrouille: { manche: 2, delaiMs: 0 } });
    const sorties = avancer(s, T0 + 100, T0 + 30_000);
    expect(mancheDe(s)).toBeGreaterThanOrEqual(2);
    const p = patrouilles(sorties);
    // délai 0 : la seconde part dès que la première a fini (30 s laissent le temps à deux, jamais plus)
    expect(p.length).toBeGreaterThanOrEqual(1);
    expect(p.length).toBeLessThanOrEqual(PATROUILLE.max);
    const e = p[0];
    expect(e.finT).toBeGreaterThan(e.t0);
    expect(e.finT - e.t0).toBeGreaterThan(8_000);
    for (const pt of [e.p0, e.p1]) {
      const dedans = pt[0] >= BORNES_ZOMBIES.x0 && pt[0] <= BORNES_ZOMBIES.x1 && pt[2] >= BORNES_ZOMBIES.z0 && pt[2] <= BORNES_ZOMBIES.z1;
      expect(dedans).toBe(false);
    }
    // le passage n'a lieu qu'en manche 2 : pas un seul `zevt` de patrouille avant que la manche 2 commence
    const avantManche2 = sorties.slice(0, sorties.findIndex((x) => x.m.t === "zevt" && (x.m as { e: EvenementZombies }).e.e === "manche" && (x.m as { e: { numero?: number } }).e.numero === 2));
    expect(patrouilles(avantManche2)).toEqual([]);
  });

  it("deux passages au plus par partie, jamais deux à la fois", () => {
    const s = partie({ patrouille: { manche: 1, delaiMs: 0 } });
    const p = patrouilles(avancer(s, T0 + 100, T0 + 120_000));
    expect(p).toHaveLength(PATROUILLE.max);
    expect(p[1].t0).toBeGreaterThanOrEqual(p[0].finT);
  });

  it("jamais pendant une manche du Truck Muche", () => {
    const s = partie({ patrouille: { manche: 1, delaiMs: 0 }, mancheTruck: 2 });
    // la manche 1 est vide : son passage (avant la manche du Truck) est permis, aucun autre
    avancer(s, T0 + 100, T0 + 20_000);
    expect(mancheDe(s)).toBeGreaterThanOrEqual(2);
    const dansTruck = avancer(s, T0 + 20_100, T0 + 80_000);
    expect(s.resumeZombies()?.manche).toBe(2);
    expect(patrouilles(dansTruck)).toEqual([]);
  });

  it("figée par la suspension : rien tant que l'horloge virtuelle n'a pas atteint le minuteur, puis un seul passage", () => {
    const s = partie({ patrouille: { manche: 1, delaiMs: 20_000 } });
    avancer(s, T0 + 100, T0 + 6_000);
    expect(patrouilles(avancer(s, T0 + 6_100, T0 + 6_500))).toEqual([]);
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 6_600);
    expect(s.suspendue()).toBe(true);
    // une heure d'horloge réelle suspendue : aucun passage, aucune avance du minuteur
    expect(patrouilles(avancer(s, T0 + 6_700, T0 + 3_600_000, 5_000))).toEqual([]);
    s.recevoir("a", { t: "pauseZ", actif: false }, T0 + 3_600_100);
    expect(s.suspendue()).toBe(false);
    const apres = avancer(s, T0 + 3_600_200, T0 + 3_600_200 + 40_000);
    const p = patrouilles(apres);
    expect(p).toHaveLength(1);
    // les instants du message sont ceux de l'horloge virtuelle (≈ T0 + 6,6 s + le temps réellement joué), pas ceux de l'horloge réelle
    expect(p[0].t0).toBeLessThan(T0 + 120_000);
  });

  it("ne consomme pas le hasard de la salle : mêmes tigres, avec ou sans patrouille", () => {
    const a = partie({ patrouille: false, total1: 4 }), b = partie({ patrouille: { manche: 1, delaiMs: 0 }, total1: 4 });
    const sa = avancer(a, T0 + 100, T0 + 25_000), sb = avancer(b, T0 + 100, T0 + 25_000);
    expect(patrouilles(sb).length).toBeGreaterThan(0);
    const dernier = (s: Sortie[]) => messages(s.filter((x) => x.a === "joueurs"), "snap").filter((m) => m.zombies).at(-1)?.zombies;
    const za = dernier(sa), zb = dernier(sb);
    expect(za).toBeDefined();
    expect(decoderZombies(zb!)).toEqual(decoderZombies(za!));
  });

  it("remise à zéro au retour au lobby : une nouvelle partie reprend deux passages", () => {
    const s = partie({ patrouille: { manche: 1, delaiMs: 0 } });
    expect(patrouilles(avancer(s, T0 + 100, T0 + 120_000))).toHaveLength(2);
    serviceDe(s).reinitialiser(T0 + 121_000);
    expect(mancheDe(s)).toBe(0);
    s.recevoir("a", { t: "lancerPartie" }, T0 + 122_000);
    s.recevoir("a", { t: "rejoindre" }, T0 + 122_000);
    expect(patrouilles(avancer(s, T0 + 122_100, T0 + 240_000))).toHaveLength(2);
  });
});
