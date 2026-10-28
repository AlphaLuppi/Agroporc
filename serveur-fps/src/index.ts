/**
 * Serveur temps réel de l'arène FPS (vue Palantir) : HTTP `GET /sante` + WebSocket sur le même port,
 * deux salles (v6) : l'arène « chacun pour soi » (avion et tigres largués compris) et les zombies tigres (coopératif par manches). Toute la
 * logique de jeu est dans lib/fps/match.ts et match-zombies.ts (purs) ; ce fichier ne fait que l'I/O : connexions, anti-flood (lib/fps/anti-flood.ts :
 * l'excédent est jeté, la socket n'est coupée que pour un flood réel), origines, ping, boucle de tic à 60 Hz, routage du message `mode`
 * (changement de salle), résumé `salons` et (v8) reprise d'une partie de zombies après une micro-coupure (`REPRISE_MS`).
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md (v1), 2026-10-22-arene-v2-design.md (v2),
 * 2026-10-23-arene-tigres-design.md (v5 : avion, tigres largués, sort d'invocation), 2026-10-27-arene-zombies-design.md (v6)
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { lireCachettes, type FichierCachettes } from "../../lib/agroparc3d/cachettes";
import type { SceneData } from "../../lib/agroparc3d/types";
import { admettre, creerEtatFlood, type EtatFlood } from "../../lib/fps/anti-flood";
import { construireCircuits, flotte } from "../../lib/fps/circulation";
import { construireMonde, pointsApparition } from "../../lib/fps/collision";
import { ipClient } from "../../lib/fps/ip-client";
import { Salle, type OptionsSalle, type Sortie } from "../../lib/fps/match";
import { VERSION_PROTOCOLE, type MessageClient, type MessageServeur } from "../../lib/fps/protocole";
import { decisionMode, messageSalons } from "../../lib/fps/salons";
import { capDeCachette } from "../../lib/fps/tigre-arene";
import { DEPARTS, construireMondeZombies, donneesZombies } from "../../lib/fps/zombies-carte";
import { EMPLACEMENTS_VOITURES, ROND_POINT, ZONE_APPARITION, positionElsa, trouverRondPoint } from "../../lib/fps/zones";

const PORT = Number(process.env.PORT) || 8787;
const TIC_MS = 1000 / 60;
/** 16 ko : une offre SDP du chat vocal (candidats ICE compris) dépasse parfois 4 ko ; les autres messages restent bien en dessous. */
const TAILLE_MAX_OCTETS = 16_384;
const PING_MS = 5_000;
/**
 * (v8) Un membre de la salle des zombies dont la connexion se ferme est gardé ce délai (ms) : le client qui se reconnecte avec son jeton
 * (`bonjour.reprise`) retrouve sa partie, même identifiant, même position ; au-delà, il est déconnecté pour de bon.
 */
const REPRISE_MS = 20_000;
/** Un client qui n'absorbe plus ce qu'on lui envoie est coupé (connexion saturée). */
const TAMPON_MAX_OCTETS = 512 * 1024;
/** Connexions simultanées par adresse IP (bureau derrière une même IP : large) ; la suivante est refusée (1013) sans toucher à la salle. */
const CONNEXIONS_PAR_IP_MAX = 24;
/** Connexions simultanées au total, inscrites ou non (la salle plafonne les inscrites à `JEU.connexionsMax`). */
const CONNEXIONS_TOTAL_MAX = 96;
/**
 * Un spectateur (inscrit hors arène) qui n'a envoyé aucun message utile (hors ping et tableau des scores) depuis ce délai est recyclé : socket
 * fermée (1001), le client légitime se reconnecte tout seul, un onglet oublié ou un script qui ne répond qu'aux ping libère sa place.
 */
