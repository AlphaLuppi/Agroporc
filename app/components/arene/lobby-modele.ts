import { COUTEAU, STATS } from "@/lib/fps/armes";
import { ARMES_SPECIALES, type ArmePrincipaleId, type ArmeSecondaireId } from "@/lib/fps/protocole";
import { libelleTouche, type Action, type ConfigTouches } from "@/lib/fps/touches";
import { armesParCategorie, type InfoArme } from "./armesInfo";

/**
 * Modèle PUR du lobby de l'arène (texte et regroupements, aucun React ni DOM) : cartes d'armes par catégorie, règles de tir,
 * aide des commandes construite depuis les touches du joueur. Testé via `lib/fps/arene-lobby.test.ts`.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.9, §6 `Arene.tsx`, §13.1)
 */

/** Au-delà de ce nombre de cartes dans un groupe, la grille passe en version compacte (sans description). */
export const CARTES_MAX_DETAILLEES = 6;

export interface GroupeArmes<Id extends string> {
  /** nom du groupe radio (`name`) sans préfixe */
  cle: "principale" | "secondaire";
  titre: string;
  armes: (InfoArme & { id: Id })[];
  compacte: boolean;
}

const groupe = <Id extends string>(cle: "principale" | "secondaire", titre: string): GroupeArmes<Id> => {
  const armes = armesParCategorie(cle) as (InfoArme & { id: Id })[];
  return { cle, titre, armes, compacte: armes.length > CARTES_MAX_DETAILLEES };
};

/** Les deux groupes choisissables (les armes spéciales viennent d'Elsa et ne se choisissent pas). */
export const groupePrincipale = (): GroupeArmes<ArmePrincipaleId> => groupe("principale", "Arme principale");
export const groupeSecondaire = (): GroupeArmes<ArmeSecondaireId> => groupe("secondaire", "Arme secondaire");

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

/** Note lue par les lecteurs d'écran : barre de 0..1 → entier de 1 à 10. */
export const noteSur10 = (v: number): number => Math.min(10, Math.max(1, Math.round(v * 10)));

/** Largeur visuelle d'une barre (%), jamais invisible. */
export const largeurBarre = (v: number): number => Math.max(4, Math.min(100, v * 100));

/** Bonus de course du couteau, en pourcentage entier (« +30 % »). */
export const BONUS_COUTEAU_POURCENT = Math.round((COUTEAU.vitesse - 1) * 100);

/** Armes offertes par Elsa (noms), pour la note du lobby. */
export const NOMS_ARMES_SPECIALES: string[] = ARMES_SPECIALES.map((id) => STATS[id].nom);

/** Ligne du lobby sur le couteau (toujours équipé). */
export const TEXTE_COUTEAU = `Couteau : toujours équipé, course ${BONUS_COUTEAU_POURCENT} % plus rapide, un coup au corps à corps tue un joueur sans bouclier.`;

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
    { touches: [t("armePrincipale"), t("armeSecondaire"), t("couteau")].join(" "), libelle: "Principale, secondaire, couteau" },
    { touches: t("interagir"), libelle: "Monter dans une voiture" },
  ];
}
