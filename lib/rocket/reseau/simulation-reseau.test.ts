/**
 * Deux clients simulés (prédicteurs + horloges réels) contre une `SalleRocket` pure par un transport simulé (`outils-reseau.ts`) : latence, gigue,
 * perte avec retransmission TCP, blocage en tête de file, rafale de retard. Spec § 10, ligne PREDICTION / `simulation-reseau.test.ts`.
 * Tout est déterministe (graines) ; le temps est virtuel (aucune horloge globale hors mesure du coût d'un rollback).
 */
import { describe, expect, it } from "vitest";
import { PAS_S } from "../contrat";
import type { EvenementMatch, Format } from "../contrat";
import { copierMonde, pasMonde } from "../match";
import { creerHorloge } from "./horloge";
import { creerLiaison, creerPilote } from "./outils-reseau";
import type { LiaisonSimulee } from "./outils-reseau";
import { creerPredicteur } from "./prediction";
import { creerSalleRocket } from "./salle";
import { decoderSnap, dequantifierEntrees, encoderSnap } from "./serialisation";
import type { HorlogeRocket, MessageServeur, PredicteurRocket, SalleRocket, SortieSalle, TrameEntrees } from "./protocole";
import { AVANCE_INCONNUE, REGLAGES_SALON_DEFAUT, RESEAU, TICKS_PAR_S } from "./protocole";

const TPM = TICKS_PAR_S / 1000;
/** résolution du temps virtuel (ms) ; la salle tique toutes les 8 ms, les clients dessinent toutes les 16 ms (62,5 images/s) */
const PAS_MS = 4;
const IMAGE_MS = 16;

type Montant = { k: "trame"; trame: TrameEntrees } | { k: "ping"; c: number };
type Descendant = { k: "snap"; octets: Uint8Array } | { k: "msg"; msg: MessageServeur };

interface Joueur {
  id: number;
  client: PredicteurRocket;
  horloge: HorlogeRocket;
  liaison: LiaisonSimulee<Montant, Descendant>;
  pilote: ReturnType<typeof creerPilote>;
  moi: number;
  /** ce que le client a joué : événements locaux + événements serveur non retirés, de ma voiture */
  joues: EvenementMatch[];
  /** ce que le serveur a produit pour ma voiture (vérité de terrain) */
  verite: EvenementMatch[];
  /** tous les événements serveur rendus par `filtrerEvenements` (autres voitures, but, fin…) : ce que le jeu joue réellement */
  recus: EvenementMatch[];
  /** instantanés reçus après l'échauffement */
  snapsTardifs: number;
  manquees: number;
  avances: number[];
  rollbacks: { ecartM: number; profondeur: number; t: number; ms: number; moi: number; autres: number; balle: number }[];
  /** vitesse de glissement visible (m/s) de la correction affichée, image par image, hors images de rollback, par source */
  glissements: { source: "moi" | "autres" | "balle"; v: number; t: number }[];
  decalageAffichage: number[][] | null;
  resyncs: number;
  /** instants (ms virtuelles) des resynchronisations franches */
  tResyncs: number[];
  actif: boolean;
  /** entrées de remplacement forcées (essais) */
  neutre: boolean;
  pings: number;
  dernierPing: number;
}

interface OptionsSim {
  latenceMs?: number;
  gigueMs?: number;
  perte?: number;
  graine?: number;
  format?: Format;
  /** durée de l'échauffement après lequel on mesure (ms) */
  echauffementMs?: number;
  /** « nerveux » : nouvelle consigne toutes les 0,15 à 0,8 s ; « pose » : toutes les 0,4 à 1,6 s */
  pilote?: "nerveux" | "pose";
}

