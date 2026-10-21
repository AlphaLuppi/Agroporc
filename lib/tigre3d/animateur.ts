/**
 * Animateur : machine d'états d'UN tigre, sans three ni DOM (les maths de three seulement).
 *   course → (approche : il freine, se recale dans l'écran, se tourne vers nous) → geste → course
 *
 * Tout le mouvement est fait par le moteur du corps (lib/tigre3d/corps.ts) : pieds plantés,
 * allures continues, caps en cascade (tête → épaules → bassin). Un geste (lib/tigre3d/gestes/)
 * est une COUCHE posée par-dessus, groupe d'os par groupe d'os, dont le poids suit sa cible par un
 * ressort propre à chaque groupe : la tête part vite, le corps suit, la queue traîne ; à la fin du
 * geste les poids retombent de même. Aucun fondu figé, aucune pose qui saute.
 *
 * L'hôte (troupe, scène) reçoit des événements : bulle, particules, secousse, fuite (le sursaut
 * retourne le tigre, qui file à l'éclair en sens inverse), fin de réaction. Le déplacement de
 * chaque image (`dx`, m du modèle) est celui que les pieds ont réellement parcouru : la troupe
 * l'applique tel quel, le tigre ne patine jamais.
 */
import { creerCorps, avancerCorps, type Corps, type Couche } from "./corps";
import { GROUPE_DE, GROUPES, LONGUEUR_MODELE_M, type Groupe, type Role } from "./os";
import { amortir, borne, ressort, type Ressort } from "./ressorts";
import { clipNomme } from "./clips";
import { GESTES } from "./gestes";
import type { ContexteGeste, Geste, PoseGeste } from "./gestes/types";
import type { PoseTigre } from "./squelette";
import {
  decisionClic, DELAI_BULLE, DUREES, humeurRegard, texteBulle, tirerReaction, VITESSE_CONTENT, VITESSE_VEXE,
  type GenreParticule, type HumeurRegard, type Reaction,
} from "../tigre-reactions";

export type ModeCourse = "galop" | "eclair" | "trot" | "debout";

export type EvenementTigre =
  /** `prolonge` : même bulle que celle affichée (bulle dite tôt), l'hôte n'en change que la durée. */
  | { type: "bulle"; texte: string; duree: number; prolonge?: boolean }
  | { type: "particules"; genre: GenreParticule; nombre: number; delai: number }
  | { type: "secousse"; duree: number }
  | { type: "fuite"; sens: 1 | -1 }
  | { type: "fin"; reaction: Reaction; vitesse?: number };

/** Réaction en cours : instants en secondes de l'horloge de l'animateur. */
export interface EtatReaction {
  nom: Reaction;
  /** Instant du clic. */
  t0: number;
  /** Début du geste (après l'approche : arrêt, recalage, rotation), null pendant l'approche. */
  tGeste: number | null;
  /** Fin prévue (secondes depuis le début du geste) ; la tape la repousse selon le clic. */
  fin: number;
  tClap: number | null;
  tVexe: number | null;
  /** Instant (depuis le début du geste) où la patte levée est prête à claquer. */
  tPret: number;
  texte: string;
  humeur: HumeurRegard;
  faits: number;
  /** Arrêté depuis (approche). */
  tArret: number | null;
  /** Point d'arrêt visé (x du corps), fixé au clic : là où il s'arrêterait en freinant. */
  xArret: number | null;
  /** Le geste a déjà retourné le tigre (événement « volteface ») : la fin ne le retourne plus. */
  volte: boolean;
  /** Bulle déjà dite pendant l'approche (`bulleTot`). */
  bulleDite: boolean;
  /** Tape : second clic reçu (après « Tope là ! ») avant que la patte soit levée, joué dès qu'elle l'est. */
  clicEnAttente: boolean;
}

