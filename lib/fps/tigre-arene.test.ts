import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lireCachettes, type FichierCachettes } from "../agroparc3d/cachettes";
import type { Building, SceneData } from "../agroparc3d/types";
import { cachettesDansAnneau } from "./avion";
import { construireMonde, pointsApparition, type Monde } from "./collision";
import { ROND_POINT, ZONE_APPARITION } from "./zones";
import type { Vec3 } from "./protocole";
import {
  TIGRE, TIGRE_ALLIE, avancerTigreAllie, avancerTigreSauvage, blesserTigre, capDeCachette, capVers, choisirCachetteFuite,
  chercherChemin, coupTigreVraisemblable, creerTigreAllie, creerTigreSauvage, grilleNav, hitboxTigre, recoupeVoiture, routeLibre,
  SILHOUETTES_TIGRE, toucheTigreVraisemblable, tracerTigre,
  type CachetteTigre, type EnvTigre, type EvenementTigre, type JoueurVu, type ObstacleVoiture, type Tigre,
} from "./tigre-arene";

// ---------- monde de test ----------

function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
/** Deux plots lointains élargissent les bornes à ±225 m (bornes = centroïdes ± 25 m). */
const PLOTS = [rect(-201, -201, -199, -199, 3), rect(199, 199, 201, 201, 3)];
const monde = (...batiments: Building[]): Monde =>
  construireMonde({ buildings: [...PLOTS, ...batiments], pois: [], roads: [], parkings: [], water: [], trees: [] } as unknown as SceneData);
const VIDE = monde();
/** Mur de 20 m de large (x de −10 à 10), épais de 2 m (z de −1 à 1), haut de 10 m. */
const MUR = rect(-10, -1, 10, 1, 10);
const AVEC_MUR = monde(MUR);

const T0 = 1_000_000;
const DT = 1 / 60;
const PAS_MS = 1000 / 60;

const joueur = (id: string, x: number, z: number, surcharge: Partial<JoueurVu> = {}): JoueurVu =>
  ({ id, p: [x, 0, z], protege: false, aPied: true, ...surcharge });
const CACHETTES: CachetteTigre[] = [
  { x: 0, z: 0, cap: 0 }, { x: 100, z: 0, cap: 0 }, { x: 0, z: 120, cap: 0 }, { x: -90, z: -40, cap: 0 }, { x: 30, z: 30, cap: 0 },
];
function env(m: Monde, joueurs: JoueurVu[], voitures: ObstacleVoiture[] = [], alea: () => number = () => 0): EnvTigre {
  return { monde: m, alea, joueurs, voitures, cachettes: CACHETTES };
}
/** Tigre sauvage déjà posé et tapi dans sa cachette (0, 0). */
function tapi(m: Monde = VIDE, maintenant = T0): Tigre {
  const t = creerTigreSauvage("t1", [0, TIGRE.descenteMs, 0], CACHETTES[0], maintenant - TIGRE.descenteMs);
  avancerTigreSauvage(t, maintenant, DT, env(m, []));
  expect(t.etat).toBe("tapi");
  return t;
}
/** Fait tourner un tigre sauvage `ms` millisecondes à 60 Hz, renvoie les événements et l'instant final. */
function tourner(t: Tigre, e: EnvTigre, depuis: number, ms: number, avant?: (maintenant: number) => void): { ev: EvenementTigre[]; fin: number } {
  const ev: EvenementTigre[] = [];
  let maintenant = depuis;
  const n = Math.round(ms / PAS_MS);
  for (let k = 1; k <= n; k++) {
    maintenant = depuis + Math.round(k * PAS_MS);
    avant?.(maintenant);
    ev.push(...avancerTigreSauvage(t, maintenant, DT, e));
  }
  return { ev, fin: maintenant };
}
const coups = (ev: EvenementTigre[]) => ev.filter((e): e is Extract<EvenementTigre, { type: "coup" }> => e.type === "coup");

// ---------- descente ----------

