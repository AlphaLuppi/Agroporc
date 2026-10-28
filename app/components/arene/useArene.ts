"use client";

import type { Difficulte } from "@/lib/fps/zombies-vagues";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { connecterArene, urlArene, type ClientArene, type EtatConnexion } from "@/lib/fps/reseau";
import { STATS } from "@/lib/fps/armes";
import {
  JEU, type ArmeSpecialeId, type EtatElsaMsg, type EtatJoueurSnap, type EtatPartieZombies, type InfoMatch, type InfoTueur, type InfoVehicule, type JoueurPublic,
  type LigneClassement, type LigneStats, type MessageServeur, type ModeSalle,
} from "@/lib/fps/protocole";
import { annoncesZombies } from "@/lib/fps/hud-modele";
import type { JeuEvenement, JeuHandle } from "@/lib/fps/jeu";
import type { Annonce, Bonus, DerniereMort, EntreeFil, EvenementHud, GainArgent, Salons, UseArene } from "./contrats";

// Les types de contrat sont dans contrats.ts (partagés avec l'hôte et le HUD) ; réexportés pour les appelants existants.
export type { DerniereMort, EntreeFil, EvenementHud, UseArene } from "./contrats";

const DUREE_FIL_MS = 6000;
const DUREE_EVENEMENT_MS = 1100;
const FIL_MAX = 6;
/** Fil d'annonces : 4 au plus, 8 s chacune (HUD §5.8). */
const ANNONCES_MAX = 4;
const DUREE_ANNONCE_MS = 8000;
/** Toast « j'ai pris le cadeau d'Elsa » (HUD §5.8). */
const DUREE_BONUS_MS = 2500;

const STATS_VIDES = new Map<string, LigneStats>();

/** Contenu d'une offre d'Elsa pour le fil : « soin complet (PV 100, bouclier 100) », « Railgun, 6 tirs ». */
function contenuOffre(genre: "soin" | "arme", arme?: ArmeSpecialeId): string {
  if (genre === "soin") return "soin complet (PV 100, bouclier 100)";
  if (!arme) return "arme spéciale";
  const tirs = STATS[arme].chargeur;
  return `${STATS[arme].nom}, ${tirs} tir${tirs > 1 ? "s" : ""}`;
}

/** `rejoindre` refusé : 16 agents sont déjà en arène (les spectateurs de la vue 3D ne comptent pas). */
export const TEXTE_ARENE_PLEINE = `L'arène est pleine (${JEU.joueursMax} agents en jeu), réessayez dans un instant.`;

/** Texte du refus d'un `monter` / `siege` / `rejoindre` / `mode` par le serveur. */
function texteRefus(action: "monter" | "siege" | "rejoindre" | "mode", raison: "loin" | "plein" | "deja" | "inconnu" | "mort" | "lobby"): string {
  if (action === "rejoindre") return raison === "lobby" ? "Partie de zombies : attendez le lancement par l'hôte." : TEXTE_ARENE_PLEINE;
  if (action === "mode") return raison === "lobby" ? "Impossible de changer de mode en pleine partie." : "La partie de zombies est pleine.";
  switch (raison) {
    case "loin": return "Voiture trop loin";
    case "plein": return action === "siege" ? "Place occupée" : "Voiture pleine";
    case "deja": return "Déjà installé";
    case "mort": return "Impossible : éliminé";
    default: return "Voiture introuvable";
  }
}

