/**
 * Les deux vendeuses du Truck Muche, Elsa et la patronne (PUR, partagé client / serveur, aucune horloge ni hasard global : tout dérive de l'identifiant
 * de l'offre ou des arguments) : qui sert quelle offre, répliques des deux femmes (la patronne prend la commande et crie « Oh Elsa, prépare-moi ça ! »,
 * Elsa prépare et sert), scénario d'une offre daté depuis son apparition (le même chez tous les clients, sans message de plus), et poses des deux
 * figures filaires : au comptoir du Truck garé, ou assises à l'avant du Truck fou, mains au volant, penchées dans les virages (cinématique inverse à deux
 * segments pour les bras : les mains arrivent où on les veut, que le torse soit penché ou non).
 * Rendu (three) : `rendu-vendeuses.ts` ; service serveur : `match-elsa.ts` / `elsa.ts`.
 * Spec : docs/superpowers/specs/2026-10-30-arene-police-evenements-design.md (§ « Truck fou et vendeuses »)
 */
import { tirerReplique } from "../repliques-lasso";
import type { VendeuseId } from "./protocole";

export type { VendeuseId } from "./protocole";

export const NOMS_VENDEUSES: Readonly<Record<VendeuseId, string>> = { elsa: "Elsa", patronne: "La patronne" };

/** Durée d'une offre (ms) : celle d'`ELSA.dureeOffreMs`, recopiée (ce module ne dépend pas d'`elsa.ts`, qui dépend de lui) et vérifiée par un test. */
export const DUREE_OFFRE_MS = 40_000;

/** Une offre sur trois est celle de la patronne (la deuxième, la cinquième…), les autres celles d'Elsa : dérivé de l'identifiant, aucun tirage de hasard. */
export function vendeuseDeOffre(id: number): VendeuseId {
  return id % 3 === 2 ? "patronne" : "elsa";
}

// ---------------------------------------------------------------------------------------------
// Répliques
// ---------------------------------------------------------------------------------------------

export const REPLIQUES_VENDEUSES = {
  /** la patronne prend la commande et la passe à Elsa */
  commande: [
    "Oh Elsa, prépare-moi ça !",
    "Elsa ! Une commande, et que ça saute !",
    "Elsa, prépare-moi ça en deux temps !",
    "Oh Elsa, sors-moi ça du four !",
    "Elsa, ma belle, ça part en cuisine !",
    "Elsa ! Un client, prépare-moi ça !",
  ],
  /** Elsa répond depuis la cuisine */
  reponse: [
    "Oui patronne, j'y vais !",
    "C'est parti, patronne !",
    "Deux minutes, patronne !",
    "Je m'en occupe, patronne !",
    "Ça chauffe, patronne !",
  ],
  /** la patronne presse Elsa */
  presse: [
    "Alors Elsa, ça vient ?",
    "Le client attend, Elsa !",
    "Plus vite que ça, Elsa !",
    "Elsa ! On n'a pas toute la journée !",
  ],
  /** Elsa sert son cadeau */
  serviceElsa: [
    "Voilà pour vous, servez-vous !",
    "C'est chaud, attention !",
    "Fait maison, c'est prêt !",
    "Elsa vous régale, prenez !",
  ],
  /** la patronne sert sa formule du jour */
  servicePatronne: [
    "La formule du jour, mon grand !",
    "Le menu complet, c'est la patronne qui régale !",
    "Formule du jour : soin ET arme, ça ne se refuse pas !",
    "Pour vous, la formule de la patronne !",
  ],
  /** quand l'offre traîne : la patronne héle le client, Elsa chante sa cuisine */
  ambiancePatronne: [
    "Y a du monde ce midi !",
    "Qui veut un Truck Muche ?",
    "Frais, fait maison, et pas cher !",
    "Approchez, ça ne mord pas !",
  ],
  ambianceElsa: [
    "Ça sent bon la friture !",
    "Encore une portion !",
    "Je coupe les oignons…",
    "Mon plat du jour est un tigre.",
  ],
  /** après le ramassage, dans le fil d'annonces */
  merci: ["Bon appétit !", "À la prochaine !", "Et que ça saute !", "Revenez quand vous voulez !"],
} as const;

/** Une ligne dite à `t` ms de l'apparition de l'offre par `qui`. */
export interface LigneVendeuse { t: number; qui: VendeuseId; texte: string }

/** Durée d'affichage d'une réplique (ms) : une bulle de 3,2 s. */
export const DUREE_REPLIQUE_MS = 3_200;

