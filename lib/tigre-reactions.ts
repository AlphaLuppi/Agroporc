/**
 * Thème Tigre : réactions du tigre quand on clique ou tape dessus pendant
 * qu'il passe. Logique pure (tirage, durées, textes, anti-spam, demi-tour
 * recalculé depuis la position courante, particules) pour être testée ; les
 * animations et les minuteurs vivent dans `app/components/TigreCourant.tsx`.
 * Les `alea*` sont dans [0, 1[ (Math.random en production).
 */
import { VITESSES, type Passage } from "./tigre-courant";

/**
 * - regard : il s'arrête, nous regarde, puis repart ;
 * - saut : bond en arc sans s'arrêter ;
 * - tape : il tend la patte, un second clic dans la fenêtre = « Clap ! » ;
 * - sursaut : il sursaute, se retourne et file à l'éclair dans l'autre sens ;
 * - ronron : il s'arrête et ronronne (cœurs).
 */
export type Reaction = "regard" | "saut" | "tape" | "sursaut" | "ronron";

/** Poids du tirage, dans l'ordre : le saut et le regard sont les plus fréquents. */
export const POIDS_REACTIONS: ReadonlyArray<readonly [Reaction, number]> = [
  ["regard", 0.28],
  ["saut", 0.28],
  ["tape", 0.22],
  ["sursaut", 0.12],
  ["ronron", 0.10],
];

/**
 * Tire une réaction selon les poids. Jamais deux fois la même d'affilée :
 * si le tirage retombe sur `precedente`, on prend la suivante de la liste.
 */
export function tirerReaction(alea: number, precedente: Reaction | null = null): Reaction {
  let cumul = 0;
  let index = POIDS_REACTIONS.length - 1;
  for (let i = 0; i < POIDS_REACTIONS.length; i++) {
    cumul += POIDS_REACTIONS[i][1];
    if (alea < cumul) { index = i; break; }
  }
  if (POIDS_REACTIONS[index][0] === precedente) index = (index + 1) % POIDS_REACTIONS.length;
  return POIDS_REACTIONS[index][0];
}

/** Durées en ms (le sursaut compte jusqu'au départ en sens inverse). */
export const DUREES = {
  regard: 2200,
  saut: 700,
  sursaut: 350,
  ronron: 2400,
  /** Fenêtre où un second clic valide la tape dans la main. */
  fenetreTape: 2500,
  /** Pause après le « Clap ! » avant de repartir content. */
  clap: 900,
  /** Pause vexée avant de repartir quand personne n'a tapé. */
  vexe: 800,
  /** Les particules sont retirées après ce délai. */
  particules: 1300,
} as const;

/** Vitesse de lecture au départ : content (clap) plus vite, vexé plus lentement. */
export const VITESSE_CONTENT = 1.8;
export const VITESSE_VEXE = 0.75;

/** Une traversée de demi-tour ne dure jamais moins que ça (position près de la sortie). */
export const DUREE_DEMI_TOUR_MIN_MS = 250;

export type CleTexte = Reaction | "vexe" | "clap";

export const TEXTES: Record<CleTexte, readonly string[]> = {
  regard: ["Grrr ?", "Quoi ?", "Miaou.", "Tu veux ma photo ?", "J'ai l'air d'un chat ?"],
  saut: ["Hop !", "Hop là !", "Yeehaa !"],
  tape: ["Tape-m'en cinq !", "Tope là !"],
  sursaut: ["Aaah !", "Wouh !", "!?"],
  ronron: ["Prrr…", "Prrrrr…"],
  vexe: ["Hmpf.", "Pff…", "Quel manque de respect."],
  clap: ["🐾 Clap !"],
};

export function texteBulle(cle: CleTexte, alea: number): string {
  const textes = TEXTES[cle];
  return textes[Math.min(textes.length - 1, Math.floor(alea * textes.length))];
}

/** Ce qu'un clic déclenche selon l'état du tigre. */
export type DecisionClic = "lancer" | "taper" | "ignorer";

/**
 * Anti-spam : un clic pendant une réaction est ignoré, sauf celui qui valide
 * la tape dans la main (réaction « tape » et fenêtre encore ouverte).
 */
export function decisionClic(enCours: Reaction | null, fenetreTapeOuverte: boolean): DecisionClic {
  if (enCours === null) return "lancer";
  if (enCours === "tape" && fenetreTapeOuverte) return "taper";
  return "ignorer";
}

