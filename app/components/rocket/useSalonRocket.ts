"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { nettoyerNomJoueur } from "@/lib/rocket/lobby";
import type { ClientRocketEtendu } from "@/lib/rocket/reseau/client";
import {
  appliquerConnexion, appliquerMessage, attendre, effacerReprise, ecrireReprise, etatLobbyInitial, lireReprise, quitterSalonLocalement,
  type EtatLobbyEnLigne,
} from "@/lib/rocket/reseau/lobby-en-ligne";
import type { Equipe } from "@/lib/rocket/contrat";
import type { ReglagesSalon, SnapRocket } from "@/lib/rocket/reseau/protocole";

/** Rafraîchissement de la liste « Parties ouvertes » tant que le panneau est visible (ms). */
export const PERIODE_LISTE_MS = 3000;
/** Rafraîchissement de l'instant de dernière vie de la session mémorisée (ms) : borne l'âge d'une reprise après un rechargement. */
const PERIODE_VIE_MS = 2000;

export interface OptionsSalonRocket {
  /** vrai : le panneau « En ligne » est ouvert ou une partie en ligne est en cours ; faux : aucune socket (ou elle est fermée) */
  actif: boolean;
  /** nom saisi dans le lobby (nettoyé avant d'être envoyé) */
  nom: string;
  /** la liste des parties est à l'écran : elle est rafraîchie toutes les `PERIODE_LISTE_MS` */
  listeVisible: boolean;
}

export interface ActionsSalonRocket {
  creer(reglages: ReglagesSalon): void;
  rejoindre(code: string, equipe?: Equipe): void;
  /** quitte le salon ou le match (un bot prend la voiture) ; la connexion reste ouverte pour une autre partie */
  quitter(): void;
  choisirEquipe(equipe: Equipe): void;
  regler(patch: Partial<ReglagesSalon>): void;
  lancer(): void;
  /** hôte, après un match : retour au salon sans revanche */
  retourSalon(): void;
  actualiser(): void;
  /** après une connexion fermée ou refusée */
  reessayer(): void;
}

export interface SalonRocket {
  etat: EtatLobbyEnLigne;
  actions: ActionsSalonRocket;
  /** client réseau courant (lu par le jeu au moment de sa création) */
  clientRef: RefObject<ClientRocketEtendu | null>;
  /** dernier instantané reçu depuis la dernière prise (le jeu se crée pendant que le serveur attend `pret`) ; le vide */
  prendreSnap(): SnapRocket | null;
}

const stockageSession = (): Storage | null => {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
};

/**
 * Colle entre le client réseau et l'interface : crée la connexion quand `actif`, reconstitue l'état du lobby message après message
 * (`appliquerMessage`, pur et testé), mémorise la session pour la reprise, rafraîchit la liste des parties. Le client (`client.ts`, avec le codec)
 * n'est chargé que par `import()` dans l'effet : rien du réseau n'entre dans le premier chargement de la page du menu.
 */
