/**
 * Machine de la killcam (PUR) : rejeu à la première personne de 3 s (vue du tueur, d'après les snaps du tampon long : de 2,5 s avant la mort
 * à 0,5 s après, pour voir le coup fatal ET la victime tomber) puis carte du tueur de 1 s. Ancrée sur `mort.ts` (horodatage serveur de la mort), jamais sur l'horloge locale. Les fonctions renvoient de nouveaux objets.
 * Sans rejeu (tueur absent du tampon, mort par la circulation), la carte seule occupe toute l'attente (rejeuMs + carteMs = délai de
 * réapparition) : la barre de progression reste honnête et la carte reste affichée jusqu'à la réapparition.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.5, §5.11)
 */
import type { EtatJoueurSnap, InfoTueur, Vec3 } from "./protocole";
import { oeilDe } from "./protocole";

/**
 * `rejeuMs` : durée du rejeu, dont `apresMortMs` après l'instant de la mort ; `tamponMs` : profondeur des tampons longs ; `gelApresMortMs` :
 * les tampons se figent ce temps après la réception de `mort` (il faut y avoir reçu la fin du rejeu, `apresMortMs` après la mort).
 */
export const KILLCAM = { rejeuMs: 3000, apresMortMs: 500, carteMs: 1000, tamponMs: 5000, gelApresMortMs: 1100 } as const;
export type PhaseKillcam = "rejeu" | "carte" | "termine";
export interface Killcam {
  tueurId: string; tueur: InfoTueur | null; tMortServeur: number;
  /** rejeu possible (tueur trouvé dans le tampon) */
  avecRejeu: boolean; ecouleMs: number; phase: PhaseKillcam;
}

const DUREE_TOTALE_MS = KILLCAM.rejeuMs + KILLCAM.carteMs;

function phaseA(avecRejeu: boolean, ecouleMs: number): PhaseKillcam {
  if (ecouleMs >= DUREE_TOTALE_MS) return "termine";
  return avecRejeu && ecouleMs < KILLCAM.rejeuMs ? "rejeu" : "carte";
}

/** `tMortServeur` = `mort.ts` (horodatage serveur de la mort, pas l'horloge locale ni le dernier snap). */
export function demarrerKillcam(o: { tueurId: string; tueur?: InfoTueur; tMortServeur: number; tueurDansTampon: boolean }): Killcam {
  return {
    tueurId: o.tueurId,
    tueur: o.tueur ?? null,
    tMortServeur: o.tMortServeur,
    avecRejeu: o.tueurDansTampon,
    ecouleMs: 0,
    phase: phaseA(o.tueurDansTampon, 0),
  };
}

/** pur : renvoie un nouvel objet ; un temps négatif ou non fini n'avance pas. */
export function avancerKillcam(k: Killcam, dtS: number): Killcam {
  const ms = Number.isFinite(dtS) && dtS > 0 ? dtS * 1000 : 0;
  const ecouleMs = Math.min(DUREE_TOTALE_MS, k.ecouleMs + ms);
  return { ...k, ecouleMs, phase: phaseA(k.avecRejeu, ecouleMs) };
}

/** saute le rejeu → carte (sans effet en carte ou terminé ; la barre de progression saute à la fin du rejeu, la carte garde ses 1,5 s). */
export function passerKillcam(k: Killcam): Killcam {
  if (k.phase !== "rejeu") return { ...k };
  return { ...k, ecouleMs: KILLCAM.rejeuMs, phase: "carte" };
}

/** Premier instant (horloge du serveur) du rejeu de la mort survenue à `tMortServeur`. */
export function debutRejeu(tMortServeur: number): number {
  return tMortServeur - (KILLCAM.rejeuMs - KILLCAM.apresMortMs);
}

/** Horodatage serveur à échantillonner dans le tampon long (début = tMort − 2,5 s, 1×, figé à tMort + 0,5 s une fois le rejeu fini). */
export function tempsRejeuServeur(k: Killcam): number {
  return debutRejeu(k.tMortServeur) + Math.min(Math.max(0, k.ecouleMs), KILLCAM.rejeuMs);
}

/** 0..1 sur rejeuMs + carteMs */
export function progressionKillcam(k: Killcam): number {
  return Math.min(1, Math.max(0, k.ecouleMs / DUREE_TOTALE_MS));
}

/** Œil du tueur (`oeilDe` : debout, accroupi ou assis dans un véhicule, où `p` est la position du siège) et angles de sa vue. */
export function cameraTueur(e: Pick<EtatJoueurSnap, "p" | "lacet" | "tangage" | "accroupi" | "vehicule">): { pos: Vec3; lacet: number; tangage: number } {
  return { pos: [e.p[0], e.p[1] + oeilDe(e), e.p[2]], lacet: e.lacet, tangage: e.tangage };
}

/** Le tueur est-il dans le tampon à `t` ? (échantillon non vide pour son id) */
export function tueurPresent(echantillon: ReadonlyMap<string, EtatJoueurSnap>, tueurId: string): boolean {
  return tueurId !== "" && echantillon.has(tueurId);
}
