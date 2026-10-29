import { describe, expect, it } from "vitest";
import { BR, EQUIPEMENT_DEPART_BR, MAIN_DEPART_BR, REGLES_SANTE_BR, degatsMeleeBr, estClasseMunitions } from "./br-regles";
import { armeDuSlot, slotDeLArme } from "./equipement";
import { JEU, SLOTS, copierEquipement } from "./protocole";
import { reinitialiserSante, regenerer, type Sante } from "./sante";

describe("constantes du Battle Royale", () => {
  it("invariants de lobby, de décompte et de snap", () => {
    expect(BR.joueursMin).toBeGreaterThanOrEqual(2);
    expect(BR.joueursMax).toBe(50);
    expect(BR.decompteMinMs).toBeLessThan(BR.decompteMaxMs);
    expect(BR.decompteMaxMs).toBe(30_000);
    expect(BR.decompteMinMs).toBe(3_000);
    expect(BR.protectionAtterrissageMs).toBe(5_000);
    expect(BR.partieValideMinMs).toBe(60_000);
    expect(BR.atterrisMin).toBe(2);
    expect(BR.snapHz).toBe(10);
    // compensation de latence : l'historique couvre le rejeu maximal
    expect(BR.historiqueMs).toBeGreaterThan(BR.rewindMaxMs);
    // la killcam dure 4 s : un mort reste dans le snap jusque-là au moins
    expect(BR.retraitMortSnapMs).toBeGreaterThanOrEqual(JEU.delaiReapparitionMs);
    // retard d'interpolation d'au moins un intervalle de snap
    expect(BR.interpolationMs).toBeGreaterThan(1000 / BR.snapHz);
    expect(BR.periodeEtatMs).toBeLessThan(BR.periodeEtatJeuMs);
  });

  it("le +50 PV d'un kill tient dans la barre de vie", () => {
    expect(BR.pvKill).toBe(50);
    expect(BR.pvKill).toBeLessThanOrEqual(JEU.pvMax);
  });

  it("soins : le bandage ne dépasse pas 75 PV, la potion remplit le bouclier par 50", () => {
    expect(BR.usage.bandage).toEqual({ ms: 3_000, pv: 20, plafondPv: 75, pile: 5 });
    expect(BR.usage.potion).toEqual({ ms: 4_000, bouclier: 50, pile: 3 });
    expect(BR.usage.bandage.plafondPv).toBeLessThan(JEU.pvMax);
    expect(BR.usage.potion.bouclier).toBeLessThanOrEqual(JEU.bouclierMax);
  });

  it("réserve : départ de 2 chargeurs, plafond de 6", () => {
    expect(BR.reserveChargeursDepart).toBe(2);
    expect(BR.reserveChargeursMax).toBeGreaterThan(BR.reserveChargeursDepart);
  });
});

describe("mêlée du Battle Royale", () => {
  it("couteau en 3 coups, épée en 2 coups, sur 100 PV", () => {
    expect(degatsMeleeBr("couteau")).toBe(34);
    expect(degatsMeleeBr("epee")).toBe(70);
    expect(Math.ceil(JEU.pvMax / degatsMeleeBr("couteau"))).toBe(3);
    expect(Math.ceil(JEU.pvMax / degatsMeleeBr("epee"))).toBe(2);
  });
});

describe("équipement de départ", () => {
  it("aucune arme à feu : seuls l'arme blanche est en main, les trois autres slots sont vides", () => {
    const eq = copierEquipement(EQUIPEMENT_DEPART_BR);
    expect(armeDuSlot(eq, "principale")).toBeNull();
    expect(armeDuSlot(eq, "secondaire")).toBeNull();
    expect(armeDuSlot(eq, "speciale")).toBeNull();
    expect(armeDuSlot(eq, "couteau")).toBe("couteau");
    expect(armeDuSlot(EQUIPEMENT_DEPART_BR, "secondaire")).toBeNull();
    expect(MAIN_DEPART_BR).toBe("couteau");
    expect(SLOTS).toContain(MAIN_DEPART_BR);
  });

  it("les valeurs de remplissage ne sont pas portées (slotDeLArme)", () => {
    const eq = copierEquipement(EQUIPEMENT_DEPART_BR);
    expect(slotDeLArme(eq, "mitraillette")).toBeNull();
    expect(slotDeLArme(eq, "pistolet")).toBeNull();
    expect(slotDeLArme(eq, "couteau")).toBe("couteau");
  });

  it("la copie est modifiable sans toucher la constante figée", () => {
    const eq = copierEquipement(EQUIPEMENT_DEPART_BR);
    expect(eq.sansPrincipale).toBe(true);
    expect(eq.sansSecondaire).toBe(true);
    delete eq.sansSecondaire;
    eq.speciale = "railgun";
    expect(EQUIPEMENT_DEPART_BR.sansSecondaire).toBe(true);
    expect(EQUIPEMENT_DEPART_BR.speciale).toBeNull();
    expect(Object.isFrozen(EQUIPEMENT_DEPART_BR)).toBe(true);
  });
});

describe("santé du Battle Royale", () => {
  it("REGLES_SANTE_BR : 100 PV, délai infini, 0 PV/s", () => {
    expect(REGLES_SANTE_BR).toEqual({ pvMax: 100, delaiMs: Infinity, pvParS: 0 });
  });

  it("`regenerer` ne rend jamais un PV avec ces règles, même longtemps après le dernier dégât", () => {
    const s: Sante = { pv: 40, bouclier: 0, dernierDegatT: 0, regenAcc: 0 };
    reinitialiserSante(s, 0);
    s.pv = 40;
    for (let t = 0; t <= 10 * 60_000; t += 16) expect(regenerer(s, t, 1 / 60, REGLES_SANTE_BR)).toBe(false);
    expect(s.pv).toBe(40);
    // contrôle : sans ces règles, la régénération de l'arène rend bien des PV
    for (let k = 0; k < 6; k++) regenerer(s, 600_000, 1 / 60);
    expect(s.pv).toBeGreaterThan(40);
  });
});

describe("classes de munitions", () => {
  it("estClasseMunitions reconnaît les trois classes seulement", () => {
    for (const c of ["legeres", "moyennes", "cartouches"]) expect(estClasseMunitions(c)).toBe(true);
    for (const c of ["pistolet", "", null, undefined, 3, "Legeres"]) expect(estClasseMunitions(c)).toBe(false);
  });
});
