/**
 * Simulation de l'aperçu des zombies : 1 à 4 survivants fictifs tiennent un front de fenêtres d'un bâtiment, des tigres sortent du sol dehors,
 * arrachent les planches, sautent et chassent ; manches successives, planches reposées, survivants à terre relevés. Une partie finie
 * repart sur une nouvelle graine (autre ancre, autre effectif). PUR et déterministe. Spec : 2026-10-29-apercus-modes-design.md
 */
import { aleaGraine } from "../agroparc3d/cachettes";
import type { Vec2 } from "../agroparc3d/types";
import type { JoueurAerien, ModeleApercu, ModeTigreAerien, TigreAerien } from "./apercu-source";
import { tirerEquipe } from "./apercu-noms";
import { Journal, Metronome, PAS_SIM, entierEntre, graineDeCycle, reelEntre, type ContexteSim, type Simulation } from "./apercu-sim";
import type { TraitTir } from "./apercu-sim-arene";

export const ZOMBIES_SIM = {
  survivantsMin: 1, survivantsMax: 4,
  mancheDepartMin: 1, mancheDepartMax: 4,
  /** fenêtres à moins de ceci de l'ancre : le front (au moins 2) */
  frontM: 45,
  vitesseSurvivant: 3.5,
  /** portée de tir (m) et dégâts par seconde de chaque survivant */
  porteeTirM: 14, dpsSurvivant: 200,
  tigresMax: 24,
  planchesParFenetre: 6,
  sortieSolS: 1.2,
  sautS: 0.5,
  arrachageMin: 0.9, arrachageMax: 1.6,
  contactM: 1.2, intervalleGriffeS: 1.5, griffesPourTerre: 4,
  terreS: 8, releveM: 3,
  pauseMancheS: 5, reposePlancheS: 0.3,
  finPartieS: 4,
  traitS: 0.2,
} as const;

/** Vitesse de marche d'un tigre (m/s) selon la manche : 1,6 jusqu'à la 2, 3,4 jusqu'à la 5, 5,6 ensuite. */
export const vitesseTigre = (manche: number): number => (manche <= 2 ? 1.6 : manche <= 5 ? 3.4 : 5.6);
/** PV d'un tigre : 150, +100 par manche jusqu'à la 9. */
export const pvTigre = (manche: number): number => 150 + 100 * (Math.min(manche, 9) - 1);
/** Tigres d'une manche : 6 + 4 par manche au-delà de la première, 24 au plus. */
export const tigresDeManche = (manche: number): number => Math.min(ZOMBIES_SIM.tigresMax, 6 + 4 * (manche - 1));

type EtatSurvivant = "debout" | "terre" | "elimine";
interface Survivant {
  j: JoueurAerien; x: number; z: number;
  etat: EtatSurvivant; touches: number; griffeS: number; terreS: number;
  wx: number; wz: number; bloqueS: number; tirS: number;
}
type Phase = "attente" | "sortie" | "approche" | "arrache" | "saut" | "chasse";
interface Tigre {
  a: TigreAerien; phase: Phase; fen: number; x: number; z: number; pv: number; pvMax: number; v: number;
  phaseS: number; arracheS: number; sx: number; sz: number; griffeS: number;
}

