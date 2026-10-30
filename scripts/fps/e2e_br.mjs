#!/usr/bin/env node
/**
 * Test de bout en bout du mode Battle Royale de l'arène FPS (vue Palantir) : TROIS navigateurs Chromium headless (Alice l'hôte, Bob, Cora) contre un
 * `serveur-fps` local aux durées raccourcies (décompte plafonné, avion 12 s, altitude 140 m, zone à l'échelle 0,5, 300 objets, partie comptée dès
 * quelques secondes, statistiques dans un fichier temporaire) et un `next dev` local, pilotés par `window.__arene`.
 *
 * Scénario (chaque étape imprime OK / ÉCHEC, des captures sont prises en route) :
 *  1. vue 3D (code « myrtille »), les trois cartes de mode, choix du mode « Battle Royale » par les trois joueurs, lobby : liste, badge « hôte », bouton
 *     « Lancer la partie » actif pour l'hôte seulement (v11 : seule, Alice peut lancer avec 11 bots ; à zéro bot le bouton se grise et le dit)
 *  2. Bob ne peut pas lancer (le minimum de deux joueurs est testé à l'étape 1), l'hôte lance : décompte écourté quand tous ont rejoint, les trois montent dans l'avion
 *  3. saut (Alice et Bob au milieu du trajet, Cora éjectée à l'arrivée) et atterrissage : message `saut`, entrées `chute`, parachute, message `atterri`,
 *     invulnérabilité d'atterrissage
 *  4. ramassage d'une arme par Alice (téléportation par sauts de 40 m) : `ramasse{ok}`, objet retiré du sol, arme dans son slot et en main
 *  5. Alice tue Bob au couteau (3 coups de 34 ; Bob la frappe d'abord, pour montrer le plafond de +50 PV) : `mort`, `soin{kill}` plafonné à 100 PV
 *  6. Bob, éliminé : killcam puis spectateur, jamais de réapparition
 *  7. la tempête : dégâts hors zone sans tueur, mort de Cora par la tempête (cause `tempete`)
 *  8. victoire d'Alice : phase `fin`, un seul vainqueur, partie comptée
 *  9. écran de fin (TOP 1 pour Alice), relecture de `GET /stats-br` (TOP 1 d'Alice +1, parties +1 pour les trois)
 * 10. « Rejouer » ramène au lobby, la salle repasse au lobby
 * 11. aucune erreur JavaScript ni `erreur` du serveur, aucune WebSocket coupée en partie
 *
 * Usage : node scripts/fps/e2e_br.mjs        (Node 22 ; Playwright : `npm i --no-save playwright` ou PLAYWRIGHT_DIR=/dossier/avec/node_modules)
 * Variables : E2E_OUT (captures, défaut <tmp>/pdj-e2e-br), E2E_URL (Next déjà lancé : on ne le démarre pas), E2E_WS (serveur déjà lancé : il doit avoir les
 *             variables d'essai PDJ_FPS_BR_* ; les statistiques sont alors lues en différence), E2E_WS_PORT (port imposé au serveur lancé par le script, à
 *             faire coïncider avec NEXT_PUBLIC_FPS_WS_URL d'un Next déjà lancé), E2E_PAGE (page qui monte le code « myrtille », défaut une 404 : aucune
 *             lecture de la base), E2E_HEADED=1, E2E_GARDER=1 (laisse les serveurs lancés par le script), E2E_JUSQUA=5 (s'arrête après l'étape 5),
 *             E2E_SEULES=3,4 (ne joue que ces étapes ; la 1 et la 2 sont toujours jouées), E2E_DEBUG=1 (trace des gestes),
 *             E2E_ZONE_ECHELLE (échelle de durée de la zone, défaut 0.5 : la tempête dure ≈ 270 s, le 6b (venir regarder) tient même sous un rendu lent ; 0.08 ≈ 43 s est trop court sous le rendu
 *             logiciel), E2E_VALIDE (durée minimale d'une partie comptée, ms, défaut 5000), E2E_DECOMPTE (plafond du décompte, ms, défaut 45000 : il
 *             se termine dès que les trois ont rejoint), E2E_FIN (affichage de la fin avant le retour au lobby, ms, défaut 40000), E2E_STATS (fichier des statistiques du serveur lancé
 *             par le script, défaut <E2E_OUT>/stats-br.json, supprimé au départ).
 * Code de sortie : 0 si toutes les étapes passent, 1 sinon.
 *
 * Stratégie : Cora ne saute pas (éjection forcée à l'arrivée de l'avion : elle atterrit au bord de la carte, loin du centre de la zone) et ne bouge plus :
 * la tempête la tue ; Alice et Bob sautent à mi-trajet de l'avion (près du centre) et se rassemblent près du centre de la prochaine zone. Alice se tient
 * ensuite près du centre du prochain cercle pour ne pas subir la tempête (le serveur ne contrôle que les bornes et la vitesse : le script se téléporte).
 * L'avion ne vole que 12 s : rien d'autre que le saut ne doit se faire pendant le trajet (fenêtres réduites avant le lancement, pas de menu pause).
 *
 * À savoir : `teleporter` ne change que la position CLIENT et le serveur refuse tout saut plus grand que sa vitesse permise (le script déplace par sauts de
 * 40 m au plus, chacun attendu chez l'autre joueur) ; la chute est simulée par le serveur en temps réel, donc indépendante du rendu logiciel
 * (2–10 images/s) ; les fenêtres sont réduites pendant la partie ; le verrouillage du pointeur, absent en headless, est émulé ; le serveur n'utilise
 * jamais le port 8787 (un onglet de développement ouvert s'y reconnecterait) ; un `next dev` à froid recharge les pages ouvertes.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SORTIE = process.env.E2E_OUT ?? join(tmpdir(), "pdj-e2e-br");
const PAGE = process.env.E2E_PAGE ?? "/arene-e2e-introuvable";
/**
 * Échelle de durée de la zone. 0,08 (la tempête dure 43 s) laisse à peine le temps d'atterrir : sous le rendu logiciel, l'atterrissage de Bob et d'Alice
 * (≈ 22 s après le décollage) tombe déjà dans le troisième palier, et le duel n'y tient plus. 0,5 donne ≈ 270 s de tempête (0,3 ≈ 160 s suffit sur une machine libre, mais la partie finit avant le 6b quand le rendu est lent) : atterrir, ramasser une arme
 * et tuer Bob se font avant la fin de la tempête, qui tue Cora (loin du centre) avant la fermeture totale.
 */
const ECHELLE_ZONE = process.env.E2E_ZONE_ECHELLE ?? "0.5";
/** Durée minimale (ms) pour qu'une partie compte dans les statistiques (le serveur a 60 s par défaut). */
const VALIDE = process.env.E2E_VALIDE ?? "5000";
const FIN = process.env.E2E_FIN ?? "40000";
/**
 * Plafond du décompte (ms). Le décompte se termine dès que tous les admis ont rejoint (3 s au moins) : un plafond généreux ne ralentit donc pas
 * l'essai, et il laisse le temps au premier chargement du moteur de jeu (`next dev` compile `lib/fps/jeu` à froid) ; l'avion, lui, ne part pas sans eux.
 */
