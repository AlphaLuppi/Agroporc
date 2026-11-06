/**
 * Rocket Muche : le match. Monde complet (voitures des deux équipes, balle, plots), phases (décompte, jeu, but, fin), chrono,
 * prolongation, démolitions et réapparitions, statistiques et points façon Rocket League.
 *
 * PUR et déterministe : aucune horloge ni `Math.random` (le hasard vient du `Rng` du monde, consommé dans un ordre fixe), aucun DOM.
 * Même graine + mêmes entrées = même partie, à l'identique (`empreinteMonde` sert à le vérifier).
 *
 * Contrat : `creerMonde`, `pasMonde`, `resultatMatch`, `preparerCoupDEnvoi` (types `CreerMonde`, `PasMonde`, `ResultatCourant`,
 * `PreparerCoupDEnvoi` de `contrat.ts`). Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md (§ 6).
 */
import {
  BALLE, BUT, COUPS_D_ENVOI, ENTREES_NULLES, GRAVITE, MATCH, PAS_S, PLOT, PLOTS, STADE, VOITURE, adversaire, joueursParEquipe, signeButDefendu, tirer,
  creerRng,
} from "./contrat";
import type {
  Arene, ConfigMatch, CreerMonde, Equipe, EtatBalle, EtatPlot, EtatVoiture, EvenementMatch, LigneClassement, MondeRocket, PasMonde,
  PreparerCoupDEnvoi, ResultatCourant, ResultatMatch, Vec3,
} from "./contrat";
import { affecter, affecterBase, baseDepuisCap, norme } from "./vec";
import { creerArene, placeCoupDEnvoi } from "./arene";
import { creerBalle, pasBalle } from "./balle";
import { contactVoitureBalle, contactVoitureVoiture } from "./contacts";
import { centreHitbox, creerVoiture, pasVoiture, replacerVoiture } from "./voiture";

// ============================================================================================================================
// Constantes propres au match (ni dans le contrat ni dans la spec)
// ============================================================================================================================

/** Noms des bots (clins d'œil à Agroparc), attribués dans l'ordre de création. */
export const NOMS_BOTS: readonly string[] = [
  "Bistrot", "Pause", "Muche", "Basilic", "Dubble", "Mijote", "Picadeli", "Vival", "Goulaf", "Sportif", "Edenred", "Ciqual",
];

/** Réglages du comptage des statistiques (dérivés de la spec § 6.2, valeurs de ressenti pour les seuils). */
export const REGLES_STATS = {
  /** vitesse minimale de la balle pour compter un arrêt ou un tir (m/s) */
  vitesseCadreeMin: 8,
  /** un arrêt est compté si la balle est à moins de `MATCH.distanceArretM` de la ligne ; un tir cadré de plus loin (m) */
  distanceTirM: 45,
  /** horizon de la prolongation linéaire de la trajectoire (s) */
  horizonCadrageS: 4,
  /** délai minimal entre deux arrêts / deux tirs comptés pour une même voiture (s) */
  delaiArretS: 1,
  delaiTirS: 1,
  /** délai minimal entre deux touches comptées (points) / émises (événement) pour une même voiture (s) : un dribble ne gonfle pas le score */
  delaiTouchePointsS: 0.4,
  delaiToucheEvenementS: 0.12,
  /** une balle plus rapide que cela déclenche toujours l'événement de touche (m/s, vitesse relative) */
  forceToucheToujours: 8,
  /** vitesse normale minimale à l'impact avec le décor pour émettre `balleDecor` (m/s) */
  vitesseImpactDecorMin: 2.5,
  /** la balle est « en l'air » si son centre est à plus de rayon + cette marge au-dessus du sol (m) (spec § 6.1) */
  margeSolBalle: 0.3,
  /** distance minimale aux autres voitures d'une place de réapparition (m) */
  degagementReapparition: 6,
} as const;

// ============================================================================================================================
// État interne rattaché au monde (copiable avec lui : structuredClone conserve la propriété)
// ============================================================================================================================

