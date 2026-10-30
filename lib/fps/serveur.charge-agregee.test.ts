import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lireCachettes, type FichierCachettes } from "../agroparc3d/cachettes";
import type { SceneData } from "../agroparc3d/types";
import { construireMondeBr } from "./br-carte";
import { construireCircuits, flotte } from "./circulation";
import { construireMonde, pointsApparition } from "./collision";
import { Salle, type JoueurSalle, type OptionsSalle } from "./match";
import type { ServiceBr } from "./match-contexte";
import { decoderZombies, type MessageClient, type Vec3 } from "./protocole";
import { BudgetNavigation, NOEUDS_MAX_BOT, PERIODE_BUDGET_MS } from "./nav-bots";
import { capDeCachette } from "./tigre-arene";
import { DEPARTS, construireMondeZombies, donneesZombies } from "./zombies-carte";
import { ZOMBIES } from "./zombies-vagues";
import { EMPLACEMENTS_VOITURES, ROND_POINT, ZONE_APPARITION, positionElsa, trouverRondPoint } from "./zones";

/**
 * Charge AGRÉGÉE du serveur (lot 3a des bots, spec `2026-10-29-pause-parties-bots-design.md`, § Charge agrégée) : le conteneur de production tient
 * 1 vCPU et 512 Mo pour TOUTES les parties, qui tiquent l'une après l'autre dans le même fil. Une arène avec ses services (Elsa, circulation, voitures,
 * avion des tigres, bus C3, événements), 3 parties de zombies portées au plafond de 24 tigres (le coût de la manche 20) et 4 parties de Battle Royale
 * avec 1 humain + 11 bots chacune, tous au sol. Mesure, à 60 Hz pendant 10 s simulées : la moyenne et le p99 de la SOMME des tics, le plus gros tic,
 * la mémoire résidente. Les budgets ci-dessous fixent les plafonds par défaut du serveur (`PDJ_FPS_PARTIES_TOTAL` = 6, `PDJ_FPS_BR_BOTS_TOTAL` = 24, `BR.botsSolo` = 11)
 * tant que la mesure n'a pas été refaite sur le VPS. Lot 3b : les quatre parties partagent UN budget de recherches de chemin (au plus un A* par période pour tout le
 * serveur, 3 000 nœuds au plus), comme `serveur-fps/src/index.ts`. Les humains sont protégés une fois au sol : ils ne servent pas de cible aux bots pendant la mesure.
 * À lancer SEUL : `npx vitest run lib/fps/serveur.charge-agregee.test.ts`.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const T0 = 1_700_000_000_000;
const DUREE_S = 10;
const TIC_MS = 1000 / 60;
const PARTIES_ZOMBIES = 3;
const PARTIES_BR = 4;
const BOTS_PAR_PARTIE = 11;
/** Budgets : un tic de toutes les salles doit tenir dans le tic de 16,7 ms avec de la marge (alerte du serveur à 8 ms par tic). */
const BUDGET_MOYEN_MS = 4;
const BUDGET_P99_MS = 12;
/** 512 Mo pour le conteneur : le processus de test (vitest, V8) en garde la moitié au plus. */
const BUDGET_RSS_MO = 1_024;

function lcg(graine: number): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function creerArene(): { s: Salle; ids: string[] } {
  const monde = construireMonde(scene);
  const apparitions = pointsApparition(scene, monde);
  const cachettes = lireCachettes(JSON.parse(readFileSync("public/agroparc/cachettes.json", "utf8")) as FichierCachettes)
    .map((c) => ({ x: c.x, z: c.z, cap: capDeCachette(c.cap) }));
  const [elsaX, elsaZ] = positionElsa(scene);
  const circuits = construireCircuits();
  const rondPoint = trouverRondPoint(scene) ?? ROND_POINT;
  const options: OptionsSalle = {
    zoneApparition: { centre: rondPoint.centre, ...ZONE_APPARITION },
    elsa: { x: elsaX, z: elsaZ },
    circulation: { circuits, voitures: flotte(circuits) },
    vehicules: EMPLACEMENTS_VOITURES,
    tigres: { cachettes },
    evenements: { truck: { x: elsaX, z: elsaZ }, centre: { x: rondPoint.centre[0], z: rondPoint.centre[1] } },
  };
  const s = new Salle(monde, apparitions, lcg(11), T0, options);
  const ids = ["a1", "a2", "a3", "a4", "a5", "a6"];
  ids.forEach((id, i) => s.connecter(id, `Agent${String.fromCharCode(65 + i)}`, T0));
  for (const id of ids) s.recevoir(id, { t: "rejoindre" }, T0 + 10);
  return { s, ids };
}

