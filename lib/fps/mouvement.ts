/**
 * Contrôleur du joueur de l'arène FPS (PUR : ni three ni DOM), façon Titanfall 2 : course rapide,
 * double saut, WALL-RUN (on court sur un mur en glissant le long), saut de mur et escalade des
 * toits bas. Il s'appuie sur le monde de `collision.ts` (cylindre vertical contre bâtiments
 * extrudés). Repère de scene.json : x vers l'est, z vers le sud, y vers le haut ; `lacet` 0 = regard
 * vers −z (convention three). Une position = les PIEDS.
 *
 * `etape` sous-découpe le temps en pas ≤ 1/120 s : à 30 m/s on avance de 25 cm par pas, moins que
 * le rayon du joueur, donc `resoudre` ne laisse rien traverser (même un mur de 30 cm).
 *
 * Wall-run : après chaque déplacement en l'air, on « sonde » les murs à moins de `murSonde` du
 * cylindre. Pendant la course, la normale du mur sondé est recalculée à chaque pas et la vitesse
 * est ramenée sur sa tangente (avec un virage borné) : le joueur suit donc les murs légèrement
 * courbes et les angles émoussés d'un même bâtiment, et décroche dans les coins vifs.
 */
import type { Contact, Monde } from "./collision";
import { resoudre, solSous } from "./collision";
import type { CoteMur, Posture, Vec3 } from "./protocole";
import { SILHOUETTE } from "./protocole";

export interface Entrees {
  /** −1..1 (1 = vers l'avant) */
  avant: number;
  /** −1..1 (1 = vers la droite) */
  droite: number;
  /** maintenu (le front montant est détecté ici) */
  saut: boolean;
  sprint: boolean;
  /** cap de la vue (rad) */
  lacet: number;
}

export interface EtatMouvement {
  p: Vec3;
  v: Vec3;
  auSol: boolean;
  /** wall-run en cours : normale du mur (vers le joueur), côté (−1 = mur à gauche, 1 = à droite), temps écoulé */
  mur: { nx: number; nz: number; cote: -1 | 1; t: number; prisme: number } | null;
  /** double saut restant (1, rechargé au sol ET en wall-run) */
  sautsAir: number;
  /** pour détecter le front montant de `saut` */
  sautPrecedent: boolean;
  /** s restantes pour sauter après avoir quitté le sol */
  coyote: number;
  /** anti-recollage au même mur : `t` = temps écoulé depuis la fin du wall-run */
  murRecent: { prisme: number; nx: number; nz: number; t: number } | null;
  /** roulis caméra lissé (rad, + = penche à droite) */
  inclinaison: number;
}

