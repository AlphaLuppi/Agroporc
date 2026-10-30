import { COUTEAU, MELEE, STATS } from "@/lib/fps/armes";
import {
  ARMES_SPECIALES, JEU, PARTIE_NOUVELLE, type ArmeMeleeId, type ArmePrincipaleId, type ArmeSecondaireId, type EtatPartieBr, type EtatPartieZombies, type JoueurBr, type MessageServeur,
  type MessageClient, type ModeSalle, type ResumePartie, type ResumePartieBr, type ResumeSalonBr,
} from "@/lib/fps/protocole";
import { BR } from "@/lib/fps/br-regles";
import {
  EVENEMENTS_ARENE, FREQUENCES, LIBELLES_FREQUENCES, estParDefaut, libelleReglages, normaliserReglages,
  type FrequenceEvenements, type IdEvenementArene, type ReglagesArene,
} from "@/lib/fps/reglages-arene";
import { CHUTE_BR } from "@/lib/fps/br-chute";
import { PALIERS_ZONE } from "@/lib/fps/br-zone";
import { ZOMBIES, type Difficulte } from "@/lib/fps/zombies-vagues";
import { SUFFIXE_BOT, estBot, nomAffiche } from "@/lib/fps/classement";
import { formatArgent, formatDecimal } from "@/lib/fps/hud-modele";
import type { Salons } from "./contrats";
import { libelleTouche, type Action, type ConfigTouches } from "@/lib/fps/touches";
import { LIBELLES_BARRES, LIBELLES_BARRES_MELEE, armesBlanches, armesParCategorie, type InfoArme, type InfoArmeBlanche } from "./armesInfo";

/**
 * Modèle PUR du lobby de l'arène (texte et regroupements, aucun React ni DOM) : cartes d'armes par catégorie, règles de tir,
 * aide des commandes construite depuis les touches du joueur. Testé via `lib/fps/arene-lobby.test.ts`.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.9, §6 `Arene.tsx`, §13.1)
 */

/** Au-delà de ce nombre de cartes dans un groupe, la grille passe en version compacte (sans description). */
export const CARTES_MAX_DETAILLEES = 6;

export interface GroupeArmes<Id extends string> {
  /** nom du groupe radio (`name`) sans préfixe */
  cle: "principale" | "secondaire" | "melee";
  titre: string;
  armes: ((InfoArme | InfoArmeBlanche) & { id: Id })[];
  compacte: boolean;
  /** libellés des quatre barres de ce groupe (les armes blanches ont « Course » au lieu de « Contrôle ») */
  barres: { cle: keyof InfoArme["barres"]; nom: string }[];
}

const groupe = <Id extends string>(cle: "principale" | "secondaire", titre: string): GroupeArmes<Id> => {
  const armes = armesParCategorie(cle) as (InfoArme & { id: Id })[];
  return { cle, titre, armes, compacte: armes.length > CARTES_MAX_DETAILLEES, barres: LIBELLES_BARRES };
};

/** Les deux groupes choisissables (les armes spéciales viennent d'Elsa et ne se choisissent pas). */
export const groupePrincipale = (): GroupeArmes<ArmePrincipaleId> => groupe("principale", "Arme principale");
export const groupeSecondaire = (): GroupeArmes<ArmeSecondaireId> => groupe("secondaire", "Arme secondaire");
/** Arme blanche (slot 3) : couteau ou épée. Dans les modes zombies on part toujours avec le couteau, l'épée s'achète. */
export const groupeMelee = (): GroupeArmes<ArmeMeleeId> => {
  const armes = armesBlanches() as (InfoArmeBlanche & { id: ArmeMeleeId })[];
  return { cle: "melee", titre: "Arme blanche", armes, compacte: false, barres: LIBELLES_BARRES_MELEE };
};

/**
 * Arme suivante du groupe (circulaire) : touches « arme principale / secondaire » à l'écran de mort et à l'entracte, où la souris prise
 * rend les boutons du sélecteur inatteignables. Une arme inconnue repart de la première.
 */
export function armeSuivanteDuGroupe<Id extends string>(g: GroupeArmes<Id>, courante: string): Id {
  const i = g.armes.findIndex((a) => a.id === courante);
  return g.armes[(i + 1) % g.armes.length].id;
}

/** Aide sous le sélecteur d'équipement de l'écran de mort et de l'entracte (touches réelles du joueur, vide si aucune). */
export function aideChoixEquipement(touchePrincipale: string, toucheSecondaire: string): string {
  const l: string[] = [];
  if (touchePrincipale) l.push(`${touchePrincipale} : arme principale suivante`);
  if (toucheSecondaire) l.push(`${toucheSecondaire} : arme secondaire suivante`);
  return l.join(" · ");
}

/**
 * Équipement après un clic dans le groupe `cle` : change seulement l'arme de ce groupe, les deux autres sont conservées ; l'arme blanche
 * absente (= couteau) est toujours rendue explicitement, pour que l'hôte ne confonde pas « couteau choisi » et « rien changé ».
 */
export function choixApresChangement(
  eq: { principale: ArmePrincipaleId; secondaire: ArmeSecondaireId; melee?: ArmeMeleeId },
  cle: GroupeArmes<string>["cle"],
  arme: string,
): [ArmePrincipaleId, ArmeSecondaireId, ArmeMeleeId] {
  const melee = eq.melee ?? "couteau";
  if (cle === "principale") return [arme as ArmePrincipaleId, eq.secondaire, melee];
  if (cle === "secondaire") return [eq.principale, arme as ArmeSecondaireId, melee];
  return [eq.principale, eq.secondaire, arme as ArmeMeleeId];
}

/** Note lue par les lecteurs d'écran : barre de 0..1 → entier de 1 à 10. */
export const noteSur10 = (v: number): number => Math.min(10, Math.max(1, Math.round(v * 10)));

/** Largeur visuelle d'une barre (%), jamais invisible. */
export const largeurBarre = (v: number): number => Math.max(4, Math.min(100, v * 100));

/** Bonus de course du couteau, en pourcentage entier (« +30 % »). */
export const BONUS_COUTEAU_POURCENT = Math.round((COUTEAU.vitesse - 1) * 100);

/** Armes offertes par Elsa (noms), pour la note du lobby. */
export const NOMS_ARMES_SPECIALES: string[] = ARMES_SPECIALES.map((id) => STATS[id].nom);

/** Bonus de course de l'épée, en pourcentage entier (« +20 % »). */
export const BONUS_EPEE_POURCENT = Math.round((MELEE.epee.vitesse - 1) * 100);

