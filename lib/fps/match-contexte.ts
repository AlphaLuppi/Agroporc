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
  ArmeFeuId, ArmeId, ArmeMeleeId, CauseMort, CoteMur, Equipement, EtatPartieZombies, GenreVoiture, MessageClient, MessageServeur, MonstresSnap, PhaseZombies, Posture, Siege,
  Slot, SnapZombies, TigreLargueSnap, Vec3, VehiculeSnap, Zone,
} from "./protocole";
import type { ObstacleVoiture, Tigre } from "./tigre-arene";
import type { ExplosionGrenade } from "./grenades";

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
  /** chat vocal activé (v3 §5) : diffusé dans la présence, condition du relais des signaux ; absent = non */
  voix?: boolean;
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
  /** (v3) fait descendre le joueur de sa voiture s'il en occupe une (le vainqueur du tigre passe aux commandes du titan) */
  libererVehicule(j: JoueurSalle, maintenant: number): Sortie[];
  /** (v3) un rayon (o, d) touche-t-il vraisemblablement la cible, rejouée sur ses positions récentes (canon du titan) ? */
  toucheJoueur(c: JoueurSalle, o: Vec3, d: Vec3, portee: number, maintenant: number): boolean;
  // ---- v5 (zombies) : ce que le service zombies voit en plus de la salle ----
  /** tous les membres de la salle (lobby compris), dans l'ordre d'arrivée */
  joueurs(): JoueurSalle[];
  /**
   * Place le joueur en `p` (pieds) tourné vers `lacet` : PV, équipement (copie propre), arme en main, protection d'apparition de 1,5 s, état
   * remis à zéro (vivant, seq, historique) ; renvoie le message `apparition`. `munSpeciale` (facultatif) : munitions de la spéciale portée.
   * Ne touche ni à `enJeu` ni aux règles de réentrée de l'arène. `garder` (v8, relève) : ni téléportation ni remise à zéro du mouvement (`p`,
   * `lacet`, `seq`, budget de distance gardés) ; le message porte `garder` et le client reste où il est.
   */
  placerJoueur(
    j: JoueurSalle, p: Vec3, lacet: number, opts: { pv: number; equip: Equipement; main: Slot; munSpeciale?: number; garder?: boolean }, maintenant: number,
  ): Sortie[];
  /** sortie d'arène sans règle de réentrée ni mémo de santé (`enJeu` à faux, plus vivant, spéciale perdue) ; renvoie la libération des sièges */
  retirerJoueur(j: JoueurSalle, maintenant: number): Sortie[];
  /** message `presence` de la salle (scores, entrées / sorties d'arène) */
  presence(): Sortie;
  /**
   * Change l'équipement EN COURS (achat) et l'arme en main ; renvoie le message `equipement` privé. `ravitaille` : arme dont le client remplit
   * chargeur ET réserve. Le dégainage ne recommence que si l'arme en main change.
   */
  equiper(j: JoueurSalle, equip: Equipement, main: Slot, maintenant: number, ravitaille?: ArmeFeuId | "tout"): Sortie[];
}

/** Événements de l'arène (v3, `match-evenements.ts` : `creerServiceEvenements(ctx, opts)`) : Truck Muche fou, tigre robot, titan tigre. */
export interface ServiceEvenements {
  /** minuteur, annonces, simulation des monstres, écrasements, attaques, fin du titan */
  tic(maintenant: number): Sortie[];
  /** nouveau match : événement et titan arrêtés, minuteur ré-armé */
  reinitialiser(maintenant: number): Sortie[];
  /** événement et titan en cours, adressés à `idDest` (réponse à `rejoindre`) */
  synchro(idDest: string): Sortie[];
  snap(): MonstresSnap | null;
  /**
   * Plomb validé par la salle et déclaré sur `cible` (CIBLE_TIGRE ou CIBLE_TITAN) : la touche est revérifiée sur la forme du monstre ;
   * renvoie la zone et la distance, ou null si le rayon le manque.
   */
  toucheMonstre(cible: string, o: Vec3, d: Vec3, portee: number): { zone: Zone; distance: number } | null;
  /** dégâts cumulés d'un tir sur un monstre : `degats` au tireur, mort du tigre (titan pour `par`) ou destruction du titan */
  blesserMonstre(cible: string, degats: number, par: JoueurSalle, zone: Zone, maintenant: number): Sortie[];
  /** `pilotage` / `canon` du pilote ; les autres types renvoient [] */
  recevoir(j: JoueurSalle, m: MessageClient, maintenant: number): Sortie[];
  estPilote(id: string): boolean;
  /** l'événement du tigre géant est annoncé ou en cours (l'avion des tigres largués ne passe pas) */
  tigreGeantEnCours(): boolean;
  /** le joueur quitte l'arène (ou se déconnecte) : s'il pilote, le titan s'éteint */
  liberer(j: JoueurSalle, maintenant: number): Sortie[];
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
  /**
   * Plombs d'un tir arrêtés par une voiture selon le tireur (v3 §4) : chaque déclaration est revalidée (caisse rejouée sur 300 ms, marge
   * de 0,8 m, ligne de vue, portée), un plomb ne compte qu'une fois et jamais s'il est dans `plombsPris` (déjà sur un joueur). Dégâts au
   * corps selon la distance ; une voiture à 0 explose (`explosion`, occupants tués, souffle, voisines abîmées). `voitures` si un état change.
   */
  tirVoitures(
    j: JoueurSalle, o: Vec3, dirs: readonly Vec3[], declarations: readonly { genre: GenreVoiture; id: number; plomb: number }[] | undefined,
    arme: ArmeFeuId, plombsPris: ReadonlySet<number>, maintenant: number,
  ): Sortie[];
  /** voitures conduisibles (vitesse mesurée, conducteur) et PNJ à l'instant donné : obstacles et chocs des tigres */
  voitures(maintenant: number): ObstacleVoiture[];
}

