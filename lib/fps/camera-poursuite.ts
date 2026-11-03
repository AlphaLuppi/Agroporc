/**
 * Caméra de poursuite du conducteur (PUR : ni three ni DOM ; le monde n'est vu que par deux fonctions injectées).
 *
 * Au volant d'une voiture conduisible, la vue passe à la 3ᵉ personne : la caméra se tient derrière la voiture (≈ 6,5 m) et au-dessus
 * (≈ 3 m), le regard un peu plongeant vers un point au-dessus du toit. Elle suit le CAP de la voiture par un ressort critique (léger
 * retard en virage, sans rebond, passage ±π compris) ; quand la voiture glisse fort (dérapage), elle suit plutôt la direction de la
 * vitesse que le nez, fondu sans à-coup ; en marche arrière elle reste derrière le coffre (aucun demi-tour). Recul et champ
 * s'élargissent un peu avec la vitesse. La souris fait tourner la caméra autour de la voiture (regard libre) ; après `retourS` sans
 * mouvement de souris, si la voiture roule, elle revient d'elle-même derrière. Un mur entre la voiture et la caméra la rapproche
 * aussitôt (elle s'éloigne ensuite doucement) ; elle ne passe jamais sous le sol.
 *
 * Convention des angles : celle du jeu (lacet 0 = regard vers −z, avant = (−sin, −cos) ; tangage < 0 = regard vers le bas).
 */
import type { Vec3 } from "./protocole";

export const POURSUITE = {
  /** recul (m) à l'arrêt, et en plus à la vitesse maximale */
  recul: 6.5,
  reculVitesse: 1.4,
  /**
   * point visé : au-dessus du centre de la voiture (m), sous le toit (1,5 m) : la voiture est cadrée un peu au-dessus du bas de l'écran,
   * hors du panneau du véhicule
   */
  hauteurVisee: 1.2,
  /** hauteur de la caméra au-dessus du point visé, à l'arrêt (m) : caméra ≈ 2,9 m au-dessus du sol */
  hauteur: 1.7,
  /** vitesse (m/s) à laquelle recul et champ sont au maximum (vitesse maximale d'une voiture) */
  vitesseRef: 24,
  /** champ horizontal ajouté à pleine vitesse (degrés) */
  champVitesse: 8,
  /** pulsation (rad/s) du ressort critique qui suit le cap ; × `facteurReduit` avec prefers-reduced-motion (moins de balancement) */
  pulsation: 4.2,
  facteurReduit: 1.8,
  /** dérapage : part de la vitesse latérale dans la vitesse (|vl| / (|v| + |vl|)) au-delà de laquelle la caméra suit la vitesse */
  glisseDebut: 0.12,
  glissePleine: 0.4,
  /** vitesse (m/s) sous laquelle la direction de la vitesse ne compte pas (à l'arrêt, elle n'a pas de sens) */
  glisseVitesseMin: 3,
  /** regard libre : délai (s) sans souris avant le retour derrière la voiture, pulsation du retour, vitesse minimale de la voiture (m/s) */
  retourS: 1.2,
  pulsationRetour: 2.6,
  vitesseRetour: 1.5,
  /** élévation de l'orbite (rad) : bornes de ce que la souris peut atteindre */
  elevationMin: -0.12,
  elevationMax: 1.15,
  /**
   * collision : marge devant le mur (m), distance minimale souhaitée à la voiture, vitesse (m/s) à laquelle la caméra se réécarte. Un mur
   * plus proche que `distanceMin` fait monter la caméra (élévations de `elevationsRepli`, jusqu'à presque à la verticale de la voiture) ;
   * si aucune ne dégage `distanceMin`, elle se pose devant l'obstacle le plus lointain, plus près s'il le faut : jamais dans le mur.
   */
  margeMur: 0.35,
  distanceMin: 1.4,
  elevationsRepli: [0.75, 1.05, 1.35],
  vitesseReecart: 5,
  /** hauteur minimale de la caméra au-dessus du sol (m) */
  hauteurSol: 0.6,
  /** pas maximal du ressort (s) : un dt d'image long est découpé */
  pas: 1 / 120,
} as const;

/** État lissé de la caméra, d'une image à l'autre. */
export interface EtatPoursuite {
  /** lacet suivi (rad, enroulé), sans le regard libre */
  lacet: number;
  /** vitesse angulaire du ressort (rad/s) */
  vLacet: number;
  /** regard libre : décalage de lacet (rad, enroulé) et d'élévation (rad, + = caméra plus haute) donnés par la souris */
  orbite: number;
  elevation: number;
  /** temps (s) depuis le dernier mouvement de souris */
  sansSouris: number;
  /** distance actuelle à la voiture (m), raccourcie par les murs */
  distance: number;
  /** vitesse lissée (m/s, valeur absolue) pour le recul et le champ */
  vitesse: number;
}

/** Ce que la caméra voit de la voiture : position (sol), cap, vitesse signée le long du cap, vitesse latérale (+ = droite). */
export interface VoiturePoursuivie { p: Vec3; cap: number; v: number; vl?: number }

