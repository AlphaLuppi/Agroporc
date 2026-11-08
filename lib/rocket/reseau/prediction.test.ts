import { describe, expect, it } from "vitest";
import { DEFAUT_CONFIG, PAS_S } from "../contrat";
import type { ConfigMatch, EvenementMatch, Format } from "../contrat";
import { creerMonde, pasMonde } from "../match";
import { baseDepuisCap } from "../vec";
import { creerHorloge } from "./horloge";
import { creerMondeEnLigne } from "./monde-ligne";
import { creerPredicteur } from "./prediction";
import type { EntreesQuantifiees, HorlogeRocket, PredicteurRocket, SnapRocket, TrameEntrees, VoitureStatique } from "./protocole";
import { AVANCE_INCONNUE, ENTREES_QUANTIFIEES_NULLES, RESEAU, TICKS_PAR_S } from "./protocole";
import { decoderSnap, dequantifierEntrees, encoderSnap, extraireEtat, quantifierEntrees, restaurerEtat } from "./serialisation";

const TPM = TICKS_PAR_S / 1000;
const NEUTRE = (): EntreesQuantifiees => ENTREES_QUANTIFIEES_NULLES();
const GAZ = (): EntreesQuantifiees => ({ ...NEUTRE(), accel: 127 });
const BRUTES = (e: Partial<ReturnType<typeof dequantifierEntrees>> = {}) => ({ ...dequantifierEntrees(NEUTRE()), ...e });

type FonctionAdversaire = (tick: number, id: number) => EntreesQuantifiees;

interface Options {
  format?: Format;
  adversaire?: FonctionAdversaire;
  horloge?: HorlogeRocket;
  /** instantanés mis en file au lieu d'être livrés au client */
  manuel?: boolean;
}

/**
 * Banc de test : un « serveur » minimal (le vrai `pasMonde`, les vrais codecs) qui joue les entrées reçues du client et celles d'un adversaire
 * scripté, et un prédicteur réel avec sa vraie horloge. Latence nulle, temps piloté à la main : chaque scénario est exact.
 */
function creerBanc(o: Options = {}) {
  const config: ConfigMatch = { ...DEFAUT_CONFIG(), format: o.format ?? "1v1", graine: 11 };
  const modele = creerMonde(config);
  const statiques: VoitureStatique[] = modele.voitures.map((v) => ({ id: v.id, equipe: v.equipe, slot: v.slot, humain: v.humain, nom: v.nom, joueur: v.humain ? 1 : null }));
  const moi = modele.idHumain;
  const serveur = creerMondeEnLigne(config, statiques, -1);
  const horloge = o.horloge ?? creerHorloge();
  const debut = { t: "debut" as const, config, voitures: statiques, moi, numero: 3 };
  const client = creerPredicteur({ horloge, debut });

  const banc = {
    config, statiques, moi, serveur, horloge, client, debut,
    t: 0,
    adversaire: o.adversaire ?? (() => NEUTRE()),
    manuel: !!o.manuel,
    file: [] as SnapRocket[],
    /** entrées de MA voiture vues par le serveur (par tick) et ce qu'il a effectivement appliqué */
    recues: new Map<number, EntreesQuantifiees>(),
    miennes: new Map<number, EntreesQuantifiees>(),
    derniere: NEUTRE(),
    plusGrandRecu: -1,
    appliquees: serveur.voitures.map(() => NEUTRE()),
    evenements: [] as { tick: number; e: EvenementMatch }[],
    avanceFenetre: AVANCE_INCONNUE as number,
    manqueesFenetre: 0,
    snapsLivres: 0,
    trames: [] as TrameEntrees[],

    recevoirTrame(tr: TrameEntrees): void {
      banc.trames.push(tr);
      tr.entrees.forEach((q, k) => {
        const tick = tr.tickDebut + k;
        banc.miennes.set(tick, q);
        if (tick < serveur.tick || banc.recues.has(tick)) return;
        banc.recues.set(tick, q);
        banc.avanceFenetre = banc.avanceFenetre === AVANCE_INCONNUE ? tick - serveur.tick : Math.min(banc.avanceFenetre, tick - serveur.tick);
        if (tick > banc.plusGrandRecu) { banc.plusGrandRecu = tick; banc.derniere = q; }
      });
    },

    construireSnap(): SnapRocket {
      const brut: SnapRocket = {
        tick: serveur.tick, ralenti: false, numero: debut.numero, nbVoitures: serveur.voitures.length, entreesRecuesJusqua: banc.plusGrandRecu,
        avance: banc.avanceFenetre, manquees: Math.min(banc.manqueesFenetre, 255), entrees: banc.appliquees.map((q) => ({ ...q })), etat: extraireEtat(serveur),
      };
      banc.avanceFenetre = AVANCE_INCONNUE;
      banc.manqueesFenetre = 0;
      return decoderSnap(encoderSnap(brut)) as SnapRocket;
    },

    /** un pas du serveur ; renvoie l'instantané s'il tombe sur la grille */
    pasServeur(): SnapRocket | null {
      const k = serveur.tick;
      const entrees = serveur.voitures.map((_, i) => {
        if (i === moi) {
          const q = banc.recues.get(k);
          if (!q) banc.manqueesFenetre++;
          return q ?? banc.derniere;
        }
        return banc.adversaire(k, i);
      });
      banc.appliquees = entrees;
      const ev = pasMonde(serveur, entrees.map((q) => dequantifierEntrees(q)), PAS_S);
      for (const e of ev) banc.evenements.push({ tick: k, e });
      return serveur.tick % RESEAU.cadenceSnapTicks === 0 ? banc.construireSnap() : null;
    },

    serveurJusqua(tick: number): void {
      while (serveur.tick < tick) {
        const s = banc.pasServeur();
        if (s) banc.livrer(s);
      }
    },

    livrer(s: SnapRocket): void {
      if (banc.manuel) { banc.file.push(s); return; }
      banc.snapsLivres++;
      client.recevoirSnap(s, banc.t);
    },

    /** une image du client (dt en ms) : le serveur avance d'abord au temps vrai, puis le client joue et envoie */
    image(dtMs: number, entrees = BRUTES()): ReturnType<PredicteurRocket["avancer"]> {
      banc.t += dtMs;
      banc.serveurJusqua(Math.floor(banc.t * TPM));
      const r = client.avancer(dtMs / 1000, entrees, banc.t);
      const tr = client.trameAEnvoyer(banc.t);
      if (tr) banc.recevoirTrame(tr);
      return r;
    },

    jouer(ms: number, entrees = BRUTES(), dtMs = 1000 / 60): void {
      for (let t = 0; t < ms; t += dtMs) banc.image(dtMs, entrees);
    },

    /** place le serveur au tick donné SANS livrer d'instantané (le temps vrai suit) */
    sauterServeurA(tick: number): void {
      const manuel = banc.manuel;
      banc.manuel = true;
      banc.serveurJusqua(tick);
      banc.manuel = manuel;
      banc.file.length = 0;
      banc.t = tick / TPM;
    },
  };
  return banc;
}
type Banc = ReturnType<typeof creerBanc>;

