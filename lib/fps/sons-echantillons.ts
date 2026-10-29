/**
 * Registre des sons ÉCHANTILLONNÉS du mode zombies (fichiers de public/arene/sons/, crédits dans public/arene/CREDITS.txt) et la
 * logique pure de leur lecture : calage du pic d'un son sur un instant voulu, limite de voix, file des annonces parlées.
 * Sans WebAudio ni DOM (testé) : `sons.ts` charge et joue, ce module décide quoi, quand et combien.
 *
 * Effets : scripts/fps/generer_sons.sh (sources libres CC0 / CC BY 4.0, micro-ondes synthétisé) ; annonces : scripts/fps/generer_voix.sh
 * (synthèse vocale hors ligne, voix française traitée en annonceur). Un son se remplace par scripts/fps/importer_son.sh, sans toucher
 * au code : le pic est retrouvé à la lecture (`instantPic`). Aucun son de Black Ops (sous droits).
 */
import type { GenreBonus } from "./zombies-vagues";

/** Effets échantillonnés, chacun avec un repli synthétisé dans `sons.ts` tant que le fichier n'est pas chargé (ou s'il manque). */
export type IdEchantillon =
  | "tonnerre" | "rireTruck" | "explosionGrenade" | "rebondGrenade" | "fanfareBonus"
  | "grognementChef" | "griffeChef" | "microOndesCuisson" | "microOndesBip";

export interface DefEchantillon {
  /** chemin servi par Next (public/…) */
  url: string;
  /** gain de lecture (avant le master à 0,55) */
  gain: number;
  /** lectures simultanées au plus de CE son : au-delà, la nouvelle est ignorée (ex. dix grenades qui rebondissent) */
  voixMax: number;
}

export const ECHANTILLONS: Readonly<Record<IdEchantillon, DefEchantillon>> = {
  /** éclair de la manche du Truck Muche (les manches des chiens de BO1 s'ouvrent sur un coup de tonnerre) */
  tonnerre: { url: "/arene/sons/tonnerre.mp3", gain: 0.9, voixMax: 1 },
  /** rire du Truck Muche enragé (rire maléfique descendu, écho de hangar) */
  rireTruck: { url: "/arene/sons/rire-truck.mp3", gain: 0.8, voixMax: 1 },
  explosionGrenade: { url: "/arene/sons/explosion-grenade.mp3", gain: 0.95, voixMax: 4 },
  rebondGrenade: { url: "/arene/sons/rebond-grenade.mp3", gain: 0.5, voixMax: 4 },
  /** bonus ramassé (montée « power-up »), avant l'annonce parlée */
  fanfareBonus: { url: "/arene/sons/fanfare-bonus.mp3", gain: 0.45, voixMax: 2 },
  /** rugissement du tigre chef (le gros tigre rouge à toque) */
  grognementChef: { url: "/arene/sons/grognement-chef.mp3", gain: 0.85, voixMax: 2 },
  /** coup de patte du tigre chef : son du joueur (retour 16), provisoirement un effort d'ogre ralenti ; pic calé sur le contact */
  griffeChef: { url: "/arene/sons/griffe-chef.mp3", gain: 0.9, voixMax: 3 },
  /** micro-ondes Gratinator (Pack-a-Punch) : porte qui claque + bourdonnement de cuisson (3,4 s) */
  microOndesCuisson: { url: "/arene/sons/microondes-cuisson.mp3", gain: 0.6, voixMax: 1 },
  /** trois bips à 1 kHz de fin de cuisson, loquet de la porte */
  microOndesBip: { url: "/arene/sons/microondes-bip.mp3", gain: 0.55, voixMax: 1 },
};

export const IDS_ECHANTILLONS = Object.keys(ECHANTILLONS) as IdEchantillon[];

/** Annonces parlées (voix d'annonceur), jouées par la file `FileAnnonces`. */
export type IdVoix =
  | "munitions" | "instakill" | "double" | "nuke" | "menuisier" | "soldes"
  | "truck" | "courant" | "partie_perdue";

export interface DefVoix {
  url: string;
  /** texte dit par la synthèse vocale du navigateur si le fichier ne se charge pas (repli) */
  texte: string;
}

export const VOIX_ANNONCES: Readonly<Record<IdVoix, DefVoix>> = {
  munitions: { url: "/arene/sons/voix/munitions.mp3", texte: "Munitions max !" },
  instakill: { url: "/arene/sons/voix/instakill.mp3", texte: "Insta-kill !" },
  double: { url: "/arene/sons/voix/double.mp3", texte: "Double points !" },
  nuke: { url: "/arene/sons/voix/nuke.mp3", texte: "Kaboum !" },
  menuisier: { url: "/arene/sons/voix/menuisier.mp3", texte: "Menuisier !" },
  soldes: { url: "/arene/sons/voix/soldes.mp3", texte: "Happy hour ! Tout à dix balles !" },
  truck: { url: "/arene/sons/voix/truck.mp3", texte: "Livraison du Truck Muche ! Ça va piquer !" },
  courant: { url: "/arene/sons/voix/courant.mp3", texte: "Courant rétabli !" },
  partie_perdue: { url: "/arene/sons/voix/partie_perdue.mp3", texte: "Fin du service. Tout le monde à la plonge." },
};

export const IDS_VOIX = Object.keys(VOIX_ANNONCES) as IdVoix[];

const VOIX_BONUS: Readonly<Record<GenreBonus, IdVoix>> = {
  munitions: "munitions", instakill: "instakill", double: "double", nuke: "nuke", menuisier: "menuisier", soldes: "soldes",
};
/** Annonce d'un bonus ramassé. */
export const voixDuBonus = (genre: GenreBonus): IdVoix => VOIX_BONUS[genre];

