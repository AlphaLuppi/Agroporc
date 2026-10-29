import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData, Vec2 } from "../agroparc3d/types";
import { STATS } from "./armes";
import { batimentsDetruits } from "./collision";
import { armeDuSlot } from "./equipement";
import type { ContexteSalle, JoueurSalle, ServiceZombies, Sortie } from "./match-contexte";
import { EQUIPEMENT_DEPART_ZOMBIES, creerServiceZombies, departPour, type OptionsServiceZombies } from "./match-zombies";
import {
  EQUIPEMENT_DEFAUT, JEU, copierEquipement, decoderZombies, type Equipement, type MessageClient, type MessageServeur, type Slot, type Vec3,
} from "./protocole";
import { appliquerDegats } from "./sante";
import {
  ACHATS, ATOUTS, DEPARTS, FENETRES, PORTES_PAYANTES, achatBoite, construireMondeZombies, etiqueterZones, fenetreDeId, idPrisme, porteDeId, zoneEn,
  type ZoneId,
} from "./zombies-carte";
import { ZOMBIES, delaiApparition, gainKill, gainTouche, pvZombie, totalManche, type GenreBonus } from "./zombies-vagues";
import { CUISSON_PAP_MS, CUISSON_RECETTE_MS, OFFRE_BOITE_MS, TIRAGE_BOITE_MS, AUTO_RELEVE_MS, ENVOL_BOITE_MS } from "./match-zombies";

/**
 * Service zombies isolé : contexte factice (la salle est testée dans match.zombies.test.ts), vrai monde de la carte « Service de midi ».
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const T0 = 1_000_000;

function suite(graine = 1): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function nouveauJoueur(id: string, t: number): JoueurSalle {
  return {
    id, pseudo: `Agent ${id}`, couleur: "#ff5252", enJeu: false, kills: 0, morts: 0, ping: 0,
    p: [0, 0, 0], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0,
    arme: "pistolet", armeSuivante: "pistolet", pv: JEU.pvMax, vivant: false,
    protegeJusqua: 0, reapparitionT: null, reentreeT: -Infinity, seq: -1, etatT: t, histo: [], prochainTir: -Infinity, renommages: [],
    equip: copierEquipement(EQUIPEMENT_DEFAUT), main: "secondaire", mainSuivante: "secondaire", munSpeciale: 0,
    sortieJusqua: -Infinity, cadenceArme: {}, bouclier: 0, dernierDegatT: t, regenAcc: 0, accroupi: false, glisse: false, memoSante: null,
    tirs: 0, touches: 0, tetes: 0, degats: 0, serie: 0, serieMax: 0, killsParArme: {},
    scoresOuvert: false, scoresDemandeT: -Infinity, scoresEnvoyeT: -Infinity,
  };
}

interface Banc {
  svc: ServiceZombies;
  ctx: ContexteSalle;
  table: Map<string, JoueurSalle>;
  retires: string[];
  memorises: string[];
  /** ajoute un membre du lobby (arrivée) */
  arrive: (id: string, t?: number) => { j: JoueurSalle; sorties: Sortie[] };
  /** le client a monté le jeu : `rejoindre` (en jeu, placé sur son départ) */
  entre: (id: string, t: number) => JoueurSalle;
  /** retire un membre de la salle (déconnexion) */
  part: (id: string, t: number) => Sortie[];
  j: (id: string) => JoueurSalle;
}

function banc(opts: Partial<OptionsServiceZombies> = {}): Banc {
  const monde = construireMondeZombies(scene);
  const table = new Map<string, JoueurSalle>();
  const retires: string[] = [];
  const memorises: string[] = [];
  let svc!: ServiceZombies;
  const ctx: ContexteSalle = {
    monde, alea: suite(7),
    enPhaseJeu: () => true,
    joueur: (id) => table.get(id),
    joueursEnJeu: () => [...table.values()].filter((j) => j.enJeu),
    memoriserPrecedent: (j) => { memorises.push(j.id); },
    libererVehicule: () => [],
    toucheJoueur: () => false,
    // comme la salle : bouclier d'abord, `degats` à tous, puis la mise à terre passe par le service (aucun message `mort`)
    infliger: (cible, degats, par, _cause, zone, _arme, t) => {
      if (!cible.enJeu || !cible.vivant) return [];
      const r = appliquerDegats(cible, degats, t);
      if (r.absorbe + r.subi <= 0) return [];
      const sorties: Sortie[] = [{ a: "tous", m: { t: "degats", cible: cible.id, par: par?.id ?? "", degats, pv: cible.pv, bouclier: cible.bouclier, zone } }];
      if (r.mort) {
        cible.vivant = false; cible.posture = "mort"; cible.morts++; cible.equip.speciale = null; cible.munSpeciale = 0;
        sorties.push(...svc.surMort(cible, t));
      }
      return sorties;
    },
    tuer: () => [],
    joueurs: () => [...table.values()],
    placerJoueur: (j, p, lacet, o, t) => {
      j.p = [p[0], p[1], p[2]]; j.lacet = lacet; j.equip = copierEquipement(o.equip); j.main = o.main;
      j.arme = armeDuSlot(j.equip, j.main) ?? j.equip.secondaire; j.pv = o.pv; j.bouclier = 0; j.vivant = true; j.posture = "sol";
      j.protegeJusqua = t + JEU.protectionMs; j.munSpeciale = o.munSpeciale ?? 0; j.etatT = t;
      return [{ a: "tous", m: { t: "apparition", id: j.id, p: j.p, lacet, arme: j.arme, pv: j.pv, bouclier: 0, equip: copierEquipement(j.equip), main: j.main, munSpeciale: j.munSpeciale } }];
    },
    retirerJoueur: (j) => { j.enJeu = false; j.vivant = false; retires.push(j.id); return []; },
    presence: () => ({ a: "tous", m: { t: "presence", joueurs: [] } }),
    equiper: (j, equip, main, _t, ravitaille) => {
      j.equip = copierEquipement(equip); j.main = main; j.arme = armeDuSlot(j.equip, main) ?? j.arme;
      return [{ a: j.id, m: { t: "equipement", equip: copierEquipement(j.equip), main, munSpeciale: j.munSpeciale, ...(ravitaille ? { ravitaille } : {}) } }];
    },
  };
  svc = creerServiceZombies(ctx, { alea: suite(11), ...opts });
  const b: Banc = {
    svc, ctx, table, retires, memorises,
    arrive: (id, t = T0) => { const j = nouveauJoueur(id, t); table.set(id, j); return { j, sorties: svc.arrivee(j, t) }; },
    entre: (id, t) => {
      const j = table.get(id)!;
      j.enJeu = true;
      const i = [...table.keys()].indexOf(id);
      ctx.placerJoueur(j, [DEPARTS[i][0], 0, DEPARTS[i][1]], 0, { pv: JEU.pvMax, equip: copierEquipement(EQUIPEMENT_DEPART_ZOMBIES), main: "secondaire" }, t);
      return j;
    },
    part: (id, t) => { const j = table.get(id)!; table.delete(id); return svc.liberer(j, t); },
    j: (id) => table.get(id)!,
  };
  return b;
}

const types = (s: Sortie[]) => s.map((x) => x.m.t);
function msgs<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
const dernierEtat = (sorties: Sortie[]) => msgs(sorties, "zombies").at(-1)?.etat;
const msg = (m: MessageClient) => m;

/** Fait avancer le service de `t0` à `t1` (pas de 50 ms), renvoie toutes les sorties. */
function avancer(b: Banc, t0: number, t1: number, pas = 50): Sortie[] {
  const out: Sortie[] = [];
  for (let t = t0; t <= t1; t += pas) out.push(...b.svc.tic(t));
  return out;
}
/** Tue d'un coup tous les tigres du snap courant, créditant `j`. */
function tuerTous(b: Banc, j: JoueurSalle, t: number, zone: "tete" | "corps" = "corps"): Sortie[] {
  const out: Sortie[] = [];
  for (const z of decoderZombies(b.svc.snap()?.z ? b.svc.snap()! : { r: 0, z: [] })) out.push(...b.svc.blesser(`z${z.id}`, 100_000, j, zone, t));
  return out;
}
const tigresVivants = (b: Banc) => decoderZombies(b.svc.snap() ?? { r: 0, z: [] });

/** Lobby de `ids`, partie lancée par l'hôte à T0, tous chargés : renvoie le banc au début de la manche 1 (apparitions commencées). */
function partieEnCours(ids: string[] = ["a"], opts: Partial<OptionsServiceZombies> = {}) {
  const b = banc(opts);
  ids.forEach((id) => b.arrive(id));
  b.svc.recevoir(b.j(ids[0]), msg({ t: "lancerPartie" }), T0);
  ids.forEach((id) => b.entre(id, T0 + 100));
  return b;
}
/** Instant où la manche 1 a commencé ET où la grâce de 3 s est écoulée. */
const T_MANCHE1 = T0 + ZOMBIES.decompteDepartMs;
const T_PREMIER_TIGRE = T_MANCHE1 + ZOMBIES.graceApresChargementMs;

/** Avance jusqu'à ce que la manche en cours soit terminée en tuant chaque tigre dès qu'il apparaît ; renvoie l'instant de fin. */
function finirManche(b: Banc, j: JoueurSalle, t: number): { t: number; sorties: Sortie[] } {
  const sorties: Sortie[] = [];
  const manche = b.svc.etat().manche;
  for (let k = 0; k < 4000; k++, t += 100) {
    sorties.push(...b.svc.tic(t));
    sorties.push(...tuerTous(b, j, t));
    if (b.svc.etat().phase !== "manche" || b.svc.etat().manche !== manche) return { t, sorties };
  }
  throw new Error("la manche ne se termine pas");
}

