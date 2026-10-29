/**
 * Serveur temps réel de l'arène FPS (vue Palantir) : HTTP `GET /sante` et `GET /stats-br` + WebSocket sur le même port,
 * trois modes : l'arène « chacun pour soi » (avion et tigres largués compris), les zombies tigres (coopératif par manches) et le Battle Royale
 * (v9, plusieurs parties en même temps depuis le 2026-10-29). Toute la logique de jeu est dans lib/fps/match.ts, match-zombies.ts et match-br.ts (purs) ; ce fichier ne fait que l'I/O : connexions,
 * anti-flood (lib/fps/anti-flood.ts : l'excédent est jeté, la socket n'est coupée que pour un flood réel), origines, ping, boucle de tic à
 * 60 Hz, routage du message `mode` (changement de salle), résumé `salons`, persistance des stats BR et (v8) reprise d'une partie de zombies
 * après une micro-coupure (`REPRISE_MS`).
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md (v1), 2026-10-22-arene-v2-design.md (v2),
 * 2026-10-23-arene-tigres-design.md (v5 : avion, tigres largués, sort d'invocation), 2026-10-27-arene-zombies-design.md (v6),
 * 2026-10-28-battle-royale-design.md (v8)
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { lireCachettes, type FichierCachettes } from "../../lib/agroparc3d/cachettes";
import type { SceneData } from "../../lib/agroparc3d/types";
import { construireMondeBr } from "../../lib/fps/br-carte";
import { BR } from "../../lib/fps/br-regles";
import { classementStats } from "../../lib/fps/br-stats";
import { admettre, creerEtatFlood, type EtatFlood } from "../../lib/fps/anti-flood";
import { construireCircuits, flotte } from "../../lib/fps/circulation";
import { construireMonde, pointsApparition } from "../../lib/fps/collision";
import { ipClient } from "../../lib/fps/ip-client";
import { Salle, type OptionsSalle, type Sortie } from "../../lib/fps/match";
import { PARTIE_NOUVELLE, VERSIONS_ACCEPTEES, type MessageClient, type MessageServeur, type ModeSalle, type PhaseBr, type ResumePartieBr } from "../../lib/fps/protocole";
import { decisionMode, garderPourReprise, messageSalons, modeDeSalle, partieApercuBr } from "../../lib/fps/salons";
import { capDeCachette } from "../../lib/fps/tigre-arene";
import { DEPARTS, construireMondeZombies, donneesZombies } from "../../lib/fps/zombies-carte";
import { GENRES_BONUS, type GenreBonus } from "../../lib/fps/zombies-vagues";
import { EMPLACEMENTS_VOITURES, ROND_POINT, ZONE_APPARITION, positionElsa, trouverRondPoint } from "../../lib/fps/zones";
import { creerPersistanceBr } from "./stats-br";

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
/** Nombre strictement positif lu dans l'environnement (ms, comptes, échelles), undefined si absent ou invalide. */
function nombreEnv(nom: string): number | undefined {
  const n = Number(process.env[nom]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
/**
 * Connexions simultanées par adresse IP ; la suivante est refusée (1013) sans toucher à la salle. Défaut 24 (point d'accès public) ;
 * `PDJ_FPS_CONNEXIONS_IP` le monte (la prod met 60 : cinquante amis derrière l'IP d'un même bureau pour le Battle Royale).
 */
const CONNEXIONS_PAR_IP_MAX = Math.floor(nombreEnv("PDJ_FPS_CONNEXIONS_IP") ?? 24);
/**
 * Connexions simultanées au total, inscrites ou non : 50 en Battle Royale + 64 en arène + 8 en zombies + une marge de poignées de main
 * (`PDJ_FPS_CONNEXIONS_TOTAL` pour la changer).
 */
const CONNEXIONS_TOTAL_MAX = Math.floor(nombreEnv("PDJ_FPS_CONNEXIONS_TOTAL") ?? 160);
/**
 * Un spectateur (inscrit hors arène) qui n'a envoyé aucun message utile (hors ping et tableau des scores) depuis ce délai est recyclé : socket
 * fermée (1001), le client légitime se reconnecte tout seul, un onglet oublié ou un script qui ne répond qu'aux ping libère sa place.
 * Exception : un membre du lobby Battle Royale quand il compte au moins deux joueurs (ils attendent l'hôte, sans rien envoyer).
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

/** Durée (ms) ou compte strictement positif lu dans l'environnement, undefined si absent ou invalide. */
const dureeEnv = nombreEnv;
// Elsa : intervalle surchargeable pour des tests de bout en bout déterministes (offre en quelques secondes au lieu de 20 à 50 s)
const elsaMin = dureeEnv("PDJ_FPS_ELSA_MIN_MS");
const elsaMax = dureeEnv("PDJ_FPS_ELSA_MAX_MS");
// Avion des tigres : idem (un passage toutes les 90 à 180 s par défaut, quelques secondes pour les tests de bout en bout)
const avionMin = dureeEnv("PDJ_FPS_AVION_MIN_MS");
const avionMax = dureeEnv("PDJ_FPS_AVION_MAX_MS");
// Bus C3 express : idem (un passage toutes les 45 à 75 s par défaut ; il écrase à pied, les tests de bout en bout de l'arène l'écartent)
const busMin = dureeEnv("PDJ_FPS_BUS_MIN_MS");
const busMax = dureeEnv("PDJ_FPS_BUS_MAX_MS");
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
  bus: { intervalle: intervalleEnv(busMin, busMax) },
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
/** (v8, essais) paquet de bonus imposé : genres séparés par des virgules (« soldes,menuisier »), les inconnus sont ignorés */
const bonusZombies = (process.env.PDJ_FPS_ZOMBIES_BONUS ?? "").split(",").map((x) => x.trim()).filter((x): x is GenreBonus => (GENRES_BONUS as readonly string[]).includes(x));
/**
 * (v8, essais) grand secret « Le Menu fantôme » : étape de départ de chaque partie (0 à 9, les précédentes considérées faites), tour du cadran
 * des pendules (midi sonne une fois par tour, 300 000 ms par défaut), première livraison du Truck où le service s'ouvre (3 par défaut)
 */
const secretEtape = dureeEnv("PDJ_FPS_ZOMBIES_SECRET");
const secretMidi = dureeEnv("PDJ_FPS_ZOMBIES_SECRET_MIDI_MS");
const secretLivraison = dureeEnv("PDJ_FPS_ZOMBIES_SECRET_LIVRAISON");
const optionsSecret = {
  ...(secretEtape !== undefined ? { etape: secretEtape } : {}),
  ...(secretMidi !== undefined ? { periodeMidiMs: secretMidi } : {}),
  ...(secretLivraison !== undefined ? { livraisonService: secretLivraison } : {}),
};
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
    ...(bonusZombies.length ? { bonus: bonusZombies } : {}),
    ...(Object.keys(optionsSecret).length ? { secret: optionsSecret } : {}),
  },
};
const salleZombies = new Salle(construireMondeZombies(scene), DEPARTS.map((d) => [d[0], d[1]] as [number, number]), Math.random, Date.now(), optionsZombies);

