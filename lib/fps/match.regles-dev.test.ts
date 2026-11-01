import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import { optionsDepuisReglages } from "./evenements-arene";
import { Salle, type JoueurSalle, type OptionsSalle, type Sortie } from "./match";
import { cheminPourPolice } from "./match-police";
import type { OptionsServiceZombies } from "./match-zombies";
import { JEU, type MessageClient, type MessageServeur } from "./protocole";
import { normaliserReglages, type ReglagesArene } from "./reglages-arene";
import { INTERVALLE_DEV_MS, REGLES_DEV_DEFAUT } from "./regles-dev";
import { DEPARTS, construireMondeZombies } from "./zombies-carte";

/**
 * Intégration du menu de développement : une vraie `Salle` reçoit `reglesDev`, valide, applique et diffuse. Les règles pures sont dans regles-dev.test.ts.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 10, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
const vide = () => construireMonde({ ...scene, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000)], pois: [] } as SceneData);
const APPARITIONS: Vec2[] = [[-300, -300], [300, 300], [-300, 300], [300, -300]];
const ROUTE: Vec2[] = [];
for (let x = -600; x <= 600; x += 20) ROUTE.push([x, 0]);
const T0 = 3_000_000;
const PAS = 1000 / 60;

const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
const dev = (s: Salle, id: string, m: Omit<Extract<MessageClient, { t: "reglesDev" }>, "t">, t: number): Sortie[] => s.recevoir(id, { t: "reglesDev", ...m }, t);
const etatDev = (sorties: Sortie[]) => messages(sorties, "reglesDev").at(-1);
const refusDe = (sorties: Sortie[]) => messages(sorties, "refus").at(-1);
function avancer(s: Salle, de: number, a: number): { sorties: Sortie[]; t: number } {
  const sorties: Sortie[] = [];
  let t = de;
  while (t < a) {
    t = Math.min(a, t + PAS);
    for (const x of s.joueurs()) if (x.enJeu) x.etatT = t;
    sorties.push(...s.tic(t));
  }
  return { sorties, t };
}

/** Options d'une arène complète, reconstructibles par `refaireOptions` comme le fait le serveur. */
function arene(reglages: ReglagesArene, plus: Partial<OptionsSalle> = {}): OptionsSalle {
  const monde = vide();
  const base: OptionsSalle = {
    evenements: { truck: { x: -60, z: 0 }, centre: { x: 0, z: 0 }, rayonApparition: 60 },
    elsa: { x: 0, z: 0 }, bus: {}, police: { points: ROUTE, chemin: cheminPourPolice(monde) },
  };
  return { ...optionsDepuisReglages(reglages, base), refaireOptions: (r) => optionsDepuisReglages(r, base), ...plus };
}
const TOUS = normaliserReglages({});
function salleArene(plus: Partial<OptionsSalle> = {}, ids = ["a", "b"], reglages: ReglagesArene = TOUS): Salle {
  const s = new Salle(vide(), APPARITIONS, () => 0.5, T0, arene(reglages, plus));
  for (const id of ids) {
    s.connecter(id, `Agent${id}`, T0);
    s.recevoir(id, { t: "rejoindre", principale: "sniper", secondaire: "pistolet" }, T0);
  }
  return s;
}
const service = (s: Salle, nom: string) => (s as unknown as Record<string, unknown>)[nom];

