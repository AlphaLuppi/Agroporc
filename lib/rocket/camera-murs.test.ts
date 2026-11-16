/**
 * Caméra de Rocket Muche sur le VRAI stade (champ de distance de `arene.ts`) : murs, plafond, raccords, cage, en l'air.
 * La caméra ne doit jamais entrer dans la voiture, ni sortir du stade au-delà de ce que les parois translucides permettent.
 */
import { describe, expect, it } from "vitest";
import { CAMERA_DEFAUT, ENTREES_NULLES, PAS_S, STADE, type EntreesVoiture, type EtatBalle, type EtatVoiture, type PoseCamera } from "./contrat";
import {
  DEPASSEMENT_MUR_MAX_M, DISTANCE_MIN_M, ETIREMENT_MAX_M, HAUT_RACCORD_OPAQUE, HAUTEUR_MIN_M, MARGE_CAMERA_M, MARGE_PLAFOND_M,
  VITESSE_RACCROCHAGE, creerEtatCamera, distanceCameraCaisse, fovVerticalDepuisHorizontal, majCamera,
} from "./camera";
import { creerArene } from "./arene";
import { centreHitbox, creerVoiture, pasVoiture } from "./voiture";
import { baseDepuisCap, croix, distance, dot, mondeVersLocal, normaliser, soustraire, type Base, type Vec3 } from "./vec";

const arene = creerArene();
const D2R = Math.PI / 180;
const ASPECT = 16 / 9;
const demiV = (fovVerticalDepuisHorizontal(CAMERA_DEFAUT.fov, ASPECT) * D2R) / 2;

const balleA = (p: Vec3): EtatBalle => ({ p, v: [0, 0, 0], w: [0, 0, 0], dernierToucheur: null, avantDernierToucheur: null, vitesseEnAttente: [0, 0, 0] });
const ent = (balleCam: boolean) => ({ balleCam, regard: [0, 0] as [number, number], arriere: false });

/** Voiture posée sur une surface : `haut` = normale, `avant` donné (⟂ normale), origine à 0,17 m de la surface. */
function poser(point: Vec3, normale: Vec3, avant: Vec3): EtatVoiture {
  const v = creerVoiture({ id: 0, equipe: "bleue", slot: 0, humain: true, nom: "essai", p: [0, 0.17, 0], cap: 0 });
  const h = normaliser(normale);
  const f = normaliser(soustraire(avant, [h[0] * dot(avant, h), h[1] * dot(avant, h), h[2] * dot(avant, h)]));
  const base: Base = { avant: f, haut: h, droite: croix(f, h) };
  v.base = base;
  v.p = [point[0] + h[0] * 0.17, point[1] + h[1] * 0.17, point[2] + h[2] * 0.17];
  v.normaleSurface = h;
  v.auSol = true;
  v.rouesContact = 4;
  return v;
}

/** Point de la surface du stade le plus proche de `p` et sa normale (vers l'intérieur). */
function surface(p: Vec3): { point: Vec3; normale: Vec3 } {
  const s = arene.surfaceProche(p);
  return { point: s.point, normale: s.normale };
}

/** Angle (rad) entre l'axe de visée et la direction caméra → point. */
const ecartVisee = (pose: PoseCamera, point: Readonly<Vec3>): number =>
  Math.acos(Math.min(1, dot(normaliser(soustraire(pose.cible, pose.position)), normaliser(soustraire(point, pose.position)))));

/** Fait vivre la caméra `n` images de 1/60 s sur une voiture immobile. */
function stabiliser(moi: EtatVoiture, balle: EtatBalle, balleCam: boolean, n = 180): PoseCamera {
  const e = creerEtatCamera(moi, balle, balleCam);
  let pose = majCamera(e, CAMERA_DEFAUT, ent(balleCam), moi, balle, arene, 1 / 60, ASPECT, false);
  for (let i = 1; i < n; i++) pose = majCamera(e, CAMERA_DEFAUT, ent(balleCam), moi, balle, arene, 1 / 60, ASPECT, false);
  return pose;
}

