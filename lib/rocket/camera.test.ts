import { describe, expect, it } from "vitest";
import { CAMERA_DEFAUT, STADE, ENTREES_NULLES, type Arene, type EtatBalle, type EtatVoiture } from "./contrat";
import {
  ORBITE_BUT, ajouterSecousse, creerEtatCamera, elevationViseeBalle, fovVerticalDepuisHorizontal, majCamera, majCameraBut,
} from "./camera";
import { baseDepuisCap, distance, dot, norme, normaliser, soustraire, type Vec3 } from "./vec";

/** Stade jouet : boîte |x| < 40,96, |z| < 51,2, 0 < y < 20,44 (la caméra ne s'intéresse qu'à `sd`). */
function areneJouet(): Arene {
  const sd = (p: Readonly<Vec3>) => Math.min(STADE.demiLargeur - Math.abs(p[0]), STADE.demiLongueur - Math.abs(p[2]), p[1], STADE.hauteur - p[1]);
  return {
    sd,
    normale: () => [0, 1, 0],
    sdNormale: (p, n) => { n[0] = 0; n[1] = 1; n[2] = 0; return sd(p); },
    butMarque: () => null,
    dansCage: () => null,
    lancerRayon: () => null,
    surfaceProche: (p) => ({ point: [...p] as Vec3, normale: [0, 1, 0], distance: sd(p) }),
  };
}
const arene = areneJouet();

function voiture(p: Vec3, cap = 0, extra: Partial<EtatVoiture> = {}): EtatVoiture {
  return {
    id: 0, equipe: "bleue", slot: 0, humain: true, nom: "Moi", p, v: [0, 0, 0], w: [0, 0, 0], base: baseDepuisCap(cap), boost: 33, rouesContact: 4,
    normaleSurface: [0, 1, 0], auSol: true,
    saut: { aSaute: false, temps: 0, tenue: false, secondUtilise: false, tempsEnLAir: 0, depuisFinSaut: 0 },
    flip: { actif: false, temps: 0, dir: [0, 0], stall: false, verrouTangage: 0 }, redressement: { actif: false, temps: 0 },
    supersonique: false, boostActif: false, boostDepuis: 0, derapage: false, demolie: false, reapparitionDans: 0, figee: false,
    dernierContactBalleTick: -1e9, dernierBumpTick: -1e9, sautPrecedent: false,
    stats: { buts: 0, passes: 0, arrets: 0, tirs: 0, demolitions: 0, demolie: 0, touches: 0, points: 0 },
    ...extra,
  };
}
const balleA = (p: Vec3): EtatBalle => ({ p, v: [0, 0, 0], w: [0, 0, 0], dernierToucheur: null, avantDernierToucheur: null });
const entree = (o: Partial<{ balleCam: boolean; regard: [number, number]; arriere: boolean }> = {}) => ({ balleCam: false, regard: [0, 0] as [number, number], arriere: false, ...o });

/** Fait vivre la caméra `n` images de 1/60 s. */
function simuler(moi: EtatVoiture, balle: EtatBalle, e = creerEtatCamera(moi, balle, false), ent = entree(), n = 90, params = CAMERA_DEFAUT, aspect = 16 / 9, reduit = false) {
  let pose = majCamera(e, params, ent, moi, balle, arene, 1 / 60, aspect, reduit);
  for (let i = 1; i < n; i++) pose = majCamera(e, params, ent, moi, balle, arene, 1 / 60, aspect, reduit);
  return { e, pose };
}

describe("champ de vision", () => {
  it("110° horizontal à 16/9 donne ≈ 77° vertical", () => {
    expect(fovVerticalDepuisHorizontal(110, 16 / 9)).toBeCloseTo(77.3, 0);
    expect(fovVerticalDepuisHorizontal(90, 1)).toBeCloseTo(90, 6);
  });
  it("aspect invalide : pas de NaN", () => {
    expect(Number.isFinite(fovVerticalDepuisHorizontal(110, 0))).toBe(true);
  });
});

