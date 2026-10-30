/**
 * Zombies : « Patrouille de police » (2026-10-30), règles PURES (ni horloge ni hasard global : le hasard et l'instant sont injectés). Pure ambiance, rare,
 * sans voiture jouable : les murs des bâtiments creusés font 40 m de haut, une voiture hors carte serait invisible. Le joueur ENTEND la sirène
 * (`sirene-police.mp3`, le son original du joueur) traverser la carte sur la route de service et voit une lueur bleu / rouge à peine perceptible sur le
 * brouillard et les murs intérieurs. Le serveur (`match-zombies.ts`, section « patrouille ») décide QUAND et OÙ, le client (`jeu.ts`) en tire la position
 * de la sirène et la lueur à l'horloge serveur : elle est figée pendant une suspension de la partie, la sirène et la lueur la suivent d'elles-mêmes.
 * Spec : docs/superpowers/specs/2026-10-30-arene-police-evenements-design.md (§6)
 */
import type { Boite } from "./collision";
import type { Vec3 } from "./protocole";

export const PATROUILLE = {
  /** première manche où une patrouille peut passer */
  mancheMin: 3,
  /** au plus par partie */
  max: 2,
  /** délai (ms) entre la fin d'une patrouille et la suivante : tiré dans cette plage */
  entreMinMs: 240_000,
  entreMaxMs: 420_000,
  /** délai (ms) entre le début de la première manche éligible et la première patrouille (aussi le report d'une patrouille échue en pause) */
  premierDelaiMs: 45_000,
  /** vitesse de la voiture (m/s) : de quoi traverser la carte en 12 à 17 s, la sirène (9,8 s) boucle une fois */
  vitesse: 20,
  /** écart (m) entre la route et le bord de la carte, en dehors */
  ecartM: 40,
  /** la voiture déborde de la carte de cette longueur (m) de chaque côté : elle naît et disparaît hors de portée d'oreille */
  debordM: 60,
  /** la lueur n'existe qu'à moins de cette distance (m) de la voiture */
  distanceLueurM: 90,
  /** intensité maximale de la lueur (0..1) : jamais un éclat, le bloom saturerait tout l'écran */
  lueurMax: 0.12,
  /** alternances bleu / rouge par seconde (jamais plus de 3 par seconde, seuil d'innocuité des flashs) */
  alternancesParS: 3,
  /** pas de patrouille tant qu'un éclair d'orage a frappé depuis moins de ce délai (ms) */
  calmeEclairMs: 20_000,
} as const;

/** Trajet tiré par le serveur : points de départ et d'arrivée, durée. */
export interface TracePatrouille { p0: Vec3; p1: Vec3; dureeMs: number }
/** Trajet daté (message `zevt{patrouille}`, instants serveur). */
export interface PlanPatrouille { p0: Vec3; p1: Vec3; t0: number; finT: number }

/**
 * Segment parallèle à un bord de la carte, à `ecartM` en dehors, plus long de `2 × debordM` que ce bord, dans un sens au hasard. Trois tirages
 * de `alea` exactement (bord, sens), dans cet ordre.
 */
export function planPatrouille(bornes: Boite, alea: () => number): TracePatrouille {
  const bord = Math.min(3, Math.floor(alea() * 4));
  const inverse = alea() < 0.5;
  const e = PATROUILLE.ecartM, d = PATROUILLE.debordM;
  let a: Vec3, b: Vec3;
  if (bord < 2) {
    // bords nord (z0) et sud (z1) : on roule le long de x
    const z = bord === 0 ? bornes.z0 - e : bornes.z1 + e;
    a = [bornes.x0 - d, 0, z]; b = [bornes.x1 + d, 0, z];
  } else {
    // bords ouest (x0) et est (x1) : on roule le long de z
    const x = bord === 2 ? bornes.x0 - e : bornes.x1 + e;
    a = [x, 0, bornes.z0 - d]; b = [x, 0, bornes.z1 + d];
  }
  const [p0, p1] = inverse ? [b, a] : [a, b];
  const longueur = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  return { p0, p1, dureeMs: Math.round((longueur / PATROUILLE.vitesse) * 1000) };
}

/** Position de la voiture à l'instant serveur `t` (ms) ; null avant le départ et après l'arrivée. */
export function positionPatrouille(plan: PlanPatrouille, t: number): Vec3 | null {
  if (!(t >= plan.t0) || t > plan.finT || plan.finT <= plan.t0) return null;
  const k = (t - plan.t0) / (plan.finT - plan.t0);
  return [plan.p0[0] + (plan.p1[0] - plan.p0[0]) * k, plan.p0[1] + (plan.p1[1] - plan.p0[1]) * k, plan.p0[2] + (plan.p1[2] - plan.p0[2]) * k];
}

