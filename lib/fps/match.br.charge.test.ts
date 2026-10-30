import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { construireMondeBr, pointsButin } from "./br-carte";
import { BR } from "./br-regles";
import { resoudre } from "./collision";
import { Salle, type JoueurSalle, type Sortie } from "./match";
import type { ServiceBr } from "./match-contexte";
import { BudgetNavigation, NOEUDS_MAX_BOT } from "./nav-bots";
import { SILHOUETTE, type MessageClient, type Vec3 } from "./protocole";

/**
 * Charge du mode Battle Royale : 50 joueurs, tic à 60 Hz pendant 10 s simulées (600 tics), états des clients à 30 Hz. Trois mesures :
 * - le volume que CHAQUE client reçoit pendant le lancement (50 `rejoindre`, synchro complète du butin, `br{etat}` à 50 lignes) : il doit rester
 *   très en dessous du tampon d'envoi du serveur (`TAMPON_MAX_OCTETS` = 512 Ko, au-delà la connexion est coupée) ;
 * - la chute simultanée des 50 joueurs (le serveur simule chaque chute en temps réel) ;
 * - 50 joueurs au sol, états à 30 Hz et coups de couteau validés.
 * Chaque phase mesure le temps CPU moyen d'un tic (messages reçus compris) et la taille du plus gros snap sérialisé.
 * À lancer SEUL (le serveur en lance 60 par seconde sur 0,6 vCPU) : sous vitesse parallèle de toute la machine, le budget de 2 ms laisse la marge.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const T0 = 1_700_000_000_000;
const DUREE_S = 10;
const TIC_MS = 1000 / 60;
const N = 50;
/** Tampon d'envoi du serveur (`serveur-fps/src/index.ts`) : une connexion qui le dépasse est coupée. */
const TAMPON_MAX_OCTETS = 512 * 1024;
/** Un snap de 50 joueurs sérialisé (octets) : ≈ 8,6 Ko mesurés à la conception, 10,5 Ko de budget. */
const BUDGET_SNAP_OCTETS = 10_500;
/** Budget CPU moyen par tic (ms), `tic` ET messages reçus pendant ce tic. */
const BUDGET_TIC_MOYEN_MS = 2;
/** Volume du lancement par client : « bien sous » le tampon, un quart au plus. */
const BUDGET_LANCEMENT_OCTETS = TAMPON_MAX_OCTETS / 4;

function lcg(graine: number): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/** Pseudos de base distincte (des chiffres finaux se confondraient : conflit de noms qui bloquerait le lancement). */
const pseudo = (i: number) => `Pilote${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`;

function destinataire(x: Sortie, id: string, enJeu: boolean): boolean {
  if (x.sauf === id) return false;
  return x.a === id || x.a === "tous" || (x.a === "joueurs" && enJeu) || (x.a === "spectateurs" && !enJeu);
}

/** Salle de 50 joueurs lancée et à bord de l'avion ; renvoie aussi le volume reçu par client jusqu'au départ de l'avion. */
function salleLancee() {
  const monde = construireMondeBr(scene);
  const depart: [number, number] = [(monde.bornes.x0 + monde.bornes.x1) / 2, (monde.bornes.z0 + monde.bornes.z1) / 2];
  const s = new Salle(monde, [depart], lcg(42), T0, { br: { scene, dureeVolMs: 15_000 } });
  const ids = Array.from({ length: N }, (_, i) => `j${i.toString(36)}`);
  const octets = new Map<string, number>(ids.map((id) => [id, 0]));
  const compter = (sorties: Sortie[]) => {
    for (const x of sorties) {
      const taille = JSON.stringify(x.m).length;
      for (const id of ids) {
        const j = s.inspecter(id);
        if (j && destinataire(x, id, j.enJeu)) octets.set(id, octets.get(id)! + taille);
      }
    }
  };
  // les connexions (lobby) arrivent au fil de l'eau, minutes avant le lancement : le tampon d'envoi se vide entre-temps, elles ne comptent pas
  ids.forEach((id, i) => s.connecter(id, pseudo(i), T0));
  compter(s.recevoir(ids[0], { t: "lancerPartie" }, T0));
  let t = T0 + 100;
  for (const id of ids) compter(s.recevoir(id, { t: "rejoindre" }, t));
  const br = (s as unknown as { br: ServiceBr }).br;
  while (br.etat().phase !== "vol") {
    t += 100;
    for (const id of ids) (s.inspecter(id) as JoueurSalle).etatT = t;
    compter(s.tic(t));
  }
  return { s, ids, t, octets, br };
}

