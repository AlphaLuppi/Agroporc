import { CAUSES_MORT, type ArmeId, type CauseMort } from "./protocole";

/**
 * Pictogrammes du fil des éliminations (façon killfeed de Counter-Strike) : le profil de l'arme, ou l'emblème de la cause de mort,
 * en silhouette monochrome (`currentColor`). PUR, sans React ni DOM : le registre dit quoi dessiner, `PictoArme.tsx` le dessine.
 *
 * Toutes les silhouettes tiennent dans une boîte de `HAUTEUR_PICTO` unités de haut et de `largeur` unités de large (variable selon
 * l'arme : un pistolet est court, un sniper est long) ; les armes sont tournées vers la droite, le canon du côté de la victime.
 * Chaque entrée de `chemins` est un `<path>` à part (remplissage « evenodd » : un sous-tracé qui en recoupe un autre du MÊME chemin
 * y fait un trou, ce que les fenêtres du bus et les yeux du crâne utilisent).
 * `Record<ArmeId, …>` et `Record<CauseMort, …>` : ajouter une arme ou une cause au protocole sans pictogramme ne compile plus.
 */
export const HAUTEUR_PICTO = 20;

export interface Picto {
  /** identifiant stable (classe CSS, test) */
  id: string;
  /** largeur de la boîte, en unités ; la hauteur est toujours `HAUTEUR_PICTO` */
  largeur: number;
  /** tracés SVG remplis (un `<path>` chacun) */
  chemins: readonly string[];
}

// ---------- outils de dessin (nombres arrondis : la sortie est identique d'une machine à l'autre) ----------
const n = (x: number): string => String(Math.round(x * 100) / 100);
/** rectangle */
const r = (x: number, y: number, w: number, h: number): string => `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`;
/** ellipse (deux arcs) */
const e = (cx: number, cy: number, rx: number, ry = rx): string =>
  `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0z`;
/** polygone par ses sommets */
const p = (...pts: number[]): string => {
  let d = "";
  for (let i = 0; i < pts.length; i += 2) d += `${i === 0 ? "M" : "L"}${n(pts[i])} ${n(pts[i + 1])}`;
  return `${d}z`;
};
/** étoile à `branches` pointes (explosions, impacts) */
const etoile = (cx: number, cy: number, grand: number, petit: number, branches: number): string => {
  const pts: number[] = [];
  for (let i = 0; i < branches * 2; i++) {
    const a = (Math.PI * i) / branches - Math.PI / 2;
    const rayon = i % 2 === 0 ? grand : petit;
    pts.push(cx + rayon * Math.cos(a), cy + rayon * Math.sin(a));
  }
  return p(...pts);
};
const picto = (id: string, largeur: number, ...chemins: string[]): Picto => ({ id, largeur, chemins });

// ---------- silhouettes d'armes ----------

const PISTOLET = picto("pistolet", 22,
  r(2, 4, 18, 4.5), r(20, 5, 1.6, 2.5), r(3, 8.5, 13, 2), p(4, 10.5, 9.5, 10.5, 8.2, 18, 3.2, 18), r(11, 10.5, 4.5, 1.4));
const REVOLVER = picto("revolver", 24,
  r(3, 4, 9, 5), r(12, 4.5, 10, 2.6), r(12, 7, 8, 1.5), p(3, 9, 8, 9, 5.5, 18, 0.8, 18), r(8, 9, 4.5, 1.2), r(1.5, 3, 3, 2));
const MINI_UZI = picto("mini_uzi", 22,
  r(3, 4, 14, 5), r(17, 5, 4.5, 2), r(8, 9, 3, 9), p(3, 9, 6.5, 9, 6, 15, 2.6, 15), r(0, 5, 3, 1.2), r(12, 2.6, 4, 1.4));
const MITRAILLETTE = picto("mitraillette", 30,
  r(5, 4, 17, 4.5), r(22, 5, 7.5, 2), p(0, 5, 5, 5, 5, 11, 1.5, 11), p(10, 8.5, 13.2, 8.5, 14.6, 17.5, 11.4, 17.5), p(5, 8.5, 8, 8.5, 7, 15.5, 4, 15.5),
  r(18, 8.5, 6, 2), r(7, 2.6, 5, 1.4));
