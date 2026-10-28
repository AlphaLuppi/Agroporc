/**
 * Types du contrat entre la boucle de jeu (`jeu.ts`) et l'hôte React (`Agroparc3D.tsx`, `useArene`, `HudArene`).
 * PUR : aucun import three ni DOM. `jeu.ts` les ré-exporte (`export type { … } from "./jeu-types"`).
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§5.18) et 2026-10-23-arene-hud-design.md (§3.2, §3.4)
 */
import type {
  ArmeFeuId, ArmeId, ArmeMeleeId, ArmePrincipaleId, ArmeSecondaireId, ArmeSpecialeId, CauseMort, EtatPartieZombies, InfoTueur, MessageServeur,
  ModeSalle, RaisonAchat, Slot, TypeEvenement, Vec3, Zone,
} from "./protocole";
import type { RadarFrame } from "./radar";
import type { ConfigTouches } from "./touches";

/**
 * Scalaires UNIQUEMENT (emettreHud compare champ par champ avec !==) : un objet ou tableau re-rendrait à 15 Hz.
 * Les valeurs continues (vitesse, progression du rechargement, délai de régénération) sont dans `HudLive`, lues en rAF.
 */
export interface HudEtat {
  pv: number;
  /** PV de bouclier */
  bouclier: number;
  /** arme en main et son slot */
  arme: ArmeId;
  slot: Slot;
  /** "principale:fusil_assaut:23:30|secondaire:pistolet:12:12|couteau:couteau:0:0|speciale:railgun:4:6" (le slot `couteau` porte l'arme blanche : `couteau:epee:0:0` pour l'épée) ; speciale absente si non portée */
  slots: string;
  /** équipement de la prochaine apparition : "fusil_assaut|pistolet", suivi de "|epee" si l'épée est choisie (absent = couteau) */
  equipSuivant: string;
  /** munitions / chargeur de l'arme en main (couteau : 0 / 0) */
  munitions: number;
  chargeur: number;
  /** réserve de l'arme en main ; −1 = infinie (v2 : réserve infinie, affichée « RÉSERVE ∞ ») */
  reserve: number;
  /** rechargement en cours (la progression 0..1 est dans `HudLive.recharge`) */
  recharge: boolean;
  /** dégainage en cours (350 ms) : la ligne du slot se remplit */
  degainage: boolean;
  vise: boolean;
  lunette: boolean;
  /** « ×4 » en lunette (entier, 0 hors lunette) */
  zoomX: number;
  /** niveau de zoom de la lunette (index, du plus large au plus serré), −1 hors lunette */
  zoomNiveau: number;
  /** nombre de niveaux de zoom de la lunette, 0 hors lunette */
  zoomNiveaux: number;
  /** rayon du cercle de dispersion du viseur (part de la demi-hauteur de l'écran), 0 = aucune dispersion (sniper sans lunette seulement, v3 §1) */
  ecartViseur: number;
  /** télémétrie de lunette : distance (m, entier) de la cible visée, −1 = rien ; seulement en lunette */
  distanceVisee: number;
  mur: boolean;
  mort: boolean;
  reapparitionDans: number;
  protege: boolean;
  /** s de protection d'apparition restantes (pas de 0,5), 0 hors protection */
  protegeRestant: number;
  verrouille: boolean;
  connecte: boolean;
  entracte: boolean;
  accroupi: boolean;
  glisse: boolean;
  /** les PV remontent (délai sans dégâts écoulé et pv < pvMax) */
  regen: boolean;
  /** multiplicateur de course de l'arme en main (couteau 1,3 ; sinon 1 ; arrondi à 0,01) */
  bonusVitesse: number;
  /** invite d'interaction affichée sous le viseur */
  invite: "" | "elsa" | "monter" | "descendre" | "acheter" | "porte" | "boite" | "soin" | "reanimer" | "atout" | "pap" | "courant" | "ingredient" | "four" | "reparer" | "note";
  /** "2/4" occupants pour "monter" ; distance « 12 m » pour "elsa" ; zombies : « Pompe — 900 $ », « Ouvrir la porte — 1 250 $ », « Réanimer Léa » (texte après « [E] ») */
  inviteDetail: string;
  vehicule: boolean;
  /** id du véhicule occupé (choisit la ligne de `sieges: InfoVehicule[]`), −1 hors véhicule */
  vehiculeId: number;
  /** siège occupé 0..3, −1 hors véhicule */
  siege: number;
  /** passager/conducteur qui ne peut pas tirer (conducteur) */
  tireInterdit: boolean;
  /** `monter`/`siege` envoyé, réponse (`embarque` ou `refus`) attendue (≤ 1 s) */
  embarquement: boolean;
  /** −1 hors killcam, sinon progression 0..1 (arrondie à 0,02) */
  killcam: number;
  killcamPhase: "" | "rejeu" | "carte";
  /** une charge du sort d'invocation est disponible (tigre sauvage abattu, v3) : icône du sort au HUD */
  sort: boolean;
  /** chat vocal (v3 §5) : "" coupé, "pret" activé micro fermé, "emet" le micro émet */
  voix: "" | "pret" | "emet";
  /** pseudos des joueurs qu'on entend parler en ce moment, séparés par « · » ("" = personne) */
  voixParlants: string;
  /** (v3) je pilote le titan tigre (bloc d'armes remplacé par le bandeau du titan) */
  titan: boolean;
  /** Le joueur local est immergé dans un nuage de fumigène */
  dansFumee?: boolean;
  /** Une frappe aérienne est disponible (série de 5 kills) */
  frappeDisponible?: boolean;