describe("descente en parachute", () => {
  it("descend en ligne droite vers la cachette en 12 s, puis se tapit couché au cap de la cachette", () => {
    const cachette: CachetteTigre = { x: 10, z: 20, cap: 1.2 };
    const t = creerTigreSauvage("t1", [40, 120, 20], cachette, T0);
    expect(t).toMatchObject({ etat: "descente", pv: TIGRE.pvSauvage, genre: "sauvage", lanceur: null });
    expect(avancerTigreSauvage(t, T0 + 6000, DT, env(VIDE, []))).toEqual([]);
    expect(t.p[0]).toBeCloseTo(25, 5);
    expect(t.p[1]).toBeCloseTo(60, 5);
    const ev = avancerTigreSauvage(t, T0 + TIGRE.descenteMs, DT, env(VIDE, []));
    expect(ev).toEqual([{ type: "atterri" }]);
    expect(t).toMatchObject({ etat: "tapi", pose: "couche", cap: 1.2, p: [10, 0, 20] });
  });

  it("un tir pendant la descente : il atterrit en alerte vers son agresseur", () => {
    const t = creerTigreSauvage("t1", [0, 120, 0], CACHETTES[0], T0);
    blesserTigre(t, 100, "a", T0 + 1000);
    expect(t.etat).toBe("descente");
    expect(t.pv).toBe(TIGRE.pvSauvage - 100);
    const ev = avancerTigreSauvage(t, T0 + TIGRE.descenteMs, DT, env(VIDE, [joueur("a", 50, 0)]));
    expect(ev).toEqual([{ type: "atterri" }, { type: "alerte", cible: "a" }]);
    expect(t.etat).toBe("alerte");
  });

  it("cap des cachettes : le museau du fichier (sin, cos) devient la direction (−sin, −cos) du cap", () => {
    for (const c of [0, 1, -2, 3]) {
      const cap = capDeCachette(c);
      expect(-Math.sin(cap)).toBeCloseTo(Math.sin(c), 9);
      expect(-Math.cos(cap)).toBeCloseTo(Math.cos(c), 9);
    }
  });
});

// ---------- tapi, alerte ----------

describe("tapi puis alerte", () => {
  it("un joueur à 25 m ne l'alerte pas, à 15 m en vue oui", () => {
    const t = tapi();
    expect(tourner(t, env(VIDE, [joueur("a", 25, 0)]), T0, 500).ev).toEqual([]);
    expect(t.etat).toBe("tapi");
    const { ev } = tourner(t, env(VIDE, [joueur("a", 15, 0)]), T0 + 500, 200);
    expect(ev).toEqual([{ type: "alerte", cible: "a" }]);
    expect(t).toMatchObject({ etat: "alerte", cible: "a", pose: "debout" });
  });

  it("un joueur à 15 m derrière un mur ne l'alerte pas", () => {
    const t = tapi(AVEC_MUR);
    t.p = [0, 0, 5];
    expect(tourner(t, env(AVEC_MUR, [joueur("a", 0, -10)]), T0, 500).ev).toEqual([]);
    expect(t.etat).toBe("tapi");
  });

  it("un joueur protégé (apparition) ou en voiture ne l'alerte pas", () => {
    const t = tapi();
    const e = env(VIDE, [joueur("a", 5, 0, { protege: true }), joueur("b", 6, 0, { aPied: false })]);
    expect(tourner(t, e, T0, 500).ev).toEqual([]);
  });

  it("des dégâts l'alertent, même de loin ; il se tourne vers l'agresseur puis attaque après 0,8 s", () => {
    const t = tapi();
    blesserTigre(t, 50, "a", T0);
    expect(t).toMatchObject({ etat: "alerte", cible: "a" });
    const e = env(VIDE, [joueur("a", 60, 0)]);
    tourner(t, e, T0, TIGRE.alerteMs - 50);
    expect(t.etat).toBe("alerte");
    expect(-Math.sin(t.cap)).toBeCloseTo(1, 5); // face à +x
    tourner(t, e, T0 + TIGRE.alerteMs - 50, 100);
    expect(t.etat).toBe("attaque");
  });
});

// ---------- attaque ----------

