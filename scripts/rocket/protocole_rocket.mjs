#!/usr/bin/env node
/**
 * Rocket Muche en ligne : vérification AU NIVEAU DU PROTOCOLE contre le vrai `serveur-fps` (construit puis lancé sur des ports libres), sans
 * navigateur. Des clients WebSocket nus (`ws`) jouent le parcours de la spec (docs/superpowers/specs/2026-11-08-rocket-en-ligne-design.md, § 6,
 * § 7, § 10) ; la sérialisation binaire est celle du dépôt, compilée à la volée par `esbuild` (devDependency de `serveur-fps`) dans un dossier
 * temporaire hors du dépôt.
 *
 * Serveur A (réglages d'essai : `PDJ_ROCKET_DEV=1`, match de 20 s, chargement 3 s, reprise 3 s, revanche 5 s) :
 *  1. sante, version erronée (4001), premier message autre que « bonjour » (4003), trame texte démesurée, JSON invalide, type inconnu
 *  2. création, liste, codes invalides / inconnus, rejoindre, équipes, réglages et lancement réservés à l'hôte, ping hors match
 *  3. lancement, `debut`, `pret`, instantanés à 20 Hz (±10 %), `manquees` nul, `avance` dans la fourchette, entrées prises en compte, la voiture
 *     de A bouge chez B, trame d'un autre `numero` ignorée, trames malformées ignorées
 *  4. but forcé (`dev`), `ev` reçu, score identique chez les deux, fin du match, `fin` identique, revanche unanime (`numero` suivant)
 *  5. coupure + reprise (jeton), jeton faux, prise de relais d'une socket encore ouverte (fermée 4004), coupure + bot après `repriseMs`
 *  6. un joueur qui ne dit jamais « pret » : le match démarre après `chargementMs`
 *  7. fin sans accord : retour au salon après `revancheMs`
 *  8. un client qui ne lit pas : instantanés sautés puis socket terminée (si le noyau le permet dans le temps imparti)
 *  9. `quitter` en match (bot immédiat), départ de l'hôte au salon (transfert d'hôte), salle vide refermée
 * Serveur B (sans `dev`, plafonds réduits) : `dev` refusé, plafond de connexions par adresse (1013), salles par adresse, matchs simultanés,
 * énumération des codes, flood (4002), adresse lue dans `x-forwarded-for` (dernier élément).
 * Serveur C (`PDJ_ROCKET=off`) : `upgrade` répond 404 ; l'arène répond toujours.
 * Serveur D (arrêt) : SIGTERM ferme les sockets Rocket (1001).
 *
 * Usage : node scripts/rocket/protocole_rocket.mjs (Node 22 de préférence). Variables : ROCKET_DEBUG=1 (traces), ROCKET_SANS_LECTURE=0 (saute l'étape 8).
 * Code de sortie : 0 si tout passe, 1 sinon.
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(RACINE, "serveur-fps/package.json"));
const WebSocket = require("ws");
const esbuild = require("esbuild");

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const ok = (c, m) => { console.log(`${c ? "OK  " : "ÉCHEC"} ${m}`); if (!c) echecs++; return c; };
const trace = (...a) => { if (process.env.ROCKET_DEBUG) console.log("    ·", ...a); };
const titre = (t) => console.log(`\n== ${t}`);

// ------------------------------------------------------------------------------------------------------------------------------------
// Compilation à la volée de la sérialisation (les .mjs ne peuvent pas importer le TypeScript)
// ------------------------------------------------------------------------------------------------------------------------------------

const DOSSIER_TMP = mkdtempSync(join(tmpdir(), "pdj-rocket-proto-"));
process.on("exit", () => { try { rmSync(DOSSIER_TMP, { recursive: true, force: true }); } catch { /* tant pis */ } });
const SORTIE_LIB = join(DOSSIER_TMP, "lib.mjs");
await esbuild.build({
  stdin: {
    contents: [
      'export { encoderTrameEntrees, decoderSnap, quantifierEntrees, typeDeTrame } from "lib/rocket/reseau/serialisation";',
      'export { RESEAU, VERSION_ROCKET, TRAME_ENTREES, TRAME_SNAP, AVANCE_INCONNUE, CODE_REMPLACE, CODE_FLOOD, CODE_VERSION, CODE_BONJOUR, CODE_TROP_DE_CONNEXIONS } from "lib/rocket/reseau/protocole";',
      'export { BUT, STADE } from "lib/rocket/contrat";',
    ].join("\n"),
    resolveDir: RACINE, sourcefile: "entree.ts", loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", target: "node20", outfile: SORTIE_LIB, logLevel: "error",
  alias: { "lib": join(RACINE, "lib") },
});
const L = await import(pathToFileURL(SORTIE_LIB).href);
const { RESEAU, VERSION_ROCKET, TRAME_ENTREES } = L;
const TPS = 120;

// ------------------------------------------------------------------------------------------------------------------------------------
// Serveurs
// ------------------------------------------------------------------------------------------------------------------------------------

const portLibre = () => new Promise((r) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const build = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: join(RACINE, "serveur-fps"), encoding: "utf8" });
if (build.status !== 0) throw new Error(`build de serveur-fps en échec :\n${build.stdout}${build.stderr}`);

const serveurs = [];
async function lancerServeur(env = {}) {
  const port = await portLibre();
  const sortie = [];
  const proc = spawn(process.execPath, ["dist/index.js"], {
    cwd: join(RACINE, "serveur-fps"), stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, PORT: String(port), SCENE_JSON: join(RACINE, "public/agroparc/scene.json"),
      PDJ_FPS_POLICE: "off", PDJ_FPS_ZOMBIES_PATROUILLE: "off", ...env,
    },
  });
  proc.stdout.on("data", (d) => sortie.push(String(d)));
  proc.stderr.on("data", (d) => { sortie.push(String(d)); if (process.env.ROCKET_DEBUG) process.stderr.write(d); });
  const s = { port, proc, sortie, url: `ws://localhost:${port}/rocket`, http: `http://localhost:${port}` };
  serveurs.push(s);
  for (let i = 0; i < 150; i++) {
    if (await fetch(`${s.http}/sante`).then((r) => r.ok, () => false)) return s;
    await attendre(100);
  }
  throw new Error(`serveur-fps injoignable sur ${port}\n${sortie.join("")}`);
}
process.on("exit", () => { for (const s of serveurs) s.proc.kill(); });
const sante = async (s) => (await fetch(`${s.http}/sante`).then((r) => r.json())).rocket;

// ------------------------------------------------------------------------------------------------------------------------------------
// Clients
// ------------------------------------------------------------------------------------------------------------------------------------

let compteurIp = 0;
const ipUnique = () => `10.20.${Math.floor(++compteurIp / 250)}.${compteurIp % 250 + 1}`;

