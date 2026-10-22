import { describe, it, expect, vi } from "vitest";
import { creerCanal, declencherFrappe, planEmbuscade, type EtatPersonnage, type ParamsEmbuscade } from "./rencontre";

const etat = (o: Partial<EtatPersonnage> = {}): EtatPersonnage => ({
  present: true, x: 100, sens: 1, vitesse: 270, disponible: true, passage: 1, rayon: 12, ...o,
});

describe("canal de la rencontre", () => {
  it("garde le dernier état de chacun et diffuse tous les messages aux abonnés", () => {
    const c = creerCanal();
    const recus: string[] = [];
    const fin = c.sur((m) => recus.push(m.type));
    expect(c.etat("macron")).toBeNull();
    c.publier({ type: "etat", qui: "macron", etat: etat({ x: 300 }) });
    c.publier({ type: "impact" });
    expect(c.etat("macron")?.x).toBe(300);
    expect(c.etat("tigre")).toBeNull();
    fin();
    c.publier({ type: "annulation" });
    expect(recus).toEqual(["etat", "impact"]);
    c.publier({ type: "etat", qui: "macron", etat: null });
    expect(c.etat("macron")).toBeNull();
  });

  it("un abonné qui se désabonne pendant la diffusion ne prive pas les autres", () => {
    const c = creerCanal();
    const b = vi.fn();
    const finA = c.sur(() => finA());
    c.sur(b);
    c.publier({ type: "impact" });
    expect(b).toHaveBeenCalledTimes(1);
    c.reinitialiser();
    c.publier({ type: "impact" });
    expect(b).toHaveBeenCalledTimes(1);
  });
});

/** Ordinateur : 1400 px, tigre de 210 px (56 px/m), Macron à ≈ 270 px/s. */
const base = (o: Partial<ParamsEmbuscade> = {}): ParamsEmbuscade => ({
  tigre: { x: 1000, sens: -1, vitesseMax: 2400 },
  macron: { x: 100, sens: 1, vitesse: 270 },
  largeurEcran: 1400, portee: 50, margeTigre: 84, margeMacron: 40,
  tPreparation: 2, tDemiTour: 1, tElan: 0.35, tMarge: 0.3,
  ...o,
});

