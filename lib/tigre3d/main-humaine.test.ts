/**
 * Main humaine (réaction « serre-main ») : correspondance patte → main (pure), puis la cible de
 * déformation calculée sur le vrai maillage du GLB (décodé ici avec le décodeur meshopt de three),
 * subdivisé comme au chargement (lib/tigre3d/subdivision-patte.ts).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  construireMainHumaine, mainCanonique, versMain, inverseAffine, nuanceurMainHumaine, disqueVersCarre,
  COTE_POUCE, DECALAGE_RAYURES_DOIGTS, DOIGTS, RAYURES_DOS, TORSION_MAIN, torsionMainHumaine, type SortieMainHumaine,
} from "./main-humaine";
import { NOMS_OS } from "./os";
import { subdiviserPatte } from "./subdivision-patte";
import { nomThree } from "./extraction.mjs";

/** Lecture des attributs du maillage du GLB (meshopt + quantification dénormalisée), comme three. */
async function maillageGLB() {
  await MeshoptDecoder.ready;
  const b = readFileSync("public/tigre/tigre.glb");
  const L = b.readUInt32LE(12);
  const j = JSON.parse(b.toString("utf8", 20, 20 + L));
  const off = 20 + L;
  const bin = b.subarray(off + 8, off + 8 + b.readUInt32LE(off));
  const vues = j.bufferViews.map((v: { byteOffset?: number; byteLength: number; buffer: number; extensions?: Record<string, { byteOffset: number; byteLength: number; count: number; byteStride: number; mode: string; filter?: string }> }) => {
    const e = v.extensions?.EXT_meshopt_compression;
    if (!e) return v.buffer === 0 ? Buffer.from(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)) : null;
    const out = new Uint8Array(e.count * e.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, e.count, e.byteStride, bin.subarray(e.byteOffset, e.byteOffset + e.byteLength), e.mode, e.filter ?? "NONE");
    return Buffer.from(out.buffer);
  });
  const lire = (i: number) => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView], buf: Buffer = vues[a.bufferView];
    const [taille, lecteur, max] = ({
      5126: [4, "readFloatLE", 1], 5121: [1, "readUInt8", 255], 5123: [2, "readUInt16LE", 65535], 5122: [2, "readInt16LE", 32767],
    } as Record<number, [number, "readFloatLE" | "readUInt8" | "readUInt16LE" | "readInt16LE", number]>)[a.componentType];
    const n = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[a.type];
    const pas = v.extensions?.EXT_meshopt_compression?.byteStride ?? v.byteStride ?? taille * n;
    const out = new Float64Array(a.count * n);
    for (let k = 0; k < a.count; k++) for (let q = 0; q < n; q++) {
      const x = buf[lecteur]((a.byteOffset ?? 0) + k * pas + q * taille);
      out[k * n + q] = a.normalized ? Math.max(x / max, -1) : x;
    }
    return out;
  };
  const prim = j.meshes[0].primitives[0];
  const skin = j.skins[0];
  const osMain = skin.joints.findIndex((n: number) => nomThree(j.nodes[n].name) === NOMS_OS.mainD);
  const ibm = lire(skin.inverseBindMatrices);
  return {
    positions: lire(prim.attributes.POSITION),
    normales: lire(prim.attributes.NORMAL),
    uv: lire(prim.attributes.TEXCOORD_0),
    indicesOs: lire(prim.attributes.JOINTS_0),
    poidsOs: lire(prim.attributes.WEIGHTS_0),
    indices: lire(prim.indices),
    osMain,
    versOs: Array.from(ibm.subarray(osMain * 16, osMain * 16 + 16)),
  };
}

/** Maillage tel que modele.ts le prépare : bout de la patte subdivisé. */
async function maillageSubdivise() {
  const m = await maillageGLB();
  return { ...subdiviserPatte(m, m.osMain), osMain: m.osMain, versOs: m.versOs, original: m };
}

const appliquer = (m: ArrayLike<number>, x: number, y: number, z: number) => ({
  x: m[0] * x + m[4] * y + m[8] * z + m[12],
  y: m[1] * x + m[5] * y + m[9] * z + m[13],
  z: m[2] * x + m[6] * y + m[10] * z + m[14],
});

