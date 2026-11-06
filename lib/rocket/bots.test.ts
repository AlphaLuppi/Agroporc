import { describe, expect, it } from "vitest";
import { BALLE, DEFAUT_CONFIG, ENTREES_NULLES, NIVEAUX_BOT, PAS_S, PROFILS_BOT } from "./contrat";
import type { ConfigMatch, EntreesVoiture, MondeRocket, NiveauBot } from "./contrat";
import { creerArene } from "./arene";
import { creerCerveau, reinitialiserStatsBots, statsBots } from "./bots";
import { creerMonde, pasMonde } from "./match";
import { simuler } from "./outils-simulation";

const arene = creerArene();
const cfg = (o: Partial<ConfigMatch> = {}): ConfigMatch => ({ ...DEFAUT_CONFIG(), ...o });

const entreesValides = (e: EntreesVoiture): boolean =>
  [e.accel, e.direction, e.tangage, e.lacet, e.roulis].every((x) => Number.isFinite(x) && Math.abs(x) <= 1 + 1e-9) &&
  typeof e.saut === "boolean" && typeof e.boost === "boolean" && typeof e.derapage === "boolean";

describe("cerveau : contrat", () => {
  it.each(NIVEAUX_BOT)("%s : entrées toujours finies, dans [-1, 1], sans mutation du monde", (niveau) => {
    const m = creerMonde(cfg({ format: "2v2", graine: 4 }), arene);
    const cerveaux = m.voitures.map((v) => creerCerveau(niveau, 100 + v.id));
    for (let i = 0; i < 1500; i++) {
      const e = m.voitures.map((v, k) => ({ ...cerveaux[k].decider(m, v, PAS_S) }));
      for (const x of e) expect(entreesValides(x)).toBe(true);
      pasMonde(m, e);
    }
  });

  it("une voiture démolie ou figée reçoit des entrées nulles", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    const c = creerCerveau("pro", 1);
    // figée (décompte)
    expect(c.decider(m, m.voitures[0], PAS_S)).toEqual(ENTREES_NULLES());
    m.voitures[0].figee = false;
    m.voitures[0].demolie = true;
    expect(c.decider(m, m.voitures[0], PAS_S)).toEqual(ENTREES_NULLES());
  });

  it("déterministe : même graine, mêmes décisions", () => {
    const joue = (graine: number): string => {
      const m = creerMonde(cfg({ format: "1v1", graine }), arene);
      const c = m.voitures.map((v) => creerCerveau("allstar", graine + v.id));
      let s = "";
      for (let i = 0; i < 600; i++) {
        const e = m.voitures.map((v, k) => ({ ...c[k].decider(m, v, PAS_S) }));
        s += e.map((x) => `${x.accel}${x.direction.toFixed(2)}${x.boost ? 1 : 0}${x.saut ? 1 : 0}`).join(",");
        pasMonde(m, e);
      }
      return s;
    };
    expect(joue(9)).toBe(joue(9));
    expect(joue(9)).not.toBe(joue(10));
  });

  it("les profils sont ceux du contrat (réaction décroissante avec le niveau)", () => {
    expect(PROFILS_BOT.debutant.reactionS).toBeGreaterThan(PROFILS_BOT.pro.reactionS);
    expect(PROFILS_BOT.pro.reactionS).toBeGreaterThan(PROFILS_BOT.allstar.reactionS);
  });
});

describe("cerveau : coup d'envoi", () => {
  it.each([["pro", 5], ["allstar", 5], ["debutant", 3]] as [NiveauBot, number][])("%s : la balle est touchée en moins de 3,5 s sur %i graines", (niveau, graines) => {
    for (let g = 1; g <= graines; g++) {
      const r = simuler(cfg({ format: "1v1", graine: g }), { bleue: niveau, orange: niveau }, { dureeS: 8 });
      expect(r.nan).toBe(false);
      expect(r.premiereTouche, `graine ${g}`).not.toBeNull();
      expect(r.premiereTouche as number, `graine ${g}`).toBeLessThan(niveau === "debutant" ? 4.5 : 3.5);
    }
  });
});

