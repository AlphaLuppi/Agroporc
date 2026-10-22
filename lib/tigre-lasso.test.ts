import { describe, expect, it } from "vitest";
import {
  angleSuspendu, AU_SOL_S, majBalancier, balistique, boucleLancee, boucleSerree, creerCorde, distance, DUREE_LANCER_S, longueurRepos, majCorde,
  majVol, noeud, normaliser, plafonner, pointsAnneau, tournoyer, tourner, touche, v3, vitesseBalistique, VITESSE_MAX,
  type Bornes, type Vol,
} from "./tigre-lasso";
import { creerAnimateur } from "./tigre3d/animateur";
import { REPLIQUES_TIGRE } from "./repliques-lasso";

const zone = { x: 100, y: 200, w: 80, h: 40 };

describe("touche", () => {
  it("attrape dans la zone et jusqu'au rayon de la boucle autour", () => {
    expect(touche({ x: 140, y: 220 }, zone)).toBe(true);
    expect(touche({ x: 90, y: 220 }, zone, 22)).toBe(true);
    expect(touche({ x: 60, y: 220 }, zone, 22)).toBe(false);
    expect(touche({ x: 200, y: 260 }, zone, 22)).toBe(false);
  });
});

describe("boucle lancée", () => {
  it("la parabole part de la boucle qui tournoie et arrive sur la cible, toujours à plat", () => {
    const depart = tournoyer(v3(500, 900, 0), 0.3);
    const cible = v3(200, 700, 0);
    const v = vitesseBalistique(depart.c, cible, DUREE_LANCER_S);
    expect(distance(balistique(depart.c, v, DUREE_LANCER_S), cible)).toBeLessThan(1e-6);
    // Au milieu du vol, elle passe au-dessus de la droite départ → cible.
    expect(balistique(depart.c, v, DUREE_LANCER_S / 2).y).toBeLessThan(Math.min(depart.c.y, cible.y));
    expect(Math.abs(boucleLancee(depart, cible, v, DUREE_LANCER_S).n.y)).toBeGreaterThan(0.7);
  });

  it("serrée : autour du cou, perpendiculaire au cou, fermée à sa taille, nœud sur la nuque", () => {
    const arrivee = boucleLancee(tournoyer(v3(500, 900, 0), 0.2), v3(200, 650, 0), v3(-600, -900, 0), DUREE_LANCER_S);
    const cou = v3(210, 700, 0), axe = v3(-1, 0, 0);
    const a = boucleSerree(arrivee, cou, axe, 12, 1);
    expect(distance(a.c, cou)).toBeLessThan(1e-9);
    expect(a.r).toBeCloseTo(12, 9);
    expect(Math.abs(a.n.x)).toBeCloseTo(1, 6);
    const n = noeud(a);
    expect(n.y).toBeCloseTo(cou.y - 12, 6);
    // À mi-serrage, la boucle est encore ouverte (le mou est repris à la fin).
    expect(boucleSerree(arrivee, cou, axe, 12, 0.5).r).toBeGreaterThan(arrivee.r * 0.7);
  });

  it("la boucle part du nœud et y revient (la corde est attachée), sans s'écarter de son rayon", () => {
    const a = tournoyer(v3(500, 900, 0), 0.1);
    expect(distance(noeud(a), a.c)).toBeCloseTo(a.r, 6);
    const pts = pointsAnneau(a, 40, 1.3);
    expect(distance(pts[0], noeud(a))).toBeLessThan(1e-9);
    expect(distance(pts.at(-1)!, noeud(a))).toBeLessThan(1e-9);
    for (const p of pts) expect(distance(p, a.c)).toBeLessThanOrEqual(a.r * 1.2);
  });
});

