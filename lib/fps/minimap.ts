/**
 * Projection de la mini-map (PUR) : monde (x est, z sud, nord = −z) → carré de la carte, mode « regard » (la carte tourne avec le lacet,
 * le joueur est à 58 % de la hauteur) ou « nord » (centré), rayon automatique en voiture, marqueurs hors cadre collés au bord.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§4.2)
 *
 * Convention d'angle d'écran de ce module : « θ » est une rotation de canvas (sens horaire, 0 = vers le haut), donc un objet orienté
 * dans le monde par le cap `c` (0 = −z) est dessiné avec `rotate(θ)` où θ = ψ − c en mode regard et −c en mode nord (`capEcranObjet`).
 */
import type { SceneData } from "../agroparc3d/types";
import { restoParNom } from "../restaurants";
import { ROND_POINT, positionElsa } from "./zones";
import { BORNES_ZOMBIES, INDEX_PREMIERE_PIECE } from "./zombies-carte";
import type { CoinMinimap, OrientationMinimap, RayonMinimap, TailleMinimap } from "./reglages-hud";

/** Ancre du joueur (fraction de la hauteur) : 58 % en mode regard (voir plus loin devant), 50 % en mode nord. */
export const ANCRE_REGARD = 0.58;
export const ANCRE_NORD = 0.5;
/** Côté de la carte en unités HUD `u` (S 208, M 264, L 320). */
export const TAILLE_CARTE_U: Record<TailleMinimap, number> = { s: 208, m: 264, l: 320 };
/** En voiture, le rayon croît jusqu'à ×1,6 avec la vitesse (plafonnée à 24 m/s). */
export const FACTEUR_RAYON_VOITURE = { max: 1.6, vitesseMax: 24 } as const;
/** Échos de tir arrondis à 8 m. */
export const PAS_ECHO_M = 8;
/** Sous cette hauteur de fenêtre (px), la carte est de taille S d'office (§4.1). */
export const HAUTEUR_FENETRE_PETITE_PX = 700;
/** Marge autour des bâtiments pour la zone jouable (m), biseau du coin intérieur (u), position du « N » (fraction du côté). */
export const MARGE_ZONE_M = 60;
export const BISEAU_U = 10;
export const RAYON_NORD = 0.46;
/** Cône de vue (rad, ouverture totale) et portée (m). */
export const CONE_VUE = { ouverture: Math.PI / 2, porteeM: 40 } as const;

/** Ce qu'il faut pour projeter : position et orientation du joueur, taille en px de la carte, demi-largeur en m, mode. */
export interface VueCarte {
  /** joueur (monde) */
  px: number; pz: number;
  /** lacet, ou cap de la voiture quand on est assis */
  psi: number;
  /** côté de la carte (px) */
  taille: number;
  rayonM: number;
  mode: OrientationMinimap;
}

/** Ancre verticale du joueur selon le mode (fraction de la hauteur). */
export function ancre(mode: OrientationMinimap): number {
  return mode === "regard" ? ANCRE_REGARD : ANCRE_NORD;
}
/** Pixels de carte par mètre. */
export function echelleCarte(taille: number, rayonM: number): number {
  return taille / 2 / Math.max(1e-6, rayonM);
}
/** Rotation de la carte (rad) : le lacet en mode regard, 0 en mode nord. */
export function rotationCarte(vue: Pick<VueCarte, "mode" | "psi">): number {
  return vue.mode === "regard" ? vue.psi : 0;
}

/** Comme `versCarte`, mais écrit dans `out` (boucle de dessin : aucune allocation par marqueur). */
export function projeter(vue: VueCarte, x: number, z: number, out: { x: number; y: number }): void {
  const k = echelleCarte(vue.taille, vue.rayonM);
  const dx = x - vue.px, dz = z - vue.pz;
  const psi = rotationCarte(vue);
  const c = Math.cos(psi), s = Math.sin(psi);
  out.x = vue.taille / 2 + k * (dx * c - dz * s);
  out.y = ancre(vue.mode) * vue.taille + k * (dx * s + dz * c);
}
/** Point de la carte (px, origine en haut à gauche du carré). */
export function versCarte(vue: VueCarte, x: number, z: number): { x: number; y: number } {
  const p = { x: 0, y: 0 };
  projeter(vue, x, z, p);
  return p;
}

