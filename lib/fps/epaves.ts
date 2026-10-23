/**
 * Voitures qui explosent (PUR, v3 §4) : une voiture (PNJ ou conduisible) encaisse les balles ; sous la moitié de sa carrosserie elle
 * fume, sous le cinquième elle brûle, à zéro elle EXPLOSE : souffle qui tue de près et blesse jusqu'à `rayonSouffle`, voitures voisines
 * abîmées (réaction en chaîne possible), épave qui reste un moment à l'endroit de l'explosion, puis la voiture revient (la PNJ reprend
 * son circuit, la conduisible réapparaît à sa place de parking).
 *
 * Partagé client (rayon contre la caisse d'une voiture, pour savoir si une balle s'y arrête) et serveur (validation, PV, épaves).
 * Aucune horloge ni hasard globaux : l'instant est toujours un paramètre.
 * Spec : docs/superpowers/specs/2026-10-23-arene-v3-design.md (§4)
 */
import { VOITURE } from "./circulation";
import type { EtatVoitureMsg, GenreVoiture, Vec3 } from "./protocole";

export const CARROSSERIE = {
  /** PV d'une voiture : ≈ 2 chargeurs de mitraillette, 5 balles de sniper */
  pv: 450,
  /** sous cette part des PV : fumée, puis feu */
  seuilFumee: 0.5,
  seuilFeu: 0.2,
  /** souffle : dégâts pleins jusqu'à `rayonMortel`, nuls à `rayonSouffle` (m, du centre de la voiture au centre du joueur) */
  rayonMortel: 3,
  rayonSouffle: 8,
  /** au-delà du bouclier plein (100 + 100) : à moins de 3 m, on meurt */
  degatsMax: 220,
  /** voitures voisines : dégâts pleins à 0 m, nuls à `rayonVoisines` */
  rayonVoisines: 7,
  degatsVoisines: 400,
  /** durée de l'épave avant le retour de la voiture (ms) */
  epavePnjMs: 20_000,
  epaveVehiculeMs: 15_000,
  /** marge (m) ajoutée à la caisse pour valider une touche déclarée (latence, arrondis) */
  margeValidation: 0.8,
} as const;

export interface RefVoiture { genre: GenreVoiture; id: number }
export const cleVoiture = (r: RefVoiture): string => `${r.genre}:${r.id}`;

export type EtatCarrosserie = "intact" | "fumee" | "feu";

/** État visible d'une carrosserie selon ses PV restants. */
export function etatCarrosserie(pv: number): EtatCarrosserie {
  if (pv <= CARROSSERIE.pv * CARROSSERIE.seuilFeu) return "feu";
  if (pv <= CARROSSERIE.pv * CARROSSERIE.seuilFumee) return "fumee";
  return "intact";
}

/** Dégâts du souffle à `distance` m du centre de la voiture : `degatsMax` jusqu'à `rayonMortel`, linéaire jusqu'à 0 à `rayonSouffle`. */
export function degatsSouffle(distance: number): number {
  const { rayonMortel, rayonSouffle, degatsMax } = CARROSSERIE;
  if (!(distance < rayonSouffle)) return 0;
  if (distance <= rayonMortel) return degatsMax;
  return Math.round(degatsMax * (1 - (distance - rayonMortel) / (rayonSouffle - rayonMortel)));
}

/** Dégâts infligés par une explosion à une voiture voisine dont le centre est à `distance` m. */
export function degatsVoisine(distance: number): number {
  const { rayonVoisines, degatsVoisines } = CARROSSERIE;
  if (!(distance < rayonVoisines)) return 0;
  return Math.round(degatsVoisines * (1 - distance / rayonVoisines));
}

/**
 * Distance le long du rayon (`o`, direction normalisée `d`) jusqu'à la caisse d'une voiture (centre au sol `p`, `cap` convention lacet,
 * avant = −z local), ou null si le rayon la manque avant `max`. `marge` agrandit la caisse de tous côtés. Méthode des dalles dans le repère
 * de la voiture ; un rayon qui part de l'intérieur touche à 0.
 */
