#!/usr/bin/env node
/**
 * Captures du tigre bipède armé des bots du Battle Royale (solo, rendu logiciel) : lance `serveur-fps` et `next dev` sur des ports libres, entre en
 * ARÈNE (aucune partie de BR à lancer : les bots sont posés côté CLIENT par le crochet `window.__arene.avatarBot`, lib/fps/rendu-bots.ts) et
 * photographie en 1280×720 un bot local devant la caméra : immobile avec chacune des cinq armes principales (face et profil), en marche, tirant,
 * rechargeant, mort (ragdoll), sous parachute. Mesure ensuite le coût CPU des mises à jour des bots par image avec 12 bots, pool de 6 puis de 12
 * tigres complets (budget : ≤ 3 ms par image), et vérifie que le fil de fer reprend les bots hors pool.
 * Usage : node scripts/fps/captures_bots.mjs   (Node 22 ; Playwright : `npm i --no-save playwright` ou PLAYWRIGHT_DIR)
 * Variables : E2E_OUT (captures, défaut <tmp>/pdj-captures-bots), E2E_URL / E2E_WS (serveurs déjà lancés), E2E_PAGE, ARMES (liste JSON des armes principales),
 *             SANS_MESURE=1 (pas de mesure du coût CPU).
 * Le rendu logiciel tourne à 2–10 images/s : le bot « marche » en ralenti, les captures de mouvement sont des instantanés. Code de sortie : 0 si les
 * vérifications (pool plein, aucune erreur JavaScript) passent.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SORTIE = process.env.E2E_OUT ?? join(tmpdir(), "pdj-captures-bots");
const PAGE = process.env.E2E_PAGE ?? "/arene-e2e-introuvable";
const ARMES = JSON.parse(process.env.ARMES ?? "null") ?? ["mitraillette", "pompe", "sniper", "fusil_assaut", "mitrailleuse"];
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const portLibre = () => new Promise((ok, ko) => { const s = createServer(); s.once("error", ko); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });
async function attendreHttp(url, ms) { const fin = Date.now() + ms; while (Date.now() < fin) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* */ } await dormir(500); } throw new Error(`injoignable : ${url}`); }
const enfants = [];
function lancer(cmd, args, opts) { const e = spawn(cmd, args, { ...opts, detached: true, stdio: ["ignore", "pipe", "pipe"] }); e.journal = []; const n = (b) => { e.journal.push(String(b)); if (e.journal.length > 300) e.journal.shift(); }; e.stdout.on("data", n); e.stderr.on("data", n); enfants.push(e); return e; }
const arreter = () => { for (const e of enfants) { try { process.kill(-e.pid, "SIGTERM"); } catch { /* */ } } };
const chargerPlaywright = () => { for (const b of [process.env.PLAYWRIGHT_DIR, RACINE, process.cwd()].filter(Boolean)) { try { return createRequire(join(b, "x.js"))("playwright"); } catch { /* */ } } return createRequire(import.meta.url)("playwright"); };

