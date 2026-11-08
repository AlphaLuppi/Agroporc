#!/usr/bin/env node
/**
 * Bout en bout de Rocket Muche EN LIGNE : le vrai `serveur-fps` (construit, lancé sur un port libre, `PDJ_ROCKET_DEV=1`) et un `next dev` local,
 * DEUX Chromium headless (Alice et Bob) pilotés par `window.__rocket` / `window.__rocketReseau`. Spec : docs/superpowers/specs/2026-11-08-rocket-en-ligne-design.md
 * (§ 9.3 contrat DOM, § 10 plan de tests). L'autorité reste au serveur : le but et la fin de match sont déclenchés par le message `dev` (refusé sans
 * `PDJ_ROCKET_DEV=1`) que le serveur applique lui-même, jamais par une écriture dans le monde du client.
 *
 * Scénario (chaque étape imprime OK / ÉCHEC ; captures dans E2E_OUT, défaut docs/medias/rocket-en-ligne) :
 *  1. « myrtille » → Rocket Muche → radio « En ligne » (Alice et Bob), la liste « Parties ouvertes » s'affiche
 *  2. Alice crée la partie : code à 4 lettres ; Bob la voit dans la liste (« Rejoindre la partie ABCD ») puis la rejoint PAR LE CODE ; deux joueurs dans le salon
 *  3. Alice lance un 1v1 : chargement, `window.__rocket` chez les deux, décompte puis phase « enJeu » (HUD réseau présent : ping, état, commandes)
 *  4. Alice accélère (entrées scriptées), Bob voit la voiture d'Alice bouger (position serveur) ; l'état prédit d'Alice reste proche de l'autoritaire
 *  5. but forcé par `dev` côté serveur : événement « but », score identique chez les deux (monde, HUD, état autoritaire)
 *  6. fin de match (`dev` chrono) : écran de fin chez les deux, même score, même titre pour l'équipe gagnante
 *  7. revanche unanime : un nouveau `debut` (numéro suivant), nouveau décompte chez les deux
 *  8. réseau dégradé : latence artificielle de 60 ms par sens, jeu scripté pendant ~8 s, rollbacks/s et correction maximale mesurés ; rafale de 300 ms sans gel
 *  9. coupure de la socket d'Alice (`couper`) : reprise automatique, la partie continue (ticks avancent, même voiture)
 * 10. Bob quitte la partie (menu pause → « Quitter la partie ») : un bot reprend sa voiture, Alice continue ; Alice quitte
 * 11. aucune erreur JavaScript
 *
 * Usage : node scripts/rocket/e2e_rocket_en_ligne.mjs   (Node 22, Playwright : `npm i --no-save playwright`, ou PLAYWRIGHT_DIR)
 * Variables : E2E_OUT, E2E_URL + E2E_WS (site et serveur déjà lancés ; le site doit alors être construit avec NEXT_PUBLIC_ROCKET_WS_URL = E2E_WS),
 *   E2E_RENDU=1 (Alice dessine la scène 3D au lieu de `sansRendu` : captures du jeu, plus lent en rendu logiciel), E2E_HEADED=1, E2E_DEBUG=1,
 *   E2E_DUREE_S (durée forcée des matchs, défaut 90), E2E_LATENCE_MS (latence artificielle par sens, défaut 60).
 * Les captures sont écrites dans un dossier temporaire puis copiées à la fin : `next dev` surveille tout le dépôt et rechargerait la page à chaque fichier créé.
 * Code de sortie : 0 si tout passe, 1 sinon.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SORTIE = process.env.E2E_OUT ?? join(RACINE, "docs/medias/rocket-en-ligne");
const TAMPON = join(tmpdir(), `pdj-e2e-rocket-ligne-${process.pid}`);
const PAGE = process.env.E2E_PAGE ?? "/arene-e2e-introuvable"; // une 404 : aucune lecture de la base
const DUREE_S = process.env.E2E_DUREE_S ?? "90";
const LATENCE_MS = Number(process.env.E2E_LATENCE_MS ?? 60);
const RENDU = !!process.env.E2E_RENDU;

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
async function attendreHttp(url, ms, quoi) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* pas prêt */ } await dormir(400); }
  throw new Error(`${quoi} injoignable (${url}) après ${ms / 1000} s`);
}
async function jusqua(fn, { ms = 15_000, pas = 150, quoi = "condition" } = {}) {
  const fin = Date.now() + ms;
  let d;
  while (Date.now() < fin) { try { d = await fn(); if (d) return d; } catch (e) { d = e; } await dormir(pas); }
  throw new Error(`délai dépassé (${ms} ms) : ${quoi}${d instanceof Error ? ` — ${d.message}` : ""}`);
}