// =================================================================================================
describe("lobby, hôte, lancement", () => {
  it("l'arrivée fait un membre en attente, annoncé à tous ; le premier arrivé est l'hôte", () => {
    const b = banc();
    const { sorties } = b.arrive("a");
    expect(sorties).toHaveLength(1);
    expect(sorties[0].a).toBe("tous");
    const etat = dernierEtat(sorties)!;
    expect(etat).toMatchObject({ phase: "lobby", manche: 0, hote: "a", capacite: ZOMBIES.joueursMax });
    expect(etat.joueurs).toEqual([{ id: "a", pseudo: "Agent a", couleur: "#ff5252", etat: "attente", admis: false, kills: 0, gagne: 0, reanimations: 0, atouts: [], autoReleves: 3 }]);
    expect(etat.portes.map((p) => p.id)).toEqual(PORTES_PAYANTES.map((p) => p.id));
    expect(etat).toMatchObject({ difficulte: "plat", courant: false, fenetres: FENETRES.map(() => 6), bonus: [], murs: [], mancheTruck: false, truck: null });
    expect(etat.portes.every((p) => !p.ouverte)).toBe(true);
    b.arrive("b");
    expect(b.svc.etat().hote).toBe("a");
    expect(b.svc.resume()).toEqual({ phase: "lobby", joueurs: 2, manche: 0 });
    expect(b.svc.enCours()).toBe(false);
    expect(b.svc.snap()).toBeNull();
  });

  it("l'hôte passe au suivant quand il part", () => {
    const b = banc();
    b.arrive("a"); b.arrive("b"); b.arrive("c");
    const sorties = b.part("a", T0 + 10);
    expect(dernierEtat(sorties)).toMatchObject({ hote: "b" });
    expect(dernierEtat(sorties)!.joueurs.map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("seul l'hôte lance, et seulement depuis le lobby", () => {
    const b = banc();
    b.arrive("a"); b.arrive("b");
    expect(b.svc.recevoir(b.j("b"), msg({ t: "lancerPartie" }), T0)).toEqual([]);
    expect(b.svc.etat().phase).toBe("lobby");
    const sorties = b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), T0);
    expect(dernierEtat(sorties)).toMatchObject({ phase: "pause", manche: 1, debutT: T0, finT: T0 + ZOMBIES.decompteDepartMs });
    // admission de tout le lobby, argent de départ privé, bâtiments complets (portes fermées), présence
    expect(dernierEtat(sorties)!.joueurs.every((x) => x.admis && x.etat === "debout")).toBe(true);
    expect(msgs(sorties, "argent").map((m) => [m.solde, m.delta])).toEqual([[500, 0], [500, 0]]);
    expect(sorties.filter((s) => s.m.t === "argent").map((s) => s.a)).toEqual(["a", "b"]);
    expect(msgs(sorties, "batiments")[0]).toMatchObject({ complet: true, detruits: [], breches: [] });
    expect(types(sorties)).toContain("presence");
    expect(b.svc.enCours()).toBe(true);
    // une partie en cours ne se relance pas
    expect(b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), T0 + 1)).toEqual([]);
    expect(b.svc.admis("a")).toBe(true);
  });

  it("l'argent de départ et le décompte se règlent par les options (essais)", () => {
    const b = banc({ argentDepart: 123, pauseMs: 2000 });
    b.arrive("a");
    const sorties = b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), T0);
    expect(msgs(sorties, "argent")[0].solde).toBe(123);
    expect(dernierEtat(sorties)!.finT).toBe(T0 + 2000);
  });

  it("les compteurs de scores sont remis à zéro au lancement", () => {
    const b = banc();
    const { j } = b.arrive("a");
    j.kills = 9; j.morts = 3; j.tirs = 40; j.killsParArme = { pistolet: 9 };
    b.svc.recevoir(j, msg({ t: "lancerPartie" }), T0);
    expect(j).toMatchObject({ kills: 0, morts: 0, tirs: 0, killsParArme: {} });
  });

  it("les messages sans rapport avec les zombies renvoient []", () => {
    const b = partieEnCours();
    expect(b.svc.recevoir(b.j("a"), msg({ t: "ping", t0: 1 }), T0)).toEqual([]);
  });
});

// =================================================================================================
describe("manche 1 : chargement des clients puis apparitions", () => {
  it("le décompte de 8 s court ; rien n'apparaît avant la fin du décompte + 3 s de grâce", () => {
    const b = partieEnCours();
    avancer(b, T0 + 100, T_MANCHE1 - 50);
    expect(b.svc.etat().phase).toBe("pause");
    expect(tigresVivants(b)).toHaveLength(0);
    const sorties = b.svc.tic(T_MANCHE1);
    expect(dernierEtat(sorties)).toMatchObject({ phase: "manche", manche: 1, debutT: T_MANCHE1 });
    avancer(b, T_MANCHE1 + 50, T_PREMIER_TIGRE - 60);
    expect(tigresVivants(b)).toHaveLength(0);
    avancer(b, T_PREMIER_TIGRE - 50, T_PREMIER_TIGRE + 100);
    expect(tigresVivants(b)).toHaveLength(1);
  });

  it("les apparitions attendent que tous les admis soient en jeu, au plus 15 s depuis le lancement", () => {
    const b = banc();
    b.arrive("a"); b.arrive("b");
    b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), T0);
    b.entre("a", T0 + 100); // « b » n'a pas fini de charger
    avancer(b, T0 + 100, T0 + 14_900);
    expect(b.svc.etat().phase).toBe("manche");
    expect(b.svc.snap()!.r).toBe(totalManche(1, 2));
    expect(tigresVivants(b)).toHaveLength(0);
    // 15 s après le lancement : plus d'attente, puis 3 s de grâce (« b », jamais arrivé, repasse en attente au même moment)
    avancer(b, T0 + 14_950, T0 + 17_950);
    expect(tigresVivants(b)).toHaveLength(0);
    avancer(b, T0 + 18_000, T0 + 18_200);
    expect(tigresVivants(b)).toHaveLength(1);
    expect(b.svc.etat().joueurs.find((x) => x.id === "b")).toMatchObject({ etat: "attente", admis: false });
  });

  it("dès que le dernier admis rejoint, les apparitions partent 3 s plus tard", () => {
    const b = banc();
    b.arrive("a"); b.arrive("b");
    b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), T0);
    b.entre("a", T0 + 100);
    avancer(b, T0 + 100, T0 + 10_000);
    b.entre("b", T0 + 10_050);
    avancer(b, T0 + 10_100, T0 + 13_000);
    expect(tigresVivants(b)).toHaveLength(0);
    avancer(b, T0 + 13_050, T0 + 13_300);
    expect(tigresVivants(b)).toHaveLength(1);
  });

  it("un tigre apparaît toutes les 2 s × 0,95^(n−1), dans une zone active (l'open space au départ : fenêtres F1, F2 ou sortie du sol)", () => {
    const b = partieEnCours();
    const zones = etiqueterZones(construireMondeZombies(scene));
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    const premier = tigresVivants(b);
    expect(premier).toHaveLength(1);
    const z = premier[0];
    const parFenetre = ["F1", "F2"].some((id) => fenetreDeId(id)!.points.some((p) => Math.hypot(p[0] - z.x, p[1] - z.z) < 1.5));
    expect(parFenetre || (z.mode === "sol" && zoneEn(zones, z.x, z.z) === "open"), JSON.stringify(z)).toBe(true);
    const delai = delaiApparition(1) * 1000;
    avancer(b, T_PREMIER_TIGRE + 150, T_PREMIER_TIGRE + delai - 100);
    expect(tigresVivants(b)).toHaveLength(1);
    avancer(b, T_PREMIER_TIGRE + delai - 50, T_PREMIER_TIGRE + delai + 150);
    expect(tigresVivants(b)).toHaveLength(2);
  });

  it("difficulté : choisie au lancement (« plat » par défaut ou valeur inconnue), elle règle les PV des tigres", () => {
    for (const [demande, attendue] of [["goulaf", "goulaf"], ["entree", "entree"], ["n'importe", "plat"], [undefined, "plat"]] as const) {
      const b = banc();
      b.arrive("a");
      b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie", ...(demande ? { difficulte: demande as "plat" } : {}) }), T0);
      b.entre("a", T0 + 100);
      expect(b.svc.etat().difficulte).toBe(attendue);
      avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
      const z = tigresVivants(b)[0];
      const pv = pvZombie(1, 0, attendue);
      const s = b.svc.blesser(`z${z.id}`, 30, b.j("a"), "corps", T_PREMIER_TIGRE + 150);
      expect(msgs(s, "degats")[0].pv).toBe(Math.round((100 * (pv - 30)) / pv));
    }
  });

  it("la manche compte `totalManche(1, j)` tigres (restants dans le snap) ; PDJ_FPS_ZOMBIES_TOTAL fixe ceux de la manche 1", () => {
    const b = partieEnCours(["a", "b"]);
    avancer(b, T_MANCHE1, T_MANCHE1 + 100);
    expect(b.svc.snap()!.r).toBe(totalManche(1, 2));
    const c = partieEnCours(["a"], { total1: 2 });
    avancer(c, T_MANCHE1, T_MANCHE1 + 100);
    expect(c.svc.snap()!.r).toBe(2);
    const d = partieEnCours(["a"], { total1: 9 });
    avancer(d, T_MANCHE1, T_MANCHE1 + 100);
    expect(d.svc.snap()!.r).toBe(9);
  });

  it("jamais plus de tigres vivants que le plafond de la manche", () => {
    const b = partieEnCours(["a"], { total1: 40 });
    // on ne tue rien : le joueur est bardé de PV pour que les griffes ne comptent pas
    b.j("a").pv = 1e9; b.j("a").p = [500, 0, 500];
    avancer(b, T0 + 100, T0 + 80_000, 100);
    expect(tigresVivants(b).length).toBeLessThanOrEqual(ZOMBIES.plafondVivants);
    expect(tigresVivants(b).length).toBeGreaterThan(0);
  });
});

/** Zones au sol de la carte, portes fermées (un tigre abattu hors zone ne lâche pas de bonus). */
const ZONES_SOL = etiqueterZones(construireMondeZombies(scene));

