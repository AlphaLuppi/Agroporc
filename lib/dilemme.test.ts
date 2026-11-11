import { describe, expect, it } from "vitest";
import type { DuelAvecVoix, LigneHistorique } from "./db";
import {
  agregerStats, candidatsDuJour, classerStats, construireCatalogue, creerRng, choisirDuel, dateIsoValide,
  FENETRES_RECENTES, graineJour, joursNavigation, listeVotants, memePlat, MIN_CANDIDATS_PHOTO, motsSignificatifs, resumerVotes,
  validerVote, voisinsDuel, type CandidatDuel, type DuelPasse,
} from "./dilemme";
import { baseClePlatImage } from "./plat-image";

const cle = (r: string, p: string) => "k:" + baseClePlatImage(r, p);
const TREFLE = "Le Bistrot Trèfle";
const TRUCK = "Le Truck Muche";

function ligne(date: string, plat: LigneHistorique["plat"], o: Partial<LigneHistorique> = {}): LigneHistorique {
  return { date, restaurant: TREFLE, plat, prix: "12,50 €", note: null, note_goulaf: null, options: null, ...o };
}
const meme = (a: string, b: string) => memePlat({ base: "a|" + a, nom: a }, { base: "b|" + b, nom: b });

describe("memePlat", () => {
  it("distingue des plats différents", () => {
    expect(meme("Croziflette", "Pâtes carbo")).toBe(false);
    expect(meme("Pâtes carbo", "Pâtes bolo")).toBe(false);
  });
  it("reconnaît les variantes d'un même plat", () => {
    expect(meme("Croziflette", "Croziflette savoyarde")).toBe(true);
    expect(meme("Pâtes carbonara", "Pâtes carbonara maison")).toBe(true);
    expect(meme("Pâtes carbonara", "Carbonara de pâtes")).toBe(true);
  });
  it("même base = même plat", () => {
    expect(memePlat({ base: "x", nom: "A" }, { base: "x", nom: "B" })).toBe(true);
  });
  it("ensembles vides : seulement si les bases sont égales", () => {
    expect(memePlat({ base: "x", nom: "de la" }, { base: "y", nom: "du chef" })).toBe(false);
    expect(memePlat({ base: "x", nom: "de la" }, { base: "y", nom: "Croziflette" })).toBe(false);
    expect(memePlat({ base: "x", nom: "de la" }, { base: "x", nom: "du chef" })).toBe(true);
  });
  it("applique Jaccard >= 0,6", () => {
    // {poulet, curry, riz, coco} vs {poulet, curry, riz, vert} : 3/5 = 0,6
    expect(meme("Poulet curry riz coco", "Poulet curry riz vert")).toBe(true);
    // {poulet, curry, riz} vs {poulet, tikka, riz, naan} : 2/5
    expect(meme("Poulet curry riz", "Poulet tikka riz naan")).toBe(false);
  });
  it("motsSignificatifs retire les mots vides", () => {
    expect(motsSignificatifs("Pâtes à la sauce du chef")).toEqual(["pates"]);
  });
});

