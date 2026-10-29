#!/usr/bin/env node
/**
 * Captures et vérifications de l'aperçu par mode de la vue Palantir (issue #84, rendu logiciel) : lance `serveur-fps` et `next dev` sur des ports libres
 * (jamais 8787), ouvre la vue (code « myrtille ») puis le panneau « Arène » et déroule : cadrage d'arène + simulation, transition vers les zombies
 * (captures en cours de route), simulation d'une manche, Battle Royale (avion, parachutes, zone), retour à l'arène (décor et caméra identiques),
 * panneau fermé (vue inchangée), mouvement réduit (coupure franche). Le rendu logiciel est lent : les scripts avancent la simulation par
 * `window.__palantir.apercuAvancer` plutôt que d'attendre, et lisent la fin des transitions dans `apercu().transition`.
 * Usage : node scripts/fps/captures_apercus.mjs   (E2E_OUT = dossier des captures, défaut <tmp>/pdj-captures-apercus ; E2E_URL / E2E_WS réutilisent des serveurs lancés)
 * Sort avec le code 1 si une vérification échoue.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SORTIE = process.env.E2E_OUT ?? join(tmpdir(), "pdj-captures-apercus");
const PAGE = "/arene-e2e-introuvable";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const portLibre = () => new Promise((ok, ko) => { const s = createServer(); s.once("error", ko); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });
async function attendreHttp(url, ms) { const fin = Date.now() + ms; while (Date.now() < fin) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* */ } await dormir(500); } throw new Error(`injoignable : ${url}`); }
const enfants = [];
function lancer(cmd, args, opts) { const e = spawn(cmd, args, { ...opts, detached: true, stdio: ["ignore", "pipe", "pipe"] }); e.journal = []; const n = (b) => { e.journal.push(String(b)); if (e.journal.length > 300) e.journal.shift(); }; e.stdout.on("data", n); e.stderr.on("data", n); enfants.push(e); return e; }
const arreter = () => { for (const e of enfants) { try { process.kill(-e.pid, "SIGTERM"); } catch { /* */ } } };
const chargerPlaywright = () => { for (const b of [process.env.PLAYWRIGHT_DIR, RACINE, process.cwd()].filter(Boolean)) { try { return createRequire(join(b, "x.js"))("playwright"); } catch { /* */ } } return createRequire(import.meta.url)("playwright"); };