/** Un client WebSocket nu. `ip` : valeur de `x-forwarded-for` (le serveur lit le DERNIER élément). */
function client(serveur, nom, { ip = ipUnique(), bonjour = true, reprise, version = VERSION_ROCKET, en_tete = {} } = {}) {
  const ws = new WebSocket(serveur.url, { headers: { "x-forwarded-for": ip, ...en_tete } });
  const c = {
    nom, ws, ip, recus: [], snaps: [], binaires: 0, fermeture: null, id: null, jeton: null, code: null, moi: -1, numero: -1,
    tickPong: null, trame: { dernier: 0 },
  };
  ws.on("message", (d, binaire) => {
    if (binaire) {
      c.binaires++;
      const o = new Uint8Array(d);
      if (L.typeDeTrame(o) === L.TRAME_SNAP) {
        const snap = L.decoderSnap(o);
        if (snap) c.snaps.push({ t: Date.now(), snap, octets: o.length });
      }
      return;
    }
    const m = JSON.parse(String(d));
    c.recus.push(m);
    if (m.t === "bienvenue") c.id = m.joueur;
    if (m.t === "session") { c.jeton = m.jeton; c.code = m.code; }
    if (m.t === "debut") { c.moi = m.moi; c.numero = m.numero; c.voitures = m.voitures; }
    if (m.t === "pong" && m.tick >= 0) c.tickPong = { tick: m.tick, t: Date.now() };
  });
  ws.on("close", (code, raison) => { c.fermeture = { code, raison: String(raison) }; });
  ws.on("error", () => { /* la fermeture suffit */ });
  c.ouvert = new Promise((r) => { ws.on("open", r); ws.on("close", r); });
  c.envoyer = (m) => ws.send(JSON.stringify(m));
  c.brut = (b) => ws.send(b, { binary: true });
  if (bonjour) c.ouvert.then(() => { if (ws.readyState === ws.OPEN) c.envoyer({ t: "bonjour", v: version, nom, ...(reprise ? { reprise } : {}) }); });
  c.marque = () => c.recus.length;
  c.apres = (i, t) => c.recus.slice(i).filter((m) => !t || m.t === t);
  c.dernier = (t) => [...c.recus].reverse().find((m) => m.t === t);
  c.tous = (t) => c.recus.filter((m) => m.t === t);
  c.attendre = async (pred, ms = 6000, depuis = 0) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      const m = c.recus.slice(depuis).find(pred);
      if (m) return m;
      await attendre(20);
    }
    return null;
  };
  c.fermer = () => { try { ws.close(1000); } catch { /* déjà fermée */ } };
  c.couper = () => { try { ws.terminate(); } catch { /* déjà fermée */ } };
  return c;
}
async function accueilli(...cs) {
  for (const c of cs) {
    await c.ouvert;
    const m = await c.attendre((x) => x.t === "bienvenue", 4000);
    if (!m) throw new Error(`${c.nom} : pas de bienvenue (${JSON.stringify(c.fermeture)})`);
  }
}
async function jusqua(f, ms = 6000) { const fin = Date.now() + ms; while (Date.now() < fin) { const r = f(); if (r) return r; await attendre(20); } return null; }

const REGLAGES = { format: "1v1", dureeS: 180, niveauBots: "debutant", visible: true };
const neutre = () => ({ accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false });

/**
 * Pilote scripté : toutes les 20 ms envoie une trame contiguë (jusqu'à 3 entrées de redondance) qui couvre jusqu'à `avance` ticks au-dessus du tick
 * serveur estimé (dernier pong). `entree(tick)` rend l'entrée du tick. Rend { arreter, envoyees }.
 */
function piloter(c, entree, { avance = 6, numero = () => c.numero } = {}) {
  let proch = null;
  let envoyees = 0;
  const estimer = () => (c.tickPong ? c.tickPong.tick + ((Date.now() - c.tickPong.t) * TPS) / 1000 : null);
  const ping = setInterval(() => { if (c.ws.readyState === c.ws.OPEN) c.envoyer({ t: "ping", c: Date.now() }); }, 250);
  const boucle = setInterval(() => {
    if (c.ws.readyState !== c.ws.OPEN) return;
    const est = estimer();
    if (est === null) return;
    const cible = Math.floor(est) + avance;
    if (proch === null || proch < Math.floor(est) + 1) proch = Math.floor(est) + avance - 2;
    const debut = Math.max(0, proch - RESEAU.redondanceEntrees);
    const n = Math.min(RESEAU.entreesMaxParTrame, cible - debut + 1);
    if (n <= 0) return;
    const entrees = [];
    for (let k = 0; k < n; k++) entrees.push(entree(debut + k));
    const snap = c.snaps.length ? c.snaps[c.snaps.length - 1].snap.tick : 0;
    c.brut(L.encoderTrameEntrees({ numero: numero(), tickDebut: debut, snapRecu: snap, entrees }));
    proch = debut + n;
    envoyees++;
  }, 20);
  return { arreter: () => { clearInterval(ping); clearInterval(boucle); }, get envoyees() { return envoyees; } };
}
const accelerer = () => ({ ...neutre(), accel: 127, boost: true });

const stable = (v) => JSON.stringify(v);

// ====================================================================================================================================
// Serveur A
// ====================================================================================================================================

const A_ENV = {
  PDJ_ROCKET_DEV: "1", PDJ_ROCKET_DUREE_S: "20", PDJ_ROCKET_CHARGEMENT_MS: "3000", PDJ_ROCKET_REPRISE_MS: "3000", PDJ_ROCKET_REVANCHE_MS: "5000",
};
const SA = await lancerServeur(A_ENV);

titre("1. santé et poignée de main");
{
  const s = await sante(SA);
  ok(s && typeof s.salles === "number" && "ticMaxMs" in s && "octetsEmis" in s && "socketsRemplacees" in s, `/sante contient le bloc rocket (${JSON.stringify(s)})`);
  const r = await fetch(`${SA.http}/sante`).then((x) => x.json());
  ok(typeof r.joueurs === "number" || typeof r.clients === "number" || Object.keys(r).length > 3, "les champs plats historiques de /sante sont conservés");

  const v = client(SA, "Vieux", { version: 99 });
  await v.ouvert;
  const ev = await v.attendre((m) => m.t === "erreur");
  await jusqua(() => v.fermeture);
  ok(ev?.code === "version" && v.fermeture?.code === L.CODE_VERSION, `version erronée : erreur{version} puis fermeture 4001 (${stable(ev)}, ${stable(v.fermeture)})`);

  const p = client(SA, "Pressé", { bonjour: false });
  await p.ouvert;
  p.envoyer({ t: "lister" });
  const ep = await p.attendre((m) => m.t === "erreur");
  await jusqua(() => p.fermeture);
  ok(ep?.code === "bonjour" && p.fermeture?.code === L.CODE_BONJOUR, `premier message autre que bonjour : fermeture 4003 (${stable(p.fermeture)})`);

  const g = client(SA, "Gros");
  await accueilli(g);
  g.ws.send("x".repeat(RESEAU.tailleMaxTexteOctets + 10));
  await jusqua(() => g.fermeture);
  ok(g.fermeture && g.fermeture.code === 1009, `trame texte de plus de ${RESEAU.tailleMaxTexteOctets} octets : socket fermée 1009 (${stable(g.fermeture)})`);

  const t = client(SA, "Texte");
  await accueilli(t);
  t.ws.send("{pas du json");
  t.ws.send(JSON.stringify({ t: "inconnu-du-protocole", x: 1 }));
  t.ws.send(JSON.stringify([1, 2, 3]));
  t.ws.send(JSON.stringify({ t: "creer", reglages: { format: "9v9" } }));
  t.envoyer({ t: "ping", c: 7 });
  const pg = await t.attendre((m) => m.t === "pong");
  ok(pg?.c === 7 && pg.tick === -1 && !t.fermeture, "JSON invalide, type inconnu et réglages absurdes ne coupent pas la socket ; ping hors salle répond tick −1");
  ok(t.apres(0, "refus").some((m) => m.action === "creer" && m.raison === "invalide"), "creer avec des réglages invalides : refus{invalide}");
  ok(t.apres(0, "salon").length === 0, "aucun salon n'a été créé par ce message invalide");
  t.fermer();
}

