/**
 * Rocket Muche : props partagées des composants d'interface (module G). Types seulement : aucun import de three ni du jeu
 * (`lib/rocket/jeu` ne se charge que par `import()` dynamique depuis `Agroparc3D.tsx`).
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md § 10.
 */
import type { ConfigMatch, Equipe, HudRocket as EtatHud, ReglagesRocket, ResultatMatch } from "@/lib/rocket/contrat";

/** Lobby « Rocket Muche » : choix du match, nom, réglages repliés, aide repliée, « Lancer ». */
export interface PropsLobbyRocket {
  config: ConfigMatch;
  surConfig(c: ConfigMatch): void;
  reglages: ReglagesRocket;
  surReglages(r: ReglagesRocket): void;
  surLancer(): void;
  surFermer(): void;
  /** écran tactile sans souris : le jeu demande un clavier ou une manette */
  tactile: boolean;
  /** une manette est connectée (lève la restriction du tactile) */
  manette: boolean;
  /** message du dernier lancement raté (WebGL, contexte perdu) */
  erreur?: string | null;
  /** le joueur n'a pas encore de nom : le champ prend le focus */
  pseudoParDefaut?: boolean;
  /** survol / focus de « Lancer » : précharge three et le jeu sans attendre le clic */
  surPrechargement?(): void;
}

/** Réglages (caméra, ball cam, volume, manette) : utilisés par le lobby (replié) et par le menu pause. */
export interface PropsReglagesRocket {
  reglages: ReglagesRocket;
  surReglages(r: ReglagesRocket): void;
}

/** Tableau des statistiques (Tab en jeu, écran de fin). */
export interface PropsTableauRocket {
  lignes: EtatHud["classement"];
  nomsEquipes: Record<Equipe, string>;
  /** équipe du joueur, pour la mise en valeur de sa ligne */
  equipeJoueur: Equipe;
  /** légende lue par les lecteurs d'écran */
  legende?: string;
}

/** HUD d'une partie : score, minuteur, jauge de boost, bannières, fil, pause, fin. `hud` est null avant la première image. */
export interface PropsHudRocket {
  hud: EtatHud | null;
  reglages: ReglagesRocket;
  surReglages(r: ReglagesRocket): void;
  surReprendre(): void;
  surRecommencer(): void;
  /** quitte la partie et revient au lobby de Rocket Muche */
  surQuitter(): void;
  /** quitte la partie et ferme aussi le panneau (retour à la vue Agroparc) */
  surQuitterVue(): void;
  /** met en pause depuis le bouton du HUD (souris, tactile avec manette) */
  surPause?(): void;
}

/** Menu pause (`role="dialog"`, focus piégé, Échap = Reprendre). */
export interface PropsMenuPauseRocket {
  reglages: ReglagesRocket;
  surReglages(r: ReglagesRocket): void;
  surReprendre(): void;
  surRecommencer(): void;
  surQuitter(): void;
  surQuitterVue(): void;
  manette: boolean;
}

/** Écran de fin de match. */
export interface PropsFinRocket {
  resultat: ResultatMatch;
  nomsEquipes: Record<Equipe, string>;
  surRejouer(): void;
  surQuitter(): void;
}