/** Toutes les constantes du contrôleur (exportées pour les tests et le réglage). */
export const MOUV = {
  rayon: SILHOUETTE.rayon,
  hauteur: SILHOUETTE.hauteur,
  /** pas de simulation maximal (s) */
  pasMaxS: 1 / 120,
  /** plus grand dt accepté par appel (onglet gelé) */
  dtMaxS: 0.25,

  marche: 6.5,
  sprint: 9,
  accelSol: 60,
  /** décélération sans entrée au sol (m/s²) */
  frictionSol: 55,
  /** perte de vitesse au sol au-dessus de la vitesse de course (on garde l'élan du saut de mur) */
  frictionExces: 22,
  accelAir: 12,
  saut: 6.8,
  /** impulsion du double saut */
  sautAir: 6.6,
  gravite: 20,
  chuteMax: 45,
  coyoteS: 0.12,
  /** on reste collé au sol tant que la marche vers le bas fait ≤ cette hauteur (m) */
  accrocheSol: 0.12,
  /** marche franchissable en montant (m) */
  toleranceMarche: 0.3,

  /** wall-run */
  murVitesseEntreeMin: 4,
  murAngleMaxDeg: 65,
  murVitesse: 8.5,
  murVitesseMax: 11,
  murVyInit: 1.2,
  murGravite: 3,
  /** vitesse vers le mur qui garde le contact (m/s) */
  murCollage: 1.6,
  murDureeMax: 1.6,
  murInclinaison: 0.22,
  /** portée de la sonde de mur au-delà du rayon (m) */
  murSonde: 0.25,
  /** virage maximal de la vitesse pendant la course (rad/s) : suit les courbes, décroche aux coins vifs */
  murVirage: 4.5,
  /** un mur n'est « courant » que s'il dépasse les pieds de plus que cela (sinon escalade) */
  murHauteurMin: 1.3,
  /** continuité de la normale d'un pas à l'autre (cosinus de 60°) */
  murContinuiteCos: 0.5,
  /** un autre mur dont la normale s'oppose à la marche (cosinus ≤ −0,5, soit à ≤ 60° de face) arrête la course */
  murBarrageCos: 0.5,
  /** à la fin par durée ou lâcher de touche : poussée hors du mur (m/s) */
  murEjection: 2.2,

  /** saut de mur */
  murSautNormale: 6.5,
  murSautVy: 7,
  murRecollageS: 0.5,
  murRecollageAngleDeg: 25,

  /** escalade */
  monteeHauteurMax: 1.3,
  monteeVy: 6.5,
  monteeAvance: 4.5,

  /**
   * Plafond de vitesse horizontale (m/s). Les sauts de mur (jusqu'à 12,8 m/s) enchaînés avec le
   * contrôle en l'air dépassaient 16 m/s ; le serveur refuse les états à plus de 14 m/s
   * (`VITESSE_MAX_H_M_S` de match.ts) : après une coupure du réseau, un joueur aussi rapide restait gelé
   * côté serveur. Ce plafond reste au-dessus de tout ce que prévoient les règles.
   */
  vitesseMaxH: 13.5,

  /** lissage du roulis caméra (1/s) */
  inclinaisonVitesse: 10,
} as const;

const COS_RECOLLAGE = Math.cos((MOUV.murRecollageAngleDeg * Math.PI) / 180);
const SIN_ANGLE_MUR = Math.sin((MOUV.murAngleMaxDeg * Math.PI) / 180);

export function etatInitial(p: Vec3): EtatMouvement {
  return {
    p: [p[0], p[1], p[2]],
    v: [0, 0, 0],
    auSol: true,
    mur: null,
    sautsAir: 1,
    sautPrecedent: false,
    coyote: MOUV.coyoteS,
    murRecent: null,
    inclinaison: 0,
  };
}

/** Posture à envoyer sur le réseau : "mur" en wall-run, "sol" au sol, sinon "air". */
export function postureDe(e: EtatMouvement): Exclude<Posture, "mort"> {
  return e.mur ? "mur" : e.auSol ? "sol" : "air";
}

/** Côté du mur pendant un wall-run (−1 gauche, 1 droite), 0 sinon. */
export function coteMurDe(e: EtatMouvement): CoteMur {
  return e.mur ? e.mur.cote : 0;
}

function copier(e: EtatMouvement): EtatMouvement {
  return {
    p: [e.p[0], e.p[1], e.p[2]],
    v: [e.v[0], e.v[1], e.v[2]],
    auSol: e.auSol,
    mur: e.mur ? { ...e.mur } : null,
    sautsAir: e.sautsAir,
    sautPrecedent: e.sautPrecedent,
    coyote: e.coyote,
    murRecent: e.murRecent ? { ...e.murRecent } : null,
    inclinaison: e.inclinaison,
  };
}

/** Intention de déplacement horizontale d'un pas. */
interface Souhait {
  /** direction souhaitée, unitaire (0,0 sans entrée) */
  dx: number;
  dz: number;
  /** intensité 0..1 */
  mag: number;
  /** vitesse cible (m/s), déjà multipliée par l'intensité et l'arme */
  vmax: number;
  avant: number;
}

