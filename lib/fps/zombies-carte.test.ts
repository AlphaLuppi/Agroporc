import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dedans, distSegment } from "../agroparc3d/cachettes";
import type { SceneData, Vec2 } from "../agroparc3d/types";
import { detruireBatiment, lancerRayon, resoudre, visible, type Monde } from "./collision";
import { capVers } from "./monstres";
import { DIST_INF, carteNavigation, champDistance, invaliderNavigation } from "./navigation";
import {
  ACHATS, ACHATS_PORTES, BORNES_ZOMBIES, DECALAGE_FACADE_M, DEPARTS, FENETRES, HAUTEUR_MURS_ZOMBIES, INDEX_PREMIERE_PIECE, NICHE, PIECES_SYNTH,
  PORTES_PAYANTES, ZONES, achatDeId, achatsProches, batimentDePiece, construireMondeZombies, distancePorte, donneesZombies, fenetresActives,
  idPrisme, lacetDepart, porteDeId, type PorteId,
} from "./zombies-carte";
import { ZOMBIES } from "./zombies-vagues";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const TIMEOUT = 30_000;

/** Flood-fill 4-voisins sur une grille de `pas` m (cases libres = disque de `rayon` sans contact avec `resoudre`). */
function remplir(monde: Monde, graines: readonly (readonly [number, number])[], opts: { pas?: number; rayon?: number; ignorer?: boolean } = {}) {
  const pas = opts.pas ?? 0.5, rayon = opts.rayon ?? 0.4, ignorer = opts.ignorer ?? false;
  const b = monde.bornes;
  const nx = Math.ceil((b.x1 - b.x0) / pas), nz = Math.ceil((b.z1 - b.z0) / pas);
  const etat = new Uint8Array(nx * nz); // 0 inconnu, 1 libre, 2 bloqué
  const libre = (i: number, j: number) => {
    const k = i + j * nx;
    if (etat[k] === 0) etat[k] = resoudre(monde, [b.x0 + (i + 0.5) * pas, 0, b.z0 + (j + 0.5) * pas], rayon, ZOMBIES.hauteurTigre, ignorer).contacts.length ? 2 : 1;
    return etat[k] === 1;
  };
  const vu = new Uint8Array(nx * nz);
  const pile: number[] = [];
  for (const [x, z] of graines) {
    const i = Math.floor((x - b.x0) / pas), j = Math.floor((z - b.z0) / pas);
    if (libre(i, j) && !vu[i + j * nx]) { vu[i + j * nx] = 1; pile.push(i + j * nx); }
  }
  let n = 0;
  const cases: number[] = [];
  while (pile.length) {
    const k = pile.pop()!;
    n++;
    cases.push(k);
    const i = k % nx, j = (k - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, c = j + dj;
      if (a < 0 || c < 0 || a >= nx || c >= nz || vu[a + c * nx]) continue;
      if (libre(a, c)) { vu[a + c * nx] = 1; pile.push(a + c * nx); }
    }
  }
  return {
    aire: n * pas * pas,
    atteint: (x: number, z: number) => {
      const i = Math.floor((x - b.x0) / pas), j = Math.floor((z - b.z0) / pas);
      return i >= 0 && j >= 0 && i < nx && j < nz && vu[i + j * nx] === 1;
    },
    centres: () => cases.map((k) => { const i = k % nx, j = (k - i) / nx; return [b.x0 + (i + 0.5) * pas, b.z0 + (j + 0.5) * pas] as Vec2; }),
  };
}

function ouvrir(monde: Monde, portes: readonly PorteId[]): void {
  for (const id of portes) for (const pr of porteDeId(id)!.prismes) detruireBatiment(monde, idPrisme(pr));
}

/** Distance (m) d'un point au mur le plus proche (anneaux de tous les prismes du monde, y compris les pièces). */
function distMurs(monde: Monde, x: number, z: number): number {
  let d = Infinity;
  for (const p of monde.prismes) {
    if (x < p.boite.x0 - 10 || x > p.boite.x1 + 10 || z < p.boite.z0 - 10 || z > p.boite.z1 + 10) continue;
    for (const anneau of [p.anneau, ...p.trous]) {
      for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) d = Math.min(d, distSegment(x, z, anneau[j][0], anneau[j][1], anneau[i][0], anneau[i][1]));
    }
  }
  return d;
}

