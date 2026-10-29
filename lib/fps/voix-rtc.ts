/**
 * Chat vocal de proximité (navigateur, v3 §5) : une connexion WebRTC audio par joueur proche… ou lointain (le maillage relie tous les
 * joueurs en arène qui ont activé la voix, ≤ 15 flux Opus) ; c'est le VOLUME qui fait la proximité : chaque flux reçu passe par un gain
 * (`gainVoix`, distance) et un panoramique (gauche / droite selon l'angle), mis à jour à chaque image par `jeu.ts` (`placer`).
 *
 * Signalisation par le serveur de l'arène (`voix`, relayé tel quel), SANS « trickle » : on attend la fin de la collecte des candidats ICE
 * (STUN public, borné à 2,5 s) et l'offre / la réponse part complète en un seul message. Le plus petit identifiant appelle (`doitAppeler`).
 * Pas de serveur TURN : deux joueurs derrière des NAT symétriques ne s'entendront pas (au bureau, même réseau : sans objet).
 *
 * Micro : `getUserMedia` (annulation d'écho, réduction de bruit), demandé à l'activation (geste de l'utilisateur). « Appuyer pour parler » :
 * la piste est coupée (`enabled = false`) hors touche ; « micro ouvert » : toujours active.
 * Spec : docs/superpowers/specs/2026-10-23-arene-v3-design.md (§5)
 */
import type { JoueurPublic, MessageClient, SignalVoix, Vec3 } from "./protocole";
import { VOIX, correspondants, doitAppeler, gainVoix, microOuvert, planConnexions, signalValide, type CiblesVoix, type ModeVoix } from "./voix";

const SERVEURS_ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
/** Attente maximale de la collecte des candidats ICE avant d'envoyer la SDP (ms). */
const COLLECTE_ICE_MS = 2500;
/** Après un échec de connexion, l'appelant réessaie au bout de ce délai (ms). */
const NOUVEL_ESSAI_MS = 4000;
/** Offre restée sans connexion établie après ce délai (ms : réponse perdue, correspondant parti) : l'appelant recommence. */
const ATTENTE_CONNEXION_MS = 15_000;
/** Lissage (s) des changements de gain et de panoramique : pas de « zip » quand quelqu'un passe devant soi. */
const LISSAGE_S = 0.08;

export type EtatActivation = "ok" | "refuse" | "indisponible";

export interface ChatVocal {
  /** Demande le micro (à appeler sur un geste) et rejoint le chat : `voixActif{actif:true}`. */
  activer(): Promise<EtatActivation>;
  /** Coupe tout : connexions, micro, `voixActif{actif:false}`. */
  desactiver(): void;
  actif(): boolean;
  mode(m: ModeVoix): void;
  /** Touche « parler » tenue (mode « appuyer »). */
  parler(tenue: boolean): void;
  /** Le micro émet en ce moment (mode ouvert, ou touche tenue). */
  emet(): boolean;
  /** Présence reçue : ouvre / ferme les connexions. */
  presence(joueurs: readonly JoueurPublic[], monId: string | null): void;
  /**
   * Battle Royale : connexions choisies par le jeu (`ciblesVoixBr` : voisins en vie, ou spectateurs entre eux, plus les liens de killcam) au
   * lieu de tous les joueurs de la présence (`null`, arène). Sans effet si rien ne change ; sinon ouvre et ferme aussitôt.
   */
  cibler(c: CiblesVoix | null): void;
  recevoir(de: string, s: SignalVoix): void;
  /**
   * À chaque image : l'auditeur (`oreille`, `lacet`) et les positions des autres (`sources` : id → position de la tête, `vivant`).
   * Un joueur absent de `sources` est muet. `direct` : lien de killcam, plein volume au centre quelle que soit la distance.
   */
  placer(oreille: Vec3, lacet: number, sources: ReadonlyMap<string, { p: Vec3; vivant: boolean; direct?: boolean }>): void;
  /** Ids des joueurs qui parlent en ce moment (niveau au-dessus du seuil ET audibles). */
  parlants(): string[];
  /** Ids des joueurs dont on reçoit le flux (connexion établie). */
  relies(): string[];
  /** Ids des connexions ouvertes ou en cours d'ouverture. */
  connexions(): string[];
  /** Diagnostic (crochet de test) : connexions, état WebRTC, audibilité. */
  diagnostic(): { actif: boolean; mode: ModeVoix; emet: boolean; pairs: { id: string; connexion: string; audible: boolean; flux: boolean }[] };
  dispose(): void;
}

interface Pair {
  id: string;
  pc: RTCPeerConnection;
  appelant: boolean;
  /** chaîne audio du flux reçu */
  audio: HTMLAudioElement | null;
  source: MediaStreamAudioSourceNode | null;
  gain: GainNode | null;
  pan: StereoPannerNode | null;
  analyse: AnalyserNode | null;
  tampon: Float32Array<ArrayBuffer> | null;
  audible: boolean;
}