const enfants = [];
const erreurs = [];
const resultats = [];
const mesures = {};
let navigateur;
async function etape(nom, fn) {
  try { const r = await fn(); console.log(`OK     ${nom}`); resultats.push([nom, true]); return r; }
  catch (e) { console.log(`ÉCHEC  ${nom}\n         ${String(e.message).split("\n").join("\n         ")}`); resultats.push([nom, false]); return null; }
}
function lancer(nom, cmd, args, opts) {
  const e = spawn(cmd, args, { ...opts, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const journal = [];
  e.stdout.on("data", (b) => journal.push(b.toString()));
  e.stderr.on("data", (b) => journal.push(b.toString()));
  enfants.push(e);
  return { proc: e, journal, nom };
}
function arreter() { for (const e of enfants) { try { process.kill(-e.pid, "SIGTERM"); } catch { /* déjà parti */ } } }

// ---------------------------------------------------------------------------------------------------------------- pilotage
const NEUTRE = { accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false };
const etat = (p) => p.evaluate(() => window.__rocket.etat());
const stats = (p) => p.evaluate(() => window.__rocketReseau.stats());
const hudReseau = (p) => p.evaluate(() => window.__rocketReseau.hud());
const entrees = (p, e) => p.evaluate((e) => window.__rocketReseau.entrees(e), e);
const moi = (p) => p.evaluate(() => window.__rocketReseau.moi());
const autoritaire = (p) => p.evaluate(() => { const a = window.__rocketReseau.autoritaire(); return a ? { tick: a.tick ?? null, score: a.score ?? null, n: a.voitures?.length ?? 0 } : null; });
// une capture ne doit jamais faire échouer une étape (le rendu logiciel de la vue aérienne peut retarder une image de plusieurs secondes)
async function capture(page, nom) {
  try { await page.screenshot({ path: join(TAMPON, `${nom}.png`), timeout: 60_000 }); trace("capture", nom); }
  catch (e) { console.log(`       (capture ${nom} impossible : ${String(e.message).split("\n")[0]})`); }
}
const dialogue = (p) => p.locator("[role=dialog][aria-labelledby]");

/** Du code secret au lobby en ligne : ouvre la vue Palantir, le panneau « Rocket Muche », choisit « En ligne » et pose le nom. */
async function ouvrirEnLigne(page, url, nom) {
  const ouvert = () => page.evaluate(() => !!document.querySelector("aside[aria-label='Rocket Muche'], aside[aria-label='Rocket Muche en ligne']")).catch(() => false);
  for (let tour = 1; tour <= 6 && !(await ouvert()); tour++) {
    // un `next dev` à froid recharge la page à la première compilation d'un module (navigation interrompue) : on recommence
    if (!(await page.goto(`${url}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 120_000 }).then(() => true, () => false))) { await dormir(2000); continue; }
    await dormir(2500);
    await page.keyboard.type("myrtille", { delay: 60 });
    const bouton = page.getByRole("button", { name: /^Rocket Muche/ }).first();
    if (!(await bouton.waitFor({ state: "visible", timeout: 60_000 }).then(() => true, () => false))) continue;
    await bouton.evaluate((e) => e.click()).catch(() => null);
    await dormir(1500);
  }
  verifier(await ouvert(), `${nom} : le panneau « Rocket Muche » ne s'ouvre pas`);
  await page.getByRole("radio", { name: "En ligne" }).evaluate((e) => e.click());
  const lobby = page.locator("aside[aria-label='Rocket Muche en ligne']");
  await lobby.waitFor({ state: "visible", timeout: 90_000 });
  await jusqua(() => lobby.getByLabel("Nom de joueur").isVisible(), { ms: 90_000, quoi: `${nom} : connexion au serveur (champ « Nom de joueur »)` });
  await lobby.getByLabel("Nom de joueur").fill(nom);
  return lobby;
}

/** Une page de joueur : contexte propre (stockage local vide), pointeur verrouillé émulé, `sansRendu` sauf demande. */
async function nouveauJoueur(nom, rendu) {
  const ctx = await navigateur.newContext({ viewport: rendu ? { width: 1280, height: 720 } : { width: 800, height: 720 } });
  await ctx.addInitScript((sansRendu) => {
    try { localStorage.setItem("pdj-fps-aide-vue", "1"); if (sansRendu) localStorage.setItem("pdj-rocket-sans-rendu", "1"); } catch { /* stockage indisponible */ }
    // Latence réseau FIDÈLE (ping et pong compris, contrairement à `__rocketReseau.latence` qui ne retarde que le jeu) : la WebSocket du serveur Rocket est
    // enveloppée ; `window.__wsDelai = { sortant, entrant }` (ms) la règle, sans effet (appel direct) tant qu'il vaut 0. L'ordre d'arrivée est conservé (TCP).
    window.__wsDelai = { sortant: 0, entrant: 0 };
    const Natif = window.WebSocket;
    class WebSocketRetardee {
      constructor(url, proto) {
        this._s = proto === undefined ? new Natif(url) : new Natif(url, proto);
        this._derniereSortie = 0; this._derniereEntree = 0;
        if (!String(url).endsWith("/rocket")) return this._s;
      }
      _planifier(cle, ms, f) {
        const t = performance.now();
        const echeance = Math.max(t + ms, this[cle]);
        this[cle] = echeance;
        if (ms <= 0 && echeance <= t) f(); else setTimeout(f, Math.max(0, echeance - t));
      }
      get readyState() { return this._s.readyState; }
      get binaryType() { return this._s.binaryType; }
      set binaryType(v) { this._s.binaryType = v; }
      get bufferedAmount() { return this._s.bufferedAmount; }
      set onopen(f) { this._s.onopen = f; }
      get onopen() { return this._s.onopen; }
      set onerror(f) { this._s.onerror = f; }
      get onerror() { return this._s.onerror; }
      set onclose(f) { this._s.onclose = f; }
      get onclose() { return this._s.onclose; }
      set onmessage(f) {
        this._f = f;
        this._s.onmessage = f ? (e) => this._planifier("_derniereEntree", window.__wsDelai.entrant, () => this._f && this._f(e)) : null;
      }
      get onmessage() { return this._f ?? null; }
      send(d) { this._planifier("_derniereSortie", window.__wsDelai.sortant, () => { try { this._s.send(d); } catch { /* socket fermée */ } }); }
      close(c, r) { this._s.close(c, r); }
    }
    WebSocketRetardee.CONNECTING = 0; WebSocketRetardee.OPEN = 1; WebSocketRetardee.CLOSING = 2; WebSocketRetardee.CLOSED = 3;
    window.WebSocket = WebSocketRetardee;
    let verrou = null;
    Object.defineProperty(Document.prototype, "pointerLockElement", { get: () => verrou, configurable: true });
    Element.prototype.requestPointerLock = function () { verrou = this; queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange"))); return Promise.resolve(); };
    Document.prototype.exitPointerLock = function () { verrou = null; document.dispatchEvent(new Event("pointerlockchange")); };
  }, !rendu);
  const page = await ctx.newPage();
  page.on("crash", () => { erreurs.push(`${nom} crash: la page a planté`); trace(nom, "CRASH"); });
  page.on("pageerror", (e) => erreurs.push(`${nom} pageerror: ${e.message}`));
  page.on("console", (m) => { trace(nom, "console", m.type(), m.text().slice(0, 300)); if (m.type() === "error") erreurs.push(`${nom} console: ${m.text()}`); });
  return page;
}

async function main() {
  mkdirSync(TAMPON, { recursive: true });
  const { chromium } = chargerPlaywright();

  // --- serveur-fps (jamais 8787 : un onglet de développement ouvert s'y reconnecterait)
  let urlWs = process.env.E2E_WS;
  if (!urlWs) {
    const portWs = await portLibre();
    urlWs = `ws://localhost:${portWs}`;
    const build = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: join(RACINE, "serveur-fps"), encoding: "utf8" });
    if (build.status !== 0) throw new Error(`build de serveur-fps en échec :\n${build.stdout}${build.stderr}`);
    const srv = lancer("serveur-fps", process.execPath, ["dist/index.js"], {
      cwd: join(RACINE, "serveur-fps"),
      env: {
        ...process.env, PORT: String(portWs), SCENE_JSON: join(RACINE, "public/agroparc/scene.json"),
        PDJ_ROCKET_DEV: "1", PDJ_ROCKET_DUREE_S: DUREE_S, PDJ_ROCKET_REPRISE_MS: "15000", PDJ_ROCKET_REVANCHE_MS: "60000",
        // l'arène (hall ar1 de la vue Palantir) : rien ne doit y bouger pendant l'essai
        PDJ_FPS_POLICE: "off", PDJ_FPS_ZOMBIES_PATROUILLE: "off",
        PDJ_FPS_AVION_MIN_MS: "3600000", PDJ_FPS_AVION_MAX_MS: "3700000", PDJ_FPS_BUS_MIN_MS: "3600000", PDJ_FPS_BUS_MAX_MS: "3700000",
        PDJ_FPS_EVT_MIN_MS: "3600000", PDJ_FPS_EVT_MAX_MS: "3700000", PDJ_FPS_ELSA_MIN_MS: "3600000", PDJ_FPS_ELSA_MAX_MS: "3700000",
      },
    });
    await attendreHttp(`http://localhost:${portWs}/sante`, 30_000, "serveur-fps").catch((e) => { throw new Error(`${e.message}\n${srv.journal.join("")}`); });
  }

  // --- next dev (le client lit NEXT_PUBLIC_ROCKET_WS_URL au démarrage)
  let url = process.env.E2E_URL;
  if (!url) {
    const port = await portLibre();
    url = `http://localhost:${port}`;
    const nx = lancer("next", process.execPath, [join(RACINE, "node_modules/next/dist/bin/next"), "dev", "-p", String(port)], {
      cwd: RACINE, env: { ...process.env, NEXT_PUBLIC_ROCKET_WS_URL: urlWs, NEXT_PUBLIC_FPS_WS_URL: urlWs, NEXT_TELEMETRY_DISABLED: "1" },
    });
    await attendreHttp(`${url}${PAGE}`, 240_000, "next dev").catch((e) => { throw new Error(`${e.message}\n${nx.journal.join("").slice(-1500)}`); });
  }
  const sante = async () => (await fetch(`${urlWs.replace(/^ws/, "http")}/sante`).then((r) => r.json())).rocket;
  console.log(`Serveur ${urlWs} · site ${url}${PAGE} · captures ${SORTIE}${RENDU ? " · rendu 3D chez Alice" : " · sansRendu"}\n`);

  navigateur = await chromium.launch({
    headless: !process.env.E2E_HEADED,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  });
  // chauffe : `next dev` compile les modules de la vue, du lobby en ligne et du client à la première demande (et recharge alors la page)
  if (!process.env.E2E_URL) {
    const chauffe = await nouveauJoueur("Chauffe", false);
    await ouvrirEnLigne(chauffe, url, "Chauffe").catch((e) => trace("chauffe", e.message));
    await dormir(4000);
    await chauffe.context().close();
    erreurs.length = 0;
  }
  const alice = await nouveauJoueur("Alice", RENDU);
  const bob = await nouveauJoueur("Bob", false);

  let code = "";
  let lobbyA, lobbyB;

  await etape("1. « myrtille » → Rocket Muche → « En ligne » chez Alice et Bob, liste « Parties ouvertes »", async () => {
    // chauffe de `next dev` à froid (compilation des modules), puis les deux joueurs
    lobbyA = await ouvrirEnLigne(alice, url, "Alice");
    lobbyB = await ouvrirEnLigne(bob, url, "Bob");
    for (const l of [lobbyA, lobbyB]) {
      verifier(await l.getByRole("button", { name: "Créer une partie" }).isVisible(), "bouton « Créer une partie » absent");
      verifier(await l.getByLabel("Code de la partie").isVisible(), "champ « Code de la partie » absent");
      verifier(await l.getByRole("heading", { name: "Parties ouvertes" }).isVisible(), "liste « Parties ouvertes » absente");
    }
    await capture(alice, "01-lobby-en-ligne");
  });

  await etape("2. Alice crée la partie ; Bob la voit dans la liste puis la rejoint PAR LE CODE", async () => {
    await lobbyA.getByRole("button", { name: "Créer une partie" }).click();
    const codeEl = alice.locator("[data-rocket-code]").first();
    await codeEl.waitFor({ state: "visible", timeout: 20_000 });
    code = (await codeEl.innerText()).trim();
    verifier(/^[A-Z]{4}$/.test(code), `code de partie inattendu : « ${code} »`);
    await jusqua(() => alice.locator("[data-rocket-joueur]").count().then((n) => n === 1), { quoi: "Alice seule dans son salon" });
    // la liste de Bob (rafraîchie toutes les 3 s) porte une ligne « Rejoindre la partie ABCD »
    await bob.getByRole("button", { name: "Actualiser" }).click().catch(() => null);
    await jusqua(() => bob.getByRole("button", { name: `Rejoindre la partie ${code}`, exact: true }).isVisible(), { ms: 12_000, quoi: `la partie ${code} dans la liste de Bob` });
    await lobbyB.getByLabel("Code de la partie").fill(code.toLowerCase()); // majuscules forcées par le champ
    await lobbyB.getByRole("button", { name: "Rejoindre", exact: true }).click();
    await jusqua(async () => (await bob.locator("[data-rocket-joueur]").count()) === 2 && (await alice.locator("[data-rocket-joueur]").count()) === 2, { quoi: "deux joueurs dans le salon chez Alice et Bob" });
    const codeB = (await bob.locator("[data-rocket-code]").first().innerText()).trim();
    verifier(codeB === code, `Bob est dans la partie ${codeB}, pas ${code}`);
    await capture(alice, "02-salon");
  });

  await etape("3. Alice lance un 1v1 : chargement, décompte, « enJeu » ; HUD réseau présent", async () => {
    await alice.locator("aside").getByRole("radio", { name: "1v1" }).evaluate((e) => e.click());
    await alice.getByRole("button", { name: "Lancer la partie" }).click();
    for (const [nom, p] of [["Alice", alice], ["Bob", bob]]) {
      await jusqua(() => p.evaluate(() => !!window.__rocket && !!window.__rocketReseau), { ms: 60_000, quoi: `${nom} : window.__rocket / __rocketReseau (le jeu ne se monte pas)` });
    }
    const ea = await etat(alice);
    verifier(ea.voitures.length === 2, `1v1 : 2 voitures attendues, ${ea.voitures.length}`);
    verifier(["decompte", "enJeu"].includes(ea.phase), `phase attendue « decompte » (ou « enJeu »), obtenue ${ea.phase}`);
    await jusqua(async () => (await etat(alice)).phase === "enJeu" && (await etat(bob)).phase === "enJeu", { ms: 20_000, quoi: "phase « enJeu » chez les deux (fin du décompte)" });
    const h = await alice.locator("[data-rocket-reseau]").first().evaluate((e) => ({ ping: e.dataset.ping, etat: e.dataset.etat, commandes: e.dataset.commandes }));
    verifier(h.etat === "ouverte" && h.commandes === "actives", `HUD réseau inattendu : ${JSON.stringify(h)}`);
    const s = await stats(alice);
    verifier(s.snapsRecus > 10, `peu d'instantanés reçus (${s.snapsRecus})`);
    await capture(alice, "03-en-jeu");
  });

  let idA, idB;
  await etape("4. Alice accélère : Bob voit sa voiture bouger ; le prédit d'Alice reste proche de l'autoritaire", async () => {
    idA = await moi(alice); idB = await moi(bob);
    verifier(idA !== idB, `les deux joueurs ont la même voiture (${idA})`);
    const avant = (await etat(bob)).voitures[idA];
    await entrees(alice, { ...NEUTRE, accel: 1, boost: true });
    await dormir(2500);
    const apres = (await etat(bob)).voitures[idA];
    const d = Math.hypot(apres.p[0] - avant.p[0], apres.p[2] - avant.p[2]);
    verifier(d > 8, `la voiture d'Alice n'a bougé que de ${d.toFixed(1)} m chez Bob`);
    const chezA = (await etat(alice)).voitures[idA];
    const ecartAB = Math.hypot(chezA.p[0] - apres.p[0], chezA.p[2] - apres.p[2]);
    // Bob voit Alice avec son retard d'extrapolation : quelques mètres à 8 m/s+ sont normaux, pas des dizaines
    verifier(ecartAB < 25, `Alice et Bob voient la voiture d'Alice à ${ecartAB.toFixed(1)} m d'écart`);
    const s = await stats(alice);
    verifier(s.rollbacks > 0 || s.snapsExacts > 0, "aucun instantané exploité par le prédicteur d'Alice");
    await entrees(alice, null);
    trace("stats Alice", JSON.stringify(s));
  });

  let sensBut;
  await etape("5. but forcé côté serveur (`dev`) : événement « but », score identique chez les deux", async () => {
    const ea = await etat(alice);
    const equipeA = ea.voitures[idA].equipe;
    sensBut = equipeA === "bleue" ? 1 : -1; // les bleus attaquent la cage Z > 0
    // mets les voitures hors de portée de la balle pour que rien ne la dévie : on laisse le serveur seul juge (la balle est imposée AU serveur)
    await entrees(alice, { ...NEUTRE, accel: -1 });
    await alice.evaluate(([s]) => window.__rocketReseau.dev({ action: "balle", p: [0, 2, 44 * s], v: [0, 0, 32 * s] }), [sensBut]);
    const scoreEquipe = (e) => e.score[equipeA];
    await jusqua(async () => scoreEquipe(await etat(alice)) === 1 && scoreEquipe(await etat(bob)) === 1, { ms: 20_000, quoi: "score 1 chez Alice et Bob" });
    const [sa, sb] = [await etat(alice), await etat(bob)];
    verifier(JSON.stringify(sa.score) === JSON.stringify(sb.score), `scores différents : ${JSON.stringify(sa.score)} / ${JSON.stringify(sb.score)}`);
    const [ha, hb] = [await alice.evaluate(() => window.__rocket.hud()), await bob.evaluate(() => window.__rocket.hud())];
    verifier(JSON.stringify(ha.score) === JSON.stringify(hb.score) && ha.score[equipeA] === 1, `HUD : ${JSON.stringify(ha.score)} / ${JSON.stringify(hb.score)}`);
    const evs = await alice.evaluate(() => window.__rocket.evenements().map((e) => e.t));
    verifier(evs.includes("but"), `aucun événement « but » chez Alice : ${evs.slice(-8).join(",")}`);
    const evsB = await bob.evaluate(() => window.__rocket.evenements().map((e) => e.t));
    verifier(evsB.filter((t) => t === "but").length === 1, `Bob doit voir exactement un « but » (vu ${evsB.filter((t) => t === "but").length})`);
    verifier(evs.filter((t) => t === "but").length === 1, `Alice doit voir exactement un « but » (vu ${evs.filter((t) => t === "but").length})`);
    await capture(alice, "04-but");
    await entrees(alice, null);
  });

  await etape("6. fin de match (`dev` chrono) : écran de fin identique chez les deux", async () => {
    await jusqua(async () => (await etat(alice)).phase === "enJeu", { ms: 20_000, quoi: "remise en jeu après le but" });
    await alice.evaluate(() => window.__rocketReseau.dev({ action: "chrono", tempsRestant: 1 }));
    for (const [nom, p] of [["Alice", alice], ["Bob", bob]]) {
      await dialogue(p).waitFor({ state: "visible", timeout: 60_000 }).catch(() => { throw new Error(`${nom} : pas d'écran de fin`); });
    }
    const [ta, tb] = [await dialogue(alice).innerText(), await dialogue(bob).innerText()];
    verifier(/match terminé/i.test(ta) && /match terminé/i.test(tb), "écran de fin sans « Match terminé »");
    verifier(/victoire|défaite|égalité/i.test(ta) && /victoire|défaite|égalité/i.test(tb), "écran de fin sans résultat");
    verifier(/victoire/i.test(ta) !== /victoire/i.test(tb), `un seul des deux doit gagner : A=« ${ta.split("\n")[1]} » B=« ${tb.split("\n")[1]} »`);
    const score = (t) => (t.match(/\d+\s*\n?\s*-\s*\n?\s*\d+|\b\d+\b.*\b\d+\b/s) ?? [""])[0].replace(/\s+/g, " ");
    trace("fin", score(ta), "|", score(tb));
    await capture(alice, "05-fin");
  });

  await etape("7. revanche unanime : nouveau `debut`, nouveau décompte chez les deux", async () => {
    const numA = await alice.evaluate(() => window.__rocketReseau.stats().snapsRecus);
    await dialogue(alice).getByRole("button", { name: /^Revanche/ }).click();
    await jusqua(() => dialogue(alice).innerText().then((t) => /Revanche demandée|1\/2/.test(t)), { ms: 8_000, quoi: "le vote d'Alice affiché (« 1/2 »)" });
    await capture(alice, "06-revanche-1sur2");
    await dialogue(bob).getByRole("button", { name: /^Revanche/ }).click();
    await jusqua(async () => { const [a, b] = [await etat(alice), await etat(bob)]; return a.phase === "decompte" && b.phase === "decompte" && a.score.bleue === 0 && a.score.orange === 0; }, { ms: 40_000, quoi: "nouveau décompte à 0-0 chez les deux" });
    verifier((await dialogue(alice).count()) === 0 && (await dialogue(bob).count()) === 0, "l'écran de fin devrait être fermé");
    await jusqua(async () => (await etat(alice)).phase === "enJeu" && (await etat(bob)).phase === "enJeu", { ms: 20_000, quoi: "« enJeu » du second match" });
    verifier((await alice.evaluate(() => window.__rocketReseau.stats().snapsRecus)) !== numA, "compteur d'instantanés inchangé");
  });

  await etape(`8. réseau dégradé (${LATENCE_MS} ms par sens, soit ${2 * LATENCE_MS} ms d'aller-retour pour chacun) : jeu scripté ~8 s, rollbacks/s et correction mesurés ; rafale de 300 ms`, async () => {
    // Alice joue en scripté (consignes qui changent), Bob aussi : la prédiction doit absorber les entrées de l'autre
    for (const p of [alice, bob]) await p.evaluate((ms) => { window.__wsDelai.sortant = ms; window.__wsDelai.entrant = ms; }, LATENCE_MS);
    const s0 = await stats(alice);
    const t0 = Date.now();
    const consignes = [
      { accel: 1, direction: 0.6, boost: true }, { accel: 1, direction: -0.5, boost: false }, { accel: 1, direction: 0, saut: true },
      { accel: 1, direction: 1, derapage: true }, { accel: -1, direction: 0 }, { accel: 1, direction: -1, boost: true },
    ];
    for (let k = 0; Date.now() - t0 < 8000; k++) {
      await entrees(alice, { ...NEUTRE, ...consignes[k % consignes.length] });
      await entrees(bob, { ...NEUTRE, ...consignes[(k + 3) % consignes.length] });
      await dormir(450);
    }
    const s1 = await stats(alice);
    const dt = (Date.now() - t0) / 1000;
    const rollbacks = s1.rollbacks - s0.rollbacks;
    mesures.latence = {
      latenceParSensMs: LATENCE_MS, rttMs: Math.round(s1.rttMs), gigueMs: Math.round(s1.gigueMs), margeTicks: s1.margeTicks,
      rollbacksParS: +(rollbacks / dt).toFixed(1), profondeurMoyenne: +s1.profondeurMoyenne.toFixed(1), profondeurMax: s1.profondeurMax,
      ecartMaxM: +s1.ecartMaxM.toFixed(2), resyncs: s1.resyncs - s0.resyncs, dernierRollbackMs: +s1.dernierRollbackMs.toFixed(2), maxRollbackMs: +s1.maxRollbackMs.toFixed(2),
      avance: s1.avance,
    };
    console.log(`       mesures : ${JSON.stringify(mesures.latence)}`);
    verifier(s1.rttMs >= 2 * LATENCE_MS * 0.9, `RTT mesuré ${s1.rttMs.toFixed(0)} ms, inférieur à la latence artificielle ${2 * LATENCE_MS} ms`);
    // avec le rendu 3D logiciel (E2E_RENDU), une image dure des centaines de ms : le rattrapage dépasse la seconde, c'est le rendu et non le réseau
    verifier(RENDU || s1.profondeurMax < 120, `profondeur de rollback anormale (${s1.profondeurMax} ticks)`);
    // rafale : on retient 300 ms puis tout arrive d'un coup ; la boucle ne doit pas geler plus de quelques images
    await entrees(alice, { ...NEUTRE, accel: 1 });
    const avantTick = (await stats(alice)).tickLocal;
    await alice.evaluate(() => window.__rocketReseau.retenir(300));
    await dormir(1200);
    const apresTick = (await stats(alice)).tickLocal;
    verifier(apresTick - avantTick > 60, `le jeu a gelé pendant la rafale (${apresTick - avantTick} ticks en 1,2 s)`);
    await entrees(alice, null); await entrees(bob, null);
    for (const p of [alice, bob]) await p.evaluate(() => { window.__wsDelai.sortant = 0; window.__wsDelai.entrant = 0; });
    await dormir(1500);
  });

  await etape("9. coupure de la socket d'Alice : reprise automatique, la partie continue", async () => {
    const id = await moi(alice);
    const t = (await stats(alice)).tickLocal;
    await alice.evaluate(() => window.__rocketReseau.couper());
    await jusqua(async () => { const h = await hudReseau(alice).catch(() => null); return h && h.etat !== "ouverte"; }, { ms: 5_000, quoi: "l'état « reconnexion » après la coupure" }).catch(() => null);
    await jusqua(async () => { const h = await hudReseau(alice); return h.etat === "ouverte"; }, { ms: 20_000, quoi: "retour à l'état « ouverte »" });
    await jusqua(async () => (await stats(alice)).tickLocal > t + 120, { ms: 20_000, quoi: "les ticks d'Alice avancent après la reprise" });
    verifier((await moi(alice)) === id, "Alice n'a plus la même voiture après la reprise");
    const tailles = await sante();
    trace("sante rocket", JSON.stringify(tailles));
    // Bob la voit toujours dans la partie (non remplacée par un bot) : sa voiture est humaine
    const voitB = (await etat(bob)).voitures;
    verifier(voitB.filter((v) => v.humain).length >= 1, "plus aucune voiture humaine chez Bob");
  });

  await etape("10. Bob quitte la partie (menu pause) : un bot reprend sa voiture ; Alice continue puis quitte", async () => {
    await bob.keyboard.press("Escape");
    const dlg = dialogue(bob);
    await dlg.waitFor({ state: "visible", timeout: 10_000 });
    verifier(/Le jeu continue/i.test(await dlg.innerText()), "le menu pause en ligne doit dire que le jeu continue");
    await jusqua(async () => (await hudReseau(bob)).commandes === "menu", { ms: 5_000, quoi: "commandes neutres (« menu ») menu ouvert" }); // HUD réseau ≤ 5 Hz
    await capture(bob, "07-pause-en-ligne");
    await dlg.getByRole("button", { name: "Quitter la partie" }).evaluate((e) => e.click()); // la vue aérienne (WebGL logiciel) se recrée : pas de clic Playwright qui attend la page
    const t = (await stats(alice)).tickLocal;
    await jusqua(async () => (await stats(alice)).tickLocal > t + 100, { ms: 15_000, quoi: "la partie d'Alice continue" });
    const s = await sante();
    trace("sante après départ de Bob", JSON.stringify(s));
    // sa voiture est maintenant tenue par un bot : elle n'est plus marquée humaine côté Alice (ou reste jouée sans erreur)
    await alice.keyboard.press("Escape");
    const dlgA = dialogue(alice);
    await dlgA.waitFor({ state: "visible", timeout: 10_000 });
    await dlgA.getByRole("button", { name: "Quitter la partie" }).evaluate((e) => e.click());
    await jusqua(() => alice.evaluate(() => !window.__rocketReseau), { ms: 20_000, quoi: "Alice hors du jeu" });
  });

  await etape("11. aucune erreur JavaScript", async () => {
    const bruit = (e) => /favicon|Failed to load resource|net::ERR|api\/pdj|api\/carte|GPU stall|WebGL|ReadPixels|swiftshader/i.test(e);
    const vraies = erreurs.filter((e) => !bruit(e));
    verifier(vraies.length === 0, vraies.slice(0, 6).join("\n"));
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
    if (mesures.latence) console.log(`\nMesures (réseau dégradé) : ${JSON.stringify(mesures.latence)}`);
    console.log(`\n${resultats.length - ko}/${resultats.length} étapes vertes`);
    process.exit(ko ? 1 : 0);
  });
