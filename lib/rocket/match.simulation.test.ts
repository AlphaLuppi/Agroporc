import { describe, expect, it } from "vitest";
import { DEFAUT_CONFIG, MATCH, PAS_S } from "./contrat";
import type { ConfigMatch, Format, NiveauBot } from "./contrat";
import { creerArene } from "./arene";
import { creerMonde, empreinteMonde, resultatMatch } from "./match";
import { simuler } from "./outils-simulation";

const cfg = (o: Partial<ConfigMatch> = {}): ConfigMatch => ({ ...DEFAUT_CONFIG(), ...o });

/**
 * Parties complètes bot contre bot (sans rendu). Les parties courtes tournent toujours ; la campagne complète du § 7 de la spec
 * (20 graines de 3v3 Pro de 5 min, All-Star contre Débutant) est longue : `ROCKET_LONG=1 npx vitest run lib/rocket/match.simulation`.
 */
describe("simulation bot contre bot (60 s)", () => {
  it("3v3 Pro : aucune valeur non finie, personne hors du stade, déterministe (même graine → même empreinte)", () => {
    const joue = () => simuler(cfg({ format: "3v3", graine: 21, dureeS: 180 }), { bleue: "pro", orange: "pro" }, { dureeS: 60 });
    const a = joue(), b = joue();
    expect(a.nan).toBe(false);
    expect(a.horsStade).toBeLessThan(0.3);
    expect(empreinteMonde(a.monde)).toBe(empreinteMonde(b.monde));
    expect(a.evenements.length).toBe(b.evenements.length);
    expect(a.monde.tick).toBe(Math.ceil(60 / PAS_S));
  });

  it("une autre graine donne une autre partie", () => {
    const a = simuler(cfg({ format: "2v2", graine: 1 }), { bleue: "pro", orange: "pro" }, { dureeS: 30 });
    const b = simuler(cfg({ format: "2v2", graine: 2 }), { bleue: "pro", orange: "pro" }, { dureeS: 30 });
    expect(empreinteMonde(a.monde)).not.toBe(empreinteMonde(b.monde));
  });

  it("les événements courants apparaissent sur un ensemble de parties", () => {
    const vus = new Set<string>();
    for (const [format, niveau, graine] of [["3v3", "allstar", 2], ["2v2", "pro", 5], ["1v1", "debutant", 8]] as [Format, NiveauBot, number][]) {
      const r = simuler(cfg({ format, graine, dureeS: 90 }), { bleue: niveau, orange: niveau }, { dureeS: 90 });
      for (const k of Object.keys(r.compte)) vus.add(k);
      expect(r.nan).toBe(false);
    }
    for (const t of ["decompte", "coupDEnvoi", "toucheBalle", "plot", "saut"]) expect(vus.has(t), t).toBe(true);
  });

  it("égalité forcée : la partie bascule en prolongation puis se termine par un but ou reste en mort subite", () => {
    const m = creerMonde(cfg({ format: "1v1", graine: 4, dureeS: 6 }), creerArene());
    const r = simuler(m.config, { bleue: "pro", orange: "pro" }, { dureeS: 120, jusquALaFin: true }, m);
    // 6 s de jeu : le plus souvent 0-0, donc prolongation ; si un but tombe en temps réglementaire, la partie finit sans
    expect(r.compte["chronoZero"]).toBe(1);
    if (r.monde.score.bleue === r.monde.score.orange) {
      expect(r.compte["prolongation"]).toBe(1);
      expect(r.monde.prolongation).toBe(true);
    }
    const res = resultatMatch(r.monde);
    expect(res.classement).toHaveLength(2);
  });
});

const LONG = process.env.ROCKET_LONG === "1";
describe.runIf(LONG)("campagne complète (ROCKET_LONG=1)", () => {
  it("3v3 Pro contre Pro, 5 min, 20 graines : sans NaN, jamais hors du stade, but dans 70 % des parties, personne d'immobile > 6 s", () => {
    let avecBut = 0;
    for (let g = 1; g <= 20; g++) {
      const r = simuler(cfg({ format: "3v3", graine: g, dureeS: MATCH.dureeDefautS }), { bleue: "pro", orange: "pro" }, { dureeS: 330, jusquALaFin: true });
      expect(r.nan, `graine ${g}`).toBe(false);
      expect(r.horsStade, `graine ${g}`).toBeLessThan(0.3);
      expect(Math.max(...r.immobiliteMax), `graine ${g}`).toBeLessThan(6);
      if (r.monde.score.bleue + r.monde.score.orange > 0) avecBut++;
    }
    expect(avecBut).toBeGreaterThanOrEqual(14);
  }, 3_000_000);

  it("All-Star bat Débutant dans au moins 80 % des parties 1v1 de 3 min (20 graines)", () => {
    let victoires = 0;
    for (let g = 1; g <= 20; g++) {
      const r = simuler(cfg({ format: "1v1", graine: g, dureeS: 180 }), { bleue: "allstar", orange: "debutant" }, { dureeS: 240, jusquALaFin: true });
      if (r.monde.score.bleue > r.monde.score.orange) victoires++;
    }
    expect(victoires).toBeGreaterThanOrEqual(16);
  }, 3_000_000);
});