titre("2. création, liste, rejoindre, équipes, droits de l'hôte");
const A = client(SA, "Alice"), B = client(SA, "Bob");
await accueilli(A, B);
ok(A.id !== B.id && A.id > 0, `identifiants distincts (${A.id}, ${B.id})`);
A.envoyer({ t: "lister" });
ok(!!(await A.attendre((m) => m.t === "liste" && m.parties.length === 0)), "liste vide au départ");
A.envoyer({ t: "creer", reglages: REGLAGES });
const salonA = await A.attendre((m) => m.t === "salon" && m.salon);
const sessA = await A.attendre((m) => m.t === "session");
const CODE = salonA?.salon.code;
ok(/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(CODE ?? ""), `code de salon de 4 consonnes (${CODE})`);
ok(sessA?.code === CODE && sessA.joueur === A.id && /^[0-9a-f]{32}$/.test(sessA.jeton), "session{code, joueur, jeton} de 16 octets en hexadécimal");
ok(salonA.salon.joueurs.length === 1 && salonA.salon.joueurs[0].hote && salonA.salon.phase === "salon" && salonA.salon.lancable === false, "salon : A seule, hôte, non lançable");
A.envoyer({ t: "creer", reglages: REGLAGES });
ok(!!(await A.attendre((m) => m.t === "refus" && m.action === "creer" && m.raison === "deja-dans-salle")), "creer une seconde fois : refus{deja-dans-salle}");

B.envoyer({ t: "lister" });
const liste = await B.attendre((m) => m.t === "liste" && m.parties.length === 1);
ok(liste?.parties[0].code === CODE && liste.parties[0].hote === "Alice" && liste.parties[0].humains === 1 && liste.parties[0].places === 2, `liste : la partie de A est ouverte (${stable(liste?.parties[0])})`);

B.envoyer({ t: "rejoindre", code: "AAAA" });
ok(!!(await B.attendre((m) => m.t === "refus" && m.action === "rejoindre" && m.raison === "code")), "code hors alphabet : refus{code}");
B.envoyer({ t: "rejoindre", code: "BBBB" === CODE ? "CCCC" : "BBBB" });
ok(!!(await B.attendre((m) => m.t === "refus" && m.action === "rejoindre" && m.raison === "inconnue")), "code inconnu : refus{inconnue}");
const iB = B.marque();
B.envoyer({ t: "rejoindre", code: CODE.toLowerCase() });
const salonB = await B.attendre((m) => m.t === "salon" && m.salon?.joueurs.length === 2, 4000, iB);
const sessB = await B.attendre((m) => m.t === "session", 4000, iB);
ok(!!salonB && sessB?.code === CODE && sessB.joueur === B.id, "B rejoint (code en minuscules accepté) : salon à deux, session reçue");
const salonA2 = await A.attendre((m) => m.t === "salon" && m.salon?.joueurs.length === 2);
ok(!!salonA2, "A reçoit aussi le salon à deux joueurs");
const eqA = salonA2.salon.joueurs.find((j) => j.id === A.id).equipe, eqB = salonA2.salon.joueurs.find((j) => j.id === B.id).equipe;
ok(eqA !== eqB, `en 1v1 B est dans l'équipe opposée à A (${eqA} / ${eqB})`);
ok(salonA2.salon.lancable === true, "à deux, le salon est lançable");
A.envoyer({ t: "lister" });
await A.attendre((m) => m.t === "liste");
ok(A.dernier("liste").parties.length === 0, "une partie pleine n'est plus listée");

B.envoyer({ t: "equipe", equipe: eqA });
ok(!!(await B.attendre((m) => m.t === "refus" && m.action === "equipe" && m.raison === "equipe-pleine")), "changer pour l'équipe pleine : refus{equipe-pleine}");
B.envoyer({ t: "reglages", reglages: { dureeS: 300 } });
ok(!!(await B.attendre((m) => m.t === "refus" && m.action === "reglages" && m.raison === "hote")), "réglages par un non-hôte : refus{hote}");
B.envoyer({ t: "lancer" });
ok(!!(await B.attendre((m) => m.t === "refus" && m.action === "lancer" && m.raison === "hote")), "lancer par un non-hôte : refus{hote}");
A.envoyer({ t: "reglages", reglages: { format: "2v2", visible: false } });
const salon22 = await A.attendre((m) => m.t === "salon" && m.salon?.reglages.format === "2v2");
ok(!!salon22 && salon22.salon.reglages.visible === false && salon22.salon.placesParEquipe === 2, "l'hôte change le format et la visibilité");
A.envoyer({ t: "reglages", reglages: { format: "1v1" } });
ok(!!(await A.attendre((m) => m.t === "salon" && m.salon?.reglages.format === "1v1")), "retour en 1v1 (deux joueurs, une place chacun)");
B.envoyer({ t: "ping", c: 1 });
const pgB = await B.attendre((m) => m.t === "pong" && m.c === 1);
ok(pgB?.tick === -1 && pgB.ralenti === false, "ping au salon : pong avec tick −1");
A.envoyer({ t: "pret" });
await attendre(150);
ok(!A.recus.some((m) => m.t === "debut"), "« pret » au salon ne démarre rien");
A.envoyer({ t: "dev", action: "chrono", tempsRestant: 5 });
ok(!!(await A.attendre((m) => m.t === "refus" && m.action === "dev" && m.raison === "phase")), "dev au salon : refus{phase}");

