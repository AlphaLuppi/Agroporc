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
  largeur: number;
}

function simu(o: Partial<OptionsTroupe>, macron: Partial<EtatPersonnage>): Simu {
  const troupe = creerTroupe(options(o));
  const largeur = o.largeurEcran ?? LARGEUR, tigrePx = o.largeurTigrePx ?? TIGRE_PX;
  const emb = creerEmbuscade(troupe, { largeurEcran: largeur, largeurTigrePx: tigrePx, pxParMetre: tigrePx / 3.75 });
  const s: Simu = {
    troupe, emb, evs: [], impacts: [], t: 0, largeur,
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
      s.macron.present = s.macron.x > 0 && s.macron.x < s.largeur;
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

  /** Grand écran : 1920 px, tigre de 220 px. */
  const grand = (o: Partial<OptionsTroupe>) => ({ largeurEcran: 1920, largeurTigrePx: 220, ...o });

  it("Macron entre devant le tigre lancé, avant ou après le milieu : il frappe ou renonce d'emblée, sans geste à reculons", () => {
    let plans = 0;
    for (const vitesse of [1.8, 2.4, 3.2]) for (const au of [500, 700, 900, 1100, 1300, 1500]) {
      const s = simu(grand({ sens: 1, vitesse }), { x: 2020, sens: -1, vitesse: 298 });
      // Macron entre quand le tigre passe en `au` (le milieu est à 960 px).
      while (s.troupe.mere.x < au) avancer(s, 1 / 60, false);
      let reculait = false;
      avancer(s, 9, true, () => {
        const a = s.troupe.mere.anim;
        // Le geste démarre : le tigre va vers le point ou est arrêté, jamais en s'en éloignant.
        if (s.emb.phase === "arme" && a.reaction?.nom === "batte" && a.t - a.reaction.t0 < 0.02) reculait ||= a.corps.v * a.sens < -0.05;
      });
      expect(reculait).toBe(false);
      // Un plan tenu frappe, sinon pas de plan du tout (abandon d'emblée).
      expect(s.impacts.length === 1 || s.emb.plan === null, `vitesse ${vitesse}, Macron entre au passage en ${au}`).toBe(true);
      if (s.emb.plan) plans++;
    }
    // Le cas n'est pas vide : assez loin de Macron, le plan reste tenable.
    expect(plans).toBeGreaterThan(0);
  });

  it("point derrière lui (Macron le suit dans le même sens) : demi-tour de course, puis coup", () => {
    const s = simu(grand({ sens: 1, vitesse: 3.2 }), { x: -100, sens: 1, vitesse: 298 });
    avancer(s, 2.5, false);
    let demiTour = false;
    avancer(s, 9, true, () => { demiTour ||= s.emb.phase === "course" && s.troupe.mere.anim.sens === -1; });
    expect(demiTour).toBe(true);
    expect(s.impacts.length).toBe(1);
    expect(Math.abs(s.impacts[0].xMacron - (s.impacts[0].xTigre - s.emb.portee(s.macron)))).toBeLessThan(25);
  });

  it("plan devenu intenable pendant la course : il renonce aussitôt", () => {
    const s = simu(grand({ sens: 1, vitesse: 3.2 }), { x: -100, sens: 1, vitesse: 298 });
    avancer(s, 2.5, false);
    // Macron accélère d'un coup juste après le plan : le tigre n'arrivera plus à temps.
    let accelere = false, tAbandon: number | null = null, tContact: number | null = null;
    avancer(s, 4, true, () => {
      if (s.emb.phase === "course" && !accelere) { accelere = true; s.macron.vitesse = 900; }
      if (accelere && tAbandon == null && s.emb.phase === "fini") tAbandon = s.t;
      const p = s.emb.plan;
      if (accelere && tContact == null && p && (s.macron.x - p.x) * p.face <= s.emb.portee(s.macron)) tContact = s.t;
    });
    expect(accelere).toBe(true);
    expect(s.impacts.length).toBe(0);
    expect(tAbandon).not.toBeNull();
    // Il renonce avant que Macron n'atteigne le point de contact.
    expect(tAbandon!).toBeLessThan(tContact ?? Infinity);
  });

  it("après le coup, s'il doit repasser sur Macron au sol, il attend qu'il reparte", () => {
    const r = simu({ sens: 1 }, { x: 1500, sens: -1 });
    avancer(r, 0.6, false);
    let maxV = 0, repartiAvant = false, reparti = false;
    avancer(r, 9, true, () => {
      if (!r.impacts.length) return;
      const dt = r.t - r.impacts[0].t;
      // Macron immobile au sol, puis il repart 3,3 s après l'impact (fin du relevé, lib/macron3d/ko.ts).
      if (dt > 3.3 && r.macron.vitesse === 0) r.macron.vitesse = 160;
      const v = r.troupe.mere.anim.corps.v;
      // Entre la fin du coup et la reprise de Macron, il reste planté (petits compris).
      if (r.emb.phase === "fini" && dt < 3.3) {
        maxV = Math.max(maxV, Math.abs(v), ...r.troupe.membres.slice(1).map((p) => Math.abs(p.anim.corps.v)));
        repartiAvant ||= r.troupe.mere.anim.vitesse > 0;
      }
      if (dt > 3.4) reparti ||= v > 0.5;
    });
    expect(r.impacts.length).toBe(1);
    expect(repartiAvant).toBe(false);
    expect(maxV).toBeLessThan(0.3);
    expect(reparti).toBe(true);
    expect(r.troupe.mere.anim.sens).toBe(1);
  });

  it("Macron qui ne repart pas : le tigre n'attend pas plus de quelques secondes", () => {
    const s = simu({ sens: 1 }, { x: 1500, sens: -1 });
    avancer(s, 0.6, false);
    avancer(s, 6);
    expect(s.impacts.length).toBe(1);
    expect(s.emb.phase).toBe("fini");
    avancer(s, 5);
    expect(s.troupe.mere.anim.vitesse).toBeGreaterThan(0);
    expect(s.troupe.mere.anim.corps.v).toBeGreaterThan(0.5);
  });

  it("annulée pendant l'attente devant Macron au sol : il repart tout de suite", () => {
    const s = simu({ sens: 1 }, { x: 1500, sens: -1 });
    avancer(s, 0.6, false);
    let annule = false;
    avancer(s, 6, true, () => {
      if (!annule && s.emb.phase === "fini" && s.impacts.length && s.troupe.mere.anim.vitesse === 0) { annule = true; s.emb.annuler(); }
    });
    expect(annule).toBe(true);
    expect(s.troupe.mere.anim.vitesse).toBeGreaterThan(0);
  });

  it("même sens : pas d'attente, il repart à l'opposé du corps", () => {
    const s = simu({ sens: -1 }, { x: 1500, sens: -1 });
    avancer(s, 1.6, false);
    let attendu = false;
    avancer(s, 9, true, () => { attendu ||= s.emb.phase === "fini" && s.impacts.length > 0 && s.troupe.mere.anim.vitesse === 0; });
    expect(s.impacts.length).toBe(1);
    expect(attendu).toBe(false);
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
