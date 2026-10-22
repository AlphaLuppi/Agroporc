"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { connecterArene, urlArene, type ClientArene, type EtatConnexion } from "@/lib/fps/reseau";
import type { ArmeId, EtatJoueurSnap, InfoMatch, JoueurPublic, LigneClassement, MessageServeur, Zone } from "@/lib/fps/protocole";
import type { JeuEvenement, JeuHandle } from "@/lib/fps/jeu";

/** Une ligne du fil des kills (en haut à droite pendant la partie). */
export interface EntreeFil {
  id: number;
  par: string;
  parCouleur: string;
  cible: string;
  cibleCouleur: string;
  arme: ArmeId;
  tete: boolean;
  /** je suis le tueur ou la victime */
  moi: boolean;
}

/** Retour visuel éphémère du viseur : touche, kill ou dégât reçu. */
export type EvenementHud =
  | { id: number; type: "touche"; zone: Zone }
  | { id: number; type: "kill"; zone: Zone }
  | { id: number; type: "degat"; angle: number };

export interface DerniereMort { par: string; parCouleur: string; arme: ArmeId; zone: Zone }

const DUREE_FIL_MS = 6000;
const DUREE_EVENEMENT_MS = 1100;
const FIL_MAX = 6;

export interface UseArene {
  etat: EtatConnexion;
  monId: string | null;
  joueurs: JoueurPublic[];
  match: InfoMatch | null;
  /** classement de la fin du dernier match (affiché pendant l'entracte) */
  classement: LigneClassement[] | null;
  fil: EntreeFil[];
  evenements: EvenementHud[];
  derniereMort: DerniereMort | null;
  /** erreur renvoyée par le serveur (arène pleine, version…) */
  erreur: string | null;
  clientRef: MutableRefObject<ClientArene | null>;
  /** dernier instantané reçu (marqueurs des spectateurs) */
  snapRef: MutableRefObject<EtatJoueurSnap[]>;
  /** Date.now() de ce dernier instantané (le serveur n'en envoie plus quand personne ne joue) */
  snapTRef: MutableRefObject<number>;
  joueursRef: MutableRefObject<JoueurPublic[]>;
  matchRef: MutableRefObject<InfoMatch | null>;
  /** à passer à `lancerJeu` en `evenement` */
  pousserEvenement(e: JeuEvenement): void;
}

/**
 * Connexion au serveur de l'arène tant que la vue Palantir est ouverte : présence (spectateurs),
 * pseudo, match en cours, fil des kills. Un changement de pseudo est envoyé sans reconnexion. Chaque message est aussi
 * relayé à la partie en cours (`jeuRef`).
 */
export function useArene(pseudo: string, jeuRef: MutableRefObject<JeuHandle | null>): UseArene {
  const [etat, setEtat] = useState<EtatConnexion>("connexion");
  const [monId, setMonId] = useState<string | null>(null);
  const [joueurs, setJoueurs] = useState<JoueurPublic[]>([]);
  const [match, setMatch] = useState<InfoMatch | null>(null);
  const [classement, setClassement] = useState<LigneClassement[] | null>(null);
  const [fil, setFil] = useState<EntreeFil[]>([]);
  const [evenements, setEvenements] = useState<EvenementHud[]>([]);
  const [derniereMort, setDerniereMort] = useState<DerniereMort | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const clientRef = useRef<ClientArene | null>(null);
  const snapRef = useRef<EtatJoueurSnap[]>([]);
  const snapTRef = useRef(0);
  const joueursRef = useRef<JoueurPublic[]>([]);
  const matchRef = useRef<InfoMatch | null>(null);
  const monIdRef = useRef<string | null>(null);
  const compteur = useRef(0);
  const minuteurs = useRef(new Set<ReturnType<typeof setTimeout>>());
  const pseudoRef = useRef(pseudo);
  pseudoRef.current = pseudo;

  const apres = useCallback((ms: number, f: () => void) => {
    const m = setTimeout(() => { minuteurs.current.delete(m); f(); }, ms);
    minuteurs.current.add(m);
  }, []);

  const pousserEvenement = useCallback((e: JeuEvenement) => {
    if (e.type === "mort") {
      const j = joueursRef.current.find((x) => x.id === e.par);
      setDerniereMort({ par: j?.pseudo ?? "Agent", parCouleur: j?.couleur ?? "#9be9ff", arme: e.arme, zone: e.zone });
      return;
    }
    const id = ++compteur.current;
    const ev: EvenementHud =
      e.type === "degat" ? { id, type: "degat", angle: e.angle }
      : e.type === "kill" ? { id, type: "kill", zone: e.zone }
      : { id, type: "touche", zone: e.zone };
    setEvenements((l) => [...l.slice(-5), ev]);
    apres(DUREE_EVENEMENT_MS, () => setEvenements((l) => l.filter((x) => x.id !== id)));
  }, [apres]);

  useEffect(() => {
    const surMessage = (m: MessageServeur) => {
      switch (m.t) {
        case "bienvenue":
          monIdRef.current = m.id;
          setMonId(m.id);
          joueursRef.current = m.joueurs;
          matchRef.current = m.match;
          setJoueurs(m.joueurs);
          setMatch(m.match);
          setErreur(null);
          break;
        case "presence":
          joueursRef.current = m.joueurs;
          setJoueurs(m.joueurs);
          break;
        case "snap":
          snapRef.current = m.j;
          snapTRef.current = Date.now();
          break;
        case "match":
          matchRef.current = m.match;
          setMatch(m.match);
          setClassement(m.match.phase === "entracte" ? m.classement : null);
          break;
        case "mort": {
          const trouve = (id: string) => joueursRef.current.find((j) => j.id === id);
          const par = trouve(m.par), cible = trouve(m.cible);
          const id = ++compteur.current;
          const entree: EntreeFil = {
            id, par: par?.pseudo ?? "Agent", parCouleur: par?.couleur ?? "#9be9ff",
            cible: cible?.pseudo ?? "Agent", cibleCouleur: cible?.couleur ?? "#9be9ff",
            arme: m.arme, tete: m.zone === "tete", moi: m.par === monIdRef.current || m.cible === monIdRef.current,
          };
          setFil((l) => [...l.slice(-(FIL_MAX - 1)), entree]);
          apres(DUREE_FIL_MS, () => setFil((l) => l.filter((x) => x.id !== id)));
          break;
        }
        case "erreur":
          setErreur(m.message);
          break;
        default:
          break;
      }
      jeuRef.current?.recevoir(m);
    };
    const surEtat = (e: EtatConnexion) => {
      setEtat(e);
      if (e === "ferme" || e === "erreur") {
        monIdRef.current = null;
        setMonId(null);
      }
    };
    setEtat("connexion");
    const client = connecterArene(urlArene(), pseudoRef.current, surMessage, surEtat);
    clientRef.current = client;
    return () => {
      client.fermer();
      if (clientRef.current === client) clientRef.current = null;
      monIdRef.current = null;
      setMonId(null);
    };
  }, [jeuRef, apres]);

  // Renommage à chaud (lobby comme en pleine partie) : la session et la partie restent ouvertes.
  useEffect(() => {
    clientRef.current?.renommer(pseudo);
  }, [pseudo]);

  useEffect(() => {
    const liste = minuteurs.current;
    return () => { liste.forEach(clearTimeout); liste.clear(); };
  }, []);

  return { etat, monId, joueurs, match, classement, fil, evenements, derniereMort, erreur, clientRef, snapRef, snapTRef, joueursRef, matchRef, pousserEvenement };
}
