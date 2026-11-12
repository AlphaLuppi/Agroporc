/**
 * Rocket Muche EN LIGNE : CONTRAT RÉSEAU partagé entre les quatre lots d'implémentation (salle, prédiction, serveur, client / UI).
 * Source de vérité des messages, des constantes réseau et des signatures des modules `lib/rocket/reseau/*`. Il ne contient AUCUNE logique
 * hors constantes et petites fonctions pures triviales.
 *
 * Spec : docs/superpowers/specs/2026-11-08-rocket-en-ligne-design.md (prime sur tout commentaire d'un module en cas de divergence).
 *
 * Importable par le serveur (`serveur-fps`, Node 22, aucun DOM, ni `three` : les deux sont couverts par des stubs de types, cf. spec § 8.4) et
 * par le navigateur. N'importe donc que des TYPES de `../contrat` et `../match`, plus les constantes pures de `../contrat`. Ce fichier ne
 * touche NI `lib/fps/protocole.ts` NI `VERSION_PROTOCOLE` : Rocket a son propre chemin WebSocket (`/rocket`) et sa propre version.
 *
 * Deux familles de trames sur la même WebSocket :
 *  - TEXTE : un objet JSON `{ t: "<type>", … }` (lobby, événements, ping…), jamais plus de `RESEAU.tailleMaxTexteOctets`.
 *  - BINAIRE : premier octet = `TypeTrame`, deuxième = `numero` du match (u8). `entrees` (client → serveur, ≈ 40 octets, 60 Hz) et `snap`
 *    (serveur → client, 0,9 à 2,2 ko, 20 Hz). Un `snap` porte aussi `nbVoitures` : plus aucun décodage ne dépend d'un état posé ailleurs. Tout est
 *    lu et écrit par `DataView` en petit-boutiste. Le codage exact (`serialisation.ts`) est du ressort du lot SALLE.
 *
 * Révision 2026-11-08 (critiques netcode et intégration, cf. spec § 14) : retour d'entrées tardives (`manquees`, `avance` = pire cas), jeton de
 * reprise émis par le serveur HTTP après `salon` (message `session`), `numero` dans les trames, signatures du registre avec IP et horloge.
 */
import type {
  Arene, ConfigMatch, Equipe, EntreesVoiture, EtatBalle, EtatPlot, EtatVoiture, EvenementMatch, Format, MondeRocket, NiveauBot, ResultatMatch, Vec3,
} from "../contrat";
import { MATCH, PAS_S } from "../contrat";
import type { InterneMatch } from "../match";

// ============================================================================================================================
// 1. Constantes réseau
// ============================================================================================================================

/** Version du protocole Rocket en ligne (indépendante de `VERSION_PROTOCOLE` de l'arène). Un `bonjour` d'une autre version reçoit `erreur{version}`. */
export const VERSION_ROCKET = 2;
/** Chemin de la WebSocket Rocket sur le serveur HTTP de serveur-fps (`wss://pdj-fps.toam.tech/rocket`). */
export const CHEMIN_ROCKET = "/rocket";
/** Pas de la physique en ticks par seconde (120). Le « tick » est l'unité de temps de TOUT le protocole. */
export const TICKS_PAR_S = Math.round(1 / PAS_S);
/** Conversion tick ↔ millisecondes de jeu à vitesse normale. */
export const tickEnMs = (ticks: number): number => (ticks * 1000) / TICKS_PAR_S;
export const msEnTicks = (ms: number): number => (ms * TICKS_PAR_S) / 1000;