/** Le monde, injecté : distance du premier obstacle sur un rayon (Infinity sans obstacle) et hauteur du sol sous un point. */
export interface MondePoursuite {
  rayon(o: Vec3, d: Vec3, max: number): number;
  sol?(x: number, z: number, y: number): number;
}

export interface OptionsPoursuite {
  /** prefers-reduced-motion : ressort plus raide, pas de suivi de la glissade, champ fixe */
  reduit?: boolean;
}

/** Pose de la caméra : position, lacet, tangage (radians) et champ horizontal à ajouter (degrés). */
export interface PoseCamera { pos: Vec3; lacet: number; tangage: number; champ: number }

const DEUX_PI = Math.PI * 2;
/** Angle ramené dans ]−π, π]. */
export function enrouler(a: number): number {
  const r = ((a + Math.PI) % DEUX_PI + DEUX_PI) % DEUX_PI - Math.PI;
  return r === -Math.PI ? Math.PI : r;
}
/** Plus court écart signé de `a` vers `b` (rad). */
export function ecartAngle(a: number, b: number): number {
  return enrouler(b - a);
}
const borne = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lisse01 = (x: number) => { const k = borne(x, 0, 1); return k * k * (3 - 2 * k); };

/** Élévation de repos de l'orbite : la caméra à `hauteur` au-dessus du point visé, `recul` derrière. */
export const ELEVATION_REPOS = Math.atan2(POURSUITE.hauteur, POURSUITE.recul);

/** État de départ : derrière la voiture, sans regard libre, à la distance de repos. */
export function creerPoursuite(v: VoiturePoursuivie): EtatPoursuite {
  return { lacet: enrouler(v.cap), vLacet: 0, orbite: 0, elevation: 0, sansSouris: Infinity, distance: distanceRepos(Math.abs(v.v)), vitesse: Math.abs(v.v) };
}

function distanceRepos(vitesse: number): number {
  return Math.hypot(POURSUITE.recul, POURSUITE.hauteur) + POURSUITE.reculVitesse * borne(vitesse / POURSUITE.vitesseRef, 0, 1);
}

/**
 * Direction que la caméra cherche à suivre : le cap, sauf en glissade vers l'avant où elle tire vers la direction de la vitesse
 * (fondu progressif selon la part de glissade). En marche arrière : le cap, toujours (la caméra reste derrière le coffre).
 */
export function lacetCible(v: VoiturePoursuivie, reduit = false): number {
  const cap = enrouler(v.cap);
  const vl = v.vl ?? 0;
  if (reduit || v.v <= 0 || vl === 0) return cap;
  const vitesse = Math.hypot(v.v, vl);
  if (vitesse < POURSUITE.glisseVitesseMin) return cap;
  const part = Math.abs(vl) / (Math.abs(v.v) + Math.abs(vl));
  // pondéré aussi par la vitesse AVANT : nul quand elle s'annule, la cible ne bascule donc jamais du flanc au nez d'une image à l'autre
  // (frein à main en virage : la caisse glisse de travers et `v` oscille autour de 0)
  const w = lisse01((part - POURSUITE.glisseDebut) / (POURSUITE.glissePleine - POURSUITE.glisseDebut))
    * lisse01((vitesse - POURSUITE.glisseVitesseMin) / POURSUITE.glisseVitesseMin)
    * lisse01(v.v / POURSUITE.glisseVitesseMin);
  if (w <= 0) return cap;
  // vitesse du monde : avant × v + droite × vl ; avant = (−sin, −cos), droite = (cos, −sin)
  const s = Math.sin(cap), c = Math.cos(cap);
  const vx = -s * v.v + c * vl, vz = -c * v.v - s * vl;
  const cap2 = Math.atan2(-vx, -vz);
  return enrouler(cap + ecartAngle(cap, cap2) * w);
}

/** Regard libre à la souris (radians, déjà multipliés par la sensibilité) : + dLacet = vers la gauche, + dTangage = vers le haut. */
export function tournerPoursuite(e: EtatPoursuite, dLacet: number, dTangage: number): EtatPoursuite {
  const elevationRepos = ELEVATION_REPOS;
  // regarder vers le haut = la caméra descend sur l'orbite
  const elevation = borne(e.elevation - dTangage, POURSUITE.elevationMin - elevationRepos, POURSUITE.elevationMax - elevationRepos);
  return { ...e, orbite: enrouler(e.orbite + dLacet), elevation, sansSouris: 0 };
}

/**
 * Avance la caméra de `dt` secondes et rend sa pose. Ressort critique sur le lacet (sous-pas de `POURSUITE.pas`), retour du regard libre,
 * distance raccourcie par les obstacles entre le point visé et la caméra, sol jamais traversé.
 */