  // ---- MODE ZOMBIES (v5) : tous optionnels, absents en arène (les littéraux `HudEtat` existants restent valides) ----
  /** mode de la salle : "arene" ou "zombies" */
  mode?: ModeSalle;
  /** argent ($) */
  argent?: number;
  /** manche en cours (0 avant la première) et tigres restants à tuer (pas encore apparus compris) */
  manche?: number;
  restants?: number;
  /** je suis à terre (relevable par un coéquipier) / éliminé (spectateur jusqu'à la pause suivante) */
  aTerre?: boolean;
  elimine?: boolean;
  /** invite d'achat : prix ($) et argent suffisant (toujours vrai pour une relève) */
  invitePrix?: number;
  inviteAssez?: boolean;
  /** je maintiens E sur un coéquipier à terre (la progression 0..1 est dans `HudLive.reanimation`) */
  reanime?: boolean;

  // ---- COMPATIBILITÉ v1 (shim du lot 0, tous optionnels) ----
  // Champs que le HUD v1 lit encore et que `jeu.ts` v1 émet toujours. La spec HUD (§3.2) les retire de `HudEtat` : le lot J1 cesse
  // de les émettre (les valeurs continues passent dans `HudLive`) et le lot U2a ne les lit plus. NE PAS les utiliser dans du code neuf.
  /** @deprecated v1 : arme de la prochaine apparition (remplacée par `equipSuivant`) */
  armeSuivante?: ArmeFeuId;
  /** @deprecated v1 : avancement du rechargement 0..1 (remplacé par `HudLive.recharge`) */
  rechargeProgression?: number;
  /** @deprecated v1 : vitesse horizontale m/s (remplacée par `HudLive.vitesse`) */
  vitesse?: number;
  /** @deprecated v1 : km/h (remplacée par `HudLive.vitesseKmh`) */
  vitesseKmh?: number;
  /** @deprecated v1 : demi-angle de dispersion, toujours 0 (v2 §13.1, viseur statique) */
  dispersion?: number;
  /** @deprecated v1 : champ de vision vertical courant, ° (remplacé par `zoomX`) */
  fov?: number;
}

/**
 * Valeurs continues du HUD, écrites à chaque image par `jeu.ts` dans l'objet mutable `JeuHandle.live` et lues en rAF par
 * `useHudLive` (qui écrit des variables CSS sur l'élément concerné) : aucune ne provoque de rendu React.
 */
export interface HudLive {
  /** 0..1, 0 = pas de rechargement */
  recharge: number;
  /** m/s horizontaux */
  vitesse: number;
  /** km/h, 0 hors véhicule */
  vitesseKmh: number;
  /** 0..1 : écoulé du délai de 5 s avant régénération ; 1 = régénération en cours ou PV pleins */
  regenDelai: number;
  /** (zombies) 0..1 : avancement de la relève d'un coéquipier que je maintiens, 0 = aucune */
  reanimation?: number;
}

