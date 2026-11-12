/**
 * Rocket Muche : contacts voiture ↔ balle et voiture ↔ voiture (module C, seconde moitié).
 *
 * Voiture ↔ balle (spec § 5.9) : boîte orientée (la hitbox de l'Octane, arêtes arrondies de 2 cm comme la marge de Bullet) contre
 * sphère. Le contact existe dès que la balle est à moins de `BALLE.margeContact` (1,905 cm, seuil de rupture d'un contact de Bullet) de
 * la boîte. Si elle y pénètre, elle est repoussée dehors (l'équivalent du split impulse de Bullet : aucune vitesse ajoutée). Puis deux
 * impulsions s'ajoutent comme dans Rocket League :
 *  1. un choc PHYSIQUE si les deux se rapprochent (masses 180 / 30, restitution 0, inertie de la voiture pour le couple qu'elle reçoit,
 *     frottement de Coulomb 2 qui donne du spin à la balle) ;
 *  2. l'impulsion SUPPLÉMENTAIRE de Psyonix (RocketSim Ball::_OnHit), que les deux se rapprochent ou non : direction = vecteur ORIGINE
 *     de la voiture (pas le centre de la hitbox) → centre de la balle AVANT la séparation, composante verticale × 0,35 et composante le
 *     long de l'avant × 0,65 ; intensité = vitesse relative des centres (plafonnée à 46 m/s) × courbe `CONTACT_BALLE.courbeImpulsion`.
 *     C'est elle qui rend les frappes plus longues qu'un choc physique et qui fait monter la balle prise par dessous. Après une
 *     impulsion, la même voiture saute UN pas avant la suivante : en contact continu elle repart un pas sur deux (une balle posée sur
 *     le toit n'a presque pas de vitesse relative, donc presque pas d'impulsion : le dribble tient).
 *     Elle ne modifie pas la vitesse de la balle sur-le-champ : elle se cumule dans `balle.vitesseEnAttente` (RocketSim
 *     Ball::_velocityImpulseCache), ajoutée UNE fois en fin de pas (`appliquerVitesseEnAttente`, RocketSim Ball::_FinishPhysicsTick),
 *     et elle se calcule sur la position et la vitesse de la balle d'AVANT les contacts du pas (RocketSim lit `ballState` dans le
 *     rappel de contact, avant le solveur) : quand deux voitures touchent la balle au même pas (50/50, coup d'envoi), l'impulsion
 *     de chacune ne dépend ni de l'autre ni de l'ordre des voitures dans la liste.
 * La vitesse de la balle n'est PAS plafonnée ici : `match.ts` appelle `bornerBalle` une fois après tous les contacts du pas.
 *
 * Voiture ↔ voiture (spec § 5.10) : SAT des deux boîtes orientées (15 axes), séparation, impulsion avec rotation (restitution 0,1,
 * frottement 0,09), puis, pour chaque sens (RocketSim Arena::_BtCallback_OnCarCarCollision), BUMP ou DÉMOLITION : l'attaquant va vers
 * l'autre plus vite qu'elle ne s'éloigne, la touche de son pare-chocs avant, et n'a pas déjà bumpé cette voiture dans les 0,25 s. S'il
 * est supersonique et que la victime est d'une autre équipe, c'est une démolition, sinon un bump (surcroît de vitesse le long de la
 * marche de l'attaquant). Ce module ne marque JAMAIS une voiture démolie : il rend `demolition` et `match.ts` applique.
 * Comme pour la balle, la vitesse d'un bump va dans `victime.vitesseEnAttente` (RocketSim Car::_velocityImpulseCache), ajoutée après
 * toutes les paires du pas, puis plafonnée une fois (Car::_FinishPhysicsTick) ; les conditions d'approche et la direction du bump
 * se lisent sur les vitesses d'avant les contacts du pas : une voiture bumpée ou heurtée dans la paire (a, b) n'entre pas dans la
 * paire (b, c) du même pas avec cette vitesse en plus.
 *
 * Flip reset : `contactVoitureBalle` note les roues dont le rayon de suspension touche la balle (`EtatVoiture.rouesBalle`) et la
 * normale de la balle sous chacune (`normalesRouesBalle`) ; au pas suivant `pasVoiture` les compte avec les roues au contact du décor
 * partout où RocketSim lit `numWheelsInContact`. Trois roues = « au sol » : saut, second saut et flip sont rendus, le flip en cours
 * s'arrête, un appui sur saut à ce moment est un saut au sol, le moteur n'est plus divisé par 4 ; une à trois roues : alignement sur
 * la surface avec du gaz (RocketSim : le rayon d'une roue touche aussi la balle).
 *
 * Fidélité : tout est repris de RocketSim sauf le solveur lui-même [~] (un point de contact par paire, un passage d'impulsion avec
 * frottement en cône, séparation par projection de la position, paires résolues l'une après l'autre : le choc PHYSIQUE d'une paire
 * est donc vu par les suivantes du même pas) et les forces de pneu d'une roue posée sur la balle (non transposées).
 *
 * Pur et déterministe, sans allocation hors des objets de résultat.
 *
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md (§ 5.9, § 5.10)
 */
