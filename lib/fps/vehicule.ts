/**
 * Physique arcade d'une voiture conduisible (PUR) : accélération, freinage, braquage, adhérence latérale, collisions bâtiments
 * par 3 cercles le long de l'axe. Le cap suit la convention du lacet (avant = (−sin cap, 0, −cos cap)).
 * Même fonction côté client (le conducteur simule en local) et côté serveur (tests, rejeu) : déterministe, aucun aléa, aucune horloge.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.12, §5.6)
 */
import { resoudre, type Contact, type Monde } from "./collision";
import { OEIL_SIEGE, SILHOUETTE, type Siege, type Vec3 } from "./protocole";
import type { Vec2 } from "../agroparc3d/types";

export const VEH = {
  longueur: 4.4, largeur: 1.9, hauteur: 1.5, vitesseMax: 24, vitesseArriere: 8, accel: 14, freinage: 28, frottement: 3,
  braquageMax: 0.55, empattement: 2.6, rayonCercle: 1.0, vitesseRenverse: 6, distanceMontee: 3.5, oeilSiege: OEIL_SIEGE,
} as const;
/** v signée le long du cap */
export interface EtatVehicule { p: Vec3; cap: number; v: number }
/** accel −1..1, direction −1..1 (+1 = droite) */
export interface CommandesVehicule { accel: number; direction: number; frein: boolean }

/** Pas de simulation interne maximal (s) : le dt d'une image est sous-découpé. */
const PAS_MAX_S = 1 / 120;
/** Vitesse (m/s) à laquelle le braquage utile est divisé par deux (rapport 1 / (1 + (v / REF)²)). */
const BRAQUAGE_VITESSE_REF = 14;
/** Adhérence latérale : accélération centripète maximale (m/s²) ; la vitesse de rotation est bornée à ADHERENCE / |v|. */
const ADHERENCE_LATERALE = 17;
/** Frein à main : freinage moins fort que la pédale, mais pneus qui décrochent (adhérence latérale ×). */
const COEF_FREIN_MAIN = 0.7;
const COEF_ADHERENCE_FREIN_MAIN = 1.7;
/** Les 3 cercles de collision le long de l'axe (m depuis le centre, + = avant) : ±1,2 + rayon 1,0 couvrent les ±2,2 m de la caisse. */
const DECALAGES_CERCLES: readonly number[] = [-1.2, 0, 1.2];

const borne = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
/** Rapproche `v` de `cible` d'au plus `delta`. */
function approcher(v: number, cible: number, delta: number): number {
  return v < cible ? Math.min(v + delta, cible) : Math.max(v - delta, cible);
}
/** Direction de l'avant (xz) d'un cap. */
function avant(cap: number): [number, number] {
  return [-Math.sin(cap), -Math.cos(cap)];
}
/** Direction de la droite (xz) d'un cap : cap 0 → +x, cap π/2 (regard vers −x) → −z. */
function droite(cap: number): [number, number] {
  return [Math.cos(cap), -Math.sin(cap)];
}
function enrouler(a: number): number {
  const t = 2 * Math.PI;
  const r = ((a + Math.PI) % t + t) % t - Math.PI;
  return r === -Math.PI ? Math.PI : r;
}

export function etatVehiculeInitial(p: Vec2, cap: number): EtatVehicule {
  return { p: [p[0], 0, p[1]], cap, v: 0 };
}

/** Vitesse longitudinale après un sous-pas : accélérateur, freinage (pédale inverse), frein à main, frottement. */
function vitesseApres(v: number, accel: number, frein: boolean, h: number): number {
  if (frein) return approcher(v, 0, VEH.freinage * COEF_FREIN_MAIN * h);
  if (accel > 0.001) {
    // marche arrière en cours : la pédale avant freine d'abord
    if (v < -0.01) return v + VEH.freinage * accel * h;
    const cible = VEH.vitesseMax * accel;
    return v < cible ? Math.min(v + VEH.accel * accel * h, cible) : approcher(v, cible, VEH.frottement * h);
  }
  if (accel < -0.001) {
    if (v > 0.01) return v + VEH.freinage * accel * h;
    const cible = -VEH.vitesseArriere * Math.abs(accel);
    return v > cible ? Math.max(v + VEH.accel * accel * h, cible) : approcher(v, cible, VEH.frottement * h);
  }
  return approcher(v, 0, VEH.frottement * h);
}