describe("main humaine : correspondance patte → main", () => {
  it("continue : le saut entre deux paramètres voisins diminue avec leur écart (rien ne se déchire)", () => {
    /** Plus grand écart entre les points de deux paramètres distants de `pas`, en q puis en w. */
    const saut = (pas: number) => {
      let max = 0;
      for (let q = -1; q <= 1 + 1e-9; q += pas) for (let w = -1; w <= 1 + 1e-9; w += 0.1) for (const e of [-1, -0.5, 0, 0.5, 1]) {
        const a = mainCanonique(q, w, e), b = mainCanonique(Math.min(1, q + pas), w, e), c = mainCanonique(q, Math.min(1, w + pas), e);
        max = Math.max(max, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z));
      }
      return max;
    };
    const grossier = saut(0.002), fin = saut(0.0005);
    // Une déchirure garderait le même saut quel que soit le pas : ici il est divisé par ~4.
    expect(fin).toBeLessThan(0.015);
    expect(grossier / fin).toBeGreaterThan(3);
  });

  it("doigts séparés par des sillons : au bord commun de deux doigts, dessus et dessous se rejoignent", () => {
    for (const d of DOIGTS.slice(1)) {
      const dessus = mainCanonique(d.q0, 0.7, -1), dessous = mainCanonique(d.q0, 0.7, 1);
      expect(Math.hypot(dessus.x - dessous.x, dessus.y - dessous.y, dessus.z - dessous.z)).toBeLessThan(0.02);
      // Le milieu du doigt est bien plus épais que le sillon.
      const v = (d.q0 + d.q1) / 2;
      expect(mainCanonique(v, 0.7, 1).x - mainCanonique(v, 0.7, -1).x).toBeGreaterThan(0.1);
    }
  });

  it("quatre doigts longs (le majeur le plus long) et un pouce écarté, du côté COTE_POUCE", () => {
    const bouts = DOIGTS.map((d) => mainCanonique((d.q0 + d.q1) / 2, 1, 0).y);
    const paume = mainCanonique(0, 0.12, 0).y;
    for (const y of bouts) expect(y - paume).toBeGreaterThan(0.4);
    expect(Math.max(...bouts)).toBe(bouts[1]);
    const pouce = versMain({ q: -0.8 * -COTE_POUCE, w: 1, e: 0 });
    const index = versMain({ q: -0.3 * -COTE_POUCE, w: 1, e: 0 });
    expect(Math.sign(pouce.z)).toBe(COTE_POUCE);
    // Bout du pouce écarté de l'index (en travers) et plus court.
    expect(Math.abs(pouce.z - index.z)).toBeGreaterThan(0.15);
    expect(pouce.y).toBeLessThan(index.y);
  });

  it("auriculaire : à peine plus fin et plus court que l'annulaire, pas une lamelle", () => {
    const [, majeur, annulaire, auriculaire] = DOIGTS;
    expect(auriculaire.r0).toBeLessThan(annulaire.r0);
    expect(auriculaire.r0).toBeGreaterThan(0.95 * annulaire.r0);
    expect(auriculaire.long).toBeLessThan(annulaire.long);
    expect(auriculaire.long).toBeGreaterThan(0.85 * annulaire.long);
    // Sa bande en travers de la patte est aussi large que celle de l'annulaire.
    expect(auriculaire.q1 - auriculaire.q0).toBeGreaterThan(0.95 * (annulaire.q1 - annulaire.q0));
    // Bout de l'auriculaire : au moins 75 % de la hauteur du bout du majeur au-dessus de la paume
    // (0,55 avant la correction, environ 0,8 sur une main humaine).
    const paume = mainCanonique(0, 0.12, 0).y;
    const bout = (d: (typeof DOIGTS)[number]) => mainCanonique((d.q0 + d.q1) / 2, 1, 0).y - paume;
    expect(bout(auriculaire)).toBeGreaterThan(0.75 * bout(majeur));
  });

  it("torsion de mainD : nulle sans main, demi-tour à poids 1, continue, le pouce passe devant", () => {
    expect(torsionMainHumaine(0)).toBe(0);
    expect(torsionMainHumaine(-1)).toBe(0);
    expect(torsionMainHumaine(Number.NaN)).toBe(0);
    expect(torsionMainHumaine(1)).toBe(TORSION_MAIN);
    expect(torsionMainHumaine(2)).toBe(TORSION_MAIN);
    expect(Math.abs(TORSION_MAIN)).toBeCloseTo(Math.PI, 9);
    // Proportionnelle au poids : continue et monotone, donc aucun saut à l'entrée ni à la sortie.
    let avant = 0;
    for (let k = 1; k <= 100; k++) {
      const a = torsionMainHumaine(k / 100);
      expect(Math.abs(a - avant)).toBeLessThan(0.04);
      expect(Math.abs(a)).toBeGreaterThan(Math.abs(avant));
      avant = a;
    }
    // Rotation autour de y (repère de l'os) : à mi-course, le côté du pouce (z = COTE_POUCE) est
    // tourné vers la plante (x > 0, face à la caméra pendant la poignée de main), comme une
    // pronation. À poids 1, la plante est tournée vers l'arrière (x < 0) : le dos fait face.
    const tourner = (a: number, x: number, z: number) => ({ x: Math.cos(a) * x + Math.sin(a) * z, z: -Math.sin(a) * x + Math.cos(a) * z });
    expect(tourner(torsionMainHumaine(0.5), 0, COTE_POUCE).x).toBeCloseTo(1, 9);
    expect(tourner(torsionMainHumaine(1), 1, 0).x).toBeCloseTo(-1, 9);
  });

  it("rayures du dos : sur la partie visible du dos et des doigts, effilées, dans le nuanceur", () => {
    expect(RAYURES_DOS.length).toBeGreaterThanOrEqual(4);
    for (const r of RAYURES_DOS) {
      expect(r.q1).toBeGreaterThan(r.q0);
      expect(r.l).toBeGreaterThan(0);
      expect(r.l).toBeLessThan(0.08);
      // Dos visible de la main : de la base de la paume (w ≈ -0,1) au bout des doigts (w = 1).
      expect(r.w).toBeGreaterThan(-0.1);
      expect(r.w).toBeLessThan(1);
      // Obliques dans le sens des chevrons de l'avant-bras, jamais des barres en travers.
      expect(r.pente).toBeLessThan(-0.1);
    }
    // Un tronçon par doigt : deux doigts voisins n'ont jamais la même hauteur de rayure.
    expect(DECALAGE_RAYURES_DOIGTS).toHaveLength(DOIGTS.length);
    for (let k = 1; k < DECALAGE_RAYURES_DOIGTS.length; k++) {
      expect(Math.abs(DECALAGE_RAYURES_DOIGTS[k] - DECALAGE_RAYURES_DOIGTS[k - 1])).toBeGreaterThan(0.03);
    }
    const code = nuanceurMainHumaine();
    expect(code).toContain("mhR");
    // Bord net calculé hors du test sur le poids (dérivée écran en flux uniforme).
    expect(code.indexOf("fwidth( vMainHumaine.z )")).toBeGreaterThanOrEqual(0);
    expect(code.indexOf("fwidth(")).toBeLessThan(code.indexOf("if ( vMainHumaine.x"));
    // Rayures limitées à la face du dos (e < 0) et au poids de la déformation.
    expect(code).toMatch(/mhK \* mhR \* \( 1\.0 - smoothstep\( -0\.35, 0\.05, mhE \) \)/);
  });

  it("disque → carré et inverse affine", () => {
    expect(disqueVersCarre(0, 0)).toEqual([0, 0]);
    const [u, v] = disqueVersCarre(Math.SQRT1_2, Math.SQRT1_2);
    expect(u).toBeCloseTo(1, 6);
    expect(v).toBeCloseTo(1, 6);
    const m = [2, 0, 0, 0, 0, 0, 3, 0, 0, -1, 0, 0, 5, 6, 7, 1];
    const p = appliquer(inverseAffine(m), ...(Object.values(appliquer(m, 0.3, -0.2, 0.9)) as [number, number, number]));
    expect(p.x).toBeCloseTo(0.3, 9); expect(p.y).toBeCloseTo(-0.2, 9); expect(p.z).toBeCloseTo(0.9, 9);
  });

  it("nuanceur : code GLSL qui lit vMainHumaine, flottants écrits avec un point", () => {
    const code = nuanceurMainHumaine();
    expect(code).toContain("vMainHumaine");
    expect(code).toContain("couleurPeau");
    expect(code.split("{").length).toBe(code.split("}").length);
    expect(code).not.toMatch(/NaN|undefined/);
    // Aucun littéral entier (GLSL ES refuse de mêler int et float) : chaque nombre a son point.
    expect(code.match(/(?<![\w.])\d+(?![\d.\w])/g)).toBeNull();
  });
});

