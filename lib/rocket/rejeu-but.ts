/**
 * Rocket Muche : rejeu d'un but (PUR : aucun three, aucune horloge, aucun hasard).
 *
 * Pendant le jeu, `EnregistreurRejeu` garde dans un anneau les dernières secondes du match (position, orientation et vitesses de chaque
 * voiture et de la balle, un pas physique sur deux). Au but, `extraire` en tire un `ClipRejeu` : les secondes qui précèdent le but et
 * l'instant qui suit. La boucle du jeu rejoue ce clip avant le coup d'envoi, caméra en ball cam DERRIÈRE LE BUTEUR : on revoit le but
 * de son point de vue, comme dans Rocket League (avant, la « célébration » ne faisait que ralentir le jeu).
 *
 * Le clip ne dépend plus du monde : `poserImage` écrit une image du clip dans un monde « vue » (copie superficielle du vrai monde,
 * créée par `creerVueRejeu`) que le rendu dessine comme n'importe quel monde, interpolation comprise.
 */
import type { EtatBalle, EtatVoiture, MondeRocket } from "./contrat";
import { PAS_S } from "./contrat";
import { affecter, affecterBase, melanger, reorthonormaliser, type Base, type Vec3 } from "./vec";

export const REJEU = {
  /** durée gardée par l'anneau (s de jeu) */
  tamponS: 8,
  /** une image tous les `cadence` pas physiques (2 → 60 images/s) */
  cadence: 2,
  /** le clip commence au plus tôt ce temps avant le but (s) et s'arrête ce temps après (s) */
  avantS: 4.5,
  apresS: 0.9,
  /** vitesse de lecture avant le but, puis après (le ballon dans le filet, au ralenti) */
  vitesse: 1,
  vitesseApres: 0.45,
  /** un clip plus court que cela (but dès le coup d'envoi) n'est pas rejoué (s) */
  minimumS: 0.8,
} as const;

interface InstVoiture {
  p: Vec3; v: Vec3; w: Vec3; base: Base;
  normale: Vec3; aNormale: boolean;
  boost: number; boostActif: boolean; supersonique: boolean; demolie: boolean; auSol: boolean; derapage: boolean; rouesContact: number;
}
export interface ImageRejeu {
  /** temps de jeu de l'image (s, `MondeRocket.temps`) */
  t: number;
  voitures: InstVoiture[];
  balle: { p: Vec3; v: Vec3; w: Vec3 };
}
export interface ClipRejeu {
  images: ImageRejeu[];
  /** temps de jeu du but (s) */
  tBut: number;
  /** voiture suivie par la caméra (le buteur, sinon le dernier toucheur, sinon le joueur) */
  idCamera: number;
}

const v3 = (): Vec3 => [0, 0, 0];
const instVide = (): InstVoiture => ({
  p: v3(), v: v3(), w: v3(), base: { avant: [0, 0, 1], droite: [1, 0, 0], haut: [0, 1, 0] }, normale: [0, 1, 0], aNormale: false,
  boost: 0, boostActif: false, supersonique: false, demolie: false, auSol: false, derapage: false, rouesContact: 0,
});

function copierVoiture(dst: InstVoiture, v: Readonly<EtatVoiture>): void {
  affecter(dst.p, v.p); affecter(dst.v, v.v); affecter(dst.w, v.w); affecterBase(dst.base, v.base);
  dst.aNormale = v.normaleSurface !== null;
  if (v.normaleSurface) affecter(dst.normale, v.normaleSurface);
  dst.boost = v.boost; dst.boostActif = v.boostActif; dst.supersonique = v.supersonique; dst.demolie = v.demolie; dst.auSol = v.auSol;
  dst.derapage = v.derapage; dst.rouesContact = v.rouesContact;
}
const clonerImage = (im: Readonly<ImageRejeu>): ImageRejeu => ({
  t: im.t,
  voitures: im.voitures.map((v) => ({
    ...v, p: [...v.p] as Vec3, v: [...v.v] as Vec3, w: [...v.w] as Vec3, normale: [...v.normale] as Vec3,
    base: { avant: [...v.base.avant] as Vec3, droite: [...v.base.droite] as Vec3, haut: [...v.base.haut] as Vec3 },
  })),
  balle: { p: [...im.balle.p] as Vec3, v: [...im.balle.v] as Vec3, w: [...im.balle.w] as Vec3 },
});

