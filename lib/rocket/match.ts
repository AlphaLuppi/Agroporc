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
  BALLE, BOOST, BUT, COUPS_D_ENVOI, ENTREES_NULLES, GRAVITE, MATCH, PAS_S, PLOT, PLOTS, REAPPARITIONS, VOITURE, adversaire, joueursParEquipe, tirer,
  creerRng, uu,
} from "./contrat";
import type {
  Arene, ConfigMatch, CreerMonde, Equipe, EtatBalle, EtatPlot, EtatVoiture, EvenementMatch, LigneClassement, MondeRocket, PasMonde,
  PreparerCoupDEnvoi, ResultatCourant, ResultatMatch, Vec3,
} from "./contrat";
import { affecter, affecterBase, baseDepuisCap, norme } from "./vec";
import { creerArene, placeCoupDEnvoi } from "./arene";
import { bornerBalle, creerBalle, pasBalle } from "./balle";
import { appliquerVitesseEnAttente, contactVoitureBalle, contactVoitureVoiture } from "./contacts";
import { DEMI_HITBOX, centreHitbox, creerVoiture, pasVoiture, plafonnerVitesse, replacerVoiture } from "./voiture";

// ============================================================================================================================
// Constantes propres au match (ni dans le contrat ni dans la spec)
// ============================================================================================================================

/** Noms des bots (clins d'œil à Agroparc), attribués dans l'ordre de création. */
export const NOMS_BOTS: readonly string[] = [
  "Bistrot", "Pause", "Muche", "Basilic", "Dubble", "Mijote", "Picadeli", "Vival", "Goulaf", "Sportif", "Edenred", "Ciqual",
];

/**
 * Réglages du comptage des statistiques qui ne viennent pas de RocketSim (valeurs de ressenti). Buteur, passe décisive, tirs cadrés et
 * arrêts suivent RocketSim GameEventTracker : leurs seuils sont dans `MATCH` (`fenetreButeurS`, `fenetrePasseS`, `suivi`).
 */
export const REGLES_STATS = {
  /** délai minimal entre deux touches comptées (points) / émises (événement) pour une même voiture (s) : un dribble ne gonfle pas le score */
  delaiTouchePointsS: 0.4,
  delaiToucheEvenementS: 0.12,
  /** une balle plus rapide que cela déclenche toujours l'événement de touche (m/s, vitesse relative) */
  forceToucheToujours: 8,
  /** vitesse normale minimale à l'impact avec le décor pour émettre `balleDecor` (m/s) */
  vitesseImpactDecorMin: 2.5,
  /** la balle est « en l'air » si son centre est à plus de rayon + cette marge au-dessus du sol (m) (spec § 6.1) */
  margeSolBalle: 0.3,
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
  /**
   * suivi des tirs (RocketSim GameEventTracker) : la balle est « tirée » (`_ballShot`) vers la cage que défend `cageTiree`
   * (`_ballShotGoalTeam`) ; temps restant avant de pouvoir compter un nouveau tir (`_shotCooldown`, s)
   */
  balleTiree: boolean;
  cageTiree: Equipe;
  delaiTirS: number;
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
      balleTiree: false, cageTiree: "bleue", delaiTirS: 0, chronoZeroEmis: false, graceBalleS: 0,
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
  const plots: EtatPlot[] = PLOTS.map((p) => ({ id: p.id, actif: true, recharge: 0, verrou: -1 }));
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
 * de Rocket League SANS remise (la même permutation sert aux deux équipes : coup d'envoi symétrique, donc équitable ; RocketSim
 * Arena::ResetToRandomKickoff mélange de même les 5 places et donne la même aux deux équipes). Les voitures démolies ressuscitent,
 * le boost repasse à 33,33, les voitures sont figées jusqu'à « GO ». Comme dans RocketSim, tout repart d'un état neuf : plots pleins et
 * sans verrou (`BoostPadState()`), dernières touches de balle oubliées (`CarState()`), suivi des tirs remis à zéro
 * (GameEventTracker::ResetPersistentInfo).
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
    v.dernierContactBalleTick = -1e9;
  }
  const b = m.balle;
  const neuve = creerBalle([0, BALLE.hauteurEngagement, 0]);
  affecter(b.p, neuve.p); affecter(b.v, neuve.v); affecter(b.w, neuve.w); affecter(b.vitesseEnAttente, neuve.vitesseEnAttente);
  b.dernierToucheur = null;
  b.avantDernierToucheur = null;
  for (const p of m.plots) { p.actif = true; p.recharge = 0; p.verrou = -1; }
  m.phase = "decompte";
  m.tempsPhase = 0;
  m.attenteSolBalle = false;
  m.dernierBut = null;
  const it = interne(m);
  it.graceBalleS = 0;
  it.balleTiree = false;
  it.delaiTirS = 0;
  synchroniserPrecedent(m);
};

