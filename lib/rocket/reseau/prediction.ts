/**
 * Rocket Muche en ligne : prédiction côté client avec rollback du monde entier (PUR : l'heure est toujours un argument, aucune horloge globale
 * dans la logique ; seul le chronométrage de DIAGNOSTIC du rollback lit `performance.now`, injectable par `OptionsPredicteurEtendu.chrono`).
 * Spec § 5 (algorithme), § 5.3 bis (resynchronisation dans les deux sens), § 5.4 (lissage), § 5.5 (événements), § 5.6 (garde de phase).
 *
 * Principe : le monde PRÉDIT avance au rythme que lui impose l'horloge (en avance sur le serveur de demi-RTT + marge) avec les entrées locales
 * quantifiées, et les dernières entrées connues des autres voitures (extrapolation). Chaque instantané du serveur est comparé à l'état prédit
 * au même tick (octet à octet) ; s'il diffère, on repart de l'état serveur et on rejoue jusqu'au tick local avec l'historique des entrées
 * locales. Au plus UN rollback par appel d'`avancer`, jamais dans le gestionnaire de messages. L'affichage lit `mondeAffiche`, qui applique des
 * corrections visuelles décroissantes et une garde de phase (jamais de but, de démolition ou de fin décidés par la seule prédiction).
 *
 * Jouabilité réseau : les entrées FUTURES des autres humains (`snap.futurs`) sont jouées au tick exact, la dernière est tenue ensuite ; un instantané
 * exact mais dont ces entrées diffèrent de celles jouées déclenche quand même le rejeu ; ma voiture prédite est conservée quand le serveur l'a jouée
 * avec une entrée répétée (`snap.manquees`) ; le lissage a une constante de temps par source (ma voiture, autres voitures, balle) et croît avec l'écart.
 */
import type { Base, EntreesVoiture, Equipe, EvenementMatch, MondeRocket, Vec3 } from "../contrat";
import { PAS_S } from "../contrat";
import { pasMonde } from "../match";
import { affecter, norme, reorthonormaliser } from "../vec";
import { creerMondeEnLigne } from "./monde-ligne";
import type {
  EntreesQuantifiees, EtatMondeReseau, OptionsPredicteur, PredicteurRocket, ResultatAvance, ResultatSnap, SnapRocket, StatsPrediction,
  TrameEntrees,
} from "./protocole";
import { ENTREES_QUANTIFIEES_NULLES, entreesQuantifieesEgales, octetsEtatEgaux, RESEAU } from "./protocole";
import { decoderEtat, dequantifierEntrees, encoderEtat, extraireEtat, quantifierEntrees, restaurerEtat } from "./serialisation";

/** Options du prédicteur + un chronomètre de diagnostic injectable (ms). Sans effet sur la simulation. */
export type OptionsPredicteurEtendu = OptionsPredicteur & { chrono?: () => number };

/** Événements de MA voiture produits par la prédiction et joués tout de suite (spec § 5.5). */
const TYPES_LOCAUX: ReadonlySet<string> = new Set(["saut", "doubleSaut", "flip", "atterrissage", "choc", "boost", "supersonique", "toucheBalle", "plot", "bump"]);
/** Écart de tick toléré pour apparier un événement serveur à un événement local. */
const APPARIEMENT_TICKS = 6;
/** Un événement local jamais confirmé est oublié au bout de (ticks). */
const OUBLI_LOCAUX_TICKS = 240;
/** Taille de l'anneau d'états de comparaison (un état tous les `cadenceSnapTicks` ticks). */
const ANNEAU_ETATS = 64;
const MASQUE_HISTORIQUE = RESEAU.historiqueEntrees - 1;
/** Un décalage de lissage plus petit que cela est ignoré (m / norme de vecteur de base). */
const EPS_LISSAGE = 1e-5;
/** Au-delà de ce nombre de constantes de temps, le décalage est considéré comme effacé. */
const POIDS_MIN = 0.004;

/** Écarts bruts (m) entre l'ancien état prédit et le nouveau, par source : plus grand de tous, ma voiture, voitures adverses ou alliées, balle. */
interface EcartsSnap {
  max: number;
  moi: number;
  adversaires: number;
  balle: number;
}

/** Entrée locale d'un appel d'`avancer` : forme quantifiée (envoyée, mémorisée) et dequantifiée (simulée), partagées par tous les pas de l'appel. */
interface EntreeLocale {
  q: EntreesQuantifiees;
  r: EntreesVoiture;
}

interface Lissage {
  dp: Vec3;
  dAvant: Vec3;
  dHaut: Vec3;
  /** instant (ms locaux) de la correction */
  t0: number;
  /** constante de temps du glissement (ms) */
  tau: number;
}

interface LissageBalle {
  dp: Vec3;
  t0: number;
  tau: number;
}

