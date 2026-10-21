/**
 * Mouvements secondaires (pur) : queue et oreilles en chaînes à ressort. La pose « cible » de la
 * chaîne (repos + allure + bruit + geste) est calculée par cinématique directe ; des points
 * massiques la suivent par un ressort amorti, simulés dans le repère qui accompagne la base de la
 * chaîne (le tigre qui court ne traîne pas sa queue d'un mètre) avec la pseudo-force due à
 * l'accélération de cette base (rebond du galop, freinage, demi-tour). Les os sont ensuite
 * orientés sur les points simulés. Sous-pas fixes de 1/120 s : même résultat à 30 ou 144 i/s.
 */
import { Quaternion, Vector3 } from "three";
import { fkOs, viserOs, type Monde, type PoseTigre, type Squelette } from "./squelette";
import type { Role } from "./os";

export interface Chaine {
  os: number[];
  /** Feuille au bout de la chaîne. */
  bout: number;
  longueurs: number[];
  /** Raideur (1/s²) et amortissement (1/s) de chaque point (le premier est la base, fixe). */
  raideur: number[];
  amorti: number[];
  /** Points simulés, relatifs à la base. */
  rel: Vector3[];
  vit: Vector3[];
  /** Base aux deux images précédentes (accélération). */
  base1: Vector3;
  base2: Vector3;
  init: number;
  reste: number;
  aLisse: Vector3;
  /** Rotation locale finale de chaque os à l'image précédente. */
  qPrec: Quaternion[];
}

export function creerChaine(sq: Squelette, roles: readonly Role[], bout: Role, raideur: [number, number], amortissement: number): Chaine {
  const os = roles.map((r) => sq.i[r]);
  const tous = [...os, sq.i[bout]];
  const n = tous.length;
  return {
    os, bout: sq.i[bout],
    longueurs: tous.slice(1).map((k, j) => sq.pModele[k].distanceTo(sq.pModele[tous[j]])),
    raideur: tous.map((_, j) => raideur[0] + (raideur[1] - raideur[0]) * (j / (n - 1))),
    amorti: tous.map((_, j) => amortissement * 2 * Math.sqrt(raideur[0] + (raideur[1] - raideur[0]) * (j / (n - 1)))),
    rel: tous.map(() => new Vector3()), vit: tous.map(() => new Vector3()),
    base1: new Vector3(), base2: new Vector3(), init: 0, reste: 0, aLisse: new Vector3(), qPrec: [],
  };
}

const cibles: Vector3[] = Array.from({ length: 12 }, () => new Vector3());
const acc = new Vector3(), d = new Vector3(), base = new Vector3(), aBase = new Vector3(), g = new Vector3();
const PAS = 1 / 120;

/**
 * Avance la chaîne de dt. `pose` contient la pose CIBLE de ses os ; `m` est à jour pour le parent
 * de la base. Les rotations des os de la chaîne sont remplacées par celles qui suivent les points
 * simulés, et `m` est mis à jour pour toute la chaîne. `inertie` (0..1) dose la pseudo-force,
 * `gravite` (m/s², vers -Y) tire légèrement les points vers le bas ; aucun point ne descend sous `sol`
 * (y du modèle : la queue ne traîne pas par terre).
 */
export function avancerChaine(
  c: Chaine, sq: Squelette, pose: PoseTigre, m: Monde, dt: number, inertie = 1, gravite = 0, sol = -Infinity,
): void {
  const tous = [...c.os, c.bout];
  for (const k of tous) fkOs(sq, pose, m, k);
  base.copy(m.p[tous[0]]);
  // Cibles au-dessus du sol (assis, la queue se pose par terre au lieu de s'y enfoncer).
  for (let j = 0; j < tous.length; j++) { cibles[j].copy(m.p[tous[j]]).sub(base); if (base.y + cibles[j].y < sol) cibles[j].y = sol - base.y; }
  if (c.init === 0 || dt <= 0) {
    for (let j = 0; j < tous.length; j++) { c.rel[j].copy(cibles[j]); c.vit[j].set(0, 0, 0); if (j && base.y + c.rel[j].y < sol) c.rel[j].y = sol - base.y; }
    c.base1.copy(base); c.base2.copy(base);
    c.init = dt > 0 ? 1 : 0;
  } else {
    // Accélération de la base (différences finies), bornée : un téléport ne fouette pas la queue.
    aBase.copy(base).sub(c.base1).sub(c.base1).add(c.base2).divideScalar(Math.max(dt * dt, 1e-6));
    if (c.init < 3) { aBase.set(0, 0, 0); c.init++; }
    if (aBase.length() > 40) aBase.setLength(40);
    // Accélération lissée (≈ 40 ms) : la différence finie d'une image à l'autre est bruitée.
    c.aLisse.lerp(aBase, 1 - Math.exp(-dt / 0.04));
    aBase.copy(c.aLisse);
    c.base2.copy(c.base1); c.base1.copy(base);
    g.set(0, -gravite, 0);
    c.reste += dt;
    let n = 0;
    while (c.reste >= PAS && n < 24) {
      c.reste -= PAS; n++;
      for (let j = 1; j < tous.length; j++) {
        acc.copy(cibles[j]).sub(c.rel[j]).multiplyScalar(c.raideur[j]);
        acc.addScaledVector(c.vit[j], -c.amorti[j]).addScaledVector(aBase, -inertie).add(g);
        c.vit[j].addScaledVector(acc, PAS);
        c.rel[j].addScaledVector(c.vit[j], PAS);
      }
      // Longueurs conservées (la base est fixe).
      for (let j = 1; j < tous.length; j++) {
        d.copy(c.rel[j]).sub(c.rel[j - 1]);
        const l = d.length() || 1e-6;
        c.rel[j].copy(c.rel[j - 1]).addScaledVector(d, c.longueurs[j - 1] / l);
        if (base.y + c.rel[j].y < sol) { c.rel[j].y = sol - base.y; if (c.vit[j].y < 0) c.vit[j].y = 0; }
      }
    }
    if (n === 24) c.reste = 0;
  }
  // Os orientés sur les points simulés, par une petite rotation depuis leur rotation de l'image
  // précédente (cohérence temporelle : pas de vrille quand la queue se couche par terre), ramenée
  // doucement vers la pose cible pour que la vrille ne dérive pas.
  for (let j = 0; j < c.os.length; j++) {
    const k = c.os[j];
    if (c.qPrec[j]) pose.q[k].copy(c.qPrec[j].slerp(pose.q[k], 0.03));
    d.copy(c.rel[j + 1]).sub(c.rel[j]);
    viserOs(sq, pose, m, k, d, true);
    (c.qPrec[j] ??= pose.q[k].clone()).copy(pose.q[k]);
  }
  fkOs(sq, pose, m, c.bout);
}
