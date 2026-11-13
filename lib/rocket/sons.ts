/**
 * Rocket Muche, sons (WebAudio synthétisé, aucun fichier). Le contexte est créé dans un geste de l'utilisateur (`activer`, au clic sur
 * « Lancer »). Sans `AudioContext` (Node, navigateur ancien, politique de lecture) tout est un no-op silencieux : un son raté ne doit
 * jamais casser une partie.
 *
 * Moteurs : une dent de scie filtrée bas et sa sous-octave en triangle, hauteur selon la vitesse (46 → 132 Hz), souffle de bruit filtré sous boost ; seules
 * les 3 voitures les plus proches (la sienne d'abord) ont une voix. Le reste est de la synthèse à la demande (`ton`, `bruit`) : clacs de
 * balle proportionnels à la force, thud d'atterrissage, souffle des sauts (le même pour le saut et le double saut), whoosh du flip, tintement des plots, explosion de démolition, klaxon de stade + foule +
 * feu d'artifice au but, bips du décompte, sifflet de fin, klaxon à deux tons du Truck Muche. Décisions (gains, hauteurs) : `sons-modele.ts`.
 */
import { creerRng, tirer, type EvenementMatch, type MondeRocket, type SonsRocket } from "./contrat";
import {
  MOTEUR, NOTES, SON_FLIP, SON_SAUT, choisirMoteurs, coupureMoteur, distanceVoitures, dureeGraveChoc, echelleEvenement, frequenceGraveChoc, frequenceMoteur, gainChoc, gainMoteur,
  gainReaction, gainSouffleBoost, panoramique, SON_REACTION, tempsFeuArtifice,
} from "./sons-modele";
import { clamp } from "./vec";

type TypeOsc = "sine" | "square" | "sawtooth" | "triangle";
type TypeFiltre = "lowpass" | "highpass" | "bandpass";

interface VoixMoteur {
  o1: OscillatorNode;
  o2: OscillatorNode;
  filtre: BiquadFilterNode;
  gain: GainNode;
  souffle: AudioBufferSourceNode | null;
  gainSouffle: GainNode;
  pan: StereoPannerNode | null;
}

/** Seconde voix du moteur : l'octave grave, désaccordée de 0,4 % (battement lent, son plus plein). */
const RAPPORT_SOUS_OCTAVE = 0.502;

/** Plafond de sons ponctuels simultanés : au-delà, les nouveaux sont ignorés plutôt que de saturer le processeur. */
const VOIX_PONCTUELLES_MAX = 28;