/** Rejoue à partir d'un instantané ce que doit être le monde du client (référence indépendante du prédicteur). */
function referenceRollback(b: Banc, snap: SnapRocket, jusquaTick: number) {
  const ref = creerMondeEnLigne(b.config, b.statiques, b.moi);
  restaurerEtat(snap.etat, ref);
  for (let k = snap.tick; k < jusquaTick; k++) {
    const entrees = ref.voitures.map((_, i) => dequantifierEntrees(i === b.moi ? (b.miennes.get(k) ?? NEUTRE()) : snap.entrees[i]));
    pasMonde(ref, entrees, PAS_S);
  }
  return ref;
}

/** Copie d'un instantané dont la balle est décalée de 1 cm : le serveur « sait mieux », le client doit refaire ses calculs. */
const deriver = (s: SnapRocket): SnapRocket => ({ ...s, octetsEtat: undefined, etat: { ...s.etat, balle: { ...s.etat.balle, p: [s.etat.balle.p[0] + 0.01, s.etat.balle.p[1], s.etat.balle.p[2]] } } });

/** Un banc déjà adopté en phase de jeu (le décompte est passé) : prêt pour les scénarios. */
function bancEnJeu(o: Options = {}): Banc {
  const b = creerBanc(o);
  b.jouer(3500); // décompte de 3 s passé, premiers instantanés livrés
  expect(b.serveur.phase).toBe("enJeu");
  return b;
}

describe("prédicteur : démarrage", () => {
  it("n'avance pas, n'est pas prêt et n'a pas d'état autoritaire avant le premier instantané", () => {
    const b = creerBanc();
    expect(b.client.pret).toBe(false);
    expect(b.client.etatAutoritaire()).toBeNull();
    const r = b.client.avancer(1 / 60, BRUTES(), 100);
    expect(r.pas).toBe(0);
    expect(r.snap).toBeNull();
    expect(b.client.monde.tick).toBe(0);
    expect(b.client.trameAEnvoyer(120)).toBeNull();
  });

  it("le premier instantané est adopté (resync) et le client se place à son tick cible", () => {
    const b = creerBanc({ manuel: true });
    b.serveurJusqua(60);
    expect(b.file.length).toBe(10);
    const snap = b.file[9];
    b.t = 500;
    expect(b.client.recevoirSnap(snap, b.t)).toBe(true);
    expect(b.client.pret).toBe(true);
    expect(b.client.etatAutoritaire()?.tick).toBe(60);
    const r = b.client.avancer(0, BRUTES(), b.t);
    expect(r.snap).toMatchObject({ rollback: false, resync: true });
    // sans RTT mesuré, la cible est « estimé + marge »
    expect(b.client.monde.tick).toBe(60 + RESEAU.margeInitialeTicks);
    expect(b.client.stats().resyncs).toBe(0);
    // le monde du client égale celui du serveur au tick de l'instantané, puis la même simulation
    const ref = referenceRollback(b, snap, b.client.monde.tick);
    expect(extraireEtat(b.client.monde)).toEqual(extraireEtat(ref));
  });

  it("ignore un instantané d'un autre match, d'une autre taille, ou plus ancien que celui déjà appliqué", () => {
    const b = creerBanc({ manuel: true });
    b.serveurJusqua(120);
    const s = b.file[10];
    expect(b.client.recevoirSnap({ ...s, numero: 4 }, 100)).toBe(false);
    expect(b.client.recevoirSnap({ ...s, nbVoitures: 4 }, 100)).toBe(false);
    expect(b.client.pret).toBe(false);
    expect(b.client.recevoirSnap(s, 1000)).toBe(true);
    expect(b.client.recevoirSnap(b.file[5], 1010)).toBe(false); // plus ancien que l'instantané en attente
    b.client.avancer(0, BRUTES(), 1020);
    expect(b.client.recevoirSnap(s, 1030)).toBe(false); // même tick que celui appliqué
    expect(b.client.recevoirSnap(b.file[12], 1040)).toBe(true);
  });
});