export type JeuEvenement =
  /** j'ai touché quelqu'un (estimation locale, immédiate ; le HUD l'ignore : seul `confirme` compte) */
  | { type: "touche"; cible: string; zone: Zone; degats: number }
  /**
   * un `degats` du serveur dont `par` est moi (zone et dégâts du serveur, `absorbe` = part prise par le bouclier) ;
   * `tue` si le `mort` correspondant suit dans la même trame. SEULE source des marqueurs et chiffres de touche (HUD §3.4).
   */
  | { type: "confirme"; cible: string; degats: number; absorbe: number; zone: Zone; tue: boolean }
  | { type: "kill"; cible: string; zone: Zone; arme: ArmeId }
  /** je suis mort ; `tueur` pour la carte de killcam */
  | { type: "mort"; par: string; arme: ArmeId; cause: CauseMort; zone: Zone; delai: number; ts: number; tueur?: InfoTueur }
  /** j'ai pris des dégâts ; `angle` relatif à ma vue (0 = devant, + = à droite) */
  | { type: "degat"; par: string; degats: number; angle: number }
  /** j'ai pris le cadeau d'Elsa */
  | { type: "bonus"; genre: "soin" | "arme"; arme?: ArmeSpecialeId }
  /** le serveur a refusé `monter` / `siege` (message `refus`) : toast « Voiture trop loin », « Voiture pleine »… ; `rejoindre` : arène pleine */
  | { type: "refus"; action: "monter" | "siege" | "rejoindre" | "mode"; raison: "loin" | "plein" | "deja" | "inconnu" | "mort" | "lobby" };

/** (v3) État des événements pour le bandeau du HUD (lu à intervalle par `BandeauEvenement`, hors rendu à 60 Hz). */
export interface EtatMonstresHud {
  evenement: { type: TypeEvenement; phase: "annonce" | "actif"; debutT: number; finT: number } | null;
  tigre: { pv: number; pvMax: number; rage: boolean } | null;
  /** `dash` : 0..1, 1 = dash prêt (seulement pour le pilote) ; `vitesse` (m/s), `altitude` (m), `cap` (rad, lacet) pour le cockpit */
  titan: { pilote: string; pv: number; pvMax: number; finT: number; dash: number; vitesse: number; altitude: number; cap: number } | null;
}

/**
 * (zombies) État lu à intervalle par le HUD (comme `EtatMonstresHud`, hors rendu à 60 Hz) : argent, dernier gain et dernier refus d'achat
 * (le compteur `n` augmente à chaque nouvel événement : le HUD anime sur le changement), dernier état de la partie reçu du serveur.
 */
export interface EtatZombiesHud {
  argent: number;
  manche: number;
  /** tigres restants à tuer et tigres vivants (dessinés) */
  restants: number;
  vivants: number;
  gain: { n: number; delta: number; motif: string } | null;
  refus: { n: number; id: string; raison: RaisonAchat } | null;
  /** achat réussi (nombre d'achats réussis depuis l'entrée, pour animer) */
  achats: number;
  /** relève que je maintiens : id du coéquipier (null si aucune) et avancement 0..1 */
  reanimation: { cible: string; progression: number } | null;
  aTerre: boolean;
  elimine: boolean;
  /** horodatage serveur (ms) de mon élimination si je suis à terre, sinon 0 */
  terreFinT: number;
  /** dernier `zombies{etat}` reçu (null avant le premier) */
  partie: EtatPartieZombies | null;
  // ---- v7 ----
  /** PV max (250 avec le Gratin Dauphinois) */
  pvMax: number;
  /** note de lore ouverte (id), null sinon */
  note: number | null;
  /** dernière annonce (bonus ramassé, courant, livraison…) : `n` change à chaque nouvelle */
  annonce: { n: number; texte: string; genre: string } | null;
  /** horloge serveur (ms) : minuteurs des bonus */
  serveurT: number;
  // ---- v8 ----
  /** grenades à fragmentation et tigres à remontoir en poche (lancers pas encore confirmés déduits) ; absents = 0 */
  grenades?: number;
  remontoirs?: number;
  /** grenade en cuisson : part de la mèche écoulée 0..1, null sinon */
  cuisson?: number | null;
  /** objectif courant (lore) */
  objectif: string;
  /** fenêtre dont je repose les planches (E maintenu), null sinon */
  reparation: string | null;
}

/** Options de `lancerJeu` : le mode de la salle (arène par défaut, comportement historique). */
export interface JeuOptions { mode?: ModeSalle }

export interface JeuCallbacks {
  /** ≈ 15 Hz, seulement quand quelque chose a changé */
  hud(e: HudEtat): void;
  evenement(e: JeuEvenement): void;
  /** @deprecated remplacé par `JeuHandle.radar()` (HUD §3.1) : optionnel et inutilisé */
  repere?(r: { elsaAngle: number; elsaDistance: number }): void;
  /** le joueur a quitté l'arène (ou le rendu est devenu inutilisable) */
  sortir(): void;
  /** problème technique à montrer au joueur (contexte WebGL perdu) */
  erreur?(message: string): void;
}

/** Équipement choisi (lobby, écran de mort, pause) : l'arme principale et l'arme secondaire. */
export interface EquipementJeu { principale: ArmePrincipaleId; secondaire: ArmeSecondaireId; melee?: ArmeMeleeId }

