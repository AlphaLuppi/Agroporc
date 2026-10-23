import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aleaGraine, dedans } from "../agroparc3d/cachettes";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde, pointsApparition, type Monde } from "./collision";
import { coteMurDe, etape, etatInitial, hauteurOeil, MOUV, postureDe, seuilGlisse, type Entrees, type EtatMouvement } from "./mouvement";
import type { Vec3 } from "./protocole";
import { PLAFONDS, SILHOUETTE } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const R = SILHOUETTE.rayon;
const DT = 1 / 60;

function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
/** Monde réduit : deux petits bâtiments lointains élargissent les bornes à ±275 m. */
function mondeDe(...batiments: Building[]): Monde {
  const coins = [rect(-250, -250, -249, -249, 3), rect(249, 249, 250, 250, 3)];
  return construireMonde({ ...scene, buildings: [...coins, ...batiments], pois: [] });
}

/** Lacet dont l'avant (−sin, −cos) pointe vers (fx, fz). */
function lacetVers(fx: number, fz: number): number {
  return Math.atan2(-fx, -fz);
}
const ENTREES_REPOS: Entrees = { avant: 0, droite: 0, saut: false, sprint: false, lacet: 0 };

function avancer(e: EtatMouvement, secondes: number, entrees: Entrees | ((t: number) => Entrees), m: Monde, surPas?: (e: EtatMouvement, t: number) => void): EtatMouvement {
  const n = Math.round(secondes / DT);
  for (let k = 0; k < n; k++) {
    const t = (k + 1) * DT;
    e = etape(e, typeof entrees === "function" ? entrees(t) : entrees, DT, m);
    surPas?.(e, t);
  }
  return e;
}

function etatA(p: Vec3, v: Vec3 = [0, 0, 0], extra: Partial<EtatMouvement> = {}): EtatMouvement {
  return { ...etatInitial(p), v, ...extra };
}

// Mur A : face nord en z = 0 (normale (0, −1)), 600 m de long, 30 m de haut.
const A = rect(-300, 0, 300, 40, 30);
const mondeMur = mondeDe(A);
const iA = 2;

// Course vers l'est, en biais de 30° vers le mur A.
const FX = Math.cos(Math.PI / 6), FZ = Math.sin(Math.PI / 6);
const coursebiais: Entrees = { avant: 1, droite: 0, saut: false, sprint: true, lacet: lacetVers(FX, FZ) };

/** Joueur lancé à 9 m/s en biais vers le mur A, qui saute tout de suite. */
function lancerContreMur(m: Monde = mondeMur): { e: EtatMouvement; trace: { t: number; e: EtatMouvement }[] } {
  const trace: { t: number; e: EtatMouvement }[] = [];
  let e = etatA([-20, 0, -2.2], [9 * FX, 0, 9 * FZ]);
  e = avancer(e, 3, (t) => ({ ...coursebiais, saut: t <= DT + 1e-9 }), m, (s, t) => trace.push({ t, e: s }));
  return { e, trace };
}

describe("sol", () => {
  const m = mondeDe();
  it("marche à MOUV.marche (9 m/s), sprint à MOUV.sprint (12,5 m/s) vers l'avant seulement", () => {
    const marche = avancer(etatInitial([0, 0, 0]), 1, { avant: 1, droite: 0, saut: false, sprint: false, lacet: 0 }, m);
    expect(Math.hypot(marche.v[0], marche.v[2])).toBeCloseTo(MOUV.marche, 5);
    expect(marche.p[2]).toBeLessThan(-5);
    const sprint = avancer(etatInitial([0, 0, 0]), 1, { avant: 1, droite: 0, saut: false, sprint: true, lacet: 0 }, m);
    expect(Math.hypot(sprint.v[0], sprint.v[2])).toBeCloseTo(MOUV.sprint, 5);
    const arriere = avancer(etatInitial([0, 0, 0]), 1, { avant: -1, droite: 0, saut: false, sprint: true, lacet: 0 }, m);
    expect(Math.hypot(arriere.v[0], arriere.v[2])).toBeCloseTo(MOUV.marche, 5);
    expect(arriere.p[2]).toBeGreaterThan(5);
  });

  it("accélère vite, s'arrête vite sans entrée, la diagonale n'est pas plus rapide", () => {
    const a = etape(etatInitial([0, 0, 0]), { avant: 1, droite: 0, saut: false, sprint: true, lacet: 0 }, 0.15, m);
    expect(Math.hypot(a.v[0], a.v[2])).toBeCloseTo(MOUV.sprint, 5);
    const lent = etape(etatInitial([0, 0, 0]), { avant: 1, droite: 0, saut: false, sprint: true, lacet: 0 }, 0.05, m);
    expect(Math.hypot(lent.v[0], lent.v[2])).toBeCloseTo(MOUV.accelSol * 0.05, 5);
    const stop = avancer(a, 0.25, ENTREES_REPOS, m);
    expect(Math.hypot(avancer(a, 0.05, ENTREES_REPOS, m).v[0], 0)).toBeLessThan(MOUV.sprint);
    expect(Math.hypot(stop.v[0], stop.v[2])).toBe(0);
    const diag = avancer(etatInitial([0, 0, 0]), 1, { avant: 1, droite: 1, saut: false, sprint: false, lacet: 0 }, m);
    expect(Math.hypot(diag.v[0], diag.v[2])).toBeCloseTo(MOUV.marche, 5);
    expect(diag.v[0]).toBeGreaterThan(0); // la droite est l'est quand on regarde vers −z
  });

  it("la direction suit le lacet (0 = −z, π/2 = −x) et le multiplicateur d'arme", () => {
    const e = avancer(etatInitial([0, 0, 0]), 1, { avant: 1, droite: 0, saut: false, sprint: false, lacet: Math.PI / 2 }, m);
    expect(e.v[0]).toBeCloseTo(-MOUV.marche, 5);
    expect(e.v[2]).toBeCloseTo(0, 5);
    const sniper = etape(etatInitial([0, 0, 0]), { avant: 1, droite: 0, saut: false, sprint: false, lacet: 0 }, 1, m, 0.9);
    expect(Math.hypot(sniper.v[0], sniper.v[2])).toBeCloseTo(MOUV.marche * 0.9, 5);
  });

  it("le sprint est atteint en 0,15 s au plus ; à 0,05 s la vitesse vaut accelSol × 0,05", () => {
    const sprint: Entrees = { avant: 1, droite: 0, saut: false, sprint: true, lacet: 0 };
    expect(MOUV.sprint / MOUV.accelSol).toBeLessThanOrEqual(0.15);
    const a = etape(etatInitial([0, 0, 0]), sprint, 0.15, m);
    expect(Math.hypot(a.v[0], a.v[2])).toBeCloseTo(MOUV.sprint, 5);
    const b = etape(etatInitial([0, 0, 0]), sprint, 0.05, m);
    expect(Math.hypot(b.v[0], b.v[2])).toBeCloseTo(MOUV.accelSol * 0.05, 5);
  });

  it("couteau (×1,3) : sprint 16,25 m/s, jamais au-dessus du plafond MOUV.vitesseMaxH", () => {
    const sprint: Entrees = { avant: 1, droite: 0, saut: false, sprint: true, lacet: 0 };
    let e = etatInitial([0, 0, 0]);
    let max = 0;
    for (let k = 0; k < 120; k++) {
      e = etape(e, sprint, DT, m, 1.3);
      max = Math.max(max, Math.hypot(e.v[0], e.v[2]));
    }
    expect(max).toBeCloseTo(MOUV.sprint * 1.3, 5);
    expect(max).toBeLessThanOrEqual(MOUV.vitesseMaxH);
    // couteau et saut de mur : la tangente 13 × 1,3 plus la normale restent bornées par le plafond
    expect(MOUV.murVitesseMax * 1.3).toBeLessThan(MOUV.vitesseMaxH + 3);
  });

  it("le résultat dépend peu du dt (60 Hz, 30 Hz, un grand pas)", () => {
    const en: Entrees = { avant: 1, droite: 0.3, saut: false, sprint: true, lacet: 0.7 };
    const finale = (dt: number) => {
      let e = etatInitial([0, 0, 0]);
      for (let t = 0; t < 1 - 1e-9; t += dt) e = etape(e, en, dt, m);
      return e.p;
    };
    const ref = finale(1 / 120);
    for (const dt of [1 / 60, 1 / 30, 0.1]) {
      const p = finale(dt);
      expect(Math.hypot(p[0] - ref[0], p[2] - ref[2])).toBeLessThan(0.02);
    }
  });

  it("etape ne modifie pas l'état reçu", () => {
    const e = etatInitial([1, 0, 2]);
    const copie = JSON.stringify(e);
    etape(e, { avant: 1, droite: 0, saut: true, sprint: true, lacet: 1 }, DT, m);
    expect(JSON.stringify(e)).toBe(copie);
  });
});

