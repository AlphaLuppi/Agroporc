/**
 * Barre des armes de l'écran de mort et de l'entracte (PUR, aucun three ni DOM) : les trois groupes d'armes choisissables (principale,
 * secondaire, arme blanche), le cycle des touches d'arme à l'écran de mort (la souris est prise, on ne clique pas), la flèche gauche / droite
 * entre tuiles, l'animation de la vitrine 3D (balancement lent, tour complet pour l'arme survolée ou choisie), la taille relative des modèles
 * et le découpage des tuiles dans le canvas partagé. Le rendu (`rendu-armes-apercu.ts`) et le composant (`BarreArmes.tsx`) ne font que l'appliquer.
 * Le choix part par le chemin habituel `equiper` (équipement de la PROCHAINE apparition) : le serveur le normalise lui-même (`normaliserEquipement`).
 */
import { MELEE, STATS } from "./armes";
import { ARMES, ARMES_MELEE, type ArmeFeuId, type ArmeId, type ArmeMeleeId, type ArmePrincipaleId, type ArmeSecondaireId } from "./protocole";

export type GroupeBarre = "principale" | "secondaire" | "melee";

export interface TuileBarre {
  id: ArmeId;
  groupe: GroupeBarre;
  nom: string;
  choisie: boolean;
}

export interface GroupeTuiles {
  cle: GroupeBarre;
  /** « Principale », « Secondaire », « Blanche » */
  titre: string;
  tuiles: TuileBarre[];
}

export interface ChoixBarre {
  principale: ArmePrincipaleId;
  secondaire: ArmeSecondaireId;
  melee?: ArmeMeleeId;
}

const TITRES: Record<GroupeBarre, string> = { principale: "Principale", secondaire: "Secondaire", melee: "Blanche" };

/** Armes à feu de l'arène d'une catégorie (celles des zombies n'y sont jamais proposées), dans l'ordre du catalogue. */
export function armesDeLaBarre(groupe: "principale" | "secondaire"): ArmeFeuId[] {
  return ARMES.filter((id) => STATS[id].categorie === groupe && !STATS[id].zombiesSeulement);
}

/** Les trois groupes de tuiles, avec l'arme choisie dans chacun (couteau si `melee` est absent). */
export function groupesBarre(choix: ChoixBarre): GroupeTuiles[] {
  const melee = choix.melee ?? "couteau";
  const tuile = (id: ArmeId, groupe: GroupeBarre, nom: string, choisie: string): TuileBarre => ({ id, groupe, nom, choisie: id === choisie });
  return [
    { cle: "principale", titre: TITRES.principale, tuiles: armesDeLaBarre("principale").map((id) => tuile(id, "principale", STATS[id].nom, choix.principale)) },
    { cle: "secondaire", titre: TITRES.secondaire, tuiles: armesDeLaBarre("secondaire").map((id) => tuile(id, "secondaire", STATS[id].nom, choix.secondaire)) },
    { cle: "melee", titre: TITRES.melee, tuiles: ARMES_MELEE.map((id) => tuile(id, "melee", MELEE[id].nom, melee)) },
  ];
}

/** Équipement après le choix de `id` : change l'arme de son groupe seulement ; l'arme blanche est toujours rendue explicitement. */
export function choixApres(choix: ChoixBarre, id: ArmeId): [ArmePrincipaleId, ArmeSecondaireId, ArmeMeleeId] {
  const melee = choix.melee ?? "couteau";
  const groupe = groupesBarre(choix).find((g) => g.tuiles.some((t) => t.id === id))?.cle;
  if (groupe === "principale") return [id as ArmePrincipaleId, choix.secondaire, melee];
  if (groupe === "secondaire") return [choix.principale, id as ArmeSecondaireId, melee];
  if (groupe === "melee") return [choix.principale, choix.secondaire, id as ArmeMeleeId];
  return [choix.principale, choix.secondaire, melee];
}

