import { COUTEAU, MELEE, STATS } from "@/lib/fps/armes";
import {
  ARMES_SPECIALES, JEU, type ArmeMeleeId, type ArmePrincipaleId, type ArmeSecondaireId, type EtatPartieBr, type EtatPartieZombies, type JoueurBr, type ModeSalle,
  type ResumePartieBr, type ResumeSalonBr,
} from "@/lib/fps/protocole";
import { BR } from "@/lib/fps/br-regles";
import { CHUTE_BR } from "@/lib/fps/br-chute";
import { PALIERS_ZONE } from "@/lib/fps/br-zone";
import { ZOMBIES } from "@/lib/fps/zombies-vagues";
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

/** Compteur de la carte Battle Royale quand plusieurs parties tournent : « 2 parties · 17 joueurs ». */
export function compteurPartiesBR(parties: readonly ResumePartieBr[]): string {
  const joueurs = parties.reduce((n, p) => n + p.joueurs, 0);
  return `${pluriel(parties.length, "partie")} · ${pluriel(joueurs, "joueur")}`;
}

/** Une ligne de la liste des parties du lobby Battle Royale. */
export interface LignePartieBR {
  id: string;
  /** « Partie de Alice », « Partie vide » */
  titre: string;
  /** « Lobby · 3/50 », « En cours · 12 en vie », « Bilan », « Pleine · 50/50 » */
  etat: string;
  /** c'est ma partie */
  ici: boolean;
  /** bouton de la ligne : aller dans son lobby, la regarder en spectateur (en y allant d'abord si ce n'est pas la mienne), aucun */
  action: "rejoindre" | "regarder" | null;
}

/**
 * Lignes de la liste des parties (`salons.parties`, la mienne = `ici`). Une partie au lobby ou au bilan se rejoint, une partie en cours se
 * regarde ; une partie pleine n'a pas de bouton (sauf la mienne, en cours : j'y suis déjà).
 */
export function lignesPartiesBR(parties: readonly ResumePartieBr[], partieActuelle: string | null): LignePartieBR[] {
  return parties.map((p) => {
    const ici = p.id === partieActuelle;
    const pleine = p.joueurs >= BR.joueursMax;
    const enCours = p.phase === "decompte" || p.phase === "vol" || p.phase === "jeu";
    const etat = pleine && !ici ? `Pleine · ${p.joueurs}/${BR.joueursMax}`
      : p.phase === "lobby" ? `Lobby · ${p.joueurs}/${BR.joueursMax}`
        : p.phase === "fin" ? "Bilan"
          : p.phase === "decompte" ? "Départ imminent" : `En cours · ${pluriel(p.vivants, "survivant")}`;
    const action = enCours ? (ici || !pleine ? "regarder" : null) : ici || pleine ? null : "rejoindre";
    return { id: p.id, titre: p.hote ? `Partie de ${p.hote}` : "Partie vide", etat, ici, action };
  });
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
  partie: EtatPartieBr | null, monId: string | null, connecte: boolean, salonBr?: ResumeSalonBr | null,
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
    const assez = joueurs >= partie.minJoueurs;
    const moi = liste.find((j) => j.id === monId);
    const avis: string[] = [];
    if (partie.annule) avis.push(TEXTE_DEPART_ANNULE);
    if (moi && !pseudoCompteBr(moi.pseudo)) avis.push(TEXTE_NOM_A_CHOISIR);
    const message = hote
      ? (!assez ? `Il faut au moins ${partie.minJoueurs} joueurs.` : conflit ? TEXTE_CONFLIT_NOMS : "Vous êtes l'hôte : lancez la partie quand tout le monde est là.")
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

/** Ce qu'un arrivant peut faire pendant une partie en cours. */
export const TEXTE_REGARDER_OU_CREER = "regardez-la en spectateur, créez votre partie ou attendez la suivante.";

/** Étiquette d'état d'un joueur dans la liste du lobby (vide au lobby : tout le monde attend le départ). */
export function etiquetteEtatBR(j: Pick<JoueurBr, "admis" | "aBord" | "place">, phase: EtatPartieBr["phase"]): string {
  if (phase === "fin") return j.place === null ? "attente" : j.place === 1 ? "TOP 1" : `#${j.place}`;
  if (phase === "decompte") return j.admis ? (j.aBord ? "à bord" : "admis") : "attente";
  return "";
}