const FUSIL_ASSAUT = picto("fusil_assaut", 36,
  p(0, 5, 7, 4, 7, 10, 1, 11), r(7, 4, 13, 5), r(20, 4.5, 10, 3.5), r(30, 5.2, 6, 1.6), r(9, 2.4, 6, 1.6),
  p(14, 9, 17.5, 9, 19.5, 17.5, 16, 17.5), p(8, 9, 11, 9, 10, 16, 7, 16));
const MITRAILLEUSE = picto("mitrailleuse", 38,
  p(0, 5, 8, 4, 8, 10, 0, 9), r(8, 4, 12, 6), r(20, 5, 13, 3), r(33, 5.5, 5, 2), r(10, 1.8, 8, 2), r(11, 10, 6, 6),
  p(26, 8, 27.2, 8, 24.4, 17, 23, 17), p(28, 8, 29.2, 8, 31.4, 17, 30, 17), r(17, 11, 7, 1.2));
const POMPE = picto("pompe", 38,
  p(0, 5.5, 9, 4.5, 9, 9.5, 0, 11.5), r(9, 4.5, 8, 5), r(17, 5, 21, 1.8), r(17, 7.3, 17, 1.8), r(22, 7.3, 8.5, 3), p(9, 9.5, 12, 9.5, 11, 15, 8, 15));
const SNIPER = picto("sniper", 42,
  p(0, 5.5, 9.5, 4.8, 9.5, 10, 0, 11), r(9.5, 4.8, 11, 3.6), r(20.5, 5.4, 21.5, 1.6), r(12, 1.2, 12, 2.6), r(14, 3.8, 1.6, 1.2),
  r(21, 3.8, 1.6, 1.2), r(13, 8.4, 3, 3), p(9.5, 8.4, 12.5, 8.4, 11.5, 14.4, 8.5, 14.4), p(30, 7, 31.2, 7, 28.6, 15, 27.4, 15));
const RAYON = picto("rayon", 24,
  r(3, 5, 12, 5), p(15, 5, 20, 5, 23.5, 7.5, 20, 10, 15, 10), p(4, 10, 8.4, 10, 7.4, 18, 3.4, 18), r(9, 2.6, 2, 2.4), r(12, 2.6, 2, 2.4),
  p(18, 10, 20, 10, 19, 14, 17, 14));
const BAGUETTE = picto("baguette", 34,
  p(0, 6.5, 8, 3.5, 8, 10.5, 0, 12.5), r(8, 3.5, 7, 7), r(15, 4.5, 19, 2), r(15, 7, 19, 2), p(8, 10.5, 12, 10.5, 10.6, 16, 7, 16));
const AGRAFEUSE = picto("agrafeuse", 36,
  p(0, 5, 6, 4.5, 6, 10, 0, 10.5), r(6, 4.5, 14, 4.5), r(20, 5, 11, 3), r(31, 5.5, 5, 1.6), r(8, 2.6, 9, 1.4),
  r(14, 9, 3.2, 8), p(7, 9, 10, 9, 9, 15.5, 6, 15.5), r(22, 8, 6, 2.2));
const PHOTOCOPIEUSE = picto("photocopieuse", 32,
  p(0, 5.5, 6, 4.5, 6, 10, 0, 10), r(6, 4, 16, 4.2), r(22, 4.2, 8, 3.2), r(30, 5, 2, 1.6), e(13.2, 13, 4.6), r(21, 7.4, 4, 2.4),
  p(6, 8.2, 9, 8.2, 8, 15, 5, 15));
const ESSOREUSE = picto("essoreuse", 38,
  p(0, 5.5, 9, 4.5, 9, 9.5, 0, 11.5), r(9, 4.5, 8, 5), r(17, 5.2, 21, 1.6), r(17, 7.4, 16, 1.8), r(17, 3.2, 14, 1.4), r(21, 9.2, 10, 3),
  p(9, 9.5, 12, 9.5, 11, 15, 8, 15));