export const RESEAU = {
  // ---- cadences ----
  /** un instantané complet tous les 6 ticks = 20 Hz (10 Hz pendant la célébration au ralenti, car compté en ticks) */
  cadenceSnapTicks: 6,
  /** nombre d'entrées anciennes répétées dans chaque trame d'entrées (pertes, trames écartées par l'anti-flood) */
  redondanceEntrees: 3,
  /** au plus ce nombre d'entrées dans une trame (nouvelles + redondantes) */
  entreesMaxParTrame: 12,
  /** délai minimal entre deux trames d'entrées envoyées par le client (ms) : au plus 100 trames/s, ≈ 60 Hz à 60 images/s */
  intervalleTrameEntreesMs: 10,
  /** ping du client pendant un match / en lobby (ms) */
  pingMatchMs: 500,
  pingSalonMs: 2000,
  /** les événements du serveur sont regroupés dans un seul message au plus toutes les (ms) */
  flushEvenementsMs: 16,
  /** période du minuteur serveur de Rocket (ms) : un pas par réveil en régime normal, l'accumulateur rattrape le retard */
  periodeMinuteurServeurMs: 8,
  /**
   * pas physiques rattrapés au plus par salle et par réveil, plafond du temps versé à l'accumulateur par réveil (s), et budget de pas pour
   * TOUTES les salles d'un même réveil (≈ 6 ms à 50 µs le pas : le rattrapage d'un calage de 0,5 s est presque gratuit, mais six salles
   * ne doivent pas bloquer la boucle d'événements d'un seul coup). Le temps abandonné (calage de plus de `imageMaxServeurS`) est compté.
   */
  pasMaxRattrapageServeur: 60,
  imageMaxServeurS: 0.5,
  pasMaxTotalParReveil: 120,
  /** contre-pression d'émission : au-delà on saute les instantanés (ils sont complets), bien au-delà on coupe la socket (octets en attente) */
  bufferSauteSnapOctets: 65_536,
  bufferCoupureOctets: 262_144,
  /** vivacité de la socket : ping PROTOCOLAIRE (`ws.ping`, traité hors JS par le navigateur, donc aussi onglet masqué) et tolérance (ms) */
  pingProtocoleMs: 5_000,
  socketMorteMs: 10_000,

  // ---- entrées côté serveur ----
  /** taille de l'anneau d'entrées par joueur (ticks) */
  tamponEntrees: 256,
  /** une entrée portant un tick plus de `avanceMaxEntreesTicks` au-dessus du tick du monde est écartée (1 s : couvre un RTT de ~1,5 s) */
  avanceMaxEntreesTicks: 120,
  /** un instantané signale en plus `manquees` : ticks exécutés dans sa fenêtre SANS entrée vraie (répétée ou neutre), saturé à 255 */
  /** entrée manquante : la dernière connue est répétée au plus ce nombre de ticks consécutifs, puis entrées neutres */
  repetitionMaxTicks: 60,

  // ---- synchronisation d'horloge et prédiction (client) ----
  /** avance visée des entrées sur le tick du monde du serveur à leur arrivée (ticks), tolérance basse et haute */
  avanceCibleTicks: 4,
  avanceMinTicks: 2,
  avanceMaxTicks: 8,
  /**
   * marge adaptative ajoutée au demi-RTT dans `tickCible` (ticks) : valeur initiale et bornes. Plancher dynamique = ceil(`margeGigueFacteur`
   * × gigue en ticks) : le RTT filtré est un minimum, optimiste sous gigue. Une marge qui ne grandit que sur `avance` ne voit pas les entrées
   * tardives du milieu d'une trame : elle grandit AUSSI dès que `manquees` > 0 (+1 tick, +2 si `manquees` ≥ 4) et ne décroît que d'un tick
   * après `margeDecroissanceSnaps` instantanés consécutifs sans manquée et avec `avance` > `avanceMaxTicks`.
   */
  margeInitialeTicks: 4,
  margeMinTicks: 1,
  margeMaxTicks: 24,
  margeGigueFacteur: 2,
  margeDecroissanceSnaps: 40,
  /** dilatation de la cadence du client : facteur = 1 + clamp(écart × gain, ±max) */
  dilatationMax: 0.05,
  dilatationGainParTick: 0.01,
  /**
   * écart (ticks) au-delà duquel le client ne rattrape plus en douceur. Client EN RETARD (écart > 0) : resync « avant », rollback depuis le
   * dernier instantané en tenant l'entrée courante pour les ticks sans historique (spec § 5.3 bis). Client EN AVANCE (écart < 0) : resync
   * « arrière », la simulation s'arrête (facteur 0) jusqu'à ce que `tickCible` rattrape le tick local ; le client ne recule jamais.
   */
  resyncEcartTicks: 24,
  /** fenêtre glissante (ms) du meilleur échantillon de synchronisation, nombre de mesures de RTT conservées */
  fenetreEchantillonsMs: 2000,
  mesuresRtt: 8,
  mesuresGigue: 16,
  /** historique des entrées locales conservé pour rejouer un rollback (ticks) ≈ 4,3 s */
  historiqueEntrees: 512,
  /** profondeur maximale d'un rollback rejoué (ticks) : au-delà, l'état serveur est adopté et le surplus abandonné */
  profondeurMaxRollback: 180,
  /** pas rejoués au plus par image affichée en régime normal (pas de spirale de la mort) et plafond d'une image (s) en ligne */
  pasMaxParImageEnLigne: 30,
  imageMaxEnLigneS: 0.25,
  /** lissage visuel des corrections : constante de temps de l'exponentielle (s), écart au-delà duquel on ne lisse pas (m) */
  lissageTauS: 0.06,
  /**
   * (additif, jouabilité réseau) constantes de temps du lissage des voitures des AUTRES et de la balle : leur état prédit repose sur des entrées
   * inconnues (extrapolées), leur correction est donc plus fréquente et plus grande que celle de ma voiture ; un glissement plus long la rend
   * moins visible. Purement visuel : la physique prédite n'en dépend jamais. `lissageGrandeCorrectionM` : au-delà de cet écart la constante de
   * temps croît (jusqu'à `lissageFacteurGrandeCorrection` fois) pour que le glissement ne dépasse pas une vitesse supportable.
   */
  lissageTauAutresS: 0.15,
  lissageTauBalleS: 0.1,
  lissageGrandeCorrectionM: 0.5,
  lissageFacteurGrandeCorrection: 2.5,
  /**
   * (additif) entrées déjà reçues mais pas encore exécutées des autres HUMAINS, jointes à chaque instantané (au plus ce nombre de ticks par voiture) :
   * le client rejoue avec les vraies entrées jusqu'à cet horizon, l'extrapolation ne commence qu'après.
   */
  futursMaxTicks: 12,
  /** (additif) garder MA voiture prédite quand l'instantané décrit une fenêtre où le serveur l'a jouée avec une entrée répétée (`manquees` > 0) */
  conservationManquees: true as boolean,
  /**
   * (additif) rejeu serveur d'une entrée arrivée en retard : au plus ce nombre de ticks en arrière (≈ 400 ms : le délai de retransmission d'un paquet TCP perdu), depuis un point de contrôle
   * de l'état tous les `cadenceSnapTicks` (au plus `rewindPointsMax` conservés) ; jamais à travers un événement important.
   */
  rewindMaxTicks: 48,
  rewindPointsMax: 14,
  seuilTeleportVoitureM: 4,
  seuilTeleportBalleM: 8,
  /**
   * échelle de cadence du monde pendant la célébration d'un but. 1 en ligne (v1) : chaque changement d'échelle fait deux ruptures de la
   * correspondance tick ↔ temps (horloge, rollback) pour un gain cosmétique ; la célébration dure alors `MATCH.celebrationS` en temps réel.
   * Le champ `ralenti` des instantanés et la gestion de l'échelle par l'horloge sont conservés (testés) pour un usage futur : mettre
   * `MATCH.ralentiCelebration` ici suffit à les réactiver.
   */
  echelleCelebration: 1 as number,

  // ---- salles ----
  longueurCode: 4,
  /** consonnes sans ambiguïté visuelle (20 lettres, 160 000 codes) */
  alphabetCode: "BCDFGHJKLMNPQRSTVWXZ",
  /** délai laissé aux joueurs pour charger la scène après `debut` avant de démarrer quand même (ms) */
  chargementMaxMs: 15_000,
  /** un joueur coupé en match est gardé ce délai (reprise par jeton), puis un bot prend sa voiture (ms) */
  repriseMs: 20_000,
  /** fenêtre de vote de la revanche après la fin d'un match (ms) */
  revancheMs: 45_000,
  /** un salon sans activité est refermé après (ms) */
  salonInactifMs: 10 * 60_000,
  /** un client qui ne dit pas `bonjour` dans ce délai est coupé (ms) */
  bonjourMs: 10_000,
  /** tentatives de code de salon erronées tolérées par IP et par minute ; un code libéré n'est pas réattribué avant `codeReserveMs` */
  essaisCodeParMinute: 20,
  codeReserveMs: 60_000,
  nomMaxCaracteres: 20,

  // ---- plafonds par défaut du serveur (surchargés par `PDJ_ROCKET_*`, cf. spec § 7) ----
  sallesMax: 8,
  matchsMax: 6,
  // Le site se consulte souvent derrière UNE adresse NAT de bureau : plafonds par IP larges (cf. spec § 7).
  connexionsParIp: 12,
  connexionsTotal: 40,
  sallesParIp: 4,

  // ---- anti-flood par connexion (jetons par seconde / rafale) ----
  floodEntreesParS: 120,
  floodEntreesRafale: 240,
  floodActionsParS: 10,
  floodActionsRafale: 30,
  floodPingParS: 5,
  floodPingRafale: 10,
  /** au-delà de ce nombre de messages bruts dans une seconde la socket est coupée */
  floodCoupureParSeconde: 400,
  /** taille maximale d'une trame texte reçue (`maxPayload` de la WebSocket Rocket) */
  tailleMaxTexteOctets: 4096,
} as const;

/** Ralenti de la célébration : la cadence du monde passe à `echelleCelebration` pendant la phase « but ». Décidé par le SERVEUR seul. */
export const echelleDuMonde = (phase: MondeRocket["phase"]): number => (phase === "but" ? RESEAU.echelleCelebration : 1);

/** Valeur de `SnapRocket.avance` quand le serveur n'a encore reçu aucune entrée de ce joueur : « pas d'information », l'horloge l'ignore. */
export const AVANCE_INCONNUE = -128;

/** Qualité de connexion affichée au HUD, d'après le RTT et la gigue (ms). */
export type QualiteReseau = "bonne" | "moyenne" | "mauvaise";
export function qualiteReseau(rttMs: number, gigueMs: number): QualiteReseau {
  if (rttMs < 80 && gigueMs < 15) return "bonne";
  if (rttMs < 160 && gigueMs < 40) return "moyenne";
  return "mauvaise";
}

/** Code de salon valide : `RESEAU.longueurCode` lettres de l'alphabet sans ambiguïté, en majuscules. */
export function normaliserCode(brut: unknown): string | null {
  if (typeof brut !== "string") return null;
  const c = brut.trim().toUpperCase();
  if (c.length !== RESEAU.longueurCode) return null;
  for (const ch of c) if (!RESEAU.alphabetCode.includes(ch)) return null;
  return c;
}

// ============================================================================================================================
// 2. Entrées (client → serveur)
// ============================================================================================================================