export interface JeuHandle {
  /** Équipement de la prochaine apparition (immédiat si mort). */
  equiper(principale: ArmePrincipaleId, secondaire: ArmeSecondaireId, melee?: ArmeMeleeId): void;
  /** Message du serveur (tous types, l'hôte relaie tout). */
  recevoir(m: MessageServeur): void;
  /** Redemande la souris (bouton « Reprendre » du menu pause). */
  verrouiller(): void;
  /** Sensibilité de la souris (1 = défaut). */
  sensibilite(x: number): void;
  /** accroupi : true = bascule, false = maintenir */
  accroupiBascule(b: boolean): void;
  /** saute le rejeu de la killcam et passe à la carte du tueur (sans effet hors rejeu) */
  passerKillcam(): void;
  /** Chat vocal de proximité (v3 §5) : `activer` demande le micro (à appeler sur un geste), `mode` appuyer pour parler / micro ouvert. */
  voix: { activer(): Promise<"ok" | "refuse" | "indisponible">; desactiver(): void; mode(m: "appuyer" | "ouvert"): void };
  /** Touches modifiées par le joueur (menu pause), appliquées tout de suite. */
  touches(cfg: ConfigTouches): void;
  /** Valeurs continues du HUD, mises à jour à chaque image (objet stable, jamais remplacé). */
  readonly live: HudLive;
  /** Remplit et renvoie LE MÊME `RadarFrame` (tableaux préalloués) : mini-map et flèche d'Elsa, lu en rAF. */
  radar(): RadarFrame;
  /** (v3) Événement en cours, PV du tigre robot et du titan (bandeau du HUD). */
  monstres(): EtatMonstresHud;
  /** (v5) État du mode zombies (argent, gains, refus, relève) ; objet neuf à chaque appel, valeurs neutres en arène. */
  zombies(): EtatZombiesHud;
  /** Déclenche une frappe aérienne sur le point au sol spécifié. */
  lancerFrappe?(cible: Vec3): void;
  /** Lance un fumigène devant le joueur. */
  lancerFumigene?(): void;
  /** Monte sur le Bus C3 s'il est à portée. */
  monterBus?(): void;
  dispose(): void;
  /** Crochet de test (window.__arene en développement). */
  debug: {
    etat(): Record<string, unknown>;
    teleporter(p: Vec3): void;
    regarder(lacet: number, tangage: number): void;
    /** Vise le centre de la cible (le corps d'un joueur, la tête d'un tigre) et tire, false si le tir n'est pas possible. */
    tirerVers(id: string): boolean;
    /** Appuie ou relâche une touche (code KeyboardEvent ou `Souris0`…) sans clavier. */
    touche(code: string, appuyee: boolean): void;
    /** change de slot sans clavier */
    slot(s: Slot): void;
    /** entre dans le véhicule `id` (téléporte à côté puis envoie `monter`) */
    monter(id: number): void;
    /** état de la killcam, des voitures PNJ et d'Elsa pour les captures */
    killcam(): Record<string, unknown> | null;
    monde(): Record<string, unknown>;
    /**
     * tigres interpolés (id, genre, lanceur, position, état, PV, silhouette de touche), avion en cours, charge du sort, GLB chargé. `mesures` :
     * ajoute les mesures du tigre dessiné (boîte, tête, museau, croupe), calcul coûteux réservé aux vérifications ponctuelles
     */
    tigres(mesures?: boolean): Record<string, unknown>;
    /** lance le sort (comme la touche « invoquer »), false si aucune charge ou si le lancer est impossible */
    invoquer(): boolean;
    /**
     * (zombies, v8) joue la mort désarticulée du tigre `id` (numéro de `z<n>`) côté client seulement, comme si `zombieMort` arrivait avec ces
     * champs (`src` par défaut : ma caméra) : le serveur le garde vivant, le rendu l'ignore jusqu'à la fin du cadavre. Avec `p` : un tigre
     * d'essai qui courait là (cap `cap`, type `type`), sans tigre du serveur. false si le tigre est inconnu (ou le modèle pas prêt)
     */
    tuerZombie(id: number, o?: {
      arme?: ArmeId; ameliore?: boolean; zone?: Zone; cause?: "explosion" | "nuke" | "melee"; src?: Vec3; p?: Vec3; cap?: number; type?: 0 | 1 | 2 | 3;
    }): boolean;
    /**
     * (v8) traite `m` comme s'il venait du serveur, côté client seulement (captures : boîtes du Happy hour, Micro-ondes, ouverture d'une
     * porte) ; le serveur n'en sait rien
     */
    simuler(m: MessageServeur): void;
    /** chat vocal : connexions, audibilité, joueurs entendus */
    voix(): Record<string, unknown>;
  };
}
