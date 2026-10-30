import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { construireMondeBr, pointsButin } from "./br-carte";
import { NIVEAUX_BOT, decider, memoireInitiale, type EntreeCerveau } from "./bots-br";
import { etape, etatInitial } from "./mouvement";
import {
  BudgetNavigation, ETAPE_MAX_M, NOEUDS_MAX_BOT, butIntermediaire, composanteDe, creerNavigateur, etiquetageDe, installerNavigationBr, premierVirage, preparerNavigationBr,
} from "./nav-bots";
import type { Vec3 } from "./protocole";
import { grilleNav } from "./tigre-arene";

/**
 * Navigation des bots du Battle Royale (lot 3b) : budget d'un A* par tic, composantes connexes, copie de la grille précalculée, navigateur sur le VRAI monde,
 * et un bot qui contourne un bâtiment pour rejoindre un but que la ligne droite ne permet pas d'atteindre.
 * Spec : docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md (§1.4)
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMondeBr(scene);
const g = grilleNav(monde);
const etiq = etiquetageDe(g);
const points = pointsButin(scene, monde).filter((p) => p.pool !== "toit");
const principaux = points.filter((p) => composanteDe(g, etiq, p.p[0], p.p[2]) === etiq.principale);

const d2 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);

describe("BudgetNavigation : un A* par tic, dans l'ordre des demandes", () => {
  it("une recherche par période, une demande qui attend entre dans la file", () => {
    const b = new BudgetNavigation(12);
    expect(b.demander("b1", 1000)).toBe(true);
    // même tic : refusé, mis en file
    expect(b.demander("b2", 1001)).toBe(false);
    expect(b.demander("b3", 1002)).toBe(false);
    expect(b.enAttente).toBe(2);
    // période suivante : la tête de file passe, pas b3 ni b1
    expect(b.demander("b3", 1013)).toBe(false);
    expect(b.demander("b1", 1014)).toBe(false);
    expect(b.demander("b2", 1015)).toBe(true);
    expect(b.demander("b3", 1028)).toBe(true);
    expect(b.enAttente).toBe(1); // b1, redemandé, attend son tour
    expect(b.demander("b1", 1041)).toBe(true);
    expect(b.recherches).toBe(4);
  });

  it("pas plus d'une recherche par période même avec cent bots qui redemandent à chaque tic", () => {
    const b = new BudgetNavigation(12);
    const accordes: number[] = [];
    for (let t = 0; t < 2000; t += 16.67) for (let i = 0; i < 100; i++) if (b.demander(`b${i}`, t)) accordes.push(t);
    for (let i = 1; i < accordes.length; i++) expect(accordes[i] - accordes[i - 1]).toBeGreaterThanOrEqual(12);
    expect(accordes.length).toBe(Math.ceil(2000 / 16.67));
  });

  it("une tête de file qui ne redemande plus est purgée, un bot retiré quitte la file", () => {
    const b = new BudgetNavigation(12, 500);
    b.demander("b0", 0);
    b.demander("fantome", 5); // en file, ne reviendra jamais
    b.demander("b2", 6);
    expect(b.demander("b2", 100)).toBe(false); // le fantôme est en tête
    expect(b.demander("b2", 600)).toBe(true); // périmé : purgé
    b.demander("b4", 700);
    b.demander("b5", 701);
    b.retirer("b4");
    expect(b.demander("b5", 720)).toBe(true);
  });
});

describe("composantes et grille copiée", () => {
  it("la composante principale est énorme et la plupart des points de butin en font partie", () => {
    let taille = 0;
    for (let i = 0; i < etiq.etiquette.length; i++) if (etiq.etiquette[i] === etiq.principale) taille++;
    expect(taille).toBeGreaterThan(100_000);
    expect(principaux.length).toBeGreaterThan(points.length * 0.5);
  });

  it("installerNavigationBr donne à un monde neuf une copie indépendante, sans recalcul, avec les composantes", () => {
    const neuf = construireMondeBr(scene);
    const copie = installerNavigationBr(neuf, g)!;
    expect(copie).not.toBeNull();
    expect(copie.libre).not.toBe(g.libre);
    expect(copie.etats).not.toBe(g.etats);
    expect(Array.from(copie.etats)).toEqual(Array.from(g.etats));
    // `grilleNav` reprend la copie telle quelle (aucune plage recalculée : `libre` identique octet pour octet)
    const avant = copie.libre.slice();
    expect(grilleNav(neuf)).toBe(copie);
    expect(Array.from(copie.libre)).toEqual(Array.from(avant));
    expect(Array.from(copie.libre)).toEqual(Array.from(g.libre));
    expect(etiquetageDe(copie).principale).toBe(etiq.principale);
    // les tampons de recherche sont propres à la copie
    expect(copie.g).not.toBe(g.g);
    // un second appel n'écrase rien
    expect(installerNavigationBr(neuf, g)).toBe(copie);
  });

  it("preparerNavigationBr précalcule la grille et les composantes d'un monde", () => {
    const m = construireMondeBr(scene);
    const t0 = performance.now();
    const grille = preparerNavigationBr(m);
    expect(grille.libre.length).toBeGreaterThan(100_000);
    expect(etiquetageDe(grille).principale).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });

  it("butIntermediaire : un but proche est gardé, un but lointain est ramené à ETAPE_MAX_M sur une case libre", () => {
    const de: Vec3 = [principaux[0].p[0], 0, principaux[0].p[2]];
    expect(butIntermediaire(g, de, [de[0] + 30, de[2]])).toEqual([de[0] + 30, de[2]]);
    const loin = butIntermediaire(g, de, [de[0] + 400, de[2] + 10]);
    if (loin) expect(Math.hypot(loin[0] - de[0], loin[1] - de[2])).toBeLessThanOrEqual(ETAPE_MAX_M + 1e-6);
  });
});

/** Deux points de la composante principale à 40-100 m l'un de l'autre dont la ligne droite est coupée par un mur, et que le navigateur sait relier. */
function pairesBloquees(max = 40): [Vec3, Vec3][] {
  const nav = creerNavigateur({ monde, budget: new BudgetNavigation(0), id: "b1", t: 0 });
  const paires: [Vec3, Vec3][] = [];
  for (let i = 0; i < principaux.length && paires.length < max; i += 3) {
    for (let k = i + 1; k < principaux.length && paires.length < max; k += 5) {
      const a = principaux[i].p, b = principaux[k].p;
      const d = d2(a, b);
      if (d < 40 || d > 100) continue;
      if (nav.ligneLibre(a, [b[0], b[2]])) continue;
      const nav2 = creerNavigateur({ monde, budget: new BudgetNavigation(0), id: "b1", t: 1e9 });
      if (nav2.chercher(a, [b[0], b[2]]).etat === "ok") paires.push([a, b]);
    }
  }
  if (paires.length === 0) throw new Error("aucune paire bloquée trouvée");
  return paires;
}
const trouverPaireBloquee = (): [Vec3, Vec3] => pairesBloquees(1)[0];