function creerZombies(graine: number): { s: Salle; ids: string[] } {
  const s = new Salle(construireMondeZombies(scene), DEPARTS.map((d) => [d[0], d[1]] as [number, number]), lcg(graine), T0, {
    zombies: { donnees: donneesZombies(scene), pauseMs: 500, degatsGriffe: 0, total1: 400, argentDepart: 20_000 },
  });
  const ids = ["z1", "z2"];
  ids.forEach((id, i) => s.connecter(id, `Zed${String.fromCharCode(65 + i)}`, T0));
  s.recevoir(ids[0], { t: "lancerPartie" }, T0);
  ids.forEach((id) => s.recevoir(id, { t: "rejoindre" }, T0));
  return { s, ids };
}

function creerBr(graine: number, budget: BudgetNavigation): { s: Salle; id: string; br: ServiceBr } {
  const monde = construireMondeBr(scene);
  const depart: [number, number] = [(monde.bornes.x0 + monde.bornes.x1) / 2, (monde.bornes.z0 + monde.bornes.z1) / 2];
  const s = new Salle(monde, [depart], lcg(graine), T0, { br: { scene, dureeVolMs: 15_000, budgetNavigation: budget } });
  s.connecter("h", "Alice", T0);
  s.recevoir("h", { t: "lancerPartie", bots: BOTS_PAR_PARTIE }, T0);
  s.recevoir("h", { t: "rejoindre" }, T0 + 100);
  return { s, id: "h", br: (s as unknown as { br: ServiceBr }).br };
}