describe("prédicteur : exactitude et rollback", () => {
  it("rien ne bouge (décompte, voitures figées) : tous les instantanés sont exacts, aucun rollback", () => {
    const b = creerBanc();
    b.jouer(2500);
    const s = b.client.stats();
    expect(b.serveur.phase).toBe("decompte");
    expect(s.rollbacks).toBe(0);
    expect(s.snapsExacts).toBeGreaterThan(10);
    expect(b.client.etatAutoritaire()?.phase).toBe("decompte");
  });

  it("une entrée adverse change : rollback, et le monde obtenu est exactement celui d'un rejeu indépendant depuis l'état serveur", () => {
    const b = bancEnJeu({ manuel: true });
    // livrer les instantanés déjà produits puis lancer l'adversaire
    b.client.recevoirSnap(b.file[b.file.length - 1], b.t);
    b.client.avancer(0, BRUTES(), b.t);
    b.file.length = 0;
    const depart = b.serveur.tick;
    b.adversaire = (k, id) => (id !== b.moi && k >= depart + 6 ? GAZ() : NEUTRE());
    b.jouer(400);
    expect(b.file.length).toBeGreaterThan(5);
    // l'adversaire accélère depuis plusieurs instantanés : le client, qui répète une entrée neutre, doit se tromper puis être corrigé
    const snap = b.file[b.file.length - 1];
    const tickLocal = b.client.monde.tick;
    expect(b.client.recevoirSnap(snap, b.t)).toBe(true);
    const avant = b.client.stats().rollbacks;
    const r = b.client.avancer(0, BRUTES(), b.t);
    expect(r.snap?.rollback).toBe(true);
    expect(r.snap?.profondeur).toBe(tickLocal - snap.tick);
    expect(b.client.stats().rollbacks).toBe(avant + 1);
    expect(b.client.monde.tick).toBe(tickLocal);
    const ref = referenceRollback(b, snap, tickLocal);
    expect(extraireEtat(b.client.monde)).toEqual(extraireEtat(ref));
  });

  it("un seul rollback par `avancer` malgré six instantanés en rafale ; l'horloge, elle, en voit six", () => {
    const appels = { echantillonSnap: 0, signalerAvance: 0 };
    const reelle = creerHorloge();
    const horloge: HorlogeRocket = {
      ...reelle,
      echantillonSnap: (...a) => { appels.echantillonSnap++; reelle.echantillonSnap(...a); },
      signalerAvance: (...a) => { appels.signalerAvance++; reelle.signalerAvance(...a); },
    };
    const b = bancEnJeu({ manuel: true, horloge });
    b.client.recevoirSnap(b.file[b.file.length - 1], b.t);
    b.client.avancer(0, BRUTES(), b.t);
    b.file.length = 0;
    const depart = b.serveur.tick;
    b.adversaire = (k, id) => (id !== b.moi && k >= depart ? GAZ() : NEUTRE());
    b.jouer(300);
    expect(b.file.length).toBeGreaterThanOrEqual(6);
    const six = b.file.slice(-6);
    const avantHorloge = { ...appels };
    for (const s of six) expect(b.client.recevoirSnap(s, b.t)).toBe(true);
    expect(appels.echantillonSnap - avantHorloge.echantillonSnap).toBe(6);
    expect(appels.signalerAvance - avantHorloge.signalerAvance).toBe(6);
    const rollbacks = b.client.stats().rollbacks;
    const r1 = b.client.avancer(0, BRUTES(), b.t);
    expect(r1.snap?.rollback).toBe(true);
    expect(b.client.stats().rollbacks).toBe(rollbacks + 1);
    expect(r1.snap && b.client.etatAutoritaire()?.tick).toBe(six[5].tick);
    const r2 = b.client.avancer(0, BRUTES(), b.t);
    expect(r2.snap).toBeNull();
    expect(b.client.stats().rollbacks).toBe(rollbacks + 1);
  });

  it("l'anneau est réenregistré pendant un rejeu : l'instantané suivant, sur la trajectoire corrigée, est exact", () => {
    const b = bancEnJeu({ manuel: true });
    b.client.recevoirSnap(b.file[b.file.length - 1], b.t);
    b.client.avancer(0, BRUTES(), b.t);
    b.file.length = 0;
    const depart = b.serveur.tick;
    // l'adversaire passe plein gaz une fois pour toutes
    b.adversaire = (k, id) => (id !== b.moi && k >= depart + 4 ? GAZ() : NEUTRE());
    b.jouer(250);
    const [premier, ...suivants] = b.file.filter((s) => s.tick > depart);
    expect(premier).toBeDefined();
    // premier instantané reçu : le client a prédit une voiture adverse immobile, il se trompe
    b.client.recevoirSnap(premier, b.t);
    const r = b.client.avancer(0, BRUTES(), b.t);
    expect(r.snap?.rollback).toBe(true);
    // le suivant (entrée adverse désormais connue et constante) est reproduit à l'identique par la trajectoire rejouée
    const exacts = b.client.stats().snapsExacts, rollbacks = b.client.stats().rollbacks;
    // l'état d'un instantané plus récent que le premier suffit pour que le rejeu passe par son tick : on le fournit encore à l'ordre
    const suivant = suivants.find((s) => s.tick <= b.client.monde.tick);
    expect(suivant).toBeDefined();
    b.client.recevoirSnap(suivant as SnapRocket, b.t);
    const r2 = b.client.avancer(0, BRUTES(), b.t);
    expect(r2.snap).toMatchObject({ rollback: false, resync: false });
    expect(b.client.stats().snapsExacts).toBe(exacts + 1);
    expect(b.client.stats().rollbacks).toBe(rollbacks);
  });

  it("un instantané hors grille n'a pas d'homologue : toujours un rollback, même si l'état est identique ; sur la grille il est exact", () => {
    const b = bancEnJeu({ manuel: true });
    b.client.recevoirSnap(b.file[b.file.length - 1], b.t);
    b.client.avancer(0, BRUTES(), b.t);
    b.file.length = 0;
    const etatIdentique = (tick: number): SnapRocket => decoderSnap(encoderSnap({
      tick, ralenti: false, numero: 3, nbVoitures: 2, entreesRecuesJusqua: tick, avance: 5, manquees: 0,
      entrees: b.client.monde.voitures.map(() => NEUTRE()), etat: extraireEtat(b.client.monde),
    })) as SnapRocket;
    // monde du client arrêté sur un tick qui n'est pas un multiple de 6, avec un état copié sur lui-même
    while (b.client.monde.tick % 6 === 0) b.client.avancer(1 / 120 + 1e-9, BRUTES(), (b.t += 1000 / 120));
    const horsGrille = etatIdentique(b.client.monde.tick);
    expect(horsGrille.tick % 6).not.toBe(0);
    expect(b.client.recevoirSnap(horsGrille, b.t)).toBe(true);
    const r = b.client.avancer(0, BRUTES(), b.t);
    expect(r.snap).toMatchObject({ rollback: true, profondeur: 0, resync: false });
    expect(r.snap?.ecartM).toBeLessThan(1e-9);
    // même état, mais sur la grille et au tick atteint pas à pas : exact
    while (b.client.monde.tick % 6 !== 0) b.client.avancer(1 / 120 + 1e-9, BRUTES(), (b.t += 1000 / 120));
    const sur = etatIdentique(b.client.monde.tick);
    expect(sur.tick % 6).toBe(0);
    expect(b.client.recevoirSnap(sur, b.t)).toBe(true);
    expect(b.client.avancer(0, BRUTES(), b.t).snap).toMatchObject({ rollback: false, resync: false });
  });

  it("profondeur excessive (> 180 ticks) : l'état serveur est adopté, le rejeu abandonné (resync)", () => {
    const b = bancEnJeu({ manuel: true });
    b.client.recevoirSnap(b.file[b.file.length - 1], b.t);
    b.client.avancer(0, BRUTES(), b.t);
    const ancien = b.file[b.file.length - 1];
    b.file.length = 0;
    // le client avance de 3 s sans jamais recevoir d'instantané (le serveur continue : on ignore ce qu'il envoie)
    b.manuel = true;
    b.jouer(3000);
    expect(b.client.monde.tick - ancien.tick).toBeGreaterThan(RESEAU.profondeurMaxRollback);
    const resyncs = b.client.stats().resyncs;
    // un instantané très en arrière dans le temps, mais plus récent que le dernier appliqué
    const vieux = b.file.find((s) => s.tick > ancien.tick) as SnapRocket;
    expect(vieux).toBeDefined();
    b.client.recevoirSnap(vieux, b.t);
    expect(b.client.monde.tick - vieux.tick).toBeGreaterThan(RESEAU.profondeurMaxRollback);
    const r = b.client.avancer(0, BRUTES(), b.t);
    expect(r.snap?.resync).toBe(true);
    expect(b.client.stats().resyncs).toBe(resyncs + 1);
    expect(b.client.monde.tick - vieux.tick).toBeLessThanOrEqual(RESEAU.profondeurMaxRollback);
    expect(b.client.etatAutoritaire()?.tick).toBe(vieux.tick);
  });

  it("le client en retard sur le serveur (instantané plus récent que son tick) adopte l'état serveur et se place à la cible", () => {
    const b = creerBanc({ manuel: true });
    b.serveurJusqua(60);
    b.client.recevoirSnap(b.file[9], 500);
    b.client.avancer(0, BRUTES(), 500);
    // 2 s plus tard : le client n'a rien joué (onglet masqué) mais le serveur est à 60 + 240 et ses instantanés arrivent d'un coup
    b.serveurJusqua(300);
    const rafale = b.file.slice(10);
    rafale.forEach((s, i) => b.client.recevoirSnap(s, 2500 + i));
    const r = b.client.avancer(1 / 60, BRUTES(), 2500 + rafale.length);
    expect(r.snap).toMatchObject({ rollback: false, resync: true });
    expect(b.client.monde.tick).toBeGreaterThanOrEqual(300);
    expect(b.client.monde.tick).toBeLessThanOrEqual(300 + RESEAU.margeMaxTicks + 3);
    expect(b.client.stats().resyncs).toBe(1);
  });
});

