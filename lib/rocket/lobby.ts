/**
 * Rocket Muche : modèle PUR du lobby (module G). Normalisation de la configuration du match, libellés, mémoire locale (`pdj-rocket-config`,
 * stockage injecté, jamais d'exception) et textes d'aide du lobby. Aucune dépendance à three, au DOM ni à l'horloge : testé sous Node.
 * Les composants de `app/components/rocket/` ne contiennent que du rendu ; tout ce qui se décide ici.
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md § 10 et § 11 (module G).
 */
import {
  DEFAUT_CONFIG, EQUIPES, FORMATS, LIBELLES_NIVEAU, MATCH, NIVEAUX_BOT, NOMS_EQUIPES_DEFAUT, joueursParEquipe,
  type ConfigMatch, type Equipe, type Format, type LiaisonsManette, type LiaisonsTouches, type NiveauBot, type NormaliserConfig, type LibelleConfig, type StockageMinimal,
} from "./contrat";
import { libelleEntreeManette, libelleToucheRocket as libelleTouche } from "./liaisons";

/** Clé `localStorage` de la configuration du match. */
export const CLE_CONFIG_ROCKET = "pdj-rocket-config";
/** Longueur maximale du nom de joueur (celle des pseudos de l'arène). */
export const NOM_JOUEUR_MAX = 16;
/** Nom de joueur par défaut. */
export const NOM_JOUEUR_DEFAUT = DEFAUT_CONFIG().nomJoueur;

/** Libellés des formats (radios du lobby) et leur description en infobulle. */
export const LIBELLES_FORMAT: Readonly<Record<Format, string>> = { "1v1": "1v1", "2v2": "2v2", "3v3": "3v3" };
export const DESCRIPTIONS_FORMAT: Readonly<Record<Format, string>> = {
  "1v1": "Un contre un, sans coéquipier.",
  "2v2": "Deux contre deux : vous et un bot contre deux bots.",
  "3v3": "Trois contre trois : vous et deux bots contre trois bots.",
};
/** Description de chaque niveau de bot (infobulle des radios). Tous jouent avec la même physique que vous, sans triche. */
export const DESCRIPTIONS_NIVEAU: Readonly<Record<NiveauBot, string>> = {
  debutant: "Réagit lentement, vise approximativement, sans flip ni aérien : tous chassent la balle.",
  pro: "Flips, aériens jusqu'à 9 m, rotation en équipe et ramassage des plots.",
  allstar: "Réflexes de pro, aériens jusqu'à 18 m, speed flip, démolitions.",
};
export const DESCRIPTIONS_EQUIPE: Readonly<Record<Equipe, string>> = {
  bleue: "Les Trèfles, l'équipe bleue (le Bistrot Trèfle).",
  orange: "Les Tigres, l'équipe orange (le thème Tigre du site).",
};
/** Libellé d'une durée de match (« 5 min »). */
export const libelleDuree = (dureeS: number): string => `${Math.round((dureeS / 60) * 10) / 10} min`.replace(".", ",");

/** Texte de présentation du lobby (infobulle du titre). */
export const TEXTE_ROCKET =
  "Football en voitures-fusées sur le Parking Sud d'Agroparc : le stade, les plots de boost et la physique de Rocket League, seul contre des bots.";

/** Titre et règles condensées de l'Aide repliée du lobby. */
export const TITRE_REGLES_ROCKET = "Règles";
export const REGLES_ROCKET: readonly string[] = [
  "Envoyez la balle dans la cage adverse : le terrain, les cages (17,86 m de large) et les 34 plots de boost sont ceux de Rocket League.",
  "Les petits plots donnent 12 de boost (recharge 4 s), les six gros 100 (recharge 10 s). Vous démarrez avec 33 de boost.",
  "Un saut, puis un second dans la seconde qui suit : double saut sans direction, flip dans la direction tenue. Les murs et le plafond se roulent.",
  "Au supersonique, toucher un adversaire de face le démolit : il revient au bout de 3 s. Un coéquipier se fait seulement bousculer.",
  `Chrono de 3 à 10 min (${libelleDuree(MATCH.dureeDefautS)} par défaut). À égalité, prolongation : le premier but gagne.`,
  "Se joue au clavier, à la souris ou à la manette ; la partie n'est pas jouable au lecteur d'écran.",
];

/** Une commande de l'aide : touches telles qu'écrites à l'écran + ce qu'elles font (même forme que `CommandeLobby` de l'arène). */
export interface CommandeRocket {
  id: "conduire" | "saut" | "boost" | "derapage" | "roulis" | "balleCam" | "arriere" | "klaxon" | "reactions" | "pause" | "classement";
  touches: string;
  libelle: string;
}
/** Commandes affichées dans l'aide courte du HUD (les 8 premières secondes). */
export const COMMANDES_BREVES: readonly CommandeRocket["id"][] = ["conduire", "saut", "boost", "balleCam", "reactions", "pause"];

