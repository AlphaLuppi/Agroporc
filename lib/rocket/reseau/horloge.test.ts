import { describe, expect, it } from "vitest";
import { creerHorloge } from "./horloge";
import { creerAlea } from "./outils-reseau";
import { AVANCE_INCONNUE, RESEAU, TICKS_PAR_S } from "./protocole";

const TPM = TICKS_PAR_S / 1000;
/** Tick du serveur à l'instant vrai `T` (ms) : le serveur démarre à T = 0. */
const tickServeur = (T: number, depart = 0): number => depart + T * TPM;

interface Options {
  latenceMs: number;
  gigueMs: number;
  dureeMs: number;
  /** décalage de l'horloge locale par rapport au temps vrai (ms) : l'horloge ne doit dépendre que de ses propres mesures */
  decalageLocalMs?: number;
  /** résolution de l'horloge locale (ms) : 100 simule `resistFingerprinting` */
  resolutionMs?: number;
  graine?: number;
}

/**
 * Rejoue un échange serveur / client : un instantané toutes les 50 ms (tick multiple de 6) et un ping toutes les 500 ms, avec latence et gigue
 * symétriques. `surEvenement(T)` est appelé après chaque réception (temps vrai T).
 */
function jouer(h: ReturnType<typeof creerHorloge>, o: Options, surEvenement: (T: number, local: number) => void): void {
  const alea = creerAlea(o.graine ?? 1);
  const delai = () => o.latenceMs + (alea() * 2 - 1) * o.gigueMs;
  const local = (T: number): number => {
    const t = T + (o.decalageLocalMs ?? 0);
    return o.resolutionMs ? Math.floor(t / o.resolutionMs) * o.resolutionMs : t;
  };
  type Ev = { T: number; f: () => void };
  const evs: Ev[] = [];
  for (let Ts = 0; Ts < o.dureeMs; Ts += 50) {
    const tick = Math.round(tickServeur(Ts));
    const Tr = Ts + delai();
    evs.push({ T: Tr, f: () => h.echantillonSnap(tick, local(Tr), false) });
  }
  for (let Tp = 0; Tp < o.dureeMs; Tp += 500) {
    const aller = delai(), retour = delai();
    const Ts = Tp + aller;
    const Tr = Ts + retour;
    const tick = tickServeur(Ts);
    evs.push({ T: Tr, f: () => h.echantillonPong(local(Tp), local(Tr), tick, false) });
  }
  evs.sort((a, b) => a.T - b.T);
  for (const e of evs) {
    e.f();
    surEvenement(e.T, local(e.T));
  }
}

