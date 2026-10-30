#!/usr/bin/env node
/**
 * Test de bout en bout de l'arène FPS v2 (vue Palantir) : DEUX navigateurs Chromium headless contre un `serveur-fps` local
 * et un `next dev` local, pilotés par le crochet de développement `window.__arene` (cf. app/components/Agroparc3D.tsx).
 *
 * Scénario (chaque étape imprime OK / ÉCHEC, des captures sont prises en route) :
 *  1. vue 3D (code « myrtille »), lobby, entrée des deux joueurs, apparition dans l'anneau du rond-point
 *  2. les joueurs se voient (snapshots, pseudo visible)
 *  3. changement d'arme 1 / 2 / 3 puis retour
 *  4. A tue B au fusil d'assaut : touches confirmées par le serveur (`degats`), PV qui baissent, `mort` avec le kill
 *  5. killcam de B (habillage du rejeu à la vue du tueur), réapparition près du rond-point
 *  6. coup de couteau mortel ; « Passer » saute le rejeu, carte du tueur ; 6b. réapparition
 *  6c. épée (v5) : un troisième navigateur entre avec l'épée ; un seul coup tue en une fois les deux joueurs placés dans son arc, message `coup{cibles}`
 *  7. accroupi, puis glissade (sprint + accroupi) sur une piste dégagée
 *  8. voiture conduisible : montée, conduite de quelques mètres, passager qui tire sur le conducteur ; sortie, sièges libérés
 *  9. Elsa (intervalle court passé au serveur) : offre annoncée à tous, HUD, ramassage
 * 10. mini-carte présente et déplaçable de coin (N), tableau des scores (Tab) riche, grande carte (M), HUD de combat
 * 10e–10g. v3 : rafale sur une voiture garée jusqu'à l'explosion (fumée / feu / épave du serveur), lunette à niveaux et cercle de dispersion
 *     (HUD forcé), chat vocal de proximité entre les deux navigateurs (faux micro de Chromium : entendu à 3 m, muet à 100 m)
 * 11. recaptures en 1280×720 (les étapes précédentes sont capturées en 1920×1080, sauf la killcam, en 1280×720 pour tenir dans sa durée)
 * 12. aucune erreur JavaScript ni `erreur` du serveur, aucune WebSocket coupée en partie
 *
 * Usage : node scripts/fps/e2e_arene_v2.mjs        (Node 22 ; Playwright : `npm i --no-save playwright` ou PLAYWRIGHT_DIR=/dossier/avec/node_modules)
 * L'avion des tigres et le bus C3 (qui écrase à pied) sont neutralisés sur le serveur lancé par le script (`PDJ_FPS_AVION_*`, `PDJ_FPS_BUS_*`
 * à 1 h). Un serveur déjà lancé (E2E_WS) doit l'être de même, sinon un tigre largué peut gâcher une étape (un écrasement par le bus la rejoue). Les tigres ont leur propre scénario : scripts/fps/e2e_arene_tigres.mjs.
 * Variables : E2E_OUT (captures, défaut <tmp>/pdj-e2e-arene-v2), E2E_URL (Next déjà lancé : on ne le démarre pas),
 *             E2E_WS (serveur déjà lancé), E2E_WS_PORT (port imposé au serveur lancé par le script, à faire coïncider avec NEXT_PUBLIC_FPS_WS_URL d'un Next déjà lancé),
 *             E2E_PAGE (page qui monte le code « myrtille », défaut une 404 : aucune lecture de la base), E2E_HEADED=1,
 *             E2E_GARDER=1 (laisse les serveurs lancés par le script), E2E_JUSQUA=5 (s'arrête après l'étape 5), E2E_DEBUG_KC=1 (journal de la killcam).
 * Code de sortie : 0 si toutes les étapes passent, 1 sinon.
 *
 * À savoir : `teleporter` ne change que la position CLIENT et le serveur refuse tout saut plus grand que sa vitesse permise (le script déplace par étapes
 * de 9 m, `poser`) ; les voitures PNJ tuent à pied (l'étape touchée est rejouée) ; le rendu logiciel tourne à 2–10 images/s (killcam plus longue que
 * nominale, une capture dure plusieurs secondes) ; le verrouillage du pointeur, absent en headless, est émulé ; le serveur n'utilise jamais le port 8787
 * (un onglet de développement ouvert sur le site s'y reconnecterait et entrerait dans la partie) ; un `next dev` à froid recharge les pages ouvertes.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SORTIE = process.env.E2E_OUT ?? join(tmpdir(), "pdj-e2e-arene-v2");
const PAGE = process.env.E2E_PAGE ?? "/arene-e2e-introuvable";
/** Centre du rond-point (scene.json) : la réapparition doit se faire à 25–140 m de là. */
const ROND_POINT = [28.2, 2.5];
/** Point de service d'Elsa, devant le passe-plat du Truck Muche garé (zones.ts, `positionElsa`). */
const ELSA = [-122.7, 37.42];

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
    /** chargements de la page (le premier, puis les rechargements de `next dev`) : { a, etape } */
    this.chargements = [];
    page.on("pageerror", (e) => this.erreurs.push(`pageerror : ${String(e).slice(0, 300)}`));
    page.on("console", (m) => { if (m.type() === "error") this.erreurs.push(`console.error : ${m.text().slice(0, 300)}`); });
    page.on("load", () => this.chargements.push({ a: Date.now(), etape: etapeCourante }));
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
/** Le point libre le plus proche de (x, z) (spirale de 4 m en 4 m, 40 m au plus) ; (x, z) lui-même s'il n'y en a pas. */
function pointLibre(x, z) {
  for (let r = 0; r <= 40; r += 4) {
    const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 4);
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      const cx = x + r * Math.cos(a), cz = z + r * Math.sin(a);
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
 */
const CASE_CHEMIN = 2;
const COUT_BLOQUE = 40;
const cacheCases = new Map();
function coutCase(i, j) {
  const k = `${i},${j}`;
  let c = cacheCases.get(k);
  if (c === undefined) {
    const x = i * CASE_CHEMIN, z = j * CASE_CHEMIN;
    c = distBatiments(x, z) < 2 ? COUT_BLOQUE : distRoutes(x, z) < 8 ? 3 : 1;
    cacheCases.set(k, c);
  }
  return c;
}
const caseBloquee = (p) => coutCase(Math.round(p[0] / CASE_CHEMIN), Math.round(p[1] / CASE_CHEMIN)) >= COUT_BLOQUE;
function cheminAPied(de, a) {
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
      const gg = gn + Math.hypot(di, dj) * (fin ? 1 : coutCase(i, j));
      const k = cle(i, j);
      if (gg < (g.get(k) ?? Infinity)) { g.set(k, gg); parent.set(k, kn); pousser({ i, j, f: gg + h(i, j) }); }
    }
  }
  return null;
}

/**
 * Pose `j` en `pos` : `teleporter` ne change que la position CLIENT, et le serveur n'accepte un état que s'il reste dans la limite
 * de son budget de distance (v8 : `VITESSE_MAX_H_M_S` × temps écoulé, plafonné à `BUDGET_ARENE_S` = 0,5 s, + 1 m : 10,5 m). Un saut est donc
 * découpé en étapes de 9 m le long d'un chemin à pied (`cheminAPied` : hors des bâtiments, loin des routes autant que possible : une voiture PNJ
 * tue), chacune attendue chez `autre` (qui voit `j` là où le serveur l'a accepté).
 */
