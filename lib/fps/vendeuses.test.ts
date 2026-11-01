import { describe, expect, it } from "vitest";
import { ELSA } from "./elsa";
import { TRUCK } from "./zones";
import {
  CABINE, DUREE_OFFRE_MS, DUREE_REPLIQUE_MS, FIGURE, NOMS_VENDEUSES, REPLIQUES_VENDEUSES, braquage, cabineVersTorse, epaule, ikBras, ligneActive,
  origineTorseAssis, poseComptoir, poseConducteuse, posePatronne, pointVolant, repliqueCommande, repliqueMerci, roulisVirage, scenarioOffre, vendeuseDeOffre,
  versRepereTorse, type PoseFigure, type V3,
} from "./vendeuses";

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const norme = (v: V3) => Math.hypot(v[0], v[1], v[2]);
const REACH = FIGURE.brasHaut + FIGURE.brasBas;

/** Position de la main obtenue par `ikBras` : épaule + haut·dirHaut + bas·dirBas. */
function main(cible: V3, hint?: V3): V3 {
  const r = ikBras(cible, FIGURE.brasHaut, FIGURE.brasBas, hint);
  return [
    r.haut[0] * FIGURE.brasHaut + r.bas[0] * FIGURE.brasBas,
    r.haut[1] * FIGURE.brasHaut + r.bas[1] * FIGURE.brasBas,
    r.haut[2] * FIGURE.brasHaut + r.bas[2] * FIGURE.brasBas,
  ];
}

describe("qui sert quelle offre", () => {
  it("une offre sur trois est celle de la patronne (la 2e, la 5e…), jamais la première", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(vendeuseDeOffre)).toEqual(["elsa", "patronne", "elsa", "elsa", "patronne", "elsa", "elsa", "patronne"]);
  });

  it("la durée recopiée est celle d'Elsa (ce module ne l'importe pas pour éviter une boucle)", () => {
    expect(DUREE_OFFRE_MS).toBe(ELSA.dureeOffreMs);
  });
});

describe("répliques et scénario d'une offre", () => {
  it("la patronne ouvre toujours par une commande à Elsa, qui répond ensuite", () => {
    for (let id = 1; id <= 30; id++) {
      const sc = scenarioOffre(id, vendeuseDeOffre(id));
      expect(sc[0].qui).toBe("patronne");
      expect(REPLIQUES_VENDEUSES.commande).toContain(sc[0].texte);
      expect(sc[1].qui).toBe("elsa");
      expect(REPLIQUES_VENDEUSES.reponse).toContain(sc[1].texte);
      expect(sc[2].qui).toBe("patronne");
      expect(REPLIQUES_VENDEUSES.presse).toContain(sc[2].texte);
    }
  });

  it("« Oh Elsa, prépare-moi ça ! » fait partie des commandes de la patronne", () => {
    expect(REPLIQUES_VENDEUSES.commande).toContain("Oh Elsa, prépare-moi ça !");
    const vues = new Set<string>();
    for (let id = 1; id <= 60; id++) vues.add(repliqueCommande(id));
    expect(vues.has("Oh Elsa, prépare-moi ça !")).toBe(true);
    expect(vues.size).toBeGreaterThan(2);
  });

  it("le service est celui de la vendeuse de l'offre (Elsa pour un soin ou une arme, la patronne pour sa formule)", () => {
    const sElsa = scenarioOffre(1, "elsa")[3];
    expect(sElsa.qui).toBe("elsa");
    expect(REPLIQUES_VENDEUSES.serviceElsa).toContain(sElsa.texte);
    const sPatronne = scenarioOffre(2, "patronne")[3];
    expect(sPatronne.qui).toBe("patronne");
    expect(REPLIQUES_VENDEUSES.servicePatronne).toContain(sPatronne.texte);
  });

  it("déterministe : le même scénario chez tous les clients, un autre pour une autre offre", () => {
    expect(scenarioOffre(7, "elsa")).toEqual(scenarioOffre(7, "elsa"));
    expect(scenarioOffre(7, "elsa")).not.toEqual(scenarioOffre(8, "elsa"));
  });

  it("chronologique, bulles qui ne se chevauchent pas, tout dans la durée de l'offre, jamais la même réplique deux fois de suite par la même vendeuse", () => {
    for (let id = 1; id <= 40; id++) {
      const sc = scenarioOffre(id, vendeuseDeOffre(id));
      expect(sc.length).toBeGreaterThanOrEqual(5);
      const derniere: Record<string, string> = {};
      for (let i = 0; i < sc.length; i++) {
        expect(sc[i].t).toBeGreaterThanOrEqual(0);
        expect(sc[i].t + DUREE_REPLIQUE_MS).toBeLessThanOrEqual(DUREE_OFFRE_MS);
        if (i > 0) expect(sc[i].t - sc[i - 1].t).toBeGreaterThanOrEqual(DUREE_REPLIQUE_MS);
        expect(sc[i].texte).not.toBe(derniere[sc[i].qui]);
        derniere[sc[i].qui] = sc[i].texte;
      }
    }
  });

  it("les deux parlent pendant l'offre (la patronne ET Elsa)", () => {
    const qui = new Set(scenarioOffre(5, "patronne").map((l) => l.qui));
    expect(qui).toEqual(new Set(["patronne", "elsa"]));
  });

  it("ligneActive : rien avant la première ligne ni entre deux bulles, la ligne en cours pendant sa bulle", () => {
    const sc = scenarioOffre(3, "elsa");
    expect(ligneActive(sc, 0)).toBeNull();
    expect(ligneActive(sc, sc[0].t)).toBe(sc[0]);
    expect(ligneActive(sc, sc[0].t + DUREE_REPLIQUE_MS - 1)).toBe(sc[0]);
    expect(ligneActive(sc, sc[0].t + DUREE_REPLIQUE_MS)).toBeNull();
    expect(ligneActive(sc, sc[1].t + 10)).toBe(sc[1]);
    expect(ligneActive([], 5_000)).toBeNull();
  });

  it("noms et remerciements", () => {
    expect(NOMS_VENDEUSES).toEqual({ elsa: "Elsa", patronne: "La patronne" });
    expect(REPLIQUES_VENDEUSES.merci).toContain(repliqueMerci(0));
    expect(REPLIQUES_VENDEUSES.merci).toContain(repliqueMerci(0.999));
  });
});

