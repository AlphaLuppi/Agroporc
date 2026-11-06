/**
 * Rocket Muche, rendu du stade (three) : sol, lignes, murs hexagonaux, plafond, buts, plots de boost, gradins, public, Truck Muche et son
 * tableau d'affichage. Tout est statique sauf les plots, le public en fête, la pulsation lumineuse des murs et le tableau : une image ne
 * recalcule que cela. Géométrie et couleurs viennent de `rendu-modele.ts` (pur, testé) ; ce module ne fait que les poser dans three.
 *
 * Draw calls (haute qualité) : sol 1, lignes 1, remplissage des murs 1, hexagones 1, buts 3 (tubes, filets, lueurs), plots 4, gradins 2,
 * public 1, Truck 3, tableau 1 = 18 ; en basse qualité ni public ni Truck ni tableau : 14.
 * Convention du bloom de la vue Palantir : décors sous 0,24 de luminosité, seuls équipes, plots actifs, balle et lignes la dépassent.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { creerModeleTruckMuche, type ModeleTruckMuche } from "../fps/rendu-monde";
import { PLOTS, STADE, type Equipe, type MondeRocket } from "./contrat";
import {
  LUM, PALETTE, PROFIL, RAYON_ANNEAU, SPHERE_GROS, ajusterLuminance, construireNappe, couleurEquipe, couleurMur, couleurPlot, couleurSol,
  creerContour, disposerGradins, echelleSpherePlot, eventail, fusionnerNappes, geometrieCage, grilleContour, grilleProfil, lignesTerrain,
  melangeRgb, mulRgb, placesPublic, polygonePlat, pulsationBut, rgbLineaire, sautPublic, segmentsHexCoque, segmentsHexPlafond, solCage, texteTableau,
  visuelPlot, type Nappe, type RGB, type TierGradin,
} from "./rendu-modele";

/** Ordres de dessin : le sol passe après les couches de sol d'Agroparc (−3…0), avant les bâtiments filaires (voitures à 5 et 6). */
const ORDRE = { sol: 3, lignes: 4, remplissage: 5, hexagones: 6, buts: 6, plots: 6, gradins: 5 } as const;
/** Position du Truck Muche (repère local) : derrière les gradins du mur est, flanc du passe-plat tourné vers le terrain. */
const POS_TRUCK: readonly [number, number] = [STADE.demiLargeur + 12.6, 0];

export interface OptionsStade {
  qualite: "haute" | "basse";
  mouvementReduit: boolean;
  nomsEquipes: Record<Equipe, string>;
}
export interface StadeRendu {
  readonly groupe: THREE.Group;
  /** anime les plots d'après `m.plots`, le public, la pulsation des murs et le tableau d'affichage */
  maj(m: Readonly<MondeRocket>, dt: number): void;
  /** un but vient d'être marqué par `equipe` : pulsation des murs et public en fête */
  but(equipe: Equipe): void;
  dispose(): void;
}

function geoDepuisNappe(n: Nappe): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(n.positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(n.couleurs, 3));
  g.setIndex(n.indices);
  return g;
}
const att = (a: number[] | Float32Array): THREE.Float32BufferAttribute => new THREE.Float32BufferAttribute(a, 3);

/** Colorie un tableau de positions (xyz à plat) avec `f(x, y, z)`. */
function couleursPar(positions: readonly number[], f: (x: number, y: number, z: number) => RGB): number[] {
  const res: number[] = new Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const c = f(positions[i], positions[i + 1], positions[i + 2]);
    res[i] = c[0]; res[i + 1] = c[1]; res[i + 2] = c[2];
  }
  return res;
}