/** Ligne du lobby sur l'arme blanche (toujours équipée, couteau ou épée selon le choix). */
export const TEXTE_COUTEAU = `Arme blanche : toujours équipée (touche 3 ou V). Couteau : course ${BONUS_COUTEAU_POURCENT} % plus rapide, un coup tue un joueur sans bouclier. Épée : course ${BONUS_EPEE_POURCENT} % plus rapide, plus lente à frapper, mais son arc de ${Math.round(2 * Math.acos(MELEE.epee.cosCone) * 180 / Math.PI)}° tranche jusqu'à ${MELEE.epee.nbCiblesMax} joueurs d'un coup.`;

/** Note sur les armes spéciales. */
export const TEXTE_ARMES_SPECIALES = `Armes spéciales (${NOMS_ARMES_SPECIALES.join(", ")}) : offertes par Elsa au Truck Muche.`;

/** Bloc « Comment ça tire » : le jeu est en tir instantané, il n'y a ni chute de balle ni dispersion (v2 §2.9 et §13.1). */
export const TITRE_COMMENT_CA_TIRE = "Comment ça tire";
export const REGLES_TIR: string[] = [
  "Tir instantané : la balle ne chute pas, elle touche ce qui est sous le réticule, sans dispersion.",
  "Le trait lumineux qui part de l'arme n'est qu'un effet visuel.",
  "Les dégâts baissent avec la distance, plus ou moins vite selon l'arme.",
  `Le fusil à pompe tire une gerbe fixe de ${STATS.pompe.plombs} plombs.`,
];

/** Touche principale d'une action (sinon la seconde), libellé lisible ; « non assignée » si les deux emplacements sont vides. */
export function toucheDe(cfg: ConfigTouches, action: Action, disposition?: ReadonlyMap<string, string> | null): string {
  const e = cfg[action];
  const code = e ? e[0] ?? e[1] : null;
  return code === null || code === undefined ? "non assignée" : libelleTouche(code, disposition);
}

export interface CommandeLobby {
  /** touches telles qu'écrites à l'écran (« Z Q S D ») */
  touches: string;
  libelle: string;
}

/**
 * Aide des commandes du lobby, d'après les touches du joueur (jamais « Z Q S D » écrit en dur : un QWERTY lit « W A S D »,
 * et la sauvegarde du joueur peut avoir tout changé).
 */
export function commandesLobby(cfg: ConfigTouches, disposition?: ReadonlyMap<string, string> | null): CommandeLobby[] {
  const t = (a: Action) => toucheDe(cfg, a, disposition);
  return [
    { touches: [t("avant"), t("gauche"), t("arriere"), t("droite")].join(" "), libelle: "Se déplacer" },
    { touches: t("saut"), libelle: "Sauter (contre un mur : courir dessus, rebondir de mur en mur)" },
    { touches: t("sprint"), libelle: "Sprinter" },
    { touches: t("accroupi"), libelle: "S'accroupir ; en sprint : glissade" },
    { touches: t("tir"), libelle: "Tirer (maintenir : rafale)" },
    { touches: t("visee"), libelle: "Viser / lunette" },
    { touches: t("recharger"), libelle: "Recharger" },
    { touches: [t("armePrincipale"), t("armeSecondaire"), t("couteau")].join(" "), libelle: "Principale, secondaire, arme blanche" },
    { touches: t("interagir"), libelle: "Monter dans une voiture" },
  ];
}

// ---------- choix du mode et lobby des zombies (v5) ----------

export interface CarteMode { mode: ModeSalle; titre: string; description: string }

/** Les trois cartes du choix du mode, dans l'ordre d'affichage. */
export const CARTES_MODE: readonly CarteMode[] = [
  { mode: "arene", titre: "Arène", description: "Chacun pour soi : premier à 30 kills, voitures, Elsa et monstres géants." },
  { mode: "zombies", titre: "Zombies tigres", description: "Coopératif : survivez à des manches de tigres, achetez des armes et ouvrez la carte." },
  { mode: "br", titre: "Battle Royale", description: "Largage en avion, fouille des bâtiments, tempête qui se resserre : un seul survivant." },
];

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** Compteur de la carte d'un mode, d'après le message `salons` (tiret tant qu'il n'est pas arrivé). */
export function compteurMode(mode: ModeSalle, salons: Salons | null | undefined): string {
  if (!salons) return "—";
  // (v11) plusieurs parties du mode en même temps : « 2 parties · 9 joueurs » (somme des membres humains, lobby compris)
  const listee = salons.listes?.[mode];
  if (listee && listee.length > 1) return compteurParties(listee);
  if (mode === "arene") return `${salons.arene.joueurs} en ligne · ${salons.arene.enJeu} en jeu`;
  if (mode === "br") return salons.parties && salons.parties.length > 1 ? compteurPartiesBR(salons.parties) : compteurBR(salons.br);
  const z = salons.zombies;
  const effectif = `${z.joueurs}/${ZOMBIES.joueursMax}`;
  if (z.joueurs >= ZOMBIES.joueursMax) return `Salle pleine · ${effectif}`;
  if (z.phase === "lobby") return `Lobby · ${effectif}`;
  if (z.phase === "fin") return `Bilan · ${effectif}`;
  return `Manche ${z.manche} · ${effectif}`;
}

/** Compteur de la carte Battle Royale (tiret tant que le serveur n'a pas envoyé `br` dans `salons` : serveur plus ancien ou message pas encore reçu). */
export function compteurBR(br: ResumeSalonBr | null | undefined): string {
  if (!br) return "—";
  const effectif = `${br.joueurs}/${BR.joueursMax}`;
  if (br.joueurs >= BR.joueursMax) return `Salle pleine · ${effectif}`;
  if (br.phase === "lobby") return `Lobby · ${effectif}`;
  if (br.phase === "fin") return `Bilan · ${effectif}`;
  return `Partie en cours · ${br.vivants} en vie`;
}

/** Compteur d'une carte de mode quand plusieurs parties tournent : « 2 parties · 17 joueurs » (membres humains, lobby compris). */
export function compteurParties(parties: readonly Pick<ResumePartie, "joueurs">[]): string {
  const joueurs = parties.reduce((n, p) => n + p.joueurs, 0);
  return `${pluriel(parties.length, "partie")} · ${pluriel(joueurs, "joueur")}`;
}

/** Idem pour le Battle Royale (nom d'avant les parties de chaque mode). */
export const compteurPartiesBR = (parties: readonly ResumePartieBr[]): string => compteurParties(parties);

// ---------- parties parallèles (v11) : listes, lignes, routage côté interface ----------

/**
 * Hall d'arrivée de l'arène : tout client y atterrit et son `mode` d'écho ne porte pas encore de partie connue. Les parties d'arène suivantes s'appellent
 * `ar2`… (spec `2026-10-29-pause-parties-bots-design.md`, §1.2).
 */
export const PARTIE_HALL = "ar1";