mkdirSync(SORTIE, { recursive: true });
const { chromium } = chargerPlaywright();
let nav = null, code = 0;
let erreurs = [];
const verifs = [];
const verifier = (ok, quoi) => { verifs.push([ok, quoi]); console.log(`${ok ? "OK    " : "ÉCHEC "} ${quoi}`); if (!ok) code = 1; };
try {
  let urlWs = process.env.E2E_WS;
  if (!urlWs) {
    const port = await portLibre();
    urlWs = `ws://localhost:${port}`;
    const b = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: join(RACINE, "serveur-fps"), encoding: "utf8" });
    if (b.status !== 0) throw new Error(b.stdout + b.stderr);
    const h = String(3_600_000);
    const srv = lancer(process.execPath, ["dist/index.js"], { cwd: join(RACINE, "serveur-fps"), env: { ...process.env, PORT: String(port), SCENE_JSON: join(RACINE, "public/agroparc/scene.json"), PDJ_FPS_AVION_MIN_MS: h, PDJ_FPS_AVION_MAX_MS: h, PDJ_FPS_BUS_MIN_MS: h, PDJ_FPS_BUS_MAX_MS: h, PDJ_FPS_EVT_MIN_MS: "600000", PDJ_FPS_EVT_MAX_MS: "600000" } });
    await attendreHttp(`http://localhost:${port}/sante`, 20000).catch((e) => { throw new Error(e.message + srv.journal.join("")); });
  }
  let urlNext = process.env.E2E_URL;
  if (!urlNext) {
    const port = await portLibre();
    urlNext = `http://localhost:${port}`;
    lancer(process.execPath, [join(RACINE, "node_modules/next/dist/bin/next"), "dev", "-p", String(port)], { cwd: RACINE, env: { ...process.env, NEXT_PUBLIC_FPS_WS_URL: urlWs, NEXT_TELEMETRY_DISABLED: "1" } });
    await attendreHttp(`${urlNext}${PAGE}`, 240000);
  }
  console.log(`serveur ${urlWs} · site ${urlNext} · captures ${SORTIE}`);
  nav = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    let verrou = null;
    Object.defineProperty(Document.prototype, "pointerLockElement", { get: () => verrou, configurable: true });
    Element.prototype.requestPointerLock = function () { verrou = this; queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange"))); return Promise.resolve(); };
    Document.prototype.exitPointerLock = function () { verrou = null; document.dispatchEvent(new Event("pointerlockchange")); };
    // l'aide des commandes (12 s après l'entrée) couvre le bas de l'écran : déjà vue
    try { localStorage.setItem("pdj-fps-aide-vue", "1"); } catch { /* */ }
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 400)));
  page.on("crash", () => erreurs.push("PAGE CRASH (mémoire ?)"));
  // (un 404 de ressource, favicon ou page d'essai, n'est pas une erreur du jeu)
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erreurs.push(m.text().slice(0, 400)); });
  const ev = (f, a) => page.evaluate(f, a);
  const capture = (nom) => page.screenshot({ path: join(SORTIE, `${nom}.png`) });

  // ---- entrée en arène (un `next dev` à froid recharge la page pendant les premières compilations : on recommence jusqu'à y être)
  let entre = false;
  for (let essai = 0; essai < 5 && !entre; essai++) {
    try {
      console.log(`entrée en arène, essai ${essai}`);
      await page.goto(`${urlNext}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 180000 });
      await dormir(4000);
      await page.keyboard.type("myrtille", { delay: 60 });
      const b = page.getByRole("button", { name: /^Arène/ }).first();
      await b.waitFor({ state: "visible", timeout: 90000 });
      await b.evaluate((e) => e.click());
      console.log("  panneau Arène ouvert");
      // connexion ouverte, puis `entrer` (il choisit lui-même le mode arène si le panneau est resté sur un autre)
      const connecte = Date.now() + 60000;
      while (Date.now() < connecte && !(await ev(() => window.__arene?.etat().connexion === "ouvert").catch(() => false))) await dormir(500);
      await dormir(1500);
      console.log("  connexion :", await ev(() => window.__arene?.etat().connexion).catch(() => "?"));
      await ev(() => window.__arene.entrer({ principale: "fusil_assaut", secondaire: "pistolet" }));
      // (le premier chargement de `lib/fps/jeu` par `next dev` à froid peut prendre plusieurs minutes)
      const fin = Date.now() + 240000;
      while (Date.now() < fin && !(await ev(() => !!window.__arene?.etat().jeu?.apparu).catch(() => false))) await dormir(500);
      entre = await ev(() => !!window.__arene?.etat().jeu?.apparu).catch(() => false);
    } catch (e) { console.log("essai", essai, e.message.split("\n")[0]); }
  }
  if (!entre) throw new Error("impossible d'entrer en arène");
  await dormir(3000);
  await page.getByRole("button", { name: /^Jouer$/i }).first().click({ timeout: 10000 }).catch(() => null);
  await dormir(1500);

  // ---- décor : le joueur regarde l'horizon ; le bot est posé à `d` m devant lui, de face (`rel` = 0) ou de profil
  const moi = await ev(() => window.__arene.etat().jeu.p);
  const lacet = await ev(() => window.__arene.etat().jeu.lacet ?? 0);
  await ev(([l]) => window.__arene.regarder(l, 0), [lacet]);
  const avant = [-Math.sin(lacet), -Math.cos(lacet)];
  const droite = [Math.cos(lacet), -Math.sin(lacet)];
  const place = (d, lateral = 0) => [moi[0] + avant[0] * d + droite[0] * lateral, moi[1], moi[2] + avant[1] * d + droite[1] * lateral];
  const bot = (opts) => ev(([o]) => { window.__arene.avatarBot("b1", o); }, [opts]);
  /** attend que le bot soit dessiné en tigre (modèle chargé, emplacement attribué) ; renvoie le bilan */
  async function attendreTigre() {
    const fin = Date.now() + 120000;
    let b = null;
    while (Date.now() < fin) {
      b = await ev(() => window.__arene.avatarBot());
      if (b?.emplacements && b.emplacements.occupes >= 1) return b;
      await dormir(500);
    }
    return b;
  }
  await bot({ p: place(7), lacet: lacet + Math.PI, arme: "fusil_assaut" });
  const b0 = await attendreTigre();
  verifier(!!b0?.emplacements && b0.emplacements.occupes >= 1, `un bot local reçoit un tigre complet du pool (${JSON.stringify(b0?.emplacements)})`);
  await dormir(1500);

  for (const arme of ARMES) {
    await bot({ p: place(7), lacet: lacet + Math.PI, arme, vitesse: [0, 0], recharge: false, tirToutesLesS: 0, vivant: true, chute: undefined });
    await dormir(2500);
    await capture(`bot-${arme}-face`);
    await bot({ p: place(7), lacet: lacet + Math.PI / 2, arme });
    await dormir(2500);
    await capture(`bot-${arme}-profil`);
  }
  // visée de côté et vers le haut : le torse et la tête suivent, la visée garde l'arme dans les mains
  await bot({ p: place(7), lacet: lacet + Math.PI - 0.8, tangage: 0.4, arme: "mitrailleuse" });
  await dormir(2500);
  await capture("bot-vise-cote-haut");
  // en marche (de profil, vers la droite de l'écran) : le trot, les pieds plantés
  await bot({ p: place(9, -3), lacet: lacet + Math.PI / 2, arme: "fusil_assaut", vitesse: [droite[0] * 2.5, droite[1] * 2.5] });
  await dormir(1800);
  await capture("bot-marche-1");
  await dormir(1800);
  await capture("bot-marche-2");
  // à reculons : il regarde le joueur et recule
  await bot({ p: place(10), lacet: lacet + Math.PI, vitesse: [avant[0] * 2.5, avant[1] * 2.5] });
  await dormir(1800);
  await capture("bot-recul");
  // tirs (flash, recul des pattes) puis recharge
  await bot({ p: place(7), lacet: lacet + Math.PI, vitesse: [0, 0], tirToutesLesS: 0.35 });
  await dormir(1500);
  await capture("bot-tir-1");
  await dormir(700);
  await capture("bot-tir-2");
  await bot({ p: place(7), lacet: lacet + Math.PI, tirToutesLesS: 0, recharge: true });
  await dormir(1500);
  await capture("bot-recharge");
  // parachute (chute en cours) puis mort (ragdoll sur le sol de l'arène)
  await bot({ p: [place(7)[0], moi[1] + 3, place(7)[2]], lacet: lacet + Math.PI, recharge: false, chute: "voile" });
  await dormir(2000);
  await capture("bot-parachute");
  await bot({ p: place(7), chute: undefined, vivant: true });
  await dormir(1500);
  await bot({ vivant: false });
  for (const [i, ms] of [[1, 600], [2, 1500], [3, 2500]]) { await dormir(ms); await capture(`bot-mort-${i}`); }
  await ev(() => window.__arene.avatarBot("b1", null));

  if (!process.env.SANS_MESURE) {
    // coût CPU des mises à jour des bots : 12 bots en couronne autour du joueur (6 à 30 m), qui marchent et tirent, pool de 6 puis de 12
    for (const pool of [6, 12]) {
      await ev(([n]) => { for (let i = 0; i < 12; i++) window.__arene.avatarBot(`b${i + 20}`, null); window.__arene.avatarBot("b0", { poolMax: n }); window.__arene.avatarBot("b0", null); }, [pool]);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2, r = 6 + i * 2.2;
        await ev(([id, p, l, v]) => window.__arene.avatarBot(id, { p, lacet: l, arme: "fusil_assaut", vitesse: v, tirToutesLesS: 0.5 }), [`b${i + 20}`, [moi[0] + Math.cos(a) * r, moi[1], moi[2] + Math.sin(a) * r], a, [Math.cos(a + 1.5) * 3, Math.sin(a + 1.5) * 3]]);
      }
      await dormir(6000);
      const b1 = await ev(() => window.__arene.avatarBot());
      await dormir(8000);
      const b2 = await ev(() => window.__arene.avatarBot());
      const cpu = (b2.cpuTotalMs - b1.cpuTotalMs) / Math.max(1, b2.images - b1.images);
      console.log(`pool ${pool} : 12 bots, ${JSON.stringify(b2.emplacements)}, ${cpu.toFixed(2)} ms de CPU par image (JS des bots, hors GPU) sur ${b2.images - b1.images} images`);
      await capture(`bots-12-pool-${pool}`);
      verifier(b2.emplacements.occupes === Math.min(pool, 12), `pool de ${pool} : ${b2.emplacements.occupes} tigres complets en service (les autres en fil de fer)`);
      verifier(cpu <= 3, `pool de ${pool} : ${cpu.toFixed(2)} ms de CPU par image pour les bots (budget 3 ms)`);
    }
  }
  verifier(erreurs.length === 0, `aucune erreur JavaScript (${erreurs.slice(0, 3).join(" | ")})`);
} catch (e) {
  console.error("ERREUR", e.message);
  console.error("erreurs de la page :", typeof erreurs === "undefined" ? "?" : JSON.stringify(erreurs.slice(0, 8)));
  code = 1;
} finally {
  await nav?.close().catch(() => null);
  arreter();
}
process.exit(code);