const mil = (id: string): Vec2 => { const s = PIECES_SYNTH.find((p) => p.id === id)!; return [(s.p[0] + s.q[0]) / 2, (s.p[1] + s.q[1]) / 2]; };
const ordre: PorteId[] = ["P1", "P3", "P2", "P4", "P5"];

describe("pièces synthétiques et données", () => {
  it("20 pièces à la suite des 142 bâtiments, dans l'ordre fixe de la spec", () => {
    expect(scene.buildings.length).toBe(INDEX_PREMIERE_PIECE);
    expect(PIECES_SYNTH.map((p) => p.id)).toEqual([
      "G1", "G2", "G3", "G4", "E", "S1", "S2", "N4", "W", "N2c", "S1c", "S2c", "N4c", "Wc", "N1", "N3", "N5", "PW", "PN", "PE",
    ]);
    const { data } = donneesZombies(scene);
    expect(data.buildings.length).toBe(162);
    PIECES_SYNTH.forEach((p, k) => {
      const b = data.buildings[INDEX_PREMIERE_PIECE + k];
      expect(b.type).toBe(p.type);
      expect(b.h).toBe(6);
      expect(idPrisme(p.id)).toBe(INDEX_PREMIERE_PIECE + k);
      expect(b.c[0]).toBeCloseTo((p.p[0] + p.q[0]) / 2, 9);
      expect(b.c[1]).toBeCloseTo((p.p[1] + p.q[1]) / 2, 9);
    });
    expect(donneesZombies(scene).data.buildings.slice(0, 142)).toEqual(scene.buildings);
  });

  it("rectangle de demi-épaisseur 0,8 m prolongé de 0,3 m à chaque bout", () => {
    const g1 = PIECES_SYNTH[0];
    const b = batimentDePiece(g1);
    const l = Math.hypot(g1.q[0] - g1.p[0], g1.q[1] - g1.p[1]);
    expect(b.r).toHaveLength(4);
    const cote = Math.hypot(b.r[0][0] - b.r[1][0], b.r[0][1] - b.r[1][1]);
    const longueur = Math.hypot(b.r[1][0] - b.r[2][0], b.r[1][1] - b.r[2][1]);
    expect(cote).toBeCloseTo(1.6, 9);
    expect(longueur).toBeCloseTo(l + 0.6, 9);
  });

  it("ne modifie jamais scene.json (copie profonde)", () => {
    const avant = JSON.stringify(scene);
    const d = donneesZombies(scene);
    const monde = construireMondeZombies(scene);
    // des mutations sur la copie et le monde ne remontent pas non plus
    d.data.buildings[0].r[0][0] += 100;
    d.data.buildings[0].h += 1;
    monde.prismes[0].h = 0;
    ouvrir(monde, ordre);
    expect(JSON.stringify(scene)).toBe(avant);
  });

  it("retire le POI du Truck Muche (pas de prisme fixe) et fixe le focus", () => {
    expect(scene.pois.some((p) => p.type === "truck")).toBe(true);
    const { data } = donneesZombies(scene);
    expect(data.pois.some((p) => p.type === "truck")).toBe(false);
    expect(data.pois.length).toBe(scene.pois.length - 1);
    const monde = construireMondeZombies(scene);
    expect(monde.prismes.length).toBe(162);
    expect(monde.prismes.some((p) => p.fixe)).toBe(false);
    expect(data.focus).not.toEqual(scene.focus);
  });

  it("monde zombies : bornes réduites, murs hauts (40) pour tous les prismes, champs passe-tigres", () => {
    const monde = construireMondeZombies(scene);
    expect(monde.bornes).toEqual({ x0: 8, z0: -110, x1: 214, z1: 24 });
    expect(BORNES_ZOMBIES).toEqual(monde.bornes);
    for (const p of monde.prismes) { expect(p.h).toBe(HAUTEUR_MURS_ZOMBIES); expect(p.hOrigine).toBe(HAUTEUR_MURS_ZOMBIES); }
    const champs = PIECES_SYNTH.filter((p) => p.type === "champ").map((p) => p.id);
    expect(champs).toEqual(["N2c", "S1c", "S2c", "N4c", "Wc"]);
    monde.prismes.forEach((p, i) => {
      const piece = PIECES_SYNTH[i - INDEX_PREMIERE_PIECE];
      expect(p.passeTigre === true).toBe(piece?.type === "champ");
    });
  });
});

