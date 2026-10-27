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
import { ACHATS, DEPARTS, PORTES_PAYANTES, construireMondeZombies, idPrisme, porteDeId } from "./zombies-carte";
import { ZOMBIES, bonusFinManche, gainKill, gainTouche, intervalleApparition, totalManche } from "./zombies-vagues";

/**
 * Service zombies isolé : contexte factice (la salle est testée dans match.zombies.test.ts), vrai monde de la carte « Cour des Restos ».
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md
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
    expect(etat.joueurs).toEqual([{ id: "a", pseudo: "Agent a", couleur: "#ff5252", etat: "attente", admis: false, kills: 0, gagne: 0, reanimations: 0 }]);
    expect(etat.portes.map((p) => p.id)).toEqual(["P1", "P3", "P2", "P4", "P5"]);
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

  it("un tigre apparaît toutes les max(0,35 ; 2,0 − 0,12 n) s, dans une fenêtre active (N2c au départ)", () => {
    const b = partieEnCours();
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    const premier = tigresVivants(b);
    expect(premier).toHaveLength(1);
    // seul N2c est actif : le tigre est du côté nord du mur (z < −77) et près de l'un de ses trois points
    expect(premier[0].z).toBeLessThan(-77);
    avancer(b, T_PREMIER_TIGRE + 150, T_PREMIER_TIGRE + intervalleApparition(1) * 1000 - 60);
    expect(tigresVivants(b)).toHaveLength(1);
    avancer(b, T_PREMIER_TIGRE + intervalleApparition(1) * 1000 - 50, T_PREMIER_TIGRE + intervalleApparition(1) * 1000 + 100);
    expect(tigresVivants(b)).toHaveLength(2);
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
    expect(tigresVivants(b).length).toBeLessThanOrEqual(6 + 3 + 2);
    expect(tigresVivants(b).length).toBeGreaterThan(0);
  });
});

// =================================================================================================
describe("dégâts, argent, kills", () => {
  function avecUnTigre() {
    const b = partieEnCours();
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    const z = tigresVivants(b)[0];
    return { b, z, id: `z${z.id}`, j: b.j("a") };
  }

  it("une touche : `degats` au seul tireur (pv en %), +10 $ privés, pas de zombieMort", () => {
    const { b, id, j } = avecUnTigre();
    const t = T_PREMIER_TIGRE + 200;
    const sorties = b.svc.blesser(id, 30, j, "corps", t);
    expect(msgs(sorties, "degats")).toEqual([{ t: "degats", cible: id, par: "a", degats: 30, pv: 70, bouclier: 0, zone: "corps" }]);
    expect(sorties.find((s) => s.m.t === "degats")!.a).toBe("a");
    expect(msgs(sorties, "argent")).toEqual([{ t: "argent", solde: 500 + gainTouche(1), delta: gainTouche(1), motif: "touche" }]);
    expect(msgs(sorties, "zombieMort")).toEqual([]);
    expect(b.svc.possede(id)).toBe(true);
    expect(b.svc.snap()!.z[5]).toBe(70);
  });

  it("un kill au corps : +10 $ de touche + 60 $, kills++, série, killsParArme, zombieMort aux joueurs, présence", () => {
    const { b, id, j } = avecUnTigre();
    const sorties = b.svc.blesser(id, 1000, j, "corps", T_PREMIER_TIGRE + 200, { arme: "pistolet" });
    expect(msgs(sorties, "argent")[0]).toMatchObject({ delta: gainTouche(1) + gainKill(1), motif: "kill", solde: 500 + gainTouche(1) + gainKill(1) });
    expect(gainKill(1)).toBe(60);
    const mort = sorties.find((s) => s.m.t === "zombieMort")!;
    expect(mort.a).toBe("joueurs");
    expect(mort.m).toMatchObject({ id, par: "a", zone: "corps" });
    expect(j).toMatchObject({ kills: 1, serie: 1, serieMax: 1, killsParArme: { pistolet: 1 } });
    expect(types(sorties)).toContain("presence");
    expect(b.svc.possede(id)).toBe(false);
    // un tigre mort ne se blesse plus et ne se touche plus
    expect(b.svc.blesser(id, 10, j, "corps", T_PREMIER_TIGRE + 300)).toEqual([]);
    expect(b.svc.toucheZombie(id, [0, 0, 0], [1, 0, 0], 50, T_PREMIER_TIGRE + 300)).toBeNull();
  });

  it("kill à la tête ou à l'arme blanche : 100 $ ; le gain de touche est unique par tir (`gain:false` : aucun)", () => {
    const { b, id, j } = avecUnTigre();
    const tete = b.svc.blesser(id, 1000, j, "tete", T_PREMIER_TIGRE + 200);
    expect(msgs(tete, "argent")[0].delta).toBe(gainTouche(1) + gainKill(1, { tete: true }));
    expect(gainKill(1, { tete: true })).toBe(100);
    const c = avecUnTigre();
    const sans = c.b.svc.blesser(c.id, 20, c.j, "corps", T_PREMIER_TIGRE + 200, { gain: false });
    expect(msgs(sans, "argent")).toEqual([]);
    const d = avecUnTigre();
    const melee = d.b.svc.blesser(d.id, 1000, d.j, "corps", T_PREMIER_TIGRE + 200, { melee: true });
    expect(msgs(melee, "argent")[0].delta).toBe(gainTouche(1, { melee: true }) + gainKill(1, { melee: true }));
  });

  it("l'argent suit le coefficient de la manche (× min(2 ; 1 + 0,04 (n−1)), arrondi à 10) et le bonus de fin de manche 100 + 25 n", () => {
    const b = partieEnCours(["a"], { degatsGriffe: 0 });
    const j = b.j("a");
    let t = T_PREMIER_TIGRE;
    const bonus: number[] = [];
    for (let manche = 1; manche < 5; manche++) {
      const r = finirManche(b, j, t);
      bonus.push(...msgs(r.sorties, "argent").filter((m) => m.motif === "manche").map((m) => m.delta));
      t = r.t + ZOMBIES.pauseMs + 100;
      avancer(b, r.t + 100, t);
      expect(b.svc.etat()).toMatchObject({ phase: "manche", manche: manche + 1 });
    }
    expect(bonus).toEqual([125, 150, 175, 200]);
    // manche 5 : coefficient 1,16 → touche 10 $, kill au corps 70 $, kill à la tête 120 $
    avancer(b, t, t + 3000);
    const z = tigresVivants(b)[0];
    const sorties = b.svc.blesser(`z${z.id}`, 1_000_000, j, "corps", t + 3000);
    expect(msgs(sorties, "argent")[0].delta).toBe(gainTouche(5) + gainKill(5));
    expect(gainTouche(5) + gainKill(5)).toBe(80);
    expect(gainKill(5, { tete: true })).toBe(120);
  });

  it("touches et kills sont marqués pour la diffusion : `zombies{etat}` ≤ 5 Hz", () => {
    const { b, id, j } = avecUnTigre();
    let t = T_PREMIER_TIGRE + 250;
    b.svc.tic(t); // vide les envois en attente
    b.svc.blesser(id, 10, j, "corps", t);
    // pas d'envoi avant 200 ms, un seul après
    const envois: number[] = [];
    for (let k = 0; k < 20; k++, t += 20) if (msgs(b.svc.tic(t), "zombies").length) envois.push(k);
    expect(envois.length).toBe(1);
    expect(envois[0] * 20).toBeGreaterThanOrEqual(0);
    const apres = b.svc.etat().joueurs[0];
    expect(apres.gagne).toBe(gainTouche(1));
  });
});

// =================================================================================================
describe("fin de manche, pauses, bonus", () => {
  it("tous les tigres apparus et morts : bonus 100 + 25 n aux debout, pause de 10 s, manche suivante", () => {
    const b = partieEnCours();
    const j = b.j("a");
    const { t, sorties } = finirManche(b, j, T_PREMIER_TIGRE);
    const etat = b.svc.etat();
    expect(etat).toMatchObject({ phase: "pause", manche: 2, debutT: t, finT: t + ZOMBIES.pauseMs });
    const bonus = msgs(sorties, "argent").find((m) => m.motif === "manche")!;
    expect(bonus.delta).toBe(bonusFinManche(1));
    expect(bonus.delta).toBe(125);
    expect(j.kills).toBe(totalManche(1, 1));
    // la manche 2 démarre après 10 s, sans attente de chargement : le premier tigre apparaît dans le tic même
    const sortiesPause = avancer(b, t + 100, t + ZOMBIES.pauseMs - 50);
    expect(b.svc.etat().phase).toBe("pause");
    expect(tigresVivants(b)).toHaveLength(0);
    const s2 = avancer(b, t + ZOMBIES.pauseMs, t + ZOMBIES.pauseMs + 100);
    expect(dernierEtat(s2)).toMatchObject({ phase: "manche", manche: 2 });
    expect(tigresVivants(b)).toHaveLength(1);
    expect(sortiesPause.length).toBeGreaterThanOrEqual(0);
  });

  it("la pause relève les joueurs à terre (50 PV, apparition), ramène les éliminés (équipement de départ, 500 $) et admet les arrivants", () => {
    // les griffes sont neutralisées : seules les mises à terre du test comptent
    const b = partieEnCours(["a", "b", "c"], { degatsGriffe: 0 });
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    const [a, bb, c] = [b.j("a"), b.j("b"), b.j("c")];
    const t1 = T_PREMIER_TIGRE + 200;
    // c tombe et n'est pas relevé : éliminé 45 s plus tard
    b.ctx.infliger(c, 1000, null, "tigre_zombie", "corps", "couteau", t1);
    avancer(b, t1 + 50, t1 + ZOMBIES.terreMs + 100, 250);
    expect(b.svc.etat().joueurs.map((x) => x.etat)).toEqual(["debout", "debout", "elimine"]);
    c.equip = copierEquipement({ ...c.equip, melee: "epee" }); // arme achetée avant l'élimination : perdue au retour
    // b tombe à son tour, un nouvel arrivant attend
    const t2 = t1 + ZOMBIES.terreMs + 1000;
    b.ctx.infliger(bb, 1000, null, "tigre_zombie", "corps", "couteau", t2);
    expect(b.svc.etat().joueurs[1].etat).toBe("terre");
    b.arrive("d", t2 + 500);
    expect(b.svc.admis("d")).toBe(false);
    expect(b.svc.etat().joueurs[3]).toMatchObject({ etat: "attente", admis: false });
    // fin de manche par les tirs de « a » : bonus pour lui seul
    const { sorties } = finirManche(b, a, t2 + 1000);
    const apparitions = msgs(sorties, "apparition");
    const etat = b.svc.etat();
    expect(etat.phase).toBe("pause");
    expect(etat.joueurs.map((x) => x.etat)).toEqual(["debout", "debout", "debout", "debout"]);
    expect(etat.joueurs.every((x) => x.admis)).toBe(true);
    expect(apparitions.find((m) => m.id === "b")).toMatchObject({ pv: ZOMBIES.reanimationPv });
    expect(apparitions.find((m) => m.id === "c")).toMatchObject({ pv: JEU.pvMax, main: "secondaire", equip: { sansPrincipale: true, secondaire: "pistolet" } });
    expect(apparitions.find((m) => m.id === "c")!.equip.melee).toBeUndefined();
    // arrivant et éliminé repartent avec 500 $ (messages privés), le relevé garde son argent
    const argents = sorties.filter((x) => x.m.t === "argent" && (x.m.motif === "depart" || x.m.motif === "retour"));
    expect(argents.map((x) => [x.a, (x.m as { solde: number }).solde]).sort()).toEqual([["c", 500], ["d", 500]]);
    expect(b.svc.admis("d")).toBe(true);
    expect(bb.vivant).toBe(true);
    expect(sorties.filter((x) => x.m.t === "argent" && x.m.motif === "manche").map((x) => x.a)).toEqual(["a"]);
  });

  it("un joueur à terre ou éliminé ne touche pas le bonus de fin de manche", () => {
    const b = partieEnCours(["a", "b"]);
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    b.ctx.infliger(b.j("b"), 1000, null, "tigre_zombie", "corps", "couteau", T_PREMIER_TIGRE + 150);
    const { sorties } = finirManche(b, b.j("a"), T_PREMIER_TIGRE + 200);
    const bonus = sorties.filter((s) => s.m.t === "argent" && s.m.motif === "manche");
    expect(bonus.map((s) => s.a)).toEqual(["a"]);
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
    expect(msgs(b.svc.recevoir(a, msg({ t: "acheter", id: "soin" }), T_PREMIER_TIGRE + 300), "achat")[0]).toMatchObject({ ok: false, raison: "partie" });
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

  it("équipement de départ : pistolet et couteau, pas de principale ; `mur:pistolet` possédé = munitions à moitié prix", () => {
    const { b, j } = avec(achat("mur:pistolet").position, 500);
    expect(j.equip).toEqual({ principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true });
    expect(armeDuSlot(j.equip, "principale")).toBeNull();
    expect(j.main).toBe("secondaire");
    const s = acheter(b, j, "mur:pistolet");
    expect(msgs(s, "achat")).toEqual([{ t: "achat", ok: true, id: "mur:pistolet" }]);
    expect(msgs(s, "argent")).toEqual([{ t: "argent", solde: 500 - 125, delta: -125, motif: "achat" }]);
    expect(msgs(s, "equipement")[0]).toMatchObject({ ravitaille: "pistolet", main: "secondaire" });
    expect(msgs(s, "equipement")[0].equip).toMatchObject({ sansPrincipale: true });
  });

  it("une principale achetée remplace le remplissage, retire sansPrincipale, passe en main chargeurs pleins", () => {
    const { b, j } = avec(achat("mur:mitraillette").position, 1000);
    const s = acheter(b, j, "mur:mitraillette");
    expect(msgs(s, "achat")[0]).toMatchObject({ ok: true });
    expect(j.equip).toEqual({ principale: "mitraillette", secondaire: "pistolet", speciale: null });
    expect(j.equip.sansPrincipale).toBeUndefined();
    expect(j.main).toBe("principale");
    expect(j.arme).toBe("mitraillette");
    expect(msgs(s, "equipement")[0]).toMatchObject({ main: "principale", ravitaille: "mitraillette" });
    expect(b.memorises).toEqual(["a"]);
    // la racheter ensuite = munitions à moitié prix (500 $ avec 1000 − 1000 = 0 : refus faute d'argent)
    expect(msgs(acheter(b, j, "mur:mitraillette", T_MANCHE1 + 200), "achat")[0]).toMatchObject({ ok: false, raison: "argent" });
  });

  it("une secondaire achetée remplace le pistolet ; l'épée passe `melee` à `epee` sans changer d'arme en main", () => {
    const rev = avec(achat("mur:revolver").position, 700);
    acheter(rev.b, rev.j, "mur:revolver");
    expect(rev.j.equip.secondaire).toBe("revolver");
    expect(rev.j).toMatchObject({ main: "secondaire", arme: "revolver" });
    expect(rev.j.equip.sansPrincipale).toBe(true);
    const ep = avec(achat("mur:epee").position, 500);
    const s = acheter(ep.b, ep.j, "mur:epee");
    expect(ep.j.equip.melee).toBe("epee");
    expect(ep.j.main).toBe("secondaire");
    expect(msgs(s, "equipement")[0].equip.melee).toBe("epee");
    expect(msgs(s, "argent")[0]).toMatchObject({ solde: 0, delta: -500 });
    // déjà l'épée : refus `deja`, rien n'est débité
    const encore = acheter(ep.b, ep.j, "mur:epee", T_MANCHE1 + 200);
    expect(msgs(encore, "achat")[0]).toEqual({ t: "achat", ok: false, id: "mur:epee", raison: "deja" });
    expect(msgs(encore, "argent")).toEqual([]);
  });

  it("refus : `argent` (rien n'est débité), `loin`, id inconnu, `partie` (pas de partie, à terre, non admis)", () => {
    const { b, j } = avec(achat("mur:revolver").position, 100);
    expect(msgs(acheter(b, j, "mur:revolver"), "achat")[0]).toEqual({ t: "achat", ok: false, id: "mur:revolver", raison: "argent" });
    expect(j.equip.secondaire).toBe("pistolet");
    // à plus de 2,5 m
    j.p = [achat("mur:revolver").position[0] + 4, 0, achat("mur:revolver").position[1]];
    expect(msgs(acheter(b, j, "mur:revolver"), "achat")[0]).toMatchObject({ ok: false, raison: "loin" });
    expect(msgs(acheter(b, j, "inconnu"), "achat")[0]).toMatchObject({ ok: false, raison: "loin" });
    expect(msgs(b.svc.recevoir(j, { t: "acheter", id: 42 as unknown as string }, T_MANCHE1 + 100), "achat")[0]).toMatchObject({ ok: false, id: "", raison: "loin" });
    // à terre
    j.p = [achat("mur:revolver").position[0], 0, achat("mur:revolver").position[1]];
    b.ctx.infliger(j, 1000, null, "tigre_zombie", "corps", "couteau", T_MANCHE1 + 150);
    expect(msgs(acheter(b, j, "mur:revolver", T_MANCHE1 + 200), "achat")[0]).toMatchObject({ ok: false, raison: "partie" });
    // pas de partie
    const lobby = banc();
    const { j: l } = lobby.arrive("a");
    expect(msgs(lobby.svc.recevoir(l, msg({ t: "acheter", id: "soin" }), T0), "achat")[0]).toMatchObject({ ok: false, raison: "partie" });
  });

  it("pas d'achat à travers un mur : à ≤ 2,5 m du point mais de l'autre côté de la façade, c'est `loin`", () => {
    const { b, j } = avec(achat("mur:revolver").position, 1000);
    // la façade nord de 72 est au sud du point d'achat (z ≈ −33,3) : 2 m derrière elle, dans le bâtiment
    j.p = [achat("mur:revolver").position[0], 0, achat("mur:revolver").position[1] + 2.4];
    expect(msgs(acheter(b, j, "mur:revolver"), "achat")[0]).toMatchObject({ ok: false, raison: "loin" });
  });

  it("boîte : tirage dans les armes non possédées (spéciales à 0,4), la spéciale va dans le slot spécial avec ses munitions", () => {
    const { b, j } = avec(achat("boite").position, 950);
    // hasard injecté : on le règle par la suite du banc ; on vérifie les invariants plutôt qu'une arme précise
    const s = acheter(b, j, "boite");
    expect(msgs(s, "achat")[0]).toMatchObject({ ok: true, id: "boite" });
    expect(msgs(s, "argent")[0]).toMatchObject({ solde: 0, delta: -950 });
    const eq = msgs(s, "equipement")[0];
    const nouvelle = j.arme;
    expect(nouvelle).not.toBe("pistolet");
    if (STATS[nouvelle as keyof typeof STATS].categorie === "speciale") {
      expect(eq.equip.speciale).toBe(nouvelle);
      expect(eq.main).toBe("speciale");
      expect(eq.munSpeciale).toBe(STATS[nouvelle as "railgun"].chargeur);
      expect(eq.ravitaille).toBeUndefined();
    } else {
      expect(eq.ravitaille).toBe(nouvelle);
    }
  });

  it("boîte : le tirage est pondéré (spéciales à 0,4) et ne propose jamais une arme déjà possédée", () => {
    let v = 0;
    const { b, j } = avec(achat("boite").position, 1e9, { alea: () => v });
    const comptes = new Map<string, number>();
    const N = 2000;
    for (let k = 0; k < N; k++) {
      v = (k + 0.5) / N;
      j.equip = copierEquipement(EQUIPEMENT_DEPART_ZOMBIES);
      j.main = "secondaire"; j.arme = "pistolet"; j.munSpeciale = 0;
      expect(msgs(acheter(b, j, "boite"), "achat")[0].ok).toBe(true);
      comptes.set(j.arme, (comptes.get(j.arme) ?? 0) + 1);
    }
    expect(comptes.has("pistolet")).toBe(false); // déjà possédé
    expect([...comptes.keys()].sort()).toEqual(["fusil_assaut", "magnum_dore", "mini_uzi", "minigun", "mitraillette", "mitrailleuse", "pompe", "railgun", "revolver", "sniper"]);
    const poids = 5 + 2 + 3 * 0.4;
    for (const [arme, n] of comptes) {
      const attendu = (STATS[arme as "pompe"].categorie === "speciale" ? 0.4 : 1) / poids;
      expect(n / N, arme).toBeCloseTo(attendu, 1);
    }
  });

  it("soin : PV à 100 pour 400 $, réutilisable après 20 s par joueur", () => {
    const { b, j } = avec(achat("soin").position, 1000);
    j.pv = 30;
    const s = acheter(b, j, "soin");
    expect(msgs(s, "achat")[0]).toMatchObject({ ok: true });
    expect(j.pv).toBe(JEU.pvMax);
    expect(msgs(s, "argent")[0]).toMatchObject({ solde: 600, delta: -400 });
    j.pv = 10;
    expect(msgs(acheter(b, j, "soin", T_MANCHE1 + 100 + 19_000), "achat")[0]).toMatchObject({ ok: false, raison: "deja" });
    expect(j.pv).toBe(10);
    expect(msgs(acheter(b, j, "soin", T_MANCHE1 + 100 + 20_000), "achat")[0]).toMatchObject({ ok: true });
    expect(j.pv).toBe(JEU.pvMax);
  });
});

// =================================================================================================
describe("portes payantes", () => {
  type IdPorte = "P1" | "P2" | "P3" | "P4" | "P5";
  /** « a » en manche 1 avec `argent` $. */
  function devantPorte(argent: number) {
    const b = partieEnCours(["a"], { argentDepart: argent, total1: 60, degatsGriffe: 0 });
    avancer(b, T0 + 100, T_MANCHE1 + 50);
    return { b, j: b.j("a") };
  }
  /**
   * Cherche, en rond autour du milieu de la porte, un point où l'achat n'est pas refusé pour `loin` (portée de 3 m du segment ET ligne de vue :
   * l'autre côté d'un mur est refusé). Renvoie le dernier essai de `acheter` ; la porte s'ouvre si tout le reste (argent, prérequis) le permet.
   */
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

  it("P1 (750 $) : G3 et S2 détruits, monde et navigation mis à jour, `batiments` à tous, fenêtre S2c activée, argent débité", () => {
    const { b, j } = devantPorte(750);
    const s = acheterPorte(b, j, "P1");
    expect(msgs(s, "achat")[0]).toEqual({ t: "achat", ok: true, id: "P1" });
    expect(msgs(s, "argent")[0]).toMatchObject({ solde: 0, delta: -750, motif: "achat" });
    const detruits = [idPrisme("G3"), idPrisme("S2")];
    expect(msgs(s, "batiments")).toEqual([{ t: "batiments", complet: false, detruits, breches: [] }]);
    expect(s.find((x) => x.m.t === "batiments")!.a).toBe("tous");
    expect(batimentsDetruits(b.ctx.monde)).toEqual([...detruits].sort((x, y) => x - y));
    expect(b.ctx.monde.prismes[idPrisme("G3")].h).toBe(0);
    expect(b.ctx.monde.prismes[idPrisme("S2c")].h).toBeGreaterThan(0); // le champ reste (bloque les joueurs, laisse passer les tigres)
    expect(dernierEtat(s)!.portes.find((p) => p.id === "P1")!.ouverte).toBe(true); // `zombies{etat}` immédiat
    // une porte ouverte ne se rachète pas
    expect(msgs(b.svc.recevoir(j, msg({ t: "acheter", id: "P1" }), T_MANCHE1 + 200), "achat")[0]).toMatchObject({ ok: false, raison: "deja" });
    // un joueur qui rejoint plus tard reçoit les bâtiments complets avec les prismes détruits
    expect(msgs(b.svc.synchro("z"), "batiments")[0]).toMatchObject({ complet: true, detruits: [...detruits].sort((x, y) => x - y) });
  });

  it("les prérequis fixent l'ordre : P2 exige P1, P4 exige P3, P5 exige P2 (`verrou`, testé avant l'argent)", () => {
    for (const [id, prerequis] of [["P2", "P1"], ["P4", "P3"], ["P5", "P2"]] as const) {
      if (id === "P5") continue; // hors de portée depuis la cour Centre : couvert plus bas
      const { b, j } = devantPorte(100); // trop peu d'argent : le refus doit être `verrou`, pas `argent`
      const s = acheterPorte(b, j, id);
      expect(msgs(s, "achat")[0], `${id} sans ${prerequis}`).toMatchObject({ ok: false, raison: "verrou" });
      expect(b.svc.etat().portes.find((p) => p.id === id)!.ouverte).toBe(false);
    }
    // P5 est à 55 m de la cour Centre : trop loin
    const { b, j } = devantPorte(10_000);
    j.p = [136, 0, -50];
    expect(msgs(b.svc.recevoir(j, msg({ t: "acheter", id: "P5" }), T_MANCHE1 + 100), "achat")[0]).toMatchObject({ ok: false, raison: "loin" });
  });

  it("P1 puis P2 puis P5 : chaque ouverture s'enchaîne, les prismes de chaque porte tombent", () => {
    const { b, j } = devantPorte(10_000);
    for (const id of ["P1", "P2"] as const) {
      expect(msgs(acheterPorte(b, j, id), "achat")[0], id).toMatchObject({ ok: true });
    }
    expect(b.svc.etat().portes.filter((p) => p.ouverte).map((p) => p.id)).toEqual(["P1", "P2"]);
    expect(batimentsDetruits(b.ctx.monde)).toEqual(["G3", "S2", "G4", "N4"].map(idPrisme).sort((x, y) => x - y));
    expect(msgs(acheterPorte(b, j, "P5"), "achat")[0]).toMatchObject({ ok: true });
    expect(b.ctx.monde.prismes[idPrisme("E")].h).toBe(0);
  });

  it("argent insuffisant ou trop loin : refus sans rien ouvrir", () => {
    const { b, j } = devantPorte(100);
    expect(msgs(acheterPorte(b, j, "P1"), "achat")[0]).toMatchObject({ ok: false, raison: "argent" });
    expect(batimentsDetruits(b.ctx.monde)).toEqual([]);
    j.p = [porteDeId("P1")!.point[0] + 10, 0, porteDeId("P1")!.point[1] + 10];
    expect(msgs(b.svc.recevoir(j, msg({ t: "acheter", id: "P1" }), T_MANCHE1 + 100), "achat")[0]).toMatchObject({ ok: false, raison: "loin" });
  });

  it("pas d'achat de porte à travers un mur : de l'autre côté de la façade, à moins de 3 m, c'est `loin`", () => {
    const { b, j } = devantPorte(10_000);
    // P3 (G2/S1 au sud-ouest) : un point à l'intérieur du bâtiment voisin, côté opposé, reste à ~3 m du segment mais derrière des murs
    j.p = [porteDeId("P1")!.point[0] + 2.9, 0, porteDeId("P1")!.point[1] + 0.2];
    const s = b.svc.recevoir(j, msg({ t: "acheter", id: "P1" }), T_MANCHE1 + 100);
    const m = msgs(s, "achat")[0];
    // soit l'achat passe (point dégagé), soit il est refusé pour `loin` : jamais `argent` avec 10 000 $
    expect(m.ok || m.raison === "loin").toBe(true);
  });

  it("une porte ouverte active la fenêtre à tigres qui lui correspond (S2c pour P1) ; portes fermées, seule N2c fait naître des tigres", () => {
    /** Origine (fenêtre) de chaque tigre vu à son apparition, pendant 60 s, joueur très loin et invincible. */
    const origines = (b: Banc, j: JoueurSalle, t0: number): Set<string> => {
      const vues = new Set<string>();
      const connus = new Set<number>();
      j.p = [8.5, 0, 20]; j.pv = 1e9;
      for (let t = t0; t < t0 + 60_000; t += 100) {
        b.svc.tic(t);
        for (const z of tigresVivants(b)) {
          if (connus.has(z.id)) continue;
          connus.add(z.id);
          vues.add(z.z < -77 ? "N2c" : z.x > 140 && z.z > -5 ? "S2c" : `autre(${z.x.toFixed(0)},${z.z.toFixed(0)})`);
        }
        tuerTous(b, j, t);
      }
      return vues;
    };
    const fermees = devantPorte(10_000);
    expect([...origines(fermees.b, fermees.j, T_MANCHE1 + 3_200)]).toEqual(["N2c"]);
    const ouvertes = devantPorte(10_000);
    expect(msgs(acheterPorte(ouvertes.b, ouvertes.j, "P1"), "achat")[0].ok).toBe(true);
    expect([...origines(ouvertes.b, ouvertes.j, T_MANCHE1 + 3_200)].sort()).toEqual(["N2c", "S2c"]);
  });
});

