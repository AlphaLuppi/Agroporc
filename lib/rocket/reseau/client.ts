/**
 * Rocket Muche EN LIGNE : client WebSocket (lot CLIENT). Connexion à `urlRocket()`, `bonjour`, ping réguliers, décodage des trames binaires
 * (instantanés), reconnexion avec reprise pendant `RESEAU.repriseMs` (attentes 0,5 / 1 / 2 / 2 s…). AUCUNE logique de jeu : le prédicteur, l'horloge
 * et l'interface écoutent ce client (`ecouter`).
 *
 * Chargé par `import()` (hook `useSalonRocket`, `jeu.ts`) : il importe `serialisation` et n'a rien à faire dans le premier chargement du menu.
 * L'heure (`maintenant`), les minuteurs et la socket sont injectables : les tests ne touchent ni réseau ni horloge.
 *
 * `pong.c` est l'instant d'envoi du ping lu sur la même horloge que `maintenant` (par défaut `performance.now()`) : l'écouteur calcule le RTT en
 * soustrayant `c` à sa propre lecture de cette horloge (c'est ce que fait `HorlogeRocket.echantillonPong(envoyeMs = c, recuMs, …)`).
 * Spec : docs/superpowers/specs/2026-11-08-rocket-en-ligne-design.md § 3, § 5.1, § 11.
 */
import { decoderSnap, encoderTrameEntrees, typeDeTrame } from "./serialisation";
import {
  CHEMIN_ROCKET, CODE_BONJOUR, CODE_DEPART_VOLONTAIRE, CODE_FLOOD, CODE_REMPLACE, CODE_TROP_DE_CONNEXIONS, CODE_VERSION, RESEAU, TRAME_SNAP, VERSION_ROCKET,
  type ClientRocket, type EcouteursClientRocket, type EtatConnexion, type MessageClient, type MessageServeur, type OptionsClientRocket, type ReprisePossible,
  type SocketRocket, type TrameEntrees, type UrlRocket,
} from "./protocole";
import type { RaisonFermeture } from "./lobby-en-ligne";

/** Attentes entre deux tentatives de reconnexion (ms) : 0,5 / 1 / 2 puis 2 s jusqu'à la fin du délai de reprise. */
export const ATTENTES_RECONNEXION_MS: readonly number[] = [500, 1000, 2000, 2000];
/** `WebSocket.OPEN` (la constante globale n'existe pas hors navigateur). */
const SOCKET_OUVERTE = 1;
/** Messages mis en file tant que la première connexion n'est pas ouverte (au-delà, les plus anciens sont jetés). */
const FILE_MAX = 16;

/** `ClientRocket` plus ce que l'interface sait en plus du contrat : pourquoi la connexion est fermée, mon id de joueur. */
export interface ClientRocketEtendu extends ClientRocket {
  /** pourquoi la connexion est fermée ou refusée (null tant qu'elle vit) */
  raisonFermeture(): RaisonFermeture | null;
  /** relance une connexion après `fermee` / `refusee` (bouton « Réessayer ») : remet les compteurs à zéro */
  reessayer(): void;
  /** met à jour la reprise (l'interface la mémorise ailleurs ; le client la rejoue au prochain `bonjour`) */
  definirReprise(r: ReprisePossible | null): void;
  /** essais seulement : la socket meurt comme sur une coupure réseau (code non volontaire), le client tente la reprise */
  couperSocket(): void;
}

/** URL du serveur Rocket (cf. `UrlRocket` du contrat). */
export const urlRocket: UrlRocket = () => {
  const ajouterChemin = (base: string): string => {
    const propre = base.replace(/\/+$/, "");
    return propre.endsWith(CHEMIN_ROCKET) ? propre : `${propre}${CHEMIN_ROCKET}`;
  };
  const dediee = process.env.NEXT_PUBLIC_ROCKET_WS_URL;
  if (dediee) return ajouterChemin(dediee);
  const arene = process.env.NEXT_PUBLIC_FPS_WS_URL;
  if (arene) return ajouterChemin(arene);
  if (typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) return ajouterChemin("ws://localhost:8787");
  return ajouterChemin("wss://pdj-fps.toam.tech");
};