interface Affichage {
  pBrut: Vec3;
  pAff: Vec3;
  avantAff: Vec3;
  hautAff: Vec3;
  demolie: boolean;
}

/** Code exact (entier de moins de 2^53) d'une entrée quantifiée : cinq axes de 8 bits décalés, trois boutons. */
const codeEntree = (q: Readonly<EntreesQuantifiees>): number =>
  ((((((q.accel + 127) * 255 + (q.direction + 127)) * 255 + (q.tangage + 127)) * 255 + (q.lacet + 127)) * 255 + (q.roulis + 127)) * 8)
  + (q.saut ? 1 : 0) + (q.boost ? 2 : 0) + (q.derapage ? 4 : 0);
const poids = (t0: number, t: number, tau: number): number => Math.exp(-Math.max(0, t - t0) / tau);
/**
 * Constante de temps (ms) du glissement d'une correction : celle de ma voiture, des autres voitures ou de la balle, allongée pour une grande correction
 * (jusqu'à `lissageFacteurGrandeCorrection` fois, progressivement entre `lissageGrandeCorrectionM` et le double) : la vitesse du glissement,
 * écart / constante de temps, reste supportable. Purement visuel.
 */
const tauLissage = (base: number, ecartM: number): number => {
  const g = RESEAU.lissageGrandeCorrectionM;
  const k = ecartM <= g ? 0 : Math.min(1, (ecartM - g) / g);
  return base * 1000 * (1 + (RESEAU.lissageFacteurGrandeCorrection - 1) * k);
};
const sous = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const distance = (a: Readonly<Vec3>, b: Readonly<Vec3>): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const copierVec = (a: Readonly<Vec3>): Vec3 => [a[0], a[1], a[2]];

