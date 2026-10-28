#!/usr/bin/env node
/**
 * Captures du mode zombies (solo, rendu logiciel) : lance `serveur-fps` et `next dev` sur des ports libres, entre dans une partie de zombies et
 * photographie la carte « Service de midi » depuis une liste de points de vue (téléportation CÔTÉ CLIENT seulement : le serveur garde le joueur au
 * départ, ce qui suffit pour photographier le décor), puis attend les premiers tigres aux fenêtres de l'open space.
 * Usage : node scripts/fps/captures_zombies.mjs   (E2E_OUT = dossier des captures, défaut <tmp>/pdj-captures-zombies ; E2E_URL / E2E_WS réutilisent des serveurs lancés)
 * RAGDOLL=1 (avec PAUSE courte) : au lieu des points de vue, les morts désarticulées des tigres, une par arme (SCENARIOS, DELAIS en ms).
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SORTIE = process.env.E2E_OUT ?? join(tmpdir(), "pdj-captures-zombies");
const PAGE = "/arene-e2e-introuvable";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const portLibre = () => new Promise((ok, ko) => { const s = createServer(); s.once("error", ko); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });
async function attendreHttp(url, ms) { const fin = Date.now() + ms; while (Date.now() < fin) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* */ } await dormir(500); } throw new Error(`injoignable : ${url}`); }
const enfants = [];
function lancer(cmd, args, opts) { const e = spawn(cmd, args, { ...opts, detached: true, stdio: ["ignore", "pipe", "pipe"] }); e.journal = []; const n = (b) => { e.journal.push(String(b)); if (e.journal.length > 300) e.journal.shift(); }; e.stdout.on("data", n); e.stderr.on("data", n); enfants.push(e); return e; }
const arreter = () => { for (const e of enfants) { try { process.kill(-e.pid, "SIGTERM"); } catch { /* */ } } };
const chargerPlaywright = () => { for (const b of [process.env.PLAYWRIGHT_DIR, RACINE, process.cwd()].filter(Boolean)) { try { return createRequire(join(b, "x.js"))("playwright"); } catch { /* */ } } return createRequire(import.meta.url)("playwright"); };

/** Points de vue : [nom, position (x, z), point regardé (x, y, z)]. */
const VUES = JSON.parse(process.env.VUES ?? "null") ?? [
  ["01-open-space-depart", [118, -24.5], [109.8, 1.4, -21.5]],
  ["02-open-space-vers-D2", [112, -24], [120.2, 1.4, -33.4]],
  ["03-craie-revolver", [127, -19.5], [127, 1.5, -15.5]],
  ["04-craie-pompe", [108.5, -26.5], [104.4, 1.5, -28.4]],
  ["05-salle-pause", [136, -20], [148, 1.2, -19]],
  ["06-atout-pausecafe", [141, -22.5], [142.6, 1.2, -28]],
  ["07-boite-B1", [147, -17], [151.5, 1, -18.8]],
  ["08-cour-centre", [124, -45], [140, 2, -62]],
  ["09-cuisine", [148, -57], [158.3, 1, -67.3]],
  ["10-cour-est-epee", [190, -50], [194, 1.5, -57.5]],
  ["11-local-courant", [207, -40], [214, 1.4, -45.8]],
  ["12-labo-pap", [94, -36], [99, 1.2, -30.4]],
  ["13-fenetre-N2c-dedans", [117, -68], [114.65, 1.3, -78.15]],
  // v8 : les deux cours à olivier (anneau d'entraînement), le parking serré de la Cour Ouest, les boîtes dans leur coin
  ["14-olivier-cour-centre", [117, -47], [125.5, 2.6, -54.5]],
  ["15-cour-centre-anneau", [140, -40], [118, 1.5, -64]],
  ["16-olivier-cour-est", [170, -29], [180.5, 2.6, -36.5]],
  ["17-cour-est-livraison-B3", [182, -30], [172.5, 1, -19.5]],
  ["18-parking-rue", [60.7, -53.6], [85, 1.2, -47.6]],
  ["19-parking-allees", [74.4, -61.2], [81.5, 1.2, -86]],
  ["20-boite-B2-coin", [131, -68], [125.6, 0.6, -76.4]],
];

