/**
 * Grenades de l'arène (lot tactique) : stock par vie, lancer validé par le serveur, souffle sur les joueurs en vue (kill crédité au lanceur, auto-dégâts,
 * protection d'apparition), armes uniques du bus C3 qui tirent un PROJECTILE (obus, roquette, bidon) au lieu d'une balle instantanée, fumigène de la touche B.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import { GRENADES, GRENADES_JOUEURS, positionTrajectoire, trajectoireDuMessage } from "./grenades";
import { Salle, type JoueurSalle, type Sortie } from "./match";
import { oeilDe, type MessageServeur, type Vec3 } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 10, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
const monde = construireMonde({ ...scene, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000)], pois: [] } as SceneData);
const APPARITIONS: Vec2[] = [[-300, -300], [300, 300], [-300, 300], [300, -300]];
const T0 = 2_000_000;
const PAS = 1000 / 60;

function salle(ids: string[]): Salle {
  const s = new Salle(monde, APPARITIONS, () => 0.5, T0, { bus: false });
  for (const id of ids) {
    s.connecter(id, `Joueur${id}`, T0);
    s.recevoir(id, { t: "rejoindre", principale: "sniper", secondaire: "pistolet" }, T0);
  }
  return s;
}
const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
function avancer(s: Salle, de: number, a: number, chaque?: (t: number) => void): { sorties: Sortie[]; t: number } {
  const sorties: Sortie[] = [];
  let t = de;
  while (t < a) {
    t = Math.min(a, t + PAS);
    chaque?.(t);
    sorties.push(...s.tic(t));
  }
  return { sorties, t };
}
/** Pose les joueurs aux positions voulues, vivants côté réseau, sans protection d'apparition. */
function tenir(s: Salle, positions: Record<string, Vec3>, t: number) {
  for (const [id, p] of Object.entries(positions)) { const a = j(s, id); a.p = [...p]; a.v = [0, 0, 0]; a.etatT = t; a.protegeJusqua = 0; }
}
const oeil = (p: Vec3): Vec3 => [p[0], p[1] + oeilDe({ accroupi: false }), p[2]];
/** Lance une grenade droit devant (lacet 0 : vers −z). */
function lancer(s: Salle, id: string, t: number, cuissonMs = 0) {
  const a = j(s, id);
  a.lacet = 0; a.tangage = 0;
  return s.recevoir(id, { t: "lancerGrenade", genre: "frag", o: oeil(a.p), d: [0, 0, -1], cuissonMs }, t);
}
/** Point où la grenade du message s'immobilise (là où le serveur la fait exploser). */
function atterrissage(m: Extract<MessageServeur, { t: "grenade" }>): Vec3 {
  const traj = trajectoireDuMessage(monde, m);
  return positionTrajectoire(traj, m.explosionT - m.t0);
}
/** Stock annoncé au joueur au dernier `stockGrenades` des sorties. */
const stockAnnonce = (sorties: Sortie[], id: string): number | undefined =>
  sorties.filter((x) => x.a === id && x.m.t === "stockGrenades").map((x) => (x.m as Extract<MessageServeur, { t: "stockGrenades" }>).n).at(-1);

