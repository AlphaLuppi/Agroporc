/**
 * Parties parallèles (arène, zombies, Battle Royale) : vérification AU NIVEAU DU PROTOCOLE contre le vrai serveur (`serveur-fps`, construit puis
 * lancé sur un port libre), sans navigateur, en quelques secondes. Clients WebSocket nus. Scénarios (lot 1 de la spec) :
 *   1. zombies : A lance z1, B crée z2 (`mode{zombies, partie:"nouvelle"}`) et lance la sienne : deux `zombies{etat}` distincts ;
 *   2. arène : une arène créée (ar2), `partie:"auto"` dirige vers l'arène qui accueille, `rejoindre` refusé `plein` avec `alternative` ;
 *   3. Battle Royale : br1 et br2 en parallèle, E lance br1 pendant que br2 reste au lobby ;
 *   4. les parties vides sont refermées en moins de 2 s (`/sante.parties`) ;
 *   5. un client v10 joue comme avant l'arène et le BR (parties permanentes), les zombies lui sont fermés (`erreur{version}`) ; `/sante` garde ses champs plats ;
 *   6. dix créations en dix secondes par le même client : une seule passe, `refus{mode, limite}` pour les autres, sans tic lent.
 *   8. suspension de la partie de zombies (lot 2) : `pauseZ` fige tout pour tous, arrivant en pleine pause, compte à rebours, levée.
 *   9. Battle Royale seul avec bots (lot 3a) : `lancerPartie{}` donne 11 bots (ids `b<n>`, `bot: true` dans la présence), la partie atteint la fouille, les bots
 *      tirent sur le joueur (essai `agressif`), `/sante.br` ne compte que des humains, killcam, fin sans humain, bilan avec drapeau BOT, aucune statistique écrite.
 *  10. quota de bots global entre deux parties (br1 + br2 : `botsRestants` baisse, `refus{lancer, limite}`), br2 refermée au départ de son seul humain (quota rendu) ;
 *  11. (serveur à part, bots max 48) partie à 49 puis 50 membres humains + bots : le 51e reçoit `refus{mode, plein}` sans fermeture de socket ; une partie qui ne
 *      compte plus que des bots n'est plus tiquée (`/sante.sallesTiquees`).
 *  12. (lot 6, serveur à part : délai entre deux suspensions 1,5 s, compte à rebours 2,5 s) suspension : un `pauseZ{true}` pendant le compte à rebours l'annule UNE fois
 *      (le jeu reste figé après l'échéance d'origine), la seconde annulation est ignorée, le délai entre deux suspensions d'un même joueur est refusé (`refus{pause, limite}`) ;
 *  13. (lot 6) pause + coupure réseau de Pauline (`terminate`) : la partie reste suspendue, la reprise (`bonjour.reprise`) rend le même id et `zpause{actif:true}` puis un
 *      snap ; la suspension levée pendant qu'elle est coupée, sa reprise est dégelée (`zpause{actif:false}` après le `bienvenue`) ; reprise réseau dans une partie NON
 *      permanente (`z2` créée par le joueur) ;
 *  14. (lot 6, serveur à part : durée max de suspension 2,5 s, pause cumulée 3,8 s) plafonds de la pause : levée automatique avec compte à rebours non annulable, puis
 *      `refus{pause, limite}` quand le cumul est épuisé ; un joueur SEUL en est exempté (suspensions rapprochées, levée immédiate sans compte à rebours) ;
 *  15. (lot 6, serveur à part : une arène / une partie de zombies / une partie de BR de plus, total 3) plafonds de parties : la réserve d'un emplacement par mode laisse
 *      ouvrir `ar2`, `z2` et `br2` au-delà du total, une troisième partie du même mode est refusée (`refus{mode, limite}`).
 * Usage : node scripts/fps/protocole_parties.mjs (Node 22). Spec : docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(RACINE, "serveur-fps/package.json"));
const WebSocket = require("ws");
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const ok = (c, m) => { console.log(`${c ? "OK  " : "ÉCHEC"} ${m}`); if (!c) echecs++; };

/** Version du protocole des clients « à jour » du script (`VERSION_PROTOCOLE` = 11 depuis le lot 2 de la pause : les zombies sont fermés à la 10). */
const V_COURANTE = 11;
const V_ANCIENNE = 10;