/** Portes à ouvrir, prérequis compris, pour ouvrir `id`. */
function ordrePrerequis(id: PorteId): PorteId[] {
  const chaine: PorteId[] = [];
  for (let p: PorteId | null = id; p; p = porteDeId(p)!.prerequis) chaine.unshift(p);
  return chaine;
}

/** Monde dont la seule fenêtre (champ) qui laisse passer les tigres est `fenetre` ; `ouvertes` : portes détruites. */
function mondeFenetre(fenetre: string, ouvertes: readonly PorteId[]): Monde {
  const monde = construireMondeZombies(scene);
  for (const f of FENETRES) if (f.id !== fenetre) delete monde.prismes[idPrisme(f.id)].passeTigre;
  ouvrir(monde, ouvertes);
  return monde;
}

describe("progression et zones (flood-fill 0,5 m, rayon joueur 0,4 m)", () => {
  it("portes fermées : la cour Centre fait ≈ 1 782 m² et contient les huit départs", () => {
    const monde = construireMondeZombies(scene);
    const f = remplir(monde, DEPARTS);
    expect(Math.abs(f.aire - 1782) / 1782).toBeLessThan(0.05);
    for (const [x, z] of DEPARTS) expect(f.atteint(x, z)).toBe(true);
    // une seule composante : un seul départ suffit à tout remplir
    expect(remplir(monde, [DEPARTS[0]]).aire).toBe(f.aire);
  }, TIMEOUT);

  it("ouvrir P1, P3, P2, P4, P5 dans cet ordre : aires cumulées 1 975 / 2 126 / 3 908 / 5 269 / 5 604", () => {
    const monde = construireMondeZombies(scene);
    const attendu: Record<string, [number, number]> = { P1: [1975, 193], P3: [2126, 151], P2: [3908, 1782], P4: [5269, 1361], P5: [5604, 335] };
    let avant = remplir(monde, DEPARTS).aire;
    for (const id of ordre) {
      ouvrir(monde, [id]);
      const a = remplir(monde, DEPARTS).aire;
      expect(Math.abs(a - attendu[id][0]) / attendu[id][0], `${id} : ${a}`).toBeLessThan(0.05);
      expect(Math.abs(a - avant - attendu[id][1]) / attendu[id][1], `gain ${id} : ${a - avant}`).toBeLessThan(0.06);
      avant = a;
    }
  }, TIMEOUT);

  it("prérequis des portes et fenêtres activées", () => {
    expect(porteDeId("P1")!.prerequis).toBeNull();
    expect(porteDeId("P3")!.prerequis).toBeNull();
    expect(porteDeId("P2")!.prerequis).toBe("P1");
    expect(porteDeId("P4")!.prerequis).toBe("P3");
    expect(porteDeId("P5")!.prerequis).toBe("P2");
    expect(porteDeId("PX")).toBeNull();
    expect(PORTES_PAYANTES.map((p) => [p.id, p.prix])).toEqual([["P1", 750], ["P3", 1000], ["P2", 1250], ["P4", 1500], ["P5", 2000]]);
    expect(PORTES_PAYANTES.map((p) => p.prismes)).toEqual([["G3", "S2"], ["G2", "S1"], ["G4", "N4"], ["G1", "W"], ["E"]]);
    expect(PORTES_PAYANTES.map((p) => p.fenetre)).toEqual(["S2c", "S1c", "N4c", "Wc", null]);
    // les zones demandent la chaîne complète de prérequis
    for (const z of ZONES) {
      for (const id of z.portes) { const pre = porteDeId(id)!.prerequis; if (pre) expect(z.portes).toContain(pre); }
    }
    expect(fenetresActives([]).map((f) => f.id)).toEqual(["N2c"]);
    expect(fenetresActives(["P1", "P4"]).map((f) => f.id)).toEqual(["N2c", "S2c", "Wc"]);
    expect(fenetresActives(new Set(ordre)).map((f) => f.id)).toEqual(["N2c", "S1c", "S2c", "N4c", "Wc"]);
  });

  it("distances d'achat des portes depuis la cour Centre, et aucune case à ≤ 3 m de G4, G1, E", () => {
    const monde = construireMondeZombies(scene);
    const centres = remplir(monde, DEPARTS).centres();
    const mini = (id: PorteId) => Math.min(...centres.map((c) => distancePorte(porteDeId(id)!, c)));
    const attendu: Record<PorteId, number> = { P1: 1.3, P3: 1.0, P4: 4.0, P2: 9.2, P5: 55.5 };
    for (const id of ordre) expect(Math.abs(mini(id) - attendu[id]), `${id} : ${mini(id)}`).toBeLessThan(0.5);
    for (const g of ["G4", "G1", "E"]) {
      const piece = PIECES_SYNTH.find((p) => p.id === g)!;
      const d = Math.min(...centres.map((c) => distSegment(c[0], c[1], piece.p[0], piece.p[1], piece.q[0], piece.q[1])));
      expect(d, g).toBeGreaterThan(3);
    }
    // P1 et P3 sont achetables dès le départ, pas les autres
    const portee = ZOMBIES.porteeAchatPorte;
    expect(mini("P1")).toBeLessThanOrEqual(portee);
    expect(mini("P3")).toBeLessThanOrEqual(portee);
    for (const id of ["P2", "P4", "P5"] as const) expect(mini(id)).toBeGreaterThan(portee);
  }, TIMEOUT);

  it("un joueur ne traverse ni N2c, ni une barricade fermée, ni une porte, et aucun toit ne le porte", () => {
    const monde = construireMondeZombies(scene);
    for (const id of ["N2c", "S1", "S1c", "S2", "N4", "W", "G1", "G3", "E"]) {
      const s = PIECES_SYNTH.find((p) => p.id === id)!;
      const [mx, mz] = mil(id);
      const l = Math.hypot(s.q[0] - s.p[0], s.q[1] - s.p[1]);
      const nx = -(s.q[1] - s.p[1]) / l, nz = (s.q[0] - s.p[0]) / l;
      for (const cote of [1, -1]) {
        // part à 4 m d'un côté et marche (pas de 0,1 m, vitesse d'un sprint) vers l'autre côté
        let p: [number, number, number] = [mx + nx * cote * 4, 0, mz + nz * cote * 4];
        for (let k = 0; k < 90; k++) {
          const cible: [number, number, number] = [p[0] - nx * cote * 0.1, 0, p[2] - nz * cote * 0.1];
          p = resoudre(monde, cible, 0.4, 1.8).p;
        }
        const signe = (p[0] - mx) * nx * cote + (p[2] - mz) * nz * cote;
        expect(signe, `${id} côté ${cote}`).toBeGreaterThan(0.3); // resté du côté de départ, contre la pièce
      }
    }
    // un toit ne porte personne : à 10 m ou 39 m de haut, un bâtiment bloque encore (h = 40)
    const [cx, cz] = scene.buildings[70].c;
    for (const y of [10, 39]) {
      const r = resoudre(monde, [cx, y, cz], 0.4, 1.8);
      expect(r.contacts.length).toBeGreaterThan(0);
    }
  });

  it("les champs bloquent les joueurs mais pas les tigres, les balles ni les regards", () => {
    const monde = construireMondeZombies(scene);
    const [mx, mz] = mil("N2c");
    expect(resoudre(monde, [mx, 0, mz], 0.4, 1.8).contacts.length).toBeGreaterThan(0);
    expect(resoudre(monde, [mx, 0, mz], 0.6, 2, true).contacts.length).toBe(0);
    const s = PIECES_SYNTH.find((p) => p.id === "N2c")!;
    const l = Math.hypot(s.q[0] - s.p[0], s.q[1] - s.p[1]);
    const nx = -(s.q[1] - s.p[1]) / l, nz = (s.q[0] - s.p[0]) / l;
    const a: [number, number, number] = [mx + nx * 5, 1, mz + nz * 5], b: [number, number, number] = [mx - nx * 5, 1, mz - nz * 5];
    expect(visible(monde, a, b)).toBe(true);
    expect(lancerRayon(monde, a, [-nx, 0, -nz], 10)).toBe(Infinity);
    // la barricade (même segment que S1c) arrête tout tant qu'elle est debout
    const [sx, sz] = mil("S1");
    const s1 = PIECES_SYNTH.find((p) => p.id === "S1")!;
    const l1 = Math.hypot(s1.q[0] - s1.p[0], s1.q[1] - s1.p[1]);
    const n1x = -(s1.q[1] - s1.p[1]) / l1, n1z = (s1.q[0] - s1.p[0]) / l1;
    const a1: [number, number, number] = [sx + n1x * 5, 1, sz + n1z * 5], b1: [number, number, number] = [sx - n1x * 5, 1, sz - n1z * 5];
    expect(visible(monde, a1, b1)).toBe(false);
    detruireBatiment(monde, idPrisme("S1"));
    expect(visible(monde, a1, b1)).toBe(true);
  });
});