function creerSimulation(o: OptionsSim = {}) {
  const format = o.format ?? "1v1";
  const salle: SalleRocket = creerSalleRocket({
    code: "BCDF", hote: { id: 1, nom: "Alice" }, reglages: { ...REGLAGES_SALON_DEFAUT(), format, niveauBots: "pro" }, graine: (o.graine ?? 1) * 17 + 3,
    maintenantMs: 0, dev: true, dureeForceeS: 600,
  });
  let sorties: SortieSalle[] = [];
  const T = { t: 0 };
  sorties.push(...salle.recevoir(1, { t: "reglages", reglages: { format } }, 0));
  const rejoint = salle.rejoindre({ id: 2, nom: "Bob", equipe: salle.etat().joueurs[0].equipe === "bleue" ? "orange" : "bleue" }, 0);
  if (!rejoint.ok) throw new Error("rejoindre refusé : " + rejoint.raison);
  sorties = salle.recevoir(1, { t: "lancer" }, 0);
  const debuts = new Map<number, Extract<MessageServeur, { t: "debut" }>>();
  for (const s of sorties) if ("msg" in s && s.msg.t === "debut" && typeof s.a === "number") debuts.set(s.a, s.msg);
  if (debuts.size !== 2) throw new Error("`debut` attendu pour les deux joueurs");

  const sim = {
    salle, T,
    joueurs: [] as Joueur[],
    echauffementMs: o.echauffementMs ?? 8000,
    serveurEnPause: false,
    config: o,
    snapsServeur: 0,
    /** tous les événements produits par le serveur (vérité de terrain, dans l'ordre d'émission) */
    veriteTous: [] as EvenementMatch[],
  };

  let n = 0;
  for (const [id, debut] of debuts) {
    n++;
    const horloge = creerHorloge();
    const client = creerPredicteur({ horloge, debut });
    sim.joueurs.push({
      id, client, horloge, moi: debut.moi, joues: [], verite: [], recus: [], snapsTardifs: 0, manquees: 0, avances: [], rollbacks: [], glissements: [], decalageAffichage: null, resyncs: 0, tResyncs: [], actif: true, neutre: false, pings: 0, dernierPing: -1e9,
      liaison: creerLiaison<Montant, Descendant>({ latenceMs: o.latenceMs ?? 40, gigueMs: o.gigueMs ?? 10, perte: o.perte ?? 0, graine: (o.graine ?? 1) * 100 + n }),
      pilote: creerPilote((o.graine ?? 1) * 1000 + n, o.pilote === "pose" ? { changeMinS: 0.4, changeMaxS: 1.6 } : {}),
    });
  }
  salle.recevoir(1, { t: "pret" }, 0);
  salle.recevoir(2, { t: "pret" }, 0);
  if (salle.phase !== "match") throw new Error("la salle devrait être en match");

  const joueur = (id: number | "tous"): Joueur[] => (id === "tous" ? sim.joueurs : sim.joueurs.filter((j) => j.id === id));

  /** route les sorties de la salle vers les liens descendants (les instantanés sont encodés ici, comme `rocket.ts`) */
  const router = (sorts: readonly SortieSalle[], t: number): void => {
    for (const s of sorts) {
      if ("snap" in s) {
        const octets = encoderSnap(s.snap);
        for (const j of joueur(s.a)) j.liaison.descendant.envoyer({ k: "snap", octets }, t);
      } else {
        for (const j of joueur(s.a)) j.liaison.descendant.envoyer({ k: "msg", msg: s.msg }, t);
        if (s.msg.t === "ev") {
          for (const x of s.msg.evenements) sim.veriteTous.push(x.e);
          for (const j of sim.joueurs) for (const x of s.msg.evenements) if ((x.e as { idVoiture?: number }).idVoiture === j.moi) j.verite.push(x.e);
        }
      }
    }
  };

  const livrerMontant = (j: Joueur, t: number): void => {
    for (const m of j.liaison.montant.livrer(t)) {
      if (m.k === "trame") router(salle.recevoirEntrees(j.id, m.trame, t), t);
      else router(salle.recevoir(j.id, { t: "ping", c: m.c }, t), t);
    }
  };

  const livrerDescendant = (j: Joueur, t: number): void => {
    for (const m of j.liaison.descendant.livrer(t)) {
      if (!j.actif) continue;
      if (m.k === "snap") {
        const snap = decoderSnap(m.octets);
        if (!snap) throw new Error("instantané illisible");
        if (t - 0 > sim.echauffementMs) {
          j.snapsTardifs++;
          if (snap.avance !== AVANCE_INCONNUE) j.avances.push(snap.avance);
          j.manquees += snap.manquees;
        }
        j.client.recevoirSnap(snap, t);
      } else if (m.msg.t === "pong") {
        j.horloge.echantillonPong(m.msg.c, t, m.msg.tick, m.msg.ralenti);
      } else if (m.msg.t === "ev") {
        const rendus = j.client.filtrerEvenements(m.msg.evenements);
        for (const e of rendus) j.recus.push(e);
        for (const e of rendus) if ((e as { idVoiture?: number }).idVoiture === j.moi) j.joues.push(e);
      }
    }
  };

  const image = (j: Joueur, t: number): void => {
    if (!j.actif) return;
    const brut = j.neutre ? { accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false } : j.pilote.entrees(t / 1000);
    const debut = typeof performance !== "undefined" ? performance.now() : 0;
    const resyncsAvant = j.client.stats().resyncs;
    const r = j.client.avancer(IMAGE_MS / 1000, brut, t);
    const ms = typeof performance !== "undefined" ? performance.now() - debut : 0;
    if (r.snap?.resync) j.resyncs++;
    if (j.client.stats().resyncs > resyncsAvant) j.tResyncs.push(t);
    if (r.snap?.rollback) j.rollbacks.push({ ecartM: r.snap.ecartM, profondeur: r.snap.profondeur, t, ms, moi: r.snap.ecartMoiM ?? 0, autres: r.snap.ecartAutresM ?? 0, balle: r.snap.ecartBalleM ?? 0 });
    // Vitesse de glissement visible : variation, d'une image à l'autre, de l'écart entre le monde AFFICHÉ et le monde physique (hors image de rollback, où
    // l'écart absorbe le saut du monde physique : l'affichage, lui, reste continu).
    {
      const aff = j.client.mondeAffiche(t), mo = j.client.monde;
      const dec = mo.voitures.map((v, i) => [aff.voitures[i].p[0] - v.p[0], aff.voitures[i].p[1] - v.p[1], aff.voitures[i].p[2] - v.p[2]]);
      dec.push([aff.balle.p[0] - mo.balle.p[0], aff.balle.p[1] - mo.balle.p[1], aff.balle.p[2] - mo.balle.p[2]]);
      if (j.decalageAffichage && !(r.snap && (r.snap.rollback || r.snap.resync))) {
        for (let i = 0; i < dec.length; i++) {
          const v = Math.hypot(dec[i][0] - j.decalageAffichage[i][0], dec[i][1] - j.decalageAffichage[i][1], dec[i][2] - j.decalageAffichage[i][2]) / (IMAGE_MS / 1000);
          j.glissements.push({ source: i === dec.length - 1 ? "balle" : i === j.moi ? "moi" : "autres", v, t });
        }
      }
      j.decalageAffichage = dec;
    }
    for (const e of r.evenementsLocaux) j.joues.push(e);
    const tr = j.client.trameAEnvoyer(t);
    if (tr) j.liaison.montant.envoyer({ k: "trame", trame: tr }, t);
    if (t - j.dernierPing >= RESEAU.pingMatchMs) { j.dernierPing = t; j.pings++; j.liaison.montant.envoyer({ k: "ping", c: t }, t); }
  };

  /** avance le temps virtuel de `ms` */
  const jouer = (ms: number): void => {
    const fin = T.t + ms;
    while (T.t < fin) {
      T.t += PAS_MS;
      const t = T.t;
      for (const j of sim.joueurs) { livrerMontant(j, t); }
      if (t % RESEAU.periodeMinuteurServeurMs === 0 && !sim.serveurEnPause) { const s = salle.tic(t); sim.snapsServeur += s.filter((x) => "snap" in x).length; router(s, t); }
      for (const j of sim.joueurs) { livrerDescendant(j, t); }
      if (t % IMAGE_MS === 0) for (const j of sim.joueurs) image(j, t);
    }
  };

  return Object.assign(sim, { jouer, image, router });
}
type Simulation = ReturnType<typeof creerSimulation>;

const mediane = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const compter = (xs: readonly { ecartM: number; t: number }[], seuil: number, depuisMs: number): number => xs.filter((x) => x.t >= depuisMs && x.ecartM > seuil).length;