function collecteTerminee(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const fin = () => { pc.removeEventListener("icegatheringstatechange", verif); clearTimeout(minuteur); resolve(); };
    const verif = () => { if (pc.iceGatheringState === "complete") fin(); };
    const minuteur = setTimeout(fin, COLLECTE_ICE_MS);
    pc.addEventListener("icegatheringstatechange", verif);
  });
}

/** `envoyer` : vers le serveur de l'arène (`voix`, `voixActif`). */
export function creerChatVocal(envoyer: (m: MessageClient) => void): ChatVocal {
  const disponible = typeof window !== "undefined" && typeof RTCPeerConnection === "function" && !!navigator.mediaDevices?.getUserMedia;
  let ctx: AudioContext | null = null;
  let micro: MediaStream | null = null;
  let actif = false;
  let mode: ModeVoix = "appuyer";
  let tenue = false;
  let monId: string | null = null;
  let voulus: string[] = [];
  let derniereListe: readonly JoueurPublic[] = [];
  /** connexions gardées si l'autre appelle (BR : un peu plus loin que mes voisins appelés) ; en arène, les voulus */
  let admis: string[] = [];
  /** null : tous les joueurs avec la voix (arène) ; sinon les cibles choisies par le jeu (BR) */
  let cibles: CiblesVoix | null = null;
  let signatureCibles = "";
  let fini = false;
  const pairs = new Map<string, Pair>();
  // un contexte audio créé hors geste reste suspendu : le premier clic ou la première touche le réveille (comme sons.ts)
  const reveiller = () => { if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {}); };
  const GESTES = ["pointerdown", "keydown"] as const;
  if (typeof window !== "undefined") for (const g of GESTES) window.addEventListener(g, reveiller, { capture: true, passive: true });

  const piste = () => micro?.getAudioTracks()[0] ?? null;
  const majPiste = () => {
    const p = piste();
    if (p) p.enabled = actif && microOuvert(mode, tenue);
  };

  function fermer(id: string, prevenir: boolean) {
    const p = pairs.get(id);
    if (!p) return;
    pairs.delete(id);
    try { p.pc.close(); } catch { /* déjà fermée */ }
    p.source?.disconnect();
    p.gain?.disconnect();
    p.pan?.disconnect();
    p.analyse?.disconnect();
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    if (prevenir) envoyer({ t: "voix", a: id, s: { type: "fin" } });
  }

  /** Connexion neuve vers `id`, micro branché, flux reçu raccordé au graphe audio. */
  function creerPair(id: string, appelant: boolean): Pair {
    const pc = new RTCPeerConnection({ iceServers: SERVEURS_ICE });
    const p: Pair = { id, pc, appelant, audio: null, source: null, gain: null, pan: null, analyse: null, tampon: null, audible: false };
    const t = piste();
    if (t && micro) pc.addTrack(t, micro);
    else pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (e) => {
      if (!ctx || p.source) return;
      const flux = e.streams[0] ?? new MediaStream([e.track]);
      // Chrome ne fait sortir un flux WebRTC dans WebAudio que s'il est aussi branché sur un élément audio (muet ici)
      const audio = new Audio();
      audio.muted = true;
      audio.srcObject = flux;
      void audio.play().catch(() => {});
      p.audio = audio;
      p.source = ctx.createMediaStreamSource(flux);
      p.gain = ctx.createGain();
      p.gain.gain.value = 0;
      p.pan = ctx.createStereoPanner();
      p.analyse = ctx.createAnalyser();
      p.analyse.fftSize = 512;
      p.tampon = new Float32Array(new ArrayBuffer(p.analyse.fftSize * 4));
      p.source.connect(p.analyse);
      p.source.connect(p.gain);
      p.gain.connect(p.pan);
      p.pan.connect(ctx.destination);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== "failed") return;
      // l'appelant retente (réseau qui change, NAT capricieux) tant que le correspondant est voulu
      fermer(id, false);
      if (appelant) setTimeout(() => { if (!fini && actif && voulus.includes(id) && !pairs.has(id)) void appeler(id); }, NOUVEL_ESSAI_MS);
    };
    pairs.set(id, p);
    return p;
  }

  async function appeler(id: string) {
    const p = creerPair(id, true);
    try {
      await p.pc.setLocalDescription(await p.pc.createOffer());
      await collecteTerminee(p.pc);
      if (pairs.get(id) !== p || !p.pc.localDescription) return;
      envoyer({ t: "voix", a: id, s: { type: "offre", sdp: p.pc.localDescription.sdp } });
      setTimeout(() => {
        if (fini || pairs.get(id) !== p || p.pc.connectionState === "connected") return;
        fermer(id, false);
        if (actif && voulus.includes(id)) void appeler(id);
      }, ATTENTE_CONNEXION_MS);
    } catch {
      fermer(id, false);
    }
  }

  async function repondre(id: string, sdp: string) {
    // une offre neuve remplace toute connexion existante (le correspondant a recommencé)
    fermer(id, false);
    const p = creerPair(id, false);
    try {
      await p.pc.setRemoteDescription({ type: "offer", sdp });
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      await collecteTerminee(p.pc);
      if (pairs.get(id) !== p || !p.pc.localDescription) return;
      envoyer({ t: "voix", a: id, s: { type: "reponse", sdp: p.pc.localDescription.sdp } });
    } catch {
      fermer(id, false);
    }
  }

  function reconcilier() {
    if (!actif || !monId) {
      for (const id of [...pairs.keys()]) fermer(id, false);
      return;
    }
    const plan = planConnexions(monId, pairs.keys(), voulus, admis);
    for (const id of plan.fermer) fermer(id, false);
    for (const id of plan.appeler) void appeler(id);
  }

  return {
    async activer() {
      if (!disponible || fini) return "indisponible";
      if (actif) return "ok";
      try {
        ctx ??= new AudioContext();
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        micro ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch {
        return "refuse";
      }
      if (fini) return "indisponible";
      actif = true;
      majPiste();
      envoyer({ t: "voixActif", actif: true });
      reconcilier();
      return "ok";
    },

    desactiver() {
      if (!actif) return;
      actif = false;
      for (const id of [...pairs.keys()]) fermer(id, true);
      for (const t of micro?.getTracks() ?? []) t.stop();
      micro = null;
      envoyer({ t: "voixActif", actif: false });
    },

    actif: () => actif,

    mode(m) {
      mode = m;
      majPiste();
    },

    parler(t) {
      tenue = t;
      majPiste();
    },

    emet: () => actif && microOuvert(mode, tenue),

    presence(joueurs, id) {
      monId = id;
      derniereListe = joueurs;
      if (!cibles) {
        voulus = correspondants(id, joueurs);
        admis = voulus;
      }
      reconcilier();
    },

    recevoir(de, s) {
      if (!actif || !signalValide(s)) return;
      if (s.type === "fin") { fermer(de, false); return; }
      if (s.type === "offre") {
        // seul celui qui doit appeler fait des offres ; une offre « à l'envers » est ignorée. Le serveur ne relaie qu'entre joueurs en arène
        // avec la voix : l'offre est acceptée même si la présence qui annonce l'appelant n'est pas encore arrivée
        if (monId && !doitAppeler(monId, de)) void repondre(de, s.sdp);
        return;
      }
      const p = pairs.get(de);
      if (p && p.appelant && p.pc.signalingState === "have-local-offer") void p.pc.setRemoteDescription({ type: "answer", sdp: s.sdp }).catch(() => fermer(de, false));
    },

    cibler(c) {
      const signature = c ? `${c.voulus.join(",")}|${c.admis.join(",")}` : "";
      if (c && cibles && signature === signatureCibles) return;
      if (!c && !cibles) return;
      cibles = c;
      signatureCibles = signature;
      voulus = c ? c.voulus : correspondants(monId, derniereListe);
      admis = c ? c.admis : voulus;
      reconcilier();
    },

    placer(oreille, lacet, sources) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const cos = Math.cos(lacet), sin = Math.sin(lacet);
      for (const p of pairs.values()) {
        if (!p.gain || !p.pan) continue;
        const s = sources.get(p.id);
        let g = 0, pan = 0;
        if (s?.direct) {
          // lien de killcam : on se parle comme au téléphone
          g = 1;
        } else if (s) {
          const dx = s.p[0] - oreille[0], dy = s.p[1] - oreille[1], dz = s.p[2] - oreille[2];
          g = gainVoix(Math.hypot(dx, dy, dz), s.vivant);
          // droite de la vue = (cos lacet, −sin lacet) : produit scalaire normalisé, adouci (jamais une seule oreille)
          const h = Math.hypot(dx, dz);
          if (h > 0.5) pan = 0.8 * ((dx * cos - dz * sin) / h);
        }
        p.audible = g > 0.01;
        p.gain.gain.setTargetAtTime(g, t, LISSAGE_S);
        p.pan.pan.setTargetAtTime(pan, t, LISSAGE_S);
      }
    },

    parlants() {
      const r: string[] = [];
      for (const p of pairs.values()) {
        if (!p.analyse || !p.tampon || !p.audible) continue;
        p.analyse.getFloatTimeDomainData(p.tampon);
        let somme = 0;
        for (let i = 0; i < p.tampon.length; i++) somme += p.tampon[i] * p.tampon[i];
        if (Math.sqrt(somme / p.tampon.length) > VOIX.seuilParole) r.push(p.id);
      }
      return r.sort();
    },

    relies() {
      return [...pairs.values()].filter((p) => !!p.source).map((p) => p.id).sort();
    },

    connexions() {
      return [...pairs.keys()].sort();
    },

    diagnostic() {
      return {
        actif, mode, emet: actif && microOuvert(mode, tenue),
        pairs: [...pairs.values()].map((p) => ({ id: p.id, connexion: p.pc.connectionState, audible: p.audible, flux: !!p.source })),
      };
    },

    dispose() {
      if (fini) return;
      this.desactiver();
      fini = true;
      if (typeof window !== "undefined") for (const g of GESTES) window.removeEventListener(g, reveiller, { capture: true });
      for (const id of [...pairs.keys()]) fermer(id, false);
      if (ctx) void ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
