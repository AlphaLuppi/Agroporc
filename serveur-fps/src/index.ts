/**
 * Serveur temps réel de l'arène FPS (vue Palantir) : HTTP `GET /sante` et `GET /stats-br` + WebSocket sur le même port,
 * trois modes : l'arène « chacun pour soi » (avion et tigres largués compris), les zombies tigres (coopératif par manches) et le Battle Royale
 * (v9), chacun en PLUSIEURS parties parallèles depuis la v11 (registre `lib/fps/parties.ts` : `ar1`, `z1`, `br1` permanentes, les autres créées à la
 * demande et refermées vides). Toute la logique de jeu est dans lib/fps/match.ts, match-zombies.ts et match-br.ts (purs) ; ce fichier ne fait que l'I/O : connexions,
 * anti-flood (lib/fps/anti-flood.ts : l'excédent est jeté, la socket n'est coupée que pour un flood réel), origines, ping, boucle de tic à
 * 60 Hz, routage du message `mode` (changement de salle), résumé `salons`, persistance des stats BR et (v8) reprise d'une partie de zombies
 * après une micro-coupure (`REPRISE_MS`).
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md (v1), 2026-10-22-arene-v2-design.md (v2),
 * 2026-10-23-arene-tigres-design.md (v5 : avion, tigres largués, sort d'invocation), 2026-10-27-arene-zombies-design.md (v6),
 * 2026-10-28-battle-royale-design.md (v8), 2026-10-29-pause-parties-bots-design.md (v11 : parties parallèles)
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { lireCachettes, type FichierCachettes } from "../../lib/agroparc3d/cachettes";
import type { SceneData } from "../../lib/agroparc3d/types";
import { construireMondeBr, pointsButin } from "../../lib/fps/br-carte";
import { BR } from "../../lib/fps/br-regles";
import { classementStats } from "../../lib/fps/br-stats";
import { admettre, creerEtatFlood, type EtatFlood } from "../../lib/fps/anti-flood";
import { construireCircuits, flotte } from "../../lib/fps/circulation";
import { construireMonde, pointsApparition } from "../../lib/fps/collision";
import { ipClient } from "../../lib/fps/ip-client";
import { optionsDepuisReglages, type ImposesEnv } from "../../lib/fps/evenements-arene";
import { Salle, type OptionsSalle, type Sortie } from "../../lib/fps/match";
import { cheminPourPolice, type OptionsPolice } from "../../lib/fps/match-police";
import { carteNavigation, copierCarteNavigation } from "../../lib/fps/navigation";
import { REGLAGES_DEFAUT, normaliserReglages, reglagesEgaux, type ReglagesArene } from "../../lib/fps/reglages-arene";
import { FenetreMax, LimiteCreation, RegistreParties, Reservations, type Partie } from "../../lib/fps/parties";
import {
  JEU, MODES_SALLE, PARTIE_AUTO, PARTIE_NOUVELLE, VERSIONS_ACCEPTEES, capacitesAcceptees, type MessageClient, type MessageServeur, type ModeSalle, type ResumePartie, type ResumePartieBr,
} from "../../lib/fps/protocole";
import { botsRestantsGlobal, capaciteSalle, decisionMode, garderPourReprise, messageSalons, modeDeSalle, partieApercu, partieRoutageDe, type PartieApercu, type PartieRoutage } from "../../lib/fps/salons";
import { BudgetNavigation, installerNavigationBr, preparerNavigationBr } from "../../lib/fps/nav-bots";
import { capDeCachette } from "../../lib/fps/tigre-arene";
import { DEPARTS, construireMondeZombies, donneesZombies } from "../../lib/fps/zombies-carte";
import { GENRES_BONUS, ZOMBIES, type GenreBonus } from "../../lib/fps/zombies-vagues";
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
/**
 * (v11) Tant que la salle d'un membre coupé est suspendue (un joueur a mis la partie en pause : le jeu est figé), son échéance de reprise est portée à ce
 * délai (`PDJ_FPS_REPRISE_SUSPENDUE_MS`) : sinon une connexion qui tombe 25 s pendant une pause serait retirée alors que le jeu n'avance pas.
 */
