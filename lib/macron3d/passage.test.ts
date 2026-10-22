import { describe, it, expect } from "vitest";
import { planPassage, gaucheCanvas, hauteurCoureurPx, bulleVisible, avancement, passageFini, replanifier, BULLE } from "./passage";
import { REGLAGES } from "./course";

describe("passage du coureur", () => {
  const ecrans = [
    { largeur: 1440, hauteur: 900 },
    { largeur: 1280, hauteur: 720 },
    { largeur: 390, hauteur: 844 },
    { largeur: 360, hauteur: 640 },
  ];

  it("taille adaptée à l'écran, mobile compris (jamais énorme ni minuscule)", () => {
    for (const e of ecrans) {
      const h = hauteurCoureurPx(e);
      expect(h).toBeGreaterThanOrEqual(110);
      expect(h).toBeLessThanOrEqual(230);
      expect(h).toBeLessThan(e.hauteur * 0.3);
      expect(planPassage(e, 1).largeurCanvas).toBeLessThan(Math.max(e.largeur, 300));
    }
  });

  it("entre et sort hors écran, dans les deux sens (aucun « pop »)", () => {
    for (const e of ecrans) for (const sens of [1, -1] as const) {
      const p = planPassage(e, sens);
      const g0 = gaucheCanvas(p, 0), g1 = gaucheCanvas(p, p.avanceTotale);
      // Au départ comme à l'arrivée, le canvas ne touche pas l'écran.
      expect(g0 + p.largeurCanvas <= 0 || g0 >= e.largeur).toBe(true);
      expect(g1 + p.largeurCanvas <= 0.5 || g1 >= e.largeur - 0.5).toBe(true);
      // Et il va du bon côté.
      expect(Math.sign(g1 - g0)).toBe(sens);
    }
  });

  it("traverse en quelques secondes à vitesse de course", () => {
    const p = planPassage({ largeur: 1440, hauteur: 900 }, 1);
    const duree = p.avanceTotale / REGLAGES.vitesse;
    expect(duree).toBeGreaterThan(3);
    expect(duree).toBeLessThan(10);
    const m = planPassage({ largeur: 390, hauteur: 844 }, -1);
    expect(m.avanceTotale / REGLAGES.vitesse).toBeGreaterThan(1.5);
  });

  it("une seule bulle, dans le premier tiers du trajet", () => {
    const p = planPassage({ largeur: 1280, hauteur: 800 }, 1);
    const vues = Array.from({ length: 101 }, (_, k) => bulleVisible(p, (k / 100) * p.avanceTotale));
    const debuts = vues.filter((v, k) => v && !vues[k - 1]).length;
    expect(debuts).toBe(1);
    expect(bulleVisible(p, 0)).toBe(false);
    expect(bulleVisible(p, p.avanceTotale)).toBe(false);
    expect(avancement(p, p.avanceTotale * 2)).toBe(1);
    expect(BULLE.texte).toBe("En marche !");
  });

  it("redimensionné en plein passage : même part du trajet, et il sort bien de l'écran (jamais de disparition en plein écran)", () => {
    const p = planPassage({ largeur: 390, hauteur: 844 }, 1);
    const avance = p.avanceTotale * 0.4;
    const q = replanifier(p, { largeur: 844, hauteur: 390 }, avance);
    expect(avancement(q, avance)).toBeCloseTo(0.4, 9);
    expect(passageFini(q, avance)).toBe(false);
    const fin = q.origine + q.avanceTotale;
    expect(passageFini(q, fin)).toBe(true);
    expect(gaucheCanvas(q, fin)).toBeGreaterThanOrEqual(844 - 0.5);
  });
});
