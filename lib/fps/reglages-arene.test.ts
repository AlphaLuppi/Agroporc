import { describe, expect, it } from "vitest";
import {
  EVENEMENTS_ARENE, EVENEMENTS_EXAMINES_MAX, FREQUENCES, LIBELLES_EVENEMENTS, REGLAGES_DEFAUT, estParDefaut, libelleReglages, normaliserReglages, reglagesEgaux,
} from "./reglages-arene";

describe("réglages d'arène : validation sur liste fermée", () => {
  it("les réglages par défaut : tous les événements, fréquence Normal", () => {
    expect([...REGLAGES_DEFAUT.evenements]).toEqual([...EVENEMENTS_ARENE]);
    expect(REGLAGES_DEFAUT.frequence).toBe("normal");
    expect(estParDefaut(normaliserReglages(undefined))).toBe(true);
  });

  it("un non-objet (null, texte, nombre, tableau) vaut le défaut", () => {
    for (const brut of [undefined, null, "x", 12, true, [], ["elsa"]]) expect(normaliserReglages(brut)).toEqual({ evenements: [...EVENEMENTS_ARENE], frequence: "normal" });
  });

  it("`evenements` absent ou qui n'est pas un tableau : TOUS (anciens clients)", () => {
    expect(normaliserReglages({ frequence: "calme" })).toEqual({ evenements: [...EVENEMENTS_ARENE], frequence: "calme" });
    expect(normaliserReglages({ evenements: "elsa" }).evenements).toEqual([...EVENEMENTS_ARENE]);
    expect(normaliserReglages({ evenements: { elsa: true } }).evenements).toEqual([...EVENEMENTS_ARENE]);
  });

  it("`[]` est valide : aucun événement", () => {
    const r = normaliserReglages({ evenements: [], frequence: "chaos" });
    expect(r.evenements).toEqual([]);
    expect(libelleReglages(r)).toBe("Aucun événement");
  });

  it("garde les identifiants connus, dédoublonnés, dans l'ordre canonique, et ignore le reste", () => {
    const r = normaliserReglages({ evenements: ["police", "elsa", "elsa", "dragon", 7, null, "tigre", { elsa: 1 }, "__proto__"], frequence: "chaos" });
    expect(r.evenements).toEqual(["elsa", "tigre", "police"]);
    expect(r.frequence).toBe("chaos");
  });

  it("une fréquence inconnue (ou d'un autre type) vaut « normal »", () => {
    for (const f of ["enorme", 3, null, undefined, ["calme"]]) expect(normaliserReglages({ evenements: ["bus"], frequence: f }).frequence).toBe("normal");
    for (const f of FREQUENCES) expect(normaliserReglages({ evenements: ["bus"], frequence: f }).frequence).toBe(f);
  });

  it("n'examine que 16 éléments au plus (un client qui en envoie mille n'alourdit pas la validation)", () => {
    const bourrage = Array.from({ length: EVENEMENTS_EXAMINES_MAX }, () => "dragon");
    expect(normaliserReglages({ evenements: [...bourrage, "elsa"] }).evenements).toEqual([]);
    expect(normaliserReglages({ evenements: [...bourrage.slice(1), "elsa"] }).evenements).toEqual(["elsa"]);
  });

  it("ne jette jamais, même sur un objet sans prototype ou avec un `__proto__` hostile", () => {
    expect(() => normaliserReglages(Object.create(null))).not.toThrow();
    expect(normaliserReglages(JSON.parse('{"evenements":["elsa"],"__proto__":{"x":1}}')).evenements).toEqual(["elsa"]);
  });

  it("le résultat ne partage pas son tableau avec le défaut", () => {
    const r = normaliserReglages(undefined);
    expect(r.evenements).not.toBe(REGLAGES_DEFAUT.evenements);
  });
});

describe("réglages d'arène : égalité et libellés", () => {
  it("deux réglages sont égaux s'ils ont les mêmes événements et la même fréquence", () => {
    expect(reglagesEgaux(normaliserReglages({ evenements: ["bus", "elsa"] }), normaliserReglages({ evenements: ["elsa", "bus"] }))).toBe(true);
    expect(reglagesEgaux(normaliserReglages({ evenements: ["bus"] }), normaliserReglages({ evenements: ["bus", "elsa"] }))).toBe(false);
    expect(reglagesEgaux(normaliserReglages({ frequence: "calme" }), REGLAGES_DEFAUT)).toBe(false);
    expect(estParDefaut(normaliserReglages({ frequence: "chaos" }))).toBe(false);
  });

  it("libelleReglages : tous, aucun, et les événements absents ou présents", () => {
    expect(libelleReglages(REGLAGES_DEFAUT)).toBe("Tous les événements · Normal");
    expect(libelleReglages(normaliserReglages({ evenements: ["elsa", "avion", "bus", "truck"], frequence: "calme" }))).toBe("Sans tigre géant, sans police · Calme");
    expect(libelleReglages(normaliserReglages({ evenements: ["elsa", "bus"], frequence: "chaos" }))).toBe("Elsa, Bus C3 · Chaos");
  });

  it("chaque événement a un libellé et une aide en français", () => {
    for (const id of EVENEMENTS_ARENE) {
      expect(LIBELLES_EVENEMENTS[id].nom.length).toBeGreaterThan(2);
      expect(LIBELLES_EVENEMENTS[id].aide.length).toBeGreaterThan(2);
    }
    expect(LIBELLES_EVENEMENTS.police.aide).toBe("Descente de police");
    expect(LIBELLES_EVENEMENTS.avion.aide).toContain("sort d'invocation");
  });
});