titre("3. lancement, chargement, instantanés, entrées");
const iA = A.marque(), iB2 = B.marque();
A.envoyer({ t: "lancer" });
const debA = await A.attendre((m) => m.t === "debut", 4000, iA);
const debB = await B.attendre((m) => m.t === "debut", 4000, iB2);
ok(!!debA && !!debB, "les deux joueurs reçoivent debut");
ok(debA.numero === debB.numero && debA.voitures.length === 2 && debA.moi !== debB.moi && debA.moi >= 0 && debB.moi >= 0, `debut : même numéro, deux voitures, moi différents (${debA.moi}, ${debB.moi}, numéro ${debA.numero})`);
ok(debA.voitures.filter((v) => v.humain).length === 2 && debA.voitures.find((v) => v.id === debA.moi).joueur === A.id, "debut : voitures humaines liées aux ids de joueur");
ok(debA.config.dureeS === 20, `la durée d'essai (PDJ_ROCKET_DUREE_S) s'applique (${debA.config.dureeS} s)`);
ok((await A.attendre((m) => m.t === "salon" && m.salon?.phase === "chargement", 2000, iA)) !== null, "salon en phase chargement");
const nbSnapsAvantPret = A.snaps.length;
A.envoyer({ t: "ping", c: 2 });
ok((await A.attendre((m) => m.t === "pong" && m.c === 2))?.tick === -1, "ping pendant le chargement : tick −1");
await attendre(300);
ok(A.snaps.length === nbSnapsAvantPret, "aucun instantané avant que tout le monde ait dit « pret »");
A.envoyer({ t: "pret" });
await attendre(300);
ok(A.snaps.length === nbSnapsAvantPret, "un seul « pret » ne démarre pas le match");
const tPret = Date.now();
B.envoyer({ t: "pret" });
await jusqua(() => A.snaps.length > nbSnapsAvantPret && B.snaps.length > 0, 3000);
ok(A.snaps.length > nbSnapsAvantPret && B.snaps.length > 0, `tous prêts : le match démarre aussitôt (${Date.now() - tPret} ms)`);
ok((await A.attendre((m) => m.t === "salon" && m.salon?.phase === "match", 2000, iA)) !== null, "salon en phase match");
const s0 = A.snaps[0].snap;
ok(s0.numero === debA.numero % 256 && s0.nbVoitures === 2 && s0.entreesRecuesJusqua === -1 && s0.avance === L.AVANCE_INCONNUE, `premier instantané : numéro, 2 voitures, rien reçu, avance inconnue (${s0.avance})`);

// pings protocolaires : ne rien faire de plus ; le serveur répond à nos ping applicatifs avec un tick fractionnaire
A.envoyer({ t: "ping", c: 3 });
const pm = await A.attendre((m) => m.t === "pong" && m.c === 3);
ok(pm?.tick >= 0 && pm.ralenti === false, `ping pendant le match : tick fractionnaire (${pm?.tick?.toFixed(2)})`);

// trames de pilotage
const numero = debA.numero % 256;
// 3a. trame d'un autre numéro : ignorée (aucune entrée reçue), puis trames malformées qui ne coupent rien
{
  const faux = (numero + 7) & 255;
  const ents = Array.from({ length: 6 }, accelerer);
  const base = Math.floor(A.tickPong?.tick ?? pm.tick) + 4;
  A.brut(L.encoderTrameEntrees({ numero: faux, tickDebut: base, snapRecu: 0, entrees: ents }));
  A.brut(new Uint8Array([TRAME_ENTREES]));                       // tronquée
  A.brut(new Uint8Array([9, 9, 9, 9, 9, 9]));                    // type inconnu
  A.brut(randomBytes(300));                                      // bruit
  const longue = L.encoderTrameEntrees({ numero, tickDebut: base, snapRecu: 0, entrees: ents });
  A.brut(longue.slice(0, longue.length - 3));                    // coupée en deux
  A.brut(new Uint8Array(0));                                     // vide
  const trop = new Uint8Array(longue.length + 6 * 3); trop.set(longue);   // octets en trop
  A.brut(trop);
  const treize = new Uint8Array(11 + 13 * 6); treize[0] = TRAME_ENTREES; treize[1] = numero; treize[10] = 13;  // 13 entrées > le maximum
  A.brut(treize);
  const n0 = A.snaps.length;
  await jusqua(() => A.snaps.length >= n0 + 4, 3000);
  const recents = A.snaps.slice(n0).map((x) => x.snap);
  ok(recents.length >= 4 && recents.every((s) => s.entreesRecuesJusqua === -1), `trame d'un autre numéro et trames malformées : rien n'est pris en compte (${recents.length} instantanés, dernier entreesRecuesJusqua=${recents.at(-1)?.entreesRecuesJusqua})`);
  ok(!A.fermeture, "la socket reste ouverte après des trames binaires malformées");
  A.envoyer({ t: "ping", c: 4 });
  ok(!!(await A.attendre((m) => m.t === "pong" && m.c === 4)), "le serveur répond toujours");
}

// 3b. pilotage valide : A accélère, B reste neutre
const posA0 = (() => { const s = B.snaps.at(-1).snap; return [...s.etat.voitures[debA.moi].p]; })();
const pilotA = piloter(A, accelerer, { numero: () => numero });
const pilotB = piloter(B, neutre, { numero: () => numero });
await attendre(2500); // le décompte de 3 s tourne, puis le coup d'envoi
const fenetre0 = Date.now();
const n0A = A.snaps.length, n0B = B.snaps.length;
await attendre(9000);
const fenetreMs = Date.now() - fenetre0;
const fa = A.snaps.slice(n0A), fb = B.snaps.slice(n0B);
for (const [nom, f] of [["A", fa], ["B", fb]]) {
  const attendu = (fenetreMs / 1000) * 20;
  ok(f.length >= attendu * 0.9 && f.length <= attendu * 1.1, `${nom} : instantanés à 20 Hz ±10 % (${f.length} en ${(fenetreMs / 1000).toFixed(1)} s, attendu ${attendu.toFixed(0)})`);
}
const sommeManq = (f) => f.reduce((s, x) => s + x.snap.manquees, 0);
ok(sommeManq(fa) === 0 && sommeManq(fb) === 0, `manquees nul pour les deux joueurs (A ${sommeManq(fa)}, B ${sommeManq(fb)})`);
const avances = fa.map((x) => x.snap.avance).filter((a) => a !== L.AVANCE_INCONNUE).sort((a, b) => a - b);
const medAv = avances[Math.floor(avances.length / 2)];
ok(avances.length >= fa.length * 0.8 && medAv >= RESEAU.avanceMinTicks - 1 && medAv <= RESEAU.avanceMaxTicks + 3, `avance médiane de A dans la fourchette (${medAv} ticks, min ${avances[0]}, max ${avances.at(-1)}, ${avances.length}/${fa.length} instantanés renseignés)`);
const lastA = A.snaps.at(-1).snap, lastB = B.snaps.at(-1).snap;
ok(lastA.entreesRecuesJusqua > 0, `entreesRecuesJusqua suit les entrées de A (${lastA.entreesRecuesJusqua} pour le tick ${lastA.tick})`);
ok(lastA.entrees[debA.moi].accel === 127 && lastA.entrees[debA.moi].boost === true, "snap.entrees porte les entrées quantifiées appliquées à la voiture de A");
const posA1 = lastB.etat.voitures[debA.moi].p;
const dist = Math.hypot(posA1[0] - posA0[0], posA1[2] - posA0[2]);
ok(dist > 15, `B voit la voiture de A avancer (${dist.toFixed(1)} m)`);
ok(lastB.etat.voitures[debA.moi].boost < 100 || lastB.etat.voitures[debA.moi].boost <= 33.3, `le boost de A se vide (${lastB.etat.voitures[debA.moi].boost})`);
ok(lastA.etat.phase === "enJeu", `phase du monde : enJeu (${lastA.etat.phase})`);
// la dernière entrée de B n'a jamais été envoyée avec accel : sa voiture est restée sur place pendant le match (hors collisions)
const bougeB = Math.hypot(lastB.etat.voitures[debB.moi].v[0], lastB.etat.voitures[debB.moi].v[2]);
trace("vitesse de B", bougeB.toFixed(2));
// klaxon (limité) : ne coupe rien et produit un événement
const iEv = A.marque();
B.envoyer({ t: "klaxon" });
ok(!!(await A.attendre((m) => m.t === "ev" && m.evenements.some((x) => x.e.t === "klaxon" && x.e.idVoiture === debB.moi), 3000, iEv)), "klaxon de B diffusé à A dans un message ev");