describe("prédicteur : horloge, cadence, resynchronisations", () => {
  it("régime établi sans perte : le client a une avance positive sur le serveur et aucune entrée manquée", () => {
    const b = creerBanc();
    let manquees = 0, avanceMin = 127;
    const sp = b.client.recevoirSnap.bind(b.client);
    b.livrer = (s) => { if (s.avance !== AVANCE_INCONNUE) avanceMin = Math.min(avanceMin, s.avance); if (b.t > 2000) manquees += s.manquees; sp(s, b.t); };
    b.jouer(10_000);
    expect(manquees).toBe(0);
    expect(b.client.monde.tick - b.serveur.tick).toBeGreaterThanOrEqual(RESEAU.avanceMinTicks);
    expect(avanceMin).toBeGreaterThanOrEqual(0);
  });

  it("onglet masqué puis retour : un seul rattrapage, pas de rafale d'entrées périmées, trame contiguë de 12 ticks au plus", () => {
    const b = bancEnJeu();
    b.jouer(1000);
    const tickAvant = b.client.monde.tick;
    // 4 s sans aucune image du client ; le serveur continue (les entrées neutres lui sont répétées)
    b.t += 4000;
    b.serveurJusqua(Math.floor(b.t * TPM));
    expect(b.serveur.tick - tickAvant).toBeGreaterThan(400);
    const trames = b.trames.length;
    // retour : instantanés en rafale puis une image
    const r = b.client.avancer(1 / 60, BRUTES(), b.t);
    expect(r.pas).toBeLessThanOrEqual(RESEAU.pasMaxParImageEnLigne);
    expect(b.client.monde.tick).toBeGreaterThan(b.serveur.tick - 2);
    const tr = b.client.trameAEnvoyer(b.t + 20);
    expect(tr).not.toBeNull();
    expect((tr as TrameEntrees).entrees.length).toBeLessThanOrEqual(RESEAU.entreesMaxParTrame);
    expect((tr as TrameEntrees).tickDebut + (tr as TrameEntrees).entrees.length - 1).toBe(b.client.monde.tick - 1);
    expect(b.trames.length).toBe(trames);
    expect(b.client.stats().resyncs + b.client.stats().rollbacks).toBeGreaterThan(0);
  });

  it("client en retard sans instantané neuf (image très longue) : rattrape jusqu'au tick cible d'un coup, borné par la profondeur max", () => {
    const b = bancEnJeu();
    b.jouer(500);
    const tick0 = b.client.monde.tick;
    const resyncs = b.client.stats().resyncs;
    // 1,2 s sans image, instantanés non livrés (réseau figé) : la cible avance sans que rien ne la corrige
    b.t += 1200;
    const cible = Math.round(b.horloge.tickCible(b.t));
    expect(cible - tick0).toBeGreaterThan(RESEAU.resyncEcartTicks);
    const r = b.client.avancer(1 / 60, BRUTES(), b.t);
    expect(b.client.monde.tick).toBeGreaterThan(tick0 + RESEAU.pasMaxParImageEnLigne);
    expect(b.client.monde.tick).toBeLessThanOrEqual(cible + 2);
    expect(r.pas).toBeLessThanOrEqual(RESEAU.pasMaxParImageEnLigne);
    expect(b.client.stats().resyncs).toBe(resyncs + 1);
  });

  it("client en avance (écart < -24) : il attend, il ne recule jamais, aucun pas, tick inchangé", () => {
    const b = bancEnJeu();
    b.jouer(500);
    const tick0 = b.client.monde.tick;
    // le temps « recule » de 600 ms pour l'horloge : la cible tombe 72 ticks en dessous du tick local
    const r = b.client.avancer(1 / 60, BRUTES(), b.t - 600);
    expect(r.pas).toBe(0);
    expect(b.client.monde.tick).toBe(tick0);
    expect(b.horloge.cadence(tick0, b.t - 600).resync).toBe("arriere");
    // et il repart quand la cible l'a rattrapé
    const r2 = b.client.avancer(0.05, BRUTES(), b.t);
    expect(r2.pas).toBeGreaterThan(0);
  });

  it("image très longue (250 ms plafonnées) : au plus `pasMaxParImageEnLigne` pas par appel en régime normal", () => {
    const b = bancEnJeu();
    b.jouer(300);
    const r = b.client.avancer(5, BRUTES(), b.t + 0.001);
    expect(r.pas).toBeLessThanOrEqual(RESEAU.pasMaxParImageEnLigne);
  });

  it("plus aucun pas ni resynchronisation une fois la phase « fini » atteinte", () => {
    const b = bancEnJeu();
    b.jouer(200);
    b.client.monde.phase = "fini";
    const tick = b.client.monde.tick;
    const resyncs = b.client.stats().resyncs;
    b.t += 3000;
    const r = b.client.avancer(1 / 60, BRUTES(), b.t);
    expect(r.pas).toBe(0);
    expect(b.client.monde.tick).toBe(tick);
    expect(b.client.stats().resyncs).toBe(resyncs);
  });
});

