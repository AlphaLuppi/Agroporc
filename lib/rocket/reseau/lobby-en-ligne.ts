/**
 * Rocket Muche EN LIGNE : modèle PUR du lobby (lot CLIENT / UI). Tout ce qui se décide pour l'écran « En ligne » est ici : état de la
 * connexion et du salon reconstitué message après message (`appliquerMessage`, le hook `useSalonRocket` n'est qu'une colle), vue des équipes,
 * libellés des refus et des erreurs, liste des parties ouvertes, mémoire locale (mode, réglages d'hôte, reprise dans `sessionStorage`).
 *
 * Importable statiquement par `Agroparc3D.tsx` et par les composants (liste blanche de `ui-rocket.test.ts` : ce module et `protocole`, jamais
 * `client`, `serialisation`, `prediction`…) : il n'importe donc que des types et des constantes de `protocole` et de `contrat`. Aucun DOM, aucune
 * horloge globale (l'heure est un argument), aucun hasard ; le stockage est injecté et ne lève jamais.
 * Spec : docs/superpowers/specs/2026-11-08-rocket-en-ligne-design.md § 9.1, § 9.3.
 */
import {
  EQUIPES, FORMATS, LIBELLES_NIVEAU, MATCH, NIVEAUX_BOT, NOMS_EQUIPES_DEFAUT, joueursParEquipe,
  type Equipe, type Format, type NiveauBot, type StockageMinimal,
} from "../contrat";
import { libelleDuree } from "../lobby";
import {
  CLE_REPRISE, CLE_SANS_RENDU, RESEAU, REGLAGES_SALON_DEFAUT, normaliserCode,
  type EtatConnexion, type EtatSalon, type JoueurSalon, type MessageServeur, type RaisonRefus, type ReglagesSalon, type ReprisePossible,
  type ResumeSalle, type TypeMessageClient,
} from "./protocole";

// ============================================================================================================================
// 1. Mémoire locale
// ============================================================================================================================

/** Mode choisi dans le panneau Rocket Muche : « Hors ligne » (bots, aucun serveur) ou « En ligne ». */
export type ModeRocket = "local" | "ligne";
export const CLE_MODE_ROCKET = "pdj-rocket-mode";
/** Réglages que l'hôte a choisis pour sa dernière partie créée (format, durée, niveau des bots, visibilité). */
export const CLE_REGLAGES_LIGNE = "pdj-rocket-ligne-reglages";

/** Lit le mode mémorisé (défaut : hors ligne, le mode qui ne dépend d'aucun serveur). Ne jette jamais. */
export function lireModeRocket(s: StockageMinimal | null): ModeRocket {
  try { return s?.getItem(CLE_MODE_ROCKET) === "ligne" ? "ligne" : "local"; } catch { return "local"; }
}
export function ecrireModeRocket(m: ModeRocket, s: StockageMinimal | null): void {
  try { s?.setItem(CLE_MODE_ROCKET, m); } catch { /* stockage indisponible : le choix n'est pas retenu */ }
}

const estObjet = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const dans = <T extends string>(liste: readonly T[], v: unknown, defaut: T): T => (typeof v === "string" && (liste as readonly string[]).includes(v) ? (v as T) : defaut);

/** Réglages de salon propres : toute valeur hors liste est ramenée à celle de `REGLAGES_SALON_DEFAUT()`. Ne jette jamais. */
export function normaliserReglagesSalon(brut: unknown): ReglagesSalon {
  const d = REGLAGES_SALON_DEFAUT();
  if (!estObjet(brut)) return d;
  return {
    format: dans(FORMATS, brut.format, d.format),
    dureeS: typeof brut.dureeS === "number" && MATCH.dureesPermisesS.includes(brut.dureeS) ? brut.dureeS : d.dureeS,
    niveauBots: dans(NIVEAUX_BOT, brut.niveauBots, d.niveauBots),
    visible: typeof brut.visible === "boolean" ? brut.visible : d.visible,
  };
}
export function lireReglagesSalon(s: StockageMinimal | null): ReglagesSalon {
  try {
    const brut = s?.getItem(CLE_REGLAGES_LIGNE);
    return normaliserReglagesSalon(brut ? JSON.parse(brut) : null);
  } catch { return REGLAGES_SALON_DEFAUT(); }
}
export function ecrireReglagesSalon(r: Readonly<ReglagesSalon>, s: StockageMinimal | null): void {
  try { s?.setItem(CLE_REGLAGES_LIGNE, JSON.stringify(normaliserReglagesSalon(r))); } catch { /* silencieux */ }
}