describe("deux clients contre la salle : régime établi (40 ms de latence, 10 ms de gigue, sans perte)", () => {
  it("minuteur 8 ms, 60 s de jeu : aucun événement de voiture dupliqué, aucune entrée manquée, rollbacks bon marché, jamais de saut de plus de 4 m", () => {
    const sim = creerSimulation({ latenceMs: 40, gigueMs: 10, perte: 0, graine: 1 });
    sim.jouer(60_000);
    for (const j of sim.joueurs) {
      const st = j.client.stats();
      // entrées : aucune n'est arrivée après son tick en régime établi (la marge adaptative a fait son travail)
      expect(j.snapsTardifs).toBeGreaterThan(900);
      expect(j.manquees).toBeLessThanOrEqual(2);
      expect(Math.min(...j.avances)).toBeGreaterThanOrEqual(0);
      // rollback : le régime normal, bon marché
      expect(st.rollbacks).toBeGreaterThan(100);
      expect(mediane(j.rollbacks.map((r) => r.ms))).toBeLessThan(5);
      const moyenne = j.rollbacks.reduce((a, r) => a + r.ms, 0) / j.rollbacks.length;
      expect(moyenne).toBeLessThan(5);
      // pas de rollback géant : la profondeur reste de l'ordre du RTT + marge
      expect(st.profondeurMax).toBeLessThan(60);
      // jamais de correction de plus de 4 m hors rafale
      expect(Math.max(...j.rollbacks.map((r) => r.ecartM))).toBeLessThan(RESEAU.seuilTeleportVoitureM);
      expect(st.resyncs).toBe(0);
      // événements de ma voiture : pas de doublon (≈ autant de joués que produits par le serveur)
      for (const type of ["saut", "doubleSaut", "flip", "atterrissage", "boost", "plot"] as const) {
        const joues = j.joues.filter((e) => e.t === type).length, vrai = j.verite.filter((e) => e.t === type).length;
        expect(joues, `${type} joué ${joues} fois pour ${vrai} côté serveur`).toBeLessThanOrEqual(vrai + 4);
        expect(joues, `${type} joué ${joues} fois pour ${vrai} côté serveur`).toBeGreaterThanOrEqual(vrai - 4);
      }
      expect(j.verite.filter((e) => e.t === "saut").length).toBeGreaterThan(5);
    }
  });

  it("le client reste en avance sur le serveur de demi-RTT + marge et n'oscille pas", () => {
    const sim = creerSimulation({ latenceMs: 40, gigueMs: 10, graine: 2 });
    sim.jouer(20_000);
    const serveur = sim.salle.monde();
    expect(serveur).not.toBeNull();
    for (const j of sim.joueurs) {
      const avance = j.client.monde.tick - (serveur as { tick: number }).tick;
      // 40 ms de latence = 4,8 ticks ; marge >= 4 ; tolérance large pour la gigue
      expect(avance).toBeGreaterThanOrEqual(RESEAU.avanceMinTicks);
      expect(avance).toBeLessThanOrEqual(30);
    }
  });

  it("convergence : entrées figées pendant 3 s, le monde prédit rejoint l'état serveur à moins de 5 cm (écart au jumeau du serveur avancé au tick du client)", () => {
    const sim = creerSimulation({ latenceMs: 50, gigueMs: 8, graine: 3, format: "1v1" });
    sim.jouer(12_000);
    // les deux joueurs tiennent la même consigne sans changer rien pendant 4 s : plus aucune surprise pour les prédicteurs
    for (const j of sim.joueurs) j.pilote = { entrees: () => ({ accel: 1, direction: 0.25, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false }) };
    sim.jouer(4000);
    const serveur = sim.salle.monde();
    expect(serveur).not.toBeNull();
    for (const j of sim.joueurs) {
      const exactsAvant = j.client.stats().snapsExacts;
      sim.jouer(1000);
      expect(j.client.stats().snapsExacts).toBeGreaterThan(exactsAvant + 5);
      // jumeau du serveur : avancé au tick du client avec la même consigne constante pour les deux voitures
      const jumeau = copierMonde(sim.salle.monde() as never);
      const tickClient = j.client.monde.tick;
      const q = { accel: 1, direction: 0.25, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false };
      const entrees = jumeau.voitures.map(() => dequantifierEntrees({ accel: 127, direction: Math.round(0.25 * 127), tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false }));
      void q;
      while (jumeau.tick < tickClient) pasMonde(jumeau, entrees, PAS_S);
      for (let i = 0; i < jumeau.voitures.length; i++) {
        const a = jumeau.voitures[i].p, b = j.client.monde.voitures[i].p;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(0.05);
      }
    }
  });

  it("score et phase affichés viennent de l'état autoritaire : un but forcé par le serveur apparaît chez les deux clients, identique", () => {
    const sim = creerSimulation({ latenceMs: 60, gigueMs: 10, graine: 4 });
    sim.jouer(8000);
    sim.router(sim.salle.recevoir(1, { t: "dev", action: "balle", p: [0, 2, 56], v: [0, 0, 0] }, sim.T.t), sim.T.t);
    // la célébration dure 1,25 s de jeu au ralenti ×0,5 depuis la fusion avec la physique de RocketSim (4,5 s avant) : on regarde avant son terme
    sim.jouer(800);
    const vus = sim.joueurs.map((j) => j.client.mondeAffiche(sim.T.t));
    const serveur = sim.salle.monde() as { score: { bleue: number; orange: number } };
    expect(serveur.score.bleue + serveur.score.orange).toBe(1);
    for (const m of vus) {
      expect(m.score).toEqual(serveur.score);
      expect(m.phase).toBe("but");
    }
    // ... et non avant : les clients ne l'ont pas annoncé par la seule prédiction (leur score affiché suit le serveur à chaque instant)
    const sim2 = creerSimulation({ latenceMs: 60, gigueMs: 10, graine: 4 });
    sim2.jouer(8000);
    sim2.router(sim2.salle.recevoir(1, { t: "dev", action: "balle", p: [0, 2, 56], v: [0, 0, 0] }, sim2.T.t), sim2.T.t);
    for (let i = 0; i < 100; i++) {
      sim2.jouer(16);
      const sv = sim2.salle.monde() as { score: { bleue: number; orange: number } };
      for (const j of sim2.joueurs) {
        const aff = j.client.mondeAffiche(sim2.T.t);
        // jamais plus de buts affichés que le serveur n'en a comptés
        expect(aff.score.bleue + aff.score.orange).toBeLessThanOrEqual(sv.score.bleue + sv.score.orange);
      }
    }
  });
});

