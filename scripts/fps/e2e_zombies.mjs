#!/usr/bin/env node
/**
 * Test de bout en bout du mode zombies (tigres) de l'arène FPS (vue Palantir) : DEUX navigateurs Chromium headless contre un `serveur-fps` local
 * (variables d'essai : argent 3 000 $, 3 tigres à la manche 1, décompte et pauses de 20 s, griffe de 5, jamais de manche du Truck Muche) et un `next dev`
 * local, pilotés par `window.__arene`. Carte « Service de midi » (v7) : départ dans l'open space du Pôle R&D.
 *
 * Scénario (chaque étape imprime OK / ÉCHEC, des captures sont prises en route) :
 *  1. vue 3D (code « myrtille »), les trois cartes de mode (arène, zombies, Battle Royale), choix du mode « Zombies tigres » par les deux joueurs,
 *     lobby : liste des joueurs, badge « hôte », bouton « Lancer la partie » actif pour l'hôte seulement
 *  2. le second ne peut pas lancer (même par le crochet), l'hôte lance : les deux entrent en jeu (équipement de départ : pistolet + couteau)
 *  3. achat d'une arme au mur (le fusil à pompe de l'open space, 500 $) avant l'arrivée des tigres : débit confirmé par le serveur
 *  4. HUD de manche et d'argent, des tigres dans le snap des deux joueurs
 *  5. un tigre abattu au pistolet : touches confirmées par le serveur, argent crédité (touches puis kill)
 *  6. un joueur à terre (griffes), relevé par l'autre en maintenant E (3 s) : écran « À terre », aucun message `mort`, compteur de relèves
 *  7. coups de couteau sur les tigres (cibles « z<n> », 150 dégâts : un coup tue à la manche 1), fin de la manche 1 sans bonus (BO1), pause
 *  8. pendant la pause : achat de la porte D1 (salle de pause) : message `batiments` reçu par les deux, puis du mini Uzi derrière (il remplace le pistolet)
 *  9. manche 2 : partie perdue quand les deux sont à terre, bilan affiché, « Rejouer » ramène au lobby, la salle repasse au lobby
 * 10. aucune erreur JavaScript ni `erreur` du serveur, aucune WebSocket coupée en partie
 *
 * Usage : node scripts/fps/e2e_zombies.mjs        (Node 22 ; Playwright : `npm i --no-save playwright` ou PLAYWRIGHT_DIR=/dossier/avec/node_modules)
 * Variables : E2E_OUT (captures en 1280×720, défaut <tmp>/pdj-e2e-zombies), E2E_URL (Next déjà lancé : on ne le démarre pas),
 *             E2E_WS (serveur déjà lancé : il doit avoir les variables d'essai PDJ_FPS_ZOMBIES_*), E2E_WS_PORT (port imposé au serveur lancé par le script,
 *             à faire coïncider avec NEXT_PUBLIC_FPS_WS_URL d'un Next déjà lancé), E2E_PAGE (page qui monte le code « myrtille », défaut une 404 : aucune
 *             lecture de la base), E2E_HEADED=1, E2E_GARDER=1 (laisse les serveurs lancés par le script), E2E_JUSQUA=5 (s'arrête après l'étape 5),
 *             E2E_SEULES=1,3 (ne joue que ces étapes ; la 1 et la 2 sont toujours jouées, elles font entrer les joueurs), E2E_DEBUG=1 (trace des gestes),
 *             E2E_GRIFFE (dégâts de griffe, défaut 5 : vingt griffes couchent un joueur de 100 PV, ce qui laisse au joueur qui frappe à l'épée le temps
 *             de plusieurs coups malgré le rendu logiciel ; 100 = une seule griffe), E2E_TOTAL (tigres de la manche 1, défaut 3), E2E_PAUSE (décompte et pauses, défaut 20 000 ms).
 * Code de sortie : 0 si toutes les étapes passent, 1 sinon.
 *
 * Stratégie : les tigres de la manche 1 marchent (3 m/s) et doivent d'abord arracher les six planches d'une fenêtre ; le script déplace les joueurs par
 * téléportation. Alice fuit au point de l'open space le plus éloigné dès qu'ils approchent à moins de 9 m ; Bob attend dehors, hors de toute zone de
 * jeu (les tigres n'apparaissent que dans les zones occupées et leurs voisines, et un tigre entré ne ressort pas par une fenêtre : le serveur ne contrôle
 * que les bornes et la vitesse) et sert d'appât à l'étape 6.
 *
 * À savoir : `teleporter` ne change que la position CLIENT et le serveur refuse tout saut plus grand que sa vitesse permise (le script déplace par
 * sauts de 40 m au plus, chacun attendu chez l'autre joueur : un saut de 40 m prend ~2 s) ; les fenêtres sont réduites en combat (rendu logiciel
 * de deux grandes fenêtres : 2–3 images/s, trop lent pour un coup d'épée) ; le verrouillage du pointeur, absent en headless, est émulé ; le serveur
 * n'utilise jamais le port 8787 (un onglet de développement ouvert s'y reconnecterait) ; un `next dev` à froid recharge les pages ouvertes.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SORTIE = process.env.E2E_OUT ?? join(tmpdir(), "pdj-e2e-zombies");
const PAGE = process.env.E2E_PAGE ?? "/arene-e2e-introuvable";
const GRIFFE = process.env.E2E_GRIFFE ?? "5";
const ARGENT = process.env.E2E_ARGENT ?? "3000";
/** Tigres de la manche 1 (3 : un tué au pistolet, un à l'épée, le dernier sert d'appât à la relève). */
const TOTAL = process.env.E2E_TOTAL ?? "3";
/** Décompte de départ et pauses entre manches (ms) : assez longs pour acheter le mini Uzi et une porte entre deux manches. */
const PAUSE = process.env.E2E_PAUSE ?? "20000";

// Repères de la carte « Service de midi » (lib/fps/zombies-carte.ts, mètres)
/** Points de départ des joueurs : l'open space du Pôle R&D (bâtiment 72). */
const DEPARTS = [[107.35, -27.36], [112.64, -25.84], [117.92, -24.33], [123.69, -22.67], [113.52, -29.65], [119.81, -31.27], [125.79, -18.74], [105.82, -23.84]];
const CENTRE_COUR = [116, -25];
/** Fusil à pompe (open space), mini Uzi (salle de pause, derrière D1). */
const ACHAT_POMPE = [106.4, -27.8];
const ACHAT_UZI = [131.1, -24.3];
/** Porte D1 (open space → salle de pause) : point d'achat côté open space. */
const ACHAT_D1 = [127.3, -21.9];
/** Bob attend dehors, hors de toute zone (aucun tigre n'y naît ni n'y vient), à 55 m de l'open space et 26 m de la fenêtre la plus proche. */
const ZONE_BOB_DEHORS = [68, 10];
/** Alice attend dehors elle aussi pendant que Bob sert d'appât (ni zone, ni fenêtre à moins de 20 m). */
const ZONE_ALICE_DEHORS = [60, 14];
/** Fenêtres de l'open space : point d'arrivée des tigres dehors, poste de tir 3 m à l'intérieur (dedans + normale × 3). */
const FENETRES_OPEN = [
  { id: "F1", dehors: [109.05, -20.59], poste: [110.66, -26.27] },
  { id: "F2", dehors: [119.63, -17.58], poste: [121.24, -23.26] },
];