describe("construireCatalogue", () => {
  const auj = "2026-11-10";

  it("dédoublonne par clé, trie les dates et compte les services", () => {
    const c = construireCatalogue(
      [ligne("2026-11-05", "Croziflette"), ligne("2026-11-02", "Croziflette"), ligne("2026-11-05", "CROZIFLETTE")],
      cle, auj,
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      dates: ["2026-11-02", "2026-11-05"], premiere: "2026-11-02", derniere: "2026-11-05", nbServices: 2,
      restaurant: TREFLE, cle: cle(TREFLE, "Croziflette"),
    });
  });
  it("garde le dernier libellé (casse lisible), le dernier prix non vide et les dernières notes", () => {
    const c = construireCatalogue(
      [
        ligne("2026-11-02", "CROZIFLETTE SAVOYARDE", { prix: "11 €", note: 6, note_goulaf: 9 }),
        ligne("2026-11-04", "Croziflette savoyarde", { prix: null, note: 7, note_goulaf: null }),
        ligne("2026-11-03", "Croziflette savoyarde", { prix: "12 €" }),
      ],
      cle, auj,
    );
    expect(c[0]).toMatchObject({ nom: "Croziflette savoyarde", prix: "12 €", noteSportif: 7, noteGoulaf: 9 });
  });
  it("la casse du libellé le plus récent est celle utilisée", () => {
    const c = construireCatalogue([ligne("2026-11-02", "Croziflette"), ligne("2026-11-03", "CROZIFLETTE")], cle, auj);
    expect(c[0].nom).toBe("Croziflette"); // casseLisible : tout en majuscules → casse de phrase
  });
  it("accepte un plat en tableau sans options", () => {
    const c = construireCatalogue([ligne("2026-11-02", ["Wrap poulet", "Wrap thon"])], cle, auj);
    expect(c.map((p) => p.nom).sort()).toEqual(["Wrap poulet", "Wrap thon"]);
  });
  it("éclate les options avec leurs notes", () => {
    const c = construireCatalogue(
      [ligne("2026-11-02", ["Bowl saumon", "Bowl poulet"], {
        restaurant: "Dubble",
        note: null,
        options: [
          { plat: "Bowl saumon", note: 8, note_goulaf: 6 },
          { plat: null, note: 5, note_goulaf: null },
        ],
      })],
      cle, auj,
    );
    const saumon = c.find((p) => p.nom === "Bowl saumon")!;
    const poulet = c.find((p) => p.nom === "Bowl poulet")!;
    expect(saumon).toMatchObject({ noteSportif: 8, noteGoulaf: 6, restaurant: "Dubble" });
    expect(poulet).toMatchObject({ noteSportif: 5, noteGoulaf: null });
  });
  it("exclut les dates futures", () => {
    const c = construireCatalogue([ligne("2026-11-11", "Futur"), ligne("2026-11-10", "Aujourd'hui")], cle, auj);
    expect(c.map((p) => p.nom)).toEqual(["Aujourd'hui"]);
  });
  it("exclut les noms vides, trop courts ou de faux plats", () => {
    const noms = ["", "  ", "Ab", "Fermé", "Fermée pour congés", "Pas de plat du jour", "Bientôt disponible", "À venir", "Indisponible"];
    expect(construireCatalogue(noms.map((n) => ligne("2026-11-02", n)), cle, auj)).toEqual([]);
  });
  it("garde les vrais plats qui contiennent le mot « ferme »", () => {
    const noms = ["Suprême de poulet de ferme, riz", "Œufs de ferme", "Légumes de la ferme", "Fromage de ferme", "Poulet de la ferme"];
    const c = construireCatalogue(noms.map((n) => ligne("2026-11-02", n)), cle, auj);
    expect(c).toHaveLength(noms.length);
  });
  it("exclut les messages de fermeture, sous toutes leurs formes", () => {
    const noms = ["Fermé", "Restaurant fermé", "Fermé pour congés", "Fermé (jour férié)", "Fermé exceptionnellement", "Pas de plat du jour", "Bientôt disponible", "En congés"];
    expect(construireCatalogue(noms.map((n) => ligne("2026-11-02", n)), cle, auj)).toEqual([]);
  });
  it("ne confond pas un plat contenant un mot proche", () => {
    const c = construireCatalogue([ligne("2026-11-02", "Fromage fermier")], cle, auj);
    expect(c).toHaveLength(1);
  });
  it("même plat dans deux restaurants = deux entrées", () => {
    const c = construireCatalogue(
      [ligne("2026-11-02", "Croziflette"), ligne("2026-11-03", "Croziflette", { restaurant: TRUCK })],
      cle, auj,
    );
    expect(c).toHaveLength(2);
    expect(new Set(c.map((p) => p.cle)).size).toBe(2);
  });
  it("utilise la fonction de clé injectée", () => {
    const c = construireCatalogue([ligne("2026-11-02", "Croziflette")], () => "fausse-cle", auj);
    expect(c[0].cle).toBe("fausse-cle");
  });
  it("trie par dernier service décroissant puis par nom", () => {
    const c = construireCatalogue(
      [ligne("2026-11-01", "Zeste"), ligne("2026-11-05", "Burger"), ligne("2026-11-05", "Agneau")],
      cle, auj,
    );
    expect(c.map((p) => p.nom)).toEqual(["Agneau", "Burger", "Zeste"]);
  });
  it("ne dépend pas de l'ordre des lignes d'entrée", () => {
    const l = [ligne("2026-11-05", "A plat", { prix: "10 €" }), ligne("2026-11-02", "A plat", { prix: "9 €" })];
    expect(construireCatalogue([...l].reverse(), cle, auj)).toEqual(construireCatalogue(l, cle, auj));
    expect(construireCatalogue(l, cle, auj)[0].prix).toBe("10 €");
  });
});