export function creerSimZombies(graine: number, ctx: ContexteSim): Simulation & { traits(): readonly TraitTir[]; fenetresAttaquees(): readonly number[] } {
  const fenetres = ctx.fenetres ?? [];
  const nFen = fenetres.length;
  const metro = new Metronome();
  const journal = new Journal();
  const planches: number[] = new Array(nFen).fill(ZOMBIES_SIM.planchesParFenetre);
  const reposeAcc: number[] = new Array(nFen).fill(0);
  const traits: TraitTir[] = [];
  const tmp: Vec2 = [0, 0];
  const attaquees: number[] = [];

  let cycle = 0;
  let t = 0;
  let alea = aleaGraine(graine);
  let survivants: Survivant[] = [];
  let tigres: Tigre[] = [];
  let front: number[] = [];
  let manche = 1;
  let mancheFin = 3;
  let phaseManche: "manche" | "pause" | "fin" = "manche";
  let pauseS = 0;
  let aApparaitre = 0;
  let prochainS = 0;
  let idTigre = 0;
  let traitAcc = 0;

  function demarrerCycle() {
    alea = aleaGraine(graineDeCycle(graine, cycle));
    planches.fill(ZOMBIES_SIM.planchesParFenetre);
    reposeAcc.fill(0);
    tigres = [];
    traits.length = 0;
    idTigre = 0;
    manche = entierEntre(alea, ZOMBIES_SIM.mancheDepartMin, ZOMBIES_SIM.mancheDepartMax);
    mancheFin = manche + entierEntre(alea, 2, 6);
    const ancre = nFen ? fenetres[entierEntre(alea, 0, nFen - 1)] : null;
    front = [];
    if (ancre) {
      const proches = fenetres.map((f, i) => ({ i, d: Math.hypot(f.milieu[0] - ancre.milieu[0], f.milieu[1] - ancre.milieu[1]) })).sort((a, b) => a.d - b.d);
      front = proches.filter((p) => p.d <= ZOMBIES_SIM.frontM).map((p) => p.i);
      if (front.length < 2) front = proches.slice(0, 2).map((p) => p.i);
    }
    const n = entierEntre(alea, ZOMBIES_SIM.survivantsMin, ZOMBIES_SIM.survivantsMax);
    const equipe = tirerEquipe(alea, n, cycle * 3);
    survivants = equipe.map((e, i) => {
      const dedans = ancre ? ancre.dedans : [ctx.data.focus[0], ctx.data.focus[1]] as Vec2;
      ctx.sol.pointLibre(alea, dedans, 0, 3, tmp);
      return {
        j: { id: `sim-z${cycle}-${i}`, pseudo: e.pseudo, couleur: e.couleur, p: [tmp[0], 0, tmp[1]], sim: true },
        x: tmp[0], z: tmp[1], etat: "debout" as EtatSurvivant, touches: 0, griffeS: 0, terreS: 0, wx: tmp[0], wz: tmp[1], bloqueS: 0, tirS: 0,
      };
    });
    for (const s of survivants) waypointSurvivant(s);
    phaseManche = "manche";
    commencerManche();
    journal.ajouter(t, "Nouvelle partie", 0, true);
  }

  function commencerManche() {
    aApparaitre = tigresDeManche(manche);
    prochainS = 1;
    phaseManche = "manche";
    journal.ajouter(t, `Manche ${manche}`, 0, true);
  }

  function waypointSurvivant(s: Survivant) {
    if (!front.length) return;
    const f = fenetres[front[entierEntre(alea, 0, front.length - 1)]];
    ctx.sol.pointLibre(alea, f.dedans, 0, 2.5, tmp);
    s.wx = tmp[0]; s.wz = tmp[1]; s.bloqueS = 0;
  }

  function apparaitre() {
    if (!front.length) return;
    const idx = front[entierEntre(alea, 0, front.length - 1)];
    const f = fenetres[idx];
    const p = f.points[entierEntre(alea, 0, 2)];
    const r = alea();
    // des types plus rares avec les manches : doré, chef, petit
    const type: TigreAerien["type"] = manche >= 5 && r < 0.05 ? 2 : manche >= 3 && r < 0.12 ? 1 : r > 0.92 ? 3 : 0;
    const pvMax = pvTigre(manche) * (type === 2 ? 2 : type === 3 ? 0.3 : 1);
    const v = vitesseTigre(manche) * (type === 3 ? 1.4 : 1) * reelEntre(alea, 0.9, 1.1);
    const a: TigreAerien = { id: ++idTigre, x: p[0], z: p[1], cap: Math.atan2(f.dehors[0] - p[0], f.dehors[1] - p[1]), type, mode: "sol", pvPct: 100 };
    tigres.push({ a, phase: "sortie", fen: idx, x: p[0], z: p[1], pv: pvMax, pvMax, v, phaseS: ZOMBIES_SIM.sortieSolS, arracheS: 0, sx: 0, sz: 0, griffeS: 0 });
  }

  const debout = (s: Survivant) => s.etat === "debout";
  const mode = (m: ModeTigreAerien, tg: Tigre) => { tg.a.mode = m; };

  function pasTigre(tg: Tigre) {
    const f = fenetres[tg.fen];
    const a = tg.a;
    switch (tg.phase) {
      case "sortie":
        mode("sol", tg);
        tg.phaseS -= PAS_SIM;
        if (tg.phaseS <= 0) { tg.phase = "approche"; mode("chasse", tg); }
        return;
      case "approche": {
        const dx = f.dehors[0] - tg.x, dz = f.dehors[1] - tg.z, d = Math.hypot(dx, dz);
        if (d < 0.6) {
          tg.phase = planches[tg.fen] > 0 ? "arrache" : "saut";
          tg.arracheS = reelEntre(alea, ZOMBIES_SIM.arrachageMin, ZOMBIES_SIM.arrachageMax);
          tg.phaseS = ZOMBIES_SIM.sautS;
          tg.sx = tg.x; tg.sz = tg.z;
          mode(tg.phase === "arrache" ? "fenetre" : "saut", tg);
          return;
        }
        const pas = Math.min(d, tg.v * PAS_SIM);
        tg.x += (dx / d) * pas; tg.z += (dz / d) * pas;
        a.cap = Math.atan2(dx, dz);
        return;
      }
      case "arrache":
        a.cap = Math.atan2(f.dedans[0] - f.dehors[0], f.dedans[1] - f.dehors[1]);
        if (planches[tg.fen] <= 0) { tg.phase = "saut"; tg.phaseS = ZOMBIES_SIM.sautS; tg.sx = tg.x; tg.sz = tg.z; mode("saut", tg); return; }
        tg.arracheS -= PAS_SIM;
        if (tg.arracheS <= 0) {
          planches[tg.fen] -= 1;
          tg.arracheS = reelEntre(alea, ZOMBIES_SIM.arrachageMin, ZOMBIES_SIM.arrachageMax);
          if (planches[tg.fen] <= 0) { tg.phase = "saut"; tg.phaseS = ZOMBIES_SIM.sautS; tg.sx = tg.x; tg.sz = tg.z; mode("saut", tg); }
        }
        return;
      case "saut": {
        tg.phaseS -= PAS_SIM;
        const k = 1 - Math.max(0, tg.phaseS) / ZOMBIES_SIM.sautS;
        tg.x = tg.sx + (f.dedans[0] - tg.sx) * k;
        tg.z = tg.sz + (f.dedans[1] - tg.sz) * k;
        if (tg.phaseS <= 0) { tg.phase = "chasse"; mode("chasse", tg); }
        return;
      }
      case "chasse": {
        let cible: Survivant | null = null, bd = Infinity;
        for (const s of survivants) {
          if (!debout(s)) continue;
          const d = Math.hypot(s.x - tg.x, s.z - tg.z);
          if (d < bd) { bd = d; cible = s; }
        }
        if (!cible) return;
        const dx = cible.x - tg.x, dz = cible.z - tg.z;
        a.cap = Math.atan2(dx, dz);
        if (bd > ZOMBIES_SIM.contactM) {
          const pas = Math.min(bd - ZOMBIES_SIM.contactM * 0.8, tg.v * PAS_SIM);
          tg.x += (dx / bd) * pas; tg.z += (dz / bd) * pas;
        } else {
          tg.griffeS -= PAS_SIM;
          if (tg.griffeS <= 0) {
            tg.griffeS = ZOMBIES_SIM.intervalleGriffeS;
            cible.touches += 1;
            if (cible.touches >= ZOMBIES_SIM.griffesPourTerre) {
              cible.etat = "terre"; cible.terreS = ZOMBIES_SIM.terreS; cible.touches = 0;
              cible.j.hors = "terre";
              journal.ajouter(t, `${cible.j.pseudo} est à terre`, 0, true);
            }
          }
        }
        return;
      }
      default:
        return;
    }
  }

  function pasSurvivant(s: Survivant) {
    if (s.etat === "elimine") return;
    if (s.etat === "terre") {
      s.terreS -= PAS_SIM;
      if (s.terreS <= 0) {
        const sauveur = survivants.find((o) => o !== s && debout(o) && Math.hypot(o.x - s.x, o.z - s.z) <= ZOMBIES_SIM.releveM);
        if (sauveur) { s.etat = "debout"; s.touches = 0; delete s.j.hors; journal.ajouter(t, `${sauveur.j.pseudo} relève ${s.j.pseudo}`, 0, true); }
        else { s.etat = "elimine"; journal.ajouter(t, `${s.j.pseudo} est éliminé`, 0, true); }
      }
      return;
    }
    // un allié à terre : on va le relever, sinon on tient le front
    let ami: Survivant | null = null, bd = Infinity;
    for (const o of survivants) if (o.etat === "terre") { const d = Math.hypot(o.x - s.x, o.z - s.z); if (d < bd) { bd = d; ami = o; } }
    if (ami && bd > ZOMBIES_SIM.releveM * 0.6) { s.wx = ami.x; s.wz = ami.z; }
    else if (Math.hypot(s.wx - s.x, s.wz - s.z) < 1.5 || s.bloqueS > 1) waypointSurvivant(s);
    const dx = s.wx - s.x, dz = s.wz - s.z, d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const pas = Math.min(d, ZOMBIES_SIM.vitesseSurvivant * PAS_SIM);
      ctx.sol.deplacer(s.x, s.z, (dx / d) * pas, (dz / d) * pas, tmp);
      const av = Math.hypot(tmp[0] - s.x, tmp[1] - s.z);
      s.bloqueS = av > pas * 0.3 ? 0 : s.bloqueS + PAS_SIM;
      s.x = tmp[0]; s.z = tmp[1];
    }
  }

  function tirer() {
    traitAcc += PAS_SIM;
    const trace = traitAcc >= ZOMBIES_SIM.traitS;
    if (trace) traitAcc = 0;
    for (const s of survivants) {
      if (!debout(s)) continue;
      let cible: Tigre | null = null, bd: number = ZOMBIES_SIM.porteeTirM;
      for (const tg of tigres) {
        if (tg.phase === "sortie" || tg.phase === "attente" || tg.pv <= 0) continue;
        const d = Math.hypot(tg.x - s.x, tg.z - s.z);
        if (d < bd) { bd = d; cible = tg; }
      }
      if (!cible) continue;
      cible.pv -= ZOMBIES_SIM.dpsSurvivant * PAS_SIM;
      if (trace && traits.length < 24) traits.push({ x0: s.x, z0: s.z, x1: cible.x, z1: cible.z, vie: 0.14 });
    }
    for (const tg of tigres) tg.a.pvPct = Math.max(0, Math.round((100 * Math.max(0, tg.pv)) / tg.pvMax));
  }

  function pasUnique() {
    t += PAS_SIM;
    for (let k = traits.length - 1; k >= 0; k--) { traits[k].vie -= PAS_SIM; if (traits[k].vie <= 0) traits.splice(k, 1); }
    if (phaseManche === "fin") {
      pauseS -= PAS_SIM;
      if (pauseS <= 0) { cycle++; demarrerCycle(); }
      return;
    }
    for (const s of survivants) pasSurvivant(s);
    if (!survivants.some(debout)) {
      phaseManche = "fin";
      pauseS = ZOMBIES_SIM.finPartieS;
      journal.ajouter(t, `Fin de partie à la manche ${manche}`, 0, true);
      return;
    }
    if (phaseManche === "manche") {
      if (aApparaitre > 0) {
        prochainS -= PAS_SIM;
        if (prochainS <= 0) {
          apparaitre();
          aApparaitre -= 1;
          prochainS = 2 * Math.pow(0.95, manche);
        }
      }
      for (const tg of tigres) pasTigre(tg);
      tirer();
      tigres = tigres.filter((tg) => tg.pv > 0);
      if (aApparaitre === 0 && tigres.length === 0) {
        if (manche >= mancheFin) {
          phaseManche = "fin"; pauseS = ZOMBIES_SIM.finPartieS;
          journal.ajouter(t, "Fin de partie", 0, true);
        } else {
          phaseManche = "pause";
          pauseS = ZOMBIES_SIM.pauseMancheS;
        }
      }
    } else {
      // pause entre deux manches : les planches reviennent une par 0,3 s
      for (let i = 0; i < nFen; i++) {
        if (planches[i] >= ZOMBIES_SIM.planchesParFenetre) continue;
        reposeAcc[i] += PAS_SIM;
        if (reposeAcc[i] >= ZOMBIES_SIM.reposePlancheS) { reposeAcc[i] = 0; planches[i] += 1; }
      }
      pauseS -= PAS_SIM;
      if (pauseS <= 0) { manche += 1; commencerManche(); }
    }
    for (const s of survivants) { s.j.p[0] = s.x; s.j.p[2] = s.z; }
    for (const tg of tigres) { tg.a.x = tg.x; tg.a.z = tg.z; }
  }

  const sim: Simulation & { traits(): readonly TraitTir[]; fenetresAttaquees(): readonly number[] } = {
    get cycle() { return cycle; },
    pas(dt) { metro.avancer(dt, pasUnique); },
    modele(s: ModeleApercu) {
      s.source = "simulation";
      s.mode = "zombies";
      s.joueurs.length = 0;
      for (const sv of survivants) if (sv.etat !== "elimine") s.joueurs.push(sv.j);
      s.tigres.length = 0;
      for (const tg of tigres) s.tigres.push(tg.a);
      s.fenetres = planches;
      s.manche = manche;
      s.vivants = survivants.filter(debout).length;
      s.total = survivants.length;
    },
    evenements: () => journal.vider(),
    traits: () => traits,
    fenetresAttaquees() {
      attaquees.length = 0;
      for (const tg of tigres) if (tg.phase === "arrache" && !attaquees.includes(tg.fen)) attaquees.push(tg.fen);
      return attaquees;
    },
  };
  demarrerCycle();
  return sim;
}
