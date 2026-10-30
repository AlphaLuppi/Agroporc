/**
 * Le décor (chaussée, marquages, végétation, mobilier, façades v2) est du rendu seulement : la présence de `data.decor` ne change AUCUN monde de
 * collision, ni celui de l'arène, ni celui des zombies, ni celui du Battle Royale (spec 2026-10-29-da-palantir-design.md, D5).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { construireMonde } from "../fps/collision";
import { construireMondeBr } from "../fps/br-carte";
import { construireMondeZombies } from "../fps/zombies-carte";
import { mobilier } from "./mobilier";
import type { DecorOsm, SceneData } from "./types";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const decor = JSON.parse(readFileSync("public/agroparc/decor.json", "utf8")) as DecorOsm;
const avec: SceneData = { ...scene, decor };

const empreinte = (m: { prismes: unknown; bornes: unknown }) => JSON.stringify({ p: m.prismes, b: m.bornes });

describe("décor sans collision", () => {
  it("arène : construireMonde rend les mêmes prismes avec et sans decor", () => {
    expect(empreinte(construireMonde(avec))).toBe(empreinte(construireMonde(scene)));
  });
  it("zombies : construireMondeZombies rend les mêmes prismes avec et sans decor", () => {
    expect(empreinte(construireMondeZombies(avec))).toBe(empreinte(construireMondeZombies(scene)));
  });
  it("Battle Royale : construireMondeBr rend les mêmes prismes avec et sans decor", () => {
    expect(empreinte(construireMondeBr(avec))).toBe(empreinte(construireMondeBr(scene)));
  });
  it("le mobilier ne crée aucun prisme : le monde de l'arène a autant de prismes que de bâtiments et d'obstacles d'avant", () => {
    const m = mobilier(avec);
    expect(m.lampadaires.length).toBeGreaterThan(100);
    // un prisme par bâtiment ordinaire + le Truck Muche garé : aucun pour les lampadaires, panneaux, bancs, haies, arbres
    const monde = construireMonde(avec);
    expect(monde.prismes.length).toBeLessThanOrEqual(scene.buildings.length + 5);
  });
  it("les copies de scène des zombies et du BR gardent le decor tel quel, sans le modifier", () => {
    const avant = JSON.stringify(decor).length;
    for (const copie of [construireMondeZombies(avec), construireMondeBr(avec)]) expect(copie.prismes.length).toBeGreaterThan(100);
    expect(JSON.stringify(decor).length).toBe(avant);
    expect(avec.decor).toBe(decor);
  });
});
