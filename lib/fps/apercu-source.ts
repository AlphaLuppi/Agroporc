/**
 * Aperçu par mode de la vue Palantir : modèle d'affichage (joueurs, tigres, fenêtres, zone, avion), choix entre le DIRECT (vraies données
 * du serveur) et la SIMULATION, bandeau honnête. PUR (ni three, ni DOM, ni horloge : `maintenant` est un paramètre).
 * Spec : docs/superpowers/specs/2026-10-29-apercus-modes-design.md
 */
import type { AvionBr, ModeSalle, ZoneBr } from "./protocole";

/** Joueur vu d'en haut (position = pieds, en mètres). `sim` : faux joueur de la simulation ; `chute` : Battle Royale ; `hors` : à terre ou mort. */
export interface JoueurAerien {
  id: string;
  pseudo: string;
  /** "#rrggbb" attribuée par le serveur de l'arène */
  couleur: string;
  p: [number, number, number];
  sim?: true;
  chute?: "libre" | "voile";
  hors?: "terre" | "mort";
}

/** Mode d'un tigre zombie vu d'en haut. */
export type ModeTigreAerien = "chasse" | "sol" | "fenetre" | "saut";

/** Tigre zombie vu d'en haut (type : 0 tigre, 1 doré, 2 chef, 3 petit, 4 mini Truck Muche). */
export interface TigreAerien {
  id: number;
  x: number;
  z: number;
  cap: number;
  type: 0 | 1 | 2 | 3 | 4;
  mode: ModeTigreAerien;
  pvPct: number;
}

/** Ce que le rendu affiche, qu'il vienne du serveur (direct) ou d'une simulation. Les tableaux sont réutilisables d'une lecture à l'autre. */
export interface ModeleApercu {
  source: "direct" | "simulation";
  mode: ModeSalle;
  joueurs: JoueurAerien[];
  tigres: TigreAerien[];
  /** planches restantes par fenêtre, dans l'ordre de `FENETRES` (zombies) */
  fenetres?: number[];
  zone?: ZoneBr | null;
  avion?: AvionBr | null;
  manche?: number;
  vivants?: number;
  total?: number;
  /** id de la partie de Battle Royale d'où vient le direct */
  partie?: string;
  /** (simulation, temps de la simulation en ms) : horloge de la zone et de l'avion du Battle Royale */
  tSim?: number;
}

/** Aperçu en direct reçu du serveur (ou construit depuis l'instantané de l'arène). */
export interface ApercuDirect {
  mode: ModeSalle;
  partie?: string;
  joueurs: JoueurAerien[];
  tigres: TigreAerien[];
  fenetres?: number[];
  manche?: number;
  zone?: ZoneBr | null;
  avion?: AvionBr | null;
  vivants?: number;
  total?: number;
  /** réception, horloge locale (ms) */
  recuT: number;
  /** horloge serveur moins horloge locale (ms) : passe les horodatages de la zone et de l'avion à l'horloge du client */
  decalageServeurMs: number;
}

/** Cadences et délais de l'aperçu. */
export const APERCU = {
  /** un snap sur N part en `apercu` : 20 Hz / 4 = 5 Hz en zombies, 10 Hz / 3 = 3,3 Hz en Battle Royale */
  zombiesTousLesSnaps: 4,
  brTousLesSnaps: 3,
  /** un aperçu plus vieux que cela ne vaut plus rien */
  perimeMs: 3000,
  /** le direct disparu, la simulation ne revient qu'après ce délai (pas de clignotement entre deux paquets perdus) */
  retourSimulationMs: 4000,
} as const;

export type SourceApercu = "direct" | "simulation";

/**
 * Direct ou simulation ? Direct si connecté, le mode affiché est le mode confirmé par le serveur, l'aperçu est de ce mode, assez récent et montre
 * au moins un joueur réel ou un tigre.
 */
export function choisirSource(e: {
  modeAffiche: ModeSalle; modeConfirme: ModeSalle; connecte: boolean; direct: ApercuDirect | null; maintenant: number;
}): SourceApercu {
  const d = e.direct;
  if (!e.connecte || !d || e.modeAffiche !== e.modeConfirme || d.mode !== e.modeAffiche) return "simulation";
  if (e.maintenant - d.recuT > APERCU.perimeMs) return "simulation";
  return d.joueurs.length > 0 || d.tigres.length > 0 ? "direct" : "simulation";
}