/** Règles de position communes à toutes les images. */
function verifierPose(pose: PoseCamera, moi: EtatVoiture, quoi: string): void {
  expect(pose.position.every(Number.isFinite), quoi).toBe(true);
  expect(distanceCameraCaisse(pose, moi), `${quoi} : distance à la caisse`).toBeGreaterThanOrEqual(DISTANCE_MIN_M - 0.03);
  expect(pose.position[1], `${quoi} : sous le plafond`).toBeLessThanOrEqual(STADE.hauteur - MARGE_PLAFOND_M + 1e-6);
  expect(pose.position[1], `${quoi} : au-dessus du sol`).toBeGreaterThanOrEqual(HAUTEUR_MIN_M - 1e-6);
  const sd = arene.sd(pose.position);
  expect(sd, `${quoi} : jamais au-delà de ${DEPASSEMENT_MUR_MAX_M} m derrière une paroi`).toBeGreaterThanOrEqual(-DEPASSEMENT_MUR_MAX_M - 0.03);
  if (sd < MARGE_CAMERA_M - 0.05) {
    // près d'une paroi ou derrière elle : jamais derrière le sol ni son raccord, qui sont opaques
    const s = arene.surfaceProche(pose.position);
    if (sd < 0) expect(s.point[1], `${quoi} : derrière une paroi opaque`).toBeGreaterThanOrEqual(HAUT_RACCORD_OPAQUE - 0.05);
  }
}

// ============================================================================================================================

