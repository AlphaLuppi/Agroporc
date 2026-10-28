import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARMES } from "./protocole";
import { STATS } from "./armes";
import { VOIX_TIGRES_MAX, creerSons } from "./sons";
import { ECART_ANNONCES_S, ECHANTILLONS, URLS_ZOMBIES, VOIX_ANNONCES } from "./sons-echantillons";
import { ZOMBIES } from "./zombies-vagues";

/** Faux contexte audio : compte les sources démarrées / arrêtées et les nœuds créés, sans produire de son. */
class FauxParam {
  value = 0;
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  cancelScheduledValues() { return this; }
  setTargetAtTime() { return this; }
}
const journal = { demarres: 0, arretes: 0, noeuds: 0, fermes: 0, departs: [] as { t: number; decalage: number; buffer: unknown }[] };
class FauxNoeud {
  type = "";
  buffer: unknown = null;
  loop = false;
  frequency = new FauxParam();
  gain = new FauxParam();
  Q = new FauxParam();
  pan = new FauxParam();
  playbackRate = new FauxParam();
  threshold = new FauxParam();
  ratio = new FauxParam();
  constructor() { journal.noeuds++; }
  connect() { return this; }
  start(t = 0, decalage = 0) { journal.demarres++; journal.departs.push({ t, decalage, buffer: this.buffer }); }
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
  journal.departs = [];
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

/** Faux son décodé : `duree` s à 1 kHz, une crête à `pic` s. */
function fauxBuffer(duree: number, pic: number) {
  const d = new Float32Array(Math.round(duree * 1000));
  d[Math.round(pic * 1000)] = 1;
  return { duration: duree, sampleRate: 1000, getChannelData: () => d, url: "" };
}
/** fetch qui sert chaque URL connue (et compte les demandes), et decodeAudioData qui rend le faux son de cette URL. */
function servirEchantillons(sons: Record<string, { duree: number; pic: number }>) {
  const demandes: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    demandes.push(url);
    if (!sons[url]) return Promise.resolve({ ok: false, status: 404 });
    const octets = new ArrayBuffer(8) as ArrayBuffer & { url?: string };
    octets.url = url;
    return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(octets) });
  });
  (FauxAudioContext.prototype as unknown as { decodeAudioData: unknown }).decodeAudioData = (b: ArrayBuffer & { url: string }) => {
    const f = fauxBuffer(sons[b.url].duree, sons[b.url].pic);
    f.url = b.url;
    return Promise.resolve(f);
  };
  return demandes;
}
const attendre = () => new Promise((r) => setTimeout(r, 0));