export function rayonVoiture(o: Vec3, d: Vec3, p: Vec3, cap: number, max: number, marge = 0): number | null {
  const c = Math.cos(cap), s = Math.sin(cap);
  // monde → local : inverse de rotation.y = cap
  const rx = o[0] - p[0], ry = o[1] - p[1], rz = o[2] - p[2];
  const ox = rx * c - rz * s, oz = rx * s + rz * c, oy = ry;
  const dx = d[0] * c - d[2] * s, dz = d[0] * s + d[2] * c, dy = d[1];
  const hx = VOITURE.largeur / 2 + marge, hz = VOITURE.longueur / 2 + marge;
  const min = [-hx, 0.25 - marge, -hz], mx = [hx, VOITURE.hauteur + marge, hz];
  const or = [ox, oy, oz], dr = [dx, dy, dz];
  let t0 = 0, t1 = max;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dr[k]) < 1e-12) {
      if (or[k] < min[k] || or[k] > mx[k]) return null;
      continue;
    }
    let a = (min[k] - or[k]) / dr[k], b = (mx[k] - or[k]) / dr[k];
    if (a > b) { const x = a; a = b; b = x; }
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

/** Une épave : où la voiture a explosé et jusqu'à quand (horloge serveur, ms). */
export interface Epave { p: Vec3; cap: number; finT: number }

/**
 * PV des carrosseries et épaves (logique serveur). Les voitures sont identifiées par `RefVoiture` ; une voiture jamais touchée a ses PV
 * pleins et n'occupe aucune entrée. `toucher` renvoie si l'état visible a changé (fumée, feu) et si la voiture vient d'exploser.
 */
export class Carrosseries {
  private readonly pv = new Map<string, number>();
  private readonly epaves = new Map<string, { ref: RefVoiture; epave: Epave }>();

  /** Voiture en épave à cet instant (ni touchable, ni conduisible, ni dangereuse). */
  detruite(ref: RefVoiture): boolean {
    return this.epaves.has(cleVoiture(ref));
  }

  pvDe(ref: RefVoiture): number {
    return this.pv.get(cleVoiture(ref)) ?? CARROSSERIE.pv;
  }

  /**
   * `degats` sur la voiture ; si elle tombe à 0 elle devient une épave en `etat` (position de l'explosion) jusqu'à
   * `maintenant + durée` (PNJ 20 s, conduisible 15 s). Sans effet sur une épave ou pour des dégâts nuls.
   */
  toucher(ref: RefVoiture, degats: number, maintenant: number, etat: { p: Vec3; cap: number }): { change: boolean; detruite: boolean } {
    const cle = cleVoiture(ref);
    if (this.epaves.has(cle) || !(degats > 0)) return { change: false, detruite: false };
    const avant = this.pvDe(ref);
    const apres = Math.max(0, avant - degats);
    if (apres <= 0) {
      this.pv.delete(cle);
      const duree = ref.genre === "pnj" ? CARROSSERIE.epavePnjMs : CARROSSERIE.epaveVehiculeMs;
      this.epaves.set(cle, { ref, epave: { p: [etat.p[0], etat.p[1], etat.p[2]], cap: etat.cap, finT: maintenant + duree } });
      return { change: true, detruite: true };
    }
    this.pv.set(cle, apres);
    return { change: etatCarrosserie(apres) !== etatCarrosserie(avant), detruite: false };
  }

  /** Épaves arrivées à échéance : retirées (la voiture revient neuve), renvoyées pour que l'appelant la remette en place. */
  tic(maintenant: number): RefVoiture[] {
    const fin: RefVoiture[] = [];
    for (const [cle, e] of this.epaves) {
      if (maintenant < e.epave.finT) continue;
      this.epaves.delete(cle);
      fin.push(e.ref);
    }
    return fin;
  }

  /** État complet diffusé aux clients : voitures abîmées (fumée, feu) et épaves. Trié (genre, id) : stable d'un appel à l'autre. */
  etats(): EtatVoitureMsg[] {
    const r: EtatVoitureMsg[] = [];
    for (const [cle, pv] of this.pv) {
      const etat = etatCarrosserie(pv);
      if (etat === "intact") continue;
      const [genre, id] = cle.split(":");
      r.push({ genre: genre as GenreVoiture, id: Number(id), etat });
    }
    for (const { ref, epave } of this.epaves.values()) {
      r.push({ genre: ref.genre, id: ref.id, etat: "epave", p: [...epave.p] as Vec3, cap: epave.cap, finT: epave.finT });
    }
    return r.sort((a, b) => (a.genre === b.genre ? a.id - b.id : a.genre < b.genre ? -1 : 1));
  }

  /** Nouveau match : toutes les voitures neuves, plus aucune épave. */
  reinitialiser(): void {
    this.pv.clear();
    this.epaves.clear();
  }
}
