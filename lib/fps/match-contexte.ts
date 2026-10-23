/**
 * Découpage de `Salle` (lib/fps/match.ts) en services : types partagés entre `Salle` (lot S1) et les services
 * Elsa / véhicules (lot S2, `match-elsa.ts`, `match-vehicules.ts`). Aucune logique (PUR, types seulement).
 * `Salle` garde les joueurs, les tirs, le couteau, la santé, le cycle des matchs et les apparitions ; les services
 * portent Elsa et les véhicules / la circulation PNJ, et ne voient la salle que par `ContexteSalle`.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§5.19) et 2026-10-23-arene-hud-design.md (§3.5)
 */
import type { Monde } from "./collision";
import type { MemoSante } from "./sante";
import type {
  ArmeId, CauseMort, CoteMur, Equipement, MessageClient, MessageServeur, Posture, Siege, Slot, Vec3, VehiculeSnap, Zone,
} from "./protocole";

/**
 * Un message à émettre. `a` : "tous" (tous les inscrits), "joueurs" (en arène), "spectateurs" (inscrits hors arène) ou l'id d'un client ;
 * `sauf` exclut un id. Le snap des spectateurs part à 10 Hz et sans `vehicules` (§6.1.13).
 */
export type Sortie = { a: string; sauf?: string; m: MessageServeur };

/** Champs v2 de `JoueurSalle`. */
export interface JoueurSalleV2 {
  /** copie propre (`copierEquipement`), jamais `EQUIPEMENT_DEFAUT` */
  equip: Equipement;
  main: Slot;
  mainSuivante: Slot;
  munSpeciale: number;
  /** pas de tir ni de recharge avant (maintenant + degainageMs ; le serveur tolère 30 %) */
  sortieJusqua: number;
  /** remplace `prochainTir` : prochain tir permis, par arme (couteau compris) */
  cadenceArme: Partial<Record<ArmeId, number>>;
  bouclier: number;
  dernierDegatT: number;
  regenAcc: number;
  accroupi: boolean;
  /** glissade déclarée par le client (n'a de sens qu'accroupi, au sol) : recopiée dans le snap pour la pose des avatars distants */
  glisse: boolean;
  memoSante: MemoSante | null;
}

/**
 * Compteurs du tableau des scores enrichi (HUD §3.5), tenus par `Salle`, remis à zéro à chaque match : `tirs` = tirs validés
 * (couteau exclu), `touches` = tirs ayant touché au moins un joueur (un tir de pompe compte pour un), `tetes` = touches dont un
 * plomb au moins à la tête, `degats` = PV + bouclier infligés (hors véhicule), `serie` / `serieMax` = kills sans mourir,
 * `killsParArme` (donc l'arme favorite).
 */
export interface JoueurStatsSalle {
  tirs: number;
  touches: number;
  tetes: number;
  degats: number;
  serie: number;
  serieMax: number;
  killsParArme: Partial<Record<ArmeId, number>>;
  /** tableau des scores ouvert (message `vueScores`) : seuls ces clients reçoivent `scores` */
  scoresOuvert: boolean;
  /** dernier `vueScores` accepté (anti-rafale : un par 250 ms) et dernier envoi de `scores` (1 Hz) */
  scoresDemandeT: number;
  scoresEnvoyeT: number;
}

/**
 * État interne d'un connecté : les champs v1 (déplacés tels quels de `match.ts`, qui réexporte ce type), ceux de la v2
 * (`JoueurSalleV2`) et les compteurs du tableau des scores (`JoueurStatsSalle`). `prochainTir` (v1) reste jusqu'au
 * lot S1, qui le supprime au profit de `cadenceArme`.
 */
export interface JoueurSalle extends JoueurSalleV2, JoueurStatsSalle {
  id: string;
  pseudo: string;
  couleur: string;
  enJeu: boolean;
  kills: number;
  morts: number;
  ping: number;
  p: Vec3;
  v: Vec3;
  lacet: number;
  tangage: number;
  posture: Posture;
  mur: CoteMur;
  /** arme EN MAIN */
  arme: ArmeId;
  /** arme de la prochaine apparition (v1) */
  armeSuivante: ArmeId;
  pv: number;
  vivant: boolean;
  /** invulnérable jusqu'à cet horodatage (ms) */
  protegeJusqua: number;
  /** horodatage de la réapparition prévue, null si vivant ou hors arène */
  reapparitionT: number | null;
  /**
   * Instant avant lequel un joueur sorti de l'arène ne peut pas y réapparaître : fin du délai de réapparition d'un mort qui quitte,
   * sortie + `delaiReapparitionMs` pour un vivant. `rejoindre` plus tôt le garde en attente (`enJeu && !vivant`), jamais d'apparition immédiate.
   */
  reentreeT: number;
  /** dernier état accepté */
  seq: number;
  etatT: number;
  /** positions acceptées des `HISTORIQUE_MS` dernières ms (compensation de latence des tirs) ; `accroupi` pour rejouer la bonne hitbox */
  histo: { t: number; p: Vec3; accroupi: boolean }[];
  /** horodatage avant lequel un nouveau tir est refusé (v1, remplacé par `cadenceArme` au lot S1) */
  prochainTir: number;
  /** horodatages serveur des derniers changements de pseudo */
  renommages: number[];
}

