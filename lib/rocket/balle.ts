/**
 * Rocket Muche : physique de la balle (module B).
 *
 * La balle est une sphère de rayon `BALLE.rayon` qui rebondit sur la SDF du stade (`Arene`). Le pas suit l'ordre de RocketSim (pas de
 * Bullet + contact « spécial » balle / décor de btSequentialImpulseConstraintSolver ; constantes dans `contrat.ts`, valeurs d'origine
 * citées là-bas) :
 *  0. une balle dont la vitesse ET le spin sont exactement nuls dort (Arena::Step, « ball zero-vel sleeping ») : ni gravité ni
 *     mouvement, elle plane à l'engagement jusqu'à ce qu'une voiture lui donne une vitesse ;
 *  1. traînée linéaire `v ← v·(1 - 0,03)^dt` (Bullet applyDamping) ; AUCUN amortissement angulaire, aucun frottement de roulement ;
 *  2. contact détecté sur la position du DÉBUT du pas, dès que la surface de la balle est à moins de `BALLE.margeContact` (1,905 cm)
 *     de la matière ; la vitesse normale d'approche est lue ici, avant la gravité ;
 *  3. gravité ;
 *  4. réponse du contact, EN VITESSE SEULEMENT (RocketSim ne corrige jamais la position de la balle contre le décor) : UNE impulsion
 *     normale qui amène la vitesse normale à `0,6 × vitesse d'approche` (0 sous `seuilRebond`), puis UNE impulsion tangentielle de
 *     Coulomb (μ = 0,35, bornée par μ × l'impulsion normale) qui transfère de l'élan entre la vitesse linéaire et le spin (inertie
 *     d'une sphère pleine, `0,4·m·r²`) ;
 *  5. intégration de la position avec la nouvelle vitesse ;
 *  6. plafonds de vitesse (60 m/s) et de vitesse angulaire (6 rad/s) ;
 *  7. rend l'impact normal du pas (son et étincelles).
 *
 * Conséquences voulues, celles de Rocket League : la balle s'enfonce dans le décor de `vitesse × dt` au plus (50 cm à 60 m/s) et en
 * ressort par sa seule vitesse de rebond ; au repos elle se pose entre son rayon et son rayon + 1,9 cm ; une balle qui roule sans
 * glisser ne ralentit plus que par la traînée.
 *
 * Pas de tunnel : le stade est une cavité sans paroi mince et un pas de 1/120 s déplace la balle de 0,5 m au plus, moins que son
 * rayon : le centre reste dans l'espace libre, la SDF garde le bon signe. Un `dt` plus long que `PAS_S` est découpé en pas de `PAS_S`
 * au plus. Garde-fou [~] absent de RocketSim (son solveur résout ensemble voiture ↔ balle et balle ↔ décor, le nôtre les enchaîne) :
 * si la balle est plus enfoncée que sa propre vitesse ne peut l'expliquer (poussée par une voiture, coin vif), l'excédent est repoussé.
 *
 * Fidélité : tout est [RL] (RocketSim) sauf la normale, qui est le gradient unitaire de la SDF et non la moyenne non normalisée des
 * triangles touchés du maillage de Rocket League, et le garde-fou ci-dessus.
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
  type BornerBalle,
  type CreerBalle,
  type EchantillonBalle,
  type EtatBalle,
  type PasBalle,
  type PredireBalle,
  type Vec3,
} from "./contrat";

/** Au plus ce nombre de pas internes par appel de `pasBalle` (garde-fou si `dt` est très grand, par exemple une prévision grossière). */
const SOUS_PAS_MAX = 16;

const R = BALLE.rayon;
/** Le contact existe tant que le centre est à moins de ceci de la matière (rayon + seuil de rupture du contact de Bullet). */
const PORTEE_CONTACT = R + BALLE.margeContact;
/** Coefficient de la vitesse tangentielle de contact vers l'impulsion qui l'annule : `1 / (1/m + R²/I) = m / (1 + 1/0,4)`. */
const FACTEUR_TANGENT = 1 / (1 + 1 / BALLE.facteurInertie);
const LN_AMORT_LIN = Math.log(1 - BALLE.amortissementLineaire);
/**
 * Garde-fou [~] : enfoncement toléré au-delà de celui que la vitesse normale de la balle explique (`|vitesse normale| × dt /
 * restitution` : la profondeur d'entrée d'un rebond, et celle qui reste pendant qu'elle ressort). 1 cm.
 */
const TOLERANCE_ENFONCEMENT_M = 0.01;

/** Normale unitaire du contact en cours (sortie de `sdNormale`). */
const N: Vec3 = [0, 0, 0];

/** Balle au repos au centre du terrain (ou en `p`), sans toucheur. */
export const creerBalle: CreerBalle = (p) => ({
  p: p ? [p[0], p[1], p[2]] : [0, BALLE.hauteurEngagement, 0],
  v: [0, 0, 0],
  w: [0, 0, 0],
  dernierToucheur: null,
  avantDernierToucheur: null,
  vitesseEnAttente: [0, 0, 0],
});

/** Plafonds `vitesseMax` (linéaire) et `vitesseAngMax` (angulaire) : RocketSim Ball::_FinishPhysicsTick. */
export const bornerBalle: BornerBalle = (b) => {
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
};

