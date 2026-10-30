import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { nbObjetsPour } from "./br-butin";
import { BR, EQUIPEMENT_DEPART_BR, MAIN_DEPART_BR } from "./br-regles";
import { appliquerPartie, statsVides, type PersistanceBr, type ResultatPartieBr, type StatsBr } from "./br-stats";
import { PALIERS_ZONE, etatZone } from "./br-zone";
import { construireMondeBr } from "./br-carte";
import type { Monde } from "./collision";
import { armeDuSlot } from "./equipement";
import type { ButinBr, ContexteSalle, JoueurSalle, ServiceBr, Sortie, VolBr } from "./match-contexte";
import { creerServiceBr, type OptionsServiceBr } from "./match-br";
import {
  EQUIPEMENT_DEFAUT, JEU, copierEquipement, type AvionBr, type CauseMort, type EtatPartieBr, type MessageClient, type MessageServeur, type Vec3,
} from "./protocole";

/**
 * Service principal du BR isolé : contexte factice (la salle est testée dans match.br-hooks.test.ts), `VolBr` et `ButinBr` factices (leurs
 * lots ont leurs tests), vrai monde de la carte BR pour les bornes. Modèle : match-zombies.test.ts.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde: Monde = construireMondeBr(scene);
const T0 = 1_000_000;
const CENTRE: [number, number] = [(monde.bornes.x0 + monde.bornes.x1) / 2, (monde.bornes.z0 + monde.bornes.z1) / 2];
/** loin de toute zone possible : toujours hors du cercle */
const DEHORS: Vec3 = [CENTRE[0] + 5_000, 0, CENTRE[1]];
const DEDANS: Vec3 = [CENTRE[0], 0, CENTRE[1]];

function suite(graine = 1): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function nouveauJoueur(id: string, pseudo: string, t: number): JoueurSalle {
  return {
    id, pseudo, couleur: "#ff5252", enJeu: false, kills: 0, morts: 0, ping: 0,
    p: [0, 0, 0], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0,
    arme: "couteau", armeSuivante: "pistolet", pv: JEU.pvMax, vivant: false,
    protegeJusqua: 0, reapparitionT: null, reentreeT: -Infinity, seq: -1, etatT: t, histo: [], prochainTir: -Infinity, renommages: [],
    equip: copierEquipement(EQUIPEMENT_DEFAUT), main: "secondaire", mainSuivante: "secondaire", munSpeciale: 0,
    sortieJusqua: -Infinity, cadenceArme: {}, bouclier: 0, dernierDegatT: t, regenAcc: 0, accroupi: false, glisse: false, memoSante: null,
    tirs: 0, touches: 0, tetes: 0, degats: 0, serie: 0, serieMax: 0, killsParArme: {},
    scoresOuvert: false, scoresDemandeT: -Infinity, scoresEnvoyeT: -Infinity,
  };
}

/** Faux `VolBr` : ce que le service lui demande est consigné, les atterrissages sont déclenchés par le test. */
function fauxVol() {
  const bord = new Set<string>();
  const air = new Set<string>();
  const appels: string[] = [];
  let avion: AvionBr | null = null;
  let atterris = 0;
  let dureeMs = 20_000;
  const vol: VolBr & {
    appels: string[]; atterrir: (j: JoueurSalle, p: Vec3) => void; sauterTous: () => void; ticsRecus: number[];
    demarrages: { debutT: number; bord: string[]; graine: number }[];
  } = {
    appels, ticsRecus: [], demarrages: [],
    demarrer(b, _bornes, alea, debutT, o) {
      appels.push("demarrer");
      dureeMs = o.dureeMs ?? 20_000;
      vol.demarrages.push({ debutT, bord: b.map((j) => j.id), graine: alea() });
      avion = { depart: [0, 0], arrivee: [600, 0], altitude: o.altitude ?? 350, vitesse: 30, debutT, finT: debutT + dureeMs };
      bord.clear();
      for (const j of b) bord.add(j.id);
      return avion;
    },
    entrer(j) {
      appels.push(`entrer:${j.id}`);
      bord.add(j.id);
      j.vivant = true; j.pv = JEU.pvMax; j.p = [0, 350, 0]; j.posture = "air";
      return [];
    },
    sauter(j) {
      appels.push(`sauter:${j.id}`);
      if (!bord.delete(j.id)) return [];
      air.add(j.id);
      return [{ a: j.id, m: { t: "saut", p: j.p, v: [30, 0, 0], lacet: 0 } }];
    },
    recevoirChute(j) { appels.push(`chute:${j.id}`); },
    tic(t) { vol.ticsRecus.push(t); return []; },
    aBord: (id) => bord.has(id),
    enVol: (id) => bord.has(id) || air.has(id),
    chute: (id) => (air.has(id) ? "libre" : undefined),
    avion: () => avion,
    atterris: () => atterris,
    retirer(id) { appels.push(`retirer:${id}`); bord.delete(id); air.delete(id); },
    reinitialiser() { appels.push("reinitialiser"); bord.clear(); air.clear(); avion = null; atterris = 0; },
    atterrir(j, p) {
      bord.delete(j.id); air.delete(j.id);
      j.p = [p[0], p[1], p[2]]; j.posture = "sol";
      atterris++;
    },
    sauterTous() { for (const id of [...bord]) { bord.delete(id); air.add(id); } },
  };
  return vol;
}

function fauxButin() {
  const appels: string[] = [];
  const b: ButinBr & { appels: string[]; initialisations: { nb: number; graine: number; points: number }[]; recus: MessageClient[] } = {
    appels, initialisations: [], recus: [],
    initialiser(points, graine, nb) { appels.push("initialiser"); b.initialisations.push({ nb, graine, points: points.length }); },
    recevoir(_j, m) { b.recus.push(m); return [{ a: "tous", m: { t: "butin", retires: [1] } }]; },
    tic() { appels.push("tic"); return []; },
    surDegats(j, cause) { appels.push(`surDegats:${j.id}:${cause}`); },
    lacherALaMort(j) { appels.push(`lacher:${j.id}`); return [{ a: "tous", m: { t: "butin", ajoutes: [{ id: 900, genre: "bandage", ref: null, p: j.p }] } }]; },
    synchro(id) { appels.push(`synchro:${id}`); return [{ a: id, m: { t: "butin", ajoutes: [] } }]; },
    reinitialiser() { appels.push("reinitialiser"); },
    objets: () => new Map(),
    stock: () => ({ bandage: 0, potion: 0 }),
  };
  return b;
}

/** Persistance simulée : les parties reçues sont consignées, l'état est celui de `appliquerPartie`. */
function fausseStats(depart: StatsBr = statsVides()): PersistanceBr & { parties: ResultatPartieBr[]; courant: () => StatsBr } {
  let courant = depart;
  const parties: ResultatPartieBr[] = [];
  return {
    parties, courant: () => courant,
    lire: () => courant,
    enregistrer(p) { parties.push(p); courant = appliquerPartie(courant, p); return courant; },
  };
}

interface Banc {
  svc: ServiceBr;
  ctx: ContexteSalle;
  vol: ReturnType<typeof fauxVol>;
  butin: ReturnType<typeof fauxButin>;
  table: Map<string, JoueurSalle>;
  retires: string[];
  infligees: { id: string; degats: number; cause: CauseMort; par: string | null; t: number }[];
  arrive: (id: string, pseudo?: string, t?: number) => { j: JoueurSalle; sorties: Sortie[] };
  /** le client a monté le jeu : `rejoindre` (comme `Salle.rejoindreBr`) */
  entre: (id: string, t: number) => Sortie[];
  part: (id: string, t: number) => Sortie[];
  /** un joueur a touché le sol en `p` */
  atterrit: (id: string, p?: Vec3) => JoueurSalle;
  /** mort d'un joueur comme `Salle.mourir` : tueur valide, compteurs, puis `surMort` */
  tue: (cible: string, tueur: string | null, t: number, cause?: CauseMort) => Sortie[];
  j: (id: string) => JoueurSalle;
  /** fin du vol de l'avion (renseigné par `enJeu`) */
  finVol: number;
}