let numero2 = -1;
titre("4. but forcé, événements, fin, revanche");
{
  const iEvA = A.marque(), iEvB = B.marque();
  const dirBleue = debA.voitures.find((v) => v.id === debA.moi).equipe === "bleue" ? 1 : -1;
  // les bleus attaquent la cage Z > 0 ; la voiture de A est lancée à pleine vitesse : on envoie la balle plusieurs fois s'il le faut
  pilotA.arreter(); pilotB.arreter();
  let evBut = null;
  for (let essai = 0; essai < 6 && !evBut; essai++) {
    A.envoyer({ t: "dev", action: "balle", p: [0, 2, 44], v: [0, 0, 32] });
    evBut = await A.attendre((m) => m.t === "ev" && m.evenements.some((x) => x.e.t === "but"), 1500, iEvA);
  }
  ok(!!evBut, `événement « but » diffusé (essai dev balle) ${dirBleue ? "" : ""}`);
  const evB = await B.attendre((m) => m.t === "ev" && m.evenements.some((x) => x.e.t === "but"), 2000, iEvB);
  ok(!!evB, "B reçoit aussi l'événement « but »");
  const butA = evBut?.evenements.find((x) => x.e.t === "but");
  ok(butA && typeof butA.tick === "number" && (butA.e.equipe === "bleue" || butA.e.equipe === "orange"), `l'événement porte son tick et l'équipe marqueuse (${stable(butA)})`);
  await jusqua(() => A.snaps.at(-1).snap.etat.phase === "but" && B.snaps.at(-1).snap.etat.phase === "but", 3000);
  const sa = A.snaps.at(-1).snap, sb = B.snaps.at(-1).snap;
  ok(sa.etat.score[butA.e.equipe] === 1 && sb.etat.score[butA.e.equipe] === 1, `score 1-0 identique chez les deux (${stable(sa.etat.score)} / ${stable(sb.etat.score)})`);
  ok(sa.etat.dernierBut && sa.etat.dernierBut.equipe === butA.e.equipe, "l'état porte dernierBut");
  // un instantané hors grille part sur le but : ils arrivent avant la prochaine seconde
  // dev : raccourcir le chrono ; le match finit à la balle au sol
  A.envoyer({ t: "dev", action: "chrono", tempsRestant: 1 });
}
const iFinA = A.marque(), iFinB = B.marque();
const finA = await A.attendre((m) => m.t === "fin", 25000, 0);
const finB = await B.attendre((m) => m.t === "fin", 5000, 0);
ok(!!finA && !!finB, "le message fin arrive aux deux joueurs");
ok(stable(finA?.resultat) === stable(finB?.resultat), "même résultat chez les deux");
ok(finA?.resultat.score && finA.resultat.vainqueur !== undefined, `résultat : ${stable(finA?.resultat?.score)} vainqueur ${finA?.resultat?.vainqueur}`);
const salonFin = await A.attendre((m) => m.t === "salon" && m.salon?.phase === "fin", 3000);
ok(!!salonFin && !!salonFin.salon.revanche, "salon en phase fin avec le compte de la revanche");
const snapsFin = A.snaps.length;
await attendre(400);
ok(A.snaps.length === snapsFin, "plus aucun instantané après la fin");

// revanche unanime
{
  const iA3 = A.marque(), iB3 = B.marque();
  A.envoyer({ t: "revanche", oui: true });
  const sv = await A.attendre((m) => m.t === "salon" && m.salon?.phase === "fin" && m.salon.revanche?.votes[A.id] === true, 2000, iA3);
  ok(!!sv, "le vote oui de A apparaît dans le salon");
  await attendre(200);
  ok(!A.recus.slice(iA3).some((m) => m.t === "debut"), "un seul vote ne relance pas");
  B.envoyer({ t: "revanche", oui: true });
  const d2A = await A.attendre((m) => m.t === "debut", 3000, iA3);
  const d2B = await B.attendre((m) => m.t === "debut", 3000, iB3);
  ok(!!d2A && !!d2B && d2A.numero === (debA.numero + 1) % 256 && d2B.numero === d2A.numero, `revanche unanime : nouveau debut, numéro suivant (${debA.numero} → ${d2A?.numero})`);
  ok(d2A.moi === debA.moi && d2B.moi === debB.moi, "même répartition des voitures");
  const nA = A.snaps.length;
  A.envoyer({ t: "pret" }); B.envoyer({ t: "pret" });
  await jusqua(() => A.snaps.length > nA, 3000);
  const nS = A.snaps.at(-1).snap;
  ok(nS.numero === d2A.numero && nS.etat.score.bleue === 0 && nS.etat.score.orange === 0 && nS.entreesRecuesJusqua === -1, "nouveau match : score remis à 0, numéro du nouveau match, aucune entrée");
  // une trame de l'ANCIEN numéro n'est pas prise en compte
  const tk = Math.floor(nS.tick) + 6;
  A.brut(L.encoderTrameEntrees({ numero: numero, tickDebut: tk, snapRecu: 0, entrees: [accelerer(), accelerer(), accelerer()] }));
  const nn = A.snaps.length;
  await jusqua(() => A.snaps.length >= nn + 3, 2000);
  ok(A.snaps.slice(nn).every((x) => x.snap.entreesRecuesJusqua === -1), "trame de l'ancien match (revanche) : écartée");
  numero2 = d2A.numero;
}

