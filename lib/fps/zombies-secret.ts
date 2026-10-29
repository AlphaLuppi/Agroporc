/**
 * Grand secret du mode zombies, « Le Menu fantôme » (PUR : ni three ni DOM ; l'horloge est passée à chaque appel, le hasard est injecté). Il
 * remplace la Recette ultime de la v7, une collecte guidée par le HUD que l'on finissait à la manche 8. Neuf étapes façon Origins, SANS AUCUN
 * indice affiché : pas d'objectif, pas d'invite, pas de compteur ; le décor réagit (une pendule repart, une casserole tinte, la marmite
 * bout, une cuve saute, une ampoule clignote) et c'est tout. Déclencheurs variés : couteau sur des pendules, tirs dans un ordre lu sur une
 * ardoise puis dans un code en morse, tigres tués autour d'une marmite pendant une livraison du Truck Muche puis au couteau près du billot,
 * grenade au pied d'une cuve, truffe portée à travers la carte en temps limité (échec : retour à l'étape précédente), arme déposée au
 * Micro-ondes pendant les douze coups de midi, et un service final pendant la troisième livraison (ou une suivante), qui ne tient que si
 * le Truck saute avant de repartir et que personne ne tombe. Rien ne dépend d'un tirage de la boîte. Les ordres (ardoise, post-it, morse)
 * sont tirés à chaque partie.
 *
 * Le service de la salle (`match-zombies.ts`) appelle les déclencheurs (`coup`, `tir`, `explosion`, `kill`, `interagir`, `pap`, `truck`,
 * `finManche`, `joueurTombe`, `joueurParti`, `tic`) et transforme les effets rendus en `zevt{secret}` ; la récompense (`servi`) et la fin
 * de partie (`victoire`) sont à sa charge.
 * Solution (développeurs seulement) : docs/superpowers/specs/2026-10-29-zombies-secret-SOLUTION.md
 */
import { lancerRayon, type Monde } from "./collision";
import type { EtatSecretZombies, PhaseZombies, TruckZombies, Vec3 } from "./protocole";
import { INTERACTIONS_SECRET, SECRET_CARTE, type ObjetSecret } from "./zombies-carte";
import type { Vec2 } from "../agroparc3d/types";

// ---------------------------------------------------------------------------------------------
// Étapes et réglages
// ---------------------------------------------------------------------------------------------

/** Les neuf étapes, dans l'ordre (index = `EtatSecretZombies.etape`). */
export const ETAPES_SECRET = ["pendules", "casseroles", "marmite", "congelateur", "truffe", "midi", "postits", "hachoir", "service"] as const;
export type NomEtapeSecret = (typeof ETAPES_SECRET)[number];
/** Étape « servi » : le secret est accompli (la cloche peut finir la partie). */
export const SECRET_SERVI = ETAPES_SECRET.length;
export const etapeDe = (nom: NomEtapeSecret): number => ETAPES_SECRET.indexOf(nom);

export const SECRET = {
  /** les pendules sont arrêtées sur 11 h 58 (minutes depuis 0 h sur un cadran de 12 h) */
  heureArretMin: 11 * 60 + 58,
  /**
   * remontées, elles tournent beaucoup trop vite : le cadran des heures fait un tour en `periodeMidiMs` (5 min, minutes en 25 s) ; midi sonne
   * donc 0,8 s après la remise en route, puis toutes les 5 minutes
   */
  periodeMidiMs: 300_000,
  /** les douze coups de midi : un coup toutes les `coupMidiMs`, fenêtre où le Micro-ondes « accepte » l'arme */
  coupsMidi: 12,
  coupMidiMs: 600,
  fenetreMidiMs: 8_000,
  /** la truffe fond `truffeMs` après être sortie de la cuve (la cuve se referme : retour à la grenade) */
  truffeMs: 30_000,
  /** les quatre écrans doivent être touchés en `ecransMs` depuis le premier */
  ecransMs: 15_000,
  /** rayons (m, au sol) : kills autour de la marmite et du billot, souffle d'une grenade autour de la cuve n° 3 */
  rayonMarmiteM: 6,
  rayonBillotM: 5,
  rayonCuveM: 2.5,
  /** une grenade compte si elle saute à moins de cette hauteur (m) du centre de la cuve */
  hauteurCuveM: 2.5,
  /** service : à partir de la troisième livraison du Truck Muche */
  livraisonService: 3,
  /** marge (m) d'une interaction (E) jugée sur la position serveur */
  margeInteractionM: 0.8,
  /** marge (m) d'un coup de couteau sur une pendule (au-delà de la portée de l'arme) */
  margeCoupM: 0.35,
} as const;