/** Une partie de la liste : un `ResumePartie` complet (serveur v11) ou le strict nécessaire (ancien résumé BR de `salons.parties`). */
export type PartieListee = Pick<ResumePartie, "id" | "phase" | "joueurs"> & Partial<Omit<ResumePartie, "id" | "phase" | "joueurs">>;
export type ListesParties = Record<ModeSalle, readonly PartieListee[]>;

/**
 * Parties de chaque mode d'après le message `salons`. Un serveur v11 les donne dans `listes` (`parallele`) ; un ancien serveur n'a qu'une partie par mode
 * (les champs historiques, permanentes) et, pour le Battle Royale, `parties` : on les met sous la même forme, mais on ne propose ni « Rejoindre » une arène ou
 * une partie de zombies ni d'en créer (`parallele` faux).
 */
export function listesDepuisSalons(salons: Salons | null | undefined): { listes: ListesParties; parallele: boolean } {
  if (!salons) return { listes: { arene: [], zombies: [], br: [] }, parallele: false };
  if (salons.listes) return { listes: salons.listes, parallele: true };
  const br: PartieListee[] = salons.parties
    ? salons.parties.map((p) => ({ ...p, mode: "br" as const, capacite: BR.joueursMax }))
    : salons.br ? [{ id: "br1", mode: "br", capacite: BR.joueursMax, ...salons.br }] : [];
  return {
    parallele: false,
    listes: {
      arene: [{ id: PARTIE_HALL, mode: "arene", phase: "arene", joueurs: salons.arene.joueurs, capacite: JEU.joueursMax, enJeu: salons.arene.enJeu }],
      zombies: [{ id: "z1", mode: "zombies", phase: salons.zombies.phase, joueurs: salons.zombies.joueurs, capacite: ZOMBIES.joueursMax, manche: salons.zombies.manche }],
      br,
    },
  };
}

/** Une ligne de la liste des parties d'un mode. */
export interface LigneParties {
  id: string;
  mode: ModeSalle;
  /** « Partie de Alice », « Partie vide », « Arène 2 » */
  titre: string;
  /** « la partie de alice », « l'arène 2 » : complément de « Rejoindre … » / « Regarder … » pour les lecteurs d'écran */
  designation: string;
  /** « Lobby · 3/8 », « En cours : manche 7 · 3/8 », « 4/16 en jeu · 6 en ligne », « Pleine · 16/16 », « Bilan » */
  etat: string;
  /** c'est ma partie */
  ici: boolean;
  /** bouton de la ligne : aller dans la partie, la regarder en spectateur (Battle Royale, en y allant d'abord si ce n'est pas la mienne), aucun */
  action: "rejoindre" | "regarder" | null;
  /** zombies : la partie est figée par un joueur */
  enPause: boolean;
  phase: string;
  joueurs: number;
  /** (2026-10-30) arène : événements et fréquence fixés à sa création (« Tous les événements · Normal »), absent d'un serveur qui ne les publie pas */
  evenements?: string;
}

const numeroPartie = (id: string): string => /\d+$/.exec(id)?.[0] ?? id;

/**
 * Lignes de la liste des parties d'un mode (la mienne = `ici`). Zombies : « Rejoindre » une partie au lobby ou EN COURS (on entre à la pause suivante entre deux
 * manches) ; Battle Royale : une partie au lobby ou au bilan se rejoint, une partie en cours se regarde ; arène : « Rejoindre » tant qu'il reste de la place EN JEU.
 * Une partie pleine n'a pas de bouton (sauf la mienne, en cours : j'y suis déjà).
 */
export function lignesParties(mode: ModeSalle, parties: readonly PartieListee[], partieActuelle: string | null): LigneParties[] {
  return parties.map((p) => {
    const ici = p.id === partieActuelle;
    const capacite = p.capacite ?? (mode === "br" ? BR.joueursMax : mode === "zombies" ? ZOMBIES.joueursMax : JEU.joueursMax);
    const enPause = !!p.suspendue;
    const base = { id: p.id, mode, ici, enPause, phase: p.phase as string, joueurs: p.joueurs };
    const titre = (nom: string) => (p.hote ? `Partie de ${p.hote}` : p.joueurs === 0 ? "Partie vide" : nom);
    if (mode === "br") {
      const pleine = p.joueurs >= capacite;
      const enCours = p.phase === "decompte" || p.phase === "vol" || p.phase === "jeu";
      const etat = (pleine && !ici ? `Pleine · ${p.joueurs}/${capacite}`
        : p.phase === "lobby" ? `Lobby · ${p.joueurs}/${capacite}`
          : p.phase === "fin" ? "Bilan"
            : p.phase === "decompte" ? "Départ imminent" : `En cours · ${pluriel(p.vivants ?? 0, "survivant")}`)
        // (v11) entraînement : les bots de la partie (les humains sont déjà dans `joueurs`)
        + (p.bots && p.phase !== "lobby" ? ` · ${pluriel(p.bots, "bot")}` : "");
      const action = enCours ? (ici || !pleine ? "regarder" : null) : ici || pleine ? null : "rejoindre";
      const t = titre(`Partie n°${numeroPartie(p.id)}`);
      return { ...base, titre: t, designation: `la ${t.toLowerCase()}`, etat, action };
    }
    if (mode === "zombies") {
      const pleine = p.joueurs >= capacite;
      const t = titre(`Partie n°${numeroPartie(p.id)}`);
      const effectif = `${p.joueurs}/${capacite}`;
      const etat = pleine && !ici ? `Pleine · ${effectif}`
        : p.phase === "lobby" ? `Lobby · ${effectif}`
          : p.phase === "fin" ? "Bilan"
            : `En cours : manche ${p.manche ?? 1} · ${effectif}`;
      return { ...base, titre: t, designation: `la ${t.toLowerCase()}`, etat, action: ici || pleine ? null : "rejoindre" };
    }
    // arène : la capacité compte les agents EN JEU (les spectateurs du hall n'occupent aucune place)
    const enJeu = p.enJeu ?? 0;
    const pleine = enJeu >= capacite;
    const t = `Arène ${numeroPartie(p.id)}`;
    const etat = pleine && !ici ? `Pleine · ${enJeu}/${capacite}` : `${enJeu}/${capacite} en jeu · ${p.joueurs} en ligne`;
    return {
      ...base, titre: t, designation: `l'${t.toLowerCase()}`, etat, action: ici || pleine ? null : "rejoindre",
      ...(p.reglages ? { evenements: libelleReglages(normaliserReglages(p.reglages)) } : {}),
    };
  });
}

/** Lignes du Battle Royale (nom d'avant les parties de chaque mode). */
export type LignePartieBR = LigneParties;
export const lignesPartiesBR = (parties: readonly PartieListee[], partieActuelle: string | null): LigneParties[] => lignesParties("br", parties, partieActuelle);