describe("car cam", () => {
  const moi = voiture([0, 0.17, 0], 0);
  const balle = balleA([0, 0.9, 30]);
  const { pose } = simuler(moi, balle);

  it("derrière la voiture à la distance et à la hauteur réglées", () => {
    expect(pose.position[2]).toBeCloseTo(-CAMERA_DEFAUT.distance, 1);
    expect(pose.position[0]).toBeCloseTo(0, 2);
    expect(pose.position[1]).toBeCloseTo(0.17 + CAMERA_DEFAUT.hauteur, 1);
  });
  it("regarde vers l'avant de la voiture, légèrement vers le bas", () => {
    const d = normaliser(soustraire(pose.cible, pose.position));
    expect(d[2]).toBeGreaterThan(0.9);
    expect(d[1]).toBeLessThan(0);
    expect(d[1]).toBeGreaterThan(-0.4);
  });
  it("le haut est celui du monde, le champ vertical suit l'aspect", () => {
    expect(pose.haut[1]).toBeCloseTo(1, 3);
    expect(pose.fovVertical).toBeCloseTo(fovVerticalDepuisHorizontal(110, 16 / 9), 6);
  });
  it("suit le cap de la voiture quand elle tourne (lissé, converge)", () => {
    const e = creerEtatCamera(moi, balle, false);
    const tourne = voiture([0, 0.17, 0], Math.PI / 2);
    let pose2 = majCamera(e, CAMERA_DEFAUT, entree(), tourne, balle, arene, 1 / 60, 16 / 9, false);
    const premiere = Math.atan2(pose2.cible[0] - pose2.position[0], pose2.cible[2] - pose2.position[2]);
    expect(premiere).toBeLessThan(Math.PI / 2 - 0.2); // pas de saut brutal
    for (let i = 0; i < 90; i++) pose2 = majCamera(e, CAMERA_DEFAUT, entree(), tourne, balle, arene, 1 / 60, 16 / 9, false);
    expect(Math.atan2(pose2.cible[0] - pose2.position[0], pose2.cible[2] - pose2.position[2])).toBeCloseTo(Math.PI / 2, 1);
  });
  it("plus de rigidité = plus vite derrière la voiture", () => {
    const e1 = creerEtatCamera(moi, balle, false), e2 = creerEtatCamera(moi, balle, false);
    const tourne = voiture([0, 0.17, 0], 1.2);
    const cap = (e: typeof e1, r: number) => { const p = majCamera(e, { ...CAMERA_DEFAUT, rigidite: r }, entree(), tourne, balle, arene, 1 / 30, 16 / 9, false); return Math.atan2(p.cible[0] - p.position[0], p.cible[2] - p.position[2]); };
    expect(cap(e2, 1)).toBeGreaterThan(cap(e1, 0));
  });
});

describe("ball cam", () => {
  it("la caméra est sur la ligne balle → voiture, derrière la voiture, et regarde vers la balle", () => {
    const moi = voiture([-10, 0.17, -10], 0);
    const balle = balleA([10, 0.9, 20]);
    const { pose } = simuler(moi, balle, creerEtatCamera(moi, balle, true), entree({ balleCam: true }));
    const dirBalle = normaliser(soustraire(balle.p, moi.p));
    const dirCam = normaliser(soustraire(moi.p, pose.position));
    // direction caméra → voiture alignée (horizontalement) avec voiture → balle
    const h = (v: Vec3) => normaliser([v[0], 0, v[2]]);
    expect(dot(h(dirCam), h(dirBalle))).toBeGreaterThan(0.99);
    const regard = normaliser(soustraire(pose.cible, pose.position));
    expect(dot(h(regard), h(dirBalle))).toBeGreaterThan(0.97);
  });
  it("balle haute : la caméra reste au-dessus du sol et la voiture reste dans l'image", () => {
    const moi = voiture([0, 0.17, 0], 0);
    const balle = balleA([0, 17, 25]);
    const { pose } = simuler(moi, balle, creerEtatCamera(moi, balle, true), entree({ balleCam: true }));
    expect(arene.sd(pose.position)).toBeGreaterThanOrEqual(0.39);
    const regard = normaliser(soustraire(pose.cible, pose.position));
    const versVoiture = normaliser(soustraire(moi.p, pose.position));
    const ecartVertical = Math.asin(versVoiture[1]) - Math.asin(regard[1]);
    const demiChamp = (pose.fovVertical / 2) * (Math.PI / 180);
    expect(Math.abs(ecartVertical)).toBeLessThan(demiChamp);
  });
  it("la bascule est progressive (melange 0 → 1 en une fraction de seconde)", () => {
    const moi = voiture([0, 0.17, 0], 0);
    const balle = balleA([20, 0.9, 0]);
    const e = creerEtatCamera(moi, balle, false);
    majCamera(e, CAMERA_DEFAUT, entree({ balleCam: true }), moi, balle, arene, 1 / 60, 16 / 9, false);
    expect(e.melange).toBeGreaterThan(0);
    expect(e.melange).toBeLessThan(0.2);
    for (let i = 0; i < 60; i++) majCamera(e, CAMERA_DEFAUT, entree({ balleCam: true }), moi, balle, arene, 1 / 60, 16 / 9, false);
    expect(e.melange).toBe(1);
  });
  it("balle sur la voiture : pas de NaN, retombe sur la car cam", () => {
    const moi = voiture([0, 0.17, 0], 0);
    const { pose } = simuler(moi, balleA([0, 0.17, 0]), undefined, entree({ balleCam: true }), 30);
    expect([...pose.position, ...pose.cible].every(Number.isFinite)).toBe(true);
  });
});

