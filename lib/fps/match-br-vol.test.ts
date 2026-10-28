import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aleaGraine } from "../agroparc3d/cachettes";
import type { Building, SceneData } from "../agroparc3d/types";
import { CHUTE_BR, capAvionBr, etatChuteInitial, pasChute, pasDuTemps, positionAvionBr, vitesseAvionBr, type EntreesChute } from "./br-chute";
import { BR } from "./br-regles";
import { construireMonde, type Boite, type Monde } from "./collision";
import { armeDuSlot } from "./equipement";
import type { ContexteSalle, JoueurSalle, Sortie, VolBr } from "./match-contexte";
import { creerVolBr } from "./match-br-vol";
import { EQUIPEMENT_DEFAUT, JEU, copierEquipement, type MessageClient, type MessageServeur } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const T0 = 1_000_000;
const BORNES: Boite = { x0: -348.8, z0: -257.9, x1: 392.4, z1: 233.7 };

function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
/** Monde jouet : sol plat et deux bâtiments minuscules qui donnent les bornes de la carte BR. */
const MONDE: Monde = construireMonde({ ...scene, buildings: [rect(-323.9, -233, -323.7, -232.8, 3), rect(367.3, 208.6, 367.5, 208.8, 3)], pois: [] });

function nouveauJoueur(id: string, t = T0): JoueurSalle {
  return {
    id, pseudo: `Agent ${id}`, couleur: "#ff5252", enJeu: true, kills: 0, morts: 0, ping: 0,
    p: [0, 0, 0], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0,
    arme: "pistolet", armeSuivante: "pistolet", pv: JEU.pvMax, vivant: false,
    protegeJusqua: 0, reapparitionT: null, reentreeT: -Infinity, seq: 7, etatT: t, histo: [], prochainTir: -Infinity, renommages: [],
    equip: copierEquipement(EQUIPEMENT_DEFAUT), main: "secondaire", mainSuivante: "secondaire", munSpeciale: 0,
    sortieJusqua: -Infinity, cadenceArme: {}, bouclier: 0, dernierDegatT: t, regenAcc: 0, accroupi: false, glisse: false, memoSante: null,
    tirs: 0, touches: 0, tetes: 0, degats: 0, serie: 0, serieMax: 0, killsParArme: {},
    scoresOuvert: false, scoresDemandeT: -Infinity, scoresEnvoyeT: -Infinity,
  };
}

interface Banc { vol: VolBr; table: Map<string, JoueurSalle>; placements: { id: string; prive?: boolean }[]; j: (id: string) => JoueurSalle }

function banc(...ids: string[]): Banc {
  const table = new Map<string, JoueurSalle>(ids.map((id) => [id, nouveauJoueur(id)]));
  const placements: { id: string; prive?: boolean }[] = [];
  const partiel: Pick<ContexteSalle, "monde" | "alea" | "joueur" | "placerJoueur"> = {
    monde: MONDE,
    alea: aleaGraine(3),
    joueur: (id: string) => table.get(id),
    placerJoueur: (j, p, lacet, o, t) => {
      placements.push({ id: j.id, prive: o.prive });
      j.p = [...p]; j.lacet = lacet; j.equip = copierEquipement(o.equip); j.main = o.main; j.arme = armeDuSlot(j.equip, j.main) ?? j.equip.secondaire;
      j.pv = o.pv; j.vivant = true; j.posture = "sol"; j.protegeJusqua = t + JEU.protectionMs; j.seq = -1; j.etatT = t;
      return [{ a: j.id, m: { t: "apparition", id: j.id, p: j.p, lacet, arme: j.arme, pv: j.pv, bouclier: 0, equip: copierEquipement(j.equip), main: j.main, munSpeciale: 0 } }];
    },
  };
  const ctx = partiel as ContexteSalle;
  return { vol: creerVolBr(ctx), table, placements, j: (id) => table.get(id)! };
}

const msgs = <T extends MessageServeur["t"]>(s: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] =>
  s.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
const chute = (e: Partial<Extract<MessageClient, { t: "chute" }>> = {}): Extract<MessageClient, { t: "chute" }> =>
  ({ t: "chute", lacet: 0, tangage: 0, avance: 0, lateral: 0, ouvrir: false, ...e });

