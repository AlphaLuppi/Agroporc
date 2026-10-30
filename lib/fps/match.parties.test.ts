import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lireCachettes, type FichierCachettes } from "../agroparc3d/cachettes";
import type { SceneData } from "../agroparc3d/types";
import { construireCircuits, flotte } from "./circulation";
import { batimentsDetruits, construireMonde, detruireBatiment, pointsApparition } from "./collision";
import { Salle, type OptionsSalle } from "./match";
import { grilleNav, capDeCachette } from "./tigre-arene";
import { DEPARTS, PORTES_PAYANTES, construireMondeZombies, idPrisme } from "./zombies-carte";
import { EMPLACEMENTS_VOITURES, ROND_POINT, ZONE_APPARITION } from "./zones";

/**
 * Parties parallèles (lot 1) : deux `Salle` ne partagent AUCUN état muté. Chaque partie construit son propre `Monde` (mutable : brèches, portes
 * achetées ; la navigation est mise en cache PAR monde) ; les options de l'arène (circuits, flotte, cachettes) sont lues seulement.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const T0 = 9_000_000;

describe("deux salles de zombies : mondes distincts", () => {
  const departs = DEPARTS.map((d) => [d[0], d[1]] as [number, number]);
  const options: OptionsSalle = { zombies: {} };
  const a = new Salle(construireMondeZombies(scene), departs, () => 0.5, T0, options);
  const b = new Salle(construireMondeZombies(scene), departs, () => 0.5, T0, options);
  const porte = idPrisme(PORTES_PAYANTES[0].id);

  it("les salles sont des zombies, chacune avec son monde et ses prismes", () => {
    expect(a.mode()).toBe("zombies");
    expect(a.monde).not.toBe(b.monde);
    expect(a.monde.prismes[porte]).not.toBe(b.monde.prismes[porte]);
    expect(a.monde.prismes[porte].h).toBe(b.monde.prismes[porte].h);
  });

  it("détruire un bâtiment dans l'une ne le détruit pas dans l'autre ; la navigation est indépendante", () => {
    const hAvant = b.monde.prismes[porte].h;
    const libresAvant = (m: Salle) => grilleNav(m.monde).libre.reduce((n, x) => n + (x ? 1 : 0), 0);
    const nA = libresAvant(a), nB = libresAvant(b);
    expect(grilleNav(a.monde)).not.toBe(grilleNav(b.monde));
    expect(nA).toBe(nB);
    expect(detruireBatiment(a.monde, porte)).toBe(true);
    expect(batimentsDetruits(a.monde)).toContain(porte);
    expect(batimentsDetruits(b.monde)).not.toContain(porte);
    expect(b.monde.prismes[porte].h).toBe(hAvant);
    // la grille de A se met à jour (cases libérées), celle de B reste telle quelle
    expect(libresAvant(a)).toBeGreaterThan(nA);
    expect(libresAvant(b)).toBe(nB);
  });

  it("les joueurs de l'une ne sont pas dans l'autre", () => {
    a.connecter("j1", "Alice", T0);
    expect(a.nombreJoueurs()).toBe(1);
    expect(b.nombreJoueurs()).toBe(0);
    expect(b.inspecter("j1")).toBeUndefined();
  });
});

describe("deux arènes partagent des options en lecture seule", () => {
  const circuits = construireCircuits();
  const fichier = JSON.parse(readFileSync("public/agroparc/cachettes.json", "utf8")) as FichierCachettes;
  const cachettes = lireCachettes(fichier).map((c) => ({ x: c.x, z: c.z, cap: capDeCachette(c.cap) }));
  const options: OptionsSalle = {
    zoneApparition: { centre: ROND_POINT.centre, ...ZONE_APPARITION },
    elsa: { x: ROND_POINT.centre[0] + 30, z: ROND_POINT.centre[1] },
    circulation: { circuits, voitures: flotte(circuits) },
    vehicules: EMPLACEMENTS_VOITURES,
    tigres: { cachettes, intervalle: { minMs: 4000, maxMs: 5000 } },
    bus: { intervalle: { minMs: 3000, maxMs: 4000 } },
  };
  const mondeRef = construireMonde(scene);
  const apparitions = pointsApparition(scene, mondeRef);

  it("faire tourner une arène (avion, bus, Elsa, voitures) ne modifie ni les options ni l'autre arène", () => {
    const instantane = JSON.stringify({ options, apparitions });
    const a = new Salle(construireMonde(scene), apparitions, () => 0.37, T0, options);
    const b = new Salle(construireMonde(scene), apparitions, () => 0.71, T0, options);
    expect(a.mode()).toBe("arene");
    a.connecter("j1", "Alice", T0);
    a.recevoir("j1", { t: "rejoindre" }, T0);
    const avantB = JSON.stringify({ n: b.nombreJoueurs(), info: b.infoMatch() });
    for (let t = T0; t < T0 + 30_000; t += 50) { a.inspecter("j1") && ((a.inspecter("j1") as { etatT: number }).etatT = t); a.tic(t); }
    expect(JSON.stringify({ options, apparitions })).toBe(instantane);
    expect(a.monde).not.toBe(b.monde);
    expect(JSON.stringify({ n: b.nombreJoueurs(), info: b.infoMatch() })).toBe(avantB);
    expect(b.nombreJoueurs()).toBe(0);
    expect(b.nombreEnJeu()).toBe(0);
  });
});