titre("5. coupure et reprise");
const JETON_B = B.jeton, CODE_B = B.code, ID_B = B.id;
{
  const iAp = A.marque();
  B.couper();
  const pc = await A.attendre((m) => m.t === "presence" && m.joueur === ID_B && m.etat === "coupe", 4000, iAp);
  ok(!!pc && pc.restantMs > 0, `A voit B coupé (reprise possible ${pc?.restantMs} ms)`);
  await attendre(300);
  // reprise avec un faux jeton
  const faux = client(SA, "Bob", { reprise: { code: CODE_B, joueur: ID_B, jeton: randomBytes(16).toString("hex") } });
  await faux.ouvert;
  const rf = await faux.attendre((m) => m.t === "reprise", 3000);
  ok(rf?.code === null, "jeton faux : reprise{code: null}");
  ok(!faux.recus.some((m) => m.t === "debut" || m.t === "salon"), "jeton faux : aucune information du salon ne fuit");
  faux.fermer();
  // reprise avec le bon jeton
  const B2 = client(SA, "Bob", { reprise: { code: CODE_B, joueur: ID_B, jeton: JETON_B } });
  await B2.ouvert;
  const rr = await B2.attendre((m) => m.t === "reprise", 3000);
  ok(rr?.code === CODE_B, "bon jeton : reprise{code}");
  const sess = await B2.attendre((m) => m.t === "session", 3000);
  const deb = await B2.attendre((m) => m.t === "debut", 3000);
  const salR = await B2.attendre((m) => m.t === "salon", 3000);
  const idx = (t) => B2.recus.findIndex((m) => m.t === t);
  ok(!!sess && sess.joueur === ID_B && sess.jeton === JETON_B && !!deb && !!salR, "reprise : session (même jeton), salon et debut reçus");
  ok(idx("bienvenue") < idx("reprise") && idx("salon") < idx("session") && idx("session") < idx("debut"), `ordre bienvenue, reprise, salon, session, debut (${B2.recus.map((m) => m.t).join(", ")})`);
  ok(deb?.moi === debB.moi && deb.numero === numero2, "reprise : même voiture, numéro du match courant");
  ok(B2.id === ID_B, "reprise : même identifiant de joueur (bienvenue)");
  const pr = await A.attendre((m) => m.t === "presence" && m.joueur === ID_B && m.etat === "revenu", 3000, iAp);
  ok(!!pr, "A voit B revenu");
  ok(await jusqua(() => B2.snaps.length > 0, 3000), "reprise : un instantané suit immédiatement");
  // la reprise se fait hors « pret » : le match continue pour A
  ok(A.snaps.at(-1).t > Date.now() - 500, "le match de A n'a jamais été interrompu");
  // prise de relais : B2 est connectée et vivante ; une troisième socket présente le même jeton
  const avantSock = (await sante(SA)).socketsRemplacees;
  const prise = client(SA, "Bob", { reprise: { code: CODE_B, joueur: ID_B, jeton: JETON_B } });
  await prise.ouvert;
  const rp = await prise.attendre((m) => m.t === "reprise", 3000);
  ok(rp?.code === CODE_B, "prise de relais : la reprise est acceptée alors que l'ancienne socket est encore ouverte");
  await jusqua(() => B2.fermeture, 3000);
  ok(B2.fermeture?.code === L.CODE_REMPLACE, `l'ancienne socket est fermée 4004 (${stable(B2.fermeture)})`);
  const apres = (await sante(SA)).socketsRemplacees;
  ok(apres === avantSock + 1, `socketsRemplacees +1 dans /sante (${avantSock} → ${apres})`);
  ok(!A.recus.slice(iAp).some((m) => m.t === "presence" && m.joueur === ID_B && (m.etat === "bot" || m.etat === "parti")), "la fermeture de l'ancienne socket ne retire pas le joueur");
  await jusqua(() => prise.snaps.length > 0, 3000);
  ok(prise.snaps.length > 0, "la nouvelle socket reçoit les instantanés");
  global.B3 = prise;
}
const B3 = global.B3;

titre("6. coupure puis remplacement par un bot");
{
  const iAp = A.marque();
  const jeton = B3.jeton, code = B3.code, id = B3.id;
  B3.couper();
  const pc = await A.attendre((m) => m.t === "presence" && m.joueur === id && m.etat === "coupe", 3000, iAp);
  ok(!!pc, "B coupé de nouveau");
  const t0 = Date.now();
  const pbot = await A.attendre((m) => m.t === "presence" && m.joueur === id && m.etat === "bot", 6000, iAp);
  ok(!!pbot, `au bout de repriseMs un bot prend la voiture (${Date.now() - t0} ms, attendu ~3000)`);
  const sal = await A.attendre((m) => m.t === "salon" && m.salon.joueurs.length === 1, 2000, iAp);
  ok(!!sal && sal.salon.joueurs[0].id === A.id, "le salon ne compte plus que A");
  const tard = client(SA, "Bob", { reprise: { code, joueur: id, jeton } });
  await tard.ouvert;
  const rt = await tard.attendre((m) => m.t === "reprise", 3000);
  ok(rt?.code === null, "reprise après remplacement : refusée (reprise{code: null})");
  ok(!tard.recus.some((m) => m.t === "debut"), "reprise refusée : pas de debut");
  tard.fermer();
  // le match continue : le bot pilote, les instantanés de A arrivent toujours
  const n = A.snaps.length;
  await attendre(600);
  ok(A.snaps.length > n + 5, "le match continue pour A seule avec un bot");
  const lo = A.snaps.at(-1).snap;
  ok(lo.etat.voitures.length === 2, "toujours deux voitures dans le monde");
}

titre("7. quitter pendant le match, fin et salle refermée");
{
  const nSalles = (await sante(SA)).salles;
  const iEvA = A.marque();
  A.envoyer({ t: "quitter" });
  const q = await A.attendre((m) => m.t === "salon" && m.salon === null && m.raison === "quitte", 3000, iEvA);
  ok(!!q, "quitter : accusé salon{null, quitte}");
  await jusqua(async () => false, 100);
  await attendre(1300);
  const ns = (await sante(SA)).salles;
  ok(ns === nSalles - 1, `la salle sans humain est refermée (${nSalles} → ${ns})`);
  A.envoyer({ t: "rejoindre", code: CODE });
  ok(!!(await A.attendre((m) => m.t === "refus" && m.action === "rejoindre", 2000, iEvA)), "rejoindre la salle refermée : refus");
  A.fermer(); B3.fermer();
}

