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
  ACHATS, ATOUTS, DEPARTS, FENETRES, INTERACTIONS_SECRET, PORTES_PAYANTES, SECRET_CARTE, achatBoite, construireMondeZombies, etiqueterZones, fenetreDeId,
  idPrisme, local, porteDeId, zoneEn, type ZoneId,
} from "./zombies-carte";
import { dansMidi } from "./zombies-secret";
import { ZOMBIES, delaiApparition, gainKill, gainTouche, pvZombie, totalManche, type GenreBonus } from "./zombies-vagues";
import { CUISSON_PAP_MS, OFFRE_BOITE_MS, REPRISE_PAP_MS, TIRAGE_BOITE_MS, AUTO_RELEVE_MS, ENVOL_BOITE_MS } from "./match-zombies";

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
    for (let graine = 1; graine <= 12 && genres.size < 5; graine++) {
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
    // (v8) le Happy hour n'est offert qu'après un déménagement de la boîte (BO1) : jamais ici, la boîte ne sert pas (cf. « Happy hour »)
    expect([...genres].sort()).toEqual(["double", "instakill", "menuisier", "munitions", "nuke"]);
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

  it("courant (local technique) : rétabli une fois, `zevt courant` ; Pack-a-Punch (5 000 $) : dépôt, cuisson 4 s, reprise de l'arme améliorée", () => {
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
    expect(b.svc.etat().pap).toMatchObject({ etat: "cuisson", joueur: "a", arme: "pistolet", debutT: t, finT: t + CUISSON_PAP_MS });
    // (v8, BO1) l'arme est retirée de l'inventaire : son slot est vide, le joueur passe au couteau
    expect(msgs(p, "equipement")[0]).toMatchObject({ main: "couteau", equip: { enCuisson: "pistolet" } });
    expect(armeDuSlot(j.equip, "secondaire")).toBeNull();
    expect(j.arme).toBe("couteau");
    expect(msgs(p, "zevt")[0].e).toEqual({ e: "pap", joueur: "a", arme: "pistolet", pret: false });
    expect(msgs(acheter(b, j, "pap", t + 100), "achat")[0]).toMatchObject({ ok: false, raison: "occupe" });
    const fin = avancer(b, t + 50, t + CUISSON_PAP_MS + 100);
    // cuite : elle attend dans la machine, rien n'est rendu tant que le joueur ne vient pas la reprendre
    expect(msgs(fin, "equipement")).toEqual([]);
    expect(msgs(fin, "zevt").map((m) => m.e)).toContainEqual({ e: "pap", joueur: "a", arme: "pistolet", pret: true });
    expect(b.svc.etat().pap).toMatchObject({ etat: "pret", joueur: "a", arme: "pistolet" });
    expect(b.svc.etat().pap.finT).toBeGreaterThanOrEqual(t + CUISSON_PAP_MS + REPRISE_PAP_MS);
    const r = acheter(b, j, "pap", t + 5000);
    expect(msgs(r, "achat")[0]).toMatchObject({ ok: true });
    expect(msgs(r, "argent")).toEqual([]);
    expect(msgs(r, "equipement")[0]).toMatchObject({ main: "secondaire", ravitaille: "pistolet" });
    expect(msgs(r, "equipement")[0].equip.ameliorees).toEqual(["pistolet"]);
    expect(msgs(r, "equipement")[0].equip.enCuisson).toBeUndefined();
    expect(msgs(r, "zevt")[0].e).toMatchObject({ e: "pap", fin: "reprise" });
    expect(j.arme).toBe("pistolet");
    expect(b.svc.etat().pap.etat).toBe("libre");
    expect(b.svc.degatsTir(j, "pistolet", "corps", 5, t + 5000)).toBe(1000); // (v8) Moutarde & Sally : impact de 1 000 (BO1)
    expect(msgs(acheter(b, j, "pap", t + 5100), "achat")[0]).toMatchObject({ ok: false, raison: "deja" });
  });

  it("(v8) Micro-ondes : seul celui qui a déposé l'arme la reprend ; passé 15 s elle est perdue, sans remboursement, son slot reste vide", () => {
    const pa = achat("pap");
    const b = partieEnCours(["a", "c"], { argentDepart: 20_000, courant: true });
    avancer(b, T0 + 100, T_MANCHE1 + 50);
    const j = b.j("a"), autre = b.j("c");
    j.p = [pa.position[0], 0, pa.position[1]];
    autre.p = [pa.position[0] + 0.5, 0, pa.position[1]];
    const t = T_MANCHE1 + 100;
    expect(msgs(acheter(b, j, "pap", t), "achat")[0]).toMatchObject({ ok: true });
    avancer(b, t + 50, t + CUISSON_PAP_MS + 100);
    expect(b.svc.etat().pap.etat).toBe("pret");
    expect(msgs(acheter(b, autre, "pap", t + CUISSON_PAP_MS + 200), "achat")[0]).toMatchObject({ ok: false, raison: "occupe" });
    // le slot attend la reprise : pas de mini Uzi (secondaire) au mur entre-temps
    const uzi = achat("mur:mini_uzi");
    j.p = [uzi.position[0], 0, uzi.position[1]];
    expect(msgs(acheter(b, j, uzi.id, t + CUISSON_PAP_MS + 300), "achat")[0]).toMatchObject({ ok: false, raison: "occupe" });
    const perte = avancer(b, t + CUISSON_PAP_MS + 400, t + CUISSON_PAP_MS + REPRISE_PAP_MS + 200);
    expect(msgs(perte, "zevt").map((m) => m.e)).toContainEqual({ e: "pap", joueur: "a", arme: "pistolet", pret: false, fin: "perdue" });
    expect(msgs(perte, "argent").filter((m) => m.delta > 0 && m.motif !== "touche" && m.motif !== "kill")).toEqual([]);
    expect(b.svc.etat().pap.etat).toBe("libre");
    expect(armeDuSlot(j.equip, "secondaire")).toBeNull();
    // une arme de la même catégorie remplit le slot vide
    const s = acheter(b, j, uzi.id, t + CUISSON_PAP_MS + REPRISE_PAP_MS + 300);
    expect(msgs(s, "achat")[0]).toMatchObject({ ok: true });
    expect(j.equip.enCuisson).toBeUndefined();
    expect(j).toMatchObject({ main: "secondaire", arme: "mini_uzi" });
  });

  it("(v8) Micro-ondes : un joueur qui part libère la machine", () => {
    const pa = achat("pap");
    const b = partieEnCours(["a", "c"], { argentDepart: 20_000, courant: true });
    avancer(b, T0 + 100, T_MANCHE1 + 50);
    const j = b.j("a");
    j.p = [pa.position[0], 0, pa.position[1]];
    acheter(b, j, "pap", T_MANCHE1 + 100);
    expect(b.svc.etat().pap.etat).toBe("cuisson");
    b.part("a", T_MANCHE1 + 200);
    expect(b.svc.etat().pap.etat).toBe("libre");
  });

  it("munitions d'une arme améliorée au mur : 2 500 $", () => {
    const { b, j } = avec(achat("mur:revolver").position, 10_000);
    acheter(b, j, "mur:revolver");
    j.equip = copierEquipement({ ...j.equip, ameliorees: ["revolver"] });
    expect(msgs(acheter(b, j, "mur:revolver", T_MANCHE1 + 200), "argent")[0]).toMatchObject({ delta: -2500 });
  });
});

