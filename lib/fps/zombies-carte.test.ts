import { describe, expect, it } from "vitest";
import scene from "../../public/agroparc/scene.json";
import type { SceneData } from "../agroparc3d/types";
import { detruireBatiment, resoudre } from "./collision";
import { carteNavigation, champDistance, DIST_INF } from "./navigation";
import {
  ACHATS, ATOUTS, BATIMENTS_CREUX, BORNES_ZOMBIES, CREUSAGES, DEPARTS, FENETRES, INDEX_PREMIERE_PIECE, NOTES, ORIGINES, PIECES_SYNTH, PORTES_PAYANTES,
  QUAIS, TRUCK, ZONES, achatsProches, construireMondeZombies, donneesZombies, etiqueterZones, fenetreDeId, idPrisme, local, piecesSynth, rayonTruck,
  sortiesDuSol, voisines, zoneEn, zonesActives, zonesOuvertes, type ZoneId,
} from "./zombies-carte";
import { ZOMBIES } from "./zombies-vagues";

const sc = scene as unknown as SceneData;
const libre = (monde: ReturnType<typeof construireMondeZombies>, x: number, z: number, r: number, ignorer = false) =>
  resoudre(monde, [x, 0, z], r, 1.8, ignorer).contacts.length === 0;

describe("repères et bâtiments creusés", () => {
  it("l'origine de chaque bâtiment creusé est son premier sommet dans scene.json", () => {
    for (const b of BATIMENTS_CREUX) {
      const r0 = sc.buildings[b].r[0];
      expect(Math.hypot(r0[0] - ORIGINES[b][0], r0[1] - ORIGINES[b][1])).toBeLessThan(0.05);
    }
  });

  it("les anneaux locaux suivent les vrais murs à 0,25 m près (chaque sommet local est un sommet de scene.json)", () => {
    for (const c of CREUSAGES) {
      const vrais = sc.buildings[c.b].r;
      for (const m of c.murs) {
        const p = local(c.b, m.de[0], m.de[1]);
        const d = Math.min(...vrais.map((v) => Math.hypot(v[0] - p[0], v[1] - p[1])));
        expect(d, `${c.b} (${m.de})`).toBeLessThan(0.25);
      }
    }
  });

  it("donneesZombies ne modifie pas la scène, marque les quatre creusés, ajoute les pièces dans l'ordre, retire le Truck", () => {
    const avant = JSON.stringify(sc.buildings.slice(60, 80));
    const d = donneesZombies(sc);
    expect(JSON.stringify(sc.buildings.slice(60, 80))).toBe(avant);
    expect(d.data.buildings).toHaveLength(INDEX_PREMIERE_PIECE + PIECES_SYNTH.length);
    for (const b of BATIMENTS_CREUX) expect(d.data.buildings[b].type).toBe("creux");
    expect(d.data.pois.some((p) => p.type === "truck")).toBe(false);
    expect(new Set(PIECES_SYNTH.map((p) => p.id)).size).toBe(PIECES_SYNTH.length);
    expect(idPrisme("G1")).toBe(INDEX_PREMIERE_PIECE);
    // les hauteurs des pièces calculées sans la scène sont celles de la vraie scène
    expect(JSON.stringify(piecesSynth(sc))).toBe(JSON.stringify(PIECES_SYNTH));
  });

  it("monde : creusés sans hauteur, meubles à leur hauteur, le reste à 40 m, pas de parkour", () => {
    const d = donneesZombies(sc);
    const m = construireMondeZombies(sc);
    expect(m.sansParkour).toBe(true);
    expect(m.bornes).toEqual(BORNES_ZOMBIES);
    m.prismes.forEach((p, i) => {
      const t = d.data.buildings[i]?.type;
      if (t === "creux") expect(p.h).toBe(0);
      else if (t === "meuble") expect(p.h).toBeLessThan(2.5);
      else expect(p.h).toBe(40);
    });
  });
});

