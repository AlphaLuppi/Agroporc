/**
 * Armes de l'arène FPS (PUR : ni three ni DOM, aucun `Math.random` ni `alea`).
 *
 * Registre extensible : UN SEUL endroit décrit une arme, `STATS[id]` (stats, catégorie, nom, description).
 * Ajouter une arme = son id dans la bonne liste de `protocole.ts`, une entrée `STATS`, puis les `Record<ArmeFeuId, …>`
 * de `rendu.ts`, `sons.ts` et `traceurs.ts` (qui cassent la compilation si on oublie : voulu).
 *
 * AUCUNE DISPERSION (v2 §13.1) : « ce qui est sous le réticule est touché ». Toutes les armes tirent exactement dans
 * l'axe de la vue, quels que soient le mouvement, le saut, le wall-run, l'accroupi ou la visée. Le fusil à pompe (et
 * toute arme à plusieurs plombs) tire une gerbe FIXE et déterministe : un plomb au centre et les autres sur un cercle
 * de demi-angle constant (`gerbe`). Le recul de la vue reste (il ne déplace que les tirs suivants).
 * SEULE EXCEPTION (v3 §1) : une arme à lunette (`hanche`, le sniper) tirée SANS lunette part dans un cône aléatoire
 * (`dispersionTir` + `devier`, hasard fourni par l'appelant) ; en lunette elle tire pile sous le réticule. Niveaux de zoom de
 * la lunette : `zooms`.
 * Partagé client (tir) et serveur (validation).
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§4 et §13.1), 2026-10-23-arene-v3-design.md (§1)
 */
import { estMelee, type ArmeFeuId, type ArmeId, type ArmeMeleeId, type Vec3, type Zone } from "./protocole";

export type CategorieArme = "principale" | "secondaire" | "speciale" | "unique";

export interface Arme {
  id: ArmeFeuId;
  nom: string;
  /** libellé court pour le HUD (≤ 10 caractères) */
  nomCourt: string;
  categorie: CategorieArme;
  /** une phrase pour le lobby */
  description: string;
  /** dégâts d'un plomb au corps, à courte distance */
  degats: number;
  multTete: number;
  plombs: number;
  /**
   * Demi-angle (rad) de la gerbe FIXE des armes à plusieurs plombs : un plomb au centre, les `plombs − 1` autres répartis
   * régulièrement sur un cercle de ce demi-angle. 0 pour une arme à un seul plomb.
   */
  gerbe: number;
  /** délai minimal entre deux tirs (s) */
  cadenceS: number;
  /** maintenir la détente enchaîne les tirs */
  auto: boolean;
  /** chargeur ; pour une arme `sansRecharge` : munitions TOTALES offertes */
  chargeur: number;
  rechargeS: number;
  /** pas de rechargement : l'arme disparaît à 0 munition (armes spéciales) */
  sansRecharge: boolean;
  /**
   * INERTE depuis la v2 §13.1 (aucune dispersion) : valeurs historiques de départ, conservées pour mémoire et pour la
   * chaleur (`apresTir` / `refroidir`), qui n'influe plus sur la direction du tir.
   */
  dispersion: { base: number; mouvement: number; air: number; parTir: number; max: number; retourS: number; viseur?: number };
  /** rad par tir */
  recul: { tangage: number; lacet: number };
  portee: number;
  /** multiplicateur linéaire de `debut` à `fin` (m), plancher `min` au-delà */
  chute: { debut: number; fin: number; min: number };
  /** multiplicateur de déplacement */
  vitesse: number;
  /** champ de vision horizontal (°) en visée au niveau de zoom par défaut ; null = pas de lunette */
  zoom: number | null;
  /** niveaux de zoom de la lunette (champ horizontal en °, du plus large au plus serré) ; `zoom` en fait partie. Absent = un seul niveau */
  zooms?: readonly number[];
  /**
   * Dispersion du tir SANS lunette (rad, demi-angle du cône) d'une arme à lunette (v3 §1) : `base` à l'arrêt, + `mouvement` à
   * `VITESSE_REFERENCE_M_S`, + `air` en l'air. Absent = aucune dispersion (toutes les autres armes, §13.1).
   */
  hanche?: { base: number; mouvement: number; air: number };
  /** (v7) arme du mode zombies seulement (le pistolet à rayons) : jamais proposée ni acceptée dans l'arène */
  zombiesSeulement?: true;
  /** (v7) profil sur les tigres zombies, de base et au Pack-a-Punch (`ameliore`) */
  zombie: ArmeZombie;
}

/** Souffle d'une arme explosive (zombies) : `degats` au centre, la moitié au bord du rayon `rayon` (m), rien au-delà. */
export interface Explosion { degats: number; rayon: number }
/**
 * (v8) Viseur affiché en visée (zombies) : mire métallique (`fer`, le viseur ordinaire), point rouge, holographique, lunette (champ réduit,
 * plusieurs niveaux), lunette thermique (les tigres ressortent en blanc incandescent sur un décor éteint).
 */
export type Viseur = "fer" | "point_rouge" | "holo" | "lunette" | "thermique";
/** (v8) Munitions incendiaires : le tigre touché brûle `dureeS` s (renouvelé à chaque touche, jamais cumulé) et perd `dps` PV par seconde. */
export interface Brulure { dps: number; dureeS: number }
/**
 * (v8) Arc électrique (la Wunderwaffe DG-2 de BO1) : depuis le premier tigre touché, l'arc saute sur `sauts` tigres de plus au plus, chacun
 * à moins de `rayon` m du précédent et en vue de lui ; chaque tigre de la chaîne (le premier compris) prend `degats` en plus du tir.
 */
export interface ArcElectrique { sauts: number; rayon: number; degats: number }
/**
 * (v8) Tir qui part en projectile balistique (moteur de `grenades.ts`) au lieu d'une balle instantanée : vitesse de départ (m/s), gravité
 * (m/s²), rayon de l'objet (m), durée de vol au plus (ms), délai entre l'impact et l'explosion (ms : le carreau se plante puis saute) et,
 * pour un carreau leurre, rayon (m) dans lequel il attire les tigres jusqu'à l'explosion. Dégâts : `degats` au tigre touché de plein fouet,
 * puis le souffle `explosion`.
 */
export interface ProjectileArme { vitesse: number; gravite: number; rayonObjet: number; vieMs: number; delaiMs: number; attractionM?: number }
/**
 * (v8) Souffle en cône de la Soufflerie (le Thundergun de BO1 : cylindre de 180 u., projection jusqu'à 480 u., renversement jusqu'à 1 200 u.) :
 * un cône tronqué le long de la visée, de `rayonDebut` à l'œil à `rayonFin` à `portee` (m). En deçà de `porteeMortelle`, le tigre est projeté
 * (tué) ; au-delà, il perd la part `partLoin` de ses PV max.
 */