// Battle Royale (v8) : son propre monde MUTABLE (20 bâtiments creusés, brèches), jamais celui de l'arène (grille de collision à tampon non réentrant).
// Ni Elsa, ni voitures, ni événements, ni avion des tigres : le service BR tire son butin, sa zone et son avion lui-même. Les essais
// (`PDJ_FPS_BR_*`) raccourcissent décompte, vol et zone pour les tests de bout en bout.
const fichierStatsBr = process.env.PDJ_FPS_BR_STATS || resolve(process.cwd(), "donnees/stats-br.json");
const persistanceBr = creerPersistanceBr(fichierStatsBr);
const minJoueursBr = dureeEnv("PDJ_FPS_BR_MIN_JOUEURS");
const decompteBr = dureeEnv("PDJ_FPS_BR_DECOMPTE_MS");
const volBr = dureeEnv("PDJ_FPS_BR_VOL_MS");
const altitudeBr = dureeEnv("PDJ_FPS_BR_ALTITUDE");
const echelleZoneBr = dureeEnv("PDJ_FPS_BR_ZONE_ECHELLE");
const objetsBr = dureeEnv("PDJ_FPS_BR_OBJETS");
const finBr = dureeEnv("PDJ_FPS_BR_FIN_MS");
/** durée minimale (ms) pour qu'une partie compte dans les stats ; `BR.partieValideMinMs` (60 s) par défaut */
const valideBr = dureeEnv("PDJ_FPS_BR_VALIDE_MS");
const optionsBr: OptionsSalle = {
  br: {
    scene,
    stats: persistanceBr,
    ...(minJoueursBr !== undefined ? { joueursMin: Math.floor(minJoueursBr) } : {}),
    ...(decompteBr !== undefined ? { decompteMaxMs: decompteBr } : {}),
    ...(volBr !== undefined ? { dureeVolMs: volBr } : {}),
    ...(altitudeBr !== undefined ? { altitude: altitudeBr } : {}),
    ...(echelleZoneBr !== undefined ? { echelleZone: echelleZoneBr } : {}),
    ...(objetsBr !== undefined ? { nbObjets: Math.floor(objetsBr) } : {}),
    ...(finBr !== undefined ? { finAffichageMs: finBr } : {}),
    ...(valideBr !== undefined ? { partieValideMinMs: valideBr } : {}),
  },
  // à 10 Hz de snaps et 150 ms d'interpolation, la cible vue par le tireur a plus de retard qu'en arène : fenêtre de rejeu élargie
  rewindMaxMs: BR.rewindMaxMs,
  historiqueMs: BR.historiqueMs,
};
/**
 * Une salle Battle Royale neuve, avec son propre monde (≈ 90 ms et 2 Mo). Le point de départ n'est jamais utilisé (le service place les
 * joueurs dans l'avion) : le centre des bornes du monde.
 */
