/**
 * Sons de l'arène FPS, tous synthétisés avec WebAudio (bruit filtré + oscillateurs + enveloppes) :
 * aucun fichier audio. Le contexte audio n'est créé qu'au premier geste de l'utilisateur (politique
 * d'autoplay des navigateurs) ; avant cela, et si WebAudio manque, tous les appels sont sans effet.
 *
 * Les tirs lointains passent `position` : le gain baisse avec la distance, les aigus s'éteignent et
 * `pan` (−1 gauche … 1 droite, calculé par jeu.ts d'après l'angle du tireur) place le son. Les tigres largués (rugissement, coup de
 * patte, plainte) et l'avion qui les largue sont placés de la même façon (spec 2026-10-23-arene-tigres-design.md, Rendu). Le tigre
 * géant des événements a ses propres sons (`alerte`, `laser`, `pasLourd`, `explosionMonstre`), jamais ceux des tigres largués.
 *
 * Seule exception au « tout synthétisé » : le moteur de la voiture conduite est un VRAI enregistrement (`/arene/moteur.wav`, boucle de
 * ralenti CC0, cf. public/arene/CREDITS.txt) joué en boucle, dont la vitesse de lecture (donc le régime) suit celle de la voiture (v3 §3).
 * Tant qu'il n'est pas chargé (ou s'il ne se charge pas), un moteur synthétisé doux le remplace.
 */
import type { ArmeFeuId, ArmeMeleeId } from "./protocole";

/** Voix de tigres en même temps au plus (zombies) : au-delà, un nouveau rugissement est ignoré. */
export const VOIX_TIGRES_MAX = 4;

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
   * Coup d'arme blanche (sifflement de lame ; `touche` ajoute l'impact sur la chair). `position` pour le coup d'un autre joueur
   * (omis = le mien). `arme` : le couteau par défaut ; l'épée siffle plus longtemps, tinte (métal) et frappe plus lourd.
   */
  coup(touche: boolean, position?: PositionSon, arme?: ArmeMeleeId): void;
  /** Cadeau d'Elsa ramassé : carillon doux pour la vie, carillon plus grave et cliquetis métallique pour une arme. */
  ramassage(genre: "soin" | "arme"): void;
  /** Un cran de régénération de vie (tic doux). */
  regen(): void;
  /**
   * Moteur de la voiture conduite : oscillateurs en boucle dont la hauteur suit la vitesse (m/s, valeur absolue).
   * `null` l'éteint (descente, mort, killcam). Plusieurs appels par seconde sont attendus : seule la hauteur change.
   */
  moteur(vitesse: number | null): void;
  /** Crissement des pneus en dérapage : intensité 0 (silence) à 1 ; la boucle ne tourne que tant qu'elle est > 0. */
  derapage(intensite: number): void;
  /** Choc de voiture ; `force` de 0 (frôlement) à 1 (plein fouet). */
  choc(force: number): void;
  /** Coup de klaxon (facultatif, réservé au conducteur). */
  klaxon(): void;
  /** Rugissement d'un tigre (alerte, bond annoncé). `position` : où il est par rapport à moi. */
  rugissement(position?: PositionSon): void;
  /** Coup de patte d'un tigre (griffes qui fendent l'air, choc sourd). */
  patte(position?: PositionSon): void;
  /** Plainte d'un tigre qui meurt. */
  plainte(position?: PositionSon): void;
  /**
   * Moteur de l'avion qui largue les tigres : bourdonnement grave en boucle, atténué et panoramiqué d'après `position`, à rappeler à chaque
   * image pendant le survol. `null` l'éteint (fin du survol, killcam, sortie de l'arène).
   */
  avion(position: PositionSon | null): void;
  /** Cran de la molette de zoom de la lunette. */
  zoom(): void;
  /** Ma balle a frappé la tôle d'une voiture (v3 §4). */
  tole(): void;
  /** Explosion d'une voiture (v3 §4) ; `position` pour l'atténuer avec la distance. */
  explosion(position?: PositionSon): void;
  /** (v4) Sirène d'alerte d'un événement : klaxon furieux pour le Truck Muche, rugissement métallique pour le tigre robot. */
  alerte(genre: "truck" | "tigre"): void;
  /** (v4) Charge du laser des yeux du tigre (montée aiguë) ; `position` = yeux du tigre. */
  laser(position?: PositionSon): void;
  /** (v4) Explosion d'un monstre (impact du laser, mort du tigre, titan détruit) ; `force` 0..1. */
  explosionMonstre(force: number, position?: PositionSon): void;
  /** (v4) Tir du canon du titan (le mien, ou celui du pilote à `position`). */
  canon(position?: PositionSon): void;
  /** (v4) Klaxon de camion (trompe à air, accord de trois notes) du Truck Muche fou, entendu de loin dans toute l'arène. */
  klaxonCamion(position?: PositionSon): void;
  /** (v4) Bâtiment qui s'effondre (grondement long et fracas). */
  effondrement(position?: PositionSon): void;
  /** (v4) Pas lourd du tigre ou du titan. */
  pasLourd(position?: PositionSon): void;
  /**
   * (zombies) Rugissement d'un tigre, spatialisé ; au plus `VOIX_TIGRES_MAX` (4) voix en même temps, les suivantes sont ignorées.
   * `mort` : cri plus court qui s'éteint (un tigre vient de tomber). Renvoie vrai si la voix a été jouée.
   */
  rugissementTigre(position?: PositionSon, mort?: boolean): boolean;
  /** (zombies) Griffe d'un tigre : fouet de patte et choc sourd, spatialisé. */
  griffe(position?: PositionSon): void;
  /** (zombies) Achat accepté (caisse enregistreuse) ou refusé (buzz grave). */
  achat(ok: boolean): void;
  /** (zombies) Pièce gagnée (touche, kill, bonus de manche) : tic cristallin. */
  piece(): void;
  /** (zombies) Nouvelle manche : coup de tambour grave et cuivres qui montent. */
  manche(): void;
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