const DECOMPTE = process.env.E2E_DECOMPTE ?? "45000";
const FICHIER_STATS = process.env.E2E_STATS ?? join(SORTIE, "stats-br.json");

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
  /** Messages reçus d'un type, depuis l'instant `depuis` (ms epoch). */
  msgs(t, depuis = 0) { return this.recus.filter((r) => r.t === t && r.a >= depuis).map((r) => r.m); }
  /** Messages envoyés d'un type, depuis l'instant `depuis`. */
  envoyesDe(t, depuis = 0) { return this.envoyes.filter((r) => r.t === t && r.a >= depuis).map((r) => r.m); }
  resume(depuis = 0) {
    const compte = (l) => { const c = {}; for (const r of l) if (r.a >= depuis && !["etat", "snap", "ping", "pong", "chute"].includes(r.t)) c[r.t] = (c[r.t] ?? 0) + 1; return JSON.stringify(c); };
    return `${this.nom} ↑${compte(this.envoyes)} ↓${compte(this.recus)}`;
  }
  touche(code, bas) { return this.ev(([c, b]) => window.__arene.touche(c, b), [code, bas]); }
  async appui(code, ms = 120) { await this.touche(code, true); await dormir(ms); await this.touche(code, false); }
  /** Tient une touche jusqu'à ce que `fait` devienne vrai (un appui bref serait perdu entre deux images du rendu logiciel), puis la relâche. */
  async tenir(code, fait, opts = {}) {
    await this.touche(code, true);
    try { return await jusqua(fait, opts); } finally { await this.touche(code, false); }
  }
  teleporter(p) { return this.ev((q) => window.__arene.teleporter(q), p); }
  /** Fenêtre réduite pendant la partie : le rendu logiciel de trois grandes fenêtres tourne à quelques images par seconde. */
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
  /** Dernier `br{etat}` reçu (tenu par l'interface), null avant le premier. */
  async partie() { return (await this.etat()).br?.etat ?? null; }
  /** Ma ligne dans la liste des joueurs du lobby / décompte / fin. */
  async moiBr() { const e = await this.etat(); return e.br?.etat?.joueurs?.find((x) => x.id === e.monId) ?? null; }
  /** Dernier cercle de zone reçu (message `br`), null avant le départ de l'avion. */
  zone() { return this.msgs("br").map((m) => m.etat.zone).filter(Boolean).at(-1) ?? null; }
}

/**
 * Pose `j` en `pos` (mètres, plan XZ) par sauts de 40 m au plus, chacun attendu chez l'un des `observateurs` (qui voit `j` là où le serveur l'a accepté) :
 * le serveur ne laisse franchir que la vitesse permise depuis le dernier état accepté (la distance permise grandit tant que les états sont refusés).
 */
async function aller(j, observateurs, pos, tolerance = 2.5) {
  const idJ = await j.id();
  const PAS = 40;
  const vu = async () => {
    for (const o of observateurs) {
      const s = await o.jeu().catch(() => null);
      const d = s?.distants?.find((x) => x.id === idJ);
      if (d) return d;
    }
    return null;
  };
  for (let etape = 0; etape < 20; etape++) {
    const moi = plat((await j.jeu()).p);
    const reste = dist(moi, pos);
    const k = reste > PAS ? PAS / reste : 1;
    const cible = [moi[0] + (pos[0] - moi[0]) * k, moi[1] + (pos[1] - moi[1]) * k];
    let accepte = false;
    for (let essai = 0; essai < 3 && !accepte; essai++) {
      await j.teleporter([cible[0], 0, cible[1]]);
      accepte = await jusqua(async () => { const d = await vu(); return !!d && dist(plat(d.p), cible) < tolerance; }, { ms: 8000, quoi: "" }).then(() => true, () => false);
    }
    if (!accepte) {
      const sj = await j.jeu();
      throw new Error(`${j.nom} ne peut pas être posé en (${arrondi(cible)}) : côté client ${JSON.stringify(sj?.p && arrondi(sj.p))}, vivant ${sj?.vivant}, pv ${sj?.pv}, vol ${JSON.stringify(sj?.vol?.phase)}, vu par les autres ${JSON.stringify(await vu())}`);
    }
    if (k === 1) return;
  }
  throw new Error(`${j.nom} n'arrive pas en (${arrondi(pos)})`);
}

/**
 * Pose `j` à `d` mètres de `pos` : l'un des quatre côtés, le premier où le joueur peut vraiment se tenir (un mur ou un bâtiment plein le repousserait
 * ailleurs, et `aller` refuse alors la pose).
 */
async function allerPres(j, observateurs, pos, d = 1.4) {
  let derniere = null;
  for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d], [2 * d, 0], [-2 * d, 0]]) {
    try { await aller(j, observateurs, [pos[0] + dx, pos[1] + dz], 2); return; } catch (e) { derniere = e; }
  }
  throw derniere;
}

// ---------------------------------------------------------------------------------------------------------------- butin et points libres

/** Objets au sol d'après les messages `butin` reçus par `j` (liste initiale puis écarts) : le client ne régénère rien, le script non plus. */
function objetsAuSol(j) {
  const objets = new Map();
  for (const m of j.msgs("butin")) {
    for (const o of m.ajoutes ?? []) objets.set(o.id, o);
    for (const id of m.retires ?? []) objets.delete(id);
  }
  return objets;
}

/**
 * Un point où se tenir près de `c` : 0,8 m à côté de l'objet posé AU SOL le plus proche (il est libre pour un joueur : le tirage le vérifie). Poser un
 * joueur au centre exact d'un cercle l'enterrerait parfois dans un bâtiment plein, dont la collision le repousserait ailleurs.
 */
function pointLibrePres(j, c) {
  const sols = [...objetsAuSol(j).values()].filter((o) => o.p[1] <= 0.6).sort((a, b) => dist(plat(a.p), c) - dist(plat(b.p), c));
  verifier(sols.length > 0, "aucun objet au sol pour trouver un point libre");
  return [sols[0].p[0] + 0.8, sols[0].p[2]];
}

// ---------------------------------------------------------------------------------------------------------------- statistiques