/**
 * La liste « Parties » n'a de sens que s'il y a un choix à faire : plusieurs parties, ou la mienne déjà lancée (zombies, Battle Royale : on arrive en cours de
 * partie et on peut créer la sienne). L'arène n'a pas de lancement : sa liste (et « Créer une arène ») est toujours là dès que le serveur gère les parties.
 * `creation` (`creationProposee`) : « Créer ma partie » est proposé, donc la section l'est aussi, même avec une seule partie au lobby : le routage par défaut
 * regroupe les arrivants dans le lobby le plus peuplé, et sans ce bouton on ne pourrait jamais se séparer d'un lobby partagé.
 */
export function partiesVisibles(mode: ModeSalle, e: { connecte: boolean; tactile: boolean; nbLignes: number; enCours: boolean; creation?: boolean }): boolean {
  if (!e.connecte || e.tactile || e.nbLignes === 0) return false;
  return mode === "arene" || e.nbLignes > 1 || e.enCours || !!e.creation;
}

/**
 * Proposer « Créer ma partie » ? Toujours en arène (c'est le seul moyen d'en ouvrir une de plus, plafond au serveur). En zombies et Battle Royale, pas
 * quand je suis seul dans un lobby : une partie de plus ne changerait rien (le serveur reprendrait d'ailleurs une partie vide avant d'en créer).
 */
export function creationProposee(mode: ModeSalle, lignes: readonly LigneParties[]): boolean {
  if (mode === "arene") return true;
  const moi = lignes.find((l) => l.ici);
  return !(moi && moi.phase === "lobby" && moi.joueurs <= 1);
}

/** Libellé du bouton de création. */
export const libelleCreation = (mode: ModeSalle): string => (mode === "arene" ? "Créer une arène" : "Créer ma partie");

/**
 * Le message `mode` reçu est-il le simple écho de ma salle (aucun changement : le serveur n'enverra ni `bienvenue` ni état) ? Mêmes mode et même partie, ou une
 * partie pas encore connue : l'arène d'arrivée est le hall `ar1`, et un ancien serveur n'envoie pas de partie (sauf le Battle Royale).
 */
export function estEchoMode(courant: { mode: ModeSalle; partie: string | null }, m: { mode: ModeSalle; partie?: string }): boolean {
  if (m.mode !== courant.mode) return false;
  if (m.partie === undefined) return m.mode !== "br" || courant.partie === null;
  if (courant.partie === null) return m.mode === "arene" && m.partie === PARTIE_HALL;
  return m.partie === courant.partie;
}

// ---------- réglages des événements d'une arène (2026-10-30) ----------
// Spec : docs/superpowers/specs/2026-10-30-arene-police-evenements-design.md (§3, §7.3)

/** `localStorage` : derniers réglages choisis dans « Créer une arène » (JSON relu par `normaliserReglages`, jamais cru). */
export const CLE_REGLAGES_ARENE = "pdj-fps-arene-reglages";
/** `localStorage` : case « Descente de police » du lobby Battle Royale (absent = activée). */
export const CLE_POLICE_BR = "pdj-fps-br-police";

/** Ce que la lecture de `localStorage` demande au stockage (le vrai `Storage`, ou un faux dans les tests). */
type StockageLecture = Pick<Storage, "getItem"> | null | undefined;
type StockageEcriture = Pick<Storage, "setItem"> | null | undefined;

/** Réglages mémorisés, ou ceux par défaut (tous les événements, « Normal ») : stockage absent, illisible ou corrompu. Ne jette jamais. */
export function lireReglagesArene(stockage: StockageLecture): ReglagesArene {
  try {
    const brut = stockage?.getItem(CLE_REGLAGES_ARENE);
    return normaliserReglages(brut ? JSON.parse(brut) : null);
  } catch {
    return normaliserReglages(null);
  }
}

/** Mémorise les réglages choisis (échec silencieux : stockage plein ou interdit). */
export function ecrireReglagesArene(stockage: StockageEcriture, r: ReglagesArene): void {
  try { stockage?.setItem(CLE_REGLAGES_ARENE, JSON.stringify({ evenements: r.evenements, frequence: r.frequence })); } catch { /* stockage indisponible */ }
}

/** Coche ou décoche un événement ; l'ordre canonique est conservé (passe par `normaliserReglages`). */
export function avecEvenement(r: ReglagesArene, id: IdEvenementArene, coche: boolean): ReglagesArene {
  const voulus = new Set<IdEvenementArene>(r.evenements);
  if (coche) voulus.add(id); else voulus.delete(id);
  return normaliserReglages({ evenements: [...voulus], frequence: r.frequence });
}

/** « Tout cocher » : tous les événements, la fréquence est gardée. */
export const tousLesEvenements = (r: ReglagesArene): ReglagesArene => ({ evenements: [...EVENEMENTS_ARENE], frequence: r.frequence });
/** « Aucun événement » : la fréquence est gardée (elle ne sert à rien tant que rien n'est coché, mais le choix reste là au prochain « Tout cocher »). */
export const aucunEvenement = (r: ReglagesArene): ReglagesArene => ({ evenements: [], frequence: r.frequence });
export const avecFrequence = (r: ReglagesArene, frequence: FrequenceEvenements): ReglagesArene => normaliserReglages({ evenements: r.evenements, frequence });

/** Aide de chaque fréquence (sous les radios). */
export const AIDES_FREQUENCES: Record<FrequenceEvenements, string> = {
  calme: "événements rares, longues plages tranquilles",
  normal: "événements espacés, parfois rien pendant plusieurs minutes",
  chaos: "rythme d'origine : un événement presque en permanence",
};
/** Ordre d'affichage des fréquences (celui de `FREQUENCES`) avec leur libellé. */
export const CHOIX_FREQUENCES: readonly { id: FrequenceEvenements; nom: string; aide: string }[] =
  FREQUENCES.map((id) => ({ id, nom: LIBELLES_FREQUENCES[id], aide: AIDES_FREQUENCES[id] }));

/** Ligne de résumé des réglages en cours de saisie, sous les cases : « Cette arène : Sans police · Calme ». */
export const resumeCreation = (r: ReglagesArene): string => `Cette arène : ${libelleReglages(r)}`;
/** Ce que la fréquence devient quand aucun événement n'est coché. */
export const TEXTE_FREQUENCE_SANS_EVENEMENT = "La fréquence ne sert à rien tant qu'aucun événement n'est coché.";
/** Rappel dans le panneau : pas de propriétaire ni de lobby en arène, on ne règle pas une arène existante. */
export const TEXTE_REGLAGES_FIGES = "Les événements d'une arène sont fixés à sa création : pour d'autres événements, créez une autre arène.";
/** Réglages non par défaut demandés, mais l'écho `mode` n'en porte pas : le serveur est d'avant ce réglage. */
export const TEXTE_REGLAGES_IGNORES = "Ce serveur n'applique pas encore les réglages d'événements : cette arène a ses événements d'origine.";

