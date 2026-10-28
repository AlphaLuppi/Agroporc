import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VENT_CHUTE, creerSons, intensiteVentChute, reglageVentChute } from "./sons";

/** Faux contexte audio (même principe que sons.test.ts) : compte les sources démarrées / arrêtées, sans produire de son. */
class FauxParam {
  value = 0;
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  cancelScheduledValues() { return this; }
  setTargetAtTime() { return this; }
}
const journal = { demarres: 0, arretes: 0 };
class FauxNoeud {
  type = "";
  buffer: unknown = null;
  loop = false;
  frequency = new FauxParam();
  gain = new FauxParam();
  Q = new FauxParam();
  pan = new FauxParam();
  threshold = new FauxParam();
  ratio = new FauxParam();
  connect() { return this; }
  start() { journal.demarres++; }
  stop() { journal.arretes++; }
}
class FauxAudioContext {
  currentTime = 0;
  state = "running";
  sampleRate = 48000;
  destination = new FauxNoeud();
  createGain() { return new FauxNoeud(); }
  createDynamicsCompressor() { return new FauxNoeud(); }
  createBiquadFilter() { return new FauxNoeud(); }
  createOscillator() { return new FauxNoeud(); }
  createBufferSource() { return new FauxNoeud(); }
  createStereoPanner() { return new FauxNoeud(); }
  createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

beforeEach(() => {
  journal.demarres = journal.arretes = 0;
  vi.stubGlobal("window", { AudioContext: FauxAudioContext, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("navigator", { userActivation: { hasBeenActive: true } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("vent de la chute libre : calculs", () => {
  it("silence sous le seuil, intensité 1 en piqué, croissante entre les deux", () => {
    expect(intensiteVentChute(0)).toBe(0);
    expect(intensiteVentChute(6.5)).toBe(0); // sous voile
    expect(intensiteVentChute(VENT_CHUTE.vitesseMin)).toBe(0);
    expect(intensiteVentChute(VENT_CHUTE.vitesseMax)).toBe(1);
    expect(intensiteVentChute(200)).toBe(1);
    let avant = 0;
    for (let v = 12; v <= 55; v += 1) {
      const k = intensiteVentChute(v);
      expect(k).toBeGreaterThanOrEqual(avant);
      avant = k;
    }
    expect(intensiteVentChute(35)).toBeGreaterThan(intensiteVentChute(20));
  });

  it("la vitesse est prise en valeur absolue et une valeur invalide donne le silence", () => {
    expect(intensiteVentChute(-45)).toBe(intensiteVentChute(45));
    expect(intensiteVentChute(Number.NaN)).toBe(0);
    expect(intensiteVentChute(Infinity)).toBe(0);
  });

  it("le gain et le filtre montent avec l'intensité, bornés", () => {
    const bas = reglageVentChute(0), haut = reglageVentChute(1);
    expect(haut.gain).toBeGreaterThan(bas.gain);
    expect(haut.filtre).toBeGreaterThan(bas.filtre);
    expect(reglageVentChute(5)).toEqual(haut);
    expect(reglageVentChute(Number.NaN)).toEqual(bas);
  });
});

describe("sons du Battle Royale", () => {
  it("le vent de chute démarre une seule boucle, suit la vitesse sans en recréer, et s'éteint à l'ouverture du parachute", () => {
    const sons = creerSons();
    sons.ventChute(40);
    expect(journal.demarres).toBe(1);
    sons.ventChute(48);
    sons.ventChute(55);
    expect(journal.demarres).toBe(1);
    sons.ventChute(6.5); // sous voile : plus de vent
    expect(journal.arretes).toBe(1);
    sons.ventChute(null);
    expect(journal.arretes).toBe(1);
    sons.ventChute(Number.NaN);
    expect(journal.demarres).toBe(1);
    sons.ventChute(40); // une nouvelle chute relance la boucle
    expect(journal.demarres).toBe(2);
    sons.dispose();
    expect(journal.arretes).toBe(2);
  });

  it("l'avertissement de zone est idempotent : une seule pulsation tant qu'on est hors zone, arrêtée au retour", () => {
    const sons = creerSons();
    sons.avertissementZone(false);
    expect(journal.arretes).toBe(0);
    sons.avertissementZone(true);
    const demarres = journal.demarres;
    expect(demarres).toBeGreaterThanOrEqual(2); // tonalité, LFO, grondement
    sons.avertissementZone(true);
    sons.avertissementZone(true);
    expect(journal.demarres).toBe(demarres);
    sons.avertissementZone(false);
    expect(journal.arretes).toBe(demarres);
    sons.avertissementZone(true);
    expect(journal.demarres).toBe(demarres * 2);
    sons.dispose();
    expect(journal.arretes).toBe(demarres * 2);
  });

  it("ouverture de voile, zone qui se resserre et usage des soins produisent du son (début et fin, bandage et potion)", () => {
    const sons = creerSons();
    const appels: [string, () => void][] = [
      ["voile", () => sons.voile()],
      ["zoneSeResserre", () => sons.zoneSeResserre()],
      ["bandage debut", () => sons.usageSoin("bandage", "debut")],
      ["bandage fin", () => sons.usageSoin("bandage", "fin")],
      ["potion debut", () => sons.usageSoin("potion", "debut")],
      ["potion fin", () => sons.usageSoin("potion", "fin")],
    ];
    for (const [nom, f] of appels) {
      const avant = journal.demarres;
      f();
      expect(journal.demarres, nom).toBeGreaterThan(avant);
    }
    sons.dispose();
  });

  it("sans contexte audio ni geste préalable, rien ne plante ni ne démarre", () => {
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: false } });
    const sons = creerSons();
    sons.ventChute(50);
    sons.voile();
    sons.avertissementZone(true);
    sons.zoneSeResserre();
    sons.usageSoin("bandage", "debut");
    expect(journal.demarres).toBe(0);
    sons.dispose();
  });
});