function banc(opts: Partial<OptionsServiceBr> = {}): Banc {
  const table = new Map<string, JoueurSalle>();
  const retires: string[] = [];
  const infligees: Banc["infligees"] = [];
  const vol = fauxVol();
  const butin = fauxButin();
  let compteurBots = 0;
  let svc!: ServiceBr;
  const mourir = (cible: JoueurSalle, par: JoueurSalle | null, cause: CauseMort, t: number): Sortie[] => {
    cible.vivant = false; cible.posture = "mort"; cible.morts++; cible.serie = 0;
    const tueur = par && par !== cible ? par : null;
    const valide = !!tueur && svc.tueurValide(tueur, t);
    if (valide) { tueur!.kills++; tueur!.serie++; }
    const sorties: Sortie[] = [{
      a: "tous", m: { t: "mort", cible: cible.id, par: par?.id ?? "", arme: "couteau", cause, zone: "corps", ts: t, delai: 0 },
    }];
    sorties.push(...svc.surMort(cible, valide ? tueur : null, cause, t));
    return sorties;
  };
  const ctx: ContexteSalle = {
    monde, alea: suite(7),
    enPhaseJeu: () => true,
    joueur: (id) => table.get(id),
    joueursEnJeu: () => [...table.values()].filter((j) => j.enJeu),
    memoriserPrecedent: () => {},
    libererVehicule: () => [],
    toucheJoueur: () => false,
    infliger: (cible, degats, par, cause, zone, _arme, t) => {
      if (!cible.enJeu || !cible.vivant) return [];
      infligees.push({ id: cible.id, degats, cause, par: par?.id ?? null, t });
      cible.pv = Math.max(0, cible.pv - degats);
      const sorties: Sortie[] = [{ a: "tous", m: { t: "degats", cible: cible.id, par: par?.id ?? "", degats, pv: cible.pv, bouclier: cible.bouclier, zone } }];
      if (cible.pv <= 0) sorties.push(...mourir(cible, par, cause, t));
      return sorties;
    },
    tuer: (cible, par, cause, t) => mourir(cible, par, cause, t),
    joueurs: () => [...table.values()],
    placerJoueur: () => [],
    retirerJoueur: (j) => { j.enJeu = false; j.vivant = false; retires.push(j.id); return []; },
    presence: () => ({ a: "tous", m: { t: "presence", joueurs: [] } }),
    equiper: () => [],
    // bots (v11) : de vrais membres de la table de ce banc, sans cerveau (les tests des bots sont dans `match.br-bots.test.ts`)
    ajouterBot: (pseudo, t) => {
      const j = nouveauJoueur(`b${++compteurBots}`, pseudo, t);
      j.bot = true;
      table.set(j.id, j);
      return j;
    },
    retirerBot: (id) => { table.delete(id); },
    recevoir: () => [],
    nouvelIdBot: () => `b${++compteurBots}`,
    nombreHumains: () => [...table.values()].filter((j) => !j.bot).length,
    supportePolice: () => true,
  };
  svc = creerServiceBr(ctx, { alea: suite(11), scene, vol, butin, points: [], ...opts });
  return {
    svc, ctx, vol, butin, table, retires, infligees, finVol: 0,
    arrive: (id, pseudo = id[0].toUpperCase() + id.slice(1), t = T0) => {
      const j = nouveauJoueur(id, pseudo, t);
      table.set(id, j);
      return { j, sorties: svc.arrivee(j, t) };
    },
    entre: (id, t) => {
      const j = table.get(id)!;
      if (j.enJeu || !svc.admis(id)) return [];
      j.enJeu = true;
      return svc.entreeJoueur(j, t);
    },
    part: (id, t) => { const j = table.get(id)!; table.delete(id); return svc.liberer(j, t); },
    atterrit: (id, p = DEDANS) => {
      const j = table.get(id)!;
      vol.atterrir(j, p);
      return j;
    },
    tue: (cible, tueur, t, cause = "arme") => mourir(table.get(cible)!, tueur ? table.get(tueur)! : null, cause, t),
    j: (id) => table.get(id)!,
  };
}

const msg = (m: MessageClient) => m;
const types = (s: Sortie[]) => s.map((x) => x.m.t);
function msgs<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
const dernierEtat = (sorties: Sortie[]): EtatPartieBr | undefined => msgs(sorties, "br").at(-1)?.etat;

/** Fait avancer le service de `t0` à `t1` (pas de 50 ms par défaut), renvoie toutes les sorties. */
function avancer(b: Banc, t0: number, t1: number, pas = 50): Sortie[] {
  const out: Sortie[] = [];
  for (let t = t0; t <= t1; t += pas) out.push(...b.svc.tic(t));
  return out;
}

/** Lobby de `pseudos` (ids a, b, c…), partie lancée par l'hôte à T0 (décompte en cours). */
function lancee(pseudos: string[] = ["Alice", "Bob"], opts: Partial<OptionsServiceBr> = {}) {
  const b = banc(opts);
  const ids = pseudos.map((_, i) => String.fromCharCode(97 + i));
  pseudos.forEach((p, i) => b.arrive(ids[i], p));
  const sorties = b.svc.recevoir(b.j(ids[0]), msg({ t: "lancerPartie" }), T0);
  return { b, ids, sorties };
}
/** Partie en vol : tous montés à T0 + 100, le décompte s'achève à `T_VOL`. */
const T_VOL = T0 + BR.decompteMinMs;
function enVol(pseudos?: string[], opts?: Partial<OptionsServiceBr>) {
  const l = lancee(pseudos, opts);
  l.ids.forEach((id) => l.b.entre(id, T0 + 100));
  avancer(l.b, T0 + 100, T_VOL);
  return l;
}
/** Partie en jeu, tous atterris (au centre de la zone), après la fin du vol. */
function enJeu(pseudos?: string[], opts?: Partial<OptionsServiceBr>) {
  const l = enVol(pseudos, opts);
  l.ids.forEach((id) => l.b.atterrit(id));
  const finVol = l.b.vol.avion()!.finT;
  avancer(l.b, T_VOL + 50, finVol + 100);
  l.b.finVol = finVol;
  return { ...l, finVol };
}

