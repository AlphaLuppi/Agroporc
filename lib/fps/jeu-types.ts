/**
 * Types du contrat entre la boucle de jeu (`jeu.ts`) et l'hôte React (`Agroparc3D.tsx`, `useArene`, `HudArene`).
 * PUR : aucun import three ni DOM. `jeu.ts` les ré-exporte (`export type { … } from "./jeu-types"`).
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§5.18) et 2026-10-23-arene-hud-design.md (§3.2, §3.4)
 */
import type { ArmeFeuId, ArmeId, ArmePrincipaleId, ArmeSecondaireId, ArmeSpecialeId, CauseMort, InfoTueur, MessageServeur, Slot, TypeEvenement, Vec3, Zone } from "./protocole";
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
  /** "principale:fusil_assaut:23:30|secondaire:pistolet:12:12|couteau:couteau:0:0|speciale:railgun:4:6" ; speciale absente si non portée */
  slots: string;
  /** équipement de la prochaine apparition : "fusil_assaut|pistolet" */
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
  invite: "" | "elsa" | "monter" | "descendre";
  /** "2/4" occupants pour "monter" ; distance « 12 m » pour "elsa" */
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
  /** chat vocal (v3 §5) : "" coupé, "pret" activé micro fermé, "emet" le micro émet */
  voix: "" | "pret" | "emet";
  /** pseudos des joueurs qu'on entend parler en ce moment, séparés par « · » ("" = personne) */
  voixParlants: string;
  /** (v3) je pilote le titan tigre (bloc d'armes remplacé par le bandeau du titan) */
  titan: boolean;

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
  | { type: "refus"; action: "monter" | "siege" | "rejoindre"; raison: "loin" | "plein" | "deja" | "inconnu" | "mort" };

/** (v3) État des événements pour le bandeau du HUD (lu à intervalle par `BandeauEvenement`, hors rendu à 60 Hz). */
export interface EtatMonstresHud {
  evenement: { type: TypeEvenement; phase: "annonce" | "actif"; debutT: number; finT: number } | null;
  tigre: { pv: number; pvMax: number; rage: boolean } | null;
  /** `dash` : 0..1, 1 = dash prêt (seulement pour le pilote) ; `vitesse` (m/s), `altitude` (m), `cap` (rad, lacet) pour le cockpit */
  titan: { pilote: string; pv: number; pvMax: number; finT: number; dash: number; vitesse: number; altitude: number; cap: number } | null;
}

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
export interface EquipementJeu { principale: ArmePrincipaleId; secondaire: ArmeSecondaireId }

export interface JeuHandle {
  /** Équipement de la prochaine apparition (immédiat si mort). */
  equiper(principale: ArmePrincipaleId, secondaire: ArmeSecondaireId): void;
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
  dispose(): void;
  /** Crochet de test (window.__arene en développement). */
  debug: {
    etat(): Record<string, unknown>;
    teleporter(p: Vec3): void;
    regarder(lacet: number, tangage: number): void;
    /** Vise le centre de la cible et tire ; false si le tir n'est pas possible. */
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
    /** chat vocal : connexions, audibilité, joueurs entendus */
    voix(): Record<string, unknown>;
  };
}
