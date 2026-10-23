import { describe, expect, it } from "vitest";
import {
  COLONNES_COMPACTES, COLONNES_TOUTES, MINIMUMS_RECORDS, POINT_DE_MATCH_KILLS, SEUILS_COLONNES, TIRET, VOIES_RAIL,
  bilanJoueur, colonnesVisibles, construireLignes, distinctions, distinctionsGagnees, estLeader, formaterNombre, hauteurMarche, ordinal,
  palmares, phraseSituation, pointDeMatch, positionsRail, pourcentageTetes, podium, precision, qualitePing, rangs, ratioKD,
  raisonFinMatch, texteArmeFav, texteDegats, textePresence, titreVainqueur, trierLignes, type LigneScore,
} from "./classement";
import type { JoueurPublic, LigneClassement, LigneStats } from "./protocole";

const NBSP = " ";

const ligne = (id: string, kills: number, morts: number, plus: Partial<LigneScore> = {}): LigneScore => ({
  id, pseudo: id, couleur: "#9be9ff", kills, morts, ping: 40, serie: 0, serieMax: 0, vivant: true, vehicule: false, ...plus,
});
const joueur = (id: string, kills: number, morts: number, plus: Partial<JoueurPublic> = {}): JoueurPublic => ({
  id, pseudo: id, couleur: "#ffb35c", enJeu: true, kills, morts, ping: 30, ...plus,
});
const stat = (id: string, plus: Partial<LigneStats> = {}): LigneStats => ({
  id, serie: 0, serieMax: 0, tirs: 0, touches: 0, tetes: 0, degats: 0, armeFav: null, vivant: true, vehicule: false, ...plus,
});

describe("constantes de la spec HUD §8", () => {
  it("colonnes, seuils, minimums", () => {
    expect(COLONNES_TOUTES).toHaveLength(11);
    expect(SEUILS_COLONNES).toEqual({ toutes: 1100, repli1: 800 });
    expect(MINIMUMS_RECORDS).toEqual({ tirs: 10, touches: 5 });
    expect(POINT_DE_MATCH_KILLS).toBe(3);
  });
});

