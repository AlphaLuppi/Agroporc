import { describe, expect, it } from "vitest";
import type { JoueurPublic } from "./protocole";
import {
  CLE_VOIX, VOIX, correspondants, doitAppeler, ecrireReglagesVoix, gainVoix, lireReglagesVoix, microOuvert, planConnexions, signalValide,
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
