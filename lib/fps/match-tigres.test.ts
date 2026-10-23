import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import type { ContexteSalle, JoueurSalle, Sortie } from "./match-contexte";
import { creerServiceTigres, type OptionsServiceTigres } from "./match-tigres";
import { copierEquipement, EQUIPEMENT_DEFAUT, type CauseMort, type MessageServeur, type Vec3 } from "./protocole";
import { TIGRE, TIGRE_ALLIE, hitboxTigre, type CachetteTigre, type ObstacleVoiture } from "./tigre-arene";

// ---------- contexte factice (le service ne voit la salle que par ContexteSalle) ----------

const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 3, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
/** Monde vide, bornes ±225 m */
const monde = construireMonde({ buildings: [rect(-201, -201, -199, -199), rect(199, 199, 201, 201)], pois: [], roads: [], parkings: [], water: [], trees: [] } as unknown as SceneData);

function joueur(id: string, p: Vec3 = [0, 0, 0], surcharge: Partial<JoueurSalle> = {}): JoueurSalle {
  return {
    id, pseudo: id, couleur: "#ffffff", enJeu: true, kills: 0, morts: 0, ping: 0, p, v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0,
    arme: "pistolet", armeSuivante: "pistolet", pv: 100, vivant: true, protegeJusqua: 0, reapparitionT: null, reentreeT: -Infinity, seq: 0, etatT: 0, histo: [], prochainTir: 0,
    renommages: [], equip: copierEquipement(EQUIPEMENT_DEFAUT), main: "secondaire", mainSuivante: "secondaire", munSpeciale: 0, sortieJusqua: 0,
    cadenceArme: {}, bouclier: 0, dernierDegatT: 0, regenAcc: 0, accroupi: false, glisse: false, memoSante: null,
    tirs: 0, touches: 0, tetes: 0, degats: 0, serie: 0, serieMax: 0, killsParArme: {}, scoresOuvert: false, scoresDemandeT: 0, scoresEnvoyeT: 0,
    ...surcharge,
  };
}

interface Coup { cible: string; degats: number; par: string | null; cause: CauseMort; t: number }
function creerContexte(alea: () => number = () => 0.5) {
  const joueurs = new Map<string, JoueurSalle>();
  const etat = { phaseJeu: true };
  const coups: Coup[] = [];
  const ctx: ContexteSalle = {
    monde, alea,
    enPhaseJeu: () => etat.phaseJeu,
    joueur: (id) => joueurs.get(id),
    joueursEnJeu: () => [...joueurs.values()].filter((j) => j.enJeu),
    memoriserPrecedent: () => {},
    // comme la salle : PV retirés, mort à 0
    infliger: (cible, degats, par, cause, _zone, _arme, t) => {
      coups.push({ cible: cible.id, degats, par: par?.id ?? null, cause, t });
      cible.pv = Math.max(0, cible.pv - degats);
      if (cible.pv <= 0) cible.vivant = false;
      return [];
    },
    tuer: () => [],
    libererVehicule: () => [],
    toucheJoueur: () => false,
  };
  const ajouter = (j: JoueurSalle) => { joueurs.set(j.id, j); return j; };
  return { ctx, etat, coups, ajouter, joueurs };
}

const T0 = 1_000_000;
const PAS_MS = 1000 / 60;
/** Cachettes de l'anneau de test (centre (0, 0), 25 à 140 m) : la première est la seule à plus de 30 m de joueurs placés près des autres. */
const CACHETTES: CachetteTigre[] = [{ x: 60, z: 0, cap: 0 }, { x: -60, z: 0, cap: 0 }, { x: 0, z: 100, cap: 0 }, { x: 0, z: -120, cap: 0 }];
const ANNEAU = { centre: [0, 0] as [number, number], rMin: 25, rMax: 140 };
const INTERVALLE = { minMs: 1000, maxMs: 1000 };
const opts = (o: Partial<OptionsServiceTigres> = {}): OptionsServiceTigres =>
  ({ cachettes: CACHETTES, anneau: ANNEAU, intervalle: INTERVALLE, maintenant: T0, ...o });

