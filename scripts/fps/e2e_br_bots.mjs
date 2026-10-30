#!/usr/bin/env node
/**
 * Test de bout en bout du Battle Royale SOLO AVEC BOTS de l'arène FPS (vue Palantir) : UN navigateur Chromium headless (Alice) contre un `serveur-fps` local aux
 * durées raccourcies et au mode d'essai DÉTERMINISTE `PDJ_FPS_BR_BOTS_ESSAI=agressif` (graine fixe : les bots attendent qu'un humain soit au sol, réapparaissent à
 * 20–80 m de lui avec une mitraillette et ne s'attaquent qu'à lui), et un `next dev` local, pilotés par `window.__arene`. Spec :
 * docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md (lot 6).
 *
 * Scénario (chaque étape imprime OK / ÉCHEC, des captures sont prises en route) :
 *  1. vue 3D (code « myrtille »), choix du mode « Battle Royale », lobby d'Alice seule : réglage « Bots » (11 par défaut seule), « Lancer la partie » actif
 *  2. Alice lance par le bouton : 11 bots dans la présence (ids `b<n>`, `bot: true`), décompte puis avion, le jeu se monte
 *  3. saut et atterrissage d'Alice ; les bots sont dans le snap (ids `b<n>`) et le tigre bipède armé est CAPTURÉ (1280×720 dans E2E_OUT)
 *  4. un bot blesse Alice (`degats` d'un `b<n>`, tirs diffusés avec `ts`), puis la tue (`mort` : tueur-bot, `soin` aucun, étiquette [BOT] au tableau des scores)
 *  5. killcam sur un bot : rejeu à la vue du bot (`vue.sujet` = id du bot, aucun lien vocal proposé), puis écran « Spectateur »
 *  6. plus aucun humain en vie : la partie se termine d'elle-même (15 s plus tard), bilan avec lignes BOT et « Entraînement : partie non comptée »
 *  7. statistiques : `GET /stats-br` reste vide (une partie avec bots ne compte jamais) ; `/sante.br` ne compte que des humains ; retour au lobby, bots retirés
 *  8. aucune erreur JavaScript ni `erreur` du serveur, aucune WebSocket coupée en partie
 *
 * Usage : node scripts/fps/e2e_br_bots.mjs        (Node 22 ; Playwright : `npm i --no-save playwright` ou PLAYWRIGHT_DIR=/dossier/avec/node_modules)
 * Variables : E2E_OUT (captures en 1280×720, défaut <tmp>/pdj-e2e-br-bots), E2E_URL (Next déjà lancé), E2E_WS (serveur déjà lancé : il doit avoir les variables
 *             d'essai PDJ_FPS_BR_* dont `PDJ_FPS_BR_BOTS_ESSAI=agressif`), E2E_WS_PORT (port imposé au serveur lancé par le script, à faire coïncider avec
 *             NEXT_PUBLIC_FPS_WS_URL d'un Next déjà lancé), E2E_PAGE (page qui monte le code « myrtille », défaut une 404 : aucune lecture de la base),
 *             E2E_HEADED=1, E2E_GARDER=1 (laisse les serveurs lancés par le script), E2E_DEBUG=1 (trace), E2E_NIVEAU (difficulté des bots : entree | plat | goulaf,
 *             défaut entree : le débutant laisse le temps de capturer le tigre avant de tuer Alice), E2E_DECOMPTE (plafond du décompte, ms, défaut 45000 : il se termine
 *             dès qu'Alice a rejoint), E2E_STATS (fichier des statistiques du serveur lancé par le script, défaut <E2E_OUT>/stats-br.json, supprimé au départ).
 * Code de sortie : 0 si toutes les étapes passent, 1 sinon.
 *
 * À savoir : la chute est simulée par le serveur en temps réel, donc indépendante des 2–10 images/s du rendu logiciel ; la fenêtre est réduite en partie (480×270)
 * et agrandie le temps d'une capture ; le verrouillage du pointeur, absent en headless, est émulé ; le serveur n'utilise jamais le port 8787 ; Alice ne bouge
 * plus après l'atterrissage (les bots viennent à elle) ; un `next dev` à froid recharge les pages ouvertes.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SORTIE = process.env.E2E_OUT ?? join(tmpdir(), "pdj-e2e-br-bots");
const PAGE = process.env.E2E_PAGE ?? "/arene-e2e-introuvable";
const NIVEAU = process.env.E2E_NIVEAU ?? "entree";
const DECOMPTE = process.env.E2E_DECOMPTE ?? "45000";
const FICHIER_STATS = process.env.E2E_STATS ?? join(SORTIE, "stats-br.json");
const ESTBOT = /^b\d+$/;

// ---------------------------------------------------------------------------------------------------------------- utilitaires

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const trace = (...a) => { if (process.env.E2E_DEBUG) console.log(`    [${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const plat = (p) => [p[0], p[2]];
const arrondi = (p) => p.map((x) => +x.toFixed(1));

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
  msgs(t, depuis = 0) { return this.recus.filter((r) => r.t === t && r.a >= depuis).map((r) => r.m); }
  envoyesDe(t, depuis = 0) { return this.envoyes.filter((r) => r.t === t && r.a >= depuis).map((r) => r.m); }
  resume(depuis = 0) {
    const compte = (l) => { const c = {}; for (const r of l) if (r.a >= depuis && !["etat", "snap", "ping", "pong", "chute", "presence"].includes(r.t)) c[r.t] = (c[r.t] ?? 0) + 1; return JSON.stringify(c); };
    return `${this.nom} ↑${compte(this.envoyes)} ↓${compte(this.recus)}`;
  }
  touche(code, bas) { return this.ev(([c, b]) => window.__arene.touche(c, b), [code, bas]); }
  /** Tient une touche jusqu'à ce que `fait` devienne vrai (un appui bref serait perdu entre deux images du rendu logiciel), puis la relâche. */
  async tenir(code, fait, opts = {}) {
    await this.touche(code, true);
    try { return await jusqua(fait, opts); } finally { await this.touche(code, false); }
  }
  /** Fenêtre réduite pendant la partie : le rendu logiciel d'une grande fenêtre est trop lent pour un avion de 12 s. */
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
  async partie() { return (await this.etat()).br?.etat ?? null; }
}

