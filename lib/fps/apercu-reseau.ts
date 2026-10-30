/**
 * Le fil de l'aperçu : message serveur `apercu` (spectateurs de la vue Palantir, zombies et Battle Royale) construit côté serveur à partir du
 * snap déjà calculé, décodé côté client en `ApercuDirect`. PUR (pas de three, pas de DOM). Spec : docs/superpowers/specs/2026-10-29-apercus-modes-design.md
 */
import { decoderZombies, type BrApercu, type EtatJoueurSnap, type JoueurApercuFil, type MessageServeur, type ModeSalle, type SnapZombies } from "./protocole";
import { estimerDecalageServeur, type ApercuDirect, type JoueurAerien, type TigreAerien } from "./apercu-source";

export { APERCU } from "./apercu-source";

export type MessageApercu = Extract<MessageServeur, { t: "apercu" }>;

/** Drapeaux d'un joueur du fil. */
export const DRAPEAU_VIVANT = 1;
export const DRAPEAU_CHUTE_LIBRE = 2;
export const DRAPEAU_VOILE = 4;

/** Pseudo et couleur d'un joueur de la salle (la table du serveur). */
export interface NomJoueur { pseudo: string; couleur: string }

/** Position au décimètre entier. */
const dm = (m: number): number => Math.round(m * 10);

/** Construit un message `apercu` : un joueur = un tuple, les tigres = le `SnapZombies` tel quel. */
export function construireApercu(e: {
  mode: Exclude<ModeSalle, "arene">; ts: number; snap: readonly EtatJoueurSnap[]; noms: (id: string) => NomJoueur | undefined;
  zombies?: SnapZombies | null; manche?: number; br?: BrApercu; partie?: string;
}): MessageApercu {
  const j: JoueurApercuFil[] = [];
  for (const s of e.snap) {
    const nom = e.noms(s.id);
    if (!nom) continue;
    const drapeaux = (s.vivant ? DRAPEAU_VIVANT : 0) | (s.chute === "libre" ? DRAPEAU_CHUTE_LIBRE : 0) | (s.chute === "voile" ? DRAPEAU_VOILE : 0);
    j.push([s.id, nom.pseudo, nom.couleur, dm(s.p[0]), dm(s.p[1]), dm(s.p[2]), drapeaux]);
  }
  const m: MessageApercu = { t: "apercu", ts: e.ts, mode: e.mode, j };
  if (e.partie) m.partie = e.partie;
  if (e.zombies) m.z = e.zombies;
  if (e.manche !== undefined) m.m = e.manche;
  if (e.br) m.br = e.br;
  return m;
}

/** Joueur du fil → joueur affiché. */
function joueurDuFil(t: JoueurApercuFil): JoueurAerien {
  const vivant = (t[6] & DRAPEAU_VIVANT) !== 0;
  return {
    id: t[0], pseudo: t[1], couleur: t[2], p: [t[3] / 10, t[4] / 10, t[5] / 10],
    ...(t[6] & DRAPEAU_CHUTE_LIBRE ? { chute: "libre" as const } : t[6] & DRAPEAU_VOILE ? { chute: "voile" as const } : {}),
    ...(vivant ? {} : { hors: "terre" as const }),
  };
}

/** Message `apercu` reçu à `maintenant` (horloge locale, ms) → aperçu affichable. Les `fenetres` sont complétées par l'hôte (`zombies{etat}`). */
export function decoderApercu(m: MessageApercu, maintenant: number): ApercuDirect {
  const tigres: TigreAerien[] = m.z
    ? decoderZombies(m.z).map((z) => ({ id: z.id, x: z.x, z: z.z, cap: z.cap, type: z.type, mode: z.mode, pvPct: z.pvPct }))
    : [];
  const joueurs = m.j.map(joueurDuFil);
  const d: ApercuDirect = { mode: m.mode, joueurs, tigres, recuT: maintenant, decalageServeurMs: estimerDecalageServeur(m.ts, maintenant) };
  if (m.partie) d.partie = m.partie;
  if (m.m !== undefined) d.manche = m.m;
  if (m.br) {
    d.zone = m.br.zone;
    d.avion = m.br.avion;
    d.vivants = m.br.vivants;
    d.total = m.br.total;
    // en BR, un éliminé est un « mort » (pas « à terre »)
    for (const jo of joueurs) if (jo.hors) jo.hors = "mort";
  }
  return d;
}

/** Âge d'un aperçu (ms). */
export function ageApercu(d: ApercuDirect, maintenant: number): number {
  return maintenant - d.recuT;
}

export { estimerDecalageServeur };