export function avancerPoursuite(
  e: EtatPoursuite, v: VoiturePoursuivie, dt: number, monde: MondePoursuite, opts: OptionsPoursuite = {},
): { etat: EtatPoursuite; pose: PoseCamera } {
  const reduit = !!opts.reduit;
  const h = Math.max(0, Math.min(dt, 0.25));
  const cible = lacetCible(v, reduit);
  const w = POURSUITE.pulsation * (reduit ? POURSUITE.facteurReduit : 1);
  let lacet = e.lacet, vl = e.vLacet;
  let reste = h;
  while (reste > 1e-9) {
    const p = Math.min(reste, POURSUITE.pas);
    // ressort critique (amortissement 2ω, semi-implicite) sur l'écart enroulé : jamais de tour complet au passage ±π
    const acc = w * w * ecartAngle(lacet, cible) - 2 * w * vl;
    vl += acc * p;
    lacet = enrouler(lacet + vl * p);
    reste -= p;
  }
  // regard libre : il revient derrière la voiture après `retourS` sans souris, si elle roule
  const sansSouris = e.sansSouris + h;
  let orbite = e.orbite, elevation = e.elevation;
  const vitesseAbs = Math.hypot(v.v, v.vl ?? 0);
  if (sansSouris >= POURSUITE.retourS && vitesseAbs >= POURSUITE.vitesseRetour) {
    const k = 1 - Math.exp(-POURSUITE.pulsationRetour * h);
    orbite = enrouler(orbite - orbite * k);
    elevation -= elevation * k;
    if (Math.abs(orbite) < 1e-4) orbite = 0;
    if (Math.abs(elevation) < 1e-4) elevation = 0;
  }
  const vitesse = e.vitesse + (vitesseAbs - e.vitesse) * (1 - Math.exp(-2 * h));

  // position voulue sur l'orbite autour du point visé
  const yaw = enrouler(lacet + orbite);
  const elev0 = borne(ELEVATION_REPOS + elevation, POURSUITE.elevationMin, POURSUITE.elevationMax);
  const pivot: Vec3 = [v.p[0], v.p[1] + POURSUITE.hauteurVisee, v.p[2]];
  // vers l'arrière de la caméra (opposé du regard horizontal) puis vers le haut
  const dirDe = (el: number): Vec3 => [Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)];
  const voulue = distanceRepos(reduit ? 0 : vitesse);
  let dir = dirDe(elev0);
  let obstacle = monde.rayon(pivot, dir, voulue + POURSUITE.margeMur);
  if (obstacle - POURSUITE.margeMur < POURSUITE.distanceMin) {
    // mur collé derrière : la caméra monte au-dessus de la voiture plutôt que d'entrer dans le mur ; sinon la direction la plus dégagée
    for (const el of POURSUITE.elevationsRepli) {
      if (el <= elev0) continue;
      const d = dirDe(el);
      const o = monde.rayon(pivot, d, voulue + POURSUITE.margeMur);
      if (o > obstacle) { dir = d; obstacle = o; }
      if (obstacle - POURSUITE.margeMur >= POURSUITE.distanceMin) break;
    }
  }
  // jamais dans l'obstacle : au pire à mi-chemin du pivot et de lui (10 cm au plus)
  const libre = Math.min(voulue, Math.max(obstacle - POURSUITE.margeMur, Math.min(POURSUITE.distanceMin, obstacle * 0.5, 0.1)));
  // un mur rapproche aussitôt ; la caméra se réécarte doucement
  const distance = libre < e.distance || !Number.isFinite(e.distance) ? libre : Math.min(libre, e.distance + POURSUITE.vitesseReecart * h);
  const pos: Vec3 = [pivot[0] + dir[0] * distance, pivot[1] + dir[1] * distance, pivot[2] + dir[2] * distance];
  const sol = monde.sol ? monde.sol(pos[0], pos[2], pos[1]) : 0;
  const plancher = Math.max(sol, v.p[1]) + POURSUITE.hauteurSol;
  if (pos[1] < plancher) pos[1] = plancher;
  // regard vers le point visé
  const dx = pivot[0] - pos[0], dy = pivot[1] - pos[1], dz = pivot[2] - pos[2];
  const horiz = Math.hypot(dx, dz);
  const lacetCam = horiz > 1e-6 ? Math.atan2(-dx, -dz) : yaw;
  const tangage = Math.atan2(dy, Math.max(horiz, 1e-6));
  const champ = reduit ? 0 : POURSUITE.champVitesse * lisse01(vitesse / POURSUITE.vitesseRef);
  return {
    etat: { lacet, vLacet: vl, orbite, elevation, sansSouris, distance, vitesse },
    pose: { pos, lacet: lacetCam, tangage, champ },
  };
}

/** Transition entre deux poses (montée, descente, changement de place) : `k` de 0 à 1, adouci, lacet par le plus court chemin. */
export function melangerPoses(a: PoseCamera, b: PoseCamera, k: number): PoseCamera {
  const s = lisse01(k);
  return {
    pos: [a.pos[0] + (b.pos[0] - a.pos[0]) * s, a.pos[1] + (b.pos[1] - a.pos[1]) * s, a.pos[2] + (b.pos[2] - a.pos[2]) * s],
    lacet: enrouler(a.lacet + ecartAngle(a.lacet, b.lacet) * s),
    tangage: a.tangage + (b.tangage - a.tangage) * s,
    champ: a.champ + (b.champ - a.champ) * s,
  };
}

/** Durée (s) de la transition entre la 1ʳᵉ personne et la caméra de poursuite. */
export const DUREE_TRANSITION_S = 0.45;