function creerSalleBr(): Salle {
  const mondeBr = construireMondeBr(scene);
  const depart: [number, number][] = [[(mondeBr.bornes.x0 + mondeBr.bornes.x1) / 2, (mondeBr.bornes.z0 + mondeBr.bornes.z1) / 2]];
  return new Salle(mondeBr, depart, Math.random, Date.now(), optionsBr);
}
/**
 * Parties de Battle Royale : la salle permanente `br1`, plus celles qu'ouvrent les joueurs arrivés pendant une partie en cours
 * (`mode{br, partie:"nouvelle"}`), refermées dès qu'elles sont vides. Au plus `PDJ_FPS_BR_PARTIES` (4) en même temps : chacune coûte son
 * monde et son tic, sur un conteneur plafonné à 1 vCPU.
 */
const PARTIES_BR_MAX = Math.max(1, Math.floor(nombreEnv("PDJ_FPS_BR_PARTIES") ?? 4));
interface PartieBr { id: string; salle: Salle }
const partiesBr: PartieBr[] = [{ id: "br1", salle: creerSalleBr() }];
let compteurPartiesBr = 1;
/** la salle permanente (résumé `salons.br` des clients d'avant les parties multiples, `/sante.br`) */
const salleBr = partiesBr[0].salle;
const partieDeSalle = (salle: Salle): PartieBr | null => partiesBr.find((p) => p.salle === salle) ?? null;
/** Ouvre une partie de plus (la décision a vérifié qu'il reste de la place). */
function ouvrirPartieBr(): PartieBr {
  const partie = { id: `br${++compteurPartiesBr}`, salle: creerSalleBr() };
  partiesBr.push(partie);
  console.log(`+ partie BR ${partie.id} (${partiesBr.length} en tout)`);
  return partie;
}
/** Referme les parties créées par les joueurs qui sont vides (jamais la salle permanente). Vrai si une partie a été refermée. */
function refermerPartiesVides(): boolean {
  let fait = false;
  for (let i = partiesBr.length - 1; i >= 1; i--) {
    if (partiesBr[i].salle.nombreJoueurs() > 0) continue;
    console.log(`- partie BR ${partiesBr[i].id}`);
    partiesBr.splice(i, 1);
    fait = true;
  }
  return fait;
}