describe("murs", () => {
  it("marcher contre un mur s'arrête, le joueur reste à un rayon du mur et glisse le long", () => {
    // Droit dans le mur A (vers +z), puis en biais : il glisse vers l'est.
    let e = avancer(etatA([0, 0, -6]), 2, { avant: 1, droite: 0, saut: false, sprint: true, lacet: lacetVers(0, 1) }, mondeMur);
    expect(e.p[2]).toBeCloseTo(-R, 3);
    expect(Math.hypot(e.v[0], e.v[2])).toBeLessThan(1e-6);
    expect(e.auSol).toBe(true);
    expect(e.mur).toBeNull();
    e = avancer(e, 1, { avant: 1, droite: 0, saut: false, sprint: false, lacet: lacetVers(FX, FZ) }, mondeMur);
    expect(e.p[0]).toBeGreaterThan(2);
    expect(e.p[2]).toBeLessThanOrEqual(-R + 1e-6);
  });

  it("vrai scene.json : on ne traverse pas CBA en marchant droit dessus", () => {
    const monde = construireMonde(scene);
    const iCba = scene.buildings.findIndex((b) => dedans(-162.8, -12.7, b.r));
    const cba = scene.buildings[iCba];
    const dep = pointsApparition(scene, monde)[0];
    // Cap vers le centre de CBA depuis le point d'apparition le plus proche.
    const pts = pointsApparition(scene, monde).sort((a, b) => Math.hypot(a[0] + 162.8, a[1] + 12.7) - Math.hypot(b[0] + 162.8, b[1] + 12.7));
    void dep;
    const [x0, z0] = pts[0];
    const lacet = lacetVers(-162.8 - x0, -12.7 - z0);
    const e = avancer(etatInitial([x0, 0, z0]), 15, { avant: 1, droite: 0, saut: false, sprint: true, lacet }, monde);
    expect(dedans(e.p[0], e.p[2], cba.r)).toBe(false);
  });
});

