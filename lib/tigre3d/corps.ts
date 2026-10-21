/**
 * Moteur du corps du tigre (pur : maths de three, ni WebGL ni DOM). À chaque image il construit
 * la pose de tous les os à partir :
 *  - de la LOCOMOTION : allure continue (lib/tigre3d/allures.ts), phase par patte, pieds
 *    VERROUILLÉS au sol pendant l'appui (le corps avance, le pied ne bouge pas : l'IK referme la
 *    patte), arc de vol vers le point de pose prédit, talon qui décolle en fin d'appui, piétinement
 *    pour tourner sur place (jamais de rotation « tourelle ») ;
 *  - de l'ORIENTATION en cascade : la tête tourne d'abord, les épaules suivent, le bassin en
 *    dernier, chacun sur son ressort (le dos se plie entre les deux) ;
 *  - des COUCHES de geste (lib/tigre3d/gestes/) posées par groupe d'os avec leur poids ;
 *  - des SECONDAIRES : queue et oreilles en chaînes à ressort, bruit lent (tête, queue, cadence),
 *    respiration.
 *
 * Repère « sol » : celui du modèle (mètres du modèle, y = 0 au sol), le tigre se déplace sur x
 * (sens 1 = +x), z reste 0 ; cap ψ = 0 face à la caméra (+Z), ψ = π/2 vers +x.
 */
import { Quaternion, Vector3, Euler } from "three";
import {
  squelette, nouvellePose, creerMonde, fkOs, placerRacine, deltaModele, ajouterDelta, orienterModele, viserOs,
  type Monde, type PoseTigre, type Squelette,
} from "./squelette";
import { DEF_PATTES, GROUPE_DE, OS_QUEUE, OS_TETE, PATTES, GROUPES, type DefPatte, type Groupe, type Patte, type Role } from "./os";
import { ik2 } from "./ik";
import { amortir, borne, bruit, bruitDouble, lerp, lisse, rampe, ressort, type Ressort } from "./ressorts";
import { allurePourVitesse, appuiAVitesse, cadence, reglage, CADENCE_SUR_PLACE, type ReglageAllure } from "./allures";
import { creerChaine, avancerChaine, type Chaine } from "./secondaires";
import type { PoseGeste } from "./gestes/types";

const TAU = Math.PI * 2;
/**
 * Balayage maximal d'un pied pendant son appui (m du modèle), par ceinture : ce que la patte peut
 * couvrir sous l'épaule / la hanche sans se tendre complètement. La patte arrière (0,19 m, hanche
 * à 0,21 m) n'a que ±8 cm de marge : au-delà, on raccourcit son appui (la foulée garde sa
 * cadence, le pied reste moins longtemps au sol) au lieu d'abaisser l'arrière-train.
 */
const BALAYAGE_MAX = { av: 0.19, ar: 0.15 } as const;
/** Hauteur de pas minimale (m) d'un vrai pas : un pied ne rase jamais le sol, même en freinant. */
const LEVEE_MIN = { av: 0.018, ar: 0.022 } as const;
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);

/** Une couche de geste posée sur le corps, avec ses poids par groupe (déjà lissés par l'animateur). */
export interface Couche {
  pose: PoseGeste;
  poids: Record<Groupe, number>;
}

/** Consignes de l'animateur pour une image. */
export interface Consignes {
  /** Vitesse voulue (m/s du modèle, ≥ 0) et sens de déplacement sur x. */
  vitesse: number;
  sens: 1 | -1;
  /** Cap voulu du corps (rad). */
  cap: number;
  /** Regard vers la caméra (0..1) hors geste : la tête devance le corps. */
  regard: number;
  /** Raideur de l'accélération / du freinage (1/s). */
  reactivite?: number;
  /** Vitesse imposée (m/s, signée) : les petits calquent exactement la mère (distance fixe). */
  vitesseImposee?: number;
  /** Avance de geste pendant cette image (m, vers l'avant des épaules) : root motion d'un clip. */
  avance?: number;
  couches: Couche[];
}

interface GeoPatte {
  nom: Patte;
  def: DefPatte;
  kHaut: number; kBas: number; kExt: number; kBout: number;
  l1: number; l2: number;
  /** Du point de contact (bout) vers l'extrémité (poignet / cheville), au repos. */
  talon: Vector3;
  /** Pli au repos (perpendiculaire à racine → extrémité, vers l'articulation du milieu). */
  pole: Vector3;
  /** Os dont la rotation porte le pli (épaule : racine ; cuisse : hanche). */
  kPorteur: number;
  /** Arrière : sens du pli par rapport à latéral × (hanche → cheville), au repos. */
  signePli: number;
  /** Point de contact au repos, relatif au pivot de sa ceinture (racine / bassin), et sa hauteur. */
  maison: Vector3;
  yContact: number;
}

export interface EtatPatte {
  appui: boolean;
  /** Point de contact verrouillé (sol) et lacet du pied posé. */
  verrou: Vector3;
  lacetVerrou: number;
  depart: Vector3;
  lacetDepart: number;
  u: number;
  saute: boolean;
  s: number;
  /** Point de contact courant (sortie) et lacet du pied. */
  contact: Vector3;
  lacet: number;
  talon: number;
  /** Poids du geste sur cette patte (0 = locomotion seule). */
  libre: number;
  /**
   * Relâchée par un geste et revenue au sol : son appui est figé au monde (elle ne suit plus la
   * cible du geste, qui continue de bouger pendant que son poids retombe) ; plus de glissade.
   */
  plantee: boolean;
  /** Écart (m) entre l'extrémité atteinte et sa cible (IK hors de portée). */
  manque: number;
}