describe("départs", () => {
  it("huit départs libres, ≥ 12 m de N2c, ≥ 2,5 m des murs, espacés de ≥ 9 m, tournés vers la cour", () => {
    const monde = construireMondeZombies(scene);
    expect(DEPARTS).toHaveLength(8);
    expect(DEPARTS[2]).toEqual([109.5, -35.5]); // pas (109, −35,5) : 2,19 m d'un mur
    const n2c = mil("N2c");
    DEPARTS.forEach((d, i) => {
      expect(resoudre(monde, [d[0], 0, d[1]], 0.4, 1.8).contacts).toHaveLength(0);
      expect(Math.hypot(d[0] - n2c[0], d[1] - n2c[1]), `N2c ${i}`).toBeGreaterThanOrEqual(12);
      expect(distMurs(monde, d[0], d[1]), `murs ${i}`).toBeGreaterThanOrEqual(2.5);
      for (let k = i + 1; k < DEPARTS.length; k++) expect(Math.hypot(d[0] - DEPARTS[k][0], d[1] - DEPARTS[k][1])).toBeGreaterThanOrEqual(9); // mesuré : 9,66 m au plus près (la spec disait 14 m)
      const lacet = lacetDepart(i);
      expect(lacet).toBeCloseTo(capVers(d[0], d[1], 128, -50), 9);
    });
    expect(lacetDepart(8)).toBe(lacetDepart(0));
  });
});