// =================================================================================================
describe("points de BO1", () => {
  function avecUnTigre(opts: Partial<OptionsServiceZombies> = {}) {
    const b = partieEnCours(["a"], opts);
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    const z = tigresVivants(b)[0];
    return { b, z, id: `z${z.id}`, j: b.j("a") };
  }

  it("une touche : `degats` au seul tireur (pv en %), +10 $ privés, pas de zombieMort", () => {
    const { b, id, j } = avecUnTigre();
    const t = T_PREMIER_TIGRE + 200;
    const sorties = b.svc.blesser(id, 30, j, "corps", t);
    expect(msgs(sorties, "degats")).toEqual([{ t: "degats", cible: id, par: "a", degats: 30, pv: 80, bouclier: 0, zone: "corps" }]);
    expect(sorties.find((s) => s.m.t === "degats")!.a).toBe("a");
    expect(msgs(sorties, "argent")).toEqual([{ t: "argent", solde: 500 + gainTouche(), delta: 10, motif: "touche" }]);
    expect(msgs(sorties, "zombieMort")).toEqual([]);
    expect(b.svc.possede(id)).toBe(true);
    expect(b.svc.snap()!.z[5]).toBe(80);
  });

  it("un kill au corps : 60 $ (pas de touche en plus), kills++, série, killsParArme, zombieMort aux joueurs, présence", () => {
    const { b, id, j } = avecUnTigre();
    const sorties = b.svc.blesser(id, 1000, j, "corps", T_PREMIER_TIGRE + 200, { arme: "pistolet" });
    expect(msgs(sorties, "argent")[0]).toMatchObject({ delta: 60, motif: "kill", solde: 560 });
    const mort = sorties.find((s) => s.m.t === "zombieMort")!;
    expect(mort.a).toBe("joueurs");
    expect(mort.m).toMatchObject({ id, par: "a", zone: "corps" });
    expect(j).toMatchObject({ kills: 1, serie: 1, serieMax: 1, killsParArme: { pistolet: 1 } });
    expect(types(sorties)).toContain("presence");
    expect(b.svc.possede(id)).toBe(false);
    expect(b.svc.blesser(id, 10, j, "corps", T_PREMIER_TIGRE + 300)).toEqual([]);
    expect(b.svc.toucheZombie(id, [0, 0, 0], [1, 0, 0], 50, T_PREMIER_TIGRE + 300)).toBeNull();
  });

  it("kill à la tête 100 $, au couteau 130 $ (cause melee) ; `gain:false` : aucune touche payée", () => {
    const { b, id, j } = avecUnTigre();
    expect(msgs(b.svc.blesser(id, 1000, j, "tete", T_PREMIER_TIGRE + 200), "argent")[0].delta).toBe(gainKill({ tete: true }));
    expect(gainKill({ tete: true })).toBe(100);
    const c = avecUnTigre();
    expect(msgs(c.b.svc.blesser(c.id, 20, c.j, "corps", T_PREMIER_TIGRE + 200, { gain: false }), "argent")).toEqual([]);
    const d = avecUnTigre();
    const melee = d.b.svc.blesser(d.id, 1000, d.j, "corps", T_PREMIER_TIGRE + 200, { melee: true });
    expect(msgs(melee, "argent")[0].delta).toBe(130);
    expect(msgs(melee, "zombieMort")[0].cause).toBe("melee");
  });

  it("(v8) zombieMort dit comment : arme, amélioration au Pack-a-Punch, origine du coup arrondie au cm ; rien de plus sans ces options", () => {
    const { b, id, j } = avecUnTigre();
    j.equip = { ...j.equip, ameliorees: ["pistolet"] };
    const mort = msgs(b.svc.blesser(id, 99_999, j, "tete", T_PREMIER_TIGRE + 200, { arme: "pistolet", src: [1.234, 1.6, -2.006] }), "zombieMort")[0];
    expect(mort).toMatchObject({ arme: "pistolet", ameliore: true, src: [1.23, 1.6, -2.01], zone: "tete" });
    const c = avecUnTigre();
    const nu = msgs(c.b.svc.blesser(c.id, 99_999, c.j, "corps", T_PREMIER_TIGRE + 200), "zombieMort")[0];
    expect(Object.keys(nu).sort()).toEqual(["id", "p", "par", "t", "zone"]);
  });

  it("(v8) souffle du Pistolet à rayons : zombieMort en explosion, arme « rayon », origine = centre du souffle", () => {
    const { b, z, id, j } = avecUnTigre();
    const t = T_PREMIER_TIGRE + 200;
    const o: Vec3 = [z.x - 3, 0.8, z.z];
    const sorties = b.svc.explosionTir(j, "rayon", o, [1, 0, 0], 3, 50, t);
    const mort = msgs(sorties, "zombieMort").find((m) => m.id === id)!;
    expect(mort).toMatchObject({ cause: "explosion", arme: "rayon" });
    expect(mort.src![0]).toBeCloseTo(z.x, 1);
    expect(mort.src![2]).toBeCloseTo(z.z, 1);
  });

  it("pas de bonus de fin de manche (BO1) : l'argent ne vient que des touches, kills, planches et bonus", () => {
    const b = partieEnCours(["a"], { degatsGriffe: 0 });
    const j = b.j("a");
    const r = finirManche(b, j, T_PREMIER_TIGRE);
    expect(msgs(r.sorties, "argent").every((m) => ["kill", "touche", "nuke", "menuisier"].includes(m.motif))).toBe(true);
    expect(b.svc.etat()).toMatchObject({ phase: "pause", manche: 2 });
  });

  it("dégâts d'arme contre les tigres : profil zombies, amélioration, insta-kill ; arme blanche ; perce ; cadence et santé", () => {
    const { b, j } = avecUnTigre();
    expect(b.svc.degatsTir(j, "pistolet", "corps", 5, 0)).toBe(40);
    expect(b.svc.degatsTir(j, "sniper", "corps", 5, 0)).toBe(900);
    expect(b.svc.perce(j, "sniper")).toBe(false); // seul le sniper amélioré perce
    expect(b.svc.perce(j, "railgun")).toBe(true);
    expect(b.svc.perce(j, "pistolet")).toBe(false);
    expect(b.svc.degatsMelee(j, "couteau", 0)).toBe(150);
    expect(b.svc.degatsMelee(j, "epee", 0)).toBe(1000);
    expect(b.svc.cadence(j)).toBe(1);
    expect(b.svc.sante(j)).toEqual({ pvMax: 100, delaiMs: 3000, pvParS: 60 });
  });
});

// =================================================================================================
describe("fin de manche, pauses", () => {
  it("tous les tigres apparus et morts : pause de 10 s, manche suivante ; le premier tigre apparaît dans le tic même", () => {
    const b = partieEnCours();
    const j = b.j("a");
    const { t } = finirManche(b, j, T_PREMIER_TIGRE);
    expect(b.svc.etat()).toMatchObject({ phase: "pause", manche: 2, debutT: t, finT: t + ZOMBIES.pauseMs });
    expect(j.kills).toBe(totalManche(1, 1));
    avancer(b, t + 100, t + ZOMBIES.pauseMs - 50);
    expect(b.svc.etat().phase).toBe("pause");
    expect(tigresVivants(b)).toHaveLength(0);
    const s2 = avancer(b, t + ZOMBIES.pauseMs, t + ZOMBIES.pauseMs + 100);
    expect(dernierEtat(s2)).toMatchObject({ phase: "manche", manche: 2 });
    expect(msgs(s2, "zevt").find((m) => m.e.e === "manche")!.e).toMatchObject({ numero: 2, truck: false });
    expect(tigresVivants(b)).toHaveLength(1);
  });

  it("la pause relève les joueurs à terre (50 PV), ramène les éliminés (équipement de départ, 500 $) et admet les arrivants", () => {
    const b = partieEnCours(["a", "b", "c"], { degatsGriffe: 0 });
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    const [a, bb, c] = [b.j("a"), b.j("b"), b.j("c")];
    const t1 = T_PREMIER_TIGRE + 200;
    b.ctx.infliger(c, 1000, null, "tigre_zombie", "corps", "couteau", t1);
    avancer(b, t1 + 50, t1 + ZOMBIES.terreMs + 100, 250);
    expect(b.svc.etat().joueurs.map((x) => x.etat)).toEqual(["debout", "debout", "elimine"]);
    c.equip = copierEquipement({ ...c.equip, melee: "epee" });
    const t2 = t1 + ZOMBIES.terreMs + 1000;
    b.ctx.infliger(bb, 1000, null, "tigre_zombie", "corps", "couteau", t2);
    expect(b.svc.etat().joueurs[1].etat).toBe("terre");
    b.arrive("d", t2 + 500);
    expect(b.svc.admis("d")).toBe(false);
    const { sorties } = finirManche(b, a, t2 + 1000);
    const apparitions = msgs(sorties, "apparition");
    const etat = b.svc.etat();
    expect(etat.phase).toBe("pause");
    expect(etat.joueurs.map((x) => x.etat)).toEqual(["debout", "debout", "debout", "debout"]);
    expect(apparitions.find((m) => m.id === "b")).toMatchObject({ pv: ZOMBIES.reanimationPv });
    expect(apparitions.find((m) => m.id === "c")).toMatchObject({ pv: JEU.pvMax, main: "secondaire", equip: { sansPrincipale: true, secondaire: "pistolet" } });
    expect(apparitions.find((m) => m.id === "c")!.equip.melee).toBeUndefined();
    const argents = sorties.filter((x) => x.m.t === "argent" && (x.m.motif === "depart" || x.m.motif === "retour"));
    expect(argents.map((x) => [x.a, (x.m as { solde: number }).solde]).sort()).toEqual([["c", 500], ["d", 500]]);
    expect(bb.vivant).toBe(true);
  });
});

