/**
 * Tigres zombies (PUR : ni horloge ni hasard global, le hasard est injecté ; aucune dépendance à `Salle`). `creerSimuZombies` simule un
 * groupe de tigres façon Black Ops 1 : sortie du sol (dans une cour), approche d'une fenêtre puis arrachage des planches et saut, chasse par
 * champ de distance sur la grille de navigation (les fenêtres y sont des murs : un tigre entré ne ressort pas), griffe à travers les fenêtres,
 * séparation entre tigres, tigres bloqués signalés (le service les fait réapparaître), formes de touche avec rejeu de latence (tirs et mêlée),
 * blessures et snap compact (`encoderZombies`). Les petits du Truck Muche franchissent les fenêtres d'un bond (leur propre grille).
 *
 * Repère de protocole.ts : avant d'un cap = (−sin cap, −cos cap). Le temps `t` est en ms (horloge du serveur), `dt` en secondes.
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (« Barricades à planches », « Équilibrage »)
 */
import { resoudre, visible, type Monde } from "./collision";
import { DIST_INF, carteNavigation, champDistance, descente, type CarteNav } from "./navigation";
import { FORME_TIGRE, capVers, enrouler, pointLocal, toucheTigre } from "./monstres";
import { SILHOUETTE, encoderZombies, type ModeZombie, type SnapZombies, type Vec3, type ZombieSnap, type Zone } from "./protocole";
import type { Fenetre } from "./zombies-carte";
import { ZOMBIES, echelleZombie, type Allure, type TypeZombie } from "./zombies-vagues";

/** Joueur vu par la simulation : id, pieds, debout (vivant). Un joueur à terre ou éliminé n'est pas une cible. */
export interface JoueurZombie { id: string; p: Vec3; vivant: boolean }
/**
 * (v8) Leurre : un tigre à remontoir posé (la Monkey Bomb de BO1). Tout tigre à moins de `rayon` m le préfère aux joueurs : il y court (le
 * champ de distance part des leurres tant qu'il y en a), ne griffe plus personne et l'entoure, jusqu'à ce que le service le retire.
 */
export interface Leurre { id: number; p: Vec3; rayon: number }
/** Distance (m) à laquelle un tigre attiré s'arrête autour du leurre. */
export const DISTANCE_LEURRE_M = 1.6;

export type EvenementZombie =
  | { t: "griffeArmee"; tigre: number; joueur: string }
  | { t: "griffe"; tigre: number; joueur: string; degats: number }
  /** une planche de la fenêtre `fenetre` vient d'être arrachée */
  | { t: "planche"; tigre: number; fenetre: string }
  /** le tigre saute par la fenêtre */
  | { t: "saut"; tigre: number; fenetre: string }
  /** le tigre n'a pas approché un joueur depuis longtemps (coincé) : le service le retire et le remet dans la file */
  | { t: "bloque"; tigre: number };

/** Barricades vues par la simulation : planches restantes, arrachage d'une planche (le service tient l'état). */
export interface Barricades { planches(fenetre: string): number; arracher(fenetre: string): void }

/** Tigre en jeu (état lisible ; ne pas le modifier de l'extérieur). */
export interface Zombie {
  id: number;
  type: TypeZombie;
  manche: number;
  p: Vec3;
  cap: number;
  pv: number;
  pvMax: number;
  allure: Allure;
  /** vitesse (m/s) de l'allure, tirée à l'apparition */
  vitesse: number;
  echelle: number;
  degats: number;
  rechargeGriffeS: number;
  mode: ModeZombie;
  /** début (ms) du mode courant */
  modeT: number;
  /** fenêtre visée (approche, arrachage, saut) */
  fenetre: Fenetre | null;
  /** prochain arrachage de planche (ms) */
  arracheT: number;
  /** horodatage (ms) de l'apparition */
  apparuT: number;
  /** fin (ms) de l'armement de la griffe, 0 si elle n'est pas armée */
  armeFin: number;
  cibleGriffe: string | null;
  prochaineGriffeT: number;
  /** vision directe : dernier contrôle (ms), joueur contrôlé, résultat */
  vuT: number;
  vuJoueur: string | null;
  voit: boolean;
  /** le champ de distance couvre sa case */
  champOk: boolean;
  neuf: boolean;
  /** distance au joueur le plus proche la plus courte depuis `progresT` (failsafe de BO1) */
  meilleureDistance: number;
  progresT: number;
  /** historique de positions : anneau de HISTO_MAX échantillons (t, x, z, cap) */
  histo: Float64Array;
  histoN: number;
  histoTete: number;
}