describe("regard libre et vue arrière", () => {
  const moi = voiture([0, 0.17, 0], 0);
  const balle = balleA([0, 0.9, 30]);
  it("regard à droite : la caméra tourne autour de la voiture vers la droite, à ±90° au plus", () => {
    const { pose, e } = simuler(moi, balle, undefined, entree({ regard: [1, 0] }), 240);
    expect(e.regard[0]).toBeCloseTo(Math.PI / 2, 1);
    // la voiture regarde +Z ; sa droite est -X : la caméra, qui regardait vers l'avant, regarde maintenant vers -X, donc se tient en +X
    expect(pose.position[0]).toBeGreaterThan(CAMERA_DEFAUT.distance * 0.8);
    expect(distance([pose.position[0], 0, pose.position[2]], [0, 0, 0])).toBeCloseTo(Math.hypot(CAMERA_DEFAUT.distance, 0), 0);
  });
  it("revient au centre au relâchement", () => {
    const { e } = simuler(moi, balle, undefined, entree({ regard: [1, 1] }), 120);
    expect(Math.abs(e.regard[0])).toBeGreaterThan(1);
    for (let i = 0; i < 240; i++) majCamera(e, CAMERA_DEFAUT, entree(), moi, balle, arene, 1 / 60, 16 / 9, false);
    expect(Math.abs(e.regard[0])).toBeLessThan(0.02);
    expect(Math.abs(e.regard[1])).toBeLessThan(0.02);
  });
  it("vue arrière : la caméra passe devant la voiture et la ball cam est suspendue", () => {
    const e = creerEtatCamera(moi, balle, true);
    let pose = majCamera(e, CAMERA_DEFAUT, entree({ balleCam: true, arriere: true }), moi, balle, arene, 1 / 60, 16 / 9, false);
    for (let i = 0; i < 240; i++) pose = majCamera(e, CAMERA_DEFAUT, entree({ balleCam: true, arriere: true }), moi, balle, arene, 1 / 60, 16 / 9, false);
    expect(pose.position[2]).toBeGreaterThan(1.5);
    expect(e.melange).toBe(0);
    const regard = normaliser(soustraire(pose.cible, pose.position));
    expect(regard[2]).toBeLessThan(-0.8);
  });
});

