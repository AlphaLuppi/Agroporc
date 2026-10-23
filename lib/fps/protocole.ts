/**
 * Arène FPS de la vue Palantir : types partagés client ↔ serveur (PUR, aucun import three ni DOM).
 * Messages JSON sur WebSocket, champ `t` = type. Repère de scene.json : x vers l'est, z vers le
 * sud, y vers le haut, en mètres. Une position de joueur = ses PIEDS. Angles en radians :
 * `lacet` (yaw) autour de y, 0 = regard vers −z (convention three : caméra.rotation.y),
 * `tangage` (pitch) dans [−π/2, π/2], positif = regard vers le haut. Le `cap` d'un véhicule suit
 * la même convention que le lacet.
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md (v1), 2026-10-22-arene-v2-design.md (v2),
 * 2026-10-23-arene-hud-design.md (HUD : `absorbe`, `LigneStats`, `vueScores` / `scores`, `serie`),
 * 2026-10-23-arene-v3-design.md (v3 : voitures qui explosent, chat vocal de proximité),
 * 2026-10-24-arene-evenements-design.md (v4 : Truck Muche fou, tigre robot géant, titan tigre)
 */

/**
 * v2 : équipement, couteau, bouclier, accroupi, Elsa, véhicules, killcam. v3 : voitures touchées et explosions (`tir.voitures`, `voitures`,
 * `explosion`), chat vocal (`voixActif`, `voix`). v4 : événements (Truck Muche fou, tigre robot géant) et titan tigre piloté. Client et
 * serveur se déploient ensemble.
 */
export const VERSION_PROTOCOLE = 4;

export type Vec3 = [number, number, number];

// ---------- armes ----------

/** Armes à feu par catégorie. Ajouter une arme = ajouter son id ici + une entrée STATS (lib/fps/armes.ts). */
export const ARMES_PRINCIPALES = ["mitraillette", "pompe", "sniper", "fusil_assaut", "mitrailleuse"] as const;
export const ARMES_SECONDAIRES = ["pistolet", "revolver", "mini_uzi"] as const;
/** Armes spéciales : offertes par Elsa, munitions limitées, perdues à la mort. */
export const ARMES_SPECIALES = ["railgun", "minigun", "magnum_dore"] as const;

export type ArmePrincipaleId = (typeof ARMES_PRINCIPALES)[number];
export type ArmeSecondaireId = (typeof ARMES_SECONDAIRES)[number];
export type ArmeSpecialeId = (typeof ARMES_SPECIALES)[number];
/** Toute arme à feu (a une entrée dans STATS). */
export type ArmeFeuId = ArmePrincipaleId | ArmeSecondaireId | ArmeSpecialeId;
/** Arme en main : une arme à feu ou le couteau (mêlée, voir COUTEAU dans armes.ts). */
export type ArmeId = ArmeFeuId | "couteau";

/** Toutes les armes à feu (principales, secondaires puis spéciales). */
export const ARMES: readonly ArmeFeuId[] = [...ARMES_PRINCIPALES, ...ARMES_SECONDAIRES, ...ARMES_SPECIALES];

/** Emplacement d'équipement. `couteau` est toujours disponible, `speciale` seulement si portée. */
export type Slot = "principale" | "secondaire" | "couteau" | "speciale";
export const SLOTS: readonly Slot[] = ["principale", "secondaire", "couteau", "speciale"];

/** Équipement d'un joueur (le couteau est implicite). */
export interface Equipement {
  principale: ArmePrincipaleId;
  secondaire: ArmeSecondaireId;
  speciale: ArmeSpecialeId | null;
}
/**
 * Équipement et slot quand le joueur n'a rien choisi (compatibilité des tests v1 : pistolet en main).
 * FIGÉ : jamais affecté tel quel à un joueur (Elsa et `infliger` écrivent dans `speciale`) ; utiliser `copierEquipement`.
 */
export const EQUIPEMENT_DEFAUT: Readonly<Equipement> = Object.freeze({
  principale: "mitraillette" as ArmePrincipaleId, secondaire: "pistolet" as ArmeSecondaireId, speciale: null as ArmeSpecialeId | null,
});
export const SLOT_DEFAUT: Slot = "secondaire";
/** Copie modifiable d'un équipement (une par joueur). */
export function copierEquipement(e: Readonly<Equipement>): Equipement {
  return { principale: e.principale, secondaire: e.secondaire, speciale: e.speciale };
}