describe("caméra posée sur les murs et le plafond (vrai stade)", () => {
  // points du mur latéral x = +40,96, du mur du fond près de la cage, du pan coupé
  const murs: { nom: string; point: (h: number) => Vec3; normale: Vec3; long: Vec3 }[] = [
    { nom: "mur latéral", point: (h) => [STADE.demiLargeur, h, 5], normale: [-1, 0, 0], long: [0, 0, 1] },
    { nom: "mur du fond près de la cage", point: (h) => [14, h, STADE.demiLongueur], normale: [0, 0, -1], long: [1, 0, 0] },
    { nom: "pan coupé", point: (h) => [35.2, h, 45.44], normale: normaliser([-1, 0, -1]), long: normaliser([1, 0, -1]) },
  ];
  const hauteurs = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 5, 8, 12, 16, 18];
  const sens: [string, (n: Vec3, l: Vec3) => Vec3][] = [
    ["face au haut", () => [0, 1, 0]],
    ["face au bas", () => [0, -1, 0]],
    ["le long du mur", (_n, l) => l],
  ];
  for (const mur of murs) {
    for (const [nomSens, avant] of sens) {
      it(`${mur.nom}, ${nomSens} : jamais dans la voiture ni hors du stade, en car cam comme en ball cam`, () => {
        for (const h of hauteurs) {
          // point de la vraie surface (raccord de sol compris) à cette hauteur
          const s = surface(soustraire(mur.point(h), [mur.normale[0] * -0.5, 0, mur.normale[2] * -0.5]) as Vec3);
          if (Math.abs(s.normale[1]) > 0.98) continue; // au ras du sol : c'est le sol, pas le mur
          const moi = poser(s.point, s.normale, avant(s.normale, mur.long));
          for (const balleCam of [false, true]) {
            const balle = balleA([0, 1, 0]);
            const pose = stabiliser(moi, balle, balleCam);
            verifierPose(pose, moi, `${mur.nom} h=${h} ${nomSens} ${balleCam ? "ball cam" : "car cam"}`);
            // car cam : la voiture reste à l'écran ; ball cam : la balle d'abord (au pied du mur, sous le raccord opaque, aucune place du
            // stade ne garde les deux), la voiture aussi dès que la caméra peut passer derrière le mur translucide
            if (!balleCam || s.point[1] > HAUT_RACCORD_OPAQUE + 1.5) expect(ecartVisee(pose, centreHitbox(moi)), `${mur.nom} h=${h} ${nomSens} ${balleCam} : voiture à l'écran`).toBeLessThan(demiV);
            if (balleCam) expect(ecartVisee(pose, balle.p), `${mur.nom} h=${h} ${nomSens} : balle à l'écran`).toBeLessThan(demiV - 5 * D2R);
          }
        }
      });
    }
  }

  it("car cam sur un mur et au plafond : le haut de la caméra est la normale, la caméra derrière la voiture le long de la surface", () => {
    const cas: [string, EtatVoiture][] = [
      ["mur latéral", poser([STADE.demiLargeur, 8, 0], [-1, 0, 0], [0, 1, 0])],
      ["mur latéral, le long", poser([STADE.demiLargeur, 8, 0], [-1, 0, 0], [0, 0, 1])],
      ["plafond", poser([0, STADE.hauteur, 0], [0, -1, 0], [0, 0, 1])],
    ];
    for (const [nom, moi] of cas) {
      const pose = stabiliser(moi, balleA([0, 1, 0]), false, 60);
      expect(dot(pose.haut, moi.base.haut), nom).toBeGreaterThan(0.999);
      const loc = mondeVersLocal(moi.base, soustraire(pose.position, moi.p));
      expect(loc[0], nom).toBeCloseTo(-CAMERA_DEFAUT.distance, 1);
      expect(Math.abs(loc[1]), nom).toBeLessThan(0.05);
      expect(loc[2], nom).toBeCloseTo(CAMERA_DEFAUT.hauteur, 1);
    }
  });

  it("ball cam sur un mur, balle dans le terrain : horizon droit, voiture et balle à l'écran, au plus 1 m derrière le mur translucide", () => {
    for (const h of [4, 8, 12, 16]) {
      for (const avant of [[0, 1, 0], [0, 0, 1], [0, -1, 0]] as Vec3[]) {
        const moi = poser([STADE.demiLargeur, h, 0], [-1, 0, 0], avant);
        const balle = balleA([-10, 2, 15]);
        const pose = stabiliser(moi, balle, true);
        verifierPose(pose, moi, `h=${h}`);
        expect(pose.haut[1]).toBeGreaterThan(0.999);
        expect(ecartVisee(pose, balle.p), `h=${h} balle`).toBeLessThan(demiV - 5 * D2R);
        expect(ecartVisee(pose, centreHitbox(moi)), `h=${h} voiture`).toBeLessThan(demiV);
      }
    }
  });

  it("au plafond, en car cam comme en ball cam : sous le plafond, hors de la voiture", () => {
    for (const balleCam of [false, true]) {
      for (const [x, z] of [[0, 0], [20, 30], [-35, -40]]) {
        const moi = poser([x, STADE.hauteur, z], [0, -1, 0], [1, 0, 0]);
        const pose = stabiliser(moi, balleA([0, 1, 0]), balleCam);
        verifierPose(pose, moi, `plafond ${x},${z} ${balleCam}`);
      }
    }
  });

  it("dans la cage, dos au filet (marche arrière) : hors de la voiture, voiture à l'écran", () => {
    for (const balleCam of [false, true]) {
      const moi = poser([0, 0, STADE.demiLongueur + 7.5], [0, 1, 0], [0, 0, -1]);
      const pose = stabiliser(moi, balleA([0, 1, 0]), balleCam);
      verifierPose(pose, moi, `cage ${balleCam}`);
      expect(ecartVisee(pose, centreHitbox(moi))).toBeLessThan(demiV);
    }
  });

  it("dos à un mur sur le sol : la caméra glisse sur le raccord, ne rentre ni dans la voiture ni derrière le sol", () => {
    for (const balleCam of [false, true]) {
      const moi = poser([STADE.demiLargeur - 1, 0, 0], [0, 1, 0], [-1, 0, 0]);
      const pose = stabiliser(moi, balleA([-20, 1, 0]), balleCam);
      verifierPose(pose, moi, `dos au mur ${balleCam}`);
      expect(ecartVisee(pose, centreHitbox(moi))).toBeLessThan(demiV);
    }
  });
});

// ============================================================================================================================

