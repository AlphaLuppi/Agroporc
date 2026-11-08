/**
 * Rocket Muche EN LIGNE, côté serveur : l'hébergement des salles (`lib/rocket/reseau/salle.ts`, pures) sur une WebSocket `/rocket` du même
 * serveur HTTP que l'arène. Ce module est le SEUL à connaître les sockets, les jetons de reprise et l'horloge CPU ; la physique, le lobby et les
 * bots sont dans la salle (pure, sans horloge globale), la forme des messages dans `validation.ts`, l'anti-flood dans `limiteur.ts`, les codes
 * et les plafonds de salles dans `registre.ts`.
 *
 * Ce qu'il fait : `upgrade` d'un chemin `/rocket` (origine vérifiée comme pour l'arène), plafonds de connexions (adresse par `ipClient`, jamais le
 * premier `x-forwarded-for`), poignée de main `bonjour` (version, reprise), jetons de reprise (`crypto.randomBytes`, comparés en temps constant,
 * une reprise valide ferme l'ancienne socket avec `CODE_REMPLACE`), routage des messages et des trames d'entrées vers la salle du joueur, boucle
 * à 8 ms avec budget de pas partagé entre salles, encodage et envoi des instantanés avec contre-pression, ping protocolaire, mesure du coût CPU
 * (`ticMaxMs`), bloc `/sante.rocket`.
 * Spec : docs/superpowers/specs/2026-11-08-rocket-en-ligne-design.md (§ 3 transport, § 4.1 boucle, § 6 reprise, § 7 abus, § 8 intégration).
 * L'arène n'est pas touchée : compteurs, boucle et limites de Rocket sont distincts.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { ipClient } from "../../lib/fps/ip-client";
import { admettreRocket, creerLimiteur } from "../../lib/rocket/reseau/limiteur";
import {
  CODE_ARRET_SERVEUR, CODE_BONJOUR, CODE_DEPART_VOLONTAIRE, CODE_FLOOD, CODE_REMPLACE, CODE_TROP_DE_CONNEXIONS, CODE_VERSION, RESEAU, TRAME_ENTREES,
  VERSION_ROCKET,
} from "../../lib/rocket/reseau/protocole";
import type {
  ClasseMessage, EtatLimiteur, MessageClient, MessageServeur, RaisonRefus, SalleRocket, SanteRocket, ServeurRocket, SortieSalle, TypeMessageClient,
} from "../../lib/rocket/reseau/protocole";
import { creerRegistreRocket } from "../../lib/rocket/reseau/registre";
import { creerSalleRocket } from "../../lib/rocket/reseau/salle";
import { decoderTrameEntrees, encoderSnap, typeDeTrame } from "../../lib/rocket/reseau/serialisation";
import { TYPES_CLIENT, lireMessageClient } from "../../lib/rocket/reseau/validation";

export interface OptionsServeurRocket {
  /** origine d'une requête `Origin` (filtre `ORIGINES` de l'arène, partagé) : faux = refus 401 de l'`upgrade` */
  origineAutorisee: (origine: string | undefined) => boolean;
  /** environnement lu pour les variables `PDJ_ROCKET_*` (défaut `process.env`, injectable pour les essais) */
  env?: Readonly<Record<string, string | undefined>>;
}

