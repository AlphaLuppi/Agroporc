/**
 * Coup de batte (« BONK ! ») : la rencontre avec Macron (lib/rencontre.ts) arrête le tigre de
 * profil face à lui, puis lance ce geste. Le tigre se dresse sur ses pattes arrière (cabré autour
 * des hanches, comme le serre-main), les deux pattes avant tiennent une batte de baseball armée
 * au-dessus de l'épaule, et il attend. Le signal de frappe (`ctx.tClap`, posé par l'animateur
 * quand Macron arrive à portée) lance le coup en quatre temps : élan, frappe montante vers le
 * corps de Macron, accompagnement, tenue. Puis la batte disparaît et il retombe à quatre pattes.
 * Sans signal (Macron parti, embuscade abandonnée : `ctx.tVexe`, ou attente trop longue), il
 * baisse la batte et repart.
 *
 * La batte n'est pas un os : c'est un maillage (lib/tigre3d/batte-maillage.ts) rattaché à l'os
 * `mainD`. Ce module donne, en pur, son échelle (apparition, disparition) et son angle dans le
 * plan sagittal du tigre (`etatBatte`), que la scène applique à chaque image. Les pattes avant
 * suivent la poignée sur le même calendrier.
 *
 * Repère « sol » des positions ci-dessous : celui du modèle au repos (museau +Z, haut +Y), le
 * tigre déjà dressé (cf. `solVersCorps`). Angle de la batte : 0 = pointée vers l'avant (vers
 * Macron), π/2 = vers le haut, π = vers l'arrière.
 */
import { borne, bruit, lerp, lisse, rampe, solVersCorps, extremiteMonde, impact as choc } from "./outils";
import type { CorpsGeste } from "./outils";
import { LONGUEUR_MODELE_M } from "../os";
import type { EvenementGeste, Geste, PoseGeste, Vec3 } from "./types";

const DEG = Math.PI / 180;

/**
 * Batte : environ 1 m à l'échelle du tigre adulte (3,75 m), un peu plus pour rester lisible à
 * l'écran. `LONGUEUR_BATTE` en mètres du modèle (1,104 m). La poignée (les pattes) est à
 * `POIGNEE_BATTE` de la longueur depuis le bout du manche.
 */
export const LONGUEUR_BATTE_M = 1.15;
export const LONGUEUR_BATTE = (LONGUEUR_BATTE_M * LONGUEUR_MODELE_M) / 3.75;
export const POIGNEE_BATTE = 0.12;
/**
 * Point de la batte qui touche Macron (part de la longueur depuis le bout du manche) : près du
 * bout, pour que la batte se voie entière entre le tigre et lui.
 */
export const POINT_CONTACT = 0.9;
/**
 * Au contact, ce point est à `AVANCE_CONTACT` m du modèle devant le centre du corps (vérifié par
 * batte.test.ts) : la rencontre en tire la portée du coup en pixels.
 */
export const AVANCE_CONTACT = 0.27;

/** Il se dresse (poids qui montent, la queue d'abord) : la batte est armée à cet instant (s). */
export const PRET_BATTE = 0.7;
/** La queue part la première, pour passer derrière lui avant qu'il se cabre. */
const AVANCE_QUEUE = 0.25;
/** Apparition de la batte : montée d'échelle de 0,15 s pendant qu'il se dresse. */
export const APPARITION_BATTE = { debut: 0.3, duree: 0.15 } as const;
/** Disparition de la batte au début de la sortie (s). */
const DISPARITION_BATTE = 0.12;
/** Attente maximale batte armée (s depuis le début du geste) : sans signal, il abandonne. */
export const ATTENTE_MAX_BATTE = 5;
/** Il retombe à quatre pattes (poids qui retombent). */
export const SORTIE_BATTE = 0.6;
/** Tangage du corps dressé (rad) : le dos penche un peu vers Macron. */
const TANGAGE = 1.2;

/**
 * Le coup, en secondes depuis le signal : [instant, angle de la batte (°), poignée (haut, avant),
 * tangage ajouté, lacet du corps]. Armé : batte au-dessus de l'épaule, vers l'arrière. Élan : elle
 * recule, le corps se cambre et se tord. Frappe : elle plonge sous les pattes puis remonte vers
 * l'avant (frappe montante). Accompagnement : elle finit dressée devant lui. Tenue.
 */