/** Fait avancer le vol de `t0` à `t1` par pas de `pas` ms. */
function avancer(b: Banc, t0: number, t1: number, pas = 50): Sortie[] {
  const out: Sortie[] = [];
  for (let t = t0 + pas; t <= t1; t += pas) out.push(...b.vol.tic(t));
  return out;
}

const DEBUT = T0 + 5_000;

/** Banc avec Alice et Bob à bord, avion tracé (départ à DEBUT). */
function enVol(ids = ["a", "b"]): Banc {
  const b = banc(...ids);
  for (const id of ids) b.vol.entrer(b.j(id), T0);
  b.vol.demarrer(ids.map((id) => b.j(id)), BORNES, aleaGraine(5), DEBUT, {});
  return b;
}

describe("avion et décompte", () => {
  it("demarrer trace l'avion dans les bornes, immobile jusqu'à debutT, joueurs à bord", () => {
    const b = enVol();
    const a = b.vol.avion()!;
    expect(a.debutT).toBe(DEBUT);
    expect(a.altitude).toBe(350);
    expect(a.finT).toBeGreaterThan(DEBUT);
    expect(b.vol.aBord("a")).toBe(true);
    expect(b.vol.enVol("a")).toBe(true);
    expect(b.vol.chute("a")).toBeUndefined();
    // immobile pendant le décompte : toujours au point de départ
    avancer(b, T0, DEBUT - 100);
    expect(b.j("a").p).toEqual(positionAvionBr(a, DEBUT));
    expect(b.j("a").p[1]).toBe(350);
    expect(b.j("a").v).toEqual([0, 0, 0]);
  });

  it("entrer place le joueur en privé, invulnérable, avec le couteau seul", () => {
    const b = banc("a");
    const s = b.vol.entrer(b.j("a"), T0);
    expect(msgs(s, "apparition")).toHaveLength(1);
    expect(b.placements).toEqual([{ id: "a", prive: true }]);
    const j = b.j("a");
    expect(j.protegeJusqua).toBe(Infinity);
    expect(j.main).toBe("couteau");
    expect(j.equip.sansPrincipale).toBe(true);
    expect(j.equip.sansSecondaire).toBe(true);
    expect(j.pv).toBe(100);
    // idempotent
    expect(b.vol.entrer(j, T0 + 10)).toEqual([]);
    expect(b.placements).toHaveLength(1);
  });

  it("demarrer monte aussi les joueurs jamais passés par entrer (message émis au tic suivant)", () => {
    const b = banc("a");
    b.vol.demarrer([b.j("a")], BORNES, aleaGraine(5), DEBUT, {});
    expect(b.vol.aBord("a")).toBe(true);
    expect(msgs(b.vol.tic(DEBUT + 10), "apparition")).toHaveLength(1);
    expect(msgs(b.vol.tic(DEBUT + 20), "apparition")).toHaveLength(0);
  });

  it("l'avion avance à sa vitesse et rafraîchit etatT et la position des joueurs à bord", () => {
    const b = enVol();
    const a = b.vol.avion()!;
    b.vol.tic(DEBUT + 4_000);
    const j = b.j("a");
    expect(j.p).toEqual(positionAvionBr(a, DEBUT + 4_000));
    expect(j.etatT).toBe(DEBUT + 4_000);
    expect(j.lacet).toBeCloseTo(capAvionBr(a), 9);
    expect(j.protegeJusqua).toBe(Infinity);
  });

  it("durée d'essai : l'avion fait le trajet dans dureeMs", () => {
    const b = banc("a");
    const a = b.vol.demarrer([], BORNES, aleaGraine(5), DEBUT, { dureeMs: 12_000, altitude: 140 });
    expect(a.finT - a.debutT).toBeCloseTo(12_000, 3);
    expect(a.altitude).toBe(140);
  });
});

