import { describe, expect, it } from "vitest";
import { CAMERA_DEFAUT, STADE, ENTREES_NULLES, PAS_S, type Arene, type EntreesVoiture, type EtatBalle, type EtatVoiture } from "./contrat";
import {
  ORBITE_BUT, RACCROCHAGE_FLIP_S, VITESSE_RACCROCHAGE, ajouterSecousse, creerEtatCamera, elevationViseeBalle, flipEnCours, fovVerticalDepuisHorizontal, majCamera, majCameraBut,
} from "./camera";
import { creerArene } from "./arene";
import { creerVoiture, pasVoiture } from "./voiture";
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
    flip: { actif: false, temps: 0, dir: [0, 0], stall: false, verrouTangage: 0 }, redressement: { actif: false, temps: 0, signe: 1 }, contactMonde: { actif: false, normale: [0, 1, 0] }, supersoniqueDepuis: 0, frein: 0,
    pneus: { angle: 0, moteur: 0, frein: 0, lat: [0, 0, 0, 0], long: [0, 0, 0, 0] },
    supersonique: false, boostActif: false, boostDepuis: 0, derapage: false, demolie: false, reapparitionDans: 0, figee: false,
    dernierContactBalleTick: -1e9, derniereImpulsionPsyonixTick: -1e9, bumpAutreId: -1, bumpDelaiTick: -1e9, rouesBalle: [false, false, false, false],
    normalesRouesBalle: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], vitesseEnAttente: [0, 0, 0], sautPrecedent: false,
    stats: { buts: 0, passes: 0, arrets: 0, tirs: 0, demolitions: 0, demolie: 0, touches: 0, points: 0 },
    ...extra,
  };
}
const balleA = (p: Vec3): EtatBalle => ({ p, v: [0, 0, 0], w: [0, 0, 0], dernierToucheur: null, avantDernierToucheur: null, vitesseEnAttente: [0, 0, 0] });
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

// ============================================================================================================================
// Flip : la caméra ne suit pas le salto
// ============================================================================================================================

