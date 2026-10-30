import type { MutableRefObject } from "react";
import type { SceneData } from "@/lib/agroparc3d/types";
import type { ClientArene, EtatConnexion } from "@/lib/fps/reseau";
import type { ApercuDirect } from "@/lib/fps/apercu-source";
import type {
  ArmeId, ArmeMeleeId, ArmePrincipaleId, ArmeSecondaireId, ArmeSpecialeId, CauseMort, EtatElsaMsg, EtatJoueurSnap, EtatPartieZombies, InfoMatch, InfoTueur,
  EtatPartieBr, InfoVehicule, JoueurPublic, LigneClassement, LigneStats, LigneStatsBr, MessageServeur, ModeSalle, Zone,
} from "@/lib/fps/protocole";
import type { EtatBrHud, EtatMonstresHud, EtatZombiesHud, HudEtat, HudLive, JeuEvenement } from "@/lib/fps/jeu-types";
import type { RadarFrame } from "@/lib/fps/radar";
import type { ReglagesHud } from "@/lib/fps/reglages-hud";
import type { Action, ConfigTouches } from "@/lib/fps/touches";
import type { ReglagesVoix } from "@/lib/fps/voix";

/**
 * Contrats React entre l'hôte (`Agroparc3D.tsx`), `useArene` et l'interface du jeu : ils sont écrits ici pour que les lots U1 (lobby, hôte)
 * et U2 (HUD, killcam, touches) soient indépendants. `useArene.ts` ré-exporte `EntreeFil`, `EvenementHud`, `DerniereMort` et `UseArene`.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§5.17) et 2026-10-23-arene-hud-design.md (§3.6)
 */

/** `melee` absent = couteau (rétrocompatible : les littéraux sans arme blanche restent valides). */
export interface EquipementChoisi { principale: ArmePrincipaleId; secondaire: ArmeSecondaireId; melee?: ArmeMeleeId }

/** Ligne du fil des kills. `arme` n'a de sens que pour cause "arme" : afficher `libelleCause(arme, cause, par)`, jamais `INFOS_ARMES[arme]` seul. */
export interface EntreeFil {
  id: number; par: string; parCouleur: string; cible: string; cibleCouleur: string;
  arme: ArmeId; cause: CauseMort; tete: boolean; moi: boolean;
}
export type EvenementHud =
  | { id: number; type: "touche"; zone: Zone }
  | { id: number; type: "kill"; zone: Zone }
  | { id: number; type: "degat"; angle: number }
  /** touche CONFIRMÉE par le serveur (HUD §3.4) : seule source des marqueurs et chiffres de dégâts ; `t` = `performance.now()` à la réception */
  | { id: number; type: "confirme"; cible: string; degats: number; absorbe: number; zone: Zone; tue: boolean; t: number };
/** Ma dernière mort ; remise à `null` sur `apparition`. */
export interface DerniereMort { par: string; parCouleur: string; arme: ArmeId; cause: CauseMort; zone: Zone; tueur: InfoTueur | null }

/** Fil d'annonces du HUD (4 au plus, 8 s chacune). `tigre` : largage et tigre abattu (v3), aussi affichés en toast. `zone` : phases de la tempête (Battle Royale, v8). */
export interface Annonce { id: number; texte: string; genre: "elsa" | "info" | "tigre" | "zone" }
/** Toast de bonus (j'ai pris le cadeau d'Elsa). */
export interface Bonus { id: number; genre: "soin" | "arme"; arme?: ArmeSpecialeId }
/**
 * Repère d'Elsa écrit à ~10 Hz par `JeuCallbacks.repere`, lu par rAF (pas de re-render). `elsaDistance < 0` = pas d'offre.
 * @deprecated la spec HUD (§3.1) le remplace par `JeuHandle.radar()` (`RadarFrame.elsa`) ; conservé pour la compilation de l'hôte.
 */
export interface RepereElsa { elsaAngle: number; elsaDistance: number }

/** Résumé des salles (message `salons`, sans son type) : compteurs du choix du mode ; `br` (v8) est optionnel. */
export type Salons = Omit<Extract<MessageServeur, { t: "salons" }>, "t">;

/** Statistiques persistées du Battle Royale (message `statsBr`, sans son type) : top 25 et ma ligne. */
export interface StatsBrRecues { lignes: LigneStatsBr[]; moi?: LigneStatsBr }

/** Gain d'argent le plus récent (zombies) : `n` augmente à chaque message `argent`, pour animer à chaque changement. */
export interface GainArgent { n: number; delta: number; motif: string }

