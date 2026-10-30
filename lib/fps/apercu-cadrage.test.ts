import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { REST } from "../agroparc3d/scene";
import { bornesBr } from "./br-carte";
import {
  CADRAGES, MI_TRANSITION, brouillardInterpole, dureeTransition, focusDuMode, impulsionBloom, interpolerCadrage, leveDeTransition, poseCadrage,
} from "./apercu-cadrage";
import { BORNES_ZOMBIES } from "./zombies-carte";
import { MODES_SALLE } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const MODES = MODES_SALLE;

describe("cadrages par mode", () => {
  it("le cadrage d'arène est la position de repos historique (REST)", () => {
    expect(CADRAGES.arene).toMatchObject({ dx: REST.dx, y: REST.y, dz: REST.dz, focus: null });
    const p = poseCadrage("arene", scene);
    expect(p.pos).toEqual([scene.focus[0] + REST.dx, REST.y, scene.focus[1] + REST.dz]);
    expect(p.cible).toEqual([scene.focus[0], 0, scene.focus[1]]);
  });

  it("zombies : cible dans les bornes de la carte, BR : centre de ses bornes", () => {
    const z = poseCadrage("zombies", scene).cible;
    expect(z[0]).toBeGreaterThanOrEqual(BORNES_ZOMBIES.x0);
    expect(z[0]).toBeLessThanOrEqual(BORNES_ZOMBIES.x1);
    expect(z[2]).toBeGreaterThanOrEqual(BORNES_ZOMBIES.z0);
    expect(z[2]).toBeLessThanOrEqual(BORNES_ZOMBIES.z1);
    const b = bornesBr(scene);
    const c = focusDuMode("br", scene);
    expect(c[0]).toBeCloseTo((b.x0 + b.x1) / 2 + CADRAGES.br.decalageX);
    expect(c[0]).toBeGreaterThan(b.x0);
    expect(c[1]).toBeGreaterThan(b.z0);
    expect(c[1]).toBeLessThan(b.z1);
  });

  it.each(MODES)("%s : distance dans les limites des contrôles (40..1800 m) et plongée de 25 à 70°", (mode) => {
    const p = poseCadrage(mode, scene);
    const d = Math.hypot(p.pos[0] - p.cible[0], p.pos[1] - p.cible[1], p.pos[2] - p.cible[2]);
    expect(d).toBeGreaterThanOrEqual(40);
    expect(d).toBeLessThanOrEqual(1800);
    const plongee = (Math.atan2(p.pos[1] - p.cible[1], Math.hypot(p.pos[0] - p.cible[0], p.pos[2] - p.cible[2])) * 180) / Math.PI;
    expect(plongee).toBeGreaterThanOrEqual(25);
    expect(plongee).toBeLessThanOrEqual(70);
  });

  it("l'arène n'est pas décalée (cadrage historique) ; les autres modes se centrent sur ce que le panneau laisse voir", () => {
    expect(CADRAGES.arene.decalageX).toBe(0);
    expect(CADRAGES.zombies.decalageX).toBeGreaterThan(0);
    expect(CADRAGES.br.decalageX).toBeGreaterThan(0);
    expect(focusDuMode("arene", scene)).toEqual(scene.focus);
  });

  it("les trois cadrages sont distincts et le brouillard varie (zombies plus dense, BR plus léger)", () => {
    expect(CADRAGES.zombies.brouillard).toBeGreaterThan(CADRAGES.arene.brouillard);
    expect(CADRAGES.br.brouillard).toBeLessThan(CADRAGES.arene.brouillard);
    const hauts = MODES.map((m) => poseCadrage(m, scene).pos[1]);
    expect(new Set(hauts).size).toBe(3);
  });
});

describe("interpolerCadrage", () => {
  const de = poseCadrage("arene", scene), vers = poseCadrage("br", scene);
  const leve = leveDeTransition(de, vers);

  it("vaut `de` à k = 0 et `vers` à k = 1", () => {
    const a = interpolerCadrage(de, vers, 0, leve), b = interpolerCadrage(de, vers, 1, leve);
    a.pos.forEach((v, i) => expect(v).toBeCloseTo(de.pos[i], 9));
    b.pos.forEach((v, i) => expect(v).toBeCloseTo(vers.pos[i], 9));
    b.cible.forEach((v, i) => expect(v).toBeCloseTo(vers.cible[i], 9));
  });

  it("monte à mi-chemin (au-dessus de la moyenne des deux altitudes) et reste continue", () => {
    const mi = interpolerCadrage(de, vers, MI_TRANSITION, leve);
    expect(mi.pos[1]).toBeGreaterThan((de.pos[1] + vers.pos[1]) / 2 + leve * 0.9);
    let prec = interpolerCadrage(de, vers, 0, leve);
    for (let i = 1; i <= 200; i++) {
      const p = interpolerCadrage(de, vers, i / 200, leve);
      expect(Math.hypot(p.pos[0] - prec.pos[0], p.pos[1] - prec.pos[1], p.pos[2] - prec.pos[2])).toBeLessThan(40);
      prec = p;
    }
  });

  it("symétrique en durée : arène → zombies → BR et le retour", () => {
    const a = poseCadrage("arene", scene), z = poseCadrage("zombies", scene), b = poseCadrage("br", scene);
    expect(dureeTransition(a, z, false)).toBeCloseTo(dureeTransition(z, a, false), 9);
    expect(dureeTransition(z, b, false)).toBeCloseTo(dureeTransition(b, z, false), 9);
    expect(dureeTransition(a, b, false)).toBeCloseTo(dureeTransition(b, a, false), 9);
  });

  it("durée : 0 en mouvement réduit, entre 1,6 et 2,6 s sinon", () => {
    const a = poseCadrage("arene", scene), z = poseCadrage("zombies", scene), b = poseCadrage("br", scene);
    for (const [x, y] of [[a, z], [z, b], [a, b]] as const) {
      expect(dureeTransition(x, y, true)).toBe(0);
      const d = dureeTransition(x, y, false);
      expect(d).toBeGreaterThanOrEqual(1.6);
      expect(d).toBeLessThanOrEqual(2.6);
    }
  });

  it("brouillard et impulsion de bloom", () => {
    expect(brouillardInterpole(0.001, 0.002, 0)).toBeCloseTo(0.001);
    expect(brouillardInterpole(0.001, 0.002, 1)).toBeCloseTo(0.002);
    expect(impulsionBloom(0.5, 2)).toBe(1);
    expect(impulsionBloom(0.1, 2)).toBe(0);
    expect(impulsionBloom(0.5, 0)).toBe(0);
  });
});
