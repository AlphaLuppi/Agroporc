/**
 * Rocket Muche : carrosseries des voitures (skins). PUR : sans three, sans DOM, sans horloge ni hasard global ; importable par l'interface
 * (aperçu du lobby) comme par le rendu (`rendu.ts`, qui en extrude les volumes).
 *
 * VISUEL SEUL, comme dans Rocket League où plusieurs voitures partagent une même hitbox : la boîte de collision, les roues physiques et toute
 * la simulation restent ceux de l'Octane (`VOITURE`), quel que soit le skin ; rien ici n'est lu par la physique (`empreinteMonde` inchangée).
 *
 * Aucun modèle 3D libre de ces voitures n'était téléchargeable sans compte : les trois voitures de série sont dessinées ici, dans le style
 * filaire du jeu, d'après leurs dimensions de fiche constructeur (longueur, empattement, hauteur, garde au sol, porte-à-faux) :
 *  - Peugeot 308 III (2021) : 4,367 × 1,852 × 1,441 m, empattement 2,675 m. Compacte bicorps, capot long, pavillon fuyant ; phares fins
 *    prolongés d'un « croc » vertical, feux arrière à trois griffes.
 *  - Peugeot 2008 II (2019) : 4,300 × 1,770 × 1,550 m, empattement 2,605 m. SUV urbain : garde au sol haute, capot plat, pavillon droit et
 *    barres de toit, trois crocs verticaux à l'avant, trois griffes à l'arrière.
 *  - Kia Rio IV (2017) : 4,065 × 1,725 × 1,450 m, empattement 2,580 m. Citadine : capot court, calandre « tiger nose » pincée entre deux
 *    phares effilés, hayon.
 *
 * Mise à l'échelle : les passages de roue doivent tomber sur les roues PHYSIQUES (celles de l'Octane, dessinées par le rendu). Le profil réel
 * est donc mis à l'échelle sur l'empattement (0,85 m entre les essieux de l'Octane, facteur ≈ 0,32 : une voiture d'environ 1,35 à 1,40 m, un
 * peu plus longue que la hitbox de 1,21 m, comme les voitures de RL qui débordent de leur boîte), étiré de 10 % en hauteur parce que les roues
 * de RL sont plus grosses que celles d'une citadine (sinon les passages crèveraient le capot). La largeur, elle, est celle de la hitbox, pour
 * couvrir les roues (proportions trapues de Rocket League) ; l'habitacle est plus étroit que la caisse (épaulement visible).
 *
 * Repère : comme `rendu-modele.ts`, [avant, droite, haut] en mètres depuis l'origine de la voiture ; le sol est à `-VOITURE.hauteurRepos`.
 */
import { SKINS, VOITURE, type SkinVoiture } from "./contrat";

export type Point2 = readonly [number, number];
export type Point3 = readonly [number, number, number];

/** Un volume extrudé : profil latéral (avant, haut), sens trigonométrique, centré sur la largeur `largeur`. */
export interface VolumeSkin {
  profil: readonly Point2[];
  largeur: number;
}
/** Boîte annexe (aileron, rétroviseur, barre de toit) : centre et taille [avant, droite, haut]. */
export interface PieceSkin {
  c: Point3;
  t: Point3;
}
/** Modèle d'une carrosserie, repère de la voiture [avant, droite, haut] (m). */
export interface ModeleSkin {
  id: SkinVoiture;
  /** volumes extrudés (caisse puis habitacle) */
  volumes: readonly VolumeSkin[];
  pieces: readonly PieceSkin[];
  /** arêtes de détail (feux, calandre, montants, ligne de caisse) : paires de points à plat [a, d, h, a, d, h, …] */
  segments: readonly number[];
  /** index (dans `segments`) du premier segment tracé sur les flancs (ligne de caisse, montants) : ce que montre l'aperçu de profil */
  debutFlanc: number;
  /** sortie de la flamme du boost */
  echappement: Point3;
  /** coin arrière DROIT de la traînée supersonique (le gauche est son miroir) */
  coinArriere: Point3;
}

// ============================================================================================================================
// 1. Octane (le défaut, profil historique du rendu)
// ============================================================================================================================