const build = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: join(RACINE, "serveur-fps"), encoding: "utf8" });
if (build.status !== 0) throw new Error(`build de serveur-fps en échec :\n${build.stdout}${build.stderr}`);
const serveurs = new Set();
process.on("exit", () => { for (const s of serveurs) s.kill(); });
let port, serveur, URL;
const sante = () => fetch(`http://localhost:${port}/sante`).then((r) => r.json());
/** Lance un serveur neuf sur un port libre (les variables `port`, `serveur`, `URL` pointent ensuite sur lui) ; `extra` surcharge l'environnement. */
async function lancerServeur(extra = {}) {
  port = await new Promise((r) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  serveur = spawn(process.execPath, ["dist/index.js"], {
    cwd: join(RACINE, "serveur-fps"), stdio: "ignore",
    env: {
      ...process.env, PORT: String(port), SCENE_JSON: join(RACINE, "public/agroparc/scene.json"), PDJ_FPS_BR_DECOMPTE_MS: "20000", PDJ_FPS_BR_VOL_MS: "8000",
      // scénario 9 (bots) : chute courte, bilan court, bots déterministes (graine fixe, apparition près du joueur)
      PDJ_FPS_BR_ALTITUDE: "150", PDJ_FPS_BR_FIN_MS: "2000", PDJ_FPS_BR_BOTS_ESSAI: "agressif",
      // disjoncteur de création très haut : un pic de CPU de la machine de test ne doit pas faire échouer le script
      PDJ_FPS_CREATION_TIC_MAX_MS: "1000",
      PDJ_FPS_BR_STATS: join(mkdtempSync(join(tmpdir(), "pdj-parties-")), "stats-br.json"),
      ...extra,
    },
  });
  serveurs.add(serveur);
  URL = `ws://localhost:${port}`;
  for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${port}/sante`).then((r) => r.ok, () => false)) break; await attendre(100); }
}
await lancerServeur();

/** Adresse IP simulée des clients suivants (le serveur lit le dernier `x-forwarded-for`) : un scénario = une adresse, la rafale de créations est par adresse. */
let ipScenario = "10.0.0.1";
function client(pseudo, v = V_COURANTE, reprise = undefined) {
  const ws = new WebSocket(URL, { headers: { "x-forwarded-for": ipScenario } });
  const c = { ws, pseudo, recus: [], id: null, jeton: null };
  ws.on("message", (d) => { const m = JSON.parse(String(d)); c.recus.push(m); if (m.t === "bienvenue") { c.id = m.id; c.jeton = m.jeton ?? c.jeton; } });
  c.pret = new Promise((r) => ws.on("open", r)).then(() => ws.send(JSON.stringify({ t: "bonjour", v, pseudo, ...(reprise ? { reprise } : {}) })));
  c.envoyer = (m) => ws.send(JSON.stringify(m));
  c.dernier = (t) => [...c.recus].reverse().find((m) => m.t === t);
  c.tous = (t) => c.recus.filter((m) => m.t === t);
  c.vider = () => { c.recus = []; };
  return c;
}
async function jusqua(f, ms = 8000) { const fin = Date.now() + ms; while (Date.now() < fin) { const r = f(); if (r) return r; await attendre(50); } return null; }
async function connecter(...cs) { await Promise.all(cs.map((c) => c.pret)); await jusqua(() => cs.every((c) => c.id)); }
/** Demande un mode / une partie et attend l'écho `mode` ou un refus ; renvoie le message reçu. */
async function aller(c, mode, partie) {
  c.vider();
  c.envoyer({ t: "mode", mode, ...(partie ? { partie } : {}) });
  return jusqua(() => c.dernier("mode") ?? c.dernier("refus"));
}
async function fermer(...cs) { for (const c of cs) c.ws.close(1000); await attendre(150); }
const idsParties = async () => (await sante()).parties.map((p) => p.id);
async function attendreParties(ids, ms = 3000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (JSON.stringify(await idsParties()) === JSON.stringify(ids)) return true; await attendre(100); }
  return false;
}

// ---- état de départ ----
{
  const s = await sante();
  ok(JSON.stringify(s.parties.map((p) => p.id)) === JSON.stringify(["ar1", "z1", "br1"]), `trois parties permanentes au départ (${s.parties.map((p) => p.id)})`);
  ok(typeof s.joueurs === "number" && s.zombies && "enSuspens" in s.zombies && s.br && Array.isArray(s.br.parties), "/sante garde ses champs plats historiques");
}

// ---- 1. zombies : z1 et z2 en parallèle ----
{
  ipScenario = "10.0.1.1";
  const A = client("Alice"), B = client("Bob");
  await connecter(A, B);
  const ma = await aller(A, "zombies");
  ok(ma?.t === "mode" && ma.partie === "z1", `Alice dans z1 (${JSON.stringify(ma)})`);
  A.envoyer({ t: "lancerPartie" });
  const ea = await jusqua(() => A.dernier("zombies")?.etat?.phase === "pause" && A.dernier("zombies"));
  ok(!!ea, "z1 lancée : phase « pause » entre deux manches (décompte)");
  const mb = await aller(B, "zombies", "nouvelle");
  ok(mb?.t === "mode" && mb.partie === "z2", `Bob crée z2 (${JSON.stringify(mb)})`);
  await jusqua(() => B.dernier("zombies"));
  ok(B.dernier("zombies")?.etat?.phase === "lobby" && B.dernier("zombies")?.etat?.hote === B.id, "z2 au lobby, Bob hôte");
  B.envoyer({ t: "lancerPartie" });
  const eb = await jusqua(() => B.dernier("zombies")?.etat?.phase === "pause" && B.dernier("zombies"));
  ok(!!eb, "z2 lancée par Bob");
  const etatA = A.dernier("zombies").etat, etatB = B.dernier("zombies").etat;
  ok(etatA.hote === A.id && etatB.hote === B.id && etatA.hote !== etatB.hote, `deux parties séparées : hôtes ${etatA.hote} / ${etatB.hote}`);
  ok(etatA.joueurs.length === 1 && etatB.joueurs.length === 1 && etatA.joueurs[0].id !== etatB.joueurs[0].id, "chacune ne compte que son joueur");
  await jusqua(() => A.dernier("salons")?.listes?.zombies?.length === 2);
  const lz = A.dernier("salons")?.listes?.zombies ?? [];
  ok(lz.map((p) => p.id).join() === "z1,z2" && lz.every((p) => p.mode === "zombies" && p.capacite === 8), `salons.listes.zombies : ${JSON.stringify(lz.map((p) => [p.id, p.phase, p.joueurs]))}`);
  ok(A.dernier("salons")?.parties === undefined || A.dernier("salons").parties.every((p) => p.id.startsWith("br")), "salons.parties ne contient que du BR");
  await fermer(A, B);
  ok(await attendreParties(["ar1", "z1", "br1"]), "z2 refermée (vide) en moins de 3 s, z1 permanente reste");
}

// ---- 2. arène : ar1 / ar2, « auto », refus plein avec alternative ----
{
  ipScenario = "10.0.2.1";
  const Z = client("Zoe");
  await connecter(Z);
  const mz = await aller(Z, "arene", "nouvelle");
  ok(mz?.t === "mode" && mz.partie === "ar2", `Zoé crée ar2 (${JSON.stringify(mz)})`);
  // seize joueurs se mettent en jeu dans ar1
  const ar1 = Array.from({ length: 16 }, (_, i) => client(`Ar${String.fromCharCode(65 + i)}${"x".repeat(i % 3)}`));
  await connecter(...ar1);
  let rejoints = 0;
  for (const x of ar1) { x.envoyer({ t: "rejoindre" }); }
  await jusqua(() => ar1.every((x) => x.dernier("apparition") || x.dernier("refus")), 8000);
  rejoints = ar1.filter((x) => x.dernier("apparition")).length;
  ok(rejoints === 16, `seize joueurs en arène dans ar1 (${rejoints})`);
  // le 17e demande l'arène « auto » : ar1 est pleine EN JEU, ar2 accueille
  const T = client("Tess"), U = client("Uma");
  await connecter(T, U);
  const mt = await aller(T, "arene", "auto");
  ok(mt?.t === "mode" && mt.partie === "ar2", `« auto » dirige vers ar2 quand ar1 est pleine en jeu (${JSON.stringify(mt)})`);
  // l'autre rejoint directement dans ar1 (hall) : refus plein avec l'id d'une autre arène
  U.vider();
  U.envoyer({ t: "rejoindre" });
  const refus = await jusqua(() => U.dernier("refus"));
  ok(refus?.action === "rejoindre" && refus.raison === "plein" && refus.alternative === "ar2", `rejoindre refusé plein, alternative ar2 (${JSON.stringify(refus)})`);
  T.envoyer({ t: "rejoindre" });
  await jusqua(() => T.dernier("apparition") || T.dernier("refus"));
  ok(!!T.dernier("apparition"), "Tess apparaît dans ar2");
  // les deux arènes ne se voient pas
  const presT = T.dernier("presence")?.joueurs ?? T.dernier("bienvenue").joueurs;
  ok(!presT.some((j) => ar1.some((x) => x.id === j.id)), "ar2 ne voit pas les joueurs d'ar1");
  const pres1 = ar1[0].dernier("presence")?.joueurs ?? [];
  ok(!pres1.some((j) => j.id === T.id || j.id === Z.id), "ar1 ne voit pas ceux d'ar2");
  await fermer(Z, T, U, ...ar1);
  ok(await attendreParties(["ar1", "z1", "br1"]), "ar2 refermée (vide)");
}

// ---- 3. Battle Royale : br1 et br2 en parallèle ----
{
  ipScenario = "10.0.3.1";
  const E = client("Eve"), F = client("Fay"), G = client("Gus");
  await connecter(E, F, G);
  const me = await aller(E, "br");
  ok(me?.partie === "br1", `Eve dans br1 (${JSON.stringify(me)})`);
  const mf = await aller(F, "br", "nouvelle");
  ok(mf?.partie === "br2", `Fay crée br2 (${JSON.stringify(mf)})`);
  const mg = await aller(G, "br");
  ok(mg?.partie === "br1", `Gus (sans partie) rejoint le lobby le plus peuplé, br1 (${JSON.stringify(mg)})`);
  E.envoyer({ t: "lancerPartie" });
  await jusqua(() => E.tous("br").some((m) => m.etat.phase === "decompte"));
  ok(E.tous("br").some((m) => m.etat.phase === "decompte"), "br1 lancée (décompte)");
  await attendre(300);
  ok(F.dernier("br")?.etat?.phase === "lobby" && F.dernier("br")?.etat?.hote === F.id, "br2 reste au lobby, Fay hôte");
  await jusqua(() => F.dernier("salons")?.listes?.br?.length === 2);
  ok((F.dernier("salons")?.listes?.br ?? []).map((p) => p.id).join() === "br1,br2", `salons.listes.br : ${JSON.stringify((F.dernier("salons")?.listes?.br ?? []).map((p) => [p.id, p.phase]))}`);
  ok((F.dernier("salons")?.parties ?? []).map((p) => p.id).join() === "br1,br2", "salons.parties (clients v10) liste les parties BR");
  await fermer(E, F, G);
  ok(await attendreParties(["ar1", "z1", "br1"]), "br2 refermée, br1 permanente reste (sa partie vidée retourne au lobby)");
}

// ---- 5. ancien client (v10) : arène et Battle Royale comme avant (parties permanentes), zombies fermés (il ne gèle pas son horloge pendant une pause) ----
{
  ipScenario = "10.0.4.1";
  const V = client("Vieux", V_ANCIENNE), W = client("Neuf");
  await connecter(V, W);
  const mw = await aller(W, "zombies");
  ok(mw?.partie === "z1", "client récent dans z1");
  W.envoyer({ t: "lancerPartie" });
  await jusqua(() => W.dernier("zombies")?.etat?.phase === "pause");
  const mva = await aller(V, "arene");
  ok(mva?.t === "mode" && mva.mode === "arene" && (mva.partie === "ar1" || mva.partie === undefined), `client v10 : arène = ar1 (${JSON.stringify(mva)})`);
  const mvb = await aller(V, "br");
  ok(mvb?.t === "mode" && mvb.partie === "br1", `client v10 : Battle Royale (${JSON.stringify(mvb)})`);
  // les zombies lui sont fermés depuis la v11 : `erreur{version}` puis fermeture
  V.vider();
  V.envoyer({ t: "mode", mode: "zombies" });
  const err = await jusqua(() => V.dernier("erreur"));
  ok(err?.code === "version", `client v10 : zombies fermés, erreur{version} (${JSON.stringify(err)})`);
  await fermer(V, W);
  ok(await attendreParties(["ar1", "z1", "br1"]), "retour aux trois parties permanentes");
}

// ---- 6. créations en rafale ----
{
  ipScenario = "10.0.5.1";
  // z1 est occupée par une partie en cours (sinon `nouvelle` reprendrait z1, vide au lobby, sans rien créer)
  const Q = client("Quentin"), R = client("Rafale");
  await connecter(Q, R);
  await aller(Q, "zombies");
  Q.envoyer({ t: "lancerPartie" });
  await jusqua(() => Q.dernier("zombies")?.etat?.phase === "pause");
  let crees = 0, refus = 0;
  R.vider();
  for (let i = 0; i < 10; i++) {
    R.envoyer({ t: "mode", mode: "zombies", partie: "nouvelle" });
    await attendre(300);
    // retour à l'arène pour rejouer la création (sa partie vide est refermée, le délai de 10 s par client reste)
    R.envoyer({ t: "mode", mode: "arene" });
    await attendre(300);
  }
  crees = R.tous("mode").filter((m) => m.mode === "zombies" && m.partie && m.partie !== "z1").length;
  refus = R.tous("refus").filter((m) => m.action === "mode" && m.raison === "limite").length;
  ok(crees === 1, `dix demandes de création en ~6 s : une seule partie créée (${crees})`);
  ok(refus === 9, `les neuf autres : refus{mode, limite} (${refus})`);
  const s = await sante();
  // 60 ms : bien en dessous des 430 ms d'une grille de navigation calculée dans un tic, et insensible à la charge CPU de la machine de test
  ok(s.ticMaxMs <= 60, `aucun gel du tic pendant les créations (ticMaxMs ${s.ticMaxMs} ms)`);
  await fermer(Q, R);
  ok(await attendreParties(["ar1", "z1", "br1"]), "tout est refermé");
}

// ---- 7. limites de création : repli sur une partie en cours, reconnexions en boucle ----
{
  // (a) la création est impossible pour Bob (délai de 10 s) alors que toutes les parties de zombies sont en cours : `mode{zombies}` SANS `partie`
  // se rabat sur la première partie qui a de la place au lieu d'un `refus{limite}` sans issue ; seule la demande explicite de création est refusée
  ipScenario = "10.0.7.1";
  const Q = client("Quentin"), B = client("Bob"), C = client("Cleo");
  await connecter(Q, B, C);
  await aller(Q, "zombies");
  Q.envoyer({ t: "lancerPartie" });
  await jusqua(() => Q.dernier("zombies")?.etat?.phase === "pause");
  const mb = await aller(B, "zombies", "nouvelle");
  ok(/^z\d+$/.test(mb?.partie ?? "") && mb.partie !== "z1", `Bob crée une partie de plus (${JSON.stringify(mb)})`);
  B.envoyer({ t: "lancerPartie" });
  await jusqua(() => B.dernier("zombies")?.etat?.phase === "pause");
  const mc = await aller(C, "zombies", mb?.partie);
  ok(mc?.partie === mb?.partie, `Cleo rejoint la partie de Bob en cours (${JSON.stringify(mc)})`);
  await aller(B, "arene");
  const retour = await aller(B, "zombies");
  ok(retour?.t === "mode" && retour.partie === "z1", `création impossible (délai) : Bob, sans \`partie\`, est routé vers z1 en cours et non refusé (${JSON.stringify(retour)})`);
  await aller(B, "arene");
  const explicite = await aller(B, "zombies", "nouvelle");
  ok(explicite?.t === "refus" && explicite.raison === "limite", `\`partie:"nouvelle"\` explicite : refus{limite} (${JSON.stringify(explicite)})`);
  await fermer(Q, B, C);
  ok(await attendreParties(["ar1", "z1", "br1"]), "tout est refermé");

  // (b) une boucle connexion / bonjour / création / fermeture, une nouvelle connexion (donc un nouvel id) à chaque tour : la rafale par adresse
  // la borne à trois créations, ce que le délai par id de connexion ne faisait pas
  ipScenario = "10.0.7.2";
  const P = client("Pivot");
  await connecter(P);
  await aller(P, "zombies");
  P.envoyer({ t: "lancerPartie" });
  await jusqua(() => P.dernier("zombies")?.etat?.phase === "pause");
  let crees = 0, refus = 0;
  for (let i = 0; i < 6; i++) {
    const X = client(`Boucle${i}`);
    await connecter(X);
    const m = await aller(X, "zombies", "nouvelle");
    if (m?.t === "mode" && m.partie && m.partie !== "z1") crees++;
    if (m?.t === "refus" && m.raison === "limite") refus++;
    await fermer(X);
    await attendre(150);
  }
  ok(crees === 3 && refus === 3, `six reconnexions de la même adresse : trois créations, trois refus{limite} (${crees} / ${refus})`);
  await fermer(P);
  ok(await attendreParties(["ar1", "z1", "br1"]), "tout est refermé");
}