describe("wall-run", () => {
  it("sauter contre un mur en courant en biais accroche : posture mur, côté, gravité réduite, on longe le mur", () => {
    const { trace } = lancerContreMur();
    const iAccroche = trace.findIndex((s) => s.e.mur !== null);
    expect(iAccroche).toBeGreaterThan(0);
    const acc = trace[iAccroche];
    expect(acc.t).toBeLessThan(0.7);
    expect(postureDe(acc.e)).toBe("mur");
    expect(acc.e.mur!.prisme).toBe(iA);
    expect(acc.e.mur!.nz).toBeCloseTo(-1, 3);
    expect(acc.e.mur!.nx).toBeCloseTo(0, 3);
    // Cap est, mur au sud : le mur est à droite.
    expect(acc.e.mur!.cote).toBe(1);
    expect(coteMurDe(acc.e)).toBe(1);
    expect(acc.e.sautsAir).toBe(1);
    expect(Math.abs(acc.e.v[0])).toBeGreaterThanOrEqual(MOUV.murVitesse - 1e-6);
    expect(acc.e.v[0]).toBeGreaterThan(0);

    // 1 s plus tard : encore au mur, peu d'altitude perdue, ~9 m de parcouru le long du mur, collé au mur.
    const apres = trace[iAccroche + 60].e;
    expect(apres.mur).not.toBeNull();
    expect(apres.p[1]).toBeGreaterThan(acc.e.p[1] - 0.6);
    expect(apres.p[0] - acc.e.p[0]).toBeGreaterThan(8);
    expect(Math.abs(apres.p[2] + R)).toBeLessThan(0.1);
    // Le roulis penche à l'opposé du mur (mur à droite → penche à gauche).
    expect(apres.inclinaison).toBeLessThan(-MOUV.murInclinaison * 0.8);
    expect(apres.inclinaison).toBeGreaterThanOrEqual(-MOUV.murInclinaison - 1e-9);
  });

  it("la durée maximale met fin au wall-run, sans raccrochage immédiat, et le roulis revient", () => {
    // Départ en hauteur : le sol ne met pas fin à la course avant la durée maximale.
    const trace: { t: number; e: EtatMouvement }[] = [];
    avancer(etatA([-20, 12, -1.5], [9 * FX, 0, 9 * FZ], { auSol: false }), 3, coursebiais, mondeMur, (e, t) => trace.push({ t, e }));
    const iAccroche = trace.findIndex((s) => s.e.mur !== null);
    const iFin = trace.findIndex((s, i) => i > iAccroche && s.e.mur === null);
    expect(iFin).toBeGreaterThan(0);
    const duree = trace[iFin].t - trace[iAccroche].t;
    expect(duree).toBeGreaterThan(MOUV.murDureeMax - 0.05);
    expect(duree).toBeLessThan(MOUV.murDureeMax + 0.05);
    expect(trace[iFin].e.murRecent).not.toBeNull();
    // Pas de nouvel accrochage au même mur dans les 0,5 s qui suivent (éjecté, murRecent).
    for (const s of trace.slice(iFin, iFin + 29)) expect(s.e.mur).toBeNull();
    // Le roulis revient vers l'horizontale dès la fin (0,3 s après : plus de la moitié du chemin).
    expect(Math.abs(trace[iFin + 18].e.inclinaison)).toBeLessThan(MOUV.murInclinaison * 0.5);
  });

  it("la course s'arrête si on lâche l'avant (éjecté du mur)", () => {
    const { trace } = lancerContreMur();
    const iAccroche = trace.findIndex((s) => s.e.mur !== null);
    let e = trace[iAccroche + 20].e;
    expect(e.mur).not.toBeNull();
    e = etape(e, { ...coursebiais, avant: 0, saut: false }, DT, mondeMur);
    expect(e.mur).toBeNull();
    expect(e.v[2]).toBeLessThan(0); // éjecté vers l'extérieur (normale −z)
  });

  it("sans entrée avant ou trop lent : pas d'accroche", () => {
    const m = mondeMur;
    const sansAvant = avancer(etatA([-20, 0, -2.2], [9 * FX, 0, 9 * FZ]), 1.2, (t) => ({ ...coursebiais, avant: 0, saut: t <= DT + 1e-9 }), m, (s) => expect(s.mur).toBeNull());
    void sansAvant;
    // 3 m/s seulement le long du mur, en l'air : pas d'accroche (vitesse d'entrée < murVitesseEntreeMin).
    const lent = etatA([-10, 3, -0.45], [3, 0, 0], { auSol: false });
    expect(etape(lent, { ...coursebiais, sprint: false, lacet: lacetVers(1, 0.2) }, DT, m).mur).toBeNull();
    // Juste au-dessus du seuil d'entrée, si.
    const vite = etatA([-10, 3, -0.45], [MOUV.murVitesseEntreeMin + 1, 0, 0], { auSol: false });
    expect(etape(vite, { ...coursebiais, sprint: false, lacet: lacetVers(1, 0.2) }, DT, m).mur).not.toBeNull();
  });

  it("un mur presque perpendiculaire (> 65° de la tangente) n'accroche pas", () => {
    const e = etatA([0, 3, -2], [0.6, 0, 8.8], { auSol: false });
    avancer(e, 0.5, { avant: 1, droite: 0, saut: false, sprint: true, lacet: lacetVers(0.07, 1) }, mondeMur, (s) => expect(s.mur).toBeNull());
  });

  it("un mur trop bas (escalade possible) n'est pas courant", () => {
    const m = mondeDe(rect(-300, 0, 300, 40, 2));
    const e = etatA([-20, 0, -2.2], [9 * FX, 0, 9 * FZ]);
    avancer(e, 1.5, (t) => ({ ...coursebiais, saut: t <= DT + 1e-9 }), m, (s) => expect(s.mur).toBeNull());
  });

  it("recharge le double saut à l'accroche", () => {
    const e0 = etatA([-5, 6, -0.6], [9 * FX, 0, 9 * FZ], { auSol: false, sautsAir: 0 });
    const e = avancer(e0, 0.3, coursebiais, mondeMur);
    expect(e.mur).not.toBeNull();
    expect(e.sautsAir).toBe(1);
  });

  it("vrai scene.json : on peut courir sur le long mur de CBA", () => {
    const monde = construireMonde(scene);
    const iCba = scene.buildings.findIndex((b) => dedans(-162.8, -12.7, b.r));
    const cba = scene.buildings[iCba];
    // Plus longue arête de CBA, normale sortante.
    let best = { l: 0, ax: 0, az: 0, bx: 0, bz: 0, nx: 0, nz: 0 };
    for (let i = 0, j = cba.r.length - 1; i < cba.r.length; j = i++) {
      const [ax, az] = cba.r[j], [bx, bz] = cba.r[i];
      const l = Math.hypot(bx - ax, bz - az);
      if (l <= best.l) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      let nx = (bz - az) / l, nz = -(bx - ax) / l;
      if (dedans(mx + nx * 0.05, mz + nz * 0.05, cba.r)) { nx = -nx; nz = -nz; }
      best = { l, ax, az, bx, bz, nx, nz };
    }
    expect(best.l).toBeGreaterThan(20);
    const tx = -best.nz, tz = best.nx; // tangente
    const mx = (best.ax + best.bx) / 2, mz = (best.az + best.bz) / 2;
    // Départ à 3 m du mur, 6 m avant le milieu, cap à 30° vers le mur.
    const dirx = tx * Math.cos(Math.PI / 6) - best.nx * Math.sin(Math.PI / 6);
    const dirz = tz * Math.cos(Math.PI / 6) - best.nz * Math.sin(Math.PI / 6);
    const dep: Vec3 = [mx - tx * 5 + best.nx * 2.3, 0, mz - tz * 5 + best.nz * 2.3];
    const en: Entrees = { avant: 1, droite: 0, saut: false, sprint: true, lacet: lacetVers(dirx, dirz) };
    let e = etatA(dep, [9 * dirx, 0, 9 * dirz]);
    let accroche = false;
    e = avancer(e, 1.2, (t) => ({ ...en, saut: t <= DT + 1e-9 }), monde, (s) => { if (s.mur && s.mur.prisme === iCba) accroche = true; });
    expect(accroche).toBe(true);
    expect(dedans(e.p[0], e.p[2], cba.r)).toBe(false);
  });

  it("suit un mur légèrement courbe (polygone à pans de 10°)", () => {
    // Arc de cercle de rayon 60 m centré en (0, 60) : mur extérieur de la face nord, 12 pans de 10°.
    const anneau: [number, number][] = [];
    const centre: [number, number] = [0, 60];
    const rExt = 60, rInt = 40;
    for (let k = 0; k <= 12; k++) { const a = -Math.PI / 2 - (60 * Math.PI) / 180 + (k * 10 * Math.PI) / 180; anneau.push([centre[0] + rExt * Math.cos(a), centre[1] + rExt * Math.sin(a)]); }
    for (let k = 12; k >= 0; k--) { const a = -Math.PI / 2 - (60 * Math.PI) / 180 + (k * 10 * Math.PI) / 180; anneau.push([centre[0] + rInt * Math.cos(a), centre[1] + rInt * Math.sin(a)]); }
    // Le bâtiment est à l'intérieur du cercle (le mur est concave vu de l'extérieur du cercle… on court à l'extérieur : côté z < pied de l'arc).
    const b: Building = { h: 30, r: anneau, c: [0, 10] };
    const m = mondeDe(b);
    // Départ au pied de l'arc extérieur, tangent à l'arc, cap est, mur à droite (centre au sud).
    const a0 = -Math.PI / 2 - (50 * Math.PI) / 180;
    const px = centre[0] + (rExt + 2) * Math.cos(a0), pz = centre[1] + (rExt + 2) * Math.sin(a0);
    // Tangente (sens horaire vu d'en haut : a croît → x croît).
    const tx = -Math.sin(a0), tz = Math.cos(a0);
    // Cap : 25° vers le mur depuis la tangente.
    const dirx = tx * Math.cos(0.43) - Math.cos(a0) * Math.sin(0.43), dirz = tz * Math.cos(0.43) - Math.sin(a0) * Math.sin(0.43);
    const en: Entrees = { avant: 1, droite: 0, saut: false, sprint: true, lacet: lacetVers(dirx, dirz) };
    let e = etatA([px, 0, pz], [9 * dirx, 0, 9 * dirz]);
    let debut = -1, fin = -1;
    let distMax = 0;
    e = avancer(e, 2, (t) => ({ ...en, saut: t <= DT + 1e-9 }), m, (s, t) => {
      if (s.mur && debut < 0) debut = t;
      if (!s.mur && debut >= 0 && fin < 0) fin = t;
      if (s.mur) distMax = Math.max(distMax, Math.hypot(s.p[0] - centre[0], s.p[2] - centre[1]) - rExt);
    });
    expect(debut).toBeGreaterThan(0);
    // Il reste au mur au moins ~1 s, soit plus d'un pan (10° de 60 m = 10,5 m) : il a donc enchaîné des pans.
    expect(fin < 0 ? 2 - debut : fin - debut).toBeGreaterThan(1);
    expect(distMax).toBeLessThan(0.7);
  });
});

