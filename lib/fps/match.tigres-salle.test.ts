import { describe, expect, it } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { COUTEAU, MELEE, degatsPlomb } from "./armes";
import { construireMonde } from "./collision";
import { Salle, type JoueurSalle, type Sortie } from "./match";
import { JEU, SILHOUETTE, type MessageServeur, type Vec3 } from "./protocole";
import { TIGRE, hitboxTigre, type CachetteTigre } from "./tigre-arene";

/**
 * Salle RÉELLE avec le vrai service des tigres : tir et couteau sur un tigre par les messages des clients, sort gagné, invocation,
 * kill du tigre allié crédité au lanceur (cause « tigre »), tigres dans le snap, synchro de l'avion à `rejoindre`.
 */
const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 3, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
/** Monde vide, bornes ±225 m */
const monde = construireMonde({ buildings: [rect(-201, -201, -199, -199), rect(199, 199, 201, 201)], pois: [], roads: [], parkings: [], water: [], trees: [] } as unknown as SceneData);
const ZONE = { centre: [0, 0] as Vec2, rMin: 25, rMax: 140, bandeMin: 40, bandeMax: 110, bandeCible: 75 };
const POINTS: Vec2[] = [[-60, 5], [-55, -5], [-50, 0], [-58, 0]];
const CACHETTES: CachetteTigre[] = [{ x: 60, z: 0, cap: 0 }, { x: -60, z: 80, cap: 0 }, { x: 0, z: 120, cap: 0 }];
const T0 = 1_000_000;
const PAS_MS = 1000 / 60;

const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
/** Tics à 60 Hz. Les joueurs restent « actifs » (pas d'éviction) : leur dernier état est daté de chaque tic. */
function tourner(s: Salle, depuis: number, ms: number, avant?: (m: number) => void): { sorties: Sortie[]; fin: number } {
  const sorties: Sortie[] = [];
  let m = depuis;
  for (let k = 1; k <= Math.round(ms / PAS_MS); k++) {
    m = depuis + Math.round(k * PAS_MS);
    for (const id of ["a", "b"]) {
      const x = s.inspecter(id) as JoueurSalle | undefined;
      if (x) x.etatT = m;
    }
    avant?.(m);
    sorties.push(...s.tic(m));
  }
  return { sorties, fin: m };
}

/** Deux joueurs au fusil d'assaut, un tigre sauvage posé en (60, 0). */
function salleAvecTigre() {
  const s = new Salle(monde, POINTS, () => 0, T0, { zoneApparition: ZONE, tigres: { cachettes: CACHETTES, intervalle: { minMs: 1000, maxMs: 1000 } } });
  for (const id of ["a", "b"]) {
    s.connecter(id, id === "a" ? "Alice" : "Bob", T0);
    s.recevoir(id, { t: "rejoindre", principale: "fusil_assaut", secondaire: "pistolet" }, T0);
  }
  const { sorties, fin } = tourner(s, T0, 1000 + 20_000 + TIGRE.descenteMs);
  const id = messages(sorties, "avion").find((m) => m.evenement === "largage")!.tigre!;
  return { s, id, fin };
}

/** Place le joueur à `p`, le regard vers `cible`. Renvoie l'œil et la direction du tir. */
function viser(s: Salle, joueur: string, p: Vec3, cible: Vec3): { o: Vec3; d: Vec3 } {
  const x = j(s, joueur);
  x.p = p;
  const o: Vec3 = [p[0], p[1] + SILHOUETTE.oeil, p[2]];
  const v = [cible[0] - o[0], cible[1] - o[1], cible[2] - o[2]];
  const l = Math.hypot(v[0], v[1], v[2]);
  const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
  x.lacet = Math.atan2(-d[0], -d[2]);
  x.tangage = Math.asin(d[1]);
  return { o, d };
}
/** Centre du corps du tigre couché en (60, 0), cap 0. */
const h = hitboxTigre({ p: [60, 0, 0], cap: 0, pose: "couche" });
const CORPS: Vec3 = [(h.a[0] + h.b[0]) / 2, h.a[1], (h.a[2] + h.b[2]) / 2];

