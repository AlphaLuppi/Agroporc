/**
 * Tigres zombies (PUR : ni horloge ni hasard global, le hasard est injecté ; aucune dépendance à `Salle`). `creerSimuZombies` simule un
 * groupe de tigres : apparition, poursuite par champ de distance sur la grille de navigation, griffe, séparation entre tigres, formes de
 * touche avec rejeu de latence (tirs et mêlée), blessures et snap compact (`encoderZombies`).
 *
 * Repère de protocole.ts : avant d'un cap = (−sin cap, −cos cap). Le temps `t` est en ms (horloge du serveur), `dt` en secondes.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« Tigre zombie »)
 */
import { resoudre, visible, type Monde } from "./collision";
import { DIST_INF, carteNavigation, champDistance, descente, type CarteNav } from "./navigation";
import { FORME_TIGRE, capVers, enrouler, pointLocal, toucheTigre } from "./monstres";
import { SILHOUETTE, encoderZombies, type SnapZombies, type Vec3, type ZombieSnap, type Zone } from "./protocole";
import { ZOMBIES, degatsGriffe, echelleZombie, pvZombie, vitesseZombie, type TypeZombie } from "./zombies-vagues";

/** Joueur vu par la simulation : id, pieds, debout (vivant). Un joueur à terre ou éliminé n'est pas une cible. */
export interface JoueurZombie { id: string; p: Vec3; vivant: boolean }

export type EvenementZombie =
  | { t: "griffeArmee"; tigre: number; joueur: string }
  | { t: "griffe"; tigre: number; joueur: string; degats: number };

/** Tigre en jeu (état lisible ; ne pas le modifier de l'extérieur). */
export interface Zombie {
  id: number;
  type: TypeZombie;
  manche: number;
  p: Vec3;
  cap: number;
  pv: number;
  pvMax: number;
  /** vitesse de marche (m/s) tirée à l'apparition */
  vitesse: number;
  echelle: number;
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
  /** historique de positions : anneau de HISTO_MAX échantillons (t, x, z, cap) */
  histo: Float64Array;
  histoN: number;
  histoTete: number;
}

export interface OptionsSimuZombies {
  monde: Monde;
  /** grille de navigation des tigres (champs ignorés) ; sinon calculée par `carteNavigation` (cases de 1,5 m, rayon 0,7) */
  carte?: CarteNav;
  /** hasard injecté, [0, 1[ */
  alea: () => number;
  /** dégâts de griffe imposés (essais : PDJ_FPS_ZOMBIES_GRIFFE) ; sinon `degatsGriffe(manche)` */
  degatsGriffe?: number;
}

export interface ResultatBlessure { mort: boolean; pvPct: number; p?: Vec3; type?: TypeZombie }
export interface TouchZombie { distance: number; zone: Zone }

const HISTO_MAX = 32;
const SEUIL_CAP_HISTO = 0.35;
const NB_BUCKETS = 1024;
const RAYON_JOUEUR = SILHOUETTE.corps.rayon;

const avant = (cap: number): [number, number] => [-Math.sin(cap), -Math.cos(cap)];