/** Tigres à tuer autour de la marmite pendant UNE livraison : 6 seul, +4 par joueur (une livraison en solo en lâche 10 ou 11). */
export const besoinMarmite = (joueurs: number): number => Math.min(20, 6 + 4 * (Math.max(1, Math.floor(joueurs)) - 1));
/** Tigres à achever au couteau (ou à l'épée) près du billot : 8 seul, +3 par joueur. */
export const besoinBillot = (joueurs: number): number => 8 + 3 * (Math.max(1, Math.floor(joueurs)) - 1);

// ---------------------------------------------------------------------------------------------
// Pendules et midi (aussi lus par le rendu et les sons)
// ---------------------------------------------------------------------------------------------

/** Minutes affichées par les pendules (cadran de 12 h, 0..720) : 11 h 58 tant qu'elles sont arrêtées (`pendulesT` = 0). */
export function heurePendules(pendulesT: number, periodeMs: number, t: number): number {
  if (!pendulesT) return SECRET.heureArretMin;
  const m = SECRET.heureArretMin + ((t - pendulesT) * 720) / periodeMs;
  return ((m % 720) + 720) % 720;
}

/** Début (ms) du midi en cours ou du dernier passé à `t` ; null si les pendules sont arrêtées ou si midi n'a pas encore sonné. */
export function dernierMidi(pendulesT: number, periodeMs: number, t: number): number | null {
  if (!pendulesT) return null;
  const premier = pendulesT + ((720 - SECRET.heureArretMin) * periodeMs) / 720;
  if (t < premier) return null;
  return premier + Math.floor((t - premier) / periodeMs) * periodeMs;
}

/** Midi sonne à `t` (les douze coups) : le Micro-ondes est « à l'heure ». */
export function dansMidi(pendulesT: number, periodeMs: number, t: number, fenetreMs: number = SECRET.fenetreMidiMs): boolean {
  const m = dernierMidi(pendulesT, periodeMs, t);
  return m !== null && t - m <= fenetreMs;
}

/** Coups de midi sonnés à `t` depuis le début du midi en cours (0 hors de la fenêtre des coups, 1 à 12 pendant). */
export function coupsSonnes(pendulesT: number, periodeMs: number, t: number): number {
  const m = dernierMidi(pendulesT, periodeMs, t);
  if (m === null) return 0;
  const k = Math.floor((t - m) / SECRET.coupMidiMs) + 1;
  return k >= 1 && k <= SECRET.coupsMidi ? k : 0;
}

// ---------------------------------------------------------------------------------------------
// Morse (ampoules du Labo et du Local technique)
// ---------------------------------------------------------------------------------------------

const MORSE: Readonly<Record<string, string>> = {
  M: "--", I: "..", D: "-..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
};
/** Unité du morse (ms) : point = 1, trait = 3, entre signes 1, entre lettres 3, pause de 7 unités puis 7 de plus avant de recommencer. */
export const UNITE_MORSE_MS = 280;

/** Plages allumées d'un message (unités) et durée d'un cycle complet, message répété avec un long silence. */
export function sequenceMorse(message: string): { allume: [number, number][]; cycle: number } {
  const allume: [number, number][] = [];
  let u = 0;
  for (const car of message.toUpperCase()) {
    const code = MORSE[car];
    if (!code) { u += 4; continue; }
    for (const signe of code) {
      const d = signe === "-" ? 3 : 1;
      allume.push([u, u + d]);
      u += d + 1;
    }
    u += 2; // 3 unités entre deux lettres (1 déjà comptée)
  }
  return { allume, cycle: u + 11 };
}