/** Arme suivante du groupe, circulaire (touches 1 / 2 / 3 de l'écran de mort : une pression = l'arme d'après). */
export function armeSuivante(choix: ChoixBarre, groupe: GroupeBarre): ArmeId {
  const g = groupesBarre(choix).find((x) => x.cle === groupe)!;
  const i = g.tuiles.findIndex((t) => t.choisie);
  return g.tuiles[(i + 1) % g.tuiles.length].id;
}

/**
 * Équipement après une pression de la touche du groupe (armePrincipale / armeSecondaire / couteau) : l'arme d'après dans ce groupe, les deux autres
 * sont gardées.
 */
export function equipementApresTouche(choix: ChoixBarre, groupe: GroupeBarre): [ArmePrincipaleId, ArmeSecondaireId, ArmeMeleeId] {
  return choixApres(choix, armeSuivante(choix, groupe));
}

/** Tuile voisine dans la rangée à plat (flèches ← →), sans boucle : les bords restent en place. */
export function tuileVoisine(choix: ChoixBarre, depuis: ArmeId, sens: -1 | 1): ArmeId {
  const toutes = groupesBarre(choix).flatMap((g) => g.tuiles.map((t) => t.id));
  const i = toutes.indexOf(depuis);
  if (i < 0) return toutes[0];
  return toutes[Math.max(0, Math.min(toutes.length - 1, i + sens))];
}

// ---------- vitrine 3D ----------

/** État animé d'une tuile : phase du balancement, amplitude (rad) et échelle, lissés d'une image à l'autre pour que rien ne saute. */
export interface EtatTuile { phase: number; amplitude: number; echelle: number }

export const ETAT_TUILE_INITIAL: Readonly<EtatTuile> = Object.freeze({ phase: 0, amplitude: 0.7, echelle: 1 });

/** Réglages de la vitrine : balancement de ±0,7 rad au repos, tour complet (±π) pour l'arme survolée ou au clavier, 1 rad/s de phase. */
export const VITRINE = Object.freeze({
  amplitudeRepos: 0.7,
  amplitudeActive: Math.PI,
  vitesseRepos: 0.5,
  vitesseActive: 1.1,
  echelleRepos: 1,
  echelleChoisie: 1.06,
  echelleActive: 1.14,
  /** temps de rattrapage (s) des valeurs lissées */
  lissage: 0.18,
  /** l'amplitude se rattrape plus lentement : le lacet ne saute pas quand une tuile devient active */
  lissageAmplitude: 0.35,
  /** vue de trois quarts : la mire s'incline un peu vers la caméra */
  tangage: 0.28,
  /** lacet de base : le canon vers la droite de la tuile (−z du modèle → +x de l'écran) */
  lacetBase: -Math.PI / 2,
  /** déphasage entre deux tuiles voisines, pour que la rangée ne danse pas à l'unisson */
  dephasage: 0.9,
});

const rattrape = (courant: number, cible: number, dt: number, tau: number = VITRINE.lissage): number => courant + (cible - courant) * (1 - Math.exp(-dt / tau));

/**
 * Pas d'animation d'une tuile. `actif` = survolée ou au focus clavier ; `choisie` = l'arme de la prochaine apparition. Mouvement réduit : plus aucune
 * rotation (vue fixe de trois quarts), seule la taille signale encore la tuile.
 */
export function pasTuile(e: EtatTuile, dt: number, o: { actif: boolean; choisie: boolean; mouvementReduit: boolean }): EtatTuile {
  const pas = Math.max(0, Math.min(dt, 0.25));
  const cibleAmp = o.mouvementReduit ? 0 : o.actif ? VITRINE.amplitudeActive : VITRINE.amplitudeRepos;
  const cibleEch = o.actif ? VITRINE.echelleActive : o.choisie ? VITRINE.echelleChoisie : VITRINE.echelleRepos;
  const vitesse = o.mouvementReduit ? 0 : o.actif ? VITRINE.vitesseActive : VITRINE.vitesseRepos;
  return {
    phase: (e.phase + vitesse * pas) % (Math.PI * 2 * 1000),
    amplitude: rattrape(e.amplitude, cibleAmp, pas, VITRINE.lissageAmplitude),
    echelle: rattrape(e.echelle, cibleEch, pas),
  };
}