/** Générateur à graine (mulberry32) : le même scénario chez tous les clients pour la même offre. */
function graine(a: number): () => number {
  let s = (Math.imul(a | 0, 0x9e3779b1) ^ 0x85ebca6b) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scénario d'une offre, daté depuis son apparition : la patronne appelle Elsa (« Oh Elsa, prépare-moi ça ! »), Elsa répond, la patronne la presse, puis
 * c'est servi (par Elsa, ou par la patronne pour sa formule), et jusqu'à l'expiration les deux se répondent à tour de rôle. Jamais deux fois la même
 * réplique de suite, jamais deux lignes à moins de `DUREE_REPLIQUE_MS` l'une de l'autre, aucune après `dureeMs` − une bulle.
 */
export function scenarioOffre(id: number, vendeuse: VendeuseId, dureeMs: number = DUREE_OFFRE_MS): LigneVendeuse[] {
  const alea = graine(id);
  const lignes: LigneVendeuse[] = [];
  const dernier: Partial<Record<VendeuseId, string>> = {};
  const dire = (t: number, qui: VendeuseId, liste: readonly string[]) => {
    if (t > dureeMs - DUREE_REPLIQUE_MS) return;
    const texte = tirerReplique(liste, alea(), dernier[qui] ?? null);
    dernier[qui] = texte;
    lignes.push({ t: Math.round(t), qui, texte });
  };
  let t = 400 + alea() * 400;
  dire(t, "patronne", REPLIQUES_VENDEUSES.commande);
  t += 3_400 + alea() * 400;
  dire(t, "elsa", REPLIQUES_VENDEUSES.reponse);
  t += 4_200 + alea() * 1_600;
  dire(t, "patronne", REPLIQUES_VENDEUSES.presse);
  t += 3_800 + alea() * 800;
  dire(t, vendeuse, vendeuse === "patronne" ? REPLIQUES_VENDEUSES.servicePatronne : REPLIQUES_VENDEUSES.serviceElsa);
  // jusqu'à l'expiration : elles se répondent, la patronne d'abord
  let qui: VendeuseId = "patronne";
  for (;;) {
    t += 5_000 + alea() * 3_500;
    if (t > dureeMs - DUREE_REPLIQUE_MS) break;
    dire(t, qui, qui === "patronne" ? REPLIQUES_VENDEUSES.ambiancePatronne : REPLIQUES_VENDEUSES.ambianceElsa);
    qui = qui === "patronne" ? "elsa" : "patronne";
  }
  return lignes;
}

/** La ligne en cours d'affichage `ageMs` après l'apparition de l'offre (la dernière commencée, tant que sa bulle dure), sinon null. */
export function ligneActive(scenario: readonly LigneVendeuse[], ageMs: number): LigneVendeuse | null {
  let courante: LigneVendeuse | null = null;
  for (const l of scenario) {
    if (l.t <= ageMs) courante = l;
    else break;
  }
  return courante && ageMs - courante.t < DUREE_REPLIQUE_MS ? courante : null;
}

/** La réplique de commande de la patronne pour cette offre (la première du scénario) : le fil d'annonces du HUD la cite. */
export function repliqueCommande(id: number): string {
  return scenarioOffre(id, vendeuseDeOffre(id))[0].texte;
}

/** Une formule de remerciement pour le fil d'annonces, tirée de `alea` ∈ [0, 1[. */
export function repliqueMerci(alea: number): string {
  return tirerReplique(REPLIQUES_VENDEUSES.merci, alea);
}

// ---------------------------------------------------------------------------------------------
// Figures filaires : cinématique
// ---------------------------------------------------------------------------------------------

export type V3 = [number, number, number];

/** Dimensions de la figure filaire (non mises à l'échelle) : hanches à 0,9 m du sol, torse 0,08 au-dessus, épaules à ±0,27 / 0,42 du torse. */
export const FIGURE = {
  hanches: 0.9, torseDepuisHanches: 0.08, epauleX: 0.27, epauleY: 0.42, teteDepuisTorse: 0.46,
  cuisse: 0.43, mollet: 0.43, brasHaut: 0.35, brasBas: 0.38,
} as const;

const norme = (v: V3): number => Math.hypot(v[0], v[1], v[2]);
const mul = (v: V3, k: number): V3 => [v[0] * k, v[1] * k, v[2] * k];
const sous = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unitaire = (v: V3): V3 => { const n = norme(v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const croix = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const borne = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

/** Résultat de `ikBras` : directions unitaires du bras et de l'avant-bras (repère du torse) ; `atteint` faux si la cible était hors de portée (main à bout de bras). */
export interface BrasIk { haut: V3; bas: V3; atteint: boolean }

/**
 * Cinématique inverse d'un bras à deux segments : `cible` est la position voulue de la main RELATIVE À L'ÉPAULE (même repère que `coudeVers`, qui indique
 * de quel côté le coude plie). Hors de portée, le bras se tend vers la cible ; trop près, il se plie au maximum. Renvoie des directions : le rendu en tire des
 * quaternions (`setFromUnitVectors`).
 */
export function ikBras(cible: V3, haut: number = FIGURE.brasHaut, bas: number = FIGURE.brasBas, coudeVers: V3 = [0.3, -1, 0.35]): BrasIk {
  const dBrut = norme(cible);
  const u: V3 = dBrut > 1e-6 ? mul(cible, 1 / dBrut) : [0, -1, 0];
  const dMin = Math.abs(haut - bas) + 1e-3, dMax = haut + bas - 1e-3;
  const d = borne(dBrut, dMin, dMax);
  // direction « de pliage » : le coude vers `coudeVers`, rendu perpendiculaire à la cible
  const h = unitaire(coudeVers);
  const k = h[0] * u[0] + h[1] * u[1] + h[2] * u[2];
  let w = sous(h, mul(u, k));
  if (norme(w) < 1e-4) w = croix(u, [1, 0, 0]);
  if (norme(w) < 1e-4) w = croix(u, [0, 0, 1]);
  w = unitaire(w);
  const cosA = borne((haut * haut + d * d - bas * bas) / (2 * haut * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const coude: V3 = mul([u[0] * cosA + w[0] * sinA, u[1] * cosA + w[1] * sinA, u[2] * cosA + w[2] * sinA], haut);
  const main: V3 = mul(u, d);
  return { haut: unitaire(coude), bas: unitaire(sous(main, coude)), atteint: dBrut <= dMax + 1e-6 && dBrut >= dMin - 1e-6 };
}

/**
 * Passe une cible exprimée dans le repère du torse DROIT (avant −z, haut +y, origine au torse) dans celui du torse penché de `rot` (angles d'Euler XYZ de
 * three, radians) : l'inverse de la rotation, appliquée dans l'ordre z, y, x. Penché ou non, la main finit au même endroit du monde.
 */
export function versRepereTorse(c: V3, rot: V3): V3 {
  let [x, y, z] = c;
  const [ax, ay, az] = rot;
  // R = Rx · Ry · Rz ⇒ R⁻¹ = Rz⁻¹ · Ry⁻¹ · Rx⁻¹ : d'abord Rx⁻¹ sur le vecteur
  let cs = Math.cos(-ax), sn = Math.sin(-ax);
  [y, z] = [y * cs - z * sn, y * sn + z * cs];
  cs = Math.cos(-ay); sn = Math.sin(-ay);
  [x, z] = [x * cs + z * sn, -x * sn + z * cs];
  cs = Math.cos(-az); sn = Math.sin(-az);
  [x, y] = [x * cs - y * sn, x * sn + y * cs];
  return [x, y, z];
}

/** Épaule gauche (0) ou droite (1) dans le repère du torse. */
export const epaule = (cote: 0 | 1): V3 => [cote === 0 ? -FIGURE.epauleX : FIGURE.epauleX, FIGURE.epauleY, 0];

/** Cible de main d'un bras ballant le long du corps (repère du torse). */
export const brasBallant = (cote: 0 | 1, ecart = 0.06): V3 => [(cote === 0 ? -1 : 1) * (FIGURE.epauleX + ecart), FIGURE.epauleY - 0.72, 0.02];

/** Une pose de figure : assise ou debout, inclinaisons du torse et de la tête (angles d'Euler XYZ, radians), cibles des mains [gauche, droite] dans le repère du torse DROIT. */
export interface PoseFigure {
  assise: boolean;
  torse: V3;
  tete: V3;
  mains: [V3, V3];
}

// ---------------------------------------------------------------------------------------------
// Cabine du Truck fou
// ---------------------------------------------------------------------------------------------

/**
 * Cabine du Truck Muche vue de l'intérieur (repère du truck : avant −z, droite +x, y depuis le sol ; plancher à `TRUCK.plancher` = 0,9) : deux sièges
 * côte à côte (Elsa conduit à gauche, la patronne à droite), un volant devant Elsa. `echelle` : celle des figures assises (les 0,9 du comptoir seraient
 * trop grands sous le toit à 2,5 m). Les cotes servent au rendu et aux tests (têtes sous le toit, mains sur le volant à portée).
 */
export const CABINE = {
  plancher: 0.9, toit: 2.5,
  echelle: 0.85,
  /** assise : hauteur de la hanche au-dessus du plancher, z de la hanche, x des deux sièges */
  assise: { y: 0.4, z: -2.45, x: 0.55 },
  volant: { x: -0.55, y: 1.62, z: -2.95, rayon: 0.19, inclinaison: 0.5 },
  /** le tableau de bord : dessus à 1,5 m, jusqu'à 0,5 m du pare-brise */
  tableauY: 1.5,
} as const;

/** Position (repère du truck) du centre du torse d'une figure assise de la cabine, pour `x` du siège. */
export function origineTorseAssis(x: number): V3 {
  const s = CABINE.echelle;
  return [x, CABINE.plancher + CABINE.assise.y + FIGURE.torseDepuisHanches * s, CABINE.assise.z];
}

/** Point du volant (repère de la cabine) à l'angle `a` (0 = à droite du volant, π/2 = en haut) après un braquage `braquage`. */
export function pointVolant(a: number, braquage: number): V3 {
  const { x, rayon, inclinaison, y, z } = CABINE.volant;
  const ang = a + braquage;
  // le haut du volant penche vers l'avant (−z)
  return [x + Math.cos(ang) * rayon, y + Math.sin(ang) * rayon * Math.cos(inclinaison), z - Math.sin(ang) * rayon * Math.sin(inclinaison)];
}

/** Une position de la cabine (repère du truck) dans le repère du torse DROIT de la figure assise en `x`, en unités de figure (non mises à l'échelle). */
export function cabineVersTorse(p: V3, xSiege: number): V3 {
  const o = origineTorseAssis(xSiege);
  const s = CABINE.echelle;
  return [(p[0] - o[0]) / s, (p[1] - o[1]) / s, (p[2] - o[2]) / s];
}

/** Entrées de la pose de conduite : vitesse signée (m/s), vitesse de lacet (rad/s, + = à gauche) et horloge locale (s). */
export interface EntreesConduite { v: number; lacet: number; tS: number }

/** Braquage du volant (rad) pour une vitesse de lacet : plafonné à ±0,9 (le volant ne fait pas trois tours). */
export const braquage = (lacet: number): number => borne(lacet * 0.55, -0.9, 0.9);

/**
 * Roulis du torse (rad) : on est poussé vers l'extérieur du virage (lacet > 0 = à gauche ⇒ penché vers la droite, roulis négatif), proportionnel à
 * l'accélération latérale `v × lacet`, plafonné à ±0,22.
 */
export const roulisVirage = (v: number, lacet: number): number => borne(-0.012 * v * lacet, -0.22, 0.22);

/**
 * Pose d'Elsa au volant : penchée en avant (elle fonce), les deux mains sur le volant (à 9 h et 3 h, elles tournent avec lui), la tête qui regarde la
 * route et compense le roulis, secousses du moteur proportionnelles à la vitesse. Sans mouvement (v = 0, lacet = 0) : posée droite, mains immobiles.
 */
export function poseConducteuse({ v, lacet, tS }: EntreesConduite): PoseFigure {
  const roulis = roulisVirage(v, lacet);
  const secousse = 0.012 * Math.min(1, Math.abs(v) / 10) * Math.sin(tS * 23);
  const b = braquage(lacet);
  const main = (cote: 0 | 1): V3 => {
    const p = pointVolant(cote === 0 ? Math.PI : 0, b);
    return cabineVersTorse(p, CABINE.volant.x);
  };
  return {
    assise: true,
    torse: [-0.12 + secousse, 0, roulis],
    tete: [0.1 + secousse, borne(lacet * 0.35, -0.5, 0.5), -roulis * 0.7],
    mains: [main(0), main(1)],
  };
}

/** Durée (s) d'un geste de la patronne (elle désigne la victime), et période entre deux gestes. */
const GESTE_PATRONNE_S = 1.6, PERIODE_PATRONNE_S = 5.5;

/**
 * Pose de la patronne, assise à droite : cramponnée au tableau de bord d'une main, l'autre qui désigne la victime toutes les 5,5 s (« Fonce ! »), la tête
 * tournée vers Elsa ou vers la route, roulis du virage comme Elsa.
 */
export function posePatronne({ v, lacet, tS }: EntreesConduite): PoseFigure {
  const roulis = roulisVirage(v, lacet);
  const secousse = 0.014 * Math.min(1, Math.abs(v) / 10) * Math.sin(tS * 19 + 1);
  const phase = tS % PERIODE_PATRONNE_S;
  const geste = phase < GESTE_PATRONNE_S ? Math.sin((phase / GESTE_PATRONNE_S) * Math.PI) : 0;
  const xSiege = CABINE.assise.x;
  // main gauche sur le tableau de bord (devant, à hauteur de poitrine), main droite : sur la cuisse, ou qui désigne la route devant
  const tableau = cabineVersTorse([xSiege - 0.15, CABINE.tableauY + 0.03, CABINE.assise.z - 0.65], xSiege);
  const cuisse = cabineVersTorse([xSiege + 0.2, CABINE.plancher + CABINE.assise.y + 0.1, CABINE.assise.z - 0.3], xSiege);
  const pointe = cabineVersTorse([xSiege + 0.1, CABINE.tableauY + 0.15, CABINE.assise.z - 0.6], xSiege);
  const droite: V3 = [cuisse[0] + (pointe[0] - cuisse[0]) * geste, cuisse[1] + (pointe[1] - cuisse[1]) * geste, cuisse[2] + (pointe[2] - cuisse[2]) * geste];
  return {
    assise: true,
    torse: [-0.06 - 0.08 * geste + secousse, 0, roulis],
    // elle regarde Elsa (à sa gauche) entre deux gestes, la route en désignant
    tete: [0.05, geste > 0.1 ? 0 : 0.5 + 0.1 * Math.sin(tS * 0.8), -roulis * 0.7],
    mains: [tableau, droite],
  };
}

// ---------------------------------------------------------------------------------------------
// Comptoir du Truck garé
// ---------------------------------------------------------------------------------------------

/** Ce que font les deux vendeuses au comptoir : `parle` (laquelle des deux a la parole, ou aucune), `sert` (celle qui tend son cadeau), `offre` (une offre est affichée). */
export interface EtatComptoir { parle: VendeuseId | null; sert: VendeuseId | null; offre: boolean }

const PLAN: V3 = [0, 0.1, -0.72];

/**
 * Pose d'une vendeuse au comptoir (debout, face au passe-plat). Elsa prépare (les mains pétrissent sur le plan de travail), sauf quand elle sert : elle
 * lève un bras et fait signe. La patronne, poings sur les hanches, gesticule quand elle parle ; quand c'est elle qui sert (sa formule), elle fait signe.
 * `tS` : horloge locale en secondes ; `voisine` : de quel côté (en x de la figure) se trouve l'autre vendeuse (−1 gauche, +1 droite, en x local), pour tourner la tête vers elle.
 */
export function poseComptoir(qui: VendeuseId, etat: EtatComptoir, tS: number, voisine: -1 | 1): PoseFigure {
  const parle = etat.parle === qui;
  const sert = etat.sert === qui && etat.offre;
  const respire = 0.012 * Math.sin(tS * 1.7);
  const tete: V3 = [0.04 * Math.sin(tS * 0.9), 0.35 * Math.sin(tS * 0.55), 0];
  // l'autre parle : on se tourne vers elle
  if (etat.parle && etat.parle !== qui) tete[1] = -0.6 * voisine; // rotation.y > 0 tourne le visage (−z) vers −x : le côté de la voisine (+x) demande un angle négatif
  const signe: V3 = [0.4, 0.95, -0.15 + 0.12 * Math.sin(tS * 3.1)];
  if (qui === "elsa") {
    const petrit = (cote: -1 | 1): V3 => [cote * 0.14 + 0.06 * Math.sin(tS * 2.1 + cote), PLAN[1] + 0.02 * Math.sin(tS * 4.2), PLAN[2] + 0.07 * Math.cos(tS * 2.1 + cote)];
    return {
      assise: false,
      torse: [-0.16 + respire, 0, 0],
      tete,
      mains: [petrit(-1), sert ? signe : petrit(1)],
    };
  }
  // la patronne : mains sur les hanches ; elle parle avec la main droite, ou lève le bras pour servir
  const hanche = (cote: -1 | 1): V3 => [cote * (FIGURE.epauleX + 0.1), -0.1, 0.02];
  const gesticule: V3 = [0.32 + 0.12 * Math.sin(tS * 3.3), 0.2 + 0.18 * Math.sin(tS * 4.1), -0.45 + 0.1 * Math.cos(tS * 3.3)];
  return {
    assise: false,
    torse: [-0.04 + respire, 0, 0],
    tete,
    mains: [hanche(-1), sert ? signe : parle ? gesticule : hanche(1)],
  };
}
