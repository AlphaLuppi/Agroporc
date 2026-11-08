import { describe, expect, it } from "vitest";
import { DEFAUT_CONFIG, ENTREES_NULLES, creerRng, tirer } from "../contrat";
import type { ConfigMatch, EntreesVoiture, Format } from "../contrat";
import { creerArene } from "../arene";
import { creerMonde, empreinteMonde, pasMonde } from "../match";
import { creerMondeEnLigne, graineBot } from "./monde-ligne";
import type { VoitureStatique } from "./protocole";

const arene = creerArene();
const cfg = (o: Partial<ConfigMatch> = {}): ConfigMatch => ({ ...DEFAUT_CONFIG(), graine: 42, ...o });

/** Voitures statiques dans l'ordre de `creerMonde` : bleue slots 0..n-1 puis orange ; `joueurs` : ids des voitures pilotées par un humain. */
function statiques(format: Format, humains: Record<number, string>): VoitureStatique[] {
  const n = format === "1v1" ? 1 : format === "2v2" ? 2 : 3;
  const sortie: VoitureStatique[] = [];
  for (const equipe of ["bleue", "orange"] as const) {
    for (let slot = 0; slot < n; slot++) {
      const id = sortie.length;
      const nom = humains[id];
      sortie.push({ id, equipe, slot, humain: nom !== undefined, nom: nom ?? `Bot${id}`, joueur: nom !== undefined ? 100 + id : null });
    }
  }
  return sortie;
}

describe("creerMondeEnLigne", () => {
  it.each(["1v1", "2v2", "3v3"] as Format[])("%s : deux humains, noms et indicateurs imposés, idHumain = moi", (format) => {
    const n = format === "1v1" ? 1 : format === "2v2" ? 2 : 3;
    const s = statiques(format, { 0: "Alice", [n]: "Bob" });
    const m = creerMondeEnLigne(cfg({ format }), s, n, arene);
    expect(m.voitures).toHaveLength(2 * n);
    expect(m.idHumain).toBe(n);
    expect(m.voitures.filter((v) => v.humain).map((v) => v.nom)).toEqual(["Alice", "Bob"]);
    expect(m.voitures[0].equipe).toBe("bleue");
    expect(m.voitures[n].equipe).toBe("orange");
    m.voitures.forEach((v, i) => { expect(v.id).toBe(i); expect(v.nom).toBe(s[i].nom); });
  });

  it("côté serveur, moi = −1 : aucune voiture « à moi »", () => {
    const m = creerMondeEnLigne(cfg({ format: "1v1" }), statiques("1v1", { 0: "A", 1: "B" }), -1, arene);
    expect(m.idHumain).toBe(-1);
  });

  it("physique identique à `creerMonde` : mêmes entrées, même empreinte pas à pas", () => {
    const config = cfg({ format: "3v3" });
    const a = creerMonde(config, arene);
    const b = creerMondeEnLigne(config, statiques("3v3", { 0: "A", 3: "B" }), 0, arene);
    expect(empreinteMonde(b)).toBe(empreinteMonde(a));
    const rng = creerRng(3);
    const entrees = (): EntreesVoiture[] => a.voitures.map(() => ({
      ...ENTREES_NULLES(), accel: 1, direction: tirer(rng) < 0.5 ? -1 : 1, boost: tirer(rng) < 0.5, saut: tirer(rng) < 0.1,
    }));
    for (let i = 0; i < 1500; i++) {
      const e = entrees();
      pasMonde(a, e);
      pasMonde(b, e);
    }
    expect(empreinteMonde(b)).toBe(empreinteMonde(a));
  });

  it("ne partage rien avec la config reçue", () => {
    const config = cfg();
    const m = creerMondeEnLigne(config, statiques("2v2", {}), 0, arene);
    m.config.nomsEquipes.bleue = "X";
    expect(config.nomsEquipes.bleue).not.toBe("X");
  });

  it("refuse un nombre de voitures incohérent ou un id répété", () => {
    expect(() => creerMondeEnLigne(cfg({ format: "2v2" }), statiques("1v1", {}), 0, arene)).toThrow();
    const s = statiques("1v1", {});
    s[1] = { ...s[1], id: 0 };
    expect(() => creerMondeEnLigne(cfg({ format: "1v1" }), s, 0, arene)).toThrow();
  });

  it("deux créations identiques donnent le même monde (déterminisme serveur / client)", () => {
    const s = statiques("2v2", { 1: "Zed" });
    const a = creerMondeEnLigne(cfg({ format: "2v2" }), s, 1, arene);
    const b = creerMondeEnLigne(cfg({ format: "2v2" }), s, -1, arene);
    expect(empreinteMonde(a)).toBe(empreinteMonde(b));
  });
});

describe("graineBot", () => {
  it("même formule que le mode local, entier non signé de 32 bits", () => {
    const g = 123456;
    expect(graineBot(g, 2)).toBe((Math.imul(g, 2654435761) + 2 * 40503 + 1) >>> 0);
    for (const id of [0, 1, 5]) {
      const x = graineBot(4_000_000_000, id);
      expect(Number.isInteger(x) && x >= 0 && x < 2 ** 32).toBe(true);
    }
  });
  it("distincte d'une voiture à l'autre", () => {
    const s = new Set([0, 1, 2, 3, 4, 5].map((i) => graineBot(77, i)));
    expect(s.size).toBe(6);
  });
});
