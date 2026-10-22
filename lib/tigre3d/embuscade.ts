/**
 * Embuscade du tigre (pur, sans three ni DOM, testé par embuscade.test.ts) : à chaque image, la
 * scène du tigre lui passe l'état de Macron lu dans le canal de lib/rencontre.ts, et elle pilote la
 * mère de la troupe.
 *
 *   libre → (Macron et le tigre à l'écran, disponibles : plan d'embuscade, sinon rien pour ce
 *   passage de Macron) → course vers le point (galop ou éclair, demi-tour compris) → arrêt sur le
 *   point, de profil face à Macron, dressé, batte armée (geste « batte ») → coup quand Macron
 *   arrive à portée (`declencherFrappe`) → fin du geste : il reprend sa course d'origine (s'il
 *   doit pour cela passer sur Macron au sol, il attend d'abord qu'il se relève et reparte).
 *
 * Macron parti, Macron trop tard (il a dépassé le point, ou le plan ne tient plus pendant la
 * course), tigre cliqué entre-temps, ou annulation (onglet caché, démontage) : la rencontre
 * s'arrête sans erreur et le tigre reprend sa course.
 * Une seule tentative par passage de Macron, et un seul coup.
 */
import { ECHELLE_MODELE, type Troupe } from "./troupe";
import { AVANCE_CONTACT, PRET_BATTE, T_IMPACT } from "./gestes/batte";
import type { ModeCourse } from "./animateur";
import { VITESSES } from "../tigre-courant";
import { declencherFrappe, planEmbuscade, type EtatPersonnage, type PlanEmbuscade } from "../rencontre";

export const REGLAGES_EMBUSCADE = {
  /** Vitesse de course vers le point (largeurs de tigre par seconde) : galop au moins, éclair au plus. */
  vitesseMin: 3.4,
  vitesseMax: VITESSES.eclair[1],
  /** Au-delà, l'allure « éclair » (traînée orange) : il fonce. */
  seuilEclair: 6,
  /** Accélérer, freiner, se dresser et armer (s), et l'avance de sécurité (s). */
  tPreparation: 1.7,
  tMarge: 0.3,
  /**
   * Inverser la course (s) : freiner, piétiner sur place le temps de se retourner (le corps attend
   * ses pieds, cf. corps.ts), relancer. Mesuré sur la vraie troupe : il ne repart dans l'autre sens
   * que ≈ 2,5 s après l'ordre, quelle que soit son allure, soit ≈ 2 s de plus qu'une course directe.
   */
  tDemiTour: 2.4,
  /** Se tourner vers Macron une fois arrêté sur le point (s) : mesuré ≈ 0,6 à 0,8 s, avec marge. */
  tVolte: 1.1,
  /**
   * Attente au plus longue (s) devant Macron au sol avant de repartir à travers lui : la chute, le
   * sol et le relevé durent ≈ 3,3 s dans lib/macron3d/ko.ts, le coup en a déjà pris ≈ 1,4.
   */
  attenteReleveMax: 3.5,
  /** Marge (m de tigre) entre le tigre posté et le bord de l'écran : entier à l'écran, comme pour une réaction. */
  margeTigreM: 1.5,
  /** Raideur du freinage visé (1/s) : le geste démarre à |v| / freinage du point, il s'y arrête en freinant. */
  freinage: 4,
} as const;

export type PhaseEmbuscade = "libre" | "course" | "arme" | "coup" | "fini";

export interface OptionsEmbuscade {
  largeurEcran: number;
  /** Largeur d'un tigre adulte (px) : unité de vitesse. */
  largeurTigrePx: number;
  /** Pixels par mètre de tigre (ceux de la troupe). */
  pxParMetre: number;
}

export interface Embuscade {
  readonly phase: PhaseEmbuscade;
  readonly plan: PlanEmbuscade | null;
  /** Une image : état de Macron publié dans le canal (null : absent). */
  maj(macron: EtatPersonnage | null): void;
  /** Rencontre annulée (onglet caché, démontage, changement de thème) : il reprend sa course. */
  annuler(): void;
  /** Distance (px) entre le centre du tigre et celui de Macron au contact. */
  portee(macron: EtatPersonnage): number;
  /** État du tigre (la mère) à publier dans le canal. */
  etatTigre(passage: number): EtatPersonnage;
  /**
   * Crochet de développement (captures) : embuscade imposée au point `x`, face à `face`, sans
   * attendre Macron ni vérifier qu'il arrivera à temps. `surArme` est appelé une fois la batte armée
   * (on y lance Macron), et Macron absent n'annule rien tant qu'il n'est pas arrivé.
   */
  forcer(o: { x: number; face: 1 | -1; surArme?: () => void }): void;
}

