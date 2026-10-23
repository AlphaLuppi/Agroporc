/**
 * Sons de l'arène FPS, tous synthétisés avec WebAudio (bruit filtré + oscillateurs + enveloppes) :
 * aucun fichier audio. Le contexte audio n'est créé qu'au premier geste de l'utilisateur (politique
 * d'autoplay des navigateurs) ; avant cela, et si WebAudio manque, tous les appels sont sans effet.
 *
 * Les tirs lointains passent `position` : le gain baisse avec la distance, les aigus s'éteignent et
 * `pan` (−1 gauche … 1 droite, calculé par jeu.ts d'après l'angle du tireur) place le son.
 */
import type { ArmeFeuId } from "./protocole";

export interface PositionSon {
  /** distance au tireur (m) */
  distance: number;
  /** −1 = à gauche, 1 = à droite */
  pan: number;
}

export interface Sons {
  /** Tir d'une arme ; `position` pour un tir d'un autre joueur (omis = son du joueur local). */
  tir(arme: ArmeFeuId, position?: PositionSon): void;
  /** Séquence de rechargement (clics de chargeur, culasse, cartouches). */
  recharge(arme: ArmeFeuId): void;
  /** J'ai touché quelqu'un (tic ; plus aigu et plus sec à la tête). Joué à la réception de `degats` du serveur (v2 §13.2). */
  touche(tete?: boolean): void;
  /** J'ai tué quelqu'un (ding). */
  kill(): void;
  pas(): void;
  /** Souffle du wall-run : `true` le lance (en boucle), `false` l'éteint. */
  mur(on: boolean): void;
  /** J'ai été touché. */
  degat(): void;
  /** Frottement de la glissade : `true` le lance (en boucle), `false` l'éteint. */
  glisse(on: boolean): void;
  /**
   * Coup de couteau (sifflement de lame ; `touche` ajoute l'impact sur la chair). `position` pour le coup d'un autre joueur
   * (omis = le mien).
   */
  coup(touche: boolean, position?: PositionSon): void;
  /** Cadeau d'Elsa ramassé : carillon doux pour la vie, carillon plus grave et cliquetis métallique pour une arme. */
  ramassage(genre: "soin" | "arme"): void;
  /** Un cran de régénération de vie (tic doux). */
  regen(): void;
  /**
   * Moteur de la voiture conduite : oscillateurs en boucle dont la hauteur suit la vitesse (m/s, valeur absolue).
   * `null` l'éteint (descente, mort, killcam). Plusieurs appels par seconde sont attendus : seule la hauteur change.
   */
  moteur(vitesse: number | null): void;
  /** Choc de voiture ; `force` de 0 (frôlement) à 1 (plein fouet). */
  choc(force: number): void;
  /** Coup de klaxon (facultatif, réservé au conducteur). */
  klaxon(): void;
  dispose(): void;
}

interface OptionsBruit {
  dur: number;
  type: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
  gain: number;
  att?: number;
}

interface OptionsTon {
  dur: number;
  type: OscillatorType;
  f0: number;
  f1?: number;
  gain: number;
  att?: number;
}