/**
 * Place de réapparition d'une voiture démolie (RocketSim Car::Respawn) : l'un des quatre emplacements de `REAPPARITIONS`
 * (CAR_RESPAWN_LOCATION_AMOUNT = 4), tiré au hasard avec le `Rng` du monde (déterministe). Pour l'orange, z est inversé et le cap
 * tourné de π ; x ne l'est pas (`spawnPos.y * -1`, `yawAng + M_PI`), ce qui donne les mêmes quatre places. Aucun test d'emplacement
 * libre, comme dans RocketSim.
 */
function placeReapparition(m: MondeRocket, v: EtatVoiture): { x: number; z: number; cap: number } {
  const pos = REAPPARITIONS[Math.min(REAPPARITIONS.length - 1, Math.floor(tirer(m.rng) * REAPPARITIONS.length))];
  return v.equipe === "bleue" ? { x: pos.x, z: pos.z, cap: pos.cap } : { x: pos.x, z: -pos.z, cap: pos.cap + Math.PI };
}

// ============================================================================================================================
// Aides de règles
// ============================================================================================================================

/**
 * La balle va-t-elle « probablement » entrer dans une cage en moins de `maxS` secondes (RocketSim Arena::IsBallProbablyGoingIn) ? La
 * cage visée est celle vers laquelle la balle avance en Z ; le temps est la distance à la ligne de but (`BUT.seuilMarque`,
 * goalBaseThresholdY) divisée par la vitesse en Z ; la position est prolongée avec la gravité, sans rebond (une balle qui passerait
 * sous le sol reste cadrée) ; le cadre est élargi de 0,1 rayon de balle (`MATCH.suivi.margeCadreRayons`) plus `marge`. Rend l'équipe
 * qui DÉFEND cette cage (RS_TEAM_FROM_Y(scoreDirSgn)), null si la balle n'y va pas.
 */
export function balleVaEntrer(p: Readonly<Vec3>, v: Readonly<Vec3>, maxS: number, marge = 0): Equipe | null {
  // RocketSim : `abs(ballVel.y) < FLT_EPSILON` (1,19e-7 uu/s)
  const vz = Math.abs(v[2]);
  if (vz < V_Z_MIN) return null;
  const sg = v[2] < 0 ? -1 : 1;
  const t = Math.abs(p[2] - BUT.seuilMarque * sg) / vz;
  if (t > maxS) return null;
  const m = BALLE.rayon * MATCH.suivi.margeCadreRayons + marge;
  if (p[1] + v[1] * t - 0.5 * GRAVITE * t * t > BUT.hauteur + m) return null; // trop haut
  if (Math.abs(p[0] + v[0] * t) > BUT.demiLargeur + m) return null; // trop sur le côté
  return sg < 0 ? "bleue" : "orange";
}
const V_Z_MIN = uu(1.1920929e-7);

/** Nombre de pas que dure `s` secondes (RocketSim : `temps × tickrate` tronqué en entier ; 0,3 s = 36 pas, 2 s = 240, 4 s = 480 à 120 Hz). */
const pasPour = (s: number, dt: number): number => Math.floor(s / dt + 1e-6);

/**
 * RocketSim GetShooterPasser : la voiture de l'équipe `eq` (autre que `sauf`) dont la dernière touche de balle
 * (`dernierContactBalleTick`, BallHitInfo::tickCountWhenHit) est la plus récente, à condition que `touche + pasMax >= tickRef`.
 * Rend son id (son index dans `m.voitures`), -1 si aucune. Une voiture démolie compte.
 */