function souhait(en: Entrees, mult: number): Souhait {
  const avant = Math.max(-1, Math.min(1, en.avant || 0));
  const droite = Math.max(-1, Math.min(1, en.droite || 0));
  const sl = Math.sin(en.lacet), cl = Math.cos(en.lacet);
  // avant = (−sin, −cos), droite = (cos, −sin)
  let wx = -sl * avant + cl * droite;
  let wz = -cl * avant - sl * droite;
  const l = Math.hypot(wx, wz);
  const mag = Math.min(1, l);
  if (l > 1e-6) { wx /= l; wz /= l; } else { wx = 0; wz = 0; }
  const course = en.sprint && avant > 0.1;
  return { dx: wx, dz: wz, mag, vmax: (course ? MOUV.sprint : MOUV.marche) * mult * mag, avant };
}

/** Fait tourner la direction (dx, dz) vers (cx, cz), au plus de `max` radians. */
function tournerVers(dx: number, dz: number, cx: number, cz: number, max: number): [number, number] {
  const a = Math.atan2(dz, dx), b = Math.atan2(cz, cx);
  let delta = b - a;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const r = Math.max(-max, Math.min(max, delta));
  return [Math.cos(a + r), Math.sin(a + r)];
}

function accelererSol(s: EtatMouvement, w: Souhait, dt: number): void {
  const v = s.v;
  const vit = Math.hypot(v[0], v[2]);
  if (w.mag <= 1e-6) {
    if (vit <= 1e-9) return;
    const k = Math.max(0, vit - MOUV.frictionSol * dt) / vit;
    v[0] *= k; v[2] *= k;
    return;
  }
  if (vit > w.vmax * 1.05 && vit > MOUV.marche) {
    // Au-dessus de la vitesse de course (saut de mur, glissade) : on braque sans casser l'élan.
    const nx = v[0] + w.dx * MOUV.accelSol * dt, nz = v[2] + w.dz * MOUV.accelSol * dt;
    const n = Math.hypot(nx, nz) || 1;
    const sortie = Math.min(n, Math.max(w.vmax, vit - MOUV.frictionExces * dt));
    v[0] = (nx / n) * sortie; v[2] = (nz / n) * sortie;
    return;
  }
  const dvx = w.dx * w.vmax - v[0], dvz = w.dz * w.vmax - v[2];
  const dv = Math.hypot(dvx, dvz), pas = MOUV.accelSol * dt;
  if (dv <= pas) { v[0] = w.dx * w.vmax; v[2] = w.dz * w.vmax; }
  else { v[0] += (dvx / dv) * pas; v[2] += (dvz / dv) * pas; }
}

function accelererAir(s: EtatMouvement, w: Souhait, dt: number): void {
  if (w.mag <= 1e-6) return;
  const proj = s.v[0] * w.dx + s.v[2] * w.dz;
  const ajout = w.vmax - proj;
  if (ajout <= 0) return;
  const a = Math.min(MOUV.accelAir * dt, ajout);
  s.v[0] += w.dx * a; s.v[2] += w.dz * a;
}

/** Contacts avec un vrai bâtiment (pas les bornes) dans un rayon élargi de la sonde. */
function sonder(m: Monde, p: Vec3): Contact[] {
  return resoudre(m, p, MOUV.rayon + MOUV.murSonde, MOUV.hauteur).contacts.filter((c) => c.prisme >= 0);
}

function terminerMur(s: EtatMouvement, ejecter: boolean): void {
  const mur = s.mur;
  if (!mur) return;
  s.murRecent = { prisme: mur.prisme, nx: mur.nx, nz: mur.nz, t: 0 };
  s.mur = null;
  if (ejecter) { s.v[0] += mur.nx * MOUV.murEjection; s.v[2] += mur.nz * MOUV.murEjection; }
}

/** Tangente unitaire du mur orientée selon la vitesse horizontale (dx, dz). */
function tangenteOrientee(nx: number, nz: number, dx: number, dz: number): [number, number, 1 | -1] {
  const sgn = -nz * dx + nx * dz >= 0 ? 1 : -1;
  return [-nz * sgn, nx * sgn, sgn];
}

