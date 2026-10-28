/**
 * Micro-ondes Gratinator (three, le Pack-a-Punch du mode zombies) : une vraie machine creuse posée sur son meuble, avec une cavité
 * modélisée (fond, parois, plafond, sol tapissés d'un matériau que la lumière intérieure colore), un plateau tournant, une porte à
 * charnière dont la vitre est transparente (trame métallique et reflets, dessinée APRÈS l'arme), un afficheur et un clavier. L'arme
 * déposée est visible dedans : elle entre porte ouverte, tourne sur le plateau sous une lumière orange qui pulse avec des étincelles, puis
 * ressort gratinée vers le joueur quand la porte se rouvre. Le déroulé est calculé par `microondes-anim.ts` (pur, testé) ; ici, seulement
 * la géométrie et son animation. Repère : celui du groupe passé (origine au pied du mur, +z vers la pièce, +x le long du mur).
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (Pack-a-Punch)
 */
import * as THREE from "three";
import type { ArmeFeuId, EtatPap } from "./protocole";
import { creerModeleArmeMonde } from "./rendu";
import { imageMicroondes } from "./microondes-anim";

const navigateur = typeof document !== "undefined";

/** Coque : largeur, hauteur, profondeur (m), hauteur de son centre (posée sur le meuble de 0,95 m). */
const L = 1.8, H = 0.85, P = 1.0, CY = 1.4;
/** Cavité : bornes en x, y, z (m, repère du groupe). */
const CAV = { x0: -0.8, x1: 0.26, y0: CY - 0.34, y1: CY + 0.34, z0: -0.42, z1: 0.46 };
const CX = (CAV.x0 + CAV.x1) / 2, CZ = (CAV.z0 + CAV.z1) / 2;
/** Porte : charnière à gauche, largeur, hauteur ; angle d'ouverture complète (rad, vers le joueur). */
const PORTE = { x: -L / 2, l: 1.24, h: 0.8, angle: 1.75 };
/** Longueur maximale (m) de l'arme posée : elle tourne sur le plateau sans traverser les parois. */
const ARME_MAX_M = 0.74;
/** Avancée de l'arme hors du plateau quand elle sort (m, vers la porte). */
const SORTIE_M = 0.62;
/** Couleurs : arme crue (éclairée de l'intérieur), arme gratinée, lumière de cuisson. */
const COULEUR_CRUE = 0xffb36b, COULEUR_GRATINEE = 0xd58cff, COULEUR_LUMIERE = new THREE.Color(0xff8a2a);

export interface RenduMicroondes {
  maj(pap: EtatPap, courant: boolean, tServeur: number, t: number, dt: number): void;
  dispose(): void;
}

interface Materiaux { fond: THREE.Material; ligne: THREE.LineBasicMaterial }

/** Toile (canvas) en texture, null hors navigateur. */
function toile(l: number, h: number, dessin: (c: CanvasRenderingContext2D) => void): { tex: THREE.CanvasTexture; c: CanvasRenderingContext2D } | null {
  if (!navigateur) return null;
  const cv = document.createElement("canvas");
  cv.width = l; cv.height = h;
  const c = cv.getContext("2d");
  if (!c) return null;
  dessin(c);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, c };
}

/** Vitre d'un micro-ondes : verre fumé, trame métallique perforée, deux reflets obliques. */
function dessinVitre(c: CanvasRenderingContext2D): void {
  const l = c.canvas.width, h = c.canvas.height;
  c.clearRect(0, 0, l, h);
  c.fillStyle = "rgba(30, 44, 58, 0.30)";
  c.fillRect(0, 0, l, h);
  // trame : la grille du blindage, des trous ronds sur fond un peu plus sombre
  c.fillStyle = "rgba(8, 12, 18, 0.32)";
  for (let y = 3; y < h; y += 7) for (let x = (y / 7) % 2 ? 3 : 6.5; x < l; x += 7) { c.beginPath(); c.arc(x, y, 1.4, 0, Math.PI * 2); c.fill(); }
  // reflets
  const reflet = (x0: number, largeur: number, a: number) => {
    const g = c.createLinearGradient(x0, 0, x0 + largeur, 0);
    g.addColorStop(0, "rgba(220,240,255,0)"); g.addColorStop(0.5, `rgba(220,240,255,${a})`); g.addColorStop(1, "rgba(220,240,255,0)");
    c.save(); c.transform(1, 0, -0.45, 1, 0, 0); c.fillStyle = g; c.fillRect(x0, 0, largeur, h); c.restore();
  };
  reflet(l * 0.35, l * 0.12, 0.22);
  reflet(l * 0.55, l * 0.05, 0.16);
  // liseré intérieur
  c.strokeStyle = "rgba(155, 233, 255, 0.35)"; c.lineWidth = 3; c.strokeRect(1.5, 1.5, l - 3, h - 3);
}

