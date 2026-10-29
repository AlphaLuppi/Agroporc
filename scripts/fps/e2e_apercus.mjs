#!/usr/bin/env node
/**
 * Bout en bout de l'aperçu EN DIRECT de la vue Palantir (issue #84) : un navigateur Chromium headless (A) regarde la vue avec le panneau « Arène »
 * ouvert pendant qu'un second joueur (B, un client WebSocket piloté ici comme `protocole_br_parties.mjs`) joue dans chacun des trois modes de
 * `serveur-fps` (lancé sur un port libre aux durées raccourcies, avec `next dev`). Vérifie, par `window.__palantir.apercu()` :
 *  1. arène : B joue, A voit « En direct » avec B (pseudo, repère réel, jamais en pointillés)
 *  2. zombies : B lance une partie et joue, A (arrivé après le lancement) coche « Zombies tigres » : B et des tigres, bandeau « En direct · manche 1 »
 *  3. Battle Royale : B lance une partie seule, saute ; A coche « Battle Royale » en plein vol : B en chute ou sous voile, zone et avion
 *  4. B part : sans aperçu, la vue repasse en simulation (au plus 4 s après la péremption de 3 s)
 * Usage : node scripts/fps/e2e_apercus.mjs   (Node 22 ; Playwright comme les autres e2e ; E2E_OUT = captures, E2E_URL / E2E_WS réutilisent des serveurs lancés,
 *         qui doivent alors avoir les variables d'essai ci-dessous). Sort avec le code 1 si une vérification échoue.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SORTIE = process.env.E2E_OUT ?? join(tmpdir(), "pdj-e2e-apercus");
const PAGE = "/arene-e2e-introuvable";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const portLibre = () => new Promise((ok, ko) => { const s = createServer(); s.once("error", ko); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });
async function attendreHttp(url, ms) { const fin = Date.now() + ms; while (Date.now() < fin) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* */ } await dormir(500); } throw new Error(`injoignable : ${url}`); }
const enfants = [];
function lancer(cmd, args, opts) { const e = spawn(cmd, args, { ...opts, detached: true, stdio: ["ignore", "pipe", "pipe"] }); e.journal = []; const n = (b) => { e.journal.push(String(b)); if (e.journal.length > 300) e.journal.shift(); }; e.stdout.on("data", n); e.stderr.on("data", n); enfants.push(e); return e; }
const arreter = () => { for (const e of enfants) { try { process.kill(-e.pid, "SIGTERM"); } catch { /* */ } } };
const chargerPlaywright = () => { for (const b of [process.env.PLAYWRIGHT_DIR, RACINE, process.cwd()].filter(Boolean)) { try { return createRequire(join(b, "x.js"))("playwright"); } catch { /* */ } } return createRequire(import.meta.url)("playwright"); };
const WebSocket = createRequire(join(RACINE, "serveur-fps/package.json"))("ws");

mkdirSync(SORTIE, { recursive: true });
const { chromium } = chargerPlaywright();
const echecs = [];
const verifier = (ok, nom, detail = "") => { console.log(`${ok ? "ok  " : "ÉCHEC"} ${nom}${detail ? ` — ${detail}` : ""}`); if (!ok) echecs.push(nom); };
let nav = null;
const fermes = [];

/** Joueur B : un client WebSocket qui joue (états à 30 Hz depuis sa position serveur). */
function creerBot(url, pseudo) {
  const ws = new WebSocket(url);
  const b = { ws, id: null, recus: [], p: [0, 0, 0], seq: 0, jeu: false, chute: false, timer: null };
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    b.recus.push(m); if (b.recus.length > 400) b.recus.shift();
    if (m.t === "bienvenue") b.id = m.id;
    if (m.t === "apparition" && m.id === b.id) b.p = m.p;
    if (m.t === "snap") { const moi = m.j.find((e) => e.id === b.id); if (moi) b.p = moi.p; }
  });
  b.envoyer = (m) => ws.send(JSON.stringify(m));
  b.pret = new Promise((r) => ws.on("open", r)).then(() => b.envoyer({ t: "bonjour", v: 10, pseudo }));
  b.dernier = (t) => [...b.recus].reverse().find((m) => m.t === t);
  b.vider = () => { b.recus = []; };
  // états à 30 Hz tant que `jeu` ; en chute libre (BR), les entrées de chute
  b.timer = setInterval(() => {
    if (!b.id || ws.readyState !== 1 || !b.jeu) return;
    if (b.chute) b.envoyer({ t: "chute", lacet: 0, tangage: -1.1, avance: 1, lateral: 0, ouvrir: false });
    else b.envoyer({ t: "etat", seq: ++b.seq, p: b.p, v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 });
  }, 33);
  fermes.push(() => { clearInterval(b.timer); try { ws.close(); } catch { /* */ } });
  return b;
}
async function jusqua(f, ms = 15000, pas = 150) { const fin = Date.now() + ms; while (Date.now() < fin) { const r = await f(); if (r) return r; await dormir(pas); } return null; }

