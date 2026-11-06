/**
 * Rocket Muche, rendu : toute la géométrie et la logique du rendu qui n'a pas besoin de three (module E).
 * PUR : sans three, sans DOM, sans horloge ni hasard global ; tourne sous Node et se teste directement.
 *
 * Le stade est dessiné par balayage : le contour en plan du « prisme rétréci » de la SDF (octogone aux pans coupés, `STADE`) est parcouru
 * (arêtes droites puis arcs de rayon `rayonSol` aux sommets), et à chaque point du contour on accroche le PROFIL du mur (raccord de sol de
 * 2,56 m, mur droit, raccord de plafond de 2,56 m). C'est exactement la surface de l'union « prisme rétréci de r puis élargi de r » de la spec
 * (§ 3.2) : un test compare les points de la coque à la distance analytique au prisme.
 *
 * Repères. Stade : repère LOCAL du contrat (Y haut, X largeur, Z longueur). Voiture : coordonnées « three » du modèle, `x = -droite`,
 * `y = haut`, `z = avant` (la base du contrat est `droite = avant × haut`, donc `droite = -X` quand la voiture regarde +Z).
 *
 * Couleurs : tous les `RGB` sont LINÉAIRES (l'espace de travail de three), comme le seuil du bloom de la vue Palantir (0,24 de luminosité,
 * lue avant l'OutputPass) : les décors ordinaires restent dessous, seules les équipes, les plots actifs, la balle et les lignes l'atteignent.
 */
import { BALLE, BUT, PLOT, STADE, VOITURE, type Equipe, type EtatPlot } from "./contrat";
import { angleNormalise, clamp, lerp, type Vec3 } from "./vec";

// ============================================================================================================================
// 1. Couleurs
// ============================================================================================================================

/** Couleur linéaire (r, g, b dans [0, +∞[). */
export type RGB = [number, number, number];

/** Seuil de luminosité du bloom de la vue Palantir. */
export const SEUIL_BLOOM = 0.24;

/** Couleurs sRGB (hexadécimal) du rendu ; celles des équipes passent largement le seuil du bloom, `sol` et `mur` non. */
export const PALETTE = {
  bleue: 0x38a0ff,
  orange: 0xff8a2a,
  cyan: 0x9be9ff,
  ambre: 0xffb35c,
  blanc: 0xf2f7fa,
  sol: 0x0a141c,
  ciel: 0x04060a,
} as const;

const sVersLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Hexadécimal sRGB → RGB linéaire. */
export function rgbLineaire(hex: number): RGB {
  return [sVersLin(((hex >> 16) & 255) / 255), sVersLin(((hex >> 8) & 255) / 255), sVersLin((hex & 255) / 255)];
}
/** Luminosité (Rec. 709) d'une couleur linéaire : la grandeur que lit le filtre du bloom. */
export const luminance = (c: Readonly<RGB>): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const mulRgb = (c: Readonly<RGB>, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const melangeRgb = (a: Readonly<RGB>, b: Readonly<RGB>, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** Met `c` à la luminosité `lum` sans changer sa teinte. */
export function ajusterLuminance(c: Readonly<RGB>, lum: number): RGB {
  const l = luminance(c);
  return l < 1e-9 ? [lum, lum, lum] : mulRgb(c, lum / l);
}
export const couleurEquipe = (e: Equipe): RGB => rgbLineaire(PALETTE[e]);

/** Luminosités visées des éléments décoratifs (sous le seuil du bloom sauf près des cages). */
export const LUM = { mur: 0.15, murCage: 0.55, remplissage: 0.018, plafond: 0.08, gradin: 0.06, public: 0.14 } as const;

export function lisser(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
/** Équipe dont la moitié de terrain contient `z` (les Trèfles défendent Z < 0). */
export const equipeDeZ = (z: number): Equipe => (z < 0 ? "bleue" : "orange");
/** Part de teinte d'équipe d'un point de coordonnée Z : 0 au milieu du terrain, 1 au fond des cages. */
export const teinteZ = (z: number): number => lisser(0.25, 1.15, Math.abs(z) / STADE.demiLongueur);

/** Couleur d'un point de la coque (murs, plafond) : cyan atténué, teinté vers l'équipe du camp, plus lumineux devant les cages. */
export function couleurMur(x: number, _y: number, z: number): RGB {
  const base = ajusterLuminance(rgbLineaire(PALETTE.cyan), LUM.mur);
  const eq = ajusterLuminance(couleurEquipe(equipeDeZ(z)), LUM.mur * 1.3);
  const c = melangeRgb(base, eq, teinteZ(z) * 0.9);
  const proche = lisser(36, STADE.demiLongueur, Math.abs(z)) * (1 - lisser(BUT.demiLargeur, 20, Math.abs(x)));
  return ajusterLuminance(c, lerp(LUM.mur * 1.3, LUM.murCage, proche));
}
/** Couleur du sol (fond sombre, légèrement teinté par demi-terrain). */
export function couleurSol(_x: number, z: number): RGB {
  const fond = rgbLineaire(PALETTE.sol);
  const eq = couleurEquipe(equipeDeZ(z));
  return melangeRgb(fond, mulRgb(eq, 0.05), 0.35 + 0.65 * teinteZ(z));
}

// ============================================================================================================================
// 2. Contour en plan et profil de la coque
// ============================================================================================================================

/** Raccord uniforme : sol / murs / plafond / arêtes verticales (la spec exige le même rayon partout). */
export const RAYON_COQUE = STADE.rayonSol;

/** Les huit sommets du polygone rétréci de `r` (|x| ≤ 38,40 ; |z| ≤ 48,64 ; |x| + |z| ≤ 80,64 − r√2), dans l'ordre trigonométrique du plan (x, z). */
export function sommetsRetrecis(): [number, number][] {
  const r = RAYON_COQUE;
  const X = STADE.demiLargeur - r, Z = STADE.demiLongueur - r;
  const D = STADE.demiLargeur + STADE.demiLongueur - STADE.panCoupe - r * Math.SQRT2;
  const x1 = X, z1 = D - X, x2 = D - Z;
  return [[x1, z1], [x2, Z], [-x2, Z], [-x1, z1], [-x1, -z1], [-x2, -Z], [x2, -Z], [x1, -z1]];
}

export interface PieceContour {
  type: "arete" | "arc";
  /** abscisse curviligne de début et de fin */
  u0: number;
  u1: number;
  /** arête : de `a` à `b` ; arc : sommet `a` (= `b`) */
  a: [number, number];
  b: [number, number];
  /** normale sortante de l'arête (pour un arc : normale de départ) */
  n: [number, number];
  /** arc : angle de la normale au départ et variation signée jusqu'à l'arrivée */
  ang0: number;
  dAng: number;
  /** -1 / +1 pour une arête de fond de terrain (derrière les buts) à Z = ∓48,64, 0 sinon */
  fond: -1 | 0 | 1;
}
export interface Contour { pieces: PieceContour[]; longueur: number }
export interface PointContour { x: number; z: number; nx: number; nz: number }

export function creerContour(): Contour {
  const s = sommetsRetrecis();
  const pieces: PieceContour[] = [];
  let u = 0;
  const normales: [number, number][] = [];
  for (let i = 0; i < s.length; i++) {
    const a = s[i], b = s[(i + 1) % s.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    let n: [number, number] = [dz / L, -dx / L];
    if (n[0] * (a[0] + b[0]) + n[1] * (a[1] + b[1]) < 0) n = [-n[0], -n[1]];
    normales.push(n);
    const fond = Math.abs(n[0]) < 1e-9 && Math.abs(n[1]) > 0.999 ? (n[1] > 0 ? 1 : -1) : 0;
    pieces.push({ type: "arete", u0: u, u1: u + L, a, b, n, ang0: 0, dAng: 0, fond });
    u += L;
  }
  // arcs aux sommets : on les intercale après chaque arête
  const complet: PieceContour[] = [];
  u = 0;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const L = p.u1 - p.u0;
    complet.push({ ...p, u0: u, u1: u + L });
    u += L;
    const n0 = normales[i], n1 = normales[(i + 1) % normales.length];
    const ang0 = Math.atan2(n0[1], n0[0]);
    const dAng = angleNormalise(Math.atan2(n1[1], n1[0]) - ang0);
    const La = RAYON_COQUE * Math.abs(dAng);
    complet.push({ type: "arc", u0: u, u1: u + La, a: p.b, b: p.b, n: n0, ang0, dAng, fond: 0 });
    u += La;
  }
  return { pieces: complet, longueur: u };
}

/** Point du contour (point `b` du polygone rétréci et normale sortante) à l'abscisse `u` (périodique). Écrit dans `out`. */
export function pointContour(c: Readonly<Contour>, u: number, out: PointContour): PointContour {
  let uu = u % c.longueur;
  if (uu < 0) uu += c.longueur;
  let p = c.pieces[c.pieces.length - 1];
  for (let i = 0; i < c.pieces.length; i++) if (uu < c.pieces[i].u1) { p = c.pieces[i]; break; }
  const t = p.u1 > p.u0 ? clamp((uu - p.u0) / (p.u1 - p.u0), 0, 1) : 0;
  if (p.type === "arete") {
    out.x = lerp(p.a[0], p.b[0], t); out.z = lerp(p.a[1], p.b[1], t); out.nx = p.n[0]; out.nz = p.n[1];
  } else {
    const ang = p.ang0 + p.dAng * t;
    out.x = p.a[0]; out.z = p.a[1]; out.nx = Math.cos(ang); out.nz = Math.sin(ang);
  }
  return out;
}

/** Profil du mur : v = 0 au sol (à l'aplomb du contour), puis raccord de sol, mur droit, raccord de plafond jusqu'au plafond. */
export const PROFIL = (() => {
  const r = RAYON_COQUE;
  const quart = (r * Math.PI) / 2;
  const mur = STADE.hauteur - 2 * r;
  return { rayon: r, quart, mur, longueur: 2 * quart + mur, vSommetCage: quart + (BUT.hauteur - r) };
})();

/** Décalage vers l'extérieur du contour `dr` et hauteur `y` du profil à l'abscisse `v` ∈ [0, PROFIL.longueur]. */
export function pointProfil(v: number): { dr: number; y: number } {
  const { rayon: r, quart, mur } = PROFIL;
  if (v <= quart) { const phi = Math.PI / 2 - v / r; return { dr: r * Math.cos(phi), y: r * (1 - Math.sin(phi)) }; }
  if (v <= quart + mur) return { dr: r, y: r + (v - quart) };
  const th = (v - quart - mur) / r;
  return { dr: r * Math.cos(th), y: STADE.hauteur - r + r * Math.sin(th) };
}

/** Point de la coque en repère local du stade, à l'abscisse (u, v). */
export function pointCoque(c: Readonly<Contour>, u: number, v: number, tmp: PointContour = { x: 0, z: 0, nx: 0, nz: 0 }): Vec3 {
  pointContour(c, u, tmp);
  const { dr, y } = pointProfil(clamp(v, 0, PROFIL.longueur));
  return [tmp.x + tmp.nx * dr, y, tmp.z + tmp.nz * dr];
}

/** Ouverture du but dans la coque (le mur, le raccord de sol) : à ne pas dessiner. */
export function dansOuvertureBut(x: number, y: number, z: number): boolean {
  return Math.abs(x) < BUT.demiLargeur + 1e-6 && y < BUT.hauteur + 1e-6 && Math.abs(z) > STADE.demiLongueur - RAYON_COQUE - 1e-3;
}

/** Distance signée EXACTE (positive dedans) d'un point au prisme octogonal rétréci — la formule de la spec § 3.2, pour les tests. */
export function distancePrisme(x: number, y: number, z: number): number {
  const r = RAYON_COQUE;
  const s = sommetsRetrecis();
  let dPlan = -Infinity;
  for (let i = 0; i < s.length; i++) {
    const a = s[i], b = s[(i + 1) % s.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    let nx = dz / L, nz = -dx / L;
    if (nx * (a[0] + b[0]) + nz * (a[1] + b[1]) < 0) { nx = -nx; nz = -nz; }
    dPlan = Math.max(dPlan, (x - a[0]) * nx + (z - a[1]) * nz);
  }
  if (dPlan > 0) {
    // dehors dans le plan : distance aux segments du polygone
    let m = Infinity;
    for (let i = 0; i < s.length; i++) {
      const a = s[i], b = s[(i + 1) % s.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
      m = Math.min(m, Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)));
    }
    dPlan = m;
  }
  const dy = Math.max(r - y, y - (STADE.hauteur - r));
  return dPlan <= 0 && dy <= 0 ? Math.max(dPlan, dy) : Math.hypot(Math.max(dPlan, 0), Math.max(dy, 0));
}

// ---------- grilles alignées sur l'ouverture des buts ----------

/** Abscisses u (croissantes, de 0 à la longueur) d'une grille de pas `pas`, avec des points exacts aux montants des deux buts. */
export function grilleContour(c: Readonly<Contour>, pas: number): number[] {
  const us: number[] = [0];
  for (const p of c.pieces) {
    const L = p.u1 - p.u0;
    const ts = [0, 1];
    if (p.fond !== 0) {
      for (const xm of [BUT.demiLargeur, -BUT.demiLargeur]) {
        const t = (xm - p.a[0]) / (p.b[0] - p.a[0]);
        if (t > 1e-6 && t < 1 - 1e-6) ts.push(t);
      }
      ts.sort((a, b) => a - b);
    }
    for (let k = 0; k < ts.length - 1; k++) {
      const n = Math.max(1, Math.ceil(((ts[k + 1] - ts[k]) * L) / pas - 1e-9));
      for (let i = 1; i <= n; i++) us.push(p.u0 + (ts[k] + ((ts[k + 1] - ts[k]) * i) / n) * L);
    }
  }
  us[us.length - 1] = c.longueur;
  return us;
}
/** Abscisses v d'une grille du profil, avec un point à la hauteur de la barre transversale. */
export function grilleProfil(pasMur = 2.4, pasFillet = 7): number[] {
  const { quart, mur, longueur, vSommetCage } = PROFIL;
  const vs: number[] = [];
  for (let k = 0; k <= pasFillet; k++) vs.push((quart * k) / pasFillet);
  const bornes = [quart, vSommetCage, quart + mur];
  for (let b = 0; b < bornes.length - 1; b++) {
    const n = Math.max(1, Math.ceil((bornes[b + 1] - bornes[b]) / pasMur));
    for (let i = 1; i <= n; i++) vs.push(lerp(bornes[b], bornes[b + 1], i / n));
  }
  for (let k = 1; k <= pasFillet; k++) vs.push(quart + mur + (quart * k) / pasFillet);
  vs[vs.length - 1] = longueur;
  return vs;
}

/** Une nappe de la coque (maillage indexé, couleurs par sommet) : positions xyz, couleurs rgb, triangles. */
export interface Nappe { positions: number[]; couleurs: number[]; indices: number[] }

/**
 * Maillage de la bande de profil [vMin, vMax] sur tout le contour. `ouvertures` : les cellules dans l'ouverture d'un but sont omises.
 * `couleur(x, y, z)` donne la couleur de chaque sommet.
 */
export function construireNappe(
  c: Readonly<Contour>, us: readonly number[], vs: readonly number[], vMin: number, vMax: number,
  couleur: (x: number, y: number, z: number) => RGB, ouvertures = true,
): Nappe {
  const js: number[] = [];
  vs.forEach((v, j) => { if (v >= vMin - 1e-9 && v <= vMax + 1e-9) js.push(j); });
  const nu = us.length, nv = js.length;
  const n: Nappe = { positions: [], couleurs: [], indices: [] };
  const tmp: PointContour = { x: 0, z: 0, nx: 0, nz: 0 };
  for (let i = 0; i < nu; i++) {
    for (let k = 0; k < nv; k++) {
      const p = pointCoque(c, us[i], vs[js[k]], tmp);
      n.positions.push(p[0], p[1], p[2]);
      const col = couleur(p[0], p[1], p[2]);
      n.couleurs.push(col[0], col[1], col[2]);
    }
  }
  for (let i = 0; i < nu - 1; i++) {
    for (let k = 0; k < nv - 1; k++) {
      if (ouvertures) {
        const m = pointCoque(c, (us[i] + us[i + 1]) / 2, (vs[js[k]] + vs[js[k + 1]]) / 2, tmp);
        if (dansOuvertureBut(m[0], m[1], m[2])) continue;
      }
      const a = i * nv + k, b = (i + 1) * nv + k, d = i * nv + k + 1, e = (i + 1) * nv + k + 1;
      n.indices.push(a, b, d, b, e, d);
    }
  }
  return n;
}

// ---------- plafond et sol plat ----------

/** Polygone du sol plat / du plafond (le polygone rétréci), ou sa moitié `signeZ` (-1 : Z ≤ 0, +1 : Z ≥ 0), coupé par Sutherland–Hodgman. */
export function polygonePlat(signeZ: -1 | 0 | 1 = 0): [number, number][] {
  const s = sommetsRetrecis();
  if (signeZ === 0) return s;
  const dedans = (p: [number, number]) => p[1] * signeZ >= -1e-9;
  const res: [number, number][] = [];
  for (let i = 0; i < s.length; i++) {
    const a = s[i], b = s[(i + 1) % s.length];
    const da = dedans(a), db = dedans(b);
    if (da) res.push(a);
    if (da !== db) { const t = (0 - a[1]) / (b[1] - a[1]); res.push([lerp(a[0], b[0], t), 0]); }
  }
  return res;
}
/** Triangulation en éventail d'un polygone convexe, à la hauteur `y`. */
export function eventail(poly: readonly (readonly [number, number])[], y: number, couleur: (x: number, z: number) => RGB): Nappe {
  const n: Nappe = { positions: [], couleurs: [], indices: [] };
  let cx = 0, cz = 0;
  for (const p of poly) { cx += p[0]; cz += p[1]; }
  cx /= poly.length; cz /= poly.length;
  const push = (x: number, z: number) => { n.positions.push(x, y, z); const c = couleur(x, z); n.couleurs.push(c[0], c[1], c[2]); };
  push(cx, cz);
  for (const p of poly) push(p[0], p[1]);
  for (let i = 0; i < poly.length; i++) n.indices.push(0, 1 + i, 1 + ((i + 1) % poly.length));
  return n;
}
/** Fond d'une cage à hauteur 0 (rectangle du plan des buts à `Z = ±60`). */
export function solCage(signeZ: -1 | 1, couleur: (x: number, z: number) => RGB): Nappe {
  const z0 = signeZ * (STADE.demiLongueur - RAYON_COQUE), z1 = signeZ * (STADE.demiLongueur + BUT.profondeur);
  return eventail([[-BUT.demiLargeur, z0], [BUT.demiLargeur, z0], [BUT.demiLargeur, z1], [-BUT.demiLargeur, z1]], 0, couleur);
}
/** Concatène plusieurs nappes (décale les indices). */
export function fusionnerNappes(nappes: readonly Nappe[]): Nappe {
  const r: Nappe = { positions: [], couleurs: [], indices: [] };
  for (const n of nappes) {
    const dec = r.positions.length / 3;
    for (const v of n.positions) r.positions.push(v);
    for (const v of n.couleurs) r.couleurs.push(v);
    for (const i of n.indices) r.indices.push(i + dec);
  }
  return r;
}

// ---------- motif hexagonal des murs ----------

/** Segments (paires de points xyz à plat) d'un réseau d'hexagones plaqué sur la coque, découpés tous les `maxSub` m pour suivre les courbures. */
export function segmentsHexCoque(c: Readonly<Contour>, cote = 1.7, maxSub = 0.5): number[] {
  const U = c.longueur, V = PROFIL.longueur;
  const cols = Math.max(3, Math.round(U / (Math.sqrt(3) * cote)));
  const du = U / cols, su = du / Math.sqrt(3);
  const dv = 1.5 * cote;
  const vus = new Set<string>();
  const sortie: number[] = [];
  const tmp: PointContour = { x: 0, z: 0, nx: 0, nz: 0 };
  const cle = (u: number, v: number) => `${(((u % U) + U) % U).toFixed(3)},${v.toFixed(3)}`;
  const rangs = Math.ceil(V / dv) + 2;
  for (let r = -1; r <= rangs; r++) {
    const cv = r * dv;
    for (let col = 0; col < cols; col++) {
      const cu = (col + 0.5 * (r & 1)) * du;
      const pts: [number, number][] = [];
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; pts.push([cu + su * Math.cos(a), cv + cote * Math.sin(a)]); }
      for (let k = 0; k < 6; k++) {
        let [u0, v0] = pts[k]; let [u1, v1] = pts[(k + 1) % 6];
        // coupe le segment à v ∈ [0, V]
        if ((v0 < 0 && v1 < 0) || (v0 > V && v1 > V)) continue;
        const dvk = v1 - v0, duk = u1 - u0;
        let t0 = 0, t1 = 1;
        if (Math.abs(dvk) > 1e-12) {
          const ta = (0 - v0) / dvk, tb = (V - v0) / dvk;
          t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
        }
        if (t1 - t0 < 1e-6) continue;
        const nu0 = u0 + duk * t0, nv0 = v0 + dvk * t0, nu1 = u0 + duk * t1, nv1 = v0 + dvk * t1;
        u0 = nu0; v0 = nv0; u1 = nu1; v1 = nv1;
        const ka = cle(u0, v0), kb = cle(u1, v1);
        const k2 = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (vus.has(k2)) continue;
        vus.add(k2);
        const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / maxSub));
        let prec = pointCoque(c, u0, v0, tmp);
        for (let i = 1; i <= n; i++) {
          const q = pointCoque(c, lerp(u0, u1, i / n), lerp(v0, v1, i / n), tmp);
          const mx = (prec[0] + q[0]) / 2, my = (prec[1] + q[1]) / 2, mz = (prec[2] + q[2]) / 2;
          if (!dansOuvertureBut(mx, my, mz)) sortie.push(prec[0], prec[1], prec[2], q[0], q[1], q[2]);
          prec = q;
        }
      }
    }
  }
  return sortie;
}
/** Vrai si (x, z) est dans le polygone convexe `poly` (tolérance `marge` m vers l'intérieur). */
export function dansPolygoneConvexe(poly: readonly (readonly [number, number])[], x: number, z: number, marge = 0): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    const cx = (x - a[0]) * dz - (z - a[1]) * dx; // > 0 à droite de l'arête pour un polygone trigonométrique en (x, z)
    if (cx / L > -marge + 1e-9) return false;
  }
  return true;
}
/** Segments (xyz à plat) du réseau hexagonal du plafond, en plan, limités au polygone rétréci. */
export function segmentsHexPlafond(cote = 1.7): number[] {
  const poly = sommetsRetrecis();
  const sortie: number[] = [];
  const vus = new Set<string>();
  const dx = Math.sqrt(3) * cote, dz = 1.5 * cote;
  const y = STADE.hauteur;
  const cle = (x: number, z: number) => `${x.toFixed(3)},${z.toFixed(3)}`;
  for (let j = -Math.ceil(52 / dz); j <= Math.ceil(52 / dz); j++) {
    for (let i = -Math.ceil(42 / dx) - 1; i <= Math.ceil(42 / dx) + 1; i++) {
      const cx = (i + 0.5 * (j & 1)) * dx, cz = j * dz;
      const pts: [number, number][] = [];
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; pts.push([cx + cote * Math.cos(a), cz + cote * Math.sin(a)]); }
      for (let k = 0; k < 6; k++) {
        const a = pts[k], b = pts[(k + 1) % 6];
        if (!dansPolygoneConvexe(poly, a[0], a[1]) || !dansPolygoneConvexe(poly, b[0], b[1])) continue;
        const ka = cle(a[0], a[1]), kb = cle(b[0], b[1]);
        const k2 = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (vus.has(k2)) continue;
        vus.add(k2);
        sortie.push(a[0], y, a[1], b[0], y, b[1]);
      }
    }
  }
  return sortie;
}