describe("attaque", () => {
  function enAttaque(m: Monde = VIDE): { t: Tigre; debut: number } {
    const t = tapi(m);
    blesserTigre(t, 10, "a", T0);
    const debut = T0 + TIGRE.alerteMs + 20;
    avancerTigreSauvage(t, debut, DT, env(m, [joueur("a", 200, 0)]));
    expect(t.etat).toBe("attaque");
    return { t, debut };
  }

  it("poursuit à 10,5 m/s, sous le sprint des joueurs (12,5 m/s)", () => {
    const { t, debut } = enAttaque();
    const e = env(VIDE, [joueur("a", 60, 0)]);
    tourner(t, e, debut, 100);
    const x0 = t.p[0];
    tourner(t, e, debut + 100, 2000);
    const v = (t.p[0] - x0) / 2;
    expect(v).toBeGreaterThan(10);
    expect(v).toBeLessThanOrEqual(TIGRE.vitesseCourse + 1e-6);
    expect(TIGRE.vitesseCourse).toBeLessThan(12.5);
    expect(t.pose).toBe("course");
  });

  it("préfère son dernier agresseur au joueur le plus proche", () => {
    const { t, debut } = enAttaque();
    const e = env(VIDE, [joueur("a", 50, 0), joueur("b", -8, 0)]);
    tourner(t, e, debut, 300);
    expect(t.cible).toBe("a");
  });

  it("coup de patte à 2,5 m : 25 dégâts toutes les 1,2 s, armé 250 ms", () => {
    const { t, debut } = enAttaque();
    const e = env(VIDE, [joueur("a", 2, 0)]);
    t.prochainBondT = Infinity;
    const { ev } = tourner(t, e, debut, 6000);
    const c = coups(ev);
    expect(c.length).toBe(5); // 0 / 1,2 / 2,4 / 3,6 / 4,8 s
    expect(c.every((x) => x.degats === 25 && x.action === "patte" && x.cible === "a")).toBe(true);
  });

  it("la patte manque une cible qui s'est écartée pendant l'armement", () => {
    const { t, debut } = enAttaque();
    t.prochainBondT = Infinity;
    const a = joueur("a", 2, 0);
    const { ev } = tourner(t, env(VIDE, [a]), debut, 1000, (m) => { if (m - debut > 30) a.p = [6, 0, 0]; });
    expect(coups(ev).length).toBe(0);
  });

  it("bond annoncé 0,6 s (il se ramasse, immobile), portée 6 à 10 m, 40 dégâts, une fois toutes les 7 s", () => {
    const { t, debut } = enAttaque();
    t.p = [0, 0, 0];
    const a = joueur("a", 8, 0);
    const e = env(VIDE, [a]);
    tourner(t, e, debut, 50);
    expect(t.action).toBe("ramasse");
    const debutRamasse = t.actionT;
    const p0 = [...t.p];
    tourner(t, e, debut + 50, 500);
    expect(t.p).toEqual(p0); // immobile pendant l'annonce
    const { ev } = tourner(t, e, debut + 550, 900);
    const c = coups(ev);
    expect(c[0]).toMatchObject({ action: "bond", degats: 40, cible: "a" });
    expect(t.prochainBondT).toBe(debutRamasse + TIGRE.bond.cadenceMs);
    expect(TIGRE.bond.annonceMs).toBe(600);
  });

  it("aucun coup ne dépasse 40 : simulation de 60 s avec trois joueurs qui tournent autour du tigre", () => {
    const { t, debut } = enAttaque();
    const js = [joueur("a", 5, 0), joueur("b", -7, 3), joueur("c", 0, 9)];
    let aleaK = 1;
    const alea = () => (aleaK = (aleaK * 16807) % 2147483647) / 2147483647;
    const { ev } = tourner(t, env(VIDE, js, [], alea), debut, 60_000, (m) => {
      js.forEach((j, i) => {
        const a = (m / 1000) * (0.4 + i * 0.3);
        const r = 3 + 6 * Math.abs(Math.sin(m / 3000 + i));
        j.p = [Math.cos(a) * r + t.p[0] * 0, 0, Math.sin(a) * r];
      });
    });
    const c = coups(ev);
    expect(c.length).toBeGreaterThan(10);
    expect(Math.max(...c.map((x) => x.degats))).toBeLessThanOrEqual(TIGRE.coupMax);
    expect(TIGRE.coupMax).toBeLessThan(100);
    // aucun joueur ne perd plus de 40 PV d'un seul coup : pas de mort en un coup
    expect(c.some((x) => x.action === "bond")).toBe(true);
  });

  it("contourne un mur pour rejoindre sa cible, sans jamais y entrer", () => {
    const { t, debut } = enAttaque(AVEC_MUR);
    t.p = [0, 0, 8];
    t.prochainBondT = Infinity;
    const e = env(AVEC_MUR, [joueur("a", 0, -8)]);
    let dedans = false;
    const { ev } = tourner(t, e, debut, 8000, () => {
      if (t.p[0] > -10 + 0.3 && t.p[0] < 10 - 0.3 && t.p[2] > -1 + 0.3 && t.p[2] < 1 - 0.3) dedans = true;
    });
    expect(dedans).toBe(false);
    expect(coups(ev).length).toBeGreaterThan(0);
  });

  it("sans cible pendant 6 s, il rentre à sa cachette et s'y tapit", () => {
    const { t, debut } = enAttaque();
    t.p = [12, 0, 0];
    t.agresseur = null;
    t.cible = null;
    const e = env(VIDE, []);
    tourner(t, e, debut, TIGRE.sansCibleMs + 100);
    expect(t.etat).toBe("retour");
    tourner(t, e, debut + TIGRE.sansCibleMs + 100, 5000);
    expect(t).toMatchObject({ etat: "tapi", pose: "couche" });
    expect(Math.hypot(t.p[0], t.p[2])).toBeLessThan(TIGRE.arriveeM);
  });
});