describe("prédicteur : entrées locales et trames", () => {
  it("une trame contient les entrées quantifiées jouées, en bloc contigu terminé au dernier tick simulé, avec 3 ticks de redondance", () => {
    const b = bancEnJeu();
    const entrees = BRUTES({ accel: 1, direction: -0.5, boost: true });
    b.jouer(300, entrees);
    const q = quantifierEntrees(entrees);
    const dernieres = b.trames.slice(-2);
    for (const tr of dernieres) {
      expect(tr.numero).toBe(3);
      expect(tr.entrees.length).toBeLessThanOrEqual(RESEAU.entreesMaxParTrame);
      for (const e of tr.entrees) expect(e).toEqual(q);
    }
    const [a, c] = dernieres;
    // la trame suivante reprend `redondanceEntrees` ticks avant le premier tick neuf
    expect(c.tickDebut).toBe(a.tickDebut + a.entrees.length - RESEAU.redondanceEntrees);
  });

  it("rien de neuf ou trop tôt : null ; écriture unique de l'historique (une entrée envoyée n'est jamais réécrite)", () => {
    const b = bancEnJeu();
    b.image(1000 / 60, BRUTES({ accel: 1 }));
    expect(b.client.trameAEnvoyer(b.t)).toBeNull(); // déjà envoyée par `image`
    b.client.avancer(1 / 60, BRUTES({ accel: -1 }), b.t + 20);
    expect(b.client.trameAEnvoyer(b.t + 21)).not.toBeNull();
    expect(b.client.trameAEnvoyer(b.t + 22)).toBeNull(); // trop tôt (< 10 ms) et rien de neuf
    // les ticks déjà envoyés gardent leur valeur dans les trames suivantes
    const vus = new Map<number, EntreesQuantifiees>();
    for (const tr of b.trames) tr.entrees.forEach((e, k) => {
      const prec = vus.get(tr.tickDebut + k);
      if (prec) expect(e).toEqual(prec);
      vus.set(tr.tickDebut + k, e);
    });
  });

  it("après plus de 12 ticks sans envoi, la trame ne porte que les 12 plus récents (les plus anciens ne sont jamais envoyés)", () => {
    const b = bancEnJeu();
    const e = BRUTES({ accel: 1 });
    // 8 images sans envoyer (on n'appelle pas trameAEnvoyer) : plus de 12 ticks neufs
    for (let i = 0; i < 12; i++) { b.t += 1000 / 60; b.serveurJusqua(Math.floor(b.t * TPM)); b.client.avancer(1 / 60, e, b.t); }
    const tr = b.client.trameAEnvoyer(b.t) as TrameEntrees;
    expect(tr.entrees).toHaveLength(RESEAU.entreesMaxParTrame);
    expect(tr.tickDebut + tr.entrees.length - 1).toBe(b.client.monde.tick - 1);
  });

  it("les entrées non finies ou hors bornes sont quantifiées comme le serveur le fera", () => {
    const b = bancEnJeu();
    b.image(1000 / 60, BRUTES({ accel: Number.NaN, direction: 7, tangage: -9 }));
    const tr = b.trames[b.trames.length - 1];
    expect(tr.entrees[tr.entrees.length - 1]).toMatchObject({ accel: 0, direction: 127, tangage: -127 });
  });
});