// ---- 8. suspension de la partie de zombies (pause pour tous, lot 2) ----
{
  ipScenario = "10.0.8.1";
  const A = client("Pauline"), B = client("Paul");
  await connecter(A, B);
  await aller(A, "zombies"); await aller(B, "zombies");
  A.envoyer({ t: "lancerPartie" });
  await jusqua(() => A.dernier("zombies")?.etat?.phase === "pause" && B.dernier("zombies")?.etat?.phase === "pause");
  A.envoyer({ t: "rejoindre" }); B.envoyer({ t: "rejoindre" });
  await jusqua(() => A.dernier("apparition") && B.dernier("apparition"));
  ok(A.dernier("zpause")?.actif === false && B.dernier("zpause")?.actif === false, "zpause{actif:false} après chaque bienvenue de la salle des zombies");
  await attendre(400);
  A.vider(); B.vider();
  A.envoyer({ t: "pauseZ", actif: true });
  const za = await jusqua(() => A.dernier("zpause")), zb = await jusqua(() => B.dernier("zpause"));
  ok(za?.actif === true && zb?.actif === true && za.par === A.id && za.pseudo === "Pauline", `zpause{actif:true} aux deux joueurs (${JSON.stringify(zb)})`);
  ok(za?.maintenant === zb?.maintenant, "même horloge virtuelle gelée pour tous");
  ok((await sante()).parties.find((p) => p.id === "z1")?.suspendue === true && (await sante()).zombies.suspendue === true, "/sante : z1 suspendue");
  // rien ne bouge pendant 2 s : aucun snap, aucun zombies{etat}, un pong à l'horloge gelée
  await attendre(250);
  A.vider(); B.vider();
  await attendre(2000);
  ok(A.tous("snap").length === 0 && B.tous("snap").length === 0 && B.tous("zombies").length === 0, "aucun snap ni zombies{etat} pendant la suspension");
  A.envoyer({ t: "ping", t0: 1 });
  const pong = await jusqua(() => A.dernier("pong"));
  ok(pong?.maintenant === za.maintenant, "pong : l'horloge virtuelle est gelée");
  // un tir est jeté
  A.envoyer({ t: "acheter", id: "mur:pompe" });
  await attendre(200);
  ok(!A.dernier("achat") && !A.dernier("argent"), "un achat pendant la suspension est jeté");
  // un nouveau venu pendant la pause : bienvenue puis zpause{actif:true}
  const C = client("Cora"); await connecter(C);
  C.vider(); C.envoyer({ t: "mode", mode: "zombies", partie: "z1" });
  const zc = await jusqua(() => C.dernier("zpause"));
  ok(zc?.actif === true && zc.maintenant === za.maintenant, `un arrivant en pleine pause reçoit zpause{actif:true} (${JSON.stringify(zc)})`);
  ok(C.recus.findIndex((m) => m.t === "bienvenue") < C.recus.findIndex((m) => m.t === "zpause"), "bienvenue AVANT zpause");
  // Cora n'est pas admise : refus{pause, inconnu}
  C.vider(); C.envoyer({ t: "pauseZ", actif: true });
  const rc = await jusqua(() => C.dernier("refus"));
  ok(rc?.action === "pause" && rc.raison === "inconnu", `non admise : refus{pause, inconnu} (${JSON.stringify(rc)})`);
  // B demande la levée : compte à rebours de 3 s (jeu encore figé), puis zpause{false}
  A.vider(); B.vider();
  B.envoyer({ t: "pauseZ", actif: false });
  const zcpt = await jusqua(() => A.dernier("zpause"));
  ok(zcpt?.actif === true && zcpt.compte > 2500 && zcpt.compte <= 3000, `compte à rebours de reprise (${JSON.stringify(zcpt)})`);
  const lev = await jusqua(() => A.dernier("zpause")?.actif === false && A.dernier("zpause"), 6000);
  ok(lev?.actif === false && lev.maintenant === za.maintenant, "levée à l'horloge virtuelle gelée, le jeu repart");
  await jusqua(() => A.dernier("snap"), 3000);
  ok(!!A.dernier("snap"), "les snaps reprennent");
  ok((await sante()).zombies.suspendue === false, "/sante : plus suspendue");
  await fermer(A, B, C);
  ok(await attendreParties(["ar1", "z1", "br1"]), "tout est refermé");
}