/** Tous les fichiers du mode zombies, préchargés à l'entrée dans la salle (premier geste) pour ne pas attendre le premier chef. */
export const URLS_ZOMBIES: readonly string[] = [
  ...IDS_ECHANTILLONS.map((id) => ECHANTILLONS[id].url),
  ...IDS_VOIX.map((id) => VOIX_ANNONCES[id].url),
];

/** Poids plafonds (octets) : un effet, une annonce, l'ensemble (tout est téléchargé à l'entrée en zombies). */
export const POIDS_MAX_EFFET = 80_000;
export const POIDS_MAX_VOIX = 30_000;
export const POIDS_MAX_TOTAL = 2_000_000;

/** Lectures simultanées au plus, tous échantillons confondus (le compresseur du master sature au-delà). */
export const ECHANTILLONS_SIMULTANES_MAX = 10;

/**
 * Instant (s) du maximum de l'enveloppe d'un son : la crête lissée sur des fenêtres de `fenetreS` (10 ms). Sert à caler le claquement
 * d'un coup de patte sur le contact du serveur quel que soit le fichier (celui du joueur se pose sans réglage). 0 pour un son vide.
 */
export function instantPic(donnees: ArrayLike<number>, frequence: number, fenetreS = 0.01): number {
  const n = donnees.length;
  if (n === 0 || !(frequence > 0)) return 0;
  const fen = Math.max(1, Math.round(frequence * fenetreS));
  let meilleur = -1, debut = 0;
  for (let i = 0; i < n; i += fen) {
    let m = 0;
    const fin = Math.min(n, i + fen);
    for (let k = i; k < fin; k++) {
      const v = Math.abs(donnees[k]);
      if (v > m) m = v;
    }
    if (m > meilleur) { meilleur = m; debut = i; }
  }
  return debut / frequence;
}

/**
 * Départ d'un son dont le pic (s après son début) doit tomber dans `dans` s : `retard` avant de lancer la lecture, `decalage` dans le
 * fichier (on saute le début quand le pic arrive plus tard que l'instant voulu). Toujours ≥ 0.
 */
export function departCale(pic: number, dans: number): { retard: number; decalage: number } {
  const p = Math.max(0, pic), d = Math.max(0, dans);
  return p <= d ? { retard: d - p, decalage: 0 } : { retard: 0, decalage: p - d };
}

/**
 * Voix libre ? `fins` = instants (horloge audio, s) où finissent les lectures en cours de ce son ; rend les lectures encore en cours à
 * `t` et si une nouvelle peut partir (moins de `max` en cours).
 */
export function voixLibre(fins: readonly number[], t: number, max: number): { fins: number[]; libre: boolean } {
  const encore = fins.filter((f) => f > t);
  return { fins: encore, libre: encore.length < max };
}

/** Silence entre deux annonces de la file (s). */
export const ECART_ANNONCES_S = 0.15;
/** Annonces en attente au plus (sans compter celle qui parle) : au-delà, la nouvelle est abandonnée. */
export const ANNONCES_EN_ATTENTE_MAX = 2;

/**
 * File des annonces parlées : on ne coupe jamais celle qui parle (l'ancien `speechSynthesis.cancel()` faisait taire « Munitions max »
 * dès que « Double points » arrivait), on enchaîne avec `ECART_ANNONCES_S` de silence, et au plus `ANNONCES_EN_ATTENTE_MAX` attendent.
 * Horloge en paramètre (celle du contexte audio).
 */
export class FileAnnonces {
  private plages: { debut: number; fin: number }[] = [];

  /**
   * Réserve la prochaine place pour une annonce de `duree` s demandée à `t`, au plus tôt à `auPlusTot` (ex. après la fanfare du bonus) ;
   * rend l'instant de départ, ou `null` si la file est pleine.
   */
  planifier(t: number, duree: number, auPlusTot = t): number | null {
    this.plages = this.plages.filter((p) => p.fin > t);
    const enAttente = this.plages.filter((p) => p.debut > t).length;
    if (enAttente >= ANNONCES_EN_ATTENTE_MAX) return null;
    const derniere = this.plages.length ? this.plages[this.plages.length - 1].fin + ECART_ANNONCES_S : t;
    const debut = Math.max(t, auPlusTot, derniere);
    this.plages.push({ debut, fin: debut + Math.max(0, duree) });
    return debut;
  }

  /** Annonces en cours ou à venir à `t`. */
  taille(t: number): number {
    return this.plages.filter((p) => p.fin > t).length;
  }

  vider(): void {
    this.plages = [];
  }
}

/**
 * Souffle d'un tir explosif (zombies) : à partir de ce rayon (m), c'est une vraie explosion de grenade (pistolet gratiné, lance-gratins,
 * bazooka) ; en dessous (pistolet à rayons, qui tire vite), le « pouf » synthétisé plus court, pour ne pas saturer.
 */
export const RAYON_EXPLOSION_GRENADE_M = 2.5;
/** Son d'un souffle de rayon `rayon` : l'explosion échantillonnée (avec sa force 0..1) ou le pouf synthétisé (force 0..1). */
export function sonExplosion(rayon: number): { genre: "grenade" | "pouf"; force: number } {
  return rayon >= RAYON_EXPLOSION_GRENADE_M
    ? { genre: "grenade", force: Math.min(1, rayon / 4.5) }
    : { genre: "pouf", force: Math.min(1, Math.max(0, rayon) / 6) };
}