describe("prédicteur : événements", () => {
  it("les événements de MA voiture sont rendus par `avancer` tout de suite, une seule fois, jamais rejoués par un rollback", () => {
    const b = bancEnJeu({ manuel: true });
    b.client.recevoirSnap(b.file[b.file.length - 1], b.t);
    b.client.avancer(0, BRUTES(), b.t);
    b.file.length = 0;
    const depart = b.serveur.tick;
    b.adversaire = (k, id) => (id !== b.moi && k >= depart && Math.floor(k / 20) % 2 === 0 ? GAZ() : NEUTRE());
    let sauts = 0;
    for (let cycle = 0; cycle < 4; cycle++) {
      // une pression du bouton de saut, jouée tout de suite par la prédiction
      const r = b.image(1000 / 60, BRUTES({ saut: true }));
      const ceCycle = r.evenementsLocaux.filter((e) => e.t === "saut");
      expect(ceCycle).toHaveLength(1);
      expect((ceCycle[0] as { idVoiture: number }).idVoiture).toBe(b.moi);
      sauts++;
      for (let i = 0; i < 4; i++) sauts += b.image(1000 / 60, BRUTES()).evenementsLocaux.filter((e) => e.t === "saut").length;
      // le dernier instantané arrive : la fenêtre rejouée contient le tick du saut, mais le rollback ne rend aucun événement
      const s = decoderSnap(encoderSnap(deriver(b.file[b.file.length - 1]))) as SnapRocket;
      expect(s.tick).toBeLessThan(b.client.monde.tick - 3);
      b.file.length = 0;
      const rollbacks = b.client.stats().rollbacks;
      b.client.recevoirSnap(s, b.t);
      const r2 = b.client.avancer(0, BRUTES(), b.t);
      expect(r2.snap?.rollback).toBe(true);
      expect(b.client.stats().rollbacks).toBe(rollbacks + 1);
      expect(r2.evenementsLocaux).toEqual([]);
      // la voiture retombe avant le cycle suivant
      b.jouer(1500, BRUTES());
      b.file.length = 0;
    }
    expect(sauts).toBe(4);
  });

  it("toucheBalle de MA voiture est joué à la prédiction, puis retiré quand le serveur le confirme (±6 ticks, une fois chacun)", () => {
    const b = creerBanc({ manuel: true });
    b.sauterServeurA(420);
    b.serveur.phase; // enJeu
    // instantané manuel au tick 420
    b.client.recevoirSnap(b.construireSnap(), b.t);
    b.client.avancer(0, BRUTES(), b.t);
    expect(b.client.monde.phase).toBe("enJeu");
    // ma voiture lancée sur la balle (dans le MONDE PRÉDIT seulement)
    const v = b.client.monde.voitures[b.moi];
    v.p = [0, 0.17, -4]; v.v = [0, 0, 14]; v.w = [0, 0, 0]; v.boost = 50; v.figee = false; v.base = baseDepuisCap(0);
    b.client.monde.balle.p = [0, 0.92, 0]; b.client.monde.balle.v = [0, 0, 0]; b.client.monde.balle.w = [0, 0, 0];
    const locaux: { tick: number; e: EvenementMatch }[] = [];
    for (let i = 0; i < 200 && locaux.length === 0; i++) {
      const tick = b.client.monde.tick;
      const r = b.client.avancer(1 / 120 + 1e-9, BRUTES({ accel: 1 }), b.t + i * (1000 / 120));
      for (const e of r.evenementsLocaux) if (e.t === "toucheBalle") locaux.push({ tick: tick, e });
      b.t += 0; // temps de l'horloge : sans importance ici
    }
    expect(locaux.length).toBeGreaterThanOrEqual(1);
    const { tick, e } = locaux[0];
    expect((e as { idVoiture: number }).idVoiture).toBe(b.moi);
    // le serveur confirme (tick voisin) : retiré une fois
    expect(b.client.filtrerEvenements([{ tick: tick + 3, e }])).toEqual([]);
    // une seconde confirmation du même événement (déjà apparié) est jouée : pas de deuxième événement local
    expect(b.client.filtrerEvenements([{ tick: tick + 4, e }])).toEqual([e]);
  });

  it("appariement : hors de ±6 ticks, un événement serveur n'est pas retiré ; boost on / off ne se confondent pas", () => {
    const b = bancEnJeu();
    const loc: EvenementMatch[] = [];
    const ticks: number[] = [];
    for (let i = 0; i < 40; i++) {
      const tick = b.client.monde.tick;
      const r = b.image(1000 / 60, BRUTES({ accel: 1, boost: i < 10 }));
      for (const e of r.evenementsLocaux) if (e.t === "boost") { loc.push(e); ticks.push(tick); }
    }
    const on = loc.findIndex((e) => e.t === "boost" && e.actif), off = loc.findIndex((e) => e.t === "boost" && !e.actif);
    expect(on).toBeGreaterThanOrEqual(0);
    expect(off).toBeGreaterThanOrEqual(0);
    // un « boost coupé » serveur proche du tick du « boost allumé » local n'est pas confondu avec lui
    const serveurOff = { t: "boost" as const, idVoiture: b.moi, actif: false };
    expect(b.client.filtrerEvenements([{ tick: ticks[on] + 1, e: serveurOff }])).toEqual([serveurOff]);
    // trop loin du local allumé : conservé
    const serveurOn = { t: "boost" as const, idVoiture: b.moi, actif: true };
    expect(b.client.filtrerEvenements([{ tick: ticks[on] + 7 + 5000, e: serveurOn }])).toEqual([serveurOn]);
  });

  it("événements des autres voitures et événements de phase : toujours rendus ; un événement serveur de ma voiture non prédit est joué", () => {
    const b = bancEnJeu();
    const autre: EvenementMatch = { t: "saut", idVoiture: 1 };
    const but: EvenementMatch = { t: "but", equipe: "bleue", idMarqueur: 0, idPasse: null, vitesseKmh: 80 };
    const sautMoi: EvenementMatch = { t: "saut", idVoiture: b.moi };
    const base = b.client.monde.tick + 5000;
    expect(b.client.filtrerEvenements([{ tick: base, e: autre }, { tick: base + 1, e: but }, { tick: base + 2, e: sautMoi }])).toEqual([autre, but, sautMoi]);
  });

  it("un événement déjà reçu (tick plus ancien, ou message renvoyé à l'identique) est ignoré ; un nouveau prédicteur repart de zéro", () => {
    const b = bancEnJeu();
    const e: EvenementMatch = { t: "reapparition", idVoiture: 1 };
    const f: EvenementMatch = { t: "plotRecharge", idPlot: 3 };
    expect(b.client.filtrerEvenements([{ tick: 500, e }, { tick: 500, e: f }])).toEqual([e, f]);
    expect(b.client.filtrerEvenements([{ tick: 500, e }, { tick: 500, e: f }])).toEqual([]);
    expect(b.client.filtrerEvenements([{ tick: 300, e }])).toEqual([]);
    expect(b.client.filtrerEvenements([{ tick: 501, e }])).toEqual([e]);
    const neuf = creerBanc();
    expect(neuf.client.filtrerEvenements([{ tick: 100, e }])).toEqual([e]);
  });
});

