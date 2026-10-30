import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { etatChuteInitial, pasChute } from "./br-chute";
import { mulberry32 } from "./br-butin";
import {
  ECHEC_NAV_MS, MARGE_ZONE_M, NIVEAUX_BOT, RECALCUL_CHEMIN_MS, VITESSE_BOT_M_S, bruitVisee, cibleStable, distanceIdeale, infoZone, pointDeRoute, prioriteButin, seuilFuite,
  type NavBot, type ReponseChemin, capVers, choisirAtterrissage, choisirButin, choisirCible, decider, entreesDepuisDirection, etiqueterComposantes,
  gaussien, instantDeSaut, limiterRotation, memoireInitiale, nomsDeBots, normaliserAngle, sigmaVisee,
  type EntreeCerveau, type Percu,
} from "./bots-br";
import { STATS } from "./armes";
import { CAP_MAX_RAD, GLISSEMENT_MAX_M_S, VITESSE_BOT_RENDU_M_S, vitesseMaxSelonDirection } from "./bot-allure";
import { construireMonde } from "./collision";
import type { ObjetBr, Vec3 } from "./protocole";
import { nomDeBase } from "./br-stats";

/**
 * Cerveau des bots du Battle Royale (lot 3a, scripté) : fonctions pures de `bots-br.ts`.
 * Spec : docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md (§1.4, lot 3)
 */

const mondeVide = construireMonde({ buildings: [], roads: [], pois: [], trees: [] } as unknown as SceneData);

const PI = Math.PI;

describe("conventions de cap", () => {
  it("capVers et entreesDepuisDirection sont cohérents avec pasChute", () => {
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [3, -4], [-5, -2], [2, 7]]) {
      const lacet = capVers(dx, dz);
      // la chute avance dans la direction (−sin lacet, −cos lacet) : celle demandée
      const n = Math.hypot(dx, dz);
      expect(-Math.sin(lacet)).toBeCloseTo(dx / n, 9);
      expect(-Math.cos(lacet)).toBeCloseTo(dz / n, 9);
      // et sur un vrai pas de chute libre, la vitesse horizontale prend ce cap
      let e = etatChuteInitial([0, 350, 0], [0, 0, 0]);
      for (let i = 0; i < 90; i++) e = pasChute(e, { lacet, tangage: -PI / 6, avance: 1, lateral: 0, ouvrir: false }, mondeVide);
      const vh = Math.hypot(e.v[0], e.v[2]);
      expect(vh).toBeGreaterThan(5);
      expect(e.v[0] / vh).toBeCloseTo(dx / n, 3);
      expect(e.v[2] / vh).toBeCloseTo(dz / n, 3);
    }
  });

  it("entreesDepuisDirection redonne la direction : avant = (−sin, −cos), droite = (cos, −sin)", () => {
    for (const lacet of [0, 0.7, -2.1, 3]) {
      for (const [dx, dz] of [[1, 0], [0, -1], [-2, 3], [0.3, 0.4]]) {
        const { avant, droite } = entreesDepuisDirection(dx, dz, lacet);
        // la formule de `souhait` de mouvement.ts / `pasChute`
        const wx = -Math.sin(lacet) * avant + Math.cos(lacet) * droite;
        const wz = -Math.cos(lacet) * avant - Math.sin(lacet) * droite;
        const n = Math.hypot(dx, dz);
        expect(wx).toBeCloseTo(dx / n, 9);
        expect(wz).toBeCloseTo(dz / n, 9);
        expect(Math.hypot(avant, droite)).toBeCloseTo(1, 9);
      }
    }
    expect(entreesDepuisDirection(0, 0, 1)).toEqual({ avant: 0, droite: 0 });
    // face à la direction demandée : tout droit
    const lacet = capVers(3, -4);
    expect(entreesDepuisDirection(3, -4, lacet).avant).toBeCloseTo(1, 9);
    expect(entreesDepuisDirection(3, -4, lacet).droite).toBeCloseTo(0, 9);
  });

  it("limiterRotation tourne par le plus court chemin, au plus max × dt", () => {
    expect(limiterRotation(0, 1, 0.1, 5)).toBeCloseTo(0.5, 9);
    expect(limiterRotation(0, 0.2, 0.1, 5)).toBeCloseTo(0.2, 9);
    // 3,0 → −3,0 passe par π (0,28 rad), pas par 0
    expect(limiterRotation(3, -3, 0.05, 2)).toBeCloseTo(normaliserAngle(3.1), 9);
    expect(limiterRotation(1, 0, 1, 0.3)).toBeCloseTo(0.7, 9);
    expect(limiterRotation(0.4, 1, 0, 9)).toBe(0.4);
  });
});

describe("visée imprécise", () => {
  const p = NIVEAUX_BOT.plat;
  const ecartType = (xs: number[]): number => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  };
  const echantillon = (distance: number, vitesse: number, graine = 5): number[] => {
    const a = mulberry32(graine);
    return Array.from({ length: 1500 }, () => bruitVisee(0, 0, p, distance, vitesse, a).lacet);
  };

  it("le bruit croît avec la distance et avec la vitesse de la cible", () => {
    const proche = ecartType(echantillon(10, 0)), loin = ecartType(echantillon(100, 0)), vite = ecartType(echantillon(100, 9));
    expect(loin).toBeGreaterThan(proche * 3);
    expect(vite).toBeGreaterThan(loin * 1.3);
    expect(sigmaVisee(p, 60, 0)).toBeGreaterThan(sigmaVisee(p, 30, 0));
  });

  it("le tangage reste dans ]−π/2, π/2[ et le lacet dans ]−π, π]", () => {
    const a = mulberry32(2);
    for (let i = 0; i < 200; i++) {
      const r = bruitVisee(3.1, 1.5, { ...p, sigmaDeg: 40 }, 200, 10, a);
      expect(r.tangage).toBeLessThanOrEqual(PI / 2);
      expect(r.tangage).toBeGreaterThanOrEqual(-PI / 2);
      expect(r.lacet).toBeGreaterThan(-PI - 1e-9);
      expect(r.lacet).toBeLessThanOrEqual(PI + 1e-9);
    }
  });

  it("la loi normale est centrée et réduite", () => {
    const a = mulberry32(9);
    const xs = Array.from({ length: 4000 }, () => gaussien(a));
    expect(Math.abs(xs.reduce((s, x) => s + x, 0) / xs.length)).toBeLessThan(0.08);
    expect(ecartType(xs)).toBeGreaterThan(0.9);
    expect(ecartType(xs)).toBeLessThan(1.1);
  });

  it("Entrée est plus lent et moins précis que Goulaf (graine fixe)", () => {
    const e = NIVEAUX_BOT.entree, g = NIVEAUX_BOT.goulaf;
    expect(e.reactionMs).toBeGreaterThan(g.reactionMs);
    expect(e.sigmaDeg).toBeGreaterThan(g.sigmaDeg);
    expect(e.rotationMax).toBeLessThan(g.rotationMax);
    expect(e.rafaleMax).toBeLessThan(g.rafaleMax);
    expect(e.pauseMs).toBeGreaterThan(g.pauseMs);
    // la réaction reste dans la fenêtre de rejeu du serveur (`BR.rewindMaxMs` = 400 ms)
    for (const n of Object.values(NIVEAUX_BOT)) expect(n.reactionMs).toBeLessThanOrEqual(350);
    const a1 = mulberry32(4), a2 = mulberry32(4);
    const erreur = (niv: typeof e, a: () => number) => {
      let s = 0;
      for (let i = 0; i < 800; i++) s += Math.abs(bruitVisee(0, 0, niv, 60, 4, a).lacet);
      return s / 800;
    };
    expect(erreur(e, a1)).toBeGreaterThan(erreur(g, a2) * 3);
  });
});

