/**
 * Macron frappé d'un coup de batte (pur : ni three ni DOM, testé par lib/macron3d/ko.test.ts sur
 * le vrai squelette du GLB). Il produit, image par image, des intentions du même type que la course
 * (`IntentionsCourse`, lib/macron3d/course.ts) : le poseur (lib/macron3d/pose.ts) les applique sans
 * changement.
 *
 *   impact : la course s'arrête net, l'avance ne bouge plus (le canvas non plus),
 *   chute (≈ 0,6 s) : le buste part en arrière, le bassin descend jusqu'au sol, le corps bascule
 *     à plat sur le dos, sans traverser le sol,
 *   au sol (≈ 1,5 s) : un rebond, la tête qui roule (étoiles au-dessus, éléments HTML de la scène),
 *   relevé (≈ 1,2 s) : assis, sur un genou, debout,
 *   reprise (≈ 3 s) : la course repart dans le même sens, vitesse de 60 % à 100 %, bassin et tête
 *     qui roulent et oscillent de côté (et tanguent un peu), rythme des foulées irrégulier, puis
 *     course normale.
 *
 * Pendant la chute, le sol et le relevé, la course n'avance pas (`avancer` ne l'appelle pas) : sa
 * pose reprend exactement là où l'impact l'a figée, et `passageFini`, qui lit l'avance, attend.
 * Repère : celui de la course (visage +Z, haut +Y, gauche +X), positions relatives au bassin à
 * l'impact.
 */
import { bruit, borne, lerp, lisse } from "../tigre3d/ressorts";
import { DEG, MESURES, type Course, type EtatBras, type EtatPied, type IntentionsCourse, type Vec } from "./course";
import { COTES, SIGNE, type Cote } from "./os";

/** Durées des phases (s). */
export const DUREES_KO = { chute: 0.6, sol: 1.5, releve: 1.2, reprise: 3 } as const;
/** Fondu de la pose debout vers la course, au début de la reprise (s). */
export const FONDU_REPRISE = 0.45;
/** Vitesse au début de la reprise (part de la vitesse normale). */
export const VITESSE_REPRISE = 0.6;
/** Bulle de la reprise titubante, à la place de « En marche ! ». */
export const BULLE_KO = "En… marche… ?";

export type PhaseKO = "chute" | "sol" | "releve" | "reprise";

export interface KO {
  /** Temps depuis l'impact (s). */
  readonly t: number;
  /** Phase en cours, null une fois la reprise finie (la course normale reprend la main). */
  readonly phase: PhaseKO | null;
  /** Étoiles au-dessus de la tête (au sol, et au début du relevé). */
  readonly etoiles: boolean;
  /** La bulle « En… marche… ? » (reprise titubante). */
  readonly bulle: boolean;
  /**
   * Avance d'une image. Chute, sol, relevé : la course reste figée. Reprise : elle avance au
   * ralenti et par à-coups (vitesse et rythme des foulées irréguliers).
   */
  avancer(dt: number, course: Course): void;
  /** Intentions de l'image courante (`course` : celle qui a été figée à l'impact). */
  etat(course: Course): IntentionsCourse;
  /**
   * Rencontre annulée (démontage du tigre, changement de thème, onglet caché) : au sol, il se
   * relève tout de suite, pendant la chute il se relève dès qu'il touche le sol. Rien ne saute.
   */
  annuler(): void;
}

/** Pied d'une posture : position de la cheville (x latéral absolu, z relatif au bassin à l'impact). */
interface PiedKO {
  x: number; y: number; dz: number;
  /** Orientation monde (tangage, + = pointe levée) ou relative au tibia (angleCheville) selon poidsTibia. */
  tangage: number; angleCheville: number; poidsTibia: number;
  lacet: number;
  /** Direction de pli du genou. */
  pole: Vec;
}

interface Posture {
  bassin: { y: number; dz: number; tangage: number; roulis: number; lacet: number };
  dos: { tangage: number; roulis: number; lacet: number };
  tete: { tangage: number; roulis: number; lacet: number };
  pieds: Record<Cote, PiedKO>;
  bras: Record<Cote, EtatBras>;
  poing: number;
}