/**
 * Entrées d'une voiture à un tick, QUANTIFIÉES : les cinq axes en entiers de −127 à 127 (valeur réelle = entier / 127), les trois boutons en
 * booléens. Le client joue ses propres entrées quantifiées dans sa prédiction (`dequantifierEntrees(quantifierEntrees(brut))`) : serveur et
 * client simulent ainsi EXACTEMENT les mêmes nombres. Une valeur non finie est ramenée à 0 à la quantification.
 */
export interface EntreesQuantifiees {
  accel: number;
  direction: number;
  tangage: number;
  lacet: number;
  roulis: number;
  saut: boolean;
  boost: boolean;
  derapage: boolean;
}
export const ENTREES_QUANTIFIEES_NULLES = (): EntreesQuantifiees => ({ accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false });
export const entreesQuantifieesEgales = (a: Readonly<EntreesQuantifiees>, b: Readonly<EntreesQuantifiees>): boolean =>
  a.accel === b.accel && a.direction === b.direction && a.tangage === b.tangage && a.lacet === b.lacet && a.roulis === b.roulis
  && a.saut === b.saut && a.boost === b.boost && a.derapage === b.derapage;

/**
 * Trame binaire d'entrées. `entrees[0]` est l'entrée du tick `tickDebut`, `entrees[k]` celle de `tickDebut + k`. Elle porte les entrées
 * NOUVELLES depuis la trame précédente plus `RESEAU.redondanceEntrees` anciennes (le serveur ignore ce qu'il a déjà).
 * `snapRecu` : tick du dernier instantané reçu par le client (diagnostic de retard, `/sante`).
 */
export interface TrameEntrees {
  /** numéro du match (`debut.numero` modulo 256) : le serveur écarte une trame d'un autre match (reprise, revanche) */
  numero: number;
  tickDebut: number;
  snapRecu: number;
  entrees: EntreesQuantifiees[];
}

/** Premier octet d'une trame binaire. */
export const TRAME_ENTREES = 1;
export const TRAME_SNAP = 2;
export type TypeTrame = typeof TRAME_ENTREES | typeof TRAME_SNAP;

// ============================================================================================================================
// 3. État sérialisé du monde et instantané (serveur → client)
// ============================================================================================================================

/** Champs d'une voiture qui changent en cours de match (le reste est dans `VoitureStatique`, envoyé une fois dans `debut`). */
export type EtatVoitureReseau = Omit<EtatVoiture, "id" | "equipe" | "slot" | "humain" | "nom">;

/**
 * État COMPLET et autonome du monde : avec lui (et `VoitureStatique`, `config`, `arene`) `restaurerEtat` reconstitue un monde dont la suite est
 * identique à l'original, entrées égales (déterminisme, y compris l'état caché `interne` de `match.ts` et le `Rng`). `precedent` n'y est pas :
 * il est recopié depuis l'état courant à la restauration. Les réels sont des doubles IEEE (le codage binaire conserve aussi ±Infinity : les
 * délais de `interne` valent −Infinity au départ).
 */
export interface EtatMondeReseau {
  tick: number;
  temps: number;
  phase: MondeRocket["phase"];
  tempsPhase: number;
  tempsRestant: number;
  prolongation: boolean;
  attenteSolBalle: boolean;
  score: Record<Equipe, number>;
  dernierBut: MondeRocket["dernierBut"];
  vainqueur: Equipe | null;
  /** état du générateur du monde (`rng.s`, entier 32 bits) */
  rngS: number;
  voitures: EtatVoitureReseau[];
  balle: EtatBalle;
  /** même ordre que `PLOTS` (l'id d'un plot est son index) */
  plots: Pick<EtatPlot, "actif" | "recharge" | "verrou">[];
  interne: InterneMatch;
}

/**
 * Instantané autoritaire envoyé par `SalleRocket.tic` à un joueur (un par joueur : les champs `entreesRecuesJusqua` et `avance` lui sont propres).
 * `tick` = `etat.tick` = nombre de pas déjà exécutés ; `entrees[i]` = entrées QU'A UTILISÉES la voiture i au dernier pas exécuté (tick − 1) :
 * le client les répète pour les voitures des autres pendant la resimulation.
 */
export interface SnapRocket {
  tick: number;
  /** la cadence du monde est réduite (célébration) : le client en tient compte pour estimer le tick du serveur */
  ralenti: boolean;
  /** numéro du match (`debut.numero` modulo 256) et nombre de voitures : le décodage n'en dépend plus d'un état externe */
  numero: number;
  nbVoitures: number;
  /** plus grand tick d'entrée reçu de CE joueur (−1 : aucun) */
  entreesRecuesJusqua: number;
  /**
   * PIRE cas de la fenêtre écoulée depuis l'instantané précédent : minimum, sur les entrées de CE joueur reçues pour la PREMIÈRE fois dans la
   * fenêtre (les copies redondantes ne comptent pas), de `(tick de l'entrée) − (monde.tick à l'arrivée)`. Négatif = au moins une entrée
   * est arrivée après son tick. Borné à [−127, 127] ; `AVANCE_INCONNUE` (−128) si aucune entrée n'est arrivée dans la fenêtre. (Avant la
   * révision, c'était `plus grand tick reçu − tick` : insensible aux entrées tardives du milieu d'une trame.)
   */
  avance: number;
  /** ticks de la fenêtre exécutés sans entrée vraie de ce joueur (répétée ou neutre), saturé à 255 : retour direct de l'adaptation de la marge */
  manquees: number;
  entrees: EntreesQuantifiees[];
  /**
   * (additif) pour chaque voiture, les entrées des ticks `tick`, `tick + 1`… que le serveur a DÉJÀ reçues (voitures d'autres humains
   * seulement ; vide pour moi, un bot ou un humain sans avance), au plus `RESEAU.futursMaxTicks`. Absent = aucune information.
   */
  futurs?: EntreesQuantifiees[][];
  etat: EtatMondeReseau;
  /** présent après `decoderSnap` : octets exacts de la section `etat` (comparés bit à bit à l'état prédit, cf. `octetsEtatEgaux`) */
  octetsEtat?: Uint8Array;
}

// ============================================================================================================================
// 4. Salons : réglages, joueurs, résumés
// ============================================================================================================================

export type PhaseSalle = "salon" | "chargement" | "match" | "fin";

export interface ReglagesSalon {
  format: Format;
  dureeS: number;
  /** niveau des bots qui complètent les équipes (et remplacent un joueur parti) */
  niveauBots: NiveauBot;
  /** listée dans les parties ouvertes (sinon accessible par son code seulement) */
  visible: boolean;
}
export const REGLAGES_SALON_DEFAUT = (): ReglagesSalon => ({ format: "1v1", dureeS: MATCH.dureeDefautS, niveauBots: "pro", visible: true });

export interface JoueurSalon {
  id: number;
  nom: string;
  equipe: Equipe;
  hote: boolean;
  /** socket ouverte (faux : coupé, reprise possible pendant `RESEAU.repriseMs`) */
  connecte: boolean;
  /** a fini de charger la scène (phase « chargement ») */
  charge: boolean;
}

export interface EtatSalon {
  code: string;
  phase: PhaseSalle;
  reglages: ReglagesSalon;
  joueurs: JoueurSalon[];
  /** places humaines par équipe pour le format choisi */
  placesParEquipe: number;
  /** `lancer` accepté maintenant ; sinon `raisonNonLancable` (texte court, français) */
  lancable: boolean;
  raisonNonLancable?: string;
  /** phase « fin » : votes de revanche (id de joueur → vote) et échéance (ms d'horloge serveur, relative : durée restante) */
  revanche?: { votes: Record<number, boolean>; restantMs: number };
}