describe("qui peut régler", () => {
  it("partie créée : seul le premier humain arrivé (l'hôte) ; les autres reçoivent refus{reglesDev, hote}", () => {
    const s = salleArene();
    expect(refusDe(dev(s, "b", { regles: { gravite: 0.5 } }, T0 + 1000))).toMatchObject({ action: "reglesDev", raison: "hote" });
    expect(s.reglesDev().gravite).toBe(1);
    expect(etatDev(dev(s, "a", { regles: { gravite: 0.5 } }, T0 + 1000))).toMatchObject({ hote: "a", regles: { gravite: 0.5 } });
    expect(s.reglesDev().gravite).toBe(0.5);
  });

  it("hall partagé (`devLibre`) : tout joueur en jeu, `hote` vaut « * »", () => {
    const s = salleArene({ devLibre: true });
    const m = etatDev(dev(s, "b", { regles: { degats: 2 } }, T0 + 1000));
    expect(m).toMatchObject({ hote: "*", regles: { degats: 2 } });
  });

  it("hall partagé : un membre qui n'est pas en jeu est refusé (lobby)", () => {
    const s = salleArene({ devLibre: true }, ["a"]);
    s.connecter("c", "Curieux", T0);
    expect(refusDe(dev(s, "c", { regles: { degats: 2 } }, T0 + 1000))).toMatchObject({ raison: "lobby" });
  });

  it("le seul message vide (pas de patch, pas d'action) renvoie l'état à tout membre, hôte ou non", () => {
    const s = salleArene();
    const r = dev(s, "b", {}, T0 + 1000);
    expect(r).toHaveLength(1);
    expect(r[0].a).toBe("b");
    expect(etatDev(r)).toMatchObject({ hote: "a", regles: REGLES_DEV_DEFAUT });
  });

  it("anti-rafale : deux messages à moins de INTERVALLE_DEV_MS, le second est refusé (limite)", () => {
    const s = salleArene();
    dev(s, "a", { regles: { degats: 2 } }, T0 + 1000);
    expect(refusDe(dev(s, "a", { regles: { degats: 3 } }, T0 + 1000 + INTERVALLE_DEV_MS - 1))).toMatchObject({ raison: "limite" });
    expect(s.reglesDev().degats).toBe(2);
    expect(etatDev(dev(s, "a", { regles: { degats: 3 } }, T0 + 1000 + INTERVALLE_DEV_MS))?.regles.degats).toBe(3);
  });

  it("validation : valeurs hors bornes ramenées, clés inconnues ignorées, action inconnue refusée sans rien changer", () => {
    const s = salleArene();
    dev(s, "a", { regles: { gravite: 99, vitesse: -1, pirate: 1 } as never }, T0 + 1000);
    expect(s.reglesDev()).toMatchObject({ gravite: 2, vitesse: 0.5 });
    expect(refusDe(dev(s, "a", { regles: { degats: 4 }, action: { k: "tuerTout" } as never }, T0 + 2000))).toMatchObject({ raison: "invalide" });
    expect(s.reglesDev().degats).toBe(1);
  });
});

describe("diffusion et annonce", () => {
  it("un changement part à toute la salle avec l'auteur et l'annonce ; sans changement, l'état revient au seul demandeur", () => {
    const s = salleArene();
    const r = dev(s, "a", { regles: { gravite: 0.5, munitionsInfinies: true } }, T0 + 1000);
    const m = messages(r, "reglesDev")[0];
    expect(r.find((x) => x.m === m)!.a).toBe("tous");
    expect(m).toMatchObject({ par: "Agenta", annonce: "Agenta : gravité ×0,5, munitions infinies", hote: "a" });
    const encore = dev(s, "a", { regles: { gravite: 0.5 } }, T0 + 2000);
    expect(encore).toHaveLength(1);
    expect(encore[0].a).toBe("a");
    expect(messages(encore, "reglesDev")[0].annonce).toBeUndefined();
  });

  it("l'état publié porte les réglages d'événements de l'arène", () => {
    const s = salleArene();
    expect(etatDev(dev(s, "a", {}, T0 + 1000))?.evenements).toEqual({ evenements: ["elsa", "avion", "bus", "truck", "tigre", "police"], frequence: "normal" });
  });
});