/**
 * Message `mode` d'un changement de salle ou de partie. Les réglages d'événements ne partent que pour CRÉER une arène (`mode` « arene » + `PARTIE_NOUVELLE`),
 * déjà normalisés (liste fermée) ; partout ailleurs ils sont écartés, le serveur les ignorerait de toute façon.
 */
export function messageChoixMode(mode: ModeSalle, partie?: string, reglages?: ReglagesArene): Extract<MessageClient, { t: "mode" }> {
  if (mode === "arene" && partie === PARTIE_NOUVELLE && reglages) return { t: "mode", mode, partie, reglages: normaliserReglages(reglages) };
  return partie !== undefined ? { t: "mode", mode, partie } : { t: "mode", mode };
}

/** Le serveur a-t-il ignoré les réglages demandés ? `demandes` non par défaut et un écho `mode` qui n'en porte aucun. */
export function reglagesIgnores(demandes: ReglagesArene | null | undefined, echo: unknown): boolean {
  return !!demandes && !estParDefaut(demandes) && echo === undefined;
}

/**
 * Réglages de MA partie d'arène : ceux de sa ligne de `salons.listes.arene` (à jour, 1 Hz) ou, tant que la liste ne la connaît pas encore (arène à peine créée),
 * ceux de l'écho `mode`. `null` quand le serveur ne les publie pas.
 */
export function reglagesDeMaPartie(parties: readonly PartieListee[] | null | undefined, partieActuelle: string | null, echo: ReglagesArene | null): ReglagesArene | null {
  const dansListe = partieActuelle ? parties?.find((p) => p.id === partieActuelle)?.reglages : undefined;
  if (dansListe) return normaliserReglages(dansListe);
  return echo;
}

/** Case « Descente de police » du lobby Battle Royale : mémorisée, activée par défaut. */
export function lirePoliceBr(stockage: StockageLecture): boolean {
  try { return stockage?.getItem(CLE_POLICE_BR) !== "off"; } catch { return true; }
}
export function ecrirePoliceBr(stockage: StockageEcriture, active: boolean): void {
  try { stockage?.setItem(CLE_POLICE_BR, active ? "on" : "off"); } catch { /* stockage indisponible */ }
}
/** Ce que le lobby dit à un non-hôte du réglage retenu par l'hôte ; `null` d'un serveur qui ne le publie pas. */
export const lignePoliceBr = (police: boolean | undefined): string | null => (police === undefined ? null : `Descente de police : ${police ? "activée" : "désactivée"}`);
/** Aide de la case de l'hôte. */
export const TEXTE_POLICE_BR = "Une voiture de police surgit de nulle part (deux fois au plus, dans une grande partie) et fonce sur l'ennemi le plus proche d'elle.";

// ---------- textes des refus du serveur ----------

/** `rejoindre` refusé : 16 agents sont déjà en arène (les spectateurs de la vue 3D ne comptent pas). */
export const TEXTE_ARENE_PLEINE = `L'arène est pleine (${JEU.joueursMax} agents en jeu), réessayez dans un instant.`;
/** `rejoindre` ou `mode` refusé : les 50 places du Battle Royale sont prises. */
export const TEXTE_BR_PLEIN = "La salle Battle Royale est pleine (50 joueurs), réessayez dans un instant.";
/** `mode{br, partie:"nouvelle"}` refusé : le serveur a déjà son nombre maximal de parties de Battle Royale. */
export const TEXTE_BR_LIMITE = "Trop de parties de Battle Royale en même temps : regardez celle en cours ou attendez la fin d'une partie.";
/** `mode{arene | zombies, partie:"nouvelle"}` refusé (plafond de parties, délai entre deux créations, serveur chargé). */
export const TEXTE_PARTIES_LIMITE = "Trop de parties en cours, rejoignez-en une.";
/** (2026-10-30) `mode{arene, partie:"nouvelle"}` refusé : plafond d'arènes (une seule arène personnalisée tant que le hall existe) ou création trop rapprochée (10 s). */
export const TEXTE_ARENE_LIMITE = "Plus de place pour une arène de plus, ou création trop rapprochée : rejoignez une arène de la liste.";
/** Même refus, mais je suis déjà dans une arène personnalisée (`ar2`…) : c'est elle qui occupe la place, il faut d'abord revenir à l'arène principale. */
export const TEXTE_ARENE_PERSO_LIMITE = "Vous êtes déjà dans une arène personnalisée : retournez à l'arène principale avant d'en créer une autre.";
/** `lancerPartie` refusé : un seul humain et pas de bot. */
export const TEXTE_LANCER_BOTS = "Ajoutez des bots (ou attendez un autre joueur) pour lancer la partie.";
/** `lancerPartie` refusé : le quota de bots du serveur est épuisé. */
export const TEXTE_LANCER_LIMITE = "Trop de bots en jeu sur le serveur : réduisez leur nombre ou réessayez dans un instant.";

export type ActionRefus = Extract<MessageServeur, { t: "refus" }>["action"];
export type RaisonRefus = Extract<MessageServeur, { t: "refus" }>["raison"];

/** Texte du refus d'un `monter` / `siege` / `rejoindre` / `mode` / `regarder` / `lancer` par le serveur ; `mode` = la salle concernée (demandée pour `mode`, actuelle pour `rejoindre`). */
export function texteRefus(action: ActionRefus, raison: RaisonRefus, mode: ModeSalle = "arene", dansArenePerso = false): string {
  if (action === "regarder") return "Battle Royale : il n'y a plus de partie en cours à regarder.";
  if (action === "pause") return "Pause indisponible.";
  if (action === "lancer") return raison === "limite" ? TEXTE_LANCER_LIMITE : TEXTE_LANCER_BOTS;
  if (raison === "limite" && action === "mode" && mode === "arene" && dansArenePerso) return TEXTE_ARENE_PERSO_LIMITE;
  if (raison === "limite") return mode === "br" ? TEXTE_BR_LIMITE : mode === "arene" ? TEXTE_ARENE_LIMITE : TEXTE_PARTIES_LIMITE;
  if (action === "rejoindre") {
    if (raison === "lobby") return mode === "br" ? "Battle Royale : la partie est lancée sans vous, rejoignez la suivante." : "Partie de zombies : attendez le lancement par l'hôte.";
    return mode === "br" ? TEXTE_BR_PLEIN : TEXTE_ARENE_PLEINE;
  }
  if (action === "mode") {
    if (raison === "lobby") return "Impossible de changer de mode en pleine partie.";
    return mode === "br" ? TEXTE_BR_PLEIN : mode === "arene" ? TEXTE_ARENE_PLEINE : "La partie de zombies est pleine.";
  }
  switch (raison) {
    case "loin": return "Voiture trop loin";
    case "plein": return action === "siege" ? "Place occupée" : "Voiture pleine";
    case "deja": return "Déjà installé";
    case "mort": return "Impossible : éliminé";
    default: return "Voiture introuvable";
  }
}

