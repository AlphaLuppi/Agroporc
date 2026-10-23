/**
 * Cumul des chiffres de dégâts (PUR) : les événements `confirme` sur la même cible dans une fenêtre de 400 ms s'additionnent en un
 * seul chiffre (pompe, minigun) ; les drapeaux tête / bouclier / kill sont combinés par OU. Deux cibles distinctes ne fusionnent pas.
 * La fenêtre se mesure depuis le PREMIER événement du chiffre (pas de fenêtre glissante : un minigun qui arrose en continu donne
 * un chiffre toutes les 400 ms et non un total qui ne s'arrête jamais).
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§6.1)
 */
import type { Zone } from "./protocole";

/** Fenêtre de cumul (ms) des `confirme` sur une même cible. */
export const FENETRE_CUMUL_MS = 400;
/** Durée d'affichage (ms) d'un chiffre de dégâts : il monte de 22u en s'estompant. */
export const DUREE_CHIFFRE_MS = 700;
/** Nombre maximal de chiffres affichés en même temps (les plus anciens sont retirés). */
export const CHIFFRES_MAX = 6;

/** Un `confirme` reçu à l'instant `t` (ms, horloge locale). */
export interface ConfirmeBrut { cible: string; degats: number; absorbe: number; zone: Zone; tue: boolean; t: number }
/** Chiffre affiché : `degats` total, `absorbe` = part prise par le bouclier ; drapeaux combinés par OU. */
export interface ChiffreDegats {
  id: number; cible: string; degats: number; absorbe: number; tete: boolean; bouclier: boolean; tue: boolean;
  /** instant du premier événement et du dernier */
  debut: number; dernier: number;
  /** nombre d'événements fusionnés (change à chaque ajout : sert de clé pour relancer l'animation) */
  nb: number;
}

/** Ajoute un événement : fusionne avec le chiffre de la même cible dans les 400 ms, sinon en crée un (avec `id`). Renvoie la nouvelle liste. */
export function cumulerConfirme(liste: readonly ChiffreDegats[], e: ConfirmeBrut, id: number): ChiffreDegats[] {
  const i = liste.findIndex((c) => c.cible === e.cible && e.t - c.debut <= FENETRE_CUMUL_MS && e.t >= c.debut);
  if (i >= 0) {
    const c = liste[i];
    const fusion: ChiffreDegats = {
      ...c,
      degats: c.degats + e.degats,
      absorbe: c.absorbe + e.absorbe,
      tete: c.tete || e.zone === "tete",
      bouclier: c.bouclier || e.absorbe > 0,
      tue: c.tue || e.tue,
      dernier: e.t,
      nb: c.nb + 1,
    };
    return liste.map((x, k) => (k === i ? fusion : x));
  }
  const nouveau: ChiffreDegats = {
    id, cible: e.cible, degats: e.degats, absorbe: e.absorbe, tete: e.zone === "tete", bouclier: e.absorbe > 0, tue: e.tue,
    debut: e.t, dernier: e.t, nb: 1,
  };
  return [...liste, nouveau].slice(-CHIFFRES_MAX);
}

/** Retire les chiffres dont le dernier événement date de plus de `DUREE_CHIFFRE_MS`. */
export function purgerChiffres(liste: readonly ChiffreDegats[], t: number): ChiffreDegats[] {
  const reste = liste.filter((c) => t - c.dernier < DUREE_CHIFFRE_MS);
  return reste.length === liste.length ? (liste as ChiffreDegats[]) : reste;
}