describe("effets des règles sur la salle", () => {
  it("dégâts : ×2 sur les dégâts d'arme, pas sur un écrasement", () => {
    const s = salleArene();
    const [a, b] = [j(s, "a"), j(s, "b")];
    a.protegeJusqua = 0; b.protegeJusqua = 0;
    s.infliger(b, 20, a, "arme", "corps", "pistolet", T0 + 100);
    expect(b.pv + b.bouclier).toBe(JEU.pvMax - 20);
    dev(s, "a", { regles: { degats: 2 } }, T0 + 1000);
    s.infliger(b, 20, a, "arme", "corps", "pistolet", T0 + 1100);
    expect(b.pv + b.bouclier).toBe(JEU.pvMax - 20 - 40);
  });

  it("régénération : sans elle les PV ne reviennent pas", () => {
    for (const regeneration of [true, false]) {
      const s = salleArene();
      const b = j(s, "b");
      b.pv = 40;
      b.dernierDegatT = T0 - 60_000;
      b.regenAcc = 0;
      if (!regeneration) dev(s, "a", { regles: { regeneration: false } }, T0 + 500);
      avancer(s, T0 + 500, T0 + 8000);
      if (regeneration) expect(b.pv).toBeGreaterThan(40);
      else expect(b.pv).toBe(40);
    }
  });

  it("réapparition : le délai du message `mort` suit la règle", () => {
    const s = salleArene();
    const [a, b] = [j(s, "a"), j(s, "b")];
    a.protegeJusqua = 0; b.protegeJusqua = 0;
    dev(s, "a", { regles: { reapparitionMs: 1500 } }, T0 + 500);
    const sorties = s.infliger(b, 500, a, "arme", "corps", "pistolet", T0 + 1000);
    expect(messages(sorties, "mort")[0].delai).toBe(1500);
    expect(b.reapparitionT).toBe(T0 + 1000 + 1500);
  });

  it("vitesse : le budget de distance des états suit le multiplicateur (le mouvement est autoritaire côté client)", () => {
    const etatApres = (vitesse: number): number => {
      const s = salleArene({}, ["a"]);
      if (vitesse !== 1) dev(s, "a", { regles: { vitesse } }, T0 + 10);
      const a = j(s, "a");
      const p0 = [...a.p] as [number, number, number];
      const t = T0 + 600;
      s.recevoir("a", { t: "etat", seq: 1, p: [p0[0] + 15, p0[1], p0[2]], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 }, t);
      return Math.hypot(a.p[0] - p0[0], a.p[2] - p0[2]);
    };
    expect(etatApres(1)).toBeLessThan(1);
    expect(etatApres(2)).toBeCloseTo(15, 5);
  });

  it("munitions infinies : l'arme spéciale ne se décompte plus", () => {
    const s = salleArene();
    const a = j(s, "a");
    a.equip.speciale = "railgun";
    a.munSpeciale = 2;
    const consommer = (s as unknown as { consommerSpeciale(j: JoueurSalle, t: number): Sortie[] }).consommerSpeciale.bind(s);
    dev(s, "a", { regles: { munitionsInfinies: true } }, T0 + 500);
    consommer(a, T0 + 600); consommer(a, T0 + 700); consommer(a, T0 + 800);
    expect(a.munSpeciale).toBe(2);
    expect(a.equip.speciale).toBe("railgun");
    dev(s, "a", { regles: { munitionsInfinies: false } }, T0 + 1000);
    consommer(a, T0 + 1100);
    expect(a.munSpeciale).toBe(1);
  });
});

