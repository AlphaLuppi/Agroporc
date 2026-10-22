/**
 * Cycle de course humain (pur : ni three ni DOM, testé par lib/macron3d/course.test.ts). Il ne
 * produit que des INTENTIONS dans le repère du modèle (visage +Z, haut +Y, sa gauche +X ; le
 * coureur avance vers +Z) : position et rotations du bassin, colonne, tête, cible de chaque
 * cheville (+ orientation du pied, orteils), angles des bras. lib/macron3d/pose.ts en tire les
 * rotations des 74 os (IK des jambes, visée des bras).
 *
 * Le cycle (une foulée = deux pas) :
 *   pied G : contact (φ = 0) → appui (amorti, genou fléchi) → poussée (talon qui se lève,
 *   pivot sur la plante) → décollage (φ = APPUI) → vol (talon qui remonte vers la fesse, genou
 *   qui passe devant, jambe qui se déplie puis revient sous le corps) → contact (φ = 1).
 *   Pied D : décalé d'une demi-foulée. APPUI < 0,5 : il y a une phase de vol (aucun pied au sol).
 *
 * Pieds verrouillés : au contact, le point d'appui est fixé dans le monde (talon pendant
 * l'attaque, pied à plat, puis plante pendant la poussée) et ne bouge plus jusqu'au décollage ;
 * c'est le bassin qui avance au-dessus. La vitesse d'avance est donc exactement celle du
 * balayage du pied (glissement nul par construction, mesuré par les tests). Le pied en vol suit
 * une spline d'Hermite en repère monde : ses nœuds sont des postures cuisse / genou réelles
 * (en relatif à la hanche), ses extrémités raccordent position ET vitesse à l'appui (vitesse
 * nulle au contact : pas de « pop »).
 *
 * Variation : cadence, vitesse, amplitudes et tête dérivent lentement (bruit lissé non
 * périodique) : deux foulées ne sont jamais identiques.
 */
import { bruit, borne, lerp, rampe } from "../tigre3d/ressorts";
import { COTES, SIGNE, type Cote } from "./os";

export interface Vec { x: number; y: number; z: number }
export const DEG = Math.PI / 180;

/**
 * Mesures du modèle au repos (m), vérifiées contre le GLB par les tests : hanche = os UpLeg
 * relatif au bassin (Hips), cheville = os Foot, plante = os ToeBase (articulation des orteils).
 */
export const MESURES = {
  hauteurBassin: 0.9403,
  hanche: { x: 0.0723, y: -0.0107, z: 0.0155 },
  cuisse: 0.4230,
  tibia: 0.4298,
  /** Hauteur de la cheville, pied à plat. */
  cheville: 0.0824,
  /** Cheville → plante, dans l'axe du pied (horizontal) et en hauteur. */
  plante: { avant: 0.1054, bas: 0.0394 },
  /** Pivot du talon (au sol, sous l'arrière du talon) relatif à la cheville, dans l'axe du pied. */
  talon: { arriere: 0.055, bas: 0.0824 },
} as const;

export interface ReglagesCourse {
  /** Vitesse d'avance moyenne (m/s). */
  vitesse: number;
  /** Pas par seconde (deux pas par foulée). */
  cadence: number;
  /** Part de la foulée passée en appui par chaque pied (< 0,5 : phase de vol). */
  appui: number;
  /** Hauteur moyenne du bassin en course (os Hips, m) et demi-amplitude du rebond. */
  hauteurBassin: number;
  rebond: number;
  /** Cheville devant la hanche au contact (m, axe d'avance). */
  poser: number;
  /** Demi-écart latéral des appuis (m) : les pieds se posent presque sur une ligne. */
  ecartPas: number;
  /** Ouverture des pointes de pied (rad). */
  ouverturePied: number;
  /** Tangage du pied au contact (pointe levée, rad) et au décollage (talon levé, < 0). */
  tangageContact: number;
  tangageDecollage: number;
  /** Graine du bruit : deux passages ne se ressemblent pas. */
  graine: number;
  /** Phase de départ (foulées). */
  phase: number;
}

export const REGLAGES: ReglagesCourse = {
  vitesse: 2.9,
  cadence: 3.0,
  appui: 0.30,
  hauteurBassin: 0.905,
  rebond: 0.028,
  poser: 0.17,
  ecartPas: 0.055,
  ouverturePied: 6 * DEG,
  tangageContact: 8 * DEG,
  tangageDecollage: -45 * DEG,
  graine: 1,
  phase: 0.1,
};