/** Caractéristiques d'un tigre qui apparaît (calculées par le service : `zombies-vagues.ts`). */
export interface SpecZombie {
  type: TypeZombie;
  manche: number;
  pv: number;
  allure: Allure;
  vitesse: number;
  degats: number;
  rechargeGriffeS: number;
}
/** Comment il arrive : sortie du sol, par une fenêtre (approche depuis l'extérieur), ou déjà en chasse (petit lâché par le Truck). */
export type ArriveeZombie = { mode: "sol" } | { mode: "fenetre"; fenetre: Fenetre } | { mode: "chasse" };

export interface OptionsSimuZombies {
  monde: Monde;
  /** hasard injecté, [0, 1[ */
  alea: () => number;
  /** barricades (planches) ; sans elles, aucune fenêtre n'est barricadée */
  barricades?: Barricades;
}

export interface ResultatBlessure { mort: boolean; pvPct: number; p?: Vec3; type?: TypeZombie }
export interface TouchZombie { distance: number; zone: Zone }

const HISTO_MAX = 32;
const SEUIL_CAP_HISTO = 0.35;
const NB_BUCKETS = 1024;
const RAYON_JOUEUR = SILHOUETTE.corps.rayon;
/** failsafe : un tigre en chasse qui ne s'est pas rapproché de 2 m en 30 s, à plus de 25 m de tout joueur, est signalé bloqué */
const FAILSAFE_MS = 30_000;
const FAILSAFE_DISTANCE_M = 25;
/** marge (m) de progrès qui remet à zéro le délai du failsafe */
const FAILSAFE_PROGRES_M = 2;

const avant = (cap: number): [number, number] => [-Math.sin(cap), -Math.cos(cap)];

/** Portée (m, depuis le centre du tigre) du bout du balayage de la patte, rayon de contact compris. */
export function porteePatte(echelle: number, allonge = 0): number {
  return ZOMBIES.griffePatteA[1] * echelle + allonge + ZOMBIES.griffeRayonM + ZOMBIES.griffeRayonPatte * echelle;
}

/**
 * Contact de la patte (PUR) : le balayage de la patte est le segment de l'axe du tigre (cap `cap`, avant = (−sin, −cos)) de
 * `griffePatteA[0]` à `griffePatteA[1]` × échelle (+ `allonge` à la fenêtre) ; vrai si le joueur (pieds en `p`) en est à moins de
 * `griffeRayonM` + `griffeRayonPatte` × échelle. Un joueur qui a reculé hors de portée ou s'est écarté de l'axe est esquivé.
 */
export function touchePatte(z: { p: Vec3; cap: number; echelle: number }, p: Vec3, allonge = 0): boolean {
  const [fx, fz] = avant(z.cap);
  const dx = p[0] - z.p[0], dz = p[2] - z.p[2];
  const a0 = ZOMBIES.griffePatteA[0] * z.echelle, a1 = ZOMBIES.griffePatteA[1] * z.echelle + allonge;
  const s = Math.max(a0, Math.min(a1, dx * fx + dz * fz));
  return Math.hypot(dx - fx * s, dz - fz * s) <= ZOMBIES.griffeRayonM + ZOMBIES.griffeRayonPatte * z.echelle;
}

