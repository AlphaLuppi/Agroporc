/**
 * Données de la mini-map et de la flèche d'Elsa (PUR : ni three ni DOM). `jeu.ts` remplit UN SEUL `RadarFrame`
 * préalloué à chaque appel de `JeuHandle.radar()` (tableaux réutilisés, zéro allocation par image) ; la mini-map le lit en rAF.
 *
 * Visibilité SANS wallhack : un joueur n'est dessiné que s'il est `vu` (champ de vision + ligne de vue de `visibilite.ts`,
 * sans plafond de distance), ou s'il occupe mon véhicule. Voitures PNJ : calculées avec `circulation.ts` à l'horloge
 * serveur, à moins de 100 m. Échos de tir : tout tir à moins de 70 m dont le tireur n'est pas `vu`.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§3.3)
 */

import { angleRelatif } from "./vue";
import { arrondi } from "./minimap";

export interface RadarJoueur {
  id: string; x: number; z: number; cap: number; couleur: string;
  /** à pied | en voiture | mort (croix 3 s) */
  etat: "pied" | "voiture" | "mort";
  /** 0..1 : vu à l'écran (pas de wallhack), s'estompe sur 0,6 s */
  vu: number;
  /** âge en s depuis la mort si etat === "mort" */
  age: number;
}
export interface RadarVoiture { id: number; x: number; z: number; cap: number; occupants: number; places: number; moi: boolean }
export interface RadarEcho { x: number; z: number; age: number }
export interface RadarElsa { x: number; z: number; genre: "soin" | "arme"; finT: number; angle: number; distance: number }

export interface RadarFrame {
  /** moi */
  x: number; z: number; lacet: number;
  /** cap de la voiture si je suis assis, sinon NaN */
  capVehicule: number;
  vitesse: number;
  joueurs: RadarJoueur[]; nJoueurs: number;           // préalloué à 16
  voituresPnj: Float32Array; nPnj: number;             // [x, z, cap] × 12
  voitures: RadarVoiture[]; nVoitures: number;         // préalloué à 6
  echos: RadarEcho[]; nEchos: number;                  // préalloué à 8
  /** null hors offre ; angle relatif à ma vue (0 = devant, + = droite), distance en m */
  elsa: RadarElsa | null;
  /** Elsa présente même sans offre (losange fixe) */
  elsaPos: { x: number; z: number };
  /** mode zombies : tigres VUS [x, z, vu] × 24 (points rouges), portes encore fermées [px, pz, qx, qz] × 5 (grande carte) */
  zombies: Float32Array; nZombies: number;
  portes: Float32Array; nPortes: number;
  /** vrai en mode zombies : la carte est restreinte aux bornes de la zone de jeu (`ZONE_CARTE(scene, "zombies")`) */
  modeZombies: boolean;
  /** Bus C3 express */
  bus?: { x: number; z: number; cap: number; actif: boolean } | null;
  /** Zones de fumée actives */
  fumigenes?: { x: number; z: number; r: number }[];
  /** Zone de frappe aérienne en cours */
  frappeZone?: { x: number; z: number; r: number } | null;
}

/** Capacités des tableaux préalloués d'un `RadarFrame`. */
export const RADAR_CAPACITES = { joueurs: 16, voitures: 6, echos: 8, pnj: 12, zombies: 24, portes: 5 } as const;
/** Échos de tir sur la mini-map : activés ; une constante les coupe (choix de gameplay à valider, HUD §14). */
export const ECHOS_TIR = true;
export const ECHO = { rayonM: 70, dureeS: 1.2, pasM: 8 } as const;
/** Voitures PNJ dessinées à moins de cette distance (m), conduisibles à moins de `distanceVoituresM`. */
export const RADAR_PORTEES = { pnjM: 100, voituresM: 160 } as const;
/** Durée (s) pendant laquelle la croix d'un joueur mort reste affichée, et lissage de descente de `vu`. */
export const RADAR_DUREES = { croixMortS: 3, fonduVuS: 0.6 } as const;

