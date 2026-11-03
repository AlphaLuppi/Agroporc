/**
 * Souris rendue à la mort (arène) : à ma mort et à l'entracte, le jeu libère lui-même le pointeur (`document.exitPointerLock`) pour que le curseur
 * apparaisse et qu'on clique sur les tuiles de la barre des armes (`BarreArmes.tsx`). Ce n'est PAS une pause : le HUD garde l'écran de mort, la
 * killcam, la carte du tueur et la barre, sans menu pause (`HudEtat.sourisRendue`). Le rejeu de la killcam continue : sa caméra ne dépend pas de la souris.
 *
 *  - clavier sans verrou : tant que la souris est rendue, les touches marchent (passer la killcam, 1 / 2 / 3, Tab, parler) ; Échap ouvre le vrai menu
 *    pause, Échap de nouveau (ou un clic sur le jeu, ou « Reprendre ») revient à l'écran de mort, jamais deux menus l'un sur l'autre ;
 *  - réapparu, la souris reste libre jusqu'au premier geste (`requestPointerLock` l'exige) : un clic sur le jeu ou une touche de jeu la reprend, une
 *    invite discrète « Cliquez pour reprendre » remplace le menu pause, plus lourd à fermer ; un refus du navigateur (délai après une sortie) est sans
 *    erreur : le geste suivant réessaie.
 *
 * BR et zombies n'ont pas de barre des armes à la mort : rien ne change. Le crochet de test (`forceActif`) garde la souris prise : les e2e ne voient rien.
 * Fonctions PURES, testées dans `souris-mort.test.ts` ; `jeu.ts` les applique.
 */

export interface ContexteSouris {
  mode: "arene" | "zombies" | "br";
  /** déjà apparu une fois (avant la première apparition, « Jouer » prend la souris comme d'habitude) */
  apparu: boolean;
  vivant: boolean;
  /** entracte de l'arène (podium, replay de fin, barre des armes) */
  entracte: boolean;
  /** crochet de test `window.__arene` : la souris n'est jamais rendue */
  forceActif: boolean;
}

/** L'écran propose la barre des armes (mort après une apparition, ou entracte, en arène) : la souris y reste libre. */
export function ecranAvecBarre(c: ContexteSouris): boolean {
  return c.mode === "arene" && !c.forceActif && ((c.apparu && !c.vivant) || c.entracte);
}

/** À ma mort ou au début de l'entracte : faut-il rendre la souris (elle est prise et l'écran propose la barre) ? */
export function rendreSouris(c: ContexteSouris & { verrouille: boolean }): boolean {
  return c.verrouille && ecranAvecBarre(c);
}

/**
 * Touche enfoncée SANS verrou :
 *  - `ignorer` : comportement historique (menu pause ouvert, ou souris libre hors de l'arène) ;
 *  - `pause` : Échap, souris rendue → le vrai menu pause s'ouvre ;
 *  - `ecran` : Échap dans le menu pause pendant la mort / l'entracte → retour à l'écran de mort, souris rendue ;
 *  - `traiter` : la touche agit comme si la souris était prise, sans la reprendre (mort, entracte) ;
 *  - `reprendre` : réapparu, souris rendue → on demande le verrou (une touche est un geste valide, sauf Échap) ET la touche agit.
 */
export type DecisionToucheLibre = "ignorer" | "pause" | "ecran" | "traiter" | "reprendre";

export interface OptionsToucheLibre {
  /** menu de développement ouvert (F9) : il a son propre clavier, le jeu ne prend rien (ni Espace, ni Tab, ni reprise de la souris) */
  menuOuvert?: boolean;
  /** la touche ouvre ou ferme le menu de développement : le HUD la traite, elle ne reprend jamais la souris (sinon le menu se refermerait aussitôt) */
  toucheMenu?: boolean;
  /** répétition automatique d'une touche tenue : elle agit, mais ne redemande pas le verrou à chaque répétition */
  repetition?: boolean;
}

export function decisionToucheLibre(code: string, sourisRendue: boolean, ecran: boolean, o: OptionsToucheLibre = {}): DecisionToucheLibre {
  if (o.menuOuvert || o.toucheMenu) return "ignorer";
  if (code === "Escape") return sourisRendue ? "pause" : ecran ? "ecran" : "ignorer";
  if (!sourisRendue) return "ignorer";
  return ecran || o.repetition ? "traiter" : "reprendre";
}

/**
 * Codes à garder enfoncés quand le pointeur est perdu : seulement si c'est le jeu qui a rendu la souris (mort, entracte), l'appuyer pour parler continue
 * (le lien vocal victime ↔ tueur s'ouvre justement à la mort, et les répétitions de T sont ignorées : le joueur resterait muet). Toute autre perte de la
 * souris (Échap, alt-tab) relâche tout.
 */
export function codesGardesALaSortie(appuyees: Iterable<string>, actionsDe: (code: string) => readonly string[] | undefined, sourisRendue: boolean): string[] {
  if (!sourisRendue) return [];
  return [...appuyees].filter((c) => (actionsDe(c) ?? []).includes("parler"));
}

/**
 * Clic sur le jeu (canvas) sans verrou, ou bouton « Jouer » / « Reprendre » : `ecran` = revenir à l'écran de mort sans prendre la souris (on y clique
 * les tuiles), `verrou` = demander le verrou (réapparu, ou hors de l'écran de mort).
 */
export function decisionClicLibre(ecran: boolean): "ecran" | "verrou" {
  return ecran ? "ecran" : "verrou";
}

/** Invite « Cliquez pour reprendre » : réapparu (ou nouveau match) alors que la souris rendue n'a pas encore été reprise. */
export function inviteReprise(h: { sourisRendue?: boolean; mort: boolean; entracte: boolean; verrouille: boolean }): boolean {
  return !!h.sourisRendue && !h.verrouille && !h.mort && !h.entracte;
}
