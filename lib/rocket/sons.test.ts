import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BALLE, DEFAUT_CONFIG, PLOTS, VOITURE, creerRng, type EtatVoiture, type EvenementMatch, type MondeRocket } from "./contrat";
import { creerSonsRocket } from "./sons";
import {
  MOTEUR, choisirMoteurs, coupureMoteur, dureeGraveChoc, echelleEvenement, frequenceGraveChoc, frequenceMoteur, gainChoc, gainMoteur, gainSouffleBoost,
  panoramique, tempsFeuArtifice, voitureDe,
} from "./sons-modele";
import { baseDepuisCap, copierBase, type Vec3 } from "./vec";

// ---------- AudioContext factice : enregistre ce que le moteur construit ----------
class FauxParam {
  value = 0;
  /** plus grande valeur atteinte par une rampe (le pic de l'enveloppe) */
  pic = 0;
  historique: string[] = [];
  setValueAtTime(v: number) { this.value = v; this.historique.push("set"); return this; }
  linearRampToValueAtTime(v: number) { this.value = v; this.pic = Math.max(this.pic, v); return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
  setTargetAtTime(v: number) { this.value = v; this.historique.push("cible"); return this; }
  cancelScheduledValues() { return this; }
}
class FauxNoeud {
  connexions: unknown[] = [];
  arrete = false;
  demarre = false;
  onended: (() => void) | null = null;
  frequency = new FauxParam();
  gain = new FauxParam();
  Q = new FauxParam();
  pan = new FauxParam();
  type = "";
  buffer: unknown = null;
  loop = false;
  connect(n: unknown) { this.connexions.push(n); return n; }
  disconnect() {}
  start() { this.demarre = true; }
  stop() { this.arrete = true; this.onended?.(); }
}
class FauxContexte {
  static instances: FauxContexte[] = [];
  currentTime = 0;
  sampleRate = 8000;
  state = "running";
  destination = new FauxNoeud();
  noeuds: { genre: string; n: FauxNoeud }[] = [];
  suspendu = 0; relance = 0; ferme = false;
  constructor() { FauxContexte.instances.push(this); }
  private cree(genre: string): FauxNoeud { const n = new FauxNoeud(); this.noeuds.push({ genre, n }); return n; }
  createGain() { return this.cree("gain"); }
  createOscillator() { return this.cree("osc"); }
  createBiquadFilter() { return this.cree("filtre"); }
  createBufferSource() { return this.cree("source"); }
  createStereoPanner() { return this.cree("pan"); }
  createDynamicsCompressor() { return this.cree("comp"); }
  createBuffer(_c: number, n: number) { const d = new Float32Array(n); return { getChannelData: () => d, length: n }; }
  suspend() { this.suspendu++; this.state = "suspended"; return Promise.resolve(); }
  resume() { this.relance++; this.state = "running"; return Promise.resolve(); }
  close() { this.ferme = true; return Promise.resolve(); }
  compte(genre: string) { return this.noeuds.filter((x) => x.genre === genre).length; }
}

function voiture(id: number, p: Vec3, cap = 0, equipe: "bleue" | "orange" = "bleue"): EtatVoiture {
  return {
    id, equipe, slot: 0, humain: id === 0, nom: `V${id}`, p, v: [0, 0, 0], w: [0, 0, 0], base: baseDepuisCap(cap), boost: 33, rouesContact: 4, normaleSurface: [0, 1, 0],
    auSol: true, saut: { aSaute: false, temps: 0, tenue: false, secondUtilise: false, tempsEnLAir: 0, depuisFinSaut: 0 }, flip: { actif: false, temps: 0, dir: [0, 0], stall: false, verrouTangage: 0 },
    redressement: { actif: false, temps: 0, signe: 1 }, contactMonde: { actif: false, normale: [0, 1, 0] }, supersoniqueDepuis: 0, frein: 0,
    pneus: { angle: 0, moteur: 0, frein: 0, lat: [0, 0, 0, 0], long: [0, 0, 0, 0] }, supersonique: false, boostActif: false, boostDepuis: 0, derapage: false, demolie: false, reapparitionDans: 0, figee: false,
    dernierContactBalleTick: -1000, derniereImpulsionPsyonixTick: -1000, bumpAutreId: -1, bumpDelaiTick: -1000, rouesBalle: [false, false, false, false],
    normalesRouesBalle: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], vitesseEnAttente: [0, 0, 0], sautPrecedent: false, stats: { buts: 0, passes: 0, arrets: 0, tirs: 0, demolitions: 0, demolie: 0, touches: 0, points: 0 },
  };
}
function monde(positions: Vec3[]): MondeRocket {
  const voitures = positions.map((p, i) => voiture(i, p, 0, i < positions.length / 2 ? "bleue" : "orange"));
  return {
    config: DEFAUT_CONFIG(), arene: {} as MondeRocket["arene"], tick: 0, temps: 0, phase: "enJeu", tempsPhase: 0, tempsRestant: 300, prolongation: false, attenteSolBalle: false,
    score: { bleue: 0, orange: 0 }, dernierBut: null, voitures, idHumain: 0,
    balle: { p: [0, BALLE.hauteurEngagement, 0], v: [0, 0, 0], w: [0, 0, 0], dernierToucheur: null, avantDernierToucheur: null, vitesseEnAttente: [0, 0, 0] },
    plots: PLOTS.map((p) => ({ id: p.id, actif: true, recharge: 0, verrou: -1 })), rng: creerRng(1),
    precedent: { voitures: voitures.map((v) => ({ p: [...v.p] as Vec3, base: copierBase(v.base) })), balle: { p: [0, 1, 0] } }, vainqueur: null,
  };
}
const SIX: Vec3[] = [[0, 0.2, 0], [5, 0.2, 0], [15, 0.2, 10], [-30, 0.2, 5], [40, 0.2, 30], [-20, 0.2, -50]];