// =================================================================================================
describe("lobby, hôte, lancement", () => {
  it("l'arrivée fait un membre du lobby, annoncé à tous ; le premier arrivé est l'hôte", () => {
    const b = banc();
    const { sorties } = b.arrive("a", "Alice");
    expect(sorties).toHaveLength(1);
    expect(sorties[0].a).toBe("tous");
    const etat = dernierEtat(sorties)!;
    expect(etat).toMatchObject({ phase: "lobby", hote: "a", capacite: BR.joueursMax, minJoueurs: BR.joueursMin, finT: 0, avion: null, zone: null, vivants: 0, total: 0 });
    expect(etat.joueurs).toEqual([{ id: "a", pseudo: "Alice", couleur: "#ff5252", admis: false, vivant: false, aBord: false, kills: 0, place: null }]);
    expect(etat.annule).toBeUndefined();
    b.arrive("b", "Bob");
    expect(b.svc.etat().hote).toBe("a");
    expect(b.svc.resume()).toEqual({ phase: "lobby", joueurs: 2, vivants: 0, hote: "Alice" });
    expect(b.svc.enCours()).toBe(false);
  });

  it("l'hôte passe au suivant quand il part", () => {
    const b = banc();
    b.arrive("a", "Alice"); b.arrive("b", "Bob"); b.arrive("c", "Cora");
    const sorties = b.part("a", T0 + 10);
    expect(dernierEtat(sorties)).toMatchObject({ hote: "b" });
    expect(dernierEtat(sorties)!.joueurs!.map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("seul l'hôte lance, et seulement depuis le lobby", () => {
    const b = banc();
    b.arrive("a", "Alice"); b.arrive("b", "Bob");
    expect(b.svc.recevoir(b.j("b"), msg({ t: "lancerPartie" }), T0)).toEqual([]);
    expect(b.svc.etat().phase).toBe("lobby");
    const sorties = b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), T0);
    expect(dernierEtat(sorties)).toMatchObject({ phase: "decompte", debutT: T0, finT: T0 + BR.decompteMaxMs, vivants: 2, total: 2 });
    expect(dernierEtat(sorties)!.joueurs!.every((x) => x.admis && x.vivant && !x.aBord)).toBe(true);
    expect(types(sorties)).toContain("presence");
    // déjà lancée : un second lancement est ignoré
    expect(b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), T0 + 1)).toEqual([]);
    expect(b.svc.enCours()).toBe(true);
  });

  it("refuse de lancer sous le minimum de joueurs (réglable), sans bots, par un refus explicite", () => {
    // sans bots (`botsMax` à 0) : un humain seul n'atteint pas le minimum
    const b = banc({ botsMax: 0 });
    b.arrive("a", "Alice");
    expect(b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), T0)).toEqual([{ a: "a", m: { t: "refus", action: "lancer", raison: "bots" } }]);
    expect(b.svc.etat().phase).toBe("lobby");
    const solo = banc({ joueursMin: 1, botsMax: 0 });
    solo.arrive("a", "Alice");
    expect(dernierEtat(solo.svc.recevoir(solo.j("a"), msg({ t: "lancerPartie" }), T0))).toMatchObject({ phase: "decompte", minJoueurs: 1 });
  });

  it("deux membres au même nom de base bloquent le lancement et lèvent conflitNoms", () => {
    const b = banc();
    b.arrive("a", "Toto"); b.arrive("b", "toto2");
    expect(b.svc.etat().conflitNoms).toBe(true);
    const sorties = b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), T0);
    expect(dernierEtat(sorties)).toMatchObject({ phase: "lobby", conflitNoms: true });
    expect(b.vol.appels).toEqual([]);
    expect(b.butin.initialisations).toHaveLength(0);
    // un renommage lève le blocage : la liste change, le service le voit au tic suivant
    b.j("b").pseudo = "Bobby";
    const tic = b.svc.tic(T0 + 500);
    expect(dernierEtat(tic)!.conflitNoms).toBeUndefined();
    expect(dernierEtat(b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), T0 + 600))).toMatchObject({ phase: "decompte" });
  });

  it("le lancement admet tout le lobby, remet les compteurs à zéro et prépare butin et avion", () => {
    const b = banc();
    b.arrive("a", "Alice"); b.arrive("b", "Bob");
    for (const j of b.table.values()) {
      Object.assign(j, { kills: 4, morts: 2, tirs: 30, touches: 12, tetes: 3, degats: 340, serie: 2, serieMax: 5, killsParArme: { pistolet: 4 } });
    }
    b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), T0);
    for (const j of b.table.values()) {
      expect([j.kills, j.morts, j.tirs, j.touches, j.tetes, j.degats, j.serie, j.serieMax]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(j.killsParArme).toEqual({});
    }
    expect(b.butin.initialisations).toEqual([{ nb: nbObjetsPour(2), graine: expect.any(Number), points: 0 }]);
    // l'avion existe dès le décompte (immobile) : le plafond est son départ provisoire
    expect(b.vol.demarrages).toEqual([{ debutT: T0 + BR.decompteMaxMs, bord: [], graine: expect.any(Number) }]);
    expect(b.svc.etat().avion).toMatchObject({ debutT: T0 + BR.decompteMaxMs });
    expect(b.svc.admis("a")).toBe(true);
  });

  it("nbObjets et la durée du vol d'essai sont transmis", () => {
    const { b } = lancee(["Alice", "Bob"], { nbObjets: 33, dureeVolMs: 12_000, altitude: 140 });
    expect(b.butin.initialisations[0].nb).toBe(33);
    expect(b.svc.etat().avion).toMatchObject({ altitude: 140, finT: T0 + BR.decompteMaxMs + 12_000 });
  });
});

