/**
 * Service « événements » de la salle (PUR, v3) : un événement à la fois, annoncé à tous `EVENEMENTS.annonceMs` avant son début.
 *  - Truck Muche fou : il part de chez Elsa et fonce sur le joueur vivant le plus proche (physique des voitures, dérapage compris),
 *    écrase tout ce qu'il touche (`truck_fou`), se débloque en marche arrière, disparaît au bout de `TRUCK_FOU.dureeMs`.
 *  - Tigre robot géant (boss) : il marche vers le joueur le plus proche, écrase sous ses pattes, donne des coups de patte et tire un laser
 *    des yeux annoncé à l'avance (`tigre_robot`). Les joueurs le criblent (`tir.touches` sur CIBLE_TIGRE) ; celui qui l'achève pilote le
 *    TITAN TIGRE pendant `TITAN.dureeMs` : pilote invulnérable, canon (`titan`), écrasement ; le titan a ses propres PV et peut être détruit.
 * Ne voit la salle que par `ContexteSalle`.
 * Spec : docs/superpowers/specs/2026-10-24-arene-evenements-design.md
 */
import { resoudre, visible } from "./collision";
import { carteNavigation, chemin, pointDeVisee } from "./navigation";
import type { ContexteSalle, JoueurSalle, ServiceEvenements, Sortie } from "./match-contexte";
import {
  EVENEMENTS, TIGRE_ROBOT, TITAN, TRUCK_FOU, capVers, dansCoupDePatte, ecraseParTruck, enrouler, oeilTitan, pasTigre, pasTruck,
  pvTigre, sousLeTigre, toucheTigre, yeuxTigre, ECHELLE_TIGRE, type EtatMarcheur,
} from "./monstres";
import {
  CIBLE_TIGRE, CIBLE_TITAN, JEU, SILHOUETTE, type MessageClient, type MonstresSnap, type TypeEvenement, type Vec3,
} from "./protocole";
import type { EtatVehicule } from "./vehicule";

export interface OptionsServiceEvenements {
  /** départ du Truck Muche fou (le stand d'Elsa) */
  truck: { x: number; z: number };
  /** centre de l'arène (rond-point) : le tigre apparaît à `rayonApparition` m de là */
  centre: { x: number; z: number };
  rayonApparition?: number;
  /** délais (ms) : premier événement d'un match, puis entre deux événements ; surchargeables pour les tests */
  premier?: { minMs: number; maxMs: number };
  intervalle?: { minMs: number; maxMs: number };
  /** toujours le même événement (tests, `PDJ_FPS_EVT_TYPE`) */
  forcerType?: TypeEvenement;
  /** horloge de la salle à la création : arme le minuteur tout de suite */
  maintenant?: number;
  /** PV imposés au tigre et au titan (tests) */
  pvTigre?: number;
  pvTitan?: number;
}

const DT_MAX_S = 0.05;
const ARRONDI = (x: number) => Math.round(x * 100) / 100 + 0;
const cm = (p: Vec3): Vec3 => [ARRONDI(p[0]), ARRONDI(p[1]), ARRONDI(p[2])];
const mrad = (a: number) => Math.round(a * 1000) / 1000 + 0;
/** Tolérance (m) ajoutée aux sphères du tigre / du titan pour valider une touche (retard du tireur, mouvement du monstre). */
const MARGE_TOUCHE_M = 1.6;
/** Œil du pilote : écart toléré (m) pour `canon.o`, et cosinus minimal entre le tir et la vue déclarée. */
const ECART_OEIL_TITAN_M = 3;
const COS_VISEE_TITAN = 0.85;
/** Marge (m) de la vitesse du titan et pénétration maximale (m) acceptée dans un bâtiment. */
const MARGE_TITAN_M = 1.5;
const PENETRATION_MAX_M = 0.6;
/** Le tigre change de cible au plus tôt après ce délai (ms). */
const CHANGEMENT_CIBLE_TIGRE_MS = 2_000;
/** Bonus de la tête du tigre / du titan. */
const MULT_TETE_MONSTRE = 1.5;
/** Le chemin vers la cible est recalculé à cet intervalle (ms). */
const CHEMIN_MS = 1_200;
/** Rayons de dégagement (m) des grilles de navigation du tigre et du Truck. */
const DEGAGEMENT_TIGRE_M = TIGRE_ROBOT.rayonCollision + 0.3;
const DEGAGEMENT_TRUCK_M = 1.8;

