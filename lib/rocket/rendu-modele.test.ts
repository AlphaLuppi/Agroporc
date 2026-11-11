import { describe, expect, it } from "vitest";
import { BALLE, BUT, PLOT, PLOTS, STADE, VOITURE, type EtatPlot } from "./contrat";
import { creerArene } from "./arene";
import {
  FLOATS_ROUE, GABARITS, GRADINS, LARGEUR_LIGNE, LUM, PALETTE, PROFIL, PROFIL_OCTANE, RAYON_COQUE, RAYON_ROND_CENTRAL, SEUIL_BLOOM,
  ajusterLuminance, avancerRoulement, braquageRoues, construireNappe, couleurBalle, couleurEquipe, couleurMur, couleurPlot, couleurSol,
  creerContour, dansOuvertureBut, dansPolygoneConvexe, directionsFibonacci, disposerGradins, distancePrisme, eventail, grilleContour, grilleProfil,
  geometrieCage, integrerQuat, interpolerPosition, intensiteChoc, intensiteTrainee, lignesTerrain, luminance, nombreParticules, ombreBalle,
  placesPublic, pointCoque, pointContour, polygonePlat, pulsationBut, rgbLineaire, segmentsHexCoque, segmentsHexPlafond, segmentsMotifBalle,
  segmentsRoue, solCage, sommetsRetrecis, texteTableau, visuelPlot, type PointContour,
} from "./rendu-modele";

describe("couleurs", () => {
  it("convertit le sRGB en linéaire", () => {
    expect(rgbLineaire(0xffffff)).toEqual([1, 1, 1]);
    expect(rgbLineaire(0x000000)).toEqual([0, 0, 0]);
    expect(rgbLineaire(0x808080)[0]).toBeCloseTo(0.2158, 3);
  });
  it("les équipes passent le seuil du bloom, le sol et les murs ordinaires non", () => {
    expect(luminance(couleurEquipe("bleue"))).toBeGreaterThan(SEUIL_BLOOM);
    expect(luminance(couleurEquipe("orange"))).toBeGreaterThan(SEUIL_BLOOM);
    expect(luminance(rgbLineaire(PALETTE.sol))).toBeLessThan(0.02);
    expect(luminance(couleurSol(0, -20))).toBeLessThan(0.05);
    // mur au milieu du terrain : sous le seuil ; devant une cage : au-dessus (seul décor qui bloome)
    expect(luminance(couleurMur(30, 5, 0))).toBeLessThan(SEUIL_BLOOM);
    expect(luminance(couleurMur(0, 3, 51))).toBeGreaterThan(SEUIL_BLOOM);
  });
  it("ajuste la luminosité sans changer la teinte", () => {
    const c = ajusterLuminance(rgbLineaire(PALETTE.cyan), 0.1);
    expect(luminance(c)).toBeCloseTo(0.1, 9);
    expect(c[2] / c[0]).toBeCloseTo(rgbLineaire(PALETTE.cyan)[2] / rgbLineaire(PALETTE.cyan)[0], 6);
  });
  it("plots : actifs au-dessus du bloom, inactifs en dessous", () => {
    expect(luminance(couleurPlot(true, true))).toBeGreaterThan(SEUIL_BLOOM);
    expect(luminance(couleurPlot(false, true))).toBeGreaterThan(SEUIL_BLOOM);
    expect(luminance(couleurPlot(true, false))).toBeLessThan(0.05);
  });
  it("la balle est neutre puis prend la couleur de la dernière équipe", () => {
    expect(Math.abs(couleurBalle(null)[0] - couleurBalle(null)[2])).toBeLessThan(0.1);
    expect(couleurBalle("bleue")[2]).toBeGreaterThan(couleurBalle("bleue")[0]);
    expect(couleurBalle("orange")[0]).toBeGreaterThan(couleurBalle("orange")[2]);
  });
  it("LUM des décors est sous le seuil", () => {
    expect(LUM.mur).toBeLessThan(SEUIL_BLOOM);
    expect(LUM.gradin).toBeLessThan(SEUIL_BLOOM);
    expect(LUM.public).toBeLessThan(SEUIL_BLOOM);
  });
});