describe("graineJour / creerRng", () => {
  it("graineJour est stable (FNV-1a 32 bits)", () => {
    expect(graineJour("")).toBe(0x811c9dc5);
    expect(graineJour("a")).toBe(0xe40c292c);
    expect(graineJour("dilemme|v1|2026-11-11")).toBe(graineJour("dilemme|v1|2026-11-11"));
    expect(graineJour("2026-11-11")).not.toBe(graineJour("2026-11-12"));
  });
  it("creerRng est déterministe et dans [0, 1)", () => {
    const a = creerRng(42);
    const b = creerRng(42);
    const suite = Array.from({ length: 1000 }, () => a());
    expect(suite).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...suite)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...suite)).toBeLessThan(1);
    expect(new Set(suite).size).toBeGreaterThan(990);
    expect(creerRng(43)()).not.toBe(creerRng(42)());
  });
});

// --- Tirage ---

const MOTS = ["rouge", "vert", "bleu", "jaune", "noir", "blanc", "rose", "gris", "brun", "violet", "orange", "ocre"];
const FORMES = ["tarte", "gratin", "salade", "curry", "burger", "risotto", "tajine", "wok", "pizza", "quiche"];
function vivier(n: number, photos = 0): CandidatDuel[] {
  return Array.from({ length: n }, (_, i) => {
    const nom = `${FORMES[i % FORMES.length]} ${MOTS[Math.floor(i / FORMES.length) % MOTS.length]}${i >= 120 ? i : ""}`;
    const restaurant = i % 3 === 0 ? TRUCK : TREFLE;
    return { cle: `c${String(i).padStart(3, "0")}`, base: `${restaurant}|${nom}`, restaurant, nom, aImage: i < photos };
  });
}
const jourPlus = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);

function simuler(candidats: CandidatDuel[], jours: number): { jour: string; a_cle: string; b_cle: string; a: CandidatDuel; b: CandidatDuel }[] {
  const passes: DuelPasse[] = [];
  const out = [];
  for (let i = 0; i < jours; i++) {
    const jour = jourPlus(i);
    const d = choisirDuel(jour, candidats, passes);
    if (!d) break;
    passes.push({ jour, a_cle: d.a.cle, b_cle: d.b.cle });
    out.push({ jour, a_cle: d.a.cle, b_cle: d.b.cle, a: d.a, b: d.b });
  }
  return out;
}