/** Session mémorisée dans `sessionStorage` : de quoi reprendre sa place après un rechargement ou une coupure. `coupeA` : dernier instant de vie (`Date.now()`). */
export interface SessionMemorisee extends ReprisePossible {
  coupeA: number;
}
const estEntier = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;

export function ecrireReprise(session: Readonly<ReprisePossible>, maintenantMs: number, s: StockageMinimal | null): void {
  try {
    const m: SessionMemorisee = { code: session.code, joueur: session.joueur, jeton: session.jeton, coupeA: Math.trunc(maintenantMs) };
    s?.setItem(CLE_REPRISE, JSON.stringify(m));
  } catch { /* silencieux */ }
}
/** Retire la reprise mémorisée (départ volontaire, salon refermé). `StockageMinimal` n'a pas `removeItem` : une valeur vide la périme. */
export function effacerReprise(s: (StockageMinimal & { removeItem?(k: string): void }) | null): void {
  try {
    if (!s) return;
    if (typeof s.removeItem === "function") s.removeItem(CLE_REPRISE);
    else s.setItem(CLE_REPRISE, "");
  } catch { /* silencieux */ }
}
/**
 * Reprise tentable maintenant : la session mémorisée est bien formée et sa dernière vie remonte à `RESEAU.repriseMs` au plus (au-delà, un bot a pris
 * la place : inutile d'essayer). Ne jette jamais.
 */
export function lireReprise(s: StockageMinimal | null, maintenantMs: number): ReprisePossible | null {
  try {
    const brut = s?.getItem(CLE_REPRISE);
    if (!brut) return null;
    const o: unknown = JSON.parse(brut);
    if (!estObjet(o)) return null;
    const code = normaliserCode(o.code);
    if (!code || !estEntier(o.joueur) || typeof o.jeton !== "string" || !/^[0-9a-f]{32}$/i.test(o.jeton) || !estEntier(o.coupeA)) return null;
    const ecart = maintenantMs - o.coupeA;
    if (ecart < 0 || ecart > RESEAU.repriseMs) return null;
    return { code, joueur: o.joueur, jeton: o.jeton };
  } catch { return null; }
}

/**
 * Drapeau d'essai « sans rendu » (`localStorage[CLE_SANS_RENDU]`, posé par `addInitScript` des essais de bout en bout en rendu logiciel) : la simulation et
 * le réseau tournent, rien n'est dessiné. Lu UNIQUEMENT hors production (`production` vrai : toujours faux). Ne jette jamais.
 */
export function sansRenduActif(s: StockageMinimal | null, production: boolean): boolean {
  if (production) return false;
  try {
    const v = s?.getItem(CLE_SANS_RENDU);
    return !!v && v !== "0" && v.toLowerCase() !== "false";
  } catch { return false; }
}

// ============================================================================================================================
// 2. Saisie
// ============================================================================================================================

/** Caractères conservés d'un code saisi : l'alphabet des codes, en majuscules, `RESEAU.longueurCode` au plus (le champ force les majuscules). */
export function saisirCode(brut: string): string {
  let sortie = "";
  for (const ch of brut.toUpperCase()) {
    if (RESEAU.alphabetCode.includes(ch)) sortie += ch;
    if (sortie.length >= RESEAU.longueurCode) break;
  }
  return sortie;
}
/** Code complet et valide prêt à envoyer, ou null. */
export const codePret = (saisi: string): string | null => normaliserCode(saisi);

// ============================================================================================================================
// 3. Libellés
// ============================================================================================================================