describe("corde", () => {
  it("tenue par la main, le tigre (lourd) pend dessous, corde tendue à sa longueur", () => {
    const main = v3(300, 100, 0);
    const c = creerCorde(20, main, v3(420, 100, 0), 5);
    c.inv[19] = 0.03;
    for (let i = 0; i < 60 * 15; i++) majCorde(c, 1 / 60, { epingles: [[0, main]], sol: 2000, tendue: longueurRepos(c) });
    const bout = c.p[19];
    expect(Math.abs(bout.x - 300)).toBeLessThan(3);
    expect(bout.y).toBeGreaterThan(100 + longueurRepos(c) * 0.97);
    expect(distance(bout, main)).toBeLessThanOrEqual(longueurRepos(c) + 0.5);
  });

  it("bouger la main fait balancer le poids (la vitesse vient de la corde)", () => {
    const c = creerCorde(16, v3(0, 0, 0), v3(0, 90, 0), 6);
    c.inv[15] = 0.03;
    let v = v3();
    for (let i = 0; i < 30; i++) v = majCorde(c, 1 / 60, { epingles: [[0, v3(i * 25, 0, 0)]], sol: 2000, tendue: 90 });
    expect(v.x).toBeGreaterThan(200);
  });

  it("élastique : le poids tombe, s'étire au-delà de la longueur, rebondit plusieurs fois puis se pose", () => {
    const main = v3(300, 100, 0);
    const c = creerCorde(28, main, v3(300, 110, 0), 2);
    const L = 240;
    const d: number[] = [];
    for (let i = 0; i < 60 * 6; i++) {
      majCorde(c, 1 / 60, { epingles: [[0, main]], sol: 5000, freinFin: 0.45, elastique: { longueur: L, k: 40, amorti: 1 } });
      d.push(distance(c.p[27], main));
    }
    // Il s'étire bien au-delà de la longueur de la corde (rebond), sans dépasser 1,8 fois.
    const max = Math.max(...d);
    expect(max).toBeGreaterThan(L * 1.4);
    expect(max).toBeLessThanOrEqual(L * 1.8 + 1);
    // Au moins 3 remontées (minima locaux) : ça rebondit.
    let rebonds = 0;
    for (let i = 1; i < d.length - 1; i++) if (d[i] < d[i - 1] && d[i] <= d[i + 1] && d[i] > L * 0.9) rebonds++;
    expect(rebonds).toBeGreaterThanOrEqual(3);
    // Au repos : étiré de pesanteur / raideur (≈ 65 px), immobile.
    expect(d.at(-1)! - L).toBeGreaterThan(45);
    expect(Math.abs(d.at(-1)! - d.at(-30)!)).toBeLessThan(6);
  });

  it("posée au sol, elle n'y passe jamais dessous", () => {
    const c = creerCorde(12, v3(0, 0, 0), v3(100, 0, 0));
    for (let i = 0; i < 120; i++) majCorde(c, 1 / 60, { epingles: [], sol: 50 });
    for (const p of c.p) expect(p.y).toBeLessThanOrEqual(50);
  });

  it("un geste brusque donne une vitesse plafonnée", () => {
    const v = plafonner({ x: 60000, y: 0 }, VITESSE_MAX);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(VITESSE_MAX, 3);
  });
});