/**
 * Données de suivi qui n'ont pas de place dans `MondeRocket` (contrat) : délais de comptage des statistiques par voiture, drapeaux
 * d'événements uniques, temps de grâce de la balle. Elle vit sur le monde lui-même (propriété `interne`) pour que le monde reste une
 * structure de données autonome, sérialisable et copiable (futur jeu en ligne).
 */
export interface InterneMatch {
  /** dernier instant (temps de jeu) auquel chaque voiture a touché la balle (comptage) / émis un événement de touche */
  touchePoints: number[];
  toucheEvenement: number[];
  dernierArret: number[];
  dernierTir: number[];
  /** `chronoZero` déjà émis pour la période courante */
  chronoZeroEmis: boolean;
  /** temps déjà attendu que la balle touche le sol après le chrono à 0 (s) */
  graceBalleS: number;
}
export type MondeMatch = MondeRocket & { interne?: InterneMatch };

function interne(m: MondeRocket): InterneMatch {
  const mm = m as MondeMatch;
  const n = m.voitures.length;
  let i = mm.interne;
  if (!i || i.touchePoints.length !== n) {
    i = mm.interne = {
      touchePoints: new Array<number>(n).fill(-Infinity), toucheEvenement: new Array<number>(n).fill(-Infinity),
      dernierArret: new Array<number>(n).fill(-Infinity), dernierTir: new Array<number>(n).fill(-Infinity),
      chronoZeroEmis: false, graceBalleS: 0,
    };
  }
  return i;
}

// ============================================================================================================================
// Création du monde
// ============================================================================================================================

const statsVides = () => ({ buts: 0, passes: 0, arrets: 0, tirs: 0, demolitions: 0, demolie: 0, touches: 0, points: 0 });

function instantaneVide(n: number, balle: EtatBalle): MondeRocket["precedent"] {
  return {
    voitures: Array.from({ length: n }, () => ({ p: [0, 0, 0] as Vec3, base: baseDepuisCap(0) })),
    balle: { p: [balle.p[0], balle.p[1], balle.p[2]] as Vec3 },
  };
}

/** Recopie l'état courant dans `precedent` (sans allocation) : l'interpolation de l'affichage repart de l'état actuel. */
function synchroniserPrecedent(m: MondeRocket): void {
  const pr = m.precedent;
  for (let i = 0; i < m.voitures.length; i++) {
    affecter(pr.voitures[i].p, m.voitures[i].p);
    affecterBase(pr.voitures[i].base, m.voitures[i].base);
  }
  affecter(pr.balle.p, m.balle.p);
}

/**
 * Crée le monde : voitures (l'humain est le slot 0 de `equipeJoueur`, tous les autres sont des bots), balle au centre, plots pleins,
 * score 0-0, phase « decompte » (le premier coup d'envoi est tiré avec le générateur de la partie).
 */
export const creerMonde: CreerMonde = (config: ConfigMatch, arene?: Arene): MondeRocket => {
  const a = arene ?? creerArene();
  const n = joueursParEquipe(config.format);
  const voitures: EtatVoiture[] = [];
  let nBot = 0;
  for (const equipe of ["bleue", "orange"] as const) {
    for (let slot = 0; slot < n; slot++) {
      const humain = equipe === config.equipeJoueur && slot === 0;
      const nom = humain ? config.nomJoueur : NOMS_BOTS[nBot++ % NOMS_BOTS.length];
      voitures.push(creerVoiture({ id: voitures.length, equipe, slot, humain, nom, p: [0, VOITURE.hauteurRepos, 0], cap: 0 }));
    }
  }
  const idHumain = voitures.findIndex((v) => v.humain);
  const balle = creerBalle([0, BALLE.hauteurEngagement, 0]);
  const plots: EtatPlot[] = PLOTS.map((p) => ({ id: p.id, actif: true, recharge: 0 }));
  const m: MondeRocket = {
    config: { ...config, nomsEquipes: { ...config.nomsEquipes } }, arene: a, tick: 0, temps: 0, phase: "decompte", tempsPhase: 0,
    tempsRestant: config.dureeS, prolongation: false, attenteSolBalle: false, score: { bleue: 0, orange: 0 }, dernierBut: null,
    voitures, idHumain, balle, plots, rng: creerRng(config.graine), precedent: instantaneVide(voitures.length, balle), vainqueur: null,
  };
  (m as MondeMatch).interne = interne(m);
  preparerCoupDEnvoi(m);
  return m;
};

