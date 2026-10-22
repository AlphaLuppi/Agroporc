/**
 * Sons de l'arène FPS, tous synthétisés avec WebAudio (bruit filtré + oscillateurs + enveloppes) :
 * aucun fichier audio. Le contexte audio n'est créé qu'au premier geste de l'utilisateur (politique
 * d'autoplay des navigateurs) ; avant cela, et si WebAudio manque, tous les appels sont sans effet.
 *
 * Les tirs lointains passent `position` : le gain baisse avec la distance, les aigus s'éteignent et
 * `pan` (−1 gauche … 1 droite, calculé par jeu.ts d'après l'angle du tireur) place le son.
 */
import type { ArmeId } from "./protocole";

export interface PositionSon {
  /** distance au tireur (m) */
  distance: number;
  /** −1 = à gauche, 1 = à droite */
  pan: number;
}

export interface Sons {
  /** Tir d'une arme ; `position` pour un tir d'un autre joueur (omis = son du joueur local). */
  tir(arme: ArmeId, position?: PositionSon): void;
  /** Séquence de rechargement (clics de chargeur, culasse, cartouches). */
  recharge(arme: ArmeId): void;
  /** J'ai touché quelqu'un (tic). */
  touche(): void;
  /** J'ai tué quelqu'un (ding). */
  kill(): void;
  pas(): void;
  /** Souffle du wall-run : `true` le lance (en boucle), `false` l'éteint. */
  mur(on: boolean): void;
  /** J'ai été touché. */
  degat(): void;
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
const CLICS_RECHARGE: Record<ArmeId, { t: number; f: number; g: number }[]> = {
  pistolet: [{ t: 0.2, f: 1200, g: 0.35 }, { t: 0.85, f: 1700, g: 0.45 }, { t: 1.1, f: 2300, g: 0.4 }],
  mitraillette: [{ t: 0.3, f: 1100, g: 0.4 }, { t: 1.3, f: 1600, g: 0.5 }, { t: 1.75, f: 2200, g: 0.4 }],
  pompe: [
    { t: 0.4, f: 1400, g: 0.35 }, { t: 0.78, f: 1400, g: 0.35 }, { t: 1.15, f: 1400, g: 0.35 },
    { t: 1.5, f: 1400, g: 0.35 }, { t: 1.85, f: 1400, g: 0.35 }, { t: 2.15, f: 900, g: 0.55 },
  ],
  sniper: [
    { t: 0.3, f: 1500, g: 0.4 }, { t: 0.5, f: 1100, g: 0.4 }, { t: 1.1, f: 1000, g: 0.4 },
    { t: 1.9, f: 1500, g: 0.5 }, { t: 2.4, f: 1100, g: 0.4 }, { t: 2.6, f: 1800, g: 0.5 },
  ],
};

export function creerSons(): Sons {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let bruitBuf: AudioBuffer | null = null;
  let fini = false;
  let souffle: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null;

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

  return {
    tir(arme, position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const v = 0.92 + Math.random() * 0.16;
      switch (arme) {
        case "pistolet":
          bruit(out, t, { dur: 0.11, type: "bandpass", f0: 2600 * v, f1: 900, q: 0.8, gain: 0.9 });
          bruit(out, t, { dur: 0.03, type: "highpass", f0: 5000, gain: 0.5 });
          ton(out, t, { dur: 0.12, type: "sine", f0: 190 * v, f1: 55, gain: 0.7 });
          break;
        case "mitraillette":
          bruit(out, t, { dur: 0.07, type: "bandpass", f0: 2200 * v, f1: 1100, q: 0.9, gain: 0.65 });
          bruit(out, t, { dur: 0.02, type: "highpass", f0: 4500, gain: 0.35 });
          ton(out, t, { dur: 0.06, type: "sine", f0: 150 * v, f1: 70, gain: 0.5 });
          break;
        case "pompe":
          bruit(out, t, { dur: 0.32, type: "lowpass", f0: 2500 * v, f1: 250, gain: 1 });
          bruit(out, t, { dur: 0.08, type: "bandpass", f0: 1800, q: 0.6, gain: 0.7 });
          ton(out, t, { dur: 0.3, type: "sine", f0: 95 * v, f1: 32, gain: 1 });
          clic(out, t + 0.45, 1300, 0.45);
          clic(out, t + 0.6, 1800, 0.5);
          break;
        case "sniper":
          bruit(out, t, { dur: 0.6, type: "lowpass", f0: 4000 * v, f1: 200, gain: 1 });
          bruit(out, t, { dur: 0.06, type: "highpass", f0: 3000, gain: 0.8 });
          ton(out, t, { dur: 0.5, type: "sine", f0: 80 * v, f1: 28, gain: 1 });
          bruit(out, t + 0.16, { dur: 0.5, type: "lowpass", f0: 900, f1: 200, gain: 0.35 }); // écho dans la vallée
          clic(out, t + 0.55, 1500, 0.4);
          clic(out, t + 0.8, 1100, 0.45);
          break;
      }
    },
    recharge(arme) {
      if (!prete()) return;
      const t = ctx!.currentTime;
      for (const c of CLICS_RECHARGE[arme]) clic(master!, t + c.t, c.f, c.g);
    },
    touche() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
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
    dispose() {
      fini = true;
      if (typeof window !== "undefined") for (const g of GESTES) window.removeEventListener(g, reveiller, { capture: true });
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
