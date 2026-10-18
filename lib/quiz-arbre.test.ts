import { describe, it, expect } from "vitest";
import type { PoolPlat } from "./quiz-plats";
import { platsCompatibles, compterBranche } from "./quiz-arbre";

const p = (plat: string, prix: string, tags: PoolPlat["quiz_tags"]): PoolPlat => ({ plat, restaurant: "R", prix, quiz_tags: tags });

const pool: PoolPlat[] = [
  p("Wok de poulet", "11.90€", { envie: "poulet", cuisine: "asiatique", lourdeur: "copieux" }),
  p("Poulet pesto", "9.40€", { envie: "poulet", cuisine: "mediterraneen", lourdeur: "leger" }),
  p("Saumon tajine", "9.40€", { envie: "poisson", cuisine: "mijote", lourdeur: "leger" }),
];

describe("platsCompatibles", () => {
  it("garde les plats qui cochent tous les critères précisés", () => {
    expect(platsCompatibles(pool, {}).length).toBe(3);
    expect(platsCompatibles(pool, { envie: "poulet", lourdeur: "leger" }).map((x) => x.plat)).toEqual(["Poulet pesto"]);
    expect(platsCompatibles(pool, { budget: "eco" }).map((x) => x.plat)).toEqual(["Poulet pesto", "Saumon tajine"]);
  });
});

describe("compterBranche", () => {
  it("compte les plats au bout de chaque branche, « peu importe » compris", () => {
    const c = { envie: "poulet" as const };
    expect(compterBranche(pool, c, "cuisine", "asiatique")).toBe(1);
    expect(compterBranche(pool, c, "cuisine", "froid")).toBe(0);
    expect(compterBranche(pool, c, "cuisine", undefined)).toBe(2);
    // Changer une réponse déjà donnée remplace le critère au lieu de l'ajouter.
    expect(compterBranche(pool, c, "envie", "poisson")).toBe(1);
  });
});