// ============================================================================================================================
// Coup d'envoi et réapparition
// ============================================================================================================================

/** Position (origine de la voiture) et cap d'un emplacement de coup d'envoi pour une équipe : l'orange est le bleu tourné de 180° autour de Y. */
function emplacement(equipe: Equipe, i: number): { x: number; z: number; cap: number } {
  return placeCoupDEnvoi(equipe, COUPS_D_ENVOI[i]);
}

/**
 * Repose voitures, balle et plots pour un coup d'envoi puis lance le décompte. Tire avec le `Rng` du monde `n` positions parmi les 5
 * de Rocket League SANS remise (la même permutation sert aux deux équipes : coup d'envoi symétrique, donc équitable). Les voitures
 * démolies ressuscitent, le boost repasse à 33,33, les voitures sont figées jusqu'à « GO ».
 */
export const preparerCoupDEnvoi: PreparerCoupDEnvoi = (m) => {
  // Fisher-Yates partiel sur les 5 positions (consomme toujours 4 tirages : le flux de hasard ne dépend pas du format).
  const ordre = [0, 1, 2, 3, 4];
  for (let i = ordre.length - 1; i >= 1; i--) {
    const j = Math.floor(tirer(m.rng) * (i + 1));
    const t = ordre[i]; ordre[i] = ordre[j]; ordre[j] = t;
  }
  for (const v of m.voitures) {
    const e = emplacement(v.equipe, ordre[v.slot % ordre.length]);
    replacerVoiture(v, [e.x, VOITURE.hauteurRepos, e.z], e.cap, VOITURE.boostInitial);
    v.demolie = false;
    v.reapparitionDans = 0;
    v.figee = true;
  }
  const b = m.balle;
  const neuve = creerBalle([0, BALLE.hauteurEngagement, 0]);
  affecter(b.p, neuve.p); affecter(b.v, neuve.v); affecter(b.w, neuve.w);
  b.dernierToucheur = null;
  b.avantDernierToucheur = null;
  for (const p of m.plots) { p.actif = true; p.recharge = 0; }
  m.phase = "decompte";
  m.tempsPhase = 0;
  m.attenteSolBalle = false;
  m.dernierBut = null;
  const it = interne(m);
  it.graceBalleS = 0;
  synchroniserPrecedent(m);
};

/** Place de réapparition d'une voiture démolie : le premier emplacement de coup d'envoi de son équipe libre de voitures, en partant de son slot. */
function placeReapparition(m: MondeRocket, v: EtatVoiture): { x: number; z: number; cap: number } {
  let meilleur = emplacement(v.equipe, v.slot % COUPS_D_ENVOI.length), meilleureDist = -1;
  for (let k = 0; k < COUPS_D_ENVOI.length; k++) {
    const e = emplacement(v.equipe, (v.slot + k) % COUPS_D_ENVOI.length);
    let dMin = Infinity;
    for (const o of m.voitures) {
      if (o === v || o.demolie) continue;
      dMin = Math.min(dMin, Math.hypot(o.p[0] - e.x, o.p[2] - e.z));
    }
    if (dMin >= REGLES_STATS.degagementReapparition) return e;
    if (dMin > meilleureDist) { meilleureDist = dMin; meilleur = e; }
  }
  return meilleur;
}

// ============================================================================================================================
// Aides de règles
// ============================================================================================================================