// ---------- fuite, repos, départ ----------

describe("fuite et régénération", () => {
  it("sous 30 % des PV il s'enfuit vers une cachette à plus de 60 m, s'y repose, régénère 15 PV/s après 8 s jusqu'à 50 %, puis se tapit", () => {
    const t = tapi();
    blesserTigre(t, 10, "a", T0);
    const r = blesserTigre(t, TIGRE.pvSauvage * 0.7, "a", T0 + 10);
    expect(r.mort).toBe(false);
    expect(t.pv).toBeLessThan(TIGRE.seuilFuite * TIGRE.pvSauvage);
    expect(t.etat).toBe("fuite");
    const e = env(VIDE, [joueur("a", 3, 0)]);
    const { ev, fin } = tourner(t, e, T0 + 10, 100);
    expect(ev.some((x) => x.type === "fuite")).toBe(true);
    expect(coups(ev)).toEqual([]); // il fuit, il ne frappe pas
    expect(Math.hypot(t.cachette.x, t.cachette.z)).toBeGreaterThan(TIGRE.fuiteDistanceMin);
    // 100 m à 10,5 m/s
    const r2 = tourner(t, e, fin, 12_000);
    expect(t.etat).toBe("repos");
    const pvRepos = t.pv;
    const arrivee = T0 + 10 + TIGRE.reposDelaiMs;
    const r3 = tourner(t, env(VIDE, []), r2.fin, Math.max(0, arrivee - r2.fin) - 100);
    expect(t.pv).toBe(pvRepos); // pas de régénération avant 8 s sans dégât
    tourner(t, env(VIDE, []), r3.fin, 2100);
    expect(t.pv).toBeGreaterThanOrEqual(pvRepos + 28);
    expect(t.pv).toBeLessThanOrEqual(pvRepos + 33);
    tourner(t, env(VIDE, []), r3.fin + 2100, 60_000);
    expect(t.pv).toBe(TIGRE.regenPlafond * TIGRE.pvSauvage);
    expect(t.etat).toBe("tapi");
    expect(t.fuiteFaite).toBe(false);
  });

  it("aucune régénération en combat", () => {
    const t = tapi();
    blesserTigre(t, 1000, "a", T0);
    const pv = t.pv;
    tourner(t, env(VIDE, [joueur("a", 30, 0)]), T0, 20_000);
    expect(t.pv).toBe(pv);
  });

  it("blessé au repos, il attaque (acculé) et ne refuit pas tant qu'il n'est pas remonté au-dessus de 30 %", () => {
    const t = tapi();
    blesserTigre(t, TIGRE.pvSauvage * 0.75, "a", T0);
    expect(t.etat).toBe("fuite");
    t.etat = "repos";
    blesserTigre(t, 10, "a", T0 + 100);
    expect(t.etat).toBe("alerte");
    blesserTigre(t, 10, "a", T0 + 200);
    expect(t.etat).toBe("alerte");
  });

  it("choisirCachetteFuite : toujours à plus de 60 m quand il en existe", () => {
    const t = tapi();
    for (const a of [0, 0.3, 0.6, 0.99]) {
      const c = choisirCachetteFuite(t, CACHETTES, () => a);
      expect(Math.hypot(c.x - t.p[0], c.z - t.p[2])).toBeGreaterThan(60);
    }
  });

  it("repart au bout de 4 min s'il n'a pas été tué", () => {
    const t = creerTigreSauvage("t1", [0, 120, 0], CACHETTES[0], T0);
    expect(avancerTigreSauvage(t, T0 + TIGRE.dureeSauvageMs - 1, DT, env(VIDE, []))).not.toContainEqual({ type: "parti" });
    expect(avancerTigreSauvage(t, T0 + TIGRE.dureeSauvageMs, DT, env(VIDE, []))).toEqual([{ type: "parti" }]);
    expect(TIGRE.dureeSauvageMs).toBe(240_000);
  });

  it("2 500 PV, la mort au dernier coup, plus rien ensuite", () => {
    const t = tapi();
    expect(blesserTigre(t, 2499, "a", T0)).toEqual({ subi: 2499, mort: false });
    expect(blesserTigre(t, 22, "b", T0 + 1)).toEqual({ subi: 1, mort: true });
    expect(blesserTigre(t, 22, "b", T0 + 2)).toEqual({ subi: 0, mort: false });
    expect(avancerTigreSauvage(t, T0 + 10, DT, env(VIDE, [joueur("a", 1, 0)]))).toEqual([]);
  });
});

