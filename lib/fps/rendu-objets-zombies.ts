/**
 * Objets de la carte zombies v7 (three) : armes dessinées à la craie sur les murs (puis le modèle une fois achetée), distributeurs d'atouts,
 * Micro-ondes Gratinator (Pack-a-Punch, cuisson visible), disjoncteur, boîte mystère (faisceau, couvercle, armes qui défilent, peluche,
 * envol), planches des fenêtres (arrachées et reposées en animation), bonus flottants, notes, et (v8) le décor du grand secret « Le Menu
 * fantôme » (`creerDecorSecret` : pendules, ardoise, casseroles, marmite, cuves, four, ampoules en morse, post-it, billot, cloche), qui ne
 * montre que ce qu'un cuisinier verrait : aucun halo de bonus, aucune rotation d'objet à ramasser.
 * Tout est construit en code (boîtes, cylindres, textures canvas). Lit l'état de la partie à chaque image (`maj`), reçoit les effets
 * ponctuels (`planche`, `pelucheEnvol`). Aucun test vitest (three, canvas) : positions et règles viennent de `zombies-carte.ts` (testé).
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (« Rendu et sons »)
 */
import * as THREE from "three";
import { STATS } from "./armes";
import type { ArmeFeuId, EtatPartieZombies, Vec3 } from "./protocole";
import { creerModeleArmeMonde, sansHalo } from "./rendu";
import { creerModeleRemontoir } from "./rendu-grenades";
import { creerRenduMicroondes } from "./rendu-microondes";
import {
  ACHATS, ATOUTS, BOITE, FENETRES, NB_EMPLACEMENTS_BOITE, NOTES, PICTOS_SECRET, PRIX_BOITE, SECRET_CARTE, achatBoite, pieceDe, type Achat, type ArmeAchat,
  type AtoutId, type Facade, type Fenetre, type ObjetSecret, type PictoSecret,
} from "./zombies-carte";
import { SECRET, SECRET_SERVI, coupsSonnes, dernierMidi, etapeDe, heurePendules, morseAllume } from "./zombies-secret";
import { boitesPresentes, soldesActives } from "./zombies-boites";
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
    // (v8) armes des zombies
    case "baguette": return [rect(170, 82, 430, 98), rect(170, 100, 430, 116), rect(130, 80, 175, 120), [[60, 92], [130, 85], [130, 118], [80, 150]], [[140, 120], [175, 120], [165, 165], [130, 165]]];
    case "agrafeuse": return [rect(100, 95, 420, 120), [[100, 92], [400, 80], [420, 92], [100, 96]], rect(420, 102, 490, 110), rect(230, 120, 265, 190), [[40, 98], [100, 95], [100, 125], [50, 150]], [[150, 120], [185, 120], [175, 170], [140, 170]]];
    case "photocopieuse": return [rect(120, 85, 400, 118), rect(400, 92, 470, 108), [[60, 90], [120, 88], [120, 116], [70, 140]], [[285, 118], [325, 145], [285, 185], [245, 145]], [[160, 118], [195, 118], [185, 170], [150, 170]]];
    case "essoreuse": return [rect(150, 92, 470, 108), rect(220, 108, 330, 130), [[275, 130], [300, 145], [275, 165], [250, 145]], [[40, 95], [150, 90], [150, 120], [50, 150]], [[150, 120], [185, 120], [175, 160], [140, 160]]];
    case "brochette": return [rect(110, 105, 420, 120), [[330, 40], [345, 112], [330, 190]], [[330, 40], [420, 112], [330, 190]], rect(120, 96, 470, 100), [[50, 108], [110, 104], [110, 124], [60, 150]], [[180, 120], [210, 120], [200, 165], [170, 165]]];
    case "soufflerie": return [rect(130, 85, 330, 135), [[330, 85], [450, 55], [450, 165], [330, 135]], rect(160, 55, 300, 85), [[190, 135], [225, 135], [215, 200], [180, 200]]];
    case "grille_pain": return [rect(170, 70, 330, 170), rect(200, 55, 225, 70), rect(270, 55, 295, 70), rect(330, 108, 420, 128), [[420, 100], [450, 118], [420, 136]], [[215, 170], [250, 170], [240, 225], [205, 225]]];
    case "perforeuse": return [rect(180, 80, 340, 120), rect(340, 92, 370, 108), [[370, 96], [440, 100], [370, 104]], [[210, 120], [250, 120], [240, 185], [200, 185]], rect(185, 185, 265, 210)];
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
  /** bonus Menuisier : toutes les planches manquantes reviennent en animation */
  toutReposer(): void;
  /** (v8) un détail du décor du grand secret réagit (`zevt{secret}`) : casserole qui tinte, cuve qui saute, écran qui s'allume… */
  secret(quoi: string, i?: number, k?: number): void;
  dispose(): void;
}

/** Durée (s) du vol d'une planche reposée, du pied du mur à sa place. */
const DUREE_REPOSE_S = 0.4;

/** Armes que la boîte fait défiler pendant le tirage. */
const ARMES_DEFILE: readonly ArmeFeuId[] = [
  "revolver", "pompe", "mitraillette", "soufflerie", "fusil_assaut", "sniper", "brochette", "mitrailleuse", "rayon", "grille_pain", "essoreuse", "railgun",
  "photocopieuse", "minigun", "agrafeuse", "magnum_dore", "baguette", "perforeuse",
];