describe("saut", () => {
  it("refusé pendant le décompte, accepté en vol, vitesse initiale = celle de l'avion", () => {
    const b = enVol();
    const a = b.vol.avion()!;
    expect(b.vol.sauter(b.j("a"), DEBUT - 1)).toEqual([]);
    expect(b.vol.aBord("a")).toBe(true);
    const t = DEBUT + 3_000;
    const s = b.vol.sauter(b.j("a"), t);
    expect(s).toHaveLength(1);
    expect(s[0].a).toBe("a");
    const saut = msgs(s, "saut")[0];
    expect(saut.p).toEqual(etatChuteInitial(positionAvionBr(a, t), vitesseAvionBr(a)).p);
    expect(saut.v).toEqual(etatChuteInitial(positionAvionBr(a, t), vitesseAvionBr(a)).v);
    expect(Math.hypot(saut.v[0], saut.v[2])).toBeCloseTo(a.vitesse, 1);
    expect(saut.lacet).toBeCloseTo(capAvionBr(a), 9);
    expect(b.vol.aBord("a")).toBe(false);
    expect(b.vol.enVol("a")).toBe(true);
    expect(b.vol.chute("a")).toBe("libre");
    expect(b.j("a").posture).toBe("air");
    // Bob est toujours à bord ; un second saut d'Alice ne fait rien
    expect(b.vol.aBord("b")).toBe(true);
    expect(b.vol.sauter(b.j("a"), t + 10)).toEqual([]);
  });

  it("sauter sans être à bord ne fait rien", () => {
    const b = banc("a");
    b.vol.demarrer([], BORNES, aleaGraine(5), DEBUT, {});
    expect(b.vol.sauter(b.j("a"), DEBUT + 100)).toEqual([]);
  });

  it("éjection forcée à finT : tous ceux qui sont encore à bord sautent d'office", () => {
    const b = enVol(["a", "b", "c"]);
    const a = b.vol.avion()!;
    b.vol.sauter(b.j("a"), DEBUT + 2_000);
    const avant = b.vol.tic(a.finT - 1);
    expect(msgs(avant, "saut")).toHaveLength(0);
    expect(b.vol.aBord("b")).toBe(true);
    const s = b.vol.tic(a.finT);
    expect(msgs(s, "saut").map((m) => m.p[1]).length).toBe(2);
    expect(s.filter((x) => x.m.t === "saut").map((x) => x.a).sort()).toEqual(["b", "c"]);
    expect(b.vol.aBord("b")).toBe(false);
    expect(b.vol.chute("b")).toBe("libre");
    // éjectés à l'arrivée de l'avion, à sa vitesse
    expect(b.j("b").p[0]).toBeCloseTo(a.arrivee[0], 0);
    expect(msgs(s, "saut")[0].v).toEqual(etatChuteInitial([0, 0, 0], vitesseAvionBr(a)).v);
  });

  it("admission tardive : un joueur qui monte en vol est placé à la position courante de l'avion et peut sauter aussitôt", () => {
    const b = enVol(["a"]);
    const a = b.vol.avion()!;
    const retard = nouveauJoueur("z", DEBUT + 6_000);
    b.table.set("z", retard);
    const t = DEBUT + 6_000;
    b.vol.entrer(retard, t);
    expect(retard.p).toEqual(positionAvionBr(a, t));
    expect(retard.p[1]).toBe(350);
    expect(b.vol.aBord("z")).toBe(true);
    expect(msgs(b.vol.sauter(retard, t + 1), "saut")).toHaveLength(1);
    // ou il reste à bord jusqu'à l'éjection forcée
    const autre = nouveauJoueur("y", t);
    b.table.set("y", autre);
    b.vol.entrer(autre, t);
    const s = b.vol.tic(a.finT);
    expect(s.filter((x) => x.m.t === "saut").map((x) => x.a).sort()).toEqual(["a", "y"]);
  });
});