describe("prédicteur : monde affiché", () => {
  it("sans correction ni décision douteuse, c'est le monde prédit lui-même", () => {
    const b = bancEnJeu();
    expect(b.client.mondeAffiche(b.t)).toBe(b.client.monde);
  });

  it("démolition prédite à tort : la voiture reste affichée à sa dernière pose valide ; confirmée par le serveur, elle apparaît démolie", () => {
    const b = bancEnJeu();
    b.jouer(200);
    const cible = 1 - b.moi;
    const avant = b.client.mondeAffiche(b.t).voitures[cible];
    const posePrecedente = [...avant.p];
    // la prédiction (seule) démolit la voiture adverse et la téléporte hors du stade
    b.client.monde.voitures[cible].demolie = true;
    b.client.monde.voitures[cible].p = [0, -100, 0];
    const affiche = b.client.mondeAffiche(b.t + 1);
    expect(affiche.voitures[cible].demolie).toBe(false);
    for (let c = 0; c < 3; c++) expect(Number.isFinite(affiche.voitures[cible].p[c])).toBe(true);
    expect(affiche.voitures[cible].p[1]).toBeGreaterThan(-1);
    expect(affiche.voitures[cible].p).not.toEqual([0, -100, 0]);
    expect(posePrecedente[1]).toBeGreaterThan(-1);
    // le monde prédit n'a pas été altéré
    expect(b.client.monde.voitures[cible].demolie).toBe(true);
    expect(b.client.monde.voitures[cible].p).toEqual([0, -100, 0]);
    // confirmation par un événement serveur
    b.client.filtrerEvenements([{ tick: b.client.etatAutoritaire()?.tick ?? 0, e: { t: "demolition", victime: cible, auteur: b.moi, p: [0, 0, 0] } }]);
    const confirme = b.client.mondeAffiche(b.t + 2);
    expect(confirme.voitures[cible].demolie).toBe(true);
    // une réapparition ultérieure annule la confirmation
    b.client.monde.voitures[cible].demolie = true;
    b.client.filtrerEvenements([{ tick: (b.client.etatAutoritaire()?.tick ?? 0) + 5, e: { t: "reapparition", idVoiture: cible } }]);
    expect(b.client.mondeAffiche(b.t + 3).voitures[cible].demolie).toBe(false);
  });

  it("but et fin prédits à tort ne s'affichent pas (phase, score, vainqueur) ; un événement serveur les confirme", () => {
    const b = bancEnJeu();
    b.jouer(100);
    const W = b.client.monde;
    W.score = { bleue: 1, orange: 0 };
    W.phase = "but";
    W.dernierBut = { equipe: "bleue", idMarqueur: b.moi, idPasse: null, vitesseKmh: 70 };
    const sans = b.client.mondeAffiche(b.t + 1);
    expect(sans.phase).toBe("enJeu");
    expect(sans.score).toEqual({ bleue: 0, orange: 0 });
    expect(sans.dernierBut).toBeNull();
    expect(W.phase).toBe("but");
    expect(W.score.bleue).toBe(1);
    const tickAuth = b.client.etatAutoritaire()?.tick ?? 0;
    b.client.filtrerEvenements([{ tick: tickAuth + 2, e: { t: "but", equipe: "bleue", idMarqueur: b.moi, idPasse: null, vitesseKmh: 70 } }]);
    const avec = b.client.mondeAffiche(b.t + 2);
    expect(avec.phase).toBe("but");
    expect(avec.score).toEqual({ bleue: 1, orange: 0 });
    // fin prédite à tort
    W.phase = "fini"; W.vainqueur = "bleue";
    const fin = b.client.mondeAffiche(b.t + 3);
    expect(fin.phase).not.toBe("fini");
    expect(fin.vainqueur).toBeNull();
    b.client.filtrerEvenements([{ tick: tickAuth + 3, e: { t: "fin", vainqueur: "bleue" } }]);
    const finConfirmee = b.client.mondeAffiche(b.t + 4);
    expect(finConfirmee.phase).toBe("fini");
    expect(finConfirmee.vainqueur).toBe("bleue");
  });

  it("un but déjà compté dans l'état autoritaire n'est pas compté deux fois quand son événement arrive après l'instantané", () => {
    const b = bancEnJeu();
    b.jouer(100);
    const W = b.client.monde;
    const auth = b.client.etatAutoritaire() as NonNullable<ReturnType<PredicteurRocket["etatAutoritaire"]>>;
    // l'instantané reçu contient déjà le but (score 1-0)
    auth.score = { bleue: 1, orange: 0 };
    W.score = { bleue: 1, orange: 0 };
    W.phase = "but";
    b.client.filtrerEvenements([{ tick: auth.tick - 1, e: { t: "but", equipe: "bleue", idMarqueur: 0, idPasse: null, vitesseKmh: 50 } }]);
    const m = b.client.mondeAffiche(b.t + 1);
    expect(m.score).toEqual({ bleue: 1, orange: 0 });
  });

  describe("lissage", () => {
    it("continu au moment du rollback (l'affichage ne saute pas), effacé en moins de 300 ms, aussi sur `precedent`", () => {
      const b = bancEnJeu({ manuel: true });
      b.client.recevoirSnap(b.file[b.file.length - 1], b.t);
      b.client.avancer(0, BRUTES(), b.t);
      b.file.length = 0;
      const depart = b.serveur.tick;
      b.adversaire = (k, id) => (id !== b.moi && k >= depart + 2 ? GAZ() : NEUTRE());
      b.jouer(500);
      const snap = b.file[b.file.length - 1];
      const autre = 1 - b.moi;
      const avant = b.client.mondeAffiche(b.t).voitures[autre].p.slice();
      const avantPrec = b.client.mondeAffiche(b.t).precedent.voitures[autre].p.slice();
      b.client.recevoirSnap(snap, b.t);
      const r = b.client.avancer(0, BRUTES(), b.t);
      expect(r.snap?.rollback).toBe(true);
      const brut = b.client.monde.voitures[autre].p;
      const ecartBrut = Math.hypot(avant[0] - brut[0], avant[1] - brut[1], avant[2] - brut[2]);
      expect(ecartBrut).toBeGreaterThan(1e-4);
      expect(ecartBrut).toBeLessThan(RESEAU.seuilTeleportVoitureM);
      const apres = b.client.mondeAffiche(b.t).voitures[autre].p;
      for (let c = 0; c < 3; c++) expect(apres[c]).toBeCloseTo(avant[c], 9);
      // le même décalage s'applique à `precedent`
      const precAff = b.client.mondeAffiche(b.t).precedent.voitures[autre].p;
      const precBrut = b.client.monde.precedent.voitures[autre].p;
      for (let c = 0; c < 3; c++) expect(precAff[c] - precBrut[c]).toBeCloseTo(apres[c] - brut[c], 9);
      void avantPrec;
      // décroissance exponentielle de constante 60 ms
      const dec = (ms: number) => { const p = b.client.mondeAffiche(b.t + ms).voitures[autre].p; return Math.hypot(p[0] - brut[0], p[1] - brut[1], p[2] - brut[2]); };
      expect(dec(60)).toBeCloseTo(ecartBrut * Math.exp(-1), 6);
      expect(dec(300)).toBeLessThan(ecartBrut * 0.01);
      expect(b.client.mondeAffiche(b.t + 2000)).toBe(b.client.monde);
    });

    it("au-delà du seuil de téléportation (4 m), la correction est franche : aucun lissage", () => {
      const b = bancEnJeu({ manuel: true });
      b.client.recevoirSnap(b.file[b.file.length - 1], b.t);
      b.client.avancer(0, BRUTES(), b.t);
      b.jouer(100);
      const autre = 1 - b.moi;
      // l'instantané serveur est le monde prédit décalé de 10 m pour la voiture adverse (tick sur la grille et ≤ tick local)
      const tickGrille = b.client.monde.tick - (b.client.monde.tick % 6) - 6;
      expect(tickGrille).toBeGreaterThan(b.client.etatAutoritaire()?.tick ?? 0);
      const ref = creerMondeEnLigne(b.config, b.statiques, b.moi);
      restaurerEtat(extraireEtat(b.client.monde), ref);
      ref.tick = tickGrille; // l'état est celui du monde client au tick local : on ne garde que l'écart de position
      const etat = extraireEtat(ref);
      etat.tick = tickGrille;
      etat.voitures[autre].p = [etat.voitures[autre].p[0] + 10, etat.voitures[autre].p[1], etat.voitures[autre].p[2]];
      const s = decoderSnap(encoderSnap({
        tick: tickGrille, ralenti: false, numero: 3, nbVoitures: b.client.monde.voitures.length, entreesRecuesJusqua: 0, avance: 4, manquees: 0,
        entrees: [NEUTRE(), NEUTRE()], etat,
      })) as SnapRocket;
      b.client.recevoirSnap(s, b.t);
      const r = b.client.avancer(0, BRUTES(), b.t);
      expect(r.snap?.rollback).toBe(true);
      expect(b.client.stats().ecartMaxM).toBeGreaterThan(9);
      // la voiture déplacée de 10 m est affichée à sa nouvelle position, sans décalage résiduel
      expect(b.client.mondeAffiche(b.t).voitures[autre].p).toEqual(b.client.monde.voitures[autre].p);
      expect(b.client.mondeAffiche(b.t).precedent.voitures[autre].p).toEqual(b.client.monde.precedent.voitures[autre].p);
    });
  });
});