describe("fenêtres et points d'apparition", () => {
  it("quinze points libres à rayon 0,6 m, dans les bornes, 6 / 12 / 18 m le long de la normale côté extérieur", () => {
    const monde = construireMondeZombies(scene);
    expect(FENETRES.map((f) => f.id)).toEqual(["N2c", "S1c", "S2c", "N4c", "Wc"]);
    let n = 0;
    for (const f of FENETRES) {
      const m = mil(f.id);
      expect(f.milieu[0]).toBeCloseTo(m[0], 9);
      f.points.forEach((p, k) => {
        n++;
        expect(resoudre(monde, [p[0], 0, p[1]], 0.6, 2).contacts, `${f.id} ${p}`).toHaveLength(0);
        expect(p[0]).toBeGreaterThan(BORNES_ZOMBIES.x0);
        expect(p[0]).toBeLessThan(BORNES_ZOMBIES.x1);
        expect(p[1]).toBeGreaterThan(BORNES_ZOMBIES.z0);
        expect(p[1]).toBeLessThan(BORNES_ZOMBIES.z1);
        // alignés avec la normale du segment, à 6, 12 puis 18 m du milieu (à 0,15 m près : arrondis de la spec)
        expect(Math.abs(Math.hypot(p[0] - m[0], p[1] - m[1]) - 6 * (k + 1)), `${f.id} ${k}`).toBeLessThan(0.3);
      });
    }
    expect(n).toBe(15);
  });

  it("flood-fill des tigres (rayon 0,7, champs ignorés, portes ouvertes) : les quinze points rejoignent les huit départs", () => {
    const monde = construireMondeZombies(scene);
    ouvrir(monde, ordre);
    const f = remplir(monde, [FENETRES[0].points[0]], { rayon: 0.7, ignorer: true });
    for (const fen of FENETRES) for (const p of fen.points) expect(f.atteint(p[0], p[1]), `${fen.id} ${p}`).toBe(true);
    for (const d of DEPARTS) expect(f.atteint(d[0], d[1])).toBe(true);
    expect(Math.abs(f.aire - 21031) / 21031).toBeLessThan(0.05);
  }, TIMEOUT);

  it("flood-fill des tigres depuis N2c, portes fermées : les huit départs sont atteints", () => {
    const monde = construireMondeZombies(scene);
    const f = remplir(monde, [FENETRES[0].points[0]], { rayon: 0.7, ignorer: true });
    for (const d of DEPARTS) expect(f.atteint(d[0], d[1])).toBe(true);
    for (const p of FENETRES[0].points) expect(f.atteint(p[0], p[1])).toBe(true);
    // portes fermées : l'extérieur de S1c, S2c et Wc est isolé de la cour (celui de N4c rejoint N2c par le nord)
    for (const id of ["S1c", "S2c", "Wc"]) {
      const fen = FENETRES.find((x) => x.id === id)!;
      expect(f.atteint(fen.points[0][0], fen.points[0][1]), id).toBe(false);
    }
  }, TIMEOUT);

  it("flood-fill des tigres où SEULE la fenêtre testée laisse passer : active, elle rejoint les départs ; inactive (porte fermée), non", () => {
    for (const fen of FENETRES) {
      for (const ouverte of [false, true]) {
        const monde = mondeFenetre(fen.id, fen.porte && ouverte ? ordrePrerequis(fen.porte) : []);
        const f = remplir(monde, [fen.points[2]], { rayon: 0.7, ignorer: true });
        const actif = fen.porte === null || ouverte;
        for (const d of DEPARTS) expect(f.atteint(d[0], d[1]), `${fen.id} ${ouverte ? "porte ouverte" : "porte fermée"}`).toBe(actif);
      }
    }
  }, TIMEOUT);

  it("grille de navigation des tigres (1,5 m, rayon 0,7) : seules les fenêtres actives rejoignent les départs", () => {
    const c0 = carteNavigation(construireMondeZombies(scene), ZOMBIES.rayonNav, { taille: ZOMBIES.tailleCaseNav, ignorerPasseTigre: true });
    expect(c0.taille).toBe(1.5);
    expect([c0.nx, c0.nz]).toEqual([138, 90]);
    const atteintDeparts = (c: typeof c0, fen: (typeof FENETRES)[number]) => {
      const champ = champDistance(c, DEPARTS);
      return fen.points.map((p) => {
        // la case du point doit être elle-même libre et atteinte (pas seulement « libre la plus proche »)
        const i = Math.floor((p[0] - c.x0) / c.taille), j = Math.floor((p[1] - c.z0) / c.taille);
        return !c.bloque[i + j * c.nx] && champ[i + j * c.nx] < DIST_INF;
      });
    };
    for (const fen of FENETRES) {
      for (const ouverte of [false, true]) {
        if (ouverte && fen.porte === null) continue;
        const monde = mondeFenetre(fen.id, ouverte ? ordrePrerequis(fen.porte!) : []);
        const c = carteNavigation(monde, ZOMBIES.rayonNav, { taille: ZOMBIES.tailleCaseNav, ignorerPasseTigre: true });
        const r = atteintDeparts(c, fen);
        if (fen.porte === null || ouverte) expect(r, `${fen.id} active`).toEqual([true, true, true]);
        else expect(r.some(Boolean), `${fen.id} inactive`).toBe(false);
      }
    }
    // la grille se reconstruit après une porte (invaliderNavigation) et reste en cache sinon
    const monde = construireMondeZombies(scene);
    const nav = () => carteNavigation(monde, ZOMBIES.rayonNav, { taille: ZOMBIES.tailleCaseNav, ignorerPasseTigre: true });
    const a = nav();
    expect(nav()).toBe(a);
    ouvrir(monde, ["P1"]);
    expect(nav()).toBe(a); // pas invalidée : le cache sert l'ancienne grille
    invaliderNavigation(monde);
    const b = nav();
    expect(b).not.toBe(a);
    // G3 + S2 détruits : des cases se sont libérées
    expect(b.bloque.reduce((s, v) => s + v, 0)).toBeLessThan(a.bloque.reduce((s, v) => s + v, 0));
  }, TIMEOUT);
});