// ---------- voitures ----------

describe("voitures", () => {
  const voiture = (x: number, z: number, vitesse: number, conducteur: string | null = null): ObstacleVoiture =>
    ({ p: [x, 0, z], cap: Math.PI / 2, demiLongueur: 2.2, demiLargeur: 0.95, vitesse, conducteur });

  it("ne traverse pas une voiture garée sur son chemin", () => {
    const t = tapi();
    blesserTigre(t, 10, "a", T0);
    const e = env(VIDE, [joueur("a", 20, 0)], [voiture(8, 0, 0)]);
    let dans = false;
    tourner(t, e, T0, 5000, () => { if (recoupeVoiture(t.p[0], t.p[2], 0, TIGRE.rayon - 0.05, e.voitures[0])) dans = true; });
    expect(dans).toBe(false);
    expect(t.p[0]).toBeGreaterThan(12);
  });

  it("une voiture lancée lui inflige 150 dégâts, au plus un choc par seconde, crédités au conducteur", () => {
    const t = tapi();
    const e = env(VIDE, [], [voiture(0.5, 0, 9, "c")]);
    const { ev } = tourner(t, e, T0, 1500, () => { e.voitures[0].p = [0.5, 0, 0]; t.p = [0, 0, 0]; });
    const chocs = ev.filter((x) => x.type === "voiture");
    expect(chocs).toEqual([
      { type: "voiture", degats: 150, conducteur: "c", mort: false },
      { type: "voiture", degats: 150, conducteur: "c", mort: false },
    ]);
    expect(t.pv).toBe(TIGRE.pvSauvage - 300);
  });

  it("le choc ne tue pas un tigre allié plein d'un coup (500 PV)", () => {
    const t = creerTigreAllie("t2", { id: "l", p: [0, 0, 0], lacet: 0 }, VIDE, T0);
    const e = env(VIDE, [], [voiture(t.p[0], t.p[2], 9)]);
    const ev = avancerTigreAllie(t, joueur("l", 0, 0), T0 + 10, DT, e);
    expect(ev).toEqual([{ type: "voiture", degats: 150, conducteur: null, mort: false }]);
    expect(t.pv).toBe(TIGRE_ALLIE.pv - 150);
  });
});

