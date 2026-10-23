import { describe, expect, it } from "vitest";
import { InterpolateurVehicules } from "./interpolation-vehicules";
import { PLAFONDS, type VehiculeSnap } from "./protocole";

function v(id: number, x: number, extra: Partial<VehiculeSnap> = {}): VehiculeSnap {
  return { id, p: [x, 0, 0], cap: -Math.PI / 2, v: 10, ...extra };
}

describe("InterpolateurVehicules", () => {
  it("interpole position, vitesse et cap entre deux instantanés", () => {
    const it = new InterpolateurVehicules();
    it.ajouter(1000, [v(0, 0, { cap: 0.2, v: 4 })]);
    it.ajouter(1050, [v(0, 1, { cap: 0.6, v: 8 })]);
    const e = it.echantillon(1025).get(0)!;
    expect(e.p[0]).toBeCloseTo(0.5, 10);
    expect(e.cap).toBeCloseTo(0.4, 10);
    expect(e.v).toBeCloseTo(6, 10);
  });

  it("tourne par le plus court chemin à travers ±π", () => {
    const it = new InterpolateurVehicules();
    it.ajouter(0, [v(0, 0, { cap: 3.0 })]);
    it.ajouter(100, [v(0, 0, { cap: -3.0 })]);
    expect(Math.abs(Math.abs(it.echantillon(50).get(0)!.cap) - Math.PI)).toBeLessThan(0.01);
  });

  it("extrapole le long du cap, bornée à 150 ms", () => {
    const it = new InterpolateurVehicules();
    it.ajouter(1000, [v(0, 0)]);
    it.ajouter(1050, [v(0, 0.5)]); // cap est, 10 m/s
    expect(it.echantillon(1100).get(0)!.p[0]).toBeCloseTo(0.5 + 10 * 0.05, 9);
    expect(it.echantillon(1050 + 150).get(0)!.p[0]).toBeCloseTo(0.5 + 1.5, 9);
    expect(it.echantillon(9000).get(0)!.p[0]).toBeCloseTo(0.5 + 1.5, 9);
    expect(it.echantillon(1050).get(0)!.p[0]).toBeCloseTo(0.5, 9);
  });

  it("extrapole dans la bonne direction pour un autre cap (nord = −z) et en marche arrière", () => {
    const it = new InterpolateurVehicules();
    it.ajouter(0, [v(0, 0, { cap: 0, v: 10 })]);
    const e = it.echantillon(100).get(0)!;
    expect(e.p[2]).toBeCloseTo(-1, 9);
    expect(e.p[0]).toBeCloseTo(0, 9);
    const arriere = new InterpolateurVehicules();
    arriere.ajouter(0, [v(0, 0, { cap: 0, v: -5 })]);
    expect(arriere.echantillon(100).get(0)!.p[2]).toBeCloseTo(0.5, 9);
  });

  it("un saut (remise en place) n'est pas interpolé : on prend l'échantillon le plus récent", () => {
    const it = new InterpolateurVehicules();
    it.ajouter(1000, [v(0, 40)]);
    it.ajouter(1050, [v(0, 0)]); // 40 m en 50 ms
    const e = it.echantillon(1010).get(0)!;
    expect(e.p[0]).toBe(0);
    // 28 m/s × 0,05 s + 3 m = 4,4 m : en dessous du seuil, on interpole
    const ok = new InterpolateurVehicules();
    ok.ajouter(1000, [v(0, 0)]);
    ok.ajouter(1050, [v(0, PLAFONDS.vitesseVehiculeMax * 0.05 + 2)]);
    expect(ok.echantillon(1025).get(0)!.p[0]).toBeCloseTo((PLAFONDS.vitesseVehiculeMax * 0.05 + 2) / 2, 9);
  });

  it("avant le plus ancien : tient la position la plus ancienne ; vide : rien", () => {
    const it = new InterpolateurVehicules();
    expect(it.echantillon(10).size).toBe(0);
    it.ajouter(1000, [v(0, 3)]);
    it.ajouter(1050, [v(0, 4)]);
    expect(it.echantillon(500).get(0)!.p[0]).toBe(3);
  });

  it("gère plusieurs voitures indépendamment et ignore celles qui ont disparu", () => {
    const it = new InterpolateurVehicules();
    it.ajouter(0, [v(0, 0), v(1, 10)]);
    it.ajouter(100, [v(0, 2), v(1, 10, { v: 0 })]);
    const e = it.echantillon(50);
    expect(e.get(0)!.p[0]).toBeCloseTo(1, 9);
    expect(e.get(1)!.p[0]).toBeCloseTo(10, 9);
    const it2 = new InterpolateurVehicules();
    it2.ajouter(0, [v(0, 0), v(1, 10)]);
    it2.ajouter(100, [v(0, 2)]);
    expect(it2.echantillon(50).has(1)).toBe(false);
  });

  it("accepte les instantanés dans le désordre et remplace un horodatage identique", () => {
    const it = new InterpolateurVehicules();
    it.ajouter(100, [v(0, 2)]);
    it.ajouter(0, [v(0, 0)]);
    expect(it.echantillon(50).get(0)!.p[0]).toBeCloseTo(1, 9);
    it.ajouter(100, [v(0, 4)]);
    expect(it.echantillon(50).get(0)!.p[0]).toBeCloseTo(2, 9);
  });

  it("le tampon par défaut garde 1000 ms, un tampon long (killcam) davantage ; vider() efface", () => {
    const court = new InterpolateurVehicules();
    const long = new InterpolateurVehicules(4000);
    for (let t = 0; t <= 3000; t += 50) { court.ajouter(t, [v(0, t / 100)]); long.ajouter(t, [v(0, t / 100)]); }
    // 500 ms avant la fin : présent dans les deux ; 2500 ms avant : seulement dans le tampon long (sinon : plus ancien connu, ≥ 2000)
    expect(court.echantillon(2500).get(0)!.p[0]).toBeCloseTo(25, 9);
    expect(long.echantillon(500).get(0)!.p[0]).toBeCloseTo(5, 9);
    expect(court.echantillon(500).get(0)!.p[0]).toBeGreaterThanOrEqual(19.9);
    long.vider();
    expect(long.echantillon(500).size).toBe(0);
  });

  it("ne modifie pas les données reçues", () => {
    const it = new InterpolateurVehicules();
    const src = [v(0, 1)];
    it.ajouter(0, src);
    it.echantillon(100).get(0)!.p[0] = 999;
    src[0].p[0] = 777;
    expect(it.echantillon(0).get(0)!.p[0]).toBe(1);
  });
});