// =================================================================================================
describe("décompte et admission", () => {
  it("ne se termine pas avant le minimum, même si tout le monde est prêt, puis dès que tous le sont", () => {
    const { b, ids } = lancee();
    ids.forEach((id) => b.entre(id, T0 + 100));
    expect(b.vol.appels).toContain("entrer:a");
    expect(dernierEtat(b.svc.tic(T0 + 200))!.joueurs!.every((x) => x.aBord)).toBe(true);
    avancer(b, T0 + 250, T0 + BR.decompteMinMs - 100);
    expect(b.svc.etat().phase).toBe("decompte");
    const sorties = b.svc.tic(T0 + BR.decompteMinMs);
    expect(dernierEtat(sorties)).toMatchObject({ phase: "vol", debutT: T_VOL, finT: 0 });
    expect(b.svc.etat().zone).not.toBeNull();
  });

  it("l'avion est retracé à la même graine, au départ réel du décompte", () => {
    const { b, ids } = lancee();
    ids.forEach((id) => b.entre(id, T0 + 100));
    avancer(b, T0 + 100, T_VOL);
    expect(b.vol.demarrages).toHaveLength(2);
    expect(b.vol.demarrages[1]).toEqual({ debutT: T_VOL, bord: ["a", "b"], graine: b.vol.demarrages[0].graine });
    expect(b.svc.etat().avion).toMatchObject({ debutT: T_VOL, finT: T_VOL + 20_000 });
  });

  it("le plafond met fin au décompte même si un admis n'est pas monté", () => {
    const { b } = lancee(["Alice", "Bob", "Cora"]);
    b.entre("a", T0 + 100); b.entre("b", T0 + 100);
    avancer(b, T0 + 100, T0 + BR.decompteMaxMs - 100);
    expect(b.svc.etat().phase).toBe("decompte");
    const sorties = b.svc.tic(T0 + BR.decompteMaxMs);
    expect(dernierEtat(sorties)).toMatchObject({ phase: "vol", debutT: T0 + BR.decompteMaxMs });
    expect(b.vol.demarrages[1].bord).toEqual(["a", "b"]);
  });

  it("annule le départ s'il y a moins de joueursMin à bord : tout le monde revient au lobby", () => {
    const { b } = lancee();
    b.entre("a", T0 + 100);
    const sorties = avancer(b, T0 + 100, T0 + BR.decompteMaxMs);
    expect(b.svc.etat()).toMatchObject({ phase: "lobby", annule: true, total: 0, avion: null });
    expect(b.retires).toEqual(["a"]);
    expect(b.vol.appels).toContain("reinitialiser");
    expect(b.butin.appels).toContain("reinitialiser");
    expect(dernierEtat(sorties)).toMatchObject({ phase: "lobby", annule: true });
    expect(b.svc.enCours()).toBe(false);
    // un nouvel arrivant efface l'annonce
    b.arrive("c", "Cora", T0 + BR.decompteMaxMs + 10);
    expect(b.svc.etat().annule).toBeUndefined();
  });

  it("un membre qui part pendant le décompte n'est plus admis et peut faire annuler le départ", () => {
    const { b } = lancee();
    b.entre("a", T0 + 100); b.entre("b", T0 + 100);
    const sorties = b.part("b", T0 + 200);
    expect(dernierEtat(sorties)).toMatchObject({ phase: "decompte", total: 1 });
    expect(b.vol.appels).toContain("retirer:b");
    avancer(b, T0 + 250, T_VOL + 100);
    expect(b.svc.etat()).toMatchObject({ phase: "lobby", annule: true });
  });

  it("l'admission dure jusqu'à la fin du vol : montée tardive en vol", () => {
    const { b } = lancee(["Alice", "Bob", "Cora"]);
    b.entre("a", T0 + 100); b.entre("b", T0 + 100);
    avancer(b, T0 + 100, T0 + BR.decompteMaxMs); // plafond : le vol part sans Cora
    expect(b.svc.etat().phase).toBe("vol");
    expect(b.svc.admis("c")).toBe(true);
    b.entre("c", T0 + BR.decompteMaxMs + 2_000);
    expect(b.vol.appels).toContain("entrer:c");
    expect(b.svc.etat()).toMatchObject({ vivants: 3, total: 3 });
    expect(b.svc.aBord("c")).toBe(true);
  });

  it("à la fin du vol l'admission est close : un admis jamais monté repart en attente, sa montée est refusée", () => {
    const { b } = lancee(["Alice", "Bob", "Cora"]);
    b.entre("a", T0 + 100); b.entre("b", T0 + 100);
    avancer(b, T0 + 100, T0 + BR.decompteMaxMs);
    const finVol = b.vol.avion()!.finT;
    avancer(b, T0 + BR.decompteMaxMs + 50, finVol + 100);
    expect(b.svc.etat()).toMatchObject({ phase: "jeu", total: 2, vivants: 2 });
    expect(b.svc.admis("c")).toBe(false);
    expect(b.entre("c", finVol + 200)).toEqual([]);
    expect(b.vol.appels).not.toContain("entrer:c");
    // même appelé directement (course entre le tic et le message), le service refuse
    b.j("c").enJeu = true;
    expect(b.svc.entreeJoueur(b.j("c"), finVol + 300)).toEqual([]);
  });

  it("admis() est faux hors décompte et vol, pour un éliminé et pour un arrivant en cours de partie", () => {
    const b = banc();
    b.arrive("a", "Alice"); b.arrive("b", "Bob");
    expect(b.svc.admis("a")).toBe(false);
    b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), T0);
    b.arrive("c", "Cora", T0 + 500);
    expect(b.svc.admis("a")).toBe(true);
    expect(b.svc.admis("c")).toBe(false);
    expect(b.svc.admis("inconnu")).toBe(false);
  });

  it("entreeJoueur refuse un non-admis", () => {
    const { b } = lancee();
    b.arrive("c", "Cora", T0 + 10);
    const c = b.j("c");
    c.enJeu = true;
    expect(b.svc.entreeJoueur(c, T0 + 20)).toEqual([]);
    expect(b.vol.appels).not.toContain("entrer:c");
  });
});

// =================================================================================================
describe("arrivée en cours de partie", () => {
  it("l'arrivant reçoit l'état en privé, ne peut pas lancer ni rejoindre", () => {
    const { b } = enVol();
    const { j, sorties } = b.arrive("c", "Cora", T_VOL + 500);
    expect(sorties).toHaveLength(1);
    expect(sorties[0].a).toBe("c");
    expect(dernierEtat(sorties)).toMatchObject({ phase: "vol", vivants: 2, total: 2 });
    expect(b.svc.recevoir(j, msg({ t: "lancerPartie" }), T_VOL + 600)).toEqual([]);
    expect(b.svc.admis("c")).toBe(false);
    expect(b.entre("c", T_VOL + 700)).toEqual([]);
    expect(b.svc.etat().total).toBe(2);
  });

  it("en lobby et au décompte, l'arrivée est diffusée à tous", () => {
    const { b } = lancee();
    const { sorties } = b.arrive("c", "Cora", T0 + 50);
    expect(sorties[0].a).toBe("tous");
    expect(dernierEtat(sorties)!.joueurs!.map((x) => [x.id, x.admis])).toEqual([["a", true], ["b", true], ["c", false]]);
  });
});

// =================================================================================================
describe("zone et tempête", () => {
  it("le plan de la zone part du départ de l'avion ; la zone figure dans br{etat} sous forme du palier courant", () => {
    const { b } = enVol();
    const z = b.svc.etat().zone!;
    expect(z).toMatchObject({ palier: 1, nbPaliers: PALIERS_ZONE.length, phase: "attente", t0: T_VOL, degats: 1 });
    expect(z.r1).toBe(250);
    // jusqu'au départ la tempête ne fait rien : le décompte n'a pas de zone
    const { b: d } = lancee();
    expect(d.svc.etat().zone).toBeNull();
  });

  it("l'échelle de durée suit le nombre d'admis (0,6 pour 2 à 4) ; echelleZone la remplace", () => {
    const { b } = enVol();
    expect(b.svc.etat().zone!.t1 - T_VOL).toBeCloseTo(PALIERS_ZONE[0].attenteMs * 0.6, 3);
    const e = enVol(["Alice", "Bob"], { echelleZone: 0.08 });
    expect(e.b.svc.etat().zone!.t1 - T_VOL).toBeCloseTo(PALIERS_ZONE[0].attenteMs * 0.08, 3);
    const grand = enVol(["Ada", "Bea", "Cid", "Dan", "Eve", "Fay", "Gus", "Hal", "Ivo", "Joy", "Kim"]);
    expect(grand.b.svc.etat().zone!.t1 - T_VOL).toBeCloseTo(PALIERS_ZONE[0].attenteMs, 3);
  });

  it("les dégâts sont appliqués à chaque tic avec un reste fractionnaire, en PV entiers, cause tempete, sans kill", () => {
    const { b } = enJeu();
    b.atterrit("a", DEHORS);
    b.j("a").pv = 100;
    b.infligees.length = 0;
    const t0 = b.vol.avion()!.finT + 200;
    avancer(b, t0, t0 + 10_000, 16);
    const a = b.infligees.filter((x) => x.id === "a");
    // 1 PV/s (palier 1) pendant 10 s : environ 10 PV, un PV à la fois
    expect(a.length).toBeGreaterThanOrEqual(9);
    expect(a.length).toBeLessThanOrEqual(11);
    expect(a.every((x) => x.degats === 1 && x.cause === "tempete" && x.par === null && Number.isInteger(x.degats))).toBe(true);
    expect(b.j("a").pv).toBeLessThan(92);
    expect(b.infligees.some((x) => x.id === "b")).toBe(false);
  });

  it("épargne les joueurs dans la zone, à bord et morts", () => {
    const { b } = enVol();
    const t = T_VOL + 100;
    avancer(b, t, t + 3_000);
    expect(b.infligees).toEqual([]); // à bord : pas de dégâts même si hors zone
    b.j("a").p = [DEHORS[0], 350, DEHORS[2]];
    avancer(b, t + 3_050, t + 6_000);
    expect(b.infligees).toEqual([]); // l'avion n'est pas hors zone : rien ne les touche à bord
    b.atterrit("a", DEHORS);
    b.atterrit("b", DEDANS);
    avancer(b, t + 6_050, t + 9_000);
    expect(b.infligees.every((x) => x.id === "a")).toBe(true);
    expect(b.infligees.length).toBeGreaterThan(0);
  });

  it("en vol (chute), la tempête s'applique", () => {
    const { b } = enVol();
    b.vol.sauterTous();
    b.j("a").p = [DEHORS[0], 200, DEHORS[2]];
    avancer(b, T_VOL + 50, T_VOL + 2_500);
    expect(b.infligees.some((x) => x.id === "a")).toBe(true);
  });

  it("les morts de tempête tombent à des tics distincts, sans kill crédité, et la victoire revient au dernier debout", () => {
    const { b } = enJeu(["Alice", "Bob", "Cora"], { echelleZone: 1 });
    b.atterrit("a", DEHORS); b.atterrit("b", DEHORS);
    b.j("a").pv = 1; b.j("b").pv = 2;
    const sorties = avancer(b, b.finVol + 150, b.finVol + 5_000, 16);
    const morts = msgs(sorties, "mort");
    expect(morts.map((m) => [m.cible, m.cause, m.par])).toEqual([["a", "tempete", ""], ["b", "tempete", ""]]);
    expect(morts[0].ts).toBeLessThan(morts[1].ts);
    expect(b.j("a").kills + b.j("b").kills + b.j("c").kills).toBe(0);
    expect(b.svc.etat().phase).toBe("fin");
    expect(b.svc.etat().bilan!.vainqueurs).toEqual(["c"]);
  });

  it("une cause tempete n'interrompt pas les soins, une autre cause oui", () => {
    const { b } = enJeu();
    b.svc.surDegats(b.j("a"), "tempete", T_VOL);
    expect(b.butin.appels.filter((x) => x.startsWith("surDegats"))).toEqual([]);
    b.svc.surDegats(b.j("a"), "arme", T_VOL);
    expect(b.butin.appels).toContain("surDegats:a:arme");
  });

  it("le changement de palier est annoncé et résume la salle", () => {
    const { b } = enVol(["Alice", "Bob"], { echelleZone: 0.01 });
    b.atterrit("a"); b.atterrit("b");
    const t1 = b.svc.etat().zone!.t1;
    const sorties = avancer(b, t1 - 200, t1 + 400, 50);
    expect(msgs(sorties, "br").some((m) => m.etat.zone?.phase === "retrecit")).toBe(true);
    expect(b.svc.resume()).toMatchObject({ phase: expect.stringMatching(/vol|jeu/), joueurs: 2, vivants: 2 });
    expect(b.svc.resume().palier).toBeGreaterThanOrEqual(1);
  });
});

