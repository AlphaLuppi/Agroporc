import { describe, expect, it } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import { Salle, type JoueurSalle, type OptionsSalle, type Sortie } from "./match";
import { EVENEMENTS } from "./monstres";
import { CIBLE_TIGRE, type MessageServeur } from "./protocole";
import { TIGRE, type CachetteTigre } from "./tigre-arene";

/**
 * Salle RÉELLE avec les deux services, tigres largués (match-tigres.ts) et événements (match-evenements.ts) : l'avion ne passe pas
 * pendant l'événement du tigre géant, et le tigre géant n'est pas annoncé pendant le survol de l'avion ni tant qu'un tigre sauvage
 * largué vit (spec 2026-10-23-arene-tigres-design.md, Cohabitation avec le tigre géant).
 */
const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 3, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
/** Monde vide, bornes ±225 m */
const monde = construireMonde({ buildings: [rect(-201, -201, -199, -199), rect(199, 199, 201, 201)], pois: [], roads: [], parkings: [], water: [], trees: [] } as unknown as SceneData);
const ZONE = { centre: [0, 0] as Vec2, rMin: 25, rMax: 140, bandeMin: 40, bandeMax: 110, bandeCible: 75 };
const POINTS: Vec2[] = [[-60, 5], [-55, -5], [-50, 0], [-58, 0]];
const CACHETTES: CachetteTigre[] = [{ x: 60, z: 0, cap: 0 }, { x: -60, z: 80, cap: 0 }, { x: 0, z: 120, cap: 0 }];
const T0 = 1_000_000;
const PAS_MS = 1000 / 60;

function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}

/** Deux joueurs tenus loin de la cachette (60, 0) et du tigre géant, avion toutes les secondes. */
function salle(evenements: Partial<NonNullable<OptionsSalle["evenements"]>>): Salle {
  const s = new Salle(monde, POINTS, () => 0, T0, {
    zoneApparition: ZONE,
    tigres: { cachettes: CACHETTES, intervalle: { minMs: 1000, maxMs: 1000 } },
    evenements: {
      truck: { x: -60, z: 0 }, centre: { x: 0, z: 0 }, rayonApparition: 60, forcerType: "tigre", pvTigre: 99_999,
      premier: { minMs: 0, maxMs: 0 }, intervalle: { minMs: 600_000, maxMs: 600_000 }, ...evenements,
    },
  });
  for (const id of ["a", "b"]) {
    s.connecter(id, id === "a" ? "Alice" : "Bob", T0);
    s.recevoir(id, { t: "rejoindre", principale: "fusil_assaut", secondaire: "pistolet" }, T0);
  }
  return s;
}

/** Tics à 60 Hz, joueurs actifs et immobiles. */
function tourner(s: Salle, depuis: number, ms: number): { sorties: Sortie[]; fin: number } {
  const sorties: Sortie[] = [];
  let m = depuis;
  for (let k = 1; k <= Math.round(ms / PAS_MS); k++) {
    m = depuis + Math.round(k * PAS_MS);
    for (const [id, p] of [["a", [-200, 0, -180]], ["b", [-190, 0, -200]]] as const) {
      const x = s.inspecter(id) as JoueurSalle;
      x.etatT = m;
      x.p = [p[0], p[1], p[2]];
      x.v = [0, 0, 0];
    }
    sorties.push(...s.tic(m));
  }
  return { sorties, fin: m };
}

describe("salle : tigres largués et tigre géant ne se croisent pas", () => {
  it("pendant l'événement du tigre géant, aucun avion ne passe. Le tigre géant vaincu, l'avion repasse", () => {
    const s = salle({});
    const r1 = tourner(s, T0, 30_000);
    expect(messages(r1.sorties, "evenement").map((e) => `${e.type}:${e.phase}`)).toEqual(["tigre:annonce", "tigre:debut"]);
    expect(messages(r1.sorties, "avion")).toEqual([]);
    expect(messages(r1.sorties, "snap").some((m) => m.tigres?.length)).toBe(false);

    // le tigre géant tombe : le titan démarre pour son tueur, l'avion n'est plus retenu
    const evenements = (s as unknown as { evenements: { blesserMonstre(c: string, d: number, p: JoueurSalle, z: "corps", t: number): Sortie[] } }).evenements;
    const fin = evenements.blesserMonstre(CIBLE_TIGRE, 1e9, s.inspecter("a") as JoueurSalle, "corps", r1.fin + 1);
    expect(messages(fin, "evenement")).toEqual([expect.objectContaining({ type: "tigre", phase: "fin", raison: "vaincu" })]);
    const r2 = tourner(s, r1.fin + 1, 1100);
    expect(messages(r2.sorties, "avion").map((m) => m.evenement)).toEqual(["passage"]);
  });

  it("pendant le survol de l'avion puis tant que le tigre sauvage largué vit, le tigre géant n'est pas annoncé", () => {
    const s = salle({ premier: { minMs: 3000, maxMs: 3000 } });
    const r = tourner(s, T0, 1000 + 20_000 + TIGRE.descenteMs + 30_000);
    const avion = messages(r.sorties, "avion");
    expect(avion.map((m) => m.evenement)).toEqual(["passage", "largage"]);
    expect(avion[1].tigre).toBeDefined();
    expect(messages(r.sorties, "evenement")).toEqual([]);
    const snaps = messages(r.sorties, "snap");
    expect(snaps[snaps.length - 1].tigres?.map((t) => t.genre)).toEqual(["sauvage"]);
    expect(snaps.some((m) => m.monstres?.tigre)).toBe(false);
    // tigre sauvage abattu : l'avion (échéance à 1 s) et le tigre géant (nouvelle tentative toutes les 5 s) se disputent la place
    const tigres = (s as unknown as { tigres: { blesser(id: string, d: number, p: JoueurSalle, z: "corps", t: number): Sortie[] } }).tigres;
    tigres.blesser(avion[1].tigre!, 1e6, s.inspecter("a") as JoueurSalle, "corps", r.fin + 1);
    const apres = tourner(s, r.fin + 1, 5_100 + EVENEMENTS.annonceMs);
    const ev = messages(apres.sorties, "evenement");
    const avionApres = messages(apres.sorties, "avion");
    // le premier des deux bloque l'autre : jamais les deux
    expect(ev.length === 0 || avionApres.length === 0).toBe(true);
    expect(ev.length + avionApres.length).toBeGreaterThan(0);
  });
});