export interface SouffleCone { portee: number; porteeMortelle: number; rayonDebut: number; rayonFin: number; partLoin: number }
/** (v8) Gel : un tigre touché qui survit court à `facteur` × sa vitesse pendant `dureeS` s. */
export interface Gel { dureeS: number; facteur: number }
/**
 * Profil d'une arme sur les tigres zombies (v7, BO1) : dégâts d'un plomb au corps, multiplicateur de tête (non cumulé avec ×1,5),
 * chargeur (munitions totales pour une spéciale ; PAR ARME pour une paire akimbo), souffle éventuel à l'impact, balle qui traverse tous
 * les tigres alignés (`perce`).
 * (v8) Effets NON scalaires, surtout pour le Pack-a-Punch (le profil `ameliore`), lus par `statsTir` (client ET serveur) et appliqués par le
 * service zombies : brûlure, arc électrique, ricochets (rebonds sur les murs et le sol), projectile, souffle en cône, gel, paire d'armes
 * (`akimbo` : deux armes, deux chargeurs, clic gauche = main droite, clic droit = main gauche), viseur et niveaux de lunette, cadence
 * (`cadenceS` PAR ARME) et tir automatique propres.
 */
export interface ProfilZombie {
  degats: number; multTete: number; chargeur: number; explosion?: Explosion; perce?: true;
  brulure?: Brulure;
  arc?: ArcElectrique;
  /** rebonds de la balle sur les murs, les toits et le sol (1 ou 2) */
  ricochets?: number;
  projectile?: ProjectileArme;
  souffle?: SouffleCone;
  gel?: Gel;
  akimbo?: true;
  viseur?: Viseur;
  /** niveaux de la lunette (champ horizontal en °, du plus large au plus serré) ; le premier est celui de départ */
  zooms?: readonly number[];
  cadenceS?: number;
  auto?: boolean;
}
export interface ArmeZombie extends ProfilZombie {
  /**
   * Version Pack-a-Punch : nom de plat, nom court du rack (≤ 10 caractères, `BlocArmes`) et profil ; elle change VRAIMENT l'arme (un effet
   * non scalaire au moins, vérifié par `signatureAmelioration`).
   */
  ameliore: ProfilZombie & { nom: string; nomCourt: string };
}

/** Sans objet depuis la v2 §13.1 (plus de dispersion) ; conservée pour les lots qui l'importent encore. */
export const MULT_DISPERSION_ACCROUPI = 0.65;
/** Vitesse horizontale (m/s) de référence de l'ancienne dispersion de mouvement (= MOUV.marche). Sans effet depuis §13.1. */
export const VITESSE_REFERENCE_M_S = 9;

/** Arme blanche (slot `couteau`, v5 : couteau ou épée). Distances mesurées de la SURFACE de la capsule de la cible. */
export interface ArmeMelee {
  id: ArmeMeleeId;
  nom: string;
  /** libellé court pour le HUD (≤ 10 caractères) */
  nomCourt: string;
  description: string;
  /** dégâts à un joueur */
  degats: number;
  /** dégâts à un tigre zombie (mode zombies) */
  degatsZombie: number;
  /** portée annoncée (m, de la surface de la cible) et marge supplémentaire acceptée par le serveur */
  portee: number;
  margePortee: number;
  cadenceS: number;
  /** multiplicateur de marche ET de sprint */
  vitesse: number;
  /** cosinus du demi-angle du cône de frappe */
  cosCone: number;
  /** cibles touchées au plus par coup */
  nbCiblesMax: number;
  /** durée de l'animation de coup (s) */
  dureeCoupS: number;
}

export const MELEE: Record<ArmeMeleeId, ArmeMelee> = {
  couteau: {
    id: "couteau", nom: "Couteau", nomCourt: "Couteau",
    description: "Course bien plus rapide ; un coup au corps à corps tue un joueur sans bouclier.",
    degats: 100, degatsZombie: 150,
    portee: 2.2, margePortee: 0.6, cadenceS: 0.5, vitesse: 1.3,
    /** 55° */
    cosCone: 0.574, nbCiblesMax: 1, dureeCoupS: 0.4,
  },
  epee: {
    id: "epee", nom: "Épée", nomCourt: "Épée",
    description: "Longue portée, arc de 140° : un coup tranche jusqu'à trois cibles. Plus lente que le couteau.",
    degats: 140, degatsZombie: 1000,
    portee: 2.6, margePortee: 0.7, cadenceS: 0.85, vitesse: 1.2,
    /** 70° */
    cosCone: 0.342, nbCiblesMax: 3, dureeCoupS: 0.55,
  },
};

/** Le couteau (arme blanche par défaut). */
export const COUTEAU = MELEE.couteau;