describe("prédicteur : statistiques et coût", () => {
  it("les statistiques reflètent les rollbacks (profondeur typique = avance du client sur le serveur)", () => {
    const b = bancEnJeu({ adversaire: (k, id) => (id === 1 ? (Math.floor(k / 30) % 2 ? GAZ() : NEUTRE()) : NEUTRE()) });
    b.jouer(5000);
    const s = b.client.stats();
    expect(s.tickLocal).toBe(b.client.monde.tick);
    expect(s.tickSnap).toBeGreaterThan(0);
    expect(s.rollbacks).toBeGreaterThan(5);
    expect(s.profondeurMoyenne).toBeGreaterThan(0);
    expect(s.profondeurMax).toBeGreaterThanOrEqual(s.profondeurMoyenne);
    expect(s.ecartMaxM).toBeGreaterThan(0);
    expect(s.maxRollbackMs).toBeGreaterThanOrEqual(s.dernierRollbackMs);
  });

  it("coût du rollback en 3v3 (mesure, non bloquante au-delà d'une borne très large)", () => {
    const bots = (k: number, id: number): EntreesQuantifiees => (id === 0 ? NEUTRE() : { ...NEUTRE(), accel: 127, direction: (((k >> 5) + id) % 5 - 2) * 40, boost: id % 2 === 0 });
    const b = bancEnJeu({ format: "3v3", adversaire: bots });
    b.jouer(8000, BRUTES({ accel: 1 }));
    const s = b.client.stats();
    expect(s.rollbacks).toBeGreaterThan(20);
    // en moyenne quelques ms au plus sur une machine de développement ; borne large pour ne pas être fragile en intégration continue
    expect(s.maxRollbackMs).toBeLessThan(250);
  });
});

describe("prédicteur : déterminisme du banc", () => {
  it("deux clients identiques, mêmes instantanés et mêmes entrées : états identiques", () => {
    const run = () => {
      const b = bancEnJeu({ adversaire: (k, id) => (id === 1 ? (Math.floor(k / 17) % 3 ? GAZ() : NEUTRE()) : NEUTRE()) });
      b.jouer(3000, BRUTES({ accel: 1, direction: 0.3 }));
      return extraireEtat(b.client.monde);
    };
    expect(run()).toEqual(run());
  });

  it("la cadence de simulation suit l'horloge : sur 10 s le client joue 1200 ticks ± 5 % de dilatation", () => {
    const b = creerBanc();
    b.jouer(2000);
    const t0 = b.client.monde.tick;
    b.jouer(10_000);
    const joues = b.client.monde.tick - t0;
    expect(joues).toBeGreaterThan(1200 * 0.94);
    expect(joues).toBeLessThan(1200 * 1.06);
  });
});
