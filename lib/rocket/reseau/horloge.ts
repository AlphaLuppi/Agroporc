/**
 * Rocket Muche en ligne : horloge de synchronisation du client (PUR : l'heure locale est toujours un argument, aucune horloge globale).
 * Spec § 5.1. Le client joue en AVANCE sur le serveur de (demi-RTT + marge) pour que ses entrées arrivent avant d'être exécutées.
 *
 *  - RTT filtré = minimum des `RESEAU.mesuresRtt` dernières mesures (optimiste sous gigue) ; gigue = écart moyen absolu des `mesuresGigue` dernières.
 *  - Tick du serveur : chaque pong (tick fractionnaire) et chaque instantané est un échantillon « tick du serveur à la réception » ; on garde,
 *    sur une fenêtre glissante de `fenetreEchantillonsMs`, celui qui est le moins retardé par le réseau (le plus grand décalage tick − temps).
 *  - Marge adaptative : grandit dès que le serveur a dû répéter des entrées (`manquees`) ou qu'une entrée est arrivée trop près de son tick
 *    (`avance` faible), décroît très lentement ; plancher = 2 × gigue en ticks. Le retour du serveur décrit la marge d'il y a un aller-retour
 *    et la cadence ne rattrape une marge neuve qu'à ±5 % : pour que la régulation ne s'emballe pas (mesuré : 4 -> 19 ticks en 0,5 s au démarrage),
 *    la croissance est ignorée tant que le client court après sa cible (écart connu par `cadence`) et pendant un RTT après chaque croissance.
 *  - Cadence : facteur 1 ± 5 % pour rattraper doucement l'écart ; au-delà de `resyncEcartTicks`, resynchronisation franche demandée
 *    (« avant » : le client est en retard ; « arriere » : il est en avance, il attend, il ne recule jamais).
 *
 * L'échelle de cadence du monde (ralenti de la célébration, `RESEAU.echelleCelebration`, 1 en v1) est lue au moment de chaque échantillon : si elle
 * change, la fenêtre est vidée mais l'ancienne référence est gardée jusqu'au premier nouvel échantillon (jamais de NaN une fois calée).
 */
import type { HorlogeRocket } from "./protocole";
import { AVANCE_INCONNUE, RESEAU, TICKS_PAR_S } from "./protocole";

/** le client est considéré comme « encore en train de rattraper sa cible » au-delà de cet écart (ticks) */
const SEUIL_RATTRAPAGE_TICKS = 1.5;
/** ticks par milliseconde à l'échelle 1 (0,12) */
const TICKS_PAR_MS = TICKS_PAR_S / 1000;

interface Echantillon {
  /** tick du serveur extrapolé à l'instant local 0 (décalage constant tant que l'échelle ne change pas) : plus il est grand, moins l'échantillon est retardé */
  decalage: number;
  recuMs: number;
}

interface Reference {
  tick: number;
  recuMs: number;
  /** échelle de cadence du monde à laquelle la référence a été prise */
  echelle: number;
}

const borne = (x: number, min: number, max: number): number => (x < min ? min : x > max ? max : x);

/** Échelle de cadence du monde pour un instantané ou un pong : 1, ou celle de la célébration si le serveur la signale (garde-fou : strictement positive). */
function echelleDe(ralenti: boolean): number {
  const e = ralenti ? RESEAU.echelleCelebration : 1;
  return Number.isFinite(e) && e > 0 ? e : 1;
}

