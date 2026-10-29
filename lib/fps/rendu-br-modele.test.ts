import { describe, expect, it } from "vitest";
import { ARMES_PAR_RARETE } from "./br-butin";
import type { AvionBr, ObjetBr, ZoneBr } from "./protocole";
import {
  AVION_PERSISTANCE_MS, BUTIN_RENDU, COULEUR_RARETE, HAUTEUR_COLONNE, MUR_TEMPETE, RARETES_BR, anneauProchaineZone, avionVisible, cercleZone, couleurObjet,
  couleurRarete, defilementMur, echelleMur, echelleQuantite, flotteObjet, intensiteMur, objetsVisibles, rareteObjet,
} from "./rendu-br-modele";

const objet = (id: number, x: number, o: Partial<ObjetBr> = {}): ObjetBr => ({ id, genre: "bandage", ref: null, p: [x, 0, 0], ...o });

describe("rareté et couleur des objets", () => {
  it("quatre couleurs distinctes, une par rareté (gris, vert, bleu, ambre)", () => {
    const couleurs = RARETES_BR.map(couleurRarete);
    expect(new Set(couleurs).size).toBe(4);
    expect(COULEUR_RARETE.commun).toBe(0xaab4bd);
    expect(COULEUR_RARETE.peu_commun).toBe(0x5dff6a);
    expect(COULEUR_RARETE.rare).toBe(0x4aa8ff);
    expect(COULEUR_RARETE.legendaire).toBe(0xffb347);
  });

  it("une arme prend la rareté de la table du butin, pour chaque arme de la table", () => {
    for (const [rarete, armes] of Object.entries(ARMES_PAR_RARETE)) {
      for (const ref of armes) {
        expect(rareteObjet({ genre: "arme", ref })).toBe(rarete);
        expect(couleurObjet({ genre: "arme", ref })).toBe(COULEUR_RARETE[rarete as keyof typeof COULEUR_RARETE]);
      }
    }
  });

  it("munitions et bandage sont communs, la potion de bouclier peu commune, une arme sans référence commune", () => {
    expect(rareteObjet({ genre: "munitions", ref: "legeres" })).toBe("commun");
    expect(rareteObjet({ genre: "bandage", ref: null })).toBe("commun");
    expect(rareteObjet({ genre: "potion", ref: null })).toBe("peu_commun");
    expect(rareteObjet({ genre: "arme", ref: null })).toBe("commun");
  });

  it("la colonne est d'autant plus haute que la rareté l'est", () => {
    const h = RARETES_BR.map((r) => HAUTEUR_COLONNE[r]);
    for (let i = 1; i < h.length; i++) expect(h[i]).toBeGreaterThan(h[i - 1]);
  });

  it("la flottaison reste dans une plage étroite autour de 0,55 m et dépend de l'id", () => {
    for (let t = 0; t < 20; t += 0.37) {
      const f = flotteObjet(t, 3);
      expect(f).toBeGreaterThanOrEqual(0.47 - 1e-9);
      expect(f).toBeLessThanOrEqual(0.63 + 1e-9);
    }
    expect(flotteObjet(1, 1)).not.toBe(flotteObjet(1, 2));
  });

  it("une pile de soins lâchée est plus grosse, plafonnée à 1,5", () => {
    expect(echelleQuantite(undefined)).toBe(1);
    expect(echelleQuantite(1)).toBe(1);
    expect(echelleQuantite(3)).toBeCloseTo(1.2);
    expect(echelleQuantite(50)).toBe(1.5);
    expect(echelleQuantite(Number.NaN)).toBe(1);
  });
});

describe("visibilité du butin par la distance", () => {
  const oeil: [number, number, number] = [0, 0, 0];

  it("seuls les objets à moins de 60 m sont dessinés, du plus proche au plus lointain", () => {
    const objets = [objet(1, 59), objet(2, 61), objet(3, 5), objet(4, -30), objet(5, 200)];
    expect(objetsVisibles(objets, oeil, new Set()).map((o) => o.id)).toEqual([3, 4, 1]);
  });

  it("la distance est en 3D : un objet sur un toit, 70 m plus haut, n'est pas dessiné", () => {
    expect(objetsVisibles([objet(1, 3, { p: [3, 70, 0] })], oeil, new Set())).toHaveLength(0);
  });

  it("hystérésis : un objet déjà dessiné le reste jusqu'à 68 m, un objet neuf n'apparaît qu'à 60 m", () => {
    const o = objet(1, 64);
    expect(objetsVisibles([o], oeil, new Set())).toHaveLength(0);
    expect(objetsVisibles([o], oeil, new Set([1]))).toHaveLength(1);
    expect(objetsVisibles([objet(1, 69)], oeil, new Set([1]))).toHaveLength(0);
  });

  it("bornée à `max` objets, les plus proches d'abord ; à distance égale l'ordre est celui des ids", () => {
    const objets = [objet(9, 10), objet(2, 10), objet(5, 3), objet(7, 20)];
    expect(objetsVisibles(objets, oeil, new Set(), 2).map((o) => o.id)).toEqual([5, 2]);
    expect(objetsVisibles(objets, oeil, new Set(), 0)).toEqual([]);
  });

  it("accepte tout itérable (Map.values) et ne modifie pas ses entrées", () => {
    const m = new Map([[1, objet(1, 5)], [2, objet(2, 500)]]);
    expect(objetsVisibles(m.values(), oeil, new Set()).map((o) => o.id)).toEqual([1]);
    expect(m.size).toBe(2);
  });

  it("la capacité d'un rendu couvre les modèles : modelesMax <= capacite", () => {
    expect(BUTIN_RENDU.modelesMax).toBeLessThanOrEqual(BUTIN_RENDU.capacite);
    expect(BUTIN_RENDU.porteeM).toBe(60);
  });
});