describe("cerveau : but vide", () => {
  /** Monde 1v1 : la voiture bleue (bot) face à une balle posée devant un but sans gardien. */
  function butVide(niveau: NiveauBot, graine: number, balle: [number, number, number]): MondeRocket {
    const m = creerMonde(cfg({ format: "1v1", graine, equipeJoueur: "bleue" }), arene);
    // l'orange se gare dans un coin et ne bouge plus
    const adverse = m.voitures[1];
    adverse.p = [-30, 0.17, 30];
    // la balle est posée en jeu, le coup d'envoi est lancé
    let garde = 0;
    while (m.phase === "decompte" && garde++ < 1000) pasMonde(m, m.voitures.map(() => ENTREES_NULLES()));
    m.balle.p = [balle[0], balle[1], balle[2]];
    m.balle.v = [0, 0, 0];
    m.balle.w = [0, 0, 0];
    const bilan = simuler(m.config, { bleue: niveau, orange: niveau }, { dureeS: 45, sansCerveau: [1], jusquALaFin: true }, m);
    return bilan.monde;
  }

  it.each(["pro", "allstar"] as NiveauBot[])("%s marque dans un but vide (balle au sol dans sa moitié adverse)", (niveau) => {
    const m = butVide(niveau, 3, [3, BALLE.rayon + 0.02, 5]);
    expect(m.score.bleue).toBeGreaterThanOrEqual(1);
  });

  it("un Débutant finit aussi par marquer dans un but vide, balle devant lui", () => {
    const m = butVide("debutant", 5, [2, BALLE.rayon + 0.02, 12]);
    expect(m.score.bleue).toBeGreaterThanOrEqual(1);
  });
});

describe("cerveau : aériens", () => {
  /** Balle en l'air devant un All-Star, adversaire parqué ; rend si le bot l'a touchée et s'il a décollé. */
  function aerien(balle: [number, number, number], vitesse: [number, number, number]): { touche: boolean; decollages: number } {
    reinitialiserStatsBots();
    const m = creerMonde(cfg({ format: "1v1", graine: 3 }), arene);
    m.voitures[1].p = [-30, 0.17, 30];
    let garde = 0;
    while (m.phase === "decompte" && garde++ < 1000) pasMonde(m, m.voitures.map(() => ENTREES_NULLES()));
    m.voitures[0].p = [0, 0.17, -2];
    m.voitures[0].boost = 100;
    m.balle.dernierToucheur = { idVoiture: 1, equipe: "orange", temps: m.temps };
    m.balle.p = [...balle]; m.balle.v = [...vitesse]; m.balle.w = [0, 0, 0];
    const r = simuler(m.config, { bleue: "allstar", orange: "allstar" }, { dureeS: 5, sansCerveau: [1] }, m);
    return { touche: (r.compte["toucheBalle"] ?? 0) > 0, decollages: statsBots.decollages };
  }

  it("un All-Star décolle et touche une balle à 6 m de haut", () => {
    const r = aerien([-6, 6, 8], [3, 4, 0]);
    expect(r.decollages).toBeGreaterThanOrEqual(1);
    expect(r.touche).toBe(true);
  });

  it("un All-Star touche une balle haute qui avance vers lui", () => {
    expect(aerien([0, 5, 16], [0, 0, 4]).touche).toBe(true);
  });

  it("un Débutant ne tente jamais d'aérien ni de flip de frappe", () => {
    reinitialiserStatsBots();
    simuler(cfg({ format: "2v2", graine: 6 }), { bleue: "debutant", orange: "debutant" }, { dureeS: 60 });
    expect(statsBots.decollages).toBe(0);
    expect(statsBots.flipsFrappe + statsBots.saut).toBe(0);
  });
});

describe("cerveau : rotation et plots", () => {
  /** Moyenne du nombre de voitures d'une équipe à moins de 14 m de la balle, et boost moyen, en 3v3. */
  function mesure(niveau: NiveauBot): { proches: number; boost: number } {
    let somme = 0, n = 0, boost = 0, nb = 0;
    for (let g = 1; g <= 2; g++) {
      simuler(cfg({ format: "3v3", graine: g, dureeS: 300 }), { bleue: niveau, orange: niveau }, {
        dureeS: 60,
        surPas: (m) => {
          if (m.phase !== "enJeu" || m.tick % 12) return;
          for (const eq of ["bleue", "orange"] as const) {
            let c = 0;
            for (const v of m.voitures) if (v.equipe === eq && !v.demolie && Math.hypot(v.p[0] - m.balle.p[0], v.p[2] - m.balle.p[2]) < 14) c++;
            somme += c; n++;
          }
          boost += m.voitures.reduce((s, v) => s + v.boost, 0) / m.voitures.length; nb++;
        },
      });
    }
    return { proches: somme / n, boost: boost / nb };
  }

  it("les Pro tournent (moins de coéquipiers sur la balle que les Débutants) et ramassent plus de boost", () => {
    const d = mesure("debutant"), p = mesure("pro");
    expect(p.proches).toBeLessThan(d.proches - 0.4);
    expect(p.boost).toBeGreaterThan(d.boost + 8);
  });
});
