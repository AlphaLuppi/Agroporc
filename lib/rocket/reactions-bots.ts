/**
 * Rocket Muche : réactions rapides des BOTS (mode local et bots de la salle serveur). PUR et déterministe : le hasard vient d'un générateur
 * PROPRE au réacteur (`creerRng`), jamais de celui du monde (la physique, `empreinteMonde`, ne bouge pas d'un bit) ; le temps est le temps de jeu
 * passé en argument (secondes), aucune horloge globale.
 *
 * Le réacteur observe les événements du match (`observer`), planifie quelques réactions de bots avec un petit délai « humain », puis les rend à
 * l'échéance (`echeances`). Les bots restent bavards avec mesure : une chance sur deux ou moins par événement, au plus une réaction par bot
 * toutes les `COOLDOWN_BOT_S` secondes, au plus une toutes les `ECART_GLOBAL_S` pour l'ensemble des bots, et le même anti-spam que les
 * humains (`creerAntiSpam`). Les bots alliés envoient des infos d'équipe (au coup d'envoi), jamais les adversaires.
 */
import { creerRng, tirer, type Equipe, type EvenementMatch, type Rng } from "./contrat";
import { creerAntiSpam, type AntiSpam } from "./reactions";

/** Silence minimal d'un même bot entre deux réactions (s de jeu). */
export const COOLDOWN_BOT_S = 14;
/** Silence minimal entre deux réactions de bots quels qu'ils soient (s de jeu). */
export const ECART_GLOBAL_S = 3;
/** Délai de réaction après l'événement : entre ces deux bornes (s de jeu). */
export const DELAI_MIN_S = 0.5;
export const DELAI_MAX_S = 1.8;

/** Ce que le réacteur sait des voitures : qui est un bot, de quelle équipe. */
export interface VoitureReacteur {
  id: number;
  equipe: Equipe;
  bot: boolean;
}

export interface EnvoiBot {
  idVoiture: number;
  /** identifiant de réaction du catalogue */
  id: string;
}

export interface ReacteurBots {
  /** note les réactions que cet événement inspire (planifiées à `t` + délai) */
  observer(evenements: readonly EvenementMatch[], t: number): void;
  /** réactions arrivées à échéance à l'instant `t`, après cooldown et anti-spam (dans l'ordre d'échéance) */
  echeances(t: number): readonly EnvoiBot[];
  /** vide la file et les silences (nouveau match) */
  reinitialiser(): void;
  /** nombre de réactions en attente (essais) */
  enAttente(): number;
}

interface Planifie extends EnvoiBot {
  due: number;
}

const AUCUNE: readonly EnvoiBot[] = Object.freeze([]);

/** Salt du générateur : sépare ce flux de tous les autres dérivés de la graine du match. */
const SEL = 0x5ea1c0de;

export function creerReacteurBots(opts: { graine: number; voitures: readonly VoitureReacteur[] }): ReacteurBots {
  const voitures = opts.voitures;
  const rng: Rng = creerRng((Math.imul(opts.graine >>> 0, 2654435761) ^ SEL) >>> 0);
  const antiSpam = new Map<number, AntiSpam>();
  const dernier = new Map<number, number>();
  let dernierGlobal = -Infinity;
  let file: Planifie[] = [];

  const voiture = (id: number | null | undefined): VoitureReacteur | undefined => (id === null || id === undefined ? undefined : voitures.find((v) => v.id === id));
  const bots = (equipe: Equipe, sauf: number | null = null): VoitureReacteur[] => voitures.filter((v) => v.bot && v.equipe === equipe && v.id !== sauf);
  const choisir = <T>(liste: readonly T[]): T | undefined => (liste.length === 0 ? undefined : liste[Math.min(liste.length - 1, Math.floor(tirer(rng) * liste.length))]);
  const pile = (p: number): boolean => tirer(rng) < p;

  function planifier(t: number, idVoiture: number | undefined, choix: readonly string[], p: number): void {
    if (idVoiture === undefined) return;
    // le tirage de probabilité est consommé même en cas d'échec : le flux ne dépend pas des issues
    if (!pile(p)) return;
    const id = choisir(choix);
    if (id === undefined) return;
    const due = t + DELAI_MIN_S + tirer(rng) * (DELAI_MAX_S - DELAI_MIN_S);
    file.push({ idVoiture, id, due });
  }

  function observerUn(e: EvenementMatch, t: number): void {
    switch (e.t) {
      case "but": {
        const marqueur = voiture(e.idMarqueur);
        const attaque = e.equipe;
        const defense: Equipe = attaque === "bleue" ? "orange" : "bleue";
        // le buteur (bot) se vante ; un coéquipier bot le félicite ; un bot de l'équipe qui encaisse s'excuse
        if (marqueur?.bot) planifier(t, marqueur.id, ["rugissement", "plat-du-jour", "tie-un-tigre"], 0.55);
        planifier(t, choisir(bots(attaque, e.idMarqueur))?.id, ["tir-tigre", "goulaf", "sportif-goulaf"], 0.5);
        planifier(t, choisir(bots(defense))?.id, ["digestion", "myrtille", "edenred"], 0.45);
        break;
      }
      case "demolition": {
        const auteur = voiture(e.auteur);
        const victime = voiture(e.victime);
        if (auteur?.bot) planifier(t, auteur.id, ["tie-un-tigre", "rugissement", "en-marche"], 0.5);
        if (victime?.bot) planifier(t, victime.id, ["myrtille", "digestion", "pause-gourmande"], 0.35);
        break;
      }
      case "arret": {
        const gardien = voiture(e.idVoiture);
        if (!gardien) break;
        planifier(t, choisir(bots(gardien.equipe, gardien.id))?.id, ["goulaf", "sportif-goulaf"], 0.4);
        break;
      }
      case "coupDEnvoi": {
        // une info d'équipe : un seul bot par équipe, une fois sur quatre
        for (const equipe of ["bleue", "orange"] as const) planifier(t, choisir(bots(equipe))?.id, ["balle", "defense", "passe"], 0.25);
        break;
      }
      case "prolongation":
        planifier(t, choisir(voitures.filter((v) => v.bot))?.id, ["en-marche", "rugissement", "trefle"], 0.6);
        break;
      default:
        break;
    }
  }

  return {
    observer(evenements, t) {
      for (const e of evenements) observerUn(e, t);
    },
    echeances(t) {
      if (file.length === 0) return AUCUNE;
      const dues = file.filter((p) => p.due <= t).sort((a, b) => a.due - b.due || a.idVoiture - b.idVoiture);
      if (dues.length === 0) return AUCUNE;
      file = file.filter((p) => p.due > t);
      const res: EnvoiBot[] = [];
      for (const p of dues) {
        const bot = voiture(p.idVoiture);
        if (!bot?.bot) continue;
        if (t - (dernier.get(p.idVoiture) ?? -Infinity) < COOLDOWN_BOT_S) continue;
        if (t - dernierGlobal < ECART_GLOBAL_S) continue;
        let limiteur = antiSpam.get(p.idVoiture);
        if (!limiteur) antiSpam.set(p.idVoiture, (limiteur = creerAntiSpam()));
        if (!limiteur.essayer(t * 1000)) continue;
        dernier.set(p.idVoiture, t);
        dernierGlobal = t;
        res.push({ idVoiture: p.idVoiture, id: p.id });
      }
      return res;
    },
    reinitialiser() {
      file = [];
      dernier.clear();
      antiSpam.clear();
      dernierGlobal = -Infinity;
    },
    enAttente: () => file.length,
  };
}
