/**
 * Sons de l'arène FPS, tous synthétisés avec WebAudio (bruit filtré + oscillateurs + enveloppes) :
 * aucun fichier audio. Le contexte audio n'est créé qu'au premier geste de l'utilisateur (politique
 * d'autoplay des navigateurs) ; avant cela, et si WebAudio manque, tous les appels sont sans effet.
 *
 * Les tirs lointains passent `position` : le gain baisse avec la distance, les aigus s'éteignent et
 * `pan` (−1 gauche … 1 droite, calculé par jeu.ts d'après l'angle du tireur) place le son. Les tigres largués (rugissement, coup de
 * patte, plainte) et l'avion qui les largue sont placés de la même façon (spec 2026-10-23-arene-tigres-design.md, Rendu). Le tigre
 * géant des événements a ses propres sons (`alerte`, `laser`, `pasLourd`, `explosionMonstre`), jamais ceux des tigres largués.
 *
 * Exceptions au « tout synthétisé » : le moteur de la voiture conduite est un VRAI enregistrement (`/arene/moteur.wav`, boucle de
 * ralenti CC0, cf. public/arene/CREDITS.txt) joué en boucle, dont la vitesse de lecture (donc le régime) suit celle de la voiture (v3 §3) ;
 * et le mode zombies a ses échantillons (tonnerre, rire du Truck, grenades, micro-ondes, tigre chef, fanfare, annonces parlées), dont le
 * registre et la logique pure (calage du pic, limite de voix, file des annonces) sont dans `sons-echantillons.ts`. Un chargeur commun
 * (`telecharger` : fetch → decodeAudioData, cache par URL, échec silencieux) les sert ; ils passent par la même sortie spatialisée que les
 * sons synthétisés. Tant qu'un fichier n'est pas chargé (ou s'il manque), un son synthétisé le remplace : le jeu n'est jamais muet.
 */
import type { ArmeFeuId, ArmeMeleeId, AtoutId } from "./protocole";
import {
  ECHANTILLONS, ECHANTILLONS_SIMULTANES_MAX, FileAnnonces, URLS_ZOMBIES, VOIX_ANNONCES, ANNONCES_EN_ATTENTE_MAX, departCale, instantPic, voixLibre,
  type IdEchantillon, type IdVoix,
} from "./sons-echantillons";
import { ZOMBIES } from "./zombies-vagues";

/** Voix de tigres en même temps au plus (zombies) : au-delà, un nouveau rugissement est ignoré. */
export const VOIX_TIGRES_MAX = 4;

/**
 * (Battle Royale) Vent de la chute libre : vitesse (m/s) à partir de laquelle on l'entend, et à laquelle il est à son maximum (piqué à
 * 55 m/s, `CHUTE_BR.libre`). Sous voile (6,5 m/s) il ne reste rien : le silence du parachute fait partie de la descente.
 */
export const VENT_CHUTE = { vitesseMin: 12, vitesseMax: 55, gainMin: 0.04, gainMax: 0.5, filtreMin: 500, filtreMax: 4200 } as const;

/** Intensité du vent de chute, de 0 (en dessous de `vitesseMin`, silence) à 1 (piqué), croissante et lissée ; une valeur invalide donne 0. */
export function intensiteVentChute(vitesse: number): number {
  if (!Number.isFinite(vitesse)) return 0;
  const u = (Math.abs(vitesse) - VENT_CHUTE.vitesseMin) / (VENT_CHUTE.vitesseMax - VENT_CHUTE.vitesseMin);
  const k = Math.min(Math.max(u, 0), 1);
  return k * k * (3 - 2 * k);
}

/** Gain et fréquence du passe-bande du vent de chute pour une intensité de 0 à 1 : plus fort et plus aigu à mesure qu'on accélère. */
export const reglageVentChute = (intensite: number): { gain: number; filtre: number } => {
  const k = Math.min(Math.max(Number.isFinite(intensite) ? intensite : 0, 0), 1);
  return {
    gain: VENT_CHUTE.gainMin + (VENT_CHUTE.gainMax - VENT_CHUTE.gainMin) * k,
    filtre: VENT_CHUTE.filtreMin + (VENT_CHUTE.filtreMax - VENT_CHUTE.filtreMin) * k,
  };
};

export interface PositionSon {
  /** distance au tireur (m) */
  distance: number;
  /** −1 = à gauche, 1 = à droite */
  pan: number;
}

export interface Sons {
  /** Tir d'une arme ; `position` pour un tir d'un autre joueur (omis = son du joueur local). */
  tir(arme: ArmeFeuId, position?: PositionSon): void;
  /**
   * (v8) Crépitement bref d'un arc électrique (chaîne d'une arme électrique entre des tigres), le même quelle que soit l'arme : le tir qui
   * l'a lancé a déjà son propre son.
   */
  arc(position?: PositionSon): void;
  /** Séquence de rechargement (clics de chargeur, culasse, cartouches). */
  recharge(arme: ArmeFeuId): void;
  /** J'ai touché quelqu'un (tic ; plus aigu et plus sec à la tête). Joué à la réception de `degats` du serveur (v2 §13.2). */
  touche(tete?: boolean): void;
  /** J'ai tué quelqu'un (ding). */
  kill(): void;
  pas(): void;
  /** Souffle du wall-run : `true` le lance (en boucle), `false` l'éteint. */
  mur(on: boolean): void;
  /** J'ai été touché. */
  degat(): void;
  /** Frottement de la glissade : `true` le lance (en boucle), `false` l'éteint. */
  glisse(on: boolean): void;
  /**
   * Coup d'arme blanche (sifflement de lame ; `touche` ajoute l'impact sur la chair). `position` pour le coup d'un autre joueur
   * (omis = le mien). `arme` : le couteau par défaut ; l'épée siffle plus longtemps, tinte (métal) et frappe plus lourd.
   */
  coup(touche: boolean, position?: PositionSon, arme?: ArmeMeleeId): void;
  /** Cadeau d'Elsa ramassé : carillon doux pour la vie, carillon plus grave et cliquetis métallique pour une arme. */
  ramassage(genre: "soin" | "arme"): void;
  /** Un cran de régénération de vie (tic doux). */
  regen(): void;
  /**
   * Moteur de la voiture conduite : oscillateurs en boucle dont la hauteur suit la vitesse (m/s, valeur absolue).
   * `null` l'éteint (descente, mort, killcam). Plusieurs appels par seconde sont attendus : seule la hauteur change.
   */
  moteur(vitesse: number | null): void;
  /** Crissement des pneus en dérapage : intensité 0 (silence) à 1 ; la boucle ne tourne que tant qu'elle est > 0. */
  derapage(intensite: number): void;
  /** Choc de voiture ; `force` de 0 (frôlement) à 1 (plein fouet). */
  choc(force: number): void;
  /** Coup de klaxon (facultatif, réservé au conducteur). */
  klaxon(): void;
  /** Rugissement d'un tigre (alerte, bond annoncé). `position` : où il est par rapport à moi. */
  rugissement(position?: PositionSon): void;
  /** Coup de patte d'un tigre (griffes qui fendent l'air, choc sourd). */
  patte(position?: PositionSon): void;
  /** Plainte d'un tigre qui meurt. */
  plainte(position?: PositionSon): void;
  /**
   * Moteur de l'avion qui largue les tigres : bourdonnement grave en boucle, atténué et panoramiqué d'après `position`, à rappeler à chaque
   * image pendant le survol. `null` l'éteint (fin du survol, killcam, sortie de l'arène).
   */
  avion(position: PositionSon | null): void;
  /** Cran de la molette de zoom de la lunette. */
  zoom(): void;
  /** Ma balle a frappé la tôle d'une voiture (v3 §4). */
  tole(): void;
  /** Explosion d'une voiture (v3 §4) ; `position` pour l'atténuer avec la distance. */
  explosion(position?: PositionSon): void;
  /** (v4) Sirène d'alerte d'un événement : klaxon furieux pour le Truck Muche, rugissement métallique pour le tigre robot. */
  alerte(genre: "truck" | "tigre"): void;
  /** (v4) Charge du laser des yeux du tigre (montée aiguë) ; `position` = yeux du tigre. */
  laser(position?: PositionSon): void;
  /** (v4) Explosion d'un monstre (impact du laser, mort du tigre, titan détruit) ; `force` 0..1. */
  explosionMonstre(force: number, position?: PositionSon): void;
  /** (v4) Tir du canon du titan (le mien, ou celui du pilote à `position`). */
  canon(position?: PositionSon): void;
  /** (v4) Klaxon de camion (trompe à air, accord de trois notes) du Truck Muche fou, entendu de loin dans toute l'arène. */
  klaxonCamion(position?: PositionSon): void;
  /**
   * (v8, zombies) Klaxon aigu et nasillard d'un mini Truck Muche : deux « pouet » qui montent ; `meche` : mèche allumée, quatre coups
   * pressés et plus aigus (il va sauter).
   */
  klaxonMiniTruck(position?: PositionSon, meche?: boolean): void;
  /** (v4) Bâtiment qui s'effondre (grondement long et fracas). */
  effondrement(position?: PositionSon): void;
  /** (v4) Pas lourd du tigre ou du titan. */
  pasLourd(position?: PositionSon): void;
  /**
   * (zombies) Rugissement d'un tigre, spatialisé ; au plus `VOIX_TIGRES_MAX` (4) voix en même temps, les suivantes sont ignorées.
   * `mort` : cri plus court qui s'éteint (un tigre vient de tomber). Renvoie vrai si la voix a été jouée.
   */
  rugissementTigre(position?: PositionSon, mort?: boolean): boolean;
  /** (zombies) Coup de patte d'un tigre, joué au début de l'armement : feulement, puis griffes qui fendent l'air et choc au contact, spatialisé. */
  griffe(position?: PositionSon, armeS?: number): void;
  /** (zombies) Achat accepté (caisse enregistreuse) ou refusé (buzz grave). */
  achat(ok: boolean): void;
  /** (zombies) Pièce gagnée (touche, kill, bonus de manche) : tic cristallin. */
  piece(): void;
  /** (zombies) Nouvelle manche : coup de tambour grave et cuivres qui montent. */
  manche(): void;
  // ---- v7 (zombies façon Black Ops 1) ----
  /** Fin de manche : accord grave qui retombe (la manche est gagnée, le calme revient). */
  finManche(): void;
  /** Manche de livraison du Truck Muche : sirène et accord menaçant. */
  mancheTruck(): void;
  /** Planche arrachée (craquement de bois) ou reposée (coups de marteau). */
  planche(arrachee: boolean, position?: PositionSon): void;
  /** Jingle d'un distributeur d'atout (quatre notes propres à chacun) et gorgée. */
  jingleAtout(atout: AtoutId): void;
  /** Boîte mystère : boîte à musique (tirage) ou rire de la peluche. */
  boite(genre: "tirage" | "peluche", position?: PositionSon): void;
  /** Bonus ramassé (fanfare, cf. `fanfareBonus`) ; un bonus qui tombe (scintillement). */
  bonus(ramasse: boolean, position?: PositionSon): void;
  /** Courant rétabli : clac du disjoncteur, montée des néons. */
  courant(): void;
  /** Micro-ondes : porte et bourdonnement pendant la cuisson (`microOndesCuisson`), trois bips quand c'est prêt (`microOndesBip`). */
  microondes(pret: boolean, position?: PositionSon): void;
  /**
   * Annonce parlée par la synthèse vocale du navigateur (repli des annonces échantillonnées) : attend la liste des voix, choisit une voix
   * française, ne coupe pas l'annonce en cours (file du navigateur, au plus `ANNONCES_EN_ATTENTE_MAX` en attente), précédée d'un jingle.
   */
  annonce(texte: string): void;
  // ---- échantillons du mode zombies (registre : sons-echantillons.ts) ; chacun a un repli synthétisé ----
  /** Lance le téléchargement de tous les fichiers du mode zombies (décodés dès que le contexte audio existe). */
  prechargerZombies(): void;
  /**
   * Joue l'échantillon `id` dans `retardS` s, spatialisé par `position`. Rend vrai s'il est pris en charge (joué, ou ignoré car toutes
   * ses voix sont prises) et faux s'il n'est pas chargé : à l'appelant de jouer un repli.
   */
  echantillon(id: IdEchantillon, position?: PositionSon, retardS?: number): boolean;
  /** Annonce parlée de l'annonceur (file : jamais coupée, enchaînée), au plus tôt dans `auPlusTotS` s ; repli : `annonce(texte)`. */
  voix(id: IdVoix, auPlusTotS?: number): void;
  /** Coup de tonnerre (éclair de la manche du Truck Muche). */
  tonnerre(position?: PositionSon): void;
  /** Rire maléfique du Truck Muche enragé, dans `retardS` s. */
  rireTruck(position?: PositionSon, retardS?: number): void;
  /** Explosion d'une grenade (ou d'un tir explosif) ; `force` 0..1. */
  explosionGrenade(position?: PositionSon, force?: number): void;
  /** Rebond d'une grenade sur le sol ou un mur ; `force` 0..1 (vitesse de l'impact). */
  rebondGrenade(position?: PositionSon, force?: number): void;
  /** Micro-ondes Gratinator : la porte claque et la cuisson bourdonne (3,4 s). */
  microOndesCuisson(position?: PositionSon): void;
  /** Micro-ondes Gratinator : trois bips à 1 kHz, c'est prêt. */
  microOndesBip(position?: PositionSon): void;
  /** (v8) Porte payante qui s'ouvre (BO1) : déverrouillage, glissement qui monte, bois qui tombe et petit choc sourd. */
  ouverturePorte(position?: PositionSon): void;
  /**
   * Coup de patte du tigre chef (son fourni par le joueur, retour 16), joué au début de l'armement : son pic (cherché dans le fichier)
   * tombe au contact, `ZOMBIES.griffeArmeS` plus tard, comme le claquement de `griffe`, qui sert de repli.
   */
  griffeChef(position?: PositionSon): void;
  /** Rugissement du tigre chef ; repli et limite de voix : ceux de `rugissementTigre`. Rend vrai si une voix a été jouée. */
  grognementChef(position?: PositionSon): boolean;
  /** Fanfare d'un bonus ramassé (avant son annonce). */
  fanfareBonus(position?: PositionSon): void;
  /** Klaxon deux tons du bus C3. */
  klaxonBus(position?: PositionSon): void;
  /** Sirène d'alerte de frappe aérienne. */
  sireneFrappe(position?: PositionSon): void;
  /** Déploiement et sifflement d'un fumigène. */
  fumigene(position?: PositionSon): void;
  // ---- v8 (Battle Royale) ----
  /**
   * Vent de la chute libre : bruit filtré en boucle dont le volume et la hauteur suivent la vitesse (m/s, norme de la vitesse du parachutiste,
   * voir `intensiteVentChute`). À rappeler à chaque image pendant la chute ; `null`, une vitesse invalide ou trop faible (parachute ouvert)
   * l'éteint.
   */
  ventChute(vitesse: number | null): void;
  /** Ouverture du parachute : claquement de la toile qui se gonfle, puis souffle qui retombe. */
  voile(): void;
  /**
   * Avertissement de zone : `true` lance (en boucle) la pulsation grave « hors zone » de la tempête, `false` l'éteint. Idempotent, à appeler
   * à chaque image avec l'état courant.
   */
  avertissementZone(horsZone: boolean): void;
  /** La zone commence à se resserrer : grondement qui monte, puis tonalité d'alerte. */
  zoneSeResserre(): void;
  /**
   * Usage d'un soin : `debut` (déchirement du sparadrap pour le bandage, bouchon qui saute et gorgées pour la potion) ou `fin` (le soin
   * s'applique : carillon doux pour le bandage, accord cristallin pour le bouclier).
   */
  usageSoin(objet: "bandage" | "potion", etape: "debut" | "fin"): void;
  // ---- v8 (grenades des zombies) : points d'entrée stables ; rebond et explosion lisent les échantillons de `explosionGrenade` /
  // `rebondGrenade` (synthèse en repli), le reste est synthétisé ----
  /** Grenade lancée : cuillère qui saute et souffle du bras (la mienne), ou froissement lointain (celle d'un autre, `position`). */
  grenadeLancer(position?: PositionSon): void;
  /** Rebond d'une grenade sur le carrelage ou un mur ; `force` = vitesse du choc (m/s). */
  grenadeRebond(force: number, position?: PositionSon): void;
  /** Explosion d'une grenade : détonation sèche, souffle, éclats qui retombent. */
  grenadeExplosion(position?: PositionSon): void;
  /** Bip de cuisson (goupille tirée, la mèche court) : un clic métallique par demi-seconde. */
  grenadeBip(): void;
  /** Tigre à remontoir posé : coup de cymbales et cliquetis du ressort (à rejouer à chaque claquement). */
  remontoir(position?: PositionSon): void;
  /**
   * (v8) Grand secret : les seuls retours que le joueur en a sont des sons du décor (pendule qui repart, coup de midi, casserole qui tinte,
   * marmite qui bout, givre, four qui s'embrase, bip d'écran, couperet, cloche) et un accord discret quand une étape se referme. `k` (0..1) :
   * avancée (la casserole tinte plus haut à chaque bonne note). Tous synthétisés.
   */
  secret(son: SonSecret, position?: PositionSon, k?: number): void;
  dispose(): void;
}

