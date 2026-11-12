/**
 * Rocket Muche : caméra de Rocket League (PURE : aucun three, aucune horloge, le temps vient des arguments).
 *
 * - **Car cam** : la caméra se tient derrière la voiture, la direction de visée suit l'avant (sur un mur ou au plafond le « haut » de la
 *   caméra suit la normale de la surface, lissé ; en l'air, le haut est celui du monde et 70 % du tangage du nez est suivi).
 * - **Ball cam** (comme Rocket League) : la caméra se place sur la ligne balle → voiture, derrière la voiture, et REGARDE LA BALLE.
 *   Le suivi est rigide (elle ne traîne pas derrière la balle), l'horizon reste toujours droit (haut du monde, même sur un mur), la
 *   visée monte autant qu'il faut pour une balle haute (la balle passe avant la voiture, cf. `elevationViseeBalle`), la caméra descend
 *   derrière la voiture jusqu'au ras du sol, et une balle collée à la voiture ne fait pas basculer la vue.
 * - Passage de l'une à l'autre : `melange` 0 → 1 lissé à `vitesseTransition`, la direction PIVOTE de l'une vers l'autre.
 * - **Regard libre** (stick droit / souris bouton du milieu) : la caméra tourne autour de la voiture, ±90° de lacet, ±45° de tangage,
 *   revient au centre au relâchement ; **vue arrière** : demi-tour complet autour de la voiture (la ball cam est suspendue).
 * - **Anticollision** : la caméra ne sort jamais de l'arène ni ne reste à moins de 0,4 m d'une surface : on la rapproche de la voiture
 *   le long du rayon (si le chemin est coupé, elle se rapproche aussitôt, puis ne se réécarte que doucement). Plafond : ≥ 0,5 m dessous.
 * - **Secousse** décroissante (touches de balle fortes, démolitions, buts), ignorée en mouvement réduit.
 * - **Célébration** d'un but : orbite lente autour de la balle puis du marqueur (`majCameraBut`).
 *
 * Le repère est celui du stade (local). Le champ est HORIZONTAL (110° par défaut, comme RL) et converti en vertical selon l'aspect.
 * Les états de lissage supplémentaires (anticollision, phase de la secousse, entrée en célébration) sont gardés à part de `EtatCamera`
 * (contrat figé) dans une `WeakMap` : l'état se copie ou s'abandonne sans fuite.
 *
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md § 8.3
 */
import {
  CAMERA_DEFAUT,
  STADE,
  type Arene,
  type EntreesCamera,
  type EtatBalle,
  type EtatCamera,
  type EtatVoiture,
  type MajCamera,
  type ParamsCamera,
  type PoseCamera,
  type CreerEtatCamera,
} from "./contrat";
import {
  HAUT_MONDE,
  ajouter,
  clamp,
  croix,
  distance,
  dot,
  melanger,
  mult,
  normaliser,
  soustraire,
  tournerVec,
  type Vec3,
} from "./vec";

const D2R = Math.PI / 180;