/** Retour de `useArene(pseudo, jeuRef)` (ex-interface `UseArene`, étendue). */
export interface UseArene {
  etat: EtatConnexion; monId: string | null; joueurs: JoueurPublic[]; match: InfoMatch | null;
  classement: LigneClassement[] | null; fil: EntreeFil[]; evenements: EvenementHud[]; derniereMort: DerniereMort | null;
  erreur: string | null;
  clientRef: MutableRefObject<ClientArene | null>;
  snapRef: MutableRefObject<EtatJoueurSnap[]>; snapTRef: MutableRefObject<number>;
  /** (aperçu de la vue Palantir) dernier `apercu` des zombies ou du Battle Royale, et sa date de réception (ms) */
  apercuRef: MutableRefObject<ApercuDirect | null>; apercuTRef: MutableRefObject<number>;
  joueursRef: MutableRefObject<JoueurPublic[]>; matchRef: MutableRefObject<InfoMatch | null>;
  pousserEvenement(e: JeuEvenement): void;
  // ---- v2 ----
  elsa: EtatElsaMsg | null;
  annonces: Annonce[];
  sieges: InfoVehicule[];
  bonus: Bonus | null;
  /** carte du tueur de la killcam (le message `mort` étendu) ; null hors killcam */
  killcamInfo: InfoTueur | null;
  // ---- HUD (tableau des scores enrichi, spec HUD §3.5, §3.6, §9) ----
  /** statistiques du tableau des scores (à jour sur chaque message `scores`) */
  stats: Map<string, LigneStats>;
  /** dernier `scores` reçu, gardé entre deux ouvertures de Tab (affichage immédiat à la réouverture) */
  statsRef: MutableRefObject<Map<string, LigneStats>>;
  /** envoie `vueScores{ouvert}` (anti-rafale 1 par 250 ms côté serveur) */
  demanderScores(ouvert: boolean): void;
  /** dégâts que j'ai infligés au tueur (cumul des `confirme` sur lui pendant ma vie), remis à 0 sur `apparition` : carte du tueur */
  degatsAuTueur: number;
  // ---- v5 : modes de jeu ----
  /** mode de la salle où je suis (confirmé par le serveur) */
  mode: ModeSalle;
  /** mode demandé (carte cochée du choix du mode) : égal à `mode` hors changement en cours ou refusé */
  modeVoulu: ModeSalle;
  /** résumé des deux salles (null avant le premier message) */
  salons: Salons | null;
  /** dernier état de la partie de zombies reçu, null hors de la salle zombies ou avant le premier */
  zombies: EtatPartieZombies | null;
  /** argent des zombies (dernier solde reçu) et dernier gain, pour l'animation */
  argent: number;
  gainArgent: GainArgent | null;
  /**
   * demande à changer de salle (refusée : message dans `erreur`, `modeVoulu` revient à `mode`) ; `partie` (Battle Royale) : une partie de
   * `salons.parties` ou `PARTIE_NOUVELLE`
   */
  choisirMode(mode: ModeSalle, partie?: string): void;
  /** hôte du lobby des zombies ou du Battle Royale : lance la partie */
  lancerPartie(difficulte?: import("@/lib/fps/zombies-vagues").Difficulte): void;
  // ---- v8 : Battle Royale (optionnels : l'hôte les fournit une fois `useArene` branché) ----
  /** dernier `br{etat}` reçu, null hors de la salle BR ou avant le premier */
  br?: EtatPartieBr | null;
  /** dernières statistiques persistées reçues (`statsBr`), null avant la première réponse */
  statsBr?: StatsBrRecues | null;
}

