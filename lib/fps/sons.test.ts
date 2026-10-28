import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARMES } from "./protocole";
import { STATS } from "./armes";
import { VOIX_TIGRES_MAX, creerSons } from "./sons";

/** Faux contexte audio : compte les sources démarrées / arrêtées et les nœuds créés, sans produire de son. */
class FauxParam {
  value = 0;
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  cancelScheduledValues() { return this; }
  setTargetAtTime() { return this; }
}
const journal = { demarres: 0, arretes: 0, noeuds: 0, fermes: 0 };
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
  constructor() { journal.noeuds++; }
  connect() { return this; }
  start() { journal.demarres++; }
  stop() { journal.arretes++; }
}
class FauxAudioContext {
  static derniere: FauxAudioContext | null = null;
  constructor() { FauxAudioContext.derniere = this; }
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
  close() { journal.fermes++; return Promise.resolve(); }
}

beforeEach(() => {
  journal.demarres = journal.arretes = journal.noeuds = journal.fermes = 0;
  vi.stubGlobal("window", { AudioContext: FauxAudioContext, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("navigator", { userActivation: { hasBeenActive: true } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("sons : profils de tir et de rechargement", () => {
  it("chaque arme à feu produit du son au tir, local comme distant", () => {
    const sons = creerSons();
    for (const id of ARMES) {
      const avant = journal.demarres;
      sons.tir(id);
      expect(journal.demarres, `${id} (local)`).toBeGreaterThan(avant);
      const avantDistant = journal.demarres;
      sons.tir(id, { distance: 80, pan: -0.4 });
      expect(journal.demarres, `${id} (distant)`).toBeGreaterThan(avantDistant);
    }
    sons.dispose();
  });

  it("le rechargement sonne pour les armes qui se rechargent, jamais pour les spéciales (sansRecharge)", () => {
    const sons = creerSons();
    for (const id of ARMES) {
      const avant = journal.demarres;
      sons.recharge(id);
      if (STATS[id].sansRecharge) expect(journal.demarres, id).toBe(avant);
      else expect(journal.demarres, id).toBeGreaterThan(avant);
    }
    sons.dispose();
  });

  it("le rechargement long de la mitrailleuse dépasse celui du pistolet en nombre de clics", () => {
    const sons = creerSons();
    const mesure = (id: (typeof ARMES)[number]) => { const a = journal.demarres; sons.recharge(id); return journal.demarres - a; };
    expect(mesure("mitrailleuse")).toBeGreaterThan(mesure("pistolet"));
    sons.dispose();
  });
});

describe("sons : effets ajoutés par la v2", () => {
  it("touche (corps et tête), coup de couteau (dans le vide et sur la chair), ramassage, régénération, choc, klaxon", () => {
    const sons = creerSons();
    const essais: [string, () => void][] = [
      ["touche corps", () => sons.touche()],
      ["touche tête", () => sons.touche(true)],
      ["coup dans le vide", () => sons.coup(false)],
      ["coup sur la chair", () => sons.coup(true)],
      ["coup distant", () => sons.coup(true, { distance: 12, pan: 0.3 })],
      ["ramassage soin", () => sons.ramassage("soin")],
      ["ramassage arme", () => sons.ramassage("arme")],
      ["régénération", () => sons.regen()],
      ["choc léger", () => sons.choc(0)],
      ["choc fort", () => sons.choc(1)],
      ["choc hors bornes", () => sons.choc(7)],
      ["klaxon", () => sons.klaxon()],
    ];
    for (const [nom, f] of essais) {
      const avant = journal.demarres;
      f();
      expect(journal.demarres, nom).toBeGreaterThan(avant);
    }
    sons.dispose();
  });

  it("l'épée sonne (dans le vide, sur la chair, distante), sans contexte audio rien ne plante, et dépasse le couteau", () => {
    const sons = creerSons();
    const mesure = (f: () => void) => { const a = journal.demarres; f(); return journal.demarres - a; };
    expect(mesure(() => sons.coup(false, undefined, "epee"))).toBeGreaterThan(0);
    expect(mesure(() => sons.coup(true, undefined, "epee"))).toBeGreaterThan(mesure(() => sons.coup(false, undefined, "epee")));
    expect(mesure(() => sons.coup(true, { distance: 15, pan: -0.5 }, "epee"))).toBeGreaterThan(0);
    // l'épée tinte en plus du sifflement
    expect(mesure(() => sons.coup(false, undefined, "epee"))).toBeGreaterThan(mesure(() => sons.coup(false, undefined, "couteau")));
    // appel explicite du couteau = appel par défaut
    expect(mesure(() => sons.coup(true, undefined, "couteau"))).toBe(mesure(() => sons.coup(true)));
    sons.dispose();
  });

  it("sans WebAudio, le coup d'épée est sans effet et ne plante pas", () => {
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
    const sons = creerSons();
    expect(() => sons.coup(true, undefined, "epee")).not.toThrow();
    sons.dispose();
  });

  it("le coup qui touche fait plus de bruit que celui qui rate", () => {
    const sons = creerSons();
    let a = journal.demarres;
    sons.coup(false);
    const rate = journal.demarres - a;
    a = journal.demarres;
    sons.coup(true);
    expect(journal.demarres - a).toBeGreaterThan(rate);
    sons.dispose();
  });

  it("la glissade est une boucle : un seul démarrage tant qu'elle dure, arrêt à `false`, `false` seul sans effet", () => {
    const sons = creerSons();
    sons.glisse(false);
    expect(journal.arretes).toBe(0);
    sons.glisse(true);
    const apres = journal.demarres;
    expect(apres).toBeGreaterThan(0);
    sons.glisse(true);
    expect(journal.demarres).toBe(apres);
    sons.glisse(false);
    expect(journal.arretes).toBeGreaterThan(0);
    sons.dispose();
  });

  it("le moteur démarre une fois, ne fait que suivre la vitesse ensuite, s'éteint avec `null` et accepte une vitesse négative", () => {
    const sons = creerSons();
    sons.moteur(null);
    expect(journal.demarres).toBe(0);
    sons.moteur(0);
    const demarres = journal.demarres;
    expect(demarres).toBeGreaterThanOrEqual(2); // repli synthétisé (boucle pas encore chargée) : un oscillateur + le grain d'échappement
    sons.moteur(12);
    sons.moteur(-20);
    sons.moteur(200);
    expect(journal.demarres).toBe(demarres);
    sons.moteur(null);
    expect(journal.arretes).toBeGreaterThanOrEqual(2);
    sons.moteur(5); // redémarre proprement
    expect(journal.demarres).toBeGreaterThan(demarres);
    sons.dispose();
  });

  it("crissement des pneus : démarre au premier dérapage, suit l'intensité sans rien relancer, s'éteint à 0", () => {
    const sons = creerSons();
    sons.derapage(0);
    sons.derapage(Number.NaN);
    expect(journal.demarres).toBe(0);
    sons.derapage(0.5);
    const demarres = journal.demarres;
    expect(demarres).toBe(1);
    sons.derapage(1);
    sons.derapage(7);
    expect(journal.demarres).toBe(demarres);
    sons.derapage(0);
    expect(journal.arretes).toBe(1);
    sons.dispose();
  });

  it("`dispose` arrête les boucles en cours, ferme le contexte et rend tout appel muet", () => {
    const sons = creerSons();
    sons.glisse(true);
    sons.moteur(10);
    sons.mur(true);
    sons.dispose();
    expect(journal.fermes).toBe(1);
    const avant = journal.demarres;
    sons.tir("pistolet");
    sons.coup(true);
    sons.moteur(10);
    sons.glisse(true);
    expect(journal.demarres).toBe(avant);
  });
});

describe("sons : tigres et avion", () => {
  it("rugissement, coup de patte et plainte sonnent, proches comme lointains", () => {
    const sons = creerSons();
    for (const [nom, f] of [["rugissement", sons.rugissement], ["patte", sons.patte], ["plainte", sons.plainte]] as const) {
      let avant = journal.demarres;
      f();
      expect(journal.demarres, nom).toBeGreaterThan(avant);
      avant = journal.demarres;
      f({ distance: 40, pan: 0.6 });
      expect(journal.demarres, `${nom} lointain`).toBeGreaterThan(avant);
    }
    sons.dispose();
  });

  it("l'avion est une boucle : un démarrage, puis il ne fait que suivre la position, `null` l'éteint, `dispose` aussi", () => {
    const sons = creerSons();
    sons.avion(null);
    expect(journal.demarres).toBe(0);
    sons.avion({ distance: 300, pan: -1 });
    const demarres = journal.demarres;
    expect(demarres).toBeGreaterThanOrEqual(3); // deux hélices + le souffle
    sons.avion({ distance: 120, pan: 0.2 });
    sons.avion({ distance: 0, pan: 4 });
    expect(journal.demarres).toBe(demarres);
    sons.avion(null);
    expect(journal.arretes).toBeGreaterThanOrEqual(3);
    sons.avion({ distance: 200, pan: 0 });
    const arretes = journal.arretes;
    sons.dispose();
    expect(journal.arretes).toBeGreaterThan(arretes);
  });
});

describe("sons : sans WebAudio", () => {
  it("tous les appels sont sans effet", () => {
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
    const sons = creerSons();
    expect(() => {
      sons.tir("railgun");
      sons.recharge("pompe");
      sons.touche(true);
      sons.coup(true);
      sons.glisse(true);
      sons.glisse(false);
      sons.moteur(10);
      sons.moteur(null);
      sons.ramassage("arme");
      sons.regen();
      sons.choc(1);
      sons.klaxon();
      sons.rugissement();
      sons.patte({ distance: 5, pan: 0 });
      sons.plainte();
      sons.avion({ distance: 100, pan: 0 });
      sons.avion(null);
      sons.dispose();
    }).not.toThrow();
    expect(journal.demarres).toBe(0);
  });
});



describe("sons du mode zombies", () => {
  it("rugissement de tigre : spatialisé, au plus 4 voix en même temps, de nouveau libre une fois les voix finies", () => {
    const sons = creerSons();
    expect(VOIX_TIGRES_MAX).toBe(4);
    const joues: boolean[] = [];
    for (let i = 0; i < 6; i++) joues.push(sons.rugissementTigre({ distance: 30, pan: 0.5 }));
    expect(joues).toEqual([true, true, true, true, false, false]);
    // le cri de mort compte aussi comme une voix
    expect(sons.rugissementTigre({ distance: 10, pan: 0 }, true)).toBe(false);
    // 1,5 s plus tard (horloge audio) les voix sont finies
    FauxAudioContext.derniere!.currentTime = 1.5;
    expect(sons.rugissementTigre(undefined, true)).toBe(true);
    const avant = journal.demarres;
    expect(sons.rugissementTigre({ distance: 80, pan: -1 })).toBe(true);
    expect(journal.demarres).toBeGreaterThan(avant);
    sons.dispose();
  });

  it("griffe, achat accepté / refusé, pièce et nouvelle manche produisent du son", () => {
    const sons = creerSons();
    for (const jouer of [
      () => sons.griffe(), () => sons.griffe({ distance: 12, pan: 0.2 }), () => sons.achat(true), () => sons.achat(false), () => sons.piece(), () => sons.manche(),
    ]) {
      const avant = journal.demarres;
      jouer();
      expect(journal.demarres).toBeGreaterThan(avant);
    }
    sons.dispose();
  });

  it("sans contexte audio (navigateur sans WebAudio), tout est sans effet et le rugissement renvoie faux", () => {
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("navigator", {});
    const sons = creerSons();
    expect(sons.rugissementTigre()).toBe(false);
    expect(() => { sons.griffe(); sons.achat(true); sons.piece(); sons.manche(); }).not.toThrow();
    sons.dispose();
  });
});
