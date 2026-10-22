/**
 * Serveur temps réel de l'arène FPS (vue Palantir) : HTTP `GET /sante` + WebSocket sur le même port,
 * une salle unique. Toute la logique de jeu est dans lib/fps/match.ts (pur) ; ce fichier ne fait que
 * l'I/O : connexions, anti-flood, origines, ping, boucle de tic à 60 Hz.
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { SceneData } from "../../lib/agroparc3d/types";
import { construireMonde, pointsApparition } from "../../lib/fps/collision";
import { Salle, type Sortie } from "../../lib/fps/match";
import { VERSION_PROTOCOLE, type MessageClient, type MessageServeur } from "../../lib/fps/protocole";

const PORT = Number(process.env.PORT) || 8787;
const TIC_MS = 1000 / 60;
const TAILLE_MAX_OCTETS = 4096;
const MESSAGES_PAR_SECONDE_MAX = 90;
const PING_MS = 5_000;
/** Un client qui n'absorbe plus ce qu'on lui envoie est coupé (connexion saturée). */
const TAMPON_MAX_OCTETS = 512 * 1024;
/** Origines autorisées (`ORIGINES`, séparées par des virgules ; `*` = n'importe quelle suite de caractères hors « / », pour les previews Vercel). */
const ORIGINES = (process.env.ORIGINES ?? "").split(",").map((o) => o.trim()).filter(Boolean)
  .map((o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`));

function cheminScene(): string {
  const candidats = [
    process.env.SCENE_JSON,
    resolve(process.cwd(), "../public/agroparc/scene.json"),
    resolve(process.cwd(), "public/agroparc/scene.json"),
    resolve(process.cwd(), "scene.json"),
  ].filter((c): c is string => !!c);
  const trouve = candidats.find((c) => existsSync(c));
  if (!trouve) throw new Error(`scene.json introuvable (SCENE_JSON). Essayé : ${candidats.join(", ")}`);
  return trouve;
}

const fichierScene = cheminScene();
const scene = JSON.parse(readFileSync(fichierScene, "utf8")) as SceneData;
const monde = construireMonde(scene);
const apparitions = pointsApparition(scene, monde);
const salle = new Salle(monde, apparitions, Math.random, Date.now());

interface Client {
  id: string;
  ws: WebSocket;
  /** « bonjour » reçu et accepté */
  inscrit: boolean;
  vivant: boolean;
  pingEnvoyeA: number;
  fenetreDebut: number;
  fenetreNb: number;
}
const clients = new Map<string, Client>();

function envoyer(c: Client, texte: string): void {
  if (c.ws.readyState !== c.ws.OPEN) return;
  if (c.ws.bufferedAmount > TAMPON_MAX_OCTETS) { c.ws.terminate(); return; }
  c.ws.send(texte);
}

/** Route les sorties de la salle ; une erreur adressée à un client le déconnecte après envoi. */
function diffuser(sorties: Sortie[]): void {
  for (const s of sorties) {
    const texte = JSON.stringify(s.m);
    if (s.a === "tous") {
      for (const c of clients.values()) if (c.inscrit && c.id !== s.sauf) envoyer(c, texte);
      continue;
    }
    const c = clients.get(s.a);
    if (!c) continue;
    envoyer(c, texte);
    if (s.m.t === "erreur") c.ws.close(1008, s.m.code);
  }
}

function refuser(c: Client, code: Extract<MessageServeur, { t: "erreur" }>["code"], message: string): void {
  envoyer(c, JSON.stringify({ t: "erreur", code, message } satisfies MessageServeur));
  c.ws.close(1008, code);
}

function traiter(c: Client, brut: string): void {
  let msg: unknown;
  try { msg = JSON.parse(brut); } catch { return; }
  if (!msg || typeof msg !== "object" || typeof (msg as { t?: unknown }).t !== "string") return;
  const m = msg as MessageClient;
  const maintenant = Date.now();
  if (!c.inscrit) {
    if (m.t !== "bonjour") return;
    if (m.v !== VERSION_PROTOCOLE) return refuser(c, "version", "Version du protocole incompatible : rechargez la page.");
    const sorties = salle.connecter(c.id, typeof m.pseudo === "string" ? m.pseudo : "", maintenant);
    c.inscrit = !sorties.some((s) => s.a === c.id && s.m.t === "erreur");
    diffuser(sorties);
    if (c.inscrit) console.log(`+ ${salle.inspecter(c.id)?.pseudo} (${salle.nombreJoueurs()} en ligne)`);
    return;
  }
  if (m.t === "bonjour") return;
  diffuser(salle.recevoir(c.id, m, maintenant));
}

const http = createServer((req, res) => {
  if (req.method === "GET" && req.url?.split("?")[0] === "/sante") {
    const corps = JSON.stringify({ ok: true, joueurs: salle.nombreJoueurs(), enJeu: salle.nombreEnJeu(), match: salle.infoMatch().numero });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(corps);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Introuvable");
});

const wss = new WebSocketServer({
  server: http,
  maxPayload: TAILLE_MAX_OCTETS,
  verifyClient: ({ origin }: { origin: string }) => ORIGINES.length === 0 || ORIGINES.some((o) => o.test(origin)),
});

wss.on("connection", (ws) => {
  const c: Client = { id: randomUUID(), ws, inscrit: false, vivant: true, pingEnvoyeA: Date.now(), fenetreDebut: Date.now(), fenetreNb: 0 };
  clients.set(c.id, c);
  // un client qui ne dit pas « bonjour » dans les 10 s est libéré
  setTimeout(() => { if (!c.inscrit && ws.readyState === ws.OPEN) ws.close(1008, "bonjour attendu"); }, 10_000).unref();
  ws.ping(); // première mesure de latence tout de suite
  ws.on("pong", () => {
    c.vivant = true;
    if (c.inscrit) salle.majPing(c.id, Date.now() - c.pingEnvoyeA);
  });
  ws.on("message", (donnees, binaire) => {
    if (binaire) return;
    const maintenant = Date.now();
    if (maintenant - c.fenetreDebut >= 1000) { c.fenetreDebut = maintenant; c.fenetreNb = 0; }
    if (++c.fenetreNb > MESSAGES_PAR_SECONDE_MAX) return refuser(c, "flood", "Trop de messages.");
    try { traiter(c, donnees.toString()); } catch (e) { console.error("message:", e); }
  });
  ws.on("close", () => {
    clients.delete(c.id);
    if (!c.inscrit) return;
    const pseudo = salle.inspecter(c.id)?.pseudo;
    try { diffuser(salle.deconnecter(c.id, Date.now())); } catch (e) { console.error("déconnexion:", e); }
    console.log(`- ${pseudo} (${salle.nombreJoueurs()} en ligne)`);
  });
  ws.on("error", () => ws.terminate());
});

// Connexions mortes : un client qui n'a pas répondu au ping précédent est fermé.
const timerPing = setInterval(() => {
  for (const c of clients.values()) {
    if (!c.vivant) { c.ws.terminate(); continue; }
    c.vivant = false;
    c.pingEnvoyeA = Date.now();
    c.ws.ping();
  }
}, PING_MS);

const timerTic = setInterval(() => {
  try { diffuser(salle.tic(Date.now())); } catch (e) { console.error("tic:", e); }
}, TIC_MS);

http.listen(PORT, "0.0.0.0", () => {
  console.log(`Arène FPS : ws://0.0.0.0:${PORT} (scène ${fichierScene}, ${apparitions.length} points d'apparition, origines : ${ORIGINES.join(", ") || "toutes"})`);
});

function arreter(): void {
  clearInterval(timerPing);
  clearInterval(timerTic);
  for (const c of clients.values()) c.ws.close(1001, "arrêt du serveur");
  wss.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", arreter);
process.on("SIGINT", arreter);