/** Lacet (rad) d'une tuile : vue de côté, canon vers la droite, balancement sinusoïdal (tour complet quand l'amplitude atteint π). */
export const lacetTuile = (e: EtatTuile, decalage = 0): number => VITRINE.lacetBase + Math.sin(e.phase + decalage) * e.amplitude;

/**
 * Taille relative d'un modèle dans sa tuile : l'arme la plus longue remplit la tuile, un pistolet en occupe la moitié (racine, pour que les petites
 * armes restent lisibles). `longueur` en mètres.
 */
export function tailleRelative(longueur: number, longueurMax: number): number {
  if (!(longueur > 0) || !(longueurMax > 0)) return 1;
  return Math.max(0.35, Math.min(1, Math.pow(longueur / longueurMax, 0.45)));
}

/** Distance de la caméra pour qu'une sphère de rayon `rayon` tienne dans la hauteur d'un champ vertical de `fovDeg` degrés (et dans la largeur selon `aspect`). */
export function distanceCamera(rayon: number, fovDeg: number, aspect: number): number {
  const demi = (fovDeg * Math.PI) / 360;
  const marge = 1.12;
  const vertical = rayon / Math.sin(demi);
  const horizontal = rayon / Math.sin(Math.atan(Math.tan(demi) * Math.max(0.2, aspect)));
  return marge * Math.max(vertical, horizontal);
}

// ---------- découpage dans le canvas partagé ----------

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Intersection de la tuile avec la zone visible (le conteneur défilant de la barre) ; `null` si elle est hors champ ou trop petite pour être dessinée.
 * Les rectangles sont dans le même repère (page ou viewport).
 */
export function rectVisible(tuile: Rect, zone: Rect, minPx = 4): Rect | null {
  const x0 = Math.max(tuile.x, zone.x), y0 = Math.max(tuile.y, zone.y);
  const x1 = Math.min(tuile.x + tuile.w, zone.x + zone.w), y1 = Math.min(tuile.y + tuile.h, zone.y + zone.h);
  if (x1 - x0 < minPx || y1 - y0 < minPx) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Viewport WebGL (origine en bas à gauche) de la tuile entière et scissor de sa partie visible, depuis des rectangles du viewport de la fenêtre et le
 * canvas qui les couvre. Le viewport reste celui de la tuile entière même si elle est rognée : le modèle ne se déforme pas, il est seulement coupé.
 */
export function cadrageGl(tuile: Rect, visible: Rect, canvas: Rect): { viewport: Rect; scissor: Rect } {
  const conv = (r: Rect): Rect => ({ x: r.x - canvas.x, y: canvas.h - (r.y - canvas.y + r.h), w: r.w, h: r.h });
  return { viewport: conv(tuile), scissor: conv(visible) };
}

/** Rapport largeur / hauteur d'une tuile, borné pour la caméra (jamais 0). */
export const aspectTuile = (r: Rect): number => (r.h > 0 ? Math.max(0.2, r.w / r.h) : 1);

/**
 * Ligne d'aide sous la barre quand la souris est prise : les touches réelles du joueur (jamais « 1 2 3 » écrit en dur) ; les touches sans
 * assignation (« non assignée », « — », vide) sont écartées.
 */
export function aideBarreArmes(touchePrincipale: string, toucheSecondaire: string, toucheBlanche: string): string {
  const touches = [touchePrincipale, toucheSecondaire, toucheBlanche].filter((t) => t && t !== "—" && t !== "non assignée");
  const cliquer = "Échap : souris";
  return touches.length === 0 ? cliquer : `${touches.join(" ")} : arme suivante · ${cliquer}`;
}