describe("planEmbuscade", () => {
  it("face à face : le tigre se poste sur le trajet de Macron, devant lui, et lui fait face", () => {
    const p = planEmbuscade(base())!;
    expect(p).not.toBeNull();
    expect(p.face).toBe(-1);
    // Devant Macron, et Macron arrive au contact après que le tigre est prêt.
    expect(p.x).toBeGreaterThan(100 + 50);
    expect(p.tTigre + 0.35 + 0.3).toBeLessThanOrEqual(p.tContact + 1e-9);
    expect(p.tContact).toBeCloseTo((p.x - 50 - 100) / 270, 6);
    // La rencontre la plus tôt : 2 px plus près de Macron, le tigre n'aurait pas le temps.
    const q = { ...base(), tigre: base().tigre };
    const tPlusTot = Math.abs(p.x - 2 - q.tigre.x) / 2400 + 2;
    expect(tPlusTot + 0.65).toBeGreaterThan((p.x - 2 - 50 - 100) / 270);
  });

  it("tigre devant Macron qui court dans le même sens : demi-tours comptés, il doit faire face", () => {
    const meme = planEmbuscade(base({ tigre: { x: 1000, sens: 1, vitesseMax: 2400 } }))!;
    const face = planEmbuscade(base())!;
    // Arrivé en courant dans le sens de Macron, il doit se retourner : point plus loin.
    expect(meme.x).toBeGreaterThan(face.x);
    expect(meme.face).toBe(-1);
  });

  it("lancé, le tigre ne vise pas un point plus proche que sa distance d'arrêt", () => {
    const macron = { x: 1500, sens: -1 as const, vitesse: 270 };
    const libre = planEmbuscade(base({ tigre: { x: 300, sens: 1, vitesseMax: 2400 }, macron, tPreparation: 1 }))!;
    const lance = planEmbuscade(base({ tigre: { x: 300, sens: 1, vitesseMax: 2400, arret: 400 }, macron, tPreparation: 1 }))!;
    expect(libre.x).toBeGreaterThan(300);
    expect(lance.x - 300).toBeGreaterThanOrEqual(399);
  });

  it("Macron de droite à gauche : symétrique", () => {
    const p = planEmbuscade(base({ tigre: { x: 400, sens: 1, vitesseMax: 2400 }, macron: { x: 1300, sens: -1, vitesse: 270 } }))!;
    expect(p.face).toBe(1);
    expect(p.x).toBeLessThan(1300 - 50);
    expect(p.tContact).toBeCloseTo((1300 - (p.x + 50)) / 270, 6);
  });

  it("reste dans l'écran : le tigre entier, Macron visible au contact", () => {
    for (let xm = 0; xm < 1400; xm += 50) {
      for (const sens of [1, -1] as const) {
        const p = planEmbuscade(base({ macron: { x: xm, sens, vitesse: 270 } }));
        if (!p) continue;
        expect(p.x).toBeGreaterThanOrEqual(84);
        expect(p.x).toBeLessThanOrEqual(1400 - 84);
        const contact = p.x - sens * 50;
        expect(contact).toBeGreaterThanOrEqual(40);
        expect(contact).toBeLessThanOrEqual(1400 - 40);
      }
    }
  });

  it("aucun point atteignable : pas de rencontre (mobile, Macron déjà loin, Macron arrêté)", () => {
    // Téléphone 390 px : Macron traverse en ≈ 1,5 s, moins que la préparation.
    expect(planEmbuscade(base({
      largeurEcran: 390, tigre: { x: 300, sens: -1, vitesseMax: 1600 }, macron: { x: 60, sens: 1, vitesse: 260 },
      margeTigre: 56, portee: 35,
    }))).toBeNull();
    // Macron presque sorti.
    expect(planEmbuscade(base({ macron: { x: 1350, sens: 1, vitesse: 270 } }))).toBeNull();
    // Macron arrêté (au sol) ou tigre immobile.
    expect(planEmbuscade(base({ macron: { x: 100, sens: 1, vitesse: 0 } }))).toBeNull();
    expect(planEmbuscade(base({ tigre: { x: 1000, sens: -1, vitesseMax: 0 } }))).toBeNull();
    // Écran trop étroit pour les marges.
    expect(planEmbuscade(base({ largeurEcran: 150 }))).toBeNull();
  });

  it("tablette : rencontre possible quand Macron vient d'entrer et que le tigre court vers lui", () => {
    const p = planEmbuscade(base({
      largeurEcran: 768, tigre: { x: 650, sens: -1, vitesseMax: 1300 }, macron: { x: -100, sens: 1, vitesse: 230 },
      margeTigre: 60, margeMacron: 30, portee: 40, tPreparation: 1.6,
    }));
    expect(p).not.toBeNull();
    expect(p!.x).toBeLessThanOrEqual(768 - 60);
  });
});

describe("declencherFrappe", () => {
  const f = (xMacron: number, o: Partial<Parameters<typeof declencherFrappe>[0]> = {}) =>
    declencherFrappe({ xTigre: 800, face: -1, xMacron, vitesseMacron: 270, tElan: 0.35, portee: 50, ...o });

  it("attend, puis frappe quand d − v × t atteint la portée", () => {
    // d − v t = portée : d = 50 + 94,5 = 144,5 px.
    expect(f(800 - 400)).toBe("attendre");
    expect(f(800 - 145)).toBe("attendre");
    expect(f(800 - 144)).toBe("frapper");
    expect(f(800 - 130)).toBe("frapper");
  });

  it("trop tard quand Macron l'a dépassé ou que la batte arriverait derrière lui", () => {
    expect(f(800 + 10)).toBe("trop-tard");
    expect(f(800 - 100)).toBe("trop-tard");
  });

  it("dans l'autre sens aussi", () => {
    expect(f(800 + 144, { face: 1 })).toBe("frapper");
    expect(f(800 + 400, { face: 1 })).toBe("attendre");
    expect(f(800 - 10, { face: 1 })).toBe("trop-tard");
  });
});