describe("contour et coque du stade", () => {
  const c = creerContour();
  it("tous les raccords ont le même rayon (la SDF le suppose)", () => {
    expect(STADE.rayonSol).toBe(RAYON_COQUE);
    expect(STADE.rayonPlafond).toBe(RAYON_COQUE);
    expect(STADE.rayonCoin).toBe(RAYON_COQUE);
  });
  it("le polygone rétréci est celui de la spec", () => {
    const s = sommetsRetrecis();
    expect(s).toHaveLength(8);
    const r = RAYON_COQUE;
    for (const [x, z] of s) {
      expect(Math.abs(x)).toBeLessThanOrEqual(STADE.demiLargeur - r + 1e-9);
      expect(Math.abs(z)).toBeLessThanOrEqual(STADE.demiLongueur - r + 1e-9);
      expect(Math.abs(x) + Math.abs(z)).toBeLessThanOrEqual(80.64 - r * Math.SQRT2 + 1e-9);
    }
    // 77,02 m : le plan de coupe rétréci
    expect(Math.abs(s[0][0]) + Math.abs(s[0][1])).toBeCloseTo(80.64 - r * Math.SQRT2, 6);
  });
  it("la longueur du contour = arêtes + 2π r d'arcs, avec 8 arêtes et 8 arcs", () => {
    expect(c.pieces.filter((p) => p.type === "arete")).toHaveLength(8);
    expect(c.pieces.filter((p) => p.type === "arc")).toHaveLength(8);
    let aretes = 0;
    for (const p of c.pieces) if (p.type === "arete") aretes += p.u1 - p.u0;
    expect(c.longueur).toBeCloseTo(aretes + 2 * Math.PI * RAYON_COQUE, 6);
    // deux arêtes de fond, une par but
    expect(c.pieces.filter((p) => p.fond === 1)).toHaveLength(1);
    expect(c.pieces.filter((p) => p.fond === -1)).toHaveLength(1);
  });
  it("le contour est continu et les normales unitaires, sortantes", () => {
    const t: PointContour = { x: 0, z: 0, nx: 0, nz: 0 };
    let px = 0, pz = 0;
    pointContour(c, 0, t); px = t.x + t.nx * RAYON_COQUE; pz = t.z + t.nz * RAYON_COQUE;
    for (let u = 0.05; u < c.longueur; u += 0.05) {
      pointContour(c, u, t);
      expect(Math.hypot(t.nx, t.nz)).toBeCloseTo(1, 6);
      expect(t.x * t.nx + t.z * t.nz).toBeGreaterThan(0);
      const x = t.x + t.nx * RAYON_COQUE, z = t.z + t.nz * RAYON_COQUE;
      expect(Math.hypot(x - px, z - pz)).toBeLessThan(0.06);
      px = x; pz = z;
    }
  });
  /** zone du biseau à côté des poteaux : le raccord de sol y est raboté (cf. `biseauterCoque`) */
  const dansBiseau = (x: number, y: number, z: number): boolean =>
    y < RAYON_COQUE && Math.abs(z) > STADE.demiLongueur - RAYON_COQUE - 1e-6 && Math.abs(x) > BUT.demiLargeur - 1e-6 && Math.abs(x) < BUT.demiLargeur + BUT.longueurBiseau + 1e-6;
  it("à côté des poteaux, la coque dessinée suit le biseau de la collision (écart < 20 cm) et ne dépasse plus au poteau", () => {
    const arene = creerArene();
    let vus = 0;
    for (let i = 0; i < 4000; i++) {
      const u = c.longueur * ((i * 0.6180339) % 1), v = PROFIL.quart * ((i * 0.4142135) % 1);
      const p = pointCoque(c, u, v);
      if (!dansBiseau(p[0], p[1], p[2]) || Math.abs(p[0]) < BUT.demiLargeur + 0.05) continue;
      vus++;
      expect(Math.abs(arene.sd(p))).toBeLessThan(0.2);
      // à 50 cm du poteau, il ne reste du raccord qu'une vingtaine de centimètres : tout le reste est à plat sur le mur du fond
      if (Math.abs(p[0]) < BUT.demiLargeur + 0.5) expect(p[1] < 0.25 || STADE.demiLongueur - Math.abs(p[2]) < 0.02).toBe(true);
    }
    expect(vus).toBeGreaterThan(40);
  });
  it("les points de la coque sont sur la surface de la SDF (distance au prisme = r)", () => {
    for (let i = 0; i < 400; i++) {
      const u = (c.longueur * ((i * 0.6180339) % 1)), v = PROFIL.longueur * ((i * 0.4142135) % 1);
      const p = pointCoque(c, u, v);
      if (dansBiseau(p[0], p[1], p[2])) continue;
      expect(distancePrisme(p[0], p[1], p[2])).toBeCloseTo(RAYON_COQUE, 6);
    }
  });
  it("le profil va du sol au plafond", () => {
    const bas = pointCoque(c, 3, 0), haut = pointCoque(c, 3, PROFIL.longueur);
    expect(bas[1]).toBeCloseTo(0, 9);
    expect(haut[1]).toBeCloseTo(STADE.hauteur, 9);
    // mur droit à 40,96 m sur le côté
    const cote = c.pieces.find((p) => p.type === "arete" && p.n[0] > 0.999)!;
    expect(pointCoque(c, (cote.u0 + cote.u1) / 2, PROFIL.quart + 5)[0]).toBeCloseTo(STADE.demiLargeur, 6);
  });
  it("la grille tombe pile sur les montants des buts et sur la barre transversale", () => {
    const us = grilleContour(c, 1.5), vs = grilleProfil();
    expect(us[0]).toBe(0);
    expect(us[us.length - 1]).toBe(c.longueur);
    for (let i = 1; i < us.length; i++) expect(us[i]).toBeGreaterThan(us[i - 1]);
    for (const xm of [-BUT.demiLargeur, BUT.demiLargeur]) {
      expect(us.some((u) => { const p = pointCoque(c, u, PROFIL.quart + 1); return Math.abs(p[0] - xm) < 1e-6 && Math.abs(Math.abs(p[2]) - STADE.demiLongueur) < 1e-6; })).toBe(true);
    }
    expect(vs.some((v) => Math.abs(pointCoque(c, 3, v)[1] - BUT.hauteur) < 1e-6)).toBe(true);
    for (let j = 1; j < vs.length; j++) expect(vs[j]).toBeGreaterThan(vs[j - 1]);
  });
  it("la nappe de murs omet exactement l'ouverture des deux buts", () => {
    const us = grilleContour(c, 1.5), vs = grilleProfil();
    const avec = construireNappe(c, us, vs, 0, PROFIL.longueur, couleurMur, true);
    const sans = construireNappe(c, us, vs, 0, PROFIL.longueur, couleurMur, false);
    expect(sans.indices.length - avec.indices.length).toBeGreaterThan(0);
    // aucune cellule gardée ne contient son centre dans l'ouverture
    for (let k = 0; k < avec.indices.length; k += 6) {
      let x = 0, y = 0, z = 0;
      for (const idx of [avec.indices[k], avec.indices[k + 1], avec.indices[k + 2], avec.indices[k + 4]]) { x += avec.positions[idx * 3]; y += avec.positions[idx * 3 + 1]; z += avec.positions[idx * 3 + 2]; }
      expect(dansOuvertureBut(x / 4, y / 4, z / 4)).toBe(false);
    }
    // 2 buts × (cellules en largeur d'ouverture × lignes de profil sous la barre)
    const cellulesDe = (a: typeof avec) => a.indices.length / 6;
    expect(cellulesDe(sans) - cellulesDe(avec)).toBeGreaterThanOrEqual(2 * 5 * 5);
  });
  it("le sol plat est un polygone convexe fermé, et ses moitiés se recollent", () => {
    const tout = polygonePlat(0), moins = polygonePlat(-1), plus = polygonePlat(1);
    expect(tout).toHaveLength(8);
    for (const [x, z] of moins) expect(z).toBeLessThanOrEqual(1e-9);
    for (const [x, z] of plus) expect(z).toBeGreaterThanOrEqual(-1e-9);
    const aire = (p: readonly (readonly [number, number])[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + (a[0] * b[1] - b[0] * a[1]); }, 0)) / 2;
    expect(aire(moins) + aire(plus)).toBeCloseTo(aire(tout), 6);
    const n = eventail(moins, 0, couleurSol);
    expect(n.indices).toHaveLength(moins.length * 3);
    const cage = solCage(-1, couleurSol);
    expect(cage.positions.length / 3).toBe(5);
    // les cages commencent au bord du sol plat : pas de recouvrement
    const zs = []; for (let i = 0; i < cage.positions.length; i += 3) zs.push(cage.positions[i + 2]);
    expect(Math.max(...zs)).toBeCloseTo(-(STADE.demiLongueur - RAYON_COQUE), 6);
    expect(Math.min(...zs)).toBeCloseTo(-(STADE.demiLongueur + BUT.profondeur), 6);
  });
  it("le motif hexagonal reste sur la coque, hors des buts, et son budget est raisonnable", () => {
    const seg = segmentsHexCoque(c, 1.7, 0.5);
    expect(seg.length % 6).toBe(0);
    expect(seg.length / 6).toBeGreaterThan(5000);
    expect(seg.length / 6).toBeLessThan(40000);
    for (let i = 0; i < seg.length; i += 97 * 3) {
      const d = distancePrisme(seg[i], seg[i + 1], seg[i + 2]);
      if (!dansBiseau(seg[i], seg[i + 1], seg[i + 2])) expect(d).toBeCloseTo(RAYON_COQUE, 4);
      expect(dansOuvertureBut(seg[i], seg[i + 1], seg[i + 2])).toBe(false);
    }
  });
  it("le motif du plafond reste dans le polygone, à la hauteur du plafond", () => {
    const seg = segmentsHexPlafond(1.7);
    expect(seg.length / 6).toBeGreaterThan(1500);
    const poly = sommetsRetrecis();
    for (let i = 0; i < seg.length; i += 3) {
      expect(seg[i + 1]).toBe(STADE.hauteur);
      expect(dansPolygoneConvexe(poly, seg[i], seg[i + 2])).toBe(true);
    }
  });
});