describe("horloge : estimation du tick du serveur", () => {
  it("converge avec latence de 60 ms et gigue de ±20 ms (erreur moyenne ≤ 1,3 tick, pire cas ≤ 2 ticks, jamais en retard)", () => {
    // Le « moins retardé de la fenêtre » avec un RTT minimum sur 8 mesures est volontairement OPTIMISTE : le serveur est estimé un peu en
    // avance (≈ 1 tick), jamais en retard ; la marge adaptative (retour `avance`) absorbe ce biais.
    const h = creerHorloge();
    let pireErreur = 0, somme = 0, mesures = 0, enRetard = 0;
    jouer(h, { latenceMs: 60, gigueMs: 20, dureeMs: 20_000, decalageLocalMs: 123_456.7 }, (T, local) => {
      if (T < 4000) return;
      const err = h.tickServeurEstime(local) - tickServeur(T);
      pireErreur = Math.max(pireErreur, Math.abs(err));
      somme += Math.abs(err);
      if (err < -0.5) enRetard++;
      mesures++;
    });
    expect(mesures).toBeGreaterThan(200);
    expect(pireErreur).toBeLessThanOrEqual(2);
    expect(somme / mesures).toBeLessThanOrEqual(1.3);
    expect(enRetard).toBe(0);
  });

  it("converge aussi sans gigue, quelle que soit l'origine de l'horloge locale", () => {
    const h = creerHorloge();
    let dernier = NaN;
    jouer(h, { latenceMs: 40, gigueMs: 0, dureeMs: 5000, decalageLocalMs: -987_654 }, (T, local) => { dernier = h.tickServeurEstime(local) - tickServeur(T); });
    expect(Math.abs(dernier)).toBeLessThan(0.2); // sans gigue : exact à ±1/5 tick
  });

  it("NaN tant qu'aucun échantillon, puis fini", () => {
    const h = creerHorloge();
    expect(h.tickServeurEstime(1000)).toBeNaN();
    expect(h.tickCible(1000)).toBeNaN();
    h.echantillonSnap(600, 5000, false);
    expect(Number.isFinite(h.tickServeurEstime(5000))).toBe(true);
    expect(h.tickServeurEstime(5100)).toBeCloseTo(h.tickServeurEstime(5000) + 100 * TPM, 6);
  });

  it("le RTT filtré est le minimum des 8 dernières mesures, la gigue l'écart moyen absolu", () => {
    const h = creerHorloge();
    expect(h.rttMs()).toBe(0);
    expect(h.gigueMs()).toBe(0);
    const rtts = [100, 90, 140, 80, 120, 85, 200, 95, 110, 130];
    rtts.forEach((r, i) => h.echantillonPong(i * 500, i * 500 + r, -1, false));
    // minimum des 8 dernières : 140, 80, 120, 85, 200, 95, 110, 130
    expect(h.rttMs()).toBe(80);
    const moy = rtts.reduce((a, b) => a + b, 0) / rtts.length;
    const ecart = rtts.reduce((a, b) => a + Math.abs(b - moy), 0) / rtts.length;
    expect(h.gigueMs()).toBeCloseTo(ecart, 9);
  });

  it("un pong sans tick (salle hors phase match, -1) nourrit le RTT mais jamais l'estimation du tick", () => {
    const h = creerHorloge();
    h.echantillonPong(1000, 1080, -1, false);
    h.echantillonPong(2000, 2090, -1, false);
    expect(h.rttMs()).toBe(80);
    expect(h.tickServeurEstime(2100)).toBeNaN();
    expect(h.tickCible(2100)).toBeNaN();
    expect(h.cadence(0, 2100)).toEqual({ facteur: 1, ecartTicks: 0, resync: null });
    // un instantané avec tick < 0 est aussi ignoré
    h.echantillonSnap(-1, 2100, false);
    expect(h.tickServeurEstime(2100)).toBeNaN();
  });

  it("garde l'échantillon le moins retardé de la fenêtre et oublie les anciens", () => {
    const h = creerHorloge();
    // Échantillons cohérents avec un serveur à T * 0,12 ; un seul arrive « vite » (retard 10 ms), les autres avec 80 ms de plus.
    const echantillon = (T: number, retardMs: number) => h.echantillonSnap(Math.round(tickServeur(T - retardMs)), T, false);
    echantillon(1000, 90);
    echantillon(1100, 10);
    echantillon(1200, 90);
    echantillon(1300, 90);
    const meilleur = h.tickServeurEstime(1300);
    expect(Math.abs(meilleur - tickServeur(1300 - 10))).toBeLessThan(1);
    // 2,5 s plus tard, l'échantillon rapide est sorti de la fenêtre : l'estimation se rapproche des échantillons lents
    for (let T = 3400; T <= 3800; T += 100) echantillon(T, 90);
    expect(Math.abs(h.tickServeurEstime(3800) - tickServeur(3800 - 90))).toBeLessThan(1);
  });

  it("horloge locale grossière (100 ms) : ni NaN ni explosion, la marge plancher absorbe la gigue mesurée", () => {
    const h = creerHorloge();
    let ok = true;
    jouer(h, { latenceMs: 55, gigueMs: 5, dureeMs: 15_000, resolutionMs: 100 }, (_T, local) => {
      const c = h.tickCible(local);
      if (!Number.isFinite(c)) ok = ok && h.tickServeurEstime(local) !== h.tickServeurEstime(local); // NaN seulement avant le premier échantillon
    });
    expect(ok).toBe(true);
    expect(h.rttMs()).toBeGreaterThanOrEqual(0);
    expect(h.margeTicks()).toBeGreaterThanOrEqual(Math.ceil(2 * h.gigueMs() * TPM - 1e-9));
    expect(h.margeTicks()).toBeLessThanOrEqual(RESEAU.margeMaxTicks);
  });

  it("tickCible = estimé + demi-RTT + marge, avance plafonnée sous la borne du serveur", () => {
    const h = creerHorloge();
    h.echantillonPong(1000, 1100, 500, false); // rtt 100 ms
    const est = h.tickServeurEstime(1100);
    expect(h.tickCible(1100)).toBeCloseTo(est + 50 * TPM + h.margeTicks(), 6);
    const h2 = creerHorloge();
    h2.echantillonPong(1000, 4000, 500, false); // rtt de 3 s : l'avance serait de 180 ticks
    expect(h2.tickCible(4000) - h2.tickServeurEstime(4000)).toBeCloseTo(RESEAU.avanceMaxEntreesTicks - 8, 6);
  });
});

