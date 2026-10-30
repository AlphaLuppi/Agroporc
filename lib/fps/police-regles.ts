/**
 * Règles de la descente de police propres à chaque mode (PUR) : qui peut être écrasé, qui peut être visé, quand une descente est permise. Le service
 * (`match-police.ts`) simule la voiture, il ne décide ni QUAND ni QUI cibler : il reçoit ces règles (deux fabriques, arène et Battle Royale). La voiture est
 * la même dans les deux modes (physique, rendu, sirène, tirs) ; seules changent la cible, les conditions et la cadence.
 * Spec : docs/superpowers/specs/2026-10-30-arene-police-evenements-design.md (§4.1, §4.3, §5)
 */
import type { AidePoliceBr, ContexteSalle, JoueurSalle, ServiceEvenements } from "./match-contexte";
import { POLICE, choisirCibleArene, choisirCibleBr, type CandidatPolice } from "./police";
import type { Vec3 } from "./protocole";

/** Ce que `permis` sait du moment : les candidats (éligibles et joignables) et l'instant où le minuteur est échu (attente d'un premier kill en arène). */
export interface EtatPermis { candidats: readonly CandidatPolice[]; echeanceT: number }

export interface ReglesPolice {
  /** la voiture peut écraser ce joueur : vivant, en jeu, à pied, hors protection d'apparition, avec la capacité `police` */
  ecrasable(j: JoueurSalle, t: number): boolean;
  /** le joueur peut être choisi pour cible (écrasable, et les conditions du mode : hauteur en arène, dans la zone en BR) */
  eligible(j: JoueurSalle, t: number): boolean;
  choisirCible(c: readonly CandidatPolice[], voiture: Vec3, courante: string | null): string | null;
  /** les conditions du moment sont réunies ; faux : le service réessaie dans `POLICE.reessaiMs` */
  permis(t: number, etat: EtatPermis): boolean;
  /** (Battle Royale) un point de départ est-il dans la zone courante ? Absent : tout point convient */
  pointPermis?(x: number, z: number, t: number): boolean;
}

/** Joueurs en jeu qui voient la voiture (capacité `police`) : le compte qui sert à `joueursMin` et au passage de 1 à 2 joueurs de l'arène. */
export function capablesEnJeu(ctx: ContexteSalle): number {
  let n = 0;
  for (const j of ctx.joueursEnJeu()) if (ctx.supportePolice(j.id)) n++;
  return n;
}

/**
 * Règles de l'arène. `aPied` est la MÊME fonction que celle que `Salle` injecte à Elsa et aux tigres (`!vehicules?.occupation(j.id) && !evenements?.estPilote(j.id)`) :
 * le service ne voit pas `vehicules`. Un conducteur ou un joueur sur un toit n'est jamais visé (la voiture n'écrase qu'à pied : poursuite sans fin sinon) ;
 * le leader dans une voiture est remplacé, tant qu'il y est, par le meilleur des joueurs à pied.
 */
export function reglesArene(ctx: ContexteSalle, aPied: (j: JoueurSalle) => boolean, evenements: ServiceEvenements | null): ReglesPolice {
  const ecrasable = (j: JoueurSalle, t: number): boolean => j.enJeu && j.vivant && t >= j.protegeJusqua && ctx.supportePolice(j.id) && aPied(j);
  return {
    ecrasable,
    eligible: (j, t) => ecrasable(j, t) && j.p[1] <= POLICE.hauteurMaxCibleM,
    choisirCible: choisirCibleArene,
    permis(t, { candidats, echeanceT }) {
      if (capablesEnJeu(ctx) < POLICE.joueursMin || evenements?.titanEnCours()) return false;
      if (candidats.length === 0) return false;
      // « le plus de kills » n'a de sens que si quelqu'un en a : les kills repartent à 0 à chaque match, la voiture attend un premier kill, 60 s au plus
      return candidats.some((c) => c.kills >= 1) || t >= echeanceT + POLICE.attendreLeaderMs;
    },
  };
}

/**
 * Règles du Battle Royale. Éligible : vivant, au sol (ni à bord de l'avion ni en chute), non spectateur, hors invulnérabilité d'atterrissage, DANS la zone
 * courante (jamais un joueur déjà dans la tempête), pieds à moins de `hauteurMaxCibleM` (jamais un joueur sur un toit). Les kills sont ignorés. L'écrasement, lui, s'applique à tout joueur au sol (les bots sur le chemin restent écrasables).
 * `policeMs` (essais, `PDJ_FPS_BR_POLICE_MS`) : la descente n'attend plus que ce délai (au plus 60 s) après le premier atterrissage et se contente de 2 vivants.
 */
export function reglesBr(ctx: ContexteSalle, aide: AidePoliceBr, policeMs?: number): ReglesPolice {
  const apresAtterrissageMs = policeMs !== undefined ? Math.min(POLICE.br.apresAtterrissageMs, policeMs) : POLICE.br.apresAtterrissageMs;
  const vivantsMin = policeMs !== undefined ? 2 : POLICE.br.vivantsMin;
  const ecrasable = (j: JoueurSalle, t: number): boolean =>
    j.enJeu && j.vivant && !aide.estSpectateur(j.id) && !aide.enVol(j.id) && t >= j.protegeJusqua && ctx.supportePolice(j.id);
  const dansZone = (x: number, z: number, t: number): boolean => {
    const zone = aide.zone(t);
    return !zone || Math.hypot(x - zone.centre[0], z - zone.centre[1]) <= zone.rayon;
  };
  return {
    ecrasable,
    // un joueur sur un toit n'est jamais visé (la voiture n'écrase que des pieds à moins de `hauteurMaxCibleM`, comme en arène)
    eligible: (j, t) => ecrasable(j, t) && j.p[1] <= POLICE.hauteurMaxCibleM && dansZone(j.p[0], j.p[2], t),
    choisirCible: (c, voiture) => choisirCibleBr(c, voiture),
    permis(t, { candidats }) {
      if (aide.phase() !== "jeu") return false;
      const atterri = aide.premierAtterrissageT();
      if (atterri === null || t < atterri + apresAtterrissageMs) return false;
      if (aide.vivants() < vivantsMin) return false;
      return candidats.some((c) => c.humain);
    },
    pointPermis: dansZone,
  };
}