/** Lit le palmarès du serveur (`GET /stats-br`) : { clé en minuscules → ligne }. */
async function lireStats(urlHttp) {
  const r = await fetch(`${urlHttp}/stats-br`);
  verifier(r.ok, `GET /stats-br : HTTP ${r.status}`);
  verifier(/no-store/.test(r.headers.get("cache-control") ?? ""), `GET /stats-br sans cache-control: no-store (${r.headers.get("cache-control")})`);
  const { lignes } = await r.json();
  verifier(Array.isArray(lignes), "GET /stats-br sans tableau `lignes`");
  return Object.fromEntries(lignes.map((l) => [l.pseudo.toLocaleLowerCase("fr"), l]));
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
    if (existsSync(FICHIER_STATS)) rmSync(FICHIER_STATS);
    const srv = lancer("serveur-fps", process.execPath, ["dist/index.js"], {
      cwd: join(RACINE, "serveur-fps"),
      env: {
        ...process.env, PORT: String(portWs), SCENE_JSON: join(RACINE, "public/agroparc/scene.json"),
        PDJ_FPS_BR_DECOMPTE_MS: DECOMPTE, PDJ_FPS_BR_VOL_MS: "12000", PDJ_FPS_BR_ALTITUDE: "140", PDJ_FPS_BR_ZONE_ECHELLE: ECHELLE_ZONE,
        PDJ_FPS_CREATION_TIC_MAX_MS: "1000", PDJ_FPS_BR_OBJETS: "300", PDJ_FPS_BR_VALIDE_MS: VALIDE, PDJ_FPS_BR_FIN_MS: FIN, PDJ_FPS_BR_STATS: FICHIER_STATS,
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
  console.log(`Serveur ${urlWs} · site ${urlNext}${PAGE} · captures ${SORTIE} · zone ×${ECHELLE_ZONE}\n`);

  // --- navigateurs
  navigateur = await chromium.launch({
    headless: !process.env.E2E_HEADED,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  });
  const joueurs = [];
  for (const nom of ["Alice", "Bob", "Cora"]) {
    // 1280×720 au lobby (captures fiables), puis fenêtre réduite en partie ; stockage local vide au départ (mode mémorisé : arène)
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
  const [A, B, C] = joueurs;
  participants = joueurs;
  let statsAvant = {};
  let idA, idB, idC;

  // ------------------------------------------------------------------ 1. choix du mode et lobby
  const lobby = await etape("1. vue 3D (code « myrtille »), trois modes, choix de « Battle Royale » par les trois joueurs, lobby", async () => {
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
    verifier(stable >= 2, "la vue Palantir et le panneau d'entrée ne restent pas ouverts chez les trois joueurs");
    await jusqua(async () => { for (const j of joueurs) if ((await j.etat().catch(() => null))?.connexion !== "ouvert") return false; return true; }, { ms: 60_000, quoi: "connexion WebSocket des trois joueurs" });
    // par défaut : l'arène ; les trois cartes du choix du mode sont là, avec leurs compteurs
    const choix = await A.page.locator("input[type=radio][name$='-mode']").evaluateAll((l) => l.map((x) => ({ valeur: x.value, coche: x.checked })));
    verifier(choix.length === 3 && choix.find((c) => c.valeur === "arene")?.coche && ["arene", "zombies", "br"].every((v) => choix.some((c) => c.valeur === v)), `choix du mode inattendu : ${JSON.stringify(choix)}`);
    await jusqua(async () => (await A.etat()).salons, { ms: 8000, quoi: "message `salons` reçu (compteurs des modes)" });
    statsAvant = await lireStats(urlHttp);
    await A.capture("01-choix-mode-arene-1280");

    // Alice (la première) choisit le Battle Royale : elle sera l'hôte ; puis Bob et Cora
    async function choisirBr(j) {
      await j.page.getByRole("radio", { name: /Battle Royale/ }).evaluate((e) => e.click());
      await jusqua(async () => { const e = await j.etat(); return e.mode === "br" && !!e.br?.etat?.joueurs?.some((x) => x.id === e.monId); }, { ms: 15_000, quoi: async () => `${j.nom} dans la salle du Battle Royale (mode ${(await j.etat()).mode}, voulu ${(await j.etat()).modeVoulu})` });
      await j.page.locator("aside[aria-label='Battle Royale']").waitFor({ state: "visible", timeout: 8000 });
    }
    await choisirBr(A);
    idA = await A.id();
    // seule dans le lobby : depuis la v11 elle peut lancer avec des bots (11 par défaut, `salons.listes.br` publie `botsMax`) ; à zéro bot le minimum de deux
    // joueurs n'est pas atteint : le bouton se grise et dit pourquoi (la partie à trois humains de ce script n'a aucun bot)
    const lancerA = A.page.getByRole("button", { name: /Lancer la partie/ });
    const reglageBots = A.page.locator("aside[aria-label='Battle Royale'] fieldset", { hasText: "Bots" });
    await reglageBots.waitFor({ state: "visible", timeout: 10_000 }).catch(() => { throw new Error("le réglage « Bots » n'apparaît pas pour Alice seule"); });
    verifier((await reglageBots.locator("output").first().innerText()).trim() === "11", "11 bots attendus par défaut pour un joueur seul");
    await jusqua(async () => lancerA.isEnabled(), { ms: 8000, quoi: "bouton « Lancer la partie » actif pour un joueur seul avec 11 bots" });
    await reglageBots.locator("input[type=range]").evaluate((el) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "0");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await jusqua(async () => !(await lancerA.isEnabled()), { ms: 5000, quoi: "le bouton « Lancer la partie » devrait se griser à zéro bot pour un lobby d'un seul joueur" });
    verifier(/ajoutez des bots/i.test((await A.page.locator("aside[aria-label='Battle Royale']").innerText()).replace(/\s+/g, " ")), "le lobby ne dit pas d'ajouter des bots");
    await choisirBr(B);
    await choisirBr(C);
    idB = await B.id();
    idC = await C.id();
    await jusqua(async () => { for (const j of joueurs) if ((await j.partie())?.joueurs?.length !== 3) return false; return true; }, { ms: 10_000, quoi: "les trois joueurs dans le lobby du Battle Royale" });
    const pa = await A.partie();
    verifier(pa.phase === "lobby", `phase ${pa.phase} au lieu de lobby`);
    verifier(pa.hote === idA, `l'hôte devrait être Alice (arrivée la première) : ${pa.hote}`);
    verifier(pa.capacite === 50 && pa.minJoueurs === 2, `capacité ${pa.capacite}, minimum ${pa.minJoueurs}`);
    // ils se voient dans la liste, avec le badge « hôte »
    for (const j of joueurs) {
      const texte = (await j.page.locator("aside[aria-label='Battle Royale']").innerText()).replace(/\s+/g, " ");
      verifier(/Alice/.test(texte) && /Bob/.test(texte) && /Cora/.test(texte), `la liste du lobby ne montre pas les trois joueurs chez ${j.nom} : « ${texte.slice(0, 260)} »`);
      verifier(/hôte/i.test(texte), `badge « hôte » absent chez ${j.nom}`);
    }
    // le bouton « Lancer la partie » : actif pour l'hôte, désactivé pour les autres
    await jusqua(async () => lancerA.isEnabled(), { ms: 8000, quoi: "bouton « Lancer la partie » actif chez l'hôte" });
    for (const j of [B, C]) verifier(!(await j.page.getByRole("button", { name: /Lancer la partie/ }).isEnabled()), `le bouton « Lancer la partie » est actif chez ${j.nom}`);
    await A.capture("01-lobby-br-A-1280");
    await B.capture("01-lobby-br-B-1280");
    // fenêtres réduites pour toute la partie (le rendu logiciel de trois grandes fenêtres est trop lent pour un avion de 12 s)
    for (const j of joueurs) await j.reduire(true);
    return `Alice hôte (${idA}), Bob (${idB}), Cora (${idC}), compteur « ${(await A.page.getByRole("radio", { name: /Battle Royale/ }).locator("..").innerText()).replace(/\s+/g, " ").slice(0, 90)} »`;
  });
  if (!lobby) throw new Error("impossible d'ouvrir le lobby du Battle Royale : scénario interrompu");

  // ------------------------------------------------------------------ 2. lancement, décompte, avion
  const enVol = await etape("2. Bob ne peut pas lancer, l'hôte lance : décompte écourté, les trois montent dans l'avion", async () => {
    const depuis = Date.now();
    // Bob essaie par le crochet : le serveur l'ignore (hôte seulement)
    await B.ev(() => window.__arene.lancerBr());
    await dormir(1500);
    verifier((await A.partie()).phase === "lobby", "Bob a pu lancer la partie");
    verifier(!(await B.jeu()), "le jeu de Bob s'est monté alors que la partie n'est pas lancée");
    // Alice lance par le bouton
    await A.page.getByRole("button", { name: /Lancer la partie/ }).evaluate((e) => e.click());
    // les trois jeux se montent en parallèle (le premier chargement du moteur est long) ; le décompte attend les trois
    await Promise.all(joueurs.map((j) => jusqua(async () => { const s = await j.jeu(); return s && s.mode === "br" && s.vol?.phase === "avion"; }, { ms: 120_000, quoi: async () => `${j.nom} dans l'avion (${j.resume(depuis)} ; phase ${JSON.stringify((await j.partie())?.phase)} ; erreurs ${j.erreurs.slice(0, 3).join(" | ")})` })));
    await jusqua(async () => (await A.partie())?.phase === "vol", { ms: 30_000, quoi: async () => `phase de vol (phase ${(await A.partie())?.phase})` });
    const p = await A.partie();
    verifier(p.avion && p.total === 3 && p.vivants === 3, `avion ${JSON.stringify(p.avion)}, total ${p.total}, vivants ${p.vivants}`);
    // décompte : au moins le minimum (3 s) et écourté (bien avant le plafond) dès que les trois ont rejoint ; aucun refus
    const brs = A.msgs("br", depuis);
    const decompte = brs.find((m) => m.etat.phase === "decompte");
    const vol = brs.find((m) => m.etat.phase === "vol");
    verifier(decompte && vol, "pas de br{decompte} puis br{vol} reçus par Alice");
    const duree = vol.etat.debutT - decompte.etat.debutT;
    verifier(duree >= 2900 && duree <= Number(DECOMPTE) - 1000, `décompte de ${duree} ms (3 s au moins, moins que le plafond de ${DECOMPTE} ms attendus)`);
    for (const j of joueurs) {
      verifier(j.envoyesDe("rejoindre", depuis).length >= 1, `${j.nom} n'a pas envoyé rejoindre`);
      verifier(j.msgs("refus", depuis).length === 0, `${j.nom} a reçu un refus : ${JSON.stringify(j.msgs("refus", depuis))}`);
    }
    // équipement de départ : le couteau seul, aucune arme à feu
    const sa = await A.jeu();
    verifier(sa.slot === "couteau" && sa.pv === 100 && sa.bouclier === 0, `équipement de départ : slot ${sa.slot}, pv ${sa.pv}, bouclier ${sa.bouclier}`);
    verifier(!/mitraillette|pistolet/.test(JSON.stringify(sa.slots)), `armes à feu au départ : ${JSON.stringify(sa.slots)}`);
    // le butin tiré par le serveur arrive en une fois (liste complète)
    const butin = A.msgs("butin", depuis).flatMap((m) => m.ajoutes ?? []);
    verifier(butin.length === 300, `liste initiale du butin : ${butin.length} objets (300 attendus)`);
    return `décompte ${(duree / 1000).toFixed(1)} s, avion de (${arrondi(p.avion.depart)}) à (${arrondi(p.avion.arrivee)}) en ${((p.avion.finT - p.avion.debutT) / 1000).toFixed(0)} s, ${butin.length} objets`;
  });
  if (!enVol) throw new Error("la partie ne démarre pas : scénario interrompu");

  // ------------------------------------------------------------------ 3. saut et atterrissage
  await etape("3. saut (Alice et Bob à mi-trajet, Cora éjectée à l'arrivée) et atterrissage : `saut`, entrées `chute`, parachute, `atterri`, invulnérabilité", async () => {
    const depuis = Date.now() - 30_000;
    const avion = (await A.partie()).avion;
    const longueur = dist(avion.depart, avion.arrivee);
    /** Avancement de l'avion sur son trajet (0 à 1), vu par le client de `j`. */
    const avancement = async (j) => { const s = await j.jeu(); return s?.vol?.phase === "avion" ? dist(plat(s.vol.p), avion.depart) / longueur : 1; };
    const voiles = new Set();
    const proteges = new Set();
    const noterVoile = async (j) => {
      const s = await j.jeu().catch(() => null);
      if (s?.vol?.voile) voiles.add(j.nom);
      if (s?.vol?.phase === "sol" && s.protege) proteges.add(j.nom);
      return s;
    };

    // Alice et Bob sautent dès que l'avion a passé le tiers de son trajet (près du centre de la carte) ; Cora reste à bord : éjectée à l'arrivée,
    // elle atterrit au bord de la carte, loin du centre de la zone
    await jusqua(async () => (await avancement(A)) >= 0.3, { ms: 30_000, pas: 40, quoi: "l'avion atteint le tiers de son trajet" });
    const sautA = Date.now();
    await Promise.all([A, B].map((j) => j.tenir("Space", async () => (await j.jeu()).vol.phase !== "avion", { ms: 20_000, pas: 40, quoi: `${j.nom} quitte l'avion` })));
    trace(`Alice et Bob ont sauté à ${((Date.now() - sautA) / 1000).toFixed(1)} s, avion à ${((await avancement(C)) * 100).toFixed(0)} % pour Cora`);
    verifier((await C.jeu()).vol.phase === "avion" || (await avancement(C)) >= 0.9, "Cora a quitté l'avion toute seule trop tôt");
    for (const j of joueurs) {
      const m = await jusqua(async () => j.msgs("saut", depuis)[0], { ms: 30_000, quoi: `message \`saut\` reçu par ${j.nom}` });
      verifier(Math.abs(m.p[1] - 140) < 2 && Math.hypot(m.v[0], m.v[2]) > 10, `état initial de la chute de ${j.nom} : ${JSON.stringify(m)}`);
    }
    // éjection forcée : Cora n'a envoyé aucun `sauter`
    verifier(C.envoyesDe("sauter", depuis).length === 0, "Cora a sauté d'elle-même");
    // Alice ouvre le parachute à la main (appui sur saut plus d'une seconde après le saut), les autres l'ouvrent seuls sous 90 m
    const alice = await jusqua(async () => { const s = await A.jeu(); return s.vol.phase === "libre" ? s : false; }, { ms: 6000, pas: 30, quoi: async () => `Alice en chute libre (vol ${JSON.stringify((await A.jeu()).vol)})` }).catch(() => null);
    if (alice) await A.tenir("Space", async () => (await noterVoile(A))?.vol?.voile || (await A.jeu()).vol.phase === "sol", { ms: 6000, pas: 30, quoi: "ouverture manuelle du parachute d'Alice" }).catch(() => null);
    await jusqua(async () => { await Promise.all(joueurs.map(noterVoile)); for (const j of joueurs) if ((await j.jeu()).vol.phase !== "sol") return false; return true; }, { ms: 70_000, pas: 100, quoi: async () => `atterrissage des trois (${await Promise.all(joueurs.map(async (j) => `${j.nom} ${JSON.stringify((await j.jeu()).vol)}`))})` });
    for (const j of joueurs) {
      const at = await jusqua(async () => j.msgs("atterri", depuis)[0], { ms: 8000, quoi: `message \`atterri\` reçu par ${j.nom}` });
      const s = await j.jeu();
      verifier(dist(plat(s.p), plat(at.p)) < 1.5, `${j.nom} atterri en ${arrondi(s.p)} côté client, ${arrondi(at.p)} côté serveur`);
      verifier(j.envoyesDe("chute", depuis).length >= 5, `${j.nom} n'a envoyé que ${j.envoyesDe("chute", depuis).length} messages chute`);
      if (j !== C) verifier(j.envoyesDe("sauter", depuis).length >= 1, `${j.nom} n'a pas envoyé sauter`);
    }
    verifier(voiles.size === 3, `parachute vu ouvert chez ${[...voiles].join(", ") || "personne"}`);
    // « JOUER » du menu pause = prise de la souris (émulée) : sans elle le menu pause couvre les écrans de mort et de spectateur ; fait au sol, jamais
    // pendant les 12 s de l'avion
    for (const j of joueurs) {
      await jusqua(async () => {
        if ((await j.jeu()).verrouille) return true;
        await j.page.getByRole("button", { name: /^jouer$/i }).first().evaluate((e) => e.click()).catch(() => null);
        return false;
      }, { ms: 15_000, quoi: `prise de la souris de ${j.nom}` });
    }
    // invulnérabilité d'atterrissage (5 s) : vue chez au moins un joueur juste après son atterrissage
    verifier(proteges.size >= 1, "aucun joueur n'a été vu protégé après son atterrissage");
    const sols = joueurs.map(async (j) => arrondi((await j.jeu()).p));
    await A.capture("03-atterri-A-1280");
    return `atterris en ${JSON.stringify(await Promise.all(sols))}, protégés vus ${[...proteges].join()}, parachute vu chez ${[...voiles].join("+")}`;
  });

  // ------------------------------------------------------------------ 4. ramassage d'une arme
  await etape("4. Alice ramasse une arme (téléportation par sauts de 40 m) : `ramasse{ok}`, objet retiré du sol, arme dans son slot et en main", async () => {
    const depuis = Date.now();
    // objets au sol d'après les messages `butin` (le client ne régénère rien) : l'arme à feu posée au sol la plus proche d'Alice
    const objets = objetsAuSol(A);
    const moi = plat((await A.jeu()).p);
    const armes = [...objets.values()].filter((o) => o.genre === "arme" && o.ref !== "epee" && o.p[1] <= 0.6)
      .sort((a, b) => dist(plat(a.p), moi) - dist(plat(b.p), moi));
    verifier(armes.length >= 5, `seulement ${armes.length} armes à feu au sol parmi ${objets.size} objets`);
    const cible = armes[0];
    trace(`arme visée : ${cible.ref} (#${cible.id}) à ${dist(plat(cible.p), moi).toFixed(0)} m`);
    await aller(A, [B, C], [cible.p[0] + 0.8, cible.p[2]], 2);
    await jusqua(async () => (await A.jeu()).butin.proches.some((o) => o.id === cible.id), { ms: 8000, quoi: async () => `objet #${cible.id} proche d'Alice (${JSON.stringify((await A.jeu()).butin.proches)} ; p ${arrondi((await A.jeu()).p)})` });
    const invite = (await A.jeu()).butin.invite;
    verifier(/Ramasser/.test(invite), `invite de ramassage : « ${invite} »`);
    // E tenue jusqu'à la réponse du serveur (un appui bref serait perdu entre deux images)
    const r = await A.tenir("KeyE", async () => A.msgs("ramasse", depuis).find((m) => m.id === cible.id), { ms: 15_000, pas: 60, quoi: async () => `réponse du serveur au ramassage de #${cible.id} (${A.resume(depuis)} ; invite « ${(await A.jeu()).butin.invite} »)` });
    verifier(r.ok, `ramassage refusé : ${JSON.stringify(r)}`);
    const retire = await jusqua(async () => A.msgs("butin", depuis).find((m) => m.retires?.includes(cible.id)), { ms: 5000, quoi: "objet retiré du sol (message butin{retires})" });
    const eq = await jusqua(async () => { const s = await A.jeu(); return JSON.stringify(s.slots).includes(cible.ref) && s.arme === cible.ref ? s : false; }, { ms: 8000, quoi: async () => `${cible.ref} dans les slots et en main (${JSON.stringify((await A.jeu()).slots)}, arme ${(await A.jeu()).arme})` });
    verifier(retire && eq.slot !== "couteau", `slot actif ${eq.slot}`);
    await A.capture("04-arme-ramassee-A-1280");
    // le couteau repasse en main pour la suite
    await A.appui("Digit3", 150);
    await jusqua(async () => (await A.jeu()).arme === "couteau", { ms: 8000, quoi: "couteau en main chez Alice" });
    return `${cible.ref} (#${cible.id}) ramassé en ${eq.slot}, slots ${JSON.stringify(eq.slots).slice(0, 100)}`;
  });

  // ------------------------------------------------------------------ 5. élimination de Bob
  await etape("5. Alice élimine Bob au couteau (3 coups de 34 ; Bob frappe d'abord) : `mort`, +50 PV plafonnés à 100 (`soin{kill}`), kills crédités", async () => {
    const depuis = Date.now();
    // l'invulnérabilité d'atterrissage (5 s) protège des coups : on attend sa fin chez les deux
    for (const j of [A, B]) await jusqua(async () => (await j.jeu()).protege === false, { ms: 12_000, quoi: `fin de l'invulnérabilité de ${j.nom}` });
    // les deux se rassemblent près du centre de la prochaine zone, Bob à 1,4 m d'Alice
    const z = A.zone();
    verifier(z, "aucune zone reçue");
    await aller(A, [B, C], pointLibrePres(A, z.c1));
    const sa = plat((await A.jeu()).p);
    await allerPres(B, [A, C], sa);
    await B.appui("Digit3", 150);
    await jusqua(async () => (await B.jeu()).arme === "couteau", { quoi: "couteau en main chez Bob" });
    // Bob frappe Alice : 34 dégâts de mêlée en Battle Royale (le couteau tuait en un coup en arène) ; la tempête a pu entamer les PV des deux avant
    const pvAliceAvant = (await A.jeu()).pv;
    let coupDeBob = null;
    for (let i = 0; i < 12 && !coupDeBob; i++) {
      await allerPres(B, [A, C], plat((await A.jeu()).p));
      await B.ev((id) => window.__arene.tirerVers(id), idA);
      await dormir(700);
      coupDeBob = A.msgs("degats", depuis).find((m) => m.cible === idA && m.par === idB);
    }
    verifier(coupDeBob, `Bob n'a pas touché Alice : ${B.resume(depuis)} ; coups ${JSON.stringify(B.envoyesDe("coup", depuis).slice(-3))} ; sans type ${JSON.stringify(B.envoyes.filter((r) => r.a >= depuis && r.t === undefined).slice(-2).map((r) => r.m))} ; Bob ${JSON.stringify(arrondi((await B.jeu()).p))} Alice ${JSON.stringify(arrondi((await A.jeu()).p))}`);
    verifier(coupDeBob.degats === 34 && coupDeBob.pv <= pvAliceAvant - 34 + 1, `coup de couteau de Bob : ${JSON.stringify(coupDeBob)} (34 dégâts, ${pvAliceAvant - 34} PV attendus)`);
    // Alice frappe Bob jusqu'à sa mort (3 coups de 34 sur 100 PV)
    const pvBob = (await B.jeu()).pv;
    let essais = 0;
    while (!A.msgs("mort", depuis).some((m) => m.cible === idB) && essais++ < 20) {
      await allerPres(A, [B, C], plat((await B.jeu()).p));
      await dormir(250);
      await A.ev((id) => window.__arene.tirerVers(id), idB);
      await dormir(700);
    }
    const mort = await jusqua(async () => A.msgs("mort", depuis).find((m) => m.cible === idB), { ms: 5000, quoi: `mort de Bob (${A.resume(depuis)} ; ${B.resume(depuis)})` });
    verifier(mort.par === idA && mort.arme === "couteau" && mort.cause === "arme", `mort de Bob : ${JSON.stringify(mort)}`);
    const touches = A.msgs("degats", depuis).filter((m) => m.cible === idB && m.par === idA);
    const attendus = Math.ceil(pvBob / 34);
    verifier(touches.length === attendus && touches.every((m) => m.degats > 0 && m.degats <= 34), `coups d'Alice sur Bob : ${JSON.stringify(touches.map((m) => [m.degats, m.pv]))} (${attendus} coups de 34 attendus sur ${pvBob} PV)`);
    // +50 PV au tueur vivant, plafonnés à 100 (66 + 50 = 116 → 100 si la tempête ne l'a pas entamée), annoncé par `soin{kill}` (pas pris pour de la régénération)
    const pvAliceKill = A.msgs("degats", depuis).filter((m) => m.cible === idA).at(-1).pv;
    const soin = await jusqua(async () => A.msgs("soin", depuis).find((m) => m.motif === "kill"), { ms: 5000, quoi: "message soin{kill} reçu par Alice" });
    const attendu = Math.min(100, pvAliceKill + 50);
    verifier(soin.pv === attendu, `PV après le kill : ${soin.pv} (${attendu} attendus : ${pvAliceKill} + 50, plafonnés à 100)`);
    await jusqua(async () => (await A.jeu()).pv === attendu, { ms: 5000, quoi: async () => `PV d'Alice côté client : ${(await A.jeu()).pv} (${attendu} attendus)` });
    const pres = (await A.etat()).joueurs.find((j) => j.id === idA);
    verifier(!pres || pres.kills === 1, `kills d'Alice dans la présence : ${pres?.kills}`);
    const p = await A.partie();
    verifier(p.vivants === 2 || p.vivants === 1, `${p.vivants} vivants après la mort de Bob`);
    await A.capture("05-kill-couteau-A-1280");
    return `Bob touché ${touches.map((m) => m.degats).join("+")} (PV ${touches.map((m) => m.pv).join("→")}), coup de Bob ${coupDeBob.degats}, Alice ${pvAliceKill} → ${soin.pv} PV, vivants ${p.vivants}`;
  });

  // ------------------------------------------------------------------ 6. Bob spectateur
  await etape("6. Bob, éliminé : killcam puis spectateur, jamais de réapparition", async () => {
    const mort = B.recus.find((r) => r.t === "mort" && r.m.cible === idB);
    verifier(mort, "Bob n'a pas reçu son propre message mort");
    const apparitions = () => B.recus.filter((r) => r.t === "apparition" && r.a > mort.a).length;
    // killcam (rejeu puis carte du tueur), puis écran de spectateur (les majuscules viennent de la feuille de style)
    await B.page.locator("section[aria-label='Spectateur']").waitFor({ state: "visible", timeout: 40_000 }).catch(() => { throw new Error("l'écran « Spectateur » ne s'affiche pas chez Bob"); });
    const texte = (await B.page.locator("section[aria-label='Spectateur']").innerText()).replace(/\s+/g, " ");
    verifier(/éliminé/i.test(texte) && /place #\d+ sur 3/i.test(texte) && /Alice/.test(texte), `bandeau du spectateur : « ${texte.slice(0, 160)} »`);
    const sb = await B.jeu();
    verifier(sb.vivant === false && sb.spectateur?.actif, `Bob vivant ${sb.vivant}, spectateur ${JSON.stringify(sb.spectateur)}`);
    // le temps de la killcam et au-delà : aucune apparition, jamais vivant
    await dormir(7000);
    verifier(apparitions() === 0, `Bob a reçu ${apparitions()} message(s) apparition après sa mort`);
    verifier((await B.jeu()).vivant === false, "Bob est revenu en vie");
    verifier(B.envoyesDe("rejoindre", mort.a).length === 0, "Bob a renvoyé rejoindre après sa mort");
    // la killcam a montré le coup fatal : vue d'Alice, son coup de couteau et la mort de Bob rejoués à leur instant
    const vue = (await B.jeu()).vue;
    const rejoues = (vue?.jouees ?? []).filter((x) => x.quand === "killcam" && x.sujet === idA);
    verifier(rejoues.some((x) => x.genre === "coup" && x.id === idA), `killcam sans le coup d'Alice : ${JSON.stringify(vue?.jouees)}`);
    verifier(rejoues.some((x) => x.genre === "mort" && x.cible === idB), `killcam sans la mort de Bob : ${JSON.stringify(vue?.jouees)}`);
    // spectateur : il a les yeux d'Alice (seule vivante proche)
    verifier(vue?.sujet === (await B.jeu()).spectateur?.suivi, `sujet de la vue ${vue?.sujet}, suivi ${(await B.jeu()).spectateur?.suivi}`);
    // les morts sortent du snap 5 s après leur mort : Alice ne voit plus Bob (il reste dans la présence)
    verifier(!(await A.jeu()).distants.some((d) => d.id === idB && d.vivant), "Alice voit encore Bob vivant");
    const presA = (await A.etat()).joueurs.find((j) => j.id === idB);
    verifier(!presA || presA.enJeu !== false, `présence de Bob chez Alice : ${JSON.stringify(presA)}`);
    await B.capture("06-spectateur-B-1280");
    return `« ${texte.slice(0, 80)} », suivi ${JSON.stringify(sb.spectateur?.suivi)}`;
  });

  // ------------------------------------------------------------------ 6b. parties multiples, spectateur venu regarder
  await etape("6b. Bob quitte la partie, crée la sienne (`mode{br, partie:\"nouvelle\"}`), puis revient regarder celle d'Alice en spectateur (`regarder`)", async () => {
    const depuis = Date.now();
    await B.ev(() => window.__arene.quitter());
    await jusqua(async () => !(await B.jeu()), { ms: 10_000, quoi: "jeu démonté chez Bob" });
    await B.page.locator("aside[aria-label='Battle Royale']").waitFor({ state: "visible", timeout: 8000 });
    // le lobby propose de regarder ou de créer sa partie, et liste les parties
    await B.page.getByRole("button", { name: "Créer ma partie", exact: true }).waitFor({ state: "visible", timeout: 8000 });
    verifier(await B.page.getByRole("button", { name: "Regarder la partie", exact: true }).isVisible(), "pas de bouton « Regarder la partie » chez Bob");
    const premiere = (await B.etat()).br?.partie;
    verifier(premiere === "br1", `partie de Bob avant : ${premiere}`);
    await B.capture("06b-lobby-partie-en-cours-B-1280");
    // nouvelle partie : Bob en est l'hôte, la liste montre les deux parties
    await B.page.getByRole("button", { name: "Créer ma partie", exact: true }).click();
    await jusqua(async () => (await B.etat()).br?.partie && (await B.etat()).br.partie !== "br1", { ms: 10_000, quoi: "Bob dans sa nouvelle partie" });
    const nouvelle = (await B.etat()).br.partie;
    await jusqua(async () => (await B.partie())?.hote === idB && (await B.partie())?.phase === "lobby", { ms: 10_000, quoi: "Bob hôte du lobby de sa partie" });
    await jusqua(async () => ((await B.etat()).salons?.parties ?? []).length === 2, { ms: 10_000, quoi: "deux parties dans `salons.parties`" });
    const parties = (await B.etat()).salons.parties;
    verifier(parties[0].id === "br1" && parties[0].phase !== "lobby" && parties[1].id === nouvelle, `salons.parties : ${JSON.stringify(parties)}`);
    await B.page.locator("section[aria-labelledby$='-parties']").waitFor({ state: "visible", timeout: 8000 });
    await B.capture("06b-nouvelle-partie-B-1280");
    // la partie d'Alice ne voit plus Bob dans sa salle, mais son bilan le comptera
    // « Regarder » la partie d'Alice : Bob y retourne, puis le jeu se monte en spectateur
    await B.ev((id) => window.__arene.regarderBr(id), "br1");
    await jusqua(async () => (await B.etat()).br?.partie === "br1", { ms: 10_000, quoi: "Bob de retour dans la partie d'Alice" });
    // le jeu de spectateur se monte sans la souris (nouveau canevas) : le menu pause « Prêt ? JOUER » couvre l'écran « Spectateur » tant qu'on ne le prend pas
    await jusqua(async () => {
      if ((await B.jeu())?.verrouille) return true;
      await B.page.getByRole("button", { name: /^jouer$/i }).first().evaluate((e) => e.click()).catch(() => null);
      return false;
    }, { ms: 40_000, quoi: "prise de la souris de Bob spectateur" });
    await B.page.locator("section[aria-label='Spectateur']").waitFor({ state: "visible", timeout: 40_000 }).catch(() => { throw new Error("l'écran « Spectateur » ne s'affiche pas chez Bob venu regarder"); });
    verifier(B.envoyesDe("regarder", depuis).length === 1, `Bob a envoyé ${B.envoyesDe("regarder", depuis).length} regarder`);
    verifier(B.msgs("spectateur", depuis).length === 1, "Bob n'a pas reçu `spectateur`");
    verifier(B.envoyesDe("rejoindre", depuis).length === 0, "Bob a envoyé rejoindre");
    const texte = (await B.page.locator("section[aria-label='Spectateur']").innerText()).replace(/\s+/g, " ");
    verifier(/spectateur/i.test(texte) && /Alice|Cora/.test(texte), `bandeau du spectateur venu regarder : « ${texte.slice(0, 160)} »`);
    const sb = await B.jeu();
    verifier(sb.vivant === false && sb.spectateur?.actif && sb.spectateur?.suivi, `Bob spectateur : ${JSON.stringify(sb.spectateur)}`);
    // la partie créée, vide, est refermée
    await jusqua(async () => ((await B.etat()).salons?.parties ?? []).length === 1, { ms: 10_000, quoi: "la partie vide de Bob est refermée" });
    // présence : Bob en jeu, spectateur ; jamais dans le snap
    const presB = (await A.etat()).joueurs.find((j) => j.id === idB);
    verifier(presB?.enJeu && presB?.spec, `présence de Bob chez Alice : ${JSON.stringify(presB)}`);
    verifier(!(await A.jeu()).distants.some((d) => d.id === idB), "Alice voit le corps de Bob spectateur");
    await B.capture("06b-spectateur-venu-regarder-B-1280");
    return `partie créée ${nouvelle}, puis « ${texte.slice(0, 60)} », suivi ${sb.spectateur.suivi}`;
  });

  // ------------------------------------------------------------------ 7. tempête
  await etape("7. la tempête : dégâts hors zone sans tueur, mort de Cora par la tempête (cause `tempete`)", async () => {
    // depuis le début du script : le `soin{kill}` de l'étape 5 est compté (un seul), quelle que soit la durée des étapes 6 et 6b sous un rendu lent
    const depuis = 0;
    // Alice se tient près du centre du prochain cercle : elle ne prend pas la tempête
    const garde = async () => {
      const s = await A.jeu();
      const z = A.zone();
      if (!s?.vivant || !z) return;
      if (dist(plat(s.p), z.c1) <= Math.max(2.5, z.r1 * 0.7)) return;
      const cible = pointLibrePres(A, z.c1);
      if (dist(plat(s.p), cible) > 3) await aller(A, [C, B], cible, 3).catch((e) => trace(`garde : ${e.message.slice(0, 80)}`));
    };
    const morteCora = await jusqua(async () => {
      await garde();
      return C.msgs("mort", depuis).find((m) => m.cible === idC) ?? A.msgs("mort", depuis).find((m) => m.cible === idC);
    }, { ms: 120_000, pas: 200, quoi: async () => `mort de Cora par la tempête (zone ${JSON.stringify(A.zone())} ; Cora ${JSON.stringify((await C.jeu())?.p && arrondi((await C.jeu()).p))} pv ${(await C.jeu())?.pv} ; Alice ${arrondi((await A.jeu()).p)} pv ${(await A.jeu()).pv} ; phase ${(await A.partie())?.phase})` });
    verifier(morteCora.cause === "tempete" && !morteCora.par, `mort de Cora : ${JSON.stringify(morteCora)}`);
    // avant sa mort : des dégâts de tempête (sans tueur) ont fait baisser ses PV
    const degats = C.msgs("degats", depuis).filter((m) => m.cible === idC && !m.par);
    verifier(degats.length >= 3, `dégâts de tempête reçus par Cora : ${degats.length}`);
    verifier(degats.every((m) => m.degats >= 1), `dégâts de tempête inattendus : ${JSON.stringify(degats.slice(0, 3))}`);
    const pvs = degats.map((m) => m.pv + m.bouclier);
    verifier(pvs.every((v, i) => i === 0 || v <= pvs[i - 1]), `les PV de Cora ne baissent pas de façon monotone : ${pvs.join(",")}`);
    // aucun kill n'est crédité pour une mort de tempête
    const pres = (await A.etat()).joueurs.find((j) => j.id === idA);
    verifier(!pres || pres.kills === 1, `kills d'Alice après la tempête : ${pres?.kills}`);
    verifier(A.msgs("soin", depuis).filter((m) => m.motif === "kill").length === 1, "un deuxième soin{kill} a été envoyé pour une mort de tempête");
    // Cora, morte : sa killcam n'a pas de tueur ; elle devient spectatrice
    verifier((await A.jeu()).vivant, "Alice est morte dans la tempête");
    return `Cora : ${degats.length} atteintes de tempête (${degats.map((m) => m.degats).slice(0, 6).join("+")}…), PV ${pvs[0]} → ${pvs.at(-1)}, morte à la ${A.zone()?.palier}ᵉ zone`;
  });

  // ------------------------------------------------------------------ 8. victoire
  await etape("8. victoire d'Alice : phase `fin`, un seul vainqueur, partie comptée", async () => {
    const fin = await jusqua(async () => A.msgs("br").map((m) => m.etat).find((e) => e.phase === "fin"), { ms: 20_000, quoi: async () => `phase fin (phase ${(await A.partie())?.phase}, vivants ${(await A.partie())?.vivants})` });
    const bilan = fin.bilan;
    verifier(bilan, "br{fin} sans bilan");
    verifier(JSON.stringify(bilan.vainqueurs) === JSON.stringify([idA]), `vainqueurs ${JSON.stringify(bilan.vainqueurs)} (Alice ${idA} seule attendue)`);
    const places = bilan.lignes.map((l) => l.place).sort();
    verifier(JSON.stringify(places) === "[1,2,3]", `places du bilan : ${JSON.stringify(places)}`);
    const ligne = (id) => bilan.lignes.find((l) => l.id === id);
    verifier(ligne(idA).place === 1 && ligne(idA).kills === 1, `ligne d'Alice : ${JSON.stringify(ligne(idA))}`);
    verifier(ligne(idB).place > 1 && ligne(idC).place > 1 && ligne(idB).kills === 0 && ligne(idC).kills === 0, `lignes de Bob et Cora : ${JSON.stringify([ligne(idB), ligne(idC)])}`);
    verifier(!fin.nonComptee, "la partie est signalée « non comptée »");
    verifier(bilan.dureeMs >= Number(VALIDE), `durée du bilan ${bilan.dureeMs} ms < ${VALIDE}`);
    verifier(fin.vivants === 1, `${fin.vivants} vivants à la fin`);
    for (const j of joueurs) verifier(j.msgs("terminer").length === 0, `${j.nom} a reçu un message terminer (cycle de matchs de l'arène)`);
    return `vainqueur Alice en ${(bilan.dureeMs / 1000).toFixed(0)} s, places ${bilan.lignes.map((l) => `${l.pseudo} #${l.place}`).join(", ")}`;
  });

  // ------------------------------------------------------------------ 9. écran de fin et statistiques
  await etape("9. écran de fin (TOP 1 pour Alice), statistiques : `statsBr` diffusé, `GET /stats-br` (TOP 1 d'Alice +1, parties +1)", async () => {
    for (const j of joueurs) await j.reduire(false); // fenêtres à leur taille normale
    for (const j of joueurs) await j.page.locator("section[aria-label='Fin de partie']").waitFor({ state: "visible", timeout: 15_000 }).catch(() => { throw new Error(`l'écran « Fin de partie » ne s'affiche pas chez ${j.nom}`); });
    const titre = async (j) => (await j.page.locator("section[aria-label='Fin de partie'] h2").first().innerText()).trim();
    verifier(/TOP 1/.test(await titre(A)), `titre de fin d'Alice : « ${await titre(A)} »`);
    verifier(/^#[23] sur 3$/i.test(await titre(B)) && /^#[23] sur 3$/i.test(await titre(C)), `titres de fin de Bob et Cora : « ${await titre(B)} », « ${await titre(C)} »`);
    const texte = (await A.page.locator("section[aria-label='Fin de partie']").innerText()).replace(/\s+/g, " ");
    verifier(/Alice/.test(texte) && /Bob/.test(texte) && /Cora/.test(texte), "le tableau de fin ne nomme pas les trois joueurs");
    verifier(!/non comptée/i.test(texte), "l'écran de fin annonce une partie non comptée");
    // les statistiques sont diffusées à tous en fin de partie (message `statsBr`), Alice y est avec un TOP 1
    const sb = await jusqua(async () => A.msgs("statsBr").at(-1)?.lignes?.length ? A.msgs("statsBr").at(-1) : false, { ms: 10_000, quoi: "message statsBr reçu par Alice" });
    const ligneA = sb.lignes.find((l) => l.pseudo === "Alice");
    verifier(ligneA && ligneA.top1 >= 1, `statsBr sans TOP 1 pour Alice : ${JSON.stringify(sb.lignes)}`);
    await A.capture("09-fin-A-1280");
    await B.capture("09-fin-B-1280");
    // relecture par HTTP (le fichier du serveur est écrit de façon asynchrone : on attend qu'il rattrape)
    const apres = await jusqua(async () => { const s = await lireStats(urlHttp); return s.alice?.parties === (statsAvant.alice?.parties ?? 0) + 1 ? s : false; }, { ms: 10_000, quoi: async () => `GET /stats-br à jour (${JSON.stringify(await lireStats(urlHttp))})` });
    const delta = (cle, champ) => (apres[cle]?.[champ] ?? 0) - (statsAvant[cle]?.[champ] ?? 0);
    verifier(delta("alice", "top1") === 1, `TOP 1 d'Alice : +${delta("alice", "top1")} (+1 attendu)`);
    verifier(delta("alice", "kills") === 1, `kills d'Alice : +${delta("alice", "kills")} (+1 attendu)`);
    for (const cle of ["bob", "cora"]) {
      verifier(delta(cle, "parties") === 1 && delta(cle, "top1") === 0, `${cle} : parties +${delta(cle, "parties")}, TOP 1 +${delta(cle, "top1")}`);
    }
    verifier(apres.alice.meilleurePlace === 1, `meilleure place d'Alice : ${apres.alice.meilleurePlace}`);
    if (!process.env.E2E_WS && existsSync(FICHIER_STATS)) {
      const fichier = JSON.parse(readFileSync(FICHIER_STATS, "utf8"));
      verifier(fichier.version === 1 && fichier.joueurs.alice?.top1 === apres.alice.top1, `fichier des statistiques : ${JSON.stringify(fichier).slice(0, 200)}`);
    }
    // CORS : aucune en-tête pour une origine inconnue n'est testée ici (ORIGINES vide en essai), seulement la réponse brute
    return `Alice TOP 1 ${apres.alice.top1}, ${apres.alice.parties} partie(s), ${apres.alice.kills} kill(s) ; Bob ${apres.bob.parties} partie(s) ; Cora ${apres.cora.parties} partie(s)`;
  });

  // ------------------------------------------------------------------ 10. retour au lobby
  await etape("10. « Rejouer » ramène au lobby, la salle repasse au lobby au bout de l'affichage de la fin", async () => {
    for (const j of joueurs) await j.page.getByRole("button", { name: "Rejouer" }).evaluate((e) => e.click());
    for (const j of joueurs) {
      await jusqua(async () => !(await j.jeu()) && !(await j.etat()).enArene, { ms: 10_000, quoi: `jeu démonté chez ${j.nom} après « Rejouer »` });
      await j.page.locator("aside[aria-label='Battle Royale']").waitFor({ state: "visible", timeout: 8000 });
    }
    await jusqua(async () => { for (const j of joueurs) if ((await j.partie())?.phase !== "lobby") return false; return true; }, { ms: Number(FIN) + 20_000, pas: 500, quoi: async () => `la salle repasse au lobby (phase ${(await A.partie())?.phase})` });
    await jusqua(async () => A.page.getByRole("button", { name: /Lancer la partie/ }).isEnabled(), { ms: 8000, quoi: "« Lancer la partie » de nouveau actif pour l'hôte" });
    const lignes = (await A.partie()).joueurs;
    verifier(lignes.length === 3 && lignes.every((x) => !x.admis && x.vivant === false || !x.admis), `joueurs encore admis dans le lobby : ${JSON.stringify(lignes)}`);
    verifier((await A.partie()).hote === idA, "l'hôte a changé");
    await A.capture("10-retour-lobby-A-1280");
    return `phase lobby, ${lignes.length} joueurs en attente, hôte Alice`;
  });

  // ------------------------------------------------------------------ 11. erreurs
  await etape("11. aucune erreur JavaScript, aucun message `erreur` du serveur, aucune WebSocket coupée en partie", async () => {
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
