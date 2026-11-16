import { describe, expect, it } from "vitest";
import { BALLE, BUT, COUPS_D_ENVOI, PLOT, PLOTS, STADE, VOITURE, creerRng, tirer } from "./contrat";
import type { Vec3 } from "./contrat";
import { GEOMETRIE_ARENE, PROFIL_CAGE, coupsDEnvoiDuStade, creerArene, hauteurPiedPoteau, placeCoupDEnvoi, plotsDuStade, rayonRaccordFond } from "./arene";

const a = creerArene();
const R = STADE.rayonSol;
const H = STADE.hauteur;

describe("arène : valeurs analytiques", () => {
  it("le centre du terrain est à la distance du sol ou du plafond", () => {
    expect(a.sd([0, 5, 0])).toBeCloseTo(5, 9);
    expect(a.sd([0, 0.3, 0])).toBeCloseTo(0.3, 9);
    expect(a.sd([0, H - 1, 0])).toBeCloseTo(1, 9);
    expect(a.sd([0, H / 2, 0])).toBeCloseTo(H / 2, 9);
  });

  it("le sol est à y = 0 et le plafond à 20,44 m", () => {
    expect(a.sd([5, 0, -7])).toBeCloseTo(0, 9);
    expect(a.sd([5, H, -7])).toBeCloseTo(0, 9);
    expect(a.sd([5, -2, -7])).toBeLessThan(0);
    expect(a.sd([5, H + 2, -7])).toBeLessThan(0);
  });

  it("murs latéraux à ±40,96 m (hors raccords)", () => {
    expect(a.sd([STADE.demiLargeur - 0.1, 10, 0])).toBeCloseTo(0.1, 9);
    expect(a.sd([-STADE.demiLargeur + 0.1, 10, 12])).toBeCloseTo(0.1, 9);
    expect(a.sd([STADE.demiLargeur, 10, 0])).toBeCloseTo(0, 9);
    expect(a.sd([STADE.demiLargeur + 0.5, 10, 0])).toBeCloseTo(-0.5, 9);
  });

  it("murs de fond à ±51,20 m hors de la cage", () => {
    expect(a.sd([20, 10, STADE.demiLongueur - 0.1])).toBeCloseTo(0.1, 9);
    expect(a.sd([-20, 10, -STADE.demiLongueur + 0.1])).toBeCloseTo(0.1, 9);
    expect(a.sd([20, 10, STADE.demiLongueur + 0.3])).toBeCloseTo(-0.3, 9);
  });

  it("les pans coupés sont des plans à 45° (|x| + |z| = 80,64)", () => {
    const m: Vec3 = [(40.96 + 29.44) / 2, 10, (39.68 + 51.2) / 2]; // milieu de l'arête coupée
    const n = Math.SQRT1_2;
    expect(a.sd([m[0] - 0.5 * n, 10, m[2] - 0.5 * n])).toBeCloseTo(0.5, 9);
    expect(a.sd([m[0], 10, m[2]])).toBeCloseTo(0, 9);
    expect(a.sd([-m[0] + 0.5 * n, 10, -m[2] + 0.5 * n])).toBeCloseTo(0.5, 9);
    expect(GEOMETRIE_ARENE.coupe).toBeCloseTo(80.64, 9);
  });

  it("raccord sol/mur : à 45° le coin est arrondi de r(√2 − 1)", () => {
    expect(a.sd([STADE.demiLargeur, 0, 0])).toBeCloseTo(-R * (Math.SQRT2 - 1), 9);
    expect(a.sd([STADE.demiLargeur, H, 0])).toBeCloseTo(-R * (Math.SQRT2 - 1), 9);
    // le point du coin arrondi sur la diagonale
    const t = R * (1 - Math.SQRT1_2);
    expect(a.sd([STADE.demiLargeur - t, t, 0])).toBeCloseTo(0, 9);
  });

  it("arête verticale entre le mur et le pan coupé (angle de 135°) arrondie de r", () => {
    // distance du sommet à l'arc : r / sin(67,5°) - r
    const ecart = R / Math.sin((67.5 * Math.PI) / 180) - R;
    expect(a.sd([40.96, 10, 39.68])).toBeCloseTo(-ecart, 9);
    expect(a.sd([-40.96, 10, -39.68])).toBeCloseTo(-ecart, 9);
  });

  it("les dimensions dérivées valent les valeurs officielles", () => {
    expect(STADE.demiLargeur * 2).toBeCloseTo(81.92, 9);
    expect(STADE.demiLongueur * 2).toBeCloseTo(102.4, 9);
    expect(STADE.hauteur).toBeCloseTo(20.48, 9); // RocketSim ARENA_HEIGHT = 2048 uu
    expect(GEOMETRIE_ARENE.fondBut).toBeCloseTo(60, 9);
    expect(BUT.demiLargeur * 2).toBeCloseTo(17.8551, 9); // RocketSim APPROX_GOAL_HALF_WIDTH = 892,755 uu
  });
});