interface Mesure { cpu: number; tics: number; pire: number; plusGrosSnap: number; snaps: number; vivantsMax: number }

/** 600 tics à 60 Hz à partir de `t`, `entrees(k, t)` envoie les messages des clients de l'image `k` (comptés dans le temps du tic). */
function mesurer(s: Salle, t: number, entrees: (k: number, maintenant: number) => void): Mesure {
  const m: Mesure = { cpu: 0, tics: 0, pire: 0, plusGrosSnap: 0, snaps: 0, vivantsMax: 0 };
  const total = Math.round(DUREE_S * 1000 / TIC_MS);
  for (let k = 0; k < total; k++) {
    const maintenant = t + Math.round((k + 1) * TIC_MS);
    const debut = performance.now();
    entrees(k, maintenant);
    const sorties = s.tic(maintenant);
    const dt = performance.now() - debut;
    m.cpu += dt; m.tics++; m.pire = Math.max(m.pire, dt);
    for (const x of sorties) {
      if (x.m.t !== "snap" || x.a !== "joueurs") continue;
      m.plusGrosSnap = Math.max(m.plusGrosSnap, JSON.stringify(x.m).length);
      m.snaps++;
      m.vivantsMax = Math.max(m.vivantsMax, x.m.j.length);
    }
  }
  return m;
}

const decrire = (nom: string, m: Mesure) =>
  // eslint-disable-next-line no-console
  console.log(`[charge br] ${nom} : ${m.tics} tics, moyen ${(m.cpu / m.tics).toFixed(3)} ms, pire ${m.pire.toFixed(2)} ms ; plus gros snap ${m.plusGrosSnap} octets (${m.vivantsMax} joueurs) ; ${m.snaps} snaps`);