export function creerSimuZombies(opts: OptionsSimuZombies) {
  const { monde, alea } = opts;
  const charger = (): CarteNav => carteNavigation(monde, ZOMBIES.rayonNav, { taille: ZOMBIES.tailleCaseNav, ignorerPasseTigre: true });
  let carte: CarteNav = opts.carte ?? charger();
  const zombies: Zombie[] = [];
  let prochainId = 1;

  // ---- champ de distance ----
  let champ = new Int32Array(carte.nx * carte.nz).fill(DIST_INF);
  let prochainChampT = 0;
  let carteChangee = true;
  let calculsChamp = 0;
  let signature: number[] = [];
  const sourcesBuf: [number, number][] = [];
  const casesBuf: [number, number][] = [];

  // ---- séparation (grille de hachage sans allocation) ----
  const tetes = new Int32Array(NB_BUCKETS);
  const suivant = new Int32Array(ZOMBIES.plafondVivants + 8);

  const debout: JoueurZombie[] = [];
  /** dernier instant connu (ms), pour dater le drapeau d'apparition d'un snap */
  let horloge = 0;

  function caseJoueur(x: number, z: number): number {
    const i = Math.min(carte.nx - 1, Math.max(0, Math.floor((x - carte.x0) / carte.taille)));
    const j = Math.min(carte.nz - 1, Math.max(0, Math.floor((z - carte.z0) / carte.taille)));
    return i + j * carte.nx;
  }

  function majChamp(t: number): void {
    if (t < prochainChampT) return;
    let besoin = carteChangee || signature.length !== debout.length;
    if (!besoin) for (let k = 0; k < debout.length; k++) if (signature[k] !== caseJoueur(debout[k].p[0], debout[k].p[2])) { besoin = true; break; }
    if (!besoin) for (const z of zombies) if (!z.champOk) { besoin = true; break; }
    if (!besoin) return;
    sourcesBuf.length = 0;
    casesBuf.length = 0;
    signature = [];
    for (const j of debout) { sourcesBuf.push([j.p[0], j.p[2]]); signature.push(caseJoueur(j.p[0], j.p[2])); }
    for (const z of zombies) casesBuf.push([z.p[0], z.p[2]]);
    champDistance(carte, sourcesBuf, { cases: casesBuf, marge: ZOMBIES.margeChamp, sortie: champ });
    calculsChamp++;
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

  // ---- tic ----
  function tic(t: number, dt: number, joueurs: readonly JoueurZombie[]): EvenementZombie[] {
    const evenements: EvenementZombie[] = [];
    horloge = t;
    if (!(dt > 0) || !zombies.length) return evenements;
    debout.length = 0;
    for (const j of joueurs) if (j.vivant) debout.push(j);
    if (!debout.length) return evenements;
    majChamp(t);
    const rot = ZOMBIES.rotationMax * dt;

    for (const z of zombies) {
      // joueur debout le plus proche
      let cible: JoueurZombie = debout[0], dMin = Infinity;
      for (const j of debout) {
        const d = Math.hypot(j.p[0] - z.p[0], j.p[2] - z.p[2]);
        if (d < dMin) { dMin = d; cible = j; }
      }
      const surface = dMin - RAYON_JOUEUR;
      let tx = cible.p[0], tz = cible.p[2];
      let marche = true;

      if (z.armeFin > 0) {
        marche = false;
        if (t >= z.armeFin) {
          const vise = z.cibleGriffe !== null ? debout.find((j) => j.id === z.cibleGriffe) : undefined;
          if (vise && Math.hypot(vise.p[0] - z.p[0], vise.p[2] - z.p[2]) - RAYON_JOUEUR <= ZOMBIES.griffeMaxPortee) {
            evenements.push({ t: "griffe", tigre: z.id, joueur: vise.id, degats: opts.degatsGriffe ?? degatsGriffe(z.manche) });
          }
          z.armeFin = 0;
          z.cibleGriffe = null;
          z.prochaineGriffeT = t + ZOMBIES.griffeRechargeS * 1000;
        }
      } else if (surface <= ZOMBIES.griffePortee && visible(monde, [z.p[0], 1, z.p[2]], [cible.p[0], 1, cible.p[2]])) {
        marche = false;
        if (t >= z.prochaineGriffeT && t - z.apparuT >= ZOMBIES.apparitionMs) {
          z.armeFin = t + ZOMBIES.griffeArmeS * 1000;
          z.cibleGriffe = cible.id;
          evenements.push({ t: "griffeArmee", tigre: z.id, joueur: cible.id });
        }
      } else {
        // vision directe (contrôlée toutes les 150 ms, plus tôt si le joueur le plus proche change) ou descente du champ
        let direct = false;
        if (dMin <= ZOMBIES.visionDirecteM) {
          if (z.vuJoueur !== cible.id || t - z.vuT >= ZOMBIES.periodeVisionMs) {
            z.vuJoueur = cible.id;
            z.vuT = t;
            z.voit = visible(monde, [z.p[0], 1, z.p[2]], [cible.p[0], 1, cible.p[2]]);
          }
          direct = z.voit;
        } else z.voit = false;
        if (!direct) {
          const pas = descente(carte, champ, z.p[0], z.p[2], 2);
          if (pas) { tx = pas[0]; tz = pas[1]; }
        }
      }

      // cap : vers la destination (rotation bornée), tout de suite à l'apparition
      const voulu = capVers(z.p[0], z.p[2], tx, tz);
      let ecart = enrouler(voulu - z.cap);
      if (z.neuf) { z.cap = voulu; ecart = 0; z.neuf = false; z.histoN = 0; z.histoTete = 0; } // la pose d'apparition (cap fictif) n'est pas rejouée
      else z.cap = enrouler(z.cap + Math.max(-rot, Math.min(rot, ecart)));

      if (marche) {
        const v = z.vitesse * Math.max(0.25, Math.cos(ecart));
        const [fx, fz] = avant(z.cap);
        const r = resoudre(monde, [z.p[0] + fx * v * dt, 0, z.p[2] + fz * v * dt], ZOMBIES.rayonTigre, ZOMBIES.hauteurTigre, true);
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
        const r = resoudre(monde, [z.p[0], 0, z.p[2]], ZOMBIES.rayonTigre, ZOMBIES.hauteurTigre, true);
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
    if (z.pv > 0) return { mort: false, pvPct: pvPct(z) };
    zombies.splice(k, 1);
    return { mort: true, pvPct: 0, p: [z.p[0], 0, z.p[2]], type: z.type };
  }

  return {
    /** Fait apparaître un tigre en (x, z) ; renvoie son id, ou null au plafond de 24 tigres vivants. */
    apparaitre(type: TypeZombie, point: readonly [number, number], manche: number, t: number, cap = 0): number | null {
      if (zombies.length >= ZOMBIES.plafondVivants) return null;
      horloge = Math.max(horloge, t);
      const pv = pvZombie(manche, type);
      const z: Zombie = {
        id: prochainId++, type, manche, p: [point[0], 0, point[1]], cap, pv, pvMax: pv, vitesse: vitesseZombie(manche, type, alea()),
        echelle: echelleZombie(type), apparuT: t, armeFin: 0, cibleGriffe: null, prochaineGriffeT: 0, vuT: t - (prochainId * 37) % ZOMBIES.periodeVisionMs,
        vuJoueur: null, voit: false, champOk: false, neuf: true, histo: new Float64Array(HISTO_MAX * 4), histoN: 0, histoTete: 0,
      };
      zombies.push(z);
      noterHisto(z, t);
      return z.id;
    },
    tic,
    toucheZombie,
    toucheMelee,
    blesser,
    /** Retire un tigre sans le tuer (fin de partie, essais). */
    retirer(id: number): boolean {
      const k = zombies.findIndex((z) => z.id === id);
      if (k < 0) return false;
      zombies.splice(k, 1);
      return true;
    },
    /** Tigres vivants (lecture seule). */
    liste(): readonly Zombie[] { return zombies; },
    zombie(id: number): Zombie | undefined { return chercher(id); },
    nbVivants(): number { return zombies.length; },
    /** Snap compact : `{ r, z }` avec `z` plat de stride 6 (`encoderZombies`) ; `restants` = tigres à tuer, pas encore apparus compris. */
    snap(restants = zombies.length, t = horloge): SnapZombies {
      const liste: ZombieSnap[] = zombies.map((z) => ({
        id: z.id, x: z.p[0], z: z.p[2], cap: z.cap, type: z.type, griffe: z.armeFin > 0, apparition: t - z.apparuT < ZOMBIES.apparitionMs, pvPct: pvPct(z),
      }));
      return encoderZombies(restants, liste);
    },
    /** Après une porte ouverte : le monde a changé (appeler `invaliderNavigation(monde)` avant), la grille et le champ sont recalculés. */
    rafraichirCarte(): void {
      carte = charger();
      champ = new Int32Array(carte.nx * carte.nz).fill(DIST_INF);
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
      champ.fill(DIST_INF);
      signature = [];
      carteChangee = true;
      prochainChampT = 0;
    },
  };
}

export type SimuZombies = ReturnType<typeof creerSimuZombies>;