export interface Corps {
  sq: Squelette;
  pose: PoseTigre;
  monde: Monde;
  /** Position du centre du corps sur le sol (x) et vitesse courante (m/s, signée). */
  x: number;
  v: number;
  /** Déplacement en x de la dernière image (m du modèle). */
  dx: number;
  /** Caps en cascade : tête, épaules, bassin. */
  psiT: Ressort; psiE: Ressort; psiB: Ressort;
  regard: Ressort;
  allure: Ressort;
  phase: number;
  freq: number;
  actif: boolean;
  /** Plus grand écart (m) entre un pied d'appui et sa place, à l'image précédente. */
  ecart: number;
  pattes: Record<Patte, EtatPatte>;
  geo: Record<Patte, GeoPatte>;
  t: number;
  graine: number;
  queue: Chaine;
  oreilleG: Chaine;
  oreilleD: Chaine;
  tete: { tangage: Ressort; lacet: Ressort; roulis: Ressort };
  abaissement: { av: Ressort; ar: Ressort };
  reglage: ReglageAllure;
}

const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3(), v4 = new Vector3(), v5 = new Vector3();
const qa = new Quaternion(), qb = new Quaternion(), qc = new Quaternion(), qR = new Quaternion();
const eul = new Euler();
const pRacine = new Vector3(), qRacine = new Quaternion();

function geoPatte(sq: Squelette, nom: Patte): GeoPatte {
  const def = DEF_PATTES[nom];
  const kHaut = sq.i[def.haut], kBas = sq.i[def.bas], kExt = sq.i[def.extremite], kBout = sq.i[def.bout];
  const A = sq.pModele[kHaut], B = sq.pModele[kBas], C = sq.pModele[kExt], D = sq.pModele[kBout];
  const u = C.clone().sub(A).normalize();
  const pole = B.clone().sub(A);
  pole.addScaledVector(u, -pole.dot(u)).normalize();
  // Pivot de ceinture : racine pour l'avant, tête de la hanche (bassin) pour l'arrière.
  const pivot = def.avant ? sq.pModele[sq.i.racine] : sq.pModele[sq.i[nom === "arG" ? "hancheG" : "hancheD"]];
  const signePli = Math.sign(new Vector3(1, 0, 0).cross(u).dot(pole)) || 1;
  return {
    nom, def, kHaut, kBas, kExt, kBout, signePli,
    l1: A.distanceTo(B), l2: B.distanceTo(C),
    talon: C.clone().sub(D), pole,
    kPorteur: def.avant ? sq.i.racine : sq.i[nom === "arG" ? "hancheG" : "hancheD"],
    maison: new Vector3(D.x, 0, D.z - pivot.z),
    yContact: D.y,
  };
}

export function creerCorps(opts: { x?: number; cap?: number; graine?: number } = {}): Corps {
  const sq = squelette();
  const cap = opts.cap ?? Math.PI / 2;
  const geo = {} as Record<Patte, GeoPatte>;
  const pattes = {} as Record<Patte, EtatPatte>;
  for (const p of PATTES) {
    geo[p] = geoPatte(sq, p);
    pattes[p] = {
      appui: true, verrou: new Vector3(), lacetVerrou: cap, depart: new Vector3(), lacetDepart: cap, u: 0, saute: false, s: 0,
      contact: new Vector3(), lacet: cap, talon: 0, libre: 0, plantee: false, manque: 0,
    };
  }
  const c: Corps = {
    sq, pose: nouvellePose(sq), monde: creerMonde(sq),
    x: opts.x ?? 0, v: 0, dx: 0,
    psiT: ressort(cap), psiE: ressort(cap), psiB: ressort(cap), regard: ressort(0), allure: ressort(0),
    phase: 0, freq: CADENCE_SUR_PLACE, actif: false, ecart: 0, pattes, geo, t: 0, graine: opts.graine ?? 1,
    queue: creerChaine(sq, OS_QUEUE, "bout_queue", [70, 22], 0.8),
    oreilleG: creerChaine(sq, ["oreilleG", "oreille_boutG"], "oreille_pointeG", [900, 500], 0.6),
    oreilleD: creerChaine(sq, ["oreilleD", "oreille_boutD"], "oreille_pointeD", [900, 500], 0.6),
    tete: { tangage: ressort(0), lacet: ressort(0), roulis: ressort(0) },
    abaissement: { av: ressort(0), ar: ressort(0) },
    reglage: reglage(0),
  };
  // Pieds posés à leur place de repos.
  for (const p of PATTES) {
    maisonSol(c, p, c.pattes[p].verrou, 0);
    c.pattes[p].contact.copy(c.pattes[p].verrou);
  }
  return c;
}