// ============================================================================================================================
// 3. Lignes du terrain (rubans plats)
// ============================================================================================================================

/** Largeur en plan des lignes blanches (la spec dit 2,5 cm, invisible à 40 m : on prend 15 cm, comme la largeur lue à l'écran de Rocket League). */
export const LARGEUR_LIGNE = 0.15;
export const RAYON_ROND_CENTRAL = 9.15;
/** Hauteur au-dessus du sol des lignes (m). */
export const HAUTEUR_LIGNE = 0.02;

export interface Maillage { positions: number[]; indices: number[] }

/** Ruban plat de largeur `largeur` le long d'une polyligne (x, z), à la hauteur `y`. */
export function ruban(pts: readonly (readonly [number, number])[], largeur: number, ferme: boolean, y: number, sortie: Maillage): void {
  const n = pts.length, demi = largeur / 2;
  const segs = ferme ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    const nx = (-dz / L) * demi, nz = (dx / L) * demi;
    // léger prolongement pour que les jonctions se recouvrent
    const ex = (dx / L) * demi, ez = (dz / L) * demi;
    const base = sortie.positions.length / 3;
    sortie.positions.push(a[0] - ex + nx, y, a[1] - ez + nz, a[0] - ex - nx, y, a[1] - ez - nz, b[0] + ex + nx, y, b[1] + ez + nz, b[0] + ex - nx, y, b[1] + ez - nz);
    sortie.indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
}
function cercle(cx: number, cz: number, r: number, n: number): [number, number][] {
  const p: [number, number][] = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; p.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  return p;
}
function rect(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

/** Toutes les lignes blanches du terrain (ligne médiane, rond central et son point, surfaces de but et de réparation, lignes de but) en un seul maillage. */
export function lignesTerrain(): Maillage {
  const m: Maillage = { positions: [], indices: [] };
  const y = HAUTEUR_LIGNE, l = LARGEUR_LIGNE;
  const X = STADE.demiLargeur - RAYON_COQUE - 0.3; // jusqu'au pied du raccord
  ruban([[-X, 0], [X, 0]], l, false, y, m);
  ruban(cercle(0, 0, RAYON_ROND_CENTRAL, 72), l, true, y, m);
  ruban(cercle(0, 0, 0.35, 16), l * 1.6, true, y, m);
  const zFond = STADE.demiLongueur - RAYON_COQUE - 0.6; // 48,04 : avant le raccord de sol
  for (const s of [-1, 1] as const) {
    // surface de réparation (16,5 m × ±22) et surface de but (5,5 m × ±12,5), façon football
    ruban(rect(-22, s * zFond, 22, s * (zFond - 16.5)), l, true, y, m);
    ruban(rect(-12.5, s * zFond, 12.5, s * (zFond - 5.5)), l, true, y, m);
    // ligne de but dans la cage
    ruban([[-BUT.demiLargeur, s * STADE.demiLongueur], [BUT.demiLargeur, s * STADE.demiLongueur]], l, false, y, m);
  }
  return m;
}

// ============================================================================================================================
// 4. Buts : montants, barre, filet, fond lumineux
// ============================================================================================================================

export interface Tube { a: Vec3; b: Vec3; rayon: number }
export interface GeometrieCage {
  equipe: Equipe;
  /** montants et barre transversale */
  tubes: Tube[];
  /** filet : segments (xyz à plat par paires) */
  filet: number[];
  /** quads lumineux : [x, y, z] × 4 sommets, intensité 0..1 par quad */
  quads: { coins: [Vec3, Vec3, Vec3, Vec3]; intensite: number }[];
}

/** Cage du but défendu par l'équipe `equipe` (bleue : Z = -60). `pasFilet` : maille du filet (m). */
export function geometrieCage(equipe: Equipe, pasFilet = 0.6): GeometrieCage {
  const s = equipe === "bleue" ? -1 : 1;
  const zf = s * STADE.demiLongueur, zb = s * (STADE.demiLongueur + BUT.profondeur);
  const hw = BUT.demiLargeur, h = BUT.hauteur;
  const tubes: Tube[] = [
    { a: [-hw, 0, zf], b: [-hw, h, zf], rayon: 0.13 },
    { a: [hw, 0, zf], b: [hw, h, zf], rayon: 0.13 },
    { a: [-hw, h, zf], b: [hw, h, zf], rayon: 0.13 },
    // cadre du fond et arêtes de la cage
    { a: [-hw, h, zb], b: [hw, h, zb], rayon: 0.06 },
    { a: [-hw, 0, zb], b: [-hw, h, zb], rayon: 0.06 },
    { a: [hw, 0, zb], b: [hw, h, zb], rayon: 0.06 },
    { a: [-hw, h, zf], b: [-hw, h, zb], rayon: 0.06 },
    { a: [hw, h, zf], b: [hw, h, zb], rayon: 0.06 },
  ];
  const filet: number[] = [];
  const seg = (a: Vec3, b: Vec3) => filet.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  const nx = Math.round((2 * hw) / pasFilet), ny = Math.max(2, Math.round(h / pasFilet)), nz = Math.round(BUT.profondeur / pasFilet);
  for (let i = 0; i <= nx; i++) { const x = -hw + (2 * hw * i) / nx; seg([x, 0, zb], [x, h, zb]); seg([x, h, zf], [x, h, zb]); }
  for (let j = 0; j <= ny; j++) { const y = (h * j) / ny; seg([-hw, y, zb], [hw, y, zb]); seg([-hw, y, zf], [-hw, y, zb]); seg([hw, y, zf], [hw, y, zb]); }
  for (let k = 0; k <= nz; k++) {
    const z = lerp(zf, zb, k / nz);
    seg([-hw, h, z], [hw, h, z]); seg([-hw, 0, z], [-hw, h, z]); seg([hw, 0, z], [hw, h, z]);
  }
  const quads: GeometrieCage["quads"] = [
    { coins: [[-hw, 0, zb], [hw, 0, zb], [hw, h, zb], [-hw, h, zb]], intensite: 1 },
    { coins: [[-hw, 0, zf], [-hw, 0, zb], [-hw, h, zb], [-hw, h, zf]], intensite: 0.35 },
    { coins: [[hw, 0, zf], [hw, 0, zb], [hw, h, zb], [hw, h, zf]], intensite: 0.35 },
    { coins: [[-hw, h, zf], [hw, h, zf], [hw, h, zb], [-hw, h, zb]], intensite: 0.25 },
    // bandeau LED au-dessus de la barre, dans le plan du mur
    { coins: [[-hw, h + 0.12, zf], [hw, h + 0.12, zf], [hw, h + 0.42, zf], [-hw, h + 0.42, zf]], intensite: 1.2 },
  ];
  return { equipe, tubes, filet, quads };
}

// ============================================================================================================================
// 5. Plots de boost
// ============================================================================================================================

/** Rayon visuel de l'anneau d'un plot (m) : plus petit que le rayon de ramassage. */
export const RAYON_ANNEAU = { petit: 0.95, gros: 1.55 } as const;
/** Rayon de la sphère d'un gros plot (m) et hauteur de son vol stationnaire. */
export const SPHERE_GROS = { rayon: 0.5, hauteur: 1.25, amplitude: 0.12 } as const;

export interface VisuelPlot {
  actif: boolean;
  /** 0..1 : part de recharge accomplie (1 = prêt) */
  remplissage: number;
}
export function visuelPlot(p: Readonly<EtatPlot>, gros: boolean): VisuelPlot {
  const total = gros ? PLOT.gros.rechargeS : PLOT.petit.rechargeS;
  return { actif: p.actif, remplissage: p.actif ? 1 : clamp(1 - p.recharge / total, 0, 1) };
}
/** Couleur d'un plot (linéaire) : actif = lumineux (au-dessus du bloom), inactif = sombre. */
export function couleurPlot(gros: boolean, actif: boolean): RGB {
  const base = rgbLineaire(gros ? PALETTE.ambre : PALETTE.cyan);
  return actif ? ajusterLuminance(base, gros ? 0.85 : 0.45) : ajusterLuminance(base, 0.025);
}
/** Mise à l'échelle de la sphère d'un gros plot : pleine à 1, nulle inactif. */
export const echelleSpherePlot = (v: VisuelPlot): number => (v.actif ? 1 : 0);

// ============================================================================================================================
// 6. Gradins et public
// ============================================================================================================================

export const GRADINS = { tiers: 3, profondeur: 3, hauteurMarche: 1.2, retrait: 1.2, retraitFond: 9.6, rallonge: 3, pasPublic: 1.0 } as const;

export interface TierGradin {
  centre: [number, number];
  /** cap (rad, atan2(x, z)) de l'axe long du tier */
  cap: number;
  longueur: number;
  profondeur: number;
  /** hauteur du dessus (le tier est plein, de 0 à `hauteur`) */
  hauteur: number;
  tier: number;
  /** équipe côté de Z du centre */
  equipe: Equipe;
}
/** Trois tiers en escalier derrière chaque arête droite de la coque (plus loin derrière les buts, qui prennent 8,8 m). */
export function disposerGradins(c: Readonly<Contour>): TierGradin[] {
  const res: TierGradin[] = [];
  for (const p of c.pieces) {
    if (p.type !== "arete") continue;
    const L = p.u1 - p.u0;
    const mx = (p.a[0] + p.b[0]) / 2, mz = (p.a[1] + p.b[1]) / 2;
    const retrait = p.fond !== 0 ? GRADINS.retraitFond : GRADINS.retrait;
    const cap = Math.atan2(p.b[0] - p.a[0], p.b[1] - p.a[1]);
    for (let k = 0; k < GRADINS.tiers; k++) {
      const d = RAYON_COQUE + retrait + k * GRADINS.profondeur + GRADINS.profondeur / 2;
      const cx = mx + p.n[0] * d, cz = mz + p.n[1] * d;
      res.push({ centre: [cx, cz], cap, longueur: L + GRADINS.rallonge, profondeur: GRADINS.profondeur, hauteur: (k + 1) * GRADINS.hauteurMarche, tier: k, equipe: equipeDeZ(cz) });
    }
  }
  return res;
}
export interface PlacePublic { x: number; y: number; z: number; equipe: Equipe; phase: number; neutre: boolean }
/** Les spectateurs : une silhouette tous les `pasPublic` m le long du dessus de chaque tier. */
export function placesPublic(tiers: readonly TierGradin[]): PlacePublic[] {
  const res: PlacePublic[] = [];
  for (const t of tiers) {
    const n = Math.floor(t.longueur / GRADINS.pasPublic);
    const dx = Math.sin(t.cap), dz = Math.cos(t.cap);
    for (let i = 0; i < n; i++) {
      const s = -t.longueur / 2 + (i + 0.5) * (t.longueur / n);
      const x = t.centre[0] + dx * s, z = t.centre[1] + dz * s;
      const h = hash01(res.length + 17);
      res.push({ x, y: t.hauteur, z, equipe: equipeDeZ(z), phase: h * Math.PI * 2, neutre: hash01(res.length + 911) < 0.22 });
    }
  }
  return res;
}
/** Hachage déterministe dans [0, 1[ (le rendu n'a pas besoin de plus). */
export function hash01(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
/** Saut d'un spectateur (m) à l'instant `t` d'une célébration d'intensité `k` ∈ [0, 1]. */
export const sautPublic = (phase: number, t: number, k: number): number => k * Math.max(0, Math.sin(t * 9 + phase)) * 0.4;

// ============================================================================================================================
// 7. La voiture (Octane stylisée)
// ============================================================================================================================

/** Profil latéral (avant, haut) en mètres, dans le repère de la voiture, dans le sens trigonométrique. */
export const PROFIL_OCTANE: readonly (readonly [number, number])[] = [
  [-0.45, 0.05], [0.72, 0.05], [0.73, 0.15], [0.62, 0.22], [0.3, 0.27], [0.1, 0.385], [-0.12, 0.388], [-0.3, 0.28], [-0.45, 0.25],
];
export const LARGEUR_OCTANE = VOITURE.hitbox.largeur;
/** Pièces annexes : aileron et supports (centre [avant, droite, haut] et taille [avant, droite, haut]). */
export const PIECES_OCTANE: readonly { c: readonly [number, number, number]; t: readonly [number, number, number] }[] = [
  { c: [-0.43, 0, 0.31], t: [0.16, 0.84, 0.025] },
  { c: [-0.39, 0.25, 0.27], t: [0.05, 0.035, 0.08] },
  { c: [-0.39, -0.25, 0.27], t: [0.05, 0.035, 0.08] },
];
/** Position de l'échappement (flamme du boost), repère [avant, droite, haut]. */
export const ECHAPPEMENT_OCTANE: readonly [number, number, number] = [-0.46, 0, 0.14];
/** Avant / droite / haut → coordonnées three du modèle (x = -droite). */
export const versThree = (avant: number, droite: number, haut: number): Vec3 => [-droite, haut, avant];

export const ROUE = { segments: 10, largeur: 0.26 } as const;

/** Angle de braquage visuel (rad) d'après la vitesse avant `vAvant` et la vitesse de lacet `wHaut` (autour de `haut`, positive = à gauche). */
export function braquageRoues(vAvant: number, wHaut: number, auSol: boolean): number {
  if (!auSol) return 0;
  const empattement = VOITURE.roues[0].local[0] - VOITURE.roues[2].local[0];
  const v = Math.max(Math.abs(vAvant), 1.5) * (vAvant < 0 ? -1 : 1);
  return clamp(-Math.atan((empattement * wHaut) / v), -0.5, 0.5);
}
/** Angle de roulement mis à jour (rad) : la roue tourne de `vAvant × dt / rayon`. */
export const avancerRoulement = (angle: number, vAvant: number, dt: number, rayon: number): number => (angle + (vAvant * dt) / rayon) % (2 * Math.PI);

/**
 * Segments (paires xyz, repère three du modèle) d'une roue : deux cercles, une croix de rayons, quelques arêtes d'axe. `centre` en repère
 * [avant, droite, haut] ; `braquage` autour de `haut` (positif = vers la droite), `roulement` en radians. Écrit dans `sortie` à partir de
 * `debut` (nombre de flottants écrits : `FLOATS_ROUE`).
 */
export const FLOATS_ROUE = (2 * ROUE.segments + 2 + ROUE.segments / 2) * 6;
export function segmentsRoue(centre: readonly [number, number, number], rayon: number, braquage: number, roulement: number, sortie: Float32Array | number[], debut = 0): number {
  const n = ROUE.segments, cb = Math.cos(braquage), sb = Math.sin(braquage);
  // avant de la roue (a, d, h) = (cb, sb, 0) ; essieu (droite) = (-sb, cb, 0)
  const pt = (cote: number, th: number): Vec3 => {
    const f = Math.cos(th) * rayon, h = Math.sin(th) * rayon, e = cote * ROUE.largeur / 2;
    return versThree(centre[0] + cb * f - sb * e, centre[1] + sb * f + cb * e, centre[2] + h);
  };
  let o = debut;
  const ecrire = (a: Vec3, b: Vec3) => { sortie[o++] = a[0]; sortie[o++] = a[1]; sortie[o++] = a[2]; sortie[o++] = b[0]; sortie[o++] = b[1]; sortie[o++] = b[2]; };
  for (const cote of [-1, 1]) for (let k = 0; k < n; k++) ecrire(pt(cote, roulement + (2 * Math.PI * k) / n), pt(cote, roulement + (2 * Math.PI * (k + 1)) / n));
  // rayons (2 diamètres sur la face extérieure) : on voit la roue tourner
  ecrire(pt(1, roulement), pt(1, roulement + Math.PI));
  ecrire(pt(1, roulement + Math.PI / 2), pt(1, roulement + (3 * Math.PI) / 2));
  for (let k = 0; k < n; k += 2) ecrire(pt(-1, roulement + (2 * Math.PI * k) / n), pt(1, roulement + (2 * Math.PI * k) / n));
  return o;
}

// ============================================================================================================================
// 8. Balle : motif, orientation, ombre, traînée
// ============================================================================================================================

/**
 * Motif de la balle : le polyèdre de Goldberg GP(2,0) (12 pentagones + 30 hexagones), dual de l'icosaèdre subdivisé une fois (42 sommets,
 * 80 faces, 120 arêtes). Rend les segments (paires xyz à plat) sur une sphère de rayon `rayon`.
 */
export function segmentsMotifBalle(rayon: number): number[] {
  const t = (1 + Math.sqrt(5)) / 2;
  const base: Vec3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const faces0: [number, number, number][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const verts: Vec3[] = base.map((v) => unitaire(v));
  const milieux = new Map<string, number>();
  const milieu = (a: number, b: number): number => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    const e = milieux.get(k);
    if (e !== undefined) return e;
    verts.push(unitaire([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]));
    milieux.set(k, verts.length - 1);
    return verts.length - 1;
  };
  const faces: [number, number, number][] = [];
  for (const [a, b, c] of faces0) {
    const ab = milieu(a, b), bc = milieu(b, c), ca = milieu(c, a);
    faces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  const centres: Vec3[] = faces.map(([a, b, c]) => unitaire([verts[a][0] + verts[b][0] + verts[c][0], verts[a][1] + verts[b][1] + verts[c][1], verts[a][2] + verts[b][2] + verts[c][2]]));
  const aretes = new Map<string, number[]>();
  faces.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const a = f[k], b = f[(k + 1) % 3];
      const cle = a < b ? `${a}_${b}` : `${b}_${a}`;
      const l = aretes.get(cle);
      if (l) l.push(i); else aretes.set(cle, [i]);
    }
  });
  const sortie: number[] = [];
  for (const fs of aretes.values()) {
    if (fs.length !== 2) continue;
    const a = centres[fs[0]], b = centres[fs[1]];
    // l'arête duale est un arc de grand cercle : on la plie en 2 pour rester sur la sphère
    const m = unitaire([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
    sortie.push(a[0] * rayon, a[1] * rayon, a[2] * rayon, m[0] * rayon, m[1] * rayon, m[2] * rayon, m[0] * rayon, m[1] * rayon, m[2] * rayon, b[0] * rayon, b[1] * rayon, b[2] * rayon);
  }
  return sortie;
}
function unitaire(v: Readonly<Vec3>): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];
/** Fait tourner le quaternion `q` de la vitesse angulaire MONDE `w` pendant `dt` (rotation exacte), rend un nouveau quaternion unitaire. */
export function integrerQuat(q: Readonly<Quat>, w: Readonly<Vec3>, dt: number): Quat {
  const n = Math.hypot(w[0], w[1], w[2]), a = n * dt;
  if (a < 1e-9) return [q[0], q[1], q[2], q[3]];
  const s = Math.sin(a / 2) / n, dx = w[0] * s, dy = w[1] * s, dz = w[2] * s, dw = Math.cos(a / 2);
  // dq * q
  const r: Quat = [
    dw * q[0] + dx * q[3] + dy * q[2] - dz * q[1],
    dw * q[1] - dx * q[2] + dy * q[3] + dz * q[0],
    dw * q[2] + dx * q[1] - dy * q[0] + dz * q[3],
    dw * q[3] - dx * q[0] - dy * q[1] - dz * q[2],
  ];
  const l = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
  return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
}

/** Intensité de la traînée de la balle selon sa vitesse (m/s) : nulle sous 12, pleine à 40. */
export const intensiteTrainee = (vitesse: number): number => lisser(12, 40, vitesse);
/** Ombre de la balle : échelle (rayon relatif) et opacité selon la hauteur `h` de son centre au-dessus du sol. */
export function ombreBalle(h: number): { echelle: number; opacite: number } {
  const k = clamp((h - BALLE.rayon) / 14, 0, 1);
  return { echelle: lerp(1.05, 0.45, k), opacite: lerp(0.9, 0.3, k) };
}
/** Couleur de la balle : neutre (blanc-cyan) tant que personne ne l'a touchée, puis la couleur de la dernière équipe qui l'a touchée. */
export function couleurBalle(equipe: Equipe | null): RGB {
  return equipe === null ? ajusterLuminance(rgbLineaire(PALETTE.blanc), 0.7) : ajusterLuminance(couleurEquipe(equipe), 0.6);
}

// ============================================================================================================================
// 9. Effets
// ============================================================================================================================

export type TypeEffet = "but" | "demolition" | "plot" | "touche" | "decor" | "atterrissage" | "supersonique" | "saut";
/** Gabarit d'un effet : nombre de particules, vitesse, durée de vie, pesanteur, anneau éventuel (rayon final, durée). */
export interface GabaritEffet { nombre: number; vitesse: number; vie: number; gravite: number; anneau: { rayon: number; dureeS: number } | null; taille: number }
export const GABARITS: Readonly<Record<TypeEffet, GabaritEffet>> = {
  but: { nombre: 160, vitesse: 22, vie: 1.8, gravite: 6, anneau: { rayon: 24, dureeS: 1.1 }, taille: 0.45 },
  demolition: { nombre: 90, vitesse: 14, vie: 1.1, gravite: 7, anneau: { rayon: 6, dureeS: 0.6 }, taille: 0.3 },
  plot: { nombre: 14, vitesse: 5, vie: 0.5, gravite: 2, anneau: { rayon: 2.2, dureeS: 0.35 }, taille: 0.18 },
  touche: { nombre: 16, vitesse: 9, vie: 0.45, gravite: 5, anneau: null, taille: 0.16 },
  decor: { nombre: 10, vitesse: 6, vie: 0.4, gravite: 5, anneau: null, taille: 0.14 },
  atterrissage: { nombre: 6, vitesse: 3, vie: 0.4, gravite: 1, anneau: { rayon: 1.6, dureeS: 0.3 }, taille: 0.12 },
  supersonique: { nombre: 0, vitesse: 0, vie: 0, gravite: 0, anneau: { rayon: 4, dureeS: 0.45 }, taille: 0 },
  saut: { nombre: 0, vitesse: 0, vie: 0, gravite: 0, anneau: null, taille: 0 },
};
/** Nombre de particules effectif : divisé par 3 en qualité basse, par 2 en mouvement réduit, modulé par l'intensité `k` ∈ [0, 1]. */
export function nombreParticules(type: TypeEffet, k: number, qualite: "haute" | "basse", reduit: boolean): number {
  const n = GABARITS[type].nombre * clamp(k, 0.2, 1) * (qualite === "basse" ? 1 / 3 : 1) * (reduit ? 0.5 : 1);
  return Math.round(n);
}
/** `n` directions réparties sur la sphère (spirale de Fibonacci), déterministes. */
export function directionsFibonacci(n: number): Vec3[] {
  const res: Vec3[] = [];
  const or = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (2 * i) / (n - 1), r = Math.sqrt(Math.max(0, 1 - y * y)), th = or * i;
    res.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return res;
}
/** Intensité d'une touche de balle ou d'un choc de décor d'après la vitesse (m/s) : 0..1. */
export const intensiteChoc = (vitesse: number): number => lisser(2, 40, vitesse);
/** Intensité de la pulsation lumineuse des murs, `t` secondes après un but (0 si fini ou mouvement réduit). */
export function pulsationBut(t: number, reduit: boolean): number {
  if (reduit || t < 0) return 0;
  return Math.exp(-t * 1.6) * (0.65 + 0.35 * Math.cos(t * 14));
}

// ============================================================================================================================
// 10. Interpolation de l'affichage
// ============================================================================================================================

/** Au-delà de cette distance entre deux pas, la voiture / la balle s'est téléportée (coup d'envoi) : pas d'interpolation. */
export const SAUT_TELEPORTATION_M = 6;
/** Position affichée : interpolée entre `a` et `b` sauf téléportation. */
export function interpolerPosition(a: Readonly<Vec3>, b: Readonly<Vec3>, alpha: number, sortie: Vec3): Vec3 {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const k = d > SAUT_TELEPORTATION_M ? 1 : clamp(alpha, 0, 1);
  sortie[0] = a[0] + (b[0] - a[0]) * k; sortie[1] = a[1] + (b[1] - a[1]) * k; sortie[2] = a[2] + (b[2] - a[2]) * k;
  return sortie;
}

// ============================================================================================================================
// 11. Tableau d'affichage du Truck Muche
// ============================================================================================================================

/** Texte du tableau : « TRÈFLES 2 - 1 TIGRES » d'après les noms d'équipes et le score. */
export function texteTableau(noms: Readonly<Record<Equipe, string>>, score: Readonly<Record<Equipe, number>>): string {
  const court = (n: string) => n.replace(/^(les|la|le)\s+/i, "").toLocaleUpperCase("fr-FR");
  return `${court(noms.bleue)}  ${score.bleue} - ${score.orange}  ${court(noms.orange)}`;
}