/** Instants (s après le début) et timbre des clics de rechargement de chaque arme. */
type Clic = { t: number; f: number; g: number };
const CLICS_PISTOLET: Clic[] = [{ t: 0.2, f: 1200, g: 0.35 }, { t: 0.85, f: 1700, g: 0.45 }, { t: 1.1, f: 2300, g: 0.4 }];
const CLICS_MITRAILLETTE: Clic[] = [{ t: 0.3, f: 1100, g: 0.4 }, { t: 1.3, f: 1600, g: 0.5 }, { t: 1.75, f: 2200, g: 0.4 }];
const CLICS_POMPE: Clic[] = [
  { t: 0.4, f: 1400, g: 0.35 }, { t: 0.78, f: 1400, g: 0.35 }, { t: 1.15, f: 1400, g: 0.35 },
  { t: 1.5, f: 1400, g: 0.35 }, { t: 1.85, f: 1400, g: 0.35 }, { t: 2.15, f: 900, g: 0.55 },
];
const CLICS_SNIPER: Clic[] = [
  { t: 0.3, f: 1500, g: 0.4 }, { t: 0.5, f: 1100, g: 0.4 }, { t: 1.1, f: 1000, g: 0.4 },
  { t: 1.9, f: 1500, g: 0.5 }, { t: 2.4, f: 1100, g: 0.4 }, { t: 2.6, f: 1800, g: 0.5 },
];
/** Fusil d'assaut (2,2 s) : décrochage du chargeur, chargeur neuf, manette d'armement. */
const CLICS_FUSIL_ASSAUT: Clic[] = [{ t: 0.25, f: 1000, g: 0.4 }, { t: 0.55, f: 800, g: 0.3 }, { t: 1.25, f: 1500, g: 0.5 }, { t: 1.85, f: 2000, g: 0.45 }];
/** Mitrailleuse (4,2 s) : capot qui s'ouvre, bande retirée, boîte neuve, capot refermé, armement. */
const CLICS_MITRAILLEUSE: Clic[] = [
  { t: 0.4, f: 900, g: 0.5 }, { t: 1.0, f: 700, g: 0.4 }, { t: 1.6, f: 600, g: 0.45 }, { t: 2.5, f: 1100, g: 0.5 },
  { t: 2.9, f: 1300, g: 0.35 }, { t: 3.4, f: 1000, g: 0.55 }, { t: 3.9, f: 2000, g: 0.5 },
];
/** Revolver (2,2 s) : barillet qui sort, étuis éjectés, six cartouches une à une, barillet refermé. */
const CLICS_REVOLVER: Clic[] = [
  { t: 0.3, f: 1000, g: 0.4 }, { t: 0.6, f: 1800, g: 0.35 },
  { t: 1.0, f: 1500, g: 0.3 }, { t: 1.12, f: 1500, g: 0.3 }, { t: 1.24, f: 1500, g: 0.3 },
  { t: 1.36, f: 1500, g: 0.3 }, { t: 1.48, f: 1500, g: 0.3 }, { t: 1.6, f: 1500, g: 0.3 },
  { t: 1.9, f: 1200, g: 0.5 },
];
/** Mini uzi (1,6 s) : chargeur éjecté, chargeur inséré, culasse. */
const CLICS_MINI_UZI: Clic[] = [{ t: 0.2, f: 1300, g: 0.35 }, { t: 0.75, f: 1900, g: 0.45 }, { t: 1.3, f: 2400, g: 0.4 }];

/** Les armes spéciales n'ont pas de rechargement (`sansRecharge`) : aucun clic. */
const CLICS_RECHARGE: Record<ArmeFeuId, Clic[]> = {
  pistolet: CLICS_PISTOLET, mitraillette: CLICS_MITRAILLETTE, pompe: CLICS_POMPE, sniper: CLICS_SNIPER,
  fusil_assaut: CLICS_FUSIL_ASSAUT, mitrailleuse: CLICS_MITRAILLEUSE, revolver: CLICS_REVOLVER, mini_uzi: CLICS_MINI_UZI,
  railgun: [], minigun: [], magnum_dore: [],
};

/** Briques sonores qu'un profil de tir assemble (liées au contexte audio de `creerSons`). */
interface BriquesSon {
  bruit(dest: AudioNode, t: number, o: OptionsBruit): void;
  ton(dest: AudioNode, t: number, o: OptionsTon): void;
  clic(dest: AudioNode, t: number, f: number, gain: number): void;
}
/** `v` = variation de hauteur aléatoire (0,92 à 1,08) : deux tirs ne sonnent jamais pareil. */
type ProfilTir = (b: BriquesSon, out: AudioNode, t: number, v: number) => void;