// ---- 9. Battle Royale seul avec bots (lot 3a) ----
{
  ipScenario = "10.0.9.1";
  const H = client("Hugo");
  await connecter(H);
  const mh = await aller(H, "br");
  ok(mh?.partie === "br1", `Hugo seul dans br1 (${JSON.stringify(mh)})`);
  await jusqua(() => (H.dernier("salons")?.listes?.br ?? [])[0]);
  const lb = (H.dernier("salons")?.listes?.br ?? [])[0];
  ok(lb?.botsMax === 20 && lb.botsRestants === 24, `salons.listes.br : botsMax ${lb?.botsMax}, botsRestants ${lb?.botsRestants}`);
  H.vider();
  H.envoyer({ t: "lancerPartie" });
  const lance = await jusqua(() => H.tous("br").find((m) => m.etat.phase === "decompte"));
  ok(!!lance && lance.etat.total === 12, `lancement seul : 12 partants (${lance?.etat?.total})`);
  const pres = H.dernier("presence")?.joueurs ?? [];
  const bots = pres.filter((j) => j.bot === true);
  ok(bots.length === 11 && bots.every((j) => /^b\d+$/.test(j.id)), `presence : 11 bots aux ids b<n> (${bots.length})`);
  ok(pres.find((j) => j.id === H.id)?.bot === undefined && lance.etat.hote === H.id, "Hugo est l'hôte et n'est pas un bot");
  const s1 = await sante();
  ok(s1.br.joueurs === 1 && s1.br.bots === 11, `/sante.br ne compte que des humains (joueurs ${s1.br.joueurs}, bots ${s1.br.bots})`);
  const pb = s1.parties.find((p) => p.id === "br1");
  ok(pb?.humains === 1 && pb.bots === 11, `/sante.parties : 1 humain, 11 bots (${JSON.stringify(pb)})`);
  // à bord, saut dès le départ de l'avion, atterrissage ; ensuite des états réguliers (sinon l'inactivité l'évince)
  H.envoyer({ t: "rejoindre" });
  await jusqua(() => H.dernier("br")?.etat?.phase === "vol", 15000);
  H.envoyer({ t: "sauter" });
  // parachute ouvert sous 90 m : ≈ 14 s de descente à 6,5 m/s
  const atterri = await jusqua(() => H.dernier("atterri"), 40000);
  ok(!!atterri, "Hugo a atterri");
  let seq = 0;
  const battement = setInterval(() => {
    if (atterri) H.envoyer({ t: "etat", seq: seq++, p: atterri.p, v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 });
  }, 100);
  const fouille = await jusqua(() => H.dernier("br")?.etat?.phase === "jeu", 15000);
  ok(!!fouille, "la partie atteint la fouille (phase jeu)");
  // les bots tirent sur lui : tir diffusé par un bot, dégâts reçus
  const degats = await jusqua(() => H.tous("degats").find((d) => d.cible === H.id && /^b\d+$/.test(d.par)), 40000);
  ok(!!degats, `dégâts reçus d'un bot (${JSON.stringify(degats)})`);
  ok(H.tous("tir").some((m) => /^b\d+$/.test(m.id) && typeof m.ts === "number"), "tirs de bots diffusés (ts renseigné)");
  const mort = await jusqua(() => H.tous("mort").find((m) => m.cible === H.id), 60000);
  ok(!!mort && /^b\d+$/.test(mort.par) && mort.tueur?.id === mort.par, `Hugo tué par un bot, killcam (${JSON.stringify(mort && { par: mort.par, tueur: mort.tueur?.pseudo })})`);
  // plus aucun humain en vie : la partie se termine 15 s plus tard avec bilan, sans statistique
  const fin = await jusqua(() => H.tous("br").find((m) => m.etat.phase === "fin" && m.etat.bilan), 30000);
  clearInterval(battement);
  // killcam puis spectateur : jamais de réapparition (mort définitive), les snaps continuent d'arriver à Hugo éliminé
  const iMort = H.recus.findIndex((m) => m.t === "mort" && m.cible === H.id);
  ok(iMort >= 0 && !H.recus.slice(iMort).some((m) => m.t === "apparition"), "éliminé par un bot : aucune réapparition (mort définitive, il regarde)");
  ok(H.recus.slice(iMort).some((m) => m.t === "snap"), "éliminé : les snaps continuent (spectateur)");
  ok(!!fin && fin.etat.nonComptee === true, "fin de partie : bilan, nonComptee");
  const lignes = fin?.etat?.bilan?.lignes ?? [];
  ok(lignes.filter((l) => l.bot === true).length === 11 && lignes.find((l) => l.id === H.id)?.bot === undefined, "bilan : 11 lignes BOT, la ligne d'Hugo n'en porte pas");
  const stats = await fetch(`http://localhost:${port}/stats-br`).then((r) => r.json());
  ok(Array.isArray(stats.lignes) && stats.lignes.length === 0, `aucune statistique écrite (${JSON.stringify(stats.lignes)})`);
  const retour = await jusqua(() => H.dernier("br")?.etat?.phase === "lobby", 8000);
  ok(!!retour, "retour au lobby");
  const s2 = await sante();
  ok(s2.br.bots === 0 && s2.br.joueurs === 1, `bots retirés au retour au lobby (${s2.br.bots})`);
  await fermer(H);
  ok(await attendreParties(["ar1", "z1", "br1"]), "tout est refermé");
}