describe("chute simulée en temps réel", () => {
  const entrees: EntreesChute = { lacet: 1, tangage: -0.5, avance: 1, lateral: 0.5, ouvrir: false };

  it("le serveur avance au rythme du temps avec les dernières entrées (même résultat que pasChute rejoué)", () => {
    const b = enVol(["a"]);
    const a = b.vol.avion()!;
    const t0 = DEBUT + 1_000;
    b.vol.sauter(b.j("a"), t0);
    b.vol.recevoirChute(b.j("a"), chute({ lacet: 1, tangage: -0.5, avance: 1, lateral: 0.5 }), t0 + 5);
    // tics irréguliers pendant 2,5 s
    let t = t0;
    let reste = 0;
    let ref = etatChuteInitial(positionAvionBr(a, t0), vitesseAvionBr(a));
    // le premier pas se joue avec les entrées d'avant le premier message : le message arrive avant le premier tic
    for (const dt of [16, 17, 33, 16, 100, 40, 7, 25]) {
      t += dt;
      b.vol.tic(t);
      const r = pasDuTemps(dt, reste);
      reste = r.reste;
      for (let k = 0; k < r.pas; k++) ref = pasChute(ref, entrees, MONDE);
    }
    const j = b.j("a");
    expect(j.p[0]).toBeCloseTo(ref.p[0], 6);
    expect(j.p[1]).toBeCloseTo(ref.p[1], 6);
    expect(j.p[2]).toBeCloseTo(ref.p[2], 6);
    expect(j.v[1]).toBeCloseTo(ref.v[1], 6);
    expect(j.lacet).toBe(1);
    expect(j.tangage).toBe(-0.5);
    expect(j.posture).toBe("air");
    expect(j.etatT).toBe(t);
    expect(j.protegeJusqua).toBe(Infinity);
  });

  it("un client ne va pas plus vite que le temps : aucun message, aucun tic, aucun pas", () => {
    const b = enVol(["a"]);
    const t0 = DEBUT + 1_000;
    b.vol.sauter(b.j("a"), t0);
    const y0 = b.j("a").p[1];
    for (let k = 0; k < 500; k++) b.vol.recevoirChute(b.j("a"), chute({ avance: 1 }), t0 + 1);
    expect(b.j("a").p[1]).toBe(y0);
    b.vol.tic(t0 + 100);
    // 100 ms = 6 pas, rien de plus
    const vy = b.j("a").v[1];
    expect(vy).toBeGreaterThan(-40);
    expect(y0 - b.j("a").p[1]).toBeLessThan(6);
  });

  it("une longue pause sans tic ne rattrape pas plus de 6 pas", () => {
    const b = enVol(["a"]);
    const t0 = DEBUT + 1_000;
    b.vol.sauter(b.j("a"), t0);
    const y0 = b.j("a").p[1];
    b.vol.tic(t0 + 5_000);
    expect(y0 - b.j("a").p[1]).toBeLessThan(6);
  });

  it("entrées sanitaires : valeurs non finies ignorées, avance et latéral bornés, tangage borné", () => {
    const b = enVol(["a"]);
    b.vol.sauter(b.j("a"), DEBUT + 1_000);
    b.vol.recevoirChute(b.j("a"), chute({ lacet: Number.NaN, tangage: 9, avance: 50, lateral: -50 }), DEBUT + 1_010);
    b.vol.tic(DEBUT + 1_050);
    expect(Number.isFinite(b.j("a").p[0])).toBe(true);
    expect(b.j("a").tangage).toBeCloseTo(Math.PI / 2, 9);
  });

  it("recevoirChute d'un joueur qui n'est pas en chute est ignoré", () => {
    const b = enVol(["a"]);
    expect(() => b.vol.recevoirChute(b.j("a"), chute({ ouvrir: true }), DEBUT + 10)).not.toThrow();
    expect(b.vol.chute("a")).toBeUndefined();
  });

  it("ouverture manuelle collante, refusée avant delaiOuvertureMinMs", () => {
    const b = enVol(["a"]);
    const t0 = DEBUT + 1_000;
    b.vol.sauter(b.j("a"), t0);
    // à 0,5 s : refusée, même si le client la répète
    b.vol.recevoirChute(b.j("a"), chute({ ouvrir: true }), t0 + 500);
    avancer(b, t0, t0 + 900);
    expect(b.vol.chute("a")).toBe("libre");
    // à 1,05 s : acceptée
    b.vol.recevoirChute(b.j("a"), chute({ ouvrir: true }), t0 + 1_050);
    avancer(b, t0 + 900, t0 + 1_200);
    expect(b.vol.chute("a")).toBe("voile");
    // ne se referme pas, même si le client renvoie ouvrir: false
    b.vol.recevoirChute(b.j("a"), chute({ ouvrir: false }), t0 + 1_250);
    avancer(b, t0 + 1_200, t0 + 1_400);
    expect(b.vol.chute("a")).toBe("voile");
  });

  it("sans aucun message : ouverture automatique sous 90 m puis atterrissage, protégé 5 s", () => {
    const b = enVol(["a"]);
    const t0 = DEBUT + 1_000;
    b.vol.sauter(b.j("a"), t0);
    let t = t0;
    let ouvertA = -1;
    let atterri: Extract<MessageServeur, { t: "atterri" }> | undefined;
    let tAtterri = 0;
    while (!atterri && t < t0 + 60_000) {
      t += 50;
      const s = b.vol.tic(t);
      if (ouvertA < 0 && b.vol.chute("a") === "voile") ouvertA = b.j("a").p[1];
      atterri = msgs(s, "atterri")[0];
      if (atterri) tAtterri = t;
    }
    expect(atterri).toBeDefined();
    // ouvert sous 90 m (un pas de chute de plus au plus)
    expect(ouvertA).toBeGreaterThan(0);
    expect(ouvertA).toBeLessThan(90 + 3);
    const j = b.j("a");
    expect(atterri!.p).toEqual(j.p);
    expect(j.p[1]).toBeCloseTo(0, 0);
    expect(j.v).toEqual([0, 0, 0]);
    expect(j.posture).toBe("sol");
    expect(j.seq).toBe(-1);
    expect(j.protegeJusqua).toBe(tAtterri + BR.protectionAtterrissageMs);
    expect(j.histo).toHaveLength(1);
    // plus en vol, compté
    expect(b.vol.enVol("a")).toBe(false);
    expect(b.vol.chute("a")).toBeUndefined();
    expect(b.vol.atterris()).toBe(1);
    // une chute de 350 m dure de l'ordre de 20 à 30 s
    expect((tAtterri - t0) / 1000).toBeGreaterThan(15);
    expect((tAtterri - t0) / 1000).toBeLessThan(35);
    // plus de message ensuite
    expect(msgs(b.vol.tic(t + 100), "atterri")).toHaveLength(0);
  });

  it("piqué : atterrit plus tôt que le plané (le serveur suit le tangage)", () => {
    const duree = (tangage: number): number => {
      const b = enVol(["a"]);
      const t0 = DEBUT + 1_000;
      b.vol.sauter(b.j("a"), t0);
      let t = t0;
      for (; t < t0 + 90_000; t += 50) {
        b.vol.recevoirChute(b.j("a"), chute({ tangage }), t);
        if (msgs(b.vol.tic(t + 50), "atterri").length) return t + 50 - t0;
      }
      return Infinity;
    };
    expect(duree(-Math.PI / 3)).toBeLessThan(duree(0));
  });
});