export const STATS: Record<ArmeFeuId, Arme> = {
  pistolet: {
    id: "pistolet", nom: "Pistolet", nomCourt: "Pistolet", categorie: "secondaire",
    description: "Précis et polyvalent. Une balle à la tête fait 56.",
    degats: 28, multTete: 2, plombs: 1, gerbe: 0,
    cadenceS: 0.2, auto: false, chargeur: 12, rechargeS: 1.3, sansRecharge: false,
    dispersion: { base: 0.004, mouvement: 0.018, air: 0.035, parTir: 0.012, max: 0.06, retourS: 0.3, viseur: 0.0015 },
    recul: { tangage: 0.022, lacet: 0.006 },
    portee: 120, chute: { debut: 25, fin: 70, min: 0.7 },
    vitesse: 1, zoom: null,
    zombie: { degats: 40, multTete: 2, chargeur: 12, ameliore: {
      // BO1 : M1911 → Mustang & Sally (deux pistolets à grenades, 0,2 s, 6 coups chacun, impact 1 000)
      nom: "Moutarde & Sally", nomCourt: "Moutarde", degats: 1000, multTete: 1, chargeur: 6, akimbo: true, cadenceS: 0.2,
      projectile: { vitesse: 55, gravite: 3, rayonObjet: 0.05, vieMs: 2500, delaiMs: 0 }, explosion: { degats: 500, rayon: 3.5 },
    } },
  },
  mitraillette: {
    id: "mitraillette", nom: "Mitraillette", nomCourt: "Mitraill.", categorie: "principale",
    description: "Cadence folle : redoutable de près, le recul demande de la maîtrise.",
    degats: 16, multTete: 1.6, plombs: 1, gerbe: 0,
    cadenceS: 0.075, auto: true, chargeur: 32, rechargeS: 2.0, sansRecharge: false,
    dispersion: { base: 0.012, mouvement: 0.025, air: 0.05, parTir: 0.006, max: 0.09, retourS: 0.45, viseur: 0.008 },
    recul: { tangage: 0.012, lacet: 0.008 },
    portee: 90, chute: { debut: 15, fin: 50, min: 0.55 },
    vitesse: 1, zoom: null,
    zombie: { degats: 95, multTete: 2, chargeur: 32, ameliore: { nom: "Mitraillette grand-mère", nomCourt: "Grand-mère", degats: 190, multTete: 2, chargeur: 50, viseur: "holo", arc: { sauts: 2, rayon: 4, degats: 250 } } },
  },
  pompe: {
    // 20 par plomb : 5 plombs sur 9 (la majorité) au corps à bout portant font 100 = un mort.
    // Gerbe fixe (§13.1) : 1 plomb au centre + 8 sur un cercle de 0,055 rad.
    id: "pompe", nom: "Fusil à pompe", nomCourt: "Pompe", categorie: "principale",
    description: "Dévastateur de près, presque inoffensif au-delà de 30 m. Gerbe fixe de 9 plombs.",
    degats: 20, multTete: 1.5, plombs: 9, gerbe: 0.055,
    cadenceS: 0.85, auto: false, chargeur: 6, rechargeS: 2.4, sansRecharge: false,
    dispersion: { base: 0.085, mouvement: 0.012, air: 0.02, parTir: 0, max: 0.11, retourS: 0.5, viseur: 0.07 },
    recul: { tangage: 0.09, lacet: 0.01 },
    portee: 45, chute: { debut: 8, fin: 30, min: 0.25 },
    vitesse: 1, zoom: null,
    zombie: { degats: 70, multTete: 1.5, chargeur: 6, ameliore: { nom: "Pompe royale", nomCourt: "P. royale", degats: 140, multTete: 1.5, chargeur: 10, viseur: "point_rouge", explosion: { degats: 350, rayon: 2.2 } } },
  },
  sniper: {
    id: "sniper", nom: "Sniper", nomCourt: "Sniper", categorie: "principale",
    description: "Un tir à la tête tue, au corps 95. Lunette au clic droit.",
    degats: 95, multTete: 2.5, plombs: 1, gerbe: 0,
    cadenceS: 1.35, auto: false, chargeur: 5, rechargeS: 2.9, sansRecharge: false,
    dispersion: { base: 0.09, mouvement: 0.05, air: 0.09, parTir: 0.02, max: 0.12, retourS: 0.8, viseur: 0 },
    recul: { tangage: 0.04, lacet: 0.004 },
    portee: 400, chute: { debut: 400, fin: 400, min: 1 },
    // ×3, ×6 (défaut, l'ancien 18°) et ×12 : 2·atan(tan 45° / k)
    vitesse: 0.9, zoom: 18.92, zooms: [36.87, 18.92, 9.53],
    hanche: { base: 0.045, mouvement: 0.035, air: 0.06 },
    zombie: { degats: 900, multTete: 3, chargeur: 5, ameliore: { nom: "Sniper en croûte", nomCourt: "En croûte", degats: 2200, multTete: 3, chargeur: 8, perce: true, viseur: "thermique", zooms: [36.87, 18.92, 9.53] } },
  },
  fusil_assaut: {
    id: "fusil_assaut", nom: "Fusil d'assaut", nomCourt: "Fusil", categorie: "principale",
    description: "Polyvalent : cadence soutenue, bonne précision à moyenne distance.",
    degats: 22, multTete: 1.8, plombs: 1, gerbe: 0,
    cadenceS: 0.10, auto: true, chargeur: 30, rechargeS: 2.2, sansRecharge: false,
    dispersion: { base: 0.006, mouvement: 0.022, air: 0.045, parTir: 0.005, max: 0.07, retourS: 0.5, viseur: 0.002 },
    recul: { tangage: 0.014, lacet: 0.007 },
    portee: 140, chute: { debut: 30, fin: 90, min: 0.6 },
    vitesse: 0.97, zoom: null,
    zombie: { degats: 110, multTete: 2, chargeur: 30, ameliore: {
      // lunette ×2 / ×3 (l'ACOG de BO1) et balles explosives
      nom: "Fusil bourguignon", nomCourt: "Bourgogne", degats: 190, multTete: 2, chargeur: 45, viseur: "lunette", zooms: [53.13, 36.87],
      explosion: { degats: 250, rayon: 1.8 },
    } },
  },
  mitrailleuse: {
    id: "mitrailleuse", nom: "Mitrailleuse", nomCourt: "M. lourde", categorie: "principale",
    description: "Un grand chargeur pour arroser longtemps ; lente à recharger et à porter.",
    degats: 19, multTete: 1.5, plombs: 1, gerbe: 0,
    cadenceS: 0.085, auto: true, chargeur: 60, rechargeS: 4.2, sansRecharge: false,
    dispersion: { base: 0.014, mouvement: 0.03, air: 0.055, parTir: 0.004, max: 0.10, retourS: 0.6, viseur: 0.009 },
    recul: { tangage: 0.011, lacet: 0.010 },
    portee: 110, chute: { debut: 20, fin: 60, min: 0.5 },
    vitesse: 0.88, zoom: null,
    zombie: { degats: 130, multTete: 2, chargeur: 60, ameliore: { nom: "Mitrailleuse tartiflette", nomCourt: "Tartiflet.", degats: 210, multTete: 2, chargeur: 125, viseur: "holo", brulure: { dps: 250, dureeS: 4 } } },
  },
  revolver: {
    id: "revolver", nom: "Revolver", nomCourt: "Revolver", categorie: "secondaire",
    description: "Six balles, un coup lent et puissant : deux touches au corps font mal.",
    degats: 55, multTete: 2, plombs: 1, gerbe: 0,
    cadenceS: 0.50, auto: false, chargeur: 6, rechargeS: 2.2, sansRecharge: false,
    dispersion: { base: 0.003, mouvement: 0.02, air: 0.04, parTir: 0.02, max: 0.06, retourS: 0.45, viseur: 0.001 },
    recul: { tangage: 0.05, lacet: 0.008 },
    portee: 130, chute: { debut: 30, fin: 80, min: 0.7 },
    vitesse: 1, zoom: null,
    zombie: { degats: 240, multTete: 2.5, chargeur: 6, ameliore: {
      // BO1 : Python → Cobra (12 coups, tête ×3) ; ici flambé : munitions incendiaires
      nom: "Cobra flambé", nomCourt: "Cobra", degats: 560, multTete: 3, chargeur: 12, viseur: "point_rouge", brulure: { dps: 200, dureeS: 4 },
    } },
  },
  mini_uzi: {
    id: "mini_uzi", nom: "Mini Uzi", nomCourt: "Mini uzi", categorie: "secondaire",
    description: "Cadence frénétique à courte portée, pour finir un duel au corps à corps.",
    degats: 11, multTete: 1.5, plombs: 1, gerbe: 0,
    cadenceS: 0.06, auto: true, chargeur: 25, rechargeS: 1.6, sansRecharge: false,
    dispersion: { base: 0.02, mouvement: 0.03, air: 0.055, parTir: 0.008, max: 0.10, retourS: 0.4, viseur: 0.014 },
    recul: { tangage: 0.010, lacet: 0.012 },
    portee: 45, chute: { debut: 8, fin: 30, min: 0.4 },
    vitesse: 1.05, zoom: null,
    zombie: { degats: 55, multTete: 2, chargeur: 25, ameliore: { nom: "Mini Uzi à la plancha", nomCourt: "Plancha", degats: 110, multTete: 2, chargeur: 40, cadenceS: 0.05, viseur: "point_rouge", ricochets: 2 } },
  },
  rayon: {
    // (v7) zombies seulement : sort de la boîte ou de la quête ; tir droit, explosion à l'impact (BO1 : le Ray Gun)
    id: "rayon", nom: "Pistolet à rayons", nomCourt: "Rayons", categorie: "secondaire",
    description: "Sorti de la boîte : un trait vert qui explose à l'impact.",
    degats: 60, multTete: 1.5, plombs: 1, gerbe: 0,
    cadenceS: 0.33, auto: true, chargeur: 20, rechargeS: 3.0, sansRecharge: false,
    dispersion: { base: 0.004, mouvement: 0.018, air: 0.035, parTir: 0.012, max: 0.06, retourS: 0.3, viseur: 0.0015 },
    recul: { tangage: 0.03, lacet: 0.006 },
    portee: 140, chute: { debut: 140, fin: 140, min: 1 },
    vitesse: 1, zoom: null,
    zombiesSeulement: true,
    zombie: { degats: 1000, multTete: 1.5, chargeur: 20, explosion: { degats: 1500, rayon: 1.6 }, ameliore: {
      // BO1 : Porter's X2 (chargeur ×2) ; ici l'impact libère en plus un arc qui saute sur trois tigres
      nom: "Rayon Goulaf", nomCourt: "R. Goulaf", degats: 1800, multTete: 1.5, chargeur: 40, explosion: { degats: 2800, rayon: 2 },
      arc: { sauts: 3, rayon: 5, degats: 1500 },
    } },
  },
  // ---- (v8) armes du mode zombies seulement : BO1 renommé, au mur ou dans la boîte ----
  baguette: {
    // l'Olympia de BO1 (double canon, deux coups) ; gratinée : l'Hadès, munitions incendiaires
    id: "baguette", nom: "Coupe-baguette", nomCourt: "Baguette", categorie: "principale",
    description: "Fusil à canon scié double : deux coups dévastateurs à bout portant, puis on recharge.",
    degats: 22, multTete: 1.5, plombs: 8, gerbe: 0.075,
    cadenceS: 0.3, auto: false, chargeur: 2, rechargeS: 2.2, sansRecharge: false,
    dispersion: { base: 0.09, mouvement: 0.012, air: 0.02, parTir: 0, max: 0.12, retourS: 0.5, viseur: 0.08 },
    recul: { tangage: 0.11, lacet: 0.012 },
    portee: 35, chute: { debut: 6, fin: 22, min: 0.2 },
    vitesse: 1, zoom: null,
    zombiesSeulement: true,
    zombie: { degats: 160, multTete: 1.5, chargeur: 2, ameliore: {
      nom: "Baguette flambée", nomCourt: "Flambée", degats: 320, multTete: 1.5, chargeur: 4,
      brulure: { dps: 300, dureeS: 5 }, explosion: { degats: 200, rayon: 1.5 },
    } },
  },
  agrafeuse: {
    // le FAL de BO1 (semi-automatique de précision) ; gratinée : balles qui ricochent, viseur holographique
    id: "agrafeuse", nom: "Agrafeuse", nomCourt: "Agrafeuse", categorie: "principale",
    description: "Fusil semi-automatique : une balle lourde par clic, précise et qui fait mal à la tête.",
    degats: 34, multTete: 2.2, plombs: 1, gerbe: 0,
    cadenceS: 0.14, auto: false, chargeur: 20, rechargeS: 2.3, sansRecharge: false,
    dispersion: { base: 0.004, mouvement: 0.02, air: 0.04, parTir: 0.012, max: 0.06, retourS: 0.4, viseur: 0.001 },
    recul: { tangage: 0.03, lacet: 0.006 },
    portee: 160, chute: { debut: 40, fin: 110, min: 0.7 },
    vitesse: 0.97, zoom: null,
    zombiesSeulement: true,
    zombie: { degats: 220, multTete: 3, chargeur: 20, ameliore: {
      nom: "Agrafeuse professionnelle", nomCourt: "Agraf. pro", degats: 400, multTete: 3, chargeur: 30, viseur: "holo", ricochets: 2,
    } },
  },
  photocopieuse: {
    // la PPSh de BO1 (tambour de 71 coups, cadence folle) ; gratinée : arcs électriques, point rouge
    id: "photocopieuse", nom: "Photocopieuse", nomCourt: "Photocop.", categorie: "principale",
    description: "Mitraillette à tambour : 71 coups à une cadence de photocopieuse en surchauffe.",
    degats: 14, multTete: 1.5, plombs: 1, gerbe: 0,
    cadenceS: 0.055, auto: true, chargeur: 71, rechargeS: 3.0, sansRecharge: false,
    dispersion: { base: 0.016, mouvement: 0.03, air: 0.055, parTir: 0.006, max: 0.1, retourS: 0.45, viseur: 0.01 },
    recul: { tangage: 0.009, lacet: 0.011 },
    portee: 80, chute: { debut: 15, fin: 45, min: 0.5 },
    vitesse: 1, zoom: null,
    zombiesSeulement: true,
    zombie: { degats: 110, multTete: 2, chargeur: 71, ameliore: {
      nom: "Photocopieuse couleur", nomCourt: "Couleur", degats: 200, multTete: 2, chargeur: 115, viseur: "point_rouge",
      arc: { sauts: 2, rayon: 4, degats: 300 },
    } },
  },
  essoreuse: {
    // le SPAS-12 de BO1 (pompe semi-automatique) ; gratinée : le SPAZ-24, tout automatique, plombs explosifs
    id: "essoreuse", nom: "Essoreuse", nomCourt: "Essoreuse", categorie: "principale",
    description: "Fusil à pompe semi-automatique : huit coups enchaînés aussi vite qu'on clique.",
    degats: 16, multTete: 1.5, plombs: 8, gerbe: 0.06,
    cadenceS: 0.28, auto: false, chargeur: 8, rechargeS: 3.2, sansRecharge: false,
    dispersion: { base: 0.08, mouvement: 0.012, air: 0.02, parTir: 0, max: 0.11, retourS: 0.5, viseur: 0.07 },
    recul: { tangage: 0.07, lacet: 0.012 },
    portee: 40, chute: { debut: 8, fin: 28, min: 0.25 },
    vitesse: 0.97, zoom: null,
    zombiesSeulement: true,
    zombie: { degats: 90, multTete: 1.5, chargeur: 8, ameliore: {
      nom: "Essoreuse turbo", nomCourt: "Turbo", degats: 160, multTete: 1.5, chargeur: 12, auto: true, cadenceS: 0.22,
      explosion: { degats: 300, rayon: 2 },
    } },
  },
  brochette: {
    // l'arbalète explosive de BO1 : le carreau se plante puis saute ; gratiné : le « monkey bolt », il attire les tigres avant de sauter
    id: "brochette", nom: "Brochette", nomCourt: "Brochette", categorie: "principale",
    description: "Arbalète : le pique-brochette se plante dans un tigre ou un mur et explose une seconde et demie plus tard.",
    degats: 60, multTete: 1.5, plombs: 1, gerbe: 0,
    cadenceS: 1.0, auto: false, chargeur: 1, rechargeS: 2.2, sansRecharge: false,
    dispersion: { base: 0.004, mouvement: 0.02, air: 0.04, parTir: 0.012, max: 0.06, retourS: 0.5, viseur: 0.001 },
    recul: { tangage: 0.05, lacet: 0.006 },
    portee: 150, chute: { debut: 150, fin: 150, min: 1 },
    vitesse: 0.95, zoom: null,
    zombiesSeulement: true,
    zombie: {
      degats: 750, multTete: 1, chargeur: 1, explosion: { degats: 1500, rayon: 3.5 },
      projectile: { vitesse: 70, gravite: 4, rayonObjet: 0.04, vieMs: 2500, delaiMs: 1500 },
      ameliore: {
        nom: "Brochette du chef", nomCourt: "Br. chef", degats: 2250, multTete: 1, chargeur: 2, explosion: { degats: 4000, rayon: 4.5 },
        // BO1 : point d'intérêt de 1 536 u. (≈ 39 m), le tigre touché danse jusqu'à l'explosion
        projectile: { vitesse: 75, gravite: 4, rayonObjet: 0.04, vieMs: 2500, delaiMs: 3000, attractionM: 30 },
      },
    },
  },
  soufflerie: {
    // le Thundergun de BO1 : souffle en cône qui projette tout ce qui est près et renverse le reste
    id: "soufflerie", nom: "Soufflerie", nomCourt: "Soufflerie", categorie: "principale",
    description: "Sortie de la boîte : un souffle d'air qui balaie les tigres devant soi. Deux coups par recharge.",
    degats: 80, multTete: 1, plombs: 1, gerbe: 0,
    cadenceS: 1.0, auto: false, chargeur: 2, rechargeS: 3.0, sansRecharge: false,
    dispersion: { base: 0.01, mouvement: 0.02, air: 0.03, parTir: 0.01, max: 0.05, retourS: 0.5, viseur: 0.005 },
    recul: { tangage: 0.12, lacet: 0.01 },
    portee: 24, chute: { debut: 24, fin: 24, min: 1 },
    vitesse: 0.95, zoom: null,
    zombiesSeulement: true,
    zombie: {
      // 480 u. ≈ 12 m de projection, 1 200 u. ≈ 30 m de renversement (réduit à 24 m : la carte est intérieure)
      degats: 0, multTete: 1, chargeur: 2, souffle: { portee: 24, porteeMortelle: 12, rayonDebut: 1, rayonFin: 4.5, partLoin: 0.5 },
      ameliore: {
        nom: "Soufflerie XXL", nomCourt: "Souf. XXL", degats: 0, multTete: 1, chargeur: 4,
        souffle: { portee: 30, porteeMortelle: 16, rayonDebut: 1.2, rayonFin: 6, partLoin: 0.6 }, gel: { dureeS: 4, facteur: 0.35 },
      },
    },
  },
  grille_pain: {
    // la Wunderwaffe DG-2 de BO1 : un arc qui foudroie et saute de tigre en tigre ; gratiné (DG-3 JZ) : plus de sauts, et ils grillent
    id: "grille_pain", nom: "Grille-pain", nomCourt: "Grill-pain", categorie: "principale",
    description: "Sorti de la boîte : un éclair qui saute de tigre en tigre, jusqu'à dix d'un coup. Trois charges.",
    degats: 90, multTete: 1, plombs: 1, gerbe: 0,
    cadenceS: 1.2, auto: false, chargeur: 3, rechargeS: 3.0, sansRecharge: false,
    dispersion: { base: 0.004, mouvement: 0.02, air: 0.04, parTir: 0.012, max: 0.06, retourS: 0.5, viseur: 0.001 },
    recul: { tangage: 0.08, lacet: 0.01 },
    portee: 70, chute: { debut: 70, fin: 70, min: 1 },
    vitesse: 0.95, zoom: null,
    zombiesSeulement: true,
    zombie: {
      degats: 12000, multTete: 1, chargeur: 3, arc: { sauts: 9, rayon: 7, degats: 12000 },
      ameliore: {
        nom: "Grille-pain 4 tranches", nomCourt: "4 tranches", degats: 20000, multTete: 1, chargeur: 6,
        arc: { sauts: 23, rayon: 9, degats: 20000 }, brulure: { dps: 1500, dureeS: 4 },
      },
    },
  },
  perforeuse: {
    // le CZ75 de BO1 (pistolet semi-automatique lourd) ; gratinée : la paire akimbo tout automatique
    id: "perforeuse", nom: "Perforeuse", nomCourt: "Perforeuse", categorie: "secondaire",
    description: "Pistolet lourd semi-automatique : quinze coups secs, idéal pour finir à la tête.",
    degats: 30, multTete: 2, plombs: 1, gerbe: 0,
    cadenceS: 0.11, auto: false, chargeur: 15, rechargeS: 1.5, sansRecharge: false,
    dispersion: { base: 0.004, mouvement: 0.018, air: 0.035, parTir: 0.012, max: 0.06, retourS: 0.3, viseur: 0.0015 },
    recul: { tangage: 0.026, lacet: 0.007 },
    portee: 110, chute: { debut: 25, fin: 70, min: 0.7 },
    vitesse: 1, zoom: null,
    zombiesSeulement: true,
    zombie: { degats: 150, multTete: 2.5, chargeur: 15, ameliore: {
      nom: "Perforeuses jumelles", nomCourt: "Jumelles", degats: 300, multTete: 2.5, chargeur: 20, akimbo: true, auto: true, cadenceS: 0.11,
    } },
  },
  railgun: {
    id: "railgun", nom: "Railgun", nomCourt: "Railgun", categorie: "speciale",
    description: "Offert par Elsa : 6 tirs seulement, aucune perte de dégâts, la tête tue toujours.",
    degats: 140, multTete: 1.5, plombs: 1, gerbe: 0,
    cadenceS: 1.20, auto: false, chargeur: 6, rechargeS: 0, sansRecharge: true,
    dispersion: { base: 0.001, mouvement: 0.03, air: 0.05, parTir: 0.01, max: 0.06, retourS: 0.6, viseur: 0 },
    recul: { tangage: 0.06, lacet: 0.004 },
    portee: 500, chute: { debut: 500, fin: 500, min: 1 },
    vitesse: 0.9, zoom: null,
    zombie: { degats: 3000, multTete: 1.5, chargeur: 12, perce: true, ameliore: { nom: "Railgun thermidor", nomCourt: "Thermidor", degats: 6000, multTete: 1.5, chargeur: 20, perce: true, viseur: "thermique", zooms: [36.87], arc: { sauts: 4, rayon: 6, degats: 3000 } } },
  },
  minigun: {
    id: "minigun", nom: "Minigun", nomCourt: "Minigun", categorie: "speciale",
    description: "Offert par Elsa : 150 balles à une cadence démente, mais on avance lentement.",
    degats: 13, multTete: 1.4, plombs: 1, gerbe: 0,
    cadenceS: 0.04, auto: true, chargeur: 150, rechargeS: 0, sansRecharge: true,
    dispersion: { base: 0.025, mouvement: 0.03, air: 0.06, parTir: 0.006, max: 0.10, retourS: 0.5, viseur: 0.018 },
    recul: { tangage: 0.006, lacet: 0.012 },
    portee: 100, chute: { debut: 20, fin: 70, min: 0.5 },
    vitesse: 0.75, zoom: null,
    zombie: { degats: 70, multTete: 1.4, chargeur: 150, ameliore: { nom: "Minigun carbonara", nomCourt: "Carbonara", degats: 130, multTete: 1.4, chargeur: 250, ricochets: 1, brulure: { dps: 150, dureeS: 3 } } },
  },
  magnum_dore: {
    id: "magnum_dore", nom: "Magnum doré", nomCourt: "Magnum", categorie: "speciale",
    description: "Offert par Elsa : 8 balles, la tête tue en un coup jusqu'à 40 m.",
    degats: 70, multTete: 3, plombs: 1, gerbe: 0,
    cadenceS: 0.70, auto: false, chargeur: 8, rechargeS: 0, sansRecharge: true,
    dispersion: { base: 0.002, mouvement: 0.02, air: 0.04, parTir: 0.02, max: 0.06, retourS: 0.5, viseur: 0.0008 },
    recul: { tangage: 0.07, lacet: 0.01 },
    portee: 160, chute: { debut: 40, fin: 100, min: 0.8 },
    vitesse: 1, zoom: null,
    zombie: { degats: 800, multTete: 3, chargeur: 8, ameliore: { nom: "Magnum à l'or fin", nomCourt: "Or fin", degats: 1600, multTete: 3, chargeur: 14, perce: true, viseur: "point_rouge" } },
  },
  lance_grenades: {
    id: "lance_grenades", nom: "Lance-grenades", nomCourt: "L-grenade", categorie: "unique",
    description: "Arme unique larguée par le bus C3 : grenades explosives infligeant 110 dégâts à l'impact.",
    degats: 110, multTete: 1.3, plombs: 1, gerbe: 0,
    cadenceS: 0.65, auto: false, chargeur: 6, rechargeS: 0, sansRecharge: true,
    dispersion: { base: 0.005, mouvement: 0.02, air: 0.04, parTir: 0.015, max: 0.06, retourS: 0.5, viseur: 0.003 },
    recul: { tangage: 0.06, lacet: 0.01 },
    portee: 160, chute: { debut: 60, fin: 140, min: 0.8 },
    vitesse: 0.95, zoom: null,
    // pas dans la boîte des zombies (arène seulement) ; valeurs de remplissage
    zombie: { degats: 300, multTete: 1, chargeur: 6, explosion: { degats: 600, rayon: 3 }, ameliore: { nom: "Lance-gratins", nomCourt: "L-gratins", degats: 600, multTete: 1, chargeur: 10, explosion: { degats: 1200, rayon: 3.5 } } },
  },
  bazooka: {
    id: "bazooka", nom: "Bazooka", nomCourt: "Bazooka", categorie: "unique",
    description: "Arme lourde unique larguée par le bus C3 : roquette dévastatrice tuant en un coup direct.",
    degats: 160, multTete: 1.5, plombs: 1, gerbe: 0,
    cadenceS: 1.4, auto: false, chargeur: 3, rechargeS: 0, sansRecharge: true,
    dispersion: { base: 0.002, mouvement: 0.015, air: 0.03, parTir: 0.02, max: 0.05, retourS: 0.6, viseur: 0.001 },
    recul: { tangage: 0.09, lacet: 0.012 },
    portee: 350, chute: { debut: 350, fin: 350, min: 1 },
    vitesse: 0.85, zoom: null,
    // pas dans la boîte des zombies (arène seulement) ; valeurs de remplissage
    zombie: { degats: 1500, multTete: 1, chargeur: 3, explosion: { degats: 1500, rayon: 4 }, ameliore: { nom: "Bazooka au four", nomCourt: "Au four", degats: 3000, multTete: 1, chargeur: 5, explosion: { degats: 3000, rayon: 4.5 } } },
  },
  fumigene: {
    id: "fumigene", nom: "Fumigène", nomCourt: "Fumigène", categorie: "unique",
    description: "Grenade fumigène : déploie un écran de fumée opaque masquant les déplacements.",
    degats: 15, multTete: 1, plombs: 1, gerbe: 0,
    cadenceS: 1.0, auto: false, chargeur: 3, rechargeS: 0, sansRecharge: true,
    dispersion: { base: 0.01, mouvement: 0.02, air: 0.03, parTir: 0.01, max: 0.05, retourS: 0.4, viseur: 0.005 },
    recul: { tangage: 0.03, lacet: 0.005 },
    portee: 80, chute: { debut: 40, fin: 80, min: 0.5 },
    vitesse: 1.05, zoom: null,
    // pas dans la boîte des zombies (arène seulement) ; valeurs de remplissage
    zombie: { degats: 15, multTete: 1, chargeur: 3, ameliore: { nom: "Fumigène fumé", nomCourt: "Fumé", degats: 30, multTete: 1, chargeur: 5 } },
  },
};