const BROCHETTE = picto("brochette", 34,
  p(0, 9, 19, 9, 19, 11.5, 0, 11.5), p(18, 2, 20.2, 2, 22.5, 10, 20.2, 18, 18, 18, 20, 10), r(8, 7, 22, 1.4), p(30, 5.9, 34, 7.7, 30, 9.5),
  p(2, 11.5, 6.5, 11.5, 5.5, 17, 1.5, 17));
const SOUFFLERIE = picto("soufflerie", 34,
  p(12, 5.5, 20, 5.5, 34, 1.8, 34, 17.2, 20, 13.5, 12, 13.5), r(2, 6, 10, 4), p(3, 10, 6.5, 10, 5.5, 17.5, 2, 17.5));
const GRILLE_PAIN = picto("grille_pain", 36,
  r(6, 6, 18, 9), r(9, 2, 4, 4.2), r(16, 2, 4, 4.2), r(7.5, 15, 3, 2), r(19.5, 15, 3, 2), r(24, 8.5, 12, 2.4), r(2, 7, 4, 6),
  p(14.5, 8, 11.5, 11.4, 13.6, 11.4, 12.4, 14.2, 16.6, 10.4, 14.5, 10.4, 15.6, 8));
const PERFOREUSE = picto("perforeuse", 22,
  r(2, 4, 17, 4.5), r(19, 5, 2.6, 2.5), r(3, 8.5, 13, 2), p(4, 10.5, 9.5, 10.5, 8.2, 18, 3.2, 18), e(15, 13, 2.6), r(11, 10.5, 2, 1.4));
const RAILGUN = picto("railgun", 40,
  r(4, 4, 10, 7), r(10, 5, 28, 1.6), r(10, 8.4, 28, 1.6), r(18, 3.4, 2, 8.2), r(24, 3.4, 2, 8.2), r(30, 3.4, 2, 8.2),
  p(38, 5, 40, 6.6, 38, 6.6), p(5, 11, 9, 11, 8, 18, 4, 18), r(0, 5.4, 4, 3.4));
const MINIGUN = picto("minigun", 38,
  r(14, 3, 22, 1.3), r(14, 5, 22, 1.3), r(14, 7, 22, 1.3), r(14, 9, 22, 1.3), r(10, 2, 5, 10), r(34, 2.4, 2, 8.6), r(3, 4, 7, 6),
  p(5, 10, 8.6, 10, 7.6, 17.5, 4, 17.5), r(0, 11, 5, 5.5), r(22, 1, 3, 1.6));
const MAGNUM_DORE = picto("magnum_dore", 28,
  r(3, 3.5, 9, 6), r(12, 4, 15.5, 3.4), r(12, 7.4, 11, 1.6), p(3, 9.5, 8.4, 9.5, 5.8, 18.5, 0.8, 18.5), r(8.6, 9.5, 4.6, 1.2), r(1.5, 2.6, 3, 2),
  r(24, 2.6, 2.4, 1.4));
const LANCE_GRENADES = picto("lance_grenades", 36,
  p(0, 6, 8, 5.5, 8, 10, 0, 11), r(8, 4.5, 22, 4.8), r(30, 3.8, 3.2, 6.2), r(24, 2.6, 1.4, 1.9), p(10, 9.3, 13.2, 9.3, 12.2, 16.5, 9, 16.5),
  r(33, 5.2, 3, 2));
const BAZOOKA = picto("bazooka", 42,
  r(2, 5, 38, 5), r(0, 4, 4, 7), r(38, 4, 4, 7), r(8, 2.6, 6, 1.6), p(15, 10, 18.4, 10, 17.6, 17, 14.2, 17), p(26, 10, 29, 10, 28.4, 16, 25.4, 16),
  r(21, 2.4, 1.4, 2.6));
const FUMIGENE = picto("fumigene", 16,
  r(3, 7, 8, 11), r(5, 4.6, 4, 2.4), r(10.4, 4.6, 3.2, 1.4), r(11, 6, 1.5, 3.4), e(5.4, 2.6, 2.2), e(10, 2.2, 2.2));

