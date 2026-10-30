/**
 * Animation du tigre BIPÈDE ARMÉ des bots du Battle Royale (PUR : maths de three seulement, ni WebGL ni DOM). Le moteur du corps du tigre 3D
 * (`lib/tigre3d/corps.ts` : pieds plantés au sol, IK, allure continue) est piloté comme pour les zombies (`zombies-anim.ts`), avec une couche
 * PERMANENTE « debout » : le corps cabré autour des hanches (comme `gestes/batte.ts`), la tête de niveau tournée vers la visée, les pattes avant
 * tenues sur l'arme (poignée et garde-main, cinématique inverse des bras), les pattes arrière laissées à la locomotion (pieds verrouillés au
 * sol, appui raccourci par ceinture). Le tigre ne galope jamais (`allureMax` 1 : les pattes arrière du galop sont quasi synchrones, saut de lapin).
 *
 * Repères. « Sol » = celui des gestes (museau +Z = l'avant du bot, haut +Y, gauche du tigre +X, mètres du MODÈLE) : le bot dressé fait face à +Z.
 * « Groupe » = celui du groupe three du bot (mètres du monde, avant = +x ; le rendu le tourne de `cap + π/2`) : `versRepereGroupe`. Le corps
 * avance sur +x du modèle, `c.x` à la vitesse imposée : le rendu pose le groupe sur la position du bot (hanches sur `p`, `origineXBot`).
 * Vitesse : le bot avance à `VITESSE_BOT_M_S` (bots-br.ts) ; l'animation recopie la vitesse mesurée projetée sur l'axe du corps (signée : à
 * reculons les pieds restent plantés), le cap du corps suit la direction de la marche à ±50° de la visée au plus (`capDuCorps`).
 * Spec : docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md (§1.5)
 */
import { Euler, Quaternion, Vector3 } from "three";
import { avancerCorps, creerCorps, type Corps, type Couche } from "../tigre3d/corps";
import { extremiteMonde, solVersCorps, type CorpsGeste } from "../tigre3d/gestes/outils";
import type { PoseGeste, Vec3 } from "../tigre3d/gestes/types";
import { GROUPES, type Groupe } from "../tigre3d/os";
import { borne, lerp } from "../tigre3d/ressorts";
import { reposDe, squelette } from "../tigre3d/squelette";
import { CAP_MAX_RAD, VITESSE_ANIMABLE_MAX_M_S } from "./bot-allure";
import { VITESSE_MODELE_MAX } from "./zombies-anim";

export { CAP_MAX_RAD, VITESSE_BOT_RENDU_M_S } from "./bot-allure";

/** Échelle du modèle : tête à 0,875 m du modèle debout → 2,0 m (la tête de la silhouette de touche, `tir.ts`) ; le thème Tigre (3,397) est trop grand. */
export const ECHELLE_BOT = 2.3;
/** La racine du modèle est en avant des hanches (m du modèle) : hanches sur la position du bot quand `origineX = x − DECALAGE_RACINE`. */
export const DECALAGE_RACINE = 0.274;
/** Vitesse de rotation du corps (rad/s) : au-delà il tourne sur ses pieds sans pas (le groupe pivote autour des hanches). */
export const ROTATION_CORPS_MAX = 7;
/** À l'arrêt, le corps ne suit la visée que lorsqu'elle s'écarte de plus de cet angle (rad) : le torse et la tête couvrent le reste. */
export const ZONE_MORTE_CAP = 0.35;
/** Cabré autour des hanches (rad) : la tête est à ≈ 0,875 m du modèle (2,0 m du monde). */
export const TANGAGE_DEBOUT = 1.35;
/** L'arme est dessinée ×1,5 (arme d'avatar : ≈ taille réelle) puis rapportée à l'échelle du modèle. */
export const ECHELLE_ARME_BOT = 1.5;
/** Part de l'écart cap/visée reprise par le torse (le reste par le cou et la tête). */
const PART_TORSE = 0.7;
/** Portée d'une main (part de la longueur du bras) : jamais tendue au-delà de `PORTEE_BRAS`, jamais plus près que `PORTEE_MIN` (le moteur repousse à 0,6). */
const PORTEE_BRAS = 0.96;
const PORTEE_MIN = 0.62;
/** La poignée est au moins à cette distance (m du modèle) devant les épaules, pour que l'arme ne soit pas enfouie dans le poitrail. */
const SORTIE_ARME = 0.26;

