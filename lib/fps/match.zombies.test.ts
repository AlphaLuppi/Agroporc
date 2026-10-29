import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { Salle, INACTIF_MS, type JoueurSalle, type OptionsSalle, type Sortie } from "./match";
import type { OptionsServiceZombies } from "./match-zombies";
import { JEU, SILHOUETTE, decoderZombies, type MessageClient, type MessageServeur, type Vec3 } from "./protocole";
import { DEPARTS, FENETRES, construireMondeZombies } from "./zombies-carte";
import { ZOMBIES, gainKill, gainTouche } from "./zombies-vagues";

/**
 * Intégration : une vraie `Salle` en mode zombies (lobby → partie → tigres → argent). Les règles du service sont dans match-zombies.test.ts ;
 * ici on vérifie ce que la salle en fait (admission, tirs et coups validés par le serveur, absence de `mort`, snaps, inactivité).
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const T0 = 5_000_000;

function suite(graine = 3): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function salleZ(zombies: Partial<OptionsServiceZombies> = {}): Salle {
  const options: OptionsSalle = { zombies };
  return new Salle(construireMondeZombies(scene), DEPARTS.map((d) => [d[0], d[1]] as [number, number]), suite(), T0, options);
}
const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
const types = (s: Sortie[]) => s.map((x) => x.m.t);
const dernierEtat = (s: Sortie[]) => messages(s, "zombies").at(-1)?.etat;

/** Salle avec les joueurs `ids` connectés ; le premier lance la partie à T0 ; tous rejoignent à T0. */
function partie(ids: string[], zombies: Partial<OptionsServiceZombies> = {}): Salle {
  const s = salleZ({ pauseMs: 1000, degatsGriffe: 0, ...zombies });
  ids.forEach((id) => s.connecter(id, `Agent ${id}`, T0));
  s.recevoir(ids[0], { t: "lancerPartie" }, T0);
  ids.forEach((id) => s.recevoir(id, { t: "rejoindre" }, T0));
  return s;
}

/** Avance la salle de `t0` à `t1` ; renvoie toutes les sorties. Le joueur reste « actif » (états refusés, `etatT` rafraîchi à la main). */
function avancer(s: Salle, t0: number, t1: number, pas = 50): Sortie[] {
  const out: Sortie[] = [];
  for (let t = t0; t <= t1; t += pas) {
    for (const x of s.joueurs()) if (x.enJeu) x.etatT = t;
    out.push(...s.tic(t));
  }
  return out;
}
/** Tigres du dernier snap des joueurs. */
function tigresDe(sorties: Sortie[]) {
  const snap = messages(sorties.filter((x) => x.a === "joueurs"), "snap").filter((m) => m.zombies).at(-1);
  return snap ? decoderZombies(snap.zombies!) : [];
}
function regarder(s: Salle, id: string, point: Vec3): { o: Vec3; d: Vec3 } {
  const a = j(s, id);
  const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
  const v = [point[0] - o[0], point[1] - o[1], point[2] - o[2]];
  const l = Math.hypot(v[0], v[1], v[2]);
  const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
  a.lacet = Math.atan2(-d[0], -d[2]);
  a.tangage = Math.asin(d[1]);
  return { o, d };
}