type Cle = readonly [number, number, number, number, number, number];
const CLES: readonly Cle[] = [
  [0, 112, 0.82, -0.08, 0, 0],
  [0.22, 160, 0.86, -0.18, 0.12, 0.22],
  [0.36, 382, 0.53, -0.02, -0.16, -0.15],
  [0.61, 450, 0.76, -0.06, -0.08, -0.1],
  [1.11, 452, 0.76, -0.06, -0.03, 0],
];
/** Courbe de chaque segment : élan lissé, frappe qui accélère, accompagnement qui freine, tenue. */
const COURBES: ReadonlyArray<(u: number) => number> = [lisse, (u) => u * u, (u) => 1 - (1 - u) * (1 - u), lisse];
/** Fin de la tenue : la batte disparaît et la sortie commence. */
export const FIN_COUP = CLES[CLES.length - 1][0];
/** Durée du coup après le signal, sortie comprise. */
export const DUREE_COUP = FIN_COUP + SORTIE_BATTE;
/** Angle de la batte (°) à l'instant du contact : légèrement montante, vers Macron. */
const ANGLE_CONTACT = 365;

/** Le coup à `s` secondes du signal (avant 0 : la pose armée). */
function coup(s: number): { angle: number; poignee: [number, number]; tangage: number; lacet: number } {
  let k = 0;
  while (k < CLES.length - 2 && s > CLES[k + 1][0]) k++;
  const a = CLES[k], b = CLES[k + 1];
  const u = COURBES[k](borne((s - a[0]) / (b[0] - a[0]), 0, 1));
  return {
    angle: lerp(a[1], b[1], u) * DEG,
    poignee: [lerp(a[2], b[2], u), lerp(a[3], b[3], u)],
    tangage: lerp(a[4], b[4], u),
    lacet: lerp(a[5], b[5], u),
  };
}

