/**
 * Embuscade sur une vraie troupe (lib/tigre3d/troupe.ts) et un Macron simulé qui court à vitesse
 * constante et s'arrête net à l'impact : le tigre se poste, frappe une fois, au bon endroit, puis
 * reprend sa course d'origine.
 */
import { describe, it, expect } from "vitest";
import { creerTroupe, type OptionsTroupe } from "./troupe";
import { creerEmbuscade } from "./embuscade";
import type { EtatPersonnage } from "../rencontre";
import type { EvenementTigre } from "./animateur";

const LARGEUR = 1400, TIGRE_PX = 210, PXM = TIGRE_PX / 3.75;
const options = (o: Partial<OptionsTroupe> = {}): OptionsTroupe => ({
  evenement: "normal", petits: 0, sens: 1, vitesse: 2.4,
  largeurEcran: LARGEUR, largeurTigrePx: TIGRE_PX, pxParMetre: PXM, alea: () => 0.5, ...o,
});

interface Simu {
  troupe: ReturnType<typeof creerTroupe>;
  emb: ReturnType<typeof creerEmbuscade>;
  macron: EtatPersonnage;
  evs: EvenementTigre[];
  impacts: Array<{ xMacron: number; xTigre: number; t: number }>;
  t: number;
}

function simu(o: Partial<OptionsTroupe>, macron: Partial<EtatPersonnage>): Simu {
  const troupe = creerTroupe(options(o));
  const emb = creerEmbuscade(troupe, { largeurEcran: LARGEUR, largeurTigrePx: TIGRE_PX, pxParMetre: PXM });
  const s: Simu = {
    troupe, emb, evs: [], impacts: [], t: 0,
    macron: { present: false, x: -200, sens: 1, vitesse: 270, disponible: true, passage: 1, rayon: 12, ...macron },
  };
  troupe.sur((e) => {
    s.evs.push(e);
    if (e.type === "impact") {
      s.impacts.push({ xMacron: s.macron.x, xTigre: troupe.mere.x, t: s.t });
      s.macron.vitesse = 0;
      s.macron.disponible = false;
    }
  });
  return s;
}

/** Avance de `secondes` à 60 i/s, Macron avance à vitesse constante (sauf après l'impact). */
function avancer(s: Simu, secondes: number, macronActif = true, chaque?: () => void) {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(secondes * 60); i++) {
    s.t += dt;
    s.troupe.maj(dt);
    if (macronActif) {
      s.macron.x += s.macron.sens * s.macron.vitesse * dt;
      s.macron.present = s.macron.x > 0 && s.macron.x < LARGEUR;
    }
    s.emb.maj(macronActif ? s.macron : null);
    chaque?.();
  }
}

describe("embuscade", () => {
  it("face à face : il se poste, frappe une fois, Macron arrive sur la batte, puis il repart", () => {
    const s = simu({ sens: 1 }, { x: 1500, sens: -1 });
    // Le tigre entre par la gauche, Macron par la droite un peu plus tard.
    avancer(s, 0.6, false);
    const phases = new Set<string>();
    avancer(s, 8, true, () => phases.add(s.emb.phase));
    for (const ph of ["course", "arme", "coup", "fini"]) expect(phases.has(ph), ph).toBe(true);
    expect(s.impacts.length).toBe(1);
    const { xMacron, xTigre } = s.impacts[0];
    // Macron devant lui (côté droit : il lui fait face), à la portée prévue, à quelques px près.
    const attendu = xTigre + s.emb.portee(s.macron);
    expect(Math.abs(xMacron - attendu)).toBeLessThan(25);
    expect(s.evs.some((e) => e.type === "bulle" && e.texte === "BONK !")).toBe(true);
    // Il repart dans son sens d'origine et finit par sortir de l'écran.
    expect(s.troupe.mere.anim.sens).toBe(1);
    avancer(s, 12, true);
    expect(s.troupe.termine).toBe(true);
    expect(s.impacts.length).toBe(1);
  });

  it("même sens : le tigre devant Macron se retourne pour lui faire face, puis reprend son sens", () => {
    const s = simu({ sens: -1 }, { x: 1500, sens: -1 });
    avancer(s, 1.6, false);
    avancer(s, 9);
    expect(s.impacts.length).toBe(1);
    const { xMacron, xTigre } = s.impacts[0];
    expect(Math.abs(xMacron - (xTigre + s.emb.portee(s.macron)))).toBeLessThan(25);
    avancer(s, 12, true);
    expect(s.troupe.mere.anim.sens).toBe(-1);
    expect(s.troupe.termine).toBe(true);
  });

  it("Macron qui disparaît pendant l'embuscade : pas de coup, il reprend sa course", () => {
    const s = simu({ sens: 1 }, { x: 1500, sens: -1 });
    avancer(s, 0.6, false);
    let arme = false;
    avancer(s, 6, true, () => {
      if (s.emb.phase === "arme" && !arme) { arme = true; s.macron.present = false; s.macron.x = 99999; }
    });
    expect(arme).toBe(true);
    expect(s.impacts.length).toBe(0);
    expect(s.troupe.mere.anim.reaction).toBeNull();
    expect(s.troupe.mere.anim.sens).toBe(1);
    avancer(s, 12, false);
    expect(s.troupe.termine).toBe(true);
  });

  it("annulée (onglet caché, démontage) pendant la course : il reprend sa course d'origine", () => {
    const s = simu({ sens: 1 }, { x: 1500, sens: -1 });
    avancer(s, 0.6, false);
    let annule = false;
    avancer(s, 4, true, () => {
      if (s.emb.phase === "course" && !annule) { annule = true; s.emb.annuler(); }
    });
    expect(annule).toBe(true);
    expect(s.emb.phase).toBe("fini");
    expect(s.impacts.length).toBe(0);
    expect(s.troupe.mere.anim.sens).toBe(1);
  });

  it("aucun point atteignable (Macron presque sorti) : rien ne se passe", () => {
    const s = simu({ sens: 1 }, { x: 150, sens: -1 });
    avancer(s, 0.6, false);
    avancer(s, 3);
    expect(s.emb.plan).toBeNull();
    expect(s.emb.phase).toBe("fini");
    expect(s.troupe.mere.anim.reaction).toBeNull();
    expect(s.impacts.length).toBe(0);
  });

  it("un seul essai par passage de Macron, Macron déjà frappé n'est plus visé", () => {
    const s = simu({ sens: 1 }, { x: 1500, sens: -1, disponible: false });
    avancer(s, 0.6, false);
    avancer(s, 5);
    expect(s.emb.plan).toBeNull();
    expect(s.emb.phase).toBe("libre");
    expect(s.impacts.length).toBe(0);
  });

  it("famille : seule la mère frappe, les petits s'arrêtent", () => {
    const s = simu({ sens: 1, evenement: "famille", petits: 2, vitesse: 1.8 }, { x: 1420, sens: -1 });
    avancer(s, 1.5, false);
    let petitsArretes = false;
    avancer(s, 9, true, () => {
      if (s.emb.phase === "coup") petitsArretes ||= s.troupe.membres.slice(1).every((p) => p.anim.figee);
    });
    expect(s.impacts.length).toBe(1);
    expect(petitsArretes).toBe(true);
  });
});