/** Compteur d'une carte de mode choisie impossible sur l'appareil (écran tactile). */
export const TEXTE_MODE_INDISPONIBLE = "Clavier et souris requis";

/** Texte d'introduction du lobby des zombies. */
export const TEXTE_ZOMBIES = `Coopératif : des tigres arrivent par manches de plus en plus nombreuses et rapides. Vous partez avec un pistolet, un couteau, 100 PV et ${formatArgent(ZOMBIES.argentDepart)} ; la partie est perdue quand plus personne n'est debout.`;

/** Règles condensées du lobby des zombies (valeurs tirées de `ZOMBIES`). */
export const TITRE_REGLES_ZOMBIES = "Règles";
export const REGLES_ZOMBIES: string[] = [
  "Règles de Black Ops 1 : 10 $ par touche, 60 $ par tigre abattu (100 $ à la tête, 130 $ à l'arme blanche), 500 $ au départ.",
  "Vous démarrez dans l'open space : achetez des armes dessinées à la craie, ouvrez les portes, reposez les planches des fenêtres (10 $ la planche).",
  "Rétablissez le courant au Local technique : distributeurs d'atouts (Gratin Dauphinois, Expresso, Double Ristretto) et Micro-ondes Gratinator (Pack-a-Punch, 5 000 $).",
  "Boîte mystère : 950 $, elle déménage quand sort la peluche. Tigres dorés : ils portent un bonus (Munitions max, Insta-kill, Double points…).",
  `À terre : un coéquipier vous relève en maintenant la touche d'action ${ZOMBIES.reanimationS} s à moins de ${formatDecimal(ZOMBIES.reanimationPortee)} m (1,5 s avec la Pause Café), sinon éliminé au bout de ${Math.round(ZOMBIES.terreMs / 1000)} s. Seul, la Pause Café vous relève 3 fois.`,
  `Munitions limitées : ${ZOMBIES.ravitaillementChargeurs} chargeurs par arme (${ZOMBIES.ravitaillementChargeursAmeliore} une fois gratinée), rechargés à moitié prix aux murs.`,
  "Toutes les 4 à 6 manches, le Truck Muche livre des petits tigres. Lisez les notes : le chef a laissé plus qu'un menu.",
];

/** Phrase affichée quand une partie est déjà lancée. */
export const TEXTE_PARTIE_EN_COURS = "Partie en cours : vous entrerez à la prochaine pause.";

/** Aide des commandes du lobby des zombies : celles de l'arène, la touche d'action servant à acheter, ouvrir et réanimer. */
export function commandesLobbyZombies(cfg: ConfigTouches, disposition?: ReadonlyMap<string, string> | null): CommandeLobby[] {
  const lignes = commandesLobby(cfg, disposition).map((c) => (
    c.libelle === "Monter dans une voiture" ? { ...c, libelle: "Acheter, ouvrir une porte, réanimer (maintenir)" } : c
  ));
  // (v8) grenades de BO1 : 2 par manche, maintenir la touche « cuit » la grenade
  return [...lignes, { touches: toucheDe(cfg, "grenade", disposition), libelle: "Grenade (maintenir : cuire la mèche)" }];
}

export interface SituationLobbyZombies {
  /** sous-titre de statut */
  message: string;
  /** je suis l'hôte du lobby */
  hote: boolean;
  /** le bouton « Lancer la partie » est actif (hôte, lobby, connecté) */
  peutLancer: boolean;
  /** une partie est en cours (le lobby sert de salle d'attente) */
  enCours: boolean;
  /** membres de la salle / capacité */
  joueurs: number;
  capacite: number;
}

/** Situation du lobby d'après le dernier `zombies{etat}` reçu (null avant le premier) : qui peut lancer, que dire au joueur. */
export function situationLobbyZombies(partie: EtatPartieZombies | null, monId: string | null, connecte: boolean): SituationLobbyZombies {
  if (!partie || !connecte) {
    return { message: "Connexion à la salle…", hote: false, peutLancer: false, enCours: false, joueurs: partie?.joueurs.length ?? 0, capacite: partie?.capacite ?? ZOMBIES.joueursMax };
  }
  const hote = monId !== null && partie.hote === monId;
  const base = { hote, joueurs: partie.joueurs.length, capacite: partie.capacite };
  if (partie.phase === "lobby") {
    return {
      ...base, enCours: false, peutLancer: hote && partie.joueurs.length >= 1,
      message: hote ? "Vous êtes l'hôte : lancez la partie quand tout le monde est là." : "En attendant l'hôte…",
    };
  }
  if (partie.phase === "fin") return { ...base, enCours: true, peutLancer: false, message: "Partie terminée : retour au lobby dans un instant." };
  return { ...base, enCours: true, peutLancer: false, message: TEXTE_PARTIE_EN_COURS };
}

/** Étiquette d'état d'un joueur dans la liste du lobby. */
export function etiquetteEtatZombies(etat: EtatPartieZombies["joueurs"][number]["etat"]): string {
  switch (etat) {
    case "attente": return "attente";
    case "debout": return "en jeu";
    case "terre": return "à terre";
    default: return "éliminé";
  }
}

/** « 3 / 8 joueurs ». */
export const texteEffectif = (n: number, capacite: number): string => `${pluriel(n, "joueur")} · ${n}/${capacite}`;

/**
 * Les flèches du clavier déplacent la carte de la vue Palantir (OrbitControls écoute `window` et appelle `preventDefault`). Dans un champ,
 * une liste ou une radio (choix du mode, caret du nom de joueur) elles doivent garder leur rôle natif : vrai quand la touche est une flèche
 * dont la cible est un tel contrôle.
 */
export function flecheReserveeAuChamp(code: string, cible: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!code.startsWith("Arrow") || !cible) return false;
  return !!cible.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(cible.tagName ?? "");
}


// ---------- lobby du Battle Royale (v8) ----------

/** Texte d'introduction du lobby du Battle Royale. */
export const TEXTE_BR = `Chacun pour soi, de ${BR.joueursMin} à ${BR.joueursMax} joueurs : tout le monde saute d'un avion au-dessus d'Agroparc, sans arme à feu. Fouillez les bâtiments pour trouver de quoi vous battre ; la tempête se resserre et le dernier en vie est TOP 1.`;

