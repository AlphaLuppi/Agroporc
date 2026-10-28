/**
 * Statistiques du mode Battle Royale (PUR : aucune horloge, aucun fichier ; la persistance est injectée par `serveur-fps`).
 * Identité d'une fiche = pseudo normalisé (`cleStats`), sans authentification (site privé).
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md, section « Statistiques persistées ».
 */
import { nettoyerPseudo } from "./match";
import type { LigneStatsBr } from "./protocole";

export interface StatsBr { version: 1; joueurs: Record<string, LigneStatsBr> }
/** Lignes des seuls pseudos comptés ; `t` = fin de la partie (ms serveur). */
export interface ResultatPartieBr { t: number; lignes: { pseudo: string; place: number; kills: number }[] }
/** Injecté, implémenté par `serveur-fps` (écriture asynchrone sérialisée). */
export interface PersistanceBr { lire(): StatsBr; enregistrer(partie: ResultatPartieBr): StatsBr }

export const statsVides = (): StatsBr => ({ version: 1, joueurs: {} });

/** Clé de fiche : pseudo nettoyé comme dans la salle, casse ignorée (les accents sont conservés). */
export function cleStats(pseudo: string): string {
  return nettoyerPseudo(pseudo).toLocaleLowerCase("fr");
}

/** Le pseudo par défaut (`Agent`) et ses doublons suffixés (`Agent2`) jouent mais ne sont pas enregistrés. */
export function estPseudoCompte(pseudo: string): boolean {
  return !/^Agent\d*$/i.test(nettoyerPseudo(pseudo));
}

/** Clé sans chiffres finaux : `Toto2` et `toto` désignent le même nom de base (conflit de noms au lancement). */
export function nomDeBase(pseudo: string): string {
  const cle = cleStats(pseudo);
  const base = cle.replace(/\d+$/, "");
  return base === "" ? cle : base;
}

const entierPositif = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Nouvelle valeur : une ligne par pseudo compté, `top1` pour la place 1, `meilleurePlace` = la plus petite place connue (0 = aucune). */
export function appliquerPartie(stats: StatsBr, partie: ResultatPartieBr): StatsBr {
  const joueurs: Record<string, LigneStatsBr> = { ...stats.joueurs };
  for (const l of partie.lignes) {
    if (!estPseudoCompte(l.pseudo)) continue;
    const cle = cleStats(l.pseudo);
    const avant = joueurs[cle];
    const place = entierPositif(l.place);
    const meilleure = avant && avant.meilleurePlace > 0
      ? (place > 0 ? Math.min(avant.meilleurePlace, place) : avant.meilleurePlace)
      : place;
    joueurs[cle] = {
      cle,
      pseudo: nettoyerPseudo(l.pseudo),
      top1: (avant?.top1 ?? 0) + (place === 1 ? 1 : 0),
      parties: (avant?.parties ?? 0) + 1,
      kills: (avant?.kills ?? 0) + entierPositif(l.kills),
      meilleurePlace: meilleure,
      derniereT: partie.t,
    };
  }
  return { version: 1, joueurs };
}

/** TOP 1 décroissant, puis kills décroissant, puis parties croissant (moins de parties = meilleur ratio), puis pseudo. */
export function classementStats(stats: StatsBr, n: number): LigneStatsBr[] {
  return Object.values(stats.joueurs)
    .sort((a, b) =>
      b.top1 - a.top1 || b.kills - a.kills || a.parties - b.parties
      || a.pseudo.localeCompare(b.pseudo, "fr") || (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0))
    .slice(0, Math.max(0, Math.floor(n)));
}

/** Validation tolérante d'un JSON lu sur disque : une entrée illisible est ignorée, les nombres sont réparés, jamais d'exception. */
export function lireStatsBr(brut: unknown): StatsBr {
  const stats = statsVides();
  if (typeof brut !== "object" || brut === null || Array.isArray(brut)) return stats;
  const joueurs = (brut as { joueurs?: unknown }).joueurs;
  if (typeof joueurs !== "object" || joueurs === null || Array.isArray(joueurs)) return stats;
  for (const [cleBrute, v] of Object.entries(joueurs)) {
    if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
    const l = v as Record<string, unknown>;
    const pseudo = typeof l.pseudo === "string" ? nettoyerPseudo(l.pseudo) : "";
    // la clé stockée fait foi si elle est déjà normalisée, sinon on la recalcule depuis le pseudo
    const cle = cleBrute !== "" && cleStats(cleBrute) === cleBrute ? cleBrute : cleStats(pseudo || cleBrute);
    if (cle === "" || !estPseudoCompte(cle)) continue;
    const avant = stats.joueurs[cle];
    const ligne: LigneStatsBr = {
      cle,
      pseudo: typeof l.pseudo === "string" && pseudo !== "" ? pseudo : cle,
      top1: entierPositif(l.top1),
      parties: entierPositif(l.parties),
      kills: entierPositif(l.kills),
      meilleurePlace: entierPositif(l.meilleurePlace),
      derniereT: typeof l.derniereT === "number" && Number.isFinite(l.derniereT) && l.derniereT > 0 ? l.derniereT : 0,
    };
    // deux entrées qui retombent sur la même clé : on garde la plus jouée
    if (!avant || ligne.parties > avant.parties) stats.joueurs[cle] = ligne;
  }
  return stats;
}