const v = (x: number, y: number, z: number): Vec => ({ x, y, z });
/** Cheville d'un pied à plat au sol. */
const PLAT = MESURES.cheville;
const bras = (balancement: number, coude: number, abduction: number, croise = 0, clavicule = 0): EtatBras => ({
  balancement: balancement * DEG, coude: coude * DEG, abduction: abduction * DEG, croise: croise * DEG, clavicule: clavicule * DEG,
});
const pied = (c: Cote, x: number, y: number, dz: number, o: Partial<PiedKO> = {}): PiedKO => ({
  x: SIGNE[c] * x, y, dz, tangage: 0, angleCheville: 0, poidsTibia: 0, lacet: SIGNE[c] * 6 * DEG,
  pole: v(0.13 * SIGNE[c], 0, 1), ...o,
});

/** Le choc : le buste part en arrière, la tête bascule, les bras sont projetés vers l'avant. */
const RECUL: Posture = {
  bassin: { y: 0.86, dz: -0.07, tangage: -12 * DEG, roulis: 3 * DEG, lacet: 4 * DEG },
  dos: { tangage: -22 * DEG, roulis: 0, lacet: 0 },
  tete: { tangage: -30 * DEG, roulis: 6 * DEG, lacet: 0 },
  pieds: {
    G: pied("G", 0.09, PLAT, 0.08),
    D: pied("D", 0.09, PLAT, -0.1),
  },
  bras: { G: bras(55, 35, 28, 0, 8), D: bras(45, 30, 32, 0, 8) },
  poing: 0.2,
};

/** Il tombe sur les fesses : bassin bas et en arrière, pieds qui partent devant, bras vers l'arrière. */
const ASSIS: Posture = {
  bassin: { y: 0.36, dz: -0.24, tangage: -42 * DEG, roulis: -2 * DEG, lacet: 2 * DEG },
  dos: { tangage: -12 * DEG, roulis: 0, lacet: 0 },
  tete: { tangage: -18 * DEG, roulis: -5 * DEG, lacet: 0 },
  pieds: {
    G: pied("G", 0.13, PLAT + 0.02, 0.24, { tangage: 18 * DEG, pole: v(0.2, 0.6, 0.8) }),
    D: pied("D", 0.12, PLAT + 0.05, 0.16, { tangage: 25 * DEG, pole: v(-0.2, 0.6, 0.8) }),
  },
  bras: { G: bras(-40, 25, 40), D: bras(-35, 25, 40) },
  poing: 0.1,
};

/** À plat sur le dos : jambes allongées devant, bras écartés, visage vers le ciel. */
const A_PLAT: Posture = {
  bassin: { y: 0.13, dz: -0.38, tangage: -86 * DEG, roulis: 0, lacet: 3 * DEG },
  dos: { tangage: -2 * DEG, roulis: 0, lacet: 0 },
  tete: { tangage: -82 * DEG, roulis: 8 * DEG, lacet: 10 * DEG },
  pieds: {
    G: pied("G", 0.17, 0.1, 0.38, { poidsTibia: 1, angleCheville: -25 * DEG, lacet: 25 * DEG, pole: v(0.25, 1, 0.1) }),
    D: pied("D", 0.15, 0.1, 0.32, { poidsTibia: 1, angleCheville: -25 * DEG, lacet: -22 * DEG, pole: v(-0.25, 1, 0.1) }),
  },
  bras: { G: bras(4, 25, 72), D: bras(2, 30, 68) },
  poing: 0,
};

/** Assis, sonné : buste redressé, genoux pliés, bras posés sur les genoux. */
const RELEVE_ASSIS: Posture = {
  bassin: { y: 0.14, dz: -0.38, tangage: -18 * DEG, roulis: 3 * DEG, lacet: 0 },
  dos: { tangage: 12 * DEG, roulis: 0, lacet: 0 },
  tete: { tangage: 12 * DEG, roulis: 10 * DEG, lacet: -6 * DEG },
  pieds: {
    G: pied("G", 0.15, PLAT, 0.08, { tangage: 5 * DEG, pole: v(0.3, 0.8, 0.5) }),
    D: pied("D", 0.14, PLAT, 0.04, { tangage: 5 * DEG, pole: v(-0.3, 0.8, 0.5) }),
  },
  bras: { G: bras(28, 50, 22), D: bras(24, 55, 22) },
  poing: 0,
};