/** Cylindre entre deux points, géométrie sans normales ni UV, coloré par sommet. */
function tube(a: readonly number[], b: readonly number[], rayon: number, couleur: RGB): THREE.BufferGeometry {
  const av = new THREE.Vector3(a[0], a[1], a[2]), bv = new THREE.Vector3(b[0], b[1], b[2]);
  const dir = bv.clone().sub(av), long = dir.length();
  const g = new THREE.CylinderGeometry(rayon, rayon, long, 8, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate((av.x + bv.x) / 2, (av.y + bv.y) / 2, (av.z + bv.z) / 2);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = couleur[0]; col[i * 3 + 1] = couleur[1]; col[i * 3 + 2] = couleur[2]; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/** Texture du tableau d'affichage du Truck Muche (null sans DOM). */
function creerTableau(): { mesh: THREE.Mesh; maj(texte: string): void; dispose(): void } | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = 640; cv.height = 320;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 3.1), mat);
  mesh.renderOrder = ORDRE.buts;
  let dernier = "";
  const ambre = "#" + PALETTE.ambre.toString(16).padStart(6, "0");
  return {
    mesh,
    maj(texte) {
      if (texte === dernier) return;
      dernier = texte;
      ctx.clearRect(0, 0, cv.width, cv.height);
      // panneau haut (cadre et fond sombre), pieds en bas
      ctx.fillStyle = "rgba(4,10,14,0.88)";
      ctx.fillRect(10, 10, 620, 190);
      ctx.strokeStyle = ambre; ctx.lineWidth = 6;
      ctx.strokeRect(10, 10, 620, 190);
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(150, 200); ctx.lineTo(150, 320); ctx.moveTo(490, 200); ctx.lineTo(490, 320); ctx.stroke();
      ctx.fillStyle = ambre;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "700 56px monospace";
      ctx.fillText(texte, 320, 105, 590);
      tex.needsUpdate = true;
    },
    dispose() { mesh.geometry.dispose(); mat.dispose(); tex.dispose(); },
  };
}