const SPECTATEUR_INACTIF_MS = 15 * 60_000;
/** Origines autorisées (`ORIGINES`, séparées par des virgules ; `*` = n'importe quelle suite de caractères hors « / », pour les previews Vercel). */
const ORIGINES = (process.env.ORIGINES ?? "").split(",").map((o) => o.trim()).filter(Boolean)
  .map((o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`));

/** Fichier de données d'Agroparc : la variable `variable`, sinon `public/agroparc/` vu de serveur-fps ou de la racine, sinon à côté. */
function cheminDonnees(nom: string, variable: string): string {
  const candidats = [
    process.env[variable],
    resolve(process.cwd(), `../public/agroparc/${nom}`),
    resolve(process.cwd(), `public/agroparc/${nom}`),
    resolve(process.cwd(), nom),
  ].filter((c): c is string => !!c);
  const trouve = candidats.find((c) => existsSync(c));
  if (!trouve) throw new Error(`${nom} introuvable (${variable}). Essayé : ${candidats.join(", ")}`);
  return trouve;
}

const fichierScene = cheminDonnees("scene.json", "SCENE_JSON");
const scene = JSON.parse(readFileSync(fichierScene, "utf8")) as SceneData;
const monde = construireMonde(scene);
const apparitions = pointsApparition(scene, monde);

/** Entier positif lu dans l'environnement (ms), undefined si absent ou invalide. */
function dureeEnv(nom: string): number | undefined {
  const n = Number(process.env[nom]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
// Elsa : intervalle surchargeable pour des tests de bout en bout déterministes (offre en quelques secondes au lieu de 20 à 50 s)
const elsaMin = dureeEnv("PDJ_FPS_ELSA_MIN_MS");
const elsaMax = dureeEnv("PDJ_FPS_ELSA_MAX_MS");
// Avion des tigres : idem (un passage toutes les 90 à 180 s par défaut, quelques secondes pour les tests de bout en bout)
const avionMin = dureeEnv("PDJ_FPS_AVION_MIN_MS");
const avionMax = dureeEnv("PDJ_FPS_AVION_MAX_MS");
/** Intervalle surchargé par l'environnement. Une seule des deux variables suffit, elle sert aux deux bornes. */
const intervalleEnv = (min: number | undefined, max: number | undefined) =>
  min !== undefined || max !== undefined ? { minMs: min ?? max!, maxMs: Math.max(min ?? 0, max ?? min!) } : undefined;
// Cachettes du tigre (le cap du fichier est une rotation three, converti en convention lacet)
const fichierCachettes = cheminDonnees("cachettes.json", "CACHETTES_JSON");
const cachettes = lireCachettes(JSON.parse(readFileSync(fichierCachettes, "utf8")) as FichierCachettes)
  .map((c) => ({ x: c.x, z: c.z, cap: capDeCachette(c.cap) }));
const [elsaX, elsaZ] = positionElsa(scene);
// Événements (v3) : délai avant chaque événement et type imposé, pour les tests de bout en bout
const evtMin = dureeEnv("PDJ_FPS_EVT_MIN_MS");
const evtMax = dureeEnv("PDJ_FPS_EVT_MAX_MS");
const evtType = process.env.PDJ_FPS_EVT_TYPE === "truck" || process.env.PDJ_FPS_EVT_TYPE === "tigre" ? process.env.PDJ_FPS_EVT_TYPE : undefined;
const circuits = construireCircuits();
const rondPoint = trouverRondPoint(scene) ?? ROND_POINT;
const options: OptionsSalle = {
  zoneApparition: { centre: rondPoint.centre, ...ZONE_APPARITION },
  elsa: { x: elsaX, z: elsaZ, intervalle: intervalleEnv(elsaMin, elsaMax) },
  circulation: { circuits, voitures: flotte(circuits) },
  vehicules: EMPLACEMENTS_VOITURES,
  tigres: { cachettes, intervalle: intervalleEnv(avionMin, avionMax) },
  // v3 : Truck Muche fou (départ du stand d'Elsa) et tigre robot (autour du rond-point) ; délais surchargeables pour les tests
  evenements: {
    truck: { x: elsaX, z: elsaZ },
    centre: { x: rondPoint.centre[0], z: rondPoint.centre[1] },
    ...(evtMin !== undefined || evtMax !== undefined
      ? {
          premier: { minMs: evtMin ?? evtMax!, maxMs: Math.max(evtMin ?? 0, evtMax ?? evtMin!) },
          intervalle: { minMs: evtMin ?? evtMax!, maxMs: Math.max(evtMin ?? 0, evtMax ?? evtMin!) },
        }
      : {}),
    ...(evtType ? { forcerType: evtType } : {}),
    ...(dureeEnv("PDJ_FPS_TIGRE_PV") !== undefined ? { pvTigre: dureeEnv("PDJ_FPS_TIGRE_PV") } : {}),
    ...(["laser", "saut", "charge"].includes(process.env.PDJ_FPS_TIGRE_ATTAQUE ?? "") ? { attaqueTigre: process.env.PDJ_FPS_TIGRE_ATTAQUE as "laser" | "saut" | "charge" } : {}),
  },
};
const salleArene = new Salle(monde, apparitions, Math.random, Date.now(), options);

// Zombies (v5) : son propre monde MUTABLE (portes qui s'ouvrent), sans Elsa, circulation, voitures ni événements. La grille de navigation des
// tigres est précalculée à la création du service (17 à 40 ms), puis mise à jour autour de chaque porte achetée (< 1 ms) et restaurée telle
// quelle au retour au lobby.
const argentZombies = dureeEnv("PDJ_FPS_ZOMBIES_ARGENT");
const totalZombies = dureeEnv("PDJ_FPS_ZOMBIES_TOTAL");
const pauseZombies = dureeEnv("PDJ_FPS_ZOMBIES_PAUSE_MS");
const griffeZombies = dureeEnv("PDJ_FPS_ZOMBIES_GRIFFE");
/** (v7, essais) première manche du Truck Muche (0 = jamais), courant rétabli dès le départ */
const truckZombies = process.env.PDJ_FPS_ZOMBIES_TRUCK !== undefined && Number.isFinite(Number(process.env.PDJ_FPS_ZOMBIES_TRUCK))
  ? Math.max(0, Math.floor(Number(process.env.PDJ_FPS_ZOMBIES_TRUCK))) : undefined;
const courantZombies = process.env.PDJ_FPS_ZOMBIES_COURANT === "1";
/** (v8, essais) tigres à remontoir en poche au départ */
const remontoirsZombies = dureeEnv("PDJ_FPS_ZOMBIES_REMONTOIRS");
const optionsZombies: OptionsSalle = {
  zombies: {
    donnees: donneesZombies(scene),
    ...(argentZombies !== undefined ? { argentDepart: argentZombies } : {}),
    ...(totalZombies !== undefined ? { total1: totalZombies } : {}),
    ...(pauseZombies !== undefined ? { pauseMs: pauseZombies } : {}),
    ...(griffeZombies !== undefined ? { degatsGriffe: griffeZombies } : {}),
    ...(truckZombies !== undefined ? { mancheTruck: truckZombies } : {}),
    ...(courantZombies ? { courant: true } : {}),
    ...(remontoirsZombies !== undefined ? { remontoirsDepart: remontoirsZombies } : {}),
  },
};
const salleZombies = new Salle(construireMondeZombies(scene), DEPARTS.map((d) => [d[0], d[1]] as [number, number]), Math.random, Date.now(), optionsZombies);

/** Ids courts (« j1 », « j2 »… en base 36) : un id figure dans chaque joueur de chaque snap, `randomUUID` pesait 36 octets par occurrence. */
let compteurId = 0;
const nouvelId = (): string => `j${(++compteurId).toString(36)}`;

interface Client {
  id: string;
  ws: WebSocket;
  /** « bonjour » reçu et accepté */
  inscrit: boolean;
  vivant: boolean;
  pingEnvoyeA: number;
  /** seaux de l'anti-flood (lib/fps/anti-flood.ts) */
  flood: EtatFlood;
  ip: string;
  /** dernier message utile (tout sauf ping et vueScores) ; sert à recycler les spectateurs oubliés */
  utileT: number;
  /** salle où le client est inscrit : l'arène à `bonjour`, puis celle qu'il choisit par `mode` */
  salle: Salle;
  /** (v8) secret de reprise de la session, envoyé dans `bienvenue.jeton` */
  jeton: string;
}
const clients = new Map<string, Client>();

const parIp = new Map<string, number>();

/** (v8) Sessions coupées gardées pour une reprise : id → jeton, salle, minuteur de la déconnexion définitive. */
interface Suspens { jeton: string; salle: Salle; minuteur: ReturnType<typeof setTimeout> }
const enSuspens = new Map<string, Suspens>();
const nouveauJeton = (): string => randomBytes(18).toString("base64url");

/** Ajoute le jeton de reprise de `c` à son `bienvenue` (inscription ou changement de salle). */
function avecJeton(c: Client, sorties: Sortie[]): Sortie[] {
  return sorties.map((s) => (s.a === c.id && s.m.t === "bienvenue" ? { ...s, m: { ...s.m, jeton: c.jeton } } : s));
}

/**
 * Connexion fermée d'un inscrit : un membre de la salle des zombies est gardé `REPRISE_MS` (sa partie continue, il est immobile), les autres
 * sont déconnectés tout de suite.
 */
function fermer(c: Client): void {
  if (!c.inscrit) return;
  const pseudo = c.salle.inspecter(c.id)?.pseudo;
  if (c.salle === salleZombies && c.salle.inspecter(c.id)) {
    const salle = c.salle, id = c.id;
    const minuteur = setTimeout(() => {
      enSuspens.delete(id);
      try { diffuser(salle, salle.deconnecter(id, Date.now())); } catch (e) { console.error("déconnexion:", e); }
      console.log(`- ${pseudo} (reprise expirée, ${salle.nombreJoueurs()} en ligne)`);
      diffuserSalons();
    }, REPRISE_MS);
    minuteur.unref();
    enSuspens.set(id, { jeton: c.jeton, salle, minuteur });
    console.log(`~ ${pseudo} (coupure, reprise possible ${REPRISE_MS / 1000} s)`);
    return;
  }
  try { diffuser(c.salle, c.salle.deconnecter(c.id, Date.now())); } catch (e) { console.error("déconnexion:", e); }
  console.log(`- ${pseudo} (${c.salle.nombreJoueurs()} en ligne)`);
}

/**
 * (v8) `bonjour.reprise` : la session coupée est rattachée à cette connexion (même id, même salle) si son jeton est le bon et qu'elle attend
 * encore ; renvoie vrai si c'est fait.
 */
function reprendre(c: Client, reprise: unknown, maintenant: number): boolean {
  if (!reprise || typeof reprise !== "object") return false;
  const { id, jeton } = reprise as { id?: unknown; jeton?: unknown };
  if (typeof id !== "string" || typeof jeton !== "string") return false;
  let salle: Salle;
  const ancien = clients.get(id);
  if (ancien && ancien !== c) {
    // l'ancienne connexion n'est pas encore vue fermée (coupure Wi-Fi : pas de FIN, le ping ne la détecte qu'en 5 à 10 s) : elle est remplacée
    if (!ancien.inscrit || ancien.jeton !== jeton || ancien.salle !== salleZombies || !ancien.salle.inspecter(id)) return false;
    ancien.inscrit = false; // sa fermeture ne déconnecte plus le joueur
    clients.delete(id);
    ancien.ws.terminate();
    salle = ancien.salle;
  } else {
    const s = enSuspens.get(id);
    if (!s || s.jeton !== jeton || !s.salle.inspecter(id)) return false;
    clearTimeout(s.minuteur);
    enSuspens.delete(id);
    salle = s.salle;
  }
  clients.delete(c.id);
  c.id = id;
  clients.set(id, c);
  c.salle = salle;
  c.inscrit = true;
  c.jeton = nouveauJeton();
  diffuser(c.salle, avecJeton(c, c.salle.reprendre(id, maintenant)));
  console.log(`~ ${c.salle.inspecter(id)?.pseudo} (reprise)`);
  return true;
}

function envoyer(c: Client, texte: string): void {
  if (c.ws.readyState !== c.ws.OPEN) return;
  if (c.ws.bufferedAmount > TAMPON_MAX_OCTETS) { c.ws.terminate(); return; }
  c.ws.send(texte);
}

/**
 * Route les sorties d'une salle ; une erreur adressée à un client le déconnecte après envoi. Adresses : « tous » (tous les inscrits DE CETTE
 * SALLE), « joueurs » (en jeu) ou « spectateurs » (inscrits hors jeu : vue Palantir, lobby des zombies) selon `salle.inspecter(id).enJeu`, ou l'id
 * d'un client (n'importe quelle salle).
 */
function diffuser(salle: Salle, sorties: Sortie[]): void {
  for (const s of sorties) {
    const texte = JSON.stringify(s.m);
    if (s.a === "tous" || s.a === "joueurs" || s.a === "spectateurs") {
      for (const c of clients.values()) {
        if (!c.inscrit || c.salle !== salle || c.id === s.sauf) continue;
        if (s.a !== "tous" && (s.a === "joueurs") !== (salle.inspecter(c.id)?.enJeu ?? false)) continue;
        envoyer(c, texte);
      }
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

/** Résumé des deux salles (choix du mode, compteurs). */
function salons(): MessageServeur {
  const z = salleZombies.resumeZombies() ?? { phase: "lobby" as const, joueurs: salleZombies.nombreJoueurs(), manche: 0 };
  return messageSalons({ joueurs: salleArene.nombreJoueurs(), enJeu: salleArene.nombreEnJeu() }, z);
}
let dernierSalons = "";

/** `salons` à tous les inscrits si le résumé a changé ; à un seul client (`vers`), toujours (à sa connexion). */
function diffuserSalons(vers?: Client): void {
  const texte = JSON.stringify(salons());
  if (vers) { envoyer(vers, texte); return; }
  if (texte === dernierSalons) return;
  dernierSalons = texte;
  for (const c of clients.values()) if (c.inscrit) envoyer(c, texte);
}

/**
 * Changement de salle (`mode`). Refusé AVANT de quitter l'ancienne salle (sinon `connecter` renverrait `erreur{plein}` et la socket serait
 * fermée) : en jeu (`lobby`), salle d'arrivée pleine (`plein`). Le pseudo et l'id sont conservés ; la nouvelle salle répond `mode` (écho) puis `bienvenue`.
 */
function changerMode(c: Client, mode: unknown, maintenant: number): void {
  const decision = decisionMode({
    mode, salleActuelle: c.salle === salleZombies ? "zombies" : "arene", enJeu: c.salle.inspecter(c.id)?.enJeu ?? false,
    joueursCible: (mode === "zombies" ? salleZombies : salleArene).nombreJoueurs(),
  });
  if (!decision) return;
  if (decision.action === "echo") { envoyer(c, JSON.stringify({ t: "mode", mode: decision.mode } satisfies MessageServeur)); return; }
  if (decision.action === "refus") { envoyer(c, JSON.stringify({ t: "refus", action: "mode", raison: decision.raison } satisfies MessageServeur)); return; }
  const cible = decision.mode === "zombies" ? salleZombies : salleArene;
  const pseudo = c.salle.inspecter(c.id)?.pseudo ?? "";
  const ancienne = c.salle;
  const depart = ancienne.deconnecter(c.id, maintenant);
  c.salle = cible; // avant de diffuser le départ : le client ne reçoit plus rien de l'ancienne salle
  diffuser(ancienne, depart);
  diffuser(cible, avecJeton(c, [{ a: c.id, m: { t: "mode", mode: decision.mode } }, ...cible.connecter(c.id, pseudo, maintenant)]));
  diffuserSalons();
}

/** Message lu (objet avec un type) ou null. */
function lire(brut: string): MessageClient | null {
  let msg: unknown;
  try { msg = JSON.parse(brut); } catch { return null; }
  if (!msg || typeof msg !== "object" || typeof (msg as { t?: unknown }).t !== "string") return null;
  return msg as MessageClient;
}

function traiter(c: Client, m: MessageClient, maintenant: number): void {
  if (!c.inscrit) {
    if (m.t !== "bonjour") return;
    if (m.v !== VERSION_PROTOCOLE) return refuser(c, "version", "Version du protocole incompatible : rechargez la page.");
    if (reprendre(c, m.reprise, maintenant)) { diffuserSalons(c); return; }
    const sorties = avecJeton(c, c.salle.connecter(c.id, typeof m.pseudo === "string" ? m.pseudo : "", maintenant));
    c.inscrit = !sorties.some((s) => s.a === c.id && s.m.t === "erreur");
    diffuser(c.salle, sorties);
    if (c.inscrit) {
      console.log(`+ ${c.salle.inspecter(c.id)?.pseudo} (${c.salle.nombreJoueurs()} en ligne)`);
      diffuserSalons(c);
    }
    return;
  }
  if (m.t === "bonjour") return;
  if (m.t !== "ping" && m.t !== "vueScores") c.utileT = maintenant;
  if (m.t === "mode") return changerMode(c, m.mode, maintenant);
  diffuser(c.salle, c.salle.recevoir(c.id, m, maintenant));
}

const http = createServer((req, res) => {
  if (req.method === "GET" && req.url?.split("?")[0] === "/sante") {
    const z = salleZombies.resumeZombies();
    const corps = JSON.stringify({
      ok: true, joueurs: salleArene.nombreJoueurs(), enJeu: salleArene.nombreEnJeu(), match: salleArene.infoMatch().numero,
      zombies: {
        joueurs: salleZombies.nombreJoueurs(), enJeu: salleZombies.nombreEnJeu(), phase: z?.phase ?? "lobby", manche: z?.manche ?? 0,
        // (v8) sessions coupées qui attendent leur reprise
        enSuspens: enSuspens.size,
      },
    });
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

wss.on("connection", (ws, req) => {
  const ip = ipClient(req.headers["x-forwarded-for"], req.socket.remoteAddress);
  if (clients.size >= CONNEXIONS_TOTAL_MAX || (parIp.get(ip) ?? 0) >= CONNEXIONS_PAR_IP_MAX) {
    ws.close(1013, "trop de connexions");
    return;
  }
  parIp.set(ip, (parIp.get(ip) ?? 0) + 1);
  const c: Client = {
    id: nouvelId(), ws, inscrit: false, vivant: true, pingEnvoyeA: Date.now(), flood: creerEtatFlood(Date.now()), ip, utileT: Date.now(), salle: salleArene,
    jeton: nouveauJeton(),
  };
  clients.set(c.id, c);
  // un client qui ne dit pas « bonjour » dans les 10 s est libéré
  setTimeout(() => { if (!c.inscrit && ws.readyState === ws.OPEN) ws.close(1008, "bonjour attendu"); }, 10_000).unref();
  ws.ping(); // première mesure de latence tout de suite
  ws.on("pong", () => {
    c.vivant = true;
    if (c.inscrit) c.salle.majPing(c.id, Date.now() - c.pingEnvoyeA);
  });
  ws.on("message", (donnees, binaire) => {
    if (binaire) return;
    const maintenant = Date.now();
    const m = lire(donnees.toString());
    // l'excédent est jeté (paquets regroupés après une coupure) ; seul un flood réel coupe la connexion
    const decision = admettre(c.flood, m?.t ?? null, maintenant);
    if (decision === "couper") return refuser(c, "flood", "Trop de messages.");
    if (decision === "jeter" || !m) return;
    try { traiter(c, m, maintenant); } catch (e) { console.error("message:", e); }
  });
  ws.on("close", () => {
    // une connexion remplacée par une reprise ne retire pas l'entrée de la nouvelle (même id)
    if (clients.get(c.id) === c) clients.delete(c.id);
    const n = (parIp.get(c.ip) ?? 1) - 1;
    if (n <= 0) parIp.delete(c.ip);
    else parIp.set(c.ip, n);
    fermer(c);
  });
  ws.on("error", () => ws.terminate());
});

// Connexions mortes : un client qui n'a pas répondu au ping précédent est fermé.
const timerPing = setInterval(() => {
  const maintenant = Date.now();
  for (const c of clients.values()) {
    if (!c.vivant) { c.ws.terminate(); continue; }
    if (c.inscrit && maintenant - c.utileT > SPECTATEUR_INACTIF_MS && !c.salle.inspecter(c.id)?.enJeu) { c.ws.close(1001, "inactif"); continue; }
    c.vivant = false;
    c.pingEnvoyeA = Date.now();
    c.ws.ping();
  }
}, PING_MS);

const timerTic = setInterval(() => {
  try { diffuser(salleArene, salleArene.tic(Date.now())); } catch (e) { console.error("tic:", e); }
  // la salle des zombies vide ne coûte rien
  if (salleZombies.nombreJoueurs() > 0) {
    try { diffuser(salleZombies, salleZombies.tic(Date.now())); } catch (e) { console.error("tic zombies:", e); }
  }
}, TIC_MS);

// Résumé des salles : à tous, une fois par seconde s'il a changé (le choix du mode affiche les compteurs en direct)
const timerSalons = setInterval(() => {
  try { diffuserSalons(); } catch (e) { console.error("salons:", e); }
}, 1000);

http.listen(PORT, "0.0.0.0", () => {
  console.log(`Arène FPS : ws://0.0.0.0:${PORT} (scène ${fichierScene}, ${apparitions.length} points d'apparition, ${cachettes.length} cachettes, origines : ${ORIGINES.join(", ") || "toutes"})`);
});

function arreter(): void {
  clearInterval(timerPing);
  clearInterval(timerTic);
  clearInterval(timerSalons);
  for (const s of enSuspens.values()) clearTimeout(s.minuteur);
  for (const c of clients.values()) c.ws.close(1001, "arrêt du serveur");
  wss.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", arreter);
process.on("SIGINT", arreter);