/** Un genou à terre (le gauche), le pied droit posé devant : il pousse pour se relever. */
const GENOU: Posture = {
  bassin: { y: 0.5, dz: -0.14, tangage: 14 * DEG, roulis: -3 * DEG, lacet: -6 * DEG },
  dos: { tangage: 16 * DEG, roulis: 0, lacet: 0 },
  tete: { tangage: 6 * DEG, roulis: -8 * DEG, lacet: 6 * DEG },
  pieds: {
    // Pied gauche derrière, talon levé sur les orteils à plat (cheville au-dessus de la plante).
    G: pied("G", 0.1, 0.15, -0.46, { tangage: -55 * DEG, pole: v(0.1, -0.2, 1) }),
    D: pied("D", 0.13, PLAT, 0.2, { pole: v(-0.15, 0.2, 1) }),
  },
  bras: { G: bras(18, 45, 18), D: bras(25, 55, 14) },
  poing: 0.3,
};

/** Debout, encore groggy. */
const DEBOUT: Posture = {
  bassin: { y: 0.9, dz: 0, tangage: 5 * DEG, roulis: 4 * DEG, lacet: 0 },
  dos: { tangage: 6 * DEG, roulis: -3 * DEG, lacet: 0 },
  tete: { tangage: 4 * DEG, roulis: 8 * DEG, lacet: -5 * DEG },
  pieds: {
    G: pied("G", 0.1, PLAT, -0.06),
    D: pied("D", 0.1, PLAT, 0.08),
  },
  bras: { G: bras(-6, 25, 12), D: bras(-4, 22, 12) },
  poing: 0.5,
};

/** Posture → intentions, autour du bassin à l'impact. */
function intentions(p: Posture, d: IntentionsCourse): IntentionsCourse {
  const z0 = d.bassin.p.z;
  const pieds = {} as Record<Cote, EtatPied>;
  for (const c of COTES) {
    const q = p.pieds[c];
    pieds[c] = {
      appui: true, avancement: 0, cheville: v(q.x, q.y, z0 + q.dz), lacet: q.lacet, tangage: q.tangage,
      // Talon levé : les orteils restent à plat au sol (comme à la poussée de la course).
      angleCheville: q.angleCheville, poidsTibia: q.poidsTibia, orteils: Math.max(0, -q.tangage) * (1 - q.poidsTibia),
      pole: q.pole, talon: null, plante: null,
    };
  }
  return {
    t: d.t, phase: d.phase, avance: d.avance, vitesse: 0,
    bassin: { p: v(d.bassin.p.x, p.bassin.y, z0 + p.bassin.dz), lacet: p.bassin.lacet, tangage: p.bassin.tangage, roulis: p.bassin.roulis },
    dos: { ...p.dos },
    tete: { ...p.tete },
    pieds,
    bras: { G: { ...p.bras.G }, D: { ...p.bras.D } },
    poing: p.poing,
  };
}

const lv = (a: Vec, b: Vec, k: number): Vec => v(lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.z, b.z, k));
const la = <T extends Record<string, number>>(a: T, b: T, k: number): T => {
  const r = {} as Record<string, number>;
  for (const cle of Object.keys(a)) r[cle] = lerp(a[cle], b[cle], k);
  return r as T;
};