/** Une boîte mystère (un emplacement) : groupe contre le mur, groupe de l'envol, caisse, couvercle, faisceau, armes qui défilent. */
interface RenduBoite {
  em: number; g: THREE.Group; envol: THREE.Group; caisse: THREE.Group; couvercle: THREE.Group; faisceau: THREE.Mesh;
  matFaisceau: THREE.MeshBasicMaterial; defile: THREE.Group; modeles: Map<string, { group: THREE.Group; dispose(): void }>;
  defileT: number; apparueT: number; visible: boolean;
}
/** Durée (s) de l'arrivée d'une boîte : chute après un déménagement, surgissement au Happy hour. */
const ARRIVEE_BOITE_S = 0.6;

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

  // ---- Micro-ondes Gratinator (Pack-a-Punch) : meuble, puis la machine creuse (cavité, plateau, porte vitrée), cf. rendu-microondes.ts ----
  const achatPap = ACHATS.find((a) => a.genre === "pap")!;
  const gPap = contreMur(achatPap.facade!, 0.6, 0);
  boiteFil(gPap, mMetal, 1.8, 0.95, 1.0, 0, 0.475, 0, jetables);
  panneau(gPap, textureEtiquette("MICRO-ONDES GRATINATOR", "#d58cff"), 1.7, 0.3, 0, 2.05, 0.51, jetables);
  const microondes = creerRenduMicroondes(gPap, mMetal);
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

  // ---- (v8) décor du grand secret ----
  const decor = creerDecorSecret(racine, jetables, mMetal, mBois);

  // ---- notes ----
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
  // ---- boîtes mystère : une par emplacement (la principale, plus celles du Happy hour), posées une fois pour toutes ----
  const texB = textureBoite();
  if (texB) jetables.push(texB);
  const geoFaisceau = new THREE.CylinderGeometry(0.35, 0.6, 40, 16, 1, true);
  jetables.push(geoFaisceau);
  const boites: RenduBoite[] = [];
  for (let em = 0; em < NB_EMPLACEMENTS_BOITE; em++) {
    const f = achatBoite(em).facade;
    if (!f) continue;
    // dos au mur : centre de la caisse à `BOITE.recul` de la façade, +z local (face ouverte, couvercle) vers la pièce
    const g = contreMur(f, BOITE.recul, 0);
    g.visible = false;
    racine.add(g);
    // l'envol de la peluche anime ce groupe intermédiaire : la caisse elle-même ne garde jamais de rotation (retour 8)
    const envol = new THREE.Group();
    g.add(envol);
    const caisse = new THREE.Group();
    envol.add(caisse);
    boiteFil(caisse, mBois, BOITE.longueur, 0.55, BOITE.profondeur, 0, 0.275, 0, jetables);
    for (const s of [-1, 1]) panneau(caisse, texB, 1.5, 0.5, 0, 0.28, s * (BOITE.profondeur / 2 + 0.005), jetables).rotation.y = s < 0 ? Math.PI : 0;
    const couvercle = new THREE.Group();
    couvercle.position.set(0, 0.55, -BOITE.profondeur / 2);
    caisse.add(couvercle);
    boiteFil(couvercle, mBois, BOITE.longueur, 0.12, BOITE.profondeur, 0, 0.06, BOITE.profondeur / 2, jetables);
    const matFaisceau = new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    jetables.push(matFaisceau);
    const faisceau = new THREE.Mesh(geoFaisceau, matFaisceau);
    faisceau.position.y = 20;
    g.add(faisceau);
    const defile = new THREE.Group();
    defile.position.y = 0.7;
    g.add(defile);
    boites.push({ em, g, envol, caisse, couvercle, faisceau, matFaisceau, defile, modeles: new Map(), defileT: 0, apparueT: -Infinity, visible: false });
  }
  const modeleBoite = (rb: RenduBoite, a: ArmeFeuId | "peluche" | "remontoir") => {
    let m = rb.modeles.get(a);
    if (!m) {
      // (v8) le tigre à remontoir sort de la boîte comme une arme
      m = a === "peluche" ? peluche(jetables) : a === "remontoir" ? creerModeleRemontoir() : creerModeleArmeMonde(a, 0xcfe8ff);
      m.group.scale.setScalar(a === "peluche" ? 1 : 2);
      m.group.visible = false;
      rb.defile.add(m.group);
      rb.modeles.set(a, m);
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
      p.userData.y = y; // hauteur de repos (une planche en vol n'y est plus)
      planches.push(p);
    }
    fenetres.push({ f, groupe, planches, visibles: ZOMBIES.planches, vols: [] });
  }

  /** Une planche de plus revient sur la fenêtre (animation de `majFenetres`), `t0` ≤ 0 : délai avant son départ (s). */
  function reposer(fp: PlanchesFenetre, t0: number): void {
    const g = fp.planches[fp.visibles];
    // une planche encore en vol (arrachée) est rattrapée : elle repart de sa place
    const enVol = fp.vols.findIndex((v) => v.g === g);
    if (enVol >= 0) fp.vols.splice(enVol, 1);
    fp.visibles++;
    const p0 = new THREE.Vector3(0, g.userData.y as number, 0);
    const v = new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, 0);
    const r = new THREE.Vector3(0, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.6);
    fp.vols.push({ g, t: t0, sens: -1, p0, v, r });
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
  let premiereSynchro = true;
  function majBoites(etat: EtatPartieZombies, t: number, tServeur: number, dt: number): void {
    const presentes = new Map(boitesPresentes(etat).map((b) => [b.emplacement, b] as const));
    const soldes = soldesActives(etat.effets.soldesFinT, tServeur);
    for (const rb of boites) {
      const b = presentes.get(rb.em);
      if (!b) { rb.g.visible = false; rb.visible = false; continue; }
      const principale = b === etat.boite;
      if (!rb.visible) {
        // la boîte arrive : couvercle fermé, armes rangées ; elle tombe du ciel (déménagement) ou surgit (Happy hour), sauf à la synchro
        rb.visible = true;
        rb.couvercle.rotation.x = 0;
        rb.defileT = 0;
        rb.apparueT = premiereSynchro ? -Infinity : t;
      }
      rb.g.visible = true;
      // état de repos remis à chaque image : aucune animation ne fuit dans la suivante
      rb.envol.position.set(0, 0, 0);
      rb.envol.rotation.set(0, 0, 0);
      rb.envol.scale.setScalar(1);
      rb.caisse.visible = true;
      const depuis = t - rb.apparueT;
      if (depuis < ARRIVEE_BOITE_S) {
        const k = depuis / ARRIVEE_BOITE_S;
        if (principale) rb.envol.position.y = 5 * (1 - k * k);
        else rb.envol.scale.setScalar(Math.max(0.05, 1 - (1 - k) ** 3));
      }
      const ouvert = b.etat === "tirage" || b.etat === "offre";
      rb.couvercle.rotation.x += ((ouvert ? -1.4 : 0) - rb.couvercle.rotation.x) * (1 - Math.exp(-dt * 8));
      for (const m of rb.modeles.values()) m.group.visible = false;
      rb.faisceau.visible = b.etat !== "envol";
      // Happy hour : faisceaux dorés à chaque emplacement
      // (doré, plus pâle que le bleu : l'additif doré sature vite sous le halo)
      const dore = soldes || !principale;
      rb.matFaisceau.color.set(dore ? 0xe0a040 : 0x8fd0ff);
      rb.matFaisceau.opacity = dore ? 0.06 + 0.025 * Math.sin(t * 5 + rb.em) : 0.12 + 0.05 * Math.sin(t * 2);
      rb.defile.rotation.y = 0;
      if (b.etat === "tirage") {
        // armes qui défilent en montant, de plus en plus lentement
        const reste = Math.max(0, b.finT - tServeur) / 4000;
        rb.defileT += dt * (4 + 14 * reste);
        const arme = ARMES_DEFILE[Math.floor(rb.defileT) % ARMES_DEFILE.length];
        modeleBoite(rb, reste < 0.08 && b.arme ? b.arme : arme).group.visible = true;
        rb.defile.position.y = 0.7 + 0.8 * (1 - reste);
      } else if (b.etat === "offre" && b.arme) {
        modeleBoite(rb, b.arme).group.visible = true;
        // l'arme redescend lentement dans la boîte pendant les 12 s de l'offre
        rb.defile.position.y = 0.7 + 0.8 * Math.min(1, Math.max(0, (b.finT - tServeur) / 12_000));
        rb.defile.rotation.y = Math.sin(t * 1.2) * 0.3;
      } else if (b.etat === "envol") {
        const k = 1 - Math.max(0, b.finT - tServeur) / 5000;
        modeleBoite(rb, "peluche").group.visible = k < 0.35;
        rb.defile.position.y = 1 + k * 2;
        rb.envol.position.y = Math.max(0, (k - 0.3) * 9);
        rb.envol.rotation.y = Math.max(0, k - 0.3) * 6;
        rb.caisse.visible = k < 0.95;
      }
    }
    premiereSynchro = false;
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
          // planche reposée (BO1) : ramassée au pied du mur côté intérieur, elle monte en tournant et se plaque d'un coup sec ; un délai
          // (t < 0) étale les planches du Menuisier
          if (v.t < 0) { v.g.visible = false; continue; }
          const e = 1 - (1 - Math.min(1, v.t / DUREE_REPOSE_S)) ** 3;
          const reste = 1 - e;
          const repos = ((fp.planches.indexOf(v.g) * 37) % 7 - 3) * 0.035;
          v.g.position.set(v.p0.x + reste * v.v.x, v.p0.y - reste * 0.9 + Math.sin(Math.PI * e) * 0.22, v.p0.z + reste * 1.1);
          v.g.rotation.set(reste * 1.3, reste * v.r.y, repos + reste * v.r.z);
          v.g.visible = true;
        }
      }
      const fini = fp.vols.filter((v) => (v.sens === 1 ? v.t >= 1.4 : v.t >= DUREE_REPOSE_S));
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
      // Pack-a-Punch : l'arme déposée, cuite, puis à reprendre
      microondes.maj(etat.pap, etat.courant, tServeur, t, dt);
      // disjoncteur
      if (etat.courant !== courantVu) courantVu = etat.courant;
      levier.rotation.x += ((etat.courant ? -0.9 : 0.9) - levier.rotation.x) * (1 - Math.exp(-dt * 10));
      (voyant.material as THREE.MeshBasicMaterial).color.set(etat.courant ? 0x5dff6a : Math.sin(t * 6) > 0 ? 0xff2a1a : 0x330000);
      decor.maj(etat, t, tServeur, dt);
      for (const n of notes) (n.material as THREE.MeshBasicMaterial).color.setScalar(0.75 + 0.25 * Math.sin(t * 3));
      majBoites(etat, t, tServeur, dt);
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
        const enVol = fp.vols.findIndex((v) => v.g === g);
        if (enVol >= 0) fp.vols.splice(enVol, 1);
        fp.vols.push({ g, t: 0, sens: 1, p0: new THREE.Vector3(0, g.userData.y as number, 0), v: new THREE.Vector3((Math.random() - 0.5) * 2, 2.5, -3 - Math.random() * 2), r: new THREE.Vector3(Math.random() * 6, Math.random() * 4, Math.random() * 8) });
      } else {
        if (fp.visibles >= ZOMBIES.planches) return;
        reposer(fp, 0);
      }
    },
    secret(quoi, i, k) {
      decor.effet(quoi, i, k);
    },
    toutReposer() {
      // bonus Menuisier : toutes les planches manquantes reviennent, fenêtre par fenêtre, l'une après l'autre
      fenetres.forEach((fp, i) => {
        for (let k = 0; fp.visibles < ZOMBIES.planches; k++) reposer(fp, -(i % 4) * 0.05 - k * 0.09);
      });
    },
    dispose() {
      scene.remove(racine);
      for (const m of modelesMur.values()) m.dispose();
      for (const rb of boites) for (const m of rb.modeles.values()) m.dispose();
      microondes.dispose();
      for (const e of bonus.values()) for (const x of e.g.userData.jetables as { dispose(): void }[]) x.dispose();
      for (const x of jetables) x.dispose();
      jetables.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Grand secret (v8) : « Le Menu fantôme »
// ---------------------------------------------------------------------------------------------

/** Pictogramme d'un restaurant tracé à la craie (ou gravé) : trèfle, croissant, camion, feuille ; centré en (x, y), taille `s` px. */
function tracerPicto(c: CanvasRenderingContext2D, picto: PictoSecret, x: number, y: number, s: number, r: () => number, couleur?: string): void {
  const k = s / 100;
  const P = (px: number, py: number): [number, number] => [x + (px - 50) * k, y + (py - 50) * k];
  const cercle = (cx: number, cy: number, rr: number, n = 14): [number, number][] =>
    Array.from({ length: n }, (_, i) => P(cx + Math.cos((i / n) * Math.PI * 2) * rr, cy + Math.sin((i / n) * Math.PI * 2) * rr));
  const traits: { pts: [number, number][]; ferme: boolean }[] = [];
  switch (picto) {
    case "trefle":
      traits.push({ pts: cercle(50, 30, 17), ferme: true }, { pts: cercle(31, 56, 17), ferme: true }, { pts: cercle(69, 56, 17), ferme: true });
      traits.push({ pts: [P(50, 60), P(54, 78), P(60, 92)], ferme: false });
      break;
    case "croissant":
      traits.push({ pts: [P(12, 70), P(22, 40), P(50, 22), P(78, 40), P(88, 70), P(70, 58), P(50, 52), P(30, 58)], ferme: true });
      traits.push({ pts: [P(36, 34), P(42, 54)], ferme: false }, { pts: [P(50, 26), P(50, 52)], ferme: false }, { pts: [P(64, 34), P(58, 54)], ferme: false });
      break;
    case "camion":
      traits.push({ pts: [P(8, 30), P(62, 30), P(62, 72), P(8, 72)], ferme: true });
      traits.push({ pts: [P(62, 44), P(80, 44), P(92, 58), P(92, 72), P(62, 72)], ferme: false });
      traits.push({ pts: cercle(24, 78, 9, 10), ferme: true }, { pts: cercle(76, 78, 9, 10), ferme: true });
      break;
    case "feuille":
      traits.push({ pts: [P(20, 84), P(22, 50), P(42, 22), P(84, 14), P(78, 52), P(56, 76)], ferme: true });
      traits.push({ pts: [P(14, 92), P(36, 66), P(72, 26)], ferme: false });
      break;
  }
  if (couleur) {
    c.strokeStyle = couleur; c.lineWidth = Math.max(2, 5 * k); c.lineJoin = "round"; c.lineCap = "round";
    for (const t of traits) {
      c.beginPath();
      t.pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
      if (t.ferme) c.closePath();
      c.stroke();
    }
    return;
  }
  for (const t of traits) craie(c, t.pts, t.ferme, r, Math.max(2.5, 6 * k));
}

/** Cadran d'une pendule de cantine (fond crème, graduations, 12 en haut), transparent hors du cercle. */
function textureCadran(): THREE.CanvasTexture | null {
  return toile(256, 256, (c) => {
    c.clearRect(0, 0, 256, 256);
    c.fillStyle = "#1a1d22"; c.beginPath(); c.arc(128, 128, 126, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#e7e1cf"; c.beginPath(); c.arc(128, 128, 112, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#1a1d22";
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, gros = i % 5 === 0;
      c.lineWidth = gros ? 6 : 2;
      c.beginPath();
      c.moveTo(128 + Math.sin(a) * (gros ? 86 : 96), 128 - Math.cos(a) * (gros ? 86 : 96));
      c.lineTo(128 + Math.sin(a) * 106, 128 - Math.cos(a) * 106);
      c.stroke();
    }
    c.fillStyle = "#1a1d22"; c.font = `700 30px "Chakra Petch", ui-monospace, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("12", 128, 62); c.fillText("6", 128, 196); c.fillText("3", 194, 130); c.fillText("9", 62, 130);
  });
}

/** Ardoise du menu du jour : quatre plats barrés, chacun précédé d'un picto ; `ordre` = index des casseroles de haut en bas. */
function textureArdoise(ordre: readonly number[]): THREE.CanvasTexture | null {
  return toile(512, 384, (c) => {
    c.fillStyle = "#5a3a22"; c.fillRect(0, 0, 512, 384);
    c.fillStyle = "#1b231e"; c.fillRect(14, 14, 484, 356);
    const r = graine(ordre.reduce((a, b) => a * 5 + b, 7));
    for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(230,235,225,${0.02 + 0.04 * r()})`; c.fillRect(20 + r() * 470, 20 + r() * 340, 3, 2); }
    c.font = `700 40px "Caveat", "Segoe Script", "Comic Sans MS", cursive`;
    c.fillStyle = "rgba(240,240,230,0.85)"; c.textAlign = "center";
    c.fillText("Menu du jour", 256, 62);
    const plats = ["Entrée", "Plat", "Fromage", "Dessert"];
    ordre.slice(0, 4).forEach((idx, k) => {
      const y = 118 + k * 66;
      tracerPicto(c, PICTOS_SECRET[idx] ?? "trefle", 78, y, 50, r);
      c.textAlign = "left"; c.font = `600 30px "Caveat", "Segoe Script", "Comic Sans MS", cursive`;
      c.fillStyle = "rgba(240,240,230,0.7)";
      c.fillText(plats[k], 120, y - 4);
      // le plat lui-même est raturé, illisible : il ne reste que l'ordre des pictos
      for (let l = 0; l < 3; l++) craie(c, [[226 + l * 6, y - 14 + l * 7], [300, y - 18 + l * 9], [390, y - 10 + l * 5], [460, y - 16 + l * 8]], false, r, 3);
      craie(c, [[116, y - 12], [470, y - 6]], false, r, 4);
    });
    // une heure griffonnée dans le coin, à demi effacée
    c.font = `600 22px "Caveat", "Segoe Script", cursive`; c.fillStyle = "rgba(240,240,230,0.35)"; c.textAlign = "right";
    c.fillText("service : 12 h", 486, 356);
  });
}

