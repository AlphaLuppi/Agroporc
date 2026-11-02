/**
 * Grenades du Battle Royale (lot tactique) : le sac du butin fournit les grenades (le service BR est un faux qui compte ce qu'il en reste), la salle
 * valide le lancer, le souffle blesse les adversaires et l'élimination passe par la mort définitive du BR ; une grenade se ramasse comme un soin.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { appliquerRamassage, genererButin } from "./br-butin";
import { BR, EQUIPEMENT_DEPART_BR, MAIN_DEPART_BR } from "./br-regles";
import { construireMonde } from "./collision";
import { GRENADES, GRENADES_JOUEURS, positionTrajectoire, trajectoireDuMessage } from "./grenades";
import { Salle, type JoueurSalle, type Sortie } from "./match";
import type { ContexteSalle, ServiceBr } from "./match-contexte";
import { JEU, copierEquipement, oeilDe, type EtatPartieBr, type MessageServeur, type ObjetBr, type PointButin, type Vec3 } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const bat: Building = { h: 12, r: [[0, 0], [10, 0], [10, 10], [0, 10]], c: [5, 5] };
const petit = { ...scene, buildings: [bat], pois: [] } as SceneData;
const monde = construireMonde(petit);
const POINTS: Vec2[] = [[-15, -15], [28, 28], [-15, 28], [28, -15]];
const T0 = 2_000_000;

/** Faux service BR : les joueurs sont placés au sol, le sac de grenades est un compteur que la salle décrémente par `retirerGrenade`. */
function salleBr(sacs: Record<string, number>) {
  const retires: string[] = [];
  const vol = new Set<string>();
  let ctx: ContexteSalle | null = null;
  const etat = (): EtatPartieBr => ({ phase: "jeu", hote: "", capacite: BR.joueursMax, minJoueurs: BR.joueursMin, debutT: 0, finT: 0, avion: null, zone: null, vivants: 0, total: 0 });
  const service: ServiceBr = {
    tic: () => [],
    apercu: () => ({ phase: "jeu", vivants: 0, total: 0, zone: null, avion: null }),
    reinitialiser: () => [],
    synchro: () => [],
    admis: () => true,
    entreeJoueur: (j, t) => ctx!.placerJoueur(j, [0, 0, 0], 0, { pv: JEU.pvMax, equip: copierEquipement(EQUIPEMENT_DEPART_BR), main: MAIN_DEPART_BR }, t),
    aBord: () => false,
    enVol: (id) => vol.has(id),
    chute: () => undefined,
    recevoir: () => [],
    surDegats: () => undefined,
    tueurValide: () => true,
    surMort: () => [],
    liberer: () => [],
    arrivee: () => [],
    enCours: () => true,
    peutRegarder: () => false,
    etat,
    resume: () => ({ phase: "jeu", joueurs: 2, vivants: 2 }),
    aidePolice: () => ({ phase: () => "jeu", zone: () => null, vivants: () => 2, premierAtterrissageT: () => null, enVol: () => false, estSpectateur: () => false, nbJoueursDepart: () => 0 }),
    stockGrenades: (id) => sacs[id] ?? 0,
    retirerGrenade: (j) => { retires.push(j.id); sacs[j.id] = Math.max(0, (sacs[j.id] ?? 0) - 1); return [{ a: j.id, m: { t: "inventaire", bandage: 0, potion: 0, grenade: sacs[j.id], usage: null } }]; },
  };
  const s = new Salle(monde, POINTS, () => 0, T0, { br: { scene: petit }, fabriqueBr: (c) => { ctx = c; return service; } });
  for (const id of ["a", "b"]) { s.connecter(id, `Joueur${id}`, T0); s.recevoir(id, { t: "rejoindre" }, T0); }
  return { s, retires, vol };
}
const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
function tenir(s: Salle, positions: Record<string, Vec3>, t: number) {
  for (const [id, p] of Object.entries(positions)) { const a = j(s, id); a.p = [...p]; a.v = [0, 0, 0]; a.etatT = t; a.protegeJusqua = 0; }
}
const oeil = (p: Vec3): Vec3 => [p[0], p[1] + oeilDe({ accroupi: false }), p[2]];
function lancer(s: Salle, id: string, t: number) {
  const a = j(s, id);
  a.lacet = 0; a.tangage = 0;
  return s.recevoir(id, { t: "lancerGrenade", genre: "frag", o: oeil(a.p), d: [0, 0, -1] }, t);
}