describe("charge BR : 50 joueurs, 600 tics à 60 Hz, états à 30 Hz", () => {
  it("lancement : volume cumulé reçu par chaque client bien sous le tampon d'envoi (512 Ko)", () => {
    const { octets, br, ids } = salleLancee();
    const volumes = ids.map((id) => octets.get(id)!);
    const pire = Math.max(...volumes);
    // eslint-disable-next-line no-console
    console.log(`[charge br] lancement : volume par client de ${Math.min(...volumes)} à ${pire} octets (${(pire / 1024).toFixed(1)} Ko ; tampon ${TAMPON_MAX_OCTETS / 1024} Ko)`);
    expect(br.etat()).toMatchObject({ phase: "vol", total: N });
    // la synchro complète du butin (≈ 450 objets) est le gros morceau : au moins la liste, sans dépasser le budget
    expect(Math.min(...volumes)).toBeGreaterThan(10_000);
    expect(pire).toBeLessThan(BUDGET_LANCEMENT_OCTETS);
  });

  it("chute simultanée des 50 joueurs : temps CPU moyen d'un tic et taille d'un snap dans le budget", () => {
    const { s, ids, t } = salleLancee();
    const j = (id: string) => s.inspecter(id) as JoueurSalle;
    // tous sautent au départ de l'avion (30 Hz d'entrées de chute ensuite, piqué vers l'avant, parachute ouvert après 2 s)
    for (const id of ids) s.recevoir(id, { t: "sauter" }, t);
    const alea = lcg(7);
    const m = mesurer(s, t, (k, maintenant) => {
      if (k % 2 !== 0) return;
      for (const id of ids) {
        const msg: MessageClient = {
          t: "chute", lacet: alea() * 6.28, tangage: -0.2 - alea(), avance: 1, lateral: alea() * 2 - 1, ouvrir: k * TIC_MS >= 2_000,
        };
        s.recevoir(id, msg, maintenant);
      }
    });
    decrire("chute simultanée", m);
    expect(m.tics).toBe(600);
    expect(s.nombreEnJeu()).toBe(N);
    expect(m.snaps).toBeGreaterThanOrEqual(95); // 10 Hz pendant 10 s
    expect(m.vivantsMax).toBe(N);
    expect(m.plusGrosSnap).toBeLessThanOrEqual(BUDGET_SNAP_OCTETS);
    expect(m.cpu / m.tics).toBeLessThan(BUDGET_TIC_MOYEN_MS);
    // personne n'a été évincé ni éliminé pendant la chute
    expect((s as unknown as { br: ServiceBr }).br.resume().vivants).toBe(N);
  });

  it("50 joueurs au sol : états à 30 Hz et coups de couteau validés, temps CPU moyen d'un tic et taille d'un snap dans le budget", () => {
    const { s, ids, t: t0, br } = salleLancee();
    const j = (id: string) => s.inspecter(id) as JoueurSalle;
    // tout le monde saute (chute libre puis parachute) et atterrit, hors mesure
    for (const id of ids) s.recevoir(id, { t: "sauter" }, t0);
    let t = t0;
    let k = 0;
    while (ids.some((id) => j(id).posture !== "sol" || br.enVol(id))) {
      t += 100;
      if (++k > 2_000) throw new Error("tous n'ont pas atterri");
      for (const id of ids) { j(id).etatT = t; s.recevoir(id, { t: "chute", lacet: 0, tangage: -1, avance: 1, lateral: 0, ouvrir: false }, t); }
      s.tic(t);
    }
    // la protection d'atterrissage écoulée
    t += BR.protectionAtterrissageMs + 500;
    for (const id of ids) j(id).etatT = t;
    s.tic(t);
    expect(br.etat()).toMatchObject({ phase: "jeu", vivants: N });

    // huit paires de combattants sur la chaussée (A frappe B à 1,2 m) ; les autres bougent seulement
    const monde = (s as unknown as { monde: Parameters<typeof resoudre>[0] }).monde;
    const route = pointsButin(scene, monde as never).filter((x) => x.pool === "route");
    const libres = route.filter((x) => [0, 1.2].every((dx) => {
      const p: Vec3 = [x.p[0] + dx, x.p[1], x.p[2]];
      const r = resoudre(monde, p, 0.4, 1.8).p;
      return Math.hypot(r[0] - p[0], r[2] - p[2]) < 1e-6;
    }));
    const paires: [string, string][] = [];
    for (let i = 0, k2 = 0; i < 8; i++, k2 += Math.floor(libres.length / 8)) {
      const [a, b] = [ids[2 * i], ids[2 * i + 1]];
      const p = libres[k2];
      for (const [id, dx] of [[a, 0], [b, 1.2]] as const) {
        const x = j(id);
        x.p = [p.p[0] + dx, p.p[1], p.p[2]];
        x.v = [0, 0, 0];
        x.histo = [{ t, p: [...x.p] as Vec3, accroupi: false }];
        x.accroupi = false;
        x.sortieJusqua = t;
      }
      paires.push([a, b]);
    }
    const alea = lcg(11);
    let seq = 1;
    let coups = 0, degats = 0;
    const m = mesurer(s, t, (img, maintenant) => {
      // états des clients à 30 Hz : petits déplacements (jamais plus que la vitesse permise)
      if (img % 2 === 0) {
        for (const id of ids) {
          const a = j(id);
          const dx = (alea() - 0.5) * 0.1, dz = (alea() - 0.5) * 0.1;
          s.recevoir(id, { t: "etat", seq: ++seq, p: [a.p[0] + dx, a.p[1], a.p[2] + dz] as Vec3, v: [dx * 30, 0, dz * 30], lacet: a.lacet, tangage: a.tangage, posture: "sol", mur: 0 }, maintenant);
        }
      }
      // un coup toutes les 45 images (0,75 s) par combattant, trois suffisent à tuer : la mort passe aussi par la mesure
      if (img >= 60 && img % 45 === 0) {
        for (const [a, b] of paires) {
          const x = j(a), y = j(b);
          const o: Vec3 = [x.p[0], x.p[1] + SILHOUETTE.oeil, x.p[2]];
          const v = [y.p[0] - o[0], y.p[1] + SILHOUETTE.centreY - o[1], y.p[2] - o[2]];
          const l = Math.hypot(v[0], v[1], v[2]);
          const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
          x.lacet = Math.atan2(-d[0], -d[2]);
          x.tangage = Math.asin(d[1]);
          const sorties = s.recevoir(a, { t: "coup", o, d, cibles: [b] }, maintenant);
          coups++;
          degats += sorties.filter((r) => r.m.t === "degats").length;
        }
      }
    });
    decrire("50 au sol", m);
    expect(m.tics).toBe(600);
    expect(m.snaps).toBeGreaterThanOrEqual(95);
    expect(m.vivantsMax).toBe(N);
    // les coups sont validés par le serveur (sans quoi on ne mesurerait rien) : toutes les paires ont fini par perdre un combattant
    expect(coups).toBeGreaterThan(0);
    expect(degats).toBeGreaterThanOrEqual(8 * 3);
    expect(br.etat().vivants).toBe(N - 8);
    expect(m.plusGrosSnap).toBeLessThanOrEqual(BUDGET_SNAP_OCTETS);
    expect(m.cpu / m.tics).toBeLessThan(BUDGET_TIC_MOYEN_MS);
  });
});