/**
 * Postures de la jambe en vol (hanche → cheville), d'après les courbes classiques de la course
 * à ≈ 3 m/s : [part du vol, cuisse (° depuis la verticale, + vers l'avant), flexion du genou (°)].
 * Talon qui remonte (genou ≈ 100° au premier tiers), genou qui passe devant, jambe qui se
 * déplie (cuisse ≈ 45°), puis revient sous le corps avant le contact.
 */
export const POSTURES_VOL: ReadonlyArray<readonly [number, number, number]> = [
  [0.12, -16, 35],
  [0.30, 2, 90],
  [0.45, 20, 96],
  [0.60, 36, 78],
  [0.75, 42, 50],
  [0.88, 34, 30],
];

export interface EtatPied {
  appui: boolean;
  /** Avancement dans la phase en cours, 0 → 1 (appui ou vol). */
  avancement: number;
  /** Cible de la cheville (os Foot). */
  cheville: Vec;
  /** Lacet du pied (rad autour de +Y, + = pointe vers sa gauche). */
  lacet: number;
  /** Tangage du pied en repère monde (+ = pointe levée). */
  tangage: number;
  /** Angle de la cheville relatif au tibia (+ = flexion dorsale), pour la partie « vol ». */
  angleCheville: number;
  /** 0 : orientation monde (`tangage`), 1 : orientation relative au tibia (`angleCheville`). */
  poidsTibia: number;
  /** Orteils relevés par rapport au pied (rad) : à plat au sol pendant la poussée. */
  orteils: number;
  /** Direction de pli du genou (vers l'avant, un peu en dehors). */
  pole: Vec;
  /** Points d'appui verrouillés (null en vol) : pivot du talon, articulation de la plante. */
  talon: Vec | null;
  plante: Vec | null;
}

export interface EtatBras {
  /** Balancement de l'épaule (rad, + = bras vers l'avant). */
  balancement: number;
  /** Flexion du coude (rad). */
  coude: number;
  /** Écartement du bras (rad, vers l'extérieur). */
  abduction: number;
  /** Avant-bras qui rentre vers l'axe du corps (rad, rotation interne du bras). */
  croise: number;
  /** Clavicule avancée (rad). */
  clavicule: number;
}

export interface IntentionsCourse {
  t: number;
  /** Phase continue (foulées). */
  phase: number;
  /** Avance de référence (m) : la scène la retranche pour garder le coureur au centre du canvas. */
  avance: number;
  vitesse: number;
  bassin: { p: Vec; lacet: number; tangage: number; roulis: number };
  /** Colonne relative au bassin (répartie sur les 3 vertèbres). */
  dos: { lacet: number; tangage: number; roulis: number };
  /** Orientation voulue de la tête dans le monde (stabilisée). */
  tete: { lacet: number; tangage: number; roulis: number };
  pieds: Record<Cote, EtatPied>;
  bras: Record<Cote, EtatBras>;
  /** Poing léger, 0 → 1. */
  poing: number;
}

export interface Course {
  readonly reglages: ReglagesCourse;
  avancer(dt: number): void;
  etat(): IntentionsCourse;
  /** Lacet de tête supplémentaire (rad, + = vers sa gauche), ex. un regard vers la caméra. */
  regarder(lacet: number): void;
}

// --- petites maths de vecteurs (objets {x, y, z}) ---
const vec = (x = 0, y = 0, z = 0): Vec => ({ x, y, z });
const ajoute = (a: Vec, b: Vec): Vec => vec(a.x + b.x, a.y + b.y, a.z + b.z);
const echelle = (a: Vec, k: number): Vec => vec(a.x * k, a.y * k, a.z * k);
/** Rotation autour de +Y (lacet). */
const lacetDe = (a: Vec, ang: number): Vec => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return vec(a.x * c + a.z * s, a.y, -a.x * s + a.z * c);
};

/** Hermite cubique scalaire sur [0, 1] (valeurs et dérivées par unité de paramètre). */
function hermite(p0: number, m0: number, p1: number, m1: number, u: number): number {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}

/**
 * Spline d'Hermite par morceaux (nœuds s croissants de 0 à 1) : tangentes intérieures de
 * Catmull-Rom non uniformes (moyenne pondérée des pentes), tangentes d'extrémités imposées.
 */