/** Règles condensées du lobby du Battle Royale (valeurs tirées de `BR`, `CHUTE_BR` et `PALIERS_ZONE`). */
export const TITRE_REGLES_BR = "Règles";
export const REGLES_BR: string[] = [
  `Vous démarrez dans l'avion avec un couteau et ${JEU.pvMax} PV, sans arme à feu : sautez quand vous voulez, le parachute s'ouvre seul sous ${CHUTE_BR.hauteurOuvertureAutoM} m (ou plus tôt à la touche de saut).`,
  `Armes, munitions, bandages et potions de bouclier traînent dans les bâtiments, sur les toits et le long des routes : les plus rares sont à l'intérieur. Touche d'action pour ramasser.`,
  `La tempête se resserre en ${PALIERS_ZONE.length} paliers vers un cercle tiré au hasard ; hors de la zone, vous perdez des PV chaque seconde, de plus en plus.`,
  `Pas de régénération : soignez-vous au bandage (+${BR.usage.bandage.pv} PV, ${BR.usage.bandage.ms / 1000} s) ou à la potion (+${BR.usage.potion.bouclier} de bouclier, ${BR.usage.potion.ms / 1000} s). Chaque élimination vous rend ${BR.pvKill} PV.`,
  `Mort définitive : vous regardez la fin en spectateur. Le couteau fait ${BR.melee.couteau} dégâts (${Math.ceil(JEU.pvMax / BR.melee.couteau)} coups), l'épée ${BR.melee.epee} (${Math.ceil(JEU.pvMax / BR.melee.epee)} coups).`,
  `Les TOP 1 sont comptés par nom de joueur, une partie qui dure moins d'une minute ne compte pas.`,
];

/** Aide des commandes du lobby du Battle Royale : celles de l'arène, la touche d'action ramasse, les soins et le lâcher ont leurs touches. */
export function commandesLobbyBR(cfg: ConfigTouches, disposition?: ReadonlyMap<string, string> | null): CommandeLobby[] {
  const t = (a: Action) => toucheDe(cfg, a, disposition);
  return [
    ...commandesLobby(cfg, disposition).map((c) => {
      if (c.libelle === "Monter dans une voiture") return { ...c, libelle: "Ramasser un objet au sol" };
      if (c.libelle.startsWith("Sauter")) return { ...c, libelle: "Sauter de l'avion, ouvrir le parachute ; au sol : sauter, courir sur un mur" };
      return c;
    }),
    { touches: t("soigner"), libelle: "Bandage" },
    { touches: t("potion"), libelle: "Potion de bouclier" },
    { touches: t("lacher"), libelle: "Lâcher l'arme en main" },
  ];
}

/** Pseudo qui ne compte pas pour le palmarès : le nom par défaut « Agent » et ses doublons suffixés (même règle que `estPseudoCompte` du serveur). */
export const pseudoCompteBr = (pseudo: string): boolean => !/^Agent\d*$/i.test(pseudo.trim());

export const TEXTE_CONFLIT_NOMS = "Deux joueurs portent le même nom : renommez-vous.";
export const TEXTE_NOM_A_CHOISIR = "Choisissez un nom pour compter vos TOP 1.";
export const TEXTE_DEPART_ANNULE = "Départ annulé : pas assez de joueurs.";

export interface SituationLobbyBR {
  /** sous-titre de statut */
  message: string;
  /** avis complémentaires (départ annulé, nom à choisir), du plus important au moins important */
  avis: string[];
  /** je suis l'hôte du lobby */
  hote: boolean;
  /** le bouton « Lancer la partie » est actif (hôte, lobby, assez de joueurs, pas de conflit de noms, connecté) */
  peutLancer: boolean;
  /** une partie est déjà lancée (le lobby sert de salle d'attente jusqu'à la suivante) */
  enCours: boolean;
  /** la partie en cours se regarde en spectateur (décompte, vol ou jeu, sans y être admis) */
  peutRegarder: boolean;
  joueurs: number;
  capacite: number;
  minJoueurs: number;
}

/**
 * Situation du lobby d'après le dernier `br{etat}` reçu (null avant le premier) et le résumé de `salons.br` (repli pour les compteurs d'une partie en cours) :
 * qui peut lancer, que dire au joueur. Un arrivant en cours de partie peut la regarder ou créer la sienne : « Partie en cours : 12 en vie · zone palier 3/6 — regardez-la… »
 */
export function situationLobbyBR(
  partie: EtatPartieBr | null, monId: string | null, connecte: boolean, salonBr?: ResumeSalonBr | null, bots?: ReglageBots | null,
): SituationLobbyBR {
  const liste: JoueurBr[] = partie?.joueurs ?? [];
  const joueurs = liste.length > 0 ? liste.length : salonBr?.joueurs ?? 0;
  if (!partie || !connecte) {
    return {
      message: "Connexion à la salle…", avis: [], hote: false, peutLancer: false, enCours: false, peutRegarder: false,
      joueurs, capacite: partie?.capacite ?? BR.joueursMax, minJoueurs: partie?.minJoueurs ?? BR.joueursMin,
    };
  }
  const hote = monId !== null && partie.hote === monId;
  const base = { hote, joueurs, capacite: partie.capacite, minJoueurs: partie.minJoueurs };
  if (partie.phase === "lobby") {
    const conflit = !!partie.conflitNoms;
    // (v11) les bots comptent pour le minimum de joueurs (le serveur les crée au lancement, ils ne sont pas dans la liste du lobby)
    const assez = joueurs + (bots?.valeur ?? 0) >= partie.minJoueurs;
    const moi = liste.find((j) => j.id === monId);
    const avis: string[] = [];
    if (partie.annule) avis.push(TEXTE_DEPART_ANNULE);
    if (moi && !pseudoCompteBr(moi.pseudo)) avis.push(TEXTE_NOM_A_CHOISIR);
    const message = hote
      ? (!assez ? messageJoueursManquants(partie.minJoueurs, bots) : conflit ? TEXTE_CONFLIT_NOMS : "Vous êtes l'hôte : lancez la partie quand tout le monde est là.")
      : (conflit ? TEXTE_CONFLIT_NOMS : "En attendant l'hôte…");
    return { ...base, enCours: false, peutRegarder: false, peutLancer: hote && assez && !conflit, message, avis };
  }
  if (partie.phase === "fin") return { ...base, enCours: true, peutRegarder: false, peutLancer: false, avis: [], message: "Partie terminée : retour au lobby dans un instant." };
  if (partie.phase === "decompte") {
    // admis : le jeu se monte tout seul, rien à regarder
    const admis = !!liste.find((j) => j.id === monId)?.admis;
    return {
      ...base, enCours: true, peutRegarder: !admis, peutLancer: false, avis: [],
      message: admis ? "Départ de l'avion imminent." : `Départ de l'avion imminent : ${TEXTE_REGARDER_OU_CREER}`,
    };
  }
  const vivants = partie.vivants > 0 ? partie.vivants : salonBr?.vivants ?? 0;
  const palier = partie.zone ? `${partie.zone.palier}/${partie.zone.nbPaliers}` : salonBr?.palier !== undefined ? `${salonBr.palier}/${PALIERS_ZONE.length}` : null;
  const detail = [`${vivants} en vie`, ...(palier ? [`zone palier ${palier}`] : [])].join(" · ");
  return { ...base, enCours: true, peutRegarder: true, peutLancer: false, avis: [], message: `Partie en cours : ${detail} — ${TEXTE_REGARDER_OU_CREER}` };
}