export function useSalonRocket({ actif, nom, listeVisible }: OptionsSalonRocket): SalonRocket {
  const [etat, setEtat] = useState<EtatLobbyEnLigne>(etatLobbyInitial);
  const etatRef = useRef(etat);
  etatRef.current = etat;
  const clientRef = useRef<ClientRocketEtendu | null>(null);
  const nomRef = useRef(nom);
  nomRef.current = nom;
  const snapRef = useRef<SnapRocket | null>(null);
  /** connexion courante : client, nom envoyé au `bonjour`, désabonnement, promesse de disponibilité */
  const connexion = useRef<{ client: ClientRocketEtendu | null; nom: string; stop: () => void; annule: boolean; pret: Promise<ClientRocketEtendu | null> } | null>(null);

  const modifier = useCallback((f: (e: EtatLobbyEnLigne) => EtatLobbyEnLigne) => setEtat((e) => f(e)), []);

  /** ouvre une connexion pour `nomPropre` (reprise tentée si une session récente est mémorisée) */
  const ouvrir = useCallback((nomPropre: string) => {
    const c: NonNullable<typeof connexion.current> = { client: null, nom: nomPropre, stop: () => {}, annule: false, pret: Promise.resolve(null) };
    connexion.current = c;
    c.pret = import("@/lib/rocket/reseau/client").then(({ creerClientRocket }) => {
      if (c.annule) return null;
      const reprise = lireReprise(stockageSession(), Date.now());
      const client = creerClientRocket({ nom: nomPropre, reprise: reprise ?? undefined });
      c.client = client;
      clientRef.current = client;
      const stopEcoute = client.ecouter({
        message: (m) => {
          modifier((e) => appliquerMessage(e, m));
          if (m.t === "session") ecrireReprise({ code: m.code, joueur: m.joueur, jeton: m.jeton }, Date.now(), stockageSession());
          else if ((m.t === "salon" && m.salon === null) || (m.t === "reprise" && m.code === null)) effacerReprise(stockageSession());
        },
        snap: (s) => { snapRef.current = s; },
        etat: (ce) => {
          modifier((e) => appliquerConnexion(e, ce, client.raisonFermeture()));
          if (ce === "ouverte") client.envoyer({ t: "lister" });
        },
      });
      c.stop = () => { stopEcoute(); client.fermer(); };
      modifier((e) => appliquerConnexion(e, "connexion"));
      client.connecter();
      return client;
    }).catch((err: unknown) => {
      if (process.env.NODE_ENV !== "production") console.error("rocket : client réseau", err);
      modifier((e) => appliquerConnexion(e, "fermee", "injoignable"));
      return null;
    });
  }, [modifier]);

  const fermer = useCallback(() => {
    const c = connexion.current;
    connexion.current = null;
    if (!c) return;
    c.annule = true;
    c.stop();
    if (clientRef.current === c.client) clientRef.current = null;
  }, []);

  // connexion tant que `actif`
  useEffect(() => {
    if (!actif) return;
    ouvrir(nettoyerNomJoueur(nomRef.current));
    return () => {
      fermer();
      snapRef.current = null;
      setEtat(etatLobbyInitial());
    };
  }, [actif, ouvrir, fermer]);

  // liste des parties ouvertes : rafraîchie tant qu'elle est à l'écran et que l'on n'est dans aucun salon
  const auSalon = etat.salon !== null;
  useEffect(() => {
    if (!actif || !listeVisible || auSalon || etat.connexion !== "ouverte") return;
    const demander = () => clientRef.current?.envoyer({ t: "lister" });
    demander();
    const id = setInterval(demander, PERIODE_LISTE_MS);
    return () => clearInterval(id);
  }, [actif, listeVisible, auSalon, etat.connexion]);

  // session mémorisée : l'instant de dernière vie est rafraîchi, pour qu'un rechargement de page dans les 20 s retrouve sa place
  const session = etat.session;
  useEffect(() => {
    if (!session) return;
    const noter = () => ecrireReprise(session, Date.now(), stockageSession());
    noter();
    const id = setInterval(noter, PERIODE_VIE_MS);
    window.addEventListener("pagehide", noter);
    return () => { clearInterval(id); window.removeEventListener("pagehide", noter); };
  }, [session]);

  /** envoie `m` ; si le nom a changé depuis le `bonjour` et qu'on n'est dans aucun salon, la connexion est refaite avec le bon nom (le message part dès l'ouverture) */
  const envoyer = useCallback((m: Parameters<ClientRocketEtendu["envoyer"]>[0], avecNom = false) => {
    const nomPropre = nettoyerNomJoueur(nomRef.current);
    if (avecNom && connexion.current && connexion.current.nom !== nomPropre && etatRef.current.salon === null) {
      fermer();
      snapRef.current = null;
      modifier((e) => ({ ...e, connexion: "connexion", parties: null }));
      ouvrir(nomPropre);
      void connexion.current?.pret.then((c) => c?.envoyer(m));
      return;
    }
    const c = connexion.current;
    if (!c) return;
    void c.pret.then((client) => client?.envoyer(m));
  }, [fermer, modifier, ouvrir]);

  const actions = useMemo<ActionsSalonRocket>(() => ({
    creer(reglages) { modifier((e) => attendre(e, "creer")); envoyer({ t: "creer", reglages }, true); },
    rejoindre(code, equipe) { modifier((e) => attendre(e, "rejoindre")); envoyer({ t: "rejoindre", code, ...(equipe ? { equipe } : {}) }, true); },
    quitter() {
      effacerReprise(stockageSession());
      modifier((e) => quitterSalonLocalement(e));
      envoyer({ t: "quitter" });
      envoyer({ t: "lister" });
    },
    choisirEquipe(equipe) { envoyer({ t: "equipe", equipe }); },
    regler(patch) { envoyer({ t: "reglages", reglages: patch }); },
    lancer() { envoyer({ t: "lancer" }); },
    retourSalon() { envoyer({ t: "retourSalon" }); },
    actualiser() { envoyer({ t: "lister" }); },
    reessayer() {
      const c = clientRef.current;
      if (c) {
        modifier((e) => appliquerConnexion(e, "connexion"));
        c.reessayer();
      } else {
        fermer();
        ouvrir(nettoyerNomJoueur(nomRef.current));
      }
    },
  }), [envoyer, modifier, fermer, ouvrir]);

  const prendreSnap = useCallback((): SnapRocket | null => {
    const s = snapRef.current;
    snapRef.current = null;
    return s;
  }, []);

  return { etat, actions, clientRef, prendreSnap };
}