/** (v7) Profil zombies de l'arme, amélioré ou non. */
export function profilZombie(arme: ArmeFeuId, ameliore = false): ProfilZombie {
  const z = STATS[arme].zombie;
  return ameliore ? z.ameliore : z;
}
/** (v7) Dégâts d'un plomb sur un tigre zombie (entier) : profil zombies, zone (tête × son multiplicateur) et chute de l'arme. */
export function degatsZombie(arme: ArmeFeuId, zone: Zone, distance: number, ameliore = false): number {
  const p = profilZombie(arme, ameliore);
  return Math.round(p.degats * (zone === "tete" ? p.multTete : 1) * multiplicateurChute(arme, Math.max(0, distance)));
}
/** (v7) Chargeur en zombies (munitions totales d'une spéciale) ; dans l'arène, c'est `STATS[a].chargeur`. */
export function chargeurZombie(arme: ArmeFeuId, ameliore = false): number { return profilZombie(arme, ameliore).chargeur; }
/** (v7) Nom affiché en zombies : le nom de plat une fois améliorée. */
export function nomZombie(arme: ArmeFeuId, ameliore = false): string { return ameliore ? STATS[arme].zombie.ameliore.nom : STATS[arme].nom; }
/** (v8) Nom court du rack (≤ 10 caractères) : celui de l'arme améliorée une fois passée au Micro-ondes. */
export function nomCourtZombie(arme: ArmeFeuId, ameliore = false): string { return ameliore ? STATS[arme].zombie.ameliore.nomCourt : STATS[arme].nomCourt; }
/** (v8) Nom affiché de l'arme en main : arme blanche, arme à feu, ou nom de plat si elle est dans `ameliorees`. */
export function nomAffiche(id: ArmeId, ameliorees?: readonly string[]): string {
  if (estMelee(id)) return MELEE[id].nom;
  return nomZombie(id, ameliorees?.includes(id) ?? false);
}