describe("zones", () => {
  const monde = construireMondeZombies(sc);
  const cz = etiqueterZones(monde);
  const aire = (id: ZoneId) => { const r = ZONES.findIndex((z) => z.id === id); let n = 0; for (const v of cz.zone) if (v === r) n++; return n; };

  it("chaque zone a une aire plausible, portes et fenêtres fermées (mesurée au flood-fill de 1 m)", () => {
    const attendu: Record<ZoneId, [number, number]> = {
      open: [150, 280], pause: [170, 300], cour: [1500, 2000], i2: [100, 250], cuisine: [200, 380], est: [1400, 2000],
      local: [230, 400], i1: [60, 200], ouest: [1100, 1600], labo: [350, 600],
    };
    for (const z of ZONES) {
      const a = aire(z.id);
      expect(a, z.id).toBeGreaterThanOrEqual(attendu[z.id][0]);
      expect(a, z.id).toBeLessThanOrEqual(attendu[z.id][1]);
    }
  });

  it("toutes portes ouvertes, l'open space communique avec toutes les zones (les fenêtres restent fermées)", () => {
    const m = construireMondeZombies(sc);
    for (const p of PORTES_PAYANTES) for (const id of p.prismes) detruireBatiment(m, idPrisme(id));
    const c = etiqueterZones(m);
    for (const z of ZONES) expect(zoneEn(c, z.graine[0], z.graine[1]), z.id).toBe("open");
  });

  it("chaque porte relie bien ses deux zones (un point de part et d'autre de la pièce)", () => {
    for (const p of PORTES_PAYANTES) {
      const piece = PIECES_SYNTH.find((x) => x.id === p.prismes[0])!;
      const l = Math.hypot(piece.q[0] - piece.p[0], piece.q[1] - piece.p[1]);
      const nx = -(piece.q[1] - piece.p[1]) / l, nz = (piece.q[0] - piece.p[0]) / l;
      const k = piece.demi + 1.2;
      const a = zoneEn(cz, p.point[0] + nx * k, p.point[1] + nz * k), b = zoneEn(cz, p.point[0] - nx * k, p.point[1] - nz * k);
      expect([a, b].sort(), p.id).toEqual([...p.zones].sort());
    }
  });

  it("les huit départs sont libres, dans l'open space, à 2,5 m au moins les uns des autres", () => {
    expect(DEPARTS).toHaveLength(8);
    for (const d of DEPARTS) {
      expect(zoneEn(cz, d[0], d[1])).toBe("open");
      expect(libre(monde, d[0], d[1], 0.4)).toBe(true);
    }
    for (let i = 0; i < DEPARTS.length; i++) for (let j = i + 1; j < DEPARTS.length; j++) {
      expect(Math.hypot(DEPARTS[i][0] - DEPARTS[j][0], DEPARTS[i][1] - DEPARTS[j][1])).toBeGreaterThanOrEqual(2.5);
    }
  });

  it("chaque achat est libre, dans sa zone, et pas trop près d'un autre achat de la même zone", () => {
    for (const a of ACHATS) {
      expect(libre(monde, a.position[0], a.position[1], 0.4), a.id).toBe(true);
      expect(zoneEn(cz, a.position[0], a.position[1]), a.id).toBe(a.zone);
    }
    for (const a of ACHATS) for (const b of ACHATS) {
      if (a === b || a.zone !== b.zone) continue;
      expect(Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]), `${a.id} / ${b.id}`).toBeGreaterThan(1.5);
    }
  });

  it("notes : huit, une par zone principale, posées dans leur zone", () => {
    expect(NOTES).toHaveLength(8);
    expect(new Set(NOTES.map((n) => n.zone)).size).toBe(8);
    for (const n of NOTES) expect(zoneEn(cz, n.position[0], n.position[1]) ?? "meuble", `note ${n.id}`).toMatch(new RegExp(`${n.zone}|meuble`));
  });

  it("sorties du sol : seulement dans les cours, plusieurs par cour", () => {
    const s = sortiesDuSol(cz);
    for (const z of ["cour", "est", "ouest"] as const) expect(s.filter((x) => x.zone === z).length, z).toBeGreaterThan(20);
    expect(s.every((x) => !ZONES.find((z) => z.id === x.zone)!.interieur)).toBe(true);
    for (const x of s) expect(libre(monde, x.p[0], x.p[1], 0.7, true)).toBe(true);
  });
});

