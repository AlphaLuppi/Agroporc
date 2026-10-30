/**
 * Simulation de l'aperçu du match à mort : 6 à 12 agents fictifs errent sur la carte de l'arène, se poursuivent et se tirent dessus, meurent
 * et réapparaissent ailleurs. Le match ne finit jamais. PUR et déterministe (graine). Spec : 2026-10-29-apercus-modes-design.md
 */
import { aleaGraine } from "../agroparc3d/cachettes";
import type { Vec2 } from "../agroparc3d/types";
import type { JoueurAerien, ModeleApercu } from "./apercu-source";
import { tirerEquipe } from "./apercu-noms";
import { Journal, Metronome, PAS_SIM, entierEntre, reelEntre, type ContexteSim, type Simulation } from "./apercu-sim";
import { ROND_POINT } from "./zones";

export const ARENE_SIM = {
  agentsMin: 6, agentsMax: 12,
  /** rayon du disque de jeu autour du rond-point (m) */
  rayonJeuM: 140,
  vitesseMin: 5.5, vitesseMax: 7.5,
  portéeVueM: 70,
  portéeTirM: 28,
  pauseTirMin: 0.9, pauseTirMax: 2,
  intervalleTraitS: 0.18,
  tirsCumulesMin: 1.6, tirsCumulesMax: 2.5,
  griseMortS: 1.2,
  reapparitionS: 3,
  distanceReapM: 40,
  journalEspaceS: 2.5,
} as const;

type Etat = "errer" | "poursuivre" | "tirer" | "mort";
interface Agent {
  j: JoueurAerien;
  x: number; z: number; v: number;
  etat: Etat;
  /** waypoint d'errance */
  wx: number; wz: number; bloqueS: number;
  /** cible poursuivie ou visée (index) */
  cible: number;
  /** temps restant de la pause de tir et prochain trait */
  pauseS: number; traitS: number;
  /** durée de tir cumulée sur la cible actuelle et durée nécessaire à la tuer */
  cumul: number; besoin: number;
  /** depuis combien de temps l'agent est mort (s) */
  mortS: number;
  /** réapparition dans (s) */
  reapS: number;
  /** ne repart pas en poursuite avant (s) */
  calmeS: number;
}

/** Trait de tir (vue d'en haut) : de l'agent à sa cible, visible `vie` secondes. */
export interface TraitTir { x0: number; z0: number; x1: number; z1: number; vie: number }