/** Profil latéral (avant, haut) en mètres, dans le repère de la voiture, dans le sens trigonométrique. */
export const PROFIL_OCTANE: readonly Point2[] = [
  [-0.45, 0.05], [0.72, 0.05], [0.73, 0.15], [0.62, 0.22], [0.3, 0.27], [0.1, 0.385], [-0.12, 0.388], [-0.3, 0.28], [-0.45, 0.25],
];
export const LARGEUR_OCTANE = VOITURE.hitbox.largeur;
/** Pièces annexes : aileron et supports (centre [avant, droite, haut] et taille [avant, droite, haut]). */
export const PIECES_OCTANE: readonly PieceSkin[] = [
  { c: [-0.43, 0, 0.31], t: [0.16, 0.84, 0.025] },
  { c: [-0.39, 0.25, 0.27], t: [0.05, 0.035, 0.08] },
  { c: [-0.39, -0.25, 0.27], t: [0.05, 0.035, 0.08] },
];
/** Position de l'échappement (flamme du boost), repère [avant, droite, haut]. */
export const ECHAPPEMENT_OCTANE: Point3 = [-0.46, 0, 0.14];

const OCTANE: ModeleSkin = {
  id: "octane",
  volumes: [{ profil: PROFIL_OCTANE, largeur: LARGEUR_OCTANE }],
  pieces: PIECES_OCTANE,
  segments: [],
  debutFlanc: 0,
  echappement: ECHAPPEMENT_OCTANE,
  coinArriere: [-0.4, 0.38, 0.2],
};

/** Description de chaque carrosserie (infobulle du lobby). */
export const DESCRIPTIONS_SKIN: Readonly<Record<SkinVoiture, string>> = {
  octane: "L'Octane de Rocket League, la voiture d'origine.",
  "308": "Peugeot 308 (2021) : compacte au capot long, phares à croc, feux à trois griffes.",
  "2008": "Peugeot 2008 (2019) : SUV urbain haut sur pattes, trois crocs à l'avant, barres de toit.",
  rio: "Kia Rio (2017) : citadine courte, calandre « tiger nose ».",
};

// ============================================================================================================================
// 2. Voitures de série : définitions en vraies grandeurs
// ============================================================================================================================

/** Une polyligne de détail sur la face avant ou arrière : points (droite en m du MODÈLE, haut en m RÉELS) ; `miroir` la double à gauche. */
interface FeuReel {
  cote: "avant" | "arriere";
  pts: readonly Point2[];
  miroir: boolean;
}
/** Définition d'une voiture de série. `a` en m RÉELS depuis l'essieu arrière (+ vers l'avant), `h` en m RÉELS au-dessus du sol. */
export interface DefinitionSkin {
  /** fiche constructeur (m), pour la documentation et les tests */
  fiche: { longueur: number; largeur: number; hauteur: number; empattement: number };
  /** hauteur du bas de caisse (m) */
  bas: number;
  /** contour de la caisse, du bas de l'avant au bas de l'arrière en passant par le capot et la ligne de caisse ([a, h] réels) */
  dessus: readonly Point2[];
  /** habitacle (pare-brise, pavillon, lunette), polygone dans le sens trigonométrique, posé un peu sous la ligne de caisse */
  cabine: readonly Point2[];
  /** largeurs de la caisse et de l'habitacle (m du MODÈLE) */
  largeurCaisse: number;
  largeurCabine: number;
  /** montants (a réels) tracés sur les flancs de l'habitacle */
  montants: readonly number[];
  feux: readonly FeuReel[];
  /** pièces : centre [a réel, droite modèle, h réel], taille en m du modèle */
  pieces: readonly PieceSkin[];
  /** échappement : [h réel, droite modèle] ; coin de la traînée : [h réel, droite modèle] */
  echappement: Point2;
  coinArriere: Point2;
}