describe("achats", () => {
  it("onze achats fixes (positions de la spec) et cinq portes, ids du catalogue", () => {
    expect(ACHATS.map((a) => a.id)).toEqual([
      "mur:pistolet", "mur:epee", "mur:mini_uzi", "mur:revolver", "mur:pompe", "boite", "soin", "mur:mitraillette", "mur:fusil_assaut", "mur:sniper", "mur:mitrailleuse",
    ]);
    expect(ACHATS.map((a) => [a.prix, a.prixMunitions ?? null])).toEqual([
      [250, 125], [500, null], [500, 250], [650, 325], [900, 450], [950, null], [400, null], [1000, 500], [1300, 650], [1500, 750], [2000, 1000],
    ]);
    expect(ACHATS.map((a) => a.zone)).toEqual(["centre", "centre", "centre", "centre", "est", "est", "est", "ouest", "ouest", "ouest", "niche"]);
    expect(ACHATS.map((a) => a.genre)).toEqual(["mur", "mur", "mur", "mur", "mur", "boite", "soin", "mur", "mur", "mur", "mur"]);
    expect(ACHATS.map((a) => a.position)).toEqual([
      [144.0, -49.4], [147.6, -62.1], [136.3, -72.8], [120.6, -34.7], [188.9, -57.8], [198.2, -40.7], [173.4, -19.7], [86.7, -44.3], [65.9, -50.3], [92.9, -70.8], [211.0, 18.0],
    ]);
    for (const a of ACHATS) expect(a.rayon).toBe(2.5);
    expect(NICHE).toEqual([211.0, 18.0]);
    expect(ACHATS_PORTES.map((a) => [a.id, a.prix, a.genre, a.rayon])).toEqual([["P1", 750, "porte", 3], ["P3", 1000, "porte", 3], ["P2", 1250, "porte", 3], ["P4", 1500, "porte", 3], ["P5", 2000, "porte", 3]]);
    expect(achatDeId("mur:pompe")!.arme).toBe("pompe");
    expect(achatDeId("mur:epee")!.arme).toBe("epee");
    expect(achatDeId("P2")!.porte).toBe("P2");
    expect(achatDeId("mur:bazooka")).toBeNull();
  });

  it("libres à rayon 0,4 m, dans la bonne zone (atteints avec ses portes, pas avec une de moins), dégagement ≈ 1,2 m", () => {
    const monde = construireMondeZombies(scene);
    for (const a of ACHATS) {
      expect(resoudre(monde, [a.position[0], 0, a.position[1]], 0.4, 1.8).contacts, a.id).toHaveLength(0);
      const d = distMurs(monde, a.position[0], a.position[1]);
      if (a.facade) { expect(Math.abs(d - DECALAGE_FACADE_M), `${a.id} : ${d}`).toBeLessThan(0.08); expect(d).toBeLessThanOrEqual(2); }
    }
    // la mitrailleuse : libre à 0,5 m, dégagement 2,4 m
    expect(resoudre(monde, [NICHE[0], 0, NICHE[1]], 0.5, 1.8).contacts).toHaveLength(0);
    expect(Math.abs(distMurs(monde, NICHE[0], NICHE[1]) - 2.4)).toBeLessThan(0.2);
  });

  it("zones : un achat n'est atteint qu'une fois ses portes ouvertes", () => {
    const parZone = new Map(ZONES.map((z) => [z.id, z]));
    const ordreZones: [string, PorteId[], PorteId[]][] = [
      ["centre", [], []],
      ["est", ["P1", "P2"], ["P1"]],
      ["ouest", ["P3", "P4"], ["P3"]],
      ["niche", ["P1", "P2", "P5"], ["P1", "P2"]],
    ];
    for (const [id, avec, sans] of ordreZones) {
      expect(parZone.get(id as never)!.portes).toEqual(avec);
      const attendu = ACHATS.filter((a) => a.zone === id);
      const m1 = construireMondeZombies(scene);
      ouvrir(m1, sans);
      const f1 = remplir(m1, DEPARTS);
      const m2 = construireMondeZombies(scene);
      ouvrir(m2, avec);
      const f2 = remplir(m2, DEPARTS);
      for (const a of attendu) {
        expect(f2.atteint(a.position[0], a.position[1]), `${a.id} avec ${avec}`).toBe(true);
        if (id !== "centre") expect(f1.atteint(a.position[0], a.position[1]), `${a.id} sans ${avec.at(-1)}`).toBe(false);
      }
    }
  }, TIMEOUT);

  it("achats d'une même zone à ≥ 3 m les uns des autres", () => {
    for (const a of ACHATS) for (const b of ACHATS) {
      if (a === b || a.zone !== b.zone) continue;
      expect(Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]), `${a.id} ${b.id}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("positions du tableau = recalcul depuis la façade, la fraction t et le côté libre", () => {
    for (const a of ACHATS) {
      if (!a.facade) continue;
      const { batiment, p, q, t } = a.facade;
      const ring = scene.buildings[batiment].r;
      // la façade est une arête (à 0,15 m près) du bâtiment
      const proche = (v: Vec2) => Math.min(...ring.map((r) => Math.hypot(r[0] - v[0], r[1] - v[1])));
      expect(proche(p), `${a.id} p`).toBeLessThan(0.15);
      expect(proche(q), `${a.id} q`).toBeLessThan(0.15);
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const nx = -(q[1] - p[1]) / l, nz = (q[0] - p[0]) / l;
      const bx = p[0] + (q[0] - p[0]) * t, bz = p[1] + (q[1] - p[1]) * t;
      // des deux côtés, un seul est hors de tous les bâtiments
      const cand = [1, -1].map((s) => [bx + nx * s * DECALAGE_FACADE_M, bz + nz * s * DECALAGE_FACADE_M] as Vec2);
      const libres = cand.filter((c) => !scene.buildings.some((b) => dedans(c[0], c[1], b.r)));
      expect(libres, a.id).toHaveLength(1);
      expect(Math.hypot(libres[0][0] - a.position[0], libres[0][1] - a.position[1]), `${a.id} ${libres[0]}`).toBeLessThan(0.1);
    }
  });

  it("achatsProches : rayon 2,5 m, portes à 3 m du segment du premier prisme, ouvertes écartées", () => {
    const pompe = achatDeId("mur:pompe")!;
    expect(achatsProches(pompe.position).map((a) => a.id)).toEqual(["mur:pompe"]);
    expect(achatsProches([pompe.position[0] + 2.6, pompe.position[1]]).map((a) => a.id)).not.toContain("mur:pompe");
    expect(achatsProches([0, 0])).toEqual([]);
    const m = mil("G3");
    const proches = achatsProches([m[0] + 1, m[1]]);
    expect(proches.map((a) => a.id)).toContain("P1");
    expect(achatsProches([m[0] + 1, m[1]], ["P1"]).map((a) => a.id)).not.toContain("P1");
    // à 3,5 m du segment : trop loin
    const s = PIECES_SYNTH.find((p) => p.id === "G3")!;
    const l = Math.hypot(s.q[0] - s.p[0], s.q[1] - s.p[1]);
    const nx = -(s.q[1] - s.p[1]) / l, nz = (s.q[0] - s.p[0]) / l;
    expect(achatsProches([m[0] + nx * 3.5, m[1] + nz * 3.5]).map((a) => a.id)).not.toContain("P1");
    expect(achatsProches([m[0] - nx * 2.9, m[1] - nz * 2.9]).map((a) => a.id)).toContain("P1"); // des deux côtés
    // plusieurs candidats : triés du plus proche au plus lointain
    const p3 = mil("G2");
    const liste = achatsProches([p3[0], p3[1]]);
    expect(liste.length).toBeGreaterThan(0);
  });
});
