import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { EtatDuel, PlatDuel } from "./dilemme-serveur";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import DilemmeDuel from "../app/dilemme/DilemmeDuel";

const plat = (nom: string): PlatDuel => ({ cle: nom, restaurant: "Le Bistrot Trèfle", nom, image: null, nbServices: 2, derniere: "2026-11-05" });

function etat(ouvert: boolean): EtatDuel {
  return {
    jour: "2026-11-11", ouvert,
    dilemme: { a: plat("Croziflette"), b: plat("Pâtes carbo") },
    voix: { a: 3, b: 2 },
    resume: { a: 3, b: 2, total: 5, pctA: 60, pctB: 40, gagnant: "a" },
    votes: [{ votant: "Thomas", choix: "a" }],
    monVote: null,
  };
}

const rendre = (e: EtatDuel) =>
  renderToString(createElement(DilemmeDuel, { etatInitial: e, affichageDuJour: true, precedent: null, suivant: null, aujourdhui: "2026-11-11" }));

describe("DilemmeDuel : rendu serveur", () => {
  it("duel ouvert : ni résultats, ni suspense, ni badge au premier rendu (le votant n'est pas connu)", () => {
    const html = rendre(etat(true));
    expect(html).not.toContain("Voir les résultats sans voter");
    expect(html).not.toContain("60 %");
    expect(html).not.toContain("En tête");
    expect(html).not.toContain("Aucun vote");
    expect(html).toContain("Voter pour ce plat");
  });
  it("duel clos : les résultats restent lisibles sans JavaScript", () => {
    const html = rendre(etat(false));
    expect(html).toContain("60");
    expect(html).toContain("Vainqueur");
  });
});
