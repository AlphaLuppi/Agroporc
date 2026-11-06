/**
 * Rocket Muche : modèle PUR du HUD, du menu pause et de l'écran de fin (module G). Chrono, graduations de la jauge de boost, classement par
 * équipe, annonces vocales (`aria-live`) et titre du résultat. Sans React, three ni horloge : testé sous Node.
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md § 9.3.
 */
import type { Equipe, HudRocket, LigneClassement, ResultatMatch } from "./contrat";

/** Sous ce temps restant (s) le minuteur passe à l'ambre. */
export const SEUIL_ALERTE_CHRONO_S = 30;
/** Nombre de graduations de la jauge de boost (une par point de boost). */
export const GRADUATIONS_BOOST = 100;

/** Minuteur « m:ss », arrondi à la seconde supérieure (3:00 jusqu'à la première seconde écoulée), jamais négatif. */
export function formaterChrono(secondes: number): string {
  const s = Number.isFinite(secondes) ? Math.max(0, Math.ceil(secondes)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Texte du minuteur : « PROLONGATION » en mort subite, sinon « m:ss ». */
export function libelleChrono(h: Pick<HudRocket, "tempsRestant" | "prolongation">): string {
  return h.prolongation ? "PROLONGATION" : formaterChrono(h.tempsRestant);
}

/** Le minuteur est dans sa dernière demi-minute (ambre) : jamais en prolongation, jamais à 0 (la fin attend la balle). */
export function chronoUrgent(h: Pick<HudRocket, "tempsRestant" | "prolongation" | "phase">): boolean {
  return !h.prolongation && h.phase !== "fini" && h.tempsRestant > 0 && h.tempsRestant <= SEUIL_ALERTE_CHRONO_S;
}

/** Nombre de graduations allumées pour un boost de 0 à 100 (arrondi, borné). */
export function graduationsAllumees(boost: number): number {
  if (!Number.isFinite(boost)) return 0;
  return Math.min(GRADUATIONS_BOOST, Math.max(0, Math.round(boost)));
}

/** Vitesse affichée en km/h (entier, jamais négatif). */
export function vitesseAffichee(kmh: number): number {
  return Number.isFinite(kmh) ? Math.max(0, Math.round(kmh)) : 0;
}

/** Classement séparé par équipe, chaque équipe triée par points décroissants (à égalité : l'identifiant le plus petit d'abord). */
export function classementParEquipe(lignes: readonly LigneClassement[]): Record<Equipe, LigneClassement[]> {
  const tri = (a: LigneClassement, b: LigneClassement) => b.stats.points - a.stats.points || a.id - b.id;
  return {
    bleue: lignes.filter((l) => l.equipe === "bleue").sort(tri),
    orange: lignes.filter((l) => l.equipe === "orange").sort(tri),
  };
}

/** Annonce vocale d'un but : détecte l'équipe dont le score a augmenté. Null si rien n'a augmenté (remise à zéro comprise). */
export function annonceBut(avant: Readonly<Record<Equipe, number>>, apres: Readonly<Record<Equipe, number>>, noms: Readonly<Record<Equipe, string>>): string | null {
  const equipe: Equipe | null = apres.bleue > avant.bleue ? "bleue" : apres.orange > avant.orange ? "orange" : null;
  if (!equipe) return null;
  return `But pour ${noms[equipe]}. ${noms.bleue} ${apres.bleue}, ${noms.orange} ${apres.orange}.`;
}

export type IssueMatch = "victoire" | "defaite" | "egalite";

/** Titre de l'écran de fin du point de vue du joueur : « Victoire ! », « Défaite » ou « Égalité ». */
export function titreResultat(r: Readonly<ResultatMatch>, noms: Readonly<Record<Equipe, string>>): { issue: IssueMatch; titre: string; sousTitre: string } {
  const prolong = r.prolongation ? " · après prolongation" : "";
  const score = `${noms.bleue} ${r.score.bleue} - ${r.score.orange} ${noms.orange}`;
  if (r.vainqueur === null) return { issue: "egalite", titre: "Égalité", sousTitre: `${score}${prolong}` };
  const issue: IssueMatch = r.vainqueur === r.equipeJoueur ? "victoire" : "defaite";
  return { issue, titre: issue === "victoire" ? "Victoire !" : "Défaite", sousTitre: `${score}${prolong}` };
}

/** Annonce vocale du résultat (« Match terminé : Victoire. Les Trèfles 2 - 1 Les Tigres. »). */
export function annonceFin(r: Readonly<ResultatMatch>, noms: Readonly<Record<Equipe, string>>): string {
  const t = titreResultat(r, noms);
  return `Match terminé : ${t.titre.replace(/\s*!$/, "")}. ${t.sousTitre}.`;
}

/** Ligne du meilleur joueur (MVP) dans le classement du résultat, ou null. */
export function ligneMvp(r: Readonly<ResultatMatch>): LigneClassement | null {
  return r.mvp === null ? null : (r.classement.find((l) => l.id === r.mvp) ?? null);
}

/** Équipe dont la couleur est utilisée pour l'écran de fin : celle du vainqueur, à défaut celle du joueur. */
export function equipeMiseEnAvant(r: Readonly<ResultatMatch>): Equipe {
  return r.vainqueur ?? r.equipeJoueur;
}

/** Colonnes du tableau des statistiques, dans l'ordre d'affichage (clé de `StatsVoiture`, en-tête court, en-tête complet pour les lecteurs d'écran). */
export const COLONNES_STATS = [
  { cle: "points", court: "Pts", long: "Points" },
  { cle: "buts", court: "B", long: "Buts" },
  { cle: "passes", court: "PD", long: "Passes décisives" },
  { cle: "arrets", court: "Arr", long: "Arrêts" },
  { cle: "tirs", court: "Tirs", long: "Tirs cadrés" },
  { cle: "demolitions", court: "Démo", long: "Démolitions" },
] as const;
