import { describe, expect, it } from "vitest";
import { BALLE, BUT, COUPS_D_ENVOI, PLOT, PLOTS, STADE, VOITURE, creerRng, tirer } from "./contrat";
import type { Vec3 } from "./contrat";
import { GEOMETRIE_ARENE, coupsDEnvoiDuStade, creerArene, placeCoupDEnvoi, plotsDuStade } from "./arene";

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
    expect(STADE.hauteur).toBeCloseTo(20.44, 9);
    expect(GEOMETRIE_ARENE.fondBut).toBeCloseTo(60, 9);
    expect(BUT.demiLargeur * 2).toBeCloseTo(17.86, 9);
  });
});

describe("arène : cages", () => {
  it("l'intérieur d'une cage est libre, le plancher plat et sans marche jusqu'au fond", () => {
    for (const s of [1, -1]) {
      for (let z = 44; z <= 59.6; z += 0.4) {
        expect(a.sd([0, 0.2, s * z])).toBeCloseTo(0.2, 9);
        expect(a.sd([5, 0.01, s * z])).toBeCloseTo(0.01, 9);
      }
      expect(a.sd([0, 3, s * 56])).toBeCloseTo(3, 9);
    }
  });

  it("parois de la cage : côtés, plafond, fond", () => {
    expect(a.sd([BUT.demiLargeur - 0.5, 3, 55])).toBeCloseTo(0.5, 6);
    expect(a.sd([-BUT.demiLargeur + 0.5, 3, -55])).toBeCloseTo(0.5, 6);
    expect(a.sd([0, BUT.hauteur - 0.5, 55])).toBeCloseTo(0.5, 6);
    expect(a.sd([0, 3, GEOMETRIE_ARENE.fondBut - 0.5])).toBeCloseTo(0.5, 6);
    expect(a.sd([0, 3, -GEOMETRIE_ARENE.fondBut + 0.5])).toBeCloseTo(0.5, 6);
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

  it("l'ouverture de la cage mesure 17,86 × 6,42775 m (poteau et barre à la distance prévue)", () => {
    const k = BUT.rayonArete;
    // juste dans l'ouverture, au ras du poteau : positif ; juste hors de l'ouverture : négatif (à k près pour l'arrondi)
    expect(a.sd([BUT.demiLargeur - 0.05, 3, STADE.demiLongueur + 0.05])).toBeGreaterThan(-k);
    expect(a.sd([BUT.demiLargeur + 0.3, 3, STADE.demiLongueur + 0.05])).toBeLessThan(0);
    expect(a.sd([0, BUT.hauteur + 0.3, STADE.demiLongueur + 0.05])).toBeLessThan(0);
    expect(a.sd([0, BUT.hauteur - 0.3, STADE.demiLongueur + 0.05])).toBeGreaterThan(0);
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

  it("une balle posée au sol au milieu de la cage est libre (sd = son rayon à la hauteur du centre)", () => {
    expect(a.sd([0, r, 56])).toBeCloseTo(r, 6);
    expect(a.sd([0, r, 56])).toBeGreaterThanOrEqual(r - 1e-9);
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
    expect(a.lancerRayon([0, 3, 0], [0, 0, 1], 100)).toBeCloseTo(GEOMETRIE_ARENE.fondBut, 2);
    expect(a.lancerRayon([0, 3, 0], [0, 0, -1], 100)).toBeCloseTo(GEOMETRIE_ARENE.fondBut, 2);
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

describe("arène : biseau des raccords à côté des poteaux", () => {
  const a = creerArene();
  const hw = BUT.demiLargeur, zMur = STADE.demiLongueur;
  /** hauteur de la surface sous un point (rayon vertical) */
  const hauteur = (x: number, z: number): number => 6 - (a.lancerRayon([x, 6, z], [0, -1, 0], 10) ?? 0);

  it("au poteau le mur tombe droit sur le sol : rien ne dépasse dans le terrain", () => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      // juste à côté du poteau, à 30 cm du mur : le sol est plat (il était à 1,36 m avec le raccord arrondi)
      expect(hauteur(sx * (hw + 0.4), sz * (zMur - 0.3))).toBeLessThan(0.25);
      // un point bas devant le mur, à côté du poteau, est libre
      expect(a.sd([sx * (hw + 0.5), 0.4, sz * (zMur - 0.8)])).toBeGreaterThan(0.1);
    }
  });

  it("le raccord remonte en pente douce depuis le poteau et retrouve sa forme au bout du biseau", () => {
    const z = zMur - 0.3;
    let prec = hauteur(hw + 0.2, z);
    for (let x = hw + 0.6; x <= hw + BUT.longueurBiseau + 2; x += 0.4) {
      const h = hauteur(x, z);
      expect(h).toBeGreaterThanOrEqual(prec - 1e-3);
      // jamais de marche : au plus 25 cm de dénivelé pour 40 cm parcourus
      expect(h - prec).toBeLessThan(0.25);
      prec = h;
    }
    const plein = STADE.rayonSol - Math.sqrt(STADE.rayonSol ** 2 - (STADE.rayonSol - 0.3) ** 2);
    expect(hauteur(hw + BUT.longueurBiseau + 2, z)).toBeCloseTo(plein, 1);
    expect(hauteur(22, z)).toBeCloseTo(plein, 2);
  });

  it("une voiture qui longe le mur du fond traverse la cage et le biseau sans choc", async () => {
    const { creerVoiture, pasVoiture } = await import("./voiture");
    const { ENTREES_NULLES, PAS_S, VOITURE } = await import("./contrat");
    for (const sens of [-1, 1]) {
      // départ dans l'axe de la cage, à 1 m du mur, cap vers le côté
      const v = creerVoiture({ id: 0, equipe: "bleue", slot: 0, humain: true, nom: "essai", p: [0, VOITURE.hauteurRepos, zMur - 1.2], cap: (sens * Math.PI) / 2 });
      let choc = 0, vMin = Infinity;
      for (let i = 0; i < 240; i++) {
        const evs = pasVoiture(a, v, { ...ENTREES_NULLES(), accel: 1 }, PAS_S, i);
        for (const e of evs) if (e.t === "choc") choc = Math.max(choc, e.vitesse);
        if (i > 120) vMin = Math.min(vMin, Math.hypot(v.v[0], v.v[1], v.v[2]));
      }
      expect(choc).toBe(0);
      expect(Math.abs(v.p[0])).toBeGreaterThan(hw + 3);
      expect(vMin).toBeGreaterThan(6);
    }
  });

  it("le gradient reste unitaire et la distance continue dans le biseau", () => {
    const n: [number, number, number] = [0, 0, 0];
    for (let x = hw - 1; x <= hw + 9; x += 0.37) for (let z = zMur - 4; z < zMur; z += 0.31) for (let y = 0.05; y < 4; y += 0.33) {
      const s = a.sdNormale([x, y, z], n);
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 6);
      const s2 = a.sd([x + 0.01, y, z]);
      expect(Math.abs(s2 - s)).toBeLessThan(0.011);
    }
  });
});