function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
function tourner(s: ReturnType<typeof creerServiceTigres>, depuis: number, ms: number, avant?: (m: number) => void): { sorties: Sortie[]; fin: number } {
  const sorties: Sortie[] = [];
  let m = depuis;
  for (let k = 1; k <= Math.round(ms / PAS_MS); k++) {
    m = depuis + Math.round(k * PAS_MS);
    avant?.(m);
    sorties.push(...s.tic(m));
  }
  return { sorties, fin: m };
}

/** Salle à deux joueurs loin de la cachette (60, 0) : avion à T0 + 1 s, largage, tigre posé. Renvoie le service et l'id du tigre. */
function avecTigrePose() {
  const c = creerContexte(() => 0);
  const a = c.ajouter(joueur("a", [-60, 0, 5]));
  const b = c.ajouter(joueur("b", [-55, 0, -5]));
  const s = creerServiceTigres(c.ctx, opts());
  const { sorties, fin } = tourner(s, T0, 1000 + 20_000 + TIGRE.descenteMs);
  const largage = messages(sorties, "avion").find((m) => m.evenement === "largage");
  expect(largage?.tigre).toBeDefined();
  const id = largage!.tigre!;
  expect(s.tigre(id)?.etat).toBe("tapi");
  return { ...c, a, b, s, id, fin };
}

describe("avion et largage", () => {
  it("passage à l'échéance avec 2 joueurs, largage annoncé, tigre apparu puis posé dans la cachette à plus de 30 m des joueurs", () => {
    const c = creerContexte(() => 0);
    c.ajouter(joueur("a", [-60, 0, 5]));
    c.ajouter(joueur("b", [-55, 0, -5]));
    const s = creerServiceTigres(c.ctx, opts());
    expect(s.tic(T0 + 999)).toEqual([]);
    const passage = messages(s.tic(T0 + 1000), "avion");
    expect(passage).toHaveLength(1);
    expect(passage[0]).toMatchObject({ evenement: "passage", avion: { altitude: 120, vitesse: 60 } });
    const largageT = passage[0].avion!.largageT;
    const r = tourner(s, T0 + 1000, largageT - T0 - 1000 + 20);
    const avion = messages(r.sorties, "avion");
    expect(avion.map((m) => m.evenement)).toEqual(["largage"]);
    const tigre = messages(r.sorties, "tigre");
    expect(tigre).toEqual([expect.objectContaining({ evenement: "apparu", genre: "sauvage", id: avion[0].tigre })]);
    const t = s.tigre(avion[0].tigre!)!;
    expect(t.etat).toBe("descente");
    expect(s.snap()[0]).toMatchObject({ id: t.id, genre: "sauvage", etat: "descente", pv: 2500 });
    expect(s.snap()[0].p[1]).toBeGreaterThan(100);
    tourner(s, r.fin, TIGRE.descenteMs + 50);
    expect(s.tigre(t.id)).toMatchObject({ etat: "tapi", p: [60, 0, 0] });
    expect(Math.hypot(60 + 60, 0 - 5)).toBeGreaterThan(30);
  });

  it("un seul joueur en arène : aucun passage", () => {
    const c = creerContexte(() => 0);
    c.ajouter(joueur("a", [-60, 0, 5]));
    const s = creerServiceTigres(c.ctx, opts());
    expect(messages(tourner(s, T0, 5000).sorties, "avion")).toEqual([]);
  });

  it("pas de second avion tant que le tigre sauvage vit, un nouveau minuteur à sa mort", () => {
    const { s, id, fin, a } = avecTigrePose();
    expect(messages(tourner(s, fin, 10_000).sorties, "avion")).toEqual([]);
    s.blesser(id, 5000, a, "corps", fin + 10_000);
    const apres = tourner(s, fin + 10_000, 1500).sorties;
    expect(messages(apres, "avion").map((m) => m.evenement)).toEqual(["passage"]);
  });

  it("synchro : l'avion en vol (ou null) au seul joueur qui rejoint", () => {
    const c = creerContexte(() => 0);
    c.ajouter(joueur("a", [-60, 0, 5]));
    c.ajouter(joueur("b", [-55, 0, -5]));
    const s = creerServiceTigres(c.ctx, opts());
    expect(s.synchro("x")).toEqual([{ a: "x", m: { t: "avion", evenement: "etat", avion: null } }]);
    s.tic(T0 + 1000);
    const [m] = s.synchro("x");
    expect(m.m).toMatchObject({ t: "avion", evenement: "etat", avion: { id: 1 } });
  });
});

