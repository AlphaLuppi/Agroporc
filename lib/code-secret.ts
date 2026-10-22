/**
 * Codes secrets tapés au clavier n'importe où sur le site (hors champ de saisie) : « myrtille »
 * (vue 3D d'Agroparc, lib/agroparc3d/myrtille.ts), « macron » (un coureur traverse l'écran,
 * lib/macron3d/). Chaque écouteur garde son propre tampon : deux codes ne se gênent pas.
 */

/**
 * Étape pure : ajoute un caractère tapé au tampon glissant.
 * Retourne le nouveau tampon et `matched` quand le code vient d'être complété
 * (le tampon est alors vidé pour qu'une nouvelle saisie complète soit nécessaire).
 */
export function feedCode(buffer: string, char: string, code: string): { buffer: string; matched: boolean } {
  const next = (buffer + char.toLowerCase()).slice(-code.length);
  const matched = next === code;
  return { buffer: matched ? "" : next, matched };
}

/** Vrai si la touche a été frappée dans un champ de saisie (on ne doit pas intercepter). */
export function isTypingTarget(
  target: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!target) return false;
  const tag = (target.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

/** Cible minimale d'écoute (window en pratique ; un faux objet dans les tests). */
export interface CibleClavier {
  addEventListener(type: "keydown", fn: (e: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", fn: (e: KeyboardEvent) => void): void;
}

/**
 * Écoute le clavier et appelle `onMatch` à chaque fois que `code` est tapé (touches de
 * modification et champs de saisie ignorés). Retourne la fonction de nettoyage.
 */
export function ecouterCode(code: string, onMatch: () => void, target: CibleClavier = window): () => void {
  let buffer = "";
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    // Un keydown synthétique (remplissage automatique de Chrome) peut arriver sans `key`.
    if (typeof e.key !== "string" || e.key.length !== 1) return;
    if (isTypingTarget(e.target as HTMLElement | null)) return;
    const r = feedCode(buffer, e.key, code);
    buffer = r.buffer;
    if (r.matched) onMatch();
  };
  target.addEventListener("keydown", onKey);
  return () => target.removeEventListener("keydown", onKey);
}