describe("surfaces : murs et air", () => {
  it("sur le mur latéral, le haut de la caméra suit la normale de la surface", () => {
    // voiture sur le mur x = +40,96 : normale -X, avant vers le haut
    const base = { avant: [0, 1, 0] as Vec3, haut: [-1, 0, 0] as Vec3, droite: [0, 0, 1] as Vec3 };
    const moi = voiture([STADE.demiLargeur - 0.17, 8, 0], 0, { base, normaleSurface: [-1, 0, 0], auSol: true });
    const balle = balleA([0, 5, 20]);
    const { pose } = simuler(moi, balle, undefined, entree(), 120);
    expect(pose.haut[0]).toBeLessThan(-0.95);
    expect(arene.sd(pose.position)).toBeGreaterThanOrEqual(0.3);
  });
  it("le haut revient à celui du monde après le décollage", () => {
    const base = { avant: [0, 1, 0] as Vec3, haut: [-1, 0, 0] as Vec3, droite: [0, 0, 1] as Vec3 };
    const surMur = voiture([STADE.demiLargeur - 0.17, 8, 0], 0, { base, normaleSurface: [-1, 0, 0], auSol: true });
    const balle = balleA([0, 5, 20]);
    const { e } = simuler(surMur, balle, undefined, entree(), 60);
    const enAir = voiture([30, 8, 0], 0, { base, normaleSurface: null, auSol: false, rouesContact: 0 });
    for (let i = 0; i < 90; i++) majCamera(e, CAMERA_DEFAUT, entree(), enAir, balle, arene, 1 / 60, 16 / 9, false);
    expect(e.haut[1]).toBeGreaterThan(0.98);
  });
  it("en l'air, le nez levé relève la visée (suivi partiel du tangage)", () => {
    const nez = Math.PI / 4;
    const base = { avant: [0, Math.sin(nez), Math.cos(nez)] as Vec3, haut: [0, Math.cos(nez), -Math.sin(nez)] as Vec3, droite: [-1, 0, 0] as Vec3 };
    const moi = voiture([0, 10, 0], 0, { base, normaleSurface: null, auSol: false, rouesContact: 0 });
    const { pose } = simuler(moi, balleA([0, 10, 40]), undefined, entree(), 120);
    const d = normaliser(soustraire(pose.cible, pose.position));
    expect(d[1]).toBeGreaterThan(0.1);
  });
});

describe("anticollision", () => {
  it("voiture collée à un mur, caméra derrière elle dans le mur : on la rapproche, elle reste dans l'arène à ≥ 0,4 m", () => {
    // la voiture regarde vers -X (cap -π/2), derrière elle c'est le mur x = +40,96
    const moi = voiture([STADE.demiLargeur - 1.0, 0.17, 0], -Math.PI / 2);
    const { pose } = simuler(moi, balleA([-20, 0.9, 0]), undefined, entree(), 60);
    expect(pose.position[0]).toBeLessThan(STADE.demiLargeur);
    expect(arene.sd(pose.position)).toBeGreaterThanOrEqual(0.3);
    expect(distance(pose.position, moi.p)).toBeLessThan(CAMERA_DEFAUT.distance);
  });
  it("coin et plafond : jamais dans le décor sur 500 images aléatoires déterministes", () => {
    let s = 12345;
    const alea = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const moi = voiture([0, 0.17, 0], 0);
    const balle = balleA([0, 5, 0]);
    const e = creerEtatCamera(moi, balle, false);
    for (let i = 0; i < 500; i++) {
      moi.p = [(alea() * 2 - 1) * (STADE.demiLargeur - 0.5), 0.17 + alea() * 19, (alea() * 2 - 1) * (STADE.demiLongueur - 0.5)];
      moi.base = baseDepuisCap(alea() * 6.28);
      balle.p = [(alea() * 2 - 1) * 38, 1 + alea() * 15, (alea() * 2 - 1) * 48];
      const pose = majCamera(e, CAMERA_DEFAUT, entree({ balleCam: alea() > 0.5 }), moi, balle, arene, 1 / 60, 16 / 9, false);
      expect(pose.position.every(Number.isFinite)).toBe(true);
      expect(pose.position[1]).toBeLessThanOrEqual(STADE.hauteur - 0.4);
      // la caméra n'est jamais dans la matière (sauf si la voiture elle-même est déjà collée à la surface)
      expect(arene.sd(pose.position)).toBeGreaterThan(Math.min(0.05, arene.sd(moi.p) - 0.1) - 1e-6);
    }
  });
  it("sous le plafond d'au moins 0,5 m", () => {
    const moi = voiture([0, 19.5, 0], 0, { auSol: false, normaleSurface: null, rouesContact: 0 });
    const { pose } = simuler(moi, balleA([0, 19, 30]), undefined, entree(), 30);
    expect(pose.position[1]).toBeLessThanOrEqual(STADE.hauteur - 0.4);
  });
});