import {
  BALLE,
  CONTACT_BALLE,
  CONTACT_VOITURES,
  PAS_S,
  VOITURE,
  interpolerTable,
  type AppliquerVitesseEnAttente,
  type ContactBalle,
  type ContactEntreVoitures,
  type ContactVoitureBalle,
  type EtatVoiture,
  type Vec3,
} from "./contrat";
import { DEMI_HITBOX, RAYON_ENGLOBANT, appliquerImpulsion, inverseMasseEffective, vitessePointDans } from "./voiture";

const [HX, HY, HZ] = DEMI_HITBOX;
const DEC = VOITURE.decalageHitbox;
const R = BALLE.rayon;
const MB = BALLE.masse;
/** Inertie d'une sphère pleine : `0,4·m·r²`. */
const IB = BALLE.facteurInertie * MB * R * R;

/** Frottement de Coulomb du choc voiture ↔ balle (RL : 2, le glissement est plafonné par `vt / raideur`, donc stable). */
const FROTTEMENT_BALLE = CONTACT_BALLE.frottement;
/** Pas sautés entre deux impulsions de Psyonix d'une même voiture (RocketSim : 1). */
const DELAI_IMPULSION_PAS = CONTACT_BALLE.delaiImpulsionPas;
/** Délai du bump d'un attaquant contre la même victime, en pas (0,25 s : 30 pas, le bump suivant passe au pas t + 30). */
const DELAI_BUMP_PAS = Math.round(CONTACT_VOITURES.bumpDelaiS / PAS_S);
/** Le contact voiture ↔ balle existe tant que la balle est à moins de ceci de la boîte (seuil de rupture d'un contact de Bullet). */
const MARGE_BALLE = BALLE.margeContact;
/** Arrondi des arêtes de la hitbox face à la balle (marge de collision de Bullet) et demi-dimensions de la boîte rétrécie d'autant. */
const ARRONDI = CONTACT_BALLE.arrondiHitbox;
const HXR = HX - ARRONDI, HYR = HY - ARRONDI, HZR = HZ - ARRONDI;
/** Les axes de produit vectoriel ne sont retenus que s'ils pénètrent nettement moins que le meilleur axe de face. */
const BIAIS_ARETES = 1.05;

// ---- tampons ----
const C: Vec3 = [0, 0, 0];
const N: Vec3 = [0, 0, 0];
const PT: Vec3 = [0, 0, 0];
const RC: Vec3 = [0, 0, 0];
const RB: Vec3 = [0, 0, 0];
const UREL: Vec3 = [0, 0, 0];
const TAN: Vec3 = [0, 0, 0];
const DIR: Vec3 = [0, 0, 0];
/** position de la balle avant la séparation (direction de l'impulsion de Psyonix) */
const BP0: Vec3 = [0, 0, 0];