describe("événements de l'arène en direct", () => {
  it("décocher la police retire le service, la reconstruction publie les nouveaux réglages et annonce « sans la police »", () => {
    const s = salleArene();
    expect(service(s, "police")).toBeTruthy();
    const r = dev(s, "a", { evenements: { evenements: ["elsa", "avion", "bus", "truck", "tigre"] } }, T0 + 1000);
    expect(service(s, "police")).toBeNull();
    expect(service(s, "evenements")).toBeTruthy();
    expect(s.reglages!.evenements).not.toContain("police");
    const m = messages(r, "reglesDev")[0];
    expect(m.evenements!.evenements).not.toContain("police");
    expect(m.annonce).toBe("Agenta : sans la police");
  });

  it("changer la fréquence reconstruit aussi (les minuteurs repartent) ; un message identique ne reconstruit rien", () => {
    const s = salleArene();
    const avant = service(s, "elsa");
    const r1 = dev(s, "a", { evenements: { frequence: "chaos" } }, T0 + 1000);
    expect(s.reglages!.frequence).toBe("chaos");
    expect(service(s, "elsa")).not.toBe(avant);
    expect(messages(r1, "reglesDev")[0].annonce).toBe("Agenta : événements chaos");
    const milieu = service(s, "elsa");
    dev(s, "a", { evenements: { frequence: "chaos" } }, T0 + 2000);
    expect(service(s, "elsa")).toBe(milieu);
  });

  it("tout décocher : plus aucun service d'événement", () => {
    const s = salleArene();
    dev(s, "a", { evenements: { evenements: [] } }, T0 + 1000);
    for (const nom of ["elsa", "tigres", "evenements", "police", "busC3"]) expect(service(s, nom), nom).toBeNull();
  });

  it("sans `refaireOptions`, les événements ne se changent pas en direct (les règles, si)", () => {
    const s = salleArene({ refaireOptions: undefined });
    dev(s, "a", { evenements: { evenements: [] }, regles: { degats: 2 } }, T0 + 1000);
    expect(service(s, "police")).toBeTruthy();
    expect(s.reglesDev().degats).toBe(2);
  });

  it("forcer un événement : le minuteur est avancé, il démarre au tic suivant ; refus si le service n'existe pas", () => {
    const s = salleArene({}, ["a", "b"], normaliserReglages({ evenements: ["truck", "police"] }));
    const r = dev(s, "a", { action: { k: "forcer", evenement: "truck" } }, T0 + 1000);
    expect(messages(r, "reglesDev")[0].annonce).toBe("Agenta : événement forcé : le Truck Muche fou");
    const { sorties } = avancer(s, T0 + 1000, T0 + 2000);
    expect(messages(sorties, "evenement").some((e) => e.type === "truck" && e.phase === "annonce")).toBe(true);
    // pas d'Elsa dans cette arène
    expect(refusDe(dev(s, "a", { action: { k: "forcer", evenement: "elsa" } }, T0 + 3000))).toMatchObject({ raison: "invalide" });
  });

  it("forcer la police avance son essai de départ", () => {
    const s = salleArene({}, ["a", "b"], normaliserReglages({ evenements: ["police"] }));
    const r = dev(s, "a", { action: { k: "forcer", evenement: "police" } }, T0 + 1000);
    expect(messages(r, "reglesDev")[0].annonce).toContain("la police");
  });

  it("une action hors du mode (argent en arène) est refusée « mode »", () => {
    const s = salleArene();
    expect(refusDe(dev(s, "a", { action: { k: "argent", montant: 500 } }, T0 + 1000))).toMatchObject({ raison: "mode" });
  });
});