describe("deux clients contre la salle : bots (2v2), la voiture d'un bot est jouée avec ses entrées quantifiées", () => {
  it("converge et reste cohérent avec des bots qui changent d'entrée en continu", () => {
    const sim = creerSimulation({ latenceMs: 40, gigueMs: 10, graine: 5, format: "2v2" });
    sim.jouer(30_000);
    for (const j of sim.joueurs) {
      const st = j.client.stats();
      expect(st.rollbacks).toBeGreaterThan(100);
      expect(j.manquees).toBeLessThanOrEqual(2);
      expect(Math.max(...j.rollbacks.map((r) => r.ecartM))).toBeLessThan(RESEAU.seuilTeleportVoitureM);
      expect(mediane(j.rollbacks.map((r) => r.ms))).toBeLessThan(5);
      expect(st.resyncs).toBe(0);
    }
  });
});

/**
 * Mesures de jouabilité d'une simulation (pire client), après 10 s d'échauffement, ramenées à 60 s : corrections brutes de plus de 0,5 m (total, ma voiture,
 * voitures adverses, balle) et vitesse de glissement visible des voitures adverses (p99, m/s) : ce que le joueur VOIT, une fois la correction lissée.
 */
interface Jouabilite { total: number; moi: number; autres: number; balle: number; glissementP99: number; glissementMax: number }
function jouabilite(sim: Simulation): Jouabilite {
  const r: Jouabilite = { total: 0, moi: 0, autres: 0, balle: 0, glissementP99: 0, glissementMax: 0 };
  for (const j of sim.joueurs) {
    const rb = j.rollbacks.filter((x) => x.t >= 10_000);
    r.total = Math.max(r.total, rb.filter((x) => x.ecartM > 0.5).length);
    r.moi = Math.max(r.moi, rb.filter((x) => x.moi > 0.5).length);
    r.autres = Math.max(r.autres, rb.filter((x) => x.autres > 0.5).length);
    r.balle = Math.max(r.balle, rb.filter((x) => x.balle > 0.5).length);
    const v = j.glissements.filter((x) => x.source === "autres" && x.t >= 10_000).map((x) => x.v);
    r.glissementP99 = Math.max(r.glissementP99, percentile(v, 0.99));
    r.glissementMax = Math.max(r.glissementMax, ...v);
  }
  return r;
}

/** Exécute `f` avec des constantes de `RESEAU` temporairement remplacées (essais comparatifs « avant / après » : les nouvelles fonctions coupées). */
function avecReseau<T>(surcharges: Partial<Record<keyof typeof RESEAU, number | boolean>>, f: () => T): T {
  const R = RESEAU as unknown as Record<string, number | boolean>;
  const sauve: Record<string, number | boolean> = {};
  for (const k of Object.keys(surcharges)) { sauve[k] = R[k]; R[k] = surcharges[k as keyof typeof RESEAU] as number | boolean; }
  try { return f(); } finally { for (const k of Object.keys(sauve)) R[k] = sauve[k]; }
}
/** Les améliorations de jouabilité coupées : lissage d'origine (60 ms partout), pas d'entrées futures, pas de rejeu serveur, pas de conservation de ma voiture. */
const SANS_AMELIORATIONS = { lissageTauAutresS: 0.06, lissageTauBalleS: 0.06, lissageFacteurGrandeCorrection: 1, futursMaxTicks: 0, rewindMaxTicks: -1, conservationManquees: false } as const;