/** Avion, tigres et sort d'invocation (v3, `match-tigres.ts` : `creerServiceTigres(ctx, opts)`). */
export interface ServiceTigres {
  /** avion et largage, tigres (coups par `ctx.infliger`, chocs de voitures, départs), charges perdues, messages `avion`, `tigre`, `sort` */
  tic(maintenant: number): Sortie[];
  /** `invoquer` (les autres types renvoient []) : tigre allié à 2 m du lanceur, `sort{lance}` et `tigre{apparu}` */
  recevoir(j: JoueurSalle, m: MessageClient, maintenant: number): Sortie[];
  estTigre(id: string): boolean;
  /** un avion survole l'arène ou un tigre sauvage largué est en vie (le tigre géant attend, cf. `OptionsServiceEvenements.tigrePermis`) */
  avionOuSauvage(): boolean;
  /**
   * Touche de tir déclarée sur le tigre `id`, validée sur ses positions rejouées sur `fenetreMs`. Renvoie la distance de l'œil au centre
   * de la silhouette (chute de dégâts) ou null. Le lanceur ne peut pas toucher son propre tigre.
   */
  validerTir(tireur: JoueurSalle, id: string, o: Vec3, d: Vec3, portee: number, maintenant: number, fenetreMs: number): number | null;
  /** Coup de couteau déclaré sur le tigre `id`, validé sur ses positions rejouées sur `fenetreMs`. */
  validerCoup(tireur: JoueurSalle, id: string, o: Vec3, d: Vec3, maintenant: number, fenetreMs: number, arme?: ArmeMeleeId): boolean;
  /** Dégâts d'arme sur un tigre : `tigre{touche}`, puis à la mort `tigre{mort}` et, pour un sauvage, `sort{gagne}` à `par`. */
  blesser(id: string, degats: number, par: JoueurSalle, zone: Zone, maintenant: number): Sortie[];
  /** nouveau match : tigres partis, charges perdues, avion ré-armé */
  reinitialiser(maintenant: number): Sortie[];
  /** `avion{evenement:"etat"}` adressé à `idDest` (réponse à `rejoindre`) */
  synchro(idDest: string): Sortie[];
  snap(): TigreLargueSnap[];
  /** le joueur a-t-il une charge du sort ? (tests et supervision) */
  charge(id: string): boolean;
  /** donne une charge du sort à un joueur vivant en arène qui n'en a pas (tests de charge et supervision) : `sort{gagne}` */
  accorderCharge(id: string): Sortie[];
  /** état interne d'un tigre (tests et supervision) */
  tigre(id: string): Readonly<Tigre> | undefined;
}

/** Résumé d'une salle zombies (message `salons`). */
export interface ResumeZombies { phase: PhaseZombies; joueurs: number; manche: number }

/**
 * Mode zombies (v5, `match-zombies.ts` : `creerServiceZombies(ctx, opts)`) : machine d'états lobby → pause → manche → … → fin, tigres, argent,
 * achats, portes, joueurs à terre, relève et bilan. Une salle zombies en possède un ; l'arène n'en a pas.
 */