describe("fenêtres", () => {
  const monde = construireMondeZombies(sc);
  const cz = etiqueterZones(monde);

  it("treize fenêtres ; dedans dans leur zone, dehors hors de toute zone, points d'apparition libres pour un tigre", () => {
    expect(FENETRES).toHaveLength(13);
    for (const f of FENETRES) {
      expect(zoneEn(cz, f.dedans[0], f.dedans[1]), f.id).toBe(f.zone);
      expect(libre(monde, f.dehors[0], f.dehors[1], ZOMBIES.rayonTigre), `${f.id} dehors`).toBe(true);
      for (const p of f.points) {
        expect(libre(monde, p[0], p[1], ZOMBIES.rayonTigre), `${f.id} ${p}`).toBe(true);
        expect(p[0] > BORNES_ZOMBIES.x0 && p[0] < BORNES_ZOMBIES.x1 && p[1] > BORNES_ZOMBIES.z0 && p[1] < BORNES_ZOMBIES.z1).toBe(true);
      }
    }
  });

  it("un tigre en chasse ne traverse pas une fenêtre (grille de chasse), un petit si (grille libre)", () => {
    const chasse = carteNavigation(monde, ZOMBIES.rayonNav, { taille: ZOMBIES.tailleCaseNav, ignorerPasseTigre: false });
    const libreNav = carteNavigation(monde, ZOMBIES.rayonNav, { taille: ZOMBIES.tailleCaseNav, ignorerPasseTigre: true });
    const f = fenetreDeId("F2")!;
    const idx = (c: typeof chasse, x: number, z: number) => Math.floor((x - c.x0) / c.taille) + Math.floor((z - c.z0) / c.taille) * c.nx;
    const depart = DEPARTS[2];
    const champC = champDistance(chasse, [[depart[0], depart[1]]]);
    const champL = champDistance(libreNav, [[depart[0], depart[1]]]);
    expect(champC[idx(chasse, f.points[0][0], f.points[0][1])]).toBe(DIST_INF);
    expect(champL[idx(libreNav, f.points[0][0], f.points[0][1])]).toBeLessThan(DIST_INF);
  });

  it("dans l'open space, la grille de chasse relie le côté intérieur de chaque fenêtre aux départs", () => {
    const chasse = carteNavigation(monde, ZOMBIES.rayonNav, { taille: ZOMBIES.tailleCaseNav, ignorerPasseTigre: false });
    const champ = champDistance(chasse, DEPARTS.map((d) => [d[0], d[1]] as [number, number]));
    const idx = (x: number, z: number) => Math.floor((x - chasse.x0) / chasse.taille) + Math.floor((z - chasse.z0) / chasse.taille) * chasse.nx;
    for (const id of ["F1", "F2"]) {
      const f = fenetreDeId(id)!;
      expect(champ[idx(f.dedans[0], f.dedans[1])], id).toBeLessThan(DIST_INF);
    }
  });
});

describe("toutes portes ouvertes", () => {
  it("le côté intérieur de chaque fenêtre et chaque sortie du sol rejoignent les départs (grille de chasse)", () => {
    const m = construireMondeZombies(sc);
    const cz = etiqueterZones(m);
    for (const p of PORTES_PAYANTES) for (const id of p.prismes) detruireBatiment(m, idPrisme(id));
    const chasse = carteNavigation(m, ZOMBIES.rayonNav, { taille: ZOMBIES.tailleCaseNav, ignorerPasseTigre: false });
    const champ = champDistance(chasse, DEPARTS.map((d) => [d[0], d[1]] as [number, number]));
    const idx = (x: number, z: number) => Math.floor((x - chasse.x0) / chasse.taille) + Math.floor((z - chasse.z0) / chasse.taille) * chasse.nx;
    // la descente part de la case du tigre ou d'une voisine
    const proche = (x: number, z: number) => Math.min(...[-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => champ[idx(x + dx, z + dz)])));
    for (const f of FENETRES) expect(proche(f.dedans[0], f.dedans[1]), f.id).toBeLessThan(DIST_INF);
    const sols = sortiesDuSol(cz);
    const perdus = sols.filter((x) => champ[idx(x.p[0], x.p[1])] >= DIST_INF);
    expect(perdus.length).toBeLessThan(sols.length * 0.05);
  });
});

