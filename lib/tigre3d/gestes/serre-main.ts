/**
 * « Serre-moi la pince ! » : debout sur ses pattes arrière, face à nous, le tigre refait EXACTEMENT
 * les mouvements du chat de la vidéo « shake my hand » : il applaudit, agite les pattes, lève le
 * pouce, croise les pattes, réfléchit la patte au museau, puis tend la patte vers l'écran.
 *
 * Aucune pose n'est écrite ici : le clip lib/tigre3d/clips/chat-serre-main.json est la capture du
 * chat reciblée hors ligne par scripts/tigre/retargeting_chat.mjs (une pose par image vidéo, 30 i/s,
 * timing de la vidéo). Seules l'entrée (il se dresse) et la sortie (il retombe à quatre pattes) sont
 * des transitions : la première image est tenue `ENTREE_SERRE_MAIN` s pendant que les poids des
 * groupes montent sur leurs ressorts (cf. animateur ; la queue d'abord), puis les poids retombent à
 * 0 pendant `SORTIE_SERRE_MAIN` s.
 *
 * Une bulle par phase de la vidéo (11 segments ; les 3 premières images, trop brèves, sont réunies
 * aux applaudissements qui suivent), au début du segment, jusqu'à la bulle suivante ; une phase trop
 * brève pour être lue (< `BULLE_MIN`) garde la bulle précédente.
 */
import donnees from "../clips/chat-serre-main.json";
import { dureeClip, echantillonnerClip } from "../clips";
import type { ClipImages, Geste, PoseGeste } from "./types";

export const CLIP_SERRE_MAIN = donnees as unknown as ClipImages & {
  segments: ReadonlyArray<{ debut: number; fin: number; geste: string }>;
};
/** Durée du clip (s) : 205 images à 30 i/s. */
export const DUREE_CLIP_SERRE_MAIN = dureeClip(CLIP_SERRE_MAIN);
/**
 * Il se dresse (première image tenue, poids qui montent) : la queue part la première
 * (`AVANCE_QUEUE` s), pour passer derrière lui avant qu'il se cabre au lieu de balayer le sol.
 */
export const ENTREE_SERRE_MAIN = 0.95;
const AVANCE_QUEUE = 0.25;
/** Il retombe à quatre pattes (poids qui retombent). */
export const SORTIE_SERRE_MAIN = 0.9;

/** Bulles : image vidéo de début (segment) → texte, lié à ce que fait la patte à l'écran. */
export const BULLES_SERRE_MAIN: ReadonlyArray<{ image: number; texte: string }> = [
  { image: 3, texte: "Bravo, bravo !" },              // 0–16 : applaudit (claps 3, 15)
  { image: 17, texte: "Youhou, par ici !" },          // 17–28 : pattes grandes ouvertes, agitées
  { image: 29, texte: "Clap clap clap !" },           // 29–45 : applaudit (claps 31, 36–43)
  { image: 46, texte: "Ouais !" },                    // 46–54 : pattes ouvertes agitées
  { image: 55, texte: "Standing ovation !" },         // 55–70 : applaudit (claps 56, 68)
  { image: 71, texte: "Au top !" },                   // 71–77 : « pouce » levé, l'autre patte agite
  { image: 78, texte: "Hmm…" },                       // 78–95 : pattes croisées, la tête plonge
  { image: 96, texte: "Laisse-moi réfléchir…" },      // 96–143 : patte à la joue puis au museau
  { image: 144, texte: "J'ai une idée !" },           // 144–155 : patte levée devant le nez, tête qui se redresse
  { image: 156, texte: "Serre-moi la pince !" },      // 156–204 : patte tendue vers l'écran
];

/** Événement de bulle avec son propre texte et sa durée (cf. `texte` / `duree` dans l'animateur). */
export type BulleSerreMain = { t: number; type: "bulle"; texte: string; duree: number };

const FIN_CLIP = ENTREE_SERRE_MAIN + DUREE_CLIP_SERRE_MAIN;
/**
 * Une bulle doit rester lisible : une phase plus brève que `BULLE_MIN` s (« Ouais ! », « Au top ! »,
 * 0,23 à 0,3 s, dont 0,2 s d'apparition) n'a pas sa bulle, la précédente reste affichée.
 */
export const BULLE_MIN = 0.35;
export const BULLES_AFFICHEES = BULLES_SERRE_MAIN.filter((b, k) => {
  const suivante = BULLES_SERRE_MAIN[k + 1];
  return k === 0 || !suivante || (suivante.image - b.image) / CLIP_SERRE_MAIN.fps >= BULLE_MIN;
});
/** La première bulle vient dès qu'il se dresse (il applaudit en se levant), pas après l'entrée. */
const PREMIERE_BULLE = 0.3;
export const EVENEMENTS_SERRE_MAIN: readonly BulleSerreMain[] = BULLES_AFFICHEES.map((b, k) => {
  const t = k === 0 ? PREMIERE_BULLE : ENTREE_SERRE_MAIN + b.image / CLIP_SERRE_MAIN.fps;
  const suivante = BULLES_AFFICHEES[k + 1];
  const fin = suivante ? ENTREE_SERRE_MAIN + suivante.image / CLIP_SERRE_MAIN.fps : FIN_CLIP + 0.3;
  // + 0,05 s : la bulle suivante la remplace, sans image vide entre les deux.
  return { t, type: "bulle", texte: b.texte, duree: +(fin - t + (suivante ? 0.05 : 0)).toFixed(3) };
});

const ZERO: NonNullable<PoseGeste["poids"]> = {
  corps: 0, colonne: 0, cou: 0, tete: 0, machoire: 0, oreilles: 0, queue: 0, avG: 0, avD: 0, arG: 0, arD: 0,
};

export const serreMain: Geste = {
  duree: ENTREE_SERRE_MAIN + DUREE_CLIP_SERRE_MAIN + SORTIE_SERRE_MAIN,
  immobile: true,
  // Face à nous, comme le chat.
  cap: () => 0,
  evenements: EVENEMENTS_SERRE_MAIN,
  echantillonner(t) {
    const tc = Math.min(Math.max(t - ENTREE_SERRE_MAIN, 0), DUREE_CLIP_SERRE_MAIN);
    // `brut` : tête, oreilles et queue sont celles de la capture (pas de bruit procédural ajouté).
    const p: PoseGeste = { ...echantillonnerClip(CLIP_SERRE_MAIN, tc), brut: true };
    if (t < AVANCE_QUEUE) return { ...p, poids: { ...ZERO, queue: 1 } };
    // Sortie : la dernière image reste la cible, les poids retombent (il se remet à quatre pattes).
    return t > FIN_CLIP ? { ...p, poids: ZERO } : p;
  },
};
