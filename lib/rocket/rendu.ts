/**
 * Rocket Muche, rendu (three) : assemble le stade (`rendu-stade.ts`), les voitures, la balle et les effets (`rendu-effets.ts`) sous une
 * RACINE posée sur Agroparc (position `SITE.centre`, rotation `SITE.cap`, hauteur `SITE.hauteurSol`) : tout le contenu et la caméra du jeu
 * sont en repère LOCAL du stade. Chargé uniquement par `jeu.ts` (import dynamique) : three n'entre pas dans le premier chargement du menu.
 *
 * Style filaire de la vue Palantir : faces sombres qui masquent les arêtes cachées + arêtes lumineuses (`rendu-filaire.ts`), couleur d'équipe
 * au-dessus du seuil du bloom (0,24), décors dessous. Voitures : une silhouette d'Octane (profil extrudé + aileron), quatre roues qui tournent
 * et se braquent (un seul `LineSegments` dynamique par voiture), flamme de boost (un `InstancedMesh` pour toutes), traînée supersonique.
 * Balle : motif de Goldberg (hexagones + pentagones) dont l'orientation est intégrée ICI depuis `balle.w` (la physique ne la garde pas),
 * noyau lumineux, traînée de la dernière équipe qui l'a touchée, ombre-repère au sol.
 *
 * Budget de dessin (6 voitures, haute qualité) : stade 18 + voitures 6 × 4 + flammes 1 + traînées 2 + balle 4 + effets 4 (2 réserves de
 * particules, anneaux, traces de pneus) = 53 ≤ 60 (testé par `compterAppels`).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ORDRE_BASE, creerMateriaux, enPiece, libererMateriaux, libererPiece, type GeoPiece, type Materiaux } from "../fps/rendu-filaire";
import { creerTracesPneus, type TracesPneus } from "../fps/rendu-traces";
import {
  BALLE, PLOTS, SITE, VOITURE,
  type EtatVoiture, type EvenementMatch, type MondeRocket, type OptionsRendu, type RenduRocket,
} from "./contrat";
import { creerEffets, creerTrainees, type Effets, type Trainees } from "./rendu-effets";
import {
  ECHAPPEMENT_OCTANE, FLOATS_ROUE, GABARITS, LARGEUR_OCTANE, PALETTE, PIECES_OCTANE, PROFIL_OCTANE,
  ajusterLuminance, avancerRoulement, braquageRoues, couleurBalle, couleurEquipe, directionsFibonacci, integrerQuat, interpolerPosition, intensiteChoc,
  intensiteTrainee, nombreParticules, ombreBalle, rgbLineaire, segmentsMotifBalle, segmentsRoue, versThree, melangeRgb, mulRgb,
  type Quat, type RGB, type TypeEffet,
} from "./rendu-modele";
import { creerStade, type StadeRendu } from "./rendu-stade";
import type { Base, Vec3 } from "./vec";

/** Appels de dessin visibles sous `o` (mailles, lignes, points, sprites) : le budget des tests (≤ 60). */
export function compterAppels(o: THREE.Object3D): number {
  let n = 0;
  o.traverseVisible((x) => {
    const t = x as THREE.Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
    if (t.isMesh || t.isLine || t.isPoints || t.isSprite) n++;
  });
  return n;
}

const HAUT: Vec3 = [0, 1, 0];
const DUREE_APPARITION_S = 0.35;
/** Distance (m) à l'humain en deçà de laquelle une plaque de nom est affichée. */
const PORTEE_PLAQUE_M = 60;

interface VoitureRendu {
  groupe: THREE.Group;
  roues: THREE.LineSegments;
  tamponRoues: Float32Array;
  roulement: number[];
  braquage: number;
  apparition: number;
  flamme: number;
  superson: number;
  plaque: THREE.Sprite | null;
  plaqueTex: THREE.Texture | null;
  plaqueMat: THREE.SpriteMaterial | null;
  quatPrec: THREE.Quaternion;
  quatCour: THREE.Quaternion;
  /** dernière position (pour détecter une téléportation et couper les traînées) */
  derniere: Vec3;
}