/** Disque de cuivre gravé d'un picto (flanc d'une casserole). */
function textureCasserole(picto: PictoSecret): THREE.CanvasTexture | null {
  return toile(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128);
    const g = c.createRadialGradient(54, 50, 6, 64, 64, 62);
    g.addColorStop(0, "#f0a868"); g.addColorStop(1, "#8a4a22");
    c.fillStyle = g; c.beginPath(); c.arc(64, 64, 62, 0, Math.PI * 2); c.fill();
    tracerPicto(c, picto, 64, 64, 84, graine(picto.length), "#3a1c0a");
  });
}

/** Post-it jaune au numéro écrit au feutre. */
function texturePostit(n: number): THREE.CanvasTexture | null {
  return toile(64, 64, (c) => {
    c.fillStyle = "#f2dd4a"; c.fillRect(0, 0, 64, 64);
    c.fillStyle = "rgba(0,0,0,0.12)"; c.fillRect(0, 0, 64, 8);
    c.fillStyle = "#1c2a6b"; c.font = `800 40px "Caveat", "Segoe Script", "Comic Sans MS", cursive`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(String(n), 32, 38);
  });
}

/** Le décor du grand secret : objets, états persistants lus dans `EtatSecretZombies`, réactions ponctuelles (`zevt{secret}`). */
interface DecorSecret {
  maj(etat: EtatPartieZombies, t: number, tServeur: number, dt: number): void;
  effet(quoi: string, i?: number, k?: number): void;
}