describe("salle : tigres de bout en bout (sans réseau)", () => {
  it("le snap des joueurs porte le tigre, la synchro de `rejoindre` porte l'avion", () => {
    const { s, id, fin } = salleAvecTigre();
    const snaps = messages(tourner(s, fin, 100).sorties, "snap");
    expect(snaps[0].tigres).toEqual([expect.objectContaining({ id, genre: "sauvage", etat: "tapi", pose: "couche", pv: 2500, p: [60, 0, 0] })]);
    s.connecter("c", "Chloé", fin);
    const r = s.recevoir("c", { t: "rejoindre" }, fin + 200);
    expect(messages(r, "avion")).toEqual([{ t: "avion", evenement: "etat", avion: null }]);
  });

  it("un tir de fusil d'assaut validé sur le tigre : tigre{touche} de 22 au corps, sans dégâts de joueur ni statistique de touche", () => {
    const { s, id, fin } = salleAvecTigre();
    const { o, d } = viser(s, "a", [45, 0, 0], CORPS);
    const r = s.recevoir("a", { t: "tir", arme: "fusil_assaut", o, d: [d], touches: [{ cible: id, zone: "corps", plomb: 0 }] }, fin + 10);
    expect(messages(r, "tigre")).toEqual([
      expect.objectContaining({ evenement: "touche", id, par: "a", degats: degatsPlomb("fusil_assaut", "corps", 15), pv: 2500 - 22 }),
    ]);
    expect(messages(r, "degats")).toEqual([]);
    expect(j(s, "a").touches).toBe(0);
    expect(j(s, "a").tirs).toBe(1);
  });

  it("un tir qui passe à 3 m du tigre est refusé", () => {
    const { s, id, fin } = salleAvecTigre();
    const { o, d } = viser(s, "a", [45, 0, 0], [60, 0.4, 3.5]);
    const r = s.recevoir("a", { t: "tir", arme: "fusil_assaut", o, d: [d], touches: [{ cible: id, zone: "tete", plomb: 0 }] }, fin + 10);
    expect(messages(r, "tigre")).toEqual([]);
  });

  it("un coup de couteau validé : 100 dégâts", () => {
    const { s, id, fin } = salleAvecTigre();
    s.recevoir("a", { t: "main", slot: "couteau" }, fin);
    const { o, d } = viser(s, "a", [61.5, 0, 0], [60, 0.4, 0]);
    const r = s.recevoir("a", { t: "coup", o, d, cibles: [id] }, fin + JEU.degainageMs + 10);
    expect(messages(r, "tigre")).toEqual([expect.objectContaining({ evenement: "touche", par: "a", degats: COUTEAU.degats })]);
  });

  it("un coup d'épée validé sur un tigre largué : 140 dégâts (arme blanche de la v6 sur les tigres de la v5)", () => {
    const { s, id, fin } = salleAvecTigre();
    const a = j(s, "a");
    a.equip = { ...a.equip, melee: "epee" };
    s.recevoir("a", { t: "main", slot: "couteau" }, fin);
    expect(a.arme).toBe("epee");
    const { o, d } = viser(s, "a", [62.5, 0, 0], [60, 0.4, 0]);
    const r = s.recevoir("a", { t: "coup", o, d, cibles: [id] }, fin + JEU.degainageMs + 10);
    expect(messages(r, "tigre")).toEqual([expect.objectContaining({ evenement: "touche", par: "a", degats: MELEE.epee.degats })]);
  });

  it("tigre abattu : sort gagné, invocation, le tigre allié tue l'autre joueur et le kill revient au lanceur (cause « tigre »)", () => {
    const { s, id, fin } = salleAvecTigre();
    const service = (s as unknown as { tigres: { tigre(i: string): { pv: number } } }).tigres;
    service.tigre(id)!.pv = 20;
    const { o, d } = viser(s, "a", [45, 0, 0], CORPS);
    const r = s.recevoir("a", { t: "tir", arme: "fusil_assaut", o, d: [d], touches: [{ cible: id, zone: "corps", plomb: 0 }] }, fin + 10);
    expect(messages(r, "tigre").map((m) => m.evenement)).toEqual(["touche", "mort"]);
    expect(messages(r, "sort")).toEqual([{ t: "sort", evenement: "gagne", joueur: "a" }]);

    // invocation près de Bob (protection d'apparition écoulée depuis longtemps)
    j(s, "a").p = [-40, 0, 0];
    j(s, "a").lacet = Math.PI / 2; // regard vers −x
    j(s, "b").p = [-50, 0, 0];
    const inv = s.recevoir("a", { t: "invoquer" }, fin + 20);
    expect(messages(inv, "sort")[0]).toMatchObject({ evenement: "lance", joueur: "a" });
    const { sorties } = tourner(s, fin + 20, 12_000, () => {
      j(s, "a").p = [-40, 0, 0];
      if (j(s, "b").vivant) j(s, "b").p = [-50, 0, 0];
    });
    const degats = messages(sorties, "degats").filter((m) => m.cible === "b");
    expect(degats.length).toBeGreaterThanOrEqual(6);
    expect(degats.every((m) => m.par === "a" && m.degats === 15)).toBe(true);
    const mort = messages(sorties, "mort").find((m) => m.cible === "b");
    expect(mort).toMatchObject({ par: "a", cause: "tigre", arme: "couteau" });
    expect(j(s, "a").kills).toBe(1);
    expect(j(s, "a").killsParArme).toEqual({});
  });
});