describe("choisirDuel", () => {
  const cands = vivier(40);

  it("est déterministe, y compris sur une entrée mélangée", () => {
    const d1 = choisirDuel("2026-11-11", cands, []);
    const d2 = choisirDuel("2026-11-11", cands, []);
    const melange = [...cands].reverse();
    const d3 = choisirDuel("2026-11-11", melange, []);
    const doublons = choisirDuel("2026-11-11", [...cands, ...cands], []);
    expect(d2).toEqual(d1);
    expect(d3).toEqual(d1);
    expect(doublons).toEqual(d1);
  });
  it("renvoie deux plats distincts", () => {
    for (let i = 0; i < 50; i++) {
      const d = choisirDuel(jourPlus(i), cands, [])!;
      expect(d.a.cle).not.toBe(d.b.cle);
    }
  });
  it("change d'un jour à l'autre", () => {
    const paires = new Set(Array.from({ length: 30 }, (_, i) => {
      const d = choisirDuel(jourPlus(i), cands, [])!;
      return [d.a.cle, d.b.cle].sort().join("|");
    }));
    expect(paires.size).toBeGreaterThan(20);
  });
  it("ne propose jamais deux variantes du même plat sur 365 jours", () => {
    const noms = [
      "Croziflette", "Croziflette savoyarde", "Pâtes carbonara", "Pâtes carbonara maison", "Carbonara de pâtes",
      "Poulet curry riz coco", "Poulet curry riz vert",
    ];
    const proches: CandidatDuel[] = noms.map((nom, i) => ({
      cle: `p${i}`, base: `${TREFLE}|${nom}`, restaurant: i % 2 ? TRUCK : TREFLE, nom, aImage: false,
    }));
    const tous = [...proches, ...vivier(60)];
    const duels = simuler(tous, 365);
    expect(duels.length).toBeGreaterThan(300);
    for (const d of duels) expect(memePlat(d.a, d.b)).toBe(false);
  });
  it("exclut les clés des 14 derniers duels quand le vivier suffit", () => {
    const duels = simuler(vivier(80), 120);
    expect(duels).toHaveLength(120);
    duels.forEach((d, i) => {
      const recents = new Set(duels.slice(Math.max(0, i - 14), i).flatMap((x) => [x.a_cle, x.b_cle]));
      expect(recents.has(d.a_cle)).toBe(false);
      expect(recents.has(d.b_cle)).toBe(false);
    });
  });
  it("relâche la fenêtre 14 -> 7 -> 0 quand le vivier est trop petit", () => {
    expect(FENETRES_RECENTES).toEqual([14, 7, 0]);
    // 12 candidats : 14 duels récents excluraient tout le monde, on relâche.
    const petit = vivier(12);
    const passes: DuelPasse[] = [];
    for (let i = 0; i < 3; i++) passes.push({ jour: jourPlus(i), a_cle: petit[2 * i].cle, b_cle: petit[2 * i + 1].cle });
    const d = choisirDuel(jourPlus(3), petit, passes)!;
    expect(d).not.toBeNull();
    // fenêtre 14 : 6 clés exclues, il reste 6 candidats -> ils sont utilisés
    const exclues = new Set(passes.flatMap((p) => [p.a_cle, p.b_cle]));
    expect(exclues.has(d.a.cle)).toBe(false);
    expect(exclues.has(d.b.cle)).toBe(false);
    // 7 duels récents sur 8 candidats : fenêtre 14 et 7 laissent < 2, la fenêtre 0 sert
    const huit = vivier(8);
    const passes8: DuelPasse[] = [0, 1, 2].map((i) => ({ jour: jourPlus(i), a_cle: huit[2 * i].cle, b_cle: huit[2 * i + 1].cle }));
    const d8 = choisirDuel(jourPlus(3), huit, passes8)!;
    expect(d8).not.toBeNull();
    const reste = new Set([huit[6].cle, huit[7].cle]);
    // 6 clés exclues, 2 restantes : fenêtre 14 donne exactement la paire des deux restants
    expect(new Set([d8.a.cle, d8.b.cle])).toEqual(reste);
  });
  it("passe à la fenêtre 7 quand la fenêtre 14 ne laisse qu'un candidat", () => {
    const c = vivier(10);
    const k = (i: number) => c[i].cle;
    // Du plus récent au plus ancien : 7 duels sur c0..c3, puis 7 duels sur c4..c8.
    const paires = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2], [0, 1], [4, 5], [6, 7], [4, 6], [5, 7], [4, 8], [5, 8], [6, 8]];
    const passes: DuelPasse[] = paires.map(([a, b], i) => ({ jour: jourPlus(20 - i), a_cle: k(a), b_cle: k(b) }));
    // Fenêtre 14 : seul c9 reste (< 2) ; fenêtre 7 : c4..c9 restent.
    const d = choisirDuel(jourPlus(30), c, passes)!;
    expect(d).not.toBeNull();
    for (const x of [d.a.cle, d.b.cle]) expect([4, 5, 6, 7, 8, 9].map(k)).toContain(x);
  });
  it("relâche jusqu'à la fenêtre 0", () => {
    const petit = vivier(4);
    const passes: DuelPasse[] = [
      { jour: jourPlus(0), a_cle: petit[0].cle, b_cle: petit[1].cle },
      { jour: jourPlus(1), a_cle: petit[2].cle, b_cle: petit[3].cle },
    ];
    const d = choisirDuel(jourPlus(2), petit, passes)!;
    expect(d).not.toBeNull();
    // les paires déjà jouées ne reviennent pas
    const jouees = new Set(passes.map((p) => [p.a_cle, p.b_cle].sort().join("|")));
    expect(jouees.has([d.a.cle, d.b.cle].sort().join("|"))).toBe(false);
  });
  it("renvoie null avec 0 ou 1 candidat, la paire exacte avec 2", () => {
    expect(choisirDuel("2026-11-11", [], [])).toBeNull();
    expect(choisirDuel("2026-11-11", vivier(1), [])).toBeNull();
    const deux = vivier(2).map((c, i) => ({ ...c, nom: i ? "tarte rouge" : "wok bleu", base: `r|${i ? "tarte rouge" : "wok bleu"}` }));
    const d = choisirDuel("2026-11-11", deux, [])!;
    expect(new Set([d.a.cle, d.b.cle])).toEqual(new Set(deux.map((c) => c.cle)));
  });
  it("ne rejoue jamais une paire déjà jouée", () => {
    const deux = [
      { cle: "x", base: "r|wok bleu", restaurant: TREFLE, nom: "wok bleu", aImage: false },
      { cle: "y", base: "r|tarte rouge", restaurant: TREFLE, nom: "tarte rouge", aImage: false },
    ];
    expect(choisirDuel("2026-11-11", deux, [{ jour: "2026-11-10", a_cle: "y", b_cle: "x" }])).toBeNull();
  });
  it("ne tire pas deux plats trop proches même s'ils sont les deux seuls", () => {
    const deux = [
      { cle: "x", base: "r|croziflette", restaurant: TREFLE, nom: "Croziflette", aImage: false },
      { cle: "y", base: "r|croziflette savoyarde", restaurant: TREFLE, nom: "Croziflette savoyarde", aImage: false },
    ];
    expect(choisirDuel("2026-11-11", deux, [])).toBeNull();
  });
  it("avec assez de plats photographiés, les deux plats ont une photo", () => {
    expect(MIN_CANDIDATS_PHOTO).toBe(6);
    // 50 photographiés sur 80 : même avec les 28 clés des 14 derniers duels exclues, il en reste plus de 6.
    const duels = simuler(vivier(80, 50), 14);
    expect(duels).toHaveLength(14);
    for (const d of duels) {
      expect(d.a.aImage).toBe(true);
      expect(d.b.aImage).toBe(true);
    }
  });
  it("sous 6 plats photographiés, la préférence s'efface", () => {
    const duels = simuler(vivier(40, 5), 40);
    expect(duels.some((d) => !d.a.aImage || !d.b.aImage)).toBe(true);
  });
  it("préfère un restaurant différent", () => {
    const duels = simuler(vivier(60), 60);
    const differents = duels.filter((d) => d.a.restaurant !== d.b.restaurant).length;
    // Sans préférence, un tiers des plats est au Truck : environ 44 % de duels mixtes ; le poids x3 doit faire mieux.
    expect(differents / duels.length).toBeGreaterThan(0.55);
  });
  it("ordre a/b non biaisé", () => {
    const duels = simuler(vivier(80), 120);
    const aPremier = duels.filter((d) => d.a_cle < d.b_cle).length;
    expect(aPremier).toBeGreaterThan(30);
    expect(aPremier).toBeLessThan(90);
  });
  it("ignore les duels passés de jour >= jour", () => {
    const base = choisirDuel("2026-11-11", cands, [])!;
    const futurs: DuelPasse[] = [
      { jour: "2026-11-11", a_cle: base.a.cle, b_cle: base.b.cle },
      { jour: "2026-11-12", a_cle: cands[0].cle, b_cle: cands[1].cle },
    ];
    expect(choisirDuel("2026-11-11", cands, futurs)).toEqual(base);
  });
  it("vecteur d'or : le tirage ne change pas par accident", () => {
    const d = choisirDuel("2026-11-11", vivier(40, 10), [{ jour: "2026-11-10", a_cle: "c000", b_cle: "c001" }])!;
    expect([d.a.cle, d.b.cle]).toEqual(["c006", "c008"]);
  });
});

