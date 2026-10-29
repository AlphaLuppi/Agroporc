#!/usr/bin/env node
/**
 * Captures « avant / après » du rework de la DA de Palantir (issue #83, spec 2026-10-29-da-palantir-design.md) et mesure de fluidité.
 * Lance `serveur-fps` et `next dev` sur des ports libres (jamais 8787), pilote un Chromium headless en rendu logiciel (SwiftShader) par
 * `window.__palantir` (vue aérienne : `cadrer`, `placer`, `viser`) et `window.__arene` (arène, zombies, Battle Royale : `teleporter`, `regarder`),
 * et range les images en JPEG dans E2E_OUT.
 *
 * Usage : PREFIXE=avant|apres E2E_OUT=docs/medias/palantir-da node scripts/palantir/captures_da.mjs
 *   GROUPES=aerien,arene,zombies,br   groupes à jouer (défaut : tous)
 *   VUES=1,5,9                        ne photographie que ces vues (numéros de la spec)
 *   MESURE=1                          mesure aussi la fluidité (60 requestAnimationFrame) aux vues 1, 5 et 9 → <PREFIXE>-fluidite.json
 *   E2E_URL / E2E_WS                  réutilisent un site / un serveur déjà lancés
 * Pièges : le rendu logiciel est lent (screenshot avec timeout de 120 s, JPEG, deviceScaleFactor 1) ; la téléportation est côté client seulement ;
 * un `next dev` à froid recharge les pages ouvertes (on recommence l'entrée).
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SORTIE = process.env.E2E_OUT ?? join(tmpdir(), "pdj-captures-da");
const PREFIXE = process.env.PREFIXE ?? "apres";
const GROUPES = (process.env.GROUPES ?? "aerien,arene,zombies,br").split(",");
const VUES_VOULUES = process.env.VUES ? process.env.VUES.split(",").map(Number) : null;
const MESURE = !!process.env.MESURE;
const PAGE = "/arene-e2e-introuvable";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const portLibre = () => new Promise((ok, ko) => { const s = createServer(); s.once("error", ko); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });
async function attendreHttp(url, ms) { const fin = Date.now() + ms; while (Date.now() < fin) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* */ } await dormir(500); } throw new Error(`injoignable : ${url}`); }
const enfants = [];
function lancer(cmd, args, opts) { const e = spawn(cmd, args, { ...opts, detached: true, stdio: ["ignore", "pipe", "pipe"] }); e.journal = []; const n = (b) => { e.journal.push(String(b)); if (e.journal.length > 300) e.journal.shift(); }; e.stdout.on("data", n); e.stderr.on("data", n); enfants.push(e); return e; }
const arreter = () => { for (const e of enfants) { try { process.kill(-e.pid, "SIGTERM"); } catch { /* */ } } };
const chargerPlaywright = () => { for (const b of [process.env.PLAYWRIGHT_DIR, RACINE, process.cwd()].filter(Boolean)) { try { return createRequire(join(b, "x.js"))("playwright"); } catch { /* */ } } return createRequire(import.meta.url)("playwright"); };

// ---------------------------------------------------------------------------------------------------------------------
// Points de vue de l'arène, calculés sur scene.json (les mêmes « avant » et « après »)
// ---------------------------------------------------------------------------------------------------------------------
const scene = JSON.parse(readFileSync(join(RACINE, "public/agroparc/scene.json"), "utf8"));
const dansAnneau = (x, z, r) => { let d = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) d = !d; return d; };
const dansBatiment = (x, z, marge = 0) => scene.buildings.some((b) => {
  if (b.type) return false;
  if (dansAnneau(x, z, b.r)) return true;
  if (!marge) return false;
  for (let i = 0; i < b.r.length; i++) {
    const [ax, az] = b.r[i], [bx, bz] = b.r[(i + 1) % b.r.length];
    const ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz, t = l2 ? Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / l2)) : 0;
    if (Math.hypot(x - ax - t * ux, z - az - t * uz) < marge) return true;
  }
  return false;
});
const ligneLibre = (a, b) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2); for (let i = 1; i < n; i++) if (dansBatiment(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n)) return false; return true; };
const ROND = [28.2, 2.5];
/** Premier point à `d` m du centre (par pas de 15°), hors bâtiment, d'où le centre est en vue. */
function pointEnVue(centre, d) {
  for (let a = 0; a < 360; a += 15) {
    const p = [centre[0] + Math.cos((a * Math.PI) / 180) * d, centre[1] + Math.sin((a * Math.PI) / 180) * d];
    if (!dansBatiment(p[0], p[1], 2) && ligneLibre(p, centre)) return p;
  }
  return [centre[0], centre[1] + d];
}
/**
 * Mur de la porte (calculé avec `murDePorte` et `mursDe` de lib/agroparc3d/facade.ts sur scene.json) : milieu du mur et normale sortante. On s'y place
 * `d` m en avant, face à la porte, pour voir la vitrine du rez-de-chaussée et l'enseigne néon des restaurants.
 */