describe("charge BR : 1 humain + 15 bots (v11), 600 tics à 60 Hz", () => {
  /** Salle lancée seul avec 15 bots, tous au sol (humain compris), protection d'atterrissage écoulée. */
  function salleAvecBots() {
    const budget = new BudgetNavigation();
    const monde = construireMondeBr(scene);
    const depart: [number, number] = [(monde.bornes.x0 + monde.bornes.x1) / 2, (monde.bornes.z0 + monde.bornes.z1) / 2];
    const s = new Salle(monde, [depart], lcg(42), T0, { br: { scene, dureeVolMs: 15_000, budgetNavigation: budget } });
    s.connecter("h", "Alice", T0);
    s.recevoir("h", { t: "lancerPartie", bots: 15 }, T0);
    let t = T0 + 100;
    s.recevoir("h", { t: "rejoindre" }, t);
    const br = (s as unknown as { br: ServiceBr }).br;
    const humain = () => s.inspecter("h") as JoueurSalle;
    const bots = () => s.joueurs().filter((x) => x.bot);
    while (br.etat().phase !== "vol") { t += 100; humain().etatT = t; s.tic(t); }
    s.recevoir("h", { t: "sauter" }, t);
    let k = 0;
    while (br.etat().phase !== "jeu" || humain().posture !== "sol" || bots().some((x) => x.vivant && x.posture !== "sol")) {
      t += 100;
      if (++k > 3_000) throw new Error("tous n'ont pas atterri");
      humain().etatT = t;
      s.recevoir("h", { t: "chute", lacet: 0, tangage: -1, avance: 1, lateral: 0, ouvrir: false }, t);
      s.tic(t);
    }
    return { s, t, br, humain, bots, budget };
  }

  it("tic moyen dans le budget, aucun tic de plus de 50 ms, snap dans le budget, tous les états des bots acceptés", () => {
    const { s, t, br, humain, bots, budget } = salleAvecBots();
    expect(bots()).toHaveLength(15);
    let etatsBots = 0;
    const recevoir = s.recevoir.bind(s);
    s.recevoir = (id: string, msg: MessageClient, maintenant: number): Sortie[] => {
      if (msg.t === "etat" && id !== "h") etatsBots++;
      return recevoir(id, msg, maintenant);
    };
    const m = mesurer(s, t, (_k, maintenant) => { humain().etatT = maintenant; });
    decrire("1 humain + 15 bots", m);
    expect(m.tics).toBe(600);
    expect(m.pire).toBeLessThan(50);
    expect(m.cpu / m.tics).toBeLessThan(BUDGET_TIC_MOYEN_MS);
    expect(m.plusGrosSnap).toBeLessThanOrEqual(BUDGET_SNAP_OCTETS);
    // les cerveaux ont réellement tourné : 20 Hz par bot vivant
    expect(etatsBots).toBeGreaterThan(5 * 15 * 10 * 0.5);
    expect(br.etat().phase === "jeu" || br.etat().phase === "fin").toBe(true);
    // navigation (lot 3b) : des chemins cherchés, jamais plus de 3 000 nœuds explorés (≈ quelques ms), au plus un A* par période
    expect(budget.recherches).toBeGreaterThan(0);
    expect(budget.noeudsMax).toBeLessThanOrEqual(NOEUDS_MAX_BOT);
    console.log(`navigation des bots : ${budget.recherches} recherches, plus gros A* ${budget.noeudsMax} nœuds`);
  });
});
