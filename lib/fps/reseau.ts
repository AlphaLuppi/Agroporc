/**
 * Client réseau de l'arène FPS : WebSocket navigateur (file d'attente avant ouverture,
 * reconnexion avec backoff, ping 2 s → décalage d'horloge serveur) et interpolation des
 * joueurs distants. `Interpolateur` et `HorlogeServeur` sont PURS et testés ; seule
 * `connecterArene` touche au WebSocket (injectable pour les tests).
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md
 */

import type { EtatJoueurSnap, MessageClient, MessageServeur, Vec3 } from "./protocole";
import { ECART_GARDE_M, VERSION_PROTOCOLE } from "./protocole";

export type EtatConnexion = "connexion" | "ouvert" | "ferme" | "erreur";

export interface ClientArene {
  envoyer(m: MessageClient): void;
  fermer(): void;
  /** Change de pseudo sans se reconnecter ; le nouveau pseudo sert aussi au « bonjour » des reconnexions. */
  renommer(pseudo: string): void;
  readonly id: string | null;
  /** horloge serveur estimée (ms) : Date.now() + décalage mesuré par ping */
  maintenantServeur(): number;
}

// ---------- horloge ----------

/** Nombre de mesures de ping gardées pour choisir celle au RTT minimal. */
const MESURES_HORLOGE = 8;
/** Part de l'écart rattrapée à chaque nouvelle mesure (lissage). */
const LISSAGE_HORLOGE = 0.25;

/**
 * Décalage entre l'horloge locale et celle du serveur. Chaque pong donne une mesure
 * `serveur + rtt/2 − recu` ; la plus fiable est celle au RTT minimal (trajets symétriques),
 * le décalage la rejoint progressivement pour ne pas faire sauter l'interpolation.
 */
export class HorlogeServeur {
  /** ms à ajouter à l'horloge locale pour obtenir l'horloge serveur */
  decalage = 0;
  private mesures: { rtt: number; decalage: number }[] = [];
  private precis = false;

  /** Première estimation grossière (message « bienvenue », sans RTT) ; écrasée par la 1re mesure de ping. */
  amorcer(serveur: number, local: number): void {
    if (this.precis) return;
    this.decalage = serveur - local;
  }

  /** Mesure d'un aller-retour : `t0` envoyé (local), `serveur` lu dans le pong, `recu` = horloge locale à la réception. */
  ajouter(t0: number, serveur: number, recu: number): void {
    const rtt = Math.max(0, recu - t0);
    this.mesures.push({ rtt, decalage: serveur + rtt / 2 - recu });
    if (this.mesures.length > MESURES_HORLOGE) this.mesures.shift();
    let meilleure = this.mesures[0];
    for (const m of this.mesures) if (m.rtt < meilleure.rtt) meilleure = m;
    if (!this.precis) {
      this.precis = true;
      this.decalage = meilleure.decalage;
    } else {
      this.decalage += (meilleure.decalage - this.decalage) * LISSAGE_HORLOGE;
    }
  }

  /** RTT minimal parmi les dernières mesures (ms), ou null sans mesure. */
  rttMin(): number | null {
    if (!this.mesures.length) return null;
    return Math.min(...this.mesures.map((m) => m.rtt));
  }

  maintenant(local: number): number {
    return local + this.decalage;
  }
}

// ---------- WebSocket ----------

/** Sous-ensemble de WebSocket utilisé (permet d'injecter un faux socket dans les tests). */
/** Code de fermeture d'un départ volontaire (vue fermée, sortie du jeu), cf. `garderPourReprise` de salons.ts. */
export const CODE_DEPART_VOLONTAIRE = 1000;

export interface SocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  /** `code` 1000 : départ volontaire (le serveur ne garde pas la session pour une reprise) */
  close(code?: number): void;
}

export interface OptionsReseau {
  creerSocket?: (url: string) => SocketLike;
  /** horloge locale en ms (Date.now par défaut) */
  maintenant?: () => number;
}