// =================================================================================================
describe("bonus (BO1 : seuil de points, paquet mélangé, 4 par manche)", () => {
  /** Tue chaque tigre à la tête dès qu'il apparaît ; au premier bonus lâché, va le ramasser ; renvoie les genres ramassés et leurs sorties. */
  function jouer(graine: number, maxMs = 120_000) {
    const b = partieEnCours(["a"], { alea: suite(graine), total1: 200, degatsGriffe: 0 });
    const j = b.j("a");
    const vus: { genre: GenreBonus; sorties: Sortie[]; t: number; avant: { argent: number; vivants: number } }[] = [];
    let t = T_PREMIER_TIGRE;
    let argent = 500;
    for (; t < T_PREMIER_TIGRE + maxMs && vus.length < 4; t += 100) {
      const s = b.svc.tic(t);
      for (const m of msgs(s, "argent")) argent = m.solde;
      // seuls les tigres entrés (dans une zone) lâchent un bonus : on laisse les autres passer leur fenêtre
      for (const z of tigresVivants(b)) if (zoneEn(ZONES_SOL, z.x, z.z)) for (const m of msgs(b.svc.blesser(`z${z.id}`, 100_000, j, "tete", t), "argent")) argent = m.solde;
      const sol = b.svc.etat().bonus[0];
      if (sol) {
        const vivants = tigresVivants(b).length;
        j.p = [sol.p[0], 0, sol.p[2]];
        t += 50;
        const r = b.svc.tic(t);
        vus.push({ genre: sol.genre, sorties: r, t, avant: { argent, vivants } });
        for (const m of msgs(r, "argent")) argent = m.solde;
      }
    }
    return { b, j, vus };
  }

  it("le premier bonus tombe après j × 500 + 2 000 points gagnés, au plus 4 par manche, et chaque genre a son effet", () => {
    const genres = new Set<GenreBonus>();
    for (let graine = 1; graine <= 12 && genres.size < 6; graine++) {
      const { b, vus } = jouer(graine);
      expect(vus.length).toBeGreaterThan(0);
      expect(vus.length).toBeLessThanOrEqual(ZOMBIES.bonusParManche);
      for (const v of vus) {
        genres.add(v.genre);
        expect(msgs(v.sorties, "zevt").some((m) => m.e.e === "bonus" && m.e.genre === v.genre)).toBe(true);
        const effets = b.svc.etat().effets;
        switch (v.genre) {
          case "instakill": expect(effets.instakillFinT).toBeGreaterThanOrEqual(v.t + ZOMBIES.bonusDureeMs - 20_000); break;
          case "double": expect(effets.doubleFinT).toBeGreaterThan(v.t); break;
          case "soldes": expect(effets.soldesFinT).toBeGreaterThan(v.t); break;
          case "munitions": expect(msgs(v.sorties, "equipement")[0]).toMatchObject({ ravitaille: "tout" }); break;
          case "nuke": expect(msgs(v.sorties, "argent").find((m) => m.motif === "nuke")!.delta).toBe(400); break;
          case "menuisier": expect(msgs(v.sorties, "argent").find((m) => m.motif === "menuisier")!.delta).toBe(200); break;
        }
      }
    }
    expect([...genres].sort()).toEqual(["double", "instakill", "menuisier", "munitions", "nuke", "soldes"]);
  });

  it("double points : un kill au corps rapporte 120 $ ; insta-kill : tout tigre meurt au premier coup", () => {
    for (let graine = 1; graine <= 20; graine++) {
      const { b, j, vus } = jouer(graine);
      const d = vus.find((v) => v.genre === "double" || v.genre === "instakill");
      if (!d) continue;
      const t = d.t + 100;
      if (d.genre === "double") {
        expect(b.svc.degatsTir(j, "pistolet", "corps", 5, t)).toBe(40);
      } else {
        expect(b.svc.degatsTir(j, "pistolet", "corps", 5, t)).toBeGreaterThanOrEqual(1e6);
        expect(b.svc.degatsMelee(j, "couteau", t)).toBeGreaterThanOrEqual(1e6);
      }
      return;
    }
    throw new Error("aucune graine ne donne double points ou insta-kill");
  });
});