/** Instant du contact (s depuis le signal) : la batte passe par ANGLE_CONTACT pendant la frappe. */
export const T_IMPACT = (() => {
  const [a, b] = [CLES[1], CLES[2]];
  return a[0] + Math.sqrt((ANGLE_CONTACT - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
})();

/** Fin de la pose (s depuis le début du geste) : signal + coup, abandon, ou attente dépassée. */
function finPose(tClap: number | null, tVexe: number | null): number {
  if (tClap != null) return tClap + FIN_COUP;
  return tVexe ?? ATTENTE_MAX_BATTE;
}

/**
 * Batte à l'instant `t` du geste : échelle (0 cachée, 1 en main) et angle dans le plan sagittal
 * (rad, 0 = vers Macron, π/2 = vers le haut). Lue par la scène à chaque image.
 */
export function etatBatte(t: number, ctx: { tClap: number | null; tVexe: number | null }): { echelle: number; angle: number } {
  const fin = finPose(ctx.tClap, ctx.tVexe);
  const apparition = lisse((t - APPARITION_BATTE.debut) / APPARITION_BATTE.duree);
  // Petit dépassement à l'apparition (elle « pousse » dans la patte), sans à-coup.
  const pop = 1 + 0.12 * Math.sin(Math.PI * borne((t - APPARITION_BATTE.debut) / (APPARITION_BATTE.duree * 1.6), 0, 1));
  const echelle = apparition * pop * (1 - lisse((t - fin) / DISPARITION_BATTE));
  return { echelle, angle: angleBatte(t, ctx.tClap) };
}

/** Angle de la batte : armée, elle oscille un peu (le tigre trépigne), puis suit le coup. */
function angleBatte(t: number, tClap: number | null): number {
  const s = tClap == null ? -1 : t - tClap;
  const attente = tClap == null ? 1 : 1 - rampe(s, 0, 0.1);
  return coup(s).angle + 5 * DEG * Math.sin(t * 2 * Math.PI * 1.3) * attente * rampe(t, PRET_BATTE, PRET_BATTE + 0.3);
}

const ZERO: NonNullable<PoseGeste["poids"]> = {
  corps: 0, colonne: 0, cou: 0, tete: 0, machoire: 0, oreilles: 0, queue: 0, avG: 0, avD: 0, arG: 0, arD: 0,
};

/** Événements du coup, datés depuis le signal : contact, secousse, éclats, bulle. */
export const EVENEMENTS_BATTE: readonly EvenementGeste[] = [
  { t: T_IMPACT, type: "impact" },
  { t: T_IMPACT, type: "secousse", duree: 0.35 },
  { t: T_IMPACT, type: "particules", genre: "clap", nombre: 10 },
  { t: T_IMPACT, type: "bulle", texte: "BONK !", duree: 1.2 },
];

export const batte: Geste = {
  duree: ATTENTE_MAX_BATTE + SORTIE_BATTE,
  immobile: true,
  // De profil, face à Macron (le sens est celui de la cible, passé par la rencontre).
  cap: (sens) => sens * Math.PI / 2,
  // Pas de bulle avant le coup : « BONK ! » part à l'impact.
  evenements: [],
  evenementsSignal: EVENEMENTS_BATTE,
  pret: PRET_BATTE,
  dureeApresSignal: DUREE_COUP,
  dureeInterruption: SORTIE_BATTE,
  echantillonner(t, ctx) {
    const { tClap, tVexe } = ctx;
    const fin = finPose(tClap, tVexe);
    const s = tClap == null ? -1 : t - tClap;
    const c = coup(s);
    // Armé : il trépigne un peu (rebond, tête qui suit), plus fort quand l'attente dure.
    const attente = (tClap == null ? 1 : 1 - rampe(s, 0, 0.1)) * rampe(t, PRET_BATTE, PRET_BATTE + 0.3);
    const rebond = attente * (0.006 * Math.sin(t * 2 * Math.PI * 1.3) + 0.004 * bruit(ctx.temps * 1.7, 3));
    const secoue = tClap == null ? 0 : choc(s, T_IMPACT, 22, 0.35);
    const co: CorpsGeste = {
      tangage: TANGAGE + c.tangage - 0.04 * secoue, lacet: c.lacet, dy: rebond, dz: 0.02 * secoue, pivot: "hanches",
    };
    // Poignée : les deux pattes serrées sur le manche, la droite au-dessus, un peu du côté de la
    // caméra (de profil face au sens 1, on voit son flanc droit, x < 0), pour qu'on les voie à côté
    // de la tête quand la batte est armée.
    const angle = angleBatte(t, tClap);
    const dir: [number, number] = [Math.sin(angle), Math.cos(angle)];
    const [h, z] = c.poignee;
    const cote = -ctx.sens * 0.04;
    const main = (x: number, le: number): Vec3 => [cote + x, h + le * dir[0], z + le * dir[1]];
    const pattes: NonNullable<PoseGeste["pattes"]> = {
      avD: { cible: solVersCorps(co, main(-0.02, 0.02)), extremite: extremiteMonde(co, [-1.3, 0, 0]) },
      avG: { cible: solVersCorps(co, main(0.02, -0.025)), extremite: extremiteMonde(co, [-1.3, 0, 0]) },
    };
    // Tête de niveau (le corps est dressé), tournée vers Macron, gueule ouverte à l'impact.
    const cri = tClap == null ? 0 : rampe(s, T_IMPACT - 0.08, T_IMPACT) * (1 - rampe(s, FIN_COUP - 0.3, FIN_COUP));
    const tangageTete = TANGAGE + c.tangage;
    const deltas: NonNullable<PoseGeste["deltas"]> = {
      cou: [0.62 * tangageTete, 0, 0],
      tete: [0.38 * tangageTete - 0.1 * cri, 0, 0],
      machoire: [0.38 * tangageTete + 0.18 * cri, 0, 0],
      oreilleG: [0.38 * tangageTete - 0.35 * (1 - cri) - 0.1 * cri, 0, 0.15],
      oreilleD: [0.38 * tangageTete - 0.35 * (1 - cri) - 0.1 * cri, 0, -0.15],
      queue1: [0.55, 0, 0], queue2: [0.5, 0, 0], queue3: [0.4, 0.3 * secoue, 0],
    };
    const p: PoseGeste = {
      corps: co, pattes, deltas,
      regard: 0,
      poids: { corps: 1, colonne: 0, cou: 1, tete: 1, machoire: 1, oreilles: 1, queue: 1, avG: 1, avD: 1, arG: 0, arD: 0 },
    };
    if (t < AVANCE_QUEUE) return { ...p, poids: { ...ZERO, queue: 1 } };
    // Sortie : la pose reste la cible, les poids retombent (il se remet à quatre pattes).
    return t > fin ? { ...p, poids: ZERO } : p;
  },
};