// ---------- tigre allié ----------

describe("tigre allié", () => {
  const lanceur = (x = 0, z = 0) => joueur("l", x, z);
  function allie(m: Monde = VIDE, p: Vec3 = [0, 0, 0], lacet = 0): Tigre {
    return creerTigreAllie("t2", { id: "l", p, lacet }, m, T0);
  }
  function tournerAllie(t: Tigre, l: JoueurVu | null, e: EnvTigre, depuis: number, ms: number, avant?: (m: number) => void) {
    const ev: EvenementTigre[] = [];
    let maintenant = depuis;
    for (let k = 1; k <= Math.round(ms / PAS_MS); k++) {
      maintenant = depuis + Math.round(k * PAS_MS);
      avant?.(maintenant);
      ev.push(...avancerTigreAllie(t, l, maintenant, DT, e));
    }
    return { ev, fin: maintenant };
  }

  it("apparaît à 2 m devant le lanceur, 500 PV, pour 30 s", () => {
    const t = allie();
    expect(t.p[2]).toBeCloseTo(-2, 5); // lacet 0 = vers −z
    expect(t).toMatchObject({ genre: "allie", lanceur: "l", pv: 500, etat: "suivi", finT: T0 + 30_000 });
  });

  it("suit le lanceur à 3 à 6 m", () => {
    const t = allie();
    const l = lanceur();
    tournerAllie(t, l, env(VIDE, [l]), T0, 10_000, (m) => { l.p = [((m - T0) / 1000) * 6, 0, 0]; });
    const d = Math.hypot(t.p[0] - l.p[0], t.p[2] - l.p[2]);
    expect(d).toBeGreaterThanOrEqual(TIGRE_ALLIE.suiviMin - 0.5);
    expect(d).toBeLessThanOrEqual(TIGRE_ALLIE.suiviMax + 1);
  });

  it("attaque l'ennemi le plus proche DU LANCEUR à moins de 18 m, 15 dégâts toutes les 1,0 s, jamais le lanceur", () => {
    const t = allie();
    const l = lanceur();
    const proche = joueur("p", 10, 0), loin = joueur("x", -15, 0), hors = joueur("h", 0, 25);
    const e = env(VIDE, [l, proche, loin, hors]);
    const { ev } = tournerAllie(t, l, e, T0, 5000);
    expect(t.cible).toBe("p");
    const c = coups(ev);
    expect(c.length).toBeGreaterThanOrEqual(3);
    expect(c.every((x) => x.cible === "p" && x.degats === 15 && x.action === "patte")).toBe(true);
  });

  it("ne bondit jamais", () => {
    const t = allie();
    const l = lanceur();
    const cible = joueur("p", 8, 0);
    const e = env(VIDE, [l, cible]);
    tournerAllie(t, l, e, T0, 3000, () => { if (t.action) expect(t.action).toBe("patte"); });
  });

  it("change de cible quand la sienne sort de portée du lanceur ou de la vue", () => {
    const t = allie(AVEC_MUR, [0, 0, 5], Math.PI);
    const l = lanceur(0, 5);
    const a = joueur("a", 6, 5), b = joueur("b", -9, 5);
    const e = env(AVEC_MUR, [l, a, b]);
    const r = tournerAllie(t, l, e, T0, 300);
    expect(t.cible).toBe("a");
    a.p = [6, 0, 40]; // hors des 18 m du lanceur
    tournerAllie(t, l, e, r.fin, 300);
    expect(t.cible).toBe("b");
    b.p = [0, 0, -8]; // derrière le mur
    tournerAllie(t, l, e, r.fin + 300, 300);
    expect(t.cible).toBeNull();
    expect(t.etat).toBe("suivi");
  });

  it("part au bout de 30 s, ou dès que son lanceur n'est plus là", () => {
    const t = allie();
    expect(avancerTigreAllie(t, lanceur(), T0 + 29_999, DT, env(VIDE, []))).toEqual([]);
    expect(avancerTigreAllie(t, lanceur(), T0 + 30_000, DT, env(VIDE, []))).toEqual([{ type: "parti" }]);
    const u = allie();
    expect(avancerTigreAllie(u, null, T0 + 10, DT, env(VIDE, []))).toEqual([{ type: "parti" }]);
  });

  it("équilibre : 15 dégâts par seconde au plus, un joueur à 100 PV tient plus de 6 s face à lui", () => {
    expect(TIGRE_ALLIE.patte.degats / (TIGRE_ALLIE.patte.cadenceMs / 1000)).toBe(15);
    // 7 coups pour 100 PV, le premier à 0 s : la mort au 7e, 6 s après le premier
    expect((Math.ceil(100 / TIGRE_ALLIE.patte.degats) - 1) * TIGRE_ALLIE.patte.cadenceMs).toBe(6000);
  });
});

