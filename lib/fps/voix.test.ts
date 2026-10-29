import { describe, expect, it } from "vitest";
import type { JoueurPublic } from "./protocole";
import {
  CLE_VOIX, LIEN_VOIX_KILLCAM_MS, LiensVoixKillcam, VOIX, cleLienVoix, correspondants, doitAppeler, ecrireReglagesVoix, gainVoix, lireReglagesVoix,
  ciblesVoixBr, microOuvert, planConnexions, relaiVoixBr, signalValide, type ParticipantVoixBr,
} from "./voix";

const j = (id: string, enJeu = true, voix = true): JoueurPublic => ({ id, pseudo: id, couleur: "#fff", enJeu, kills: 0, morts: 0, ping: 0, ...(voix ? { voix } : {}) });

describe("gainVoix", () => {
  it("plein de près, décroissant, muet au-delà de la portée", () => {
    expect(gainVoix(0)).toBe(1);
    expect(gainVoix(VOIX.distancePleine)).toBe(1);
    expect(gainVoix(10)).toBeLessThan(1);
    expect(gainVoix(10)).toBeGreaterThan(gainVoix(25));
    expect(gainVoix(VOIX.distanceMax)).toBe(0);
    expect(gainVoix(500)).toBe(0);
    expect(gainVoix(Number.NaN)).toBe(0);
  });
  it("un mort s'entend moins", () => {
    expect(gainVoix(2, false)).toBe(VOIX.facteurMort);
  });
});

describe("connexions", () => {
  it("le plus petit identifiant appelle", () => {
    expect(doitAppeler("j1", "j2")).toBe(true);
    expect(doitAppeler("j2", "j1")).toBe(false);
  });
  it("correspondants : en arène, voix activée, moi compris dans les conditions", () => {
    expect(correspondants("j1", [j("j1"), j("j2"), j("j3", false), j("j4", true, false)])).toEqual(["j2"]);
    expect(correspondants("j1", [j("j1", true, false), j("j2")])).toEqual([]);
    expect(correspondants("j1", [j("j1", false), j("j2")])).toEqual([]);
    expect(correspondants(null, [j("j2")])).toEqual([]);
  });
  it("plan : j'appelle ceux dont c'est à moi, je ferme ceux qui ne sont plus voulus", () => {
    expect(planConnexions("j2", ["j5"], ["j1", "j3", "j4"])).toEqual({ appeler: ["j3", "j4"], fermer: ["j5"] });
    expect(planConnexions("j2", ["j3"], ["j3"])).toEqual({ appeler: [], fermer: [] });
  });
});

describe("micro et signaux", () => {
  it("appuyer pour parler : micro ouvert seulement touche tenue", () => {
    expect(microOuvert("appuyer", false)).toBe(false);
    expect(microOuvert("appuyer", true)).toBe(true);
    expect(microOuvert("ouvert", false)).toBe(true);
  });
  it("forme des signaux", () => {
    expect(signalValide({ type: "fin" })).toBe(true);
    expect(signalValide({ type: "offre", sdp: "v=0" })).toBe(true);
    expect(signalValide({ type: "reponse", sdp: "" })).toBe(false);
    expect(signalValide({ type: "autre" })).toBe(false);
    expect(signalValide(null)).toBe(false);
  });
});

describe("réglages", () => {
  it("relus avec des valeurs par défaut sûres, écrits tels quels", () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(lireReglagesVoix(st)).toEqual({ actif: false, mode: "appuyer" });
    ecrireReglagesVoix({ actif: true, mode: "ouvert" }, st);
    expect(lireReglagesVoix(st)).toEqual({ actif: true, mode: "ouvert" });
    m.set(CLE_VOIX, "{abîmé");
    expect(lireReglagesVoix(st)).toEqual({ actif: false, mode: "appuyer" });
    expect(lireReglagesVoix(null)).toEqual({ actif: false, mode: "appuyer" });
  });
});

describe("liens vocaux de killcam", () => {
  it("la victime et le tueur sont liés, personne d'autre ; le lien expire", () => {
    const l = new LiensVoixKillcam();
    // un kill entre deux autres joueurs ne me lie à personne
    expect(l.surMort("moi", "x", "y", 0)).toBe(false);
    // suicide, mort sans tueur : rien
    expect(l.surMort("moi", "moi", "moi", 0)).toBe(false);
    expect(l.surMort("moi", "moi", "", 0)).toBe(false);
    // je meurs : lié au tueur ; je tue : lié à la victime
    expect(l.surMort("moi", "moi", "tueur", 1000)).toBe(true);
    expect(l.surMort("moi", "victime", "moi", 2000)).toBe(true);
    expect(l.actifs(1500)).toEqual(["tueur", "victime"]);
    expect(l.actifs(1000 + LIEN_VOIX_KILLCAM_MS)).toEqual(["victime"]);
    expect(l.actifs(2000 + LIEN_VOIX_KILLCAM_MS)).toEqual([]);
    expect(l.surMort(null, "moi", "tueur", 0)).toBe(false);
  });

  it("la clé est la même dans les deux sens", () => {
    expect(cleLienVoix("a", "b")).toBe(cleLienVoix("b", "a"));
    expect(cleLienVoix("a", "b")).not.toBe(cleLienVoix("a", "c"));
  });

  it("correspondants restreints (Battle Royale) : seulement les liens, toujours avec la voix activée des deux côtés", () => {
    const tous = [j("a"), j("b"), j("c"), j("d", true, false)];
    expect(correspondants("a", tous)).toEqual(["b", "c"]);
    expect(correspondants("a", tous, new Set(["c", "d"]))).toEqual(["c"]);
    expect(correspondants("a", tous, new Set())).toEqual([]);
    expect(correspondants("a", tous, null)).toEqual(["b", "c"]);
  });
});