interface Image { pose: PoseCamera; moi: EtatVoiture; haut: Vec3 }
/** Vraie course : la voiture part de x = 25 vers le mur x = +40,96, gaz et boost, monte le mur et va jusqu'au plafond. */
function course(balleCam: boolean, images = 330, entrees: (i: number) => Partial<EntreesVoiture> = () => ({ accel: 1, boost: true })): Image[] {
  const v = creerVoiture({ id: 0, equipe: "bleue", slot: 0, humain: true, nom: "essai", p: [25, 0.17, 0], cap: Math.PI / 2 });
  v.boost = 100;
  const balle = balleA([-20, 1, 10]);
  const e = creerEtatCamera(v, balle, balleCam);
  const out: Image[] = [];
  let tick = 0;
  for (let i = 0; i < images; i++) {
    const en = { ...ENTREES_NULLES(), ...entrees(i) };
    pasVoiture(arene, v, en, PAS_S, tick++);
    pasVoiture(arene, v, en, PAS_S, tick++);
    v.boost = 100;
    const pose = majCamera(e, CAMERA_DEFAUT, ent(balleCam), v, balle, arene, 1 / 60, ASPECT, false);
    out.push({ pose: structuredClone(pose), moi: structuredClone(v), haut: [...e.haut] as Vec3 });
  }
  return out;
}

describe("course réelle sol → mur → plafond", () => {
  for (const balleCam of [false, true]) {
    it(`${balleCam ? "ball cam" : "car cam"} : jamais dans la voiture, jamais hors des règles, aucun saut de caméra`, () => {
      const im = course(balleCam);
      // la voiture est vraiment montée sur le mur
      expect(Math.max(...im.map((x) => x.moi.p[1]))).toBeGreaterThan(8);
      for (let i = 0; i < im.length; i++) {
        verifierPose(im[i].pose, im[i].moi, `image ${i}`);
        if (i > 0) expect(distance(im[i].pose.position, im[i - 1].pose.position) - distance(im[i].moi.p, im[i - 1].moi.p), `saut à l'image ${i}`).toBeLessThan(0.6);
        if (balleCam) expect(ecartVisee(im[i].pose, [-20, 1, 10]), `image ${i} : balle à l'écran`).toBeLessThan(demiV - 5 * D2R);
        else expect(ecartVisee(im[i].pose, centreHitbox(im[i].moi)), `image ${i} : voiture à l'écran`).toBeLessThan(25 * D2R);
      }
    });
  }

  it("car cam : pendant le raccord sol → mur la caméra reste derrière la voiture (plus d'arc au-dessus d'elle), le haut suit la normale", () => {
    const im = course(false);
    const raccord = im.filter((x) => x.moi.auSol && x.moi.p[0] > 36 && x.moi.p[1] > 0.5 && x.moi.p[1] < 6);
    expect(raccord.length).toBeGreaterThan(5);
    for (const x of raccord) {
      const loc = mondeVersLocal(x.moi.base, soustraire(x.pose.position, x.moi.p));
      // la caméra glisse sur le sol (opaque) derrière la voiture : avant, elle passait à 2,8 m AU-DESSUS d'elle, 0,9 m derrière
      expect(loc[2], `haut local à y=${x.moi.p[1].toFixed(2)}`).toBeLessThan(2.3);
      expect(loc[0]).toBeLessThan(-1.9);
    }
    // sur le mur établi, le haut de la caméra est la normale du mur
    const mur = im.filter((x) => x.moi.auSol && x.moi.p[1] > 6 && Math.abs(x.moi.base.haut[0] + 1) < 0.02);
    expect(mur.length).toBeGreaterThan(5);
    for (const x of mur.slice(15)) expect(dot(x.haut, x.moi.base.haut)).toBeGreaterThan(0.99);
  });
});

// ============================================================================================================================

