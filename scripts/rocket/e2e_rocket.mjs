#!/usr/bin/env node
/**
 * Bout en bout de Rocket Muche (mode local de la vue Palantir) : UN Chromium headless contre un `next dev` local, piloté par `window.__rocket`
 * (aucun serveur-fps : le mode se joue dans le navigateur). Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md.
 *
 * Scénario (chaque étape imprime OK / ÉCHEC ; captures 1280×720 dans E2E_OUT, défaut docs/medias/rocket) :
 *  1. code « myrtille », bouton « Rocket Muche », lobby, 1v1 contre un Débutant, « Lancer » : le jeu se monte, `window.__rocket` existe, décompte
 *  2. coup d'envoi : fin du décompte, phase « enJeu » (capture « 01-coup-d-envoi » pendant le décompte)
 *  3. conduite : la voiture accélère, le boost se vide, le saut décolle (capture « 02-en-jeu »)
 *  3b. vrai clavier et vraie souris (focus sur la racine role=dialog de la vue), sans surcharge `entrees`
 *  4. la balle bouge (vitesse imposée, gravité, rebond)
 *  5. but forcé : la balle lancée dans la cage adverse incrémente le score, événement `but`, phase « but » (capture « 03-but »)
 *  6. Échap : pause (menu modal), Reprendre (capture « 04-pause »)
 *  6b. liaisons : menu pause → Réglages, une touche du clavier réaffectée (B au boost), conflit signalé, Échap annule la capture SANS reprendre la partie,
 *      pas de manette → message, fausse manette (Gamepad API simulée) : bouton affecté au saut, Start refusé pour une autre action sans fermer la pause,
 *      réglages mémorisés, « Rétablir… », Reprendre
 *  7. fin de match : chrono à 0, écran de fin avec victoire (capture « 05-fin »), « Quitter » : retour à la vue aérienne, panneau rouvert (capture « 06-aerien »)
 *  8. seconde partie : Échap puis « Quitter vers Agroparc » ; `window.__rocket` retiré
 *  9. aucune erreur JavaScript
 *
 * Usage : node scripts/rocket/e2e_rocket.mjs   (Playwright : `npm i --no-save playwright`, ou PLAYWRIGHT_DIR=/dossier/avec/node_modules)
 * Variables : E2E_OUT, E2E_URL (Next déjà lancé), E2E_PAGE (page qui monte « myrtille », défaut une 404 : aucune lecture de la base), E2E_HEADED=1, E2E_DEBUG=1.
 * Le rendu logiciel (SwiftShader) est lent : le script gèle la boucle (`geler(true)`) et fait avancer le monde par `avancer(n)` (déterministe).
 * Ne jamais modifier un fichier du projet pendant qu'un `next dev` tourne : la page se recharge en boucle. Code de sortie : 0 si tout passe, 1 sinon.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SORTIE = process.env.E2E_OUT ?? join(RACINE, "docs/medias/rocket");
// Les captures sont écrites hors du dépôt pendant le scénario puis copiées à la fin : `next dev` surveille tout le projet et rechargerait la page
// (Fast Refresh) à chaque fichier créé sous le dépôt.
const TAMPON = join(tmpdir(), `pdj-e2e-rocket-${process.pid}`);
const PAGE = process.env.E2E_PAGE ?? "/arene-e2e-introuvable";
const HZ = 120;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const trace = (...a) => { if (process.env.E2E_DEBUG) console.log(`    [${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a); };
function verifier(cond, msg) { if (!cond) throw new Error(msg); }
const portLibre = () => new Promise((ok, ko) => { const s = createServer(); s.once("error", ko); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });

function chargerPlaywright() {
  for (const base of [process.env.PLAYWRIGHT_DIR, RACINE, process.cwd()].filter(Boolean)) {
    try { return createRequire(join(base, "x.js"))("playwright"); } catch { /* suivant */ }
  }
  throw new Error("Playwright introuvable : `npm i --no-save playwright` (navigateurs : `npx playwright install chromium`) ou PLAYWRIGHT_DIR");
}
async function attendreHttp(url, ms) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* pas prêt */ } await dormir(400); }
  throw new Error(`site injoignable (${url}) après ${ms / 1000} s`);
}
async function jusqua(fn, { ms = 15_000, pas = 150, quoi = "condition" } = {}) {
  const fin = Date.now() + ms;
  let d;
  while (Date.now() < fin) { try { d = await fn(); if (d) return d; } catch (e) { d = e; } await dormir(pas); }
  throw new Error(`délai dépassé (${ms} ms) : ${quoi}${d instanceof Error ? ` — ${d.message}` : ""}`);
}