describe("grenades de l'arène : stock par vie", () => {
  it("2 grenades à l'apparition, annoncées au joueur seul au tic suivant", () => {
    const s = salle(["a", "b"]);
    const sorties = s.tic(T0 + PAS);
    expect(stockAnnonce(sorties, "a")).toBe(GRENADES_JOUEURS.parVie);
    expect(stockAnnonce(sorties, "b")).toBe(GRENADES_JOUEURS.parVie);
    expect(sorties.filter((x) => x.m.t === "stockGrenades").every((x) => x.a === "a" || x.a === "b")).toBe(true);
  });

  it("un lancer décompte une grenade, diffuse la trajectoire à tous les joueurs et refuse une rafale (500 ms)", () => {
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [60, 0, 0] }, T0);
    s.tic(T0 + PAS);
    const out = lancer(s, "a", T0 + 100);
    const g = messages(out, "grenade");
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ par: "a", genre: "frag" });
    expect(out.find((x) => x.m.t === "grenade")!.a).toBe("joueurs");
    expect(g[0].explosionT).toBe(T0 + 100 + GRENADES.frag.mecheMs);
    expect(stockAnnonce(s.tic(T0 + 120), "a")).toBe(1);
    // trop tôt : refusé, le stock ne bouge pas
    expect(messages(lancer(s, "a", T0 + 300), "grenade")).toHaveLength(0);
    // assez tard : la seconde part ; le stock est vide, une troisième est refusée
    expect(messages(lancer(s, "a", T0 + 700), "grenade")).toHaveLength(1);
    expect(stockAnnonce(s.tic(T0 + 720), "a")).toBe(0);
    expect(messages(lancer(s, "a", T0 + 1_500), "grenade")).toHaveLength(0);
  });

  it("la cuisson raccourcit la mèche ; le serveur la borne", () => {
    const s = salle(["a"]);
    tenir(s, { a: [0, 0, 0] }, T0);
    const g = messages(lancer(s, "a", T0 + 100, 2_000), "grenade")[0];
    expect(g.explosionT).toBe(T0 + 100 + GRENADES.frag.mecheMs - 2_000);
    const s2 = salle(["a"]);
    tenir(s2, { a: [0, 0, 0] }, T0);
    expect(messages(lancer(s2, "a", T0 + 100, 99_999), "grenade")[0].explosionT).toBe(T0 + 100);
  });

  it("rien sans œil crédible, sans direction valable, d'un mort ou avec un genre qui n'est pas la grenade", () => {
    const s = salle(["a"]);
    tenir(s, { a: [0, 0, 0] }, T0);
    j(s, "a").lacet = 0;
    expect(messages(s.recevoir("a", { t: "lancerGrenade", genre: "frag", o: [50, 1, 50], d: [0, 0, -1] }, T0 + 100), "grenade")).toHaveLength(0);
    expect(messages(s.recevoir("a", { t: "lancerGrenade", genre: "frag", o: oeil([0, 0, 0]), d: [0, 0, 1] }, T0 + 100), "grenade")).toHaveLength(0);
    expect(messages(s.recevoir("a", { t: "lancerGrenade", genre: "remontoir", o: oeil([0, 0, 0]), d: [0, 0, -1] }, T0 + 100), "grenade")).toHaveLength(0);
    expect(messages(s.recevoir("a", { t: "lancerGrenade", genre: "obus", o: oeil([0, 0, 0]), d: [0, 0, -1] }, T0 + 100), "grenade")).toHaveLength(0);
    j(s, "a").vivant = false;
    expect(messages(lancer(s, "a", T0 + 100), "grenade")).toHaveLength(0);
  });

  it("lancer annule la protection d'apparition, comme tirer", () => {
    const s = salle(["a"]);
    tenir(s, { a: [0, 0, 0] }, T0);
    j(s, "a").protegeJusqua = T0 + 5_000;
    lancer(s, "a", T0 + 100);
    expect(j(s, "a").protegeJusqua).toBe(0);
  });

  it("la mort efface le stock et la réapparition rend 2 grenades", () => {
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [60, 0, 0] }, T0);
    s.tic(T0 + PAS);
    lancer(s, "a", T0 + 100);
    s.tic(T0 + 120);
    s.tuer(j(s, "a"), j(s, "b"), "arme", T0 + 200);
    // réapparition à 4 s
    const sorties = avancer(s, T0 + 200, T0 + 4_500, (t) => tenir(s, { b: [60, 0, 0] }, t)).sorties;
    expect(j(s, "a").vivant).toBe(true);
    expect(stockAnnonce(sorties, "a")).toBe(GRENADES_JOUEURS.parVie);
  });
});