/** Distance minimale entre la caméra et une surface du stade (m). */
export const MARGE_CAMERA_M = 0.4;
/** Marge sous le plafond (m). */
export const MARGE_PLAFOND_M = 0.5;
/** Car cam : élévation maximale de la visée. */
const ELEVATION_VISEE_MAX = 16 * D2R;
/** Ball cam : la visée monte (ou descend) jusque-là pour garder la balle à l'écran. */
const ELEVATION_BALLE_MAX = 78 * D2R;
/** Ball cam : marges angulaires gardées entre la voiture et le bas de l'image, entre la balle et le haut de l'image. */
const MARGE_VOITURE = 7 * D2R;
const MARGE_BALLE = 11 * D2R;
/** Ball cam : la caméra ne descend pas plus bas que cela derrière la voiture (m au-dessus du sol). */
const GARDE_SOL_M = 0.5;
/** Vitesses de suivi (1/s) de la direction : ball cam établie (quasi rigide), bascule d'un mode à l'autre. */
const SUIVI_BALLE = 32;
const SUIVI_BASCULE = 9;
/** Vitesse de rotation maximale (rad/s) du cap de la ball cam quand la balle est à la verticale de la voiture. */
const VITESSE_CAP_PROCHE = 4;
/** … et dans tous les cas : un demi-tour autour de la voiture prend au moins un tiers de seconde. */
const VITESSE_CAP_MAX = 10;
const normaliser2 = (x: number, z: number): [number, number] => { const n = Math.hypot(x, z); return n > 1e-9 ? [x / n, z / n] : [0, 1]; };
const ELEVATION_VISEE_MIN = -60 * D2R;
/** Élévation (par rapport au haut de la caméra) de la ligne qui place la caméra derrière la voiture : pas sous le sol, pas au zénith. */
const ELEVATION_POSITION_MIN = -60 * D2R;
const ELEVATION_POSITION_MAX = 20 * D2R;
/** Part du tangage du nez suivie par la car cam en l'air. */
const SUIVI_TANGAGE_AIR = 0.7;
/** Hauteur de la cible devant la voiture (m) et point d'ancrage de l'anticollision au-dessus de l'origine (m). */
const HAUTEUR_CIBLE_M = 0.3;
const HAUTEUR_ANCRE_M = 0.3;

/** `fovVertical = 2·atan(tan(fov_h / 2) / aspect)` (degrés → degrés). */
export function fovVerticalDepuisHorizontal(fovHorizontal: number, aspect: number): number {
  const a = aspect > 0.01 ? aspect : 1;
  return (2 * Math.atan(Math.tan((fovHorizontal * D2R) / 2) / a)) / D2R;
}

const lisse = (x: number): number => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const lisseEntre = (a: number, b: number, x: number): number => lisse((x - a) / (b - a));

// ============================================================================================================================
// États annexes (hors contrat)
// ============================================================================================================================

interface Annexes {
  /** part de l'écart caméra-ancre conservée par l'anticollision, lissée (1 = distance complète) */
  reduction: number;
  /** phase de la secousse (rad), avancée par le temps */
  phase: number;
  /** dernière pose rendue par `majCamera` : point de départ du fondu vers la célébration */
  dernierePose: PoseCamera | null;
  /** entrée en célébration : pose de départ du fondu, azimut de départ de l'orbite, temps écoulé depuis l'entrée */
  but: { depart: PoseCamera; azimut: number; t: number } | null;
  /** cap horizontal [x, z] (unitaire) et élévation (rad) de la droite voiture → balle suivis par la ball cam (null avant la première image) */
  capBalle: [number, number] | null;
  elBalle: number;
}
const annexes = new WeakMap<EtatCamera, Annexes>();
function annexesDe(e: EtatCamera): Annexes {
  let a = annexes.get(e);
  if (!a) { a = { reduction: 1, phase: 0, dernierePose: null, but: null, capBalle: null, elBalle: 0 }; annexes.set(e, a); }
  return a;
}

// ============================================================================================================================
// Maths de visée
// ============================================================================================================================

/** Haut de la caméra voulu : normale de la surface sous la voiture si elle roule, haut du monde en l'air. */
function hautVoulu(moi: Readonly<EtatVoiture>): Vec3 {
  return moi.auSol && moi.normaleSurface ? normaliser(moi.normaleSurface, HAUT_MONDE) : [0, 1, 0];
}

/** Avant de la voiture projeté sur le plan perpendiculaire à `haut`, en gardant `k` de sa composante verticale. */
function dirVoiture(avant: Readonly<Vec3>, haut: Readonly<Vec3>, k: number, repli: Readonly<Vec3>): Vec3 {
  const s = dot(avant, haut);
  const v: Vec3 = [avant[0] - haut[0] * s * (1 - k), avant[1] - haut[1] * s * (1 - k), avant[2] - haut[2] * s * (1 - k)];
  return normaliser(v, repli);
}