describe("main humaine : cible de déformation du vrai maillage", () => {
  let m: Awaited<ReturnType<typeof maillageSubdivise>>;
  let s: SortieMainHumaine;
  const poidsMain = (i: number) => {
    let w = 0;
    for (let j = 0; j < 4; j++) if (m.indicesOs[i * 4 + j] === m.osMain) w += m.poidsOs[i * 4 + j];
    return w;
  };
  /** Sommet i dans le repère de l'os, déformé avec le poids k. */
  const local = (i: number, k: number) => appliquer(
    m.versOs,
    m.positions[i * 3] + k * s.deplacements[i * 3],
    m.positions[i * 3 + 1] + k * s.deplacements[i * 3 + 1],
    m.positions[i * 3 + 2] + k * s.deplacements[i * 3 + 2],
  );
  beforeAll(async () => {
    m = await maillageSubdivise();
    s = construireMainHumaine(m);
  });

  it("seule la patte avant droite bouge, le reste du tigre (et l'avant-bras) reste en place", () => {
    expect(m.osMain).toBeGreaterThan(0);
    const n = m.positions.length / 3;
    let hors = 0, faibles = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(s.deplacements[i * 3], s.deplacements[i * 3 + 1], s.deplacements[i * 3 + 2]);
      if (!Number.isFinite(d)) throw new Error(`déplacement non fini au sommet ${i}`);
      const w = poidsMain(i);
      if (w === 0 && d > 0) hors++;
      // Poignet : les sommets surtout liés à l'avant-bras ne bougent pas.
      if (w < 0.15 && d > 0) faibles++;
    }
    expect(hors).toBe(0);
    expect(faibles).toBe(0);
    // Patte subdivisée : 12 374 sommets déplacés au 2026-10-22 (991 sans subdivision).
    expect(s.deplaces).toBeGreaterThan(11000);
    expect(s.deplaces).toBeLessThan(13500);
  });

  it("subdivision : au repos, chaque sommet ajouté est sur une arête du maillage d'origine, rien d'autre ne change", () => {
    const o = m.original, n0 = o.positions.length / 3, n = m.positions.length / 3;
    expect(n).toBeGreaterThan(n0);
    // Les sommets d'origine gardent leur position, leurs coordonnées de texture et leurs os.
    for (let i = 0; i < n0 * 3; i++) expect(Math.abs(m.positions[i] - o.positions[i])).toBeLessThan(1e-6);
    for (let i = 0; i < n0 * 2; i++) expect(Math.abs(m.uv[i] - o.uv[i])).toBeLessThan(1e-6);
    // Poids d'os de chaque sommet ajouté : somme 1, et mainD est toujours son influence principale
    // ou le partage (seuls les triangles du bout sont coupés en quatre).
    for (let i = n0; i < n; i++) {
      let somme = 0;
      for (let j = 0; j < 4; j++) somme += m.poidsOs[i * 4 + j];
      expect(Math.abs(somme - 1)).toBeLessThan(0.02);
    }
    // Hors de la patte, aucun triangle ne change.
    const tri = (idx: ArrayLike<number>, t: number) => [idx[t], idx[t + 1], idx[t + 2]].join(",");
    const avant = new Set<string>(), apres = new Set<string>();
    const dansPatte = (i: number) => { for (let j = 0; j < 4; j++) if (o.indicesOs[i * 4 + j] === o.osMain && o.poidsOs[i * 4 + j] > 0) return true; return false; };
    for (let t = 0; t < o.indices.length; t += 3) if (![0, 1, 2].some((k) => dansPatte(o.indices[t + k]))) avant.add(tri(o.indices, t));
    for (let t = 0; t < m.indices.length; t += 3) apres.add(tri(m.indices, t));
    for (const t of avant) expect(apres.has(t)).toBe(true);
  });

  it("les sommets doublés (coutures de texture) reçoivent le même déplacement", () => {
    const vus = new Map<string, number>();
    let ecart = 0;
    for (let i = 0; i < m.positions.length / 3; i++) {
      if (poidsMain(i) === 0) continue;
      const cle = [0, 1, 2].map((k) => Math.round(m.positions[i * 3 + k] * 1e5)).join(",");
      const j = vus.get(cle);
      if (j === undefined) { vus.set(cle, i); continue; }
      for (let k = 0; k < 3; k++) ecart = Math.max(ecart, Math.abs(s.deplacements[i * 3 + k] - s.deplacements[j * 3 + k]));
    }
    expect(ecart).toBe(0);
  });

  it("main aux doigts longs : le bout dépasse largement celui de la patte", () => {
    let yAvant = -Infinity, yApres = -Infinity;
    for (let i = 0; i < m.positions.length / 3; i++) {
      if (poidsMain(i) === 0) continue;
      yAvant = Math.max(yAvant, local(i, 0).y);
      yApres = Math.max(yApres, local(i, 1).y);
    }
    // Repère de l'os : la patte finit à y ≈ 0,65, la main plus loin (doigts longs).
    expect(yApres - yAvant).toBeGreaterThan(0.3);
  });

  /**
   * Étirement des arêtes (longueur après / longueur avant), par catégorie, plafonds fixés après
   * mesure du 2026-10-22, auriculaire élargi (valeur mesurée entre parenthèses). Une déchirure relie deux points
   * éloignés de la main par une arête courte de la patte : elle dépasserait ces plafonds.
   * - « traversantes » : arêtes entre deux doigts (ou pouce et index) au-delà de la base des
   *   doigts. Elles font les palmures, au fond des encoches. Longueur après bornée (0,215) : une
   *   membrane entre deux doigts écartés dépasserait 0,3.
   * - « bords communs » : arêtes dont un sommet est sur la bande d'un bord commun (|v| > 0,3 dans
   *   sa bande). Cette bande étroite de la patte devient tout le flanc intérieur du doigt, de la
   *   palmure au bout : étirement voulu (25,5), longueur après bornée (0,236).
   * - « poignet » : déplacement atténué, triangles non subdivisés (8,2, longueur 0,285 pour une
   *   arête de 0,133 au repos).
   * - « autres » : le reste des doigts, de la paume et du pouce (14,1, longueur 0,110). Le
   *   flanc de la patte devient tout le côté extérieur de l'auriculaire, d'où l'étirement le plus fort.
   */
  it("aucune arête déchirée : étirement plafonné par catégorie", () => {
    const QP = DOIGTS[0].q0;
    const bandes = [[-1, QP], ...DOIGTS.map((d) => [d.q0, d.q1])];
    const bande = (q: number) => bandes.findIndex(([a, b]) => q >= a && q <= b);
    // |v| dans la bande (1 sur un bord commun), 0 du côté extérieur de la main.
    const bord = (q: number) => {
      const k = bande(q), [a, b] = bandes[k], v = (2 * (q - a)) / (b - a) - 1;
      return (k === 0 && v < 0) || (k === bandes.length - 1 && v > 0) ? 0 : Math.abs(v);
    };
    const max: Record<string, { r: number; l: number }> = {};
    const vues = new Set<number>();
    for (let t = 0; t < m.indices.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = m.indices[t + k], b = m.indices[t + ((k + 1) % 3)];
      const cle = a < b ? a * 1e6 + b : b * 1e6 + a;
      if (vues.has(cle)) continue;
      vues.add(cle);
      const ra = s.reperes[a * 4], rb = s.reperes[b * 4];
      if (ra === 0 && rb === 0) continue;
      const d = (x: { x: number; y: number; z: number }, y: { x: number; y: number; z: number }) => Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z);
      const l0 = d(local(a, 0), local(b, 0)), l1 = d(local(a, 1), local(b, 1));
      const qa = s.reperes[a * 4 + 1], qb = s.reperes[b * 4 + 1], wa = s.reperes[a * 4 + 2], wb = s.reperes[b * 4 + 2];
      const cat = bande(qa) !== bande(qb) && Math.min(wa, wb) > 0.12 ? "traversantes"
        : Math.min(ra, rb) < 0.999 ? "poignet"
          : Math.max(bord(qa), bord(qb)) > 0.3 && Math.min(wa, wb) > 0 ? "bords communs" : "autres";
      const c = (max[cat] ??= { r: 0, l: 0 });
      c.r = Math.max(c.r, l1 / Math.max(l0, 1e-9));
      c.l = Math.max(c.l, l1);
    }
    expect(max.traversantes.l).toBeLessThan(0.22);
    expect(max["bords communs"].r).toBeLessThan(28);
    expect(max["bords communs"].l).toBeLessThan(0.26);
    expect(max.poignet.r).toBeLessThan(9);
    expect(max.poignet.l).toBeLessThan(0.3);
    expect(max.autres.r).toBeLessThan(15.5);
    expect(max.autres.l).toBeLessThan(0.12);
  });

  it("repères du nuanceur : peau sur la face de la paume (dessous au repos), atténuation 0 hors de la main", () => {
    let plante = 0, peau = 0;
    for (let i = 0; i < m.positions.length / 3; i++) {
      const att = s.reperes[i * 4];
      expect(att).toBeGreaterThanOrEqual(0);
      expect(att).toBeLessThanOrEqual(1);
      if (poidsMain(i) === 0) { expect(att).toBe(0); continue; }
      // Dessous de la patte au repos (x de l'os > 0,15) : face de la paume, e > 0.
      if (appliquer(m.versOs, m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]).x > 0.15 && att > 0.5) {
        plante++;
        if (s.reperes[i * 4 + 3] > 0.3) peau++;
      }
    }
    expect(plante).toBeGreaterThan(50);
    expect(peau / plante).toBeGreaterThan(0.9);
  });
});