titre("8. un joueur qui ne dit jamais « pret »");
{
  const X = client(SA, "Xavier"), Y = client(SA, "Yvonne");
  await accueilli(X, Y);
  X.envoyer({ t: "creer", reglages: REGLAGES });
  const code = (await X.attendre((m) => m.t === "salon" && m.salon))?.salon.code;
  Y.envoyer({ t: "rejoindre", code });
  await Y.attendre((m) => m.t === "debut" || (m.t === "salon" && m.salon?.joueurs.length === 2));
  X.envoyer({ t: "lancer" });
  const t0 = Date.now();
  await X.attendre((m) => m.t === "debut");
  X.envoyer({ t: "pret" });
  await jusqua(() => X.snaps.length > 0, 8000);
  const dt = Date.now() - t0;
  ok(X.snaps.length > 0 && dt >= 2500 && dt <= 4500, `Y ne dit jamais pret : le match démarre après chargementMs (${dt} ms, attendu ~3000)`);
  ok(Y.snaps.length > 0, "Y reçoit aussi ses instantanés (sans avoir dit pret)");

  titre("9. fin sans accord de revanche");
  X.envoyer({ t: "dev", action: "balle", p: [0, 2, 44], v: [0, 0, 32] });
  // attendre la phase de jeu (décompte 3 s) avant de forcer le but
  await jusqua(() => X.snaps.at(-1)?.snap.etat.phase === "enJeu", 8000);
  let but = null;
  for (let i = 0; i < 6 && !but; i++) {
    const m0 = X.marque();
    X.envoyer({ t: "dev", action: "balle", p: [0, 2, 44], v: [0, 0, 32] });
    but = await X.attendre((m) => m.t === "ev" && m.evenements.some((e) => e.e.t === "but"), 1500, m0);
  }
  ok(!!but, "but forcé dans la seconde partie");
  X.envoyer({ t: "dev", action: "chrono", tempsRestant: 0.5 });
  const fin = await X.attendre((m) => m.t === "fin", 20000);
  ok(!!fin, "fin du match");
  const tf = Date.now();
  X.envoyer({ t: "revanche", oui: true });
  const iX = X.marque();
  const retour = await X.attendre((m) => m.t === "salon" && m.salon?.phase === "salon", 9000, iX);
  const dr = Date.now() - tf;
  ok(!!retour && dr >= 4000 && dr <= 7500, `Y ne répond pas : retour au salon après revancheMs (${dr} ms, attendu ~5000)`);
  ok(retour?.salon.joueurs.length === 2 && retour.salon.joueurs.every((j) => j.connecte), "le salon retrouve ses deux joueurs");
  // l'hôte retourne au salon par retourSalon : démarrer, finir vite puis retourSalon (par un non-hôte : refus)
  X.envoyer({ t: "lancer" });
  await X.attendre((m) => m.t === "debut", 3000, iX);
  X.envoyer({ t: "pret" }); Y.envoyer({ t: "pret" });
  await jusqua(() => X.snaps.at(-1)?.snap.etat.phase === "enJeu", 8000);
  let but2 = null;
  for (let i = 0; i < 6 && !but2; i++) {
    const m0 = X.marque();
    X.envoyer({ t: "dev", action: "balle", p: [0, 2, 44], v: [0, 0, 32] });
    but2 = await X.attendre((m) => m.t === "ev" && m.evenements.some((e) => e.e.t === "but"), 1500, m0);
  }
  X.envoyer({ t: "dev", action: "chrono", tempsRestant: 0.5 });
  await X.attendre((m) => m.t === "fin", 20000, iX);
  const iY = Y.marque();
  Y.envoyer({ t: "retourSalon" });
  ok(!!(await Y.attendre((m) => m.t === "refus" && m.action === "retourSalon" && m.raison === "hote", 2000, iY)), "retourSalon par un non-hôte : refus{hote}");
  X.envoyer({ t: "retourSalon" });
  ok(!!(await Y.attendre((m) => m.t === "salon" && m.salon?.phase === "salon", 2000, iY)), "retourSalon par l'hôte : tout le monde au salon");
  // transfert d'hôte au salon
  const iY2 = Y.marque();
  X.envoyer({ t: "quitter" });
  const th = await Y.attendre((m) => m.t === "salon" && m.salon?.joueurs.length === 1, 2000, iY2);
  ok(th?.salon.joueurs[0].id === Y.id && th.salon.joueurs[0].hote, "l'hôte parti au salon : Y devient hôte");
  Y.fermer(); X.fermer();
}

if (process.env.ROCKET_SANS_LECTURE !== "0") {
  titre("10. un client qui ne lit pas (contre-pression)");
  // 3v3 pour grossir les instantanés (≈ 2,3 ko à 20 Hz)
  const P = client(SA, "Paul"), Q = client(SA, "Quentin");
  await accueilli(P, Q);
  P.envoyer({ t: "creer", reglages: { ...REGLAGES, format: "3v3" } });
  const code = (await P.attendre((m) => m.t === "salon" && m.salon))?.salon.code;
  Q.envoyer({ t: "rejoindre", code });
  await Q.attendre((m) => m.t === "session");
  P.envoyer({ t: "lancer" });
  await P.attendre((m) => m.t === "debut");
  P.envoyer({ t: "pret" }); Q.envoyer({ t: "pret" });
  await jusqua(() => Q.snaps.length > 2, 4000);
  const avant = await sante(SA);
  // Q arrête de lire : le noyau absorbe d'abord, puis le tampon du serveur dépasse 64 Ko et les instantanés (complets) sont sautés
  Q.ws._socket.pause();
  // il répond quand même au ping protocolaire (frame écrite sans rien lire) : sinon le serveur le coupe pour silence (10 s), pas pour saturation
  const vivant = setInterval(() => { try { Q.ws.pong(); } catch { /* socket coupée */ } }, 2000);
  const t0 = Date.now(), nP0 = P.snaps.length;
  let apres = avant;
  while (Date.now() - t0 < 20_000) {
    await attendre(250);
    apres = await sante(SA);
    if (apres.snapsSautes > avant.snapsSautes + 5) break;
  }
  const dtSaut = ((Date.now() - t0) / 1000).toFixed(1);
  ok(apres.snapsSautes > avant.snapsSautes, `les instantanés sont sautés quand le client ne lit pas (${apres.snapsSautes - avant.snapsSautes} sautés en ${dtSaut} s)`);
  ok(P.snaps.length > nP0 + 20, `le joueur qui lit continue de recevoir ses instantanés (${P.snaps.length - nP0} pendant ce temps)`);
  ok(apres.joueurs === avant.joueurs, "tant qu'il répond au ping protocolaire, le client qui ne lit pas n'est pas coupé");
  // il se tait aussi : socket terminée après socketMorteMs sans pong (ce qui borne le tampon du serveur)
  clearInterval(vivant);
  const t1 = Date.now();
  let coupe = false;
  while (Date.now() - t1 < 20_000) { await attendre(500); if ((await sante(SA)).joueurs < avant.joueurs) { coupe = true; break; } }
  const dtMort = (Date.now() - t1) / 1000;
  ok(coupe && dtMort >= 5 && dtMort <= 16, `puis, sans pong, la socket est terminée (${dtMort.toFixed(1)} s ; attendu ~${RESEAU.socketMorteMs / 1000} s)`);
  P.fermer(); Q.couper();
  await attendre(300);
}

// ====================================================================================================================================
// Serveur B : sans dev, plafonds réduits
// ====================================================================================================================================