export interface ServiceZombies {
  /** machine d'états, apparitions, tigres, griffes, relèves, éliminations, diffusion de `zombies{etat}` (≤ 5 Hz) */
  tic(maintenant: number): Sortie[];
  /** nouvelle partie à blanc : tigres retirés, portes refermées, retour au lobby (aucune sortie utile si personne n'est là) */
  reinitialiser(maintenant: number): Sortie[];
  /** état de la partie, argent et bâtiments (portes) adressés à `idDest` (réponse à `rejoindre`) */
  synchro(idDest: string): Sortie[];
  /** tigres du snap des joueurs ; null dans le lobby */
  snap(): SnapZombies | null;
  /** `id` est celui d'un tigre vivant (`z<n>`) */
  possede(id: string): boolean;
  /** le joueur est admis à la partie en cours (condition de `rejoindre`) */
  admis(id: string): boolean;
  /** touche d'un plomb sur un tigre revérifiée sur sa forme (rejeu de latence) ; null si le rayon le manque ou si le tigre est mort */
  toucheZombie(cible: string, o: Vec3, d: Vec3, portee: number, maintenant: number): { zone: Zone; distance: number } | null;
  /** coup d'arme blanche revérifié (portée de l'arme + marge, cône) ; null si manqué */
  toucheMelee(cible: string, o: Vec3, d: Vec3, portee: number, cosCone: number, maintenant: number): { distance: number } | null;
  /**
   * Dégâts cumulés d'un tir ou d'un coup sur un tigre : `degats` au tireur, argent (+10 $ par touche si `gain`, kill 60 / 100 $), `zombieMort`,
   * `kills` du tireur et `presence`. `gain: false` pour les tigres suivants d'un même tir (le gain de touche est unique par tir).
   */
  blesser(
    cible: string, degats: number, par: JoueurSalle, zone: Zone, maintenant: number,
    opts?: { melee?: boolean; arme?: ArmeId; gain?: boolean; cause?: "explosion" | "nuke" | "melee"; src?: Vec3 },
  ): Sortie[];
  // ---- v7 ----
  /** dégâts d'un plomb sur un tigre (profil zombies de l'arme, amélioration, insta-kill) */
  degatsTir(j: JoueurSalle, arme: ArmeFeuId, zone: Zone, distance: number, maintenant: number): number;
  /** dégâts d'un coup d'arme blanche sur un tigre (insta-kill compris) */
  degatsMelee(j: JoueurSalle, arme: ArmeMeleeId, maintenant: number): number;
  /** la balle de cette arme traverse tous les tigres alignés */
  perce(j: JoueurSalle, arme: ArmeFeuId): boolean;
  /** multiplicateur de l'intervalle entre deux tirs (Double Ristretto : 1 / 1,33) */
  cadence(j: JoueurSalle): number;
  /** santé du joueur dans la salle zombies : PV max (Gratin), régénération */
  sante(j: JoueurSalle): { pvMax: number; delaiMs: number; pvParS: number };
  /** distance du rayon au Truck Muche d'une manche de livraison, null s'il le manque ou s'il n'y en a pas */
  toucheTruck(o: Vec3, d: Vec3, portee: number): number | null;
  /** dégâts sur le Truck (explosion à 0, souffle, +500 $ à chacun) */
  blesserTruck(degats: number, par: JoueurSalle, maintenant: number): Sortie[];
  /**
   * Souffle d'une arme explosive (pistolet gratiné, pistolet à rayons) : au premier tigre touché (`distanceTouche`), sinon au premier mur ou
   * au sol ; dégâts dégressifs sur les tigres proches, rampants possibles, `zevt{explosion}` aux autres joueurs.
   */
  explosionTir(j: JoueurSalle, arme: ArmeFeuId, o: Vec3, d: Vec3, distanceTouche: number | null, portee: number, maintenant: number): Sortie[];
  /**
   * `lancerPartie`, `acheter`, `reanimer`, `reparer`, `lancerGrenade` (v8 : œil et direction déjà validés par la salle) ; les autres types
   * renvoient []
   */
  recevoir(j: JoueurSalle, m: MessageClient, maintenant: number): Sortie[];
  /** le joueur vient de tomber à 0 PV (`Salle.mourir`) : à terre, défaite éventuelle, `zombies{etat}` immédiat + `presence` */
  surMort(j: JoueurSalle, maintenant: number): Sortie[];
  /** sortie de la partie (Quitter, inactivité, déconnexion) : repasse en attente, argent perdu ; défaite si c'était le dernier debout */
  liberer(j: JoueurSalle, maintenant: number): Sortie[];
  /** nouvel arrivant dans la salle : membre du lobby, `zombies{etat}` à tous */
  arrivee(j: JoueurSalle, maintenant: number): Sortie[];
  /** partie en cours (pause ou manche) */
  enCours(): boolean;
  /** le joueur est à terre (attend une relève) : ses états suivent encore son corps (`Salle.recevoirEtat`) */
  aTerre(id: string): boolean;
  etat(): EtatPartieZombies;
  resume(): ResumeZombies;
  // ---- v8 ----
  /**
   * Écoute les explosions de grenades (événement PUR : où, par qui, quel genre, quand), après leur souffle ; les sorties renvoyées partent avec
   * celles du tic. Renvoie la fonction qui retire l'écouteur. Sert aux quêtes et secrets (une grenade qui fait sauter quelque chose).
   */
  ecouterExplosions(f: (e: ExplosionGrenade) => Sortie[] | void): () => void;
  /** grenades en vol ou posées (tests et supervision) */
  grenadesEnVol(): number;
}