type Phase =
  | { k: "attente"; t: number }
  | { k: "annonce"; type: TypeEvenement; debutT: number }
  | {
      k: "truck"; finT: number; debutT: number; e: EtatVehicule; cible: string | null; cibleT: number; bloqueDepuis: number | null; reculJusqua: number;
      ch: [number, number][] | null; chT: number;
    }
  | {
      k: "tigre"; finT: number; debutT: number; e: EtatMarcheur; pv: number; pvMax: number; cible: string | null; cibleT: number;
      patteT: number | null; patteDispo: number; laserT: number; laser: { vers: Vec3; tirT: number; de: Vec3 } | null;
      ch: [number, number][] | null; chT: number;
    };

interface Titan { pilote: string; e: EtatMarcheur; pv: number; finT: number; seq: number; etatT: number; prochainCanon: number }

export function creerServiceEvenements(ctx: ContexteSalle, opts: OptionsServiceEvenements): ServiceEvenements {
  const premier = opts.premier ?? { minMs: EVENEMENTS.premierMinMs, maxMs: EVENEMENTS.premierMaxMs };
  const intervalle = opts.intervalle ?? { minMs: EVENEMENTS.intervalleMinMs, maxMs: EVENEMENTS.intervalleMaxMs };
  const delai = (b: { minMs: number; maxMs: number }) => b.minMs + (b.maxMs - b.minMs) * ctx.alea();
  let phase: Phase | null = opts.maintenant !== undefined ? { k: "attente", t: opts.maintenant + delai(premier) } : null;
  let dernierType: TypeEvenement | null = null;
  let titan: Titan | null = null;
  let dernierTicT: number | null = null;

  const vivants = (sauf?: string) => ctx.joueursEnJeu().filter((j) => j.vivant && j.id !== sauf && j.id !== titan?.pilote);
  const prochainType = (): TypeEvenement => {
    if (opts.forcerType) return opts.forcerType;
    if (dernierType === null) return ctx.alea() < 0.5 ? "truck" : "tigre";
    return dernierType === "truck" ? "tigre" : "truck";
  };
  const duree = (type: TypeEvenement) => (type === "truck" ? TRUCK_FOU.dureeMs : TIGRE_ROBOT.dureeMs);

  /** Joueur vivant le plus proche de (x, z), sauf le pilote du titan. */
  function plusProche(x: number, z: number): JoueurSalle | null {
    let meilleur: JoueurSalle | null = null, d = Infinity;
    for (const j of vivants()) {
      const dj = Math.hypot(j.p[0] - x, j.p[2] - z);
      if (dj < d) { d = dj; meilleur = j; }
    }
    return meilleur;
  }

  function finEvenement(type: TypeEvenement, maintenant: number, raison: "temps" | "vaincu", par?: string): Sortie[] {
    const debutT = phase && (phase.k === "truck" || phase.k === "tigre") ? phase.debutT : maintenant;
    phase = { k: "attente", t: maintenant + delai(intervalle) };
    dernierType = type;
    return [{ a: "tous", m: { t: "evenement", type, phase: "fin", debutT, finT: maintenant, raison, ...(par ? { par } : {}) } }];
  }

  // ---------- début des événements ----------

  function demarrerTruck(maintenant: number): Sortie[] {
    const c = opts.centre;
    const cap = capVers(opts.truck.x, opts.truck.z, c.x, c.z);
    phase = {
      k: "truck", debutT: maintenant, finT: maintenant + TRUCK_FOU.dureeMs,
      e: { p: [opts.truck.x, 0, opts.truck.z], cap, v: 0 }, cible: null, cibleT: -Infinity, bloqueDepuis: null, reculJusqua: -Infinity,
      ch: null, chT: -Infinity,
    };
    return [{ a: "tous", m: { t: "evenement", type: "truck", phase: "debut", debutT: maintenant, finT: phase.finT } }];
  }

  /** Point d'apparition du tigre : à `rayonApparition` m du centre, du côté le plus dégagé (essais tous les 45°). */
  function departTigre(): Vec3 {
    const r = opts.rayonApparition ?? 85;
    const depart = ctx.alea() * Math.PI * 2;
    for (let k = 0; k < 8; k++) {
      const a = depart + (k * Math.PI) / 4;
      const p: Vec3 = [opts.centre.x + Math.cos(a) * r, 0, opts.centre.z + Math.sin(a) * r];
      if (!resoudre(ctx.monde, p, TIGRE_ROBOT.rayonCollision + 1, 8).contacts.length) return p;
    }
    return resoudre(ctx.monde, [opts.centre.x + r, 0, opts.centre.z], TIGRE_ROBOT.rayonCollision, 8).p;
  }

  function demarrerTigre(maintenant: number): Sortie[] {
    const p = departTigre();
    const pvMax = opts.pvTigre ?? pvTigre(ctx.joueursEnJeu().length);
    phase = {
      k: "tigre", debutT: maintenant, finT: maintenant + TIGRE_ROBOT.dureeMs, pv: pvMax, pvMax,
      e: { p, cap: capVers(p[0], p[2], opts.centre.x, opts.centre.z), v: 0 }, cible: null, cibleT: -Infinity,
      patteT: null, patteDispo: maintenant + 1_500, laserT: maintenant + TIGRE_ROBOT.laser.premierMs, laser: null,
      ch: null, chT: -Infinity,
    };
    return [{ a: "tous", m: { t: "evenement", type: "tigre", phase: "debut", debutT: maintenant, finT: phase.finT } }];
  }

  // ---------- simulation ----------

  function ticTruck(ph: Extract<Phase, { k: "truck" }>, dt: number, maintenant: number): Sortie[] {
    if (maintenant >= ph.finT) return [{ a: "tous", m: { t: "explosionMonstre", p: cm(ph.e.p), rayon: 4 } }, ...finEvenement("truck", maintenant, "temps")];
    // cible : le plus proche, révisé régulièrement ou à sa mort
    const actuelle = ph.cible ? ctx.joueur(ph.cible) : undefined;
    if (!actuelle || !actuelle.vivant || !actuelle.enJeu || maintenant - ph.cibleT >= TRUCK_FOU.changementCibleMs) {
      ph.cible = plusProche(ph.e.p[0], ph.e.p[2])?.id ?? null;
      ph.cibleT = maintenant;
    }
    const cible = ph.cible ? ctx.joueur(ph.cible) : undefined;
    // bloqué contre un mur : marche arrière braquée un instant
    if (Math.abs(ph.e.v) < 3 && maintenant >= ph.reculJusqua) {
      ph.bloqueDepuis ??= maintenant;
      if (maintenant - ph.bloqueDepuis >= TRUCK_FOU.bloqueMs) { ph.reculJusqua = maintenant + TRUCK_FOU.reculMs; ph.bloqueDepuis = null; }
    } else if (Math.abs(ph.e.v) >= 3) ph.bloqueDepuis = null;
    if (cible && maintenant - ph.chT >= CHEMIN_MS) {
      ph.chT = maintenant;
      ph.ch = chemin(carteNavigation(ctx.monde, DEGAGEMENT_TRUCK_M), [ph.e.p[0], ph.e.p[2]], [cible.p[0], cible.p[2]]);
    }
    const vise = cible && ph.ch ? pointDeVisee(ctx.monde, ph.e.p, ph.ch, TRUCK_FOU.largeur / 2) ?? cible.p : cible ? cible.p : null;
    ph.e = pasTruck(ph.e, vise, maintenant < ph.reculJusqua, dt, ctx.monde);
    const sorties: Sortie[] = [];
    for (const j of vivants()) {
      if (ecraseParTruck(ph.e, j.p, SILHOUETTE.rayon)) sorties.push(...ctx.tuer(j, null, "truck_fou", maintenant));
    }
    return sorties;
  }

  function ticTigre(ph: Extract<Phase, { k: "tigre" }>, dt: number, maintenant: number): Sortie[] {
    if (maintenant >= ph.finT) return finEvenement("tigre", maintenant, "temps");
    const T = TIGRE_ROBOT;
    const sorties: Sortie[] = [];
    const actuelle = ph.cible ? ctx.joueur(ph.cible) : undefined;
    if (!actuelle || !actuelle.vivant || !actuelle.enJeu || maintenant - ph.cibleT >= CHANGEMENT_CIBLE_TIGRE_MS) {
      ph.cible = plusProche(ph.e.p[0], ph.e.p[2])?.id ?? null;
      ph.cibleT = maintenant;
    }
    const cible = ph.cible ? ctx.joueur(ph.cible) : undefined;
    // pendant le coup de patte, il reste planté
    if (cible && maintenant - ph.chT >= CHEMIN_MS) {
      ph.chT = maintenant;
      ph.ch = chemin(carteNavigation(ctx.monde, DEGAGEMENT_TIGRE_M), [ph.e.p[0], ph.e.p[2]], [cible.p[0], cible.p[2]]);
    }
    const vers = cible && ph.ch ? pointDeVisee(ctx.monde, ph.e.p, ph.ch, TIGRE_ROBOT.rayonCollision) : null;
    ph.e = ph.patteT !== null ? { ...ph.e, v: 0 } : pasTigre(ph.e, cible ? cible.p : null, dt, ctx.monde, vers);

    // écrasement sous les pattes quand il marche
    if (ph.e.v > 1) for (const j of vivants()) if (sousLeTigre(ph.e, j.p)) sorties.push(...ctx.tuer(j, null, "tigre_robot", maintenant));

    // coup de patte : armé si quelqu'un est devant, porté `armeMs` plus tard
    if (ph.patteT === null && maintenant >= ph.patteDispo && vivants().some((j) => dansCoupDePatte(ph.e, j.p))) {
      ph.patteT = maintenant + T.patte.armeMs;
    } else if (ph.patteT !== null && maintenant >= ph.patteT) {
      ph.patteT = null;
      ph.patteDispo = maintenant + T.patte.rechargeMs;
      for (const j of vivants()) if (dansCoupDePatte(ph.e, j.p)) sorties.push(...ctx.tuer(j, null, "tigre_robot", maintenant));
    }

    // laser : visée annoncée, impact `avisMs` plus tard sur un disque
    if (ph.laser && maintenant >= ph.laser.tirT) {
      const { vers, de } = ph.laser;
      ph.laser = null;
      sorties.push({ a: "tous", m: { t: "explosionMonstre", p: vers, rayon: T.laser.rayon } });
      for (const j of vivants()) {
        if (j.p[1] < 4 && Math.hypot(j.p[0] - vers[0], j.p[2] - vers[2]) <= T.laser.rayon) {
          sorties.push(...ctx.infliger(j, T.laser.degats, null, "tigre_robot", "corps", "couteau", maintenant, de));
        }
      }
    } else if (!ph.laser && maintenant >= ph.laserT) {
      ph.laserT = maintenant + T.laser.periodeMs;
      const yeux = yeuxTigre(ph.e);
      const vise = vivants()
        .filter((j) => Math.hypot(j.p[0] - yeux[0], j.p[2] - yeux[2]) <= T.laser.portee)
        .find((j) => visible(ctx.monde, yeux, [j.p[0], j.p[1] + 1, j.p[2]]));
      if (vise) {
        const vers = cm([vise.p[0], 0, vise.p[2]]);
        ph.laser = { vers, de: cm(yeux), tirT: maintenant + T.laser.avisMs };
        sorties.push({ a: "tous", m: { t: "laser", de: ph.laser.de, vers, rayon: T.laser.rayon, tirT: ph.laser.tirT } });
      }
    }
    return sorties;
  }

  // ---------- titan ----------

  function demarrerTitan(j: JoueurSalle, p: Vec3, cap: number, maintenant: number): Sortie[] {
    const sorties: Sortie[] = [...ctx.libererVehicule(j, maintenant)];
    const r = resoudre(ctx.monde, [p[0], 0, p[2]], TITAN.rayonCollision, 8).p;
    titan = { pilote: j.id, e: { p: [r[0], 0, r[2]], cap, v: 0 }, pv: opts.pvTitan ?? TITAN.pvMax, finT: maintenant + TITAN.dureeMs, seq: -1, etatT: maintenant, prochainCanon: -Infinity };
    j.p = [r[0], 0, r[2]];
    j.v = [0, 0, 0];
    j.etatT = maintenant;
    j.accroupi = false;
    j.glisse = false;
    sorties.push({ a: "tous", m: { t: "titan", phase: "debut", pilote: j.id, p: cm(j.p), cap: mrad(cap), finT: titan.finT } });
    return sorties;
  }

  /** Le titan s'éteint : le pilote reprend pied à sa place, PV pleins (sauf départ : il n'y a plus de pilote). */
  function finTitan(maintenant: number, raison: "detruit" | "temps" | "depart", par?: string): Sortie[] {
    if (!titan) return [];
    const t = titan;
    titan = null;
    const p = cm(t.e.p);
    const sorties: Sortie[] = [];
    if (raison === "detruit") sorties.push({ a: "tous", m: { t: "explosionMonstre", p: [p[0], 3, p[2]], rayon: 6 } });
    const j = ctx.joueur(t.pilote);
    if (j && raison !== "depart") {
      j.p = [p[0], 0, p[2]];
      j.v = [0, 0, 0];
      j.etatT = maintenant;
      j.histo = [];
      if (j.vivant) j.pv = JEU.pvMax;
    }
    sorties.push({ a: "tous", m: { t: "titan", phase: "fin", pilote: t.pilote, p, cap: mrad(t.e.cap), finT: maintenant, raison, ...(par ? { par } : {}) } });
    return sorties;
  }

  function ticTitan(maintenant: number): Sortie[] {
    if (!titan) return [];
    const pilote = ctx.joueur(titan.pilote);
    if (!pilote || !pilote.enJeu) return finTitan(maintenant, "depart");
    if (maintenant >= titan.finT) return finTitan(maintenant, "temps");
    // le titan s'arrête si le pilote se tait (onglet gelé) : sa vitesse retombe
    if (maintenant - titan.etatT > 300) titan.e = { ...titan.e, v: 0 };
    const sorties: Sortie[] = [];
    if (Math.abs(titan.e.v) > 1.5) {
      for (const j of vivants()) {
        if (sousLeTigre(titan.e, j.p, TITAN.echelle, TITAN.rayonEcrase)) sorties.push(...ctx.tuer(j, pilote, "titan", maintenant));
      }
    }
    return sorties;
  }

  function recevoirPilotage(j: JoueurSalle, m: Extract<MessageClient, { t: "pilotage" }>, maintenant: number): Sortie[] {
    if (!titan || titan.pilote !== j.id) return [];
    if (!Number.isFinite(m.seq) || m.seq <= titan.seq) return [];
    if (!Array.isArray(m.p) || ![m.p[0], m.p[2], m.cap, m.lacet, m.tangage].every(Number.isFinite)) return [];
    const dt = Math.min(Math.max((maintenant - titan.etatT) / 1000, 1 / 120), 0.5);
    const dh = Math.hypot(m.p[0] - titan.e.p[0], m.p[2] - titan.e.p[2]);
    if (dh > (TITAN.vitesse + 1) * dt + MARGE_TITAN_M) return [];
    const r = resoudre(ctx.monde, [m.p[0], 0, m.p[2]], TITAN.rayonCollision, 8);
    if (r.contacts.some((c) => c.profondeur > PENETRATION_MAX_M)) return [];
    titan.seq = m.seq;
    titan.e = { p: [m.p[0], 0, m.p[2]], cap: enrouler(m.cap), v: dh / dt };
    titan.etatT = maintenant;
    j.etatT = maintenant;
    j.p = [m.p[0], 0, m.p[2]];
    j.v = [0, 0, 0];
    j.lacet = m.lacet;
    j.tangage = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, m.tangage));
    j.posture = "sol";
    j.mur = 0;
    return [];
  }

  function recevoirCanon(j: JoueurSalle, m: Extract<MessageClient, { t: "canon" }>, maintenant: number): Sortie[] {
    if (!titan || titan.pilote !== j.id || !j.vivant || !ctx.enPhaseJeu()) return [];
    if (!estVec3(m.o) || !estVec3(m.d)) return [];
    const oeil = oeilTitan(titan.e.p);
    if (Math.hypot(m.o[0] - oeil[0], m.o[1] - oeil[1], m.o[2] - oeil[2]) > ECART_OEIL_TITAN_M) return [];
    const l = Math.hypot(m.d[0], m.d[1], m.d[2]);
    if (l < 0.95 || l > 1.05) return [];
    const d: Vec3 = [m.d[0] / l, m.d[1] / l, m.d[2] / l];
    const ct = Math.cos(j.tangage);
    const visee: Vec3 = [-Math.sin(j.lacet) * ct, Math.sin(j.tangage), -Math.cos(j.lacet) * ct];
    if (d[0] * visee[0] + d[1] * visee[1] + d[2] * visee[2] < COS_VISEE_TITAN) return [];
    // cadence : 85 % de l'intervalle nominal, petit crédit pour la gigue
    const intervalle = TITAN.canon.cadenceS * 1000 * 0.85;
    if (maintenant < titan.prochainCanon) return [];
    titan.prochainCanon = Math.max(titan.prochainCanon, maintenant - 2 * intervalle) + intervalle;
    const sorties: Sortie[] = [{ a: "tous", sauf: j.id, m: { t: "canon", id: j.id, o: m.o, d } }];
    const vus = new Set<string>();
    for (const t of Array.isArray(m.touches) ? m.touches.slice(0, 3) : []) {
      if (!t || typeof t.cible !== "string" || vus.has(t.cible) || (t.zone !== "tete" && t.zone !== "corps")) continue;
      vus.add(t.cible);
      if (t.cible === CIBLE_TIGRE) continue; // pas de tigre pendant le titan (un seul événement à la fois)
      const c = ctx.joueur(t.cible);
      if (!c || c.id === j.id || !c.enJeu || !c.vivant || maintenant < c.protegeJusqua) continue;
      if (!ctx.toucheJoueur(c, m.o, d, TITAN.canon.portee, maintenant)) continue;
      const degats = Math.round(TITAN.canon.degats * (t.zone === "tete" ? MULT_TETE_MONSTRE : 1));
      sorties.push(...ctx.infliger(c, degats, j, "titan", t.zone, "couteau", maintenant, m.o));
    }
    return sorties;
  }

  return {
    tic(maintenant) {
      const dt = dernierTicT === null ? 0 : Math.min(DT_MAX_S, Math.max(0, (maintenant - dernierTicT) / 1000));
      dernierTicT = maintenant;
      phase ??= { k: "attente", t: maintenant + delai(premier) };
      const sorties: Sortie[] = [];
      if (!ctx.enPhaseJeu()) return sorties;
      sorties.push(...ticTitan(maintenant));
      const ph = phase;
      if (ph.k === "attente") {
        // jamais pendant le titan (un monstre à la fois), ni dans une arène vide
        if (maintenant >= ph.t) {
          if (titan || !ctx.joueursEnJeu().length) ph.t = maintenant + 5_000;
          else {
            const type = prochainType();
            const debutT = maintenant + EVENEMENTS.annonceMs;
            phase = { k: "annonce", type, debutT };
            sorties.push({ a: "tous", m: { t: "evenement", type, phase: "annonce", debutT, finT: debutT + duree(type) } });
          }
        }
      } else if (ph.k === "annonce") {
        if (maintenant >= ph.debutT) sorties.push(...(ph.type === "truck" ? demarrerTruck(maintenant) : demarrerTigre(maintenant)));
      } else if (ph.k === "truck") sorties.push(...ticTruck(ph, dt, maintenant));
      else sorties.push(...ticTigre(ph, dt, maintenant));
      return sorties;
    },

    reinitialiser(maintenant) {
      const sorties: Sortie[] = [];
      if (titan) sorties.push(...finTitan(maintenant, "temps"));
      if (phase && phase.k !== "attente") {
        const type = phase.k === "annonce" ? phase.type : phase.k;
        sorties.push(...finEvenement(type, maintenant, "temps"));
      }
      phase = { k: "attente", t: maintenant + delai(premier) };
      dernierTicT = maintenant;
      return sorties;
    },

    synchro(idDest) {
      const sorties: Sortie[] = [];
      const ph = phase;
      if (ph?.k === "annonce") {
        sorties.push({ a: idDest, m: { t: "evenement", type: ph.type, phase: "annonce", debutT: ph.debutT, finT: ph.debutT + duree(ph.type) } });
      } else if (ph?.k === "truck" || ph?.k === "tigre") {
        sorties.push({ a: idDest, m: { t: "evenement", type: ph.k, phase: "etat", debutT: ph.debutT, finT: ph.finT } });
      }
      if (titan) sorties.push({ a: idDest, m: { t: "titan", phase: "etat", pilote: titan.pilote, p: cm(titan.e.p), cap: mrad(titan.e.cap), finT: titan.finT } });
      return sorties;
    },

    snap() {
      const m: MonstresSnap = {};
      const ph = phase;
      if (ph?.k === "truck") m.truck = { p: cm(ph.e.p), cap: mrad(ph.e.cap), v: ARRONDI(Math.hypot(ph.e.v, ph.e.vl ?? 0)) };
      if (ph?.k === "tigre") {
        m.tigre = { p: cm(ph.e.p), cap: mrad(ph.e.cap), v: ARRONDI(ph.e.v), pv: Math.max(0, Math.round(ph.pv)), pvMax: ph.pvMax, ...(ph.patteT !== null ? { a: "patte" as const } : {}) };
      }
      if (titan) m.titan = { pilote: titan.pilote, p: cm(titan.e.p), cap: mrad(titan.e.cap), v: ARRONDI(titan.e.v), pv: Math.max(0, Math.round(titan.pv)), pvMax: opts.pvTitan ?? TITAN.pvMax };
      return m.truck || m.tigre || m.titan ? m : null;
    },

    toucheMonstre(cible, o, d, portee) {
      if (cible === CIBLE_TIGRE && phase?.k === "tigre") return toucheTigre(o, d, portee, phase.e.p, phase.e.cap, ECHELLE_TIGRE, ctx.monde, MARGE_TOUCHE_M);
      if (cible === CIBLE_TITAN && titan) return toucheTigre(o, d, portee, titan.e.p, titan.e.cap, TITAN.echelle, ctx.monde, MARGE_TOUCHE_M);
      return null;
    },

    blesserMonstre(cible, degats, par, zone, maintenant) {
      const dg = Math.max(0, Math.round(degats * (zone === "tete" ? MULT_TETE_MONSTRE : 1)));
      if (dg <= 0 || !ctx.enPhaseJeu()) return [];
      if (cible === CIBLE_TIGRE && phase?.k === "tigre") {
        const ph = phase;
        ph.pv = Math.max(0, ph.pv - dg);
        par.degats += dg;
        const sorties: Sortie[] = [{ a: par.id, m: { t: "degats", cible: CIBLE_TIGRE, par: par.id, degats: dg, pv: ph.pv, bouclier: 0, zone } }];
        if (ph.pv > 0) return sorties;
        const p = ph.e.p, cap = ph.e.cap;
        sorties.push({ a: "tous", m: { t: "explosionMonstre", p: cm([p[0], 4, p[2]]), rayon: 9 } });
        sorties.push(...finEvenement("tigre", maintenant, "vaincu", par.id));
        if (par.vivant && par.enJeu && !titan) sorties.push(...demarrerTitan(par, p, cap, maintenant));
        return sorties;
      }
      if (cible === CIBLE_TITAN && titan && par.id !== titan.pilote) {
        titan.pv = Math.max(0, titan.pv - dg);
        par.degats += dg;
        const sorties: Sortie[] = [{ a: par.id, m: { t: "degats", cible: CIBLE_TITAN, par: par.id, degats: dg, pv: titan.pv, bouclier: 0, zone } }];
        if (titan.pv <= 0) sorties.push(...finTitan(maintenant, "detruit", par.id));
        return sorties;
      }
      return [];
    },

    recevoir(j, m, maintenant) {
      if (m.t === "pilotage") return recevoirPilotage(j, m, maintenant);
      if (m.t === "canon") return recevoirCanon(j, m, maintenant);
      return [];
    },

    estPilote(id) {
      return titan?.pilote === id;
    },

    liberer(j, maintenant) {
      return titan?.pilote === j.id ? finTitan(maintenant, "depart") : [];
    },
  };
}

function estVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

