/**
 * Main humaine du tigre (thème Tigre, réaction « serre-main ») : la patte avant droite se déforme
 * en main humaine aux doigts longs, au pelage rayé et à la paume de peau. PUR (aucune dépendance) :
 * calcule, une fois au chargement du modèle, la cible de déformation (morph target, en déplacements
 * relatifs) des sommets de la patte et quatre repères par sommet pour le nuanceur, qui en tire la
 * paume de peau et les sillons (`nuanceurMainHumaine`). lib/tigre3d/modele.ts ajoute le tout à la
 * géométrie et au matériau, scene.ts règle le poids.
 *
 * Repère de travail : celui de l'os `mainD` au repos (matrice de liaison inverse × matrice de liaison
 * du maillage), en unités de ce repère. Mesures sur le GLB : y = le long de la patte (poignet à
 * y ≈ 0, bout des orteils à y ≈ 0,65), x = vers la plante (sole à x ≈ +0,22, dessus de la patte à
 * x ≈ -0,17 près des orteils), z = en travers (de -0,41 à +0,38).
 *
 * Paramétrage de la patte (vue de dessus) : la partie arrière est une bande (q = position en
 * travers ramenée à [-1, 1]), l'avant arrondi est un demi-disque ramené à un demi-carré
 * (correspondance « elliptical grid » disque → carré) : q en travers, w le long (w = -1 au
 * poignet, 0 au début de l'arrondi, 1 au bord avant). Le contour de la patte devient le bord du
 * rectangle [-1, 1] × [-1, 1]. La profondeur e (-1 = dessus, +1 = plante, 0 = flancs et face
 * avant des orteils) se lit sur la normale du sommet.
 *
 * Main : une paume, puis cinq bandes en travers (pouce, index, majeur, annulaire, auriculaire).
 * Chaque doigt est un tube terminé par une calotte (la face avant de l'orteil), les doigts voisins
 * se touchent : une surface continue ne peut pas se couper, donc les doigts sont séparés par des
 * sillons profonds dessus et dessous (le bord commun de deux bandes est leur point de contact, à
 * mi-épaisseur) et par les calottes, libres, au bout. Le pouce part du talon de la main, longe la
 * paume puis s'écarte de l'index au-delà de la palmure, seule membrane de la main. Les positions
 * de deux bandes voisines sont mélangées sur une bande étroite (partition de l'unité) : rien ne
 * se déchire. Le matériau est sans éclairage : les sillons et les plis sont tracés par le nuanceur.
 *
 * La géométrie de la patte n'a que 2 à 3 arêtes par doigt : pas de subdivision, les sillons se
 * lisent grâce aux lignes du nuanceur, calculées au fragment près sur (q, w, e) interpolés.
 */

/** Matrice 4 × 4 en colonnes (comme three). */
export type Matrice = ArrayLike<number>;

export interface EntreeMainHumaine {
  /** Positions et normales du maillage (3 par sommet), repère de la géométrie, dénormalisées. */
  positions: ArrayLike<number>;
  normales: ArrayLike<number>;
  /** Indices et poids des os (4 par sommet), poids déjà dénormalisés. */
  indicesOs: ArrayLike<number>;
  poidsOs: ArrayLike<number>;
  /** Triangles (3 indices par triangle), pour lisser les bouts des doigts. Facultatif. */
  indices?: ArrayLike<number>;
  /** Indice de l'os `mainD` dans le squelette du maillage. */
  osMain: number;
  /** Géométrie → repère de `mainD` au repos (inverse bind matrix × bind matrix). */
  versOs: Matrice;
}

export interface SortieMainHumaine {
  /** Déplacements (3 par sommet), repère de la géométrie : cible relative (morphTargetsRelative). */
  deplacements: Float32Array;
  /**
   * Par sommet (4 valeurs) : atténuation de la déformation (0 hors de la main), puis q (main
   * canonique), w, e. Le nuanceur (`nuanceurMainHumaine`) en tire la peau et les sillons.
   */
  reperes: Float32Array;
  /** Nombre de sommets déplacés. */
  deplaces: number;
}

/** Point du repère de l'os : x vers la paume, y le long des doigts, z en travers. */
export interface Point3 { x: number; y: number; z: number }

/** Coordonnées d'un sommet de la patte : q en travers, w le long, e en profondeur (voir l'en-tête). */
export interface CoordPatte { q: number; w: number; e: number }

/**
 * Côté du pouce (signe de z) dans le repère de l'os. Patte droite à plat au sol, doigts vers
 * l'avant : le pouce d'une main droite paume en bas est du côté du corps (la gauche du tigre),
 * soit z < 0 dans le repère de `mainD` (mesuré : +X du modèle donne -z).
 */
export const COTE_POUCE: 1 | -1 = -1;

// Géométrie de la patte (repère de l'os), mesurée sur le GLB.
/** Début de la déformation (poignet) et début de l'arrondi avant. */
const S_POIGNET = -0.05;
const S_ARRONDI = 0.28;