const dot3 = (a: Readonly<Vec3>, b: Readonly<Vec3>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

/**
 * Fin de pas d'une balle ou d'une voiture (RocketSim Ball::_FinishPhysicsTick et Car::_FinishPhysicsTick, « add velocity cache ») :
 * la vitesse en attente (impulsions de Psyonix reçues par la balle, bumps reçus par la voiture) entre dans la vitesse, puis repart de
 * zéro. À appeler une fois, après TOUS les contacts du pas ; les plafonds (`bornerBalle`, `plafonnerVitesse`) viennent après.
 */
export const appliquerVitesseEnAttente: AppliquerVitesseEnAttente = (c) => {
  const v = c.v, a = c.vitesseEnAttente;
  if (a[0] === 0 && a[1] === 0 && a[2] === 0) return;
  v[0] += a[0]; v[1] += a[1]; v[2] += a[2];
  a[0] = 0; a[1] = 0; a[2] = 0;
};

/** Centre de la hitbox, écrit dans `out`. */
function centreDans(out: Vec3, v: Readonly<EtatVoiture>): Vec3 {
  const { avant, droite, haut } = v.base;
  out[0] = v.p[0] + avant[0] * DEC[0] + droite[0] * DEC[1] + haut[0] * DEC[2];
  out[1] = v.p[1] + avant[1] * DEC[0] + droite[1] * DEC[1] + haut[1] * DEC[2];
  out[2] = v.p[2] + avant[2] * DEC[0] + droite[2] * DEC[1] + haut[2] * DEC[2];
  return out;
}

// ============================================================================================================================
// Voiture ↔ balle
// ============================================================================================================================

/**
 * Roues dont le RAYON de suspension touche la balle (RocketSim btVehicleRL::rayCast : le rayon part du point d'attache de la roue, le
 * long de -haut, sur repos + course + rayon de roue - 2,5 uu, soit 48,755 uu à l'avant et 49,555 uu à l'arrière, et touche tout corps
 * sauf le châssis, la balle comprise). Écrit un drapeau par roue dans `out` s'il est fourni et rend le nombre de roues touchées. Un
 * rayon qui part de l'INTÉRIEUR de la balle ne la touche pas (Bullet ne rend pas d'impact pour un lancer déjà en pénétration).
 * `normales`, s'il est fourni, reçoit pour chaque roue touchée la normale de la balle au point d'impact du rayon (unitaire, du centre
 * de la balle vers ce point : le `m_contactNormalWS` du rayon) ; celle d'une roue non touchée n'est pas modifiée.
 */
export function rouesTouchantLaBalle(v: Readonly<EtatVoiture>, bp: Readonly<Vec3>, out?: boolean[], normales?: Vec3[]): number {
  const { avant, droite, haut } = v.base;
  let nb = 0;
  for (let i = 0; i < 4; i++) {
    const roue = VOITURE.roues[i];
    const ax = roue.attache[0], ay = roue.attache[1], az = roue.attache[2];
    // du point d'attache au centre de la balle
    const dx = bp[0] - (v.p[0] + avant[0] * ax + droite[0] * ay + haut[0] * az);
    const dy = bp[1] - (v.p[1] + avant[1] * ax + droite[1] * ay + haut[1] * az);
    const dz = bp[2] - (v.p[2] + avant[2] * ax + droite[2] * ay + haut[2] * az);
    // abscisse du centre le long du rayon (direction -haut) et carré de sa distance à la droite du rayon
    const s = -(dx * haut[0] + dy * haut[1] + dz * haut[2]);
    const h2 = dx * dx + dy * dy + dz * dz - s * s;
    let touche = false;
    if (h2 <= R * R) {
      const entree = s - Math.sqrt(R * R - h2);
      // longueur du rayon : de l'attache au centre de la roue à l'équilibre, plus le rayon de la roue, plus sa marge
      touche = entree >= 0 && entree <= az - roue.local[2] + roue.rayon + roue.marge;
      if (touche && normales) {
        // point d'impact = attache - haut × entree ; (dx, dy, dz) va de l'attache au centre de la balle
        const n = normales[i];
        n[0] = (-dx - haut[0] * entree) / R; n[1] = (-dy - haut[1] * entree) / R; n[2] = (-dz - haut[2] * entree) / R;
      }
    }
    if (out) out[i] = touche;
    if (touche) nb++;
  }
  return nb;
}

/**
 * Vrai si trois roues au moins (`VOITURE.rouesPourSol`, RocketSim : isOnGround = numWheelsInContact >= 3) ont leur rayon de suspension
 * sur la balle : la voiture est « posée » sur la balle, c'est le FLIP RESET. Sert aussi au HUD.
 */
export function rouesSurLaBalle(v: Readonly<EtatVoiture>, bp: Readonly<Vec3>): boolean {
  return rouesTouchantLaBalle(v, bp) >= VOITURE.rouesPourSol;
}

/**
 * Contact de la hitbox orientée avec la balle. Rend null sans contact (ou si la voiture est démolie). `force` est la vitesse relative
 * balle / voiture AVANT le choc ; `point` est le point de la hitbox touché. Ne modifie ni `balle.dernierToucheur` ni les statistiques,
 * ne plafonne pas la vitesse de la balle (`bornerBalle`). Note dans `v.rouesBalle` les roues posées sur la balle (flip reset) et dans
 * `v.normalesRouesBalle` la normale de la balle sous chacune. L'impulsion de Psyonix va dans `b.vitesseEnAttente`, pas dans `b.v` ;
 * elle lit la balle d'avant les contacts du pas, `balleAvant` (défaut : la balle telle qu'elle est à l'appel).
 */
export const contactVoitureBalle: ContactVoitureBalle = (v, b, tick, _dt, balleAvant) => {
  const rb = v.rouesBalle;
  rb[0] = false; rb[1] = false; rb[2] = false; rb[3] = false;
  if (v.demolie) return null;
  const { avant, droite, haut } = v.base;
  centreDans(C, v);
  const dx = b.p[0] - C[0], dy = b.p[1] - C[1], dz = b.p[2] - C[2];
  const portee = RAYON_ENGLOBANT + R + MARGE_BALLE;
  if (dx * dx + dy * dy + dz * dz > portee * portee) return null;
  // flip reset : les rayons de suspension qui touchent la balle (ils finissent dans la sphère englobante de la hitbox)
  rouesTouchantLaBalle(v, b.p, rb, v.normalesRouesBalle);
  // centre de la balle dans le repère de la hitbox ; point le plus proche de la boîte RÉTRÉCIE de l'arrondi, puis regonflée d'autant
  const lx = dx * avant[0] + dy * avant[1] + dz * avant[2];
  const ly = dx * droite[0] + dy * droite[1] + dz * droite[2];
  const lz = dx * haut[0] + dy * haut[1] + dz * haut[2];
  const cx = clamp(lx, -HXR, HXR), cy = clamp(ly, -HYR, HYR), cz = clamp(lz, -HZR, HZR);
  let nx = lx - cx, ny = ly - cy, nz = lz - cz;
  const ecart = Math.hypot(nx, ny, nz);
  // distance du centre de la balle à la surface de la boîte arrondie, point de cette surface
  let dist = ecart - ARRONDI;
  let px: number, py: number, pz: number;
  if (dist >= R + MARGE_BALLE) return null;
  if (ecart < 1e-9) {
    // centre de la balle DANS la boîte rétrécie : on la sort par la face la plus proche
    const ex = HX - Math.abs(lx), ey = HY - Math.abs(ly), ez = HZ - Math.abs(lz);
    nx = 0; ny = 0; nz = 0; px = cx; py = cy; pz = cz;
    if (ex <= ey && ex <= ez) { nx = lx >= 0 ? 1 : -1; px = nx * HX; dist = -ex; }
    else if (ey <= ez) { ny = ly >= 0 ? 1 : -1; py = ny * HY; dist = -ey; }
    else { nz = lz >= 0 ? 1 : -1; pz = nz * HZ; dist = -ez; }
  } else {
    nx /= ecart; ny /= ecart; nz /= ecart;
    px = cx + nx * ARRONDI; py = cy + ny * ARRONDI; pz = cz + nz * ARRONDI;
  }
  // normale monde (de la voiture vers la balle) et point de contact monde
  N[0] = avant[0] * nx + droite[0] * ny + haut[0] * nz;
  N[1] = avant[1] * nx + droite[1] * ny + haut[1] * nz;
  N[2] = avant[2] * nx + droite[2] * ny + haut[2] * nz;
  PT[0] = C[0] + avant[0] * px + droite[0] * py + haut[0] * pz;
  PT[1] = C[1] + avant[1] * px + droite[1] * py + haut[1] * pz;
  PT[2] = C[2] + avant[2] * px + droite[2] * py + haut[2] * pz;
  const profondeur = R - dist;
  const point: Vec3 = [PT[0], PT[1], PT[2]];

  // vitesses avant le choc
  RC[0] = PT[0] - v.p[0]; RC[1] = PT[1] - v.p[1]; RC[2] = PT[2] - v.p[2];
  RB[0] = PT[0] - b.p[0]; RB[1] = PT[1] - b.p[1]; RB[2] = PT[2] - b.p[2];
  const rel = vitesseRelative(v, b);
  const force = Math.hypot(rel[0], rel[1], rel[2]);
  const vn = dot3(rel, N);
  // vitesse relative des centres (pour l'impulsion de Psyonix), lue avant le choc, sur la vitesse de la balle d'AVANT les contacts
  // du pas (RocketSim Ball::_OnHit : `ballState.vel - carState.vel`, lus dans le rappel de contact, avant le solveur) : ni le choc
  // ni l'impulsion d'une autre voiture passée plus tôt dans ce pas n'y entrent
  const va = balleAvant ? balleAvant.v : b.v;
  let vitesseCentres = Math.hypot(va[0] - v.v[0], va[1] - v.v[1], va[2] - v.v[2]);
  // contact déjà là au pas précédent : RocketSim lit alors des vitesses que son solveur a DÉJÀ résolues (la balle posée sur le toit
  // n'a aucune vitesse d'approche, sa gravité est annulée dans le solveur). Ici la gravité du pas n'est annulée que par le choc
  // ci-dessous : pour un contact qui dure, la vitesse relative est donc relue APRÈS le choc
  const persistant = v.dernierContactBalleTick === tick - 1;
  // ce que les voitures passées plus tôt dans ce pas ont déjà donné à la balle (nul pour la première, ou sans `balleAvant`)
  const ex = b.v[0] - va[0], ey = b.v[1] - va[1], ez = b.v[2] - va[2];

  // séparation : la balle qui pénètre est repoussée hors de la boîte (rien à moins de 1,905 cm sans pénétration). L'impulsion de
  // Psyonix lit la position d'AVANT les contacts du pas (RocketSim : dans le rappel de contact, avant le solveur et l'intégration)
  const pa = balleAvant ? balleAvant.p : b.p;
  BP0[0] = pa[0]; BP0[1] = pa[1]; BP0[2] = pa[2];
  if (profondeur > 0) { b.p[0] += N[0] * profondeur; b.p[1] += N[1] * profondeur; b.p[2] += N[2] * profondeur; }

  if (vn < 0) {
    // choc physique (Bullet résout la contrainte de vitesse dès que le point de contact existe, pénétration ou non)
    const j = (-(1 + CONTACT_BALLE.restitution) * vn) / (inverseMasseEffective(v.base, RC, N) + 1 / MB);
    b.v[0] += (N[0] * j) / MB; b.v[1] += (N[1] * j) / MB; b.v[2] += (N[2] * j) / MB;
    appliquerImpulsion(v, RC, N, -j);
    // frottement tangentiel : donne du spin à la balle
    const rel2 = vitesseRelative(v, b);
    const vn2 = dot3(rel2, N);
    TAN[0] = rel2[0] - N[0] * vn2; TAN[1] = rel2[1] - N[1] * vn2; TAN[2] = rel2[2] - N[2] * vn2;
    const vt = Math.hypot(TAN[0], TAN[1], TAN[2]);
    if (vt > 1e-6) {
      TAN[0] /= vt; TAN[1] /= vt; TAN[2] /= vt;
      const raideurBalle = 1 / MB + (R * R) / IB; // r ⟂ t : 1/m + r²/I
      const jt = Math.min(FROTTEMENT_BALLE * j, vt / (raideurBalle + inverseMasseEffective(v.base, RC, TAN)));
      // sur la balle : -jt·t au point (-n·R) ; sur la voiture : +jt·t
      b.v[0] -= (TAN[0] * jt) / MB; b.v[1] -= (TAN[1] * jt) / MB; b.v[2] -= (TAN[2] * jt) / MB;
      const rx = -N[0] * R, ry = -N[1] * R, rz = -N[2] * R;
      const fx = -TAN[0] * jt, fy = -TAN[1] * jt, fz = -TAN[2] * jt;
      b.w[0] += (ry * fz - rz * fy) / IB; b.w[1] += (rz * fx - rx * fz) / IB; b.w[2] += (rx * fy - ry * fx) / IB;
      appliquerImpulsion(v, RC, TAN, jt);
    }
  }
  // contact qui dure : vitesse relative après le choc de CETTE voiture seulement (celui des voitures précédentes est retiré)
  if (persistant) vitesseCentres = Math.hypot(b.v[0] - v.v[0] - ex, b.v[1] - v.v[1] - ey, b.v[2] - v.v[2] - ez);
  // impulsion supplémentaire de Psyonix : à chaque contact, approche ou non, si la précédente de cette voiture date de plus d'un pas
  // (RocketSim Ball.cpp:262 ; le second test couvre un compteur de pas revenu en arrière). Elle attend la fin du pas dans
  // `b.vitesseEnAttente` (Ball.cpp:283 « Velocity won't be actually added until the end of this tick »)
  const derniere = v.derniereImpulsionPsyonixTick;
  if (tick > derniere + DELAI_IMPULSION_PAS || derniere > tick) {
    v.derniereImpulsionPsyonixTick = tick;
    psyonix(v, b, BP0, vitesseCentres);
  }
  v.dernierContactBalleTick = tick;
  const r: ContactBalle = { force, point };
  return r;
};

/** Vitesse relative balle − voiture au point de contact (`RB`, `RC` posés par l'appelant), écrite dans le tampon `UREL`. */
function vitesseRelative(v: Readonly<EtatVoiture>, b: Readonly<{ v: Vec3; w: Vec3 }>): Vec3 {
  const vcx = v.v[0] + (v.w[1] * RC[2] - v.w[2] * RC[1]);
  const vcy = v.v[1] + (v.w[2] * RC[0] - v.w[0] * RC[2]);
  const vcz = v.v[2] + (v.w[0] * RC[1] - v.w[1] * RC[0]);
  const vbx = b.v[0] + (b.w[1] * RB[2] - b.w[2] * RB[1]);
  const vby = b.v[1] + (b.w[2] * RB[0] - b.w[0] * RB[2]);
  const vbz = b.v[2] + (b.w[0] * RB[1] - b.w[1] * RB[0]);
  UREL[0] = vbx - vcx; UREL[1] = vby - vcy; UREL[2] = vbz - vcz;
  return UREL;
}

/**
 * L'impulsion supplémentaire de Psyonix (voir en-tête, RocketSim Ball::_OnHit). `bp` : centre de la balle avant les contacts du pas ;
 * `vitesseCentres` : |v_balle − v_voiture| avant le choc. La direction part de l'ORIGINE de la voiture (`carState.pos`, le centre de
 * masse), pas du centre de la hitbox. Elle s'ajoute à `b.vitesseEnAttente` (RocketSim `_velocityImpulseCache`), pas à la vitesse : la
 * balle la reçoit en fin de pas, et le plafond de 60 m/s vient après (`bornerBalle`).
 */
function psyonix(v: Readonly<EtatVoiture>, b: { vitesseEnAttente: Vec3 }, bp: Readonly<Vec3>, vitesseCentres: number): void {
  if (!(vitesseCentres > 0)) return;
  DIR[0] = bp[0] - v.p[0]; DIR[1] = (bp[1] - v.p[1]) * CONTACT_BALLE.echelleVerticale; DIR[2] = bp[2] - v.p[2];
  // composante le long de l'avant ramenée à 65 % (RocketSim normalise avant et après : même direction, l'ajustement est linéaire)
  const af = dot3(DIR, v.base.avant) * (1 - CONTACT_BALLE.echelleAvant);
  DIR[0] -= v.base.avant[0] * af; DIR[1] -= v.base.avant[1] * af; DIR[2] -= v.base.avant[2] * af;
  const n = Math.hypot(DIR[0], DIR[1], DIR[2]);
  if (n < 1e-9) return;
  const vr = Math.min(vitesseCentres, CONTACT_BALLE.vitesseRelativeMax);
  const intensite = vr * interpolerTable(CONTACT_BALLE.courbeImpulsion, vr);
  const a = b.vitesseEnAttente;
  a[0] += (DIR[0] / n) * intensite; a[1] += (DIR[1] / n) * intensite; a[2] += (DIR[2] / n) * intensite;
}

// ============================================================================================================================
// Voiture ↔ voiture
// ============================================================================================================================

/** Axes et demi-dimensions d'une hitbox pour le SAT. */
const DEMI = [HX, HY, HZ] as const;
const CA: Vec3 = [0, 0, 0];
const CB: Vec3 = [0, 0, 0];
const T: Vec3 = [0, 0, 0];
const L: Vec3 = [0, 0, 0];
const NMIN: Vec3 = [0, 0, 0];
const PTV: Vec3 = [0, 0, 0];
const RA: Vec3 = [0, 0, 0];
const RBB: Vec3 = [0, 0, 0];
const UA: Vec3 = [0, 0, 0];
const UB: Vec3 = [0, 0, 0];
const SA: Vec3 = [0, 0, 0];
const SB: Vec3 = [0, 0, 0];
/** 12 coins (8 par voiture, sommes dans PTV). */
const COIN: Vec3 = [0, 0, 0];
/** moyennes des coins de a dans b (MA) et de b dans a (MB_) */
const MA: Vec3 = [0, 0, 0];
const MB_: Vec3 = [0, 0, 0];
/** vitesses des deux voitures avant le choc (bump) */
const VAV: Vec3 = [0, 0, 0];
const VBV: Vec3 = [0, 0, 0];

function axesDe(v: Readonly<EtatVoiture>): readonly [Vec3, Vec3, Vec3] {
  return [v.base.avant, v.base.droite, v.base.haut];
}

/** Rayon de projection d'une boîte sur l'axe L. */
function rayonSur(axes: readonly [Vec3, Vec3, Vec3], l: Readonly<Vec3>): number {
  return HX * Math.abs(dot3(l, axes[0])) + HY * Math.abs(dot3(l, axes[1])) + HZ * Math.abs(dot3(l, axes[2]));
}

/** Vrai si le point `p` est dans la hitbox de `v` (marge de 1 mm). */
function dansHitbox(v: Readonly<EtatVoiture>, c: Readonly<Vec3>, p: Readonly<Vec3>): boolean {
  const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2];
  const { avant, droite, haut } = v.base;
  return (
    Math.abs(dx * avant[0] + dy * avant[1] + dz * avant[2]) <= HX + 1e-3 &&
    Math.abs(dx * droite[0] + dy * droite[1] + dz * droite[2]) <= HY + 1e-3 &&
    Math.abs(dx * haut[0] + dy * haut[1] + dz * haut[2]) <= HZ + 1e-3
  );
}

