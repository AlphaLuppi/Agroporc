import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import { INACTIF_MS, REWIND_MAX_MS, Salle, type JoueurSalle, type Sortie } from "./match";
import { JEU, PLAFONDS, SILHOUETTE, type MessageClient, type MessageServeur, type Vec3 } from "./protocole";

/** Tests réseau de la salle : compensation de latence des tirs, états abusifs, joueurs fantômes. */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const bat: Building = { h: 12, r: [[0, 0], [10, 0], [10, 10], [0, 10]], c: [5, 5] };
const petit = { ...scene, buildings: [bat], pois: [] } as SceneData;
const mondePetit = construireMonde(petit);
const POINTS: Vec2[] = [[-15, -15], [28, 28], [-15, 28], [28, -15]];
const T0 = 1_000_000;

const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
function etat(seq: number, p: Vec3, v: Vec3 = [0, 0, 0]): MessageClient {
  return { t: "etat", seq, p, v, lacet: 0, tangage: 0, posture: "sol", mur: 0 };
}
/** Deux pistolets en jeu, protection écoulée ; A à (−10, 20), B à (10, 20), tous deux « à l'arrêt ». */
function duel() {
  const s = new Salle(mondePetit, POINTS, () => 0, T0);
  for (const id of ["a", "b"]) {
    s.connecter(id, `Joueur${id}`, T0);
    s.recevoir(id, { t: "rejoindre", arme: "pistolet" }, T0);
  }
  j(s, "a").p = [-10, 0, 20];
  j(s, "b").p = [10, 0, 20];
  return { s, t: T0 + JEU.protectionMs + 100 };
}
/** A tire en visant un point du monde (centre de la cible telle que A la voyait) et déclare la touche. */
function tirerVers(s: Salle, point: Vec3, t: number): Sortie[] {
  const a = j(s, "a");
  const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
  const v = [point[0] - o[0], point[1] - o[1], point[2] - o[2]];
  const l = Math.hypot(v[0], v[1], v[2]);
  const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
  a.lacet = Math.atan2(-d[0], -d[2]);
  a.tangage = Math.asin(d[1]);
  return s.recevoir("a", { t: "tir", arme: "pistolet", o, d: [d], touches: [{ cible: "b", zone: "corps", plomb: 0 }] }, t);
}

describe("compensation de latence des tirs", () => {
  /** B court vers +z à 8 m/s pendant 200 ms (états à 30 Hz) puis s'arrête net. Renvoie l'instant du dernier état. */
  function courirPuisStopper(s: Salle, t: number): number {
    let seq = 0;
    let z = 20;
    for (let i = 1; i <= 6; i++) {
      z = 20 + 8 * 0.033 * i;
      s.recevoir("b", etat(++seq, [10, 0, z], [0, 0, 8]), t + i * 33);
    }
    s.recevoir("b", etat(++seq, [10, 0, z], [0, 0, 0]), t + 7 * 33);
    return t + 7 * 33;
  }

  it("une cible qui vient de s'arrêter reste touchable là où le tireur la voyait", () => {
    const { s, t } = duel();
    const fin = courirPuisStopper(s, t);
    expect(j(s, "b").p[2]).toBeGreaterThan(21.5);
    // A voit B vers z = 20,3 (200 ms de retard) et tire : sans historique, B est à 1,3 m du rayon > 1,2 m
    const sorties = tirerVers(s, [10, SILHOUETTE.centreY, 20.3], fin + 50);
    expect(messages(sorties, "degats")).toHaveLength(1);
    expect(j(s, "b").pv).toBe(JEU.pvMax - 28);
  });

  it("une position quittée depuis plus longtemps que la fenêtre ne compte plus", () => {
    const { s, t } = duel();
    const fin = courirPuisStopper(s, t);
    // B reste immobile ; 1 s plus tard, A tire encore à l'endroit où B était au début de sa course
    let seq = 100;
    for (let i = 1; i <= 30; i++) s.recevoir("b", etat(++seq, [10, 0, 21.6]), fin + i * 33);
    expect(REWIND_MAX_MS).toBeLessThan(900);
    const sorties = tirerVers(s, [10, SILHOUETTE.centreY, 20.3], fin + 30 * 33 + 50);
    expect(messages(sorties, "degats")).toHaveLength(0);
    expect(j(s, "b").pv).toBe(JEU.pvMax);
  });

  it("l'historique est vidé à la réapparition (aucune touche sur l'ancien emplacement)", () => {
    const { s, t } = duel();
    courirPuisStopper(s, t);
    expect(j(s, "b").histo.length).toBeGreaterThan(0);
    s.recevoir("b", { t: "quitter" }, t + 400);
    s.recevoir("b", { t: "rejoindre", arme: "pistolet" }, t + 500);
    expect(j(s, "b").histo).toEqual([]);
  });

  it("quitter puis rejoindre : jamais refusé, la santé est restaurée (pas de soin gratuit), l'historique est vidé", () => {
    const { s, t } = duel();
    j(s, "b").pv = 40;
    j(s, "b").bouclier = 25;
    s.recevoir("b", { t: "quitter" }, t + 400);
    s.recevoir("b", { t: "rejoindre", arme: "pistolet" }, t + 500);
    // le retour attend le délai de réapparition (pas de contournement par quitter / rejoindre)
    const sorties = s.tic(t + 400 + JEU.delaiReapparitionMs);
    expect(messages(sorties, "apparition")).toHaveLength(1);
    expect(j(s, "b")).toMatchObject({ enJeu: true, vivant: true, pv: 40, bouclier: 25 });
    expect(messages(sorties, "apparition")[0]).toMatchObject({ pv: 40, bouclier: 25 });
    expect(j(s, "b").histo).toEqual([]);
  });
});