describe("sortie de vol", () => {
  it("un joueur mort en vol n'est plus simulé ; retirer l'oublie", () => {
    const b = enVol(["a", "b"]);
    const t0 = DEBUT + 1_000;
    b.vol.sauter(b.j("a"), t0);
    b.vol.sauter(b.j("b"), t0);
    b.j("a").vivant = false;
    b.vol.tic(t0 + 100);
    expect(b.vol.enVol("a")).toBe(false);
    b.vol.retirer("b");
    expect(b.vol.enVol("b")).toBe(false);
    expect(b.vol.chute("b")).toBeUndefined();
  });

  it("retirer un joueur à bord le sort de l'avion, y compris à l'éjection", () => {
    const b = enVol(["a", "b"]);
    b.vol.retirer("a");
    const s = b.vol.tic(b.vol.avion()!.finT);
    expect(s.filter((x) => x.m.t === "saut").map((x) => x.a)).toEqual(["b"]);
  });

  it("un joueur qui quitte après avoir atterri reste compté dans atterris", () => {
    const b = enVol(["a"]);
    const t0 = DEBUT + 1_000;
    b.vol.sauter(b.j("a"), t0);
    avancer(b, t0, t0 + 60_000);
    expect(b.vol.atterris()).toBe(1);
    b.vol.retirer("a");
    expect(b.vol.atterris()).toBe(1);
  });

  it("reinitialiser remet tout à blanc", () => {
    const b = enVol(["a"]);
    b.vol.sauter(b.j("a"), DEBUT + 1_000);
    b.vol.reinitialiser();
    expect(b.vol.avion()).toBeNull();
    expect(b.vol.enVol("a")).toBe(false);
    expect(b.vol.aBord("a")).toBe(false);
    expect(b.vol.atterris()).toBe(0);
    expect(b.vol.tic(DEBUT + 2_000)).toEqual([]);
  });

  it("l'ouverture auto du client prédictif suit la même constante", () => {
    expect(CHUTE_BR.hauteurOuvertureAutoM).toBe(90);
  });
});