/** Rayon effectif : `base × (1 + 0,6·min(vitesse, 24)/24)` (à lisser côté appelant avec `lissage` de vue.ts). */
export function rayonAuto(base: RayonMinimap | number, vitesse: number): number {
  const { max, vitesseMax } = FACTEUR_RAYON_VOITURE;
  const v = Number.isFinite(vitesse) ? Math.min(vitesseMax, Math.max(0, vitesse)) : 0;
  return base * (1 + (max - 1) * (v / vitesseMax));
}
export function estDansCarte(px: number, py: number, taille: number, marge: number): boolean {
  return px >= marge && px <= taille - marge && py >= marge && py <= taille - marge;
}
/**
 * Marqueur hors cadre : point collé au bord (à `marge`) sur le rayon qui part du joueur (`ancre`, fraction de la hauteur, 0,5 par défaut) vers
 * (px, py), et angle du chevron (rotation de canvas, 0 = vers le haut). Un point déjà dans le cadre est rendu tel quel.
 */
export function chevronBord(px: number, py: number, taille: number, marge: number, ancreY = 0.5): { x: number; y: number; angle: number } {
  const ox = taille / 2, oy = ancreY * taille;
  const dx = px - ox, dy = py - oy;
  // Angle de canvas depuis le haut, sens horaire : direction (dx, dy) ↔ (sin θ, −cos θ).
  const angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dx, -dy);
  if (estDansCarte(px, py, taille, marge)) return { x: px, y: py, angle };
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (taille - marge - ox) / dx);
  else if (dx < 0) t = Math.min(t, (marge - ox) / dx);
  if (dy > 0) t = Math.min(t, (taille - marge - oy) / dy);
  else if (dy < 0) t = Math.min(t, (marge - oy) / dy);
  if (!Number.isFinite(t)) return { x: ox, y: oy, angle };
  return { x: ox + dx * t, y: oy + dy * t, angle };
}
/** Rotation de canvas d'un objet de cap `cap` (0 = −z) : ψ − cap en mode regard, −cap en mode nord. */
export function capEcranObjet(mode: OrientationMinimap, psi: number, cap: number): number {
  return mode === "regard" ? psi - cap : -cap;
}
/** Angle d'écran du triangle du joueur : vers le haut en mode regard, vers (−sinψ, −cosψ) en mode nord. */
export function capEcran(mode: OrientationMinimap, lacet: number): number {
  return capEcranObjet(mode, lacet, lacet);
}
/** Position du « N » qui orbite sur le bord : projection du vecteur nord (0, −1) à 0,46·taille du centre du carré. */
export function positionNord(mode: OrientationMinimap, psi: number, taille: number): { x: number; y: number } {
  const p = mode === "regard" ? psi : 0;
  return { x: taille / 2 + RAYON_NORD * taille * Math.sin(p), y: taille / 2 - RAYON_NORD * taille * Math.cos(p) };
}
/** Arrondi à un pas (échos de tir à 8 m). */
export function arrondi(v: number, pas: number): number {
  if (!(pas > 0)) return v;
  // +0 : Math.round(−0,3) donnerait −0.
  return Math.round(v / pas) * pas + 0;
}
/** Côté effectif de la carte : S d'office sous 700 px de hauteur de fenêtre. */
export function tailleEffective(taille: TailleMinimap, hauteurFenetrePx: number): TailleMinimap {
  return hauteurFenetrePx < HAUTEUR_FENETRE_PETITE_PX ? "s" : taille;
}

export interface ZoneJouable { x0: number; z0: number; x1: number; z1: number }

/**
 * La scène est celle du mode zombies (`donneesZombies(scene).data` : les 20 pièces synthétiques sont ajoutées à la fin de `buildings`) :
 * `ZONE_CARTE` s'y restreint tout seul aux bornes de la zone de jeu, sans que l'appelant ait à passer le mode.
 */