describe("saut de mur", () => {
  it("repousse de la normale (6,5 m/s), saute à 7 m/s et enchaîne sans raccrocher le même mur", () => {
    const { trace } = lancerContreMur();
    const iAccroche = trace.findIndex((s) => s.e.mur !== null);
    let e = trace[iAccroche + 15].e;
    expect(e.mur).not.toBeNull();
    const vtang = Math.abs(e.v[0]);
    e = etape(e, { ...coursebiais, saut: true }, DT, mondeMur);
    expect(e.mur).toBeNull();
    expect(e.murRecent).not.toBeNull();
    expect(e.murRecent!.prisme).toBe(iA);
    // Normale du mur A = (0, −1) : v·n ≈ 6,5 ; tangente conservée ; vy ≈ 7.
    expect(-e.v[2]).toBeGreaterThan(6.3);
    expect(-e.v[2]).toBeLessThan(6.6);
    expect(e.v[0]).toBeGreaterThanOrEqual(vtang - 0.3);
    expect(e.v[1]).toBeGreaterThan(6.5);
    expect(e.sautsAir).toBe(1);
    expect(e.auSol).toBe(false);
    // Les 0,5 s suivantes : on s'éloigne, sans raccrocher (murRecent).
    const suite = avancer(e, 0.4, { ...coursebiais, saut: true }, mondeMur, (s) => expect(s.mur).toBeNull());
    expect(suite.p[2]).toBeLessThan(-1.5);
  });

  it("le même mur n'est pas raccrochable avant 0,5 s, il l'est après", () => {
    const base = (t: number) => etatA([0, 6, -0.45], [9, 0, 0], { auSol: false, murRecent: { prisme: iA, nx: 0, nz: -1, t } });
    const trop = etape(base(0.1), { ...coursebiais, lacet: lacetVers(1, 0.15) }, DT, mondeMur);
    expect(trop.mur).toBeNull();
    const assez = avancer(base(0.46), 0.1, { ...coursebiais, lacet: lacetVers(1, 0.15) }, mondeMur);
    expect(assez.mur).not.toBeNull();
    expect(assez.mur!.prisme).toBe(iA);
  });

  it("un mur d'angle très différent (> 25°) du dernier est raccrochable tout de suite", () => {
    // Le dernier mur avait la normale (1, 0) ; ce mur A a la normale (0, −1).
    const e = etape(etatA([0, 6, -0.45], [9, 0, 0], { auSol: false, murRecent: { prisme: iA, nx: 1, nz: 0, t: 0.05 } }), { ...coursebiais, lacet: lacetVers(1, 0.15) }, DT, mondeMur);
    expect(e.mur).not.toBeNull();
  });

  it("zigzag entre deux murs parallèles : saute du mur A et accroche le mur d'en face", () => {
    // Couloir de 6 m de large : A au sud (z ≥ 0), B au nord (z ≤ −6).
    const B = rect(-300, -46, 300, -6, 30);
    const m = mondeDe(A, B);
    const iB = 3;
    const cap = lacetVers(1, 0);
    let e = etatA([-20, 12, -1.5], [9 * FX, 0, 9 * FZ], { auSol: false });
    // 1. Accroche A.
    e = avancer(e, 0.5, { ...coursebiais, saut: false }, m);
    expect(e.mur?.prisme).toBe(iA);
    // 2. Saute (front montant) puis relâche : l'autre mur doit raccrocher sans autre action.
    e = etape(e, { avant: 1, droite: 0, saut: true, sprint: true, lacet: cap }, DT, m);
    expect(e.mur).toBeNull();
    const ordre: number[] = [];
    e = avancer(e, 1.6, { avant: 1, droite: 0, saut: false, sprint: true, lacet: cap }, m, (s) => {
      if (s.mur && ordre[ordre.length - 1] !== s.mur.prisme) ordre.push(s.mur.prisme);
    });
    expect(ordre[0]).toBe(iB);
    expect(e.mur?.prisme).toBe(iB);
    expect(e.mur?.nz).toBeCloseTo(1, 3);
    // Le mur B est à gauche quand on court vers l'est.
    expect(e.mur?.cote).toBe(-1);
    expect(e.sautsAir).toBe(1);
  });
});