describe("secousse", () => {
  it("décroît, et reste sans effet en mouvement réduit", () => {
    const moi = voiture([0, 0.17, 0], 0);
    const balle = balleA([0, 0.9, 30]);
    const calme = simuler(moi, balle).pose.position;
    const e = creerEtatCamera(moi, balle, false);
    for (let i = 0; i < 90; i++) majCamera(e, CAMERA_DEFAUT, entree(), moi, balle, arene, 1 / 60, 16 / 9, false);
    ajouterSecousse(e, 0.2);
    const secoue = majCamera(e, CAMERA_DEFAUT, entree(), moi, balle, arene, 1 / 60, 16 / 9, false).position;
    expect(norme(soustraire(secoue, calme))).toBeGreaterThan(0.01);
    for (let i = 0; i < 120; i++) majCamera(e, CAMERA_DEFAUT, entree(), moi, balle, arene, 1 / 60, 16 / 9, false);
    expect(e.secousse).toBe(0);

    const e2 = creerEtatCamera(moi, balle, false);
    for (let i = 0; i < 90; i++) majCamera(e2, CAMERA_DEFAUT, entree(), moi, balle, arene, 1 / 60, 16 / 9, true);
    ajouterSecousse(e2, 0.3);
    const reduit = majCamera(e2, CAMERA_DEFAUT, entree(), moi, balle, arene, 1 / 60, 16 / 9, true).position;
    expect(norme(soustraire(reduit, calme))).toBeLessThan(1e-6);
    expect(e2.secousse).toBe(0);
  });
});

describe("célébration d'un but", () => {
  const moi = voiture([0, 0.17, 0], 0);
  const marqueur = voiture([10, 0.17, 20], 0, { id: 1 });
  const balle = balleA([0, 5, 20]);
  function orbite(reduit: boolean) {
    const e = creerEtatCamera(moi, balle, false);
    for (let i = 0; i < 30; i++) majCamera(e, CAMERA_DEFAUT, entree(), moi, balle, arene, 1 / 60, 16 / 9, false);
    const poses: Vec3[] = [];
    for (let i = 0; i < 270; i++) poses.push(majCameraBut(e, CAMERA_DEFAUT, balle, marqueur, arene, i / 60, 1 / 60, 16 / 9, reduit).position);
    return poses;
  }
  it("pas de saut au début (fondu depuis la caméra de jeu)", () => {
    const poses = orbite(false);
    for (let i = 1; i < poses.length; i++) expect(distance(poses[i], poses[i - 1])).toBeLessThan(1.2);
  });
  it("tourne autour de la balle, puis vers le marqueur, et regarde la scène, toujours dans l'arène", () => {
    const poses = orbite(false);
    expect(distance(poses[250], poses[100])).toBeGreaterThan(2);
    for (const p of poses) expect(arene.sd(p)).toBeGreaterThanOrEqual(0.3);
    const e = creerEtatCamera(moi, balle, false);
    let fin = majCameraBut(e, CAMERA_DEFAUT, balle, marqueur, arene, 0, 1 / 60, 16 / 9, false);
    for (let i = 1; i < 120; i++) fin = majCameraBut(e, CAMERA_DEFAUT, balle, marqueur, arene, 3 + i / 60, 1 / 60, 16 / 9, false);
    expect(fin.cible[0]).toBeCloseTo(10, 0);
    expect(fin.cible[2]).toBeCloseTo(20, 0);
  });
  it("mouvement réduit : point de vue fixe", () => {
    const poses = orbite(true);
    // une fois la caméra arrivée sur le marqueur (après ~2,8 s) elle ne tourne plus
    expect(distance(poses[269], poses[200])).toBeLessThan(0.5);
  });
  it("durée de l'orbite de référence cohérente avec la célébration du match", () => {
    expect(ORBITE_BUT.versMarqueurFinS).toBeLessThan(4.5);
  });
});