/** Raison pour laquelle la connexion ne reviendra pas d'elle-même, posée par `client.ts` (`raisonFermeture()`). */
export type RaisonFermeture = "version" | "plein" | "injoignable" | "remplacee" | "coupure" | "arret";

/** État de la connexion : texte court affiché dans le lobby (`role="status"`) et gravité (la couleur ne porte jamais seule : le texte dit tout). */
export function libelleConnexion(c: EtatConnexion | "inactif", raison: RaisonFermeture | null): { texte: string; gravite: "ok" | "attente" | "erreur" } {
  switch (c) {
    case "inactif": return { texte: "Hors connexion", gravite: "attente" };
    case "connexion": return { texte: "Connexion au serveur…", gravite: "attente" };
    case "reconnexion": return { texte: "Connexion perdue, reconnexion…", gravite: "attente" };
    case "ouverte": return { texte: "Connecté", gravite: "ok" };
    case "refusee":
      return raison === "plein"
        ? { texte: "Le serveur est complet, réessayez dans un instant.", gravite: "erreur" }
        : { texte: "Version incompatible : rechargez la page. Si cela persiste, le serveur n'est pas encore à jour.", gravite: "erreur" };
    case "fermee":
      if (raison === "remplacee") return { texte: "Votre place est utilisée dans un autre onglet.", gravite: "erreur" };
      if (raison === "injoignable") return { texte: "Serveur injoignable. Vérifiez votre connexion puis réessayez.", gravite: "erreur" };
      return { texte: "Connexion fermée.", gravite: "erreur" };
  }
}
/** La connexion est dans un état d'où l'on peut tenter de repartir à la main (bouton « Réessayer »). */
export const reessayable = (c: EtatConnexion | "inactif"): boolean => c === "fermee" || c === "refusee";

/** Message d'un refus du serveur (réponse à une action du lobby), en français. */
export function libelleRefus(action: TypeMessageClient, raison: RaisonRefus): string {
  if (action === "rejoindre" && raison === "inconnue") return "Aucune partie ne porte ce code.";
  switch (raison) {
    case "inconnue": return "Cette partie n'existe plus.";
    case "pleine": return "La partie est complète.";
    case "en-cours": return "La partie est déjà commencée.";
    case "hote": return "Seul l'hôte peut faire cela.";
    case "limite": return action === "rejoindre"
      ? "Trop d'essais de code : patientez une minute."
      : "Le serveur a atteint sa limite de parties : réessayez dans un instant.";
    case "format": return "Ce format est trop petit pour les joueurs présents.";
    case "joueurs": return "Il faut deux joueurs pour lancer la partie.";
    case "equipe-pleine": return "Cette équipe est complète.";
    case "code": return "Code invalide : quatre lettres.";
    case "phase": return "Impossible à ce moment de la partie.";
    case "deja-dans-salle": return "Vous êtes déjà dans une partie.";
    case "invalide": return "Demande invalide.";
    case "dev": return "Action réservée aux essais.";
    case "serveur-plein": return "Le serveur est plein, réessayez plus tard.";
  }
}
/** Message d'une erreur de protocole du serveur (`erreur{code}`). */
export function libelleErreur(code: Extract<MessageServeur, { t: "erreur" }>["code"]): string {
  switch (code) {
    case "version": return "Version incompatible : rechargez la page. Si cela persiste, le serveur n'est pas encore à jour.";
    case "flood": return "Trop de messages envoyés : la connexion a été coupée.";
    case "bonjour": return "La connexion au serveur a échoué.";
    case "format": return "Message refusé par le serveur.";
    case "serveur": return "Erreur du serveur, réessayez.";
  }
}

export const LIBELLES_EQUIPE_COURT: Readonly<Record<Equipe, string>> = NOMS_EQUIPES_DEFAUT;
export const libelleFormatSalon = (f: Format): string => f;
/** « 1v1 · Pro · 5 min » */
export const libelleReglagesSalon = (r: Pick<ReglagesSalon, "format" | "niveauBots" | "dureeS">): string =>
  `${r.format} · ${LIBELLES_NIVEAU[r.niveauBots]} · ${libelleDuree(r.dureeS)}`;

