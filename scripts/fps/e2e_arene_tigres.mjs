#!/usr/bin/env node
/**
 * Test de bout en bout des tigres de l'arène FPS (protocole v5) : DEUX navigateurs Chromium headless contre un `serveur-fps` local, dont
 * l'avion passe toutes les 4 à 5 s (`PDJ_FPS_AVION_MIN_MS` / `PDJ_FPS_AVION_MAX_MS`), et un `next dev` local, pilotés par le crochet de
 * développement `window.__arene` (cf. app/components/Agroparc3D.tsx : `tigres()`, `invoquer()`, `tirerVers(id)` qui vise aussi un tigre).
 * Spec : docs/superpowers/specs/2026-10-23-arene-tigres-design.md (Tests et vérification)
 *
 * Scénario (chaque étape imprime OK / ÉCHEC, des captures sont prises en route) :
 *  1. vue 3D (code « myrtille »), lobby, entrée des deux joueurs, Alice en orange (lanceur le plus proche de la fourrure)
 *  2. un avion largue un premier tigre sauvage (souvent dès l'entrée des joueurs) : `avion{largage}`, `tigre{apparu}` chez A et B
 *  3. le tigre se pose dans une cachette et se tapit (vérifié avant puis pendant l'approche de A à 28 m, capturé)
 *  4. A l'abat (B l'aide puis le laisse finir) : touches confirmées, mort par A, sort gagné, fil « a abattu le tigre », icône du sort
 *  5. l'avion suivant passe (capturé) et largue un tigre en parachute (capturé), annonce « Un tigre a été largué ! » au HUD
 *  6. A lance le sort (touche G) : tigre allié à côté de lui, liseré de sa couleur (vu par A et par B)
 *  7. le tigre allié attaque B : dégâts crédités à A, B éliminé (cause « tigre »), ligne « Tigre » au fil de A
 *  8. aucune erreur JavaScript ni `erreur` du serveur, aucune WebSocket coupée en partie
 *
 * Usage : node scripts/fps/e2e_arene_tigres.mjs     (Node 22, Playwright : `npm i --no-save playwright` ou PLAYWRIGHT_DIR=/dossier/avec/node_modules)
 * Variables : celles de e2e_arene_v2.mjs (E2E_OUT, défaut <tmp>/pdj-e2e-arene-tigres, E2E_URL, E2E_WS, E2E_WS_PORT, E2E_PAGE, E2E_HEADED,
 *             E2E_GARDER, E2E_JUSQUA). Un serveur déjà lancé (E2E_WS) doit avoir un avion fréquent (PDJ_FPS_AVION_MIN_MS=4000, MAX=5000)
 *             et les événements neutralisés (PDJ_FPS_EVT_MIN_MS=600000, MAX=600000).
 * Code de sortie : 0 si toutes les étapes passent, 1 sinon.
 *
 * À savoir : le tigre sauvage a 2 500 PV et poursuit son agresseur. Les deux joueurs entrent au fusil à lunette (237 dégâts à la tête, sans
 * chute à distance : une dizaine de tirs, peu importe la lenteur des allers-retours avec la page) et tirent à la tête (`tirerVers` vise la
 * tête d'un tigre). B s'arrête sous 700 PV pour que A porte le dernier coup. Un joueur tué par le tigre réapparaît et reprend. Sous 30 % le tigre s'enfuit vers
 * une autre cachette : les joueurs le suivent. Après sa mort, un autre avion peut passer pendant les étapes 5 et 6 : seuls les coups crédités
 * à A comptent. Le reste (pose par étapes de 9 m, rendu logiciel lent, port 8787 jamais utilisé) est expliqué dans e2e_arene_v2.mjs.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SORTIE = process.env.E2E_OUT ?? join(tmpdir(), "pdj-e2e-arene-tigres");
const PAGE = process.env.E2E_PAGE ?? "/arene-e2e-introuvable";
/** Centre du rond-point (scene.json) : la réapparition doit se faire à 25–140 m de là. */
const ROND_POINT = [28.2, 2.5];
const ELSA = [-120, 39];

// ---------------------------------------------------------------------------------------------------------------- utilitaires

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const distXZ = (p, c) => Math.hypot(p[0] - c[0], p[2] - c[1]);

/** Un port libre choisi par le système. */
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

/** Attend qu'une fonction (async) devienne vraie, `quoi` peut être une fonction (async) évaluée à l'échec, pour joindre un diagnostic à jour. */
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

