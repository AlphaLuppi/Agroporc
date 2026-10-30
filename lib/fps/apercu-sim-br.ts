/**
 * Simulation de l'aperçu du Battle Royale : 14 à 32 joueurs fictifs sautent de l'avion, chutent, ouvrent le parachute, atterrissent près d'un
 * bâtiment, fouillent, suivent la zone qui se resserre et s'éliminent jusqu'au dernier ; puis une nouvelle partie (nouvelle graine). Les
 * éliminations sont programmées d'avance pour qu'il en reste un seul à la fermeture. PUR et déterministe. Spec : 2026-10-29-apercus-modes-design.md
 */
import { aleaGraine } from "../agroparc3d/cachettes";
import type { Vec2 } from "../agroparc3d/types";
import type { AvionBr, ZoneBr } from "./protocole";
import type { JoueurAerien, ModeleApercu } from "./apercu-source";
import { tirerEquipe } from "./apercu-noms";
import { Journal, Metronome, PAS_SIM, entierEntre, graineDeCycle, reelEntre, type ContexteSim, type Simulation } from "./apercu-sim";
import { tracerVolBr, positionAvionBr } from "./br-chute";
import { etatZone, genererPlanZone, zoneBrPublique, type PlanZone } from "./br-zone";

export const BR_SIM = {
  joueursMin: 14, joueursMax: 32,
  /** durée de la traversée de l'avion (s) et fenêtre de saut au début de la traversée */
  volS: 16, sautMaxS: 12,
  chuteLibreS: 5, voileS: 6,
  altitudeFinChuteM: 60,
  /** part du trajet horizontal parcourue en chute libre */
  partLibre: 0.35,
  vitesseMin: 5, vitesseMax: 7,
  echelleZone: 0.09,
  /** la zone commence ce temps avant le début de la fouille (s) */
  avanceZoneS: 4,
  morts: { apresFouilleS: 3, avantFermetureS: 8, ecartMinS: 0.6, poursuiteS: 5, vitesseTueur: 2.2, griseS: 5, proximiteTueurM: 40 },
  victoireS: 6,
  /** l'avion reste affiché ce temps après la fin de sa traversée (s) */
  avionResteS: 2,
} as const;

type Phase = "avion" | "libre" | "voile" | "sol" | "mort";
interface Joueur {
  j: JoueurAerien;
  phase: Phase;
  tSaut: number;
  /** point de saut et d'atterrissage */
  sx: number; sz: number; lx: number; lz: number;
  x: number; z: number; y: number;
  v: number;
  wx: number; wz: number; bloqueS: number;
  mortT: number; tueur: number;
  /** instant programmé de la mort (s), Infinity pour le vainqueur */
  tMort: number;
  mortS: number;
}

