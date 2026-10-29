/**
 * Anti-flood du serveur temps réel (PUR : l'horloge est passée à chaque appel). Avant la v8, plus de 90 messages dans une fenêtre fixe
 * d'une seconde fermaient la socket : une micro-coupure Wi-Fi ou une perte TCP de 0,75 s en tirant (le client envoie 30 `etat`/s et un `tir`
 * par balle, ≈ 52 messages/s au mini Uzi sous Double Ristretto) livrait d'un coup plus de 90 messages et éjectait le joueur de la partie.
 *
 * Deux seaux à jetons : les FLUX continus et périssables (`etat`, `conduite`, `pilotage`, `ping`), dont l'excédent est JETÉ (un état plus
 * récent arrive juste après), et les ACTIONS (tirs, coups, achats…), généreuses en rafale ; un message sans jeton est jeté, jamais la socket
 * coupée. Seul un débit brut aberrant (`coupureParFenetre` messages dans une seconde, qu'aucun client honnête n'atteint, même après une
 * coupure de plusieurs secondes) ferme la connexion.
 */

/** Messages continus et périssables : leur excédent est jeté sans conséquence. */
export const TYPES_FLUX: ReadonlySet<string> = new Set(["etat", "conduite", "pilotage", "ping"]);

export const ANTI_FLOOD = {
  /** flux : 45 par seconde (30 Hz d'états + le ping), rafale de 90 (3 s d'états regroupés après une coupure) */
  fluxParS: 45,
  fluxRafale: 90,
  /** actions : 90 par seconde, rafale de 270 */
  actionsParS: 90,
  actionsRafale: 270,
  /** au-delà de ce nombre de messages bruts dans une fenêtre d'une seconde, la connexion est coupée (flood réel) */
  coupureParFenetre: 600,
} as const;

export interface EtatFlood {
  flux: number;
  actions: number;
  /** dernier crédit des seaux (ms) */
  t: number;
  /** fenêtre brute (début, nombre de messages) */
  fenetreT: number;
  fenetreNb: number;
}

export type DecisionFlood = "ok" | "jeter" | "couper";

/** Seaux pleins à la connexion. */
export function creerEtatFlood(maintenant: number): EtatFlood {
  return { flux: ANTI_FLOOD.fluxRafale, actions: ANTI_FLOOD.actionsRafale, t: maintenant, fenetreT: maintenant, fenetreNb: 0 };
}

/**
 * Décision pour un message du type `type` reçu à `maintenant` : `ok` (traité), `jeter` (ignoré, la connexion reste ouverte) ou `couper`
 * (flood réel). Un type inconnu ou absent (message illisible) compte comme une action.
 */
export function admettre(e: EtatFlood, type: string | null, maintenant: number): DecisionFlood {
  if (maintenant - e.fenetreT >= 1000) { e.fenetreT = maintenant; e.fenetreNb = 0; }
  if (++e.fenetreNb > ANTI_FLOOD.coupureParFenetre) return "couper";
  const dt = Math.max(0, (maintenant - e.t) / 1000);
  e.t = maintenant;
  e.flux = Math.min(ANTI_FLOOD.fluxRafale, e.flux + ANTI_FLOOD.fluxParS * dt);
  e.actions = Math.min(ANTI_FLOOD.actionsRafale, e.actions + ANTI_FLOOD.actionsParS * dt);
  if (type !== null && TYPES_FLUX.has(type)) {
    if (e.flux < 1) return "jeter";
    e.flux -= 1;
    return "ok";
  }
  if (e.actions < 1) return "jeter";
  e.actions -= 1;
  return "ok";
}