/** Ce que les services voient de la salle. Implémenté par `Salle` (lot S1). */
export interface ContexteSalle {
  readonly monde: Monde;
  readonly alea: () => number;
  /** phase "jeu" (les services ne font rien pendant l'entracte, sauf `reinitialiser`) */
  enPhaseJeu(): boolean;
  joueur(id: string): JoueurSalle | undefined;
  joueursEnJeu(): JoueurSalle[];
  /**
   * Mémorise l'arme actuellement en main comme slot « précédent » (retour quand la spéciale s'épuise), comme le fait `main`. À appeler AVANT
   * de passer la spéciale en main ; sans effet si la spéciale y est déjà. Sans cela le serveur retombe sur un autre slot que le client.
   */
  memoriserPrecedent(j: JoueurSalle): void;
  /** dégâts d'arme : bouclier d'abord, mort, kills, `degats` + `mort` (avec `ts`, `cause`, `tueur`), libération du siège ; renvoie les sorties */
  infliger(cible: JoueurSalle, degats: number, par: JoueurSalle | null, cause: CauseMort, zone: Zone, arme: ArmeId, maintenant: number, src?: Vec3): Sortie[];
  /** mort instantanée (écrasement) : bouclier ignoré, mêmes sorties que `infliger` ; `par` null pour la circulation PNJ (aucun kill) */
  tuer(cible: JoueurSalle, par: JoueurSalle | null, cause: CauseMort, maintenant: number): Sortie[];
}

/** Elsa (lot S2, `match-elsa.ts` : `creerServiceElsa(ctx, opts)`). */
export interface ServiceElsa {
  /** apparition/expiration de l'offre, ramassage par le premier joueur à portée (soin ou arme spéciale), messages `elsa`, `ramassage`, `equipement` */
  tic(maintenant: number): Sortie[];
  /** nouveau match : offre retirée, minuteur ré-armé */
  reinitialiser(maintenant: number): void;
  /** `elsa{evenement:"etat"}` adressé à `idDest` (réponse à `rejoindre`) */
  synchro(idDest: string): Sortie[];
}

/** Véhicules conduisibles + circulation PNJ (lot S2, `match-vehicules.ts` : `creerServiceVehicules(ctx, opts)`). */
export interface ServiceVehicules {
  /** `monter` / `descendre` / `siege` / `conduite` ; les autres types renvoient [] ; réponses `embarque`, `refus`, `descente`, `sieges` */
  recevoir(j: JoueurSalle, m: MessageClient, maintenant: number): Sortie[];
  occupation(id: string): { vehicule: number; siege: Siege } | null;
  /** mort, quitter, déconnexion, éviction : libère le siège (voiture arrêtée si conducteur) et diffuse `sieges` ; renvoie [] si le joueur est à pied */
  liberer(j: JoueurSalle, maintenant: number): Sortie[];
  /**
   * Chaque tic : `p`/`v` (vitesse de la voiture) des occupants recopiés dans `JoueurSalle`, historique des occupants, silence du conducteur, abandon 60 s, renversements
   * (`ctx.tuer(..., "ecrase_vehicule")`, crédit au conducteur) et écrasements PNJ (`ctx.tuer(..., null, "ecrase_pnj")`).
   */
  tic(maintenant: number): Sortie[];
  /** nouveau match : voitures remises en place, occupants expulsés (`descente{raison:"expulse"}`) */
  reinitialiser(maintenant: number): Sortie[];
  /** `sieges` adressé à `idDest` (réponse à `rejoindre`) */
  synchro(idDest: string): Sortie[];
  snap(): VehiculeSnap[];
  /** yeux acceptables pour un `tir.o` d'occupant (null si le joueur est à pied) ; le conducteur n'a pas le droit de tirer (`CONDUCTEUR_TIRE`) */
  oeilsPossibles(j: JoueurSalle, maintenant: number, fenetreMs: number): Vec3[] | null;
  estConducteur(id: string): boolean;
}