class Joueur {
  constructor(nom, page) {
    this.nom = nom;
    this.page = page;
    /** messages du serveur reçus, dans l'ordre : { t, m, a } */
    this.recus = [];
    this.envoyes = [];
    this.erreurs = [];
    /** fermetures de la WebSocket en cours de scénario (le client se reconnecte seul : à surveiller) */
    this.fermetures = [];
    page.on("pageerror", (e) => this.erreurs.push(`pageerror : ${String(e).slice(0, 300)}`));
    page.on("console", (m) => {
      if (m.type() === "error") this.erreurs.push(`console.error : ${m.text().slice(0, 300)}`);
      // avertissements de l'arène (filtre du bloom inattendu : le halo du tigre n'est plus exclu) comptés comme des erreurs
      else if (m.type() === "warning" && m.text().startsWith("arène :")) this.erreurs.push(`console.warn : ${m.text().slice(0, 300)}`);
    });
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
  /** Comptes des messages envoyés (↑) et reçus (↓) depuis `depuis` : joint aux messages d'échec pour diagnostiquer. */
  resume(depuis = 0) {
    const compte = (l) => { const c = {}; for (const r of l) if (r.a >= depuis && r.t !== "etat" && r.t !== "snap" && r.t !== "ping" && r.t !== "pong") c[r.t] = (c[r.t] ?? 0) + 1; return JSON.stringify(c); };
    return `${this.nom} ↑${compte(this.envoyes)} ↓${compte(this.recus)}`;
  }
  touche(code, bas) { return this.ev(([c, b]) => window.__arene.touche(c, b), [code, bas]); }
  async appui(code, ms = 120) { await this.touche(code, true); await dormir(ms); await this.touche(code, false); }
  teleporter(p) { return this.ev((q) => window.__arene.teleporter(q), p); }
  async capture(nom) {
    const f = join(SORTIE, `${nom}.png`);
    await this.page.screenshot({ path: f });
    return f;
  }
}

// ---------------------------------------------------------------------------------------------------------------- géométrie de la scène
// Les voitures PNJ (9 m/s) tuent à pied dès qu'on est sur leur route : les étapes intermédiaires d'un déplacement et la piste de glissade
// sont donc choisies loin des routes et des bâtiments de `scene.json`.
const scene = JSON.parse(readFileSync(join(RACINE, "public/agroparc/scene.json"), "utf8"));
const polylignes = scene.roads.map((r) => r.p);
const batiments = scene.buildings.filter((b) => b.r);
function distSegment(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}
function dansPolygone(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (((r[i][1] > z) !== (r[j][1] > z)) && (x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0])) c = !c;
  }
  return c;
}
function distRoutes(x, z) {
  let m = Infinity;
  for (const p of polylignes) for (let i = 0; i < p.length - 1; i++) { if (Math.abs(p[i][0] - x) > 300 || Math.abs(p[i][1] - z) > 300) continue; m = Math.min(m, distSegment(x, z, p[i], p[i + 1])); }
  return m;
}
function distBatiments(x, z) {
  let m = Infinity;
  for (const b of batiments) {
    if (dansPolygone(x, z, b.r)) return 0;
    for (let i = 0; i < b.r.length - 1; i++) m = Math.min(m, distSegment(x, z, b.r[i], b.r[i + 1]));
  }
  return m;
}
const estLibre = (x, z, route = 8, bat = 3) => distRoutes(x, z) >= route && distBatiments(x, z) >= bat;
/** Les segments [a, b] et [c, d] (x, z) se coupent. */
function secants(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
/**
 * Aucun bâtiment entre (x, z) et `cible` (x, z), au sol : un tigre tapi ou couché a la tête vers 1 m, sous le toit de n'importe quel
 * bâtiment. Une cachette est souvent à quelques mètres d'une façade : sans ce contrôle, un joueur posé « de son côté » tire dans le mur.
 */
function vueLibre(x, z, cible) {
  for (const b of batiments) for (let i = 0; i < b.r.length - 1; i++) if (secants([x, z], cible, b.r[i], b.r[i + 1])) return false;
  return true;
}
/**
 * Le point libre le plus proche de (x, z) (spirale de 4 m en 4 m, 40 m au plus), (x, z) lui-même s'il n'y en a pas. Avec `eviter`
 * ({ c: [x, z], r }), le point reste à plus de `r` m de `c` (un tigre tapi s'alerte à 20 m).
 */
function pointLibre(x, z, eviter = null) {
  for (let r = 0; r <= 40; r += 4) {
    const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 4);
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      const cx = x + r * Math.cos(a), cz = z + r * Math.sin(a);
      if (eviter && Math.hypot(cx - eviter.c[0], cz - eviter.c[1]) <= eviter.r) continue;
      if (estLibre(cx, cz)) return [cx, cz];
    }
  }
  return [x, z];
}
/** Piste droite de `longueur` m sans route ni bâtiment (marge 6 m / 3 m), la plus proche du rond-point : { depart: [x, z], dir: [dx, dz] }. */
function trouverPiste(longueur = 26) {
  const candidats = [];
  for (let gx = -160; gx <= 160; gx += 8) for (let gz = -160; gz <= 160; gz += 8) candidats.push([ROND_POINT[0] + gx, ROND_POINT[1] + gz]);
  candidats.sort((a, b) => Math.hypot(a[0] - ROND_POINT[0], a[1] - ROND_POINT[1]) - Math.hypot(b[0] - ROND_POINT[0], b[1] - ROND_POINT[1]));
  for (const [x, z] of candidats) {
    for (let k = 0; k < 8; k++) {
      const dir = [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)];
      let ok = true;
      for (let d = 0; d <= longueur && ok; d += 2) ok = estLibre(x + dir[0] * d, z + dir[1] * d, 6, 3);
      if (ok) return { depart: [x, z], dir };
    }
  }
  throw new Error("aucune piste libre de 26 m trouvée autour du rond-point");
}

/**
 * Chemin à pied de `de` à `a` (plan XZ) pour `poser` : A* sur une grille de 2 m bornée à la boîte des deux points élargie de 60 m ; les abords
 * des routes (8 m, voitures PNJ) coûtent 3 fois plus, les cases à moins de 2 m d'un bâtiment 40 fois plus (on ne s'y pose jamais, mais un départ
 * coincé contre un mur en sort). Simulé hors ligne sur l'anneau d'apparition : toujours un chemin, en 1 s au plus. Renvoie la suite des centres
 * de cases (sans `de`, `a` en dernier), ou null.
 * Avec `eviter` ({ c: [x, z], r }), les cases à moins de `r` m de `c` coûtent comme un bâtiment (un tigre tapi s'alerte à 20 m) : le chemin les contourne.
 */
const CASE_CHEMIN = 2;
const COUT_BLOQUE = 40;
const cacheCases = new Map();
function coutCase(i, j, eviter = null) {
  if (eviter && Math.hypot(i * CASE_CHEMIN - eviter.c[0], j * CASE_CHEMIN - eviter.c[1]) <= eviter.r) return COUT_BLOQUE;
  const k = `${i},${j}`;
  let c = cacheCases.get(k);
  if (c === undefined) {
    const x = i * CASE_CHEMIN, z = j * CASE_CHEMIN;
    c = distBatiments(x, z) < 2 ? COUT_BLOQUE : distRoutes(x, z) < 8 ? 3 : 1;
    cacheCases.set(k, c);
  }
  return c;
}
const caseBloquee = (p, eviter = null) => coutCase(Math.round(p[0] / CASE_CHEMIN), Math.round(p[1] / CASE_CHEMIN), eviter) >= COUT_BLOQUE;
function cheminAPied(de, a, eviter = null) {
  const ci = (v) => Math.round(v / CASE_CHEMIN);
  const [i0, j0, i1, j1] = [ci(de[0]), ci(de[1]), ci(a[0]), ci(a[1])];
  const marge = 30;
  const imin = Math.min(i0, i1) - marge, imax = Math.max(i0, i1) + marge, jmin = Math.min(j0, j1) - marge, jmax = Math.max(j0, j1) + marge;
  const cle = (i, j) => (i - imin) + (j - jmin) * (imax - imin + 1);
  const g = new Map(), parent = new Map();
  const tas = [];
  const pousser = (n) => { tas.push(n); let k = tas.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (tas[p].f <= tas[k].f) break; [tas[p], tas[k]] = [tas[k], tas[p]]; k = p; } };
  const extraire = () => { const r = tas[0], d = tas.pop(); if (tas.length) { tas[0] = d; let k = 0; for (;;) { const l = 2 * k + 1, rr = l + 1; let m = k; if (l < tas.length && tas[l].f < tas[m].f) m = l; if (rr < tas.length && tas[rr].f < tas[m].f) m = rr; if (m === k) break; [tas[m], tas[k]] = [tas[k], tas[m]]; k = m; } } return r; };
  const h = (i, j) => Math.hypot(i - i1, j - j1);
  g.set(cle(i0, j0), 0);
  pousser({ i: i0, j: j0, f: h(i0, j0) });
  while (tas.length) {
    const n = extraire();
    const kn = cle(n.i, n.j);
    if (n.i === i1 && n.j === j1) {
      const res = [];
      for (let k = kn; k !== undefined && k !== cle(i0, j0); k = parent.get(k)) {
        const i = (k % (imax - imin + 1)) + imin, j = Math.floor(k / (imax - imin + 1)) + jmin;
        res.push([i * CASE_CHEMIN, j * CASE_CHEMIN]);
      }
      res.reverse();
      res.push([a[0], a[1]]);
      return res;
    }
    const gn = g.get(kn);
    if (n.f > gn + h(n.i, n.j) + 1e-9) continue;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const i = n.i + di, j = n.j + dj;
      if (i < imin || i > imax || j < jmin || j > jmax) continue;
      const fin = i === i1 && j === j1;
      const gg = gn + Math.hypot(di, dj) * (fin ? 1 : coutCase(i, j, eviter));
      const k = cle(i, j);
      if (gg < (g.get(k) ?? Infinity)) { g.set(k, gg); parent.set(k, kn); pousser({ i, j, f: gg + h(i, j) }); }
    }
  }
  return null;
}