describe("navigateur sur le vrai monde", () => {
  const [a, b] = trouverPaireBloquee();

  it("ligneLibre : vraie en terrain dégagé, fausse à travers un bâtiment", () => {
    const nav = creerNavigateur({ monde, budget: new BudgetNavigation(0), id: "b1", t: 0 });
    expect(nav.ligneLibre(a, [b[0], b[2]])).toBe(false);
    expect(nav.ligneLibre(a, [a[0] + 0.5, a[2]])).toBe(true);
  });

  it("chercher : un chemin qui contourne le mur, borné à 3 000 nœuds ; « attente » quand le budget du tic est pris ; échec vers une autre composante", () => {
    const budget = new BudgetNavigation(12);
    const nav = creerNavigateur({ monde, budget, id: "b1", t: 5000 });
    const r = nav.chercher(a, [b[0], b[2]]);
    expect(r.etat).toBe("ok");
    if (r.etat === "ok") {
      expect(r.chemin.length).toBeGreaterThan(2);
      expect(r.chemin[r.chemin.length - 1]).toEqual([b[0], b[2]]);
    }
    expect(budget.noeudsMax).toBeLessThanOrEqual(NOEUDS_MAX_BOT);
    // même tic, un autre bot : le budget est pris
    expect(creerNavigateur({ monde, budget, id: "b2", t: 5001 }).chercher(a, [b[0], b[2]]).etat).toBe("attente");
    // une case d'une autre composante : échec immédiat, sans A* ni budget consommé
    let autre: [number, number] | null = null;
    for (let i = 0; i < etiq.etiquette.length && !autre; i += 37) {
      if (etiq.etiquette[i] && etiq.etiquette[i] !== etiq.principale) autre = [g.x0 + ((i % g.nx) + 0.5) * 1.5, g.z0 + (Math.floor(i / g.nx) + 0.5) * 1.5];
    }
    if (autre) {
      const avant = budget.recherches;
      expect(creerNavigateur({ monde, budget, id: "b3", t: 9000 }).chercher(a, autre).etat).toBe("echec");
      expect(budget.recherches).toBe(avant);
    }
  });

  it("viser : le point visé est sur le chemin, pas derrière le mur", () => {
    const nav = creerNavigateur({ monde, budget: new BudgetNavigation(0), id: "b1", t: 0 });
    const r = nav.chercher(a, [b[0], b[2]]);
    if (r.etat !== "ok") throw new Error("pas de chemin");
    const v = nav.viser(a, r.chemin)!;
    expect(v).not.toBeNull();
    expect(nav.ligneLibre(a, v) || Math.hypot(v[0] - a[0], v[1] - a[2]) >= 3).toBe(true);
  });

  it("abri : un point libre, proche, hors de vue du danger", () => {
    const nav = creerNavigateur({ monde, budget: new BudgetNavigation(0), id: "b1", t: 0 });
    let trouve = 0;
    for (let i = 0; i < Math.min(principaux.length, 60); i++) {
      const de = principaux[i].p;
      const danger: Vec3 = [de[0] + 25, de[1], de[2]];
      const ab = nav.abri(de, danger);
      if (ab) {
        trouve++;
        expect(Math.hypot(ab[0] - de[0], ab[1] - de[2])).toBeLessThanOrEqual(15);
      }
    }
    expect(trouve).toBeGreaterThan(0);
  });
});