/** Ramène l'élévation de `d` (angle avec le plan perpendiculaire à `h`) dans [min, max]. */
function borneElevation(d: Readonly<Vec3>, h: Readonly<Vec3>, min: number, max: number): Vec3 {
  const s = clamp(dot(d, h), -1, 1);
  const el = Math.asin(s);
  if (el >= min && el <= max) return [d[0], d[1], d[2]];
  const hor = normaliser([d[0] - h[0] * s, d[1] - h[1] * s, d[2] - h[2] * s], croix(h, [1, 0, 0]));
  const c = clamp(el, min, max);
  const cc = Math.cos(c), sc = Math.sin(c);
  return [hor[0] * cc + h[0] * sc, hor[1] * cc + h[1] * sc, hor[2] * cc + h[2] * sc];
}

/** Rotation d'un angle de lacet `lacet` (rad, positif = vers la droite) puis de tangage `tangage` (positif = vers le haut) autour de la voiture. */
function tournerRegard(d: Readonly<Vec3>, haut: Readonly<Vec3>, lacet: number, tangage: number): Vec3 {
  // tourner à droite = rotation NÉGATIVE autour du haut (convention du contrat : positif autour de `haut` = vers la gauche)
  const yaw = Math.abs(lacet) > 1e-6 ? tournerVec(d, haut, -lacet) : [d[0], d[1], d[2]] as Vec3;
  if (Math.abs(tangage) < 1e-6) return yaw;
  const droite = normaliser(croix(yaw, haut), croix(haut, [1, 0, 0]));
  return tournerVec(yaw, droite, tangage);
}

/**
 * Plus grande fraction t ∈ [0, 1] du segment `ancre → ideal` dont tous les points sont à plus de `seuil` du décor
 * (échantillonnage grossier puis dichotomie). 1 si tout le segment est dégagé, 0 si la caméra ne peut même pas quitter l'ancre.
 */
function fractionDegagee(arene: Arene, ancre: Readonly<Vec3>, ideal: Readonly<Vec3>, seuil: number): number {
  const N = 14;
  const p: Vec3 = [0, 0, 0];
  const ok = (t: number): boolean => {
    p[0] = ancre[0] + (ideal[0] - ancre[0]) * t; p[1] = ancre[1] + (ideal[1] - ancre[1]) * t; p[2] = ancre[2] + (ideal[2] - ancre[2]) * t;
    return arene.sd(p) >= seuil;
  };
  let bon = 0;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    if (ok(t)) { bon = t; continue; }
    let lo = bon, hi = t;
    for (let k = 0; k < 6; k++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
    return lo;
  }
  return 1;
}

/** Seuil d'anticollision effectivement exigé : 0,4 m, moins si l'ancre elle-même est déjà plus près d'un mur (voiture collée au mur). */
function seuilDe(arene: Arene, ancre: Readonly<Vec3>): number {
  return Math.min(MARGE_CAMERA_M, Math.max(arene.sd(ancre) - 0.02, 0.05));
}

/** Position de la caméra derrière `moi` pour la direction `dir` : distance, hauteur, plafond. */
function positionIdeale(moi: Readonly<EtatVoiture>, dirPos: Readonly<Vec3>, haut: Readonly<Vec3>, p: Readonly<ParamsCamera>): Vec3 {
  const pos: Vec3 = [
    moi.p[0] - dirPos[0] * p.distance + haut[0] * p.hauteur,
    moi.p[1] - dirPos[1] * p.distance + haut[1] * p.hauteur,
    moi.p[2] - dirPos[2] * p.distance + haut[2] * p.hauteur,
  ];
  pos[1] = Math.min(pos[1], STADE.hauteur - MARGE_PLAFOND_M);
  return pos;
}

// ============================================================================================================================
// API
// ============================================================================================================================

/** État initial : caméra déjà à sa place (pas de balayage au premier affichage). Aucune anticollision ici : `majCamera` s'en charge. */
export const creerEtatCamera: CreerEtatCamera = (moi, balle, balleCam) => {
  const haut = hautVoulu(moi);
  const dirCar = dirVoiture(moi.base.avant, haut, moi.auSol ? 0 : SUIVI_TANGAGE_AIR, moi.base.avant);
  const dir = balleCam ? normaliser(soustraire(balle.p, moi.p), dirCar) : dirCar;
  const dirPos = borneElevation(dir, haut, ELEVATION_POSITION_MIN, ELEVATION_POSITION_MAX);
  const e: EtatCamera = {
    dir, haut, melange: balleCam ? 1 : 0, regard: [0, 0], secousse: 0,
    position: positionIdeale(moi, dirPos, haut, CAMERA_DEFAUT),
  };
  annexesDe(e);
  return e;
};