const PORTES = {
  trefle: { x: 100.05, z: 45.8, nx: 0.9574, nz: 0.2889 },
  cba: { x: -186.65, z: -21.75, nx: -0.956, nz: -0.2934 },
};
const devantPorte = (k, d, lateral = 0) => { const p = PORTES[k]; return { p: [p.x + p.nx * d - p.nz * lateral, p.z + p.nz * d + p.nx * lateral], porte: [p.x, p.z] }; };
/** Point d'où la porte est en vue (rien entre les deux), le plus près possible de la normale, à 6 m ou plus du mur : un petit bâtiment peut masquer la porte de face. */
function devantPorteLibre(k) {
  const p = PORTES[k];
  const essais = [];
  for (const d of [10, 14, 18, 8, 22, 6]) for (const lat of [0, 6, -6, 12, -12, 18, -18, 25, -25]) essais.push([d, lat]);
  for (const [d, lat] of essais) {
    const c = devantPorte(k, d, lat);
    if (dansBatiment(c.p[0], c.p[1], 2)) continue;
    if (ligneLibre(c.p, [p.x + p.nx * 0.6, p.z + p.nz * 0.6])) return c;
  }
  return devantPorte(k, 14);
}

/** Allée d'arbres : sur une voie M ou R, le point et le sens où l'on voit le plus d'arbres à moins de 8 m de l'axe, sur 60 m. */
function alleeArbres() {
  let meilleur = null;
  for (const r of scene.roads) {
    if (r.c !== "M" && r.c !== "R") continue;
    for (let i = 0; i < r.p.length - 1; i++) {
      const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 20) continue;
      for (const sens of [1, -1]) {
        const ux = ((bx - ax) / L) * sens, uz = ((bz - az) / L) * sens;
        const dep = [sens > 0 ? ax : bx, sens > 0 ? az : bz];
        let n = 0;
        for (const [tx, tz] of scene.trees) {
          const s = (tx - dep[0]) * ux + (tz - dep[1]) * uz, w = Math.abs((tx - dep[0]) * -uz + (tz - dep[1]) * ux);
          if (s > 5 && s < 65 && w < 8) n++;
        }
        if (!meilleur || n > meilleur.n) meilleur = { n, dep, ux, uz };
      }
    }
  }
  const { dep, ux, uz } = meilleur;
  return { depart: dep, vers: [dep[0] + ux * 40, dep[1] + uz * 40], n: meilleur.n };
}

/** Vues de l'arène : [numéro, nom, position (x, z), point regardé (x, y, z)]. */
function vuesArene() {
  const rond = pointEnVue(ROND, 45);
  const allee = alleeArbres();
  const trefle = devantPorteLibre("trefle");
  const cba = devantPorteLibre("cba");
  return [
    [5, "05-arene-rond-point", rond, [ROND[0], 1.2, ROND[1]]],
    [6, "06-arene-passage-pieton", [36.5, -36.4 + 14], [36.5, 0.6, -36.4]],
    [7, "07-arene-parking-conduisibles", [0, -30 + 26], [0, 1.2, -30]],
    [8, "08-arene-bistrot-trefle", trefle.p, [trefle.porte[0], 2.4, trefle.porte[1]]],
    [9, "09-arene-facade-cba", cba.p, [cba.porte[0], 2.4, cba.porte[1]]],
    [10, "10-arene-allee-arbres", allee.depart, [allee.vers[0], 4, allee.vers[1]]],
  ];
}