/**
 * Ajoute à `PTV` (somme) les coins de `a` qui sont dans la boîte de `b` ; leur moyenne seule va dans `moyenne` si elle est fournie.
 * Rend le nombre de coins retenus.
 */
function coinsDedans(a: Readonly<EtatVoiture>, ca: Readonly<Vec3>, b: Readonly<EtatVoiture>, cb: Readonly<Vec3>, moyenne: Vec3): number {
  let compte = 0;
  moyenne[0] = 0; moyenne[1] = 0; moyenne[2] = 0;
  const { avant, droite, haut } = a.base;
  for (let i = 0; i < 8; i++) {
    const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : -1, sz = i & 4 ? 1 : -1;
    COIN[0] = ca[0] + avant[0] * sx * HX + droite[0] * sy * HY + haut[0] * sz * HZ;
    COIN[1] = ca[1] + avant[1] * sx * HX + droite[1] * sy * HY + haut[1] * sz * HZ;
    COIN[2] = ca[2] + avant[2] * sx * HX + droite[2] * sy * HY + haut[2] * sz * HZ;
    if (dansHitbox(b, cb, COIN)) { moyenne[0] += COIN[0]; moyenne[1] += COIN[1]; moyenne[2] += COIN[2]; compte++; }
  }
  if (compte > 0) { moyenne[0] /= compte; moyenne[1] /= compte; moyenne[2] /= compte; }
  return compte;
}