describe("grenades de l'arène : souffle", () => {
  /** Lance et renvoie le point d'atterrissage, l'échéance et le message. */
  function preparer(positions: (atterri: Vec3) => Record<string, Vec3>, pvB?: number) {
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [200, 0, 200] }, T0);
    s.tic(T0 + PAS);
    const g = messages(lancer(s, "a", T0 + 100), "grenade")[0];
    const p = atterrissage(g);
    if (pvB !== undefined) j(s, "b").pv = pvB;
    return { s, g, p, positions: positions(p) };
  }

  it("blesse l'adversaire en vue, dégâts dégressifs, annonce l'explosion à tous les joueurs", () => {
    const { s, g, p } = preparer((p) => ({ a: [-200, 0, -200], b: [p[0] + 2, 0, p[2]] }));
    const posB: Vec3 = [p[0] + 2, 0, p[2]];
    const res = avancer(s, T0 + 100, g.explosionT + 100, (t) => tenir(s, { a: [-200, 0, -200], b: posB }, t));
    const ex = messages(res.sorties, "grenadeExplose");
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ id: g.id, genre: "frag", par: "a" });
    expect(res.sorties.find((x) => x.m.t === "grenadeExplose")!.a).toBe("joueurs");
    expect(ex[0].p[0]).toBeCloseTo(p[0], 0);
    const deg = messages(res.sorties, "degats").filter((d) => d.cible === "b");
    expect(deg).toHaveLength(1);
    expect(deg[0].par).toBe("a");
    expect(deg[0].degats).toBeGreaterThan(100);
    expect(deg[0].degats).toBeLessThan(GRENADES.frag.joueurs!.centre);
    expect(messages(res.sorties, "degats").filter((d) => d.cible === "a")).toHaveLength(0);
  });

  it("le kill est crédité au lanceur avec la cause « grenade »", () => {
    const { s, g, p } = preparer(() => ({}), 20);
    const posB: Vec3 = [p[0] + 1, 0, p[2]];
    const res = avancer(s, T0 + 100, g.explosionT + 100, (t) => tenir(s, { a: [-200, 0, -200], b: posB }, t));
    const mort = messages(res.sorties, "mort");
    expect(mort).toHaveLength(1);
    expect(mort[0]).toMatchObject({ cible: "b", par: "a", cause: "grenade" });
    expect(j(s, "a").kills).toBe(1);
    expect(j(s, "b").vivant).toBe(false);
    // une seule présence malgré le kill (mêmes sorties qu'un tir)
    expect(messages(res.sorties, "presence").length).toBeLessThanOrEqual(1);
  });

  it("le lanceur est blessé par sa propre grenade, sans kill pour lui-même", () => {
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [200, 0, 200] }, T0);
    s.tic(T0 + PAS);
    const g = messages(lancer(s, "a", T0 + 100, 3_450), "grenade")[0]; // quasi tout de suite : il est encore à côté
    const res = avancer(s, T0 + 100, g.explosionT + 100, (t) => tenir(s, { a: [0, 0, -1], b: [200, 0, 200] }, t));
    const deg = messages(res.sorties, "degats").filter((d) => d.cible === "a");
    expect(deg).toHaveLength(1);
    expect(deg[0].par).toBe("a");
    expect(j(s, "a").pv + j(s, "a").bouclier).toBeLessThan(200);
    // mourir de sa grenade : mort sans tueur, aucun kill
    const s2 = salle(["a", "b"]);
    tenir(s2, { a: [0, 0, 0], b: [200, 0, 200] }, T0);
    s2.tic(T0 + PAS);
    const g2 = messages(lancer(s2, "a", T0 + 100, 3_450), "grenade")[0];
    j(s2, "a").pv = 10; j(s2, "a").bouclier = 0;
    const res2 = avancer(s2, T0 + 100, g2.explosionT + 100, (t) => tenir(s2, { a: [0, 0, -1], b: [200, 0, 200] }, t));
    const mort = messages(res2.sorties, "mort");
    expect(mort).toHaveLength(1);
    expect(mort[0]).toMatchObject({ cible: "a", par: "", cause: "grenade" });
    expect(j(s2, "a").kills).toBe(0);
  });

  it("n'atteint ni un joueur hors du rayon ni un joueur sous protection d'apparition", () => {
    const { s, g, p } = preparer(() => ({}));
    const loin: Vec3 = [p[0] + GRENADES.frag.rayonM + 3, 0, p[2]];
    const res = avancer(s, T0 + 100, g.explosionT + 100, (t) => tenir(s, { a: [-200, 0, -200], b: loin }, t));
    expect(messages(res.sorties, "degats")).toHaveLength(0);
    const { s: s2, g: g2, p: p2 } = preparer(() => ({}));
    const posB: Vec3 = [p2[0] + 1, 0, p2[2]];
    const res2 = avancer(s2, T0 + 100, g2.explosionT + 100, (t) => { tenir(s2, { a: [-200, 0, -200], b: posB }, t); j(s2, "b").protegeJusqua = t + 5_000; });
    expect(messages(res2.sorties, "degats")).toHaveLength(0);
    expect(messages(res2.sorties, "grenadeExplose")).toHaveLength(1);
  });

  it("un mur plein entre le centre et le joueur arrête le souffle", () => {
    // un bâtiment plein de 20 m de haut pose un écran entre l'explosion et b
    const mur = construireMonde({ ...scene, buildings: [{ ...rect(-6, -0.25, 6, 0.25), h: 20 }, rect(-2000, -2000, -1999, -1999)], pois: [] } as SceneData);
    const s = new Salle(mur, APPARITIONS, () => 0.5, T0, { bus: false });
    for (const id of ["a", "b"]) { s.connecter(id, id, T0); s.recevoir(id, { t: "rejoindre", principale: "sniper", secondaire: "pistolet" }, T0); }
    tenir(s, { a: [0, 0, 9], b: [200, 0, 200] }, T0);
    s.tic(T0 + PAS);
    const a = j(s, "a");
    a.lacet = 0; a.tangage = 0;
    // mèche courte, lancer au ras du sol vers le mur : la grenade rebondit contre sa face sud (z = 1)
    const g = messages(s.recevoir("a", { t: "lancerGrenade", genre: "frag", o: oeil(a.p), d: [0, 0, -1], cuissonMs: 0 }, T0 + 100), "grenade")[0];
    const p = positionTrajectoire(trajectoireDuMessage(mur, g), g.explosionT - g.t0);
    // b juste de l'autre côté du bâtiment, à moins de 4 m du centre mais caché
    const derriere: Vec3 = [p[0], 0, -0.9];
    const res = avancer(s, T0 + 100, g.explosionT + 100, (t) => tenir(s, { a: [150, 0, 150], b: derriere }, t));
    // le test n'est pas vide : b est bien dans le rayon du souffle, le mur seul le protège
    expect(Math.hypot(p[0] - derriere[0], p[2] - derriere[2])).toBeLessThan(GRENADES.frag.rayonM);
    expect(messages(res.sorties, "degats").filter((d) => d.cible === "b")).toHaveLength(0);
    expect(messages(res.sorties, "grenadeExplose")).toHaveLength(1);
  });
});