describe("sons : décisions pures", () => {
  it("la hauteur du moteur monte de 46 à 132 Hz avec la vitesse (un grondement grave), plus haute sous boost", () => {
    expect(frequenceMoteur(0, false)).toBeCloseTo(46, 9);
    expect(frequenceMoteur(VOITURE.vitesseMax, false)).toBeCloseTo(132, 9);
    expect(frequenceMoteur(30, false)).toBeCloseTo(132, 9);
    expect(frequenceMoteur(VOITURE.vitesseMax, true)).toBeLessThan(150);
    expect(frequenceMoteur(10, false)).toBeGreaterThan(frequenceMoteur(5, false));
    expect(frequenceMoteur(10, true)).toBeGreaterThan(frequenceMoteur(10, false));
    expect(coupureMoteur(20)).toBeGreaterThan(coupureMoteur(2));
  });
  it("le volume suit 1/distance et se coupe hors portée, la voiture du joueur reste audible", () => {
    expect(gainMoteur(5, false, false, 10)).toBeGreaterThan(gainMoteur(30, false, false, 10));
    expect(gainMoteur(MOTEUR.rayonAudible + 1, false, false, 10)).toBe(0);
    expect(gainMoteur(0, true, false, 0)).toBeGreaterThan(0);
    expect(gainMoteur(0, true, true, 10)).toBeGreaterThan(gainMoteur(0, true, false, 10));
    expect(gainSouffleBoost(0, true)).toBeGreaterThan(gainSouffleBoost(40, false));
  });
  it("seulement les 3 voitures les plus proches, la sienne d'abord, jamais une démolie", () => {
    const m = monde(SIX);
    expect(choisirMoteurs(m, 0)).toEqual([0, 1, 2]);
    m.voitures[1].demolie = true;
    expect(choisirMoteurs(m, 0)).toEqual([0, 2, 3]);
    m.voitures[0].demolie = true;
    expect(choisirMoteurs(m, 0)).toEqual([2, 3, 4]);
  });
  it("panoramique : à droite de l'auditeur = positif", () => {
    const moi = voiture(0, [0, 0, 0], 0);
    // cap 0 : l'avant est +Z, la droite est -X
    expect(panoramique(moi, voiture(1, [-10, 0, 0]))).toBeGreaterThan(0.3);
    expect(panoramique(moi, voiture(1, [10, 0, 0]))).toBeLessThan(-0.3);
    expect(panoramique(moi, voiture(1, [0, 0, 10]))).toBeCloseTo(0, 6);
    expect(Math.abs(panoramique(moi, voiture(1, [-1000, 0, 0])))).toBeLessThanOrEqual(1);
  });
  it("les chocs : plus la balle est frappée fort, plus le son est fort, grave et long", () => {
    expect(gainChoc(0)).toBe(0);
    expect(gainChoc(46)).toBe(1);
    expect(gainChoc(30)).toBeGreaterThan(gainChoc(5));
    expect(frequenceGraveChoc(40)).toBeLessThan(frequenceGraveChoc(5));
    expect(dureeGraveChoc(40)).toBeGreaterThan(dureeGraveChoc(5));
    expect(echelleEvenement(0, 0)).toBe(1);
    expect(echelleEvenement(3, 0)).toBeLessThan(1);
  });
  it("identifie la voiture d'un événement et planifie un feu d'artifice déterministe", () => {
    expect(voitureDe({ t: "saut", idVoiture: 4 })).toBe(4);
    expect(voitureDe({ t: "demolition", victime: 1, auteur: 3, p: [0, 0, 0] })).toBe(3);
    expect(voitureDe({ t: "chronoZero" })).toBeNull();
    const t = tempsFeuArtifice(7);
    expect(t).toHaveLength(7);
    expect(tempsFeuArtifice(7)).toEqual(t);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(Math.max(...t)).toBeLessThan(2.5);
  });
});

