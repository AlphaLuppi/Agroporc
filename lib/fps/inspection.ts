/**
 * Inspection de l'arme en main (touche `inspecter`, I par défaut) : chronologie PURE (ni three ni horloge, le temps `t` est fourni) de ce que
 * fait l'arme vue depuis la caméra. Le couteau enchaîne des tricks de couteau papillon (ouverture en vrille, lancer-rattraper, moulinet de poignet),
 * l'épée un moulinet dans le plan de l'écran, une arme de poing regarde son flanc droit puis gauche et fait un tour de gunspin, une arme longue
 * montre ses deux flancs puis se penche sur la culasse. Client seulement : aucun message, les autres joueurs ne la voient pas.
 * `rendu.ts` (`ArmeEnMain.inspecter`) applique la pose : `ensemble` décale et incline les bras ET l'arme dans le repère de la caméra, `arme`
 * tourne l'arme seule autour de sa prise (la main arrière reste sur la poignée). Les angles sont des angles d'Euler en radians ; l'ordre est
 * donné par pose (`"ZXY"` : la rotation en z, appliquée en dernier, tourne dans le plan de l'écran). Toute pose finit sur la pose neutre
 * (angles multiples de 2π, décalages nuls) : la reprise est sans à-coup. Annulée par un tir, une visée, une recharge, un changement d'arme ou le sprint.
 */
import type { ArmeId } from "./protocole";

export type FamilleInspection = "couteau" | "epee" | "arme_courte" | "arme_longue";

/** Ordre des rotations d'Euler de three (`THREE.Euler.order`). */
export type OrdreEuler = "XYZ" | "ZXY" | "YXZ";

export interface PoseInspection {
  /** bras + arme dans le repère de la caméra : décalage (m) et inclinaison (rad, ordre XYZ) */
  ensemble: { x: number; y: number; z: number; rx: number; ry: number; rz: number };
  /** l'arme seule autour de sa prise : décalage (m) et rotation (rad) */
  arme: { x: number; y: number; z: number; rx: number; ry: number; rz: number; ordre: OrdreEuler };
}

const TAU = Math.PI * 2;

/** Pose de repos : aucun décalage, aucune rotation. */
export function poseNeutre(): PoseInspection {
  return {
    ensemble: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
    arme: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, ordre: "XYZ" },
  };
}

const POIDS_LEGER: readonly string[] = ["pistolet", "revolver", "mini_uzi", "magnum_dore", "perforeuse", "rayon", "fumigene"];

/** Famille de gestes d'une arme : le couteau, l'épée, les armes qui se tiennent d'une main ou courtes, et le reste (armes d'épaule). */
export function familleInspection(arme: ArmeId): FamilleInspection {
  if (arme === "couteau") return "couteau";
  if (arme === "epee") return "epee";
  return POIDS_LEGER.includes(arme) ? "arme_courte" : "arme_longue";
}

/** Part de l'amplitude des mouvements : les armes très lourdes ne se balancent pas autant que les autres. */
const AMPLITUDE: Partial<Record<ArmeId, number>> = { bazooka: 0.55, minigun: 0.5, railgun: 0.8, lance_grenades: 0.7, mitrailleuse: 0.85, soufflerie: 0.8 };
export const amplitudeInspection = (arme: ArmeId): number => AMPLITUDE[arme] ?? 1;

const DUREES: Record<FamilleInspection, number> = { couteau: 3.6, epee: 3.8, arme_courte: 3.2, arme_longue: 3.6 };
/** Durée (s) de l'inspection de l'arme. */
export const dureeInspection = (arme: ArmeId): number => DUREES[familleInspection(arme)];

const borne = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lisse = (x: number) => { const u = borne(x); return u * u * (3 - 2 * u); };
/** Marche lissée 0 → 1 entre `a` et `b` (s). */
const rampe = (t: number, a: number, b: number) => lisse((t - a) / (b - a));
/** Bosse 0 → 1 → 0 sur [a, b]. */
const bosse = (t: number, a: number, b: number) => Math.sin(Math.PI * borne((t - a) / (b - a)));
/** Nombre de tours (rad) accompli entre `a` et `b`, démarrage et arrivée doux. */
const tours = (t: number, a: number, b: number, n: number) => n * TAU * rampe(t, a, b);

const enrouler = (x: number) => x - TAU * Math.round(x / TAU);

/** Entrée puis sortie de l'inspection : l'arme monte vers le centre, redescend à la fin. */
const enveloppe = (t: number, d: number) => rampe(t, 0, 0.35) - rampe(t, d - 0.35, d);

/**
 * Pose de l'arme à l'instant `t` (s depuis le début de l'inspection). Hors de [0, durée] : la pose neutre. Continue sur toute la durée.
 */