describe("armes uniques du bus C3 : un projectile, pas une balle invisible", () => {
  /** Donne l'arme unique en main au joueur `id` et tire droit devant. */
  function tirerUnique(s: Salle, id: string, arme: "lance_grenades" | "bazooka" | "fumigene", t: number) {
    const a = j(s, id);
    a.equip.speciale = arme;
    a.munSpeciale = arme === "bazooka" ? 3 : arme === "fumigene" ? 3 : 6;
    a.main = "speciale";
    a.arme = arme;
    a.sortieJusqua = 0;
    a.lacet = 0; a.tangage = 0;
    return s.recevoir(id, { t: "tir", arme, o: oeil(a.p), d: [[0, 0, -1]], touches: [] }, t);
  }

  it("le bazooka part en roquette : message `grenade`, aucun dégât instantané, une munition de moins", () => {
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [200, 0, 200] }, T0);
    const out = tirerUnique(s, "a", "bazooka", T0 + 100);
    const g = messages(out, "grenade");
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ par: "a", genre: "roquette" });
    expect(messages(out, "degats")).toHaveLength(0);
    expect(j(s, "a").munSpeciale).toBe(2);
    // les autres reçoivent le tir (flash, son) mais pas pour une traçante : le client le sait par `statsTir`
    expect(messages(out, "tir")).toHaveLength(1);
  });

  it("le lance-grenades tire un obus, le fumigène un bidon", () => {
    const s = salle(["a"]);
    tenir(s, { a: [0, 0, 0] }, T0);
    expect(messages(tirerUnique(s, "a", "lance_grenades", T0 + 100), "grenade")[0].genre).toBe("obus");
    expect(messages(tirerUnique(s, "a", "fumigene", T0 + 1_500), "grenade")[0].genre).toBe("fumi");
  });

  it("la roquette explose sur le premier joueur rencontré, avant l'échéance annoncée, et le blesse", () => {
    const s = salle(["a", "b"]);
    const posB: Vec3 = [0, 0, -25];
    tenir(s, { a: [0, 0, 0], b: posB }, T0);
    const out = tirerUnique(s, "a", "bazooka", T0 + 100);
    const g = messages(out, "grenade")[0];
    const res = avancer(s, T0 + 100, T0 + 1_500, (t) => tenir(s, { a: [0, 0, 0], b: posB }, t));
    const ex = messages(res.sorties, "grenadeExplose");
    expect(ex).toHaveLength(1);
    expect(ex[0].genre).toBe("roquette");
    // avant le contact avec le décor ou la fin de vol annoncés
    expect(ex[0].p[2]).toBeGreaterThan(-27);
    expect(ex[0].p[2]).toBeLessThan(-22);
    expect(g.explosionT).toBeGreaterThan(T0 + 100);
    const mort = messages(res.sorties, "mort");
    expect(mort).toHaveLength(1);
    expect(mort[0]).toMatchObject({ cible: "b", par: "a", cause: "grenade" });
  });

  it("le bidon fumigène ouvre un nuage 1,2 s plus tard (message `fumigene` et snap), sans blesser personne", () => {
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [3, 0, -6] }, T0);
    const out = tirerUnique(s, "a", "fumigene", T0 + 100);
    const g = messages(out, "grenade")[0];
    expect(g.explosionT).toBe(T0 + 100 + GRENADES.fumi.mecheMs);
    const res = avancer(s, T0 + 100, g.explosionT + 200, (t) => tenir(s, { a: [0, 0, 0], b: [3, 0, -6] }, t));
    expect(messages(res.sorties, "fumigene")).toHaveLength(1);
    expect(messages(res.sorties, "degats")).toHaveLength(0);
    expect(messages(res.sorties, "grenadeExplose")[0].genre).toBe("fumi");
    const snap = messages(res.sorties, "snap").at(-1)!;
    expect(snap.monstres?.fumigenes?.length).toBe(1);
  });
});

