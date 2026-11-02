/**
 * Frappe aérienne (série de 5 kills), côté serveur : de bout en bout dans `Salle`. Ces tests auraient attrapé le défaut du lot tactique côté serveur :
 * la frappe se gagne, ne se lance qu'une fois, se perd à la mort, tue avec la cause `frappe_aerienne` et le kill est crédité au lanceur.
 * (Côté client le défaut était la touche K, qui ne faisait rien, et un ciblage « au clic sur la carte » impossible sous le pointer lock : cf.
 * `ciblage-frappe.test.ts` et `touches.actions-branchees.test.ts`.)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import { FRAPPE } from "./frappe-aerienne";
import { Salle, type JoueurSalle, type Sortie } from "./match";
import type { MessageServeur, Vec3 } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 10, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
const monde = construireMonde({ ...scene, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000)], pois: [] } as SceneData);
const APPARITIONS: Vec2[] = [[-300, -300], [300, 300], [-300, 300], [300, -300]];
const T0 = 2_000_000;
const PAS = 1000 / 60;

function salle(ids: string[]): Salle {
  const s = new Salle(monde, APPARITIONS, () => 0.5, T0, { bus: false });
  for (const id of ids) {
    s.connecter(id, `Joueur${id}`, T0);
    s.recevoir(id, { t: "rejoindre", principale: "sniper", secondaire: "pistolet" }, T0);
  }
  return s;
}
const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
function avancer(s: Salle, de: number, a: number, chaque?: (t: number) => void): Sortie[] {
  const sorties: Sortie[] = [];
  for (let t = de + PAS; t < a + PAS; t += PAS) { chaque?.(t); sorties.push(...s.tic(Math.min(t, a))); }
  return sorties;
}
function tenir(s: Salle, positions: Record<string, Vec3>, t: number) {
  for (const [id, p] of Object.entries(positions)) { const a = j(s, id); a.p = [...p]; a.v = [0, 0, 0]; a.etatT = t; a.protegeJusqua = 0; }
}
/** `n` kills de `tueur` sur `victime` (ressuscitée entre chaque), renvoie les sorties. */
function tuerN(s: Salle, tueur: string, victime: string, n: number, t: number): Sortie[] {
  const sorties: Sortie[] = [];
  for (let k = 0; k < n; k++) {
    j(s, victime).vivant = true;
    j(s, victime).pv = 100;
    sorties.push(...s.tuer(j(s, victime), j(s, tueur), "arme", t + k));
  }
  return sorties;
}

describe("frappe aérienne : gagnée par 5 kills d'affilée", () => {
  it("rien avant le cinquième kill, puis `frappe{disponible}` au tueur SEUL", () => {
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [20, 0, 0] }, T0);
    expect(messages(tuerN(s, "a", "b", 4, T0 + 100), "frappe")).toHaveLength(0);
    const cinq = tuerN(s, "a", "b", 1, T0 + 200);
    const f = cinq.filter((x) => x.m.t === "frappe");
    expect(f).toHaveLength(1);
    expect(f[0].a).toBe("a");
    expect(f[0].m).toMatchObject({ evenement: "disponible", joueur: "a", serie: 5 });
  });

  it("la mort de celui qui la détient la lui retire : lancerFrappe ne fait plus rien", () => {
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [20, 0, 0] }, T0);
    tuerN(s, "a", "b", 5, T0 + 100);
    j(s, "a").vivant = true;
    s.tuer(j(s, "a"), j(s, "b"), "arme", T0 + 300);
    j(s, "a").vivant = true;
    expect(messages(s.recevoir("a", { t: "lancerFrappe", cible: [20, 0, 0] }, T0 + 400), "frappe")).toHaveLength(0);
  });
});

