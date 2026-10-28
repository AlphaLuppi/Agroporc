import { describe, expect, it } from "vitest";
import {
  appliquerPartie, classementStats, cleStats, estPseudoCompte, lireStatsBr, nomDeBase, statsVides,
  type ResultatPartieBr, type StatsBr,
} from "./br-stats";
import type { LigneStatsBr } from "./protocole";

const ligne = (p: Partial<LigneStatsBr> & { pseudo: string }): LigneStatsBr => ({
  cle: cleStats(p.pseudo), top1: 0, parties: 1, kills: 0, meilleurePlace: 5, derniereT: 1, ...p,
});
const statsDe = (...ls: LigneStatsBr[]): StatsBr => ({ version: 1, joueurs: Object.fromEntries(ls.map((l) => [l.cle, l])) });

describe("cleStats", () => {
  it("ignore la casse et garde les accents", () => {
    expect(cleStats("Élodie")).toBe("élodie");
    expect(cleStats("TOTO")).toBe(cleStats("toto"));
  });
  it("réduit les espaces et retire les caractères interdits", () => {
    expect(cleStats("  Jo   hn ")).toBe("jo hn");
    expect(cleStats("<b>Jo</b>")).toBe(cleStats("bJob"));
  });
  it("un pseudo vide retombe sur le défaut", () => {
    expect(cleStats("")).toBe("agent");
  });
});

describe("estPseudoCompte", () => {
  it("Agent et ses doublons suffixés ne comptent pas", () => {
    for (const p of ["Agent", "agent", "AGENT", "Agent2", "agent3", "Agent12", ""]) expect(estPseudoCompte(p)).toBe(false);
  });
  it("un vrai pseudo compte", () => {
    for (const p of ["Toto", "Toto2", "Agentx", "MonAgent", "Agent Smith"]) expect(estPseudoCompte(p)).toBe(true);
  });
});

describe("nomDeBase", () => {
  it("retire les chiffres finaux", () => {
    expect(nomDeBase("Toto2")).toBe("toto");
    expect(nomDeBase("toto")).toBe("toto");
    expect(nomDeBase("Toto12")).toBe("toto");
  });
  it("garde les chiffres internes", () => {
    expect(nomDeBase("a1b")).toBe("a1b");
  });
  it("un nom fait de chiffres reste lui-même", () => {
    expect(nomDeBase("2024")).toBe("2024");
  });
});

describe("appliquerPartie", () => {
  const partie: ResultatPartieBr = { t: 1000, lignes: [{ pseudo: "Alice", place: 1, kills: 3 }, { pseudo: "Bob", place: 2, kills: 1 }] };

  it("crée les fiches : top1 pour la place 1 seulement", () => {
    const s = appliquerPartie(statsVides(), partie);
    expect(s.joueurs.alice).toEqual({ cle: "alice", pseudo: "Alice", top1: 1, parties: 1, kills: 3, meilleurePlace: 1, derniereT: 1000 });
    expect(s.joueurs.bob).toMatchObject({ top1: 0, parties: 1, kills: 1, meilleurePlace: 2 });
  });
  it("cumule, garde la meilleure place et le dernier pseudo affiché", () => {
    const s1 = appliquerPartie(statsVides(), partie);
    const s2 = appliquerPartie(s1, { t: 2000, lignes: [{ pseudo: "ALICE", place: 4, kills: 2 }, { pseudo: "bob", place: 1, kills: 0 }] });
    expect(s2.joueurs.alice).toMatchObject({ pseudo: "ALICE", top1: 1, parties: 2, kills: 5, meilleurePlace: 1, derniereT: 2000 });
    expect(s2.joueurs.bob).toMatchObject({ pseudo: "bob", top1: 1, parties: 2, meilleurePlace: 1 });
  });
  it("est immuable", () => {
    const s1 = appliquerPartie(statsVides(), partie);
    const copie = JSON.parse(JSON.stringify(s1));
    const s2 = appliquerPartie(s1, partie);
    expect(s1).toEqual(copie);
    expect(s2).not.toBe(s1);
    expect(s2.joueurs.alice).not.toBe(s1.joueurs.alice);
    expect(statsVides().joueurs).toEqual({});
  });
  it("n'enregistre pas les pseudos Agent", () => {
    const s = appliquerPartie(statsVides(), { t: 1, lignes: [{ pseudo: "Agent3", place: 1, kills: 9 }, { pseudo: "Zoé", place: 2, kills: 0 }] });
    expect(Object.keys(s.joueurs)).toEqual(["zoé"]);
  });
  it("répare une meilleure place absente (0)", () => {
    const s = appliquerPartie(statsDe(ligne({ pseudo: "Cora", meilleurePlace: 0 })), { t: 5, lignes: [{ pseudo: "Cora", place: 3, kills: 0 }] });
    expect(s.joueurs.cora.meilleurePlace).toBe(3);
  });
});

