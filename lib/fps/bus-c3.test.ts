import { describe, expect, it } from "vitest";
import {
  BUS_C3, TRAJET_BUS_C3, avancerBusC3, busEnSnap, creerEtatBusC3, ecraseParBus,
  estSurLeToit, evaluerTrajet, peutMonterSurBus, ramasserArmeC3
} from "./bus-c3";

describe("bus-c3", () => {
  it("initialise un état de bus C3 en phase attente avec cumuls de trajet valides", () => {
    const bus = creerEtatBusC3(1000, () => 0.5);
    expect(bus.phase).toBe("attente");
    expect(bus.prochaineT).toBeGreaterThan(1000);
    expect(bus.longueurTrajet).toBeGreaterThan(500);
    expect(bus.cumuls.length).toBe(TRAJET_BUS_C3.length);
  });

  it("progresse d'attente à annonce puis course", () => {
    const bus = creerEtatBusC3(0, () => 0); // prochaineT = 45000
    expect(bus.phase).toBe("attente");

    // Avant l'heure : rien
    const ev1 = avancerBusC3(bus, 10_000);
    expect(ev1).toEqual([]);
    expect(bus.phase).toBe("attente");

    // Heure de l'annonce
    const ev2 = avancerBusC3(bus, 45_000);
    expect(ev2).toEqual([{ type: "annonce" }]);
    expect(bus.phase).toBe("annonce");
    expect(bus.debutCourseT).toBe(45_000 + BUS_C3.dureeAnnonceMs);

    // Début de la course
    const ev3 = avancerBusC3(bus, 49_000);
    expect(ev3[0].type).toBe("debutCourse");
    expect(bus.phase).toBe("course");
    expect(bus.v).toBe(BUS_C3.vitesse);
  });

  it("intervalle surchargé (tests de bout en bout) : premier passage et suivants dans les bornes données", () => {
    const bus = creerEtatBusC3(0, () => 1, { minMs: 600_000, maxMs: 700_000 });
    expect(bus.prochaineT).toBe(700_000);
    expect(avancerBusC3(bus, 650_000)).toEqual([]);
    expect(avancerBusC3(bus, 700_000)).toEqual([{ type: "annonce" }]);
    avancerBusC3(bus, 700_000 + BUS_C3.dureeAnnonceMs);
    expect(bus.phase).toBe("course");
    avancerBusC3(bus, bus.finCourseT, () => 0);
    expect(bus.phase).toBe("attente");
    expect(bus.prochaineT - bus.finCourseT).toBe(600_000);
  });

  it("largue les 3 armes uniques aux fractions du trajet", () => {
    const bus = creerEtatBusC3(0, () => 0);
    avancerBusC3(bus, 45_000); // annonce
    avancerBusC3(bus, 49_000); // début course

    // Avancement au milieu du trajet
    const dureeTotale = (bus.longueurTrajet / BUS_C3.vitesse) * 1000;
    const evMilieu = avancerBusC3(bus, 49_000 + dureeTotale * 0.55);
    const lachements = evMilieu.filter((e) => e.type === "lachement");
    expect(lachements.length).toBeGreaterThanOrEqual(2);
    expect(bus.armesLachees.length).toBeGreaterThanOrEqual(2);
  });

  it("détecte l'écrasement frontal au sol", () => {
    const pBus: [number, number, number] = [0, 0, 0];
    const cap = 0; // Regarde vers -z
    // Joueur au sol devant le pare-choc (z négatif)
    const pDevant: [number, number, number] = [0, 0, -6.5];
    expect(ecraseParBus(pDevant, pBus, cap)).toBe(true);

    // Joueur derrière le bus : pas écrasé
    const pDerriere: [number, number, number] = [0, 0, 5.0];
    expect(ecraseParBus(pDerriere, pBus, cap)).toBe(false);

    // Joueur en hauteur (sur le toit) : pas écrasé
    const pSurToit: [number, number, number] = [0, 3.2, -6.5];
    expect(ecraseParBus(pSurToit, pBus, cap)).toBe(false);
  });

  it("détecte un joueur debout sur le toit", () => {
    const pBus: [number, number, number] = [10, 0, 10];
    const cap = 0;
    // Sur le toit
    const pToit: [number, number, number] = [10.5, 3.2, 11];
    expect(estSurLeToit(pToit, pBus, cap)).toBe(true);

    // Trop bas (au sol à côté)
    const pSol: [number, number, number] = [10.5, 0, 11];
    expect(estSurLeToit(pSol, pBus, cap)).toBe(false);

    // Trop loin latéralement
    const pLoin: [number, number, number] = [20, 3.2, 11];
    expect(estSurLeToit(pLoin, pBus, cap)).toBe(false);
  });

  it("permet de monter sur le bus si on est proche", () => {
    const pBus: [number, number, number] = [0, 0, 0];
    expect(peutMonterSurBus([2, 0, 0], pBus)).toBe(true);
    expect(peutMonterSurBus([10, 0, 0], pBus)).toBe(false);
  });

  it("permet de ramasser une arme larguée à proximité", () => {
    const bus = creerEtatBusC3(0);
    bus.armesLachees.push({
      id: "test_arme_1",
      arme: "bazooka",
      p: [50, 0.4, 50],
      expireT: 999_999,
    });

    // Trop loin
    expect(ramasserArmeC3(bus, [100, 0, 100])).toBeNull();
    expect(bus.armesLachees.length).toBe(1);

    // À portée
    const ramasse = ramasserArmeC3(bus, [51, 0, 50.5]);
    expect(ramasse).not.toBeNull();
    expect(ramasse?.arme).toBe("bazooka");
    expect(bus.armesLachees.length).toBe(0);
  });

  it("génère des snaps réseau propres", () => {
    const bus = creerEtatBusC3(0);
    bus.phase = "course";
    bus.p = [12.3456, 0, 78.9101];
    bus.v = 24.0;
    bus.cap = 1.23456;
    const snap = busEnSnap(bus);
    expect(snap.p).toEqual([12.35, 0, 78.91]);
    expect(snap.cap).toBe(1.235);
    expect(snap.v).toBe(24);
    expect(snap.actif).toBe(true);
  });
});