const horlogeParDefaut = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Octets d'un message binaire reçu (ArrayBuffer ou vue typée), null pour tout autre type (texte, Blob). */
function octetsDe(donnees: unknown): Uint8Array | null {
  if (donnees instanceof ArrayBuffer) return new Uint8Array(donnees);
  if (ArrayBuffer.isView(donnees)) return new Uint8Array(donnees.buffer, donnees.byteOffset, donnees.byteLength);
  return null;
}

/** Message texte du serveur : un objet JSON avec un discriminant `t` chaîne, sinon ignoré. */
function lireTexte(texte: string): MessageServeur | null {
  try {
    const o: unknown = JSON.parse(texte);
    if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
    return typeof (o as { t?: unknown }).t === "string" ? (o as MessageServeur) : null;
  } catch {
    return null;
  }
}

export function creerClientRocket(opts: OptionsClientRocket): ClientRocketEtendu {
  const maintenant = opts.maintenant ?? horlogeParDefaut;
  const creerSocket = opts.creerSocket ?? ((u: string): SocketRocket => new WebSocket(u) as unknown as SocketRocket);
  const lancerMinuteur = opts.setInterval ?? ((f: () => void, ms: number): unknown => setInterval(f, ms));
  const stopperMinuteur = opts.clearInterval ?? ((id: unknown): void => clearInterval(id as ReturnType<typeof setInterval>));
  const url = opts.url ?? urlRocket();

  const ecouteurs = new Set<EcouteursClientRocket>();
  let socket: SocketRocket | null = null;
  let etat: EtatConnexion = "connexion";
  let raison: RaisonFermeture | null = null;
  let session: ReprisePossible | null = null;
  let reprise: ReprisePossible | null = opts.reprise ?? null;
  let ferme = false;
  /** la connexion a été ouverte au moins une fois (distingue un serveur injoignable d'une coupure) */
  let dejaOuverte = false;
  /** le `bienvenue` de la socket courante est arrivé (sinon la fermeture est celle d'un serveur qui ne parle pas Rocket) */
  let bienvenueRecu = false;
  /** un `bienvenue` est arrivé au moins une fois sur ce client (jamais remis à zéro) */
  let bienvenueDejaRecu = false;
  let rttBrut = 0;
  let enMatch = false;
  let minuteurPing: unknown = null;
  let intervallePing = 0;
  /** instant de la première coupure de la série en cours (null : connecté) */
  let coupeA: number | null = null;
  let tentative = 0;
  let minuteurReconnexion: ReturnType<typeof setTimeout> | null = null;
  const file: MessageClient[] = [];

  const diffuser = (f: (e: EcouteursClientRocket) => void): void => {
    for (const e of Array.from(ecouteurs)) {
      try { f(e); } catch (err) { if (process.env.NODE_ENV !== "production") console.error("rocket client : écouteur", err); }
    }
  };
  const changerEtat = (e: EtatConnexion): void => {
    if (e === etat) return;
    etat = e;
    diffuser((x) => x.etat?.(e));
  };

  const envoyerTexte = (m: MessageClient): void => {
    if (socket && socket.readyState === SOCKET_OUVERTE) {
      try { socket.send(JSON.stringify(m)); } catch { /* la socket est en train de mourir : onclose s'en charge */ }
    }
  };

  // ---------- ping ----------
  const pinger = (): void => envoyerTexte({ t: "ping", c: maintenant() });
  function regler(): void {
    const voulu = enMatch ? RESEAU.pingMatchMs : RESEAU.pingSalonMs;
    if (minuteurPing !== null && voulu === intervallePing) return;
    if (minuteurPing !== null) stopperMinuteur(minuteurPing);
    intervallePing = voulu;
    minuteurPing = lancerMinuteur(pinger, voulu);
  }
  function arreterPing(): void {
    if (minuteurPing !== null) stopperMinuteur(minuteurPing);
    minuteurPing = null;
    intervallePing = 0;
  }

  // ---------- connexion ----------
  function detacher(s: SocketRocket): void {
    s.onopen = null;
    s.onmessage = null;
    s.onclose = null;
    s.onerror = null;
  }

  function ouvrir(): void {
    if (ferme) return;
    let s: SocketRocket;
    try {
      s = creerSocket(url);
    } catch {
      surPerte(0, false);
      return;
    }
    socket = s;
    bienvenueRecu = false;
    let ouverteIci = false;
    try { s.binaryType = "arraybuffer"; } catch { /* socket factice sans binaryType modifiable */ }
    s.onopen = () => {
      if (s !== socket) return;
      ouverteIci = true;
      dejaOuverte = true;
      // premier message : `bonjour`, avec la reprise de la session coupée s'il y en a une
      const bonjour: MessageClient = { t: "bonjour", v: VERSION_ROCKET, nom: opts.nom, ...(reprise ? { reprise: { code: reprise.code, joueur: reprise.joueur, jeton: reprise.jeton } } : {}) };
      envoyerTexte(bonjour);
      coupeA = null;
      tentative = 0;
      raison = null;
      changerEtat("ouverte");
      regler();
      pinger();
      // messages demandés avant l'ouverture : envoyés après le `bonjour`
      for (const m of file.splice(0)) envoyerTexte(m);
    };
    s.onmessage = (e) => {
      if (s !== socket) return;
      const octets = octetsDe(e.data);
      if (octets) {
        if (octets.length === 0 || typeDeTrame(octets) !== TRAME_SNAP) return;
        const snap = decoderSnap(octets);
        if (snap) diffuser((x) => x.snap?.(snap));
        return;
      }
      if (typeof e.data !== "string") return;
      const m = lireTexte(e.data);
      if (m) traiter(m);
    };
    s.onerror = () => { /* onclose suit toujours : c'est lui qui décide */ };
    s.onclose = (e) => {
      if (s !== socket) return;
      socket = null;
      arreterPing();
      surPerte(e?.code ?? 1006, ouverteIci);
    };
  }

  function traiter(m: MessageServeur): void {
    switch (m.t) {
      case "bienvenue":
        bienvenueRecu = true;
        bienvenueDejaRecu = true;
        break;
      case "session":
        session = { code: m.code, joueur: m.joueur, jeton: m.jeton };
        reprise = session;
        break;
      case "reprise":
        // reprise refusée : on l'oublie ; acceptée, `session` suit
        if (m.code === null) { reprise = null; session = null; }
        break;
      case "salon":
        if (m.salon === null) { session = null; reprise = null; }
        if (m.salon) { enMatch = m.salon.phase === "match" || m.salon.phase === "chargement"; regler(); }
        break;
      case "debut":
        enMatch = true;
        regler();
        // une mesure de RTT toute fraîche pour caler l'horloge du nouveau match
        pinger();
        break;
      case "fin":
        enMatch = false;
        regler();
        break;
      case "pong":
        rttBrut = Math.max(0, maintenant() - m.c);
        break;
      case "erreur":
        if (m.code === "version") { raison = "version"; changerEtat("refusee"); }
        break;
      default:
        break;
    }
    diffuser((x) => x.message?.(m));
    // un serveur qui répond par une erreur de version ne reviendra pas : on ferme sans reconnexion
    if (m.t === "erreur" && m.code === "version") {
      ferme = true;
      cesser(CODE_DEPART_VOLONTAIRE);
    }
  }

  function cesser(code: number): void {
    arreterPing();
    if (minuteurReconnexion !== null) { clearTimeout(minuteurReconnexion); minuteurReconnexion = null; }
    const s = socket;
    socket = null;
    if (s) { detacher(s); try { s.close(code); } catch { /* déjà fermée */ } }
  }

  /** La socket s'est fermée (ou n'a jamais pu s'ouvrir) : décide entre reconnexion, refus et fermeture. */
  function surPerte(code: number, ouverteIci: boolean): void {
    if (ferme) { if (etat !== "refusee") changerEtat("fermee"); return; }
    // codes explicites d'abord : un serveur plein (1013) ferme juste après la poignée de main, avant tout `bienvenue`
    if (code === CODE_TROP_DE_CONNEXIONS) { ferme = true; raison = "plein"; changerEtat("refusee"); return; }
    // un `bienvenue` déjà reçu un jour prouve que le serveur parle Rocket : une socket de reprise qui tombe avant le sien n'est pas une erreur de version
    if (code === CODE_VERSION || (ouverteIci && !bienvenueRecu && !bienvenueDejaRecu && code !== CODE_BONJOUR)) {
      // un serveur d'arène non mis à jour (ou une page périmée) ferme avant tout `bienvenue` de Rocket
      ferme = true;
      raison = "version";
      changerEtat("refusee");
      return;
    }
    if (code === CODE_REMPLACE) { ferme = true; raison = "remplacee"; changerEtat("fermee"); return; }
    if (code === CODE_FLOOD) { ferme = true; raison = "coupure"; changerEtat("fermee"); return; }
    if (!dejaOuverte) {
      // la toute première connexion n'a jamais abouti : serveur injoignable, inutile d'insister
      ferme = true;
      raison = "injoignable";
      changerEtat("fermee");
      return;
    }
    const maintenantMs = maintenant();
    if (coupeA === null) coupeA = maintenantMs;
    if (maintenantMs - coupeA >= RESEAU.repriseMs) {
      ferme = true;
      raison = "coupure";
      changerEtat("fermee");
      return;
    }
    changerEtat("reconnexion");
    const attente = ATTENTES_RECONNEXION_MS[Math.min(tentative, ATTENTES_RECONNEXION_MS.length - 1)];
    tentative++;
    minuteurReconnexion = setTimeout(() => {
      minuteurReconnexion = null;
      ouvrir();
    }, attente);
  }

  return {
    connecter() {
      if (socket || minuteurReconnexion !== null || etat === "ouverte") return;
      ferme = false;
      ouvrir();
    },
    fermer() {
      ferme = true;
      file.length = 0;
      const etaitOuvert = !!socket;
      cesser(CODE_DEPART_VOLONTAIRE);
      if (etat !== "refusee" || etaitOuvert) changerEtat("fermee");
    },
    envoyer(m) {
      if (m.t === "quitter") { session = null; reprise = null; }
      if (ferme) return;
      if (socket && socket.readyState === SOCKET_OUVERTE) envoyerTexte(m);
      else if (etat === "connexion") {
        file.push(m);
        if (file.length > FILE_MAX) file.shift();
      }
    },
    envoyerTrame(t: Readonly<TrameEntrees>) {
      if (!socket || socket.readyState !== SOCKET_OUVERTE) return;
      try { socket.send(encoderTrameEntrees(t)); } catch { /* socket mourante */ }
    },
    ecouter(e) {
      ecouteurs.add(e);
      return () => { ecouteurs.delete(e); };
    },
    etat: () => etat,
    session: () => session,
    rttBrutMs: () => rttBrut,
    raisonFermeture: () => raison,
    definirReprise(r) { reprise = r; },
    couperSocket() {
      const s = socket;
      if (!s) return;
      try { s.close(4999, "essai"); } catch { /* déjà fermée */ }
    },
    reessayer() {
      if (etat !== "fermee" && etat !== "refusee") return;
      cesser(CODE_DEPART_VOLONTAIRE);
      ferme = false;
      dejaOuverte = false;
      coupeA = null;
      tentative = 0;
      raison = null;
      changerEtat("connexion");
      ouvrir();
    },
  };
}

// Vérifie à la compilation que la fonction respecte le contrat.
const _verif: (o: OptionsClientRocket) => ClientRocket = creerClientRocket;
void _verif;
