/**
 * Grenades côté client (PUR, testé : ni three, ni DOM, ni réseau). Deux rôles :
 *  - la main du joueur : `presser` tire la goupille d'une grenade à fragmentation (la mèche court, un bip par demi-seconde : la cuisson
 *    de BO1) et `relacher` la lance avec le temps de cuisson ; au bout de la mèche, elle part toute seule (elle saute dans la main : le
 *    serveur la fait exploser tout de suite). Le tigre à remontoir part dès la pression (il ne cuit pas) ;
 *  - les grenades à dessiner : la mienne est prédite dès le lancer (même trajectoire que le serveur, `preparerLancer` de grenades.ts), puis
 *    remplacée par celle du serveur à la réception de `grenade` (o, v, t0, explosionT font foi) ; celles des autres arrivent par `grenade`.
 *    Une grenade disparaît à son `zevt{grenade}` (ou, faute de message, 1,5 s après son échéance ; une prédiction jamais confirmée, 1,5 s
 *    après le lancer : le serveur l'a refusée).
 * Les instants sont en ms de l'horloge du SERVEUR (`client.maintenantServeur()`), sauf la cuisson (horloge locale, ms).
 */
import type { Monde } from "./collision";
import {
  BIP_CUISSON_MS, GRENADES, positionTrajectoire, preparerLancer, trajectoireDuMessage, vitesseLancer, type Plafond, type Trajectoire,
} from "./grenades";
import type { GenreGrenade, Vec3 } from "./protocole";

/** Une prédiction non confirmée par le serveur au bout de ce délai (ms) est abandonnée (lancer refusé). */
export const PREDICTION_MAX_MS = 1_500;
/** Une grenade dont l'explosion n'est jamais annoncée disparaît ce délai (ms) après son échéance. */
export const EXPLOSION_MAX_MS = 1_500;

export interface GrenadeVue {
  /** id serveur, ou négatif pour une prédiction locale */
  id: number;
  genre: GenreGrenade;
  par: string;
  t0: number;
  explosionT: number;
  traj: Trajectoire;
  /** instant serveur où elle se pose (Infinity si elle ne se pose pas) */
  poseT: number;
  predite: boolean;
}

/** Ce qu'il faut dessiner d'une grenade à l'instant demandé. */
export interface GrenadeAffichee {
  id: number;
  genre: GenreGrenade;
  p: Vec3;
  /** position un pas plus tôt (sens du vol, traînée) */
  avant: Vec3;
  /** posée au sol (le remontoir joue ses cymbales) */
  posee: boolean;
  /** 0..1 : part de la mèche écoulée */
  mecheEcoulee: number;
  /** traînée : positions des `TRAINEE_POINTS` derniers échantillons (du plus récent au plus ancien), vide une fois posée */
  trainee: Vec3[];
}

/** Traînée : nombre de points et écart entre deux (ms). */
export const TRAINEE_POINTS = 8;
export const TRAINEE_PAS_MS = 30;

/** Lancer à envoyer au serveur (`lancerGrenade`) et à prédire. */
export interface LancerDemande { genre: GenreGrenade; cuissonMs: number }

export interface ControleurGrenades {
  /** touche pressée : frag → goupille tirée (renvoie null, la cuisson commence) ; remontoir → lancer immédiat. `stock` : ce qu'il reste. */
  presser(genre: GenreGrenade, tLocalMs: number, stock: number): LancerDemande | null;
  /** touche relâchée : le lancer de la grenade en cuisson, ou null */
  relacher(genre: GenreGrenade, tLocalMs: number): LancerDemande | null;
  /** à chaque image : bip de cuisson à jouer, et lancer forcé au bout de la mèche */
  majCuisson(tLocalMs: number): { bip: boolean; lancer: LancerDemande | null };
  /** cuisson abandonnée (mort, à terre, sortie de partie) : la grenade n'est pas lancée */
  annuler(): void;
  /** une grenade est en cuisson (HUD) ; part de la mèche écoulée 0..1 */
  cuisson(tLocalMs: number): number | null;
  /** ma grenade, prédite à l'instant serveur estimé `tServeur` */
  predire(genre: GenreGrenade, o: Vec3, d: Vec3, tServeur: number, cuissonMs: number, moi: string): GrenadeVue;
  /** `grenade` du serveur (la mienne remplace ma plus ancienne prédiction du même genre) */
  recevoir(m: { id: number; par: string; genre: GenreGrenade; o: Vec3; v: Vec3; t0: number; explosionT: number }, moi: string): GrenadeVue;
  /** `zevt{grenade}` : la grenade disparaît ; renvoie celle qui était dessinée (ou undefined) */
  exploser(id: number): GrenadeVue | undefined;
  /** grenades à dessiner à l'instant serveur `t` (purge des expirées) */
  affichees(t: number): GrenadeAffichee[];
  /** chocs audibles entre `t0` (exclu) et `t1` (inclus), instants serveur */
  rebonds(t0: number, t1: number): { p: Vec3; force: number }[];
  /** prédictions de ce genre pas encore confirmées (à retirer du stock affiché) */
  enAttente(genre: GenreGrenade): number;
  vider(): void;
}