export function creerPredicteur(opts: OptionsPredicteurEtendu): PredicteurRocket {
  const { horloge, debut } = opts;
  const moi = debut.moi;
  const numero = debut.numero & 255;
  const monde = creerMondeEnLigne(debut.config, debut.voitures, moi, opts.arene);
  const n = monde.voitures.length;
  const chrono = opts.chrono ?? (typeof performance !== "undefined" ? () => performance.now() : () => 0);

  // ---- historique des entrées locales (anneau de 512 ticks, écriture UNIQUE par tick) ----
  const histTicks = new Int32Array(RESEAU.historiqueEntrees).fill(-1);
  const histVal: (EntreeLocale | null)[] = new Array(RESEAU.historiqueEntrees).fill(null);
  /** plus grand tick écrit, début du bloc contigu qui s'y termine */
  let histMax = -1;
  let debutContigu = 0;
  const histLire = (k: number): EntreeLocale | null => (k >= 0 && histTicks[k & MASQUE_HISTORIQUE] === k ? histVal[k & MASQUE_HISTORIQUE] : null);
  const histEcrire = (k: number, e: EntreeLocale): void => {
    if (k < 0 || histLire(k)) return;
    histTicks[k & MASQUE_HISTORIQUE] = k;
    histVal[k & MASQUE_HISTORIQUE] = e;
    if (k > histMax) {
      if (k !== histMax + 1) debutContigu = k;
      histMax = k;
    }
  };

  // ---- entrées connues des autres voitures (répétées pendant la prédiction et le rejeu) ----
  // `autresQ` / `autresR` : dernière entrée connue de chaque autre voiture (tenue au-delà de l'horizon connu). `futTick` / `futVal` : entrées VRAIES
  // des ticks déjà reçus par le serveur au moment de l'instantané (`snap.futurs`), par tick exact : le rejeu les utilise, l'extrapolation ne
  // commence qu'après le dernier tick connu. `utilise` : code de l'entrée réellement jouée pour chaque voiture à chaque tick (anneau), de quoi
  // savoir qu'un instantané EXACT à son tick apporte pourtant une information qui change la fin de la fenêtre (entrées futures différentes).
  const FUTURS = 64;
  const USAGES = 256;
  const autresQ: EntreesQuantifiees[] = monde.voitures.map(() => ENTREES_QUANTIFIEES_NULLES());
  const autresR: EntreesVoiture[] = monde.voitures.map(() => dequantifierEntrees(ENTREES_QUANTIFIEES_NULLES()));
  const autresCode: number[] = monde.voitures.map(() => codeEntree(ENTREES_QUANTIFIEES_NULLES()));
  const futTick: Int32Array[] = monde.voitures.map(() => new Int32Array(FUTURS).fill(-1));
  const futVal: (EntreesVoiture | null)[][] = monde.voitures.map(() => new Array<EntreesVoiture | null>(FUTURS).fill(null));
  const futCode: Float64Array[] = monde.voitures.map(() => new Float64Array(FUTURS));
  const utilise = new Float64Array(USAGES * n).fill(-1);
  const entreesPas: EntreesVoiture[] = monde.voitures.map(() => autresR[0]);
  const memoriserAutres = (snap: SnapRocket): void => {
    for (let i = 0; i < n; i++) {
      if (i === moi) continue;
      const q = snap.entrees[i];
      if (q && !entreesQuantifieesEgales(q, autresQ[i])) {
        autresQ[i] = { ...q };
        autresR[i] = dequantifierEntrees(q);
        autresCode[i] = codeEntree(q);
      }
      const fut = snap.futurs?.[i];
      if (!fut || fut.length === 0) continue;
      const nb = Math.min(fut.length, FUTURS);
      for (let k = 0; k < nb; k++) {
        const t = snap.tick + k, sl = t & (FUTURS - 1);
        const q2 = fut[k];
        futTick[i][sl] = t;
        futCode[i][sl] = codeEntree(q2);
        // les entrées consécutives identiques partagent le même objet réel
        const prec = k > 0 ? futVal[i][(t - 1) & (FUTURS - 1)] : null;
        futVal[i][sl] = k > 0 && prec && entreesQuantifieesEgales(q2, fut[k - 1]) ? prec : dequantifierEntrees(q2);
      }
      const dernier = fut[nb - 1];
      if (!entreesQuantifieesEgales(dernier, autresQ[i])) {
        autresQ[i] = { ...dernier };
        autresR[i] = futVal[i][(snap.tick + nb - 1) & (FUTURS - 1)] as EntreesVoiture;
        autresCode[i] = codeEntree(dernier);
      }
    }
  };
  /** Vrai si, pour un tick de [debut, fin), l'entrée connue d'une autre voiture n'est pas celle qui a été jouée dans la prédiction. */
  const autresEntreesChangees = (debut: number, fin: number): boolean => {
    for (let k = Math.max(debut, fin - USAGES + 1); k < fin; k++) {
      const sl = k & (FUTURS - 1);
      for (let i = 0; i < n; i++) {
        if (i === moi) continue;
        const connu = futTick[i][sl] === k ? futCode[i][sl] : autresCode[i];
        if (utilise[(k & (USAGES - 1)) * n + i] !== connu) return true;
      }
    }
    return false;
  };

  // ---- anneau d'états encodés, indexé par tick EXACT (multiples de cadenceSnapTicks) ----
  const anneauTicks = new Int32Array(ANNEAU_ETATS).fill(-1);
  const anneauOctets: (Uint8Array | null)[] = new Array(ANNEAU_ETATS).fill(null);
  const indexAnneau = (tick: number): number => (tick / RESEAU.cadenceSnapTicks) % ANNEAU_ETATS;
  const anneauEcrire = (tick: number, octets: Uint8Array): void => {
    // un instantané hors grille (événement important) n'a pas de case : l'indice fractionnaire créerait une propriété parasite sur le tableau
    if (tick % RESEAU.cadenceSnapTicks !== 0) return;
    const i = indexAnneau(tick);
    anneauTicks[i] = tick;
    anneauOctets[i] = octets;
  };
  const anneauLire = (tick: number): Uint8Array | null => {
    if (tick % RESEAU.cadenceSnapTicks !== 0) return null;
    const i = indexAnneau(tick);
    return anneauTicks[i] === tick ? anneauOctets[i] : null;
  };
  const anneauVider = (): void => {
    anneauTicks.fill(-1);
    anneauOctets.fill(null);
  };
  const noterEtatCourant = (): void => {
    if (monde.tick % RESEAU.cadenceSnapTicks === 0) anneauEcrire(monde.tick, encoderEtat(extraireEtat(monde)));
  };

  // ---- instantanés ----
  let enAttente: SnapRocket | null = null;
  let auth: EtatMondeReseau | null = null;
  let appliquee = false;
  let recu = false;
  let tickRecu = -1;
  let tickApplique = -1;

  // ---- événements ----
  let hautEmis = -1;
  let dernierTickEv = -1;
  /** événements déjà acceptés au tick `dernierTickEv` (un message `ev` renvoyé à l'identique ne rejoue rien) */
  let vusAuDernierTick: string[] = [];
  const locaux: { tick: number; e: EvenementMatch }[] = [];
  /** confirmations venues du serveur (garde de phase) */
  const butsRecus: { tick: number; equipe: Equipe }[] = [];
  const demolitionsRecues: { tick: number; victime: number }[] = [];
  const reapparitionsRecues: { tick: number; id: number }[] = [];
  let finRecue = false;

  // ---- affichage ----
  const lissageVoitures: (Lissage | null)[] = monde.voitures.map(() => null);
  let lissageBalle: LissageBalle | null = null;
  const poseValide: { p: Vec3; base: Base }[] = monde.voitures.map((v) => ({
    p: copierVec(v.p), base: { avant: copierVec(v.base.avant), droite: copierVec(v.base.droite), haut: copierVec(v.base.haut) },
  }));
  let version = 0;
  let cacheAffiche: { t: number; v: number; monde: MondeRocket } | null = null;

  // ---- état de la cadence et de l'envoi ----
  let reste = 0;
  let courante: EntreeLocale = { q: ENTREES_QUANTIFIEES_NULLES(), r: dequantifierEntrees(ENTREES_QUANTIFIEES_NULLES()) };
  let dernierEnvoye = -1;
  let tEnvoi = -Infinity;

  // ---- statistiques ----
  const st = {
    conservations: 0, rollbacks: 0, snapsExacts: 0, sommeProfondeur: 0, profondeurMax: 0, ecartMaxM: 0, resyncs: 0, dernierRollbackMs: 0, maxRollbackMs: 0,
  };

  /** (fonction, pour que TypeScript ne fige pas la phase : elle change pendant les boucles de pas) */
  const estFini = (): boolean => monde.phase === "fini";

  const evenementLocal = (e: EvenementMatch): boolean => TYPES_LOCAUX.has(e.t) && (e as { idVoiture?: number }).idVoiture === moi;

  const noterPoseValide = (): void => {
    for (let i = 0; i < n; i++) {
      const v = monde.voitures[i];
      if (v.demolie) continue;
      const pv = poseValide[i];
      affecter(pv.p, v.p);
      affecter(pv.base.avant, v.base.avant); affecter(pv.base.droite, v.base.droite); affecter(pv.base.haut, v.base.haut);
    }
  };

  /** Un pas de la physique au tick courant. Entrée locale : celle de l'historique à ce tick, sinon `fallback` (écrite : écriture unique). */
  const unPas = (fallback: EntreeLocale, resultat: ResultatAvance | null): void => {
    const k = monde.tick;
    let e = histLire(k);
    if (!e) { histEcrire(k, fallback); e = fallback; }
    for (let i = 0; i < n; i++) {
      if (i === moi) { entreesPas[i] = e.r; continue; }
      const sl = k & (FUTURS - 1);
      const connue = futTick[i][sl] === k;
      entreesPas[i] = connue ? (futVal[i][sl] as EntreesVoiture) : autresR[i];
      utilise[(k & (USAGES - 1)) * n + i] = connue ? futCode[i][sl] : autresCode[i];
    }
    const ev = pasMonde(monde, entreesPas, PAS_S);
    if (resultat && k > hautEmis) {
      hautEmis = k;
      for (const x of ev) {
        if (!evenementLocal(x)) continue;
        resultat.evenementsLocaux.push(x);
        locaux.push({ tick: k, e: x });
      }
    }
    noterEtatCourant();
  };

  const capturerAffichage = (t: number): { voitures: Affichage[]; balleBrut: Vec3; balleAff: Vec3 } => {
    const voitures: Affichage[] = monde.voitures.map((v, i) => {
      const l = lissageVoitures[i];
      const w = l ? poids(l.t0, t, l.tau) : 0;
      const pAff: Vec3 = l ? [v.p[0] + l.dp[0] * w, v.p[1] + l.dp[1] * w, v.p[2] + l.dp[2] * w] : copierVec(v.p);
      const b = { avant: copierVec(v.base.avant), droite: copierVec(v.base.droite), haut: copierVec(v.base.haut) };
      if (l) {
        for (let c = 0; c < 3; c++) { b.avant[c] += l.dAvant[c] * w; b.haut[c] += l.dHaut[c] * w; }
        reorthonormaliser(b);
      }
      return { pBrut: copierVec(v.p), pAff, avantAff: b.avant, hautAff: b.haut, demolie: v.demolie };
    });
    const wb = lissageBalle ? poids(lissageBalle.t0, t, lissageBalle.tau) : 0;
    const balleAff: Vec3 = lissageBalle
      ? [monde.balle.p[0] + lissageBalle.dp[0] * wb, monde.balle.p[1] + lissageBalle.dp[1] * wb, monde.balle.p[2] + lissageBalle.dp[2] * wb]
      : copierVec(monde.balle.p);
    return { voitures, balleBrut: copierVec(monde.balle.p), balleAff };
  };

  /** Compare l'affichage d'avant le rollback au monde recalculé : écart brut (m) et nouveaux décalages de lissage. */
  const recalculerLissage = (avant: ReturnType<typeof capturerAffichage>, t: number, lisser: boolean): EcartsSnap => {
    let ecartMax = 0, ecartMoi = 0, ecartAdv = 0;
    for (let i = 0; i < n; i++) {
      const v = monde.voitures[i], a = avant.voitures[i];
      const brut = distance(a.pBrut, v.p);
      if (!a.demolie && !v.demolie) {
        if (brut > ecartMax) ecartMax = brut;
        if (i === moi) ecartMoi = brut; else if (brut > ecartAdv) ecartAdv = brut;
      }
      lissageVoitures[i] = null;
      if (!lisser || a.demolie || v.demolie) continue;
      const dp = sous(a.pAff, v.p);
      if (norme(dp) > RESEAU.seuilTeleportVoitureM) continue;
      const dAvant = sous(a.avantAff, v.base.avant), dHaut = sous(a.hautAff, v.base.haut);
      if (norme(dp) < EPS_LISSAGE && norme(dAvant) < EPS_LISSAGE && norme(dHaut) < EPS_LISSAGE) continue;
      lissageVoitures[i] = { dp, dAvant, dHaut, t0: t, tau: tauLissage(i === moi ? RESEAU.lissageTauS : RESEAU.lissageTauAutresS, norme(dp)) };
    }
    const brutBalle = distance(avant.balleBrut, monde.balle.p);
    if (brutBalle > ecartMax) ecartMax = brutBalle;
    lissageBalle = null;
    if (lisser) {
      const dp = sous(avant.balleAff, monde.balle.p);
      if (norme(dp) >= EPS_LISSAGE && norme(dp) <= RESEAU.seuilTeleportBalleM) lissageBalle = { dp, t0: t, tau: tauLissage(RESEAU.lissageTauBalleS, norme(dp)) };
    }
    return { max: ecartMax, moi: ecartMoi, adversaires: ecartAdv, balle: brutBalle };
  };

  /**
   * Applique l'instantané en attente : test d'exactitude, sinon rollback (rejeu jusqu'au tick local) ou adoption franche de l'état serveur
   * suivie d'un rattrapage jusqu'au tick cible (premier instantané, client en retard, profondeur excessive).
   */
  const appliquerSnap = (snap: SnapRocket, t: number): ResultatSnap => {
    const N = snap.tick;
    const tickLocal = monde.tick;
    let etatSnap = snap.etat;
    let octetsServeur = snap.octetsEtat ?? encoderEtat(snap.etat);
    // Fenêtre d'entrées manquantes : le serveur a joué MA voiture avec une entrée répétée, pas la mienne (retard ou rafale de retransmission TCP).
    // Son état pour ma voiture est faux jusqu'au rejeu serveur (qui corrige les instantanés suivants) : je garde ma voiture prédite, le reste
    // vient du serveur. Si le rejeu n'a pas lieu (hors fenêtre), le premier instantané sans manquée ramène l'état autoritaire.
    if (RESEAU.conservationManquees && appliquee && snap.manquees > 0) {
      const attendu = anneauLire(N);
      const predit = attendu ? decoderEtat(attendu) : null;
      const srv = snap.etat.voitures[moi], moiPredit = predit?.voitures[moi];
      if (predit && moiPredit && srv && !srv.demolie && !moiPredit.demolie && predit.phase === snap.etat.phase
        && predit.score.bleue === snap.etat.score.bleue && predit.score.orange === snap.etat.score.orange) {
        const interne = { ...snap.etat.interne };
        for (const cle of ["touchePoints", "toucheEvenement", "dernierArret", "dernierTir"] as const) {
          const tab = interne[cle].slice();
          tab[moi] = predit.interne[cle][moi];
          interne[cle] = tab;
        }
        etatSnap = { ...snap.etat, voitures: snap.etat.voitures.map((v, i) => (i === moi ? moiPredit : v)), interne };
        octetsServeur = encoderEtat(etatSnap);
        st.conservations++;
      }
    }
    const rollbackPossible = appliquee && tickLocal >= N && tickLocal - N <= RESEAU.profondeurMaxRollback;
    const premiere = !appliquee;
    const debutMs = chrono();

    if (rollbackPossible) {
      const attendu = anneauLire(N);
      if (attendu && octetsEtatEgaux(attendu, octetsServeur)) {
        // État prédit identique à celui du serveur : seules les entrées des autres sont mises à jour. Si ce qu'on sait maintenant des entrées
        // des autres (entrées futures, dernière entrée) n'est pas ce que la prédiction a joué entre N et le tick local, on rejoue quand même.
        memoriserAutres(snap);
        if (!autresEntreesChangees(N, tickLocal)) {
          tickApplique = N;
          st.snapsExacts++;
          return { rollback: false, profondeur: 0, ecartM: 0, resync: false };
        }
      }
      const avant = capturerAffichage(t);
      restaurerEtat(etatSnap, monde);
      memoriserAutres(snap);
      anneauEcrire(N, octetsServeur);
      for (let k = N; k < tickLocal && !estFini(); k++) unPas(courante, null);
      noterPoseValide();
      const profondeur = tickLocal - N;
      const ec = recalculerLissage(avant, t, monde.tick === tickLocal);
      const ecartM = ec.max;
      tickApplique = N;
      st.rollbacks++;
      st.sommeProfondeur += profondeur;
      if (profondeur > st.profondeurMax) st.profondeurMax = profondeur;
      if (ecartM > st.ecartMaxM) st.ecartMaxM = ecartM;
      st.dernierRollbackMs = chrono() - debutMs;
      if (st.dernierRollbackMs > st.maxRollbackMs) st.maxRollbackMs = st.dernierRollbackMs;
      return { rollback: true, profondeur, ecartM, resync: false, ecartMoiM: ec.moi, ecartAutresM: ec.adversaires, ecartBalleM: ec.balle };
    }

    // Adoption franche : l'état serveur remplace le monde, puis rattrapage jusqu'au tick cible (au plus `profondeurMaxRollback` pas).
    const avant = capturerAffichage(t);
    restaurerEtat(snap.etat, monde);
    memoriserAutres(snap);
    anneauVider();
    anneauEcrire(N, octetsServeur);
    const cible = horloge.tickCible(t);
    const but = Number.isFinite(cible) ? Math.max(N, Math.min(Math.round(cible), N + RESEAU.profondeurMaxRollback)) : N;
    let pasRattrapes = 0;
    for (let k = N; k < but && !estFini(); k++) { unPas(courante, null); pasRattrapes++; }
    noterPoseValide();
    const ecartM = recalculerLissage(avant, t, false).max;
    if (!premiere && ecartM > st.ecartMaxM) st.ecartMaxM = ecartM;
    appliquee = true;
    tickApplique = N;
    reste = 0;
    if (hautEmis < monde.tick - 1) hautEmis = monde.tick - 1;
    if (!premiere) st.resyncs++;
    return { rollback: false, profondeur: pasRattrapes, ecartM, resync: true };
  };

  // ---- garde de phase et assemblage du monde affiché ----
  const butsConfirmes = (): Record<Equipe, number> => {
    const a = auth as EtatMondeReseau;
    const s = { bleue: a.score.bleue, orange: a.score.orange };
    for (const b of butsRecus) if (b.tick >= a.tick) s[b.equipe]++;
    return s;
  };

  const demolitionConfirmee = (i: number): boolean => {
    const a = auth as EtatMondeReseau;
    if (a.voitures[i]?.demolie) return true;
    let dernier = -1;
    for (const d of demolitionsRecues) if (d.victime === i && d.tick >= a.tick && d.tick > dernier) dernier = d.tick;
    if (dernier < 0) return false;
    for (const r of reapparitionsRecues) if (r.id === i && r.tick > dernier) return false;
    return true;
  };

  const calculerAffiche = (t: number): MondeRocket => {
    const P = monde;
    const A = auth;
    let voituresAff: MondeRocket["voitures"] | null = null;
    let precVoitures: MondeRocket["precedent"]["voitures"] | null = null;
    for (let i = 0; i < n; i++) {
      const v = P.voitures[i];
      const l = lissageVoitures[i];
      const w = l ? poids(l.t0, t, l.tau) : 0;
      const decale = !!l && w > POIDS_MIN;
      const faux = A !== null && v.demolie && !demolitionConfirmee(i);
      if (!decale && !faux) continue;
      if (!voituresAff) { voituresAff = P.voitures.slice(); precVoitures = P.precedent.voitures.slice(); }
      const pr = P.precedent.voitures[i];
      if (faux) {
        // Démolition décidée par la seule prédiction : la voiture reste affichée à sa dernière pose valide.
        const pv = poseValide[i];
        voituresAff[i] = { ...v, demolie: false, p: copierVec(pv.p), base: { avant: copierVec(pv.base.avant), droite: copierVec(pv.base.droite), haut: copierVec(pv.base.haut) } };
        (precVoitures as typeof pr[])[i] = { p: copierVec(pv.p), base: { avant: copierVec(pv.base.avant), droite: copierVec(pv.base.droite), haut: copierVec(pv.base.haut) } };
        continue;
      }
      const l2 = l as Lissage;
      const decaler = (p: Readonly<Vec3>): Vec3 => [p[0] + l2.dp[0] * w, p[1] + l2.dp[1] * w, p[2] + l2.dp[2] * w];
      const basee = (b: Readonly<Base>): Base => {
        const r = { avant: copierVec(b.avant), droite: copierVec(b.droite), haut: copierVec(b.haut) };
        for (let c = 0; c < 3; c++) { r.avant[c] += l2.dAvant[c] * w; r.haut[c] += l2.dHaut[c] * w; }
        return reorthonormaliser(r);
      };
      voituresAff[i] = { ...v, p: decaler(v.p), base: basee(v.base) };
      (precVoitures as typeof pr[])[i] = { p: decaler(pr.p), base: basee(pr.base) };
    }

    let balleAff: MondeRocket["balle"] | null = null;
    let precBalle: Vec3 | null = null;
    if (lissageBalle) {
      const w = poids(lissageBalle.t0, t, lissageBalle.tau);
      if (w > POIDS_MIN) {
        const d = lissageBalle.dp;
        balleAff = { ...P.balle, p: [P.balle.p[0] + d[0] * w, P.balle.p[1] + d[1] * w, P.balle.p[2] + d[2] * w] };
        precBalle = [P.precedent.balle.p[0] + d[0] * w, P.precedent.balle.p[1] + d[1] * w, P.precedent.balle.p[2] + d[2] * w];
      }
    }

    // But / fin décidés par la seule prédiction : le score, la phase et le vainqueur affichés suivent l'état autoritaire et les événements serveur.
    let phase = P.phase, score = P.score, vainqueur = P.vainqueur, dernierBut = P.dernierBut;
    let garde = false;
    if (A) {
      const conf = butsConfirmes();
      const butsPrevus = P.score.bleue + P.score.orange;
      if (P.score.bleue > conf.bleue || P.score.orange > conf.orange) {
        score = { bleue: Math.min(P.score.bleue, conf.bleue), orange: Math.min(P.score.orange, conf.orange) };
        garde = true;
      }
      const repli = A.phase === "but" || A.phase === "fini" ? "enJeu" : A.phase;
      if (P.phase === "but" && butsPrevus > conf.bleue + conf.orange) {
        phase = repli;
        dernierBut = null;
        garde = true;
      } else if (P.phase === "fini" && A.phase !== "fini" && !finRecue) {
        phase = repli;
        vainqueur = null;
        garde = true;
      }
    }

    if (!voituresAff && !balleAff && !garde) return P;
    return {
      ...P,
      phase, score, vainqueur, dernierBut,
      voitures: voituresAff ?? P.voitures,
      balle: balleAff ?? P.balle,
      precedent: {
        voitures: precVoitures ?? P.precedent.voitures,
        balle: precBalle ? { p: precBalle } : P.precedent.balle,
      },
    };
  };

  // ---- interface ----
  const predicteur: PredicteurRocket = {
    get monde(): MondeRocket { return monde; },
    get pret(): boolean { return recu; },

    recevoirSnap(snap: SnapRocket, maintenantMs: number): boolean {
      if (snap.numero !== numero || snap.nbVoitures !== n || snap.etat.voitures.length !== n) return false;
      if (snap.tick <= Math.max(tickApplique, enAttente ? enAttente.tick : -1)) return false;
      horloge.echantillonSnap(snap.tick, maintenantMs, snap.ralenti);
      horloge.signalerAvance(snap.avance, snap.manquees);
      enAttente = snap;
      auth = snap.etat;
      tickRecu = snap.tick;
      recu = true;
      version++;
      return true;
    },

    avancer(dtReelS: number, entrees: Readonly<EntreesVoiture>, maintenantMs: number): ResultatAvance {
      version++;
      const resultat: ResultatAvance = { pas: 0, alpha: 0, evenementsLocaux: [], snap: null };
      const q = quantifierEntrees(entrees);
      courante = { q, r: dequantifierEntrees(q) };

      if (enAttente) {
        const snap = enAttente;
        enAttente = null;
        resultat.snap = appliquerSnap(snap, maintenantMs);
      }
      if (!appliquee) return resultat;
      // Plus aucun pas ne court en phase « fini » (le serveur s'arrête aussi) : ni cadence ni resynchronisation.
      if (estFini()) { resultat.alpha = 0; return resultat; }

      const dt = Math.min(Math.max(Number.isFinite(dtReelS) ? dtReelS : 0, 0), RESEAU.imageMaxEnLigneS);
      const cadence = horloge.cadence(monde.tick, maintenantMs);

      if (cadence.resync === "avant") {
        // Client en retard (onglet masqué, image très longue) : rattrapage unique jusqu'au tick cible avec l'entrée courante tenue. Identique à
        // un rejeu depuis le dernier instantané (la simulation est déterministe et l'historique garde les ticks déjà joués).
        const cible = Math.round(horloge.tickCible(maintenantMs));
        const nb = Math.min(cible - monde.tick, RESEAU.profondeurMaxRollback);
        if (nb > 0) {
          for (let i = 0; i < nb && !estFini(); i++) unPas(courante, null);
          noterPoseValide();
          reste = 0;
          st.resyncs++;
        }
      }

      if (cadence.facteur > 0 && !estFini()) {
        reste += dt * cadence.facteur;
        let pas = Math.floor(reste / PAS_S + 1e-9);
        reste -= pas * PAS_S;
        if (pas > RESEAU.pasMaxParImageEnLigne) { pas = RESEAU.pasMaxParImageEnLigne; reste = 0; }
        if (reste < 0) reste = 0;
        for (let i = 0; i < pas && !estFini(); i++) { unPas(courante, resultat); resultat.pas++; }
        if (pas > 0) noterPoseValide();
      }
      resultat.alpha = Math.min(reste / PAS_S, 1);

      // Oublier les événements locaux jamais confirmés depuis longtemps.
      while (locaux.length > 0 && locaux[0].tick < monde.tick - OUBLI_LOCAUX_TICKS) locaux.shift();
      return resultat;
    },

    trameAEnvoyer(maintenantMs: number): TrameEntrees | null {
      if (histMax < 0 || histMax <= dernierEnvoye) return null;
      if (maintenantMs - tEnvoi < RESEAU.intervalleTrameEntreesMs) return null;
      const fin = histMax;
      const debutNeuf = Math.max(dernierEnvoye + 1, debutContigu);
      let debutTrame = Math.max(debutNeuf - RESEAU.redondanceEntrees, debutContigu, 0);
      // Une trame est un bloc contigu terminé au tick le plus récent : au plus `entreesMaxParTrame` ticks.
      debutTrame = Math.max(debutTrame, fin - RESEAU.entreesMaxParTrame + 1);
      const liste: EntreesQuantifiees[] = [];
      for (let k = debutTrame; k <= fin; k++) {
        const e = histLire(k);
        if (!e) return null;
        liste.push({ ...e.q });
      }
      dernierEnvoye = fin;
      tEnvoi = maintenantMs;
      return { numero, tickDebut: debutTrame, snapRecu: Math.max(tickRecu, 0), entrees: liste };
    },

    filtrerEvenements(evenements: readonly { tick: number; e: EvenementMatch }[]): EvenementMatch[] {
      version++;
      const sortie: EvenementMatch[] = [];
      for (const { tick, e } of evenements) {
        // Confirmations pour la garde de phase (même pour un événement écarté ensuite).
        if (e.t === "but") { butsRecus.push({ tick, equipe: e.equipe }); if (butsRecus.length > 16) butsRecus.shift(); }
        else if (e.t === "demolition") { demolitionsRecues.push({ tick, victime: e.victime }); if (demolitionsRecues.length > 16) demolitionsRecues.shift(); }
        else if (e.t === "reapparition") { reapparitionsRecues.push({ tick, id: e.idVoiture }); if (reapparitionsRecues.length > 16) reapparitionsRecues.shift(); }
        else if (e.t === "fin") finRecue = true;

        if (tick < dernierTickEv) continue;
        const cle = JSON.stringify(e);
        if (tick === dernierTickEv) {
          if (vusAuDernierTick.includes(cle)) continue;
          vusAuDernierTick.push(cle);
        } else {
          dernierTickEv = tick;
          vusAuDernierTick = [cle];
        }
        if (evenementLocal(e)) {
          const idx = locaux.findIndex((l) => Math.abs(l.tick - tick) <= APPARIEMENT_TICKS && memeEvenement(l.e, e));
          if (idx >= 0) { locaux.splice(idx, 1); continue; }
        }
        sortie.push(e);
      }
      return sortie;
    },

    mondeAffiche(maintenantMs: number): MondeRocket {
      if (cacheAffiche && cacheAffiche.t === maintenantMs && cacheAffiche.v === version) return cacheAffiche.monde;
      const m = calculerAffiche(maintenantMs);
      cacheAffiche = { t: maintenantMs, v: version, monde: m };
      return m;
    },

    etatAutoritaire(): EtatMondeReseau | null {
      return auth;
    },

    stats(): StatsPrediction {
      return {
        tickLocal: monde.tick,
        tickSnap: tickRecu,
        rollbacks: st.rollbacks,
        snapsExacts: st.snapsExacts,
        profondeurMoyenne: st.rollbacks > 0 ? st.sommeProfondeur / st.rollbacks : 0,
        profondeurMax: st.profondeurMax,
        ecartMaxM: st.ecartMaxM,
        resyncs: st.resyncs,
        conservations: st.conservations,
        dernierRollbackMs: st.dernierRollbackMs,
        maxRollbackMs: st.maxRollbackMs,
      };
    },
  };
  return predicteur;
}

/** Deux événements de voiture sont « le même » : même type, même voiture, et même sens pour un événement d'état (boost, supersonique). */
function memeEvenement(a: EvenementMatch, b: EvenementMatch): boolean {
  if (a.t !== b.t) return false;
  if ((a.t === "boost" || a.t === "supersonique") && b.t === a.t) return a.actif === b.actif;
  return true;
}