/** L'ampoule qui répète `message` est allumée à `t` (ms, horloge serveur : tous les joueurs voient le même clignotement). */
export function morseAllume(message: string, t: number, uniteMs = UNITE_MORSE_MS): boolean {
  const s = sequenceMorse(message);
  if (!s.allume.length) return false;
  const u = (((t / uniteMs) % s.cycle) + s.cycle) % s.cycle;
  return s.allume.some(([a, b]) => u >= a && u < b);
}

// ---------------------------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------------------------

/** Distance le long du rayon (o, d normalisé) jusqu'à l'entrée dans la sphère (c, r), ou null au-delà de `max`. */
export function rayonSphere(o: Vec3, d: Vec3, c: readonly number[], r: number, max: number): number | null {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const s = -b - Math.sqrt(disc);
  const k = s >= 0 ? s : cc <= 0 ? 0 : null; // l'œil dans la sphère : touché tout de suite
  return k !== null && k <= max ? k : null;
}

/** Rien de solide entre l'œil et l'objet (à `dist` m) : un mur ne cache pas ce qui est accroché dessus (tolérance de 8 cm). */
function aVue(monde: Monde, o: Vec3, d: Vec3, dist: number): boolean {
  return lancerRayon(monde, o, d, dist + 0.2) >= dist - 0.08;
}

/** Premier objet touché parmi `objets` par l'un des plombs (`dirs`) : index et distance, ou null. */
export function objetTouche(monde: Monde, o: Vec3, dirs: readonly Vec3[], objets: readonly ObjetSecret[], portee: number): { i: number; distance: number } | null {
  let meilleur: { i: number; distance: number } | null = null;
  for (const d of dirs) {
    for (let i = 0; i < objets.length; i++) {
      const k = rayonSphere(o, d, objets[i].c, objets[i].rayon, portee);
      if (k === null || (meilleur && k >= meilleur.distance) || !aVue(monde, o, d, k)) continue;
      meilleur = { i, distance: k };
    }
  }
  return meilleur;
}

/** Objet atteint par un coup d'arme blanche (œil `o`, direction `d`, portée et cône de l'arme), le plus proche ; index ou null. */
export function objetFrappe(monde: Monde, o: Vec3, d: Vec3, portee: number, cosCone: number, objets: readonly ObjetSecret[]): number | null {
  let meilleur: { i: number; dist: number } | null = null;
  for (let i = 0; i < objets.length; i++) {
    const ob = objets[i];
    const v: Vec3 = [ob.c[0] - o[0], ob.c[1] - o[1], ob.c[2] - o[2]];
    const dist = Math.hypot(v[0], v[1], v[2]);
    if (dist > portee + ob.rayon + SECRET.margeCoupM || dist < 1e-6) continue;
    const u: Vec3 = [v[0] / dist, v[1] / dist, v[2] / dist];
    // dans le cône de l'arme, élargi du rayon apparent de l'objet
    const cos = u[0] * d[0] + u[1] * d[1] + u[2] * d[2];
    const demiObjet = Math.asin(Math.min(1, ob.rayon / dist));
    if (Math.acos(Math.max(-1, Math.min(1, cos))) > Math.acos(cosCone) + demiObjet) continue;
    if (!aVue(monde, o, u, Math.max(0, dist - ob.rayon))) continue;
    if (!meilleur || dist < meilleur.dist) meilleur = { i, dist };
  }
  return meilleur ? meilleur.i : null;
}

const distanceSol = (p: readonly number[], c: readonly number[]): number => Math.hypot(p[0] - c[0], p[2] - c[2]);