// ============================================================================================================================
// 4. Parties ouvertes
// ============================================================================================================================

export interface LignePartie {
  /** clé stable de la ligne (le code : la liste rafraîchie ne remonte pas les lignes) */
  cle: string;
  code: string;
  hote: string;
  format: Format;
  /** « 1v1 · Pro · 5 min » */
  description: string;
  occupation: string;
  /** nom accessible du bouton : « Rejoindre la partie ABCD » (le bouton du champ de code s'appelle exactement « Rejoindre ») */
  libelleBouton: string;
  complete: boolean;
}
/** Lignes de la liste « Parties ouvertes » : triées par code (ordre stable d'un rafraîchissement à l'autre), places libres affichées. */
export function lignesParties(parties: readonly ResumeSalle[]): LignePartie[] {
  return [...parties]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((p) => ({
      cle: p.code,
      code: p.code,
      hote: p.hote,
      format: p.format,
      description: libelleReglagesSalon(p),
      occupation: `${p.humains}/${p.places}`,
      libelleBouton: `Rejoindre la partie ${p.code}`,
      complete: p.humains >= p.places,
    }));
}

// ============================================================================================================================
// 5. Vue du salon
// ============================================================================================================================

export interface PlaceVue {
  /** joueur présent, ou null pour une place libre (prise par un bot au lancement) */
  joueur: JoueurSalon | null;
}
export interface EquipeVue {
  equipe: Equipe;
  nom: string;
  joueurs: JoueurSalon[];
  /** places humaines de l'équipe pour le format (`joueursParEquipe`) */
  places: number;
  libres: number;
  /** « Passer dans cette équipe » proposé : pas la mienne, de la place, salon en phase « salon » */
  peutRejoindre: boolean;
  /** c'est mon équipe */
  mienne: boolean;
}
export interface VueSalon {
  code: string;
  /** « A B C D » pour la lecture à voix haute (lecteurs d'écran) */
  codeEpele: string;
  phase: EtatSalon["phase"];
  estHote: boolean;
  moi: JoueurSalon | null;
  equipes: EquipeVue[];
  humains: number;
  reglages: ReglagesSalon;
  description: string;
  /** « Vous contre 1 joueur », « Vous et 1 joueur contre 2 bots »… */
  resume: string;
  lancable: boolean;
  /** raison affichée tant que « Lancer la partie » est grisé (vide si lançable ou si je ne suis pas l'hôte) */
  raisonNonLancable: string;
  /** les places libres sont tenues par des bots : phrase d'explication */
  noteBots: string;
  /** progression du chargement (phase « chargement ») */
  chargement: { prets: number; total: number } | null;
}

const pluriel = (n: number, un: string, plusieurs: string): string => `${n} ${n > 1 ? plusieurs : un}`;

/** Qui joue avec qui, du point de vue de `moi` : humains présents par équipe + bots pour combler les places. */
export function resumeEffectifsSalon(etat: Pick<EtatSalon, "joueurs" | "reglages">, moi: number | null): string {
  const n = joueursParEquipe(etat.reglages.format);
  const moiJ = etat.joueurs.find((j) => j.id === moi) ?? null;
  const mienne: Equipe = moiJ?.equipe ?? "bleue";
  const autre: Equipe = mienne === "bleue" ? "orange" : "bleue";
  const decrire = (equipe: Equipe, moiInclus: boolean): string => {
    const humains = etat.joueurs.filter((j) => j.equipe === equipe && !(moiInclus && j.id === moi)).length;
    const bots = Math.max(0, n - humains - (moiInclus ? 1 : 0));
    const morceaux: string[] = [];
    if (humains > 0) morceaux.push(pluriel(humains, "joueur", "joueurs"));
    if (bots > 0) morceaux.push(pluriel(bots, "bot", "bots"));
    return morceaux.join(" et ");
  };
  const avec = decrire(mienne, true);
  const contre = decrire(autre, false);
  return `${avec ? `Vous et ${avec}` : "Vous"} contre ${contre || "personne"}`;
}