const SOCKET_OUVERT = 1;
const BACKOFF_MS = [1000, 2000, 4000, 8000];
const PING_MS = 2000;
/** Messages durables gardés pendant une coupure (rejoindre, quitter, arme) ; les plus anciens sont jetés. */
const FILE_MAX = 64;

export function connecterArene(
  url: string,
  pseudo: string,
  surMessage: (m: MessageServeur) => void,
  surEtat: (e: EtatConnexion) => void,
  options: OptionsReseau = {},
): ClientArene {
  const creer = options.creerSocket ?? ((u: string) => new WebSocket(u) as unknown as SocketLike);
  const horlogeLocale = options.maintenant ?? (() => Date.now());
  const horloge = new HorlogeServeur();
  let socket: SocketLike | null = null;
  let id: string | null = null;
  /** (v8) dernière session (id + jeton de `bienvenue`) : la reconnexion demande à la reprendre (`bonjour.reprise`) */
  let session: { id: string; jeton: string } | null = null;
  let file: string[] = [];
  let tentatives = 0;
  let minuteurReconnexion: ReturnType<typeof setTimeout> | null = null;
  let minuteurPing: ReturnType<typeof setInterval> | null = null;
  let arrete = false;

  const arreterPing = () => {
    if (minuteurPing !== null) clearInterval(minuteurPing);
    minuteurPing = null;
  };

  const ecrire = (texte: string, perissable: boolean) => {
    if (socket && socket.readyState === SOCKET_OUVERT) {
      try { socket.send(texte); return; } catch { /* repli sur la file */ }
    }
    // Un état, un tir, un coup, une commande de conduite ou un ping de la coupure n'a plus de sens à la reconnexion (et 64 états rejoués
    // d'un coup avec le bonjour seraient en partie jetés par l'anti-flood du serveur, lib/fps/anti-flood.ts).
    if (perissable) return;
    file.push(texte);
    if (file.length > FILE_MAX) file.splice(0, file.length - FILE_MAX);
  };

  const reconnecter = () => {
    if (arrete || minuteurReconnexion !== null) return;
    const delai = BACKOFF_MS[Math.min(tentatives, BACKOFF_MS.length - 1)];
    tentatives++;
    minuteurReconnexion = setTimeout(() => {
      minuteurReconnexion = null;
      ouvrir();
    }, delai);
  };

  const ouvrir = () => {
    if (arrete) return;
    surEtat("connexion");
    let s: SocketLike;
    try {
      s = creer(url);
    } catch {
      surEtat("erreur");
      reconnecter();
      return;
    }
    socket = s;
    s.onopen = () => {
      if (s !== socket) return;
      tentatives = 0;
      // le « bonjour » ouvre toujours la session (en demandant à reprendre la précédente, v8), puis la file accumulée pendant la coupure
      s.send(JSON.stringify({ t: "bonjour", v: VERSION_PROTOCOLE, pseudo, ...(session ? { reprise: session } : {}) } satisfies MessageClient));
      const attente = file;
      file = [];
      for (const texte of attente) s.send(texte);
      surEtat("ouvert");
      arreterPing();
      const ping = () => {
        if (s.readyState === SOCKET_OUVERT) s.send(JSON.stringify({ t: "ping", t0: horlogeLocale() } satisfies MessageClient));
      };
      ping();
      minuteurPing = setInterval(ping, PING_MS);
    };
    s.onmessage = (ev) => {
      if (s !== socket || typeof ev.data !== "string") return;
      let m: MessageServeur;
      try {
        m = JSON.parse(ev.data) as MessageServeur;
      } catch {
        return;
      }
      if (!m || typeof m !== "object" || typeof m.t !== "string") return;
      if (m.t === "bienvenue") {
        id = m.id;
        // un changement de salle renvoie un `bienvenue` sans jeton : la session (et son jeton) reste celle de la connexion
        if (m.jeton) session = { id: m.id, jeton: m.jeton };
        else if (session && session.id !== m.id) session = null;
        horloge.amorcer(m.maintenant, horlogeLocale());
      } else if (m.t === "pong") {
        horloge.ajouter(m.t0, m.maintenant, horlogeLocale());
      } else if (m.t === "erreur" && m.code === "version") {
        arrete = true; // inutile de réessayer avec un protocole incompatible
      }
      surMessage(m);
    };
    s.onerror = () => {
      if (s !== socket) return;
      surEtat("erreur");
    };
    s.onclose = () => {
      if (s !== socket) return;
      socket = null;
      id = null;
      arreterPing();
      surEtat("ferme");
      reconnecter();
    };
  };

  ouvrir();

  return {
    envoyer(m) {
      ecrire(JSON.stringify(m), m.t === "etat" || m.t === "tir" || m.t === "coup" || m.t === "conduite" || m.t === "ping");
    },
    renommer(nouveau) {
      if (nouveau === pseudo) return;
      pseudo = nouveau;
      // périssable : pendant une coupure, le « bonjour » de la reconnexion porte déjà ce pseudo
      ecrire(JSON.stringify({ t: "pseudo", pseudo: nouveau } satisfies MessageClient), true);
    },
    fermer() {
      arrete = true;
      arreterPing();
      if (minuteurReconnexion !== null) clearTimeout(minuteurReconnexion);
      minuteurReconnexion = null;
      file = [];
      const s = socket;
      socket = null;
      id = null;
      if (s) {
        s.onopen = s.onmessage = s.onerror = s.onclose = null;
        // 1000 = départ volontaire : le serveur déconnecte tout de suite au lieu de garder la session (`REPRISE_MS`)
        try { s.close(CODE_DEPART_VOLONTAIRE); } catch { /* déjà fermé */ }
        surEtat("ferme");
      }
    },
    get id() {
      return id;
    },
    maintenantServeur() {
      return horloge.maintenant(horlogeLocale());
    },
  };
}