/** Générateur congruentiel semé par `graine` (ms), [0, 1[. */
function generateur(graine: number): () => number {
  let s = (Math.floor(Math.abs(graine)) % 2147483647) || 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

/** Mélange de Fisher-Yates (copie) avec le hasard injecté. */
function melanger<T>(l: readonly T[], alea: () => number): T[] {
  const r = [...l];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(alea() * (i + 1)));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// ---------------------------------------------------------------------------------------------
// Machine d'états
// ---------------------------------------------------------------------------------------------

/** Ce que le secret doit savoir de la partie à chaque appel. */
export interface ContexteSecret {
  t: number;
  phase: PhaseZombies;
  courant: boolean;
  /** manche de livraison du Truck Muche en cours, numéro de la livraison (1 = la première), étape du Truck (null : pas de Truck) */
  mancheTruck: boolean;
  numeroTruck: number;
  truck: TruckZombies["phase"] | null;
  /** joueurs admis à la partie */
  joueurs: number;
}

/** Réactions du décor (sons, lumière, objets), transmises telles quelles en `zevt{secret}`. */
export type QuoiSecret =
  | "pendule" | "pendules"
  | "casserole" | "casseroles_rate" | "casseroles"
  | "marmite" | "marmite_vide" | "marmite_pleine"
  | "congelateur"
  | "truffe_prise" | "truffe_fondue" | "truffe_servie"
  | "midi"
  | "ecran" | "ecrans_rate" | "ecrans"
  | "billot" | "billot_plein"
  | "service" | "service_rate" | "servi"
  | "victoire";
export interface EffetSecret { quoi: QuoiSecret; p: Vec3; i?: number; k?: number; joueur?: string }

export interface OptionsSecret {
  monde: Monde;
  /**
   * hasard injecté, [0, 1[ (ordres de l'ardoise, des post-it, du morse) ; absent : un générateur propre au secret, semé par l'instant de
   * chaque nouvelle partie (le hasard de la salle n'est pas consommé : apparitions, boîte et bonus restent ce qu'ils étaient)
   */
  alea?: () => number;
  /** tour du cadran des heures (ms), `PDJ_FPS_ZOMBIES_SECRET_MIDI_MS` (essais) */
  periodeMidiMs?: number;
  /** étape de départ de chaque partie (essais), `PDJ_FPS_ZOMBIES_SECRET` : les étapes d'avant sont considérées faites */
  etapeDepart?: number;
  /** première livraison du Truck où le service s'ouvre (essais), `PDJ_FPS_ZOMBIES_SECRET_LIVRAISON` ; 3 par défaut */
  livraisonService?: number;
}

export interface Secret {
  /** état public (diffusé dans `zombies{etat}`) */
  etat(): EtatSecretZombies;
  etape(): number;
  /** nouvelle partie : décor remis, ordres tirés, étape de départ (essais) */
  reinitialiser(t: number): void;
  /** coup d'arme blanche (œil, direction normalisée, portée et cône de l'arme) : les pendules */
  coup(joueur: string, o: Vec3, d: Vec3, portee: number, cosCone: number, c: ContexteSecret): EffetSecret[];
  /** tir validé (œil, directions des plombs, portée de l'arme) : casseroles, écrans */
  tir(joueur: string, o: Vec3, dirs: readonly Vec3[], portee: number, c: ContexteSecret): EffetSecret[];
  /** une grenade saute en `p` : la cuve n° 3 */
  explosion(p: Vec3, c: ContexteSecret): EffetSecret[];
  /** un joueur a tué un tigre en `p` (pieds) ; `melee` : le coup fatal est d'une arme blanche */
  kill(p: Vec3, melee: boolean, c: ContexteSecret): EffetSecret[];
  /** E sur un objet du secret (`truffe`, `four`, `cloche`) depuis `pos` (position serveur, au sol) */
  interagir(joueur: string, objet: string, pos: Vec2, c: ContexteSecret): EffetSecret[];
  /** une arme vient d'être déposée au Micro-ondes */
  pap(joueur: string, c: ContexteSecret): EffetSecret[];
  /** le Truck Muche de la livraison saute (`detruit`) ou repart intact (`parti`) */
  truck(evt: "detruit" | "parti", c: ContexteSecret): EffetSecret[];
  /** fin de la manche (la marmite se vide, un service raté) */
  finManche(c: ContexteSecret): EffetSecret[];
  /** un joueur tombe (à terre) ou quitte la partie */
  joueurTombe(joueur: string, c: ContexteSecret): EffetSecret[];
  joueurParti(joueur: string, c: ContexteSecret): EffetSecret[];
  /** minuteurs : la truffe qui fond, les écrans à toucher à temps */
  tic(c: ContexteSecret): EffetSecret[];
  /** (essais) saute directement à l'étape `etape` (0 à 9) : les précédentes sont considérées faites */
  forcer(etape: number, t: number): void;
}

const centre = (o: ObjetSecret): Vec3 => [o.c[0], o.c[1], o.c[2]];

export function creerSecret(opts: OptionsSecret): Secret {
  const monde = opts.monde;
  let alea: () => number = opts.alea ?? Math.random;
  const periode = Math.max(1000, opts.periodeMidiMs ?? SECRET.periodeMidiMs);
  const livraisonService = Math.max(1, Math.floor(opts.livraisonService ?? SECRET.livraisonService));
  const C = SECRET_CARTE;
  const pendulesArretees = C.pendules.slice(0, 4);

  let etape = 0;
  let pendules = 0;
  let pendulesT = 0;
  let ardoise: number[] = [0, 1, 2, 3];
  let casseroles = 0;
  let marmite = 0;
  let billot = 0;
  let truffe: { porteur: string; finT: number } | null = null;
  let postits: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
  let code: number[] = [1, 2, 3, 4];
  let ecrans = 0;
  let ecransDebutT = 0;
  let service: number | null = null;
  let victoire = false;
  let joueursVus = 1;

  /** État d'un secret dont toutes les étapes avant `n` sont faites (départ des essais, crochet de dev). */
  function placer(n: number, t: number): void {
    etape = Math.max(0, Math.min(SECRET_SERVI, Math.floor(n)));
    pendules = etape > 0 ? 15 : 0;
    pendulesT = etape > 0 ? t : 0;
    casseroles = 0; marmite = 0; billot = 0; ecrans = 0; ecransDebutT = 0;
    truffe = null; service = null; victoire = false;
  }

  const avancer = (n: NomEtapeSecret | number) => { etape = typeof n === "number" ? n : etapeDe(n); };

  function rater(effets: EffetSecret[], quoi: QuoiSecret, p: Vec3, i?: number): void {
    effets.push({ quoi, p, ...(i !== undefined ? { i } : {}) });
  }

  /** La truffe fond (temps écoulé, porteur à terre ou parti) : la cuve n° 3 se referme, retour à la grenade. */
  function fondre(effets: EffetSecret[]): void {
    if (!truffe) return;
    const porteur = truffe.porteur;
    truffe = null;
    avancer("congelateur");
    effets.push({ quoi: "truffe_fondue", p: centre(C.cuves[2]), joueur: porteur });
  }

  /** Le service tourne court (le Truck repart, quelqu'un tombe, la manche finit) : on pourra le relancer à une livraison suivante. */
  function raterService(effets: EffetSecret[]): void {
    if (service === null) return;
    service = null;
    effets.push({ quoi: "service_rate", p: centre(C.four) });
  }

  const secret: Secret = {
    etat() {
      return {
        etape, pendules, pendulesT, periodeMidiMs: periode, ardoise: [...ardoise], casseroles,
        marmite: Math.min(1, marmite / besoinMarmite(joueursVus)), billot: Math.min(1, billot / besoinBillot(joueursVus)),
        ...(truffe ? { truffe: { ...truffe } } : {}),
        postits: [...postits], ecrans,
        ...(etape === etapeDe("postits") ? { code: [...code] } : {}),
        ...(service !== null ? { service } : {}),
      };
    },

    etape: () => etape,

    reinitialiser(t) {
      if (!opts.alea) alea = generateur(t);
      ardoise = melanger([0, 1, 2, 3], alea);
      postits = melanger([1, 2, 3, 4, 5, 6, 7, 8], alea);
      code = melanger([1, 2, 3, 4, 5, 6, 7, 8], alea).slice(0, 4);
      placer(opts.etapeDepart ?? 0, t);
    },

    coup(joueur, o, d, portee, cosCone, c) {
      if (etape !== etapeDe("pendules") || !c.courant || (c.phase !== "manche" && c.phase !== "pause")) return [];
      const i = objetFrappe(monde, o, d, portee, cosCone, pendulesArretees);
      if (i === null || pendules & (1 << i)) return [];
      pendules |= 1 << i;
      const effets: EffetSecret[] = [{ quoi: "pendule", p: centre(pendulesArretees[i]), i, joueur }];
      if (pendules === 15) {
        // la quatrième repart : toutes les pendules se recalent sur 11 h 58 et tournent ensemble
        pendulesT = c.t;
        avancer("casseroles");
        effets.push({ quoi: "pendules", p: centre(pendulesArretees[i]) });
      }
      return effets;
    },

    tir(joueur, o, dirs, portee, c) {
      if (c.phase !== "manche" && c.phase !== "pause") return [];
      if (etape === etapeDe("casseroles")) {
        const h = objetTouche(monde, o, dirs, C.casseroles, portee);
        if (!h) return [];
        const p = centre(C.casseroles[h.i]);
        if (ardoise[casseroles] !== h.i) {
          // une fausse note : toute la batterie se remet à vibrer, il faut reprendre au début
          casseroles = 0;
          return [{ quoi: "casseroles_rate", p, i: h.i, joueur }];
        }
        casseroles++;
        if (casseroles < 4) return [{ quoi: "casserole", p, i: h.i, k: casseroles / 4, joueur }];
        casseroles = 0;
        avancer("marmite");
        return [{ quoi: "casserole", p, i: h.i, k: 1, joueur }, { quoi: "casseroles", p: centre(C.ardoise) }];
      }
      if (etape === etapeDe("postits")) {
        const h = objetTouche(monde, o, dirs, C.ecrans, portee);
        if (!h) return [];
        const p = centre(C.ecrans[h.i]);
        if (postits[h.i] !== code[ecrans]) {
          ecrans = 0;
          return [{ quoi: "ecrans_rate", p, i: h.i, joueur }];
        }
        if (ecrans === 0) ecransDebutT = c.t;
        ecrans++;
        if (ecrans < code.length) return [{ quoi: "ecran", p, i: h.i, k: ecrans / code.length, joueur }];
        ecrans = 0;
        avancer("hachoir");
        return [{ quoi: "ecran", p, i: h.i, k: 1, joueur }, { quoi: "ecrans", p: centre(C.lampeLocal) }];
      }
      return [];
    },

    explosion(p, c) {
      if (etape !== etapeDe("congelateur") || !c.courant || (c.phase !== "manche" && c.phase !== "pause")) return [];
      const cuve = C.cuves[2];
      if (distanceSol(p, cuve.c) > SECRET.rayonCuveM || Math.abs(p[1] - cuve.c[1]) > SECRET.hauteurCuveM) return [];
      avancer("truffe");
      return [{ quoi: "congelateur", p: centre(cuve) }];
    },

    kill(p, melee, c) {
      if (c.phase !== "manche") return [];
      joueursVus = c.joueurs;
      if (etape === etapeDe("marmite")) {
        if (!c.mancheTruck || distanceSol(p, C.marmite.c) > SECRET.rayonMarmiteM) return [];
        marmite++;
        const besoin = besoinMarmite(c.joueurs);
        if (marmite < besoin) return [{ quoi: "marmite", p: centre(C.marmite), k: marmite / besoin }];
        marmite = 0;
        avancer("congelateur");
        return [{ quoi: "marmite_pleine", p: centre(C.marmite), k: 1 }];
      }
      if (etape === etapeDe("hachoir")) {
        if (!melee || distanceSol(p, C.billot.c) > SECRET.rayonBillotM) return [];
        billot++;
        const besoin = besoinBillot(c.joueurs);
        if (billot < besoin) return [{ quoi: "billot", p: centre(C.billot), k: billot / besoin }];
        billot = 0;
        avancer("service");
        return [{ quoi: "billot_plein", p: centre(C.billot), k: 1 }];
      }
      return [];
    },

    interagir(joueur, objet, pos, c) {
      if (c.phase !== "manche" && c.phase !== "pause") return [];
      const it = INTERACTIONS_SECRET.find((x) => x.id === objet);
      if (!it || Math.hypot(pos[0] - it.position[0], pos[1] - it.position[1]) > it.portee + SECRET.margeInteractionM) return [];
      if (objet === "truffe" && etape === etapeDe("truffe") && !truffe) {
        truffe = { porteur: joueur, finT: c.t + SECRET.truffeMs };
        return [{ quoi: "truffe_prise", p: centre(C.cuves[2]), joueur }];
      }
      if (objet === "four" && etape === etapeDe("truffe") && truffe?.porteur === joueur) {
        if (c.t > truffe.finT) { const e: EffetSecret[] = []; fondre(e); return e; }
        truffe = null;
        avancer("midi");
        return [{ quoi: "truffe_servie", p: centre(C.four), joueur }];
      }
      if (objet === "four" && etape === etapeDe("service") && service === null) {
        // le service ne s'ouvre que pendant une livraison assez tardive, Truck encore là (il arrive ou décharge)
        if (c.phase !== "manche" || !c.mancheTruck || c.numeroTruck < livraisonService) return [];
        if (c.truck !== "arrivee" && c.truck !== "livraison") return [];
        service = c.t;
        return [{ quoi: "service", p: centre(C.four), joueur }];
      }
      if (objet === "cloche" && etape === SECRET_SERVI && !victoire) {
        victoire = true;
        return [{ quoi: "victoire", p: centre(C.cloche), joueur }];
      }
      return [];
    },

    pap(joueur, c) {
      if (etape !== etapeDe("midi") || !dansMidi(pendulesT, periode, c.t)) return [];
      avancer("postits");
      ecrans = 0;
      return [{ quoi: "midi", p: centre(C.lampeLabo), joueur }];
    },

    truck(evt, c) {
      void c;
      if (etape !== etapeDe("service") || service === null) return [];
      if (evt === "parti") { const e: EffetSecret[] = []; raterService(e); return e; }
      service = null;
      avancer(SECRET_SERVI);
      return [{ quoi: "servi", p: centre(C.four) }];
    },

    finManche(c) {
      void c;
      const effets: EffetSecret[] = [];
      if (etape === etapeDe("marmite") && marmite > 0) {
        marmite = 0;
        effets.push({ quoi: "marmite_vide", p: centre(C.marmite) });
      }
      raterService(effets);
      return effets;
    },

    joueurTombe(joueur, c) {
      void c;
      const effets: EffetSecret[] = [];
      if (truffe?.porteur === joueur) fondre(effets);
      raterService(effets);
      return effets;
    },

    joueurParti(joueur, c) {
      void c;
      const effets: EffetSecret[] = [];
      if (truffe?.porteur === joueur) fondre(effets);
      return effets;
    },

    tic(c) {
      const effets: EffetSecret[] = [];
      if (truffe && c.t > truffe.finT) fondre(effets);
      if (etape === etapeDe("postits") && ecrans > 0 && c.t - ecransDebutT > SECRET.ecransMs) {
        ecrans = 0;
        rater(effets, "ecrans_rate", centre(C.lampeLocal));
      }
      return effets;
    },

    forcer(n, t) {
      placer(n, t);
    },
  };
  return secret;
}