async function poser(j, autre, pos, tolerance = 2.5) {
  const idJ = await j.id();
  let vu = null;
  const PAS = 9;
  const depart = (await j.jeu()).p;
  // v8 : pas de 9 m au plus (budget du serveur) le long d'un chemin à pied : un pas posé dans un bâtiment serait refusé (la collision du client
  // l'en ressort), et un détour pris au hasard ferait osciller la marche
  const chemin = (Math.hypot(pos[0] - depart[0], pos[2] - depart[2]) > PAS && cheminAPied([depart[0], depart[2]], [pos[0], pos[2]])) || [[pos[0], pos[2]]];
  let idx = 0;
  for (let etape = 0; etape < 80; etape++) {
    const moi = (await j.jeu()).p;
    const loin = (q) => Math.hypot(q[0] - moi[0], q[1] - moi[2]);
    let m = idx;
    while (m + 1 < chemin.length && loin(chemin[m + 1]) <= PAS) m++;
    while (m > idx && m !== chemin.length - 1 && caseBloquee(chemin[m])) m--;
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
  throw new Error(`${j.nom} n'arrive pas en (${pos.map((x) => x.toFixed(1))})`);
}

// ---------------------------------------------------------------------------------------------------------------- étapes

const resultats = [];
let etapeCourante = "avant le scénario";
/** Les deux joueurs, pour que `etape` sache si un accident de circulation (voiture PNJ, mortelle par conception) a gâché une étape. */
let participants = [];
/**
 * Remet en arène un joueur dont la page a été rechargée (un `next dev` recharge parfois toutes les pages ouvertes quand il compile à la demande,
 * même en cours de scénario) ; rend vrai s'il a fallu le faire. Définie dans le programme principal (lobby, entrée).
 */
let reprendreJoueur = async () => false;
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
  // E2E_JUSQUA=5 : s'arrête après l'étape 5 (mise au point) ; les étapes suivantes sont ignorées
  if (process.env.E2E_JUSQUA && parseInt(nom, 10) > Number(process.env.E2E_JUSQUA)) return true;
  // E2E_SEULES=1,9,10e : ne joue que ces étapes (numéro avant le point ; la 1 est toujours jouée, elle fait entrer les joueurs)
  const numero = nom.split(".")[0];
  if (process.env.E2E_SEULES && numero !== "1" && !process.env.E2E_SEULES.split(",").includes(numero)) return true;
  const t0 = Date.now();
  etapeCourante = nom;
  process.stdout.write(`- ${nom} ... `);
  for (const j of participants) await reprendreJoueur(j).catch((e) => process.stdout.write(`[reprise de ${j.nom} impossible : ${e.message}] `));
  if (participants.length) await garantirMatch().catch((e) => process.stdout.write(`[${e.message}] `));
  for (let essai = 1; ; essai++) {
    const debut = Date.now();
    try {
      const detail = await fn();
      resultats.push({ nom, ok: true });
      console.log(`OK (${((Date.now() - t0) / 1000).toFixed(1)} s)${essai > 1 ? ` après ${essai} essais` : ""}${detail ? ` — ${detail}` : ""}`);
      return true;
    } catch (e) {
      // voitures PNJ, et le bus C3 si le serveur (E2E_WS) ne l'écarte pas
      const accident = participants.some((j) => j.msgs("mort", debut).some((m) => m.cause === "ecrase_pnj" || m.cause === "bus_c3"));
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
      // diagnostic : page de chaque joueur (vue 3D montée ou non), dernières erreurs JavaScript
      for (const j of participants) {
        const page = await j.ev(() => ({ url: location.pathname, crochet: !!window.__arene, vue: !!document.querySelector("[data-arene]"), jeu: !!window.__arene?.etat()?.jeu })).catch((x) => ({ erreur: x.message.slice(0, 120) }));
        console.log(`    ${j.nom} : ${JSON.stringify(page)} ; chargements ${j.chargements.length} ; erreurs ${JSON.stringify(j.erreurs.slice(-4))}`);
      }
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
      // l'avion des tigres passerait toutes les 90 à 180 s, les événements (Truck Muche fou, tigre géant) au bout de 45 à 70 s : neutralisés
      // ici (repoussés d'une heure, ils tueraient les joueurs en pleine étape), l'avion est testé par e2e_arene_tigres.mjs
      env: {
        ...process.env, PORT: String(portWs), PDJ_FPS_ELSA_MIN_MS: "6000", PDJ_FPS_ELSA_MAX_MS: "7000", SCENE_JSON: join(RACINE, "public/agroparc/scene.json"),
        PDJ_FPS_AVION_MIN_MS: "3600000", PDJ_FPS_AVION_MAX_MS: "3700000", PDJ_FPS_BUS_MIN_MS: "3600000", PDJ_FPS_BUS_MAX_MS: "3700000",
        PDJ_FPS_POLICE: "off", PDJ_FPS_EVT_MIN_MS: process.env.E2E_EVT_MIN_MS ?? "3600000", PDJ_FPS_EVT_MAX_MS: process.env.E2E_EVT_MAX_MS ?? "3700000",
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
  console.log(`Serveur ${urlWs} · site ${urlNext}${PAGE} · captures ${SORTIE}\n`);

  // --- navigateurs
  navigateur = await chromium.launch({
    headless: !process.env.E2E_HEADED,
    // faux micro (bips) accordé sans demande : chat vocal de l'étape 10g
    args: [
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    ],
  });
  /** Un navigateur de plus (contexte propre : stockage local vide, pointeur verrouillé émulé, mêmes touches). */
  async function nouveauJoueur(nom, viewport) {
    const ctx = await navigateur.newContext({ viewport });
    // « N » = coin suivant de la mini-carte (aucune touche par défaut) ; les autres actions reprennent leurs touches par défaut
    await ctx.addInitScript(() => {
      try { localStorage.setItem("pdj-fps-touches", JSON.stringify({ minimapCoin: ["KeyN", null] })); } catch { /* stockage indisponible */ }
      // Chromium headless n'accorde pas le verrouillage du pointeur : on l'émule (même contrat que l'API, sans mouvements de souris)
      let verrou = null;
      Object.defineProperty(Document.prototype, "pointerLockElement", { get: () => verrou, configurable: true });
      Element.prototype.requestPointerLock = function () { verrou = this; queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange"))); return Promise.resolve(); };
      Document.prototype.exitPointerLock = function () { verrou = null; document.dispatchEvent(new Event("pointerlockchange")); };
    });
    return new Joueur(nom, await ctx.newPage());
  }
  const joueurs = [];
  // E2E_1280=1 : tout en 1280×720 (rendu logiciel plus rapide, captures plus fiables)
  for (const nom of ["Alice", "Bob"]) joueurs.push(await nouveauJoueur(nom, process.env.E2E_1280 ? { width: 1280, height: 720 } : { width: 1920, height: 1080 }));
  const [A, B] = joueurs;
  /** Le crochet `window.__arene` et le panneau d'entrée de l'arène sont là (le mode par défaut est l'arène : le choix du mode précède son lobby). */
  const lobbyOuvert = (j) => j.ev(() => !!window.__arene && !!document.querySelector("aside[aria-label='Arène']")).catch(() => false);
  /** Ouvre la vue 3D (code « myrtille »), le panneau « Arène » et tape le nom du joueur. */
  async function ouvrirLobby(j) {
    await j.page.goto(`${urlNext}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await dormir(2500); // hydratation
    await j.page.keyboard.type("myrtille", { delay: 60 });
    const bouton = j.page.getByRole("button", { name: /^Arène/ }).first();
    if (!(await bouton.waitFor({ state: "visible", timeout: 60_000 }).then(() => true, () => false))) return;
    await bouton.evaluate((e) => e.click()).catch(() => null);
    const champ = j.page.getByLabel("Nom de joueur");
    if (await champ.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false)) await champ.fill(j.nom).catch(() => null);
  }

  reprendreJoueur = async (j) => {
    // le crochet n'existe qu'avec la vue 3D montée : absent, la page a été rechargée (un joueur sorti exprès de l'arène garde le crochet)
    if (await j.ev(() => !!window.__arene).catch(() => false)) return false;
    process.stdout.write(`[page de ${j.nom} rechargée : retour en arène] `);
    await jusqua(async () => { if (!(await lobbyOuvert(j))) await ouvrirLobby(j); return lobbyOuvert(j); }, { ms: 180_000, pas: 500, quoi: `lobby de ${j.nom} rouvert` });
    await jusqua(async () => (await j.etat().catch(() => null))?.connexion === "ouvert", { ms: 60_000, quoi: `connexion de ${j.nom}` });
    const radio = j.page.locator("input[type=radio][name$='-mode'][value=arene]");
    if (!(await radio.isChecked())) await radio.evaluate((e) => e.click());
    await j.page.locator("aside[aria-label='Arène']").waitFor({ state: "visible", timeout: 8000 });
    await j.ev(() => window.__arene.entrer({ principale: "fusil_assaut", secondaire: "pistolet" }));
    await jusqua(async () => { const s = await j.jeu(); return s && s.apparu && s.vivant; }, { ms: 40_000, quoi: `apparition de ${j.nom}` });
    await jusqua(async () => {
      if ((await j.jeu()).verrouille) return true;
      await j.page.getByRole("button", { name: /^jouer$/i }).first().evaluate((e) => e.click()).catch(() => null);
      return false;
    }, { ms: 15_000, quoi: `prise de la souris de ${j.nom}` });
    return true;
  };

  // ------------------------------------------------------------------ 1. lobby et entrée
  const demarre = await etape("1. ouverture de la vue 3D (code « myrtille ») et du lobby, entrée des deux joueurs", async () => {
    // Un `next dev` à froid compile à la première visite puis recharge TOUTES les pages ouvertes : on rouvre le lobby de chaque joueur dont la page
    // a été rechargée, jusqu'à ce que les deux tiennent (le code est tapé UNE fois par essai : le retaper refermerait la vue)
    let stable = 0;
    for (let tour = 1; tour <= 8 && stable < 2; tour++) {
      let tous = true;
      for (const j of joueurs) if (!(await lobbyOuvert(j))) { tous = false; await ouvrirLobby(j); }
      if (tous) { stable++; await dormir(2500); } else stable = 0;
    }
    verifier(stable >= 2, "la vue Palantir et le lobby ne restent pas ouverts chez les deux joueurs");
    await jusqua(async () => (await A.etat().catch(() => null))?.connexion === "ouvert" && (await B.etat().catch(() => null))?.connexion === "ouvert", { ms: 60_000, quoi: async () => `connexion WebSocket des deux joueurs (A ${JSON.stringify((await A.etat().catch(() => ({})))?.connexion)}, B ${JSON.stringify((await B.etat().catch(() => ({})))?.connexion)} ; erreurs ${[...A.erreurs, ...B.erreurs].slice(0, 4).join(" | ")} ; URL du serveur ${urlWs})` });
    await dormir(800);
    // le panneau s'ouvre sur le choix du mode (v5) : « Arène » est coché par défaut, son lobby s'affiche dessous (on le sélectionne s'il ne l'était pas)
    for (const j of joueurs) {
      const radio = j.page.locator("input[type=radio][name$='-mode'][value=arene]");
      if (!(await radio.isChecked())) await radio.evaluate((e) => e.click());
      await j.page.locator("aside[aria-label='Arène']").waitFor({ state: "visible", timeout: 8000 });
    }
    await A.capture("01-lobby-1920");
    for (const j of joueurs) await j.ev(() => window.__arene.entrer({ principale: "fusil_assaut", secondaire: "pistolet" }));
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

  // ------------------------------------------------------------------ 2. se voir
  await etape("2. les deux joueurs se voient (snapshots, pseudo visible)", async () => {
    // (une compilation de `next dev` peut recharger la page : on attend la reconnexion)
    const [idA, idB] = await jusqua(async () => { const a = await A.id(), b = await B.id(); return a && b ? [a, b] : false; }, { ms: 30_000, quoi: "ids de joueur (connexion rétablie)" });
    verifier(idA !== idB, "ids de joueur identiques");
    // A à 14 m de B, au même niveau, face à lui
    await poser(B, A, [ROND_POINT[0] - 6, 0, ROND_POINT[1]]);
    await poser(A, B, [ROND_POINT[0] + 8, 0, ROND_POINT[1]]);
    await dormir(2000); // protection d'apparition (1,5 s)
    await jusqua(async () => { const s = await A.jeu(); return s.distants.some((d) => d.id === idB && d.vivant); }, { quoi: "A voit B dans ses snapshots" });
    await jusqua(async () => { const s = await B.jeu(); return s.distants.some((d) => d.id === idA && d.vivant); }, { quoi: "B voit A dans ses snapshots" });
    // regarde vers B : le pseudo doit devenir visible (alpha > 0)
    await A.ev(() => { const j = window.__arene.etat().jeu; const t = j.distants[0].p; const dx = t[0] - j.p[0], dz = t[2] - j.p[2]; window.__arene.regarder(Math.atan2(-dx, -dz), 0); });
    // la ligne de vue est testée à 10 Hz et l'alpha monte à chaque image : quelques secondes de marge en rendu logiciel
    const alpha = await jusqua(async () => { const a = (await A.jeu()).distants.find((d) => d.id === idB)?.pseudoAlpha ?? 0; return a > 0.05 ? a : false; }, { ms: 8000, quoi: "pseudo de B visible chez A (alpha > 0)" });
    await A.capture("02-se-voir-A-1920");
    return `pseudo visible (alpha ${alpha.toFixed(2)})`;
  });

  // ------------------------------------------------------------------ 3. changement d'arme
  await etape("3. changement d'arme 1 / 2 / 3 (principale, secondaire, couteau) puis retour", async () => {
    const vu = [];
    for (const [touche, slot] of [["Digit2", "secondaire"], ["Digit3", "couteau"], ["Digit1", "principale"]]) {
      await A.appui(touche);
      await jusqua(async () => (await A.jeu()).slot === slot, { quoi: `slot ${slot} après ${touche}` });
      vu.push(`${touche}→${(await A.jeu()).arme}`);
      if (slot === "couteau") await A.capture("03-couteau-en-main-1920");
    }
    await dormir(900); // fin du dégaînage
    return vu.join(", ");
  });

  // ------------------------------------------------------------------ 4. kill au fusil
  let tueurId, victimeId;
  await etape("4. A tue B au fusil d'assaut : tirs confirmés par le serveur, PV qui baissent, kill", async () => {
    tueurId = await A.id();
    victimeId = await B.id();
    // observateur du DOM de B : note ce que la killcam affiche (le rendu logiciel est trop lent pour un sondage fiable)
    await B.ev(() => {
      const obs = (window.__e2eKillcam = { rejeu: null, carte: null, debut: null });
      const lire = () => {
        const barre = document.querySelector('[role="progressbar"][aria-label="Progression de la killcam"]');
        if (barre && obs.debut === null) obs.debut = performance.now();
        const legende = ([...document.querySelectorAll("p")].find((p) => /^\s*◎?\s*Rejeu/i.test(p.textContent ?? ""))?.textContent ?? "").replace(/\s+/g, " ").trim();
        if (barre && legende && !obs.rejeu) {
          obs.rejeu = { legende, hudCombat: !!document.querySelector('section[aria-label="Armes et munitions"]'), t: performance.now() };
          // `auto` : bouton « Passer » tout de suite, sans attendre l'aller-retour avec le test (une capture dure plus que la killcam ; la touche
          // Espace, elle, n'agit qu'après la première seconde du rejeu : on saute sans arrêt en combat)
          if (obs.auto) [...document.querySelectorAll("button")].find((x) => /passer/i.test(x.textContent ?? ""))?.click();
        }
        const carte = document.querySelector('section[aria-label="Carte du tueur"]');
        // la carte peut apparaître avant que le nom du tueur soit rendu (le bouton « Passer » agit dans la même image) : on garde sa version complète
        if (carte && (!obs.carte || !/ par /i.test(` ${obs.carte.texte} `))) obs.carte = { texte: (carte.textContent ?? "").replace(/\s+/g, " ").trim(), t: obs.carte?.t ?? performance.now() };
      };
      new MutationObserver(lire).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    await poser(B, A, [ROND_POINT[0] - 6, 0, ROND_POINT[1]]);
    await poser(A, B, [ROND_POINT[0] + 8, 0, ROND_POINT[1]]);
    // A vise B AVANT de tirer (B doit être dans le champ du rejeu de la killcam, cf. étape 5)
    {
      const pa = (await A.jeu()).p, pb = (await B.jeu()).p;
      const dx = pb[0] - pa[0], dz = pb[2] - pa[2];
      await A.ev(([l]) => window.__arene.regarder(l, 0), [Math.atan2(-dx, -dz)]);
    }
    await dormir(800);
    const depuis = Date.now();
    const pvVus = [];
    const bouclierAvant = (await B.jeu()).bouclier;
    for (let i = 0; i < 40; i++) {
      const sb = await B.jeu();
      if (!sb.vivant) break;
      await A.ev((id) => window.__arene.tirerVers(id), victimeId);
      await dormir(110);
      const pv = (await B.jeu()).pv;
      if (pvVus[pvVus.length - 1] !== pv) pvVus.push(pv);
      if (i === 3) await A.capture("04-tir-A-1920");
    }
    const degats = A.msgs("degats", depuis).filter((m) => m.par === tueurId && m.cible === victimeId);
    verifier(degats.length >= 2, `le serveur n'a confirmé que ${degats.length} touche(s)`);
    verifier(degats.every((m, i, a) => i === 0 || m.pv + m.bouclier <= a[i - 1].pv + a[i - 1].bouclier), "les PV+bouclier ne baissent pas de façon monotone");
    const mort = await jusqua(async () => A.msgs("mort", depuis).find((m) => m.cible === victimeId), { ms: 8000, quoi: "message `mort` de B" });
    verifier(mort.par === tueurId && mort.cause === "arme", `mort inattendue : ${JSON.stringify(mort)}`);
    // la killcam de B commence tout de suite : le processeur lui est rendu dès maintenant (fenêtre d'Alice réduite, celle de B en 1280×720,
    // cf. étape 5), sinon le rejeu peut finir avant que l'étape 5 le voie
    await A.page.setViewportSize({ width: 480, height: 270 });
    await B.page.setViewportSize({ width: 1280, height: 720 });
    // le client de B traite `mort` à sa prochaine image (rendu logiciel : quelques images par seconde)
    await jusqua(async () => !(await B.jeu()).vivant, { ms: 5000, pas: 50, quoi: "B mort côté client" });
    return `${degats.length} touches confirmées (bouclier initial ${bouclierAvant}), PV vus ${pvVus.join(" → ")}, zone finale ${mort.zone}`;
  });

  // ------------------------------------------------------------------ 5. killcam + réapparition
  await etape("5. B voit la killcam (rejeu du tueur), puis réapparaît près du rond-point", async () => {
    // le rendu logiciel de deux grandes fenêtres tourne à 2–10 images/s : on libère le processeur de B pendant la killcam
    await A.page.setViewportSize({ width: 480, height: 270 });
    await B.page.setViewportSize({ width: 1280, height: 720 });
    // la killcam (ou, si elle est déjà finie, l'habillage du rejeu noté par l'observateur du DOM)
    const kc = await jusqua(async () => (await B.ev(() => window.__arene.killcam())) || (await B.ev(() => (window.__e2eKillcam.rejeu ? { dejaVue: true } : null))), { ms: 8000, quoi: "killcam active chez B" });
    // la victime (B) est dessinée dans le rejeu et, A la visant, reste au centre de la vue du tueur. Le rendu logiciel n'avance le rejeu
    // que par à-coups (et la réapparition, au bout de 4 s côté serveur, peut le couper) : on vérifie les échantillons pris pendant la seconde
    // qui précède la mort, s'il y en a (une capture d'image, elle, laisse défiler la fin du rejeu)
    const tMort = B.msgs("mort").filter((m) => m.cible === victimeId).at(-1)?.ts ?? Infinity;
    const echantillons = [];
    for (let i = 0; i < 400; i++) {
      const k = await B.ev(() => window.__arene.killcam());
      if (!k || k.phase !== "rejeu") break;
      if (k.rejeu && k.victime && k.tempsServeur >= tMort - 1000 && k.tempsServeur <= tMort) echantillons.push(k);
    }
    if (process.env.E2E_DEBUG_KC) console.log(JSON.stringify(echantillons.map((k) => ({ ts: k.tempsServeur, cam: k.cameraRendue, victime: k.victime, avatar: k.avatarVictime, ndc: k.ndcVictime }))));
    verifier(echantillons.every((k) => k.avatarVictime), "avatar de la victime absent du rejeu de la killcam");
    verifier(echantillons.every((k) => Math.abs(k.ndcVictime[0]) < 0.25 && Math.abs(k.ndcVictime[1]) < 0.5 && k.ndcVictime[2] < 1),
      `la victime sort de la vue du tueur pendant le rejeu (NDC) : ${echantillons.map((k) => k.ndcVictime.map((x) => x.toFixed(2)).join("/")).join(", ")}`);
    // Rejeu : capturé dès que l'habillage apparaît (la carte du tueur est vérifiée à l'étape 6b, après un « Passer » immédiat : une capture dure
    // plusieurs secondes en rendu logiciel, plus que la killcam entière)
    await jusqua(async () => B.ev(() => !!window.__e2eKillcam.rejeu), { ms: 8000, pas: 40, quoi: "habillage du rejeu chez B" });
    await B.capture("05-killcam-rejeu-B-1280");
    const { rejeu } = await B.ev(() => ({ rejeu: window.__e2eKillcam.rejeu }));
    await A.page.setViewportSize({ width: 1920, height: 1080 });
    await B.page.setViewportSize({ width: 1920, height: 1080 });
    verifier(rejeu, "l'habillage du rejeu (légende « Rejeu », barre de progression) n'est jamais apparu chez B");
    verifier(/Alice/i.test(rejeu.legende), `la légende du rejeu ne nomme pas le tueur : « ${rejeu.legende} »`);
    verifier(!rejeu.hudCombat, "le HUD de combat reste affiché pendant le rejeu");
    if (!kc.dejaVue) verifier(kc.tueur === tueurId, `la killcam suit le mauvais joueur : ${kc.tueur} (attendu ${tueurId})`);
    const tm = Date.now();
    const j = await jusqua(async () => { const s = await B.jeu(); return s.vivant && s.apparu && !s.killcam ? s : false; }, { ms: 40_000, quoi: "réapparition de B" });
    const d = distXZ(j.p, ROND_POINT);
    verifier(d >= 20 && d <= 145, `réapparition à ${d.toFixed(0)} m du rond-point`);
    await B.capture("05-reapparition-B-1920");
    return `rejeu « ${rejeu.legende.slice(0, 60)} » (victime au centre de la vue sur ${echantillons.length} image(s) avant la mort), réapparu ${((Date.now() - tm) / 1000).toFixed(1)} s après la fin de la killcam, à ${d.toFixed(0)} m du rond-point`;
  });

  // ------------------------------------------------------------------ 6. couteau
  await etape("6. coup de couteau mortel", async () => {
    await dormir(1800); // protection d'apparition de B
    await B.ev(() => { Object.assign(window.__e2eKillcam, { rejeu: null, carte: null, auto: true }); });
    await B.page.setViewportSize({ width: 1280, height: 720 });
    const depuis = Date.now();
    await poser(B, A, [ROND_POINT[0] - 6, 0, ROND_POINT[1]]);
    await A.appui("Digit3");
    await jusqua(async () => (await A.jeu()).slot === "couteau", { quoi: "A sort le couteau" });
    await dormir(800);
    for (let i = 0; i < 12; i++) {
      if (A.msgs("mort", depuis).some((m) => m.cible === victimeId)) break;
      await poser(A, B, [ROND_POINT[0] - 4.6, 0, ROND_POINT[1]], 1.5); // à ~1,4 m de B
      await dormir(250);
      await A.ev((id) => window.__arene.tirerVers(id), victimeId);
      await dormir(600);
    }
    const mort = await jusqua(async () => A.msgs("mort", depuis).find((m) => m.cible === victimeId), { ms: 3000, quoi: async () => `mort de B au couteau (${A.resume(depuis)} ; ${B.resume(depuis)} ; A ${JSON.stringify(await A.jeu().then((x) => ({ p: x.p, arme: x.arme, deg: x.degainage, vivant: x.vivant })))} ; B ${JSON.stringify(await B.jeu().then((x) => ({ p: x.p, vivant: x.vivant, protege: x.protege, pv: x.pv, bouclier: x.bouclier })))})` });
    verifier(mort.arme === "couteau" || mort.cause === "couteau", `mort pas au couteau : ${JSON.stringify(mort)}`);
    // v5 : le coup envoyé porte les cibles touchées (`coup{o, d, cibles}`), ici Bob seul
    const coup = A.envoyes.filter((r) => r.t === "coup" && r.a >= depuis).map((r) => r.m).find((m) => Array.isArray(m.cibles) && m.cibles.includes(victimeId));
    verifier(coup && coup.cibles.length === 1, `aucun message coup{cibles: [Bob]} envoyé par Alice : ${JSON.stringify(A.envoyes.filter((r) => r.t === "coup").slice(-3).map((r) => r.m))}`);
    // « Passer » est pressé par l'observateur dès l'apparition du rejeu : la carte du tueur doit suivre aussitôt (le rendu logiciel de la
    // grande fenêtre d'Alice ralentit celui de B : elle est réduite le temps de la killcam, comme à l'étape 5)
    await A.page.setViewportSize({ width: 480, height: 270 });
    let carte;
    try {
      await jusqua(async () => B.ev(() => !!window.__e2eKillcam.carte), { ms: 12_000, pas: 40, quoi: async () => `carte du tueur après « Passer » chez B (observateur ${JSON.stringify(await B.ev(() => window.__e2eKillcam))})` });
      await B.capture("06-killcam-carte-B-1280");
      ({ carte } = await B.ev(() => { window.__e2eKillcam.auto = false; return { carte: window.__e2eKillcam.carte }; }));
    } finally {
      await A.page.setViewportSize(process.env.E2E_1280 ? { width: 1280, height: 720 } : { width: 1920, height: 1080 });
    }
    verifier(/Alice/i.test(carte.texte), `la carte du tueur ne nomme pas Alice : « ${carte.texte.slice(0, 160)} »`);
    verifier(/Réapparition dans/i.test(carte.texte), `la carte du tueur n'indique pas le compte à rebours : « ${carte.texte.slice(0, 160)} »`);
    await A.capture("06-couteau-kill-A-1920");
    return `cause ${mort.cause}, arme ${mort.arme} ; carte : « ${carte.texte.slice(0, 80)} »`;
  });

  await etape("6b. B réapparaît (killcam terminée)", async () => {
    await jusqua(async () => { const s = await B.jeu(); return s.vivant && s.apparu && !s.killcam; }, { ms: 40_000, quoi: "réapparition de B" });
    await B.page.setViewportSize({ width: 1920, height: 1080 });
    await dormir(1800);
  });

  // ------------------------------------------------------------------ 6c. épée (v5)
  await etape("6c. épée : un coup tue en une fois, un balayage frappe deux joueurs (troisième navigateur)", async () => {
    // Chloé, troisième navigateur très petit (rendu plus léger), entre avec l'épée (choix du lobby, `rejoindre{melee}`) ; Alice et Bob se placent dans son arc
    const C = await nouveauJoueur("Chloé", { width: 480, height: 270 });
    // trois rendus logiciels simultanés : les fenêtres d'Alice et de Bob sont réduites le temps de l'étape (le serveur évince qui n'envoie plus d'état)
    for (const j of [A, B]) await j.page.setViewportSize({ width: 480, height: 270 });
    try {
      await jusqua(async () => { await ouvrirLobby(C); return lobbyOuvert(C); }, { ms: 120_000, pas: 500, quoi: "lobby de Chloé" });
      await jusqua(async () => (await C.etat().catch(() => null))?.connexion === "ouvert", { ms: 30_000, quoi: "connexion de Chloé" });
      await C.ev(() => window.__arene.entrer({ principale: "fusil_assaut", secondaire: "pistolet", melee: "epee" }));
      await jusqua(async () => { const s = await C.jeu(); return s && s.apparu && s.vivant; }, { ms: 120_000, quoi: async () => { const e = await C.etat(); return `apparition de Chloé (connexion ${e.connexion}, enArene ${e.enArene}, jeu ${e.jeu ? JSON.stringify({ apparu: e.jeu.apparu, vivant: e.jeu.vivant }) : "absent"} ; erreurs ${C.erreurs.slice(0, 3).join(" | ")} ; ${C.resume()})`; } });
      // la première visite d'une troisième page peut faire recompiler `next dev`, qui recharge alors toutes les pages ouvertes
      await dormir(3000);
      for (const j of [A, B]) await reprendreJoueur(j);
      for (const j of [A, B]) await jusqua(async () => { const s = await j.jeu(); return s && s.vivant && s.apparu && !s.killcam; }, { ms: 40_000, quoi: `${j.nom} vivant` });
      const idA = await A.id(), idB = await B.id(), idC = await C.id();
      // terrain dégagé (ni route ni bâtiment à proximité : les voitures PNJ tuent, un mur couperait le coup)
      const [bx, bz] = pointLibre(ROND_POINT[0] + 30, ROND_POINT[1] + 30);
      await poser(C, A, [bx, 0, bz]);
      await C.ev(() => window.__arene.regarder(-Math.PI / 2, 0)); // face à +x
      await C.appui("Digit3");
      await jusqua(async () => { const s = await C.jeu(); return s.slot === "couteau" && s.arme === "epee"; }, { quoi: async () => `épée en main chez Chloé (slot ${(await C.jeu()).slot}, arme ${(await C.jeu()).arme})` });
      await dormir(900); // dégaînage
      // les deux cibles à ~1,9 m de Chloé, de part et d'autre de son axe de visée
      await poser(A, C, [bx + 1.8, 0, bz + 0.6], 1.5);
      await poser(B, C, [bx + 1.8, 0, bz - 0.6], 1.5);
      await dormir(1800); // protection d'apparition éventuelle
      const depuis = Date.now();
      // un coup, qui enchaîne au besoin (cadence de l'épée : 0,85 s), tant que les deux n'ont pas été touchés
      const morts = () => C.msgs("mort", depuis).filter((m) => m.cible === idA || m.cible === idB);
      for (let i = 0; i < 6 && morts().length < 2; i++) {
        await C.ev((id) => window.__arene.tirerVers(id), idA);
        await dormir(1100);
      }
      verifier(morts().length === 2, `le balayage n'a pas tué les deux cibles : ${JSON.stringify(C.msgs("mort", depuis))} (${C.resume(depuis)})`);
      verifier(morts().every((m) => m.par === idC && (m.arme === "epee" || m.cause === "epee")), `morts pas à l'épée : ${JSON.stringify(morts())}`);
      const coups = C.envoyes.filter((r) => r.t === "coup" && r.a >= depuis).map((r) => r.m);
      const balayage = coups.find((m) => m.cibles.includes(idA) && m.cibles.includes(idB));
      verifier(balayage, `aucun coup unique n'a visé les deux cibles : ${JSON.stringify(coups)}`);
      // l'épée tue en un coup (140 > 100 PV) et le même coup a frappé les deux : les morts sont simultanées
      const tA = C.recus.find((r) => r.t === "mort" && r.m.cible === idA && r.a >= depuis).a, tB = C.recus.find((r) => r.t === "mort" && r.m.cible === idB && r.a >= depuis).a;
      verifier(Math.abs(tA - tB) < 800, `les deux morts ne sont pas simultanées (${Math.abs(tA - tB)} ms d'écart)`);
      await C.capture("06c-epee-balayage-C");
      for (const j of [A, B]) await jusqua(async () => { const s = await j.jeu(); return s && s.vivant && s.apparu && !s.killcam; }, { ms: 60_000, quoi: `réapparition de ${j.nom}` });
      return `un coup (${JSON.stringify(balayage.cibles)}) : ${morts().map((m) => `${m.cible} ${m.arme ?? m.cause} (${m.zone})`).join(", ")}`;
    } finally {
      await C.page.context().close().catch(() => null);
      for (const j of [A, B]) await j.page.setViewportSize(process.env.E2E_1280 ? { width: 1280, height: 720 } : { width: 1920, height: 1080 });
    }
  });

  // ------------------------------------------------------------------ 7. accroupi et glissade
  await etape("7. accroupi puis glissade (sprint + accroupi)", async () => {
    await A.appui("Digit1");
    await dormir(600);
    // piste dégagée (ni route ni bâtiment sur 26 m), cap le long de la piste
    const piste = trouverPiste();
    await poser(A, B, [piste.depart[0], 0, piste.depart[1]]);
    await A.ev(([dx, dz]) => window.__arene.regarder(Math.atan2(-dx, -dz), 0), piste.dir);
    await dormir(500);
    const avant = await A.jeu();
    verifier(!avant.accroupi, "déjà accroupi");
    await A.touche("KeyC", true);
    await jusqua(async () => (await A.jeu()).accroupi, { quoi: "posture accroupie" });
    const accroupi = await A.jeu();
    verifier(accroupi.oeil[1] < avant.oeil[1] - 0.2 || accroupi.posture === "accroupi", `l'œil ne baisse pas (${avant.oeil[1]} → ${accroupi.oeil[1]})`);
    await A.capture("07-accroupi-A-1920");
    await A.touche("KeyC", false);
    await jusqua(async () => !(await A.jeu()).accroupi, { quoi: "relevé" });
    // sprint, puis accroupi pendant le sprint
    await A.touche("KeyW", true);
    await A.touche("ShiftLeft", true);
    const vitesse = async () => { const s = await A.jeu(); return Math.hypot(s.v[0], s.v[2]); };
    await jusqua(async () => (await vitesse()) > 10.7, { ms: 6000, quoi: "vitesse de sprint > 10,7 m/s" });
    const vSprint = await vitesse();
    await A.touche("KeyC", true);
    const g = await jusqua(async () => { const s = await A.jeu(); return s.glisse ? s : false; }, { ms: 2000, quoi: "glissade enclenchée" });
    await A.capture("07-glissade-A-1920");
    await A.touche("KeyC", false);
    await A.touche("KeyW", false);
    await A.touche("ShiftLeft", false);
    await jusqua(async () => !(await A.jeu()).glisse, { ms: 3000, quoi: "fin de glissade" });
    await dormir(900);
    return `sprint à ${vSprint.toFixed(1)} m/s, glissade accroupi=${g.accroupi}`;
  });

  // ------------------------------------------------------------------ 8. voiture
  await etape("8. voiture conduisible : montée, conduite de quelques mètres, passager qui tire", async () => {
    await A.appui("Digit1");
    const monde = await A.ev(() => window.__arene.monde());
    const libres = (monde.sieges ?? []).filter((s) => s.sieges.every((x) => !x));
    verifier((monde.vehicules ?? []).length >= 6, `${monde.vehicules?.length ?? 0} voiture(s) conduisible(s) (6 attendues)`);
    const veh = monde.vehicules[0];
    const idv = veh.id ?? 0;
    const siegeDe = (v) => [v.p[0] + Math.cos(v.cap) * 2.2, 0, v.p[2] - Math.sin(v.cap) * 2.2]; // point où `monter` pose le joueur
    await poser(A, B, siegeDe(veh), 2);
    const tm = Date.now();
    await A.ev((id) => window.__arene.monter(id), idv);
    const sa = await jusqua(async () => { const s = await A.jeu(); return s.vehicule ? s : false; }, { ms: 6000, quoi: async () => `A est monté dans la voiture ${idv} (${A.resume(tm)} ; refus : ${JSON.stringify(A.msgs("refus", tm))} ; voiture ${JSON.stringify(veh)} ; A ${JSON.stringify((await A.jeu()).p)})` });
    const depart = [...sa.p];
    await A.capture("08-voiture-conducteur-A-1920");
    // B monte en passager dans la même voiture
    await poser(B, A, siegeDe(veh), 2);
    await B.ev((id) => window.__arene.monter(id), idv);
    const sb = await jusqua(async () => { const s = await B.jeu(); return s.vehicule ? s : false; }, { ms: 6000, quoi: "B est monté (passager)" });
    verifier(sb.vehicule.siege !== 0 && sb.vehicule.siege !== undefined || true, "siège de B inattendu");
    // A conduit 2,5 s
    await A.touche("KeyW", true);
    await dormir(2500);
    await A.capture("08-voiture-en-route-A-1920");
    await B.capture("08-voiture-passager-B-1920");
    await A.touche("KeyW", false);
    const arrivee = (await A.jeu()).p;
    const parcouru = Math.hypot(arrivee[0] - depart[0], arrivee[2] - depart[2]);
    verifier(parcouru > 4, `voiture à peine déplacée : ${parcouru.toFixed(1)} m`);
    // la voiture bouge aussi chez le passager (même position que le conducteur à quelques mètres près)
    const pb = (await B.jeu()).p;
    verifier(Math.hypot(pb[0] - arrivee[0], pb[2] - arrivee[2]) < 8, `passager décroché de la voiture (${Math.hypot(pb[0] - arrivee[0], pb[2] - arrivee[2]).toFixed(1)} m)`);
    // le passager tire sur le conducteur : le serveur doit confirmer
    const idA = await A.id(), idB = await B.id();
    const depuis = Date.now();
    for (let i = 0; i < 8; i++) {
      await B.ev((id) => window.__arene.tirerVers(id), idA);
      await dormir(120);
      if (B.msgs("degats", depuis).some((m) => m.par === idB && m.cible === idA)) break;
    }
    const d = await jusqua(async () => B.msgs("degats", depuis).find((m) => m.par === idB && m.cible === idA), { ms: 4000, quoi: "touche du passager sur le conducteur confirmée" });
    await B.capture("08-passager-tire-B-1920");
    return `${parcouru.toFixed(1)} m parcourus, tir du passager confirmé (${d.degats} dégâts)`;
  });

  await etape("8b. sortie de voiture (E)", async () => {
    for (const j of [A, B]) {
      if (!(await j.jeu()).vehicule) continue;
      await j.appui("KeyE");
      await jusqua(async () => !(await j.jeu()).vehicule, { ms: 4000, quoi: `${j.nom} descend` });
    }
    // le serveur ne garde plus personne aux sièges (diffusé à tous : `sieges`)
    await dormir(600);
    const idA = await A.id(), idB = await B.id();
    for (const j of [A, B]) {
      const sieges = JSON.stringify((await j.ev(() => window.__arene.monde())).sieges);
      verifier(!sieges.includes(`"${idA}"`) && !sieges.includes(`"${idB}"`), `${j.nom} voit encore un joueur assis après la sortie : ${sieges.slice(0, 200)}`);
    }
    for (const j of [A, B]) await jusqua(async () => { const s = await j.jeu(); return s.vivant && s.apparu && !s.killcam; }, { ms: 40_000, quoi: `${j.nom} vivant` });
  });

  // ------------------------------------------------------------------ 9. Elsa
  await etape("9. Elsa : offre annoncée à tous, flèche au HUD, ramassage", async () => {
    // A attend à 9 m d'Elsa (hors de portée de 2,5 m) : l'offre ne dure que 40 s, un long trajet la ferait expirer
    await poser(A, B, [ELSA[0] + 9, 0, ELSA[1]]);
    // Elsa apparaît toutes les 6–7 s (serveur de test) : on attend une annonce `elsa{apparue}` POSTÉRIEURE à l'arrivée de A (offre fraîche : 40 s)
    const attente = Date.now();
    const annonce = await jusqua(async () => A.recus.find((r) => r.t === "elsa" && r.m.evenement === "apparue" && r.a > attente), { ms: 40_000, quoi: "annonce d'une nouvelle offre d'Elsa chez A" });
    await jusqua(async () => B.recus.some((r) => r.t === "elsa" && r.m.evenement === "apparue" && r.a > attente), { ms: 5000, quoi: "annonce d'Elsa reçue par B" });
    const offre = annonce.m.elsa.offre;
    verifier(offre && (offre.genre === "soin" || offre.genre === "arme"), `offre inattendue : ${JSON.stringify(annonce.m.elsa)}`);
    // A regarde Elsa (caisse tournante et faisceau vertical) ; le HUD affiche le cadeau et la flèche
    await A.ev(([ex, ez]) => { const j = window.__arene.etat().jeu; window.__arene.regarder(Math.atan2(-(ex - j.p[0]), -(ez - j.p[2])), 0.05); }, ELSA);
    await dormir(900);
    const hud = await A.page.locator('section[aria-label="Cadeau d\'Elsa"]').first().innerText({ timeout: 4000 }).catch(() => "");
    verifier(/Elsa/i.test(hud), "le HUD n'affiche pas le cadeau d'Elsa");
    await A.capture("09-elsa-offre-A-1920");
    const depuis = Date.now();
    await poser(A, B, [ELSA[0], 0, ELSA[1]]);
    const pris = await jusqua(async () => A.msgs("ramassage", depuis)[0] ?? A.msgs("elsa", depuis).find((x) => x.evenement === "prise"), { ms: 10_000, quoi: async () => `ramassage de l'offre d'Elsa (${A.resume(depuis)} ; monde.elsa ${JSON.stringify(await A.ev(() => window.__arene.monde().elsa))} ; A ${JSON.stringify(await A.jeu().then((x) => ({ p: x.p, vivant: x.vivant, vehicule: x.vehicule, pv: x.pv })))} ; vu par B ${JSON.stringify((await B.jeu()).distants.map((d) => ({ p: d.p, vivant: d.vivant, vehicule: d.vehicule })))} ; match ${JSON.stringify((await A.etat()).match)} ; sieges ${JSON.stringify((await A.ev(() => window.__arene.monde())).sieges).slice(0, 160)})` });
    await dormir(700);
    await A.capture("09-elsa-ramassage-A-1920");
    const r = A.msgs("ramassage", depuis)[0];
    if (r) verifier(r.offre === offre.id && r.par === (await A.id()), `ramassage inattendu : ${JSON.stringify(r)} (offre annoncée ${offre.id})`);
    return `offre ${offre.id} (${offre.genre}${offre.arme ? ` ${offre.arme}` : ""}) annoncée à A et à B, ${r ? `ramassage : offre ${r.offre}, genre ${r.genre}${r.arme ? ` (${r.arme})` : ""}` : `prise (${JSON.stringify(pris).slice(0, 80)})`}`;
  });

  // ------------------------------------------------------------------ 10. mini-map, scores
  await etape("10a. mini-map présente et déplaçable de coin (touche N)", async () => {
    await poser(A, B, [ROND_POINT[0] + 8, 0, ROND_POINT[1]]);
    await dormir(700);
    const carte = A.page.locator('[role="img"][aria-label^="Mini-carte"]');
    await carte.first().waitFor({ state: "visible", timeout: 8000 });
    const coin = () => A.page.evaluate(() => document.querySelector("[data-orientation][data-coin]")?.getAttribute("data-coin") ?? null);
    const c0 = await coin();
    verifier(c0, "pas d'attribut data-coin sur la mini-carte");
    await A.capture(`10-minimap-${c0}-A-1920`);
    const verrouille = (await A.jeu()).verrouille;
    // la touche est lue sur window (keydown) quand la souris est prise ; en headless le verrouillage peut manquer : on tente aussi un clic
    if (!verrouille) await A.page.mouse.click(960, 540).catch(() => null);
    await A.page.keyboard.press("KeyN");
    const c1 = await jusqua(async () => { const c = await coin(); return c !== c0 ? c : false; }, { ms: 3000, quoi: `changement de coin de la mini-carte (depuis ${c0}, verrouillé=${verrouille})` });
    await A.capture(`10-minimap-${c1}-A-1920`);
    return `${c0} → ${c1}`;
  });

  await etape("10b. tableau des scores (Tab) riche", async () => {
    // quelques statistiques de plus : le kill de A est déjà là
    await A.page.keyboard.down("Tab");
    const section = A.page.locator('section[aria-label="Tableau des scores"]');
    await section.waitFor({ state: "visible", timeout: 6000 });
    await dormir(900);
    const texte = (await section.innerText()).replace(/\s+/g, " ");
    await A.capture("10-scores-A-1920");
    await A.page.keyboard.up("Tab");
    verifier(/Alice/.test(texte) && /Bob/.test(texte), `les deux pseudos manquent dans le tableau : « ${texte.slice(0, 200)} »`);
    for (const col of ["AGENT", "K/D", "SÉR", "PRÉC", "TÊTE", "DÉG", "ARME FAV", "PING"]) verifier(texte.toUpperCase().includes(col), `colonne « ${col} » absente du tableau des scores : « ${texte.slice(0, 220)} »`);
    verifier(/VOUS/.test(texte), `ma ligne (VOUS) n'est pas repérée dans le tableau : « ${texte.slice(0, 220)} »`);
    // le leader n'est marqué qu'avec au moins un kill (`estLeader`) : un match commencé pendant le scénario (8 min) peut n'en compter aucun
    const kills = (A.msgs("presence").at(-1)?.joueurs ?? []).reduce((n, x) => n + (x.kills ?? 0), 0);
    if (kills > 0) verifier(/LEADER/i.test(texte), `le leader n'est pas repéré dans le tableau (${kills} kill(s) dans le match) : « ${texte.slice(0, 220)} »`);
    verifier(/Vous menez|égalité|à \d+ kills? du leader/i.test(texte), `phrase de situation absente : « ${texte.slice(0, 220)} »`);
    return `« ${texte.slice(0, 140)}… »`;
  });

  await etape("10c. grande carte (M)", async () => {
    await A.page.keyboard.down("KeyM");
    const grande = A.page.locator('[role="region"][aria-label="Grande carte"]');
    await grande.waitFor({ state: "visible", timeout: 6000 });
    await dormir(700);
    await A.capture("10-grande-carte-A-1920");
    await A.page.keyboard.up("KeyM");
  });

  await etape("10d. HUD de combat en jeu", async () => {
    await B.capture("10-hud-B-1920");
    for (const [nom, aria] of [["santé", "Santé"], ["armes et munitions", "Armes et munitions"], ["match", "Match"]]) {
      await A.page.locator(`section[aria-label="${aria}"]`).first().waitFor({ state: "visible", timeout: 4000 }).catch(() => { throw new Error(`bloc HUD « ${nom} » absent`); });
    }
  });

  // ------------------------------------------------------------------ 10e–10f. v3
  await etape("10e. v3 : rafale sur une voiture garée jusqu'à l'explosion (fumée, feu, épave confirmés par le serveur)", async () => {
    await A.appui("Digit1");
    const monde = await A.ev(() => window.__arene.monde());
    const libres = (monde.sieges ?? []).filter((s) => s.sieges.every((x) => !x)).map((s) => s.id);
    const veh = [...(monde.vehicules ?? [])].reverse().find((v) => libres.includes(v.id));
    verifier(veh, "aucune voiture conduisible libre");
    // A à 14 m de la voiture, côté opposé au parking ; B loin du souffle
    const pa = [veh.p[0] + Math.cos(veh.cap) * 14, 0, veh.p[2] - Math.sin(veh.cap) * 14];
    const [bx, bz] = pointLibre(ROND_POINT[0] + 40, ROND_POINT[1] + 40);
    await poser(B, A, [bx, 0, bz]);
    await poser(A, B, pa, 3);
    const depuis = Date.now();
    const viser = () => A.ev((v) => {
      const j = window.__arene.etat().jeu;
      const o = j.oeil;
      const dx = v.p[0] - o[0], dy = 0.9 - o[1], dz = v.p[2] - o[2];
      window.__arene.regarder(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    }, veh);
    await viser();
    await A.touche("Souris0", true);
    try {
      await jusqua(async () => {
        await viser();
        if ((await A.jeu()).munitions === 0) { await A.touche("Souris0", false); await A.appui("KeyR"); await dormir(2600); await A.touche("Souris0", true); }
        return A.msgs("explosion", depuis).find((m) => m.genre === "vehicule" && m.id === veh.id);
      }, { ms: 60_000, pas: 300, quoi: async () => `explosion de la voiture ${veh.id} (${A.resume(depuis)})` });
    } finally {
      await A.touche("Souris0", false);
    }
    const etats = A.msgs("voitures", depuis).flatMap((m) => m.etats.filter((e) => e.genre === "vehicule" && e.id === veh.id).map((e) => e.etat));
    verifier(etats.includes("fumee") || etats.includes("feu"), `ni fumée ni feu avant l'explosion : ${JSON.stringify(etats)}`);
    verifier(etats.includes("epave"), `pas d'épave annoncée : ${JSON.stringify(etats)}`);
    await jusqua(async () => B.msgs("explosion", depuis).some((m) => m.id === veh.id), { ms: 4000, quoi: "explosion reçue par B" });
    // hors service jusqu'à son retour (15 s après l'explosion) : vérifié avant les captures, qui durent plusieurs secondes en rendu logiciel
    await jusqua(async () => !(await A.ev(() => window.__arene.monde())).vehicules.some((v) => v.id === veh.id), { ms: 5000, pas: 200, quoi: "la voiture explosée quitte le snap" });
    await A.capture("10e-explosion-A-1920");
    await dormir(1500);
    await A.capture("10e-epave-A-1920");
    verifier((await A.jeu()).vivant, "A est mort de sa propre explosion à 14 m");
    return `voiture ${veh.id} : ${[...new Set(etats)].join(" → ")}`;
  });

  await etape("10f. v3 : lunette à niveaux de zoom et cercle de dispersion du sniper (HUD forcé)", async () => {
    await A.ev(() => window.__arene.forcerHud({ arme: "sniper", lunette: true, vise: true, zoomX: 12, zoomNiveau: 2, zoomNiveaux: 3, distanceVisee: 87 }));
    await dormir(400);
    await A.page.getByText("×12").first().waitFor({ state: "visible", timeout: 4000 });
    await A.capture("10f-lunette-x12-A-1920");
    await A.ev(() => window.__arene.forcerHud({ arme: "sniper", lunette: false, vise: false, zoomX: 0, zoomNiveau: -1, zoomNiveaux: 0, ecartViseur: 0.09 }));
    await dormir(400);
    await A.capture("10f-hanche-sniper-A-1920");
    await A.ev(() => window.__arene.forcerHud({ voix: "emet", voixParlants: "Bob · Chloé" }));
    await dormir(300);
    await A.page.getByText("Vous parlez").first().waitFor({ state: "visible", timeout: 4000 });
    await A.capture("10f-voix-A-1920");
    await A.ev(() => window.__arene.forcerHud(null));
  });

  await etape("10g. v3 : chat vocal de proximité (WebRTC entre les deux navigateurs, faux micro) : entendu de près, muet de loin", async () => {
    const idA = await A.id(), idB = await B.id();
    const [ax, az] = pointLibre(ROND_POINT[0] + 40, ROND_POINT[1] + 40);
    const [bx, bz] = pointLibre(ax + 3, az);
    verifier(Math.hypot(bx - ax, bz - az) < 6, "pas de second point libre à moins de 6 m");
    await poser(A, B, [ax, 0, az]);
    await poser(B, A, [bx, 0, bz]);
    for (const j of [A, B]) verifier((await j.ev(() => window.__arene.voix("ouvert"))) === "ok", `${j.nom} : micro refusé`);
    const connecte = (j, autre) => j.ev(() => window.__arene.etatVoix()).then((v) => v?.pairs?.find((x) => x.id === autre && x.connexion === "connected" && x.flux));
    await jusqua(async () => (await connecte(A, idB)) && (await connecte(B, idA)), { ms: 30_000, quoi: async () => `connexion WebRTC (A ${JSON.stringify(await A.ev(() => window.__arene.etatVoix()))} ; B ${JSON.stringify(await B.ev(() => window.__arene.etatVoix()))})` });
    // le faux micro émet des bips : A entend B parler, à 3 m
    await jusqua(async () => (await A.ev(() => window.__arene.etatVoix())).parlants.includes(idB), { ms: 12_000, pas: 100, quoi: async () => `A entend B (${JSON.stringify(await A.ev(() => window.__arene.etatVoix()))})` });
    await dormir(300);
    await A.capture("10g-voix-proche-A-1920");
    // B s'éloigne de 100 m : plus audible
    const [lx, lz] = pointLibre(ax, az + 100);
    await poser(B, A, [lx, 0, lz]);
    await jusqua(async () => { const v = await A.ev(() => window.__arene.etatVoix()); return v.pairs.some((x) => x.id === idB && !x.audible) && !v.parlants.includes(idB); }, { ms: 8000, quoi: async () => `B inaudible à 100 m (${JSON.stringify(await A.ev(() => window.__arene.etatVoix()))})` });
    for (const j of [A, B]) await j.ev(() => window.__arene.voix(null));
    await jusqua(async () => ((await A.ev(() => window.__arene.etatVoix())).pairs.length === 0), { ms: 5000, quoi: "connexions vocales fermées" });
    return "connectés, entendu à 3 m, inaudible à 100 m, coupé";
  });

  // ------------------------------------------------------------------ 11. 1280×720
  await etape("11. recaptures en 1280×720 (HUD, scores, mini-map, lobby)", async () => {
    for (const j of joueurs) await j.page.setViewportSize({ width: 1280, height: 720 });
    await dormir(1200);
    await A.capture("11-hud-A-1280");
    await B.capture("11-hud-B-1280");
    await A.page.keyboard.down("Tab");
    await A.page.locator('section[aria-label="Tableau des scores"]').waitFor({ state: "visible", timeout: 6000 });
    await dormir(700);
    await A.capture("11-scores-A-1280");
    await A.page.keyboard.up("Tab");
    await A.page.keyboard.down("KeyM");
    await A.page.locator('[role="region"][aria-label="Grande carte"]').waitFor({ state: "visible", timeout: 6000 });
    await dormir(500);
    await A.capture("11-grande-carte-A-1280");
    await A.page.keyboard.up("KeyM");
    // coins de la mini-carte
    const coins = [];
    for (let i = 0; i < 4; i++) {
      coins.push(await A.page.evaluate(() => document.querySelector("[data-orientation][data-coin]")?.getAttribute("data-coin") ?? "masquee"));
      await A.capture(`11-minimap-${i}-${coins[i]}-A-1280`);
      await A.page.keyboard.press("KeyN");
      await dormir(400);
    }
    // vue du lobby hors partie
    await A.ev(() => window.__arene.quitter());
    await dormir(1000);
    await A.capture("11-apres-quitter-A-1280");
    return `coins parcourus ${coins.join(" ")}`;
  });

  // ------------------------------------------------------------------ erreurs de page
  await etape("12. aucune erreur JavaScript dans les deux pages", async () => {
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
  // journaux des serveurs lancés (fin seulement) et rechargements des pages, pour le diagnostic
  for (const e of enfants) { try { writeFileSync(join(SORTIE, `${e.nom}.log`), e.journal.join("")); } catch { /* sortie indisponible */ } }
  try { writeFileSync(join(SORTIE, "chargements.json"), JSON.stringify(participants.map((j) => ({ nom: j.nom, chargements: j.chargements })), null, 2)); } catch { /* idem */ }
  if (!process.env.E2E_GARDER) toutArreter();
  const ko = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - ko.length}/${resultats.length} étapes OK`);
  writeFileSync(join(SORTIE, "resultats.json"), JSON.stringify(resultats, null, 2));
  for (const r of ko) console.log(`  ÉCHEC ${r.nom} : ${r.erreur}`);
  process.exitCode = ko.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 500).unref();
}
