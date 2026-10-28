import { describe, expect, it } from "vitest";
import {
  FRAPPE, creerFrappe, degatsImpactFrappe, degatsVehiculeFrappe,
  meriteFrappe, verifierImpactsFrappe
} from "./frappe-aerienne";

describe("frappe-aerienne", () => {
  it("débloque la frappe exactement à 5 kills d'affilée sans double don", () => {
    expect(meriteFrappe(4, false)).toBe(false);
    expect(meriteFrappe(5, false)).toBe(true);
    expect(meriteFrappe(6, false)).toBe(true);
    // Déjà disponible en stock : pas de double attribution
    expect(meriteFrappe(5, true)).toBe(false);
  });

  it("calcule les dégâts radiaux dégressifs", () => {
    // Plein dégât au centre
    expect(degatsImpactFrappe(0)).toBe(FRAPPE.degatsMax);
    expect(degatsImpactFrappe(FRAPPE.rayonMortelM)).toBe(FRAPPE.degatsMax);

    // À mi-distance
    const dMid = (FRAPPE.rayonMortelM + FRAPPE.rayonZoneM) / 2;
    expect(degatsImpactFrappe(dMid)).toBeCloseTo(FRAPPE.degatsMax / 2, -1);

    // En bordure
    expect(degatsImpactFrappe(FRAPPE.rayonZoneM)).toBe(0);
    // Au-delà
    expect(degatsImpactFrappe(FRAPPE.rayonZoneM + 1)).toBe(0);
  });

  it("calcule les dégâts de carrosserie sur les véhicules", () => {
    expect(degatsVehiculeFrappe(0)).toBe(FRAPPE.degatsVehicule);
    expect(degatsVehiculeFrappe(FRAPPE.rayonZoneM)).toBeGreaterThan(50);
    expect(degatsVehiculeFrappe(FRAPPE.rayonZoneM + 5)).toBe(0);
  });

  it("génère 5 impacts étalés dans le temps et dans la zone", () => {
    const f = creerFrappe("frappe_1", "j1", [30, 0, 40], 10_000, () => 0.5);
    expect(f.impacts).toHaveLength(5);
    expect(f.impacts[0].p).toEqual([30, 0, 40]); // Premier au centre
    expect(f.impacts[0].impactT).toBe(10_000 + FRAPPE.delaiPremierImpactMs);

    // Tous les impacts dans le rayon de la zone
    for (const imp of f.impacts) {
      const dist = Math.hypot(imp.p[0] - 30, imp.p[2] - 40);
      expect(dist).toBeLessThanOrEqual(FRAPPE.rayonZoneM);
    }

    // Chronologie d'impacts
    expect(verifierImpactsFrappe(f, 10_500)).toHaveLength(0);
    const imp1 = verifierImpactsFrappe(f, 11_250);
    expect(imp1).toHaveLength(1);
    expect(imp1[0].id).toBe("frappe_1_0");

    // Les suivants
    const impSuivants = verifierImpactsFrappe(f, 13_500);
    expect(impSuivants).toHaveLength(4);
    // Plus aucun impact en attente
    expect(verifierImpactsFrappe(f, 14_000)).toHaveLength(0);
  });
});