const touchesDe = (codes: readonly string[], disposition?: ReadonlyMap<string, string> | null): string =>
  codes.map((c) => libelleTouche(c, disposition)).join(" ou ");

/**
 * Commandes du jeu, écrites avec les touches RÉELLES du joueur (liaisons mémorisées, `disposition` = clavier du joueur : « Z » et non « W »
 * en AZERTY). Quand une manette est branchée (`manette` = ses liaisons), ses boutons suivent après un « · » : « Espace ou Clic gauche · A ».
 * Pure.
 */
export function commandesRocket(
  l: Readonly<LiaisonsTouches>,
  disposition?: ReadonlyMap<string, string> | null,
  manette?: Readonly<LiaisonsManette> | null,
): CommandeRocket[] {
  const premiere = (codes: readonly string[]) => libelleTouche(codes[0] ?? null, disposition);
  const m = manette ?? null;
  const padDe = (codes: readonly string[]) => codes.map((c) => libelleEntreeManette(c, true)).join(" ou ");
  const padPremiere = (codes: readonly string[]) => libelleEntreeManette(codes[0] ?? null, true);
  /** touches du clavier suivies, si une manette est branchée et que l'action y est liée, de ses boutons */
  const avecPad = (clavier: string, pad: string): string => (m && pad && pad !== "—" ? `${clavier} · ${pad}` : clavier);
  return [
    {
      id: "conduire",
      touches: avecPad([l.accelerer, l.gauche, l.reculer, l.droite].map(premiere).join(" "), m ? [m.accelerer, m.gauche, m.reculer, m.droite].map(padPremiere).join(" ") : ""),
      libelle: "Accélérer, tourner, reculer. En l'air : tangage et lacet",
    },
    { id: "saut", touches: avecPad(touchesDe(l.saut, disposition), m ? padDe(m.saut) : ""), libelle: "Sauter ; second appui : double saut, ou flip dans la direction tenue" },
    { id: "boost", touches: avecPad(touchesDe(l.boost, disposition), m ? padDe(m.boost) : ""), libelle: "Boost (maintenu)" },
    { id: "derapage", touches: avecPad(touchesDe(l.derapage, disposition), m ? padDe(m.derapage) : ""), libelle: "Dérapage au sol ; roulis libre en l'air" },
    {
      id: "roulis",
      touches: avecPad(`${premiere(l.rouleGauche)} ${premiere(l.rouleDroite)}`, m ? `${padPremiere(m.rouleGauche)} ${padPremiere(m.rouleDroite)}` : ""),
      libelle: "Roulis gauche et droite en l'air",
    },
    { id: "balleCam", touches: avecPad(touchesDe(l.balleCam, disposition), m ? padDe(m.balleCam) : ""), libelle: "Ball cam : la caméra suit la balle ou la voiture" },
    { id: "arriere", touches: avecPad(touchesDe(l.arriere, disposition), m ? padDe(m.arriere) : ""), libelle: "Regard arrière (maintenu)" },
    { id: "klaxon", touches: avecPad(touchesDe(l.klaxon, disposition), m ? padDe(m.klaxon) : ""), libelle: "Klaxon du Truck Muche" },
    {
      id: "reactions",
      touches: avecPad([l.chatHaut, l.chatGauche, l.chatDroite, l.chatBas].map(premiere).join(" "), m ? [m.chatHaut, m.chatGauche, m.chatDroite, m.chatBas].map(padPremiere).join(" ") : ""),
      libelle: "Réactions rapides : une touche ouvre Infos, Compliments, Réactions ou Excuses, la suivante choisit le message",
    },
    { id: "pause", touches: avecPad(touchesDe(l.pause, disposition), m ? padDe(m.pause) : ""), libelle: "Pause, réglages, quitter" },
    { id: "classement", touches: "Tab", libelle: "Classement des joueurs (maintenu)" },
  ];
}

/** Qui joue avec qui, pour le lobby (« Vous et 1 bot contre 2 bots »). */
export function resumeEffectifs(format: Format): string {
  const n = joueursParEquipe(format);
  const bots = (k: number) => `${k} bot${k > 1 ? "s" : ""}`;
  return n === 1 ? "Vous contre 1 bot" : `Vous et ${bots(n - 1)} contre ${bots(n)}`;
}

// ---------- normalisation ----------

const estObjet = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const dans = <T extends string>(liste: readonly T[], v: unknown, defaut: T): T => (typeof v === "string" && (liste as readonly string[]).includes(v) ? (v as T) : defaut);

/** Nom de joueur propre : sans caractère de contrôle, espaces rognés, `NOM_JOUEUR_MAX` caractères au plus ; vide = « Agent ». */
export function nettoyerNomJoueur(v: unknown): string {
  if (typeof v !== "string") return NOM_JOUEUR_DEFAUT;
  // eslint-disable-next-line no-control-regex
  const propre = Array.from(v.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()).slice(0, NOM_JOUEUR_MAX).join("").trim();
  return propre || NOM_JOUEUR_DEFAUT;
}