// =================================================================================================
describe("éliminations, +50 PV, tueurValide", () => {
  it("surMort : instantané, place provisoire, butin lâché, +50 PV plafonnés à 100 pour le tueur vivant", () => {
    const { b } = enJeu(["Alice", "Bob", "Cora"]);
    const t = b.finVol + 500;
    b.j("b").degats = 120; b.j("a").pv = 30;
    const sorties = b.tue("b", "a", t);
    expect(b.j("a").kills).toBe(1);
    expect(b.j("a").pv).toBe(80);
    expect(msgs(sorties, "soin")).toEqual([{ t: "soin", pv: 80, bouclier: 0, motif: "kill" }]);
    expect(sorties.find((x) => x.m.t === "soin")!.a).toBe("a");
    expect(b.butin.appels).toContain("lacher:b");
    expect(b.vol.appels).toContain("retirer:b");
    expect(b.svc.admis("b")).toBe(false);
    // second kill : plafonné à 100
    const sorties2 = b.tue("c", "a", t + 10);
    expect(b.j("a").pv).toBe(100);
    expect(msgs(sorties2, "soin")[0].pv).toBe(100);
    // à 100 PV, rien à soigner : pas de message
    const l = enJeu(["Alice", "Bob", "Cora"]);
    expect(msgs(l.b.tue("b", "a", l.finVol + 500), "soin")).toEqual([]);
    expect(l.b.j("a").pv).toBe(100);
  });

  it("la place provisoire est vivants restants + 1 et figure dans la liste des joueurs", () => {
    const { b } = enJeu(["Alice", "Bob", "Cora", "Dave"]);
    const t = b.finVol + 500;
    b.tue("d", "a", t);
    b.tue("c", "a", t + 100);
    const etat = b.svc.etat();
    expect(etat.vivants).toBe(2);
    expect(etat.total).toBe(4);
    avancer(b, t + 200, t + 300);
    b.tue("b", "a", t + 400);
    avancer(b, t + 450, t + 500);
    const fin = b.svc.etat();
    expect(fin.phase).toBe("fin");
    const places = Object.fromEntries(fin.joueurs!.map((x) => [x.id, x.place]));
    expect(places).toEqual({ a: 1, b: 2, c: 3, d: 4 });
  });

  it("un tueur déjà mort n'est pas soigné et n'est valide qu'au même tic", () => {
    const { b } = enJeu(["Alice", "Bob", "Cora"]);
    const t = b.finVol + 500;
    // kill croisé au même tic : a tue b, puis b (mort au même tic) tue a : les deux comptent
    b.j("a").pv = 40;
    const s1 = b.tue("b", "a", t);
    expect(b.svc.tueurValide(b.j("a"), t)).toBe(true);
    const s2 = b.tue("a", "b", t);
    expect(b.j("b").kills).toBe(1);
    expect(b.j("a").kills).toBe(1);
    expect(msgs(s1, "soin")).toHaveLength(1);
    expect(msgs(s2, "soin")).toEqual([]); // b est mort : pas de soin
    // plus tard, un tueur mort n'est plus valide
    expect(b.svc.tueurValide(b.j("a"), t + 1)).toBe(false);
    expect(b.svc.tueurValide(b.j("c"), t + 1)).toBe(true);
    // la ligne du bilan de b suit ses compteurs même si le kill est venu après sa mort
    avancer(b, t + 50, t + 100);
    const ligneB = b.svc.etat().bilan?.lignes.find((l) => l.id === "b");
    expect(ligneB?.kills ?? 1).toBe(1);
  });

  it("tueurValide est faux pour un inconnu ou un non-monté", () => {
    const { b } = enVol();
    b.arrive("z", "Zoé", T_VOL + 10);
    expect(b.svc.tueurValide(b.j("z"), T_VOL + 20)).toBe(false);
  });

  it("une mort hors partie (lobby, fin) ne fait rien", () => {
    const b = banc();
    b.arrive("a", "Alice");
    expect(b.svc.surMort(b.j("a"), null, "arme", T0)).toEqual([]);
  });

  it("abandon : mort 'abandon' diffusée, éliminé, armes lâchées au sol, aucun +50 PV", () => {
    const { b } = enJeu(["Alice", "Bob", "Cora"]);
    b.j("a").pv = 50;
    const sorties = b.part("b", b.finVol + 500);
    expect(msgs(sorties, "mort")).toEqual([{ t: "mort", cible: "b", par: "", arme: "couteau", cause: "abandon", zone: "corps", ts: b.finVol + 500, delai: 0 }]);
    expect(b.butin.appels).toContain("lacher:b");
    expect(b.j("a").pv).toBe(50);
    expect(b.svc.etat()).toMatchObject({ phase: "jeu", vivants: 2, total: 3 });
  });

  it("abandon en chute : pas d'arme lâchée en l'air", () => {
    const { b } = enVol();
    b.vol.sauterTous();
    b.part("a", T_VOL + 500);
    expect(b.butin.appels).not.toContain("lacher:a");
    expect(b.vol.appels).toContain("retirer:a");
  });

  it("quitter alors qu'on est déjà éliminé ne change rien à la partie", () => {
    const { b } = enJeu(["Alice", "Bob", "Cora"]);
    b.tue("b", "a", b.finVol + 500);
    const avant = b.svc.etat().vivants;
    const sorties = b.svc.liberer(b.j("b"), b.finVol + 600);
    expect(msgs(sorties, "mort")).toEqual([]);
    expect(b.svc.etat().vivants).toBe(avant);
  });
});