describe("candidatsDuJour", () => {
  it("ne garde que les plats servis avant le jour et marque les photos", () => {
    const cat = construireCatalogue(
      [ligne("2026-11-09", "Croziflette"), ligne("2026-11-10", "Burger maison"), ligne("2026-11-05", "Wok poulet")],
      cle, "2026-11-10",
    );
    const c = candidatsDuJour(cat, "2026-11-10", new Set([cle(TREFLE, "Croziflette")]));
    expect(c.map((x) => x.nom).sort()).toEqual(["Croziflette", "Wok poulet"]);
    expect(c.find((x) => x.nom === "Croziflette")!.aImage).toBe(true);
    expect(c.find((x) => x.nom === "Wok poulet")!.aImage).toBe(false);
  });
});

describe("resumerVotes", () => {
  it("zéro vote", () => {
    expect(resumerVotes(0, 0)).toEqual({ a: 0, b: 0, total: 0, pctA: 0, pctB: 0, gagnant: null });
  });
  it("égalité", () => {
    expect(resumerVotes(3, 3)).toMatchObject({ pctA: 50, pctB: 50, gagnant: "egalite" });
  });
  it("1-0 et 0-1", () => {
    expect(resumerVotes(1, 0)).toMatchObject({ pctA: 100, pctB: 0, gagnant: "a" });
    expect(resumerVotes(0, 1)).toMatchObject({ pctA: 0, pctB: 100, gagnant: "b" });
  });
  it("2-1 : la somme fait 100", () => {
    const r = resumerVotes(2, 1);
    expect(r.pctA + r.pctB).toBe(100);
    expect(r).toMatchObject({ pctA: 67, pctB: 33, total: 3 });
  });
  it("la somme fait toujours 100 sur de grands nombres", () => {
    for (const [a, b] of [[5, 3], [1234, 4321], [999, 1], [333, 667], [7, 11]] as const) {
      const r = resumerVotes(a, b);
      expect(r.pctA + r.pctB).toBe(100);
      expect(Math.abs(r.pctA - (100 * a) / (a + b))).toBeLessThan(1);
    }
  });
});