describe("sur le vrai stade (champ de distance de arene.ts)", () => {
  it("la caméra ne traverse jamais le décor, en car cam comme en ball cam, partout dans l'arène", async () => {
    const { creerArene } = await import("./arene");
    const vrai = creerArene();
    let s = 987654321;
    const alea = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const moi = voiture([0, 0.17, 0], 0);
    const balle = balleA([0, 5, 0]);
    const e = creerEtatCamera(moi, balle, false);
    let pires = Infinity;
    for (let i = 0; i < 400; i++) {
      moi.p = [(alea() * 2 - 1) * 38, 0.17 + (alea() < 0.5 ? 0 : alea() * 18), (alea() * 2 - 1) * 48];
      moi.base = baseDepuisCap(alea() * 6.28);
      moi.auSol = moi.p[1] < 0.5;
      moi.normaleSurface = moi.auSol ? [0, 1, 0] : null;
      balle.p = [(alea() * 2 - 1) * 38, 1 + alea() * 15, (alea() * 2 - 1) * 48];
      const pose = majCamera(e, CAMERA_DEFAUT, entree({ balleCam: alea() > 0.5, regard: [alea() * 2 - 1, alea() * 2 - 1] }), moi, balle, vrai, 1 / 60, 16 / 9, false);
      expect(pose.position.every(Number.isFinite)).toBe(true);
      pires = Math.min(pires, vrai.sd(pose.position) - Math.min(0.05, vrai.sd(moi.p)));
    }
    expect(pires).toBeGreaterThan(-1e-6);
  });
});