export const DEFINITIONS_SKIN: Readonly<Record<Exclude<SkinVoiture, "octane">, DefinitionSkin>> = {
  // Peugeot 308 III : porte-à-faux avant 0,89 m, arrière 0,80 m ; pare-brise très couché, pavillon fuyant jusqu'au hayon
  "308": {
    fiche: { longueur: 4.367, largeur: 1.852, hauteur: 1.441, empattement: 2.675 },
    bas: 0.16,
    dessus: [
      [3.45, 0.16], [3.56, 0.3], [3.565, 0.5], [3.52, 0.66], [3.3, 0.76], [2.35, 0.88],
      [-0.45, 1.0], [-0.75, 0.92], [-0.8, 0.7], [-0.8, 0.4], [-0.72, 0.16],
    ],
    cabine: [[-0.5, 0.95], [2.4, 0.85], [1.4, 1.4], [0.95, 1.441], [0.2, 1.425], [-0.12, 1.38], [-0.47, 0.99]],
    largeurCaisse: 0.86,
    largeurCabine: 0.66,
    montants: [1.15, 0.15],
    feux: [
      // phare fin le long du capot, prolongé du croc qui descend dans le bouclier
      { cote: "avant", pts: [[0.2, 0.64], [0.37, 0.62], [0.33, 0.36]], miroir: true },
      // trois griffes horizontales à chaque coin arrière
      { cote: "arriere", pts: [[0.22, 0.8], [0.38, 0.8]], miroir: true },
      { cote: "arriere", pts: [[0.24, 0.84], [0.38, 0.84]], miroir: true },
      { cote: "arriere", pts: [[0.26, 0.88], [0.38, 0.88]], miroir: true },
      // calandre sans cadre : une large bande au milieu du bouclier
      { cote: "avant", pts: [[-0.16, 0.45], [0.16, 0.45]], miroir: false },
    ],
    pieces: [
      { c: [2.1, 0.45, 0.98], t: [0.05, 0.06, 0.035] },
      { c: [2.1, -0.45, 0.98], t: [0.05, 0.06, 0.035] },
      // becquet au bout du pavillon
      { c: [-0.16, 0, 1.385], t: [0.06, 0.6, 0.015] },
    ],
    echappement: [0.32, 0.22],
    coinArriere: [0.62, 0.36],
  },
  // Peugeot 2008 II : porte-à-faux 0,84 / 0,855 m, garde au sol 0,20 m ; pavillon long et droit, lunette presque verticale
  "2008": {
    fiche: { longueur: 4.3, largeur: 1.77, hauteur: 1.55, empattement: 2.605 },
    bas: 0.22,
    dessus: [
      [3.33, 0.22], [3.44, 0.36], [3.445, 0.62], [3.4, 0.8], [3.15, 0.92], [2.3, 1.0],
      [-0.55, 1.08], [-0.8, 1.04], [-0.855, 0.8], [-0.85, 0.45], [-0.75, 0.22],
    ],
    cabine: [[-0.64, 1.03], [2.35, 0.97], [1.4, 1.5], [1.0, 1.55], [-0.15, 1.545], [-0.5, 1.47], [-0.64, 1.06]],
    largeurCaisse: 0.87,
    largeurCabine: 0.7,
    montants: [1.2, 0.05, -0.45],
    feux: [
      // phare horizontal en haut de la face avant
      { cote: "avant", pts: [[0.18, 0.76], [0.39, 0.74]], miroir: true },
      // trois crocs verticaux sous chaque phare
      { cote: "avant", pts: [[0.29, 0.66], [0.28, 0.42]], miroir: true },
      { cote: "avant", pts: [[0.33, 0.66], [0.32, 0.44]], miroir: true },
      { cote: "avant", pts: [[0.37, 0.66], [0.36, 0.46]], miroir: true },
      // trois griffes arrière
      { cote: "arriere", pts: [[0.2, 0.88], [0.39, 0.88]], miroir: true },
      { cote: "arriere", pts: [[0.23, 0.93], [0.39, 0.93]], miroir: true },
      { cote: "arriere", pts: [[0.26, 0.98], [0.39, 0.98]], miroir: true },
      // grande calandre
      { cote: "avant", pts: [[-0.17, 0.66], [0.17, 0.66], [0.2, 0.44], [-0.2, 0.44], [-0.17, 0.66]], miroir: false },
    ],
    pieces: [
      { c: [2.05, 0.455, 1.1], t: [0.05, 0.06, 0.04] },
      { c: [2.05, -0.455, 1.1], t: [0.05, 0.06, 0.04] },
      // barres de toit
      { c: [0.4, 0.29, 1.56], t: [0.42, 0.02, 0.02] },
      { c: [0.4, -0.29, 1.56], t: [0.42, 0.02, 0.02] },
    ],
    echappement: [0.36, 0.24],
    coinArriere: [0.7, 0.37],
  },
  // Kia Rio IV : porte-à-faux 0,80 / 0,685 m ; capot court, hayon assez incliné
  rio: {
    fiche: { longueur: 4.065, largeur: 1.725, hauteur: 1.45, empattement: 2.58 },
    bas: 0.17,
    dessus: [
      [3.27, 0.17], [3.375, 0.3], [3.38, 0.52], [3.33, 0.68], [3.1, 0.79], [2.3, 0.91],
      [-0.35, 1.0], [-0.62, 0.95], [-0.685, 0.75], [-0.68, 0.42], [-0.6, 0.17],
    ],
    cabine: [[-0.44, 0.95], [2.35, 0.88], [1.45, 1.41], [1.0, 1.45], [0.05, 1.44], [-0.25, 1.38], [-0.42, 0.982]],
    largeurCaisse: 0.85,
    largeurCabine: 0.66,
    montants: [1.2, 0.2],
    feux: [
      // phares effilés qui remontent vers l'aile
      { cote: "avant", pts: [[0.17, 0.62], [0.38, 0.66], [0.4, 0.58]], miroir: true },
      // calandre « tiger nose » : un cadre pincé en son milieu, en haut et en bas
      { cote: "avant", pts: [[-0.14, 0.62], [0, 0.6], [0.14, 0.62], [0.12, 0.5], [0, 0.52], [-0.12, 0.5], [-0.14, 0.62]], miroir: false },
      // feux arrière horizontaux qui mordent sur le hayon
      { cote: "arriere", pts: [[0.24, 0.84], [0.4, 0.86], [0.4, 0.78]], miroir: true },
    ],
    pieces: [
      { c: [2.1, 0.44, 1.0], t: [0.05, 0.055, 0.035] },
      { c: [2.1, -0.44, 1.0], t: [0.05, 0.055, 0.035] },
      { c: [-0.24, 0, 1.385], t: [0.05, 0.58, 0.014] },
    ],
    echappement: [0.3, 0.2],
    coinArriere: [0.66, 0.36],
  },
};