// ---------------------------------------------------------------------------------------------------------------- utilitaires

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const trace = (...a) => { if (process.env.E2E_DEBUG) console.log(`    [${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const plat = (p) => [p[0], p[2]];

function portLibre() {
  return new Promise((ok, ko) => {
    const s = createServer();
    s.once("error", ko);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

function chargerPlaywright() {
  const candidats = [process.env.PLAYWRIGHT_DIR, RACINE, process.cwd(), join(RACINE, "plats-du-jour")].filter(Boolean);
  for (const base of candidats) {
    try { return createRequire(join(base, "x.js"))("playwright"); } catch { /* suivant */ }
  }
  throw new Error("Playwright introuvable : `npm i --no-save playwright` (navigateurs : `npx playwright install chromium`) ou PLAYWRIGHT_DIR=/dossier/avec/node_modules");
}

async function attendreHttp(url, ms, nom) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* pas prêt */ }
    await dormir(400);
  }
  throw new Error(`${nom} injoignable (${url}) après ${ms / 1000} s`);
}

const enfants = [];
function lancer(nom, cmd, args, opts) {
  const e = spawn(cmd, args, { ...opts, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const journal = [];
  const noter = (b) => { journal.push(b.toString()); if (journal.length > 400) journal.shift(); };
  e.stdout.on("data", noter);
  e.stderr.on("data", noter);
  e.journal = journal;
  e.nom = nom;
  enfants.push(e);
  return e;
}
function toutArreter() {
  for (const e of enfants) {
    try { process.kill(-e.pid, "SIGTERM"); } catch { /* déjà parti */ }
  }
}

/** Attend qu'une fonction (async) devienne vraie ; `quoi` peut être une fonction (async) évaluée à l'échec, pour joindre un diagnostic à jour. */
async function jusqua(fn, { ms = 10_000, pas = 120, quoi = "condition" } = {}) {
  const fin = Date.now() + ms;
  let derniere;
  while (Date.now() < fin) {
    try { derniere = await fn(); if (derniere) return derniere; } catch (e) { derniere = e; }
    await dormir(pas);
  }
  const texte = typeof quoi === "function" ? await Promise.resolve(quoi()).catch((e) => `(diagnostic indisponible : ${e.message})`) : quoi;
  throw new Error(`délai dépassé (${ms} ms) : ${texte}${derniere instanceof Error ? ` — ${derniere.message}` : ""}`);
}

function verifier(cond, msg) { if (!cond) throw new Error(msg); }

// ---------------------------------------------------------------------------------------------------------------- joueur

let etapeCourante = "avant le scénario";

class Joueur {
  constructor(nom, page) {
    this.nom = nom;
    this.page = page;
    /** messages du serveur reçus / envoyés, dans l'ordre : { t, m, a } */
    this.recus = [];
    this.envoyes = [];
    this.erreurs = [];
    /** fermetures de la WebSocket en cours de scénario (le client se reconnecte seul : à surveiller) */
    this.fermetures = [];
    page.on("pageerror", (e) => this.erreurs.push(`pageerror : ${String(e).slice(0, 300)}`));
    page.on("console", (m) => { if (m.type() === "error") this.erreurs.push(`console.error : ${m.text().slice(0, 300)}`); });
    page.on("websocket", (ws) => {
      ws.on("framereceived", (f) => { try { const m = JSON.parse(String(f.payload)); this.recus.push({ t: m.t, m, a: Date.now() }); } catch { /* binaire */ } });
      ws.on("framesent", (f) => { try { const m = JSON.parse(String(f.payload)); this.envoyes.push({ t: m.t, m, a: Date.now() }); } catch { /* binaire */ } });
      ws.on("close", () => etapeCourante.startsWith("1.") || this.fermetures.push({ a: Date.now(), etape: etapeCourante, dernierRecu: this.recus.at(-1)?.t }));
    });
  }
  ev(expr, arg) { return this.page.evaluate(expr, arg); }
  jeu() { return this.ev(() => window.__arene.etat().jeu); }
  etat() { return this.ev(() => window.__arene.etat()); }
  async id() { return (await this.etat()).monId; }
  /** Messages reçus d'un type, depuis l'instant `depuis` (ms epoch). */
  msgs(t, depuis = 0) { return this.recus.filter((r) => r.t === t && r.a >= depuis).map((r) => r.m); }
  /** Messages envoyés d'un type, depuis l'instant `depuis`. */
  envoyesDe(t, depuis = 0) { return this.envoyes.filter((r) => r.t === t && r.a >= depuis).map((r) => r.m); }
  resume(depuis = 0) {
    const compte = (l) => { const c = {}; for (const r of l) if (r.a >= depuis && !["etat", "snap", "ping", "pong"].includes(r.t)) c[r.t] = (c[r.t] ?? 0) + 1; return JSON.stringify(c); };
    return `${this.nom} ↑${compte(this.envoyes)} ↓${compte(this.recus)}`;
  }
  touche(code, bas) { return this.ev(([c, b]) => window.__arene.touche(c, b), [code, bas]); }
  async appui(code, ms = 120) { await this.touche(code, true); await dormir(ms); await this.touche(code, false); }
  teleporter(p) { return this.ev((q) => window.__arene.teleporter(q), p); }
  /** Fenêtre réduite pendant les combats : le rendu logiciel de deux grandes fenêtres tourne à 2–3 images/s, trop lent pour un coup d'épée. */
  async reduire(petit) {
    this.petit = petit;
    await this.page.setViewportSize(petit ? { width: 480, height: 270 } : { width: 1280, height: 720 });
    await dormir(petit ? 300 : 700);
  }
  async capture(nom) {
    const f = join(SORTIE, `${nom}.png`);
    const etait = this.petit;
    if (etait) await this.reduire(false);
    await this.page.screenshot({ path: f });
    if (etait) await this.reduire(true);
    return f;
  }
  /** Dernier état de la partie (message `zombies`, tenu par l'interface). */
  async partie() { return (await this.etat()).zombies ?? null; }
  async moiPartie() { const e = await this.etat(); return e.zombies?.joueurs?.find((x) => x.id === e.monId) ?? null; }
}

/**
 * Pose `j` en `pos` (mètres, plan XZ) par sauts de 40 m au plus, chacun attendu chez `autre` (qui voit `j` là où le serveur l'a accepté) :
 * le serveur ne laisse franchir que la vitesse permise depuis le dernier état accepté (la distance permise grandit tant que les états sont refusés).
 */
async function aller(j, autre, pos, tolerance = 2.5) {
  const idJ = await j.id();
  const PAS = 40;
  for (let etape = 0; etape < 8; etape++) {
    const moi = plat((await j.jeu()).p);
    const reste = dist(moi, pos);
    const k = reste > PAS ? PAS / reste : 1;
    const cible = [moi[0] + (pos[0] - moi[0]) * k, moi[1] + (pos[1] - moi[1]) * k];
    let accepte = false;
    for (let essai = 0; essai < 3 && !accepte; essai++) {
      await j.teleporter([cible[0], 0, cible[1]]);
      accepte = await jusqua(async () => {
        const vu = (await autre.jeu()).distants.find((x) => x.id === idJ);
        return !!vu && dist(plat(vu.p), cible) < tolerance;
      }, { ms: 6000, quoi: "" }).then(() => true, () => false);
    }
    if (!accepte) {
      const sj = await j.jeu(), mp = await j.moiPartie();
      const tg = (sj?.zombies ?? []).map((t) => [t.id, +t.x.toFixed(0), +t.z.toFixed(0)]);
      throw new Error(`${j.nom} ne peut pas être posé en (${cible.map((x) => x.toFixed(1))}) : côté client ${JSON.stringify(sj?.p.map((x) => +x.toFixed(1)))}, vivant ${sj?.vivant}, pv ${sj?.pv}, état de partie ${JSON.stringify(mp)}, tigres ${JSON.stringify(tg)}, phase ${(await j.partie())?.phase}, manche ${sj?.manche}`);
    }
    if (k === 1) return;
  }
  throw new Error(`${j.nom} n'arrive pas en (${pos.map((x) => x.toFixed(1))})`);
}

// ---------------------------------------------------------------------------------------------------------------- tigres

/** Les tigres vus par `j` (positions interpolées du client), triés par distance à `depuis` (plan XZ). */
async function tigresProches(j, depuis = null) {
  const s = await j.jeu();
  const ref = depuis ?? plat(s.p);
  return (s.zombies ?? []).map((t) => ({ ...t, d: dist([t.x, t.z], ref) })).sort((a, b) => a.d - b.d);
}

/** Vise le centre du tigre `t` (≈ 1 m de haut) depuis l'œil de `j`. */
function viserTigre(j, t) {
  return j.ev(([x, z]) => {
    const e = window.__arene.etat().jeu;
    const o = e.oeil;
    const dx = x - o[0], dy = 1.0 - o[1], dz = z - o[2];
    window.__arene.regarder(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  }, [t.x, t.z]);
}

// ---------------------------------------------------------------------------------------------------------------- étapes

const resultats = [];
let participants = [];
async function etape(nom, fn) {
  if (process.env.E2E_JUSQUA && parseInt(nom, 10) > Number(process.env.E2E_JUSQUA)) return true;
  const numero = nom.split(".")[0];
  if (process.env.E2E_SEULES && numero !== "1" && numero !== "2" && !process.env.E2E_SEULES.split(",").includes(numero)) return true;
  const t0 = Date.now();
  etapeCourante = nom;
  process.stdout.write(`- ${nom} ... `);
  try {
    const detail = await fn();
    resultats.push({ nom, ok: true });
    console.log(`OK (${((Date.now() - t0) / 1000).toFixed(1)} s)${detail ? ` — ${detail}` : ""}`);
    return true;
  } catch (e) {
    resultats.push({ nom, ok: false, erreur: e.message });
    console.log(`ÉCHEC — ${e.message}`);
    for (const j of participants) await j.capture(`echec-${numero}-${j.nom}`).catch(() => null);
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------- principal

mkdirSync(SORTIE, { recursive: true });
const { chromium } = chargerPlaywright();
let navigateur = null;

try {
  // --- serveurs
  let portWs, urlWs;
  if (process.env.E2E_WS) urlWs = process.env.E2E_WS;
  else {
    portWs = process.env.E2E_WS_PORT ? Number(process.env.E2E_WS_PORT) : await portLibre();
    urlWs = `ws://localhost:${portWs}`;
    const build = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: join(RACINE, "serveur-fps"), encoding: "utf8" });
    if (build.status !== 0) throw new Error(`build de serveur-fps en échec :\n${build.stdout}${build.stderr}`);
    const srv = lancer("serveur-fps", process.execPath, ["dist/index.js"], {
      cwd: join(RACINE, "serveur-fps"),
      env: {
        ...process.env, PORT: String(portWs), SCENE_JSON: join(RACINE, "public/agroparc/scene.json"),
        PDJ_FPS_ZOMBIES_ARGENT: ARGENT, PDJ_FPS_ZOMBIES_TOTAL: TOTAL, PDJ_FPS_ZOMBIES_PAUSE_MS: PAUSE, PDJ_FPS_ZOMBIES_GRIFFE: GRIFFE,
        PDJ_FPS_ZOMBIES_TRUCK: "0",
      },
    });
    await attendreHttp(`http://localhost:${portWs}/sante`, 20_000, "serveur-fps").catch((e) => { throw new Error(`${e.message}\n${srv.journal.join("")}`); });
  }
  let urlNext;
  if (process.env.E2E_URL) urlNext = process.env.E2E_URL;
  else {
    const portNext = await portLibre();
    urlNext = `http://localhost:${portNext}`;
    const nx = lancer("next", process.execPath, [join(RACINE, "node_modules/next/dist/bin/next"), "dev", "-p", String(portNext)], {
      cwd: RACINE,
      env: { ...process.env, NEXT_PUBLIC_FPS_WS_URL: urlWs, NEXT_TELEMETRY_DISABLED: "1" },
    });
    await attendreHttp(`${urlNext}${PAGE}`, 240_000, "next dev").catch((e) => { throw new Error(`${e.message}\n${nx.journal.join("").slice(-1500)}`); });
  }
  console.log(`Serveur ${urlWs} · site ${urlNext}${PAGE} · captures ${SORTIE} · griffe ${GRIFFE}\n`);

  // --- navigateurs
  navigateur = await chromium.launch({
    headless: !process.env.E2E_HEADED,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  });
  const joueurs = [];
  for (const nom of ["Alice", "Bob"]) {
    // 1280×720 partout : rendu logiciel plus rapide, captures plus fiables ; stockage local vide au départ (mode mémorisé : arène)
    const ctx = await navigateur.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(() => {
      // Chromium headless n'accorde pas le verrouillage du pointeur : on l'émule (même contrat que l'API, sans mouvements de souris)
      let verrou = null;
      Object.defineProperty(Document.prototype, "pointerLockElement", { get: () => verrou, configurable: true });
      Element.prototype.requestPointerLock = function () { verrou = this; queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange"))); return Promise.resolve(); };
      Document.prototype.exitPointerLock = function () { verrou = null; document.dispatchEvent(new Event("pointerlockchange")); };
    });
    const page = await ctx.newPage();
    joueurs.push(new Joueur(nom, page));
  }
  const [A, B] = joueurs;
  participants = joueurs;

  // ------------------------------------------------------------------ 1. choix du mode et lobby
  const lobby = await etape("1. vue 3D (code « myrtille »), choix du mode « Zombies tigres » par les deux joueurs, lobby", async () => {
    const ouvert = (j) => j.ev(() => !!window.__arene && !!document.querySelector("aside[aria-label='Arène'], aside[aria-label='Zombies'], aside[aria-label='Battle Royale']")).catch(() => false);
    async function ouvrir(j) {
      await j.page.goto(`${urlNext}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await dormir(2500); // hydratation
      await j.page.keyboard.type("myrtille", { delay: 60 });
      const bouton = j.page.getByRole("button", { name: /^Arène/ }).first();
      if (!(await bouton.waitFor({ state: "visible", timeout: 60_000 }).then(() => true, () => false))) return;
      await bouton.evaluate((e) => e.click()).catch(() => null);
      const champ = j.page.getByLabel("Nom de joueur");
      if (await champ.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false)) await champ.fill(j.nom).catch(() => null);
    }
    let stable = 0;
    for (let tour = 1; tour <= 8 && stable < 2; tour++) {
      let tous = true;
      for (const j of joueurs) if (!(await ouvert(j))) { tous = false; await ouvrir(j); }
      if (tous) { stable++; await dormir(2500); } else stable = 0;
    }
    verifier(stable >= 2, "la vue Palantir et le panneau d'entrée ne restent pas ouverts chez les deux joueurs");
    await jusqua(async () => (await A.etat().catch(() => null))?.connexion === "ouvert" && (await B.etat().catch(() => null))?.connexion === "ouvert", { ms: 60_000, quoi: "connexion WebSocket des deux joueurs" });
    // par défaut : l'arène ; les trois cartes du choix du mode (arène, zombies, Battle Royale) sont là, avec leurs compteurs
    const choix = await A.page.locator("input[type=radio][name$='-mode']").evaluateAll((l) => l.map((x) => ({ valeur: x.value, coche: x.checked })));
    verifier(choix.length === 3 && choix.find((c) => c.valeur === "arene")?.coche && ["arene", "zombies", "br"].every((v) => choix.some((c) => c.valeur === v)), `choix du mode inattendu : ${JSON.stringify(choix)}`);
    await jusqua(async () => (await A.etat()).salons, { ms: 8000, quoi: "message `salons` reçu (compteurs des modes)" });
    await A.capture("01-choix-mode-arene-1280");

    // Alice (la première) choisit les zombies : elle sera l'hôte ; puis Bob
    async function choisirZombies(j) {
      await j.page.getByRole("radio", { name: /Zombies tigres/ }).evaluate((e) => e.click());
      await jusqua(async () => { const e = await j.etat(); return e.mode === "zombies" && !!e.zombies?.joueurs?.some((x) => x.id === e.monId); }, { ms: 15_000, quoi: async () => `${j.nom} dans la salle des zombies (mode ${(await j.etat()).mode}, voulu ${(await j.etat()).modeVoulu})` });
      await j.page.locator("aside[aria-label='Zombies']").waitFor({ state: "visible", timeout: 8000 });
    }
    await choisirZombies(A);
    await choisirZombies(B);
    await jusqua(async () => (await A.partie())?.joueurs?.length === 2 && (await B.partie())?.joueurs?.length === 2, { ms: 10_000, quoi: "les deux joueurs dans le lobby des zombies" });
    const idA = await A.id(), idB = await B.id();
    const pa = await A.partie();
    verifier(pa.phase === "lobby", `phase ${pa.phase} au lieu de lobby`);
    verifier(pa.hote === idA, `l'hôte devrait être Alice (arrivée la première) : ${pa.hote}`);
    // ils se voient dans la liste, avec le badge « hôte »
    for (const j of joueurs) {
      const texte = (await j.page.locator("aside[aria-label='Zombies']").innerText()).replace(/\s+/g, " ");
      verifier(/Alice/.test(texte) && /Bob/.test(texte), `la liste du lobby ne montre pas les deux joueurs chez ${j.nom} : « ${texte.slice(0, 260)} »`);
      verifier(/hôte/i.test(texte), `badge « hôte » absent chez ${j.nom}`);
    }
    // le bouton « Lancer la partie » : actif pour l'hôte, désactivé pour l'autre
    const lancerA = A.page.getByRole("button", { name: /Lancer la partie/ });
    const lancerB = B.page.getByRole("button", { name: /Lancer la partie/ });
    await jusqua(async () => lancerA.isEnabled(), { ms: 8000, quoi: "bouton « Lancer la partie » actif chez l'hôte" });
    verifier(!(await lancerB.isEnabled()), "le bouton « Lancer la partie » est actif chez le second joueur");
    await A.capture("01-lobby-zombies-A-1280");
    await B.capture("01-lobby-zombies-B-1280");
    return `Alice hôte (${idA}), Bob (${idB}), compteurs « ${(await A.page.getByRole("radio", { name: /Zombies tigres/ }).locator("..").innerText()).replace(/\s+/g, " ").slice(0, 90)} »`;
  });
  if (!lobby) throw new Error("impossible d'ouvrir le lobby des zombies : scénario interrompu");


  // ------------------------------------------------------------------ gestes d'Alice (téléportations de la cour Centre)
  /**
   * Bob attend dans la cour Ouest, fermée par des portes tant qu'on n'a pas acheté P3 / P4 : les tigres, qui suivent le chemin le plus court vers
   * le joueur debout le plus proche, ne l'y trouvent pas (le serveur ne contrôle que les bornes et la vitesse, pas les murs). Alice est seule à fuir.
   */
  const ZONE_BOB = ZONE_BOB_DEHORS;
  /** Saut de Bob vers la cour Ouest, en cours après la relève (attendu à la fin de la manche). */
  let bobParti = Promise.resolve();
  /** Points sûrs d'Alice : les huit départs de l'open space. */
  const SPOTS = DEPARTS;
  /** Distance (m) du tigre le plus proche d'Alice ; 999 sans tigre. */
  async function menace() {
    const s = await A.jeu().catch(() => null);
    if (!s || !s.vivant) return 999;
    const tg = await tigresProches(A, plat(s.p));
    return tg.length ? tg[0].d : 999;
  }
  /** Alice saute au point sûr le plus éloigné des tigres (et à plus de `loinDe` m de là où elle est) : les tigres marchent à 3 m/s. */
  async function fuir({ loinDe = 6 } = {}) {
    const tg = await tigresProches(A, CENTRE_COUR);
    const moi = plat((await A.jeu()).p);
    let meilleur = null;
    for (const c of SPOTS) {
      if (dist(c, moi) < loinDe) continue;
      // un saut long dure plus (le serveur n'accepte que la vitesse permise) : à distance des tigres égale, le plus court
      const d = (tg.length ? Math.min(...tg.map((t) => dist([t.x, t.z], c))) : 999) - dist(c, moi) * 0.1;
      if (!meilleur || d > meilleur.d) meilleur = { c, d };
    }
    trace(`fuir → ${JSON.stringify((meilleur ?? { c: SPOTS[0] }).c)} depuis ${JSON.stringify(moi.map((x) => +x.toFixed(0)))}, tigres ${JSON.stringify(tg.map((t) => [+t.x.toFixed(0), +t.z.toFixed(0)]))}`);
    await aller(A, B, (meilleur ?? { c: SPOTS[0] }).c);
    trace('fuir terminé');
  }
  /** L'épée d'Alice est-elle tenue (tir maintenu) ? Elle enchaîne alors ses coups toutes les 0,85 s. */
  let epeeTenue = false;
  /**
   * Un tour de garde à l'épée : dès que le premier tigre est à 20 m, on appuie sur le tir et on le garde maintenu (une pression brève entre deux images
   * du rendu logiciel serait perdue ; les coups partent dans le vide tant qu'ils ne sont pas à portée, ils ne coûtent que la cadence), la visée suit
   * le plus proche à chaque tour. Renvoie l'état de jeu d'Alice.
   */
  async function suivreEpee() {
    const s = await A.jeu();
    if (!s || !s.vivant) return s;
    const [t1] = (s.zombies ?? []).map((t) => ({ ...t, d: dist([t.x, t.z], plat(s.p)) })).sort((a, b) => a.d - b.d);
    if (t1 && t1.d <= (epeeTenue ? 25 : 20)) {
      await viserTigre(A, t1);
      if (!epeeTenue) { trace(`épée maintenue : ${t1.id} à ${t1.d.toFixed(1)} m`); await A.touche("Souris0", true); epeeTenue = true; }
    } else if (epeeTenue) {
      await A.touche("Souris0", false);
      epeeTenue = false;
    }
    return s;
  }
  /**
   * Achat d'Alice : elle saute au point d'achat dès que les tigres en sont à plus de 22 m, appuie sur E et attend la réponse du serveur.
   * Renvoie le prix débité.
   */
  async function acheter(id, pos) {
    for (let essai = 0; ; essai++) {
      const tg = await tigresProches(A, pos);
      if (!tg.length || tg[0].d > 12) break;
      if (essai >= 6) throw new Error(`les tigres restent trop près de l'achat ${id} (${tg[0].d.toFixed(0)} m)`);
      await fuir();
      await dormir(500);
    }
    const depuis = Date.now();
    await aller(A, B, pos, 1.5);
    await dormir(400);
    await A.appui("KeyE", 150);
    const r = await jusqua(async () => A.msgs("achat", depuis).find((m) => m.id === id), { ms: 6000, quoi: async () => `réponse du serveur à l'achat ${id} (${A.resume(depuis)} ; p ${JSON.stringify((await A.jeu()).p.map((x) => +x.toFixed(1)))})` });
    verifier(r.ok, `achat ${id} refusé : ${JSON.stringify(r)}`);
    const debit = await jusqua(async () => A.msgs("argent", depuis).find((m) => m.motif === "achat"), { ms: 4000, quoi: () => `pas de débit pour ${id} : ${JSON.stringify(A.msgs("argent", depuis))}` });
    verifier(debit.delta < 0, `débit positif pour ${id} : ${JSON.stringify(debit)}`);
    return -debit.delta;
  }

  // ------------------------------------------------------------------ 2. lancement
  const enJeu = await etape("2. le second ne peut pas lancer, l'hôte lance : les deux entrent en jeu", async () => {
    const depuis = Date.now();
    // Bob essaie par le crochet : le serveur l'ignore (hôte seulement)
    await B.ev(() => window.__arene.lancerZombies());
    await dormir(1500);
    verifier((await A.partie()).phase === "lobby", "Bob a pu lancer la partie");
    verifier(!(await B.jeu()), "le jeu de Bob s'est monté alors que la partie n'est pas lancée");
    // Alice lance par le bouton
    await A.page.getByRole("button", { name: /Lancer la partie/ }).click();
    for (const j of joueurs) {
      await jusqua(async () => { const s = await j.jeu(); return s && s.apparu && s.vivant && s.mode === "zombies"; }, { ms: 60_000, quoi: async () => `${j.nom} en jeu (${j.resume(depuis)} ; partie ${JSON.stringify((await j.partie())?.phase)} ; erreurs ${j.erreurs.slice(0, 3).join(" | ")})` });
    }
    const p = await A.partie();
    verifier(p.phase === "pause" || p.phase === "manche", `phase ${p.phase} après le lancement`);
    verifier(p.joueurs.every((x) => x.admis && x.etat === "debout"), `joueurs non admis : ${JSON.stringify(p.joueurs)}`);
    for (const j of joueurs) {
      const s = await j.jeu();
      verifier(dist(plat(s.p), CENTRE_COUR) < 15, `${j.nom} apparu loin de l'open space : ${s.p.map((x) => x.toFixed(0))}`);
    }
    return `phase ${p.phase}, manche ${p.manche}, A à ${dist(plat((await A.jeu()).p), CENTRE_COUR).toFixed(0)} m du centre de l'open space`;
  });
  if (!enJeu) throw new Error("la partie ne démarre pas : scénario interrompu");

  // ------------------------------------------------------------------ 3. première arme au mur, avant l'arrivée des tigres
  // Les apparitions attendent que tous soient en jeu, puis 3 s de grâce, et le trajet depuis l'entrée dure plus de 8 s : on met ce temps à profit.
  await etape("3. achat d'une arme au mur (le fusil à pompe, 500 $) avant l'arrivée des tigres : débit confirmé par le serveur", async () => {
    // Bob file tout de suite dehors, hors de toute zone (hors d'atteinte des tigres) ; Alice achète le fusil à pompe dessiné à la craie
    const bobParti = aller(B, A, ZONE_BOB);
    const avant = (await A.jeu()).argent;
    verifier(avant === Number(ARGENT), `argent de départ ${avant} au lieu de ${ARGENT}`);
    verifier((await A.jeu()).slot !== "principale", "le joueur a une arme principale au départ");
    const prix = await acheter("mur:pompe", ACHAT_POMPE);
    verifier(prix === 500, `fusil à pompe à ${prix} $`);
    await bobParti;
    const slots = (await A.jeu()).slots;
    verifier(JSON.stringify(slots).includes("pompe"), `le fusil à pompe n'est pas dans les slots : ${JSON.stringify(slots)}`);
    const apres = (await A.jeu()).argent;
    verifier(apres === avant - 500, `argent ${avant} → ${apres}`);
    await A.capture("03-pompe-achetee-A-1280");
    return `${avant} → ${apres} $, slots ${JSON.stringify(slots).slice(0, 110)}`;
  });

  // ------------------------------------------------------------------ 4. tigres
  await etape("4. HUD de manche et d'argent, des tigres dans le snap des deux joueurs, manche 1", async () => {
    await aller(A, B, SPOTS[0]);
    // « JOUER » du menu pause = prise de la souris (émulée) : le HUD de combat n'existe qu'en jeu
    for (const j of joueurs) {
      await jusqua(async () => {
        if ((await j.jeu()).verrouille) return true;
        await j.page.getByRole("button", { name: /^jouer$/i }).first().evaluate((e) => e.click()).catch(() => null);
        return false;
      }, { ms: 15_000, quoi: `prise de la souris de ${j.nom}` });
    }
    for (const j of joueurs) {
      await j.page.locator("section[aria-label='Vague']").first().waitFor({ state: "visible", timeout: 8000 }).catch(() => { throw new Error(`HUD de manche (« Vague ») absent chez ${j.nom}`); });
      await j.page.locator("section[aria-label='Argent']").first().waitFor({ state: "visible", timeout: 8000 }).catch(() => { throw new Error(`HUD d'argent absent chez ${j.nom}`); });
    }
    for (const j of joueurs) await jusqua(async () => (await j.jeu()).zombies.length > 0, { ms: 60_000, pas: 200, quoi: async () => `tigres chez ${j.nom} (manche ${(await j.jeu()).manche}, restants ${(await j.jeu()).restants} ; partie ${JSON.stringify((await j.partie())?.phase)})` });
    const sa = await A.jeu(), sb = await B.jeu();
    verifier(sa.manche === 1, `manche ${sa.manche}`);
    verifier(sa.restants >= 1 && sa.restants <= Number(TOTAL), `${sa.restants} tigres restants à la manche 1 (${TOTAL} au plus)`);
    const t = sa.zombies[0];
    verifier(t.x >= 8 && t.x <= 214 && t.z >= -110 && t.z <= 24, `tigre hors des bornes : ${t.x},${t.z}`);
    await A.capture("04-tigres-A-1280");
    return `A voit ${sa.zombies.length} tigre(s), B ${sb.zombies.length}, ${sa.restants} restant(s) à tuer`;
  });

  // ------------------------------------------------------------------ 5. un tigre au pistolet
  await etape("5. un tigre abattu au pistolet : touches confirmées, argent crédité", async () => {
    const idA = await A.id();
    const depuis = Date.now();
    const argentAvant = (await A.jeu()).argent;
    for (const j of joueurs) await j.reduire(true);
    // l'open space est petit : Alice fuit les tigres pendant qu'elle sort le pistolet (un tigre sorti du sol peut déjà être à 8 m)
    if ((await menace()) < 9) await fuir();
    await jusqua(async () => {
      const s = await A.jeu();
      verifier(s && s.vivant, `Alice à terre avant le tir : ${A.resume(depuis)}`);
      if (s.slot === "secondaire") return true;
      if ((await menace()) < 9) await fuir();
      await A.appui("Digit2", 100);
      await dormir(600);
      return false;
    }, { ms: 30_000, pas: 50, quoi: "pistolet en main" });
    let tire = 0;
    const fin = Date.now() + 80_000;
    let tue = null;
    // comme dans BO1 : on tire les tigres pendant qu'ils arrachent les planches (immobiles derrière la fenêtre, les balles passent) ;
    // un tigre déjà entré est tiré tant qu'il est à plus de 4,5 m, sinon Alice fuit
    while (Date.now() < fin && !tue) {
      const s = await A.jeu();
      verifier(s && s.vivant, `Alice à terre pendant le tir : ${A.resume(depuis)}`);
      tue = A.msgs("zombieMort", depuis).find((m) => m.par === idA);
      if (tue) break;
      const tg = await tigresProches(A);
      if (!tg.length) { await dormir(200); continue; }
      const entres = tg.filter((t) => t.mode === "chasse" || t.mode === "saut");
      if (entres.length && entres[0].d < 4.5) { await fuir(); continue; }
      const aLaFenetre = tg.find((t) => t.mode === "fenetre");
      let cible = entres[0] ?? tg[0];
      if (aLaFenetre && !(entres.length && entres[0].d < 12)) {
        // se poster face à la fenêtre du tigre, 3 m à l'intérieur
        const f = FENETRES_OPEN.slice().sort((x, y) => dist(x.dehors, [aLaFenetre.x, aLaFenetre.z]) - dist(y.dehors, [aLaFenetre.x, aLaFenetre.z]))[0];
        if (dist(plat(s.p), f.poste) > 1.5) { trace(`poste devant ${f.id}`); await aller(A, B, f.poste, 1.5); continue; }
        cible = aLaFenetre;
      }
      if (s.slot !== "secondaire") { await A.appui("Digit2", 80); await dormir(700); continue; }
      if (s.munitions === 0) { await A.appui("KeyR", 80); await dormir(1700); continue; }
      trace(`tir sur ${cible.id} (${cible.mode}) à ${cible.d.toFixed(0)} m, tigres ${JSON.stringify(tg.map((t) => [+t.d.toFixed(0), t.mode]))}`);
      await viserTigre(A, cible);
      await A.appui("Souris0", 60);
      tire++;
      await dormir(170);
    }
    await fuir(); // les deux autres tigres arrivent
    verifier(tue, `aucun tigre abattu au pistolet en 80 s (${tire} tirs ; ${A.resume(depuis)} ; tigres ${JSON.stringify((await tigresProches(A)).map((t) => [t.id, +t.x.toFixed(0), +t.z.toFixed(0)]))})`);
    const touches = A.msgs("degats", depuis).filter((m) => typeof m.cible === "string" && m.cible.startsWith("z") && m.par === idA);
    verifier(touches.length >= 2 && touches.reduce((n, m) => n + m.degats, 0) >= 150, `touches confirmées sur des tigres insuffisantes pour un kill (150 PV) : ${JSON.stringify(touches)}`);
    verifier(touches.every((m) => m.degats > 0 && m.pv >= 0), `dégâts de tigre incohérents : ${JSON.stringify(touches.slice(0, 3))}`);
    const gains = A.msgs("argent", depuis).filter((m) => m.delta > 0);
    verifier(gains.some((m) => m.motif === "touche") && gains.some((m) => m.motif === "kill"), `gains inattendus : ${JSON.stringify(gains)}`);
    const argent = await jusqua(async () => { const a = (await A.jeu()).argent; return a > argentAvant ? a : false; }, { ms: 4000, quoi: "argent crédité côté client" });
    const somme = gains.reduce((n, m) => n + m.delta, 0);
    await A.capture("05-kill-pistolet-A-1280");
    return `${touches.length} touches confirmées (${touches.map((m) => m.degats).join("+")} dégâts), gains ${gains.map((m) => `${m.motif} +${m.delta}`).join(", ")} = +${somme} $ (${argentAvant} → ${argent} $), ${tire} tirs`;
  });

  // ------------------------------------------------------------------ 6. à terre, relève
  // Les tigres restants servent d'appât : Bob (hors d'atteinte jusque-là) saute près d'eux et reste immobile, ils le couchent. Alice, tenue à l'autre
  // bout de la cour, les laisse venir à 12 m puis saute à côté de Bob : il leur faut plus de temps pour revenir que les 3 s de la relève.
  await etape("6. un joueur à terre (griffes), relevé par l'autre en maintenant E (3 s)", async () => {
    const idB = await B.id();
    const depuis = Date.now();
    let tg = await tigresProches(A);
    verifier(tg.length >= 1, "plus aucun tigre : la manche est finie, pas d'appât pour la relève");
    // Alice sort de l'open space (dehors, hors de toute zone : aucun tigre n'y va) ; Bob saute à 3 m du tigre le plus proche, il devient
    // la seule cible des tigres
    await aller(A, B, ZONE_ALICE_DEHORS);
    tg = await tigresProches(A);
    const t = tg[0];
    const vers = DEPARTS[2];
    const n = dist([t.x, t.z], vers) || 1;
    const posB = [t.x + ((vers[0] - t.x) / n) * 3, t.z + ((vers[1] - t.z) / n) * 3];
    await aller(B, A, posB, 4);
    // Bob est couché par les tigres
    await jusqua(async () => (await B.moiPartie())?.etat === "terre", { ms: 25_000, pas: 200, quoi: async () => `Bob à terre (${B.resume(depuis)} ; tigres ${JSON.stringify((await tigresProches(A)).map((x) => [x.id, +x.x.toFixed(0), +x.z.toFixed(0)]))} ; Bob ${JSON.stringify((await B.jeu())?.p.map((x) => +x.toFixed(0)))})` });
    trace("Bob à terre");
    verifier(B.msgs("mort", depuis).length === 0, "un message `mort` (killcam) est parti pour un joueur à terre");
    await B.page.locator("section[aria-label='À terre']").waitFor({ state: "visible", timeout: 8000 }).catch(() => { throw new Error("l'écran « À terre » ne s'affiche pas chez Bob"); });
    await B.capture("06-a-terre-B-1280");
    const posBobMort = plat((await B.jeu()).p);
    // Alice sort le couteau (dehors, à l'abri) puis saute à côté de Bob
    await A.appui("Digit3", 100);
    await jusqua(async () => (await A.jeu()).slot === "couteau", { quoi: "couteau en main avant la relève" });
    await aller(A, B, [posBobMort[0] + 1.2, posBobMort[1]], 1.5);
    trace("Alice près de Bob", `tigres à ${(await tigresProches(A)).map((x) => x.d.toFixed(0))} m`);
    // E maintenu : pendant ces 3 s la garde à l'épée tourne déjà (les tigres reviennent)
    const t0 = Date.now();
    await A.touche("KeyE", true);
    try {
      await jusqua(async () => { await suivreEpee(); return (await B.moiPartie())?.etat === "debout"; }, { ms: 8000, pas: 50, quoi: async () => `Bob relevé (${A.resume(depuis)} ; envoyés ${JSON.stringify(A.envoyesDe("reanimer", depuis))} ; état de Bob ${JSON.stringify(await B.moiPartie())} ; tigres à ${JSON.stringify((await tigresProches(A)).map((x) => +x.d.toFixed(0)))} m)` });
    } finally {
      await A.touche("KeyE", false);
    }
    const duree = Date.now() - t0;
    // Bob file se mettre à l'abri dans la cour Ouest (fermée, les tigres n'y accèdent pas) ; pas d'attente ici : les tigres reviennent sur Alice
    bobParti = aller(B, A, ZONE_BOB).catch(() => null);
    verifier(duree >= 2500, `relève en ${duree} ms (3 s attendues)`);
    verifier(A.envoyesDe("reanimer", depuis).some((m) => m.cible === idB), `aucun message reanimer vers Bob : ${JSON.stringify(A.envoyesDe("reanimer", depuis))}`);
    const ma = await A.moiPartie();
    verifier(ma.reanimations >= 1, `compteur de relèves d'Alice : ${ma.reanimations}`);
    await jusqua(async () => (await B.jeu())?.vivant, { ms: 5000, quoi: "Bob de nouveau vivant côté client" });
    const sb = await B.jeu();
    verifier(sb.pv > 0 && sb.pv <= 60, `PV de Bob après la relève : ${sb.pv}`);
    return `Bob à terre puis relevé en ${(duree / 1000).toFixed(1)} s (PV ${sb.pv}), relèves d'Alice ${ma.reanimations}`;
  });

  // ------------------------------------------------------------------ 7. coup d'épée
  await etape("7. coups de couteau sur les tigres : cibles « z<n> » envoyées, dégâts de mêlée confirmés, kills, fin de manche (sans bonus) puis pause", async () => {
    const idA = await A.id();
    const depuis = Date.now() - 6000; // les premiers coups ont pu partir pendant la relève
    await jusqua(async () => { const s = await A.jeu(); return s.slot === "couteau" && s.arme === "couteau"; }, { quoi: async () => `couteau en main (slot ${(await A.jeu()).slot}, arme ${(await A.jeu()).arme})` });
    // La garde à l'épée tourne depuis la relève (étape 6) : on la poursuit jusqu'à la fin de la manche
    const fin = Date.now() + 90_000;
    let n = 0, dernierNCoups = 0;
    try {
      while (Date.now() < fin) {
        const s = await suivreEpee();
        verifier(s && s.vivant, `Alice à terre pendant le combat à l'épée : ${A.resume(depuis)}`);
        if (++n % 5 === 0 && (await A.partie())?.phase === "pause") break;
        const nCoups = A.envoyesDe("coup", depuis).length;
        if (nCoups !== dernierNCoups) { dernierNCoups = nCoups; trace(`coup n°${nCoups}, PV ${s.pv}`); }
        await dormir(40);
      }
    } finally {
      await A.touche("Souris0", false);
      epeeTenue = false;
    }
    await jusqua(async () => (await A.partie())?.phase === "pause", { ms: 5000, quoi: "la manche 1 s'achève (pause)" });
    const p = await A.partie();
    verifier(p.phase === "pause" && p.manche === 2, `la manche 1 ne s'achève pas : phase ${p.phase}, manche ${p.manche} (${A.resume(depuis)})`);
    const coups = A.envoyesDe("coup", depuis);
    const coupTigre = coups.find((c) => c.cibles.some((x) => /^z\d+$/.test(x)));
    verifier(coupTigre, `aucun message coup avec une cible de tigre : ${JSON.stringify(coups.slice(0, 3))}`);
    const degats = A.msgs("degats", depuis).filter((m) => typeof m.cible === "string" && m.cible.startsWith("z"));
    verifier(degats.some((m) => m.degats >= 150), `dégâts de couteau (150) non confirmés : ${JSON.stringify(degats.slice(0, 3))}`);
    const kills = A.msgs("zombieMort", depuis).filter((m) => m.par === idA);
    verifier(kills.length >= 1, "aucun tigre tué au couteau");
    const gains = A.msgs("argent", depuis).filter((m) => m.delta > 0);
    verifier(gains.some((m) => m.motif === "kill" && m.delta === 130), `gain de kill au couteau (130 $) absent : ${JSON.stringify(gains)}`);
    verifier(!gains.some((m) => m.motif === "manche"), `bonus de fin de manche inattendu (BO1 n'en donne pas) : ${JSON.stringify(gains)}`);
    verifier((await B.partie()).phase === "pause", "Bob ne voit pas la pause");
    await A.capture("07-couteau-A-1280");
    return `${coups.length} coup(s), cibles ${JSON.stringify(coupTigre.cibles)}, dégâts ${degats.map((m) => m.degats).join("+")}, ${kills.length} kill(s), gains ${gains.map((m) => `${m.motif} +${m.delta}`).join(", ")} ; pause avant la manche 2`;
  });

  // ------------------------------------------------------------------ 8. mini Uzi puis porte (pendant la pause)
  await etape("8. pendant la pause : porte D1 (750 $) : message `batiments` reçu par les deux, porte ouverte ; puis le mini Uzi derrière (il remplace le pistolet)", async () => {
    await bobParti;
    const argentAvant = (await A.jeu()).argent;
    const depuis = Date.now();
    const prixPorte = await acheter("D1", ACHAT_D1);
    verifier(prixPorte === 750, `porte D1 à ${prixPorte} $`);
    for (const j of joueurs) {
      const m = await jusqua(async () => j.msgs("batiments", depuis).find((x) => !x.complet && x.detruits?.length), { ms: 6000, quoi: `message batiments{detruits} reçu par ${j.nom}` });
      verifier(m.detruits.length >= 1, `batiments sans bâtiment détruit : ${JSON.stringify(m)}`);
    }
    const detruits = A.msgs("batiments", depuis).find((x) => !x.complet).detruits;
    const porte = await jusqua(async () => { const p = (await B.partie())?.portes?.find((x) => x.id === "D1"); return p?.ouverte ? p : false; }, { ms: 6000, quoi: "porte D1 ouverte dans l'état de la partie chez Bob" });
    const prixUzi = await acheter("mur:mini_uzi", ACHAT_UZI);
    verifier(prixUzi === 1000, `mini Uzi à ${prixUzi} $`);
    const slots = JSON.stringify((await A.jeu()).slots);
    verifier(/mini_uzi/.test(slots) && !/pistolet/.test(slots), `le mini Uzi devrait remplacer le pistolet : ${slots}`);
    const argentApres = (await A.jeu()).argent;
    await A.capture("08-porte-ouverte-A-1280");
    return `porte D1 ${prixPorte} $ + mini Uzi ${prixUzi} $ (${argentAvant} → ${argentApres} $), prismes détruits ${JSON.stringify(detruits)}, D1 ${JSON.stringify(porte)}`;
  });

  // ------------------------------------------------------------------ 9. partie perdue, retour au lobby
  await etape("9. partie perdue quand les deux sont à terre : bilan affiché, « Rejouer » ramène au lobby", async () => {
    // Alice et Bob s'immobilisent ensemble dans l'open space : les tigres de la manche 2 arrivent et les couchent
    await Promise.all([aller(A, B, SPOTS[0]), aller(B, A, [SPOTS[0][0] + 3, SPOTS[0][1] + 3])]);
    await jusqua(async () => (await A.partie())?.phase === "fin", { ms: 120_000, pas: 250, quoi: async () => `partie perdue (phase ${(await A.partie())?.phase} ; joueurs ${JSON.stringify((await A.partie())?.joueurs?.map((x) => [x.pseudo, x.etat]))} ; tigres ${JSON.stringify((await tigresProches(A)).map((x) => +x.d.toFixed(0)))})` });
    for (const j of joueurs) await j.reduire(false); // fenêtres à leur taille normale pour le bilan
    const fin = await A.partie();
    verifier(fin.joueurs.every((x) => x.etat !== "debout"), `des joueurs encore debout à la fin : ${JSON.stringify(fin.joueurs)}`);
    verifier(fin.bilan && fin.bilan.manche >= 1, `bilan absent ou sans manche : ${JSON.stringify(fin.bilan)}`);
    for (const j of joueurs) {
      await j.page.getByRole("heading", { name: "Partie perdue" }).waitFor({ state: "visible", timeout: 10_000 }).catch(() => { throw new Error(`bilan « Partie perdue » absent chez ${j.nom}`); });
    }
    const texte = (await A.page.locator("body").innerText()).replace(/\s+/g, " ");
    verifier(/Alice/.test(texte) && /Bob/.test(texte), "le bilan ne nomme pas les deux joueurs");
    await A.capture("09-bilan-A-1280");
    await B.capture("09-bilan-B-1280");
    // « Rejouer » : retour au lobby (le jeu se démonte), puis la salle repasse au lobby au bout du bilan (25 s)
    for (const j of joueurs) await j.page.getByRole("button", { name: "Rejouer" }).evaluate((e) => e.click());
    for (const j of joueurs) {
      await jusqua(async () => !(await j.jeu()) && !(await j.etat()).enArene, { ms: 10_000, quoi: `jeu démonté chez ${j.nom} après « Rejouer »` });
      await j.page.locator("aside[aria-label='Zombies']").waitFor({ state: "visible", timeout: 8000 });
    }
    await jusqua(async () => (await A.partie())?.phase === "lobby" && (await B.partie())?.phase === "lobby", { ms: 40_000, pas: 500, quoi: "la salle repasse au lobby au bout du bilan" });
    await jusqua(async () => A.page.getByRole("button", { name: /Lancer la partie/ }).isEnabled(), { ms: 8000, quoi: "« Lancer la partie » de nouveau actif pour l'hôte" });
    verifier((await A.partie()).joueurs.every((x) => !x.admis && x.etat === "attente"), `joueurs encore admis dans le lobby : ${JSON.stringify((await A.partie()).joueurs)}`);
    await A.capture("09-retour-lobby-A-1280");
    return `phase fin → lobby, bilan : manche ${fin.bilan.manche} en ${(fin.bilan.dureeMs / 1000).toFixed(0)} s`;
  });

  // ------------------------------------------------------------------ 10. erreurs
  await etape("10. aucune erreur JavaScript, aucun message `erreur` du serveur, aucune WebSocket coupée en partie", async () => {
    const bruit = (e) => /favicon|Failed to load resource|net::ERR|api\/pdj|api\/carte|GPU stall|WebGL|ReadPixels|swiftshader/i.test(e);
    const toutes = joueurs.flatMap((j) => j.erreurs.filter((e) => !bruit(e)).map((e) => `${j.nom} ${e}`));
    verifier(toutes.length === 0, toutes.slice(0, 6).join(" | "));
    const coupures = joueurs.flatMap((j) => j.fermetures.map((f) => `${j.nom} (étape « ${f.etape.slice(0, 40)} »)`));
    verifier(coupures.length === 0, `WebSocket coupée en cours de partie : ${coupures.join(" | ")}`);
    const serveurErreurs = joueurs.flatMap((j) => j.recus.filter((r) => r.t === "erreur").map((r) => `${j.nom} ${JSON.stringify(r.m)}`));
    verifier(serveurErreurs.length === 0, `messages d'erreur du serveur : ${serveurErreurs.join(" | ")}`);
  });
} catch (e) {
  console.error(`\nERREUR FATALE : ${e.stack ?? e}`);
  resultats.push({ nom: "infrastructure", ok: false, erreur: e.message });
} finally {
  try { await navigateur?.close(); } catch { /* fermé */ }
  if (!process.env.E2E_GARDER) toutArreter();
  const ko = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - ko.length}/${resultats.length} étapes OK`);
  writeFileSync(join(SORTIE, "resultats.json"), JSON.stringify(resultats, null, 2));
  for (const r of ko) console.log(`  ÉCHEC ${r.nom} : ${r.erreur}`);
  process.exitCode = ko.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 500).unref();
}