mkdirSync(SORTIE, { recursive: true });
const { chromium } = chargerPlaywright();
let nav = null;
const fluidite = {};
try {
  let urlWs = process.env.E2E_WS;
  if (!urlWs) {
    const port = await portLibre();
    urlWs = `ws://localhost:${port}`;
    const b = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: join(RACINE, "serveur-fps"), encoding: "utf8" });
    if (b.status !== 0) throw new Error(b.stdout + b.stderr);
    const H = String(3_600_000);
    const srv = lancer(process.execPath, ["dist/index.js"], { cwd: join(RACINE, "serveur-fps"), env: {
      ...process.env, PORT: String(port), SCENE_JSON: join(RACINE, "public/agroparc/scene.json"),
      // arène : ni avion, ni bus, ni événements pendant les captures
      PDJ_FPS_AVION_MIN_MS: H, PDJ_FPS_AVION_MAX_MS: H, PDJ_FPS_BUS_MIN_MS: H, PDJ_FPS_BUS_MAX_MS: H, PDJ_FPS_EVT_MIN_MS: H, PDJ_FPS_EVT_MAX_MS: H,
      // zombies : pause longue (aucun tigre), argent en abondance
      PDJ_FPS_ZOMBIES_ARGENT: "50000", PDJ_FPS_ZOMBIES_PAUSE_MS: "600000", PDJ_FPS_ZOMBIES_TOTAL: "12",
      // Battle Royale : seul, avion longtemps en vol
      PDJ_FPS_BR_MIN_JOUEURS: "1", PDJ_FPS_BR_DECOMPTE_MS: "3000", PDJ_FPS_BR_VOL_MS: "600000", PDJ_FPS_BR_STATS: join(tmpdir(), `stats-br-da-${port}.json`),
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
  console.log(`serveur ${urlWs} · site ${urlNext} · ${PREFIXE} → ${SORTIE}`);
  nav = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const nouveauContexte = async (mode) => {
    const ctx = await nav.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await ctx.addInitScript((m) => {
      let verrou = null;
      Object.defineProperty(Document.prototype, "pointerLockElement", { get: () => verrou, configurable: true });
      Element.prototype.requestPointerLock = function () { verrou = this; queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange"))); return Promise.resolve(); };
      Document.prototype.exitPointerLock = function () { verrou = null; document.dispatchEvent(new Event("pointerlockchange")); };
      try { localStorage.setItem("pdj-fps-mode", m); } catch { /* */ }
    }, mode);
    const page = await ctx.newPage();
    const erreurs = [];
    page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 400)));
    page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text().slice(0, 400)); });
    page.erreurs = erreurs;
    return { ctx, page };
  };
  const veut = (n) => !VUES_VOULUES || VUES_VOULUES.includes(n);
  const photo = (page, nom) => page.screenshot({ path: join(SORTIE, `${PREFIXE}-${nom}.jpg`), type: "jpeg", quality: 82, timeout: 120000 });
  const mesurer = async (page, vue) => {
    if (!MESURE) return;
    // 30 images de chauffe écartées (compilation des programmes, premiers envois de tampons), puis 60 images mesurées
    const m = await page.evaluate(() => new Promise((ok) => {
      const t = []; let dernier = performance.now(), n = 0;
      const f = (now) => { if (n++ >= 30) t.push(now - dernier); dernier = now; if (t.length < 60) requestAnimationFrame(f); else { t.sort((a, b) => a - b); ok({ mediane: t[Math.floor(t.length / 2)], p95: t[Math.floor(t.length * 0.95)] }); } };
      requestAnimationFrame(f);
    }));
    fluidite[`vue${vue}`] = { mediane_ms: Math.round(m.mediane * 10) / 10, p95_ms: Math.round(m.p95 * 10) / 10 };
    console.log("fluidité vue", vue, JSON.stringify(fluidite[`vue${vue}`]));
  };
  /** Ouvre la vue Palantir par le code secret (une seule fois par essai : le retaper la refermerait). */
  const ouvrirPalantir = async (page) => {
    // un `next dev` à froid recompile et recharge la page à plusieurs reprises : une navigation interrompue n'est pas une erreur
    for (let essai = 0; ; essai++) {
      try {
        await page.goto(`${urlNext}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 180000 });
        await dormir(4000);
        await page.keyboard.type("myrtille", { delay: 60 });
        return;
      } catch (e) {
        if (essai >= 6) throw e;
        console.log("ouverture : navigation interrompue, nouvel essai :", e.message.split("\n")[0]);
        await dormir(8000);
      }
    }
  };

  // ------------------------------------------------------------------ vue aérienne : 1 à 4 et 13
  if (GROUPES.includes("aerien")) {
    const { ctx, page } = await nouveauContexte("arene");
    let pret = false;
    for (let essai = 0; essai < 6 && !pret; essai++) {
      try {
        await ouvrirPalantir(page);
        await page.waitForFunction(() => !!window.__palantir, null, { timeout: 90000 });
        pret = true;
      } catch (e) { console.log("aérien : essai", essai, e.message.split("\n")[0]); if (/REFUSED/.test(e.message)) for (const c of enfants) console.log("journal :", c.journal.slice(-12).join("").slice(-1500)); }
    }
    if (!pret) throw new Error("vue aérienne indisponible");
    await dormir(15000);
    /** Rejoue `f` ; si la page a été rechargée entre-temps (un `next dev` à froid recompile), rouvre la vue et recommence (3 essais). */
    const reprise = async (f) => {
      for (let essai = 0; ; essai++) {
        try { return await f(); } catch (e) {
          if (essai >= 3) throw e;
          console.log("aérien : page rechargée, nouvelle ouverture :", e.message.split("\n")[0]);
          await ouvrirPalantir(page);
          await page.waitForFunction(() => !!window.__palantir, null, { timeout: 90000 }).catch(() => null);
          await dormir(15000);
        }
      }
    };
    const aerien = [
      [1, "01-aerien-repos", null],
      [2, "02-aerien-rond-point", [28.2, 2.5, 120]],
      [3, "03-aerien-grand-parking", [115, 194, 140]],
      [4, "04-aerien-vival", [200, -2.8, 110]],
    ];
    for (const [n, nom, c] of aerien) {
      if (!veut(n)) continue;
      await reprise(async () => {
        if (c) await page.evaluate(([x, z, d]) => window.__palantir.cadrer(x, z, d), c); else await page.evaluate(() => window.__palantir.cadrer());
        await dormir(6000);
        await photo(page, nom);
        if (n === 1) await mesurer(page, 1);
      });
      if (n === 1 && process.env.MESURE_COUCHES) {
        // temps d'image avec chaque couche du décor cachée tour à tour (rendu logiciel : le coût est surtout le remplissage)
        const couches = ["chaussee", "marquages", "places", "pelouses", "haies", "arbres", "mobilier", "taches", "reseau"];
        const mediane = () => page.evaluate(() => new Promise((ok) => { const t = []; let d = performance.now(); const f = (now) => { t.push(now - d); d = now; if (t.length < 40) requestAnimationFrame(f); else { t.splice(0, 12); t.sort((a, b) => a - b); ok(Math.round(t[t.length >> 1])); } }; requestAnimationFrame(f); }));
        const res = { base0: await mediane(), base: await mediane() };
        for (const c of couches) { await page.evaluate((c) => window.__palantir.couches({ [c]: false }), c); res[`sans_${c}`] = await mediane(); await page.evaluate((c) => window.__palantir.couches({ [c]: true }), c); }
        await page.evaluate(() => window.__palantir.couches({ pelouses: false, taches: false })); res["sans_pelouses_taches"] = await mediane();
        await page.evaluate(() => window.__palantir.couches(Object.fromEntries(["chaussee", "marquages", "places", "pelouses", "haies", "arbres", "mobilier", "taches", "reseau"].map((c) => [c, false])))); res["sans_tout_le_decor_secondaire"] = await mediane();
        console.log("COUCHES", JSON.stringify(res));
        await page.evaluate(() => window.__palantir.couches(Object.fromEntries(["chaussee", "marquages", "places", "pelouses", "haies", "arbres", "mobilier", "taches", "reseau"].map((c) => [c, true]))));
      }
      console.log("capture", nom);
    }
    if (veut(13)) {
      const nb = await reprise(() => page.evaluate(() => window.__palantir.cachettes()));
      for (const [k, rang] of [[1, Math.round(nb * 0.1)], [2, Math.round(nb * 0.5)], [3, Math.round(nb * 0.9)]]) {
        await reprise(async () => {
          await page.evaluate((i) => { window.__palantir.placer(i); window.__palantir.viser(30); }, rang);
          await dormir(7000);
          await photo(page, `13-tigre-cachette-${k}`);
        });
        console.log("capture 13 tigre", k, "rang", rang);
      }
    }
    if (page.erreurs.length) console.log("erreurs aérien :", page.erreurs.slice(0, 5));
    await ctx.close();
  }

  // ------------------------------------------------------------------ arène : 5 à 10
  const entrerEnJeu = async (page, mode) => {
    const ev = (f, a) => page.evaluate(f, a);
    for (let essai = 0; essai < 6; essai++) {
      try {
        await ouvrirPalantir(page);
        const b = page.getByRole("button", { name: /^Arène/ }).first();
        await b.waitFor({ state: "visible", timeout: 90000 });
        await b.evaluate((e) => e.click());
        if (mode === "arene") {
          await page.locator("aside[aria-label='Arène']").waitFor({ state: "visible", timeout: 60000 });
          await dormir(1500);
          await ev(() => window.__arene.entrer({ principale: "fusil_assaut", secondaire: "pistolet" }));
        } else {
          const radio = page.getByRole("radio", { name: mode === "zombies" ? /Zombies tigres/ : /Battle Royale/ });
          await radio.waitFor({ timeout: 60000 });
          await radio.evaluate((e) => e.click());
          await page.locator(`aside[aria-label='${mode === "zombies" ? "Zombies" : "Battle Royale"}']`).waitFor({ timeout: 90000 });
          await dormir(1500);
          await page.getByRole("button", { name: /Lancer la partie/ }).evaluate((e) => e.click(), undefined, { timeout: 15000 });
        }
        const fin = Date.now() + 90000;
        while (Date.now() < fin && !(await ev(() => !!window.__arene?.etat().jeu).catch(() => false))) await dormir(500);
        if (await ev(() => !!window.__arene?.etat().jeu).catch(() => false)) {
          await dormir(6000);
          await page.getByRole("button", { name: /^Jouer$/i }).first().click({ timeout: 10000 }).catch(() => null);
          await dormir(2000);
          return;
        }
      } catch (e) { console.log(mode, ": essai", essai, e.message.split("\n")[0]); }
    }
    throw new Error(`impossible d'entrer en ${mode}`);
  };
  const regarderDepuis = (page, [x, z], [tx, ty, tz]) => page.evaluate(([x, z, tx, ty, tz]) => {
    window.__arene.teleporter([x, 0, z]);
    const e = window.__arene.etat().jeu.oeil;
    const vx = tx - e[0], vz = tz - e[2], l = Math.hypot(vx, vz);
    window.__arene.regarder(Math.atan2(-vx, -vz), Math.atan2(ty - e[1], l));
  }, [x, z, tx, ty, tz]);

  if (GROUPES.includes("arene")) {
    const { ctx, page } = await nouveauContexte("arene");
    await entrerEnJeu(page, "arene");
    await dormir(20000); // le panneau des touches du menu d'entrée s'efface de lui-même
    for (const [n, nom, pos, cible] of vuesArene()) {
      if (!veut(n)) continue;
      if (!(await page.evaluate(() => !!window.__arene?.etat().jeu).catch(() => false))) { console.log("page rechargée : nouvelle entrée"); await entrerEnJeu(page, "arene"); }
      for (let essai = 0; essai < 3; essai++) {
        try {
          await regarderDepuis(page, pos, cible);
          await dormir(5000);
          await photo(page, nom);
          if (n === 5 || n === 9) await mesurer(page, n);
          break;
        } catch (e) { console.log("arène : page rechargée :", e.message.split("\n")[0]); await entrerEnJeu(page, "arene"); await dormir(15000); }
      }
      console.log("capture", nom, JSON.stringify(pos));
    }
    if (page.erreurs.length) console.log("erreurs arène :", page.erreurs.slice(0, 5));
    await ctx.close();
  }

  // ------------------------------------------------------------------ zombies : 11 (Cour Ouest, limite de la boîte)
  if (GROUPES.includes("zombies") && veut(11)) {
    const { ctx, page } = await nouveauContexte("zombies");
    await entrerEnJeu(page, "zombies");
    await regarderDepuis(page, [76, -68], [60, 2, -75]);
    await dormir(5000);
    await photo(page, "11-zombies-cour-ouest");
    await regarderDepuis(page, [76, -68], [100, 2, -60]);
    await dormir(5000);
    await photo(page, "11-zombies-cour-ouest-b");
    console.log("capture 11");
    if (page.erreurs.length) console.log("erreurs zombies :", page.erreurs.slice(0, 5));
    await ctx.close();
  }

  // ------------------------------------------------------------------ Battle Royale : 12 (dans l'avion)
  if (GROUPES.includes("br") && veut(12)) {
    const { ctx, page } = await nouveauContexte("br");
    await entrerEnJeu(page, "br");
    await dormir(4000);
    await photo(page, "12-br-avion");
    console.log("capture 12");
    if (page.erreurs.length) console.log("erreurs BR :", page.erreurs.slice(0, 5));
    await ctx.close();
  }
} finally {
  if (MESURE && Object.keys(fluidite).length) writeFileSync(join(SORTIE, `${PREFIXE}-fluidite.json`), JSON.stringify(fluidite, null, 2) + "\n");
  await nav?.close().catch(() => null);
  arreter();
}
process.exit(0);