/**
 * Avance la balle de `dt` secondes (`PAS_S` en jeu) contre le décor `a`. Rend le plus fort impact du pas (vitesse normale d'approche
 * ≥ `BALLE.seuilRebond`) ou null : les contacts doux (roulement, repos) ne sont pas des impacts.
 */
export const pasBalle: PasBalle = (a, b, dt) => {
  if (!(dt > 0)) return null;
  const p = b.p, v = b.v, w = b.w;
  // 0. balle endormie (RocketSim Arena::Step : vitesse et spin exactement nuls → ISLAND_SLEEPING, Bullet ne l'intègre plus)
  if (v[0] === 0 && v[1] === 0 && v[2] === 0 && w[0] === 0 && w[1] === 0 && w[2] === 0) return null;

  const n = Math.min(SOUS_PAS_MAX, Math.max(1, Math.ceil(dt / PAS_S - 1e-9)));
  const h = dt / n;
  const facLin = Math.exp(LN_AMORT_LIN * h);

  let vitesse = 0;
  let px = 0, py = 0, pz = 0, nx = 0, ny = 1, nz = 0;

  for (let i = 0; i < n; i++) {
    // 1. traînée (avant la gravité : v' = v·0,97^dt - g·dt)
    v[0] *= facLin; v[1] *= facLin; v[2] *= facLin;

    // 2. contact sur la position du début du pas ; vitesse normale d'approche AVANT la gravité (w × r est tangent : le point de
    //    contact a la même vitesse normale que le centre)
    const sd = a.sdNormale(p, N);
    const contact = sd < PORTEE_CONTACT;
    const vnAvant = contact ? v[0] * N[0] + v[1] * N[1] + v[2] * N[2] : 0;

    // 3. gravité
    v[1] -= GRAVITE * h;

    if (contact) {
      // 4a. impulsion normale : la vitesse normale visée est 0,6 × la vitesse d'approche, nulle sous le seuil (Bullet restitutionCurve),
      //     jamais d'impulsion qui retient la balle (borne basse 0 du solveur). Par unité de masse.
      const rebond = -vnAvant >= BALLE.seuilRebond;
      const cible = rebond ? -BALLE.restitution * vnAvant : 0;
      const jn = cible - (v[0] * N[0] + v[1] * N[1] + v[2] * N[2]);
      if (jn > 0) {
        v[0] += N[0] * jn; v[1] += N[1] * jn; v[2] += N[2] * jn;
        if (rebond && -vnAvant > vitesse) {
          vitesse = -vnAvant;
          px = p[0] - N[0] * sd; py = p[1] - N[1] * sd; pz = p[2] - N[2] * sd;
          nx = N[0]; ny = N[1]; nz = N[2];
        }

        // 4b. frottement de Coulomb au point de contact : r = -N·R, vc = v + w × r, vt = vc - (vc·N)N, borné par μ·jn.
        const rx = -N[0] * R, ry = -N[1] * R, rz = -N[2] * R;
        const cx = v[0] + (w[1] * rz - w[2] * ry);
        const cy = v[1] + (w[2] * rx - w[0] * rz);
        const cz = v[2] + (w[0] * ry - w[1] * rx);
        const cn = cx * N[0] + cy * N[1] + cz * N[2];
        const tx = cx - N[0] * cn, ty = cy - N[1] * cn, tz = cz - N[2] * cn;
        const vt = Math.hypot(tx, ty, tz);
        if (vt > 1e-9) {
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

      // garde-fou [~] (pas dans RocketSim) : enfoncement que la vitesse normale de la balle n'explique pas → l'excédent est repoussé
      const exces = R - sd - (Math.abs(vnAvant) * h) / BALLE.restitution - TOLERANCE_ENFONCEMENT_M;
      if (exces > 0) { p[0] += N[0] * exces; p[1] += N[1] * exces; p[2] += N[2] * exces; }
    }

    // 5. position (avec la vitesse résolue), 6. plafonds
    p[0] += v[0] * h; p[1] += v[1] * h; p[2] += v[2] * h;
    bornerBalle(b);
  }

  return vitesse > 0 ? { vitesse, point: [px, py, pz], normale: [nx, ny, nz] } : null;
};

/**
 * Prévision de la trajectoire de la balle SEULE (aucune voiture) : copie `b`, la fait évoluer au pas `PAS_S` et rend un échantillon
 * tous les `pasS` secondes (arrondi au nombre entier de pas physiques, 30 Hz par défaut), le premier à `t = 0` (état courant). `b`
 * n'est jamais modifié. Rend `floor(dureeS / pas) + 1` échantillons. Une balle endormie (vitesse et spin nuls, comme à l'engagement)
 * reste où elle est : c'est bien ce qu'elle fera tant qu'aucune voiture ne la touche.
 */
export const predireBalle: PredireBalle = (a, b, dureeS, pasS = 1 / 30) => {
  const copie: EtatBalle = {
    p: [b.p[0], b.p[1], b.p[2]],
    v: [b.v[0], b.v[1], b.v[2]],
    w: [b.w[0], b.w[1], b.w[2]],
    dernierToucheur: null,
    avantDernierToucheur: null,
    vitesseEnAttente: [0, 0, 0],
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