/** Anneau des dernières secondes du match. Les images sont réutilisées : aucune allocation une fois l'anneau plein. */
export interface EnregistreurRejeu {
  /** à appeler après CHAQUE pas physique (il ne garde qu'un pas sur `REJEU.cadence`) */
  enregistrer(m: Readonly<MondeRocket>): void;
  /** oublie tout (coup d'envoi : les voitures viennent d'être replacées) */
  vider(): void;
  /** le clip du but marqué à `tBut` (copie indépendante de l'anneau), ou null s'il est trop court pour être rejoué */
  extraire(tBut: number, idCamera: number): ClipRejeu | null;
  /** nombre d'images gardées */
  taille(): number;
}

export function creerEnregistreurRejeu(): EnregistreurRejeu {
  const capacite = Math.ceil(REJEU.tamponS / (PAS_S * REJEU.cadence));
  const anneau: ImageRejeu[] = [];
  let debut = 0, n = 0;
  const image = (i: number): ImageRejeu => anneau[(debut + i) % capacite];
  return {
    enregistrer(m) {
      if (m.tick % REJEU.cadence !== 0) return;
      let im: ImageRejeu;
      if (n < capacite) {
        if (anneau.length < capacite) anneau.push({ t: 0, voitures: [], balle: { p: v3(), v: v3(), w: v3() } });
        im = anneau[(debut + n) % capacite];
        n++;
      } else {
        im = anneau[debut];
        debut = (debut + 1) % capacite;
      }
      im.t = m.temps;
      while (im.voitures.length < m.voitures.length) im.voitures.push(instVide());
      im.voitures.length = m.voitures.length;
      for (let i = 0; i < m.voitures.length; i++) copierVoiture(im.voitures[i], m.voitures[i]);
      affecter(im.balle.p, m.balle.p); affecter(im.balle.v, m.balle.v); affecter(im.balle.w, m.balle.w);
    },
    vider() { debut = 0; n = 0; },
    extraire(tBut, idCamera) {
      const images: ImageRejeu[] = [];
      for (let i = 0; i < n; i++) {
        const im = image(i);
        if (im.t >= tBut - REJEU.avantS - 1e-9 && im.t <= tBut + REJEU.apresS + 1e-9) images.push(clonerImage(im));
      }
      if (images.length < 2 || tBut - images[0].t < REJEU.minimumS) return null;
      return { images, tBut, idCamera: idCamera >= 0 && idCamera < images[0].voitures.length ? idCamera : 0 };
    },
    taille: () => n,
  };
}

/** Lecture d'un clip : `t` est le temps de jeu courant du rejeu. */
export interface LectureRejeu { clip: ClipRejeu; t: number; fini: boolean }

export const lancerLecture = (clip: ClipRejeu): LectureRejeu => ({ clip, t: clip.images[0].t, fini: false });

/** Durée réelle (s) de la lecture complète d'un clip. */
export function dureeLecture(clip: Readonly<ClipRejeu>): number {
  const t0 = clip.images[0].t, t1 = clip.images[clip.images.length - 1].t;
  const but = Math.min(Math.max(clip.tBut, t0), t1);
  return (but - t0) / REJEU.vitesse + (t1 - but) / REJEU.vitesseApres;
}

/** Avance la lecture de `dt` secondes réelles. Rend vrai à l'image où la lecture franchit l'instant du but (pour rejouer l'explosion). */
export function avancerLecture(l: LectureRejeu, dt: number): boolean {
  if (l.fini || !(dt > 0)) return false;
  const fin = l.clip.images[l.clip.images.length - 1].t;
  const avant = l.t;
  l.t += dt * (l.t < l.clip.tBut ? REJEU.vitesse : REJEU.vitesseApres);
  if (l.t >= fin) { l.t = fin; l.fini = true; }
  return avant < l.clip.tBut && l.t >= l.clip.tBut;
}

/** Indice `i` de l'image qui précède `t` et part `alpha` ∈ [0, 1] du chemin vers l'image `i + 1`. */
export function situer(clip: Readonly<ClipRejeu>, t: number): { i: number; alpha: number } {
  const ims = clip.images;
  let lo = 0, hi = ims.length - 1;
  if (t <= ims[0].t) return { i: 0, alpha: 0 };
  if (t >= ims[hi].t) return { i: hi - 1, alpha: 1 };
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ims[mid].t <= t) lo = mid; else hi = mid; }
  const d = ims[lo + 1].t - ims[lo].t;
  return { i: lo, alpha: d > 1e-9 ? (t - ims[lo].t) / d : 0 };
}

