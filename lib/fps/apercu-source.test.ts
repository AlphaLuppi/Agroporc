import { describe, expect, it } from "vitest";
import { APERCU, SuiviSource, choisirSource, directAffichable, estimerDecalageServeur, libelleBandeau, type ApercuDirect, type JoueurAerien } from "./apercu-source";

const jo = (id: string): JoueurAerien => ({ id, pseudo: id, couleur: "#fff000", p: [0, 0, 0] });
const direct = (plus: Partial<ApercuDirect> = {}): ApercuDirect => ({ mode: "zombies", joueurs: [jo("a")], tigres: [], recuT: 10_000, decalageServeurMs: 0, ...plus });
const base = { modeAffiche: "zombies", modeConfirme: "zombies", connecte: true, maintenant: 11_000 } as const;

describe("choisirSource", () => {
  it("direct : connecté, mode confirmé, récent, avec au moins un joueur", () => {
    expect(choisirSource({ ...base, direct: direct() })).toBe("direct");
  });
  it("direct avec seulement des tigres", () => {
    expect(choisirSource({ ...base, direct: direct({ joueurs: [], tigres: [{ id: 1, x: 0, z: 0, cap: 0, type: 0, mode: "chasse", pvPct: 100 }] }) })).toBe("direct");
  });
  it("Battle Royale en vol, personne n'a encore sauté : le direct dès que l'aperçu porte la zone ou l'avion", () => {
    const base_br = { ...base, modeAffiche: "br", modeConfirme: "br" } as const;
    const avion = { depart: [0, 0], arrivee: [100, 0], altitude: 300, vitesse: 50, debutT: 0, finT: 1000 } as NonNullable<ApercuDirect["avion"]>;
    const zone = { palier: 0 } as NonNullable<ApercuDirect["zone"]>;
    expect(choisirSource({ ...base_br, direct: direct({ mode: "br", joueurs: [], avion }) })).toBe("direct");
    expect(choisirSource({ ...base_br, direct: direct({ mode: "br", joueurs: [], zone }) })).toBe("direct");
    // lobby : ni zone ni avion, ni joueur visible
    expect(choisirSource({ ...base_br, direct: direct({ mode: "br", joueurs: [], avion: null, zone: null }) })).toBe("simulation");
    // la règle ne vaut que pour le Battle Royale
    expect(choisirSource({ ...base, direct: direct({ joueurs: [], avion }) })).toBe("simulation");
  });
  it("simulation : mode non confirmé, périmé, vide, déconnecté, sans aperçu ou aperçu d'un autre mode", () => {
    expect(choisirSource({ ...base, modeConfirme: "arene", direct: direct() })).toBe("simulation");
    expect(choisirSource({ ...base, maintenant: 10_000 + APERCU.perimeMs + 1, direct: direct() })).toBe("simulation");
    expect(choisirSource({ ...base, direct: direct({ joueurs: [] }) })).toBe("simulation");
    expect(choisirSource({ ...base, connecte: false, direct: direct() })).toBe("simulation");
    expect(choisirSource({ ...base, direct: null })).toBe("simulation");
    expect(choisirSource({ ...base, direct: direct({ mode: "br" }) })).toBe("simulation");
  });
  it("tout juste dans la péremption", () => {
    expect(choisirSource({ ...base, maintenant: 10_000 + APERCU.perimeMs, direct: direct() })).toBe("direct");
  });
});

describe("directAffichable", () => {
  it("frais et du bon mode : oui ; périmé pendant l'hystérésis, autre mode, simulation ou rien : non", () => {
    const d = direct();
    expect(directAffichable("direct", d, "zombies", 10_000 + APERCU.perimeMs)).toBe(true);
    expect(directAffichable("direct", d, "zombies", 10_000 + APERCU.perimeMs + 1)).toBe(false);
    expect(directAffichable("direct", d, "br", 10_500)).toBe(false);
    expect(directAffichable("simulation", d, "zombies", 10_500)).toBe(false);
    expect(directAffichable("direct", null, "zombies", 10_500)).toBe(false);
  });
});

describe("SuiviSource", () => {
  it("passe tout de suite au direct, ne revient à la simulation qu'après 4 s sans direct", () => {
    const s = new SuiviSource();
    expect(s.maj("simulation", 0)).toBe("simulation");
    expect(s.maj("direct", 1000)).toBe("direct");
    expect(s.maj("simulation", 2000)).toBe("direct");
    expect(s.maj("simulation", 2000 + APERCU.retourSimulationMs - 1)).toBe("direct");
    expect(s.maj("simulation", 2000 + APERCU.retourSimulationMs)).toBe("simulation");
  });
  it("un paquet de direct remet le compteur à zéro", () => {
    const s = new SuiviSource();
    s.maj("direct", 0);
    s.maj("simulation", 1000);
    s.maj("direct", 4000);
    expect(s.maj("simulation", 5000)).toBe("direct");
    expect(s.maj("simulation", 9100)).toBe("simulation");
  });
});

describe("libelleBandeau", () => {
  it("simulation par mode", () => {
    expect(libelleBandeau("simulation", "arene", { joueurs: 9, tigres: 0 })).toEqual({ etat: "simulation", mode: "arene", titre: "Match à mort", detail: "9 agents fictifs" });
    expect(libelleBandeau("simulation", "zombies", { joueurs: 1, tigres: 5, manche: 2 }).detail).toBe("manche 2 · 1 survivant fictif · 5 tigres");
    expect(libelleBandeau("simulation", "br", { joueurs: 20, tigres: 0, vivants: 18, total: 22, palier: 2, nbPaliers: 6 }).detail).toBe("18 en vie sur 22 · zone 2/6");
  });
  it("direct par mode", () => {
    expect(libelleBandeau("direct", "arene", { joueurs: 1, tigres: 0 })).toEqual({ etat: "direct", mode: "arene", titre: "Match à mort", detail: "1 joueur en jeu" });
    expect(libelleBandeau("direct", "zombies", { joueurs: 3, tigres: 14, manche: 4 }).detail).toBe("manche 4 · 3 survivants · 14 tigres");
    expect(libelleBandeau("direct", "br", { joueurs: 5, tigres: 0, vivants: 23, total: 31, palier: 3, nbPaliers: 6, partie: "br2" }).detail).toBe("23 en vie sur 31 · zone 3/6 · partie br2");
  });
  it("le bandeau porte le mode dont il parle", () => {
    expect(libelleBandeau("simulation", "br", { joueurs: 1, tigres: 0 }).mode).toBe("br");
    expect(libelleBandeau("direct", "zombies", { joueurs: 1, tigres: 0 }).mode).toBe("zombies");
    expect(libelleBandeau("simulation", "zombies", { joueurs: 1, tigres: 0, partieEnCours: true }).mode).toBe("zombies");
  });
  it("partie en cours sans direct : l'honnêteté d'un ancien serveur", () => {
    const b = libelleBandeau("simulation", "zombies", { joueurs: 2, tigres: 0, partieEnCours: true });
    expect(b.etat).toBe("simulation");
    expect(b.detail).toContain("aperçu en direct indisponible");
  });
});

it("estimerDecalageServeur", () => {
  expect(estimerDecalageServeur(5000, 4200)).toBe(800);
});