/** Props de `HudArene` (U2 l'implémente, U1/l'hôte les fournit). */
export interface PropsHudArene {
  hud: HudEtat | null;
  monId: string | null;
  joueurs: JoueurPublic[];
  match: InfoMatch | null;
  classement: LigneClassement[] | null;
  fil: EntreeFil[];
  evenements: EvenementHud[];
  derniereMort: DerniereMort | null;
  maintenantServeur(): number;
  sensibilite: number;
  surSensibilite(x: number): void;
  touches: ConfigTouches;
  surTouches(cfg: ConfigTouches): void;
  /** actions sans aucune touche (nouvelles actions dont la touche par défaut était déjà prise dans une sauvegarde v1) : avertissement du menu pause */
  actionsSansTouche: Action[];
  pseudo: string;
  surPseudo(v: string): void;
  surReprendre(): void;
  surQuitter(): void;
  // ---- v2 ----
  /** équipement de la prochaine apparition (remplace `surChoisirArme`) */
  equipement: EquipementChoisi;
  /** `melee` omis = l'arme blanche déjà choisie (les raccourcis clavier de l'écran de mort ne changent que les armes à feu) */
  surEquipement(principale: ArmePrincipaleId, secondaire: ArmeSecondaireId, melee?: ArmeMeleeId): void;
  elsa: EtatElsaMsg | null;
  annonces: Annonce[];
  sieges: InfoVehicule[];
  bonus: Bonus | null;
  /** @deprecated remplacé par `radar()` (spec HUD §3.1) ; l'hôte peut ne plus le passer */
  repereRef?: MutableRefObject<RepereElsa | null>;
  /** accroupi : true = bascule, false = maintenir */
  accroupiBascule: boolean;
  surAccroupiBascule(b: boolean): void;
  /** chat vocal de proximité (v3 §5) : réglages (`pdj-fps-voix`), changement, et message d'échec (micro refusé…) ou "" */
  voix: ReglagesVoix;
  surVoix(r: ReglagesVoix): void;
  voixErreur: string;
  /** carte du tueur (UseArene.killcamInfo) ; la phase et la progression viennent de `hud.killcamPhase` / `hud.killcam` (la machine `Killcam` reste dans jeu.ts) */
  killcamInfo: InfoTueur | null;
  /** « Passer » : saute le rejeu (le HUD appelle `jeuRef.current.passerKillcam()` via l'hôte) */
  surPasserKillcam(): void;
  // ---- HUD (spec HUD §3.6) ----
  /** statistiques du tableau des scores (`UseArene.stats`) */
  stats: Map<string, LigneStats>;
  /** Tab maintenu / relâché : l'hôte appelle `UseArene.demanderScores` */
  surVueScores(ouvert: boolean): void;
  /** valeurs continues du jeu (`JeuHandle.live`, objet stable) ; lues en rAF, jamais pendant le rendu */
  live: HudLive;
  /** `JeuHandle.radar()` : remplit et renvoie le même `RadarFrame` (mini-map, flèche d'Elsa) */
  radar(): RadarFrame;
  /** réglages de la mini-map et de l'interface (clés `pdj-fps-minimap` et `pdj-fps-hud`) */
  reglagesHud: ReglagesHud;
  surReglagesHud(r: ReglagesHud): void;
  /** dégâts infligés au tueur pendant ma vie (`UseArene.degatsAuTueur`), pour la carte du tueur */
  degatsAuTueur: number;
  /** scène 3D (`scene.json`) pour la couche statique de la mini-map et la grande carte ; null tant qu'elle n'est pas chargée */
  scene?: SceneData | null;
  /** (v3) `JeuHandle.monstres()` : événement en cours, PV du tigre robot et du titan (bandeau), null hors partie */
  monstres?(): EtatMonstresHud | null;
  /** (v5) `JeuHandle.zombies()` : état du mode zombies lu à intervalle par le HUD ; absent = HUD de l'arène */
  zombies?(): EtatZombiesHud | null;
  /** (v8) dernier `br{etat}` reçu (`UseArene.br`) : lobby, bilan ; absent ou null = HUD de l'arène */
  br?: EtatPartieBr | null;
  /** (v8) statistiques persistées (`UseArene.statsBr`) pour la fin de partie */
  statsBr?: StatsBrRecues | null;
  /** (v8) `JeuHandle.br()` : état du Battle Royale (zone, vol, soins, spectateur) lu à intervalle par le HUD, hors rendu à 60 Hz */
  etatBr?(): EtatBrHud | null;
  /** (v5) « Rejouer » de la fin de partie : retour au lobby de la salle (le jeu est démonté) */
  surRejouer?(): void;
  /** (v5) « Quitter » de la fin de partie : sort ET referme le panneau (absent : comme `surQuitter`, retour au lobby) */
  surQuitterVue?(): void;
  /** Déclenchement d'une frappe aérienne (série de 5 kills) */
  surLancerFrappe?(cible: [number, number, number]): void;
  /** Lancer d'un fumigène */
  surLancerFumigene?(): void;
}

/** Props de `ChoixEquipement` (écrit par U1, utilisé par U1 : lobby, et par U2 : écran de mort, killcam, pause). */
export interface PropsChoixEquipement {
  principale: ArmePrincipaleId; secondaire: ArmeSecondaireId;
  /** arme blanche choisie (absent = couteau) */
  melee?: ArmeMeleeId;
  surChanger(principale: ArmePrincipaleId, secondaire: ArmeSecondaireId, melee?: ArmeMeleeId): void;
  /** "lobby" = cartes détaillées avec barres ; "compact" = boutons (écran de mort, killcam, pause) */
  variante: "lobby" | "compact";
  /** préfixe d'id (deux instances à l'écran : noms de groupes radio distincts) */
  idGroupe: string;
}
