import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LigneHistorique } from "./db";

// Base en mémoire : mêmes contrats que les fonctions SQL de lib/db.ts.
const base = vi.hoisted(() => {
  const etat = {
    lignes: [] as unknown[],
    duels: new Map<string, Record<string, string>>(),
    votes: new Map<string, Map<string, { choix: "a" | "b"; n: number }>>(),
    images: new Map<string, { creeLe: string; fournisseur: string | null }>(),
    panne: false,
    panneVotes: false,
    avantEcriture: null as null | ((d: Record<string, string>) => void),
    n: 0,
  };
  const verifier = () => {
    if (etat.panne) throw new Error("base coupée");
  };
  return { etat, verifier };
});

vi.mock("./db", () => ({
  getLignesHistorique: vi.fn(async (jusquAu: string) => {
    base.verifier();
    return (base.etat.lignes as { date: string }[]).filter((l) => l.date <= jusquAu);
  }),
  getDilemme: vi.fn(async (jour: string) => {
    base.verifier();
    return base.etat.duels.get(jour) ?? null;
  }),
  creerDilemmeSiAbsent: vi.fn(async (d: Record<string, string>) => {
    base.verifier();
    base.etat.avantEcriture?.(d);
    if (!base.etat.duels.has(d.jour)) base.etat.duels.set(d.jour, { ...d });
  }),
  getDuelsPasses: vi.fn(async (avant: string) => {
    base.verifier();
    return [...base.etat.duels.values()]
      .filter((d) => d.jour < avant)
      .sort((x, y) => (x.jour < y.jour ? 1 : -1))
      .map((d) => ({ jour: d.jour, a_cle: d.a_cle, b_cle: d.b_cle }));
  }),
  getVotesDilemme: vi.fn(async (jour: string) => {
    base.verifier();
    if (base.etat.panneVotes) throw new Error("votes illisibles");
    return [...(base.etat.votes.get(jour) ?? new Map()).entries()]
      .sort((x, y) => x[1].n - y[1].n)
      .map(([votant, v]) => ({ votant, choix: v.choix }));
  }),
  voterDilemme: vi.fn(async (jour: string, votant: string, choix: "a" | "b") => {
    base.verifier();
    const m = base.etat.votes.get(jour) ?? new Map();
    m.set(votant, { choix, n: ++base.etat.n });
    base.etat.votes.set(jour, m);
  }),
  platImagesExistantes: vi.fn(async (cles: string[]) => {
    base.verifier();
    return new Map(cles.filter((c) => base.etat.images.has(c)).map((c) => [c, base.etat.images.get(c)!]));
  }),
}));

import * as db from "./db";
import { GET } from "../app/api/dilemme/route";
import { POST } from "../app/api/dilemme/vote/route";
import { assurerDilemme, chargerCatalogue, lireEtatDuel, traiterVote, viderCacheCatalogue } from "./dilemme-serveur";
import { creerLimiteur } from "./limiteur-debit";
import { clePlatImage } from "./plat-image-cle";

const AUJOURDHUI = "2026-11-11";
const R = "Le Bistrot Trèfle";
const NOMS = [
  "Croziflette", "Pâtes carbonara", "Burger maison", "Wok de poulet", "Tajine d'agneau", "Quiche lorraine",
  "Risotto champignons", "Lasagnes bolognaise", "Curry de légumes", "Gratin dauphinois", "Saumon grillé", "Couscous royal",
];

function lignes(noms = NOMS, jour = "2026-10-15"): LigneHistorique[] {
  return noms.map((n) => ({ date: jour, restaurant: R, plat: n, prix: "12 €", note: 7, note_goulaf: 6, options: null }));
}

function limiteurs(ip = 100, votant = 100) {
  return { ip: creerLimiteur(ip, 60_000), votant: creerLimiteur(votant, 60_000) };
}