describe("fumigène de la touche B", () => {
  it("part comme un bidon visible, un toutes les 15 s", () => {
    const s = salle(["a"]);
    tenir(s, { a: [0, 0, 0] }, T0);
    const a = j(s, "a");
    a.lacet = 0; a.tangage = 0;
    const msg = { t: "lancerFumigene" as const, p: oeil(a.p), v: [0, 0, -18] as Vec3 };
    const premier = s.recevoir("a", msg, T0 + 100);
    expect(messages(premier, "grenade")).toHaveLength(1);
    expect(messages(premier, "grenade")[0].genre).toBe("fumi");
    expect(messages(s.recevoir("a", msg, T0 + 5_000), "grenade")).toHaveLength(0);
    expect(messages(s.recevoir("a", msg, T0 + 15_200), "grenade")).toHaveLength(1);
  });
});

describe("arrivée en cours de partie", () => {
  it("un joueur qui entre reçoit les projectiles déjà en vol", () => {
    const s = salle(["a"]);
    tenir(s, { a: [0, 0, 0] }, T0);
    lancer(s, "a", T0 + 100);
    s.connecter("c", "Cora", T0 + 200);
    const out = s.recevoir("c", { t: "rejoindre", principale: "sniper", secondaire: "pistolet" }, T0 + 200);
    expect(out.filter((x) => x.a === "c" && x.m.t === "grenade")).toHaveLength(1);
  });
});

