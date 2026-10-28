/**
 * Calculs PURS du rendu du Battle Royale (sans three) : couleur et rareté d'un objet de butin, visibilité par la distance, taille et
 * intensité du mur de tempête, anneau de la prochaine zone, durée de vie de l'avion. `rendu-br.ts` (three) n'en fait que l'affichage.
 * Test : `rendu-br-modele.test.ts`.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (§Rendu)
 */
import { etatDepuisZoneBr } from "./br-zone";
import { raretePourArme } from "./br-butin";
import type { ArmeFeuId, AvionBr, ObjetBr, Rarete, Vec3, ZoneBr } from "./protocole";

// ---------------------------------------------------------------------------------------------
// Butin
// ---------------------------------------------------------------------------------------------

/** Couleur de la colonne et du halo d'un objet selon sa rareté : gris, vert, bleu, ambre (entiers 0xrrggbb pour three). */
export const COULEUR_RARETE: Readonly<Record<Rarete, number>> = Object.freeze({
  commun: 0xaab4bd,
  peu_commun: 0x5dff6a,
  rare: 0x4aa8ff,
  legendaire: 0xffb347,
});

export const RARETES_BR: readonly Rarete[] = ["commun", "peu_commun", "rare", "legendaire"];

export const couleurRarete = (r: Rarete): number => COULEUR_RARETE[r];

/**
 * Rareté d'un objet au sol : celle de l'arme (table du butin), `peu_commun` pour une potion de bouclier, `commun` pour les munitions et le
 * bandage. Une arme inconnue du client (mise à jour du serveur) compte comme commune.
 */
export function rareteObjet(o: Pick<ObjetBr, "genre" | "ref">): Rarete {
  if (o.genre === "arme" && o.ref) return raretePourArme(o.ref as ArmeFeuId | "epee");
  if (o.genre === "potion") return "peu_commun";
  return "commun";
}

/** Couleur du halo d'un objet (selon sa rareté). */
export const couleurObjet = (o: Pick<ObjetBr, "genre" | "ref">): number => COULEUR_RARETE[rareteObjet(o)];

/**
 * Réglages du butin dessiné : on ne dessine que les objets à moins de `porteeM` mètres de l'œil (60 m), avec une marge d'hystérésis
 * (`hysteresisM`) pour qu'un objet pile à la limite ne clignote pas ; `capacite` objets au plus (colonnes et halos instanciés), les
 * `modelesMax` plus proches ont en plus leur modèle (arme, boîte, soin) ; au-delà ils restent une colonne de lumière.
 */
export const BUTIN_RENDU = { porteeM: 60, hysteresisM: 8, capacite: 256, modelesMax: 40 } as const;

/**
 * Objets à dessiner : à moins de `portee` de l'œil (ou de `portee + hysteresis` s'ils l'étaient déjà à l'image précédente, ids dans
 * `dejaVisibles`), triés du plus proche au plus lointain (ordre stable à distance égale : par id), au plus `max`. Distance en 3D (un objet
 * posé sur un toit, 15 m plus haut, n'est pas « sous les pieds »).
 */
export function objetsVisibles(
  objets: Iterable<ObjetBr>, oeil: Vec3, dejaVisibles: ReadonlySet<number>,
  max: number = BUTIN_RENDU.capacite, portee: number = BUTIN_RENDU.porteeM, hysteresis: number = BUTIN_RENDU.hysteresisM,
): ObjetBr[] {
  const proches: { o: ObjetBr; d2: number }[] = [];
  const p2 = portee * portee, h2 = (portee + hysteresis) * (portee + hysteresis);
  for (const o of objets) {
    const dx = o.p[0] - oeil[0], dy = o.p[1] - oeil[1], dz = o.p[2] - oeil[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= (dejaVisibles.has(o.id) ? h2 : p2)) proches.push({ o, d2 });
  }
  proches.sort((a, b) => a.d2 - b.d2 || a.o.id - b.o.id);
  if (proches.length > max) proches.length = Math.max(0, max);
  return proches.map((x) => x.o);
}

/** Hauteur (m) de la colonne de lumière d'un objet : plus la rareté est haute, plus on la voit de loin. */
export const HAUTEUR_COLONNE: Readonly<Record<Rarete, number>> = Object.freeze({ commun: 2.2, peu_commun: 3.4, rare: 4.8, legendaire: 6.5 });