export function splineHermite(s: readonly number[], p: readonly number[], m0: number, m1: number, x: number): number {
  const n = s.length - 1;
  const xx = borne(x, 0, 1);
  let i = 0;
  while (i < n - 1 && xx > s[i + 1]) i++;
  const tangente = (k: number) => {
    if (k === 0) return m0;
    if (k === n) return m1;
    const h0 = s[k] - s[k - 1], h1 = s[k + 1] - s[k];
    const d0 = (p[k] - p[k - 1]) / h0, d1 = (p[k + 1] - p[k]) / h1;
    return (d0 * h1 + d1 * h0) / (h0 + h1);
  };
  const h = s[i + 1] - s[i];
  return hermite(p[i], tangente(i) * h, p[i + 1], tangente(i + 1) * h, (xx - s[i]) / h);
}

/** Pied rigide : position de la cheville pour un tangage θ, pivot au talon (θ > 0) ou à la plante (θ < 0). */
function chevilleAppui(talon: Vec, plante: Vec, lacet: number, theta: number): Vec {
  const M = MESURES;
  // (avant, haut) de la cheville relativement au pivot, pied à plat, tourné de θ dans le plan sagittal du pied.
  const [pivot, a, b] = theta >= 0
    ? [talon, M.talon.arriere, M.talon.bas] as const
    : [plante, -M.plante.avant, M.plante.bas] as const;
  const c = Math.cos(theta), s = Math.sin(theta);
  const av = a * c - b * s, ht = a * s + b * c;
  return ajoute(pivot, lacetDe(vec(0, ht, av), lacet));
}

/** Part de l'appui où le pied finit de se poser à plat, puis où le talon commence à se lever. */
const APLAT = 0.22, TALON_LEVE = 0.44;

/**
 * Tangage du pied pendant l'appui (σ = 0 → 1) : attaque pointe levée, pied à plat, poussée sur la
 * plante. La pointe s'abaisse dès le contact avec une vitesse non nulle (Hermite (1 − u)²(1 + u)) :
 * c'est elle qui prolonge la descente de la cheville en vol, sans à-coup (cf. `vitesseContact`).
 */
export function tangageAppui(r: ReglagesCourse, sigma: number): number {
  const aplat = APLAT, talonLeve = TALON_LEVE;
  if (sigma < aplat) { const u = sigma / aplat; return r.tangageContact * (1 - u) * (1 - u) * (1 + u); }
  if (sigma < talonLeve) return 0;
  return r.tangageDecollage * Math.pow((sigma - talonLeve) / (1 - talonLeve), 1.7);
}

/** dθ/dσ de `tangageAppui` au contact (σ = 0). */
const pentePoseContact = (r: ReglagesCourse) => -r.tangageContact / APLAT;

/**
 * Vitesse de la cheville (par unité de dθ) au tout début de l'appui : le pied pivote sur le talon,
 * pointe levée de θc. Le vol finit sur cette vitesse : genou et cheville ne sautent pas au contact.
 */
function deriveeChevilleContact(r: ReglagesCourse, lacet: number): Vec {
  const a = MESURES.talon.arriere, b = MESURES.talon.bas, th = r.tangageContact;
  const c = Math.cos(th), s = Math.sin(th);
  return lacetDe(vec(0, a * c - b * s, -a * s - b * c), lacet);
}

/** Hanche → cheville (avant, haut) pour une cuisse et un genou donnés (degrés). */
function chevilleDePosture(cuisse: number, genou: number): [number, number] {
  const a = cuisse * DEG, b = (cuisse - genou) * DEG;
  return [
    MESURES.cuisse * Math.sin(a) + MESURES.tibia * Math.sin(b),
    -(MESURES.cuisse * Math.cos(a) + MESURES.tibia * Math.cos(b)),
  ];
}
/** Postures de vol en (part du vol, avant, haut) ; `talon` > 1 replie davantage le genou. */
const volRelatif = (talon: number) => POSTURES_VOL.map(([s, c, g]) => [s, ...chevilleDePosture(c, g * talon)] as const);

/** Angle de la cheville relatif au tibia pendant le vol (s → rad) : une seule courbe lisse. */
const ANGLE_CHEVILLE = { s: [0, 0.3, 0.85, 1], v: [-18 * DEG, -6 * DEG, 3 * DEG, 3 * DEG] };