// ============================================================================================================================
// 3. Mise à l'échelle et construction
// ============================================================================================================================

/** Position [avant] de l'essieu arrière et du sol [haut] dans le repère de la voiture. */
const A_ESSIEU_ARRIERE = VOITURE.roues[2].local[0];
const H_SOL = -VOITURE.hauteurRepos;
/** Empattement des roues physiques (Octane, m). */
export const EMPATTEMENT_MODELE = VOITURE.roues[0].local[0] - VOITURE.roues[2].local[0];
/** Étirement vertical : les roues de RL sont plus grosses que celles d'une voiture de série mise à l'échelle. */
export const ETIREMENT_VERTICAL = 1.1;
/** Jeu entre une roue physique et son passage de roue (m). */
export const MARGE_PASSAGE = 0.02;
/** Segments d'un passage de roue. */
const SEGMENTS_PASSAGE = 10;
/** Décalage des arêtes de détail hors de la surface (pas de scintillement avec les faces). */
const EPSILON_DETAIL = 0.006;

/** Facteurs d'échelle (longueur, hauteur) d'une définition. */
export function echellesSkin(d: Readonly<DefinitionSkin>): { k: number; kh: number } {
  const k = EMPATTEMENT_MODELE / d.fiche.empattement;
  return { k, kh: k * ETIREMENT_VERTICAL };
}

/** Intersections (coordonnée `axe` libre) de la droite `fixe = v` avec les arêtes du polygone. `axe` 0 : droite horizontale (h = v), on rend des a. */
function intersections(poly: readonly Point2[], v: number, axe: 0 | 1): number[] {
  const res: number[] = [];
  const fixe = axe === 0 ? 1 : 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const y0 = p[fixe], y1 = q[fixe];
    if ((y0 <= v && y1 > v) || (y1 <= v && y0 > v)) {
      const t = (v - y0) / (y1 - y0);
      res.push(p[axe] + t * (q[axe] - p[axe]));
    }
  }
  return res;
}
/** `a` de la face avant (le plus en avant) ou arrière (le plus en arrière) du polygone à la hauteur `h`. */
export function aSurFace(poly: readonly Point2[], h: number, cote: "avant" | "arriere"): number {
  const xs = intersections(poly, h, 0);
  if (xs.length === 0) throw new Error(`skins : aucune face à la hauteur ${h}`);
  return cote === "avant" ? Math.max(...xs) : Math.min(...xs);
}
/** Haut (h maximal) du polygone à l'abscisse `a`, ou null en dehors. */
export function hautA(poly: readonly Point2[], a: number): number | null {
  const hs = intersections(poly, a, 1);
  return hs.length === 0 ? null : Math.max(...hs);
}