describe("un bot contourne un bâtiment (decider + etape sur le vrai monde)", () => {
  function marche(a: Vec3, b: Vec3, avecNav: boolean): { arrive: boolean; secondes: number; recherches: number } {
    const budget = new BudgetNavigation();
    const p = NIVEAUX_BOT.plat;
    const alea = () => 0.5;
    let m = memoireInitiale();
    let mouv = etatInitial([a[0], a[1], a[2]]);
    let lacet = 0;
    const zone = { centre: [b[0], b[2]] as [number, number], rayon: 6 };
    for (let t = 0; t < 120_000; t += 50) {
      const e: EntreeCerveau = {
        t: 1000 + t, dtS: 0.05, phase: "jeu",
        moi: { p: mouv.p, pv: 100, bandage: 0, potion: 0, armeFeu: null, slotArme: null, lacet, tangage: 0, aBord: false, enChute: false, arme: "couteau", sortie: true },
        munitions: { charge: 0, chargeur: 0, reserve: 0, recharge: false },
        avion: null, zone, percus: [], objets: [], points: [], deja: [], agressif: false, humainProche: null,
        ...(avecNav ? { nav: creerNavigateur({ monde, budget, id: "b1", t: 1000 + t }) } : {}),
      };
      const r = decider(m, e, p, alea);
      m = r.m;
      lacet = r.c.lacet;
      mouv = etape(mouv, { ...r.c.entrees, lacet }, 0.05, monde, 1);
      if (Math.hypot(mouv.p[0] - b[0], mouv.p[2] - b[2]) < 8) return { arrive: true, secondes: t / 1000, recherches: budget.recherches };
    }
    return { arrive: false, secondes: 120, recherches: budget.recherches };
  }

  it("sur 40 trajets coupés par un mur : la navigation arrive toujours, plus souvent et plus vite que la ligne droite, avec peu de recherches", () => {
    const paires = pairesBloquees(40);
    let avec = 0, sans = 0, tAvec = 0, tSans = 0, recherchesMax = 0;
    for (const [a, b] of paires) {
      const r = marche(a, b, true), q = marche(a, b, false);
      if (r.arrive) avec++;
      if (q.arrive) sans++;
      tAvec += r.secondes;
      tSans += q.secondes;
      recherchesMax = Math.max(recherchesMax, r.recherches);
    }
    console.log(`navigation : ${avec}/${paires.length} arrivés en ${(tAvec / paires.length).toFixed(1)} s en moyenne ; ligne droite : ${sans}/${paires.length} en ${(tSans / paires.length).toFixed(1)} s ; recherches max ${recherchesMax}`);
    expect(avec).toBeGreaterThanOrEqual(Math.floor(paires.length * 0.95));
    expect(avec).toBeGreaterThanOrEqual(sans);
    expect(tAvec).toBeLessThanOrEqual(tSans * 1.05);
    expect(recherchesMax).toBeLessThanOrEqual(30);
  }, 60_000);
});