// ---- 10. quota de bots GLOBAL et fermeture des parties, deux parties de Battle Royale (lot 3a, routage de index.ts) ----
{
  ipScenario = "10.0.10.1";
  const quota = (c) => c.dernier("salons")?.listes?.br ?? [];
  const parId = (c, id) => quota(c).find((p) => p.id === id);
  const H1 = client("Hector"); ipScenario = "10.0.10.2";
  const H2 = client("Helene"); ipScenario = "10.0.10.3";
  const H3 = client("Hugues");
  await connecter(H1, H2, H3);
  ok((await aller(H1, "br"))?.partie === "br1", "Hector dans br1");
  // les ids des parties créées ne sont jamais réutilisés (les scénarios précédents ont déjà consommé br2) : on lit celui que le serveur donne
  const m2 = await aller(H2, "br", "nouvelle"), br2 = m2?.partie;
  ok(m2?.t === "mode" && /^br\d+$/.test(br2) && br2 !== "br1", `Hélène crée sa partie ${br2} (${JSON.stringify(m2)})`);
  const m3 = await aller(H3, "br", "nouvelle"), br3 = m3?.partie;
  ok(m3?.t === "mode" && /^br\d+$/.test(br3) && ![ "br1", br2 ].includes(br3), `Hugues crée sa partie ${br3} (${JSON.stringify(m3)})`);
  // (a) le quota (24) se partage entre les parties : 12 + 12, le troisième lancement est refusé
  H1.envoyer({ t: "lancerPartie", bots: 12 });
  ok(!!(await jusqua(() => parId(H1, "br1")?.bots === 12 && parId(H1, "br1")?.botsRestants === 12)), `br1 lancée avec 12 bots : quota restant 12 (${JSON.stringify(parId(H1, "br1"))})`);
  H2.envoyer({ t: "lancerPartie", bots: 12 });
  ok(!!(await jusqua(() => parId(H1, br2)?.bots === 12 && parId(H1, "br1")?.botsRestants === 0)), `sa partie lancée avec 12 bots : quota épuisé, vu de br1 (${JSON.stringify(parId(H1, br2))})`);
  H3.vider(); H3.envoyer({ t: "lancerPartie", bots: 5 });
  const rl = await jusqua(() => H3.dernier("refus"));
  ok(rl?.action === "lancer" && rl.raison === "limite", `quota global épuisé : refus{lancer, limite} (${JSON.stringify(rl)})`);
  const sA = await sante();
  ok(sA.br.parties.length === 3 && sA.parties.find((p) => p.id === br2)?.bots === 12 && sA.parties.find((p) => p.id === "br1")?.bots === 12, "/sante.parties : bots de br1 et br2 comptés à part des humains");
  // (b) le seul humain de br2 (non permanente) part en pleine partie avec bots : br2 refermée, quota rendu
  await fermer(H2);
  let br2Fermee = false;
  for (const fin = Date.now() + 4000; Date.now() < fin && !br2Fermee; await attendre(100)) br2Fermee = !(await idsParties()).includes(br2);
  ok(br2Fermee, "partie 2 refermée au départ de son seul humain, bots compris");
  ok(!!(await jusqua(() => !parId(H1, br2) && parId(H1, "br1")?.botsRestants === 12)), `salons.listes.br : plus de br2, quota rendu (${JSON.stringify(quota(H1).map((p) => [p.id, p.botsRestants]))})`);
  // le quota rendu sert aussitôt : le lancement refusé plus haut passe
  H3.vider(); H3.envoyer({ t: "lancerPartie", bots: 5 });
  ok(!!(await jusqua(() => parId(H1, br3)?.bots === 5 && parId(H1, "br1")?.botsRestants === 7)), `quota rendu réutilisé : br3 lance 5 bots, restant 7 (${JSON.stringify(parId(H1, br3))})`);
  await fermer(H1, H3);
  ok(await attendreParties(["ar1", "z1", "br1"]), "tout est refermé (br3 fermée, br1 permanente gardée)");
}