/**
 * Accroche d'un wall-run après un déplacement en l'air. `vx, vz` = vitesse AVANT l'annulation de
 * la composante entrant dans le mur. Renvoie vrai si on accroche.
 */
function essayerAccrocher(s: EtatMouvement, m: Monde, w: Souhait, vx: number, vz: number, mult: number): boolean {
  if (w.avant <= 0.1) return false;
  const vit = Math.hypot(vx, vz);
  if (vit < MOUV.murVitesseEntreeMin * Math.min(1, mult)) return false;
  const dx = vx / vit, dz = vz / vit;
  let meilleur: Contact | null = null;
  for (const c of sonder(m, s.p)) {
    const pr = m.prismes[c.prisme];
    if (pr.h - s.p[1] <= MOUV.murHauteurMin) continue;
    const r = s.murRecent;
    if (r && r.prisme === c.prisme && r.nx * c.nx + r.nz * c.nz > COS_RECOLLAGE) continue;
    const dn = dx * c.nx + dz * c.nz;
    // Va vers le mur ou le long de lui, à 65° de la tangente au plus.
    if (dn > 0.1 || Math.abs(dn) > SIN_ANGLE_MUR) continue;
    if (!meilleur || c.profondeur > meilleur.profondeur) meilleur = c;
  }
  if (!meilleur) return false;
  const [tx, tz, sgn] = tangenteOrientee(meilleur.nx, meilleur.nz, dx, dz);
  const proj = Math.abs(vx * tx + vz * tz);
  const vitesse = Math.min(MOUV.murVitesseMax * mult, Math.max(MOUV.murVitesse * mult, proj));
  s.mur = { nx: meilleur.nx, nz: meilleur.nz, cote: sgn, t: 0, prisme: meilleur.prisme };
  s.v[0] = tx * vitesse - meilleur.nx * MOUV.murCollage;
  s.v[2] = tz * vitesse - meilleur.nz * MOUV.murCollage;
  s.v[1] = Math.max(s.v[1], MOUV.murVyInit);
  s.sautsAir = 1;
  s.coyote = 0;
  return true;
}

/** Un pas de simulation (dt ≤ pasMaxS) : mur, sinon sol / air. Modifie `s` en place. */
function pas(s: EtatMouvement, en: Entrees, front: boolean, dt: number, m: Monde, mult: number): void {
  if (s.coyote > 0) s.coyote = Math.max(0, s.coyote - dt);
  if (s.murRecent) {
    s.murRecent.t += dt;
    if (s.murRecent.t > MOUV.murRecollageS) s.murRecent = null;
  }
  const w = souhait(en, mult);
  if (s.mur) pasMur(s, en, front, dt, m, mult, w);
  else pasLibre(s, front, dt, m, mult, w);

  const vh = Math.hypot(s.v[0], s.v[2]);
  if (vh > MOUV.vitesseMaxH) {
    const k = MOUV.vitesseMaxH / vh;
    s.v[0] *= k; s.v[2] *= k;
  }

  // Roulis caméra : penche à l'opposé du mur pendant le wall-run.
  const cible = s.mur ? -s.mur.cote * MOUV.murInclinaison : 0;
  s.inclinaison += (cible - s.inclinaison) * (1 - Math.exp(-MOUV.inclinaisonVitesse * dt));
}