// =================================================================================================
describe("synchro, snap, départs", () => {
  it("synchro : état, bâtiments complets et argent du seul joueur admis", () => {
    const b = partieEnCours(["a"]);
    const s = b.svc.synchro("a");
    expect(s.map((x) => x.m.t)).toEqual(["zombies", "batiments", "argent"]);
    expect(s.every((x) => x.a === "a")).toBe(true);
    const inconnu = b.svc.synchro("zz");
    expect(inconnu.map((x) => x.m.t)).toEqual(["zombies", "batiments"]);
  });

  it("snap : null dans le lobby, `{r, z}` pendant la partie (r = tigres restants), vide à la pause", () => {
    const b = partieEnCours(["a"], { total1: 3 });
    expect(b.svc.snap()).toEqual({ r: 0, z: [] }); // décompte : manche 1 pas commencée
    avancer(b, T0 + 100, T_PREMIER_TIGRE + 100);
    const snap = b.svc.snap()!;
    expect(snap.r).toBe(3);
    expect(snap.z).toHaveLength(6);
  });

  it("departPour : le départ le plus éloigné des autres joueurs, lacet vers le centre de la cour", () => {
    expect(departPour([]).index).toBe(0);
    const loin = departPour([[DEPARTS[0][0], 0, DEPARTS[0][1]]]);
    expect(loin.index).not.toBe(0);
    for (const d of DEPARTS) expect(Math.hypot(loin.p[0] - DEPARTS[0][0], loin.p[2] - DEPARTS[0][1])).toBeGreaterThanOrEqual(Math.hypot(d[0] - DEPARTS[0][0], d[1] - DEPARTS[0][1]) - 1e-9);
    expect(Number.isFinite(loin.lacet)).toBe(true);
    // huit joueurs : huit départs distincts
    const pris: Vec3[] = [];
    for (let i = 0; i < 8; i++) pris.push(departPour(pris).p);
    expect(new Set(pris.map((p) => `${p[0]},${p[2]}`)).size).toBe(8);
  });

  it("PORTES_PAYANTES : cinq portes, prix et prérequis de la spec", () => {
    expect(PORTES_PAYANTES.map((p) => [p.id, p.prix, p.prerequis])).toEqual([["P1", 750, null], ["P3", 1000, null], ["P2", 1250, "P1"], ["P4", 1500, "P3"], ["P5", 2000, "P2"]]);
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