describe("choix de la cible, du butin, de l'atterrissage", () => {
  const percu = (id: string, distance: number, visible = true): Percu => ({ id, p: [distance, 0, 0], vitesse: [0, 0, 0], distance, visible });

  it("la cible est la plus proche visible, à portée", () => {
    const c = choisirCible([percu("a", 50), percu("b", 20, false), percu("c", 30)], [0, 0, 0], NIVEAUX_BOT.plat);
    expect(c?.id).toBe("c");
    expect(choisirCible([percu("a", 50)], [0, 0, 0], NIVEAUX_BOT.plat, 40)).toBeNull();
    expect(choisirCible([], [0, 0, 0], NIVEAUX_BOT.plat)).toBeNull();
  });

  const objet = (id: number, genre: ObjetBr["genre"], ref: ObjetBr["ref"], x: number): ObjetBr => ({ id, genre, ref, p: [x, 0, 0] });
  const nu = { p: [0, 0, 0] as Vec3, pv: 100, bandage: 0, potion: 0, armeFeu: null, slotArme: null };

  it("sans arme, une arme à feu prime sur le reste ; à égalité de priorité, la plus proche", () => {
    const objets = [objet(1, "bandage", null, 3), objet(2, "arme", "pistolet", 40), objet(3, "arme", "fusil_assaut", 80), objet(4, "munitions", "legeres", 2)];
    expect(choisirButin(objets, nu)).toBe(3);
    expect(choisirButin([objet(5, "arme", "pistolet", 30), objet(6, "arme", "pistolet", 10)], nu)).toBe(6);
  });

  it("armé, ni autre arme ni rien d'inutile ; blessé, un bandage passe devant", () => {
    const arme = { ...nu, armeFeu: "mitraillette" as const, slotArme: "principale" as const };
    expect(choisirButin([objet(1, "arme", "fusil_assaut", 5)], arme)).toBeNull();
    expect(choisirButin([objet(1, "munitions", "legeres", 5), objet(2, "bandage", null, 9)], arme)).toBe(1);
    expect(choisirButin([objet(1, "munitions", "legeres", 5), objet(2, "bandage", null, 9)], { ...arme, pv: 30 })).toBe(1);
    expect(choisirButin([objet(2, "bandage", null, 9)], { ...arme, pv: 30 })).toBe(2);
  });

  it("les objets ignorés ou hors composante sont écartés", () => {
    const objets = [objet(1, "arme", "pistolet", 5), objet(2, "arme", "pistolet", 9)];
    expect(choisirButin(objets, nu, undefined, { 1: 1000 }, 500)).toBe(2);
    expect(choisirButin(objets, nu, undefined, { 1: 1000 }, 1500)).toBe(1);
    expect(choisirButin(objets, nu, new Set([2]))).toBe(2);
    expect(choisirButin(objets, nu, new Set())).toBeNull();
  });

  it("deux bots n'atterrissent pas au même point (écart ≥ 30 m quand c'est possible)", () => {
    const points: Vec3[] = Array.from({ length: 40 }, (_, i) => [i * 10, 0, 0]);
    const alea = mulberry32(3);
    const deja: Vec3[] = [];
    for (let i = 0; i < 8; i++) {
      const c = choisirAtterrissage(points, deja, alea);
      for (const d of deja) expect(Math.hypot(c[0] - d[0], c[2] - d[2])).toBeGreaterThanOrEqual(30);
      deja.push(c);
    }
    expect(choisirAtterrissage([], [], alea)).toEqual([0, 0, 0]);
  });

  it("le saut tombe dans le trajet de l'avion, à portée de planée du point visé", () => {
    const avion = { debutT: 1000, finT: 21_000, depart: [-300, 0] as [number, number], arrivee: [300, 0] as [number, number] };
    const t = instantDeSaut(avion, [100, 0, 0], mulberry32(1));
    expect(t).toBeGreaterThanOrEqual(avion.debutT);
    expect(t).toBeLessThanOrEqual(avion.finT);
    const k = (t - avion.debutT) / (avion.finT - avion.debutT);
    const x = avion.depart[0] + (avion.arrivee[0] - avion.depart[0]) * k;
    expect(Math.abs(x - 100)).toBeLessThanOrEqual(300);
    // un point hors de portée : l'instant de plus grand rapprochement
    const loin = instantDeSaut(avion, [0, 0, 5_000], mulberry32(1));
    expect(loin).toBeGreaterThanOrEqual(avion.debutT);
    expect(loin).toBeLessThanOrEqual(avion.finT);
  });
});