/** Les salles par mode : `modeDeSalle` retrouve le mode d'un client par identité de sa salle. */
const SALLES = (): Record<ModeSalle, Salle | readonly Salle[]> => ({ arene: salleArene, zombies: salleZombies, br: partiesBr.map((p) => p.salle) });

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
  /** (v10) version du protocole annoncée au `bonjour` (0 avant) : la salle des zombies exige `VERSION_MIN_ZOMBIES` */
  version: number;
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
 * Connexion fermée d'un inscrit : un membre d'une partie de zombies en cours dont la connexion est tombée (pas un départ volontaire,
 * `garderPourReprise`) est gardé `REPRISE_MS` (sa partie continue, il est immobile) ; les autres sont déconnectés tout de suite.
 */
function fermer(c: Client, code: number): void {
  if (!c.inscrit) return;
  const pseudo = c.salle.inspecter(c.id)?.pseudo;
  const garder = garderPourReprise({
    salleZombies: c.salle === salleZombies, membre: !!c.salle.inspecter(c.id), code, phase: c.salle.resumeZombies()?.phase ?? null,
  });
  if (garder) {
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
function reprendre(c: Client, reprise: unknown, pseudo: unknown, maintenant: number): boolean {
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
  diffuser(c.salle, avecJeton(c, c.salle.reprendre(id, maintenant, pseudo)));
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
  const partieBr = partieDeSalle(salle);
  for (const s of sorties) {
    // aperçu d'une partie de Battle Royale : porte l'id de la partie (le bandeau de la vue Palantir le dit) et est relayé aux spectateurs des autres parties
    const m = s.m.t === "apercu" && partieBr ? { ...s.m, partie: partieBr.id } : s.m;
    const texte = JSON.stringify(m);
    if (m.t === "apercu" && partieBr) relayerApercu(partieBr, texte);
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

/** Parties de Battle Royale vues par `partieApercuBr` (id, phase, survivants). */
const apercusParties = (): { id: string; phase: PhaseBr; vivants: number }[] =>
  partiesBr.map((p) => { const r = p.salle.resumeBr(); return { id: p.id, phase: r?.phase ?? "lobby", vivants: r?.vivants ?? 0 }; });

/**
 * Un client de Battle Royale dont la partie n'est ni en vol ni en jeu voit l'aperçu de la partie en cours qui compte le plus de survivants
 * (`partieApercuBr`) : le message de `source` est relayé à ceux de ses spectateurs inscrits hors jeu dans une AUTRE partie.
 */
function relayerApercu(source: PartieBr, texte: string): void {
  const parties = apercusParties();
  for (const c of clients.values()) {
    if (!c.inscrit || c.salle === source.salle) continue;
    const sienne = partieDeSalle(c.salle);
    if (!sienne || c.salle.inspecter(c.id)?.enJeu) continue;
    if (partieApercuBr(parties, sienne.id) === source.id) envoyer(c, texte);
  }
}

/** Pose `relaiApercu` sur les parties qu'au moins un spectateur d'une autre partie regarde (une fois par seconde). */
function majRelaisApercu(): void {
  const parties = apercusParties();
  const regardees = new Set<string>();
  for (const p of partiesBr) {
    if (p.salle.nombreJoueurs() <= p.salle.nombreEnJeu()) continue;
    const cible = partieApercuBr(parties, p.id);
    if (cible && cible !== p.id) regardees.add(cible);
  }
  for (const p of partiesBr) p.salle.relaiApercu = regardees.has(p.id);
}

function refuser(c: Client, code: Extract<MessageServeur, { t: "erreur" }>["code"], message: string): void {
  envoyer(c, JSON.stringify({ t: "erreur", code, message } satisfies MessageServeur));
  c.ws.close(1008, code);
}

/** Résumé d'une partie de Battle Royale (`salons.parties`). */
function resumePartie(p: PartieBr): ResumePartieBr {
  const r = p.salle.resumeBr() ?? { phase: "lobby" as const, joueurs: p.salle.nombreJoueurs(), vivants: 0 };
  return { id: p.id, ...r };
}

/** Résumé des salles (choix du mode, compteurs) ; toutes les parties de Battle Royale dans `parties`. */
function salons(): MessageServeur {
  const z = salleZombies.resumeZombies() ?? { phase: "lobby" as const, joueurs: salleZombies.nombreJoueurs(), manche: 0 };
  return messageSalons({ joueurs: salleArene.nombreJoueurs(), enJeu: salleArene.nombreEnJeu() }, z, salleBr.resumeBr(), partiesBr.map(resumePartie));
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
 * Changement de salle (`mode`), ou de partie de Battle Royale (`partie`). Refusé AVANT de quitter l'ancienne salle (sinon `connecter`
 * renverrait `erreur{plein}` et la socket serait fermée) : en jeu (`lobby`), salle d'arrivée pleine (`plein`), plus de partie possible
 * (`limite`). Le pseudo et l'id sont conservés ; la nouvelle salle répond `mode` (écho, avec la partie) puis `bienvenue`.
 */
function changerMode(c: Client, mode: unknown, partie: unknown, maintenant: number): void {
  const salles = SALLES();
  const salleActuelle = modeDeSalle(c.salle, salles);
  const decision = decisionMode({
    mode, salleActuelle, enJeu: c.salle.inspecter(c.id)?.enJeu ?? false,
    joueursCible: mode === "arene" ? salleArene.nombreJoueurs() : mode === "zombies" ? salleZombies.nombreJoueurs() : 0, version: c.version,
    partie, partieActuelle: partieDeSalle(c.salle)?.id ?? null,
    parties: partiesBr.map((p) => ({ id: p.id, joueurs: p.salle.nombreJoueurs(), phase: p.salle.resumeBr()?.phase ?? "lobby" })),
    creerPossible: partiesBr.length < PARTIES_BR_MAX,
  });
  if (!decision) return;
  if (decision.action === "version") return refuser(c, "version", "Version du protocole incompatible : rechargez la page.");
  if (decision.action === "echo") {
    envoyer(c, JSON.stringify({ t: "mode", mode: decision.mode, ...(decision.partie ? { partie: decision.partie } : {}) } satisfies MessageServeur));
    return;
  }
  if (decision.action === "refus") { envoyer(c, JSON.stringify({ t: "refus", action: "mode", raison: decision.raison } satisfies MessageServeur)); return; }
  let partieCible: PartieBr | null = null;
  if (decision.mode === "br") {
    partieCible = decision.partie === PARTIE_NOUVELLE ? ouvrirPartieBr() : partiesBr.find((p) => p.id === decision.partie) ?? null;
    if (!partieCible) return;
  }
  const cible = decision.mode === "arene" ? salleArene : decision.mode === "zombies" ? salleZombies : partieCible!.salle;
  const pseudo = c.salle.inspecter(c.id)?.pseudo ?? "";
  const ancienne = c.salle;
  const depart = ancienne.deconnecter(c.id, maintenant);
  c.salle = cible; // avant de diffuser le départ : le client ne reçoit plus rien de l'ancienne salle
  diffuser(ancienne, depart);
  const echo: MessageServeur = { t: "mode", mode: decision.mode, ...(partieCible ? { partie: partieCible.id } : {}) };
  diffuser(cible, avecJeton(c, [{ a: c.id, m: echo }, ...cible.connecter(c.id, pseudo, maintenant)]));
  refermerPartiesVides();
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
    if (!VERSIONS_ACCEPTEES.includes(m.v)) return refuser(c, "version", "Version du protocole incompatible : rechargez la page.");
    c.version = m.v;
    if (reprendre(c, m.reprise, m.pseudo, maintenant)) { diffuserSalons(c); return; }
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
  if (m.t === "mode") return changerMode(c, m.mode, m.partie, maintenant);
  diffuser(c.salle, c.salle.recevoir(c.id, m, maintenant));
}

/** Un tic (les trois salles et leurs diffusions) plus long que ça est « lent » : le CPU du conteneur est plafonné et les trois salles partagent la boucle. */
const TIC_LENT_MS = 8;
/** `/sante.ticMaxMs` et `alerte` couvrent la dernière minute (deux fenêtres de 60 s glissées l'une sur l'autre). */
const FENETRE_TIC_MS = 60_000;
const mesuresTic = { depuis: Date.now(), maxFenetre: 0, maxPrecedente: 0, lents: 0, dernierLentT: 0 };

/** Enregistre la durée d'un tic ; fait glisser la fenêtre d'une minute. */
function noterTic(dureeMs: number, maintenant: number): void {
  if (maintenant - mesuresTic.depuis >= FENETRE_TIC_MS) {
    mesuresTic.maxPrecedente = maintenant - mesuresTic.depuis >= 2 * FENETRE_TIC_MS ? 0 : mesuresTic.maxFenetre;
    mesuresTic.maxFenetre = 0;
    mesuresTic.depuis = maintenant;
  }
  mesuresTic.maxFenetre = Math.max(mesuresTic.maxFenetre, dureeMs);
  if (dureeMs > TIC_LENT_MS) { mesuresTic.lents++; mesuresTic.dernierLentT = maintenant; }
}

const http = createServer((req, res) => {
  const chemin = req.url?.split("?")[0];
  if (req.method === "GET" && chemin === "/sante") {
    const z = salleZombies.resumeZombies();
    const b = salleBr.resumeBr();
    const maintenant = Date.now();
    const corps = JSON.stringify({
      ok: true, joueurs: salleArene.nombreJoueurs(), enJeu: salleArene.nombreEnJeu(), match: salleArene.infoMatch().numero,
      zombies: {
        joueurs: salleZombies.nombreJoueurs(), enJeu: salleZombies.nombreEnJeu(), phase: z?.phase ?? "lobby", manche: z?.manche ?? 0,
        // (v8) sessions coupées qui attendent leur reprise
        enSuspens: enSuspens.size,
      },
      br: {
        joueurs: salleBr.nombreJoueurs(), enJeu: salleBr.nombreEnJeu(), phase: b?.phase ?? "lobby", vivants: b?.vivants ?? 0,
        // toutes les parties, salle permanente comprise
        parties: partiesBr.map((p) => ({ ...resumePartie(p), enJeu: p.salle.nombreEnJeu() })),
      },
      ticMaxMs: Math.round(Math.max(mesuresTic.maxFenetre, mesuresTic.maxPrecedente) * 100) / 100,
      ticsLents: mesuresTic.lents,
      ...(maintenant - mesuresTic.dernierLentT < FENETRE_TIC_MS && mesuresTic.dernierLentT > 0 ? { alerte: true } : {}),
    });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(corps);
    return;
  }
  // palmarès du Battle Royale (top 50) : pour les curieux et les tests ; CORS seulement pour les origines autorisées
  if (req.method === "GET" && chemin === "/stats-br") {
    const origine = req.headers.origin;
    const entetes: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
    if (origine && (ORIGINES.length === 0 || ORIGINES.some((o) => o.test(origine)))) {
      entetes["access-control-allow-origin"] = origine;
      entetes.vary = "origin";
    }
    res.writeHead(200, entetes);
    res.end(JSON.stringify({ lignes: classementStats(persistanceBr.lire(), 50) }));
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
    jeton: nouveauJeton(), version: 0,
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
  ws.on("close", (code: number) => {
    // une connexion remplacée par une reprise ne retire pas l'entrée de la nouvelle (même id)
    if (clients.get(c.id) === c) clients.delete(c.id);
    const n = (parIp.get(c.ip) ?? 1) - 1;
    if (n <= 0) parIp.delete(c.ip);
    else parIp.set(c.ip, n);
    fermer(c, code);
  });
  ws.on("error", () => ws.terminate());
});

/** Membre du lobby du Battle Royale qui attend l'hôte avec au moins un autre joueur : jamais recyclé pour inactivité. */
function attendDansLobbyBr(c: Client): boolean {
  if (!partieDeSalle(c.salle)) return false;
  const r = c.salle.resumeBr();
  return !!r && r.phase === "lobby" && r.joueurs >= 2;
}

// Connexions mortes : un client qui n'a pas répondu au ping précédent est fermé.
const timerPing = setInterval(() => {
  const maintenant = Date.now();
  for (const c of clients.values()) {
    if (!c.vivant) { c.ws.terminate(); continue; }
    if (c.inscrit && maintenant - c.utileT > SPECTATEUR_INACTIF_MS && !c.salle.inspecter(c.id)?.enJeu && !attendDansLobbyBr(c)) { c.ws.close(1001, "inactif"); continue; }
    c.vivant = false;
    c.pingEnvoyeA = Date.now();
    c.ws.ping();
  }
}, PING_MS);

const timerTic = setInterval(() => {
  const debut = performance.now();
  try { diffuser(salleArene, salleArene.tic(Date.now())); } catch (e) { console.error("tic:", e); }
  // les salles des zombies et du Battle Royale vides ne coûtent rien (le service BR traite une salle vidée dans `liberer`)
  if (salleZombies.nombreJoueurs() > 0) {
    try { diffuser(salleZombies, salleZombies.tic(Date.now())); } catch (e) { console.error("tic zombies:", e); }
  }
  for (const { salle } of partiesBr) {
    if (salle.nombreJoueurs() === 0) continue;
    try { diffuser(salle, salle.tic(Date.now())); } catch (e) { console.error("tic br:", e); }
  }
  noterTic(performance.now() - debut, Date.now());
}, TIC_MS);

// Résumé des salles : à tous, une fois par seconde s'il a changé (le choix du mode affiche les compteurs en direct)
const timerSalons = setInterval(() => {
  try {
    // une partie de Battle Royale vidée par une déconnexion est refermée ici (une fois par seconde suffit)
    refermerPartiesVides();
    majRelaisApercu();
    diffuserSalons();
  } catch (e) { console.error("salons:", e); }
}, 1000);

http.listen(PORT, "0.0.0.0", () => {
  console.log(`Arène FPS : ws://0.0.0.0:${PORT} (scène ${fichierScene}, ${apparitions.length} points d'apparition, ${cachettes.length} cachettes, origines : ${ORIGINES.join(", ") || "toutes"}, stats BR : ${fichierStatsBr}, ${CONNEXIONS_PAR_IP_MAX} connexions par IP, ${CONNEXIONS_TOTAL_MAX} au total)`);
});

function arreter(): void {
  clearInterval(timerPing);
  clearInterval(timerTic);
  clearInterval(timerSalons);
  for (const s of enSuspens.values()) clearTimeout(s.minuteur);
  // les fermetures qui suivent font abandonner les joueurs un à un : une partie interrompue par l'arrêt ne doit rien enregistrer
  persistanceBr.figer();
  for (const c of clients.values()) c.ws.close(1001, "arrêt du serveur");
  wss.close();
  // seul endroit où les stats s'écrivent en synchrone : l'écriture asynchrone en cours n'aurait pas le temps de finir ; ce qu'un départ en
  // cours de partie enregistre encore ensuite est écrit sur-le-champ
  persistanceBr.arreter();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", arreter);
process.on("SIGINT", arreter);