interface Jambe {
  cote: Cote;
  appui: boolean;
  talon: Vec;
  plante: Vec;
  lacet: number;
  /** Décollage : position et vitesse (m/s) de la cheville, tangage et sa vitesse (rad/s), orteils. */
  depart: Vec;
  vDepart: Vec;
  thetaDepart: number;
  vThetaDepart: number;
}

export function creerCourse(reglages: Partial<ReglagesCourse> = {}): Course {
  const r: ReglagesCourse = { ...REGLAGES, ...reglages };
  const g = r.graine * 17.3;
  let t = 0;
  let phase = r.phase;
  /** Avance linéaire (∫ v dt) : la modulation intra-foulée s'y ajoute (bassin). */
  let avance = 0;
  let regard = 0;

  // Dérives non périodiques des réglages (≈ une valeur nouvelle par foulée) : deux foulées ne
  // sont jamais identiques.
  const facteurs = (tt: number) => ({
    cadence: 1 + 0.03 * bruit(tt * 1.1, g + 1),
    vitesse: 1 + 0.03 * bruit(tt * 0.9, g + 2),
    bras: 1 + 0.1 * bruit(tt * 1.6, g + 3),
    brasCentre: 3 * DEG * bruit(tt * 1.2, g + 10),
    rebond: 1 + 0.1 * bruit(tt * 1.4, g + 4),
    poser: 0.015 * bruit(tt * 1.3, g + 5),
    talon: 0.06 * bruit(tt * 1.5, g + 9),
  });
  // Légère asymétrie fixe par passage entre G et D (personne ne court parfaitement symétrique).
  const asym = (k: number) => bruit(r.graine * 3.1 + k * 0.37, 91);
  const asymetrie: Record<Cote, { talon: number; ouverture: number; bras: number }> = {
    G: { talon: 0.04 * asym(1), ouverture: 0.25 * asym(2), bras: 0.05 * asym(3) },
    D: { talon: -0.04 * asym(1), ouverture: -0.25 * asym(2), bras: -0.05 * asym(3) },
  };
  let f = facteurs(0);
  const freq = () => (r.cadence * f.cadence) / 2;
  const vit = () => r.vitesse * f.vitesse;

  // --- bassin en fonction de la phase absolue (foulées) ---
  const A = r.appui;
  const bassinY = (ph: number) => r.hauteurBassin - r.rebond * f.rebond * Math.cos(4 * Math.PI * (ph - A / 2));
  const bassinX = (ph: number) => 0.011 * Math.cos(2 * Math.PI * (ph - A / 2));
  /** Freinage au contact, relance à la poussée : vitesse minimale à mi-appui. */
  const modulationZ = (ph: number) => -0.006 * Math.sin(4 * Math.PI * (ph - A / 2));
  const lacetBassin = (ph: number) => -6 * DEG * Math.cos(2 * Math.PI * (ph + 0.03));
  const roulisBassin = (ph: number) => 4.5 * DEG * Math.cos(2 * Math.PI * (ph - A / 2));
  const tangageBassin = (ph: number) => 7 * DEG + 1.5 * DEG * Math.cos(4 * Math.PI * (ph - A));
  /** Bassin prédit à la phase ph (l'avance suit la vitesse courante). */
  const bassinEn = (ph: number): Vec => vec(
    bassinX(ph),
    bassinY(ph),
    avance + (vit() / freq()) * (ph - phase) + modulationZ(ph),
  );
  /** Hanche (os UpLeg) prédite, avec le lacet du bassin. */
  const hancheEn = (c: Cote, ph: number): Vec => {
    const h = MESURES.hanche;
    return ajoute(bassinEn(ph), lacetDe(vec(SIGNE[c] * h.x, h.y, h.z), lacetBassin(ph)));
  };
  const decalage = (c: Cote) => (c === "G" ? 0 : 0.5);
  /** Phase absolue du dernier contact du pied c (≤ ph). */
  const dernierContact = (c: Cote, ph: number) => Math.floor(ph - decalage(c)) + decalage(c);

  /** Cheville au contact prévu à la phase phC. */
  function chevilleContact(c: Cote, phC: number): Vec {
    const h = hancheEn(c, phC);
    const tc = r.tangageContact;
    const ht = MESURES.talon.arriere * Math.sin(tc) + MESURES.talon.bas * Math.cos(tc);
    return vec(SIGNE[c] * r.ecartPas, ht, h.z + r.poser + f.poser);
  }

  /** Points d'appui (talon, plante) d'un pied posé à la cheville `ch`, pointe levée de θc. */
  function appuisDepuisContact(ch: Vec, lacet: number): { talon: Vec; plante: Vec } {
    const M = MESURES, tc = r.tangageContact;
    const c = Math.cos(tc), s = Math.sin(tc);
    const a = M.talon.arriere, b = M.talon.bas;
    const rel = lacetDe(vec(0, a * s + b * c, a * c - b * s), lacet);
    const talon = vec(ch.x - rel.x, ch.y - rel.y, ch.z - rel.z);
    const plante = ajoute(talon, lacetDe(vec(0, M.talon.bas - M.plante.bas, M.talon.arriere + M.plante.avant), lacet));
    return { talon, plante };
  }

  const lacetPied = (c: Cote) => SIGNE[c] * r.ouverturePied * (1 + asymetrie[c].ouverture);

  /** Pose une jambe en appui (contact à la phase phC). */
  function poser(j: Jambe, phC: number) {
    j.appui = true;
    j.lacet = lacetPied(j.cote);
    const a = appuisDepuisContact(chevilleContact(j.cote, phC), j.lacet);
    j.talon = a.talon;
    j.plante = a.plante;
  }

  /** Décollage : on fige la fin de l'appui (position, vitesse) comme départ du vol. */
  function decoller(j: Jambe) {
    const T = A / freq();
    const e = 1e-3;
    const th1 = tangageAppui(r, 1), th0 = tangageAppui(r, 1 - e);
    const p1 = chevilleAppui(j.talon, j.plante, j.lacet, th1);
    const p0 = chevilleAppui(j.talon, j.plante, j.lacet, th0);
    j.appui = false;
    j.depart = p1;
    j.vDepart = echelle(vec(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z), 1 / (e * T));
    j.thetaDepart = th1;
    j.vThetaDepart = (th1 - th0) / (e * T);
  }

  const jambes: Record<Cote, Jambe> = {} as Record<Cote, Jambe>;
  for (const c of COTES) {
    const j: Jambe = {
      cote: c, appui: true, talon: vec(), plante: vec(), lacet: 0,
      depart: vec(), vDepart: vec(), thetaDepart: 0, vThetaDepart: 0,
    };
    const phC = dernierContact(c, phase);
    poser(j, phC);
    if (phase - phC >= A) decoller(j);
    jambes[c] = j;
  }

  /** Pied en vol : spline monde (sagittal y, z) + trajectoire latérale. */
  function pied(c: Cote): EtatPied {
    const j = jambes[c];
    const phC = dernierContact(c, phase);
    const loc = phase - phC;
    const sgn = SIGNE[c];
    const poleBase = lacetDe(vec(0.13 * sgn, 0, 1), lacetBassin(phase));
    if (j.appui) {
      const sigma = borne(loc / A, 0, 1);
      const theta = tangageAppui(r, sigma);
      return {
        appui: true, avancement: sigma,
        cheville: chevilleAppui(j.talon, j.plante, j.lacet, theta),
        lacet: j.lacet, tangage: theta, angleCheville: 0, poidsTibia: 0,
        orteils: Math.max(0, -theta), pole: poleBase,
        talon: theta >= 0 ? j.talon : null,
        plante: theta <= 0 ? j.plante : null,
      };
    }
    const s = borne((loc - A) / (1 - A), 0, 1);
    const Tvol = (1 - A) / freq();
    const phDecollage = phC + A;
    const phContact = phC + 1;
    const fin = chevilleContact(c, phContact);
    const ks = [0], ky = [j.depart.y], kz = [j.depart.z];
    for (const [sk, u, w] of volRelatif(1 + f.talon + asymetrie[c].talon)) {
      const h = hancheEn(c, phDecollage + sk * (1 - A));
      ks.push(sk); ky.push(h.y + w); kz.push(h.z + u);
    }
    ks.push(1); ky.push(fin.y); kz.push(fin.z);
    // Vitesse d'arrivée = vitesse du début de l'appui (le pied qui s'abaisse en pivotant sur le
    // talon : la cheville descend et avance un peu) : aucun saut de vitesse au contact.
    const omega = (pentePoseContact(r) * freq()) / A;
    const vFin = echelle(deriveeChevilleContact(r, lacetPied(c)), omega * Tvol);
    const y = splineHermite(ks, ky, j.vDepart.y * Tvol, vFin.y, s);
    const z = splineHermite(ks, kz, j.vDepart.z * Tvol, vFin.z, s);
    const bosse = Math.sin(Math.PI * s);
    const x = hermite(j.depart.x, j.vDepart.x * Tvol, fin.x, vFin.x, s) + sgn * 0.012 * bosse * bosse;
    const tangage = hermite(j.thetaDepart, j.vThetaDepart * Tvol, r.tangageContact, omega * Tvol, s);
    const angleCheville = splineHermite(ANGLE_CHEVILLE.s, ANGLE_CHEVILLE.v, 40 * DEG, 0, s);
    return {
      appui: false, avancement: s,
      cheville: vec(x, y, z),
      lacet: lerp(j.lacet, lacetPied(c), s),
      tangage, angleCheville,
      poidsTibia: rampe(s, 0.02, 0.3) * (1 - rampe(s, 0.7, 0.97)),
      // Orteils : ils quittent le sol à plat (tangage monde nul) puis se relâchent sans à-coup.
      orteils: -tangage * (1 - rampe(s, 0, 0.35)) + 4 * DEG * rampe(s, 0.2, 0.5) * (1 - rampe(s, 0.8, 1)),
      pole: poleBase,
      talon: null, plante: null,
    };
  }

  function bras(c: Cote): EtatBras {
    // Bras G en avant quand la jambe D est devant (opposition), avec un léger retard.
    const ph = phase - (c === "G" ? 0.5 : 0) - 0.04;
    const k = Math.cos(2 * Math.PI * ph);
    const amp = 30 * DEG * f.bras * (1 + asymetrie[c].bras);
    // Bras en arrière (k → −1) : un peu plus écarté, pour que la main passe à côté de la veste.
    const arriere = (1 - k) * (1 - k) / 4;
    return {
      balancement: -7 * DEG + f.brasCentre + amp * k,
      coude: 88 * DEG + 14 * DEG * k,
      abduction: 12 * DEG - 2 * DEG * k + 6 * DEG * arriere,
      // Rotation interne lisse (pas de max(0, k) : la vitesse de la main ne casse pas).
      croise: 5 * DEG + 6 * DEG * (1 + k) * (1 + k) / 4,
      clavicule: 4 * DEG * k,
    };
  }

  function etat(): IntentionsCourse {
    const lb = lacetBassin(phase);
    const lacetThorax = 8 * DEG * Math.cos(2 * Math.PI * (phase - 0.01));
    const rb = roulisBassin(phase);
    const pieds = { G: pied("G"), D: pied("D") };
    return {
      t, phase, avance, vitesse: vit(),
      bassin: { p: bassinEn(phase), lacet: lb, tangage: tangageBassin(phase), roulis: rb },
      dos: {
        lacet: lacetThorax - lb,
        tangage: 9 * DEG + 1.2 * DEG * Math.cos(4 * Math.PI * (phase - A / 2)),
        roulis: -0.7 * rb,
      },
      tete: {
        lacet: regard + 0.1 * lacetThorax + 1.5 * DEG * bruit(t * 0.7, g + 6),
        tangage: 5 * DEG + 1.2 * DEG * bruit(t * 0.8, g + 7),
        roulis: 1.2 * DEG * bruit(t * 0.6, g + 8),
      },
      pieds,
      bras: { G: bras("G"), D: bras("D") },
      poing: 1,
    };
  }

  return {
    reglages: r,
    regarder(l) { regard = l; },
    avancer(dt) {
      if (dt <= 0) return;
      // Sous-pas : un grand dt (onglet repris) ne saute ni un contact ni un décollage.
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / n;
      for (let k = 0; k < n; k++) {
        f = facteurs(t);
        const ancienne = phase;
        avance += vit() * h;
        phase += freq() * h;
        t += h;
        for (const c of COTES) {
          const j = jambes[c];
          const d = decalage(c);
          // Contact franchi : le pied se pose (là où le vol le menait) ; décollage franchi : il part.
          if (Math.floor(phase - d) > Math.floor(ancienne - d)) poser(j, Math.floor(phase - d) + d);
          else if (j.appui && phase - dernierContact(c, phase) >= A && ancienne - dernierContact(c, phase) < A) decoller(j);
        }
      }
    },
    etat,
  };
}