export function estSceneZombies(scene: SceneData): boolean {
  // la première pièce synthétique porte un `type` (jamais dans scene.json) : un jour où scene.json grossirait ne bascule pas l'arène en zombies
  return scene.buildings.length > INDEX_PREMIERE_PIECE && scene.buildings[INDEX_PREMIERE_PIECE].type !== undefined;
}
/**
 * Zone jouable de la carte : boîte englobante des bâtiments + marge de 60 m, élargie (sans marge) aux parkings, aux POI et à Elsa quand ils
 * dépassent (les parkings les plus éloignés sortent de la boîte à marge : z jusqu'à 379 m contre 301 m). Contient donc toujours les
 * apparitions (anneau de 140 m autour du rond-point), Elsa et les parkings.
 */
export function ZONE_CARTE(scene: SceneData, mode: "arene" | "zombies" = estSceneZombies(scene) ? "zombies" : "arene"): ZoneJouable {
  // mode zombies : la carte se limite aux bornes de la zone de jeu (aucun parking, POI ni Elsa hors d'elles)
  if (mode === "zombies") return { x0: BORNES_ZOMBIES.x0, z0: BORNES_ZOMBIES.z0, x1: BORNES_ZOMBIES.x1, z1: BORNES_ZOMBIES.z1 };
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const b of scene.buildings) {
    for (const [x, z] of b.r) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
  }
  if (!Number.isFinite(x0)) { x0 = z0 = -MARGE_ZONE_M; x1 = z1 = MARGE_ZONE_M; }
  x0 -= MARGE_ZONE_M; z0 -= MARGE_ZONE_M; x1 += MARGE_ZONE_M; z1 += MARGE_ZONE_M;
  const inclure = (x: number, z: number) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  };
  for (const p of scene.parkings) for (const [x, z] of p) inclure(x, z);
  for (const p of scene.pois) inclure(p.x, p.z);
  const [ex, ez] = positionElsa(scene);
  inclure(ex, ez);
  return { x0, z0, x1, z1 };
}

/** Projection linéaire de toute la zone sur un rectangle `largeurPx × hauteurPx` (grande carte : nord en haut). */
export function versZone(zone: ZoneJouable, largeurPx: number, hauteurPx: number, x: number, z: number): { x: number; y: number } {
  return {
    x: ((x - zone.x0) / Math.max(1e-6, zone.x1 - zone.x0)) * largeurPx,
    y: ((z - zone.z0) / Math.max(1e-6, zone.z1 - zone.z0)) * hauteurPx,
  };
}

/** Transformation inverse de versZone : convertit un point écran (px) en coordonnées monde (x, z). */
export function depuisZone(zone: ZoneJouable, largeurPx: number, hauteurPx: number, px: number, py: number): { x: number; z: number } {
  return {
    x: zone.x0 + (px / Math.max(1e-6, largeurPx)) * (zone.x1 - zone.x0),
    z: zone.z0 + (py / Math.max(1e-6, hauteurPx)) * (zone.z1 - zone.z0),
  };
}

/**
 * Matrice 2D (a, b, c, d, e, f de `setTransform`) qui place la couche statique : un pixel (u, v) de la couche est le point monde
 * (x0 + u/échelle, z0 + v/échelle), projeté exactement comme `versCarte`.
 */
export function matriceCouche(vue: VueCarte, couche: { echelle: number; x0: number; z0: number }): [number, number, number, number, number, number] {
  const k = echelleCarte(vue.taille, vue.rayonM);
  const psi = rotationCarte(vue);
  const c = Math.cos(psi), s = Math.sin(psi);
  const f = k / couche.echelle;
  const o = versCarte(vue, couche.x0, couche.z0);
  return [f * c, f * s, -f * s, f * c, o.x, o.y];
}

/** Nom court d'un POI pour la carte : « Trèfle », « Mijote », « Truck », « CBA »… (nom complet si inconnu). */
export function nomCourtPoi(poi: { name: string; type: string }): string {
  if (poi.type === "home") return "CBA";
  if (poi.type === "truck") return "Truck";
  return restoParNom(poi.name)?.court ?? poi.name;
}