mkdirSync(SORTIE, { recursive: true });
const { chromium } = chargerPlaywright();
let nav = null;
try {
  let urlWs = process.env.E2E_WS;
  if (!urlWs) {
    const port = await portLibre();
    urlWs = `ws://localhost:${port}`;
    const b = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: join(RACINE, "serveur-fps"), encoding: "utf8" });
    if (b.status !== 0) throw new Error(b.stdout + b.stderr);
    const srv = lancer(process.execPath, ["dist/index.js"], { cwd: join(RACINE, "serveur-fps"), env: { ...process.env, PORT: String(port), SCENE_JSON: join(RACINE, "public/agroparc/scene.json"), PDJ_FPS_ZOMBIES_ARGENT: "50000", PDJ_FPS_ZOMBIES_PAUSE_MS: process.env.PAUSE ?? "90000", PDJ_FPS_ZOMBIES_TOTAL: "12", PDJ_FPS_ZOMBIES_GRIFFE: "1", ...(process.env.COURANT ? { PDJ_FPS_ZOMBIES_COURANT: "1" } : {}) } });
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
  nav = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    let verrou = null;
    Object.defineProperty(Document.prototype, "pointerLockElement", { get: () => verrou, configurable: true });
    Element.prototype.requestPointerLock = function () { verrou = this; queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange"))); return Promise.resolve(); };
    Document.prototype.exitPointerLock = function () { verrou = null; document.dispatchEvent(new Event("pointerlockchange")); };
    try { localStorage.setItem("pdj-fps-mode", "zombies"); } catch { /* */ }
  });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 400)));
  page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text().slice(0, 400)); });
  const ev = (f, a) => page.evaluate(f, a);
  const capture = (nom) => page.screenshot({ path: join(SORTIE, `${nom}.png`) });
  /** Ouvre la vue Palantir, choisit les zombies et lance la partie (le lobby n'a qu'un joueur : il est l'hôte). */
  async function entrer() {
  // un `next dev` à froid recharge la page pendant les premières compilations : on recommence tout le parcours jusqu'à l'entrée en jeu
    let entre = false;
    for (let essai = 0; essai < 5 && !entre; essai++) {
      try {
        await page.goto(`${urlNext}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 180000 });
        await dormir(4000);
        await page.keyboard.type("myrtille", { delay: 60 });
        const b = page.getByRole("button", { name: /^Arène/ }).first();
        await b.waitFor({ state: "visible", timeout: 90000 });
        await b.evaluate((e) => e.click());
        const radio = page.getByRole("radio", { name: /Zombies tigres/ });
        await radio.waitFor({ timeout: 60000 });
        await radio.evaluate((e) => e.click());
        await page.locator("aside[aria-label='Zombies']").waitFor({ timeout: 30000 });
        await dormir(1500);
        await capture("00-lobby");
        await page.getByRole("button", { name: /Lancer la partie/ }).evaluate((e) => e.click(), undefined, { timeout: 15000 });
        const fin = Date.now() + 60000;
        while (Date.now() < fin && !(await ev(() => !!window.__arene?.etat().jeu).catch(() => false))) await dormir(500);
        entre = await ev(() => !!window.__arene?.etat().jeu).catch(() => false);
      } catch (e) { console.log("essai", essai, e.message.split("\n")[0]); }
    }
    if (!entre) throw new Error("impossible d'entrer en partie");
    await dormir(6000);
    // le menu « Prêt ? » couvre la vue : « Jouer » prend la souris (verrouillage émulé)
    await page.getByRole("button", { name: /^Jouer$/i }).first().click({ timeout: 10000 }).catch(() => null);
    await dormir(2000);
  }
  await entrer();
  await capture("00-entree");
  const depart = await ev(() => window.__arene.etat().jeu.p);
  if (process.env.RAGDOLL) {
    // (v8) morts désarticulées : à chaque scénario, un tigre d'essai (côté client, `tuerZombie` avec `p`) meurt dans la cour avec cette arme,
    // touché de côté, photographié trois fois pendant sa chute (rendu logiciel lent : le ragdoll avance d'au plus 8 pas de 1/120 s par image,
    // la chute dure plusieurs secondes réelles). Caméra en CAM, tigre en TIGRE (x, z), coup venant de 5 m sur son côté.
    const SCENARIOS = JSON.parse(process.env.SCENARIOS ?? "null") ?? [
      ["pistolet", { arme: "pistolet" }],
      ["pompe", { arme: "pompe" }],
      ["tete-revolver", { arme: "revolver", zone: "tete" }],
      ["couteau", { arme: "couteau", cause: "melee" }],
      ["epee", { arme: "epee", cause: "melee" }],
      ["grenade", { arme: "lance_grenades", cause: "explosion" }],
      ["rayon", { arme: "rayon" }],
      ["rayon-goulaf", { arme: "rayon", ameliore: true }],
      ["petit-pompe", { arme: "pompe", type: 3 }],
      ["chef-rayon", { arme: "rayon", type: 2 }],
      ["rayon-mur", { arme: "rayon", depuis: "camera" }],
    ];
    const DELAIS = JSON.parse(process.env.DELAIS ?? "null") ?? [800, 3500, 9000];
    const CAM = JSON.parse(process.env.CAM ?? "null") ?? [124, -45];
    const TIGRE = JSON.parse(process.env.TIGRE ?? "null") ?? [131.5, -55.5];
    let n = 0;
    for (const [nom, o] of SCENARIOS) {
      if (!(await ev(() => !!window.__arene?.etat().jeu).catch(() => false))) { console.log("rechargée : nouvelle entrée"); await entrer(); }
      const ok = await ev(([o, cam, t, n]) => {
        window.__arene.teleporter([cam[0], 0, cam[1]]);
        const e = window.__arene.etat().jeu.oeil;
        const vx = t[0] - e[0], vz = t[1] - e[2], l = Math.hypot(vx, vz), ux = vx / l, uz = vz / l;
        window.__arene.regarder(Math.atan2(-vx, -vz), Math.atan2(0.5 - e[1], l));
        // le tireur est de côté, à 5 m du tigre qui le chargeait (`depuis: "camera"` : c'est la caméra qui tire, le tigre part vers le fond)
        const [sx, sz] = o.depuis === "camera" ? [-ux, -uz] : [uz, -ux];
        const src = o.cause === "explosion" ? [t[0] + sx * 1.2, 0.3, t[1] + sz * 1.2] : o.depuis === "camera" ? e : [t[0] + sx * 5, 1.6, t[1] + sz * 5];
        const cap = Math.atan2(-sx, -sz);
        const { depuis, ...reste } = o;
        return window.__arene.tuerZombie(-1000 - n, { ...reste, src, p: [t[0], 0, t[1]], cap });
      }, [o, CAM, TIGRE, n++]);
      console.log("mort", nom, ok);
      let avant = 0;
      for (const d of DELAIS) {
        await dormir(d - avant);
        avant = d;
        await capture(`30-ragdoll-${nom}-${d}`);
      }
      console.log("ragdolls", JSON.stringify(await ev(() => window.__arene.etat().jeu.rugissements).catch(() => null)));
    }
  }
  for (const [nom, p, cible] of process.env.RAGDOLL ? [] : VUES) {
    // `next dev` recharge parfois la page (compilation à la demande) : on rentre en partie
    if (!(await ev(() => !!window.__arene?.etat().jeu).catch(() => false))) { console.log("rechargée : nouvelle entrée"); await entrer(); }
    await ev(([p, c]) => {
      window.__arene.teleporter([p[0], 0, p[1]]);
      const o = window.__arene.etat().jeu.oeil;
      const dx = c[0] - p[0], dz = c[2] - p[1], dy = c[1] - o[1];
      window.__arene.regarder(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    }, [p, cible]);
    await dormir(2500);
    await capture(nom);
    console.log("capture", nom);
  }
  if (!process.env.SANS_TIGRES && !process.env.RAGDOLL) {
    // retour au départ (position du serveur) : on attend la manche et les tigres aux fenêtres
    await ev((p) => window.__arene.teleporter(p), depart);
    let n = 0;
    const finT = Date.now() + 240000;
    while (Date.now() < finT && n < 5) {
      const t = await ev(() => { const j = window.__arene.etat().jeu; return { p: j.p, z: (j.zombies ?? []).map((t) => [t.x, t.z, t.mode]) }; }).catch(() => null);
      if (t && t.z.length) {
        const [x, z] = t.z.map((a) => [a[0], a[1]]).sort((a, b) => Math.hypot(a[0] - t.p[0], a[1] - t.p[2]) - Math.hypot(b[0] - t.p[0], b[1] - t.p[2]))[0];
        await ev(([x, z]) => { const o = window.__arene.etat().jeu.oeil; const dx = x - o[0], dz = z - o[2]; window.__arene.regarder(Math.atan2(-dx, -dz), Math.atan2(1.2 - o[1], Math.hypot(dx, dz))); }, [x, z]);
        await dormir(800);
        await capture(`20-tigres-${n++}`);
        console.log("tigres", JSON.stringify(t.z.map((a) => [+a[0].toFixed(0), +a[1].toFixed(0), a[2]])));
        await dormir(4000);
      } else await dormir(1500);
    }
  }
  console.log("erreurs JS :", erreurs.length ? erreurs.join("\n") : "aucune");
} catch (e) {
  console.error("ÉCHEC", e.message);
  process.exitCode = 1;
} finally {
  await nav?.close().catch(() => null);
  if (!process.env.E2E_GARDER) arreter();
}