export interface ResumeSalle {
  code: string;
  hote: string;
  format: Format;
  dureeS: number;
  niveauBots: NiveauBot;
  humains: number;
  places: number;
}

/** Une voiture du match, décrite une fois pour toutes dans `debut`. `joueur` : id du joueur humain qui la pilote, null pour un bot. */
export interface VoitureStatique {
  id: number;
  equipe: Equipe;
  slot: number;
  humain: boolean;
  nom: string;
  joueur: number | null;
}

export type RaisonRefus =
  | "inconnue" | "pleine" | "en-cours" | "hote" | "limite" | "format" | "joueurs" | "equipe-pleine" | "code" | "phase"
  | "deja-dans-salle" | "invalide" | "dev" | "serveur-plein";

// ============================================================================================================================
// 5. Messages TEXTE
// ============================================================================================================================

export type ActionDev =
  | { action: "balle"; p: Vec3; v: Vec3 }
  | { action: "chrono"; tempsRestant: number };

/** Client → serveur. Le premier message d'une connexion est `bonjour` (sinon `erreur{bonjour}` puis fermeture). */
export type MessageClient =
  | { t: "bonjour"; v: number; nom: string; reprise?: { code: string; joueur: number; jeton: string } }
  | { t: "lister" }
  | { t: "creer"; reglages: ReglagesSalon }
  | { t: "rejoindre"; code: string; equipe?: Equipe }
  | { t: "quitter" }
  | { t: "equipe"; equipe: Equipe }
  | { t: "reglages"; reglages: Partial<ReglagesSalon> }
  | { t: "lancer" }
  /** la scène est chargée et l'horloge synchronisée : la partie peut démarrer pour ce joueur (phase « chargement ») */
  | { t: "pret" }
  | { t: "ping"; c: number }
  | { t: "klaxon" }
  | { t: "revanche"; oui: boolean }
  /** hôte, phase « fin » : retour au salon sans revanche */
  | { t: "retourSalon" }
  /** essais seulement (`PDJ_ROCKET_DEV=1`), refusé `dev` sinon */
  | ({ t: "dev" } & ActionDev);
export type TypeMessageClient = MessageClient["t"];

export interface ReprisePossible {
  code: string;
  joueur: number;
  jeton: string;
}

/** Serveur → client. */
export type MessageServeur =
  | { t: "bienvenue"; v: number; joueur: number; maintenantMs: number }
  /**
   * jeton de reprise, émis par le module serveur (`rocket.ts`, `crypto.randomBytes(16)` en hexadécimal, sans lien avec la graine d'une salle
   * ni d'un code) juste après un `creer` ou `rejoindre` réussi : il est lié à (salle, joueur). Le client le garde pour `bonjour.reprise`.
   */
  | { t: "session"; code: string; joueur: number; jeton: string }
  | { t: "liste"; parties: ResumeSalle[] }
  /**
   * état complet du salon, envoyé à chaque changement (phase, joueurs, réglages, revanche). `salon: null` : le joueur n'est plus dans un salon
   * (accusé de `quitter`, salon refermé par expiration ou parce que vide) avec la `raison`.
   */
  | { t: "salon"; salon: EtatSalon | null; raison?: "quitte" | "expire" | "ferme" | "expulse" }
  /** le match démarre : décrit les voitures ; les instantanés (trame binaire) suivent. `moi` = id de la voiture du destinataire. */
  | { t: "debut"; config: ConfigMatch; voitures: VoitureStatique[]; moi: number; numero: number }
  /** événements des pas `tick` (inclus) à `tick + n`, regroupés ; chacun porte son tick. Les sons / effets locaux de MA voiture n'y sont pas répétés. */
  | { t: "ev"; evenements: { tick: number; e: EvenementMatch }[] }
  /** `tick` fractionnaire (`monde.tick` + fraction du pas en cours) ; −1 quand la salle n'est pas en phase « match » (aucun tick ne court) */
  | { t: "pong"; c: number; tick: number; ralenti: boolean }
  | { t: "fin"; tick: number; resultat: ResultatMatch }
  /** présence d'un joueur : coupé (reprise possible jusqu'à `jusquaMs` de durée restante), revenu, remplacé par un bot, parti */
  | { t: "presence"; joueur: number; etat: "coupe" | "revenu" | "bot" | "parti"; restantMs?: number }
  | { t: "refus"; action: TypeMessageClient; raison: RaisonRefus }
  /** `message` (comme l'arène : un client Rocket qui tombe sur un serveur d'avant reçoit `erreur{version, message}` de l'arène, cf. spec § 11) */
  | { t: "erreur"; code: "version" | "bonjour" | "flood" | "format" | "serveur"; message: string }
  /**
   * réponse à `bonjour.reprise`, toujours envoyée juste après `bienvenue`. `code` : reprise acceptée, le client attend `salon`, `session`, `debut`
   * puis les instantanés ; `null` : refusée (code inconnu, salon refermé, jeton faux, joueur déjà remplacé par un bot), le client oublie la reprise.
   */
  | { t: "reprise"; code: string | null };
export type TypeMessageServeur = MessageServeur["t"];

/** Codes de fermeture WebSocket propres à Rocket. */
export const CODE_DEPART_VOLONTAIRE = 1000;
export const CODE_ARRET_SERVEUR = 1001;
export const CODE_VERSION = 4001;
export const CODE_FLOOD = 4002;
export const CODE_BONJOUR = 4003;
export const CODE_TROP_DE_CONNEXIONS = 1013;
/** l'ancienne socket d'un joueur est fermée quand une reprise valide prend le relais (socket à moitié ouverte après une veille) */
export const CODE_REMPLACE = 4004;

// ============================================================================================================================
// 6. Lot SALLE : salle serveur pure, codec, monde en ligne
// ============================================================================================================================

/** Message émis par une salle : texte pour un joueur (ou « tous »), ou instantané structuré pour un joueur (le serveur l'encode). */
export type SortieSalle =
  | { a: number | "tous"; msg: MessageServeur }
  | { a: number; snap: SnapRocket };

export interface OptionsSalleRocket {
  code: string;
  hote: { id: number; nom: string };
  reglages: ReglagesSalon;
  /** graine de la salle : dérive les graines des matchs, des cerveaux de bots et le tirage des équipes (aucun `Math.random` dans la salle) */
  graine: number;
  /** instant de création (ms, horloge monotone fournie par l'appelant) */
  maintenantMs: number;
  /** actions `dev` acceptées (essais) */
  dev?: boolean;
  /** humains nécessaires pour `lancer` (défaut 2 ; 1 pour les essais en solo) */
  humainsMin?: number;
  /** remplace la durée de chaque match (s) : essais seulement, `PDJ_ROCKET_DUREE_S` */
  dureeForceeS?: number;
  /** surcharges de `RESEAU` pour les tests (chargement, reprise, revanche) */
  chargementMaxMs?: number;
  repriseMs?: number;
  revancheMs?: number;
  /** fabrique de cerveaux injectable (tests) ; défaut `creerCerveau` de `lib/rocket/bots.ts` */
  creerCerveau?: (niveau: NiveauBot, graine: number) => { decider: (m: Readonly<MondeRocket>, moi: Readonly<EtatVoiture>, dt: number) => EntreesVoiture };
}

export type ResultatRejoindre = { ok: true; sorties: SortieSalle[] } | { ok: false; raison: RaisonRefus };