/**
 * Pourquoi « Lancer » est grisé quand il manque des joueurs : avec des bots possibles, on dit de les ajouter (ou d'attendre un autre joueur) ; quota du serveur
 * épuisé, de réessayer ; bots coupés, le minimum de joueurs.
 */
export function messageJoueursManquants(minJoueurs: number, bots?: ReglageBots | null): string {
  if (bots?.disponible) return bots.quotaEpuise ? TEXTE_QUOTA_EPUISE : TEXTE_AJOUTER_BOTS;
  return `Il faut au moins ${minJoueurs} joueurs.`;
}

/** Ce qu'un arrivant peut faire pendant une partie en cours. */
export const TEXTE_REGARDER_OU_CREER = "regardez-la en spectateur, créez votre partie ou attendez la suivante.";

/** Étiquette d'état d'un joueur dans la liste du lobby (vide au lobby : tout le monde attend le départ). */
export function etiquetteEtatBR(j: Pick<JoueurBr, "admis" | "aBord" | "place">, phase: EtatPartieBr["phase"]): string {
  if (phase === "fin") return j.place === null ? "attente" : j.place === 1 ? "TOP 1" : `#${j.place}`;
  if (phase === "decompte") return j.admis ? (j.aBord ? "à bord" : "admis") : "attente";
  return "";
}


// ---------- bots du Battle Royale (v11) : réglage de l'hôte, étiquette BOT, partie non comptée ----------

export { SUFFIXE_BOT, estBot, nomAffiche };

/** « Lancer » grisé : un seul humain et aucun bot. */
export const TEXTE_AJOUTER_BOTS = "Ajoutez des bots (ou un autre joueur) pour lancer la partie.";
/** « Lancer » grisé : seul, et le quota de bots du serveur est épuisé (les autres parties les utilisent). */
export const TEXTE_QUOTA_EPUISE = "Tous les bots du serveur sont pris par d'autres parties : attendez un autre joueur ou réessayez dans un instant.";
/** Mention du lobby (et du bilan) d'une partie avec des bots. */
export const TEXTE_ENTRAINEMENT = "Entraînement : partie non comptée (ni TOP 1, ni éliminations, ni parties dans le palmarès).";
/** Bilan d'une partie avec des bots. */
export const TEXTE_NON_COMPTEE_BOTS = "Entraînement : partie non comptée";
/** Bilan d'une partie jouée à moins de deux joueurs ou trop courte. */
export const TEXTE_NON_COMPTEE_COURTE = "Partie trop courte : non comptée";

/** Texte du bilan quand le serveur n'a pas compté la partie : les bots (entraînement) ou la durée / le nombre de joueurs. */
export const texteNonComptee = (avecBots: boolean): string => (avecBots ? TEXTE_NON_COMPTEE_BOTS : TEXTE_NON_COMPTEE_COURTE);

/** Niveau des bots = difficulté existante des zombies (même clé de choix, autres mots). */
export const NIVEAUX_BOTS: Readonly<Record<Difficulte, { nom: string; description: string }>> = {
  entree: { nom: "Entrée", description: "bots débutants : réflexes lents, tir imprécis, rafales courtes." },
  plat: { nom: "Plat du jour", description: "bots normaux." },
  goulaf: { nom: "Goulaf", description: "bots redoutables : réflexes vifs, tir précis." },
};

/** Clé `localStorage` du niveau des bots choisi par l'hôte (distincte de celle des zombies). */
export const CLE_NIVEAU_BOTS = "pdj-fps-br-difficulte";

/**
 * Réglage « Bots » du lobby, pour l'hôte. `disponible` : le serveur les propose (`botsMax` > 0, publié dans `salons.listes.br` ; absent sur un serveur d'avant les
 * bots) ; `plafond` : ce que le serveur acceptera (plafond de la partie, place libre avec une place gardée à un arrivant, quota global restant) ;
 * `valeur` : nombre envoyé ; `quotaEpuise` : des bots sont permis par partie mais plus aucun n'est libre sur le serveur.
 */
export interface ReglageBots {
  disponible: boolean;
  plafond: number;
  valeur: number;
  quotaEpuise: boolean;
  /** l'hôte a choisi des bots : la partie ne sera pas comptée */
  entrainement: boolean;
}

/** Plafond effectif des bots : même calcul que le serveur (`lancerPartie` de `match-br.ts`), pour que le curseur ne propose rien de refusé. */
export function plafondBots(e: { botsMax?: number; botsRestants?: number; humains: number; capacite: number }): number {
  const max = Math.floor(e.botsMax ?? 0);
  if (!(max > 0)) return 0;
  const place = e.capacite - e.humains - 1;
  const quota = e.botsRestants === undefined ? Infinity : Math.floor(e.botsRestants);
  return Math.max(0, Math.min(max, place, quota));
}

/** Valeur proposée tant que l'hôte n'a rien touché : `BR.botsSolo` seul dans le lobby, aucun bot dès qu'il y a un autre joueur. */
export const botsParDefaut = (humains: number, plafond: number): number => (humains === 1 ? Math.min(BR.botsSolo, plafond) : 0);

/** Réglage des bots d'après le choix de l'hôte (`null` = n'y a pas touché : défaut selon le nombre d'humains), borné au plafond. */
export function reglageBots(e: { botsMax?: number; botsRestants?: number; humains: number; capacite: number; choisi: number | null }): ReglageBots {
  const disponible = (e.botsMax ?? 0) > 0;
  const plafond = plafondBots(e);
  const brut = e.choisi === null ? botsParDefaut(e.humains, plafond) : e.choisi;
  const valeur = Math.max(0, Math.min(plafond, Number.isFinite(brut) ? Math.floor(brut) : 0));
  return { disponible, plafond, valeur, quotaEpuise: disponible && plafond === 0 && (e.botsRestants ?? Infinity) <= 0, entrainement: valeur > 0 };
}

/** Texte lu par les lecteurs d'écran pour le curseur : « 11 bots », « aucun bot ». */
export const texteNombreBots = (n: number): string => (n === 0 ? "aucun bot" : pluriel(n, "bot"));

/** Message sous le curseur : entraînement, quota restant (le serveur le publie), ou rien. */
export function aideBots(r: ReglageBots, botsRestants?: number): string[] {
  const l: string[] = [];
  if (r.entrainement) l.push(TEXTE_ENTRAINEMENT);
  if (botsRestants !== undefined) l.push(`Bots libres sur le serveur : ${Math.max(0, Math.floor(botsRestants))}.`);
  return l;
}
