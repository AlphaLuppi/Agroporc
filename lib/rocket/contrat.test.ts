import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BALLE, BUT, CONDUITE, CONTACT_BALLE, CONTACT_MONDE, CONTACT_VOITURES, COUPS_D_ENVOI, PLOT, PLOTS, SITE, STADE, VOITURE, adversaire, boitesExclusionSite, creerRng, interpolerTable,
  joueursParEquipe, localVersScene, sceneVersLocal, seuilMarqueBalle, signeButDefendu, tirer, tirerGauss, uu, MATCH, REGLAGES_DEFAUT,
} from "./contrat";

describe("contrat : constantes de Rocket League", () => {
  it("dimensions exactes du stade Soccar", () => {
    expect(STADE.demiLargeur * 2).toBeCloseTo(81.92, 5);
    expect(STADE.demiLongueur * 2).toBeCloseTo(102.4, 5);
    expect(STADE.hauteur).toBeCloseTo(20.48, 5); // RocketSim ARENA_HEIGHT = 2048 uu
    expect(BUT.demiLargeur * 2).toBeCloseTo(17.8551, 5); // RocketSim APPROX_GOAL_HALF_WIDTH = 892,755 uu
    expect(BUT.profondeur).toBeCloseTo(8.8, 5);
    expect(STADE.demiLongueur + BUT.profondeur).toBeCloseTo(60, 5);
    expect(seuilMarqueBalle()).toBeCloseTo(51.2425 + 0.9125, 5);
  });
  it("plots, réapparitions, buteur et tirs : constantes de RocketSim (RLConst.h BoostPads, BoostPadGrid.h, GameEventTracker.h)", () => {
    // cylindre : CYL_RAD_SMALL = 144, CYL_RAD_BIG = 208, CYL_HEIGHT = 95 ; plots posés à 70 / 73 uu
    expect(PLOT.petit).toMatchObject({ valeur: 12, rechargeS: 4, rayon: 1.44, demiHauteur: 0.95, hauteurCentre: 0.7 });
    expect(PLOT.gros).toMatchObject({ valeur: 100, rechargeS: 10, rayon: 2.08, demiHauteur: 0.95, hauteurCentre: 0.73 });
    // boîte du verrou : BOX_RAD_SMALL = 120, BOX_RAD_BIG = 160, BOX_HEIGHT = 64
    expect(PLOT.petit).toMatchObject({ demiCoteBoite: 1.2, hauteurBoite: 0.64 });
    expect(PLOT.gros).toMatchObject({ demiCoteBoite: 1.6, hauteurBoite: 0.64 });
    // BoostPadGrid::EXTENT_Z = CYL_HEIGHT + 250
    expect(PLOT.hauteurMaxOrigine).toBeCloseTo(3.45, 12);
    // GameEventTrackerConfig : goalMaxTouchTime 4 s, passMaxTouchTime 2 s, shotMinSpeed 1750 uu/s, shotTouchMinDelay 0,3 s,
    // shotEventCooldown 1 s, shotMinScoreTime 2 s ; IsBallProbablyGoingIn : marge de 0,1 rayon de balle
    expect(MATCH.fenetreButeurS).toBe(4);
    expect(MATCH.fenetrePasseS).toBe(2);
    expect(MATCH.suivi).toEqual({ vitesseMin: 17.5, delaiToucheS: 0.3, delaiTirS: 1, horizonS: 2, margeCadreRayons: 0.1 });
  });
  it("34 plots : 6 gros et 28 petits, symétriques en X et en Z", () => {
    expect(PLOTS).toHaveLength(34);
    expect(PLOTS.filter((p) => p.gros)).toHaveLength(6);
    expect(PLOTS.filter((p) => !p.gros)).toHaveLength(28);
    for (const p of PLOTS) {
      expect(PLOTS.some((q) => q.gros === p.gros && Math.abs(q.x + p.x) < 1e-9 && Math.abs(q.z - p.z) < 1e-9)).toBe(true);
      expect(PLOTS.some((q) => q.gros === p.gros && Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.z + p.z) < 1e-9)).toBe(true);
      expect(Math.abs(p.x)).toBeLessThan(STADE.demiLargeur);
      expect(Math.abs(p.z)).toBeLessThan(STADE.demiLongueur);
    }
    expect(PLOTS.map((p) => p.id)).toEqual(PLOTS.map((_, i) => i));
  });
  it("coups d'envoi : cinq positions distinctes dans la moitié bleue", () => {
    expect(COUPS_D_ENVOI).toHaveLength(5);
    for (const c of COUPS_D_ENVOI) expect(c.z).toBeLessThan(0);
    expect(new Set(COUPS_D_ENVOI.map((c) => `${c.x}|${c.z}`)).size).toBe(5);
  });
  it("tables croissantes en x et courbe de gaz décroissante", () => {
    for (const t of [CONDUITE.courbeGaz, CONDUITE.courbeCourbure, CONTACT_BALLE.courbeImpulsion]) {
      for (let i = 1; i < t.length; i++) expect(t[i][0]).toBeGreaterThan(t[i - 1][0]);
    }
    expect(interpolerTable(CONDUITE.courbeGaz, 0)).toBeCloseTo(16, 9);
    expect(interpolerTable(CONDUITE.courbeGaz, 14.1)).toBeCloseTo(0, 9);
    expect(interpolerTable(CONDUITE.courbeGaz, 30)).toBe(0);
    expect(interpolerTable(CONTACT_BALLE.courbeImpulsion, 23)).toBeCloseTo(0.55, 9);
    expect(interpolerTable(CONTACT_BALLE.courbeImpulsion, 34.5)).toBeCloseTo(0.425, 9);
  });
  it("balle et contacts : constantes de RocketSim (RLConst.h, Arena.cpp, seuils de Bullet)", () => {
    // balle : rayon 91,25 uu, posée à 93,15 uu (BALL_REST_Z), contact dès 1,905 uu, rebond au-dessus de 10 uu/s, aucun amortissement du spin
    expect(BALLE.rayon).toBeCloseTo(0.9125, 12);
    expect(BALLE.hauteurEngagement).toBeCloseTo(0.9315, 12);
    expect(BALLE.margeContact).toBeCloseTo((1.825 + 0.08) * 0.02 * 0.5, 12);
    expect(BALLE.seuilRebond).toBeCloseTo(0.1, 12);
    expect(BALLE.restitution).toBe(0.6);
    expect(BALLE.frottement).toBe(0.35);
    expect(BALLE.amortissementLineaire).toBe(0.03);
    expect(BALLE.amortissementAngulaire).toBe(0);
    expect("frottementRoulement" in BALLE).toBe(false);
    expect(BALLE.vitesseMax).toBe(60);
    expect(BALLE.vitesseAngMax).toBe(6);
    // voiture ↔ balle : restitution 0, frottement 2, un pas sauté entre deux impulsions de Psyonix
    expect(CONTACT_BALLE.restitution).toBe(0);
    expect(CONTACT_BALLE.frottement).toBe(2);
    expect(CONTACT_BALLE.delaiImpulsionPas).toBe(1);
    expect(CONTACT_BALLE.echelleVerticale).toBe(0.35);
    expect(CONTACT_BALLE.echelleAvant).toBe(0.65);
    // voiture ↔ voiture : 0,1 / 0,09 ; courbes de bump qui partent de 5/6 et 2/6 uu/s ; délai 0,25 s
    expect(CONTACT_VOITURES.restitution).toBe(0.1);
    expect(CONTACT_VOITURES.frottement).toBe(0.09);
    expect(CONTACT_VOITURES.bumpDelaiS).toBe(0.25);
    expect(interpolerTable(CONTACT_VOITURES.bumpSol, 0)).toBeCloseTo(uu(5 / 6), 12);
    expect(interpolerTable(CONTACT_VOITURES.bumpAir, 0)).toBeCloseTo(uu(5 / 6), 12);
    expect(interpolerTable(CONTACT_VOITURES.bumpHaut, 0)).toBeCloseTo(uu(2 / 6), 12);
    expect(interpolerTable(CONTACT_VOITURES.bumpSol, 22)).toBeCloseTo(15.3, 9);
    expect(interpolerTable(CONTACT_VOITURES.bumpAir, 22)).toBeCloseTo(19.45, 9);
    expect(interpolerTable(CONTACT_VOITURES.bumpHaut, 22)).toBeCloseTo(4.17, 9);
    expect(CONTACT_VOITURES.demoAvantMinM).toBeCloseTo(0.645, 12);
    // caisse ↔ décor : 0,3 / 0,3, pas de rebond sous 10 uu/s
    expect(CONTACT_MONDE).toEqual({ frottement: 0.3, restitution: 0.3, seuilRebond: 0.1 });
  });
  it("la voiture tient dans ses roues et la balle dans le but", () => {
    // hitbox de l'Octane selon RocketSim (CarConfig.cpp) : 120,507 × 86,6994 × 38,6591 uu, décalée de (13,8757 ; 0 ; 20,755) uu
    expect(VOITURE.hitbox.longueur).toBeCloseTo(1.20507, 6);
    expect(VOITURE.hitbox.largeur).toBeCloseTo(0.866994, 6);
    expect(VOITURE.hitbox.hauteur).toBeCloseTo(0.386591, 6);
    expect(VOITURE.decalageHitbox).toEqual([uu(13.8757), 0, uu(20.755)]);
    // roues : centre à 25,255 uu (avant) et 22,755 uu (arrière) sous le point d'attache, portée 11,0 et 11,8 uu sous le pneu
    for (const r of VOITURE.roues) {
      expect(r.attache[0]).toBe(r.local[0]);
      expect(r.attache[1]).toBe(r.local[1]);
      expect(r.attache[2] - r.local[2]).toBeCloseTo(r.avant ? uu(25.255) : uu(22.755), 9);
      expect(r.marge).toBeCloseTo(r.avant ? uu(11.0) : uu(11.8), 9);
    }
    expect(BALLE.rayon * 2).toBeLessThan(BUT.hauteur);
    expect(uu(250)).toBe(2.5);
    expect(MATCH.dureesPermisesS).toContain(MATCH.dureeDefautS);
    expect(REGLAGES_DEFAUT().camera.fov).toBe(110);
  });
  it("équipes", () => {
    expect(adversaire("bleue")).toBe("orange");
    expect(signeButDefendu("bleue")).toBe(-1);
    expect(joueursParEquipe("3v3")).toBe(3);
  });
});