/**
 * (v8) Ce qu'il faut pour tirer avec l'arme (client ET serveur doivent lire la même chose, sinon les tirs sont refusés) : cadence PAR ARME
 * (une paire akimbo tire deux fois plus, une main après l'autre), automatique ou non, viseur, niveaux de lunette et index de départ, paire
 * d'armes, projectile, souffle, ricochets. Dans l'arène (`zombies` faux), c'est `STATS` tel quel ; en zombies, le profil (amélioré ou non)
 * peut tout changer.
 */
export interface StatsTir {
  cadenceS: number;
  auto: boolean;
  viseur: Viseur;
  zooms: readonly number[];
  zoomDefaut: number;
  akimbo: boolean;
  projectile: boolean;
  souffle: boolean;
  ricochets: number;
}
export function statsTir(arme: ArmeFeuId, o: { zombies?: boolean; ameliore?: boolean } = {}): StatsTir {
  const a = STATS[arme];
  if (!o.zombies) {
    const zooms = niveauxZoom(arme);
    return {
      cadenceS: a.cadenceS, auto: a.auto, viseur: zooms.length ? "lunette" : "fer", zooms, zoomDefaut: niveauZoomDefaut(arme),
      akimbo: false, projectile: false, souffle: false, ricochets: 0,
    };
  }
  const p = profilZombie(arme, o.ameliore === true);
  const zooms = p.zooms ?? niveauxZoom(arme);
  const viseur: Viseur = p.viseur ?? (zooms.length ? "lunette" : "fer");
  return {
    cadenceS: p.cadenceS ?? a.cadenceS,
    auto: p.auto ?? a.auto,
    viseur,
    zooms,
    zoomDefaut: p.zooms ? 0 : niveauZoomDefaut(arme),
    akimbo: p.akimbo === true,
    projectile: p.projectile !== undefined,
    souffle: p.souffle !== undefined,
    ricochets: Math.max(0, Math.min(3, Math.floor(p.ricochets ?? 0))),
  };
}
/** (v8) Le viseur est une lunette (champ réduit, réticule plein écran, `Lunette.tsx`) : lunette ordinaire ou thermique. */
export const viseurLunette = (v: Viseur): boolean => v === "lunette" || v === "thermique";