export function creerEmbuscade(troupe: Troupe, o: OptionsEmbuscade): Embuscade {
  const R = REGLAGES_EMBUSCADE;
  const mere = troupe.mere, anim = mere.anim;
  /** px d'écran par mètre du modèle, pour la mère. */
  const k = ECHELLE_MODELE * o.pxParMetre;
  let phase: PhaseEmbuscade = "libre";
  let plan: PlanEmbuscade | null = null;
  let essai: number | null = null;
  let origine: { sens: 1 | -1; mode: ModeCourse; vitesse: number } | null = null;
  let dir: 1 | -1 = 1;
  let force: { surArme?: () => void; arme: boolean; vu: boolean } | null = null;
  /** Début (horloge de l'animateur) de l'attente devant Macron au sol, null hors attente. */
  let attente: number | null = null;

  const portee = (m: EtatPersonnage) => AVANCE_CONTACT * k + m.rayon;
  const surEcran = () => mere.x >= 0 && mere.x <= o.largeurEcran;

  /** Course d'origine rendue dès que la mère n'a plus de réaction (tout de suite, ou à la fin du geste). */
  function rendre() {
    if (!origine || anim.reaction) return;
    troupe.courir(origine);
    origine = null;
    attente = null;
  }
  /**
   * Fin du coup. Si sa course d'origine le mène vers Macron (il lui faisait face en arrivant), il
   * passerait sur son corps couché, tombé en arrière de son côté : il reste planté là, face à lui,
   * petits compris (vitesse nulle), jusqu'à ce que Macron reparte, puis reprend sa course.
   */
  function finCoup(m: EtatPersonnage | null) {
    phase = "fini";
    if (origine && plan && !anim.reaction && origine.sens === plan.face && m && m.present && !m.disponible) {
      attente = anim.t;
      troupe.courir({ sens: origine.sens, vitesse: 0 });
      return;
    }
    rendre();
  }
  function arreter() {
    if (anim.reaction?.nom === "batte") anim.interrompre();
    phase = "fini";
    rendre();
  }

  function planifier(m: EtatPersonnage) {
    essai = m.passage;
    // Rencontre naturelle : plus rien de l'embuscade imposée d'un passage précédent de Macron.
    force = null;
    plan = planEmbuscade({
      tigre: {
        x: mere.x, sens: anim.sens, vitesseMax: R.vitesseMax * o.largeurTigrePx,
        arret: (Math.abs(anim.corps.v) / R.freinage) * k,
      },
      macron: { x: m.x, sens: m.sens, vitesse: m.vitesse },
      largeurEcran: o.largeurEcran,
      portee: portee(m),
      margeTigre: Math.min(R.margeTigreM * o.pxParMetre, o.largeurEcran / 2),
      margeMacron: 2 * m.rayon,
      tPreparation: R.tPreparation, tDemiTour: R.tDemiTour, tVolte: R.tVolte, tElan: T_IMPACT, tMarge: R.tMarge,
    });
    if (!plan) { phase = "fini"; return; }
    origine = { sens: anim.sens, mode: anim.mode, vitesse: anim.vitesse };
    // Même règle que planEmbuscade : derrière lui, il fait demi-tour.
    dir = (plan.x - mere.x) * anim.sens >= 0 ? anim.sens : anim.sens === 1 ? -1 : 1;
    // Allure : le temps de course est ce qui reste une fois la préparation, l'élan du coup et la
    // marge retirés. Assez vite pour être prêt à temps (×1,4 : il lui faut accélérer), jamais
    // moins qu'un galop.
    const vMaxPx = R.vitesseMax * o.largeurTigrePx;
    const tCourse = plan.tContact - T_IMPACT - R.tMarge - (plan.tTigre - plan.chemin / vMaxPx);
    const voulue = (plan.chemin / Math.max(0.3, tCourse) / o.largeurTigrePx) * 1.4;
    const vitesse = Math.min(R.vitesseMax, Math.max(R.vitesseMin, voulue));
    troupe.courir({ sens: dir, vitesse, mode: vitesse > R.seuilEclair ? "eclair" : "galop" });
    phase = "course";
    poster();
  }

  /**
   * Assez près du point pour s'y arrêter en freinant : le geste démarre, point d'arrêt imposé.
   * Jamais tant qu'il s'éloigne encore du point (demi-tour en cours) : l'approche du geste le
   * ramènerait au pas, bien trop lentement.
   */
  function poster() {
    if (!plan) return;
    if (anim.corps.v * dir < -0.05) return;
    const reste = (plan.x - mere.x) * dir;
    const freinage = (Math.abs(anim.corps.v) / R.freinage) * k;
    if (reste > freinage + 2) return;
    anim.demarrer("batte", { sensGeste: plan.face, xArret: anim.corps.x + (plan.x - mere.x) / k });
    phase = "arme";
  }

  /**
   * En course, le plan ne tient plus : Macron atteindra le point de contact avant que le tigre ait
   * pu, au mieux, y courir à l'éclair, se dresser et lancer le coup. Minorant du temps qu'il lui
   * reste, donc jamais d'abandon à tort : il renonce dès que c'est perdu au lieu de courir pour rien.
   */
  function intenable(m: EtatPersonnage) {
    if (!plan) return true;
    if (declencherFrappe({
      xTigre: plan.x, face: plan.face, xMacron: m.x, vitesseMacron: m.vitesse, tElan: T_IMPACT, portee: portee(m),
    }) === "trop-tard") return true;
    const tMacron = ((m.x - plan.x) * plan.face - portee(m)) / Math.max(m.vitesse, 1);
    const tTigre = Math.abs(plan.x - mere.x) / (R.vitesseMax * o.largeurTigrePx) + PRET_BATTE + T_IMPACT;
    return tMacron < tTigre;
  }

  return {
    get phase() { return phase; },
    get plan() { return plan; },
    portee,
    etatTigre(passage) {
      return {
        present: surEcran(), x: mere.x, sens: anim.sens, vitesse: Math.abs(anim.corps.v) * k,
        disponible: anim.reaction == null, passage, rayon: 0.5 * o.pxParMetre,
      };
    },
    forcer({ x, face, surArme }) {
      if (anim.reaction) return;
      origine = { sens: anim.sens, mode: anim.mode, vitesse: anim.vitesse };
      plan = { x, face, tContact: Infinity, tTigre: 0, chemin: Math.abs(x - mere.x) };
      force = { surArme, arme: false, vu: false };
      dir = (x - mere.x) * anim.sens >= 0 ? anim.sens : anim.sens === 1 ? -1 : 1;
      troupe.courir({ sens: dir, vitesse: R.vitesseMin, mode: "galop" });
      phase = "course";
      poster();
    },
    annuler() {
      if (phase === "course" || phase === "arme") arreter();
      else if (attente != null) rendre();
    },
    maj(m) {
      const macronLa = !!m && m.present && m.disponible;
      if (phase === "fini") {
        // Macron reparti (vitesse revenue), parti, ou attente trop longue : il reprend sa course.
        if (attente == null || !m || !m.present || m.vitesse > 1 || anim.t - attente > R.attenteReleveMax) rendre();
        // Nouveau passage de Macron : une nouvelle tentative est possible.
        if (m && m.passage !== essai && !origine) phase = "libre";
        else return;
      }
      if (phase === "libre") {
        if (macronLa && m!.passage !== essai && m!.vitesse > 1 && surEcran() && anim.reaction == null) planifier(m!);
        return;
      }
      // Un clic sur le tigre a lancé une autre réaction : elle passe avant, la rencontre s'arrête.
      if (anim.reaction && anim.reaction.nom !== "batte") { phase = "fini"; return; }
      if (force && macronLa) { force.vu = true; essai = m!.passage; }
      // Embuscade imposée (crochet de développement) : Macron n'est pas encore là, on l'attend.
      const attendre = !!force && !force.vu;
      if (phase === "course") {
        if (!macronLa && !attendre) { arreter(); return; }
        if (!force && intenable(m!)) { arreter(); return; }
        poster();
        return;
      }
      if (phase === "arme") {
        // Geste fini sans coup (attente trop longue) ou Macron parti.
        if (!anim.reaction) { phase = "fini"; rendre(); return; }
        const r = anim.reaction;
        if (force && !force.arme && r.tGeste != null && anim.t - r.tGeste >= PRET_BATTE) {
          force.arme = true;
          force.surArme?.();
        }
        if (attendre) return;
        if (!macronLa) { arreter(); return; }
        const decision = declencherFrappe({
          xTigre: mere.x, face: plan!.face, xMacron: m!.x, vitesseMacron: m!.vitesse, tElan: T_IMPACT, portee: portee(m!),
        });
        if (decision === "trop-tard") arreter();
        else if (decision === "frapper" && anim.signaler()) phase = "coup";
        return;
      }
      if (phase === "coup" && !anim.reaction) finCoup(m);
    },
  };
}
