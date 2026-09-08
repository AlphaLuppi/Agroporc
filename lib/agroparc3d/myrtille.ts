/**
 * Code secret « myrtille » : tapé au clavier n'importe où sur le site, il bascule
 * vers la vue 3D d'Agroparc ; retapé dans la vue 3D, il ramène à l'état initial.
 */
export const CODE = "myrtille";

/**
 * Étape pure : ajoute un caractère tapé au tampon glissant.
 * Retourne le nouveau tampon et `matched` quand le code vient d'être complété
 * (le tampon est alors vidé pour qu'une nouvelle saisie complète soit nécessaire).
 */
export function feedCode(
  buffer: string,
  char: string,
  code: string = CODE,
): { buffer: string; matched: boolean } {
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

/**
 * Écoute le clavier et appelle `onMatch` à chaque fois que le code est tapé.
 * Retourne la fonction de nettoyage à appeler au démontage.
 */
export function listenForCode(
  onMatch: () => void,
  opts: { code?: string; target?: Window } = {},
): () => void {
  const code = opts.code ?? CODE;
  const target = opts.target ?? window;
  let buffer = "";
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return;
    if (isTypingTarget(e.target as HTMLElement | null)) return;
    const r = feedCode(buffer, e.key, code);
    buffer = r.buffer;
    if (r.matched) onMatch();
  };
  target.addEventListener("keydown", onKey);
  return () => target.removeEventListener("keydown", onKey);
}
