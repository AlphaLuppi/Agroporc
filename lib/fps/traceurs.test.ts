import { describe, expect, it } from "vitest";
import { ETIREMENT_TRAINEE_S, LARGEUR_MIN_M, TRACEURS, dureeVie, etatTraceur, instantImpact, largeurMonde } from "./traceurs";
import { ARMES, type Vec3 } from "./protocole";

const O: Vec3 = [0, 1.5, 0];
const vers = (d: number): Vec3 => [d, 1.5, 0];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("TRACEURS", () => {
  it("une entrée par arme à feu, vie minimale de 0,25 s, ruban d'au moins 3 px", () => {
    for (const id of ARMES) {
      expect(TRACEURS[id], id).toBeDefined();
      expect(TRACEURS[id].vieMinS).toBeGreaterThanOrEqual(0.25);
      expect(TRACEURS[id].epaisseurPx).toBeGreaterThanOrEqual(3);
      expect(TRACEURS[id].vitesse).toBeGreaterThan(0);
      expect(TRACEURS[id].longueur).toBeGreaterThan(0);
    }
  });

  it("sniper (1,0 s) et railgun (1,5 s) laissent une traînée, aucune autre arme", () => {
    expect(TRACEURS.sniper.persistanceS).toBe(1.0);
    expect(TRACEURS.railgun.persistanceS).toBe(1.5);
    for (const id of ARMES) if (id !== "sniper" && id !== "railgun") expect(TRACEURS[id].persistanceS, id).toBe(0);
  });

  it("vitesses visuelles de la spec (§2.9)", () => {
    expect(TRACEURS.pistolet.vitesse).toBe(200);
    expect(TRACEURS.mitraillette.vitesse).toBe(220);
    expect(TRACEURS.fusil_assaut.vitesse).toBe(260);
    expect(TRACEURS.pompe.vitesse).toBe(160);
    expect(TRACEURS.sniper.vitesse).toBe(420);
    expect(TRACEURS.railgun.vitesse).toBe(600);
    expect(TRACEURS.sniper.longueur).toBe(25);
  });
});

describe("dureeVie / instantImpact", () => {
  it("dureeVie >= 0,25 s pour toute distance et toute arme", () => {
    for (const id of ARMES) {
      for (const d of [0, 0.5, 3, 10, 50, 100, 300, 500, 2000]) {
        expect(dureeVie(O, vers(d), TRACEURS[id]), `${id} ${d} m`).toBeGreaterThanOrEqual(0.25);
      }
    }
  });

  it("dureeVie = max(vieMin ; distance/vitesse + 0,12) + persistance", () => {
    const p = TRACEURS.pistolet;
    expect(dureeVie(O, vers(10), p)).toBeCloseTo(0.25, 9); // 10/200 + 0,12 = 0,17 < 0,25
    expect(dureeVie(O, vers(100), p)).toBeCloseTo(100 / 200 + 0.12, 9);
    expect(dureeVie(O, vers(100), TRACEURS.sniper)).toBeCloseTo(Math.max(0.25, 100 / 420 + 0.12) + 1.0, 9);
    expect(dureeVie(O, vers(300), TRACEURS.railgun)).toBeCloseTo(Math.max(0.25, 300 / 600 + 0.12) + 1.5, 9);
  });

  it("instantImpact = distance / vitesse", () => {
    expect(instantImpact(O, vers(100), TRACEURS.pistolet)).toBeCloseTo(0.5, 9);
    expect(instantImpact(O, vers(420), TRACEURS.sniper)).toBeCloseTo(1.0, 9);
    expect(instantImpact(O, O, TRACEURS.pistolet)).toBe(0);
    // trajet oblique
    expect(instantImpact([0, 0, 0], [30, 40, 0], TRACEURS.pistolet)).toBeCloseTo(50 / 200, 9);
  });
});