/** Un `RadarFrame` vide dont les tableaux sont préalloués à leur capacité (aucune allocation ensuite). */
export function creerRadarFrame(): RadarFrame {
  return {
    x: 0, z: 0, lacet: 0, capVehicule: NaN, vitesse: 0,
    joueurs: Array.from({ length: RADAR_CAPACITES.joueurs }, () => ({ id: "", x: 0, z: 0, cap: 0, couleur: "#ffffff", etat: "pied" as const, vu: 0, age: 0 })),
    nJoueurs: 0,
    voituresPnj: new Float32Array(RADAR_CAPACITES.pnj * 3), nPnj: 0,
    voitures: Array.from({ length: RADAR_CAPACITES.voitures }, () => ({ id: 0, x: 0, z: 0, cap: 0, occupants: 0, places: 4, moi: false })),
    nVoitures: 0,
    echos: Array.from({ length: RADAR_CAPACITES.echos }, () => ({ x: 0, z: 0, age: 0 })),
    nEchos: 0,
    elsa: null,
    elsaPos: { x: 0, z: 0 },
    zombies: new Float32Array(RADAR_CAPACITES.zombies * 3), nZombies: 0,
    portes: new Float32Array(RADAR_CAPACITES.portes * 4), nPortes: 0,
    modeZombies: false,
  };
}

/** Remet les compteurs d'un `RadarFrame` à zéro avant un remplissage (les tableaux gardent leur identité et leur taille). */
export function viderRadarFrame(f: RadarFrame): void {
  f.nJoueurs = 0; f.nPnj = 0; f.nVoitures = 0; f.nZombies = 0; f.nPortes = 0;
  // Les échos sont persistants d'une image à l'autre (vieillis par `purgerEchos`), pas remis à zéro ici.
  f.elsa = null;
  f.capVehicule = NaN;
}

/**
 * Flèche vers Elsa : angle relatif à la vue (rad, 0 = devant, + = à droite) et distance arrondie à 10 m, calculés d'après
 * ma position (x, z), mon lacet et celle de la cible.
 */
export function repereElsa(x: number, z: number, lacet: number, cible: { x: number; z: number }): { angle: number; distance: number } {
  const dx = cible.x - x, dz = cible.z - z;
  const d = Math.hypot(dx, dz);
  return { angle: d < 1e-6 ? 0 : angleRelatif(lacet, dx, dz), distance: Math.round(d / 10) * 10 };
}

/** Renseigne `f.elsa` pour une offre en cours (angle et distance relatifs à ma vue) ; `null` hors offre. */
export function definirElsa(f: RadarFrame, offre: { genre: "soin" | "arme"; finT: number } | null): void {
  if (!offre) { f.elsa = null; return; }
  const r = repereElsa(f.x, f.z, f.lacet, f.elsaPos);
  f.elsa = { x: f.elsaPos.x, z: f.elsaPos.z, genre: offre.genre, finT: offre.finT, angle: r.angle, distance: r.distance };
}

/**
 * Visibilité lissée d'un joueur : monte à 1 aussitôt qu'il est vu, redescend linéairement en `RADAR_DUREES.fonduVuS` (0,6 s) quand il
 * ne l'est plus. À utiliser avec la valeur précédente du même joueur (`RadarJoueur.vu` de l'image d'avant).
 */
export function lisserVu(vuPrecedent: number, estVu: boolean, dtS: number): number {
  if (estVu) return 1;
  return Math.max(0, vuPrecedent - Math.max(0, dtS) / RADAR_DUREES.fonduVuS);
}

/**
 * Ajoute un joueur au frame s'il doit être dessiné : `vu > 0` (jamais de joueur non vu, pas de wallhack) ; un mort ne reste que
 * `RADAR_DUREES.croixMortS` (3 s, croix). Renvoie vrai s'il a été ajouté. Aucune allocation : l'entrée préallouée est réécrite.
 */
export function ajouterJoueur(f: RadarFrame, j: { id: string; x: number; z: number; cap: number; couleur: string; etat: RadarJoueur["etat"]; vu: number; age?: number }): boolean {
  if (!(j.vu > 0)) return false;
  const age = j.age ?? 0;
  if (j.etat === "mort" && age >= RADAR_DUREES.croixMortS) return false;
  if (f.nJoueurs >= f.joueurs.length) return false;
  const e = f.joueurs[f.nJoueurs++];
  e.id = j.id; e.x = j.x; e.z = j.z; e.cap = j.cap; e.couleur = j.couleur; e.etat = j.etat; e.vu = Math.min(1, j.vu); e.age = age;
  return true;
}