describe("ikBras : cinématique inverse à deux segments", () => {
  it("la main arrive sur la cible quand elle est à portée, et les segments gardent leurs longueurs", () => {
    for (const c of [[0.3, -0.4, -0.3], [0, -0.7, 0], [-0.2, 0.1, -0.6], [0.1, 0.5, -0.2], [0.05, -0.05, -0.5]] as V3[]) {
      const r = ikBras(c);
      expect(r.atteint).toBe(true);
      expect(dist(main(c), c)).toBeLessThan(1e-6);
      expect(norme(r.haut)).toBeCloseTo(1, 9);
      expect(norme(r.bas)).toBeCloseTo(1, 9);
    }
  });

  it("hors de portée, le bras se tend vers la cible sans la dépasser", () => {
    const c: V3 = [0, -3, -3];
    const r = ikBras(c);
    expect(r.atteint).toBe(false);
    expect(norme(main(c))).toBeLessThanOrEqual(REACH + 1e-9);
    // direction de la cible conservée
    const m = main(c);
    expect(m[1] / norme(m)).toBeCloseTo(c[1] / norme(c), 2);
  });

  it("trop près, le bras se plie au maximum sans NaN (cible sur l'épaule)", () => {
    for (const c of [[0, 0, 0], [0.001, 0, 0], [0, -0.0001, 0]] as V3[]) {
      const r = ikBras(c);
      for (const x of [...r.haut, ...r.bas]) expect(Number.isFinite(x)).toBe(true);
    }
  });

  it("le coude plie du côté de l'indice", () => {
    const c: V3 = [0.1, -0.35, -0.45];
    const bas = ikBras(c, FIGURE.brasHaut, FIGURE.brasBas, [0, -1, 0]).haut;
    const haut = ikBras(c, FIGURE.brasHaut, FIGURE.brasBas, [0, 1, 0]).haut;
    expect(bas[1]).toBeLessThan(haut[1]);
  });

  it("cible alignée sur l'indice (cas dégénéré) : toujours un résultat fini", () => {
    const r = ikBras([0, -0.5, 0], FIGURE.brasHaut, FIGURE.brasBas, [0, -1, 0]);
    for (const x of [...r.haut, ...r.bas]) expect(Number.isFinite(x)).toBe(true);
  });
});