// ---- 11. capacité d'une partie (humains + bots) et partie qui ne compte plus que des bots (lot 3a, serveur à part) ----
{
  for (const s of serveurs) s.kill();
  await lancerServeur({ PDJ_FPS_BR_BOTS_MAX: "48", PDJ_FPS_BR_BOTS_TOTAL: "100" });
  ipScenario = "10.0.11.1";
  const H = client("Hubert"); ipScenario = "10.0.11.2";
  const X = client("Xavier"), Y = client("Yvon");
  await connecter(H, X, Y);
  await aller(H, "br");
  H.envoyer({ t: "lancerPartie", bots: 48 });
  ok(!!(await jusqua(() => (H.dernier("salons")?.listes?.br ?? [])[0]?.bots === 48)), "br1 lancée avec 48 bots (1 humain + 48 bots = 49 membres)");
  const s1 = await sante();
  const p1 = s1.parties.find((p) => p.id === "br1");
  ok(p1?.joueurs === 49 && p1.humains === 1 && p1.bots === 48, `/sante.parties : 49 membres dont 1 humain (${JSON.stringify(p1)})`);
  ok(s1.sallesTiquees === 2, `une partie avec un humain est tiquée : ar1 + br1 (${s1.sallesTiquees})`);
  // le 50e membre entre : la place libre se compte bots compris
  const mx = await aller(X, "br", "br1");
  ok(mx?.t === "mode" && mx.partie === "br1", `le 50e membre est admis dans br1 (${JSON.stringify(mx)})`);
  ok((await sante()).parties.find((p) => p.id === "br1")?.joueurs === 50, "br1 à 50 membres");
  // le 51e : refus{mode, plein}, sa socket reste ouverte et il reste où il était (jamais erreur{plein} + fermeture)
  const my = await aller(Y, "br", "br1");
  ok(my?.t === "refus" && my.action === "mode" && my.raison === "plein", `le 51e reçoit refus{mode, plein} (${JSON.stringify(my)})`);
  await attendre(500);
  ok(Y.ws.readyState === WebSocket.OPEN && !Y.dernier("erreur"), "sa socket n'est pas fermée et aucune erreur ne lui est envoyée");
  // il ne reste que des bots : plus de tic pour la partie
  await fermer(H, X, Y);
  const fin = Date.now() + 4000; let s2 = await sante();
  while (Date.now() < fin && s2.sallesTiquees !== 1) { await attendre(100); s2 = await sante(); }
  const p2 = s2.parties.find((p) => p.id === "br1");
  ok(p2?.humains === 0 && s2.sallesTiquees === 1, `plus d'humain dans br1 : partie non tiquée, seule ar1 l'est (${JSON.stringify(p2)}, ${s2.sallesTiquees})`);
}