/** Arme tenue : points du repère de l'arme (canon vers −z, origine à la poignée, mètres de l'arme avant échelle ×1,5), cf. `ModeleArme` de `rendu.ts`. */
export interface ArmeBot {
  prise: Vec3;
  garde: Vec3 | null;
  deuxMains?: boolean;
}

export interface EntreeBot {
  /** vitesse horizontale mesurée du bot (m/s du monde) */
  vitesse: [number, number];
  /** visée (rad) : même convention que le protocole (0 = vers −z, avant = (−sin, −cos)), tangage > 0 = vers le haut */
  lacet: number;
  tangage: number;
  /** un tir vient de partir pendant cette image (recul de l'arme et des pattes) */
  tir: boolean;
  recharge: boolean;
  /** « sol » | « air » | « mur » | « mort » (protocole) */
  posture: string;
  /** (Battle Royale) chute libre ou sous parachute */
  chute?: "libre" | "voile";
  /** arme en main (absente : mains au repos) */
  arme?: ArmeBot | null;
  dtS: number;
}

export interface BotAnim {
  corps: Corps;
  /** couche « debout » : réécrite à chaque image par `avancerBot` */
  couche: Couche;
  /** cap du corps dans le monde (même convention que `lacet`) */
  cap: number;
  /** vitesse imposée à la dernière image (m/s du modèle, signée) */
  vitesseModele: number;
  /** recul de l'arme (1 au tir, décroît en 0,12 s) et poids lissé de la recharge / du parachute */
  kick: number;
  wRecharge: number;
  wChute: number;
  /** torsion du torse (rad, > 0 vers sa gauche) et direction de la visée dans le repère du corps de la dernière image (essais, rendu) */
  torse: number;
  dirArme: Vec3;
  /** prise de l'arme de la dernière image (origine de l'arme et base, repère sol du corps) : le rendu y pose le modèle */
  prise: PriseArme | null;
  /** gauche/droite relative de la visée par rapport au corps (rad, > 0 vers sa gauche) */
  ecartVisee: number;
  t: number;
  initialise: boolean;
}

const POIDS_DEBOUT: Record<Groupe, number> = {
  corps: 1, colonne: 0, cou: 1, tete: 1, machoire: 1, oreilles: 1, queue: 1, avG: 1, avD: 1, arG: 0, arD: 0,
};
const POIDS_CHUTE: Record<Groupe, number> = { ...POIDS_DEBOUT, arG: 1, arD: 1 };