/** Ajoute une secousse (m) : la plus forte en cours l'emporte. Sans effet en mouvement réduit (`majCamera` la remet à zéro). */
export function ajouterSecousse(e: EtatCamera, metres: number): void {
  if (metres > e.secousse) e.secousse = Math.min(metres, 0.35);
}

/** Décalage de secousse déterministe (sinusoïdes incommensurables sur la phase), pas de hasard. */
function decalageSecousse(a: Annexes, amplitude: number): Vec3 {
  if (amplitude < 1e-4) return [0, 0, 0];
  const f = a.phase;
  return [Math.sin(f * 1.73) * amplitude, Math.sin(f * 2.31 + 1.1) * amplitude, Math.sin(f * 1.17 + 2.3) * amplitude];
}

/** Tourne `d` vers `cible` d'une fraction de l'angle qui les sépare (jamais de passage par zéro, même s'ils sont opposés). */
function tournerVers(d: Readonly<Vec3>, cible: Readonly<Vec3>, fraction: number, axeRepli: Readonly<Vec3>): Vec3 {
  const c = clamp(dot(d, cible), -1, 1);
  const angle = Math.acos(c);
  if (angle < 1e-5 || fraction >= 1) return [cible[0], cible[1], cible[2]];
  const axe = normaliser(croix(d, cible), axeRepli);
  return normaliser(tournerVec(d, axe, angle * fraction), cible);
}

/** Élévation (rad) de `d` au-dessus du plan perpendiculaire à `h`. */
const elevation = (d: Readonly<Vec3>, h: Readonly<Vec3>): number => Math.asin(clamp(dot(d, h), -1, 1));

/**
 * Élévation de la visée en ball cam (PURE, testée) : on regarde la balle (`elBalle`, plus l'angle de caméra qui s'efface quand la
 * balle monte) tant que la voiture reste à l'écran ; sinon on baisse la visée juste assez pour garder la voiture en bas de l'image,
 * sans jamais laisser la balle sortir par le haut : la balle passe avant la voiture.
 */
export function elevationViseeBalle(elBalle: number, elVoiture: number, demiChampV: number, angle: number): number {
  const e0 = elBalle + angle * (1 - lisseEntre(10 * D2R, 40 * D2R, Math.abs(elBalle)));
  const limiteVoiture = elVoiture + demiChampV - MARGE_VOITURE;
  const e = e0 <= limiteVoiture ? e0 : Math.max(limiteVoiture, elBalle - (demiChampV - MARGE_BALLE));
  return clamp(e, -ELEVATION_BALLE_MAX, ELEVATION_BALLE_MAX);
}

/**
 * Une image de caméra. `dt` est le temps réel de l'image (s) ; `moi` et `balle` sont les états à afficher (le jeu passe l'état
 * INTERPOLÉ entre deux pas physiques, sinon la caméra tremble par rapport à la voiture dessinée).
 */
