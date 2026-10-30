/**
 * Complément des faux `ContexteSalle` des tests qui n'ont rien à voir avec les bots du Battle Royale (v11) : les membres ajoutés au contexte
 * pour les bots, sans effet. Un test qui utilise des bots construit les siens (voir `match-br.test.ts`, `match-br-bots.test.ts`).
 */
import type { ContexteSalle } from "./match-contexte";

export const CONTEXTE_SANS_BOTS: Pick<ContexteSalle, "ajouterBot" | "retirerBot" | "recevoir" | "nouvelIdBot" | "nombreHumains" | "supportePolice"> = {
  ajouterBot: () => { throw new Error("ce faux contexte n'a pas de bots"); },
  retirerBot: () => {},
  recevoir: () => [],
  nouvelIdBot: () => "b1",
  nombreHumains: () => 0,
  // descente de police (2026-10-30) : tout le monde voit la voiture
  supportePolice: () => true,
};