describe("horloge : marge adaptative", () => {
  it("part de la marge initiale", () => {
    expect(creerHorloge().margeTicks()).toBe(RESEAU.margeInitialeTicks);
  });

  it("grandit sur `manquees` même quand `avance` (le paquet le plus rapide) est bon : +1, +2 si au moins 4", () => {
    const h = creerHorloge();
    const m0 = h.margeTicks();
    h.signalerAvance(12, 1);
    expect(h.margeTicks()).toBe(m0 + 1);
    h.signalerAvance(12, 3);
    expect(h.margeTicks()).toBe(m0 + 2);
    h.signalerAvance(12, 4);
    expect(h.margeTicks()).toBe(m0 + 4);
    h.signalerAvance(30, 200);
    expect(h.margeTicks()).toBe(m0 + 6);
  });

  it("grandit de 1 quand l'entrée la plus tardive arrive à moins de 2 ticks, y compris en retard (négatif)", () => {
    const h = creerHorloge();
    const m0 = h.margeTicks();
    h.signalerAvance(1, 0);
    expect(h.margeTicks()).toBe(m0 + 1);
    h.signalerAvance(-20, 0);
    expect(h.margeTicks()).toBe(m0 + 2);
    h.signalerAvance(2, 0); // dans la tolérance [2, 8] : stable
    expect(h.margeTicks()).toBe(m0 + 2);
  });

  it("ne dépasse jamais les bornes", () => {
    const h = creerHorloge();
    for (let i = 0; i < 100; i++) h.signalerAvance(0, 9);
    expect(h.margeTicks()).toBe(RESEAU.margeMaxTicks);
    for (let i = 0; i < 100 * RESEAU.margeDecroissanceSnaps; i++) h.signalerAvance(50, 0);
    expect(h.margeTicks()).toBe(RESEAU.margeMinTicks);
  });

  it("décroît lentement : 1 tick après 40 instantanés consécutifs sans manquée et avec avance > 8", () => {
    const h = creerHorloge();
    h.signalerAvance(0, 5);
    h.signalerAvance(0, 5);
    const m = h.margeTicks();
    expect(m).toBeGreaterThan(RESEAU.margeInitialeTicks);
    for (let i = 0; i < RESEAU.margeDecroissanceSnaps - 1; i++) h.signalerAvance(12, 0);
    expect(h.margeTicks()).toBe(m);
    h.signalerAvance(12, 0);
    expect(h.margeTicks()).toBe(m - 1);
    // et il faut de nouveau 40 instantanés pour le tick suivant
    for (let i = 0; i < RESEAU.margeDecroissanceSnaps - 1; i++) h.signalerAvance(12, 0);
    expect(h.margeTicks()).toBe(m - 1);
  });

  it("une manquée ou une avance trop juste interrompt la série de décroissance", () => {
    const h = creerHorloge();
    h.signalerAvance(0, 5);
    const m = h.margeTicks();
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < RESEAU.margeDecroissanceSnaps - 1; i++) h.signalerAvance(12, 0);
      h.signalerAvance(5, 0); // avance dans la tolérance : remet la série à zéro
    }
    expect(h.margeTicks()).toBe(m);
  });

  it("`avance` = -128 (aucune entrée reçue) est ignoré : ni croissance, ni décroissance", () => {
    const h = creerHorloge();
    const m0 = h.margeTicks();
    for (let i = 0; i < 200; i++) h.signalerAvance(AVANCE_INCONNUE, 255);
    expect(h.margeTicks()).toBe(m0);
    // et il ne compte pas dans la série de décroissance
    h.signalerAvance(0, 5);
    const m = h.margeTicks();
    for (let i = 0; i < 39; i++) h.signalerAvance(12, 0);
    for (let i = 0; i < 100; i++) h.signalerAvance(AVANCE_INCONNUE, 0);
    expect(h.margeTicks()).toBe(m);
    h.signalerAvance(12, 0);
    expect(h.margeTicks()).toBe(m - 1);
  });

  it("boucle à retard : tant que le client court après sa cible, le retour du serveur est périmé et la marge ne grandit pas", () => {
    const h = creerHorloge();
    h.echantillonPong(0, 60, 1000, false);
    const m0 = h.margeTicks();
    const cible = h.tickCible(60);
    // client 10 ticks derrière la cible : il rattrape (facteur 1,05), les entrées tardives décrivent l'ancienne marge
    h.cadence(cible - 10, 60);
    for (let i = 0; i < 20; i++) h.signalerAvance(-5, 6);
    expect(h.margeTicks()).toBe(m0);
    // arrivé sur sa cible : le retour redevient pertinent
    h.cadence(cible, 60);
    h.signalerAvance(-5, 6);
    expect(h.margeTicks()).toBe(m0 + 2);
  });

  it("après une croissance, les instantanés du délai d'un aller-retour sont ignorés (RTT 150 ms = 3 instantanés)", () => {
    const h = creerHorloge();
    h.echantillonPong(0, 150, 1000, false);
    h.cadence(h.tickCible(150), 150);
    const m0 = h.margeTicks();
    h.signalerAvance(0, 2);
    expect(h.margeTicks()).toBe(m0 + 1);
    for (let i = 0; i < 3; i++) h.signalerAvance(0, 2);
    expect(h.margeTicks()).toBe(m0 + 1);
    h.signalerAvance(0, 2);
    expect(h.margeTicks()).toBe(m0 + 2);
  });

  it("plancher = ceil(2 × gigue en ticks) : la marge ne descend pas sous la gigue mesurée", () => {
    const h = creerHorloge();
    // RTT alternant 40 / 200 ms : gigue de 80 ms = 9,6 ticks -> plancher 20
    for (let i = 0; i < 16; i++) h.echantillonPong(i * 500, i * 500 + (i % 2 ? 200 : 40), -1, false);
    expect(h.gigueMs()).toBeCloseTo(80, 6);
    expect(h.margeTicks()).toBe(Math.ceil(2 * 80 * TPM));
    for (let i = 0; i < 500; i++) h.signalerAvance(50, 0);
    expect(h.margeTicks()).toBe(Math.ceil(2 * 80 * TPM));
  });

  it("reinitialiser remet tout à zéro", () => {
    const h = creerHorloge();
    h.echantillonPong(0, 100, 500, false);
    h.signalerAvance(0, 9);
    h.reinitialiser();
    expect(h.rttMs()).toBe(0);
    expect(h.gigueMs()).toBe(0);
    expect(h.tickServeurEstime(1000)).toBeNaN();
    expect(h.margeTicks()).toBe(RESEAU.margeInitialeTicks);
  });
});