const REPRISE_SUSPENDUE_MS = Math.max(REPRISE_MS, Math.floor(nombreEnv("PDJ_FPS_REPRISE_SUSPENDUE_MS") ?? 60_000));
/** Un client qui n'absorbe plus ce qu'on lui envoie est coupé (connexion saturée). */
const TAMPON_MAX_OCTETS = 512 * 1024;
/** Nombre strictement positif lu dans l'environnement (ms, comptes, échelles), undefined si absent ou invalide. */
function nombreEnv(nom: string): number | undefined {
  const n = Number(process.env[nom]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
/** Nombre positif OU NUL lu dans l'environnement (un compte à rebours de 0 est légitime : levée immédiate des tests de bout en bout). */
function nombreEnvOuZero(nom: string): number | undefined {
  const brut = process.env[nom];
  if (brut === undefined || brut.trim() === "") return undefined;
  const n = Number(brut);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
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
// points d'apparition de l'arène : calculés une fois sur un monde de référence, partagés en lecture seule (chaque arène construit SON monde, mutable)
const mondeRefArene = construireMonde(scene);
const apparitions = pointsApparition(scene, mondeRefArene);
/**
 * Dégagement (m) de la grille de navigation des voitures : celui du Truck fou (`DEGAGEMENT_TRUCK_M` de match-evenements.ts), aussi celui de la voiture de police (arène ET
 * Battle Royale : la grille des bots, à cases de 1,5 m, fait passer une caisse de 4,4 × 1,9 m par des portes de 2 m où elle reste coincée). Calculée UNE fois ici,
 * avant `listen`, puis COPIÉE dans le monde de chaque salle neuve (`copierCarteNavigation`) : le cache est par monde, une première grille à froid coûte 40 à 430 ms en plein tic.
 */
const DEGAGEMENT_VOITURE_M = 1.8;
carteNavigation(mondeRefArene, DEGAGEMENT_VOITURE_M);

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
// Descente de police (2026-10-30) : `PDJ_FPS_POLICE=off` la coupe partout (arène et Battle Royale), intervalle (premier ET entre), durée et PV surchargeables pour les tests
const policeActive = process.env.PDJ_FPS_POLICE !== "off";
const policeMin = dureeEnv("PDJ_FPS_POLICE_MIN_MS");
const policeMax = dureeEnv("PDJ_FPS_POLICE_MAX_MS");
const policeIntervalle = intervalleEnv(policeMin, policeMax);
const policeDuree = dureeEnv("PDJ_FPS_POLICE_DUREE_MS");
const policePv = dureeEnv("PDJ_FPS_POLICE_PV");
/** Battle Royale, essais : délai fixe du premier essai après le départ de l'avion (remplace aussi les 60 s après le premier atterrissage) */
const policeBr = dureeEnv("PDJ_FPS_BR_POLICE_MS");
/**
 * Réglages d'événements du hall `ar1` (la partie permanente) : `PDJ_FPS_EVT_ACTIFS` (liste CSV d'identifiants ; ABSENTE : tous ; présente mais VIDE : aucun
 * événement) et `PDJ_FPS_EVT_FREQUENCE` (calme | normal | chaos). Les arènes créées par un joueur ont les leurs (`mode{partie:"nouvelle", reglages}`).
 */
const evtActifsEnv = process.env.PDJ_FPS_EVT_ACTIFS;
const reglagesHall: ReglagesArene = (() => {
  const r = normaliserReglages({
    evenements: evtActifsEnv === undefined ? undefined : evtActifsEnv.split(",").map((x) => x.trim()).filter(Boolean),
    frequence: process.env.PDJ_FPS_EVT_FREQUENCE,
  });
  return policeActive ? r : { ...r, evenements: r.evenements.filter((e) => e !== "police") };
})();
/** Intervalles fixés par l'environnement : jamais mis à l'échelle par la fréquence (les tests de bout en bout restent déterministes). */
const imposes: ImposesEnv = {
  elsa: elsaMin !== undefined || elsaMax !== undefined, avion: avionMin !== undefined || avionMax !== undefined, bus: busMin !== undefined || busMax !== undefined,
  evenements: evtMin !== undefined || evtMax !== undefined, police: policeIntervalle !== undefined,
};
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
/**
 * Un tic de décalage de phase par salle créée (0, 17, 34 ms) : les salles ne tiquent pas toutes au même instant, leurs snaps (20 Hz) non plus. Passé
 * comme « maintenant » de création, jamais comme horloge de jeu (`Salle.tic` borne `dt` à 0 si l'horloge est en avance).
 */
let nbCreations = 0;
const maintenantCreation = (): number => Date.now() + (nbCreations++ % 3) * 17;
/** Compteur des salles d'arène créées : clé de la voiture de police dans le budget de recherches de chemin du serveur. */
let nbSallesArene = 0;
/**
 * Une arène neuve, avec son propre monde (grille de collision à tampon non réentrant, brèches) et SES réglages d'événements (le hall : ceux de l'environnement,
 * une arène créée par un joueur : les siens) ; `options`, `circuits`, `cachettes` sont en lecture seule. Les routes de départ de la police sont celles des
 * points d'apparition ; son chemin passe par le budget de recherches du serveur (un A* par 12 ms, toutes parties confondues).
 */
function creerSalleArene(config?: unknown): Salle {
  const reglages = config === undefined ? reglagesHall : normaliserReglages(config);
  const monde = construireMonde(scene);
  copierCarteNavigation(mondeRefArene, monde, DEGAGEMENT_VOITURE_M);
  const cle = `police:ar${++nbSallesArene}`;
  const police: OptionsPolice | undefined = policeActive
    ? {
      points: apparitions, chemin: cheminPourPolice(monde, (t) => budgetNavigationBr.demander(cle, t)),
      ...(policeIntervalle ? { intervalle: { premier: policeIntervalle, entre: policeIntervalle } } : {}),
      ...(policePv !== undefined ? { pvMax: policePv } : {}), ...(policeDuree !== undefined ? { dureeMs: policeDuree } : {}),
    }
    : undefined;
  return new Salle(monde, apparitions, Math.random, maintenantCreation(), optionsDepuisReglages(reglages, { ...options, ...(police ? { police } : {}) }, imposes));
}

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
/**
 * (2026-10-30, essais) patrouille de police en ambiance des zombies : `PDJ_FPS_ZOMBIES_PATROUILLE=off` la coupe (les e2e déterministes), sinon première
 * manche éligible (`_PATROUILLE_MANCHE`, 3) et délai du premier passage ET entre deux (`_PATROUILLE_MS`, 0 = dès le début de la manche)
 */
const patrouilleManche = dureeEnv("PDJ_FPS_ZOMBIES_PATROUILLE_MANCHE");
const patrouilleMs = nombreEnvOuZero("PDJ_FPS_ZOMBIES_PATROUILLE_MS");
const optionsPatrouille = process.env.PDJ_FPS_ZOMBIES_PATROUILLE === "off" ? { patrouille: false as const } : {
  ...(patrouilleManche !== undefined || patrouilleMs !== undefined
    ? { patrouille: { ...(patrouilleManche !== undefined ? { manche: patrouilleManche } : {}), ...(patrouilleMs !== undefined ? { delaiMs: patrouilleMs } : {}) } } : {}),
};
/**
 * (v11, essais) suspension de la partie par un joueur : durée maximale (5 min), compte à rebours de la levée (3 s ; 0 = levée immédiate, e2e), délai entre
 * deux suspensions d'un joueur (10 s) et pause cumulée par partie (15 min) ; les trois limites ne valent que s'il y a plusieurs humains admis.
 */
const suspensionMax = dureeEnv("PDJ_FPS_ZOMBIES_SUSPENSION_MAX_MS");
const suspensionCompte = nombreEnvOuZero("PDJ_FPS_ZOMBIES_COMPTE_MS");
const suspensionDelai = nombreEnvOuZero("PDJ_FPS_ZOMBIES_SUSPENSION_COOLDOWN_MS");
const suspensionTotal = dureeEnv("PDJ_FPS_ZOMBIES_SUSPENSION_TOTAL_MS");
const optionsSuspension = {
  ...(suspensionMax !== undefined ? { maxMs: suspensionMax } : {}),
  ...(suspensionCompte !== undefined ? { compteMs: suspensionCompte } : {}),
  ...(suspensionDelai !== undefined ? { cooldownMs: suspensionDelai } : {}),
  ...(suspensionTotal !== undefined ? { totalMs: suspensionTotal } : {}),
};
const optionsZombies: OptionsSalle = {
  ...(Object.keys(optionsSuspension).length ? { suspension: optionsSuspension } : {}),
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
    ...optionsPatrouille,
  },
};
const departsZombies = DEPARTS.map((d) => [d[0], d[1]] as [number, number]);
/** Une salle de zombies neuve, avec son monde (portes achetées, navigation en cache par monde) ; `donneesZombies(scene)` est lu seulement. */
function creerSalleZombies(): Salle {
  return new Salle(construireMondeZombies(scene), departsZombies, Math.random, maintenantCreation(), optionsZombies);
}

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
/**
 * (v11) Bots du Battle Royale : plafond par partie (`PDJ_FPS_BR_BOTS_MAX`, 20 ; 0 les coupe : le lobby n'affiche plus le réglage), quota global toutes parties
 * confondues (`PDJ_FPS_BR_BOTS_TOTAL`, 24 tant que la charge agrégée n'est pas mesurée sur le VPS : 4 parties se partagent 1 vCPU) et essai déterministe
 * (`PDJ_FPS_BR_BOTS_ESSAI=agressif` : graine fixe, les bots cherchent le joueur humain et reçoivent une mitraillette en atterrissant).
 */
const botsMaxBr = Math.floor(nombreEnvOuZero("PDJ_FPS_BR_BOTS_MAX") ?? BR.botsMax);
const botsTotalBr = Math.floor(nombreEnvOuZero("PDJ_FPS_BR_BOTS_TOTAL") ?? 24);
const botsEssaiBr = process.env.PDJ_FPS_BR_BOTS_ESSAI === "agressif" ? ("agressif" as const) : undefined;
/**
 * (lot 3b) Navigation des bots : la grille de navigation d'un monde BR et ses composantes connexes coûtent ≈ 0,45 s à la première demande, ce qui gèlerait toutes les
 * parties à la création de la suivante. Elles sont donc calculées ICI, une fois, avant `listen`, sur un monde de référence, puis copiées (`libre` ET `etats`) dans
 * chaque salle BR neuve (`creerSalleBr`). Un seul budget de recherches de chemin pour tout le serveur : au plus un A* par tic, toutes parties confondues.
 */
const mondeRefBr = construireMondeBr(scene);
const grilleBrReference = preparerNavigationBr(mondeRefBr);
carteNavigation(mondeRefBr, DEGAGEMENT_VOITURE_M);
/** Routes de départ de la voiture de police du Battle Royale : le pool `route` des emplacements de butin (hors bâtiments et eau), en (x, z). */
const pointsRouteBr: [number, number][] = pointsButin(scene, mondeRefBr).filter((p) => p.pool === "route").map((p) => [p.p[0], p.p[2]]);
const budgetNavigationBr = new BudgetNavigation();
/** Bots en jeu dans toutes les parties de Battle Royale du serveur. */
const optionsBr: OptionsSalle = {
  br: {
    scene,
    budgetNavigation: budgetNavigationBr,
    stats: persistanceBr,
    botsMax: botsMaxBr,
    botsRestants: () => botsRestantsGlobal(botsTotalBr, registre.liste("br").map((p) => p.salle.nombreBots())),
    ...(botsEssaiBr ? { botsEssai: botsEssaiBr } : {}),
    ...(minJoueursBr !== undefined ? { joueursMin: Math.floor(minJoueursBr) } : {}),
    ...(decompteBr !== undefined ? { decompteMaxMs: decompteBr } : {}),
    ...(volBr !== undefined ? { dureeVolMs: volBr } : {}),
    ...(altitudeBr !== undefined ? { altitude: altitudeBr } : {}),
    ...(echelleZoneBr !== undefined ? { echelleZone: echelleZoneBr } : {}),
    ...(objetsBr !== undefined ? { nbObjets: Math.floor(objetsBr) } : {}),
    ...(finBr !== undefined ? { finAffichageMs: finBr } : {}),
    ...(valideBr !== undefined ? { partieValideMinMs: valideBr } : {}),
    ...(policeBr !== undefined ? { policeMs: policeBr } : {}),
  },
  // à 10 Hz de snaps et 150 ms d'interpolation, la cible vue par le tireur a plus de retard qu'en arène : fenêtre de rejeu élargie
  rewindMaxMs: BR.rewindMaxMs,
  historiqueMs: BR.historiqueMs,
};
/**
 * Une salle Battle Royale neuve, avec son propre monde (≈ 90 ms et 2 Mo). Le point de départ n'est jamais utilisé (le service place les
 * joueurs dans l'avion) : le centre des bornes du monde.
 */
let nbSallesBr = 0;
function creerSalleBr(): Salle {
  const mondeBr = construireMondeBr(scene);
  installerNavigationBr(mondeBr, grilleBrReference);
  copierCarteNavigation(mondeRefBr, mondeBr, DEGAGEMENT_VOITURE_M);
  const depart: [number, number][] = [[(mondeBr.bornes.x0 + mondeBr.bornes.x1) / 2, (mondeBr.bornes.z0 + mondeBr.bornes.z1) / 2]];
  // descente de police du BR : armée par le service BR (`armer`), jamais seule ; sa voiture cherche ses chemins sur la grille de dégagement 1,8 m
  const cle = `police:br${++nbSallesBr}`;
  const police: OptionsPolice | undefined = policeActive
    ? {
      points: pointsRouteBr, chemin: cheminPourPolice(mondeBr, (t) => budgetNavigationBr.demander(cle, t)),
      ...(policePv !== undefined ? { pvMax: policePv } : {}), ...(policeDuree !== undefined ? { dureeMs: policeDuree } : {}),
    }
    : undefined;
  return new Salle(mondeBr, depart, Math.random, maintenantCreation(), { ...optionsBr, ...(police ? { police } : {}) });
}
/**
 * Les parties du serveur : `ar1`, `z1` et `br1` permanentes (jamais refermées), les autres créées par `mode{partie:"nouvelle"}` et refermées dès qu'elles
 * n'ont plus de membre humain. Plafonds par mode (`PDJ_FPS_ARENE_PARTIES` 2, `PDJ_FPS_ZOMBIES_PARTIES` 3, `PDJ_FPS_BR_PARTIES` 4) et au total
 * (`PDJ_FPS_PARTIES_TOTAL` 6 tant que la charge agrégée n'est pas mesurée sur le VPS), avec une création réservée par mode : chaque salle vivante coûte
 * son monde en mémoire et un tic, sur un conteneur plafonné à 1 vCPU.
 */
const entierEnv = (nom: string, defaut: number): number => Math.max(1, Math.floor(nombreEnv(nom) ?? defaut));
/** Membres humains d'une salle (lobby, spectateurs et sessions coupées compris, bots exclus) : une partie sans humain est refermée et n'est plus tiquée. */
const humains = (salle: Salle): number => salle.nombreHumains();
const registre = new RegistreParties<Salle>({
  fabriques: { arene: (config) => creerSalleArene(config), zombies: () => creerSalleZombies(), br: () => creerSalleBr() },
  max: { arene: entierEnv("PDJ_FPS_ARENE_PARTIES", 2), zombies: entierEnv("PDJ_FPS_ZOMBIES_PARTIES", 3), br: entierEnv("PDJ_FPS_BR_PARTIES", 4) },
  maxTotal: entierEnv("PDJ_FPS_PARTIES_TOTAL", 6),
  humains,
  permanentes: MODES_SALLE,
});
/** Les salles permanentes (résumés `salons.arene` / `.zombies` / `.br` des clients d'avant les parties parallèles, `/sante`). */
const salleArene = registre.parId("ar1")!.salle;
const salleZombies = registre.parId("z1")!.salle;
const salleBr = registre.parId("br1")!.salle;
/** Garde-fous contre les créations en rafale (construire un monde coûte 17 à 90 ms, la première grille de navigation ≈ 430 ms) : cf. `LimiteCreation`. */
const limiteCreation = new LimiteCreation({
  delaiMs: nombreEnv("PDJ_FPS_CREATION_DELAI_MS") ?? 10_000, parIpMax: entierEnv("PDJ_FPS_PARTIES_PAR_IP", 2),
  rafaleIp: entierEnv("PDJ_FPS_CREATION_RAFALE_IP", 3), ticsLentsMax: entierEnv("PDJ_FPS_CREATION_TICS_LENTS", 3),
});
/** Un tic au-dessus de ce seuil (ms) est « lent » pour le disjoncteur de création ; il en faut `PDJ_FPS_CREATION_TICS_LENTS` dans des secondes distinctes. */
const CREATION_TIC_MAX_MS = nombreEnv("PDJ_FPS_CREATION_TIC_MAX_MS") ?? 12;
const ticRecent = new FenetreMax(10_000);
/** Le tic qui suit une création de partie paie la première grille de navigation de la nouvelle salle : il ne compte pas pour le disjoncteur. */
let ignorerTicSuivant = false;
/** Le Battle Royale des clients d'avant la v11 créait ses parties sans limite (4 au plus) : aucune limite de création pour eux. */
const creationLibre = (c: Client, mode: ModeSalle): boolean => mode === "br" && c.version < 11;
/** Places d'arène choisies par `mode{arene, partie:"auto"}` et pas encore occupées (5 s). */
const reservations = new Reservations(5_000);
/** Referme les parties non permanentes sans membre humain. Vrai si une partie a été refermée. */
function refermerPartiesVides(): boolean {
  const retirees = registre.refermerVides();
  for (const p of retirees) {
    limiteCreation.oublierPartie(p.id);
    console.log(`- partie ${p.id} (${registre.nombre()} en tout)`);
  }
  return retirees.length > 0;
}

/** Les salles par mode : `modeDeSalle` retrouve le mode d'un client par identité de sa salle. */
const SALLES = (): Record<ModeSalle, readonly Salle[]> => ({
  arene: registre.liste("arene").map((p) => p.salle), zombies: registre.liste("zombies").map((p) => p.salle), br: registre.liste("br").map((p) => p.salle),
});

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
  /** (2026-10-30) capacités annoncées au `bonjour` (liste blanche `CAPACITES_CONNUES`) : sans `police`, le joueur est invisible pour la descente de police */
  capacites: string[];
}
const clients = new Map<string, Client>();

const parIp = new Map<string, number>();

/**
 * (v8) Sessions RÉSEAU coupées gardées pour une reprise : id → jeton, salle, minuteur de la déconnexion définitive. Ne pas confondre avec la
 * suspension d'une partie par un joueur (la pause du lot 2) : `/sante.zombies.enSuspens` compte ces sessions coupées.
 */
interface SessionCoupee { jeton: string; salle: Salle; minuteur: ReturnType<typeof setTimeout> }
const coupees = new Map<string, SessionCoupee>();
const nouveauJeton = (): string => randomBytes(18).toString("base64url");

/** Ajoute le jeton de reprise de `c` à son `bienvenue` (inscription ou changement de salle). */
function avecJeton(c: Client, sorties: Sortie[]): Sortie[] {
  return sorties.map((s) => (s.a === c.id && s.m.t === "bienvenue" ? { ...s, m: { ...s.m, jeton: c.jeton } } : s));
}

/**
 * Connexion fermée d'un inscrit : un membre d'une partie de zombies en cours (n'importe laquelle : `z1`, `z2`…) dont la connexion est tombée (pas un
 * départ volontaire, `garderPourReprise`) est gardé `REPRISE_MS` (sa partie continue, il est immobile) ; les autres sont déconnectés tout de suite.
 * La partie qui n'a plus de membre humain est refermée tout de suite (et non au prochain passage du timer des salons).
 */
function fermer(c: Client, code: number): void {
  reservations.liberer(c.id);
  if (!c.inscrit) return;
  const pseudo = c.salle.inspecter(c.id)?.pseudo;
  const garder = garderPourReprise({
    estZombies: c.salle.mode() === "zombies", membre: !!c.salle.inspecter(c.id), code, phase: c.salle.resumeZombies()?.phase ?? null,
  });
  if (garder) {
    const salle = c.salle, id = c.id;
    const coupeT = Date.now();
    // (v11) une salle suspendue ne fait pas avancer le jeu : l'échéance de reprise passe de 20 s à `REPRISE_SUSPENDUE_MS` depuis la coupure
    const armer = (delai: number): ReturnType<typeof setTimeout> => {
      const m = setTimeout(() => {
        const reste = coupeT + REPRISE_SUSPENDUE_MS - Date.now();
        if (salle.suspendue() && reste > 0 && coupees.get(id)) {
          const suite = armer(reste);
          coupees.set(id, { ...coupees.get(id)!, minuteur: suite });
          return;
        }
        coupees.delete(id);
        try { diffuser(salle, salle.deconnecter(id, Date.now())); } catch (e) { console.error("déconnexion:", e); }
        console.log(`- ${pseudo} (reprise expirée, ${salle.nombreJoueurs()} en ligne)`);
        refermerPartiesVides();
        diffuserSalons();
      }, delai);
      m.unref();
      return m;
    };
    const minuteur = armer(salle.suspendue() ? REPRISE_SUSPENDUE_MS : REPRISE_MS);
    coupees.set(id, { jeton: c.jeton, salle, minuteur });
    console.log(`~ ${pseudo} (coupure, reprise possible ${REPRISE_MS / 1000} s)`);
    return;
  }
  try { diffuser(c.salle, c.salle.deconnecter(c.id, Date.now())); } catch (e) { console.error("déconnexion:", e); }
  console.log(`- ${pseudo} (${c.salle.nombreJoueurs()} en ligne)`);
  refermerPartiesVides();
}

/**
 * (v8) `bonjour.reprise` : la session coupée est rattachée à cette connexion (même id, même salle) si son jeton est le bon et qu'elle attend
 * encore ; renvoie vrai si c'est fait. (v11) Seulement si la partie d'origine existe encore dans le registre : sinon (partie refermée) le client est
 * routé comme un arrivant, jamais vers l'état d'une autre partie.
 */
function reprendre(c: Client, reprise: unknown, pseudo: unknown, maintenant: number): boolean {
  if (!reprise || typeof reprise !== "object") return false;
  const { id, jeton } = reprise as { id?: unknown; jeton?: unknown };
  if (typeof id !== "string" || typeof jeton !== "string") return false;
  let salle: Salle;
  const ancien = clients.get(id);
  if (ancien && ancien !== c) {
    // l'ancienne connexion n'est pas encore vue fermée (coupure Wi-Fi : pas de FIN, le ping ne la détecte qu'en 5 à 10 s) : elle est remplacée
    if (!ancien.inscrit || ancien.jeton !== jeton || ancien.salle.mode() !== "zombies" || !registre.deSalle(ancien.salle) || !ancien.salle.inspecter(id)) return false;
    ancien.inscrit = false; // sa fermeture ne déconnecte plus le joueur
    clients.delete(id);
    ancien.ws.terminate();
    salle = ancien.salle;
  } else {
    const s = coupees.get(id);
    if (!s || s.jeton !== jeton || !registre.deSalle(s.salle) || !s.salle.inspecter(id)) return false;
    clearTimeout(s.minuteur);
    coupees.delete(id);
    salle = s.salle;
  }
  clients.delete(c.id);
  c.id = id;
  clients.set(id, c);
  c.salle = salle;
  c.inscrit = true;
  c.jeton = nouveauJeton();
  c.salle.definirCapacites(id, c.capacites);
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
/** Partie de zombies ou de Battle Royale d'une salle (null pour l'arène) : seules ces parties relaient leur aperçu aux spectateurs des autres. */
function partieApercuDe(salle: Salle): Partie<Salle> | null {
  const p = registre.deSalle(salle);
  return p && p.mode !== "arene" ? p : null;
}

function diffuser(salle: Salle, sorties: Sortie[]): void {
  const source = partieApercuDe(salle);
  for (const s of sorties) {
    // aperçu d'une partie de BR ou (v11) de zombies : le BR porte l'id de la partie (le bandeau de la vue Palantir le dit) ; relayé aux spectateurs des
    // autres parties du même mode
    const m = s.m.t === "apercu" && source?.mode === "br" ? { ...s.m, partie: source.id } : s.m;
    const texte = JSON.stringify(m);
    if (m.t === "apercu" && source) {
      relayerApercu(source, texte);
      // une partie qui n'est pas en cours (lobby) ne montre pas son propre aperçu vide à ses spectateurs quand ils regardent celle d'une autre partie
      const regardee = partieApercu(source.mode as "zombies" | "br", apercusParties(source.mode as "zombies" | "br"), source.id);
      if (regardee && regardee !== source.id) continue;
    }
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

/** Parties d'un mode vues par `partieApercu` (id, phase, joueurs en lice : survivants du BR, joueurs d'une partie de zombies). */
const apercusParties = (mode: "zombies" | "br"): PartieApercu[] =>
  registre.liste(mode).map((p) => {
    if (mode === "zombies") { const r = p.salle.resumeZombies(); return { id: p.id, phase: r?.phase ?? "lobby", vivants: r?.joueurs ?? 0 }; }
    const r = p.salle.resumeBr();
    return { id: p.id, phase: r?.phase ?? "lobby", vivants: r?.vivants ?? 0 };
  });

/**
 * Un client de zombies ou de Battle Royale dont la partie n'est pas en cours voit l'aperçu de la partie en cours de son mode qui compte le plus de
 * joueurs en lice (`partieApercu`) : le message de `source` est relayé à ceux de ses spectateurs inscrits hors jeu dans une AUTRE partie du même mode
 * (v11 : un spectateur du Palantir qui coche les zombies arrive dans un lobby vide et doit voir la partie des autres).
 */
function relayerApercu(source: Partie<Salle>, texte: string): void {
  const mode = source.mode as "zombies" | "br";
  const parties = apercusParties(mode);
  for (const c of clients.values()) {
    if (!c.inscrit || c.salle === source.salle) continue;
    const sienne = partieApercuDe(c.salle);
    if (!sienne || sienne.mode !== mode || c.salle.inspecter(c.id)?.enJeu) continue;
    if (partieApercu(mode, parties, sienne.id) === source.id) envoyer(c, texte);
  }
}

/** Pose `relaiApercu` sur les parties qu'au moins un spectateur d'une autre partie du même mode regarde (une fois par seconde). */
function majRelaisApercu(): void {
  for (const mode of ["zombies", "br"] as const) {
    const parties = apercusParties(mode);
    const regardees = new Set<string>();
    for (const p of registre.liste(mode)) {
      if (p.salle.nombreJoueurs() <= p.salle.nombreEnJeu()) continue;
      const cible = partieApercu(mode, parties, p.id);
      if (cible && cible !== p.id) regardees.add(cible);
    }
    for (const p of registre.liste(mode)) p.salle.relaiApercu = regardees.has(p.id);
  }
}

function refuser(c: Client, code: Extract<MessageServeur, { t: "erreur" }>["code"], message: string): void {
  envoyer(c, JSON.stringify({ t: "erreur", code, message } satisfies MessageServeur));
  c.ws.close(1008, code);
}

/** Phase d'une partie pour le routage et les résumés : "arene", ou celle du service (zombies, BR). */
function phaseDe(p: Partie<Salle>): string {
  if (p.mode === "zombies") return p.salle.resumeZombies()?.phase ?? "lobby";
  if (p.mode === "br") return p.salle.resumeBr()?.phase ?? "lobby";
  return "arene";
}

/** Résumé d'une partie de Battle Royale (`salons.parties`, clients d'avant la v11). */
function resumePartieBr(p: Partie<Salle>): ResumePartieBr {
  const r = p.salle.resumeBr() ?? { phase: "lobby" as const, joueurs: p.salle.nombreHumains(), vivants: 0 };
  // les champs des bots n'existent pas pour les clients d'avant la v11 (`listes` les porte)
  const { bots: _bots, botsMax: _botsMax, botsRestants: _botsRestants, ...base } = r;
  return { id: p.id, ...base };
}

/** Résumé d'une partie (`salons.listes`, `/sante.parties`) : membres humains, capacité de JEU du mode, hôte, avancement. */
function resumePartie(p: Partie<Salle>): ResumePartie {
  const base = { id: p.id, mode: p.mode, joueurs: humains(p.salle) };
  if (p.mode === "zombies") {
    const r = p.salle.resumeZombies();
    return { ...base, phase: r?.phase ?? "lobby", capacite: ZOMBIES.joueursMax, manche: r?.manche ?? 0, ...(r?.suspendue ? { suspendue: true as const } : {}) };
  }
  if (p.mode === "br") {
    const r = p.salle.resumeBr();
    return {
      ...base, phase: r?.phase ?? "lobby", capacite: BR.joueursMax, vivants: r?.vivants ?? 0,
      ...(r?.palier !== undefined ? { palier: r.palier } : {}), ...(r?.hote ? { hote: r.hote } : {}),
      ...(r?.bots ? { bots: r.bots } : {}),
      // quota restant : borne ce que l'hôte peut demander (0 : le lobby désactive le réglage)
      ...(r?.botsMax !== undefined ? { botsMax: r.botsMax } : {}), ...(r?.botsRestants !== undefined ? { botsRestants: r.botsRestants } : {}),
    };
  }
  return { ...base, phase: "arene", capacite: JEU.joueursMax, enJeu: p.salle.nombreEnJeu(), ...(p.salle.reglages ? { reglages: p.salle.reglages } : {}) };
}

/**
 * Résumé des salles (choix du mode, compteurs) : les champs historiques décrivent les parties PERMANENTES (`ar1`, `z1`, `br1`), `parties` toutes
 * les parties de Battle Royale (clients v10), `listes` les parties de chaque mode (clients v11).
 */
function salons(): MessageServeur {
  const z = salleZombies.resumeZombies() ?? { phase: "lobby" as const, joueurs: salleZombies.nombreJoueurs(), manche: 0 };
  return messageSalons(
    { joueurs: salleArene.nombreJoueurs(), enJeu: salleArene.nombreEnJeu() }, z, salleBr.resumeBr(), registre.liste("br").map(resumePartieBr),
    { arene: registre.liste("arene").map(resumePartie), zombies: registre.liste("zombies").map(resumePartie), br: registre.liste("br").map(resumePartie) },
  );
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

/** Les parties d'un mode vues par le routage (permanente en tête). Arène : `accueille` compte les places réservées mais pas encore occupées. */
function partiesRoutage(mode: ModeSalle, maintenant: number): PartieRoutage[] {
  // les places se comptent bots compris (`Salle.connecter` refuse à `joueursMax` membres de la table) : un arrivant reçoit `refus{plein}`, jamais une fermeture de socket
  return registre.liste(mode).map((p) => partieRoutageDe(mode, {
    id: p.id, membres: p.salle.nombreJoueurs(), phase: phaseDe(p), enJeu: mode === "arene" ? p.salle.nombreEnJeu() : undefined,
    reserves: mode === "arene" ? reservations.compter(p.id, maintenant) : 0,
  }));
}

/**
 * Changement de salle (`mode`), ou de partie (`partie`, les trois modes depuis la v11). Refusé AVANT de quitter l'ancienne salle (sinon `connecter`
 * renverrait `erreur{plein}` et la socket serait fermée) : en jeu (`lobby`), salle d'arrivée pleine (`plein`), plus de partie possible ou création trop
 * rapprochée (`limite`). Le pseudo et l'id sont conservés ; la nouvelle salle répond `mode` (écho, avec la partie) puis `bienvenue`.
 */
function changerMode(c: Client, mode: unknown, partie: unknown, maintenant: number, reglagesBruts?: unknown): void {
  const modeDemande = (MODES_SALLE as readonly unknown[]).includes(mode) ? (mode as ModeSalle) : null;
  // (2026-10-30) réglages d'événements d'une arène : validés ICI sur la liste fermée (jamais le brut), lus seulement pour une création
  const demandes: ReglagesArene | null = modeDemande === "arene" && partie === PARTIE_NOUVELLE ? normaliserReglages(reglagesBruts) : null;
  const reglagesDe = (id: string): ReglagesArene => registre.parId(id)?.salle.reglages ?? REGLAGES_DEFAUT;
  // créer une partie est possible si le registre le permet ET si les limites de création le permettent : sinon le routage par défaut se rabat sur la
  // première partie qui a de la place (au lieu d'un `refus{limite}` sans issue) et `partie:"nouvelle"` explicite est refusé `limite`
  const peutCreer = modeDemande !== null && registre.peutOuvrir(modeDemande)
    && (creationLibre(c, modeDemande) || limiteCreation.verifier(c.id, c.ip, modeDemande, maintenant, ticRecent.secondesAuDessus(CREATION_TIC_MAX_MS, maintenant)) === "ok");
  const decision = decisionMode({
    mode, salleActuelle: modeDeSalle(c.salle, SALLES()), enJeu: c.salle.inspecter(c.id)?.enJeu ?? false, joueursCible: 0, version: c.version,
    partie, partieActuelle: registre.deSalle(c.salle)?.id ?? null,
    parties: modeDemande ? partiesRoutage(modeDemande, maintenant) : [], creerPossible: peutCreer,
    // une arène vide n'est reprise que par qui veut EXACTEMENT ses réglages (ni le hall vide ni une arène personnalisée pas encore refermée pour d'autres réglages)
    ...(demandes ? { accepteVide: (p: PartieRoutage) => reglagesEgaux(reglagesDe(p.id), demandes) } : {}),
  });
  if (!decision) return;
  if (decision.action === "version") return refuser(c, "version", "Version du protocole incompatible : rechargez la page.");
  const refus = (raison: "lobby" | "plein" | "limite"): void => envoyer(c, JSON.stringify({ t: "refus", action: "mode", raison } satisfies MessageServeur));
  if (decision.action === "refus") return refus(decision.raison);
  // arène : l'arrivant qui demande « auto » réserve sa place le temps d'envoyer `rejoindre` (course à 15/16)
  const reserver = (id: string): void => { if (decision.mode === "arene" && partie === PARTIE_AUTO) reservations.reserver(c.id, id, maintenant); };
  if (decision.action === "echo") {
    if (decision.partie) reserver(decision.partie);
    const sienne = decision.partie ? registre.parId(decision.partie)?.salle.reglages : null;
    envoyer(c, JSON.stringify({ t: "mode", mode: decision.mode, ...(decision.partie ? { partie: decision.partie } : {}), ...(sienne ? { reglages: sienne } : {}) } satisfies MessageServeur));
    return;
  }
  let partieCible: Partie<Salle> | null;
  if (decision.partie === PARTIE_NOUVELLE) {
    // une vraie création : plafonds et limites déjà jugés dans `peutCreer` (la décision ne renvoie `nouvelle` que s'il est vrai)
    if (!peutCreer) return refus("limite");
    const debut = performance.now();
    partieCible = registre.ouvrir(decision.mode, decision.mode === "arene" && demandes ? demandes : undefined);
    if (!creationLibre(c, decision.mode)) limiteCreation.noter(partieCible.id, decision.mode, c.id, c.ip, maintenant);
    ignorerTicSuivant = true;
    console.log(`+ partie ${partieCible.id} (${registre.nombre()} en tout, créée en ${Math.round(performance.now() - debut)} ms)`);
  } else {
    partieCible = decision.partie ? registre.parId(decision.partie) : null;
    if (!partieCible) return;
  }
  reserver(partieCible.id);
  const cible = partieCible.salle;
  const pseudo = c.salle.inspecter(c.id)?.pseudo ?? "";
  const ancienne = c.salle;
  const depart = ancienne.deconnecter(c.id, maintenant);
  c.salle = cible; // avant de diffuser le départ : le client ne reçoit plus rien de l'ancienne salle
  diffuser(ancienne, depart);
  // l'écho porte les réglages de la partie rejointe : le client sait ce qui a été appliqué
  const echo: MessageServeur = { t: "mode", mode: decision.mode, partie: partieCible.id, ...(cible.reglages ? { reglages: cible.reglages } : {}) };
  const entree = cible.connecter(c.id, pseudo, maintenant);
  cible.definirCapacites(c.id, c.capacites);
  diffuser(cible, avecJeton(c, [{ a: c.id, m: echo }, ...entree]));
  refermerPartiesVides();
  diffuserSalons();
}

/**
 * `rejoindre` refusé pour `plein` en arène : le refus porte l'id d'une AUTRE arène qui accueille (la plus peuplée en jeu), pour que le lobby propose
 * « Changer d'arène ». Aucune création ici : sans alternative, le lobby propose « Créer une arène ».
 */
function avecAlternative(c: Client, sorties: Sortie[], maintenant: number): Sortie[] {
  const courante = registre.deSalle(c.salle)?.id;
  return sorties.map((s) => {
    if (s.a !== c.id || s.m.t !== "refus" || s.m.action !== "rejoindre" || s.m.raison !== "plein") return s;
    let meilleure: PartieRoutage | null = null;
    for (const p of partiesRoutage("arene", maintenant)) {
      if (p.id === courante || !p.accueille || p.joueurs >= capaciteSalle("arene")) continue;
      if (!meilleure || (p.enJeu ?? 0) > (meilleure.enJeu ?? 0)) meilleure = p;
    }
    return meilleure ? { ...s, m: { ...s.m, alternative: meilleure.id } } : s;
  });
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
    // lues AVANT la reprise : une session reprise garde les capacités de sa nouvelle connexion
    c.capacites = capacitesAcceptees(m.capacites);
    if (reprendre(c, m.reprise, m.pseudo, maintenant)) { diffuserSalons(c); return; }
    const sorties = avecJeton(c, c.salle.connecter(c.id, typeof m.pseudo === "string" ? m.pseudo : "", maintenant));
    c.salle.definirCapacites(c.id, c.capacites);
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
  if (m.t === "mode") return changerMode(c, m.mode, m.partie, maintenant, m.reglages);
  if (m.t === "rejoindre") reservations.liberer(c.id);
  const sorties = c.salle.recevoir(c.id, m, maintenant);
  diffuser(c.salle, m.t === "rejoindre" && c.salle.mode() === "arene" ? avecAlternative(c, sorties, maintenant) : sorties);
}

/** Un tic (toutes les salles et leurs diffusions) plus long que ça est « lent » : le CPU du conteneur est plafonné et toutes les parties partagent la boucle. */
const TIC_LENT_MS = 8;
/** `/sante.ticMaxMs` et `alerte` couvrent la dernière minute (deux fenêtres de 60 s glissées l'une sur l'autre). */
const FENETRE_TIC_MS = 60_000;
const mesuresTic = { depuis: Date.now(), maxFenetre: 0, maxPrecedente: 0, lents: 0, dernierLentT: 0, salles: 0 };

/** Enregistre la durée d'un tic ; fait glisser la fenêtre d'une minute. */
function noterTic(dureeMs: number, maintenant: number): void {
  if (ignorerTicSuivant) ignorerTicSuivant = false; else ticRecent.noter(dureeMs, maintenant);
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
      // champs plats historiques : les parties permanentes (`ar1`, `z1`, `br1`)
      ok: true, joueurs: salleArene.nombreJoueurs(), enJeu: salleArene.nombreEnJeu(), match: salleArene.infoMatch().numero,
      zombies: {
        joueurs: salleZombies.nombreJoueurs(), enJeu: salleZombies.nombreEnJeu(), phase: z?.phase ?? "lobby", manche: z?.manche ?? 0,
        // (v11) partie figée par un joueur (pause) : distinct de `enSuspens`, les sessions RÉSEAU coupées
        suspendue: salleZombies.suspendue(),
        // (v8) sessions RÉSEAU coupées qui attendent leur reprise (toutes les parties de zombies) ; pas la suspension d'une partie par un joueur
        enSuspens: coupees.size,
      },
      br: {
        // humains seulement (les bots sont comptés à part)
        joueurs: salleBr.nombreHumains(), bots: salleBr.nombreBots(), enJeu: salleBr.nombreEnJeu(), phase: b?.phase ?? "lobby", vivants: b?.vivants ?? 0,
        // toutes les parties de Battle Royale, salle permanente comprise
        parties: registre.liste("br").map((p) => ({ ...resumePartieBr(p), enJeu: p.salle.nombreEnJeu() })),
      },
      // (v11) toutes les parties de tous les modes
      parties: registre.liste().map((p) => ({
        id: p.id, mode: p.mode, permanente: p.permanente, joueurs: p.salle.nombreJoueurs(), humains: humains(p.salle), bots: p.salle.nombreBots(), phase: phaseDe(p),
        ...(p.salle.suspendue() ? { suspendue: true } : {}),
      })),
      // (lot 3b) recherches de chemin des bots depuis le démarrage, le plus gros A* (nœuds ; borné à 3 000) et les bots qui attendent leur tour
      navigationBots: { recherches: budgetNavigationBr.recherches, noeudsMax: budgetNavigationBr.noeudsMax, enAttente: budgetNavigationBr.enAttente },
      sallesTiquees: mesuresTic.salles,
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
    jeton: nouveauJeton(), version: 0, capacites: [],
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

/** Membre d'un lobby (zombies ou Battle Royale) qui attend l'hôte avec au moins un autre joueur : jamais recyclé pour inactivité. */
function attendDansLobby(c: Client): boolean {
  const mode = c.salle.mode();
  const r = mode === "br" ? c.salle.resumeBr() : mode === "zombies" ? c.salle.resumeZombies() : null;
  return !!r && r.phase === "lobby" && r.joueurs >= 2;
}

// Connexions mortes : un client qui n'a pas répondu au ping précédent est fermé.
const timerPing = setInterval(() => {
  const maintenant = Date.now();
  for (const c of clients.values()) {
    if (!c.vivant) { c.ws.terminate(); continue; }
    if (c.inscrit && maintenant - c.utileT > SPECTATEUR_INACTIF_MS && !c.salle.inspecter(c.id)?.enJeu && !attendDansLobby(c)) { c.ws.close(1001, "inactif"); continue; }
    c.vivant = false;
    c.pingEnvoyeA = Date.now();
    c.ws.ping();
  }
}, PING_MS);

const timerTic = setInterval(() => {
  const debut = performance.now();
  let tiquees = 0;
  // une partie est tiquée si c'est l'arène permanente (Elsa, bus C3, présence du Palantir) ou si elle a au moins un membre humain : une salle vide ne coûte
  // rien. Les parties tiquent l'une après l'autre dans le même fil (les tampons de collision sont des scratch synchrones : jamais en parallèle).
  for (const p of registre.liste().slice()) {
    if (p.id !== "ar1" && humains(p.salle) === 0) continue;
    tiquees++;
    try { diffuser(p.salle, p.salle.tic(Date.now())); } catch (e) { console.error(`tic ${p.id}:`, e); }
  }
  mesuresTic.salles = tiquees;
  noterTic(performance.now() - debut, Date.now());
}, TIC_MS);

// Résumé des salles : à tous, une fois par seconde s'il a changé (le choix du mode affiche les compteurs en direct)
const timerSalons = setInterval(() => {
  try {
    // une partie vidée par une déconnexion est refermée ici (une fois par seconde suffit en plus des fermetures immédiates)
    refermerPartiesVides();
    majRelaisApercu();
    diffuserSalons();
  } catch (e) { console.error("salons:", e); }
}, 1000);

http.listen(PORT, "0.0.0.0", () => {
  console.log(`Arène FPS : ws://0.0.0.0:${PORT} (scène ${fichierScene}, ${apparitions.length} points d'apparition, ${cachettes.length} cachettes, ${registre.nombre()} parties permanentes, origines : ${ORIGINES.join(", ") || "toutes"}, stats BR : ${fichierStatsBr}, ${CONNEXIONS_PAR_IP_MAX} connexions par IP, ${CONNEXIONS_TOTAL_MAX} au total)`);
});

function arreter(): void {
  clearInterval(timerPing);
  clearInterval(timerTic);
  clearInterval(timerSalons);
  for (const s of coupees.values()) clearTimeout(s.minuteur);
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
