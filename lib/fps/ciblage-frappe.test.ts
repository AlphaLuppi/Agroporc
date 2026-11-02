import { describe, expect, it } from "vitest";
import {
  CIBLAGE_M_PAR_PX, KILLS_PAR_FRAPPE, bornerCiblage, decisionToucheFrappe, demarrerCiblage, deplacerCiblage, killsAvantFrappe, texteFrappe,
  type ZoneCiblage,
} from "./ciblage-frappe";

const zone: ZoneCiblage = { x0: -300, z0: -200, x1: 300, z1: 200 };

describe("ciblage de la frappe aérienne (souris prise)", () => {
  it("le réticule démarre sous le joueur, borné à la zone de la carte", () => {
    expect(demarrerCiblage(zone, [12, 0, -40])).toEqual({ x: 12, z: -40 });
    expect(demarrerCiblage(zone, [999, 0, -999])).toEqual({ x: 300, z: -200 });
  });

  it("la souris le déplace : droite = +x, bas = +z (nord en haut), à CIBLAGE_M_PAR_PX mètres par pixel", () => {
    const c = deplacerCiblage({ x: 0, z: 0 }, 100, -50, zone);
    expect(c.x).toBeCloseTo(100 * CIBLAGE_M_PAR_PX, 6);
    expect(c.z).toBeCloseTo(-50 * CIBLAGE_M_PAR_PX, 6);
  });

  it("il ne sort jamais de la zone, quelle que soit la rafale de souris", () => {
    let c = { x: 290, z: 190 };
    for (let i = 0; i < 50; i++) c = deplacerCiblage(c, 250, 250, zone);
    expect(c).toEqual({ x: 300, z: 200 });
    c = deplacerCiblage(c, -1e9, -1e9, zone);
    expect(c).toEqual({ x: -300, z: -200 });
  });

  it("des valeurs absurdes (NaN, Infinity) ne corrompent pas le réticule", () => {
    expect(deplacerCiblage({ x: 5, z: 6 }, NaN, NaN, zone)).toEqual({ x: 5, z: 6 });
    // une coordonnée non finie retombe au centre de la zone
    expect(bornerCiblage({ x: NaN, z: Infinity }, zone)).toEqual({ x: 0, z: 0 });
    expect(Number.isFinite(deplacerCiblage({ x: 0, z: 0 }, Infinity, 0, zone).x)).toBe(true);
  });
});

describe("touche de frappe (K) : toujours une réponse", () => {
  const etat = { dispo: true, ciblageOuvert: false, peutAgir: true };
  it("ouvre le ciblage quand une frappe est en poche", () => {
    expect(decisionToucheFrappe(etat)).toBe("ouvrir");
  });
  it("la même touche referme un ciblage ouvert, même si le joueur ne peut plus agir", () => {
    expect(decisionToucheFrappe({ ...etat, ciblageOuvert: true })).toBe("annuler");
    expect(decisionToucheFrappe({ ...etat, ciblageOuvert: true, peutAgir: false })).toBe("annuler");
  });
  it("sans frappe en poche : « indisponible » (le jeu le dit au lieu de se taire)", () => {
    expect(decisionToucheFrappe({ ...etat, dispo: false })).toBe("indisponible");
  });
  it("frappe en poche mais mort, en killcam ou au volant : « impossible », rien ne s'ouvre", () => {
    expect(decisionToucheFrappe({ ...etat, peutAgir: false })).toBe("impossible");
  });
});

describe("HUD de la frappe", () => {
  it("compte les kills qui manquent, par paliers de 5", () => {
    expect(KILLS_PAR_FRAPPE).toBe(5);
    expect(killsAvantFrappe(0)).toBe(5);
    expect(killsAvantFrappe(3)).toBe(2);
    expect(killsAvantFrappe(4)).toBe(1);
    expect(killsAvantFrappe(5)).toBe(5); // la frappe vient d'être gagnée : la suivante est à 5 kills de plus
    expect(killsAvantFrappe(7)).toBe(3);
    expect(killsAvantFrappe(-2)).toBe(5);
    expect(killsAvantFrappe(NaN)).toBe(5);
  });

  it("dit la touche quand la frappe est prête et ce qui manque sinon", () => {
    expect(texteFrappe(true, 5, "K")).toBe("FRAPPE AÉRIENNE PRÊTE : [K]");
    expect(texteFrappe(true, 5, "")).toContain("touche non assignée");
    expect(texteFrappe(false, 3, "K")).toBe("Frappe aérienne : encore 2 kills d'affilée");
    expect(texteFrappe(false, 4, "K")).toBe("Frappe aérienne : encore 1 kill d'affilée");
  });
});
