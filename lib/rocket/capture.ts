/**
 * Rocket Muche : capture d'une entrée pour les réglages (« Appuie sur un bouton ou pousse un stick… »). PUR : le DOM (requestAnimationFrame,
 * `navigator.getGamepads()`) reste dans `app/components/rocket/`.
 *
 * - `debuterCapture` / `captureEnCours` : drapeau partagé entre l'interface et le jeu. Tant qu'une capture est ouverte, le jeu n'interprète
 *   ni Start (qui fermerait le menu pause), ni Retour (qui quitterait), ni A (qui rejouerait), et le menu pause ignore Échap.
 * - `baseDeCapture` / `detecterEntree` : détection d'un bouton enfoncé ou d'un demi-axe poussé, EN IGNORANT ce qui était déjà enfoncé au moment
 *   du clic (le bouton qui a ouvert la capture, un stick tenu) et le repos non nul de certains axes (gâchettes exposées en axes à -1).
 */
import { SEUIL_ENTREE_MANETTE, type EntreeManette, type InstantaneManette } from "./contrat";
import { codeAxe, codeBouton } from "./liaisons";

// ============================================================================================================================
// Drapeau « capture en cours »
// ============================================================================================================================

let ouvertes = 0;

/** Ouvre une capture ; rend la fonction qui la ferme (idempotente). Plusieurs captures simultanées sont comptées. */
export function debuterCapture(): () => void {
  ouvertes++;
  let fermee = false;
  return () => {
    if (fermee) return;
    fermee = true;
    ouvertes = Math.max(0, ouvertes - 1);
  };
}
/** Vrai tant qu'au moins une capture est ouverte. */
export const captureEnCours = (): boolean => ouvertes > 0;

// ============================================================================================================================
// Détection sur la manette
// ============================================================================================================================

/** Repos d'un axe au-delà duquel on le juge « tenu » au départ : il doit revenir près de son repos avant de compter. */
const SEUIL_TENU = 0.5;
/** Retour près du repos qui libère un axe ou un bouton tenu au départ. */
const SEUIL_LACHE = 0.3;
/** Écart au repos, en valeur d'axe, qui vaut « poussé » (un peu plus que le seuil d'une action à deux états : volonté nette). */
const ECART_POUSSE = SEUIL_ENTREE_MANETTE + 0.1;
/** Les axes des sticks du mapping standard reposent à 0 ; les suivants (gâchettes exposées en axes par certains navigateurs) à leur valeur initiale. */
const AXES_STICKS = 4;

export interface BaseCapture {
  /** boutons enfoncés au départ (ignorés jusqu'à leur relâchement) */
  boutons: boolean[];
  /** valeur de repos de chaque axe */
  repos: number[];
  /** axes tenus au départ (ignorés jusqu'au retour près du repos) */
  axesTenus: boolean[];
}

const valeurAxe = (m: InstantaneManette, i: number): number => {
  const v = m.axes[i];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};
const boutonEnfonce = (m: InstantaneManette, i: number): boolean => {
  const b = m.boutons[i];
  return !!b && (b.pressed || b.value >= SEUIL_ENTREE_MANETTE);
};

/** État de référence au moment où la capture s'ouvre. */
export function baseDeCapture(m: InstantaneManette): BaseCapture {
  const repos = m.axes.map((v, i) => (i < AXES_STICKS ? 0 : typeof v === "number" && Number.isFinite(v) ? v : 0));
  return {
    boutons: m.boutons.map((_, i) => boutonEnfonce(m, i)),
    repos,
    axesTenus: m.axes.map((_, i) => Math.abs(valeurAxe(m, i) - repos[i]) >= SEUIL_TENU),
  };
}

/**
 * Cherche une entrée nouvelle : un bouton enfoncé (le plus petit indice d'abord), sinon le demi-axe le plus poussé. Rend aussi la base mise
 * à jour (un bouton ou un axe tenu au départ redevient détectable une fois relâché). Pure : `base` n'est pas modifiée.
 */
export function detecterEntree(base: Readonly<BaseCapture>, m: InstantaneManette): { code: EntreeManette | null; base: BaseCapture } {
  const boutons = [...base.boutons];
  const axesTenus = [...base.axesTenus];
  const repos = [...base.repos];
  while (boutons.length < m.boutons.length) boutons.push(false);
  while (axesTenus.length < m.axes.length) { axesTenus.push(false); repos.push(0); }

  for (let i = 0; i < m.boutons.length; i++) {
    const enfonce = boutonEnfonce(m, i);
    if (boutons[i]) { if (!enfonce) boutons[i] = false; continue; }
    if (enfonce) return { code: codeBouton(i), base: { boutons, repos, axesTenus } };
  }

  let meilleur: { i: number; ecart: number } | null = null;
  for (let i = 0; i < m.axes.length; i++) {
    const ecart = valeurAxe(m, i) - repos[i];
    if (axesTenus[i]) { if (Math.abs(ecart) < SEUIL_LACHE) axesTenus[i] = false; continue; }
    if (Math.abs(ecart) >= ECART_POUSSE && (meilleur === null || Math.abs(ecart) > Math.abs(meilleur.ecart))) meilleur = { i, ecart };
  }
  if (meilleur) return { code: codeAxe(meilleur.i, meilleur.ecart > 0 ? 1 : -1), base: { boutons, repos, axesTenus } };
  return { code: null, base: { boutons, repos, axesTenus } };
}

/** Plus rien d'enfoncé ni de poussé (les axes sont comparés à leur repos de départ : une gâchette-axe à -1 est au repos). */
export function toutRelache(base: Readonly<BaseCapture>, m: InstantaneManette): boolean {
  for (let i = 0; i < m.boutons.length; i++) if (boutonEnfonce(m, i)) return false;
  for (let i = 0; i < m.axes.length; i++) if (Math.abs(valeurAxe(m, i) - (base.repos[i] ?? 0)) >= SEUIL_LACHE) return false;
  return true;
}
