/**
 * Rendu des deux vendeuses du Truck Muche (three) : Elsa (toque de cuisinière, couette, ambre) et la patronne (chignon, lunettes, tablier, rose), deux figures
 * filaires articulées, plus l'habitacle de la cabine (sièges, volant) pour le Truck fou où elles sont assises aux commandes. La figure d'Elsa est celle du
 * Truck garé de la v2 (mêmes pièces, mêmes proportions) ; la pose vient de `vendeuses.ts` (PUR, testé) : debout au comptoir ou assise, les bras par
 * cinématique inverse (`ikBras`), le torse et la tête inclinés. Aucun test vitest (three) : les régressions se voient aux captures.
 * Chaque figure possède ses géométries et ses matériaux : `dispose()` les libère, rien n'est partagé entre deux figures.
 * Spec : docs/superpowers/specs/2026-10-30-arene-police-evenements-design.md (§ « Truck fou et vendeuses »)
 */
import * as THREE from "three";
import { boite, creerMateriaux, enPiece, libererMateriaux, libererPiece, nu, piece } from "./rendu-filaire";
import { CABINE, FIGURE, epaule as epauleDe, ikBras, versRepereTorse, type PoseFigure, type VendeuseId } from "./vendeuses";

export const COULEURS_VENDEUSES: Readonly<Record<VendeuseId, number>> = { elsa: 0xffb35c, patronne: 0xff7fb0 };

export interface OptionsFigure {
  vendeuse: VendeuseId;
  /** échelle de toute la figure (0,9 au comptoir, `CABINE.echelle` assise) */
  echelle: number;
}

/** Une figure articulée posée par `appliquer(pose)`. L'origine du groupe `racine` est au sol, sous le bassin (debout) ; l'avant de la figure est −z. */
export interface Figure {
  racine: THREE.Group;
  /** centre des mains gauche et droite (au bout des avant-bras) : où la figure tient ce qu'elle tient */
  mains: [THREE.Object3D, THREE.Object3D];
  appliquer(pose: PoseFigure): void;
  dispose(): void;
}

const BAS = new THREE.Vector3(0, -1, 0);

export function creerFigure(parent: THREE.Object3D, o: OptionsFigure): Figure {
  const patronne = o.vendeuse === "patronne";
  const m = creerMateriaux(new THREE.Color(COULEURS_VENDEUSES[o.vendeuse]));
  const pieces = {
    bassin: enPiece(nu(boite(patronne ? 0.42 : 0.38, 0.18, 0.24))),
    cuisse: enPiece(nu(boite(0.15, 0.43, 0.16, 0, -0.215, 0))),
    mollet: enPiece(nu(boite(0.12, 0.43, 0.13, 0, -0.215, 0))),
    pied: enPiece(nu(boite(0.12, 0.07, 0.26))),
    torse: enPiece(nu(patronne ? boite(0.52, 0.5, 0.3, 0, 0.25, 0) : boite(0.46, 0.48, 0.26, 0, 0.24, 0))),
    tete: enPiece(new THREE.IcosahedronGeometry(patronne ? 0.19 : 0.18, 1)),
    brasHaut: enPiece(nu(boite(0.1, 0.35, 0.1, 0, -0.175, 0))),
    brasBas: enPiece(nu(boite(0.08, 0.35, 0.08, 0, -0.175, 0))),
    main: enPiece(nu(boite(0.09, 0.09, 0.09))),
    // Elsa : visière, toque de cuisinière, couette ; la patronne : chignon, lunettes, tablier
    visiere: enPiece(nu(boite(0.2, 0.05, 0.05))),
    toque: enPiece(nu(new THREE.CylinderGeometry(0.15, 0.12, 0.24, 8, 1, false))),
    queue: enPiece(nu(boite(0.07, 0.22, 0.07, 0, -0.11, 0))),
    chignon: enPiece(new THREE.IcosahedronGeometry(0.1, 0)),
    lunettes: enPiece(nu(boite(0.3, 0.07, 0.03))),
    tablier: enPiece(nu(boite(0.4, 0.4, 0.03))),
  };

  const racine = new THREE.Group();
  racine.scale.setScalar(o.echelle);
  parent.add(racine);

  const corps = new THREE.Group(); // hanches à 0,9 m
  corps.position.y = FIGURE.hanches;
  racine.add(corps);
  piece(corps, pieces.bassin, m);
  const hanches: THREE.Group[] = [], genoux: THREE.Group[] = [];
  for (const x of [-0.1, 0.1]) {
    const hanche = new THREE.Group();
    hanche.position.set(x, 0, 0);
    corps.add(hanche);
    piece(hanche, pieces.cuisse, m);
    const genou = new THREE.Group();
    genou.position.y = -FIGURE.cuisse;
    hanche.add(genou);
    piece(genou, pieces.mollet, m);
    piece(genou, pieces.pied, m, 0, -FIGURE.mollet, -0.06);
    hanches.push(hanche);
    genoux.push(genou);
  }
  const torse = new THREE.Group();
  torse.position.y = FIGURE.torseDepuisHanches;
  corps.add(torse);
  piece(torse, pieces.torse, m);
  const tete = new THREE.Group();
  tete.position.y = FIGURE.teteDepuisTorse;
  torse.add(tete);
  piece(tete, pieces.tete, m, 0, 0.17, 0);
  if (patronne) {
    piece(tete, pieces.lunettes, m, 0, 0.2, -0.17);
    piece(tete, pieces.chignon, m, 0, 0.36, 0.1);
    piece(torse, pieces.tablier, m, 0, 0.2, -0.17);
  } else {
    piece(tete, pieces.visiere, m, 0, 0.19, -0.17);
    piece(tete, pieces.toque, m, 0, 0.45, 0);
    piece(tete, pieces.queue, m, 0, 0.28, 0.2);
  }
  const epaules: THREE.Group[] = [], coudes: THREE.Group[] = [], pointsMain: THREE.Object3D[] = [];
  for (const cote of [-1, 1]) {
    const ep = new THREE.Group();
    ep.position.set(cote * FIGURE.epauleX, FIGURE.epauleY, 0);
    torse.add(ep);
    piece(ep, pieces.brasHaut, m);
    const coude = new THREE.Group();
    coude.position.y = -FIGURE.brasHaut;
    ep.add(coude);
    piece(coude, pieces.brasBas, m);
    piece(coude, pieces.main, m, 0, -FIGURE.brasBas, 0);
    const pointMain = new THREE.Object3D();
    pointMain.position.set(0, -FIGURE.brasBas, 0);
    coude.add(pointMain);
    pointsMain.push(pointMain);
    epaules.push(ep);
    coudes.push(coude);
  }

  const qHaut = new THREE.Quaternion(), qInverse = new THREE.Quaternion();
  const vHaut = new THREE.Vector3(), vBas = new THREE.Vector3();

  return {
    racine,
    mains: [pointsMain[0], pointsMain[1]],
    appliquer(pose) {
      // jambes : debout, ou assise (cuisses vers l'avant, mollets à la verticale)
      const assise = pose.assise;
      for (let i = 0; i < 2; i++) {
        hanches[i].rotation.x = assise ? Math.PI / 2 : 0;
        genoux[i].rotation.x = assise ? -Math.PI / 2 : 0;
      }
      torse.rotation.set(pose.torse[0], pose.torse[1], pose.torse[2]);
      tete.rotation.set(pose.tete[0], pose.tete[1], pose.tete[2]);
      // bras : la main va sur la cible (repère du torse droit, ramenée dans celui du torse penché)
      for (let cote = 0 as 0 | 1; cote < 2; cote = (cote + 1) as 0 | 1) {
        const c = versRepereTorse(pose.mains[cote], pose.torse);
        const ep = epauleDe(cote);
        const ik = ikBras([c[0] - ep[0], c[1] - ep[1], c[2] - ep[2]], FIGURE.brasHaut, FIGURE.brasBas, [cote === 0 ? -0.3 : 0.3, -1, 0.35]);
        vHaut.set(ik.haut[0], ik.haut[1], ik.haut[2]);
        qHaut.setFromUnitVectors(BAS, vHaut);
        epaules[cote].quaternion.copy(qHaut);
        // l'avant-bras, exprimé dans le repère du bras
        qInverse.copy(qHaut).invert();
        vBas.set(ik.bas[0], ik.bas[1], ik.bas[2]).applyQuaternion(qInverse);
        coudes[cote].quaternion.setFromUnitVectors(BAS, vBas);
      }
    },
    dispose() {
      for (const p of Object.values(pieces)) libererPiece(p);
      libererMateriaux(m);
      racine.removeFromParent();
    },
  };
}