describe("deux clients contre la salle : pertes et corrections visibles (mesure, § 14 netcode 12)", () => {
  const corrections: Record<string, Record<string, Jouabilite>> = {};
  it.each([[0], [0.01], [0.02]])("perte de %f avec retransmission TCP : corrections de plus de 0,5 m par minute, par source, rafales comprises", (perte) => {
    const cle = `${Math.round(perte * 100)} %`;
    for (const pilote of ["nerveux", "pose"] as const) {
      const sim = creerSimulation({ latenceMs: 40, gigueMs: 10, perte, graine: 6, pilote });
      sim.jouer(70_000);
      // 60 s mesurées après 10 s d'échauffement
      const m = jouabilite(sim);
      (corrections[cle] ??= {})[pilote] = m;
      // Ma voiture n'est (presque) jamais corrigée : sans perte, jamais ; avec perte, seules les rafales de retard que le rejeu serveur n'a pas pu
      // rattraper peuvent la déplacer de plus de 0,5 m.
      expect(m.moi, `ma voiture corrigée ${m.moi} fois par minute`).toBeLessThanOrEqual(perte === 0 ? 0 : 1);
      expect(m.balle).toBeLessThanOrEqual(2);
      // La correction VISIBLE (glissement lissé des voitures adverses) reste douce : les corrections brutes viennent des entrées adverses inconnues.
      expect(m.glissementP99, `glissement p99 ${m.glissementP99.toFixed(1)} m/s`).toBeLessThan(perte === 0 ? 4 : perte === 0.01 ? 5 : 6);
      for (const j of sim.joueurs) {
        // jamais de saut de plus de 4 m hors rafale : sans perte, aucun ; avec perte, seules les rafales de retard en produisent quelques-uns
        const gros = compter(j.rollbacks, RESEAU.seuilTeleportVoitureM, 10_000);
        if (perte === 0) expect(gros).toBe(0);
        else expect(gros).toBeLessThan(10);
        expect(j.client.stats().resyncs).toBeLessThan(10);
      }
    }
  });

  it("rapport : corrections brutes de plus de 0,5 m par minute (voitures adverses surtout, extrapolées) et glissement visible ; seuil de jouabilité de la spec § 14", () => {
    process.stdout.write(`\n[simulation-reseau] jouabilité par taux de perte (pire client, 60 s, 40 ms de latence) : ${JSON.stringify(corrections)}\n`);
    expect(Object.keys(corrections).length).toBe(3);
    // Sans perte : l'extrapolation ne se trompe que sur un adversaire qui change brusquement d'avis dans la fenêtre non couverte par les entrées futures.
    expect(corrections["0 %"].nerveux.total).toBeLessThanOrEqual(8);
    expect(corrections["0 %"].pose.total).toBeLessThanOrEqual(5);
    // Avec perte : chaque retransmission TCP retient tout un aller-retour (RTO >= 200 ms) : l'adversaire est extrapolé trois fois plus longtemps.
    expect(corrections["1 %"].nerveux.total).toBeLessThanOrEqual(40);
    expect(corrections["1 %"].pose.total).toBeLessThanOrEqual(32);
    expect(corrections["2 %"].nerveux.total).toBeLessThanOrEqual(55);
    expect(corrections["2 %"].pose.total).toBeLessThanOrEqual(40);
  });

  it("avant / après : les améliorations (entrées futures, rejeu serveur, ma voiture conservée, lissage adaptatif) à 1 % de perte, mêmes graines", () => {
    const mesure = (sur: Parameters<typeof avecReseau>[0]) => avecReseau(sur, () => {
      const sim = creerSimulation({ latenceMs: 40, gigueMs: 10, perte: 0.01, graine: 6, pilote: "nerveux" });
      sim.jouer(70_000);
      return jouabilite(sim);
    });
    const avant = mesure(SANS_AMELIORATIONS);
    const apres = mesure({});
    process.stdout.write(`\n[simulation-reseau] avant / après (1 % de perte, pilote nerveux) : ${JSON.stringify({ avant, apres })}\n`);
    expect(apres.autres).toBeLessThan(avant.autres * 0.75);
    expect(apres.glissementP99).toBeLessThan(avant.glissementP99 * 0.5);
    expect(apres.glissementMax).toBeLessThan(avant.glissementMax * 0.5);
    expect(apres.moi).toBeLessThanOrEqual(avant.moi);
  });

  it("avant / après sur un réseau mobile (100 ms, 30 ms de gigue, 1 % de perte) : ma voiture n'est plus corrigée par les rafales de retransmission", () => {
    const mesure = (sur: Parameters<typeof avecReseau>[0]) => avecReseau(sur, () => {
      const sim = creerSimulation({ latenceMs: 100, gigueMs: 30, perte: 0.01, graine: 6, pilote: "nerveux" });
      sim.jouer(70_000);
      return jouabilite(sim);
    });
    const avant = mesure(SANS_AMELIORATIONS);
    const apres = mesure({});
    process.stdout.write(`\n[simulation-reseau] avant / après (100 ms / 30 ms, 1 % de perte) : ${JSON.stringify({ avant, apres })}\n`);
    // 3 corrections de ma voiture sans les améliorations avec l'ancienne physique, 2 avec celle de RocketSim (mesure de la fusion avec #100, même graine)
    expect(avant.moi).toBeGreaterThanOrEqual(2);
    expect(apres.moi).toBeLessThanOrEqual(1);
    expect(apres.autres).toBeLessThan(avant.autres * 0.8);
    expect(apres.glissementP99).toBeLessThan(avant.glissementP99 * 0.5);
  });

  it("latence de 120 ms sans perte : les corrections brutes restent nombreuses (fenêtre non couverte plus longue) mais le glissement visible reste doux", () => {
    const sim = creerSimulation({ latenceMs: 120, gigueMs: 20, perte: 0, graine: 6, pilote: "nerveux" });
    sim.jouer(70_000);
    const m = jouabilite(sim);
    process.stdout.write(`\n[simulation-reseau] 120 ms / 20 ms de gigue, sans perte : ${JSON.stringify(m)}\n`);
    expect(m.moi).toBe(0);
    expect(m.glissementP99).toBeLessThan(5);
    expect(m.total).toBeLessThanOrEqual(60);
  });
});