// =================================================================================================
describe("(v8) Happy hour (le Fire Sale de BO1)", () => {
  const acheter = (b: Banc, j: JoueurSalle, id: string, t: number) => b.svc.recevoir(j, msg({ t: "acheter", id }), t);
  const devant = (j: JoueurSalle, em: number) => { const a = achatBoite(em); j.p = [a.position[0], 0, a.position[1]]; };

  /** Tire à la boîte principale jusqu'à la peluche (8 tirages au plus), puis attend la fin de l'envol : la boîte a déménagé une fois. */
  function deplacerBoite(b: Banc, j: JoueurSalle, t: number): number {
    for (let k = 0; k < 8; k++) {
      devant(j, b.svc.etat().boite.emplacement);
      expect(msgs(acheter(b, j, achatBoite(b.svc.etat().boite.emplacement).id, t), "achat")[0].ok).toBe(true);
      const peluche = b.svc.etat().boite.arme === "peluche";
      t += TIRAGE_BOITE_MS + 50; b.svc.tic(t);
      if (peluche) { t += ENVOL_BOITE_MS + 50; b.svc.tic(t); return t + 50; }
      t += OFFRE_BOITE_MS + 50; b.svc.tic(t); t += 50;
    }
    throw new Error("pas de peluche en 8 tirages");
  }
  /** Tue les tigres entrés jusqu'au premier bonus lâché, va le ramasser ; renvoie le genre et l'instant. */
  function ramasserBonus(b: Banc, j: JoueurSalle, t0: number): { genre: GenreBonus; t: number; sorties: Sortie[] } {
    for (let t = t0; t < t0 + 240_000; t += 100) {
      b.svc.tic(t);
      for (const z of tigresVivants(b)) if (zoneEn(ZONES_SOL, z.x, z.z)) b.svc.blesser(`z${z.id}`, 100_000, j, "tete", t);
      const sol = b.svc.etat().bonus[0];
      if (sol) { j.p = [sol.p[0], 0, sol.p[2]]; return { genre: sol.genre, t: t + 50, sorties: b.svc.tic(t + 50) }; }
    }
    throw new Error("aucun bonus");
  }

  it("jamais offert tant que la boîte n'a pas déménagé (un autre bonus le remplace)", () => {
    const b = partieEnCours(["a"], { total1: 200, degatsGriffe: 0, bonus: ["soldes"] });
    const j = b.j("a");
    j.pv = 1e9;
    const r = ramasserBonus(b, j, T_PREMIER_TIGRE);
    expect(r.genre).not.toBe("soldes");
    expect(b.svc.etat().boitesSoldes).toBeUndefined();
  });

  it("30 s : une boîte à chaque emplacement, toutes à 10 $, aucune peluche ni déménagement ; à la fin les temporaires disparaissent, sauf celle en cours", () => {
    const b = partieEnCours(["a"], { total1: 200, degatsGriffe: 0, bonus: ["soldes"], argentDepart: 1e7 });
    const j = b.j("a");
    j.pv = 1e9;
    let t = deplacerBoite(b, j, T_PREMIER_TIGRE);
    const r = ramasserBonus(b, j, t);
    expect(r.genre).toBe("soldes");
    t = r.t;
    const etat = dernierEtat(r.sorties)!;
    expect(etat.effets.soldesFinT).toBe(t + ZOMBIES.bonusDureeMs);
    const principale = etat.boite;
    expect(etat.boitesSoldes!.map((x) => x.emplacement).sort()).toEqual([0, 1, 2, 3, 4].filter((i) => i !== principale.emplacement));
    // chaque boîte (la principale comprise) tire à 10 $, jamais la peluche ; les tirages ne comptent pas pour la peluche
    const finSoldes = etat.effets.soldesFinT;
    for (let em = 0; em < 5; em++) {
      devant(j, em);
      const s = acheter(b, j, achatBoite(em).id, t);
      expect(msgs(s, "argent")[0], `emplacement ${em}`).toMatchObject({ delta: -10 });
      const bx = [b.svc.etat().boite, ...(b.svc.etat().boitesSoldes ?? [])].find((x) => x.emplacement === em)!;
      expect(bx.etat).toBe("tirage");
      expect(bx.arme).not.toBe("peluche");
    }
    // les offres se referment sans être prises
    t += TIRAGE_BOITE_MS + 50; b.svc.tic(t);
    t += OFFRE_BOITE_MS + 50; b.svc.tic(t);
    expect(t).toBeLessThan(finSoldes);
    expect(b.svc.etat().boite).toMatchObject({ emplacement: principale.emplacement, utilisations: principale.utilisations });
    // un tirage lancé juste avant la fin : sa boîte temporaire reste jusqu'à ce qu'elle se referme
    const derniere = b.svc.etat().boitesSoldes![0].emplacement;
    devant(j, derniere);
    t = finSoldes - 500;
    b.svc.tic(t);
    expect(msgs(acheter(b, j, achatBoite(derniere).id, t), "argent")[0]).toMatchObject({ delta: -10 });
    t = finSoldes + 100;
    b.svc.tic(t);
    expect(b.svc.etat().boitesSoldes!.map((x) => x.emplacement)).toEqual([derniere]);
    // après le Happy hour, 950 $ à la principale ; la temporaire disparaît une fois l'offre refermée
    devant(j, principale.emplacement);
    expect(msgs(acheter(b, j, achatBoite(principale.emplacement).id, t), "argent")[0]).toMatchObject({ delta: -950 });
    avancer(b, t + 50, t + TIRAGE_BOITE_MS + OFFRE_BOITE_MS + 200, 100);
    expect(b.svc.etat().boitesSoldes).toBeUndefined();
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

  /** Partie où les tigres arrachent au moins `n` planches de F1 ; le joueur est devant, les tigres sont tués ; renvoie l'instant. */
  function fenetreAbimee(n: number) {
    const b = partieEnCours(["a"], { total1: 60, degatsGriffe: 0 });
    const j = b.j("a");
    const f = fenetreDeId("F1")!;
    j.p = [f.dedans[0], 0, f.dedans[1]];
    j.pv = 1e9;
    let t = T0 + 100;
    for (; t < T_PREMIER_TIGRE + 120_000 && b.svc.etat().fenetres[FENETRES.indexOf(f)] > ZOMBIES.planches - n; t += 100) b.svc.tic(t);
    expect(b.svc.etat().fenetres[FENETRES.indexOf(f)]).toBeLessThanOrEqual(ZOMBIES.planches - n);
    tuerTous(b, j, t);
    return { b, j, f, t };
  }
  /** Avance de `t0` à `t1` en tuant les tigres à chaque pas (aucune planche arrachée pendant la repose) ; instants des planches reposées. */
  function reposer(b: Banc, j: JoueurSalle, t0: number, t1: number): { t: number[]; argent: number[] } {
    const res = { t: [] as number[], argent: [] as number[] };
    for (let t = t0; t <= t1; t += 50) {
      const s = b.svc.tic(t);
      tuerTous(b, j, t);
      if (msgs(s, "zevt").some((m) => m.e.e === "planche" && !m.e.arrachee)) res.t.push(t);
      for (const m of msgs(s, "argent")) if (m.motif === "planche") res.argent.push(m.delta);
    }
    return res;
  }

  it("(v8) cadence de BO1 : la première planche 0,2 s après l'appui, puis une toutes les 0,9 s ; relâcher et réappuyer n'accélère rien", () => {
    const { b, j, t } = fenetreAbimee(4);
    b.svc.recevoir(j, msg({ t: "reparer", fenetre: "F1" }), t);
    const r = reposer(b, j, t + 50, t + 2_100);
    expect(r.t[0] - t).toBeGreaterThanOrEqual(ZOMBIES.reposePremiereS * 1000);
    expect(r.t[0] - t).toBeLessThanOrEqual(ZOMBIES.reposePremiereS * 1000 + 50);
    expect(r.t[1] - r.t[0]).toBeGreaterThanOrEqual(ZOMBIES.reposeS * 1000);
    expect(r.t[1] - r.t[0]).toBeLessThanOrEqual(ZOMBIES.reposeS * 1000 + 50);
    expect(r.argent.every((d) => d === 10)).toBe(true);
    // E lâchée puis réappuyée aussitôt : la planche suivante attend toujours 0,9 s après la précédente
    const derniere = r.t.at(-1)!;
    b.svc.recevoir(j, msg({ t: "reparer", fenetre: null }), t + 2_150);
    b.svc.recevoir(j, msg({ t: "reparer", fenetre: "F1" }), t + 2_160);
    const r2 = reposer(b, j, t + 2_200, t + 4_000);
    expect(r2.t[0] - derniere).toBeGreaterThanOrEqual(ZOMBIES.reposeS * 1000);
  });

  it("(v8) le gain des planches est plafonné par manche (BO1 : min(50 × manche, 500)) : au-delà, la planche est reposée sans rien rapporter", () => {
    const { b, j, t } = fenetreAbimee(6);
    b.svc.recevoir(j, msg({ t: "reparer", fenetre: "F1" }), t);
    // manche 1 : plafond 50 $, soit 5 planches payées sur 6
    const r = reposer(b, j, t + 50, t + 6_500);
    expect(r.t).toHaveLength(6);
    expect(r.argent.reduce((x, y) => x + y, 0)).toBe(50);
  });

  it("(v8) Menuisier : toutes les fenêtres retrouvent leurs 6 planches, +200 $ à chacun, l'état part tout de suite", () => {
    const b = partieEnCours(["a"], { total1: 200, degatsGriffe: 0, bonus: ["menuisier"] });
    const j = b.j("a");
    j.pv = 1e9;
    let t = T_PREMIER_TIGRE;
    let ramasse: Sortie[] | null = null;
    for (; t < T_PREMIER_TIGRE + 240_000 && !ramasse; t += 100) {
      b.svc.tic(t);
      // seuls les tigres entrés sont tués : les autres arrachent les planches de leur fenêtre
      for (const z of tigresVivants(b)) if (zoneEn(ZONES_SOL, z.x, z.z)) b.svc.blesser(`z${z.id}`, 100_000, j, "tete", t);
      const sol = b.svc.etat().bonus[0];
      if (sol && b.svc.etat().fenetres.some((n) => n < ZOMBIES.planches)) {
        j.p = [sol.p[0], 0, sol.p[2]];
        ramasse = b.svc.tic(t + 50);
      }
    }
    expect(ramasse).not.toBeNull();
    expect(msgs(ramasse!, "zevt").some((m) => m.e.e === "bonus" && m.e.genre === "menuisier")).toBe(true);
    expect(msgs(ramasse!, "argent").find((m) => m.motif === "menuisier")!.delta).toBe(200);
    expect(dernierEtat(ramasse!)!.fenetres).toEqual(FENETRES.map(() => ZOMBIES.planches));
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
    const { j, nes } = derouler({}, 30_000, (_b, _t, s) => {
      if (!saut && msgs(s, "zevt").some((m) => m.e.e === "miniTruck")) saut = s;
    });
    expect(saut).not.toBeNull();
    const morts = msgs(saut!, "zombieMort").filter((m) => m.par === "");
    expect(morts.length).toBeGreaterThanOrEqual(1);
    expect(morts[0].cause).toBe("explosion");
    // il épargne les siens : seul le mini Truck meurt
    expect(morts.every((m) => nes.get(Number(m.id.slice(1)))?.type === 4)).toBe(true);
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

// =================================================================================================
describe("(v8) armes : effets appliqués par le serveur (brûlure, arc, projectile, souffle, gel)", () => {
  /** Partie avancée jusqu'à `n` tigres en chasse (sortis du sol ou entrés), griffes neutralisées ; `proches` : à moins de 7 m l'un de l'autre. */
  function avecTigres(n: number, proches = false) {
    const b = partieEnCours(["a"], { degatsGriffe: 0, total1: Math.max(3, n + 2) });
    let t = T_PREMIER_TIGRE;
    const chasse = () => tigresVivants(b).filter((z) => z.mode === "chasse");
    const ok = () => {
      const c = chasse();
      if (c.length < n) return false;
      return !proches || c.some((x) => c.filter((y) => Math.hypot(x.x - y.x, x.z - y.z) < 6).length >= n);
    };
    for (; t < T_PREMIER_TIGRE + 120_000 && !ok(); t += 100) b.svc.tic(t);
    expect(ok()).toBe(true);
    return { b, j: b.j("a"), t, tigres: chasse() };
  }
  const avec = (j: JoueurSalle, slot: "principale" | "secondaire", arme: string, ameliore: boolean) => {
    const e = copierEquipement(j.equip);
    if (slot === "principale") { e.principale = arme as Equipement["principale"]; delete e.sansPrincipale; } else e.secondaire = arme as Equipement["secondaire"];
    if (ameliore) e.ameliorees = [arme as Equipement["secondaire"]]; else delete e.ameliorees;
    j.equip = e; j.main = slot; j.arme = arme as JoueurSalle["arme"];
  };
  /** Le joueur est posé à `d` m du tigre (du côté où il se trouvait) et vise son dos. */
  function viser(j: JoueurSalle, z: { x: number; z: number }, d: number): { o: Vec3; dir: Vec3 } {
    let dx = j.p[0] - z.x, dz = j.p[2] - z.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    j.p = [z.x + dx * d, 0, z.z + dz * d];
    const o: Vec3 = [j.p[0], 1.6, j.p[2]];
    const v: Vec3 = [z.x - o[0], 0.8 - o[1], z.z - o[2]];
    const n = Math.hypot(v[0], v[1], v[2]);
    return { o, dir: [v[0] / n, v[1] / n, v[2] / n] };
  }

  it("statsTir du joueur : amélioration comprise ; une arme à balles n'est pas un tir spécial", () => {
    const { b, j, t, tigres } = avecTigres(1);
    avec(j, "secondaire", "perforeuse", true);
    expect(b.svc.statsTir(j, "perforeuse")).toMatchObject({ akimbo: true, auto: true });
    avec(j, "secondaire", "perforeuse", false);
    expect(b.svc.statsTir(j, "perforeuse")).toMatchObject({ akimbo: false, auto: false });
    const { o, dir } = viser(j, tigres[0], 4);
    expect(b.svc.tirSpecial(j, "perforeuse", o, dir, t)).toBeNull();
    expect(b.svc.positionZombie(`z${tigres[0].id}`)).not.toBeNull();
    expect(b.svc.positionZombie("z9999")).toBeNull();
  });

  it("munitions incendiaires (Cobra flambé) : le tigre prend feu (drapeau du snap), perd des PV toutes les 0,5 s et meurt brûlé", () => {
    const { b, j, t, tigres } = avecTigres(1);
    avec(j, "secondaire", "revolver", true);
    const z = tigres[0], id = `z${z.id}`;
    b.svc.blesser(id, 10, j, "corps", t);
    const avant = tigresVivants(b).find((x) => x.id === z.id)!.pvPct;
    b.svc.effetsTir(j, "revolver", [{ cible: id, p: [z.x, 0, z.z] }], t);
    expect(tigresVivants(b).find((x) => x.id === z.id)!.brule).toBe(true);
    // une arme sans effet ne fait rien
    expect(b.svc.effetsTir(j, "mitraillette", [{ cible: id, p: [z.x, 0, z.z] }], t)).toEqual([]);
    const sorties = avancer(b, t + 50, t + 3000);
    const mort = msgs(sorties, "zombieMort").find((m) => m.id === id);
    const encore = tigresVivants(b).find((x) => x.id === z.id);
    // 150 PV à la manche 1, 200 PV/s : il brûle jusqu'à la mort (ou au moins perd des PV s'il est plus robuste)
    if (mort) expect(mort.cause).toBe("feu");
    else expect(encore!.pvPct).toBeLessThan(avant);
    expect(msgs(sorties, "degats").some((m) => m.cible === id)).toBe(true);
  });

  it("arc électrique (Grille-pain) : saute du premier tigre sur ses voisins, `zevt{arc}`, morts « electrique »", () => {
    const { b, j, t, tigres } = avecTigres(2, true);
    avec(j, "principale", "grille_pain", false);
    const depart = tigres.find((x) => tigres.some((y) => y !== x && Math.hypot(x.x - y.x, x.z - y.z) < 6))!;
    const sorties = b.svc.effetsTir(j, "grille_pain", [{ cible: `z${depart.id}`, p: [depart.x, 0, depart.z] }], t);
    const arc = msgs(sorties, "zevt").find((m) => m.e.e === "arc");
    expect(arc).toBeDefined();
    expect((arc!.e as { p: Vec3[] }).p.length).toBeGreaterThanOrEqual(2);
    const morts = msgs(sorties, "zombieMort");
    expect(morts.length).toBeGreaterThanOrEqual(2);
    expect(morts.every((m) => m.cause === "electrique" && m.arme === "grille_pain")).toBe(true);
  });

  it("projectile (Moutarde & Sally) : `projectile` à tous, planté dans le tigre, impact de 1 000 puis souffle `zevt{projectile}`", () => {
    const { b, j, t, tigres } = avecTigres(1);
    avec(j, "secondaire", "pistolet", true);
    const z = tigres[0];
    const { o, dir } = viser(j, z, 4);
    const sorties = b.svc.tirSpecial(j, "pistolet", o, dir, t)!;
    const p = msgs(sorties, "projectile")[0];
    expect(p).toMatchObject({ par: "a", arme: "pistolet", ameliore: true, cible: `z${z.id}` });
    expect(sorties.find((s) => s.m.t === "projectile")!.a).toBe("joueurs");
    expect(p.impactT).toBeGreaterThan(t);
    expect(p.explosionT).toBe(p.impactT);
    const suite = avancer(b, t + 50, p.explosionT + 100);
    expect(msgs(suite, "zevt").some((m) => m.e.e === "projectile" && m.e.id === p.id)).toBe(true);
    expect(msgs(suite, "zombieMort").some((m) => m.id === `z${z.id}`)).toBe(true);
  });

  it("carreau de Brochette : planté, il saute 1,5 s plus tard (pas avant)", () => {
    const { b, j, t, tigres } = avecTigres(1);
    avec(j, "principale", "brochette", false);
    const { o, dir } = viser(j, tigres[0], 5);
    const p = msgs(b.svc.tirSpecial(j, "brochette", o, dir, t)!, "projectile")[0];
    expect(p.explosionT - p.impactT).toBe(STATS.brochette.zombie.projectile!.delaiMs);
    const avant = avancer(b, t + 50, p.explosionT - 100);
    expect(msgs(avant, "zevt").some((m) => m.e.e === "projectile")).toBe(false);
    const apres = avancer(b, p.explosionT - 50, p.explosionT + 100);
    expect(msgs(apres, "zevt").some((m) => m.e.e === "projectile" && m.e.id === p.id)).toBe(true);
  });

  it("Soufflerie : un tigre proche dans le cône est projeté (tué, cause « souffle », origine = l'œil) ; derrière, rien", () => {
    const { b, j, t, tigres } = avecTigres(1);
    avec(j, "principale", "soufflerie", false);
    const z = tigres[0];
    const { o, dir } = viser(j, z, 3);
    const dos: Vec3 = [-dir[0], -dir[1], -dir[2]];
    expect(msgs(b.svc.tirSpecial(j, "soufflerie", o, dos, t)!, "zombieMort")).toEqual([]);
    const sorties = b.svc.tirSpecial(j, "soufflerie", o, dir, t + 1100)!;
    const mort = msgs(sorties, "zombieMort").find((m) => m.id === `z${z.id}`)!;
    expect(mort).toMatchObject({ cause: "souffle", arme: "soufflerie" });
    expect(mort.src![0]).toBeCloseTo(o[0], 1);
  });

  it("gel (Soufflerie XXL) : le tigre touché qui survit est marqué gelé, puis dégelé au bout de 4 s", () => {
    const { b, j, t, tigres } = avecTigres(1);
    avec(j, "principale", "soufflerie", true);
    const z = tigres[0];
    b.svc.effetsTir(j, "soufflerie", [{ cible: `z${z.id}`, p: [z.x, 0, z.z] }], t);
    expect(tigresVivants(b).find((x) => x.id === z.id)?.gele).toBe(true);
    avancer(b, t + 50, t + 4200, 100);
    const apres = tigresVivants(b).find((x) => x.id === z.id);
    if (apres) expect(apres.gele).toBeUndefined();
  });
});

// =================================================================================================
describe("grand secret « Le Menu fantôme » (v8)", () => {
  const C = SECRET_CARTE;
  const norme = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  /** Le joueur se poste en (x, z) : œil à 1,62 m, direction vers le centre de l'objet. */
  const poster = (j: JoueurSalle, pos: Vec2, cible: readonly number[]): { o: Vec3; d: Vec3 } => {
    j.p = [pos[0], 0, pos[1]];
    const o: Vec3 = [pos[0], 1.62, pos[1]];
    return { o, d: norme([cible[0] - o[0], cible[1] - o[1], cible[2] - o[2]]) };
  };
  const secrets = (s: Sortie[]) => msgs(s, "zevt").map((m) => m.e).filter((e) => e.e === "secret").map((e) => (e as { quoi: string }).quoi);
  const interagir = (b: Banc, j: JoueurSalle, objet: string, t: number) => {
    const it = INTERACTIONS_SECRET.find((x) => x.id === objet)!;
    j.p = [it.position[0], 0, it.position[1]];
    return b.svc.recevoir(j, msg({ t: "acheter", id: `secret:${objet}` }), t);
  };
  function porte(b: Banc, j: JoueurSalle, id: string, t: number): void {
    const p = porteDeId(id)!;
    for (let r = 1.0; r <= 2.8; r += 0.2) {
      for (let a = 0; a < 360; a += 10) {
        j.p = [p.point[0] + Math.cos((a * Math.PI) / 180) * r, 0, p.point[1] + Math.sin((a * Math.PI) / 180) * r];
        const m = msgs(b.svc.recevoir(j, msg({ t: "acheter", id }), t), "achat")[0];
        if (m.ok) return;
        if (m.raison !== "loin") throw new Error(`${id} : ${m.raison}`);
      }
    }
    throw new Error(`porte ${id} introuvable`);
  }
  /**
   * Avance la manche en ne tuant (avec `melee`) que les tigres arrivés à moins de `rayon` m de `centre`, le joueur posté là (les tigres le
   * chassent, la griffe ne fait rien) ; s'arrête dès que `fini()`.
   */
  function attirer(b: Banc, j: JoueurSalle, poste: Vec2, centre: readonly number[], rayon: number, melee: boolean, t: number, fini: () => boolean): { t: number; sorties: Sortie[] } {
    const sorties: Sortie[] = [];
    for (let k = 0; k < 3000 && !fini(); k++, t += 100) {
      j.p = [poste[0], 0, poste[1]];
      sorties.push(...b.svc.tic(t));
      for (const z of tigresVivants(b)) {
        if (Math.hypot(z.x - centre[0], z.z - centre[2]) > rayon) continue;
        sorties.push(...b.svc.blesser(`z${z.id}`, 1e7, j, "corps", t, { melee }));
      }
    }
    return { t, sorties };
  }

  it("enchaînement complet par la salle : pendules, casseroles, marmite (livraison), cuve, truffe, midi, post-it, billot, service, cloche", () => {
    const periodeMidiMs = 20_000;
    const b = partieEnCours(["a"], {
      argentDepart: 200_000, courant: true, degatsGriffe: 0, mancheTruck: 1, total1: 10, pauseMs: 2_000, secret: { periodeMidiMs, livraisonService: 2 },
    });
    let t = T_MANCHE1 + 100;
    avancer(b, T0 + 100, t);
    const j = b.j("a");
    j.pv = 1e9;
    const sec = () => b.svc.etat().secret;
    expect(b.svc.etat()).toMatchObject({ phase: "manche", mancheTruck: true });
    // les tigres doivent pouvoir rejoindre la cour, puis la cuisine
    for (const id of ["D2", "D4"]) porte(b, j, id, t);

    // 1. les quatre pendules arrêtées, au couteau
    for (const p of C.pendules.slice(0, 4)) {
      const v = poster(j, p.position, p.c);
      b.svc.coupSecret(j, "couteau", v.o, v.d, t);
    }
    expect(sec()).toMatchObject({ etape: 1, pendules: 15, pendulesT: t });
    // 2. la batterie de cuivre dans l'ordre de l'ardoise (tiré à chaque partie)
    const enCuisine: Vec2 = local(70, -9.5, -9.5);
    let s: Sortie[] = [];
    for (const i of sec().ardoise) {
      const v = poster(j, enCuisine, C.casseroles[i].c);
      s = b.svc.tirSecret(j, "pistolet", v.o, [v.d], t);
    }
    expect(secrets(s)).toEqual(["casserole", "casseroles"]);
    expect(sec().etape).toBe(2);
    // 3. la marmite : des petits du Truck tués autour d'elle pendant la livraison
    const devantMarmite: Vec2 = [C.marmite.c[0] - 2, C.marmite.c[2] + 1.5];
    const r3 = attirer(b, j, devantMarmite, C.marmite.c, 5.5, false, t, () => sec().etape >= 3 || b.svc.etat().phase !== "manche");
    t = r3.t;
    expect(secrets(r3.sorties)).toContain("marmite_pleine");
    expect(sec().etape).toBe(3);
    ({ t } = finirManche(b, j, t));
    // 4. une grenade au pied de la cuve n° 3 (une manche ordinaire)
    t = avancerJusqua(b, t, () => b.svc.etat().phase === "manche");
    const truffe = INTERACTIONS_SECRET.find((x) => x.id === "truffe")!;
    const g = poster(j, truffe.position, [C.cuves[2].c[0], 0, C.cuves[2].c[2]]);
    b.svc.recevoir(j, msg({ t: "lancerGrenade", genre: "frag", o: g.o, d: norme([g.d[0] * 0.3, -1, g.d[2] * 0.3]) }), t);
    const r4 = avancer(b, t + 50, t + 4500, 50);
    t += 4500;
    expect(secrets(r4)).toContain("congelateur");
    expect(sec().etape).toBe(4);
    // 5. la truffe portée au four à temps (aucune réponse d'achat : le serveur ne trahit rien)
    expect(msgs(interagir(b, j, "truffe", t), "achat")).toEqual([]);
    expect(sec().truffe).toEqual({ porteur: "a", finT: t + 30_000 });
    t += 12_000;
    avancer(b, t - 11_900, t, 100);
    expect(secrets(interagir(b, j, "four", t))).toEqual(["truffe_servie"]);
    expect(sec().etape).toBe(5);
    // 6. une arme au Micro-ondes pendant les douze coups de midi
    t = avancerJusqua(b, t, (tt) => dansMidi(sec().pendulesT, periodeMidiMs, tt));
    const pap = ACHATS.find((a) => a.id === "pap")!;
    j.p = [pap.position[0], 0, pap.position[1]];
    j.main = "secondaire"; j.arme = "pistolet";
    const r6 = b.svc.recevoir(j, msg({ t: "acheter", id: "pap" }), t);
    expect(msgs(r6, "achat")[0]).toMatchObject({ ok: true });
    expect(secrets(r6)).toEqual(["midi"]);
    expect(sec().etape).toBe(6);
    // 7. les écrans dont le post-it porte le code que l'ampoule du Local technique clignote
    const { postits, code } = sec() as { postits: number[]; code: number[] };
    const enOpen: Vec2 = local(72, -11, -5.4);
    for (const n of code) {
      const v = poster(j, enOpen, C.ecrans[postits.indexOf(n)].c);
      s = b.svc.tirSecret(j, "pistolet", v.o, [v.d], t);
    }
    expect(secrets(s)).toEqual(["ecran", "ecrans"]);
    expect(sec().etape).toBe(7);
    // 8. le billot : des tigres achevés au couteau près de lui (la cuisine)
    const devantBillot: Vec2 = [C.billot.c[0] - 2.2, C.billot.c[2]];
    let r8 = attirer(b, j, devantBillot, C.billot.c, 4.5, true, t, () => sec().etape >= 8 || b.svc.etat().phase !== "manche");
    t = r8.t;
    while (sec().etape < 8) {
      t = avancerJusqua(b, t, () => b.svc.etat().phase === "manche");
      r8 = attirer(b, j, devantBillot, C.billot.c, 4.5, true, t, () => sec().etape >= 8 || b.svc.etat().phase !== "manche");
      t = r8.t;
    }
    expect(sec().etape).toBe(8);
    // 9. le service : au four pendant une livraison (la 2e ici, `livraisonService`), le Truck qui saute avant de repartir
    let garde = 0;
    while (!(b.svc.etat().phase === "manche" && b.svc.etat().mancheTruck && b.svc.etat().truck)) {
      if (b.svc.etat().phase === "manche" && !b.svc.etat().mancheTruck) ({ t } = finirManche(b, j, t));
      else { b.svc.tic(t); t += 100; }
      if (++garde > 20_000) throw new Error("pas de deuxième livraison");
    }
    expect(secrets(interagir(b, j, "four", t))).toEqual(["service"]);
    expect(sec().service).toBe(t);
    const fin = b.svc.blesserTruck(1e9, j, t + 10);
    expect(secrets(fin)).toEqual(["servi"]);
    // la récompense : Rayon Goulaf et Bazooka au four (gratinés), tous les atouts, plus un tigre debout
    const eq = msgs(fin, "equipement").at(-1)!;
    expect(eq).toMatchObject({ main: "speciale", ravitaille: "tout" });
    expect(eq.equip).toMatchObject({ secondaire: "rayon", speciale: "bazooka" });
    expect(eq.equip.ameliorees).toEqual(expect.arrayContaining(["rayon", "bazooka"]));
    expect(b.svc.etat().joueurs[0].atouts.sort()).toEqual(["expresso", "gratin", "pausecafe", "ristretto"]);
    expect(tigresVivants(b)).toEqual([]);
    expect(sec().etape).toBe(9);
    // la cloche du comptoir finit la partie sur une victoire
    const v = interagir(b, j, "cloche", t + 100);
    expect(secrets(v)).toEqual(["victoire"]);
    expect(b.svc.etat()).toMatchObject({ phase: "fin", bilan: { victoire: true } });
  });

  it("reprise : le porteur de la truffe qui tombe la fait fondre (la cuve se referme), un autre la reprendra après une nouvelle grenade", () => {
    const b = partieEnCours(["a", "c"], { courant: true, secret: { etape: 4 } });
    avancer(b, T0 + 100, T_MANCHE1 + 50);
    const a = b.j("a");
    interagir(b, a, "truffe", T_MANCHE1 + 100);
    expect(b.svc.etat().secret.truffe?.porteur).toBe("a");
    // le second joueur ne la prend pas des mains du premier
    expect(interagir(b, b.j("c"), "truffe", T_MANCHE1 + 150)).toEqual([]);
    a.pv = 1;
    const s = b.ctx.infliger(a, 50, null, "tigre_zombie", "corps", "couteau", T_MANCHE1 + 200);
    expect(secrets(s)).toContain("truffe_fondue");
    expect(b.svc.etat().secret).toMatchObject({ etape: 3 });
    expect(b.svc.etat().secret.truffe).toBeUndefined();
  });

  it("E sur un objet du secret hors de son étape : rien du tout (ni refus, ni effet) ; une nouvelle partie repart de zéro", () => {
    const b = partieEnCours(["a"], { courant: true });
    avancer(b, T0 + 100, T_MANCHE1 + 50);
    for (const id of ["truffe", "four", "cloche"]) expect(interagir(b, b.j("a"), id, T_MANCHE1 + 100)).toEqual([]);
    expect(b.svc.recevoir(b.j("a"), msg({ t: "acheter", id: "secret:inconnu" }), T_MANCHE1 + 100)).toEqual([]);
    expect(b.svc.etat().secret).toMatchObject({ etape: 0, pendulesT: 0 });
    // un tir ou un coup qui ne touche rien du décor ne produit rien
    expect(b.svc.tirSecret(b.j("a"), "pistolet", [118, 1.6, -24], [[1, 0, 0]], T_MANCHE1 + 100)).toEqual([]);
    expect(b.svc.coupSecret(b.j("a"), "couteau", [118, 1.6, -24], [1, 0, 0], T_MANCHE1 + 100)).toEqual([]);
  });
});

/** Avance de 100 ms en 100 ms (sans tuer de tigre, la griffe des essais ne fait rien) jusqu'à `ok()`. */
function avancerJusqua(b: Banc, t: number, ok: (t: number) => boolean): number {
  for (let k = 0; k < 20_000; k++, t += 100) {
    if (ok(t)) return t;
    b.svc.tic(t);
  }
  throw new Error("condition jamais atteinte");
}