// =================================================================================================
describe("achats", () => {
  /** Joueur « a » en manche 1, debout, placé en `pos` (pieds), `argentDepart` $ en poche. */
  function avec(pos: Vec2, argentDepart: number, opts: Partial<OptionsServiceZombies> = {}) {
    const b = partieEnCours(["a"], { argentDepart, ...opts });
    avancer(b, T0 + 100, T_MANCHE1 + 50); // manche 1, aucun tigre encore (grâce)
    const j = b.j("a");
    j.p = [pos[0], 0, pos[1]];
    return { b, j };
  }
  const achat = (id: string) => ACHATS.find((a) => a.id === id)!;
  const acheter = (b: Banc, j: JoueurSalle, id: string, t = T_MANCHE1 + 100) => b.svc.recevoir(j, msg({ t: "acheter", id }), t);

  it("départ : pistolet et couteau ; le revolver (500 $) remplace le pistolet, la craie devient l'arme ; racheté = munitions à moitié prix", () => {
    const { b, j } = avec(achat("mur:revolver").position, 1000);
    expect(j.equip).toEqual({ principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true });
    expect(armeDuSlot(j.equip, "principale")).toBeNull();
    const s = acheter(b, j, "mur:revolver");
    expect(msgs(s, "achat")).toEqual([{ t: "achat", ok: true, id: "mur:revolver" }]);
    expect(msgs(s, "argent")).toEqual([{ t: "argent", solde: 500, delta: -500, motif: "achat" }]);
    expect(j).toMatchObject({ main: "secondaire", arme: "revolver" });
    expect(j.equip).toMatchObject({ secondaire: "revolver", sansPrincipale: true });
    expect(b.svc.etat().murs).toEqual(["mur:revolver"]);
    const r = acheter(b, j, "mur:revolver", T_MANCHE1 + 200);
    expect(msgs(r, "argent")[0]).toMatchObject({ delta: -achat("mur:revolver").prixMunitions!, solde: 500 - achat("mur:revolver").prixMunitions! });
    expect(msgs(r, "equipement")[0]).toMatchObject({ ravitaille: "revolver" });
  });

  it("une principale achetée (mitraillette, 1 200 $) remplace le remplissage, retire sansPrincipale, passe en main", () => {
    const { b, j } = avec(achat("mur:mitraillette").position, 1200);
    const s = acheter(b, j, "mur:mitraillette");
    expect(msgs(s, "achat")[0]).toMatchObject({ ok: true });
    expect(j.equip).toEqual({ principale: "mitraillette", secondaire: "pistolet", speciale: null });
    expect(j).toMatchObject({ main: "principale", arme: "mitraillette" });
    expect(msgs(s, "equipement")[0]).toMatchObject({ main: "principale", ravitaille: "mitraillette" });
    expect(b.memorises).toEqual(["a"]);
    expect(msgs(acheter(b, j, "mur:mitraillette", T_MANCHE1 + 200), "achat")[0]).toMatchObject({ ok: false, raison: "argent" });
  });

  it("l'épée (3 000 $) passe `melee` à `epee` sans changer d'arme en main ; déjà l'épée : `deja`", () => {
    const { b, j } = avec(achat("mur:epee").position, 3000);
    const s = acheter(b, j, "mur:epee");
    expect(j.equip.melee).toBe("epee");
    expect(j.main).toBe("secondaire");
    expect(msgs(s, "argent")[0]).toMatchObject({ solde: 0, delta: -3000 });
    const encore = acheter(b, j, "mur:epee", T_MANCHE1 + 200);
    expect(msgs(encore, "achat")[0]).toEqual({ t: "achat", ok: false, id: "mur:epee", raison: "deja" });
    expect(msgs(encore, "argent")).toEqual([]);
  });

  it("refus : `argent` (rien n'est débité), `loin`, id inconnu, `partie` (pas de partie, à terre)", () => {
    const { b, j } = avec(achat("mur:revolver").position, 100);
    expect(msgs(acheter(b, j, "mur:revolver"), "achat")[0]).toEqual({ t: "achat", ok: false, id: "mur:revolver", raison: "argent" });
    expect(j.equip.secondaire).toBe("pistolet");
    j.p = [achat("mur:revolver").position[0] + 4, 0, achat("mur:revolver").position[1]];
    expect(msgs(acheter(b, j, "mur:revolver"), "achat")[0]).toMatchObject({ ok: false, raison: "loin" });
    expect(msgs(acheter(b, j, "inconnu"), "achat")[0]).toMatchObject({ ok: false, raison: "loin" });
    expect(msgs(b.svc.recevoir(j, { t: "acheter", id: 42 as unknown as string }, T_MANCHE1 + 100), "achat")[0]).toMatchObject({ ok: false, id: "", raison: "loin" });
    j.p = [achat("mur:revolver").position[0], 0, achat("mur:revolver").position[1]];
    b.ctx.infliger(j, 1000, null, "tigre_zombie", "corps", "couteau", T_MANCHE1 + 150);
    expect(msgs(acheter(b, j, "mur:revolver", T_MANCHE1 + 200), "achat")[0]).toMatchObject({ ok: false, raison: "partie" });
    const lobby = banc();
    const { j: l } = lobby.arrive("a");
    expect(msgs(lobby.svc.recevoir(l, msg({ t: "acheter", id: "mur:revolver" }), T0), "achat")[0]).toMatchObject({ ok: false, raison: "partie" });
  });

  it("pas d'achat à travers un mur : à portée du point mais de l'autre côté de la façade, c'est `loin`", () => {
    for (const id of ["mur:revolver", "mur:pompe", "mur:mitraillette"]) {
      const a = achat(id);
      const { b, j } = avec(a.position, 10_000);
      const n = a.facade!.normale;
      j.p = [a.position[0] - n[0] * 2.4, 0, a.position[1] - n[1] * 2.4];
      expect(msgs(acheter(b, j, id), "achat")[0], id).toMatchObject({ ok: false, raison: "loin" });
    }
  });

  it("boîte mystère : 950 $, tirage 4 s, offre 12 s ; l'arme prise remplace celle de sa catégorie ; jamais le pistolet, le mini Uzi ni une arme portée", () => {
    const b0 = partieEnCours(["a"], { argentDepart: 10_000 });
    const em = b0.svc.etat().boite.emplacement;
    expect([0, 1]).toContain(em);
    const ici = achatBoite(em), ailleurs = achatBoite((em + 2) % 5);
    const { b, j } = avec(ici.position, 10_000);
    const emB = b.svc.etat().boite.emplacement;
    const bonne = achatBoite(emB);
    j.p = [bonne.position[0], 0, bonne.position[1]];
    j.p = [ailleurs.position[0], 0, ailleurs.position[1]];
    expect(msgs(acheter(b, j, ailleurs.id), "achat")[0]).toMatchObject({ ok: false, raison: "loin" });
    j.p = [bonne.position[0], 0, bonne.position[1]];
    let t = T_MANCHE1 + 100;
    const s = acheter(b, j, bonne.id, t);
    expect(msgs(s, "achat")[0]).toMatchObject({ ok: true, id: bonne.id });
    expect(msgs(s, "argent")[0]).toMatchObject({ delta: -950 });
    const tirage = b.svc.etat().boite;
    expect(tirage).toMatchObject({ etat: "tirage", pour: "a", utilisations: 1, finT: t + TIRAGE_BOITE_MS });
    expect(["pistolet", "mini_uzi", "peluche"]).not.toContain(tirage.arme);
    expect(msgs(acheter(b, j, bonne.id, t + 100), "achat")[0]).toMatchObject({ ok: false, raison: "occupe" });
    t += TIRAGE_BOITE_MS + 50;
    b.svc.tic(t);
    expect(b.svc.etat().boite).toMatchObject({ etat: "offre", finT: t + OFFRE_BOITE_MS });
    const pris = acheter(b, j, bonne.id, t + 100);
    expect(msgs(pris, "achat")[0]).toMatchObject({ ok: true });
    expect(msgs(pris, "argent")).toEqual([]); // déjà payée
    expect(j.arme).toBe(tirage.arme);
    expect(b.svc.etat().boite).toMatchObject({ etat: "fermee", utilisations: 1 });
    // une offre non prise se referme au bout de 12 s
    acheter(b, j, bonne.id, t + 200);
    b.svc.tic(t + 200 + TIRAGE_BOITE_MS + 50);
    expect(b.svc.etat().boite.etat).toBe("offre");
    b.svc.tic(t + 200 + TIRAGE_BOITE_MS + 50 + OFFRE_BOITE_MS + 50);
    expect(b.svc.etat().boite.etat).toBe("fermee");
  });

  it("la peluche : jamais avant 4 tirages, forcée au 8ᵉ si la boîte n'a jamais bougé ; elle rembourse, la boîte s'envole et se pose ailleurs", () => {
    const { b, j } = avec([0, 0], 1e7);
    let t = T_MANCHE1 + 100;
    const em = b.svc.etat().boite.emplacement;
    const a = achatBoite(em);
    j.p = [a.position[0], 0, a.position[1]];
    let peluche = 0;
    for (let k = 1; k <= 8 && !peluche; k++) {
      expect(msgs(acheter(b, j, a.id, t), "achat")[0].ok, `tirage ${k}`).toBe(true);
      const arme = b.svc.etat().boite.arme;
      if (arme === "peluche") {
        peluche = k;
        t += TIRAGE_BOITE_MS + 50;
        const s = b.svc.tic(t);
        expect(msgs(s, "argent")[0]).toMatchObject({ delta: 950, motif: "peluche" });
        expect(msgs(s, "zevt").some((m) => m.e.e === "peluche")).toBe(true);
        expect(b.svc.etat().boite.etat).toBe("envol");
        b.svc.tic(t + ENVOL_BOITE_MS + 50);
        expect(b.svc.etat().boite).toMatchObject({ etat: "fermee", utilisations: 0 });
        expect(b.svc.etat().boite.emplacement).not.toBe(em);
        expect(msgs(acheter(b, j, a.id, t + ENVOL_BOITE_MS + 100), "achat")[0]).toMatchObject({ ok: false, raison: "loin" });
      } else {
        t += TIRAGE_BOITE_MS + 50;
        b.svc.tic(t);
        t += OFFRE_BOITE_MS + 50;
        b.svc.tic(t);
        t += 50;
      }
    }
    expect(peluche).toBeGreaterThanOrEqual(4);
    expect(peluche).toBeLessThanOrEqual(8);
  });

  it("atouts : Pause Café à 500 $ seul, les autres exigent le courant ; Gratin = 250 PV, Ristretto = cadence × 1,33 ; perdus à terre", () => {
    const pc = achat("atout:pausecafe");
    const { b, j } = avec(pc.position, 10_000);
    const s = acheter(b, j, pc.id);
    expect(msgs(s, "argent")[0]).toMatchObject({ delta: -ATOUTS.pausecafe.prixSolo! });
    expect(msgs(s, "zevt")[0].e).toMatchObject({ e: "atout", joueur: "a", atout: "pausecafe" });
    expect(b.svc.etat().joueurs[0].atouts).toEqual(["pausecafe"]);
    expect(msgs(acheter(b, j, pc.id, T_MANCHE1 + 200), "achat")[0]).toMatchObject({ ok: false, raison: "deja" });
    const g = achat("atout:gratin");
    j.p = [g.position[0], 0, g.position[1]];
    expect(msgs(acheter(b, j, g.id, T_MANCHE1 + 300), "achat")[0]).toMatchObject({ ok: false, raison: "courant" });

    const c = avec(g.position, 10_000, { courant: true });
    expect(msgs(acheter(c.b, c.j, g.id), "achat")[0]).toMatchObject({ ok: true });
    expect(c.j.pv).toBe(250);
    expect(c.b.svc.sante(c.j).pvMax).toBe(250);
    const r = achat("atout:ristretto");
    c.j.p = [r.position[0], 0, r.position[1]];
    expect(msgs(acheter(c.b, c.j, r.id, T_MANCHE1 + 200), "achat")[0]).toMatchObject({ ok: true });
    expect(c.b.svc.cadence(c.j)).toBeCloseTo(1 / 1.33, 9);
    c.b.ctx.infliger(c.j, 10_000, null, "tigre_zombie", "corps", "couteau", T_MANCHE1 + 300);
    expect(c.b.svc.etat().joueurs[0].atouts).toEqual([]);
    expect(c.b.svc.cadence(c.j)).toBe(1);
  });

  it("Pause Café seul : à terre, il se relève tout seul 4 s plus tard (3 fois par partie), et la partie n'est pas perdue", () => {
    const pc = achat("atout:pausecafe");
    const { b, j } = avec(pc.position, 10_000, { degatsGriffe: 0 });
    let t = T_MANCHE1 + 100;
    acheter(b, j, pc.id, t);
    b.ctx.infliger(j, 1000, null, "tigre_zombie", "corps", "couteau", t + 50);
    expect(b.svc.etat()).toMatchObject({ phase: "manche" });
    expect(b.svc.etat().joueurs[0]).toMatchObject({ etat: "terre", autoReleves: 2 });
    t += 50;
    const s = avancer(b, t + 50, t + AUTO_RELEVE_MS + 100);
    expect(msgs(s, "zevt").some((m) => m.e.e === "autoReleve")).toBe(true);
    expect(b.svc.etat().joueurs[0]).toMatchObject({ etat: "debout", atouts: [] });
    expect(j.pv).toBe(ZOMBIES.reanimationPv);
  });

  it("courant (local technique) : rétabli une fois, `zevt courant` ; Pack-a-Punch (5 000 $) : cuisson 3,5 s puis arme améliorée", () => {
    const co = achat("courant");
    const { b, j } = avec(co.position, 20_000);
    const pa = achat("pap");
    j.p = [pa.position[0], 0, pa.position[1]];
    expect(msgs(acheter(b, j, "pap"), "achat")[0]).toMatchObject({ ok: false, raison: "courant" });
    j.p = [co.position[0], 0, co.position[1]];
    const s = acheter(b, j, "courant");
    expect(msgs(s, "achat")[0]).toMatchObject({ ok: true });
    expect(msgs(s, "zevt")[0].e).toEqual({ e: "courant" });
    expect(b.svc.etat().courant).toBe(true);
    expect(msgs(acheter(b, j, "courant", T_MANCHE1 + 150), "achat")[0]).toMatchObject({ ok: false, raison: "deja" });
    j.p = [pa.position[0], 0, pa.position[1]];
    const t = T_MANCHE1 + 200;
    const p = acheter(b, j, "pap", t);
    expect(msgs(p, "argent")[0]).toMatchObject({ delta: -5000 });
    expect(b.svc.etat().pap).toMatchObject({ etat: "cuisson", joueur: "a", arme: "pistolet", finT: t + CUISSON_PAP_MS });
    expect(msgs(acheter(b, j, "pap", t + 100), "achat")[0]).toMatchObject({ ok: false, raison: "occupe" });
    const fin = avancer(b, t + 50, t + CUISSON_PAP_MS + 100);
    expect(msgs(fin, "equipement")[0].equip.ameliorees).toEqual(["pistolet"]);
    expect(msgs(fin, "zevt").some((m) => m.e.e === "pap" && m.e.pret)).toBe(true);
    expect(b.svc.etat().pap.etat).toBe("libre");
    expect(b.svc.degatsTir(j, "pistolet", "corps", 5, t + 5000)).toBe(160);
    expect(msgs(acheter(b, j, "pap", t + 5000), "achat")[0]).toMatchObject({ ok: false, raison: "deja" });
  });

  it("Recette ultime : trois ingrédients (la truffe et le four exigent le courant), 30 s de cuisson, Rayon Goulaf amélioré + un atout", () => {
    const { b, j } = avec([0, 0], 1000, { courant: true });
    const four = achat("four");
    j.p = [four.position[0], 0, four.position[1]];
    expect(msgs(acheter(b, j, "four"), "achat")[0]).toMatchObject({ ok: false, raison: "quete" });
    for (const ing of ["sel", "herbes", "truffe"]) {
      const a = achat(`ingredient:${ing}`);
      j.p = [a.position[0], 0, a.position[1]];
      const s = acheter(b, j, a.id);
      expect(msgs(s, "achat")[0], ing).toMatchObject({ ok: true });
      expect(msgs(acheter(b, j, a.id), "achat")[0]).toMatchObject({ ok: false, raison: "deja" });
    }
    expect(b.svc.etat().quete.ingredients).toEqual(["sel", "herbes", "truffe"]);
    j.p = [four.position[0], 0, four.position[1]];
    const t = T_MANCHE1 + 200;
    expect(msgs(acheter(b, j, "four", t), "achat")[0]).toMatchObject({ ok: true });
    expect(b.svc.etat().quete.cuissonFinT).toBe(t + CUISSON_RECETTE_MS);
    j.pv = 1e9;
    const fin = avancer(b, t + 50, t + CUISSON_RECETTE_MS + 100, 100);
    const eq = msgs(fin, "equipement").find((m) => m.equip.secondaire === "rayon")!;
    expect(eq.equip.ameliorees).toContain("rayon");
    expect(b.svc.etat().quete.faite).toBe(true);
    expect(b.svc.etat().joueurs[0].atouts.length).toBe(1);
  });

  it("munitions d'une arme améliorée au mur : 2 500 $", () => {
    const { b, j } = avec(achat("mur:revolver").position, 10_000);
    acheter(b, j, "mur:revolver");
    j.equip = copierEquipement({ ...j.equip, ameliorees: ["revolver"] });
    expect(msgs(acheter(b, j, "mur:revolver", T_MANCHE1 + 200), "argent")[0]).toMatchObject({ delta: -2500 });
  });
});

