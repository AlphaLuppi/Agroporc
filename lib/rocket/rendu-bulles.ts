/**
 * Rocket Muche : bulles des réactions rapides au-dessus des voitures (three, navigateur seulement : charge `document`). Un sprite par voiture,
 * dont la texture (un canvas 2D) est redessinée à chaque nouvelle réaction ; la bulle suit la voiture, s'estompe (`opaciteBulle`) et disparaît
 * au bout de `BULLE_DUREE_S`. Ajoutée à la racine du stade (repère LOCAL, comme les voitures). Sans `document` (Node) ou sans contexte 2D :
 * tout est un no-op silencieux, une bulle manquée ne doit jamais casser une partie. Mouvement réduit : la bulle apparaît et disparaît sans fondu.
 */
import * as THREE from "three";
import type { Equipe } from "./contrat";
import { opaciteBulle } from "./reactions";
import { ajusterLuminance, couleurEquipe } from "./rendu-modele";
import type { Vec3 } from "./vec";

/** Dimensions de la texture (px) et de la bulle dans le monde (m). */
const LARGEUR_PX = 768;
const HAUTEUR_PX = 128;
const LARGEUR_M = 5.4;
const HAUTEUR_M = LARGEUR_M * (HAUTEUR_PX / LARGEUR_PX);
/** Hauteur de la bulle au-dessus du centre de la voiture (m). */
const DECALAGE_Y_M = 1.9;
/** Ordre de rendu : au-dessus des plaques de nom (9). */
const ORDRE_RENDU = 10;

export interface BullesReactions {
  /** affiche `texte` au-dessus de la voiture `idVoiture`, depuis l'instant `tS` (s, horloge d'image) */
  afficher(idVoiture: number, texte: string, equipe: Equipe, tS: number): void;
  /** place les bulles vivantes ; `position(id)` rend le centre de la voiture dans le repère du stade, ou null (voiture inconnue) */
  maj(position: (idVoiture: number) => Readonly<Vec3> | null, tS: number): void;
  /** masque tout (rejeu d'un but, nouvelle partie) */
  vider(): void;
  dispose(): void;
}

interface Bulle {
  sprite: THREE.Sprite;
  materiau: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture | null;
  canvas: HTMLCanvasElement | null;
  debutS: number;
  vivante: boolean;
}

function dessiner(canvas: HTMLCanvasElement, texte: string, equipe: Equipe): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const c = new THREE.Color().setRGB(...ajusterLuminance(couleurEquipe(equipe), 0.85));
  ctx.clearRect(0, 0, LARGEUR_PX, HAUTEUR_PX);
  const marge = 14;
  ctx.fillStyle = "rgba(4,8,12,0.78)";
  ctx.strokeStyle = `#${c.getHexString()}`;
  ctx.lineWidth = 6;
  const x = marge, y = marge, l = LARGEUR_PX - 2 * marge, h = HAUTEUR_PX - 2 * marge, r = 26;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + l, y, x + l, y + h, r);
  ctx.arcTo(x + l, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + l, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.font = `700 46px "Chakra Petch", "IBM Plex Mono", ui-monospace, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#eaf4ff";
  ctx.fillText(texte, LARGEUR_PX / 2, HAUTEUR_PX / 2 + 2, LARGEUR_PX - 2 * marge - 36);
  return true;
}

export function creerBullesReactions(racine: THREE.Object3D, nVoitures: number, mouvementReduit: boolean): BullesReactions {
  const bulles: Bulle[] = [];
  const navigateur = typeof document !== "undefined";
  for (let i = 0; i < nVoitures; i++) {
    const materiau = new THREE.SpriteMaterial({ map: null, transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false, opacity: 0 });
    const sprite = new THREE.Sprite(materiau);
    sprite.scale.set(LARGEUR_M, HAUTEUR_M, 1);
    sprite.renderOrder = ORDRE_RENDU;
    sprite.visible = false;
    racine.add(sprite);
    let canvas: HTMLCanvasElement | null = null;
    let texture: THREE.CanvasTexture | null = null;
    if (navigateur) {
      canvas = document.createElement("canvas");
      canvas.width = LARGEUR_PX;
      canvas.height = HAUTEUR_PX;
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      materiau.map = texture;
    }
    bulles.push({ sprite, materiau, texture, canvas, debutS: 0, vivante: false });
  }

  return {
    afficher(id, texte, equipe, tS) {
      const b = bulles[id];
      if (!b || !b.canvas || !b.texture) return;
      try {
        if (!dessiner(b.canvas, texte, equipe)) return;
        b.texture.needsUpdate = true;
        b.debutS = tS;
        b.vivante = true;
      } catch { /* pas de contexte 2D : pas de bulle */ }
    },
    maj(position, tS) {
      for (let i = 0; i < bulles.length; i++) {
        const b = bulles[i];
        if (!b.vivante) continue;
        const age = tS - b.debutS;
        const op = opaciteBulle(age, mouvementReduit);
        const p = position(i);
        if (op <= 0 || !p) { b.vivante = false; b.sprite.visible = false; continue; }
        b.materiau.opacity = op;
        b.sprite.position.set(p[0], p[1] + DECALAGE_Y_M, p[2]);
        b.sprite.visible = true;
      }
    },
    vider() {
      for (const b of bulles) { b.vivante = false; b.sprite.visible = false; }
    },
    dispose() {
      for (const b of bulles) {
        b.sprite.removeFromParent();
        b.texture?.dispose();
        b.materiau.dispose();
      }
      bulles.length = 0;
    },
  };
}