function duel(jour: string, a: string, b: string, va: number, vb: number): DuelAvecVoix {
  return {
    jour, a_cle: a, a_restaurant: TREFLE, a_plat: `Plat ${a}`, b_cle: b, b_restaurant: TRUCK, b_plat: `Plat ${b}`,
    voix_a: va, voix_b: vb,
  };
}

describe("agregerStats / classerStats", () => {
  it("compte victoire, défaite et nul", () => {
    const s = agregerStats([duel("2026-11-01", "a", "b", 3, 1), duel("2026-11-02", "a", "c", 2, 2)]);
    expect(s.get("a")).toMatchObject({ duels: 2, victoires: 1, defaites: 0, nuls: 1, pour: 5, contre: 3 });
    expect(s.get("b")).toMatchObject({ duels: 1, victoires: 0, defaites: 1, nuls: 0, pour: 1, contre: 3 });
    expect(s.get("c")).toMatchObject({ nuls: 1, pour: 2, contre: 2 });
  });
  it("ignore un duel sans vote", () => {
    const s = agregerStats([duel("2026-11-01", "a", "b", 0, 0)]);
    expect(s.size).toBe(0);
    expect(classerStats(s.values())).toEqual([]);
  });
  it("score lissé (pour + 1) / (pour + contre + 2)", () => {
    const s = agregerStats([duel("2026-11-01", "a", "b", 3, 1)]);
    expect(s.get("a")!.score).toBeCloseTo(4 / 6, 10);
    expect(s.get("b")!.score).toBeCloseTo(2 / 6, 10);
  });
  it("garde le nom du duel le plus récent (entrée du plus récent au plus ancien)", () => {
    const recent = { ...duel("2026-11-02", "a", "b", 1, 0), a_plat: "Nouveau nom" };
    const s = agregerStats([recent, duel("2026-11-01", "a", "c", 1, 0)]);
    expect(s.get("a")!.nom).toBe("Nouveau nom");
  });
  it("n'inclut dans le classement que les plats à 2 voix au moins", () => {
    const s = agregerStats([duel("2026-11-01", "a", "b", 1, 0)]); // a : 1 voix pour, 0 contre
    expect(classerStats(s.values())).toEqual([]);
    const s2 = agregerStats([duel("2026-11-01", "a", "b", 1, 1)]);
    expect(classerStats(s2.values())).toHaveLength(2);
  });
  it("trie par score, victoires, duels puis clé, de façon stable", () => {
    const s = agregerStats([
      duel("2026-11-01", "a", "b", 4, 1),
      duel("2026-11-02", "c", "d", 4, 1),
      duel("2026-11-03", "e", "f", 2, 1),
    ]);
    const ordre = classerStats(s.values()).map((x) => x.cle);
    expect(ordre).toEqual(["a", "c", "e", "f", "b", "d"]);
    expect(classerStats([...s.values()].reverse()).map((x) => x.cle)).toEqual(ordre);
  });
  it("départage par victoires puis duels à score égal", () => {
    const base = { restaurant: TREFLE, nom: "n", defaites: 0, nuls: 0, pour: 3, contre: 1, score: 0.5 };
    const r = classerStats([
      { ...base, cle: "z", duels: 1, victoires: 1 },
      { ...base, cle: "y", duels: 2, victoires: 1 },
      { ...base, cle: "x", duels: 2, victoires: 2 },
    ]);
    expect(r.map((x) => x.cle)).toEqual(["x", "y", "z"]);
  });
});