/** Nom de la zone sous la légende : POI le plus proche à moins de 40 m, sinon « Rond-point » à moins de 25 m, sinon null. */
export function nomZone(scene: SceneData, x: number, z: number): string | null {
  let meilleur: string | null = null, dMin = 40;
  for (const p of scene.pois) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < dMin) { dMin = d; meilleur = p.type === "truck" ? "Truck Muche" : p.type === "home" ? "CBA" : p.name; }
  }
  if (meilleur) return meilleur;
  return Math.hypot(ROND_POINT.centre[0] - x, ROND_POINT.centre[1] - z) < 25 ? "Rond-point" : null;
}

/**
 * Polygone du cadre : carré dont le coin tourné vers le centre de l'écran (coin intérieur) est biseauté de `biseau` px.
 * hg → biseau en bas à droite, hd → en bas à gauche, bg → en haut à droite, bd → en haut à gauche. Points dans le sens horaire.
 */
export function polygoneCadre(taille: number, biseau: number, coin: CoinMinimap): [number, number][] {
  const t = taille, b = Math.max(0, Math.min(biseau, taille / 2));
  const hg: [number, number] = [0, 0], hd: [number, number] = [t, 0], bd: [number, number] = [t, t], bg: [number, number] = [0, t];
  const pts: [number, number][] = [];
  const coinCoupe = coin === "hg" ? "bd" : coin === "hd" ? "bg" : coin === "bg" ? "hd" : coin === "bd" ? "hg" : null;
  const sommets: { n: string; p: [number, number]; avant: [number, number]; apres: [number, number] }[] = [
    { n: "hg", p: hg, avant: [0, b], apres: [b, 0] },
    { n: "hd", p: hd, avant: [t - b, 0], apres: [t, b] },
    { n: "bd", p: bd, avant: [t, t - b], apres: [t - b, t] },
    { n: "bg", p: bg, avant: [b, t], apres: [0, t - b] },
  ];
  for (const s of sommets) {
    if (s.n === coinCoupe && b > 0) { pts.push(s.avant, s.apres); } else pts.push(s.p);
  }
  return pts;
}

/**
 * Cadence adaptative (§4.1) : si la moyenne du temps de dessin dépasse 4 ms sur 60 images, la carte passe à 30 Hz (jamais en dessous) ;
 * elle repasse à 60 Hz après 120 images sous 2 ms. `autoriser()` dit si l'image courante doit être dessinée.
 */
export class Cadence {
  static readonly SEUIL_LENT_MS = 4;
  static readonly SEUIL_RAPIDE_MS = 2;
  static readonly FENETRE_LENT = 60;
  static readonly FENETRE_RAPIDE = 120;
  private readonly mesures = new Float64Array(Cadence.FENETRE_RAPIDE);
  private n = 0;
  private i = 0;
  private saut = false;
  reduit = false;

  /** Enregistre le temps de dessin (ms) d'une image réellement dessinée. */
  noter(ms: number): void {
    this.mesures[this.i] = ms;
    this.i = (this.i + 1) % this.mesures.length;
    this.n = Math.min(this.n + 1, this.mesures.length);
    if (!this.reduit && this.n >= Cadence.FENETRE_LENT && this.moyenne(Cadence.FENETRE_LENT) > Cadence.SEUIL_LENT_MS) {
      this.reduit = true;
      this.n = 0;
    } else if (this.reduit && this.n >= Cadence.FENETRE_RAPIDE && this.moyenne(Cadence.FENETRE_RAPIDE) < Cadence.SEUIL_RAPIDE_MS) {
      this.reduit = false;
      this.n = 0;
    }
  }
  /** Moyenne des `fenetre` dernières mesures. */
  private moyenne(fenetre: number): number {
    const m = Math.min(fenetre, this.n);
    let somme = 0;
    for (let k = 1; k <= m; k++) somme += this.mesures[(this.i - k + this.mesures.length) % this.mesures.length];
    return m ? somme / m : 0;
  }
  /** Une image sur deux est sautée à 30 Hz. */
  autoriser(): boolean {
    if (!this.reduit) { this.saut = false; return true; }
    this.saut = !this.saut;
    return this.saut;
  }
}