/** Écart d'angle signé le plus court. */
function ecartAngle(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Cap du corps : celui de la marche (à reculons, le corps garde la visée et les pieds reculent), borné à ±`CAP_MAX_RAD` de la visée, rejoint à
 * `ROTATION_CORPS_MAX` au plus. À l'arrêt le corps ne bouge que si la visée s'en écarte de plus de `ZONE_MORTE_CAP`.
 */
export function capDuCorps(lacet: number, vitesse: readonly [number, number], capActuel: number, dtS: number): number {
  const v = Math.hypot(vitesse[0], vitesse[1]);
  let voulu: number;
  if (v > 0.3) {
    // direction de la marche dans la convention de la visée : avant = (−sin, −cos)
    let rel = ecartAngle(lacet, Math.atan2(-vitesse[0], -vitesse[1]));
    if (Math.abs(rel) > Math.PI / 2) rel -= Math.sign(rel) * Math.PI;
    voulu = lacet + borne(rel, -CAP_MAX_RAD, CAP_MAX_RAD);
  } else {
    const rel = ecartAngle(lacet, capActuel);
    voulu = lacet + borne(rel, -ZONE_MORTE_CAP, ZONE_MORTE_CAP);
  }
  const pas = ROTATION_CORPS_MAX * Math.max(dtS, 0);
  const cap = capActuel + borne(ecartAngle(capActuel, voulu), -pas, pas);
  // jamais au-delà de la limite, même si la visée a tourné d'un coup
  return lacet + borne(ecartAngle(lacet, cap), -CAP_MAX_RAD, CAP_MAX_RAD);
}

/** x du corps (repère sol du modèle) à ramener à l'origine du groupe pour que les hanches soient sur la position du bot. */
export function origineXBot(xAnim: number): number {
  return xAnim - DECALAGE_RACINE;
}

/**
 * Vitesse (m/s du MODÈLE, signée) à imposer au corps pour un bot qui se déplace à `vitesse` (m/s du monde) avec un corps au cap `cap` : la
 * composante sur l'axe du corps, plafonnée à ce que le corps sait animer (le reste glisserait). Le pas et la vitesse réelle étant égaux, les
 * pieds restent plantés.
 */
export function vitesseImposeeBot(vitesse: readonly [number, number], cap: number): number {
  const axe = -vitesse[0] * Math.sin(cap) - vitesse[1] * Math.cos(cap);
  const m = axe / ECHELLE_BOT;
  const plafond = Math.min(VITESSE_MODELE_MAX, VITESSE_ANIMABLE_MAX_M_S / ECHELLE_BOT);
  return borne(m, -plafond, plafond);
}

/** Point du repère du corps (sol, avant le geste) → repère du groupe du bot (mètres du monde, avant = +x, hanches à l'origine). */
export function versRepereGroupe(p: Vec3): Vec3 {
  return [(p[2] + DECALAGE_RACINE) * ECHELLE_BOT, p[1] * ECHELLE_BOT, -p[0] * ECHELLE_BOT];
}
/** Direction du repère du corps (sol) → repère du groupe. */
export function dirVersGroupe(d: Vec3): Vec3 {
  return [d[2], d[1], -d[0]];
}

const EULER = new Euler();
const Q = new Quaternion();
const V = new Vector3();

/** Transformation du geste (cabré, torsion) appliquée à un point au repos : l'inverse de `solVersCorps` (hanches pour pivot). */
export function corpsEnSol(co: CorpsGeste, p: Vec3): Vec3 {
  const sq = squelette();
  const pv = co.pivot === "epaules" ? [0, 0.21, 0.13] : co.pivot === "centre" || !co.pivot ? sq.pModele[sq.i.racine].toArray() : [0, 0.211, -0.274];
  Q.setFromEuler(EULER.set(-(co.tangage ?? 0), co.lacet ?? 0, co.roulis ?? 0, "YXZ"));
  V.set(p[0] - pv[0], p[1] - pv[1], p[2] - pv[2]).applyQuaternion(Q);
  return [V.x + pv[0], V.y + pv[1] + (co.dy ?? 0), V.z + pv[2] + (co.dz ?? 0)];
}

/** Direction de la visée dans le repère du corps (x gauche, y haut, z avant) pour un écart de cap `ecart` (> 0 vers sa gauche) et un tangage. */
export function directionVisee(ecart: number, tangage: number): Vec3 {
  const c = Math.cos(tangage);
  return [Math.sin(ecart) * c, Math.sin(tangage), Math.cos(ecart) * c];
}

/** Base de l'arme dans le repère du corps : rotation qui envoie −z (canon) sur `d`, haut de l'arme vers le haut du monde. */
export function baseArme(d: Vec3): { x: Vec3; y: Vec3; z: Vec3 } {
  const f = new Vector3(d[0], d[1], d[2]).normalize();
  let droite = new Vector3().crossVectors(f, new Vector3(0, 1, 0));
  if (droite.lengthSq() < 1e-6) droite = new Vector3(1, 0, 0);
  droite.normalize();
  const haut = new Vector3().crossVectors(droite, f).normalize();
  // repère de l'arme : +x droite du canon, +y haut, +z vers l'arrière (−canon)
  return { x: [droite.x, droite.y, droite.z], y: [haut.x, haut.y, haut.z], z: [-f.x, -f.y, -f.z] };
}

/** Point `p` du repère de l'arme (mètres de l'arme avant échelle) → repère du corps (sol), l'origine de l'arme étant en `origine`. */
function pointArme(origine: Vec3, base: ReturnType<typeof baseArme>, p: Vec3, echelle: number): Vec3 {
  return [
    origine[0] + (base.x[0] * p[0] + base.y[0] * p[1] + base.z[0] * p[2]) * echelle,
    origine[1] + (base.x[1] * p[0] + base.y[1] * p[1] + base.z[1] * p[2]) * echelle,
    origine[2] + (base.x[2] * p[0] + base.y[2] * p[1] + base.z[2] * p[2]) * echelle,
  ];
}

export interface PriseArme {
  /** origine de l'arme (poignée) dans le repère sol du corps */
  origine: Vec3;
  avG: Vec3;
  avD: Vec3;
  base: ReturnType<typeof baseArme>;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Où l'arme est tenue et où vont les mains (repère SOL du corps, mètres du modèle) : la main droite à la poignée, la gauche au garde-main (ou au
 * repos le long de la cuisse pour une arme à une main). L'arme est posée à l'épaule droite, canon sur la visée ; la poignée recule vers le corps
 * tant que l'une des deux mains serait hors de portée de son bras (la portée mesurée est celle du squelette).
 * `tangage` : cabré du corps ; `lacetTorse` : torsion du torse (les épaules tournent avec) ; `kick` ∈ [0, 1] : recul au tir.
 */
export function priseArme(arme: ArmeBot | null | undefined, dirVisee: Vec3, tangage: number, kick: number, lacetTorse = 0): PriseArme {
  const sq = squelette();
  const co: CorpsGeste = { tangage, lacet: lacetTorse, pivot: "hanches" };
  const rep = (r: "epauleD" | "epauleG"): Vec3 => { const p = reposDe(sq, r); return [p.x, p.y, p.z]; };
  const epD = corpsEnSol(co, rep("epauleD"));
  const epG = corpsEnSol(co, rep("epauleG"));
  const longueur = (cote: "D" | "G") => {
    const a = sq.pModele[sq.i[cote === "D" ? "epauleD" : "epauleG"]], b = sq.pModele[sq.i[cote === "D" ? "brasD" : "brasG"]], c = sq.pModele[sq.i[cote === "D" ? "mainD" : "mainG"]];
    return a.distanceTo(b) + b.distanceTo(c);
  };
  const LD = longueur("D"), LG = longueur("G");
  const base = baseArme(dirVisee);
  const s = ECHELLE_ARME_BOT / ECHELLE_BOT;
  // main libre au repos : le long de la cuisse, juste au-delà de la portée minimale du bras (le moteur écarte une cible plus proche de 0,6 L)
  const repos: Vec3 = [epG[0] + 0.01, epG[1] - 0.26, epG[2] + 0.03];
  if (!arme) {
    const bas: Vec3 = [epD[0] - 0.01, epD[1] - 0.26, epD[2] + 0.03];
    return { origine: bas, avD: bas, avG: repos, base };
  }
  // Les deux bras partent du même point de la poitrine (les os d'épaule sont sur l'axe du corps) : la poignée est cherchée devant, légèrement
  // à droite, d'abord à hauteur d'épaule puis de plus en plus bas, à bout de bras puis de plus en plus près, jusqu'à ce que les mains soient à
  // portée de leur bras (chacune entre `PORTEE_MIN` et `PORTEE_BRAS` de sa longueur : le moteur repousse une cible plus proche que 0,6 L, la
  // main ne serait plus sur l'arme). Trois passes : (0) les deux mains sur l'arme, la poignée à `SORTIE_ARME` au moins devant les épaules (sinon
  // l'arme est enfouie dans le poitrail, qui est épais : on n'en verrait que le bout du canon) ; (1) la main droite exacte à `SORTIE_ARME`,
  // la gauche au point de l'arme le plus proche à sa portée (elle soutient le canon un peu en arrière du garde-main) ; (2) n'importe où.
  let meilleur: PriseArme | null = null, pire = Infinity;
  const ecartPortee = (d: number, L: number) => (d > L * PORTEE_BRAS ? d - L * PORTEE_BRAS : d < L * PORTEE_MIN ? L * PORTEE_MIN - d : 0);
  /** Point de `p` ramené dans l'anneau de portée de l'épaule `ep` (longueur de bras L). */
  const dansLaPortee = (p: Vec3, ep: Vec3, L: number): Vec3 => {
    const d = dist(p, ep);
    const k = d < 1e-9 ? 1 : borne(d, L * PORTEE_MIN, L * PORTEE_BRAS) / d;
    return d < 1e-9 ? [ep[0], ep[1], ep[2] + L * PORTEE_MIN] : [ep[0] + (p[0] - ep[0]) * k, ep[1] + (p[1] - ep[1]) * k, ep[2] + (p[2] - ep[2]) * k];
  };
  recherche: for (const passe of [0, 1, 2]) {
    const amin = passe === 2 ? -0.1201 : SORTIE_ARME;
    for (const chute of [0.04, 0.1, 0.16, 0.22, 0.28]) {
      for (const lateral of [-0.06, -0.02, 0.02, 0.06, 0.1, -0.1]) {
        for (let a = 0.32; a >= amin - 1e-9; a -= 0.02) {
          const h0: Vec3 = [
            epD[0] + lateral + dirVisee[0] * a,
            epD[1] - chute + dirVisee[1] * a,
            epD[2] + dirVisee[2] * a,
          ];
          // origine de l'arme : la poignée (prise) est en h0
          const origine = pointArme(h0, base, [-arme.prise[0], -arme.prise[1], -arme.prise[2]], s);
          let gardeP: Vec3 = arme.garde ? pointArme(origine, base, arme.garde, s) : repos;
          if (passe === 1 && arme.garde) gardeP = dansLaPortee(gardeP, epG, LG);
          const hors = Math.max(ecartPortee(dist(h0, epD), LD), arme.garde && passe !== 1 ? ecartPortee(dist(gardeP, epG), LG) : 0);
          if (hors < pire) { pire = hors; meilleur = { origine, avD: h0, avG: gardeP, base }; }
          if (hors <= 0) break recherche;
        }
      }
    }
  }
  // recul au tir : l'arme et les deux mains reculent ensemble de 2 cm du modèle sur le canon
  const r = 0.02 * kick;
  const recule = (v: Vec3): Vec3 => [v[0] - dirVisee[0] * r, v[1] - dirVisee[1] * r, v[2] - dirVisee[2] * r];
  return { origine: recule(meilleur!.origine), avD: recule(meilleur!.avD), avG: arme.garde ? recule(meilleur!.avG) : meilleur!.avG, base };
}

/**
 * Cibles des deux pattes avant (repère sol du corps, mètres du modèle) pour l'arme `arme` visée dans la direction `dirVisee` (repère du corps :
 * x gauche, y haut, z avant), le corps cabré de `tangage`, recul `kick` ∈ [0, 1] (cf. `priseArme`, qui donne aussi la place de l'arme).
 */
export function ciblesMains(arme: ArmeBot | null | undefined, dirVisee: Vec3, tangage: number, kick: number, lacetTorse = 0): { avG: Vec3; avD: Vec3 } {
  const p = priseArme(arme, dirVisee, tangage, kick, lacetTorse);
  return { avG: p.avG, avD: p.avD };
}

export interface CandidatEmplacement {
  id: string;
  /** distance à la caméra (m) */
  distance: number;
  /** le bot occupe déjà un emplacement de tigre complet */
  actuel: boolean;
}

/** Au-delà, un bot reste en fil de fer quel que soit le nombre d'emplacements libres (silhouette trop petite pour justifier 25 000 triangles). */
export const DISTANCE_TIGRE_MAX_M = 110;
/** Un bot qui a déjà un emplacement garde sa place tant qu'un autre n'est pas 20 % plus proche (pas de bascule d'un bot à l'autre à chaque image). */
const HYSTERESIS_EMPLACEMENT = 0.8;

/**
 * Quels bots reçoivent un des `n` emplacements de tigre complet (clone du GLB) : les plus proches, à moins de `DISTANCE_TIGRE_MAX_M`, avec
 * hystérésis pour les bots qui en ont déjà un. Les autres gardent l'avatar fil de fer.
 */
export function attribuerEmplacements(candidats: readonly CandidatEmplacement[], n: number): Set<string> {
  const eligibles = candidats.filter((c) => c.distance <= DISTANCE_TIGRE_MAX_M);
  const cle = (c: CandidatEmplacement) => c.distance * (c.actuel ? HYSTERESIS_EMPLACEMENT : 1);
  eligibles.sort((a, b) => cle(a) - cle(b) || (a.id < b.id ? -1 : 1));
  return new Set(eligibles.slice(0, Math.max(0, n)).map((c) => c.id));
}

/** Corps et couche d'un bot (la graine règle les petites variations du bruit lent du moteur). */
export function creerCorpsBot(graine: number): BotAnim {
  const corps = creerCorps({ cap: Math.PI / 2, graine });
  return {
    corps, couche: { pose: {}, poids: { ...POIDS_DEBOUT } }, cap: 0, vitesseModele: 0, kick: 0, wRecharge: 0, wChute: 0, torse: 0,
    dirArme: [0, 0, 1], prise: null, ecartVisee: 0, t: 0, initialise: false,
  };
}

/**
 * Pose « debout armé » : corps cabré autour des hanches (le torse suit la visée pour `PART_TORSE` de l'écart, le cou et la tête le reste),
 * tête de niveau, pattes avant sur l'arme. Parachute et chute libre : bras levés, jambes pendantes.
 */
export function poseDebout(b: BotAnim, e: EntreeBot, ecart: number): PoseGeste {
  const wC = b.wChute, wR = b.wRecharge;
  const tangageCorps = lerp(TANGAGE_DEBOUT, 1.5, wC) + 0.035 * b.kick;
  const torse = borne(ecart, -CAP_MAX_RAD, CAP_MAX_RAD) * PART_TORSE * (1 - wC);
  b.torse = torse;
  const dy = 0.006 * Math.sin(b.t * 2.4) * (1 - wC) - 0.004 * b.kick;
  const co: CorpsGeste = { tangage: tangageCorps, lacet: torse, dy, dz: -0.01 * b.kick, pivot: "hanches" };
  // visée relative au torse tourné ; la recharge baisse le canon
  const reste = borne(ecart, -1.6, 1.6) - torse;
  const phi = borne(e.tangage, -1.2, 1.2);
  const phiArme = lerp(phi, phi - 0.5, wR) + 0.05 * b.kick;
  const dirSol = directionVisee(ecart, phiArme);
  b.dirArme = dirSol;
  const prise = priseArme(e.arme ?? null, dirSol, tangageCorps, b.kick, torse);
  b.prise = prise;
  const pattes: NonNullable<PoseGeste["pattes"]> = {};
  const poignet: Vec3 = extremiteMonde(co, [-1.3, 0, 0]);
  if (wC < 0.5) {
    pattes.avD = { cible: solVersCorps(co, prise.avD), extremite: poignet };
    pattes.avG = { cible: solVersCorps(co, prise.avG), extremite: poignet };
  } else {
    // parachute : les deux pattes tiennent les suspentes, au-dessus de la tête
    const sq = squelette();
    for (const c of ["D", "G"] as const) {
      const ep = reposDe(sq, c === "D" ? "epauleD" : "epauleG");
      const e = corpsEnSol(co, [ep.x, ep.y, ep.z]);
      const h: Vec3 = [e[0] * 1.5, e[1] + 0.28, e[2] + 0.03];
      pattes[c === "D" ? "avD" : "avG"] = { cible: solVersCorps(co, h), extremite: extremiteMonde(co, [-0.6, 0, 0]) };
    }
  }
  if (wC > 0.001) {
    // jambes pendantes sous les hanches, légèrement repliées
    const sq = squelette();
    for (const c of ["D", "G"] as const) {
      const hr = reposDe(sq, c === "D" ? "hancheD" : "hancheG");
      const h = corpsEnSol(co, [hr.x, hr.y, hr.z]);
      const cheville: Vec3 = [h[0] * 1.6, h[1] - 0.3, h[2] + 0.05];
      pattes[c === "D" ? "arD" : "arG"] = { cible: solVersCorps(co, cheville), extremite: extremiteMonde(co, [-0.8, 0, 0]) };
    }
  }
  // tête de niveau : le cabré est repris par le cou et la tête ; la visée relève ou baisse le museau
  const T = tangageCorps;
  // le museau du modèle au repos est incliné de ≈ 32° vers le bas : 0,45 rad relèvent la tête pour qu'elle regarde presque de niveau
  const pitch = phi;
  const deltas: NonNullable<PoseGeste["deltas"]> = {
    cou: [0.62 * T - 0.25 - 0.5 * pitch, 0, reste * 0.4],
    tete: [0.38 * T - 0.2 - 0.5 * pitch, 0, reste * 0.6],
    machoire: [0.38 * T - 0.2 - 0.5 * pitch + 0.03 * b.kick, 0, reste * 0.6],
    oreilleG: [0.38 * T - 0.5, 0, 0.15 + reste * 0.6],
    oreilleD: [0.38 * T - 0.5, 0, -0.15 + reste * 0.6],
    queue1: [0.55, 0, 0], queue2: [0.5, 0, 0], queue3: [0.4, 0, 0],
  };
  return { corps: co, pattes, deltas, regard: 0, poids: { ...(wC > 0.5 ? POIDS_CHUTE : POIDS_DEBOUT) } };
}

/**
 * Avance le bot de `dtS` : cap du corps, vitesse imposée au moteur, couche « debout » réécrite. Les consignes du moteur : allure bridée au trot,
 * vitesse signée projetée sur l'axe du corps (pieds plantés, y compris à reculons).
 */
export function avancerBot(b: BotAnim, e: EntreeBot): void {
  const dt = Math.max(e.dtS, 0);
  if (!(dt > 0)) return;
  b.t += dt;
  if (!b.initialise) { b.cap = e.lacet; b.initialise = true; }
  // seule la chute (libre ou sous voile) pend les bras et les jambes ; un saut garde la pose debout (les pieds restent à la hauteur du bot)
  const enAir = e.chute != null;
  b.cap = capDuCorps(e.lacet, e.vitesse, b.cap, dt);
  const ecart = ecartAngle(b.cap, e.lacet);
  b.ecartVisee = ecart;
  b.kick = e.tir ? 1 : Math.max(0, b.kick - dt / 0.12);
  b.wRecharge += ((e.recharge && !enAir ? 1 : 0) - b.wRecharge) * (1 - Math.exp(-dt * 12));
  b.wChute += ((enAir ? 1 : 0) - b.wChute) * (1 - Math.exp(-dt * 8));
  const vImp = enAir ? 0 : vitesseImposeeBot(e.vitesse, b.cap);
  b.vitesseModele = vImp;
  b.couche.pose = poseDebout(b, e, ecart);
  const w = b.wChute > 0.5 ? POIDS_CHUTE : POIDS_DEBOUT;
  for (const g of GROUPES) b.couche.poids[g] = w[g];
  avancerCorps(b.corps, dt, {
    vitesse: Math.abs(vImp), sens: vImp < 0 ? -1 : 1, cap: Math.PI / 2, regard: 0, vitesseImposee: vImp, allureMax: 1, couches: [b.couche],
  });
}
