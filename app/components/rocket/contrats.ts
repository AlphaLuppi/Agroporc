/**
 * Rocket Muche : props partagées des composants d'interface (module G). Types seulement : aucun import de three ni du jeu
 * (`lib/rocket/jeu` ne se charge que par `import()` dynamique depuis `Agroparc3D.tsx`).
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md § 10.
 */
import type { ReactNode } from "react";
import type { ConfigMatch, Equipe, HudRocket as EtatHud, ReglagesRocket, ResultatMatch } from "@/lib/rocket/contrat";
import type { EtatLobbyEnLigne, ModeRocket } from "@/lib/rocket/reseau/lobby-en-ligne";
import type { HudReseau, ReglagesSalon } from "@/lib/rocket/reseau/protocole";
import type { ActionsSalonRocket } from "./useSalonRocket";

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
  /** EN LIGNE : id de MA voiture (« (vous) » ne peut plus se déduire de `humain` quand deux humains jouent) ; absent hors ligne */
  moi?: number;
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
  /** EN LIGNE : id de MA voiture (« (vous) » du tableau des scores) ; absent hors ligne */
  moi?: number;
  /** EN LIGNE : état réseau, humains du match, hôte ; absent hors ligne (le HUD local est alors strictement inchangé) */
  enLigne?: PropsHudEnLigne;
}

/** Ce que le HUD a besoin de savoir d'une partie en ligne. */
export interface PropsHudEnLigne {
  reseau: HudReseau | null;
  /** nombre d'humains du match (pour « Revanche 1/2 ») */
  humains: number;
  /** je suis l'hôte du salon : seul à pouvoir renvoyer tout le monde au salon */
  hote: boolean;
  surRetourSalon(): void;
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
  /** EN LIGNE : le jeu continue pendant le menu (pas de pause, pas de « Recommencer ») */
  enLigne?: boolean;
  /** EN LIGNE : état de la connexion ; hors « ouverte », le menu ne promet ni partie qui continue ni bot */
  etatConnexion?: HudReseau["etat"];
}

/** Écran de fin de match. */
export interface PropsFinRocket {
  resultat: ResultatMatch;
  nomsEquipes: Record<Equipe, string>;
  surRejouer(): void;
  surQuitter(): void;
  /** EN LIGNE : id de MA voiture ; absent hors ligne */
  moi?: number;
  /** EN LIGNE : « Rejouer » devient « Revanche » (votes), « Retour au salon » pour l'hôte ; absent hors ligne */
  enLigne?: PropsFinEnLigne;
}
export interface PropsFinEnLigne {
  /** votes « oui » enregistrés, humains attendus, mon vote, secondes restantes de la fenêtre de vote (0 : pas de fenêtre connue) */
  oui: number;
  attendus: number;
  aVote: boolean;
  restantS: number;
  hote: boolean;
  surRetourSalon(): void;
}

/** Pastille réseau du HUD en ligne (`[data-rocket-reseau]`) et bandeau des joueurs coupés. */
export interface PropsHudReseauRocket {
  reseau: HudReseau | null;
}

/** Lobby « En ligne » : créer une partie, la rejoindre par code ou depuis la liste, régler le salon, lancer. */
export interface PropsLobbyRocketEnLigne {
  etat: EtatLobbyEnLigne;
  actions: ActionsSalonRocket;
  /** nom saisi (borné à `NOM_JOUEUR_MAX`) et son changement */
  nom: string;
  surNom(n: string): void;
  /** réglages avec lesquels une partie est créée (mémorisés) */
  reglages: ReglagesSalon;
  surReglages(r: ReglagesSalon): void;
  surFermer(): void;
  /** écran tactile sans souris : le jeu demande un clavier ou une manette */
  tactile: boolean;
  manette: boolean;
  /** message du dernier lancement raté (WebGL, contexte perdu) */
  erreur?: string | null;
  pseudoParDefaut?: boolean;
  /** survol / focus de « Créer » et « Rejoindre » : précharge three et le jeu */
  surPrechargement?(): void;
}

/** Panneau « Rocket Muche » : commutateur Hors ligne / En ligne au-dessus du lobby choisi. */
export interface PropsPanneauRocket {
  mode: ModeRocket;
  surMode(m: ModeRocket): void;
  /** lobby hors ligne (`LobbyRocket`), rendu tel quel quand le mode est « local » */
  children?: ReactNode;
  /** props du lobby en ligne, rendu (chargé à la demande) quand le mode est « ligne » */
  enLigne: PropsLobbyRocketEnLigne;
}