/** Point de contact « de repos » d'une patte sur le sol, pour la pose courante des ceintures. */
function maisonSol(c: Corps, p: Patte, sortie: Vector3, avanceM: number): Vector3 {
  const g = c.geo[p];
  const avant = g.def.avant;
  const psi = avant ? c.psiE.x : c.psiB.x;
  // Pivot : racine (centre) pour l'avant, bassin pour l'arrière (pris au repos relatif à la racine).
  let px = c.x, pz = 0;
  if (!avant) {
    // Le bassin est derrière la racine, dans l'axe du bassin.
    const k = c.sq.i[p === "arG" ? "hancheG" : "hancheD"];
    const dz = c.sq.pModele[k].z - c.sq.pModele[c.sq.i.racine].z;
    // Position approchée du bassin : racine + rotation des épaules sur la moitié avant, du bassin sur l'arrière.
    const zT = c.sq.pModele[c.sq.i.lombaires].z - c.sq.pModele[c.sq.i.racine].z;
    px += Math.sin(c.psiE.x) * zT + Math.sin(c.psiB.x) * (dz - zT);
    pz += Math.cos(c.psiE.x) * zT + Math.cos(c.psiB.x) * (dz - zT);
  }
  const mx = g.maison.x, mz = g.maison.z;
  // Rotation de cap ψ : (x, z) → (x cosψ + z sinψ, -x sinψ + z cosψ), repère modèle face caméra pour ψ = 0.
  const cps = Math.cos(psi), sps = Math.sin(psi);
  sortie.set(px + mx * cps + mz * sps + avanceM, g.yContact, pz - mx * sps + mz * cps);
  return sortie;
}