describe("réglages façon Rocket League", () => {
  it("car cam au sol : pose = p − avant·distance + haut·hauteur, voiture à ≈ 16,3° sous l'axe (le tangage EST l'angle)", () => {
    const moi = poser([0, 0, 0], [0, 1, 0], [0, 0, 1]);
    const pose = stabiliser(moi, balleA([0, 1, 30]), false, 60);
    expect(distance(pose.position, [moi.p[0], moi.p[1] + CAMERA_DEFAUT.hauteur, moi.p[2] - CAMERA_DEFAUT.distance])).toBeLessThan(0.01);
    const visee = normaliser(soustraire(pose.cible, pose.position));
    expect(Math.asin(visee[1]) / D2R).toBeCloseTo(CAMERA_DEFAUT.angle, 1);
    const versVoiture = normaliser(soustraire(moi.p, pose.position));
    expect((Math.asin(visee[1]) - Math.asin(versVoiture[1])) / D2R).toBeCloseTo(Math.atan(CAMERA_DEFAUT.hauteur / CAMERA_DEFAUT.distance) / D2R + CAMERA_DEFAUT.angle, 0);
  });

  it("rigidité = étirement de la distance avec la vitesse ; rigidité 1 : aucun ; vitesse nulle : il retombe", () => {
    const essai = (rigidite: number, vitesse: number, n = 240) => {
      const moi = poser([0, 0, 0], [0, 1, 0], [0, 0, 1]);
      moi.v = [0, 0, vitesse];
      const e = creerEtatCamera(moi, balleA([0, 1, 30]), false);
      let pose = majCamera(e, { ...CAMERA_DEFAUT, rigidite }, ent(false), moi, balleA([0, 1, 30]), arene, 1 / 60, ASPECT, false);
      for (let i = 0; i < n; i++) pose = majCamera(e, { ...CAMERA_DEFAUT, rigidite }, ent(false), moi, balleA([0, 1, 30]), arene, 1 / 60, ASPECT, false);
      return { recul: moi.p[2] - pose.position[2], e, moi };
    };
    expect(essai(0.45, 23).recul).toBeCloseTo(CAMERA_DEFAUT.distance + 0.55 * ETIREMENT_MAX_M, 1);
    expect(essai(0, 23).recul).toBeCloseTo(CAMERA_DEFAUT.distance + ETIREMENT_MAX_M, 1);
    expect(essai(1, 23).recul).toBeCloseTo(CAMERA_DEFAUT.distance, 2);
    expect(essai(0.45, 0).recul).toBeCloseTo(CAMERA_DEFAUT.distance, 2);
    // marche arrière : pas d'étirement
    expect(essai(0, -15).recul).toBeCloseTo(CAMERA_DEFAUT.distance, 2);
  });
});

describe("en l'air", () => {
  it("aérien nez à 45° : la visée reste à l'angle de la caméra (pas de suivi du tangage), le haut revient au monde", () => {
    const nez = 45 * D2R;
    const moi = creerVoiture({ id: 0, equipe: "bleue", slot: 0, humain: true, nom: "essai", p: [0, 8, 0], cap: 0 });
    moi.auSol = false; moi.normaleSurface = null; moi.rouesContact = 0;
    moi.base = { avant: [0, Math.sin(nez), Math.cos(nez)], haut: [0, Math.cos(nez), -Math.sin(nez)], droite: [-1, 0, 0] };
    const pose = stabiliser(moi, balleA([0, 1, 30]), false, 120);
    const visee = normaliser(soustraire(pose.cible, pose.position));
    expect(Math.abs(Math.asin(visee[1]) / D2R - CAMERA_DEFAUT.angle)).toBeLessThan(5);
    expect(pose.haut[1]).toBeGreaterThan(0.999);
    expect(visee[2]).toBeGreaterThan(0.9);
  });

  it("décollage d'un mur vers le haut (nez à la verticale) : direction finie et non nulle, la caméra regarde le terrain", () => {
    const moi = poser([STADE.demiLargeur, 10, 0], [-1, 0, 0], [0, 1, 0]);
    const e = creerEtatCamera(moi, balleA([0, 1, 0]), false);
    for (let i = 0; i < 60; i++) majCamera(e, CAMERA_DEFAUT, ent(false), moi, balleA([0, 1, 0]), arene, 1 / 60, ASPECT, false);
    const vol = structuredClone(moi);
    vol.auSol = false; vol.normaleSurface = null; vol.rouesContact = 0;
    vol.p = [STADE.demiLargeur - 1.5, 11, 0];
    vol.v = [-6, 5, 0]; // saut du mur : la voiture part vers le terrain
    let pose = majCamera(e, CAMERA_DEFAUT, ent(false), vol, balleA([0, 1, 0]), arene, 1 / 60, ASPECT, false);
    for (let i = 0; i < 120; i++) {
      pose = majCamera(e, CAMERA_DEFAUT, ent(false), vol, balleA([0, 1, 0]), arene, 1 / 60, ASPECT, false);
      expect([...pose.position, ...pose.cible, ...e.dir].every(Number.isFinite)).toBe(true);
      verifierPose(pose, vol, `vol ${i}`);
    }
    expect(e.dir[0]).toBeLessThan(-0.9);
    expect(e.haut[1]).toBeGreaterThan(0.99);
  });

  it("atterrissage sur un mur : le repère se raccroche à la normale, la rotation reste bornée après un flip", () => {
    const moi = creerVoiture({ id: 0, equipe: "bleue", slot: 0, humain: true, nom: "essai", p: [30, 8, 0], cap: Math.PI / 2 });
    moi.auSol = false; moi.normaleSurface = null; moi.rouesContact = 0;
    moi.flip = { actif: true, temps: 0.2, dir: [-1, 0], stall: false, verrouTangage: 0.6 };
    const e = creerEtatCamera(moi, balleA([0, 1, 0]), false);
    for (let i = 0; i < 10; i++) majCamera(e, CAMERA_DEFAUT, ent(false), moi, balleA([0, 1, 0]), arene, 1 / 60, ASPECT, false);
    const surMur = poser([STADE.demiLargeur, 8, 0], [-1, 0, 0], [0, 1, 0]);
    let prec = [...e.haut] as Vec3, precDir = [...e.dir] as Vec3;
    for (let i = 0; i < 120; i++) {
      majCamera(e, CAMERA_DEFAUT, ent(false), surMur, balleA([0, 1, 0]), arene, 1 / 60, ASPECT, false);
      const vHaut = Math.acos(Math.min(1, dot(prec, e.haut))) * 60, vDir = Math.acos(Math.min(1, dot(precDir, e.dir))) * 60;
      expect(vHaut).toBeLessThanOrEqual(VITESSE_RACCROCHAGE * 1.05);
      expect(vDir).toBeLessThanOrEqual(VITESSE_RACCROCHAGE * 1.05);
      prec = [...e.haut] as Vec3; precDir = [...e.dir] as Vec3;
    }
    expect(dot(e.haut, surMur.base.haut)).toBeGreaterThan(0.99);
  });
});