// Proportions de la main, en unités du repère de l'os (l'avant-bras mesure environ 0,95).
const PAUME_DOS = -0.1;
const PAUME_PAUME = 0.13;
const XC = (PAUME_DOS + PAUME_PAUME) / 2;
const EP = (PAUME_PAUME - PAUME_DOS) / 2;
/** Base des quatre doigts : w dans le paramétrage de la patte, y dans la main. */
const W_BASE = 0.12;
const Y_BASE = 0.45;
/**
 * Pouce : la bande côté pouce (q < Q_POUCE) sur toute la longueur de la patte. Il part du talon
 * de la main (w = W_POUCE), plus épais que les doigts, longe le bord de la paume tourné vers elle
 * (angle INCLINAISON_POUCE), puis s'écarte de l'index au-delà de la palmure. Son bord commun avec
 * la paume et l'index suit le même y et le même point de contact vu des deux côtés.
 */
const Q_POUCE = -0.55;
const W_POUCE = -0.55;
const BOUT_POUCE = 0.86;
const R_POUCE = 0.08;
const INCLINAISON_POUCE = 0.6;
/** Palmure entre pouce et index (y au-delà de la base de l'index), écart du pouce (z par unité). */
const PALMURE = 0.06;
const ECART_POUCE = 0.3;
/** Largeur de l'éminence thénar, ajoutée à la paume côté pouce. */
const THENAR = 0.05;
/** Effilement : rayon et écart au milieu de la main diminuent ensemble vers le bout des doigts. */
const EFFILEMENT = 0.12;
/** Demi-largeur des lignes des sillons (en q, la main fait 2 de large). */
const LIGNE = 0.035;
/** Plis côté paume : phalanges (a le long des doigts), pli de la paume (a négatif, sous les doigts). */
const PLIS_PHALANGES = [0.36, 0.68];
const PLI_PAUME = 0.22;
/** Lissage des bouts des doigts : part de la moyenne des voisins par passe, nombre de passes. */
const LISSAGE_BOUT = 0.5;
const PASSES_LISSAGE = 2;

interface Doigt {
  /** Bornes de la bande en q (main canonique : pouce du côté des q négatifs). */
  q0: number; q1: number;
  /** Base du doigt dans la main : y, z et x du centre. */
  y: number; z: number; x: number;
  /** Longueur et rayon à la base. */
  long: number; r0: number;
  /** Côté extérieur de la main (flanc arrondi de la patte) : +1 pour l'auriculaire, 0 sinon. */
  exterieur: -1 | 0 | 1;
}

/**
 * Les quatre doigts, de l'index à l'auriculaire (z croissant dans la main canonique). Ils se
 * touchent : le centre de chacun est à la somme des rayons de son voisin, la paume a leur largeur.
 */
export const DOIGTS: readonly Doigt[] = (() => {
  const rayons = [0.068, 0.07, 0.066, 0.058];
  const longueurs = [0.66, 0.74, 0.68, 0.54];
  const bases = [Y_BASE, Y_BASE + 0.01, Y_BASE, Y_BASE - 0.04];
  const bornes = [Q_POUCE, -0.12, 0.27, 0.64, 1];
  let z = -rayons.reduce((s, r) => s + r, 0);
  return rayons.map((r, k) => {
    const d: Doigt = {
      q0: bornes[k], q1: bornes[k + 1], y: bases[k], z: z + r, x: PAUME_DOS + r * 1.05,
      long: longueurs[k], r0: r, exterieur: k === 3 ? 1 : 0,
    };
    z += 2 * r;
    return d;
  });
})();
const DEMI_PAUME = DOIGTS.reduce((s, d) => s + d.r0, 0);

