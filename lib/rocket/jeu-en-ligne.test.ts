import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENTREES_NULLES, type EntreesVoiture, type EvenementMatch, type MondeRocket } from "./contrat";
import type { HudReseau, PredicteurRocket, ResultatAvance, TrameEntrees } from "./reseau/protocole";
import {
  ECART_HUD_RESEAU_MS, ENTREES_NEUTRES, choisirSource, construireHudReseau, creerCanalDegrade, creerEmetteurHudReseau, creerSourceEnLigne, creerSuiviPresence, creerSuiviRevanche,
  entreesEffectives, etatCommandes,
} from "./jeu-en-ligne";

const plein = (): EntreesVoiture => ({ accel: 1, direction: -0.5, tangage: 0.25, lacet: 0, roulis: 0.1, saut: true, boost: true, derapage: true });
const hudReseau = (over: Partial<HudReseau> = {}): HudReseau => ({ etat: "ouverte", rttMs: 40, gigueMs: 3, qualite: "bonne", commandes: "actives", absents: [], revanche: null, ...over });

describe("choix de la source", () => {
  it("locale sans option enLigne, en ligne dès qu'elle est fournie", () => {
    expect(choisirSource({})).toBe("locale");
    expect(choisirSource({ enLigne: undefined })).toBe("locale");
    expect(choisirSource({ enLigne: {} as never })).toBe("ligne");
  });
});

describe("commandes", () => {
  it("menu ouvert ou onglet masqué : commandes suspendues, le masquage prime", () => {
    expect(etatCommandes(false, false)).toBe("actives");
    expect(etatCommandes(true, false)).toBe("menu");
    expect(etatCommandes(false, true)).toBe("masque");
    expect(etatCommandes(true, true)).toBe("masque");
  });
  it("actives : copie des commandes lues (jamais l'objet partagé)", () => {
    const brut = plein();
    const e = entreesEffectives(brut, "actives");
    expect(e).toEqual(brut);
    expect(e).not.toBe(brut);
  });
  it("menu ou masqué : entrées neutres, nouvel objet à chaque fois", () => {
    for (const c of ["menu", "masque"] as const) {
      const e = entreesEffectives(plein(), c);
      expect(e).toEqual(ENTREES_NULLES());
      expect(e).toEqual(ENTREES_NEUTRES());
      expect(entreesEffectives(plein(), c)).not.toBe(e);
    }
  });
});

/** Prédicteur factice : enregistre les appels, rend ce que le test prépare. */
function faussePrediction(over: Partial<{ resultat: Partial<ResultatAvance>; trame: TrameEntrees | null; filtre: (evs: readonly { tick: number; e: EvenementMatch }[]) => EvenementMatch[] }> = {}) {
  const monde = { tick: 5 } as unknown as MondeRocket;
  const affiche = { tick: 5, affiche: true } as unknown as MondeRocket;
  const appels: string[] = [];
  const p = {
    monde,
    pret: true,
    recevoirSnap: vi.fn(() => { appels.push("snap"); return true; }),
    avancer: vi.fn((): ResultatAvance => { appels.push("avancer"); return { pas: 2, alpha: 0.5, evenementsLocaux: [], snap: null, ...over.resultat }; }),
    trameAEnvoyer: vi.fn((): TrameEntrees | null => { appels.push("trame"); return over.trame ?? null; }),
    filtrerEvenements: vi.fn((evs: readonly { tick: number; e: EvenementMatch }[]) => (over.filtre ? over.filtre(evs) : evs.map((x) => x.e))),
    mondeAffiche: vi.fn(() => affiche),
    etatAutoritaire: vi.fn(() => null),
    stats: vi.fn(),
  } as unknown as PredicteurRocket;
  return { p, monde, affiche, appels };
}