describe("arène : cages", () => {
  const W = BUT.demiLargeurParoi, RI = BUT.rayonInterieur, HP = BUT.hauteurPlafond, ZM = STADE.demiLongueur;
  /** sol de la cage à la profondeur d : plat, puis en pente douce jusqu'au pied du demi-cylindre */
  const solCage = (d: number): number => (d <= BUT.penteSolDebut ? 0 : (BUT.hauteurPenteSol * (d - BUT.penteSolDebut)) / (BUT.profondeurCentreFond - BUT.penteSolDebut));

  it("l'intérieur d'une cage est libre, le plancher plat jusqu'à 2,35 m puis en pente douce (2,26°), sans marche", () => {
    const pente = Math.atan(BUT.hauteurPenteSol / (BUT.profondeurCentreFond - BUT.penteSolDebut));
    expect((pente * 180) / Math.PI).toBeCloseTo(2.26, 2);
    for (const s of [1, -1]) {
      for (let z = 44; z <= ZM + BUT.penteSolDebut - 0.05; z += 0.4) {
        expect(a.sd([0, 0.2, s * z])).toBeCloseTo(0.2, 9);
        expect(a.sd([5, 0.01, s * z])).toBeCloseTo(0.01, 9);
      }
      // sur la pente : distance au plan incliné (loin des raccords)
      for (let d = 3; d <= 6; d += 0.5) {
        expect(a.sd([0, 0.6, s * (ZM + d)])).toBeCloseTo((0.6 - solCage(d)) * Math.cos(pente), 6);
      }
      expect(a.sd([0, 3, s * 53])).toBeCloseTo(3, 9);
    }
  });

  it("parois de la cage : côtés (8,96 m), plafond plat (6,40 m), pente du plafond, demi-cylindre du fond", () => {
    expect(W).toBeCloseTo(8.96, 9);
    expect(HP).toBeCloseTo(6.4, 9);
    expect(a.sd([W - 0.5, 3, 55])).toBeCloseTo(0.5, 6);
    expect(a.sd([-W + 0.5, 3, -55])).toBeCloseTo(0.5, 6);
    expect(a.sd([0, HP - 0.5, ZM + 1.5])).toBeCloseTo(0.5, 6);
    // le point le plus profond (d = 8,80 m) est à la hauteur du centre du demi-cylindre
    expect(a.sd([0, BUT.hauteurCentreFond, GEOMETRIE_ARENE.fondBut - 0.5])).toBeCloseTo(0.5, 6);
    expect(a.sd([0, BUT.hauteurCentreFond, -GEOMETRIE_ARENE.fondBut + 0.5])).toBeCloseTo(0.5, 6);
    // ailleurs sur le demi-cylindre : rayon 2,40 m autour de (d = 6,40 ; y = 2,56)
    for (const ang of [-1.2, -0.6, 0, 0.6, 1.1]) {
      const p: Vec3 = [3, BUT.hauteurCentreFond + 1.9 * Math.sin(ang), ZM + BUT.profondeurCentreFond + 1.9 * Math.cos(ang)];
      expect(a.sd(p)).toBeCloseTo(BUT.rayonFond - 1.9, 6);
      const n = a.normale(p);
      expect(n[1]).toBeCloseTo(-Math.sin(ang), 9);
      expect(n[2]).toBeCloseTo(-Math.cos(ang), 9);
    }
    // pente du plafond : tangente au demi-cylindre, ≈ 17,6° (maillage RL : 17,5°)
    const th = PROFIL_CAGE.pentePlafond;
    expect((th * 180) / Math.PI).toBeGreaterThan(17.4);
    expect((th * 180) / Math.PI).toBeLessThan(17.8);
    const pied: [number, number] = [4, HP - Math.tan(th) * (4 - BUT.plafondPlatJusqua)];
    const p: Vec3 = [2, pied[1] - 0.4 * Math.cos(th), ZM + pied[0] - 0.4 * Math.sin(th)];
    expect(a.sd(p)).toBeCloseTo(0.4, 6);
    const n = a.normale(p);
    expect(n[1]).toBeCloseTo(-Math.cos(th), 9);
    expect(n[2]).toBeCloseTo(-Math.sin(th), 9);
  });

  it("raccords concaves de RI partout dans la cage : sol / paroi, plafond / paroi, fond / paroi (plus d'angle vif)", () => {
    expect(RI).toBeGreaterThan(0.9);
    // sur la bissectrice du coin sol / paroi, la surface est l'arc de rayon RI (un angle vif donnerait exactement t)
    for (const t of [0.05, 0.2, 0.4, 0.6]) {
      expect(a.sd([W - t, t, 53])).toBeCloseTo(RI - Math.SQRT2 * (RI - t), 9);
      expect(a.sd([-(W - t), HP - t, -ZM - 1])).toBeCloseTo(RI - Math.SQRT2 * (RI - t), 9);
    }
    // la surface du raccord sol / paroi passe au point de l'arc à 45°
    const k = RI * (1 - Math.SQRT1_2);
    expect(a.sd([W - k, k, 53])).toBeCloseTo(0, 9);
    // paroi / fond : arc de RI en plan, à la hauteur du centre du cylindre
    const kf = RI * (1 - Math.SQRT1_2);
    expect(a.sd([W - kf, BUT.hauteurCentreFond, GEOMETRIE_ARENE.fondBut - kf])).toBeCloseTo(0, 9);
    // la normale tourne continûment en faisant le tour du coin sol / paroi (une arête vive sauterait de 90°)
    let prev: Vec3 | null = null;
    for (let deg = 0; deg <= 90; deg += 3) {
      const ang = (deg * Math.PI) / 180;
      const p: Vec3 = [W - RI + (RI - 0.3) * Math.sin(ang), RI - (RI - 0.3) * Math.cos(ang), 53];
      const n = a.normale(p);
      if (prev) expect(Math.acos(Math.min(1, n[0] * prev[0] + n[1] * prev[1] + n[2] * prev[2]))).toBeLessThan(0.06);
      prev = n;
    }
  });

  it("la matière entoure la cage : poteaux, barre transversale, derrière le fond", () => {
    expect(a.sd([BUT.demiLargeur + 1, 3, 55])).toBeLessThan(0);
    expect(a.sd([0, BUT.hauteur + 1, 55])).toBeLessThan(0);
    expect(a.sd([0, 3, GEOMETRIE_ARENE.fondBut + 1])).toBeLessThan(0);
    // devant la barre transversale, côté terrain, c'est libre
    expect(a.sd([0, BUT.hauteur + 1, 50])).toBeGreaterThan(0);
    // au-dessus de l'ouverture, dans l'épaisseur du mur de fond
    expect(a.sd([0, BUT.hauteur + 0.3, STADE.demiLongueur + 0.5])).toBeLessThan(0);
  });

  it("l'ouverture de la collision mesure 17,92 × 6,40 m (maillage RL), un peu plus que les seuils de marque (17,86 × 6,43 m)", () => {
    const k = BUT.rayonArete;
    // juste dans l'ouverture, au ras du poteau : positif ; juste hors de l'ouverture : négatif (à k près pour l'arrondi)
    expect(a.sd([W - 0.05, 3, STADE.demiLongueur + 0.05])).toBeGreaterThan(-k);
    expect(a.sd([BUT.demiLargeur - 0.05, 3, STADE.demiLongueur + 0.05])).toBeGreaterThan(0);
    expect(a.sd([W + 0.3, 3, STADE.demiLongueur + 0.05])).toBeLessThan(0);
    expect(a.sd([0, HP + 0.3, STADE.demiLongueur + 0.05])).toBeLessThan(0);
    expect(a.sd([0, HP - 0.3, STADE.demiLongueur + 0.05])).toBeGreaterThan(0);
    // la cage tient dans les seuils de `butMarque` / `dansCage`
    expect(W).toBeGreaterThan(BUT.demiLargeur);
    expect(W - BUT.demiLargeur).toBeLessThan(0.05);
    expect(HP).toBeLessThan(BUT.hauteur);
  });

  it("les poteaux et la barre sont arrondis : la normale y varie continûment", () => {
    // on tourne autour de l'arête du poteau (x = 8,93 ; z = 51,2) à 0,6 m : la normale ne saute jamais de plus de 0,4 rad par 2° (une arête vive donnerait 1,57)
    const cx = BUT.demiLargeur, cz = STADE.demiLongueur;
    let prev: Vec3 | null = null;
    for (let deg = 90; deg <= 360; deg += 2) {
      const ang = (deg * Math.PI) / 180;
      const p: Vec3 = [cx + 0.6 * Math.cos(ang), 3, cz + 0.6 * Math.sin(ang)];
      const n = a.normale(p);
      if (prev) {
        const cos = Math.max(-1, Math.min(1, n[0] * prev[0] + n[1] * prev[1] + n[2] * prev[2]));
        expect(Math.acos(cos)).toBeLessThan(0.4);
      }
      prev = n;
    }
  });
});