/** Pousse la voiture hors des bâtiments (3 cercles, deux passes) ; renvoie la position corrigée et les contacts de murs. */
function resoudreVehicule(monde: Monde, x: number, z: number, cap: number): { x: number; z: number; contacts: Contact[] } {
  const [fx, fz] = avant(cap);
  const contacts: Contact[] = [];
  for (let passe = 0; passe < 2; passe++) {
    let bouge = false;
    for (const d of DECALAGES_CERCLES) {
      const r = resoudre(monde, [x + fx * d, 0, z + fz * d], VEH.rayonCercle, VEH.hauteur);
      if (!r.contacts.length) continue;
      x = r.p[0] - fx * d;
      z = r.p[2] - fz * d;
      for (const c of r.contacts) contacts.push(c);
      bouge = true;
    }
    if (!bouge) break;
  }
  return { x, z, contacts };
}

/** Un pas (dt ≤ 1/60, sous-découpé en interne). `choc` = vitesse perdue au contact (m/s) pour le son. */
export function pasVehicule(e: EtatVehicule, c: CommandesVehicule, dt: number, monde: Monde): { etat: EtatVehicule; choc: number } {
  const accel = borne(Number.isFinite(c.accel) ? c.accel : 0, -1, 1);
  const direction = borne(Number.isFinite(c.direction) ? c.direction : 0, -1, 1);
  let x = e.p[0], z = e.p[2], cap = e.cap, v = e.v, choc = 0;
  if (!(dt > 0)) return { etat: { p: [x, e.p[1], z], cap, v }, choc };
  const n = Math.max(1, Math.ceil(dt / PAS_MAX_S - 1e-9));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    v = vitesseApres(v, accel, c.frein, h);

    // Braquage : angle de roue réduit avec la vitesse, rotation bornée par l'adhérence latérale (aucune au repos : omega ∝ v).
    const vAbs = Math.abs(v);
    const braquage = (direction * VEH.braquageMax) / (1 + (vAbs / BRAQUAGE_VITESSE_REF) ** 2);
    let omega = -(v / VEH.empattement) * Math.tan(braquage);
    const omegaMax = (ADHERENCE_LATERALE * (c.frein ? COEF_ADHERENCE_FREIN_MAIN : 1)) / Math.max(vAbs, 1e-6);
    omega = borne(omega, -omegaMax, omegaMax);
    cap += omega * h;

    const [fx, fz] = avant(cap);
    x += fx * v * h;
    z += fz * v * h;

    // Collisions : la vitesse perd sa composante normale à chaque mur touché, le cap ne change pas.
    const r = resoudreVehicule(monde, x, z, cap);
    x = r.x; z = r.z;
    if (r.contacts.length) {
      let vx = fx * v, vz = fz * v;
      for (const k of r.contacts) {
        const vn = vx * k.nx + vz * k.nz;
        if (vn < 0) { vx -= vn * k.nx; vz -= vn * k.nz; }
      }
      const vNeuve = vx * fx + vz * fz;
      choc += Math.max(0, Math.abs(v) - Math.abs(vNeuve));
      v = vNeuve;
    }
  }
  return { etat: { p: [x, e.p[1], z], cap: enrouler(cap), v }, choc };
}

/** (x droite, z avant) des 4 sièges : 0 conducteur (avant-gauche), 1 avant-droit, 2 et 3 arrière. */
export const SIEGES_LOCAUX: readonly (readonly [number, number])[] = [[-0.45, 0.6], [0.45, 0.6], [-0.45, -0.6], [0.45, -0.6]];
/** p du joueur assis (pieds) */
export function positionSiege(e: EtatVehicule, siege: Siege): Vec3 {
  const [sx, sz] = SIEGES_LOCAUX[siege];
  const [fx, fz] = avant(e.cap), [rx, rz] = droite(e.cap);
  return [e.p[0] + rx * sx + fx * sz, e.p[1], e.p[2] + rz * sx + fz * sz];
}