describe("classementStats", () => {
  it("trie par top1, kills, parties croissant puis pseudo", () => {
    const s = statsDe(
      ligne({ pseudo: "Zed", top1: 2, kills: 5 }),
      ligne({ pseudo: "Ana", top1: 2, kills: 9 }),
      ligne({ pseudo: "Bob", top1: 1, kills: 4, parties: 5 }),
      ligne({ pseudo: "Cyd", top1: 1, kills: 4, parties: 2 }),
      ligne({ pseudo: "Dan", top1: 1, kills: 4, parties: 2 }),
    );
    expect(classementStats(s, 10).map((l) => l.pseudo)).toEqual(["Ana", "Zed", "Cyd", "Dan", "Bob"]);
  });
  it("limite à n et gère n <= 0", () => {
    const s = statsDe(ligne({ pseudo: "A1x" }), ligne({ pseudo: "B1x" }), ligne({ pseudo: "C1x" }));
    expect(classementStats(s, 2)).toHaveLength(2);
    expect(classementStats(s, 0)).toEqual([]);
    expect(classementStats(s, -3)).toEqual([]);
  });
});

describe("lireStatsBr", () => {
  it("rend des stats vides pour tout ce qui n'est pas un objet attendu", () => {
    for (const brut of [null, undefined, 42, "x", [], {}, { joueurs: null }, { joueurs: [] }, { joueurs: "x" }]) {
      expect(lireStatsBr(brut)).toEqual(statsVides());
    }
  });
  it("relit des stats valides à l'identique", () => {
    const s = appliquerPartie(statsVides(), { t: 9, lignes: [{ pseudo: "Alice", place: 1, kills: 2 }] });
    expect(lireStatsBr(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it("répare les nombres abîmés et ignore les entrées illisibles", () => {
    const s = lireStatsBr({
      version: 7,
      joueurs: {
        alice: { cle: "alice", pseudo: "Alice", top1: -3, parties: "4", kills: 2.7, meilleurePlace: null, derniereT: NaN },
        bob: 12,
        carl: null,
        "": { pseudo: "Vide" },
        "  ": { top1: 1 },
        agent2: { pseudo: "Agent2", top1: 9 },
      },
    });
    expect(s.version).toBe(1);
    expect(Object.keys(s.joueurs)).toEqual(["alice", "vide"]);
    expect(s.joueurs.alice).toEqual({ cle: "alice", pseudo: "Alice", top1: 0, parties: 0, kills: 2, meilleurePlace: 0, derniereT: 0 });
  });
  it("recalcule une clé non normalisée depuis le pseudo", () => {
    const s = lireStatsBr({ joueurs: { "Toto ": { pseudo: "Toto", top1: 1, parties: 2 } } });
    expect(s.joueurs.toto).toMatchObject({ cle: "toto", pseudo: "Toto", top1: 1, parties: 2 });
  });
  it("survit à un JSON tronqué une fois parsé par l'appelant", () => {
    let brut: unknown;
    try { brut = JSON.parse('{"version":1,"joueurs":{"a'); } catch { brut = undefined; }
    expect(lireStatsBr(brut)).toEqual(statsVides());
  });
});