const COUTEAU = picto("couteau", 26,
  r(1, 8, 8, 4), r(9, 6.4, 1.8, 7.4), p(10.8, 7, 22.2, 7, 25.4, 10.2, 24.4, 11.2, 10.8, 11.2));
const EPEE = picto("epee", 38,
  r(11, 9, 22, 1.6), p(33, 8.2, 38, 9.8, 33, 11.4), r(8, 5.4, 2.6, 8.8), r(2, 8.2, 6, 3.2), e(1.8, 9.8, 1.8));

/** Une arme à feu ou de mêlée → son profil. */
const ARMES_PICTOS: Record<ArmeId, Picto> = {
  pistolet: PISTOLET, revolver: REVOLVER, mini_uzi: MINI_UZI,
  mitraillette: MITRAILLETTE, pompe: POMPE, sniper: SNIPER, fusil_assaut: FUSIL_ASSAUT, mitrailleuse: MITRAILLEUSE,
  baguette: BAGUETTE, agrafeuse: AGRAFEUSE, photocopieuse: PHOTOCOPIEUSE, essoreuse: ESSOREUSE, brochette: BROCHETTE, soufflerie: SOUFFLERIE, grille_pain: GRILLE_PAIN,
  rayon: RAYON, perforeuse: PERFOREUSE,
  railgun: RAILGUN, minigun: MINIGUN, magnum_dore: MAGNUM_DORE,
  lance_grenades: LANCE_GRENADES, bazooka: BAZOOKA, fumigene: FUMIGENE,
  couteau: COUTEAU, epee: EPEE,
};

// ---------- emblèmes des causes qui ne sont pas une arme ----------

const VOITURE = picto("voiture", 28,
  p(1, 14, 1, 10, 4.5, 9.4, 8, 5, 18.6, 5, 22.4, 9.2, 26.6, 10, 27, 14), e(7.4, 14.2, 2.8), e(20.6, 14.2, 2.8));
const POLICE = picto("police", 28,
  p(1, 14, 1, 10, 4.5, 9.4, 8, 5, 18.6, 5, 22.4, 9.2, 26.6, 10, 27, 14), e(7.4, 14.2, 2.8), e(20.6, 14.2, 2.8), r(10, 2, 3.2, 2.2), r(14.8, 2, 3.2, 2.2),
  r(13.2, 2.6, 1.6, 1.2));
const EXPLOSION = picto("explosion", 22, etoile(11, 10, 10, 4.6, 9), e(11, 10, 2.4));
const TRUCK = picto("truck", 32,
  r(1, 3, 17, 11), p(18.6, 6.4, 24.4, 6.4, 28.6, 10, 31, 10.6, 31, 14, 18.6, 14), e(7, 15, 2.8), e(24, 15, 2.8), r(0, 14, 31, 1));
const PATTE = picto("patte", 20,
  e(10, 13, 5.6, 4.8), e(3.6, 8, 2.2, 3), e(8, 3.6, 2.2, 3), e(12, 3.6, 2.2, 3), e(16.4, 8, 2.2, 3));
const TIGRE_ROBOT = picto("tigre_robot", 22,
  "M2 3l4.4 4.2h9.2L20 3v10l-3.4 5H5.4L2 13z" + e(7, 11, 1.7) + e(15, 11, 1.7), r(10, 0.6, 2, 3));
const TITAN = picto("titan", 22,
  r(7, 1, 8, 5), r(2, 7, 18, 5.4), r(0, 7, 3, 8), r(19, 7, 3, 8), r(5, 12.4, 4.4, 6.6), r(12.6, 12.4, 4.4, 6.6));
const GRIFFES = picto("griffes", 20,
  p(3, 1, 6.6, 1, 11.6, 19, 8, 19), p(8.2, 1, 11.8, 1, 16.8, 19, 13.2, 19), p(13.4, 1, 17, 1, 19.6, 10.4, 16, 10.4));
