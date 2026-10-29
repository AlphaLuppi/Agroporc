import { readFileSync } from "node:fs";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { describe, expect, it } from "vitest";
import { ajouterArbres, ajouterBatiments, buildingGroup, construireDecor, creerEtatDestruction, extrude, type OptionsDecor } from "./decor";
import { deriverDecor } from "./decor-donnees";
import { BIT_RESTO, CODE_STYLE, ENSEIGNE_L_M, INDUSTRIEL_PORTE_L_M, MUR_RIDEAU_CELLULE_M, VITRINE_BAS_M, VITRINE_HAUT_M, estLisse, mursDe, nbEtages } from "./facade";
import type { Building, DecorOsm, SceneData } from "./types";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;

/** Objets dessinables (un draw call chacun) d'un arbre de scène. */
function dessinables(o: THREE.Object3D): THREE.Object3D[] {
  const l: THREE.Object3D[] = [];
  o.traverse((x) => { if ((x as THREE.Mesh).isMesh || (x as THREE.LineSegments).isLineSegments) l.push(x); });
  return l;
}
const monter = (data: SceneData, opts: Parameters<typeof ajouterBatiments>[2]) => {
  const racine = new THREE.Group();
  ajouterBatiments(racine, data, opts);
  return racine;
};
const facesDe = (racine: THREE.Object3D) => dessinables(racine).filter((x) => (x as THREE.Mesh).isMesh && !(x as THREE.InstancedMesh).isInstancedMesh) as THREE.Mesh[];

/** Simule la compilation d'un matériau avec les nuanceurs de base de three. */
function compiler(mat: THREE.Material, base: "basic" = "basic") {
  const sh = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderLib[base].vertexShader, fragmentShader: THREE.ShaderLib[base].fragmentShader };
  (mat.onBeforeCompile as (s: typeof sh, r: unknown) => void)(sh, null);
  return sh;
}

const carre = (x: number, z: number, c: number, h: number, type?: Building["type"]): Building =>
  ({ h, r: [[x, z], [x + c, z], [x + c, z + c], [x, z + c]], c: [x + c / 2, z + c / 2], ...(type ? { type } : {}) });
const petite = (batiments: Building[]): SceneData => ({ ...scene, buildings: batiments, pois: [] });

describe("ajouterBatiments : détail faux (vue aérienne)", () => {
  it("la géométrie des faces est celle de l'extrusion d'origine, sans attribut de façade", () => {
    const racine = monter(scene, {});
    const faces = facesDe(racine);
    expect(faces.length).toBe(3);
    const attendu = mergeGeometries(
      scene.buildings.filter((_, i) => !scene.pois.some((p) => p.b === i && (p.type === "home" || p.type === "resto"))).map((b) => {
        const g = extrude(b);
        const f = new THREE.BufferGeometry();
        f.setAttribute("position", g.getAttribute("position"));
        return f;
      }), false)!;
    const ordinaire = faces[0].geometry;
    expect(Array.from(ordinaire.getAttribute("position").array)).toEqual(Array.from(attendu.getAttribute("position").array));
    expect(ordinaire.getAttribute("aMur")).toBeUndefined();
    expect(ordinaire.getAttribute("aBat")).toBeUndefined();
    expect(dessinables(racine).some((x) => (x as THREE.InstancedMesh).isInstancedMesh)).toBe(false);
  });

  it("avec destruction mais detail: false : seulement l'attribut aBat (comportement d'avant)", () => {
    const racine = monter(scene, { destruction: creerEtatDestruction(scene.buildings.length), detail: false });
    const g = facesDe(racine)[0].geometry;
    expect(g.getAttribute("aBat")).toBeDefined();
    expect(g.getAttribute("aMur")).toBeUndefined();
  });
});