export function poseInspection(arme: ArmeId, t: number): PoseInspection {
  const d = dureeInspection(arme);
  const pose = poseNeutre();
  if (!(t > 0) || t >= d) return pose;
  const e = enveloppe(t, d);
  const k = amplitudeInspection(arme);
  const { ensemble: g, arme: a } = pose;
  switch (familleInspection(arme)) {
    case "couteau": {
      g.x = -0.1 * e; g.y = 0.07 * e; g.z = 0.1 * e;
      g.rx = 0.2 * e;
      // 1. ouverture « papillon » : deux vrilles de la lame autour de son axe, la poignée bascule d'un côté puis de l'autre
      a.rz = tours(t, 0.35, 1.25, 2);
      a.rx = 0.9 * bosse(t, 0.35, 1.25) * Math.sin(TAU * rampe(t, 0.35, 1.25));
      // 2. lancer-rattraper : le couteau monte en tournant deux fois sur lui-même vers l'avant et retombe dans la main
      a.y = 0.26 * bosse(t, 1.25, 2.15);
      a.z = -0.06 * bosse(t, 1.25, 2.15);
      a.rx += -tours(t, 1.25, 2.15, 2);
      // 3. moulinet de poignet : un tour complet à plat, lame vers l'extérieur
      a.ry = tours(t, 2.15, 3.0, 1);
      a.rz += 0.4 * bosse(t, 2.15, 3.0);
      // 4. présentation : la lame se penche vers la caméra puis revient
      a.rx += -0.6 * bosse(t, 3.0, 3.6);
      break;
    }
    case "epee": {
      g.x = -0.08 * e; g.y = 0.05 * e; g.z = 0.1 * e;
      a.ordre = "ZXY";
      // lame dressée, puis moulinet dans le plan de l'écran (z tourne en dernier) : deux tours, un dans chaque sens
      a.rx = 0.95 * (rampe(t, 0.3, 0.9) - rampe(t, 3.1, 3.6));
      a.rz = -tours(t, 0.9, 1.9, 1) + tours(t, 1.9, 2.9, 1);
      a.ry = 0.35 * bosse(t, 2.9, 3.4);
      a.y = 0.04 * bosse(t, 0.9, 2.9);
      break;
    }
    case "arme_courte": {
      g.x = -0.07 * e; g.y = 0.05 * e; g.z = 0.08 * e;
      g.rz = 0.1 * e;
      // flanc droit, flanc gauche, retour au centre
      a.ry = k * (1.05 * rampe(t, 0.3, 0.85) - 2.1 * rampe(t, 0.95, 1.7) + 1.05 * rampe(t, 1.75, 2.1));
      a.rz = k * 0.25 * bosse(t, 0.3, 1.75) * Math.sin(Math.PI * rampe(t, 0.3, 1.75) * 2);
      // gunspin : un tour vers l'avant autour de la poignée, l'arme se soulève un instant
      a.rx = -tours(t, 2.1, 2.8, 1);
      a.y = 0.05 * bosse(t, 2.1, 2.8);
      break;
    }
    case "arme_longue": {
      g.x = -0.1 * e; g.y = 0.05 * e; g.z = 0.12 * e;
      // flanc droit, flanc gauche, retour au centre : l'arme pivote autour de la poignée
      a.ry = k * (0.95 * rampe(t, 0.35, 1.05) - 1.9 * rampe(t, 1.1, 1.95) + 0.95 * rampe(t, 2.0, 2.4));
      // coup d'œil sur la culasse : l'arme se couche sur le côté et se relève
      a.rz = k * 0.5 * bosse(t, 2.4, 3.2);
      a.rx = k * 0.3 * bosse(t, 2.4, 3.2);
      break;
    }
  }
  // angles ramenés dans [-π, π] (les tours complets ne changent pas l'orientation) : pose finale pile sur la pose neutre
  for (const o of [g, a]) { o.rx = enrouler(o.rx); o.ry = enrouler(o.ry); o.rz = enrouler(o.rz); }
  return pose;
}

/** L'inspection est-elle finie à l'instant `t` ? */
export const inspectionFinie = (arme: ArmeId, t: number): boolean => t >= dureeInspection(arme);

/** Ce qui coupe une inspection en cours (ou la refuse au départ). */
export interface ContexteInspection {
  /** viser (clic droit tenu) */
  vise: boolean;
  /** tir ou coup d'arme blanche à l'instant */
  tire: boolean;
  /** rechargement en cours ou demandé */
  recharge: boolean;
  /** course à plein régime */
  sprint: boolean;
  /** l'arme en main vient de changer */
  changement: boolean;
}

/** Vrai si l'inspection doit s'arrêter (ou ne pas commencer). */
export const inspectionAnnulee = (c: ContexteInspection): boolean => c.vise || c.tire || c.recharge || c.sprint || c.changement;
