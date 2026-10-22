/**
 * Thème Tigre : réactions du tigre quand on clique ou tape dessus pendant
 * qu'il passe. Logique pure (tirage, durées, textes, anti-spam, demi-tour
 * recalculé depuis la position courante, particules) pour être testée ; les
 * animations vivent dans `lib/tigre3d/` (tigre 3D) et `app/components/TigreSprite.tsx`
 * (repli sprite) ; les minuteurs dans `app/components/Tigre3D.tsx`.
 * Les `alea*` sont dans [0, 1[ (Math.random en production).
 */
import { VITESSES, type Passage } from "./tigre-courant";
import { REPLIQUES_TIGRE } from "./repliques-lasso";

/**
 * Chaque réaction est un geste qui illustre sa bulle (tigre 3D : lib/tigre3d/gestes/<nom>.ts) :
 * - regard : il freine, tourne la tête puis le corps vers nous et nous dévisage, tête penchée
 *   (clip « Curious » du modèle en additif) ; la mimique suit le texte (humeurRegard) ;
 * - saut : bond en pleine course, sans s'arrêter, pattes du clip « Attack jump » en vol ;
 * - tape : face à nous, il s'assoit et lève une patte avant à hauteur de joue, coussinets vers
 *   l'écran : un second clic dans la fenêtre = la patte part vers l'écran, « Clap ! » ; sinon il
 *   baisse la patte et détourne la tête, vexé ;
 * - sursaut : il se fige, bondit à la verticale dos rond, fait demi-tour en l'air et file à l'éclair ;
 * - ronron : assis, tête basse et penchée (yeux mi-clos), il pétrit des pattes avant (cœurs) ;
 * - rugir : il se ramasse puis se projette vers nous, patte levée griffes en avant, menton grand
 *   ouvert (le modèle n'a pas d'intérieur de gueule), l'écran tremble ;
 * - salut : debout, il lève haut une patte et l'agite ;
 * - lecher : assis, il se lèche la patte puis se la passe sur la joue ;
 * - etirement : pattes avant tendues devant, poitrail au sol, arrière-train haut, il bâille ;
 * - serre-main : debout face à nous, il refait le chat « shake my hand » (applaudit, agite les
 *   pattes, réfléchit la patte au museau, tend la patte) : capture vidéo reciblée
 *   (lib/tigre3d/clips/chat-serre-main.json), une bulle par phase du clip.
 * - batte : dressé de profil face à Macron, il l'attend batte armée puis le frappe (« BONK ! »).
 *   Jamais tirée au clic (poids nul) : seule la rencontre avec Macron la lance (lib/rencontre.ts).
 */
export type Reaction =
  | "regard" | "saut" | "tape" | "sursaut" | "ronron" | "rugir" | "salut" | "lecher" | "etirement"
  | "serre-main" | "batte";

/** Poids du tirage, dans l'ordre : le saut et le regard restent les plus fréquents. */
export const POIDS_REACTIONS: ReadonlyArray<readonly [Reaction, number]> = [
  ["regard", 0.15],
  ["saut", 0.15],
  ["tape", 0.14],
  ["sursaut", 0.08],
  ["ronron", 0.08],
  ["rugir", 0.08],
  ["salut", 0.08],
  ["lecher", 0.07],
  ["etirement", 0.07],
  ["serre-main", 0.1],
  // Jamais au clic : la rencontre avec Macron la lance.
  ["batte", 0],
];

/**
 * Tire une réaction selon les poids. Jamais deux fois la même d'affilée :
 * si le tirage retombe sur `precedente`, on prend la suivante de la liste.
 * Une réaction de poids nul (batte) n'est jamais tirée, même par ce report.
 */
export function tirerReaction(alea: number, precedente: Reaction | null = null): Reaction {
  const tirables = POIDS_REACTIONS.filter(([, p]) => p > 0);
  let cumul = 0;
  let index = tirables.length - 1;
  for (let i = 0; i < tirables.length; i++) {
    cumul += tirables[i][1];
    if (alea < cumul) { index = i; break; }
  }
  if (tirables[index][0] === precedente) index = (index + 1) % tirables.length;
  return tirables[index][0];
}

/** Durées en ms (le sursaut compte jusqu'au départ en sens inverse). */
export const DUREES = {
  regard: 2400,
  saut: 900,
  sursaut: 550,
  ronron: 2800,
  rugir: 2300,
  salut: 2400,
  lecher: 2600,
  etirement: 2800,
  /** Indicatif (tigre 3D : la durée vient du geste, 0,95 + 6,8 + 0,9 s) ; repli sprite : arrêt plus court. */
  "serre-main": 8650,
  /** Indicatif (tigre 3D : entrée, attente batte armée, coup et sortie, cf. lib/tigre3d/gestes/batte.ts). */
  batte: 6000,
  /** Assis et patte levée : le second clic n'est pris qu'ensuite. */
  entreeTape: 700,
  /** Fenêtre où un second clic valide la tape dans la main. */
  fenetreTape: 2500,
  /** Pause après le « Clap ! » avant de repartir content. */
  clap: 1100,
  /** Pause vexée avant de repartir quand personne n'a tapé. */
  vexe: 1100,
  /** Les particules sont retirées après ce délai. */
  particules: 1300,
} as const;

