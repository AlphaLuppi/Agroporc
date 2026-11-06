/**
 * Rocket Muche : physique de la balle (module B).
 *
 * La balle est une sphère de rayon `BALLE.rayon` qui rebondit sur la SDF du stade (`Arene`). Modèle copié sur Rocket League / RocketSim
 * (constantes dans `contrat.ts`, valeurs d'origine en unreal units citées là-bas) :
 *  1. gravité, puis amortissements `v ← v·(1 - 0,03)^dt` et `w ← w·(1 - 0,03)^dt` ;
 *  2. intégration semi-implicite de la position ;
 *  3. collision avec le décor : la sphère est repoussée hors de la matière, impulsion normale avec restitution 0,6 (sous
 *     `seuilRebond` de vitesse normale : contact sans rebond), impulsion tangentielle de Coulomb (μ = 0,35) qui transfère de l'élan
 *     entre la vitesse linéaire et le spin (inertie d'une sphère pleine, `0,4·m·r²`), amortissement de roulement façon Bullet ;
 *  4. plafonds de vitesse (60 m/s) et de vitesse angulaire (6 rad/s) ;
 *  5. rend le plus fort impact normal du pas (son et étincelles).
 *
 * Pas de tunnel : un pas est découpé en sous-pas pour que la balle ne parcoure jamais plus d'un demi-rayon par sous-pas (à 60 m/s et
 * 120 Hz : 2 sous-pas). La SDF étant exacte à moins d'un mètre des surfaces et un minorant sûr au-delà, la pénétration reste ≤ r/2
 * avant correction.
 *
 * Fidélité : gravité, restitution, frottement, plafonds, rayon, masse et amortissements sont [RL] ; l'amortissement de roulement
 * est une transcription de celui de Bullet (couple limité par `frottementRoulement × impulsion normale`), [~] pour le détail.
 *
 * Pur et déterministe : aucune horloge, aucun hasard. Boucle chaude sans allocation (tampons de module) : seul l'objet
 * `ImpactBalle` rendu lors d'un impact est alloué.
 *
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md (§4)
 */
import {
  BALLE,
  GRAVITE,
  PAS_S,
  type Arene,
  type CreerBalle,
  type EchantillonBalle,
  type EtatBalle,
  type PasBalle,
  type PredireBalle,
  type Vec3,
} from "./contrat";

/** Au plus ce nombre de sous-pas par appel de `pasBalle` (garde-fou si `dt` est très grand, par exemple une prévision grossière). */
const SOUS_PAS_MAX = 16;
/** Corrections de position successives par sous-pas (coins : deux surfaces peuvent pousser la balle l'une après l'autre). */
const ITERATIONS_CONTACT = 3;
/** Un sous-pas ne déplace pas la balle de plus de cette part du rayon. */
const FRACTION_RAYON_PAR_SOUS_PAS = 0.5;

const R = BALLE.rayon;
/** Coefficient de la vitesse tangentielle de contact vers l'impulsion qui l'annule : `1 / (1/m + R²/I) = m / (1 + 1/0,4)`. */
const FACTEUR_TANGENT = 1 / (1 + 1 / BALLE.facteurInertie);
const LN_AMORT_LIN = Math.log(1 - BALLE.amortissementLineaire);
const LN_AMORT_ANG = Math.log(1 - BALLE.amortissementAngulaire);

/** Normale unitaire du contact en cours (sortie de `sdNormale`). */
const N: Vec3 = [0, 0, 0];
/** Normale du dernier contact du sous-pas, pour l'amortissement de roulement. */
const NC: Vec3 = [0, 0, 0];

/** Balle au repos au centre du terrain (ou en `p`), sans toucheur. */
export const creerBalle: CreerBalle = (p) => ({
  p: p ? [p[0], p[1], p[2]] : [0, BALLE.hauteurEngagement, 0],
  v: [0, 0, 0],
  w: [0, 0, 0],
  dernierToucheur: null,
  avantDernierToucheur: null,
});

/** Résultat des contacts d'un sous-pas (tampon de module, réinitialisé à chaque sous-pas). */
interface BilanContact {
  /** meilleure vitesse normale d'impact (rebonds seulement), 0 sinon */
  vitesse: number;
  point: Vec3;
  normale: Vec3;
  /** impulsion normale cumulée par unité de masse (m/s) : sert au frottement de roulement */
  jn: number;
  contact: boolean;
}
const bilan: BilanContact = { vitesse: 0, point: [0, 0, 0], normale: [0, 1, 0], jn: 0, contact: false };