describe("lignes du terrain", () => {
  const l = lignesTerrain();
  it("tous les sommets sont dans le terrain plat, à ras du sol", () => {
    const poly = sommetsRetrecis();
    for (let i = 0; i < l.positions.length; i += 3) {
      expect(l.positions[i + 1]).toBeGreaterThan(0);
      expect(l.positions[i + 1]).toBeLessThan(0.1);
      const z = l.positions[i + 2];
      // la ligne de but (|z| = 51,2) est dans la cage, le reste dans le polygone du sol
      if (Math.abs(z) > STADE.demiLongueur - 0.5) expect(Math.abs(l.positions[i])).toBeLessThanOrEqual(BUT.demiLargeur + LARGEUR_LIGNE);
      else expect(dansPolygoneConvexe(poly, l.positions[i], z)).toBe(true);
    }
    for (const idx of l.indices) expect(idx).toBeLessThan(l.positions.length / 3);
  });
  it("contient le rond central de 9,15 m et la ligne médiane", () => {
    let rond = 0, mediane = 0;
    for (let i = 0; i < l.positions.length; i += 3) {
      const r = Math.hypot(l.positions[i], l.positions[i + 2]);
      if (Math.abs(r - RAYON_ROND_CENTRAL) < LARGEUR_LIGNE) rond++;
      if (Math.abs(l.positions[i + 2]) < LARGEUR_LIGNE && Math.abs(l.positions[i]) > 12) mediane++;
    }
    expect(rond).toBeGreaterThan(100);
    expect(mediane).toBeGreaterThan(0);
  });
});