export function creerSimArene(graine: number, ctx: ContexteSim): Simulation & { traits(): readonly TraitTir[] } {
  const alea = aleaGraine(graine);
  const sol = ctx.sol;
  const n = entierEntre(alea, ARENE_SIM.agentsMin, ARENE_SIM.agentsMax);
  const equipe = tirerEquipe(alea, n);
  const metro = new Metronome();
  const journal = new Journal();
  const traits: TraitTir[] = [];
  const tmp: Vec2 = [0, 0];
  let t = 0;

  const agents: Agent[] = equipe.map((e, i) => {
    sol.pointLibre(alea, ROND_POINT.centre, 25, ARENE_SIM.rayonJeuM, tmp);
    const j: JoueurAerien = { id: `sim-a${i}`, pseudo: e.pseudo, couleur: e.couleur, p: [tmp[0], 0, tmp[1]], sim: true };
    return {
      j, x: tmp[0], z: tmp[1], v: reelEntre(alea, ARENE_SIM.vitesseMin, ARENE_SIM.vitesseMax), etat: "errer", wx: tmp[0], wz: tmp[1], bloqueS: 0,
      cible: -1, pauseS: 0, traitS: 0, cumul: 0, besoin: 2, mortS: 0, reapS: 0, calmeS: reelEntre(alea, 0, 1.5),
    };
  });

  const vivant = (a: Agent) => a.etat !== "mort";

  function nouveauWaypoint(a: Agent) {
    for (let k = 0; k < 4; k++) {
      sol.pointLibre(alea, [a.x, a.z], 30, 90, tmp);
      if (Math.hypot(tmp[0] - ROND_POINT.centre[0], tmp[1] - ROND_POINT.centre[1]) <= ARENE_SIM.rayonJeuM) { a.wx = tmp[0]; a.wz = tmp[1]; a.bloqueS = 0; return; }
    }
    sol.pointLibre(alea, ROND_POINT.centre, 10, ARENE_SIM.rayonJeuM, tmp);
    a.wx = tmp[0]; a.wz = tmp[1]; a.bloqueS = 0;
  }

  /** index de l'ennemi vivant le plus proche à moins de `rayon`, ou -1 */
  function plusProche(a: Agent, rayon: number): number {
    let best = -1, bd = rayon;
    for (let i = 0; i < agents.length; i++) {
      const b = agents[i];
      if (b === a || !vivant(b)) continue;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Avance l'agent vers (tx, tz) ; faux s'il n'a pas pu avancer (obstacle). */
  function marcher(a: Agent, tx: number, tz: number, vitesse: number): boolean {
    const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
    if (d < 1e-6) return true;
    const pas = Math.min(d, vitesse * PAS_SIM);
    sol.deplacer(a.x, a.z, (dx / d) * pas, (dz / d) * pas, tmp);
    const avance = Math.hypot(tmp[0] - a.x, tmp[1] - a.z);
    a.x = tmp[0]; a.z = tmp[1];
    return avance > pas * 0.3;
  }

  function tuer(tueur: Agent, victime: Agent) {
    victime.etat = "mort";
    victime.mortS = 0;
    victime.reapS = ARENE_SIM.reapparitionS;
    victime.j.hors = "mort";
    journal.ajouter(t, `${tueur.j.pseudo} a éliminé ${victime.j.pseudo}`, ARENE_SIM.journalEspaceS);
  }

  function reapparaitre(a: Agent) {
    // à plus de 40 m de tout ennemi : le meilleur de 8 tirages dans l'anneau 25-140 m
    let meilleur: Vec2 = [0, 0], md = -1;
    for (let k = 0; k < 8; k++) {
      sol.pointLibre(alea, ROND_POINT.centre, 25, ARENE_SIM.rayonJeuM, tmp);
      let dmin = Infinity;
      for (const b of agents) if (b !== a && vivant(b)) dmin = Math.min(dmin, Math.hypot(b.x - tmp[0], b.z - tmp[1]));
      if (dmin > md) { md = dmin; meilleur = [tmp[0], tmp[1]]; }
      if (dmin >= ARENE_SIM.distanceReapM) break;
    }
    a.x = meilleur[0]; a.z = meilleur[1];
    a.etat = "errer";
    a.cible = -1;
    a.cumul = 0;
    a.calmeS = 1;
    delete a.j.hors;
    nouveauWaypoint(a);
  }

  function pasAgent(a: Agent, idx: number) {
    if (a.etat === "mort") {
      a.mortS += PAS_SIM;
      a.reapS -= PAS_SIM;
      if (a.reapS <= 0) reapparaitre(a);
      return;
    }
    a.calmeS -= PAS_SIM;
    if (a.etat === "tirer") {
      const c = agents[a.cible];
      if (!c || !vivant(c)) { a.etat = "errer"; a.cible = -1; return; }
      a.pauseS -= PAS_SIM;
      a.traitS -= PAS_SIM;
      a.cumul += PAS_SIM;
      if (a.traitS <= 0) {
        a.traitS = ARENE_SIM.intervalleTraitS;
        if (traits.length < 24) traits.push({ x0: a.x, z0: a.z, x1: c.x, z1: c.z, vie: 0.14 });
      }
      if (a.cumul >= a.besoin) { tuer(a, c); a.etat = "errer"; a.cible = -1; a.cumul = 0; nouveauWaypoint(a); return; }
      if (a.pauseS <= 0) a.etat = "poursuivre";
      return;
    }
    // errer / poursuivre : repérer un ennemi
    if (a.etat === "errer" && a.calmeS <= 0) {
      const c = plusProche(a, ARENE_SIM.portéeVueM);
      if (c >= 0) { if (c !== a.cible) { a.cumul = 0; a.besoin = reelEntre(alea, ARENE_SIM.tirsCumulesMin, ARENE_SIM.tirsCumulesMax); } a.cible = c; a.etat = "poursuivre"; a.bloqueS = 0; }
    }
    if (a.etat === "poursuivre") {
      const c = agents[a.cible];
      if (!c || !vivant(c) || Math.hypot(c.x - a.x, c.z - a.z) > ARENE_SIM.portéeVueM * 1.4) { a.etat = "errer"; a.cible = -1; nouveauWaypoint(a); return; }
      const d = Math.hypot(c.x - a.x, c.z - a.z);
      if (d < ARENE_SIM.portéeTirM) {
        a.etat = "tirer";
        a.pauseS = reelEntre(alea, ARENE_SIM.pauseTirMin, ARENE_SIM.pauseTirMax);
        a.traitS = 0;
        // l'ennemi se défend : il répond au feu s'il n'était pas déjà en train de tirer
        if (c.etat !== "tirer") { c.etat = "tirer"; c.cible = idx; c.pauseS = reelEntre(alea, ARENE_SIM.pauseTirMin, ARENE_SIM.pauseTirMax); c.traitS = 0.05; c.cumul = 0; c.besoin = reelEntre(alea, ARENE_SIM.tirsCumulesMin, ARENE_SIM.tirsCumulesMax); }
        return;
      }
      const avance = marcher(a, c.x, c.z, a.v);
      a.bloqueS = avance ? 0 : a.bloqueS + PAS_SIM;
      if (a.bloqueS > 1.2) { a.etat = "errer"; a.cible = -1; a.calmeS = 2; nouveauWaypoint(a); }
      return;
    }
    // errer
    if (Math.hypot(a.wx - a.x, a.wz - a.z) < 3 || a.bloqueS > 1) nouveauWaypoint(a);
    const avance = marcher(a, a.wx, a.wz, a.v * 0.85);
    a.bloqueS = avance ? 0 : a.bloqueS + PAS_SIM;
  }

  const sim: Simulation & { traits(): readonly TraitTir[] } = {
    cycle: 0,
    pas(dt) {
      metro.avancer(dt, () => {
        t += PAS_SIM;
        for (let k = traits.length - 1; k >= 0; k--) { traits[k].vie -= PAS_SIM; if (traits[k].vie <= 0) traits.splice(k, 1); }
        for (let i = 0; i < agents.length; i++) pasAgent(agents[i], i);
        for (const a of agents) { a.j.p[0] = a.x; a.j.p[2] = a.z; }
      });
    },
    modele(s: ModeleApercu) {
      s.source = "simulation";
      s.mode = "arene";
      s.joueurs.length = 0;
      for (const a of agents) if (a.etat !== "mort" || a.mortS < ARENE_SIM.griseMortS) s.joueurs.push(a.j);
      s.tigres.length = 0;
      s.vivants = agents.filter(vivant).length;
      s.total = agents.length;
    },
    evenements: () => journal.vider(),
    traits: () => traits,
  };
  return sim;
}