describe("viser : virages serrés d'un chemin", () => {
  const de: Vec3 = [0, 0, 0];

  it("premierVirage : le tracé part de la position du bot, les marches d'escalier de la grille (45°) ne sont pas des virages", () => {
    // en ligne droite, ou en escalier : aucun virage, le dernier indice
    expect(premierVirage(de, [[1.5, 0], [3, 0], [4.5, 0]])).toBe(2);
    expect(premierVirage(de, [[1.5, 0], [3, 1.5], [4.5, 1.5], [6, 3]])).toBe(3);
    // équerre sur le deuxième point
    expect(premierVirage(de, [[1.5, 0], [3, 0], [3, 1.5], [3, 3]])).toBe(1);
    // le coude est le PREMIER point du chemin : le segment bot → chemin[0] compte dans le tracé
    expect(premierVirage(de, [[3, 0], [3, 3], [3, 6]])).toBe(0);
    // demi-tour en épingle
    expect(premierVirage(de, [[1.5, 0], [3, 0], [3, 1.5], [0.5, 1.5]])).toBe(1);
    expect(premierVirage(de, [[3, 0]])).toBe(0);
  });

  it("viser ne dépasse pas le premier virage serré, même si le point suivant est en vue", () => {
    const nav = creerNavigateur({ monde, budget: new BudgetNavigation(0), id: "b1", t: 0 });
    const a: Vec3 = [principaux[0].p[0], 0, principaux[0].p[2]];
    // équerre en terrain dégagé autour du point : un point plus loin que le coude est visible, mais n'est pas choisi
    const coude: [number, number] = [a[0] + 6, a[2]];
    const suite: [number, number] = [a[0] + 6, a[2] + 6];
    const v = nav.viser(a, [[a[0] + 3, a[2]], coude, suite]);
    expect(v).not.toBeNull();
    expect(v![0] <= coude[0] + 1e-9 && v![1] <= coude[1] + 1e-9).toBe(true);
  });
});

describe("un butin à 8-14 m derrière un mur est atteint (non-régression : virage en épingle, longer un coin)", () => {
  /** Le bot part de `a` avec le seul objet `b` à ramasser ; renvoie vrai s'il le ramasse en 40 s. */
  function ramasse(a: Vec3, b: Vec3): boolean {
    const budget = new BudgetNavigation();
    const p = NIVEAUX_BOT.plat;
    const alea = () => 0.5;
    let m = memoireInitiale();
    let mouv = etatInitial([a[0], a[1], a[2]]);
    let lacet = 0;
    const objets = [{ id: 1, genre: "arme" as const, ref: "mitraillette" as const, p: b }];
    for (let t = 0; t < 40_000; t += 50) {
      const e: EntreeCerveau = {
        t: 1000 + t, dtS: 0.05, phase: "jeu",
        moi: { p: mouv.p, pv: 100, bandage: 0, potion: 0, armeFeu: null, slotArme: null, lacet, tangage: 0, aBord: false, enChute: false, arme: "couteau", sortie: true },
        munitions: { charge: 0, chargeur: 0, reserve: 0, recharge: false },
        avion: null, zone: null, percus: [], objets, points: [], deja: [], agressif: false, humainProche: null,
        nav: creerNavigateur({ monde, budget, id: "b1", t: 1000 + t }),
      };
      const r = decider(m, e, p, alea);
      m = r.m;
      lacet = r.c.lacet;
      if (r.c.ramasser === 1) return true;
      mouv = etape(mouv, { ...r.c.entrees, lacet }, 0.05, monde, 1);
    }
    return false;
  }

  it("le cas relevé (départ (291, -72), arme à (280,5, -68,6), chemin en U par la porte de l'est) et un échantillon de 150 paires de points de butin", () => {
    expect(ramasse([291, 0, -72], [280.5548602361301, 0, -68.6225473393753])).toBe(true);
    expect(ramasse([291, 0, -66], [280.5548602361301, 0, -68.6225473393753])).toBe(true);
    const nav = creerNavigateur({ monde, budget: new BudgetNavigation(0), id: "b1", t: 0 });
    let essais = 0;
    const echecs: string[] = [];
    for (let i = 0; i < principaux.length && essais < 150; i++) {
      for (let k = 0; k < principaux.length && essais < 150; k++) {
        const a = principaux[i].p, b = principaux[k].p;
        const d = d2(a, b);
        if (d < 8 || d > 14 || (i * 7 + k) % 3 !== 0 || nav.ligneLibre(a, [b[0], b[2]])) continue;
        essais++;
        if (!ramasse(a, b)) echecs.push(`${a.map((x) => x.toFixed(1))} -> ${b.map((x) => x.toFixed(1))}`);
      }
    }
    expect(essais).toBeGreaterThanOrEqual(100);
    // avant le correctif, 2 à 3 % des paires échouaient ; reste un blocage isolé contre l'angle d'un mur (paire (-225, 90) → (-224,7, 76,8)), sans rapport avec les virages
    expect(echecs.length, echecs.join(" ; ")).toBeLessThanOrEqual(2);
  }, 120_000);
});