let enfant = null;
const erreurs = [];
let resultats = [];
let navigateur;
async function etape(nom, fn) {
  try { const r = await fn(); console.log(`OK     ${nom}`); resultats.push([nom, true]); return r; }
  catch (e) { console.log(`ÉCHEC  ${nom}\n         ${String(e.message).split("\n").join("\n         ")}`); resultats.push([nom, false]); return null; }
}
function arreter() { if (enfant) { try { process.kill(-enfant.pid, "SIGTERM"); } catch { /* déjà parti */ } } }

// ---------------------------------------------------------------------------------------------------------------- pilotage
const etat = (page) => page.evaluate(() => window.__rocket.etat());
const avancer = (page, n) => page.evaluate((n) => window.__rocket.avancer(n).map((e) => ({ ...e })), n);
const hud = (page) => page.evaluate(() => window.__rocket.hud());
async function capture(page, nom) { await page.screenshot({ path: join(TAMPON, `${nom}.png`) }); trace("capture", nom); }

/** Du code secret au jeu monté : ouvre la vue Palantir, le panneau « Rocket Muche », règle 1v1 / Débutant / 3 min et lance. */
async function lancerPartie(page, url) {
  const ouvert = () => page.evaluate(() => !!document.querySelector("aside[aria-label='Rocket Muche']")).catch(() => false);
  for (let tour = 1; tour <= 6 && !(await ouvert()); tour++) {
    await page.goto(`${url}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await dormir(2500);
    await page.keyboard.type("myrtille", { delay: 60 });
    const bouton = page.getByRole("button", { name: /^Rocket Muche/ }).first();
    if (!(await bouton.waitFor({ state: "visible", timeout: 60_000 }).then(() => true, () => false))) continue;
    await bouton.evaluate((e) => e.click()).catch(() => null);
    await dormir(1500);
  }
  verifier(await ouvert(), "le panneau « Rocket Muche » ne s'ouvre pas");
  const lobby = page.locator("aside[aria-label='Rocket Muche']");
  await page.getByLabel("Nom de joueur").fill("Alice");
  await lobby.getByRole("radio", { name: "1v1" }).evaluate((e) => e.click());
  await lobby.getByRole("group", { name: /adversaire/i }).getByRole("radio", { name: "Débutant" }).evaluate((e) => e.click());
  await lobby.getByRole("radio", { name: /^3 min/ }).evaluate((e) => e.click());
  await lobby.getByRole("button", { name: /^Lancer/ }).click();
  await jusqua(() => page.evaluate(() => !!window.__rocket), { ms: 60_000, quoi: "window.__rocket (le jeu ne se monte pas)" });
  await page.evaluate(() => window.__rocket.geler(true));
}

async function main() {
  mkdirSync(TAMPON, { recursive: true });
  const { chromium } = chargerPlaywright();
  let url = process.env.E2E_URL;
  if (!url) {
    const port = await portLibre();
    url = `http://localhost:${port}`;
    enfant = spawn(process.execPath, [join(RACINE, "node_modules/next/dist/bin/next"), "dev", "-p", String(port)], {
      cwd: RACINE, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const journal = [];
    enfant.stdout.on("data", (b) => journal.push(b.toString()));
    enfant.stderr.on("data", (b) => journal.push(b.toString()));
    await attendreHttp(`${url}${PAGE}`, 240_000).catch((e) => { throw new Error(`${e.message}\n${journal.join("").slice(-1500)}`); });
  }
  console.log(`Site ${url}${PAGE} · captures ${SORTIE}\n`);

  navigateur = await chromium.launch({
    headless: !process.env.E2E_HEADED,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await navigateur.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("pdj-fps-aide-vue", "1"); } catch { /* stockage indisponible */ }
    // fausse manette pilotable (étape 6b) : désactivée par défaut, `navigator.getGamepads()` rend alors la liste du navigateur
    window.__fauxPad = { actif: false, axes: [0, 0, 0, 0], boutons: new Array(17).fill(0) };
    const vraies = typeof navigator.getGamepads === "function" ? navigator.getGamepads.bind(navigator) : () => [];
    navigator.getGamepads = () => {
      const f = window.__fauxPad;
      if (!f.actif) return vraies();
      return [{ id: "faux", index: 0, connected: true, mapping: "standard", timestamp: performance.now(), axes: f.axes.slice(), buttons: f.boutons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })) }];
    };
    let verrou = null;
    Object.defineProperty(Document.prototype, "pointerLockElement", { get: () => verrou, configurable: true });
    Element.prototype.requestPointerLock = function () { verrou = this; queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange"))); return Promise.resolve(); };
    Document.prototype.exitPointerLock = function () { verrou = null; document.dispatchEvent(new Event("pointerlockchange")); };
  });
  const page = await ctx.newPage();
  page.on("crash", () => { erreurs.push("crash: la page a planté"); trace("CRASH"); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) trace("navigation", f.url()); });
  page.on("pageerror", (e) => erreurs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { trace("console", m.type(), m.text().slice(0, 300)); if (m.type() === "error") erreurs.push(`console: ${m.text()}`); });

  await etape("1. « myrtille », panneau « Rocket Muche », 1v1 contre un Débutant, Lancer : le jeu se monte en décompte", async () => {
    await lancerPartie(page, url);
    const e = await etat(page);
    verifier(e.phase === "decompte", `phase attendue « decompte », obtenue ${e.phase}`);
    verifier(e.voitures.length === 2, `1v1 : 2 voitures attendues, ${e.voitures.length}`);
    verifier(await page.evaluate(() => !!document.querySelector("canvas")), "pas de canvas");
    await avancer(page, 60);
    await capture(page, "01-coup-d-envoi");
  });

  await etape("2. le décompte finit, phase « enJeu », voitures et balle au coup d'envoi", async () => {
    const evs = await avancer(page, HZ * 4);
    const e = await etat(page);
    verifier(e.phase === "enJeu", `phase attendue « enJeu », obtenue ${e.phase} (t=${e.tempsPhase})`);
    verifier(evs.some((x) => x.t === "coupDEnvoi" || x.t === "decompte"), `aucun événement de décompte / coup d'envoi : ${JSON.stringify(evs.slice(0, 5))}`);
  });

  await etape("3. conduite : la voiture accélère, le boost se vide, le saut décolle", async () => {
    await page.evaluate(() => { window.__rocket.balle([0, 1, 0], [0, 0, 0]); });
    const e0 = await etat(page);
    const moi = e0.idHumain;
    await page.evaluate(() => window.__rocket.entrees(0, { accel: 1, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: true, derapage: false }));
    // le slot 0 est la voiture humaine seulement si idHumain vaut 0 : on surcharge la bonne
    if (moi !== 0) await page.evaluate((i) => { window.__rocket.entrees(0, null); window.__rocket.entrees(i, { accel: 1, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: true, derapage: false }); }, moi);
    await avancer(page, HZ);
    const e1 = await etat(page);
    const v0 = e0.voitures[moi], v1 = e1.voitures[moi];
    const vit = Math.hypot(...v1.v);
    verifier(vit > 12, `la voiture devrait dépasser 12 m/s après 1 s de gaz + boost, vitesse ${vit.toFixed(1)}`);
    verifier(v1.boost < v0.boost - 5, `le boost devrait baisser (${v0.boost} → ${v1.boost})`);
    await page.evaluate((i) => window.__rocket.entrees(i, { accel: 1, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: true, boost: false, derapage: false }), moi);
    await avancer(page, 30);
    const e2 = await etat(page);
    verifier(e2.voitures[moi].p[1] > v1.p[1] + 0.3, `le saut devrait décoller (y ${v1.p[1].toFixed(2)} → ${e2.voitures[moi].p[1].toFixed(2)})`);
    verifier(!e2.voitures[moi].auSol, "en l'air après le saut");
    await capture(page, "02-en-jeu");
    await page.evaluate((i) => window.__rocket.entrees(i, null), moi);
  });

  // Régression : la racine de la vue Palantir est un role=dialog ; ni le vrai clavier ni la vraie souris ne doivent y être ignorés
  // (le focus est sur cette racine après le lancement). Aucune surcharge `entrees` ici : touches et clic réels de Playwright.
  await etape("3b. vrai clavier (W) et vraie souris (clic gauche = boost) : la voiture avance et le boost se vide", async () => {
    await page.evaluate(() => { window.__rocket.entrees(0, null); window.__rocket.entrees(1, null); window.__rocket.balle([0, 1, 0], [0, 0, 0]); });
    const moi = (await etat(page)).idHumain;
    await page.evaluate((i) => { window.__rocket.monde().voitures[i].boost = 80; }, moi); // l'étape 3 a vidé le réservoir
    const avant = (await etat(page)).voitures[moi];
    await page.keyboard.down("KeyW");
    await dormir(500);
    await avancer(page, HZ);
    const milieu = (await etat(page)).voitures[moi];
    verifier(Math.hypot(...milieu.v) > 5, `W (vrai clavier) devrait accélérer, vitesse ${Math.hypot(...milieu.v).toFixed(2)} m/s, focus : ${await page.evaluate(() => document.activeElement?.tagName)}`);
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await dormir(500);
    await avancer(page, HZ / 2);
    await page.mouse.up();
    await page.keyboard.up("KeyW");
    const fin = (await etat(page)).voitures[moi];
    verifier(fin.boost < Math.min(avant.boost, milieu.boost) - 3, `le clic gauche réel devrait brûler du boost (${milieu.boost} -> ${fin.boost})`);
    await dormir(300);
  });

  await etape("4. la balle bouge : vitesse imposée, gravité, rebond sur le sol", async () => {
    await page.evaluate(() => window.__rocket.balle([0, 6, 10], [8, 0, 0]));
    const a = await etat(page);
    await avancer(page, HZ);
    const b = await etat(page);
    verifier(b.balle.p[0] > a.balle.p[0] + 5, `la balle devrait avancer en x (${a.balle.p[0]} → ${b.balle.p[0].toFixed(2)})`);
    verifier(b.balle.p[1] < a.balle.p[1], `la gravité devrait faire descendre la balle (${a.balle.p[1]} → ${b.balle.p[1].toFixed(2)})`);
    await avancer(page, HZ * 3);
    const c = await etat(page);
    verifier(c.balle.p[1] > 0.8 && c.balle.p[1] < 12, `la balle reste dans le stade (y=${c.balle.p[1].toFixed(2)})`);
  });

  let ptsAvant;
  await etape("5. but forcé : la balle tirée dans la cage adverse marque, événement « but », phase « but »", async () => {
    const e = await etat(page);
    const moi = e.voitures[e.idHumain];
    const sens = moi.equipe === "bleue" ? 1 : -1; // les bleus attaquent la cage Z > 0 (celle des oranges)
    ptsAvant = e.score[moi.equipe];
    // la voiture humaine est mise hors de portée, la voiture du bot aussi ; la balle part droit vers le fond
    await page.evaluate(([s]) => {
      for (let i = 0; i < window.__rocket.monde().voitures.length; i++) window.__rocket.teleporter(i, [i === 0 ? -30 : 30, 0.4, 0], 0);
      window.__rocket.balle([0, 2, 44 * s], [0, 0, 32 * s]);
    }, [sens]);
    let evs = [];
    for (let i = 0; i < 6 && !evs.some((x) => x.t === "but"); i++) evs = evs.concat(await avancer(page, HZ / 2));
    verifier(evs.some((x) => x.t === "but"), `aucun événement « but » : ${JSON.stringify(evs.map((x) => x.t))}`);
    const f = await etat(page);
    verifier(f.score[moi.equipe] === ptsAvant + 1, `score attendu ${ptsAvant + 1}, obtenu ${f.score[moi.equipe]}`);
    verifier(f.phase === "but", `phase attendue « but », obtenue ${f.phase}`);
    await avancer(page, HZ);
    const h = await hud(page);
    verifier(h && h.score[moi.equipe] === ptsAvant + 1, "le HUD doit afficher le nouveau score");
    await capture(page, "03-but");
  });

  await etape("6. Échap : pause (menu modal), puis Reprendre", async () => {
    await page.evaluate(() => window.__rocket.geler(false)); // la pause se pose avec la boucle réelle
    await page.keyboard.press("Escape");
    await jusqua(() => page.evaluate(() => window.__rocket.hud()?.enPause === true), { quoi: "hud.enPause après Échap" });
    const dlg = page.locator("[role=dialog][aria-labelledby]");
    await dlg.waitFor({ state: "visible", timeout: 10_000 });
    await capture(page, "04-pause");
    await dlg.getByRole("button", { name: /^Reprendre/ }).click();
    await jusqua(() => page.evaluate(() => window.__rocket.hud()?.enPause === false), { quoi: "reprise" });
    await page.evaluate(() => window.__rocket.geler(true));
  });

  await etape("6b. liaisons : touche réaffectée, conflit, Échap annule sans reprendre, manette (simulée), Start protégé, réglages mémorisés", async () => {
    const hudPause = () => page.evaluate(() => window.__rocket.hud()?.enPause === true);
    await page.evaluate(() => window.__rocket.geler(false)); // la pause se pose avec la boucle réelle
    await page.keyboard.press("Escape");
    await jusqua(hudPause, { quoi: "pause avant les liaisons" });
    const dlg = page.locator("[role=dialog][aria-labelledby]");
    await dlg.getByRole("button", { name: "Réglages", exact: true }).click();
    const statut = dlg.locator("p[role=status]");
    const clavier = dlg.getByRole("group", { name: "Acrobaties" });
    const divers = dlg.getByRole("group", { name: "Divers", exact: true });
    const pad = dlg.getByRole("group", { name: "Manette : En l'air" });
    // 1. B au boost (emplacement 1)
    await clavier.getByRole("button", { name: /^Boost \(maintenu\), entrée 1/ }).click();
    await jusqua(() => clavier.getByRole("button", { name: /^Boost \(maintenu\), entrée 1/ }).getAttribute("aria-pressed").then((v) => v === "true"), { quoi: "capture ouverte" });
    verifier(/Appuie sur une touche/.test(await statut.innerText()), `zone d'état : ${await statut.innerText()}`);
    await dormir(300); // les écouteurs de la capture sont posés après le rendu
    await page.keyboard.press("KeyB");
    await jusqua(() => clavier.getByRole("button", { name: /^Boost \(maintenu\), entrée 1 : B\./ }).isVisible(), { quoi: "B affecté au boost" })
      .catch(async (e) => { await capture(page, "04b-echec"); throw new Error(`${e.message}\nétat : ${await statut.innerText()}\nboost : ${await clavier.getByRole("button", { name: /^Boost/ }).evaluateAll((l) => l.map((b) => b.getAttribute("aria-label")).join(" | "))}`); });
    verifier(await hudPause(), "la partie doit rester en pause pendant la capture");
    // 2. conflit : Q (roulis à gauche) donné au boost
    await clavier.getByRole("button", { name: /^Boost \(maintenu\), entrée 2/ }).click();
    await dormir(300);
    await page.keyboard.press("KeyQ");
    await jusqua(async () => /retirée de « Roulis à gauche »/.test(await statut.innerText()), { quoi: "conflit signalé" });
    // 3. Échap annule la capture, ne reprend pas la partie, ne ferme pas les réglages
    await divers.getByRole("button", { name: /^Klaxon, entrée 1/ }).click();
    await jusqua(() => divers.getByRole("button", { name: /^Klaxon, entrée 1/ }).getAttribute("aria-pressed").then((v) => v === "true"), { quoi: "capture du klaxon" });
    await dormir(300);
    await page.keyboard.press("Escape");
    await dormir(600);
    verifier(await hudPause(), "Échap pendant la capture ne doit pas reprendre la partie");
    verifier(await dlg.getByRole("heading", { name: "Réglages" }).isVisible(), "Échap pendant la capture ne doit pas quitter les réglages");
    verifier((await divers.getByRole("button", { name: /^Klaxon, entrée 1/ }).getAttribute("aria-pressed")) === "false", "la capture doit être fermée");
    // 4. pas de manette : message clair
    await pad.getByRole("button", { name: /^Sauter, double saut, flip, entrée 1/ }).click();
    await jusqua(async () => /Aucune manette détectée/.test(await statut.innerText()), { quoi: "message sans manette" });
    // 5. fausse manette : RB affecté au saut ; le bouton qui ouvre la capture (A tenu) est ignoré
    await page.evaluate(() => { window.__fauxPad.actif = true; window.__fauxPad.boutons[0] = 1; });
    await pad.getByRole("button", { name: /^Sauter, double saut, flip, entrée 1/ }).click();
    await jusqua(() => pad.getByRole("button", { name: /^Sauter, double saut, flip, entrée 1/ }).getAttribute("aria-pressed").then((v) => v === "true"), { quoi: "capture manette" });
    await dormir(400);
    verifier(/Appuie sur un bouton ou pousse un stick/.test(await statut.innerText()), "invite de capture de la manette");
    verifier((await pad.getByRole("button", { name: /^Sauter, double saut, flip, entrée 1/ }).getAttribute("aria-pressed")) === "true", "A tenu à l'ouverture ne doit pas être pris");
    await page.evaluate(() => { window.__fauxPad.boutons[5] = 1; });
    await jusqua(() => pad.getByRole("button", { name: /^Sauter, double saut, flip, entrée 1 : RB\./ }).isVisible(), { quoi: "RB affecté au saut" });
    await page.evaluate(() => { window.__fauxPad.boutons[5] = 0; window.__fauxPad.boutons[0] = 0; });
    // 6. Start pour une autre action : refusé, la pause reste ouverte
    await pad.getByRole("button", { name: /^Nez en haut \(en l'air\), entrée 1/ }).click();
    await dormir(300);
    await page.evaluate(() => { window.__fauxPad.boutons[9] = 1; });
    await jusqua(async () => /Start est réservé à la pause/.test(await statut.innerText()), { quoi: "Start refusé" });
    await dormir(500);
    verifier(await hudPause(), "Start pressé pendant la capture ne doit pas fermer la pause");
    await page.evaluate(() => { window.__fauxPad.boutons[9] = 0; });
    await dormir(600);
    verifier(await hudPause(), "Start relâché après la capture ne doit pas fermer la pause");
    // 7. mémorisation
    const stocke = await page.evaluate(() => JSON.parse(localStorage.getItem("pdj-rocket-reglages") ?? "null"));
    verifier(stocke?.touches?.boost?.[0] === "KeyB" && !stocke.touches.rouleGauche.includes("KeyQ"), `touches mémorisées : ${JSON.stringify(stocke?.touches)}`);
    verifier(JSON.stringify(stocke?.liaisonsManette?.saut) === '["B5"]' && stocke.liaisonsManette.pause[0] === "B9", `manette mémorisée : ${JSON.stringify(stocke?.liaisonsManette)}`);
    await capture(page, "04b-liaisons");
    // 8. rétablir
    await dlg.getByRole("button", { name: "Rétablir les touches par défaut" }).click();
    await dlg.getByRole("button", { name: "Rétablir la manette par défaut" }).click();
    await jusqua(() => clavier.getByRole("button", { name: /^Boost \(maintenu\), entrée 1 : Maj gauche\./ }).isVisible(), { quoi: "touches par défaut" });
    await jusqua(() => pad.getByRole("button", { name: /^Sauter, double saut, flip, entrée 1 : A\./ }).isVisible(), { quoi: "manette par défaut" });
    await page.evaluate(() => { window.__fauxPad.actif = false; });
    await dlg.getByRole("button", { name: "Retour", exact: true }).click();
    await dlg.getByRole("button", { name: /^Reprendre/ }).click();
    await jusqua(() => page.evaluate(() => window.__rocket.hud()?.enPause === false), { quoi: "reprise" });
    await page.evaluate(() => window.__rocket.geler(true));
  });

  await etape("7. fin de match : écran de victoire, « Quitter » : retour à la vue aérienne", async () => {
    await page.evaluate(() => {
      const m = window.__rocket.monde();
      m.balle.p[1] = 1; m.balle.p[0] = 0; m.balle.p[2] = 0; m.balle.v[0] = m.balle.v[1] = m.balle.v[2] = 0;
      for (let i = 0; i < m.voitures.length; i++) window.__rocket.teleporter(i, [i === 0 ? -30 : 30, 0.4, 10], 0);
      m.tempsRestant = 0.3;
    });
    for (let i = 0; i < 40; i++) { await avancer(page, HZ); const e = await etat(page); if (e.phase === "fini") break; }
    verifier((await etat(page)).phase === "fini", "le match devrait être fini");
    await avancer(page, HZ * 4); // la caméra de célébration tourne 2,5 s avant l'écran de fin
    await page.evaluate(() => window.__rocket.geler(false));
    const fin = page.locator("[role=dialog][aria-labelledby]");
    await fin.waitFor({ state: "visible", timeout: 20_000 });
    verifier(/victoire|défaite|égalité/i.test(await fin.innerText()), "écran de fin sans résultat");
    await capture(page, "05-fin");
    await fin.getByRole("button", { name: /^Quitter/ }).first().click();
    await jusqua(() => page.evaluate(() => !window.__rocket && !!document.querySelector("aside[aria-label='Rocket Muche']")), { ms: 30_000, quoi: "retour au panneau Rocket Muche sans partie" });
    await dormir(2500); // la vue aérienne est recréée
    await capture(page, "06-aerien");
  });

  await etape("8. seconde partie : Échap puis « Quitter vers Agroparc » libère le jeu", async () => {
    await lancerPartie(page, url);
    await page.evaluate(() => window.__rocket.geler(false));
    await page.keyboard.press("Escape");
    await jusqua(() => page.evaluate(() => window.__rocket.hud()?.enPause === true), { quoi: "pause" });
    await page.locator("[role=dialog][aria-labelledby]").getByRole("button", { name: /Quitter vers Agroparc/ }).click();
    await jusqua(() => page.evaluate(() => !window.__rocket), { ms: 15_000, quoi: "window.__rocket retiré" });
  });

  await etape("9. aucune erreur JavaScript", async () => {
    const bruit = (e) => /favicon|Failed to load resource|net::ERR|api\/pdj|api\/carte|GPU stall|WebGL|ReadPixels|swiftshader|fps\.toam|WebSocket/i.test(e);
    const vraies = erreurs.filter((e) => !bruit(e));
    verifier(vraies.length === 0, vraies.slice(0, 5).join("\n"));
  });
}

main()
  .catch((e) => { console.log(`ÉCHEC  (fatal) ${e.stack ?? e}`); resultats.push(["fatal", false]); })
  .finally(async () => {
    try { await navigateur?.close(); } catch { /* fermé */ }
    arreter();
    try {
      mkdirSync(SORTIE, { recursive: true });
      for (const f of readdirSync(TAMPON)) copyFileSync(join(TAMPON, f), join(SORTIE, f));
    } catch { /* pas de capture */ }
    const ko = resultats.filter(([, ok]) => !ok).length;
    console.log(`\n${resultats.length - ko}/${resultats.length} étapes vertes`);
    process.exit(ko ? 1 : 0);
  });