/**
 * Normalise une configuration lue du stockage ou d'un formulaire : toute valeur hors liste est ramenée à celle de `DEFAUT_CONFIG()`,
 * les noms des équipes sont toujours ceux du jeu. Ne jette jamais.
 * Implémente `NormaliserConfig` du contrat.
 */
export const normaliserConfig: NormaliserConfig = (brut: unknown): ConfigMatch => {
  const d = DEFAUT_CONFIG();
  if (!estObjet(brut)) return d;
  const duree = typeof brut.dureeS === "number" && MATCH.dureesPermisesS.includes(brut.dureeS) ? brut.dureeS : d.dureeS;
  const graine = typeof brut.graine === "number" && Number.isFinite(brut.graine) ? Math.trunc(brut.graine) >>> 0 : d.graine;
  return {
    format: dans(FORMATS, brut.format, d.format),
    equipeJoueur: dans(EQUIPES, brut.equipeJoueur, d.equipeJoueur),
    niveauAllies: dans(NIVEAUX_BOT, brut.niveauAllies, d.niveauAllies),
    niveauAdversaires: dans(NIVEAUX_BOT, brut.niveauAdversaires, d.niveauAdversaires),
    dureeS: duree,
    graine: graine || 1,
    nomsEquipes: { ...NOMS_EQUIPES_DEFAUT },
    nomJoueur: nettoyerNomJoueur(brut.nomJoueur),
  };
};

/**
 * Libellé court d'une configuration (« 2v2 · Pro · 5 min »). Alliés et adversaires de niveaux différents : « 2v2 · Pro / Débutant · 5 min »
 * (alliés d'abord). En 1v1 il n'y a pas d'allié : seul le niveau de l'adversaire compte.
 * Implémente `LibelleConfig` du contrat.
 */
export const libelleConfig: LibelleConfig = (c: Readonly<ConfigMatch>): string => {
  const adv = LIBELLES_NIVEAU[c.niveauAdversaires];
  const niveau = c.format === "1v1" || c.niveauAllies === c.niveauAdversaires ? adv : `${LIBELLES_NIVEAU[c.niveauAllies]} / ${adv}`;
  return `${c.format} · ${niveau} · ${libelleDuree(c.dureeS)}`;
};

// ---------- mémoire locale ----------

/** Lit la configuration mémorisée (stockage absent, JSON illisible ou valeurs douteuses : défauts). Ne jette jamais. */
export function lireConfig(s: StockageMinimal | null): ConfigMatch {
  try {
    const brut = s?.getItem(CLE_CONFIG_ROCKET);
    return normaliserConfig(brut ? JSON.parse(brut) : null);
  } catch {
    return DEFAUT_CONFIG();
  }
}

/** Mémorise la configuration (sans la graine : elle est tirée à chaque lancement). Silencieux si le stockage refuse. */
export function ecrireConfig(c: Readonly<ConfigMatch>, s: StockageMinimal | null): void {
  try {
    const n = normaliserConfig(c);
    s?.setItem(CLE_CONFIG_ROCKET, JSON.stringify({ format: n.format, equipeJoueur: n.equipeJoueur, niveauAllies: n.niveauAllies, niveauAdversaires: n.niveauAdversaires, dureeS: n.dureeS, nomJoueur: n.nomJoueur }));
  } catch { /* stockage indisponible : la configuration n'est pas retenue */ }
}

/**
 * Configuration au premier affichage du lobby : la mémorisée ; si elle n'a pas de nom propre (« Agent ») et que le joueur a déjà un pseudo
 * d'arène, c'est celui-ci qui est proposé.
 */
export function configInitiale(s: StockageMinimal | null, pseudoArene?: string): ConfigMatch {
  const c = lireConfig(s);
  const arene = nettoyerNomJoueur(pseudoArene);
  return c.nomJoueur === NOM_JOUEUR_DEFAUT && arene !== NOM_JOUEUR_DEFAUT ? { ...c, nomJoueur: arene } : c;
}

/** Graine d'un nouveau match à partir d'un tirage dans [0, 1) fourni par l'appelant (l'interface a le droit à l'aléa, pas la physique). */
export function nouvelleGraine(alea: number): number {
  const g = Math.floor((Number.isFinite(alea) ? Math.min(Math.max(alea, 0), 0.9999999) : 0.5) * 4294967296) >>> 0;
  return g || 1;
}

/** Config prête à être lancée : normalisée (nom propre, valeurs valides) avec une graine neuve. */
export function configPourLancer(c: Readonly<ConfigMatch>, alea: number): ConfigMatch {
  return { ...normaliserConfig(c), graine: nouvelleGraine(alea) };
}
