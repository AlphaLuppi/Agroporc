import { describe, expect, it } from "vitest";
import scene from "../../public/agroparc/scene.json";
import type { SceneData } from "../agroparc3d/types";
import { lancerRayon } from "./collision";
import { STATS } from "./armes";
import { ARMES_PRINCIPALES_ZOMBIES, ARMES_SECONDAIRES_ZOMBIES } from "./protocole";
import { ACHATS, PORTES_PAYANTES, construireMondeZombies, distancePorte } from "./zombies-carte";

/** (v8) Armes des zombies à la craie : sur un vrai mur, des prix de BO1, munitions à moitié prix. */
const monde = construireMondeZombies(scene as unknown as SceneData);
const ZOMBIES_SEULEMENT = new Set<string>([...ARMES_PRINCIPALES_ZOMBIES, ...ARMES_SECONDAIRES_ZOMBIES]);

describe("(v8) armes des zombies au mur", () => {
  const murs = ACHATS.filter((a) => a.genre === "mur" && a.arme && ZOMBIES_SEULEMENT.has(a.arme));

  it("au moins quatre armes nouvelles à la craie, chacune une seule fois, dans des zones différentes", () => {
    expect(murs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(murs.map((a) => a.arme)).size).toBe(murs.length);
    expect(new Set(murs.map((a) => a.zone)).size).toBe(murs.length);
    // les armes miracles (Soufflerie, Grille-pain) et l'arbalète ne sortent que de la boîte (BO1)
    for (const a of ["soufflerie", "grille_pain", "brochette"]) expect(murs.some((m) => m.arme === a)).toBe(false);
  });

  it("chaque dessin est sur un mur : le mur est à ~1,1 m derrière le point d'achat, le long de la normale de la façade", () => {
    for (const a of murs) {
      const f = a.facade!;
      const s = lancerRayon(monde, [a.position[0], 1.2, a.position[1]], [-f.normale[0], 0, -f.normale[1]], 3);
      expect(s, a.id).toBeGreaterThan(0.6);
      expect(s, a.id).toBeLessThan(1.6);
    }
  });

  it("ni près d'une porte payante ni d'un autre achat (l'invite de l'arme ne doit pas être volée par la porte ou le disjoncteur)", () => {
    for (const a of murs) {
      for (const p of PORTES_PAYANTES) expect(distancePorte(p, a.position), `${a.id} / ${p.id}`).toBeGreaterThan(p.portee + 0.5);
      for (const b of ACHATS) if (b !== a) expect(Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]), `${a.id} / ${b.id}`).toBeGreaterThan(3);
    }
  });

  it("prix : arme de 750 à 1 500 $, munitions à moitié prix", () => {
    for (const a of murs) {
      expect(a.prix, a.id).toBeGreaterThanOrEqual(750);
      expect(a.prix, a.id).toBeLessThanOrEqual(1500);
      expect(a.prixMunitions, a.id).toBe(a.prix / 2);
      expect(STATS[a.arme as keyof typeof STATS].zombiesSeulement).toBe(true);
    }
  });
});

describe("(v10) distributeur du Bento", () => {
  it("sur un vrai mur du Labo, loin des portes payantes et des autres achats", () => {
    const a = ACHATS.find((x) => x.id === "atout:bento")!;
    expect(a).toMatchObject({ genre: "atout", atout: "bento", zone: "labo" });
    const f = a.facade!;
    const s = lancerRayon(monde, [a.position[0], 1.2, a.position[1]], [-f.normale[0], 0, -f.normale[1]], 3);
    expect(s).toBeGreaterThan(0.6);
    expect(s).toBeLessThan(1.6);
    for (const p of PORTES_PAYANTES) expect(distancePorte(p, a.position), p.id).toBeGreaterThan(p.portee + 0.5);
    for (const b of ACHATS) if (b !== a) expect(Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]), b.id).toBeGreaterThan(3);
  });
});