// ---- 12 à 14. suspension : annulation du compte à rebours, reprise réseau, plafonds (lot 6) ----
/** Deux (ou un) clients déjà dans la même partie de zombies : le premier est l'hôte, lance, tous rejoignent (états `pause` puis `apparition`). */
async function zombiesEnJeu(...cs) {
  cs[0].envoyer({ t: "lancerPartie" });
  await jusqua(() => cs.every((c) => c.dernier("zombies")?.etat?.phase === "pause"));
  for (const c of cs) c.envoyer({ t: "rejoindre" });
  await jusqua(() => cs.every((c) => c.dernier("apparition")));
  await attendre(400);
}
const sansSnap = (c) => c.tous("snap").length === 0 && c.tous("zombies").length === 0;
{
  for (const sv of serveurs) sv.kill();
  await lancerServeur({ PDJ_FPS_ZOMBIES_SUSPENSION_COOLDOWN_MS: "1500", PDJ_FPS_ZOMBIES_COMPTE_MS: "2500" });
  ipScenario = "10.0.12.1";
  const A = client("Pauline"), B = client("Paul");
  await connecter(A, B);
  await aller(A, "zombies"); await aller(B, "zombies");
  await zombiesEnJeu(A, B);

  // (a) annulation du compte à rebours
  A.vider(); B.vider();
  A.envoyer({ t: "pauseZ", actif: true });
  const z0 = await jusqua(() => B.dernier("zpause")?.actif === true && B.dernier("zpause"));
  ok(z0?.actif === true && z0.compte === undefined, `Pauline suspend (${JSON.stringify(z0)})`);
  await attendre(1700);                       // le délai entre deux actions d'un même joueur (1,5 s) est écoulé
  A.vider(); B.vider();
  B.envoyer({ t: "pauseZ", actif: false });
  const zc = await jusqua(() => A.dernier("zpause")?.compte > 0 && A.dernier("zpause"));
  ok(zc?.actif === true && zc.compte > 2000 && zc.compte <= 2500, `Paul lève : compte à rebours de 2,5 s, jeu encore figé (${JSON.stringify(zc)})`);
  await attendre(500);
  A.vider(); B.vider();
  A.envoyer({ t: "pauseZ", actif: true });    // Pauline remet la pause pendant le compte à rebours : annulation
  const za = await jusqua(() => B.dernier("zpause"));
  ok(za?.actif === true && za.compte === undefined && za.maintenant === z0.maintenant, `annulation : retour à la suspension pleine, même horloge (${JSON.stringify(za)})`);
  await attendre(3200);                       // l'échéance d'origine du compte à rebours est dépassée
  ok(!B.tous("zpause").some((m) => m.actif === false), "le compte à rebours annulé n'a pas levé la suspension à son échéance");
  ok(sansSnap(B) && sansSnap(A), "aucun snap ni zombies{etat} après l'échéance d'origine : le jeu est toujours figé");
  // seconde levée, seconde annulation : ignorée, la levée a lieu au bout du compte à rebours
  A.vider(); B.vider();
  B.envoyer({ t: "pauseZ", actif: false });
  await jusqua(() => A.dernier("zpause")?.compte > 0);
  await attendre(600);
  A.envoyer({ t: "pauseZ", actif: true });
  const lev = await jusqua(() => A.dernier("zpause")?.actif === false && A.dernier("zpause"), 5000);
  ok(lev?.actif === false && lev.maintenant === z0.maintenant, `la seconde annulation est ignorée : levée à l'horloge gelée (${JSON.stringify(lev)})`);
  // le délai entre deux suspensions d'un même joueur : la levée vient d'avoir lieu, Pauline ne peut pas resuspendre aussitôt
  A.vider();
  A.envoyer({ t: "pauseZ", actif: true });
  const rl = await jusqua(() => A.dernier("refus"));
  ok(rl?.action === "pause" && rl.raison === "limite", `resuspendre dans le délai : refus{pause, limite} (${JSON.stringify(rl)})`);
  ok((await sante()).zombies.suspendue === false, "/sante : plus suspendue");

  // (b) coupure réseau de Pauline pendant la pause : la partie reste suspendue, sa reprise la retrouve figée
  await attendre(1700);
  A.vider(); B.vider();
  A.envoyer({ t: "pauseZ", actif: true });
  const zs = await jusqua(() => B.dernier("zpause")?.actif === true && B.dernier("zpause"));
  const idA = A.id, jetonA = A.jeton;
  ok(!!zs && !!jetonA, `Pauline suspend une seconde fois (jeton de reprise reçu : ${!!jetonA})`);
  A.ws.terminate();
  await attendre(1000);
  const s1 = await sante();
  ok(s1.parties.find((p) => p.id === "z1")?.suspendue === true && s1.zombies.enSuspens >= 1, `coupée : z1 reste suspendue, une session en suspens (${s1.zombies.enSuspens})`);
  B.vider();
  await attendre(1500);
  ok(sansSnap(B), "pendant la coupure de Pauline, rien ne bouge chez Paul");
  const A2 = client("Pauline", V_COURANTE, { id: idA, jeton: jetonA });
  await connecter(A2);
  const bv = A2.dernier("bienvenue");
  ok(bv?.reprise === true && A2.id === idA, `reprise réseau : même identifiant ${idA}, bienvenue{reprise} (${bv?.reprise})`);
  const zr = await jusqua(() => A2.dernier("zpause"));
  ok(zr?.actif === true && zr.maintenant === zs.maintenant, `reprise pendant la pause : zpause{actif:true} à l'horloge gelée (${JSON.stringify(zr)})`);
  ok(A2.recus.findIndex((m) => m.t === "bienvenue") < A2.recus.findIndex((m) => m.t === "zpause"), "bienvenue AVANT zpause");
  await jusqua(() => A2.dernier("snap") && A2.dernier("zombies"));
  ok(!!A2.dernier("snap") && !!A2.dernier("zombies")?.etat?.joueurs?.some((j) => j.id === idA), "un snap et un zombies{etat} ciblés : la partie n'est pas une carte vide");
  // elle se coupe de nouveau ; Paul suspend (le délai de Paul est écoulé), puis lève pendant qu'elle est hors ligne : sa reprise est dégelée
  A2.ws.terminate();
  await attendre(500);
  B.vider();
  B.envoyer({ t: "pauseZ", actif: false });
  const lev2 = await jusqua(() => B.dernier("zpause")?.actif === false && B.dernier("zpause"), 6000);
  ok(!!lev2, "Paul lève la suspension pendant que Pauline est coupée");
  const A3 = client("Pauline", V_COURANTE, { id: idA, jeton: A2.jeton });
  await connecter(A3);
  const zd = await jusqua(() => A3.dernier("zpause"));
  ok(A3.id === idA && zd?.actif === false, `reprise après la levée : zpause{actif:false}, jamais figée (${JSON.stringify(zd)})`);
  ok(!!(await jusqua(() => A3.dernier("snap"))), "les snaps reprennent pour elle");
  await fermer(A3, B);
  ok(await attendreParties(["ar1", "z1", "br1"]), "tout est refermé");

  // (c) reprise réseau dans une partie NON permanente : le joueur seul de z2 retrouve z2 (jamais l'état d'une autre partie)
  ipScenario = "10.0.12.2";
  const C = client("Cora");
  await connecter(C);
  // un autre joueur occupe z1 (une partie vide qui accueille serait reprise avant d'en créer une nouvelle) : Cora doit créer SA partie
  const D = client("Dora");
  await connecter(D);
  await aller(D, "zombies");
  const mc = await aller(C, "zombies", "nouvelle");
  ok(/^z\d+$/.test(mc?.partie ?? "") && mc.partie !== "z1", `Cora crée sa partie ${mc?.partie}`);
  await zombiesEnJeu(C);
  const idC = C.id, jetonC = C.jeton;
  C.ws.terminate();
  await attendre(1200);
  const s2 = await sante();
  ok(s2.parties.some((p) => p.id === mc?.partie), `${mc?.partie} n'est pas refermée tant que la reprise est possible (${JSON.stringify(s2.parties.map((p) => p.id))})`);
  const C2 = client("Cora", V_COURANTE, { id: idC, jeton: jetonC });
  await connecter(C2);
  const ez = await jusqua(() => C2.dernier("zombies")?.etat && C2.dernier("zombies"));
  ok(C2.id === idC && C2.dernier("bienvenue")?.reprise === true && ez?.etat?.hote === idC && ez.etat.joueurs.length === 1, `Cora retrouve SA partie ${mc?.partie} (hôte ${ez?.etat?.hote})`);
  const s3 = await sante();
  ok(s3.parties.find((p) => p.id === mc?.partie)?.humains === 1 && s3.parties.find((p) => p.id === "z1")?.humains === 1, "z1 n'a pas reçu Cora (Dora y est seule)");
  await fermer(C2, D);
  ok(await attendreParties(["ar1", "z1", "br1"]), "tout est refermé (la partie de Cora aussi)");
}