const borne = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lisse = (a: number, b: number, x: number) => { const k = borne((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** Disque unité → carré (« elliptical grid mapping » inverse) : (x, y) du disque → (u, v) de [-1, 1]². */
export function disqueVersCarre(x: number, y: number): [number, number] {
  const r2 = 2 * Math.SQRT2;
  const a = 2 + x * x - y * y, b = 2 - x * x + y * y;
  const u = 0.5 * Math.sqrt(Math.max(0, a + r2 * x)) - 0.5 * Math.sqrt(Math.max(0, a - r2 * x));
  const v = 0.5 * Math.sqrt(Math.max(0, b + r2 * y)) - 0.5 * Math.sqrt(Math.max(0, b - r2 * y));
  return [borne(u, -1, 1), borne(v, -1, 1)];
}

/**
 * Section d'un doigt : (v en travers de la bande, e en profondeur), dans [-1, 1]², vers un point du
 * cercle unité (dz en travers, dx vers la paume). Côté d'un voisin, le dessus et le dessous se
 * rejoignent au point de contact (v = ±1, à mi-hauteur) : sillon profond. Côté extérieur de la
 * main, le flanc de la patte devient le flanc du doigt (correspondance carré → disque).
 */
function section(v: number, e: number, exterieur: -1 | 0 | 1): [number, number] {
  if (exterieur !== 0 && v * exterieur > 0) {
    return [v * Math.sqrt(1 - (e * e) / 2), e * Math.sqrt(1 - (v * v) / 2)];
  }
  const a = (Math.PI / 2) * v;
  return [Math.sin(a), e * Math.cos(a)];
}

/** y de la paume au point w : du poignet (w = -1) à la base des doigts (w = W_BASE, y = yBase). */
const yPaume = (w: number, yBase: number) => mix(S_POIGNET, yBase, (w + 1) / (W_BASE + 1));

/** z de la paume en travers : sous chaque doigt sa largeur, côté pouce l'éminence thénar. */
function zPaume(q: number): number {
  if (q < Q_POUCE) return -DEMI_PAUME - ((Q_POUCE - Math.max(q, -1)) / (Q_POUCE + 1)) * THENAR;
  const d = DOIGTS.find((x) => q <= x.q1) ?? DOIGTS[DOIGTS.length - 1];
  return d.z - d.r0 + ((Math.min(q, 1) - d.q0) / (d.q1 - d.q0)) * 2 * d.r0;
}

/** Paume : boîte aux bords arrondis, (q, e) en travers et en profondeur, au point w. */
function paume(q: number, w: number, e: number, yBase: number): Point3 {
  const k = (w + 1) / (W_BASE + 1);
  const bord = lisse(0.6, 1, Math.abs(q));
  // Talon de la main : la paume est plus épaisse côté poignet.
  const epaisseur = EP * mix(1.15, 1, lisse(0, 0.6, k));
  return {
    x: XC + e * epaisseur * (1 - 0.5 * bord * bord),
    y: yPaume(w, yBase),
    z: zPaume(q) + Math.sign(q) * 0.035 * bord * (1 - e * e),
  };
}

/**
 * Calotte du bout d'un tube : la face avant de l'orteil, (v, e) dans [-1, 1]², devient une
 * demi-sphère. Le centre de la face donne le bout, son bord le cercle où finit le tube, dans la
 * même direction que la section du tube (le bord commun avec un voisin tombe sur le flanc).
 * Rend (dz, dx) dans la section et dy le long de l'axe, pour un rayon 1.
 */
function calotte(v: number, e: number, exterieur: -1 | 0 | 1): [number, number, number] {
  const rho = Math.min(1, Math.max(Math.abs(v), Math.abs(e)));
  if (rho < 1e-6) return [0, 0, 1];
  const [sz, sx] = section(v / rho, e / rho, exterieur);
  const l = Math.hypot(sz, sx) || 1;
  const th = (rho * Math.PI) / 2;
  return [(Math.sin(th) * sz) / l, (Math.sin(th) * sx) / l, Math.cos(th)];
}

/** Rayon du bout d'un tube de rayon de base r0 (effilé). */
const rayonBout = (r0: number) => r0 * (1 - EFFILEMENT);

/**
 * Point d'un tube arrondi au bout (doigt ou pouce) : a = 0 à la base, 1 à la fin du tube, (v, e)
 * la section. `finV` : longueur du tube sur la ligne v (plus courte près d'un voisin plus court).
 * `centre` donne le centre de la section (z, x) à la distance lambda de la base. La face avant de
 * l'orteil (au bout, |e| < 1) devient la calotte.
 */
function pointTube(
  y0: number, long: number, r0: number, v: number, a: number, e: number, finV: number,
  exterieur: -1 | 0 | 1, centre: (lambda: number, f: number) => [number, number],
): Point3 {
  const rb = rayonBout(r0), lc = long - rb;
  const lambda = Math.min(a, 1) * finV;
  const f = 1 - EFFILEMENT * borne(lambda / long, 0, 1);
  const [sz, sx] = section(borne(v, -1, 1), borne(e, -1, 1), exterieur);
  const [zc, xc] = centre(lambda, f);
  const tube = { x: xc + sx * r0 * f, y: y0 + lambda, z: zc + sz * r0 * f };
  const b = lisse(0.8, 0.97, a) * (1 - lisse(0.7, 0.97, Math.abs(e))) * (1 - lisse(0.8, 1, Math.abs(v)));
  if (b <= 0) return tube;
  const [cz, cx, cy] = calotte(borne(v, -1, 1), borne(e, -1, 1), exterieur);
  const [zb, xb] = centre(lc, 1 - EFFILEMENT * (lc / long));
  return {
    x: mix(tube.x, xb + cx * rb, b),
    y: mix(tube.y, y0 + lc + cy * rb, b),
    z: mix(tube.z, zb + cz * rb, b),
  };
}

/** Longueur du tube sur la ligne v : jusqu'à la calotte au milieu, jusqu'au bord commun sur les bords. */
function longueurBande(lc: number, v: number, gauche: number, droite: number): number {
  return mix(lc, Math.min(lc, v < 0 ? gauche : droite), lisse(0.75, 1, Math.abs(v)));
}

/**
 * Fin (y absolu) du bord commun de deux tubes voisins (ils se touchent jusque-là) : le début de
 * la calotte du plus court.
 */
const finCommune = (finA: number, rA: number, finB: number, rB: number) => Math.min(finA - rayonBout(rA), finB - rayonBout(rB));

/** Point d'un des quatre doigts (bande k) pour un sommet de coordonnées (q, w, e). */
function dansDoigt(k: number, q: number, w: number, e: number): Point3 {
  const d = DOIGTS[k];
  const v = (2 * (q - d.q0)) / (d.q1 - d.q0) - 1;
  const g = k > 0 ? DOIGTS[k - 1] : null, dr = DOIGTS[k + 1];
  const lc = d.long - rayonBout(d.r0);
  // Bord commun : la même fin vue des deux doigts voisins (le pouce à gauche de l'index).
  const finG = (g ? finCommune(g.y + g.long, g.r0, d.y + d.long, d.r0) : FIN_POUCE_INDEX) - d.y;
  const finD = dr ? finCommune(d.y + d.long, d.r0, dr.y + dr.long, dr.r0) - d.y : lc;
  const finV = longueurBande(lc, borne(v, -1, 1), finG, finD);
  const a = (w - W_BASE) / (1 - W_BASE);
  const doigt = pointTube(d.y, d.long, d.r0, v, a, e, finV, d.exterieur, (_l, f) => [d.z * f, d.x]);
  const p = paume(q, w, e, d.y);
  const t = lisse(-0.12, 0.12, a);
  return { x: mix(p.x, doigt.x, t), y: mix(p.y, doigt.y, t), z: mix(p.z, doigt.z, t) };
}

/**
 * Fin du bord commun du pouce et de l'index (y) : la palmure, un peu au-delà de la base de
 * l'index. Plus loin, le pouce est libre et s'écarte de l'index (ECART_POUCE).
 */
const FIN_POUCE_INDEX = DOIGTS[0].y + PALMURE;

/**
 * Bord commun du pouce avec la paume puis l'index, pour un w : y et point de contact (z, x), tels
 * que la paume puis l'index les donnent, jusqu'à la palmure.
 */
function bordPouce(w: number): Point3 {
  const d = DOIGTS[0];
  if (w <= W_BASE) return { x: XC, y: yPaume(w, d.y), z: -DEMI_PAUME };
  const a = borne((w - W_BASE) / (1 - W_BASE), 0, 1);
  const lambda = a * (FIN_POUCE_INDEX - d.y);
  const f = 1 - EFFILEMENT * (lambda / d.long);
  const t = lisse(-0.12, 0.12, a);
  return { x: mix(XC, d.x, t), y: d.y + lambda, z: mix(-DEMI_PAUME, (d.z - d.r0) * f, t) };
}

/**
 * Point du pouce (bande q < Q_POUCE). Le long : du talon (w = W_POUCE) au bout (BOUT_POUCE), le
 * côté collé à la paume suivant son bord, puis la palmure. En travers : la section d'un doigt,
 * tournée vers la paume, dont le point de contact (v = +1) est sur ce bord.
 */
function dansPouce(q: number, w: number, e: number): Point3 {
  const v = borne((2 * (Math.max(q, -1) + 1)) / (Q_POUCE + 1) - 1, -1, 1);
  const a = (w - W_POUCE) / (1 - W_POUCE);
  const y0 = yPaume(W_POUCE, DOIGTS[0].y);
  const long = BOUT_POUCE - y0;
  const lc = long - rayonBout(R_POUCE);
  const finV = longueurBande(lc, v, lc, FIN_POUCE_INDEX - y0);
  // Bord commun au même y que la paume et l'index : la ligne v = +1 suit `bordPouce`.
  const contact = bordPouce(w);
  const c = Math.cos(INCLINAISON_POUCE), s = Math.sin(INCLINAISON_POUCE);
  // Talon : le pouce sort de la paume (rayon qui monte depuis W_POUCE).
  const naissance = lisse(-0.1, 0.25, a);
  // Section tournée vers la paume : le contact (1, 0) va en (cos, -sin), le centre de l'autre côté.
  const tourne = (p: Point3, base: Point3): Point3 => {
    const dz = p.z - base.z, dx = p.x - base.x;
    return { x: base.x + (-dz * s + dx * c) * naissance, y: p.y, z: base.z + (dz * c + dx * s) * naissance };
  };
  // Tube du pouce dans son propre repère (axe y, centre en 0), puis tourné et posé contre le bord.
  const brut = pointTube(0, long, R_POUCE, v, a, e, finV, -1, () => [0, 0]);
  const r = R_POUCE * (1 - EFFILEMENT * borne(brut.y / long, 0, 1)) * naissance;
  // Au-delà de la palmure, le pouce s'écarte de l'index.
  const ecart = ECART_POUCE * Math.max(0, y0 + brut.y - FIN_POUCE_INDEX);
  const centre = { x: contact.x + s * r, y: 0, z: contact.z - c * r - ecart };
  const p0 = tourne({ x: centre.x + brut.x, y: 0, z: centre.z + brut.z }, centre);
  const yP = mix(y0 + brut.y, contact.y, lisse(0.35, 1, v) * (1 - lisse(0.8, 0.97, a) * (1 - lisse(0.7, 0.97, Math.abs(e)))));
  const pouce = { x: p0.x, y: yP, z: p0.z };
  const p = paume(q, w, e, DOIGTS[0].y);
  const t = lisse(-0.15, 0.1, a);
  return { x: mix(p.x, pouce.x, t), y: mix(p.y, pouce.y, t), z: mix(p.z, pouce.z, t) };
}

/**
 * Demi-largeur du mélange entre deux bandes voisines (en q). Presque nulle : au bord commun, les
 * deux bandes donnent déjà le même point (point de contact, même y), le mélange ne fait que lisser
 * les petits écarts. Plus large, il tirerait les côtés d'un doigt vers son voisin (membrane).
 */
const FONDU = 0.01;

/**
 * Correspondance patte → main dans la main canonique (pouce du côté z négatif) : (q, w, e) vers un
 * point de la main. Continue partout : deux bandes voisines sont mélangées sur ±`FONDU` autour
 * de leur bord.
 */
export function mainCanonique(q: number, w: number, e: number): Point3 {
  let x = 0, y = 0, z = 0, somme = 0;
  const ajouter = (p: Point3, poids: number) => { x += p.x * poids; y += p.y * poids; z += p.z * poids; somme += poids; };
  const pouce = 1 - lisse(Q_POUCE - FONDU, Q_POUCE + FONDU, q);
  if (pouce > 1e-6) ajouter(dansPouce(q, w, e), pouce);
  for (let k = 0; k < DOIGTS.length; k++) {
    const d = DOIGTS[k];
    const g = lisse(d.q0 - FONDU, d.q0 + FONDU, q);
    const dr = k === DOIGTS.length - 1 ? 1 : 1 - lisse(d.q1 - FONDU, d.q1 + FONDU, q);
    if (g * dr > 1e-6) ajouter(dansDoigt(k, q, w, e), g * dr);
  }
  return { x: x / somme, y: y / somme, z: z / somme };
}

/** Doigt d'un point de la main canonique : -1 pour le pouce, 0 à 3 de l'index à l'auriculaire. */
function doigtDe(q: number): number {
  if (q < Q_POUCE) return -1;
  const k = DOIGTS.findIndex((d) => q <= d.q1);
  return k < 0 ? DOIGTS.length - 1 : k;
}

/** Sens de q dans la main canonique : le pouce du côté `COTE_POUCE` du repère de l'os. */
const SENS = -COTE_POUCE;

/** `mainCanonique` orientée : le pouce du côté `COTE_POUCE` (q et z changent de signe ensemble). */
export function versMain(c: CoordPatte): Point3 {
  const p = mainCanonique(c.q * SENS, c.w, c.e);
  return { x: p.x, y: p.y, z: p.z * SENS };
}

const glsl = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/**
 * Code du nuanceur de fragments (GLSL, inséré après `#include <map_fragment>`), qui lit le
 * varying `vMainHumaine` = (atténuation × poids de la déformation, q, w, e) de chaque fragment :
 * - paume de peau : la couleur de la texture est mélangée à `couleurPeau` sur la face de la
 *   paume (e > 0), en proportion du poids de la déformation,
 * - sillons : une ligne sombre sur chaque bord commun de deux doigts (et du pouce), tracée au
 *   fragment près. Le matériau est sans éclairage et un sommet ombré ne donnerait qu'un dégradé
 *   large d'un triangle : la ligne se calcule ici sur q interpolé, aussi fine que voulu,
 * - plis de la paume et des phalanges, côté paume, plus légers.
 */
export function nuanceurMainHumaine(): string {
  const bornes = DOIGTS.slice(1).map((d) => d.q0);
  const sillons = bornes.map((b) => `mhL = max(mhL, 1.0 - smoothstep(0.0, ${glsl(LIGNE)}, abs(mhQ - ${glsl(b)})));`);
  return [
    "if ( vMainHumaine.x > 0.001 ) {",
    "float mhK = clamp( vMainHumaine.x, 0.0, 1.0 );",
    "float mhQ = vMainHumaine.y, mhW = vMainHumaine.z, mhE = vMainHumaine.w;",
    `float mhA = ( mhW - ${glsl(W_BASE)} ) / ${glsl(1 - W_BASE)};`,
    `float mhAP = ( mhW - ${glsl(W_POUCE)} ) / ${glsl(1 - W_POUCE)};`,
    "float mhL = 0.0;",
    ...sillons,
    "mhL *= smoothstep( -0.25, 0.0, mhA );",
    `mhL = max( mhL, ( 1.0 - smoothstep( 0.0, ${glsl(LIGNE)}, abs( mhQ - ${glsl(Q_POUCE)} ) ) ) * smoothstep( 0.0, 0.25, mhAP ) );`,
    "float mhP = smoothstep( 0.2, 0.6, mhE );",
    "float mhPli = 0.0;",
    `if ( mhQ > ${glsl(Q_POUCE)} ) {`,
    ...PLIS_PHALANGES.map((a) => `mhPli = max( mhPli, 1.0 - smoothstep( 0.0, 0.03, abs( mhA - ${glsl(a)} ) ) );`),
    `mhPli = max( mhPli, ( 1.0 - smoothstep( 0.0, 0.035, abs( mhA + ${glsl(PLI_PAUME)} + 0.06 * mhQ ) ) ) * smoothstep( -0.6, -0.2, mhQ ) );`,
    "}",
    "float mhClarte = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );",
    "vec3 mhPeau = couleurPeau * ( 0.82 + 0.3 * clamp( mhClarte, 0.0, 1.0 ) );",
    "diffuseColor.rgb = mix( diffuseColor.rgb, mhPeau, mhK * mhP );",
    "diffuseColor.rgb *= 1.0 - mhK * clamp( 0.72 * mhL + 0.24 * mhPli * mhP, 0.0, 0.8 );",
    "}",
  ].join("\n");
}

// Paramétrage de la patte à partir des sommets.

/** Applique une matrice 4 × 4 (colonnes) à un point. */
function appliquer(m: Matrice, x: number, y: number, z: number): Point3 {
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
  };
}

/** Direction unitaire (partie linéaire de la matrice seulement). */
function direction(m: Matrice, x: number, y: number, z: number): Point3 {
  const d = { x: m[0] * x + m[4] * y + m[8] * z, y: m[1] * x + m[5] * y + m[9] * z, z: m[2] * x + m[6] * y + m[10] * z };
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  return { x: d.x / l, y: d.y / l, z: d.z / l };
}

/** Inverse d'une matrice affine 4 × 4 (colonnes). */
export function inverseAffine(m: Matrice): number[] {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const k = 1 / det;
  const r = [
    (e * i - f * h) * k, (f * g - d * i) * k, (d * h - e * g) * k, 0,
    (c * h - b * i) * k, (a * i - c * g) * k, (b * g - a * h) * k, 0,
    (b * f - c * e) * k, (c * d - a * f) * k, (a * e - b * d) * k, 0,
    0, 0, 0, 1,
  ];
  const t = appliquer(r, m[12], m[13], m[14]);
  r[12] = -t.x; r[13] = -t.y; r[14] = -t.z;
  return r;
}

/** Profil lissé (moyenne glissante sur ±n cases, cases vides remplies par les voisines). */
function lisser(v: number[], n: number): number[] {
  const plein = v.slice();
  for (let k = 0; k < plein.length; k++) {
    if (!Number.isNaN(plein[k])) continue;
    let g = k - 1, d = k + 1;
    while (g >= 0 && Number.isNaN(plein[g])) g--;
    while (d < plein.length && Number.isNaN(plein[d])) d++;
    plein[k] = g >= 0 && d < plein.length ? (plein[g] + plein[d]) / 2 : g >= 0 ? plein[g] : plein[d];
  }
  return plein.map((_, k) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, k - n); j <= Math.min(plein.length - 1, k + n); j++) { s += plein[j]; c++; }
    return s / c;
  });
}