/**
 * Vitesse de la voiture projetée sur la droite qui la joint à l'écouteur `camera` (m/s, positive quand elle s'éloigne) : le décalage Doppler de la
 * sirène. 0 hors trajet.
 */
export function vitesseRadialePatrouille(plan: PlanPatrouille, camera: Vec3, t: number): number {
  const p = positionPatrouille(plan, t);
  if (!p) return 0;
  const duree = (plan.finT - plan.t0) / 1000;
  const vx = (plan.p1[0] - plan.p0[0]) / duree, vz = (plan.p1[2] - plan.p0[2]) / duree;
  const dx = p[0] - camera[0], dz = p[2] - camera[2];
  const dist = Math.max(Math.hypot(dx, dz), 1);
  return (vx * dx + vz * dz) / dist;
}

/**
 * Lueur de la voiture sur la scène : `bleu` et `rouge` dans [0, `lueurMax`], l'un puis l'autre `alternancesParS` fois par seconde (chaque couleur
 * ne clignote donc qu'à la moitié de cette cadence), nulle au-delà de `distanceLueurM`, décroissante avec la distance.
 */
export function lueurPatrouille(distance: number, tS: number): { bleu: number; rouge: number } {
  if (!(distance >= 0) || distance >= PATROUILLE.distanceLueurM) return { bleu: 0, rouge: 0 };
  const proche = 1 - distance / PATROUILLE.distanceLueurM;
  const phase = tS * PATROUILLE.alternancesParS;
  const alternance = Math.floor(phase);
  // enveloppe douce dans chaque alternance : pas de front brutal
  const env = Math.sin(Math.PI * (phase - alternance)) ** 2;
  const v = PATROUILLE.lueurMax * proche * proche * env;
  return alternance % 2 === 0 ? { bleu: v, rouge: 0 } : { bleu: 0, rouge: v };
}

/** Décalage [r, g, b] (0..1) que la lueur ajoute à la couleur du brouillard et du fond. */
export function teinteLueur(lueur: { bleu: number; rouge: number }): [number, number, number] {
  return [lueur.rouge * 0.9, lueur.rouge * 0.1 + lueur.bleu * 0.25, lueur.bleu * 0.9];
}

/** Ce que le serveur sait au moment de décider d'une patrouille. */
export interface EtatPatrouille {
  phase: "lobby" | "pause" | "manche" | "fin";
  manche: number;
  /** manche de livraison du Truck Muche (annonce comprise : l'indicateur est levé dès l'entrée en pause qui la précède) */
  mancheTruck: boolean;
  /** instant serveur (virtuel) */
  t: number;
  /** instant du dernier `zevt{eclair}` (-Infinity si aucun) */
  dernierEclairT: number;
  /** patrouilles déjà lancées dans cette partie */
  lancees: number;
  /** instant armé de la prochaine (null : pas encore armée) */
  prochaineT: number | null;
  /** fin de la patrouille précédente (0 si aucune) : jamais deux à la fois */
  finT: number;
  /** réglages (essais) */
  mancheMin?: number;
  max?: number;
}

/** Une patrouille peut-elle partir maintenant ? Seulement en manche, jamais en manche du Truck, ni juste après un éclair, ni deux à la fois. */
export function patrouillePermise(e: EtatPatrouille): boolean {
  if (e.phase !== "manche" || e.mancheTruck) return false;
  if (e.manche < (e.mancheMin ?? PATROUILLE.mancheMin)) return false;
  if (e.lancees >= (e.max ?? PATROUILLE.max)) return false;
  if (e.prochaineT === null || e.t < e.prochaineT) return false;
  if (e.t < e.finT) return false;
  return !(e.t - e.dernierEclairT < PATROUILLE.calmeEclairMs);
}

/** Délai (ms) avant la patrouille suivante, tiré dans `[entreMinMs, entreMaxMs]`. */
export function delaiEntrePatrouilles(alea: () => number): number {
  return Math.round(PATROUILLE.entreMinMs + alea() * (PATROUILLE.entreMaxMs - PATROUILLE.entreMinMs));
}

/** Générateur congruentiel semé (ms) : le service des zombies a le sien, le hasard de la salle n'est jamais consommé (bonus, boîtes, apparitions). */
export function aleaPatrouille(graine: number): () => number {
  let s = (Math.floor(Math.abs(graine)) % 2147483647) || 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}