export function creerControleurGrenades(monde: Monde, plafond?: Plafond): ControleurGrenades {
  const vues: GrenadeVue[] = [];
  let cuisson: { genre: GenreGrenade; debut: number; prochainBip: number } | null = null;
  let idPredit = 0;

  const demande = (genre: GenreGrenade, cuissonMs: number): LancerDemande => ({ genre, cuissonMs: Math.max(0, Math.round(cuissonMs)) });

  return {
    presser(genre, tLocal, stock) {
      if (stock <= 0) return null;
      if (!GRENADES[genre].cuisson) return cuisson ? null : demande(genre, 0);
      if (cuisson) return null;
      cuisson = { genre, debut: tLocal, prochainBip: tLocal + BIP_CUISSON_MS };
      return null;
    },

    relacher(genre, tLocal) {
      if (!cuisson || cuisson.genre !== genre) return null;
      const c = cuisson;
      cuisson = null;
      return demande(genre, Math.min(GRENADES[genre].mecheMs, tLocal - c.debut));
    },

    majCuisson(tLocal) {
      if (!cuisson) return { bip: false, lancer: null };
      const meche = GRENADES[cuisson.genre].mecheMs;
      if (tLocal - cuisson.debut >= meche) {
        const genre = cuisson.genre;
        cuisson = null;
        return { bip: false, lancer: demande(genre, meche) };
      }
      let bip = false;
      if (tLocal >= cuisson.prochainBip) { bip = true; cuisson.prochainBip += BIP_CUISSON_MS; }
      return { bip, lancer: null };
    },

    annuler() { cuisson = null; },

    cuisson(tLocal) {
      return cuisson ? Math.min(1, (tLocal - cuisson.debut) / GRENADES[cuisson.genre].mecheMs) : null;
    },

    predire(genre, o, d, tServeur, cuissonMs, moi) {
      const l = preparerLancer(monde, genre, o, vitesseLancer(genre, d), tServeur, cuissonMs, { plafond });
      const v: GrenadeVue = { id: -(++idPredit), genre, par: moi, t0: l.t0, explosionT: l.explosionT, traj: l.traj, poseT: l.poseT, predite: true };
      vues.push(v);
      return v;
    },

    recevoir(m, moi) {
      if (m.par === moi) {
        const i = vues.findIndex((x) => x.predite && x.genre === m.genre);
        if (i >= 0) vues.splice(i, 1);
      }
      const existante = vues.findIndex((x) => !x.predite && x.id === m.id);
      if (existante >= 0) vues.splice(existante, 1);
      const traj = trajectoireDuMessage(monde, m, { plafond });
      const prof = GRENADES[m.genre];
      const poseT = prof.attractionM > 0 ? m.explosionT - prof.mecheMs : Number.isFinite(traj.arretMs) ? m.t0 + traj.arretMs : Infinity;
      const v: GrenadeVue = { id: m.id, genre: m.genre, par: m.par, t0: m.t0, explosionT: m.explosionT, traj, poseT, predite: false };
      vues.push(v);
      return v;
    },

    exploser(id) {
      const i = vues.findIndex((x) => !x.predite && x.id === id);
      if (i < 0) return undefined;
      return vues.splice(i, 1)[0];
    },

    affichees(t) {
      for (let i = vues.length - 1; i >= 0; i--) {
        const v = vues[i];
        if ((v.predite && t - v.t0 > PREDICTION_MAX_MS) || t - v.explosionT > EXPLOSION_MAX_MS) vues.splice(i, 1);
      }
      return vues.map((v) => {
        const ms = Math.min(t, v.explosionT) - v.t0;
        const prof = GRENADES[v.genre];
        const meche = prof.attractionM > 0 ? Math.max(0, t - v.poseT) / prof.mecheMs : (t - (v.explosionT - prof.mecheMs)) / prof.mecheMs;
        const posee = t >= v.poseT;
        const trainee: Vec3[] = [];
        if (!posee) for (let k = 0; k < TRAINEE_POINTS && ms - k * TRAINEE_PAS_MS >= 0; k++) trainee.push(positionTrajectoire(v.traj, ms - k * TRAINEE_PAS_MS));
        return {
          id: v.id, genre: v.genre, p: positionTrajectoire(v.traj, ms), avant: positionTrajectoire(v.traj, ms - 40),
          posee, mecheEcoulee: Math.max(0, Math.min(1, meche)), trainee,
        };
      });
    },

    rebonds(t0, t1) {
      const r: { p: Vec3; force: number }[] = [];
      for (const v of vues) {
        for (const b of v.traj.rebonds) {
          const tb = v.t0 + b.tMs;
          if (tb > t0 && tb <= t1 && tb <= v.explosionT) r.push({ p: positionTrajectoire(v.traj, b.tMs), force: b.force });
        }
      }
      return r;
    },

    enAttente(genre) {
      return vues.filter((v) => v.predite && v.genre === genre).length;
    },

    vider() { vues.length = 0; cuisson = null; },
  };
}