// ---------- silhouette et validation des touches ----------

describe("silhouette de touche selon la pose", () => {
  const debout = { p: [0, 0, 0] as Vec3, cap: 0, pose: "debout" as const };
  const couche = { ...debout, pose: "couche" as const };

  it("cap 0 : la tête est devant, vers −z", () => {
    const h = hitboxTigre(debout);
    expect(h.c[2]).toBeLessThan(-1);
    expect(h.b[2]).toBeLessThan(h.a[2]);
  });

  it("tracerTigre : tête visée → tête, corps visé → corps, au-dessus → rien", () => {
    const S = SILHOUETTES_TIGRE.debout;
    const tete = tracerTigre([10, S.tete.y, -S.tete.avance], [-1, 0, 0], debout, 100);
    expect(tete?.zone).toBe("tete");
    expect(tete?.distance).toBeCloseTo(10 - S.tete.rayon, 5);
    expect(tracerTigre([10, S.corps.y, 0.3], [-1, 0, 0], debout, 100)?.zone).toBe("corps");
    expect(tracerTigre([10, 2.5, 0], [-1, 0, 0], debout, 100)).toBeNull();
    expect(tracerTigre([10, S.corps.y, 0], [-1, 0, 0], debout, 5)).toBeNull(); // au-delà de la limite
  });

  it("couché, il est plus bas : un rayon à 1,5 m touche le tigre debout mais passe au-dessus du tigre couché", () => {
    expect(tracerTigre([10, 1.5, 0], [-1, 0, 0], debout, 100)).not.toBeNull();
    expect(tracerTigre([10, 1.5, 0], [-1, 0, 0], couche, 100)).toBeNull();
    expect(tracerTigre([10, SILHOUETTES_TIGRE.couche.corps.y, 0], [-1, 0, 0], couche, 100)?.zone).toBe("corps");
  });

  it("la silhouette suit le GLB dessiné : tête au-dessus du corps et devant lui, plus basse tapi que debout", () => {
    for (const s of Object.values(SILHOUETTES_TIGRE)) {
      expect(s.tete.y).toBeGreaterThan(s.corps.y);
      expect(s.tete.avance).toBeGreaterThan(s.corps.demiLongueur);
    }
    expect(SILHOUETTES_TIGRE.couche.tete.y).toBeLessThan(SILHOUETTES_TIGRE.debout.tete.y);
    expect(SILHOUETTES_TIGRE.couche.corps.y).toBeLessThan(SILHOUETTES_TIGRE.course.corps.y);
  });

  it("toucheTigreVraisemblable : rayon sur le corps accepté, à 2 m à côté refusé, à travers un mur refusé", () => {
    const pos = { p: [0, 0, 8] as Vec3, cap: Math.PI / 2, pose: "debout" as const };
    expect(toucheTigreVraisemblable(VIDE, [0, 1.95, 30], [0, -0.05, -1].map((x, _i, a) => x / Math.hypot(...a)) as Vec3, 100, pos, 0)).toBe(true);
    expect(toucheTigreVraisemblable(VIDE, [3, 1, 30], [0, 0, -1], 100, pos, 0)).toBe(false);
    expect(toucheTigreVraisemblable(AVEC_MUR, [0, 1, -20], [0, 0, 1], 100, pos, 0)).toBe(false);
    expect(toucheTigreVraisemblable(VIDE, [0, 1, 200], [0, 0, -1], 100, pos, 0)).toBe(false); // hors de portée
  });

  it("coupTigreVraisemblable : à 1,5 m de face accepté, à 5 m refusé, de dos refusé", () => {
    const pos = { p: [0, 0, 0] as Vec3, cap: 0, pose: "debout" as const };
    expect(coupTigreVraisemblable(VIDE, [2, 1.5, 0], [-1, 0, 0], pos)).toBe(true);
    expect(coupTigreVraisemblable(VIDE, [5.5, 1.5, 0], [-1, 0, 0], pos)).toBe(false);
    expect(coupTigreVraisemblable(VIDE, [2, 1.5, 0], [1, 0, 0], pos)).toBe(false);
  });

  it("capVers : direction (1, 0) donne un cap dont l'avant est +x", () => {
    const c = capVers(1, 0);
    expect(-Math.sin(c)).toBeCloseTo(1, 9);
  });
});