const BUS = picto("bus", 36,
  "M1.4 4.2h31.2a1.6 1.6 0 0 1 1.6 1.6V14H0V5.6a1.6 1.6 0 0 1 1.4-1.4z" + r(2.6, 6, 4.6, 4) + r(9, 6, 4.6, 4) + r(15.4, 6, 4.6, 4) + r(21.8, 6, 4.6, 4) + r(28.2, 6, 5, 6.4),
  e(8, 15, 2.8), e(27, 15, 2.8));
const MISSILE = picto("missile", 14,
  r(5, 4, 4, 9), p(5, 13, 9, 13, 7, 19.2), p(5, 5, 1.4, 1, 1.4, 8.4, 5, 10.6), p(9, 5, 12.6, 1, 12.6, 8.4, 9, 10.6), p(5, 4, 7, 0.4, 9, 4));
const GRENADE = picto("grenade", 16,
  e(8, 12, 6, 6.4), r(5.6, 3.6, 4.8, 2.6), r(9.6, 2.4, 5, 1.4), "M11 5.8h1.6l1.8 3.4h-1.6z");
const TEMPETE = picto("tempete", 24,
  e(7.6, 8, 5.2, 4.4), e(13, 6.2, 5.8, 5), e(18, 8.4, 4.6, 3.8), r(5.4, 8, 15, 4.6),
  p(13.4, 11, 8.6, 11, 11.2, 15.6, 9, 15.6, 12, 20, 12.4, 16.8, 15.2, 16.8));
const ABANDON = picto("abandon", 24,
  "M1 1h10v18H1z" + r(3, 3, 6, 14), p(12.4, 8, 17, 8, 17, 5, 23, 10, 17, 15, 17, 12, 12.4, 12));

/** Réticule : repli d'une arme ou d'une cause que le registre ne connaît pas (message d'un serveur plus récent). */
export const PICTO_GENERIQUE: Picto = picto("generique", 18, `${e(9, 10, 8.2)}${e(9, 10, 5.8)}`, e(9, 10, 1.8), r(8.2, 0.4, 1.6, 4), r(8.2, 15.6, 1.6, 4), r(0, 9.2, 4, 1.6), r(14, 9.2, 4, 1.6));

/** Marqueur « tir à la tête » (crâne), posé devant le pictogramme de l'arme. */
export const PICTO_TETE: Picto = picto("tete", 18,
  "M9 1C4.6 1 2 4 2 8c0 2.6 1.2 4.2 2.6 5.2V17h8.8v-3.8C14.8 12.2 16 10.6 16 8c0-4-2.6-7-7-7z" + e(6, 8.4, 1.9) + e(12, 8.4, 1.9));

/**
 * Pictogramme de la cause de mort `cause` ; pour une cause "arme" (et pour toute cause inconnue, repli), celui de l'arme `arme`.
 * Un kill de tigre allié ou sauvage (cause "tigre") montre la patte, pas le couteau que le message porte par convention.
 */
const CAUSES_PICTOS: Record<Exclude<CauseMort, "arme">, Picto> = {
  ecrase_pnj: VOITURE, ecrase_vehicule: VOITURE, explosion: EXPLOSION, truck_fou: TRUCK, tigre: PATTE, tigre_robot: TIGRE_ROBOT, titan: TITAN,
  tigre_zombie: GRIFFES, bus_c3: BUS, frappe_aerienne: MISSILE, tempete: TEMPETE, abandon: ABANDON, police: POLICE, grenade: GRENADE,
};

export function pictoArme(arme: ArmeId | string): Picto {
  return (ARMES_PICTOS as Record<string, Picto | undefined>)[arme] ?? PICTO_GENERIQUE;
}

export function pictoCause(cause: CauseMort | string, arme: ArmeId | string): Picto {
  if (cause === "arme") return pictoArme(arme);
  return (CAUSES_PICTOS as Record<string, Picto | undefined>)[cause] ?? pictoArme(arme);
}

/** Les ids que le registre couvre (tests). */
export const ARMES_AVEC_PICTO: readonly string[] = Object.keys(ARMES_PICTOS);
export const CAUSES_AVEC_PICTO: readonly string[] = ["arme", ...Object.keys(CAUSES_PICTOS)];
export { CAUSES_MORT };