/** La trajectoire (prolongée avec la gravité) de la balle `p`, `v` franchit-elle la ligne de la cage de signe `sz` dans l'ouverture ? `distMax` : distance maximale à la ligne. */
export function balleVersCage(p: Readonly<Vec3>, v: Readonly<Vec3>, sz: number, distMax: number): boolean {
  if (Math.hypot(v[0], v[1], v[2]) < REGLES_STATS.vitesseCadreeMin) return false;
  const vers = v[2] * sz;
  if (vers < 1) return false;
  const dist = (sz * STADE.demiLongueur - p[2]) * sz;
  if (dist < -BALLE.rayon || dist > distMax) return false;
  const t = Math.max(dist, 0) / vers;
  if (t > REGLES_STATS.horizonCadrageS) return false;
  // Une balle qui toucherait le sol avant la ligne rebondit : sa hauteur est ramenée à 0 (un tir rasant reste cadré).
  const x = p[0] + v[0] * t, y = Math.max(0, p[1] + v[1] * t - 0.5 * GRAVITE * t * t);
  return Math.abs(x) <= BUT.demiLargeur + BALLE.rayon * 0.5 && y <= BUT.hauteur + BALLE.rayon * 0.5;
}

const balleEnLAir = (m: MondeRocket): boolean => m.balle.p[1] > BALLE.rayon + REGLES_STATS.margeSolBalle;

function majStatsPoints(v: EtatVoiture, pts: number): void {
  v.stats.points += pts;
}

/** Vainqueur au score (null si égalité). */
const vainqueurAuScore = (m: MondeRocket): Equipe | null => (m.score.bleue === m.score.orange ? null : m.score.bleue > m.score.orange ? "bleue" : "orange");

function terminer(m: MondeRocket, vainqueur: Equipe | null, ev: EvenementMatch[]): void {
  m.phase = "fini";
  m.tempsPhase = 0;
  m.vainqueur = vainqueur;
  m.attenteSolBalle = false;
  for (const v of m.voitures) v.figee = true;
  ev.push({ t: "fin", vainqueur });
}

/** Le chrono est à 0 (ou la célébration d'un but à 0 s restantes s'achève) : fin de partie ou prolongation. */
function conclureTempsReglementaire(m: MondeRocket, ev: EvenementMatch[]): void {
  const v = vainqueurAuScore(m);
  if (v) { terminer(m, v, ev); return; }
  m.prolongation = true;
  m.tempsRestant = 0;
  ev.push({ t: "prolongation" });
  preparerCoupDEnvoi(m);
}

// ============================================================================================================================
// Un pas du match
// ============================================================================================================================

const vAvant: Vec3 = [0, 0, 0];

/** Un but vient d'être marqué par l'équipe `eq` : score, attributions (buteur, passe), phase « but ». */
function enregistrerBut(m: MondeRocket, eq: Equipe, ev: EvenementMatch[]): void {
  const b = m.balle;
  const dt = b.dernierToucheur;
  const idMarqueur = dt && dt.equipe === eq ? dt.idVoiture : null;
  let idPasse: number | null = null;
  if (idMarqueur !== null) {
    const av = b.avantDernierToucheur;
    if (av && av.equipe === eq && av.idVoiture !== idMarqueur && m.temps - av.temps <= MATCH.fenetrePasseS) idPasse = av.idVoiture;
  }
  m.score[eq]++;
  if (idMarqueur !== null) { m.voitures[idMarqueur].stats.buts++; majStatsPoints(m.voitures[idMarqueur], MATCH.points.but); }
  if (idPasse !== null) { m.voitures[idPasse].stats.passes++; majStatsPoints(m.voitures[idPasse], MATCH.points.passeDecisive); }
  const vitesseKmh = norme(b.v) * 3.6;
  m.dernierBut = { equipe: eq, idMarqueur, idPasse, vitesseKmh };
  m.phase = "but";
  m.tempsPhase = 0;
  m.attenteSolBalle = false;
  ev.push({ t: "but", equipe: eq, idMarqueur, idPasse, vitesseKmh });
}