describe("cages", () => {
  it("la cage bleue est à Z = -60, l'orange à +60, de l'ouverture exacte", () => {
    const b = geometrieCage("bleue"), o = geometrieCage("orange");
    const zs = (g: typeof b) => g.filet.filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs(b))).toBeCloseTo(-STADE.demiLongueur - BUT.profondeur, 9);
    expect(Math.max(...zs(o))).toBeCloseTo(STADE.demiLongueur + BUT.profondeur, 9);
    // montants et barre
    const montants = b.tubes.filter((t) => Math.abs(Math.abs(t.a[0]) - BUT.demiLargeur) < 1e-9 && t.b[1] === BUT.hauteur && t.a[1] === 0 && Math.abs(t.a[2] + STADE.demiLongueur) < 1e-9);
    expect(montants).toHaveLength(2);
    expect(b.tubes.some((t) => t.a[1] === BUT.hauteur && t.b[1] === BUT.hauteur && t.a[0] === -BUT.demiLargeur && t.b[0] === BUT.demiLargeur && Math.abs(t.a[2] + STADE.demiLongueur) < 1e-9)).toBe(true);
    expect(b.quads.length).toBeGreaterThanOrEqual(5);
  });
  it("le filet est moins dense en basse qualité", () => {
    expect(geometrieCage("bleue", 1.5).filet.length).toBeLessThan(geometrieCage("bleue", 0.6).filet.length / 2);
  });
});