// ---------- chemins sur la vraie carte ----------

describe("chemins autour des bâtiments de scene.json", () => {
  const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
  const reel = construireMonde(scene);
  const fichier = JSON.parse(readFileSync("public/agroparc/cachettes.json", "utf8")) as FichierCachettes;
  const anneau = cachettesDansAnneau(
    lireCachettes(fichier).map((c) => ({ x: c.x, z: c.z, cap: capDeCachette(c.cap) })),
    { centre: ROND_POINT.centre, rMin: ZONE_APPARITION.rMin, rMax: ZONE_APPARITION.rMax },
  );
  const points = pointsApparition(scene, reel);

  it("chercherChemin : un chemin qui ne traverse aucun bâtiment, de case libre en case libre", () => {
    const g = grilleNav(reel);
    const c = anneau[0];
    const cible = points.find(([x, z]) => Math.hypot(x - c.x, z - c.z) > 40)!;
    const ch = chercherChemin(g, c.x, c.z, cible[0], cible[1])!;
    expect(ch).not.toBeNull();
    expect(ch[ch.length - 1]).toEqual(cible);
    let de: Vec3 = [c.x, 0, c.z];
    for (const [x, z] of ch.slice(0, -1)) {
      expect(routeLibre(reel, de, x, z) || Math.hypot(x - de[0], z - de[2]) < 2.2).toBe(true);
      de = [x, 0, z];
    }
  });

  it("depuis chaque cachette de l'anneau, le tigre rejoint un joueur placé à 25 à 60 m en moins de 20 s (3 joueurs par cachette)", () => {
    let essais = 0, atteints = 0, pire = 0;
    for (const c of anneau) {
      const cibles = points.filter(([x, z]) => { const d = Math.hypot(x - c.x, z - c.z); return d > 25 && d < 60; }).slice(0, 3);
      for (const [cx, cz] of cibles) {
        essais++;
        const t = creerTigreSauvage("t", [c.x, 0, c.z], c, 0);
        const e = (js: JoueurVu[]): EnvTigre => ({ monde: reel, alea: () => 0, joueurs: js, voitures: [], cachettes: anneau });
        avancerTigreSauvage(t, TIGRE.descenteMs, DT, e([]));
        blesserTigre(t, 1, "a", TIGRE.descenteMs);
        t.prochainBondT = Infinity;
        let m = TIGRE.descenteMs;
        for (let k = 0; k < 60 * 20; k++) {
          m += PAS_MS;
          if (avancerTigreSauvage(t, m, DT, e([joueur("a", cx, cz)])).some((x) => x.type === "coup")) {
            atteints++;
            pire = Math.max(pire, (m - TIGRE.descenteMs) / 1000);
            break;
          }
        }
      }
    }
    expect(essais).toBeGreaterThanOrEqual(60);
    expect(atteints).toBe(essais);
    expect(pire).toBeLessThan(20);
  });
});