export function creerSimuZombies(opts: OptionsSimuZombies) {
  const { monde, alea } = opts;
  const barricades: Barricades = opts.barricades ?? { planches: () => 0, arracher: () => {} };
  /** grille des tigres en chasse : les fenêtres sont des murs (un tigre entré ne ressort pas) */
  const chargerChasse = (): CarteNav => carteNavigation(monde, ZOMBIES.rayonNav, { taille: ZOMBIES.tailleCaseNav, ignorerPasseTigre: false });
  /** grille des petits : ils franchissent les fenêtres */
  const chargerLibre = (): CarteNav => carteNavigation(monde, ZOMBIES.rayonNav, { taille: ZOMBIES.tailleCaseNav, ignorerPasseTigre: true });
  let cartes: [CarteNav, CarteNav] = [chargerChasse(), chargerLibre()];
  const zombies: Zombie[] = [];
  let prochainId = 1;

  // ---- champs de distance (un par grille) ----
  const champs: [Int32Array, Int32Array] = [new Int32Array(cartes[0].nx * cartes[0].nz).fill(DIST_INF), new Int32Array(cartes[1].nx * cartes[1].nz).fill(DIST_INF)];
  let prochainChampT = 0;
  let carteChangee = true;
  let calculsChamp = 0;
  let signature: number[] = [];
  /** leurres du tic en cours et signature de ceux qui ont servi au dernier champ */
  let leurresActifs: readonly Leurre[] = [];
  let signatureLeurres = "";
  const sourcesBuf: [number, number][] = [];
  const casesBuf: [number, number][] = [];

  // ---- séparation (grille de hachage sans allocation) ----
  const tetes = new Int32Array(NB_BUCKETS);
  const suivant = new Int32Array(ZOMBIES.plafondVivants + 16);

  const debout: JoueurZombie[] = [];
  /** dernier instant connu (ms), pour dater le drapeau d'apparition d'un snap */
  let horloge = 0;

  const grilleDe = (z: Zombie): 0 | 1 => (z.type === 3 ? 1 : 0);
  /** les petits et les tigres qui sautent ignorent les fenêtres */
  const ignoreFenetres = (z: Zombie): boolean => z.type === 3 || z.mode === "saut";

  function caseJoueur(x: number, z: number): number {
    const c = cartes[0];
    const i = Math.min(c.nx - 1, Math.max(0, Math.floor((x - c.x0) / c.taille)));
    const j = Math.min(c.nz - 1, Math.max(0, Math.floor((z - c.z0) / c.taille)));
    return i + j * c.nx;
  }

  function majChamps(t: number): void {
    if (t < prochainChampT) return;
    // tant qu'un leurre est posé, le champ part des leurres (les tigres attirés y courent) au lieu des joueurs
    const sigLeurres = leurresActifs.map((l) => `${l.id}:${caseJoueur(l.p[0], l.p[2])}`).join(",");
    let besoin = carteChangee || sigLeurres !== signatureLeurres || (!leurresActifs.length && signature.length !== debout.length);
    if (!besoin && !leurresActifs.length) for (let k = 0; k < debout.length; k++) if (signature[k] !== caseJoueur(debout[k].p[0], debout[k].p[2])) { besoin = true; break; }
    if (!besoin) for (const z of zombies) if (!z.champOk && z.mode === "chasse") { besoin = true; break; }
    if (!besoin) return;
    sourcesBuf.length = 0;
    signature = [];
    signatureLeurres = sigLeurres;
    if (leurresActifs.length) for (const l of leurresActifs) sourcesBuf.push([l.p[0], l.p[2]]);
    else for (const j of debout) { sourcesBuf.push([j.p[0], j.p[2]]); signature.push(caseJoueur(j.p[0], j.p[2])); }
    for (const g of [0, 1] as const) {
      casesBuf.length = 0;
      for (const z of zombies) if (grilleDe(z) === g && z.mode === "chasse") casesBuf.push([z.p[0], z.p[2]]);
      // la grille des petits n'est calculée que s'il y en a
      if (g === 1 && !casesBuf.length) continue;
      champDistance(cartes[g], sourcesBuf, { cases: casesBuf, marge: ZOMBIES.margeChamp, sortie: champs[g] });
      calculsChamp++;
    }
    for (const z of zombies) z.champOk = true;
    prochainChampT = t + ZOMBIES.periodeChampMs;
    carteChangee = false;
  }

  // ---- historique ----
  function noterHisto(z: Zombie, t: number): void {
    const h = z.histo;
    if (z.histoN > 0) {
      const b = ((z.histoTete - 1 + HISTO_MAX) % HISTO_MAX) * 4;
      if (Math.hypot(z.p[0] - h[b + 1], z.p[2] - h[b + 2]) < ZOMBIES.dedoublonnageM && Math.abs(enrouler(z.cap - h[b + 3])) < SEUIL_CAP_HISTO) return;
    }
    const b = z.histoTete * 4;
    h[b] = t; h[b + 1] = z.p[0]; h[b + 2] = z.p[2]; h[b + 3] = z.cap;
    z.histoTete = (z.histoTete + 1) % HISTO_MAX;
    if (z.histoN < HISTO_MAX) z.histoN++;
  }

  /**
   * Poses à tester pour un rejeu de `fenetreMs` avant `t` : la pose courante puis les échantillons de la fenêtre, du plus récent au
   * plus ancien (jusqu'au premier antérieur à la fenêtre, qui y était encore valable), sans doublon à `dedoublonnageM` près.
   */
  function poses(z: Zombie, t: number, fenetreMs: number): [number, number, number][] {
    const res: [number, number, number][] = [[z.p[0], z.p[2], z.cap]];
    const debut = t - fenetreMs;
    for (let k = 1; k <= z.histoN; k++) {
      const b = ((z.histoTete - k + HISTO_MAX) % HISTO_MAX) * 4;
      const x = z.histo[b + 1], zz = z.histo[b + 2], cap = z.histo[b + 3];
      if (!res.some((r) => Math.hypot(r[0] - x, r[1] - zz) < ZOMBIES.dedoublonnageM && Math.abs(enrouler(r[2] - cap)) < SEUIL_CAP_HISTO)) res.push([x, zz, cap]);
      if (z.histo[b] <= debut) break;
    }
    return res;
  }

  function chercher(id: number): Zombie | undefined {
    for (const z of zombies) if (z.id === id) return z;
    return undefined;
  }

  const pvPct = (z: Zombie): number => (z.pv <= 0 ? 0 : Math.max(1, Math.round((100 * z.pv) / z.pvMax)));

  function changerMode(z: Zombie, mode: ModeZombie, t: number): void {
    z.mode = mode;
    z.modeT = t;
    if (mode === "chasse") { z.champOk = false; z.progresT = t; z.meilleureDistance = Infinity; }
  }

  /**
   * Coup de patte (armement visible puis frappe) sur le joueur debout le plus proche s'il est à portée de patte et visible ; vrai si le
   * tigre est occupé à griffer. Le coup ne touche qu'au contact : à `armeFin`, le joueur visé doit être sur le balayage de la patte.
   */
  function griffer(z: Zombie, t: number, cible: JoueurZombie, evenements: EvenementZombie[], allonge = 0): boolean {
    if (z.armeFin > 0) {
      if (t >= z.armeFin) {
        const vise = z.cibleGriffe !== null ? debout.find((j) => j.id === z.cibleGriffe) : undefined;
        if (vise && touchePatte(z, vise.p, allonge) && visible(monde, [z.p[0], 1, z.p[2]], [vise.p[0], 1, vise.p[2]])) {
          evenements.push({ t: "griffe", tigre: z.id, joueur: vise.id, degats: z.degats });
        }
        z.armeFin = 0;
        z.cibleGriffe = null;
        z.prochaineGriffeT = t + z.rechargeGriffeS * 1000;
      }
      return true;
    }
    const d = Math.hypot(cible.p[0] - z.p[0], cible.p[2] - z.p[2]);
    if (d <= porteePatte(z.echelle, allonge) - ZOMBIES.griffeMargeDepartM && visible(monde, [z.p[0], 1, z.p[2]], [cible.p[0], 1, cible.p[2]])) {
      if (t >= z.prochaineGriffeT && t - z.apparuT >= ZOMBIES.apparitionMs) {
        z.armeFin = t + ZOMBIES.griffeArmeS * 1000;
        z.cibleGriffe = cible.id;
        evenements.push({ t: "griffeArmee", tigre: z.id, joueur: cible.id });
      }
      return true;
    }
    return false;
  }

  // ---- tic ----
  function tic(t: number, dt: number, joueurs: readonly JoueurZombie[], leurres: readonly Leurre[] = []): EvenementZombie[] {
    const evenements: EvenementZombie[] = [];
    horloge = t;
    leurresActifs = leurres;
    if (!(dt > 0) || !zombies.length) return evenements;
    debout.length = 0;
    for (const j of joueurs) if (j.vivant) debout.push(j);
    if (!debout.length) return evenements;
    majChamps(t);
    const rot = ZOMBIES.rotationMax * dt;

    for (const z of zombies) {
      // joueur debout le plus proche
      let cible: JoueurZombie = debout[0], dMin = Infinity;
      for (const j of debout) {
        const d = Math.hypot(j.p[0] - z.p[0], j.p[2] - z.p[2]);
        if (d < dMin) { dMin = d; cible = j; }
      }
      // (v8) un leurre à portée passe avant les joueurs
      let leurre: Leurre | null = null, dLeurre = Infinity;
      for (const l of leurres) {
        const d = Math.hypot(l.p[0] - z.p[0], l.p[2] - z.p[2]);
        if (d <= l.rayon && d < dLeurre) { dLeurre = d; leurre = l; }
      }
      let tx = cible.p[0], tz = cible.p[2];
      let marche = true;

      switch (z.mode) {
        case "sol":
          // il émerge : immobile, puis chasse
          marche = false;
          if (t - z.modeT >= ZOMBIES.sortieSolMs) changerMode(z, "chasse", t);
          break;
        case "approche": {
          const f = z.fenetre!;
          tx = f.dehors[0]; tz = f.dehors[1];
          if (Math.hypot(f.dehors[0] - z.p[0], f.dehors[1] - z.p[2]) <= ZOMBIES.fenetreArriveeM) {
            changerMode(z, "fenetre", t);
            z.arracheT = t + ZOMBIES.arrachageS[z.allure] * 1000;
          }
          break;
        }
        case "fenetre": {
          const f = z.fenetre!;
          marche = false;
          tx = f.dedans[0]; tz = f.dedans[1];
          // une griffe à travers la fenêtre si un joueur est collé de l'autre côté ; sinon il arrache
          if (leurre && z.armeFin > 0) { z.armeFin = 0; z.cibleGriffe = null; }
          if (!leurre && griffer(z, t, cible, evenements, ZOMBIES.allongeFenetreM)) break;
          if (barricades.planches(f.id) <= 0) {
            changerMode(z, "saut", t);
            evenements.push({ t: "saut", tigre: z.id, fenetre: f.id });
          } else if (t >= z.arracheT) {
            barricades.arracher(f.id);
            evenements.push({ t: "planche", tigre: z.id, fenetre: f.id });
            z.arracheT = t + ZOMBIES.arrachageS[z.allure] * 1000;
          }
          break;
        }
        case "saut": {
          const f = z.fenetre!;
          marche = false;
          const k = Math.min(1, (t - z.modeT) / ZOMBIES.sautFenetreMs);
          z.p[0] = f.dehors[0] + (f.dedans[0] - f.dehors[0]) * k;
          z.p[2] = f.dehors[1] + (f.dedans[1] - f.dehors[1]) * k;
          tx = f.dedans[0] + f.normale[0]; tz = f.dedans[1] + f.normale[1];
          if (k >= 1) { changerMode(z, "chasse", t); z.fenetre = null; }
          break;
        }
        case "chasse": {
          // attiré par un leurre : il y court, ne griffe personne et s'arrête autour (BO1 : les zombies dansent autour du singe)
          const vise = leurre ? leurre.p : cible.p;
          const idVise = leurre ? `leurre:${leurre.id}` : cible.id;
          const dVise = leurre ? dLeurre : dMin;
          if (leurre) {
            tx = vise[0]; tz = vise[2];
            if (z.armeFin > 0) { z.armeFin = 0; z.cibleGriffe = null; }
            if (dLeurre <= DISTANCE_LEURRE_M) { marche = false; z.progresT = t; z.meilleureDistance = dLeurre; break; }
          } else if (griffer(z, t, cible, evenements)) { marche = false; break; }
          // vision directe (contrôlée toutes les 150 ms, plus tôt si le joueur le plus proche change) ou descente du champ
          let direct = false;
          if (dVise <= ZOMBIES.visionDirecteM) {
            if (z.vuJoueur !== idVise || t - z.vuT >= ZOMBIES.periodeVisionMs) {
              z.vuJoueur = idVise;
              z.vuT = t;
              z.voit = visible(monde, [z.p[0], 1, z.p[2]], [vise[0], 1, vise[2]]);
            }
            direct = z.voit;
          } else z.voit = false;
          if (!direct) {
            const g = grilleDe(z);
            const pas = descente(cartes[g], champs[g], z.p[0], z.p[2], 2);
            if (pas) { tx = pas[0]; tz = pas[1]; }
          }
          // failsafe (BO1 `zombie_use_failsafe`) : un tigre qui ne se rapproche plus, loin de tout joueur
          if (dVise < z.meilleureDistance - FAILSAFE_PROGRES_M || dVise < FAILSAFE_DISTANCE_M) { z.meilleureDistance = Math.min(z.meilleureDistance, dVise); z.progresT = t; }
          else if (t - z.progresT >= FAILSAFE_MS) { evenements.push({ t: "bloque", tigre: z.id }); z.progresT = t; }
          break;
        }
      }

      // cap : vers la destination (rotation bornée), tout de suite à l'apparition
      const voulu = capVers(z.p[0], z.p[2], tx, tz);
      let ecart = enrouler(voulu - z.cap);
      if (z.neuf) { z.cap = voulu; ecart = 0; z.neuf = false; z.histoN = 0; z.histoTete = 0; } // la pose d'apparition (cap fictif) n'est pas rejouée
      else {
        // pendant l'armement d'un coup de patte, le tigre suit sa cible lentement : on peut le contourner
        const r = z.armeFin > 0 ? ZOMBIES.griffeRotationMax * dt : rot;
        z.cap = enrouler(z.cap + Math.max(-r, Math.min(r, ecart)));
      }

      if (marche) {
        const v = z.vitesse * Math.max(0.25, Math.cos(ecart));
        const [fx, fz] = avant(z.cap);
        const r = resoudre(monde, [z.p[0] + fx * v * dt, 0, z.p[2] + fz * v * dt], ZOMBIES.rayonTigre, ZOMBIES.hauteurTigre, ignoreFenetres(z));
        z.p[0] = r.p[0]; z.p[2] = r.p[2];
      }
    }

    separer();
    for (const z of zombies) noterHisto(z, t);
    return evenements;
  }

  /** Écarte les tigres qui se chevauchent (< 1,4 m), par grille de hachage ; un tigre poussé est de nouveau recalé sur les murs. */
  function separer(): void {
    const n = zombies.length;
    if (n < 2) return;
    if (suivant.length < n) throw new Error("trop de tigres pour la grille de séparation");
    tetes.fill(-1);
    const L = ZOMBIES.separationM;
    const clef = (i: number, j: number) => (((i * 73856093) ^ (j * 19349663)) >>> 0) & (NB_BUCKETS - 1);
    for (let k = 0; k < n; k++) {
      const z = zombies[k];
      const h = clef(Math.floor(z.p[0] / L), Math.floor(z.p[2] / L));
      suivant[k] = tetes[h];
      tetes[h] = k;
    }
    let touche = false;
    for (let k = 0; k < n; k++) {
      const a = zombies[k];
      const ci = Math.floor(a.p[0] / L), cj = Math.floor(a.p[2] / L);
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (let m = tetes[clef(ci + di, cj + dj)]; m >= 0; m = suivant[m]) {
            if (m <= k) continue;
            const b = zombies[m];
            // un tigre qui saut ou qui émerge ne pousse ni n'est poussé
            if (a.mode === "saut" || b.mode === "saut" || a.mode === "sol" || b.mode === "sol") continue;
            let dx = b.p[0] - a.p[0], dz = b.p[2] - a.p[2];
            const d2 = dx * dx + dz * dz;
            if (d2 >= L * L) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-6) { dx = Math.cos(k); dz = Math.sin(k); d = 1; }
            const pousse = (L - Math.sqrt(d2)) / 2;
            const ux = dx / d, uz = dz / d;
            a.p[0] -= ux * pousse; a.p[2] -= uz * pousse;
            b.p[0] += ux * pousse; b.p[2] += uz * pousse;
            touche = true;
          }
        }
      }
    }
    if (touche) {
      for (const z of zombies) {
        if (z.mode === "saut") continue;
        const r = resoudre(monde, [z.p[0], 0, z.p[2]], ZOMBIES.rayonTigre, ZOMBIES.hauteurTigre, ignoreFenetres(z));
        z.p[0] = r.p[0]; z.p[2] = r.p[2];
      }
    }
  }

  // ---- touches ----
  function toucheZombie(id: number, o: Vec3, d: Vec3, portee: number, t: number): TouchZombie | null {
    const z = chercher(id);
    if (!z) return null;
    let meilleur: TouchZombie | null = null;
    for (const [x, zz, cap] of poses(z, t, ZOMBIES.rejeuMs)) {
      const h = toucheTigre(o, d, portee, [x, 0, zz], cap, z.echelle, monde, ZOMBIES.margeTouche);
      if (h && (!meilleur || h.distance < meilleur.distance)) meilleur = h;
    }
    return meilleur;
  }

  function toucheMelee(id: number, o: Vec3, d: Vec3, portee: number, cosCone: number, t: number): { distance: number } | null {
    const z = chercher(id);
    if (!z) return null;
    const angleCone = Math.acos(Math.max(-1, Math.min(1, cosCone)));
    let meilleur: { distance: number } | null = null;
    for (const [x, zz, cap] of poses(z, t, ZOMBIES.rejeuMeleeMs)) {
      for (const s of FORME_TIGRE) {
        const c = pointLocal([x, 0, zz], cap, z.echelle, s.d, s.h, s.a);
        const r = s.r * z.echelle;
        const vx = c[0] - o[0], vy = c[1] - o[1], vz = c[2] - o[2];
        const l = Math.hypot(vx, vy, vz);
        const distance = Math.max(0, l - r);
        if (distance > portee || (meilleur && distance >= meilleur.distance)) continue;
        if (l > r) {
          const cos = Math.max(-1, Math.min(1, (vx * d[0] + vy * d[1] + vz * d[2]) / l));
          if (Math.acos(cos) > angleCone + Math.asin(Math.min(1, r / l))) continue;
          // ligne de vue jusqu'au point de la sphère le plus proche de l'œil
          const k = (l - r) / l;
          if (!visible(monde, o, [o[0] + vx * k, o[1] + vy * k, o[2] + vz * k])) continue;
        }
        meilleur = { distance };
      }
    }
    return meilleur;
  }

  function blesser(id: number, degats: number, _t: number): ResultatBlessure {
    const k = zombies.findIndex((z) => z.id === id);
    if (k < 0) return { mort: false, pvPct: 0 };
    const z = zombies[k];
    z.pv = Math.max(0, z.pv - Math.max(0, degats));
    if (z.pv > 0) return { mort: false, pvPct: pvPct(z), type: z.type };
    zombies.splice(k, 1);
    return { mort: true, pvPct: 0, p: [z.p[0], 0, z.p[2]], type: z.type };
  }

  return {
    /**
     * Fait apparaître un tigre en (x, z) selon `arrivee` (du sol, vers une fenêtre, ou déjà en chasse) ; renvoie son id, ou null au
     * plafond de 24 tigres vivants.
     */
    apparaitre(spec: SpecZombie, point: readonly [number, number], arrivee: ArriveeZombie, t: number, cap = 0): number | null {
      if (zombies.length >= ZOMBIES.plafondVivants) return null;
      horloge = Math.max(horloge, t);
      const z: Zombie = {
        id: prochainId++, type: spec.type, manche: spec.manche, p: [point[0], 0, point[1]], cap, pv: spec.pv, pvMax: spec.pv,
        allure: spec.allure, vitesse: spec.vitesse, echelle: echelleZombie(spec.type), degats: spec.degats, rechargeGriffeS: spec.rechargeGriffeS,
        mode: arrivee.mode === "fenetre" ? "approche" : arrivee.mode, modeT: t, fenetre: arrivee.mode === "fenetre" ? arrivee.fenetre : null, arracheT: 0,
        apparuT: t, armeFin: 0, cibleGriffe: null, prochaineGriffeT: 0, vuT: t - (prochainId * 37) % ZOMBIES.periodeVisionMs,
        vuJoueur: null, voit: false, champOk: false, neuf: true, meilleureDistance: Infinity, progresT: t,
        histo: new Float64Array(HISTO_MAX * 4), histoN: 0, histoTete: 0,
      };
      zombies.push(z);
      noterHisto(z, t);
      return z.id;
    },
    tic,
    toucheZombie,
    toucheMelee,
    blesser,
    /** Retire un tigre sans le tuer (fin de partie, tigre bloqué, essais). */
    retirer(id: number): boolean {
      const k = zombies.findIndex((z) => z.id === id);
      if (k < 0) return false;
      zombies.splice(k, 1);
      return true;
    },
    /** Change l'allure d'un tigre (dernier tigre qui sprinte, rampant après une explosion). */
    changerAllure(id: number, allure: Allure, vitesse: number): void {
      const z = chercher(id);
      if (!z) return;
      z.allure = allure;
      z.vitesse = vitesse;
    },
    /** Tigres vivants (lecture seule). */
    liste(): readonly Zombie[] { return zombies; },
    zombie(id: number): Zombie | undefined { return chercher(id); },
    nbVivants(): number { return zombies.length; },
    /** Snap compact : `{ r, z }` avec `z` plat de stride 6 (`encoderZombies`) ; `restants` = tigres à tuer, pas encore apparus compris. */
    snap(restants = zombies.length, t = horloge, truck?: SnapZombies["t"]): SnapZombies {
      const liste: ZombieSnap[] = zombies.map((z) => ({
        id: z.id, x: z.p[0], z: z.p[2], cap: z.cap, type: z.type, griffe: z.armeFin > 0, apparition: t - z.apparuT < ZOMBIES.apparitionMs,
        pvPct: pvPct(z), allure: z.allure, mode: z.mode === "approche" ? "fenetre" : z.mode,
      }));
      return encoderZombies(restants, liste, truck);
    },
    /** Après une porte ouverte : le monde a changé (appeler `invaliderNavigation(monde)` avant), les grilles et les champs sont recalculés. */
    rafraichirCarte(): void {
      cartes = [chargerChasse(), chargerLibre()];
      champs[0] = new Int32Array(cartes[0].nx * cartes[0].nz).fill(DIST_INF);
      champs[1] = new Int32Array(cartes[1].nx * cartes[1].nz).fill(DIST_INF);
      carteChangee = true;
      prochainChampT = 0;
      for (const z of zombies) z.champOk = false;
    },
    /** Compteurs d'essai : nombre de champs de distance calculés depuis la création. */
    diagnostic(): { calculsChamp: number } { return { calculsChamp }; },
    /** Nouvelle partie : plus aucun tigre, numérotation repartie de 1. */
    reinitialiser(): void {
      zombies.length = 0;
      prochainId = 1;
      champs[0].fill(DIST_INF);
      champs[1].fill(DIST_INF);
      signature = [];
      carteChangee = true;
      prochainChampT = 0;
    },
  };
}

export type SimuZombies = ReturnType<typeof creerSimuZombies>;