/** Hauteur de flottaison (m) du modèle d'un objet au-dessus de son point, qui monte et descend doucement (`horloge` en s, décalé par `id`). */
export function flotteObjet(horloge: number, id: number): number {
  return 0.55 + 0.08 * Math.sin(horloge * 2.1 + id * 1.7);
}

/** Échelle d'un modèle d'objet lâché à la mort : une pile de soins (`qte`) est plus grosse, jusqu'à 1,5 ; absent ou invalide = 1. */
export function echelleQuantite(qte: number | undefined): number {
  if (qte === undefined || !Number.isFinite(qte) || qte <= 1) return 1;
  return Math.min(1.5, 1 + 0.1 * (qte - 1));
}

// ---------------------------------------------------------------------------------------------
// Avion
// ---------------------------------------------------------------------------------------------

/** L'avion reste dessiné un instant après son arrivée (les derniers sauts), puis disparaît. */
export const AVION_PERSISTANCE_MS = 1_500;

/** L'avion est-il à dessiner à l'instant serveur `t` (ms) ? Immobile au départ pendant le décompte, jusqu'à un peu après `finT`. */
export const avionVisible = (a: AvionBr | null, t: number): boolean => a !== null && t <= a.finT + AVION_PERSISTANCE_MS;

// ---------------------------------------------------------------------------------------------
// Tempête
// ---------------------------------------------------------------------------------------------

/**
 * Mur de tempête : cylindre ouvert d'UNE seule géométrie (rayon 1, hauteur 1, base à y = 0), dont seule l'échelle change avec le rayon de la
 * zone. Il va de `base` à `base + hauteurM` ; le rideau de l'anneau de la prochaine zone est plus bas.
 */
export const MUR_TEMPETE = { hauteurM: 260, base: -10, segments: 96, rideauM: 14, rayonMinM: 0.5, couleur: 0xa855f7 } as const;

/** Échelle (x, y, z) du cylindre unité pour un mur de rayon `rayon` et de hauteur `hauteur` ; le rayon est borné (zone fermée : rayon 0). */
export function echelleMur(rayon: number, hauteur: number = MUR_TEMPETE.hauteurM): [number, number, number] {
  const r = Math.max(MUR_TEMPETE.rayonMinM, Number.isFinite(rayon) ? rayon : MUR_TEMPETE.rayonMinM);
  return [r, hauteur, r];
}

/** Cercle courant de la zone (mur de tempête) à l'instant serveur `t`, reconstruit comme le serveur (`etatDepuisZoneBr`). Null sans zone. */
export function cercleZone(zone: ZoneBr | null, t: number): { centre: [number, number]; rayon: number } | null {
  if (!zone) return null;
  const e = etatDepuisZoneBr(zone, t);
  return { centre: e.centre, rayon: e.rayon };
}

/** Anneau de la prochaine zone au sol : le cercle visé, tant que la zone n'est pas fermée et pas encore atteinte. Null sinon. */
export function anneauProchaineZone(zone: ZoneBr | null, t: number): { centre: [number, number]; rayon: number } | null {
  if (!zone) return null;
  const e = etatDepuisZoneBr(zone, t);
  if (e.phase === "fermee" || !e.cible) return null;
  return { centre: [e.cible.c[0], e.cible.c[1]], rayon: e.cible.r };
}

/**
 * Intensité (0,25 à 1) du mur selon la distance de l'œil au bord de la zone (m, > 0 dehors, < 0 dedans, valeur absolue) : discret au loin,
 * éclatant dans les 250 derniers mètres.
 */
export function intensiteMur(distanceAuBord: number): number {
  const d = Number.isFinite(distanceAuBord) ? Math.abs(distanceAuBord) : 1e9;
  const k = Math.min(Math.max(1 - d / 250, 0), 1);
  return 0.25 + 0.75 * k;
}

/** Défilement (en tours de texture) du motif du mur à l'instant `horloge` (s) : il monte, et dérive lentement sur le côté. */
export function defilementMur(horloge: number): { u: number; v: number } {
  return { u: (horloge * 0.01) % 1, v: (horloge * 0.12) % 1 };
}