// =================================================================================================
describe("victoire, places, bilan", () => {
  it("un survivant : TOP 1, br{etat} immédiat avec le bilan, puis statsBr à chacun", () => {
    const stats = fausseStats();
    const { b } = enJeu(["Alice", "Bob"], { stats, partieValideMinMs: 0 });
    const t = b.finVol + 1_000;
    b.j("b").degats = 0;
    b.j("a").degats = 55.4;
    b.tue("b", "a", t);
    const sorties = b.svc.tic(t);
    const etat = dernierEtat(sorties)!;
    expect(etat.phase).toBe("fin");
    expect(etat.finT).toBe(t + BR.finAffichageMs);
    expect(etat.bilan).toMatchObject({ vainqueurs: ["a"], dureeMs: t - T_VOL });
    expect(etat.bilan!.lignes.map((l) => [l.id, l.place, l.kills])).toEqual([["a", 1, 1], ["b", 2, 0]]);
    expect(etat.bilan!.lignes[0]).toMatchObject({ pseudo: "Alice", degats: 55, survieS: (t - T_VOL) / 1000 });
    expect(etat.nonComptee).toBeUndefined();
    expect(msgs(sorties, "statsBr")).toHaveLength(2);
    expect(sorties.filter((x) => x.m.t === "statsBr").map((x) => x.a)).toEqual(["a", "b"]);
    expect(etat.joueurs!.map((j) => [j.id, j.place])).toEqual([["a", 1], ["b", 2]]);
    // plus de tempête ni de butin pendant l'affichage de la fin
    b.infligees.length = 0;
    b.atterrit("a", DEHORS);
    avancer(b, t + 50, t + 5_000);
    expect(b.infligees).toEqual([]);
  });

  it("zéro survivant : le dernier mort gagne ; à égalité d'instant, le plus proche du centre ; puis l'id", () => {
    const { b } = enJeu(["Alice", "Bob", "Cora", "Dave"], { partieValideMinMs: 0 });
    const t = b.finVol + 1_000;
    b.atterrit("a", [DEDANS[0] + 40, 0, DEDANS[2]]);
    b.atterrit("b", [DEDANS[0] + 10, 0, DEDANS[2]]);
    b.atterrit("c", [DEDANS[0] + 10, 0, DEDANS[2]]);
    b.atterrit("d", [DEDANS[0] + 90, 0, DEDANS[2]]);
    // d meurt plus tôt ; a, b, c au même tic : b et c à 10 m (id), a à 40 m
    b.tue("d", null, t - 500, "tempete");
    b.tue("a", null, t, "tempete");
    b.tue("c", null, t, "tempete");
    b.tue("b", null, t, "tempete");
    const bilan = dernierEtat(b.svc.tic(t))!.bilan!;
    expect(bilan.lignes.map((l) => l.id)).toEqual(["b", "c", "a", "d"]);
    expect(bilan.vainqueurs).toEqual(["b"]);
    expect(bilan.lignes.map((l) => l.place)).toEqual([1, 2, 3, 4]);
  });

  it("abandon du dernier adversaire : victoire du restant", () => {
    const { b } = enJeu(["Alice", "Bob"], { partieValideMinMs: 0 });
    const sorties = b.part("b", b.finVol + 800);
    const etat = dernierEtat(sorties)!;
    expect(etat).toMatchObject({ phase: "fin" });
    expect(etat.bilan!.vainqueurs).toEqual(["a"]);
    expect(etat.bilan!.lignes.map((l) => [l.id, l.place])).toEqual([["a", 1], ["b", 2]]);
  });

  it("abandon des deux derniers : un seul TOP 1 (le dernier parti), la salle n'est pas vide", () => {
    const { b } = enJeu(["Alice", "Bob", "Cora"], { partieValideMinMs: 0 });
    b.part("a", b.finVol + 500);
    b.tue("b", null, b.finVol + 700, "tempete");
    b.table.get("c")!; // Cora attend dans la table
    const sorties = b.part("c", b.finVol + 900);
    // Bob est encore dans la table : la salle n'est pas vide
    expect(dernierEtat(sorties)!.bilan!.vainqueurs).toEqual(["c"]);
    expect(dernierEtat(sorties)!.bilan!.lignes.map((l) => l.place)).toEqual([1, 2, 3]);
  });

  it("le bilan garde les joueurs déconnectés (instantanés)", () => {
    const { b } = enJeu(["Alice", "Bob", "Cora"], { partieValideMinMs: 0 });
    b.j("b").kills = 2; b.j("b").degats = 80;
    b.part("b", b.finVol + 500);
    const sorties = b.tue("c", "a", b.finVol + 900);
    const etat = dernierEtat(avancer(b, b.finVol + 950, b.finVol + 1_000).concat(sorties))!;
    expect(etat.bilan!.lignes.find((l) => l.id === "b")).toMatchObject({ pseudo: "Bob", kills: 2, degats: 80, place: 3 });
    expect(etat.bilan!.lignes.map((l) => l.id)).toEqual(["a", "c", "b"]);
  });

  it("en solo (joueursMin 1), la partie ne se termine pas au décollage mais à la mort du joueur", () => {
    const stats = fausseStats();
    const { b } = enVol(["Alice"], { joueursMin: 1, botsMax: 0, stats });
    avancer(b, T_VOL + 50, T_VOL + 2_000);
    expect(b.svc.etat().phase).toBe("vol");
    b.atterrit("a");
    b.tue("a", null, T_VOL + 2_100, "tempete");
    const etat = dernierEtat(b.svc.tic(T_VOL + 2_100))!;
    expect(etat).toMatchObject({ phase: "fin", nonComptee: true });
    expect(etat.bilan!.vainqueurs).toEqual(["a"]);
    expect(stats.parties).toEqual([]);
  });

  it("la fin ne se déclenche pas deux fois", () => {
    const { b } = enJeu(["Alice", "Bob"], { partieValideMinMs: 0 });
    b.tue("b", "a", b.finVol + 500);
    const s1 = b.svc.tic(b.finVol + 500);
    expect(msgs(s1, "statsBr").length).toBe(2);
    const s2 = b.svc.tic(b.finVol + 600);
    expect(msgs(s2, "statsBr")).toEqual([]);
  });
});