/**
 * Un nouveau passage ne part que si le précédent a quitté l'écran (une
 * réaction le prolonge : pause, ralenti) et qu'aucune réaction n'est en cours.
 */
export function passageAutorise(passageEnCours: boolean, reaction: Reaction | null): boolean {
  return !passageEnCours && reaction === null;
}

/** Délai avant de retenter un passage resté en attente. */
export const RETENTE_PASSAGE_MS = 600;

/** Abscisse (translateX) du groupe `tempsMs` après le début de `trajet`. */
export function positionCourante(trajet: Passage, tempsMs: number): number {
  const avancement = Math.min(1, Math.max(0, tempsMs / trajet.dureeMs));
  return trajet.deX + (trajet.aX - trajet.deX) * avancement;
}

/**
 * Demi-tour effrayé : le trajet repart de la position courante, dans le sens
 * opposé, jusqu'à la sortie opposée, à vitesse d'éclair. `tempsMs` = temps
 * déjà écoulé dans `trajet` (Animation.currentTime).
 */
export function demiTour(
  trajet: Passage,
  tempsMs: number,
  largeurEcran: number,
  largeurGroupe: number,
  largeurTigre: number,
  aleaVitesse: number,
): Passage {
  const deX = positionCourante(trajet, tempsMs);
  const sens: 1 | -1 = trajet.sens === 1 ? -1 : 1;
  const aX = sens === 1 ? largeurEcran : -largeurGroupe;
  const [min, max] = VITESSES.eclair;
  const vitesse = min + aleaVitesse * (max - min);
  const dureeMs = Math.max(
    DUREE_DEMI_TOUR_MIN_MS,
    Math.round((Math.abs(aX - deX) / (largeurTigre * vitesse)) * 1000),
  );
  return { sens, deX, aX, dureeMs };
}

/** Hauteur du bond : la moitié de la largeur du tigre, plafonnée. */
export function hauteurSaut(largeurTigre: number): number {
  return Math.min(110, Math.round(largeurTigre * 0.5));
}

/** Images clés d'un bond en arc (translateY + légère rotation, nez vers le haut). */
export function imagesSaut(hauteur: number): Keyframe[] {
  return [
    { transform: "translateY(0) rotate(0deg)", easing: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
    { transform: `translateY(${-hauteur}px) rotate(-8deg)`, offset: 0.45, easing: "cubic-bezier(0.6, 0, 0.8, 0.4)" },
    { transform: "translateY(0) rotate(0deg)" },
  ];
}

/** Images clés du sursaut : un petit bond écrasé, sur place. */
export function imagesSursaut(hauteur: number): Keyframe[] {
  return [
    { transform: "translateY(0) scale(1, 1)" },
    { transform: `translateY(${-hauteur}px) scale(0.94, 1.08)`, offset: 0.4 },
    { transform: "translateY(0) scale(1.05, 0.94)", offset: 0.8 },
    { transform: "translateY(0) scale(1, 1)" },
  ];
}

/** Particule jetée par une réaction (éclat du clap, cœurs du ronron). */
export interface Particule {
  id: number;
  glyphe: string;
  /** Déplacement final en px (dy < 0 = vers le haut). */
  dx: number;
  dy: number;
  retardMs: number;
}

const GLYPHES: Record<"clap" | "ronron", readonly string[]> = {
  clap: ["🐾", "✦", "✦", "✨"],
  ronron: ["♥", "♥", "♥"],
};

/**
 * Particules d'une réaction : le clap éclate dans toutes les directions, les
 * cœurs du ronron montent en dérivant. `alea` fournit des valeurs dans [0, 1[.
 */
export function creerParticules(
  type: "clap" | "ronron",
  nombre: number,
  premierId: number,
  alea: () => number,
): Particule[] {
  const glyphes = GLYPHES[type];
  return Array.from({ length: nombre }, (_, i) => {
    const glyphe = glyphes[i % glyphes.length];
    if (type === "ronron") {
      return {
        id: premierId + i, glyphe,
        dx: Math.round((alea() - 0.5) * 50), dy: -Math.round(40 + alea() * 40),
        retardMs: Math.round(i * 160 + alea() * 80),
      };
    }
    const angle = (i / nombre) * Math.PI * 2 + alea() * 0.6;
    const rayon = 35 + alea() * 30;
    return {
      id: premierId + i, glyphe,
      dx: Math.round(Math.cos(angle) * rayon), dy: Math.round(Math.sin(angle) * rayon),
      retardMs: 0,
    };
  });
}