export const FENETRE_TAPE = DUREES.fenetreTape / 1000;
const DUREE_CLAP = DUREES.clap / 1000;
const DUREE_VEXE = DUREES.vexe / 1000;
const ENTREE_TAPE = DUREES.entreeTape / 1000;
/** Plafond du pas de temps : un onglet qui reprend la main ne fait pas bondir l'animation. */
export const DT_MAX = 0.1;
/** Approche au plus longue (s) : au-delà, le geste part même si le tigre n'a pas fini de se tourner. */
const APPROCHE_MAX = 2.2;
/** Raideur du freinage (1/s) : il s'arrête en ≈ 1 / FREINAGE s × 3, sur v / FREINAGE m. */
const FREINAGE = 6;
/** Vitesse (m/s du modèle) pour se recaler dans l'écran. */
const VITESSE_RECALAGE = 1.1;

/** Raideur (rad/s) du poids de chaque groupe : la tête part la première, la queue en dernier. */
const OMEGA_GROUPE: Record<Groupe, number> = {
  corps: 7, colonne: 7, cou: 10, tete: 12, machoire: 16, oreilles: 14, queue: 5, avG: 9, avD: 9, arG: 9, arD: 9,
};

export interface OptionsAnimateur {
  sens?: 1 | -1;
  mode?: ModeCourse;
  vitesse?: number;
  echelle?: number;
  phase?: number;
  alea?: () => number;
  graine?: number;
}

interface CoucheActive {
  geste: Geste;
  /** Début (horloge de l'animateur). */
  t0: number;
  fin: number;
  actif: boolean;
  poids: Record<Groupe, Ressort>;
  ctx: ContexteGeste;
  derniere: PoseGeste;
  avance: number;
}

export interface Animateur {
  sens: 1 | -1;
  mode: ModeCourse;
  /** Vitesse de croisière en largeurs de tigre (adulte) par seconde (réglée par l'hôte). */
  vitesse: number;
  echelle: number;
  /** Phase des allures (foulées). */
  readonly phase: number;
  t: number;
  reaction: EtatReaction | null;
  derniere: Reaction | null;
  figee: boolean;
  /** Vitesse courante / vitesse de croisière (0 arrêté, 1 lancé). */
  facteurVitesse: number;
  /** Vitesse imposée (m/s du modèle, signée) : les petits calquent la mère. */
  vitesseImposee: number | null;
  /** Zone (x du corps, m du modèle) où s'arrêter pour réagir : la troupe la donne pour rester à l'écran. */
  zoneArret: { min: number; max: number } | null;
  corps: Corps;
  pose: PoseTigre;
  /** Déplacement en x de la dernière image (m du modèle, à multiplier par l'échelle). */
  dx: number;
  /** Cap des épaules (rad, 0 = face caméra). */
  readonly cap: number;
  sur(f: (e: EvenementTigre) => void): () => void;
  maj(dt: number): PoseTigre;
  /** Un clic : lance une réaction (tirée au hasard ou `forcer`) ou valide la tape. */
  clic(forcer?: Reaction | null): "lancer" | "taper" | "ignorer";
  demarrer(nom: Reaction): void;
  figer(v: boolean): void;
  courir(opts?: { mode?: ModeCourse; vitesse?: number; sens?: 1 | -1 }): void;
}

const poidsVides = () => Object.fromEntries(GROUPES.map((g) => [g, ressort(0)])) as Record<Groupe, Ressort>;

/** Groupes touchés par une pose (poids par défaut 1). */
function groupesTouches(p: PoseGeste): Set<Groupe> {
  const s = new Set<Groupe>();
  if (p.corps || p.avance != null) s.add("corps");
  for (const champ of [p.deltas, p.os, p.t]) for (const r of Object.keys(champ ?? {}) as Role[]) s.add(GROUPE_DE[r]);
  for (const pt of Object.keys(p.pattes ?? {}) as Groupe[]) s.add(pt);
  if (p.regard != null) { s.add("tete"); s.add("cou"); }
  return s;
}