/**
 * Connexion au serveur de l'arène tant que la vue Palantir est ouverte : présence (spectateurs),
 * pseudo, match en cours, fil des kills, annonces d'Elsa, sièges des voitures, statistiques du tableau des scores. Un changement
 * de pseudo est envoyé sans reconnexion. Chaque message est aussi relayé à la partie en cours (`jeuRef`).
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
  const [elsa, setElsa] = useState<EtatElsaMsg | null>(null);
  const [annonces, setAnnonces] = useState<Annonce[]>([]);
  const [sieges, setSieges] = useState<InfoVehicule[]>([]);
  const [bonus, setBonus] = useState<Bonus | null>(null);
  const [killcamInfo, setKillcamInfo] = useState<InfoTueur | null>(null);
  const [stats, setStats] = useState<Map<string, LigneStats>>(STATS_VIDES);
  const [degatsAuTueur, setDegatsAuTueur] = useState(0);
  // ---- v5 : modes de jeu ----
  const [mode, setMode] = useState<ModeSalle>("arene");
  const [modeVoulu, setModeVoulu] = useState<ModeSalle>("arene");
  const [salons, setSalons] = useState<Salons | null>(null);
  const [zombies, setZombies] = useState<EtatPartieZombies | null>(null);
  const [argent, setArgent] = useState(0);
  const [gainArgent, setGainArgent] = useState<GainArgent | null>(null);
  /** salle confirmée par le serveur et salle demandée (relue par les rappels du réseau) */
  const modeRef = useRef<ModeSalle>("arene");
  const modeVouluRef = useRef<ModeSalle>("arene");
  const zombiesRef = useRef<EtatPartieZombies | null>(null);
  const nGain = useRef(0);
  /** la connexion a été perdue depuis le dernier « bienvenue » : le serveur a oublié la salle choisie, on la redemande */
  const connexionPerdue = useRef(false);
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
  const statsRef = useRef<Map<string, LigneStats>>(STATS_VIDES);
  /** dégâts que j'ai infligés à chaque cible pendant ma vie (cumul des `confirme`) ; remis à zéro à mon apparition */
  const degatsParCible = useRef(new Map<string, number>());
  const scoresOuvert = useRef(false);

  const apres = useCallback((ms: number, f: () => void) => {
    const m = setTimeout(() => { minuteurs.current.delete(m); f(); }, ms);
    minuteurs.current.add(m);
  }, []);

  /** Ajoute une annonce au fil (4 au plus, 8 s). */
  const annoncer = useCallback((texte: string, genre: Annonce["genre"]) => {
    const id = ++compteur.current;
    setAnnonces((l) => [...l.slice(-(ANNONCES_MAX - 1)), { id, texte, genre }]);
    apres(DUREE_ANNONCE_MS, () => setAnnonces((l) => l.filter((x) => x.id !== id)));
  }, [apres]);

  /** `vueScores{ouvert}` : une seule fois par changement d'état (le serveur applique en plus son anti-rafale de 250 ms). */
  const demanderScores = useCallback((ouvert: boolean) => {
    if (scoresOuvert.current === ouvert) return;
    scoresOuvert.current = ouvert;
    clientRef.current?.envoyer({ t: "vueScores", ouvert });
  }, []);

  const pousserEvenement = useCallback((e: JeuEvenement) => {
    switch (e.type) {
      case "mort": {
        const j = joueursRef.current.find((x) => x.id === e.par);
        setDerniereMort({ par: j?.pseudo ?? e.tueur?.pseudo ?? "", parCouleur: j?.couleur ?? e.tueur?.couleur ?? "", arme: e.arme, cause: e.cause, zone: e.zone, tueur: e.tueur ?? null });
        setKillcamInfo(e.tueur ?? null);
        setDegatsAuTueur(degatsParCible.current.get(e.par) ?? 0);
        return;
      }
      case "bonus": {
        const id = ++compteur.current;
        setBonus({ id, genre: e.genre, arme: e.arme });
        apres(DUREE_BONUS_MS, () => setBonus((b) => (b?.id === id ? null : b)));
        return;
      }
      case "refus":
        // arène pleine : message du panneau (le HUD est refermé par `sortir`), sinon annonce du fil
        if (e.action === "rejoindre") setErreur(texteRefus(e.action, e.raison));
        else annoncer(texteRefus(e.action, e.raison), "info");
        return;
      case "touche":
        // estimation locale : le HUD l'ignore, seul `confirme` (reçu du serveur) compte (HUD §3.4)
        return;
      case "confirme": {
        degatsParCible.current.set(e.cible, (degatsParCible.current.get(e.cible) ?? 0) + e.degats);
        const id = ++compteur.current;
        const ev: EvenementHud = { id, type: "confirme", cible: e.cible, degats: e.degats, absorbe: e.absorbe, zone: e.zone, tue: e.tue, t: performance.now() };
        setEvenements((l) => [...l.slice(-5), ev]);
        apres(DUREE_EVENEMENT_MS, () => setEvenements((l) => l.filter((x) => x.id !== id)));
        return;
      }
      default: {
        const id = ++compteur.current;
        const ev: EvenementHud = e.type === "degat" ? { id, type: "degat", angle: e.angle } : { id, type: "kill", zone: e.zone };
        setEvenements((l) => [...l.slice(-5), ev]);
        apres(DUREE_EVENEMENT_MS, () => setEvenements((l) => l.filter((x) => x.id !== id)));
      }
    }
  }, [apres, annoncer]);

  /** Demande à changer de salle ; la carte cochée suit tout de suite (`modeVoulu`), le serveur confirme par `mode` ou refuse par `refus`. */
  const choisirMode = useCallback((m: ModeSalle) => {
    if (modeVouluRef.current === m) return;
    modeVouluRef.current = m;
    setModeVoulu(m);
    setErreur(null);
    clientRef.current?.envoyer({ t: "mode", mode: m });
  }, []);
  /** Hôte du lobby des zombies : lance la partie (le serveur ignore le message d'un autre joueur). */
  const lancerPartie = useCallback((difficulte?: Difficulte) => {
    clientRef.current?.envoyer(difficulte ? { t: "lancerPartie", difficulte } : { t: "lancerPartie" });
  }, []);

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
          // (v8) session reprise après une micro-coupure : même id, même salle, partie de zombies conservée (son état suit) ; rien à effacer
          if (m.reprise) connexionPerdue.current = false;
          if (connexionPerdue.current) {
            // reconnexion : le serveur nous a remis dans l'arène ; on redemande les zombies si l'interface y était (le mode mémorisé du
            // navigateur, lui, ne fait que présélectionner la carte du choix du mode : il n'envoie rien)
            connexionPerdue.current = false;
            modeRef.current = "arene";
            setMode("arene");
            zombiesRef.current = null;
            setZombies(null);
            setArgent(0);
            setGainArgent(null);
            if (modeVouluRef.current === "zombies") clientRef.current?.envoyer({ t: "mode", mode: "zombies" });
          }
          break;
        case "mode":
          // simple écho (déjà dans cette salle, ex. demande rejouée après une reconnexion) : le serveur n'enverra ni « bienvenue » ni état,
          // tout effacer ici laisserait le lobby sans état jusqu'au prochain changement
          if (m.mode === modeRef.current) {
            modeVouluRef.current = m.mode;
            setModeVoulu(m.mode);
            break;
          }
          // changement de salle confirmé : l'état de l'ancienne salle ne vaut plus rien (le « bienvenue » et l'état de la nouvelle suivent)
          modeRef.current = m.mode;
          modeVouluRef.current = m.mode;
          setMode(m.mode);
          setModeVoulu(m.mode);
          zombiesRef.current = null;
          setZombies(null);
          setArgent(0);
          setGainArgent(null);
          statsRef.current = STATS_VIDES;
          setStats(STATS_VIDES);
          setClassement(null);
          setErreur(null);
          break;
        case "salons":
          setSalons({ arene: m.arene, zombies: m.zombies });
          break;
        case "zombies": {
          for (const texte of annoncesZombies(zombiesRef.current, m.etat, monIdRef.current)) annoncer(texte, "info");
          zombiesRef.current = m.etat;
          setZombies(m.etat);
          break;
        }
        case "argent":
          setArgent(m.solde);
          if (m.delta !== 0) setGainArgent({ n: ++nGain.current, delta: m.delta, motif: m.motif });
          break;
        case "refus":
          // changement de salle refusé (partie pleine, déjà en jeu) : la carte cochée revient, le message s'affiche dans le panneau
          if (m.action === "mode") {
            modeVouluRef.current = modeRef.current;
            setModeVoulu(modeRef.current);
            setErreur(texteRefus("mode", m.raison));
          }
          break;
        case "presence":
          joueursRef.current = m.joueurs;
          setJoueurs(m.joueurs);
          // une place s'est libérée : le message « arène pleine » n'a plus lieu d'être
          if (m.joueurs.filter((x) => x.enJeu).length < JEU.joueursMax) setErreur((e) => (e === TEXTE_ARENE_PLEINE ? null : e));
          break;
        case "snap":
          snapRef.current = m.j;
          snapTRef.current = Date.now();
          break;
        case "match":
          // un nouveau match remet les compteurs du serveur à zéro : les anciennes statistiques ne doivent pas s'afficher
          if (matchRef.current?.numero !== m.match.numero) {
            statsRef.current = STATS_VIDES;
            setStats(STATS_VIDES);
          }
          matchRef.current = m.match;
          setMatch(m.match);
          setClassement(m.match.phase === "entracte" ? m.classement : null);
          break;
        case "apparition":
          if (m.id === monIdRef.current) {
            setDerniereMort(null);
            setKillcamInfo(null);
            setDegatsAuTueur(0);
            degatsParCible.current.clear();
          }
          break;
        case "mort": {
          const trouve = (id: string) => joueursRef.current.find((j) => j.id === id);
          const par = trouve(m.par), cible = trouve(m.cible);
          const id = ++compteur.current;
          const entree: EntreeFil = {
            id, par: par?.pseudo ?? (m.par ? "Agent" : ""), parCouleur: par?.couleur ?? (m.par ? "#9be9ff" : ""),
            cible: cible?.pseudo ?? "Agent", cibleCouleur: cible?.couleur ?? "#9be9ff",
            arme: m.arme, cause: m.cause, tete: m.zone === "tete", moi: m.par === monIdRef.current || m.cible === monIdRef.current,
          };
          setFil((l) => [...l.slice(-(FIL_MAX - 1)), entree]);
          apres(DUREE_FIL_MS, () => setFil((l) => l.filter((x) => x.id !== id)));
          if (m.cible === monIdRef.current) {
            setKillcamInfo(m.tueur ?? null);
            setDegatsAuTueur(m.par ? degatsParCible.current.get(m.par) ?? 0 : 0);
          }
          break;
        }
        case "elsa":
          setElsa(m.elsa);
          if (m.evenement === "apparue" && m.elsa.offre) annoncer(`Elsa : ${contenuOffre(m.elsa.offre.genre, m.elsa.offre.arme)}`, "elsa");
          else if (m.evenement === "expiree") annoncer("Offre d'Elsa expirée", "elsa");
          break;
        case "ramassage":
          // le bénéficiaire a son toast (événement `bonus`) ; les autres lisent qui a pris le cadeau
          if (m.par !== monIdRef.current) {
            const j = joueursRef.current.find((x) => x.id === m.par);
            annoncer(`${j?.pseudo ?? "Un agent"} a pris le cadeau d'Elsa`, "elsa");
          }
          break;
        case "evenement": {
          // le bandeau du HUD lit l'état dans le jeu ; ici, les annonces du fil et de la région vive
          const nom = (id?: string) => joueursRef.current.find((x) => x.id === id)?.pseudo ?? "Un agent";
          if (m.phase === "annonce") annoncer(m.type === "truck" ? "Le Truck Muche est devenu fou !" : "Un tigre robot géant attaque Agroparc !", "info");
          else if (m.phase === "fin" && m.type === "tigre" && m.raison === "vaincu") annoncer(`${nom(m.par)} a abattu le tigre robot !`, "info");
          else if (m.phase === "fin" && m.type === "tigre") annoncer("Le tigre robot a quitté Agroparc", "info");
          else if (m.phase === "fin" && m.type === "truck") annoncer("Le Truck Muche s'est calmé", "info");
          break;
        }
        case "titan": {
          const nom = (id?: string) => joueursRef.current.find((x) => x.id === id)?.pseudo ?? "Un agent";
          if (m.phase === "debut") annoncer(m.pilote === monIdRef.current ? "Tu pilotes le TITAN TIGRE !" : `${nom(m.pilote)} pilote le TITAN TIGRE !`, "info");
          else if (m.phase === "fin" && m.raison === "detruit") annoncer(`${nom(m.par)} a détruit le titan de ${nom(m.pilote)} !`, "info");
          else if (m.phase === "fin" && m.raison === "temps") annoncer("Le titan tigre s'éteint", "info");
          break;
        }
        case "sieges":
          setSieges(m.vehicules);
          break;
        case "avion":
          if (m.evenement === "largage" && m.tigre) annoncer("Un tigre a été largué !", "tigre");
          break;
        case "tigre":
          // le fil des éliminations dit qui a abattu le tigre sauvage (le kill d'un joueur par un tigre arrive par `mort`)
          if (m.evenement === "mort" && m.genre === "sauvage" && m.par) {
            const j = joueursRef.current.find((x) => x.id === m.par);
            annoncer(`${m.par === monIdRef.current ? "Vous avez" : `${j?.pseudo ?? "Un agent"} a`} abattu le tigre`, "tigre");
          }
          break;
        case "sort":
          if (m.joueur !== monIdRef.current) break;
          if (m.evenement === "gagne") annoncer("Sort d'invocation gagné", "tigre");
          else if (m.evenement === "perdu" && m.raison === "mort") annoncer("Sort d'invocation perdu", "info");
          break;
        case "scores": {
          const carte = new Map(m.lignes.map((l) => [l.id, l]));
          statsRef.current = carte;
          setStats(carte);
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
        connexionPerdue.current = true;
      }
      // le serveur oublie l'état « tableau ouvert » d'une connexion perdue
      if (e !== "ouvert") scoresOuvert.current = false;
    };
    setEtat("connexion");
    connexionPerdue.current = false;
    const client = connecterArene(urlArene(), pseudoRef.current, surMessage, surEtat);
    clientRef.current = client;
    return () => {
      client.fermer();
      if (clientRef.current === client) clientRef.current = null;
      monIdRef.current = null;
      scoresOuvert.current = false;
      setMonId(null);
    };
  }, [jeuRef, apres, annoncer]);

  // Renommage à chaud (lobby comme en pleine partie) : la session et la partie restent ouvertes.
  useEffect(() => {
    clientRef.current?.renommer(pseudo);
  }, [pseudo]);

  useEffect(() => {
    const liste = minuteurs.current;
    return () => { liste.forEach(clearTimeout); liste.clear(); };
  }, []);

  return {
    etat, monId, joueurs, match, classement, fil, evenements, derniereMort, erreur, clientRef, snapRef, snapTRef, joueursRef, matchRef, pousserEvenement,
    elsa, annonces, sieges, bonus, killcamInfo,
    stats, statsRef, demanderScores, degatsAuTueur,
    mode, modeVoulu, salons, zombies, argent, gainArgent, choisirMode, lancerPartie,
  };
}