/** Zone touchée : la tête multiplie les dégâts (cf. lib/fps/armes.ts). */
export type Zone = "tete" | "corps";

/** Posture transmise pour l'animation des avatars distants. L'accroupi est un booléen à part. */
export type Posture = "sol" | "air" | "mur" | "mort";

/** Côté du mur pendant un wall-run (pour pencher l'avatar distant). */
export type CoteMur = -1 | 0 | 1;

/** Siège d'un véhicule : 0 = conducteur, 1 à 3 = passagers. */
export type Siege = 0 | 1 | 2 | 3;
export const SIEGES_PAR_VEHICULE = 4;

/** Comment un joueur est mort. `arme` d'un message `mort` n'a de sens que pour la cause "arme". */
export type CauseMort = "arme" | "ecrase_pnj" | "ecrase_vehicule" | "explosion" | "truck_fou" | "tigre_robot" | "titan";

/** Voiture de la circulation (`pnj`, indice dans `flotte`) ou voiture conduisible (`vehicule`, id du garage). */
export type GenreVoiture = "pnj" | "vehicule";
/**
 * État d'une voiture abîmée (v3 §4) : `fumee` (≤ 50 % de carrosserie), `feu` (≤ 20 %) ou `epave` (elle a explosé : `p`, `cap` = position
 * de l'épave, `finT` = horodatage serveur du retour de la voiture). Une voiture absente de la liste est intacte.
 */
export interface EtatVoitureMsg { genre: GenreVoiture; id: number; etat: "fumee" | "feu" | "epave"; p?: Vec3; cap?: number; finT?: number }
/**
 * Signal WebRTC du chat vocal (v3 §5), relayé tel quel par le serveur entre deux joueurs qui ont activé la voix : offre / réponse SDP
 * complètes (candidats ICE inclus, pas de « trickle »), ou `fin` (connexion fermée).
 */
export type SignalVoix = { type: "offre" | "reponse"; sdp: string } | { type: "fin" };
/** Événements de l'arène (v4) : un à la fois, annoncés à tous quelques secondes avant. */
export type TypeEvenement = "truck" | "tigre";
/** Cibles réservées des tirs (champ `cible` de `tir.touches` et de `canon.touches`) : le boss et le titan (jamais un id de joueur). */
export const CIBLE_TIGRE = "tigre";
export const CIBLE_TITAN = "titan";

// ---------- données publiques ----------

/** Joueur tel que vu par tout le monde (présence + tableau des scores). */
export interface JoueurPublic {
  id: string;
  pseudo: string;
  /** couleur hex "#rrggbb" attribuée par le serveur */
  couleur: string;
  /** dans l'arène (sinon simple spectateur de la vue Palantir) */
  enJeu: boolean;
  kills: number;
  morts: number;
  /** ms, dernière mesure */
  ping: number;
  /** kills d'affilée sans mourir (HUD §3.5 : diffusé avec la présence, déjà émise à chaque kill) ; absent = 0 */
  serie?: number;
  /** chat vocal activé (v3 §5) ; absent = non */
  voix?: boolean;
}

/** Véhicule conduisible occupé par un joueur (dans le snap du joueur). */
export interface OccupationVehicule { id: number; siege: Siege }

/** État d'un joueur en jeu dans un instantané (≈ 20 Hz). */
export interface EtatJoueurSnap {
  id: string;
  p: Vec3;
  v: Vec3;
  lacet: number;
  tangage: number;
  posture: Posture;
  mur: CoteMur;
  /** arme EN MAIN (les distants changent d'arme sans autre message) */
  arme: ArmeId;
  pv: number;
  /** PV de bouclier, 0..JEU.bouclierMax ; absent = 0 */
  bouclier?: number;
  /** accroupi (au sol) ; absent = debout */
  accroupi?: boolean;
  /** glissade en cours (sprint + accroupi au sol, déclarée par le client) ; absent = non. Remplace la déduction « accroupi et rapide » du rendu. */
  glisse?: boolean;
  /** assis dans un véhicule : `p` est alors la position du siège */
  vehicule?: OccupationVehicule;
  /** pilote du titan tigre (v3) : `p` = pieds du titan ; avatar ni dessiné ni touchable (c'est le titan qu'on vise) */
  titan?: boolean;
  vivant: boolean;
  /** invulnérable (protection d'apparition) */
  protege: boolean;
}