titre("11. plafonds, énumération, flood, dev (serveur à plafonds réduits, sans dev)");
const SB = await lancerServeur({ PDJ_ROCKET_CONNEXIONS_IP: "6", PDJ_ROCKET_SALLES_IP: "2", PDJ_ROCKET_MATCHS_MAX: "1", PDJ_ROCKET_SALLES_MAX: "4", PDJ_ROCKET_CHARGEMENT_MS: "60000" });
{
  // dev refusé sans PDJ_ROCKET_DEV
  const D = client(SB, "Dev");
  await accueilli(D);
  D.envoyer({ t: "creer", reglages: REGLAGES });
  await D.attendre((m) => m.t === "salon" && m.salon);
  D.envoyer({ t: "dev", action: "chrono", tempsRestant: 1 });
  ok(!!(await D.attendre((m) => m.t === "refus" && m.action === "dev" && m.raison === "dev")), "dev sans PDJ_ROCKET_DEV : refus{dev}");
  D.fermer();
  await attendre(200);

  // salles par adresse : 2 par IP (la même adresse, plusieurs connexions)
  const IP = "203.0.113.9";
  const s1 = client(SB, "S1", { ip: `1.2.3.4, ${IP}` }), s2 = client(SB, "S2", { ip: `5.6.7.8, ${IP}` }), s3 = client(SB, "S3", { ip: IP });
  await accueilli(s1, s2, s3);
  s1.envoyer({ t: "creer", reglages: REGLAGES }); s2.envoyer({ t: "creer", reglages: REGLAGES });
  await s1.attendre((m) => m.t === "salon" && m.salon); await s2.attendre((m) => m.t === "salon" && m.salon);
  s3.envoyer({ t: "creer", reglages: REGLAGES });
  ok(!!(await s3.attendre((m) => m.t === "refus" && m.action === "creer" && m.raison === "limite")), "3e salle de la même adresse (le DERNIER élément de x-forwarded-for compte) : refus{limite}");
  const autre = client(SB, "Autre", { ip: "9.9.9.9" });
  await accueilli(autre);
  autre.envoyer({ t: "creer", reglages: REGLAGES });
  ok(!!(await autre.attendre((m) => m.t === "salon" && m.salon)), "une autre adresse peut créer sa salle (un premier élément forgé ne change rien)");

  // matchs simultanés : 1 au plus
  const codeS1 = s1.dernier("salon").salon.code;
  const t1 = client(SB, "T1", { ip: "9.9.9.1" });
  await accueilli(t1);
  t1.envoyer({ t: "rejoindre", code: codeS1 });
  await t1.attendre((m) => m.t === "session");
  s1.envoyer({ t: "lancer" });
  ok(!!(await s1.attendre((m) => m.t === "debut")), "premier match lancé");
  const codeS2 = s2.dernier("salon").salon.code;
  const t2 = client(SB, "T2", { ip: "9.9.9.2" });
  await accueilli(t2);
  t2.envoyer({ t: "rejoindre", code: codeS2 });
  await t2.attendre((m) => m.t === "session");
  s2.envoyer({ t: "lancer" });
  ok(!!(await s2.attendre((m) => m.t === "refus" && m.action === "lancer" && m.raison === "limite")), "second match simultané : refus{limite}");
  for (const c of [s1, s2, s3, autre, t1, t2]) c.fermer();
  await attendre(300);

  // énumération des codes : 20 essais erronés par minute et par adresse
  const E = client(SB, "Enum", { ip: "198.51.100.7" });
  await accueilli(E);
  const codes = [];
  const alpha = RESEAU.alphabetCode;
  for (let i = 0; codes.length < 25; i++) { const c = alpha[i % 20] + alpha[Math.floor(i / 20) % 20] + "BB" ; if (c !== "BBBB") codes.push(c); }
  const ie = E.marque();
  for (const c of codes) { E.envoyer({ t: "rejoindre", code: c }); await attendre(110); }   // 9 messages / s : sous la limite d'actions
  await attendre(300);
  const refus = E.apres(ie, "refus");
  const inconnues = refus.filter((r) => r.raison === "inconnue").length, limites = refus.filter((r) => r.raison === "limite").length;
  ok(inconnues === RESEAU.essaisCodeParMinute && limites >= 3, `énumération : ${inconnues} réponses « inconnue » puis refus{limite} (${limites} refus limite sur ${codes.length} essais)`);
  E.fermer();

  // flood : > 400 messages bruts en une seconde coupent la socket
  const F = client(SB, "Flood", { ip: "198.51.100.8" });
  await accueilli(F);
  for (let i = 0; i < 600; i++) F.envoyer({ t: "ping", c: i });
  await jusqua(() => F.fermeture, 3000);
  ok(F.fermeture?.code === L.CODE_FLOOD, `600 messages en rafale : fermeture 4002 (${stable(F.fermeture)})`);
  // débit d'actions élevé mais < 400 : excédent jeté, socket conservée
  const F2 = client(SB, "Rafale", { ip: "198.51.100.9" });
  await accueilli(F2);
  for (let i = 0; i < 100; i++) F2.envoyer({ t: "lister" });
  await attendre(400);
  F2.envoyer({ t: "ping", c: 5 });
  ok(!!(await F2.attendre((m) => m.t === "pong" && m.c === 5, 2000)) && !F2.fermeture, "100 lister en rafale : l'excédent est jeté, la socket reste ouverte");
  ok(F2.tous("liste").length < 100 && F2.tous("liste").length >= 20, `l'anti-flood a jeté l'excédent (${F2.tous("liste").length} listes servies sur 100)`);
  F2.fermer();

  // plafond de connexions par adresse : 6, la 7e est refusée (1013)
  const C = [];
  for (let i = 0; i < 6; i++) { const c = client(SB, `C${i}`, { ip: "192.0.2.77" }); C.push(c); await c.ouvert; }
  await attendre(100);
  const sept = client(SB, "C7", { ip: "192.0.2.77" });
  await sept.ouvert; await jusqua(() => sept.fermeture, 2000);
  ok(sept.fermeture?.code === L.CODE_TROP_DE_CONNEXIONS, `7e connexion de la même adresse : fermeture 1013 (${stable(sept.fermeture)})`);
  ok(C.every((c) => !c.fermeture), "les six premières restent ouvertes");
  for (const c of C) c.fermer();
  await attendre(200);
  // origine refusée
  const hs = await sante(SB);
  ok(typeof hs.connexions === "number", `/sante.rocket.connexions = ${hs.connexions}`);
}

// ====================================================================================================================================
// Serveur C : Rocket désactivé
// ====================================================================================================================================

titre("12. PDJ_ROCKET=off");
{
  const SC = await lancerServeur({ PDJ_ROCKET: "off" });
  const w = new WebSocket(SC.url);
  const res = await new Promise((r) => { w.on("unexpected-response", (_q, rep) => r(rep.statusCode)); w.on("open", () => r("ouvert")); w.on("error", () => r("erreur")); });
  ok(res === 404, `chemin /rocket désactivé : réponse HTTP 404 (${res})`);
  const arene = new WebSocket(`ws://localhost:${SC.port}`);
  const ouverte = await new Promise((r) => { arene.on("open", () => r(true)); arene.on("error", () => r(false)); });
  ok(ouverte, "l'arène répond toujours (même chemin « / »)");
  arene.close();
  SC.proc.kill();
}

// ====================================================================================================================================
// Serveur D : arrêt propre
// ====================================================================================================================================

titre("13. arrêt du serveur");
{
  const SD = await lancerServeur({});
  const a = client(SD, "Zoé");
  await accueilli(a);
  SD.proc.kill("SIGTERM");
  await jusqua(() => a.fermeture, 6000);
  ok(a.fermeture?.code === 1001, `SIGTERM : la socket Rocket est fermée 1001 (${stable(a.fermeture)})`);
}

// ====================================================================================================================================
// Bilan
// ====================================================================================================================================

{
  const final = await sante(SA);
  trace("sante finale du serveur A", stable(final));
  console.log(`\nServeur A : ticMaxMs=${final.ticMaxMs} ticsLents=${final.ticsLents} entreesTardives=${final.entreesTardives} entreesRepetees=${final.entreesRepetees} octetsEmis=${final.octetsEmis} octetsRecus=${final.octetsRecus} snapsSautes=${final.snapsSautes}`);
}
console.log(`\n${echecs === 0 ? "Tout est vert." : `${echecs} échec(s).`}`);
for (const s of serveurs) s.proc.kill();
process.exit(echecs === 0 ? 0 : 1);