const zone = (o: Partial<ZoneBr> = {}): ZoneBr => ({
  palier: 1, nbPaliers: 6, phase: "attente", t0: 0, t1: 120_000, t2: 180_000,
  c0: [0, 0], r0: 455, c1: [40, -20], r1: 250, degats: 1, ...o,
});

describe("tempête : mur et anneau", () => {
  it("l'échelle du mur suit le rayon, la hauteur est fixe, le rayon est borné (zone fermée)", () => {
    expect(echelleMur(250)).toEqual([250, MUR_TEMPETE.hauteurM, 250]);
    expect(echelleMur(0)).toEqual([MUR_TEMPETE.rayonMinM, MUR_TEMPETE.hauteurM, MUR_TEMPETE.rayonMinM]);
    expect(echelleMur(Number.NaN)[0]).toBe(MUR_TEMPETE.rayonMinM);
    expect(echelleMur(100, 14)).toEqual([100, 14, 100]);
  });

  it("le cercle courant est celui du palier pendant l'attente, puis interpolé pendant le rétrécissement", () => {
    expect(cercleZone(null, 0)).toBeNull();
    expect(cercleZone(zone(), 50_000)).toEqual({ centre: [0, 0], rayon: 455 });
    const mi = cercleZone(zone(), 150_000)!;
    expect(mi.rayon).toBeCloseTo((455 + 250) / 2, 6);
    expect(mi.centre[0]).toBeCloseTo(20, 6);
    expect(mi.centre[1]).toBeCloseTo(-10, 6);
    expect(cercleZone(zone(), 180_000)).toEqual({ centre: [40, -20], rayon: 250 });
  });

  it("l'anneau montre le cercle visé tant que la zone n'est pas fermée, et disparaît quand elle l'est ou quand le cercle est atteint", () => {
    expect(anneauProchaineZone(null, 0)).toBeNull();
    expect(anneauProchaineZone(zone(), 10_000)).toEqual({ centre: [40, -20], rayon: 250 });
    expect(anneauProchaineZone(zone(), 150_000)).toEqual({ centre: [40, -20], rayon: 250 });
    // passé la fin du rétrécissement, sans nouveau message : le cercle visé est atteint
    expect(anneauProchaineZone(zone(), 190_000)).toBeNull();
    expect(anneauProchaineZone(zone({ phase: "fermee", c1: [3, 4], r1: 0 }), 0)).toBeNull();
  });

  it("l'intensité du mur est discrète au loin (0,25), maximale au bord (1) et symétrique dedans / dehors", () => {
    expect(intensiteMur(1000)).toBeCloseTo(0.25);
    expect(intensiteMur(0)).toBeCloseTo(1);
    expect(intensiteMur(-100)).toBeCloseTo(intensiteMur(100));
    expect(intensiteMur(50)).toBeGreaterThan(intensiteMur(150));
    expect(intensiteMur(Number.NaN)).toBeCloseTo(0.25);
  });

  it("le motif défile en restant dans [0, 1[", () => {
    for (const t of [0, 1, 7.3, 1000, 123456]) {
      const d = defilementMur(t);
      expect(d.u).toBeGreaterThanOrEqual(0);
      expect(d.u).toBeLessThan(1);
      expect(d.v).toBeGreaterThanOrEqual(0);
      expect(d.v).toBeLessThan(1);
    }
    expect(defilementMur(2).v).toBeGreaterThan(defilementMur(1).v);
  });
});

describe("avion", () => {
  const a: AvionBr = { depart: [0, 0], arrivee: [100, 0], altitude: 350, vitesse: 30, debutT: 1000, finT: 5000 };
  it("visible dès le décompte (immobile au départ) et un instant après l'arrivée, jamais sans avion", () => {
    expect(avionVisible(null, 0)).toBe(false);
    expect(avionVisible(a, 0)).toBe(true);
    expect(avionVisible(a, 5000)).toBe(true);
    expect(avionVisible(a, 5000 + AVION_PERSISTANCE_MS)).toBe(true);
    expect(avionVisible(a, 5000 + AVION_PERSISTANCE_MS + 1)).toBe(false);
  });
});