/** Véhicule conduisible dans le snap (positions au centime). `v` = vitesse signée le long du cap (m/s). */
export interface VehiculeSnap { id: number; p: Vec3; cap: number; v: number }
/** Occupation des sièges (diffusée au changement, et envoyée au seul joueur concerné à `rejoindre`), `null` = siège libre. */
export interface InfoVehicule { id: number; sieges: (string | null)[] }

/** Truck Muche fou (v3) : position, cap et vitesse signée le long du cap. */
export interface TruckSnap { p: Vec3; cap: number; v: number }
/** Tigre robot géant (boss, v3). `a` = coup de patte armé ou en cours (animation). */
export interface TigreSnap {
  p: Vec3; cap: number; v: number; pv: number; pvMax: number;
  /** attaque en cours : coup de patte, saut (`p[1]` = hauteur du bond), charge (ramassé puis ruée) */
  a?: "patte" | "saut" | "charge";
  /** enragé (moins de la moitié de ses PV) */
  rage?: boolean;
}
/** Titan tigre piloté (v3). */
export interface TitanSnap { pilote: string; p: Vec3; cap: number; v: number; pv: number; pvMax: number }
/** Monstres présents (snap des joueurs en arène). */
export interface MonstresSnap { truck?: TruckSnap; tigre?: TigreSnap; titan?: TitanSnap }

/** Cadeau d'Elsa. `arme` seulement pour le genre "arme". */
export interface OffreElsa { id: number; genre: "soin" | "arme"; arme?: ArmeSpecialeId; finT: number }
/** Elsa : position fixe, offre en cours ou null. `finT` = horodatage serveur (ms). */
export interface EtatElsaMsg { x: number; z: number; offre: OffreElsa | null }

/** Photographie du tueur à l'instant de la mort (killcam : carte finale et repli si le tueur a quitté). */
export interface InfoTueur {
  id: string;
  pseudo: string;
  couleur: string;
  p: Vec3;
  lacet: number;
  tangage: number;
  arme: ArmeId;
  /** PV et bouclier restants du tueur */
  pv: number;
  bouclier: number;
  /** distance tueur → victime (m) */
  distance: number;
}

export interface InfoMatch {
  /** identifiant croissant du match */
  numero: number;
  /** horodatage serveur (ms epoch) de fin prévue ; null pendant l'entracte */
  fin: number | null;
  /** kills pour gagner */
  objectif: number;
  /** "jeu" ou "entracte" (classement affiché, nouveau match à `prochain`) */
  phase: "jeu" | "entracte";
  /** horodatage serveur du prochain match pendant l'entracte */
  prochain: number | null;
}

/**
 * Ligne du classement (message `match`, fin de match). Les champs de statistiques sont les mêmes que ceux de
 * `LigneStats` (HUD §3.5) : optionnels, le message `match` de fin les porte tous.
 */
export interface LigneClassement {
  id: string; pseudo: string; couleur: string; kills: number; morts: number;
  serie?: number; serieMax?: number; tirs?: number; touches?: number; tetes?: number; degats?: number;
  armeFav?: ArmeId | null;
}

/**
 * Statistiques du match d'un joueur (tableau des scores enrichi, HUD §3.5). Compteurs tenus par `Salle`, remis à zéro à
 * chaque match : `tirs` = tirs validés (couteau exclu), `touches` = tirs ayant touché au moins un joueur, `tetes` = touches
 * dont un plomb au moins à la tête, `degats` = PV + bouclier infligés (hors véhicule), `armeFav` = arme au plus de kills.
 */
export interface LigneStats {
  id: string; serie: number; serieMax: number; tirs: number; touches: number; tetes: number;
  degats: number; armeFav: ArmeId | null; vivant: boolean; vehicule: boolean;
}