/** Bots du snap de `j` : { id, p, vivant, arme }, du plus proche au plus loin d'`origine`. */
async function botsVus(j, origine) {
  const s = await j.jeu();
  return (s?.distants ?? []).filter((d) => ESTBOT.test(d.id)).sort((a, b) => dist(plat(a.p), plat(origine)) - dist(plat(b.p), plat(origine)));
}

// ---------------------------------------------------------------------------------------------------------------- étapes

const resultats = [];
let participants = [];
async function etape(nom, fn) {
  if (process.env.E2E_JUSQUA && parseInt(nom, 10) > Number(process.env.E2E_JUSQUA)) return true;
  const numero = nom.split(".")[0];
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
    if (existsSync(FICHIER_STATS)) rmSync(FICHIER_STATS);
    const srv = lancer("serveur-fps", process.execPath, ["dist/index.js"], {
      cwd: join(RACINE, "serveur-fps"),
      env: {
        ...process.env, PORT: String(portWs), SCENE_JSON: join(RACINE, "public/agroparc/scene.json"),
        PDJ_FPS_POLICE: "off", PDJ_FPS_BR_DECOMPTE_MS: DECOMPTE, PDJ_FPS_BR_VOL_MS: "12000", PDJ_FPS_BR_ALTITUDE: "140", PDJ_FPS_BR_OBJETS: "300", PDJ_FPS_BR_FIN_MS: "20000",
        PDJ_FPS_BR_VALIDE_MS: "5000", PDJ_FPS_BR_STATS: FICHIER_STATS, PDJ_FPS_BR_BOTS_ESSAI: "agressif", PDJ_FPS_CREATION_TIC_MAX_MS: "1000",
      },
    });
    await attendreHttp(`http://localhost:${portWs}/sante`, 20_000, "serveur-fps").catch((e) => { throw new Error(`${e.message}\n${srv.journal.join("")}`); });
  }
  const urlHttp = urlWs.replace(/^ws/, "http");
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
  console.log(`Serveur ${urlWs} · site ${urlNext}${PAGE} · captures ${SORTIE} · niveau des bots ${NIVEAU}\n`);

  // --- navigateur
  navigateur = await chromium.launch({
    headless: !process.env.E2E_HEADED,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await navigateur.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    // l'aide des commandes du premier lancement couvrirait les captures
    try { localStorage.setItem("pdj-fps-aide-vue", "1"); } catch { /* stockage indisponible */ }
    // Chromium headless n'accorde pas le verrouillage du pointeur : on l'émule (même contrat que l'API, sans mouvements de souris)
    let verrou = null;
    Object.defineProperty(Document.prototype, "pointerLockElement", { get: () => verrou, configurable: true });
    Element.prototype.requestPointerLock = function () { verrou = this; queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange"))); return Promise.resolve(); };
    Document.prototype.exitPointerLock = function () { verrou = null; document.dispatchEvent(new Event("pointerlockchange")); };
  });
  const A = new Joueur("Alice", await ctx.newPage());
  participants = [A];
  let idA;
  let atterri = null;

  // ------------------------------------------------------------------ 1. lobby seul, réglage des bots
  const lobby = await etape("1. vue 3D (code « myrtille »), choix de « Battle Royale » par Alice seule : réglage « Bots » (11), « Lancer la partie » actif", async () => {
    const ouvert = () => A.ev(() => !!window.__arene && !!document.querySelector("aside[aria-label='Arène'], aside[aria-label='Zombies'], aside[aria-label='Battle Royale']")).catch(() => false);
    async function ouvrir() {
      await A.page.goto(`${urlNext}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await dormir(2500); // hydratation
      await A.page.keyboard.type("myrtille", { delay: 60 });
      const bouton = A.page.getByRole("button", { name: /^Arène/ }).first();
      if (!(await bouton.waitFor({ state: "visible", timeout: 60_000 }).then(() => true, () => false))) return;
      await bouton.evaluate((e) => e.click()).catch(() => null);
      const champ = A.page.getByLabel("Nom de joueur");
      if (await champ.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false)) await champ.fill(A.nom).catch(() => null);
    }
    let stable = 0;
    for (let tour = 1; tour <= 8 && stable < 2; tour++) {
      if (!(await ouvert())) { stable = 0; await ouvrir(); } else { stable++; await dormir(2500); }
    }
    verifier(stable >= 2, "la vue Palantir et le panneau d'entrée ne restent pas ouverts");
    await jusqua(async () => (await A.etat().catch(() => null))?.connexion === "ouvert", { ms: 60_000, quoi: "connexion WebSocket d'Alice" });
    await jusqua(async () => (await A.etat()).salons, { ms: 8000, quoi: "message `salons` reçu" });
    await A.page.getByRole("radio", { name: /Battle Royale/ }).evaluate((e) => e.click());
    await jusqua(async () => { const e = await A.etat(); return e.mode === "br" && !!e.br?.etat?.joueurs?.some((x) => x.id === e.monId); }, { ms: 15_000, quoi: async () => `Alice dans la salle du Battle Royale (mode ${(await A.etat()).mode})` });
    await A.page.locator("aside[aria-label='Battle Royale']").waitFor({ state: "visible", timeout: 8000 });
    idA = await A.id();
    const pa = await A.partie();
    verifier(pa.phase === "lobby" && pa.hote === idA, `phase ${pa.phase}, hôte ${pa.hote}`);
    // le serveur publie le plafond des bots dans salons.listes.br : le réglage apparaît, 11 par défaut pour un joueur seul
    const reglage = A.page.locator("aside[aria-label='Battle Royale'] fieldset", { hasText: "Bots" });
    await reglage.waitFor({ state: "visible", timeout: 10_000 }).catch(() => { throw new Error("le réglage « Bots » n'apparaît pas dans le lobby du Battle Royale"); });
    const valeur = (await reglage.locator("output").first().innerText()).trim();
    verifier(valeur === "11", `nombre de bots par défaut ${valeur} (11 attendus seul dans le lobby)`);
    // niveau des bots : radios « Entrée / Plat du jour / Goulaf »
    const niveaux = await reglage.locator("input[type=radio]").evaluateAll((l) => l.map((x) => x.value));
    verifier(niveaux.length === 3, `niveaux des bots : ${JSON.stringify(niveaux)}`);
    await reglage.locator(`input[type=radio][value='${NIVEAU}']`).evaluate((e) => e.click());
    const lancerA = A.page.getByRole("button", { name: /Lancer la partie/ });
    await jusqua(async () => lancerA.isEnabled(), { ms: 8000, quoi: "bouton « Lancer la partie » actif pour Alice seule avec 11 bots" });
    await A.capture("01-lobby-bots-1280");
    await A.reduire(true);
    return `Alice hôte (${idA}), ${valeur} bots, niveaux ${niveaux.join("/")}, niveau choisi ${NIVEAU}`;
  });
  if (!lobby) throw new Error("impossible d'ouvrir le lobby du Battle Royale : scénario interrompu");

  // ------------------------------------------------------------------ 2. lancement
  const enVol = await etape("2. Alice lance : 11 bots dans la présence (ids `b<n>`, `bot: true`), décompte puis avion, le jeu se monte", async () => {
    const depuis = Date.now();
    await A.reduire(false);
    await A.page.getByRole("button", { name: /Lancer la partie/ }).evaluate((e) => e.click());
    await A.reduire(true);
    await jusqua(async () => { const s = await A.jeu(); return s && s.mode === "br" && s.vol?.phase === "avion"; }, { ms: 120_000, quoi: async () => `Alice dans l'avion (${A.resume(depuis)} ; phase ${JSON.stringify((await A.partie())?.phase)} ; erreurs ${A.erreurs.slice(0, 3).join(" | ")})` });
    const refus = A.msgs("refus", depuis);
    verifier(refus.length === 0, `refus reçus : ${JSON.stringify(refus)}`);
    const p = await A.partie();
    verifier(p.total === 12, `partants : ${p.total} (1 humain + 11 bots attendus)`);
    const presence = (await A.etat()).joueurs ?? [];
    const bots = presence.filter((j) => j.bot === true);
    verifier(bots.length === 11 && bots.every((b) => ESTBOT.test(b.id)), `présence : ${bots.length} bots aux ids ${JSON.stringify(bots.map((b) => b.id))}`);
    verifier(presence.find((j) => j.id === idA)?.bot === undefined, "Alice marquée comme bot");
    // la partie avec bots est signalée non comptée dès le décompte (affichage du lobby / de l'écran)
    const s = await (await fetch(`${urlHttp}/sante`)).json();
    verifier(s.br.joueurs === 1 && s.br.bots === 11, `/sante.br : joueurs ${s.br.joueurs}, bots ${s.br.bots} (1 humain et 11 bots attendus)`);
    return `12 partants, bots ${bots.map((b) => b.id).slice(0, 3).join(",")}…, /sante.br ${JSON.stringify({ joueurs: s.br.joueurs, bots: s.br.bots })}`;
  });
  if (!enVol) throw new Error("la partie ne démarre pas : scénario interrompu");

  // ------------------------------------------------------------------ 3. saut, atterrissage, bots dans le snap, captures
  await etape("3. saut et atterrissage d'Alice, les bots sont dans le snap : tigre bipède armé capturé en 1280×720", async () => {
    const depuis = Date.now() - 30_000;
    await A.tenir("Space", async () => (await A.jeu()).vol.phase !== "avion", { ms: 30_000, pas: 40, quoi: "Alice quitte l'avion" });
    await jusqua(async () => (await A.jeu()).vol.phase === "sol", { ms: 70_000, pas: 100, quoi: async () => `atterrissage d'Alice (vol ${JSON.stringify((await A.jeu()).vol)})` });
    atterri = await jusqua(async () => A.msgs("atterri", depuis)[0], { ms: 8000, quoi: "message `atterri` reçu" });
    // « JOUER » du menu pause = prise de la souris (émulée) : sans elle le menu pause couvre les écrans de mort et de spectateur
    await jusqua(async () => {
      if ((await A.jeu()).verrouille) return true;
      await A.page.getByRole("button", { name: /^jouer$/i }).first().evaluate((e) => e.click()).catch(() => null);
      return false;
    }, { ms: 15_000, quoi: "prise de la souris d'Alice" });
    // des bots apparaissent près d'elle (essai agressif : 20 à 80 m) et sont dans le snap ; on agrandit la fenêtre (plus d'avion à tenir) pour les captures
    await A.reduire(false);
    const moi = await A.jeu();
    const proches = await jusqua(async () => { const l = await botsVus(A, (await A.jeu()).p); return l.length >= 1 ? l : false; }, { ms: 30_000, pas: 200, quoi: async () => `un bot dans le snap d'Alice (distants ${JSON.stringify((await A.jeu()).distants.map((d) => d.id))})` });
    // on se tourne vers le bot posé au sol le plus proche (sinon le plus proche) et on le capture en 1280×720 : tigre bipède, tête à ~2 m, arme en main
    const auSol = await jusqua(async () => {
      const s = await A.jeu();
      const l = (await botsVus(A, s.p)).filter((b) => b.vivant && b.p[1] < 1.5);
      return l[0] ?? false;
    }, { ms: 25_000, pas: 200, quoi: "" }).catch(() => null);
    const cible = auSol ?? proches[0];
    await A.ev(([x, z]) => {
      const o = window.__arene.etat().jeu.oeil;
      window.__arene.regarder(Math.atan2(-(x - o[0]), -(z - o[2])), 0);
    }, [cible.p[0], cible.p[2]]);
    await dormir(1200);
    await A.capture("03-bot-bipede-arme-1280");
    const armes = new Set();
    for (const b of await botsVus(A, moi.p)) if (b.arme) armes.add(b.arme);
    return `atterrie en ${JSON.stringify(arrondi(plat(atterri.p)))}, ${proches.length} bot(s) en vue, capture de ${cible.id} à ${dist(plat(cible.p), plat((await A.jeu()).p)).toFixed(0)} m (${auSol ? "au sol" : "en l'air"}), armes vues ${[...armes].join("+") || "aucune"}`;
  });

  // ------------------------------------------------------------------ 4. un bot blesse puis tue Alice
  let mort = null;
  await etape("4. un bot blesse Alice (`degats` d'un `b<n>`, tirs diffusés avec `ts`) puis la tue (`mort` : tueur-bot)", async () => {
    const depuis = Date.now() - 60_000;
    const degats = await jusqua(async () => A.msgs("degats").find((d) => d.cible === idA && ESTBOT.test(d.par)), { ms: 90_000, pas: 200, quoi: async () => { const s = await A.jeu(); return `dégâts d'un bot sur Alice (${A.resume(depuis)} ; pv ${s.pv} ; bots ${JSON.stringify((await botsVus(A, s.p)).slice(0, 3).map((b) => [b.id, Math.round(dist(plat(b.p), plat(s.p)))]))})`; } });
    verifier(A.msgs("tir").some((m) => ESTBOT.test(m.id) && typeof m.ts === "number"), "aucun tir de bot diffusé avec ts");
    mort = await jusqua(async () => A.recus.find((r) => r.t === "mort" && r.m.cible === idA), { ms: 120_000, pas: 250, quoi: async () => `mort d'Alice (pv ${(await A.jeu()).pv}, vivant ${(await A.jeu()).vivant})` });
    verifier(ESTBOT.test(mort.m.par), `tueur ${mort.m.par} : pas un bot`);
    verifier(mort.m.tueur && mort.m.tueur.id === mort.m.par && !mort.m.tueur.stats, `info du tueur-bot : ${JSON.stringify(mort.m.tueur)} (id du bot, aucune statistique)`);
    return `dégât ${degats.degats} de ${degats.par} (${degats.zone}), tuée par ${mort.m.par} « ${mort.m.tueur?.pseudo} »`;
  });

  // ------------------------------------------------------------------ 5. killcam sur un bot, spectateur
  await etape("5. killcam sur un bot (vue du bot, aucun lien vocal), puis écran « Spectateur »", async () => {
    verifier(mort, "pas de mort d'Alice");
    const kc = await jusqua(async () => (await A.jeu()).killcam && (await A.jeu()).vue?.sujet === mort.m.par ? (await A.jeu()) : false, { ms: 40_000, pas: 150, quoi: async () => `killcam à la vue du bot ${mort.m.par} (killcam ${JSON.stringify((await A.jeu()).killcam)}, vue ${JSON.stringify((await A.jeu()).vue?.sujet)})` });
    await A.capture("05-killcam-bot-1280");
    const texte = (await A.page.locator("body").innerText()).replace(/\s+/g, " ");
    verifier(!/parler à votre tueur|parler au tueur/i.test(texte), "un lien vocal vers le tueur-bot est proposé");
    verifier(/\[BOT\]/.test(texte), `l'étiquette [BOT] n'apparaît nulle part à la killcam : « ${texte.slice(0, 200)} »`);
    await A.page.locator("section[aria-label='Spectateur']").waitFor({ state: "visible", timeout: 60_000 }).catch(() => { throw new Error("l'écran « Spectateur » ne s'affiche pas"); });
    const apparitions = A.recus.filter((r) => r.t === "apparition" && r.a > mort.a).length;
    verifier(apparitions === 0, `Alice a reçu ${apparitions} apparition(s) après sa mort`);
    const s = await A.jeu();
    verifier(s.vivant === false && s.spectateur?.actif, `vivant ${s.vivant}, spectateur ${JSON.stringify(s.spectateur)}`);
    await A.capture("05-spectateur-1280");
    return `vue du bot ${kc.vue.sujet}, spectateur suit ${JSON.stringify(s.spectateur?.suivi)}, apparitions reçues ${apparitions}`;
  });

  // ------------------------------------------------------------------ 6. fin de partie sans humain en vie
  const fin = await etape("6. plus aucun humain en vie : fin de partie d'elle-même (15 s), bilan avec lignes BOT, « Entraînement : partie non comptée »", async () => {
    const f = await jusqua(async () => A.msgs("br").find((m) => m.etat.phase === "fin" && m.etat.bilan), { ms: 60_000, pas: 300, quoi: async () => `phase de fin (phase ${(await A.partie())?.phase})` });
    verifier(f.etat.nonComptee === true, "la partie avec bots n'est pas marquée nonComptee");
    const lignes = f.etat.bilan.lignes ?? [];
    const nbBots = lignes.filter((l) => l.bot === true).length;
    verifier(nbBots === 11 && lignes.find((l) => l.id === idA)?.bot === undefined, `lignes BOT du bilan : ${nbBots} (11 attendues), ligne d'Alice ${JSON.stringify(lignes.find((l) => l.id === idA))}`);
    // la fin précède de ≈ 15 s la dernière mort humaine (pas plusieurs minutes de tempête pour rien)
    const delai = (A.recus.find((r) => r.m === f).a - mort.a) / 1000;
    verifier(delai < 40, `${delai.toFixed(0)} s entre la mort d'Alice et la fin (15 s attendues + killcam)`);
    const texte = (await A.page.locator("body").innerText()).replace(/\s+/g, " ");
    verifier(/Entraînement : partie non comptée/.test(texte), `le bilan ne dit pas « Entraînement : partie non comptée » : « ${texte.slice(0, 240)} »`);
    verifier(/\[BOT\]/.test(texte), "l'étiquette [BOT] est absente du bilan");
    await A.capture("06-bilan-bots-1280");
    return `fin ${delai.toFixed(0)} s après la mort d'Alice, ${nbBots} lignes BOT, place ${JSON.stringify(f.etat.bilan.lignes.find((l) => l.id === idA)?.place)}`;
  });

  // ------------------------------------------------------------------ 7. aucune statistique, retour au lobby
  await etape("7. `GET /stats-br` vide (partie non comptée), `/sante.br` ne compte que des humains, retour au lobby sans bots", async () => {
    verifier(fin, "pas de fin de partie");
    const r = await fetch(`${urlHttp}/stats-br`);
    const { lignes } = await r.json();
    verifier(Array.isArray(lignes) && lignes.length === 0, `statistiques écrites : ${JSON.stringify(lignes)}`);
    await A.page.getByRole("button", { name: "Rejouer" }).evaluate((e) => e.click()).catch(() => null);
    await jusqua(async () => (await A.partie())?.phase === "lobby", { ms: 40_000, pas: 400, quoi: async () => `la salle repasse au lobby (phase ${(await A.partie())?.phase})` });
    const s = await (await fetch(`${urlHttp}/sante`)).json();
    verifier(s.br.bots === 0 && s.br.joueurs === 1, `/sante.br après le retour au lobby : joueurs ${s.br.joueurs}, bots ${s.br.bots}`);
    const bots = ((await A.etat()).joueurs ?? []).filter((j) => j.bot);
    verifier(bots.length === 0, `bots encore présents : ${JSON.stringify(bots.map((b) => b.id))}`);
    return "aucune statistique, bots retirés";
  });

  // ------------------------------------------------------------------ 8. erreurs
  await etape("8. aucune erreur JavaScript, aucun message `erreur` du serveur, aucune WebSocket coupée en partie", async () => {
    const bruit = (e) => /favicon|Failed to load resource|net::ERR|api\/pdj|api\/carte|GPU stall|WebGL|ReadPixels|swiftshader/i.test(e);
    const toutes = A.erreurs.filter((e) => !bruit(e)).map((e) => `${A.nom} ${e}`);
    verifier(toutes.length === 0, toutes.slice(0, 6).join(" | "));
    verifier(A.fermetures.length === 0, `WebSocket coupée en cours de partie : ${A.fermetures.map((f) => f.etape.slice(0, 40)).join(" | ")}`);
    const serveurErreurs = A.recus.filter((r) => r.t === "erreur").map((r) => JSON.stringify(r.m));
    verifier(serveurErreurs.length === 0, `messages d'erreur du serveur : ${serveurErreurs.join(" | ")}`);
  });
} catch (e) {
  console.error(`\nERREUR FATALE : ${e.stack ?? e}`);
  resultats.push({ nom: "infrastructure", ok: false, erreur: e.message });
} finally {
  try { await navigateur?.close(); } catch { /* fermé */ }
  for (const e of enfants) { try { writeFileSync(join(SORTIE, `${e.nom}.log`), e.journal.join("")); } catch { /* sortie indisponible */ } }
  if (!process.env.E2E_GARDER) toutArreter();
  const ko = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - ko.length}/${resultats.length} étapes OK`);
  writeFileSync(join(SORTIE, "resultats.json"), JSON.stringify(resultats, null, 2));
  for (const r of ko) console.log(`  ÉCHEC ${r.nom} : ${r.erreur}`);
  process.exitCode = ko.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 500).unref();
}