describe("composantes connexes", () => {
  it("étiquette les composantes d'une grille jouet et trouve la principale", () => {
    // 6 × 4, 1 = libre :
    //  1 1 0 0 1 1
    //  1 0 0 0 1 1
    //  0 0 1 0 1 1
    //  1 0 0 0 1 1
    const g = [1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1];
    const { etiquette, principale } = etiqueterComposantes(g, 6, 4);
    expect(etiquette[0]).toBe(etiquette[1]);
    expect(etiquette[0]).toBe(etiquette[6]);
    expect(etiquette[0]).not.toBe(etiquette[4]);
    expect(etiquette[14]).not.toBe(0);
    expect(etiquette[14]).not.toBe(etiquette[0]);
    expect(etiquette[18]).not.toBe(0);
    expect(etiquette[2]).toBe(0);
    // la colonne de droite (8 cases) est la plus grande
    expect(principale).toBe(etiquette[4]);
    expect(new Set([...etiquette].filter((x) => x !== 0)).size).toBe(4);
  });

  it("n'enjambe pas le bord de ligne et supporte une grille vide", () => {
    // deux cases libres en bout de ligne et en début de ligne suivante ne sont PAS voisines
    const { etiquette } = etiqueterComposantes([0, 0, 1, 1, 0, 0], 3, 2);
    expect(etiquette[2]).not.toBe(etiquette[3]);
    expect(etiqueterComposantes([], 0, 0).principale).toBe(0);
    expect(etiqueterComposantes([0, 0, 0, 0], 2, 2).principale).toBe(0);
  });

  it("passe à l'échelle de la grille du jeu (≈ 150 000 cases)", () => {
    const n = 400 * 400;
    const libre = new Uint8Array(n).fill(1);
    const t0 = performance.now();
    const { principale } = etiqueterComposantes(libre, 400, 400);
    expect(principale).toBe(1);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("noms des bots", () => {
  it("uniques, sans chiffre final, distincts des pseudos pris", () => {
    const pris = ["Rayure", "tigrou", "Alice"];
    const noms = nomsDeBots(20, pris, mulberry32(8));
    expect(noms).toHaveLength(20);
    expect(new Set(noms.map((n) => n.toLocaleLowerCase("fr"))).size).toBe(20);
    for (const n of noms) {
      expect(/\d$/.test(n)).toBe(false);
      expect(pris.map((p) => p.toLocaleLowerCase("fr"))).not.toContain(n.toLocaleLowerCase("fr"));
    }
    // aucun conflit de nom de base entre eux (les statistiques se confondraient)
    expect(new Set(noms.map(nomDeBase)).size).toBe(20);
  });

  it("à court de noms, enchaîne des noms composés toujours uniques", () => {
    const noms = nomsDeBots(70, [], mulberry32(1));
    expect(new Set(noms).size).toBe(70);
  });
});

describe("decider (scripté)", () => {
  const percu = (id: string, p: Vec3, visible = true): Percu => ({
    id, p, vitesse: [0, 0, 0], distance: Math.hypot(p[0], p[2]), visible,
  });
  const base = (sur: Partial<EntreeCerveau> = {}): EntreeCerveau => ({
    t: 10_000, dtS: 0.05, phase: "jeu",
    moi: { p: [0, 0, 0], pv: 100, bandage: 0, potion: 0, armeFeu: null, slotArme: null, lacet: 0, tangage: 0, aBord: false, enChute: false, arme: "couteau", sortie: true },
    munitions: { charge: 0, chargeur: 0, reserve: 0, recharge: false },
    avion: null, zone: null, percus: [], objets: [], points: [], deja: [], agressif: false, humainProche: null,
    ...sur,
  });
  const arme = (sur: Partial<EntreeCerveau["moi"]> = {}): EntreeCerveau["moi"] => ({
    p: [0, 0, 0], pv: 100, bandage: 0, potion: 0, armeFeu: "mitraillette", slotArme: "principale", lacet: 0, tangage: 0, aBord: false, enChute: false,
    arme: "mitraillette", sortie: true, ...sur,
  });
  const p = NIVEAUX_BOT.goulaf;

  it("à bord : tire un point d'atterrissage, saute dans le trajet de l'avion, puis vole vers lui (piqué, parachute bas)", () => {
    const avion = { debutT: 0, finT: 20_000, depart: [-300, 0] as [number, number], arrivee: [300, 0] as [number, number], altitude: 350, vitesse: 30 };
    const points: Vec3[] = [[100, 0, 40], [-200, 0, 90]];
    const a = mulberry32(5);
    let m = memoireInitiale();
    const entreeBord = (t: number) => base({
      t, phase: "vol", avion, points, moi: { ...base().moi, p: [-300 + t * 0.03, 350, 0], aBord: true, enChute: false },
    });
    let saut = -1;
    for (let t = 0; t <= 20_000; t += 50) {
      const r = decider(m, entreeBord(t), p, a);
      m = r.m;
      if (r.c.quitterAvion) { saut = t; break; }
    }
    expect(saut).toBeGreaterThanOrEqual(0);
    expect(m.cibleAtt).not.toBeNull();
    // en chute : cap sur le point, avance pleine, parachute ouvert sous 150 m seulement
    const cible = m.cibleAtt as Vec3;
    const haut = decider(m, base({ phase: "vol", moi: { ...base().moi, p: [0, 300, 0], enChute: true } }), p, a);
    expect(haut.c.lacet).toBeCloseTo(capVers(cible[0], cible[2]), 9);
    expect(haut.c.entrees.avant).toBe(1);
    expect(haut.c.ouvrirParachute).toBe(false);
    expect(haut.c.tangage).toBeLessThan(0);
    const bas = decider(m, base({ phase: "vol", moi: { ...base().moi, p: [0, 120, 0], enChute: true } }), p, a);
    expect(bas.c.ouvrirParachute).toBe(true);
    expect(haut.m.etat).toBe("atterrir");
  });

  it("au sol, sans arme : va chercher l'arme la plus proche, la ramasse à moins de 2 m, marche à VITESSE_BOT_M_S", () => {
    const objets: ObjetBr[] = [{ id: 7, genre: "arme", ref: "fusil_assaut", p: [0, 0, -30] }, { id: 8, genre: "arme", ref: "pistolet", p: [60, 0, 0] }];
    const r = decider(memoireInitiale(), base({ objets }), p, mulberry32(1));
    expect(r.m.etat).toBe("fouiller");
    expect(r.c.ramasser).toBeUndefined();
    // marche vers l'objet (au nord : −z), à la vitesse des bots, jamais en sprint
    expect(r.c.entrees.sprint).toBe(false);
    expect(Math.hypot(r.c.entrees.avant, r.c.entrees.droite)).toBeCloseTo(VITESSE_BOT_M_S / 9, 9);
    const pres = decider(r.m, base({ objets: [{ id: 7, genre: "arme", ref: "fusil_assaut", p: [0, 0, -1.5] }] }), p, mulberry32(1));
    expect(pres.c.ramasser).toBe(7);
    // un ramassage tenté est ignoré 4 s : le bot ne reste pas planté devant un objet que le serveur refuse
    expect(pres.m.ignores[7]).toBe(10_000 + 4000);
  });

  it("sans cible ni butin, rejoint la zone, puis erre dedans", () => {
    const loin = decider(memoireInitiale(), base({ zone: { centre: [500, 0], rayon: 100 } }), p, mulberry32(1));
    expect(loin.m.etat).toBe("zone");
    expect(loin.c.entrees.avant !== 0 || loin.c.entrees.droite !== 0).toBe(true);
    const dedans = decider(memoireInitiale(), base({ zone: { centre: [0, 0], rayon: 100 } }), p, mulberry32(1));
    expect(dedans.m.errance).not.toBeNull();
    const [ex, ez] = dedans.m.errance as [number, number];
    expect(Math.hypot(ex, ez)).toBeLessThanOrEqual(70.0001);
  });

  it("armé, tire sur la plus proche visible quand la visée est alignée, par rafales, jamais sur une cible cachée", () => {
    const cible = percu("c", [0, 0, -25]);
    let m = memoireInitiale();
    const alea = mulberry32(2);
    let tirs = 0, pauses = 0;
    let lacet = 0;
    const petit = { ...p, sigmaDeg: 0.0001, rafaleMax: 3, pauseMs: 400 };
    for (let k = 0; k < 120; k++) {
      const t = 10_000 + k * 50;
      const r = decider(m, base({
        t, moi: arme({ lacet }), percus: [cible], munitions: { charge: 30, chargeur: 30, reserve: 60, recharge: false },
      }), petit, alea);
      m = r.m;
      lacet = r.c.lacet;
      if (r.c.tirer) tirs++;
      else if (r.m.pauseJusqua > t) pauses++;
      expect(r.m.etat).toBe("combat");
    }
    expect(tirs).toBeGreaterThan(20);
    expect(pauses).toBeGreaterThan(5);
    // jamais sans ligne de vue
    const cachee = decider(memoireInitiale(), base({
      moi: arme(), percus: [percu("c", [0, 0, -25], false)], munitions: { charge: 30, chargeur: 30, reserve: 60, recharge: false },
    }), petit, mulberry32(2));
    expect(cachee.c.tirer).toBe(false);
    expect(cachee.m.cible).toBeNull();
  });

  it("recharge à vide, ne tire pas pendant la recharge ni avant le dégainage, repasse au couteau sans munitions", () => {
    const cible = percu("c", [0, 0, -20]);
    const vide = decider(memoireInitiale(), base({ moi: arme(), percus: [cible], munitions: { charge: 0, chargeur: 30, reserve: 60, recharge: false } }), p, mulberry32(1));
    expect(vide.c.recharger).toBe(true);
    expect(vide.c.tirer).toBe(false);
    const enCours = decider(memoireInitiale(), base({ moi: arme(), percus: [cible], munitions: { charge: 0, chargeur: 30, reserve: 60, recharge: true } }), p, mulberry32(1));
    expect(enCours.c.recharger).toBe(false);
    expect(enCours.c.tirer).toBe(false);
    const rien = decider(memoireInitiale(), base({ moi: arme(), percus: [cible], munitions: { charge: 0, chargeur: 30, reserve: 0, recharge: false } }), p, mulberry32(1));
    expect(rien.c.changerArme).toBe("couteau");
    const degaine = decider(memoireInitiale(), base({ moi: arme({ sortie: false }), percus: [cible], munitions: { charge: 30, chargeur: 30, reserve: 60, recharge: false } }), { ...p, sigmaDeg: 0.0001 }, mulberry32(1));
    expect(degaine.c.tirer).toBe(false);
    // l'arme à feu n'est pas en main : le bot la sort avant de tirer
    const sort = decider(memoireInitiale(), base({ moi: arme({ arme: "couteau" }), percus: [cible], munitions: { charge: 30, chargeur: 30, reserve: 60, recharge: false } }), p, mulberry32(1));
    expect(sort.c.changerArme).toBe("principale");
    expect(sort.c.tirer).toBe(false);
  });

  it("sans arme à feu, frappe au couteau une cible à portée dans l'axe", () => {
    const cible = percu("c", [0, 0, -1.5]);
    let m = memoireInitiale();
    let coup = false;
    let lacet = 0;
    const alea = mulberry32(1);
    for (let k = 0; k < 30 && !coup; k++) {
      const r = decider(m, base({ t: 10_000 + k * 50, moi: { ...base().moi, lacet }, percus: [cible] }), { ...p, sigmaDeg: 0.0001 }, alea);
      m = r.m; lacet = r.c.lacet; coup = r.c.coup;
    }
    expect(coup).toBe(true);
  });

  it("un bot immobile contre un mur saute puis contourne", () => {
    const alea = mulberry32(1);
    let m = memoireInitiale();
    let saute = false, detour = false;
    const zone = { centre: [200, 0] as [number, number], rayon: 50 };
    // 3 s au même endroit en voulant marcher
    for (let k = 0; k < 70; k++) {
      const t = 10_000 + k * 50;
      const r = decider(m, base({ t, zone }), p, alea);
      m = r.m;
      if (r.c.sauter) saute = true;
      if (t < m.detourJusqua) detour = true;
    }
    expect(saute).toBe(true);
    expect(detour).toBe(true);
    // qui avance normalement ne saute jamais
    m = memoireInitiale();
    let sauts = 0;
    for (let k = 0; k < 70; k++) {
      const t = 10_000 + k * 50;
      const r = decider(m, base({ t, zone, moi: { ...base().moi, p: [k * 0.5, 0, 0] } }), p, alea);
      m = r.m;
      if (r.c.sauter) sauts++;
    }
    expect(sauts).toBe(0);
  });

  it("n'a pas de hasard global : mêmes entrées et même graine, mêmes consignes", () => {
    const e = base({ zone: { centre: [0, 0], rayon: 100 }, percus: [percu("c", [0, 0, -30])], moi: arme(), munitions: { charge: 30, chargeur: 30, reserve: 60, recharge: false } });
    const a = decider(memoireInitiale(), e, NIVEAUX_BOT.plat, mulberry32(11));
    const b = decider(memoireInitiale(), e, NIVEAUX_BOT.plat, mulberry32(11));
    expect(a).toEqual(b);
  });
});

// =================================================================================================
// lot 3b : navigation, zone, soins, fuite, combat
// =================================================================================================

describe("decider (IA, lot 3b)", () => {
  const percu = (id: string, p: Vec3, visible = true, vitesse: Vec3 = [0, 0, 0]): Percu => ({ id, p, vitesse, distance: Math.hypot(p[0], p[2]), visible });
  const base = (sur: Partial<EntreeCerveau> = {}): EntreeCerveau => ({
    t: 10_000, dtS: 0.05, phase: "jeu",
    moi: { p: [0, 0, 0], pv: 100, bandage: 0, potion: 0, armeFeu: null, slotArme: null, lacet: 0, tangage: 0, aBord: false, enChute: false, arme: "couteau", sortie: true },
    munitions: { charge: 0, chargeur: 0, reserve: 0, recharge: false },
    avion: null, zone: null, percus: [], objets: [], points: [], deja: [], agressif: false, humainProche: null,
    ...sur,
  });
  const arme = (sur: Partial<EntreeCerveau["moi"]> = {}): EntreeCerveau["moi"] => ({
    p: [0, 0, 0], pv: 100, bandage: 0, potion: 0, armeFeu: "mitraillette", slotArme: "principale", lacet: 0, tangage: 0, aBord: false, enChute: false,
    arme: "mitraillette", sortie: true, ...sur,
  });
  const plein = { charge: 30, chargeur: 30, reserve: 60, recharge: false };
  const p = NIVEAUX_BOT.plat;
  const dirVers = (c: { entrees: { avant: number; droite: number }; lacet: number }): [number, number] => {
    // direction monde du déplacement demandé
    const { avant, droite } = c.entrees;
    const x = -Math.sin(c.lacet) * avant + Math.cos(c.lacet) * droite, z = -Math.cos(c.lacet) * avant - Math.sin(c.lacet) * droite;
    const n = Math.hypot(x, z);
    return n < 1e-9 ? [0, 0] : [x / n, z / n];
  };

  /** Un navigateur factice : chemin prédéfini, réponses programmables, compteurs d'appels. */
  function navFactice(o: { libre?: boolean; reponse?: ReponseChemin; abri?: [number, number] | null } = {}): NavBot & { appels: { chercher: number; abri: number } } {
    const appels = { chercher: 0, abri: 0 };
    return {
      appels,
      ligneLibre: () => o.libre ?? true,
      chercher: () => { appels.chercher++; return o.reponse ?? { etat: "echec" }; },
      viser: (_de, chemin) => (chemin.length > 0 ? chemin[0] : null),
      abri: () => { appels.abri++; return o.abri === undefined ? null : o.abri; },
    };
  }

  describe("zone", () => {
    it("infoZone : dehors, près du bord, palier avancé", () => {
      const e = (x: number, zone: EntreeCerveau["zone"]) => base({ zone, moi: { ...base().moi, p: [x, 0, 0] } });
      const courant = { centre: [0, 0] as [number, number], rayon: 100 };
      expect(infoZone(e(0, null))).toBeNull();
      const dedans = infoZone(e(0, { centre: [0, 0], rayon: 100, courant, palier: 1, phase: "attente" }))!;
      expect(dedans.dehors).toBe(false);
      expect(dedans.urgent).toBe(false);
      // près du bord du cercle courant (moins de la marge) : urgent, pas dehors
      const bord = infoZone(e(100 - MARGE_ZONE_M + 1, { centre: [0, 0], rayon: 100, courant, palier: 1, phase: "attente" }))!;
      expect(bord.dehors).toBe(false);
      expect(bord.urgent).toBe(true);
      expect(infoZone(e(101, { centre: [0, 0], rayon: 100, courant }))!.dehors).toBe(true);
      // palier 2 : hors du cercle visé (plus petit), le bot est pressé même s'il est encore dans le cercle courant
      const visee = { centre: [0, 0] as [number, number], rayon: 40 };
      const z2 = (x: number) => infoZone(e(x, { centre: visee.centre, rayon: visee.rayon, courant, palier: 2, phase: "attente" }))!;
      expect(z2(20).urgent).toBe(false);
      expect(z2(60).urgent).toBe(true);
      expect(z2(60).dehors).toBe(false);
      // palier 1 en attente : la même position n'est pas urgente (le cercle visé n'importe qu'au rétrécissement)
      expect(infoZone(e(60, { centre: visee.centre, rayon: visee.rayon, courant, palier: 1, phase: "attente" }))!.urgent).toBe(false);
      expect(infoZone(e(60, { centre: visee.centre, rayon: visee.rayon, courant, palier: 1, phase: "retrecit" }))!.urgent).toBe(true);
    });

    it("la zone prime sur le butin dès l'approche du bord, le butin passe avant l'errance sinon", () => {
      const objets: ObjetBr[] = [{ id: 1, genre: "arme", ref: "fusil_assaut", p: [0, 0, -30] }];
      const courant = { centre: [0, 0] as [number, number], rayon: 100 };
      // au centre : butin
      const sûr = decider(memoireInitiale(), base({ objets, zone: { centre: [0, 0], rayon: 100, courant, palier: 1, phase: "attente" } }), p, mulberry32(1));
      expect(sûr.m.etat).toBe("fouiller");
      // au bord (88 m du centre, cercle de 100) : la zone prime, le bot marche vers le centre (−x)
      const bord = decider(memoireInitiale(), base({ objets, moi: { ...base().moi, p: [90, 0, 0] }, zone: { centre: [0, 0], rayon: 100, courant, palier: 1, phase: "attente" } }), p, mulberry32(1));
      expect(bord.m.etat).toBe("zone");
      expect(dirVers(bord.c)[0]).toBeLessThan(-0.3);
      // au palier 2, hors du cercle visé : la zone prime aussi
      const z2 = decider(memoireInitiale(), base({ objets, moi: { ...base().moi, p: [60, 0, 0] }, zone: { centre: [0, 0], rayon: 40, courant, palier: 2, phase: "attente" } }), p, mulberry32(1));
      expect(z2.m.etat).toBe("zone");
    });

    it("hors du cercle, le bot se soigne seulement APRÈS avoir regagné la zone ; blessé et à couvert dedans, il se soigne", () => {
      const courant = { centre: [0, 0] as [number, number], rayon: 100 };
      const dehors = decider(memoireInitiale(), base({ moi: { ...base().moi, p: [150, 0, 0], pv: 30, bandage: 2 }, zone: { centre: [0, 0], rayon: 100, courant, palier: 1 } }), p, mulberry32(1));
      expect(dehors.m.etat).toBe("zone");
      expect(dehors.c.utiliser).toBeUndefined();
      const dedans = decider(memoireInitiale(), base({ moi: { ...base().moi, p: [0, 0, 0], pv: 30, bandage: 2 }, zone: { centre: [0, 0], rayon: 100, courant, palier: 1 } }), p, mulberry32(1));
      expect(dedans.m.etat).toBe("soigner");
      expect(dedans.c.utiliser).toBe("bandage");
      expect(dedans.c.entrees.avant).toBe(0);
      expect(dedans.c.entrees.droite).toBe(0);
    });
  });

  describe("soins et fuite", () => {
    it("sans ennemi : bandage sous 60 PV, potion si le bouclier est vide, rien quand tout va bien", () => {
      const sans = (moi: Partial<EntreeCerveau["moi"]>) => decider(memoireInitiale(), base({ moi: { ...base().moi, ...moi } }), p, mulberry32(1));
      expect(sans({ pv: 50, bandage: 1 }).c.utiliser).toBe("bandage");
      expect(sans({ pv: 90, potion: 1, bouclier: 0 }).c.utiliser).toBe("potion");
      expect(sans({ pv: 90, potion: 1, bouclier: 50 }).c.utiliser).toBeUndefined();
      expect(sans({ pv: 100, bandage: 3 }).c.utiliser).toBeUndefined();
    });

    it("blessé avec un ennemi visible à distance : il fuit vers l'abri, sans tirer, tourné vers sa marche ; trop près, il se bat", () => {
      const nav = navFactice({ abri: [-40, 0] });
      const m0 = memoireInitiale();
      const faible = arme({ pv: seuilFuite(p) - 5, bandage: 3 });
      const ennemi = percu("e", [0, 0, -30]);
      const r = decider(m0, base({ moi: faible, percus: [ennemi], munitions: plein, nav }), { ...p, sigmaDeg: 0.0001 }, mulberry32(1));
      expect(r.m.etat).toBe("fuir");
      expect(r.c.tirer).toBe(false);
      expect(nav.appels.abri).toBe(1);
      expect(dirVers(r.c)[0]).toBeLessThan(0); // vers l'abri à l'ouest
      // trop près (moins de 6 m) : il se bat au lieu d'offrir son dos
      const pres = decider(m0, base({ moi: faible, percus: [percu("e", [0, 0, -4])], munitions: plein, nav }), p, mulberry32(1));
      expect(pres.m.etat).toBe("combat");
      // en forme : il se bat
      const sain = decider(m0, base({ moi: arme(), percus: [ennemi], munitions: plein, nav }), p, mulberry32(1));
      expect(sain.m.etat).toBe("combat");
    });

    it("la fuite sans abri va vers la zone, sinon à l'opposé de l'ennemi ; l'abri est gardé 1,5 s", () => {
      const faible = arme({ pv: 10 });
      const ennemi = percu("e", [0, 0, -30]);
      const zone = decider(memoireInitiale(), base({ moi: faible, percus: [ennemi], munitions: plein, nav: navFactice(), zone: { centre: [200, 0], rayon: 50 } }), p, mulberry32(1));
      expect(dirVers(zone.c)[0]).toBeGreaterThan(0.5);
      const opposé = decider(memoireInitiale(), base({ moi: faible, percus: [ennemi], munitions: plein }), p, mulberry32(1));
      expect(dirVers(opposé.c)[1]).toBeGreaterThan(0.5); // l'ennemi est au nord (−z), il fuit vers le sud
      const nav = navFactice({ abri: [-40, 0] });
      let m = memoireInitiale();
      for (let k = 0; k < 20; k++) m = decider(m, base({ t: 10_000 + k * 50, moi: faible, percus: [ennemi], munitions: plein, nav }), p, mulberry32(1)).m;
      expect(nav.appels.abri).toBe(1);
    });

    it("le seuil de fuite dépend du niveau : Entrée fuit plus tôt que Goulaf", () => {
      expect(seuilFuite(NIVEAUX_BOT.entree)).toBeGreaterThan(seuilFuite(NIVEAUX_BOT.plat));
      expect(seuilFuite(NIVEAUX_BOT.plat)).toBeGreaterThan(seuilFuite(NIVEAUX_BOT.goulaf));
    });
  });

  describe("combat", () => {
    it("garde sa cible tant qu'elle reste visible, change si une autre est bien plus proche", () => {
      const a = percu("a", [0, 0, -40]), b = percu("b", [0, 0, -30]);
      expect(cibleStable([a, b], "a", [0, 0, 0], p, 140)!.id).toBe("a"); // b n'est pas à moins de 60 % de la distance de a
      expect(cibleStable([a, percu("b", [0, 0, -20])], "a", [0, 0, 0], p, 140)!.id).toBe("b");
      expect(cibleStable([percu("a", [0, 0, -40], false), b], "a", [0, 0, 0], p, 140)!.id).toBe("b");
      expect(cibleStable([], "a", [0, 0, 0], p, 140)).toBeNull();
    });

    it("se tient à la distance idéale de l'arme : avance si trop loin, recule si trop près, esquive sinon (vitesse bornée par le contrat de rendu)", () => {
      const ideale = distanceIdeale("mitraillette", STATS.mitraillette.portee, STATS.mitraillette.portee * p.agressivite);
      expect(ideale).toBeGreaterThanOrEqual(7);
      const test = (d: number) => decider(memoireInitiale(), base({ moi: arme(), percus: [percu("e", [0, 0, -d])], munitions: plein }), p, mulberry32(3));
      const loin = test(ideale * 1.5);
      expect(dirVers(loin.c)[1]).toBeLessThan(-0.9); // vers la cible (nord)
      expect(Math.hypot(loin.c.entrees.avant, loin.c.entrees.droite)).toBeCloseTo(VITESSE_BOT_M_S / 9, 9);
      const pres = test(ideale * 0.3);
      expect(dirVers(pres.c)[1]).toBeGreaterThan(0.3); // recule
      // le recul est animable à pleine vitesse (le corps garde la visée, les pieds reculent) : plus de ralentissement inutile
      expect(Math.hypot(pres.c.entrees.avant, pres.c.entrees.droite)).toBeCloseTo(vitesseMaxSelonDirection(Math.PI) / 9, 9);
      const esquive = test(ideale);
      expect(Math.abs(dirVers(esquive.c)[0])).toBeGreaterThan(0.7); // latéral
      // la vitesse d'esquive ne dépasse pas ce que le rendu autorise à l'angle réel de la marche (≈ ±90° de la visée), sinon les pieds arrière patinent
      const vEsquive = Math.hypot(esquive.c.entrees.avant, esquive.c.entrees.droite) * 9;
      const rel = Math.atan2(esquive.c.entrees.droite, esquive.c.entrees.avant);
      expect(Math.abs(rel)).toBeGreaterThan(Math.PI / 3);
      expect(vEsquive).toBeLessThanOrEqual(vitesseMaxSelonDirection(rel) + 1e-9);
      expect(vEsquive).toBeGreaterThan(0.5);
      // glissement des pieds arrière : composante perpendiculaire à l'axe du corps (borné à ±CAP_MAX_RAD de la visée) sous le seuil
      const relPlie = Math.abs(rel) > Math.PI / 2 ? Math.PI - Math.abs(rel) : Math.abs(rel); // à reculons le corps s'aligne sur l'axe de marche
      expect(vEsquive * Math.sin(Math.max(0, relPlie - CAP_MAX_RAD))).toBeLessThanOrEqual(GLISSEMENT_MAX_M_S + 1e-9);
      expect(VITESSE_BOT_M_S).toBe(VITESSE_BOT_RENDU_M_S);
    });

    it("l'esquive change de sens, et la phase est tirée une fois par bot", () => {
      const alea = mulberry32(8);
      const ideale = distanceIdeale("mitraillette", STATS.mitraillette.portee, STATS.mitraillette.portee * p.agressivite);
      let m = memoireInitiale();
      const sens: number[] = [];
      for (let k = 0; k < 120; k++) {
        const r = decider(m, base({ t: 10_000 + k * 50, moi: arme(), percus: [percu("e", [0, 0, -ideale])], munitions: plein }), p, alea);
        m = r.m;
        sens.push(Math.sign(dirVers(r.c)[0]));
      }
      expect(new Set(sens).size).toBe(2);
      expect(m.phaseEsquive).toBeGreaterThanOrEqual(0);
    });

    it("recharge à couvert : chargeur presque vide, ennemi à distance, il va à l'abri et recharge", () => {
      const nav = navFactice({ abri: [-30, 0] });
      const r = decider(memoireInitiale(), base({ moi: arme(), percus: [percu("e", [0, 0, -40])], munitions: { charge: 3, chargeur: 30, reserve: 60, recharge: false }, nav }), p, mulberry32(1));
      expect(nav.appels.abri).toBe(1);
      expect(dirVers(r.c)[0]).toBeLessThan(-0.3);
      expect(r.c.recharger).toBe(true);
      expect(r.c.tirer).toBe(false);
    });

    it("poursuit le dernier point vu d'un joueur disparu pendant 4 s, pas plus, et pas un joueur mort", () => {
      const alea = mulberry32(2);
      let m = decider(memoireInitiale(), base({ t: 10_000, moi: arme(), percus: [percu("e", [-40, 0, -40])], munitions: plein }), p, alea).m;
      expect(m.vuP).toEqual([-40, 0, -40]);
      // il se cache (toujours perçu, invisible) : on va voir où il était
      const vers = decider(m, base({ t: 11_000, moi: arme(), percus: [percu("e", [-40, 0, -40], false)], munitions: plein }), p, alea);
      expect(vers.m.etat).toBe("combat");
      expect(dirVers(vers.c)[0]).toBeLessThan(-0.3);
      // passé 4 s : retour à la routine
      const oublie = decider(m, base({ t: 15_000, moi: arme(), percus: [percu("e", [-40, 0, -40], false)], munitions: plein }), p, alea);
      expect(oublie.m.etat).not.toBe("combat");
      // il n'est plus perçu du tout (mort) : le souvenir est effacé
      const mort = decider(m, base({ t: 11_000, moi: arme(), percus: [], munitions: plein }), p, alea);
      expect(mort.m.vuP).toBeNull();
    });

    it("hors de la zone, il tire en courant vers le cercle", () => {
      const courant = { centre: [0, 0] as [number, number], rayon: 50 };
      const r = decider(memoireInitiale(), base({
        moi: arme({ p: [90, 0, 0] }), percus: [{ id: "e", p: [90, 0, -30], vitesse: [0, 0, 0], distance: 30, visible: true }], munitions: plein, zone: { centre: [0, 0], rayon: 50, courant, palier: 1 },
      }), p, mulberry32(1));
      expect(r.m.etat).toBe("combat");
      expect(dirVers(r.c)[0]).toBeLessThan(-0.5);
    });
  });

  describe("butin", () => {
    const moi = (sur: Partial<Parameters<typeof prioriteButin>[1]> = {}) => ({ p: [0, 0, 0] as Vec3, pv: 100, bandage: 0, potion: 0, armeFeu: null, slotArme: null, ...sur });
    const arm = (ref: string): ObjetBr => ({ id: 1, genre: "arme", ref: ref as ObjetBr["ref"], p: [0, 0, 0] });
    const mun = (ref: "legeres" | "moyennes" | "cartouches"): ObjetBr => ({ id: 2, genre: "munitions", ref, p: [0, 0, 0] });

    it("sans arme, n'importe quelle arme à feu ; les explosives valent le moins", () => {
      expect(prioriteButin(arm("pistolet"), moi())).toBeGreaterThan(prioriteButin(arm("epee"), moi()));
      expect(prioriteButin(arm("fusil_assaut"), moi())).toBeGreaterThan(prioriteButin(arm("pistolet"), moi()));
      expect(prioriteButin(arm("bazooka"), moi())).toBeLessThan(prioriteButin(arm("fusil_assaut"), moi()));
    });

    it("armé : une secondaire cherche une principale, une principale ne change que pour mieux d'au moins deux rangs", () => {
      expect(prioriteButin(arm("mitraillette"), moi({ armeFeu: "pistolet", slotArme: "secondaire" }))).toBeGreaterThan(5);
      expect(prioriteButin(arm("pistolet"), moi({ armeFeu: "pistolet", slotArme: "secondaire" }))).toBe(0);
      expect(prioriteButin(arm("fusil_assaut"), moi({ armeFeu: "mitraillette", slotArme: "principale" }))).toBe(0);
      expect(prioriteButin(arm("minigun"), moi({ armeFeu: "mitraillette", slotArme: "principale" }))).toBeGreaterThan(0);
    });

    it("les munitions n'intéressent que la classe d'une arme portée, et passent devant tout quand tout est à sec", () => {
      const armé = moi({ armeFeu: "mitraillette", slotArme: "principale", classesMun: ["legeres"] });
      expect(prioriteButin(mun("legeres"), armé)).toBeGreaterThan(0);
      expect(prioriteButin(mun("cartouches"), armé)).toBe(0);
      expect(prioriteButin(mun("legeres"), { ...armé, armeVide: true })).toBeGreaterThan(prioriteButin(arm("fusil_assaut"), moi()));
      expect(prioriteButin(mun("legeres"), moi())).toBe(0);
    });
  });

  describe("navigation (pointDeRoute)", () => {
    const e0 = (nav: NavBot, t = 10_000, pos: Vec3 = [0, 0, 0]): EntreeCerveau => base({ t, nav, moi: { ...base().moi, p: pos } });
    const chemin: [number, number][] = [[10, -20], [30, -40], [60, -40]];

    it("ligne libre ou but proche : tout droit, aucune recherche", () => {
      const nav = navFactice({ libre: true });
      expect(pointDeRoute(memoireInitiale(), e0(nav), [0, -100])).toEqual([0, -100]);
      const bloque = navFactice({ libre: false });
      expect(pointDeRoute(memoireInitiale(), e0(bloque), [0, -3])).toEqual([0, -3]);
      expect(nav.appels.chercher + bloque.appels.chercher).toBe(0);
    });

    it("mur sur la droite : chemin cherché, puis suivi (le point visé vient du chemin) ; pas de nouvelle recherche avant 2,5 s", () => {
      const nav = navFactice({ libre: false, reponse: { etat: "ok", chemin } });
      const m = memoireInitiale();
      expect(pointDeRoute(m, e0(nav), [60, -40])).toEqual([10, -20]);
      expect(nav.appels.chercher).toBe(1);
      expect(m.butChemin).toEqual([60, -40]);
      pointDeRoute(m, e0(nav, 10_000 + RECALCUL_CHEMIN_MS - 100), [60, -40]);
      expect(nav.appels.chercher).toBe(1);
      pointDeRoute(m, e0(nav, 10_000 + RECALCUL_CHEMIN_MS), [60, -40]);
      expect(nav.appels.chercher).toBe(2);
      // un but qui a bougé de plus de 6 m refait le chemin tout de suite
      pointDeRoute(m, e0(nav, 10_000 + RECALCUL_CHEMIN_MS + 50), [60, -50]);
      expect(nav.appels.chercher).toBe(3);
    });

    it("les points du chemin déjà atteints sont retirés, jamais le dernier", () => {
      const nav = navFactice({ libre: false, reponse: { etat: "ok", chemin } });
      const m = memoireInitiale();
      pointDeRoute(m, e0(nav), [66, -40]);
      expect(pointDeRoute(m, e0(nav, 10_050, [10, 0, -19]), [66, -40])).toEqual([30, -40]);
      expect(m.chemin).toHaveLength(2);
      expect(pointDeRoute(m, e0(nav, 10_100, [30, 0, -40]), [66, -40])).toEqual([60, -40]);
      expect(m.chemin).toHaveLength(1);
      // arrivé sur le dernier point : il reste, jamais de chemin vide tant que le but est lointain
      expect(pointDeRoute(m, e0(nav, 10_150, [60, 0, -40]), [66, -40])).toEqual([60, -40]);
      expect(m.chemin).toHaveLength(1);
    });

    it("« attente » (budget du tic pris) : l'ancien chemin continue, sinon tout droit ; la recherche est redemandée à chaque décision", () => {
      const nav = navFactice({ libre: false, reponse: { etat: "attente" } });
      const m = memoireInitiale();
      expect(pointDeRoute(m, e0(nav), [60, -40])).toEqual([60, -40]);
      expect(pointDeRoute(m, e0(nav, 10_050), [60, -40])).toEqual([60, -40]);
      expect(nav.appels.chercher).toBe(2);
    });

    it("échec : mémorisé 8 s pour ce but (marche droite, aucune recherche), puis réessayé", () => {
      const nav = navFactice({ libre: false, reponse: { etat: "echec" } });
      const m = memoireInitiale();
      expect(pointDeRoute(m, e0(nav), [60, -40])).toEqual([60, -40]);
      for (let k = 1; k < 20; k++) pointDeRoute(m, e0(nav, 10_000 + k * 400), [62, -41]); // même but à quelques mètres près
      expect(nav.appels.chercher).toBe(1);
      pointDeRoute(m, e0(nav, 10_000 + ECHEC_NAV_MS + 10), [60, -40]);
      expect(nav.appels.chercher).toBe(2);
      // un autre but, loin du premier, est cherché tout de suite
      pointDeRoute(m, e0(nav, 10_100), [-80, 30]);
      expect(nav.appels.chercher).toBe(3);
    });

    it("un bot qui oscille sans avancer (déplacement net sous 3 m en 5 s) abandonne l'objet visé, refait son chemin et part ailleurs", () => {
      const nav = navFactice({ libre: false, reponse: { etat: "ok", chemin } });
      const objets = [
        { id: 7, genre: "arme" as const, ref: "mitraillette" as const, p: [60, 0, -40] as Vec3 },
        { id: 8, genre: "arme" as const, ref: "fusil_assaut" as const, p: [-20, 0, 30] as Vec3 },
      ];
      let m = memoireInitiale();
      const alea = mulberry32(1);
      let ciblePremiere: number | null = null;
      // le bot va et vient sur 1 m autour de l'origine : il bouge de plus de 0,3 m par seconde (l'anti-coincage ne le voit pas) mais ne va nulle part
      for (let k = 0; k <= 130; k++) {
        const x = (k % 2) * 1;
        m = decider(m, base({ t: 10_000 + k * 50, nav, objets, moi: { ...base().moi, p: [x, 0, 0] } }), p, alea).m;
        if (k === 1) ciblePremiere = m.cibleButin;
        if (k === 130) expect(m.ignores[ciblePremiere!]).toBeGreaterThan(10_000 + 6_000);
      }
      expect(ciblePremiere).not.toBeNull();
      // l'autre objet prend le relais, et le premier n'est plus visé avant la fin du délai
      expect(m.cibleButin).not.toBe(ciblePremiere);
    });

    it("un bot qui avance vraiment (plus de 3 m en 5 s) n'abandonne rien", () => {
      const nav = navFactice({ libre: false, reponse: { etat: "ok", chemin } });
      const objets = [{ id: 7, genre: "arme" as const, ref: "mitraillette" as const, p: [60, 0, -40] as Vec3 }];
      let m = memoireInitiale();
      const alea = mulberry32(1);
      for (let k = 0; k <= 130; k++) m = decider(m, base({ t: 10_000 + k * 50, nav, objets, moi: { ...base().moi, p: [k * 0.2, 0, 0] } }), p, alea).m;
      expect(m.ignores[7]).toBeUndefined();
      expect(m.cibleButin).toBe(7);
    });

    it("le suivi ne recule jamais : tout ce qui précède le point visé est retiré du chemin", () => {
      const nav: NavBot = { ...navFactice({ libre: false, reponse: { etat: "ok", chemin } }), viser: (_de, ch) => ch[2] };
      const m = memoireInitiale();
      expect(pointDeRoute(m, e0(nav), [60, -40])).toEqual([60, -40]);
      expect(m.chemin).toEqual([[60, -40]]);
    });

    it("un bot coincé refait son chemin", () => {
      const nav = navFactice({ libre: false, reponse: { etat: "ok", chemin } });
      let m = memoireInitiale();
      const alea = mulberry32(1);
      const zone = { centre: [60, -40] as [number, number], rayon: 5 };
      for (let k = 0; k < 40; k++) m = decider(m, base({ t: 10_000 + k * 50, nav, zone }), p, alea).m; // 2 s sans bouger
      expect(m.detourJusqua).toBeGreaterThan(10_000);
      // le chemin est invalidé par le coincage (vers 1 s) et refait à la décision suivante, bien avant les 2,5 s du recalcul périodique
      expect(nav.appels.chercher).toBe(2);
    });
  });

  describe("niveaux", () => {
    it("un seul tableau, du plus faible au plus fort : réaction ≤ 350 ms (fenêtre de rejeu du serveur), précision et rafales croissantes", () => {
      const [e, pl, go] = [NIVEAUX_BOT.entree, NIVEAUX_BOT.plat, NIVEAUX_BOT.goulaf];
      for (const n of [e, pl, go]) expect(n.reactionMs).toBeLessThanOrEqual(350);
      expect(e.reactionMs).toBeGreaterThan(pl.reactionMs);
      expect(pl.reactionMs).toBeGreaterThan(go.reactionMs);
      expect(e.sigmaDeg).toBeGreaterThan(pl.sigmaDeg);
      expect(pl.sigmaDeg).toBeGreaterThan(go.sigmaDeg);
      expect(e.rotationMax).toBeLessThan(go.rotationMax);
      expect(e.rafaleMax).toBeLessThan(pl.rafaleMax);
      expect(e.pauseMs).toBeGreaterThan(go.pauseMs);
    });

    it("sur 400 décisions face à une cible à 40 m, Goulaf tire plus souvent et plus juste qu'Entrée", () => {
      const run = (niv: typeof p) => {
        const alea = mulberry32(21);
        let m = memoireInitiale();
        let lacet = 0, tirs = 0, justes = 0;
        for (let k = 0; k < 400; k++) {
          const r = decider(m, base({ t: 10_000 + k * 50, moi: arme({ lacet }), percus: [percu("e", [0, 0, -40])], munitions: plein }), niv, alea);
          m = r.m; lacet = r.c.lacet;
          if (r.c.tirer) { tirs++; if (Math.abs(r.c.lacet) < 0.5 * Math.PI / 180) justes++; }
        }
        return { tirs, justes };
      };
      const faible = run(NIVEAUX_BOT.entree), fort = run(NIVEAUX_BOT.goulaf);
      expect(fort.tirs).toBeGreaterThan(faible.tirs);
      expect(fort.justes / Math.max(1, fort.tirs)).toBeGreaterThan(faible.justes / Math.max(1, faible.tirs));
    });
  });
});