describe("dateIsoValide", () => {
  it("accepte les dates réelles", () => {
    expect(dateIsoValide("2026-11-11")).toBe(true);
    expect(dateIsoValide("2028-02-29")).toBe(true);
  });
  it("refuse le reste", () => {
    for (const v of ["2026-02-30", "2026-13-01", "26-11-11", "2026-1-1", "2026-11-11T00:00", 20261111, null, undefined, {}]) {
      expect(dateIsoValide(v)).toBe(false);
    }
    expect(dateIsoValide("2027-02-29")).toBe(false);
  });
});

describe("validerVote", () => {
  it("canonise le votant et accepte les alias hérités", () => {
    expect(validerVote({ votant: "thomas", choix: "a" })).toEqual({ ok: true, votant: "Thomas", choix: "a", jour: null });
    expect(validerVote({ votant: "Toam", choix: "b" })).toMatchObject({ ok: true, votant: "Thomas" });
    expect(validerVote({ votant: "Philippe", choix: "b" })).toMatchObject({ ok: true, votant: "Philippe Hetschebest" });
  });
  it("refuse un votant vide, trop long, non texte ou inconnu", () => {
    const attendu = { ok: false, erreur: "Personnage inconnu : choisis-en un dans la liste." };
    for (const votant of ["", "   ", "x".repeat(51), 12, null, undefined, "Zorglub", "constructor"]) {
      expect(validerVote({ votant, choix: "a" })).toEqual(attendu);
    }
    expect(validerVote({ choix: "a" })).toEqual(attendu);
  });
  it("accepte A en majuscule et refuse c", () => {
    expect(validerVote({ votant: "Gab", choix: " A " })).toMatchObject({ ok: true, choix: "a" });
    expect(validerVote({ votant: "Gab", choix: "c" })).toEqual({ ok: false, erreur: "Choix invalide." });
    expect(validerVote({ votant: "Gab", choix: 1 })).toEqual({ ok: false, erreur: "Choix invalide." });
    expect(validerVote({ votant: "Gab" })).toEqual({ ok: false, erreur: "Choix invalide." });
  });
  it("annuler: true retire le vote sans lire choix, annuler non booléen n'annule pas", () => {
    expect(validerVote({ votant: "thomas", annuler: true })).toEqual({ ok: true, votant: "Thomas", choix: null, jour: null });
    expect(validerVote({ votant: "Gab", annuler: true, choix: "z" })).toMatchObject({ ok: true, choix: null });
    expect(validerVote({ votant: "Gab", annuler: "oui" })).toEqual({ ok: false, erreur: "Choix invalide." });
    expect(validerVote({ votant: "Zorglub", annuler: true })).toMatchObject({ ok: false });
  });
  it("traite jour absent, null, invalide et valide", () => {
    expect(validerVote({ votant: "Gab", choix: "a", jour: null })).toMatchObject({ jour: null });
    expect(validerVote({ votant: "Gab", choix: "a", jour: "2026-11-10" })).toMatchObject({ jour: "2026-11-10" });
    expect(validerVote({ votant: "Gab", choix: "a", jour: "2026-02-30" })).toEqual({ ok: false, erreur: "Date invalide." });
    expect(validerVote({ votant: "Gab", choix: "a", jour: 5 })).toEqual({ ok: false, erreur: "Date invalide." });
  });
  it("refuse un corps qui n'est pas un objet", () => {
    for (const c of [null, undefined, "x", 3, [], [1]]) {
      expect(validerVote(c)).toEqual({ ok: false, erreur: "Requête invalide." });
    }
  });
});

