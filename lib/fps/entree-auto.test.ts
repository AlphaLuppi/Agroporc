import { describe, expect, it } from "vitest";
import { armerEntreeAuto, confirmerEntreeAuto, entreeApresContexte } from "./entree-auto";

const ctx = { areneOuverte: true, autrePanneau: false, connecte: true };
const conf = { enArene: false, mode: "arene", monId: "j1", areneOuverte: true };

describe("entrée automatique en arène", () => {
  it("confirmation du serveur panneau ouvert : le jeu se monte, une seule fois", () => {
    const e = armerEntreeAuto(true);
    const r = confirmerEntreeAuto(e, conf);
    expect(r.monter).toBe(true);
    expect(confirmerEntreeAuto(r.entree, conf).monter).toBe(false);
  });

  it("rien en attente : une confirmation (Rejoindre, Créer une arène) ne monte rien", () => {
    expect(confirmerEntreeAuto(null, conf)).toEqual({ entree: null, monter: false });
  });

  it("panneau fermé, plat ouvert ou connexion perdue : l'entrée en attente est abandonnée", () => {
    const e = armerEntreeAuto(true);
    expect(entreeApresContexte(e, ctx)).toBe(e);
    expect(entreeApresContexte(e, { ...ctx, areneOuverte: false })).toBeNull();
    expect(entreeApresContexte(e, { ...ctx, autrePanneau: true })).toBeNull();
    expect(entreeApresContexte(e, { ...ctx, connecte: false })).toBeNull();
    expect(entreeApresContexte(null, ctx)).toBeNull();
  });

  it("une confirmation qui arrive panneau fermé ne monte pas ; mode autre, déjà en jeu ou sans id non plus, mais l'attente est consommée", () => {
    const e = armerEntreeAuto(true);
    expect(confirmerEntreeAuto(e, { ...conf, areneOuverte: false })).toEqual({ entree: null, monter: false });
    expect(confirmerEntreeAuto(e, { ...conf, mode: "zombies" }).monter).toBe(false);
    expect(confirmerEntreeAuto(e, { ...conf, enArene: true }).monter).toBe(false);
    expect(confirmerEntreeAuto(e, { ...conf, monId: null }).monter).toBe(false);
  });

  it("entrée du crochet de développement (panneau fermé) : ne dépend pas du panneau", () => {
    const e = armerEntreeAuto(false);
    expect(entreeApresContexte(e, { ...ctx, areneOuverte: false })).toBe(e);
    expect(confirmerEntreeAuto(e, { ...conf, areneOuverte: false }).monter).toBe(true);
    expect(entreeApresContexte(e, { ...ctx, areneOuverte: false, connecte: false })).toBeNull();
  });
});