export function creerSonsRocket(): SonsRocket {
  let ctx: AudioContext | null = null;
  let maitre: GainNode | null = null;
  let bruitTampon: AudioBuffer | null = null;
  let volumeMaitre = 0.7;
  let suspendu = false;
  const moteurs = new Map<number, VoixMoteur>();
  let ponctuelles = 0;
  /** hasard local (jamais Math.random) pour les départs de bruit et les éclats */
  const rng = creerRng(0x5eed);

  /** Avale l'échec éventuel d'une promesse de `resume` / `suspend` / `close` (certaines implémentations ne rendent rien). */
  const ignorer = (p: unknown): void => { (p as Promise<void> | undefined)?.catch?.(() => {}); };

  const ConstructeurAudio = (): (typeof AudioContext) | null => {
    const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    return g.AudioContext ?? g.webkitAudioContext ?? null;
  };

  function activer(): void {
    try {
      if (ctx) { if (ctx.state === "suspended" && !suspendu) ignorer(ctx.resume?.()); return; }
      const AC = ConstructeurAudio();
      if (!AC) return;
      ctx = new AC();
      maitre = ctx.createGain();
      maitre.gain.value = volumeMaitre * 0.9;
      const comp = ctx.createDynamicsCompressor?.();
      if (comp) { maitre.connect(comp); comp.connect(ctx.destination); } else maitre.connect(ctx.destination);
      // une seconde de bruit blanc, tirée du générateur local
      const n = Math.max(1, Math.floor(ctx.sampleRate));
      bruitTampon = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = bruitTampon.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = tirer(rng) * 2 - 1;
      if (ctx.state === "suspended") ignorer(ctx.resume?.());
    } catch {
      ctx = null; maitre = null; bruitTampon = null;
    }
  }

  /** Branche `noeud` sur la sortie (avec un panoramique éventuel). */
  function sortie(noeud: AudioNode, pan = 0): void {
    if (!ctx || !maitre) return;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      noeud.connect(p);
      p.connect(maitre);
    } else noeud.connect(maitre);
  }

  /** Un son à fréquence glissante : enveloppe d'attaque courte et de décroissance exponentielle. */
  function ton(type: TypeOsc, f0: number, f1: number, dur: number, gain: number, retard = 0, filtre?: { type: TypeFiltre; f: number }, pan = 0): void {
    if (!ctx || !maitre || gain <= 0.0005 || ponctuelles >= VOIX_PONCTUELLES_MAX) return;
    try {
      const t0 = ctx.currentTime + retard;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(1, f0), t0);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.008, dur / 4));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let fin: AudioNode = o;
      if (filtre) {
        const bq = ctx.createBiquadFilter();
        bq.type = filtre.type; bq.frequency.value = filtre.f;
        o.connect(bq); fin = bq;
      }
      fin.connect(g);
      sortie(g, pan);
      ponctuelles++;
      o.onended = () => { ponctuelles = Math.max(0, ponctuelles - 1); try { g.disconnect(); } catch { /* déjà détaché */ } };
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch { /* un son raté ne casse rien */ }
  }

  /** Une rafale de bruit filtré, la coupure glissant de `f0` à `f1`. */
  function bruit(dur: number, type: TypeFiltre, f0: number, f1: number, gain: number, retard = 0, pan = 0, q = 0.8): void {
    if (!ctx || !maitre || !bruitTampon || gain <= 0.0005 || ponctuelles >= VOIX_PONCTUELLES_MAX) return;
    try {
      const t0 = ctx.currentTime + retard;
      const s = ctx.createBufferSource();
      s.buffer = bruitTampon;
      const bq = ctx.createBiquadFilter();
      bq.type = type; bq.Q.value = q;
      bq.frequency.setValueAtTime(Math.max(20, f0), t0);
      if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.012, dur / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(bq); bq.connect(g);
      sortie(g, pan);
      ponctuelles++;
      s.onended = () => { ponctuelles = Math.max(0, ponctuelles - 1); try { g.disconnect(); } catch { /* déjà détaché */ } };
      s.start(t0, tirer(rng) * 0.5);
      s.stop(t0 + dur + 0.02);
    } catch { /* idem */ }
  }

  /** Montée de foule : bruit large qui gonfle puis retombe. */
  function foule(dur: number, gain: number): void {
    if (!ctx || !maitre || !bruitTampon || ponctuelles >= VOIX_PONCTUELLES_MAX) return;
    try {
      const t0 = ctx.currentTime;
      const s = ctx.createBufferSource();
      s.buffer = bruitTampon; s.loop = true;
      const bq = ctx.createBiquadFilter();
      bq.type = "bandpass"; bq.Q.value = 0.6;
      bq.frequency.setValueAtTime(600, t0);
      bq.frequency.linearRampToValueAtTime(1500, t0 + dur * 0.35);
      bq.frequency.linearRampToValueAtTime(800, t0 + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.3);
      g.gain.linearRampToValueAtTime(gain * 0.7, t0 + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(bq); bq.connect(g);
      sortie(g);
      ponctuelles++;
      s.onended = () => { ponctuelles = Math.max(0, ponctuelles - 1); try { g.disconnect(); } catch { /* déjà détaché */ } };
      s.start(t0);
      s.stop(t0 + dur + 0.02);
    } catch { /* idem */ }
  }

  /** Klaxon à deux notes tenues (klaxon de stade, klaxon du Truck Muche). */
  function klaxon(fA: number, fB: number, dur: number, gain: number, type: TypeOsc = "square"): void {
    ton(type, fA, fA, dur, gain, 0, { type: "lowpass", f: 1800 });
    ton(type, fB, fB, dur, gain, 0, { type: "lowpass", f: 1800 });
  }

  function evenement(e: Readonly<EvenementMatch>, idMoi: number): void {
    if (!ctx || !maitre) return;
    try {
      switch (e.t) {
        case "decompte":
          ton("square", NOTES.decompte, NOTES.decompte, 0.16, 0.2);
          break;
        case "coupDEnvoi":
          ton("square", NOTES.depart, NOTES.depart, 0.5, 0.22);
          break;
        case "toucheBalle": {
          const k = echelleEvenement(e.idVoiture, idMoi) * (e.idVoiture === idMoi ? 1 : 0.55);
          const g = gainChoc(e.force) * 0.8 * k;
          // claquement mat (bruit médium bref) + corps grave : plus de « tic » aigu à chaque touche
          bruit(0.05, "bandpass", 1500, 700, g * 0.8, 0, 0, 0.7);
          ton("sine", frequenceGraveChoc(e.force), frequenceGraveChoc(e.force) * 0.45, dureeGraveChoc(e.force), g);
          ton("triangle", frequenceGraveChoc(e.force) * 2, frequenceGraveChoc(e.force), dureeGraveChoc(e.force) * 0.5, g * 0.35);
          break;
        }
        case "balleDecor": {
          if (e.vitesse < 3) break;
          const g = gainChoc(e.vitesse) * 0.55;
          bruit(0.12, "lowpass", 1400, 300, g);
          ton("sine", 190, 90, 0.14, g * 0.7);
          break;
        }
        case "but": {
          klaxon(NOTES.buteA, NOTES.buteB, 1.3, 0.2, "sawtooth");
          foule(3, 0.34);
          for (const t of tempsFeuArtifice(7)) {
            bruit(0.1, "highpass", 3200, 1500, 0.1, t + 0.1);
            ton("sine", 900 + tirer(rng) * 500, 200, 0.2, 0.05, t + 0.1);
          }
          klaxon(NOTES.klaxonA, NOTES.klaxonB, 0.4, 0.12, "square"); // le Truck Muche klaxonne aussi
          break;
        }
        case "demolition": {
          const g = echelleEvenement(e.auteur, idMoi) > 0.5 || e.victime === idMoi ? 0.6 : 0.4;
          bruit(0.75, "lowpass", 2800, 120, g);
          ton("sine", 95, 28, 0.6, g);
          ton("sawtooth", 180, 40, 0.35, g * 0.3, 0, { type: "lowpass", f: 700 });
          break;
        }
        case "bump":
          ton("sine", 105, 50, 0.16, 0.28 * echelleEvenement(e.idVoiture, idMoi));
          break;
        case "plot": {
          const k = echelleEvenement(e.idVoiture, idMoi);
          if (e.gros) { ton("sine", 392, 784, 0.3, 0.17 * k); ton("sine", 587, 1175, 0.3, 0.09 * k, 0.07); bruit(0.25, "bandpass", 700, 2200, 0.05 * k); }
          else ton("sine", 660, 880, 0.1, 0.09 * k);
          break;
        }
        case "saut":
        case "doubleSaut": {
          // même son pour les deux sauts (cf. `SON_SAUT`)
          const k = echelleEvenement(e.idVoiture, idMoi);
          ton("sine", SON_SAUT.graveDe, SON_SAUT.graveA, SON_SAUT.dureeS, SON_SAUT.gain * k);
          bruit(SON_SAUT.dureeS, "bandpass", SON_SAUT.souffleDe, SON_SAUT.souffleA, SON_SAUT.gain * 0.55 * k, 0, 0, 0.9);
          break;
        }
        case "flip": {
          const k = echelleEvenement(e.idVoiture, idMoi);
          // whoosh : le bruit monte (première moitié) puis retombe, par-dessus un coup sourd
          bruit(SON_FLIP.dureeS * 0.45, "bandpass", SON_FLIP.de, SON_FLIP.sommet, SON_FLIP.gain * k, 0, 0, 1.1);
          bruit(SON_FLIP.dureeS * 0.6, "bandpass", SON_FLIP.sommet, SON_FLIP.a, SON_FLIP.gain * 0.8 * k, SON_FLIP.dureeS * 0.4, 0, 1.1);
          ton("sine", 130, 70, 0.12, 0.1 * k);
          break;
        }
        case "atterrissage": {
          if (e.vitesse < 2) break;
          const g = clamp(e.vitesse / 14, 0.1, 1) * 0.5 * echelleEvenement(e.idVoiture, idMoi);
          ton("sine", 85, 35, 0.22, g);
          bruit(0.09, "lowpass", 700, 300, g * 0.6);
          break;
        }
        case "choc": {
          if (e.vitesse < 4) break;
          bruit(0.1, "lowpass", 1000, 250, gainChoc(e.vitesse) * 0.5 * echelleEvenement(e.idVoiture, idMoi));
          break;
        }
        case "boost":
          if (e.actif && e.idVoiture === idMoi) { bruit(0.3, "bandpass", 500, 1500, 0.1, 0, 0, 0.7); ton("sine", 70, 110, 0.25, 0.08); }
          break;
        case "supersonique":
          if (e.actif && e.idVoiture === idMoi) { ton("sine", 90, 45, 0.5, 0.16); bruit(0.45, "bandpass", 300, 1200, 0.07, 0, 0, 0.6); }
          break;
        case "arret":
          ton("sine", 540, 380, 0.12, 0.14 * echelleEvenement(e.idVoiture, idMoi));
          break;
        case "reapparition":
          if (e.idVoiture === idMoi) ton("triangle", 330, 660, 0.22, 0.14);
          break;
        case "klaxon": {
          const k = echelleEvenement(e.idVoiture, idMoi);
          klaxon(NOTES.klaxonA, NOTES.klaxonB, 0.55, 0.16 * k);
          break;
        }
        case "prolongation":
          ton("square", NOTES.prolongationA, NOTES.prolongationA, 0.3, 0.16);
          ton("square", NOTES.prolongationB, NOTES.prolongationB, 0.45, 0.16, 0.32);
          break;
        case "chronoZero":
          ton("square", 220, 220, 0.7, 0.18, 0, { type: "lowpass", f: 900 });
          break;
        case "fin": {
          // sifflet : sinus aigu vibré par un LFO
          if (!ctx || ponctuelles >= VOIX_PONCTUELLES_MAX) break;
          const t0 = ctx.currentTime;
          const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
          o.type = "sine"; o.frequency.value = NOTES.sifflet;
          lfo.frequency.value = 28; lg.gain.value = 90;
          lfo.connect(lg); lg.connect(o.frequency);
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.linearRampToValueAtTime(0.16, t0 + 0.03);
          g.gain.setValueAtTime(0.16, t0 + 0.7);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.95);
          o.connect(g);
          sortie(g);
          ponctuelles++;
          o.onended = () => { ponctuelles = Math.max(0, ponctuelles - 1); try { g.disconnect(); lfo.stop(); } catch { /* déjà arrêté */ } };
          o.start(t0); lfo.start(t0);
          o.stop(t0 + 1); lfo.stop(t0 + 1);
          break;
        }
        default:
          break;
      }
    } catch { /* silencieux */ }
  }

  // ---------- moteurs ----------
  function creerVoixMoteur(): VoixMoteur | null {
    if (!ctx || !maitre || !bruitTampon) return null;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    // une dent de scie filtrée bas et son octave grave en triangle, à peine désaccordée : un grondement rond, sans quinte criarde
    o1.type = "sawtooth"; o2.type = "triangle";
    o1.frequency.value = MOTEUR.fMin; o2.frequency.value = MOTEUR.fMin * RAPPORT_SOUS_OCTAVE;
    const filtre = ctx.createBiquadFilter();
    filtre.type = "lowpass"; filtre.frequency.value = 220; filtre.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    o1.connect(filtre); o2.connect(filtre); filtre.connect(gain);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { gain.connect(pan); pan.connect(maitre); } else gain.connect(maitre);
    // souffle du boost : bruit en boucle, bandpass, gain nul tant qu'on ne brûle pas
    const souffle = ctx.createBufferSource();
    souffle.buffer = bruitTampon; souffle.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 850; bp.Q.value = 0.5;
    const gainSouffle = ctx.createGain();
    gainSouffle.gain.value = 0;
    souffle.connect(bp); bp.connect(gainSouffle);
    if (pan) gainSouffle.connect(pan); else gainSouffle.connect(maitre);
    o1.start(); o2.start(); souffle.start();
    return { o1, o2, filtre, gain, souffle, gainSouffle, pan };
  }
  function arreterVoix(v: VoixMoteur): void {
    try { v.o1.stop(); v.o2.stop(); v.souffle?.stop(); } catch { /* déjà arrêté */ }
    try { v.gain.disconnect(); v.gainSouffle.disconnect(); v.pan?.disconnect(); } catch { /* idem */ }
  }

  function maj(m: Readonly<MondeRocket>, idMoi: number, _dtImage: number): void {
    if (!ctx || !maitre || suspendu) return;
    try {
      const moi = m.voitures[idMoi];
      const choisis = new Set(choisirMoteurs(m, idMoi));
      for (const [id, v] of moteurs) if (!choisis.has(id)) { arreterVoix(v); moteurs.delete(id); }
      const t = ctx.currentTime;
      for (const id of choisis) {
        const car = m.voitures[id];
        if (!car) continue;
        let voix = moteurs.get(id);
        if (!voix) { const nv = creerVoixMoteur(); if (!nv) continue; voix = nv; moteurs.set(id, voix); }
        const vit = Math.hypot(car.v[0], car.v[1], car.v[2]);
        const brule = car.boostActif && car.boost > 0;
        const d = moi ? distanceVoitures(moi, car) : 0;
        const estMoi = id === idMoi;
        const f = frequenceMoteur(vit, brule);
        voix.o1.frequency.setTargetAtTime(f, t, 0.07);
        voix.o2.frequency.setTargetAtTime(f * RAPPORT_SOUS_OCTAVE, t, 0.04);
        voix.filtre.frequency.setTargetAtTime(coupureMoteur(vit) * (brule ? 1.2 : 1), t, 0.06);
        voix.gain.gain.setTargetAtTime(gainMoteur(d, estMoi, brule, vit), t, 0.06);
        voix.gainSouffle.gain.setTargetAtTime(brule ? gainSouffleBoost(d, estMoi) : 0, t, 0.03);
        if (voix.pan && moi && !estMoi) voix.pan.pan.setTargetAtTime(panoramique(moi, car), t, 0.08);
      }
    } catch { /* silencieux */ }
  }

  return {
    activer,
    evenement,
    maj,
    volume(v) {
      volumeMaitre = clamp(v, 0, 1);
      if (ctx && maitre) maitre.gain.setTargetAtTime(volumeMaitre * 0.9, ctx.currentTime, 0.03);
    },
    reaction(moi) {
      if (!ctx || !maitre || suspendu) return;
      try {
        const g = gainReaction(moi);
        ton("triangle", SON_REACTION.noteA, SON_REACTION.noteA * 1.04, SON_REACTION.dureeS, g);
        ton("triangle", SON_REACTION.noteB, SON_REACTION.noteB * 1.04, SON_REACTION.dureeS * 1.4, g, SON_REACTION.ecartS);
      } catch { /* silencieux */ }
    },
    suspendre(actif) {
      suspendu = actif;
      if (!ctx) return;
      try {
        if (actif) { for (const v of moteurs.values()) arreterVoix(v); moteurs.clear(); ignorer(ctx.suspend?.()); }
        else ignorer(ctx.resume?.());
      } catch { /* silencieux */ }
    },
    dispose() {
      for (const v of moteurs.values()) arreterVoix(v);
      moteurs.clear();
      try { ignorer(ctx?.close?.()); } catch { /* déjà fermé */ }
      ctx = null; maitre = null; bruitTampon = null;
    },
  };
}