describe("invariants", () => {
  it("500 images aléatoires déterministes (voiture n'importe où sur la coque) : aucun NaN, règles tenues", () => {
    let s = 4242;
    const alea = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 500; i++) {
      // un point au hasard dans le stade, projeté sur la surface la plus proche
      const q: Vec3 = [(alea() * 2 - 1) * 42, alea() * 21, (alea() * 2 - 1) * 59];
      const sp = surface(q);
      const n = sp.normale;
      const t = normaliser(croix(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      const ang = alea() * Math.PI * 2;
      const av: Vec3 = [t[0] * Math.cos(ang) + croix(n, t)[0] * Math.sin(ang), t[1] * Math.cos(ang) + croix(n, t)[1] * Math.sin(ang), t[2] * Math.cos(ang) + croix(n, t)[2] * Math.sin(ang)];
      const moi = poser(sp.point, n, av);
      if (arene.sd(moi.p) < 0.1) continue; // coin trop serré pour une voiture
      const balle = balleA([(alea() * 2 - 1) * 38, 1 + alea() * 15, (alea() * 2 - 1) * 48]);
      const balleCam = alea() > 0.5;
      const pose = stabiliser(moi, balle, balleCam, 40);
      verifierPose(pose, moi, `tirage ${i} (${moi.p.map((x) => x.toFixed(1)).join(", ")}) ${balleCam ? "ball" : "car"}`);
    }
  });

  it("base de la voiture tournée au sol (baseDepuisCap) : la caméra suit le cap sans à-coup", () => {
    const moi = poser([0, 0, 0], [0, 1, 0], [0, 0, 1]);
    const e = creerEtatCamera(moi, balleA([0, 1, 30]), false);
    let prec = majCamera(e, CAMERA_DEFAUT, ent(false), moi, balleA([0, 1, 30]), arene, 1 / 60, ASPECT, false);
    for (let i = 0; i < 240; i++) {
      moi.base = baseDepuisCap(i * 0.03);
      const pose = majCamera(e, CAMERA_DEFAUT, ent(false), moi, balleA([0, 1, 30]), arene, 1 / 60, ASPECT, false);
      expect(distance(pose.position, prec.position)).toBeLessThan(0.2);
      prec = pose;
    }
  });
});