/** Mesures d'une salle pour `/sante`. */
export interface MesuresSalle {
  phase: PhaseSalle;
  humains: number;
  /**
   * pas exécutés depuis le début du match courant, entrées répétées faute de mieux, entrées arrivées trop tard, temps de jeu abandonné
   * (calage de plus de `imageMaxServeurS`, ms). Le coût CPU d'un `tic` ne se mesure PAS ici (la salle n'a pas d'horloge) : `rocket.ts` le mesure.
   */
  pas: number;
  entreesRepetees: number;
  entreesTardives: number;
  tempsAbandonneMs: number;
  /** (additif) rejeux serveur appliqués / refusés (hors fenêtre, événement important, point de contrôle absent), ticks rejoués au total */
  rewinds?: number;
  rewindsRefuses?: number;
  rewindTicks?: number;
}

/**
 * Une salle Rocket : lobby, chargement, match autoritaire, fin, revanche, présence. PURE : aucune horloge globale, aucun hasard global, aucune
 * socket ; `maintenantMs` est passé à chaque appel (horloge monotone). Implémentée par `salle.ts` (`creerSalleRocket`).
 */
export interface SalleRocket {
  readonly code: string;
  readonly phase: PhaseSalle;
  /** ajoute un joueur (équipe choisie si possible, sinon la moins remplie) ; refusé pleine / en-cours / … */
  rejoindre(joueur: { id: number; nom: string; equipe?: Equipe }, maintenantMs: number): ResultatRejoindre;
  /** départ volontaire (bot immédiat en match) ou coupure (`coupure: true` : reprise possible `repriseMs`) */
  retirer(idJoueur: number, maintenantMs: number, coupure: boolean): SortieSalle[];
  /** le joueur coupé revient (le module serveur a vérifié le jeton, qu'il possède : la salle ne connaît aucun jeton) : la salle renvoie salon / debut / instantané / présence */
  reprendre(idJoueur: number, maintenantMs: number): SortieSalle[];
  /** message texte déjà validé en forme par `validation.ts` (`lireMessageClient`) ; la salle valide le fond (hôte, phase, bornes) et répond `refus` au besoin */
  recevoir(idJoueur: number, msg: MessageClient, maintenantMs: number): SortieSalle[];
  /**
   * trame d'entrées décodée ; écrite dans l'anneau du joueur (bornes de tick, déjà vu / trop tard ignoré, `numero` différent du match courant
   * écarté). Une entrée arrivée après son tick n'est pas appliquée mais, si c'est la plus récente connue, elle devient « la dernière entrée connue »
   * répétée par le serveur (une rafale TCP ne laisse pas la voiture sur une entrée périmée).
   */
  recevoirEntrees(idJoueur: number, trame: TrameEntrees, maintenantMs: number): SortieSalle[];
  /**
   * avance l'horloge de la salle : accumulateur de pas fixes, bots, événements, instantanés, transitions de phase, expirations (fin du
   * chargement après `chargementMaxMs`, fin du vote de revanche, fin de la reprise d'un joueur coupé). `budgetPas` : pas que la salle peut
   * encore exécuter dans ce réveil (budget partagé entre toutes les salles, `RESEAU.pasMaxTotalParReveil`) ; le report n'est pas perdu. Pas exécutés = différence de `mesures().pas`.
   */
  tic(maintenantMs: number, budgetPas?: number): SortieSalle[];
  etat(): EtatSalon;
  resume(): ResumeSalle;
  /** nombre de joueurs humains présents (connectés ou en reprise) */
  humains(): number;
  /** vrai si plus aucun humain n'est présent (salle à refermer) */
  vide(): boolean;
  /** un match occupe la salle (phase « chargement » ou « match ») : compte pour `matchsMax` */
  enMatch(): boolean;
  /**
   * la salle a une échéance à servir dans `tic` : toute phase hors « salon » qui compte un humain connecté ou en reprise (chargement → match
   * après `chargementMaxMs`, vote de revanche de 45 s, reprise de 20 s n'existent QUE dans `tic`). Le registre ne fait tiquer que ces salles.
   */
  aEcheance(): boolean;
  /** dernière activité utile (ms) pour expirer un salon oublié */
  activiteMs(): number;
  /**
   * un instantané n'a pas pu partir (contre-pression, socket absente) : ses compteurs `avance` (pire cas) et `manquees` sont restitués au joueur,
   * pour que le suivant les porte (sinon l'horloge du client ne verrait jamais le pire cas d'une congestion)
   */
  restituerCompteurs(joueur: number, avance: number, manquees: number): void;
  mesures(): MesuresSalle;
  /** accès aux tests : le monde autoritaire courant (null hors match) */
  monde(): Readonly<MondeRocket> | null;
}
/** Implémenté par `salle.ts`. */
export type CreerSalleRocket = (opts: OptionsSalleRocket) => SalleRocket;

// ---- serialisation.ts ------------------------------------------------------------------------------------------------------

/** Quantification des entrées (−127..127) et retour aux réels. Implémentés par `serialisation.ts`. */
export type QuantifierEntrees = (e: Readonly<EntreesVoiture>) => EntreesQuantifiees;
export type DequantifierEntrees = (q: Readonly<EntreesQuantifiees>) => EntreesVoiture;

/** Extrait l'état complet d'un monde (copie profonde, `interne` compris). Implémenté par `serialisation.ts` (`extraireEtat`). */
export type ExtraireEtat = (m: Readonly<MondeRocket>) => EtatMondeReseau;
/**
 * Écrit `e` DANS le monde `vers` (même nombre de voitures et de plots ; `config`, `arene`, `idHumain` et l'identité des voitures sont conservés,
 * `precedent` est recopié depuis l'état restauré). Le monde obtenu poursuit EXACTEMENT comme l'original. Implémenté par `serialisation.ts`.
 */
export type RestaurerEtat = (e: Readonly<EtatMondeReseau>, vers: MondeRocket) => void;
/** Codage binaire de l'état seul (section `etat` d'un instantané) : sert aussi à comparer deux états octet à octet. */
export type EncoderEtat = (e: Readonly<EtatMondeReseau>) => Uint8Array;
export type DecoderEtat = (octets: Uint8Array) => EtatMondeReseau | null;
export const octetsEtatEgaux = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
/** Trames complètes (premier octet = `TypeTrame`). Les décodeurs rendent null sur toute trame malformée ou tronquée, sans jamais lever. */
export type EncoderTrameEntrees = (t: Readonly<TrameEntrees>) => Uint8Array;
export type DecoderTrameEntrees = (octets: Uint8Array) => TrameEntrees | null;
export type EncoderSnap = (s: Readonly<SnapRocket>) => Uint8Array;
export type DecoderSnap = (octets: Uint8Array) => SnapRocket | null;
export type TypeDeTrame = (octets: Uint8Array) => TypeTrame | null;

// ---- monde-ligne.ts ----------------------------------------------------------------------------------------------------

/**
 * Construit le monde d'un match en ligne à partir du message `debut` : `creerMonde(config)` puis, pour chaque voiture de `voitures`, `humain`,
 * `nom` et `equipe` imposés (la physique ignore `humain`) ; `idHumain` = `moi`. Identique côté serveur (avec `moi = -1`) et côté client. Implémenté par `monde-ligne.ts`.
 */
export type CreerMondeEnLigne = (config: ConfigMatch, voitures: readonly VoitureStatique[], moi: number, arene?: Arene) => MondeRocket;
/** Graine du cerveau d'un bot : dérivée de la graine du match et de l'id de la voiture (même formule que le mode local). Implémenté par `monde-ligne.ts`. */
export type GraineBot = (grainePartie: number, idVoiture: number) => number;

// ============================================================================================================================
// 7. Lot PREDICTION : horloge, prédicteur
// ============================================================================================================================