/** Vue complète d'un salon pour l'écran du lobby. `moi` : mon id de joueur (message `bienvenue`). */
export function vueSalon(etat: Readonly<EtatSalon>, moi: number | null): VueSalon {
  const moiJ = etat.joueurs.find((j) => j.id === moi) ?? null;
  const places = joueursParEquipe(etat.reglages.format);
  const enSalon = etat.phase === "salon";
  const equipes: EquipeVue[] = EQUIPES.map((e) => {
    const joueurs = etat.joueurs.filter((j) => j.equipe === e);
    const libres = Math.max(0, places - joueurs.length);
    return {
      equipe: e,
      nom: NOMS_EQUIPES_DEFAUT[e],
      joueurs,
      places,
      libres,
      peutRejoindre: enSalon && !!moiJ && moiJ.equipe !== e && libres > 0,
      mienne: !!moiJ && moiJ.equipe === e,
    };
  });
  const estHote = !!moiJ?.hote;
  const connectes = etat.joueurs.filter((j) => j.connecte);
  const bots = Math.max(0, places * 2 - etat.joueurs.length);
  const total = connectes.length;
  return {
    code: etat.code,
    codeEpele: etat.code.split("").join(" "),
    phase: etat.phase,
    estHote,
    moi: moiJ,
    equipes,
    humains: etat.joueurs.length,
    reglages: etat.reglages,
    description: libelleReglagesSalon(etat.reglages),
    resume: resumeEffectifsSalon(etat, moi),
    lancable: etat.lancable,
    raisonNonLancable: estHote && !etat.lancable ? (etat.raisonNonLancable ?? "La partie ne peut pas être lancée.") : "",
    noteBots: bots > 0 ? `${pluriel(bots, "place libre sera tenue", "places libres seront tenues")} par ${bots > 1 ? "des bots" : "un bot"} niveau ${LIBELLES_NIVEAU[etat.reglages.niveauBots]}.` : "",
    chargement: etat.phase === "chargement" ? { prets: connectes.filter((j) => j.charge).length, total } : null,
  };
}

/** Texte de l'étape de chargement : « Chargement… 1/2 prêts ». */
export function libelleChargement(c: { prets: number; total: number }): string {
  return `Chargement… ${c.prets}/${c.total} ${c.prets > 1 ? "prêts" : "prêt"}`;
}

/** Texte du bouton du salon selon l'étape : l'hôte lance, l'invité attend. */
export function libelleLancer(v: Pick<VueSalon, "estHote" | "lancable">): string {
  return v.estHote ? "Lancer la partie" : v.lancable ? "En attente de l'hôte" : "En attente des joueurs";
}

/** Revanche : votes « oui » des humains présents et mon propre vote. */
export function resumeRevanche(r: { votes: Record<number, boolean>; restantMs: number } | undefined | null, humains: number, moi: number | null): {
  oui: number; attendus: number; aVote: boolean; restantS: number;
} {
  const oui = r ? Object.values(r.votes).filter(Boolean).length : 0;
  return {
    oui,
    attendus: Math.max(1, humains),
    aVote: !!r && moi !== null && r.votes[moi] === true,
    restantS: r ? Math.max(0, Math.ceil(r.restantMs / 1000)) : 0,
  };
}

// ============================================================================================================================
// 6. Reconstitution de l'état du lobby, message après message
// ============================================================================================================================

export type DebutRocket = Extract<MessageServeur, { t: "debut" }>;

export interface MessageLobby {
  genre: "erreur" | "info";
  texte: string;
}
export interface EtatLobbyEnLigne {
  connexion: EtatConnexion | "inactif";
  fermeture: RaisonFermeture | null;
  /** mon id de joueur (message `bienvenue`) */
  joueur: number | null;
  session: ReprisePossible | null;
  salon: EtatSalon | null;
  /** parties ouvertes ; null avant la première réponse à `lister` */
  parties: ResumeSalle[] | null;
  /** le match démarre (ou a démarré) : le jeu se crée dessus */
  debut: DebutRocket | null;
  message: MessageLobby | null;
  /** une demande de création ou d'entrée est partie et n'a pas de réponse */
  attente: "creer" | "rejoindre" | null;
}
export const etatLobbyInitial = (): EtatLobbyEnLigne => ({
  connexion: "inactif", fermeture: null, joueur: null, session: null, salon: null, parties: null, debut: null, message: null, attente: null,
});