export const majCamera: MajCamera = (e, p, entree: EntreesCamera, moi, balle, arene, dtBrut, aspect, mouvementReduit) => {
  const a = annexesDe(e);
  a.but = null;
  const dt = clamp(Number.isFinite(dtBrut) ? dtBrut : 0, 0, 0.1);
  const rig = clamp(p.rigidite, 0, 1);
  const fovV = fovVerticalDepuisHorizontal(p.fov, aspect);

  // 1. car cam ↔ ball cam
  const balleVoulue = entree.balleCam && !entree.arriere;
  const vitesse = clamp(p.vitesseTransition, 0.5, 4) * 2.5;
  e.melange = clamp(e.melange + clamp((balleVoulue ? 1 : 0) - e.melange, -vitesse * dt, vitesse * dt), 0, 1);
  const m = lisse(e.melange);

  // 2. haut lissé : en car cam la normale de la surface sous les roues (murs, plafond) ; en ball cam TOUJOURS le haut du monde,
  //    l'horizon ne penche jamais (comme dans Rocket League)
  const hSol = hautVoulu(moi);
  const hv = normaliser(melanger(hSol, HAUT_MONDE, m), HAUT_MONDE);
  e.haut = normaliser(melanger(e.haut, hv, 1 - Math.exp(-dt * 6)), hv);

  // 3. direction de visée : chaque mode a sa direction, la caméra TOURNE de l'une vers l'autre
  //    car cam : l'avant de la voiture, lissé ; ball cam : la droite voiture → balle, suivie de façon rigide (elle ne traîne pas
  //    derrière la balle), ralentie seulement quand la balle passe à la verticale de la voiture, où le cap n'a plus de sens
  const dirCar = dirVoiture(moi.base.avant, e.haut, moi.auSol ? 0 : SUIVI_TANGAGE_AIR, e.dir);
  const versBalle = soustraire(balle.p, moi.p);
  const dBalle = Math.hypot(versBalle[0], versBalle[1], versBalle[2]);
  const dHorizontale = Math.hypot(versBalle[0], versBalle[2]);
  // cap (horizontal) et élévation suivis séparément : quand la balle passe au-dessus du toit, le cap de la droite voiture → balle
  // se retourne d'un coup ; la caméra, elle, fait le tour de la voiture à vitesse bornée au lieu de sauter de l'autre côté
  const elBalleBrute = Math.atan2(versBalle[1], Math.max(dHorizontale, 1e-6));
  if (!a.capBalle) {
    a.capBalle = dHorizontale > 1e-3 ? [versBalle[0] / dHorizontale, versBalle[2] / dHorizontale] : normaliser2(dirCar[0], dirCar[2]);
    a.elBalle = elBalleBrute;
  } else {
    if (dHorizontale > 1e-3) {
      const cx = versBalle[0] / dHorizontale, cz = versBalle[2] / dHorizontale;
      // angle signé du cap courant vers le cap voulu
      const ecart = Math.atan2(a.capBalle[1] * cx - a.capBalle[0] * cz, a.capBalle[0] * cx + a.capBalle[1] * cz);
      const proche = lisseEntre(0.5, 4, dHorizontale);
      const pas = Math.min(Math.abs(ecart) * (1 - Math.exp(-dt * SUIVI_BALLE)), (VITESSE_CAP_PROCHE + (VITESSE_CAP_MAX - VITESSE_CAP_PROCHE) * proche) * dt);
      const r = ecart >= 0 ? pas : -pas, c = Math.cos(r), sn = Math.sin(r);
      a.capBalle = normaliser2(a.capBalle[0] * c + a.capBalle[1] * sn, a.capBalle[1] * c - a.capBalle[0] * sn);
    }
    a.elBalle += (elBalleBrute - a.elBalle) * (1 - Math.exp(-dt * SUIVI_BALLE));
  }
  const ceB = Math.cos(a.elBalle);
  const dirBalle: Vec3 = [a.capBalle[0] * ceB, Math.sin(a.elBalle), a.capBalle[1] * ceB];
  const kCar = 4 + 18 * rig;
  // pendant la bascule d'un mode à l'autre, la caméra pivote à vitesse modérée ; une fois arrivée, elle suit au rythme du mode
  const arrive = balleVoulue ? m : 1 - m;
  const k = SUIVI_BASCULE + ((balleVoulue ? SUIVI_BALLE : kCar) - SUIVI_BASCULE) * arrive;
  // ball cam établie : la direction EST celle de la balle (déjà lissée ci-dessus), pas de second lissage qui la ferait traîner
  e.dir = balleVoulue && arrive > 0.999 ? dirBalle : tournerVers(e.dir, balleVoulue ? dirBalle : dirCar, 1 - Math.exp(-dt * k), e.haut);

  // 4. regard libre (angles lissés) ; la vue arrière est un demi-tour
  const lacetVoulu = entree.arriere ? Math.PI : clamp(entree.regard[0], -1, 1) * (Math.PI / 2);
  const tangageVoulu = clamp(entree.regard[1], -1, 1) * (Math.PI / 4);
  const ar = 1 - Math.exp(-dt * clamp(p.vitesseRegard, 1, 10) * 1.6);
  e.regard[0] += (lacetVoulu - e.regard[0]) * ar;
  e.regard[1] += (tangageVoulu - e.regard[1]) * ar;
  const dirF = tournerRegard(e.dir, e.haut, e.regard[0], e.regard[1]);

  // 5. position : derrière la voiture sur la ligne de visée, à `distance`, `hauteur` au-dessus. L'élévation de cette ligne est
  //    bornée : en car cam à 20° ; en ball cam par le sol (balle haute : la caméra descend derrière la voiture jusqu'à 0,5 m du sol)
  const elSol = Math.asin(clamp((moi.p[1] + p.hauteur - GARDE_SOL_M) / Math.max(p.distance, 0.5), Math.sin(5 * D2R), Math.sin(ELEVATION_BALLE_MAX)));
  const elPosMax = ELEVATION_POSITION_MAX + (elSol - ELEVATION_POSITION_MAX) * m;
  const dirPos = borneElevation(dirF, e.haut, ELEVATION_POSITION_MIN, elPosMax);
  const ideal = positionIdeale(moi, dirPos, e.haut, p);

  // 6. anticollision : on rapproche la caméra de la voiture le long du rayon, tout de suite si le chemin se ferme, doucement sinon
  const ancre = ajouter(moi.p, mult(e.haut, HAUTEUR_ANCRE_M));
  const f = fractionDegagee(arene, ancre, ideal, seuilDe(arene, ancre));
  a.reduction = f < a.reduction ? f : Math.min(f, a.reduction + (f - a.reduction) * (1 - Math.exp(-dt * 4)));
  const pos = ajouter(ancre, mult(soustraire(ideal, ancre), a.reduction));

  // 7. point visé : devant la voiture (car cam) ou la balle (ball cam ; avec le regard libre, le point tourne autour de la voiture)
  const cibleCar = ajouter(ajouter(moi.p, mult(dirF, p.distance / 2)), mult(e.haut, HAUTEUR_CIBLE_M));
  const cibleBalle = ajouter(moi.p, mult(dirF, Math.max(dBalle, 3)));
  const cible = melanger(cibleCar, cibleBalle, m);
  const brut = normaliser(soustraire(cible, pos), dirF);
  const sH = dot(brut, e.haut);
  const hor = normaliser([brut[0] - e.haut[0] * sH, brut[1] - e.haut[1] * sH, brut[2] - e.haut[2] * sH], normaliser(croix(e.haut, croix(dirF, e.haut)), dirF));
  const elBrut = Math.asin(clamp(sH, -1, 1));
  const elCar = clamp(elBrut + p.angle * D2R, ELEVATION_VISEE_MIN, ELEVATION_VISEE_MAX);
  const elVoiture = elevation(normaliser(soustraire(moi.p, pos), dirF), e.haut);
  const elBalle = elevationViseeBalle(elBrut, elVoiture, (fovV * D2R) / 2, p.angle * D2R);
  const el = elCar + (elBalle - elCar) * m;
  const ce = Math.cos(el), se = Math.sin(el);
  const regard: Vec3 = [hor[0] * ce + e.haut[0] * se, hor[1] * ce + e.haut[1] * se, hor[2] * ce + e.haut[2] * se];

  // 8. secousse (jamais en mouvement réduit) : elle déplace la caméra ET son point visé, l'image tremble sans tourner
  if (mouvementReduit) e.secousse = 0;
  else {
    a.phase += dt * 55;
    const s = decalageSecousse(a, e.secousse);
    pos[0] += s[0]; pos[1] += s[1]; pos[2] += s[2];
    e.secousse *= Math.exp(-dt * 9);
    if (e.secousse < 1e-4) e.secousse = 0;
  }

  e.position = pos;
  const pose: PoseCamera = {
    position: pos,
    cible: ajouter(pos, mult(regard, Math.max(p.distance * 3, 6))),
    haut: [e.haut[0], e.haut[1], e.haut[2]],
    fovVertical: fovV,
  };
  a.dernierePose = pose;
  return pose;
};