describe("Battle Royale : lancer une grenade du sac", () => {
  it("une grenade de moins dans le sac (inventaire privé), trajectoire diffusée, aucun stock d'arène", () => {
    const { s, retires } = salleBr({ a: 2 });
    tenir(s, { a: [0, 0, 20], b: [100, 0, 100] }, T0);
    const out = lancer(s, "a", T0 + 100);
    expect(messages(out, "grenade")).toHaveLength(1);
    expect(retires).toEqual(["a"]);
    const inv = out.find((x) => x.m.t === "inventaire")!;
    expect(inv.a).toBe("a");
    expect(messages(s.tic(T0 + 150), "stockGrenades")).toHaveLength(0);
  });

  it("sac vide : rien ne part", () => {
    const { s, retires } = salleBr({ a: 0 });
    tenir(s, { a: [0, 0, 20], b: [100, 0, 100] }, T0);
    expect(messages(lancer(s, "a", T0 + 100), "grenade")).toHaveLength(0);
    expect(retires).toEqual([]);
  });

  it("à bord de l'avion ou en chute : refusé, sac intact", () => {
    const { s, retires, vol } = salleBr({ a: 2 });
    tenir(s, { a: [0, 0, 20], b: [100, 0, 100] }, T0);
    vol.add("a");
    expect(messages(lancer(s, "a", T0 + 100), "grenade")).toHaveLength(0);
    expect(retires).toEqual([]);
  });

  it("le souffle blesse l'adversaire et sa mort est définitive, créditée au lanceur (cause « grenade »)", () => {
    const { s } = salleBr({ a: 2 });
    tenir(s, { a: [25, 0, 25], b: [100, 0, 100] }, T0); // loin du bâtiment (0..10) : rien entre le centre et la victime
    s.tic(T0 + 10);
    const g = messages(lancer(s, "a", T0 + 100), "grenade")[0];
    const p = positionTrajectoire(trajectoireDuMessage(monde, g), g.explosionT - g.t0);
    const posB: Vec3 = [p[0] + 1, 0, p[2]];
    j(s, "b").pv = 15; j(s, "b").bouclier = 0;
    const sorties: Sortie[] = [];
    for (let t = T0 + 100; t <= g.explosionT + 200; t += 50) { tenir(s, { a: [100, 0, 100], b: posB }, t); sorties.push(...s.tic(t)); }
    expect(messages(sorties, "grenadeExplose")).toHaveLength(1);
    const mort = messages(sorties, "mort");
    expect(mort).toHaveLength(1);
    expect(mort[0]).toMatchObject({ cible: "b", par: "a", cause: "grenade" });
    expect(j(s, "b").vivant).toBe(false);
  });

  it("une arme unique du butin (bazooka) tire une roquette en Battle Royale aussi", () => {
    const { s } = salleBr({});
    tenir(s, { a: [0, 0, 20], b: [100, 0, 100] }, T0);
    const a = j(s, "a");
    a.equip.speciale = "bazooka"; a.munSpeciale = 3; a.main = "speciale"; a.arme = "bazooka"; a.sortieJusqua = 0; a.lacet = 0; a.tangage = 0;
    const out = s.recevoir("a", { t: "tir", arme: "bazooka", o: oeil(a.p), d: [[0, 0, -1]], touches: [] }, T0 + 100);
    expect(messages(out, "grenade")[0]).toMatchObject({ genre: "roquette", par: "a" });
  });
});

describe("Battle Royale : la grenade est un objet du butin", () => {
  it("se ramasse en pile de GRENADES_JOUEURS.pile, comme un soin, le reste demeure au sol", () => {
    const equip = copierEquipement(EQUIPEMENT_DEPART_BR);
    const obj = (qte?: number): ObjetBr => ({ id: 1, genre: "grenade", ref: null, p: [0, 0, 0], ...(qte !== undefined ? { qte } : {}) });
    expect(appliquerRamassage(equip, { bandage: 0, potion: 0, grenade: 0 }, obj())).toMatchObject({ ok: true, soins: { grenade: 1 } });
    const pleine = appliquerRamassage(equip, { bandage: 0, potion: 0, grenade: GRENADES_JOUEURS.pile }, obj());
    expect(pleine).toMatchObject({ ok: false, raison: "inutile" });
    const reste = appliquerRamassage(equip, { bandage: 0, potion: 0, grenade: GRENADES_JOUEURS.pile - 1 }, obj(3));
    expect(reste).toMatchObject({ ok: true, soins: { grenade: GRENADES_JOUEURS.pile }, reste: 2 });
    // un sac sans la clé `grenade` (client ou test d'avant) vaut zéro
    expect(appliquerRamassage(equip, { bandage: 1, potion: 1 }, obj())).toMatchObject({ ok: true, soins: { grenade: 1 } });
  });

  it("le tirage du butin en contient (~10 %), sans référence", () => {
    const points: PointButin[] = [];
    for (let i = 0; i < 700; i++) points.push({ p: [(i % 50) * 3, 0, Math.floor(i / 50) * 3], pool: (["interieur", "toit", "facade", "route"] as const)[i % 4] });
    const l = genererButin(points, 5, 480);
    const grenades = l.filter((o) => o.genre === "grenade");
    expect(grenades.length / l.length).toBeGreaterThan(0.05);
    expect(grenades.length / l.length).toBeLessThan(0.16);
    for (const o of grenades) expect(o.ref).toBeNull();
  });

  it("mêmes dégâts qu'en arène : le profil joueur est celui de la grenade", () => {
    expect(GRENADES.frag.joueurs).toEqual({ centre: 200, bord: 40 });
  });
});