/** Clavier du panneau de commande : touches et bouton d'ouverture. */
function dessinClavier(c: CanvasRenderingContext2D): void {
  const l = c.canvas.width, h = c.canvas.height;
  c.fillStyle = "#0a0d12"; c.fillRect(0, 0, l, h);
  c.strokeStyle = "rgba(155, 233, 255, 0.7)"; c.fillStyle = "rgba(155, 233, 255, 0.85)"; c.lineWidth = 3;
  c.font = `700 26px "Chakra Petch", ui-monospace, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
  const touches = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⏱", "0", "▶"];
  touches.forEach((x, i) => {
    const cx = 44 + (i % 3) * 84, cy = 34 + Math.floor(i / 3) * 52;
    c.beginPath(); c.roundRect(cx - 32, cy - 20, 64, 40, 8); c.stroke();
    c.fillText(x, cx, cy + 1);
  });
  c.fillStyle = "#ffd166"; c.beginPath(); c.roundRect(20, h - 56, l - 40, 40, 10); c.fill();
  c.fillStyle = "#0a0d12"; c.fillText("OUVRIR", l / 2, h - 35);
}

export function creerRenduMicroondes(g: THREE.Group, m: Materiaux): RenduMicroondes {
  const jetables: { dispose(): void }[] = [];
  const boite = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: Materiaux = m) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const aretes = new THREE.EdgesGeometry(geo);
    jetables.push(geo, aretes);
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    grp.add(new THREE.Mesh(geo, mat.fond), new THREE.LineSegments(aretes, mat.ligne));
    parent.add(grp);
    return grp;
  };
  const plan = (parent: THREE.Object3D, w: number, h: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const geo = new THREE.PlaneGeometry(w, h);
    jetables.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // ---- coque creuse : dessus, dessous, côtés, fond, cloison de la cavité, façade du panneau de commande ----
  const e = 0.04;
  boite(g, L, e, P, 0, CY + H / 2 - e / 2, 0);
  boite(g, L, e, P, 0, CY - H / 2 + e / 2, 0);
  boite(g, e, H, P, -L / 2 + e / 2, CY, 0);
  boite(g, e, H, P, L / 2 - e / 2, CY, 0);
  boite(g, L, H, e, 0, CY, -P / 2 + e / 2);
  boite(g, e, H, P, CAV.x1 + e / 2, CY, 0);
  const xPanneau = (CAV.x1 + e + L / 2) / 2, lPanneau = L / 2 - CAV.x1 - e;
  boite(g, lPanneau, H, e, xPanneau, CY, P / 2 - e / 2);
  // petits montants autour de l'ouverture (la porte vient s'y plaquer)
  boite(g, CAV.x1 - CAV.x0 + 0.1, 0.05, e, CX, CAV.y1 + 0.04, P / 2 - e / 2);
  boite(g, CAV.x1 - CAV.x0 + 0.1, 0.05, e, CX, CAV.y0 - 0.04, P / 2 - e / 2);

  // ---- cavité : tapisserie intérieure que la lumière colore ----
  const interieur = new THREE.MeshBasicMaterial({ color: 0x15181d, side: THREE.DoubleSide });
  jetables.push(interieur);
  const lc = CAV.x1 - CAV.x0, hc = CAV.y1 - CAV.y0, pc = CAV.z1 - CAV.z0, cy = (CAV.y0 + CAV.y1) / 2;
  plan(g, lc, hc, interieur, CX, cy, CAV.z0);
  plan(g, lc, pc, interieur, CX, CAV.y0, CZ).rotation.x = -Math.PI / 2;
  plan(g, lc, pc, interieur, CX, CAV.y1, CZ).rotation.x = Math.PI / 2;
  plan(g, pc, hc, interieur, CAV.x0, cy, CZ).rotation.y = Math.PI / 2;
  plan(g, pc, hc, interieur, CAV.x1, cy, CZ).rotation.y = -Math.PI / 2;
  // lampe du plafond et lueur de la cavité (additives)
  const lueurMat = new THREE.MeshBasicMaterial({ color: COULEUR_LUMIERE, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  jetables.push(lueurMat);
  const lueur = plan(g, lc * 0.95, hc * 0.95, lueurMat, CX, cy, CAV.z0 + 0.02);
  const lampeMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
  jetables.push(lampeMat);
  plan(g, 0.16, 0.08, lampeMat, CX + 0.3, CAV.y1 - 0.005, CZ - 0.2).rotation.x = Math.PI / 2;

  // ---- plateau tournant et support de l'arme ----
  const support = new THREE.Group();
  support.position.set(CX, CAV.y0, CZ);
  g.add(support);
  const verre = new THREE.MeshBasicMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.35, depthWrite: false });
  jetables.push(verre);
  const geoPlateau = new THREE.CylinderGeometry(0.34, 0.34, 0.014, 40);
  const aretesPlateau = new THREE.EdgesGeometry(geoPlateau, 30);
  jetables.push(geoPlateau, aretesPlateau);
  const plateau = new THREE.Group();
  plateau.position.y = 0.02;
  plateau.add(new THREE.Mesh(geoPlateau, verre), new THREE.LineSegments(aretesPlateau, m.ligne));
  support.add(plateau);
  const porteArme = new THREE.Group();
  porteArme.position.y = 0.14;
  support.add(porteArme);
  let modele: { arme: ArmeFeuId; gratinee: boolean; m: { group: THREE.Group; dispose(): void } } | null = null;
  let angle = Math.PI / 2;

  // ---- étincelles du magnétron ----
  const NB_ETINCELLES = 24;
  const posEt = new Float32Array(NB_ETINCELLES * 3);
  const geoEt = new THREE.BufferGeometry();
  geoEt.setAttribute("position", new THREE.BufferAttribute(posEt, 3));
  geoEt.setDrawRange(0, 0);
  const matEt = new THREE.PointsMaterial({ color: 0xfff1b8, size: 0.05, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  jetables.push(geoEt, matEt);
  const etincelles = new THREE.Points(geoEt, matEt);
  etincelles.frustumCulled = false;
  g.add(etincelles);

  // ---- porte : cadre, vitre transparente dessinée après l'arme, poignée ----
  const porte = new THREE.Group();
  porte.position.set(PORTE.x, CY, P / 2 + 0.015);
  g.add(porte);
  const cadre = (w: number, h: number, x: number, y: number) => boite(porte, w, h, 0.03, x, y, 0);
  const bord = 0.12;
  cadre(PORTE.l, bord, PORTE.l / 2, PORTE.h / 2 - bord / 2);
  cadre(PORTE.l, bord, PORTE.l / 2, -PORTE.h / 2 + bord / 2);
  cadre(bord, PORTE.h - 2 * bord, bord / 2, 0);
  cadre(bord * 1.6, PORTE.h - 2 * bord, PORTE.l - bord * 0.8, 0);
  boite(porte, 0.035, PORTE.h * 0.6, 0.05, PORTE.l - 0.07, 0, 0.05);
  const vitreTex = toile(256, 160, dessinVitre);
  if (vitreTex) jetables.push(vitreTex.tex);
  const vitreMat = new THREE.MeshBasicMaterial({
    map: vitreTex?.tex ?? null, color: 0xffffff, transparent: true, opacity: vitreTex ? 1 : 0.3, depthWrite: false, side: THREE.DoubleSide,
  });
  jetables.push(vitreMat);
  const lVitre = PORTE.l - bord - bord * 1.6, hVitre = PORTE.h - 2 * bord;
  const vitre = plan(porte, lVitre, hVitre, vitreMat, bord + lVitre / 2, 0, 0.002);
  // dessinée après l'arme et la cavité : l'arme se voit à travers, comme derrière une vraie vitre
  vitre.renderOrder = 20;

  // ---- panneau de commande : afficheur, clavier ----
  const affTex = toile(256, 80, () => undefined);
  if (affTex) jetables.push(affTex.tex);
  const affMat = new THREE.MeshBasicMaterial({ map: affTex?.tex ?? null, color: 0xffffff });
  jetables.push(affMat);
  plan(g, lPanneau * 0.8, 0.13, affMat, xPanneau, CY + 0.26, P / 2 + 0.002);
  const clavTex = toile(256, 300, dessinClavier);
  if (clavTex) jetables.push(clavTex.tex);
  const clavMat = new THREE.MeshBasicMaterial({ map: clavTex?.tex ?? null, color: 0xffffff });
  jetables.push(clavMat);
  plan(g, lPanneau * 0.72, 0.5, clavMat, xPanneau, CY - 0.1, P / 2 + 0.002);
  let affichageVu = "\u0000";

  function majAfficheur(texte: string, alarme: boolean, t: number): void {
    // clignote quand c'est prêt (vite pendant l'alarme)
    const eteint = texte === "PRÊT" && Math.floor(t * (alarme ? 6 : 2)) % 2 === 1;
    const cle = `${texte}|${eteint}|${alarme}`;
    if (cle === affichageVu || !affTex) return;
    affichageVu = cle;
    const c = affTex.c;
    c.fillStyle = "#05070a"; c.fillRect(0, 0, 256, 80);
    if (texte && !eteint) {
      c.fillStyle = alarme ? "#ff5a3c" : "#7dff7a";
      c.shadowColor = c.fillStyle; c.shadowBlur = 10;
      c.font = `700 ${texte.length > 6 ? 30 : 48}px "IBM Plex Mono", ui-monospace, monospace`; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(texte, 128, 42);
      c.shadowBlur = 0;
    }
    affTex.tex.needsUpdate = true;
  }

  function poserModele(arme: ArmeFeuId, gratinee: boolean): void {
    if (modele?.arme === arme && modele.gratinee === gratinee) return;
    modele?.m.dispose();
    const mm = creerModeleArmeMonde(arme, gratinee ? COULEUR_GRATINEE : COULEUR_CRUE);
    // à l'échelle de la cavité : la plus grande dimension tient sur le plateau
    const taille = new THREE.Box3().setFromObject(mm.group).getSize(new THREE.Vector3());
    const k = Math.min(1.3, ARME_MAX_M / Math.max(0.05, taille.x, taille.y, taille.z));
    mm.group.scale.setScalar(k);
    porteArme.add(mm.group);
    modele = { arme, gratinee, m: mm };
  }

  return {
    maj(pap, courant, tServeur, t, dt) {
      const im = imageMicroondes(pap, tServeur, courant);
      porte.rotation.y += (-im.porte * PORTE.angle - porte.rotation.y) * (1 - Math.exp(-dt * 18));
      // l'arme : posée sur le plateau (cuisson), ou qui glisse vers la porte (entrée, sortie, reprise)
      if (im.arme && pap.arme) {
        poserModele(pap.arme, im.gratinee);
        modele!.m.group.visible = true;
      } else if (modele) {
        modele.m.dispose();
        modele = null;
      }
      if (im.plateau) angle += dt * 1.6;
      else {
        // hors cuisson, l'arme se présente de profil, canon le long de la porte
        const vise = Math.PI / 2 + Math.round((angle - Math.PI / 2) / (2 * Math.PI)) * 2 * Math.PI;
        angle += (vise - angle) * (1 - Math.exp(-dt * 6));
      }
      plateau.rotation.y = angle;
      porteArme.rotation.y = angle;
      support.position.z = CZ + im.avance * SORTIE_M;
      porteArme.position.y = 0.14 + im.avance * 0.06;
      // lumière intérieure : la tapisserie et la lueur passent à l'orange, qui pulse pendant la cuisson
      const pulse = im.plateau ? 0.82 + 0.18 * Math.sin(t * 9) : 1;
      const k = im.lumiere * pulse;
      interieur.color.setRGB(0.08 + 0.55 * k, 0.09 + 0.3 * k, 0.11 + 0.08 * k);
      lueurMat.opacity = 0.35 * k;
      lampeMat.opacity = courant ? 0.15 + 0.5 * k : 0;
      void lueur;
      // étincelles : quelques points qui crépitent autour de l'arme
      if (im.etincelles) {
        const n = Math.floor(Math.random() * 9);
        for (let i = 0; i < n; i++) {
          posEt[i * 3] = CX + (Math.random() - 0.5) * 0.7;
          posEt[i * 3 + 1] = CAV.y0 + 0.08 + Math.random() * 0.32;
          posEt[i * 3 + 2] = CZ + (Math.random() - 0.5) * 0.6;
        }
        geoEt.setDrawRange(0, n);
        (geoEt.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      } else geoEt.setDrawRange(0, 0);
      majAfficheur(im.affichage, im.alarme, t);
    },
    dispose() {
      modele?.m.dispose();
      modele = null;
      for (const x of jetables) x.dispose();
      jetables.length = 0;
    },
  };
}
