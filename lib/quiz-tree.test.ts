import { describe, it, expect } from "vitest";
import { buildQuizTree, resoudreFeuille, type QuizNode, type QuizLeaf } from "./quiz-tree";
import type { PoolPlat } from "./quiz-plats";
import type { Mode } from "./quiz-plats";

const P = (over: Partial<PoolPlat>): PoolPlat => ({
  plat: "Plat",
  restaurant: "Resto",
  prix: "10€",
  ...over,
});

/** Toutes les feuilles atteignables de l'arbre. */
function feuilles(node: QuizNode): QuizLeaf[] {
  if (node.kind === "leaf") return [node];
  return node.options.flatMap((o) => feuilles(o.node));
}

/** Suit un chemin de réponses (index d'option à chaque question) jusqu'à une feuille. */
function suivre(node: QuizNode, indices: number[]): QuizNode {
  let cur = node;
  for (const i of indices) {
    if (cur.kind !== "question") break;
    cur = cur.options[i].node;
  }
  return cur;
}

describe("buildQuizTree", () => {
  it("rend chaque plat atteignable via une feuille singleton", () => {
    const plats = [
      P({ plat: "Poulet rôti" }),
      P({ plat: "Saumon grillé" }),
      P({ plat: "Curry de légumes" }),
    ];
    const tree = buildQuizTree(plats);
    const exactes = feuilles(tree)
      .filter((f) => f.plats.length === 1)
      .map((f) => f.plats[0].plat);
    for (const p of plats) {
      expect(exactes).toContain(p.plat);
    }
  });

  it("départage par nom deux plats du même seau (viande/bœuf)", () => {
    const plats = [
      P({ plat: "Bœuf bourguignon", note: 7 }),
      P({ plat: "Steak frites", note: 5 }),
    ];
    const tree = buildQuizTree(plats);
    // Aucun axe famille/protéine ne sépare : on doit atterrir sur un départage par nom.
    const questionsNom: QuizNode[] = [];
    const walk = (n: QuizNode) => {
      if (n.kind === "question") {
        if (n.axis === "nom") questionsNom.push(n);
        n.options.forEach((o) => walk(o.node));
      }
    };
    walk(tree);
    expect(questionsNom.length).toBeGreaterThan(0);
    const noms = feuilles(tree)
      .filter((f) => f.plats.length === 1)
      .map((f) => f.plats[0].plat);
    expect(noms).toContain("Bœuf bourguignon");
    expect(noms).toContain("Steak frites");
  });

  it("ne propose aucune option morte (chaque option mène à ≥1 plat)", () => {
    const plats = [P({ plat: "Poulet rôti" }), P({ plat: "Saumon grillé" })];
    const tree = buildQuizTree(plats);
    const check = (n: QuizNode) => {
      if (n.kind === "leaf") {
        expect(n.plats.length).toBeGreaterThan(0);
        return;
      }
      for (const o of n.options) {
        expect(feuilles(o.node).flatMap((f) => f.plats).length).toBeGreaterThan(0);
        check(o.node);
      }
    };
    check(tree);
  });

  it("ne propose pas de famille absente (pas de poisson sans plat poisson)", () => {
    const plats = [P({ plat: "Poulet rôti" }), P({ plat: "Bœuf carottes" })];
    const tree = buildQuizTree(plats);
    if (tree.kind === "question" && tree.axis === "famille") {
      const labels = tree.options.map((o) => o.label);
      expect(labels).not.toContain("Du poisson");
    }
  });

  it("déterminisme : un même chemin mène toujours au même plat", () => {
    const plats = [
      P({ plat: "Poulet rôti" }),
      P({ plat: "Saumon grillé" }),
      P({ plat: "Curry de légumes" }),
    ];
    const tree = buildQuizTree(plats);
    const r1 = suivre(tree, [0, 0, 0, 0]);
    const r2 = suivre(tree, [0, 0, 0, 0]);
    expect(r1).toBe(r2);
  });

  it("« Peu importe » résout un plat de façon stable selon le mode", () => {
    const plats = [
      P({ plat: "Poulet rôti", note: 5, note_goulaf: 9 }),
      P({ plat: "Poulet curry", note: 8, note_goulaf: 4 }),
    ];
    // Groupe complet (cas peu importe).
    const f: QuizLeaf = { kind: "leaf", plats };
    expect(resoudreFeuille(f, "sportif" as Mode)?.plat).toBe("Poulet curry");
    expect(resoudreFeuille(f, "goulaf" as Mode)?.plat).toBe("Poulet rôti");
    // Stable sur appels répétés.
    expect(resoudreFeuille(f, "sportif" as Mode)?.plat).toBe("Poulet curry");
  });

  it("feuille singleton renvoie son plat quel que soit le mode", () => {
    const f: QuizLeaf = { kind: "leaf", plats: [P({ plat: "Tarte" })] };
    expect(resoudreFeuille(f, "sportif" as Mode)?.plat).toBe("Tarte");
    expect(resoudreFeuille(f, "goulaf" as Mode)?.plat).toBe("Tarte");
  });
});