/** Contacts voiture ↔ balle : événements, dernier toucheur, touches, arrêts et tirs. */
function contactsBalle(m: MondeRocket, dt: number, ev: EvenementMatch[]): void {
  const it = interne(m);
  const b = m.balle;
  const enJeu = m.phase === "enJeu";
  for (const v of m.voitures) {
    if (v.demolie || v.figee) continue;
    affecter(vAvant, b.v);
    const pAvant0 = b.p[0], pAvant1 = b.p[1], pAvant2 = b.p[2];
    const c = contactVoitureBalle(v, b, m.tick, dt);
    if (!c) continue;
    const id = v.id;
    if (m.temps - it.toucheEvenement[id] >= REGLES_STATS.delaiToucheEvenementS || c.force >= REGLES_STATS.forceToucheToujours) {
      it.toucheEvenement[id] = m.temps;
      ev.push({ t: "toucheBalle", idVoiture: id, force: c.force });
    }
    if (!enJeu) continue;
    // Arrêt : la balle (avant le choc) allait vers la cage de la voiture, tirée par un adversaire (ou par personne).
    const dtch = b.dernierToucheur;
    const cageDefendue = signeButDefendu(v.equipe);
    if (
      (!dtch || dtch.equipe !== v.equipe) && m.temps - it.dernierArret[id] >= REGLES_STATS.delaiArretS &&
      balleVersCage([pAvant0, pAvant1, pAvant2], vAvant, cageDefendue, MATCH.distanceArretM)
    ) {
      it.dernierArret[id] = m.temps;
      v.stats.arrets++;
      majStatsPoints(v, MATCH.points.arret);
      ev.push({ t: "arret", idVoiture: id });
    }
    // Dernier toucheur et toucheur précédent d'une AUTRE voiture (passes décisives).
    if (dtch && dtch.idVoiture !== id) b.avantDernierToucheur = dtch;
    b.dernierToucheur = { idVoiture: id, equipe: v.equipe, temps: m.temps };
    if (m.temps - it.touchePoints[id] >= REGLES_STATS.delaiTouchePointsS) {
      it.touchePoints[id] = m.temps;
      v.stats.touches++;
      majStatsPoints(v, MATCH.points.touche);
    }
    // Tir cadré : après le contact, la balle part vers la cage adverse.
    if (m.temps - it.dernierTir[id] >= REGLES_STATS.delaiTirS && balleVersCage(b.p, b.v, -cageDefendue, REGLES_STATS.distanceTirM)) {
      it.dernierTir[id] = m.temps;
      v.stats.tirs++;
      majStatsPoints(v, MATCH.points.tir);
    }
  }
}

/** Contacts voiture ↔ voiture : bumps et démolitions. */
function contactsVoitures(m: MondeRocket, ev: EvenementMatch[]): void {
  const vs = m.voitures;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    if (a.demolie || a.figee) continue;
    for (let j = i + 1; j < vs.length; j++) {
      const b = vs[j];
      if (b.demolie || b.figee) continue;
      const r = contactVoitureVoiture(a, b, m.tick);
      if (!r) continue;
      if (r.bump) ev.push({ t: "bump", idVoiture: a.id, autre: b.id, vitesse: r.bump.vitesse });
      const d = r.demolition;
      if (d) {
        const victime = vs[d.victime], auteur = vs[d.auteur];
        if (victime && auteur && victime.equipe !== auteur.equipe && !victime.demolie) {
          victime.demolie = true;
          victime.reapparitionDans = MATCH.reapparitionS;
          victime.boostActif = false;
          victime.stats.demolie++;
          auteur.stats.demolitions++;
          majStatsPoints(auteur, MATCH.points.demolition);
          ev.push({ t: "demolition", victime: victime.id, auteur: auteur.id, p: centreHitbox(victime) });
        }
        if (a.demolie) break;
      }
    }
  }
}

