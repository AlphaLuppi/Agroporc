/**
 * Persistance fichier des stats du Battle Royale (`serveur-fps/src/stats-br.ts`) : fichier absent, JSON corrompu renommé, écriture atomique
 * asynchrone sérialisée, flush synchrone à l'arrêt, échec disque sans exception. Dossiers temporaires réels, nettoyés après chaque test.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creerPersistanceBr } from "../../serveur-fps/src/stats-br";
import type { ResultatPartieBr } from "./br-stats";

let dossier = "";
beforeEach(() => { dossier = mkdtempSync(join(tmpdir(), "pdj-stats-br-")); });
afterEach(() => { vi.restoreAllMocks(); rmSync(dossier, { recursive: true, force: true }); });

const partie = (t: number, lignes: ResultatPartieBr["lignes"]): ResultatPartieBr => ({ t, lignes });
const lireFichier = (f: string) => JSON.parse(readFileSync(f, "utf8")) as { version: number; joueurs: Record<string, { top1: number; parties: number; kills: number }> };

describe("creerPersistanceBr", () => {
  it("fichier absent : départ à vide, dossier créé, rien d'écrit avant la première partie", () => {
    const fichier = join(dossier, "donnees", "stats-br.json");
    const p = creerPersistanceBr(fichier);
    expect(p.lire()).toEqual({ version: 1, joueurs: {} });
    expect(existsSync(join(dossier, "donnees"))).toBe(true);
    expect(existsSync(fichier)).toBe(false);
  });

  it("enregistrer met à jour la mémoire tout de suite et écrit le fichier en asynchrone", async () => {
    const fichier = join(dossier, "stats-br.json");
    const p = creerPersistanceBr(fichier);
    const apres = p.enregistrer(partie(1000, [{ pseudo: "Alice", place: 1, kills: 3 }, { pseudo: "Bob", place: 2, kills: 0 }]));
    expect(apres.joueurs.alice).toMatchObject({ top1: 1, parties: 1, kills: 3, pseudo: "Alice" });
    expect(p.lire()).toBe(apres);
    await p.vider();
    expect(lireFichier(fichier).joueurs.alice).toMatchObject({ top1: 1, parties: 1, kills: 3 });
    // une nouvelle instance relit ce qui a été écrit
    expect(creerPersistanceBr(fichier).lire().joueurs.bob).toMatchObject({ top1: 0, parties: 1, meilleurePlace: 2 });
  });

  it("écritures sérialisées : plusieurs parties d'affilée, un seul fichier final complet, aucun temporaire", async () => {
    const fichier = join(dossier, "stats-br.json");
    const p = creerPersistanceBr(fichier);
    for (let i = 1; i <= 6; i++) p.enregistrer(partie(i, [{ pseudo: "Alice", place: i === 6 ? 1 : 2, kills: 1 }]));
    await p.vider();
    expect(lireFichier(fichier).joueurs.alice).toMatchObject({ top1: 1, parties: 6, kills: 6 });
    expect(readdirSync(dossier)).toEqual(["stats-br.json"]);
  });

  it("les pseudos Agent ne sont pas enregistrés", async () => {
    const fichier = join(dossier, "stats-br.json");
    const p = creerPersistanceBr(fichier);
    p.enregistrer(partie(1, [{ pseudo: "Agent", place: 1, kills: 5 }, { pseudo: "Agent2", place: 2, kills: 0 }]));
    await p.vider();
    expect(lireFichier(fichier).joueurs).toEqual({});
  });

  it("JSON corrompu : renommé en .corrompu-<horodatage> (contenu conservé), départ à vide, puis fichier neuf", async () => {
    const fichier = join(dossier, "stats-br.json");
    writeFileSync(fichier, "{ \"version\": 1, \"joueurs\": {");
    const p = creerPersistanceBr(fichier);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(p.lire().joueurs).toEqual({});
    const corrompus = readdirSync(dossier).filter((n) => /^stats-br\.json\.corrompu-\d+$/.test(n));
    expect(corrompus).toHaveLength(1);
    expect(readFileSync(join(dossier, corrompus[0]), "utf8")).toBe("{ \"version\": 1, \"joueurs\": {");
    expect(existsSync(fichier)).toBe(false);
    p.enregistrer(partie(2, [{ pseudo: "Cora", place: 1, kills: 1 }]));
    await p.vider();
    expect(lireFichier(fichier).joueurs.cora.top1).toBe(1);
  });

  it("JSON valide mais de structure absurde : mis de côté aussi", () => {
    const fichier = join(dossier, "stats-br.json");
    writeFileSync(fichier, "[1, 2, 3]");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const p = creerPersistanceBr(fichier);
    expect(p.lire().joueurs).toEqual({});
    expect(readdirSync(dossier).some((n) => n.includes(".corrompu-"))).toBe(true);
  });

  it("fichier valide : relu, entrées abîmées réparées ou ignorées sans exception", () => {
    const fichier = join(dossier, "stats-br.json");
    writeFileSync(fichier, JSON.stringify({
      version: 1,
      joueurs: {
        alice: { cle: "alice", pseudo: "Alice", top1: 4, parties: 9, kills: 20, meilleurePlace: 1, derniereT: 5 },
        casse: { pseudo: "Casse", top1: "beaucoup", parties: -3 },
        louche: 12,
      },
    }));
    const p = creerPersistanceBr(fichier);
    expect(p.lire().joueurs.alice).toMatchObject({ top1: 4, parties: 9, kills: 20 });
    expect(p.lire().joueurs.casse).toMatchObject({ top1: 0, parties: 0 });
    expect(p.lire().joueurs.louche).toBeUndefined();
    expect(readdirSync(dossier)).toEqual(["stats-br.json"]);
  });

  it("arreter() écrit en synchrone ce qui n'est pas encore sur disque, et rien de plus ancien ne le remplace ensuite", async () => {
    const fichier = join(dossier, "stats-br.json");
    const p = creerPersistanceBr(fichier);
    p.enregistrer(partie(1, [{ pseudo: "Alice", place: 1, kills: 2 }]));
    p.enregistrer(partie(2, [{ pseudo: "Alice", place: 1, kills: 2 }]));
    p.arreter();
    // sans attendre la moindre promesse : le fichier est déjà là, complet
    expect(lireFichier(fichier).joueurs.alice).toMatchObject({ top1: 2, parties: 2, kills: 4 });
    await p.vider();
    expect(lireFichier(fichier).joueurs.alice).toMatchObject({ top1: 2, parties: 2 });
    expect(readdirSync(dossier)).toEqual(["stats-br.json"]);
  });

  it("après arreter(), une partie enregistrée encore (départ pendant l'arrêt) est écrite tout de suite", () => {
    const fichier = join(dossier, "stats-br.json");
    const p = creerPersistanceBr(fichier);
    p.arreter();
    expect(existsSync(fichier)).toBe(false);
    p.enregistrer(partie(3, [{ pseudo: "Bob", place: 1, kills: 0 }]));
    expect(lireFichier(fichier).joueurs.bob.top1).toBe(1);
  });

  it("figer() : une partie « terminée » par les abandons en chaîne de l'arrêt n'est ni comptée ni écrite", () => {
    const fichier = join(dossier, "stats-br.json");
    const p = creerPersistanceBr(fichier);
    p.enregistrer(partie(1, [{ pseudo: "Alice", place: 1, kills: 1 }]));
    p.figer();
    const apres = p.enregistrer(partie(2, [{ pseudo: "Alice", place: 1, kills: 9 }, { pseudo: "Bob", place: 2, kills: 0 }]));
    expect(apres.joueurs.alice).toMatchObject({ parties: 1, kills: 1 });
    expect(apres.joueurs.bob).toBeUndefined();
    p.arreter();
    expect(lireFichier(fichier).joueurs.alice).toMatchObject({ parties: 1, kills: 1 });
    expect(lireFichier(fichier).joueurs.bob).toBeUndefined();
    // même après l'arrêt : toujours rien
    p.enregistrer(partie(3, [{ pseudo: "Cora", place: 1, kills: 0 }]));
    expect(lireFichier(fichier).joueurs.cora).toBeUndefined();
  });

  it("arreter() sans rien de nouveau n'écrit rien", () => {
    const fichier = join(dossier, "stats-br.json");
    creerPersistanceBr(fichier).arreter();
    expect(existsSync(fichier)).toBe(false);
  });

  it("échec disque : journalisé, jamais propagé, stats gardées en mémoire et réécrites à la partie suivante", async () => {
    const erreurs = vi.spyOn(console, "error").mockImplementation(() => {});
    const sous = join(dossier, "sous");
    const fichier = join(sous, "stats-br.json");
    const p = creerPersistanceBr(fichier);
    // le dossier devient un fichier ordinaire : ni mkdir ni open ne peuvent réussir
    rmSync(sous, { recursive: true });
    writeFileSync(sous, "je ne suis pas un dossier");
    expect(() => p.enregistrer(partie(1, [{ pseudo: "Alice", place: 1, kills: 1 }]))).not.toThrow();
    await expect(p.vider()).resolves.toBeUndefined();
    expect(erreurs).toHaveBeenCalled();
    expect(p.lire().joueurs.alice.parties).toBe(1);
    // le disque redevient disponible : la partie suivante écrit tout l'ensemble
    rmSync(sous);
    mkdirSync(sous);
    p.enregistrer(partie(2, [{ pseudo: "Alice", place: 2, kills: 1 }]));
    await p.vider();
    expect(lireFichier(fichier).joueurs.alice).toMatchObject({ top1: 1, parties: 2, kills: 2 });
    expect(readdirSync(sous)).toEqual(["stats-br.json"]);
  });
});

describe("routage de serveur-fps/src/index.ts (briques pures)", () => {
  it("le serveur accepte les clients v7 (arène, zombies) et v8, rien d'autre", async () => {
    const { VERSIONS_ACCEPTEES, VERSION_PROTOCOLE } = await import("./protocole");
    expect(VERSIONS_ACCEPTEES).toContain(7);
    expect(VERSIONS_ACCEPTEES).toContain(VERSION_PROTOCOLE);
    expect(VERSIONS_ACCEPTEES.includes(6)).toBe(false);
  });

  it("modeDeSalle retrouve le mode d'un client par la salle de la table SALLES (BR jamais pris pour l'arène)", async () => {
    const { modeDeSalle } = await import("./salons");
    const SALLES = { arene: { n: "a" }, zombies: { n: "z" }, br: { n: "b" } };
    expect(modeDeSalle(SALLES.arene, SALLES)).toBe("arene");
    expect(modeDeSalle(SALLES.zombies, SALLES)).toBe("zombies");
    expect(modeDeSalle(SALLES.br, SALLES)).toBe("br");
  });
});