// ---------- client → serveur ----------

export type MessageClient =
  /** Premier message obligatoire : présence dans la vue Palantir (spectateur). */
  | { t: "bonjour"; v: number; pseudo: string }
  /**
   * Entrer dans l'arène. `principale`/`secondaire` = équipement (v2). `arme` = ALIAS v1 : l'arme est rangée dans
   * son slot par catégorie et devient l'arme en main (une spéciale est ignorée).
   */
  | { t: "rejoindre"; principale?: ArmePrincipaleId; secondaire?: ArmeSecondaireId; arme?: ArmeFeuId }
  /** Changer de pseudo (lobby ou en pleine partie) : le serveur le nettoie, le dédoublonne et renvoie la présence. */
  | { t: "pseudo"; pseudo: string }
  /** Sortir de l'arène (redevient spectateur). */
  | { t: "quitter" }
  /** ALIAS v1 : arme pour la prochaine apparition (immédiate si mort). Préférer `equiper`. */
  | { t: "arme"; arme: ArmeFeuId }
  /** Équipement de la prochaine apparition (immédiat si mort). */
  | { t: "equiper"; principale: ArmePrincipaleId; secondaire: ArmeSecondaireId }
  /** Changer d'arme en main (en vie). Refusé si le slot est vide. */
  | { t: "main"; slot: Slot }
  /** État prédit localement, ≈ 30 Hz. `seq` croissant. Dans un véhicule : seuls lacet/tangage comptent (passager). */
  | {
      t: "etat"; seq: number; p: Vec3; v: Vec3; lacet: number; tangage: number; posture: Posture; mur: CoteMur;
      accroupi?: boolean;
      /** glissade en cours (n'a de sens qu'avec `accroupi`) ; absent = non */
      glisse?: boolean;
    }
  /**
   * Un tir (une pression de détente ; plusieurs plombs pour le fusil à pompe). Le couteau n'utilise PAS `tir`.
   * `o` = œil du tireur, `d` = direction normalisée de chaque plomb (1 pour les autres armes),
   * `touches` = plombs qui ont touché un joueur selon le client (index dans `d`).
   */
  | {
      t: "tir"; arme: ArmeFeuId; o: Vec3; d: Vec3[]; touches: { cible: string; zone: Zone; plomb: number }[];
      /** plombs arrêtés par une voiture selon le client (v3 §4) ; absent = aucun */
      voitures?: { genre: GenreVoiture; id: number; plomb: number }[];
    }
  /** Coup de couteau. `cible` = joueur touché selon le client (null = coup dans le vide). */
  | { t: "coup"; o: Vec3; d: Vec3; cible: string | null }
  /** Monter dans un véhicule ; `siege` facultatif (sinon le plus bas libre). */
  | { t: "monter"; vehicule: number; siege?: Siege }
  | { t: "descendre" }
  /** Changer de siège dans le véhicule. */
  | { t: "siege"; siege: Siege }
  /** État du véhicule, ≈ 30 Hz, envoyé par le CONDUCTEUR seulement (remplace `etat`). */
  | { t: "conduite"; seq: number; vehicule: number; p: Vec3; cap: number; v: number; lacet: number; tangage: number }
  /** Pilote du titan (v3), ≈ 30 Hz : remplace `etat`. Le serveur borne la vitesse et repousse hors des bâtiments. */
  | { t: "pilotage"; seq: number; p: Vec3; cap: number; lacet: number; tangage: number }
  /** Tir du canon du titan (v3) : un rayon, `touches` = joueurs touchés selon le client. */
  | { t: "canon"; o: Vec3; d: Vec3; touches: { cible: string; zone: Zone }[] }
  /** Tableau des scores ouvert (Tab maintenu) ou refermé : le serveur n'envoie `scores` qu'aux clients ouverts (HUD §3.5, 1 par 250 ms). */
  | { t: "vueScores"; ouvert: boolean }
  /** Chat vocal activé ou coupé (v3 §5) : diffusé dans `presence` (`voix`). */
  | { t: "voixActif"; actif: boolean }
  /** Signal WebRTC pour le joueur `a` (relayé seulement si les deux ont la voix activée). */
  | { t: "voix"; a: string; s: SignalVoix }
  | { t: "ping"; t0: number };