describe("portes, zones actives, achats proches", () => {
  it("onze portes, ≈ 13 000 $ au total ; les zones ouvertes suivent les portes", () => {
    expect(PORTES_PAYANTES).toHaveLength(11);
    const total = PORTES_PAYANTES.reduce((s, p) => s + p.prix, 0);
    expect(total).toBeGreaterThan(12_000);
    expect(total).toBeLessThan(14_000);
    expect([...zonesOuvertes([])]).toEqual(["open"]);
    expect(zonesOuvertes(["D2", "G2"])).toEqual(new Set(["open", "cour", "i1"]));
    // une porte isolée (Labo sans la cour Ouest) n'ouvre rien
    expect(zonesOuvertes(["D9"])).toEqual(new Set(["open"]));
  });

  it("zones actives (BO1) : la zone occupée et ses voisines par une porte ouverte", () => {
    const o = new Set(["D1", "D2"]);
    expect(voisines("open", o).sort()).toEqual(["cour", "pause"]);
    expect(zonesActives(["pause"], o)).toEqual(new Set(["pause", "open"]));
    expect(zonesActives([null], o)).toEqual(new Set(["open"]));
  });

  it("achatsProches : la boîte à l'emplacement courant seulement, la truffe au courant, les ingrédients pris écartés", () => {
    const b1 = ACHATS.find((a) => a.id === "boite:B1")!;
    expect(achatsProches(b1.position, { boite: 0 }).some((a) => a.id === "boite:B1")).toBe(true);
    expect(achatsProches(b1.position, { boite: 2 }).some((a) => a.id === "boite:B1")).toBe(false);
    const truffe = ACHATS.find((a) => a.id === "ingredient:truffe")!;
    expect(achatsProches(truffe.position, { courant: false }).some((a) => a.id === truffe.id)).toBe(false);
    expect(achatsProches(truffe.position, { courant: true }).some((a) => a.id === truffe.id)).toBe(true);
    expect(achatsProches(truffe.position, { courant: true, ingredientsPris: ["truffe"] }).some((a) => a.id === truffe.id)).toBe(false);
  });

  it("prix de BO1 : atouts 2 500 / 3 000 / 2 000 / 1 500 (500 seul)", () => {
    expect([ATOUTS.gratin.prix, ATOUTS.expresso.prix, ATOUTS.ristretto.prix, ATOUTS.pausecafe.prix, ATOUTS.pausecafe.prixSolo]).toEqual([2500, 3000, 2000, 1500, 500]);
    expect(ACHATS.find((a) => a.id === "pap")!.prix).toBe(5000);
    expect(ACHATS.filter((a) => a.genre === "boite").every((a) => a.prix === 950)).toBe(true);
  });
});

describe("Truck Muche", () => {
  const monde = construireMondeZombies(sc);
  const cz = etiqueterZones(monde);

  it("les quais sont hors des zones jouables, libres pour la caisse, l'arrière tourné vers leur fenêtre", () => {
    for (const q of QUAIS) {
      expect(zoneEn(cz, q.p[0], q.p[1]), `quai ${q.id}`).toBeNull();
      expect(libre(monde, q.p[0], q.p[1], TRUCK.demiLargeur, true), `quai ${q.id}`).toBe(true);
      const f = fenetreDeId(q.fenetre)!;
      // l'avant (−sin, −cos) s'éloigne de la fenêtre
      const av = [-Math.sin(q.cap), -Math.cos(q.cap)];
      expect(av[0] * (q.p[0] - f.milieu[0]) + av[1] * (q.p[1] - f.milieu[1])).toBeGreaterThan(0);
    }
  });

  it("rayonTruck : touche la caisse de face, la manque au-dessus et derrière la portée", () => {
    const p: [number, number] = [0, 0];
    expect(rayonTruck([0, 1.5, 10], [0, 0, -1], p, 0, 50)).toBeCloseTo(10 - TRUCK.demiLongueur, 6);
    expect(rayonTruck([0, 5, 10], [0, 0, -1], p, 0, 50)).toBeNull();
    expect(rayonTruck([0, 1.5, 10], [0, 0, -1], p, 0, 3)).toBeNull();
    expect(rayonTruck([10, 1.5, 0], [-1, 0, 0], p, 0, 50)).toBeCloseTo(10 - TRUCK.demiLargeur, 6);
  });
});