// ---------- apparition ----------

/**
 * (v8) Le joueur local garde-t-il sa position à cette apparition ? Jamais pour une vraie apparition. Pour une apparition `garder` : toujours
 * s'il est debout chez lui (reprise après une coupure : il a continué de bouger, la position serveur le rattrape par le budget de distance),
 * et pour une relève (à terre chez lui) s'il est à moins de `ECART_GARDE_M` de la position serveur, qui a suivi son corps ; au-delà (écart
 * anormal, états perdus), il se replace sur celle du serveur.
 */
export function gardePosition(m: { p: Vec3; garder?: true }, actuelle: Vec3, deboutLocal = false): boolean {
  if (m.garder !== true) return false;
  if (deboutLocal) return true;
  return Math.hypot(actuelle[0] - m.p[0], actuelle[1] - m.p[1], actuelle[2] - m.p[2]) <= ECART_GARDE_M;
}

// ---------- interpolation ----------

/** Durée d'historique gardée par défaut (ms) ; le client en garde deux : celle-ci (affichage) et `KILLCAM.tamponMs` (rejeu). */
const TAMPON_MS = 1000;
/** Au-delà de ce retard du tampon, on extrapole au plus pendant cette durée (ms). */
const EXTRAPOLATION_MAX_MS = 150;
/** Écart entre deux snaps consécutifs au-delà duquel c'est une téléportation (réapparition) : pas d'interpolation (m). */
const SAUT_TELEPORTATION_M = 12;

/** Interpolation d'angle par le plus court chemin (rad). */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function copie(e: EtatJoueurSnap): EtatJoueurSnap {
  const c = { ...e, p: [...e.p] as Vec3, v: [...e.v] as Vec3 };
  if (e.vehicule) c.vehicule = { ...e.vehicule };
  return c;
}

type Snap = { ts: number; j: EtatJoueurSnap[] };

/**
 * Tampon d'instantanés ordonnés par `ts` (`tamponMs`, 1 s par défaut ; 4 s pour la killcam). `echantillon(ts)` donne l'état des joueurs
 * à l'horodatage serveur demandé (en pratique `maintenantServeur() − JEU.interpolationMs`) :
 * positions interpolées linéairement, angles par le plus court chemin, extrapolation bornée
 * à 150 ms quand le tampon est en retard. Un joueur absent du dernier snap est retiré.
 */
export class Interpolateur {
  private snaps: Snap[] = [];