// ---------- serveur → client ----------

export type MessageServeur =
  | { t: "bienvenue"; id: string; couleur: string; joueurs: JoueurPublic[]; match: InfoMatch; maintenant: number }
  /** Liste complète des connectés, renvoyée à chaque changement (arrivée, départ, score, entrée/sortie d'arène). */
  | { t: "presence"; joueurs: JoueurPublic[] }
  /** Instantané des joueurs en jeu ; `ts` = horodatage serveur ms. `vehicules` = véhicules conduisibles. */
  | { t: "snap"; ts: number; j: EtatJoueurSnap[]; vehicules?: VehiculeSnap[]; monstres?: MonstresSnap }
  /**
   * Apparition (ou réapparition) d'un joueur : le client concerné SE TÉLÉPORTE à `p`. `arme` = arme en main.
   * Après `rejoindre`, le serveur envoie dans l'ordre : `apparition`, `presence` (à tous), puis au seul joueur `elsa{evenement:"etat"}` et `sieges`
   * (le jeu est lancé après `bienvenue` : il n'a rien vu de l'état d'Elsa ni des sièges).
   */
  | {
      t: "apparition"; id: string; p: Vec3; lacet: number; arme: ArmeId; pv: number; bouclier: number;
      equip: Equipement; main: Slot; munSpeciale: number;
    }
  /** Équipement du destinataire (ramassage d'une spéciale, munitions épuisées). Privé. */
  | { t: "equipement"; equip: Equipement; main: Slot; munSpeciale: number }
  /** Tir d'un autre joueur, pour les traçantes et le son (pas renvoyé au tireur). */
  | { t: "tir"; id: string; arme: ArmeFeuId; o: Vec3; d: Vec3[] }
  /** Coup de couteau d'un autre joueur (animation et son). */
  | { t: "coup"; id: string; o: Vec3; d: Vec3 }
  /**
   * `bouclier` = bouclier restant de la cible ; `src` = position de la source (angle du marqueur de dégât) ;
   * `absorbe` = part des `degats` prise par le bouclier (HUD §3.4, absent = 0 : un client plus ancien l'ignore).
   */
  | { t: "degats"; cible: string; par: string; degats: number; pv: number; bouclier: number; zone: Zone; src?: Vec3; absorbe?: number }
  /**
   * `par` = "" si aucun joueur (écrasé par une voiture PNJ). `arme` n'a de sens que pour cause "arme"
   * (mettre "couteau" sinon). `tueur` absent si `par` est "". `ts` = horodatage serveur (ms) de la mort : il ancre le rejeu de la killcam.
   */
  | {
      t: "mort"; cible: string; par: string; arme: ArmeId; cause: CauseMort; zone: Zone; ts: number;
      /** ms avant réapparition */ delai: number; tueur?: InfoTueur;
    }
  | { t: "match"; match: InfoMatch; classement: LigneClassement[] }
  /** Elsa : offre apparue, prise ou expirée ; état complet à chaque fois. `etat` = synchronisation privée envoyée à `rejoindre`. */
  | { t: "elsa"; evenement: "etat" | "apparue" | "prise" | "expiree"; elsa: EtatElsaMsg }
  /** Un joueur a pris le cadeau d'Elsa (annonce pour tous). */
  | { t: "ramassage"; offre: number; par: string; genre: "soin" | "arme"; arme?: ArmeSpecialeId }
  /** Occupation des sièges de tous les véhicules (au changement, et à `rejoindre` au seul joueur concerné). */
  | { t: "sieges"; vehicules: InfoVehicule[] }
  /** Réponse à `monter` / `siege` acceptés : siège attribué et état de la voiture à rejoindre. Privé. */
  | { t: "embarque"; vehicule: number; siege: Siege; p: Vec3; cap: number }
  /**
   * Réponse à `monter` / `siege` / `rejoindre` refusés (jamais `erreur` : le serveur ferme la socket sur tout message `erreur`).
   * `rejoindre` n'est refusé que pour `plein` (16 agents déjà en arène). Privé.
   */
  | { t: "refus"; action: "monter" | "siege" | "rejoindre"; raison: "loin" | "plein" | "deja" | "inconnu" | "mort" }
  /** Le destinataire n'est plus dans un véhicule : il se téléporte à `p` (sortie, expulsion). Privé. */
  | { t: "descente"; p: Vec3; lacet: number; raison: "volontaire" | "expulse" }
  /** Statistiques du tableau des scores : réponse immédiate à `vueScores{ouvert:true}` puis 1 Hz, seulement aux clients ouverts. */
  | { t: "scores"; lignes: LigneStats[] }
  /** Voitures abîmées et épaves (v3 §4) : état complet, à chaque changement et au seul joueur concerné à `rejoindre`. */
  | { t: "voitures"; etats: EtatVoitureMsg[] }
  /** Une voiture explose en `p` (abattue par `par`, "" pour une réaction en chaîne sans auteur) : effet et son. */
  | { t: "explosion"; genre: GenreVoiture; id: number; p: Vec3; par: string }
  /** Signal WebRTC du joueur `de` (v3 §5). */
  | { t: "voix"; de: string; s: SignalVoix }
  /**
   * Événement (v4) : `annonce` (bandeau, `debutT` = début), `debut`, `fin` (`raison` : temps écoulé ou tigre vaincu, `par` = celui qui
   * l'a achevé). `finT` = fin prévue (horodatage serveur). `etat` = synchronisation privée d'un événement en cours, envoyée à `rejoindre`.
   */
  | { t: "evenement"; type: TypeEvenement; phase: "annonce" | "debut" | "fin" | "etat"; debutT: number; finT: number; raison?: "temps" | "vaincu"; par?: string }
  /** Laser des yeux du tigre (v4) : visée affichée tout de suite, impact à `tirT` sur un disque autour de `vers`. */
  | { t: "laser"; de: Vec3; vers: Vec3; rayon: number; tirT: number }
  /**
   * Bâtiments écrasés (v3) : `detruits` = ids (index de `scene.json`) effondrés en entier, `breches` = [id, x, z, r] (m, au décimètre) des
   * brèches arrachées aux bâtiments encore debout. `complet` : état entier qui remplace le précédent (listes vides = tout est relevé, nouveau
   * match ; envoyé aussi à `rejoindre`), sinon les seuls changements, animés (effondrement, brèche qui s'ouvre, débris).
   */
  | { t: "batiments"; complet: boolean; detruits: number[]; breches: [number, number, number, number][] }
  /** Onde de choc annoncée (saut du tigre) : anneau au sol tout de suite, impact à `tirT` sur un disque (les joueurs au sol). */
  | { t: "onde"; p: Vec3; rayon: number; tirT: number }
  /** Explosion d'un monstre (mort du tigre, titan détruit, impact du laser) : effet seulement. */
  | { t: "explosionMonstre"; p: Vec3; rayon: number }
  /**
   * Titan tigre (v4) : `debut` (le pilote passe aux commandes à `p`), `fin` (`p` = où le pilote reprend pied ; raison : détruit, durée
   * écoulée, pilote parti ; `par` = qui l'a détruit). `etat` = synchronisation privée envoyée à `rejoindre`.
   */
  | { t: "titan"; phase: "debut" | "fin" | "etat"; pilote: string; p: Vec3; cap: number; finT: number; raison?: "detruit" | "temps" | "depart"; par?: string }
  /** Tir du canon du titan (pour les traçantes et le son des autres ; pas renvoyé au pilote). */
  | { t: "canon"; id: string; o: Vec3; d: Vec3 }
  | { t: "pong"; t0: number; maintenant: number }
  | { t: "erreur"; code: "plein" | "version" | "pseudo" | "flood"; message: string };