const requete = (corps: unknown, brut = false) =>
  new Request("http://localhost/api/dilemme/vote", {
    method: "POST",
    headers: { "x-forwarded-for": "10.0.0.1", "content-type": "application/json" },
    body: brut ? (corps as string) : JSON.stringify(corps),
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T10:00:00Z"));
  base.etat.lignes = lignes();
  base.etat.duels.clear();
  base.etat.votes.clear();
  base.etat.images.clear();
  base.etat.panne = false;
  base.etat.panneVotes = false;
  base.etat.avantEcriture = null;
  base.etat.n = 0;
  viderCacheCatalogue();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function ligneDuel(jour: string, a = "A", b = "B"): Record<string, string> {
  return {
    jour, a_cle: "cle-" + a, a_restaurant: R, a_plat: "Plat " + a, b_cle: "cle-" + b, b_restaurant: R, b_plat: "Plat " + b,
  };
}

describe("chargerCatalogue", () => {
  it("met le catalogue en cache 60 s", async () => {
    await chargerCatalogue();
    await chargerCatalogue();
    expect(db.getLignesHistorique).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-11-11T10:01:01Z"));
    await chargerCatalogue();
    expect(db.getLignesHistorique).toHaveBeenCalledTimes(2);
  });
  it("partage la requête en cours et n'enregistre pas un échec", async () => {
    base.etat.panne = true;
    await expect(Promise.all([chargerCatalogue(), chargerCatalogue()])).rejects.toThrow();
    expect(db.getLignesHistorique).toHaveBeenCalledTimes(1);
    base.etat.panne = false;
    await expect(chargerCatalogue()).resolves.toHaveLength(NOMS.length);
  });
});

describe("lireEtatDuel", () => {
  it("crée et renvoie le duel du jour par défaut", async () => {
    const r = await lireEtatDuel(null, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.etat.jour).toBe(AUJOURDHUI);
    expect(r.etat.ouvert).toBe(true);
    expect(r.etat.dilemme.a.cle).not.toBe(r.etat.dilemme.b.cle);
    expect(r.etat.dilemme.a.cle).toBe(clePlatImage(R, r.etat.dilemme.a.nom));
    expect(r.etat.dilemme.a.nbServices).toBe(1);
    expect(r.etat.dilemme.a.derniere).toBe("2026-10-15");
    expect(r.etat.voix).toEqual({ a: 0, b: 0 });
    expect(r.etat.resume.gagnant).toBeNull();
    expect(r.etat.monVote).toBeNull();
    expect(base.etat.duels.size).toBe(1);
  });
  it("fige le duel : une fois écrit, il ne change plus même si le vivier change", async () => {
    const r1 = await lireEtatDuel(null, null);
    base.etat.lignes = lignes(["Nouveau plat unique", "Autre plat inédit"], "2026-10-01");
    viderCacheCatalogue();
    const r2 = await lireEtatDuel(null, null);
    const ids = (r: typeof r1) => r.ok && [r.etat.dilemme.a.cle, r.etat.dilemme.b.cle, r.etat.dilemme.a.nom, r.etat.dilemme.b.nom];
    expect(ids(r2)).toEqual(ids(r1));
    expect(db.creerDilemmeSiAbsent).toHaveBeenCalledTimes(1);
  });
  it("ne tire pas le plat servi aujourd'hui (première date < jour)", async () => {
    base.etat.lignes = [...lignes(["Tarte aux pommes", "Gratin de pâtes"]), ...lignes(["Plat du jour"], AUJOURDHUI)];
    const r = await lireEtatDuel(null, null);
    expect(r.ok && [r.etat.dilemme.a.nom, r.etat.dilemme.b.nom].sort()).toEqual(["Gratin de pâtes", "Tarte aux pommes"]);
  });
  it("deux premières demandes simultanées ne produisent qu'un duel", async () => {
    const [r1, r2] = await Promise.all([lireEtatDuel(null, null), lireEtatDuel(null, null)]);
    expect(base.etat.duels.size).toBe(1);
    expect(r1.ok && r2.ok && r2.etat.dilemme).toEqual(r1.ok && r1.etat.dilemme);
  });
  it("le premier qui écrit gagne : on relit le duel de la base", async () => {
    base.etat.avantEcriture = () => {
      base.etat.duels.set(AUJOURDHUI, ligneDuel(AUJOURDHUI, "GAGNANT", "AUTRE"));
    };
    const ligne = await assurerDilemme(AUJOURDHUI);
    expect(ligne?.a_cle).toBe("cle-GAGNANT");
  });
  it("répond 400 pour une date invalide", async () => {
    expect(await lireEtatDuel("2026-02-30", null)).toEqual({ ok: false, status: 400, erreur: "Date invalide." });
    expect(await lireEtatDuel("hier", null)).toMatchObject({ ok: false, status: 400 });
  });
  it("répond 404 pour un jour futur, sans rien écrire", async () => {
    expect(await lireEtatDuel("2026-11-12", null)).toEqual({ ok: false, status: 404, erreur: "Pas de dilemme ce jour-là." });
    expect(base.etat.duels.size).toBe(0);
  });
  it("répond 404 pour un jour passé sans duel (pas de rétro-génération)", async () => {
    expect(await lireEtatDuel("2026-11-01", null)).toEqual({ ok: false, status: 404, erreur: "Pas de dilemme ce jour-là." });
    expect(base.etat.duels.size).toBe(0);
  });
  it("répond 404 vivier quand il y a moins de deux plats, sans rien écrire", async () => {
    base.etat.lignes = lignes(["Un seul plat"]);
    const r = await lireEtatDuel(null, null);
    expect(r).toEqual({
      ok: false, status: 404, code: "vivier", erreur: "Pas encore assez de plats pour lancer un duel. Reviens demain !",
    });
    expect(db.creerDilemmeSiAbsent).not.toHaveBeenCalled();
  });
  it("répond 404 vivier sur une base vide", async () => {
    base.etat.lignes = [];
    expect(await lireEtatDuel(null, null)).toMatchObject({ ok: false, status: 404, code: "vivier" });
  });
  it("répond 503 si la base est coupée", async () => {
    base.etat.panne = true;
    expect(await lireEtatDuel(null, null)).toEqual({ ok: false, status: 503, erreur: "Le dilemme est indisponible pour le moment." });
    base.etat.panne = false;
    base.etat.panneVotes = true;
    expect(await lireEtatDuel(null, null)).toMatchObject({ ok: false, status: 503 });
  });
  it("renvoie un duel passé en lecture seule, avec ses votes", async () => {
    base.etat.duels.set("2026-11-05", ligneDuel("2026-11-05"));
    base.etat.votes.set("2026-11-05", new Map([["Thomas", { choix: "a", n: 1 }], ["Gab", { choix: "a", n: 2 }], ["Tom", { choix: "b", n: 3 }]]));
    const r = await lireEtatDuel("2026-11-05", "thomas");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.etat.ouvert).toBe(false);
    expect(r.etat.voix).toEqual({ a: 2, b: 1 });
    expect(r.etat.resume).toMatchObject({ gagnant: "a", pctA: 67, pctB: 33 });
    expect(r.etat.votes).toHaveLength(3);
    expect(r.etat.monVote).toBe("a");
    expect(r.etat.dilemme.a).toMatchObject({ nom: "Plat A", nbServices: 0, derniere: null, image: null });
  });
  it("renseigne monVote selon le votant canonique, null s'il est inconnu", async () => {
    await lireEtatDuel(null, null);
    base.etat.votes.set(AUJOURDHUI, new Map([["Thomas", { choix: "b", n: 1 }]]));
    const ok = await lireEtatDuel(null, "THOMAS");
    expect(ok.ok && ok.etat.monVote).toBe("b");
    const inconnu = await lireEtatDuel(null, "Zorglub");
    expect(inconnu.ok && inconnu.etat.monVote).toBeNull();
    const autre = await lireEtatDuel(null, "Gab");
    expect(autre.ok && autre.etat.monVote).toBeNull();
  });
  it("ajoute les photos qui existent (et le crédit), ignore les autres", async () => {
    const r0 = await lireEtatDuel(null, null);
    if (!r0.ok) throw new Error("duel attendu");
    base.etat.images.set(r0.etat.dilemme.a.cle, { creeLe: "2026-11-01T00:00:00.000Z", fournisseur: "pollinations" });
    const r = await lireEtatDuel(null, null);
    expect(r.ok && r.etat.dilemme.a.image).toEqual({
      src: expect.stringMatching(new RegExp(`^/api/plat-image/${r0.etat.dilemme.a.cle}\\?v=`)),
      credit: "pollinations.ai",
    });
    expect(r.ok && r.etat.dilemme.b.image).toBeNull();
  });
  it("un duel passé s'affiche même si le catalogue est indisponible", async () => {
    base.etat.duels.set("2026-11-05", ligneDuel("2026-11-05"));
    viderCacheCatalogue();
    vi.mocked(db.getLignesHistorique).mockRejectedValueOnce(new Error("lent"));
    const r = await lireEtatDuel("2026-11-05", null);
    expect(r.ok).toBe(true);
  });
  it("préfère les plats photographiés quand ils sont assez nombreux", async () => {
    const cles = NOMS.map((n) => clePlatImage(R, n));
    cles.slice(0, 8).forEach((c) => base.etat.images.set(c, { creeLe: "2026-11-01T00:00:00.000Z", fournisseur: null }));
    const r = await lireEtatDuel(null, null);
    expect(r.ok && base.etat.images.has(r.etat.dilemme.a.cle) && base.etat.images.has(r.etat.dilemme.b.cle)).toBe(true);
  });
  it("n'envoie jamais plus de deux requêtes en parallèle", async () => {
    let actives = 0;
    let max = 0;
    const suivre = (f: (...a: unknown[]) => Promise<unknown>) =>
      async (...a: unknown[]) => {
        actives++;
        max = Math.max(max, actives);
        await Promise.resolve();
        try { return await f(...a); } finally { actives--; }
      };
    for (const nom of ["getLignesHistorique", "getDilemme", "getDuelsPasses", "getVotesDilemme", "platImagesExistantes"] as const) {
      const m = vi.mocked(db[nom]) as unknown as { getMockImplementation(): ((...a: unknown[]) => Promise<unknown>) | undefined; mockImplementation(f: unknown): void };
      m.mockImplementation(suivre(m.getMockImplementation()!));
    }
    await lireEtatDuel(null, null);
    expect(max).toBeLessThanOrEqual(2);
  });
});

describe("traiterVote", () => {
  const corps = { votant: "thomas", choix: "a" };

  it("enregistre le vote et renvoie l'état avec monVote", async () => {
    const r = await traiterVote(corps, "1.1.1.1", undefined, limiteurs());
    expect(r.ok).toBe(true);
    if (!r.ok || "factice" in r) return;
    expect(r.etat.monVote).toBe("a");
    expect(r.etat.voix).toEqual({ a: 1, b: 0 });
    expect(r.etat.votes).toEqual([{ votant: "Thomas", choix: "a" }]);
    expect(db.voterDilemme).toHaveBeenCalledWith(AUJOURDHUI, "Thomas", "a");
  });
  it("change d'avis : une seule ligne par personne", async () => {
    await traiterVote(corps, "1.1.1.1", undefined, limiteurs());
    const r = await traiterVote({ votant: "THOMAS", choix: "B" }, "1.1.1.1", undefined, limiteurs());
    expect(r.ok && !("factice" in r) && r.etat.voix).toEqual({ a: 0, b: 1 });
    expect(base.etat.votes.get(AUJOURDHUI)!.size).toBe(1);
  });
  it("est idempotent", async () => {
    const l = limiteurs();
    const r1 = await traiterVote(corps, "1.1.1.1", undefined, l);
    const r2 = await traiterVote(corps, "1.1.1.1", undefined, l);
    expect(r2).toEqual(r1);
  });
  it("accepte jour = aujourd'hui", async () => {
    const r = await traiterVote({ ...corps, jour: AUJOURDHUI }, "1.1.1.1", undefined, limiteurs());
    expect(r.ok).toBe(true);
  });
  it("ne crée le duel qu'une fois pour deux votes simultanés", async () => {
    const l = limiteurs();
    await Promise.all([
      traiterVote({ votant: "Thomas", choix: "a" }, "1.1.1.1", undefined, l),
      traiterVote({ votant: "Gab", choix: "b" }, "1.1.1.2", undefined, l),
    ]);
    expect(base.etat.duels.size).toBe(1);
    expect(base.etat.votes.get(AUJOURDHUI)!.size).toBe(2);
  });
  it("honeypot : faux succès, aucun accès à la base ni au limiteur", async () => {
    const l = limiteurs(0, 0);
    const r = await traiterVote({ ...corps, website: "http://spam" }, "1.1.1.1", undefined, l);
    expect(r).toEqual({ ok: true, factice: true });
    expect(db.getDilemme).not.toHaveBeenCalled();
    expect(db.voterDilemme).not.toHaveBeenCalled();
  });
  it("400 si le corps n'est pas un objet", async () => {
    for (const c of [null, "x", 3, [], undefined]) {
      expect(await traiterVote(c, "1.1.1.1", undefined, limiteurs())).toEqual({ ok: false, status: 400, erreur: "Requête invalide." });
    }
  });
  it("400 pour chaque champ invalide", async () => {
    const l = limiteurs();
    expect(await traiterVote({ choix: "a" }, "1.1.1.1", undefined, l)).toMatchObject({ status: 400, erreur: "Personnage inconnu : choisis-en un dans la liste." });
    expect(await traiterVote({ votant: "Zorglub", choix: "a" }, "1.1.1.1", undefined, l)).toMatchObject({ status: 400 });
    expect(await traiterVote({ votant: "Gab", choix: "z" }, "1.1.1.1", undefined, l)).toMatchObject({ status: 400, erreur: "Choix invalide." });
    expect(await traiterVote({ votant: "Gab", choix: "a", jour: "2026-02-30" }, "1.1.1.1", undefined, l)).toMatchObject({ status: 400, erreur: "Date invalide." });
    expect(db.voterDilemme).not.toHaveBeenCalled();
  });
  it("409 pour un duel clos (jour différent d'aujourd'hui), sans rien écrire", async () => {
    for (const jour of ["2026-11-10", "2026-11-12"]) {
      expect(await traiterVote({ ...corps, jour }, "1.1.1.1", undefined, limiteurs())).toEqual({
        ok: false, status: 409, code: "clos", erreur: "Ce duel est terminé, rendez-vous demain.",
      });
    }
    expect(db.voterDilemme).not.toHaveBeenCalled();
    expect(base.etat.duels.size).toBe(0);
  });
  it("409 quand minuit est passé entre l'ouverture de la page et le vote", async () => {
    vi.setSystemTime(new Date("2026-11-11T23:30:00Z")); // 00 h 30 le 12 à Paris
    const r = await traiterVote({ ...corps, jour: AUJOURDHUI }, "1.1.1.1", undefined, limiteurs());
    expect(r).toMatchObject({ ok: false, status: 409, code: "clos" });
  });
  it("429 quand l'IP a épuisé son quota", async () => {
    const l = limiteurs(2, 100);
    await traiterVote(corps, "9.9.9.9", undefined, l);
    await traiterVote(corps, "9.9.9.9", undefined, l);
    expect(await traiterVote(corps, "9.9.9.9", undefined, l)).toEqual({
      ok: false, status: 429, code: "limite", erreur: "Trop de votes d'un coup, reprends ton souffle.",
    });
    expect(await traiterVote(corps, "8.8.8.8", undefined, l)).toMatchObject({ ok: true });
  });
  it("429 quand le votant a épuisé son quota", async () => {
    const l = limiteurs(100, 2);
    await traiterVote(corps, "1.1.1.1", undefined, l);
    await traiterVote(corps, "1.1.1.2", undefined, l);
    expect(await traiterVote(corps, "1.1.1.3", undefined, l)).toMatchObject({ status: 429, code: "limite" });
    expect(await traiterVote({ votant: "Gab", choix: "a" }, "1.1.1.3", undefined, l)).toMatchObject({ ok: true });
  });
  it("404 vivier quand il n'y a pas assez de plats", async () => {
    base.etat.lignes = [];
    expect(await traiterVote(corps, "1.1.1.1", undefined, limiteurs())).toMatchObject({ ok: false, status: 404, code: "vivier" });
    expect(db.voterDilemme).not.toHaveBeenCalled();
  });
  it("503 si la base est coupée", async () => {
    base.etat.panne = true;
    expect(await traiterVote(corps, "1.1.1.1", undefined, limiteurs())).toEqual({
      ok: false, status: 503, erreur: "Vote indisponible pour le moment.",
    });
  });
  it("503 aussi si la relecture échoue après l'écriture", async () => {
    base.etat.panneVotes = true;
    expect(await traiterVote(corps, "1.1.1.1", undefined, limiteurs())).toMatchObject({ status: 503, erreur: "Vote indisponible pour le moment." });
  });

  describe("ordre des contrôles", () => {
    it("corps invalide avant le honeypot, honeypot avant la limite IP", async () => {
      expect(await traiterVote("x", "1.1.1.1", undefined, limiteurs(0, 0))).toMatchObject({ status: 400 });
      expect(await traiterVote({ website: "x" }, "1.1.1.1", undefined, limiteurs(0, 0))).toEqual({ ok: true, factice: true });
    });
    it("limite IP avant la validation", async () => {
      expect(await traiterVote({ votant: "Zorglub" }, "1.1.1.1", undefined, limiteurs(0, 100))).toMatchObject({ status: 429 });
    });
    it("validation avant le 409", async () => {
      expect(await traiterVote({ votant: "Zorglub", choix: "a", jour: "2026-11-01" }, "1.1.1.1", undefined, limiteurs())).toMatchObject({ status: 400 });
    });
    it("409 avant la limite du votant", async () => {
      expect(await traiterVote({ ...corps, jour: "2026-11-01" }, "1.1.1.1", undefined, limiteurs(100, 0))).toMatchObject({ status: 409 });
    });
    it("limite du votant avant la base", async () => {
      expect(await traiterVote(corps, "1.1.1.1", undefined, limiteurs(100, 0))).toMatchObject({ status: 429 });
      expect(db.getDilemme).not.toHaveBeenCalled();
    });
  });
});

describe("GET /api/dilemme", () => {
  it("renvoie l'état en no-store", async () => {
    const res = await GET(new Request("http://localhost/api/dilemme"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json).toMatchObject({ jour: AUJOURDHUI, ouvert: true, voix: { a: 0, b: 0 }, monVote: null });
  });
  it("transmet jour et votant", async () => {
    base.etat.duels.set("2026-11-05", ligneDuel("2026-11-05"));
    base.etat.votes.set("2026-11-05", new Map([["Gab", { choix: "b", n: 1 }]]));
    const res = await GET(new Request("http://localhost/api/dilemme?jour=2026-11-05&votant=gab"));
    expect(await res.json()).toMatchObject({ jour: "2026-11-05", ouvert: false, monVote: "b" });
  });
  it("renvoie l'erreur, son code et son statut", async () => {
    const mauvais = await GET(new Request("http://localhost/api/dilemme?jour=nimporte"));
    expect(mauvais.status).toBe(400);
    expect(await mauvais.json()).toEqual({ erreur: "Date invalide." });
    base.etat.lignes = [];
    const vide = await GET(new Request("http://localhost/api/dilemme"));
    expect(vide.status).toBe(404);
    expect(await vide.json()).toEqual({ erreur: "Pas encore assez de plats pour lancer un duel. Reviens demain !", code: "vivier" });
    expect(vide.headers.get("Cache-Control")).toBe("no-store");
  });
  it("503 si la base est coupée", async () => {
    base.etat.panne = true;
    expect((await GET(new Request("http://localhost/api/dilemme"))).status).toBe(503);
  });
});

describe("POST /api/dilemme/vote", () => {
  it("vote et renvoie l'état", async () => {
    const res = await POST(requete({ votant: "Nova", choix: "b" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ monVote: "b", voix: { a: 0, b: 1 } });
  });
  it("répond { ok: true } au honeypot sans toucher à la base", async () => {
    const res = await POST(requete({ votant: "Nova", choix: "b", website: "spam" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.voterDilemme).not.toHaveBeenCalled();
  });
  it("400 pour du JSON invalide ou vide", async () => {
    expect((await POST(requete("{pas du json", true))).status).toBe(400);
    expect((await POST(requete("", true))).status).toBe(400);
  });
  it("400 au-delà de 1 Ko", async () => {
    const res = await POST(requete({ votant: "Nova", choix: "b", bourrage: "x".repeat(2000) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erreur: "Requête invalide." });
  });
  it("409 pour un duel clos, avec son code", async () => {
    const res = await POST(requete({ votant: "Nova", choix: "b", jour: "2026-11-01" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ erreur: "Ce duel est terminé, rendez-vous demain.", code: "clos" });
  });
  it("400 pour un personnage inconnu", async () => {
    const res = await POST(requete({ votant: "Zorglub", choix: "b" }));
    expect(res.status).toBe(400);
  });
});