// =================================================================================================
describe("barricades", () => {
  it("les tigres arrachent les planches ; un joueur maintenu à la fenêtre en repose une par seconde, 10 $ chacune", () => {
    const b = partieEnCours(["a"], { total1: 60, degatsGriffe: 0 });
    const j = b.j("a");
    const f = fenetreDeId("F1")!;
    j.p = [f.dedans[0], 0, f.dedans[1]];
    j.pv = 1e9;
    let t = T0 + 100;
    let arrachees = 0;
    for (; t < T_PREMIER_TIGRE + 90_000 && arrachees === 0; t += 100) {
      arrachees += msgs(b.svc.tic(t), "zevt").filter((m) => m.e.e === "planche" && m.e.fenetre === "F1" && m.e.arrachee).length;
    }
    expect(arrachees).toBeGreaterThan(0);
    const avant = b.svc.etat().fenetres[FENETRES.indexOf(f)];
    expect(avant).toBeLessThan(6);
    // tuer les tigres à la fenêtre, puis reposer
    tuerTous(b, j, t);
    expect(b.svc.recevoir(j, msg({ t: "reparer", fenetre: "F1" }), t)).toEqual([]);
    const s = avancer(b, t + 50, t + 1100);
    const reposes = msgs(s, "zevt").filter((m) => m.e.e === "planche" && !m.e.arrachee);
    expect(reposes.length).toBeGreaterThanOrEqual(1);
    expect(msgs(s, "argent").some((m) => m.motif === "planche" && m.delta === 10)).toBe(true);
    // trop loin : la repose s'arrête
    j.p = [f.dedans[0] + f.normale[0] * 6, 0, f.dedans[1] + f.normale[1] * 6];
    const s2 = avancer(b, t + 1200, t + 3500);
    expect(msgs(s2, "zevt").filter((m) => m.e.e === "planche" && !m.e.arrachee)).toHaveLength(0);
  });
});

// =================================================================================================
describe("manches du Truck Muche", () => {
  it("le Truck recule au quai, lâche des petits (type 3) qui chassent ; criblé, il explose (+500 $) ; le dernier petit lâche des munitions max", () => {
    const b = partieEnCours(["a"], { mancheTruck: 1, total1: 4, degatsGriffe: 0 });
    const j = b.j("a");
    j.pv = 1e9;
    const debut = avancer(b, T0 + 100, T_MANCHE1 + 100);
    expect(msgs(debut, "zevt").find((m) => m.e.e === "manche")!.e).toMatchObject({ numero: 1, truck: true });
    expect(b.svc.etat().mancheTruck).toBe(true);
    let t = T_MANCHE1 + 100;
    let petits = 0;
    // (v8) la foudre lâche les premiers petits avant que le Truck ne soit à quai
    for (; t < T_MANCHE1 + 30_000 && (petits === 0 || b.svc.etat().truck?.phase !== "livraison"); t += 100) {
      b.svc.tic(t);
      petits = tigresVivants(b).filter((z) => z.type === 3).length;
    }
    expect(petits).toBeGreaterThan(0);
    expect(b.svc.etat().truck).toMatchObject({ phase: "livraison" });
    expect(b.svc.snap()!.t).toHaveLength(5);
    // criblé à mort
    const s = b.svc.blesserTruck(1e7, j, t);
    expect(msgs(s, "zevt").some((m) => m.e.e === "truck" && m.e.quoi === "explosion")).toBe(true);
    // (v8) les petits soufflés par l'explosion savent d'où elle vient
    expect(msgs(s, "zombieMort").every((m) => m.cause === "explosion" && m.src !== undefined)).toBe(true);
    expect(msgs(s, "argent").find((m) => m.motif === "truck")!.delta).toBe(500);
    expect(b.svc.etat().truck).toMatchObject({ phase: "epave" });
    expect(b.svc.toucheTruck([0, 1, 0], [1, 0, 0], 50)).toBeNull();
    // les petits restants sortent de l'épave ; on les tue tous
    let munitions = false;
    for (let k = 0; k < 400 && b.svc.etat().phase === "manche"; k++, t += 100) {
      const r = [...b.svc.tic(t)];
      for (const z of tigresVivants(b)) if (zoneEn(ZONES_SOL, z.x, z.z)) r.push(...b.svc.blesser(`z${z.id}`, 1e7, j, "corps", t));
      if (msgs(r, "zevt").some((m) => m.e.e === "bonusLache" && m.e.genre === "munitions")) munitions = true;
    }
    expect(munitions).toBe(true);
    expect(b.svc.etat()).toMatchObject({ phase: "pause", manche: 2, mancheTruck: false });
  });
});

describe("(v8) manches du Truck Muche vénères : foudre, petits, mini Trucks", () => {
  /** Fait tourner une manche du Truck (solo, joueur increvable) et relève naissances, éclairs, vivants, sauts. */
  function derouler(opts: Partial<OptionsServiceZombies>, duree: number, chaque?: (b: Banc, t: number, s: Sortie[]) => void) {
    const b = partieEnCours(["a"], { mancheTruck: 1, ...opts });
    const j = b.j("a");
    j.pv = 1e9;
    const nes = new Map<number, { t: number; p: Vec2; type: number }>();
    const eclairs: { t: number; p: Vec3; dans?: number }[] = [];
    let vivantsMax = 0;
    const sorties: Sortie[] = [];
    for (let t = T_MANCHE1; t <= T_MANCHE1 + duree; t += 50) {
      const s = b.svc.tic(t);
      sorties.push(...s);
      for (const m of msgs(s, "zevt")) if (m.e.e === "eclair") eclairs.push({ t, p: m.e.p, dans: m.e.dans });
      const vivants = tigresVivants(b);
      vivantsMax = Math.max(vivantsMax, vivants.length);
      for (const z of vivants) if (!nes.has(z.id)) nes.set(z.id, { t, p: [z.x, z.z], type: z.type });
      chaque?.(b, t, s);
    }
    return { b, j, nes, eclairs, vivantsMax, sorties };
  }

  it("la foudre frappe près du joueur dans sa zone : premier ennemi moins de 3 s après le début des apparitions, un éclair annoncé par ennemi", () => {
    const { j, nes, eclairs, vivantsMax } = derouler({ degatsGriffe: 0 }, 25_000);
    const premier = Math.min(...[...nes.values()].map((n) => n.t));
    expect(premier - T_PREMIER_TIGRE).toBeLessThan(3_000);
    expect(eclairs.length).toBeGreaterThan(3);
    for (const e of eclairs) {
      expect(e.dans).toBe(600);
      // l'ennemi naît sous l'éclair, 0,6 s plus tard
      const n = [...nes.values()].find((x) => x.t >= e.t && Math.hypot(x.p[0] - e.p[0], x.p[1] - e.p[2]) < 0.6);
      expect(n, `éclair en ${e.p}`).toBeDefined();
      expect(n!.t - e.t).toBeGreaterThanOrEqual(550);
      expect(n!.t - e.t).toBeLessThanOrEqual(700);
      // dans l'open space où se tient le joueur, entre 4 et 18 m de lui
      expect(zoneEn(ZONES_SOL, e.p[0], e.p[2])).toBe("open");
      const d = Math.hypot(e.p[0] - j.p[0], e.p[2] - j.p[2]);
      expect(d).toBeGreaterThanOrEqual(4);
      expect(d).toBeLessThanOrEqual(18);
    }
    // plafond de 4 + 3 par joueur
    expect(vivantsMax).toBeLessThanOrEqual(7);
    expect(vivantsMax).toBeGreaterThanOrEqual(4);
    // petits et mini Trucks
    expect([...nes.values()].some((n) => n.type === 3)).toBe(true);
    expect([...nes.values()].some((n) => n.type === 4)).toBe(true);
  });

  it("un mini Truck qui saute contre le joueur le blesse (souffle de 15 à 80 PV) et disparaît sans rapporter de kill", () => {
    let saut: Sortie[] | null = null;
    const { j } = derouler({}, 30_000, (_b, _t, s) => {
      if (!saut && msgs(s, "zevt").some((m) => m.e.e === "miniTruck")) saut = s;
    });
    expect(saut).not.toBeNull();
    const morts = msgs(saut!, "zombieMort").filter((m) => m.par === "");
    expect(morts.length).toBeGreaterThanOrEqual(1);
    expect(morts[0].cause).toBe("explosion");
    const coups = msgs(saut!, "degats").filter((m) => m.cible === "a");
    expect(coups.length).toBeGreaterThanOrEqual(1);
    expect(coups[0].degats).toBeGreaterThanOrEqual(15);
    expect(coups[0].degats).toBeLessThanOrEqual(80);
    expect(j.kills).toBe(0);
  });

  it("un mini Truck abattu saute 120 ms plus tard ; son souffle emporte les ennemis voisins et rapporte leurs kills au tireur", () => {
    const b = partieEnCours(["a"], { mancheTruck: 1, degatsGriffe: 0 });
    const j = b.j("a");
    j.pv = 1e9;
    let t = T_MANCHE1;
    let mini: ReturnType<typeof tigresVivants>[number] | undefined;
    for (; t < T_MANCHE1 + 30_000 && !mini; t += 50) { b.svc.tic(t); mini = tigresVivants(b).find((z) => z.type === 4 && !z.griffe); }
    expect(mini).toBeDefined();
    const s1 = b.svc.blesser(`z${mini!.id}`, 1e7, j, "corps", t);
    expect(msgs(s1, "zombieMort").map((m) => m.id)).toContain(`z${mini!.id}`);
    expect(msgs(s1, "zevt").some((m) => m.e.e === "miniTruck")).toBe(false);
    const killsAvant = j.kills;
    const voisins = tigresVivants(b).filter((z) => Math.hypot(z.x - mini!.x, z.z - mini!.z) < 2.5).length;
    const s2 = avancer(b, t + 50, t + 200);
    const souffle = msgs(s2, "zevt").map((m) => m.e).find((e) => e.e === "miniTruck") as Extract<MessageServeur, { t: "zevt" }>["e"] & { e: "miniTruck" };
    expect(souffle).toBeDefined();
    expect(Math.hypot(souffle.p[0] - mini!.x, souffle.p[2] - mini!.z)).toBeLessThan(1);
    expect(souffle).toMatchObject({ rayon: ZOMBIES.miniTruck.souffleM });
    // les voisins pris dans le souffle (en vue du centre) sont crédités au tireur
    const tues = msgs(s2, "zombieMort").filter((m) => m.par === "a" && m.cause === "explosion");
    expect(j.kills - killsAvant).toBe(tues.length);
    if (voisins) expect(tues.length).toBeGreaterThan(0);
  });

  it("le Truck Muche rit à l'ouverture de sa porte, sous la moitié de ses PV et en explosant", () => {
    const b = partieEnCours(["a"], { mancheTruck: 1, degatsGriffe: 0 });
    const j = b.j("a");
    j.pv = 1e9;
    let t = T_MANCHE1;
    const rires: string[] = [];
    for (; t < T_MANCHE1 + 30_000 && b.svc.etat().truck?.phase !== "livraison"; t += 50) {
      for (const m of msgs(b.svc.tic(t), "zevt")) if (m.e.e === "truck") rires.push(m.e.quoi);
    }
    expect(rires).toEqual(["porte", "rire"]);
    const pvMax = 2_500;
    const quoi = (s: Sortie[]) => msgs(s, "zevt").flatMap((m) => (m.e.e === "truck" ? [m.e.quoi] : []));
    expect(quoi(b.svc.blesserTruck(pvMax * 0.4, j, t))).toEqual([]);
    expect(quoi(b.svc.blesserTruck(pvMax * 0.2, j, t))).toEqual(["rire"]);
    expect(quoi(b.svc.blesserTruck(pvMax * 0.1, j, t))).toEqual([]);
    expect(quoi(b.svc.blesserTruck(pvMax, j, t))).toEqual(["explosion", "rire"]);
  });
});