describe("voisinsDuel", () => {
  it("renvoie le jour avant et après, en ignorant l'ordre et les doublons", () => {
    const jours = ["2026-11-10", "2026-11-08", "2026-11-09", "2026-11-09"];
    expect(voisinsDuel(jours, "2026-11-09")).toEqual({ precedent: "2026-11-08", suivant: "2026-11-10" });
  });
  it("null aux extrémités ou si le jour est absent", () => {
    const jours = ["2026-11-08", "2026-11-09"];
    expect(voisinsDuel(jours, "2026-11-08")).toEqual({ precedent: null, suivant: "2026-11-09" });
    expect(voisinsDuel(jours, "2026-11-09")).toEqual({ precedent: "2026-11-08", suivant: null });
    expect(voisinsDuel(jours, "2026-11-01")).toEqual({ precedent: null, suivant: null });
    expect(voisinsDuel([], "2026-11-01")).toEqual({ precedent: null, suivant: null });
  });
  it("ne modifie pas la liste", () => {
    const jours = ["2026-11-10", "2026-11-08"];
    voisinsDuel(jours, "2026-11-08");
    expect(jours).toEqual(["2026-11-10", "2026-11-08"]);
  });
});

describe("joursNavigation", () => {
  it("le duel du jour est le suivant du dernier duel clos, quand on consulte un duel passé", () => {
    const jours = joursNavigation(["2026-11-10", "2026-11-09"], "2026-11-11", "2026-11-10");
    expect(voisinsDuel(jours, "2026-11-10")).toEqual({ precedent: "2026-11-09", suivant: "2026-11-11" });
  });
  it("sans doublon quand on consulte le duel du jour", () => {
    const jours = joursNavigation(["2026-11-10"], "2026-11-11", "2026-11-11");
    expect(jours.filter((j) => j === "2026-11-11")).toHaveLength(1);
    expect(voisinsDuel(jours, "2026-11-11")).toEqual({ precedent: "2026-11-10", suivant: null });
  });
  it("ignore un passé qui serait aujourd'hui ou plus tard, et garde le jour consulté si l'historique manque", () => {
    expect(joursNavigation(["2026-11-11", "2026-11-12"], "2026-11-11")).toEqual(["2026-11-11"]);
    expect(voisinsDuel(joursNavigation([], "2026-11-11", "2026-11-05"), "2026-11-05").suivant).toBe("2026-11-11");
  });
});

describe("listeVotants", () => {
  it("0 à 5 noms", () => {
    expect(listeVotants([])).toBe("");
    expect(listeVotants(["Thomas"])).toBe("Thomas");
    expect(listeVotants(["Thomas", "Gab"])).toBe("Thomas et Gab");
    expect(listeVotants(["Thomas", "Gab", "Tom"])).toBe("Thomas, Gab et Tom");
    expect(listeVotants(["Thomas", "Gab", "Tom", "Nova"])).toBe("Thomas, Gab et 2 autres");
    expect(listeVotants(["Thomas", "Gab", "Tom", "Nova", "Jimmy"])).toBe("Thomas, Gab et 3 autres");
  });
  it("respecte un max différent", () => {
    expect(listeVotants(["A", "B", "C"], 2)).toBe("A et 2 autres");
    expect(listeVotants(["A", "B"], 1)).toBe("A et 1 autre");
  });
});