/** (v8) Effets non scalaires d'un profil zombies (ce qui change VRAIMENT l'arme, au-delà des dégâts et du chargeur). */
export type EffetArme =
  | "akimbo" | "projectile" | "explosive" | "incendiaire" | "electrique" | "ricochet" | "perce" | "souffle" | "gel" | "leurre" | "auto"
  | `viseur:${Viseur}`;
function effetsProfil(arme: ArmeFeuId, p: ProfilZombie): Set<EffetArme> {
  const e = new Set<EffetArme>();
  if (p.akimbo) e.add("akimbo");
  if (p.projectile) e.add("projectile");
  if (p.projectile?.attractionM) e.add("leurre");
  if (p.explosion) e.add("explosive");
  if (p.brulure) e.add("incendiaire");
  if (p.arc) e.add("electrique");
  if ((p.ricochets ?? 0) > 0) e.add("ricochet");
  if (p.perce) e.add("perce");
  if (p.souffle) e.add("souffle");
  if (p.gel) e.add("gel");
  if (p.auto ?? STATS[arme].auto) e.add("auto");
  e.add(`viseur:${p.viseur ?? (niveauxZoom(arme).length ? "lunette" : "fer")}`);
  return e;
}
/**
 * (v8) Signature du Pack-a-Punch : effets non scalaires que l'arme améliorée a et que l'arme de base n'a pas, triés. Jamais vide pour une
 * arme qui peut passer au Micro-ondes, et distincte d'une arme à l'autre (chaque arme gratinée a sa personnalité, vérifié par un test).
 */