describe("arène : symétries et continuité", () => {
  const rng = creerRng(7);
  const points: Vec3[] = [];
  for (let i = 0; i < 2000; i++) points.push([(tirer(rng) * 2 - 1) * 46, tirer(rng) * 24 - 2, (tirer(rng) * 2 - 1) * 66]);

  it("sd(x, y, z) = sd(-x, y, z) = sd(x, y, -z)", () => {
    for (const [x, y, z] of points) {
      const s = a.sd([x, y, z]);
      expect(a.sd([-x, y, z])).toBeCloseTo(s, 9);
      expect(a.sd([x, y, -z])).toBeCloseTo(s, 9);
    }
  });

  it("sd est 1-Lipschitz (donc continue) sur 2 000 paires de points voisins", () => {
    const r2 = creerRng(11);
    for (const p of points) {
      const d: Vec3 = [(tirer(r2) - 0.5) * 0.02, (tirer(r2) - 0.5) * 0.02, (tirer(r2) - 0.5) * 0.02];
      const q: Vec3 = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
      const dist = Math.hypot(d[0], d[1], d[2]);
      expect(Math.abs(a.sd(p) - a.sd(q))).toBeLessThanOrEqual(dist * 1.0001 + 1e-9);
    }
  });

  it("la salle est entièrement libre à l'intérieur et la matière commence au-delà des murs", () => {
    expect(a.sd([30, 10, 30])).toBeGreaterThan(0);
    expect(a.sd([60, 10, 0])).toBeLessThan(0);
    expect(a.sd([0, 10, 70])).toBeLessThan(0);
    expect(a.sd([0, 10, -70])).toBeLessThan(0);
    // un coin coupé : le point du rectangle d'origine est dans la matière
    expect(a.sd([40, 10, 50])).toBeLessThan(0);
  });
});