/** Plots de boost : recharge, ramassage par le centre de la hitbox (cylindre), voitures démolies exclues. */
function majPlots(m: MondeRocket, dt: number, ev: EvenementMatch[]): void {
  for (let k = 0; k < m.plots.length; k++) {
    const pl = m.plots[k];
    const def = PLOTS[k];
    if (!pl.actif) {
      pl.recharge -= dt;
      if (pl.recharge <= 0) { pl.actif = true; pl.recharge = 0; ev.push({ t: "plotRecharge", idPlot: pl.id }); }
      continue;
    }
    const cfg = def.gros ? PLOT.gros : PLOT.petit;
    const yMin = cfg.hauteurCentre - cfg.hauteur / 2, yMax = cfg.hauteurCentre + cfg.hauteur / 2;
    for (const v of m.voitures) {
      if (v.demolie || v.boost >= 100 - 1e-9) continue;
      const c = centreHitbox(v);
      if (c[1] < yMin || c[1] > yMax) continue;
      if (Math.hypot(c[0] - def.x, c[2] - def.z) > cfg.rayon) continue;
      const gain = Math.min(cfg.valeur, 100 - v.boost);
      v.boost += gain;
      pl.actif = false;
      pl.recharge = cfg.rechargeS;
      ev.push({ t: "plot", idVoiture: v.id, idPlot: pl.id, gros: def.gros, gain });
      break;
    }
  }
}

/** Voitures démolies dont le délai est écoulé : elles reviennent à un emplacement libre de leur équipe. */
function reapparitions(m: MondeRocket, ev: EvenementMatch[]): void {
  for (const v of m.voitures) {
    if (!v.demolie || v.reapparitionDans > 0) continue;
    const e = placeReapparition(m, v);
    replacerVoiture(v, [e.x, VOITURE.hauteurRepos, e.z], e.cap, VOITURE.boostInitial);
    v.demolie = false;
    v.reapparitionDans = 0;
    v.figee = false;
    ev.push({ t: "reapparition", idVoiture: v.id });
  }
}

/**
 * Un pas du match : entrées → voitures → balle → contacts → plots → règles (but, chrono, prolongation, fin) → phases. Remplit d'abord
 * `monde.precedent`. Rend les événements dans l'ordre où ils sont apparus. En phase « fini » le monde est figé.
 */
export const pasMonde: PasMonde = (m, entrees, dt = PAS_S) => {
  const ev: EvenementMatch[] = [];
  if (m.phase === "fini") return ev;
  const it = interne(m);
  synchroniserPrecedent(m);
  const decompte = m.phase === "decompte";

  // Décompte : événements 3, 2, 1 sur les franchissements de seconde.
  if (decompte) {
    const ancien = MATCH.decompteS - m.tempsPhase, nouveau = ancien - dt;
    for (const n of [3, 2, 1] as const) if (ancien >= n - 1e-9 && nouveau < n - 1e-9) ev.push({ t: "decompte", n });
  }

  // 1. Voitures (entrées ignorées par les voitures figées ou démolies).
  for (let i = 0; i < m.voitures.length; i++) {
    const e = pasVoiture(m.arene, m.voitures[i], entrees[i] ?? ENTREES_NULLES(), dt, m.tick);
    for (const x of e) ev.push(x);
  }

  // 2. Balle (immobile pendant le décompte), 3. contacts.
  if (!decompte) {
    const impact = pasBalle(m.arene, m.balle, dt);
    if (impact && impact.vitesse >= REGLES_STATS.vitesseImpactDecorMin) ev.push({ t: "balleDecor", vitesse: impact.vitesse, point: impact.point });
    contactsBalle(m, dt, ev);
    contactsVoitures(m, ev);
  }

  // 4. Plots.
  majPlots(m, dt, ev);

  // 5. Règles de phase.
  if (m.phase === "enJeu") {
    m.tempsPhase += dt;
    reapparitions(m, ev);
    const eq = m.arene.butMarque(m.balle.p, BALLE.rayon);
    if (eq) {
      enregistrerBut(m, eq, ev);
    } else if (!m.prolongation) {
      m.tempsRestant = Math.max(0, m.tempsRestant - dt);
      if (m.tempsRestant <= 0) {
        if (!it.chronoZeroEmis) { it.chronoZeroEmis = true; ev.push({ t: "chronoZero" }); }
        if (balleEnLAir(m) && it.graceBalleS < MATCH.graceBalleEnAirS) {
          m.attenteSolBalle = true;
          it.graceBalleS += dt;
        } else {
          m.attenteSolBalle = false;
          conclureTempsReglementaire(m, ev);
        }
      }
    }
  } else if (m.phase === "but") {
    m.tempsPhase += dt;
    if (m.tempsPhase >= MATCH.celebrationS - 1e-9) {
      if (m.prolongation) terminer(m, vainqueurAuScore(m), ev);
      else if (m.tempsRestant <= 0) conclureTempsReglementaire(m, ev);
      else preparerCoupDEnvoi(m);
    }
  } else if (decompte) {
    m.tempsPhase += dt;
    if (m.tempsPhase >= MATCH.decompteS - 1e-6) {
      m.phase = "enJeu";
      m.tempsPhase = 0;
      for (const v of m.voitures) v.figee = false;
      ev.push({ t: "coupDEnvoi" });
    }
  }

  // 6. Horloge.
  m.tick++;
  m.temps += dt;
  return ev;
};