/** Synchronisation d'horloge client (PURE, l'heure locale est passée en argument, ms monotones). Implémentée par `horloge.ts` (`creerHorloge`). */
export interface HorlogeRocket {
  reinitialiser(): void;
  /**
   * mesure d'un aller-retour : ping envoyé à `envoyeMs`, pong reçu à `recuMs`, avec le tick (fractionnaire) du monde du serveur à la réponse.
   * Un `tickServeur` < 0 (salle pas en phase « match ») nourrit le RTT mais JAMAIS l'estimation de tick.
   */
  echantillonPong(envoyeMs: number, recuMs: number, tickServeur: number, ralenti: boolean): void;
  /** chaque instantané reçu est aussi un échantillon : le tick qu'il porte, reçu à `recuMs` */
  echantillonSnap(tickSnap: number, recuMs: number, ralenti: boolean): void;
  /**
   * RTT filtré (minimum des `RESEAU.mesuresRtt` dernières mesures, ms) et gigue (écart moyen absolu, ms) ; 0 tant qu'il n'y a pas de mesure.
   * Une horloge locale grossière (Firefox `resistFingerprinting`, 100 ms) donne une gigue énorme, donc une marge plancher large : rien à détecter.
   */
  rttMs(): number;
  gigueMs(): number;
  /** tick (fractionnaire) du monde du serveur à l'instant local `maintenantMs` ; NaN tant qu'aucun échantillon */
  tickServeurEstime(maintenantMs: number): number;
  /** tick que le client doit jouer maintenant : estimé + demi-RTT en ticks + marge adaptative */
  tickCible(maintenantMs: number): number;
  /**
   * retour du serveur (`SnapRocket.avance`, `SnapRocket.manquees`), UN appel par instantané REÇU (même s'il est coalescé par le prédicteur).
   * `avance` = `AVANCE_INCONNUE` : ignoré. Règles : `manquees` > 0 → marge +1 (+2 si ≥ 4) ; sinon `avance` < `avanceMinTicks` → +1 ; décroissance
   * d'un tick après `margeDecroissanceSnaps` instantanés sans manquée et avec `avance` > `avanceMaxTicks` ; plancher `margeGigueFacteur` × gigue.
   */
  signalerAvance(avance: number, manquees: number): void;
  margeTicks(): number;
  /**
   * facteur de cadence (1 ± dilatationMax) d'après l'écart entre `tickCible` et le tick local, et besoin de resynchronisation franche.
   * `resync: "avant"` : client en retard de plus de `resyncEcartTicks` (facteur 1, le prédicteur rattrape par rollback) ; `resync: "arriere"` :
   * client en avance de plus de `resyncEcartTicks` (facteur 0 : il attend, il ne recule jamais) ; `null` sinon. Tant qu'aucun échantillon : facteur 1, null.
   */
  cadence(tickLocal: number, maintenantMs: number): { facteur: number; ecartTicks: number; resync: "avant" | "arriere" | null };
}
export type CreerHorloge = () => HorlogeRocket;

export interface StatsPrediction {
  tickLocal: number;
  tickSnap: number;
  rollbacks: number;
  /** snapshots reçus dont l'état prédit était identique octet à octet (aucun rollback) */
  snapsExacts: number;
  profondeurMoyenne: number;
  profondeurMax: number;
  ecartMaxM: number;
  resyncs: number;
  /** (additif) instantanés dont j'ai gardé MA voiture prédite parce que le serveur l'avait jouée avec une entrée répétée (`manquees` > 0) */
  conservations?: number;
  /** durée du dernier / du plus long rollback (ms) */
  dernierRollbackMs: number;
  maxRollbackMs: number;
}

export interface OptionsPredicteur {
  horloge: HorlogeRocket;
  debut: Extract<MessageServeur, { t: "debut" }>;
  arene?: Arene;
}

export interface ResultatAvance {
  /** pas exécutés dans cet appel (0 à `pasMaxParImageEnLigne`) */
  pas: number;
  /** fraction d'interpolation d'affichage entre `monde.precedent` et l'état courant */
  alpha: number;
  /**
   * événements de MA voiture produits par la prédiction, à jouer tout de suite ; jamais rejoués par un rollback. Types : `saut`, `doubleSaut`,
   * `flip`, `atterrissage`, `choc`, `boost`, `supersonique` ET (révision) `toucheBalle`, `plot`, `bump` de MA voiture (un son de frappe qui suivrait
   * l'image d'un aller-retour complet se remarque). Pas `demolition`, `but`, `reapparition`, `fin` : ils attendent le serveur.
   */
  evenementsLocaux: EvenementMatch[];
  /** résultat du rollback appliqué au début de l'appel (null : aucun instantané en attente) */
  snap: ResultatSnap | null;
}

export interface ResultatSnap {
  /** faux : l'état prédit était identique à celui du serveur */
  rollback: boolean;
  profondeur: number;
  /** plus grand écart de position (m) entre l'ancien état prédit et le nouveau (voitures et balle) */
  ecartM: number;
  /** l'état serveur a été adopté sans rejouer (retard trop grand, ou premier instantané) */
  resync: boolean;
  /** (additif, diagnostic) décomposition de `ecartM` d'un rollback : ma voiture, les autres voitures (le plus grand), la balle (m) */
  ecartMoiM?: number;
  ecartAutresM?: number;
  ecartBalleM?: number;
}

/**
 * Prédiction avec rollback du monde entier. PUR (l'heure est passée en argument). Implémenté par `prediction.ts` (`creerPredicteur`).
 * Voir la spec § 5 pour l'algorithme, les constantes et la gestion des événements.
 */
export interface PredicteurRocket {
  /** monde PRÉDIT (physique) : à lire seulement ; son `idHumain` est ma voiture */
  readonly monde: MondeRocket;
  /** faux jusqu'au premier instantané (l'horloge n'est pas encore calée : rien n'avance) */
  readonly pret: boolean;
  /**
   * enregistre un instantané reçu SANS rien rejouer : nourrit l'horloge (échantillon + `signalerAvance`, pour CHAQUE instantané) et garde
   * seulement le plus récent en attente (coalescence : une rafale de six instantanés ne coûte qu'un rollback). Rend faux (et l'ignore) un
   * instantané d'un autre match (`numero` ou `nbVoitures` différents du `debut`) ou plus ancien que celui déjà appliqué.
   */
  recevoirSnap(snap: SnapRocket, maintenantMs: number): boolean;
  /**
   * convertit le temps réel en pas. Dans l'ordre : (1) applique l'instantané en attente, AU PLUS UN rollback par appel (donc par image), avant
   * toute simulation ; (2) cadence dilatée par l'horloge, une entrée locale (déjà quantifiée) par pas, historique en écriture UNIQUE par tick,
   * événements locaux ; (3) resynchronisations avant / arrière (spec § 5.3 bis). Mémorise `encoderEtat` aux ticks multiples de 6 de la
   * chronologie COURANTE, y compris pendant un rejeu (anneau indexé par tick exact).
   */
  avancer(dtReelS: number, entrees: Readonly<EntreesVoiture>, maintenantMs: number): ResultatAvance;
  /** trame d'entrées à envoyer maintenant (nouveaux ticks + redondance), null s'il n'y a rien de neuf ou trop tôt (`intervalleTrameEntreesMs`) */
  trameAEnvoyer(maintenantMs: number): TrameEntrees | null;
  /**
   * événements du serveur (message `ev`) : rend ceux à jouer. Retire (a) les doublons (tick déjà vu, mémoire remise à zéro à chaque `debut` et
   * reprise) et (b) pour MA voiture, ceux déjà joués localement : un événement serveur de même type et de même voiture est apparié au premier
   * événement local non apparié à ±6 ticks (une seule fois chacun). Un événement local jamais confirmé n'est pas retiré (déjà joué) ; un
   * événement serveur de ma voiture sans homologue local (non prédit) est joué quand il arrive.
   */
  filtrerEvenements(evenements: readonly { tick: number; e: EvenementMatch }[]): EvenementMatch[];
  /**
   * monde à AFFICHER : le monde prédit avec (1) les corrections visuelles en cours (écarts qui s'effacent en `lissageTauS`, appliquées aussi à
   * `precedent` et à la base d'orientation, sinon l'interpolation oscille) et (2) une GARDE DE PHASE : `demolie`, `phase = "but"` / `"fini"`,
   * `score` et `vainqueur` décidés par la seule prédiction (voitures adverses extrapolées) ne s'affichent pas tant que le dernier état
   * autoritaire ou un événement serveur ne les confirme pas ; une voiture prédite démolie à tort reste affichée à sa dernière pose valide
   * (caméra comprise : elle ne la perd pas). Résidu connu : la voiture prédite démolie ignore mes entrées jusqu'au rollback suivant (≤ RTT + 50 ms).
   */
  mondeAffiche(maintenantMs: number): MondeRocket;
  /** dernier état autoritaire reçu (score, phase pour le HUD), null avant le premier */
  etatAutoritaire(): EtatMondeReseau | null;
  stats(): StatsPrediction;
}
export type CreerPredicteur = (opts: OptionsPredicteur) => PredicteurRocket;