/**
 * Pose `j` en `pos` : `teleporter` ne change que la position CLIENT, et le serveur n'accepte un état que s'il reste dans la limite
 * de son budget de distance (v8 : `VITESSE_MAX_H_M_S` × temps écoulé, plafonné à `BUDGET_ARENE_S` = 0,5 s, + 1 m : 10,5 m). Un saut est donc
 * découpé en étapes de 9 m le long d'un chemin à pied (`cheminAPied`, comme e2e_arene_v2.mjs : hors des bâtiments, loin des routes autant que possible : une
 * voiture PNJ tue), chacune attendue chez `autre` (qui voit `j` là où le serveur l'a accepté). Avec `eviter` (cf. `cheminAPied`), le chemin contourne `eviter.c`.
 * (Avant, chaque étape était ramenée au point libre le plus proche par `pointLibre` : quand la droite vers la cible traversait une bande de route,
 * le point libre se trouvait de l'autre côté, derrière le joueur, et la marche oscillait sur place : 19 → 22 → 21 → 20 → 19 m.)
 */
async function poser(j, autre, pos, tolerance = 2.5, eviter = null) {
  const idJ = await j.id();
  let vu = null;
  const PAS = 9;
  const depart = (await j.jeu()).p;
  const chemin = (Math.hypot(pos[0] - depart[0], pos[2] - depart[2]) > PAS && cheminAPied([depart[0], depart[2]], [pos[0], pos[2]], eviter)) || [[pos[0], pos[2]]];
  let idx = 0;
  /** dernières positions (diagnostic du « n'arrive pas ») */
  const trace = [];
  for (let etape = 0; etape < 80; etape++) {
    const moi = (await j.jeu()).p;
    trace.push(`${moi[0].toFixed(0)},${moi[2].toFixed(0)}`);
    const loin = (q) => Math.hypot(q[0] - moi[0], q[1] - moi[2]);
    let m = idx;
    while (m + 1 < chemin.length && loin(chemin[m + 1]) <= PAS) m++;
    while (m > idx && m !== chemin.length - 1 && caseBloquee(chemin[m], eviter)) m--;
    const fin = m === chemin.length - 1;
    let cible = fin ? [pos[0], pos[1], pos[2]] : [chemin[m][0], pos[1], chemin[m][1]];
    const d = Math.hypot(cible[0] - moi[0], cible[2] - moi[2]);
    const k = d > PAS ? PAS / d : 1;
    if (k < 1) cible = [moi[0] + (cible[0] - moi[0]) * k, pos[1], moi[2] + (cible[2] - moi[2]) * k]; // hors du chemin : pas en ligne droite
    let accepte = false;
    for (let essai = 0; essai < 3 && !accepte; essai++) {
      await j.teleporter(cible);
      accepte = await jusqua(async () => {
        vu = (await autre.jeu()).distants.find((x) => x.id === idJ);
        return !!vu && Math.hypot(vu.p[0] - cible[0], vu.p[2] - cible[2]) < tolerance;
      }, { ms: 5000, quoi: "" }).then(() => true, () => false);
    }
    if (!accepte) {
      const sj = await j.jeu();
      const recents = j.recus.filter((r) => ["mort", "apparition", "erreur", "match"].includes(r.t) && (r.t !== "apparition" || r.m.id === idJ) && Date.now() - r.a < 90_000).map((r) => `${r.t}${r.m.cause ? `:${r.m.cause}` : ""}@-${((Date.now() - r.a) / 1000).toFixed(0)}s`);
      throw new Error(`${j.nom} ne peut pas être posé en (${cible.map((x) => x.toFixed(1))}) : vu en ${vu ? `${vu.p.map((x) => x.toFixed(1))} (vivant ${vu.vivant})` : "nulle part"} par ${autre.nom} ; ${j.nom} côté client : p ${sj.p.map((x) => x.toFixed(1))}, vivant ${sj.vivant}, pv ${sj.pv} ; messages récents ${recents.join(" ")}`);
    }
    if (k === 1) { idx = m + 1; if (fin) return vu; }
  }
  throw new Error(`${j.nom} n'arrive pas en (${pos.map((x) => x.toFixed(1))}) ; dernières positions : ${trace.slice(-12).join(" → ")}${eviter ? ` ; zone évitée ${JSON.stringify(eviter)}` : ""}`);
}

// ---------------------------------------------------------------------------------------------------------------- étapes