describe("retour aux valeurs par défaut", () => {
  it("reinitialiser : règles ET réglages d'événements d'origine", () => {
    const s = salleArene();
    dev(s, "a", { regles: { degats: 3, gravite: 0.25 }, evenements: { evenements: ["elsa"], frequence: "calme" } }, T0 + 1000);
    expect(service(s, "police")).toBeNull();
    const r = dev(s, "a", { action: { k: "reinitialiser" } }, T0 + 2000);
    expect(s.reglesDev()).toEqual(REGLES_DEV_DEFAUT);
    expect(s.reglages).toEqual(TOUS);
    expect(service(s, "police")).toBeTruthy();
    expect(messages(r, "reglesDev")[0].annonce).toMatch(/^Agenta : dégâts ×1, gravité ×1/);
  });

  it("nouveau match : règles et événements d'origine, annoncés", () => {
    const s = salleArene();
    dev(s, "a", { regles: { degats: 3 }, evenements: { frequence: "chaos" } }, T0 + 1000);
    const fin = T0 + JEU.dureeMatchMs + 1000;
    // fin du match puis entracte puis nouveau match
    s.tic(fin);
    const { sorties } = avancer(s, fin, fin + JEU.entracteMs + 1000);
    expect(s.reglesDev()).toEqual(REGLES_DEV_DEFAUT);
    expect(s.reglages!.frequence).toBe("normal");
    expect(messages(sorties, "reglesDev").some((m) => m.annonce === "Nouveau match : règles par défaut")).toBe(true);
  });

  it("partie vide : règles par défaut, rien d'annoncé à personne de plus", () => {
    const s = salleArene({}, ["a"]);
    dev(s, "a", { regles: { degats: 3 } }, T0 + 1000);
    s.deconnecter("a", T0 + 2000);
    expect(s.reglesDev()).toEqual(REGLES_DEV_DEFAUT);
  });

  it("sans rien à réinitialiser, aucun message (le départ de l'hôte reste silencieux)", () => {
    const s = salleArene();
    const r = s.deconnecter("a", T0 + 2000);
    expect(messages(r, "reglesDev")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe("zombies", () => {
  function suite(graine = 3): () => number {
    let k = graine;
    return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
  }
  function partieZ(ids: string[], zombies: Partial<OptionsServiceZombies> = {}): Salle {
    const s = new Salle(construireMondeZombies(scene), DEPARTS.map((d) => [d[0], d[1]] as [number, number]), suite(), T0, { zombies: { pauseMs: 1000, degatsGriffe: 0, ...zombies } });
    ids.forEach((id) => s.connecter(id, `Agent ${id}`, T0));
    s.recevoir(ids[0], { t: "lancerPartie" }, T0);
    ids.forEach((id) => s.recevoir(id, { t: "rejoindre" }, T0));
    return s;
  }

  it("seul l'hôte règle ; ni régénération ni réapparition en zombies (ramenées à leurs valeurs)", () => {
    const s = partieZ(["a", "b"]);
    expect(refusDe(dev(s, "b", { regles: { degats: 2 } }, T0 + 100))).toMatchObject({ raison: "hote" });
    dev(s, "a", { regles: { degats: 2, regeneration: false, reapparitionMs: 1000 } }, T0 + 100);
    expect(s.reglesDev()).toEqual({ ...REGLES_DEV_DEFAUT, degats: 2 });
  });

  it("argent : chaque joueur admis reçoit le montant, sans toucher au seuil de bonus", () => {
    const s = partieZ(["a", "b"]);
    const r = dev(s, "a", { action: { k: "argent", montant: 2500 } }, T0 + 100);
    const gains = messages(r.filter((x) => x.a === "a" || x.a === "b"), "argent");
    expect(gains).toHaveLength(2);
    for (const g of gains) expect(g).toMatchObject({ delta: 2500, motif: "dev" });
    expect(messages(r, "reglesDev")[0].annonce).toBe("Agent a : +2500 $ pour tous");
  });

  it("courant : rétabli une seule fois ; bonus aux pieds de l'auteur en manche seulement ; passer la manche efface les tigres", () => {
    const s = partieZ(["a"], { total1: 3 } as never);
    // pause avant la manche 1 : le courant se rétablit, pas de bonus
    expect(messages(dev(s, "a", { action: { k: "courant" } }, T0 + 100), "reglesDev")[0].annonce).toBe("Agent a : courant rétabli");
    expect(refusDe(dev(s, "a", { action: { k: "courant" } }, T0 + 600))).toMatchObject({ raison: "invalide" });
    expect(refusDe(dev(s, "a", { action: { k: "bonus", genre: "nuke" } }, T0 + 1000))).toMatchObject({ raison: "invalide" });
    avancer(s, T0 + 1000, T0 + 6000);
    expect(s.resumeZombies()!.phase).toBe("manche");
    const bonus = dev(s, "a", { action: { k: "bonus", genre: "munitions" } }, T0 + 6200);
    expect(messages(bonus, "zevt").some((z) => z.e.e === "bonusLache")).toBe(true);
    const passee = dev(s, "a", { action: { k: "passerManche" } }, T0 + 6800);
    expect(messages(passee, "reglesDev")[0].annonce).toBe("Agent a : manche passée");
    const { sorties } = avancer(s, T0 + 6800, T0 + 9000);
    expect(messages(sorties, "zombies").some((m) => m.etat.phase === "pause" && m.etat.manche === 2)).toBe(true);
  });

  it("retour au lobby de la partie : règles par défaut", () => {
    const s = partieZ(["a"]);
    dev(s, "a", { regles: { degats: 3 } }, T0 + 100);
    avancer(s, T0 + 100, T0 + 3000);
    expect(s.reglesDev().degats).toBe(3);
    // la salle repasse au lobby (défaite : le dernier joueur debout quitte la partie)
    s.recevoir("a", { t: "quitter" }, T0 + 3100);
    const { sorties } = avancer(s, T0 + 3100, T0 + 3300);
    expect(s.reglesDev()).toEqual(REGLES_DEV_DEFAUT);
    expect(messages(sorties, "reglesDev").some((m) => m.annonce === "Retour au lobby : règles par défaut")).toBe(true);
  });
});