describe("source en ligne", () => {
  it("lit le monde prédit pour la physique et le monde affiché pour le rendu", () => {
    const { p, monde, affiche } = faussePrediction();
    const s = creerSourceEnLigne({ predicteur: p, envoyerTrame: () => {} });
    expect(s.nom).toBe("ligne");
    expect(s.monde()).toBe(monde);
    expect(s.mondeAffiche(123)).toBe(affiche);
    expect(p.mondeAffiche).toHaveBeenCalledWith(123);
    expect(s.pret()).toBe(true);
  });
  it("avancer : simule, envoie la trame due, rend pas / alpha", () => {
    const trame: TrameEntrees = { numero: 1, tickDebut: 4, snapRecu: 0, entrees: [] };
    const { p, appels } = faussePrediction({ trame });
    const envoyees: TrameEntrees[] = [];
    const s = creerSourceEnLigne({ predicteur: p, envoyerTrame: (t) => envoyees.push(t) });
    const entrees = plein();
    const r = s.avancer(0.016, entrees, 1000);
    expect(p.avancer).toHaveBeenCalledWith(0.016, entrees, 1000);
    expect(appels).toEqual(["avancer", "trame"]);
    expect(envoyees).toEqual([trame]);
    expect(r).toMatchObject({ pas: 2, alpha: 0.5, evenements: [], snap: null });
  });
  it("pas de trame due : rien n'est envoyé", () => {
    const { p } = faussePrediction({ trame: null });
    const envoyees: TrameEntrees[] = [];
    creerSourceEnLigne({ predicteur: p, envoyerTrame: (t) => envoyees.push(t) }).avancer(0.016, plein(), 0);
    expect(envoyees).toHaveLength(0);
  });
  it("les événements locaux prédits sont rendus tels quels", () => {
    const local: EvenementMatch = { t: "toucheBalle", idVoiture: 0, force: 9 };
    const { p } = faussePrediction({ resultat: { evenementsLocaux: [local] } });
    const s = creerSourceEnLigne({ predicteur: p, envoyerTrame: () => {} });
    expect(s.avancer(0.016, plein(), 0).evenements).toEqual([local]);
  });
  it("les événements du serveur passent par le filtre du prédicteur et sont rendus UNE fois, au prochain avancer", () => {
    const but: EvenementMatch = { t: "but", equipe: "bleue", idMarqueur: 0, idPasse: null, vitesseKmh: 80 };
    const doublon: EvenementMatch = { t: "toucheBalle", idVoiture: 0, force: 5 };
    const { p } = faussePrediction({ filtre: (evs) => evs.map((x) => x.e).filter((e) => e !== doublon) });
    const s = creerSourceEnLigne({ predicteur: p, envoyerTrame: () => {} });
    s.recevoirEvenements([{ tick: 10, e: doublon }, { tick: 11, e: but }]);
    expect(s.avancer(0.016, plein(), 0).evenements).toEqual([but]);
    expect(s.avancer(0.016, plein(), 16).evenements).toEqual([]);
  });
  it("locaux d'abord, puis serveur, dans l'ordre d'arrivée", () => {
    const local: EvenementMatch = { t: "saut", idVoiture: 0 } as EvenementMatch;
    const a: EvenementMatch = { t: "decompte", n: 3 };
    const b: EvenementMatch = { t: "coupDEnvoi" };
    const { p } = faussePrediction({ resultat: { evenementsLocaux: [local] } });
    const s = creerSourceEnLigne({ predicteur: p, envoyerTrame: () => {} });
    s.recevoirEvenements([{ tick: 1, e: a }]);
    s.recevoirEvenements([{ tick: 2, e: b }]);
    expect(s.avancer(0.016, plein(), 0).evenements).toEqual([local, a, b]);
  });
  it("les instantanés sont confiés au prédicteur sans rien exécuter (coalescence faite par lui)", () => {
    const { p, appels } = faussePrediction();
    const s = creerSourceEnLigne({ predicteur: p, envoyerTrame: () => {} });
    expect(s.recevoirSnap({} as never, 50)).toBe(true);
    expect(appels).toEqual(["snap"]);
    expect(p.avancer).not.toHaveBeenCalled();
  });
});

describe("joueurs coupés", () => {
  const nomDe = (j: number) => ({ 1: "Léa", 2: "Max" } as Record<number, string>)[j] ?? "Joueur";
  it("un message « coupe » ouvre un compte à rebours local", () => {
    const s = creerSuiviPresence(nomDe);
    expect(s.appliquer({ t: "presence", joueur: 1, etat: "coupe", restantMs: 20_000 }, 1000)).toBe(true);
    expect(s.absents(1000)).toEqual([{ joueur: 1, nom: "Léa", restantMs: 20_000 }]);
    expect(s.absents(6000)[0].restantMs).toBe(15_000);
    expect(s.absents(99_000)[0].restantMs).toBe(0);
  });
  it("revenu, remplacé par un bot et parti ferment le compte", () => {
    for (const etat of ["revenu", "bot", "parti"] as const) {
      const s = creerSuiviPresence(nomDe);
      s.appliquer({ t: "presence", joueur: 1, etat: "coupe", restantMs: 20_000 }, 0);
      expect(s.appliquer({ t: "presence", joueur: 1, etat }, 100)).toBe(true);
      expect(s.absents(100)).toEqual([]);
    }
  });
  it("un joueur jamais coupé : rien n'a changé", () => {
    const s = creerSuiviPresence(nomDe);
    expect(s.appliquer({ t: "presence", joueur: 1, etat: "revenu" }, 0)).toBe(false);
  });
  it("plusieurs absents triés par joueur ; une coupure répétée relance le compte sans signaler de changement", () => {
    const s = creerSuiviPresence(nomDe);
    s.appliquer({ t: "presence", joueur: 2, etat: "coupe", restantMs: 10_000 }, 0);
    s.appliquer({ t: "presence", joueur: 1, etat: "coupe", restantMs: 20_000 }, 0);
    expect(s.absents(0).map((a) => a.joueur)).toEqual([1, 2]);
    expect(s.appliquer({ t: "presence", joueur: 1, etat: "coupe", restantMs: 5000 }, 1000)).toBe(false);
    expect(s.absents(1000)[0].restantMs).toBe(5000);
  });
  it("sans restantMs : 0 ; réinitialiser vide tout", () => {
    const s = creerSuiviPresence(nomDe);
    s.appliquer({ t: "presence", joueur: 3, etat: "coupe" }, 0);
    expect(s.absents(0)).toEqual([{ joueur: 3, nom: "Joueur", restantMs: 0 }]);
    s.reinitialiser();
    expect(s.absents(0)).toEqual([]);
  });
});

