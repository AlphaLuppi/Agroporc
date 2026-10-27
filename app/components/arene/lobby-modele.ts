import { COUTEAU, MELEE, STATS } from "@/lib/fps/armes";
import { ARMES_SPECIALES, type ArmeMeleeId, type ArmePrincipaleId, type ArmeSecondaireId, type EtatPartieZombies, type ModeSalle } from "@/lib/fps/protocole";
import { ZOMBIES } from "@/lib/fps/zombies-vagues";
import { formatArgent } from "@/lib/fps/hud-modele";
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

/** Les deux cartes du choix du mode, dans l'ordre d'affichage. */
export const CARTES_MODE: readonly CarteMode[] = [
  { mode: "arene", titre: "Arène", description: "Chacun pour soi : premier à 30 kills, voitures, Elsa et monstres géants." },
  { mode: "zombies", titre: "Zombies tigres", description: "Coopératif : survivez à des manches de tigres, achetez des armes et ouvrez la carte." },
];

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** Compteur de la carte d'un mode, d'après le message `salons` (tiret tant qu'il n'est pas arrivé). */
export function compteurMode(mode: ModeSalle, salons: Salons | null | undefined): string {
  if (!salons) return "—";
  if (mode === "arene") return `${salons.arene.joueurs} en ligne · ${salons.arene.enJeu} en jeu`;
  const z = salons.zombies;
  const effectif = `${z.joueurs}/${ZOMBIES.joueursMax}`;
  if (z.joueurs >= ZOMBIES.joueursMax) return `Salle pleine · ${effectif}`;
  if (z.phase === "lobby") return `Lobby · ${effectif}`;
  if (z.phase === "fin") return `Bilan · ${effectif}`;
  return `Manche ${z.manche} · ${effectif}`;
}

/** Texte d'introduction du lobby des zombies. */
export const TEXTE_ZOMBIES = `Coopératif : des tigres arrivent par manches de plus en plus nombreuses et rapides. Vous partez avec un pistolet, un couteau, 100 PV et ${formatArgent(ZOMBIES.argentDepart)} ; la partie est perdue quand plus personne n'est debout.`;

/** Règles condensées du lobby des zombies (valeurs tirées de `ZOMBIES`). */
export const TITRE_REGLES_ZOMBIES = "Règles";
export const REGLES_ZOMBIES: string[] = [
  "Chaque touche rapporte 10 $, chaque tigre abattu 60 $ (100 $ à la tête ou à l'arme blanche).",
  "Achetez des armes aux murs et ouvrez les portes payantes pour agrandir la zone de jeu.",
  `À terre : un coéquipier vous relève en maintenant la touche d'action ${ZOMBIES.reanimationS} s à moins de ${ZOMBIES.reanimationPortee} m. Sans relève, vous êtes éliminé au bout de ${Math.round(ZOMBIES.terreMs / 1000)} s et revenez à la pause suivante.`,
  `Munitions limitées : ${ZOMBIES.ravitaillementChargeurs} chargeurs par arme, rechargés à moitié prix aux murs.`,
  "Pas de tir allié. Les tigres sont plus lents que vous au sprint : on peut les semer.",
];

/** Phrase affichée quand une partie est déjà lancée. */
export const TEXTE_PARTIE_EN_COURS = "Partie en cours : vous entrerez à la prochaine pause.";

/** Aide des commandes du lobby des zombies : celles de l'arène, la touche d'action servant à acheter, ouvrir et réanimer. */
export function commandesLobbyZombies(cfg: ConfigTouches, disposition?: ReadonlyMap<string, string> | null): CommandeLobby[] {
  return commandesLobby(cfg, disposition).map((c) => (
    c.libelle === "Monter dans une voiture" ? { ...c, libelle: "Acheter, ouvrir une porte, réanimer (maintenir)" } : c
  ));
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