describe("arène : normales", () => {
  it("normales des surfaces principales", () => {
    const sol = a.normale([3, 0.5, 4]);
    expect(sol[0]).toBeCloseTo(0, 9); expect(sol[1]).toBeCloseTo(1, 9); expect(sol[2]).toBeCloseTo(0, 9);
    const plafond = a.normale([3, H - 0.5, 4]);
    expect(plafond[1]).toBeCloseTo(-1, 9);
    const murEst = a.normale([STADE.demiLargeur - 0.5, 10, 0]);
    expect(murEst[0]).toBeCloseTo(-1, 9);
    const murOuest = a.normale([-STADE.demiLargeur + 0.5, 10, 0]);
    expect(murOuest[0]).toBeCloseTo(1, 9);
    const fond = a.normale([20, 10, -STADE.demiLongueur + 0.5]);
    expect(fond[2]).toBeCloseTo(1, 9);
    const pan = a.normale([35.2 - 0.5, 10, 45.44 - 0.5]);
    expect(pan[0]).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(pan[2]).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it("la normale est unitaire partout, y compris dans la matière et à l'extérieur", () => {
    const r = creerRng(21);
    for (let i = 0; i < 3000; i++) {
      const p: Vec3 = [(tirer(r) * 2 - 1) * 60, tirer(r) * 30 - 5, (tirer(r) * 2 - 1) * 75];
      const n = a.normale(p);
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 9);
    }
  });

  it("le gradient analytique concorde avec les différences centrées (≥ 98 % des points près des surfaces)", () => {
    const r = creerRng(33);
    const h = 1e-4;
    let ok = 0, total = 0;
    for (let i = 0; i < 3000; i++) {
      const p: Vec3 = [(tirer(r) * 2 - 1) * 44, tirer(r) * 22, (tirer(r) * 2 - 1) * 62];
      const s = a.sd(p);
      if (s < 0.05 || s > 1.5) continue;
      total++;
      const fd: Vec3 = [
        (a.sd([p[0] + h, p[1], p[2]]) - a.sd([p[0] - h, p[1], p[2]])) / (2 * h),
        (a.sd([p[0], p[1] + h, p[2]]) - a.sd([p[0], p[1] - h, p[2]])) / (2 * h),
        (a.sd([p[0], p[1], p[2] + h]) - a.sd([p[0], p[1], p[2] - h])) / (2 * h),
      ];
      const ln = Math.hypot(fd[0], fd[1], fd[2]);
      const n = a.normale(p);
      const cos = (fd[0] * n[0] + fd[1] * n[1] + fd[2] * n[2]) / ln;
      if (cos > 0.9999) ok++;
    }
    expect(total).toBeGreaterThan(200);
    expect(ok / total).toBeGreaterThan(0.98);
  });

  it("|∇sd| ∈ [0,95 ; 1,05] à moins de 1 m des surfaces (hors poteaux et barre)", () => {
    const r = creerRng(44);
    const h = 1e-4;
    let vus = 0;
    for (let i = 0; i < 6000; i++) {
      const p: Vec3 = [(tirer(r) * 2 - 1) * 42, tirer(r) * 21, (tirer(r) * 2 - 1) * 42.5];
      const s = a.sd(p);
      if (Math.abs(s) > 1) continue;
      vus++;
      const g = Math.hypot(
        (a.sd([p[0] + h, p[1], p[2]]) - a.sd([p[0] - h, p[1], p[2]])) / (2 * h),
        (a.sd([p[0], p[1] + h, p[2]]) - a.sd([p[0], p[1] - h, p[2]])) / (2 * h),
        (a.sd([p[0], p[1], p[2] + h]) - a.sd([p[0], p[1], p[2] - h])) / (2 * h),
      );
      expect(g).toBeGreaterThan(0.95);
      expect(g).toBeLessThan(1.05);
    }
    expect(vus).toBeGreaterThan(200);
  });

  it("sdNormale rend le même sd et la même normale que sd et normale, sans allouer", () => {
    const n: Vec3 = [0, 0, 0];
    const p: Vec3 = [12, 3.3, -47.5];
    const s = a.sdNormale(p, n);
    expect(s).toBe(a.sd(p));
    expect(n).toEqual(a.normale(p));
  });
});

describe("arène : but marqué et cage", () => {
  const r = BALLE.rayon;
  it("balle au centre du but : détectée pour la bonne équipe", () => {
    expect(a.butMarque([0, 1, 56], r)).toBe("bleue");
    expect(a.butMarque([0, 1, -56], r)).toBe("orange");
    expect(a.butMarque([7, BALLE.hauteurEngagement, 59], r)).toBe("bleue");
    expect(a.butMarque([-7, 3, -59], r)).toBe("orange");
  });

  it("pas de faux positif sur la ligne : il faut que la balle soit ENTIÈREMENT passée", () => {
    const seuil = BUT.seuilMarque + r;
    expect(a.butMarque([0, 1, STADE.demiLongueur], r)).toBeNull();
    expect(a.butMarque([0, 1, STADE.demiLongueur + r], r)).toBeNull();
    expect(a.butMarque([0, 1, seuil - 0.001], r)).toBeNull();
    expect(a.butMarque([0, 1, seuil], r)).toBeNull();
    expect(a.butMarque([0, 1, seuil + 0.001], r)).toBe("bleue");
    expect(a.butMarque([0, 1, -(seuil - 0.001)], r)).toBeNull();
    expect(a.butMarque([0, 1, -(seuil + 0.001)], r)).toBe("orange");
  });

  it("hors de l'ouverture (poteau, au-dessus de la barre, loin) : jamais de but", () => {
    expect(a.butMarque([BUT.demiLargeur + 0.5, 1, 56], r)).toBeNull();
    expect(a.butMarque([0, BUT.hauteur + r + 0.5, 56], r)).toBeNull();
    expect(a.butMarque([0, 1, 0], r)).toBeNull();
    expect(a.butMarque([30, 5, 40], r)).toBeNull();
    expect(a.butMarque([0, 1, 70], r)).toBeNull();
  });

  it("dansCage : l'équipe qui DÉFEND la cage", () => {
    expect(a.dansCage([0, 1, 55])).toBe("orange");
    expect(a.dansCage([0, 1, -55])).toBe("bleue");
    expect(a.dansCage([0, 1, 0])).toBeNull();
    expect(a.dansCage([BUT.demiLargeur + 0.1, 1, 55])).toBeNull();
    expect(a.dansCage([0, BUT.hauteur + 0.1, 55])).toBeNull();
    expect(a.dansCage([0, 1, 50])).toBeNull();
    expect(a.dansCage([0, 1, 61])).toBeNull();
  });

  it("une balle posée au sol de la cage est libre (sd = son rayon), sur le sol plat comme sur la pente", () => {
    expect(a.sd([0, r, 53])).toBeCloseTo(r, 6);
    expect(a.sd([0, r, 53])).toBeGreaterThanOrEqual(r - 1e-9);
    // à 4,8 m de profondeur, le sol est monté de 9,7 cm : la balle posée y a son centre plus haut d'autant
    const pente = Math.atan(BUT.hauteurPenteSol / (BUT.profondeurCentreFond - BUT.penteSolDebut));
    const sol = Math.tan(pente) * (4.8 - BUT.penteSolDebut);
    expect(sol).toBeCloseTo(0.097, 3);
    expect(a.sd([0, sol + r / Math.cos(pente), 56])).toBeCloseTo(r, 6);
  });
});

describe("arène : plots et coups d'envoi", () => {
  it("34 plots à des positions libres du terrain", () => {
    const plots = plotsDuStade();
    expect(plots.length).toBe(34);
    expect(plots.filter((p) => p.gros).length).toBe(6);
    for (const p of plots) {
      const hc = p.gros ? PLOT.gros.hauteurCentre : PLOT.petit.hauteurCentre;
      const s = a.sd([p.x, hc, p.z]);
      expect(s).toBeGreaterThan(hc - 1e-9);
      // au sol, loin du mur d'au moins un rayon de ramassage
      const rayon = p.gros ? PLOT.gros.rayon : PLOT.petit.rayon;
      expect(a.sd([p.x, 1, p.z])).toBeGreaterThan(0.99);
      expect(STADE.demiLargeur - Math.abs(p.x)).toBeGreaterThan(rayon * 0.9);
      expect(STADE.demiLongueur - Math.abs(p.z)).toBeGreaterThan(rayon * 0.5);
    }
    expect(plots).toBe(PLOTS);
  });

  it("chaque coup d'envoi (bleu et orange) est libre, au sol, loin des murs", () => {
    expect(coupsDEnvoiDuStade()).toBe(COUPS_D_ENVOI);
    for (const equipe of ["bleue", "orange"] as const) {
      for (const pos of COUPS_D_ENVOI) {
        const { x, z, cap } = placeCoupDEnvoi(equipe, pos);
        expect(a.sd([x, VOITURE.hauteurRepos, z])).toBeGreaterThan(VOITURE.hauteurRepos - 1e-9);
        // la voiture (1,2 m de long) tient : les quatre coins de sa boîte à plat sont libres
        const av: Vec3 = [Math.sin(cap), 0, Math.cos(cap)];
        const dr: Vec3 = [av[2], 0, -av[0]];
        for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
          const c: Vec3 = [x + av[0] * 0.6 * sa + dr[0] * 0.42 * sb, 0.2, z + av[2] * 0.6 * sa + dr[2] * 0.42 * sb];
          expect(a.sd(c)).toBeGreaterThan(0.19);
        }
        // chaque équipe démarre de son côté : bleue en Z < 0, orange en Z > 0
        expect(equipe === "bleue" ? z < 0 : z > 0).toBe(true);
      }
    }
  });

  it("l'emplacement orange est celui de la bleue tourné de 180° (le cap pointe toujours vers le terrain)", () => {
    for (const pos of COUPS_D_ENVOI) {
      const b = placeCoupDEnvoi("bleue", pos), o = placeCoupDEnvoi("orange", pos);
      expect(o.x).toBeCloseTo(-b.x, 12);
      expect(o.z).toBeCloseTo(-b.z, 12);
      expect(Math.cos(o.cap)).toBeCloseTo(-Math.cos(b.cap), 12);
      expect(Math.sin(o.cap)).toBeCloseTo(-Math.sin(b.cap), 12);
      // l'avant ne s'éloigne jamais du centre : composante en z orientée vers z = 0
      expect(Math.cos(b.cap) * Math.sign(-b.z)).toBeGreaterThanOrEqual(-1e-12);
      expect(Math.cos(o.cap) * Math.sign(-o.z)).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("le point d'engagement de la balle est libre", () => {
    expect(a.sd([0, BALLE.hauteurEngagement, 0])).toBeGreaterThanOrEqual(BALLE.hauteurEngagement - 1e-9);
  });
});

describe("arène : lancer de rayon et surface proche", () => {
  it("lancerRayon touche le mur, le sol, le plafond, le fond de la cage", () => {
    expect(a.lancerRayon([0, 5, 0], [1, 0, 0], 100)).toBeCloseTo(STADE.demiLargeur, 2);
    expect(a.lancerRayon([0, 5, 0], [-1, 0, 0], 100)).toBeCloseTo(STADE.demiLargeur, 2);
    expect(a.lancerRayon([3, 5, 2], [0, -1, 0], 100)).toBeCloseTo(5, 2);
    expect(a.lancerRayon([0, 5, 0], [0, 1, 0], 100)).toBeCloseTo(H - 5, 2);
    expect(a.lancerRayon([0, BUT.hauteurCentreFond, 0], [0, 0, 1], 100)).toBeCloseTo(GEOMETRIE_ARENE.fondBut, 2);
    expect(a.lancerRayon([0, BUT.hauteurCentreFond, 0], [0, 0, -1], 100)).toBeCloseTo(GEOMETRIE_ARENE.fondBut, 2);
    // plus haut, le rayon touche le demi-cylindre du fond plus près (plus de mur plat à 60 m)
    expect(a.lancerRayon([0, 4, 0], [0, 0, 1], 100)).toBeCloseTo(STADE.demiLongueur + BUT.profondeurCentreFond + Math.sqrt(BUT.rayonFond ** 2 - (4 - BUT.hauteurCentreFond) ** 2), 2);
  });

  it("lancerRayon bute sur le mur de fond à côté de la cage et sur le pan coupé", () => {
    expect(a.lancerRayon([20, 5, 0], [0, 0, 1], 100)).toBeCloseTo(STADE.demiLongueur, 2);
    // vers le milieu de l'arête coupée (35,2 ; 45,44), hors raccords
    expect(a.lancerRayon([0, 5, 0], [35.2, 0, 45.44], 200)).toBeCloseTo(Math.hypot(35.2, 45.44), 2);
  });

  it("lancerRayon rend null au-delà de la portée et 0 depuis la matière", () => {
    expect(a.lancerRayon([0, 5, 0], [1, 0, 0], 10)).toBeNull();
    expect(a.lancerRayon([100, 5, 0], [1, 0, 0], 10)).toBe(0);
  });

  it("lancerRayon n'est pas normalisé par l'appelant : la direction est normalisée en interne", () => {
    expect(a.lancerRayon([0, 5, 0], [10, 0, 0], 100)).toBeCloseTo(STADE.demiLargeur, 2);
  });

  it("surfaceProche projette sur la surface le long de la normale", () => {
    const s = a.surfaceProche([20, 3, 0]);
    expect(s.point[1]).toBeCloseTo(0, 6);
    expect(s.point[0]).toBeCloseTo(20, 6);
    expect(s.normale[1]).toBeCloseTo(1, 6);
    expect(s.distance).toBeCloseTo(3, 6);
    const m = a.surfaceProche([STADE.demiLargeur - 0.7, 10, 5]);
    expect(m.point[0]).toBeCloseTo(STADE.demiLargeur, 6);
    expect(m.normale[0]).toBeCloseTo(-1, 6);
    // depuis la matière on rejoint aussi la surface
    const d = a.surfaceProche([STADE.demiLargeur + 0.4, 10, 5]);
    expect(d.point[0]).toBeCloseTo(STADE.demiLargeur, 6);
    expect(d.distance).toBeCloseTo(0.4, 6);
  });
});

describe("arène : coût", () => {
  it("20 000 évaluations de sd en moins de 100 ms (après échauffement)", () => {
    const r = creerRng(5);
    const pts: Vec3[] = [];
    for (let i = 0; i < 20000; i++) pts.push([(tirer(r) * 2 - 1) * 45, tirer(r) * 21, (tirer(r) * 2 - 1) * 62]);
    let acc = 0;
    for (const p of pts) acc += a.sd(p); // échauffement du JIT
    const t0 = performance.now();
    for (const p of pts) acc += a.sd(p);
    const ms = performance.now() - t0;
    expect(Number.isFinite(acc)).toBe(true);
    expect(ms).toBeLessThan(100);
  });

  it("deux arènes sont indépendantes et donnent les mêmes valeurs", () => {
    const b = creerArene();
    const p: Vec3 = [11.1, 4.2, -49.3];
    expect(b.sd(p)).toBe(a.sd(p));
    expect(b.normale(p)).toEqual(a.normale(p));
  });
});

describe("arène : pied des poteaux et cage sans marche", () => {
  const a = creerArene();
  const W = BUT.demiLargeurParoi, RI = BUT.rayonInterieur, zMur = STADE.demiLongueur;
  /** hauteur de la surface sous un point (rayon vertical depuis 2,9 m) */
  const hauteur = (x: number, z: number): number => 2.9 - (a.lancerRayon([x, 2.9, z], [0, -1, 0], 10) ?? 0);

  it("le raccord du mur du fond vaut RI au poteau, puis s'élargit jusqu'à celui du stade à 18 m", () => {
    expect(rayonRaccordFond(W)).toBeCloseTo(RI, 12);
    expect(rayonRaccordFond(-BUT.raccordPoteauJusqua)).toBeCloseTo(RI, 12);
    expect(rayonRaccordFond(BUT.raccordFondDes)).toBeCloseTo(STADE.rayonSol, 12);
    expect(rayonRaccordFond(30)).toBeCloseTo(STADE.rayonSol, 12);
    for (let x = 10; x < 18; x += 0.25) expect(rayonRaccordFond(x + 0.25)).toBeGreaterThanOrEqual(rayonRaccordFond(x));
  });

  it("le sol au pied des poteaux suit exactement le raccord qui fait le tour du poteau (devant la cage comme le long du mur)", () => {
    let vus = 0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      for (let x = W - 1.6; x <= W + 3; x += 0.13) for (let zm = 0.02; zm <= 1.6; zm += 0.11) {
        // l'arête du poteau elle-même est adoucie par l'union douce : on s'en écarte de 30 cm
        if (Math.hypot(x - W, zm) < 0.3) continue;
        vus++;
        // (le rayon s'arrête à 1 mm de la surface : quelques millimètres d'écart sur les pentes raides du raccord)
        expect(Math.abs(hauteur(sx * x, sz * (zMur - zm)) - hauteurPiedPoteau(x, zm))).toBeLessThan(0.01);
      }
    }
    expect(vus).toBeGreaterThan(400);
    // devant le poteau, plus d'angle vif : à 30 cm du mur, juste à côté du poteau, le raccord ne monte qu'à la hauteur de l'arc de RI
    expect(hauteur(W + 0.4, zMur - 0.3)).toBeCloseTo(RI - Math.sqrt(RI * RI - (RI - 0.3) ** 2), 2);
  });

  it("le long du mur du fond, de la cage jusqu'à 22 m : le raccord monte continûment, sans marche", () => {
    for (const zm of [0.2, 0.4, 0.8]) {
      const z = zMur - zm;
      let prec = hauteur(0, z);
      expect(prec).toBeLessThan(0.002);
      for (let x = 0.01; x <= 22; x += 0.01) {
        const h = hauteur(x, z);
        expect(h).toBeGreaterThanOrEqual(prec - 3e-3);
        // pas plus de 2 cm de dénivelé par centimètre parcouru (pente du raccord), même en passant devant le poteau : aucune marche
        expect(h - prec).toBeLessThan(0.02);
        prec = h;
      }
      const plein = STADE.rayonSol - Math.sqrt(STADE.rayonSol ** 2 - (STADE.rayonSol - zm) ** 2);
      expect(hauteur(22, z)).toBeCloseTo(plein, 2);
    }
  });

  it("de l'entrée au fond de la cage, le sol monte continûment (sol plat, pente, demi-cylindre), sans marche", () => {
    for (const x of [0, 3, 6, W - RI - 0.1, W - 0.6, W - 0.3]) {
      let prec = hauteur(x, zMur - 10);
      expect(prec).toBeLessThan(0.002);
      for (let d = -10; d <= 7; d += 0.02) {
        const h = hauteur(x, zMur + d);
        expect(h).toBeGreaterThanOrEqual(prec - 1e-3);
        expect(h - prec).toBeLessThan(0.02);
        prec = h;
      }
    }
  });

  it("le gradient reste unitaire et la distance continue autour des poteaux et dans la cage", () => {
    const n: [number, number, number] = [0, 0, 0];
    for (let x = W - 3; x <= W + 9; x += 0.37) for (let z = zMur - 4; z < zMur + 8.8; z += 0.31) for (let y = 0.05; y < 6.3; y += 0.33) {
      const s = a.sdNormale([x, y, z], n);
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 6);
      const s2 = a.sd([x + 0.01, y, z]);
      expect(Math.abs(s2 - s)).toBeLessThan(0.0105);
      const s3 = a.sd([x, y, z + 0.01]);
      expect(Math.abs(s3 - s)).toBeLessThan(0.0105);
    }
  });
});

describe("arène : la voiture monte sur les parois de la cage", () => {
  const a = creerArene();
  const W = BUT.demiLargeurParoi, zMur = STADE.demiLongueur;

  /** Fait rouler une voiture accélérateur à fond depuis `p`, cap `cap`, vitesse initiale `v0` ; rend le bilan et l'état final. */
  async function rouler(p: Vec3, cap: number, v0: number, pas: number, suivi?: (v: import("./contrat").EtatVoiture) => void) {
    const { creerVoiture, pasVoiture } = await import("./voiture");
    const { ENTREES_NULLES, PAS_S } = await import("./contrat");
    const v = creerVoiture({ id: 0, equipe: "bleue", slot: 0, humain: true, nom: "essai", p, cap });
    v.v = [Math.sin(cap) * v0, 0, Math.cos(cap) * v0];
    let choc = 0, vMin = Infinity, pasTroisRoues = 0;
    for (let i = 0; i < pas; i++) {
      const evs = pasVoiture(a, v, { ...ENTREES_NULLES(), accel: 1 }, PAS_S, i);
      for (const e of evs) if (e.t === "choc") choc = Math.max(choc, e.vitesse);
      vMin = Math.min(vMin, Math.hypot(v.v[0], v.v[1], v.v[2]));
      if (v.rouesContact >= 3) pasTroisRoues++;
      suivi?.(v);
    }
    return { v, choc, vMin, partTroisRoues: pasTroisRoues / pas };
  }

  it("en fonçant dans la paroi latérale à 20 m/s, la voiture monte dessus par le raccord, sans choc, sur ses roues", async () => {
    for (const s of [-1, 1]) for (const sz of [-1, 1]) {
      let surParoi = false;
      const r = await rouler([0, VOITURE.hauteurRepos, sz * 54], (s * Math.PI) / 2, 20, 90, (v) => { if (v.base.haut[0] * s < -0.7 && v.rouesContact >= 3) surParoi = true; });
      expect(surParoi).toBe(true);
      expect(r.choc).toBeLessThan(3);
      expect(r.partTroisRoues).toBeGreaterThan(0.8);
    }
  });

  it("vers le fond, la voiture remonte le demi-cylindre et se colle au plafond de la cage", async () => {
    for (const sz of [-1, 1]) {
      let auPlafond = false, rouesSurArc = 4;
      const r = await rouler([0, VOITURE.hauteurRepos, sz * 52], sz > 0 ? 0 : Math.PI, 18, 150, (v) => {
        if (v.base.haut[1] < -0.5 && v.rouesContact >= 3) auPlafond = true;
        if (Math.abs(v.p[2]) > zMur + 6 && Math.abs(v.p[2]) < zMur + 8.8) rouesSurArc = Math.min(rouesSurArc, v.rouesContact);
      });
      expect(auPlafond).toBe(true);
      expect(rouesSurArc).toBeGreaterThanOrEqual(3);
      expect(r.choc).toBeLessThan(3);
    }
  });

  it("depuis la paroi latérale, la voiture monte jusqu'au plafond de la cage", async () => {
    // cap vers la paroi, légèrement vers le fond : la voiture monte la paroi puis passe le raccord paroi / plafond
    let auPlafond = false;
    await rouler([2, VOITURE.hauteurRepos, 53.5], Math.PI / 2 - 0.12, 20, 180, (v) => { if (v.base.haut[1] < -0.8 && v.p[1] > 5.5) auPlafond = true; });
    expect(auPlafond).toBe(true);
  });

  it("en fonçant dans le pied d'un poteau (dedans, dessus ou dehors), la voiture monte sur un arrondi, sans choc", async () => {
    for (const x of [W - 0.6, W, W + 0.6]) for (const v0 of [10, 20]) {
      // de 5 m devant la ligne de but jusqu'à 3 m derrière (le fond de la cage, plus loin, est un autre sujet)
      const r = await rouler([x, VOITURE.hauteurRepos, zMur - 5], 0, v0, Math.round(8 / v0 / (1 / 120)));
      expect(r.choc, `x = ${x}, ${v0} m/s`).toBeLessThan(3);
    }
  });

  it("une voiture qui longe le mur du fond traverse la cage et passe devant les poteaux sans choc, sans ralentir, sur ses roues", async () => {
    for (const sens of [-1, 1]) for (const zm of [0.6, 1.2]) {
      const r = await rouler([0, VOITURE.hauteurRepos, zMur - zm], (sens * Math.PI) / 2, 0, 240);
      expect(r.choc).toBeLessThan(1);
      expect(Math.abs(r.v.p[0])).toBeGreaterThan(W + 3);
      expect(Math.hypot(r.v.v[0], r.v.v[1], r.v.v[2])).toBeGreaterThan(9);
      expect(r.v.rouesContact).toBeGreaterThanOrEqual(2);
    }
  });
});
