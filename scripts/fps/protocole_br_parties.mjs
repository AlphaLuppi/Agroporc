/**
 * Battle Royale, parties multiples, spectateur venu regarder et chat vocal : vérification AU NIVEAU DU PROTOCOLE contre le vrai serveur
 * (`serveur-fps`, construit puis lancé sur un port libre), sans navigateur. Cinq clients WebSocket : Alice et Bob lancent une partie ; Cora,
 * arrivée pendant le vol, la regarde (`regarder` → `spectateur`, snaps reçus sans y figurer, présence `spec`), sa voix n'est pas relayée à une
 * joueuse en vie (celle d'Alice à Bob, si), elle crée sa partie (`mode{br, partie:"nouvelle"}`, refusé tant qu'elle regarde), revient regarder
 * celle d'Alice, sa partie vide est refermée ; Dan crée une partie et Eve, arrivée ensuite, atterrit dans son lobby.
 * Usage : node scripts/fps/protocole_br_parties.mjs (Node 22). Spec : docs/superpowers/specs/2026-10-29-br-voix-parties-design.md
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

const port = await new Promise((r) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const build = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: join(RACINE, "serveur-fps"), encoding: "utf8" });
if (build.status !== 0) throw new Error(`build de serveur-fps en échec :\n${build.stdout}${build.stderr}`);
const serveur = spawn(process.execPath, ["dist/index.js"], {
  cwd: join(RACINE, "serveur-fps"), stdio: "ignore",
  env: {
    ...process.env, PORT: String(port), SCENE_JSON: join(RACINE, "public/agroparc/scene.json"), PDJ_FPS_BR_DECOMPTE_MS: "20000", PDJ_FPS_BR_VOL_MS: "60000",
    PDJ_FPS_CREATION_TIC_MAX_MS: "1000",   // un pic de CPU ne doit pas bloquer les créations du script
    PDJ_FPS_BR_STATS: join(mkdtempSync(join(tmpdir(), "pdj-br-parties-")), "stats-br.json"),
  },
});
process.on("exit", () => serveur.kill());
const URL = `ws://localhost:${port}`;
for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${port}/sante`).then((r) => r.ok, () => false)) break; await attendre(100); }

function client(pseudo) {
  const ws = new WebSocket(URL);
  const c = { ws, pseudo, recus: [], id: null };
  ws.on("message", (d) => { const m = JSON.parse(String(d)); c.recus.push(m); if (m.t === "bienvenue") c.id = m.id; });
  c.pret = new Promise((r) => ws.on("open", r)).then(() => ws.send(JSON.stringify({ t: "bonjour", v: 11, pseudo })));
  c.envoyer = (m) => ws.send(JSON.stringify(m));
  c.dernier = (t) => [...c.recus].reverse().find((m) => m.t === t);
  c.tous = (t) => c.recus.filter((m) => m.t === t);
  c.vider = () => { c.recus = []; };
  return c;
}
async function jusqua(f, ms = 8000) { const fin = Date.now() + ms; while (Date.now() < fin) { const r = f(); if (r) return r; await attendre(50); } return null; }

const A = client("Alice"), B = client("Bob"), C = client("Cora");
await Promise.all([A.pret, B.pret, C.pret]);
await jusqua(() => A.id && B.id && C.id);
for (const x of [A, B]) x.envoyer({ t: "mode", mode: "br" });
await jusqua(() => A.dernier("mode") && B.dernier("mode"));
ok(A.dernier("mode").partie === "br1" && B.dernier("mode").partie === "br1", `A et B dans br1 (${A.dernier("mode").partie}, ${B.dernier("mode").partie})`);
A.envoyer({ t: "lancerPartie" });
await jusqua(() => A.tous("br").some((m) => m.etat.phase === "decompte"));
for (const x of [A, B]) x.envoyer({ t: "rejoindre" });
await jusqua(() => A.tous("br").some((m) => m.etat.phase === "vol"), 15000);
ok(A.tous("br").some((m) => m.etat.phase === "vol"), "l'avion est parti");
// Cora arrive pendant la partie : la seule partie a de la place, elle y entre en attente
C.envoyer({ t: "mode", mode: "br" });
await jusqua(() => C.dernier("mode"));
ok(C.dernier("mode")?.partie === "br1", `Cora envoyée dans br1 (${JSON.stringify(C.dernier("mode"))})`);
await jusqua(() => C.dernier("salons")?.parties);
ok(C.dernier("salons")?.parties?.[0]?.hote === "Alice", `salons.parties : ${JSON.stringify(C.dernier("salons")?.parties)}`);
// elle regarde
C.vider();
C.envoyer({ t: "regarder" });
await jusqua(() => C.dernier("spectateur") || C.dernier("refus"));
ok(!!C.dernier("spectateur"), `regarder accepté (${JSON.stringify(C.dernier("refus"))})`);
await jusqua(() => C.tous("snap").length >= 2, 5000);
ok(C.tous("snap").length >= 2, `Cora reçoit les snaps (${C.tous("snap").length})`);
ok(C.tous("snap").every((s) => !s.j.some((e) => e.id === C.id)), "Cora n'est pas dans le snap");
const pres = await jusqua(() => C.tous("presence").map((p) => p.joueurs.find((j) => j.id === C.id)).filter(Boolean).find((j) => j.spec));
ok(!!pres && pres.enJeu, `présence de Cora : spectatrice (${JSON.stringify(pres)})`);
// voix : Cora (spectatrice) ne peut pas appeler Alice (en vie) ; Alice et Bob (en vie) si
for (const x of [A, B, C]) x.envoyer({ t: "voixActif", actif: true });
await attendre(300);
A.vider(); B.vider(); C.vider();
C.envoyer({ t: "voix", a: A.id, s: { type: "offre", sdp: "v=0" } });
A.envoyer({ t: "voix", a: B.id, s: { type: "offre", sdp: "v=0" } });
await attendre(500);
ok(!A.tous("voix").some((m) => m.de === C.id), "la voix d'une spectatrice n'est pas relayée à une joueuse en vie");
ok(B.tous("voix").some((m) => m.de === A.id), "la voix entre deux joueurs en vie est relayée");
// créer sa partie : refusé en jeu (spectatrice), accepté après `quitter`
C.envoyer({ t: "mode", mode: "br", partie: "nouvelle" });
await jusqua(() => C.dernier("refus"));
ok(C.dernier("refus")?.raison === "lobby", `créer en regardant : refus ${JSON.stringify(C.dernier("refus"))}`);
C.envoyer({ t: "quitter" });
await attendre(200);
C.vider();
C.envoyer({ t: "mode", mode: "br", partie: "nouvelle" });
await jusqua(() => C.dernier("mode"));
ok(C.dernier("mode")?.partie === "br2", `nouvelle partie : ${JSON.stringify(C.dernier("mode"))}`);
await jusqua(() => C.dernier("br")?.etat?.hote === C.id);
ok(C.dernier("br")?.etat?.hote === C.id && C.dernier("br")?.etat?.phase === "lobby", "Cora hôte du lobby de sa partie");
await jusqua(() => (C.dernier("salons")?.parties ?? []).length === 2, 3000);
ok((C.dernier("salons")?.parties ?? []).length === 2, `deux parties : ${JSON.stringify(C.dernier("salons")?.parties)}`);
// regarder une autre partie : retourner dans br1 puis regarder
C.vider();
C.envoyer({ t: "mode", mode: "br", partie: "br1" });
await jusqua(() => C.dernier("mode"));
ok(C.dernier("mode")?.partie === "br1", "retour dans br1");
C.envoyer({ t: "regarder" });
await jusqua(() => C.dernier("spectateur"));
ok(!!C.dernier("spectateur"), "regarde de nouveau br1");
await jusqua(() => (C.dernier("salons")?.parties ?? []).length === 1, 3000);
ok((C.dernier("salons")?.parties ?? []).length === 1, "la partie vide br2 est refermée");
// un nouvel arrivant atterrit dans un lobby s'il y en a un : Dan crée br3, Eve arrive → br3
const D = client("Dan"), E = client("Eve");
await Promise.all([D.pret, E.pret]); await jusqua(() => D.id && E.id);
D.envoyer({ t: "mode", mode: "br" }); await jusqua(() => D.dernier("mode"));
D.envoyer({ t: "quitter" });
D.vider(); D.envoyer({ t: "mode", mode: "br", partie: "nouvelle" }); await jusqua(() => D.dernier("mode"));
const pD = D.dernier("mode")?.partie;
E.envoyer({ t: "mode", mode: "br" }); await jusqua(() => E.dernier("mode"));
ok(pD && pD !== "br1" && E.dernier("mode")?.partie === pD, `Eve rejoint le lobby de Dan (${pD}, ${E.dernier("mode")?.partie})`);
for (const x of [A, B, C, D, E]) x.ws.close();
await attendre(300);
serveur.kill();
console.log(echecs ? `${echecs} échec(s)` : "tout est bon");
process.exit(echecs ? 1 : 0);