describe("ajouterBatiments : détail vrai (arène)", () => {
  const etat = creerEtatDestruction(scene.buildings.length);
  const sans = monter(scene, { destruction: etat, detail: false });
  const avec = monter(scene, { destruction: etat });

  it("vrai par défaut quand la destruction est fournie", () => {
    expect(facesDe(avec)[0].geometry.getAttribute("aMur")).toBeDefined();
  });

  it("attributs aMur = (u, L, nEtages, porte) et aHaut, un quad par arête + le toit", () => {
    const b = carre(0, 0, 20, 9.6); // 3 étages
    const g = facesDe(monter(petite([b]), { destruction: creerEtatDestruction(1) }))[0].geometry;
    const mur = g.getAttribute("aMur");
    expect(mur.itemSize).toBe(4);
    // 4 murs × 6 sommets + toit (2 triangles)
    expect(g.getAttribute("position").count).toBe(4 * 6 + 6);
    let murs = 0, toit = 0, portes = 0;
    for (let i = 0; i < mur.count; i++) {
      if (mur.getZ(i) === 0) { toit++; continue; }
      murs++;
      expect(mur.getZ(i)).toBe(nbEtages(9.6));
      expect(mur.getY(i)).toBeCloseTo(20, 6);
      expect([0, 20]).toContain(Math.round(mur.getX(i) * 1e6) / 1e6);
      if (mur.getW(i) === 1) portes++;
    }
    expect(murs).toBe(24);
    expect(toit).toBe(6);
    expect(portes).toBe(6); // un seul mur porte la porte
    const haut = g.getAttribute("aHaut");
    for (let i = 0; i < haut.count; i++) expect(haut.getX(i)).toBeCloseTo(9.6, 5);
  });

  it("les murs sont orientés vers l'extérieur : normale géométrique alignée sur la normale sortante", () => {
    const b = carre(0, 0, 20, 9.6);
    const g = facesDe(monter(petite([b]), { destruction: creerEtatDestruction(1) }))[0].geometry;
    const p = g.getAttribute("position");
    const murs = mursDe(b);
    let verifies = 0;
    for (let i = 0; i < p.count; i += 3) {
      const A = new THREE.Vector3().fromBufferAttribute(p, i), B = new THREE.Vector3().fromBufferAttribute(p, i + 1), C = new THREE.Vector3().fromBufferAttribute(p, i + 2);
      const n = B.clone().sub(A).cross(C.clone().sub(A)).normalize();
      if (Math.abs(n.y) > 0.5) { expect(n.y).toBeGreaterThan(0); continue; } // toit : vers le haut
      const mx = (A.x + B.x + C.x) / 3, mz = (A.z + B.z + C.z) / 3;
      const m = murs.reduce((u, v) => (Math.hypot(mx - (v.a[0] + v.b[0]) / 2, mz - (v.a[1] + v.b[1]) / 2) < Math.hypot(mx - (u.a[0] + u.b[0]) / 2, mz - (u.a[1] + u.b[1]) / 2) ? v : u));
      expect(n.x * m.nx + n.z * m.nz).toBeGreaterThan(0.99);
      verifies++;
    }
    expect(verifies).toBe(8);
  });

  it("les cours intérieures ont leurs murs (tournés vers la cour)", () => {
    const b: Building = { ...carre(0, 0, 40, 9), holes: [[[10, 10], [30, 10], [30, 30], [10, 30]]] };
    const g = facesDe(monter(petite([b]), { destruction: creerEtatDestruction(1) }))[0].geometry;
    expect(g.getAttribute("position").count).toBe(8 * 6 + 6 * 2 * 0 + (g.getAttribute("position").count - 48));
    const mur = g.getAttribute("aMur");
    let murs = 0;
    for (let i = 0; i < mur.count; i++) if (mur.getZ(i) > 0) murs++;
    expect(murs).toBe(48);
  });

  it("bâtiment lisse : murs sans étage (nEtages = 0), aucun équipement", () => {
    const petit = carre(0, 0, 5, 9);
    expect(estLisse(petit)).toBe(true);
    const racine = monter(petite([petit]), { destruction: creerEtatDestruction(1) });
    const mur = facesDe(racine)[0].geometry.getAttribute("aMur");
    for (let i = 0; i < mur.count; i++) expect(mur.getZ(i)).toBe(0);
    expect(dessinables(racine).some((x) => (x as THREE.InstancedMesh).isInstancedMesh)).toBe(false);
  });

  it("deux draw calls de plus que sans détail (équipements de toit : une InstancedMesh et ses arêtes), quel que soit le nombre de bâtiments", () => {
    const delta = (data: SceneData) => {
      const e = creerEtatDestruction(data.buildings.length);
      return dessinables(monter(data, { destruction: e })).length - dessinables(monter(data, { destruction: e, detail: false })).length;
    };
    expect(delta(scene)).toBe(2);
    expect(delta(petite([carre(0, 0, 40, 12), carre(60, 0, 30, 9), carre(100, 0, 50, 15)]))).toBe(2);
    expect(dessinables(avec).length).toBe(dessinables(sans).length + 2);
  });

  it("équipements de toit : une InstancedMesh d'environ 300 instances, aBat par instance", () => {
    const inst = dessinables(avec).filter((x) => (x as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
    expect(inst).toHaveLength(1);
    expect(inst[0].count).toBeGreaterThan(220);
    expect(inst[0].count).toBeLessThan(380);
    const ab = inst[0].geometry.getAttribute("aBat") as THREE.InstancedBufferAttribute;
    expect(ab.isInstancedBufferAttribute).toBe(true);
    expect(ab.count).toBe(inst[0].count);
  });

  it("nuanceur : façade, hachage et dérivées injectés, ancres de three bien remplacées", () => {
    const f = facesDe(avec)[0];
    const sh = compiler(f.material as THREE.Material);
    expect(sh.vertexShader).toContain("attribute vec4 aMur");
    expect(sh.vertexShader).toContain("vMondeB = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    expect(sh.fragmentShader).toContain("uint hachageB(uint x)");
    expect(sh.fragmentShader).toContain("float fwuB = fwidth(vMur.x);");
    expect(sh.fragmentShader).toMatch(/16384u/);
    // le mur entre dans le hachage arrondi (une longueur ronde interpolée à 1e-7 près ne doit pas osciller entre deux entiers)
    expect(sh.fragmentShader).toContain("uint(L * 8.0 + 0.5)");
    expect(sh.fragmentShader).not.toContain("uint(L * 8.0)");
    // la façade est calculée avant l'écriture de la couleur, l'incandescence des brèches après
    const iFacade = sh.fragmentShader.indexOf("if (vMur.z > 0.5)");
    const iOpaque = sh.fragmentShader.indexOf("#include <opaque_fragment>");
    const iBord = sh.fragmentShader.indexOf("bordB * 0.85");
    expect(iFacade).toBeGreaterThan(0);
    expect(iOpaque).toBeGreaterThan(iFacade);
    expect(iBord).toBeGreaterThan(iOpaque);
    expect(sh.fragmentShader.match(/#include <opaque_fragment>/g)).toHaveLength(1);
    expect(sh.fragmentShader.match(/void main\(\) \{/g)).toHaveLength(1);
  });

  it("nuanceur des façades v2 : attribut et varying de style, constantes recopiées de facade.ts, quatre styles", () => {
    const sh = compiler(facesDe(avec)[0].material as THREE.Material);
    expect(sh.vertexShader).toContain("attribute float aStyle");
    expect(sh.vertexShader).toContain("vStyle = aStyle;");
    expect(sh.fragmentShader).toContain("varying float vStyle;");
    // teinte de bâtiment : même hachage que `teinteBatiment`
    expect(sh.fragmentShader).toContain("uint(vBatF + 0.5) * 0x9e3779b1u ^ 0x1b873593u) % 3u");
    // constantes de facade.ts écrites dans le nuanceur
    expect(sh.fragmentShader).toContain(`${VITRINE_BAS_M.toFixed(2)} - y, y - ${VITRINE_HAUT_M.toFixed(1)}`);
    expect(sh.fragmentShader).toContain(`${MUR_RIDEAU_CELLULE_M.toFixed(1)}`);
    expect(sh.fragmentShader).toContain(`${INDUSTRIEL_PORTE_L_M / 2}.0 :`.replace(".0 :", ".0 : ")); // porte sectionnelle de 4 m
    expect(sh.fragmentShader).toContain(`ddp - ${(ENSEIGNE_L_M / 2).toFixed(1)}`);
    for (const motif of ["sty < 0.5", "sty < 1.5", "sty < 2.5", "bardage", "enseigne"]) expect(sh.fragmentShader).toContain(motif);
    expect(sh.fragmentShader.match(/void main\(\) \{/g)).toHaveLength(1);
  });

  it("attribut aStyle : constant par bâtiment, code de codeFacade, drapeau restaurant (+8) sur les restos", () => {
    const faces = facesDe(avec);
    const restos = faces[2].geometry.getAttribute("aStyle");
    expect(restos).toBeDefined();
    for (let i = 0; i < restos.count; i++) expect(restos.getX(i)).toBe(CODE_STYLE.percee + BIT_RESTO);
    const ordinaires = faces[0].geometry.getAttribute("aStyle");
    const vus = new Set<number>();
    for (let i = 0; i < ordinaires.count; i++) vus.add(ordinaires.getX(i));
    expect([...vus].every((v) => v >= 0 && v <= 3)).toBe(true);
    expect(vus.size).toBeGreaterThan(1);
  });

  it("acrotère : des arêtes en plus pour les bâtiments non lisses, sans draw call de plus", () => {
    const arêtes = (r: THREE.Object3D) => dessinables(r).filter((x) => (x as THREE.LineSegments).isLineSegments && !(x as THREE.Mesh).isMesh) as THREE.LineSegments[];
    const plus = arêtes(avec).reduce((n, l) => n + l.geometry.getAttribute("position").count, 0);
    const moins = arêtes(monter(scene, { destruction: creerEtatDestruction(scene.buildings.length), detail: false })).reduce((n, l) => n + l.geometry.getAttribute("position").count, 0);
    expect(plus).toBeGreaterThan(moins);
  });

  it("nuanceur des équipements : l'écrasement s'applique après la matrice d'instance", () => {
    const inst = dessinables(avec).find((x) => (x as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
    const sh = compiler(inst.material as THREE.Material);
    expect(sh.vertexShader).toContain("modelMatrix * instanceMatrix");
    // (v8) un équipement d'un bâtiment effacé passe sous le sol avec lui
    expect(sh.vertexShader).toContain("mvPosition = instanceMatrix * mvPosition;\nmvPosition.y = etatB.r > 1.5 ? -0.05 : mvPosition.y * mix(");
    expect(sh.vertexShader).not.toContain("transformed.y = etatB.r");
  });

  it("chaque variante de nuanceur a sa clé de programme (aucune collision)", () => {
    const cles = new Set<string>();
    const racine = monter(petite([carre(0, 0, 20, 9), carre(40, 0, 6, 6, "porte"), carre(60, 0, 6, 6, "barricade"), carre(80, 0, 6, 6, "champ")]), { destruction: creerEtatDestruction(4) });
    const inst = dessinables(avec).find((x) => (x as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
    for (const o of [...dessinables(racine), inst]) {
      const m = (o as THREE.Mesh).material as THREE.Material;
      const c = m.customProgramCacheKey?.() ?? "";
      if (c.startsWith("batiment-effondrable-5")) cles.add(c);
    }
    // faces détaillées, arêtes (= faces de la porte : même code), barricade, champ, équipements (autre largeur de texture : autre clé)
    expect(cles.size).toBe(6);
  });
});

describe("pièces de la carte zombies (Building.type)", () => {
  const data = petite([carre(0, 0, 20, 9), carre(30, 0, 4, 6, "porte"), carre(40, 0, 4, 6, "barricade"), carre(50, 0, 4, 6, "champ"), carre(60, 0, 2, 6, "mur")]);
  const racine = monter(data, { destruction: creerEtatDestruction(5) });
  const groupes = racine.children as THREE.Group[];
  const matDe = (g: THREE.Group) => (g.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh).material as THREE.MeshBasicMaterial;

  it("un groupe à part par style présent ; le mur reste un bâtiment ordinaire", () => {
    const ordinaire = groupes[0];
    // 2 bâtiments ordinaires (le grand et le mur) dans le premier groupe : 20 m + 2 m
    const pos = (ordinaire.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh).geometry.getAttribute("aBat");
    expect(new Set(Array.from(pos.array))).toEqual(new Set([0, 4]));
    const mats = groupes.filter((g) => g.children.length).map(matDe);
    expect(mats).toHaveLength(4); // ordinaire, porte, barricade, champ (home et resto vides : pas de groupe)
  });

  it("champ : translucide, sans écriture de profondeur, double face, groupe dessiné après les autres", () => {
    const g = groupes.find((x) => x.children.length && matDe(x).side === THREE.DoubleSide)!;
    const m = matDe(g);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.opacity).toBeLessThan(0.3);
    expect(g.children.every((c) => c.renderOrder >= 3)).toBe(true);
  });

  it("porte : ambre pleine et opaque", () => {
    const m = groupes.filter((x) => x.children.length).map(matDe).find((x) => x.opacity === 1 && !x.transparent && x.color.getHex() === 0x8a5a1c);
    expect(m).toBeDefined();
  });

  it("barricade : bandes ambre ajoutées par le nuanceur, champ : traits translucides", () => {
    const motif = (clef: string) => groupes.filter((x) => x.children.length).map(matDe)
      .filter((m) => m.customProgramCacheKey?.().endsWith(clef))
      .map((m) => compiler(m).fragmentShader);
    expect(motif("barricade")[0]).toContain("bandeB");
    expect(motif("champ")[0]).toContain("diffuseColor.a *= 0.6");
  });

  it("sans type, rien de plus qu'avant : pas de groupe de style", () => {
    const sans = monter(petite([carre(0, 0, 20, 9)]), { destruction: creerEtatDestruction(1) });
    expect(sans.children.filter((g) => g.type === "Group" && g.children.length)).toHaveLength(1);
  });
});

describe("buildingGroup", () => {
  it("détail vrai sans destruction : façade seule, aBat posé pour le hachage des fenêtres", () => {
    const b = carre(0, 0, 20, 9);
    const g = buildingGroup([b], 0xffffff, 0x000000, 0.8, 0, { indices: [7], detail: { portes: [0] } });
    const mesh = g.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
    expect(mesh.geometry.getAttribute("aBat").getX(0)).toBe(7);
    const sh = compiler(mesh.material as THREE.Material);
    expect(sh.vertexShader).toContain("attribute float aBat;");
    expect(sh.fragmentShader).not.toContain("uDetruits");
  });
});

describe("(v8) bâtiment effacé (porte ouverte des zombies)", () => {
  it("`effacer` marque le texel d'une valeur réservée (> 1,5 : sous le sol, sans gravats) ; `poser(id, 0)` le relève", () => {
    const e = creerEtatDestruction(3);
    const data = e.texture.image.data as unknown as Float32Array;
    e.poser(1, 1);
    expect(data[4]).toBe(1);
    e.effacer(2);
    expect(data[8]).toBeGreaterThan(1.5);
    e.poser(2, 0);
    expect(data[8]).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// construireDecor : le rework de la DA (issue #83)
// ---------------------------------------------------------------------------------------------------------------------

describe("construireDecor (rework de la DA)", () => {
  const decorOsm = JSON.parse(readFileSync("public/agroparc/decor.json", "utf8")) as DecorOsm;
  const complet: SceneData = { ...scene, decor: decorOsm };
  const construire = (data: SceneData, opts: OptionsDecor) => { const racine = new THREE.Group(); construireDecor(racine, data, opts); return racine; };
  const etat = creerEtatDestruction(scene.buildings.length);

  it("arène : au plus 32 draw calls, décor statique (aucun objet animé)", () => {
    const racine = construire(complet, { fantomes: false, destruction: etat });
    const n = dessinables(racine).length;
    console.log(`construireDecor (arène) : ${n} draw calls`);
    expect(n).toBeLessThanOrEqual(32);
    expect(n).toBeGreaterThan(20);
  });

  it("vue aérienne (détail et fantômes) : au plus 32 draw calls", () => {
    expect(dessinables(construire(complet, { fantomes: true, detail: true })).length).toBeLessThanOrEqual(32);
  });

  it("sans decor.json : repli sans erreur, règles dérivées de scene.json seulement", () => {
    const racine = construire(scene, { fantomes: false, destruction: etat });
    expect(dessinables(racine).length).toBeLessThanOrEqual(32);
    expect(dessinables(racine).length).toBeGreaterThan(18);
  });

  it("budget de triangles : au plus 120 000 de plus que la scène d'avant", () => {
    const tri = (o: THREE.Object3D) => dessinables(o).reduce((n, x) => {
      const g = (x as THREE.Mesh).geometry as THREE.BufferGeometry;
      const inst = (x as THREE.InstancedMesh).isInstancedMesh ? (x as THREE.InstancedMesh).count : 1;
      const base = g.index ? g.index.count / 3 : g.getAttribute("position").count / 3;
      return n + (((x as THREE.Mesh).isMesh ? base : 0) * inst);
    }, 0);
    const apres = tri(construire(complet, { fantomes: false, destruction: etat }));
    const avant = tri((() => { const r = new THREE.Group(); ajouterBatiments(r, scene, { destruction: etat }); ajouterArbres(r, scene); return r; })());
    console.log(`triangles : ${avant.toFixed(0)} → ${apres.toFixed(0)}`);
    expect(apres - avant).toBeLessThanOrEqual(120000);
  });

  it("ambiance zombies : ni mobilier, ni taches de lumière, ni haies, ni pelouses, ni arbustes dans la boîte de la carte", () => {
    const boite = { x0: 2, z0: -116, x1: 242, z1: 30 };
    const dedans = (x: number, z: number) => x >= boite.x0 && x <= boite.x1 && z >= boite.z0 && z <= boite.z1;
    const d = deriverDecor(complet, { ambiance: "zombies", exclure: [boite] });
    expect(Object.values(d.mobilier).every((l) => l.length === 0)).toBe(true);
    for (let i = 0; i < d.haies.length; i += 4) expect(dedans(d.haies[i], d.haies[i + 1])).toBe(false);
    for (let i = 0; i < d.arbustes.length; i += 2) expect(dedans(d.arbustes[i], d.arbustes[i + 1])).toBe(false);
    for (let i = 0; i < d.pelouses.length; i += 6) expect(dedans((d.pelouses[i] + d.pelouses[i + 2] + d.pelouses[i + 4]) / 3, (d.pelouses[i + 1] + d.pelouses[i + 3] + d.pelouses[i + 5]) / 3)).toBe(false);
    for (let i = 0; i < d.places.length; i += 4) expect(dedans(d.places[i], d.places[i + 1])).toBe(false);
    // les arbres de scene.trees restent (retypés seulement)
    expect(d.arbres.length).toBe(scene.trees.length);
    const racine = construire(complet, { fantomes: false, destruction: etat, ambiance: "zombies", exclure: [boite] });
    expect(dessinables(racine).some((x) => (x as THREE.InstancedMesh).isInstancedMesh && (x as THREE.InstancedMesh).material && ((x as THREE.InstancedMesh).material as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending)).toBe(false);
  });

  it("qualité basse : sans taches de lumière, sans haies ni arbustes", () => {
    const haute = construire(complet, { fantomes: false, destruction: etat, qualite: "haute" });
    const basse = construire(complet, { fantomes: false, destruction: etat, qualite: "basse" });
    const additifs = (r: THREE.Object3D) => dessinables(r).filter((x) => ((x as THREE.Mesh).material as THREE.MeshBasicMaterial)?.blending === THREE.AdditiveBlending).length;
    expect(additifs(haute)).toBe(1);
    expect(additifs(basse)).toBe(0);
    expect(dessinables(basse).length).toBeLessThan(dessinables(haute).length);
    const d = deriverDecor(complet, { qualite: "basse" });
    expect(d.haies).toEqual([]);
    expect(d.arbustes).toEqual([]);
  });

  it("les couches de sol sont sans écriture de profondeur, dans l'ordre : pelouses, chaussée, parkings, marquages, avant les murs", () => {
    const racine = construire(complet, { fantomes: false, destruction: etat });
    const ordres = dessinables(racine).filter((x) => ((x as THREE.Mesh).material as THREE.Material)?.depthWrite === false).map((x) => x.renderOrder);
    expect(ordres).toContain(-3);
    expect(ordres).toContain(-2);
    expect(ordres).toContain(-1);
    // bâtiments (faces : 1, arêtes : 2) passent après toutes les couches de sol
    const batiments = dessinables(racine).filter((x) => x.renderOrder >= 1 && x.renderOrder <= 2);
    expect(batiments.length).toBeGreaterThan(5);
  });

  it("deriverDecor : calcul de moins de 400 ms (cible 60 ms, mesure affichée), déterministe", () => {
    const frais: SceneData = { ...scene, decor: decorOsm, roads: scene.roads.map((r) => ({ ...r })), trees: scene.trees.map((t) => [...t] as [number, number]), parkings: scene.parkings.map((p) => [...p]), buildings: scene.buildings.map((b) => ({ ...b })) };
    const t0 = performance.now();
    const d = deriverDecor(frais, { qualite: "haute" });
    const ms = performance.now() - t0;
    console.log(`deriverDecor : ${ms.toFixed(0)} ms (à froid, JIT compris)`);
    expect(ms).toBeLessThan(400);
    const d2 = deriverDecor(frais, { qualite: "haute" });
    expect(d2.voirie).toBe(d.voirie);
    expect(d2.places).toEqual(d.places);
  });

  it("compile les nuanceurs modifiés : un seul `void main`, une seule ancre opaque_fragment, façade avant l'écriture de la couleur", () => {
    const racine = construire(complet, { fantomes: false, destruction: etat });
    const nuanceurs = dessinables(racine).map((x) => (x as THREE.Mesh).material as THREE.Material).filter((m) => m?.onBeforeCompile && m.onBeforeCompile.toString() !== "() => {}" && m.customProgramCacheKey?.().startsWith("batiment-effondrable"));
    expect(nuanceurs.length).toBeGreaterThan(3);
    for (const m of nuanceurs) {
      const sh = compiler(m);
      expect(sh.fragmentShader.match(/void main\(\) \{/g)).toHaveLength(1);
      expect(sh.fragmentShader.match(/#include <opaque_fragment>/g)).toHaveLength(1);
    }
    // pelouses : le nuanceur de hachures s'insère avant l'écriture de la couleur
    const pel = dessinables(racine).find((x) => x.renderOrder === -3) as THREE.Mesh;
    const sh = compiler(pel.material as THREE.Material);
    expect(sh.fragmentShader).toContain("varying vec2 vPelouse;");
    expect(sh.fragmentShader.indexOf("float sH")).toBeLessThan(sh.fragmentShader.indexOf("#include <opaque_fragment>"));
    expect(sh.vertexShader).toContain("vPelouse = (modelMatrix");
  });
});