/**
 * Condition d'approche de RocketSim (Arena::_BtCallback_OnCarCarCollision) : `att` va vers `vic` (vitesse · écart des origines > 0)
 * et sa vitesse le long de la direction origine → origine dépasse la vitesse de `vic` le long de la direction de marche de `att`
 * (il fonce vers l'autre plus vite que l'autre ne s'éloigne). Rend cette vitesse d'approche (m/s), ou -1 si la condition échoue.
 * `vAtt` et `vVic` : les vitesses des deux voitures avant les contacts du pas.
 */
function vitesseApproche(att: Readonly<EtatVoiture>, vic: Readonly<EtatVoiture>, vAtt: Readonly<Vec3>, vVic: Readonly<Vec3>): number {
  const dx = vic.p[0] - att.p[0], dy = vic.p[1] - att.p[1], dz = vic.p[2] - att.p[2];
  const vers = vAtt[0] * dx + vAtt[1] * dy + vAtt[2] * dz;
  if (vers <= 0) return -1;
  const nd = Math.hypot(dx, dy, dz), nv = Math.hypot(vAtt[0], vAtt[1], vAtt[2]);
  if (nd < 1e-9 || nv < 1e-9) return -1;
  const approche = vers / nd;
  const fuite = (vVic[0] * vAtt[0] + vVic[1] * vAtt[1] + vVic[2] * vAtt[2]) / nv;
  return approche > fuite ? approche : -1;
}