describe("sauts", () => {
  const m = mondeDe();

  it("saut au sol à 6,8 m/s, puis un seul double saut, rechargé à l'atterrissage", () => {
    let e = etatInitial([0, 0, 0]);
    e = etape(e, { ...ENTREES_REPOS, saut: true }, DT, m);
    expect(e.auSol).toBe(false);
    expect(e.v[1]).toBeGreaterThan(MOUV.saut - 0.5);
    expect(e.sautsAir).toBe(1);
    // Maintenu : pas de front montant, donc pas de double saut automatique.
    e = avancer(e, 0.3, { ...ENTREES_REPOS, saut: true }, m);
    expect(e.sautsAir).toBe(1);
    e = etape(e, { ...ENTREES_REPOS, saut: false }, DT, m);
    const vyAvant = e.v[1];
    e = etape(e, { ...ENTREES_REPOS, saut: true }, DT, m);
    expect(e.sautsAir).toBe(0);
    expect(e.v[1]).toBeGreaterThan(vyAvant);
    expect(e.v[1]).toBeGreaterThan(MOUV.sautAir - 0.5);
    // Un troisième appui ne fait rien.
    e = etape(e, { ...ENTREES_REPOS, saut: false }, DT, m);
    const vy = e.v[1];
    e = etape(e, { ...ENTREES_REPOS, saut: true }, DT, m);
    expect(e.v[1]).toBeLessThan(vy);
    // Atterrissage : recharge.
    e = avancer(e, 3, ENTREES_REPOS, m);
    expect(e.auSol).toBe(true);
    expect(e.p[1]).toBe(0);
    expect(e.sautsAir).toBe(1);
  });

  it("double saut : le cap suit l'entrée et l'élan est gardé", () => {
    let e = etape(etatInitial([0, 0, 0]), { avant: 1, droite: 0, saut: true, sprint: true, lacet: 0 }, DT, m);
    e = avancer(e, 0.2, { avant: 1, droite: 0, saut: false, sprint: true, lacet: 0 }, m);
    e = etape(e, { avant: 0, droite: 1, saut: true, sprint: true, lacet: 0 }, DT, m);
    expect(e.v[0]).toBeGreaterThan(4); // vers l'est (droite)
    expect(Math.abs(e.v[2])).toBeLessThan(2);
  });

  it("coyote : on peut sauter 0,12 s après avoir quitté un toit, sans consommer le double saut", () => {
    const m2 = mondeDe(rect(0, 0, 20, 20, 8));
    // Sur le toit, près du bord est, qui avance vers l'est.
    let e = etatA([19.3, 8, 10], [0, 0, 0]);
    const en: Entrees = { avant: 1, droite: 0, saut: false, sprint: false, lacet: lacetVers(1, 0) };
    let tombe = -1;
    e = avancer(e, 0.6, en, m2, (s, t) => { if (!s.auSol && tombe < 0) tombe = t; });
    expect(tombe).toBeGreaterThan(0);
    // Rejoue jusqu'à la chute + 0,06 s et saute.
    let r = etatA([19.3, 8, 10]);
    r = avancer(r, tombe + 0.06, en, m2);
    expect(r.auSol).toBe(false);
    const apres = etape(r, { ...en, saut: true }, DT, m2);
    expect(apres.v[1]).toBeGreaterThan(MOUV.saut - 1);
    expect(apres.sautsAir).toBe(1);
    // 0,3 s après la chute, c'est un double saut (consomme).
    let t2 = etatA([19.3, 8, 10]);
    t2 = avancer(t2, tombe + 0.3, en, m2);
    const dbl = etape(t2, { ...en, saut: true }, DT, m2);
    expect(dbl.sautsAir).toBe(0);
  });
});

describe("escalade et toits", () => {
  // Bâtiment bas de 2 m : franchissable d'un saut + escalade.
  const bas = rect(0, -10, 20, 10, 2);
  const m = mondeDe(bas);

  it("escalade un toit bas : un saut contre le mur en poussant vers l'avant hisse sur le toit", () => {
    const en: Entrees = { avant: 1, droite: 0, saut: false, sprint: true, lacet: lacetVers(1, 0) };
    let e = etatA([-3, 0, 0], [9, 0, 0]);
    let monte = false;
    e = avancer(e, 1.5, (t) => ({ ...en, saut: t <= DT + 1e-9 }), m, (s) => { if (s.p[1] > 1.9 && !s.auSol) monte = true; });
    expect(monte).toBe(true);
    expect(e.auSol).toBe(true);
    expect(e.p[1]).toBeCloseTo(2, 6);
    expect(e.p[0]).toBeGreaterThan(0);
    expect(e.mur).toBeNull();
  });

  it("sans pousser vers l'avant, pas d'escalade", () => {
    const en: Entrees = { avant: 0, droite: 0, saut: false, sprint: false, lacet: lacetVers(1, 0) };
    const e = avancer(etatA([-0.6, 0, 0], [3, 0, 0]), 1.5, (t) => ({ ...en, saut: t <= DT + 1e-9 }), m);
    expect(e.p[1]).toBe(0);
    expect(e.p[0]).toBeLessThan(0);
  });

  it("un mur trop haut (toit à > 1,3 m des pieds) ne s'escalade pas", () => {
    const haut = mondeDe(rect(0, -10, 20, 10, 4));
    const en: Entrees = { avant: 1, droite: 0, saut: false, sprint: false, lacet: lacetVers(1, 0) };
    const e = avancer(etatA([-3, 0, 0], [6.5, 0, 0]), 2, (t) => ({ ...en, saut: t <= DT + 1e-9 }), haut);
    expect(e.p[1]).toBe(0);
    expect(e.p[0]).toBeLessThan(0);
  });

  it("monter sur un toit puis en tomber : on marche dessus, on traverse, on retombe au sol et le double saut revient", () => {
    const en: Entrees = { avant: 1, droite: 0, saut: false, sprint: true, lacet: lacetVers(1, 0) };
    let e = etatA([-3, 0, 0], [9, 0, 0]);
    let surToit = false, chute = false, maxY = 0;
    e = avancer(e, 5, (t) => ({ ...en, saut: t <= DT + 1e-9 }), m, (s) => {
      if (s.auSol && Math.abs(s.p[1] - 2) < 1e-9 && s.p[0] > 0 && s.p[0] < 20) surToit = true;
      if (surToit && !s.auSol) chute = true;
      maxY = Math.max(maxY, s.p[1]);
    });
    expect(surToit).toBe(true);
    expect(chute).toBe(true);
    expect(maxY).toBeLessThan(3.2);
    expect(e.auSol).toBe(true);
    expect(e.p[1]).toBe(0);
    expect(e.p[0]).toBeGreaterThan(20);
    expect(e.sautsAir).toBe(1);
  });

  it("tombe d'un grand toit : atterrit au sol (vitesse de chute bornée) sans traverser", () => {
    const grand = mondeDe(rect(0, -10, 20, 10, 16));
    let e = etatA([19.5, 16, 0]);
    let vmin = 0;
    e = avancer(e, 3, { avant: 1, droite: 0, saut: false, sprint: true, lacet: lacetVers(1, 0) }, grand, (s) => { vmin = Math.min(vmin, s.v[1]); });
    expect(e.auSol).toBe(true);
    expect(e.p[1]).toBe(0);
    expect(vmin).toBeGreaterThanOrEqual(-MOUV.chuteMax);
    expect(e.p[0]).toBeGreaterThanOrEqual(20 + R - 1e-6);
  });
});

describe("pas de traversée à grande vitesse", () => {
  it("30 m/s contre un mur de 30 cm, au sol et en l'air, à 60 Hz et à 10 Hz", () => {
    const mince = mondeDe(rect(-1, -10, -0.7, 10, 6));
    for (const dt of [DT, 0.1]) for (const y of [0, 3]) for (const sens of [1, -1]) {
      let e = etatA([sens > 0 ? -12 : 11, y, 0], [30 * sens, 0, 0], { auSol: y === 0 });
      const en: Entrees = { avant: 1, droite: 0, saut: false, sprint: true, lacet: lacetVers(sens, 0) };
      for (let t = 0; t < 1.5; t += dt) {
        e = etape(e, en, dt, mince);
        if (sens > 0) expect(e.p[0]).toBeLessThanOrEqual(-1 - R + 1e-6);
        else expect(e.p[0]).toBeGreaterThanOrEqual(-0.7 + R - 1e-6);
      }
    }
  });

  it("vrai scene.json : mouvements aléatoires (sauts, sprint, virages) sans jamais entrer dans un bâtiment", () => {
    const monde = construireMonde(scene);
    const alea = aleaGraine(11);
    const departs = pointsApparition(scene, monde);
    let dedansPas = 0, total = 0, accroches = 0;
    for (const [x0, z0] of departs.slice(0, 80)) {
      let e = etatInitial([x0, 0, z0]);
      let lacet = alea() * Math.PI * 2;
      let saut = false;
      for (let k = 0; k < 600; k++) {
        if (alea() < 0.04) lacet += (alea() - 0.5) * 2.5;
        if (alea() < 0.08) saut = !saut;
        e = etape(e, { avant: alea() < 0.95 ? 1 : 0, droite: alea() < 0.2 ? 1 : 0, saut, sprint: true, lacet }, DT, monde);
        if (e.mur) accroches++;
        total++;
        const [x, y, z] = e.p;
        for (const pr of monde.prismes) {
          if (y >= pr.h - 0.1) continue;
          if (x < pr.boite.x0 || x > pr.boite.x1 || z < pr.boite.z0 || z > pr.boite.z1) continue;
          if (dedans(x, z, pr.anneau) && !pr.trous.some((t) => dedans(x, z, t))) { dedansPas++; break; }
        }
      }
    }
    expect(dedansPas / total).toBeLessThan(0.002);
    expect(accroches).toBeGreaterThan(0); // le scénario exerce bien des wall-runs
  });
});