export function signatureAmelioration(arme: ArmeFeuId): EffetArme[] {
  const base = effetsProfil(arme, STATS[arme].zombie);
  return [...effetsProfil(arme, STATS[arme].zombie.ameliore)].filter((x) => !base.has(x)).sort();
}
/** (v7) Dégâts d'un souffle à `distance` (m) du centre : 100 % au centre, 50 % au bord, 0 au-delà (entier). */
export function degatsExplosion(e: Explosion, distance: number): number {
  if (!(distance <= e.rayon)) return 0;
  return Math.round(e.degats * (1 - 0.5 * Math.max(0, distance) / e.rayon));
}
/** (v7) Armes qui ne sont jamais proposées dans l'arène (lobby, équipement reçu). */
export const estZombiesSeulement = (a: ArmeFeuId): boolean => STATS[a].zombiesSeulement === true;

/** Multiplicateur de déplacement de l'arme en main (couteau compris). */
export function vitesseArme(id: ArmeId): number { return estMelee(id) ? MELEE[id].vitesse : STATS[id].vitesse; }
export function nomArme(id: ArmeId): string { return estMelee(id) ? MELEE[id].nom : STATS[id].nom; }

/** Multiplicateur de dégâts selon la distance : 1 jusqu'à `debut`, `min` à partir de `fin`, linéaire entre les deux. */
export function multiplicateurChute(arme: ArmeFeuId, distance: number): number {
  const { debut, fin, min } = STATS[arme].chute;
  if (distance <= debut) return 1;
  if (distance >= fin) return min;
  return 1 - (1 - min) * ((distance - debut) / (fin - debut));
}

/** Dégâts d'un plomb (entier) selon la zone touchée et la distance parcourue. */
export function degatsPlomb(arme: ArmeFeuId, zone: Zone, distance: number): number {
  const a = STATS[arme];
  const d = Math.max(0, distance);
  return Math.round(a.degats * (zone === "tete" ? a.multTete : 1) * multiplicateurChute(arme, d));
}

/**
 * Demi-angle (rad) du cône de dispersion : TOUJOURS 0 (v2 §13.1, aucune dispersion). Le mouvement, le saut, le wall-run,
 * l'accroupi, la visée et la chaleur n'écartent plus le tir. Les paramètres sont conservés pour les appelants existants.
 */
export function dispersionCourante(
  _arme: ArmeFeuId,
  _ctx?: { vitesseH?: number; auSol?: boolean; vise?: boolean; chaleur?: number; accroupi?: boolean },
): number {
  return 0;
}

/**
 * Demi-angle (rad) du cône de dispersion d'un tir (v3 §1) : 0 pour toute arme sans `hanche` et pour un tir EN LUNETTE ; sinon
 * `base` + `mouvement` × min(vitesse horizontale / VITESSE_REFERENCE_M_S, 1.5) + `air` hors du sol.
 */
export function dispersionTir(arme: ArmeFeuId, ctx: { lunette: boolean; vitesseH: number; auSol: boolean }): number {
  const h = STATS[arme].hanche;
  if (!h || ctx.lunette) return 0;
  const v = Math.min(Math.max(ctx.vitesseH, 0) / VITESSE_REFERENCE_M_S, 1.5);
  return h.base + h.mouvement * v + (ctx.auSol ? 0 : h.air);
}

/**
 * Direction `d` déviée d'un angle tiré uniformément dans le DISQUE de demi-angle `angle` (rad). `u` et `v` dans [0, 1[ : le hasard
 * est fourni par l'appelant (`Math.random` côté client, rien côté serveur). `angle` ≤ 0 renvoie `d` normalisée.
 */