/**
 * Résout les contacts de la balle avec le décor pour un sous-pas : séparation, impulsion normale, frottement de Coulomb.
 * Remplit `bilan` (meilleur impact, impulsion normale cumulée).
 */
function resoudreContacts(a: Arene, b: EtatBalle): void {
  const p = b.p, v = b.v, w = b.w;
  for (let it = 0; it < ITERATIONS_CONTACT; it++) {
    const sd = a.sdNormale(p, N);
    const pen = R - sd;
    if (pen <= 0) return;

    // 1. Séparation le long de la normale.
    p[0] += N[0] * pen; p[1] += N[1] * pen; p[2] += N[2] * pen;
    bilan.contact = true;
    NC[0] = N[0]; NC[1] = N[1]; NC[2] = N[2];

    // 2. Impulsion normale (la vitesse du point de contact a la même composante normale que le centre : w × r est tangent).
    const vn = v[0] * N[0] + v[1] * N[1] + v[2] * N[2];
    if (vn >= 0) continue; // la balle s'éloigne déjà
    const rebond = -vn > BALLE.seuilRebond;
    const jn = rebond ? -(1 + BALLE.restitution) * vn : -vn; // par unité de masse
    v[0] += N[0] * jn; v[1] += N[1] * jn; v[2] += N[2] * jn;
    bilan.jn += jn;
    if (rebond && -vn > bilan.vitesse) {
      bilan.vitesse = -vn;
      bilan.point[0] = p[0] - N[0] * R; bilan.point[1] = p[1] - N[1] * R; bilan.point[2] = p[2] - N[2] * R;
      bilan.normale[0] = N[0]; bilan.normale[1] = N[1]; bilan.normale[2] = N[2];
    }

    // 3. Frottement de Coulomb au point de contact : r = -N·R, vc = v + w × r, vt = vc - (vc·N)N.
    const rx = -N[0] * R, ry = -N[1] * R, rz = -N[2] * R;
    const cx = v[0] + (w[1] * rz - w[2] * ry);
    const cy = v[1] + (w[2] * rx - w[0] * rz);
    const cz = v[2] + (w[0] * ry - w[1] * rx);
    const cn = cx * N[0] + cy * N[1] + cz * N[2];
    const tx = cx - N[0] * cn, ty = cy - N[1] * cn, tz = cz - N[2] * cn;
    const vt = Math.hypot(tx, ty, tz);
    if (vt < 1e-9) continue;
    const jt = Math.min(vt * FACTEUR_TANGENT, BALLE.frottement * jn); // par unité de masse
    const ux = tx / vt, uy = ty / vt, uz = tz / vt;
    v[0] -= ux * jt; v[1] -= uy * jt; v[2] -= uz * jt;
    // Δw = (r × (−jt·m·û)) / I = jt · (N × û) / (0,4·R)
    const k = jt / (BALLE.facteurInertie * R);
    w[0] += k * (N[1] * uz - N[2] * uy);
    w[1] += k * (N[2] * ux - N[0] * uz);
    w[2] += k * (N[0] * uy - N[1] * ux);
  }
}

/** Amortissement de roulement : réduit la part du spin tangente à la surface, d'au plus `μr·jn/(0,4·R)` rad/s. */
function amortirRoulement(b: EtatBalle): void {
  const w = b.w;
  const wn = w[0] * NC[0] + w[1] * NC[1] + w[2] * NC[2];
  const tx = w[0] - NC[0] * wn, ty = w[1] - NC[1] * wn, tz = w[2] - NC[2] * wn;
  const t = Math.hypot(tx, ty, tz);
  if (t < 1e-12) return;
  const reduction = (BALLE.frottementRoulement * bilan.jn) / (BALLE.facteurInertie * R);
  const f = Math.max(0, 1 - reduction / t);
  // w = composante normale + composante tangente × f
  w[0] = NC[0] * wn + tx * f; w[1] = NC[1] * wn + ty * f; w[2] = NC[2] * wn + tz * f;
}