describe("sons : synthèse WebAudio", () => {
  const g = globalThis as unknown as { AudioContext?: unknown };
  const avant = g.AudioContext;
  beforeEach(() => { FauxContexte.instances = []; g.AudioContext = FauxContexte; });
  afterEach(() => { g.AudioContext = avant; });
  const ctx = () => FauxContexte.instances[FauxContexte.instances.length - 1];

  const tous = (): EvenementMatch[] => [
    { t: "decompte", n: 3 }, { t: "decompte", n: 1 }, { t: "coupDEnvoi" }, { t: "toucheBalle", idVoiture: 0, force: 30 }, { t: "toucheBalle", idVoiture: 2, force: 5 },
    { t: "balleDecor", vitesse: 20, point: [0, 1, 0] }, { t: "balleDecor", vitesse: 1, point: [0, 1, 0] }, { t: "but", equipe: "bleue", idMarqueur: 0, idPasse: null, vitesseKmh: 90 },
    { t: "demolition", victime: 1, auteur: 0, p: [0, 1, 0] }, { t: "reapparition", idVoiture: 0 }, { t: "bump", idVoiture: 0, autre: 1, vitesse: 8 },
    { t: "plot", idVoiture: 0, idPlot: 0, gros: true, gain: 100 }, { t: "plot", idVoiture: 1, idPlot: 5, gros: false, gain: 12 }, { t: "plotRecharge", idPlot: 0 },
    { t: "saut", idVoiture: 0 }, { t: "doubleSaut", idVoiture: 0 }, { t: "flip", idVoiture: 0, dir: [1, 0], stall: false }, { t: "atterrissage", idVoiture: 0, vitesse: 8 },
    { t: "choc", idVoiture: 0, vitesse: 9 }, { t: "boost", idVoiture: 0, actif: true }, { t: "supersonique", idVoiture: 0, actif: true }, { t: "arret", idVoiture: 0 },
    { t: "klaxon", idVoiture: 0 }, { t: "prolongation" }, { t: "chronoZero" }, { t: "fin", vainqueur: "bleue" },
  ];

  it("sans AudioContext, tout est un no-op silencieux", () => {
    g.AudioContext = undefined;
    const s = creerSonsRocket();
    const m = monde(SIX);
    expect(() => { s.activer(); for (const e of tous()) s.evenement(e, 0); s.maj(m, 0, 0.016); s.volume(0.5); s.reaction(true); s.reaction(false); s.suspendre(true); s.suspendre(false); s.dispose(); }).not.toThrow();
    expect(FauxContexte.instances).toHaveLength(0);
  });
  it("rien n'est joué avant activer() (pas de geste utilisateur)", () => {
    const s = creerSonsRocket();
    s.evenement({ t: "coupDEnvoi" }, 0);
    s.maj(monde(SIX), 0, 0.016);
    expect(FauxContexte.instances).toHaveLength(0);
  });
  it("un constructeur qui échoue ne casse pas l'appelant", () => {
    g.AudioContext = class { constructor() { throw new Error("refusé"); } };
    const s = creerSonsRocket();
    expect(() => { s.activer(); s.evenement({ t: "coupDEnvoi" }, 0); }).not.toThrow();
  });
  it("chaque type d'événement construit un graphe audio sans erreur", () => {
    const s = creerSonsRocket();
    s.activer();
    const c = ctx();
    const avantNoeuds = c.noeuds.length;
    for (const e of tous()) expect(() => s.evenement(e, 0)).not.toThrow();
    expect(c.noeuds.length).toBeGreaterThan(avantNoeuds + 40);
    expect(c.compte("osc")).toBeGreaterThan(20);
    s.dispose();
  });
  it("le double saut sonne exactement comme le saut : même hauteur, même volume (il ne monte plus dans l'aigu)", () => {
    const s = creerSonsRocket();
    s.activer();
    const c = ctx();
    const empreinte = (t: "saut" | "doubleSaut") => {
      const n0 = c.noeuds.length;
      s.evenement({ t, idVoiture: 0 }, 0);
      const nv = c.noeuds.slice(n0);
      return JSON.stringify(nv.map((x) => [x.genre, x.n.type, x.n.frequency.value, x.n.gain.pic]));
    };
    const saut = empreinte("saut");
    expect(empreinte("doubleSaut")).toBe(saut);
    // et dix sauts de suite restent identiques
    for (let i = 0; i < 10; i++) expect(empreinte(i % 2 ? "saut" : "doubleSaut")).toBe(saut);
    // aucune note aiguë dans un saut ni dans un flip : oscillateurs sous 200 Hz
    const n0 = c.noeuds.length;
    s.evenement({ t: "doubleSaut", idVoiture: 0 }, 0);
    s.evenement({ t: "flip", idVoiture: 0, dir: [1, 0], stall: false }, 0);
    for (const x of c.noeuds.slice(n0)) if (x.genre === "osc") expect(x.n.frequency.value).toBeLessThan(200);
    s.dispose();
  });
  it("les événements d'une autre voiture sont plus discrets que les miens", () => {
    const s = creerSonsRocket();
    s.activer();
    const c = ctx();
    const pic = (idVoiture: number) => {
      const n0 = c.noeuds.length;
      s.evenement({ t: "saut", idVoiture }, 0);
      return Math.max(...c.noeuds.slice(n0).filter((x) => x.genre === "gain").map((x) => x.n.gain.pic));
    };
    const moi = pic(0), autre = pic(3);
    expect(moi).toBeGreaterThan(0.1);
    expect(autre).toBeLessThan(moi / 2);
    // un choc de balle plus fort sonne plus fort
    const choc = (force: number) => {
      const n0 = c.noeuds.length;
      s.evenement({ t: "toucheBalle", idVoiture: 0, force }, 0);
      return Math.max(...c.noeuds.slice(n0).filter((x) => x.genre === "gain").map((x) => x.n.gain.pic));
    };
    expect(choc(40)).toBeGreaterThan(choc(4));
    s.dispose();
  });
  it("moteurs : jamais plus de 3 voix, chacune avec ses deux oscillateurs et son souffle", () => {
    const s = creerSonsRocket();
    s.activer();
    const c = ctx();
    const m = monde(SIX);
    m.voitures[0].v = [0, 0, 20];
    m.voitures[0].boostActif = true;
    s.maj(m, 0, 0.016);
    const oscMoteurs = c.noeuds.filter((x) => x.genre === "osc" && x.n.demarre && !x.n.arrete).length;
    expect(oscMoteurs).toBe(6);
    expect(c.noeuds.filter((x) => x.genre === "source" && x.n.demarre && !x.n.arrete)).toHaveLength(3);
    // la voiture du joueur est lancée : fréquence cible plus haute que l'arrêt
    const premier = c.noeuds.find((x) => x.genre === "osc")!;
    expect(premier.n.frequency.value).toBeGreaterThan(110);
    // un second appel ne crée pas de voix de plus
    s.maj(m, 0, 0.016);
    expect(c.noeuds.filter((x) => x.genre === "osc" && x.n.demarre && !x.n.arrete)).toHaveLength(6);
    // une voiture démolie perd sa voix
    m.voitures[1].demolie = true;
    s.maj(m, 0, 0.016);
    const actifs = c.noeuds.filter((x) => x.genre === "osc" && x.n.demarre && !x.n.arrete).length;
    expect(actifs).toBe(6);
    s.dispose();
  });
  it("une réaction rapide : deux notes montantes, plus discrètes pour la sienne, rien avant activer() ni pendant la pause", () => {
    const s = creerSonsRocket();
    s.reaction(false);
    expect(FauxContexte.instances).toHaveLength(0);
    s.activer();
    const c = ctx();
    const notes = (moi: boolean) => {
      const n0 = c.noeuds.length;
      s.reaction(moi);
      const nv = c.noeuds.slice(n0);
      return { oscs: nv.filter((x) => x.genre === "osc").length, pic: Math.max(...nv.filter((x) => x.genre === "gain").map((x) => x.n.gain.pic ?? 0)) };
    };
    const autre = notes(false), mienne = notes(true);
    expect(autre.oscs).toBe(2);
    expect(mienne.oscs).toBe(2);
    expect(mienne.pic).toBeLessThan(autre.pic);
    s.suspendre(true);
    expect(notes(false).oscs).toBe(0);
    s.dispose();
  });
  it("suspendre coupe les moteurs et suspend le contexte ; reprendre le relance", () => {
    const s = creerSonsRocket();
    s.activer();
    const c = ctx();
    s.maj(monde(SIX), 0, 0.016);
    s.suspendre(true);
    expect(c.suspendu).toBe(1);
    expect(c.noeuds.filter((x) => x.genre === "osc" && x.n.demarre && !x.n.arrete)).toHaveLength(0);
    s.maj(monde(SIX), 0, 0.016); // ignoré en pause
    expect(c.noeuds.filter((x) => x.genre === "osc" && x.n.demarre && !x.n.arrete)).toHaveLength(0);
    s.suspendre(false);
    expect(c.relance).toBeGreaterThanOrEqual(1);
    s.dispose();
  });
  it("le volume maître est borné, dispose ferme le contexte et arrête tout", () => {
    const s = creerSonsRocket();
    s.activer();
    const c = ctx();
    s.volume(5);
    const maitre = c.noeuds.find((x) => x.genre === "gain")!.n;
    expect(maitre.gain.value).toBeLessThanOrEqual(1);
    s.volume(0);
    expect(maitre.gain.value).toBe(0);
    s.maj(monde(SIX), 0, 0.016);
    s.dispose();
    expect(c.ferme).toBe(true);
    expect(c.noeuds.filter((x) => x.genre === "osc" && x.n.demarre && !x.n.arrete)).toHaveLength(0);
    // après dispose, tout est inerte
    expect(() => { s.evenement({ t: "coupDEnvoi" }, 0); s.maj(monde(SIX), 0, 0.016); }).not.toThrow();
  });
  it("le plafond de voix ponctuelles protège le processeur", () => {
    const s = creerSonsRocket();
    s.activer();
    const c = ctx();
    // le faux contexte ne termine jamais seul un son : on retire onended pour simuler des sons qui durent
    const origine = FauxNoeud.prototype.stop;
    FauxNoeud.prototype.stop = function () { this.arrete = true; };
    try {
      for (let i = 0; i < 200; i++) s.evenement({ t: "demolition", victime: 1, auteur: 0, p: [0, 0, 0] }, 0);
      expect(c.compte("osc") + c.compte("source")).toBeLessThanOrEqual(30);
    } finally { FauxNoeud.prototype.stop = origine; }
    s.dispose();
  });
});