  constructor(private readonly tamponMs: number = TAMPON_MS) {}

  ajouter(snap: Snap): void {
    const s: Snap = { ts: snap.ts, j: snap.j };
    // insertion ordonnée (les paquets peuvent arriver dans le désordre) ; même ts = remplacement
    let i = this.snaps.length;
    while (i > 0 && this.snaps[i - 1].ts > s.ts) i--;
    if (i > 0 && this.snaps[i - 1].ts === s.ts) this.snaps[i - 1] = s;
    else this.snaps.splice(i, 0, s);
    const limite = this.snaps[this.snaps.length - 1].ts - this.tamponMs;
    while (this.snaps.length > 2 && this.snaps[0].ts < limite) this.snaps.shift();
  }

  vider(): void {
    this.snaps = [];
  }

  echantillon(tsServeur: number): Map<string, EtatJoueurSnap> {
    const res = new Map<string, EtatJoueurSnap>();
    const n = this.snaps.length;
    if (!n) return res;
    const dernier = this.snaps[n - 1];

    // tampon en retard : dernier état connu prolongé par sa vitesse, sur 150 ms au plus
    if (tsServeur >= dernier.ts) {
      const dt = Math.min(tsServeur - dernier.ts, EXTRAPOLATION_MAX_MS) / 1000;
      for (const e of dernier.j) {
        const c = copie(e);
        if (e.vivant && dt > 0) c.p = [e.p[0] + e.v[0] * dt, e.p[1] + e.v[1] * dt, e.p[2] + e.v[2] * dt];
        res.set(e.id, c);
      }
      return res;
    }

    // trouve b = premier snap après tsServeur, a = celui d'avant
    let ib = 0;
    while (ib < n && this.snaps[ib].ts <= tsServeur) ib++;
    const b = this.snaps[ib];
    const a = ib > 0 ? this.snaps[ib - 1] : null;

    // avant le plus ancien snap : on tient la position la plus ancienne connue
    if (!a) {
      for (const e of b.j) if (dernier.j.some((x) => x.id === e.id)) res.set(e.id, copie(e));
      return res;
    }

    const parIdA = new Map<string, EtatJoueurSnap>();
    for (const e of a.j) parIdA.set(e.id, e);
    const t = b.ts > a.ts ? (tsServeur - a.ts) / (b.ts - a.ts) : 1;

    for (const eb of b.j) {
      if (!dernier.j.some((x) => x.id === eb.id)) continue; // parti depuis : retiré
      const ea = parIdA.get(eb.id);
      if (!ea) {
        res.set(eb.id, copie(eb)); // vient d'apparaître dans b
        continue;
      }
      const saut = Math.hypot(eb.p[0] - ea.p[0], eb.p[1] - ea.p[1], eb.p[2] - ea.p[2]);
      if (saut > SAUT_TELEPORTATION_M) {
        res.set(eb.id, copie(t < 0.5 ? ea : eb));
        continue;
      }
      const base = copie(t < 0.5 ? ea : eb); // champs discrets (posture, arme, pv…) du snap le plus proche
      base.p = lerpVec(ea.p, eb.p, t);
      base.v = lerpVec(ea.v, eb.v, t);
      base.lacet = lerpAngle(ea.lacet, eb.lacet, t);
      base.tangage = ea.tangage + (eb.tangage - ea.tangage) * t;
      res.set(eb.id, base);
    }
    return res;
  }
}

// ---------- URL ----------

/**
 * `NEXT_PUBLIC_FPS_WS_URL`, sinon le serveur local en dev, sinon le serveur de prod. La v2 REMPLACE la v1 sur le même hôte
 * (`wss://pdj-fps.toam.tech`) : client et serveur sont déployés ensemble ; un client v1 encore en cache reçoit `erreur version`
 * (« rechargez la page »).
 */
export function urlArene(): string {
  const env = process.env.NEXT_PUBLIC_FPS_WS_URL;
  if (env) return env;
  if (typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    return "ws://localhost:8787";
  }
  return "wss://pdj-fps.toam.tech";
}
