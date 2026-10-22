import { describe, expect, it } from "vitest";
import { angleRelatif, anglesVers, chrono, directionRegard, ecartViseurPx, fovVerticalDeg, lissage, panSon } from "./vue";

describe("directionRegard / anglesVers", () => {
  it("lacet 0 regarde vers −z, lacet +90° vers −x (tourne à gauche)", () => {
    const a = directionRegard(0, 0);
    expect(a[0]).toBeCloseTo(0); expect(a[1]).toBeCloseTo(0); expect(a[2]).toBeCloseTo(-1);
    const b = directionRegard(Math.PI / 2, 0);
    expect(b[0]).toBeCloseTo(-1); expect(b[2]).toBeCloseTo(0);
  });
  it("le tangage positif monte", () => {
    expect(directionRegard(0, Math.PI / 4)[1]).toBeGreaterThan(0.7);
  });
  it("anglesVers est l'inverse de directionRegard", () => {
    for (const [l, t] of [[0.3, 0.2], [-2.1, -0.5], [3, 0.9]] as const) {
      const d = directionRegard(l, t);
      const r = anglesVers(d[0], d[1], d[2]);
      expect(Math.cos(r.lacet - l)).toBeCloseTo(1);
      expect(r.tangage).toBeCloseTo(t);
    }
  });
});

describe("fovVerticalDeg", () => {
  it("90° horizontal en 16:9 donne environ 58,7° vertical", () => {
    expect(fovVerticalDeg(90, 16 / 9)).toBeCloseTo(58.7, 0);
  });
  it("est borné", () => {
    expect(fovVerticalDeg(90, 0.2)).toBeLessThanOrEqual(110);
    expect(fovVerticalDeg(1, 3)).toBeGreaterThanOrEqual(4);
  });
});

describe("angleRelatif / panSon", () => {
  it("devant, droite, gauche, derrière", () => {
    expect(angleRelatif(0, 0, -5)).toBeCloseTo(0);
    expect(angleRelatif(0, 5, 0)).toBeCloseTo(Math.PI / 2);
    expect(angleRelatif(0, -5, 0)).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(angleRelatif(0, 0, 5))).toBeCloseTo(Math.PI);
  });
  it("suit le lacet : regard vers −x (lacet 90°), l'est est derrière à droite…", () => {
    // lacet +90° : l'avant est −x, la droite est −z
    expect(angleRelatif(Math.PI / 2, -3, 0)).toBeCloseTo(0);
    expect(angleRelatif(Math.PI / 2, 0, -3)).toBeCloseTo(Math.PI / 2);
  });
  it("le pan va de −1 à 1", () => {
    expect(panSon(0, 10, 0)).toBeCloseTo(1);
    expect(panSon(0, -10, 0)).toBeCloseTo(-1);
    expect(panSon(0, 0, -10)).toBeCloseTo(0);
    expect(panSon(0, 0, 0)).toBe(0);
  });
});

describe("ecartViseurPx", () => {
  it("proportionnel à la dispersion, nul sans dispersion", () => {
    expect(ecartViseurPx(0, 60, 1080)).toBe(0);
    const a = ecartViseurPx(0.02, 60, 1080), b = ecartViseurPx(0.04, 60, 1080);
    expect(b / a).toBeGreaterThan(1.9);
    expect(b / a).toBeLessThan(2.1);
  });
});

describe("lissage / chrono", () => {
  it("lissage est dans [0, 1[", () => {
    expect(lissage(10, 0)).toBe(0);
    expect(lissage(10, 1)).toBeLessThan(1);
    expect(lissage(10, 0.05)).toBeGreaterThan(0.3);
  });
  it("chrono arrondit à la seconde supérieure", () => {
    expect(chrono(480_000)).toBe("8:00");
    expect(chrono(59_001)).toBe("1:00");
    expect(chrono(-5)).toBe("0:00");
    expect(chrono(61_000)).toBe("1:01");
  });
});