export function devier(d: Vec3, angle: number, u: number, v: number): Vec3 {
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  const fx = d[0] / n, fy = d[1] / n, fz = d[2] / n;
  if (!(angle > 0)) return [fx, fy, fz];
  let ux: number, uy: number, uz: number;
  if (Math.abs(fy) > 0.999) { ux = 1; uy = 0; uz = 0; }
  else { const l = Math.hypot(fz, fx); ux = fz / l; uy = 0; uz = -fx / l; }
  const wx = fy * uz - fz * uy, wy = fz * ux - fx * uz, wz = fx * uy - fy * ux;
  const r = angle * Math.sqrt(Math.min(Math.max(u, 0), 1)), phi = 2 * Math.PI * v;
  const s = Math.sin(r), c = Math.cos(r);
  const a = s * Math.cos(phi), b = s * Math.sin(phi);
  const x = fx * c + ux * a + wx * b, y = fy * c + uy * a + wy * b, z = fz * c + uz * a + wz * b;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Niveaux de zoom de la lunette de l'arme (champ horizontal en °), [] sans lunette. */
export function niveauxZoom(arme: ArmeFeuId): readonly number[] {
  const a = STATS[arme];
  if (a.zoom === null) return [];
  return a.zooms && a.zooms.length ? a.zooms : [a.zoom];
}

/** Index du niveau de zoom par défaut (celui qui vaut `zoom`, sinon le premier). */
export function niveauZoomDefaut(arme: ArmeFeuId): number {
  const a = STATS[arme];
  const n = niveauxZoom(arme);
  const i = n.findIndex((z) => Math.abs(z - (a.zoom ?? NaN)) < 1e-6);
  return i < 0 ? 0 : i;
}

/** Chaleur après un tir. N'influe plus sur la direction du tir (§13.1) ; conservée pour mémoire. */
export function apresTir(arme: ArmeFeuId, chaleur: number): number {
  const dp = STATS[arme].dispersion;
  return Math.min(dp.max, chaleur + dp.parTir);
}

/**
 * Délai (s) après un tir avant que la chaleur commence à retomber ; sert aussi à `delaiRecul` (le retour de la vue
 * après le recul attend le même délai). Un peu plus que l'intervalle entre deux tirs : pendant une rafale (ou en
 * cliquant à la cadence max.), le recul s'accumule ; en espaçant les tirs, la vue redescend.
 */
export function delaiRefroidissement(arme: ArmeFeuId): number {
  return STATS[arme].cadenceS * 1.25 + 0.04;
}

/** Retour du recul de tangage : part rattrapée par seconde (exponentiel), vitesse minimale (rad/s), délai maximal après un tir (s). */
export const RETOUR_RECUL = { parSeconde: 5, minimum: 0.03, delaiMaxS: 0.2 } as const;

/** Délai (s) après un tir avant que la vue ne redescende du recul : celui de la chaleur, plafonné (le pompe tire toutes les 0,85 s). */
export function delaiRecul(arme: ArmeFeuId): number {
  return Math.min(delaiRefroidissement(arme), RETOUR_RECUL.delaiMaxS);
}

/**
 * Part (rad) du recul de tangage `reculAcc` (soulevé par les tirs, pas encore compensé) que la vue
 * redescend en `dt` secondes, une fois le délai écoulé. Jamais plus que `reculAcc`.
 */
export function retourRecul(reculAcc: number, dt: number): number {
  if (!(reculAcc > 0) || !(dt > 0)) return 0;
  return Math.min(reculAcc, reculAcc * (1 - Math.exp(-RETOUR_RECUL.parSeconde * dt)) + RETOUR_RECUL.minimum * dt);
}

/** Chaleur après `dt` secondes sans tirer (de `max` à 0 en `retourS`). N'influe plus sur la direction du tir (§13.1). */
export function refroidir(arme: ArmeFeuId, chaleur: number, dt: number): number {
  const dp = STATS[arme].dispersion;
  return Math.max(0, chaleur - (dt * dp.max) / dp.retourS);
}

/** Écart toléré (rad) entre la gerbe déclarée par un client et la gerbe fixe de `directionsTir` (§13.1) : les arrondis réseau, pas plus. */
export const TOLERANCE_GERBE_RAD = 0.02;

/**
 * Les directions d'un tir à plusieurs plombs respectent-elles la gerbe FIXE à `tolerance` près ? Le plomb 0 est l'axe de visée ; chaque
 * plomb `i` doit être à moins de `tolerance` rad de `directionsTir(arme, dirs[0])[i]`. Un tir à un plomb (ou une arme à un plomb) est
 * toujours conforme (la visée seule est contrôlée par ailleurs). Plus de plombs que l'arme n'en tire : non conforme.
 */
export function gerbeRespectee(arme: ArmeFeuId, dirs: readonly Vec3[], tolerance: number = TOLERANCE_GERBE_RAD): boolean {
  const { plombs } = STATS[arme];
  if (dirs.length > plombs) return false;
  if (plombs <= 1 || dirs.length <= 1) return true;
  const attendues = directionsTir(arme, dirs[0]);
  for (let i = 1; i < dirs.length; i++) {
    const d = dirs[i], a = attendues[i];
    const n = Math.hypot(d[0], d[1], d[2]) || 1;
    const cos = (d[0] * a[0] + d[1] * a[1] + d[2] * a[2]) / n;
    if (Math.acos(Math.max(-1, Math.min(1, cos))) > tolerance) return false;
  }
  return true;
}

/**
 * Directions normalisées des `plombs` de l'arme pour un tir visant `d` : DÉTERMINISTES, aucun hasard (§13.1).
 * Une arme à un plomb tire pile dans l'axe `d`. Une arme à plusieurs plombs tire la gerbe fixe : le plomb 0 au
 * centre, les `plombs − 1` suivants répartis régulièrement sur un cercle de demi-angle `gerbe`, le premier dans la
 * direction `u` de la base (u, w) perpendiculaire à `d` (u horizontal, perpendiculaire au regard).
 */
export function directionsTir(arme: ArmeFeuId, d: Vec3): Vec3[] {
  const { plombs, gerbe } = STATS[arme];
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  const fx = d[0] / n, fy = d[1] / n, fz = d[2] / n;
  const sorties: Vec3[] = [[fx, fy, fz]];
  if (plombs <= 1) return sorties;
  // base orthonormée (u, w) perpendiculaire à f
  let ux: number, uy: number, uz: number;
  if (Math.abs(fy) > 0.999) { ux = 1; uy = 0; uz = 0; }
  else {
    // u = normalise(f × haut) avec haut = (0, 1, 0)
    const l = Math.hypot(fz, fx);
    ux = fz / l; uy = 0; uz = -fx / l;
  }
  const wx = fy * uz - fz * uy, wy = fz * ux - fx * uz, wz = fx * uy - fy * ux;
  const s = Math.sin(gerbe), c = Math.cos(gerbe);
  const anneau = plombs - 1;
  for (let i = 0; i < anneau; i++) {
    const phi = (2 * Math.PI * i) / anneau;
    const a = s * Math.cos(phi), b = s * Math.sin(phi);
    const x = fx * c + ux * a + wx * b, y = fy * c + uy * a + wy * b, z = fz * c + uz * a + wz * b;
    const l = Math.hypot(x, y, z);
    sorties.push([x / l, y / l, z / l]);
  }
  return sorties;
}