describe("sons : échantillons du mode zombies", () => {
  afterEach(() => { delete (FauxAudioContext.prototype as unknown as { decodeAudioData?: unknown }).decodeAudioData; });

  it("sans fichier (404, réseau), chaque son nommé joue son repli synthétisé, sans planter", async () => {
    servirEchantillons({});
    const sons = creerSons();
    sons.prechargerZombies();
    await attendre();
    const appels: [string, () => unknown][] = [
      ["tonnerre", () => sons.tonnerre()], ["rireTruck", () => sons.rireTruck(undefined, 1)], ["explosionGrenade", () => sons.explosionGrenade({ distance: 10, pan: 0 })],
      ["rebondGrenade", () => sons.rebondGrenade(undefined, 0.3)], ["microOndesCuisson", () => sons.microOndesCuisson()], ["microOndesBip", () => sons.microOndesBip()],
      ["griffeChef", () => sons.griffeChef({ distance: 3, pan: 0.2 })], ["grognementChef", () => sons.grognementChef()], ["fanfareBonus", () => sons.fanfareBonus()],
      ["microondes", () => sons.microondes(true)], ["bonus", () => sons.bonus(true)],
    ];
    for (const [nom, f] of appels) {
      const avant = journal.demarres;
      f();
      expect(journal.demarres, nom).toBeGreaterThan(avant);
    }
    expect(sons.echantillon("tonnerre")).toBe(false);
    sons.dispose();
  });

  it("préchargement : tous les fichiers sont demandés une seule fois, avant même le premier son", () => {
    const demandes = servirEchantillons({});
    const sons = creerSons();
    sons.prechargerZombies();
    sons.prechargerZombies();
    expect([...demandes].sort()).toEqual([...URLS_ZOMBIES].sort());
    sons.dispose();
  });

  it("le coup de patte du chef est calé : le pic du fichier tombe au contact (griffeArmeS)", async () => {
    const url = ECHANTILLONS.griffeChef.url;
    servirEchantillons({ [url]: { duree: 1.2, pic: 0.2 } });
    const sons = creerSons();
    sons.prechargerZombies();
    await attendre(); await attendre();
    journal.departs = [];
    sons.griffeChef();
    const d = journal.departs.filter((x) => (x.buffer as { url?: string } | null)?.url === url);
    expect(d).toHaveLength(1);
    expect(d[0].t + 0.2 - d[0].decalage).toBeCloseTo(ZOMBIES.griffeArmeS, 2);
    // un pic plus tardif que le contact : on saute le début du fichier
    sons.dispose();
    servirEchantillons({ [url]: { duree: 1.2, pic: 0.9 } });
    const s2 = creerSons();
    s2.prechargerZombies();
    await attendre(); await attendre();
    journal.departs = [];
    s2.griffeChef();
    const d2 = journal.departs.filter((x) => (x.buffer as { url?: string } | null)?.url === url);
    expect(d2[0].decalage).toBeCloseTo(0.9 - ZOMBIES.griffeArmeS, 2);
    expect(d2[0].t).toBeLessThan(0.01);
    s2.dispose();
  });

  it("limite de voix : au-delà de `voixMax` lectures du même son, la suivante est ignorée (pas de repli)", async () => {
    const url = ECHANTILLONS.rebondGrenade.url;
    servirEchantillons({ [url]: { duree: 0.3, pic: 0 } });
    const sons = creerSons();
    sons.prechargerZombies();
    await attendre(); await attendre();
    const avant = journal.demarres;
    for (let i = 0; i < ECHANTILLONS.rebondGrenade.voixMax + 3; i++) sons.rebondGrenade();
    expect(journal.demarres - avant).toBe(ECHANTILLONS.rebondGrenade.voixMax);
    sons.dispose();
  });

  it("annonces échantillonnées : enchaînées sans se couper, file bornée", async () => {
    servirEchantillons({ [VOIX_ANNONCES.munitions.url]: { duree: 1, pic: 0 }, [VOIX_ANNONCES.double.url]: { duree: 0.8, pic: 0 } });
    const parle = vi.fn();
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
    (globalThis.window as unknown as Record<string, unknown>).speechSynthesis = { speak: parle, cancel: vi.fn(), getVoices: () => [] };
    const sons = creerSons();
    sons.prechargerZombies();
    await attendre(); await attendre();
    journal.departs = [];
    sons.voix("munitions");
    sons.voix("double");
    sons.voix("double");
    sons.voix("double"); // une qui parle, deux en attente : la file est pleine, celle-ci est abandonnée
    const t = journal.departs.map((d) => d.t);
    expect(t).toHaveLength(3);
    expect(t[0]).toBeCloseTo(0);
    expect(t[1]).toBeCloseTo(1 + ECART_ANNONCES_S);
    expect(t[2]).toBeCloseTo(1 + 0.8 + 2 * ECART_ANNONCES_S);
    expect(parle).not.toHaveBeenCalled();
    sons.dispose();
    // seule, une annonce attend la fin de la fanfare
    const s2 = creerSons();
    s2.prechargerZombies();
    await attendre(); await attendre();
    journal.departs = [];
    s2.voix("munitions", 0.35);
    expect(journal.departs.map((d) => d.t)).toEqual([0.35]);
    s2.dispose();
  });

  it("repli de la voix du navigateur : attend la liste des voix, prend une voix française, ne coupe jamais l'annonce en cours", async () => {
    vi.useFakeTimers();
    servirEchantillons({});
    const dits: { text: string; voice?: unknown }[] = [];
    const cancel = vi.fn();
    let voix: { lang: string; localService: boolean; name: string }[] = [];
    const ecouteurs: (() => void)[] = [];
    vi.stubGlobal("SpeechSynthesisUtterance", class { voice?: unknown; constructor(public text: string) {} });
    (globalThis.window as unknown as Record<string, unknown>).speechSynthesis = {
      speak: (u: { text: string; voice?: unknown }) => dits.push(u), cancel, getVoices: () => voix,
      addEventListener: (_: string, f: () => void) => ecouteurs.push(f), removeEventListener() {},
    };
    const sons = creerSons();
    sons.voix("instakill");
    vi.advanceTimersByTime(300);
    expect(dits).toHaveLength(0); // la liste des voix n'est pas encore là
    voix = [{ lang: "en-US", localService: true, name: "Alex" }, { lang: "fr-CA", localService: true, name: "Amélie" }, { lang: "fr-FR", localService: true, name: "Thomas" }];
    for (const f of ecouteurs) f();
    expect(dits.map((u) => u.text)).toEqual([VOIX_ANNONCES.instakill.texte]);
    expect((dits[0].voice as { name: string }).name).toBe("Thomas");
    sons.voix("double");
    vi.advanceTimersByTime(300);
    expect(dits).toHaveLength(2);
    expect(cancel).not.toHaveBeenCalled();
    sons.dispose();
    vi.useRealTimers();
  });
});