describe("versRepereTorse", () => {
  it("l'identité sans inclinaison", () => {
    expect(versRepereTorse([0.1, 0.2, -0.3], [0, 0, 0])).toEqual([0.1, 0.2, -0.3]);
  });

  it("un torse penché de 0,3 rad en avant : le point droit devant est vu plus bas dans son repère (tangage négatif = en avant)", () => {
    const c = versRepereTorse([0, 0, -1], [-0.3, 0, 0]);
    // un torse penché en avant regarde plus bas : ce qui est droit devant est plus HAUT dans son repère
    expect(c[1]).toBeGreaterThan(0);
    expect(norme(c)).toBeCloseTo(1, 9);
  });

  it("rotation puis rotation inverse : on retrouve le point (R · R⁻¹ = 1), quels que soient les angles", () => {
    const rot: V3 = [-0.2, 0.3, 0.15];
    const c: V3 = [0.2, 0.1, -0.7];
    const local = versRepereTorse(c, rot);
    // R = Rx · Ry · Rz appliquée au vecteur local doit redonner c
    let [x, y, z] = local;
    let cs = Math.cos(rot[2]), sn = Math.sin(rot[2]);
    [x, y] = [x * cs - y * sn, x * sn + y * cs];
    cs = Math.cos(rot[1]); sn = Math.sin(rot[1]);
    [x, z] = [x * cs + z * sn, -x * sn + z * cs];
    cs = Math.cos(rot[0]); sn = Math.sin(rot[0]);
    [y, z] = [y * cs - z * sn, y * sn + z * cs];
    expect(dist([x, y, z], c)).toBeLessThan(1e-9);
  });
});

describe("cabine du Truck fou", () => {
  const largeur = TRUCK.largeur;

  it("les deux sièges et le volant tiennent dans la cabine (entre le pare-brise et la cloison, sous le toit)", () => {
    const zAvant = -TRUCK.longueur / 2, zArriere = -TRUCK.longueur / 2 + TRUCK.cabine;
    expect(CABINE.plancher).toBe(TRUCK.plancher);
    expect(CABINE.toit).toBe(TRUCK.hauteurCabine);
    for (const x of [-CABINE.assise.x, CABINE.assise.x]) {
      expect(Math.abs(x) + 0.25).toBeLessThan(largeur / 2);
      expect(CABINE.assise.z).toBeGreaterThan(zAvant + 0.5);
      expect(CABINE.assise.z).toBeLessThan(zArriere - 0.2);
    }
    expect(CABINE.volant.z).toBeGreaterThan(zAvant + 0.5);
    expect(CABINE.volant.z).toBeLessThan(CABINE.assise.z);
    expect(CABINE.volant.y + CABINE.volant.rayon).toBeLessThan(CABINE.toit);
  });

  it("les têtes (toque d'Elsa comprise) restent sous le toit, même penchées", () => {
    const hanches = CABINE.plancher + CABINE.assise.y;
    // toque : hanches + 0,08 + 0,46 + 0,45 + 0,12 en unités de figure
    const sommet = hanches + (FIGURE.torseDepuisHanches + FIGURE.teteDepuisTorse + 0.45 + 0.12) * CABINE.echelle;
    expect(sommet).toBeLessThan(CABINE.toit - 0.1);
  });

  it("le torse assis est où `origineTorseAssis` le dit, et `cabineVersTorse` y mène à l'origine", () => {
    const o = origineTorseAssis(CABINE.assise.x);
    expect(cabineVersTorse(o, CABINE.assise.x)).toEqual([0, 0, 0]);
    expect(o[1]).toBeCloseTo(CABINE.plancher + CABINE.assise.y + FIGURE.torseDepuisHanches * CABINE.echelle, 9);
  });

  it("les mains d'Elsa restent à portée du volant à tout braquage (bras pliés, jamais tendus à bout)", () => {
    for (let lacet = -2; lacet <= 2; lacet += 0.25) {
      for (const v of [0, 8, 20]) {
        const p = poseConducteuse({ v, lacet, tS: 1.3 });
        for (const cote of [0, 1] as const) {
          const local = versRepereTorse(p.mains[cote], p.torse);
          const d = dist(local, epaule(cote));
          expect(d).toBeLessThan(REACH + 0.02);
        }
      }
    }
  });

  it("les mains sont bien sur le volant : positions de la pose = points du volant (repère du torse)", () => {
    const b = braquage(0.5);
    const p = poseConducteuse({ v: 0, lacet: 0.5, tS: 0 });
    expect(dist(p.mains[1], cabineVersTorse(pointVolant(0, b), CABINE.volant.x))).toBeLessThan(1e-9);
    expect(dist(p.mains[0], cabineVersTorse(pointVolant(Math.PI, b), CABINE.volant.x))).toBeLessThan(1e-9);
  });

  it("le volant tourne avec le virage : à gauche (lacet > 0) la main droite monte, à droite elle descend", () => {
    const gauche = poseConducteuse({ v: 10, lacet: 0.8, tS: 0 }).mains[1];
    const droite = poseConducteuse({ v: 10, lacet: -0.8, tS: 0 }).mains[1];
    const tout = poseConducteuse({ v: 10, lacet: 0, tS: 0 }).mains[1];
    expect(gauche[1]).toBeGreaterThan(tout[1]);
    expect(droite[1]).toBeLessThan(tout[1]);
  });

  it("braquage et roulis sont plafonnés, de signes opposés dans le virage (poussée vers l'extérieur)", () => {
    expect(braquage(100)).toBe(0.9);
    expect(braquage(-100)).toBe(-0.9);
    expect(roulisVirage(30, 5)).toBe(-0.22);
    expect(roulisVirage(30, -5)).toBe(0.22);
    expect(roulisVirage(0, 3)).toBeCloseTo(0, 12);
  });

  it("elles se penchent en virage (roulis du torse) et la tête compense", () => {
    for (const f of [poseConducteuse, posePatronne]) {
      const virage = f({ v: 18, lacet: 1, tS: 0.4 });
      const droit = f({ v: 18, lacet: 0, tS: 0.4 });
      expect(virage.torse[2]).toBeLessThan(droit.torse[2]);
      expect(Math.sign(virage.tete[2])).toBe(-Math.sign(virage.torse[2]));
      expect(virage.assise).toBe(true);
    }
  });

  it("à l'arrêt : posées, mains immobiles (pas de secousse)", () => {
    const a = poseConducteuse({ v: 0, lacet: 0, tS: 0 });
    const b = poseConducteuse({ v: 0, lacet: 0, tS: 3.7 });
    expect(a).toEqual(b);
  });

  it("la patronne désigne la route une fois par période, mains à portée, et regarde Elsa le reste du temps", () => {
    let pointe = 0, regardeElsa = 0;
    for (let t = 0; t < 22; t += 0.1) {
      const p = posePatronne({ v: 12, lacet: 0, tS: t });
      const d = dist(versRepereTorse(p.mains[1], p.torse), epaule(1));
      expect(d).toBeLessThan(REACH + 0.1);
      if (p.mains[1][2] < -0.5) pointe++;
      if (p.tete[1] > 0.3) regardeElsa++;
    }
    expect(pointe).toBeGreaterThan(5);
    expect(regardeElsa).toBeGreaterThan(80);
    // la main gauche reste sur le tableau de bord
    const g = posePatronne({ v: 12, lacet: 0, tS: 1 }).mains[0];
    expect(dist(versRepereTorse(g, posePatronne({ v: 12, lacet: 0, tS: 1 }).torse), epaule(0))).toBeLessThan(REACH + 0.1);
  });
});