describe("car cam pendant un flip", () => {
  const areneReelle = creerArene();
  const ecartDeg = (u: Readonly<Vec3>, w: Readonly<Vec3>): number => (Math.acos(Math.min(1, Math.max(-1, dot(u, w)))) * 180) / Math.PI;
  const copie = (v: Readonly<Vec3>): Vec3 => [v[0], v[1], v[2]];
  const IMAGES_AVANT_FLIP = 30;
  /** images du raccrochage (RACCROCHAGE_FLIP_S) : au-delà, la caméra suit l'avant comme d'habitude, à son rythme normal */
  const FENETRE_RACCROCHAGE = Math.ceil(RACCROCHAGE_FLIP_S * 60) + 1;
  const D2R = Math.PI / 180;

  interface Image { dir: Vec3; position: Vec3; cible: Vec3; avant: Vec3; flip: boolean; verrou: number; auSol: boolean; moi: EtatVoiture }
  /**
   * Vraie physique de la voiture (deux pas de 1/120 s par image de 1/60 s) : 0,5 s de vol, puis `entrees` sur UN pas (l'appui du flip),
   * puis `apres(i)` (entrées de chaque image suivante). La caméra est mise à jour à chaque image.
   */
  function volerFlip(entrees: Partial<EntreesVoiture>, opts: { apres?: Partial<EntreesVoiture>; images?: number; reduit?: boolean; balleCam?: boolean; hauteur?: number } = {}) {
    const v = creerVoiture({ id: 0, equipe: "bleue", slot: 0, humain: true, nom: "essai", p: [0, opts.hauteur ?? 15, -20], cap: 0 });
    v.v[2] = 10;
    const balle = balleA([0, 1, 30]);
    const e = creerEtatCamera(v, balle, !!opts.balleCam);
    const ent = entree({ balleCam: !!opts.balleCam });
    const images: Image[] = [];
    let tick = 0;
    const pas = (en: Partial<EntreesVoiture>) => pasVoiture(areneReelle, v, { ...ENTREES_NULLES(), ...en }, PAS_S, tick++);
    const total = (opts.images ?? 110);
    for (let i = 0; i < total; i++) {
      const declenche = i === IMAGES_AVANT_FLIP;
      pas(declenche ? entrees : i > IMAGES_AVANT_FLIP ? opts.apres ?? {} : {});
      pas(i > IMAGES_AVANT_FLIP ? opts.apres ?? {} : {});
      const pose = majCamera(e, CAMERA_DEFAUT, ent, v, balle, arene, 1 / 60, 16 / 9, !!opts.reduit);
      images.push({
        dir: copie(e.dir), position: copie(pose.position), cible: copie(pose.cible), avant: copie(v.base.avant),
        flip: flipEnCours(v), verrou: v.flip.verrouTangage, auSol: v.auSol, moi: structuredClone(v),
      });
    }
    return { images, e, v, balle };
  }
  const iDepart = IMAGES_AVANT_FLIP - 1;
  const distAuDepart = (im: Image[]) => distance(im[iDepart].position, im[iDepart].moi.p);

  const CAS: [string, Partial<EntreesVoiture>][] = [
    ["flip avant (front flip)", { saut: true, tangage: -1 }],
    ["flip arrière (backflip)", { saut: true, tangage: 1 }],
    ["flip latéral (side flip)", { saut: true, lacet: 1 }],
    ["flip latéral à gauche", { saut: true, lacet: -1 }],
    ["flip en diagonale", { saut: true, tangage: -1, lacet: 1 }],
    ["flip en diagonale arrière", { saut: true, tangage: 1, lacet: -1 }],
  ];

  it.each(CAS)("%s : la voiture bascule mais la direction de la caméra reste celle du départ du flip", (_nom, ent) => {
    const { images } = volerFlip(ent);
    const dep = images[iDepart].dir;
    const enFlip = images.filter((im) => im.flip);
    expect(enFlip.length).toBeGreaterThan(50); // 0,95 s de verrou ≈ 57 images
    // la voiture a vraiment fait un salto ou un tonneau (nez ou haut retourné)
    const rotation = Math.max(...enFlip.map((im) => ecartDeg(im.avant, images[iDepart].avant)), ...enFlip.map((im) => ecartDeg(im.moi.base.haut, [0, 1, 0])));
    expect(rotation).toBeGreaterThan(90);
    // la caméra, non : elle regarde toujours là où elle regardait
    for (const im of enFlip) expect(ecartDeg(im.dir, dep)).toBeLessThan(0.5);
    // … et la pose reste derrière la voiture, à la distance et à la hauteur habituelles
    for (const im of enFlip) {
      expect(Math.abs(distance(im.position, im.moi.p) - distAuDepart(images))).toBeLessThan(0.6);
      const derriere = normaliser(soustraire(im.moi.p, im.position));
      expect(ecartDeg(normaliser([derriere[0], 0, derriere[2]]), normaliser([dep[0], 0, dep[2]]))).toBeLessThan(3);
    }
  });

  it("l'ancien comportement (suivi de 70 % du tangage du nez) aurait fait basculer la vue : le test est discriminant", () => {
    // même vol, mais le flip est caché à la caméra (verrou à 0) : la direction suit le nez
    const { images } = volerFlip({ saut: true, tangage: -1 });
    const sansGel = images.map((im) => ({ ...im.moi, flip: { ...im.moi.flip, verrouTangage: 0 } }));
    const e = creerEtatCamera(images[0].moi, balleA([0, 1, 30]), false);
    let pire = 0;
    for (let i = 0; i < sansGel.length; i++) {
      majCamera(e, CAMERA_DEFAUT, entree(), sansGel[i], balleA([0, 1, 30]), arene, 1 / 60, 16 / 9, false);
      if (images[i].flip) pire = Math.max(pire, ecartDeg(e.dir, images[iDepart].dir));
    }
    expect(pire).toBeGreaterThan(30);
  });

  it("pas d'à-coup au départ du flip : la direction ne bouge pas à l'image où le flip commence", () => {
    for (const [, ent] of CAS) {
      const { images } = volerFlip(ent);
      for (let i = IMAGES_AVANT_FLIP - 2; i <= IMAGES_AVANT_FLIP + 3; i++) expect(ecartDeg(images[i].dir, images[i - 1].dir)).toBeLessThan(1.5);
    }
  });

  it("raccrochage : une fois le flip fini la caméra revient à l'avant sans à-coup (vitesse de rotation bornée) et converge", () => {
    for (const [, ent] of CAS) {
      const { images, e, v } = volerFlip(ent, { images: 130 });
      const finFlip = images.findIndex((im, i) => i > IMAGES_AVANT_FLIP && !im.flip);
      expect(finFlip).toBeGreaterThan(IMAGES_AVANT_FLIP + 50);
      let pire = 0;
      for (let i = finFlip; i < Math.min(images.length, finFlip + FENETRE_RACCROCHAGE); i++) pire = Math.max(pire, (ecartDeg(images[i].dir, images[i - 1].dir) * Math.PI) / 180 * 60);
      expect(pire).toBeLessThanOrEqual(VITESSE_RACCROCHAGE * 1.05);
      // voiture figée (état de fin de vol), la caméra se pose derrière son avant comme avant le flip : 70 % du tangage du nez
      const fin = structuredClone(v);
      fin.auSol = false;
      for (let i = 0; i < 90; i++) majCamera(e, CAMERA_DEFAUT, entree(), fin, balleA([0, 1, 30]), arene, 1 / 60, 16 / 9, false);
      const a = fin.base.avant;
      expect(dot(e.dir, normaliser([a[0], a[1] * 0.7, a[2]]))).toBeGreaterThan(0.995);
    }
  });

  it("raccrochage d'un nez très écarté (voiture retournée à la fin du flip) : jamais plus vite que la borne, aucun NaN", () => {
    const { e, v, images } = volerFlip({ saut: true, tangage: -1 }, { images: IMAGES_AVANT_FLIP + 20 });
    // fin brutale du flip avec le nez à la verticale (flip coupé par une correction du réseau, atterrissage…)
    const coupe = structuredClone(v);
    coupe.flip.verrouTangage = 0; coupe.flip.actif = false;
    coupe.base = { avant: [0, 1, 0], droite: [1, 0, 0], haut: [0, 0, -1] };
    let prec = copie(e.dir);
    for (let i = 0; i < 60; i++) {
      const pose = majCamera(e, CAMERA_DEFAUT, entree(), coupe, balleA([0, 1, 30]), arene, 1 / 60, 16 / 9, false);
      expect([...pose.position, ...pose.cible, ...e.dir].every(Number.isFinite)).toBe(true);
      expect((ecartDeg(e.dir, prec) * Math.PI) / 180 * 60).toBeLessThanOrEqual(VITESSE_RACCROCHAGE * 1.05);
      prec = copie(e.dir);
    }
    expect(images.length).toBeGreaterThan(0);
  });

  it("raccrochage d'un half flip (avant retourné de 90 à 180 degrés) : la borne tient jusqu'au bout, aucune accélération quand le fondu finit", () => {
    for (const degres of [90, 120, 143, 160, 180]) {
      const { e, v } = volerFlip({ saut: true, tangage: -1 }, { images: IMAGES_AVANT_FLIP + 20 });
      const dep = copie(e.dir);
      // fin de flip avec l'avant tourné de `degres` autour de la verticale par rapport au cap gelé
      const cap = Math.atan2(dep[0], dep[2]) + (degres * Math.PI) / 180;
      const coupe = structuredClone(v);
      coupe.flip.verrouTangage = 0; coupe.flip.actif = false;
      coupe.base = { avant: [Math.sin(cap), 0, Math.cos(cap)], droite: [Math.cos(cap), 0, -Math.sin(cap)], haut: [0, 1, 0] };
      let prec = copie(e.dir), pire = 0;
      for (let i = 0; i < 120; i++) {
        majCamera(e, CAMERA_DEFAUT, entree(), coupe, balleA([0, 1, 30]), arene, 1 / 60, 16 / 9, false);
        expect(e.dir.every(Number.isFinite)).toBe(true);
        pire = Math.max(pire, (ecartDeg(e.dir, prec) * Math.PI) / 180 * 60);
        prec = copie(e.dir);
      }
      expect(pire).toBeLessThanOrEqual(VITESSE_RACCROCHAGE * 1.05);
      expect(dot(e.dir, normaliser([coupe.base.avant[0], 0, coupe.base.avant[2]]))).toBeGreaterThan(0.99);
    }
  });

  it("flip cancel (manche tiré à l'opposé) : la caméra reste gelée puis se raccroche sans à-coup", () => {
    const { images } = volerFlip({ saut: true, tangage: -1 }, { apres: { tangage: 1 }, images: 130 });
    const dep = images[iDepart].dir;
    for (const im of images.filter((i) => i.flip)) expect(ecartDeg(im.dir, dep)).toBeLessThan(0.5);
    const finFlip = images.findIndex((im, i) => i > IMAGES_AVANT_FLIP && !im.flip);
    let pire = 0;
    for (let i = finFlip; i < Math.min(images.length, finFlip + FENETRE_RACCROCHAGE); i++) pire = Math.max(pire, (ecartDeg(images[i].dir, images[i - 1].dir) * Math.PI) / 180 * 60);
    expect(pire).toBeLessThanOrEqual(VITESSE_RACCROCHAGE * 1.05);
  });

  it("atterrissage pendant le flip : le gel tombe (trois roues), la caméra se raccroche", () => {
    const { images } = volerFlip({ saut: true, tangage: -1 }, { hauteur: 2.2, images: 120 });
    const sol = images.findIndex((im, i) => i > IMAGES_AVANT_FLIP && im.auSol);
    expect(sol).toBeGreaterThan(0);
    expect(images[sol].flip).toBe(false);
    let pire = 0;
    for (let i = sol; i < Math.min(images.length, sol + FENETRE_RACCROCHAGE); i++) pire = Math.max(pire, (ecartDeg(images[i].dir, images[i - 1].dir) * Math.PI) / 180 * 60);
    expect(pire).toBeLessThanOrEqual(VITESSE_RACCROCHAGE * 1.05);
  });

  it("mouvement réduit : même gel, même raccrochage", () => {
    const normal = volerFlip({ saut: true, tangage: -1 }, { images: 130 });
    const reduit = volerFlip({ saut: true, tangage: -1 }, { images: 130, reduit: true });
    for (const im of reduit.images.filter((i) => i.flip)) expect(ecartDeg(im.dir, reduit.images[iDepart].dir)).toBeLessThan(0.5);
    // la secousse mise à part, la direction est identique
    for (let i = 0; i < normal.images.length; i++) expect(ecartDeg(normal.images[i].dir, reduit.images[i].dir)).toBeLessThan(0.01);
  });

  it("le stall (roulis seul, pas de salto) ne gèle rien : la caméra continue de suivre l'avant", () => {
    const moi = voiture([0, 10, 0], 0, { auSol: false, normaleSurface: null, flip: { actif: true, temps: 0.1, dir: [0, 0], stall: true, verrouTangage: 0.85 } });
    expect(flipEnCours(moi)).toBe(false);
    const tourne = voiture([0, 10, 0], Math.PI / 2, { auSol: false, normaleSurface: null, flip: moi.flip });
    const { e } = simuler(tourne, balleA([0, 1, 30]), creerEtatCamera(moi, balleA([0, 1, 30]), false), entree(), 120);
    expect(e.dir[0]).toBeGreaterThan(0.99);
  });

  it("aérien normal (nez qui monte, pas de flip) : comportement inchangé, 70 % du tangage du nez suivi", () => {
    const base = { avant: normaliser([0, Math.sin(40 * D2R), Math.cos(40 * D2R)]) as Vec3, droite: [-1, 0, 0] as Vec3, haut: normaliser([0, Math.cos(40 * D2R), -Math.sin(40 * D2R)]) as Vec3 };
    const moi = voiture([0, 8, 0], 0, { auSol: false, normaleSurface: null, base });
    expect(flipEnCours(moi)).toBe(false);
    const { e } = simuler(moi, balleA([0, 1, 30]), undefined, entree(), 150);
    expect(dot(e.dir, normaliser([0, base.avant[1] * 0.7, base.avant[2]]))).toBeGreaterThan(0.999);
  });

  it("correction du réseau en plein flip (rollback qui coupe puis rétablit le flip) : la direction ne saute pas", () => {
    const { e, v } = volerFlip({ saut: true, tangage: -1 }, { images: IMAGES_AVANT_FLIP + 25 });
    const dep = copie(e.dir);
    const balle = balleA([0, 1, 30]);
    let prec = copie(e.dir);
    const pas = (moi: EtatVoiture) => {
      majCamera(e, CAMERA_DEFAUT, entree(), moi, balle, arene, 1 / 60, 16 / 9, false);
      const vit = (ecartDeg(e.dir, prec) * Math.PI) / 180 * 60;
      prec = copie(e.dir);
      return vit;
    };
    const coupe = structuredClone(v); coupe.flip.verrouTangage = 0; coupe.flip.actif = false;
    // 8 images sans flip (état serveur « avant le flip »), puis le flip revient : jamais plus vite que la borne
    for (let i = 0; i < 8; i++) expect(pas(coupe)).toBeLessThanOrEqual(VITESSE_RACCROCHAGE * 1.05);
    for (let i = 0; i < 20; i++) expect(pas(v)).toBeLessThanOrEqual(VITESSE_RACCROCHAGE * 1.05);
    // la direction reste tout près de celle du départ (le retour du flip ne la reprend qu'à l'endroit où elle en était)
    expect(ecartDeg(e.dir, dep)).toBeLessThan(25);
    expect(RACCROCHAGE_FLIP_S).toBeGreaterThan(0.2);
  });

  it("caméra créée en plein flip (réapparition, rejeu) : cap à plat, direction gelée dès la première image", () => {
    const { v } = volerFlip({ saut: true, tangage: -1 }, { images: IMAGES_AVANT_FLIP + 15 });
    expect(flipEnCours(v)).toBe(true);
    const balle = balleA([0, 1, 30]);
    const e = creerEtatCamera(v, balle, false);
    const dep = copie(e.dir);
    expect(Math.abs(dep[1])).toBeLessThan(0.05);
    for (let i = 0; i < 20; i++) majCamera(e, CAMERA_DEFAUT, entree(), v, balle, arene, 1 / 60, 16 / 9, false);
    expect(ecartDeg(e.dir, dep)).toBeLessThan(0.5);
  });

  it("ball cam : le salto ne change pas la vue (elle ne dépend pas de l'orientation de la voiture)", () => {
    const vrai = volerFlip({ saut: true, tangage: -1 }, { balleCam: true });
    // même trajectoire, mais la voiture garde son orientation de départ
    const e2 = creerEtatCamera(vrai.images[0].moi, vrai.balle, true);
    for (let i = 0; i < vrai.images.length; i++) {
      const m = structuredClone(vrai.images[i].moi);
      m.base = structuredClone(vrai.images[0].moi.base);
      const pose = majCamera(e2, CAMERA_DEFAUT, entree({ balleCam: true }), m, vrai.balle, arene, 1 / 60, 16 / 9, false);
      if (i > 5) {
        expect(distance(pose.position, vrai.images[i].position)).toBeLessThan(1e-6);
        expect(distance(pose.cible, vrai.images[i].cible)).toBeLessThan(1e-6);
      }
    }
  });
});