// ---------- constantes ----------

/** Constantes de jeu partagées client/serveur. */
export const JEU = {
  pvMax: 100,
  /** PV de bouclier maximum (bonus d'Elsa) */
  bouclierMax: 100,
  /** 2,5 s de rejeu + 1,5 s de carte du tueur */
  delaiReapparitionMs: 4000,
  protectionMs: 1500,
  dureeMatchMs: 8 * 60_000,
  objectifKills: 25,
  entracteMs: 12_000,
  /** joueurs EN ARÈNE ; les spectateurs de la vue 3D ne comptent pas */
  joueursMax: 16,
  /** connexions (spectateurs compris) acceptées par la salle ; au-delà `erreur{plein}` */
  connexionsMax: 64,
  /** fréquence des instantanés serveur */
  snapHz: 20,
  /** fréquence d'envoi de l'état client (et de `conduite`) */
  etatHz: 30,
  /** fréquence d'envoi de `etat` par un passager de véhicule */
  etatPassagerHz: 15,
  /** retard d'interpolation des joueurs distants */
  interpolationMs: 110,
  /** régénération : délai sans dégât (ms) puis PV par seconde */
  regenDelaiMs: 5000,
  regenPvParS: 20,
  /** temps de sortie d'une arme au changement (ms) */
  degainageMs: 350,
  /** durée (ms) pendant laquelle PV et bouclier d'un joueur qui a quitté en vie sont restaurés à son retour (pas de soin gratuit) */
  memoSanteMs: 60_000,
} as const;