/** Une entrée par arme à feu : `Record` exhaustif, une arme oubliée casse la compilation (voulu). */
const PROFILS_TIR: Record<ArmeFeuId, ProfilTir> = {
  pistolet(b, out, t, v) {
    b.bruit(out, t, { dur: 0.11, type: "bandpass", f0: 2600 * v, f1: 900, q: 0.8, gain: 0.9 });
    b.bruit(out, t, { dur: 0.03, type: "highpass", f0: 5000, gain: 0.5 });
    b.ton(out, t, { dur: 0.12, type: "sine", f0: 190 * v, f1: 55, gain: 0.7 });
  },
  mitraillette(b, out, t, v) {
    b.bruit(out, t, { dur: 0.07, type: "bandpass", f0: 2200 * v, f1: 1100, q: 0.9, gain: 0.65 });
    b.bruit(out, t, { dur: 0.02, type: "highpass", f0: 4500, gain: 0.35 });
    b.ton(out, t, { dur: 0.06, type: "sine", f0: 150 * v, f1: 70, gain: 0.5 });
  },
  pompe(b, out, t, v) {
    b.bruit(out, t, { dur: 0.32, type: "lowpass", f0: 2500 * v, f1: 250, gain: 1 });
    b.bruit(out, t, { dur: 0.08, type: "bandpass", f0: 1800, q: 0.6, gain: 0.7 });
    b.ton(out, t, { dur: 0.3, type: "sine", f0: 95 * v, f1: 32, gain: 1 });
    b.clic(out, t + 0.45, 1300, 0.45);
    b.clic(out, t + 0.6, 1800, 0.5);
  },
  sniper(b, out, t, v) {
    b.bruit(out, t, { dur: 0.6, type: "lowpass", f0: 4000 * v, f1: 200, gain: 1 });
    b.bruit(out, t, { dur: 0.06, type: "highpass", f0: 3000, gain: 0.8 });
    b.ton(out, t, { dur: 0.5, type: "sine", f0: 80 * v, f1: 28, gain: 1 });
    b.bruit(out, t + 0.16, { dur: 0.5, type: "lowpass", f0: 900, f1: 200, gain: 0.35 }); // écho dans la vallée
    b.clic(out, t + 0.55, 1500, 0.4);
    b.clic(out, t + 0.8, 1100, 0.45);
  },
  /** Claquement sec et médium, entre la mitraillette et le sniper : cadence soutenue, donc court. */
  fusil_assaut(b, out, t, v) {
    b.bruit(out, t, { dur: 0.09, type: "bandpass", f0: 2000 * v, f1: 850, q: 0.85, gain: 0.75 });
    b.bruit(out, t, { dur: 0.025, type: "highpass", f0: 4200, gain: 0.4 });
    b.ton(out, t, { dur: 0.08, type: "sine", f0: 130 * v, f1: 58, gain: 0.6 });
  },
  /** Plus grave et plus lourde que le fusil, avec une queue de métal. */
  mitrailleuse(b, out, t, v) {
    b.bruit(out, t, { dur: 0.1, type: "bandpass", f0: 1500 * v, f1: 700, q: 0.8, gain: 0.8 });
    b.bruit(out, t, { dur: 0.03, type: "highpass", f0: 3500, gain: 0.35 });
    b.ton(out, t, { dur: 0.1, type: "sine", f0: 105 * v, f1: 45, gain: 0.75 });
    b.ton(out, t + 0.01, { dur: 0.06, type: "triangle", f0: 520 * v, f1: 300, gain: 0.12 });
  },
  /** Gros calibre : un « boum » long et un claquement de culasse métallique. */
  revolver(b, out, t, v) {
    b.bruit(out, t, { dur: 0.24, type: "lowpass", f0: 3200 * v, f1: 300, gain: 1 });
    b.bruit(out, t, { dur: 0.035, type: "highpass", f0: 4800, gain: 0.7 });
    b.ton(out, t, { dur: 0.22, type: "sine", f0: 120 * v, f1: 38, gain: 0.95 });
    b.ton(out, t + 0.012, { dur: 0.1, type: "triangle", f0: 900 * v, f1: 500, gain: 0.1 });
  },
  /** Petit calibre très aigu et très bref : il se répète 16 fois par seconde. */
  mini_uzi(b, out, t, v) {
    b.bruit(out, t, { dur: 0.045, type: "bandpass", f0: 3200 * v, f1: 1900, q: 1.0, gain: 0.55 });
    b.bruit(out, t, { dur: 0.015, type: "highpass", f0: 5200, gain: 0.3 });
    b.ton(out, t, { dur: 0.04, type: "sine", f0: 230 * v, f1: 120, gain: 0.35 });
  },
  /** Décharge électrique : sifflement montant, éclair large bande, détonation sourde et tintement de rail. */
  railgun(b, out, t, v) {
    b.ton(out, t, { dur: 0.16, type: "sawtooth", f0: 260 * v, f1: 2400, gain: 0.35, att: 0.02 });
    b.bruit(out, t + 0.12, { dur: 0.25, type: "highpass", f0: 5500, f1: 9000, gain: 0.7 });
    b.bruit(out, t + 0.12, { dur: 0.5, type: "lowpass", f0: 3800 * v, f1: 150, gain: 0.95 });
    b.ton(out, t + 0.12, { dur: 0.55, type: "sine", f0: 70 * v, f1: 24, gain: 1 });
    b.ton(out, t + 0.14, { dur: 0.7, type: "sine", f0: 1250, f1: 420, gain: 0.16 });
    b.bruit(out, t + 0.3, { dur: 0.6, type: "lowpass", f0: 800, f1: 180, gain: 0.3 }); // écho
  },
  /** Rafale grondante : chaque tir est un souffle grave très court, à peine plus que le bruit de la cadence. */
  minigun(b, out, t, v) {
    b.bruit(out, t, { dur: 0.05, type: "bandpass", f0: 1400 * v, f1: 800, q: 0.9, gain: 0.5 });
    b.bruit(out, t, { dur: 0.015, type: "highpass", f0: 3800, gain: 0.25 });
    b.ton(out, t, { dur: 0.05, type: "sine", f0: 110 * v, f1: 62, gain: 0.5 });
  },
  /** Le revolver en plus rond et plus long, avec un « ting » doré qui s'attarde. */
  magnum_dore(b, out, t, v) {
    b.bruit(out, t, { dur: 0.3, type: "lowpass", f0: 3500 * v, f1: 240, gain: 1 });
    b.bruit(out, t, { dur: 0.04, type: "highpass", f0: 4500, gain: 0.7 });
    b.ton(out, t, { dur: 0.3, type: "sine", f0: 88 * v, f1: 32, gain: 1 });
    b.ton(out, t + 0.02, { dur: 0.45, type: "triangle", f0: 2300, f1: 1900, gain: 0.12 });
    b.ton(out, t + 0.02, { dur: 0.3, type: "sine", f0: 3450, f1: 3300, gain: 0.05 });
  },
};