/** Enregistrement du moteur (boucle de ralenti CC0) et réglages de sa lecture. */
const URL_MOTEUR = "/arene/moteur.wav";
/** Vitesse de lecture au ralenti et à `VITESSE_REGIME_MAX` m/s (le régime monte avec la vitesse). */
const REGIME_RALENTI = 0.85;
const REGIME_MAX = 2.1;
const VITESSE_REGIME_MAX = 28;
/** Gain du moteur (avant le master à 0,55) : discret au ralenti, à peine plus fort à fond (v3 §3 : il faisait mal aux oreilles). */
const GAIN_MOTEUR_RALENTI = 0.16;
const GAIN_MOTEUR_MAX = 0.3;

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
  /** moteur de l'avion : deux oscillateurs désaccordés (battement des hélices) et un souffle, filtrés et panoramiqués par image */
  let avionVoix: { oscs: OscillatorNode[]; souffle: AudioBufferSourceNode; gain: GainNode; filtre: BiquadFilterNode; pan: StereoPannerNode | null } | null = null;
  /**
   * moteur de la voiture conduite : l'enregistrement en boucle (`echantillon`, vitesse de lecture = régime) ou, à défaut, un oscillateur
   * triangle grave + un grain de bruit (`oscs`), le tout sous un passe-bas qui s'ouvre avec la vitesse
   */
  let moteurVoix: { oscs: OscillatorNode[]; gain: GainNode; filtre: BiquadFilterNode; grain: AudioBufferSourceNode; echantillon: boolean } | null = null;
  /** boucle de moteur décodée (null tant qu'elle n'est pas chargée), chargement en cours, échec définitif */
  let moteurBuf: AudioBuffer | null = null;
  let moteurCharge = false;
  const chargerMoteur = () => {
    if (moteurCharge || !ctx || typeof fetch !== "function") return;
    moteurCharge = true;
    const c = ctx;
    fetch(URL_MOTEUR)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => c.decodeAudioData(b))
      .then((buf) => { if (!fini) moteurBuf = buf; })
      .catch(() => { /* le moteur synthétisé reste */ });
  };
  /** crissement des pneus (bruit en boucle, passe-bande aigu) */
  let crissement: { src: AudioBufferSourceNode; gain: GainNode; filtre: BiquadFilterNode } | null = null;
  /** fins (horloge audio, s) des rugissements de tigres en cours */
  let voixTigres: number[] = [];

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
    coup(touche, position, arme = "couteau") {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const v = 0.94 + Math.random() * 0.12;
      if (arme === "epee") {
        // Taille d'épée : sifflement long et grave, qui monte puis retombe, tintement métallique de la lame (triangle 900-2300 Hz).
        bruit(out, t, { dur: 0.36, type: "bandpass", f0: 700 * v, f1: 3200, q: 1.3, gain: 0.55, att: 0.12 });
        bruit(out, t + 0.14, { dur: 0.2, type: "highpass", f0: 5000, gain: 0.2, att: 0.06 });
        ton(out, t + 0.1, { dur: 0.45, type: "triangle", f0: 2300 * v, f1: 900, gain: 0.1 });
        if (touche) {
          // Choc plus lourd : coup sourd profond, claquement humide et tintement qui résonne.
          bruit(out, t + 0.18, { dur: 0.2, type: "lowpass", f0: 1600, f1: 160, gain: 1 });
          ton(out, t + 0.18, { dur: 0.24, type: "sine", f0: 120 * v, f1: 40, gain: 0.85 });
          bruit(out, t + 0.18, { dur: 0.04, type: "bandpass", f0: 2400, q: 1.2, gain: 0.4 });
          ton(out, t + 0.19, { dur: 0.5, type: "triangle", f0: 1500 * v, f1: 1100, gain: 0.08 });
        }
        return;
      }
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
      chargerMoteur();
      const v = Math.min(Math.abs(vitesse), 40);
      const k = Math.min(v / VITESSE_REGIME_MAX, 1);
      // l'enregistrement arrivé pendant qu'on roulait sur le moteur synthétisé le remplace sans attendre la prochaine montée
      if (moteurVoix && !moteurVoix.echantillon && moteurBuf) {
        const m = moteurVoix;
        moteurVoix = null;
        eteindre(m.gain, [...m.oscs, m.grain], 0.15);
      }
      if (!moteurVoix) {
        const g = c.createGain();
        g.gain.value = 0.0001;
        const filtre = c.createBiquadFilter();
        filtre.type = "lowpass";
        filtre.Q.value = 0.7;
        filtre.connect(g);
        g.connect(master!);
        const grain = c.createBufferSource();
        grain.loop = true;
        const oscs: OscillatorNode[] = [];
        if (moteurBuf) {
          // vrai moteur : la boucle de ralenti, accélérée avec la vitesse
          grain.buffer = moteurBuf;
          grain.connect(filtre);
          grain.start(c.currentTime, Math.random() * moteurBuf.duration);
        } else {
          // repli doux : un triangle grave (plus de dent de scie ni de carré, trop agressifs) et un grain de bruit
          const o = c.createOscillator();
          o.type = "triangle";
          o.connect(filtre);
          o.start();
          oscs.push(o);
          grain.buffer = bruitBuf;
          const gf = c.createBiquadFilter();
          gf.type = "lowpass";
          gf.frequency.value = 220;
          const gg = c.createGain();
          gg.gain.value = 0.2;
          grain.connect(gf);
          gf.connect(gg);
          gg.connect(filtre);
          grain.start(c.currentTime, Math.random() * 0.9);
        }
        moteurVoix = { oscs, gain: g, filtre, grain, echantillon: !!moteurBuf };
      }
      const m = moteurVoix;
      const now = c.currentTime;
      if (m.echantillon) m.grain.playbackRate.setTargetAtTime(REGIME_RALENTI + (REGIME_MAX - REGIME_RALENTI) * k, now, 0.12);
      else m.oscs[0]?.frequency.setTargetAtTime(40 + v * 2.2, now, 0.08);
      m.filtre.frequency.setTargetAtTime(600 + 1800 * k, now, 0.1);
      m.gain.gain.setTargetAtTime(GAIN_MOTEUR_RALENTI + (GAIN_MOTEUR_MAX - GAIN_MOTEUR_RALENTI) * k, now, 0.15);
    },
    derapage(intensite) {
      const k = Number.isFinite(intensite) ? Math.min(Math.max(intensite, 0), 1) : 0;
      if (k <= 0) {
        if (!crissement) return;
        const cr = crissement;
        crissement = null;
        eteindre(cr.gain, [cr.src], 0.08);
        return;
      }
      if (!crissement && !prete()) return;
      const c = ctx;
      if (!c) return;
      if (!crissement) {
        const src = c.createBufferSource();
        src.buffer = bruitBuf;
        src.loop = true;
        const filtre = c.createBiquadFilter();
        filtre.type = "bandpass";
        filtre.Q.value = 6;
        const g = c.createGain();
        g.gain.value = 0.0001;
        src.connect(filtre);
        filtre.connect(g);
        g.connect(master!);
        src.start(c.currentTime, Math.random() * 0.9);
        crissement = { src, gain: g, filtre };
      }
      const now = c.currentTime;
      crissement.filtre.frequency.setTargetAtTime(1500 + k * 900, now, 0.05);
      crissement.gain.gain.setTargetAtTime(0.05 + k * 0.17, now, 0.05);
    },
    choc(force) {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      const k = Math.min(Math.max(force, 0), 1);
      bruit(master!, t, { dur: 0.12 + 0.2 * k, type: "lowpass", f0: 1500, f1: 160, gain: 0.3 + 0.35 * k });
      ton(master!, t, { dur: 0.15 + 0.2 * k, type: "sine", f0: 100, f1: 38, gain: 0.3 + 0.35 * k });
      // Tôle froissée : éclats métalliques proportionnels à la force.
      bruit(master!, t + 0.02, { dur: 0.1 + 0.1 * k, type: "bandpass", f0: 2200, f1: 1200, q: 1.2, gain: 0.08 + 0.2 * k });
    },
    zoom() {
      if (!prete()) return;
      clic(master!, ctx!.currentTime + 0.001, 2600, 0.18);
    },
    tole() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      const v = 0.9 + Math.random() * 0.2;
      // tintement de tôle : un « ping » métallique court et un petit choc
      ton(master!, t, { dur: 0.12, type: "triangle", f0: 1900 * v, f1: 1500 * v, gain: 0.09 });
      ton(master!, t, { dur: 0.08, type: "sine", f0: 3100 * v, gain: 0.05 });
      bruit(master!, t, { dur: 0.04, type: "bandpass", f0: 2800, q: 1.4, gain: 0.12 });
    },
    explosion(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      // Détonation sourde, souffle large bande, débris métalliques qui retombent et crépitement du feu.
      ton(out, t, { dur: 0.9, type: "sine", f0: 70, f1: 22, gain: 1 });
      bruit(out, t, { dur: 1.1, type: "lowpass", f0: 3200, f1: 120, gain: 1 });
      bruit(out, t + 0.02, { dur: 0.25, type: "bandpass", f0: 1400, f1: 500, q: 0.7, gain: 0.6 });
      for (let i = 0; i < 5; i++) {
        bruit(out, t + 0.35 + i * 0.13 + Math.random() * 0.08, { dur: 0.06, type: "bandpass", f0: 2500 + Math.random() * 1500, q: 2, gain: 0.18 });
      }
      bruit(out, t + 0.5, { dur: 1.4, type: "highpass", f0: 1800, f1: 3500, gain: 0.08, att: 0.2 });
    },
    klaxon() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      // Deux notes rapprochées (tierce), signal court.
      ton(master!, t, { dur: 0.32, type: "square", f0: 415, gain: 0.07, att: 0.01 });
      ton(master!, t, { dur: 0.32, type: "square", f0: 523, gain: 0.07, att: 0.01 });
    },
    rugissement(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const v = 0.9 + Math.random() * 0.2;
      // Grondement qui enfle puis retombe : dents de scie graves glissées, souffle rauque filtré, râle de gorge.
      ton(out, t, { dur: 1.1, type: "sawtooth", f0: 95 * v, f1: 62 * v, gain: 0.55, att: 0.18 });
      ton(out, t + 0.05, { dur: 0.95, type: "sawtooth", f0: 142 * v, f1: 80 * v, gain: 0.3, att: 0.2 });
      bruit(out, t, { dur: 1.1, type: "bandpass", f0: 520 * v, f1: 260, q: 1.4, gain: 0.55, att: 0.15 });
      bruit(out, t + 0.1, { dur: 0.7, type: "lowpass", f0: 900, f1: 180, gain: 0.35, att: 0.1 });
    },
    patte(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const v = 0.92 + Math.random() * 0.16;
      // Griffes qui fendent l'air, puis choc sourd et feulement bref.
      bruit(out, t, { dur: 0.16, type: "bandpass", f0: 1800 * v, f1: 3600, q: 1.3, gain: 0.45, att: 0.04 });
      bruit(out, t + 0.12, { dur: 0.16, type: "lowpass", f0: 1100, f1: 180, gain: 0.85 });
      ton(out, t + 0.12, { dur: 0.18, type: "sine", f0: 120 * v, f1: 48, gain: 0.7 });
      bruit(out, t + 0.05, { dur: 0.25, type: "bandpass", f0: 700 * v, f1: 420, q: 1.1, gain: 0.25, att: 0.03 });
    },
    plainte(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const v = 0.95 + Math.random() * 0.1;
      // Gémissement qui descend et s'éteint, souffle qui s'épuise.
      ton(out, t, { dur: 1.4, type: "sawtooth", f0: 210 * v, f1: 70, gain: 0.32, att: 0.08 });
      ton(out, t + 0.03, { dur: 1.2, type: "triangle", f0: 320 * v, f1: 110, gain: 0.18, att: 0.1 });
      bruit(out, t + 0.2, { dur: 1.3, type: "bandpass", f0: 600, f1: 200, q: 0.9, gain: 0.25, att: 0.2 });
    },
    avion(position) {
      if (position === null) {
        if (!avionVoix) return;
        const a = avionVoix;
        avionVoix = null;
        eteindre(a.gain, [...a.oscs, a.souffle], 0.25);
        return;
      }
      if (!avionVoix && !prete()) return;
      const c = ctx;
      if (!c) return;
      if (!avionVoix) {
        const g = c.createGain();
        g.gain.value = 0.0001;
        const filtre = c.createBiquadFilter();
        filtre.type = "lowpass";
        filtre.Q.value = 0.8;
        // deux hélices légèrement désaccordées : le battement donne le vrombissement d'un avion à moteurs
        const o1 = c.createOscillator();
        o1.type = "sawtooth";
        o1.frequency.value = 72;
        const o2 = c.createOscillator();
        o2.type = "sawtooth";
        o2.frequency.value = 75.5;
        const og = c.createGain();
        og.gain.value = 0.6;
        o1.connect(filtre);
        o2.connect(og);
        og.connect(filtre);
        const souffle = c.createBufferSource();
        souffle.buffer = bruitBuf;
        souffle.loop = true;
        const sf = c.createBiquadFilter();
        sf.type = "lowpass";
        sf.frequency.value = 500;
        const sg = c.createGain();
        sg.gain.value = 0.5;
        souffle.connect(sf);
        sf.connect(sg);
        sg.connect(filtre);
        filtre.connect(g);
        let pan: StereoPannerNode | null = null;
        if (typeof c.createStereoPanner === "function") {
          pan = c.createStereoPanner();
          g.connect(pan);
          pan.connect(master!);
        } else g.connect(master!);
        o1.start();
        o2.start();
        souffle.start(c.currentTime, Math.random() * 0.9);
        avionVoix = { oscs: [o1, o2], souffle, gain: g, filtre, pan };
      }
      const a = avionVoix;
      const now = c.currentTime;
      // l'avion vole à 120 m : on l'entend de loin, mais il reste un fond sous les tirs
      const d = Math.max(position.distance, 1);
      a.gain.gain.setTargetAtTime(Math.max(0.02, 0.3 / (1 + d / 120)), now, 0.15);
      a.filtre.frequency.setTargetAtTime(Math.max(260, 2400 / (1 + d / 90)), now, 0.15);
      a.pan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, position.pan)), now, 0.1);
    },
    alerte(genre) {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      if (genre === "truck") {
        // klaxon de camion qui s'emballe : quatre coups, de plus en plus aigus
        for (let i = 0; i < 4; i++) {
          ton(master!, t + i * 0.22, { dur: 0.18, type: "sawtooth", f0: 233 + i * 30, gain: 0.09, att: 0.01 });
          ton(master!, t + i * 0.22, { dur: 0.18, type: "sawtooth", f0: 294 + i * 38, gain: 0.08, att: 0.01 });
        }
        return;
      }
      // rugissement : grave qui monte puis retombe, grain de bruit, harmonique métallique
      ton(master!, t, { dur: 1.3, type: "sawtooth", f0: 70, f1: 45, gain: 0.35, att: 0.15 });
      ton(master!, t, { dur: 1.1, type: "square", f0: 140, f1: 95, gain: 0.08, att: 0.2 });
      bruit(master!, t, { dur: 1.2, type: "lowpass", f0: 900, f1: 200, q: 1.5, gain: 0.5, att: 0.2 });
      bruit(master!, t + 0.1, { dur: 0.9, type: "bandpass", f0: 2400, f1: 1300, q: 6, gain: 0.12, att: 0.1 });
    },
    laser(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      ton(out, t, { dur: 1.35, type: "sine", f0: 300, f1: 2200, gain: 0.18, att: 0.3 });
      ton(out, t, { dur: 1.35, type: "triangle", f0: 305, f1: 2230, gain: 0.08, att: 0.3 });
    },
    explosionMonstre(force, position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      const k = Math.min(Math.max(force, 0), 1);
      bruit(out, t, { dur: 0.5 + 0.9 * k, type: "lowpass", f0: 2500, f1: 90, gain: 0.7 + 0.3 * k });
      ton(out, t, { dur: 0.6 + 0.8 * k, type: "sine", f0: 90, f1: 28, gain: 0.8 });
    },
    canon(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      bruit(out, t, { dur: 0.16, type: "lowpass", f0: 3200, f1: 300, gain: 0.55 });
      ton(out, t, { dur: 0.14, type: "square", f0: 160, f1: 70, gain: 0.22 });
    },
    klaxonCamion(position) {
      if (!prete()) return;
      const c = ctx!;
      const t = c.currentTime + 0.001;
      // atténuation douce (on l'entend à 300 m), aigus filtrés avec la distance, panoramique
      const d = position ? Math.max(position.distance, 1) : 1;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = Math.max(900, 5200 / (1 + d / 120));
      const g = c.createGain();
      g.gain.value = Math.max(0.12, 1 / (1 + d / 70));
      lp.connect(g);
      if (position && typeof c.createStereoPanner === "function") {
        const pn = c.createStereoPanner();
        pn.pan.value = Math.max(-1, Math.min(1, position.pan));
        g.connect(pn);
        pn.connect(master!);
      } else g.connect(master!);
      // trompe : accord grave et un peu désaccordé, attaque nette, tenue, petite chute de hauteur à la fin
      for (const [f, gain] of [[185, 0.16], [233, 0.14], [277, 0.11]] as const) {
        ton(lp, t, { dur: 0.95, type: "sawtooth", f0: f, f1: f * 0.97, gain, att: 0.03 });
        ton(lp, t, { dur: 0.95, type: "square", f0: f * 1.004, f1: f * 0.975, gain: gain * 0.35, att: 0.03 });
      }
    },
    effondrement(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      bruit(out, t, { dur: 1.6, type: "lowpass", f0: 1400, f1: 70, gain: 0.8, att: 0.05 });
      ton(out, t, { dur: 1.4, type: "sine", f0: 55, f1: 25, gain: 0.7, att: 0.05 });
      for (let i = 0; i < 4; i++) bruit(out, t + 0.1 + i * 0.18, { dur: 0.12, type: "bandpass", f0: 1800 - i * 250, q: 1.4, gain: 0.25 });
    },
    pasLourd(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      ton(out, t, { dur: 0.35, type: "sine", f0: 60, f1: 32, gain: 0.55 });
      bruit(out, t, { dur: 0.18, type: "lowpass", f0: 500, f1: 120, gain: 0.3 });
    },
    rugissementTigre(position, mort = false) {
      if (!prete()) return false;
      const t = ctx!.currentTime + 0.001;
      voixTigres = voixTigres.filter((fin) => fin > t);
      if (voixTigres.length >= VOIX_TIGRES_MAX) return false;
      const dur = mort ? 0.7 : 1.0;
      voixTigres.push(t + dur);
      const out = sortie(position);
      const v = 0.85 + Math.random() * 0.3;
      if (mort) {
        // cri étranglé qui s'effondre
        ton(out, t, { dur, type: "sawtooth", f0: 150 * v, f1: 38, gain: 0.3, att: 0.03 });
        bruit(out, t, { dur: 0.55, type: "lowpass", f0: 1400, f1: 160, q: 1.2, gain: 0.4, att: 0.02 });
        return true;
      }
      // rugissement : grave qui gronde (dent de scie + carré désaccordé), souffle filtré, harmonique rauque
      ton(out, t, { dur, type: "sawtooth", f0: 118 * v, f1: 62 * v, gain: 0.3, att: 0.08 });
      ton(out, t, { dur: dur * 0.9, type: "square", f0: 236 * v, f1: 130 * v, gain: 0.05, att: 0.1 });
      bruit(out, t, { dur: dur * 0.9, type: "lowpass", f0: 1100, f1: 240, q: 1.4, gain: 0.35, att: 0.1 });
      bruit(out, t + 0.05, { dur: dur * 0.7, type: "bandpass", f0: 760, f1: 420, q: 5, gain: 0.1, att: 0.1 });
      return true;
    },
    griffe(position) {
      if (!prete()) return;
      const out = sortie(position);
      const t = ctx!.currentTime + 0.001;
      // fouet de patte (bruit passe-bande qui monte) puis claquement sourd de la frappe
      bruit(out, t, { dur: 0.22, type: "bandpass", f0: 600, f1: 2600, q: 1.1, gain: 0.45, att: 0.1 });
      bruit(out, t + 0.16, { dur: 0.14, type: "lowpass", f0: 1200, f1: 180, gain: 0.5 });
      ton(out, t + 0.16, { dur: 0.18, type: "sine", f0: 110, f1: 45, gain: 0.45 });
    },
    achat(ok) {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      if (ok) {
        // caisse enregistreuse : clic mécanique, deux notes cristallines
        clic(master!, t, 1800, 0.35);
        ton(master!, t + 0.05, { dur: 0.35, type: "sine", f0: 1568, gain: 0.16 });
        ton(master!, t + 0.13, { dur: 0.5, type: "sine", f0: 2093, gain: 0.16 });
        ton(master!, t + 0.13, { dur: 0.4, type: "triangle", f0: 4186, gain: 0.03 });
        return;
      }
      // refus : deux buzz graves
      ton(master!, t, { dur: 0.12, type: "square", f0: 130, gain: 0.1, att: 0.01 });
      ton(master!, t + 0.15, { dur: 0.18, type: "square", f0: 98, gain: 0.1, att: 0.01 });
    },
    piece() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      ton(master!, t, { dur: 0.12, type: "sine", f0: 2349, gain: 0.06, att: 0.005 });
      ton(master!, t + 0.04, { dur: 0.16, type: "sine", f0: 3136, gain: 0.05, att: 0.005 });
    },
    manche() {
      if (!prete()) return;
      const t = ctx!.currentTime + 0.001;
      // coup de tambour grave, puis trois cuivres qui montent (sol-do-mi)
      ton(master!, t, { dur: 0.7, type: "sine", f0: 80, f1: 34, gain: 0.7 });
      bruit(master!, t, { dur: 0.35, type: "lowpass", f0: 900, f1: 90, gain: 0.5 });
      [196, 262, 330].forEach((f, i) => {
        ton(master!, t + 0.3 + i * 0.16, { dur: 0.6, type: "sawtooth", f0: f, gain: 0.08, att: 0.04 });
        ton(master!, t + 0.3 + i * 0.16, { dur: 0.6, type: "square", f0: f * 2, gain: 0.025, att: 0.04 });
      });
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
      if (avionVoix) {
        for (const o of [...avionVoix.oscs, avionVoix.souffle]) {
          try { o.stop(); } catch { /* déjà arrêté */ }
        }
        avionVoix = null;
      }
      if (crissement) {
        try { crissement.src.stop(); } catch { /* déjà arrêté */ }
        crissement = null;
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