// =================================================================================================
describe("statistiques", () => {
  it("une partie comptée enregistre les seuls pseudos comptés (TOP 1, kills) ; Agent est exclu", () => {
    const stats = fausseStats();
    const { b } = enJeu(["Alice", "Agent", "Cora"], { stats, partieValideMinMs: 0 });
    b.tue("b", "a", b.finVol + 500);
    b.tue("c", "a", b.finVol + 600);
    const sorties = b.svc.tic(b.finVol + 600);
    expect(stats.parties).toHaveLength(1);
    expect(stats.parties[0].t).toBe(b.finVol + 600);
    expect(stats.parties[0].lignes).toEqual([{ pseudo: "Alice", place: 1, kills: 2 }, { pseudo: "Cora", place: 2, kills: 0 }]);
    expect(stats.courant().joueurs["alice"]).toMatchObject({ top1: 1, parties: 1, kills: 2, meilleurePlace: 1 });
    expect(stats.courant().joueurs["agent"]).toBeUndefined();
    const aMsg = msgs(sorties.filter((x) => x.a === "a"), "statsBr")[0];
    expect(aMsg.lignes[0]).toMatchObject({ pseudo: "Alice", top1: 1 });
    expect(aMsg.moi).toMatchObject({ pseudo: "Alice", top1: 1 });
    expect(msgs(sorties.filter((x) => x.a === "b"), "statsBr")[0].moi).toBeUndefined();
  });

  it("une partie trop courte ou avec moins de 2 atterris ne compte pas", () => {
    const court = fausseStats();
    const { b } = enJeu(["Alice", "Bob"], { stats: court });
    b.tue("b", "a", b.finVol + 500); // moins de 60 s après le départ de l'avion
    expect(dernierEtat(b.svc.tic(b.finVol + 500))).toMatchObject({ phase: "fin", nonComptee: true });
    expect(court.parties).toEqual([]);

    const pasAssez = fausseStats();
    const l = enVol(["Alice", "Bob"], { stats: pasAssez, partieValideMinMs: 0 });
    l.b.atterrit("a"); // un seul atterri
    l.b.part("b", T_VOL + 500);
    expect(dernierEtat(l.b.svc.tic(T_VOL + 500)) ?? l.b.svc.etat()).toMatchObject({ phase: "fin", nonComptee: true });
    expect(pasAssez.parties).toEqual([]);

    const longue = fausseStats();
    const g = enJeu(["Alice", "Bob"], { stats: longue });
    const t = T_VOL + BR.partieValideMinMs;
    g.b.tue("b", "a", t);
    g.b.svc.tic(t);
    expect(longue.parties).toHaveLength(1);
  });

  it("les atterris vus avant la mort d'un joueur comptent même si le sous-service les oublie", () => {
    const stats = fausseStats();
    const { b } = enVol(["Alice", "Bob"], { stats, partieValideMinMs: 0 });
    b.atterrit("a"); b.atterrit("b");
    b.vol.atterris = vi.fn()
      .mockReturnValueOnce(2).mockReturnValue(0);
    b.svc.tic(T_VOL + 100);
    b.tue("b", "a", T_VOL + 200);
    b.svc.tic(T_VOL + 200);
    expect(stats.parties).toHaveLength(1);
  });

  it("statsBr : réponse privée limitée à une toutes les 2 s, avec ma ligne", () => {
    const stats = fausseStats(appliquerPartie(statsVides(), { t: 1, lignes: [{ pseudo: "Alice", place: 1, kills: 3 }, { pseudo: "Bob", place: 2, kills: 1 }] }));
    const b = banc({ stats });
    b.arrive("a", "Alice"); b.arrive("b", "Bob");
    const r1 = b.svc.recevoir(b.j("a"), msg({ t: "statsBr" }), T0);
    expect(r1).toHaveLength(1);
    expect(r1[0].a).toBe("a");
    const m = r1[0].m as Extract<MessageServeur, { t: "statsBr" }>;
    expect(m.lignes.map((l) => l.pseudo)).toEqual(["Alice", "Bob"]);
    expect(m.moi?.pseudo).toBe("Alice");
    expect(b.svc.recevoir(b.j("a"), msg({ t: "statsBr" }), T0 + 1_000)).toEqual([]);
    expect(b.svc.recevoir(b.j("b"), msg({ t: "statsBr" }), T0 + 1_000)).toHaveLength(1);
    expect(b.svc.recevoir(b.j("a"), msg({ t: "statsBr" }), T0 + 2_000)).toHaveLength(1);
  });

  it("sans persistance, les statistiques restent en mémoire d'une partie à l'autre", () => {
    const { b } = enJeu(["Alice", "Bob"], { partieValideMinMs: 0 });
    b.tue("b", "a", b.finVol + 500);
    b.svc.tic(b.finVol + 500);
    const r = b.svc.recevoir(b.j("a"), msg({ t: "statsBr" }), b.finVol + 600);
    expect((r[0].m as Extract<MessageServeur, { t: "statsBr" }>).moi).toMatchObject({ top1: 1, parties: 1 });
  });

  it("une persistance qui échoue ne bloque pas la partie", () => {
    const stats: PersistanceBr = { lire: () => statsVides(), enregistrer: () => { throw new Error("disque plein"); } };
    const { b } = enJeu(["Alice", "Bob"], { stats, partieValideMinMs: 0 });
    b.tue("b", "a", b.finVol + 500);
    expect(dernierEtat(b.svc.tic(b.finVol + 500))!.phase).toBe("fin");
    const r = b.svc.recevoir(b.j("a"), msg({ t: "statsBr" }), b.finVol + 700);
    expect((r[0].m as Extract<MessageServeur, { t: "statsBr" }>).moi).toMatchObject({ top1: 1 });
  });
});

// =================================================================================================
describe("retour au lobby, salle vide", () => {
  it("après finAffichageMs, tous sortent de l'arène et reviennent en attente", () => {
    const { b } = enJeu(["Alice", "Bob"], { partieValideMinMs: 0, finAffichageMs: 5_000 });
    b.tue("b", "a", b.finVol + 500);
    b.svc.tic(b.finVol + 500);
    avancer(b, b.finVol + 550, b.finVol + 5_400);
    expect(b.svc.etat().phase).toBe("fin");
    expect(b.retires).toEqual([]);
    const sorties = b.svc.tic(b.finVol + 5_500);
    expect(b.retires.sort()).toEqual(["a", "b"]); // le mort reste en jeu (spectateur) : lui aussi sort
    const etat = dernierEtat(sorties)!;
    expect(etat).toMatchObject({ phase: "lobby", vivants: 0, total: 0, avion: null, zone: null });
    expect(etat.bilan).toBeUndefined();
    expect(etat.joueurs!.every((j) => !j.admis && !j.vivant && j.place === null)).toBe(true);
    expect(b.vol.appels.at(-1)).toBe("reinitialiser");
    expect(b.butin.appels.at(-1)).toBe("reinitialiser");
    expect(types(sorties)).toContain("presence");
    // une nouvelle partie est possible
    expect(dernierEtat(b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), b.finVol + 5_600))).toMatchObject({ phase: "decompte" });
  });

  it("reinitialiser ramène au lobby à blanc", () => {
    const { b } = enVol();
    const sorties = b.svc.reinitialiser(T_VOL + 100);
    expect(dernierEtat(sorties)).toMatchObject({ phase: "lobby", total: 0 });
    expect(b.retires.sort()).toEqual(["a", "b"]);
  });

  it("la salle vide est traitée dans liberer : retour synchrone au lobby, sans statistiques", () => {
    const stats = fausseStats();
    const { b } = enJeu(["Alice", "Bob"], { stats, partieValideMinMs: 0 });
    b.part("a", b.finVol + 500);
    // Bob gagne par abandon d'Alice : fin de partie comptée (Bob est seul dans la salle)
    expect(b.svc.etat().phase).toBe("fin");
    expect(stats.parties).toHaveLength(1);
    // il part à son tour : la salle est vide, le service n'attend pas le tic suivant (le serveur saute les salles vides)
    const sorties = b.part("b", b.finVol + 700);
    expect(b.svc.etat()).toMatchObject({ phase: "lobby", total: 0, vivants: 0 });
    expect(b.vol.appels.at(-1)).toBe("reinitialiser");
    expect(b.butin.appels.at(-1)).toBe("reinitialiser");
    expect(msgs(sorties, "statsBr")).toEqual([]);
    expect(stats.parties).toHaveLength(1);
    expect(b.svc.enCours()).toBe(false);
  });

  it("le dernier joueur d'une partie en vol part : lobby direct, ni bilan ni statistiques", () => {
    const stats = fausseStats();
    const { b } = enVol(["Alice"], { joueursMin: 1, botsMax: 0, stats, partieValideMinMs: 0 });
    b.atterrit("a");
    const sorties = b.part("a", T_VOL + 1_000);
    expect(b.svc.etat()).toMatchObject({ phase: "lobby", total: 0, avion: null, zone: null });
    expect(b.svc.etat().bilan).toBeUndefined();
    expect(types(sorties)).not.toContain("statsBr");
    expect(stats.parties).toEqual([]);
  });

  it("salle vidée pendant le décompte : retour au lobby sans annonce d'annulation", () => {
    const { b } = lancee();
    b.entre("a", T0 + 100);
    b.part("a", T0 + 200);
    b.part("b", T0 + 300);
    expect(b.svc.etat()).toMatchObject({ phase: "lobby", total: 0 });
    expect(b.svc.etat().annule).toBeUndefined();
  });
});