/** Mélange de deux intentions (k = 0 : a, 1 : b). Les points d'appui verrouillés suivent la plus proche. */
export function melanger(a: IntentionsCourse, b: IntentionsCourse, k: number): IntentionsCourse {
  const pieds = {} as Record<Cote, EtatPied>;
  for (const c of COTES) {
    const pa = a.pieds[c], pb = b.pieds[c], proche = k < 0.5 ? pa : pb;
    pieds[c] = {
      appui: proche.appui, avancement: lerp(pa.avancement, pb.avancement, k),
      cheville: lv(pa.cheville, pb.cheville, k), lacet: lerp(pa.lacet, pb.lacet, k), tangage: lerp(pa.tangage, pb.tangage, k),
      angleCheville: lerp(pa.angleCheville, pb.angleCheville, k), poidsTibia: lerp(pa.poidsTibia, pb.poidsTibia, k),
      orteils: lerp(pa.orteils, pb.orteils, k), pole: lv(pa.pole, pb.pole, k),
      talon: proche.talon, plante: proche.plante,
    };
  }
  return {
    t: lerp(a.t, b.t, k), phase: lerp(a.phase, b.phase, k), avance: lerp(a.avance, b.avance, k), vitesse: lerp(a.vitesse, b.vitesse, k),
    bassin: {
      p: lv(a.bassin.p, b.bassin.p, k), lacet: lerp(a.bassin.lacet, b.bassin.lacet, k),
      tangage: lerp(a.bassin.tangage, b.bassin.tangage, k), roulis: lerp(a.bassin.roulis, b.bassin.roulis, k),
    },
    dos: la(a.dos, b.dos, k),
    tete: la(a.tete, b.tete, k),
    pieds,
    bras: { G: la(a.bras.G as unknown as Record<string, number>, b.bras.G as unknown as Record<string, number>, k) as unknown as EtatBras,
      D: la(a.bras.D as unknown as Record<string, number>, b.bras.D as unknown as Record<string, number>, k) as unknown as EtatBras },
    poing: lerp(a.poing, b.poing, k),
  };
}

/** Au sol, la tête sonnée se calme pendant ce temps (s) avant qu'il se relève. */
const CALME = 0.35;

const sortie = (u: number) => 1 - (1 - u) * (1 - u);
const entree = (u: number) => u * u;

/**
 * Chute : départ (la pose de l'impact) → recul → assis → à plat. Chaque segment a sa courbe : le
 * choc part vite, la descente accélère jusqu'au sol.
 */
const CHUTE: ReadonlyArray<{ fin: number; posture: Posture; courbe: (u: number) => number }> = [
  { fin: 0.3, posture: RECUL, courbe: sortie },
  { fin: 0.7, posture: ASSIS, courbe: lisse },
  { fin: 1, posture: A_PLAT, courbe: entree },
];
/** Relevé : à plat → assis → un genou → debout (parts de la durée du relevé). */
const RELEVE: ReadonlyArray<{ fin: number; posture: Posture }> = [
  { fin: 0.3, posture: RELEVE_ASSIS },
  { fin: 0.6, posture: GENOU },
  { fin: 1, posture: DEBOUT },
];