/**
 * Contact de deux voitures (SAT à 15 axes). Rend null sans contact (ou si l'une est démolie). `a` et `b` sont modifiés : séparation,
 * impulsion, délai de bump de l'attaquant ; la vitesse d'un bump va dans la `vitesseEnAttente` de la victime (ajoutée en fin de pas
 * par l'appelant, `appliquerVitesseEnAttente`). La démolition est seulement DÉTECTÉE (`demolition`) : `match.ts` marque la victime.
 * Les deux sens sont testés dans l'ordre de RocketSim (`a` attaque `b`, puis `b` attaque `a`) : si `a` démolit `b`, le second sens
 * n'est pas testé ; si `a` ne fait que bumper `b`, `b` peut encore bumper ou démolir `a` au même pas.
 * `vAvantA`, `vAvantB` : vitesses des deux voitures avant les contacts du pas (défaut : leurs vitesses à l'appel), lues par les
 * conditions d'approche et la direction du bump.
 */
export const contactVoitureVoiture: ContactEntreVoitures = (a, b, tick, vAvantA, vAvantB) => {
  if (a.demolie || b.demolie) return null;
  centreDans(CA, a); centreDans(CB, b);
  T[0] = CB[0] - CA[0]; T[1] = CB[1] - CA[1]; T[2] = CB[2] - CA[2];
  const d2 = T[0] * T[0] + T[1] * T[1] + T[2] * T[2];
  if (d2 > 4 * RAYON_ENGLOBANT * RAYON_ENGLOBANT) return null;
  const ea = axesDe(a), eb = axesDe(b);

  // --- SAT : 3 + 3 axes de face, 9 axes d'arête
  let minOverlap = Infinity;
  let minFace = Infinity;
  for (let i = 0; i < 6; i++) {
    const ax = i < 3 ? ea[i] : eb[i - 3];
    const o = rayonSur(ea, ax) + rayonSur(eb, ax) - Math.abs(dot3(T, ax));
    if (o <= 0) return null;
    if (o < minOverlap) { minOverlap = o; NMIN[0] = ax[0]; NMIN[1] = ax[1]; NMIN[2] = ax[2]; }
    if (o < minFace) minFace = o;
  }
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const p = ea[i], q = eb[j];
      L[0] = p[1] * q[2] - p[2] * q[1]; L[1] = p[2] * q[0] - p[0] * q[2]; L[2] = p[0] * q[1] - p[1] * q[0];
      const nl = Math.hypot(L[0], L[1], L[2]);
      if (nl < 1e-6) continue;
      L[0] /= nl; L[1] /= nl; L[2] /= nl;
      const o = rayonSur(ea, L) + rayonSur(eb, L) - Math.abs(dot3(T, L));
      if (o <= 0) return null;
      if (o * BIAIS_ARETES < minOverlap) { minOverlap = o; NMIN[0] = L[0]; NMIN[1] = L[1]; NMIN[2] = L[2]; }
    }
  }
  // normale de a vers b
  const s = dot3(T, NMIN) >= 0 ? 1 : -1;
  const n: Vec3 = [NMIN[0] * s, NMIN[1] * s, NMIN[2] * s];

  // --- point de contact : moyenne des coins de chacune dans l'autre ; sinon milieu des points d'appui (arête contre arête)
  const nA = coinsDedans(a, CA, b, CB, MA);
  const nB = coinsDedans(b, CB, a, CA, MB_);
  if (nA + nB > 0) {
    PTV[0] = (MA[0] * nA + MB_[0] * nB) / (nA + nB); PTV[1] = (MA[1] * nA + MB_[1] * nB) / (nA + nB); PTV[2] = (MA[2] * nA + MB_[2] * nB) / (nA + nB);
  } else {
    for (let k = 0; k < 3; k++) {
      const sa = dot3(n, ea[k]) >= 0 ? 1 : -1, sb = dot3(n, eb[k]) >= 0 ? 1 : -1;
      const hk = DEMI[k];
      SA[0] += ea[k][0] * sa * hk; SA[1] += ea[k][1] * sa * hk; SA[2] += ea[k][2] * sa * hk;
      SB[0] -= eb[k][0] * sb * hk; SB[1] -= eb[k][1] * sb * hk; SB[2] -= eb[k][2] * sb * hk;
    }
    PTV[0] = (CA[0] + SA[0] + CB[0] + SB[0]) / 2; PTV[1] = (CA[1] + SA[1] + CB[1] + SB[1]) / 2; PTV[2] = (CA[2] + SA[2] + CB[2] + SB[2]) / 2;
    SA[0] = SA[1] = SA[2] = SB[0] = SB[1] = SB[2] = 0;
  }
  RA[0] = PTV[0] - a.p[0]; RA[1] = PTV[1] - a.p[1]; RA[2] = PTV[2] - a.p[2];
  RBB[0] = PTV[0] - b.p[0]; RBB[1] = PTV[1] - b.p[1]; RBB[2] = PTV[2] - b.p[2];

  // --- vitesses avant le choc
  const vitRelCentres = Math.hypot(b.v[0] - a.v[0], b.v[1] - a.v[1], b.v[2] - a.v[2]);

  // le point d'attaque d'une voiture = ses PROPRES coins entrés dans l'autre (la moyenne commune dérive vers l'arrière quand le
  // chevauchement est grand, à 45 m/s de rapprochement on pénètre de 40 cm en un pas)
  const avantDe = (v: EtatVoiture, propres: Readonly<Vec3>, n: number): boolean => {
    const pt = n > 0 ? propres : PTV;
    return (pt[0] - v.p[0]) * v.base.avant[0] + (pt[1] - v.p[1]) * v.base.avant[1] + (pt[2] - v.p[2]) * v.base.avant[2] > CONTACT_VOITURES.demoAvantMinM;
  };
  const pareChocsA = avantDe(a, MA, nA), pareChocsB = avantDe(b, MB_, nB);
  // vitesses d'AVANT les contacts du pas, pour le bump (RocketSim lit l'état dans le rappel de contact, avant le solveur : ni le
  // choc ni le bump d'une autre paire du même pas n'y entrent) ; à défaut, celles d'avant le choc de cette paire
  const va0 = vAvantA ?? a.v, vb0 = vAvantB ?? b.v;
  VAV[0] = va0[0]; VAV[1] = va0[1]; VAV[2] = va0[2]; VBV[0] = vb0[0]; VBV[1] = vb0[1]; VBV[2] = vb0[2];
  // condition d'approche de chaque sens, sur ces vitesses et sur les positions d'avant la séparation : vitesse de l'attaquant vers
  // la victime, ou -1
  const approcheA = vitesseApproche(a, b, VAV, VBV), approcheB = vitesseApproche(b, a, VBV, VAV);

  // --- séparation (moitié chacune)
  const demi = minOverlap / 2;
  a.p[0] -= n[0] * demi; a.p[1] -= n[1] * demi; a.p[2] -= n[2] * demi;
  b.p[0] += n[0] * demi; b.p[1] += n[1] * demi; b.p[2] += n[2] * demi;

  // --- impulsion avec rotation
  vitessePointDans(UA, a, RA);
  vitessePointDans(UB, b, RBB);
  const un = (UB[0] - UA[0]) * n[0] + (UB[1] - UA[1]) * n[1] + (UB[2] - UA[2]) * n[2];
  if (un < 0) {
    const raideur = inverseMasseEffective(a.base, RA, n) + inverseMasseEffective(b.base, RBB, n);
    const j = (-(1 + CONTACT_VOITURES.restitution) * un) / raideur;
    appliquerImpulsion(b, RBB, n, j);
    appliquerImpulsion(a, RA, n, -j);
    // frottement
    vitessePointDans(UA, a, RA);
    vitessePointDans(UB, b, RBB);
    let tx = UB[0] - UA[0], ty = UB[1] - UA[1], tz = UB[2] - UA[2];
    const un2 = tx * n[0] + ty * n[1] + tz * n[2];
    tx -= n[0] * un2; ty -= n[1] * un2; tz -= n[2] * un2;
    const vt = Math.hypot(tx, ty, tz);
    if (vt > 1e-6) {
      DIR[0] = tx / vt; DIR[1] = ty / vt; DIR[2] = tz / vt;
      const kt = inverseMasseEffective(a.base, RA, DIR) + inverseMasseEffective(b.base, RBB, DIR);
      const jt = Math.min(CONTACT_VOITURES.frottement * j, vt / kt);
      appliquerImpulsion(b, RBB, DIR, -jt);
      appliquerImpulsion(a, RA, DIR, jt);
    }
  }

  // --- bump et démolition (RocketSim Arena::_BtCallback_OnCarCarCollision), un sens après l'autre. Gardes communes : l'attaquant
  // n'a pas bumpé CETTE voiture depuis 0,25 s, il va vers elle plus vite qu'elle ne s'éloigne (`vitesseApproche`), il la touche de son
  // pare-chocs avant. Supersonique contre une autre équipe : démolition ; sinon bump, vitesse donnée à la victime le long de la
  // marche de l'attaquant (+ une poussée le long du haut de la victime au sol, verticale en l'air), mise EN ATTENTE jusqu'à la fin du
  // pas (`car2->_velocityImpulseCache`). Le délai est armé dans les deux cas.
  let demolition: { auteur: number; victime: number } | null = null;
  let bump: { vitesse: number } | null = null;
  for (let k = 0; k < 2; k++) {
    const att = k === 0 ? a : b, vic = k === 0 ? b : a;
    if (att.bumpAutreId === vic.id && tick - att.bumpDelaiTick < DELAI_BUMP_PAS) continue;
    const vers = k === 0 ? approcheA : approcheB;
    if (vers < 0 || !(k === 0 ? pareChocsA : pareChocsB)) continue;
    att.bumpAutreId = vic.id; att.bumpDelaiTick = tick;
    if (att.supersonique && (att.equipe !== vic.equipe || CONTACT_VOITURES.tirAmi)) {
      demolition = { auteur: att.id, victime: vic.id };
      break; // la victime est démolie : RocketSim ne teste pas l'autre sens
    }
    const va = k === 0 ? VAV : VBV;
    const vitAtt = Math.hypot(va[0], va[1], va[2]);
    const poussee = interpolerTable(vic.auSol ? CONTACT_VOITURES.bumpSol : CONTACT_VOITURES.bumpAir, vers);
    const haut = interpolerTable(CONTACT_VOITURES.bumpHaut, vers);
    const hx = vic.auSol ? vic.base.haut[0] : 0, hy = vic.auSol ? vic.base.haut[1] : 1, hz = vic.auSol ? vic.base.haut[2] : 0;
    const enAttente = vic.vitesseEnAttente;
    enAttente[0] += (va[0] / vitAtt) * poussee + hx * haut;
    enAttente[1] += (va[1] / vitAtt) * poussee + hy * haut;
    enAttente[2] += (va[2] / vitAtt) * poussee + hz * haut;
    bump = { vitesse: Math.max(bump ? bump.vitesse : 0, vitRelCentres) };
  }
  return { demolition, bump };
};