try {
  let urlWs = process.env.E2E_WS;
  if (!urlWs) {
    const port = await portLibre();
    urlWs = `ws://localhost:${port}`;
    const b = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: join(RACINE, "serveur-fps"), encoding: "utf8" });
    if (b.status !== 0) throw new Error(b.stdout + b.stderr);
    const srv = lancer(process.execPath, ["dist/index.js"], { cwd: join(RACINE, "serveur-fps"), env: {
      ...process.env, PORT: String(port), SCENE_JSON: join(RACINE, "public/agroparc/scene.json"),
      PDJ_FPS_AVION_MIN_MS: "3600000", PDJ_FPS_AVION_MAX_MS: "3600000", PDJ_FPS_BUS_MIN_MS: "3600000", PDJ_FPS_BUS_MAX_MS: "3600000",
      PDJ_FPS_EVT_MIN_MS: "3600000", PDJ_FPS_EVT_MAX_MS: "3600000", PDJ_FPS_ELSA_MIN_MS: "3600000", PDJ_FPS_ELSA_MAX_MS: "3600000",
      PDJ_FPS_ZOMBIES_TOTAL: "60", PDJ_FPS_ZOMBIES_PAUSE_MS: "3000", PDJ_FPS_ZOMBIES_GRIFFE: "1", PDJ_FPS_ZOMBIES_ARGENT: "5000",
      PDJ_FPS_BR_MIN_JOUEURS: "1", PDJ_FPS_BR_DECOMPTE_MS: "8000", PDJ_FPS_BR_VOL_MS: "60000", PDJ_FPS_BR_ZONE_ECHELLE: "0.3", PDJ_FPS_BR_OBJETS: "20",
      PDJ_FPS_BR_STATS: join(mkdtempSync(join(tmpdir(), "pdj-apercus-")), "stats-br.json"),
    } });
    await attendreHttp(`http://localhost:${port}/sante`, 20000).catch((e) => { throw new Error(e.message + srv.journal.join("")); });
  }
  let urlNext = process.env.E2E_URL;
  if (!urlNext) {
    const port = await portLibre();
    urlNext = `http://localhost:${port}`;
    lancer(process.execPath, [join(RACINE, "node_modules/next/dist/bin/next"), "dev", "-p", String(port)], { cwd: RACINE, env: { ...process.env, NEXT_PUBLIC_FPS_WS_URL: urlWs, NEXT_TELEMETRY_DISABLED: "1" } });
    await attendreHttp(`${urlNext}${PAGE}`, 240000);
  }
  console.log(`serveur ${urlWs} · site ${urlNext}`);

  // ---------- A : le navigateur qui regarde ----------
  nav = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 400)));
  const apercu = () => page.evaluate(() => window.__palantir.apercu());
  const bandeau = () => page.locator("[role=status]").filter({ hasText: /En direct|Simulation/i }).first().innerText().then((t) => t.replace(/\n/g, " ")).catch(() => "");
  const choisir = async (nom) => { const r = page.getByRole("radio", { name: nom }); await r.waitFor({ timeout: 60000 }); await r.evaluate((e) => e.click()); };
  for (let essai = 0; essai < 5; essai++) {
    try {
      await page.goto(`${urlNext}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 180000 });
      await dormir(4000);
      await page.keyboard.type("myrtille", { delay: 60 });
      await page.waitForFunction(() => !!window.__palantir?.apercu?.(), null, { timeout: 90000 });
      const b = page.getByRole("button", { name: /^Arène/ }).first();
      await b.waitFor({ state: "visible", timeout: 90000 });
      await b.evaluate((e) => e.click());
      await page.waitForFunction(() => window.__palantir.apercu().actif, null, { timeout: 30000 });
      break;
    } catch (e) { console.log("essai", essai, e.message.split("\n")[0]); }
  }

  // ---------- 1. arène : B joue, A le voit en direct ----------
  const B = creerBot(urlWs, "Bobo");
  await B.pret;
  await jusqua(() => B.id);
  B.envoyer({ t: "rejoindre", principale: "fusil_assaut", secondaire: "pistolet", melee: "couteau" });
  await jusqua(() => B.dernier("apparition"));
  B.jeu = true;
  const a1 = await jusqua(async () => { const a = await apercu(); return a.source === "direct" && (a.modele?.joueurs ?? []).some((j) => j.pseudo === "Bobo") ? a : null; }, 30000);
  verifier(!!a1, "arène : A voit B en direct", a1 ? JSON.stringify(a1.modele.joueurs.map((j) => [j.pseudo, j.sim ?? false])) : JSON.stringify(await apercu()).slice(0, 300));
  verifier(!!a1 && a1.modele.joueurs.every((j) => !j.sim) && a1.sim === 0, "arène : aucun faux joueur mêlé au direct", `${a1?.sim}`);
  const ba = await bandeau();
  verifier(/En direct/i.test(ba) && /match à mort/i.test(ba), "arène : bandeau « En direct · Match à mort »", ba);
  await page.screenshot({ path: join(SORTIE, "01-arene-direct.png") });

  // ---------- 2. zombies : B lance, A arrive après ----------
  B.jeu = false;
  B.envoyer({ t: "quitter" });
  await dormir(500);
  B.vider();
  B.envoyer({ t: "mode", mode: "zombies" });
  await jusqua(() => B.dernier("mode")?.mode === "zombies");
  B.envoyer({ t: "lancerPartie" });
  await jusqua(() => B.recus.some((m) => m.t === "zombies" && m.etat.phase !== "lobby"));
  B.envoyer({ t: "rejoindre" });
  await jusqua(() => B.dernier("apparition"));
  B.jeu = true;
  await dormir(1500);
  await choisir(/Zombies tigres/);
  const a2 = await jusqua(async () => { const a = await apercu(); return a.source === "direct" && a.modeDecor === "zombies" && (a.modele?.tigres ?? []).length > 0 ? a : null; }, 90000, 400);
  verifier(!!a2, "zombies : A voit B et des tigres en direct", a2 ? `${a2.modele.joueurs.length} joueur(s), ${a2.modele.tigres.length} tigre(s), manche ${a2.modele.manche}` : JSON.stringify(await apercu()).slice(0, 400));
  verifier(!!a2 && a2.modele.joueurs.some((j) => j.pseudo === "Bobo" && !j.sim), "zombies : le joueur réel est celui de B", "");
  const bz = await bandeau();
  verifier(/En direct/i.test(bz) && /manche 1/i.test(bz), "zombies : bandeau « En direct · manche 1 »", bz);
  await dormir(2500);
  await page.screenshot({ path: join(SORTIE, "02-zombies-direct.png") });

  // ---------- 3. Battle Royale : B lance seul et saute, A regarde en plein vol ----------
  B.jeu = false;
  B.envoyer({ t: "quitter" });
  await dormir(800);
  B.vider();
  B.envoyer({ t: "mode", mode: "br" });
  await jusqua(() => B.dernier("mode")?.mode === "br");
  B.envoyer({ t: "lancerPartie" });
  await jusqua(() => B.recus.some((m) => m.t === "br" && m.etat.phase === "decompte"));
  B.envoyer({ t: "rejoindre" });
  await jusqua(() => B.recus.some((m) => m.t === "br" && m.etat.phase === "vol"), 40000);
  await choisir(/Battle Royale/);
  await dormir(2000);
  B.envoyer({ t: "sauter" });
  B.chute = true; B.jeu = true;
  const a3 = await jusqua(async () => {
    const a = await apercu();
    return a.source === "direct" && a.modeDecor === "br" && (a.modele?.joueurs ?? []).some((j) => j.pseudo === "Bobo" && j.chute) && a.modele.zone ? a : null;
  }, 90000, 400);
  verifier(!!a3, "BR : A voit B en chute, la zone en direct", a3 ? JSON.stringify({ chute: a3.modele.joueurs.map((j) => j.chute), palier: a3.modele.zone.palier, avion: !!a3.modele.avion, vivants: a3.modele.vivants, total: a3.modele.total, partie: a3.modele.partie }) : JSON.stringify(await apercu()).slice(0, 400));
  const bb = await bandeau();
  verifier(/En direct/i.test(bb) && /battle royale/i.test(bb) && /en vie sur/i.test(bb), "BR : bandeau « En direct · Battle Royale · N en vie sur M »", bb);
  await page.screenshot({ path: join(SORTIE, "03-br-direct.png") });

  // ---------- 4. plus d'aperçu : retour à la simulation ----------
  B.jeu = false; B.chute = false;
  B.ws.close();
  const t0 = Date.now();
  const a4 = await jusqua(async () => { const a = await apercu(); return a.source === "simulation" ? a : null; }, 30000, 250);
  const delai = (Date.now() - t0) / 1000;
  verifier(!!a4 && delai <= 14, "plus de joueur : la vue repasse en simulation (péremption 3 s + hystérésis 4 s)", `${delai.toFixed(1)} s`);
  await page.screenshot({ path: join(SORTIE, "04-retour-simulation.png") });
  verifier(erreurs.length === 0, "aucune erreur JavaScript", erreurs.slice(0, 3).join(" | "));
  await ctx.close();
} catch (e) {
  console.error("ERREUR", e);
  echecs.push(String(e.message ?? e));
} finally {
  for (const f of fermes) f();
  try { await nav?.close(); } catch { /* */ }
  arreter();
}
console.log(echecs.length ? `\n${echecs.length} échec(s) : ${echecs.join(" ; ")}` : "\ntout est ok");
console.log(`captures : ${SORTIE}`);
process.exit(echecs.length ? 1 : 0);