describe("contrat : aléa déterministe", () => {
  it("même graine, même suite ; valeurs dans [0, 1)", () => {
    const a = creerRng(42), b = creerRng(42);
    for (let i = 0; i < 100; i++) {
      const x = tirer(a);
      expect(x).toBe(tirer(b));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(tirer(creerRng(1))).not.toBe(tirer(creerRng(2)));
  });
  it("gaussien : moyenne ≈ 0, écart type ≈ 1", () => {
    const r = creerRng(7);
    const xs = Array.from({ length: 4000 }, () => tirerGauss(r));
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
    expect(Math.abs(m)).toBeLessThan(0.08);
    expect(Math.abs(Math.sqrt(v) - 1)).toBeLessThan(0.08);
  });
});

describe("contrat : site sur Agroparc", () => {
  it("repère local ↔ scène : aller-retour exact", () => {
    for (const [x, z] of [[0, 0], [30, -50], [-12, 60]] as const) {
      const [xs, zs] = localVersScene(x, z);
      const [x2, z2] = sceneVersLocal(xs, zs);
      expect(x2).toBeCloseTo(x, 9);
      expect(z2).toBeCloseTo(z, 9);
    }
    expect(localVersScene(0, 0)).toEqual([SITE.centre[0], SITE.centre[1]]);
    const [xs, zs] = localVersScene(0, 10);
    expect(xs - SITE.centre[0]).toBeCloseTo(10 * Math.sin(SITE.cap), 9);
    expect(zs - SITE.centre[1]).toBeCloseTo(10 * Math.cos(SITE.cap), 9);
  });
  it("l'empreinte du stade (buts compris, 3 m de marge) ne touche aucun bâtiment, plan d'eau ni arbre de scene.json", () => {
    const scene = JSON.parse(readFileSync(new URL("../../public/agroparc/scene.json", import.meta.url), "utf8")) as {
      buildings: { r: [number, number][] }[]; water: [number, number][][]; trees: [number, number][];
    };
    const dansStade = (xs: number, zs: number, marge: number) => {
      const [x, z] = sceneVersLocal(xs, zs);
      return Math.abs(x) <= STADE.demiLargeur + marge && Math.abs(z) <= STADE.demiLongueur + BUT.profondeur + marge;
    };
    const pointDansPoly = (x: number, z: number, p: [number, number][]) => {
      let c = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [a, b] = p[i], [e, f] = p[j];
        if (b > z !== f > z && x < ((e - a) * (z - b)) / (f - b) + a) c = !c;
      }
      return c;
    };
    for (const b of scene.buildings) {
      for (const [x, z] of b.r) expect(dansStade(x, z, 3)).toBe(false);
      // le centre du bâtiment ne doit pas non plus être dans le stade (grand bâtiment qui l'englobe)
      const cx = b.r.reduce((s, q) => s + q[0], 0) / b.r.length, cz = b.r.reduce((s, q) => s + q[1], 0) / b.r.length;
      expect(dansStade(cx, cz, 3)).toBe(false);
    }
    // quatre coins + milieux des côtés du stade hors des plans d'eau
    for (const [x, z] of [[-41, -60], [41, -60], [41, 60], [-41, 60], [0, 0]] as const) {
      const [xs, zs] = localVersScene(x, z);
      for (const w of scene.water) expect(pointDansPoly(xs, zs, w)).toBe(false);
    }
    const arbres = scene.trees.filter(([x, z]) => dansStade(x, z, 0));
    expect(arbres.length).toBe(0);
  });
  it("les boîtes d'exclusion couvrent le stade et ses gradins", () => {
    const boites = boitesExclusionSite();
    expect(boites).toHaveLength(12);
    for (const [x, z] of [[0, 0], [40, 59], [-40, -59], [40, -59], [-40, 59]] as const) {
      const [xs, zs] = localVersScene(x, z);
      expect(boites.some((b) => xs >= b.x0 && xs <= b.x1 && zs >= b.z0 && zs <= b.z1)).toBe(true);
    }
  });
});