/** (v8) Sons du grand secret (`Sons.secret`). */
export type SonSecret =
  | "tic" | "carillon" | "coupMidi" | "ding" | "clang" | "bouillon" | "accord" | "souffleFroid" | "givre" | "fonte" | "flamme" | "bip"
  | "buzz" | "hachoir" | "choeur" | "cloche";

interface OptionsBruit {
  dur: number;
  type: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
  gain: number;
  att?: number;
}

interface OptionsTon {
  dur: number;
  type: OscillatorType;
  f0: number;
  f1?: number;
  gain: number;
  att?: number;
}

/** Instants (s après le début) et timbre des clics de rechargement de chaque arme. */
type Clic = { t: number; f: number; g: number };
const CLICS_PISTOLET: Clic[] = [{ t: 0.2, f: 1200, g: 0.35 }, { t: 0.85, f: 1700, g: 0.45 }, { t: 1.1, f: 2300, g: 0.4 }];
const CLICS_MITRAILLETTE: Clic[] = [{ t: 0.3, f: 1100, g: 0.4 }, { t: 1.3, f: 1600, g: 0.5 }, { t: 1.75, f: 2200, g: 0.4 }];
const CLICS_POMPE: Clic[] = [
  { t: 0.4, f: 1400, g: 0.35 }, { t: 0.78, f: 1400, g: 0.35 }, { t: 1.15, f: 1400, g: 0.35 },
  { t: 1.5, f: 1400, g: 0.35 }, { t: 1.85, f: 1400, g: 0.35 }, { t: 2.15, f: 900, g: 0.55 },
];
const CLICS_SNIPER: Clic[] = [
  { t: 0.3, f: 1500, g: 0.4 }, { t: 0.5, f: 1100, g: 0.4 }, { t: 1.1, f: 1000, g: 0.4 },
  { t: 1.9, f: 1500, g: 0.5 }, { t: 2.4, f: 1100, g: 0.4 }, { t: 2.6, f: 1800, g: 0.5 },
];
/** Fusil d'assaut (2,2 s) : décrochage du chargeur, chargeur neuf, manette d'armement. */
const CLICS_FUSIL_ASSAUT: Clic[] = [{ t: 0.25, f: 1000, g: 0.4 }, { t: 0.55, f: 800, g: 0.3 }, { t: 1.25, f: 1500, g: 0.5 }, { t: 1.85, f: 2000, g: 0.45 }];
/** Mitrailleuse (4,2 s) : capot qui s'ouvre, bande retirée, boîte neuve, capot refermé, armement. */
const CLICS_MITRAILLEUSE: Clic[] = [
  { t: 0.4, f: 900, g: 0.5 }, { t: 1.0, f: 700, g: 0.4 }, { t: 1.6, f: 600, g: 0.45 }, { t: 2.5, f: 1100, g: 0.5 },
  { t: 2.9, f: 1300, g: 0.35 }, { t: 3.4, f: 1000, g: 0.55 }, { t: 3.9, f: 2000, g: 0.5 },
];
/** Revolver (2,2 s) : barillet qui sort, étuis éjectés, six cartouches une à une, barillet refermé. */
const CLICS_REVOLVER: Clic[] = [
  { t: 0.3, f: 1000, g: 0.4 }, { t: 0.6, f: 1800, g: 0.35 },
  { t: 1.0, f: 1500, g: 0.3 }, { t: 1.12, f: 1500, g: 0.3 }, { t: 1.24, f: 1500, g: 0.3 },
  { t: 1.36, f: 1500, g: 0.3 }, { t: 1.48, f: 1500, g: 0.3 }, { t: 1.6, f: 1500, g: 0.3 },
  { t: 1.9, f: 1200, g: 0.5 },
];
/** Mini uzi (1,6 s) : chargeur éjecté, chargeur inséré, culasse. */
const CLICS_MINI_UZI: Clic[] = [{ t: 0.2, f: 1300, g: 0.35 }, { t: 0.75, f: 1900, g: 0.45 }, { t: 1.3, f: 2400, g: 0.4 }];

/** Les armes spéciales n'ont pas de rechargement (`sansRecharge`) : aucun clic. */
const CLICS_RECHARGE: Record<ArmeFeuId, Clic[]> = {
  pistolet: CLICS_PISTOLET, mitraillette: CLICS_MITRAILLETTE, pompe: CLICS_POMPE, sniper: CLICS_SNIPER,
  fusil_assaut: CLICS_FUSIL_ASSAUT, mitrailleuse: CLICS_MITRAILLEUSE, revolver: CLICS_REVOLVER, mini_uzi: CLICS_MINI_UZI,
  railgun: [], minigun: [], magnum_dore: [],
  rayon: [{ t: 0.4, f: 900, g: 0.4 }, { t: 1.4, f: 1600, g: 0.35 }, { t: 2.4, f: 2200, g: 0.45 }],
  lance_grenades: [], bazooka: [], fumigene: [],
  // (v8) armes du mode zombies seulement
  baguette: [{ t: 0.3, f: 900, g: 0.5 }, { t: 0.7, f: 1400, g: 0.3 }, { t: 1.3, f: 1400, g: 0.35 }, { t: 1.6, f: 1400, g: 0.35 }, { t: 2.0, f: 800, g: 0.55 }],
  agrafeuse: [{ t: 0.3, f: 1000, g: 0.4 }, { t: 1.3, f: 1500, g: 0.5 }, { t: 1.95, f: 2100, g: 0.45 }],
  photocopieuse: [{ t: 0.35, f: 800, g: 0.45 }, { t: 1.2, f: 600, g: 0.4 }, { t: 2.0, f: 1200, g: 0.5 }, { t: 2.6, f: 2000, g: 0.45 }],
  essoreuse: [
    { t: 0.4, f: 1400, g: 0.35 }, { t: 0.75, f: 1400, g: 0.35 }, { t: 1.1, f: 1400, g: 0.35 }, { t: 1.45, f: 1400, g: 0.35 },
    { t: 1.8, f: 1400, g: 0.35 }, { t: 2.15, f: 1400, g: 0.35 }, { t: 2.5, f: 1400, g: 0.35 }, { t: 2.95, f: 900, g: 0.55 },
  ],
  brochette: [{ t: 0.4, f: 700, g: 0.45 }, { t: 1.2, f: 1300, g: 0.35 }, { t: 1.9, f: 2200, g: 0.5 }],
  soufflerie: [{ t: 0.5, f: 600, g: 0.5 }, { t: 1.4, f: 900, g: 0.45 }, { t: 2.4, f: 1800, g: 0.5 }],
  grille_pain: [{ t: 0.4, f: 800, g: 0.4 }, { t: 1.5, f: 1700, g: 0.4 }, { t: 2.5, f: 2600, g: 0.45 }],
  perforeuse: [{ t: 0.2, f: 1250, g: 0.35 }, { t: 0.95, f: 1800, g: 0.45 }, { t: 1.3, f: 2300, g: 0.4 }],
};

/** Enregistrement du moteur (boucle de ralenti CC0) et réglages de sa lecture. */
const URL_MOTEUR = "/arene/moteur.wav";
/** Vitesse de lecture au ralenti et à `VITESSE_REGIME_MAX` m/s (le régime monte avec la vitesse). */
const REGIME_RALENTI = 0.85;
const REGIME_MAX = 2.1;
const VITESSE_REGIME_MAX = 28;
/** Gain du moteur (avant le master à 0,55) : discret au ralenti, à peine plus fort à fond (v3 §3 : il faisait mal aux oreilles). */
const GAIN_MOTEUR_RALENTI = 0.16;
const GAIN_MOTEUR_MAX = 0.3;

/** Briques sonores qu'un profil de tir assemble (liées au contexte audio de `creerSons`). */
interface BriquesSon {
  bruit(dest: AudioNode, t: number, o: OptionsBruit): void;
  ton(dest: AudioNode, t: number, o: OptionsTon): void;
  clic(dest: AudioNode, t: number, f: number, gain: number): void;
}
/** `v` = variation de hauteur aléatoire (0,92 à 1,08) : deux tirs ne sonnent jamais pareil. */
type ProfilTir = (b: BriquesSon, out: AudioNode, t: number, v: number) => void;