/** Quaternion d'une base de voiture : colonnes (x = -droite, y = haut, z = avant) du repère three du modèle. */
function quatDeBase(b: Readonly<Base>, q: THREE.Quaternion, m4: THREE.Matrix4, a: THREE.Vector3, h: THREE.Vector3, f: THREE.Vector3): THREE.Quaternion {
  a.set(-b.droite[0], -b.droite[1], -b.droite[2]);
  h.set(b.haut[0], b.haut[1], b.haut[2]);
  f.set(b.avant[0], b.avant[1], b.avant[2]);
  m4.makeBasis(a, h, f);
  return q.setFromRotationMatrix(m4);
}

/** Position monde (repère local du stade) d'un point [avant, droite, haut] de la voiture. */
function pointVoiture(v: Readonly<EtatVoiture>, a: number, d: number, h: number): Vec3 {
  const b = v.base;
  return [
    v.p[0] + b.avant[0] * a + b.droite[0] * d + b.haut[0] * h,
    v.p[1] + b.avant[1] * a + b.droite[1] * d + b.haut[1] * h,
    v.p[2] + b.avant[2] * a + b.droite[2] * d + b.haut[2] * h,
  ];
}
function centreVoiture(v: Readonly<EtatVoiture>): Vec3 {
  return pointVoiture(v, VOITURE.decalageHitbox[0], VOITURE.decalageHitbox[1], VOITURE.decalageHitbox[2]);
}

/** Géométrie de la carrosserie : profil latéral extrudé sur la largeur + aileron et supports, en repère three du modèle. */
function geometrieCarrosserie(): THREE.BufferGeometry {
  const forme = new THREE.Shape(PROFIL_OCTANE.map(([a, h]) => new THREE.Vector2(a, h)));
  const corps = new THREE.ExtrudeGeometry(forme, { depth: LARGEUR_OCTANE, bevelEnabled: false, curveSegments: 1 });
  // (a, h, ez) → (x = largeur/2 − ez, y = h, z = a) : rotation propre (déterminant +1)
  corps.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, LARGEUR_OCTANE / 2, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  const morceaux: THREE.BufferGeometry[] = [corps.index ? corps.toNonIndexed() : corps];
  for (const p of PIECES_OCTANE) {
    const g = new THREE.BoxGeometry(p.t[1], p.t[2], p.t[0]).toNonIndexed();
    const c = versThree(p.c[0], p.c[1], p.c[2]);
    g.translate(c[0], c[1], c[2]);
    morceaux.push(g);
  }
  for (const g of morceaux) { g.deleteAttribute("normal"); g.deleteAttribute("uv"); for (const nom of Object.keys(g.attributes)) if (nom !== "position") g.deleteAttribute(nom); }
  const fusion = mergeGeometries(morceaux, false);
  for (const g of morceaux) g.dispose();
  if (corps !== morceaux[0]) corps.dispose();
  if (!fusion) throw new Error("rendu : fusion de la carrosserie impossible");
  return fusion;
}

/** Plaque de nom (texture canvas) : null hors navigateur. */
function creerPlaque(nom: string, couleur: RGB): { tex: THREE.CanvasTexture; ratio: number } | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const c = new THREE.Color().setRGB(couleur[0], couleur[1], couleur[2]);
  ctx.font = `700 34px "Chakra Petch", "IBM Plex Mono", ui-monospace, system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(4,8,12,0.55)";
  ctx.fillRect(0, 8, 256, 48);
  ctx.fillStyle = `#${c.getHexString()}`;
  ctx.fillText(nom, 128, 33, 240);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, ratio: 256 / 64 };
}