describe("deux clients contre la salle : incidents de réseau", () => {
  it("rafale de retard de 300 ms : six instantanés d'un coup coûtent un seul rollback et moins d'une image", () => {
    const sim = creerSimulation({ latenceMs: 40, gigueMs: 5, graine: 7 });
    sim.jouer(10_000);
    const a = sim.joueurs[0];
    const avant = a.client.stats().rollbacks;
    // blocage du sens descendant 300 ms
    a.liaison.descendant.retenir(300, sim.T.t);
    sim.jouer(296);
    expect(a.liaison.descendant.enVol()).toBeGreaterThanOrEqual(6);
    const rollbacksAvant = a.client.stats().rollbacks;
    const snapsAvant = a.client.stats().tickSnap;
    // libération : tout arrive dans le même réveil
    const t0 = sim.T.t;
    sim.jouer(PAS_MS * 6);
    void t0;
    const apres = a.client.stats();
    // plusieurs instantanés reçus d'un coup, mais pas plus d'un rollback par image affichée
    const gelMs = Math.max(...a.rollbacks.filter((r) => r.t > t0 - 100).map((r) => r.ms));
    expect(apres.tickSnap).toBeGreaterThan(snapsAvant + 12);
    expect(gelMs).toBeLessThan(IMAGE_MS);
    expect(apres.rollbacks - rollbacksAvant).toBeLessThanOrEqual(2);
    expect(apres.rollbacks).toBeGreaterThanOrEqual(avant);
    // les images suivantes sont normales : le client n'a pas dérivé
    sim.jouer(3000);
    const serveur = sim.salle.monde() as { tick: number };
    expect(a.client.monde.tick - serveur.tick).toBeGreaterThanOrEqual(2);
    expect(a.client.monde.tick - serveur.tick).toBeLessThan(40);
  });

  it("onglet masqué 5 s puis retour : resynchronisation « avant », pas de rafale d'entrées périmées", () => {
    const sim = creerSimulation({ latenceMs: 40, gigueMs: 5, graine: 8 });
    sim.jouer(10_000);
    const a = sim.joueurs[0];
    a.actif = false; // plus d'images (requestAnimationFrame arrêté), plus de ping applicatif, plus de réception traitée
    sim.jouer(5000);
    const serveur = sim.salle.monde() as { tick: number };
    const retard = serveur.tick - a.client.monde.tick;
    expect(retard).toBeGreaterThan(400);
    const tramesAvant = a.liaison.montant.enVol();
    void tramesAvant;
    // retour : on compte les trames envoyées dans la seconde qui suit
    let envoyees = 0;
    const trameOrig = a.client.trameAEnvoyer.bind(a.client);
    a.client.trameAEnvoyer = (t: number) => { const tr = trameOrig(t); if (tr) { envoyees++; expect(tr.entrees.length).toBeLessThanOrEqual(RESEAU.entreesMaxParTrame); } return tr; };
    a.actif = true;
    sim.jouer(1000);
    expect(envoyees).toBeLessThanOrEqual(1000 / RESEAU.intervalleTrameEntreesMs);
    expect(envoyees).toBeGreaterThan(20);
    const serveur2 = sim.salle.monde() as { tick: number };
    expect(a.client.monde.tick - serveur2.tick).toBeGreaterThanOrEqual(RESEAU.avanceMinTicks);
    expect(a.client.monde.tick - serveur2.tick).toBeLessThan(40);
    expect(a.resyncs).toBeGreaterThanOrEqual(1);
    // la salle n'a pas reçu d'entrée périmée en nombre : peu de ticks répétés pendant l'absence puis retour à la normale (pas de trou après le retour)
    sim.jouer(3000);
    const manquees0 = a.manquees;
    sim.jouer(5000);
    expect(a.manquees - manquees0).toBeLessThanOrEqual(2);
  });

  it("calage du serveur de 400 ms (boucle d'événements gelée) : le serveur rattrape, le client ne dérive pas", () => {
    const sim = creerSimulation({ latenceMs: 40, gigueMs: 5, graine: 9 });
    sim.jouer(10_000);
    sim.serveurEnPause = true;
    sim.jouer(400);
    sim.serveurEnPause = false;
    // le serveur a perdu 400 ms de temps réel mais les tics rattrapent (jusqu'à 0,5 s) : retour à la normale dans les secondes qui suivent
    sim.jouer(4000);
    for (const j of sim.joueurs) {
      const serveur = sim.salle.monde() as { tick: number };
      const avance = j.client.monde.tick - serveur.tick;
      expect(avance).toBeGreaterThanOrEqual(0);
      expect(avance).toBeLessThan(40);
    }
    // et pas de dérive sur la durée
    sim.jouer(20_000);
    for (const j of sim.joueurs) {
      const serveur = sim.salle.monde() as { tick: number };
      const avance = j.client.monde.tick - serveur.tick;
      expect(avance).toBeGreaterThanOrEqual(RESEAU.avanceMinTicks);
      expect(avance).toBeLessThan(30);
    }
  });

  it("latence forte (150 ms, gigue de 30 ms) : le client prend de l'avance en conséquence, les entrées arrivent à temps", () => {
    const sim = creerSimulation({ latenceMs: 150, gigueMs: 30, graine: 10 });
    sim.jouer(40_000);
    for (const j of sim.joueurs) {
      expect(j.manquees).toBeLessThanOrEqual(12);
      const serveur = sim.salle.monde() as { tick: number };
      expect(j.client.monde.tick - serveur.tick).toBeGreaterThanOrEqual(150 * TPM * 0.8);
      // 150 ms d'extrapolation d'un adversaire : quelques grosses corrections existent, mais pas de saut systématique
      const ecarts = j.rollbacks.map((r) => r.ecartM).sort((a, b) => a - b);
      expect(ecarts[Math.floor(ecarts.length * 0.99)]).toBeLessThan(RESEAU.seuilTeleportVoitureM);
      expect(ecarts[ecarts.length - 1]).toBeLessThan(8);
    }
  });
});


// ============================================================================================================================
// Phase 2 : matrice de réseaux (30 / 100 / 200 ms, gigue, pertes), but autoritaire unique, divergence permanente, coût du rollback
// ============================================================================================================================

const NEUTRE = { accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false };
const CONSIGNE = { accel: 1, direction: 0.25, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false };

/** fige les deux pilotes sur la même consigne constante (plus aucune surprise pour les prédicteurs) */
function figer(sim: Simulation, consigne: typeof CONSIGNE = CONSIGNE): void {
  for (const j of sim.joueurs) j.pilote = { entrees: () => consigne };
}

/** écart maximal (m) entre le monde prédit du client et le jumeau du serveur avancé au tick du client avec la même consigne constante (voitures ET balle) */
function ecartAuJumeau(sim: Simulation, j: Joueur, consigne: typeof CONSIGNE = CONSIGNE): number {
  const jumeau = copierMonde(sim.salle.monde() as never);
  const tickClient = j.client.monde.tick;
  const entrees = jumeau.voitures.map(() => dequantifierEntrees({
    accel: Math.round(consigne.accel * 127), direction: Math.round(consigne.direction * 127), tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false,
  }));
  while (jumeau.tick < tickClient) pasMonde(jumeau, entrees, PAS_S);
  let pire = 0;
  const d = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (let i = 0; i < jumeau.voitures.length; i++) pire = Math.max(pire, d(jumeau.voitures[i].p, j.client.monde.voitures[i].p));
  return Math.max(pire, d(jumeau.balle.p, j.client.monde.balle.p));
}

const percentile = (xs: number[], q: number): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0; };

/** réseaux d'essai : [latence d'un sens (ms), gigue (ms), perte] */
const RESEAUX: readonly [number, number, number][] = [
  [30, 5, 0],
  [30, 10, 0.01],
  [100, 15, 0],
  [100, 30, 0.01],
  [200, 20, 0],
  [200, 40, 0.02],
];