function derniereTouche(m: MondeRocket, eq: Equipe, pasMax: number, tickRef: number, sauf: number): number {
  let id = -1, meilleure = -Infinity;
  for (const v of m.voitures) {
    if (v.equipe !== eq || v.id === sauf) continue;
    const t = v.dernierContactBalleTick;
    if (t + pasMax >= tickRef && t > meilleure) { id = v.id; meilleure = t; }
  }
  return id;
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

/**
 * Un but vient d'être marqué par l'équipe `eq` : score, attributions, phase « but ». Buteur et passeur comme RocketSim
 * GameEventTracker (GetShooterPasser) : le buteur est la voiture de `eq` qui a touché la balle le plus récemment, dans les 4 dernières
 * secondes (`MATCH.fenetreButeurS`), même si un adversaire l'a déviée ensuite ; le passeur est une AUTRE voiture de `eq` dont la
 * dernière touche précède de 2 s au plus celle du buteur (`MATCH.fenetrePasseS`). Les touches sont comptées en pas, l'instant du but
 * étant le compteur de pas APRÈS ce pas (RocketSim lit `arena->tickCount` une fois le pas fini).
 */
function enregistrerBut(m: MondeRocket, eq: Equipe, dt: number, ev: EvenementMatch[]): void {
  const b = m.balle;
  const marqueur = derniereTouche(m, eq, pasPour(MATCH.fenetreButeurS, dt), m.tick + 1, -1);
  const passe = marqueur < 0 ? -1 : derniereTouche(m, eq, pasPour(MATCH.fenetrePasseS, dt), m.voitures[marqueur].dernierContactBalleTick, marqueur);
  const idMarqueur = marqueur < 0 ? null : marqueur, idPasse = passe < 0 ? null : passe;
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

/**
 * Tirs cadrés et arrêts, jugés une fois par pas après la physique (RocketSim GameEventTracker::Update, réglages `MATCH.suivi`).
 *  - balle non « tirée » : après le délai entre deux tirs, si elle va à 17,5 m/s au moins et qu'elle entre dans une cage en moins de
 *    2 s, le tireur est la voiture de l'équipe qui attaque cette cage dont la dernière touche date de 36 ou 37 pas (0,3 s : le tir
 *    n'est compté que si la balle file toujours au but 0,3 s après la frappe). La balle devient « tirée » vers cette cage.
 *  - balle « tirée » : dès qu'elle n'entre plus dans aucune cage, elle ne l'est plus ; si une voiture de l'équipe qui défendait l'a
 *    touchée à ce pas même, c'est un arrêt (sinon le tir a simplement manqué le cadre).
 */
function suiviTirs(m: MondeRocket, dt: number, ev: EvenementMatch[]): void {
  const it = interne(m), b = m.balle, S = MATCH.suivi;
  const tickFin = m.tick + 1;
  if (!it.balleTiree) {
    if (it.delaiTirS > 0) {
      // pas de tir possible pendant le délai (RocketSim ne teste rien au pas où le délai tombe à 0)
      it.delaiTirS -= dt;
      if (it.delaiTirS < 1e-9) it.delaiTirS = 0;
      return;
    }
    if (b.v[0] * b.v[0] + b.v[1] * b.v[1] + b.v[2] * b.v[2] < S.vitesseMin * S.vitesseMin) return;
    const cage = balleVaEntrer(b.p, b.v, S.horizonS);
    if (!cage) return;
    const delai = pasPour(S.delaiToucheS, dt);
    const id = derniereTouche(m, adversaire(cage), 1 + delai, tickFin, -1);
    if (id < 0) return;
    const tireur = m.voitures[id];
    if (tickFin - tireur.dernierContactBalleTick < delai) return;
    it.balleTiree = true;
    it.cageTiree = cage;
    it.delaiTirS = S.delaiTirS;
    tireur.stats.tirs++;
    majStatsPoints(tireur, MATCH.points.tir);
  } else {
    if (balleVaEntrer(b.p, b.v, S.horizonS)) return;
    const id = derniereTouche(m, it.cageTiree, 1, tickFin, -1);
    if (id >= 0) {
      const gardien = m.voitures[id];
      gardien.stats.arrets++;
      majStatsPoints(gardien, MATCH.points.arret);
      ev.push({ t: "arret", idVoiture: id });
    }
    it.balleTiree = false;
  }
}

// ---- état d'avant les contacts du pas (tampons de travail, remplis au début de chaque pas : aucune allocation dans la boucle) ----
/** Position et vitesse de la balle avant les contacts du pas (RocketSim : `ballState` lu dans les rappels de contact, avant le solveur). */
const BALLE_AVANT: { p: Vec3; v: Vec3 } = { p: [0, 0, 0], v: [0, 0, 0] };
/** Vitesse de chaque voiture avant les contacts du pas (balle et autres voitures), par indice dans `monde.voitures`. */
const VITESSES_AVANT: Vec3[] = [];
/** Voitures entrées dans un contact voiture ↔ voiture à ce pas : leur vitesse est plafonnée une fois, après toutes les paires. */
const HEURTEES: boolean[] = [];

/**
 * Fige l'état que lisent les règles de RocketSim dans ses rappels de contact (impulsion de Psyonix, bump, démolition) : la balle et
 * les vitesses des voitures telles qu'elles sont AVANT le premier contact du pas. Les contacts sont ensuite résolus l'un après
 * l'autre, mais ces règles ne voient ni le choc ni l'impulsion d'un contact passé plus tôt dans la boucle : leur issue ne dépend
 * pas de l'ordre des voitures dans la liste.
 */
function figerAvantContacts(m: MondeRocket): void {
  affecter(BALLE_AVANT.p, m.balle.p); affecter(BALLE_AVANT.v, m.balle.v);
  const vs = m.voitures;
  for (let i = 0; i < vs.length; i++) {
    if (i >= VITESSES_AVANT.length) VITESSES_AVANT.push([0, 0, 0]);
    affecter(VITESSES_AVANT[i], vs[i].v);
    HEURTEES[i] = false;
  }
}

/**
 * Contacts voiture ↔ balle : événements, dernier toucheur, touches (tirs et arrêts : `suiviTirs`, buteur et passe : `enregistrerBut`).
 * L'impulsion de Psyonix de chaque voiture se calcule sur la balle d'avant les contacts (`BALLE_AVANT`) et attend dans
 * `balle.vitesseEnAttente` : `pasMonde` l'ajoute une fois, après tous les contacts.
 */
function contactsBalle(m: MondeRocket, dt: number, ev: EvenementMatch[]): void {
  const it = interne(m);
  const b = m.balle;
  const enJeu = m.phase === "enJeu";
  for (const v of m.voitures) {
    if (v.demolie || v.figee) continue;
    const c = contactVoitureBalle(v, b, m.tick, dt, BALLE_AVANT);
    if (!c) continue;
    const id = v.id;
    if (m.temps - it.toucheEvenement[id] >= REGLES_STATS.delaiToucheEvenementS || c.force >= REGLES_STATS.forceToucheToujours) {
      it.toucheEvenement[id] = m.temps;
      ev.push({ t: "toucheBalle", idVoiture: id, force: c.force });
    }
    if (!enJeu) continue;
    // Dernier toucheur et toucheur précédent d'une AUTRE voiture (couleur de la balle, bots).
    const dtch = b.dernierToucheur;
    if (dtch && dtch.idVoiture !== id) b.avantDernierToucheur = dtch;
    b.dernierToucheur = { idVoiture: id, equipe: v.equipe, temps: m.temps };
    if (m.temps - it.touchePoints[id] >= REGLES_STATS.delaiTouchePointsS) {
      it.touchePoints[id] = m.temps;
      v.stats.touches++;
      majStatsPoints(v, MATCH.points.touche);
    }
  }
}

/**
 * Contacts voiture ↔ voiture : bumps et démolitions. Les conditions et la direction d'un bump se lisent sur les vitesses d'avant les
 * contacts du pas (`VITESSES_AVANT`) et sa vitesse attend dans `victime.vitesseEnAttente`. Une fois TOUTES les paires passées
 * (RocketSim Car::_FinishPhysicsTick, après le pas de Bullet), chaque voiture reçoit sa vitesse en attente, puis celles qui ont été
 * heurtées sont ramenées sous le plafond de 23 m/s, une seule fois : trois voitures qui se touchent au même pas ne se transmettent
 * pas un bump d'une paire à l'autre.
 */
function contactsVoitures(m: MondeRocket, ev: EvenementMatch[]): void {
  const vs = m.voitures;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    if (a.demolie || a.figee) continue;
    for (let j = i + 1; j < vs.length; j++) {
      const b = vs[j];
      if (b.demolie || b.figee) continue;
      const r = contactVoitureVoiture(a, b, m.tick, VITESSES_AVANT[i], VITESSES_AVANT[j]);
      if (!r) continue;
      HEURTEES[i] = true; HEURTEES[j] = true;
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
  // fin de pas des voitures : vitesse des bumps reçus, puis plafond (une voiture démolie à ce pas perd le bump qu'elle attendait :
  // RocketSim saute Car::_FinishPhysicsTick pour elle, et sa réapparition repart d'un état neuf)
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i];
    if (v.demolie) { v.vitesseEnAttente[0] = 0; v.vitesseEnAttente[1] = 0; v.vitesseEnAttente[2] = 0; continue; }
    appliquerVitesseEnAttente(v);
    if (HEURTEES[i]) plafonnerVitesse(v);
  }
}

const f32 = Math.fround;
const [DX, DY, DZ] = VOITURE.decalageHitbox;
const [HX, HY, HZ] = DEMI_HITBOX;

/**
 * La voiture verrouillée sur un plot le touche-t-elle encore (RocketSim BoostPad::_CheckCollide, branche `prevLockedCarID`) ? Boîte du
 * plot (demi-côté `demiCoteBoite`, de `hauteurCentre` à `hauteurCentre + hauteurBoite`) contre la boîte englobante alignée sur les axes
 * de la hitbox orientée (Bullet `getAabb` : centre ± |base| × demi-tailles), comparaisons strictes composante par composante
 * (`_boxMaxBT > carMinBT && _boxMinBT < carMaxBT`). Sans allocation.
 */
function boiteVoitureTouchePlot(v: EtatVoiture, x: number, z: number, cfg: typeof PLOT.petit | typeof PLOT.gros): boolean {
  const { avant, droite, haut } = v.base;
  const cx = v.p[0] + avant[0] * DX + droite[0] * DY + haut[0] * DZ, ex = Math.abs(avant[0]) * HX + Math.abs(droite[0]) * HY + Math.abs(haut[0]) * HZ;
  if (!(x + cfg.demiCoteBoite > cx - ex && x - cfg.demiCoteBoite < cx + ex)) return false;
  const cz = v.p[2] + avant[2] * DX + droite[2] * DY + haut[2] * DZ, ez = Math.abs(avant[2]) * HX + Math.abs(droite[2]) * HY + Math.abs(haut[2]) * HZ;
  if (!(z + cfg.demiCoteBoite > cz - ez && z - cfg.demiCoteBoite < cz + ez)) return false;
  const cy = v.p[1] + avant[1] * DX + droite[1] * DY + haut[1] * DZ, ey = Math.abs(avant[1]) * HX + Math.abs(droite[1]) * HY + Math.abs(haut[1]) * HZ;
  return cfg.hauteurCentre + cfg.hauteurBoite > cy - ey && cfg.hauteurCentre < cy + ey;
}

/**
 * Plots de boost, dans l'ordre d'un pas de RocketSim (Arena::Step, BoostPad.cpp, BoostPadGrid.cpp) :
 *  1. recharge (`_PreTickUpdate`) : décomptée en simple précision comme RocketSim, le plot redevient actif quand elle vaut 0 (480 pas
 *     pour un petit plot, 1201 pour un gros : 10 − 1200 × (1/120) ne tombe pas à 0 en simple précision) ; un plot qui revient peut
 *     être pris à ce pas même ;
 *  2. contact (`_CheckCollide`), plot actif ou non, pour chaque voiture ni démolie ni pleine dont l'origine est sous 3,45 m
 *     (`PLOT.hauteurMaxOrigine`) : la voiture verrouillée au pas précédent est jugée sur la boîte du plot contre sa boîte englobante
 *     (`boiteVoitureTouchePlot`), les autres sur le cylindre contre leur ORIGINE (rayon 1,44 ou 2,08 m, à moins de 0,95 m en
 *     hauteur du centre du plot ; inégalités strictes). Si plusieurs voitures touchent, la dernière de la liste l'emporte ;
 *  3. don du boost si le plot est actif, puis verrou = la voiture en contact ou -1 (`_PostTickUpdate`).
 * Une voiture posée au sol (boîte englobante sous 0,70 m) ne touche jamais la boîte : restée sur un plot, elle est donc verrouillée un
 * pas sur deux, comme dans RocketSim.
 */
function majPlots(m: MondeRocket, dt: number, ev: EvenementMatch[]): void {
  const dt32 = f32(dt);
  for (let k = 0; k < m.plots.length; k++) {
    const pl = m.plots[k];
    const def = PLOTS[k];
    if (!pl.actif) {
      pl.recharge = Math.max(f32(pl.recharge - dt32), 0);
      if (pl.recharge === 0) { pl.actif = true; ev.push({ t: "plotRecharge", idPlot: pl.id }); }
    }
    const cfg = def.gros ? PLOT.gros : PLOT.petit;
    let preneur: EtatVoiture | null = null;
    for (const v of m.voitures) {
      if (v.demolie || v.boost >= BOOST.max || v.p[1] > PLOT.hauteurMaxOrigine) continue;
      if (pl.verrou === v.id) {
        if (!boiteVoitureTouchePlot(v, def.x, def.z, cfg)) continue;
      } else {
        const dx = v.p[0] - def.x, dz = v.p[2] - def.z;
        if (dx * dx + dz * dz >= cfg.rayon * cfg.rayon) continue;
        if (Math.abs(v.p[1] - cfg.hauteurCentre) >= cfg.demiHauteur) continue;
      }
      preneur = v;
    }
    if (preneur && pl.actif) {
      // RocketSim : boost = min(boost + BOOST_AMOUNT, BOOST_MAX)
      const avant = preneur.boost;
      preneur.boost = Math.min(avant + cfg.valeur, BOOST.max);
      const gain = preneur.boost - avant;
      pl.actif = false;
      pl.recharge = cfg.rechargeS;
      ev.push({ t: "plot", idVoiture: preneur.id, idPlot: pl.id, gros: def.gros, gain });
    }
    pl.verrou = preneur ? preneur.id : -1;
  }
}

/**
 * Voitures démolies dont le délai est écoulé (360 pas : le décompte de `pasVoiture` tombe exactement à 0) : elles reviennent à l'un des
 * quatre emplacements de réapparition de leur équipe, lâchées de 36 cm (RocketSim CAR_RESPAWN_Z), boost à 33,33.
 */
function reapparitions(m: MondeRocket, ev: EvenementMatch[]): void {
  for (const v of m.voitures) {
    if (!v.demolie || v.reapparitionDans > 0) continue;
    const e = placeReapparition(m, v);
    replacerVoiture(v, [e.x, VOITURE.hauteurReapparition, e.z], e.cap, VOITURE.boostInitial);
    v.demolie = false;
    v.reapparitionDans = 0;
    v.figee = false;
    ev.push({ t: "reapparition", idVoiture: v.id });
  }
}

/**
 * Un pas du match : entrées → voitures → balle → contacts → plots → règles (réapparitions, but, tirs et arrêts, chrono, prolongation,
 * fin) → phases. Remplit d'abord
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

  // 2. Balle (immobile pendant le décompte ; ensuite elle « dort » à sa hauteur d'engagement tant qu'aucune voiture ne l'a touchée,
  //    comme dans RocketSim), 3. contacts.
  if (!decompte) {
    const impact = pasBalle(m.arene, m.balle, dt);
    if (impact && impact.vitesse >= REGLES_STATS.vitesseImpactDecorMin) ev.push({ t: "balleDecor", vitesse: impact.vitesse, point: impact.point });
    figerAvantContacts(m);
    contactsBalle(m, dt, ev);
    contactsVoitures(m, ev);
    // fin de pas de la balle (RocketSim Ball::_FinishPhysicsTick) : les impulsions de Psyonix en attente entrent dans sa vitesse, puis
    // les plafonds (60 m/s, 6 rad/s) passent UNE fois, après toutes les impulsions du pas (chocs, frottement qui donne du spin, Psyonix)
    appliquerVitesseEnAttente(m.balle);
    bornerBalle(m.balle);
  }

  // 4. Plots.
  majPlots(m, dt, ev);

  // 5. Règles de phase.
  if (m.phase === "enJeu") {
    m.tempsPhase += dt;
    reapparitions(m, ev);
    const eq = m.arene.butMarque(m.balle.p, BALLE.rayon);
    if (eq) {
      enregistrerBut(m, eq, dt, ev);
    } else {
      suiviTirs(m, dt, ev);
      if (!m.prolongation) {
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
  for (const p of m.plots) { mixer(p.actif ? 1 : 0); mixer(p.recharge); mixer(p.verrou); }
  return h >>> 0;
}

/** Équipe adverse d'une voiture (raccourci pour les cerveaux). */
export const equipeAdverse = (v: Readonly<EtatVoiture>): Equipe => adversaire(v.equipe);

/** Copie profonde d'un monde (hors arène partagée) : tests, retour en arrière, futur rollback en ligne. */
export function copierMonde(m: Readonly<MondeRocket>): MondeRocket {
  const { arene, ...reste } = m;
  return { ...(structuredClone(reste) as Omit<MondeRocket, "arene">), arene };
}