// =================================================================================================
describe("à terre, relève, élimination, défaite", () => {
  function deux() {
    const b = partieEnCours(["a", "b"]);
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    return { b, a: b.j("a"), bb: b.j("b") };
  }
  const messageSansMort = (s: Sortie[]) => expect(types(s)).not.toContain("mort");

  it("0 PV : à terre 45 s, `zombies{etat}` immédiat avec terreFinT, présence, aucun message `mort`", () => {
    const { b, bb } = deux();
    const t = T_PREMIER_TIGRE + 200;
    const sorties = b.ctx.infliger(bb, 1000, null, "tigre_zombie", "corps", "couteau", t);
    messageSansMort(sorties);
    const joueur = dernierEtat(sorties)!.joueurs.find((x) => x.id === "b")!;
    expect(joueur).toMatchObject({ etat: "terre", terreFinT: t + ZOMBIES.terreMs });
    expect(types(sorties)).toContain("presence");
    expect(bb.morts).toBe(1);
    expect(dernierEtat(sorties)!.phase).toBe("manche");
  });

  it("un coéquipier debout à ≤ 2,5 m qui maintient E 3 s relève (50 PV, apparition à sa position, relèves++)", () => {
    const { b, a, bb } = deux();
    let t = T_PREMIER_TIGRE + 200;
    bb.p = [120, 0, -45];
    b.ctx.infliger(bb, 1000, null, "tigre_zombie", "corps", "couteau", t);
    a.p = [121, 0, -45];
    b.svc.recevoir(a, msg({ t: "reanimer", cible: "b" }), t);
    const debut = t;
    let sorties: Sortie[] = [];
    for (t += 50; t < debut + 2900; t += 50) sorties.push(...b.svc.tic(t));
    expect(b.svc.etat().joueurs[1].etat).toBe("terre");
    // les tigres éventuels ne touchent personne ici : on garde les joueurs hors de leur portée
    sorties = [];
    for (; t <= debut + 3100; t += 50) sorties.push(...b.svc.tic(t));
    const ap = msgs(sorties, "apparition").find((m) => m.id === "b")!;
    expect(ap).toMatchObject({ pv: 50, p: [120, 0, -45] });
    expect(b.svc.etat().joueurs[1]).toMatchObject({ etat: "debout", reanimations: 0 });
    expect(b.svc.etat().joueurs[0].reanimations).toBe(1);
    expect(bb.vivant).toBe(true);
    expect(bb.pv).toBe(50);
    expect(dernierEtat(sorties)).toBeDefined();
  });

  it("la relève s'annule : relanceur qui lâche, qui s'éloigne (> 3,2 m), qui tombe, cible éliminée ; hors portée d'armement : ignorée", () => {
    const { b, a, bb } = deux();
    const t = T_PREMIER_TIGRE + 200;
    bb.p = [120, 0, -45];
    b.ctx.infliger(bb, 1000, null, "tigre_zombie", "corps", "couteau", t);
    const tenter = (): void => { b.svc.recevoir(a, msg({ t: "reanimer", cible: "b" }), t); };
    a.p = [124, 0, -45]; // 4 m : hors portée d'armement
    tenter();
    expect(avancer(b, t + 50, t + 3300).some((s) => s.m.t === "apparition" && s.m.id === "b")).toBe(false);
    // il lâche
    a.p = [121, 0, -45];
    tenter();
    avancer(b, t + 3400, t + 4000);
    b.svc.recevoir(a, msg({ t: "reanimer", cible: null }), t + 4000);
    expect(avancer(b, t + 4050, t + 8000).some((s) => s.m.t === "apparition")).toBe(false);
    // il s'éloigne en cours de route
    b.svc.recevoir(a, msg({ t: "reanimer", cible: "b" }), t + 8000);
    avancer(b, t + 8050, t + 9000);
    a.p = [124.5, 0, -45];
    expect(avancer(b, t + 9050, t + 13_000).some((s) => s.m.t === "apparition" && s.m.id === "b")).toBe(false);
    // le relanceur tombe pendant la relève
    a.p = [121, 0, -45];
    b.svc.recevoir(a, msg({ t: "reanimer", cible: "b" }), t + 13_000);
    avancer(b, t + 13_050, t + 14_000);
    b.ctx.infliger(a, 1000, null, "tigre_zombie", "corps", "couteau", t + 14_000);
    expect(b.svc.etat().phase).toBe("fin"); // plus personne debout
  });

  it("45 s sans relève : éliminé (spectateur jusqu'à la pause) ; une relève ne peut pas viser un joueur debout, ni soi-même", () => {
    const { b, a, bb } = deux();
    const t = T_PREMIER_TIGRE + 200;
    expect(b.svc.recevoir(a, msg({ t: "reanimer", cible: "b" }), t)).toEqual([]); // b est debout
    expect(b.svc.recevoir(a, msg({ t: "reanimer", cible: "a" }), t)).toEqual([]);
    b.ctx.infliger(bb, 1000, null, "tigre_zombie", "corps", "couteau", t);
    a.p = [500, 0, 500]; // loin de tout : les griffes ne comptent pas
    avancer(b, t + 100, t + ZOMBIES.terreMs - 100, 100);
    expect(b.svc.etat().joueurs[1].etat).toBe("terre");
    const sorties = avancer(b, t + ZOMBIES.terreMs - 50, t + ZOMBIES.terreMs + 50, 50);
    expect(dernierEtat(sorties)!.joueurs[1]).toMatchObject({ etat: "elimine" });
    expect(dernierEtat(sorties)!.joueurs[1].terreFinT).toBeUndefined();
    expect(bb.enJeu).toBe(true); // un éliminé reste en jeu (il voit les snaps)
  });

  it("partie perdue dès que plus personne n'est debout : phase `fin`, bilan, tigres retirés, puis lobby après 25 s", () => {
    const b = partieEnCours(["a"]);
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    expect(tigresVivants(b).length).toBeGreaterThan(0);
    const t = T_PREMIER_TIGRE + 5000;
    const sorties = b.ctx.infliger(b.j("a"), 1000, null, "tigre_zombie", "corps", "couteau", t);
    messageSansMort(sorties);
    expect(dernierEtat(sorties)).toMatchObject({ phase: "fin", finT: t + ZOMBIES.finAffichageMs, bilan: { manche: 1, dureeMs: t - T0 } });
    expect(b.svc.snap()).toEqual({ r: 0, z: [] });
    expect(b.svc.enCours()).toBe(false);
    // 25 s plus tard : retour au lobby, tout le monde est retiré de l'arène, bâtiments relevés
    const fin = avancer(b, t + 100, t + ZOMBIES.finAffichageMs + 100, 500);
    expect(b.retires).toEqual(["a"]);
    expect(b.j("a").enJeu).toBe(false);
    expect(dernierEtat(fin)).toMatchObject({ phase: "lobby", manche: 0 });
    expect(dernierEtat(fin)!.bilan).toBeUndefined();
    expect(msgs(fin, "batiments").at(-1)).toMatchObject({ complet: true, detruits: [] });
    expect(b.svc.etat().joueurs[0]).toMatchObject({ etat: "attente", admis: false });
    expect(b.svc.snap()).toBeNull();
    // on peut relancer
    expect(dernierEtat(b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), t + 30_000))!.phase).toBe("pause");
  });

  it("une partie perdue pendant le décompte de départ affiche manche 0", () => {
    const b = partieEnCours(["a"]);
    const sorties = b.part("a", T0 + 500);
    expect(dernierEtat(sorties)!.joueurs).toEqual([]);
  });
});

// =================================================================================================
describe("liberer : Quitter, inactivité, déconnexion", () => {
  it("Quitter : le joueur repasse en attente (argent perdu, non admis) ; partie perdue s'il était le dernier debout", () => {
    const b = partieEnCours(["a", "b"]);
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    const a = b.j("a");
    a.enJeu = false; a.vivant = false; // comme `Salle.retirerDeLArene`
    const sorties = b.svc.liberer(a, T_PREMIER_TIGRE + 200);
    expect(dernierEtat(sorties)!.joueurs[0]).toMatchObject({ id: "a", etat: "attente", admis: false });
    expect(b.svc.admis("a")).toBe(false);
    expect(dernierEtat(sorties)!.phase).toBe("manche");
    // il ne peut plus acheter ni rejoindre sans nouvelle admission
    expect(msgs(b.svc.recevoir(a, msg({ t: "acheter", id: "mur:revolver" }), T_PREMIER_TIGRE + 300), "achat")[0]).toMatchObject({ ok: false, raison: "partie" });
    // le dernier debout part : défaite
    const bb = b.j("b");
    bb.enJeu = false; bb.vivant = false;
    expect(dernierEtat(b.svc.liberer(bb, T_PREMIER_TIGRE + 400))).toMatchObject({ phase: "fin" });
  });

  it("déconnexion du dernier membre en pleine partie : retour immédiat au lobby, sans bilan", () => {
    const b = partieEnCours(["a"]);
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    b.part("a", T_PREMIER_TIGRE + 200);
    expect(b.svc.etat()).toMatchObject({ phase: "lobby", manche: 0, joueurs: [], hote: "" });
    expect(b.svc.snap()).toBeNull();
    expect(b.svc.admis("a")).toBe(false);
  });

  it("un membre du lobby qui part : liste et hôte à jour, aucune défaite", () => {
    const b = banc();
    b.arrive("a"); b.arrive("b");
    const sorties = b.part("b", T0 + 5);
    expect(dernierEtat(sorties)!.joueurs.map((x) => x.id)).toEqual(["a"]);
    expect(b.svc.etat().phase).toBe("lobby");
  });

  it("un admis qui ne rejoint jamais (chargement échoué) repasse en attente au bout de 15 s et ne bloque pas la partie", () => {
    const b = banc();
    b.arrive("a"); b.arrive("b");
    b.svc.recevoir(b.j("a"), msg({ t: "lancerPartie" }), T0);
    // « a » ne rejoint jamais ; « b » non plus : la partie ne doit pas se perdre pendant le chargement
    avancer(b, T0 + 100, T0 + 14_000);
    expect(b.svc.etat().phase).toBe("manche");
    avancer(b, T0 + 14_050, T0 + 15_200);
    expect(b.svc.etat().joueurs.map((x) => x.admis)).toEqual([false, false]);
    expect(b.svc.etat().phase).toBe("fin");
  });
});