/** Passage de roue (modèle) au-dessus de la roue `w`, coupant le bas de caisse `hb`, parcouru vers l'avant. */
function passage(w: number, hb: number): Point2[] {
  const r = VOITURE.roues[w];
  const ca = r.local[0], ch = r.local[2], R = r.rayon + MARGE_PASSAGE;
  const s = (hb - ch) / R;
  if (!(s > -1 && s < 1)) throw new Error("skins : bas de caisse hors du passage de roue");
  const t0 = Math.asin(s);
  const pts: Point2[] = [];
  for (let i = 0; i <= SEGMENTS_PASSAGE; i++) {
    const th = Math.PI - t0 + ((2 * t0 - Math.PI) * i) / SEGMENTS_PASSAGE;
    pts.push([ca + R * Math.cos(th), ch + R * Math.sin(th)]);
  }
  pts[0] = [pts[0][0], hb];
  pts[SEGMENTS_PASSAGE] = [pts[SEGMENTS_PASSAGE][0], hb];
  return pts;
}

/** Construit le modèle d'une voiture de série (repère de la voiture) depuis sa définition en vraies grandeurs. */
export function construireSkin(id: Exclude<SkinVoiture, "octane">, d: Readonly<DefinitionSkin> = DEFINITIONS_SKIN[id]): ModeleSkin {
  const { k, kh } = echellesSkin(d);
  const versA = (a: number) => A_ESSIEU_ARRIERE + a * k;
  const versH = (h: number) => H_SOL + h * kh;
  const conv = ([a, h]: Point2): Point2 => [versA(a), versH(h)];
  const hb = versH(d.bas);
  // caisse : bas parcouru vers l'avant (passage arrière, puis avant), puis le dessus de l'avant vers l'arrière
  const caisse: Point2[] = [...passage(2, hb), ...passage(0, hb), ...d.dessus.map(conv)];
  const cabine = d.cabine.map(conv);

  const seg: number[] = [];
  const pousser = (a: Point3, b: Point3) => { seg.push(a[0], a[1], a[2], b[0], b[1], b[2]); };
  // feux et calandre, posés sur la face avant ou arrière un peu à l'extérieur
  for (const f of d.feux) {
    const signes = f.miroir ? [1, -1] : [1];
    for (const sg of signes) {
      const pts: Point3[] = f.pts.map(([dr, h]) => {
        const hm = versH(h);
        const a = aSurFace(caisse, hm, f.cote) + (f.cote === "avant" ? EPSILON_DETAIL : -EPSILON_DETAIL);
        return [a, sg * dr, hm];
      });
      for (let i = 0; i + 1 < pts.length; i++) pousser(pts[i], pts[i + 1]);
    }
  }
  // flancs de l'habitacle : la ligne où il sort de la caisse, et les montants
  const debutFlanc = seg.length;
  const dc = d.largeurCabine / 2 + EPSILON_DETAIL;
  const aMin = Math.min(...cabine.map((p) => p[0])), aMax = Math.max(...cabine.map((p) => p[0]));
  const N = 12;
  const ceinture: Point2[] = [];
  for (let i = 0; i <= N; i++) {
    const a = aMin + 0.01 + ((aMax - aMin - 0.02) * i) / N;
    const hc = hautA(caisse, a), hcab = hautA(cabine, a);
    if (hc !== null && hcab !== null && hcab > hc) ceinture.push([a, hc + 0.002]);
  }
  for (const sg of [1, -1]) {
    for (let i = 0; i + 1 < ceinture.length; i++) pousser([ceinture[i][0], sg * dc, ceinture[i][1]], [ceinture[i + 1][0], sg * dc, ceinture[i + 1][1]]);
    for (const m of d.montants) {
      const a = versA(m);
      const bas = hautA(caisse, a), haut = hautA(cabine, a);
      if (bas !== null && haut !== null && haut > bas) pousser([a, sg * dc, bas], [a, sg * dc, haut]);
    }
  }

  const pieces: PieceSkin[] = d.pieces.map((p) => ({ c: [versA(p.c[0]), p.c[1], versH(p.c[2])], t: p.t }));
  const hEch = versH(d.echappement[0]);
  const hCoin = versH(d.coinArriere[0]);
  return {
    id,
    volumes: [{ profil: caisse, largeur: d.largeurCaisse }, { profil: cabine, largeur: d.largeurCabine }],
    pieces,
    segments: seg,
    debutFlanc,
    echappement: [aSurFace(caisse, hEch, "arriere") - 0.01, 0, hEch],
    coinArriere: [aSurFace(caisse, hCoin, "arriere") + 0.02, d.coinArriere[1], hCoin],
  };
}