// =================================================================================================
describe("messages, diffusion de br{etat}", () => {
  it("sauter n'est accepté qu'en vol, chute qu'en vol et en jeu, les soins et le ramassage en vol et en jeu", () => {
    const { b, ids } = lancee();
    ids.forEach((id) => b.entre(id, T0 + 100));
    expect(b.svc.recevoir(b.j("a"), msg({ t: "sauter" }), T0 + 200)).toEqual([]);
    b.svc.recevoir(b.j("a"), msg({ t: "ramasser", id: 1 }), T0 + 200);
    expect(b.butin.recus).toEqual([]);
    avancer(b, T0 + 250, T_VOL);
    const s = b.svc.recevoir(b.j("a"), msg({ t: "sauter" }), T_VOL + 100);
    expect(types(s)).toEqual(["saut"]);
    expect(b.vol.enVol("a")).toBe(true);
    b.svc.recevoir(b.j("a"), msg({ t: "chute", lacet: 0, tangage: 0, avance: 1, lateral: 0, ouvrir: false }), T_VOL + 120);
    expect(b.vol.appels).toContain("chute:a");
    b.atterrit("a");
    expect(types(b.svc.recevoir(b.j("a"), msg({ t: "ramasser", id: 3 }), T_VOL + 200))).toEqual(["butin"]);
    b.svc.recevoir(b.j("a"), msg({ t: "lacher", slot: "principale" }), T_VOL + 210);
    b.svc.recevoir(b.j("a"), msg({ t: "utiliser", objet: "bandage" }), T_VOL + 220);
    expect(b.butin.recus.map((m) => m.t)).toEqual(["ramasser", "lacher", "utiliser"]);
  });

  it("un éliminé ne ramasse plus et les messages inconnus sont ignorés", () => {
    const { b } = enJeu(["Alice", "Bob", "Cora"]);
    b.tue("b", "a", b.finVol + 300);
    b.svc.recevoir(b.j("b"), msg({ t: "ramasser", id: 1 }), b.finVol + 400);
    expect(b.butin.recus).toEqual([]);
    expect(b.svc.recevoir(b.j("a"), msg({ t: "ping", t0: 1 }), b.finVol + 400)).toEqual([]);
  });

  it("aBord, enVol et chute interrogent le vol", () => {
    const { b } = enVol();
    expect(b.svc.aBord("a")).toBe(true);
    expect(b.svc.enVol("a")).toBe(true);
    b.vol.sauterTous();
    expect(b.svc.aBord("a")).toBe(false);
    expect(b.svc.chute("a")).toBe("libre");
  });

  it("en lobby, br{etat} est limité à 5 Hz et suit les changements de pseudo", () => {
    const b = banc();
    b.arrive("a", "Alice"); b.arrive("b", "Bob");
    b.svc.tic(T0 + 1_000);
    b.j("b").pseudo = "Bobby";
    expect(dernierEtat(b.svc.tic(T0 + 1_050))).toBeUndefined(); // moins de 200 ms après le dernier
    const e = dernierEtat(b.svc.tic(T0 + 1_300))!;
    expect(e.joueurs!.map((j) => j.pseudo)).toEqual(["Alice", "Bobby"]);
    expect(dernierEtat(b.svc.tic(T0 + 1_600))).toBeUndefined(); // rien n'a changé
  });

  it("en vol et en jeu, br{etat} bat à 1 Hz et immédiatement sur changement", () => {
    const { b } = enJeu(["Alice", "Bob", "Cora"], { echelleZone: 1 });
    const t = b.finVol + 2_000;
    avancer(b, t, t + 100); // vide l'état en attente
    const n = (t0: number, t1: number) => msgs(avancer(b, t0, t1, 50), "br").length;
    expect(n(t + 150, t + 950)).toBe(0);
    expect(n(t + 1_000, t + 1_200)).toBeGreaterThanOrEqual(1);
    const t2 = t + 3_000;
    avancer(b, t + 1_250, t2);
    b.tue("c", "a", t2 + 10);
    const s = b.svc.tic(t2 + 300);
    expect(dernierEtat(s)).toMatchObject({ vivants: 2, total: 3 });
    expect(dernierEtat(s)!.joueurs).toBeUndefined();
  });

  it("synchro : l'état puis le butin complet ; sans partie, seulement l'état", () => {
    const b = banc();
    b.arrive("a", "Alice");
    expect(types(b.svc.synchro("a"))).toEqual(["br"]);
    expect(b.butin.appels).not.toContain("synchro:a");
    const l = enVol();
    const s = l.b.svc.synchro("a");
    expect(types(s)).toEqual(["br", "butin"]);
    expect(s.every((x) => x.a === "a")).toBe(true);
  });

  it("tic : le vol et le butin tournent à chaque tic en partie", () => {
    const { b } = enVol();
    const n = b.vol.ticsRecus.length;
    b.svc.tic(T_VOL + 70);
    expect(b.vol.ticsRecus).toHaveLength(n + 1);
    expect(b.butin.appels.filter((x) => x === "tic").length).toBeGreaterThan(0);
  });

  it("l'équipement de départ du BR n'a aucune arme à feu (rappel du contrat)", () => {
    const eq = copierEquipement(EQUIPEMENT_DEPART_BR as never);
    expect(armeDuSlot(eq, "principale")).toBeNull();
    expect(armeDuSlot(eq, "secondaire")).toBeNull();
    expect(MAIN_DEPART_BR).toBe("couteau");
  });
});

describe("zone : cohérence avec br-zone", () => {
  it("l'état client reconstruit depuis le message est celui du plan", async () => {
    const { etatDepuisZoneBr } = await import("./br-zone");
    const { b } = enVol(["Alice", "Bob"], { echelleZone: 0.1 });
    const z = b.svc.etat().zone!;
    for (const dt of [0, 5_000, 12_000]) {
      const e = etatDepuisZoneBr(z, T_VOL + dt);
      expect(e.palier).toBe(1);
      expect(e.rayon).toBeGreaterThan(0);
    }
    const plan = etatZone({ debutT: T_VOL, cercles: [{ c: [z.c0[0], z.c0[1]], r: z.r0 }, { c: [z.c1[0], z.c1[1]], r: z.r1 }], paliers: PALIERS_ZONE.map((p) => ({ ...p, attenteMs: p.attenteMs * 0.1, retreciMs: p.retreciMs * 0.1 })) }, T_VOL);
    expect(plan.rayon).toBeCloseTo(z.r0, 6);
  });
});