describe("plots", () => {
  it("visuel : plein quand actif, se remplit selon la recharge", () => {
    const e = (actif: boolean, recharge: number): EtatPlot => ({ id: 0, actif, recharge });
    expect(visuelPlot(e(true, 0), false)).toEqual({ actif: true, remplissage: 1 });
    expect(visuelPlot(e(false, PLOT.petit.rechargeS), false).remplissage).toBe(0);
    expect(visuelPlot(e(false, PLOT.petit.rechargeS / 2), false).remplissage).toBeCloseTo(0.5, 9);
    expect(visuelPlot(e(false, PLOT.gros.rechargeS / 2), true).remplissage).toBeCloseTo(0.5, 9);
    expect(PLOTS).toHaveLength(34);
  });
});

describe("gradins et public", () => {
  const c = creerContour();
  const tiers = disposerGradins(c);
  it("trois tiers par arête, les buts libres (8,8 m de cage)", () => {
    expect(tiers).toHaveLength(8 * GRADINS.tiers);
    for (const t of tiers) {
      const dx = Math.sin(t.cap), dz = Math.cos(t.cap);
      // coins du tier en plan : aucun dans une cage
      for (const [sx, sp] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
        const x = t.centre[0] + dx * (sx * t.longueur) / 2 + dz * sp * t.profondeur / 2;
        const z = t.centre[1] + dz * (sx * t.longueur) / 2 - dx * sp * t.profondeur / 2;
        const dansCageX = Math.abs(x) < BUT.demiLargeur;
        const dansCageZ = Math.abs(z) > STADE.demiLongueur - 1 && Math.abs(z) < STADE.demiLongueur + BUT.profondeur;
        expect(dansCageX && dansCageZ).toBe(false);
      }
    }
    expect(Math.max(...tiers.map((t) => t.hauteur))).toBeCloseTo(GRADINS.tiers * GRADINS.hauteurMarche, 9);
  });
  it("les gradins tiennent dans la zone dégagée du décor (boîtes d'exclusion)", () => {
    const demiL = STADE.demiLargeur + 14, demiZ = BUT.profondeur + STADE.demiLongueur + 14;
    for (const t of tiers) {
      const dx = Math.sin(t.cap), dz = Math.cos(t.cap);
      for (const [sx, sp] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
        const x = t.centre[0] + dx * (sx * t.longueur) / 2 + dz * sp * t.profondeur / 2;
        const z = t.centre[1] + dz * (sx * t.longueur) / 2 - dx * sp * t.profondeur / 2;
        expect(Math.abs(x)).toBeLessThanOrEqual(demiL);
        expect(Math.abs(z)).toBeLessThanOrEqual(demiZ);
      }
    }
  });
  it("le public est des deux couleurs, de l'ordre du millier", () => {
    const places = placesPublic(tiers);
    expect(places.length).toBeGreaterThan(600);
    expect(places.length).toBeLessThan(1600);
    expect(places.some((p) => p.equipe === "bleue")).toBe(true);
    expect(places.some((p) => p.equipe === "orange")).toBe(true);
    expect(placesPublic(tiers)).toEqual(places); // déterministe
  });
});