export function creerSimBr(graine: number, ctx: ContexteSim): Simulation & { avion(): AvionBr | null } {
  const bornes = ctx.bornes;
  const centres = ctx.centresBatiments ?? [];
  const metro = new Metronome();
  const journal = new Journal();
  const tmp: Vec2 = [0, 0];
  let cycle = 0;
  let t = 0;
  let alea = aleaGraine(graine);
  let joueurs: Joueur[] = [];
  let avion: AvionBr = { depart: [0, 0], arrivee: [0, 0], altitude: 350, vitesse: 30, debutT: 0, finT: 16_000 };
  let plan: PlanZone;
  let zoneCache: ZoneBr | null = null;
  let cleZone = "";
  let tFermeture = 0;
  let tFin = Infinity;
  let palierAnnonce = 0;
  let vainqueurAnnonce = false;

  function demarrerCycle() {
    alea = aleaGraine(graineDeCycle(graine, cycle));
    t = 0;
    const n = entierEntre(alea, BR_SIM.joueursMin, BR_SIM.joueursMax);
    const equipe = tirerEquipe(alea, n, cycle * 5);
    avion = tracerVolBr(bornes, alea, 0, { dureeMs: BR_SIM.volS * 1000 });
    joueurs = equipe.map((e, i) => {
      const tSaut = reelEntre(alea, 0, BR_SIM.sautMaxS);
      const pa = positionAvionBr(avion, tSaut * 1000);
      // atterrissage près d'un des trois bâtiments les plus proches du point de saut
      let cible: Vec2 = [(bornes.x0 + bornes.x1) / 2, (bornes.z0 + bornes.z1) / 2];
      if (centres.length) {
        const proches = [...centres].sort((a, b) => Math.hypot(a[0] - pa[0], a[1] - pa[2]) - Math.hypot(b[0] - pa[0], b[1] - pa[2]));
        cible = proches[entierEntre(alea, 0, Math.min(2, proches.length - 1))];
      }
      ctx.sol.pointLibre(alea, cible, 0, 45, tmp);
      return {
        j: { id: `sim-b${cycle}-${i}`, pseudo: e.pseudo, couleur: e.couleur, p: [pa[0], pa[1], pa[2]], sim: true },
        phase: "avion" as Phase, tSaut, sx: pa[0], sz: pa[2], lx: tmp[0], lz: tmp[1], x: pa[0], z: pa[2], y: pa[1],
        v: reelEntre(alea, BR_SIM.vitesseMin, BR_SIM.vitesseMax), wx: tmp[0], wz: tmp[1], bloqueS: 0, mortT: 0, tueur: -1, tMort: Infinity, mortS: 0,
      };
    });
    const tFouille = BR_SIM.sautMaxS + BR_SIM.chuteLibreS + BR_SIM.voileS;
    const debutZone = tFouille - BR_SIM.avanceZoneS;
    plan = genererPlanZone({ bornes, debutT: debutZone * 1000, alea, centresBatiments: centres.map((c) => [c[0], c[1]] as [number, number]), echelle: BR_SIM.echelleZone });
    const dureeZone = plan.paliers.reduce((s, p) => s + p.attenteMs + p.retreciMs, 0) / 1000;
    tFermeture = debutZone + dureeZone;
    // éliminations programmées : n - 1 instants tirés d'avance, triés, espacés, le dernier à 8 s de la fermeture
    const debut = tFouille + BR_SIM.morts.apresFouilleS, fin = tFermeture - BR_SIM.morts.avantFermetureS;
    const instants: number[] = [];
    for (let i = 0; i < n - 1; i++) instants.push(reelEntre(alea, debut, fin));
    instants.sort((a, b) => a - b);
    for (let i = 1; i < instants.length; i++) if (instants[i] - instants[i - 1] < BR_SIM.morts.ecartMinS) instants[i] = instants[i - 1] + BR_SIM.morts.ecartMinS;
    instants[instants.length - 1] = Math.min(instants[instants.length - 1], tFermeture - 2);
    const ordreMort = joueurs.map((_, i) => i);
    for (let i = ordreMort.length - 1; i > 0; i--) { const k = Math.floor(alea() * (i + 1)); [ordreMort[i], ordreMort[k]] = [ordreMort[k], ordreMort[i]]; }
    for (let i = 0; i < instants.length; i++) joueurs[ordreMort[i]].tMort = instants[i];
    tFin = Infinity;
    palierAnnonce = 0;
    vainqueurAnnonce = false;
    zoneCache = zoneBrPublique(plan, 0);
    cleZone = "1attente";
    journal.ajouter(t, `${n} joueurs dans l'avion`, 0, true);
  }

  const vivants = () => joueurs.filter((p) => p.phase !== "mort").length;

  function pointDansZone(p: Joueur) {
    const e = etatZone(plan, t * 1000);
    const r = Math.max(10, e.rayon * 0.85);
    ctx.sol.pointLibre(alea, e.centre, 0, r, tmp);
    p.wx = tmp[0]; p.wz = tmp[1]; p.bloqueS = 0;
  }

  function marcher(p: Joueur, tx: number, tz: number, v: number): boolean {
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 1e-6) return true;
    const pas = Math.min(d, v * PAS_SIM);
    ctx.sol.deplacer(p.x, p.z, (dx / d) * pas, (dz / d) * pas, tmp);
    const av = Math.hypot(tmp[0] - p.x, tmp[1] - p.z);
    p.x = tmp[0]; p.z = tmp[1];
    return av > pas * 0.3;
  }

  function tuer(victime: Joueur) {
    victime.phase = "mort";
    victime.mortS = 0;
    victime.j.hors = "mort";
    delete victime.j.chute;
    const tueur = victime.tueur >= 0 ? joueurs[victime.tueur] : null;
    const reste = vivants();
    const e = etatZone(plan, t * 1000);
    const hors = Math.hypot(victime.x - e.centre[0], victime.z - e.centre[1]) > e.rayon;
    if (tueur && tueur.phase === "sol" && Math.hypot(tueur.x - victime.x, tueur.z - victime.z) <= BR_SIM.morts.proximiteTueurM) {
      journal.ajouter(t, `${tueur.j.pseudo} a éliminé ${victime.j.pseudo} (${reste} restants)`, 0, true);
    } else if (hors) {
      journal.ajouter(t, `${victime.j.pseudo} a succombé à la tempête (${reste} restants)`, 0, true);
    } else {
      journal.ajouter(t, `${victime.j.pseudo} est éliminé (${reste} restants)`, 0, true);
    }
    if (reste === 1 && !vainqueurAnnonce) {
      vainqueurAnnonce = true;
      const g = joueurs.find((p) => p.phase !== "mort");
      if (g) journal.ajouter(t, `Victoire de ${g.j.pseudo}`, 0, true);
      tFin = t + BR_SIM.victoireS;
    }
  }

  function pasJoueur(i: number, p: Joueur) {
    if (p.phase === "avion") {
      if (t < p.tSaut) return;
      p.phase = "libre";
      p.j.chute = "libre";
    }
    switch (p.phase) {
      case "libre": {
        const k = Math.min(1, (t - p.tSaut) / BR_SIM.chuteLibreS);
        const h = BR_SIM.partLibre * k;
        p.x = p.sx + (p.lx - p.sx) * h; p.z = p.sz + (p.lz - p.sz) * h;
        p.y = avion.altitude + (BR_SIM.altitudeFinChuteM - avion.altitude) * k;
        if (k >= 1) { p.phase = "voile"; p.j.chute = "voile"; }
        break;
      }
      case "voile": {
        const k = Math.min(1, (t - p.tSaut - BR_SIM.chuteLibreS) / BR_SIM.voileS);
        const h = BR_SIM.partLibre + (1 - BR_SIM.partLibre) * k;
        p.x = p.sx + (p.lx - p.sx) * h; p.z = p.sz + (p.lz - p.sz) * h;
        p.y = BR_SIM.altitudeFinChuteM * (1 - k);
        if (k >= 1) { p.phase = "sol"; delete p.j.chute; p.y = 0; p.x = p.lx; p.z = p.lz; pointDansZone(p); }
        break;
      }
      case "sol": {
        // l'élimination programmée approche : un tueur (le plus proche vivant au sol) se lance à la poursuite
        if (p.tueur < 0 && t >= p.tMort - BR_SIM.morts.poursuiteS && Number.isFinite(p.tMort)) {
          let best = -1, bd = Infinity;
          joueurs.forEach((o, k) => { if (o !== p && o.phase === "sol" && o.tMort > t + 1) { const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < bd) { bd = d; best = k; } } });
          p.tueur = best;
        }
        if (t >= p.tMort) { tuer(p); return; }
        const e = etatZone(plan, t * 1000);
        const dc = Math.hypot(p.x - e.centre[0], p.z - e.centre[1]);
        if (dc > e.rayon * 0.97) {
          // hors zone : droit vers le centre
          const av = marcher(p, e.centre[0], e.centre[1], p.v * 1.15);
          p.bloqueS = av ? 0 : p.bloqueS + PAS_SIM;
          return;
        }
        // le tueur fonce vers sa victime
        const mortel = joueurs.findIndex((o) => o.tueur === i && o.phase === "sol");
        if (mortel >= 0) {
          const v = joueurs[mortel];
          const av = marcher(p, v.x, v.z, p.v * BR_SIM.morts.vitesseTueur);
          p.bloqueS = av ? 0 : p.bloqueS + PAS_SIM;
          return;
        }
        if (Math.hypot(p.wx - p.x, p.wz - p.z) < 3 || p.bloqueS > 1) pointDansZone(p);
        const av = marcher(p, p.wx, p.wz, p.v);
        p.bloqueS = av ? 0 : p.bloqueS + PAS_SIM;
        break;
      }
      case "mort":
        p.mortS += PAS_SIM;
        return;
    }
    p.j.p[0] = p.x; p.j.p[1] = p.y; p.j.p[2] = p.z;
  }

  function pasUnique() {
    t += PAS_SIM;
    joueurs.forEach((p, i) => pasJoueur(i, p));
    const e = etatZone(plan, t * 1000);
    if (e.palier !== palierAnnonce && e.phase !== "fermee" && t * 1000 >= plan.debutT) {
      palierAnnonce = e.palier;
      journal.ajouter(t, `Zone ${e.palier} : ${Math.round(e.cible?.r ?? e.rayon)} m`, 0, true);
    }
    // la zone publique ne change que de palier ou de phase
    const cle = `${e.palier}${e.phase}`;
    if (cle !== cleZone) { cleZone = cle; zoneCache = zoneBrPublique(plan, t * 1000); }
    if (t >= tFin) { cycle++; demarrerCycle(); }
  }

  const sim: Simulation & { avion(): AvionBr | null } = {
    get cycle() { return cycle; },
    pas(dt) { metro.avancer(dt, pasUnique); },
    modele(s: ModeleApercu) {
      s.source = "simulation";
      s.mode = "br";
      s.joueurs.length = 0;
      for (const p of joueurs) {
        if (p.phase === "avion") continue;
        if (p.phase === "mort" && p.mortS > BR_SIM.morts.griseS) continue;
        s.joueurs.push(p.j);
      }
      s.tigres.length = 0;
      s.zone = zoneCache;
      s.avion = t < avion.finT / 1000 + BR_SIM.avionResteS ? avion : null;
      s.vivants = vivants();
      s.total = joueurs.length;
      s.tSim = t * 1000;
    },
    evenements: () => journal.vider(),
    avion: () => (t < avion.finT / 1000 + BR_SIM.avionResteS ? avion : null),
  };
  demarrerCycle();
  return sim;
}
