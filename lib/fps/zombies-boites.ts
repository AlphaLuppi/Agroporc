/**
 * Boîtes mystère du mode zombies (PUR, partagé client / serveur) : la boîte principale qui déménage, et les boîtes temporaires du Happy hour
 * (le Fire Sale de Black Ops 1). Règles de BO1 (`_zombiemode_powerups.gsc start_fire_sale / toggle_fire_sale_on`,
 * `_zombiemode_weapons.gsc treasure_chest_weapon_spawn`) :
 * - pendant 30 s, une boîte temporaire à CHAQUE emplacement libre, toutes (la principale comprise) à 10 $ ; un second Happy hour relance
 *   la minuterie ;
 * - aucune peluche pendant la durée, donc aucun déménagement (et les tirages ne comptent pas pour la peluche) ;
 * - à la fin, les boîtes temporaires disparaissent dès qu'elles sont refermées (celle en cours de tirage ou d'offre finit d'abord) ;
 * - le bonus n'est offert qu'une fois la boîte déjà déménagée au moins une fois, et jamais pendant un Happy hour.
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (boîte mystère, bonus)
 */
import type { EtatBoite } from "./protocole";
import { PRIX_BOITE, PRIX_BOITE_SOLDES } from "./zombies-carte";

/** Ce que les règles lisent de la partie : la boîte principale, les boîtes temporaires, la fin du Happy hour (0 = inactif). */
export interface EtatBoites { boite: EtatBoite; boitesSoldes?: readonly EtatBoite[]; effets: { soldesFinT: number } }

/** Toutes les boîtes présentes : la principale d'abord, puis les temporaires du Happy hour. */
export function boitesPresentes(e: Pick<EtatBoites, "boite" | "boitesSoldes">): EtatBoite[] {
  return [e.boite, ...(e.boitesSoldes ?? [])];
}

/** Boîte posée à l'emplacement `emplacement` (principale ou temporaire), null s'il n'y en a pas. */
export function boiteA(e: Pick<EtatBoites, "boite" | "boitesSoldes">, emplacement: number): EtatBoite | null {
  if (e.boite.emplacement === emplacement) return e.boite;
  return e.boitesSoldes?.find((b) => b.emplacement === emplacement) ?? null;
}

/** Happy hour en cours à `t` (horloge serveur, ms). */
export const soldesActives = (soldesFinT: number, t: number): boolean => t < soldesFinT;

/** Prix d'un tirage à `t` : 10 $ pendant le Happy hour, 950 $ sinon. */
export const prixBoite = (soldesFinT: number, t: number): number => (soldesActives(soldesFinT, t) ? PRIX_BOITE_SOLDES : PRIX_BOITE);

/**
 * La peluche de BO1 (`treasure_chest_think`), `r` dans [0, 100[ : jamais pendant un Happy hour ni sur une boîte temporaire ; jamais avant 4
 * utilisations ; 15 % de 4 à 7 ; certaine au 8ᵉ tant que la boîte n'a jamais bougé ; ensuite 30 % jusqu'au 12ᵉ puis 50 %.
 */
export function pelucheTiree(utilisations: number, demenagements: number, r: number, soldes: boolean): boolean {
  if (soldes || utilisations < 4) return false;
  if (demenagements === 0) return utilisations >= 8 || r < 15;
  if (utilisations < 8) return r < 15;
  if (utilisations < 13) return r < 30;
  return r < 50;
}

/**
 * Boîtes temporaires d'un Happy hour qui commence (ou qui est relancé) : une boîte fermée à chaque emplacement de 0 à `nb` − 1 qui n'a pas
 * déjà une boîte (la principale, ou une temporaire encore là, gardée telle quelle).
 */
export function ouvrirSoldes(principale: EtatBoite, existantes: readonly EtatBoite[], nb: number): EtatBoite[] {
  const res = existantes.map((b) => ({ ...b }));
  for (let i = 0; i < nb; i++) {
    if (i === principale.emplacement || res.some((b) => b.emplacement === i)) continue;
    res.push({ emplacement: i, etat: "fermee", finT: 0, utilisations: 0 });
  }
  return res;
}

/** Après le Happy hour (`soldes` faux), les boîtes temporaires refermées disparaissent ; celles en cours de tirage ou d'offre restent. */
export function boitesSoldesRestantes(temporaires: readonly EtatBoite[], soldes: boolean): EtatBoite[] {
  return soldes ? [...temporaires] : temporaires.filter((b) => b.etat !== "fermee");
}

/**
 * Emplacements où la boîte principale peut se poser en fin d'envol : tous sauf le sien et ceux d'une boîte temporaire en cours de tirage ou
 * d'offre (une temporaire fermée cède sa place). VIDE quand toutes les autres sont occupées : la boîte attend en l'air (se poser supprimerait
 * une temporaire payée, son tirage perdu sans remboursement).
 */
export function destinationsEnvol(depuis: number, temporaires: readonly EtatBoite[], nb: number): number[] {
  const tous = Array.from({ length: nb }, (_, i) => i).filter((i) => i !== depuis);
  return tous.filter((i) => !temporaires.some((b) => b.emplacement === i && b.etat !== "fermee"));
}

/** (v8) Attente (ms) d'une boîte en envol qui ne trouve aucun emplacement libre avant de réessayer. */
export const ATTENTE_ENVOL_MS = 1000;

/** Le bonus Happy hour peut-il tomber ? BO1 `get_valid_powerup` : pas avant le premier déménagement de la boîte, pas pendant un Happy hour. */
export function soldesPermises(demenagements: number, soldesFinT: number, t: number): boolean {
  return demenagements >= 1 && !soldesActives(soldesFinT, t);
}