/** Wall-run : suit la tangente du mur sondé, saute si demandé, s'arrête selon les règles de la spec. */
function pasMur(s: EtatMouvement, en: Entrees, front: boolean, dt: number, m: Monde, mult: number, w: Souhait): void {
  const mur = s.mur!;
  // Direction actuelle le long du mur (on retire la part qui plaque au mur).
  const vn = s.v[0] * mur.nx + s.v[2] * mur.nz;
  let tdx = s.v[0] - vn * mur.nx, tdz = s.v[2] - vn * mur.nz;
  const lt = Math.hypot(tdx, tdz);
  if (lt < 1e-6) { tdx = -mur.nz * mur.cote; tdz = mur.nx * mur.cote; } else { tdx /= lt; tdz /= lt; }
  const vitesse = Math.min(MOUV.murVitesseMax * mult, Math.max(MOUV.murVitesse * mult, lt));

  // Saut de mur : tangente × vitesse + normale × 6,5 + 7 vers le haut.
  if (front) {
    s.v[0] = tdx * vitesse + mur.nx * MOUV.murSautNormale;
    s.v[2] = tdz * vitesse + mur.nz * MOUV.murSautNormale;
    s.v[1] = MOUV.murSautVy;
    s.sautsAir = 1;
    terminerMur(s, false);
    pasLibre(s, false, dt, m, mult, w);
    return;
  }
  if (w.avant <= 0.1 || mur.t >= MOUV.murDureeMax) {
    terminerMur(s, true);
    pasLibre(s, false, dt, m, mult, w);
    return;
  }

  mur.t += dt;
  s.v[0] = tdx * vitesse - mur.nx * MOUV.murCollage;
  s.v[2] = tdz * vitesse - mur.nz * MOUV.murCollage;
  s.v[1] -= MOUV.murGravite * dt;

  // Déplacement + sol éventuel.
  const yAvant = s.p[1];
  let x = s.p[0] + s.v[0] * dt, z = s.p[2] + s.v[2] * dt, y = yAvant + s.v[1] * dt;
  const sol = solSous(m, x, z, yAvant, MOUV.toleranceMarche);
  if (s.v[1] <= 0 && y <= sol) {
    s.p = [x, sol, z];
    s.v[1] = 0;
    s.auSol = true;
    s.sautsAir = 1;
    s.coyote = MOUV.coyoteS;
    terminerMur(s, false);
    const res = resoudre(m, s.p, MOUV.rayon, MOUV.hauteur);
    s.p = res.p;
    return;
  }
  const res = resoudre(m, [x, y, z], MOUV.rayon, MOUV.hauteur);
  x = res.p[0]; z = res.p[2];
  s.p = [x, y, z];

  // Coin rentrant (ou limite de l'arène) : un autre mur, très différent de celui qu'on longe, barre la
  // route de face → la course s'arrête là. Sinon on restait collé au coin, immobile mais en « wall-run »
  // à 8,5 m/s, jusqu'à la fin du chrono.
  for (const c of res.contacts) {
    if (c.nx * mur.nx + c.nz * mur.nz >= MOUV.murContinuiteCos) continue;
    if (c.nx * tdx + c.nz * tdz < -MOUV.murBarrageCos) { terminerMur(s, false); return; }
  }

  // Le mur est-il toujours là ? Continuité de la normale (courbes), sinon fin.
  let suivant: Contact | null = null;
  let meilleureCont = -2;
  for (const c of sonder(m, s.p)) {
    const cont = c.nx * mur.nx + c.nz * mur.nz;
    if (cont < MOUV.murContinuiteCos) continue;
    if (cont > meilleureCont) { meilleureCont = cont; suivant = c; }
  }
  if (!suivant) { terminerMur(s, false); return; }
  mur.nx = suivant.nx; mur.nz = suivant.nz; mur.prisme = suivant.prisme;
  // La vitesse tourne (bornée) vers la nouvelle tangente : suit les courbes, décroche aux coins vifs.
  const [tx, tz] = tangenteOrientee(mur.nx, mur.nz, tdx, tdz);
  const [ndx, ndz] = tournerVers(tdx, tdz, tx, tz, MOUV.murVirage * dt);
  s.v[0] = ndx * vitesse - mur.nx * MOUV.murCollage;
  s.v[2] = ndz * vitesse - mur.nz * MOUV.murCollage;
  s.auSol = false;
}