const CACHE = new Map<SkinVoiture, ModeleSkin>();
/** Modèle d'un skin (mémoïsé) ; un identifiant inconnu donne l'Octane. */
export function modeleSkin(id: SkinVoiture): ModeleSkin {
  if (id === "octane" || !(SKINS as readonly string[]).includes(id)) return OCTANE;
  let m = CACHE.get(id);
  if (!m) { m = construireSkin(id); CACHE.set(id, m); }
  return m;
}

// ============================================================================================================================
// 4. Attribution des skins aux voitures
// ============================================================================================================================

/** Skin d'un bot : tiré de la graine du match et de l'id de la voiture (déterministe, sans toucher au générateur de la physique). */
export function skinBot(graine: number, idVoiture: number): SkinVoiture {
  let x = (Math.imul((graine >>> 0) ^ 0x5bd1e995, 0x9e3779b1) + Math.imul(idVoiture + 1, 0x85ebca6b)) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; x ^= x >>> 12; x = Math.imul(x, 0x297a2d39) >>> 0; x ^= x >>> 15;
  return SKINS[(x >>> 0) % SKINS.length];
}

/** Skins de toutes les voitures d'un match local : l'humain a le sien, chaque bot le sien, tiré de la graine. */
export function skinsDesVoitures(voitures: readonly { id: number; humain: boolean }[], skinHumain: SkinVoiture, graine: number): SkinVoiture[] {
  return voitures.map((v) => (v.humain ? skinHumain : skinBot(graine, v.id)));
}

/**
 * Skins d'un match en ligne d'après les voitures du `debut` : celui que le serveur annonce, POUR MA VOITURE AUSSI (si mon changement de
 * carrosserie a été refusé, parti pendant le lancement, je me vois comme les autres me voient) ; `monSkin` ne sert que si le `debut` n'en
 * dit rien pour moi, l'Octane pour une autre voiture sans skin valable. (Un serveur d'avant les skins, `VERSION_ROCKET` 2, refuse de
 * toute façon un client v3 par `erreur{version}`.)
 */
export function skinsEnLigne(voitures: readonly { id: number; skin?: SkinVoiture }[], moi: number, monSkin: SkinVoiture): SkinVoiture[] {
  const res: SkinVoiture[] = [];
  for (const v of voitures) {
    const annonce = v.skin && (SKINS as readonly string[]).includes(v.skin) ? v.skin : null;
    res[v.id] = annonce ?? (v.id === moi ? monSkin : "octane");
  }
  for (let i = 0; i < res.length; i++) if (!res[i]) res[i] = "octane";
  return res;
}

// ============================================================================================================================
// 5. Aperçu du lobby (silhouette de profil en SVG)
// ============================================================================================================================

export interface ApercuSkin {
  /** `viewBox` du SVG (x = avant, y = -haut) */
  vue: string;
  /** un chemin fermé par volume (caisse, habitacle) */
  chemins: readonly string[];
  roues: readonly { cx: number; cy: number; r: number }[];
  /** détails (feux, montants) vus de profil : segments [x1, y1, x2, y2] */
  traits: readonly (readonly [number, number, number, number])[];
}

const arrondi = (x: number) => Math.round(x * 1000) / 1000;
/** Silhouette de profil d'un skin, à dessiner en SVG (aucune dépendance au DOM). */
export function apercuSkin(id: SkinVoiture): ApercuSkin {
  const m = modeleSkin(id);
  const chemins = m.volumes.map((v) => `M${v.profil.map(([a, h]) => `${arrondi(a)} ${arrondi(-h)}`).join(" L")} Z`);
  const roues = [0, 2].map((w) => ({ cx: arrondi(VOITURE.roues[w].local[0]), cy: arrondi(-VOITURE.roues[w].local[2]), r: arrondi(VOITURE.roues[w].rayon) }));
  const traits: [number, number, number, number][] = [];
  for (let i = m.debutFlanc; i + 5 < m.segments.length; i += 6) {
    // vue de droite : seuls les détails du flanc droit (montants, ligne de caisse) se lisent de profil
    if (m.segments[i + 1] > 0) {
      traits.push([arrondi(m.segments[i]), arrondi(-m.segments[i + 2]), arrondi(m.segments[i + 3]), arrondi(-m.segments[i + 5])]);
    }
  }
  // cadre commun à tous les skins : les aperçus restent à la même échelle
  return { vue: "-0.66 -0.5 1.5 0.72", chemins, roues, traits };
}