describe("comptoir du Truck garé", () => {
  const repos = { parle: null, sert: null, offre: false } as const;
  const portee = (p: PoseFigure) => p.mains.every((m, i) => dist(versRepereTorse(m, p.torse), epaule(i as 0 | 1)) < REACH + 0.2);

  it("debout, mains à portée, en toute situation", () => {
    for (const qui of ["elsa", "patronne"] as const) {
      for (const etat of [repos, { parle: "patronne", sert: null, offre: true }, { parle: "elsa", sert: "elsa", offre: true }, { parle: null, sert: "patronne", offre: true }] as const) {
        for (let t = 0; t < 10; t += 0.37) {
          const p = poseComptoir(qui, etat, t, qui === "elsa" ? -1 : 1);
          expect(p.assise).toBe(false);
          expect(portee(p)).toBe(true);
        }
      }
    }
  });

  it("celle qui sert lève le bras (la main au-dessus de l'épaule), pas l'autre", () => {
    const etat = { parle: null, sert: "elsa", offre: true } as const;
    const elsa = poseComptoir("elsa", etat, 1, -1);
    const patronne = poseComptoir("patronne", etat, 1, 1);
    expect(elsa.mains[1][1]).toBeGreaterThan(epaule(1)[1] + 0.3);
    expect(patronne.mains[1][1]).toBeLessThan(epaule(1)[1]);
    // sans offre, personne ne fait signe
    expect(poseComptoir("elsa", { parle: null, sert: "elsa", offre: false }, 1, -1).mains[1][1]).toBeLessThan(epaule(1)[1]);
  });

  it("l'autre se tourne vers celle qui parle, du bon côté", () => {
    const parle = { parle: "patronne", sert: null, offre: true } as const;
    expect(poseComptoir("elsa", parle, 0, -1).tete[1]).toBeLessThan(0);
    expect(poseComptoir("elsa", parle, 0, 1).tete[1]).toBeGreaterThan(0);
  });

  it("la patronne gesticule seulement quand elle parle", () => {
    const calme = poseComptoir("patronne", repos, 1.2, 1);
    const parle = poseComptoir("patronne", { parle: "patronne", sert: null, offre: true }, 1.2, 1);
    // poings sur les hanches au repos : la main est sous l'épaule, pas devant
    expect(calme.mains[1][1]).toBeLessThan(0);
    expect(calme.mains[1][2]).toBeGreaterThan(-0.1);
    expect(parle.mains[1][1]).toBeGreaterThan(calme.mains[1][1]);
  });
});
