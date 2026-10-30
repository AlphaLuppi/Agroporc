import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { decoderApercu } from "./apercu-reseau";
import { construireMondeBr } from "./br-carte";
import { Salle, type OptionsSalle, type Sortie } from "./match";
import type { OptionsServiceBr } from "./match-br";
import type { OptionsServiceZombies } from "./match-zombies";
import { DEPARTS, construireMondeZombies } from "./zombies-carte";
import type { MessageServeur } from "./protocole";

/**
 * Intégration : l'aperçu `apercu` que la salle des zombies et celle du Battle Royale adressent à leurs seuls spectateurs (vue Palantir) : cadence,
 * contenu, budgets de taille, absence sans spectateur, absence en arène. Spec : 2026-10-29-apercus-modes-design.md
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const T0 = 5_000_000;
const mondeZ = construireMondeZombies(scene);
const mondeBr = construireMondeBr(scene);

function suite(graine = 3): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}
type Apercu = Extract<MessageServeur, { t: "apercu" }>;
const apercus = (s: Sortie[]): { a: string; m: Apercu }[] => s.filter((x) => x.m.t === "apercu").map((x) => ({ a: x.a, m: x.m as Apercu }));
const snapsJoueurs = (s: Sortie[]) => s.filter((x) => x.m.t === "snap" && x.a === "joueurs");

function avancer(s: Salle, t0: number, t1: number, pas = 50): Sortie[] {
  const out: Sortie[] = [];
  for (let t = t0; t <= t1; t += pas) {
    for (const x of s.joueurs()) if (x.enJeu) x.etatT = t;
    out.push(...s.tic(t));
  }
  return out;
}

function salleZ(zombies: Partial<OptionsServiceZombies> = {}): Salle {
  const options: OptionsSalle = { zombies: { pauseMs: 1000, degatsGriffe: 0, ...zombies } };
  return new Salle(mondeZ, DEPARTS.map((d) => [d[0], d[1]] as [number, number]), suite(), T0, options);
}

describe("aperçu des zombies", () => {
  it("un `apercu` toutes les 4 émissions de snap, aux seuls spectateurs, avec joueur, tigres et manche", () => {
    const s = salleZ({ totalManche1: 6 } as never);
    s.connecter("a", "Alice", T0);
    s.recevoir("a", { t: "lancerPartie" }, T0);
    s.recevoir("a", { t: "rejoindre" }, T0);
    s.connecter("b", "Bob", T0); // arrive pendant la partie : spectateur
    expect(s.nombreJoueurs()).toBe(2);
    expect(s.nombreEnJeu()).toBe(1);
    const out = avancer(s, T0, T0 + 12_000);
    const snaps = snapsJoueurs(out).length;
    const ap = apercus(out);
    expect(snaps).toBeGreaterThan(40);
    expect(ap.length).toBe(Math.ceil(snaps / 4));
    expect(ap.every((x) => x.a === "spectateurs" && x.m.mode === "zombies")).toBe(true);
    const dernier = ap.at(-1)!.m;
    expect(dernier.j.map((x) => x[1])).toEqual(["Alice"]);
    expect(dernier.j[0][6] & 1).toBe(1);
    expect(dernier.m).toBe(1);
    const avecTigres = ap.map((x) => x.m).filter((m) => (m.z?.z.length ?? 0) > 0);
    expect(avecTigres.length).toBeGreaterThan(0);
    const d = decoderApercu(avecTigres.at(-1)!, 1000);
    expect(d.tigres.length).toBeGreaterThan(0);
    expect(d.manche).toBe(1);
  });

  it("sans spectateur : aucun `apercu`, zéro octet", () => {
    const s = salleZ();
    s.connecter("a", "Alice", T0);
    s.recevoir("a", { t: "lancerPartie" }, T0);
    s.recevoir("a", { t: "rejoindre" }, T0);
    const out = avancer(s, T0, T0 + 6_000);
    expect(snapsJoueurs(out).length).toBeGreaterThan(20);
    expect(apercus(out)).toEqual([]);
  });

  it("l'arène n'envoie jamais d'`apercu` : le snap des spectateurs reste le même", () => {
    const depart: [number, number] = [0, 0];
    const s = new Salle(construireMondeBr(scene), [depart], suite(), T0, {});
    s.connecter("a", "Alice", T0);
    s.recevoir("a", { t: "rejoindre" }, T0);
    s.connecter("b", "Bob", T0);
    const out = avancer(s, T0 + 100, T0 + 3_000);
    expect(apercus(out)).toEqual([]);
    expect(out.some((x) => x.a === "spectateurs" && x.m.t === "snap")).toBe(true);
  });
});

describe("aperçu du Battle Royale", () => {
  function salleBr(plus: Partial<Omit<OptionsServiceBr, "alea" | "scene">> = {}): Salle {
    const depart: [number, number] = [(mondeBr.bornes.x0 + mondeBr.bornes.x1) / 2, (mondeBr.bornes.z0 + mondeBr.bornes.z1) / 2];
    return new Salle(mondeBr, [depart], suite(), T0, {
      br: { scene, dureeVolMs: 10_000, nbObjets: 50, echelleZone: 1, partieValideMinMs: 1_000, finAffichageMs: 5_000, ...plus },
    });
  }

  it("un `apercu` toutes les 3 émissions de snap, avec zone, avion et effectifs ; l'avion n'a pas de joueur à bord dans la liste", () => {
    const s = salleBr();
    for (const id of ["a", "c"]) s.connecter(id, id === "a" ? "Alice" : "Cora", T0);
    s.recevoir("a", { t: "lancerPartie" }, T0);
    let t = T0 + 100;
    for (const id of ["a", "c"]) s.recevoir(id, { t: "rejoindre" }, t);
    // un spectateur arrive pendant le décompte
    s.connecter("d", "Dan", t);
    const out: Sortie[] = [];
    const fin = t + 30_000;
    let enVol = false;
    for (; t < fin; t += 100) {
      for (const x of s.joueurs()) if (x.enJeu) x.etatT = t;
      const o = s.tic(t);
      out.push(...o);
      if (o.some((x) => x.m.t === "br" && x.m.etat.phase === "vol")) enVol = true;
    }
    expect(enVol).toBe(true);
    const ap = apercus(out);
    expect(ap.length).toBeGreaterThan(0);
    expect(ap.every((x) => x.a === "spectateurs" && x.m.mode === "br" && x.m.br)).toBe(true);
    const enVolAp = ap.map((x) => x.m).filter((m) => m.br?.phase === "vol");
    expect(enVolAp.length).toBeGreaterThan(0);
    expect(enVolAp[0].br!.avion).not.toBeNull();
    expect(enVolAp[0].br!.vivants).toBe(2);
    expect(enVolAp[0].j).toEqual([]); // tous à bord : absents du snap
    const snaps = snapsJoueurs(out).length;
    expect(ap.length).toBe(Math.ceil(snaps / 3));
  });

  it("le relais (`relaiApercu`) calcule l'aperçu même sans spectateur chez soi", () => {
    const s = salleBr();
    s.connecter("a", "Alice", T0);
    s.connecter("c", "Cora", T0);
    s.recevoir("a", { t: "lancerPartie" }, T0);
    s.recevoir("a", { t: "rejoindre" }, T0 + 100);
    s.recevoir("c", { t: "rejoindre" }, T0 + 100);
    const sans = avancer(s, T0 + 100, T0 + 3_000, 100);
    expect(apercus(sans)).toEqual([]);
    s.relaiApercu = true;
    const avec = avancer(s, T0 + 3_100, T0 + 6_000, 100);
    expect(apercus(avec).length).toBeGreaterThan(0);
  });
});