const fini = (x: number) => (Number.isFinite(x) ? x : NaN);

/**
 * Coordonnées (q, w, e) des sommets de la patte, à partir de leurs positions et de leurs normales
 * (unitaires) dans le repère de l'os. Le contour (vue de dessus) est mesuré sur les sommets.
 */
export function coordonneesPatte(locaux: readonly Point3[], normales: readonly Point3[]): CoordPatte[] {
  // Partie arrière : bords en travers par tranche de y. Haut de la patte (x < -0,3) exclu.
  const NB = 16;
  const tranche = (y: number) => borne(Math.floor(((y - S_POIGNET) / (S_ARRONDI - S_POIGNET)) * NB), 0, NB - 1);
  const zmin = new Array<number>(NB).fill(Infinity), zmax = new Array<number>(NB).fill(-Infinity);
  // Avant : rayon du contour par direction autour du centre de l'arrondi.
  const NA = 24;
  const rayon = new Array<number>(NA).fill(-Infinity);
  let zc = 0, n = 0;
  for (const p of locaux) if (p.y > S_POIGNET && p.y < S_ARRONDI && p.x > -0.3) { zc += p.z; n++; }
  zc = n ? zc / n : 0;
  const angle = (p: Point3) => Math.atan2(p.z - zc, p.y - S_ARRONDI);
  for (const p of locaux) {
    if (p.x < -0.3) continue;
    if (p.y >= S_ARRONDI) {
      const k = borne(Math.floor(((angle(p) + Math.PI / 2) / Math.PI) * NA), 0, NA - 1);
      rayon[k] = Math.max(rayon[k], Math.hypot(p.z - zc, p.y - S_ARRONDI));
    } else if (p.y > S_POIGNET - 0.1) {
      const k = tranche(p.y);
      zmin[k] = Math.min(zmin[k], p.z); zmax[k] = Math.max(zmax[k], p.z);
    }
  }
  const rayonL = lisser(rayon.map((r) => (r > 0 ? r : NaN)), 1);
  const zminL = lisser(zmin.map(fini), 1);
  const zmaxL = lisser(zmax.map(fini), 1);
  const qw = locaux.map((p) => {
    if (p.y >= S_ARRONDI) {
      const g = angle(p);
      const f = ((g + Math.PI / 2) / Math.PI) * NA - 0.5;
      const k0 = borne(Math.floor(f), 0, NA - 1), k1 = borne(k0 + 1, 0, NA - 1);
      const R = mix(rayonL[k0], rayonL[k1], borne(f - k0, 0, 1));
      const r = Math.min(1, Math.hypot(p.z - zc, p.y - S_ARRONDI) / R);
      const [q, w] = disqueVersCarre(Math.sin(g) * r, Math.cos(g) * r);
      return { q, w };
    }
    const f = ((p.y - S_POIGNET) / (S_ARRONDI - S_POIGNET)) * NB - 0.5;
    const k0 = borne(Math.floor(f), 0, NB - 1), k1 = borne(k0 + 1, 0, NB - 1);
    const t = borne(f - k0, 0, 1);
    const g = mix(zminL[k0], zminL[k1], t), d = mix(zmaxL[k0], zmaxL[k1], t);
    // Côtés : raccord continu avec le contour avant (rayon des directions extrêmes).
    const lien = lisse(0.6, 1, (p.y - S_POIGNET) / (S_ARRONDI - S_POIGNET));
    const gauche = mix(zc - g, rayonL[0], lien), droite = mix(d - zc, rayonL[NA - 1], lien);
    const q = borne(p.z < zc ? (p.z - zc) / gauche : (p.z - zc) / droite, -1, 1);
    const w = borne(-1 + (p.y - S_POIGNET) / (S_ARRONDI - S_POIGNET), -1.5, 0);
    return { q, w };
  });
  // Bord avant festonné (creux entre les orteils) : w est ramené à 1 sur tout le bord avant, par
  // tranche fine de q, pour que les creux ne fassent pas d'encoches au milieu des doigts.
  const NF = 40;
  const tq = (q: number) => borne(Math.floor(((q + 1) / 2) * NF), 0, NF - 1);
  const wMax = new Array<number>(NF).fill(NaN);
  qw.forEach((c, i) => {
    if (c.w < 0.5 || (locaux[i].x < -0.3 && locaux[i].y < S_ARRONDI)) return;
    const k = tq(c.q);
    wMax[k] = Number.isNaN(wMax[k]) ? c.w : Math.max(wMax[k], c.w);
  });
  const wMaxL = lisser(wMax, 0);
  for (const c of qw) {
    if (c.w <= 0.5) continue;
    const f = ((c.q + 1) / 2) * NF - 0.5;
    const k0 = borne(Math.floor(f), 0, NF - 1), k1 = borne(k0 + 1, 0, NF - 1);
    const m = Math.max(0.6, mix(wMaxL[k0], wMaxL[k1], borne(f - k0, 0, 1)));
    c.w = Math.min(1, 0.5 + ((c.w - 0.5) * 0.5) / (m - 0.5));
  }
  // Profondeur. Sur le dessus et sous la plante, la normale (x vers la plante) donne ±1. Sur les
  // flancs et la face avant des orteils, la normale est horizontale : la hauteur du sommet entre
  // le dessus et le dessous de la patte (mesurés par case (q, w), lissés) prend le relais.
  const NQ = 8, NW = 10;
  const cq = (q: number) => borne(Math.floor(((q + 1) / 2) * NQ), 0, NQ - 1);
  const cw = (w: number) => borne(Math.floor(((w + 1) / 2) * NW), 0, NW - 1);
  const hauts = new Array<number>(NQ * NW).fill(Infinity);
  const bas = new Array<number>(NQ * NW).fill(-Infinity);
  locaux.forEach((p, i) => {
    if (p.x < -0.3 && p.y < S_ARRONDI) return;
    const k = cq(qw[i].q) * NW + cw(qw[i].w);
    hauts[k] = Math.min(hauts[k], p.x); bas[k] = Math.max(bas[k], p.x);
  });
  const lisse2 = (t: number[]) => {
    const lignes: number[][] = [];
    for (let a = 0; a < NQ; a++) lignes.push(lisser(t.slice(a * NW, (a + 1) * NW).map(fini), 1));
    const out = new Array<number>(NQ * NW);
    for (let b = 0; b < NW; b++) {
      const col = lisser(lignes.map((l) => l[b]), 1);
      for (let a = 0; a < NQ; a++) out[a * NW + b] = col[a];
    }
    return out;
  };
  const H = lisse2(hauts), B = lisse2(bas);
  const interp = (T: number[], q: number, w: number) => {
    const fq = borne(((q + 1) / 2) * NQ - 0.5, 0, NQ - 1), fw = borne(((w + 1) / 2) * NW - 0.5, 0, NW - 1);
    const a0 = Math.floor(fq), b0 = Math.floor(fw), a1 = Math.min(NQ - 1, a0 + 1), b1 = Math.min(NW - 1, b0 + 1);
    const ta = fq - a0, tb = fw - b0;
    return mix(mix(T[a0 * NW + b0], T[a0 * NW + b1], tb), mix(T[a1 * NW + b0], T[a1 * NW + b1], tb), ta);
  };
  return locaux.map((p, i) => {
    const { q, w } = qw[i];
    const h = interp(H, q, w), b = interp(B, q, w);
    const ePos = b - h > 1e-4 ? borne((2 * (p.x - h)) / (b - h) - 1, -1, 1) : 0;
    const eNor = borne(1.5 * normales[i].x, -1, 1);
    return { q, w, e: mix(ePos, eNor, Math.min(1, Math.abs(normales[i].x) * 1.4)) };
  });
}