const resultats = [];
let etapeCourante = "avant le scénario";
/** Les deux joueurs, pour que `etape` sache si un accident de circulation (voiture PNJ, mortelle par conception) a gâché une étape. */
let participants = [];
/** Un match dure 8 min (entracte de 12 s ensuite, tout le monde réapparaît) : on ne démarre pas une étape dans les 90 dernières secondes. */
async function garantirMatch() {
  const A = participants[0];
  const restant = async () => { const m = (await A.etat()).match; return m && m.phase === "jeu" && m.fin ? m.fin - Date.now() : -1; };
  if ((await restant()) > 90_000) return;
  process.stdout.write("[fin de match proche, attente du suivant] ");
  await jusqua(async () => (await restant()) > 300_000, { ms: 150_000, pas: 500, quoi: "début du match suivant" });
  for (const j of participants) await jusqua(async () => { const s = await j.jeu(); return s.vivant && s.apparu && !s.killcam; }, { ms: 30_000, quoi: `${j.nom} réapparu pour le nouveau match` });
  await dormir(2000);
}
async function etape(nom, fn) {
  // E2E_JUSQUA=5 : s'arrête après l'étape 5 (mise au point), les étapes suivantes sont ignorées
  if (process.env.E2E_JUSQUA && parseInt(nom, 10) > Number(process.env.E2E_JUSQUA)) return true;
  const t0 = Date.now();
  etapeCourante = nom;
  process.stdout.write(`- ${nom} ... `);
  if (participants.length) await garantirMatch().catch((e) => process.stdout.write(`[${e.message}] `));
  for (let essai = 1; ; essai++) {
    const debut = Date.now();
    try {
      const detail = await fn();
      resultats.push({ nom, ok: true });
      console.log(`OK (${((Date.now() - t0) / 1000).toFixed(1)} s)${essai > 1 ? ` après ${essai} essais` : ""}${detail ? ` — ${detail}` : ""}`);
      return true;
    } catch (e) {
      const accident = participants.some((j) => j.msgs("mort", debut).some((m) => m.cause === "ecrase_pnj"));
      if (accident && essai < 3) {
        process.stdout.write(`[accident de circulation, étape rejouée] `);
        try {
          for (const j of participants) await jusqua(async () => { const s = await j.jeu(); return s.vivant && s.apparu && !s.killcam; }, { ms: 40_000, quoi: `${j.nom} vivant` });
        } catch { /* l'étape suivante échouera clairement */ }
        await dormir(2000);
        continue;
      }
      resultats.push({ nom, ok: false, erreur: e.message });
      console.log(`ÉCHEC — ${e.message}`);
      return false;
    }
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
    // jamais 8787 (port par défaut du client en local) : un onglet de développement ouvert sur le site s'y reconnecterait et entrerait dans la partie
    portWs = process.env.E2E_WS_PORT ? Number(process.env.E2E_WS_PORT) : await portLibre();
    urlWs = `ws://localhost:${portWs}`;
    const build = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: join(RACINE, "serveur-fps"), encoding: "utf8" });
    if (build.status !== 0) throw new Error(`build de serveur-fps en échec :\n${build.stdout}${build.stderr}`);
    const srv = lancer("serveur-fps", process.execPath, ["dist/index.js"], {
      cwd: join(RACINE, "serveur-fps"),
      // avion toutes les 4 à 5 s (un seul tigre sauvage à la fois), Elsa, événements (Truck Muche fou, tigre géant) et bus C3 neutralisés
      env: {
        ...process.env, PORT: String(portWs), PDJ_FPS_ELSA_MIN_MS: "600000", PDJ_FPS_ELSA_MAX_MS: "600000",
        PDJ_FPS_EVT_MIN_MS: "600000", PDJ_FPS_EVT_MAX_MS: "600000", PDJ_FPS_BUS_MIN_MS: "600000", PDJ_FPS_BUS_MAX_MS: "600000",
        PDJ_FPS_AVION_MIN_MS: "4000", PDJ_FPS_AVION_MAX_MS: "5000", SCENE_JSON: join(RACINE, "public/agroparc/scene.json"),
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
    await attendreHttp(`${urlNext}${PAGE}`, 120_000, "next dev").catch((e) => { throw new Error(`${e.message}\n${nx.journal.join("").slice(-1500)}`); });
  }
  console.log(`Serveur ${urlWs} · site ${urlNext}${PAGE} · captures ${SORTIE}\n`);

  // --- navigateurs
  navigateur = await chromium.launch({
    headless: !process.env.E2E_HEADED,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  });
  const joueurs = [];
  for (const nom of ["Alice", "Bob"]) {
    const ctx = await navigateur.newContext({ viewport: { width: 1920, height: 1080 } });
    // « N » = coin suivant de la mini-carte (aucune touche par défaut), les autres actions reprennent leurs touches par défaut
    await ctx.addInitScript(() => {
      try { localStorage.setItem("pdj-fps-touches", JSON.stringify({ minimapCoin: ["KeyN", null] })); } catch { /* stockage indisponible */ }
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

  // ------------------------------------------------------------------ 1. lobby et entrée
  const demarre = await etape("1. ouverture de la vue 3D (code « myrtille ») et du lobby, entrée des deux joueurs", async () => {
    // Un `next dev` à froid compile à la première visite puis recharge TOUTES les pages ouvertes : on rouvre le lobby de chaque joueur dont la page
    // a été rechargée, jusqu'à ce que les deux tiennent (le code est tapé UNE fois par essai : le retaper refermerait la vue)
    const ouvert = (j) => j.ev(() => !!window.__arene && !!document.querySelector("aside[aria-label='Arène']")).catch(() => false);
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
    // Bob se connecte d'abord : la palette donne le rouge au premier et l'orange au second. Alice, qui lancera le sort, a l'orange, la
    // couleur la plus proche de la fourrure : le cas le plus difficile pour distinguer son tigre allié d'un tigre sauvage
    let stable = 0;
    for (let tour = 1; tour <= 8 && stable < 2; tour++) {
      let tous = true;
      for (const j of [B, A]) if (!(await ouvert(j))) { tous = false; await ouvrir(j); }
      if (tous) { stable++; await dormir(2500); } else stable = 0;
    }
    verifier(stable >= 2, "la vue Palantir et le lobby ne restent pas ouverts chez les deux joueurs");
    await jusqua(async () => (await A.etat().catch(() => null))?.connexion === "ouvert" && (await B.etat().catch(() => null))?.connexion === "ouvert", { ms: 60_000, quoi: async () => `connexion WebSocket des deux joueurs (A ${JSON.stringify((await A.etat().catch(() => ({})))?.connexion)}, B ${JSON.stringify((await B.etat().catch(() => ({})))?.connexion)} ; erreurs ${[...A.erreurs, ...B.erreurs].slice(0, 4).join(" | ")} ; URL du serveur ${urlWs})` });
    // un `next dev` à froid a pu recharger les pages dans le désordre : si Alice n'a pas l'orange, les deux pages se déconnectent (couleurs
    // libérées) puis Bob se reconnecte avant elle (`next dev` est chaud, plus de rechargement)
    const ORANGE = "#ff8f2e";
    const couleurDe = async (j) => {
      const id = (await j.etat().catch(() => null))?.monId;
      return j.recus.filter((r) => r.t === "presence" || r.t === "bienvenue").map((r) => r.m.joueurs?.find((x) => x.id === id)?.couleur).filter(Boolean).at(-1);
    };
    const connecte = (j) => jusqua(async () => (await j.etat().catch(() => null))?.connexion === "ouvert", { ms: 60_000, quoi: `connexion de ${j.nom}` });
    for (let essai = 0; essai < 2 && (await couleurDe(A)) !== ORANGE; essai++) {
      for (const j of joueurs) await j.page.goto("about:blank");
      await dormir(1500);
      for (const j of [B, A]) { await ouvrir(j); await jusqua(() => ouvert(j), { ms: 30_000, quoi: `lobby de ${j.nom}` }); await connecte(j); await dormir(1000); }
    }
    const couleurA = await couleurDe(A);
    verifier(couleurA === ORANGE, `Alice n'a pas l'orange (${couleurA}), le cas d'un lanceur orange ne serait pas vérifié`);
    await dormir(800);
    await A.capture("01-lobby-1920");
    for (const j of joueurs) await j.ev(() => window.__arene.entrer({ principale: "sniper", secondaire: "revolver" }));
    for (const j of joueurs) await jusqua(async () => { const s = await j.jeu(); return s && s.apparu && s.vivant; }, { ms: 30_000, quoi: `apparition de ${j.nom}` });
    // « JOUER » du menu pause = prise de la souris (émulée) : le HUD de combat, Tab, M et N n'existent qu'en jeu
    for (const j of joueurs) {
      await jusqua(async () => {
        if ((await j.jeu()).verrouille) return true;
        await j.page.getByRole("button", { name: /^jouer$/i }).first().evaluate((e) => e.click()).catch(() => null);
        return false;
      }, { ms: 15_000, quoi: `prise de la souris de ${j.nom}` });
    }
    const pa = (await A.jeu()).p, pb = (await B.jeu()).p;
    const da = distXZ(pa, ROND_POINT), db = distXZ(pb, ROND_POINT);
    verifier(da >= 20 && da <= 145 && db >= 20 && db <= 145, `apparitions hors de l'anneau du rond-point : A ${da.toFixed(0)} m, B ${db.toFixed(0)} m`);
    return `A à ${da.toFixed(0)} m, B à ${db.toFixed(0)} m du rond-point`;
  });
  if (!demarre) throw new Error("impossible d'entrer en arène : scénario interrompu");
  participants = joueurs;

  // ------------------------------------------------------------------ outils propres aux tigres
  const [idA, idB] = await jusqua(async () => { const a = await A.id(), b = await B.id(); return a && b ? [a, b] : false; }, { ms: 30_000, quoi: "ids de joueur" });
  const tigresDe = (j) => j.ev(() => window.__arene.tigres());
  const sauvage = async (j) => (await tigresDe(j))?.tigres.find((t) => t.genre === "sauvage") ?? null;
  /** Oriente la vue de `j` vers le point `p` (œil courant). */
  async function regarderVers(j, p) {
    const s = await j.jeu();
    const o = s.oeil;
    const dx = p[0] - o[0], dy = p[1] - o[1], dz = p[2] - o[2];
    await j.ev(([l, t]) => window.__arene.regarder(l, t), [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))]);
  }
  /**
   * Point libre (loin des routes et des bâtiments) à `d` m de `c` (x, z), dans la direction `angle` ou la plus proche qui convienne. Avec
   * `vise` (x, z), le point doit aussi le voir sans bâtiment entre eux (`vueLibre`), à défaut un point libre sans cette condition.
   */
  function pres(c, d, angle, vise = null) {
    for (const exigerVue of vise ? [true, false] : [false]) {
      for (let k = 0; k < 32; k++) {
        const a = angle + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 16);
        const x = c[0] + Math.cos(a) * d, z = c[2] + Math.sin(a) * d;
        if (estLibre(x, z, 6, 3) && (!exigerVue || vueLibre(x, z, vise))) return [x, 0, z];
      }
    }
    const [x, z] = pointLibre(c[0] + Math.cos(angle) * d, c[2] + Math.sin(angle) * d, { c: [c[0], c[2]], r: 0.75 * d });
    return [x, 0, z];
  }
  /**
   * Amène `j` à `d` m du point `c` (x, y, z), à l'angle `angle` ou au plus près où il voit `vise` (x, z) : d'abord à `d` m de son côté, en
   * ligne droite vers `c`, puis le long du cercle de rayon `d` par pas de π/8 au plus. Il ne passe jamais plus près que `d` m de `c` (à la
   * tolérance de pose près) : un tigre tapi ne s'alerte pas (20 m). Renvoie la position visée.
   */
  async function approcher(j, autre, c, d, angle, vise) {
    const cote = (p) => Math.atan2(p[2] - c[2], p[0] - c[0]);
    // ni les étapes intermédiaires de `poser` ni un point de repli de `pres` ne s'approchent à moins de d − 4 m
    const eviter = { c: [c[0], c[2]], r: d - 4 };
    await poser(j, autre, pres(c, d, cote((await j.jeu()).p)), 2.5, eviter);
    const but = pres(c, d, angle, vise);
    const depart = cote((await j.jeu()).p);
    const delta = Math.atan2(Math.sin(cote(but) - depart), Math.cos(cote(but) - depart));
    const n = Math.ceil(Math.abs(delta) / (Math.PI / 8));
    for (let i = 1; i < n; i++) await poser(j, autre, pres(c, d, depart + (delta * i) / n), 2.5, eviter);
    await poser(j, autre, but, 2.5, eviter);
    return but;
  }
  /** Les deux joueurs vivants et apparus (réapparition après une mort comprise). */
  async function vivants(ms = 40_000) {
    for (const j of joueurs) await jusqua(async () => { const s = await j.jeu(); return s.vivant && s.apparu && !s.killcam; }, { ms, quoi: `${j.nom} vivant` });
  }
  /** Texte visible du HUD (fil, toasts, annonces) de `j`. */
  const texteHud = (j) => j.ev(() => document.body.textContent ?? "");

  /**
   * Avion et largage observés par A : avion en vol (capture), `avion{largage}`, `tigre{apparu}` chez A et B, annonce au HUD de A, tigre en
   * descente sous son parachute (capture). Renvoie le message de largage.
   */
  async function observerLargage(depuis, suffixe) {
    const passage = await jusqua(async () => (await tigresDe(A))?.avion ?? null, { ms: 90_000, pas: 300, quoi: async () => `avion en vol chez A (${A.resume(depuis)}, ${JSON.stringify(await tigresDe(A)).slice(0, 300)})` });
    await regarderVers(A, passage.p);
    await dormir(300);
    const vu = (await tigresDe(A)).avion;
    if (vu) await regarderVers(A, vu.p);
    await A.capture(`02-avion-${suffixe}-A-1920`);
    const largage = await jusqua(() => A.msgs("avion", depuis).find((m) => m.evenement === "largage" && m.tigre) ?? null, { ms: 60_000, pas: 200, quoi: `largage (${A.resume(depuis)})` });
    await jusqua(() => A.msgs("tigre", depuis).some((m) => m.evenement === "apparu" && m.id === largage.tigre), { ms: 5000, quoi: "tigre{apparu} chez A" });
    await jusqua(() => B.msgs("tigre", depuis).some((m) => m.evenement === "apparu" && m.id === largage.tigre), { ms: 5000, quoi: "tigre{apparu} chez B" });
    // l'annonce reste 8 s dans le fil, le toast 2,5 s
    await jusqua(async () => (await texteHud(A)).includes("Un tigre a été largué"), { ms: 6000, quoi: "annonce « Un tigre a été largué ! » au HUD de A" });
    const enVol = await jusqua(async () => { const t = await sauvage(A); return t && t.etat === "descente" ? t : null; }, { ms: 5000, quoi: "tigre en descente dans les snaps de A" });
    await regarderVers(A, [enVol.p[0], enVol.p[1] + 3, enVol.p[2]]);
    await dormir(300);
    const t2 = await sauvage(A);
    if (t2 && t2.etat === "descente") await regarderVers(A, [t2.p[0], t2.p[1] + 3, t2.p[2]]);
    await A.capture(`03-largage-parachute-${suffixe}-A-1920`);
    return { largage, passage, enVol };
  }

  // ------------------------------------------------------------------ 2. premier tigre sauvage
  // L'avion passe dès que les deux joueurs sont en arène : le premier tigre est souvent posé avant la fin de l'étape 1. L'avion et le
  // parachute sont donc observés à l'étape 5, au passage qui suit la mort de ce tigre.
  let tigreId = null;
  await etape("2. un avion largue un premier tigre sauvage (avion, tigre{apparu}, annonce au HUD)", async () => {
    await vivants();
    const t0 = await jusqua(async () => {
      const t = await sauvage(A);
      if (t) return t;
      // pas encore de tigre : le passage en cours ou le suivant
      const av = (await tigresDe(A)).avion;
      if (av && !A.msgs("avion").some((m) => m.evenement === "largage" && m.avion?.id === av.passage.id)) await regarderVers(A, av.p);
      return null;
    }, { ms: 90_000, pas: 300, quoi: async () => `premier tigre (${A.resume(0)})` });
    tigreId = t0.id;
    const largage = A.msgs("avion").find((m) => m.evenement === "largage" && m.tigre === tigreId);
    verifier(largage, `aucun avion{largage} pour le tigre ${tigreId} chez A`);
    verifier(A.msgs("tigre").some((m) => m.evenement === "apparu" && m.id === tigreId), "tigre{apparu} absent chez A");
    verifier(B.msgs("tigre").some((m) => m.evenement === "apparu" && m.id === tigreId), "tigre{apparu} absent chez B");
    if (t0.etat === "descente") await A.capture("02-premier-tigre-descente-A-1920");
    return `tigre ${tigreId} (passage ${largage.avion.id}), état ${t0.etat} à ${t0.p.map((x) => x.toFixed(0)).join(", ")}`;
  });

  // ------------------------------------------------------------------ 3. le tigre se pose et se tapit
  await etape("3. le tigre se pose dans sa cachette et se tapit (vu de près)", async () => {
    verifier(tigreId, "pas de tigre");
    const t = await jusqua(async () => { const x = await sauvage(A); return x && x.id === tigreId && x.etat !== "descente" ? x : null; }, { ms: 30_000, pas: 300, quoi: "atterrissage du tigre" });
    // posé loin des joueurs (cachette à plus de 30 m d'eux au largage, et ils n'ont pas bougé) : il doit se tapir, AVANT toute approche
    const distances = async () => {
      const d = (await Promise.all(joueurs.map(async (j) => { const s = await j.jeu(); return `${j.nom} à ${distXZ(s.p, [t.p[0], t.p[2]]).toFixed(0)} m`; }))).join(", ");
      // alerte : le joueur qui l'a déclenchée (ou un tir, sans message d'alerte)
      const al = A.msgs("tigre").filter((m) => m.evenement === "alerte" && m.id === t.id).map((m) => (m.cible === idA ? "Alice" : m.cible === idB ? "Bob" : m.cible));
      return `${d}${al.length ? `, alerte par ${al.join(", ")}` : ""}`;
    };
    await jusqua(async () => (await sauvage(A))?.etat === "tapi", { ms: 8000, pas: 200, quoi: async () => `tigre tapi après l'atterrissage (état ${(await sauvage(A))?.etat}, ${await distances()})` });
    // A s'approche de son côté et s'arrête à 28 m, hors du rayon d'alerte (20 m, tolérance de pose et repli des étapes intermédiaires
    // compris), puis tourne autour jusqu'à voir la tête : le tigre doit rester tapi pendant qu'on le regarde
    const cote = (p) => Math.atan2(p[2] - t.p[2], p[0] - t.p[0]);
    // tête de la hitbox (la cible de `tirerVers`) en vue : aucun bâtiment entre le tireur et elle
    const teteT = (await sauvage(A)).hitbox.c;
    const vise = [teteT[0], teteT[2]];
    await approcher(A, B, t.p, 28, cote((await A.jeu()).p), vise);
    const t3 = await sauvage(A);
    verifier(t3, "le tigre a disparu");
    verifier(t3.etat === "tapi", `le tigre n'est plus tapi quand A arrive à 28 m (état ${t3.etat}, ${await distances()})`);
    await regarderVers(A, [t3.p[0], t3.p[1] + 0.6, t3.p[2]]);
    await dormir(800);
    await A.capture("04-tigre-tapi-A-1920");
    // B à 30 m, écarté de 0,8 rad de la ligne de A (du côté où B se trouve) : A ne lui masque pas le tigre
    const aA = cote((await A.jeu()).p);
    const ecartB = Math.atan2(Math.sin(cote((await B.jeu()).p) - aA), Math.cos(cote((await B.jeu()).p) - aA));
    await approcher(B, A, t.p, 30, aA + (ecartB >= 0 ? 0.8 : -0.8), vise);
    // le sauvage vu par B, à comparer au tigre allié vu par B à l'étape 6 (plaque et liseré)
    const t5 = await sauvage(B);
    verifier(t5?.etat === "tapi", `le tigre n'est plus tapi quand B arrive à 30 m (état ${t5?.etat}, ${await distances()})`);
    await regarderVers(B, [t5.p[0], t5.p[1] + 0.8, t5.p[2]]);
    await dormir(700);
    await B.capture("04-tigre-tapi-vu-par-B-1920");
    // calage de la silhouette de touche sur le GLB dessiné : écart entre le centre de la tête dessinée (milieu de l'os de la tête et du bout
    // du museau) et la sphère de tête de la hitbox, dans la pose du moment
    const t4 = (await A.ev(() => window.__arene.tigres(true)))?.tigres.find((x) => x.genre === "sauvage") ?? null;
    let calage = "rendu non mesuré";
    if (t4?.rendu) {
      const r = t4.rendu, c = t4.hitbox.c;
      const tete = [0, 1, 2].map((k) => (r.tete[k] + r.museau[k]) / 2);
      const ecart = Math.hypot(tete[0] - c[0], tete[1] - c[1], tete[2] - c[2]);
      calage = `tête dessinée à ${ecart.toFixed(2)} m du centre de la tête de la hitbox (rayon ${t4.hitbox.rTete} m, pose ${t4.pose})`;
      verifier(ecart < 0.6, `silhouette de touche décalée du tigre dessiné : ${calage}`);
    }
    return `posé en ${t3.p.map((x) => x.toFixed(1)).join(", ")}, état ${t3.etat}, GLB ${(await tigresDe(A)).modele ? "chargé" : "ABSENT (silhouette de repli)"}, ${calage}`;
  });

  // ------------------------------------------------------------------ 4. A abat le tigre
  await etape("4. A abat le tigre (B l'aide puis s'arrête), retour de touche, fil « a abattu le tigre », sort gagné", async () => {
    verifier(tigreId, "pas de tigre");
    const depuis = Date.now();
    let captureAttaque = false;
    let mort = null;
    const fin = Date.now() + 150_000;
    /** tirs partis (`tirerVers` vrai) et touches confirmées : 20 tirs de suite sans touche arrêtent l'étape, avec le contexte des derniers */
    const tirs = [];
    let touchesVues = 0, sansTouche = 0;
    /** tigre au galop vu par un tireur (capture, calage de la tête dessinée sur la hitbox « course ») et tigre au contact de A (capture) */
    let galop = null, contact = false;
    /** galop vu de profil par le joueur que le tigre ne charge pas (allure et pieds au sol lisibles), deux images */
    let profil = null;
    while (Date.now() < fin && !mort) {
      mort = A.msgs("tigre", depuis).find((m) => m.evenement === "mort" && m.id === tigreId) ?? null;
      if (mort) break;
      const t = await sauvage(A);
      if (!t || t.id !== tigreId) { await dormir(150); continue; }
      for (const j of joueurs) {
        const s = await j.jeu();
        if (!s.vivant || !s.apparu) continue;
        // B tire tant que le tigre a plus de 700 PV, puis laisse A l'achever
        if (j === B && t.pv <= 700) continue;
        const d = Math.hypot(t.p[0] - s.p[0], t.p[2] - s.p[2]);
        if (d > 40) {
          // le tigre s'enfuit vers une autre cachette (ou le joueur vient de réapparaître) : on le rejoint par étapes acceptées du serveur, à
          // 28 m et en vue de sa tête. À 16 m, un tigre qui attaque (10,5 m/s) arrivait au contact en 1,5 s et, sous le rendu logiciel (un tir
          // par seconde environ), tuait les deux joueurs plus vite qu'ils ne l'abattaient (13 morts en 150 s, tigre vivant)
          await poser(j, j === A ? B : A, pres(t.p, 28, Math.atan2(s.p[2] - t.p[2], s.p[0] - t.p[0]), [t.hitbox.c[0], t.hitbox.c[2]])).catch(() => null);
          continue;
        }
        const parti = await j.ev((id) => window.__arene.tirerVers(id), tigreId);
        if (!parti) continue;
        tirs.push(`${j.nom} à ${d.toFixed(1)} m, ${t.etat}/${t.pose}${t.action ? `/${t.action}` : ""} v=${t.v.toFixed(1)}`);
        const touches = A.msgs("tigre", depuis).filter((m) => m.evenement === "touche" && m.id === tigreId && m.par).length;
        if (touches > touchesVues) { touchesVues = touches; sansTouche = 0; } else sansTouche++;
        verifier(sansTouche < 20, `${sansTouche} tirs de suite sans touche confirmée (${touchesVues} touches avant), derniers tirs : ${tirs.slice(-6).join(" | ")}`);
        // `tirerVers` vient de tourner la vue de j vers la tête du tigre : les captures le cadrent
        if (!galop && t.pose === "course" && t.v > 8 && !t.action && d < 30) {
          const tm = (await j.ev(() => window.__arene.tigres(true)))?.tigres.find((x) => x.id === tigreId);
          if (tm?.rendu && tm.pose === "course" && tm.v > 8) {
            const r = tm.rendu, c = tm.hitbox.c;
            const ecart = Math.hypot(...[0, 1, 2].map((k) => (r.tete[k] + r.museau[k]) / 2 - c[k]));
            galop = `galop à ${tm.v.toFixed(1)} m/s vu par ${j.nom} à ${d.toFixed(0)} m, tête dessinée à ${ecart.toFixed(2)} m du centre de la tête de la hitbox (rayon ${tm.hitbox.rTete} m)`;
            verifier(ecart < 0.6, `silhouette de touche décalée du tigre au galop : ${galop}`);
            await j.capture(`05-tigre-galop-${j.nom[0]}-1920`);
          }
        }
        if (!contact && j === A && d < 4) {
          contact = true;
          await A.capture("05-tigre-contact-A-1920");
        }
      }
      if (!profil && t.pose === "course" && t.v > 8 && !t.action) {
        // direction de course (cap en convention lacet) et ligne de vue de chaque joueur : profil si elles font plus de 45°
        const f = [-Math.sin(t.cap), -Math.cos(t.cap)];
        for (const j of joueurs) {
          const s = await j.jeu();
          if (!s.vivant || !s.apparu || s.killcam) continue;
          const u = [t.p[0] - s.p[0], t.p[2] - s.p[2]], d = Math.hypot(u[0], u[1]);
          const sinus = Math.abs(f[0] * u[1] - f[1] * u[0]) / Math.max(d, 1e-6);
          if (d < 6 || d > 35 || sinus < 0.7) continue;
          for (let i = 1; i <= 2; i++) {
            const tv = await sauvage(j);
            if (!tv || tv.pose !== "course") break;
            await regarderVers(j, [tv.p[0], tv.p[1] + 0.9, tv.p[2]]);
            await j.capture(`05-tigre-galop-profil-${j.nom[0]}-${i}-1920`);
            profil = `galop vu de profil par ${j.nom} à ${d.toFixed(0)} m (${(Math.asin(Math.min(1, sinus)) * 180 / Math.PI).toFixed(0)}° de la direction de course, v=${tv.v.toFixed(1)} m/s)`;
          }
          break;
        }
      }
      if (!captureAttaque && (t.etat === "attaque" || t.action)) {
        captureAttaque = true;
        await A.capture("05-tigre-attaque-A-1920");
      }
      await dormir(90);
    }
    verifier(mort, `le tigre n'est pas mort (${A.resume(depuis)})`);
    verifier(mort.par === idA, `le dernier coup n'est pas de A (par ${mort.par})`);
    const touches = A.msgs("tigre", depuis).filter((m) => m.evenement === "touche" && m.id === tigreId && m.par === idA);
    verifier(touches.length > 0, "aucune touche de A confirmée sur le tigre");
    await jusqua(() => A.msgs("sort", depuis).some((m) => m.evenement === "gagne" && m.joueur === idA), { ms: 3000, quoi: "sort{gagne} pour A" });
    await jusqua(async () => (await texteHud(A)).includes("Vous avez abattu le tigre"), { ms: 3000, quoi: "fil de A : « Vous avez abattu le tigre »" });
    await jusqua(async () => /Alice a abattu le tigre/.test(await texteHud(B)), { ms: 3000, quoi: "fil de B : « Alice a abattu le tigre »" });
    await A.capture("06-tigre-abattu-A-1920");
    const hud = (await A.etat()).hud;
    await jusqua(async () => (await A.etat()).hud?.sort === true, { ms: 3000, quoi: `icône du sort au HUD de A (hud.sort ${hud?.sort})` });
    await jusqua(async () => A.ev(() => !!document.querySelector("section[aria-label='Sort d\\'invocation disponible']")), { ms: 3000, quoi: "icône du sort dans le DOM de A" });
    await A.capture("07-icone-sort-A-1920");
    const pvVus = touches.map((m) => m.pv);
    return `${touches.length} touches de A confirmées (PV ${pvVus[0]} → ${pvVus.at(-1)}), tête : ${touches.filter((m) => m.zone === "tete").length}, tué par A, sort gagné, ${tirs.length} tirs en tout, ${galop ?? "galop non observé de près"}, contact avec A ${contact ? "capturé" : "non observé"}, ${profil ?? "galop de profil non observé"}`;
  });

  // ------------------------------------------------------------------ 5. l'avion suivant, vu de près
  let deuxieme = null;
  await etape("5. le tigre mort, un nouvel avion passe et largue un tigre en parachute, vus par A, annonce au HUD", async () => {
    await vivants();
    const depuis = Date.now() - 3000;
    const r = await observerLargage(depuis, "suivant");
    deuxieme = r.largage.tigre;
    return `passage ${r.passage.passage.id}, tigre ${deuxieme} en descente à ${r.enVol.p[1].toFixed(0)} m d'altitude, à ${Math.hypot(r.enVol.p[0] - (await A.jeu()).p[0], r.enVol.p[2] - (await A.jeu()).p[2]).toFixed(0)} m de A`;
  });

  // ------------------------------------------------------------------ 6. A lance le sort
  let allieId = null;
  await etape("6. A lance le sort (touche G) : tigre allié à côté de lui, liseré de sa couleur, vu par B", async () => {
    await vivants();
    const charge = (await tigresDe(A)).charge;
    verifier(charge, "A n'a plus de charge du sort (mort entre-temps ?)");
    // loin (60 m et plus) du nouveau tigre sauvage, qui ne doit pas se mêler du duel
    const s2 = await sauvage(A);
    if (s2) {
      const sA0 = await A.jeu();
      if (Math.hypot(sA0.p[0] - s2.p[0], sA0.p[2] - s2.p[2]) < 60) await poser(A, B, pres(s2.p, 75, Math.atan2(sA0.p[2] - s2.p[2], sA0.p[0] - s2.p[0])));
    }
    const sA = await A.jeu();
    // B à 25 m de A (hors de portée du tigre allié, 18 m) pour le regarder apparaître
    await poser(B, A, pres(sA.p, 25, 0));
    const depuis = Date.now();
    await A.appui("KeyG");
    const lance = await jusqua(() => A.msgs("sort", depuis).find((m) => m.evenement === "lance" && m.joueur === idA) ?? null, { ms: 5000, quoi: `sort{lance} (${A.resume(depuis)})` });
    allieId = lance.tigre;
    const t = await jusqua(async () => (await tigresDe(A)).tigres.find((x) => x.id === allieId) ?? null, { ms: 5000, quoi: "tigre allié dans les snaps" });
    verifier(t.genre === "allie" && t.lanceur === idA, `tigre allié mal décrit : ${JSON.stringify(t)}`);
    verifier(Math.hypot(t.p[0] - sA.p[0], t.p[2] - sA.p[2]) < 4, "le tigre allié n'est pas apparu à côté de A");
    verifier((await A.etat()).hud?.sort === false, "l'icône du sort reste affichée après le lancer");
    await regarderVers(A, [t.p[0], t.p[1] + 0.6, t.p[2]]);
    await dormir(700);
    await A.capture("08-tigre-allie-A-1920");
    const t2 = (await tigresDe(B)).tigres.find((x) => x.id === allieId);
    if (t2) await regarderVers(B, [t2.p[0], t2.p[1] + 0.8, t2.p[2]]);
    await dormir(700);
    await B.capture("08-tigre-allie-vu-par-B-1920");
    const couleurA = A.recus.filter((r) => r.t === "presence" || r.t === "bienvenue").map((r) => r.m.joueurs?.find((x) => x.id === idA)?.couleur).filter(Boolean).at(-1);
    const dB = Math.hypot(t.p[0] - (await B.jeu()).p[0], t.p[2] - (await B.jeu()).p[2]);
    return `tigre ${allieId} à ${Math.hypot(t.p[0] - sA.p[0], t.p[2] - sA.p[2]).toFixed(1)} m de A, vu par B à ${dB.toFixed(0)} m, couleur d'Alice ${couleurA ?? "inconnue"}`;
  });

  // ------------------------------------------------------------------ 7. le tigre allié attaque B
  await etape("7. le tigre allié attaque B : dégâts crédités à A, élimination « Tigre » au fil", async () => {
    verifier(allieId, "pas de tigre allié");
    const depuis = Date.now();
    const sA = await A.jeu();
    // B à 9 m de A, à découvert : le joueur ennemi le plus proche du lanceur, à moins de 18 m et en vue
    await poser(B, A, pres(sA.p, 9, Math.PI / 2));
    const coup = await jusqua(() => B.msgs("degats", depuis).find((m) => m.cible === idB && m.par === idA) ?? null, { ms: 20_000, quoi: `coup du tigre allié sur B (${B.resume(depuis)})` });
    const t = (await tigresDe(B)).tigres.find((x) => x.id === allieId);
    if (t) await regarderVers(B, [t.p[0], t.p[1] + 0.8, t.p[2]]);
    await B.capture("09-attaque-tigre-allie-B-1920");
    if (t) await regarderVers(A, [t.p[0], t.p[1] + 0.6, t.p[2]]);
    await A.capture("09-attaque-tigre-allie-A-1920");
    // B ne riposte pas : le tigre (15 dégâts par seconde) l'élimine en 7 s environ, avant la fin de ses 30 s
    const mort = await jusqua(() => B.msgs("mort", depuis).find((m) => m.cible === idB) ?? null, { ms: 30_000, quoi: `mort de B (${B.resume(depuis)})` });
    verifier(mort.cause === "tigre" && mort.par === idA, `mort de B : cause ${mort.cause}, par ${mort.par}`);
    await jusqua(async () => /Tigre/.test(await A.ev(() => document.querySelector("ul[aria-label='Éliminations']")?.textContent ?? "")), { ms: 3000, quoi: "ligne « Tigre » au fil de A" });
    await A.capture("10-fil-kill-tigre-A-1920");
    const coups = B.msgs("degats", depuis).filter((m) => m.cible === idB && m.par === idA);
    return `${coups.length} coups de patte de ${coup.degats} dégâts, B éliminé, cause tigre, kill crédité à A`;
  });


  // ------------------------------------------------------------------ erreurs de page
  await etape("8. aucune erreur JavaScript dans les deux pages", async () => {
    const bruit = (e) => /favicon|Failed to load resource|net::ERR|api\/pdj|api\/carte|GPU stall|WebGL|ReadPixels|swiftshader/i.test(e);
    const toutes = joueurs.flatMap((j) => j.erreurs.filter((e) => !bruit(e)).map((e) => `${j.nom} ${e}`));
    verifier(toutes.length === 0, toutes.slice(0, 6).join(" | "));
    const coupures = joueurs.flatMap((j) => j.fermetures.map((f) => `${j.nom} (étape « ${f.etape.slice(0, 40)} »)`));
    verifier(coupures.length === 0, `WebSocket coupée en cours de partie : ${coupures.join(" | ")}`);
    const serveurErreurs = [...joueurs.flatMap((j) => j.recus.filter((r) => r.t === "erreur").map((r) => `${j.nom} ${JSON.stringify(r.m)}`))];
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