describe("revanche", () => {
  it("ouverte par un salon en phase « fin », décompte local, fermée quand la phase change", () => {
    const r = creerSuiviRevanche();
    expect(r.revanche(0)).toBeNull();
    r.appliquer({ phase: "fin", revanche: { votes: { 0: true }, restantMs: 45_000 } }, 1000);
    expect(r.revanche(1000)).toEqual({ votes: { 0: true }, restantMs: 45_000 });
    expect(r.revanche(11_000)?.restantMs).toBe(35_000);
    expect(r.revanche(500_000)?.restantMs).toBe(0);
    r.appliquer({ phase: "chargement" }, 2000);
    expect(r.revanche(2000)).toBeNull();
  });
  it("hors phase « fin », un salon nul ou sans revanche ne laisse rien", () => {
    const r = creerSuiviRevanche();
    r.appliquer({ phase: "fin", revanche: { votes: {}, restantMs: 1000 } }, 0);
    r.appliquer(null, 1);
    expect(r.revanche(1)).toBeNull();
    r.appliquer({ phase: "fin" }, 2);
    expect(r.revanche(2)).toBeNull();
  });
  it("les votes rendus sont une copie", () => {
    const r = creerSuiviRevanche();
    const votes = { 0: true };
    r.appliquer({ phase: "fin", revanche: { votes, restantMs: 1000 } }, 0);
    votes[0] = false;
    expect(r.revanche(0)?.votes[0]).toBe(true);
    const sortie = r.revanche(0)!;
    sortie.votes[5] = true;
    expect(r.revanche(0)?.votes[5]).toBeUndefined();
  });
});

describe("HUD réseau", () => {
  it("assemble ping, gigue et qualité de l'horloge", () => {
    const h = construireHudReseau({ etat: "ouverte", horloge: { rttMs: () => 40, gigueMs: () => 3 }, commandes: "menu", absents: [], revanche: null });
    expect(h).toEqual({ etat: "ouverte", rttMs: 40, gigueMs: 3, qualite: "bonne", commandes: "menu", absents: [], revanche: null });
    expect(construireHudReseau({ etat: "ouverte", horloge: { rttMs: () => 200, gigueMs: () => 3 }, commandes: "actives", absents: [], revanche: null }).qualite).toBe("mauvaise");
    expect(construireHudReseau({ etat: "ouverte", horloge: { rttMs: () => 100, gigueMs: () => 20 }, commandes: "actives", absents: [], revanche: null }).qualite).toBe("moyenne");
  });
  it("le premier état part tout de suite", () => {
    const vus: HudReseau[] = [];
    const e = creerEmetteurHudReseau((h) => vus.push(h));
    expect(e.pousser(hudReseau(), 0)).toBe(true);
    expect(vus).toHaveLength(1);
  });
  it("seul le ping bouge : au plus tous les 200 ms (5 Hz)", () => {
    const vus: HudReseau[] = [];
    const e = creerEmetteurHudReseau((h) => vus.push(h));
    e.pousser(hudReseau({ rttMs: 40 }), 0);
    // 60 images à 60 Hz, le ping oscille à chaque image
    for (let i = 1; i <= 60; i++) e.pousser(hudReseau({ rttMs: 40 + (i % 7) + 1 }), i * 16.7);
    expect(vus.length).toBeLessThanOrEqual(1 + Math.ceil(1002 / ECART_HUD_RESEAU_MS));
    expect(vus.length).toBeGreaterThan(3);
  });
  it("ping identique : aucun envoi", () => {
    const vus: HudReseau[] = [];
    const e = creerEmetteurHudReseau((h) => vus.push(h));
    e.pousser(hudReseau(), 0);
    expect(e.pousser(hudReseau(), 5000)).toBe(false);
    expect(e.pousser(hudReseau({ rttMs: 40.2 }), 6000)).toBe(false);
    expect(vus).toHaveLength(1);
  });
  it("un changement d'état part aussitôt, sans attendre les 200 ms", () => {
    const vus: HudReseau[] = [];
    const e = creerEmetteurHudReseau((h) => vus.push(h));
    e.pousser(hudReseau(), 0);
    expect(e.pousser(hudReseau({ commandes: "menu" }), 1)).toBe(true);
    expect(e.pousser(hudReseau({ commandes: "masque" }), 2)).toBe(true);
    expect(e.pousser(hudReseau({ etat: "reconnexion" }), 3)).toBe(true);
    expect(e.pousser(hudReseau({ qualite: "mauvaise" }), 4)).toBe(true);
    expect(e.pousser(hudReseau({ absents: [{ joueur: 1, nom: "Léa", restantMs: 19_500 }] }), 5)).toBe(true);
    // la seconde suivante du compte à rebours
    expect(e.pousser(hudReseau({ absents: [{ joueur: 1, nom: "Léa", restantMs: 18_900 }] }), 6)).toBe(true);
    expect(e.pousser(hudReseau({ absents: [{ joueur: 1, nom: "Léa", restantMs: 18_800 }] }), 7)).toBe(false);
    expect(e.pousser(hudReseau({ revanche: { votes: { 0: true }, restantMs: 30_000 } }), 8)).toBe(true);
    expect(vus).toHaveLength(8);
  });
  it("réinitialiser refait partir le prochain état", () => {
    const e = creerEmetteurHudReseau(() => {});
    e.pousser(hudReseau(), 0);
    expect(e.pousser(hudReseau(), 1)).toBe(false);
    e.reinitialiser();
    expect(e.pousser(hudReseau(), 2)).toBe(true);
  });
});

