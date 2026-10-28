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
 * 2026-10-24-arene-evenements-design.md (v4 : Truck Muche fou, tigre robot géant, titan tigre),
 * 2026-10-23-arene-tigres-design.md (v5 : avion, tigres largués, sort d'invocation),
 * 2026-10-27-arene-zombies-design.md (v6 : mode zombies, épée, deux salles, à côté des tigres largués),
 * 2026-10-28-zombies-bo1-design.md (v7 : zombies façon Black Ops 1, carte intérieure, atouts, Pack-a-Punch, bonus, boîte mobile, planches, Truck)
 */
import type { Difficulte, GenreBonus } from "./zombies-vagues";

/**
 * v2 : équipement, couteau, bouclier, accroupi, Elsa, véhicules, killcam. v3 : voitures touchées et explosions (`tir.voitures`, `voitures`,
 * `explosion`), chat vocal (`voixActif`, `voix`). v4 : événements (Truck Muche fou, tigre robot géant) et titan tigre piloté. v5 : tigres
 * largués (snap `tigres`, messages `avion`, `tigre`, `sort`, client `invoquer`, cause de mort "tigre"). v6 : mode « zombies tigres » (deux salles,
 * choix du mode, argent, achats, relève, snap `zombies`), épée (mêlée à plusieurs cibles), cause de mort "tigre_zombie". v7 : zombies façon
 * Black Ops 1 (états de partie étendus, `zevt`, `reparer`, difficulté, armes améliorées `Equipement.ameliorees`, drapeaux d'allure et de mode
 * des tigres, Truck Muche dans le snap). v8 : réseau sans téléportation (`apparition.garder` à la relève, reprise d'une partie de zombies
 * après une micro-coupure : `bienvenue.jeton` / `bienvenue.reprise`, `bonjour.reprise`) et carte « Service de midi » redécoupée
 * (aménagements ajoutés aux pièces : index des prismes de `batiments{detruits}` et positions d'achats partagés). Client et serveur se
 * déploient ensemble.
 */
export const VERSION_PROTOCOLE = 8;

export type Vec3 = [number, number, number];

// ---------- armes ----------

/** Armes à feu par catégorie. Ajouter une arme = ajouter son id ici + une entrée STATS (lib/fps/armes.ts). */
export const ARMES_PRINCIPALES = ["mitraillette", "pompe", "sniper", "fusil_assaut", "mitrailleuse"] as const;
export const ARMES_SECONDAIRES = ["pistolet", "revolver", "mini_uzi"] as const;
/** Armes secondaires du mode zombies seulement (v7) : jamais proposées au lobby de l'arène ni acceptées de son équipement. */
export const ARMES_SECONDAIRES_ZOMBIES = ["rayon"] as const;
/** Armes spéciales : offertes par Elsa, munitions limitées, perdues à la mort. */
export const ARMES_SPECIALES = ["railgun", "minigun", "magnum_dore"] as const;
/** Armes uniques : larguées par le bus C3 (lance-grenades, bazooka, fumigène). */
export const ARMES_UNIQUES = ["lance_grenades", "bazooka", "fumigene"] as const;

export type ArmePrincipaleId = (typeof ARMES_PRINCIPALES)[number];
export type ArmeSecondaireId = (typeof ARMES_SECONDAIRES)[number] | (typeof ARMES_SECONDAIRES_ZOMBIES)[number];
export type ArmeSpecialeId = (typeof ARMES_SPECIALES)[number];
export type ArmeUniqueId = (typeof ARMES_UNIQUES)[number];
/** Toute arme à feu (a une entrée dans STATS). */
export type ArmeFeuId = ArmePrincipaleId | ArmeSecondaireId | ArmeSpecialeId | ArmeUniqueId;
/** Armes de mêlée (slot `couteau`) : le couteau (défaut) ou l'épée (voir `MELEE` dans armes.ts). */
export const ARMES_MELEE = ["couteau", "epee"] as const;
export type ArmeMeleeId = (typeof ARMES_MELEE)[number];
export const estMelee = (x: unknown): x is ArmeMeleeId => (ARMES_MELEE as readonly unknown[]).includes(x);
/** Arme en main : une arme à feu ou une arme de mêlée. */
export type ArmeId = ArmeFeuId | ArmeMeleeId;

/** Toutes les armes à feu (principales, secondaires, spéciales puis uniques). */
export const ARMES: readonly ArmeFeuId[] = [...ARMES_PRINCIPALES, ...ARMES_SECONDAIRES, ...ARMES_SECONDAIRES_ZOMBIES, ...ARMES_SPECIALES, ...ARMES_UNIQUES];

/** Emplacement d'équipement. `couteau` est toujours disponible, `speciale` seulement si portée. */
export type Slot = "principale" | "secondaire" | "couteau" | "speciale";
export const SLOTS: readonly Slot[] = ["principale", "secondaire", "couteau", "speciale"];

/** Équipement d'un joueur (une arme blanche est toujours portée : le couteau tant que `melee` est absent). */
export interface Equipement {
  principale: ArmePrincipaleId;
  secondaire: ArmeSecondaireId;
  speciale: ArmeSpecialeId | ArmeUniqueId | null;
  /** arme blanche du slot `couteau` ; absent = couteau (v5) */
  melee?: ArmeMeleeId;
  /**
   * Pas d'arme principale (zombies, v5) : `principale` garde une valeur de remplissage mais le slot est vide
   * (`armeDuSlot` / `slotDeLArme` de equipement.ts renvoient null). Absent = a une principale.
   */
  sansPrincipale?: true;
  /** (v7, zombies) armes passées au Pack-a-Punch ; absent = aucune */
  ameliorees?: ArmeFeuId[];
}
/**
 * Équipement et slot quand le joueur n'a rien choisi (compatibilité des tests v1 : pistolet en main).
 * FIGÉ : jamais affecté tel quel à un joueur (Elsa et `infliger` écrivent dans `speciale`) ; utiliser `copierEquipement`.
 */
export const EQUIPEMENT_DEFAUT: Readonly<Equipement> = Object.freeze({
  principale: "mitraillette" as ArmePrincipaleId, secondaire: "pistolet" as ArmeSecondaireId, speciale: null as ArmeSpecialeId | ArmeUniqueId | null,
});
export const SLOT_DEFAUT: Slot = "secondaire";
/** Copie modifiable d'un équipement (une par joueur). `melee` et `sansPrincipale` ne sont recopiés que s'ils sont définis (jamais de clé `undefined`). */
export function copierEquipement(e: Readonly<Equipement>): Equipement {
  const copie: Equipement = { principale: e.principale, secondaire: e.secondaire, speciale: e.speciale };
  if (e.melee !== undefined) copie.melee = e.melee;
  if (e.sansPrincipale) copie.sansPrincipale = true;
  if (e.ameliorees && e.ameliorees.length) copie.ameliorees = [...e.ameliorees];
  return copie;
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

/**
 * Comment un joueur est mort. `arme` d'un message `mort` n'a de sens que pour la cause "arme". "tigre" : coup d'un tigre largué, sauvage
 * (`par` = "") ou allié (`par` = le lanceur, crédité du kill). "tigre_robot" : le tigre géant des événements, jamais un tigre largué.
 * "tigre_zombie" : coup d'un tigre zombie du mode zombies.
 */
export type CauseMort = "arme" | "ecrase_pnj" | "ecrase_vehicule" | "tigre" | "explosion" | "truck_fou" | "tigre_robot" | "titan" | "tigre_zombie" | "bus_c3" | "frappe_aerienne";

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
/** (v7) Cible réservée des tirs sur le Truck Muche d'une manche de livraison (mode zombies). */
export const CIBLE_LIVRAISON = "livraison";

// ---------- mode zombies (v5) ----------

/** Mode de jeu d'une salle : l'arène (chacun pour soi) ou les zombies tigres (coopératif par manches). */
export type ModeSalle = "arene" | "zombies";
export const MODES_SALLE: readonly ModeSalle[] = ["arene", "zombies"];

/** Id d'un tigre zombie dans les messages (`tir.touches[].cible`, `degats.cible`, `coup.cibles`, `zombieMort.id`) : "z" + numéro, jamais un id joueur "j<n>". */
export const idZombie = (n: number): string => `z${n}`;
export const estIdZombie = (s: unknown): s is string => typeof s === "string" && /^z\d+$/.test(s);

export type PhaseZombies = "lobby" | "pause" | "manche" | "fin";
/** (v7) Atouts des distributeurs (cf. `ATOUTS` de zombies-carte.ts). */
export type AtoutId = "gratin" | "expresso" | "ristretto" | "pausecafe";
/** (v7) Boîte mystère : fermée, armes qui défilent (`tirage`), arme offerte au joueur `pour` (`offre`), envolée vers un autre emplacement. */
export interface EtatBoite {
  emplacement: number; etat: "fermee" | "tirage" | "offre" | "envol"; arme?: ArmeFeuId | "peluche"; pour?: string;
  /** fin de l'étape en cours (horodatage serveur ms), 0 si la boîte est fermée */
  finT: number;
  /** utilisations depuis le dernier déménagement */
  utilisations: number;
}
/** (v7) Pack-a-Punch : libre ou en cuisson de l'arme `arme` de `joueur` jusqu'à `finT`. */
export interface EtatPap { etat: "libre" | "cuisson"; joueur?: string; arme?: ArmeFeuId; finT?: number }
/** (v7) Bonus au sol : disparaît à `finT` (il clignote les 11 dernières secondes). */
export interface BonusSol { id: number; genre: GenreBonus; p: Vec3; finT: number }
/** (v7) Fins (horodatage serveur ms, 0 = inactif) des bonus à durée. */
export interface EffetsZombies { instakillFinT: number; doubleFinT: number; soldesFinT: number }
/** (v7) Recette ultime : ingrédients ramassés, fin de la cuisson en cours, faite. */
export interface QueteZombies { ingredients: string[]; cuissonFinT: number; faite: boolean }
/** (v7) Truck Muche d'une manche de livraison : quai, étape et fin de l'étape. */
export interface TruckZombies { phase: "arrivee" | "livraison" | "depart" | "epave"; quai: number; finT: number }
export interface JoueurZombies {
  id: string; pseudo: string; couleur: string;
  /** attente = dans le lobby (pas encore admis), debout, à terre (relevable), éliminé (spectateur jusqu'à la pause) */
  etat: "attente" | "debout" | "terre" | "elimine";
  admis: boolean; kills: number; gagne: number; reanimations: number;
  /** horodatage serveur (ms) où un joueur à terre est éliminé s'il n'est pas relevé */
  terreFinT?: number;
  /** (v7) atouts bus, auto-relèves de la Pause Café restantes (solo) */
  atouts: AtoutId[];
  autoReleves: number;
}
export interface EtatPartieZombies {
  phase: PhaseZombies; manche: number; hote: string; capacite: number; debutT: number;
  /** fin de la pause / du bilan (horodatage serveur ms) */
  finT: number;
  joueurs: JoueurZombies[]; portes: { id: string; ouverte: boolean }[];
  bilan?: { manche: number; dureeMs: number };
  // ---- v7 ----
  difficulte: Difficulte;
  /** courant rétabli (atouts sauf la Pause Café, Pack-a-Punch, lumières, truffe) */
  courant: boolean;
  boite: EtatBoite;
  pap: EtatPap;
  /** planches restantes par fenêtre, dans l'ordre de `FENETRES` */
  fenetres: number[];
  bonus: BonusSol[];
  effets: EffetsZombies;
  quete: QueteZombies;
  /** manche de livraison du Truck Muche en cours (ou à venir pendant la pause : `mancheTruck`) */
  mancheTruck: boolean;
  truck: TruckZombies | null;
  /** armes déjà achetées au mur (le modèle remplace la craie) */
  murs: string[];
}
/** (v7) Effet ponctuel de la partie de zombies (sons, particules, annonces), message `zevt`. */
export type EvenementZombies =
  | { e: "planche"; fenetre: string; arrachee: boolean }
  | { e: "bonusLache"; id: number; genre: GenreBonus; p: Vec3 }
  | { e: "bonus"; genre: GenreBonus; par: string; p: Vec3 }
  | { e: "nuke"; p: Vec3 }
  | { e: "courant" }
  | { e: "peluche"; de: number }
  | { e: "atout"; joueur: string; atout: AtoutId }
  | { e: "pap"; joueur: string; arme: ArmeFeuId; pret: boolean }
  | { e: "truck"; quoi: "klaxon" | "porte" | "explosion"; p: Vec3 }
  | { e: "explosion"; p: Vec3; rayon: number; par: string }
  | { e: "ingredient"; id: string; par: string }
  | { e: "cuisson"; fin: boolean }
  | { e: "manche"; numero: number; truck: boolean }
  | { e: "autoReleve"; joueur: string };
/** Raisons d'un achat refusé (`achat{ok:false}`). */
export type RaisonAchat = "argent" | "loin" | "deja" | "verrou" | "partie" | "courant" | "occupe" | "quete";

/** Tigre zombie dans un snap : `z` est un tableau plat de stride `PAS_SNAP_ZOMBIE`. */
export interface SnapZombies {
  /** tigres restants à tuer (pas encore apparus + vivants) */
  r: number;
  /**
   * [id, xCm, zCm, capMrad, drapeaux, pvPct] par tigre ; drapeaux : bits 0–1 type (0 tigre, 1 doré, 2 chef, 3 petit), bit 2 griffe armée,
   * bit 3 apparition, bits 4–5 allure (marche, course, sprint, rampant), bits 6–7 mode (chasse, sol, fenêtre, saut)
   */
  z: number[];
  /** (v7) Truck Muche d'une manche de livraison : [xCm, zCm, capMrad, phase (0 arrivée, 1 livraison, 2 départ, 3 épave), pvPct] */
  t?: number[];
}
/** (v7) Mode d'un tigre : en chasse, sortant du sol, à une fenêtre (approche ou arrachage), sautant par la fenêtre ; `approche` reste au serveur. */
export type ModeZombie = "chasse" | "sol" | "approche" | "fenetre" | "saut";
const MODES_SNAP: readonly ModeZombie[] = ["chasse", "sol", "fenetre", "saut"];
export const PAS_SNAP_ZOMBIE = 6;
/** Tigre zombie décodé (positions en mètres, cap en radians, `pvPct` 0..100). */
export interface ZombieSnap {
  id: number; x: number; z: number; cap: number;
  type: 0 | 1 | 2 | 3; griffe: boolean; apparition: boolean; pvPct: number;
  allure: 0 | 1 | 2 | 3; mode: Exclude<ModeZombie, "approche">;
}
/** Encode des tigres en entiers : position au centimètre, cap au milliradian, PV au pour cent ; `truck` tel quel. */
export function encoderZombies(restants: number, zombies: readonly ZombieSnap[], truck?: number[]): SnapZombies {
  const z: number[] = new Array(zombies.length * PAS_SNAP_ZOMBIE);
  let k = 0;
  for (const m of zombies) {
    z[k++] = m.id;
    z[k++] = Math.round(m.x * 100);
    z[k++] = Math.round(m.z * 100);
    z[k++] = Math.round(m.cap * 1000);
    z[k++] = (m.type & 3) | (m.griffe ? 4 : 0) | (m.apparition ? 8 : 0) | ((m.allure & 3) << 4) | (Math.max(0, MODES_SNAP.indexOf(m.mode)) << 6);
    z[k++] = Math.max(0, Math.min(100, Math.round(m.pvPct)));
  }
  return truck ? { r: restants, z, t: truck } : { r: restants, z };
}
/** Décode `SnapZombies` (tolère un tableau tronqué : les tigres incomplets sont ignorés). */
export function decoderZombies(s: SnapZombies): ZombieSnap[] {
  const res: ZombieSnap[] = [];
  const n = Math.floor(s.z.length / PAS_SNAP_ZOMBIE);
  for (let i = 0; i < n; i++) {
    const b = i * PAS_SNAP_ZOMBIE;
    const d = s.z[b + 4];
    res.push({
      id: s.z[b], x: s.z[b + 1] / 100, z: s.z[b + 2] / 100, cap: s.z[b + 3] / 1000,
      type: (d & 3) as 0 | 1 | 2 | 3, griffe: (d & 4) !== 0, apparition: (d & 8) !== 0, pvPct: s.z[b + 5],
      allure: ((d >> 4) & 3) as 0 | 1 | 2 | 3, mode: MODES_SNAP[(d >> 6) & 3] as ZombieSnap["mode"],
    });
  }
  return res;
}

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
/** Bus C3 express : position, cap, vitesse, actif, passagers sur le toit. */
export interface BusSnap { p: Vec3; cap: number; v: number; actif: boolean; passagers?: string[] }
/** Arme unique larguée par le bus C3 sur la chaussée. */
export interface ArmeLacheeSnap { id: string; arme: ArmeUniqueId; p: Vec3 }
/** Zone de fumée active. */
export interface FumigeneSnap { id: string; p: Vec3; debutT: number; finT: number }
/** Frappe aérienne en cours. */
export interface FrappeSnap { id: string; cible: Vec3; joueur: string; t0: number; finT: number }

/** Monstres et éléments dynamiques présents (snap des joueurs en arène). */
export interface MonstresSnap {
  truck?: TruckSnap;
  tigre?: TigreSnap;
  titan?: TitanSnap;
  bus?: BusSnap;
  armesLachees?: ArmeLacheeSnap[];
  fumigenes?: FumigeneSnap[];
  frappes?: FrappeSnap[];
}

/** Cadeau d'Elsa. `arme` seulement pour le genre "arme". */
export interface OffreElsa { id: number; genre: "soin" | "arme"; arme?: ArmeSpecialeId; finT: number }
/** Elsa : position fixe, offre en cours ou null. `finT` = horodatage serveur (ms). */
export interface EtatElsaMsg { x: number; z: number; offre: OffreElsa | null }

// ---------- tigres largués (v5) ----------

/** Tigre largué par l'avion (sauvage) ou invoqué par le sort d'un joueur (allié). */
export type GenreTigre = "sauvage" | "allie";
/**
 * État d'un tigre. Sauvage : `descente` (parachute) → `tapi` → `alerte` → `attaque` → `fuite` (sous 30 % des PV) → `repos` (régénération
 * dans la nouvelle cachette) → `tapi`, et `retour` = sans cible, il rentre à sa cachette. Allié : `suivi` (accompagne le lanceur) ou `attaque`.
 */
export type EtatTigre = "descente" | "tapi" | "alerte" | "attaque" | "fuite" | "repos" | "retour" | "suivi";
/** Pose du tigre, qui fixe sa silhouette de touche (`SILHOUETTES_TIGRE` de tigre-arene.ts). */
export type PoseTigre = "couche" | "debout" | "course";
/** Action en cours : coup de patte, bond annoncé (le tigre se ramasse et rugit) puis bond. */
export type ActionTigre = "patte" | "ramasse" | "bond";

/**
 * Tigre largué ou allié dans le snap (positions au centime, angles au milliradian). `actionT` = horodatage serveur du début de `action`.
 * Distinct de `TigreSnap`, le tigre géant des événements.
 */
export interface TigreLargueSnap {
  id: string;
  genre: GenreTigre;
  /** lanceur d'un tigre allié */
  lanceur?: string;
  p: Vec3;
  cap: number;
  etat: EtatTigre;
  pose: PoseTigre;
  pv: number;
  action?: ActionTigre;
  actionT?: number;
}

/**
 * Passage d'un avion : ligne droite de `depart` à `arrivee` (x, z) à `altitude` et `vitesse` constantes, de `debutT` à `finT` (horodatages
 * serveur, ms). `largageT` = instant où le tigre quitte l'avion. Le point d'atterrissage n'est pas transmis.
 */
export interface PassageAvion {
  id: number;
  depart: [number, number];
  arrivee: [number, number];
  altitude: number;
  vitesse: number;
  debutT: number;
  finT: number;
  largageT: number;
}

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
  /**
   * Premier message obligatoire : présence dans la vue Palantir (spectateur). `reprise` (v8) : identifiant et jeton de la session coupée
   * (`bienvenue.jeton`) ; dans les `REPRISE_MS` qui suivent la coupure, le serveur rattache le client à sa partie de zombies, même identifiant.
   */
  | { t: "bonjour"; v: number; pseudo: string; reprise?: { id: string; jeton: string } }
  /**
   * Entrer dans l'arène. `principale`/`secondaire` = équipement (v2). `arme` = ALIAS v1 : l'arme est rangée dans
   * son slot par catégorie et devient l'arme en main (une spéciale est ignorée).
   */
  | { t: "rejoindre"; principale?: ArmePrincipaleId; secondaire?: ArmeSecondaireId; melee?: ArmeMeleeId; arme?: ArmeFeuId }
  /** Changer de pseudo (lobby ou en pleine partie) : le serveur le nettoie, le dédoublonne et renvoie la présence. */
  | { t: "pseudo"; pseudo: string }
  /** Sortir de l'arène (redevient spectateur). */
  | { t: "quitter" }
  /** ALIAS v1 : arme pour la prochaine apparition (immédiate si mort). Préférer `equiper`. */
  | { t: "arme"; arme: ArmeFeuId }
  /** Équipement de la prochaine apparition (immédiat si mort). */
  | { t: "equiper"; principale: ArmePrincipaleId; secondaire: ArmeSecondaireId; melee?: ArmeMeleeId }
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
  /** Coup d'arme blanche. `cibles` = ids de joueurs ET de tigres `z<n>` touchés selon le client (vide = coup dans le vide ; au plus `nbCiblesMax` de l'arme). */
  | { t: "coup"; o: Vec3; d: Vec3; cibles: string[] }
  /** Choisir le mode (v5) : change de salle, refusé (`refus{mode}`) en pleine partie ou si la salle zombies est pleine. */
  | { t: "mode"; mode: ModeSalle }
  /** Lancer la partie de zombies (hôte du lobby seulement) ; v7 : difficulté choisie (défaut « plat »). */
  | { t: "lancerPartie"; difficulte?: Difficulte }
  /**
   * Acheter ou utiliser (zombies) : `id` du catalogue (`mur:<arme>`, `boite:B<n>` (acheter ou prendre l'arme offerte), `atout:<id>`, `pap`,
   * `courant`, `ingredient:<id>`, `four`, portes `D1`…), à ≤ 2,5 m (3 m d'une porte) de l'achat.
   */
  | { t: "acheter"; id: string }
  /** (v7) Maintenir E devant une fenêtre pour reposer ses planches ; `null` = relâché. */
  | { t: "reparer"; fenetre: string | null }
  /** Maintenir E près d'un coéquipier à terre (zombies) ; `null` = relâché. */
  | { t: "reanimer"; cible: string | null }
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
  /** Lancer le sort d'invocation (v3) : ignoré sans charge, mort, hors phase de jeu ou dans un véhicule. */
  | { t: "invoquer" }
  /** Chat vocal activé ou coupé (v3 §5) : diffusé dans `presence` (`voix`). */
  | { t: "voixActif"; actif: boolean }
  /** Signal WebRTC pour le joueur `a` (relayé seulement si les deux ont la voix activée). */
  | { t: "voix"; a: string; s: SignalVoix }
  /** Lancer une frappe aérienne ciblée (au bout de 5 kills d'affilée). */
  | { t: "lancerFrappe"; cible: Vec3 }
  /** Lancer une grenade fumigène. */
  | { t: "lancerFumigene"; p: Vec3; v: Vec3 }
  /** Monter sur le toit du bus C3 s'il est proche. */
  | { t: "monterBus" }
  | { t: "ping"; t0: number };

// ---------- serveur → client ----------

export type MessageServeur =
  /**
   * Inscription. `jeton` (v8) : secret de reprise de la session (à renvoyer dans `bonjour.reprise` après une coupure) ; `reprise` (v8) : la
   * session coupée a été reprise (même `id`, même salle, partie de zombies en cours conservée) au lieu d'une nouvelle inscription dans l'arène.
   */
  | { t: "bienvenue"; id: string; couleur: string; joueurs: JoueurPublic[]; match: InfoMatch; maintenant: number; jeton?: string; reprise?: true }
  /** Liste complète des connectés, renvoyée à chaque changement (arrivée, départ, score, entrée/sortie d'arène). */
  | { t: "presence"; joueurs: JoueurPublic[] }
  /**
   * Instantané des joueurs en jeu, `ts` = horodatage serveur ms. `vehicules` = véhicules conduisibles. `tigres` = tigres largués présents
   * (absent = aucun). `monstres` = Truck Muche fou, tigre géant et titan des événements. `zombies` = tigres zombies (salle zombies seulement).
   */
  | { t: "snap"; ts: number; j: EtatJoueurSnap[]; vehicules?: VehiculeSnap[]; tigres?: TigreLargueSnap[]; monstres?: MonstresSnap; zombies?: SnapZombies }
  /**
   * Apparition (ou réapparition) d'un joueur : le client concerné SE TÉLÉPORTE à `p`. `arme` = arme en main. `garder` (v8, zombies : relève,
   * reprise après une coupure) : le client garde SA position et son regard (à moins de `ECART_GARDE_M` de `p`), santé et armes sont remises.
   * Après `rejoindre`, le serveur envoie dans l'ordre : `apparition`, `presence` (à tous), puis au seul joueur `elsa{evenement:"etat"}` et `sieges`
   * (le jeu est lancé après `bienvenue` : il n'a rien vu de l'état d'Elsa ni des sièges).
   */
  | {
      t: "apparition"; id: string; p: Vec3; lacet: number; arme: ArmeId; pv: number; bouclier: number;
      equip: Equipement; main: Slot; munSpeciale: number; garder?: true;
    }
  /** Équipement du destinataire (ramassage d'une spéciale, munitions épuisées). Privé. */
  | { t: "equipement"; equip: Equipement; main: Slot; munSpeciale: number; ravitaille?: ArmeFeuId | "tout" }
  /** Tir d'un autre joueur, pour les traçantes et le son (pas renvoyé au tireur). */
  | { t: "tir"; id: string; arme: ArmeFeuId; o: Vec3; d: Vec3[] }
  /** Coup d'arme blanche d'un autre joueur (animation et son). */
  | { t: "coup"; id: string; o: Vec3; d: Vec3; arme: ArmeMeleeId }
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
   * Réponse à `monter` / `siege` / `rejoindre` / `mode` refusés (jamais `erreur` : le serveur ferme la socket sur tout message `erreur`).
   * `rejoindre` n'est refusé que pour `plein` (16 agents déjà en arène) ou `lobby` (zombies : joueur non admis) ; `mode` pour `plein`
   * (salle zombies pleine) ou `lobby` (déjà en jeu). Privé.
   */
  | { t: "refus"; action: "monter" | "siege" | "rejoindre" | "mode"; raison: "loin" | "plein" | "deja" | "inconnu" | "mort" | "lobby" }
  /** Le destinataire n'est plus dans un véhicule : il se téléporte à `p` (sortie, expulsion). Privé. */
  | { t: "descente"; p: Vec3; lacet: number; raison: "volontaire" | "expulse" }
  /**
   * Avion (v3) : `passage` au début d'un survol, `largage` quand le tigre `tigre` quitte l'avion (annonce HUD), `etat` = synchronisation
   * privée envoyée à `rejoindre` (`avion` null hors survol).
   */
  | { t: "avion"; evenement: "passage" | "largage" | "etat"; avion: PassageAvion | null; tigre?: string }
  /**
   * Tigre (v3) : `apparu` (largage ou invocation), `alerte` (il a repéré `cible`), `touche` (dégâts reçus : `par`, `degats`, `pv`, `zone`),
   * `mort` (`par` = auteur du dernier coup, "" sans joueur), `parti` (départ du sauvage au bout de 4 min, fin du tigre allié).
   * `p` = position du tigre à l'événement.
   */
  | {
      t: "tigre"; evenement: "apparu" | "alerte" | "touche" | "mort" | "parti"; id: string; genre: GenreTigre; lanceur?: string; p: Vec3;
      cible?: string; par?: string; degats?: number; pv?: number; zone?: Zone;
    }
  /** Sort d'invocation (v3) : `gagne` (tigre sauvage abattu par `joueur`), `lance` (tigre allié `tigre`), `perdu` (mort, sortie, fin de match). */
  | { t: "sort"; evenement: "gagne" | "lance" | "perdu"; joueur: string; tigre?: string; raison?: "mort" | "quitte" | "fin_match" }
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
  /** Résumé des deux salles (v5), diffusé à TOUS les clients à la connexion puis au changement (≤ 1 Hz) : compteurs du choix du mode. */
  | { t: "salons"; arene: { joueurs: number; enJeu: number }; zombies: { phase: PhaseZombies; joueurs: number; manche: number } }
  /** Confirmation du changement de salle (écho de `mode`), suivie du `bienvenue` de la nouvelle salle. */
  | { t: "mode"; mode: ModeSalle }
  /** État de la partie de zombies (aux membres de la salle zombies, à chaque changement, ≤ 5 Hz). */
  | { t: "zombies"; etat: EtatPartieZombies }
  /** Argent du destinataire (zombies) : solde, variation et motif (« touche », « kill », « manche », « achat »…). Privé. */
  | { t: "argent"; solde: number; delta: number; motif: string }
  /** Réponse à `acheter`. Privé. */
  | { t: "achat"; ok: boolean; id: string; raison?: RaisonAchat }
  /** Un tigre zombie est mort en `p`, tué par `par` (effets et sons ; jamais dans le fil des éliminations). */
  | { t: "zombieMort"; id: string; p: Vec3; par: string; zone: Zone; cause?: "explosion" | "nuke" | "melee" }
  /** (v7) Effet ponctuel de la partie de zombies (aux membres de la salle). */
  | { t: "zevt"; e: EvenementZombies }
  /** Frappe aérienne : disponible (série de 5 kills), lancée (coordonnées ciblées), perdue. */
  | { t: "frappe"; evenement: "disponible" | "lancee" | "perdue"; joueur: string; cible?: Vec3; serie?: number }
  /** Fumigène activé en un point. */
  | { t: "fumigene"; id: string; p: Vec3; debutT: number; finT: number }
  /** Bus C3 express : annonce d'arrivée, passage, départ. */
  | { t: "busC3"; evenement: "annonce" | "passage" | "fin"; p?: Vec3; cap?: number; v?: number }
  /** Ramassage d'une arme unique tombée du bus C3. */
  | { t: "ramassageArme"; id: string; par: string; arme: ArmeUniqueId }
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

/**
 * (v8) `apparition.garder` : le client garde sa position si elle est à moins de cet écart (m) de celle du serveur, qui suit ses états (budget
 * de distance) ; au-delà (client qui ment, état perdu), il se replace sur celle du serveur.
 */
export const ECART_GARDE_M = 3;

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