/** Une entrée par arme à feu : `Record` exhaustif, une arme oubliée casse la compilation (voulu). */
const PROFILS_TIR: Record<ArmeFeuId, ProfilTir> = {
  pistolet(b, out, t, v) {
    b.bruit(out, t, { dur: 0.11, type: "bandpass", f0: 2600 * v, f1: 900, q: 0.8, gain: 0.9 });
    b.bruit(out, t, { dur: 0.03, type: "highpass", f0: 5000, gain: 0.5 });
    b.ton(out, t, { dur: 0.12, type: "sine", f0: 190 * v, f1: 55, gain: 0.7 });
  },
  mitraillette(b, out, t, v) {
    b.bruit(out, t, { dur: 0.07, type: "bandpass", f0: 2200 * v, f1: 1100, q: 0.9, gain: 0.65 });
    b.bruit(out, t, { dur: 0.02, type: "highpass", f0: 4500, gain: 0.35 });
    b.ton(out, t, { dur: 0.06, type: "sine", f0: 150 * v, f1: 70, gain: 0.5 });
  },
  pompe(b, out, t, v) {
    b.bruit(out, t, { dur: 0.32, type: "lowpass", f0: 2500 * v, f1: 250, gain: 1 });
    b.bruit(out, t, { dur: 0.08, type: "bandpass", f0: 1800, q: 0.6, gain: 0.7 });
    b.ton(out, t, { dur: 0.3, type: "sine", f0: 95 * v, f1: 32, gain: 1 });
    b.clic(out, t + 0.45, 1300, 0.45);
    b.clic(out, t + 0.6, 1800, 0.5);
  },
  sniper(b, out, t, v) {
    b.bruit(out, t, { dur: 0.6, type: "lowpass", f0: 4000 * v, f1: 200, gain: 1 });
    b.bruit(out, t, { dur: 0.06, type: "highpass", f0: 3000, gain: 0.8 });
    b.ton(out, t, { dur: 0.5, type: "sine", f0: 80 * v, f1: 28, gain: 1 });
    b.bruit(out, t + 0.16, { dur: 0.5, type: "lowpass", f0: 900, f1: 200, gain: 0.35 }); // écho dans la vallée
    b.clic(out, t + 0.55, 1500, 0.4);
    b.clic(out, t + 0.8, 1100, 0.45);
  },
  /** Claquement sec et médium, entre la mitraillette et le sniper : cadence soutenue, donc court. */
  fusil_assaut(b, out, t, v) {
    b.bruit(out, t, { dur: 0.09, type: "bandpass", f0: 2000 * v, f1: 850, q: 0.85, gain: 0.75 });
    b.bruit(out, t, { dur: 0.025, type: "highpass", f0: 4200, gain: 0.4 });
    b.ton(out, t, { dur: 0.08, type: "sine", f0: 130 * v, f1: 58, gain: 0.6 });
  },
  /** Plus grave et plus lourde que le fusil, avec une queue de métal. */
  mitrailleuse(b, out, t, v) {
    b.bruit(out, t, { dur: 0.1, type: "bandpass", f0: 1500 * v, f1: 700, q: 0.8, gain: 0.8 });
    b.bruit(out, t, { dur: 0.03, type: "highpass", f0: 3500, gain: 0.35 });
    b.ton(out, t, { dur: 0.1, type: "sine", f0: 105 * v, f1: 45, gain: 0.75 });
    b.ton(out, t + 0.01, { dur: 0.06, type: "triangle", f0: 520 * v, f1: 300, gain: 0.12 });
  },
  /** Gros calibre : un « boum » long et un claquement de culasse métallique. */
  revolver(b, out, t, v) {
    b.bruit(out, t, { dur: 0.24, type: "lowpass", f0: 3200 * v, f1: 300, gain: 1 });
    b.bruit(out, t, { dur: 0.035, type: "highpass", f0: 4800, gain: 0.7 });
    b.ton(out, t, { dur: 0.22, type: "sine", f0: 120 * v, f1: 38, gain: 0.95 });
    b.ton(out, t + 0.012, { dur: 0.1, type: "triangle", f0: 900 * v, f1: 500, gain: 0.1 });
  },
  /** Petit calibre très aigu et très bref : il se répète 16 fois par seconde. */
  mini_uzi(b, out, t, v) {
    b.bruit(out, t, { dur: 0.045, type: "bandpass", f0: 3200 * v, f1: 1900, q: 1.0, gain: 0.55 });
    b.bruit(out, t, { dur: 0.015, type: "highpass", f0: 5200, gain: 0.3 });
    b.ton(out, t, { dur: 0.04, type: "sine", f0: 230 * v, f1: 120, gain: 0.35 });
  },
  /** Décharge électrique : sifflement montant, éclair large bande, détonation sourde et tintement de rail. */
  railgun(b, out, t, v) {
    b.ton(out, t, { dur: 0.16, type: "sawtooth", f0: 260 * v, f1: 2400, gain: 0.35, att: 0.02 });
    b.bruit(out, t + 0.12, { dur: 0.25, type: "highpass", f0: 5500, f1: 9000, gain: 0.7 });
    b.bruit(out, t + 0.12, { dur: 0.5, type: "lowpass", f0: 3800 * v, f1: 150, gain: 0.95 });
    b.ton(out, t + 0.12, { dur: 0.55, type: "sine", f0: 70 * v, f1: 24, gain: 1 });
    b.ton(out, t + 0.14, { dur: 0.7, type: "sine", f0: 1250, f1: 420, gain: 0.16 });
    b.bruit(out, t + 0.3, { dur: 0.6, type: "lowpass", f0: 800, f1: 180, gain: 0.3 }); // écho
  },
  /** Rafale grondante : chaque tir est un souffle grave très court, à peine plus que le bruit de la cadence. */
  minigun(b, out, t, v) {
    b.bruit(out, t, { dur: 0.05, type: "bandpass", f0: 1400 * v, f1: 800, q: 0.9, gain: 0.5 });
    b.bruit(out, t, { dur: 0.015, type: "highpass", f0: 3800, gain: 0.25 });
    b.ton(out, t, { dur: 0.05, type: "sine", f0: 110 * v, f1: 62, gain: 0.5 });
  },
  /** Le revolver en plus rond et plus long, avec un « ting » doré qui s'attarde. */
  magnum_dore(b, out, t, v) {
    b.bruit(out, t, { dur: 0.3, type: "lowpass", f0: 3500 * v, f1: 240, gain: 1 });
    b.bruit(out, t, { dur: 0.04, type: "highpass", f0: 4500, gain: 0.7 });
    b.ton(out, t, { dur: 0.3, type: "sine", f0: 88 * v, f1: 32, gain: 1 });
    b.ton(out, t + 0.02, { dur: 0.45, type: "triangle", f0: 2300, f1: 1900, gain: 0.12 });
    b.ton(out, t + 0.02, { dur: 0.3, type: "sine", f0: 3450, f1: 3300, gain: 0.05 });
  },
  /** (v7) Pistolet à rayons : « piou » de science-fiction qui descend, souffle électrique et petit grave. */
  rayon(b, out, t, v) {
    b.ton(out, t, { dur: 0.22, type: "square", f0: 1900 * v, f1: 240, gain: 0.22 });
    b.ton(out, t, { dur: 0.18, type: "sine", f0: 1250 * v, f1: 160, gain: 0.35 });
    b.bruit(out, t, { dur: 0.1, type: "bandpass", f0: 3500, f1: 1200, q: 1.2, gain: 0.25 });
    b.ton(out, t + 0.02, { dur: 0.12, type: "sine", f0: 110 * v, f1: 50, gain: 0.4 });
  },
  lance_grenades(b, out, t, v) {
    b.bruit(out, t, { dur: 0.22, type: "lowpass", f0: 1800 * v, f1: 300, gain: 0.95 });
    b.ton(out, t, { dur: 0.25, type: "sine", f0: 110 * v, f1: 45, gain: 0.9 });
  },
  bazooka(b, out, t, v) {
    b.bruit(out, t, { dur: 0.45, type: "lowpass", f0: 3200 * v, f1: 250, gain: 1 });
    b.bruit(out, t, { dur: 0.15, type: "bandpass", f0: 1200, q: 0.7, gain: 0.8 });
    b.ton(out, t, { dur: 0.4, type: "sine", f0: 75 * v, f1: 25, gain: 1 });
  },
  fumigene(b, out, t, v) {
    b.bruit(out, t, { dur: 0.18, type: "bandpass", f0: 3500 * v, f1: 1500, q: 1.2, gain: 0.7 });
    b.ton(out, t, { dur: 0.15, type: "sine", f0: 220 * v, f1: 90, gain: 0.5 });
  },
  // ---- (v8) armes du mode zombies seulement ----
  /** Double canon : une détonation énorme et grave, le canon qui résonne. */
  baguette(b, out, t, v) {
    b.bruit(out, t, { dur: 0.42, type: "lowpass", f0: 2200 * v, f1: 180, gain: 1 });
    b.bruit(out, t, { dur: 0.1, type: "bandpass", f0: 1500, q: 0.6, gain: 0.8 });
    b.ton(out, t, { dur: 0.4, type: "sine", f0: 80 * v, f1: 26, gain: 1 });
    b.ton(out, t + 0.03, { dur: 0.35, type: "triangle", f0: 420 * v, f1: 260, gain: 0.08 });
  },
  /** Semi-automatique lourd : claquement sec, un peu de métal (l'agrafe qui part). */
  agrafeuse(b, out, t, v) {
    b.bruit(out, t, { dur: 0.16, type: "bandpass", f0: 2400 * v, f1: 700, q: 0.8, gain: 0.85 });
    b.bruit(out, t, { dur: 0.03, type: "highpass", f0: 5200, gain: 0.55 });
    b.ton(out, t, { dur: 0.14, type: "sine", f0: 140 * v, f1: 50, gain: 0.75 });
    b.clic(out, t + 0.06, 2600 * v, 0.25);
  },
  /** Tambour de 71 coups : chaque tir est un claquement mat et bref, la cadence fait le reste. */
  photocopieuse(b, out, t, v) {
    b.bruit(out, t, { dur: 0.055, type: "bandpass", f0: 1900 * v, f1: 1000, q: 0.9, gain: 0.6 });
    b.bruit(out, t, { dur: 0.015, type: "highpass", f0: 4800, gain: 0.3 });
    b.ton(out, t, { dur: 0.05, type: "square", f0: 160 * v, f1: 90, gain: 0.18 });
  },
  /** Pompe semi-automatique : plus court que le pompe (pas de pompe à actionner), la culasse revient seule. */
  essoreuse(b, out, t, v) {
    b.bruit(out, t, { dur: 0.26, type: "lowpass", f0: 2600 * v, f1: 260, gain: 0.95 });
    b.bruit(out, t, { dur: 0.07, type: "bandpass", f0: 1900, q: 0.6, gain: 0.6 });
    b.ton(out, t, { dur: 0.24, type: "sine", f0: 100 * v, f1: 36, gain: 0.9 });
    b.clic(out, t + 0.12, 1700 * v, 0.35);
  },
  /** Arbalète : corde qui claque, sifflement du pique qui part. */
  brochette(b, out, t, v) {
    b.ton(out, t, { dur: 0.08, type: "triangle", f0: 320 * v, f1: 140, gain: 0.55 });
    b.bruit(out, t, { dur: 0.05, type: "highpass", f0: 3200, gain: 0.35 });
    b.bruit(out, t + 0.02, { dur: 0.3, type: "bandpass", f0: 2600 * v, f1: 5200, q: 2.5, gain: 0.22 });
  },
  /** Soufflerie : montée de turbine, puis une rafale de vent grave et large qui balaie tout. */
  soufflerie(b, out, t, v) {
    b.ton(out, t, { dur: 0.18, type: "sawtooth", f0: 180 * v, f1: 900, gain: 0.2, att: 0.05 });
    b.bruit(out, t + 0.12, { dur: 0.9, type: "lowpass", f0: 1800 * v, f1: 120, gain: 1 });
    b.bruit(out, t + 0.12, { dur: 0.5, type: "bandpass", f0: 700, f1: 300, q: 0.5, gain: 0.7 });
    b.ton(out, t + 0.12, { dur: 0.7, type: "sine", f0: 60 * v, f1: 22, gain: 1 });
  },
  /** Grille-pain : bourdonnement électrique, puis le claquement de l'arc (craquement large bande). */
  grille_pain(b, out, t, v) {
    b.ton(out, t, { dur: 0.12, type: "square", f0: 120 * v, f1: 180, gain: 0.25, att: 0.02 });
    b.bruit(out, t + 0.08, { dur: 0.35, type: "highpass", f0: 2500, f1: 7000, gain: 0.8 });
    b.bruit(out, t + 0.08, { dur: 0.25, type: "bandpass", f0: 900, q: 0.7, gain: 0.6 });
    b.ton(out, t + 0.08, { dur: 0.3, type: "sawtooth", f0: 1800 * v, f1: 300, gain: 0.12 });
    b.ton(out, t + 0.1, { dur: 0.4, type: "sine", f0: 75 * v, f1: 30, gain: 0.8 });
  },
  /** Pistolet lourd : entre le pistolet et le revolver, sec et métallique. */
  perforeuse(b, out, t, v) {
    b.bruit(out, t, { dur: 0.09, type: "bandpass", f0: 2900 * v, f1: 1000, q: 0.85, gain: 0.85 });
    b.bruit(out, t, { dur: 0.025, type: "highpass", f0: 5400, gain: 0.45 });
    b.ton(out, t, { dur: 0.1, type: "sine", f0: 170 * v, f1: 60, gain: 0.65 });
  },
};