/** Plafonds de vitesse validés par le serveur (m/s). Invariant : MOUV.vitesseMaxH < vitesseHorizontaleMax ≤ vitesseDeclareeMax. */
export const PLAFONDS = {
  vitesseHorizontaleMax: 19,
  vitesseDeclareeMax: 24,
  vitesseVerticaleMax: 45,
  vitesseVehiculeMax: 28,
} as const;

/** Les avatars sont dessinés et touchés à cette échelle (autour des pieds). Le cylindre de collision ne change pas. */
export const ECHELLE_AVATAR = 1.25;

/**
 * Silhouette : `rayon`/`hauteur`/`oeil` = cylindre de MOUVEMENT et œil (collision au monde, jamais agrandi) ;
 * `tete`/`corps`/`centreY`/`rayonEnglobant` = HITBOX de tir (pieds en p, tête = sphère, corps = capsule verticale).
 */
export interface Silhouette {
  readonly rayon: number;
  readonly hauteur: number;
  readonly oeil: number;
  /** hauteur du centre de la boule englobante de la hitbox */
  readonly centreY: number;
  readonly rayonEnglobant: number;
  readonly tete: { readonly y: number; readonly rayon: number };
  readonly corps: { readonly y0: number; readonly y1: number; readonly rayon: number };
}

export const SILHOUETTE: Silhouette = {
  rayon: 0.4,
  hauteur: 1.8,
  oeil: 1.95,
  centreY: 1.05,
  rayonEnglobant: 1.45,
  tete: { y: 2.0, rayon: 0.3 },
  corps: { y0: 0.19, y1: 1.73, rayon: 0.475 },
};

/** Même silhouette accroupie (ou assis dans un véhicule). */
export const SILHOUETTE_ACCROUPIE: Silhouette = {
  rayon: 0.4,
  hauteur: 1.2,
  oeil: 1.3,
  centreY: 0.8,
  rayonEnglobant: 1.15,
  tete: { y: 1.3, rayon: 0.3 },
  corps: { y0: 0.19, y1: 1.0, rayon: 0.475 },
};

export function silhouetteDe(accroupi: boolean | undefined): Silhouette {
  return accroupi ? SILHOUETTE_ACCROUPIE : SILHOUETTE;
}

/** Hauteur de l'œil assis dans un véhicule (m au-dessus de `p`, la position du siège). */
export const OEIL_SIEGE = 1.3;

/** Hauteur de l'œil du pilote du titan tigre (m au-dessus des pieds du titan). */
export const OEIL_TITAN = 9.5;

/** Hauteur de l'œil d'un joueur : pilote du titan, assis (`vehicule` défini), accroupi ou debout. SEULE source pour caméra, serveur, killcam et visibilité. */
export function oeilDe(e: { accroupi?: boolean; vehicule?: unknown; titan?: boolean }): number {
  if (e.titan) return OEIL_TITAN;
  return e.vehicule ? OEIL_SIEGE : silhouetteDe(e.accroupi).oeil;
}