// ============================================================================================================================
// Célébration d'un but
// ============================================================================================================================

/** Rayon, hauteur et vitesse (rad/s) de l'orbite de la célébration. */
export const ORBITE_BUT = { rayon: 13, hauteur: 3.4, vitesse: 0.45, fonduS: 0.5, versMarqueurDebutS: 0.9, versMarqueurFinS: 1.9 } as const;

/**
 * Caméra de la phase « but » (et de la fin de partie) : fondu depuis la dernière pose de jeu vers une orbite lente autour de la balle,
 * qui glisse vers le marqueur au bout de ~2 s. `tempsPhase` est le temps écoulé dans la phase (s). En mouvement réduit, point de vue
 * fixe (pas de rotation, pas de secousse).
 */
export function majCameraBut(
  e: EtatCamera, p: Readonly<ParamsCamera>, balle: Readonly<EtatBalle>, marqueur: Readonly<EtatVoiture> | null,
  arene: Arene, tempsPhase: number, dtBrut: number, aspect: number, mouvementReduit: boolean,
): PoseCamera {
  const a = annexesDe(e);
  const dt = clamp(Number.isFinite(dtBrut) ? dtBrut : 0, 0, 0.1);
  const centreBalle = balle.p;
  if (!a.but) {
    const depart: PoseCamera = a.dernierePose ?? { position: e.position, cible: centreBalle, haut: e.haut, fovVertical: fovVerticalDepuisHorizontal(p.fov, aspect) };
    a.but = { depart, azimut: Math.atan2(depart.position[0] - centreBalle[0], depart.position[2] - centreBalle[2]), t: 0 };
  }
  a.but.t += dt;
  const centre = marqueur ? melanger(centreBalle, marqueur.p, lisseEntre(ORBITE_BUT.versMarqueurDebutS, ORBITE_BUT.versMarqueurFinS, tempsPhase)) : centreBalle;
  const az = a.but.azimut + (mouvementReduit ? 0 : ORBITE_BUT.vitesse * tempsPhase);
  const ideal: Vec3 = [centre[0] + Math.sin(az) * ORBITE_BUT.rayon, centre[1] + ORBITE_BUT.hauteur, centre[2] + Math.cos(az) * ORBITE_BUT.rayon];
  ideal[1] = Math.min(ideal[1], STADE.hauteur - MARGE_PLAFOND_M);
  const ancre: Vec3 = [centre[0], centre[1] + 0.3, centre[2]];
  const f = fractionDegagee(arene, ancre, ideal, seuilDe(arene, ancre));
  a.reduction = f < a.reduction ? f : Math.min(f, a.reduction + (f - a.reduction) * (1 - Math.exp(-dt * 4)));
  const orbite = ajouter(ancre, mult(soustraire(ideal, ancre), a.reduction));
  const fondu = lisse(a.but.t / ORBITE_BUT.fonduS);
  const pos = melanger(a.but.depart.position, orbite, fondu);
  const cible = melanger(a.but.depart.cible, [centre[0], centre[1] + 0.6, centre[2]], fondu);
  const haut = normaliser(melanger(a.but.depart.haut, [0, 1, 0], fondu));
  e.position = pos;
  e.haut = haut;
  e.dir = normaliser(soustraire(cible, pos), e.dir);
  e.secousse = 0;
  return { position: pos, cible, haut, fovVertical: fovVerticalDepuisHorizontal(p.fov, aspect) };
}

/** Distance caméra → voiture (m), pour les tests et le réglage. */
export const distanceCameraVoiture = (pose: Readonly<PoseCamera>, moi: Readonly<EtatVoiture>): number => distance(pose.position, moi.p);