describe("charge agrégée : 1 arène + 3 zombies (24 tigres) + 4 BR (1 humain + 11 bots)", () => {
  it("moyenne et p99 de la somme des tics, mémoire résidente", () => {
    const rss0 = process.memoryUsage().rss;
    const arene = creerArene();
    const zombies = Array.from({ length: PARTIES_ZOMBIES }, (_, i) => creerZombies(40 + i));
    const budgetNav = new BudgetNavigation();
    const brs = Array.from({ length: PARTIES_BR }, (_, i) => creerBr(60 + i, budgetNav));
    const rssApresCreation = process.memoryUsage().rss;
    const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;

    // ---- échauffement hors mesure (tics de 100 ms) : zombies au plafond de tigres, BR atterris au sol ----
    let t = T0 + 200;
    const tigres = zombies.map(() => 0);
    const alea = lcg(5);
    for (let k = 0; k < 4_000; k++) {
      t += 100;
      for (const { s, ids } of [arene, ...zombies]) for (const id of ids) { const x = j(s, id); x.etatT = t; if (x.protegeJusqua > 0) x.protegeJusqua = 0; }
      for (const b of brs) { const h = j(b.s, b.id); h.etatT = t; if (h.posture === "sol") h.protegeJusqua = Infinity; }
      arene.s.tic(t);
      zombies.forEach((z, i) => { for (const x of z.s.tic(t)) if (x.m.t === "snap" && x.m.zombies) tigres[i] = decoderZombies(x.m.zombies).length; });
      for (const b of brs) {
        if (b.br.etat().phase === "vol" && j(b.s, b.id).posture === "air" && b.br.aBord(b.id)) b.s.recevoir(b.id, { t: "sauter" }, t);
        if (b.br.chute(b.id)) b.s.recevoir(b.id, { t: "chute", lacet: alea() * 6, tangage: -1, avance: 1, lateral: 0, ouvrir: false }, t);
        b.s.tic(t);
      }
      const fini = tigres.every((n) => n >= ZOMBIES.plafondVivants)
        && brs.every((b) => b.br.etat().phase === "jeu" && j(b.s, b.id).posture === "sol" && b.s.joueurs().every((x) => !x.vivant || x.posture === "sol"));
      if (fini) break;
    }
    expect(tigres.every((n) => n === ZOMBIES.plafondVivants)).toBe(true);
    for (const b of brs) {
      expect(b.br.etat().phase).toBe("jeu");
      expect(b.s.nombreBots()).toBe(BOTS_PAR_PARTIE);
    }

    // ---- mesure : 600 tics à 60 Hz, toutes les salles l'une après l'autre ----
    const recherchesAvant = budgetNav.recherches;
    const total = Math.round((DUREE_S * 1000) / TIC_MS);
    const durees: number[] = [];
    let seq = 1;
    for (let k = 0; k < total; k++) {
      const maintenant = t + 1000 + Math.round(k * TIC_MS);
      const debut = performance.now();
      if (k % 2 === 0) {
        for (const { s, ids } of [arene, ...zombies]) {
          for (const id of ids) {
            const a = j(s, id);
            const dx = (alea() - 0.5) * 0.2, dz = (alea() - 0.5) * 0.2;
            const msg: MessageClient = { t: "etat", seq: ++seq, p: [a.p[0] + dx, a.p[1], a.p[2] + dz] as Vec3, v: [dx * 30, 0, dz * 30], lacet: 0, tangage: 0, posture: "sol", mur: 0 };
            s.recevoir(id, msg, maintenant);
          }
        }
      }
      for (const { s, ids } of [arene, ...zombies]) for (const id of ids) j(s, id).etatT = maintenant;
      for (const b of brs) { const h = j(b.s, b.id); h.etatT = maintenant; h.protegeJusqua = Infinity; }
      arene.s.tic(maintenant);
      for (const z of zombies) z.s.tic(maintenant);
      for (const b of brs) b.s.tic(maintenant);
      durees.push(performance.now() - debut);
    }
    const tries = [...durees].sort((a, b) => a - b);
    const moyen = durees.reduce((a, b) => a + b, 0) / durees.length;
    const p99 = tries[Math.floor(tries.length * 0.99)];
    const pire = tries[tries.length - 1];
    const rss = process.memoryUsage().rss;
    // eslint-disable-next-line no-console
    console.log(
      `[charge agrégée] ${durees.length} tics de ${1 + PARTIES_ZOMBIES + PARTIES_BR} salles : moyen ${moyen.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms, pire ${pire.toFixed(2)} ms ; `
      + `RSS ${(rss / 1048576).toFixed(0)} Mo (création : +${((rssApresCreation - rss0) / 1048576).toFixed(0)} Mo)`,
    );
    expect(durees.length).toBe(600);
    expect(moyen).toBeLessThan(BUDGET_MOYEN_MS);
    expect(p99).toBeLessThan(BUDGET_P99_MS);
    expect(rss / 1048576).toBeLessThan(BUDGET_RSS_MO);
    // un seul budget pour les quatre parties : au plus une recherche par période, jamais plus de 3 000 nœuds
    expect(budgetNav.recherches - recherchesAvant).toBeLessThanOrEqual(Math.ceil((DUREE_S * 1000) / PERIODE_BUDGET_MS));
    expect(budgetNav.noeudsMax).toBeLessThanOrEqual(NOEUDS_MAX_BOT);
    // eslint-disable-next-line no-console
    console.log(`[charge agrégée] A* des bots : ${budgetNav.recherches - recherchesAvant} recherches en ${DUREE_S} s, plus gros ${budgetNav.noeudsMax} nœuds`);
    // les bots ont joué pendant la mesure : ils sont toujours en jeu dans chaque partie
    for (const b of brs) expect(b.s.joueurs().filter((x) => x.bot && x.enJeu).length).toBeGreaterThan(0);
  }, 120_000);
});
