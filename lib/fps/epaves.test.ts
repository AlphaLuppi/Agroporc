import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { STATS, degatsPlomb } from "./armes";
import { construireCircuits, etatVoiture, flotte, T0_MS } from "./circulation";
import { construireMonde } from "./collision";
import { CARROSSERIE, Carrosseries, degatsSouffle, degatsVoisine, etatCarrosserie, rayonVoiture } from "./epaves";
import type { ContexteSalle, JoueurSalle, Sortie } from "./match-contexte";
import { creerServiceVehicules } from "./match-vehicules";
import { copierEquipement, EQUIPEMENT_DEFAUT, type CauseMort, type Vec3 } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 10, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
const mondeVide = construireMonde({ ...scene, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000)], pois: [] });

const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

describe("rayonVoiture", () => {
  const p: Vec3 = [10, 0, 0];
  it("touche la caisse de face, de côté, par-dessus ; manque au-dessus du toit et derrière le tireur", () => {
    // cap 0 : avant vers −z, largeur 1,9 en x, longueur 4,4 en z
    expect(rayonVoiture([0, 1, 0], [1, 0, 0], p, 0, 100)).toBeCloseTo(10 - 0.95, 6);
    expect(rayonVoiture([10, 1, -20], [0, 0, 1], p, 0, 100)).toBeCloseTo(20 - 2.2, 6);
    expect(rayonVoiture([10, 10, 0], [0, -1, 0], p, 0, 100)).toBeCloseTo(10 - 1.5, 6);
    expect(rayonVoiture([0, 2, 0], [1, 0, 0], p, 0, 100)).toBeNull();
    expect(rayonVoiture([0, 1, 0], [-1, 0, 0], p, 0, 100)).toBeNull();
    expect(rayonVoiture([0, 1, 0], [1, 0, 0], p, 0, 5)).toBeNull();
  });
  it("tient compte du cap : tournée de 90°, la caisse présente sa longueur", () => {
    expect(rayonVoiture([0, 1, 0], [1, 0, 0], p, Math.PI / 2, 100)).toBeCloseTo(10 - 2.2, 6);
  });
  it("la marge agrandit la caisse ; un rayon parti de l'intérieur touche à 0", () => {
    expect(rayonVoiture([0, 2, 0], [1, 0, 0], p, 0, 100, 0.8)).not.toBeNull();
    expect(rayonVoiture([10, 1, 0], [1, 0, 0], p, 0, 100)).toBe(0);
  });
});

describe("barèmes", () => {
  it("état visible : intact, fumée sous 50 %, feu sous 20 %", () => {
    expect(etatCarrosserie(CARROSSERIE.pv)).toBe("intact");
    expect(etatCarrosserie(CARROSSERIE.pv * 0.5)).toBe("fumee");
    expect(etatCarrosserie(CARROSSERIE.pv * 0.2)).toBe("feu");
  });
  it("souffle : mortel de près (au-delà de PV + bouclier pleins), nul à 8 m, décroissant", () => {
    expect(degatsSouffle(0)).toBeGreaterThan(200);
    expect(degatsSouffle(CARROSSERIE.rayonMortel)).toBe(CARROSSERIE.degatsMax);
    expect(degatsSouffle(5)).toBeLessThan(CARROSSERIE.degatsMax);
    expect(degatsSouffle(5)).toBeGreaterThan(degatsSouffle(7));
    expect(degatsSouffle(CARROSSERIE.rayonSouffle)).toBe(0);
    expect(degatsVoisine(0)).toBe(CARROSSERIE.degatsVoisines);
    expect(degatsVoisine(CARROSSERIE.rayonVoisines)).toBe(0);
  });
  it("tirer longtemps : quelques secondes de mitraillette, 5 balles de sniper", () => {
    const parSeconde = degatsPlomb("mitraillette", "corps", 10) / STATS.mitraillette.cadenceS;
    expect(CARROSSERIE.pv / parSeconde).toBeGreaterThan(1.5);
    expect(CARROSSERIE.pv / parSeconde).toBeLessThan(5);
    expect(Math.ceil(CARROSSERIE.pv / degatsPlomb("sniper", "corps", 50))).toBe(5);
  });
});