/** Repère (x, z) unitaire le long des façades (u) et vers le nord local (n) des bâtiments creusés. */
const U_BAT: readonly [number, number] = [Math.cos((16 * Math.PI) / 180), Math.sin((16 * Math.PI) / 180)];
const N_BAT: readonly [number, number] = [Math.sin((16 * Math.PI) / 180), -Math.cos((16 * Math.PI) / 180)];
const lacetVers = (v: readonly [number, number]): number => Math.atan2(v[0], v[1]);

function creerDecorSecret(racine: THREE.Group, jetables: { dispose(): void }[], mMetal: Pieces, mBois: Pieces): DecorSecret {
  const C = SECRET_CARTE;
  const additif = (couleur: number, opacite = 0) => {
    const m = new THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: opacite, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    jetables.push(m);
    return m;
  };
  const geo = <G extends THREE.BufferGeometry>(g: G): G => { jetables.push(g); return g; };
  const mat = (o: THREE.MeshBasicMaterialParameters) => { const m = new THREE.MeshBasicMaterial(o); jetables.push(m); return m; };
  const mCuivre = materiaux(0xd98a4a, 0.4);
  const mLaiton = materiaux(0xe8c060, 0.35);
  jetables.push(mCuivre.fond, mCuivre.ligne, mLaiton.fond, mLaiton.ligne);
  const cylindre = (parent: THREE.Object3D, m: Pieces, r0: number, r1: number, h: number, y: number, ouvert = false) => {
    const g = geo(new THREE.CylinderGeometry(r1, r0, h, 18, 1, ouvert));
    const e = geo(new THREE.EdgesGeometry(g, 30));
    const grp = new THREE.Group();
    grp.position.y = y;
    grp.add(new THREE.Mesh(g, m.fond), new THREE.LineSegments(e, m.ligne));
    parent.add(grp);
    return grp;
  };

  // ---- pendules : cadran, aiguilles des heures et des minutes ----
  const texCadran = textureCadran();
  if (texCadran) jetables.push(texCadran);
  const pendules = C.pendules.map((p) => {
    const g = contreMur(p.facade!, 0.03, p.c[1]);
    const face = panneau(g, texCadran, 0.62, 0.62, 0, 0, 0, jetables, { depthWrite: true });
    const aiguille = (l: number, larg: number, z: number) => {
      const pivot = new THREE.Group();
      pivot.position.z = z;
      const m = new THREE.Mesh(geo(new THREE.PlaneGeometry(larg, l)), mat({ color: 0x15171b, side: THREE.DoubleSide }));
      m.position.y = l * 0.38;
      pivot.add(m);
      g.add(pivot);
      return pivot;
    };
    const heures = aiguille(0.17, 0.028, 0.012), minutes = aiguille(0.25, 0.018, 0.016);
    racine.add(g);
    return { face, heures, minutes };
  });

  // ---- ardoise du menu, batterie de cuivre au-dessus du piano, veilleuses bleues ----
  const gArdoise = contreMur(C.ardoise.facade!, 0.03, C.ardoise.c[1]);
  const ardoise = panneau(gArdoise, null, 1.2, 0.9, 0, 0, 0, jetables, { transparent: false });
  racine.add(gArdoise);
  let ordreArdoise = "";
  const lacetCuisson = lacetVers([-U_BAT[0], -U_BAT[1]]);
  const rail = new THREE.Group();
  const c0 = C.casseroles[0].c, c3 = C.casseroles[3].c;
  rail.position.set((c0[0] + c3[0]) / 2, 2.62, (c0[2] + c3[2]) / 2);
  rail.rotation.y = lacetVers(N_BAT);
  boiteFil(rail, mMetal, 0.04, 0.04, Math.hypot(c3[0] - c0[0], c3[2] - c0[2]) + 0.8, 0, 0, 0, jetables);
  racine.add(rail);
  const casseroles = C.casseroles.map((ob, i) => {
    const pivot = new THREE.Group();
    pivot.position.set(ob.c[0], 2.6, ob.c[2]);
    pivot.rotation.y = lacetCuisson;
    const corps = new THREE.Group();
    corps.position.y = ob.c[1] - 2.6;
    pivot.add(corps);
    boiteFil(pivot, mMetal, 0.015, 0.36, 0.015, 0, -0.18, 0, jetables);
    cylindre(corps, mCuivre, 0.18, 0.2, 0.17, 0, true);
    boiteFil(corps, mCuivre, 0.05, 0.03, 0.32, 0, 0.06, -0.34, jetables);
    const tex = textureCasserole(PICTOS_SECRET[i]);
    if (tex) jetables.push(tex);
    panneau(corps, tex, 0.16, 0.16, 0, 0, 0.205, jetables, { side: THREE.DoubleSide });
    racine.add(pivot);
    return { pivot, angle: 0, vitesse: 0 };
  });
  const flammes = C.casseroles.map((ob) => {
    const m = new THREE.Mesh(geo(new THREE.CircleGeometry(0.16, 16)), additif(0x3a7bff));
    m.rotation.x = -Math.PI / 2;
    m.position.set(ob.c[0], 0.975, ob.c[2]);
    racine.add(m);
    return m;
  });

  // ---- marmite de la Cour Centre : réchaud, fait-tout, couvercle, vapeur ----
  const gMarmite = new THREE.Group();
  gMarmite.position.set(C.marmite.c[0], 0, C.marmite.c[2]);
  boiteFil(gMarmite, mMetal, 0.9, 0.22, 0.9, 0, 0.11, 0, jetables);
  cylindre(gMarmite, mMetal, 0.4, 0.43, 0.56, 0.5, true);
  const couvercle = cylindre(gMarmite, mMetal, 0.45, 0.42, 0.05, 0.8);
  const texVapeur = toile(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,0.8)"); g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  });
  if (texVapeur) jetables.push(texVapeur);
  const vapeurs = Array.from({ length: 6 }, (_, k) => {
    const m = new THREE.SpriteMaterial({ map: texVapeur, transparent: true, opacity: 0, depthWrite: false, color: 0xdfe8ee });
    jetables.push(m);
    const s = new THREE.Sprite(m);
    s.userData.phase = k / 6;
    gMarmite.add(s);
    return s;
  });
  const lueurMarmite = new THREE.Mesh(geo(new THREE.CircleGeometry(0.4, 18)), additif(0xffc040));
  lueurMarmite.rotation.x = -Math.PI / 2;
  lueurMarmite.position.y = 0.79;
  gMarmite.add(lueurMarmite);
  racine.add(gMarmite);
  let bouillonT = -Infinity, couvercleT = -Infinity;

  // ---- cuves cryogéniques du Labo : numéros, porte de la n° 3, givre, truffe ----
  const lacetCuves = lacetVers(N_BAT);
  const cuves = C.cuves.map((ob, i) => {
    const g = new THREE.Group();
    g.position.set(ob.c[0] + N_BAT[0] * 0.71, 0, ob.c[2] + N_BAT[1] * 0.71);
    g.rotation.y = lacetCuves;
    panneau(g, textureEtiquette(`N° ${i + 1}`, "#bfe6ff", 256, 96), 0.42, 0.16, 0, 1.62, 0.005, jetables);
    racine.add(g);
    return g;
  });
  const charniere = new THREE.Group();
  charniere.position.set(-0.5, 0, 0.01);
  cuves[2].add(charniere);
  boiteFil(charniere, mMetal, 1.0, 1.25, 0.05, 0.5, 0.75, 0.025, jetables);
  const givreGeo = geo(new THREE.PlaneGeometry(1.6, 1.6));
  const givre = Array.from({ length: 3 }, (_, k) => {
    const m = new THREE.Mesh(givreGeo, additif(0xbfe8ff));
    m.position.set((k - 1) * 0.4, 0.6 + k * 0.25, 0.3 + k * 0.1);
    cuves[2].add(m);
    return m;
  });
  const truffe = new THREE.Mesh(geo(new THREE.IcosahedronGeometry(0.09, 0)), mat({ color: 0x2a1c14 }));
  truffe.position.set(0, 0.95, -0.25);
  cuves[2].add(truffe);
  let givreT = -Infinity;

  // ---- four de la cuisine : caisson, hotte, porte rougeoyante ----
  const gFour = contreMur(C.four.facade!, 0.5, 0);
  boiteFil(gFour, mMetal, 1.4, 0.95, 0.9, 0, 0.475, 0, jetables);
  boiteFil(gFour, mMetal, 1.6, 0.6, 0.9, 0, 2.4, 0, jetables);
  const porteFour = panneau(gFour, null, 1.0, 0.5, 0, 0.5, 0.46, jetables, { color: 0xff7a2a, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false });
  const colonne = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.5, 0.9, 6, 20, 1, true)), additif(0xffd27a));
  colonne.position.set(0, 3, 0.9);
  gFour.add(colonne);
  racine.add(gFour);
  let serviT = -Infinity, flammeT = -Infinity;

  // ---- ampoules au-dessus du Micro-ondes et du disjoncteur ----
  const ampoule = (ob: ObjetSecret) => {
    const g = contreMur(ob.facade!, 0.12, ob.c[1]);
    boiteFil(g, mMetal, 0.04, 0.12, 0.12, 0, 0.1, -0.06, jetables);
    const verre = new THREE.Mesh(geo(new THREE.SphereGeometry(0.06, 10, 8)), mat({ color: 0x2a2a26 }));
    g.add(verre);
    const halo = panneau(g, halo2, 0.9, 0.9, 0, 0, 0.02, jetables, { color: 0xfff0b0, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    racine.add(g);
    return { verre, halo, flashT: -Infinity };
  };
  const halo2 = toile(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 1, 32, 32, 32);
    g.addColorStop(0, "rgba(255,240,190,1)"); g.addColorStop(1, "rgba(255,240,190,0)");
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  });
  const lampeLabo = ampoule(C.lampeLabo), lampeLocal = ampoule(C.lampeLocal);

  // ---- post-it des écrans de l'open space (des deux côtés de l'écran), lueur d'un écran touché ----
  const texPostits = new Map<number, THREE.Texture>();
  for (let n = 1; n <= 8; n++) { const x = texturePostit(n); if (x) { texPostits.set(n, x); jetables.push(x); } }
  const lacetEcran = lacetVers(N_BAT);
  const ecrans = C.ecrans.map((ob) => {
    const g = new THREE.Group();
    g.position.set(ob.c[0], ob.c[1], ob.c[2]);
    g.rotation.y = lacetEcran;
    const postits = [1, -1].map((s) => {
      const m = panneau(g, null, 0.085, 0.085, s * 0.2, 0.11, s * 0.026, jetables, { transparent: false, side: THREE.DoubleSide });
      m.rotation.z = s * 0.12;
      return m;
    });
    const lueurs = [1, -1].map((s) => panneau(g, null, 0.54, 0.32, 0, 0, s * 0.024, jetables, { color: 0x40ff70, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    racine.add(g);
    return { postits, lueurs, flashT: -Infinity, couleur: 0x40ff70 };
  });
  let numerosPostits = "";

  // ---- billot et couperet, cloche de service, sur le comptoir de la cuisine ----
  const gBillot = new THREE.Group();
  gBillot.position.set(C.billot.c[0], 0.95, C.billot.c[2]);
  gBillot.rotation.y = lacetVers(U_BAT);
  boiteFil(gBillot, mBois, 0.5, 0.2, 0.38, 0, 0.1, 0, jetables);
  const couperet = new THREE.Group();
  couperet.position.y = 0.2;
  gBillot.add(couperet);
  boiteFil(couperet, mMetal, 0.28, 0.16, 0.02, 0.02, 0.08, 0, jetables);
  boiteFil(couperet, mBois, 0.16, 0.035, 0.035, 0.24, 0.13, 0, jetables);
  const lueurLame = panneau(couperet, null, 0.3, 0.18, 0.02, 0.08, 0.012, jetables, { color: 0xff5a3a, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  racine.add(gBillot);
  let billotT = -Infinity;
  const gCloche = new THREE.Group();
  gCloche.position.set(C.cloche.c[0], 0.95, C.cloche.c[2]);
  cylindre(gCloche, mLaiton, 0.1, 0.1, 0.02, 0.01);
  const dome = new THREE.Mesh(geo(new THREE.SphereGeometry(0.08, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), mLaiton.fond);
  dome.position.y = 0.02;
  gCloche.add(dome, new THREE.LineSegments(geo(new THREE.EdgesGeometry(dome.geometry, 25)), mLaiton.ligne));
  (gCloche.children[gCloche.children.length - 1] as THREE.Object3D).position.y = 0.02;
  const halloCloche = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo2, color: 0xffd060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  jetables.push(halloCloche.material);
  halloCloche.scale.setScalar(0.7);
  halloCloche.position.y = 0.1;
  gCloche.add(halloCloche);
  racine.add(gCloche);
  if (halo2) jetables.push(halo2);

  let tLocal = 0;
  let coupsVus = 0;
  return {
    maj(etat, t, tServeur, dt) {
      tLocal = t;
      const s = etat.secret;
      // pendules : arrêtées sur 11 h 58 ; remontée seule, une pendule bat la seconde sur place ; toutes remontées, elles tournent ensemble
      // (beaucoup trop vite) ; celle du Local technique tourne dès que le courant revient
      const tourne = s.pendulesT > 0;
      const coups = coupsSonnes(s.pendulesT, s.periodeMidiMs, tServeur);
      pendules.forEach((p, i) => {
        let m: number;
        if (i === 4) m = etat.courant ? (SECRET.heureArretMin + tServeur / 60_000) % 720 : SECRET.heureArretMin;
        else if (tourne) m = heurePendules(s.pendulesT, s.periodeMidiMs, tServeur);
        else m = SECRET.heureArretMin + (s.pendules & (1 << i) ? (Math.floor(tServeur / 500) % 2 ? 0.25 : 0) : 0);
        p.heures.rotation.z = -(m / 720) * Math.PI * 2;
        p.minutes.rotation.z = -((m % 60) / 60) * Math.PI * 2;
        // les douze coups de midi : le cadran pâlit à chaque coup
        const k = i < 4 && coups ? Math.max(0, 1 - ((tServeur - (dernierMidi(s.pendulesT, s.periodeMidiMs, tServeur) ?? 0)) % SECRET.coupMidiMs) / 250) : 0;
        (p.face.material as THREE.MeshBasicMaterial).color.setScalar(0.82 + 0.35 * k);
      });
      coupsVus = coups;
      // ardoise : retracée quand l'ordre change (nouvelle partie)
      const cle = s.ardoise.join(",");
      if (cle !== ordreArdoise) {
        ordreArdoise = cle;
        const m = ardoise.material as THREE.MeshBasicMaterial;
        m.map?.dispose();
        m.map = textureArdoise(s.ardoise);
        m.needsUpdate = true;
      }
      // casseroles : balancier amorti
      for (const c of casseroles) {
        c.vitesse += (-30 * c.angle - 2.2 * c.vitesse) * dt;
        c.angle += c.vitesse * dt;
        c.pivot.rotation.x = c.angle;
      }
      const veilleuses = s.etape > etapeDe("casseroles");
      flammes.forEach((f, i) => { (f.material as THREE.MeshBasicMaterial).opacity = veilleuses ? 0.32 + 0.12 * Math.sin(t * 13 + i * 1.7) : 0; });
      // marmite : la vapeur monte avec ce qui bout (pendant une livraison), puis le couvercle saute et une lueur dorée reste
      const pleine = s.etape > etapeDe("marmite");
      const bout = s.etape === etapeDe("marmite") ? s.marmite : pleine ? 0.35 : 0;
      vapeurs.forEach((v) => {
        const ph = (t * 0.35 + (v.userData.phase as number)) % 1;
        v.position.set(Math.sin(ph * 9 + (v.userData.phase as number) * 7) * 0.15, 0.85 + ph * 1.6, Math.cos(ph * 7) * 0.12);
        v.scale.setScalar(0.35 + ph * 0.9);
        const pulse = Math.max(0, 1 - (t - bouillonT) / 0.8);
        (v.material as THREE.SpriteMaterial).opacity = Math.min(0.7, (bout * 0.55 + pulse * 0.25) * (1 - ph));
      });
      const pop = Math.max(0, 1 - (t - couvercleT) / 1.2);
      couvercle.position.set(pleine ? 0.36 : 0, 0.8 + (pleine ? 0.06 : 0) + pop * 0.6, 0);
      couvercle.rotation.z = pleine ? 0.5 + pop * 2 : 0;
      (lueurMarmite.material as THREE.MeshBasicMaterial).opacity = pleine ? 0.18 + 0.05 * Math.sin(t * 2) : bout * 0.12;
      // cuve n° 3 : la porte saute à la grenade, reste ouverte tant que la truffe n'est pas fondue ; le givre s'échappe
      const ouverte = s.etape >= etapeDe("truffe");
      charniere.rotation.y += ((ouverte ? -1.9 : 0) - charniere.rotation.y) * (1 - Math.exp(-dt * (ouverte ? 14 : 6)));
      const brume = Math.max(0, 1 - (t - givreT) / 3);
      givre.forEach((g, k) => {
        g.lookAt(g.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(Math.sin(t * 0.3 + k), 0, Math.cos(t * 0.3 + k))));
        (g.material as THREE.MeshBasicMaterial).opacity = brume * 0.22 + (ouverte && s.etape === etapeDe("truffe") ? 0.05 : 0);
      });
      truffe.visible = s.etape === etapeDe("truffe") && !s.truffe;
      truffe.rotation.y = t * 0.4;
      // four : veilleuse une fois la truffe servie, rugissant pendant le service, doré une fois servi ; colonne de lumière à la fin
      const rugit = s.service !== undefined;
      const fl = Math.max(0, 1 - (t - flammeT) / 1.5);
      const porte = porteFour.material as THREE.MeshBasicMaterial;
      porte.color.set(s.etape >= SECRET_SERVI ? 0xffc85a : 0xff7a2a);
      porte.opacity = rugit ? 0.55 + 0.3 * Math.sin(t * 17) : s.etape > etapeDe("truffe") ? 0.2 + 0.04 * Math.sin(t * 3) : 0.04 + fl * 0.5;
      porte.opacity = Math.min(0.9, porte.opacity + fl * 0.3);
      const fin = Math.max(0, 1 - (t - serviT) / 7);
      colonne.visible = fin > 0;
      (colonne.material as THREE.MeshBasicMaterial).opacity = 0.22 * fin * (0.8 + 0.2 * Math.sin(t * 6));
      colonne.scale.set(1 + (1 - fin) * 0.6, 1, 1 + (1 - fin) * 0.6);
      // ampoules : « MIDI » au-dessus du Micro-ondes (après la truffe), le code au-dessus du disjoncteur (après midi) ; éteintes sans courant
      const allumer = (l: typeof lampeLabo, on: boolean, flash: number) => {
        (l.verre.material as THREE.MeshBasicMaterial).color.set(flash > 0 ? 0xffd060 : on ? 0xfff6d8 : 0x2a2a26);
        (l.halo.material as THREE.MeshBasicMaterial).opacity = flash > 0 ? 0.6 * flash : on ? 0.55 : 0;
      };
      allumer(lampeLabo, etat.courant && s.etape === etapeDe("midi") && morseAllume("MIDI", tServeur), Math.max(0, 1 - (t - lampeLabo.flashT) / 2.5));
      allumer(lampeLocal, etat.courant && !!s.code && morseAllume(s.code.join(""), tServeur), Math.max(0, 1 - (t - lampeLocal.flashT) / 2.5));
      // post-it : numéros de la partie ; un écran touché s'allume en vert, une erreur les fait tous clignoter en rouge
      const cleP = s.postits.join(",");
      if (cleP !== numerosPostits) {
        numerosPostits = cleP;
        ecrans.forEach((e, i) => {
          for (const m of e.postits) {
            const mm = m.material as THREE.MeshBasicMaterial;
            mm.map = texPostits.get(s.postits[i]) ?? null;
            mm.needsUpdate = true;
          }
        });
      }
      for (const e of ecrans) {
        const k = Math.max(0, 1 - (t - e.flashT) / 1.4);
        for (const l of e.lueurs) {
          const m = l.material as THREE.MeshBasicMaterial;
          m.color.set(e.couleur);
          m.opacity = k * (e.couleur === 0xff3a2a ? 0.5 * (Math.floor(t * 10) % 2) : 0.45);
        }
      }
      // billot : la lame rougeoie à mesure qu'il « mange », puis le couperet se dresse
      const plein = s.etape > etapeDe("hachoir");
      couperet.rotation.z += ((plein ? -Math.PI / 2 : -0.35) - couperet.rotation.z) * (1 - Math.exp(-dt * 5));
      const eclat = Math.max(0, 1 - (t - billotT) / 0.5);
      (lueurLame.material as THREE.MeshBasicMaterial).opacity = Math.min(0.8, (s.etape === etapeDe("hachoir") ? s.billot * 0.35 : plein ? 0.3 : 0) + eclat * 0.4);
      (halloCloche.material as THREE.SpriteMaterial).opacity = s.etape >= SECRET_SERVI ? 0.35 + 0.25 * Math.sin(t * 3) : 0;
    },
    effet(quoi, i, k) {
      void k;
      const t = tLocal;
      switch (quoi) {
        case "casserole": if (i !== undefined && casseroles[i]) casseroles[i].vitesse += 2.2; break;
        case "casseroles_rate": casseroles.forEach((c, j) => { c.vitesse += j === i ? 4 : 2.5 * (j % 2 ? 1 : -1); }); break;
        case "marmite": bouillonT = t; break;
        case "marmite_vide": bouillonT = -Infinity; break;
        case "marmite_pleine": couvercleT = t; bouillonT = t; break;
        case "congelateur": case "truffe_fondue": case "truffe_prise": givreT = t; break;
        case "truffe_servie": case "service": case "service_rate": flammeT = t; break;
        case "servi": serviT = t; flammeT = t; break;
        case "midi": lampeLabo.flashT = t; break;
        case "ecran": if (i !== undefined && ecrans[i]) { ecrans[i].flashT = t; ecrans[i].couleur = 0x40ff70; } break;
        case "ecrans_rate": for (const e of ecrans) { e.flashT = t; e.couleur = 0xff3a2a; } break;
        case "ecrans": for (const e of ecrans) { e.flashT = t + 0.6; e.couleur = 0x40ff70; } lampeLocal.flashT = t; break;
        case "billot": case "billot_plein": billotT = t; break;
      }
      void coupsVus;
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