export function creerStade(m: Readonly<MondeRocket>, opts: OptionsStade): StadeRendu {
  const groupe = new THREE.Group();
  groupe.name = "stade";
  const haute = opts.qualite === "haute";
  const aLiberer: { dispose(): void }[] = [];
  const garder = <T extends { dispose(): void }>(o: T): T => { aLiberer.push(o); return o; };

  const contour = creerContour();
  const us = grilleContour(contour, 1.5), vs = grilleProfil();
  const polyTout = polygonePlat(0);

  // ---------- sol : demi-terrains teintés, fonds de cage, raccords de sol ----------
  const sol = fusionnerNappes([
    eventail(polygonePlat(-1), 0, couleurSol),
    eventail(polygonePlat(1), 0, couleurSol),
    solCage(-1, couleurSol),
    solCage(1, couleurSol),
    construireNappe(contour, us, vs, 0, PROFIL.quart, (x, _y, z) => couleurSol(x, z)),
  ]);
  const matSol = garder(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  const meshSol = new THREE.Mesh(garder(geoDepuisNappe(sol)), matSol);
  meshSol.renderOrder = ORDRE.sol;
  groupe.add(meshSol);

  // ---------- lignes blanches ----------
  const lignes = lignesTerrain();
  const gLignes = garder(new THREE.BufferGeometry());
  gLignes.setAttribute("position", att(lignes.positions));
  gLignes.setIndex(lignes.indices);
  const matLignes = garder(new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(...ajusterLuminance(rgbLineaire(PALETTE.blanc), 0.55)), side: THREE.DoubleSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  const meshLignes = new THREE.Mesh(gLignes, matLignes);
  meshLignes.renderOrder = ORDRE.lignes;
  groupe.add(meshLignes);

  // ---------- murs : remplissage translucide (murs + raccord de plafond + plafond) ----------
  const facteurFond = LUM.remplissage / LUM.mur;
  const murs = fusionnerNappes([
    construireNappe(contour, us, vs, PROFIL.quart, PROFIL.longueur, (x, y, z) => mulRgb(couleurMur(x, y, z), facteurFond)),
    eventail(polyTout, STADE.hauteur, (x, z) => mulRgb(couleurMur(x, STADE.hauteur, z), facteurFond * 0.6)),
  ]);
  const matMurs = garder(new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  const meshMurs = new THREE.Mesh(garder(geoDepuisNappe(murs)), matMurs);
  meshMurs.renderOrder = ORDRE.remplissage;
  groupe.add(meshMurs);

  // ---------- murs : réseau hexagonal + plafond ----------
  const hexCoque = segmentsHexCoque(contour, 1.7, 0.5);
  const hexPlafond = segmentsHexPlafond(1.7);
  const hexPos = new Float32Array(hexCoque.length + hexPlafond.length);
  hexPos.set(hexCoque, 0); hexPos.set(hexPlafond, hexCoque.length);
  const hexCol = new Float32Array(hexPos.length);
  for (let i = 0; i < hexPos.length; i += 3) {
    let c = couleurMur(hexPos[i], hexPos[i + 1], hexPos[i + 2]);
    if (i >= hexCoque.length) c = mulRgb(c, LUM.plafond / LUM.mur);
    hexCol[i] = c[0]; hexCol[i + 1] = c[1]; hexCol[i + 2] = c[2];
  }
  const gHex = garder(new THREE.BufferGeometry());
  gHex.setAttribute("position", new THREE.BufferAttribute(hexPos, 3));
  gHex.setAttribute("color", new THREE.BufferAttribute(hexCol, 3));
  const matHex = garder(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const lineHex = new THREE.LineSegments(gHex, matHex);
  lineHex.renderOrder = ORDRE.hexagones;
  lineHex.frustumCulled = false;
  groupe.add(lineHex);

  // ---------- buts : tubes, filets, lueurs ----------
  const tubes: THREE.BufferGeometry[] = [];
  const filetPos: number[] = [], filetCol: number[] = [];
  const lueurPos: number[] = [], lueurCol: number[] = [], lueurIdx: number[] = [];
  const pasFilet = haute ? 0.6 : 1.5;
  for (const eq of ["bleue", "orange"] as const) {
    const cage = geometrieCage(eq, pasFilet);
    const cEq = couleurEquipe(eq);
    const cTube = ajusterLuminance(cEq, 1.1);
    for (const t of cage.tubes) tubes.push(tube(t.a, t.b, t.rayon, t.rayon > 0.1 ? cTube : mulRgb(cTube, 0.5)));
    const cFilet = ajusterLuminance(cEq, 0.28);
    for (let i = 0; i < cage.filet.length; i += 3) { filetPos.push(cage.filet[i], cage.filet[i + 1], cage.filet[i + 2]); filetCol.push(cFilet[0], cFilet[1], cFilet[2]); }
    for (const q of cage.quads) {
      const base = lueurPos.length / 3;
      const c = mulRgb(ajusterLuminance(cEq, 0.4), q.intensite);
      for (const p of q.coins) { lueurPos.push(p[0], p[1], p[2]); lueurCol.push(c[0], c[1], c[2]); }
      lueurIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const gTubes = garder(mergeGeometries(tubes, false));
  for (const t of tubes) t.dispose();
  const meshTubes = new THREE.Mesh(gTubes, garder(new THREE.MeshBasicMaterial({ vertexColors: true })));
  meshTubes.renderOrder = ORDRE.buts;
  groupe.add(meshTubes);
  const gFilet = garder(new THREE.BufferGeometry());
  gFilet.setAttribute("position", att(filetPos)); gFilet.setAttribute("color", att(filetCol));
  const lineFilet = new THREE.LineSegments(gFilet, garder(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  lineFilet.renderOrder = ORDRE.buts;
  groupe.add(lineFilet);
  const gLueur = garder(new THREE.BufferGeometry());
  gLueur.setAttribute("position", att(lueurPos)); gLueur.setAttribute("color", att(lueurCol)); gLueur.setIndex(lueurIdx);
  const matLueur = garder(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const meshLueur = new THREE.Mesh(gLueur, matLueur);
  meshLueur.renderOrder = ORDRE.buts;
  groupe.add(meshLueur);

  // ---------- plots de boost : anneaux, disques de recharge, sphères et colonnes des gros ----------
  const nPlots = PLOTS.length;
  const gAnneau = garder(new THREE.RingGeometry(0.82, 1, 24));
  gAnneau.rotateX(-Math.PI / 2);
  const gDisque = garder(new THREE.CircleGeometry(0.78, 6));
  gDisque.rotateX(-Math.PI / 2);
  const matPlot = () => garder(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const anneaux = new THREE.InstancedMesh(gAnneau, matPlot(), nPlots);
  const disques = new THREE.InstancedMesh(gDisque, matPlot(), nPlots);
  const gros = PLOTS.filter((p) => p.gros);
  const gSphere = garder(new THREE.SphereGeometry(SPHERE_GROS.rayon, 10, 7));
  const sphere = new THREE.InstancedMesh(gSphere, garder(new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })), gros.length);
  const gColonne = garder(new THREE.CylinderGeometry(1, 1, 7, 12, 1, true));
  gColonne.translate(0, 3.5, 0);
  const colonne = new THREE.InstancedMesh(gColonne, garder(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })), gros.length);
  for (const im of [anneaux, disques, sphere, colonne]) {
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    im.renderOrder = ORDRE.plots;
    groupe.add(im);
  }
  const rgbT = new THREE.Color(), mat4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quatId = new THREE.Quaternion(), ech = new THREE.Vector3();
  const quatTour = new THREE.Quaternion(), axeY = new THREE.Vector3(0, 1, 0);
  const dernierEtat: number[] = new Array(nPlots).fill(-1);
  const majPlots = (m2: Readonly<MondeRocket>, temps: number) => {
    let ig = 0;
    for (let i = 0; i < nPlots; i++) {
      const def = PLOTS[i];
      const est = m2.plots[i];
      if (!est) continue;
      const v = visuelPlot(est, def.gros);
      const rayon = def.gros ? RAYON_ANNEAU.gros : RAYON_ANNEAU.petit;
      pos.set(def.x, 0.03, def.z);
      ech.set(rayon, 1, rayon);
      anneaux.setMatrixAt(i, mat4.compose(pos, quatId, ech));
      const e = Math.max(0.001, v.remplissage * (v.actif ? 1 : 0.95));
      pos.set(def.x, 0.035, def.z);
      ech.set(rayon * e, 1, rayon * e);
      disques.setMatrixAt(i, mat4.compose(pos, quatId, ech));
      const cle = (v.actif ? 1000 : 0) + Math.round(v.remplissage * 20);
      const change = cle !== dernierEtat[i];
      if (change) {
        dernierEtat[i] = cle;
        const c = couleurPlot(def.gros, v.actif);
        anneaux.setColorAt(i, rgbT.setRGB(c[0], c[1], c[2]));
        const cd = v.actif ? c : melangeRgb(couleurPlot(def.gros, false), mulRgb(couleurPlot(def.gros, true), 0.5), v.remplissage);
        disques.setColorAt(i, rgbT.setRGB(cd[0], cd[1], cd[2]));
        if (anneaux.instanceColor) anneaux.instanceColor.needsUpdate = true;
        if (disques.instanceColor) disques.instanceColor.needsUpdate = true;
      }
      if (def.gros) {
        const s = echelleSpherePlot(v);
        const bob = SPHERE_GROS.hauteur + Math.sin(temps * 2.2 + i) * SPHERE_GROS.amplitude;
        pos.set(def.x, bob, def.z);
        const sc = Math.max(0.0001, s);
        ech.set(sc, sc, sc);
        quatTour.setFromAxisAngle(axeY, temps * 0.8 + i);
        sphere.setMatrixAt(ig, mat4.compose(pos, quatTour, ech));
        pos.set(def.x, 0, def.z);
        ech.set(rayon * 0.9, Math.max(0.0001, s), rayon * 0.9);
        colonne.setMatrixAt(ig, mat4.compose(pos, quatId, ech));
        if (change) {
          const c = couleurPlot(true, v.actif);
          sphere.setColorAt(ig, rgbT.setRGB(c[0], c[1], c[2]));
          colonne.setColorAt(ig, rgbT.setRGB(c[0] * 0.35, c[1] * 0.35, c[2] * 0.35));
        }
        ig++;
      }
    }
    anneaux.instanceMatrix.needsUpdate = true;
    disques.instanceMatrix.needsUpdate = true;
    sphere.instanceMatrix.needsUpdate = true;
    colonne.instanceMatrix.needsUpdate = true;
    if (sphere.instanceColor) sphere.instanceColor.needsUpdate = true;
    if (colonne.instanceColor) colonne.instanceColor.needsUpdate = true;
  };

  // ---------- gradins et public ----------
  const tiers: TierGradin[] = disposerGradins(contour);
  const boites: THREE.BufferGeometry[] = [];
  for (const t of tiers) {
    const g = new THREE.BoxGeometry(t.profondeur, t.hauteur, t.longueur);
    g.rotateY(t.cap);
    g.translate(t.centre[0], t.hauteur / 2, t.centre[1]);
    g.deleteAttribute("normal"); g.deleteAttribute("uv");
    boites.push(g);
  }
  const gGradins = garder(mergeGeometries(boites, false));
  for (const g of boites) g.dispose();
  const cGradin = ajusterLuminance(rgbLineaire(PALETTE.cyan), LUM.gradin);
  const meshGradins = new THREE.Mesh(gGradins, garder(new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(...mulRgb(cGradin, 0.12)), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
  })));
  meshGradins.renderOrder = ORDRE.gradins;
  groupe.add(meshGradins);
  const gAretes = garder(new THREE.EdgesGeometry(gGradins, 20));
  const lineGradins = new THREE.LineSegments(gAretes, garder(new THREE.LineBasicMaterial({ color: new THREE.Color().setRGB(...cGradin) })));
  lineGradins.renderOrder = ORDRE.gradins + 1;
  groupe.add(lineGradins);

  const places = haute ? placesPublic(tiers) : [];
  let publicIM: THREE.InstancedMesh | null = null;
  if (places.length > 0) {
    const gP = garder(new THREE.BoxGeometry(0.45, 0.9, 0.35));
    gP.translate(0, 0.45, 0);
    publicIM = new THREE.InstancedMesh(gP, garder(new THREE.MeshBasicMaterial({ color: 0xffffff })), places.length);
    publicIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    publicIM.frustumCulled = false;
    publicIM.renderOrder = ORDRE.gradins + 1;
    places.forEach((p, i) => {
      const c = p.neutre ? ajusterLuminance(rgbLineaire(PALETTE.cyan), LUM.public * 0.5) : ajusterLuminance(couleurEquipe(p.equipe), LUM.public);
      publicIM!.setColorAt(i, rgbT.setRGB(c[0], c[1], c[2]));
    });
    groupe.add(publicIM);
  }
  const placerPublic = (temps: number, k: number) => {
    if (!publicIM) return;
    places.forEach((p, i) => {
      pos.set(p.x, p.y + sautPublic(p.phase, temps, k), p.z);
      ech.set(1, 1, 1);
      publicIM!.setMatrixAt(i, mat4.compose(pos, quatId, ech));
    });
    publicIM.instanceMatrix.needsUpdate = true;
  };
  placerPublic(0, 0);

  // ---------- Truck Muche garé : tableau d'affichage du score ----------
  let truck: ModeleTruckMuche | null = null;
  let tableau: ReturnType<typeof creerTableau> = null;
  if (haute) {
    truck = creerModeleTruckMuche({ enseigne: true });
    truck.group.position.set(POS_TRUCK[0], 0, POS_TRUCK[1]);
    truck.group.rotation.y = Math.PI; // le passe-plat (+x du modèle) regarde le terrain (−x local)
    groupe.add(truck.group);
    tableau = creerTableau();
    if (tableau) {
      tableau.mesh.position.set(POS_TRUCK[0], 3.2 + 1.55, POS_TRUCK[1]);
      tableau.mesh.rotation.y = -Math.PI / 2;
      groupe.add(tableau.mesh);
    }
  }

  // ---------- animation ----------
  let temps = 0;
  let depuisBut = Infinity;
  let fete = 0;
  let publicRepos = true;
  const scoreAffiche = { b: -1, o: -1 };

  return {
    groupe,
    but(_equipe) {
      depuisBut = 0;
      fete = opts.mouvementReduit ? 0 : 1;
    },
    maj(m2, dt) {
      temps += dt;
      majPlots(m2, temps);
      if (depuisBut !== Infinity) {
        depuisBut += dt;
        const p = pulsationBut(depuisBut, opts.mouvementReduit);
        matHex.color.setScalar(1 + 4 * Math.max(0, p));
        matLueur.color.setScalar(1 + 1.5 * Math.max(0, p));
        if (depuisBut > 5) { depuisBut = Infinity; matHex.color.setScalar(1); matLueur.color.setScalar(1); }
      }
      if (fete > 0) {
        fete = Math.max(0, fete - dt / 4.5);
        placerPublic(temps, fete);
        publicRepos = false;
      } else if (!publicRepos) {
        placerPublic(0, 0);
        publicRepos = true;
      }
      if (tableau && (scoreAffiche.b !== m2.score.bleue || scoreAffiche.o !== m2.score.orange)) {
        scoreAffiche.b = m2.score.bleue; scoreAffiche.o = m2.score.orange;
        tableau.maj(texteTableau(opts.nomsEquipes, m2.score));
      }
    },
    dispose() {
      for (const o of aLiberer) o.dispose();
      for (const im of [anneaux, disques, sphere, colonne, publicIM]) im?.dispose();
      truck?.dispose();
      tableau?.dispose();
      groupe.clear();
      groupe.removeFromParent();
    },
  };
}