describe("Carrosseries", () => {
  const ref = { genre: "pnj" as const, id: 3 };
  it("fumée, feu puis épave ; l'épave revient neuve à échéance", () => {
    const c = new Carrosseries();
    expect(c.toucher(ref, 100, 0, { p: [0, 0, 0], cap: 0 })).toEqual({ change: false, detruite: false });
    expect(c.toucher(ref, 150, 0, { p: [0, 0, 0], cap: 0 })).toEqual({ change: true, detruite: false });
    expect(c.etats()).toEqual([{ genre: "pnj", id: 3, etat: "fumee" }]);
    expect(c.toucher(ref, 130, 0, { p: [0, 0, 0], cap: 0 }).change).toBe(true);
    expect(c.etats()[0].etat).toBe("feu");
    expect(c.toucher(ref, 500, 1000, { p: [1, 0, 2], cap: 0.5 })).toEqual({ change: true, detruite: true });
    expect(c.detruite(ref)).toBe(true);
    expect(c.etats()).toEqual([{ genre: "pnj", id: 3, etat: "epave", p: [1, 0, 2], cap: 0.5, finT: 1000 + CARROSSERIE.epavePnjMs }]);
    // une épave n'encaisse plus rien
    expect(c.toucher(ref, 500, 2000, { p: [0, 0, 0], cap: 0 })).toEqual({ change: false, detruite: false });
    expect(c.tic(1000 + CARROSSERIE.epavePnjMs - 1)).toEqual([]);
    expect(c.tic(1000 + CARROSSERIE.epavePnjMs)).toEqual([ref]);
    expect(c.detruite(ref)).toBe(false);
    expect(c.pvDe(ref)).toBe(CARROSSERIE.pv);
    expect(c.etats()).toEqual([]);
  });
});

// ---------- service : tirs sur les voitures et explosions ----------

function joueur(id: string, p: Vec3, surcharge: Partial<JoueurSalle> = {}): JoueurSalle {
  return {
    id, pseudo: id, couleur: "#ffffff", enJeu: true, kills: 0, morts: 0, ping: 0, p, v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0,
    arme: "sniper", armeSuivante: "sniper", pv: 100, vivant: true, protegeJusqua: 0, reapparitionT: null, reentreeT: -Infinity, seq: 0, etatT: 0, histo: [], prochainTir: 0,
    renommages: [], equip: copierEquipement(EQUIPEMENT_DEFAUT), main: "principale", mainSuivante: "principale", munSpeciale: 0, sortieJusqua: 0,
    cadenceArme: {}, bouclier: 0, dernierDegatT: 0, regenAcc: 0, accroupi: false, glisse: false, memoSante: null,
    tirs: 0, touches: 0, tetes: 0, degats: 0, serie: 0, serieMax: 0, killsParArme: {}, scoresOuvert: false, scoresDemandeT: 0, scoresEnvoyeT: 0,
    ...surcharge,
  };
}

function banc(avecCirculation = false) {
  const joueurs = new Map<string, JoueurSalle>();
  const coups: { cible: string; degats: number; cause: CauseMort }[] = [];
  const morts: { cible: string; par: string | null; cause: CauseMort }[] = [];
  const ctx: ContexteSalle = {
    monde: mondeVide, alea: () => 0.5, enPhaseJeu: () => true,
    joueur: (id) => joueurs.get(id),
    joueursEnJeu: () => [...joueurs.values()].filter((j) => j.enJeu),
    memoriserPrecedent: () => {},
    infliger: (cible, degats, _par, cause) => { coups.push({ cible: cible.id, degats, cause }); return []; },
    tuer: (cible, par, cause) => { cible.vivant = false; morts.push({ cible: cible.id, par: par?.id ?? null, cause }); return []; },
    libererVehicule: () => [],
    toucheJoueur: () => false,
    // v5 (zombies) : non utilisés par ce service
    joueurs: () => [...joueurs.values()], placerJoueur: () => [], retirerJoueur: () => [], equiper: () => [],
    presence: () => ({ a: "tous", m: { t: "presence", joueurs: [] } }),
  };
  const circuits = construireCircuits();
  const svc = creerServiceVehicules(ctx, {
    // deux voitures côte à côte (3 m), une troisième loin
    vehicules: [{ p: [0, 0], cap: 0 }, { p: [3, 0], cap: 0 }, { p: [0, 200], cap: 0 }],
    ...(avecCirculation ? { circulation: { circuits, voitures: flotte(circuits) } } : {}),
    maintenant: 0,
  });
  const ajouter = (j: JoueurSalle) => { joueurs.set(j.id, j); return j; };
  return { svc, ajouter, coups, morts, circuits };
}
const types = (s: Sortie[]) => s.map((x) => x.m.t);
/** le tireur, à 30 m à l'ouest de la voiture 0, tire `n` balles de sniper dans son flanc */
function arroser(b: ReturnType<typeof banc>, tireur: JoueurSalle, n: number, t0 = 1000) {
  const o: Vec3 = [-30, 1.95, 0];
  const d = norm([30, -1, 0]);
  const sorties: Sortie[] = [];
  for (let k = 0; k < n; k++) sorties.push(...b.svc.tirVoitures(tireur, o, [d], [{ genre: "vehicule", id: 0, plomb: 0 }], "sniper", new Set(), t0 + k * 1400));
  return sorties;
}