describe("etatTraceur", () => {
  const p = TRACEURS.mitraillette; // 220 m/s, ruban de 6 m
  const fin = vers(100);

  it("à l'âge 0 : tête et queue au départ, pleine opacité, pas arrivée", () => {
    const e = etatTraceur(O, fin, p, 0);
    expect(e.tete).toEqual(O);
    expect(e.queue).toEqual(O);
    expect(e.alpha).toBe(1);
    expect(e.arrive).toBe(false);
    expect(e.fini).toBe(false);
  });

  it("la tête voyage à la vitesse de l'arme, la queue reste à `longueur` derrière", () => {
    const e = etatTraceur(O, fin, p, 0.2);
    expect(e.tete[0]).toBeCloseTo(44, 6);
    expect(dist(e.tete, e.queue)).toBeCloseTo(p.longueur, 6);
    expect(e.queue[0]).toBeCloseTo(44 - p.longueur, 6);
    expect(e.arrive).toBe(false);
  });

  it("tout reste sur le segment départ -> impact", () => {
    for (const age of [0, 0.1, 0.3, 0.45, 0.46, 0.6, 1]) {
      const e = etatTraceur(O, [60, 30, -40], p, age);
      const total = dist(O, [60, 30, -40]);
      for (const pt of [e.tete, e.queue]) {
        const u = dist(O, pt) / total;
        expect(u).toBeGreaterThanOrEqual(-1e-9);
        expect(u).toBeLessThanOrEqual(1 + 1e-9);
        expect(dist(O, pt) + dist(pt, [60, 30, -40])).toBeCloseTo(total, 6);
      }
    }
  });

  it("la tête s'arrête sur l'impact à l'instant `instantImpact` et `arrive` passe à vrai", () => {
    const t = instantImpact(O, fin, p);
    expect(etatTraceur(O, fin, p, t - 0.01).arrive).toBe(false);
    const e = etatTraceur(O, fin, p, t);
    expect(e.arrive).toBe(true);
    expect(e.tete[0]).toBeCloseTo(100, 6);
    const apres = etatTraceur(O, fin, p, t + 0.1);
    expect(apres.tete[0]).toBeCloseTo(100, 6);
    expect(apres.queue).toEqual(e.queue); // ruban figé, il ne fait que s'estomper
  });

  it("tir très court : la queue ne passe pas derrière le départ", () => {
    const e = etatTraceur(O, vers(2), p, 0.005);
    expect(e.queue).toEqual(O);
    expect(dist(O, e.tete)).toBeLessThanOrEqual(2 + 1e-9);
  });

  it("alpha non croissant, de 1 à 0 sur la vie ; `fini` exactement à la fin de vie", () => {
    for (const id of ARMES) {
      const par = TRACEURS[id];
      const f = vers(80);
      const vie = dureeVie(O, f, par);
      let prec = 1;
      for (let age = 0; age <= vie + 0.2; age += 0.01) {
        const e = etatTraceur(O, f, par, age);
        expect(e.alpha, `${id} ${age}`).toBeLessThanOrEqual(prec + 1e-12);
        expect(e.alpha).toBeGreaterThanOrEqual(0);
        prec = e.alpha;
      }
      expect(etatTraceur(O, f, par, vie - 1e-3).fini).toBe(false);
      expect(etatTraceur(O, f, par, vie).fini).toBe(true);
      expect(etatTraceur(O, f, par, vie).alpha).toBe(0);
    }
  });

  it("visible au moins 0,25 s même sur une cible toute proche", () => {
    const e = etatTraceur(O, vers(5), TRACEURS.pistolet, 0.249);
    expect(e.fini).toBe(false);
    expect(e.alpha).toBeGreaterThan(0);
  });

  it("sniper : la traînée s'étire jusqu'au départ après l'arrivée et reste visible ~1 s", () => {
    const par = TRACEURS.sniper;
    const f = vers(200);
    const t = instantImpact(O, f, par);
    const enVol = etatTraceur(O, f, par, t - 0.01);
    expect(dist(enVol.tete, enVol.queue)).toBeCloseTo(par.longueur, 6);
    const etiree = etatTraceur(O, f, par, t + ETIREMENT_TRAINEE_S + 0.001);
    expect(etiree.queue[0]).toBeCloseTo(0, 6);
    expect(etiree.tete[0]).toBeCloseTo(200, 6);
    const presqueFin = etatTraceur(O, f, par, t + 0.9);
    expect(presqueFin.fini).toBe(false);
    expect(presqueFin.alpha).toBeGreaterThan(0);
  });

  it("le railgun reste visible plus longtemps que le sniper pour la même distance", () => {
    const f = vers(200);
    expect(dureeVie(O, f, TRACEURS.railgun)).toBeGreaterThan(dureeVie(O, f, TRACEURS.sniper));
    expect(etatTraceur(O, f, TRACEURS.railgun, 1.4).fini).toBe(false);
  });

  it("tir de longueur nulle : pas de NaN", () => {
    const e = etatTraceur(O, O, TRACEURS.pistolet, 0.1);
    for (const v of [...e.tete, ...e.queue, e.alpha]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("largeurMonde", () => {
  it("jamais sous le plancher de 0,04 m", () => {
    for (const d of [0, 0.1, 1, 5, 50, 500]) expect(largeurMonde(d, 3, 90, 1080)).toBeGreaterThanOrEqual(LARGEUR_MIN_M);
  });

  it("proportionnelle à la distance (au-dessus du plancher)", () => {
    const a = largeurMonde(100, 3, 90, 1080);
    const b = largeurMonde(200, 3, 90, 1080);
    expect(a).toBeGreaterThan(LARGEUR_MIN_M);
    expect(b / a).toBeCloseTo(2, 9);
  });

  it("garde bien `epaisseurPx` : à 100 m, fov 90°, 1080 px, 3 px = 2 × 100 / 1080 × 3 m de large", () => {
    expect(2 * largeurMonde(100, 3, 90, 1080)).toBeCloseTo((2 * 100 * 3) / 1080, 9);
  });

  it("plus épais ou plus de pixels : plus large ; plus de pixels de hauteur : plus fin", () => {
    expect(largeurMonde(100, 6, 90, 1080)).toBeGreaterThan(largeurMonde(100, 3, 90, 1080));
    expect(largeurMonde(100, 3, 90, 2160)).toBeLessThan(largeurMonde(100, 3, 90, 1080));
    expect(largeurMonde(100, 3, 60, 1080)).toBeLessThan(largeurMonde(100, 3, 90, 1080));
  });
});
