import { describe, expect, it } from "vitest";
import {
  ARMES, ARMES_PRINCIPALES, ARMES_SECONDAIRES, ARMES_SPECIALES, ECHELLE_AVATAR, EQUIPEMENT_DEFAUT, JEU, OEIL_SIEGE, PLAFONDS,
  SILHOUETTE, SILHOUETTE_ACCROUPIE, SLOTS, VERSION_PROTOCOLE, copierEquipement, oeilDe, silhouetteDe,
} from "./protocole";
import { STATS } from "./armes";

describe("armes", () => {
  it("ARMES : 11 armes sans doublon, listes de catégories disjointes", () => {
    expect(ARMES).toHaveLength(11);
    expect(new Set(ARMES).size).toBe(ARMES.length);
    const toutes = [...ARMES_PRINCIPALES, ...ARMES_SECONDAIRES, ...ARMES_SPECIALES];
    expect(new Set(toutes).size).toBe(toutes.length);
    expect([...ARMES].sort()).toEqual([...toutes].sort());
    expect(ARMES).not.toContain("couteau");
  });

  it("chaque arme a une entrée dans STATS", () => {
    for (const id of ARMES) expect(STATS[id]).toBeDefined();
  });

  it("les slots sont principale, secondaire, couteau, spéciale", () => {
    expect([...SLOTS].sort()).toEqual(["couteau", "principale", "secondaire", "speciale"]);
  });
});

describe("équipement par défaut", () => {
  it("est valide : principale, secondaire (pistolet pour la compatibilité v1), pas de spéciale", () => {
    expect(ARMES_PRINCIPALES).toContain(EQUIPEMENT_DEFAUT.principale);
    expect(ARMES_SECONDAIRES).toContain(EQUIPEMENT_DEFAUT.secondaire);
    expect(EQUIPEMENT_DEFAUT.secondaire).toBe("pistolet");
    expect(EQUIPEMENT_DEFAUT.speciale).toBeNull();
  });

  it("est figé, et copierEquipement renvoie une copie indépendante", () => {
    expect(Object.isFrozen(EQUIPEMENT_DEFAUT)).toBe(true);
    const copie = copierEquipement(EQUIPEMENT_DEFAUT);
    expect(Object.isFrozen(copie)).toBe(false);
    expect(copie).toEqual(EQUIPEMENT_DEFAUT);
    copie.speciale = "railgun";
    copie.principale = "sniper";
    expect(EQUIPEMENT_DEFAUT.speciale).toBeNull();
    expect(EQUIPEMENT_DEFAUT.principale).toBe("mitraillette");
    const autre = copierEquipement(EQUIPEMENT_DEFAUT);
    expect(autre.speciale).toBeNull();
    expect(autre).not.toBe(copie);
  });
});

describe("silhouette", () => {
  it("silhouetteDe choisit la silhouette debout ou accroupie", () => {
    expect(silhouetteDe(false)).toBe(SILHOUETTE);
    expect(silhouetteDe(undefined)).toBe(SILHOUETTE);
    expect(silhouetteDe(true)).toBe(SILHOUETTE_ACCROUPIE);
  });

  it("oeilDe : debout 1,95 ; accroupi 1,30 ; assis OEIL_SIEGE (1,30)", () => {
    expect(oeilDe({})).toBe(1.95);
    expect(oeilDe({ accroupi: false })).toBe(1.95);
    expect(oeilDe({ accroupi: true })).toBe(1.3);
    expect(oeilDe({ vehicule: { id: 0, siege: 0 } })).toBe(OEIL_SIEGE);
    expect(oeilDe({ accroupi: true, vehicule: { id: 0, siege: 1 } })).toBe(OEIL_SIEGE);
    expect(OEIL_SIEGE).toBe(1.3);
  });

  it("le rayon du corps reste sous 0,5 m ; le cylindre de collision ne grossit pas", () => {
    expect(SILHOUETTE.corps.rayon).toBeLessThan(0.5);
    expect(SILHOUETTE_ACCROUPIE.corps.rayon).toBeLessThan(0.5);
    expect(SILHOUETTE.rayon).toBe(0.4);
    expect(SILHOUETTE.hauteur).toBe(1.8);
    expect(SILHOUETTE_ACCROUPIE.rayon).toBe(0.4);
  });

  it("la boule englobante couvre les pieds et le haut de la tête, debout et accroupi", () => {
    for (const s of [SILHOUETTE, SILHOUETTE_ACCROUPIE]) {
      const hautTete = s.tete.y + s.tete.rayon;
      expect(s.rayonEnglobant).toBeGreaterThanOrEqual(hautTete - s.centreY);
      expect(s.rayonEnglobant).toBeGreaterThanOrEqual(s.centreY - (s.corps.y0 - s.corps.rayon));
      // les extrémités horizontales du corps y tiennent aussi
      expect(s.rayonEnglobant).toBeGreaterThanOrEqual(Math.hypot(s.corps.rayon, s.corps.y1 - s.centreY));
    }
  });

  it("la tête agrandie reste au-dessus de l'œil du joueur à ECHELLE_AVATAR", () => {
    expect(ECHELLE_AVATAR).toBe(1.25);
    expect(SILHOUETTE.tete.y).toBeGreaterThan(SILHOUETTE.oeil);
    expect(SILHOUETTE_ACCROUPIE.oeil).toBeLessThan(SILHOUETTE.oeil);
  });
});

describe("constantes", () => {
  it("version 4 du protocole", () => {
    expect(VERSION_PROTOCOLE).toBe(4);
  });

  it("chaîne de plafonds de vitesse : sprint couteau ≤ plafond horizontal ≤ plafond déclaré", () => {
    expect(PLAFONDS.vitesseHorizontaleMax).toBeLessThan(PLAFONDS.vitesseDeclareeMax + 1e-9);
    expect(PLAFONDS.vitesseDeclareeMax).toBeLessThan(PLAFONDS.vitesseVehiculeMax);
    expect(12.5 * 1.3).toBeLessThanOrEqual(PLAFONDS.vitesseHorizontaleMax);
  });

  it("JEU : réapparition 4 s (2,5 s de rejeu + 1,5 s de carte), bouclier et régénération", () => {
    expect(JEU.delaiReapparitionMs).toBe(4000);
    expect(JEU.bouclierMax).toBe(100);
    expect(JEU.regenDelaiMs).toBe(5000);
    expect(JEU.regenPvParS).toBe(20);
    expect(JEU.degainageMs).toBe(350);
    expect(JEU.memoSanteMs).toBe(60_000);
    expect(JEU.etatPassagerHz).toBeLessThan(JEU.etatHz);
    expect(JEU.protectionMs).toBeLessThan(JEU.delaiReapparitionMs);
  });
});