describe("souffle sur ce qui n'est pas un joueur (tigres, monstres, police, voitures)", () => {
  /** Salle d'arène dont les services de cibles sont remplacés par des doublures qui notent les dégâts reçus. */
  function avecCibles() {
    const s = salle(["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [300, 0, 300] }, T0);
    const recus: Record<string, { cible: string; degats: number }[]> = { tigres: [], monstres: [], police: [], voitures: [] };
    const interne = s as unknown as Record<string, unknown>;
    interne.tigres = {
      snap: () => [
        { id: "t1", genre: "sauvage", p: [10, 0, 0], cap: 0, etat: "attaque", pose: "debout", pv: 100 },
        { id: "t2", genre: "allie", lanceur: "a", p: [10, 0, 1], cap: 0, etat: "suivi", pose: "debout", pv: 100 },
        { id: "t3", genre: "allie", lanceur: "b", p: [11, 0, 0], cap: 0, etat: "suivi", pose: "debout", pv: 100 },
        { id: "t4", genre: "sauvage", p: [60, 0, 0], cap: 0, etat: "attaque", pose: "debout", pv: 100 },
      ],
      blesser: (id: string, degats: number) => { recus.tigres.push({ cible: id, degats }); return []; },
    };
    interne.evenements = {
      distanceMonstre: (cible: string) => (cible === "tigre" ? 2 : null),
      blesserMonstre: (cible: string, degats: number) => { recus.monstres.push({ cible, degats }); return []; },
    };
    interne.police = {
      snap: () => ({ p: [10, 0, -5], cap: 0, v: 0, pv: 700, pvMax: 700 }),
      blesser: (_par: unknown, degats: number) => { recus.police.push({ cible: "police", degats }); return []; },
    };
    interne.vehicules = {
      soufflerVoitures: (_c: Vec3, degats: (d: number) => number) => { recus.voitures.push({ cible: "voiture", degats: degats(1) }); return []; },
    };
    return { s, recus };
  }

  it("la grenade blesse les tigres largués à portée (pas le tigre allié du lanceur), le tigre robot, la police et les voitures", () => {
    const { s, recus } = avecCibles();
    s.souffleSurCibles([10, 0.9, 0], "frag", j(s, "a"), T0 + 1000);
    // t1 au centre ; t3 (allié d'un AUTRE joueur) à 1 m ; t2 (allié du lanceur) épargné ; t4 à 50 m hors rayon
    const ids = recus.tigres.map((r) => r.cible).sort();
    expect(ids).toEqual(["t1", "t3"]);
    expect(recus.tigres.find((r) => r.cible === "t1")!.degats).toBeGreaterThan(100);
    expect(recus.monstres).toEqual([{ cible: "tigre", degats: expect.any(Number) }]);
    expect(recus.monstres[0].degats).toBeGreaterThan(0);
    expect(recus.police).toHaveLength(1);
    expect(recus.voitures).toHaveLength(1);
    expect(recus.voitures[0].degats).toBeGreaterThan(0);
  });

  it("le fumigène ne blesse rien ; hors phase de jeu, rien non plus", () => {
    const { s, recus } = avecCibles();
    s.souffleSurCibles([10, 0.9, 0], "fumi", j(s, "a"), T0 + 1000);
    expect(recus.tigres).toEqual([]);
    expect(recus.monstres).toEqual([]);
    expect(recus.police).toEqual([]);
  });

  it("une explosion de grenade réelle (mèche écoulée) appelle ce souffle avec le lanceur", () => {
    const s = salle(["a", "b"]);
    const espion = vi.spyOn(s, "souffleSurCibles");
    tenir(s, { a: [0, 0, 0], b: [300, 0, 300] }, T0);
    s.tic(T0 + PAS);
    const g = messages(lancer(s, "a", T0 + 100), "grenade")[0];
    avancer(s, T0 + 100, g.explosionT + 100, (t) => tenir(s, { a: [0, 0, 0], b: [300, 0, 300] }, t));
    expect(espion).toHaveBeenCalledTimes(1);
    expect(espion.mock.calls[0][1]).toBe("frag");
    expect(espion.mock.calls[0][2].id).toBe("a");
  });
});