describe("tirVoitures (service)", () => {
  it("cinq balles de sniper : la voiture fume, brûle puis explose ; occupant tué, voisine abîmée, voiture hors service puis de retour", () => {
    const b = banc();
    const tireur = b.ajouter(joueur("t", [-30, 0, 0]));
    const passager = b.ajouter(joueur("p", [0, 0, 3]));
    const voisin = b.ajouter(joueur("v", [0, 0, 5]));
    expect(types(b.svc.recevoir(passager, { t: "monter", vehicule: 0 }, 500))).toEqual(["embarque", "sieges"]);
    const avant = arroser(b, tireur, 4);
    expect(types(avant).filter((t) => t === "voitures").length).toBeGreaterThanOrEqual(2);
    expect(types(avant)).not.toContain("explosion");
    const s = arroser(b, tireur, 1, 7000);
    const ex = s.find((x) => x.m.t === "explosion")?.m;
    expect(ex).toMatchObject({ t: "explosion", genre: "vehicule", id: 0, par: "t" });
    expect(b.morts).toEqual([{ cible: "p", par: "t", cause: "explosion" }]);
    // le voisin à 5 m prend le souffle (sans en mourir forcément), le tireur à 30 m rien
    expect(b.coups.find((c) => c.cible === "v")).toMatchObject({ cause: "explosion" });
    expect(b.coups.find((c) => c.cible === "t")).toBeUndefined();
    expect(voisin.vivant).toBe(true);
    // la voiture explosée sort du snap, ne se monte plus ; la voisine (3 m) a été abîmée par le souffle
    expect(b.svc.snap().map((v) => v.id)).toEqual([1, 2]);
    expect(b.svc.recevoir(voisin, { t: "monter", vehicule: 0 }, 7100)[0].m).toMatchObject({ t: "refus", raison: "inconnu" });
    const etats = (s.filter((x) => x.m.t === "voitures").pop()!.m as { etats: { id: number; etat: string }[] }).etats;
    expect(etats.find((e) => e.id === 0)?.etat).toBe("epave");
    expect(etats.find((e) => e.id === 1)?.etat).toBe("fumee");
    // de retour, neuve, à sa place
    const retour = b.svc.tic(7000 + CARROSSERIE.epaveVehiculeMs);
    expect(types(retour)).toContain("voitures");
    expect(b.svc.snap().map((v) => v.id)).toEqual([0, 1, 2]);
  });

  it("une déclaration qui manque la caisse, hors portée, sur une épave ou un plomb déjà pris ne compte pas", () => {
    const b = banc();
    const tireur = b.ajouter(joueur("t", [-30, 0, 0]));
    const o: Vec3 = [-30, 1.95, 0];
    expect(b.svc.tirVoitures(tireur, o, [norm([0, 0, 1])], [{ genre: "vehicule", id: 0, plomb: 0 }], "sniper", new Set(), 1000)).toEqual([]);
    expect(b.svc.tirVoitures(tireur, o, [norm([30, -1, 0])], [{ genre: "vehicule", id: 0, plomb: 0 }], "sniper", new Set([0]), 1000)).toEqual([]);
    expect(b.svc.tirVoitures(tireur, o, [norm([30, -1, 0])], [{ genre: "vehicule", id: 9, plomb: 0 }], "sniper", new Set(), 1000)).toEqual([]);
    // pistolet : 120 m de portée, la voiture 2 est à ~200 m
    expect(b.svc.tirVoitures(tireur, o, [norm([30, -1, 200])], [{ genre: "vehicule", id: 2, plomb: 0 }], "pistolet", new Set(), 1000)).toEqual([]);
    expect(arroser(b, tireur, 5).some((x) => x.m.t === "explosion")).toBe(true);
    expect(b.svc.tirVoitures(tireur, o, [norm([30, -1, 0])], [{ genre: "vehicule", id: 0, plomb: 0 }], "sniper", new Set(), 9000)).toEqual([]);
  });

  it("une voiture PNJ explosée n'écrase plus personne et revient sur son circuit", () => {
    const b = banc(true);
    const t = T0_MS + 60_000;
    const v = flotte(b.circuits)[0];
    const e = etatVoiture(b.circuits[v.circuit], v, t);
    const tireur = b.ajouter(joueur("t", [e.p[0] - 20, 0, e.p[2]]));
    const o: Vec3 = [e.p[0] - 20, 1.95, e.p[2]];
    const d = norm([20, -1, 0]);
    let s: Sortie[] = [];
    for (let k = 0; k < 5; k++) s = b.svc.tirVoitures(tireur, o, [d], [{ genre: "pnj", id: v.id, plomb: 0 }], "sniper", new Set(), t);
    expect(s.find((x) => x.m.t === "explosion")?.m).toMatchObject({ genre: "pnj", id: v.id });
    // un piéton posé sur la trajectoire de la PNJ détruite, un peu plus tard : pas écrasé
    const plusTard = t + 2000;
    const e2 = etatVoiture(b.circuits[v.circuit], v, plusTard);
    b.ajouter(joueur("pieton", [e2.p[0], 0, e2.p[2]], { etatT: plusTard }));
    b.svc.tic(plusTard);
    expect(b.morts.filter((m) => m.cible === "pieton")).toEqual([]);
    const retour = b.svc.tic(t + CARROSSERIE.epavePnjMs);
    expect(types(retour)).toContain("voitures");
  });
});
