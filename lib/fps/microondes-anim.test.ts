import { describe, expect, it } from "vitest";
import { ALARME_MS, FERMETURE_PORTE_MS, OUVERTURE_PORTE_MS, SORTIE_ARME_MS, imageMicroondes } from "./microondes-anim";
import { PACK_A_PUNCH } from "./zombies-carte";

/** Micro-ondes Gratinator : ce que le rendu dessine à chaque instant du dépôt, de la cuisson et de la reprise (déroulé de BO1). */

const T = 100_000;
const cuisson = { etat: "cuisson" as const, joueur: "a", arme: "pistolet" as const, debutT: T, finT: T + PACK_A_PUNCH.cuissonMs };
const pret = { etat: "pret" as const, joueur: "a", arme: "pistolet" as const, debutT: T, finT: T + PACK_A_PUNCH.cuissonMs + PACK_A_PUNCH.repriseMs };
const debutPret = T + PACK_A_PUNCH.cuissonMs;

describe("Micro-ondes Gratinator", () => {
  it("libre : porte fermée, rien dedans ; sous tension, lumière faible et afficheur allumé ; éteint sans courant", () => {
    expect(imageMicroondes({ etat: "libre" }, T, true)).toMatchObject({ porte: 0, arme: false, plateau: false, affichage: "GRATINATOR" });
    expect(imageMicroondes({ etat: "libre" }, T, false)).toMatchObject({ lumiere: 0, affichage: "" });
  });

  it("dépôt : l'arme entre porte ouverte (de la porte vers le centre), puis la porte se ferme", () => {
    const a = imageMicroondes(cuisson, T + 10, true);
    expect(a).toMatchObject({ porte: 1, arme: true, gratinee: false, plateau: false });
    expect(a.avance).toBeGreaterThan(0.9);
    const b = imageMicroondes(cuisson, T + PACK_A_PUNCH.entreeMs - 10, true);
    expect(b.avance).toBeLessThan(0.05);
    const c = imageMicroondes(cuisson, T + PACK_A_PUNCH.entreeMs + FERMETURE_PORTE_MS / 2, true);
    expect(c.porte).toBeCloseTo(0.5, 5);
  });

  it("cuisson : porte fermée, plateau qui tourne, lumière orange forte, étincelles, compte à rebours", () => {
    const k = imageMicroondes(cuisson, T + PACK_A_PUNCH.entreeMs + FERMETURE_PORTE_MS + 100, true);
    expect(k).toMatchObject({ porte: 0, arme: true, plateau: true, etincelles: true, avance: 0 });
    expect(k.lumiere).toBeGreaterThan(0.8);
    expect(imageMicroondes(cuisson, T + PACK_A_PUNCH.cuissonMs - 1500, true).affichage).toBe("0:02");
  });

  it("prête : la porte s'ouvre, l'arme gratinée sort vers le joueur puis recule lentement ; alarme les 5 dernières secondes ; disparue à la fin", () => {
    expect(imageMicroondes(pret, debutPret + OUVERTURE_PORTE_MS / 2, true).porte).toBeCloseTo(0.5, 5);
    const sortie = imageMicroondes(pret, debutPret + SORTIE_ARME_MS, true);
    expect(sortie).toMatchObject({ porte: 1, arme: true, gratinee: true, plateau: false, affichage: "PRÊT", alarme: false });
    expect(sortie.avance).toBeCloseTo(1, 5);
    const milieu = imageMicroondes(pret, debutPret + PACK_A_PUNCH.repriseMs / 2, true);
    expect(milieu.avance).toBeLessThan(sortie.avance);
    expect(milieu.avance).toBeGreaterThan(0.1);
    expect(imageMicroondes(pret, pret.finT - ALARME_MS + 1, true).alarme).toBe(true);
    expect(imageMicroondes(pret, pret.finT, true).arme).toBe(false);
  });
});