/** Un point (pieds d'un joueur debout) est libre : aucun bâtiment ni borne de la carte ne le pousse. */
function degage(monde: Monde, x: number, z: number): boolean {
  return resoudre(monde, [x, 0, z], SILHOUETTE.rayon, SILHOUETTE.hauteur).contacts.length === 0;
}

/**
 * Point de sortie : côté du siège (sinon l'autre côté, l'arrière, l'avant) à 0,9 m de la caisse, hors bâtiment.
 * Si rien n'est dégagé, le premier candidat repoussé hors des murs.
 */
export function pointDeSortie(e: EtatVehicule, siege: Siege, monde: Monde): Vec3 {
  const [sx, sz] = SIEGES_LOCAUX[siege];
  const [fx, fz] = avant(e.cap), [rx, rz] = droite(e.cap);
  const cote = sx < 0 ? -1 : 1;
  const ecart = VEH.largeur / 2 + 0.9;
  const bout = VEH.longueur / 2 + 1.2;
  const candidats: [number, number][] = [
    [e.p[0] + rx * cote * ecart + fx * sz, e.p[2] + rz * cote * ecart + fz * sz],
    [e.p[0] - rx * cote * ecart + fx * sz, e.p[2] - rz * cote * ecart + fz * sz],
    [e.p[0] - fx * bout, e.p[2] - fz * bout],
    [e.p[0] + fx * bout, e.p[2] + fz * bout],
  ];
  for (const [x, z] of candidats) if (degage(monde, x, z)) return [x, e.p[1], z];
  const r = resoudre(monde, [candidats[0][0], 0, candidats[0][1]], SILHOUETTE.rayon, SILHOUETTE.hauteur);
  return [r.p[0], e.p[1], r.p[2]];
}

/** Distance horizontale (m) d'un point (xz) à la caisse (rectangle orienté), 0 dedans. */
function distanceCaisse(e: EtatVehicule, x: number, z: number): number {
  const dx = x - e.p[0], dz = z - e.p[2];
  const [fx, fz] = avant(e.cap), [rx, rz] = droite(e.cap);
  const long = Math.abs(dx * fx + dz * fz) - VEH.longueur / 2;
  const lat = Math.abs(dx * rx + dz * rz) - VEH.largeur / 2;
  return Math.hypot(Math.max(long, 0), Math.max(lat, 0));
}

/** à la boîte (0 si le point est dedans) ; un point au-dessus du toit compte l'écart vertical. */
export function distanceVehicule(e: EtatVehicule, p: Vec3): number {
  const dh = distanceCaisse(e, p[0], p[2]);
  const dy = Math.max(0, p[1] - e.p[1] - VEH.hauteur);
  return Math.hypot(dh, dy);
}

/** Recoupe la boîte (sans marge) ET `vitesseMesuree` ≥ vitesseRenverse. La vitesse est celle MESURÉE par le serveur (Garage.vitesseMesuree), jamais le `v` déclaré. */
export function renverse(e: EtatVehicule, joueur: Vec3, rayon: number, vitesseMesuree: number): boolean {
  if (!(vitesseMesuree >= VEH.vitesseRenverse)) return false;
  // pieds sous le toit (le cylindre du joueur monte au-dessus du sol de la caisse) : on ne renverse pas quelqu'un qui est sur le toit d'un bâtiment voisin
  if (joueur[1] >= e.p[1] + VEH.hauteur) return false;
  return distanceCaisse(e, joueur[0], joueur[2]) < rayon;
}

/** Coins de la caisse (xz) : avant-gauche, avant-droit, arrière-droit, arrière-gauche. */
export function coinsVehicule(e: EtatVehicule): [Vec2, Vec2, Vec2, Vec2] {
  const [fx, fz] = avant(e.cap), [rx, rz] = droite(e.cap);
  const l = VEH.longueur / 2, w = VEH.largeur / 2;
  const coin = (a: number, b: number): Vec2 => [e.p[0] + fx * l * a + rx * w * b, e.p[2] + fz * l * a + rz * w * b];
  return [coin(1, -1), coin(1, 1), coin(-1, 1), coin(-1, -1)];
}