export function creerAnimateur({
  sens = 1, mode = "galop", vitesse = 2.5, echelle = 1, alea = Math.random, graine,
}: OptionsAnimateur = {}): Animateur {
  let ecouteurs: Array<(e: EvenementTigre) => void> = [];
  const emettre = (e: EvenementTigre) => { for (const f of ecouteurs) f(e); };
  const corps = creerCorps({ cap: sens * Math.PI / 2, graine: graine ?? Math.floor(alea() * 1000) });
  let couches: CoucheActive[] = [];

  /** Vitesse de croisière en m/s du modèle (unités propres : un petit court plus vite dans les siennes). */
  const croisiere = () => (A.vitesse * LONGUEUR_MODELE_M) / A.echelle;

  function ctxGeste(r: EtatReaction): ContexteGeste {
    return {
      sens: A.sens, tClap: r.tClap, tVexe: r.tVexe, humeur: r.humeur, clip: clipNomme, temps: A.t,
    };
  }

  function lancerCouche(r: EtatReaction) {
    const geste = GESTES[r.nom];
    couches.push({
      geste, t0: A.t, fin: r.fin, actif: true, poids: poidsVides(), ctx: ctxGeste(r), derniere: {}, avance: 0,
    });
  }

  function claquer(r: EtatReaction, tg: number) {
    r.tClap = tg;
    r.fin = r.tClap + DUREE_CLAP;
    r.clicEnAttente = false;
    emettre({ type: "bulle", texte: texteBulle("clap", alea()), duree: 1.0 });
    emettre({ type: "particules", genre: "clap", nombre: 8, delai: 0.06 });
  }

  const A: Animateur = {
    sens, mode, vitesse, echelle, t: 0,
    get phase() { return corps.phase; },
    reaction: null,
    derniere: null,
    figee: false,
    facteurVitesse: 1,
    vitesseImposee: null,
    zoneArret: null,
    corps,
    pose: corps.pose,
    dx: 0,
    get cap() { return corps.psiE.x; },
    sur(f) {
      ecouteurs.push(f);
      return () => { ecouteurs = ecouteurs.filter((x) => x !== f); };
    },

    clic(forcer = null) {
      const r = A.reaction;
      // Le second clic de la tape ne compte que patte levée et tant que la fenêtre est ouverte.
      const tg = r && r.tGeste != null ? A.t - r.tGeste : -1;
      const fenetre = !!r && r.nom === "tape" && r.tClap == null && r.tVexe == null && tg > r.tPret;
      const decision = decisionClic(r ? r.nom : null, fenetre);
      if (decision === "lancer") {
        const nom = forcer || tirerReaction(alea(), A.derniere);
        A.derniere = nom;
        A.demarrer(nom);
        return "lancer";
      }
      if (decision === "taper" && r) {
        claquer(r, tg);
        return "taper";
      }
      // Tape : le tigre a dit « Tope là ! » mais sa patte n'est pas encore levée : le clic est gardé
      // et joué dès qu'elle l'est (pas de clic perdu sans retour).
      if (r && r.nom === "tape" && r.bulleDite && r.tClap == null && r.tVexe == null) r.clicEnAttente = true;
      return "ignorer";
    },

    demarrer(nom) {
      const geste = GESTES[nom];
      const texte = texteBulle(nom, alea());
      A.reaction = {
        nom, t0: A.t, tGeste: null, tClap: null, tVexe: null, tPret: ENTREE_TAPE,
        fin: nom === "tape" ? ENTREE_TAPE + FENETRE_TAPE : geste.duree,
        texte, humeur: nom === "regard" ? humeurRegard(texte) : "curieux", faits: 0, tArret: null, xArret: null, volte: false, bulleDite: false, clicEnAttente: false,
      };
      if (!geste.immobile) { A.reaction.tGeste = A.t; lancerCouche(A.reaction); }
    },

    maj(dt) {
      dt = Math.min(Math.max(dt, 0), DT_MAX);
      A.t += dt;
      const r = A.reaction;
      const geste = r ? GESTES[r.nom] : null;
      // Volte-face du geste : le lacet qu'il a donné au corps (image précédente) passe dans les caps,
      // le sens s'inverse ; le geste, lui, rend désormais un lacet nul. Rien ne saute à l'écran.
      if (r && r.tGeste != null && geste && !r.volte) {
        const ev = geste.evenements?.find((e) => e.type === "volteface");
        if (ev && A.t - r.tGeste >= ev.t) {
          r.volte = true;
          let lacet = 0;
          for (const c of couches) lacet += (c.derniere.corps?.lacet ?? 0) * Math.min(1, Math.max(0, c.poids.corps.x));
          corps.psiT.x += lacet; corps.psiE.x += lacet; corps.psiB.x += lacet;
          A.sens = A.sens === 1 ? -1 : 1;
        }
      }

      const v0 = croisiere();
      let vit = v0, cap = A.sens * Math.PI / 2, regard = 0, sensDep: 1 | -1 = A.sens;
      let reactivite: number | undefined;

      if (r && geste) {
        if (geste.immobile && r.tGeste == null) {
          // Approche : freiner, se recaler dans la zone, se tourner vers nous.
          const x = corps.x, v = corps.v;
          r.xArret ??= x + v / FREINAGE;
          let cible = r.xArret;
          if (A.zoneArret) cible = Math.min(A.zoneArret.max, Math.max(A.zoneArret.min, cible));
          let d = cible - x;
          // Dépassé de peu en freinant : on reste là, sauf s'il faut revenir dans l'écran.
          if (d * A.sens < 0) {
            const dehors = A.zoneArret && (x > A.zoneArret.max + 0.06 || x < A.zoneArret.min - 0.06);
            if (!dehors) { r.xArret = x; d = 0; }
          }
          const loin = Math.abs(d) > 0.04;
          sensDep = (d >= 0 ? 1 : -1);
          // Vers l'avant : freinage du premier ordre jusqu'au point d'arrêt ; demi-tour : au pas.
          const enArriere = sensDep !== A.sens;
          vit = loin ? Math.min(FREINAGE * Math.abs(d), enArriere ? VITESSE_RECALAGE : Infinity) : 0;
          // Il faut faire demi-tour pour se recaler : on y va au pas, de profil.
          // Il se tourne vers nous dès qu'il a assez ralenti (tête d'abord, cf. corps.ts) ; pour
          // revenir dans l'écran il marche de profil.
          const recale = loin && (enArriere || Math.abs(v) > 1.3);
          cap = recale ? sensDep * Math.PI / 2 : (geste.cap ? geste.cap(A.sens) : A.sens * 0.25);
          // Retour immédiat au clic : la tête (puis les oreilles, par ressort) se tourne vers nous dès
          // le clic, même en pleine course ; le corps suit quand il a ralenti.
          regard = 1;
          // Freinage assez fort pour s'arrêter au point visé (près du bord de sortie, au lieu de le
          // dépasser puis de revenir au pas) : premier ordre, distance d'arrêt = v / raideur.
          if (!enArriere && loin) reactivite = borne(Math.abs(v) / Math.max(Math.abs(d), 0.05), 5.5, 12);
          const arrete = Math.abs(d) < 0.15 && Math.abs(v) < 0.25;
          if (arrete && r.tArret == null) {
            r.tArret = A.t;
            if (geste.bulleTot && !r.bulleDite) {
              r.bulleDite = true;
              emettre({ type: "bulle", texte: r.texte, duree: APPROCHE_MAX });
            }
          }
          if (!arrete && Math.abs(d) > 0.08) r.tArret = null;
          const tourne = Math.abs(corps.psiE.x - cap) < 0.45 && Math.abs(corps.psiB.x - cap) < 0.85;
          if ((r.tArret != null && (tourne || A.t - r.tArret > 1.2)) || A.t - r.t0 > APPROCHE_MAX + 2) {
            r.tGeste = A.t;
            lancerCouche(r);
          }
        } else if (geste.immobile || geste.freine) {
          vit = 0;
          cap = geste.immobile ? (geste.cap ? geste.cap(A.sens) : A.sens * 0.25) : corps.psiE.x;
          regard = 1;
        }
      }
      if (A.figee && !r) { vit = 0; cap = A.sens * 0.35; regard = 1; }

      // Couches de geste : échantillonnage, poids lissés par groupe.
      const actives: Couche[] = [];
      let avance = 0;
      for (const c of couches) {
        const tc = Math.max(0, A.t - c.t0);
        if (c.actif && r && r.tGeste != null) { c.ctx.tClap = r.tClap; c.ctx.tVexe = r.tVexe; c.ctx.temps = A.t; }
        const p = c.geste.echantillonner(Math.min(tc, c.fin + 1), c.ctx);
        c.derniere = p;
        const touches = groupesTouches(p);
        const poids = {} as Record<Groupe, number>;
        for (const g of GROUPES) {
          const voulu = c.actif ? (p.poids?.[g] ?? (touches.has(g) ? 1 : 0)) : 0;
          poids[g] = Math.min(1, Math.max(0, amortir(c.poids[g], voulu, OMEGA_GROUPE[g], dt)));
        }
        if (p.avance != null) { avance += (p.avance - c.avance) * poids.corps; c.avance = p.avance; }
        actives.push({ pose: p, poids });
      }
      // Une couche éteinte dont tous les poids sont retombés disparaît.
      couches = couches.filter((c) => c.actif || GROUPES.some((g) => c.poids[g].x > 0.002 || Math.abs(c.poids[g].v) > 0.01));

      avancerCorps(corps, dt, {
        vitesse: vit, sens: sensDep, cap, regard, couches: actives, avance, reactivite,
        vitesseImposee: A.vitesseImposee ?? undefined,
      });
      A.dx = corps.dx;
      A.facteurVitesse = v0 > 0 ? Math.min(1, Math.abs(corps.v) / v0) : 0;

      // Événements et fin du geste.
      if (r && r.tGeste != null && geste) {
        const tg = A.t - r.tGeste;
        const evs = geste.evenements ?? [{ t: DELAI_BULLE[r.nom] / 1000, type: "bulle" as const }];
        while (r.faits < evs.length && tg >= evs[r.faits].t) {
          const e = evs[r.faits++];
          if (e.type === "bulle") {
            const duree = r.nom === "tape" ? FENETRE_TAPE : Math.max(0.9, r.fin - e.t - 0.1);
            emettre({ type: "bulle", texte: e.texte ?? r.texte, duree: e.duree ?? duree, prolonge: r.bulleDite && !e.texte });
          } else if (e.type === "particules") emettre({ type: "particules", genre: e.genre, nombre: e.nombre, delai: 0 });
          else if (e.type === "secousse") emettre({ type: "secousse", duree: e.duree });
        }
        if (r.nom === "tape" && r.clicEnAttente && r.tClap == null && r.tVexe == null && tg > r.tPret) claquer(r, tg);
        // Tape : fenêtre dépassée sans second clic, il baisse la patte, vexé.
        if (r.nom === "tape" && r.tClap == null && r.tVexe == null && tg > r.fin) {
          r.tVexe = tg;
          r.fin = tg + DUREE_VEXE;
          emettre({ type: "bulle", texte: texteBulle("vexe", alea()), duree: 0.9 });
        }
        const couche = couches.find((c) => c.actif);
        if (couche) couche.fin = r.fin;
        if (tg >= r.fin) {
          const nom = r.nom;
          const vitFin = nom === "tape" ? (r.tClap != null ? VITESSE_CONTENT : VITESSE_VEXE) : undefined;
          A.reaction = null;
          for (const c of couches) c.actif = false;
          if (nom === "sursaut") {
            if (!r.volte) A.sens = A.sens === 1 ? -1 : 1;
            A.mode = "eclair";
            emettre({ type: "fuite", sens: A.sens });
          }
          emettre({ type: "fin", reaction: nom, vitesse: vitFin });
        }
      }
      return A.pose;
    },

    /** Les petits : on les fige (ils s'arrêtent et se tournent vers nous) pendant que la mère réagit. */
    figer(v) { A.figee = v; },

    /** Change d'état de course (mode, sens, vitesse) : le corps s'y rend à son rythme (demi-tour en piétinant). */
    courir(opts = {}) {
      if (opts.mode) A.mode = opts.mode;
      if (opts.vitesse != null) A.vitesse = opts.vitesse;
      if (opts.sens != null) A.sens = opts.sens;
    },
  };

  // Départ lancé : le tigre entre déjà à sa vitesse de croisière, pattes en phase.
  corps.v = sens * croisiere();
  for (let i = 0; i < 90; i++) avancerCorps(corps, 1 / 60, { vitesse: croisiere(), sens, cap: sens * Math.PI / 2, regard: 0, couches: [] });
  corps.dx = 0;
  return A;
}