describe("tirs, couteau et mort du tigre sauvage", () => {
  it("tir validé sur la position courante, et sur une position passée dans la fenêtre de rejeu seulement", () => {
    const { s, id, fin, a } = avecTigrePose();
    const t = s.tigre(id)!;
    const viser = (p: Vec3): [Vec3, Vec3] => {
      const h = hitboxTigre({ p, cap: t.cap, pose: "couche" });
      const o: Vec3 = [p[0] - 20, 1.8, p[2]];
      const v = [h.a[0] + (h.b[0] - h.a[0]) / 2 - o[0], h.a[1] - o[1], h.a[2] + (h.b[2] - h.a[2]) / 2 - o[2]];
      const l = Math.hypot(v[0], v[1], v[2]);
      return [o, [v[0] / l, v[1] / l, v[2] / l]];
    };
    const [o, d] = viser([60, 0, 0]);
    expect(s.validerTir(a, id, o, d, 140, fin, 300)).toBeCloseTo(20, 0);
    // le tigre bondit de 6 m : le tir sur l'ancienne position passe 200 ms après, plus 500 ms après
    (t as { p: Vec3 }).p = [60, 0, 6];
    s.tic(fin + 200);
    expect(s.validerTir(a, id, o, d, 140, fin + 200, 300)).not.toBeNull();
    s.tic(fin + 500);
    expect(s.validerTir(a, id, o, d, 140, fin + 500, 300)).toBeNull();
    // à côté, de l'autre côté de l'ancienne position
    expect(s.validerTir(a, id, [o[0], o[1], o[2] - 5], d, 140, fin + 500, 300)).toBeNull();
  });

  it("tigre{touche} à chaque blessure, puis mort et sort gagné par l'auteur du dernier coup", () => {
    const { s, id, fin, a, b } = avecTigrePose();
    const r1 = s.blesser(id, 2400, a, "corps", fin);
    expect(messages(r1, "tigre")).toEqual([expect.objectContaining({ evenement: "touche", par: "a", degats: 2400, pv: 100, zone: "corps" })]);
    const r2 = s.blesser(id, 150, b, "tete", fin + 10);
    expect(messages(r2, "tigre").map((m) => m.evenement)).toEqual(["touche", "mort"]);
    expect(messages(r2, "tigre")[1]).toMatchObject({ par: "b" });
    expect(messages(r2, "sort")).toEqual([{ t: "sort", evenement: "gagne", joueur: "b" }]);
    expect(s.charge("b")).toBe(true);
    expect(s.charge("a")).toBe(false);
    expect(s.estTigre(id)).toBe(false);
    expect(s.snap()).toEqual([]);
  });

  it("au plus une charge à la fois, perdue à la mort du joueur", () => {
    const { s, id, fin, a } = avecTigrePose();
    s.blesser(id, 3000, a, "corps", fin);
    expect(s.charge("a")).toBe(true);
    a.vivant = false;
    const perdu = s.tic(fin + 20).filter((x) => x.m.t === "sort");
    expect(perdu).toEqual([{ a: "a", m: { t: "sort", evenement: "perdu", joueur: "a", raison: "mort" } }]);
    expect(s.charge("a")).toBe(false);
  });

  it("charge perdue à la sortie de l'arène et à la fin du match", () => {
    const { s, id, fin, a, etat } = avecTigrePose();
    s.blesser(id, 3000, a, "corps", fin);
    a.enJeu = false;
    // sorti de l'arène, le joueur n'est plus dans l'audience « joueurs » : l'annonce lui est adressée directement
    const sortie = s.tic(fin + 20).filter((x) => x.m.t === "sort");
    expect(sortie).toEqual([{ a: "a", m: { t: "sort", evenement: "perdu", joueur: "a", raison: "quitte" } }]);
    a.enJeu = true;
    const autre = avecTigrePose();
    autre.s.blesser(autre.id, 3000, autre.a, "corps", autre.fin);
    autre.etat.phaseJeu = false;
    const fin2 = autre.s.tic(autre.fin + 20).filter((x) => x.m.t === "sort");
    expect(fin2).toEqual([{ a: "a", m: { t: "sort", evenement: "perdu", joueur: "a", raison: "fin_match" } }]);
    expect(etat.phaseJeu).toBe(true);
  });

  it("le tigre attaque : ses coups passent par ctx.infliger, cause « tigre », sans auteur, jamais plus de 40", () => {
    const { s, id, fin, a, coups } = avecTigrePose();
    a.p = [58, 0, 0];
    tourner(s, fin, 6000);
    expect(s.tigre(id)?.etat).toBe("attaque");
    expect(coups.length).toBeGreaterThan(0);
    expect(coups.every((c) => c.cause === "tigre" && c.par === null && c.degats <= 40 && c.cible === "a")).toBe(true);
  });

  it("un joueur protégé (apparition) ou en voiture n'est pas frappé", () => {
    const c = creerContexte(() => 0);
    const a = c.ajouter(joueur("a", [-60, 0, 5]));
    c.ajouter(joueur("b", [-55, 0, -5]));
    const s = creerServiceTigres(c.ctx, opts({ aPied: (j) => j.id !== "a" }));
    const { fin } = tourner(s, T0, 1000 + 20_000 + TIGRE.descenteMs);
    a.p = [58, 0, 0];
    tourner(s, fin, 4000);
    expect(c.coups).toEqual([]);
  });

  it("une voiture lancée le blesse de 150, et le conducteur qui l'achève gagne le sort", () => {
    const voitures: ObstacleVoiture[] = [];
    const c = creerContexte(() => 0);
    c.ajouter(joueur("a", [-60, 0, 5]));
    const conducteur = c.ajouter(joueur("c", [-55, 0, -5]));
    const s = creerServiceTigres(c.ctx, opts({ voitures: () => voitures }));
    const { fin } = tourner(s, T0, 1000 + 20_000 + TIGRE.descenteMs);
    const id = s.snap()[0].id;
    s.blesser(id, 2400, c.joueurs.get("a")!, "corps", fin); // 100 PV restants (et en fuite)
    voitures.push({ p: [60, 0, 0], cap: 0, demiLongueur: 2.2, demiLargeur: 0.95, vitesse: 15, conducteur: conducteur.id });
    const r = tourner(s, fin, 50, () => { voitures[0].p = [...(s.tigre(id)?.p ?? [0, 0, 0])] as Vec3; });
    expect(messages(r.sorties, "tigre").map((m) => m.evenement)).toEqual(["touche", "mort"]);
    expect(messages(r.sorties, "sort")).toEqual([{ t: "sort", evenement: "gagne", joueur: "c" }]);
  });
});