export function creerSons(): Sons {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let bruitBuf: AudioBuffer | null = null;
  let fini = false;
  let souffle: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  /** frottement de la glissade (bruit en boucle filtré) */
  let frottement: { src: AudioBufferSourceNode; gain: GainNode; filtre: BiquadFilterNode } | null = null;
  /** moteur de la voiture conduite : deux oscillateurs graves + un grain de bruit */
  let moteurVoix: { oscs: OscillatorNode[]; gain: GainNode; filtre: BiquadFilterNode; grain: AudioBufferSourceNode } | null = null;

  const ouvrir = () => {
    if (ctx || fini || typeof window === "undefined") return;
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
    } catch {
      return;
    }
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp);
    comp.connect(ctx.destination);
    // 2 s de bruit blanc partagé par tous les sons.
    const n = Math.floor(ctx.sampleRate * 2);
    bruitBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = bruitBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  };

  /** Premier geste (clic, touche) : crée le contexte ou le sort de sa veille. */
  const reveiller = () => {
    ouvrir();
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
  };
  const GESTES = ["pointerdown", "keydown", "touchstart"] as const;
  if (typeof window !== "undefined") for (const g of GESTES) window.addEventListener(g, reveiller, { capture: true, passive: true });

  /** Vrai si le contexte tourne ; le crée si l'utilisateur a déjà interagi avec la page. */
  const prete = (): boolean => {
    if (fini) return false;
    if (!ctx && typeof navigator !== "undefined" && navigator.userActivation?.hasBeenActive) ouvrir();
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
    return !!ctx && ctx.state === "running" && !!master && !!bruitBuf;
  };

  /** Destination d'un son : directe, ou filtrée/atténuée/panoramiquée pour un tir lointain. */
  const sortie = (pos?: PositionSon): AudioNode => {
    const c = ctx!;
    if (!pos) return master!;
    const d = Math.max(pos.distance, 1);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.max(700, 14000 / (1 + d / 20));
    const g = c.createGain();
    g.gain.value = Math.max(0.04, 1 / (1 + d / 10));
    lp.connect(g);
    if (typeof c.createStereoPanner === "function") {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pos.pan));
      g.connect(p);
      p.connect(master!);
    } else g.connect(master!);
    return lp;
  };

  const enveloppe = (g: GainNode, t: number, gain: number, att: number, dur: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(gain, 0.0002), t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  };

  const bruit = (dest: AudioNode, t: number, o: OptionsBruit) => {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = bruitBuf;
    const f = c.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    f.Q.value = o.q ?? 0.7;
    const g = c.createGain();
    enveloppe(g, t, o.gain, o.att ?? 0.003, o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.9);
    src.stop(t + o.dur + 0.03);
  };

  const ton = (dest: AudioNode, t: number, o: OptionsTon) => {
    const c = ctx!;
    const osc = c.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = c.createGain();
    enveloppe(g, t, o.gain, o.att ?? 0.004, o.dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + o.dur + 0.03);
  };

  /** Petit clic mécanique (chargeur, culasse, cartouche). */
  const clic = (dest: AudioNode, t: number, f: number, gain: number) => {
    bruit(dest, t, { dur: 0.035, type: "bandpass", f0: f, q: 2.5, gain });
    ton(dest, t, { dur: 0.03, type: "triangle", f0: f * 0.45, f1: f * 0.25, gain: gain * 0.5 });
  };

  const briques: BriquesSon = { bruit, ton, clic };

  /** Coupe en douceur une boucle (frottement, moteur) puis libère ses nœuds. */
  const eteindre = (gain: GainNode, arrets: (AudioScheduledSourceNode)[], tau: number) => {
    if (!ctx) return;
    const c = ctx.currentTime;
    gain.gain.cancelScheduledValues(c);
    gain.gain.setTargetAtTime(0, c, tau);
    for (const a of arrets) {
      try { a.stop(c + tau * 6 + 0.05); } catch { /* déjà arrêté */ }
    }
  };

  return {
    tir(arme, position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const v = 0.92 + Math.random() * 0.16;
      PROFILS_TIR[arme](briques, out, t, v);
    },
    recharge(arme) {
      if (!prete()) return;
      const t = ctx!.currentTime;
      for (const c of CLICS_RECHARGE[arme]) clic(master!, t + c.t, c.f, c.g);
    },
    touche(tete = false) {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      if (tete) {
        // Tir à la tête : le tic est plus aigu, plus sec, avec un petit « ting » de casque.
        ton(master!, t, { dur: 0.03, type: "square", f0: 3000, gain: 0.28 });
        ton(master!, t + 0.03, { dur: 0.05, type: "sine", f0: 4200, gain: 0.22 });
        ton(master!, t + 0.03, { dur: 0.18, type: "triangle", f0: 2100, f1: 1900, gain: 0.07 });
        return;
      }
      ton(master!, t, { dur: 0.03, type: "square", f0: 2400, gain: 0.25 });
      ton(master!, t + 0.035, { dur: 0.04, type: "sine", f0: 3200, gain: 0.2 });
    },
    kill() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      ton(master!, t, { dur: 0.55, type: "sine", f0: 988, gain: 0.35 });
      ton(master!, t + 0.07, { dur: 0.5, type: "sine", f0: 1480, gain: 0.25 });
      ton(master!, t + 0.07, { dur: 0.3, type: "triangle", f0: 2000, gain: 0.1 });
    },
    pas() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      const v = 0.85 + Math.random() * 0.3;
      bruit(master!, t, { dur: 0.07, type: "lowpass", f0: 380 * v, f1: 200, gain: 0.28 });
      ton(master!, t, { dur: 0.06, type: "sine", f0: 90 * v, f1: 60, gain: 0.25 });
    },
    mur(on) {
      if (!on) {
        if (!souffle || !ctx) return;
        const s = souffle;
        souffle = null;
        s.gain.gain.cancelScheduledValues(ctx.currentTime);
        s.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        s.src.stop(ctx.currentTime + 0.5);
        s.lfo.stop(ctx.currentTime + 0.5);
        return;
      }
      if (souffle || !prete()) return;
      const c = ctx!;
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = bruitBuf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 800;
      f.Q.value = 0.6;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.15);
      // Le souffle ondule : un LFO lent balaye le filtre.
      const lfo = c.createOscillator();
      lfo.frequency.value = 6.5;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 220;
      lfo.connect(lfoGain);
      lfoGain.connect(f.frequency);
      src.connect(f);
      f.connect(g);
      g.connect(master!);
      src.start(t, Math.random() * 0.9);
      lfo.start(t);
      souffle = { src, gain: g, lfo };
    },
    degat() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      ton(master!, t, { dur: 0.18, type: "sawtooth", f0: 140, f1: 50, gain: 0.45 });
      bruit(master!, t, { dur: 0.15, type: "lowpass", f0: 600, f1: 200, gain: 0.4 });
    },
    glisse(on) {
      if (!on) {
        if (!frottement) return;
        const f = frottement;
        frottement = null;
        eteindre(f.gain, [f.src], 0.07);
        return;
      }
      if (frottement || !prete()) return;
      const c = ctx!;
      const t = c.currentTime;
      // Frottement du tissu et des semelles sur le sol : bruit médium-grave dont le filtre redescend pendant la glissade.
      const src = c.createBufferSource();
      src.buffer = bruitBuf;
      src.loop = true;
      const filtre = c.createBiquadFilter();
      filtre.type = "bandpass";
      filtre.frequency.setValueAtTime(1100, t);
      filtre.frequency.exponentialRampToValueAtTime(420, t + 0.75);
      filtre.Q.value = 0.9;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.06);
      g.gain.linearRampToValueAtTime(0.1, t + 0.75);
      src.connect(filtre);
      filtre.connect(g);
      g.connect(master!);
      src.start(t, Math.random() * 0.9);
      frottement = { src, gain: g, filtre };
    },
    coup(touche, position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const v = 0.94 + Math.random() * 0.12;
      // Sifflement de la lame : bruit passe-bande qui monte puis retombe.
      bruit(out, t, { dur: 0.22, type: "bandpass", f0: 1200 * v, f1: 4200, q: 1.6, gain: 0.5, att: 0.06 });
      bruit(out, t + 0.1, { dur: 0.12, type: "highpass", f0: 5500, gain: 0.18, att: 0.04 });
      if (touche) {
        // Impact sur la chair : choc sourd et petit claquement humide.
        bruit(out, t + 0.12, { dur: 0.14, type: "lowpass", f0: 1400, f1: 220, gain: 0.9 });
        ton(out, t + 0.12, { dur: 0.16, type: "sine", f0: 150 * v, f1: 55, gain: 0.7 });
        bruit(out, t + 0.12, { dur: 0.03, type: "bandpass", f0: 2600, q: 1.2, gain: 0.35 });
      }
    },
    ramassage(genre) {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      if (genre === "soin") {
        // Carillon doux montant (do-mi-sol).
        [523, 659, 784].forEach((f, i) => ton(master!, t + i * 0.07, { dur: 0.45, type: "sine", f0: f, gain: 0.22 }));
        ton(master!, t + 0.14, { dur: 0.5, type: "triangle", f0: 1568, gain: 0.05 });
        return;
      }
      // Arme : carillon plus grave, cliquetis de culasse et petit éclat métallique.
      [330, 440, 554].forEach((f, i) => ton(master!, t + i * 0.08, { dur: 0.4, type: "triangle", f0: f, gain: 0.2 }));
      clic(master!, t + 0.05, 1500, 0.4);
      clic(master!, t + 0.2, 2100, 0.45);
      bruit(master!, t + 0.22, { dur: 0.15, type: "highpass", f0: 6000, gain: 0.15 });
    },
    regen() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      ton(master!, t, { dur: 0.09, type: "sine", f0: 880, f1: 990, gain: 0.07, att: 0.01 });
    },
    moteur(vitesse) {
      if (vitesse === null) {
        if (!moteurVoix) return;
        const m = moteurVoix;
        moteurVoix = null;
        eteindre(m.gain, [...m.oscs, m.grain], 0.12);
        return;
      }
      if (!moteurVoix && !prete()) return;
      const c = ctx;
      if (!c) return;
      const v = Math.min(Math.abs(vitesse), 40);
      // Ralenti ≈ 45 Hz, plein régime ≈ 150 Hz (fondamentale) ; le filtre s'ouvre avec la vitesse.
      const f = 45 + v * 2.6;
      if (!moteurVoix) {
        const g = c.createGain();
        g.gain.value = 0.0001;
        const filtre = c.createBiquadFilter();
        filtre.type = "lowpass";
        filtre.Q.value = 1.1;
        const o1 = c.createOscillator();
        o1.type = "sawtooth";
        const o2 = c.createOscillator();
        o2.type = "square";
        const og = c.createGain();
        og.gain.value = 0.35;
        o1.connect(filtre);
        o2.connect(og);
        og.connect(filtre);
        // Grain d'échappement : bruit grave en boucle.
        const grain = c.createBufferSource();
        grain.buffer = bruitBuf;
        grain.loop = true;
        const gf = c.createBiquadFilter();
        gf.type = "lowpass";
        gf.frequency.value = 260;
        const gg = c.createGain();
        gg.gain.value = 0.25;
        grain.connect(gf);
        gf.connect(gg);
        gg.connect(filtre);
        filtre.connect(g);
        g.connect(master!);
        o1.start();
        o2.start();
        grain.start(c.currentTime, Math.random() * 0.9);
        moteurVoix = { oscs: [o1, o2], gain: g, filtre, grain };
      }
      const m = moteurVoix;
      const now = c.currentTime;
      m.oscs[0].frequency.setTargetAtTime(f, now, 0.06);
      m.oscs[1].frequency.setTargetAtTime(f * 0.5, now, 0.06);
      m.filtre.frequency.setTargetAtTime(380 + v * 55, now, 0.08);
      m.gain.gain.setTargetAtTime(0.1 + Math.min(v / 40, 1) * 0.1, now, 0.1);
    },
    choc(force) {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      const k = Math.min(Math.max(force, 0), 1);
      bruit(master!, t, { dur: 0.12 + 0.2 * k, type: "lowpass", f0: 1800, f1: 160, gain: 0.5 + 0.5 * k });
      ton(master!, t, { dur: 0.15 + 0.2 * k, type: "sine", f0: 100, f1: 38, gain: 0.5 + 0.5 * k });
      // Tôle froissée : éclats métalliques proportionnels à la force.
      bruit(master!, t + 0.02, { dur: 0.1 + 0.1 * k, type: "bandpass", f0: 2400, f1: 1200, q: 1.2, gain: 0.15 + 0.35 * k });
    },
    klaxon() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      // Deux notes rapprochées (tierce), signal court.
      ton(master!, t, { dur: 0.32, type: "square", f0: 415, gain: 0.07, att: 0.01 });
      ton(master!, t, { dur: 0.32, type: "square", f0: 523, gain: 0.07, att: 0.01 });
    },
    dispose() {
      fini = true;
      if (typeof window !== "undefined") for (const g of GESTES) window.removeEventListener(g, reveiller, { capture: true });
      if (frottement) {
        try { frottement.src.stop(); } catch { /* déjà arrêté */ }
        frottement = null;
      }
      if (moteurVoix) {
        for (const o of [...moteurVoix.oscs, moteurVoix.grain]) {
          try { o.stop(); } catch { /* déjà arrêté */ }
        }
        moteurVoix = null;
      }
      if (souffle) {
        try { souffle.src.stop(); souffle.lfo.stop(); } catch { /* déjà arrêtés */ }
        souffle = null;
      }
      if (ctx) void ctx.close().catch(() => {});
      ctx = null;
      master = null;
      bruitBuf = null;
    },
  };
}