/** Écart d'angle signé le plus court. */
function ecartAngle(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
const fract = (x: number) => x - Math.floor(x);
const qEuler = (x: number, y: number, z: number, q: Quaternion) => q.setFromEuler(eul.set(x, y, z, "XYZ"));

/** Poids d'un groupe dans les couches (max), et somme pondérée d'un champ numérique du corps. */
function poidsGroupe(couches: Couche[], g: Groupe) {
  let w = 0;
  for (const c of couches) w = Math.max(w, c.poids[g] ?? 0);
  return w;
}

/**
 * Avance le corps de dt et construit sa pose. Retourne le corps (pose et monde à jour).
 */
export function avancerCorps(c: Corps, dt: number, k: Consignes): Corps {
  const sq = c.sq;
  c.t += dt;
  const t = c.t;
  for (let j = 1; j < sq.n; j++) c.pose.t[j].copy(sq.tRepos[j]);

  // 1. Caps en cascade : tête → épaules → bassin. Le dos borne l'écart (pas de vrille).
  // Le corps attend ses pieds : si un pied d'appui est resté loin de sa place (il tourne plus vite
  // qu'il ne piétine), épaules et bassin ralentissent ; la tête, elle, devance toujours.
  const attente = borne(1 - (c.ecart - 0.07) / 0.1, 0.3, 1);
  amortir(c.psiT, c.psiT.x + ecartAngle(c.psiT.x, k.cap), 9, dt);
  amortir(c.psiE, c.psiT.x, 8 * attente, dt);
  amortir(c.psiB, c.psiE.x, 6.5 * attente, dt);
  const ecartEB = c.psiB.x - c.psiE.x;
  if (Math.abs(ecartEB) > 0.75) c.psiB.x = c.psiE.x + Math.sign(ecartEB) * 0.75;
  const ecartTE = c.psiT.x - c.psiE.x;
  if (Math.abs(ecartTE) > 1.1) c.psiT.x = c.psiE.x + Math.sign(ecartTE) * 1.1;

  // 2. Vitesse : on n'accélère que dans l'axe (le corps doit d'abord être tourné), on freine plus
  // vite qu'on n'accélère ; un changement de sens passe par l'arrêt.
  const dir = k.sens;
  const alignement = Math.max(0, Math.cos(ecartAngle(c.psiB.x, dir * Math.PI / 2)));
  const vCible = dir * k.vitesse * Math.pow(alignement, 6);
  const accelere = Math.abs(vCible) > Math.abs(c.v) && Math.sign(vCible) === Math.sign(c.v || vCible);
  const reac = k.reactivite ?? (accelere ? 2.6 : 5.5);
  c.v += (vCible - c.v) * (1 - Math.exp(-reac * dt));
  if (k.vitesseImposee != null) c.v = k.vitesseImposee;
  // Avance d'un geste (root motion d'un clip) : dans l'axe des épaules, projetée sur x.
  c.dx = c.v * dt + (k.avance ?? 0) * Math.sin(c.psiE.x);
  c.x += c.dx;
  const vitesse = Math.abs(c.v);

  // 3. Allure et cadence.
  amortir(c.allure, allurePourVitesse(vitesse), 5, dt);
  const R = reglage(c.allure.x, c.reglage);
  const enMouvement = vitesse > 0.03;
  const kv = borne(vitesse / 0.35, 0, 1);
  const appui = enMouvement ? appuiAVitesse(R.appui, vitesse) : 0.62;
  for (const p of PATTES) {
    const e = c.pattes[p], w = poidsGroupe(k.couches, p);
    // Un geste qui rend la patte (poids qui retombe) alors qu'elle touche le sol : elle s'y plante.
    if (w > e.libre + 1e-5 || w <= 0.01 || enMouvement) e.plantee = false;
    else if (w < e.libre - 1e-5 && !e.plantee) {
      const b = c.monde.p[c.geo[p].kBout];
      if (b.y < c.geo[p].yContact + 0.012) {
        e.plantee = true;
        e.verrou.set(b.x, c.geo[p].yContact, b.z);
      }
    }
    e.libre = w;
  }

  // Piétinement : sur place, on ne fait des pas que si un pied est loin de sa place.
  let ecartMax = 0;
  for (const p of PATTES) {
    const e = c.pattes[p];
    if (e.libre > 0.01) continue;
    maisonSol(c, p, v1, 0);
    const err = Math.hypot(e.verrou.x - v1.x, e.verrou.z - v1.z) + 0.08 * Math.abs(ecartAngle(e.lacetVerrou, c.geo[p].def.avant ? c.psiE.x : c.psiB.x));
    ecartMax = Math.max(ecartMax, err);
  }
  const enVol = PATTES.some((p) => !c.pattes[p].appui);
  if (enMouvement || enVol || ecartMax > 0.045) c.actif = true;
  else if (c.actif && !enVol && ecartMax < 0.03) c.actif = false;
  c.ecart = ecartMax;
  // Sur place, il piétine d'autant plus vite que ses pieds sont loin de leur place.
  c.freq = enMouvement ? cadence(vitesse) * (1 + 0.035 * bruit(t * 0.23, c.graine))
    : Math.min(3.8, CADENCE_SUR_PLACE + 14 * Math.max(0, ecartMax - 0.035));
  if (c.actif) c.phase += c.freq * dt;

  // 4. Pattes : appui / vol. Appui propre à chaque ceinture : son balayage reste à portée.
  const appuiDe = {} as Record<Patte, number>;
  for (const p of PATTES) {
    const bal = c.geo[p].def.avant ? BALAYAGE_MAX.av : BALAYAGE_MAX.ar;
    appuiDe[p] = enMouvement ? Math.min(appui, Math.max(0.5 * appui, (bal * c.freq) / vitesse)) : appui;
  }
  for (const p of PATTES) {
    const e = c.pattes[p], g = c.geo[p];
    const appui = appuiDe[p];
    const tAppui = appui / c.freq, tVol = (1 - appui) / c.freq;
    const decal = enMouvement ? R.decalages[p] : ({ arG: 0, avG: 0.25, arD: 0.5, avD: 0.75 } as const)[p];
    const u = fract(c.phase - decal);
    const lacetCeinture = g.def.avant ? c.psiE.x : c.psiB.x;
    // En mouvement (saut en pleine course), la locomotion continue sous le geste : la cible de la
    // patte est un mélange des deux (cf. poserPatte) et, quand le poids retombe, la patte retrouve
    // sa foulée au lieu de se poser là où le geste l'a laissée (elle serait traînée par le corps).
    if (e.libre > 0.01 && !enMouvement) {
      // Patte tenue par un geste : son point d'appui suit le bout de la patte (image précédente),
      // projeté au sol, dans l'axe de sa ceinture. Quand le geste la relâche, elle se pose là où
      // il l'a laissée (et non à l'ancien appui, que le corps a pu laisser loin derrière) ; une
      // fois au sol elle y reste plantée (cf. `plantee`).
      const b = c.monde.p[g.kBout];
      if (!e.plantee) e.verrou.set(b.x, g.yContact, b.z);
      e.contact.copy(e.verrou);
      // Hauteur : celle du bout de la patte, pondérée par le poids du geste (une patte levée pendant
      // la montée du poids n'est pas tirée vers le sol ; relâchée en l'air, elle redescend avec lui).
      if (!e.plantee) e.contact.y = lerp(g.yContact, Math.max(g.yContact, b.y), e.libre);
      e.lacetVerrou = e.lacet = lacetCeinture;
      e.appui = true; e.saute = false; e.u = u; e.s = 0;
      continue;
    }
    if (e.appui) {
      const versVol = u >= appui && (e.u < appui || e.u > u);
      if (versVol && !e.saute) {
        maisonSol(c, p, v1, 0);
        const err = Math.hypot(e.verrou.x - v1.x, e.verrou.z - v1.z) + 0.08 * Math.abs(ecartAngle(e.lacetVerrou, lacetCeinture));
        // Assis (hanche basse, sur place) : les pieds arrière restent posés sous lui, il ne piétine pas.
        const assis = !g.def.avant && !enMouvement && c.monde.p[g.kHaut].y < 0.14;
        if (!enMouvement && (err < 0.025 || assis)) e.saute = true;
        else {
          e.appui = false; e.depart.copy(e.verrou); e.lacetDepart = e.lacetVerrou; e.s = 0;
        }
      }
      if (e.saute && u < appui && e.u >= appui) e.saute = false;
    } else if (u < e.u - 0.5 || u < appui) {
      // Fin du vol (la phase a bouclé) : pied posé là où il est arrivé.
      e.appui = true; e.saute = false;
      e.verrou.set(e.contact.x, g.yContact, e.contact.z);
      e.lacetVerrou = e.lacet;
    }
    e.u = u;
    if (e.appui) {
      e.contact.copy(e.verrou);
      e.lacet = e.lacetVerrou;
      const sigma = u < appui ? u / appui : 1;
      // Talon qui décolle en fin d'appui : fonction continue de la phase (pas de retard lissé),
      // égale au départ du vol à la valeur de vol (s = 0) : le pied ne claque pas au décollage.
      // Au galop l'appui est bref : le talon commence à décoller plus tôt (rotation moins brusque).
      const debutTalon = lerp(0.45, 0.1, borne(c.allure.x - 0.5, 0, 1.5) / 1.5);
      e.talon = (g.def.avant ? 0.55 : 0.75) * rampe(sigma, debutTalon, 1) * kv;
    } else {
      e.s = borne((u - appui) / (1 - appui), 0, 1);
      const resteVol = (1 - e.s) * tVol;
      // Point de pose : sa place, plus ce que le corps aura parcouru d'ici le milieu de l'appui suivant.
      maisonSol(c, p, v1, c.v * (resteVol + tAppui / 2));
      // Profil lissé (vitesse nulle au départ et à la pose, pic 1,5 × la moyenne).
      const hs = lisse(e.s);
      const dist = Math.hypot(v1.x - e.depart.x, v1.z - e.depart.z);
      const levee = (g.def.avant ? R.levee.av : R.levee.ar) * borne(0.35 + dist / 0.12, 0.35, 1) * (enMouvement ? 1 : 0.7);
      // Un vrai pas (> 1,5 cm) lève toujours le pied d'au moins LEVEE_MIN : il ne racle pas le sol.
      const h = Math.max(levee, (g.def.avant ? LEVEE_MIN.av : LEVEE_MIN.ar) * borne(dist / 0.015, 0, 1));
      e.contact.set(
        lerp(e.depart.x, v1.x, hs),
        g.yContact + h * Math.sin(Math.PI * Math.pow(e.s, 0.8)),
        lerp(e.depart.z, v1.z, hs),
      );
      e.lacet = e.lacetDepart + ecartAngle(e.lacetDepart, lacetCeinture) * hs;
      // Le pied se replie en début de vol, se tend avant de se poser.
      // (cloche à dérivée nulle aux deux bouts : pas de cassure de vitesse quand le pied se tend)
      const replie = (g.def.avant ? 1.1 : 0.6) * 0.5 * (1 - Math.cos(TAU * borne(e.s / 0.75, 0, 1))) * borne(dist / 0.1, 0.3, 1);
      e.talon = (g.def.avant ? 0.55 : 0.75) * kv * (1 - rampe(e.s, 0, 0.35)) + replie;
    }
  }

  // 5. Corps : rebond par ceinture, tangage, roulis, dos.
  let hAv = 0, hAr = 0;
  for (const p of PATTES) {
    const e = c.pattes[p], ap = appuiDe[p];
    const sigma = e.u < ap ? e.u / ap : -1;
    const charge = e.appui && sigma >= 0 ? Math.sin(Math.PI * sigma) : 0;
    const moyenneP = (2 / Math.PI) * ap;
    if (c.geo[p].def.avant) hAv += charge - moyenneP; else hAr += charge - moyenneP;
  }
  hAv *= R.rebond * kv; hAr *= R.rebond * kv;
  const respiration = Math.sin(t * TAU * 0.32 + bruit(t * 0.1, c.graine + 3) * 2) * (1 - kv);
  let dy = (hAv + hAr) / 2 - R.ramasse * kv;
  let tangage = Math.atan2(hAv - hAr, 0.4);
  let roulis = 0;
  const flexion = R.flexion * kv * Math.cos(TAU * (c.phase - 0.97));
  // Marche : léger roulis et ondulation latérale du dos, en phase avec les pattes arrière.
  const ondulation = (1 - borne(c.allure.x, 0, 1)) * kv * Math.sin(TAU * (c.phase - 0.1));
  roulis += 0.025 * ondulation;

  // Couches : corps.
  pRacine.set(c.x, sq.pModele[sq.i.racine].y, 0);
  qRacine.setFromAxisAngle(Y, c.psiE.x).multiply(qa.setFromAxisAngle(X, -tangage)).multiply(qb.setFromAxisAngle(Z, roulis));
  pRacine.y += dy;
  for (const cc of k.couches) {
    const co = cc.pose.corps, w = cc.poids.corps ?? 0;
    if (!co || w <= 0) continue;
    const pivot = co.pivot === "hanches" ? v2.set(0, 0.211, -0.274) : co.pivot === "epaules" ? v2.set(0, 0.21, 0.13) : v2.copy(sq.pModele[sq.i.racine]);
    // Pivot en repère du corps courant.
    v3.copy(pivot).sub(sq.pModele[sq.i.racine]).applyQuaternion(qRacine).add(pRacine);
    qc.setFromEuler(eul.set(-(co.tangage ?? 0) * w, (co.lacet ?? 0) * w, (co.roulis ?? 0) * w, "YXZ"));
    // Rotation exprimée dans le repère du corps : R_monde = Q · R · Q⁻¹.
    qa.copy(qRacine).multiply(qc).multiply(qb.copy(qRacine).invert());
    pRacine.sub(v3).applyQuaternion(qa).add(v3);
    qRacine.premultiply(qa);
    v4.set(0, (co.dy ?? 0) * w, (co.dz ?? 0) * w).applyAxisAngle(Y, c.psiE.x);
    pRacine.add(v4);
  }
  qR.copy(qRacine).multiply(sq.qModele[sq.i.racine]); // rotation modèle de la racine = corps · repos
  // Abaissement automatique d'une ceinture dont un pied d'appui est hors de portée (lissé).
  pRacine.y -= (c.abaissement.av.x + c.abaissement.ar.x) / 2;
  placerRacine(sq, c.pose, pRacine, qR);
  fkOs(sq, c.pose, c.monde, sq.i.racine);
  const pose = c.pose, m = c.monde;

  // Dos : flexion du galop, pli latéral entre épaules et bassin, ondulation de la marche.
  const pli = c.psiB.x - c.psiE.x;
  const tangageArriere = Math.atan2(c.abaissement.av.x - c.abaissement.ar.x, 0.4);
  for (const r of ["thorax", "lombaires"] as const) {
    const kk = sq.i[r];
    deltaModele(sq, kk, qEuler(-flexion * 0.5 + tangageArriere * 0.5 + 0.004 * respiration, pli * 0.5 + 0.03 * ondulation, 0, qa), pose.q[kk]);
    appliquerCouchesOs(c, k.couches, r, pose.q[kk]);
    fkOs(sq, pose, m, kk);
  }
  for (const r of ["hancheG", "hancheD"] as const) {
    const kk = sq.i[r];
    pose.q[kk].copy(sq.qRepos[kk]);
    appliquerCouchesOs(c, k.couches, r, pose.q[kk]);
    fkOs(sq, pose, m, kk);
  }

  // 6. Cou et tête : stabilisés (le regard reste de niveau), lacet vers le cap de la tête et vers la caméra.
  let regard = k.regard;
  for (const cc of k.couches) if (cc.pose.regard != null) regard = lerp(regard, cc.pose.regard, Math.max(cc.poids.tete ?? 0, cc.poids.cou ?? 0));
  amortir(c.regard, regard, 7, dt);
  // Lacet vers la caméra (ψ = 0) relatif aux épaules, borné.
  const versCamera = borne(ecartAngle(c.psiE.x, 0), -1.25, 1.25);
  const lacetTete = (c.psiT.x - c.psiE.x) + c.regard.x * (versCamera - (c.psiT.x - c.psiE.x));
  const bruitT = bruitDouble(t * 0.35, c.graine + 11), bruitP = bruitDouble(t * 0.3, c.graine + 17);
  // Pose capturée (`brut`) : pas de bruit procédural par-dessus la tête du clip.
  let brutTete = 0, brutQueue = 0;
  for (const cc of k.couches) if (cc.pose.brut) { brutTete = Math.max(brutTete, cc.poids.tete ?? 0); brutQueue = Math.max(brutQueue, cc.poids.queue ?? 0); }
  const calme = (1 - 0.7 * kv) * (1 - brutTete);
  amortir(c.tete.lacet, lacetTete + 0.06 * bruitT * calme - 0.02 * ondulation, 11, dt);
  amortir(c.tete.tangage, -0.8 * (tangage + c.abaissement.av.x * 0) + 0.04 * bruitP * calme - 0.012 * respiration, 14, dt);
  amortir(c.tete.roulis, 0.05 * bruitDouble(t * 0.21, c.graine + 23) * calme + 0.2 * c.regard.x * Math.sin(versCamera) * 0.3, 9, dt);
  {
    const kk = sq.i.cou;
    // Cou : moitié du lacet, la tangage de stabilisation (+X = baisse la tête).
    deltaModele(sq, kk, qEuler(-c.tete.tangage.x * 0.55, c.tete.lacet.x * 0.45, 0, qa), pose.q[kk]);
    appliquerCouchesOs(c, k.couches, "cou", pose.q[kk]);
    fkOs(sq, pose, m, kk);
    for (const r of OS_TETE) {
      const kt = sq.i[r];
      deltaModele(sq, kt, qEuler(-c.tete.tangage.x * 0.45, c.tete.lacet.x * 0.55, c.tete.roulis.x, qa), pose.q[kt]);
      // Oreilles couchées un peu par la vitesse.
      if (r === "oreilleG" || r === "oreilleD") {
        const sgn = r === "oreilleG" ? 1 : -1;
        ajouterDelta(sq, pose, kt, qEuler(-0.25 * kv * borne(c.allure.x - 0.5, 0, 1.5), 0, sgn * 0.1 * kv, qa));
      }
      appliquerCouchesOs(c, k.couches, r, pose.q[kt]);
      fkOs(sq, pose, m, kt);
    }
    fkOs(sq, pose, m, sq.i.bout_tete);
    fkOs(sq, pose, m, sq.i.bout_machoire);
  }

  // 7. Pattes : IK vers le point de contact (ou la cible du geste), talon, pied à plat.
  let besoinAv = 0, besoinAr = 0;
  for (const p of PATTES) {
    const manque = poserPatte(c, p, k.couches);
    const e = c.pattes[p];
    if (e.appui && e.libre < 0.01) {
      if (c.geo[p].def.avant) besoinAv = Math.max(besoinAv, manque); else besoinAr = Math.max(besoinAr, manque);
    }
  }
  amortir(c.abaissement.av, Math.min(0.04, c.abaissement.av.x + besoinAv * 0.8), 12, dt);
  amortir(c.abaissement.ar, Math.min(0.04, c.abaissement.ar.x + besoinAr * 0.8), 12, dt);
  // Sans manque, l'abaissement revient doucement.
  if (besoinAv < 1e-4) amortir(c.abaissement.av, 0, 3, dt);
  if (besoinAr < 1e-4) amortir(c.abaissement.ar, 0, 3, dt);

  // 8. Queue et oreilles : pose cible (repos + allure + bruit + geste), puis chaîne à ressort.
  const balance = bruit(t * 0.27, c.graine + 31), fouet = bruitDouble(t * 0.9, c.graine + 37);
  // À la course, la queue se tend vers l'arrière (balancier) : base abaissée, courbure redressée.
  const tendue = kv * borne(c.allure.x / 2, 0, 1);
  const LEVE = [-0.3, 0.6, 0.4, 0.15, 0.05, 0];
  OS_QUEUE.forEach((r, j) => {
    const kk = sq.i[r];
    const lat = ((j < 4 ? 0.12 : 0.18) * balance * (1 - 0.6 * kv) + (j >= 4 ? 0.15 * fouet * (1 - kv) : 0)) * (1 - brutQueue);
    deltaModele(sq, kk, qEuler(LEVE[j] * tendue + (j === 1 ? 0.12 * kv : 0), lat, 0, qa), pose.q[kk]);
    appliquerCouchesOs(c, k.couches, r, pose.q[kk]);
  });
  avancerChaine(c.queue, sq, pose, m, dt, 0.5, 0, 0.025);
  avancerChaine(c.oreilleG, sq, pose, m, dt, 0.5, 0);
  avancerChaine(c.oreilleD, sq, pose, m, dt, 0.5, 0);
  return c;
}

/** Rotation de l'os `r` : couches de geste (deltas en repère du modèle, puis rotations absolues de clip). */
function appliquerCouchesOs(c: Corps, couches: Couche[], r: Role, q: Quaternion) {
  const sq = c.sq, kk = sq.i[r], g = GROUPE_DE[r];
  for (const cc of couches) {
    const w = cc.poids[g] ?? 0;
    if (w <= 0) continue;
    const d = cc.pose.deltas?.[r];
    if (d) {
      qEuler(d[0] * w, d[1] * w, d[2] * w, qa);
      qb.copy(sq.qModele[kk]).invert().multiply(qa).multiply(sq.qModele[kk]);
      q.multiply(qb);
    }
    const o = cc.pose.os?.[r];
    if (o) q.slerp(qc.set(o[0], o[1], o[2], o[3]).normalize(), w);
    const tr = cc.pose.t?.[r];
    if (tr) c.pose.t[kk].lerp(v5.set(tr[0], tr[1], tr[2]), w);
  }
}

/** Point du repère du corps (modèle au repos) → sol, d'après la racine posée. */
export function corpsVersSol(c: Corps, p: Vector3, sortie: Vector3): Vector3 {
  const sq = c.sq, kr = sq.i.racine;
  qa.copy(sq.qModele[kr]).invert();
  return sortie.copy(p).sub(sq.pModele[kr]).applyQuaternion(qa).applyQuaternion(c.monde.q[kr]).add(c.monde.p[kr]);
}

const cible = new Vector3(), milieu = new Vector3(), bout = new Vector3(), pole = new Vector3(), talonV = new Vector3();

/** IK d'une patte ; retourne de combien (m) il manque pour atteindre la cible. */
function poserPatte(c: Corps, p: Patte, couches: Couche[]): number {
  const sq = c.sq, g = c.geo[p], e = c.pattes[p], m = c.monde, pose = c.pose;
  // Extrémité visée : point de contact + talon (tourné par le lacet du pied et le décollement du talon).
  talonV.copy(g.talon).applyAxisAngle(X, e.talon).applyAxisAngle(Y, e.lacet);
  cible.copy(e.contact).add(talonV);
  // Geste : cible en repère du corps, mélangée par le poids de la patte.
  let wGeste = 0;
  let ext: readonly [number, number, number] | undefined;
  for (const cc of couches) {
    const pp = cc.pose.pattes?.[p], w = cc.poids[p] ?? 0;
    if (!pp || w <= 0) continue;
    corpsVersSol(c, v1.set(pp.cible[0], pp.cible[1], pp.cible[2]), v2);
    cible.lerp(v2, w);
    wGeste = Math.max(wGeste, w);
    ext = pp.extremite;
  }
  // Racine de la chaîne (déjà posée par son parent) et pli courant.
  fkOs(sq, pose, m, g.kHaut);
  const A = m.p[g.kHaut];
  qa.copy(sq.qModele[g.kPorteur]).invert();
  pole.copy(g.pole).applyQuaternion(qa).applyQuaternion(m.q[g.kPorteur]);
  // Jamais repliée au-delà de 60 % de sa longueur : la patte en vol passe sous la hanche sans s'y
  // écraser (le genou basculerait d'un côté à l'autre). Projection radiale : continue.
  // Arrière en vol : 42 % (la hanche peut être basse au galop ; le pôle latéral × direction ne
  // bascule pas), sinon la projection poussait la cheville dans le sol à mi-vol.
  const L = g.l1 + g.l2;
  // Arrière en appui : 20 % (assis, la hanche descend presque sur la cheville ; la patte se replie
  // en Z au lieu d'être repoussée sous le sol, ce qui faisait basculer le genou).
  const dMin = (e.appui && wGeste < 0.01 ? (g.def.avant ? 0.4 : 0.2) : g.def.avant ? 0.6 : 0.42) * L;
  let dc = cible.distanceTo(A);
  if (dc < dMin && dc > 1e-6) { cible.sub(A).multiplyScalar(dMin / dc).add(A); dc = dMin; }
  // Garde au sol : une cheville / un poignet visé ne descend jamais sous sa hauteur de repos.
  const yMin = g.yContact + g.talon.y - 0.002;
  if (cible.y < yMin && wGeste < 0.99) { cible.y = lerp(yMin, cible.y, wGeste); dc = cible.distanceTo(A); }
  // IK « douce » près de l'extension complète : la distance demandée tend vers la longueur de la
  // patte sans l'atteindre d'un coup (le genou ne claque pas d'une image à l'autre).
  // Seuil au-dessus de la pose de repos (avant : 95 % de L, arrière : 91 %) : debout, rien ne change.
  const dSouple = (g.def.avant ? 0.975 : 0.95) * L, dMax = 0.999 * L;
  const horsPortee = Math.max(0, dc - dMax);
  if (dc > dSouple) {
    const d2 = dSouple + (dMax - dSouple) * (1 - Math.exp(-(dc - dSouple) / (dMax - dSouple)));
    cible.sub(A).multiplyScalar(d2 / dc).add(A);
  }
  if (!g.def.avant) {
    // Arrière : le genou plie dans le plan sagittal, côté de son repos. Pôle = latéral × (hanche → cible) :
    // toujours perpendiculaire à la patte, il ne bascule jamais quand le pied part loin derrière.
    v3.copy(X).applyQuaternion(qa).applyQuaternion(m.q[g.kPorteur]);
    v4.copy(cible).sub(A).normalize();
    pole.crossVectors(v3, v4).multiplyScalar(g.signePli);
  }
  const res = ik2(A, cible, g.l1, g.l2, pole, milieu, bout);
  if (!g.def.avant) jarretAuDessusDuSol(A, bout, milieu);
  viserOs(sq, pose, m, g.kHaut, v1.copy(milieu).sub(A));
  appliquerCouchesOs(c, couches, g.def.haut, pose.q[g.kHaut]);
  fkOs(sq, pose, m, g.kHaut);
  fkOs(sq, pose, m, g.kBas);
  viserOs(sq, pose, m, g.kBas, v1.copy(bout).sub(m.p[g.kBas]));
  appliquerCouchesOs(c, couches, g.def.bas, pose.q[g.kBas]);
  fkOs(sq, pose, m, g.kBas);
  fkOs(sq, pose, m, g.kExt);
  // Main / pied : à plat dans le lacet du pied, talon décollé ; pendant un geste, rotation propre.
  qa.setFromAxisAngle(Y, e.lacet).multiply(qb.setFromAxisAngle(X, e.talon)).multiply(sq.qModele[g.kExt]);
  if (wGeste > 0) {
    // Repère du corps : la rotation de repos suit la racine.
    qb.copy(sq.qModele[sq.i.racine]).invert();
    qc.copy(m.q[sq.i.racine]).multiply(qb);
    if (ext) qc.multiply(qb.setFromEuler(eul.set(ext[0], ext[1], ext[2], "XYZ")));
    qc.multiply(sq.qModele[g.kExt]);
    qa.slerp(qc, wGeste);
  }
  orienterModele(sq, pose, m, g.kExt, qa);
  appliquerCouchesOs(c, couches, g.def.extremite, pose.q[g.kExt]);
  fkOs(sq, pose, m, g.kExt);
  fkOs(sq, pose, m, g.kBout);
  e.manque = Math.max(horsPortee, res.demande - res.atteinte);
  return e.manque;
}

const axe = new Vector3(), centre = new Vector3(), bw = new Vector3(), bv = new Vector3();
/** Épaisseur du jarret : il se pose sur le sol (assis), sans s'y enfoncer. */
const JARRET_SOL = 0.014;

/**
 * Jarret (articulation du milieu de la patte arrière) jamais sous le sol : assis, la hanche descend
 * presque sur la cheville et le jarret, qui plie vers l'arrière, passerait sous le sol. On le fait
 * tourner sur son cercle de solutions (autour de l'axe hanche → cheville) jusqu'au point le plus
 * proche qui reste au-dessus : le pied ne bouge pas, la patte s'écarte un peu sur le côté.
 */
function jarretAuDessusDuSol(A: Vector3, C: Vector3, B: Vector3) {
  if (B.y >= JARRET_SOL) return;
  axe.copy(C).sub(A);
  const d = axe.length();
  if (d < 1e-6) return;
  axe.divideScalar(d);
  const proj = B.clone().sub(A).dot(axe);
  centre.copy(A).addScaledVector(axe, proj);
  bw.copy(B).sub(centre);
  const r = bw.length();
  if (r < 1e-6) return;
  bw.divideScalar(r);
  bv.crossVectors(axe, bw);
  // B(θ) = centre + r (w cos θ + v sin θ) ; on cherche le plus petit |θ| tel que B.y ≥ JARRET_SOL.
  const R = Math.hypot(bw.y, bv.y);
  if (R < 1e-6) return;
  const phi = Math.atan2(bv.y, bw.y);
  const k = (JARRET_SOL - centre.y) / r;
  let theta: number;
  if (k >= R) theta = phi;
  else {
    const delta = Math.acos(Math.max(-1, k / R));
    const t1 = phi - delta, t2 = phi + delta;
    const n = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
    theta = Math.abs(n(t1)) < Math.abs(n(t2)) ? n(t1) : n(t2);
  }
  B.copy(centre).addScaledVector(bw, r * Math.cos(theta)).addScaledVector(bv, r * Math.sin(theta));
}

/** Positions (sol) des points de contact réellement atteints (bout des doigts / orteils), après la pose. */
export function contactsAtteints(c: Corps): Record<Patte, Vector3> {
  const r = {} as Record<Patte, Vector3>;
  for (const p of PATTES) r[p] = c.monde.p[c.geo[p].kBout].clone();
  return r;
}

export { GROUPES };