// ---------------------------------------------------------------------------------------------
describe("lobby, admission, entrée", () => {
  it("la connexion fait un membre du lobby : bienvenue, présence, `zombies{etat}` à tous ; `phase` jeu et objectif 0", () => {
    const s = salleZ();
    const sorties = s.connecter("a", "Alice", T0);
    expect(types(sorties)).toEqual(["bienvenue", "presence", "zombies"]);
    expect(messages(sorties, "bienvenue")[0].match).toMatchObject({ phase: "jeu", objectif: 0, fin: null });
    expect(dernierEtat(sorties)).toMatchObject({ phase: "lobby", hote: "a", capacite: 8 });
    expect(s.resumeZombies()).toEqual({ phase: "lobby", joueurs: 1, manche: 0 });
    expect(s.nombreEnJeu()).toBe(0);
  });

  it("capacité de 8 pour toute la salle, lobby compris : le 9e reçoit `erreur{plein}`", () => {
    const s = salleZ();
    for (let i = 0; i < 8; i++) expect(types(s.connecter(`j${i}`, `Agent${i}`, T0))).not.toContain("erreur");
    const sorties = s.connecter("neuf", "Trop", T0);
    expect(messages(sorties, "erreur")[0]).toMatchObject({ code: "plein" });
    expect(s.nombreJoueurs()).toBe(8);
  });

  it("`rejoindre` refusé (`lobby`) tant que le joueur n'est pas admis ; seul l'hôte lance", () => {
    const s = salleZ();
    s.connecter("a", "Alice", T0); s.connecter("b", "Bob", T0);
    expect(s.recevoir("a", { t: "rejoindre" }, T0)).toEqual([{ a: "a", m: { t: "refus", action: "rejoindre", raison: "lobby" } }]);
    expect(j(s, "a").enJeu).toBe(false);
    expect(s.recevoir("b", { t: "lancerPartie" }, T0)).toEqual([]);
    expect(s.resumeZombies()!.phase).toBe("lobby");
    expect(dernierEtat(s.recevoir("a", { t: "lancerPartie" }, T0))!.phase).toBe("pause");
  });

  it("admis : placé sur un départ de la cour Centre, équipement de départ imposé (pistolet + couteau, 500 $), apparition + présence + synchro", () => {
    const s = salleZ();
    s.connecter("a", "Alice", T0);
    s.recevoir("a", { t: "lancerPartie" }, T0);
    // le client choisit un équipement : ignoré
    const sorties = s.recevoir("a", { t: "rejoindre", principale: "sniper", secondaire: "revolver", melee: "epee" }, T0 + 10);
    expect(types(sorties)).toEqual(["apparition", "presence", "zombies", "batiments", "argent"]);
    const ap = messages(sorties, "apparition")[0];
    expect(ap).toMatchObject({
      id: "a", arme: "pistolet", main: "secondaire", pv: JEU.pvMax, bouclier: 0,
      equip: { principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true },
    });
    expect(DEPARTS.some((d) => d[0] === ap.p[0] && d[1] === ap.p[2])).toBe(true);
    expect(j(s, "a")).toMatchObject({ enJeu: true, vivant: true });
    expect(j(s, "a").protegeJusqua).toBe(T0 + 10 + JEU.protectionMs);
    expect(messages(sorties, "argent")[0]).toMatchObject({ solde: ZOMBIES.argentDepart });
    expect(messages(sorties, "batiments")[0]).toMatchObject({ complet: true, detruits: [] });
    // un deuxième `rejoindre` ne fait rien
    expect(s.recevoir("a", { t: "rejoindre" }, T0 + 20)).toEqual([]);
  });

  it("deux admis n'apparaissent pas au même endroit", () => {
    const s = partie(["a", "b", "c"]);
    const points = ["a", "b", "c"].map((id) => `${j(s, id).p[0]},${j(s, id).p[2]}`);
    expect(new Set(points).size).toBe(3);
  });

  it("`equiper`, `arme` et le choix d'équipement de `rejoindre` sont ignorés", () => {
    const s = partie(["a"]);
    const avant = JSON.stringify(j(s, "a").equip);
    s.recevoir("a", { t: "equiper", principale: "sniper", secondaire: "revolver", melee: "epee" }, T0 + 100);
    s.recevoir("a", { t: "arme", arme: "pompe" }, T0 + 100);
    expect(JSON.stringify(j(s, "a").equip)).toBe(avant);
    expect(s.equipementProchain("a")).toEqual({ principale: "mitraillette", secondaire: "pistolet", speciale: null });
    expect(j(s, "a")).toMatchObject({ arme: "pistolet", main: "secondaire" });
  });

  it("sans arme principale : le slot principal est vide (`main` refusé), couteau et pistolet seulement", () => {
    const s = partie(["a"]);
    s.recevoir("a", { t: "main", slot: "principale" }, T0 + 1000);
    expect(j(s, "a").main).toBe("secondaire");
    s.recevoir("a", { t: "main", slot: "couteau" }, T0 + 1000);
    expect(j(s, "a")).toMatchObject({ main: "couteau", arme: "couteau" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("tirs sur les tigres", () => {
  /** Partie à un joueur avancée jusqu'à l'apparition du premier tigre ; le joueur est placé à 5 m du tigre, côté cour. */
  function faceAUnTigre(zombies: Partial<OptionsServiceZombies> = {}) {
    const s = partie(["a"], { total1: 3, ...zombies });
    const sorties = avancer(s, T0 + 50, T0 + 5000);
    const [z] = tigresDe(sorties.slice(-40));
    expect(z).toBeDefined();
    // 5 m du tigre vers le sud-est de la fenêtre (côté cour Centre)
    const a = j(s, "a");
    a.p = [z.x + 1.5, 0, z.z + 4.8];
    return { s, a, z, id: `z${z.id}`, t: T0 + 5000 };
  }
  function tirerSur(s: Salle, id: string, z: { x: number; z: number }, t: number, zone: "tete" | "corps" = "corps"): Sortie[] {
    const { o, d } = regarder(s, "a", [z.x, 1.0, z.z]);
    return s.recevoir("a", { t: "tir", arme: j(s, "a").arme as "pistolet", o, d: [d], touches: [{ cible: id, zone, plomb: 0 }] }, t);
  }

  it("un tir qui touche : `degats` au tireur seul (pv en %), +10 $, touches++ ; le tigre meurt aux PV épuisés : zombieMort, kill, argent, présence", () => {
    const { s, a, z, id, t } = faceAUnTigre();
    let tir = t;
    let toutes: Sortie[] = [];
    for (let k = 0; k < 40 && !toutes.some((x) => x.m.t === "zombieMort"); k++, tir += 400) toutes = [...toutes, ...tirerSur(s, id, z, tir)];
    const degats = messages(toutes, "degats");
    expect(degats.length).toBeGreaterThan(1);
    expect(degats[0]).toMatchObject({ cible: id, par: "a", bouclier: 0 });
    expect(["corps", "tete"]).toContain(degats[0].zone);
    expect(degats[0].pv).toBeLessThan(100);
    expect(toutes.filter((x) => x.m.t === "degats").every((x) => x.a === "a")).toBe(true);
    const mort = toutes.find((x) => x.m.t === "zombieMort")!;
    expect(mort.a).toBe("joueurs");
    expect(mort.m).toMatchObject({ id, par: "a" });
    // (v8) comment il est mort : l'arme et l'origine du tir (l'œil du tireur), pour la mort désarticulée côté client
    const m8 = mort.m as { arme?: string; src?: number[]; ameliore?: boolean };
    expect(m8.arme).toBe("pistolet");
    expect(m8.ameliore).toBeUndefined();
    const o = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
    m8.src!.forEach((v, k) => expect(v).toBeCloseTo(o[k], 1));
    const zoneMort = (mort.m as { zone: "tete" | "corps" }).zone;
    expect(a.kills).toBe(1);
    expect(a.touches).toBe(degats.length);
    expect(a.killsParArme).toEqual({ pistolet: 1 });
    // gain (BO1) : +10 par tir qui touche sans tuer, +60 au kill au corps ou +100 à la tête
    const delta = messages(toutes, "argent").reduce((n, m) => n + m.delta, 0);
    expect(delta).toBe((degats.length - 1) * gainTouche() + gainKill({ tete: zoneMort === "tete" }));
    expect(types(toutes)).toContain("presence");
    expect(types(toutes)).not.toContain("mort");
  });

  it("un plomb déclaré hors de la forme du tigre est ignoré (revalidation serveur) ; un id de tigre inconnu aussi", () => {
    const { s, z, id, t } = faceAUnTigre();
    const { o, d } = regarder(s, "a", [z.x + 30, 1.0, z.z]);
    const manque = s.recevoir("a", { t: "tir", arme: "pistolet", o, d: [d], touches: [{ cible: id, zone: "corps", plomb: 0 }] }, t);
    expect(messages(manque, "degats")).toEqual([]);
    expect(j(s, "a").touches).toBe(0);
    const { o: o2, d: d2 } = regarder(s, "a", [z.x, 1.0, z.z]);
    const inconnu = s.recevoir("a", { t: "tir", arme: "pistolet", o: o2, d: [d2], touches: [{ cible: "z999", zone: "corps", plomb: 0 }] }, t + 500);
    expect(messages(inconnu, "degats")).toEqual([]);
    // un tir réel passe
    expect(messages(tirerSur(s, id, z, t + 1000), "degats")).toHaveLength(1);
  });

  it("zone `tete` : la tête déclarée est revérifiée par le serveur (cou non touché = zone du serveur)", () => {
    const { s, z, id, t } = faceAUnTigre();
    const sorties = tirerSur(s, id, z, t, "tete");
    const [d] = messages(sorties, "degats");
    expect(d).toBeDefined();
    expect(["corps", "tete"]).toContain(d.zone);
  });

  it("en zombies les joueurs ne sont ni cibles ni obstacles pour les tirs et les coups des autres", () => {
    const s = partie(["a", "b"]);
    const a = j(s, "a"), b = j(s, "b");
    a.p = [128, 0, -50]; b.p = [131, 0, -50];
    a.protegeJusqua = 0; b.protegeJusqua = 0;
    const { o, d } = regarder(s, "a", [b.p[0], 1.0, b.p[2]]);
    const t = T0 + 2000;
    const tir = s.recevoir("a", { t: "tir", arme: "pistolet", o, d: [d], touches: [{ cible: "b", zone: "corps", plomb: 0 }] }, t);
    expect(messages(tir, "degats")).toEqual([]);
    expect(b.pv).toBe(JEU.pvMax);
    expect(messages(tir, "tir")).toHaveLength(1); // le tir est diffusé (traçante), mais ne touche personne
    // coup de couteau collé à lui
    b.p = [128.9, 0, -50];
    s.recevoir("a", { t: "main", slot: "couteau" }, t);
    const c = regarder(s, "a", [b.p[0], 1.0, b.p[2]]);
    const coup = s.recevoir("a", { t: "coup", o: c.o, d: c.d, cibles: ["b"] }, t + 500);
    expect(messages(coup, "degats")).toEqual([]);
    expect(messages(coup, "coup")).toHaveLength(1);
    expect(b.pv).toBe(JEU.pvMax);
    expect(a.kills).toBe(0);
  });

  it("coup d'épée sur plusieurs tigres : jusqu'à 3 cibles, 1 000 dégâts chacune (un coup tue), 130 $ par kill à l'arme blanche", () => {
    // le joueur attend à son départ, griffes neutralisées : les tigres entrent et se groupent contre lui
    const s = partie(["a"], { total1: 6, degatsGriffe: 0 });
    const a = j(s, "a");
    s.equiper(a, { ...a.equip, melee: "epee" as const }, "couteau", T0);
    expect(a).toMatchObject({ main: "couteau", arme: "epee" });
    let t = T0 + 50;
    let proches: { id: number; x: number; z: number }[] = [];
    for (; t < T0 + 90_000 && proches.length < 3; t += 50) {
      const sorties = avancer(s, t, t);
      const tigres = tigresDe(sorties.slice(-40));
      if (tigres.length) proches = tigres.filter((z) => Math.hypot(z.x - a.p[0], z.z - a.p[2]) < 2.6);
    }
    expect(proches.length).toBeGreaterThanOrEqual(2);
    const cibles = [...proches.map((z) => `z${z.id}`), "z999"].slice(0, 4);
    const cx = proches.reduce((n, z) => n + z.x, 0) / proches.length, cz = proches.reduce((n, z) => n + z.z, 0) / proches.length;
    const { o, d } = regarder(s, "a", [cx, 1.0, cz]);
    for (const x of s.joueurs()) x.etatT = t;
    const resultat = s.recevoir("a", { t: "coup", o, d, cibles }, t);
    const degats = messages(resultat, "degats");
    expect(degats.length).toBeGreaterThanOrEqual(2);
    expect(degats.length).toBeLessThanOrEqual(3);
    expect(degats.every((m) => m.degats === 1000 && m.pv === 0 && m.cible.startsWith("z"))).toBe(true);
    expect(messages(resultat, "zombieMort")).toHaveLength(degats.length);
    // (v8) morts à l'épée : cause mêlée, arme et position du coup (le client fauche les tigres de côté)
    expect(messages(resultat, "zombieMort").every((m) => m.cause === "melee" && m.arme === "epee" && m.src && Math.abs(m.src[0] - o[0]) < 0.01)).toBe(true);
    expect(a.killsParArme).toEqual({ epee: degats.length });
    const gain = messages(resultat, "argent").reduce((n, m) => n + m.delta, 0);
    expect(gain).toBe(degats.length * gainKill({ melee: true }));
    expect(resultat[0].m).toMatchObject({ t: "coup", id: "a", arme: "epee" });
  });

  it("un coup d'épée à plus de 3,3 m d'un tigre ne le touche pas", () => {
    const { s, a, z, id, t } = faceAUnTigre();
    s.equiper(a, { ...a.equip, melee: "epee" }, "couteau", t - 1000);
    a.p = [z.x + 1.5, 0, z.z + 8];
    a.etatT = t;
    const { o, d } = regarder(s, "a", [z.x, 1.0, z.z]);
    const sorties = s.recevoir("a", { t: "coup", o, d, cibles: [id] }, t);
    expect(messages(sorties, "coup")).toHaveLength(1);
    expect(messages(sorties, "degats")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("mise à terre, inactivité, départs", () => {
  it("0 PV : ni `mort` ni killcam ni compte à rebours de réapparition ; `degats`, `zombies{etat}` (à terre) et `presence`", () => {
    const s = partie(["a", "b"]);
    const t = T0 + 3000;
    avancer(s, T0 + 50, t - 50);
    const sorties = s.infliger(j(s, "b"), 1000, null, "tigre_zombie", "corps", "couteau", t);
    expect(types(sorties)).toEqual(["degats", "zombies", "presence"]);
    expect(messages(sorties, "degats")[0]).toMatchObject({ cible: "b", par: "", pv: 0 });
    expect(dernierEtat(sorties)!.joueurs.find((x) => x.id === "b")).toMatchObject({ etat: "terre", terreFinT: t + ZOMBIES.terreMs });
    expect(j(s, "b")).toMatchObject({ vivant: false, posture: "mort", morts: 1, reapparitionT: null, enJeu: true });
    // aucune réapparition automatique : 10 s plus tard, toujours à terre
    const apres = avancer(s, t + 50, t + 10_000);
    expect(types(apres)).not.toContain("apparition");
    expect(types(apres)).not.toContain("mort");
    expect(j(s, "b").vivant).toBe(false);
    // à terre : le corps est suivi (le client le fait encore glisser ou retomber), posture « mort » imposée ; ni tir ni coup
    const posAvant = [...j(s, "b").p];
    s.recevoir("b", { t: "etat", seq: 5, p: [posAvant[0] + 1, 0, posAvant[2]], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 }, t + 10_000);
    expect(j(s, "b").p).toEqual([posAvant[0] + 1, 0, posAvant[2]]);
    expect(j(s, "b")).toMatchObject({ posture: "mort", vivant: false });
    expect(j(s, "b").histo.at(-1)?.p).not.toEqual([posAvant[0] + 1, 0, posAvant[2]]);
    expect(types(s.recevoir("b", { t: "tir", arme: "pistolet", o: [0, 0, 0], d: [[0, 0, -1]], touches: [] }, t + 10_100))).toEqual([]);
  });

  it("le dernier joueur debout tombe : partie perdue, bilan, retour au lobby 25 s plus tard avec tout le monde sorti de l'arène", () => {
    const s = partie(["a"]);
    const t = T0 + 3000;
    avancer(s, T0 + 50, t - 50);
    const sorties = s.infliger(j(s, "a"), 1000, null, "tigre_zombie", "corps", "couteau", t);
    expect(dernierEtat(sorties)).toMatchObject({ phase: "fin", bilan: { manche: 1 } });
    const lobby = avancer(s, t + 100, t + ZOMBIES.finAffichageMs + 100, 500);
    expect(dernierEtat(lobby)).toMatchObject({ phase: "lobby" });
    expect(j(s, "a").enJeu).toBe(false);
    expect(s.nombreEnJeu()).toBe(0);
    expect(types(lobby)).toContain("presence");
    // on peut relancer et rejoindre
    expect(dernierEtat(s.recevoir("a", { t: "lancerPartie" }, t + 30_000))!.phase).toBe("pause");
    expect(types(s.recevoir("a", { t: "rejoindre" }, t + 30_100))).toContain("apparition");
  });

  it("Quitter : le joueur repasse en attente (pas de réentrée différée), `rejoindre` refusé jusqu'à la pause ; défaite s'il était le dernier", () => {
    const s = partie(["a", "b"]);
    const sorties = s.recevoir("a", { t: "quitter" }, T0 + 1000);
    expect(j(s, "a").enJeu).toBe(false);
    expect(dernierEtat(sorties)!.joueurs.find((x) => x.id === "a")).toMatchObject({ etat: "attente", admis: false });
    expect(j(s, "a").reentreeT).toBe(-Infinity);
    expect(s.recevoir("a", { t: "rejoindre" }, T0 + 1100)).toEqual([{ a: "a", m: { t: "refus", action: "rejoindre", raison: "lobby" } }]);
    expect(dernierEtat(s.recevoir("b", { t: "quitter" }, T0 + 1200))!.phase).toBe("fin");
  });

  it("(v8) inactivité de 20 s (onglet caché, coupure en reprise) : le joueur reste dans la partie, immobile (pas d'éviction en zombies)", () => {
    const s = partie(["a", "b"]);
    // « a » envoie des états, « b » se tait
    let seq = 0;
    const sorties: Sortie[] = [];
    for (let t = T0 + 50; t <= T0 + INACTIF_MS + 500; t += 50) {
      s.recevoir("a", { t: "etat", seq: ++seq, p: j(s, "a").p, v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 }, t);
      sorties.push(...s.tic(t));
    }
    expect(j(s, "b").enJeu).toBe(true);
    expect(messages(sorties, "zombies").some((m) => m.etat.joueurs.find((x) => x.id === "b")?.etat === "attente")).toBe(false);
    expect(j(s, "a").enJeu).toBe(true);
    expect(s.resumeZombies()!.phase).not.toBe("fin");
  });

  it("(v8) reprendre : `bienvenue{reprise}` au même id, état de la partie, argent et `apparition{garder}` sans rien déplacer", () => {
    const s = partie(["a", "b"], { argentDepart: 800 });
    avancer(s, T0 + 50, T0 + 1500);
    const a = j(s, "a");
    const avant = { p: [...a.p], seq: a.seq, pv: a.pv };
    const sorties = s.reprendre("a", T0 + 1600);
    expect(sorties.every((x) => x.a === "a")).toBe(true);
    expect(types(sorties)).toEqual(["bienvenue", "zombies", "batiments", "argent", "apparition"]);
    expect(messages(sorties, "bienvenue")[0]).toMatchObject({ id: "a", reprise: true });
    expect(messages(sorties, "argent")[0]).toMatchObject({ solde: 800, delta: 0 });
    expect(messages(sorties, "apparition")[0]).toMatchObject({ garder: true, p: avant.p, pv: avant.pv });
    expect({ p: a.p, seq: a.seq, pv: a.pv }).toEqual(avant);
    // à terre : pas d'apparition (l'état de la partie le dit)
    s.infliger(a, 1000, null, "tigre_zombie", "corps", "couteau", T0 + 1700);
    expect(types(s.reprendre("a", T0 + 1800))).not.toContain("apparition");
    expect(s.reprendre("inconnu", T0 + 1800)).toEqual([]);
  });

  it("(v8) reprendre avec le pseudo du `bonjour` : un renommage fait pendant la coupure est appliqué et diffusé à toute la salle", () => {
    const s = partie(["a", "b"]);
    avancer(s, T0 + 50, T0 + 1500);
    const sorties = s.reprendre("a", T0 + 1600, "Nouveau");
    expect(j(s, "a").pseudo).toBe("Nouveau");
    expect(messages(sorties, "bienvenue")[0].joueurs.find((x) => x.id === "a")?.pseudo).toBe("Nouveau");
    const presence = sorties.find((x) => x.m.t === "presence");
    expect(presence?.a).toBe("tous");
    // même pseudo : rien de plus que la reprise
    expect(types(s.reprendre("a", T0 + 1700, "Nouveau"))).not.toContain("presence");
  });

  it("déconnexion : la liste et l'hôte sont à jour, la partie continue pour les autres", () => {
    const s = partie(["a", "b", "c"]);
    const sorties = s.deconnecter("a", T0 + 1000);
    const etat = dernierEtat(sorties)!;
    expect(etat.hote).toBe("b");
    expect(etat.joueurs.map((x) => x.id)).toEqual(["b", "c"]);
    expect(etat.phase).toBe("pause");
    expect(types(sorties)).toContain("presence");
    // le dernier membre parti : la salle est remise à blanc (lobby)
    s.deconnecter("b", T0 + 1100); s.deconnecter("c", T0 + 1200);
    expect(s.resumeZombies()).toEqual({ phase: "lobby", joueurs: 0, manche: 0 });
  });

  it("une griffe passe par `infliger` : cause `tigre_zombie`, `degats` sans tueur", () => {
    const s = partie(["a"], { degatsGriffe: 30, total1: 3 });
    const a = j(s, "a");
    a.p = [114, 0, -72]; // juste derrière l'entrée N2c : les tigres arrivent tout de suite
    let griffes = 0;
    for (let t = T0 + 50; t <= T0 + 15_000 && griffes === 0; t += 50) {
      a.etatT = t;
      a.protegeJusqua = 0;
      for (const m of messages(s.tic(t), "degats")) if (m.cible === "a") { griffes++; expect(m).toMatchObject({ par: "", degats: 30 }); }
    }
    expect(griffes).toBeGreaterThan(0);
    expect(a.pv).toBeLessThanOrEqual(70);
  });
});

// ---------------------------------------------------------------------------------------------
describe("barricades par la salle", () => {
  it("(v8) `reparer` passe par `Salle.recevoir` : les planches arrachées sont reposées, `zevt{planche}` et 10 $ chacune", () => {
    const s = partie(["a"], { total1: 40 });
    const a = j(s, "a");
    const f = FENETRES.find((x) => x.id === "F1")!;
    const i = FENETRES.indexOf(f);
    a.p = [f.dedans[0], 0, f.dedans[1]];
    a.pv = 1e9;
    let t = T0 + 50;
    let etat = dernierEtat(avancer(s, t, t));
    // les tigres arrachent des planches de F1
    for (; t < T0 + 180_000 && (etat?.fenetres[i] ?? 6) > 3; t += 50) {
      a.etatT = t;
      etat = dernierEtat(s.tic(t)) ?? etat;
    }
    expect(etat!.fenetres[i]).toBeLessThanOrEqual(3);
    // E maintenue devant la fenêtre : le message part par la salle (il manquait à l'aiguillage)
    a.p = [f.dedans[0], 0, f.dedans[1]];
    expect(s.recevoir("a", { t: "reparer", fenetre: "F1" }, t)).toEqual([]);
    const sorties = avancer(s, t + 50, t + 1_500);
    const reposees = messages(sorties, "zevt").filter((m) => m.e.e === "planche" && m.e.fenetre === "F1" && !m.e.arrachee);
    expect(reposees.length).toBeGreaterThanOrEqual(1);
    expect(messages(sorties, "argent").some((m) => m.motif === "planche" && m.delta === 10)).toBe(true);
    // E lâchée : plus rien
    s.recevoir("a", { t: "reparer", fenetre: null }, t + 1_550);
    const apres = avancer(s, t + 1_600, t + 3_500);
    expect(messages(apres, "zevt").filter((m) => m.e.e === "planche" && !m.e.arrachee)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe("snaps", () => {
  it("les joueurs en jeu reçoivent `snap.zombies` ({ r, z } entiers) ; le lobby (spectateurs) ne reçoit aucun snap", () => {
    const s = salleZ({ pauseMs: 1000, degatsGriffe: 0, total1: 4 });
    s.connecter("a", "Alice", T0);
    s.recevoir("a", { t: "lancerPartie" }, T0);
    s.recevoir("a", { t: "rejoindre" }, T0);
    s.connecter("b", "Bob", T0); // arrive en cours de partie : lobby
    const sorties = avancer(s, T0 + 50, T0 + 5000);
    const snaps = sorties.filter((x) => x.m.t === "snap");
    expect(snaps.length).toBeGreaterThan(50);
    expect(snaps.every((x) => x.a === "joueurs")).toBe(true);
    const avecTigre = messages(snaps, "snap").filter((m) => m.zombies && m.zombies.z.length > 0);
    expect(avecTigre.length).toBeGreaterThan(0);
    const z = avecTigre.at(-1)!.zombies!;
    expect(z.r).toBeGreaterThan(0);
    expect(z.z.length % 6).toBe(0);
    expect(z.z.every((n) => Number.isInteger(n))).toBe(true);
    expect(sorties.some((x) => x.a === "spectateurs")).toBe(false);
  });

  it("l'arène (sans option zombies) ne change pas : pas de champ `zombies` dans ses snaps, phase de match inchangée", () => {
    const s = new Salle(construireMondeZombies(scene), DEPARTS.map((d) => [d[0], d[1]] as [number, number]), suite(), T0);
    s.connecter("a", "Alice", T0);
    s.recevoir("a", { t: "rejoindre", arme: "pistolet" } as MessageClient, T0);
    const sorties = avancer(s, T0 + 50, T0 + 500);
    expect(messages(sorties, "snap").every((m) => m.zombies === undefined)).toBe(true);
    expect(s.resumeZombies()).toBeNull();
    expect(s.infoMatch()).toMatchObject({ objectif: JEU.objectifKills, fin: T0 + JEU.dureeMatchMs });
  });
});

// ---------------------------------------------------------------------------------------------
describe("réseau : budget de distance, acceptation partielle", () => {
  /** Unité de direction vers le centre des bornes (place pour courir sans sortir de la carte). */
  function versCentre(s: Salle, p: Vec3): [number, number] {
    const b = s.monde.bornes;
    const dx = (b.x0 + b.x1) / 2 - p[0], dz = (b.z0 + b.z1) / 2 - p[2], l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }
  const etatA = (seq: number, p: Vec3): MessageClient => ({ t: "etat", seq, p, v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 });

  it("paquets regroupés : 20 états à 10 images/s et 18 m/s par paquets de 6, tous acceptés en entier", () => {
    const s = partie(["a"]);
    const depart = [...j(s, "a").p] as Vec3;
    const [ux, uz] = versCentre(s, depart);
    const t0 = T0 + 2000;
    let entiers = 0;
    for (let k = 0; k < 20; k += 6) {
      const t = t0 + (k + 6) * 100;
      for (let q = k; q < Math.min(20, k + 6); q++) {
        const d = 1.8 * (q + 1);
        const p: Vec3 = [depart[0] + ux * d, 0, depart[2] + uz * d];
        s.recevoir("a", etatA(q + 1, p), t);
        if (Math.hypot(j(s, "a").p[0] - p[0], j(s, "a").p[2] - p[2]) < 1e-9) entiers++;
      }
    }
    expect(entiers).toBe(20);
  });

  it("après une coupure de 3 s (37 m courus), la position serveur avance aussitôt de son budget puis rattrape le client, sans jamais rester figée", () => {
    const s = partie(["a"]);
    const depart = [...j(s, "a").p] as Vec3;
    const [ux, uz] = versCentre(s, depart);
    const t0 = T0 + 2000;
    s.recevoir("a", etatA(1, depart), t0);
    // 3 s sans aucun état reçu, le client a couru 37 m : le premier état après la coupure est accepté en partie
    const loin: Vec3 = [depart[0] + ux * 37, 0, depart[2] + uz * 37];
    s.recevoir("a", etatA(2, loin), t0 + 3000);
    const d1 = Math.hypot(j(s, "a").p[0] - depart[0], j(s, "a").p[2] - depart[2]);
    expect(d1).toBeGreaterThan(19);
    expect(d1).toBeLessThan(37);
    // il reste immobile ensuite : la position serveur le rejoint en moins d'une seconde
    let seq = 2;
    for (let t = t0 + 3033; t <= t0 + 4000; t += 33) s.recevoir("a", etatA(++seq, loin), t);
    expect(Math.hypot(j(s, "a").p[0] - loin[0], j(s, "a").p[2] - loin[2])).toBeLessThan(1e-6);
  });

  it("après une apparition (téléportation), un état encore en vol depuis l'ancienne position n'est pas accepté, même en partie", () => {
    const s = partie(["a", "b"]);
    const ancien = [...j(s, "a").p] as Vec3;
    s.placerJoueur(j(s, "a"), [ancien[0] + 30, 0, ancien[2]], 0, { pv: 100, equip: j(s, "a").equip, main: "secondaire" }, T0 + 3000);
    const nouveau = [...j(s, "a").p];
    s.recevoir("a", etatA(50, ancien), T0 + 3500);
    expect(j(s, "a").p).toEqual(nouveau);
    // le client a appliqué l'apparition : ses états sont acceptés, et de nouveau en partie ensuite
    s.recevoir("a", etatA(51, [nouveau[0] + 0.3, 0, nouveau[2]]), T0 + 3600);
    expect(j(s, "a").p[0]).toBeCloseTo(nouveau[0] + 0.3, 6);
    s.recevoir("a", etatA(52, [nouveau[0] - 40, 0, nouveau[2]]), T0 + 3650);
    expect(j(s, "a").p[0]).toBeLessThan(nouveau[0]);
  });
});

describe("réseau : relève sans téléportation", () => {
  it("à terre, le corps suit les états du client ; la relève envoie `apparition{garder}` à cette position, sans toucher ni `p` ni `seq`", () => {
    const s = partie(["a", "b"]);
    const t = T0 + 2000;
    avancer(s, T0 + 50, t - 50);
    const b = j(s, "b");
    const chute = [...b.p] as Vec3;
    s.infliger(b, 1000, null, "tigre_zombie", "corps", "couteau", t);
    // le client de « b » glisse encore de 0,6 m puis s'immobilise (états à terre suivis)
    const corps: Vec3 = [chute[0] + 0.6, 0, chute[2]];
    s.recevoir("b", { t: "etat", seq: 40, p: corps, v: [0, 0, 0], lacet: 1.2, tangage: 0, posture: "sol", mur: 0 }, t + 100);
    expect(b.p).toEqual(corps);
    // « a » le relève (E maintenu 3 s à moins de 2,5 m)
    j(s, "a").p = [corps[0] + 1, 0, corps[2]];
    s.recevoir("a", { t: "reanimer", cible: "b" }, t + 200);
    const sorties = avancer(s, t + 250, t + 200 + ZOMBIES.reanimationS * 1000 + 100);
    const app = messages(sorties, "apparition").find((m) => m.id === "b")!;
    expect(app).toMatchObject({ garder: true, p: corps, pv: ZOMBIES.reanimationPv });
    expect(b).toMatchObject({ vivant: true, seq: 40, p: corps });
    // l'état suivant du client (seq 41) est accepté contre la même référence
    s.recevoir("b", { t: "etat", seq: 41, p: [corps[0] + 0.2, 0, corps[2]], v: [0, 0, 0], lacet: 1.2, tangage: 0, posture: "sol", mur: 0 }, t + 3400);
    expect(b.p[0]).toBeCloseTo(corps[0] + 0.2, 6);
  });

  it("une vraie apparition (retour d'un éliminé, entrée) téléporte toujours : pas de `garder`", () => {
    const s = salleZ({ pauseMs: 1000 });
    s.connecter("a", "Alice", T0);
    s.recevoir("a", { t: "lancerPartie" }, T0);
    const app = messages(s.recevoir("a", { t: "rejoindre" }, T0), "apparition")[0];
    expect(app.garder).toBeUndefined();
  });
});