/**
 * Cible de déformation de la patte : chaque sommet influencé par `mainD` est envoyé vers son point
 * de la main. Les sommets partagés avec l'avant-bras (poids de `mainD` faible), ceux du poignet et
 * du haut de la patte reçoivent un déplacement atténué : l'avant-bras et la main restent raccordés.
 */
export function construireMainHumaine(d: EntreeMainHumaine): SortieMainHumaine {
  const n = d.positions.length / 3;
  const deplacements = new Float32Array(n * 3);
  const reperes = new Float32Array(n * 4);
  const versGeo = inverseAffine(d.versOs);
  // Sommets de la patte, soudés par position : le GLB double les sommets le long des coutures de
  // texture, chaque doublon doit recevoir exactement le même déplacement (sinon la couture s'ouvre).
  const groupeDe = new Map<number, number>();
  const parCle = new Map<string, number>();
  const membres: number[][] = [], poidsMain: number[] = [], locaux: Point3[] = [], sommesN: Point3[] = [];
  for (let i = 0; i < n; i++) {
    let w = 0;
    for (let j = 0; j < 4; j++) if (d.indicesOs[i * 4 + j] === d.osMain) w += d.poidsOs[i * 4 + j];
    if (w <= 0) continue;
    const x = d.positions[i * 3], y = d.positions[i * 3 + 1], z = d.positions[i * 3 + 2];
    const cle = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    let g = parCle.get(cle);
    if (g === undefined) {
      g = membres.length;
      parCle.set(cle, g);
      membres.push([]); poidsMain.push(w); locaux.push(appliquer(d.versOs, x, y, z)); sommesN.push({ x: 0, y: 0, z: 0 });
    }
    membres[g].push(i);
    groupeDe.set(i, g);
    const nn = direction(d.versOs, d.normales[i * 3], d.normales[i * 3 + 1], d.normales[i * 3 + 2]);
    sommesN[g].x += nn.x; sommesN[g].y += nn.y; sommesN[g].z += nn.z;
  }
  const normales = sommesN.map((v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; });
  const coords = coordonneesPatte(locaux, normales);
  // Cible de chaque sommet (repère de l'os), atténuée près du poignet et en haut de la patte.
  const att = locaux.map((p, k) => {
    // Haut de la patte, là où elle rejoint l'avant-bras (au-dessus du dessus des orteils) : immobile.
    const haut = p.y < S_ARRONDI ? lisse(0.2, 0.36, -p.x) : 0;
    return lisse(0.15, 0.6, poidsMain[k]) * lisse(-1.05, -0.55, coords[k].w) * (1 - haut);
  });
  let cibles = locaux.map((p, k) => {
    if (att[k] <= 0) return p;
    const m = versMain(coords[k]);
    return { x: mix(p.x, m.x, att[k]), y: mix(p.y, m.y, att[k]), z: mix(p.z, m.z, att[k]) };
  });
  // Bouts des doigts : les orteils n'ont que quelques sommets, la correspondance y laisse des
  // pointes. Quelques passes de lissage (moyenne des voisins du même doigt) arrondissent les bouts.
  if (d.indices) {
    const voisins: Array<Set<number>> = locaux.map(() => new Set<number>());
    for (let t = 0; t + 2 < d.indices.length; t += 3) {
      for (let j = 0; j < 3; j++) {
        const a = groupeDe.get(d.indices[t + j]), b = groupeDe.get(d.indices[t + ((j + 1) % 3)]);
        if (a === undefined || b === undefined || a === b) continue;
        if (doigtDe(coords[a].q * SENS) !== doigtDe(coords[b].q * SENS)) continue;
        voisins[a].add(b); voisins[b].add(a);
      }
    }
    const force = locaux.map((_, k) => att[k] * LISSAGE_BOUT * lisse(0.7, 0.95, (coords[k].w - W_BASE) / (1 - W_BASE)));
    for (let passe = 0; passe < PASSES_LISSAGE; passe++) {
      cibles = cibles.map((p, k) => {
        if (force[k] <= 0 || !voisins[k].size) return p;
        let x = 0, y = 0, z = 0;
        for (const v of voisins[k]) { x += cibles[v].x; y += cibles[v].y; z += cibles[v].z; }
        const m = voisins[k].size;
        return { x: mix(p.x, x / m, force[k]), y: mix(p.y, y / m, force[k]), z: mix(p.z, z / m, force[k]) };
      });
    }
  }
  let deplaces = 0;
  membres.forEach((liste, k) => {
    if (att[k] <= 0) return;
    const c = coords[k], g = appliquer(versGeo, cibles[k].x, cibles[k].y, cibles[k].z);
    for (const i of liste) {
      deplacements[i * 3] = g.x - d.positions[i * 3];
      deplacements[i * 3 + 1] = g.y - d.positions[i * 3 + 1];
      deplacements[i * 3 + 2] = g.z - d.positions[i * 3 + 2];
      reperes[i * 4] = att[k];
      reperes[i * 4 + 1] = c.q * SENS;
      reperes[i * 4 + 2] = c.w;
      reperes[i * 4 + 3] = c.e;
      deplaces++;
    }
  });
  return { deplacements, reperes, deplaces };
}