// ============================================================================================================================
// 8. Lot CLIENT : WebSocket, source de jeu
// ============================================================================================================================

export type EtatConnexion = "connexion" | "ouverte" | "reconnexion" | "fermee" | "refusee";

/** Socket minimale (injectable pour les tests). */
export interface SocketRocket {
  readyState: number;
  binaryType: string;
  send(donnees: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, raison?: string): void;
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface OptionsClientRocket {
  /** défaut `urlRocket()` */
  url?: string;
  nom: string;
  /**
   * reprise d'une session coupée (lue / écrite par l'UI dans `sessionStorage` `pdj-rocket-reprise`, avec l'instant de la coupure : l'UI ne la
   * tente que dans les `RESEAU.repriseMs` qui suivent ; un rechargement de page dans ce délai la retrouve, pas au-delà)
   */
  reprise?: ReprisePossible;
  creerSocket?: (url: string) => SocketRocket;
  maintenant?: () => number;
  setInterval?: (f: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

export interface EcouteursClientRocket {
  message?(m: MessageServeur): void;
  snap?(s: SnapRocket): void;
  etat?(e: EtatConnexion): void;
}

/**
 * Client WebSocket de Rocket : connexion, `bonjour`, ping réguliers (alimentent l'horloge), décodage des trames, reconnexion avec reprise
 * pendant `RESEAU.repriseMs` (attentes 0,5 / 1 / 2 / 2 s). Aucune logique de jeu. Implémenté par `client.ts` (`creerClientRocket`).
 */
export interface ClientRocket {
  connecter(): void;
  fermer(): void;
  envoyer(m: MessageClient): void;
  envoyerTrame(t: Readonly<TrameEntrees>): void;
  ecouter(e: EcouteursClientRocket): () => void;
  etat(): EtatConnexion;
  /** code, id du joueur et jeton (après le message `session` qui suit `creer` / `rejoindre`) ; null avant, et après `quitter` */
  session(): ReprisePossible | null;
  /** dernier RTT mesuré brut (ms) ; l'horloge filtrée est dans `HorlogeRocket` */
  rttBrutMs(): number;
}
export type CreerClientRocket = (opts: OptionsClientRocket) => ClientRocket;

/** URL du serveur Rocket : `NEXT_PUBLIC_ROCKET_WS_URL`, sinon la base de `NEXT_PUBLIC_FPS_WS_URL`, sinon `ws://localhost:8787` en local, sinon `wss://pdj-fps.toam.tech`, plus `CHEMIN_ROCKET`. */
export type UrlRocket = () => string;

/**
 * Options ajoutées à `creerJeuRocket` pour une partie en ligne (le mode local ne les passe pas). `lib/rocket/jeu.ts` les consomme.
 * `contrat.ts` n'est PAS modifié : le type complet est `OptionsJeuRocketAvecLigne`. Le jeu n'est créé qu'à la réception de `debut` (jamais
 * avant : `debut` est obligatoire) ; au clic « Créer / Rejoindre » on ne précharge que `import("@/lib/rocket/jeu")`.
 */
export interface OptionsJeuRocketEnLigne {
  client: ClientRocket;
  debut: Extract<MessageServeur, { t: "debut" }>;
  /** dernier instantané reçu AVANT la création du jeu (la scène charge pendant que le serveur attend `pret`) ; coalescé, un seul */
  snapEnAttente: SnapRocket | null;
  /** rendu désactivé (essais en rendu logiciel) : simulation et réseau tournent, rien n'est dessiné. Canal : cf. `CLE_SANS_RENDU`. */
  sansRendu?: boolean;
  /** état réseau pour le HUD (≤ 5 Hz et à chaque changement d'état) : seul chemin vers React en production */
  hudReseau(h: HudReseau): void;
}
/**
 * Seconde `debut` (revanche, reprise) sur un jeu déjà créé : `jeu.ts` écoute lui-même le client (`ecouter`), recrée le prédicteur et remet à
 * zéro les doublons d'événements (renderer conservé), puis envoie `pret`. Premier `pret` : après la création de la scène. Les cerveaux de
 * bots locaux (`creerCerveaux`) ne sont jamais créés en ligne.
 */
export type OptionsJeuRocketAvecLigne = import("../contrat").OptionsJeuRocket & { enLigne?: OptionsJeuRocketEnLigne };
/** Clé `localStorage` qui active `sansRendu` pour les essais (lue UNIQUEMENT si `process.env.NODE_ENV !== "production"`). */
export const CLE_SANS_RENDU = "pdj-rocket-sans-rendu";
/** Clé `sessionStorage` de la reprise : `{ code, joueur, jeton, coupeA }` (`coupeA` : `Date.now()` de la coupure). */
export const CLE_REPRISE = "pdj-rocket-reprise";

/** État réseau exposé au HUD (≤ 5 Hz) et aux essais. */
export interface HudReseau {
  etat: EtatConnexion;
  rttMs: number;
  gigueMs: number;
  qualite: QualiteReseau;
  /** mes commandes : actives, neutres parce que le menu pause est ouvert, ou neutres parce que l'onglet est masqué (la partie continue) */
  commandes: "actives" | "menu" | "masque";
  /** adversaire / coéquipier coupé : reprise possible dans `restantMs` */
  absents: { joueur: number; nom: string; restantMs: number }[];
  /** phase « fin » : revanche */
  revanche: { votes: Record<number, boolean>; restantMs: number } | null;
}

/** Crochet de développement (hors production) `window.__rocketReseau`, posé par `jeu.ts` en ligne, utilisé par `scripts/rocket/e2e_rocket_en_ligne.mjs`. */
export interface CrochetRocketReseau {
  stats(): StatsPrediction & { rttMs: number; gigueMs: number; margeTicks: number; avance: number; snapsRecus: number; trames: number };
  hud(): HudReseau;
  /** identifiant de ma voiture et monde prédit (équivalent de `window.__rocket.monde()` en ligne) */
  moi(): number;
  /** surcharge des entrées de MA voiture (null = clavier) : l'essai en rendu logiciel ne dépend pas des touches */
  entrees(e: EntreesVoiture | null): void;
  /** dernier état autoritaire reçu */
  autoritaire(): EtatMondeReseau | null;
  /** retarde artificiellement les messages sortants et entrants (ms) pour simuler la latence ; (0, 0) l'annule */
  latence(sortantMs: number, entrantMs?: number): void;
  /** retient tout ce qui arrive pendant `ms` puis le délivre d'un coup (rafale TCP) */
  retenir(ms: number): void;
  /** simule un onglet masqué (pas de boucle, commandes neutres) puis son retour */
  masquer(actif: boolean): void;
  /** ferme la socket sans quitter (test de reprise) */
  couper(): void;
  /** envoie une action `dev` (balle, chrono) : refusée par le serveur sans `PDJ_ROCKET_DEV=1`, jamais d'effet local (l'autorité reste au serveur) */
  dev(a: ActionDev): void;
}
declare global {
  interface Window {
    __rocketReseau?: CrochetRocketReseau;
  }
}

// ============================================================================================================================
// 9. Lot SERVEUR : registre de salles, limiteur, module de serveur
// ============================================================================================================================

export interface OptionsRegistreRocket {
  sallesMax: number;
  matchsMax: number;
  sallesParIp: number;
  /** essais de code erroné par IP et par minute, et durée sans réattribution d'un code libéré (défauts : `RESEAU.*`) */
  essaisCodeParMinute?: number;
  codeReserveMs?: number;
  creerSalle: CreerSalleRocket;
  /** graine du registre : tirage des codes (jamais `Math.random` dans le registre) */
  graine: number;
  dev?: boolean;
  humainsMin?: number;
  dureeForceeS?: number;
}

export type ResultatTrouver = { ok: true; salle: SalleRocket } | { ok: false; raison: "code" | "inconnue" | "limite" };
/**
 * Registre PUR des salles : codes uniques (tirés d'une graine fournie par le serveur, elle-même issue de `crypto` ; un code n'est de toute
 * façon pas un secret : la reprise exige un jeton à part), plafonds, liste publique, fermeture des salles vides ou oubliées. Implémenté par
 * `registre.ts` (`creerRegistreRocket`). Aucune horloge ni IP globale : tout est passé en argument.
 */
export interface RegistreRocket {
  creer(hote: { id: number; nom: string }, reglages: ReglagesSalon, ip: string, maintenantMs: number): { ok: true; salle: SalleRocket } | { ok: false; raison: RaisonRefus };
  /**
   * cherche un salon par code. Compte les essais ratés par `ip` (fenêtre d'une minute, `essaisCodeParMinute`) : au-delà `limite` sans consulter
   * les salles. `code` : forme invalide ; `inconnue` : forme valide mais aucune salle (compte comme essai raté).
   */
  trouver(code: string, ip: string, maintenantMs: number): ResultatTrouver;
  /** lecture par code SANS anti-énumération (reprise par jeton valide : la preuve est déjà faite, un voisin de NAT ne doit pas la bloquer) ; null si la salle n'existe pas */
  salle(code: string): SalleRocket | null;
  /** salles en phase « salon », visibles et non pleines */
  lister(): ResumeSalle[];
  /** salles à servir dans la boucle du serveur : celles dont `aEcheance()` est vrai (jamais seulement « match en cours ») */
  actives(): SalleRocket[];
  /** retire les salles vides et les salons inactifs (le serveur prévient leurs joueurs : `salon{null, "expire"}`) ; rend les salles retirées */
  nettoyer(maintenantMs: number): SalleRocket[];
  /** retire la salle ; son code n'est pas réattribué avant `codeReserveMs` */
  retirer(code: string, maintenantMs: number): void;
  nombre(): number;
  nombreMatchs(): number;
}
export type CreerRegistreRocket = (opts: OptionsRegistreRocket) => RegistreRocket;

/** Décision du limiteur pour un message (PUR : horloge passée en argument). Implémenté par `limiteur.ts` (`creerLimiteur`, `admettreRocket`). */
export type DecisionFloodRocket = "ok" | "jeter" | "couper";
export type ClasseMessage = "entrees" | "ping" | "action";
export interface EtatLimiteur {
  entrees: number;
  ping: number;
  actions: number;
  t: number;
  fenetreT: number;
  fenetreNb: number;
}
export type CreerLimiteur = (maintenantMs: number) => EtatLimiteur;
export type AdmettreRocket = (e: EtatLimiteur, classe: ClasseMessage, maintenantMs: number) => DecisionFloodRocket;

// ---- validation.ts ----------------------------------------------------------------------------------------------------------

/**
 * Validation de FORME d'un message texte déjà parsé (module PUR, fuzzé en test, lot SERVEUR) : `t` dans la liste fermée, `v` entier, `nom` nettoyé,
 * `reglages` complet (`format` ∈ 1v1 / 2v2 / 3v3, `dureeS` dans la liste du lobby, `niveauBots` connu, `visible` booléen) ou `Partial` borné, `code`
 * normalisé, `c` fini, `oui` booléen, `equipe` ∈ {bleue, orange} (valeurs réelles de `Equipe`), `dev` borné. Rend null au moindre écart (jamais de levée).
 */
export type LireMessageClient = (brut: unknown) => MessageClient | null;
/**
 * Nom de joueur : retire les caractères de contrôle ET de formatage Unicode (U+202E et autres bidirectionnels, U+200B…), les séparateurs de
 * ligne / paragraphe, réduit les espaces, 1 à `nomMaxCaracteres` points de code ; null si vide. (Le champ du lobby limite à 16, le serveur à 20.)
 */
export type NettoyerNom = (brut: unknown) => string | null;

/** Données de `/sante` ajoutées par le module Rocket (bloc `rocket`). */
export interface SanteRocket {
  salles: number;
  matchs: number;
  joueurs: number;
  connexions: number;
  ticMaxMs: number;
  ticsLents: number;
  entreesTardives: number;
  entreesRepetees: number;
  /** octets envoyés / reçus depuis le démarrage */
  octetsEmis: number;
  octetsRecus: number;
  /** instantanés sautés par contre-pression, temps de jeu abandonné par calage (ms), sockets remplacées par une reprise */
  snapsSautes: number;
  tempsAbandonneMs: number;
  socketsRemplacees: number;
}

/**
 * Module serveur de Rocket (`serveur-fps/src/rocket.ts`, `creerServeurRocket`) : une WebSocket `noServer` routée sur `CHEMIN_ROCKET`, ses plafonds de
 * connexions (adresse par `ipClient` de `lib/fps/ip-client.ts`, jamais le premier `x-forwarded-for`), son anti-flood, son minuteur à
 * `periodeMinuteurServeurMs` (budget `pasMaxTotalParReveil` partagé entre salles), l'encodage des instantanés, la contre-pression
 * (`bufferSauteSnapOctets` / `bufferCoupureOctets`), le ping PROTOCOLAIRE (`pingProtocoleMs`, `socketMorteMs`), les jetons de reprise
 * (`crypto.randomBytes`, comparés en temps constant, la reprise valide ferme l'ancienne socket avec `CODE_REMPLACE`) et la mesure de `ticMaxMs`.
 * `index.ts` ne fait que : lui passer les `upgrade` du chemin `/rocket`, ajouter `sante()` à `/sante`, appeler `arreter()`.
 */
export interface ServeurRocket {
  /** prend en charge l'`upgrade` HTTP d'une requête dont le chemin est `/rocket` (origine vérifiée comme pour l'arène) */
  upgrade(req: unknown, socket: unknown, head: unknown): void;
  sante(): SanteRocket;
  arreter(): void;
}