/** Sol et air : accélération, sauts, gravité, déplacement, collisions, escalade, accroche d'un mur. */
function pasLibre(s: EtatMouvement, front: boolean, dt: number, m: Monde, mult: number, w: Souhait): void {
  const v = s.v;
  let saute = false;

  if (s.auSol) accelererSol(s, w, dt); else accelererAir(s, w, dt);

  if (front) {
    if (s.auSol || s.coyote > 0) {
      v[1] = MOUV.saut;
      saute = true;
      s.coyote = 0;
    } else if (s.sautsAir > 0) {
      // Double saut : relance verticale, et le cap suit l'entrée (l'élan est gardé).
      v[1] = MOUV.sautAir;
      s.sautsAir -= 1;
      if (w.mag > 1e-6) {
        const sp = Math.max(Math.hypot(v[0], v[2]), MOUV.marche * mult * w.mag);
        v[0] = w.dx * sp; v[2] = w.dz * sp;
      }
    }
  }
  if (saute) s.auSol = false;
  if (!s.auSol) v[1] = Math.max(-MOUV.chuteMax, v[1] - MOUV.gravite * dt);

  // Déplacement.
  const yAvant = s.p[1];
  const x = s.p[0] + v[0] * dt, z = s.p[2] + v[2] * dt;
  let y = yAvant + v[1] * dt;
  const sol = solSous(m, x, z, yAvant, MOUV.toleranceMarche);
  let auSolApres = false;
  if (s.auSol) {
    if (sol >= yAvant - MOUV.accrocheSol) { y = sol; v[1] = 0; auSolApres = true; }
    else { y = yAvant; s.coyote = MOUV.coyoteS; }
  } else if (v[1] <= 0 && y <= sol) {
    y = sol; v[1] = 0; auSolApres = true;
  }

  // Collisions : on garde la vitesse d'avant pour juger l'accroche, puis on annule ce qui entre.
  const res = resoudre(m, [x, y, z], MOUV.rayon, MOUV.hauteur);
  s.p = res.p;
  s.auSol = auSolApres;
  const vx0 = v[0], vz0 = v[2];

  // Escalade : en l'air, contre un mur dont le toit est à ≤ 1,3 m au-dessus des pieds, en poussant vers l'avant.
  let monte: Contact | null = null;
  if (!auSolApres && w.avant > 0.1) {
    for (const c of res.contacts) {
      if (c.prisme < 0) continue;
      const dh = m.prismes[c.prisme].h - y;
      if (dh <= 0 || dh > MOUV.monteeHauteurMax) continue;
      if (-(w.dx * c.nx + w.dz * c.nz) < 0.3) continue;
      monte = c;
      break;
    }
  }
  for (const c of res.contacts) {
    if (c === monte) continue;
    const vn = v[0] * c.nx + v[2] * c.nz;
    if (vn < 0) { v[0] -= vn * c.nx; v[2] -= vn * c.nz; }
  }
  if (monte) {
    const vn = v[0] * monte.nx + v[2] * monte.nz;
    v[0] = v[0] - vn * monte.nx - monte.nx * MOUV.monteeAvance;
    v[2] = v[2] - vn * monte.nz - monte.nz * MOUV.monteeAvance;
    v[1] = Math.max(v[1], MOUV.monteeVy);
    return;
  }

  if (auSolApres) {
    s.sautsAir = 1;
    s.coyote = MOUV.coyoteS;
    return;
  }
  essayerAccrocher(s, m, w, vx0, vz0, mult);
}

/**
 * Avance le joueur de `dt` secondes (sous-découpé en pas ≤ 1/120 s). `vitesseArme` multiplie les
 * vitesses de déplacement (sniper : 0,9). Renvoie un nouvel état, `e` n'est pas modifié.
 */
export function etape(e: EtatMouvement, entrees: Entrees, dt: number, monde: Monde, vitesseArme: number = 1): EtatMouvement {
  const s = copier(e);
  if (!(dt > 0)) return s;
  const total = Math.min(dt, MOUV.dtMaxS);
  const n = Math.max(1, Math.ceil(total / MOUV.pasMaxS - 1e-6));
  const h = total / n;
  let precedent = e.sautPrecedent;
  for (let i = 0; i < n; i++) {
    const front = entrees.saut && !precedent;
    precedent = entrees.saut;
    pas(s, entrees, front, h, monde, vitesseArme);
  }
  s.sautPrecedent = entrees.saut;
  return s;
}