describe("trierLignes / rangs", () => {
  it("K décroissant, puis M croissant, puis dégâts décroissants, puis pseudo", () => {
    const l = [
      ligne("zoe", 10, 5, { degats: 100 }),
      ligne("lea", 12, 9),
      ligne("max", 10, 5, { degats: 300 }),
      ligne("ana", 10, 5, { degats: 100 }),
      ligne("tom", 10, 3),
    ];
    expect(trierLignes(l).map((x) => x.id)).toEqual(["lea", "tom", "max", "ana", "zoe"]);
  });

  it("ne modifie pas son entrée", () => {
    const l = [ligne("b", 1, 0), ligne("a", 5, 0)];
    trierLignes(l);
    expect(l.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("le pseudo suit l'ordre alphabétique français (accents)", () => {
    expect(trierLignes([ligne("Zoé", 1, 0), ligne("Éva", 1, 0), ligne("Ana", 1, 0)]).map((x) => x.id)).toEqual(["Ana", "Éva", "Zoé"]);
  });

  it("rang ex aequo : mêmes K et M donnent le même rang, le suivant saute (1, 2, 2, 4)", () => {
    const l = trierLignes([ligne("a", 9, 3), ligne("b", 7, 4), ligne("c", 7, 4), ligne("d", 7, 5)]);
    expect(rangs(l)).toEqual([1, 2, 2, 4]);
  });

  it("mêmes kills mais morts différentes : rangs distincts", () => {
    expect(rangs(trierLignes([ligne("a", 7, 3), ligne("b", 7, 4)]))).toEqual([1, 2]);
  });

  it("rangs d'une liste vide", () => {
    expect(rangs([])).toEqual([]);
  });

  it("leader : rang 1 avec au moins un kill", () => {
    expect(estLeader(ligne("a", 3, 0), 1)).toBe(true);
    expect(estLeader(ligne("a", 0, 0), 1)).toBe(false);
    expect(estLeader(ligne("a", 3, 0), 2)).toBe(false);
  });
});

describe("construireLignes", () => {
  it("phase 1 : sans stats, les cellules de stats restent indéfinies et les joueurs hors jeu sont écartés", () => {
    const l = construireLignes(
      [joueur("a", 5, 1, { serie: 3 }), joueur("b", 7, 2), joueur("spec", 0, 0, { enJeu: false })],
      new Map(), null,
    );
    expect(l.map((x) => x.id)).toEqual(["b", "a"]);
    expect(l[1].serie).toBe(3);
    expect(l[0].tirs).toBeUndefined();
    expect(precision(l[0])).toBe(TIRET);
    expect(texteDegats(l[0])).toBe(TIRET);
    expect(l[0].vivant).toBe(true);
  });

  it("phase 2 : fusionne les stats du message `scores` ; K, M, série et ping viennent de la présence", () => {
    const stats = new Map([["a", stat("a", { serie: 1, serieMax: 4, tirs: 20, touches: 10, tetes: 2, degats: 1640, armeFav: "fusil_assaut", vivant: false, vehicule: true })]]);
    const [a] = construireLignes([joueur("a", 12, 8, { serie: 2, ping: 41 })], stats, null);
    expect(a).toMatchObject({ kills: 12, morts: 8, ping: 41, serie: 2, serieMax: 4, tirs: 20, touches: 10, tetes: 2, degats: 1640, armeFav: "fusil_assaut", vivant: false, vehicule: true });
  });

  it("la série max ne peut pas être inférieure à la série en cours", () => {
    const [a] = construireLignes([joueur("a", 3, 0, { serie: 3 })], new Map([["a", stat("a", { serieMax: 1 })]]), null);
    expect(a.serieMax).toBe(3);
  });

  it("entracte : prend le classement (même un joueur parti), le ping de la présence quand il est encore là", () => {
    const classement: LigneClassement[] = [
      { id: "a", pseudo: "Lea", couleur: "#111111", kills: 30, morts: 7, serieMax: 5, tirs: 100, touches: 40, tetes: 10, degats: 2310, armeFav: "fusil_assaut" },
      { id: "parti", pseudo: "Zoe", couleur: "#222222", kills: 20, morts: 9 },
    ];
    const l = construireLignes([joueur("a", 0, 0, { ping: 55 })], new Map(), classement);
    expect(l.map((x) => x.pseudo)).toEqual(["Lea", "Zoe"]);
    expect(l[0]).toMatchObject({ kills: 30, ping: 55, serieMax: 5, tirs: 100, armeFav: "fusil_assaut", vivant: true });
    expect(l[1]).toMatchObject({ kills: 20, ping: 0 });
    expect(l[1].tirs).toBeUndefined();
  });

  it("entracte : les champs étendus du classement l'emportent, sinon les derniers `scores` connus", () => {
    const stats = new Map([["a", stat("a", { tirs: 50, touches: 25, degats: 900 })]]);
    const [a] = construireLignes([], stats, [{ id: "a", pseudo: "A", couleur: "#000000", kills: 1, morts: 0, tirs: 60 }]);
    expect(a.tirs).toBe(60);
    expect(a.touches).toBe(25);
    expect(a.degats).toBe(900);
  });
});

describe("colonnesVisibles", () => {
  it("toutes les colonnes à 1100 px et plus", () => {
    expect(colonnesVisibles(1100)).toEqual(COLONNES_TOUTES);
    expect(colonnesVisibles(1920)).toEqual(COLONNES_TOUTES);
  });
  it("repli 1 de 800 à 1099 px : sans TÊTE, DÉG, ARME", () => {
    for (const w of [800, 1099]) expect(colonnesVisibles(w)).toEqual(["rang", "agent", "k", "m", "kd", "ser", "prec", "ping"]);
  });
  it("repli 2 sous 800 px", () => {
    expect(colonnesVisibles(799)).toEqual(["rang", "agent", "k", "m", "kd", "ping"]);
    expect(colonnesVisibles(0)).toEqual(["rang", "agent", "k", "m", "kd", "ping"]);
  });
  it("le rang, l'agent, K, M, K/D et le ping ne se replient jamais", () => {
    for (const w of [0, 799, 800, 1099, 1100]) {
      for (const c of ["rang", "agent", "k", "m", "kd", "ping"] as const) expect(colonnesVisibles(w)).toContain(c);
    }
    expect(COLONNES_COMPACTES).toEqual(["rang", "agent", "k", "m", "kd"]);
  });
});

describe("cellules", () => {
  it("K/D : 1 décimale avec virgule, aucune division par zéro", () => {
    expect(ratioKD(ligne("a", 18, 7))).toBe("2,6");
    expect(ratioKD(ligne("a", 5, 0))).toBe("5,0");
    expect(ratioKD(ligne("a", 0, 0))).toBe("0,0");
    expect(ratioKD(ligne("a", 12, 8))).toBe("1,5");
  });

  it("précision : « — » sans tir ou sans stats, sinon un pourcentage avec espace insécable", () => {
    expect(precision(ligne("a", 0, 0))).toBe(TIRET);
    expect(precision(ligne("a", 0, 0, { tirs: 0, touches: 0 }))).toBe(TIRET);
    expect(precision(ligne("a", 0, 0, { tirs: 50, touches: 22 }))).toBe(`44${NBSP}%`);
    expect(precision(ligne("a", 0, 0, { tirs: 3, touches: 3 }))).toBe(`100${NBSP}%`);
  });

  it("têtes : part des touches", () => {
    expect(pourcentageTetes(ligne("a", 0, 0, { touches: 0, tetes: 0 }))).toBe(TIRET);
    expect(pourcentageTetes(ligne("a", 0, 0))).toBe(TIRET);
    expect(pourcentageTetes(ligne("a", 0, 0, { touches: 50, tetes: 9 }))).toBe(`18${NBSP}%`);
  });

  it("dégâts et arme favorite", () => {
    expect(texteDegats(ligne("a", 0, 0, { degats: 0 }))).toBe("0");
    expect(texteDegats(ligne("a", 0, 0, { degats: 1640 }))).toBe(formaterNombre(1640));
    expect(texteArmeFav(ligne("a", 0, 0, { armeFav: "fusil_assaut" }))).toBe("Fusil");
    expect(texteArmeFav(ligne("a", 0, 0, { armeFav: "fusil_assaut" }), false)).toBe("Fusil d'assaut");
    expect(texteArmeFav(ligne("a", 0, 0, { armeFav: "couteau" }))).toBe("Couteau");
    expect(texteArmeFav(ligne("a", 0, 0, { armeFav: null }))).toBe(TIRET);
    expect(texteArmeFav(ligne("a", 0, 0))).toBe(TIRET);
  });

  it("ping : bon sous 60, moyen sous 120, mauvais ensuite", () => {
    expect(qualitePing(59)).toBe("bon");
    expect(qualitePing(60)).toBe("moyen");
    expect(qualitePing(119)).toBe("moyen");
    expect(qualitePing(120)).toBe("mauvais");
  });

  it("présence : joueurs en jeu et spectateurs", () => {
    expect(textePresence([{ enJeu: true }, { enJeu: true }])).toBe("2 en jeu");
    expect(textePresence([{ enJeu: true }, { enJeu: false }])).toBe("1 en jeu + 1 spectateur");
    expect(textePresence([{ enJeu: true }, { enJeu: false }, { enJeu: false }])).toBe("1 en jeu + 2 spectateurs");
  });

  it("ordinaux", () => {
    expect([1, 2, 3, 4, 10].map(ordinal)).toEqual(["1er", "2e", "3e", "4e", "10e"]);
  });
});

describe("phraseSituation", () => {
  const l = trierLignes([ligne("lea", 18, 7), ligne("zoe", 15, 9), ligne("max", 13, 10), ligne("moi", 12, 8)]);

  it("« à 6 kills du leader »", () => {
    expect(phraseSituation(l, "moi")).toBe("Vous êtes 4e, à 6 kills du leader");
  });
  it("singulier à 1 kill", () => {
    expect(phraseSituation(trierLignes([ligne("lea", 10, 0), ligne("moi", 9, 0)]), "moi")).toBe("Vous êtes 2e, à 1 kill du leader");
  });
  it("« vous menez de 3 kills »", () => {
    expect(phraseSituation(trierLignes([ligne("moi", 12, 0), ligne("zoe", 9, 0)]), "moi")).toBe("Vous menez de 3 kills");
    expect(phraseSituation(trierLignes([ligne("moi", 10, 0), ligne("zoe", 9, 0)]), "moi")).toBe("Vous menez de 1 kill");
  });
  it("égalité en tête, égalité de kills avec le leader, joueur seul", () => {
    expect(phraseSituation(trierLignes([ligne("moi", 5, 2), ligne("zoe", 5, 2)]), "moi")).toBe("Vous êtes à égalité en tête");
    expect(phraseSituation(trierLignes([ligne("zoe", 5, 1), ligne("moi", 5, 2)]), "moi")).toBe("Vous êtes 2e, à égalité de kills avec le leader");
    expect(phraseSituation(trierLignes([ligne("moi", 5, 2), ligne("zoe", 5, 1)]), "zoe")).toBe("Vous menez, avec moins de morts");
    expect(phraseSituation([ligne("moi", 0, 0)], "moi")).toBe("Vous êtes seul en jeu");
  });
  it("vide si je ne suis pas dans le tableau", () => {
    expect(phraseSituation(l, "inconnu")).toBe("");
    expect(phraseSituation(l, null)).toBe("");
    expect(phraseSituation([], "moi")).toBe("");
  });
});

describe("pointDeMatch", () => {
  it("vrai à 3 kills de l'objectif ou moins, faux au-delà", () => {
    expect(pointDeMatch([{ kills: 26 }, { kills: 5 }], 30)).toBe(false);
    expect(pointDeMatch([{ kills: 27 }, { kills: 5 }], 30)).toBe(true);
    expect(pointDeMatch([{ kills: 29 }], 30)).toBe(true);
  });
  it("jamais au départ, ni sans objectif", () => {
    expect(pointDeMatch([{ kills: 0 }], 3)).toBe(false);
    expect(pointDeMatch([], 30)).toBe(false);
    expect(pointDeMatch([{ kills: 5 }], 0)).toBe(false);
  });
});

describe("positionsRail", () => {
  it("positions 0..1 proportionnelles aux kills, bornées", () => {
    const p = positionsRail([ligne("a", 0, 0), ligne("b", 15, 0), ligne("c", 30, 0), ligne("d", 45, 0)], 30);
    expect(p.map((x) => x.position)).toEqual([0, 0.5, 1, 1]);
    expect(p.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("objectif nul : tout le monde au départ", () => {
    expect(positionsRail([ligne("a", 5, 0)], 0)[0].position).toBe(0);
  });
  it("des jetons au même endroit se répartissent sur des voies différentes", () => {
    const p = positionsRail([ligne("a", 0, 0), ligne("b", 0, 0), ligne("c", 0, 0), ligne("d", 15, 0)], 30);
    expect(new Set(p.slice(0, 3).map((x) => x.voie)).size).toBe(3);
    expect(p[3].voie).toBe(0);
  });
  it("jamais plus de voies que prévu", () => {
    const p = positionsRail(Array.from({ length: 16 }, (_, i) => ligne(`j${i}`, 0, 0)), 30);
    expect(Math.max(...p.map((x) => x.voie))).toBe(VOIES_RAIL - 1);
  });
});

describe("palmares et distinctions", () => {
  const l = [
    ligne("lea", 30, 7, { serieMax: 5, tirs: 100, touches: 41, tetes: 9 }),
    ligne("zoe", 24, 9, { serieMax: 3, tirs: 50, touches: 26, tetes: 3 }),
    ligne("max", 19, 10, { serieMax: 4, tirs: 80, touches: 29, tetes: 9 }),
  ];

  it("meilleure série, meilleure précision, plus de têtes en proportion", () => {
    const p = palmares(l);
    expect(p.serie).toEqual({ id: "lea", valeur: 5 });
    expect(p.precision?.id).toBe("zoe");
    expect(p.precision?.valeur).toBeCloseTo(0.52, 5);
    expect(p.tetes?.id).toBe("max");
    expect(p.tetes?.valeur).toBeCloseTo(9 / 29, 5);
  });

  it("précision : minimum 10 tirs", () => {
    const p = palmares([ligne("a", 1, 0, { tirs: 9, touches: 9 }), ligne("b", 1, 0, { tirs: 10, touches: 4 })]);
    expect(p.precision).toEqual({ id: "b", valeur: 0.4 });
    expect(palmares([ligne("a", 1, 0, { tirs: 9, touches: 9 })]).precision).toBeNull();
  });

  it("têtes : minimum 5 touches", () => {
    const p = palmares([ligne("a", 1, 0, { touches: 4, tetes: 4 }), ligne("b", 1, 0, { touches: 5, tetes: 1 })]);
    expect(p.tetes).toEqual({ id: "b", valeur: 0.2 });
    expect(palmares([ligne("a", 1, 0, { touches: 4, tetes: 4 })]).tetes).toBeNull();
  });

  it("une valeur nulle n'est jamais un record ; sans stats, aucun record de précision", () => {
    const p = palmares([ligne("a", 0, 0), ligne("b", 0, 0, { tirs: 40, touches: 0, tetes: 0 })]);
    expect(p).toEqual({ serie: null, precision: null, tetes: null });
  });

  it("à égalité, la ligne la mieux classée l'emporte", () => {
    const p = palmares([ligne("a", 5, 0, { serieMax: 3 }), ligne("b", 4, 0, { serieMax: 3 })]);
    expect(p.serie?.id).toBe("a");
  });

  it("distinctions : trois entrées, lauréat et valeur formatée", () => {
    const d = distinctions(l);
    expect(d.map((x) => x.cle)).toEqual(["precision", "serie", "tetes"]);
    expect(d[0]).toMatchObject({ id: "zoe", pseudo: "zoe", valeur: `52${NBSP}%` });
    expect(d[1]).toMatchObject({ id: "lea", valeur: "×5" });
    expect(d[2]).toMatchObject({ id: "max", valeur: `31${NBSP}%` });
  });

  it("distinctions sans lauréat : « — » et le minimum à afficher", () => {
    const d = distinctions([ligne("a", 0, 0)]);
    expect(d[0]).toMatchObject({ id: null, valeur: TIRET, minimum: "10 tirs minimum" });
    expect(d[2]).toMatchObject({ id: null, valeur: TIRET, minimum: "5 touches minimum" });
  });

  it("distinctions gagnées par un joueur", () => {
    expect(distinctionsGagnees(l, "lea")).toEqual(["Série max ×5"]);
    expect(distinctionsGagnees(l, "zoe")).toEqual([`Précision 52${NBSP}%`]);
    expect(distinctionsGagnees(l, "inconnu")).toEqual([]);
    expect(distinctionsGagnees(l, null)).toEqual([]);
  });
});

describe("podium, bilan, fin de match", () => {
  const l = trierLignes([ligne("lea", 30, 7), ligne("zoe", 24, 9), ligne("max", 19, 10), ligne("moi", 12, 8), ligne("tom", 9, 12)]);

  it("podium : les trois premières places avec leur rang", () => {
    const p = podium(l);
    expect(p.map((x) => [x.ligne.id, x.rang])).toEqual([["lea", 1], ["zoe", 2], ["max", 3]]);
  });
  it("podium : moins de trois joueurs, ex aequo", () => {
    expect(podium([ligne("a", 1, 0)])).toHaveLength(1);
    expect(podium([])).toEqual([]);
    expect(podium(trierLignes([ligne("a", 5, 1), ligne("b", 5, 1), ligne("c", 2, 1)])).map((x) => x.rang)).toEqual([1, 1, 3]);
  });
  it("hauteurs des marches : 100 / 78 / 62", () => {
    expect([1, 2, 3, 4].map(hauteurMarche)).toEqual([100, 78, 62, 62]);
  });
  it("bilan : mon rang et le total", () => {
    const b = bilanJoueur(l, "moi");
    expect(b?.rang).toBe(4);
    expect(b?.total).toBe(5);
    expect(b?.ligne.id).toBe("moi");
    expect(bilanJoueur(l, "absent")).toBeNull();
    expect(bilanJoueur(l, null)).toBeNull();
  });
  it("raison de la fin de match", () => {
    expect(raisonFinMatch(l, 30)).toBe("lea a atteint 30 kills");
    expect(raisonFinMatch(l, 40)).toBe("Temps écoulé");
    expect(raisonFinMatch([], 30)).toBe("Temps écoulé");
  });
  it("titre du vainqueur", () => {
    expect(titreVainqueur(l)).toBe("lea remporte la partie");
    expect(titreVainqueur(trierLignes([ligne("a", 5, 1), ligne("b", 5, 1)]))).toBe("Égalité en tête");
    expect(titreVainqueur([ligne("a", 5, 1)])).toBe("a remporte la partie");
    expect(titreVainqueur([])).toBe("Personne en jeu");
  });
});

describe("formaterNombre", () => {
  it("virgule décimale française", () => {
    expect(formaterNombre(2.64, 1)).toBe("2,6");
    expect(formaterNombre(7)).toBe("7");
  });
});