describe("horloge : cadence et resynchronisation", () => {
  const calee = () => {
    const h = creerHorloge();
    h.echantillonPong(0, 60, 1000, false); // rtt 60 ms
    return h;
  };

  it("tant que rien n'est calé : facteur 1, pas de resynchronisation", () => {
    expect(creerHorloge().cadence(0, 0)).toEqual({ facteur: 1, ecartTicks: 0, resync: null });
  });

  it("facteur 1 pile quand le client est sur la cible, ±5 % au plus sinon (5 ticks d'écart saturent)", () => {
    const h = calee();
    const cible = h.tickCible(60);
    expect(h.cadence(cible, 60).facteur).toBeCloseTo(1, 9);
    expect(h.cadence(cible - 2, 60).facteur).toBeCloseTo(1.02, 9);
    expect(h.cadence(cible + 2, 60).facteur).toBeCloseTo(0.98, 9);
    expect(h.cadence(cible - 5, 60).facteur).toBeCloseTo(1.05, 9);
    expect(h.cadence(cible - 20, 60).facteur).toBeCloseTo(1.05, 9);
    expect(h.cadence(cible + 20, 60).facteur).toBeCloseTo(0.95, 9);
    expect(h.cadence(cible - 20, 60).resync).toBeNull();
  });

  it("client en retard de plus de 24 ticks : resync « avant », facteur 1", () => {
    const h = calee();
    const cible = h.tickCible(60);
    const c = h.cadence(cible - 25, 60);
    expect(c.resync).toBe("avant");
    expect(c.facteur).toBe(1);
    expect(c.ecartTicks).toBeCloseTo(25, 6);
    expect(h.cadence(cible - 24, 60).resync).toBeNull();
  });

  it("client en avance de plus de 24 ticks : resync « arriere », facteur 0 (il attend, il ne recule jamais)", () => {
    const h = calee();
    const cible = h.tickCible(60);
    const c = h.cadence(cible + 25, 60);
    expect(c.resync).toBe("arriere");
    expect(c.facteur).toBe(0);
    expect(h.cadence(cible + 24, 60).resync).toBeNull();
    // le temps passe : la cible rattrape le tick local et la cadence repart
    const plusTard = h.cadence(cible + 25, 60 + 30 / TPM);
    expect(plusTard.resync).toBeNull();
    expect(plusTard.facteur).toBeGreaterThan(0);
  });

  it("changement de `ralenti` sans NaN : l'ancienne référence est gardée jusqu'au premier nouvel échantillon", () => {
    const original = RESEAU.echelleCelebration;
    try {
      (RESEAU as { echelleCelebration: number }).echelleCelebration = 0.5;
      const h = creerHorloge();
      h.echantillonPong(0, 60, 1000, false);
      h.echantillonSnap(1006, 100, false);
      // le serveur annonce le ralenti : la fenêtre est vidée, la référence reste utilisable
      h.echantillonSnap(1012, 150, true);
      for (const t of [150, 160, 400, 1000]) expect(Number.isFinite(h.tickServeurEstime(t))).toBe(true);
      expect(Number.isFinite(h.tickCible(400))).toBe(true);
      const c = h.cadence(1012, 400);
      expect(Number.isFinite(c.facteur)).toBe(true);
      // au ralenti le monde avance deux fois moins vite : l'estimation aussi
      expect(h.tickServeurEstime(1150) - h.tickServeurEstime(150)).toBeCloseTo(1000 * TPM * 0.5, 6);
      // retour à la normale
      h.echantillonSnap(1030, 400, false);
      expect(h.tickServeurEstime(500) - h.tickServeurEstime(400)).toBeCloseTo(100 * TPM, 6);
    } finally {
      (RESEAU as { echelleCelebration: number }).echelleCelebration = original;
    }
  });

  it("avec l'échelle de la v1 (1), `ralenti: true` ne change rien", () => {
    const a = creerHorloge(), b = creerHorloge();
    a.echantillonSnap(600, 1000, false);
    b.echantillonSnap(600, 1000, true);
    expect(b.tickServeurEstime(1500)).toBeCloseTo(a.tickServeurEstime(1500), 9);
  });
});
