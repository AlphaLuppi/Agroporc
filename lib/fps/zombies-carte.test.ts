import { describe, expect, it } from "vitest";
import scene from "../../public/agroparc/scene.json";
import type { SceneData } from "../agroparc3d/types";
import { detruireBatiment, lancerRayon, resoudre, visible } from "./collision";
import { carteNavigation, champDistance, DIST_INF } from "./navigation";
import {
  ACHATS, ANGLE_BATIMENTS, ATOUTS, BATIMENTS_CREUX, BOITE, BORNES_ZOMBIES, CREUSAGES, DEPARTS, FENETRES, INDEX_PREMIERE_PIECE, NOTES, OLIVIER, OLIVIERS,
  ORIGINES, PIECES_AMENAGEMENT, PIECES_SYNTH, PORTES_PAYANTES, QUAIS, TRUCK, ZONES, achatsProches, construireMondeZombies, donneesZombies, etiqueterZones,
  fenetreDeId, idPrisme, local, piecesSynth, rayonTruck, sortiesDuSol, voisines, zoneEn, zonesActives, zonesOuvertes, type CarteZones, type ZoneId,
} from "./zombies-carte";
import { porteePatte } from "./zombies";
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

  it("monde : creusés sans hauteur, meubles à leur hauteur (≤ 2,6 m : conteneurs), le reste à 40 m, pas de parkour", () => {
    const d = donneesZombies(sc);
    const m = construireMondeZombies(sc);
    expect(m.sansParkour).toBe(true);
    expect(m.bornes).toEqual(BORNES_ZOMBIES);
    m.prismes.forEach((p, i) => {
      const t = d.data.buildings[i]?.type;
      if (t === "creux") expect(p.h).toBe(0);
      else if (t === "meuble") expect(p.h).toBeLessThanOrEqual(2.6);
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
      local: [230, 400], i1: [60, 200], ouest: [900, 1300], labo: [350, 600],
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

  it("sorties du sol : seulement dehors, plusieurs par cour (moins dans les allées du parking de la Cour Ouest)", () => {
    const s = sortiesDuSol(cz);
    for (const z of ["cour", "est"] as const) expect(s.filter((x) => x.zone === z).length, z).toBeGreaterThan(20);
    expect(s.filter((x) => x.zone === "ouest").length).toBeGreaterThanOrEqual(12);
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

  it("achatsProches : la boîte à l'emplacement courant seulement ; (v8) plus aucun achat pour le grand secret (ni ingrédient, ni four)", () => {
    const b1 = ACHATS.find((a) => a.id === "boite:B1")!;
    expect(achatsProches(b1.position, { boite: 0 }).some((a) => a.id === "boite:B1")).toBe(true);
    expect(achatsProches(b1.position, { boite: 2 }).some((a) => a.id === "boite:B1")).toBe(false);
    expect(ACHATS.filter((a) => /ingredient|four|secret/.test(a.id))).toEqual([]);
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

/** Rayon (m) du plus grand cercle inscrit de chaque zone : distance de chanfrein de chaque case à la première case hors de la zone. */
function rayonsInscrits(c: CarteZones): Map<ZoneId, number> {
  const n = c.nx * c.nz;
  const d = new Float32Array(n).fill(Infinity);
  const file: number[] = [];
  for (let k = 0; k < n; k++) if (c.zone[k] < 0) { d[k] = 0; file.push(k); }
  for (let h = 0; h < file.length; h++) {
    const k = file[h], i = k % c.nx, j = Math.floor(k / c.nx);
    for (const [di, dj, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= c.nx || b >= c.nz) continue;
      const kk = a + b * c.nx;
      if (d[kk] > d[k] + w * c.taille) { d[kk] = d[k] + w * c.taille; file.push(kk); }
    }
  }
  const res = new Map<ZoneId, number>();
  // centre de case → bord de la case bloquée (− 0,5 case), plus le rayon du joueur avec lequel la zone a été remplie (0,4 m)
  for (let k = 0; k < n; k++) {
    if (c.zone[k] < 0) continue;
    const z = ZONES[c.zone[k]].id;
    res.set(z, Math.max(res.get(z) ?? 0, d[k] - c.taille / 2 + 0.4));
  }
  return res;
}

type V2 = [number, number];
const distanceSegment2 = (p: V2, a: V2, b: V2) => {
  const ux = b[0] - a[0], uz = b[1] - a[1], l2 = ux * ux + uz * uz;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ux + (p[1] - a[1]) * uz) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - ux * t, p[1] - a[1] - uz * t);
};
/** Distance entre deux polygones (par leurs bords ; 0 s'ils se coupent). */
const distancePolygones = (A: readonly V2[], B: readonly V2[]) => {
  let d = Infinity;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
    d = Math.min(d, distanceSegment2(A[i], B[j], B[(j + 1) % B.length]), distanceSegment2(B[j], A[i], A[(i + 1) % A.length]));
  }
  return d;
};

describe("aménagements (v8) : deux grandes cours à olivier, le reste resserré", () => {
  const monde = construireMondeZombies(sc);
  const cz = etiqueterZones(monde);

  it("les aménagements sont ajoutés après toutes les pièces de la v7 (leurs index ne bougent pas)", () => {
    expect(JSON.stringify(PIECES_SYNTH.slice(-PIECES_AMENAGEMENT.length))).toBe(JSON.stringify(PIECES_AMENAGEMENT));
    expect(PIECES_AMENAGEMENT.every((p) => p.type === "meuble" && p.genre)).toBe(true);
  });

  it("seules la Cour Centre et la Cour Est ont un cercle inscrit de plus de 9 m ; ailleurs, au plus 6 m", () => {
    const r = rayonsInscrits(cz);
    const grandes = [...r].filter(([, v]) => v > 9).map(([z]) => z).sort();
    expect(grandes).toEqual(["cour", "est"]);
    for (const [z, v] of r) if (z !== "cour" && z !== "est") expect(v, z).toBeLessThanOrEqual(6);
  });

  it("olivier : dans sa cour, tronc bloquant (même debout sur le bac), bac octogonal plein, anneau de 8 m libre autour", () => {
    const a = OLIVIER.apothemeBac;
    for (const o of OLIVIERS) {
      expect(PIECES_SYNTH.find((p) => p.id === o.id)?.genre).toBe("olivier");
      expect(resoudre(monde, [o.c[0], OLIVIER.hauteurBac + 0.01, o.c[1]], 0.3, 1.8).contacts.length, o.id).toBeGreaterThan(0);
      for (let deg = 0; deg < 360; deg += 3) {
        const phi = (deg * Math.PI) / 180;
        // rayon de l'octogone dans la direction phi : faces tournées vers ANGLE_BATIMENTS + k × 45°
        let cmax = 0;
        for (let k = 0; k < 8; k++) cmax = Math.max(cmax, Math.cos(phi - ANGLE_BATIMENTS - (k * Math.PI) / 4));
        const rOct = a / cmax;
        const pt = (r: number): V2 => [o.c[0] + Math.cos(phi) * r, o.c[1] + Math.sin(phi) * r];
        const dedans = pt(rOct - 0.05), dehors = pt(rOct + 0.05);
        expect(resoudre(monde, [dedans[0], 0, dedans[1]], 0.01, 1.8).contacts.length, `${o.id} ${deg}° dedans`).toBeGreaterThan(0);
        expect(resoudre(monde, [dehors[0], 0, dehors[1]], 0.01, 1.8).contacts.length, `${o.id} ${deg}° dehors`).toBe(0);
        for (let r = rOct + 0.45; r <= 8; r += 0.5) {
          const p = pt(r);
          expect(libre(monde, p[0], p[1], 0.4), `${o.id} anneau ${deg}° ${r}`).toBe(true);
          expect(zoneEn(cz, p[0], p[1]), `${o.id} anneau ${deg}° ${r}`).toBe(o.zone);
        }
      }
    }
  });

  it("pas de refuge sur le bac : un tigre au pied du bac atteint de la patte un joueur posé n'importe où dessus", () => {
    const portee = porteePatte(ZOMBIES.echelle) - ZOMBIES.griffeMargeDepartM;
    for (const o of OLIVIERS) {
      for (let deg = 0; deg < 360; deg += 5) {
        const phi = (deg * Math.PI) / 180;
        const pt = (r: number): V2 => [o.c[0] + Math.cos(phi) * r, o.c[1] + Math.sin(phi) * r];
        // joueur : le plus près du tronc possible, debout sur le bac ; tigre : le plus près possible, au sol
        let rJ = 0, rT = 0;
        while (resoudre(monde, [pt(rJ)[0], OLIVIER.hauteurBac, pt(rJ)[1]], 0.4, 1.8).contacts.length) rJ += 0.02;
        while (resoudre(monde, [pt(rT)[0], 0, pt(rT)[1]], ZOMBIES.rayonTigre, 1.8).contacts.length) rT += 0.02;
        expect(rT - rJ, `${o.id} ${deg}°`).toBeLessThanOrEqual(portee);
      }
    }
  });

  it("aucun refuge : dans chaque zone, toute place du joueur (r 0,4) est à portée de patte et en vue d'une place du tigre (r 0,6)", () => {
    const T = 0.25, b = BORNES_ZOMBIES, portee = porteePatte(ZOMBIES.echelle) - ZOMBIES.griffeMargeDepartM;
    const nx = Math.ceil((b.x1 - b.x0) / T), nz = Math.ceil((b.z1 - b.z0) / T);
    const cx = (k: number) => b.x0 + ((k % nx) + 0.5) * T, cz2 = (k: number) => b.z0 + (Math.floor(k / nx) + 0.5) * T;
    const remplir = (r: number, g: readonly [number, number]) => {
      const vu = new Uint8Array(nx * nz), cache = new Int8Array(nx * nz).fill(-1);
      const ok = (k: number) => { if (cache[k] < 0) cache[k] = libre(monde, cx(k), cz2(k), r) ? 1 : 0; return cache[k] === 1; };
      const k0 = Math.floor((g[0] - b.x0) / T) + Math.floor((g[1] - b.z0) / T) * nx;
      if (!ok(k0)) return vu;
      const file = [k0];
      vu[k0] = 1;
      while (file.length) {
        const k = file.pop()!, i = k % nx, j = Math.floor(k / nx);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, c = j + dj;
          if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
          const kk = a + c * nx;
          if (vu[kk] || !ok(kk)) continue;
          vu[kk] = 1;
          file.push(kk);
        }
      }
      return vu;
    };
    const R = Math.ceil(portee / T);
    for (const z of ZONES) {
      const joueur = remplir(0.4, z.graine), tigre = remplir(ZOMBIES.rayonTigre, z.graine);
      expect(joueur.some((v) => v === 1), z.id).toBe(true);
      const refuges: string[] = [];
      for (let k = 0; k < nx * nz; k++) {
        if (!joueur[k] || tigre[k]) continue;
        const i = k % nx, j = Math.floor(k / nx);
        let atteint = false;
        for (let dj = -R; dj <= R && !atteint; dj++) for (let di = -R; di <= R && !atteint; di++) {
          const a = i + di, c = j + dj;
          if (a < 0 || c < 0 || a >= nx || c >= nz || Math.hypot(di, dj) * T > portee || !tigre[a + c * nx]) continue;
          atteint = visible(monde, [cx(a + c * nx), 1, cz2(a + c * nx)], [cx(k), 1, cz2(k)]);
        }
        if (!atteint) refuges.push(`(${cx(k).toFixed(1)}, ${cz2(k).toFixed(1)})`);
      }
      expect(refuges, z.id).toEqual([]);
    }
  });

  it("passages : entre un meuble qu'on ne saute pas (≥ 1,15 m) et un autre obstacle, l'écart est fermé (< 0,8 m) ou d'au moins 2,6 m", () => {
    // un tigre (corps de 0,6 m) dans un passage de 2,6 m laisse 1 m de chaque côté : on passe ; sous 0,8 m, le joueur ne passe pas du tout
    const d = donneesZombies(sc).data;
    const fautes: string[] = [];
    PIECES_SYNTH.forEach((p, rang) => {
      if (p.type !== "meuble" || p.h < 1.15) return;
      const i = INDEX_PREMIERE_PIECE + rang;
      d.buildings.forEach((b, j) => {
        if (j === i || !(monde.prismes[j].h > 0)) return;
        const e = distancePolygones(d.buildings[i].r as V2[], b.r as V2[]);
        if (e >= 0.8 && e < 2.6) fautes.push(`${p.id} ↔ ${j >= INDEX_PREMIERE_PIECE ? PIECES_SYNTH[j - INDEX_PREMIERE_PIECE].id : `bâtiment ${j}`} : ${e.toFixed(2)} m`);
      });
    });
    expect(fautes).toEqual([]);
  });

  it("boîte mystère : chaque caisse est dans un coin, dos au mur, son grand côté le long du mur, face ouverte vers la pièce", () => {
    const y = 0.3;
    const boites = ACHATS.filter((x) => x.genre === "boite");
    expect(boites).toHaveLength(5);
    for (const a of boites) {
      const f = a.facade!;
      const l = Math.hypot(f.q[0] - f.p[0], f.q[1] - f.p[1]);
      const u: V2 = [(f.q[0] - f.p[0]) / l, (f.q[1] - f.p[1]) / l];
      const n = f.normale;
      // la normale est unitaire et perpendiculaire au mur (aux arrondis au centimètre de la façade près)
      expect(Math.hypot(n[0], n[1])).toBeCloseTo(1, 6);
      expect(Math.abs(n[0] * u[0] + n[1] * u[1])).toBeLessThan(2e-3);
      const c: V2 = [f.p[0] + (f.q[0] - f.p[0]) * f.t + n[0] * BOITE.recul, f.p[1] + (f.q[1] - f.p[1]) * f.t + n[1] * BOITE.recul];
      const rayon = (o: V2, d: V2, max = 20) => lancerRayon(monde, [o[0], y, o[1]], [d[0], 0, d[1]], max);
      // dos au mur : le mur est à `recul` derrière le centre ET derrière les deux bouts (grand côté parallèle au mur, jamais de travers)
      for (const k of [-1, 0, 1]) {
        const o: V2 = [c[0] + u[0] * k * (BOITE.longueur / 2 - 0.1), c[1] + u[1] * k * (BOITE.longueur / 2 - 0.1)];
        expect(Math.abs(rayon(o, [-n[0], -n[1]]) - BOITE.recul), `${a.id} dos (${k})`).toBeLessThan(0.08);
      }
      // coin : un mur perpendiculaire à `jeuCoin` d'un des bouts, sur toute la profondeur de la caisse
      const cotes = ([1, -1] as const).map((s) => Math.max(...[-1, 1].map((k) => {
        const o: V2 = [c[0] + n[0] * k * (BOITE.profondeur / 2 - 0.05), c[1] + n[1] * k * (BOITE.profondeur / 2 - 0.05)];
        return rayon(o, [u[0] * s, u[1] * s]);
      })));
      expect(Math.min(...cotes) - BOITE.longueur / 2, `${a.id} coin`).toBeLessThan(BOITE.jeuCoin + 0.1);
      // emprise libre (la caisse ne mord ni un mur ni un meuble), face ouverte : rien devant sur 1,6 m
      for (const su of [-1, 1]) for (const sn of [-1, 1]) {
        const x = c[0] + u[0] * su * (BOITE.longueur / 2 - 0.03) + n[0] * sn * (BOITE.profondeur / 2 - 0.03);
        const z = c[1] + u[1] * su * (BOITE.longueur / 2 - 0.03) + n[1] * sn * (BOITE.profondeur / 2 - 0.03);
        expect(resoudre(monde, [x, 0, z], 0.01, 1).contacts.length, `${a.id} emprise`).toBe(0);
      }
      expect(rayon(c, n, 1.6), `${a.id} devant`).toBe(Infinity);
    }
  });
});