/**
 * Monde « vue » du rejeu : même arène, mêmes plots, même score que le vrai monde, mais ses propres voitures et sa propre balle, que
 * `poserImage` réécrit à chaque image. Le vrai monde n'est jamais touché.
 */
export function creerVueRejeu(m: Readonly<MondeRocket>): MondeRocket {
  const voiture = (v: Readonly<EtatVoiture>): EtatVoiture => ({
    ...v, p: [...v.p] as Vec3, v: [...v.v] as Vec3, w: [...v.w] as Vec3,
    base: { avant: [...v.base.avant] as Vec3, droite: [...v.base.droite] as Vec3, haut: [...v.base.haut] as Vec3 },
    normaleSurface: null, saut: { ...v.saut }, flip: { ...v.flip, dir: [...v.flip.dir] as [number, number] }, redressement: { ...v.redressement },
    stats: { ...v.stats }, figee: false,
  });
  const balle: EtatBalle = { ...m.balle, p: [...m.balle.p] as Vec3, v: [...m.balle.v] as Vec3, w: [...m.balle.w] as Vec3 };
  return {
    ...m,
    phase: "enJeu",
    voitures: m.voitures.map(voiture),
    balle,
    precedent: {
      voitures: m.voitures.map((v) => ({ p: [...v.p] as Vec3, base: { avant: [...v.base.avant] as Vec3, droite: [...v.base.droite] as Vec3, haut: [...v.base.haut] as Vec3 } })),
      balle: { p: [...m.balle.p] as Vec3 },
    },
  };
}

/**
 * Écrit dans `vue` l'état du clip à l'instant `t` : les voitures et la balle prennent l'image SUIVANTE, `precedent` l'image qui précède ;
 * la valeur rendue est l'`alpha` d'interpolation à passer au rendu (même convention que la boucle du jeu).
 */
export function poserImage(vue: MondeRocket, clip: Readonly<ClipRejeu>, t: number): number {
  const { i, alpha } = situer(clip, t);
  const a = clip.images[i], b = clip.images[i + 1];
  const n = Math.min(vue.voitures.length, a.voitures.length, b.voitures.length);
  for (let k = 0; k < n; k++) {
    const v = vue.voitures[k], ia = a.voitures[k], ib = b.voitures[k];
    affecter(v.p, ib.p); affecter(v.v, ib.v); affecter(v.w, ib.w); affecterBase(v.base, ib.base);
    v.normaleSurface = ib.aNormale ? ([...ib.normale] as Vec3) : null;
    v.boost = ib.boost; v.boostActif = ib.boostActif; v.supersonique = ib.supersonique; v.demolie = ib.demolie; v.auSol = ib.auSol;
    v.derapage = ib.derapage; v.rouesContact = ib.rouesContact;
    const pr = vue.precedent.voitures[k];
    if (pr) { affecter(pr.p, ia.p); affecterBase(pr.base, ia.base); }
  }
  affecter(vue.balle.p, b.balle.p); affecter(vue.balle.v, b.balle.v); affecter(vue.balle.w, b.balle.w);
  affecter(vue.precedent.balle.p, a.balle.p);
  vue.temps = t;
  return alpha;
}

/** Au-delà de ce déplacement entre deux images (m), la voiture a été replacée (réapparition) : pas d'interpolation. */
const SAUT_M = 3;

/** État interpolé d'une voiture de la vue (celui que la caméra doit suivre : sinon elle tremble par rapport à la voiture dessinée). */
export function voitureInterpolee(vue: Readonly<MondeRocket>, id: number, alpha: number): EtatVoiture {
  const v = vue.voitures[id], pr = vue.precedent.voitures[id];
  if (!pr || Math.hypot(v.p[0] - pr.p[0], v.p[1] - pr.p[1], v.p[2] - pr.p[2]) > SAUT_M) return v;
  return {
    ...v,
    p: melanger(pr.p, v.p, alpha),
    base: reorthonormaliser({ avant: melanger(pr.base.avant, v.base.avant, alpha), droite: melanger(pr.base.droite, v.base.droite, alpha), haut: melanger(pr.base.haut, v.base.haut, alpha) }),
  };
}
export function balleInterpolee(vue: Readonly<MondeRocket>, alpha: number): EtatBalle {
  const b = vue.balle, pb = vue.precedent.balle.p;
  if (Math.hypot(b.p[0] - pb[0], b.p[1] - pb[1], b.p[2] - pb[2]) > SAUT_M) return b;
  return { ...b, p: melanger(pb, b.p, alpha) };
}