describe("voiture", () => {
  it("le profil de l'Octane reste dans la hitbox", () => {
    const { longueur, hauteur } = VOITURE.hitbox;
    const [a0, , h0] = VOITURE.decalageHitbox;
    for (const [a, h] of PROFIL_OCTANE) {
      expect(a).toBeGreaterThanOrEqual(a0 - longueur / 2 - 0.02);
      expect(a).toBeLessThanOrEqual(a0 + longueur / 2 + 0.02);
      expect(h).toBeGreaterThanOrEqual(h0 - hauteur / 2 - 0.03);
      expect(h).toBeLessThanOrEqual(h0 + hauteur / 2 + 0.01);
    }
  });
  it("une roue : bon nombre de flottants, sommets sur le cylindre de la roue", () => {
    const sortie = new Float32Array(FLOATS_ROUE);
    const n = segmentsRoue(VOITURE.roues[0].local, VOITURE.roues[0].rayon, 0, 0.3, sortie);
    expect(n).toBe(FLOATS_ROUE);
    const [a, d, h] = VOITURE.roues[0].local;
    for (let i = 0; i < n; i += 3) {
      const x = -sortie[i], y = sortie[i + 1], z = sortie[i + 2]; // x three = -droite
      expect(Math.abs(x - d)).toBeLessThanOrEqual(0.13 + 1e-5);
      expect(Math.hypot(z - a, y - h)).toBeLessThanOrEqual(VOITURE.roues[0].rayon + 1e-5);
    }
  });
  it("une roue braquée à droite tourne son avant vers la droite", () => {
    const s = new Float32Array(FLOATS_ROUE);
    segmentsRoue([0, 0, 0], 0.2, 0.4, 0, s);
    // point « devant la roue » (angle 0) sur chaque face : la moyenne des deux est le long de l'avant de la roue ; braquée à droite, x three < 0
    const n = 10 * 6;
    expect((s[0] + s[n]) / 2).toBeLessThan(-0.05);
  });
  it("braquage : nul en l'air et à l'arrêt tout droit, du bon côté, borné", () => {
    expect(braquageRoues(10, 1, false)).toBe(0);
    expect(braquageRoues(10, 0, true)).toBeCloseTo(0, 9);
    // lacet vers la droite = vitesse angulaire négative autour de haut = braquage positif
    expect(braquageRoues(10, -1, true)).toBeGreaterThan(0);
    expect(braquageRoues(10, 1, true)).toBeLessThan(0);
    expect(Math.abs(braquageRoues(1, -9, true))).toBeLessThanOrEqual(0.5);
  });
  it("le roulement avance avec la vitesse", () => {
    expect(avancerRoulement(0, 10, 0.1, 0.5)).toBeCloseTo(2, 9);
    expect(avancerRoulement(0, -10, 0.1, 0.5)).toBeCloseTo(-2, 9);
    expect(Math.abs(avancerRoulement(6, 10, 1, 0.5))).toBeLessThan(2 * Math.PI);
  });
  it("le tableau d'affichage résume le score", () => {
    expect(texteTableau({ bleue: "Les Trèfles", orange: "Les Tigres" }, { bleue: 2, orange: 1 })).toContain("TRÈFLES  2 - 1  TIGRES");
  });
});