export function creerHorloge(): HorlogeRocket {
  let rtts: number[] = [];
  let echantillons: Echantillon[] = [];
  let ref: Reference | null = null;
  let echelleFenetre = 1;
  let marge: number = RESEAU.margeInitialeTicks;
  let sansManquee = 0;
  /** dernier écart (cible - tick local) vu par `cadence` : tant que le client rattrape sa cible, le retour du serveur est périmé */
  let ecartCourant = 0;
  /** instantanés à ignorer après une croissance de la marge : le temps que ses effets reviennent par le réseau (≈ un RTT) */
  let gel = 0;

  const rttMs = (): number => {
    if (rtts.length === 0) return 0;
    let min = Infinity;
    const debut = Math.max(0, rtts.length - RESEAU.mesuresRtt);
    for (let i = debut; i < rtts.length; i++) if (rtts[i] < min) min = rtts[i];
    return min;
  };

  const gigueMs = (): number => {
    if (rtts.length < 2) return 0;
    let somme = 0;
    for (const r of rtts) somme += r;
    const moy = somme / rtts.length;
    let ecart = 0;
    for (const r of rtts) ecart += Math.abs(r - moy);
    return ecart / rtts.length;
  };

  const noterRtt = (ms: number): void => {
    if (!Number.isFinite(ms)) return;
    rtts.push(Math.max(0, ms));
    if (rtts.length > RESEAU.mesuresGigue) rtts.shift();
  };

  /** Tick du serveur estimé à l'instant local `t` d'après la référence courante (NaN avant tout échantillon). */
  const tickServeurEstime = (t: number): number => {
    if (!ref) return Number.NaN;
    return ref.tick + (t - ref.recuMs) * TICKS_PAR_MS * ref.echelle;
  };

  /** Ajoute « le tick du serveur était `tickRecu` à l'instant local `recuMs` » et recalcule la référence (échantillon le moins retardé de la fenêtre). */
  const ajouterEchantillon = (tickRecu: number, recuMs: number, ralenti: boolean): void => {
    if (!Number.isFinite(tickRecu) || !Number.isFinite(recuMs)) return;
    const echelle = echelleDe(ralenti);
    if (echelle !== echelleFenetre) {
      // La correspondance tick <-> temps change : la fenêtre n'a plus de sens. L'ancienne référence est prolongée à l'instant courant avec son
      // ancienne échelle et gardée telle quelle jusqu'au nouvel échantillon (ajouté juste après).
      if (ref) ref = { tick: tickServeurEstime(recuMs), recuMs, echelle: ref.echelle };
      echantillons = [];
      echelleFenetre = echelle;
    }
    const taux = TICKS_PAR_MS * echelle;
    echantillons.push({ decalage: tickRecu - recuMs * taux, recuMs });
    // Fenêtre glissante : retirer ce qui a plus de `fenetreEchantillonsMs` (par rapport à l'échantillon le plus récent).
    const limite = recuMs - RESEAU.fenetreEchantillonsMs;
    if (echantillons.length > 1 && echantillons[0].recuMs < limite) echantillons = echantillons.filter((e) => e.recuMs >= limite);
    let meilleur = echantillons[0];
    for (const e of echantillons) if (e.decalage > meilleur.decalage) meilleur = e;
    ref = { tick: meilleur.decalage + meilleur.recuMs * taux, recuMs: meilleur.recuMs, echelle };
  };

  const margeTicks = (): number => {
    const plancher = Math.ceil(RESEAU.margeGigueFacteur * gigueMs() * TICKS_PAR_MS - 1e-9);
    return borne(Math.max(marge, plancher), RESEAU.margeMinTicks, RESEAU.margeMaxTicks);
  };

  const tickCible = (maintenantMs: number): number => {
    const est = tickServeurEstime(maintenantMs);
    if (!Number.isFinite(est)) return Number.NaN;
    const echelle = ref ? ref.echelle : 1;
    const avance = (rttMs() / 2) * TICKS_PAR_MS * echelle + margeTicks();
    // L'avance totale reste sous la borne du serveur (`avanceMaxEntreesTicks`), avec une réserve de 8 ticks : un RTT énorme ne fait pas
    // rejeter en silence toutes les entrées.
    return est + Math.min(avance, RESEAU.avanceMaxEntreesTicks - 8);
  };

  return {
    reinitialiser(): void {
      rtts = [];
      echantillons = [];
      ref = null;
      echelleFenetre = 1;
      marge = RESEAU.margeInitialeTicks;
      sansManquee = 0;
      ecartCourant = 0;
      gel = 0;
    },

    echantillonPong(envoyeMs: number, recuMs: number, tickServeur: number, ralenti: boolean): void {
      if (!Number.isFinite(envoyeMs) || !Number.isFinite(recuMs)) return;
      const rtt = Math.max(0, recuMs - envoyeMs);
      noterRtt(rtt);
      // Salle hors phase « match » (chargement, salon) : le tick vaut -1, le RTT seul est utile.
      if (!(tickServeur >= 0)) return;
      // Le serveur a répondu environ rtt / 2 avant la réception : à la réception il a avancé d'autant. On suppose le RTT FILTRÉ (comme pour les
      // instantanés) et non celui de ce pong : l'asymétrie d'un seul aller-retour est du bruit que la sélection du « moins retardé » ferait
      // remonter ; avec le même délai supposé partout, un pong lent est simplement un échantillon retardé.
      ajouterEchantillon(tickServeur + (rttMs() / 2) * TICKS_PAR_MS * echelleDe(ralenti), recuMs, ralenti);
    },

    echantillonSnap(tickSnap: number, recuMs: number, ralenti: boolean): void {
      if (!(tickSnap >= 0)) return;
      ajouterEchantillon(tickSnap + (rttMs() / 2) * TICKS_PAR_MS * echelleDe(ralenti), recuMs, ralenti);
    },

    rttMs,
    gigueMs,
    tickServeurEstime,

    tickCible,

    signalerAvance(avance: number, manquees: number): void {
      // Aucune entrée n'est arrivée dans la fenêtre : aucune information (pas de marge à tirer de l'absence d'envoi, par exemple au démarrage).
      if (avance === AVANCE_INCONNUE || !Number.isFinite(avance)) return;
      // Boucle de régulation à retard : une marge qui vient de grandir ne se voit dans `avance` qu'après le temps de rattraper (cadence à ±5 %)
      // puis un aller-retour. Tant que le client court encore après sa cible, ou pendant ce délai, le retour décrit l'ancienne marge : y réagir
      // encore ferait grimper la marge bien au-delà du besoin (elle ne redescend que d'un tick toutes les 2 s).
      const enRetard = ecartCourant > SEUIL_RATTRAPAGE_TICKS;
      const gele = gel > 0;
      if (gele) gel--;
      if ((manquees > 0 || avance < RESEAU.avanceMinTicks) && (enRetard || gele)) { sansManquee = 0; return; }
      if (manquees > 0) {
        marge += manquees >= 4 ? 2 : 1;
        sansManquee = 0;
        gel = Math.ceil(rttMs() / ((RESEAU.cadenceSnapTicks / TICKS_PAR_MS)));
      } else if (avance < RESEAU.avanceMinTicks) {
        marge += 1;
        sansManquee = 0;
        gel = Math.ceil(rttMs() / ((RESEAU.cadenceSnapTicks / TICKS_PAR_MS)));
      } else if (avance > RESEAU.avanceMaxTicks) {
        sansManquee++;
        if (sansManquee >= RESEAU.margeDecroissanceSnaps) {
          marge -= 1;
          sansManquee = 0;
        }
      } else {
        sansManquee = 0;
      }
      marge = borne(marge, RESEAU.margeMinTicks, RESEAU.margeMaxTicks);
    },

    margeTicks,

    cadence(tickLocal: number, maintenantMs: number): { facteur: number; ecartTicks: number; resync: "avant" | "arriere" | null } {
      const cible = tickCible(maintenantMs);
      if (!Number.isFinite(cible) || !Number.isFinite(tickLocal)) { ecartCourant = 0; return { facteur: 1, ecartTicks: 0, resync: null }; }
      const ecart = cible - tickLocal;
      ecartCourant = ecart;
      const echelle = ref ? ref.echelle : 1;
      if (ecart > RESEAU.resyncEcartTicks) return { facteur: echelle, ecartTicks: ecart, resync: "avant" };
      // En avance de plus de 24 ticks : on attend, on ne recule jamais (les entrées de ces ticks sont déjà parties).
      if (ecart < -RESEAU.resyncEcartTicks) return { facteur: 0, ecartTicks: ecart, resync: "arriere" };
      return { facteur: echelle * (1 + borne(ecart * RESEAU.dilatationGainParTick, -RESEAU.dilatationMax, RESEAU.dilatationMax)), ecartTicks: ecart, resync: null };
    },
  };
}