/** Applique un message du serveur à l'état du lobby (pur : rend un nouvel objet, l'ancien n'est pas modifié). Les messages de jeu (`ev`, `pong`, `fin`, `presence`) ne le concernent pas. */
export function appliquerMessage(e: Readonly<EtatLobbyEnLigne>, m: Readonly<MessageServeur>): EtatLobbyEnLigne {
  switch (m.t) {
    case "bienvenue":
      return { ...e, joueur: m.joueur };
    case "reprise":
      return m.code === null
        ? { ...e, session: null, attente: null }
        : { ...e, attente: null, message: { genre: "info", texte: "Reprise de votre partie…" } };
    case "session":
      return { ...e, session: { code: m.code, joueur: m.joueur, jeton: m.jeton }, joueur: m.joueur, attente: null, message: null };
    case "liste":
      return { ...e, parties: m.parties };
    case "salon": {
      if (m.salon === null) {
        const message: MessageLobby | null = m.raison === "expire"
          ? { genre: "info", texte: "Le salon a été fermé : il était inactif depuis trop longtemps." }
          : m.raison === "ferme" ? { genre: "info", texte: "Le salon a été fermé." }
          : m.raison === "expulse" ? { genre: "erreur", texte: "Vous avez été retiré du salon." }
          : null;
        return { ...e, salon: null, session: null, debut: null, attente: null, message: message ?? e.message };
      }
      return { ...e, salon: m.salon, attente: null, debut: m.salon.phase === "salon" ? null : e.debut };
    }
    case "debut":
      return { ...e, debut: m, message: null };
    case "refus":
      return { ...e, attente: null, message: { genre: "erreur", texte: libelleRefus(m.action, m.raison) } };
    case "erreur":
      return { ...e, attente: null, message: { genre: "erreur", texte: libelleErreur(m.code) } };
    default:
      return e;
  }
}

/** Applique un changement d'état de la connexion. `raison` : pourquoi elle est fermée, si le client le sait. */
export function appliquerConnexion(e: Readonly<EtatLobbyEnLigne>, c: EtatConnexion, raison: RaisonFermeture | null = null): EtatLobbyEnLigne {
  if (c === "fermee" || c === "refusee") {
    // plus de connexion et plus de reprise possible : le salon affiché n'a plus de sens
    return { ...e, connexion: c, fermeture: raison, salon: null, session: null, debut: null, attente: null, parties: null };
  }
  return { ...e, connexion: c, fermeture: null };
}

/** Le joueur a décidé de partir (accusé local avant même la réponse du serveur) : plus de salon, plus de match. */
export function quitterSalonLocalement(e: Readonly<EtatLobbyEnLigne>): EtatLobbyEnLigne {
  return { ...e, salon: null, session: null, debut: null, attente: null, message: null };
}
/** Note le départ d'une demande en cours (« Création… », « Entrée… »). */
export function attendre(e: Readonly<EtatLobbyEnLigne>, a: EtatLobbyEnLigne["attente"]): EtatLobbyEnLigne {
  return { ...e, attente: a, message: a ? null : e.message };
}

/** Quel écran le lobby en ligne montre. */
export type EcranLobby = "connexion" | "accueil" | "salon" | "chargement";
export function ecranLobby(e: Readonly<EtatLobbyEnLigne>): EcranLobby {
  if (e.connexion !== "ouverte") return e.salon && e.connexion === "reconnexion" ? (e.salon.phase === "chargement" ? "chargement" : "salon") : "connexion";
  if (!e.salon) return "accueil";
  return e.salon.phase === "chargement" ? "chargement" : "salon";
}