describe("ball cam façon Rocket League", () => {
  const D2R = Math.PI / 180;
  const bc = entree({ balleCam: true });
  /** angle (rad) entre l'axe de visée et la direction caméra → point */
  const ecartVisee = (pose: { position: Vec3; cible: Vec3 }, point: Vec3): number =>
    Math.acos(Math.min(1, dot(normaliser(soustraire(pose.cible, pose.position)), normaliser(soustraire(point, pose.position)))));
  const demiV = (fovVerticalDepuisHorizontal(110, 16 / 9) * D2R) / 2;

  it("suit la balle sans traîner : une balle qui traverse le terrain à 30 m/s reste à moins de 6° de sa place", () => {
    const moi = voiture([0, 0.17, 0], 0);
    const balle = balleA([-20, 0.9, 25]);
    const e = creerEtatCamera(moi, balle, true);
    let pire = 0;
    for (let i = 0; i < 80; i++) {
      balle.p[0] += 30 / 60;
      const pose = majCamera(e, CAMERA_DEFAUT, bc, moi, balle, arene, 1 / 60, 16 / 9, false);
      // la balle garde la même place dans l'image : à la verticale du centre, jamais décalée sur le côté
      const d = normaliser(soustraire(pose.cible, pose.position)), b = normaliser(soustraire(balle.p, pose.position));
      const lateral = Math.abs(Math.atan2(d[0], d[2]) - Math.atan2(b[0], b[2]));
      pire = Math.max(pire, lateral);
    }
    expect(pire).toBeLessThan(6 * D2R);
  });

  it("l'horizon reste droit sur un mur : le haut de la caméra est celui du monde", () => {
    const base = { avant: [0, 0, 1] as Vec3, droite: [0, -1, 0] as Vec3, haut: [-1, 0, 0] as Vec3 };
    const moi = voiture([STADE.demiLargeur - 0.17, 8, 0], 0, { base, normaleSurface: [-1, 0, 0] });
    const { pose } = simuler(moi, balleA([0, 2, 20]), undefined, bc, 120);
    expect(pose.haut[1]).toBeGreaterThan(0.999);
    // alors qu'en car cam la caméra suit le mur
    const car = simuler(moi, balleA([0, 2, 20]), undefined, entree(), 120);
    expect(car.pose.haut[0]).toBeLessThan(-0.9);
  });

  it("balle haute : la visée monte, la balle reste dans l'image (elle était plafonnée à 16°)", () => {
    const moi = voiture([0, 0.17, 0], 0);
    for (const h of [6, 12, 18]) {
      const balle = balleA([0, h, 8]);
      const { pose } = simuler(moi, balle, creerEtatCamera(moi, balle, true), bc, 60);
      expect(ecartVisee(pose, balle.p)).toBeLessThan(demiV - 8 * D2R);
      // la caméra reste au-dessus du sol, derrière la voiture
      expect(pose.position[1]).toBeGreaterThan(0.45);
      expect(pose.position[2]).toBeLessThan(-0.5);
    }
  });

  it("balle basse et lointaine : la voiture et la balle sont toutes deux à l'écran", () => {
    const moi = voiture([0, 0.17, 0], 0);
    const balle = balleA([10, 0.9, 30]);
    const { pose } = simuler(moi, balle, creerEtatCamera(moi, balle, true), bc, 60);
    expect(ecartVisee(pose, balle.p)).toBeLessThan(8 * D2R);
    expect(ecartVisee(pose, moi.p)).toBeLessThan(demiV - 5 * D2R);
  });

  it("une balle collée à la voiture ne fait pas basculer la vue (dribble, touche)", () => {
    const moi = voiture([0, 0.17, 0], 0);
    const loin = balleA([15, 0.9, 5]);
    const e = creerEtatCamera(moi, loin, true);
    const a = simuler(moi, loin, e, bc, 60).pose;
    // la balle se rapproche le long de la même droite jusqu'au pare-chocs
    const pres = balleA([1.8, 0.9, 0.6]);
    const b = simuler(moi, pres, e, bc, 60).pose;
    const cap = (p: { position: Vec3; cible: Vec3 }) => Math.atan2(p.cible[0] - p.position[0], p.cible[2] - p.position[2]);
    expect(Math.abs(cap(a) - cap(b))).toBeLessThan(3 * D2R);
  });

  it("balle à la verticale de la voiture : le cap ne s'affole pas", () => {
    const moi = voiture([0, 0.17, 0], 0);
    const balle = balleA([0.05, 6, 4]);
    const e = creerEtatCamera(moi, balle, true);
    let prec = simuler(moi, balle, e, bc, 30).pose;
    let pire = 0;
    // la balle passe au-dessus du toit en 0,25 s
    for (let i = 0; i < 30; i++) {
      balle.p[2] -= 8 / 30;
      const pose = majCamera(e, CAMERA_DEFAUT, bc, moi, balle, arene, 1 / 60, 16 / 9, false);
      pire = Math.max(pire, distance(pose.position, prec.position));
      prec = pose;
    }
    // la caméra fait le tour de la voiture à vitesse bornée (10 rad/s) : jamais de saut d'un côté à l'autre (5,4 m)
    expect(pire).toBeLessThan(0.5);
  });

  it("elevationViseeBalle : regarde la balle, garde la voiture tant que c'est possible, la balle d'abord sinon", () => {
    const demi = 38 * D2R, angle = -4 * D2R, elVoiture = -12 * D2R;
    // balle basse : on la regarde, décalée de l'angle de caméra
    expect(elevationViseeBalle(0, elVoiture, demi, angle)).toBeCloseTo(angle, 6);
    // balle un peu haute : la voiture reste en bas de l'image
    const moyen = elevationViseeBalle(35 * D2R, elVoiture, demi, angle);
    expect(moyen - elVoiture).toBeLessThanOrEqual(demi);
    expect(35 * D2R - moyen).toBeLessThan(demi);
    // balle au zénith : elle reste à l'écran, à plus de 10° du bord
    const haut = elevationViseeBalle(70 * D2R, elVoiture, demi, angle);
    expect(70 * D2R - haut).toBeLessThanOrEqual(demi - 10 * D2R);
    // continue
    for (let el = -60; el < 78; el += 0.5) {
      expect(Math.abs(elevationViseeBalle((el + 0.5) * D2R, elVoiture, demi, angle) - elevationViseeBalle(el * D2R, elVoiture, demi, angle))).toBeLessThan(1 * D2R);
    }
  });
});