describe("sort d'invocation et tigre allié", () => {
  function avecCharge() {
    const r = avecTigrePose();
    r.s.blesser(r.id, 3000, r.a, "corps", r.fin);
    expect(r.s.charge("a")).toBe(true);
    return r;
  }

  it("invoquer sans charge : rien", () => {
    const c = creerContexte();
    const a = c.ajouter(joueur("a"));
    const s = creerServiceTigres(c.ctx, opts());
    expect(s.recevoir(a, { t: "invoquer" }, T0)).toEqual([]);
  });

  it("invoquer avec une charge : tigre allié à 2 m, sort{lance}, charge consommée", () => {
    const { s, a, fin } = avecCharge();
    a.p = [-60, 0, 5];
    a.lacet = 0;
    const r = s.recevoir(a, { t: "invoquer" }, fin + 10);
    const lance = messages(r, "sort")[0];
    expect(lance).toMatchObject({ evenement: "lance", joueur: "a" });
    expect(messages(r, "tigre")[0]).toMatchObject({ evenement: "apparu", genre: "allie", lanceur: "a", id: lance.tigre });
    expect(s.charge("a")).toBe(false);
    const t = s.tigre(lance.tigre!)!;
    expect(Math.hypot(t.p[0] - a.p[0], t.p[2] - a.p[2])).toBeCloseTo(2, 5);
    expect(s.snap()).toEqual([expect.objectContaining({ genre: "allie", lanceur: "a", pv: TIGRE_ALLIE.pv, etat: "suivi" })]);
  });

  it("le tigre allié attaque l'autre joueur : coups de 15 crédités au lanceur, cause « tigre »", () => {
    const { s, a, b, fin, coups } = avecCharge();
    a.p = [-60, 0, 5];
    b.p = [-50, 0, 5];
    s.recevoir(a, { t: "invoquer" }, fin + 10);
    tourner(s, fin + 10, 4000);
    expect(coups.length).toBeGreaterThanOrEqual(3);
    expect(coups.every((c) => c.cible === "b" && c.par === "a" && c.degats === 15 && c.cause === "tigre")).toBe(true);
  });

  it("le lanceur ne peut ni tirer ni frapper son propre tigre, les autres oui", () => {
    const { s, a, b, fin } = avecCharge();
    a.p = [-60, 0, 5];
    const tigre = messages(s.recevoir(a, { t: "invoquer" }, fin + 10), "sort")[0].tigre!;
    const t = s.tigre(tigre)!;
    const o: Vec3 = [t.p[0] + 10, 1.5, t.p[2]];
    const h = hitboxTigre({ p: t.p, cap: t.cap, pose: t.pose });
    const v = [(h.a[0] + h.b[0]) / 2 - o[0], h.a[1] - o[1], (h.a[2] + h.b[2]) / 2 - o[2]];
    const l = Math.hypot(v[0], v[1], v[2]);
    const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
    expect(s.validerTir(a, tigre, o, d, 100, fin + 10, 300)).toBeNull();
    expect(s.blesser(tigre, 50, a, "corps", fin + 10)).toEqual([]);
    expect(s.validerTir(b, tigre, o, d, 100, fin + 10, 300)).not.toBeNull();
    const mort = s.blesser(tigre, TIGRE_ALLIE.pv, b, "corps", fin + 10);
    expect(messages(mort, "tigre").map((m) => m.evenement)).toEqual(["touche", "mort"]);
    expect(messages(mort, "sort")).toEqual([]); // abattre un tigre allié ne donne rien
  });

  it("le tigre allié part au bout de 30 s, ou à la mort de son lanceur", () => {
    const { s, a, fin } = avecCharge();
    a.p = [-60, 0, 5];
    s.recevoir(a, { t: "invoquer" }, fin + 10);
    // (un nouvel avion peut larguer un tigre sauvage entre-temps : seuls les alliés comptent ici)
    const r = tourner(s, fin + 10, TIGRE_ALLIE.dureeMs + 50);
    expect(messages(r.sorties, "tigre").filter((m) => m.evenement === "parti" && m.genre === "allie")).toHaveLength(1);
    expect(s.snap().filter((t) => t.genre === "allie")).toEqual([]);
    const autre = avecCharge();
    autre.a.p = [-60, 0, 5];
    const id = messages(autre.s.recevoir(autre.a, { t: "invoquer" }, autre.fin + 10), "sort")[0].tigre!;
    autre.a.vivant = false;
    const r2 = autre.s.tic(autre.fin + 30);
    expect(messages(r2, "tigre")).toEqual([expect.objectContaining({ evenement: "parti", id, genre: "allie" })]);
  });
});

describe("nouveau match et entracte", () => {
  it("l'entracte retire les tigres et les charges, le nouveau match ré-arme l'avion", () => {
    const { s, etat, fin, a, id } = avecTigrePose();
    s.blesser(id, 100, a, "corps", fin);
    etat.phaseJeu = false;
    const r = s.tic(fin + 20);
    expect(messages(r, "tigre")).toEqual([expect.objectContaining({ evenement: "parti", id })]);
    expect(s.snap()).toEqual([]);
    etat.phaseJeu = true;
    expect(s.reinitialiser(fin + 1000)).toEqual([]);
    expect(messages(tourner(s, fin + 1000, 1100).sorties, "avion").map((m) => m.evenement)).toEqual(["passage"]);
  });
});