{
  // plafonds de la pause : une suspension dure 2,5 s au plus (levée automatique, compte à rebours de 1,5 s non annulable), 3,8 s de pause cumulée par partie
  for (const sv of serveurs) sv.kill();
  await lancerServeur({
    PDJ_FPS_ZOMBIES_SUSPENSION_MAX_MS: "2500", PDJ_FPS_ZOMBIES_COMPTE_MS: "1500", PDJ_FPS_ZOMBIES_SUSPENSION_COOLDOWN_MS: "500", PDJ_FPS_ZOMBIES_SUSPENSION_TOTAL_MS: "3800",
  });
  ipScenario = "10.0.14.1";
  const A = client("Pia"), B = client("Pablo");
  await connecter(A, B);
  await aller(A, "zombies"); await aller(B, "zombies");
  await zombiesEnJeu(A, B);
  A.vider(); B.vider();
  A.envoyer({ t: "pauseZ", actif: true });
  await jusqua(() => B.dernier("zpause")?.actif === true);
  const auto = await jusqua(() => B.dernier("zpause")?.compte > 0 && B.dernier("zpause"), 6000);
  ok(auto?.actif === true && auto.compte > 1000 && auto.compte <= 1500, `durée maximale atteinte : compte à rebours automatique (${JSON.stringify(auto)})`);
  await attendre(700);
  A.vider(); B.vider();
  A.envoyer({ t: "pauseZ", actif: true });          // annulation tentée : le compte à rebours est forcé
  await attendre(400);
  ok(!A.tous("zpause").some((m) => m.actif === true && m.compte === undefined), "le compte à rebours forcé (durée maximale) ne s'annule pas");
  const fin = await jusqua(() => B.dernier("zpause")?.actif === false && B.dernier("zpause"), 4000);
  ok(!!fin, "levée automatique à la fin du compte à rebours");
  // la pause cumulée (≈ 4 s) dépasse 3,8 s : plus de suspension possible dans cette partie
  await attendre(700);
  A.vider();
  A.envoyer({ t: "pauseZ", actif: true });
  const lim = await jusqua(() => A.dernier("refus"));
  ok(lim?.action === "pause" && lim.raison === "limite", `pause cumulée épuisée : refus{pause, limite} (${JSON.stringify(lim)})`);
  await fermer(A, B);
  ok(await attendreParties(["ar1", "z1", "br1"]), "tout est refermé");

  // un joueur SEUL est exempté : suspensions rapprochées, levée immédiate (aucun compte à rebours), aucune durée maximale
  ipScenario = "10.0.14.2";
  const S = client("Solo");
  await connecter(S);
  await aller(S, "zombies");
  await zombiesEnJeu(S);
  S.vider();
  S.envoyer({ t: "pauseZ", actif: true });
  const s1 = await jusqua(() => S.dernier("zpause")?.actif === true && S.dernier("zpause"));
  S.vider();
  S.envoyer({ t: "pauseZ", actif: false });
  const l1 = await jusqua(() => S.dernier("zpause")?.actif === false && S.dernier("zpause"), 1000);
  ok(!!s1 && !!l1 && l1.compte === undefined, `seul : suspension puis levée immédiate, sans compte à rebours (${JSON.stringify(l1)})`);
  S.vider();
  S.envoyer({ t: "pauseZ", actif: true });          // aussitôt (pas de délai de 0,5 s), puis plus longtemps que la durée maximale (2,5 s)
  const s2 = await jusqua(() => S.dernier("zpause")?.actif === true && S.dernier("zpause"));
  ok(!!s2 && !S.dernier("refus"), `seul : une seconde suspension immédiate, jamais de refus (${JSON.stringify(S.dernier("refus"))})`);
  await attendre(4000);
  ok(!S.tous("zpause").some((m) => m.actif === false), "seul : pas de levée automatique après la durée maximale");
  S.envoyer({ t: "pauseZ", actif: false });
  ok(!!(await jusqua(() => S.dernier("zpause")?.actif === false, 1500)), "seul : la levée reste immédiate");
  await fermer(S);
  ok(await attendreParties(["ar1", "z1", "br1"]), "tout est refermé");
}

// ---- 15. plafonds de parties : la réserve d'un emplacement par mode (lot 6) ----
{
  for (const sv of serveurs) sv.kill();
  await lancerServeur({
    PDJ_FPS_ARENE_PARTIES: "2", PDJ_FPS_ZOMBIES_PARTIES: "2", PDJ_FPS_BR_PARTIES: "2", PDJ_FPS_PARTIES_TOTAL: "3", PDJ_FPS_CREATION_DELAI_MS: "0", PDJ_FPS_PARTIES_PAR_IP: "10",
  });
  ipScenario = "10.0.15.1";
  const Xs = ["Xa", "Xb", "Xc", "Xd", "Xe", "Xf", "Xg", "Xh"].map((n) => client(n));
  await connecter(...Xs);
  // une partie vide qui accueille est reprise avant d'en créer une : on occupe z1 et br1 (ar1, le hall, l'est déjà par les clients eux-mêmes)
  await aller(Xs[6], "zombies"); await aller(Xs[7], "br");
  // total 3 = les trois permanentes : chaque mode garde pourtant sa réserve d'une partie de plus
  const [a2, z2, b2] = [await aller(Xs[0], "arene", "nouvelle"), await aller(Xs[1], "zombies", "nouvelle"), await aller(Xs[2], "br", "nouvelle")];
  ok(a2?.partie === "ar2" && /^z\d+$/.test(z2?.partie ?? "") && z2.partie !== "z1" && /^br\d+$/.test(b2?.partie ?? "") && b2.partie !== "br1", `une partie de plus par mode malgré le total atteint : ${a2?.partie}, ${z2?.partie}, ${b2?.partie}`);
  const total = (await sante()).parties.length;
  ok(total === 6, `six parties ouvertes (total 3 + réserve de 3) : ${total}`);
  // une troisième partie du même mode : plafond du mode atteint
  const [a3, z3, b3] = [await aller(Xs[3], "arene", "nouvelle"), await aller(Xs[4], "zombies", "nouvelle"), await aller(Xs[5], "br", "nouvelle")];
  ok([a3, z3, b3].every((m) => m?.t === "refus" && m.action === "mode" && m.raison === "limite"), `troisième partie de chaque mode : refus{mode, limite} (${JSON.stringify([a3, z3, b3].map((m) => m?.raison))})`);
  // sans `partie`, un client est routé vers une partie existante plutôt que refusé
  const sans = await aller(Xs[0], "zombies");
  ok(sans?.t === "mode" && /^z\d+$/.test(sans.partie ?? ""), `sans \`partie\` : routé vers une partie existante (${JSON.stringify(sans)})`);
  await fermer(...Xs);
  ok(await attendreParties(["ar1", "z1", "br1"]), "toutes les parties créées sont refermées");
}

for (const s of serveurs) s.kill();
console.log(echecs ? `${echecs} échec(s)` : "tout est bon");
process.exit(echecs ? 1 : 0);
