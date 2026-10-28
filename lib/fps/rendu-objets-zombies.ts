/**
 * Objets de la carte zombies v7 (three) : armes dessinées à la craie sur les murs (puis le modèle une fois achetée), distributeurs d'atouts,
 * Micro-ondes Gratinator (Pack-a-Punch, cuisson visible), disjoncteur, four de la Recette ultime, boîte mystère (faisceau, couvercle,
 * armes qui défilent, peluche, envol), planches des fenêtres (arrachées et reposées en animation), bonus flottants, notes et ingrédients.
 * Tout est construit en code (boîtes, cylindres, textures canvas). Lit l'état de la partie à chaque image (`maj`), reçoit les effets
 * ponctuels (`planche`, `pelucheEnvol`). Aucun test vitest (three, canvas) : positions et règles viennent de `zombies-carte.ts` (testé).
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (« Rendu et sons »)
 */
import * as THREE from "three";
import { STATS } from "./armes";
import type { ArmeFeuId, EtatPartieZombies, Vec3 } from "./protocole";
import { creerModeleArmeMonde, sansHalo } from "./rendu";
import {
  ACHATS, ATOUTS, FENETRES, NOTES, PRIX_BOITE, achatBoite, pieceDe, type Achat, type ArmeAchat, type AtoutId, type Facade, type Fenetre,
} from "./zombies-carte";
import { ZOMBIES, NOMS_BONUS, type GenreBonus } from "./zombies-vagues";
import { FENETRE_BAS_M, FENETRE_HAUT_M } from "./rendu-interieurs";

const navigateur = typeof document !== "undefined";

// ---------------------------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------------------------