/** Instant (ms depuis le début du geste) où la bulle apparaît, pour tomber pile sur ce qu'il dit. */
export const DELAI_BULLE: Record<Reaction, number> = {
  regard: 100, saut: 220, tape: 450, sursaut: 0, ronron: 450,
  rugir: 420, salut: 350, lecher: 800, etirement: 650, "serre-main": 950,
  // Batte : la bulle « BONK ! » part à l'impact, compté depuis le signal de frappe (gestes/batte.ts).
  batte: 350,
};

/** Réactions où le tigre s'immobilise (il ralentit puis s'arrête) ; saut et sursaut se font en mouvement ou sur place. */
const IMMOBILISE: ReadonlySet<Reaction> = new Set<Reaction>([
  "regard", "tape", "ronron", "rugir", "salut", "lecher", "etirement", "serre-main", "batte",
]);
export function immobilise(reaction: Reaction): boolean {
  return IMMOBILISE.has(reaction);
}

/** Vitesse de lecture au départ : content (clap) plus vite, vexé plus lentement. */
export const VITESSE_CONTENT = 1.8;
export const VITESSE_VEXE = 0.75;

/** Une traversée de demi-tour ne dure jamais moins que ça (position près de la sortie). */
export const DUREE_DEMI_TOUR_MIN_MS = 250;

/** `seum` / `libre` : pris au lasso, puis relâché (lib/tigre-lasso.ts), hors tirage des réactions. */
export type CleTexte = Reaction | "vexe" | "clap" | "seum" | "libre";

export const TEXTES: Record<CleTexte, readonly string[]> = {
  regard: ["Grrr ?", "Quoi ?", "Miaou.", "Tu veux ma photo ?", "J'ai l'air d'un chat ?"],
  saut: ["Hop !", "Hop là !", "Yeehaa !"],
  tape: ["Tape-m'en cinq !", "Tope là !"],
  sursaut: ["Aaah !", "Wouh !", "!?"],
  ronron: ["Prrr…", "Prrrrr…"],
  rugir: ["ROAAR !", "GRRROAAR !"],
  salut: ["Coucou !", "Salut, toi !"],
  lecher: ["Slurp.", "Un brin de toilette…"],
  etirement: ["Aaah, la sieste…", "Hmmm, ça fait du bien…"],
  /** Tirage par défaut ; le tigre 3D affiche une bulle par phase (lib/tigre3d/gestes/serre-main.ts). */
  "serre-main": ["Serre-moi la pince !", "Bravo, bravo !", "Tope là, l'ami !"],
  batte: ["BONK !"],
  vexe: ["Hmpf.", "Pff…", "Quel manque de respect."],
  clap: ["🐾 Clap !"],
  // Pris au lasso : répliques partagées avec le coureur « macron » (lib/repliques-lasso.ts).
  seum: REPLIQUES_TIGRE.pris,
  libre: REPLIQUES_TIGRE.libre,
};

/** Humeur du regard : elle règle la mimique (oreilles, paupières, gueule) pour coller au texte de la bulle. */
export type HumeurRegard = "curieux" | "fier" | "grognon" | "miaou" | "vexe";

const HUMEURS_REGARD: Record<string, HumeurRegard> = {
  "Grrr ?": "grognon",
  "Quoi ?": "curieux",
  "Miaou.": "miaou",
  "Tu veux ma photo ?": "fier",
  "J'ai l'air d'un chat ?": "vexe",
};

export function humeurRegard(texte: string): HumeurRegard {
  return HUMEURS_REGARD[texte] ?? "curieux";
}

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

/** Particule jetée par une réaction (éclat du clap, cœurs du ronron, « Z » de la sieste). */
export interface Particule {
  id: number;
  glyphe: string;
  /** Déplacement final en px (dy < 0 = vers le haut). */
  dx: number;
  dy: number;
  retardMs: number;
}

export type GenreParticule = "clap" | "ronron" | "zzz";

const GLYPHES: Record<GenreParticule, readonly string[]> = {
  clap: ["🐾", "✦", "✦", "✨"],
  ronron: ["♥", "♥", "♥"],
  zzz: ["Z", "z", "Z"],
};

/**
 * Particules d'une réaction : le clap éclate dans toutes les directions, les
 * cœurs du ronron montent en dérivant. `alea` fournit des valeurs dans [0, 1[.
 */
export function creerParticules(
  type: GenreParticule,
  nombre: number,
  premierId: number,
  alea: () => number,
): Particule[] {
  const glyphes = GLYPHES[type];
  return Array.from({ length: nombre }, (_, i) => {
    const glyphe = glyphes[i % glyphes.length];
    if (type === "ronron" || type === "zzz") {
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
