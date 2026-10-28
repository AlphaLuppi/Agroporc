import { describe, expect, it } from "vitest";
import {
  COUTEAU, MELEE, STATS, apresTir, degatsPlomb, devier, directionsTir, dispersionCourante, dispersionTir, niveauZoomDefaut, niveauxZoom, gerbeRespectee, TOLERANCE_GERBE_RAD, multiplicateurChute, nomArme, refroidir, vitesseArme,
} from "./armes";
import { ARMES, ARMES_MELEE, ARMES_PRINCIPALES, ARMES_SECONDAIRES, ARMES_SPECIALES, ARMES_UNIQUES, JEU, PLAFONDS, type Vec3 } from "./protocole";
import { MOUV } from "./mouvement";

const angle = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
const norme = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

describe("STATS", () => {
  it("le catalogue compte 23 armes à feu (dont les 9 armes des zombies et les armes uniques du bus C3), une entrée chacune", () => {
    expect(ARMES).toHaveLength(23);
    expect(Object.keys(STATS).sort()).toEqual([...ARMES].sort());
  });

  it("chaque arme est cohérente", () => {
    for (const id of ARMES) {
      const a = STATS[id];
      expect(a.id).toBe(id);
      expect(a.plombs).toBeGreaterThanOrEqual(1);
      expect(a.cadenceS).toBeGreaterThan(0);
      expect(a.chargeur).toBeGreaterThan(0);
      expect(a.dispersion.max).toBeGreaterThanOrEqual(a.dispersion.base);
      expect(a.dispersion.mouvement).toBeGreaterThan(0);
      expect(a.dispersion.air).toBeGreaterThan(0);
      expect(a.chute.min).toBeGreaterThan(0);
      expect(a.chute.min).toBeLessThanOrEqual(1);
      expect(a.chute.debut).toBeLessThanOrEqual(a.chute.fin);
      expect(a.portee).toBeGreaterThan(0);
      expect(a.nom.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(10);
    }
  });

  it("catégories : cohérentes avec les listes d'ids de protocole.ts", () => {
    for (const id of ARMES_PRINCIPALES) expect(STATS[id].categorie).toBe("principale");
    for (const id of ARMES_SECONDAIRES) expect(STATS[id].categorie).toBe("secondaire");
    for (const id of ARMES_SPECIALES) expect(STATS[id].categorie).toBe("speciale");
    for (const id of ARMES_UNIQUES) expect(STATS[id].categorie).toBe("unique");
    expect(STATS.pistolet.categorie).toBe("secondaire");
  });

  it("nomCourt : au plus 10 caractères, uniques ; spéciales sans rechargement", () => {
    const courts = ARMES.map((id) => STATS[id].nomCourt);
    for (const c of courts) expect(c.length).toBeLessThanOrEqual(10);
    expect(new Set(courts).size).toBe(courts.length);
    for (const id of ARMES) {
      const a = STATS[id];
      expect(a.sansRecharge).toBe(a.categorie === "speciale" || a.categorie === "unique");
      if (a.sansRecharge) expect(a.rechargeS).toBe(0);
      else expect(a.rechargeS).toBeGreaterThan(0);
    }
  });

  it("valeurs de départ de la spec (les 4 armes historiques ont exactement leurs stats)", () => {
    expect(STATS.pistolet).toMatchObject({ degats: 28, multTete: 2, plombs: 1, cadenceS: 0.2, auto: false, chargeur: 12, rechargeS: 1.3 });
    expect(STATS.mitraillette).toMatchObject({ degats: 16, multTete: 1.6, cadenceS: 0.075, auto: true, chargeur: 32, rechargeS: 2.0 });
    expect(STATS.pompe).toMatchObject({ plombs: 9, multTete: 1.5, cadenceS: 0.85, chargeur: 6, rechargeS: 2.4, portee: 45 });
    expect(STATS.pompe.chute).toEqual({ debut: 8, fin: 30, min: 0.25 });
    expect(STATS.sniper).toMatchObject({ degats: 95, multTete: 2.5, cadenceS: 1.35, chargeur: 5, rechargeS: 2.9, vitesse: 0.9, zoom: 18.92 });
    expect(STATS.fusil_assaut).toMatchObject({ degats: 22, multTete: 1.8, cadenceS: 0.1, auto: true, chargeur: 30, portee: 140 });
    expect(STATS.mitrailleuse).toMatchObject({ degats: 19, cadenceS: 0.085, chargeur: 60, rechargeS: 4.2, vitesse: 0.88 });
    expect(STATS.revolver).toMatchObject({ degats: 55, multTete: 2, cadenceS: 0.5, auto: false, chargeur: 6 });
    expect(STATS.mini_uzi).toMatchObject({ degats: 11, cadenceS: 0.06, auto: true, chargeur: 25, vitesse: 1.05 });
    expect(STATS.railgun).toMatchObject({ degats: 140, multTete: 1.5, cadenceS: 1.2, chargeur: 6, portee: 500 });
    expect(STATS.minigun).toMatchObject({ degats: 13, multTete: 1.4, cadenceS: 0.04, auto: true, chargeur: 150, vitesse: 0.75 });
    expect(STATS.magnum_dore).toMatchObject({ degats: 70, multTete: 3, cadenceS: 0.7, chargeur: 8 });
  });

  it("seul le sniper a une lunette", () => {
    for (const id of ARMES) {
      if (id === "sniper") expect(STATS[id].zoom).toBe(18.92);
      else expect(STATS[id].zoom).toBeNull();
    }
  });

  it("seul le pompe (plusieurs plombs) a une gerbe", () => {
    for (const id of ARMES) {
      if (STATS[id].plombs > 1) expect(STATS[id].gerbe).toBeGreaterThan(0);
      else expect(STATS[id].gerbe).toBe(0);
    }
    expect(STATS.pompe.gerbe).toBeCloseTo(0.055, 6);
  });
});

describe("couteau, vitesseArme, nomArme", () => {
  it("le couteau multiplie la course de 30 % et tue un joueur sans bouclier", () => {
    expect(COUTEAU).toMatchObject({ degats: 100, portee: 2.2, margePortee: 0.6, cadenceS: 0.5, vitesse: 1.3 });
    expect(COUTEAU.degats).toBeGreaterThanOrEqual(JEU.pvMax);
    expect(COUTEAU.degats).toBeLessThan(JEU.pvMax + JEU.bouclierMax);
    expect(COUTEAU.cosCone).toBeCloseTo(Math.cos((55 * Math.PI) / 180), 2);
    expect(COUTEAU.nomCourt.length).toBeLessThanOrEqual(10);
  });

  it("vitesseArme et nomArme couvrent le couteau et les armes à feu", () => {
    expect(vitesseArme("couteau")).toBe(1.3);
    expect(vitesseArme("sniper")).toBe(0.9);
    expect(vitesseArme("pistolet")).toBe(1);
    expect(nomArme("couteau")).toBe("Couteau");
    for (const id of ARMES) expect(nomArme(id)).toBe(STATS[id].nom);
  });
});

describe("degatsPlomb", () => {
  it("corps et tête à bout portant, entiers", () => {
    expect(degatsPlomb("pistolet", "corps", 1)).toBe(28);
    expect(degatsPlomb("pistolet", "tete", 1)).toBe(56);
    expect(degatsPlomb("mitraillette", "corps", 1)).toBe(16);
    expect(degatsPlomb("mitraillette", "tete", 1)).toBe(26);
    expect(degatsPlomb("pompe", "corps", 1)).toBe(20);
    expect(degatsPlomb("pompe", "tete", 1)).toBe(30);
    expect(degatsPlomb("sniper", "corps", 1)).toBe(95);
    expect(degatsPlomb("sniper", "tete", 1)).toBe(238);
    for (const id of ARMES) for (const z of ["tete", "corps"] as const) for (const d of [0, 3.7, 22.2, 61.3]) {
      expect(Number.isInteger(degatsPlomb(id, z, d))).toBe(true);
    }
  });

  it("la chute est linéaire entre début et fin puis plafonnée", () => {
    expect(multiplicateurChute("pompe", 8)).toBe(1);
    expect(multiplicateurChute("pompe", 30)).toBeCloseTo(0.25, 9);
    expect(multiplicateurChute("pompe", 19)).toBeCloseTo(0.625, 9);
    expect(degatsPlomb("pompe", "corps", 30)).toBe(5);
    expect(degatsPlomb("pompe", "corps", 100)).toBe(5);
    expect(degatsPlomb("pompe", "corps", 19)).toBeLessThan(degatsPlomb("pompe", "corps", 8));
    // la chute ne fait jamais gagner de dégâts
    for (const id of ARMES) {
      let precedent = Infinity;
      for (let d = 0; d <= STATS[id].portee; d += 2.5) {
        const v = degatsPlomb(id, "corps", d);
        expect(v).toBeLessThanOrEqual(precedent);
        precedent = v;
      }
    }
    // pistolet : -30 % au plus, sniper : aucune chute
    expect(degatsPlomb("pistolet", "corps", 200)).toBe(Math.round(28 * 0.7));
    expect(degatsPlomb("sniper", "corps", 399)).toBe(95);
  });

  it("un tir de sniper à la tête tue, au corps non", () => {
    expect(degatsPlomb("sniper", "tete", 300)).toBeGreaterThanOrEqual(JEU.pvMax);
    expect(degatsPlomb("sniper", "corps", 1)).toBeLessThan(JEU.pvMax);
  });

  it("le pompe à bout portant tue si la majorité des plombs touchent", () => {
    const n = STATS.pompe.plombs;
    const majorite = Math.floor(n / 2) + 1;
    expect(majorite * degatsPlomb("pompe", "corps", 3)).toBeGreaterThanOrEqual(JEU.pvMax);
    expect((majorite - 1) * degatsPlomb("pompe", "corps", 3)).toBeLessThan(JEU.pvMax);
    // à 30 m, même les 9 plombs ne tuent pas
    expect(n * degatsPlomb("pompe", "corps", 30)).toBeLessThan(JEU.pvMax);
  });

  it("pistolet : 4 balles au corps tuent, mitraillette : 7", () => {
    expect(4 * degatsPlomb("pistolet", "corps", 5)).toBeGreaterThanOrEqual(JEU.pvMax);
    expect(3 * degatsPlomb("pistolet", "corps", 5)).toBeLessThan(JEU.pvMax);
    expect(7 * degatsPlomb("mitraillette", "corps", 5)).toBeGreaterThanOrEqual(JEU.pvMax);
  });

  it("armes spéciales : le railgun à la tête tue à toute distance, le magnum doré jusqu'à 40 m, le minigun jamais en un coup", () => {
    const mort = JEU.pvMax + JEU.bouclierMax;
    expect(degatsPlomb("railgun", "tete", 1)).toBe(210);
    for (const d of [10, 100, 300, 500]) expect(degatsPlomb("railgun", "tete", d)).toBeGreaterThanOrEqual(mort);
    expect(degatsPlomb("magnum_dore", "tete", 40)).toBeGreaterThanOrEqual(mort);
    expect(degatsPlomb("magnum_dore", "tete", 120)).toBeLessThan(mort);
    for (const d of [1, 30, 100]) expect(degatsPlomb("minigun", "tete", d)).toBeLessThan(mort);
  });
});

describe("aucune dispersion (v2 §13.1)", () => {
  const contextes = [
    { vitesseH: 0, auSol: true, vise: false, chaleur: 0 },
    { vitesseH: 9, auSol: true, vise: false, chaleur: 0 },
    { vitesseH: 100, auSol: false, vise: false, chaleur: 10 },
    { vitesseH: 0, auSol: true, vise: true, chaleur: 0 },
    { vitesseH: 12, auSol: false, vise: true, chaleur: 0.1, accroupi: true },
  ];

  it("dispersionCourante renvoie 0 pour toute arme, quel que soit le contexte", () => {
    for (const id of ARMES) {
      for (const ctx of contextes) expect(dispersionCourante(id, ctx)).toBe(0);
      expect(dispersionCourante(id)).toBe(0);
    }
  });

  it("la chaleur reste calculable (plafonnée, retombe) mais n'a aucun effet sur la dispersion", () => {
    let ch = 0;
    for (let i = 0; i < 6; i++) ch = apresTir("mitraillette", ch);
    expect(ch).toBeCloseTo(6 * STATS.mitraillette.dispersion.parTir, 9);
    expect(dispersionCourante("mitraillette", { chaleur: ch })).toBe(0);
    let long = 0;
    for (let i = 0; i < 200; i++) long = apresTir("mitraillette", long);
    expect(long).toBeLessThanOrEqual(STATS.mitraillette.dispersion.max);
    expect(refroidir("mitraillette", long, STATS.mitraillette.dispersion.retourS)).toBe(0);
    expect(apresTir("pompe", 0)).toBe(0);
  });
});

describe("directionsTir", () => {
  const visees: Vec3[] = [[0, 0, -1], [1, 0, 0], [0, 1, 0], [0, -1, 0], [0.6, 0.48, -0.64], [-0.3, -0.2, 0.9327379053088815]];
  const normalise = (d: Vec3): Vec3 => { const n = norme(d); return [d[0] / n, d[1] / n, d[2] / n]; };

  it("renvoie `plombs` directions normalisées", () => {
    for (const id of ARMES) for (const d of visees) {
      const dirs = directionsTir(id, d);
      expect(dirs.length).toBe(STATS[id].plombs);
      for (const v of dirs) expect(norme(v)).toBeCloseTo(1, 9);
    }
  });

  it("une arme à un seul plomb tire exactement dans l'axe de la vue", () => {
    for (const id of ARMES) {
      if (STATS[id].plombs !== 1) continue;
      for (const d of visees) {
        const [v] = directionsTir(id, d);
        const n = normalise(d);
        expect(v[0]).toBeCloseTo(n[0], 12);
        expect(v[1]).toBeCloseTo(n[1], 12);
        expect(v[2]).toBeCloseTo(n[2], 12);
      }
    }
    expect(directionsTir("sniper", [3, 0, 4])[0]).toEqual([0.6, 0, 0.8]);
    expect(directionsTir("pistolet", [0, 0, -2])[0]).toEqual([0, 0, -1]);
  });

  it("le pompe : un plomb au centre et huit sur un cercle de demi-angle constant, réparties régulièrement", () => {
    const g = STATS.pompe.gerbe;
    for (const d of visees) {
      const dirs = directionsTir("pompe", d);
      const n = normalise(d);
      expect(dirs).toHaveLength(9);
      expect(angle(n, dirs[0])).toBeCloseTo(0, 6);
      for (let i = 1; i < dirs.length; i++) expect(angle(n, dirs[i])).toBeCloseTo(g, 9);
      // huit plombs distincts, voisins espacés de la même corde
      const cordes: number[] = [];
      for (let i = 1; i <= 8; i++) cordes.push(angle(dirs[i], dirs[i === 8 ? 1 : i + 1]));
      for (const c of cordes) expect(c).toBeCloseTo(cordes[0], 6);
      expect(new Set(dirs.map((v) => v.map((x) => x.toFixed(9)).join(","))).size).toBe(9);
    }
  });

  it("aucun hasard : le même tir donne toujours les mêmes directions", () => {
    for (const d of visees) {
      expect(directionsTir("pompe", d)).toEqual(directionsTir("pompe", d));
      expect(directionsTir("mitraillette", d)).toEqual(directionsTir("mitraillette", d));
    }
  });

  it("la gerbe est centrée sur l'axe : la somme des plombs est colinéaire à la visée", () => {
    for (const d of visees) {
      const dirs = directionsTir("pompe", d);
      const s: Vec3 = [0, 0, 0];
      for (const v of dirs) { s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; }
      expect(angle(normalise(s), normalise(d))).toBeCloseTo(0, 6);
    }
  });
});

describe("gerbeRespectee (vérification serveur de la gerbe du pompe, §13.1)", () => {
  const axe = (lacet: number, tangage: number): Vec3 => [-Math.sin(lacet) * Math.cos(tangage), Math.sin(tangage), -Math.cos(lacet) * Math.cos(tangage)];

  it("la gerbe exacte de directionsTir passe, quelle que soit la visée (y compris à la verticale)", () => {
    for (const d of [axe(0, 0), axe(1.3, -0.4), axe(-2.5, 0.9), [0, 1, 0] as Vec3, [0, -1, 0] as Vec3]) {
      expect(gerbeRespectee("pompe", directionsTir("pompe", d))).toBe(true);
    }
  });
  it("une gerbe arrondie à 1e-3 (JSON réseau) passe", () => {
    const arr = directionsTir("pompe", axe(0.7, -0.2)).map((v) => v.map((x) => Math.round(x * 1000) / 1000) as Vec3);
    expect(gerbeRespectee("pompe", arr)).toBe(true);
  });
  it("un tir partiel (moins de plombs que l'arme) passe tant que les plombs présents sont à leur place", () => {
    expect(gerbeRespectee("pompe", directionsTir("pompe", axe(0.2, 0)).slice(0, 3))).toBe(true);
  });
  it("tous les plombs dans l'axe (gerbe supprimée par un client modifié) : refusé", () => {
    const d = axe(0.2, 0);
    expect(gerbeRespectee("pompe", Array.from({ length: 9 }, () => [...d] as Vec3))).toBe(false);
  });
  it("un plomb écarté de plus de 0,02 rad de sa place : refusé ; de moins : accepté", () => {
    const base = directionsTir("pompe", axe(0.2, 0));
    const decaler = (rad: number): Vec3[] => base.map((v, i) => {
      if (i !== 4) return v;
      const x = v[0] + Math.cos(0.2) * rad, z = v[2] - Math.sin(0.2) * rad; // glissement latéral
      const n = Math.hypot(x, v[1], z);
      return [x / n, v[1] / n, z / n] as Vec3;
    });
    expect(gerbeRespectee("pompe", decaler(TOLERANCE_GERBE_RAD * 0.5))).toBe(true);
    expect(gerbeRespectee("pompe", decaler(TOLERANCE_GERBE_RAD * 2))).toBe(false);
  });
  it("plus de plombs que l'arme n'en tire : refusé ; arme à un plomb : toujours conforme", () => {
    expect(gerbeRespectee("pompe", Array.from({ length: 10 }, () => [0, 0, -1] as Vec3))).toBe(false);
    expect(gerbeRespectee("pistolet", [[0, 0, -1]])).toBe(true);
    expect(gerbeRespectee("pistolet", [[0, 0, -1], [0, 0, -1]])).toBe(false);
  });
});

describe("sniper sans lunette (v3 §1)", () => {
  it("seule une arme à lunette a une dispersion, et jamais en lunette", () => {
    for (const id of ARMES) {
      const hors = dispersionTir(id, { lunette: false, vitesseH: 0, auSol: true });
      if (id === "sniper") expect(hors).toBeGreaterThan(0.03);
      else expect(hors).toBe(0);
      expect(dispersionTir(id, { lunette: true, vitesseH: 12, auSol: false })).toBe(0);
    }
  });

  it("le mouvement et le saut écartent davantage, plafonnés", () => {
    const arret = dispersionTir("sniper", { lunette: false, vitesseH: 0, auSol: true });
    const course = dispersionTir("sniper", { lunette: false, vitesseH: 9, auSol: true });
    const air = dispersionTir("sniper", { lunette: false, vitesseH: 9, auSol: false });
    expect(course).toBeGreaterThan(arret);
    expect(air).toBeGreaterThan(course);
    expect(dispersionTir("sniper", { lunette: false, vitesseH: 100, auSol: true }))
      .toBeCloseTo(dispersionTir("sniper", { lunette: false, vitesseH: 13.5, auSol: true }), 9);
  });

  it("devier reste dans le cône, normalisé, et rend l'axe pour un angle nul", () => {
    const d: Vec3 = [0.3, 0.2, -0.93];
    const n = norme(d);
    const axe: Vec3 = [d[0] / n, d[1] / n, d[2] / n];
    expect(angle(devier(d, 0, 0.7, 0.2), axe)).toBeLessThan(1e-9);
    for (let i = 0; i < 200; i++) {
      const r = devier(d, 0.05, (i * 0.37) % 1, (i * 0.61) % 1);
      expect(norme(r)).toBeCloseTo(1, 9);
      expect(angle(r, axe)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
    // u = 1 : sur le bord du cône
    expect(angle(devier(d, 0.05, 1, 0.3), axe)).toBeCloseTo(0.05, 6);
    // vertical : base de repli
    expect(angle(devier([0, 1, 0], 0.05, 1, 0), [0, 1, 0])).toBeCloseTo(0.05, 6);
  });

  it("niveaux de zoom : ×3, ×6 (défaut) et ×12 pour le sniper, aucun sans lunette", () => {
    const x = (fov: number) => Math.round(Math.tan(Math.PI / 4) / Math.tan((fov * Math.PI) / 360));
    expect(niveauxZoom("sniper").map(x)).toEqual([3, 6, 12]);
    expect(niveauxZoom("sniper")[niveauZoomDefaut("sniper")]).toBe(STATS.sniper.zoom);
    expect(niveauxZoom("pistolet")).toEqual([]);
    expect(niveauZoomDefaut("pistolet")).toBe(0);
  });
});

describe("MELEE (couteau et épée)", () => {
  it("une entrée par arme de mêlée, COUTEAU = MELEE.couteau", () => {
    expect(Object.keys(MELEE).sort()).toEqual([...ARMES_MELEE].sort());
    expect(COUTEAU).toBe(MELEE.couteau);
    for (const id of ARMES_MELEE) expect(MELEE[id].id).toBe(id);
  });

  it("couteau inchangé : 100 / 100, portée 2,2 (+0,6), 0,5 s, ×1,3, cône 55°, 1 cible, coup de 0,40 s", () => {
    expect(MELEE.couteau).toMatchObject({
      degats: 100, degatsZombie: 150, portee: 2.2, margePortee: 0.6, cadenceS: 0.5, vitesse: 1.3, cosCone: 0.574, nbCiblesMax: 1, dureeCoupS: 0.4,
    });
  });

  it("épée conforme à la spec : 140 / 220, portée 2,6 (+0,7), 0,85 s, ×1,2, cône 70°, 3 cibles, coup de 0,55 s", () => {
    expect(MELEE.epee).toMatchObject({
      degats: 140, degatsZombie: 1000, portee: 2.6, margePortee: 0.7, cadenceS: 0.85, vitesse: 1.2, cosCone: 0.342, nbCiblesMax: 3, dureeCoupS: 0.55,
    });
    expect(MELEE.epee.cosCone).toBeCloseTo(Math.cos((70 * Math.PI) / 180), 2);
    // tue un joueur sans bouclier en un coup, mais pas avec bouclier plein
    expect(MELEE.epee.degats).toBeGreaterThanOrEqual(JEU.pvMax);
    expect(MELEE.epee.degats).toBeLessThan(JEU.pvMax + JEU.bouclierMax);
  });

  it("l'épée est plus lente et plus longue que le couteau", () => {
    expect(MELEE.epee.cadenceS).toBeGreaterThan(MELEE.couteau.cadenceS);
    expect(MELEE.epee.vitesse).toBeLessThan(MELEE.couteau.vitesse);
    expect(MELEE.epee.portee).toBeGreaterThan(MELEE.couteau.portee);
  });

  it("noms courts de 10 caractères au plus ; textes renseignés", () => {
    for (const id of ARMES_MELEE) {
      expect(MELEE[id].nomCourt.length).toBeLessThanOrEqual(10);
      expect(MELEE[id].nom.length).toBeGreaterThan(0);
      expect(MELEE[id].description.length).toBeGreaterThan(0);
    }
  });

  it("invariant de vitesse : le sprint avec l'épée (12,5 × 1,2 = 15 m/s) reste sous le plafond horizontal accepté par le serveur", () => {
    for (const id of ARMES_MELEE) expect(MOUV.sprint * MELEE[id].vitesse).toBeLessThanOrEqual(PLAFONDS.vitesseHorizontaleMax);
    expect(MOUV.sprint * MELEE.epee.vitesse).toBeCloseTo(15, 6);
  });

  it("vitesseArme et nomArme couvrent l'épée", () => {
    expect(vitesseArme("epee")).toBe(1.2);
    expect(nomArme("epee")).toBe("Épée");
    expect(vitesseArme("couteau")).toBe(1.3);
  });
});