// ============================================================================================================================
// Résultat et empreinte
// ============================================================================================================================

/** Classement courant (points décroissants, puis buts, puis id) et meilleur joueur (de l'équipe gagnante s'il y en a une, sinon de tous). */
export const resultatMatch: ResultatCourant = (m): ResultatMatch => {
  const classement: LigneClassement[] = m.voitures.map((v) => ({ id: v.id, nom: v.nom, equipe: v.equipe, humain: v.humain, stats: { ...v.stats } }));
  classement.sort((a, b) => b.stats.points - a.stats.points || b.stats.buts - a.stats.buts || a.id - b.id);
  const gagnant = m.vainqueur ?? vainqueurAuScore(m);
  const candidats = gagnant ? classement.filter((l) => l.equipe === gagnant) : classement;
  const mvp = (candidats[0] ?? classement[0])?.id ?? null;
  return { vainqueur: m.vainqueur, score: { ...m.score }, prolongation: m.prolongation, equipeJoueur: m.config.equipeJoueur, classement, mvp };
};

/**
 * Empreinte numérique (FNV-1a 32 bits) de l'état de jeu : positions, vitesses, bases, boost, score, chrono, plots, état du générateur.
 * Sert aux tests de déterminisme (même graine + mêmes entrées → même empreinte) et au futur contrôle de synchronisation en ligne.
 */
export function empreinteMonde(m: Readonly<MondeRocket>): number {
  const buf = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5;
  const mixer = (x: number): void => {
    buf.setFloat64(0, x);
    for (let i = 0; i < 8; i++) { h ^= buf.getUint8(i); h = Math.imul(h, 0x01000193) >>> 0; }
  };
  const vec = (a: Readonly<Vec3>): void => { mixer(a[0]); mixer(a[1]); mixer(a[2]); };
  mixer(m.tick); mixer(m.temps); mixer(m.tempsRestant); mixer(m.score.bleue); mixer(m.score.orange); mixer(m.rng.s);
  mixer(m.phase === "decompte" ? 0 : m.phase === "enJeu" ? 1 : m.phase === "but" ? 2 : 3);
  vec(m.balle.p); vec(m.balle.v); vec(m.balle.w);
  for (const v of m.voitures) {
    vec(v.p); vec(v.v); vec(v.w); vec(v.base.avant); vec(v.base.haut); mixer(v.boost); mixer(v.demolie ? 1 : 0);
    mixer(v.stats.points);
  }
  for (const p of m.plots) { mixer(p.actif ? 1 : 0); mixer(p.recharge); }
  return h >>> 0;
}

/** Équipe adverse d'une voiture (raccourci pour les cerveaux). */
export const equipeAdverse = (v: Readonly<EtatVoiture>): Equipe => adversaire(v.equipe);

/** Copie profonde d'un monde (hors arène partagée) : tests, retour en arrière, futur rollback en ligne. */
export function copierMonde(m: Readonly<MondeRocket>): MondeRocket {
  const { arene, ...reste } = m;
  return { ...(structuredClone(reste) as Omit<MondeRocket, "arene">), arene };
}