export function creerSons(): Sons {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let bruitBuf: AudioBuffer | null = null;
  let fini = false;
  let souffle: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  /** frottement de la glissade (bruit en boucle filtré) */
  let frottement: { src: AudioBufferSourceNode; gain: GainNode; filtre: BiquadFilterNode } | null = null;
  /** moteur de l'avion : deux oscillateurs désaccordés (battement des hélices) et un souffle, filtrés et panoramiqués par image */
  let avionVoix: { oscs: OscillatorNode[]; souffle: AudioBufferSourceNode; gain: GainNode; filtre: BiquadFilterNode; pan: StereoPannerNode | null } | null = null;
  /**
   * moteur de la voiture conduite : l'enregistrement en boucle (`echantillon`, vitesse de lecture = régime) ou, à défaut, un oscillateur
   * triangle grave + un grain de bruit (`oscs`), le tout sous un passe-bas qui s'ouvre avec la vitesse
   */
  let moteurVoix: { oscs: OscillatorNode[]; gain: GainNode; filtre: BiquadFilterNode; grain: AudioBufferSourceNode; echantillon: boolean } | null = null;
  /** boucle de moteur décodée (null tant qu'elle n'est pas chargée), chargement en cours, échec définitif */
  let moteurBuf: AudioBuffer | null = null;
  let moteurCharge = false;
  const chargerMoteur = () => {
    if (moteurCharge || !ctx || typeof fetch !== "function") return;
    moteurCharge = true;
    const c = ctx;
    fetch(URL_MOTEUR)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => c.decodeAudioData(b))
      .then((buf) => { if (!fini) moteurBuf = buf; })
      .catch(() => { /* le moteur synthétisé reste */ });
  };
  /** crissement des pneus (bruit en boucle, passe-bande aigu) */
  let crissement: { src: AudioBufferSourceNode; gain: GainNode; filtre: BiquadFilterNode } | null = null;
  /** fins (horloge audio, s) des rugissements de tigres en cours */
  let voixTigres: number[] = [];
  /** vent de la chute libre (bruit en boucle, passe-bande) */
  let ventVoix: { src: AudioBufferSourceNode; gain: GainNode; filtre: BiquadFilterNode } | null = null;
  /** pulsation « hors zone » : tonalité grave modulée par un LFO, et grondement de bruit */
  let zoneVoix: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode; grondement: AudioBufferSourceNode } | null = null;

  /**
   * Échantillons (mode zombies) : par URL, les octets en vol (le téléchargement part dès `prechargerZombies`, avant même le contexte
   * audio), puis le son décodé et l'instant de son pic. Un échec (réseau, 404, format) est définitif et silencieux : le repli synthétisé
   * reste. Cache propre à cette instance (le navigateur garde les fichiers dans son cache HTTP d'une partie à l'autre).
   */
  interface Chargement { octets: Promise<ArrayBuffer> | null; buf: AudioBuffer | null; pic: number; echec: boolean; decodage: boolean }
  const chargements = new Map<string, Chargement>();
  const decoder = (c: Chargement) => {
    if (!ctx || fini || c.buf || c.echec || c.decodage || !c.octets) return;
    const cx = ctx;
    if (typeof cx.decodeAudioData !== "function") { c.echec = true; return; }
    c.decodage = true;
    c.octets
      .then((b) => cx.decodeAudioData(b))
      .then((buf) => {
        if (fini) return;
        c.buf = buf;
        c.pic = instantPic(buf.getChannelData(0), buf.sampleRate);
      })
      .catch(() => { c.echec = true; });
  };
  const telecharger = (url: string): Chargement => {
    let c = chargements.get(url);
    if (c) { decoder(c); return c; }
    c = { octets: null, buf: null, pic: 0, echec: false, decodage: false };
    chargements.set(url, c);
    if (typeof fetch !== "function") { c.echec = true; return c; }
    const ch = c;
    try {
      ch.octets = fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))));
      ch.octets.catch(() => { ch.echec = true; });
    } catch {
      ch.echec = true;
    }
    decoder(ch);
    return ch;
  };
  /** fins (horloge audio) des lectures en cours, par URL et toutes ensemble */
  const finsEchantillons = new Map<string, number[]>();
  let finsTous: number[] = [];
  /**
   * Lit le son de `url` : « absent » s'il n'est pas (encore) chargé, « plein » si ses voix (`voixMax`) ou toutes les voix
   * (`ECHANTILLONS_SIMULTANES_MAX`) sont prises, sinon l'instant (horloge audio) où il se tait.
   */
  const lire = (
    url: string, gain: number, voixMax: number, position?: PositionSon, o: { retard?: number; decalage?: number; vitesse?: number } = {},
  ): number | "absent" | "plein" => {
    const c = telecharger(url);
    if (!c.buf || !ctx || !master) return "absent";
    const maintenant = ctx.currentTime;
    const v1 = voixLibre(finsEchantillons.get(url) ?? [], maintenant, voixMax);
    const v2 = voixLibre(finsTous, maintenant, ECHANTILLONS_SIMULTANES_MAX);
    finsEchantillons.set(url, v1.fins);
    finsTous = v2.fins;
    if (!v1.libre || !v2.libre) return "plein";
    const vitesse = o.vitesse ?? 1;
    const decalage = Math.min(Math.max(0, o.decalage ?? 0), c.buf.duration);
    const t = maintenant + 0.001 + Math.max(0, o.retard ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = c.buf;
    if (vitesse !== 1) src.playbackRate?.setValueAtTime(vitesse, t);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(sortie(position));
    src.start(t, decalage);
    const fin = t + (c.buf.duration - decalage) / vitesse;
    v1.fins.push(fin);
    finsTous.push(fin);
    return fin;
  };
  const jouerEchantillon = (id: IdEchantillon, position?: PositionSon, o?: { retard?: number; decalage?: number; vitesse?: number }) => {
    const d = ECHANTILLONS[id];
    return lire(d.url, d.gain, d.voixMax, position, o);
  };
  /** Pic (s) du son `id` s'il est chargé. */
  const picDe = (id: IdEchantillon): number | null => {
    const c = chargements.get(ECHANTILLONS[id].url);
    return c?.buf ? c.pic : null;
  };
  /** File des annonces parlées échantillonnées (horloge audio). */
  const fileAnnonces = new FileAnnonces();

  /** Synthèse vocale du navigateur (repli) : voix française choisie une fois la liste arrivée, annonces en file (jamais `cancel`). */
  let voixNavigateur: SpeechSynthesisVoice | null | undefined;
  let attenteVoix = false;
  let parolesEnFile = 0;
  const choisirVoixNavigateur = (): SpeechSynthesisVoice | null | undefined => {
    const toutes = window.speechSynthesis.getVoices();
    if (!toutes.length) return undefined;
    const fr = toutes.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith("fr"));
    // une voix de France plutôt que du Canada ; une voix locale (hors ligne, sans délai) plutôt qu'une voix réseau
    return fr.find((v) => /^fr-fr/i.test(v.lang.replace("_", "-")) && v.localService) ?? fr.find((v) => /^fr-fr/i.test(v.lang.replace("_", "-"))) ?? fr[0] ?? null;
  };
  const parler = (texte: string) => {
    if (fini || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const ss = window.speechSynthesis;
    if (parolesEnFile > ANNONCES_EN_ATTENTE_MAX) return; // celle qui parle + 2 en attente au plus
    const dire = () => {
      if (fini) return;
      try {
        const u = new SpeechSynthesisUtterance(texte);
        u.lang = "fr-FR";
        u.pitch = 0.75;
        u.rate = 1.0;
        u.volume = 0.9;
        if (voixNavigateur) u.voice = voixNavigateur;
        parolesEnFile++;
        u.onend = u.onerror = () => { parolesEnFile = Math.max(0, parolesEnFile - 1); };
        ss.speak(u);
      } catch { /* synthèse indisponible : silence */ }
    };
    if (voixNavigateur === undefined) voixNavigateur = choisirVoixNavigateur();
    if (voixNavigateur !== undefined) { dire(); return; }
    // liste des voix pas encore arrivée (Chrome la remplit après coup) : on attend `voiceschanged`, 800 ms au plus
    if (attenteVoix) { setTimeout(dire, 850); return; }
    attenteVoix = true;
    let fait = false;
    const suite = () => {
      if (fait) return;
      fait = true;
      attenteVoix = false;
      try { ss.removeEventListener("voiceschanged", suite); } catch { /* ancien navigateur */ }
      voixNavigateur = choisirVoixNavigateur() ?? null;
      dire();
    };
    try { ss.addEventListener("voiceschanged", suite); } catch { /* ancien navigateur */ }
    setTimeout(suite, 800);
  };

  const ouvrir = () => {
    if (ctx || fini || typeof window === "undefined") return;
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
    } catch {
      return;
    }
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp);
    comp.connect(ctx.destination);
    // 2 s de bruit blanc partagé par tous les sons.
    const n = Math.floor(ctx.sampleRate * 2);
    bruitBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = bruitBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // les échantillons téléchargés avant le premier geste se décodent maintenant
    for (const c of chargements.values()) decoder(c);
  };

  /** Premier geste (clic, touche) : crée le contexte ou le sort de sa veille. */
  const reveiller = () => {
    ouvrir();
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
  };
  const GESTES = ["pointerdown", "keydown", "touchstart"] as const;
  if (typeof window !== "undefined") for (const g of GESTES) window.addEventListener(g, reveiller, { capture: true, passive: true });

  /** Vrai si le contexte tourne ; le crée si l'utilisateur a déjà interagi avec la page. */
  const prete = (): boolean => {
    if (fini) return false;
    if (!ctx && typeof navigator !== "undefined" && navigator.userActivation?.hasBeenActive) ouvrir();
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
    return !!ctx && ctx.state === "running" && !!master && !!bruitBuf;
  };

  /** Destination d'un son : directe, ou filtrée/atténuée/panoramiquée pour un tir lointain. */
  const sortie = (pos?: PositionSon): AudioNode => {
    const c = ctx!;
    if (!pos) return master!;
    const d = Math.max(pos.distance, 1);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.max(700, 14000 / (1 + d / 20));
    const g = c.createGain();
    g.gain.value = Math.max(0.04, 1 / (1 + d / 10));
    lp.connect(g);
    if (typeof c.createStereoPanner === "function") {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pos.pan));
      g.connect(p);
      p.connect(master!);
    } else g.connect(master!);
    return lp;
  };

  const enveloppe = (g: GainNode, t: number, gain: number, att: number, dur: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(gain, 0.0002), t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  };

  const bruit = (dest: AudioNode, t: number, o: OptionsBruit) => {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = bruitBuf;
    const f = c.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    f.Q.value = o.q ?? 0.7;
    const g = c.createGain();
    enveloppe(g, t, o.gain, o.att ?? 0.003, o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.9);
    src.stop(t + o.dur + 0.03);
  };

  const ton = (dest: AudioNode, t: number, o: OptionsTon) => {
    const c = ctx!;
    const osc = c.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = c.createGain();
    enveloppe(g, t, o.gain, o.att ?? 0.004, o.dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + o.dur + 0.03);
  };

  /** Petit clic mécanique (chargeur, culasse, cartouche). */
  const clic = (dest: AudioNode, t: number, f: number, gain: number) => {
    bruit(dest, t, { dur: 0.035, type: "bandpass", f0: f, q: 2.5, gain });
    ton(dest, t, { dur: 0.03, type: "triangle", f0: f * 0.45, f1: f * 0.25, gain: gain * 0.5 });
  };

  const briques: BriquesSon = { bruit, ton, clic };

  /** Coupe en douceur une boucle (frottement, moteur) puis libère ses nœuds. */
  const eteindre = (gain: GainNode, arrets: (AudioScheduledSourceNode)[], tau: number) => {
    if (!ctx) return;
    const c = ctx.currentTime;
    gain.gain.cancelScheduledValues(c);
    gain.gain.setTargetAtTime(0, c, tau);
    for (const a of arrets) {
      try { a.stop(c + tau * 6 + 0.05); } catch { /* déjà arrêté */ }
    }
  };

  const api: Sons = {
    tir(arme, position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const v = 0.92 + Math.random() * 0.16;
      PROFILS_TIR[arme](briques, out, t, v);
    },
    arc(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const v = 0.9 + Math.random() * 0.2;
      bruit(out, t, { dur: 0.09, type: "highpass", f0: 3000 * v, f1: 6500, gain: 0.45 });
      bruit(out, t + 0.02, { dur: 0.06, type: "bandpass", f0: 1400 * v, q: 1.2, gain: 0.3 });
    },
    recharge(arme) {
      if (!prete()) return;
      const t = ctx!.currentTime;
      for (const c of CLICS_RECHARGE[arme]) clic(master!, t + c.t, c.f, c.g);
    },
    touche(tete = false) {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      if (tete) {
        // Tir à la tête : le tic est plus aigu, plus sec, avec un petit « ting » de casque.
        ton(master!, t, { dur: 0.03, type: "square", f0: 3000, gain: 0.28 });
        ton(master!, t + 0.03, { dur: 0.05, type: "sine", f0: 4200, gain: 0.22 });
        ton(master!, t + 0.03, { dur: 0.18, type: "triangle", f0: 2100, f1: 1900, gain: 0.07 });
        return;
      }
      ton(master!, t, { dur: 0.03, type: "square", f0: 2400, gain: 0.25 });
      ton(master!, t + 0.035, { dur: 0.04, type: "sine", f0: 3200, gain: 0.2 });
    },
    kill() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      ton(master!, t, { dur: 0.55, type: "sine", f0: 988, gain: 0.35 });
      ton(master!, t + 0.07, { dur: 0.5, type: "sine", f0: 1480, gain: 0.25 });
      ton(master!, t + 0.07, { dur: 0.3, type: "triangle", f0: 2000, gain: 0.1 });
    },
    pas() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      const v = 0.85 + Math.random() * 0.3;
      bruit(master!, t, { dur: 0.07, type: "lowpass", f0: 380 * v, f1: 200, gain: 0.28 });
      ton(master!, t, { dur: 0.06, type: "sine", f0: 90 * v, f1: 60, gain: 0.25 });
    },
    mur(on) {
      if (!on) {
        if (!souffle || !ctx) return;
        const s = souffle;
        souffle = null;
        s.gain.gain.cancelScheduledValues(ctx.currentTime);
        s.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        s.src.stop(ctx.currentTime + 0.5);
        s.lfo.stop(ctx.currentTime + 0.5);
        return;
      }
      if (souffle || !prete()) return;
      const c = ctx!;
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = bruitBuf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 800;
      f.Q.value = 0.6;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.15);
      // Le souffle ondule : un LFO lent balaye le filtre.
      const lfo = c.createOscillator();
      lfo.frequency.value = 6.5;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 220;
      lfo.connect(lfoGain);
      lfoGain.connect(f.frequency);
      src.connect(f);
      f.connect(g);
      g.connect(master!);
      src.start(t, Math.random() * 0.9);
      lfo.start(t);
      souffle = { src, gain: g, lfo };
    },
    degat() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      ton(master!, t, { dur: 0.18, type: "sawtooth", f0: 140, f1: 50, gain: 0.45 });
      bruit(master!, t, { dur: 0.15, type: "lowpass", f0: 600, f1: 200, gain: 0.4 });
    },
    glisse(on) {
      if (!on) {
        if (!frottement) return;
        const f = frottement;
        frottement = null;
        eteindre(f.gain, [f.src], 0.07);
        return;
      }
      if (frottement || !prete()) return;
      const c = ctx!;
      const t = c.currentTime;
      // Frottement du tissu et des semelles sur le sol : bruit médium-grave dont le filtre redescend pendant la glissade.
      const src = c.createBufferSource();
      src.buffer = bruitBuf;
      src.loop = true;
      const filtre = c.createBiquadFilter();
      filtre.type = "bandpass";
      filtre.frequency.setValueAtTime(1100, t);
      filtre.frequency.exponentialRampToValueAtTime(420, t + 0.75);
      filtre.Q.value = 0.9;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.06);
      g.gain.linearRampToValueAtTime(0.1, t + 0.75);
      src.connect(filtre);
      filtre.connect(g);
      g.connect(master!);
      src.start(t, Math.random() * 0.9);
      frottement = { src, gain: g, filtre };
    },
    coup(touche, position, arme = "couteau") {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const v = 0.94 + Math.random() * 0.12;
      if (arme === "epee") {
        // Taille d'épée : sifflement long et grave, qui monte puis retombe, tintement métallique de la lame (triangle 900-2300 Hz).
        bruit(out, t, { dur: 0.36, type: "bandpass", f0: 700 * v, f1: 3200, q: 1.3, gain: 0.55, att: 0.12 });
        bruit(out, t + 0.14, { dur: 0.2, type: "highpass", f0: 5000, gain: 0.2, att: 0.06 });
        ton(out, t + 0.1, { dur: 0.45, type: "triangle", f0: 2300 * v, f1: 900, gain: 0.1 });
        if (touche) {
          // Choc plus lourd : coup sourd profond, claquement humide et tintement qui résonne.
          bruit(out, t + 0.18, { dur: 0.2, type: "lowpass", f0: 1600, f1: 160, gain: 1 });
          ton(out, t + 0.18, { dur: 0.24, type: "sine", f0: 120 * v, f1: 40, gain: 0.85 });
          bruit(out, t + 0.18, { dur: 0.04, type: "bandpass", f0: 2400, q: 1.2, gain: 0.4 });
          ton(out, t + 0.19, { dur: 0.5, type: "triangle", f0: 1500 * v, f1: 1100, gain: 0.08 });
        }
        return;
      }
      // Sifflement de la lame : bruit passe-bande qui monte puis retombe.
      bruit(out, t, { dur: 0.22, type: "bandpass", f0: 1200 * v, f1: 4200, q: 1.6, gain: 0.5, att: 0.06 });
      bruit(out, t + 0.1, { dur: 0.12, type: "highpass", f0: 5500, gain: 0.18, att: 0.04 });
      if (touche) {
        // Impact sur la chair : choc sourd et petit claquement humide.
        bruit(out, t + 0.12, { dur: 0.14, type: "lowpass", f0: 1400, f1: 220, gain: 0.9 });
        ton(out, t + 0.12, { dur: 0.16, type: "sine", f0: 150 * v, f1: 55, gain: 0.7 });
        bruit(out, t + 0.12, { dur: 0.03, type: "bandpass", f0: 2600, q: 1.2, gain: 0.35 });
      }
    },
    ramassage(genre) {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      if (genre === "soin") {
        // Carillon doux montant (do-mi-sol).
        [523, 659, 784].forEach((f, i) => ton(master!, t + i * 0.07, { dur: 0.45, type: "sine", f0: f, gain: 0.22 }));
        ton(master!, t + 0.14, { dur: 0.5, type: "triangle", f0: 1568, gain: 0.05 });
        return;
      }
      // Arme : carillon plus grave, cliquetis de culasse et petit éclat métallique.
      [330, 440, 554].forEach((f, i) => ton(master!, t + i * 0.08, { dur: 0.4, type: "triangle", f0: f, gain: 0.2 }));
      clic(master!, t + 0.05, 1500, 0.4);
      clic(master!, t + 0.2, 2100, 0.45);
      bruit(master!, t + 0.22, { dur: 0.15, type: "highpass", f0: 6000, gain: 0.15 });
    },
    regen() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      ton(master!, t, { dur: 0.09, type: "sine", f0: 880, f1: 990, gain: 0.07, att: 0.01 });
    },
    moteur(vitesse) {
      if (vitesse === null) {
        if (!moteurVoix) return;
        const m = moteurVoix;
        moteurVoix = null;
        eteindre(m.gain, [...m.oscs, m.grain], 0.12);
        return;
      }
      if (!moteurVoix && !prete()) return;
      const c = ctx;
      if (!c) return;
      chargerMoteur();
      const v = Math.min(Math.abs(vitesse), 40);
      const k = Math.min(v / VITESSE_REGIME_MAX, 1);
      // l'enregistrement arrivé pendant qu'on roulait sur le moteur synthétisé le remplace sans attendre la prochaine montée
      if (moteurVoix && !moteurVoix.echantillon && moteurBuf) {
        const m = moteurVoix;
        moteurVoix = null;
        eteindre(m.gain, [...m.oscs, m.grain], 0.15);
      }
      if (!moteurVoix) {
        const g = c.createGain();
        g.gain.value = 0.0001;
        const filtre = c.createBiquadFilter();
        filtre.type = "lowpass";
        filtre.Q.value = 0.7;
        filtre.connect(g);
        g.connect(master!);
        const grain = c.createBufferSource();
        grain.loop = true;
        const oscs: OscillatorNode[] = [];
        if (moteurBuf) {
          // vrai moteur : la boucle de ralenti, accélérée avec la vitesse
          grain.buffer = moteurBuf;
          grain.connect(filtre);
          grain.start(c.currentTime, Math.random() * moteurBuf.duration);
        } else {
          // repli doux : un triangle grave (plus de dent de scie ni de carré, trop agressifs) et un grain de bruit
          const o = c.createOscillator();
          o.type = "triangle";
          o.connect(filtre);
          o.start();
          oscs.push(o);
          grain.buffer = bruitBuf;
          const gf = c.createBiquadFilter();
          gf.type = "lowpass";
          gf.frequency.value = 220;
          const gg = c.createGain();
          gg.gain.value = 0.2;
          grain.connect(gf);
          gf.connect(gg);
          gg.connect(filtre);
          grain.start(c.currentTime, Math.random() * 0.9);
        }
        moteurVoix = { oscs, gain: g, filtre, grain, echantillon: !!moteurBuf };
      }
      const m = moteurVoix;
      const now = c.currentTime;
      if (m.echantillon) m.grain.playbackRate.setTargetAtTime(REGIME_RALENTI + (REGIME_MAX - REGIME_RALENTI) * k, now, 0.12);
      else m.oscs[0]?.frequency.setTargetAtTime(40 + v * 2.2, now, 0.08);
      m.filtre.frequency.setTargetAtTime(600 + 1800 * k, now, 0.1);
      m.gain.gain.setTargetAtTime(GAIN_MOTEUR_RALENTI + (GAIN_MOTEUR_MAX - GAIN_MOTEUR_RALENTI) * k, now, 0.15);
    },
    derapage(intensite) {
      const k = Number.isFinite(intensite) ? Math.min(Math.max(intensite, 0), 1) : 0;
      if (k <= 0) {
        if (!crissement) return;
        const cr = crissement;
        crissement = null;
        eteindre(cr.gain, [cr.src], 0.08);
        return;
      }
      if (!crissement && !prete()) return;
      const c = ctx;
      if (!c) return;
      if (!crissement) {
        const src = c.createBufferSource();
        src.buffer = bruitBuf;
        src.loop = true;
        const filtre = c.createBiquadFilter();
        filtre.type = "bandpass";
        filtre.Q.value = 6;
        const g = c.createGain();
        g.gain.value = 0.0001;
        src.connect(filtre);
        filtre.connect(g);
        g.connect(master!);
        src.start(c.currentTime, Math.random() * 0.9);
        crissement = { src, gain: g, filtre };
      }
      const now = c.currentTime;
      crissement.filtre.frequency.setTargetAtTime(1500 + k * 900, now, 0.05);
      crissement.gain.gain.setTargetAtTime(0.05 + k * 0.17, now, 0.05);
    },
    choc(force) {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      const k = Math.min(Math.max(force, 0), 1);
      bruit(master!, t, { dur: 0.12 + 0.2 * k, type: "lowpass", f0: 1500, f1: 160, gain: 0.3 + 0.35 * k });
      ton(master!, t, { dur: 0.15 + 0.2 * k, type: "sine", f0: 100, f1: 38, gain: 0.3 + 0.35 * k });
      // Tôle froissée : éclats métalliques proportionnels à la force.
      bruit(master!, t + 0.02, { dur: 0.1 + 0.1 * k, type: "bandpass", f0: 2200, f1: 1200, q: 1.2, gain: 0.08 + 0.2 * k });
    },
    zoom() {
      if (!prete()) return;
      clic(master!, ctx!.currentTime + 0.001, 2600, 0.18);
    },
    tole() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      const v = 0.9 + Math.random() * 0.2;
      // tintement de tôle : un « ping » métallique court et un petit choc
      ton(master!, t, { dur: 0.12, type: "triangle", f0: 1900 * v, f1: 1500 * v, gain: 0.09 });
      ton(master!, t, { dur: 0.08, type: "sine", f0: 3100 * v, gain: 0.05 });
      bruit(master!, t, { dur: 0.04, type: "bandpass", f0: 2800, q: 1.4, gain: 0.12 });
    },
    explosion(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      // Détonation sourde, souffle large bande, débris métalliques qui retombent et crépitement du feu.
      ton(out, t, { dur: 0.9, type: "sine", f0: 70, f1: 22, gain: 1 });
      bruit(out, t, { dur: 1.1, type: "lowpass", f0: 3200, f1: 120, gain: 1 });
      bruit(out, t + 0.02, { dur: 0.25, type: "bandpass", f0: 1400, f1: 500, q: 0.7, gain: 0.6 });
      for (let i = 0; i < 5; i++) {
        bruit(out, t + 0.35 + i * 0.13 + Math.random() * 0.08, { dur: 0.06, type: "bandpass", f0: 2500 + Math.random() * 1500, q: 2, gain: 0.18 });
      }
      bruit(out, t + 0.5, { dur: 1.4, type: "highpass", f0: 1800, f1: 3500, gain: 0.08, att: 0.2 });
    },
    klaxon() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      // Deux notes rapprochées (tierce), signal court.
      ton(master!, t, { dur: 0.32, type: "square", f0: 415, gain: 0.07, att: 0.01 });
      ton(master!, t, { dur: 0.32, type: "square", f0: 523, gain: 0.07, att: 0.01 });
    },
    rugissement(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const v = 0.9 + Math.random() * 0.2;
      // Grondement qui enfle puis retombe : dents de scie graves glissées, souffle rauque filtré, râle de gorge.
      ton(out, t, { dur: 1.1, type: "sawtooth", f0: 95 * v, f1: 62 * v, gain: 0.55, att: 0.18 });
      ton(out, t + 0.05, { dur: 0.95, type: "sawtooth", f0: 142 * v, f1: 80 * v, gain: 0.3, att: 0.2 });
      bruit(out, t, { dur: 1.1, type: "bandpass", f0: 520 * v, f1: 260, q: 1.4, gain: 0.55, att: 0.15 });
      bruit(out, t + 0.1, { dur: 0.7, type: "lowpass", f0: 900, f1: 180, gain: 0.35, att: 0.1 });
    },
    patte(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const v = 0.92 + Math.random() * 0.16;
      // Griffes qui fendent l'air, puis choc sourd et feulement bref.
      bruit(out, t, { dur: 0.16, type: "bandpass", f0: 1800 * v, f1: 3600, q: 1.3, gain: 0.45, att: 0.04 });
      bruit(out, t + 0.12, { dur: 0.16, type: "lowpass", f0: 1100, f1: 180, gain: 0.85 });
      ton(out, t + 0.12, { dur: 0.18, type: "sine", f0: 120 * v, f1: 48, gain: 0.7 });
      bruit(out, t + 0.05, { dur: 0.25, type: "bandpass", f0: 700 * v, f1: 420, q: 1.1, gain: 0.25, att: 0.03 });
    },
    plainte(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const v = 0.95 + Math.random() * 0.1;
      // Gémissement qui descend et s'éteint, souffle qui s'épuise.
      ton(out, t, { dur: 1.4, type: "sawtooth", f0: 210 * v, f1: 70, gain: 0.32, att: 0.08 });
      ton(out, t + 0.03, { dur: 1.2, type: "triangle", f0: 320 * v, f1: 110, gain: 0.18, att: 0.1 });
      bruit(out, t + 0.2, { dur: 1.3, type: "bandpass", f0: 600, f1: 200, q: 0.9, gain: 0.25, att: 0.2 });
    },
    avion(position) {
      if (position === null) {
        if (!avionVoix) return;
        const a = avionVoix;
        avionVoix = null;
        eteindre(a.gain, [...a.oscs, a.souffle], 0.25);
        return;
      }
      if (!avionVoix && !prete()) return;
      const c = ctx;
      if (!c) return;
      if (!avionVoix) {
        const g = c.createGain();
        g.gain.value = 0.0001;
        const filtre = c.createBiquadFilter();
        filtre.type = "lowpass";
        filtre.Q.value = 0.8;
        // deux hélices légèrement désaccordées : le battement donne le vrombissement d'un avion à moteurs
        const o1 = c.createOscillator();
        o1.type = "sawtooth";
        o1.frequency.value = 72;
        const o2 = c.createOscillator();
        o2.type = "sawtooth";
        o2.frequency.value = 75.5;
        const og = c.createGain();
        og.gain.value = 0.6;
        o1.connect(filtre);
        o2.connect(og);
        og.connect(filtre);
        const souffle = c.createBufferSource();
        souffle.buffer = bruitBuf;
        souffle.loop = true;
        const sf = c.createBiquadFilter();
        sf.type = "lowpass";
        sf.frequency.value = 500;
        const sg = c.createGain();
        sg.gain.value = 0.5;
        souffle.connect(sf);
        sf.connect(sg);
        sg.connect(filtre);
        filtre.connect(g);
        let pan: StereoPannerNode | null = null;
        if (typeof c.createStereoPanner === "function") {
          pan = c.createStereoPanner();
          g.connect(pan);
          pan.connect(master!);
        } else g.connect(master!);
        o1.start();
        o2.start();
        souffle.start(c.currentTime, Math.random() * 0.9);
        avionVoix = { oscs: [o1, o2], souffle, gain: g, filtre, pan };
      }
      const a = avionVoix;
      const now = c.currentTime;
      // l'avion vole à 120 m : on l'entend de loin, mais il reste un fond sous les tirs
      const d = Math.max(position.distance, 1);
      a.gain.gain.setTargetAtTime(Math.max(0.02, 0.3 / (1 + d / 120)), now, 0.15);
      a.filtre.frequency.setTargetAtTime(Math.max(260, 2400 / (1 + d / 90)), now, 0.15);
      a.pan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, position.pan)), now, 0.1);
    },
    alerte(genre) {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      if (genre === "truck") {
        // klaxon de camion qui s'emballe : quatre coups, de plus en plus aigus
        for (let i = 0; i < 4; i++) {
          ton(master!, t + i * 0.22, { dur: 0.18, type: "sawtooth", f0: 233 + i * 30, gain: 0.09, att: 0.01 });
          ton(master!, t + i * 0.22, { dur: 0.18, type: "sawtooth", f0: 294 + i * 38, gain: 0.08, att: 0.01 });
        }
        return;
      }
      // rugissement : grave qui monte puis retombe, grain de bruit, harmonique métallique
      ton(master!, t, { dur: 1.3, type: "sawtooth", f0: 70, f1: 45, gain: 0.35, att: 0.15 });
      ton(master!, t, { dur: 1.1, type: "square", f0: 140, f1: 95, gain: 0.08, att: 0.2 });
      bruit(master!, t, { dur: 1.2, type: "lowpass", f0: 900, f1: 200, q: 1.5, gain: 0.5, att: 0.2 });
      bruit(master!, t + 0.1, { dur: 0.9, type: "bandpass", f0: 2400, f1: 1300, q: 6, gain: 0.12, att: 0.1 });
    },
    laser(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      ton(out, t, { dur: 1.35, type: "sine", f0: 300, f1: 2200, gain: 0.18, att: 0.3 });
      ton(out, t, { dur: 1.35, type: "triangle", f0: 305, f1: 2230, gain: 0.08, att: 0.3 });
    },
    explosionMonstre(force, position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const k = Math.min(Math.max(force, 0), 1);
      bruit(out, t, { dur: 0.5 + 0.9 * k, type: "lowpass", f0: 2500, f1: 90, gain: 0.7 + 0.3 * k });
      ton(out, t, { dur: 0.6 + 0.8 * k, type: "sine", f0: 90, f1: 28, gain: 0.8 });
    },
    canon(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      bruit(out, t, { dur: 0.16, type: "lowpass", f0: 3200, f1: 300, gain: 0.55 });
      ton(out, t, { dur: 0.14, type: "square", f0: 160, f1: 70, gain: 0.22 });
    },
    klaxonCamion(position) {
      if (!prete()) return;
      const c = ctx!;
      const t = c.currentTime + 0.001;
      // atténuation douce (on l'entend à 300 m), aigus filtrés avec la distance, panoramique
      const d = position ? Math.max(position.distance, 1) : 1;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = Math.max(900, 5200 / (1 + d / 120));
      const g = c.createGain();
      g.gain.value = Math.max(0.12, 1 / (1 + d / 70));
      lp.connect(g);
      if (position && typeof c.createStereoPanner === "function") {
        const pn = c.createStereoPanner();
        pn.pan.value = Math.max(-1, Math.min(1, position.pan));
        g.connect(pn);
        pn.connect(master!);
      } else g.connect(master!);
      // trompe : accord grave et un peu désaccordé, attaque nette, tenue, petite chute de hauteur à la fin
      for (const [f, gain] of [[185, 0.16], [233, 0.14], [277, 0.11]] as const) {
        ton(lp, t, { dur: 0.95, type: "sawtooth", f0: f, f1: f * 0.97, gain, att: 0.03 });
        ton(lp, t, { dur: 0.95, type: "square", f0: f * 1.004, f1: f * 0.975, gain: gain * 0.35, att: 0.03 });
      }
    },
    klaxonMiniTruck(position, meche = false) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      // petite trompe électrique : carré + dent de scie désaccordés, nasillard (passe-bande), coups courts qui montent
      const coups = meche ? 4 : 2;
      const pas = meche ? 0.075 : 0.16;
      for (let i = 0; i < coups; i++) {
        const f = (meche ? 1180 : 880) * (1 + 0.12 * i);
        const ti = t + i * pas;
        ton(out, ti, { dur: pas * 0.8, type: "square", f0: f, f1: f * 1.02, gain: 0.12, att: 0.005 });
        ton(out, ti, { dur: pas * 0.8, type: "sawtooth", f0: f * 1.5 * 1.006, f1: f * 1.5, gain: 0.07, att: 0.005 });
        bruit(out, ti, { dur: pas * 0.5, type: "bandpass", f0: f * 2, q: 6, gain: 0.05 });
      }
    },
    effondrement(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      bruit(out, t, { dur: 1.6, type: "lowpass", f0: 1400, f1: 70, gain: 0.8, att: 0.05 });
      ton(out, t, { dur: 1.4, type: "sine", f0: 55, f1: 25, gain: 0.7, att: 0.05 });
      for (let i = 0; i < 4; i++) bruit(out, t + 0.1 + i * 0.18, { dur: 0.12, type: "bandpass", f0: 1800 - i * 250, q: 1.4, gain: 0.25 });
    },
    pasLourd(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      ton(out, t, { dur: 0.35, type: "sine", f0: 60, f1: 32, gain: 0.55 });
      bruit(out, t, { dur: 0.18, type: "lowpass", f0: 500, f1: 120, gain: 0.3 });
    },
    rugissementTigre(position, mort = false) {
      if (!prete()) return false;
      const t = ctx!.currentTime + 0.001;
      voixTigres = voixTigres.filter((fin) => fin > t);
      if (voixTigres.length >= VOIX_TIGRES_MAX) return false;
      const dur = mort ? 0.7 : 1.0;
      voixTigres.push(t + dur);
      const out = sortie(position);
      const v = 0.85 + Math.random() * 0.3;
      if (mort) {
        // cri étranglé qui s'effondre
        ton(out, t, { dur, type: "sawtooth", f0: 150 * v, f1: 38, gain: 0.3, att: 0.03 });
        bruit(out, t, { dur: 0.55, type: "lowpass", f0: 1400, f1: 160, q: 1.2, gain: 0.4, att: 0.02 });
        return true;
      }
      // rugissement : grave qui gronde (dent de scie + carré désaccordé), souffle filtré, harmonique rauque
      ton(out, t, { dur, type: "sawtooth", f0: 118 * v, f1: 62 * v, gain: 0.3, att: 0.08 });
      ton(out, t, { dur: dur * 0.9, type: "square", f0: 236 * v, f1: 130 * v, gain: 0.05, att: 0.1 });
      bruit(out, t, { dur: dur * 0.9, type: "lowpass", f0: 1100, f1: 240, q: 1.4, gain: 0.35, att: 0.1 });
      bruit(out, t + 0.05, { dur: dur * 0.7, type: "bandpass", f0: 760, f1: 420, q: 5, gain: 0.1, att: 0.1 });
      return true;
    },
    griffe(position, armeS) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      // le coup s'annonce : feulement grave pendant l'armement (le tigre se cabre), puis la patte fend l'air et claque à l'instant du contact
      // (`ZOMBIES.griffeArmeS`, le même que le serveur ; (v8) `armeS` : la morsure du petit, plus courte) : on l'entend venir
      const c = Math.max(0.14, armeS ?? ZOMBIES.griffeArmeS);
      ton(out, t, { dur: c * 0.85, type: "sawtooth", f0: 95, f1: 70, gain: 0.22, att: 0.12 });
      bruit(out, t, { dur: c * 0.85, type: "bandpass", f0: 420, f1: 300, q: 1.6, gain: 0.28, att: 0.15 });
      bruit(out, t + c - 0.13, { dur: 0.16, type: "bandpass", f0: 700, f1: 3000, q: 1.1, gain: 0.5, att: 0.1 });
      bruit(out, t + c, { dur: 0.14, type: "lowpass", f0: 1200, f1: 180, gain: 0.5 });
      ton(out, t + c, { dur: 0.18, type: "sine", f0: 110, f1: 45, gain: 0.45 });
    },
    achat(ok) {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      if (ok) {
        // caisse enregistreuse : clic mécanique, deux notes cristallines
        clic(master!, t, 1800, 0.35);
        ton(master!, t + 0.05, { dur: 0.35, type: "sine", f0: 1568, gain: 0.16 });
        ton(master!, t + 0.13, { dur: 0.5, type: "sine", f0: 2093, gain: 0.16 });
        ton(master!, t + 0.13, { dur: 0.4, type: "triangle", f0: 4186, gain: 0.03 });
        return;
      }
      // refus : deux buzz graves
      ton(master!, t, { dur: 0.12, type: "square", f0: 130, gain: 0.1, att: 0.01 });
      ton(master!, t + 0.15, { dur: 0.18, type: "square", f0: 98, gain: 0.1, att: 0.01 });
    },
    piece() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      ton(master!, t, { dur: 0.12, type: "sine", f0: 2349, gain: 0.06, att: 0.005 });
      ton(master!, t + 0.04, { dur: 0.16, type: "sine", f0: 3136, gain: 0.05, att: 0.005 });
    },
    manche() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      // coup de tambour grave, puis trois cuivres qui montent (sol-do-mi)
      ton(master!, t, { dur: 0.7, type: "sine", f0: 80, f1: 34, gain: 0.7 });
      bruit(master!, t, { dur: 0.35, type: "lowpass", f0: 900, f1: 90, gain: 0.5 });
      [196, 262, 330].forEach((f, i) => {
        ton(master!, t + 0.3 + i * 0.16, { dur: 0.6, type: "sawtooth", f0: f, gain: 0.08, att: 0.04 });
        ton(master!, t + 0.3 + i * 0.16, { dur: 0.6, type: "square", f0: f * 2, gain: 0.025, att: 0.04 });
      });
    },
    finManche() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      [330, 262, 196, 147].forEach((f, i) => {
        ton(master!, t + i * 0.22, { dur: 0.9, type: "sawtooth", f0: f, gain: 0.06, att: 0.05 });
        ton(master!, t + i * 0.22, { dur: 0.9, type: "sine", f0: f / 2, gain: 0.12, att: 0.05 });
      });
      ton(master!, t + 0.9, { dur: 1.6, type: "sine", f0: 65, f1: 50, gain: 0.5 });
    },
    mancheTruck() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      // sirène qui monte et redescend deux fois, puis un accord diminué
      for (let k = 0; k < 2; k++) ton(master!, t + k * 0.9, { dur: 0.85, type: "sawtooth", f0: 420, f1: 880, gain: 0.07, att: 0.05 });
      [155, 185, 220].forEach((f) => ton(master!, t + 1.9, { dur: 1.4, type: "sawtooth", f0: f, gain: 0.06, att: 0.08 }));
      ton(master!, t + 1.9, { dur: 1.2, type: "sine", f0: 70, f1: 40, gain: 0.6 });
    },
    planche(arrachee, position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      if (arrachee) {
        bruit(out, t, { dur: 0.25, type: "bandpass", f0: 900, f1: 300, q: 1.4, gain: 0.8 });
        bruit(out, t + 0.03, { dur: 0.12, type: "highpass", f0: 2500, gain: 0.35 });
        ton(out, t, { dur: 0.2, type: "triangle", f0: 180, f1: 70, gain: 0.3 });
      } else {
        for (let k = 0; k < 3; k++) {
          bruit(out, t + k * 0.12, { dur: 0.05, type: "bandpass", f0: 1400, q: 2, gain: 0.6 });
          ton(out, t + k * 0.12, { dur: 0.06, type: "sine", f0: 240, f1: 120, gain: 0.35 });
        }
      }
    },
    jingleAtout(atout) {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      const airs: Record<string, number[]> = {
        gratin: [196, 247, 294, 392], expresso: [523, 659, 784, 1047], ristretto: [330, 330, 415, 494], pausecafe: [392, 330, 392, 523], bento: [262, 330, 262, 440],
      };
      (airs[atout] ?? airs.gratin).forEach((f, i) => {
        ton(master!, t + i * 0.13, { dur: 0.22, type: "square", f0: f, gain: 0.05, att: 0.01 });
        ton(master!, t + i * 0.13, { dur: 0.22, type: "triangle", f0: f * 2, gain: 0.04, att: 0.01 });
      });
      // gorgée et « ahhh »
      bruit(master!, t + 0.7, { dur: 0.35, type: "lowpass", f0: 600, f1: 200, gain: 0.25 });
      ton(master!, t + 1.05, { dur: 0.45, type: "sine", f0: 220, f1: 160, gain: 0.12, att: 0.05 });
    },
    boite(genre, position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      if (genre === "tirage") {
        // boîte à musique : arpège cristallin qui ralentit
        const notes = [1047, 1319, 1568, 2093, 1568, 1319, 1175, 1568, 1976, 1568, 1319, 1047];
        let dt = 0;
        notes.forEach((f, i) => {
          ton(out, t + dt, { dur: 0.35, type: "sine", f0: f, gain: 0.08, att: 0.003 });
          ton(out, t + dt, { dur: 0.2, type: "triangle", f0: f * 2, gain: 0.02, att: 0.003 });
          dt += 0.18 + i * 0.022;
        });
      } else {
        // rire de la peluche : « ha ha ha » nasal qui descend
        for (let k = 0; k < 5; k++) {
          ton(out, t + k * 0.17, { dur: 0.12, type: "sawtooth", f0: 330 - k * 25, f1: 260 - k * 25, gain: 0.08, att: 0.01 });
          bruit(out, t + k * 0.17, { dur: 0.1, type: "bandpass", f0: 1100, q: 3, gain: 0.12 });
        }
      }
    },
    bonus(ramasse, position) {
      // ramassé : la fanfare (échantillon, repli synthétisé) ; qui tombe : scintillement
      if (ramasse) { api.fanfareBonus(position); return; }
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      for (let k = 0; k < 6; k++) ton(out, t + k * 0.06, { dur: 0.12, type: "sine", f0: 1800 + k * 250, gain: 0.04, att: 0.005 });
    },
    courant() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      bruit(master!, t, { dur: 0.15, type: "lowpass", f0: 1200, f1: 200, gain: 0.9 });
      ton(master!, t, { dur: 0.2, type: "square", f0: 90, f1: 60, gain: 0.25 });
      ton(master!, t + 0.25, { dur: 2.2, type: "sawtooth", f0: 50, f1: 120, gain: 0.08, att: 0.3 });
      ton(master!, t + 0.25, { dur: 2.2, type: "sine", f0: 100, f1: 240, gain: 0.06, att: 0.3 });
    },
    microondes(pret, position) {
      if (pret) api.microOndesBip(position);
      else api.microOndesCuisson(position);
    },
    microOndesCuisson(position) {
      if (!prete() || jouerEchantillon("microOndesCuisson", position) !== "absent") return;
      // repli : la porte claque (choc sourd), puis le magnétron bourdonne et le ventilateur souffle
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      bruit(out, t, { dur: 0.12, type: "lowpass", f0: 1100, f1: 200, gain: 0.7 });
      ton(out, t, { dur: 0.12, type: "sine", f0: 90, f1: 60, gain: 0.5 });
      ton(out, t + 0.12, { dur: 3.3, type: "sawtooth", f0: 120, f1: 121, gain: 0.04, att: 0.25 });
      ton(out, t + 0.12, { dur: 3.3, type: "sine", f0: 240, gain: 0.05, att: 0.25 });
      bruit(out, t + 0.12, { dur: 1.9, type: "bandpass", f0: 700, q: 0.5, gain: 0.06, att: 0.4 });
    },
    microOndesBip(position) {
      if (!prete() || jouerEchantillon("microOndesBip", position) !== "absent") return;
      // repli : les trois bips piézo à 1 kHz d'un vrai micro-ondes
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      for (let k = 0; k < 3; k++) {
        ton(out, t + k * 0.3, { dur: 0.17, type: "square", f0: 1000, gain: 0.05, att: 0.004 });
        ton(out, t + k * 0.3, { dur: 0.17, type: "sine", f0: 1000, gain: 0.08, att: 0.004 });
      }
    },
    ouverturePorte(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      // clac du verrou, puis la porte glisse vers le haut (frottement filtré qui monte), quelques éclats de bois et un choc sourd
      bruit(out, t, { dur: 0.06, type: "bandpass", f0: 2200, q: 3, gain: 0.5 });
      ton(out, t, { dur: 0.08, type: "square", f0: 160, f1: 90, gain: 0.18 });
      bruit(out, t + 0.08, { dur: 0.9, type: "bandpass", f0: 400, f1: 1300, q: 1.2, gain: 0.32, att: 0.1 });
      ton(out, t + 0.08, { dur: 0.9, type: "sawtooth", f0: 70, f1: 110, gain: 0.05, att: 0.15 });
      for (let k = 0; k < 3; k++) bruit(out, t + 0.35 + k * 0.17, { dur: 0.07, type: "bandpass", f0: 1100 - k * 150, q: 2, gain: 0.3 });
      ton(out, t + 0.9, { dur: 0.25, type: "sine", f0: 85, f1: 45, gain: 0.35 });
      bruit(out, t + 0.9, { dur: 0.5, type: "lowpass", f0: 700, f1: 200, gain: 0.25 });
    },
    annonce(texte) {
      if (fini || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      // petit jingle (deux notes montantes), puis la voix du navigateur
      if (prete()) {
        const t = ctx!.currentTime + 0.001;
        ton(master!, t, { dur: 0.16, type: "triangle", f0: 659, gain: 0.08, att: 0.005 });
        ton(master!, t + 0.12, { dur: 0.28, type: "triangle", f0: 988, gain: 0.08, att: 0.005 });
      }
      setTimeout(() => parler(texte), 280);
    },
    prechargerZombies() {
      if (fini) return;
      // le contexte existe déjà si l'utilisateur a cliqué (lobby) : le décodage suit le téléchargement ; sinon `ouvrir` s'en chargera
      prete();
      for (const url of URLS_ZOMBIES) telecharger(url);
    },
    echantillon(id, position, retardS = 0) {
      if (!prete()) return true; // pas de contexte : silence, rien à remplacer
      return jouerEchantillon(id, position, { retard: retardS }) !== "absent";
    },
    voix(id, auPlusTotS = 0) {
      if (fini) return;
      const d = VOIX_ANNONCES[id];
      const c = telecharger(d.url);
      // fichier absent ou pas encore décodé, ou pas de contexte audio : la voix du navigateur prend le relais
      if (!c.buf || !prete()) { api.annonce(d.texte); return; }
      const maintenant = ctx!.currentTime;
      const debut = fileAnnonces.planifier(maintenant, c.buf.duration, maintenant + Math.max(0, auPlusTotS));
      if (debut === null) return; // file pleine : l'annonce est abandonnée plutôt que d'en couper une
      // l'annonceur passe au-dessus de tout (gain fort, non spatialisé), hors limite de voix des effets
      const src = ctx!.createBufferSource();
      src.buffer = c.buf;
      const g = ctx!.createGain();
      g.gain.value = 1.1;
      src.connect(g);
      g.connect(master!);
      src.start(debut);
    },
    tonnerre(position) {
      if (!prete() || jouerEchantillon("tonnerre", position) !== "absent") return;
      // repli : craquement sec puis grondement qui roule
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      bruit(out, t, { dur: 0.25, type: "highpass", f0: 1500, f1: 500, gain: 0.7 });
      bruit(out, t + 0.05, { dur: 3.5, type: "lowpass", f0: 700, f1: 60, gain: 0.9, att: 0.15 });
      ton(out, t + 0.05, { dur: 3, type: "sine", f0: 45, f1: 28, gain: 0.5, att: 0.3 });
    },
    rireTruck(position, retardS = 0) {
      if (!prete() || jouerEchantillon("rireTruck", position, { retard: retardS }) !== "absent") return;
      // repli : « HA HA HA » grave et nasal qui descend
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001 + Math.max(0, retardS);
      for (let k = 0; k < 6; k++) {
        ton(out, t + k * 0.2, { dur: 0.15, type: "sawtooth", f0: 180 - k * 12, f1: 140 - k * 12, gain: 0.12, att: 0.01 });
        bruit(out, t + k * 0.2, { dur: 0.12, type: "bandpass", f0: 800, q: 3, gain: 0.15 });
      }
    },
    explosionGrenade(position, force = 1) {
      if (!prete()) return;
      const k = Math.min(Math.max(force, 0), 1);
      const d = ECHANTILLONS.explosionGrenade;
      if (lire(d.url, d.gain * (0.55 + 0.45 * k), d.voixMax, position, { vitesse: 1.08 - 0.12 * k }) !== "absent") return;
      api.explosionMonstre(0.4 + 0.5 * k, position);
    },
    rebondGrenade(position, force = 1) {
      if (!prete()) return;
      const k = Math.min(Math.max(force, 0), 1);
      const d = ECHANTILLONS.rebondGrenade;
      if (lire(d.url, d.gain * (0.35 + 0.65 * k), d.voixMax, position, { vitesse: 0.9 + Math.random() * 0.2 }) !== "absent") return;
      // repli : « tonk » métallique bref
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      ton(out, t, { dur: 0.1, type: "triangle", f0: 1300, f1: 900, gain: 0.08 * (0.4 + k) });
      bruit(out, t, { dur: 0.05, type: "bandpass", f0: 2200, q: 1.5, gain: 0.15 * (0.4 + k) });
    },
    griffeChef(position) {
      if (!prete()) return;
      const pic = picDe("griffeChef");
      if (pic !== null) {
        // le pic du fichier tombe au contact du serveur (même calage que le claquement synthétisé de `griffe`)
        const { retard, decalage } = departCale(pic, ZOMBIES.griffeArmeS);
        // (v8, retour 16) toutes ses voix prises (plusieurs chefs aux planches) : la griffe synthétisée, jamais un coup muet
        const r = jouerEchantillon("griffeChef", position, { retard, decalage });
        if (r !== "absent" && r !== "plein") return;
      } else telecharger(ECHANTILLONS.griffeChef.url);
      api.griffe(position);
    },
    grognementChef(position) {
      if (!prete()) return false;
      const t = ctx!.currentTime + 0.001;
      voixTigres = voixTigres.filter((fin) => fin > t);
      if (voixTigres.length >= VOIX_TIGRES_MAX) return false;
      const r = jouerEchantillon("grognementChef", position, { vitesse: 0.92 + Math.random() * 0.16 });
      if (r === "absent") return api.rugissementTigre(position);
      if (r === "plein") return false;
      voixTigres.push(r);
      return true;
    },
    fanfareBonus(position) {
      if (!prete() || jouerEchantillon("fanfareBonus", position) !== "absent") return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      [523, 784, 1047, 1568].forEach((f, i) => ton(out, t + i * 0.05, { dur: 0.5, type: "triangle", f0: f, gain: 0.08, att: 0.01 }));
    },
    klaxonBus(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      for (const offset of [0, 0.2]) {
        ton(out, t + offset, { dur: 0.16, type: "sawtooth", f0: 310, f1: 305, gain: 0.4, att: 0.02 });
        ton(out, t + offset, { dur: 0.16, type: "square", f0: 392, f1: 385, gain: 0.25, att: 0.02 });
      }
    },
    sireneFrappe(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      ton(out, t, { dur: 1.6, type: "sawtooth", f0: 440, f1: 880, gain: 0.35, att: 0.1 });
      ton(out, t + 1.6, { dur: 1.6, type: "sawtooth", f0: 880, f1: 440, gain: 0.35, att: 0.1 });
    },
    fumigene(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      ton(out, t, { dur: 0.12, type: "sine", f0: 280, f1: 90, gain: 0.5 });
      bruit(out, t + 0.05, { dur: 1.5, type: "highpass", f0: 2400, f1: 1800, gain: 0.45, att: 0.08 });
    },
    ventChute(vitesse) {
      const k = vitesse === null ? 0 : intensiteVentChute(vitesse);
      if (k <= 0) {
        if (!ventVoix) return;
        const v = ventVoix;
        ventVoix = null;
        eteindre(v.gain, [v.src], 0.2);
        return;
      }
      if (!ventVoix && !prete()) return;
      const c = ctx;
      if (!c) return;
      if (!ventVoix) {
        const src = c.createBufferSource();
        src.buffer = bruitBuf;
        src.loop = true;
        const filtre = c.createBiquadFilter();
        filtre.type = "bandpass";
        filtre.Q.value = 0.5;
        const g = c.createGain();
        g.gain.value = 0.0001;
        src.connect(filtre);
        filtre.connect(g);
        g.connect(master!);
        src.start(c.currentTime, Math.random() * 0.9);
        ventVoix = { src, gain: g, filtre };
      }
      const now = c.currentTime;
      const r = reglageVentChute(k);
      ventVoix.filtre.frequency.setTargetAtTime(r.filtre, now, 0.15);
      ventVoix.gain.gain.setTargetAtTime(r.gain, now, 0.12);
    },
    voile() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      // la toile claque en se gonflant (choc sourd + éclat de tissu), puis le souffle du vent retombe
      ton(master!, t, { dur: 0.35, type: "sine", f0: 120, f1: 38, gain: 0.8 });
      bruit(master!, t, { dur: 0.12, type: "bandpass", f0: 1800, f1: 700, q: 0.9, gain: 0.9 });
      bruit(master!, t + 0.05, { dur: 0.9, type: "lowpass", f0: 2200, f1: 260, gain: 0.5, att: 0.05 });
    },
    avertissementZone(horsZone) {
      if (!horsZone) {
        if (!zoneVoix || !ctx) return;
        const z = zoneVoix;
        zoneVoix = null;
        eteindre(z.gain, [z.osc, z.lfo, z.grondement], 0.1);
        return;
      }
      if (zoneVoix || !prete()) return;
      const c = ctx!;
      const t = c.currentTime;
      // tonalité grave d'alarme qui bat 2,4 fois par seconde, sur un grondement de tempête
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.1, t + 0.2);
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 96;
      const lfo = c.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 2.4;
      const profondeur = c.createGain();
      profondeur.gain.value = 0.09;
      lfo.connect(profondeur);
      profondeur.connect(g.gain);
      const filtre = c.createBiquadFilter();
      filtre.type = "lowpass";
      filtre.frequency.value = 520;
      osc.connect(filtre);
      const grondement = c.createBufferSource();
      grondement.buffer = bruitBuf;
      grondement.loop = true;
      const bas = c.createBiquadFilter();
      bas.type = "lowpass";
      bas.frequency.value = 180;
      grondement.connect(bas);
      filtre.connect(g);
      bas.connect(g);
      g.connect(master!);
      osc.start(t);
      lfo.start(t);
      grondement.start(t, Math.random() * 0.9);
      zoneVoix = { osc, lfo, gain: g, grondement };
    },
    zoneSeResserre() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      bruit(master!, t, { dur: 2.4, type: "lowpass", f0: 90, f1: 260, gain: 0.8, att: 0.9 });
      ton(master!, t, { dur: 2.2, type: "sine", f0: 48, f1: 92, gain: 0.7, att: 0.8 });
      ton(master!, t + 1.4, { dur: 0.7, type: "sawtooth", f0: 330, f1: 300, gain: 0.18, att: 0.05 });
      ton(master!, t + 1.4, { dur: 0.7, type: "square", f0: 415, f1: 390, gain: 0.1, att: 0.05 });
    },
    usageSoin(objet, etape) {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      if (etape === "debut") {
        if (objet === "bandage") {
          // sparadrap arraché : frottement rêche qui s'arrête net
          bruit(master!, t, { dur: 0.28, type: "highpass", f0: 2600, f1: 5200, gain: 0.5, att: 0.02 });
          bruit(master!, t + 0.02, { dur: 0.22, type: "bandpass", f0: 1500, q: 1.4, gain: 0.25 });
        } else {
          // bouchon qui saute, puis deux gorgées
          ton(master!, t, { dur: 0.07, type: "sine", f0: 520, f1: 260, gain: 0.45 });
          bruit(master!, t, { dur: 0.04, type: "bandpass", f0: 2200, q: 2, gain: 0.3 });
          for (const d of [0.3, 0.62]) ton(master!, t + d, { dur: 0.16, type: "sine", f0: 300, f1: 520, gain: 0.16, att: 0.02 });
        }
        return;
      }
      if (objet === "bandage") {
        [523, 659].forEach((f, i) => ton(master!, t + i * 0.08, { dur: 0.4, type: "sine", f0: f, gain: 0.2 }));
        return;
      }
      [659, 880, 1175].forEach((f, i) => ton(master!, t + i * 0.06, { dur: 0.55, type: "sine", f0: f, gain: 0.17 }));
      ton(master!, t + 0.1, { dur: 0.6, type: "triangle", f0: 2349, gain: 0.05 });
    },
    grenadeLancer(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      // cuillère qui saute (tintement), puis souffle du bras
      ton(out, t, { dur: 0.05, type: "triangle", f0: 2900, f1: 2300, gain: 0.18 });
      ton(out, t + 0.04, { dur: 0.04, type: "triangle", f0: 3400, f1: 3100, gain: 0.1 });
      bruit(out, t + 0.06, { dur: 0.22, type: "bandpass", f0: 700, f1: 1600, q: 0.8, gain: 0.32, att: 0.05 });
    },
    grenadeRebond(force, position) {
      if (!prete()) return;
      const g = Math.max(0.05, Math.min(1, force / 12));
      // échantillon du lot audio (Kenney, CC0) d'abord, synthèse en repli
      const d = ECHANTILLONS.rebondGrenade;
      if (lire(d.url, d.gain * (0.35 + 0.65 * g), d.voixMax, position, { vitesse: 0.9 + Math.random() * 0.2 }) !== "absent") return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      // métal sur le carrelage : clac bref et tintement creux
      bruit(out, t, { dur: 0.03, type: "bandpass", f0: 2600, q: 2.5, gain: 0.45 * g });
      ton(out, t, { dur: 0.09, type: "square", f0: 620 + 180 * g, f1: 520, gain: 0.06 * g });
    },
    grenadeExplosion(position) {
      if (!prete()) return;
      // échantillon du lot audio (Kenney, CC0) à pleine force d'abord, synthèse en repli
      const d = ECHANTILLONS.explosionGrenade;
      if (lire(d.url, d.gain, d.voixMax, position, { vitesse: 0.96 }) !== "absent") return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      // plus sèche qu'une voiture : claquement, grave court, souffle, éclats
      bruit(out, t, { dur: 0.05, type: "highpass", f0: 3200, gain: 0.9 });
      ton(out, t, { dur: 0.55, type: "sine", f0: 110, f1: 30, gain: 1 });
      bruit(out, t, { dur: 0.75, type: "lowpass", f0: 4200, f1: 160, gain: 1 });
      for (let i = 0; i < 6; i++) {
        bruit(out, t + 0.12 + i * 0.07 + Math.random() * 0.05, { dur: 0.04, type: "bandpass", f0: 3000 + Math.random() * 2500, q: 3, gain: 0.12 });
      }
      bruit(out, t + 0.25, { dur: 0.9, type: "lowpass", f0: 700, f1: 150, gain: 0.25 }); // écho dans les bureaux
    },
    grenadeBip() {
      if (!prete()) return;
      const out = sortie();
      const t = ctx!.currentTime + 0.001;
      ton(out, t, { dur: 0.03, type: "square", f0: 1900, gain: 0.05 });
    },
    remontoir(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      // cymbales (bruit aigu qui s'éteint) et cliquetis du ressort
      bruit(out, t, { dur: 0.35, type: "highpass", f0: 5200, f1: 7000, gain: 0.28 });
      bruit(out, t, { dur: 0.12, type: "bandpass", f0: 3800, q: 1.5, gain: 0.2 });
      for (let i = 0; i < 3; i++) ton(out, t + 0.05 + i * 0.045, { dur: 0.02, type: "square", f0: 2400, gain: 0.03 });
    },
    secret(son, position, k = 0) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      /** cloche : fondamentale et partiels inharmoniques d'une cloche de bronze, longue décroissance */
      const cloche = (t0: number, f: number, gain: number, dur: number) => {
        for (const [r, g] of [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.9, 0.1]] as const) ton(out, t0, { dur: dur / Math.sqrt(r), type: "sine", f0: f * r, gain: gain * g, att: 0.003 });
      };
      switch (son) {
        case "tic":
          // le mécanisme repart : tic, tac, et le ressort qui se détend
          clic(out, t, 3200, 0.12); clic(out, t + 0.5, 2500, 0.1); clic(out, t + 1, 3200, 0.08);
          bruit(out, t, { dur: 0.25, type: "bandpass", f0: 1800, f1: 900, q: 4, gain: 0.05 });
          break;
        case "carillon":
          // quatre notes de pendule (mi, do, ré, sol), puis le silence
          [659, 523, 587, 392].forEach((f, i) => cloche(t + i * 0.55, f, 0.07, 2.4));
          break;
        case "coupMidi": cloche(t, 196, 0.11, 3.2); break;
        case "ding": cloche(t, 880 * 2 ** (k * 1.2), 0.07, 1.4); break;
        case "clang":
          // la batterie entière qui s'entrechoque, faux et métallique
          for (const f of [613, 702, 931, 1187]) ton(out, t + Math.random() * 0.06, { dur: 0.7, type: "triangle", f0: f, gain: 0.04 });
          bruit(out, t, { dur: 0.3, type: "bandpass", f0: 2600, q: 1.2, gain: 0.25 });
          break;
        case "bouillon":
          for (let i = 0; i < 5; i++) {
            const d = 0.07 + Math.random() * 0.25;
            ton(out, t + d * i, { dur: 0.09, type: "sine", f0: 180 + Math.random() * 120, f1: 420 + Math.random() * 200, gain: 0.07 });
            bruit(out, t + d * i, { dur: 0.06, type: "lowpass", f0: 700, gain: 0.08 });
          }
          break;
        case "accord":
          // un accord discret, comme un souvenir qui revient (septième majeure, très doux)
          [262, 330, 392, 494, 523].forEach((f, i) => {
            ton(out, t + i * 0.09, { dur: 2.6, type: "sine", f0: f, gain: 0.035, att: 0.25 });
            ton(out, t + i * 0.09, { dur: 2.2, type: "triangle", f0: f * 2, gain: 0.008, att: 0.3 });
          });
          break;
        case "souffleFroid":
          bruit(out, t, { dur: 0.12, type: "lowpass", f0: 900, f1: 200, gain: 0.5 });
          bruit(out, t, { dur: 2.2, type: "highpass", f0: 3500, f1: 6000, gain: 0.18, att: 0.05 });
          ton(out, t, { dur: 0.3, type: "square", f0: 70, f1: 45, gain: 0.12 });
          break;
        case "givre": for (let i = 0; i < 4; i++) clic(out, t + Math.random() * 0.2, 4200 + Math.random() * 2500, 0.05); break;
        case "fonte":
          bruit(out, t, { dur: 1.4, type: "highpass", f0: 5000, f1: 1500, gain: 0.16 });
          for (let i = 0; i < 3; i++) ton(out, t + 0.5 + i * 0.3, { dur: 0.08, type: "sine", f0: 1200, f1: 500, gain: 0.05 });
          bruit(out, t + 1.2, { dur: 0.08, type: "lowpass", f0: 600, gain: 0.5 });
          break;
        case "flamme":
          bruit(out, t, { dur: 1.2, type: "lowpass", f0: 200, f1: 1800, gain: 0.35, att: 0.25 });
          bruit(out, t + 0.2, { dur: 1.6, type: "bandpass", f0: 400, q: 0.8, gain: 0.15, att: 0.3 });
          break;
        case "bip": ton(out, t, { dur: 0.09, type: "square", f0: 1320 + k * 400, gain: 0.04 }); break;
        case "buzz":
          ton(out, t, { dur: 0.45, type: "sawtooth", f0: 110, gain: 0.07 });
          ton(out, t, { dur: 0.45, type: "square", f0: 117, gain: 0.04 });
          break;
        case "hachoir":
          bruit(out, t, { dur: 0.08, type: "lowpass", f0: 900, gain: 0.6 });
          ton(out, t, { dur: 0.12, type: "sine", f0: 140, f1: 70, gain: 0.25 });
          ton(out, t + 0.02, { dur: 0.6, type: "triangle", f0: 2100 + k * 600, gain: 0.025 });
          break;
        case "choeur": {
          // une nappe qui monte comme un chœur lointain (scies désaccordées, passe-bas qui s'ouvre), puis la cloche
          const c = ctx!;
          const f = c.createBiquadFilter();
          f.type = "lowpass";
          f.frequency.setValueAtTime(300, t);
          f.frequency.exponentialRampToValueAtTime(2400, t + 3);
          f.connect(out);
          for (const n of [131, 165, 196, 262, 330]) for (const d of [-4, 4]) ton(f, t, { dur: 5, type: "sawtooth", f0: n * 2 ** (d / 1200), gain: 0.012, att: 1.8 });
          cloche(t + 3.2, 523, 0.06, 3);
          break;
        }
        case "cloche":
          // la cloche de service du comptoir : ding clair
          for (const [r, g] of [[1, 1], [2.4, 0.4], [4.1, 0.2]] as const) ton(out, t, { dur: 1.6 / r, type: "sine", f0: 2350 * r, gain: 0.07 * g, att: 0.002 });
          break;
      }
    },
    dispose() {
      fini = true;
      fileAnnonces.vider();
      chargements.clear();
      if (typeof window !== "undefined" && "speechSynthesis" in window) { try { window.speechSynthesis.cancel(); } catch { /* rien */ } }
      if (typeof window !== "undefined") for (const g of GESTES) window.removeEventListener(g, reveiller, { capture: true });
      if (frottement) {
        try { frottement.src.stop(); } catch { /* déjà arrêté */ }
        frottement = null;
      }
      if (moteurVoix) {
        for (const o of [...moteurVoix.oscs, moteurVoix.grain]) {
          try { o.stop(); } catch { /* déjà arrêté */ }
        }
        moteurVoix = null;
      }
      if (avionVoix) {
        for (const o of [...avionVoix.oscs, avionVoix.souffle]) {
          try { o.stop(); } catch { /* déjà arrêté */ }
        }
        avionVoix = null;
      }
      if (crissement) {
        try { crissement.src.stop(); } catch { /* déjà arrêté */ }
        crissement = null;
      }
      if (ventVoix) {
        try { ventVoix.src.stop(); } catch { /* déjà arrêté */ }
        ventVoix = null;
      }
      if (zoneVoix) {
        for (const o of [zoneVoix.osc, zoneVoix.lfo, zoneVoix.grondement]) {
          try { o.stop(); } catch { /* déjà arrêté */ }
        }
        zoneVoix = null;
      }
      if (souffle) {
        try { souffle.src.stop(); souffle.lfo.stop(); } catch { /* déjà arrêtés */ }
        souffle = null;
      }
      if (ctx) void ctx.close().catch(() => {});
      ctx = null;
      master = null;
      bruitBuf = null;
    },
  };
  return api;
}