const matrice: Record<string, Record<string, number>> = {};
describe("matrice de réseaux : convergence, pas de divergence permanente", () => {
  it.each(RESEAUX)("latence %i ms, gigue %i ms, perte %f : 30 s de jeu, puis entrées figées : le monde prédit rejoint le jumeau du serveur, sans gros saut ni resync en rafale", (latenceMs, gigueMs, perte) => {
    const sim = creerSimulation({ latenceMs, gigueMs, perte, graine: 20 + latenceMs, echauffementMs: 8000 });
    sim.jouer(30_000);
    for (const j of sim.joueurs) {
      const st = j.client.stats();
      expect(st.rollbacks, "le rollback est le régime normal").toBeGreaterThan(25);
      matrice[`${latenceMs} ms / ${gigueMs} / ${perte}`] = { rollbacks: st.rollbacks, profondeurMax: st.profondeurMax, resyncs: st.resyncs, premierResyncMs: j.tResyncs[0] ?? -1, manquees: j.manquees, p99EcartCm: Math.round(100 * percentile(j.rollbacks.map((r) => r.ecartM), 0.99)) };
      expect(j.snapsTardifs).toBeGreaterThan(300);
      // rollback bon marché en moyenne (la machine de test peut être chargée : borne large)
      const moyenne = j.rollbacks.reduce((a, r) => a + r.ms, 0) / Math.max(1, j.rollbacks.length);
      expect(moyenne).toBeLessThan(8);
      // la profondeur reste de l'ordre du RTT + marge (aucun rejeu géant hors incident)
      const rtt = 2 * latenceMs + 2 * gigueMs;
      expect(st.profondeurMax).toBeLessThan((rtt * TPM) + 90 + (perte > 0 ? 60 : 0));
      // Resync franc : un seul, au calage initial de l'horloge (décompte, voitures figées), dès que le RTT est connu. Aucun en régime établi,
      // hors retransmissions TCP qui retardent tout d'un RTO.
      expect(st.resyncs).toBeLessThanOrEqual(perte > 0 ? 6 : 1);
      if (perte === 0 && st.resyncs === 1) expect(j.tResyncs[0]).toBeLessThan(2000);
      // marge : aucune entrée manquée sans perte ; avec perte, un paquet retransmis bloque la file d'un RTO (blocage en tête de file TCP) et fait
      // arriver des entrées tardives en rafale (comptées : le serveur répète la dernière entrée connue), mais le compte reste borné
      expect(j.manquees).toBeLessThanOrEqual(perte > 0 ? 1500 : 4);
    }
    // plus aucune surprise : 4 s de consigne identique, puis le monde prédit doit être exactement celui du serveur
    figer(sim);
    sim.jouer(5000);
    for (const j of sim.joueurs) {
      const exactsAvant = j.client.stats().snapsExacts;
      sim.jouer(1000);
      expect(j.client.stats().snapsExacts, "les instantanés redeviennent exacts").toBeGreaterThan(exactsAvant + 3);
      expect(ecartAuJumeau(sim, j), "écart au jumeau (m)").toBeLessThan(0.05);
    }
  });

  it("rapport de la matrice", () => {
    process.stdout.write(`\n[simulation-reseau] matrice (pire client par réseau) : ${JSON.stringify(matrice)}\n`);
    expect(Object.keys(matrice).length).toBeGreaterThan(0);
  });

  it("rafale de 300 ms sur un réseau de 100 ms avec 1 % de perte : un rollback par image, puis convergence complète", () => {
    const sim = creerSimulation({ latenceMs: 100, gigueMs: 15, perte: 0.01, graine: 31 });
    sim.jouer(12_000);
    const a = sim.joueurs[0];
    a.liaison.descendant.retenir(300, sim.T.t);
    sim.jouer(300);
    const t0 = sim.T.t;
    sim.jouer(PAS_MS * 8 + 200);
    const gros = a.rollbacks.filter((r) => r.t >= t0 - 100 && r.t <= t0 + 200);
    // une seule image applique la rafale (un instantané coalescé), jamais deux rollbacks dans la même image
    const parImage = new Map<number, number>();
    for (const r of a.rollbacks) parImage.set(r.t, (parImage.get(r.t) ?? 0) + 1);
    expect(Math.max(...parImage.values())).toBe(1);
    expect(Math.max(...gros.map((r) => r.ms))).toBeLessThan(IMAGE_MS * 2);
    figer(sim);
    sim.jouer(6000);
    for (const j of sim.joueurs) expect(ecartAuJumeau(sim, j)).toBeLessThan(0.05);
  });

  it("deux rafales de retard (200 ms puis 500 ms) dans des sens différents : le client ne dérive pas et converge", () => {
    const sim = creerSimulation({ latenceMs: 60, gigueMs: 10, graine: 32 });
    sim.jouer(8000);
    sim.joueurs[0].liaison.descendant.retenir(200, sim.T.t);
    sim.joueurs[1].liaison.montant.retenir(500, sim.T.t);
    sim.jouer(4000);
    for (const j of sim.joueurs) expect(j.client.stats().resyncs).toBeLessThanOrEqual(3);
    figer(sim);
    sim.jouer(8000);
    for (const j of sim.joueurs) {
      const serveur = sim.salle.monde() as { tick: number };
      expect(j.client.monde.tick - serveur.tick).toBeGreaterThanOrEqual(RESEAU.avanceMinTicks);
      expect(j.client.monde.tick - serveur.tick).toBeLessThan(40);
      expect(ecartAuJumeau(sim, j)).toBeLessThan(0.05);
    }
  });

  it("le réseau change en cours de partie (30 ms puis 200 ms puis 30 ms) : l'horloge suit, aucune divergence permanente", () => {
    const sim = creerSimulation({ latenceMs: 30, gigueMs: 5, graine: 33 });
    sim.jouer(10_000);
    for (const j of sim.joueurs) j.liaison.configurer({ latenceMs: 200, gigueMs: 20 });
    sim.jouer(15_000);
    for (const j of sim.joueurs) {
      const serveur = sim.salle.monde() as { tick: number };
      expect(j.client.monde.tick - serveur.tick, "avance suffisante pour 200 ms").toBeGreaterThanOrEqual(200 * TPM * 0.8);
    }
    for (const j of sim.joueurs) j.liaison.configurer({ latenceMs: 30, gigueMs: 5 });
    sim.jouer(15_000);
    figer(sim);
    sim.jouer(8000);
    for (const j of sim.joueurs) {
      expect(ecartAuJumeau(sim, j)).toBeLessThan(0.05);
      const serveur = sim.salle.monde() as { tick: number };
      expect(j.client.monde.tick - serveur.tick).toBeLessThan(40);
    }
  });
});