function toile(l: number, h: number, dessin: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture | null {
  if (!navigateur) return null;
  const cv = document.createElement("canvas");
  cv.width = l; cv.height = h;
  const c = cv.getContext("2d");
  if (!c) return null;
  dessin(c);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Hasard déterministe (craie : même tracé à chaque partie). */
function graine(n: number): () => number {
  let s = (n * 2654435761) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Trait de craie : plusieurs passes légèrement décalées, poussière. */
function craie(c: CanvasRenderingContext2D, pts: [number, number][], ferme: boolean, r: () => number, largeur = 5): void {
  for (let passe = 0; passe < 4; passe++) {
    c.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = x + (r() - 0.5) * 3, jy = y + (r() - 0.5) * 3;
      if (i === 0) c.moveTo(jx, jy); else c.lineTo(jx, jy);
    });
    if (ferme) c.closePath();
    c.lineWidth = largeur * (0.6 + 0.5 * r());
    c.strokeStyle = `rgba(245, 245, 235, ${0.35 + 0.25 * r()})`;
    c.lineJoin = "round"; c.lineCap = "round";
    c.stroke();
  }
}

/** Silhouettes des armes au mur (coordonnées d'une toile de 512 × 256, canon à droite). */
function silhouette(arme: ArmeAchat): [number, number][][] {
  const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  switch (arme) {
    case "pistolet": return [rect(180, 70, 360, 105), [[200, 105], [250, 105], [235, 185], [190, 185]], rect(250, 105, 280, 125)];
    case "revolver": return [rect(150, 80, 260, 110), rect(250, 70, 300, 118), rect(300, 82, 400, 100), [[175, 110], [225, 110], [205, 190], [160, 185]]];
    case "mini_uzi": return [rect(140, 75, 380, 115), rect(250, 115, 285, 210), [[160, 115], [205, 115], [195, 170], [155, 170]], rect(380, 88, 420, 102)];
    case "mitraillette": return [rect(110, 80, 420, 118), [[60, 85], [110, 90], [110, 115], [70, 140]], rect(270, 118, 300, 200), rect(420, 92, 470, 104), [[160, 118], [200, 118], [190, 175], [150, 175]]];
    case "fusil_assaut": return [rect(90, 85, 440, 115), [[30, 90], [90, 85], [90, 120], [40, 145]], [[250, 115], [290, 115], [300, 200], [265, 205]], rect(440, 95, 500, 105), rect(200, 60, 300, 85)];
    case "pompe": return [rect(150, 90, 470, 110), rect(250, 110, 380, 128), [[40, 95], [150, 90], [150, 120], [50, 150]], [[150, 120], [185, 120], [175, 160], [140, 160]]];
    case "sniper": return [rect(80, 92, 470, 108), rect(180, 55, 330, 80), [[20, 95], [80, 92], [80, 118], [30, 150]], [[160, 108], [195, 108], [185, 150], [150, 150]], rect(205, 80, 215, 92), rect(300, 80, 310, 92)];
    case "mitrailleuse": return [rect(90, 80, 450, 118), rect(450, 92, 505, 104), [[30, 85], [90, 82], [90, 118], [40, 145]], rect(220, 118, 300, 200), rect(380, 118, 390, 175), rect(410, 118, 420, 175)];
    case "epee": return [rect(170, 118, 470, 136), [[470, 118], [500, 127], [470, 136]], rect(150, 95, 170, 160), rect(70, 120, 150, 134), rect(55, 116, 70, 138)];
    default: return [rect(120, 90, 420, 115)];
  }
}

function textureCraie(achat: Achat): THREE.CanvasTexture | null {
  const arme = achat.arme!;
  const nom = arme === "epee" ? "Épée" : STATS[arme].nom;
  return toile(512, 256, (c) => {
    c.clearRect(0, 0, 512, 256);
    const r = graine(nom.length * 97 + achat.prix);
    for (const p of silhouette(arme)) craie(c, p, true, r, 5);
    // poussière de craie
    for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(240,240,230,${0.05 + 0.08 * r()})`; c.fillRect(100 + r() * 340, 40 + r() * 180, 2, 2); }
    c.font = `700 30px "Chakra Petch", "IBM Plex Mono", ui-monospace, sans-serif`;
    c.fillStyle = "rgba(245,245,235,0.85)";
    c.textAlign = "center";
    c.fillText(`${nom.toUpperCase()}  ${achat.prix.toLocaleString("fr-FR")} $`, 256, 238);
  });
}

function textureAtout(id: AtoutId): THREE.CanvasTexture | null {
  const a = ATOUTS[id];
  return toile(256, 512, (c) => {
    c.fillStyle = "#0b0d12"; c.fillRect(0, 0, 256, 512);
    c.fillStyle = a.couleur; c.fillRect(0, 0, 256, 120); c.fillRect(0, 430, 256, 82);
    c.fillStyle = "#0b0d12";
    c.font = `800 30px "Chakra Petch", ui-monospace, sans-serif`; c.textAlign = "center";
    const mots = a.nom.split(" ");
    c.fillText(mots.slice(0, Math.ceil(mots.length / 2)).join(" ").toUpperCase(), 128, 52);
    c.fillText(mots.slice(Math.ceil(mots.length / 2)).join(" ").toUpperCase(), 128, 92);
    // la tasse ou la bouteille, au centre
    c.strokeStyle = a.couleur; c.lineWidth = 8;
    c.beginPath(); c.roundRect(78, 190, 100, 140, 18); c.stroke();
    c.beginPath(); c.arc(190, 250, 26, -Math.PI / 2, Math.PI / 2); c.stroke();
    for (const x of [100, 128, 156]) { c.beginPath(); c.moveTo(x, 175); c.bezierCurveTo(x - 12, 155, x + 12, 145, x, 125); c.stroke(); }
    c.fillStyle = "#e9eef5"; c.font = `700 22px "Chakra Petch", ui-monospace, sans-serif`;
    c.fillText(a.description.length > 22 ? a.description.slice(0, 22) + "…" : a.description, 128, 385);
    c.fillStyle = "#0b0d12";
    if (a.prixSolo !== undefined) {
      // la Pause Café coûte moins cher seul (BO1 : Quick Revive à 500 en solo)
      c.font = `800 30px "Chakra Petch", ui-monospace, sans-serif`;
      c.fillText(`${a.prix.toLocaleString("fr-FR")} $`, 128, 468);
      c.font = `700 20px "Chakra Petch", ui-monospace, sans-serif`;
      c.fillText(`SEUL : ${a.prixSolo.toLocaleString("fr-FR")} $`, 128, 498);
    } else {
      c.font = `800 36px "Chakra Petch", ui-monospace, sans-serif`;
      c.fillText(`${a.prix.toLocaleString("fr-FR")} $`, 128, 485);
    }
  });
}

function textureBoite(): THREE.CanvasTexture | null {
  return toile(256, 128, (c) => {
    c.fillStyle = "#3b2414"; c.fillRect(0, 0, 256, 128);
    c.strokeStyle = "#2a180c"; c.lineWidth = 3;
    for (let y = 0; y < 128; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(256, y); c.stroke(); }
    c.fillStyle = "#cfe8ff"; c.font = `900 90px "Chakra Petch", ui-monospace, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
    c.shadowColor = "#7fc4ff"; c.shadowBlur = 18;
    c.fillText("?", 70, 66); c.fillText("?", 186, 66);
  });
}

function textureEtiquette(texte: string, couleur: string, l = 512, h = 96): THREE.CanvasTexture | null {
  return toile(l, h, (c) => {
    c.fillStyle = "#07090d"; c.fillRect(0, 0, l, h);
    c.strokeStyle = couleur; c.lineWidth = 4; c.strokeRect(4, 4, l - 8, h - 8);
    c.fillStyle = couleur; c.font = `800 ${Math.round(h * 0.42)}px "Chakra Petch", ui-monospace, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(texte, l / 2, h / 2 + 2);
  });
}

/** Icône d'un bonus : dessins simples, verts (BO1), sur fond transparent. */
function textureBonus(genre: GenreBonus): THREE.CanvasTexture | null {
  return toile(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128);
    c.strokeStyle = "#7dff7a"; c.fillStyle = "#7dff7a"; c.lineWidth = 7; c.lineJoin = "round";
    c.shadowColor = "#3cff4a"; c.shadowBlur = 12;
    switch (genre) {
      case "munitions":
        c.strokeRect(24, 44, 80, 52);
        for (const x of [40, 58, 76]) { c.beginPath(); c.moveTo(x, 44); c.lineTo(x, 22); c.arc(x + 4, 22, 4, Math.PI, 0); c.lineTo(x + 8, 44); c.stroke(); }
        break;
      case "instakill":
        // tête de tigre : cercle, oreilles, yeux en croix
        c.beginPath(); c.arc(64, 70, 36, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.moveTo(34, 50); c.lineTo(32, 24); c.lineTo(52, 38); c.stroke();
        c.beginPath(); c.moveTo(94, 50); c.lineTo(96, 24); c.lineTo(76, 38); c.stroke();
        for (const x of [50, 78]) { c.beginPath(); c.moveTo(x - 7, 60); c.lineTo(x + 7, 74); c.moveTo(x + 7, 60); c.lineTo(x - 7, 74); c.stroke(); }
        break;
      case "double":
        c.font = `900 64px "Chakra Petch", ui-monospace, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText("×2", 64, 68);
        break;
      case "nuke":
        c.beginPath(); c.arc(60, 74, 34, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.moveTo(80, 46); c.quadraticCurveTo(96, 24, 108, 28); c.stroke();
        c.beginPath(); c.arc(110, 26, 6, 0, Math.PI * 2); c.fill();
        break;
      case "menuisier":
        c.beginPath(); c.moveTo(36, 100); c.lineTo(80, 48); c.stroke();
        c.fillRect(66, 26, 44, 22);
        break;
      case "soldes":
        c.beginPath(); c.moveTo(24, 50); c.lineTo(64, 20); c.lineTo(104, 50); c.lineTo(104, 104); c.lineTo(24, 104); c.closePath(); c.stroke();
        c.font = `900 36px "Chakra Petch", ui-monospace, sans-serif`; c.textAlign = "center"; c.fillText("10$", 64, 90);
        break;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------

/** Groupe placé contre une façade : origine au pied du mur, +z vers le joueur (normale), +x le long du mur. */
function contreMur(f: Facade, decalage: number, y = 0): THREE.Group {
  const g = new THREE.Group();
  const mx = f.p[0] + (f.q[0] - f.p[0]) * f.t, mz = f.p[1] + (f.q[1] - f.p[1]) * f.t;
  g.position.set(mx + f.normale[0] * decalage, y, mz + f.normale[1] * decalage);
  g.rotation.y = Math.atan2(f.normale[0], f.normale[1]);
  return g;
}

interface Pieces { fond: THREE.MeshBasicMaterial; ligne: THREE.LineBasicMaterial }
function materiaux(couleur: number, fond = 0.12): Pieces {
  return {
    fond: new THREE.MeshBasicMaterial({ color: new THREE.Color(couleur).multiplyScalar(fond), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }),
    ligne: new THREE.LineBasicMaterial({ color: couleur, transparent: true, opacity: 0.9 }),
  };
}
function boiteFil(parent: THREE.Object3D, m: Pieces, w: number, h: number, d: number, x: number, y: number, z: number, jetables: { dispose(): void }[]): THREE.Group {
  const g = new THREE.BoxGeometry(w, h, d);
  const e = new THREE.EdgesGeometry(g);
  jetables.push(g, e);
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  grp.add(new THREE.Mesh(g, m.fond), new THREE.LineSegments(e, m.ligne));
  parent.add(grp);
  return grp;
}
function panneau(parent: THREE.Object3D, tex: THREE.Texture | null, w: number, h: number, x: number, y: number, z: number, jetables: { dispose(): void }[], opts: THREE.MeshBasicMaterialParameters = {}): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w, h);
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, ...opts });
  jetables.push(g, m);
  if (tex) jetables.push(tex);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// Fabrique
// ---------------------------------------------------------------------------------------------

export interface RenduObjetsZombies {
  /** `etat` : dernier état de la partie ; `t` : horloge locale (s) ; `tServeur` : horloge serveur (ms) */
  maj(etat: EtatPartieZombies | null, t: number, tServeur: number, dt: number): void;
  /** une planche part (arrachée) ou revient (reposée) sur la fenêtre `id` */
  planche(id: string, arrachee: boolean): void;
  dispose(): void;
}

/** Armes que la boîte fait défiler pendant le tirage. */
const ARMES_DEFILE: readonly ArmeFeuId[] = ["revolver", "pompe", "mitraillette", "fusil_assaut", "sniper", "mitrailleuse", "rayon", "railgun", "minigun", "magnum_dore"];

interface PlanchesFenetre { f: Fenetre; groupe: THREE.Group; planches: THREE.Group[]; visibles: number; vols: { g: THREE.Group; t: number; sens: 1 | -1; v: THREE.Vector3; r: THREE.Vector3; p0: THREE.Vector3 }[] }

export function creerRenduObjetsZombies(scene: THREE.Scene): RenduObjetsZombies {
  const racine = new THREE.Group();
  racine.name = "objets-zombies";
  scene.add(racine);
  const jetables: { dispose(): void }[] = [];
  const mBois = materiaux(0xffb35c, 0.22);
  const mMetal = materiaux(0x9be9ff, 0.1);
  const mVert = materiaux(0x7dff7a, 0.15);
  jetables.push(mBois.fond, mBois.ligne, mMetal.fond, mMetal.ligne, mVert.fond, mVert.ligne);

  // ---- armes au mur : craie, puis le modèle une fois achetée ----
  const modelesMur = new Map<string, { dispose(): void }>();
  const groupesMur = new Map<string, THREE.Group>();
  for (const a of ACHATS) {
    if (a.genre !== "mur" || !a.facade) continue;
    const g = contreMur(a.facade, 0.03, 1.55);
    panneau(g, textureCraie(a), 1.5, 0.75, 0, 0, 0, jetables, { depthWrite: false });
    racine.add(g);
    groupesMur.set(a.id, g);
  }

  // ---- distributeurs d'atouts ----
  const distributeurs: { id: AtoutId; face: THREE.Mesh; halo: THREE.Mesh }[] = [];
  for (const a of ACHATS) {
    if (a.genre !== "atout" || !a.facade || !a.atout) continue;
    const g = contreMur(a.facade, 0.45, 0);
    const couleur = new THREE.Color(ATOUTS[a.atout].couleur);
    const m = materiaux(couleur.getHex(), 0.18);
    jetables.push(m.fond, m.ligne);
    boiteFil(g, m, 1.1, 2.1, 0.8, 0, 1.05, 0, jetables);
    // façade opaque et hors du halo du bloom (sinon le texte blanc bave et se lit mal) ; la lueur colorée passe DERRIÈRE la façade
    const face = panneau(g, textureAtout(a.atout), 1.0, 2.0, 0, 1.05, 0.41, jetables, { transparent: false });
    sansHalo(face.material as THREE.Material);
    const halo = panneau(g, null, 2.2, 2.6, 0, 1.2, 0.395, jetables, { color: couleur, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
    distributeurs.push({ id: a.atout, face, halo });
    racine.add(g);
  }

  // ---- Micro-ondes Gratinator (Pack-a-Punch) ----
  const achatPap = ACHATS.find((a) => a.genre === "pap")!;
  const gPap = contreMur(achatPap.facade!, 0.6, 0);
  boiteFil(gPap, mMetal, 1.8, 0.95, 1.0, 0, 0.475, 0, jetables);
  boiteFil(gPap, mMetal, 1.8, 0.85, 1.0, 0, 1.4, 0, jetables);
  const vitrePap = panneau(gPap, null, 1.1, 0.6, -0.2, 1.4, 0.51, jetables, { color: 0xb44dff, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
  panneau(gPap, textureEtiquette("MICRO-ONDES GRATINATOR", "#d58cff"), 1.7, 0.3, 0, 2.05, 0.51, jetables);
  const platPap = new THREE.Group();
  platPap.position.set(-0.2, 1.15, 0.05);
  gPap.add(platPap);
  let modelePap: { arme: ArmeFeuId; m: { group: THREE.Group; dispose(): void } } | null = null;
  racine.add(gPap);

  // ---- disjoncteur ----
  const achatCourant = ACHATS.find((a) => a.genre === "courant")!;
  const gCourant = contreMur(achatCourant.facade!, 0.15, 0);
  boiteFil(gCourant, mMetal, 1.0, 1.4, 0.25, 0, 1.4, 0, jetables);
  panneau(gCourant, textureEtiquette("DISJONCTEUR GÉNÉRAL", "#ffd166", 512, 80), 0.95, 0.15, 0, 2.2, 0.13, jetables);
  const levier = new THREE.Group();
  levier.position.set(0, 1.3, 0.16);
  gCourant.add(levier);
  boiteFil(levier, mBois, 0.08, 0.45, 0.08, 0, 0.22, 0, jetables);
  const voyant = panneau(gCourant, null, 0.12, 0.12, 0.35, 1.9, 0.13, jetables, { color: 0xff2a1a, blending: THREE.AdditiveBlending, depthWrite: false });
  racine.add(gCourant);

  // ---- four de la Recette ultime ----
  const achatFour = ACHATS.find((a) => a.genre === "four")!;
  const gFour = contreMur(achatFour.facade!, 0.5, 0);
  boiteFil(gFour, mMetal, 1.4, 0.95, 0.9, 0, 0.475, 0, jetables);
  boiteFil(gFour, mMetal, 1.6, 0.6, 0.9, 0, 2.4, 0, jetables);
  const porteFour = panneau(gFour, null, 1.0, 0.5, 0, 0.5, 0.46, jetables, { color: 0xff7a2a, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false });
  racine.add(gFour);

  // ---- notes et ingrédients ----
  const notes: THREE.Mesh[] = [];
  const texNote = toile(64, 96, (c) => {
    c.fillStyle = "#f3eed8"; c.fillRect(0, 0, 64, 96);
    c.strokeStyle = "#8aa"; c.lineWidth = 2;
    for (let y = 18; y < 90; y += 10) { c.beginPath(); c.moveTo(8, y); c.lineTo(56, y); c.stroke(); }
  });
  if (texNote) jetables.push(texNote);
  for (const n of NOTES) {
    const g = new THREE.PlaneGeometry(0.26, 0.36);
    const m = new THREE.MeshBasicMaterial({ map: texNote, side: THREE.DoubleSide });
    jetables.push(g, m);
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(n.position[0], n.id === 3 || n.id === 5 || n.id === 7 ? 0.03 : 0.79, n.position[1]);
    racine.add(mesh);
    notes.push(mesh);
  }
  const ingredients = new Map<string, THREE.Group>();
  for (const a of ACHATS) {
    if (a.genre !== "ingredient") continue;
    const g = new THREE.Group();
    g.position.set(a.position[0], a.ingredient === "herbes" ? 0.4 : 1.05, a.position[1]);
    const couleur = a.ingredient === "sel" ? 0xf2f7fa : a.ingredient === "herbes" ? 0x5dff6a : 0x7a5a3a;
    const m = materiaux(couleur, 0.4);
    jetables.push(m.fond, m.ligne);
    if (a.ingredient === "herbes") { for (let k = 0; k < 5; k++) boiteFil(g, m, 0.05, 0.5, 0.05, Math.cos(k) * 0.08, 0.25, Math.sin(k) * 0.08, jetables).rotation.z = (k - 2) * 0.2; }
    else boiteFil(g, m, 0.28, a.ingredient === "sel" ? 0.36 : 0.2, 0.28, 0, 0.15, 0, jetables);
    panneau(g, null, 0.9, 0.9, 0, 0.3, 0, jetables, { color: couleur, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    racine.add(g);
    ingredients.set(a.ingredient!, g);
  }

  // ---- boîte mystère ----
  const gBoite = new THREE.Group();
  racine.add(gBoite);
  const caisse = new THREE.Group();
  gBoite.add(caisse);
  boiteFil(caisse, mBois, 1.6, 0.55, 0.75, 0, 0.275, 0, jetables);
  const texB = textureBoite();
  for (const s of [-1, 1]) panneau(caisse, texB, 1.5, 0.5, 0, 0.28, s * 0.38, jetables).rotation.y = s < 0 ? Math.PI : 0;
  const couvercle = new THREE.Group();
  couvercle.position.set(0, 0.55, -0.375);
  caisse.add(couvercle);
  boiteFil(couvercle, mBois, 1.6, 0.12, 0.75, 0, 0.06, 0.375, jetables);
  const faisceau = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 40, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  faisceau.position.y = 20;
  jetables.push(faisceau.geometry, faisceau.material as THREE.Material);
  gBoite.add(faisceau);
  const defile = new THREE.Group();
  defile.position.y = 0.7;
  gBoite.add(defile);
  const modelesBoite = new Map<string, { group: THREE.Group; dispose(): void }>();
  const modeleBoite = (a: ArmeFeuId | "peluche") => {
    let m = modelesBoite.get(a);
    if (!m) {
      m = a === "peluche" ? peluche(jetables) : creerModeleArmeMonde(a, 0xcfe8ff);
      m.group.scale.setScalar(a === "peluche" ? 1 : 2);
      m.group.visible = false;
      defile.add(m.group);
      modelesBoite.set(a, m);
    }
    return m;
  };

  // ---- planches ----
  const fenetres: PlanchesFenetre[] = [];
  for (const f of FENETRES) {
    const piece = pieceDe(f.id);
    const interieure = piece.batiment !== undefined;
    const groupe = new THREE.Group();
    groupe.position.set(f.milieu[0] - f.normale[0] * (piece.demi + 0.08), 0, f.milieu[1] - f.normale[1] * (piece.demi + 0.08));
    groupe.rotation.y = Math.atan2(f.normale[0], f.normale[1]);
    racine.add(groupe);
    const bas = interieure ? FENETRE_BAS_M + 0.08 : 0.35, haut = interieure ? FENETRE_HAUT_M - 0.1 : 2.3;
    const planches: THREE.Group[] = [];
    for (let k = 0; k < ZOMBIES.planches; k++) {
      const y = bas + ((k + 0.5) / ZOMBIES.planches) * (haut - bas);
      const p = boiteFil(groupe, mBois, f.largeur + (interieure ? 0.35 : 0.2), 0.16, 0.05, 0, y, 0, jetables);
      p.rotation.z = ((k * 37) % 7 - 3) * 0.035;
      planches.push(p);
    }
    fenetres.push({ f, groupe, planches, visibles: ZOMBIES.planches, vols: [] });
  }

  // ---- bonus ----
  const bonus = new Map<number, { g: THREE.Group; finT: number }>();
  const texBonus = new Map<GenreBonus, THREE.Texture>();
  const iconeBonus = (genre: GenreBonus) => {
    let t = texBonus.get(genre);
    if (!t) { const x = textureBonus(genre); if (x) { t = x; texBonus.set(genre, x); jetables.push(x); } }
    return t ?? null;
  };
  const halo = toile(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, "rgba(140,255,140,0.9)"); g.addColorStop(1, "rgba(60,255,80,0)");
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  });
  if (halo) jetables.push(halo);

  function majBonus(etat: EtatPartieZombies, t: number, tServeur: number): void {
    const vus = new Set<number>();
    for (const b of etat.bonus) {
      vus.add(b.id);
      let e = bonus.get(b.id);
      if (!e) {
        const g = new THREE.Group();
        g.position.set(b.p[0], 0, b.p[2]);
        const icone = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconeBonus(b.genre), transparent: true, depthWrite: false }));
        icone.scale.setScalar(0.9);
        icone.position.y = 1.1;
        const lueur = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        lueur.scale.setScalar(2.4);
        lueur.position.y = 1.1;
        const colonne = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.25, 6, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x5dff6a, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
        colonne.position.y = 3;
        g.add(icone, lueur, colonne);
        g.userData.jetables = [icone.material, lueur.material, colonne.geometry, colonne.material];
        racine.add(g);
        e = { g, finT: b.finT };
        bonus.set(b.id, e);
      }
      e.g.children[0].position.y = 1.1 + 0.15 * Math.sin(t * 2.4 + b.id);
      e.g.rotation.y = t * 1.5;
      const reste = b.finT - tServeur;
      e.g.visible = reste > ZOMBIES.bonusClignoteMs ? true : Math.floor(t * (reste < 4000 ? 8 : 3)) % 2 === 0;
    }
    for (const [id, e] of bonus) {
      if (vus.has(id)) continue;
      for (const x of e.g.userData.jetables as { dispose(): void }[]) x.dispose();
      e.g.removeFromParent();
      bonus.delete(id);
    }
  }

  // ---- boucle ----
  let derniereBoite = -1;
  let defileT = 0;
  function majBoite(etat: EtatPartieZombies, t: number, tServeur: number, dt: number): void {
    const b = etat.boite;
    const a = achatBoite(b.emplacement);
    if (b.emplacement !== derniereBoite && a.facade) {
      derniereBoite = b.emplacement;
      const f = a.facade;
      const mx = f.p[0] + (f.q[0] - f.p[0]) * f.t, mz = f.p[1] + (f.q[1] - f.p[1]) * f.t;
      gBoite.position.set(mx + f.normale[0] * 0.5, 0, mz + f.normale[1] * 0.5);
      gBoite.rotation.y = Math.atan2(f.normale[0], f.normale[1]);
    }
    const ouvert = b.etat === "tirage" || b.etat === "offre";
    couvercle.rotation.x += ((ouvert ? -1.4 : 0) - couvercle.rotation.x) * (1 - Math.exp(-dt * 8));
    for (const m of modelesBoite.values()) m.group.visible = false;
    caisse.position.y = 0;
    caisse.visible = true;
    faisceau.visible = b.etat !== "envol";
    (faisceau.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.05 * Math.sin(t * 2);
    if (b.etat === "tirage") {
      // armes qui défilent en montant, de plus en plus lentement
      const reste = Math.max(0, b.finT - tServeur) / 4000;
      defileT += dt * (4 + 14 * reste);
      const arme = ARMES_DEFILE[Math.floor(defileT) % ARMES_DEFILE.length];
      const m = modeleBoite(reste < 0.08 && b.arme ? b.arme : arme);
      m.group.visible = true;
      defile.position.y = 0.7 + 0.8 * (1 - reste);
      defile.rotation.y = 0;
    } else if (b.etat === "offre" && b.arme) {
      const m = modeleBoite(b.arme);
      m.group.visible = true;
      // l'arme redescend lentement dans la boîte pendant les 12 s de l'offre
      defile.position.y = 0.7 + 0.8 * Math.min(1, Math.max(0, (b.finT - tServeur) / 12_000));
      defile.rotation.y = Math.sin(t * 1.2) * 0.3;
    } else if (b.etat === "envol") {
      const k = 1 - Math.max(0, b.finT - tServeur) / 5000;
      const m = modeleBoite("peluche");
      m.group.visible = k < 0.35;
      defile.position.y = 1 + k * 2;
      caisse.position.y = Math.max(0, (k - 0.3) * 9);
      caisse.rotation.y = Math.max(0, k - 0.3) * 6;
      caisse.visible = k < 0.95;
    }
  }

  function majFenetres(etat: EtatPartieZombies, dt: number): void {
    fenetres.forEach((fp, i) => {
      const n = etat.fenetres[i] ?? ZOMBIES.planches;
      // une partie relancée remet toutes les planches sans animation
      if (n !== fp.visibles && !fp.vols.length) {
        fp.visibles = n;
      }
      fp.planches.forEach((p, k) => { if (!fp.vols.some((v) => v.g === p)) p.visible = k < fp.visibles; });
      for (const v of fp.vols) {
        v.t += dt;
        if (v.sens === 1) {
          // planche arrachée : projetée vers l'extérieur, tourne et tombe
          v.g.position.set(v.p0.x + v.v.x * v.t, Math.max(0.05, v.p0.y + v.v.y * v.t - 4.9 * v.t * v.t), v.p0.z + v.v.z * v.t);
          v.g.rotation.set(v.r.x * v.t, v.r.y * v.t, v.r.z * v.t);
          v.g.visible = v.t < 1.4;
        } else {
          // planche reposée : arrive de l'intérieur et se plaque
          const k = Math.min(1, v.t / 0.35);
          v.g.position.set(v.p0.x, v.p0.y, v.p0.z + (1 - k) * 0.8);
          v.g.rotation.set(0, 0, v.p0.y * 0.02);
          v.g.visible = true;
        }
      }
      const fini = fp.vols.filter((v) => (v.sens === 1 ? v.t >= 1.4 : v.t >= 0.35));
      for (const v of fini) {
        v.g.position.copy(v.p0);
        v.g.rotation.set(0, 0, ((fp.planches.indexOf(v.g) * 37) % 7 - 3) * 0.035);
        v.g.visible = v.sens === -1;
      }
      fp.vols = fp.vols.filter((v) => !fini.includes(v));
    });
  }

  let courantVu = false;
  return {
    maj(etat, t, tServeur, dt) {
      if (!etat) return;
      // armes achetées : le modèle se pose dans la craie
      for (const id of etat.murs) {
        if (modelesMur.has(id)) continue;
        const a = ACHATS.find((x) => x.id === id);
        const g = groupesMur.get(id);
        if (!a?.arme || !g) continue;
        const m = creerModeleArmeMonde(a.arme === "epee" ? "epee" : a.arme, 0xcfe8ff);
        m.group.scale.setScalar(1.8);
        m.group.rotation.y = -Math.PI / 2;
        m.group.position.set(0, 0, 0.12);
        g.add(m.group);
        modelesMur.set(id, m);
      }
      // distributeurs : éteints sans courant (la Pause Café marche toujours)
      for (const d of distributeurs) {
        const allume = d.id === "pausecafe" || etat.courant;
        const k = allume ? 0.85 + 0.15 * Math.sin(t * 5 + d.id.length) : 0.22;
        (d.face.material as THREE.MeshBasicMaterial).color.setScalar(k);
        (d.halo.material as THREE.MeshBasicMaterial).opacity = allume ? 0.12 : 0;
      }
      // Pack-a-Punch
      const pap = etat.pap;
      (vitrePap.material as THREE.MeshBasicMaterial).opacity = !etat.courant ? 0.04 : pap.etat === "cuisson" ? 0.45 + 0.3 * Math.sin(t * 12) : 0.2;
      if (pap.etat === "cuisson" && pap.arme) {
        if (modelePap?.arme !== pap.arme) {
          modelePap?.m.dispose();
          modelePap = { arme: pap.arme, m: creerModeleArmeMonde(pap.arme, 0xd58cff) };
          modelePap.m.group.scale.setScalar(1.4);
          platPap.add(modelePap.m.group);
        }
        platPap.rotation.y += dt * 2.5;
      } else if (modelePap) { modelePap.m.dispose(); modelePap = null; }
      // disjoncteur, four
      if (etat.courant !== courantVu) courantVu = etat.courant;
      levier.rotation.x += ((etat.courant ? -0.9 : 0.9) - levier.rotation.x) * (1 - Math.exp(-dt * 10));
      (voyant.material as THREE.MeshBasicMaterial).color.set(etat.courant ? 0x5dff6a : Math.sin(t * 6) > 0 ? 0xff2a1a : 0x330000);
      (porteFour.material as THREE.MeshBasicMaterial).opacity = etat.quete.cuissonFinT ? 0.4 + 0.3 * Math.sin(t * 7) : etat.quete.faite ? 0.25 : 0.06;
      // ingrédients pris, truffe visible au courant
      for (const [id, g] of ingredients) {
        g.visible = !etat.quete.ingredients.includes(id) && (id !== "truffe" || etat.courant);
        g.rotation.y = t * 0.8;
      }
      for (const n of notes) (n.material as THREE.MeshBasicMaterial).color.setScalar(0.75 + 0.25 * Math.sin(t * 3));
      majBoite(etat, t, tServeur, dt);
      majFenetres(etat, dt);
      majBonus(etat, t, tServeur);
    },
    planche(id, arrachee) {
      const fp = fenetres.find((x) => x.f.id === id);
      if (!fp) return;
      if (arrachee) {
        if (fp.visibles <= 0) return;
        fp.visibles--;
        const g = fp.planches[fp.visibles];
        fp.vols.push({ g, t: 0, sens: 1, p0: g.position.clone(), v: new THREE.Vector3((Math.random() - 0.5) * 2, 2.5, -3 - Math.random() * 2), r: new THREE.Vector3(Math.random() * 6, Math.random() * 4, Math.random() * 8) });
      } else {
        if (fp.visibles >= ZOMBIES.planches) return;
        const g = fp.planches[fp.visibles];
        fp.visibles++;
        fp.vols.push({ g, t: 0, sens: -1, p0: g.position.clone(), v: new THREE.Vector3(), r: new THREE.Vector3() });
      }
    },
    dispose() {
      scene.remove(racine);
      for (const m of modelesMur.values()) m.dispose();
      for (const m of modelesBoite.values()) m.dispose();
      modelePap?.m.dispose();
      for (const e of bonus.values()) for (const x of e.g.userData.jetables as { dispose(): void }[]) x.dispose();
      for (const x of jetables) x.dispose();
      jetables.length = 0;
    },
  };
}

/** La peluche de tigre de la boîte mystère : boules orange à rayures sombres, oreilles, petit nœud. */
function peluche(jetables: { dispose(): void }[]): { group: THREE.Group; dispose(): void } {
  const g = new THREE.Group();
  const orange = new THREE.MeshBasicMaterial({ color: 0xff8c2a });
  const noir = new THREE.MeshBasicMaterial({ color: 0x1a0d05 });
  const blanc = new THREE.MeshBasicMaterial({ color: 0xf4efe6 });
  const s = (r: number) => new THREE.SphereGeometry(r, 12, 10);
  const geos = [s(0.22), s(0.17), s(0.07), s(0.06), s(0.05)];
  const corps = new THREE.Mesh(geos[0], orange); corps.position.y = 0.22;
  const tete = new THREE.Mesh(geos[1], orange); tete.position.y = 0.52;
  const museau = new THREE.Mesh(geos[2], blanc); museau.position.set(0, 0.48, 0.14);
  g.add(corps, tete, museau);
  for (const sx of [-1, 1]) {
    const o = new THREE.Mesh(geos[3], orange); o.position.set(sx * 0.12, 0.66, 0); g.add(o);
    const p = new THREE.Mesh(geos[4], orange); p.position.set(sx * 0.2, 0.1, 0.12); g.add(p);
    const oe = new THREE.Mesh(geos[4], noir); oe.scale.setScalar(0.4); oe.position.set(sx * 0.06, 0.55, 0.15); g.add(oe);
  }
  for (const y of [0.15, 0.26, 0.36]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.012, 4, 16), noir); r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r); jetables.push(r.geometry); }
  jetables.push(orange, noir, blanc, ...geos);
  void PRIX_BOITE; void NOMS_BONUS;
  return { group: g, dispose() { g.removeFromParent(); } };
}

/** Position (monde) d'un bonus pour un son spatialisé. */
export const positionBonus = (p: Vec3): Vec3 => [p[0], 1.1, p[2]];