mkdirSync(SORTIE, { recursive: true });
const { chromium } = chargerPlaywright();
const echecs = [];
const verifier = (ok, nom, detail = "") => { console.log(`${ok ? "ok  " : "ÉCHEC"} ${nom}${detail ? ` — ${detail}` : ""}`); if (!ok) echecs.push(nom); };
let nav = null;
try {
  let urlWs = process.env.E2E_WS;
  if (!urlWs) {
    const port = await portLibre();
    urlWs = `ws://localhost:${port}`;
    const b = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: join(RACINE, "serveur-fps"), encoding: "utf8" });
    if (b.status !== 0) throw new Error(b.stdout + b.stderr);
    const srv = lancer(process.execPath, ["dist/index.js"], { cwd: join(RACINE, "serveur-fps"), env: { ...process.env, PORT: String(port), SCENE_JSON: join(RACINE, "public/agroparc/scene.json"), PDJ_FPS_BUS_MIN_MS: "3600000", PDJ_FPS_BUS_MAX_MS: "3600000" } });
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

  async function ouvrir(options = {}) {
    const ctx = await nav.newContext({ viewport: { width: 1280, height: 720 }, ...options });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 400)));
    // la page de départ est une 404 volontaire (aucune lecture de la base) : sa ressource introuvable n'est pas une erreur
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*404/.test(m.text())) erreurs.push(m.text().slice(0, 400)); });
    // un `next dev` à froid recharge la page pendant les premières compilations : on recommence jusqu'à ce que la vue soit prête
    for (let essai = 0; essai < 5; essai++) {
      try {
        await page.goto(`${urlNext}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 180000 });
        await dormir(4000);
        await page.keyboard.type("myrtille", { delay: 60 });
        await page.waitForFunction(() => !!window.__palantir?.apercu?.(), null, { timeout: 90000 });
        break;
      } catch (e) { console.log("essai", essai, e.message.split("\n")[0]); }
    }
    return { ctx, page, erreurs };
  }
  const apercu = (page) => page.evaluate(() => window.__palantir.apercu());
  const sansModele = (a) => (a ? { ...a, modele: undefined } : a);
  async function attendreFinTransition(page, max = 90000) {
    const fin = Date.now() + max;
    while (Date.now() < fin) { const a = await apercu(page); if (!a.transition.enCours && a.modeDecor === a.mode) return a; await dormir(250); }
    return apercu(page);
  }
  const ouvrirPanneau = async (page) => { const b = page.getByRole("button", { name: /^Arène/ }).first(); await b.waitFor({ state: "visible", timeout: 90000 }); await b.evaluate((e) => e.click()); };
  const choisir = async (page, nom) => { const r = page.getByRole("radio", { name: nom }); await r.waitFor({ timeout: 60000 }); await r.evaluate((e) => e.click()); };

  // ---------- 0. vue normale, panneau fermé : la référence ----------
  const { ctx, page, erreurs } = await ouvrir();
  await dormir(6000);
  // l'intro d'arrivée dure 3,2 s d'horloge de scène (plus sous un rendu logiciel lent) : on attend la position de repos (altitude 230 m = `REST`)
  await page.waitForFunction(() => Math.abs(window.__palantir.apercu().camera.pos[1] - 230) < 1.5, null, { timeout: 90000 }).catch(() => null);
  const ferme0 = await apercu(page);
  verifier(!ferme0.actif && ferme0.sim === 0 && ferme0.mode === "arene" && ferme0.modeDecor === "arene", "panneau fermé : aperçu inactif, aucun faux joueur, décor de l'arène", JSON.stringify(sansModele(ferme0)));
  // position de repos de l'arène (REST de scene.ts : dx −30, y 230, dz 380 autour du point visé)
  const REST = { pos: [ferme0.camera.cible[0] - 30, 230, ferme0.camera.cible[2] + 380] };
  await page.screenshot({ path: join(SORTIE, "00-vue-normale.png") });

  // ---------- 1. panneau ouvert : arène + simulation ----------
  await ouvrirPanneau(page);
  await page.waitForFunction(() => window.__palantir.apercu().actif, null, { timeout: 30000 });
  await page.evaluate(() => window.__palantir.apercuGraine(12345));
  await page.evaluate(() => window.__palantir.apercuAvancer(20));
  await dormir(3000);
  const arene = await apercu(page);
  verifier(arene.actif && arene.mode === "arene" && arene.source === "simulation", "arène : aperçu actif, source simulation", JSON.stringify(sansModele(arene)));
  verifier(arene.sim >= 4, "arène : au moins 4 repères de faux joueurs", `${arene.sim}`);
  const dRest = Math.hypot(...arene.camera.pos.map((v, i) => v - REST.pos[i]));
  verifier(dRest < 60, "arène : cadrage d'arène (REST, à l'intro et la rotation près)", `${dRest.toFixed(1)} m`);
  await page.screenshot({ path: join(SORTIE, "01-arene-simulation.png") });
  const bandeau = await page.locator("[role=status]").filter({ hasText: /Simulation/i }).first().innerText().catch(() => "");
  verifier(/match à mort/i.test(bandeau) && /fictif/i.test(bandeau), "bandeau « Simulation · Match à mort · agents fictifs »", bandeau.replace(/\n/g, " "));

  // ---------- 2. zombies : transition puis simulation ----------
  await choisir(page, /Zombies tigres/);
  const instants = [];
  const fin = Date.now() + 90000;
  let k0 = false, k5 = false;
  while (Date.now() < fin) {
    const a = await apercu(page);
    instants.push(+a.transition.k.toFixed(2));
    if (a.transition.enCours && !k0) { k0 = true; await page.screenshot({ path: join(SORTIE, "02-zombies-transition-debut.png") }); }
    if (a.transition.enCours && a.transition.k >= 0.45 && !k5) { k5 = true; await page.screenshot({ path: join(SORTIE, "03-zombies-transition-milieu.png") }); }
    if (!a.transition.enCours && a.mode === "zombies" && a.modeDecor === "zombies") break;
    await dormir(120);
  }
  const z0 = await attendreFinTransition(page);
  verifier(z0.mode === "zombies" && z0.modeDecor === "zombies" && z0.transition.duree >= 1.6 && z0.transition.duree <= 2.6, "zombies : transition de 1,6 à 2,6 s, décor échangé", `durée ${z0.transition.duree}`);
  verifier(z0.camera.pos[1] < 200 && z0.camera.cible[0] > 80 && z0.camera.cible[0] < 160, "zombies : cadrage sur le Pôle R&D", JSON.stringify(z0.camera));
  await page.evaluate(() => window.__palantir.apercuGraine(777));
  await page.evaluate(() => window.__palantir.apercuAvancer(8));
  await dormir(2500);
  await page.screenshot({ path: join(SORTIE, "04-zombies-debut.png") });
  await page.evaluate(() => window.__palantir.apercuAvancer(50));
  await dormir(2500);
  const z1 = await apercu(page);
  verifier(z1.source === "simulation" && z1.sim >= 1, "zombies : survivants simulés", `${z1.sim}`);
  verifier(z1.tigres > 0 || (z1.modele?.tigres ?? []).length === 0, "zombies : les tigres du modèle sont dessinés (instances)", `${z1.tigres}`);
  await page.screenshot({ path: join(SORTIE, "05-zombies-manche.png") });
  // une capture où une fenêtre est attaquée (jusqu'à 40 pas de 3 s simulées)
  let attaque = false;
  for (let i = 0; i < 40 && !attaque; i++) {
    await page.evaluate(() => window.__palantir.apercuAvancer(3));
    await dormir(400);
    const a = await apercu(page);
    attaque = (a.modele?.tigres ?? []).some((t) => t.mode === "fenetre");
  }
  await page.screenshot({ path: join(SORTIE, "06-zombies-fenetre-attaquee.png") });
  verifier(attaque, "zombies : un tigre arrache les planches d'une fenêtre", "");
  const bz = await page.locator("[role=status]").first().innerText().catch(() => "");
  verifier(/zombies tigres/i.test(bz) && /Simulation/i.test(bz), "bandeau « Simulation · Zombies tigres »", bz.replace(/\n/g, " "));

  // ---------- 3. Battle Royale ----------
  await choisir(page, /Battle Royale/);
  const br0 = await attendreFinTransition(page);
  verifier(br0.mode === "br" && br0.modeDecor === "br" && br0.camera.pos[1] > 400, "BR : plongée haute et large", JSON.stringify(br0.camera));
  await page.evaluate(() => window.__palantir.apercuGraine(4242));
  await page.evaluate(() => window.__palantir.apercuAvancer(6));
  await dormir(3000);
  await page.screenshot({ path: join(SORTIE, "07-br-avion.png") });
  await page.evaluate(() => window.__palantir.apercuAvancer(12));
  await dormir(3000);
  await page.screenshot({ path: join(SORTIE, "08-br-parachutes.png") });
  const br1 = await apercu(page);
  verifier((br1.modele?.joueurs ?? []).some((j) => j.chute), "BR : des joueurs en chute", "");
  await page.evaluate(() => window.__palantir.apercuAvancer(14));
  await dormir(2500);
  await page.screenshot({ path: join(SORTIE, "09-br-zone.png") });
  await page.evaluate(() => window.__palantir.apercuAvancer(12));
  await dormir(2500);
  await page.screenshot({ path: join(SORTIE, "10-br-zone-serree.png") });
  const br2 = await apercu(page);
  verifier(br2.modele?.vivants < br2.modele?.total, "BR : des éliminations", `${br2.modele?.vivants}/${br2.modele?.total}`);
  verifier(br2.joueurs <= 32 && br2.appelsDessin < 600, "BR : repères bornés, appels de dessin raisonnables", `${br2.joueurs} repères, ${br2.appelsDessin} appels de dessin`);
  // mesure : JS de l'aperçu par image (budget ≈ 1,2 ms sur un poste ; le rendu logiciel de ce test est bien plus lent, d'où un plafond large)
  await dormir(3000);
  const br3 = await apercu(page);
  verifier(br3.msApercu < 6, "BR : JS de l'aperçu par image", `${br3.msApercu} ms (${br3.joueurs} repères, ${br3.appelsDessin} appels de dessin)`);

  // ---------- 4. retour à l'arène : décor, POI et caméra de départ ----------
  await choisir(page, /Arène/);
  const ar2 = await attendreFinTransition(page);
  verifier(ar2.mode === "arene" && ar2.modeDecor === "arene", "retour à l'arène : décor de l'arène", JSON.stringify(sansModele(ar2)));
  const dRest2 = Math.hypot(ar2.camera.pos[0] - REST.pos[0], ar2.camera.pos[1] - REST.pos[1], ar2.camera.pos[2] - REST.pos[2]);
  verifier(dRest2 < 3, "retour à l'arène : caméra de repos (REST)", `${dRest2.toFixed(2)} m`);
  await dormir(1500);
  await page.screenshot({ path: join(SORTIE, "11-retour-arene.png") });
  const poi = await page.locator("[data-kind=resto]").first().isVisible().catch(() => false);
  verifier(poi, "retour à l'arène : les POI des restaurants sont de retour", "");

  // ---------- 5. panneau fermé : la vue normale ----------
  await ouvrirPanneau(page); // referme
  await dormir(2500);
  const ferme1 = await apercu(page);
  verifier(!ferme1.actif && ferme1.sim === 0 && ferme1.modeDecor === "arene", "panneau refermé : aperçu inactif, aucun faux joueur", JSON.stringify(sansModele(ferme1)));
  await page.screenshot({ path: join(SORTIE, "12-panneau-ferme.png") });
  verifier(erreurs.length === 0, "aucune erreur de console", erreurs.slice(0, 3).join(" | "));
  await ctx.close();

  // ---------- 6. mouvement réduit : coupure franche ----------
  const red = await ouvrir({ reducedMotion: "reduce" });
  await dormir(5000);
  await ouvrirPanneau(red.page);
  await red.page.waitForFunction(() => window.__palantir.apercu().actif, null, { timeout: 30000 });
  await choisir(red.page, /Zombies tigres/);
  await red.page.waitForFunction(() => window.__palantir.apercu().modeDecor === "zombies", null, { timeout: 60000 }).catch(() => null);
  const rz = await apercu(red.page);
  verifier(rz.modeDecor === "zombies" && rz.transition.duree === 0 && !rz.transition.enCours, "mouvement réduit : changement de mode sans arc", JSON.stringify(sansModele(rz)));
  await red.ctx.close();
} catch (e) {
  console.error("ERREUR", e);
  echecs.push(String(e.message ?? e));
} finally {
  try { await nav?.close(); } catch { /* */ }
  arreter();
}
console.log(echecs.length ? `\n${echecs.length} échec(s) : ${echecs.join(" ; ")}` : "\ntout est ok");
console.log(`captures : ${SORTIE}`);
process.exit(echecs.length ? 1 : 0);