describe("frappe aérienne : lancer", () => {
  it("sans série de 5, lancerFrappe est refusé", () => {
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [20, 0, 0] }, T0);
    tuerN(s, "a", "b", 4, T0 + 100);
    expect(s.recevoir("a", { t: "lancerFrappe", cible: [20, 0, 0] }, T0 + 400)).toEqual([]);
  });

  it("annonce `frappe{lancee}` à tous les joueurs, ne se lance qu'UNE fois, la suivante exige 5 kills de plus", () => {
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [200, 0, 200] }, T0);
    tuerN(s, "a", "b", 5, T0 + 100);
    const out = s.recevoir("a", { t: "lancerFrappe", cible: [50, 0, 50] }, T0 + 500);
    const f = messages(out, "frappe");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ evenement: "lancee", joueur: "a", cible: [50, 0, 50] });
    expect(out.find((x) => x.m.t === "frappe")!.a).toBe("joueurs");
    // deuxième tentative avec la même série : rien
    expect(s.recevoir("a", { t: "lancerFrappe", cible: [50, 0, 50] }, T0 + 600)).toEqual([]);
    // kills 6 à 9 : toujours rien ; le dixième redonne une frappe
    expect(messages(tuerN(s, "a", "b", 4, T0 + 700), "frappe")).toHaveLength(0);
    expect(messages(tuerN(s, "a", "b", 1, T0 + 800), "frappe").filter((x) => x.evenement === "disponible")).toHaveLength(1);
  });

  it("refuse une cible qui n'est pas un point (message corrompu)", () => {
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [20, 0, 0] }, T0);
    tuerN(s, "a", "b", 5, T0 + 100);
    expect(s.recevoir("a", { t: "lancerFrappe", cible: ["x", 0, 0] as unknown as Vec3 }, T0 + 200)).toEqual([]);
    // la frappe n'a pas été consommée par le message invalide
    expect(messages(s.recevoir("a", { t: "lancerFrappe", cible: [1, 0, 1] }, T0 + 300), "frappe")).toHaveLength(1);
  });

  it("les missiles tuent dans la zone avec la cause `frappe_aerienne`, le kill va au lanceur, hors zone rien", () => {
    const s = salle(["a", "b", "c"]);
    const pos = { a: [0, 0, 0] as Vec3, b: [200, 0, 200] as Vec3, c: [-250, 0, -250] as Vec3 };
    tenir(s, pos, T0);
    tuerN(s, "a", "c", 5, T0 + 100); // la série se fait sur c, c revit ensuite
    tenir(s, pos, T0 + 150);
    j(s, "b").pv = 60; j(s, "b").bouclier = 0;
    s.recevoir("a", { t: "lancerFrappe", cible: [200, 0, 200] }, T0 + 200);
    const killsAvant = j(s, "a").kills;
    const sorties = avancer(s, T0 + 200, T0 + 200 + FRAPPE.dureeTotaleMs + 500, (t) => tenir(s, pos, t));
    expect(messages(sorties, "explosionMonstre").length).toBe(FRAPPE.nbImpacts);
    const morts = messages(sorties, "mort").filter((m) => m.cible === "b");
    expect(morts).toHaveLength(1);
    expect(morts[0]).toMatchObject({ par: "a", cause: "frappe_aerienne" });
    expect(j(s, "a").kills).toBe(killsAvant + 1);
    // c, à 600 m de là, n'a rien subi
    expect(messages(sorties, "degats").filter((d) => d.cible === "c")).toHaveLength(0);
  });

  it("le snap porte la frappe en cours (c'est lui que le client dessine)", () => {
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [200, 0, 200] }, T0);
    tuerN(s, "a", "b", 5, T0 + 100);
    s.recevoir("a", { t: "lancerFrappe", cible: [50, 0, 50] }, T0 + 500);
    const sorties = avancer(s, T0 + 500, T0 + 800, (t) => tenir(s, { a: [0, 0, 0], b: [200, 0, 200] }, t));
    const snap = messages(sorties, "snap").at(-1)!;
    expect(snap.monstres?.frappes).toHaveLength(1);
    expect(snap.monstres!.frappes![0]).toMatchObject({ joueur: "a", cible: [50, 0, 50] });
  });
});

describe("frappe aérienne : mode où elle n'existe pas", () => {
  it("en zombies, lancerFrappe ne fait rien", () => {
    // pas de salle de zombies ici (service lourd) : la garde est `frappesDisponibles`, jamais alimentée hors arène (cf. `mourir`, test BR du service)
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [20, 0, 0] }, T0);
    expect(s.recevoir("a", { t: "lancerFrappe", cible: [0, 0, 0] }, T0 + 100)).toEqual([]);
  });
});