describe("constantes de vitesse (v2 §2.1)", () => {
  it("chaîne de plafonds : marche × mult ≤ sprint × mult (couteau) ≤ vitesseMaxH < plafond serveur ≤ vitesse déclarée", () => {
    expect(MOUV.marche * 1.3).toBeLessThanOrEqual(MOUV.sprint * 1.3);
    expect(MOUV.sprint * 1.3).toBeCloseTo(16.25, 9);
    expect(MOUV.sprint * 1.3).toBeLessThanOrEqual(MOUV.vitesseMaxH);
    expect(MOUV.vitesseMaxH).toBeLessThan(PLAFONDS.vitesseHorizontaleMax);
    expect(PLAFONDS.vitesseHorizontaleMax).toBeLessThanOrEqual(PLAFONDS.vitesseDeclareeMax);
    // un saut de mur (tangente maximale + normale) tient sous le plafond
    expect(MOUV.vitesseMaxH).toBeGreaterThan(Math.hypot(MOUV.murVitesseMax, MOUV.murSautNormale));
  });

  it("valeurs de la spec", () => {
    expect([MOUV.marche, MOUV.sprint, MOUV.accelSol, MOUV.frictionSol, MOUV.frictionExces, MOUV.accelAir]).toEqual([9, 12.5, 84, 75, 30, 16]);
    expect([MOUV.murVitesseEntreeMin, MOUV.murVitesse, MOUV.murVitesseMax, MOUV.vitesseMaxH]).toEqual([5.5, 10, 13, 18]);
    expect(MOUV.murSautNormale).toBe(6.5);
    expect(MOUV.murSautVy).toBe(7);
  });

  it("wall-run : murVitesse est atteignable avec la nouvelle vitesse de course", () => {
    const { trace } = lancerContreMur();
    const acc = trace.find((s) => s.e.mur !== null)!;
    expect(acc).toBeDefined();
    expect(Math.hypot(acc.e.v[0], acc.e.v[2])).toBeGreaterThanOrEqual(MOUV.murVitesse - 1e-6);
    expect(MOUV.murVitesse).toBeLessThanOrEqual(MOUV.sprint);
  });
});

describe("accroupi (v2 §2.8)", () => {
  const m = mondeDe();
  const base: Entrees = { avant: 1, droite: 0, saut: false, sprint: false, lacet: 0 };

  it("état initial : debout, sans glissade", () => {
    const e = etatInitial([0, 0, 0]);
    expect(e.accroupi).toBe(false);
    expect(e.glisse).toBeNull();
  });

  it("hauteurOeil : 1,95 debout, 1,30 accroupi", () => {
    expect(hauteurOeil(false)).toBe(1.95);
    expect(hauteurOeil(true)).toBe(1.3);
  });

  it("accroupi au sol : vitesse × 0,5 (marche et sprint), multiplicateur d'arme compris", () => {
    const marche = avancer(etatInitial([0, 0, 0]), 1, { ...base, accroupi: true }, m);
    expect(marche.accroupi).toBe(true);
    expect(Math.hypot(marche.v[0], marche.v[2])).toBeCloseTo(MOUV.marche * MOUV.accroupiMult, 5);
    const sprint = avancer(etatInitial([0, 0, 0]), 1, { ...base, sprint: true, accroupi: true }, m);
    expect(Math.hypot(sprint.v[0], sprint.v[2])).toBeCloseTo(MOUV.sprint * MOUV.accroupiMult, 5);
    const couteau = etape(etatInitial([0, 0, 0]), { ...base, sprint: true, accroupi: true }, 1, m, 1.3);
    expect(Math.hypot(couteau.v[0], couteau.v[2])).toBeCloseTo(MOUV.sprint * MOUV.accroupiMult * 1.3, 5);
  });

  it("se relever est toujours possible : la vitesse revient à la course", () => {
    let e = avancer(etatInitial([0, 0, 0]), 0.5, { ...base, accroupi: true }, m);
    expect(e.accroupi).toBe(true);
    e = avancer(e, 0.5, { ...base, accroupi: false }, m);
    expect(e.accroupi).toBe(false);
    expect(Math.hypot(e.v[0], e.v[2])).toBeCloseTo(MOUV.marche, 5);
  });

  it("refusé en l'air : un état aérien ne devient pas accroupi, et le saut relève", () => {
    const air = etape(etatA([0, 5, 0], [0, 0, 0], { auSol: false }), { ...base, accroupi: true }, DT, m);
    expect(air.accroupi).toBe(false);
    let e = avancer(etatInitial([0, 0, 0]), 0.3, { ...base, accroupi: true }, m);
    expect(e.accroupi).toBe(true);
    e = etape(e, { ...base, accroupi: true, saut: true }, DT, m);
    expect(e.auSol).toBe(false);
    e = etape(e, { ...base, accroupi: true, saut: true }, DT, m);
    expect(e.accroupi).toBe(false);
    // et il peut s'accroupir de nouveau à l'atterrissage, touche tenue
    e = avancer(e, 2, { ...base, accroupi: true }, m);
    expect(e.auSol).toBe(true);
    expect(e.accroupi).toBe(true);
  });

  it("refusé en wall-run", () => {
    const { trace } = lancerContreMur();
    const iAccroche = trace.findIndex((s) => s.e.mur !== null);
    let e = trace[iAccroche + 5].e;
    expect(e.mur).not.toBeNull();
    e = etape(e, { ...coursebiais, accroupi: true }, DT, mondeMur);
    expect(e.accroupi).toBe(false);
    expect(e.glisse).toBeNull();
  });

  it("la tenue de la touche ne fait pas glisser : seul l'appui déclenche, jamais l'atterrissage touche tenue", () => {
    const vite = etatA([0, 6, 0], [0, 0, -12.5], { auSol: false });
    let e = vite;
    let glisse = false;
    e = avancer(e, 2, { avant: 1, droite: 0, saut: false, sprint: true, lacet: 0, accroupi: true }, m, (s) => { if (s.glisse) glisse = true; });
    expect(e.auSol).toBe(true);
    expect(glisse).toBe(false);
  });
});