/** Entier strictement positif lu dans l'environnement, `defaut` si absent ou invalide. */
function entierEnv(env: Readonly<Record<string, string | undefined>>, nom: string, defaut: number): number {
  const n = Number(env[nom]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaut;
}
/** Entier strictement positif lu dans l'environnement, undefined si absent ou invalide. */
function entierEnvOuNul(env: Readonly<Record<string, string | undefined>>, nom: string): number | undefined {
  const n = Number(env[nom]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** Une durée de wake (tout le minuteur : tics + encodage + envois) plus longue que ça est « lente » (spec § 4.1). */
const TIC_LENT_MS = 4;
/** `/sante.rocket.ticMaxMs` couvre la dernière minute (deux fenêtres de 60 s glissées l'une sur l'autre), comme l'arène. */
const FENETRE_TIC_MS = 60_000;

interface Connexion {
  ws: WebSocket;
  ip: string;
  /** identifiant du joueur (unique pour le serveur, repris tel quel par une reprise) */
  joueur: number;
  nom: string;
  /** `bonjour` reçu et accepté */
  accueilli: boolean;
  salle: SalleRocket | null;
  limiteur: EtatLimiteur;
  /** dernier pong protocolaire reçu (ms, horloge monotone) */
  dernierPongT: number;
  /** une reprise a pris sa place : sa fermeture ne doit pas retirer le joueur de la salle */
  remplacee: boolean;
  minuteurBonjour: NodeJS.Timeout | null;
}

export function creerServeurRocket(options: OptionsServeurRocket): ServeurRocket {
  const env = options.env ?? process.env;
  const actif = env.PDJ_ROCKET !== "off";
  const connexionsParIpMax = entierEnv(env, "PDJ_ROCKET_CONNEXIONS_IP", RESEAU.connexionsParIp);
  const connexionsTotalMax = entierEnv(env, "PDJ_ROCKET_CONNEXIONS_TOTAL", RESEAU.connexionsTotal);
  const matchsMax = entierEnv(env, "PDJ_ROCKET_MATCHS_MAX", RESEAU.matchsMax);
  const chargementMaxMs = entierEnvOuNul(env, "PDJ_ROCKET_CHARGEMENT_MS");
  const repriseMs = entierEnvOuNul(env, "PDJ_ROCKET_REPRISE_MS");
  const revancheMs = entierEnvOuNul(env, "PDJ_ROCKET_REVANCHE_MS");
  const dev = env.PDJ_ROCKET_DEV === "1";
  const horloge = (): number => performance.now();

  const registre = creerRegistreRocket({
    sallesMax: entierEnv(env, "PDJ_ROCKET_SALLES_MAX", RESEAU.sallesMax),
    matchsMax,
    sallesParIp: entierEnv(env, "PDJ_ROCKET_SALLES_IP", RESEAU.sallesParIp),
    // la graine ne sert qu'à tirer des codes (un code n'est pas un secret) et les graines de salles
    graine: randomBytes(4).readUInt32LE(0),
    ...(dev ? { dev: true } : {}),
    ...(entierEnvOuNul(env, "PDJ_ROCKET_HUMAINS_MIN") !== undefined ? { humainsMin: entierEnvOuNul(env, "PDJ_ROCKET_HUMAINS_MIN") } : {}),
    ...(entierEnvOuNul(env, "PDJ_ROCKET_DUREE_S") !== undefined ? { dureeForceeS: entierEnvOuNul(env, "PDJ_ROCKET_DUREE_S") } : {}),
    // les délais d'essai (chargement, reprise, revanche) ne passent pas par les options du registre : on les ajoute en habillant la fabrique
    creerSalle: (opts) => creerSalleRocket({
      ...opts,
      ...(chargementMaxMs !== undefined ? { chargementMaxMs } : {}),
      ...(repriseMs !== undefined ? { repriseMs } : {}),
      ...(revancheMs !== undefined ? { revancheMs } : {}),
    }),
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: RESEAU.tailleMaxTexteOctets,
    verifyClient: ({ origin }: { origin: string }) => options.origineAutorisee(origin),
  });

  const connexions = new Set<Connexion>();
  const parIp = new Map<string, number>();
  /** connexion VIVANTE de chaque joueur (absent : joueur coupé, en reprise) */
  const parJoueur = new Map<number, Connexion>();
  /** connexions vivantes de chaque salle (code → ensemble) */
  const membres = new Map<string, Set<Connexion>>();
  /** jetons de reprise (code → joueur → 16 octets) */
  const jetons = new Map<string, Map<number, Buffer>>();
  let compteurJoueurs = 0;

  const mesures = { octetsEmis: 0, octetsRecus: 0, snapsSautes: 0, socketsRemplacees: 0, entreesTardives: 0, entreesRepetees: 0, tempsAbandonneMs: 0 };
  const dernieresMesures = new WeakMap<SalleRocket, { t: number; r: number; a: number }>();
  const tic = { depuis: horloge(), maxFenetre: 0, maxPrecedente: 0, lents: 0 };
  let rotation = 0;

  // ------------------------------------------------------------------------------------------------------------------------------
  // Envoi
  // ------------------------------------------------------------------------------------------------------------------------------

  /** Coupe une socket qui n'absorbe plus ce qu'on lui envoie. Rend vrai si elle est coupée. */
  function saturee(c: Connexion): boolean {
    if (c.ws.bufferedAmount > RESEAU.bufferCoupureOctets) { c.ws.terminate(); return true; }
    return false;
  }
  function envoyerTexteBrut(c: Connexion, texte: string): void {
    if (c.ws.readyState !== c.ws.OPEN || saturee(c)) return;
    mesures.octetsEmis += Buffer.byteLength(texte);
    c.ws.send(texte);
  }
  function envoyer(c: Connexion, m: MessageServeur): void {
    envoyerTexteBrut(c, JSON.stringify(m));
  }
  function refuser(c: Connexion, action: TypeMessageClient, raison: RaisonRefus): void {
    envoyer(c, { t: "refus", action, raison });
  }
  function envoyerSnap(c: Connexion, octets: Uint8Array): void {
    if (c.ws.readyState !== c.ws.OPEN || saturee(c)) return;
    // un instantané est complet : un client en retard n'a besoin que du suivant
    if (c.ws.bufferedAmount > RESEAU.bufferSauteSnapOctets) { mesures.snapsSautes++; return; }
    mesures.octetsEmis += octets.byteLength;
    c.ws.send(octets);
  }
  function erreurEtFermer(c: Connexion, code: Extract<MessageServeur, { t: "erreur" }>["code"], message: string, codeFermeture: number): void {
    envoyer(c, { t: "erreur", code, message });
    c.ws.close(codeFermeture, message.slice(0, 100));
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // Jetons de reprise et appartenance aux salles
  // ------------------------------------------------------------------------------------------------------------------------------

  function emettreJeton(c: Connexion, code: string): void {
    const jeton = randomBytes(16);
    let table = jetons.get(code);
    if (!table) { table = new Map(); jetons.set(code, table); }
    table.set(c.joueur, jeton);
    envoyer(c, { t: "session", code, joueur: c.joueur, jeton: jeton.toString("hex") });
  }
  function jetonValide(code: string, joueur: number, hex: string): boolean {
    const attendu = jetons.get(code)?.get(joueur);
    if (!attendu) return false;
    const recu = Buffer.from(hex, "hex");
    return recu.length === attendu.length && timingSafeEqual(recu, attendu);
  }
  function revoquerJeton(code: string, joueur: number): void {
    const table = jetons.get(code);
    if (!table) return;
    table.delete(joueur);
    if (table.size === 0) jetons.delete(code);
  }
  function joindre(c: Connexion, salle: SalleRocket): void {
    c.salle = salle;
    let ens = membres.get(salle.code);
    if (!ens) { ens = new Set(); membres.set(salle.code, ens); }
    ens.add(c);
  }
  function detacher(c: Connexion): void {
    if (c.salle) {
      const ens = membres.get(c.salle.code);
      if (ens) { ens.delete(c); if (ens.size === 0) membres.delete(c.salle.code); }
    }
    c.salle = null;
  }
  /** Le joueur figure encore dans la salle (sinon : parti, ou remplacé par un bot) : sa reprise n'a plus d'objet. */
  const presentDansLaSalle = (salle: SalleRocket, joueur: number): boolean => salle.etat().joueurs.some((j) => j.id === joueur);

  /** Oublie une salle déjà retirée du registre : prévient ses joueurs encore connectés, efface jetons et appartenances. */
  function liquider(salle: SalleRocket, raison: "expire" | "ferme"): void {
    absorberMesures(salle);
    for (const c of Array.from(membres.get(salle.code) ?? [])) {
      envoyer(c, { t: "salon", salon: null, raison });
      detacher(c);
    }
    membres.delete(salle.code);
    jetons.delete(salle.code);
  }

  /** Cumule dans `/sante` les compteurs d'une salle (différences depuis la dernière lecture : ils peuvent repartir de zéro avec un match). */
  function absorberMesures(salle: SalleRocket): void {
    const m = salle.mesures();
    const avant = dernieresMesures.get(salle) ?? { t: 0, r: 0, a: 0 };
    mesures.entreesTardives += m.entreesTardives >= avant.t ? m.entreesTardives - avant.t : m.entreesTardives;
    mesures.entreesRepetees += m.entreesRepetees >= avant.r ? m.entreesRepetees - avant.r : m.entreesRepetees;
    mesures.tempsAbandonneMs += m.tempsAbandonneMs >= avant.a ? m.tempsAbandonneMs - avant.a : m.tempsAbandonneMs;
    dernieresMesures.set(salle, { t: m.entreesTardives, r: m.entreesRepetees, a: m.tempsAbandonneMs });
  }

  /** Envoie les sorties d'une salle à leurs destinataires (texte sérialisé une fois pour « tous », instantanés encodés par joueur). */
  function diffuser(salle: SalleRocket, sorties: readonly SortieSalle[]): void {
    for (const s of sorties) {
      if ("snap" in s) {
        const c = parJoueur.get(s.a);
        if (c && c.salle === salle) envoyerSnap(c, encoderSnap(s.snap));
        continue;
      }
      const m = s.msg;
      // la salle a remplacé un joueur par un bot, ou l'a rayé : son jeton ne sert plus
      if (m.t === "presence" && (m.etat === "bot" || m.etat === "parti")) revoquerJeton(salle.code, m.joueur);
      if (s.a === "tous") {
        const ens = membres.get(salle.code);
        if (!ens || ens.size === 0) continue;
        const texte = JSON.stringify(m);
        for (const c of ens) envoyerTexteBrut(c, texte);
      } else {
        const c = parJoueur.get(s.a);
        if (c && c.salle === salle) envoyer(c, m);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------------------------------------------------------------------

  function traiterBonjour(c: Connexion, m: Extract<MessageClient, { t: "bonjour" }>, maintenantMs: number): void {
    c.accueilli = true;
    c.nom = m.nom;
    if (c.minuteurBonjour) { clearTimeout(c.minuteurBonjour); c.minuteurBonjour = null; }
    // reprise : avant d'annoncer l'identité, qui est celle de la place retrouvée
    let reprise: { salle: SalleRocket; ancienne: Connexion | undefined } | null = null;
    if (m.reprise) {
      const { code, joueur, jeton } = m.reprise;
      if (jetonValide(code, joueur, jeton)) {
        const r = registre.trouver(code, c.ip, maintenantMs);
        if (r.ok && presentDansLaSalle(r.salle, joueur)) reprise = { salle: r.salle, ancienne: parJoueur.get(joueur) };
        // salle refermée, ou joueur remplacé par un bot : plus de reprise possible (une simple limite d'essais ne révoque rien)
        else if (r.ok || r.raison === "inconnue") revoquerJeton(code, joueur);
      }
    }
    if (reprise && m.reprise) {
      const { salle, ancienne } = reprise;
      c.joueur = m.reprise.joueur;
      // prise de relais : l'ancienne socket est peut-être « à moitié ouverte » (veille, changement de réseau) ; le jeton valide la remplace
      if (ancienne && ancienne !== c) {
        ancienne.remplacee = true;
        detacher(ancienne);
        parJoueur.delete(c.joueur);
        mesures.socketsRemplacees++;
        ancienne.ws.close(CODE_REMPLACE, "remplacée par une reprise");
      }
      parJoueur.set(c.joueur, c);
      envoyer(c, { t: "bienvenue", v: VERSION_ROCKET, joueur: c.joueur, maintenantMs: Math.round(maintenantMs) });
      envoyer(c, { t: "reprise", code: salle.code });
      joindre(c, salle);
      // ordre de la spec (§ 6) : presence « revenu », salon, session, debut, instantané. La salle ignore les jetons : `session` s'insère
      // entre le salon et le debut (à la fin si elle n'a rien d'autre à dire, ce qui n'arrive qu'hors match)
      const sorties = salle.reprendre(c.joueur, maintenantMs);
      const iDebut = sorties.findIndex((s) => "msg" in s && s.msg.t === "debut");
      const iSession = iDebut >= 0 ? iDebut : sorties.length;
      diffuser(salle, sorties.slice(0, iSession));
      envoyer(c, { t: "session", code: salle.code, joueur: c.joueur, jeton: m.reprise.jeton });
      diffuser(salle, sorties.slice(iSession));
      return;
    }
    parJoueur.set(c.joueur, c);
    envoyer(c, { t: "bienvenue", v: VERSION_ROCKET, joueur: c.joueur, maintenantMs: Math.round(maintenantMs) });
    if (m.reprise) envoyer(c, { t: "reprise", code: null });
  }

  /** Le joueur quitte (volontairement) ou disparaît (socket fermée) sa salle ; la salle est refermée si plus personne n'y est. */
  function retirerDeLaSalle(c: Connexion, maintenantMs: number, coupure: boolean): void {
    const salle = c.salle;
    if (!salle) return;
    detacher(c);
    diffuser(salle, salle.retirer(c.joueur, maintenantMs, coupure));
    if (salle.vide()) { registre.retirer(salle.code, maintenantMs); liquider(salle, "ferme"); }
    else if (!presentDansLaSalle(salle, c.joueur)) revoquerJeton(salle.code, c.joueur);
  }

  function traiterMessage(c: Connexion, m: MessageClient, maintenantMs: number): void {
    switch (m.t) {
      case "bonjour":
        return; // déjà accueilli
      case "lister":
        envoyer(c, { t: "liste", parties: registre.lister() });
        return;
      case "creer": {
        if (c.salle) return refuser(c, "creer", "deja-dans-salle");
        const r = registre.creer({ id: c.joueur, nom: c.nom }, m.reglages, c.ip, maintenantMs);
        if (!r.ok) return refuser(c, "creer", r.raison);
        joindre(c, r.salle);
        emettreJeton(c, r.salle.code);
        envoyer(c, { t: "salon", salon: r.salle.etat() });
        return;
      }
      case "rejoindre": {
        if (c.salle) return refuser(c, "rejoindre", "deja-dans-salle");
        const r = registre.trouver(m.code, c.ip, maintenantMs);
        if (!r.ok) return refuser(c, "rejoindre", r.raison);
        const res = r.salle.rejoindre({ id: c.joueur, nom: c.nom, ...(m.equipe ? { equipe: m.equipe } : {}) }, maintenantMs);
        if (!res.ok) return refuser(c, "rejoindre", res.raison);
        joindre(c, r.salle);
        emettreJeton(c, r.salle.code);
        diffuser(r.salle, res.sorties);
        return;
      }
      case "quitter": {
        retirerDeLaSalle(c, maintenantMs, false);
        envoyer(c, { t: "salon", salon: null, raison: "quitte" });
        return;
      }
      case "ping": {
        // hors salle : pas de tick à rendre, mais le RTT se mesure quand même (liste des parties ouvertes, salon)
        if (!c.salle) { envoyer(c, { t: "pong", c: m.c, tick: -1, ralenti: false }); return; }
        diffuser(c.salle, c.salle.recevoir(c.joueur, m, maintenantMs));
        return;
      }
      default: {
        const salle = c.salle;
        if (!salle) return refuser(c, m.t, "inconnue");
        // plafond de matchs simultanés : seul un lancement depuis le salon en ouvre un (la revanche reste dans la salle qui l'occupait déjà)
        if (m.t === "lancer" && salle.phase === "salon" && registre.nombreMatchs() >= matchsMax) return refuser(c, "lancer", "limite");
        diffuser(salle, salle.recevoir(c.joueur, m, maintenantMs));
      }
    }
  }

  function traiterTexte(c: Connexion, texte: string, maintenantMs: number): void {
    let brut: unknown;
    try { brut = JSON.parse(texte); } catch { brut = undefined; }
    const t: unknown = typeof brut === "object" && brut !== null ? (brut as { t?: unknown }).t : undefined;
    const classe: ClasseMessage = t === "ping" ? "ping" : "action";
    const decision = admettreRocket(c.limiteur, classe, maintenantMs);
    if (decision === "couper") return erreurEtFermer(c, "flood", "Trop de messages.", CODE_FLOOD);
    if (decision === "jeter") return;
    if (!c.accueilli) {
      if (t !== "bonjour") return erreurEtFermer(c, "bonjour", "Le premier message doit être « bonjour ».", CODE_BONJOUR);
      const v = (brut as { v?: unknown }).v;
      if (v !== VERSION_ROCKET) return erreurEtFermer(c, "version", "Version du protocole différente : rechargez la page.", CODE_VERSION);
      const m = lireMessageClient(brut);
      if (!m || m.t !== "bonjour") return erreurEtFermer(c, "bonjour", "Message « bonjour » invalide.", CODE_BONJOUR);
      return traiterBonjour(c, m, maintenantMs);
    }
    const m = lireMessageClient(brut);
    if (!m) {
      // forme invalide : un refus pour un type reconnaissable (un code de salon mal formé a sa raison), sinon silence
      if (t === "rejoindre") refuser(c, "rejoindre", "code");
      else if (typeof t === "string" && t !== "bonjour" && TYPES_CLIENT.has(t as TypeMessageClient)) refuser(c, t as TypeMessageClient, "invalide");
      return;
    }
    traiterMessage(c, m, maintenantMs);
  }

  function traiterBinaire(c: Connexion, donnees: Buffer, maintenantMs: number): void {
    const decision = admettreRocket(c.limiteur, "entrees", maintenantMs);
    if (decision === "couper") return erreurEtFermer(c, "flood", "Trop de messages.", CODE_FLOOD);
    if (decision === "jeter") return;
    if (!c.accueilli) return erreurEtFermer(c, "bonjour", "Le premier message doit être « bonjour ».", CODE_BONJOUR);
    const salle = c.salle;
    if (!salle) return;
    // copie : le tampon de ws est un morceau d'un tampon partagé (décalage non nul), les décodeurs lisent depuis l'octet 0
    const octets = new Uint8Array(donnees);
    if (typeDeTrame(octets) !== TRAME_ENTREES) return;
    const trame = decoderTrameEntrees(octets);
    if (!trame) return;
    diffuser(salle, salle.recevoirEntrees(c.joueur, trame, maintenantMs));
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // Connexions
  // ------------------------------------------------------------------------------------------------------------------------------

  wss.on("connection", (ws, req) => {
    const ip = ipClient(req.headers["x-forwarded-for"], req.socket.remoteAddress);
    if (connexions.size >= connexionsTotalMax || (parIp.get(ip) ?? 0) >= connexionsParIpMax) {
      ws.close(CODE_TROP_DE_CONNEXIONS, "trop de connexions");
      return;
    }
    parIp.set(ip, (parIp.get(ip) ?? 0) + 1);
    const maintenant = horloge();
    const c: Connexion = {
      ws, ip, joueur: ++compteurJoueurs, nom: "Agent", accueilli: false, salle: null, limiteur: creerLimiteur(maintenant), dernierPongT: maintenant,
      remplacee: false, minuteurBonjour: null,
    };
    connexions.add(c);
    // un client qui ne dit pas « bonjour » dans les 10 s est libéré
    c.minuteurBonjour = setTimeout(() => { if (!c.accueilli && ws.readyState === ws.OPEN) ws.close(CODE_BONJOUR, "bonjour attendu"); }, RESEAU.bonjourMs);
    c.minuteurBonjour.unref();
    ws.on("pong", () => { c.dernierPongT = horloge(); });
    ws.on("message", (donnees: RawData, binaire: boolean) => {
      const tampon = Array.isArray(donnees) ? Buffer.concat(donnees) : Buffer.isBuffer(donnees) ? donnees : Buffer.from(donnees);
      mesures.octetsRecus += tampon.length;
      try {
        if (binaire) traiterBinaire(c, tampon, horloge());
        else traiterTexte(c, tampon.toString("utf8"), horloge());
      } catch (e) { console.error("rocket message:", e); }
    });
    ws.on("close", (code: number) => {
      if (c.minuteurBonjour) clearTimeout(c.minuteurBonjour);
      connexions.delete(c);
      const n = (parIp.get(c.ip) ?? 1) - 1;
      if (n <= 0) parIp.delete(c.ip); else parIp.set(c.ip, n);
      // une reprise a pris la place de cette socket : le joueur est toujours là
      if (c.remplacee) return;
      if (parJoueur.get(c.joueur) === c) parJoueur.delete(c.joueur);
      try {
        // seule une fermeture normale (1000, bouton « Quitter », `fermer()` du client) est un départ : un rechargement (1001), une coupure ou une
        // socket tuée par le ping laissent la place 20 s à la reprise
        retirerDeLaSalle(c, horloge(), code !== CODE_DEPART_VOLONTAIRE);
      } catch (e) { console.error("rocket close:", e); }
    });
    ws.on("error", () => ws.terminate());
  });

  // ------------------------------------------------------------------------------------------------------------------------------
  // Boucles
  // ------------------------------------------------------------------------------------------------------------------------------

  /** Une durée de réveil complète (tics + encodage + envois) : `/sante.rocket.ticMaxMs` et `ticsLents`. */
  function noterTic(dureeMs: number, maintenantMs: number): void {
    if (maintenantMs - tic.depuis >= FENETRE_TIC_MS) {
      tic.maxPrecedente = maintenantMs - tic.depuis >= 2 * FENETRE_TIC_MS ? 0 : tic.maxFenetre;
      tic.maxFenetre = 0;
      tic.depuis = maintenantMs;
    }
    tic.maxFenetre = Math.max(tic.maxFenetre, dureeMs);
    if (dureeMs > TIC_LENT_MS) tic.lents++;
  }

  // Boucle de jeu : 8 ms. Le budget de pas du réveil est partagé entre les salles dans un ordre qui tourne (aucune ne passe toujours la première) ;
  // une salle sans budget est quand même tiquée (échéances de phase, accumulateur) et son retard est rattrapé aux réveils suivants.
  const minuteurJeu = setInterval(() => {
    const debut = horloge();
    const actives = registre.actives();
    if (actives.length === 0) return;
    let budget: number = RESEAU.pasMaxTotalParReveil;
    const n = actives.length;
    rotation = (rotation + 1) % n;
    for (let k = 0; k < n; k++) {
      const salle = actives[(k + rotation) % n];
      try {
        const avant = salle.mesures().pas;
        const sorties = salle.tic(debut, budget);
        budget = Math.max(0, budget - Math.max(0, salle.mesures().pas - avant));
        diffuser(salle, sorties);
        absorberMesures(salle);
      } catch (e) { console.error(`rocket tic ${salle.code}:`, e); }
    }
    noterTic(horloge() - debut, debut);
  }, RESEAU.periodeMinuteurServeurMs);

  // Ménage : salles vides ou oubliées (une par seconde suffit)
  const minuteurMenage = setInterval(() => {
    try {
      const maintenant = horloge();
      // `nettoyer` a déjà retiré les salles du registre
      for (const salle of registre.nettoyer(maintenant)) liquider(salle, "expire");
    } catch (e) { console.error("rocket ménage:", e); }
  }, 1000);

  // Vivacité : ping PROTOCOLAIRE (traité hors JS par le navigateur, donc aussi onglet masqué), socket coupée après 10 s sans pong
  const minuteurPing = setInterval(() => {
    const maintenant = horloge();
    for (const c of connexions) {
      if (maintenant - c.dernierPongT > RESEAU.socketMorteMs) { c.ws.terminate(); continue; }
      if (c.ws.readyState === c.ws.OPEN) c.ws.ping();
    }
  }, RESEAU.pingProtocoleMs);

  // ------------------------------------------------------------------------------------------------------------------------------
  // Interface publique
  // ------------------------------------------------------------------------------------------------------------------------------

  return {
    upgrade(req: unknown, socket: unknown, head: unknown): void {
      const brut = socket as Duplex;
      if (!actif) {
        brut.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        brut.destroy();
        return;
      }
      wss.handleUpgrade(req as IncomingMessage, brut, head as Buffer, (ws) => wss.emit("connection", ws, req));
    },

    sante(): SanteRocket {
      for (const salle of registre.actives()) absorberMesures(salle);
      let joueurs = 0;
      for (const c of connexions) if (c.salle) joueurs++;
      return {
        salles: registre.nombre(),
        matchs: registre.nombreMatchs(),
        joueurs,
        connexions: connexions.size,
        ticMaxMs: Math.round(Math.max(tic.maxFenetre, tic.maxPrecedente) * 100) / 100,
        ticsLents: tic.lents,
        entreesTardives: mesures.entreesTardives,
        entreesRepetees: mesures.entreesRepetees,
        octetsEmis: mesures.octetsEmis,
        octetsRecus: mesures.octetsRecus,
        snapsSautes: mesures.snapsSautes,
        tempsAbandonneMs: Math.round(mesures.tempsAbandonneMs),
        socketsRemplacees: mesures.socketsRemplacees,
      };
    },

    arreter(): void {
      clearInterval(minuteurJeu);
      clearInterval(minuteurMenage);
      clearInterval(minuteurPing);
      for (const c of connexions) {
        if (c.minuteurBonjour) clearTimeout(c.minuteurBonjour);
        // on ferme sans retirer personne : les salles disparaissent avec le processus
        c.remplacee = true;
        c.ws.close(CODE_ARRET_SERVEUR, "arrêt du serveur");
      }
      wss.close();
    },
  };
}