describe("états abusifs", () => {
  it("la vitesse déclarée est bornée (elle élargit la hitbox et la tolérance d'œil)", () => {
    const { s, t } = duel();
    s.recevoir("a", etat(1, [-10, 0, 20], [80, 80, 80]), t);
    const [vx, vy, vz] = j(s, "a").v;
    expect(Math.hypot(vx, vz)).toBeLessThanOrEqual(PLAFONDS.vitesseDeclareeMax + 0.001);
    expect(Math.abs(vy)).toBeLessThanOrEqual(45);
  });
});

describe("joueurs fantômes", () => {
  it("un joueur en jeu sans état depuis trop longtemps quitte l'arène (onglet gelé, connexion zombie)", () => {
    const { s, t } = duel();
    // B envoie des états, A se tait
    let seq = 0;
    for (let i = 1; i <= 8; i++) s.recevoir("b", etat(++seq, [10, 0, 20]), t + i * 3000);
    const sorties = s.tic(t + INACTIF_MS + 1000);
    expect(j(s, "a").enJeu).toBe(false);
    expect(j(s, "a").vivant).toBe(false);
    expect(j(s, "b").enJeu).toBe(true);
    const presence = messages(sorties, "presence").at(-1)!;
    expect(presence.joueurs.find((x) => x.id === "a")?.enJeu).toBe(false);
    expect(messages(sorties, "snap")[0]?.j.map((x) => x.id)).toEqual(["b"]);
  });

  it("un mort qui attend sa réapparition n'est pas évincé", () => {
    const { s, t } = duel();
    j(s, "a").vivant = false;
    j(s, "a").reapparitionT = t + 1000;
    s.tic(t + 2000);
    expect(j(s, "a").enJeu).toBe(true);
  });
});

describe("cadence et gigue réseau", () => {
  function tirABlanc(s: Salle, arme: "mitraillette" | "pistolet", t: number): boolean {
    const a = j(s, "a");
    const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
    const d: Vec3 = [-Math.sin(a.lacet) * Math.cos(a.tangage), Math.sin(a.tangage), -Math.cos(a.lacet) * Math.cos(a.tangage)];
    return s.recevoir("a", { t: "tir", arme, o, d: [d], touches: [] }, t).length > 0;
  }
  function duelMitraillette() {
    const s = new Salle(mondePetit, POINTS, () => 0, T0);
    s.connecter("a", "A", T0);
    s.recevoir("a", { t: "rejoindre", arme: "mitraillette" }, T0);
    j(s, "a").p = [-10, 0, 20];
    return { s, t: T0 + JEU.protectionMs + 100 };
  }

  it("une coupure de 200 ms qui livre 3 tirs de la rafale d'un coup n'en perd aucun, sans ouvrir la porte au flood", () => {
    const { s, t } = duelMitraillette();
    // rafale à 75 ms pendant 300 ms, puis coupure : les tirs de 300, 375 et 450 ms arrivent ensemble à 500 ms
    for (let i = 0; i < 4; i++) expect(tirABlanc(s, "mitraillette", t + i * 75)).toBe(true);
    const groupes = [0, 1, 2].map(() => tirABlanc(s, "mitraillette", t + 500));
    expect(groupes).toEqual([true, true, true]);
    // et le flot continue d'être borné : 20 tirs à 5 ms
    let acceptes = 0;
    for (let i = 0; i < 20; i++) acceptes += tirABlanc(s, "mitraillette", t + 600 + i * 5) ? 1 : 0;
    expect(acceptes).toBeLessThanOrEqual(4); // 100 ms : la cadence nominale (2) + un reste de crédit
  });

  it("arme semi-automatique : pas de double tir à 10 ms d'écart", () => {
    const s = new Salle(mondePetit, POINTS, () => 0, T0);
    s.connecter("a", "A", T0);
    s.recevoir("a", { t: "rejoindre", arme: "pistolet" }, T0);
    j(s, "a").p = [-10, 0, 20];
    const t = T0 + JEU.protectionMs + 100;
    expect(tirABlanc(s, "pistolet", t)).toBe(true);
    expect(tirABlanc(s, "pistolet", t + 10)).toBe(false);
  });
});