describe("glissade (v2 §2.8 et §13.3)", () => {
  const m = mondeDe();
  const sprint: Entrees = { avant: 1, droite: 0, saut: false, sprint: true, lacet: 0 };
  const VA = MOUV.marche * MOUV.accroupiMult;

  /** Sprint établi (12,5 m/s vers −z). */
  function enCourse(): EtatMouvement {
    return avancer(etatInitial([0, 0, 0]), 0.5, sprint, m);
  }
  const glisser = (e: EtatMouvement, entrees: Entrees = sprint, monde: Monde = m) => etape(e, { ...entrees, accroupi: true }, DT, monde);

  it("l'appui à ≥ 10,5 m/s déclenche la glissade : état propre, direction figée, hitbox accroupie", () => {
    const e = glisser(enCourse());
    expect(e.glisse).not.toBeNull();
    expect(e.glisse!.v0).toBeCloseTo(MOUV.sprint, 5);
    expect(e.glisse!.dir[0]).toBeCloseTo(0, 6);
    expect(e.glisse!.dir[1]).toBeCloseTo(-1, 6);
    expect(e.accroupi).toBe(true);
    expect(e.auSol).toBe(true);
  });

  it("pas de glissade sous 10,5 m/s (marche, sprint du sniper trop lent) ni en l'air", () => {
    const marche = avancer(etatInitial([0, 0, 0]), 0.5, { ...sprint, sprint: false }, m);
    const e = glisser(marche, { ...sprint, sprint: false });
    expect(e.glisse).toBeNull();
    expect(e.accroupi).toBe(true);
    expect(Math.hypot(e.v[0], e.v[2])).toBeLessThan(MOUV.glisseVitesseMin);
    // exactement au seuil, ça passe ; juste dessous non
    const seuil = etatA([0, 0, 0], [0, 0, -MOUV.glisseVitesseMin]);
    expect(glisser(seuil, { ...sprint, avant: 0, sprint: false }).glisse).not.toBeNull();
    const dessous = etatA([0, 0, 0], [0, 0, -(MOUV.glisseVitesseMin - 0.3)]);
    expect(glisser(dessous, { ...sprint, avant: 0, sprint: false }).glisse).toBeNull();
    const air = etatA([0, 5, 0], [0, 0, -12.5], { auSol: false });
    expect(glisser(air).glisse).toBeNull();
  });

  it("durée 0,75 s, vitesse = formule quadratique, décroissance monotone, ni accélération ni friction normales", () => {
    const depart = enCourse();
    const zDepart = depart.p[2];
    let e = glisser(depart);
    const v0 = e.glisse!.v0;
    const vitesses: number[] = [];
    let fin = -1;
    // le premier pas est déjà fait (t = DT)
    for (let k = 1; k <= 60; k++) {
      vitesses.push(Math.hypot(e.v[0], e.v[2]));
      expect(e.glisse).not.toBeNull();
      // la vitesse suit exactement la formule au temps écoulé
      expect(vitesses[vitesses.length - 1]).toBeCloseTo(VA + (v0 - VA) * (1 - e.glisse!.t / MOUV.glisseDureeS) ** 2, 6);
      e = etape(e, { ...sprint, accroupi: true }, DT, m);
      if (!e.glisse) { fin = k * DT + DT; break; }
    }
    // t = 0,75 s : fin (45 pas de 1/60 s, le premier étant dans glisser())
    expect(fin).toBeCloseTo(MOUV.glisseDureeS, 2);
    for (let i = 1; i < vitesses.length; i++) expect(vitesses[i]).toBeLessThan(vitesses[i - 1]);
    // la vitesse est restée au-dessus de l'accroupi tout du long, et s'y fond à la fin
    expect(Math.min(...vitesses)).toBeGreaterThan(VA);
    expect(vitesses[vitesses.length - 1]).toBeCloseTo(VA, 1);
    // sans la friction de 75 m/s² (qui l'aurait tuée en 0,17 s) : 1/4 de durée plus tard on a encore > 60 % de v0
    expect(vitesses[11]).toBeGreaterThan(0.6 * v0);
    // distance parcourue : intégrale de la formule, vAccroupi·T + (v0 − vAccroupi)·T/3 = 5,375 m, bien plus qu'un arrêt en 0,17 s (≈ 1,1 m)
    expect(zDepart - e.p[2]).toBeGreaterThan(5.2);
    expect(zDepart - e.p[2]).toBeLessThan(5.6);
  });

  it("la direction est figée : braquer pendant la glissade ne la tourne pas", () => {
    let e = glisser(enCourse());
    for (let k = 0; k < 20; k++) e = etape(e, { avant: 1, droite: 1, saut: false, sprint: true, lacet: 1.5, accroupi: true }, DT, m);
    expect(e.glisse).not.toBeNull();
    expect(e.v[0]).toBeCloseTo(0, 6);
    expect(e.v[2]).toBeLessThan(0);
  });

  it("lâcher la touche ne l'interrompt pas (hitbox accroupie jusqu'au bout)", () => {
    let e = glisser(enCourse());
    e = etape(e, sprint, DT, m); // accroupi relâché
    expect(e.glisse).not.toBeNull();
    expect(e.accroupi).toBe(true);
  });

  it("à la fin, on repart debout (touche relâchée) ou accroupi (touche tenue), sans à-coup de vitesse", () => {
    let tenue = glisser(enCourse());
    let relache = tenue;
    tenue = avancer(tenue, 1, { ...sprint, accroupi: true }, m);
    relache = avancer(relache, 1, sprint, m);
    expect(tenue.glisse).toBeNull();
    expect(tenue.accroupi).toBe(true);
    expect(Math.hypot(tenue.v[0], tenue.v[2])).toBeCloseTo(MOUV.sprint * MOUV.accroupiMult, 4);
    expect(relache.accroupi).toBe(false);
    expect(Math.hypot(relache.v[0], relache.v[2])).toBeCloseTo(MOUV.sprint, 4);
  });

  it("glissade → saut = saut glissé : la glissade s'arrête, l'élan est gardé en l'air", () => {
    let e = enCourse();
    e = glisser(e);
    e = avancer(e, 0.2, { ...sprint, accroupi: true }, m);
    expect(e.glisse).not.toBeNull();
    const vSaut = Math.hypot(e.v[0], e.v[2]);
    expect(vSaut).toBeGreaterThan(MOUV.sprint * MOUV.accroupiMult + 2);
    e = etape(e, { ...sprint, accroupi: true, saut: true }, DT, m);
    expect(e.glisse).toBeNull();
    expect(e.auSol).toBe(false);
    expect(e.accroupi).toBe(false);
    expect(e.v[1]).toBeGreaterThan(MOUV.saut - 0.5);
    // l'élan est gardé (aucune friction en l'air) : sans entrée contraire, la vitesse horizontale ne chute pas
    const apres = avancer(e, 0.3, { ...sprint, accroupi: true, saut: true }, m);
    expect(Math.hypot(apres.v[0], apres.v[2])).toBeGreaterThanOrEqual(vSaut - 0.5);
  });

  it("quitter le sol (rebord d'un toit) l'arrête", () => {
    const toit = mondeDe(rect(-30, -30, 30, 30, 8));
    let e = etatA([0, 8, -22], [0, 0, -12.5]);
    e = avancer(e, 0.3, sprint, toit);
    expect(e.auSol).toBe(true);
    e = glisser(e, sprint, toit);
    expect(e.glisse).not.toBeNull();
    let fin = false;
    e = avancer(e, 0.75, { ...sprint, accroupi: true }, toit, (s) => { if (!s.glisse && !s.auSol) fin = true; });
    expect(fin).toBe(true);
  });

  it("contre un mur de face elle s'arrête, sans traverser", () => {
    const mur = mondeDe(rect(-20, -12, 20, -10, 6));
    let e = avancer(etatA([0, 0, -3]), 0.2, sprint, mur);
    e = glisser(e);
    e = avancer(e, 0.75, { ...sprint, accroupi: true }, mur);
    expect(e.glisse).toBeNull();
    expect(e.p[2]).toBeGreaterThanOrEqual(-10 + R - 1e-6);
    expect(Math.hypot(e.v[0], e.v[2])).toBeLessThan(1);
  });

  it("ne dépend pas du dt (60 Hz, 30 Hz)", () => {
    const fin = (dt: number) => {
      let e = enCourse();
      e = etape(e, { ...sprint, accroupi: true }, dt, m);
      for (let t = dt; t < 0.7; t += dt) e = etape(e, { ...sprint, accroupi: true }, dt, m);
      return e.p[2];
    };
    expect(Math.abs(fin(1 / 60) - fin(1 / 30))).toBeLessThan(0.2);
  });

  it("couteau : la formule part de la vitesse réelle (16,25) et se fond dans l'accroupi du couteau", () => {
    let e = avancer(etatInitial([0, 0, 0]), 0.5, sprint, m);
    for (let k = 0; k < 30; k++) e = etape(e, sprint, DT, m, 1.3);
    e = etape(e, { ...sprint, accroupi: true }, DT, m, 1.3);
    expect(e.glisse!.v0).toBeCloseTo(MOUV.sprint * 1.3, 5);
    for (let k = 0; k < 60; k++) e = etape(e, { ...sprint, accroupi: true }, DT, m, 1.3);
    expect(e.glisse).toBeNull();
    expect(Math.hypot(e.v[0], e.v[2])).toBeCloseTo(MOUV.marche * MOUV.accroupiMult * 1.3 * (MOUV.sprint / MOUV.marche), 1);
  });

  it("seuil RELATIF à l'arme : le sprint du minigun (×0,75) ou du sniper en visée glisse aussi (régression : seuil absolu de 10,5 m/s)", () => {
    for (const mult of [0.75, 0.9 * 0.8, 0.88, 1.3]) {
      let e = etatInitial([0, 0, 0]);
      for (let k = 0; k < 40; k++) e = etape(e, sprint, DT, m, mult);
      const vh = Math.hypot(e.v[0], e.v[2]);
      expect(vh).toBeCloseTo(MOUV.sprint * mult, 3);
      expect(vh).toBeGreaterThanOrEqual(seuilGlisse(mult));
      e = etape(e, { ...sprint, accroupi: true }, DT, m, mult);
      expect(e.glisse, `mult ${mult}`).not.toBeNull();
    }
    // la marche ne glisse jamais, quelle que soit l'arme
    for (const mult of [0.75, 1, 1.3]) {
      let e = etatInitial([0, 0, 0]);
      for (let k = 0; k < 40; k++) e = etape(e, { ...sprint, sprint: false }, DT, m, mult);
      expect(etape(e, { ...sprint, sprint: false, accroupi: true }, DT, m, mult).glisse).toBeNull();
    }
    expect(seuilGlisse(1)).toBe(MOUV.glisseVitesseMin);
  });

  it("recharge de 0,6 s entre deux glissades (finitions)", () => {
    expect(MOUV.glisseRechargeS).toBe(0.6);
    // glissade 1, puis fin de durée touche relâchée, sprint rétabli
    let e = glisser(enCourse());
    e = avancer(e, MOUV.glisseDureeS + 0.05, { ...sprint, accroupi: true }, m);
    expect(e.glisse).toBeNull();
    expect(e.glisseRecharge).toBeGreaterThan(0);
    // relâcher, retrouver le sprint (pour que la vitesse ne soit pas en cause), puis réappuyer trop tôt : refusé
    e = etatA(e.p, [0, 0, -MOUV.sprint], { glisseRecharge: e.glisseRecharge });
    e = etape(e, sprint, DT, m);
    const tot = glisser(e);
    expect(tot.glisse).toBeNull();
    // après 0,6 s le même appui déclenche
    let tard = etatA(e.p, [0, 0, -MOUV.sprint], { glisseRecharge: e.glisseRecharge });
    tard = avancer(tard, MOUV.glisseRechargeS + 0.05, sprint, m);
    expect(tard.glisseRecharge).toBe(0);
    expect(glisser(tard).glisse).not.toBeNull();
  });

  it("la recharge démarre aussi quand la glissade s'arrête par un saut", () => {
    let e = glisser(enCourse());
    e = etape(e, { ...sprint, accroupi: true, saut: true }, DT, m);
    expect(e.glisse).toBeNull();
    expect(e.glisseRecharge).toBeGreaterThan(0.5);
  });

  it("le roulis caméra penche pendant la glissade et revient après", () => {
    let e = glisser(enCourse());
    e = avancer(e, 0.4, { ...sprint, accroupi: true }, m);
    expect(e.inclinaison).toBeGreaterThan(MOUV.glisseInclinaison * 0.8);
    e = avancer(e, 1, sprint, m);
    expect(Math.abs(e.inclinaison)).toBeLessThan(0.01);
  });

  it("etape ne modifie pas l'état glissant reçu", () => {
    const e = glisser(enCourse());
    const copie = JSON.stringify(e);
    etape(e, { ...sprint, accroupi: true }, DT, m);
    expect(JSON.stringify(e)).toBe(copie);
  });
});

describe("utilitaires réseau", () => {
  it("postureDe et coteMurDe", () => {
    const e = etatInitial([0, 0, 0]);
    expect(postureDe(e)).toBe("sol");
    expect(coteMurDe(e)).toBe(0);
    expect(postureDe({ ...e, auSol: false })).toBe("air");
    const mur = { nx: 0, nz: -1, cote: -1 as const, t: 0.3, prisme: 2 };
    expect(postureDe({ ...e, auSol: false, mur })).toBe("mur");
    expect(coteMurDe({ ...e, auSol: false, mur })).toBe(-1);
    expect(coteMurDe({ ...e, auSol: false, mur: { ...mur, cote: 1 } })).toBe(1);
  });
});
