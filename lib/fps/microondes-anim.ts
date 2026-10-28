/**
 * Animation du Micro-ondes Gratinator (PUR, testé) : de l'état `EtatPap` diffusé par le serveur et de l'horloge serveur, ce que le rendu
 * dessine à cet instant (porte, arme posée sur le plateau, lumière intérieure, étincelles, afficheur). Déroulé de BO1 (le Pack-a-Punch) :
 * l'arme payée entre dans la machine porte ouverte, la porte se ferme, la cuisson tourne et grésille, puis la porte s'ouvre sur l'arme
 * gratinée qui avance vers le joueur et recule lentement pendant les 15 s où il peut la reprendre (BO1 `worldgun moveto`, 15 s).
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (Pack-a-Punch)
 */
import type { EtatPap } from "./protocole";
import { PACK_A_PUNCH } from "./zombies-carte";

/** Durée (ms) de la fermeture de la porte après l'entrée de l'arme, de son ouverture quand c'est prêt, de la sortie de l'arme. */
export const FERMETURE_PORTE_MS = 250;
export const OUVERTURE_PORTE_MS = 400;
export const SORTIE_ARME_MS = 500;
/** Les dernières `ALARME_MS` de la reprise, l'afficheur clignote vite : l'arme va être perdue. */
export const ALARME_MS = 5_000;

export interface ImageMicroondes {
  /** ouverture de la porte, 0 (fermée) à 1 (grande ouverte) */
  porte: number;
  /** arme visible dans la machine, gratinée (sortie de cuisson) ou non */
  arme: boolean;
  gratinee: boolean;
  /** avancée de l'arme : 0 au centre du plateau, 1 au ras de la porte (elle entre et sort par là) */
  avance: number;
  /** le plateau tourne (cuisson) */
  plateau: boolean;
  /** lumière intérieure 0..1 (orange pendant la cuisson), étincelles du magnétron */
  lumiere: number;
  etincelles: boolean;
  /** texte de l'afficheur (vide = éteint) ; alarme : la reprise touche à sa fin */
  affichage: string;
  alarme: boolean;
}

const borne = (x: number) => Math.max(0, Math.min(1, x));
/** Freinage en fin de course. */
const sortieDouce = (x: number) => 1 - (1 - borne(x)) ** 3;

/** Image du Micro-ondes à l'horloge serveur `t` (ms) ; `courant` : le courant est rétabli (machine sous tension). */
export function imageMicroondes(pap: EtatPap, t: number, courant: boolean): ImageMicroondes {
  const repos: ImageMicroondes = {
    porte: 0, arme: false, gratinee: false, avance: 0, plateau: false, lumiere: courant ? 0.15 : 0, etincelles: false,
    affichage: courant ? "GRATINATOR" : "", alarme: false,
  };
  if (pap.etat === "libre" || pap.finT === undefined) return repos;
  if (pap.etat === "cuisson") {
    const debut = pap.debutT ?? pap.finT - PACK_A_PUNCH.cuissonMs;
    const k = t - debut;
    const reste = Math.max(0, pap.finT - t);
    const entree = PACK_A_PUNCH.entreeMs;
    if (k < entree) {
      // l'arme entre par la porte ouverte et glisse jusqu'au centre du plateau
      return { ...repos, porte: 1, arme: true, avance: 1 - sortieDouce(k / entree), lumiere: 0.5, affichage: "" };
    }
    const porte = 1 - borne((k - entree) / FERMETURE_PORTE_MS);
    return {
      ...repos, porte, arme: true, avance: 0, plateau: porte === 0, lumiere: porte === 0 ? 0.85 : 0.5, etincelles: porte === 0,
      affichage: `0:${String(Math.ceil(reste / 1000)).padStart(2, "0")}`,
    };
  }
  // prête : la porte s'ouvre, l'arme gratinée avance vers le joueur puis recule lentement jusqu'à la fin de la reprise
  const debut = pap.finT - PACK_A_PUNCH.repriseMs;
  const k = t - debut;
  const reste = pap.finT - t;
  const sortie = sortieDouce(k / SORTIE_ARME_MS);
  const recul = borne((k - SORTIE_ARME_MS) / (PACK_A_PUNCH.repriseMs - SORTIE_ARME_MS));
  return {
    ...repos, porte: borne(k / OUVERTURE_PORTE_MS), arme: reste > 0, gratinee: true, avance: k < SORTIE_ARME_MS ? sortie : 1 - 0.9 * recul,
    lumiere: 0.6, affichage: "PRÊT", alarme: reste <= ALARME_MS,
  };
}
