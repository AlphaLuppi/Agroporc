/**
 * Code secret « myrtille » : tapé au clavier n'importe où sur le site, il bascule
 * vers la vue 3D d'Agroparc ; retapé dans la vue 3D, il ramène à l'état initial.
 * L'écouteur est commun à tous les codes secrets (lib/code-secret.ts).
 */
import { ecouterCode, feedCode as feedCodeCommun, isTypingTarget } from "../code-secret";

export const CODE = "myrtille";
export { isTypingTarget };

/** Étape pure (cf. lib/code-secret.ts) ; le code vaut « myrtille » par défaut. */
export function feedCode(buffer: string, char: string, code: string = CODE) {
  return feedCodeCommun(buffer, char, code);
}

/**
 * Écoute le clavier et appelle `onMatch` à chaque fois que le code est tapé.
 * Retourne la fonction de nettoyage à appeler au démontage.
 */
export function listenForCode(onMatch: () => void, opts: { code?: string; target?: Window } = {}): () => void {
  return ecouterCode(opts.code ?? CODE, onMatch, opts.target ?? window);
}