describe("canal dégradé", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });
  const creer = () => creerCanalDegrade({ maintenant: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) });

  it("sans réglage : exécution immédiate dans les deux sens", () => {
    const c = creer();
    const vus: string[] = [];
    c.sortir(() => vus.push("s"));
    c.entrer(() => vus.push("e"));
    expect(vus).toEqual(["s", "e"]);
  });
  it("latence : chaque sens retardé de sa valeur, l'ordre est conservé", () => {
    const c = creer();
    c.latence(60, 40);
    const vus: string[] = [];
    c.sortir(() => vus.push("s1"));
    c.entrer(() => vus.push("e1"));
    vi.advanceTimersByTime(39);
    expect(vus).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(vus).toEqual(["e1"]);
    vi.advanceTimersByTime(20);
    expect(vus).toEqual(["e1", "s1"]);
  });
  it("un seul argument : même latence dans les deux sens ; (0, 0) l'annule", () => {
    const c = creer();
    c.latence(50);
    const vus: string[] = [];
    c.entrer(() => vus.push("e"));
    vi.advanceTimersByTime(49);
    expect(vus).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(vus).toEqual(["e"]);
    c.latence(0, 0);
    c.entrer(() => vus.push("e2"));
    expect(vus).toEqual(["e", "e2"]);
  });
  it("retenir : tout ce qui arrive pendant la rétention est livré d'un coup, dans l'ordre", () => {
    const c = creer();
    c.retenir(300);
    const vus: { m: string; t: number }[] = [];
    const note = (m: string) => () => vus.push({ m, t: Date.now() });
    c.entrer(note("a"));
    vi.advanceTimersByTime(100);
    c.entrer(note("b"));
    vi.advanceTimersByTime(100);
    c.entrer(note("c"));
    expect(vus).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(vus.map((x) => x.m)).toEqual(["a", "b", "c"]);
    expect(new Set(vus.map((x) => x.t))).toEqual(new Set([300]));
    // après la rafale, retour au direct
    c.entrer(note("d"));
    expect(vus.map((x) => x.m)).toEqual(["a", "b", "c", "d"]);
  });
  it("une réception directe ne double pas une livraison encore en attente", () => {
    const c = creer();
    c.latence(100, 100);
    const vus: string[] = [];
    c.entrer(() => vus.push("lent"));
    c.latence(0, 0);
    c.entrer(() => vus.push("rapide"));
    expect(vus).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(vus).toEqual(["lent", "rapide"]);
  });
  it("vider annule ce qui était en attente", () => {
    const c = creer();
    c.latence(100);
    const vus: string[] = [];
    c.sortir(() => vus.push("s"));
    c.entrer(() => vus.push("e"));
    c.vider();
    vi.advanceTimersByTime(1000);
    expect(vus).toEqual([]);
  });
});