describe("rayon du chat vocal (élargi le 2026-10-29)", () => {
  it("on s'entend nettement à 30 m et encore un peu à 60 m ; muet au-delà de 75 m", () => {
    expect(VOIX.distanceMax).toBe(75);
    expect(gainVoix(8)).toBe(1);
    expect(gainVoix(30)).toBeGreaterThan(0.5);
    expect(gainVoix(60)).toBeGreaterThan(0.1);
    expect(gainVoix(75)).toBe(0);
  });
});

describe("planConnexions avec des connexions admises", () => {
  it("une connexion admise (l'autre m'a appelé) n'est pas fermée ; une connexion ni voulue ni admise l'est", () => {
    expect(planConnexions("j2", ["j7", "j9"], ["j3"], ["j3", "j7"])).toEqual({ appeler: ["j3"], fermer: ["j9"] });
  });
});

describe("chat vocal du Battle Royale", () => {
  const vivant = (id: string, x: number, voix = true): ParticipantVoixBr => ({ id, voix, spectateur: false, p: [x, 1.6, 0] });
  const spect = (id: string, voix = true): ParticipantVoixBr => ({ id, voix, spectateur: true, p: null });

  it("en vie : seulement les vivants proches avec la voix, les plus proches d'abord, jamais un spectateur", () => {
    const moi = vivant("m", 0);
    const autres = [vivant("a", 10), vivant("b", 80), vivant("c", 100), vivant("d", 20, false), spect("s1"), { ...vivant("z", 5), p: null }];
    // b à 80 m (< 85) appelé, c à 100 m seulement admis s'il appelle, d sans voix, s1 spectateur, z sans position (à bord)
    expect(ciblesVoixBr(moi, autres, [])).toEqual({ voulus: ["a", "b"], admis: ["a", "b", "c"] });
    // hystérésis : une connexion établie tient jusqu'à 110 m
    expect(ciblesVoixBr(moi, autres, [], new Set(["c"])).voulus).toEqual(["a", "b", "c"]);
    expect(ciblesVoixBr(moi, [vivant("e", 120)], [], new Set(["e"]))).toEqual({ voulus: [], admis: [] });
  });

  it("en vie : au plus `voisinsMaxBr` voisins appelés, les plus proches", () => {
    const autres = Array.from({ length: 12 }, (_, i) => vivant(`v${String(i).padStart(2, "0")}`, 70 - i * 5));
    const c = ciblesVoixBr(vivant("m", 0), autres, []);
    expect(c.voulus).toHaveLength(VOIX.voisinsMaxBr);
    expect(c.voulus).not.toContain("v00"); // le plus loin (70 m)
    expect(c.admis).toHaveLength(12);
  });

  it("spectateur : les autres spectateurs seulement (plein canal), jamais un vivant ; le lien de killcam passe outre", () => {
    const autres = [vivant("a", 1), spect("s1"), spect("s2"), spect("s3", false)];
    expect(ciblesVoixBr(spect("m"), autres, [])).toEqual({ voulus: ["s1", "s2"], admis: ["s1", "s2"] });
    expect(ciblesVoixBr(spect("m"), autres, ["a"])).toEqual({ voulus: ["a", "s1", "s2"], admis: ["a", "s1", "s2"] });
    // un vivant lié à sa victime spectatrice
    expect(ciblesVoixBr(vivant("a", 0), [spect("m")], ["m"])).toEqual({ voulus: ["m"], admis: ["m"] });
    // au plus `spectateursMaxBr` appelés, tous admis
    const foule = Array.from({ length: 20 }, (_, i) => spect(`s${String(i).padStart(2, "0")}`));
    const c = ciblesVoixBr(spect("m"), foule, []);
    expect(c.voulus).toHaveLength(VOIX.spectateursMaxBr);
    expect(c.admis).toHaveLength(20);
  });

  it("voix coupée ou position inconnue (à bord) : rien, hors liens", () => {
    expect(ciblesVoixBr({ ...vivant("m", 0), voix: false }, [vivant("a", 1)], ["a"])).toEqual({ voulus: [], admis: [] });
    expect(ciblesVoixBr({ ...vivant("m", 0), p: null }, [vivant("a", 1)], [])).toEqual({ voulus: [], admis: [] });
  });

  it("relais du serveur : deux vivants ou deux spectateurs ; un vivant et un spectateur seulement par le lien de killcam", () => {
    const v = { enJeu: true, vivant: true }, s = { enJeu: true, vivant: false }, dehors = { enJeu: false, vivant: false };
    expect(relaiVoixBr(v, v, false)).toBe(true);
    expect(relaiVoixBr(s, s, false)).toBe(true);
    expect(relaiVoixBr(v, s, false)).toBe(false);
    expect(relaiVoixBr(s, v, false)).toBe(false);
    expect(relaiVoixBr(v, s, true)).toBe(true);
    expect(relaiVoixBr(dehors, dehors, false)).toBe(false);
    expect(relaiVoixBr(v, dehors, true)).toBe(false);
  });
});