export function creerKO(depart: IntentionsCourse, graine = 1): KO {
  // Copie : la course réutilise ses objets d'une image à l'autre.
  const d = structuredClone(depart);
  const durees: { chute: number; sol: number; releve: number; reprise: number } = { ...DUREES_KO };
  const postures = {
    plat: intentions(A_PLAT, d),
    chute: CHUTE.map((s) => intentions(s.posture, d)),
    releve: RELEVE.map((s) => intentions(s.posture, d)),
  };
  let t = 0;
  /** Temps de reprise (s depuis la fin du relevé), compté sur l'horloge réelle. */
  const bornes = () => {
    const sol = durees.chute + durees.sol, releve = sol + durees.releve;
    return { chute: durees.chute, sol, releve, fin: releve + durees.reprise };
  };
  const phase = (): PhaseKO | null => {
    const b = bornes();
    if (t < b.chute) return "chute";
    if (t < b.sol) return "sol";
    if (t < b.releve) return "releve";
    return t < b.fin ? "reprise" : null;
  };

  /** Pose de la chute, du sol ou du relevé à l'instant t. */
  function poseFigee(): IntentionsCourse {
    const b = bornes();
    if (t < b.chute) {
      const u = t / durees.chute;
      let debut = 0, de = d;
      for (let i = 0; i < CHUTE.length; i++) {
        const s = CHUTE[i];
        if (u <= s.fin || i === CHUTE.length - 1) return melanger(de, postures.chute[i], s.courbe(borne((u - debut) / (s.fin - debut), 0, 1)));
        debut = s.fin;
        de = postures.chute[i];
      }
    }
    if (t < b.sol) {
      // Au sol : petit rebond à l'arrivée, puis la tête roule (il est sonné), un genou se plie.
      const u = t - b.chute;
      const it = melanger(postures.plat, postures.plat, 0);
      const rebond = Math.exp(-7 * u) * Math.sin(16 * u);
      it.bassin.p.y += 0.02 * Math.max(0, rebond);
      it.dos.tangage += 6 * DEG * rebond;
      // La tête se calme avant le relevé : il part d'une pose immobile, rien ne saute.
      const sonne = lisse(u / 0.3) * (1 - lisse((u - durees.sol + CALME) / CALME));
      it.tete.roulis += 14 * DEG * Math.sin(u * 4.2) * sonne;
      it.tete.lacet += 18 * DEG * Math.sin(u * 2.6 + 0.8) * sonne;
      const genou = lisse((u - 0.5) / 0.5) * (1 - lisse((u - durees.sol + 0.4) / 0.4));
      it.pieds.G.cheville.z -= 0.12 * genou;
      return it;
    }
    const u = borne((t - b.sol) / durees.releve, 0, 1);
    let debut = 0, de = postures.plat;
    for (let i = 0; i < RELEVE.length; i++) {
      const s = RELEVE[i];
      if (u <= s.fin || i === RELEVE.length - 1) return melanger(de, postures.releve[i], lisse(borne((u - debut) / (s.fin - debut), 0, 1)));
      debut = s.fin;
      de = postures.releve[i];
    }
    return postures.releve[RELEVE.length - 1];
  }

  /** Effets de la reprise titubante (1 au début, 0 à la fin). */
  const titube = (tr: number) => 1 - lisse(tr / durees.reprise);

  return {
    get t() { return t; },
    get phase() { return phase(); },
    get etoiles() {
      const b = bornes();
      return t > b.chute - 0.1 && t < b.sol + 0.5 * durees.releve;
    },
    get bulle() {
      const b = bornes();
      return t >= b.releve + 0.2 && t < b.fin - 0.4;
    },
    avancer(dt, course) {
      if (dt <= 0) return;
      const b = bornes();
      const avant = t;
      t += dt;
      if (t <= b.releve) return;
      // Reprise : vitesse de 60 % à 100 %, rythme irrégulier (à-coups de la cadence).
      const tr = Math.max(0, t - b.releve), w = titube(tr);
      const facteur = lerp(VITESSE_REPRISE, 1, lisse(tr / durees.reprise)) * (1 + 0.28 * w * bruit(tr * 2.4, graine + 5));
      course.avancer((t - Math.max(avant, b.releve)) * Math.max(0.2, facteur));
    },
    etat(course) {
      const b = bornes();
      if (t < b.releve) return poseFigee();
      const tr = t - b.releve;
      const it = course.etat();
      const k = lisse(tr / FONDU_REPRISE);
      const r = k >= 1 ? structuredClone(it) : melanger(postures.releve[RELEVE.length - 1], it, k);
      // Il titube : bassin et tête qui roulent et oscillent de côté, déport latéral.
      const w = titube(tr) * lisse(tr / 0.2);
      r.bassin.roulis += w * 9 * DEG * Math.sin(tr * 5.1 + bruit(tr, graine) * 1.5);
      r.bassin.lacet += w * 10 * DEG * Math.sin(tr * 3.4 + 1);
      r.bassin.p.x += w * 0.035 * Math.sin(tr * 3.9);
      r.dos.roulis += w * 5 * DEG * Math.sin(tr * 4.4 + 2);
      r.tete.roulis += w * 14 * DEG * Math.sin(tr * 4.4 + 2.2);
      r.tete.lacet += w * 12 * DEG * Math.sin(tr * 3 + 0.4);
      // Vu presque de profil, roulis et lacet se lisent mal : le buste et la tête tanguent aussi un peu.
      r.dos.tangage += w * 7 * DEG * Math.sin(tr * 3.3 + 0.5);
      r.tete.tangage += w * 8 * DEG * Math.sin(tr * 4.1 + 1.3);
      return r;
    },
    annuler() {
      const b = bornes();
      if (t < b.chute) durees.sol = CALME;
      else if (t < b.sol) durees.sol = Math.min(durees.sol, t - b.chute + CALME);
    },
  };
}