describe("angleSuspendu", () => {
  it("le corps prolonge la corde : pendu par le cou, le corps sous la tête", () => {
    // Tigre tourné vers la droite : le centre du corps est à gauche du cou.
    const d = { x: -50, y: 10 };
    const main = { x: 0, y: 0 }, cou = { x: 0, y: 80 };
    const a = angleSuspendu(main, cou, d);
    const corps = tourner(d, a);
    expect(corps.x).toBeCloseTo(0, 6);
    expect(corps.y).toBeGreaterThan(0);
  });

  it("normalise dans ]-π, π]", () => {
    expect(normaliser(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(normaliser(-3 * Math.PI / 2)).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe("majBalancier (pendule pesant)", () => {
  it("lâché de travers, il finit centre de gravité sous l'attache", () => {
    // Pendu par le poignet : le centre de gravité à 120 px sous l'attache, décalé de 30 px.
    const d = { x: 30, y: 120 };
    let b = { angle: 0.9, omega: 0 };
    for (let i = 0; i < 60 * 12; i++) b = majBalancier(b, d, 50, { x: 0, y: 0 }, 1 / 60);
    const r = tourner(d, b.angle);
    expect(Math.abs(r.x)).toBeLessThan(3);
    expect(r.y).toBeGreaterThan(0);
  });

  it("balance à la période d'un pendule pesant : 2π √((d² + k²) / (g·d))", () => {
    const d = { x: 0, y: 120 }, k = 50;
    let b = { angle: 0.15, omega: 0 }, t = 0, prec = b.angle;
    const passages: number[] = [];
    while (t < 4) {
      b = majBalancier(b, d, k, { x: 0, y: 0 }, 1 / 240, 0);
      t += 1 / 240;
      if (prec > 0 && b.angle <= 0) passages.push(t);
      prec = b.angle;
    }
    const periode = passages[1] - passages[0];
    const attendue = 2 * Math.PI * Math.sqrt((120 * 120 + k * k) / (2600 * 120));
    expect(periode).toBeCloseTo(attendue, 2);
  });

  it("une secousse de l'attache vers la droite le fait partir en arrière (inertie)", () => {
    let b = { angle: 0, omega: 0 };
    b = majBalancier(b, { x: 0, y: 120 }, 50, { x: 3000, y: 0 }, 0.05);
    // Centre de gravité laissé derrière (à gauche) : rotation dans le sens horaire de l'écran.
    expect(tourner({ x: 0, y: 120 }, b.angle).x).toBeLessThan(0);
  });
});

describe("majVol", () => {
  const bornes: Bornes = { gauche: 0, droite: 1000, haut: 0, sol: 700 };

  it("rebondit sur les bords sans en sortir", () => {
    let v: Vol = { c: { x: 500, y: 300 }, v: { x: 4000, y: -3000 }, angle: 0, omega: 5, auSol: 0 };
    for (let i = 0; i < 120; i++) {
      v = majVol(v, bornes, 50, 1 / 60).vol;
      expect(v.c.x).toBeGreaterThanOrEqual(50);
      expect(v.c.x).toBeLessThanOrEqual(950);
      expect(v.c.y).toBeGreaterThanOrEqual(50);
      expect(v.c.y).toBeLessThanOrEqual(700);
    }
  });

  it("finit posé au sol, à l'endroit, puis se relève", () => {
    let v: Vol = { c: { x: 500, y: 200 }, v: { x: 900, y: -500 }, angle: 2.5, omega: 8, auSol: 0 };
    let pose = false, t = 0;
    while (!pose && t < 10) {
      ({ vol: v, pose } = majVol(v, bornes, 50, 1 / 60));
      t += 1 / 60;
    }
    expect(pose).toBe(true);
    expect(v.c.y).toBe(700);
    expect(Math.abs(normaliser(v.angle))).toBeLessThan(0.08);
    expect(v.auSol).toBeGreaterThanOrEqual(AU_SOL_S);
  });
});

describe("animateur au lasso", () => {
  it("attrapé : il a le seum, s'arrête et ignore les clics ; relâché : il file à l'éclair", () => {
    const a = creerAnimateur({ sens: 1, vitesse: 2.5, alea: () => 0.1 });
    const evs: string[] = [];
    a.sur((e) => { evs.push(e.type === "bulle" ? `bulle:${e.texte}` : e.type); });
    a.clic("salut");
    a.attraper();
    expect(a.tenu).toBe(true);
    expect(a.reaction).toBeNull();
    expect(evs.some((e) => REPLIQUES_TIGRE.pris.some((r) => e === `bulle:${r}`))).toBe(true);
    expect(a.clic()).toBe("ignorer");
    for (let i = 0; i < 360; i++) a.maj(1 / 60);
    expect(Math.abs(a.corps.v)).toBeLessThan(0.05);
    // Pendu 6 s, il a enchaîné plusieurs répliques, jamais la même deux fois de suite.
    const bulles = evs.filter((e) => e.startsWith("bulle:"));
    expect(bulles.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < bulles.length; i++) expect(bulles[i]).not.toBe(bulles[i - 1]);
    a.relacher();
    expect(a.tenu).toBe(false);
    expect(a.mode).toBe("eclair");
    expect(evs).toContain("fuite");
    for (let i = 0; i < 60; i++) a.maj(1 / 60);
    expect(a.corps.v).toBeGreaterThan(0.2);
  });
});