export function creerRenduRocket(m: Readonly<MondeRocket>, opts: OptionsRendu): RenduRocket {
  const racine = new THREE.Group();
  racine.name = "rocket";
  racine.position.set(SITE.centre[0], SITE.hauteurSol, SITE.centre[1]);
  racine.rotation.y = SITE.cap;

  const haute = opts.qualite === "haute";
  const aLiberer: { dispose(): void }[] = [];
  const garder = <T extends { dispose(): void }>(o: T): T => { aLiberer.push(o); return o; };

  const stade: StadeRendu = creerStade(m, { qualite: opts.qualite, mouvementReduit: opts.mouvementReduit, nomsEquipes: opts.nomsEquipes });
  racine.add(stade.groupe);
  const effets: Effets = creerEffets(racine);
  // les traces de pneus attendent une `Scene` mais n'appellent que add / remove : la racine (repère local) convient
  const traces: TracesPneus = creerTracesPneus(racine as unknown as THREE.Scene);

  // ---------- voitures ----------
  const piece: GeoPiece = enPiece(geometrieCarrosserie());
  const mats: Record<"bleue" | "orange", Materiaux> = {
    bleue: creerMateriaux(new THREE.Color().setRGB(...couleurEquipe("bleue"))),
    orange: creerMateriaux(new THREE.Color().setRGB(...couleurEquipe("orange"))),
  };
  const matsRoues = {
    bleue: garder(new THREE.LineBasicMaterial({ color: new THREE.Color().setRGB(...mulRgb(couleurEquipe("bleue"), 0.85)) })),
    orange: garder(new THREE.LineBasicMaterial({ color: new THREE.Color().setRGB(...mulRgb(couleurEquipe("orange"), 0.85)) })),
  };
  const nV = m.voitures.length;
  const voitures: VoitureRendu[] = [];
  const humaine = m.idHumain;
  for (const v of m.voitures) {
    const groupe = new THREE.Group();
    const faces = new THREE.Mesh(piece.geo, mats[v.equipe].fond);
    const aretes = new THREE.LineSegments(piece.aretes, mats[v.equipe].ligne);
    faces.renderOrder = ORDRE_BASE;
    aretes.renderOrder = ORDRE_BASE + 1;
    const tamponRoues = new Float32Array(FLOATS_ROUE * 4);
    const geoRoues = garder(new THREE.BufferGeometry());
    const attRoues = new THREE.BufferAttribute(tamponRoues, 3);
    attRoues.setUsage(THREE.DynamicDrawUsage);
    geoRoues.setAttribute("position", attRoues);
    const roues = new THREE.LineSegments(geoRoues, matsRoues[v.equipe]);
    roues.renderOrder = ORDRE_BASE + 1;
    roues.frustumCulled = false;
    groupe.add(faces, aretes, roues);
    racine.add(groupe);
    let plaque: THREE.Sprite | null = null, plaqueTex: THREE.Texture | null = null, plaqueMat: THREE.SpriteMaterial | null = null;
    if (v.id !== humaine) {
      const p = creerPlaque(v.nom, ajusterLuminance(couleurEquipe(v.equipe), 0.8));
      plaqueMat = new THREE.SpriteMaterial({
        map: p?.tex ?? null, transparent: true, depthWrite: false, depthTest: v.equipe !== m.voitures[humaine]?.equipe, fog: false, toneMapped: false,
      });
      plaqueTex = p?.tex ?? null;
      plaque = new THREE.Sprite(plaqueMat);
      plaque.scale.set(2.6, 0.65, 1);
      plaque.renderOrder = 9;
      racine.add(plaque);
    }
    voitures.push({
      groupe, roues, tamponRoues, roulement: [0, 0, 0, 0], braquage: 0, apparition: 1, flamme: 0, superson: 0,
      plaque, plaqueTex, plaqueMat, quatPrec: new THREE.Quaternion(), quatCour: new THREE.Quaternion(), derniere: [v.p[0], v.p[1], v.p[2]],
    });
  }

  // flammes : un InstancedMesh pour toutes les voitures
  const geoFlamme = garder(new THREE.ConeGeometry(0.16, 1, 8, 1, true));
  geoFlamme.translate(0, 0.5, 0);
  geoFlamme.rotateX(-Math.PI / 2); // la pointe part vers l'arrière (−Z du modèle)
  const flammes = new THREE.InstancedMesh(
    geoFlamme,
    garder(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
    Math.max(1, nV),
  );
  flammes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flammes.frustumCulled = false;
  flammes.renderOrder = 8;
  const colFlamme = (eq: "bleue" | "orange") => ajusterLuminance(melangeRgb(couleurEquipe(eq), rgbLineaire(PALETTE.blanc), 0.35), 1.1);
  m.voitures.forEach((v, i) => { const c = colFlamme(v.equipe); flammes.setColorAt(i, new THREE.Color().setRGB(c[0], c[1], c[2])); });
  racine.add(flammes);

  const traineesVoitures: Trainees = creerTrainees(racine, Math.max(1, nV), 2, 14);
  const traineeBalle: Trainees = creerTrainees(racine, 1, 1, 22);

  // ---------- balle ----------
  const motif = new Float32Array(segmentsMotifBalle(BALLE.rayonVisuel));
  const geoMotif = garder(new THREE.BufferGeometry());
  geoMotif.setAttribute("position", new THREE.BufferAttribute(motif, 3));
  const matMotif = garder(new THREE.LineBasicMaterial({ color: new THREE.Color().setRGB(...couleurBalle(null)) }));
  const lignesBalle = new THREE.LineSegments(geoMotif, matMotif);
  lignesBalle.renderOrder = 7;
  const geoNoyau = garder(new THREE.IcosahedronGeometry(BALLE.rayonVisuel * 0.55, 1));
  const matNoyau = garder(new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...couleurBalle(null)), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  const noyau = new THREE.Mesh(geoNoyau, matNoyau);
  noyau.renderOrder = 7;
  const balle = new THREE.Group();
  balle.add(lignesBalle, noyau);
  racine.add(balle);
  let qBalle: Quat = [0, 0, 0, 1];
  const geoOmbre = garder(new THREE.RingGeometry(0.72, 1, 40));
  geoOmbre.rotateX(-Math.PI / 2);
  const matOmbre = garder(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  const ombre = new THREE.Mesh(geoOmbre, matOmbre);
  ombre.renderOrder = 4;
  racine.add(ombre);
  let derniereBalle: Vec3 = [m.balle.p[0], m.balle.p[1], m.balle.p[2]];
  let equipeBalle: "bleue" | "orange" | null = null;

  // ---------- temporaires ----------
  const m4 = new THREE.Matrix4(), m4b = new THREE.Matrix4(), mLoc = new THREE.Matrix4(), pos3 = new THREE.Vector3(), ech3 = new THREE.Vector3(), v3a = new THREE.Vector3(), v3b = new THREE.Vector3(), v3c = new THREE.Vector3();
  const quatId = new THREE.Quaternion(), axeY = new THREE.Vector3(0, 1, 0);
  const pTmp: Vec3 = [0, 0, 0];
  let tempsFlamme = 0;
  const vecA: Vec3 = [0, 0, 0];
  const coinG: Vec3 = [0, 0, 0], coinD: Vec3 = [0, 0, 0];
  const brinsTmp: Vec3[] = [coinG, coinD];

  function synchroniser(mm: Readonly<MondeRocket>, alpha: number, dtImage: number): void {
    tempsFlamme += dtImage;
    const prec = mm.precedent;
    const humain = mm.voitures[mm.idHumain];
    for (let i = 0; i < Math.min(voitures.length, mm.voitures.length); i++) {
      const v = mm.voitures[i], r = voitures[i];
      const pv = prec.voitures[i];
      const vis = !v.demolie;
      r.groupe.visible = vis;
      if (r.plaque) r.plaque.visible = false;
      if (r.apparition < 1) r.apparition = Math.min(1, r.apparition + dtImage / DUREE_APPARITION_S);
      if (!vis) { r.derniere = [v.p[0], v.p[1], v.p[2]]; flammes.setMatrixAt(i, m4.makeScale(0, 0, 0)); continue; }
      // position et orientation interpolées
      const p = interpolerPosition(pv ? pv.p : v.p, v.p, alpha, pTmp);
      if (pv) quatDeBase(pv.base, r.quatPrec, m4, v3a, v3b, v3c); else quatDeBase(v.base, r.quatPrec, m4, v3a, v3b, v3c);
      quatDeBase(v.base, r.quatCour, m4, v3a, v3b, v3c);
      const saut = pv ? Math.hypot(v.p[0] - pv.p[0], v.p[1] - pv.p[1], v.p[2] - pv.p[2]) > 6 : false;
      r.groupe.quaternion.copy(r.quatPrec).slerp(r.quatCour, saut ? 1 : alpha);
      r.groupe.position.set(p[0], p[1], p[2]);
      const e = r.apparition;
      r.groupe.scale.setScalar(e < 1 ? 0.2 + 0.8 * (1 - (1 - e) * (1 - e)) : 1);
      r.groupe.updateMatrix();
      if (Math.hypot(p[0] - r.derniere[0], p[1] - r.derniere[1], p[2] - r.derniere[2]) > 6) traineesVoitures.reinitialiser(i);
      r.derniere = [p[0], p[1], p[2]];

      // roues : roulement selon la vitesse avant, braquage selon le lacet
      const vAvant = v.v[0] * v.base.avant[0] + v.v[1] * v.base.avant[1] + v.v[2] * v.base.avant[2];
      const wHaut = v.w[0] * v.base.haut[0] + v.w[1] * v.base.haut[1] + v.w[2] * v.base.haut[2];
      const cible = braquageRoues(vAvant, wHaut, v.auSol);
      r.braquage += (cible - r.braquage) * (1 - Math.exp(-12 * dtImage));
      for (let w = 0; w < 4; w++) {
        const roue = VOITURE.roues[w];
        r.roulement[w] = avancerRoulement(r.roulement[w], vAvant, dtImage, roue.rayon);
        segmentsRoue(roue.local, roue.rayon, roue.avant ? r.braquage : 0, -r.roulement[w], r.tamponRoues, w * FLOATS_ROUE);
      }
      (r.roues.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

      // flamme du boost
      const cibleFlamme = v.boostActif && v.boost > 0 ? 1 : 0;
      r.flamme += (cibleFlamme - r.flamme) * Math.min(1, dtImage * 20);
      if (r.flamme > 0.03) {
        const long = (1.1 + 0.5 * Math.sin(tempsFlamme * 70 + i * 3) + 0.25 * Math.sin(tempsFlamme * 113 + i)) * r.flamme * (v.supersonique ? 1.3 : 1);
        const large = 0.6 + 0.5 * r.flamme;
        const e0 = versThree(ECHAPPEMENT_OCTANE[0], ECHAPPEMENT_OCTANE[1], ECHAPPEMENT_OCTANE[2]);
        pos3.set(e0[0], e0[1], e0[2]);
        ech3.set(large, large, long);
        mLoc.compose(pos3, quatId, ech3);
        flammes.setMatrixAt(i, m4b.multiplyMatrices(r.groupe.matrix, mLoc));
      } else flammes.setMatrixAt(i, m4.makeScale(0, 0, 0));

      // traînée supersonique : deux brins aux coins arrière
      const cibleSup = v.supersonique ? 1 : 0;
      r.superson += (cibleSup - r.superson) * Math.min(1, dtImage * (cibleSup > r.superson ? 10 : 2.5));
      // coins arrière : la matrice de la pose interpolée donne leurs positions dans le repère du stade
      const cg = versThree(-0.4, -0.38, 0.2), cd = versThree(-0.4, 0.38, 0.2);
      v3a.set(cg[0], cg[1], cg[2]).applyMatrix4(r.groupe.matrix);
      v3b.set(cd[0], cd[1], cd[2]).applyMatrix4(r.groupe.matrix);
      coinG[0] = v3a.x; coinG[1] = v3a.y; coinG[2] = v3a.z;
      coinD[0] = v3b.x; coinD[1] = v3b.y; coinD[2] = v3b.z;
      traineesVoitures.pousser(i, brinsTmp, couleurEquipe(v.equipe), r.superson, dtImage);

      // traces de pneus au sol quand la voiture dérape
      const vl = v.v[0] * v.base.droite[0] + v.v[1] * v.base.droite[1] + v.v[2] * v.base.droite[2];
      const surLeSol = v.auSol && (v.normaleSurface ? v.normaleSurface[1] > 0.9 : true);
      const arriereG = pointVoiture(v, VOITURE.roues[2].local[0], VOITURE.roues[2].local[1], 0);
      const arriereD = pointVoiture(v, VOITURE.roues[3].local[0], VOITURE.roues[3].local[1], 0);
      traces.roues(`v${i}`, [[arriereG[0], arriereG[2]], [arriereD[0], arriereD[2]]], v.derapage && surLeSol && Math.abs(vl) > 3);

      // plaque de nom : pas pour la voiture du joueur, seulement à portée
      if (r.plaque && humain) {
        const d = Math.hypot(p[0] - humain.p[0], p[1] - humain.p[1], p[2] - humain.p[2]);
        r.plaque.visible = d < PORTEE_PLAQUE_M;
        r.plaque.position.set(p[0], p[1] + 1.15, p[2]);
      }
    }
    flammes.instanceMatrix.needsUpdate = true;
    if (flammes.instanceColor) flammes.instanceColor.needsUpdate = true;
    traineesVoitures.maj();

    // balle
    const bp = interpolerPosition(prec.balle.p, mm.balle.p, alpha, pTmp);
    if (Math.hypot(bp[0] - derniereBalle[0], bp[1] - derniereBalle[1], bp[2] - derniereBalle[2]) > 6) traineeBalle.reinitialiser(0);
    derniereBalle = [bp[0], bp[1], bp[2]];
    qBalle = integrerQuat(qBalle, mm.balle.w, dtImage);
    balle.position.set(bp[0], bp[1], bp[2]);
    balle.quaternion.set(qBalle[0], qBalle[1], qBalle[2], qBalle[3]);
    const vit = Math.hypot(mm.balle.v[0], mm.balle.v[1], mm.balle.v[2]);
    const eq = mm.balle.dernierToucheur?.equipe ?? null;
    if (eq !== equipeBalle) {
      equipeBalle = eq;
      const c = couleurBalle(eq);
      matMotif.color.setRGB(c[0], c[1], c[2]);
      matNoyau.color.setRGB(c[0], c[1], c[2]);
    }
    const k = intensiteTrainee(vit);
    noyau.scale.setScalar(0.85 + 0.35 * k + (opts.mouvementReduit ? 0 : 0.06 * Math.sin(tempsFlamme * 6)));
    matNoyau.opacity = 0.4 + 0.5 * k;
    traineeBalle.pousser(0, [[bp[0], bp[1], bp[2]]], couleurBalle(eq), k, dtImage);
    traineeBalle.maj();
    // ombre-repère : projection verticale sur ce que dit l'arène (sol, raccord), à plat si elle ne répond pas
    let hSol = 0.03, nrm: Vec3 = HAUT;
    try {
      if (typeof mm.arene?.lancerRayon === "function") {
        const d = mm.arene.lancerRayon([bp[0], bp[1], bp[2]], [0, -1, 0], 40);
        if (d !== null) {
          hSol = bp[1] - d + 0.04;
          vecA[0] = bp[0]; vecA[1] = bp[1] - d; vecA[2] = bp[2];
          nrm = mm.arene.normale(vecA);
        }
      }
    } catch { hSol = 0.03; nrm = HAUT; }
    const o = ombreBalle(Math.max(0, bp[1] - hSol));
    ombre.position.set(bp[0], hSol + 0.02, bp[2]);
    ombre.scale.setScalar(BALLE.rayon * o.echelle);
    ombre.quaternion.setFromUnitVectors(axeY, v3a.set(nrm[0], nrm[1], nrm[2]));
    const cOmb = ajusterLuminance(couleurBalle(eq), 0.55);
    matOmbre.color.setRGB(cOmb[0] * o.opacite, cOmb[1] * o.opacite, cOmb[2] * o.opacite);
    ombre.visible = bp[1] - hSol < 40;

    stade.maj(mm, dtImage);
    effets.maj(dtImage);
    traces.maj(dtImage);
  }

  // ---------- événements ----------
  const nPart = (type: TypeEffet, k: number) => nombreParticules(type, k, opts.qualite, opts.mouvementReduit);
  function etincelles(p: Readonly<Vec3>, type: TypeEffet, k: number, couleur: RGB, biais?: Readonly<Vec3>, grosses = false): void {
    const n = nPart(type, k);
    if (n <= 0) return;
    const g = GABARITS[type];
    effets.emettre({ p, directions: directionsFibonacci(n), vitesse: g.vitesse * (0.5 + 0.7 * k), vie: g.vie, gravite: g.gravite, couleur, biais, grosses });
  }
  const eclat = (c: Readonly<RGB>): RGB => ajusterLuminance(melangeRgb(c, rgbLineaire(PALETTE.blanc), 0.4), 1.2);
  const anneau = (type: TypeEffet, p: Readonly<Vec3>, normale: Readonly<Vec3>, couleur: Readonly<RGB>, echelle = 1) => {
    const a = GABARITS[type].anneau;
    if (a) effets.anneau({ p, normale, rayonFinal: a.rayon * echelle, dureeS: a.dureeS, couleur });
  };

  function evenement(e: Readonly<EvenementMatch>, mm: Readonly<MondeRocket>): void {
    switch (e.t) {
      case "but": {
        const c = eclat(couleurEquipe(e.equipe));
        const b = mm.balle.p;
        etincelles(b, "but", 1, c, undefined, true);
        etincelles([b[0], b[1] + 4, b[2]], "but", 0.6, eclat(rgbLineaire(PALETTE.blanc)));
        etincelles([b[0], b[1] + 8, b[2]], "but", 0.5, eclat(rgbLineaire(PALETTE.ambre)));
        anneau("but", [b[0], 0.1, b[2]], HAUT, c);
        const sz = b[2] > 0 ? 1 : -1;
        anneau("but", [b[0], Math.max(b[1], 2), sz * 51.2], [0, 0, 1], c, 0.5);
        stade.but(e.equipe);
        break;
      }
      case "demolition": {
        const victime = mm.voitures[e.victime];
        const c = eclat(couleurEquipe(victime?.equipe ?? "orange"));
        etincelles(e.p, "demolition", 1, c, undefined, true);
        etincelles(e.p, "demolition", 0.7, eclat(rgbLineaire(PALETTE.ambre)));
        anneau("demolition", e.p, HAUT, c);
        break;
      }
      case "toucheBalle": {
        const v = mm.voitures[e.idVoiture];
        if (!v) break;
        const k = intensiteChoc(e.force);
        const cv = centreVoiture(v), b = mm.balle.p;
        const d = [cv[0] - b[0], cv[1] - b[1], cv[2] - b[2]];
        const L = Math.hypot(d[0], d[1], d[2]) || 1;
        const pt: Vec3 = [b[0] + (d[0] / L) * BALLE.rayon, b[1] + (d[1] / L) * BALLE.rayon, b[2] + (d[2] / L) * BALLE.rayon];
        etincelles(pt, "touche", k, eclat(couleurEquipe(v.equipe)), [-d[0] / L, -d[1] / L, -d[2] / L]);
        if (k > 0.35) anneau("plot", pt, [d[0] / L, d[1] / L, d[2] / L], eclat(couleurEquipe(v.equipe)), 0.6 + 1.2 * k);
        break;
      }
      case "balleDecor": {
        const k = intensiteChoc(e.vitesse);
        if (k < 0.12) break;
        let n: Vec3 = HAUT;
        try { n = mm.arene.normale(e.point); } catch { n = HAUT; }
        etincelles(e.point, "decor", k, eclat(rgbLineaire(PALETTE.cyan)), n);
        if (k > 0.4) anneau("atterrissage", e.point, n, eclat(rgbLineaire(PALETTE.cyan)), 0.8 + k);
        break;
      }
      case "plot": {
        const def = PLOTS[e.idPlot];
        if (!def) break;
        const c = eclat(rgbLineaire(e.gros ? PALETTE.ambre : PALETTE.cyan));
        const p: Vec3 = [def.x, 0.3, def.z];
        etincelles(p, "plot", e.gros ? 1 : 0.5, c, [0, 1.2, 0]);
        anneau("plot", [def.x, 0.08, def.z], HAUT, c, e.gros ? 1.5 : 1);
        break;
      }
      case "supersonique": {
        if (!e.actif) break;
        const v = mm.voitures[e.idVoiture];
        if (!v) break;
        const vit = Math.hypot(v.v[0], v.v[1], v.v[2]) || 1;
        const dir: Vec3 = [v.v[0] / vit, v.v[1] / vit, v.v[2] / vit];
        const nez = pointVoiture(v, 0.9, 0, 0.2);
        anneau("supersonique", nez, dir, eclat(couleurEquipe(v.equipe)));
        break;
      }
      case "atterrissage": {
        if (e.vitesse < 3) break;
        const v = mm.voitures[e.idVoiture];
        if (!v) break;
        const sol = pointVoiture(v, 0, 0, -VOITURE.hauteurRepos);
        etincelles(sol, "atterrissage", intensiteChoc(e.vitesse * 2), eclat(rgbLineaire(PALETTE.cyan)), [0, 0.8, 0]);
        anneau("atterrissage", sol, v.normaleSurface ?? HAUT, eclat(rgbLineaire(PALETTE.cyan)), 0.7 + e.vitesse / 12);
        break;
      }
      case "flip":
      case "doubleSaut": {
        const v = mm.voitures[e.idVoiture];
        if (!v) break;
        anneau("atterrissage", v.p, v.base.haut, eclat(couleurEquipe(v.equipe)), 0.9);
        break;
      }
      case "choc": {
        if (e.vitesse < 5) break;
        const v = mm.voitures[e.idVoiture];
        if (!v) break;
        etincelles(centreVoiture(v), "decor", intensiteChoc(e.vitesse), eclat(couleurEquipe(v.equipe)));
        break;
      }
      case "reapparition": {
        const r = voitures[e.idVoiture], v = mm.voitures[e.idVoiture];
        if (!r || !v) break;
        r.apparition = 0;
        traineesVoitures.reinitialiser(e.idVoiture);
        anneau("plot", v.p, HAUT, eclat(couleurEquipe(v.equipe)), 1.4);
        break;
      }
      case "coupDEnvoi": {
        for (let i = 0; i < voitures.length; i++) traineesVoitures.reinitialiser(i);
        traineeBalle.reinitialiser(0);
        break;
      }
      default:
        break;
    }
  }

  return {
    racine,
    synchroniser,
    evenement,
    // les lignes sont des maillages plats (pas de lignes épaisses dépendantes de la résolution) : rien à recalculer
    redimensionner() {},
    dispose() {
      stade.dispose();
      effets.dispose();
      traces.dispose();
      traineesVoitures.dispose();
      traineeBalle.dispose();
      for (const r of voitures) {
        r.plaqueTex?.dispose();
        r.plaqueMat?.dispose();
        r.plaque?.removeFromParent();
        r.groupe.removeFromParent();
      }
      libererPiece(piece);
      libererMateriaux(mats.bleue);
      libererMateriaux(mats.orange);
      flammes.dispose();
      for (const o of aLiberer) o.dispose();
      racine.clear();
      racine.removeFromParent();
    },
  };
}