describe("but autoritaire : un seul but par but, chez tous les clients, jamais annoncé par la seule prédiction", () => {
  /** force un but en plaçant la balle dans la cage (z = ±56) : même chose pour les deux équipes à tour de rôle */
  function forcerBut(sim: Simulation, signe: 1 | -1): void {
    sim.router(sim.salle.recevoir(1, { t: "dev", action: "balle", p: [0, 2, 56 * signe], v: [0, 0, 0] }, sim.T.t), sim.T.t);
  }

  it.each([[30, 5, 0], [100, 20, 0.01], [200, 30, 0]])("réseau %i ms / gigue %i / perte %f : trois buts forcés, un événement `but` par but et par client, scores identiques à tout instant", (latenceMs, gigueMs, perte) => {
    const sim = creerSimulation({ latenceMs, gigueMs, perte, graine: 40 + latenceMs });
    sim.jouer(8000);
    const attendu: { bleue: number; orange: number }[] = [];
    for (let k = 0; k < 3; k++) {
      // attendre la remise en jeu (phase de jeu) avant de forcer le but suivant
      let garde = 0;
      while ((sim.salle.monde() as { phase: string }).phase !== "enJeu" && garde++ < 100) sim.jouer(200);
      expect((sim.salle.monde() as { phase: string }).phase).toBe("enJeu");
      forcerBut(sim, k % 2 === 0 ? 1 : -1);
      // ... pendant tout l'intervalle, jamais plus de buts affichés que le serveur n'en a comptés
      for (let i = 0; i < 80; i++) {
        sim.jouer(IMAGE_MS);
        const sv = sim.salle.monde() as { score: { bleue: number; orange: number } };
        for (const j of sim.joueurs) {
          const aff = j.client.mondeAffiche(sim.T.t);
          expect(aff.score.bleue + aff.score.orange).toBeLessThanOrEqual(sv.score.bleue + sv.score.orange);
        }
      }
      sim.jouer(1000 + 2 * latenceMs);
      const sv = sim.salle.monde() as { score: { bleue: number; orange: number } };
      attendu.push({ ...sv.score });
      expect(sv.score.bleue + sv.score.orange).toBe(k + 1);
      for (const j of sim.joueurs) expect(j.client.mondeAffiche(sim.T.t).score).toEqual(sv.score);
    }
    // un événement `but` côté serveur par but, exactement un chez chaque client (pas de doublon par rollback, pas de but prédit joué)
    const butsServeur = sim.veriteTous.filter((e) => e.t === "but");
    expect(butsServeur).toHaveLength(3);
    for (const j of sim.joueurs) {
      const buts = j.recus.filter((e) => e.t === "but");
      expect(buts).toHaveLength(3);
      expect(buts).toEqual(butsServeur);
      // les événements de célébration / remise en jeu ne sont pas dupliqués non plus
      for (const t of ["coupDEnvoi", "decompte"] as const) {
        expect(j.recus.filter((e) => e.t === t).length).toBe(sim.veriteTous.filter((e) => e.t === t).length);
      }
    }
    expect(attendu[2].bleue + attendu[2].orange).toBe(3);
  });

  it("un but marqué naturellement dans la prédiction mais pas par le serveur n'est jamais joué ni affiché (garde de phase)", () => {
    const sim = creerSimulation({ latenceMs: 100, gigueMs: 10, graine: 50 });
    sim.jouer(8000);
    // coup de balle côté client SEUL : le monde prédit voit un but, le serveur non
    const j = sim.joueurs[0];
    const m = j.client.monde;
    m.balle.p = [0, 2, 55.9]; m.balle.v = [0, 0, 40];
    for (let i = 0; i < 40; i++) {
      sim.image(j, sim.T.t);
      const aff = j.client.mondeAffiche(sim.T.t);
      expect(aff.score.bleue + aff.score.orange).toBe(0);
      expect(aff.phase).not.toBe("but");
    }
    // l'instantané suivant ramène la vérité ; aucun événement `but` n'a été reçu
    sim.jouer(1500);
    expect(j.recus.filter((e) => e.t === "but")).toHaveLength(0);
    expect(j.client.mondeAffiche(sim.T.t).score).toEqual({ bleue: 0, orange: 0 });
  });
});

describe("coût du rollback (mesure, CPU réel de la machine de test)", () => {
  const rapport: Record<string, Record<string, number>> = {};
  it.each([["1v1" as Format, 40], ["1v1" as Format, 150], ["2v2" as Format, 40], ["3v3" as Format, 40], ["3v3" as Format, 150], ["3v3" as Format, 250]] as [Format, number][])("format %s, latence %i ms : 40 s de jeu avec bots nerveux, coût mesuré par rollback", (format, latenceMs) => {
    const sim = creerSimulation({ latenceMs, gigueMs: 10, graine: 60 + latenceMs, format });
    sim.jouer(40_000);
    const tous: number[] = [], profondeurs: number[] = [];
    let rollbacks = 0;
    for (const j of sim.joueurs) {
      for (const r of j.rollbacks) { tous.push(r.ms); profondeurs.push(r.profondeur); }
      rollbacks += j.client.stats().rollbacks;
    }
    expect(tous.length).toBeGreaterThan(100);
    const moy = tous.reduce((a, b) => a + b, 0) / tous.length;
    const med = percentile(tous, 0.5), p99 = percentile(tous, 0.99), max = Math.max(...tous);
    rapport[`${format} ${latenceMs} ms`] = { rollbacks, profondeurMoy: Math.round(profondeurs.reduce((a, b) => a + b, 0) / profondeurs.length), moyMs: +moy.toFixed(2), medMs: +med.toFixed(2), p99Ms: +p99.toFixed(2), maxMs: +max.toFixed(2) };
    // Bornes larges (JIT à froid, machine partagée) : le régime normal tient dans une fraction d'image (16 ms) ; le p99 ne dépasse pas une image.
    // (le coût croît avec la profondeur, donc avec la latence : à 250 ms un rollback rejoue ~70 ticks de six voitures ; mesuré 2,8 ms au repos,
    // jusqu'à 10 ms sur une machine chargée, y compris avant la révision de jouabilité)
    const borne = format === "3v3" ? (latenceMs >= 250 ? 16 : 8) : 5;
    expect(moy).toBeLessThan(borne);
    expect(med).toBeLessThan(borne);
    expect(p99).toBeLessThan(IMAGE_MS * 2);
    // 20 rollbacks par seconde et par client au plus (un par instantané) : part du CPU consommée par le rejeu
    const parSeconde = (j: Joueur) => j.rollbacks.length / 40;
    for (const j of sim.joueurs) expect(parSeconde(j)).toBeLessThanOrEqual(22);
  });

  it("rapport du coût du rollback", () => {
    process.stdout.write(`\n[simulation-reseau] coût du rollback par format et latence : ${JSON.stringify(rapport)}\n`);
    expect(Object.keys(rapport).length).toBe(6);
  });
});