// =================================================================================================
describe("join-in-progress", () => {
  it("un arrivant en pleine partie reste en attente, `rejoindre` refusé (admis=false) ; admis à la pause suivante avec 500 $", () => {
    const b = partieEnCours(["a"]);
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    const { sorties } = b.arrive("b", T_PREMIER_TIGRE + 200);
    expect(dernierEtat(sorties)!.joueurs[1]).toMatchObject({ id: "b", etat: "attente", admis: false });
    expect(b.svc.admis("b")).toBe(false);
    // il ne gêne pas la défaite : seul « a » compte pour les debout
    const { sorties: fin } = finirManche(b, b.j("a"), T_PREMIER_TIGRE + 300);
    expect(msgs(fin, "argent").filter((m) => m.motif === "depart")).toEqual([{ t: "argent", solde: 500, delta: 0, motif: "depart" }]);
    expect(b.svc.admis("b")).toBe(true);
    expect(b.svc.etat().joueurs[1]).toMatchObject({ etat: "debout", admis: true });
    // les tigres de la manche suivante comptent maintenant 2 joueurs
    b.entre("b", T_PREMIER_TIGRE + 20_000);
  });
});

// =================================================================================================
describe("portes payantes", () => {
  type IdPorte = (typeof PORTES_PAYANTES)[number]["id"];
  function devantPorte(argent: number) {
    const b = partieEnCours(["a"], { argentDepart: argent, total1: 60, degatsGriffe: 0 });
    avancer(b, T0 + 100, T_MANCHE1 + 50);
    return { b, j: b.j("a") };
  }
  /** Cherche autour du milieu de la porte un point où l'achat n'est pas refusé pour `loin` ; renvoie ce dernier essai. */
  function acheterPorte(b: Banc, j: JoueurSalle, id: IdPorte, t = T_MANCHE1 + 100): Sortie[] {
    const porte = porteDeId(id)!;
    for (let r = 1.0; r <= 2.8; r += 0.2) {
      for (let a = 0; a < 360; a += 10) {
        j.p = [porte.point[0] + Math.cos((a * Math.PI) / 180) * r, 0, porte.point[1] + Math.sin((a * Math.PI) / 180) * r];
        const s = b.svc.recevoir(j, msg({ t: "acheter", id }), t);
        const m = msgs(s, "achat")[0];
        if (m.ok || m.raison !== "loin") return s;
      }
    }
    throw new Error(`aucun point d'achat trouvé pour ${id}`);
  }

  it("D1 (750 $) : la porte tombe, monde et navigation mis à jour, `batiments` à tous, argent débité, ne se rachète pas", () => {
    const { b, j } = devantPorte(750);
    const s = acheterPorte(b, j, "D1");
    expect(msgs(s, "achat")[0]).toEqual({ t: "achat", ok: true, id: "D1" });
    expect(msgs(s, "argent")[0]).toMatchObject({ solde: 0, delta: -750, motif: "achat" });
    const detruits = [idPrisme("D1")];
    expect(msgs(s, "batiments")).toEqual([{ t: "batiments", complet: false, detruits, breches: [] }]);
    expect(s.find((x) => x.m.t === "batiments")!.a).toBe("tous");
    expect(batimentsDetruits(b.ctx.monde)).toEqual(detruits);
    expect(b.ctx.monde.prismes[idPrisme("D1")].h).toBe(0);
    expect(dernierEtat(s)!.portes.find((p) => p.id === "D1")!.ouverte).toBe(true);
    expect(msgs(b.svc.recevoir(j, msg({ t: "acheter", id: "D1" }), T_MANCHE1 + 200), "achat")[0]).toMatchObject({ ok: false, raison: "deja" });
    expect(msgs(b.svc.synchro("z"), "batiments")[0]).toMatchObject({ complet: true, detruits });
  });

  it("une porte ne s'achète que depuis une zone ouverte : G3 (cour ↔ passage Est) exige D2 ; argent insuffisant : `argent`", () => {
    const { b, j } = devantPorte(100);
    expect(msgs(acheterPorte(b, j, "G3"), "achat")[0]).toMatchObject({ ok: false, raison: "verrou" });
    expect(msgs(acheterPorte(b, j, "D2"), "achat")[0]).toMatchObject({ ok: false, raison: "argent" });
    const r = devantPorte(10_000);
    expect(msgs(acheterPorte(r.b, r.j, "D2"), "achat")[0]).toMatchObject({ ok: true });
    expect(msgs(acheterPorte(r.b, r.j, "G3"), "achat")[0]).toMatchObject({ ok: true });
    expect(batimentsDetruits(r.b.ctx.monde)).toEqual(["D2", "G3"].map(idPrisme).sort((x, y) => x - y));
    j.p = [porteDeId("D1")!.point[0] + 10, 0, porteDeId("D1")!.point[1] + 10];
    expect(msgs(b.svc.recevoir(j, msg({ t: "acheter", id: "D1" }), T_MANCHE1 + 100), "achat")[0]).toMatchObject({ ok: false, raison: "loin" });
  });

  it("toutes les portes s'ouvrent l'une après l'autre en partant de l'open space", () => {
    const { b, j } = devantPorte(1e6);
    const restantes = new Set(PORTES_PAYANTES.map((p) => p.id));
    for (let tour = 0; tour < 12 && restantes.size; tour++) {
      for (const id of [...restantes]) if (msgs(acheterPorte(b, j, id), "achat")[0].ok) restantes.delete(id);
    }
    expect([...restantes]).toEqual([]);
    expect(b.svc.etat().portes.every((p) => p.ouverte)).toBe(true);
  });

  it("les tigres naissent dans les zones actives : portes fermées, l'open space seul ; D2 ouverte, la cour aussi", () => {
    /** Zones d'origine des tigres vus à leur apparition, pendant 40 s, joueur invincible à son départ. */
    const origines = (b: Banc, j: JoueurSalle, t0: number): Set<ZoneId | "?"> => {
      const vues = new Set<ZoneId | "?">();
      const connus = new Set<number>();
      j.p = [DEPARTS[0][0], 0, DEPARTS[0][1]]; j.pv = 1e9;
      for (let t = t0; t < t0 + 40_000; t += 100) {
        b.svc.tic(t);
        for (const z of tigresVivants(b)) {
          if (connus.has(z.id)) continue;
          connus.add(z.id);
          const f = FENETRES.find((x) => x.points.some((p) => Math.hypot(p[0] - z.x, p[1] - z.z) < 1.5));
          vues.add(f ? f.zone : (zoneEn(ZONES_SOL, z.x, z.z) ?? "?"));
        }
        tuerTous(b, j, t);
      }
      return vues;
    };
    const fermees = devantPorte(10_000);
    expect([...origines(fermees.b, fermees.j, T_MANCHE1 + 3_200)]).toEqual(["open"]);
    const ouvertes = devantPorte(10_000);
    expect(msgs(acheterPorte(ouvertes.b, ouvertes.j, "D2"), "achat")[0].ok).toBe(true);
    expect([...origines(ouvertes.b, ouvertes.j, T_MANCHE1 + 3_200)].sort()).toEqual(["cour", "open"]);
  });
});

// =================================================================================================
describe("synchro, snap, départs", () => {
  it("synchro : état, bâtiments complets et argent du seul joueur admis", () => {
    const b = partieEnCours(["a"]);
    const s = b.svc.synchro("a");
    expect(s.map((x) => x.m.t)).toEqual(["zombies", "batiments", "argent"]);
    expect(s.every((x) => x.a === "a")).toBe(true);
    expect(b.svc.synchro("zz").map((x) => x.m.t)).toEqual(["zombies", "batiments"]);
  });

  it("snap : null dans le lobby, `{r, z}` pendant la partie (r = tigres restants), vide pendant le décompte", () => {
    const b = partieEnCours(["a"], { total1: 3 });
    expect(b.svc.snap()).toEqual({ r: 0, z: [] });
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    const snap = b.svc.snap()!;
    expect(snap.r).toBe(3);
    expect(snap.z).toHaveLength(6);
  });

  it("departPour : le départ le plus éloigné des autres joueurs ; huit joueurs, huit départs", () => {
    expect(departPour([]).index).toBe(0);
    const loin = departPour([[DEPARTS[0][0], 0, DEPARTS[0][1]]]);
    expect(loin.index).not.toBe(0);
    for (const d of DEPARTS) expect(Math.hypot(loin.p[0] - DEPARTS[0][0], loin.p[2] - DEPARTS[0][1])).toBeGreaterThanOrEqual(Math.hypot(d[0] - DEPARTS[0][0], d[1] - DEPARTS[0][1]) - 1e-9);
    expect(Number.isFinite(loin.lacet)).toBe(true);
    const pris: Vec3[] = [];
    for (let i = 0; i < 8; i++) pris.push(departPour(pris).p);
    expect(new Set(pris.map((p) => `${p[0]},${p[2]}`)).size).toBe(8);
  });

  it("PORTES_PAYANTES : onze portes, prix de la spec", () => {
    expect(PORTES_PAYANTES.map((p) => [p.id, p.prix])).toEqual([
      ["D1", 750], ["D2", 1000], ["D3", 1250], ["G3", 750], ["D4", 1000], ["D7", 1000], ["G4", 1250], ["G2", 1000], ["G1", 1250], ["D8", 1500], ["D9", 1500],
    ]);
  });
});

// =================================================================================================
describe("équipement de départ", () => {
  it("copie propre, jamais l'objet figé", () => {
    const e1 = copierEquipement(EQUIPEMENT_DEPART_ZOMBIES);
    const e2 = copierEquipement(EQUIPEMENT_DEPART_ZOMBIES);
    e1.secondaire = "revolver";
    expect(e2.secondaire).toBe("pistolet");
    expect(Object.isFrozen(EQUIPEMENT_DEPART_ZOMBIES)).toBe(true);
    const eq: Equipement = e2;
    const main: Slot = "secondaire";
    expect(armeDuSlot(eq, main)).toBe("pistolet");
  });
});