/** Hystérésis : simulation → direct tout de suite ; direct → simulation seulement après `retourSimulationMs` sans direct. */
export class SuiviSource {
  private courante: SourceApercu = "simulation";
  private perduDepuis: number | null = null;

  maj(candidate: SourceApercu, maintenant: number): SourceApercu {
    if (candidate === "direct") {
      this.courante = "direct";
      this.perduDepuis = null;
    } else if (this.courante === "direct") {
      this.perduDepuis ??= maintenant;
      if (maintenant - this.perduDepuis >= APERCU.retourSimulationMs) {
        this.courante = "simulation";
        this.perduDepuis = null;
      }
    }
    return this.courante;
  }

  reinitialiser(): void {
    this.courante = "simulation";
    this.perduDepuis = null;
  }
}

export const TITRE_MODE: Record<ModeSalle, string> = { arene: "Match à mort", zombies: "Zombies tigres", br: "Battle Royale" };
/** Légende des repères de la vue, par mode. */
export const LEGENDE_MODE: Record<ModeSalle, string> = { arene: "Agents", zombies: "Survivants · Tigres · Fenêtres", br: "Joueurs · Zone · Avion" };

export interface Bandeau { etat: SourceApercu; titre: string; detail: string }

/** Ce que le bandeau sait du modèle affiché. */
export interface ResumeBandeau {
  joueurs: number;
  tigres: number;
  manche?: number;
  vivants?: number;
  total?: number;
  palier?: number;
  nbPaliers?: number;
  partie?: string;
  /** il y a une partie en cours (`salons`) mais pas d'aperçu en direct : serveur d'avant */
  partieEnCours?: boolean;
}

const pluriel = (n: number, un: string, plusieurs: string): string => `${n} ${n > 1 ? plusieurs : un}`;

export function libelleBandeau(source: SourceApercu, mode: ModeSalle, r: ResumeBandeau): Bandeau {
  const titre = TITRE_MODE[mode];
  const parties: string[] = [];
  if (source === "simulation") {
    if (r.partieEnCours) return { etat: "simulation", titre, detail: "partie en cours, aperçu en direct indisponible" };
    if (mode === "arene") parties.push(pluriel(r.joueurs, "agent fictif", "agents fictifs"));
    else if (mode === "zombies") {
      if (r.manche) parties.push(`manche ${r.manche}`);
      parties.push(pluriel(r.joueurs, "survivant fictif", "survivants fictifs"));
      if (r.tigres > 0) parties.push(pluriel(r.tigres, "tigre", "tigres"));
    } else {
      parties.push(`${r.vivants ?? r.joueurs} en vie sur ${r.total ?? r.joueurs}`);
      if (r.palier && r.nbPaliers) parties.push(`zone ${r.palier}/${r.nbPaliers}`);
    }
    return { etat: "simulation", titre, detail: parties.join(" · ") };
  }
  if (mode === "arene") parties.push(pluriel(r.joueurs, "joueur en jeu", "joueurs en jeu"));
  else if (mode === "zombies") {
    if (r.manche) parties.push(`manche ${r.manche}`);
    parties.push(pluriel(r.joueurs, "survivant", "survivants"));
    parties.push(pluriel(r.tigres, "tigre", "tigres"));
  } else {
    parties.push(`${r.vivants ?? r.joueurs} en vie sur ${r.total ?? r.joueurs}`);
    if (r.palier && r.nbPaliers) parties.push(`zone ${r.palier}/${r.nbPaliers}`);
    if (r.partie) parties.push(`partie ${r.partie}`);
  }
  return { etat: "direct", titre, detail: parties.join(" · ") };
}

/** Écart d'horloge serveur − client (ms) d'après l'horodatage `ts` d'un message reçu à `maintenant`. */
export function estimerDecalageServeur(ts: number, maintenant: number): number {
  return ts - maintenant;
}
