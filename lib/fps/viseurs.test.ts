import { describe, expect, it } from "vitest";
import { ARMES_PRINCIPALES, ARMES_SECONDAIRES } from "./protocole";
import { niveauxZoom, statsTir, viseurLunette } from "./armes";
import {
  ARMES_A_VISEUR, CLE_VISEURS, VISEURS, avecChoix, avecViseur, champLunette, ecrireViseurs, grossissement, lireViseurs, normaliserViseurs,
  parametresVisee, viseurChoisi, viseursDisponibles,
} from "./viseurs";

function stockageMemoire(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}

describe("viseurs disponibles par arme", () => {
  it("« aucun » est toujours proposé en premier quand l'arme a un choix", () => {
    for (const a of ARMES_A_VISEUR) expect(viseursDisponibles(a)[0]).toBe("aucun");
  });
  it("chaque arme d'équipement de l'arène a un choix, sauf le sniper qui garde sa lunette", () => {
    for (const a of [...ARMES_PRINCIPALES, ...ARMES_SECONDAIRES]) {
      if (a === "sniper") expect(viseursDisponibles(a)).toEqual([]);
      else expect(viseursDisponibles(a).length).toBeGreaterThan(1);
    }
  });
  it("armes spéciales, uniques et armes des zombies : aucun choix", () => {
    for (const a of ["railgun", "minigun", "magnum_dore", "lance_grenades", "bazooka", "fumigene", "baguette", "perforeuse"] as const) {
      expect(viseursDisponibles(a)).toEqual([]);
    }
  });
  it("la lunette ×4 est réservée au fusil d'assaut", () => {
    expect(ARMES_A_VISEUR.filter((a) => viseursDisponibles(a).includes("lunette_x4"))).toEqual(["fusil_assaut"]);
  });
  it("une arme de poing ne reçoit pas de lunette", () => {
    for (const a of ["pistolet", "revolver", "mini_uzi"] as const) {
      expect(viseursDisponibles(a).some((v) => grossissement(v) > 0)).toBe(false);
    }
  });
});

describe("paramètres de visée", () => {
  it("le champ d'une lunette ×k suit 2·atan(1/k) : même formule que les niveaux du sniper", () => {
    expect(champLunette(2)).toBeCloseTo(53.13, 2);
    expect(champLunette(4)).toBeCloseTo(28.07, 2);
    expect(champLunette(3)).toBeCloseTo(niveauxZoom("sniper")[0], 1);
  });
  it("point rouge et holo : viseur optique sans niveau de zoom ; lunette : un seul niveau", () => {
    expect(parametresVisee("mitraillette", "point_rouge")).toEqual({ viseur: "point_rouge", zooms: [], zoomDefaut: 0 });
    expect(parametresVisee("mitraillette", "holo")?.viseur).toBe("holo");
    const l = parametresVisee("fusil_assaut", "lunette_x4");
    expect(l?.viseur).toBe("lunette");
    expect(l?.zooms).toEqual([champLunette(4)]);
    expect(l?.zoomDefaut).toBe(0);
  });
  it("« aucun » et un viseur interdit pour l'arme ne donnent rien", () => {
    expect(parametresVisee("pistolet", "aucun")).toBeNull();
    expect(parametresVisee("pistolet", "lunette_x2")).toBeNull();
    expect(parametresVisee("sniper", "point_rouge")).toBeNull();
  });
  it("avecViseur remplace viseur et zooms, laisse cadence et automatique, et rend le même objet sans choix", () => {
    const st = statsTir("fusil_assaut");
    expect(avecViseur(st, "fusil_assaut", undefined)).toBe(st);
    expect(avecViseur(st, "fusil_assaut", "aucun")).toBe(st);
    const l = avecViseur(st, "fusil_assaut", "lunette_x2");
    expect(viseurLunette(l.viseur)).toBe(true);
    expect(l.zooms).toEqual([champLunette(2)]);
    expect(l.cadenceS).toBe(st.cadenceS);
    expect(l.auto).toBe(st.auto);
    expect(avecViseur(st, "fusil_assaut", "holo").viseur).toBe("holo");
  });
  it("le sniper garde sa lunette à trois niveaux quoi qu'on lui demande", () => {
    const st = statsTir("sniper");
    expect(avecViseur(st, "sniper", "point_rouge")).toBe(st);
    expect(st.zooms.length).toBe(3);
    expect(viseurLunette(st.viseur)).toBe(true);
  });
  it("une arme sans viseur choisi garde la mire métallique", () => {
    expect(statsTir("mitraillette").viseur).toBe("fer");
    expect(viseurChoisi({}, "mitraillette")).toBe("aucun");
  });
});

describe("normalisation et mémorisation", () => {
  it("ne garde que les armes à viseur et les viseurs permis, ne jette jamais", () => {
    expect(normaliserViseurs(null)).toEqual({});
    expect(normaliserViseurs([])).toEqual({});
    expect(normaliserViseurs("x")).toEqual({});
    expect(normaliserViseurs({ pistolet: "lunette_x4", sniper: "holo", fusil_assaut: "lunette_x4", mitraillette: "aucun", pompe: 3, inconnue: "holo" }))
      .toEqual({ fusil_assaut: "lunette_x4" });
  });
  it("viseurChoisi rejette un choix devenu interdit", () => {
    expect(viseurChoisi({ pistolet: "lunette_x4" }, "pistolet")).toBe("aucun");
    expect(viseurChoisi({ pompe: "holo" }, "pompe")).toBe("holo");
    expect(viseurChoisi(null, "pompe")).toBe("aucun");
  });
  it("aller-retour dans le stockage, JSON abîmé et stockage absent", () => {
    const s = stockageMemoire();
    expect(ecrireViseurs({ mitraillette: "lunette_x2", pistolet: "point_rouge" }, s)).toBe(true);
    expect(lireViseurs(s)).toEqual({ mitraillette: "lunette_x2", pistolet: "point_rouge" });
    expect(lireViseurs(stockageMemoire({ [CLE_VISEURS]: "{pas du json" }))).toEqual({});
    expect(lireViseurs(null)).toEqual({});
    expect(ecrireViseurs({}, null)).toBe(false);
  });
  it("avecChoix pose, remplace et retire sans toucher l'original", () => {
    const base = Object.freeze({ pompe: "holo" as const });
    const a = avecChoix(base, "pompe", "point_rouge");
    expect(a).toEqual({ pompe: "point_rouge" });
    expect(avecChoix(a, "pompe", "aucun")).toEqual({});
    expect(avecChoix(base, "pistolet", "lunette_x2")).toEqual({ pompe: "holo" });
    expect(base).toEqual({ pompe: "holo" });
  });
  it("les cinq viseurs sont connus de la liste", () => {
    expect([...VISEURS]).toEqual(["aucun", "point_rouge", "holo", "lunette_x2", "lunette_x4"]);
  });
});