/** Pose une figure assise à l'`x` d'un siège de la cabine (repère du truck) : la hanche à `CABINE.assise.y` au-dessus du plancher. */
export function poserAssise(f: Figure, x: number): void {
  f.racine.position.set(x, CABINE.plancher + CABINE.assise.y - FIGURE.hanches * CABINE.echelle, CABINE.assise.z);
}

/** L'habitacle de la cabine : deux sièges et le volant. `volant` tourne avec le braquage ; `dispose` libère tout. */
export interface Habitacle {
  /** réglage du braquage (rad, + = à gauche) */
  braquer(angle: number): void;
  dispose(): void;
}

export function creerHabitacle(parent: THREE.Object3D, couleur: number): Habitacle {
  const m = creerMateriaux(new THREE.Color(couleur));
  const assise = enPiece(nu(boite(0.5, 0.3, 0.5)));
  const dossier = enPiece(nu(boite(0.5, 0.72, 0.1)));
  const anneau = enPiece(nu(new THREE.TorusGeometry(CABINE.volant.rayon, 0.018, 4, 14)));
  const rayon = enPiece(nu(boite(CABINE.volant.rayon * 2, 0.03, 0.03)));
  const moyeu = enPiece(nu(boite(0.08, 0.08, 0.06)));
  const groupe = new THREE.Group();
  parent.add(groupe);
  for (const x of [-CABINE.assise.x, CABINE.assise.x]) {
    // la hanche (centre du bassin) est à `assise.y` : le coussin affleure sous elle
    piece(groupe, assise, m, x, CABINE.plancher + 0.15, CABINE.assise.z);
    piece(groupe, dossier, m, x, CABINE.plancher + 0.3 + 0.36, CABINE.assise.z + 0.3);
  }
  // le volant : penché vers l'avant par le haut (`inclinaison`), l'anneau tourne dans son plan avec le braquage
  const inclinaison = new THREE.Group();
  inclinaison.position.set(CABINE.volant.x, CABINE.volant.y, CABINE.volant.z);
  inclinaison.rotation.x = -CABINE.volant.inclinaison;
  groupe.add(inclinaison);
  const tourne = new THREE.Group();
  inclinaison.add(tourne);
  piece(tourne, anneau, m);
  piece(tourne, rayon, m);
  piece(tourne, moyeu, m);
  return {
    braquer(angle) { tourne.rotation.z = angle; },
    dispose() {
      for (const p of [assise, dossier, anneau, rayon, moyeu]) libererPiece(p);
      libererMateriaux(m);
      groupe.removeFromParent();
    },
  };
}