/**
 * Ajoute un tigre zombie VU au frame (`vu` ∈ ]0, 1], jamais de tigre non vu : pas de wallhack) ; capacité 24 (le plafond de tigres vivants).
 * Renvoie vrai s'il a été ajouté.
 */
export function ajouterZombie(f: RadarFrame, x: number, z: number, vu: number): boolean {
  if (!(vu > 0) || f.nZombies >= RADAR_CAPACITES.zombies) return false;
  const i = f.nZombies++ * 3;
  f.zombies[i] = x; f.zombies[i + 1] = z; f.zombies[i + 2] = Math.min(1, vu);
  return true;
}

/** Ajoute une porte payante encore fermée (segment p → q, repère de la carte) ; capacité 5. */
export function ajouterPorte(f: RadarFrame, px: number, pz: number, qx: number, qz: number): boolean {
  if (f.nPortes >= RADAR_CAPACITES.portes) return false;
  const i = f.nPortes++ * 4;
  f.portes[i] = px; f.portes[i + 1] = pz; f.portes[i + 2] = qx; f.portes[i + 3] = qz;
  return true;
}

/** Ajoute une voiture PNJ si elle est à moins de `RADAR_PORTEES.pnjM` de moi (x, z du frame) et qu'il reste de la place. */
export function ajouterVoiturePnj(f: RadarFrame, x: number, z: number, cap: number): boolean {
  if (f.nPnj >= RADAR_CAPACITES.pnj) return false;
  if (Math.hypot(x - f.x, z - f.z) > RADAR_PORTEES.pnjM) return false;
  const i = f.nPnj++ * 3;
  f.voituresPnj[i] = x; f.voituresPnj[i + 1] = z; f.voituresPnj[i + 2] = cap;
  return true;
}

/** Ajoute une voiture conduisible si elle est à moins de `RADAR_PORTEES.voituresM` de moi (la mienne est toujours gardée). */
export function ajouterVoiture(f: RadarFrame, v: RadarVoiture): boolean {
  if (f.nVoitures >= f.voitures.length) return false;
  if (!v.moi && Math.hypot(v.x - f.x, v.z - f.z) > RADAR_PORTEES.voituresM) return false;
  const e = f.voitures[f.nVoitures++];
  e.id = v.id; e.x = v.x; e.z = v.z; e.cap = v.cap; e.occupants = v.occupants; e.places = v.places; e.moi = v.moi;
  return true;
}

/**
 * Enregistre l'écho d'un tir entendu (arrondi à `ECHO.pasM`) ; sans effet si `ECHOS_TIR` est coupé, si le tireur est vu (il est déjà
 * dessiné) ou à plus de `ECHO.rayonM` de moi. Un écho déjà présent à la même case est rafraîchi (une rafale n'inonde pas la carte) ;
 * file pleine : le plus ancien est remplacé. Renvoie vrai si un écho a été (re)posé.
 */
export function ajouterEcho(f: RadarFrame, x: number, z: number, tireurVu = false): boolean {
  if (!ECHOS_TIR || tireurVu) return false;
  if (Math.hypot(x - f.x, z - f.z) > ECHO.rayonM) return false;
  const ax = arrondi(x, ECHO.pasM), az = arrondi(z, ECHO.pasM);
  for (let i = 0; i < f.nEchos; i++) {
    const e = f.echos[i];
    if (e.x === ax && e.z === az) { e.age = 0; return true; }
  }
  let cible = f.nEchos;
  if (f.nEchos >= f.echos.length) {
    cible = 0;
    for (let i = 1; i < f.nEchos; i++) if (f.echos[i].age > f.echos[cible].age) cible = i;
  } else f.nEchos++;
  const e = f.echos[cible];
  e.x = ax; e.z = az; e.age = 0;
  return true;
}

/** Fait vieillir les échos de `dtS` secondes et purge ceux qui ont dépassé `ECHO.dureeS` (compactage en place, sans allocation). */
export function purgerEchos(f: RadarFrame, dtS: number): void {
  let n = 0;
  for (let i = 0; i < f.nEchos; i++) {
    const e = f.echos[i];
    e.age += dtS;
    if (e.age >= ECHO.dureeS) continue;
    if (n !== i) {
      // Échange pour que les objets préalloués restent tous distincts (aucun partage entre deux cases).
      const libre = f.echos[n];
      f.echos[n] = e; f.echos[i] = libre;
    }
    n++;
  }
  f.nEchos = n;
}