describe("balle", () => {
  it("le motif est un polyèdre de Goldberg : 120 arêtes, 80 sommets", () => {
    const seg = segmentsMotifBalle(BALLE.rayonVisuel);
    // 120 arêtes duales pliées en 2 segments
    expect(seg.length / 6).toBe(240);
    const sommets = new Set<string>();
    for (let i = 0; i < seg.length; i += 3) {
      expect(Math.hypot(seg[i], seg[i + 1], seg[i + 2])).toBeCloseTo(BALLE.rayonVisuel, 6);
      sommets.add(`${seg[i].toFixed(5)},${seg[i + 1].toFixed(5)},${seg[i + 2].toFixed(5)}`);
    }
    // 80 sommets de faces + 120 milieux
    expect(sommets.size).toBe(200);
  });
  it("intègre l'orientation par rotation exacte", () => {
    let q: [number, number, number, number] = [0, 0, 0, 1];
    for (let i = 0; i < 100; i++) q = integrerQuat(q, [0, Math.PI, 0], 0.01);
    // une demi-tour autour de Y : q = (0, 1, 0, 0) au signe près
    expect(Math.abs(q[1])).toBeCloseTo(1, 6);
    expect(Math.hypot(...q)).toBeCloseTo(1, 9);
    expect(integrerQuat(q, [0, 0, 0], 1)).toEqual(q);
  });
  it("traînée et ombre", () => {
    expect(intensiteTrainee(5)).toBe(0);
    expect(intensiteTrainee(60)).toBe(1);
    expect(intensiteTrainee(26)).toBeGreaterThan(0);
    expect(ombreBalle(BALLE.rayon).opacite).toBeGreaterThan(ombreBalle(20).opacite);
    expect(ombreBalle(BALLE.rayon).echelle).toBeGreaterThan(ombreBalle(20).echelle);
  });
});

describe("effets et interpolation", () => {
  it("particules : divisées par 3 en basse qualité, par 2 en mouvement réduit", () => {
    const h = nombreParticules("but", 1, "haute", false);
    expect(nombreParticules("but", 1, "basse", false)).toBeCloseTo(h / 3, -1);
    expect(nombreParticules("but", 1, "haute", true)).toBe(h / 2);
    expect(nombreParticules("touche", 0, "haute", false)).toBeGreaterThan(0);
    expect(GABARITS.but.nombre).toBeGreaterThan(GABARITS.touche.nombre);
  });
  it("la pulsation lumineuse est supprimée en mouvement réduit et s'éteint", () => {
    expect(pulsationBut(0.3, true)).toBe(0);
    expect(pulsationBut(0.1, false)).toBeGreaterThan(0.3);
    expect(Math.abs(pulsationBut(6, false))).toBeLessThan(0.01);
    expect(intensiteChoc(0)).toBe(0);
    expect(intensiteChoc(80)).toBe(1);
  });
  it("directions de Fibonacci : unitaires et réparties", () => {
    const d = directionsFibonacci(60);
    for (const v of d) expect(Math.hypot(...v)).toBeCloseTo(1, 9);
    expect(Math.min(...d.map((v) => v[1]))).toBeLessThan(-0.95);
    expect(Math.max(...d.map((v) => v[1]))).toBeGreaterThan(0.95);
  });
  it("l'interpolation ne traverse pas le terrain sur une téléportation", () => {
    const o: [number, number, number] = [0, 0, 0];
    interpolerPosition([0, 0, 0], [2, 0, 0], 0.5, o);
    expect(o[0]).toBeCloseTo(1, 9);
    interpolerPosition([0, 0, 0], [40, 0, 0], 0.5, o);
    expect(o[0]).toBe(40);
  });
});