/** Plafonds `vitesseMax` (linéaire) et `vitesseAngMax` (angulaire). */
function borner(b: EtatBalle): void {
  const v = b.v, w = b.w;
  const nv = Math.hypot(v[0], v[1], v[2]);
  if (nv > BALLE.vitesseMax) {
    const f = BALLE.vitesseMax / nv;
    v[0] *= f; v[1] *= f; v[2] *= f;
  }
  const nw = Math.hypot(w[0], w[1], w[2]);
  if (nw > BALLE.vitesseAngMax) {
    const f = BALLE.vitesseAngMax / nw;
    w[0] *= f; w[1] *= f; w[2] *= f;
  }
}

/**
 * Avance la balle de `dt` secondes (≤ `PAS_S` en jeu) contre le décor `a`. Rend le plus fort impact du pas (vitesse normale
 * > `BALLE.seuilRebond`) ou null : les contacts doux (roulement, repos) ne sont pas des impacts.
 */
export const pasBalle: PasBalle = (a, b, dt) => {
  if (!(dt > 0)) return null;
  const vit = Math.hypot(b.v[0], b.v[1], b.v[2]) + GRAVITE * dt;
  const n = Math.min(SOUS_PAS_MAX, Math.max(1, Math.ceil((vit * dt) / (FRACTION_RAYON_PAR_SOUS_PAS * R))));
  const h = dt / n;
  const facLin = Math.exp(LN_AMORT_LIN * h), facAng = Math.exp(LN_AMORT_ANG * h);

  let vitesse = 0;
  let px = 0, py = 0, pz = 0, nx = 0, ny = 1, nz = 0;
  const p = b.p, v = b.v, w = b.w;

  for (let i = 0; i < n; i++) {
    // gravité puis amortissements
    v[1] -= GRAVITE * h;
    v[0] *= facLin; v[1] *= facLin; v[2] *= facLin;
    w[0] *= facAng; w[1] *= facAng; w[2] *= facAng;
    // position (semi-implicite : avec la vitesse déjà mise à jour)
    p[0] += v[0] * h; p[1] += v[1] * h; p[2] += v[2] * h;

    bilan.vitesse = 0; bilan.jn = 0; bilan.contact = false;
    resoudreContacts(a, b);
    if (bilan.contact) {
      amortirRoulement(b);
      if (bilan.vitesse > vitesse) {
        vitesse = bilan.vitesse;
        px = bilan.point[0]; py = bilan.point[1]; pz = bilan.point[2];
        nx = bilan.normale[0]; ny = bilan.normale[1]; nz = bilan.normale[2];
      }
    }
    borner(b);
  }

  return vitesse > 0 ? { vitesse, point: [px, py, pz], normale: [nx, ny, nz] } : null;
};

/**
 * Prévision de la trajectoire de la balle SEULE (aucune voiture) : copie `b`, la fait évoluer au pas `PAS_S` et rend un échantillon
 * tous les `pasS` secondes (arrondi au nombre entier de pas physiques, 30 Hz par défaut), le premier à `t = 0` (état courant). `b`
 * n'est jamais modifié. Rend `floor(dureeS / pas) + 1` échantillons.
 */
export const predireBalle: PredireBalle = (a, b, dureeS, pasS = 1 / 30) => {
  const copie: EtatBalle = {
    p: [b.p[0], b.p[1], b.p[2]],
    v: [b.v[0], b.v[1], b.v[2]],
    w: [b.w[0], b.w[1], b.w[2]],
    dernierToucheur: null,
    avantDernierToucheur: null,
  };
  const pasParEchantillon = Math.max(1, Math.round(pasS / PAS_S));
  const nbEchantillons = Math.floor(Math.max(0, dureeS) / (pasParEchantillon * PAS_S) + 1e-9);
  const sortie: EchantillonBalle[] = [];
  for (let e = 0; e <= nbEchantillons; e++) {
    sortie.push({
      t: e * pasParEchantillon * PAS_S,
      p: [copie.p[0], copie.p[1], copie.p[2]],
      v: [copie.v[0], copie.v[1], copie.v[2]],
    });
    if (e === nbEchantillons) break;
    for (let i = 0; i < pasParEchantillon; i++) pasBalle(a, copie, PAS_S);
  }
  return sortie;
};
