import { describe, expect, it } from "vitest";
import type { EtatBoite } from "./protocole";
import {
  boiteA, boitesPresentes, boitesSoldesRestantes, destinationsEnvol, ouvrirSoldes, pelucheTiree, prixBoite, soldesActives, soldesPermises,
} from "./zombies-boites";
import { NB_EMPLACEMENTS_BOITE, PRIX_BOITE, PRIX_BOITE_SOLDES } from "./zombies-carte";

/** Boîtes mystère et Happy hour (le Fire Sale de BO1) : règles pures partagées par le serveur et l'invite du client. */

const fermee = (emplacement: number, utilisations = 0): EtatBoite => ({ emplacement, etat: "fermee", finT: 0, utilisations });

describe("Happy hour (Fire Sale de BO1)", () => {
  it("une boîte temporaire à chaque emplacement libre ; relancé, les boîtes encore là sont gardées telles quelles", () => {
    const principale = fermee(1, 3);
    const s = ouvrirSoldes(principale, [], NB_EMPLACEMENTS_BOITE);
    expect(s.map((b) => b.emplacement).sort()).toEqual([0, 2, 3, 4]);
    expect(s.every((b) => b.etat === "fermee" && b.utilisations === 0)).toBe(true);
    // relance : la boîte 3 est en plein tirage, elle n'est pas remplacée ; aucune boîte en double
    const enCours: EtatBoite = { emplacement: 3, etat: "tirage", arme: "pompe", pour: "a", finT: 123, utilisations: 0 };
    const r = ouvrirSoldes(principale, [enCours, fermee(0)], NB_EMPLACEMENTS_BOITE);
    expect(r.map((b) => b.emplacement).sort()).toEqual([0, 2, 3, 4]);
    expect(r.find((b) => b.emplacement === 3)).toEqual(enCours);
  });

  it("10 $ partout pendant les 30 s, 950 $ ensuite", () => {
    expect(prixBoite(10_000, 9_999)).toBe(PRIX_BOITE_SOLDES);
    expect(prixBoite(10_000, 10_000)).toBe(PRIX_BOITE);
    expect(prixBoite(0, 5)).toBe(PRIX_BOITE);
    expect(PRIX_BOITE_SOLDES).toBe(10);
    expect(soldesActives(10_000, 9_999)).toBe(true);
    expect(soldesActives(0, 0)).toBe(false);
  });

  it("aucune peluche pendant le Happy hour, quels que soient les tirages (200 tirages au hasard)", () => {
    for (let k = 0; k < 200; k++) expect(pelucheTiree(4 + (k % 20), k % 3, (k * 37) % 100, true)).toBe(false);
  });

  it("à la fin, les boîtes temporaires refermées disparaissent ; celle en cours de tirage ou d'offre finit d'abord", () => {
    const tirage: EtatBoite = { emplacement: 2, etat: "tirage", arme: "pompe", pour: "a", finT: 5, utilisations: 0 };
    const offre: EtatBoite = { ...tirage, emplacement: 4, etat: "offre" };
    const liste = [fermee(0), tirage, fermee(3), offre];
    expect(boitesSoldesRestantes(liste, true)).toEqual(liste);
    expect(boitesSoldesRestantes(liste, false)).toEqual([tirage, offre]);
  });

  it("le bonus n'est offert qu'après le premier déménagement de la boîte, et jamais pendant un Happy hour", () => {
    expect(soldesPermises(0, 0, 1_000)).toBe(false);
    expect(soldesPermises(1, 0, 1_000)).toBe(true);
    expect(soldesPermises(3, 5_000, 1_000)).toBe(false);
    expect(soldesPermises(3, 5_000, 5_000)).toBe(true);
  });

  it("la boîte qui s'envole ne se pose ni chez elle ni sur une boîte temporaire occupée (une temporaire fermée cède sa place)", () => {
    const occupee: EtatBoite = { emplacement: 2, etat: "offre", arme: "pompe", pour: "a", finT: 5, utilisations: 0 };
    expect(destinationsEnvol(1, [], 5)).toEqual([0, 2, 3, 4]);
    expect(destinationsEnvol(1, [occupee, fermee(3)], 5)).toEqual([0, 3, 4]);
    // tout est occupé : repli sur tous les autres emplacements
    const tous = [0, 2, 3, 4].map((i) => ({ ...occupee, emplacement: i }));
    expect(destinationsEnvol(1, tous, 5)).toEqual([0, 2, 3, 4]);
  });

  it("boiteA / boitesPresentes : la principale d'abord, puis les temporaires ; null pour un emplacement vide", () => {
    const e = { boite: fermee(1), boitesSoldes: [fermee(0), fermee(4)] };
    expect(boitesPresentes(e).map((b) => b.emplacement)).toEqual([1, 0, 4]);
    expect(boiteA(e, 4)).toBe(e.boitesSoldes[1]);
    expect(boiteA(e, 1)).toBe(e.boite);
    expect(boiteA(e, 2)).toBeNull();
    expect(boitesPresentes({ boite: fermee(3) })).toHaveLength(1);
  });
});

describe("peluche hors Happy hour (BO1 `treasure_chest_think`)", () => {
  it("jamais avant 4 tirages ; 15 % de 4 à 7 ; certaine au 8ᵉ si la boîte n'a jamais bougé ; puis 30 % jusqu'au 12ᵉ et 50 %", () => {
    expect(pelucheTiree(3, 0, 0, false)).toBe(false);
    expect(pelucheTiree(4, 0, 14.9, false)).toBe(true);
    expect(pelucheTiree(7, 0, 15, false)).toBe(false);
    expect(pelucheTiree(8, 0, 99, false)).toBe(true);
    expect(pelucheTiree(8, 1, 29, false)).toBe(true);
    expect(pelucheTiree(12, 1, 30, false)).toBe(false);
    expect(pelucheTiree(13, 1, 49, false)).toBe(true);
    expect(pelucheTiree(13, 1, 50, false)).toBe(false);
  });
});
