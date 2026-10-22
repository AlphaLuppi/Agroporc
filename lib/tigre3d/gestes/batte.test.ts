/**
 * Geste « batte » (coup de batte sur Macron) : pose dressée, batte armée puis coup montant vers
 * l'avant, événements datés depuis le signal, apparition et disparition de la batte, et
 * pilotage par l'animateur (signal, interruption, attente trop longue).
 */
import { describe, it, expect } from "vitest";
import { Vector3 } from "three";
import { GESTES } from "./index";
import {
  APPARITION_BATTE, ATTENTE_MAX_BATTE, AVANCE_CONTACT, DUREE_COUP, EVENEMENTS_BATTE, FIN_COUP, LONGUEUR_BATTE, POIGNEE_BATTE,
  POINT_CONTACT, PRET_BATTE, SORTIE_BATTE, T_IMPACT, etatBatte,
} from "./batte";
import { creerCorps, avancerCorps, type Couche } from "../corps";
import { creerAnimateur, type EvenementTigre } from "../animateur";
import { GROUPES, type Groupe } from "../os";
import { DELAI_BULLE, POIDS_REACTIONS, tirerReaction } from "../../tigre-reactions";
import type { ContexteGeste, PoseGeste } from "./types";

const g = GESTES.batte;
const ctx = (o: Partial<ContexteGeste> = {}): ContexteGeste => ({
  sens: 1, tClap: null, tVexe: null, humeur: "curieux", clip: () => null, temps: 0, ...o,
});
const poidsUn = Object.fromEntries(GROUPES.map((x) => [x, 1])) as Record<Groupe, number>;

/** Corps à l'arrêt face caméra (cap 0 : l'avant du tigre est +Z), pose du geste tenue `s` secondes. */
function tenir(pose: PoseGeste, s = 1.2) {
  const c = creerCorps({ cap: 0 });
  const couches: Couche[] = [{ pose, poids: { ...poidsUn, ...(pose.poids ?? {}) } as Record<Groupe, number> }];
  for (let i = 0; i < Math.round(s * 60); i++) avancerCorps(c, 1 / 60, { vitesse: 0, sens: 1, cap: 0, regard: 0, couches });
  return c;
}

/** Point de la batte (part `k` de sa longueur depuis le manche), tenue au milieu de la patte droite. */
function pointBatte(c: ReturnType<typeof tenir>, angle: number, k: number) {
  const main = c.monde.p[c.sq.i.mainD].clone().lerp(c.monde.p[c.sq.i.bout_mainD], 0.5);
  const dir = new Vector3(0, Math.sin(angle), Math.cos(angle));
  return main.clone().addScaledVector(dir, (k - POIGNEE_BATTE) * LONGUEUR_BATTE);
}

describe("geste batte", () => {
  it("n'est jamais tiré au clic : poids nul, aucune bulle avant le coup", () => {
    expect(POIDS_REACTIONS.find(([r]) => r === "batte")![1]).toBe(0);
    for (let a = 0; a < 1; a += 0.01) expect(tirerReaction(a)).not.toBe("batte");
    expect((g.evenements ?? []).length).toBe(0);
  });

  it("se joue de profil, face au sens donné (Macron)", () => {
    expect(g.immobile).toBe(true);
    expect(g.cap!(1)).toBeCloseTo(Math.PI / 2, 6);
    expect(g.cap!(-1)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it("à l'impact : contact, secousse, éclats et bulle « BONK ! », pendant le coup", () => {
    const types = EVENEMENTS_BATTE.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["impact", "secousse", "particules", "bulle"]));
    for (const e of EVENEMENTS_BATTE) expect(e.t).toBeCloseTo(T_IMPACT, 6);
    expect(EVENEMENTS_BATTE.find((e) => e.type === "bulle")).toMatchObject({ texte: "BONK !" });
    expect(T_IMPACT).toBeGreaterThan(0.25);
    expect(T_IMPACT).toBeLessThan(FIN_COUP);
    expect(DELAI_BULLE.batte / 1000).toBeCloseTo(T_IMPACT, 1);
    expect(DUREE_COUP).toBeCloseTo(FIN_COUP + SORTIE_BATTE, 6);
  });

  it("poses finies, avec ou sans signal, et après l'abandon", () => {
    for (const c of [ctx(), ctx({ tClap: 1.5 }), ctx({ tVexe: 2 })]) {
      for (let t = 0; t <= g.duree + 1; t += 0.05) {
        expect(JSON.stringify(g.echantillonner(t, { ...c, temps: t })), `t=${t}`).not.toMatch(/null/);
        const b = etatBatte(t, c);
        expect(Number.isFinite(b.echelle) && Number.isFinite(b.angle)).toBe(true);
      }
    }
  });

  it("la batte apparaît en 0,15 s quand il se dresse, disparaît à la sortie", () => {
    expect(etatBatte(APPARITION_BATTE.debut - 0.01, ctx()).echelle).toBe(0);
    expect(etatBatte(APPARITION_BATTE.debut + 0.075, ctx()).echelle).toBeGreaterThan(0.2);
    expect(etatBatte(APPARITION_BATTE.debut + 0.3, ctx()).echelle).toBeCloseTo(1, 2);
    // Pas de saut d'échelle d'une image à l'autre.
    let saut = 0, prec = 0;
    for (let t = 0; t < 1; t += 1 / 60) { const e = etatBatte(t, ctx()).echelle; saut = Math.max(saut, Math.abs(e - prec)); prec = e; }
    expect(saut).toBeLessThan(0.25);
    expect(etatBatte(1.5 + FIN_COUP + 0.2, ctx({ tClap: 1.5 })).echelle).toBe(0);
    expect(etatBatte(2.2, ctx({ tVexe: 2 })).echelle).toBe(0);
    expect(etatBatte(ATTENTE_MAX_BATTE + 0.2, ctx()).echelle).toBe(0);
  });

  it("dressé, la batte armée au-dessus de l'épaule, dressée vers le haut et un peu en arrière", () => {
    const c = tenir(g.echantillonner(1.2, ctx({ temps: 1.2 })), 1.5);
    const m = c.monde, i = c.sq.i;
    // Dressé : épaules hautes, pattes arrière au sol.
    expect(m.p[i.thorax].y).toBeGreaterThan(0.55);
    expect(m.p[i.bout_piedD].y).toBeLessThan(0.05);
    expect(m.p[i.bout_piedG].y).toBeLessThan(0.05);
    // Les deux pattes avant tiennent le manche : levées, proches l'une de l'autre.
    expect(m.p[i.mainD].y).toBeGreaterThan(0.6);
    expect(m.p[i.mainD].distanceTo(m.p[i.mainG])).toBeLessThan(0.1);
    const { angle } = etatBatte(1.2, ctx());
    const bout = pointBatte(c, angle, 1);
    // Le bout dépasse au-dessus de la tête, en arrière des pattes.
    expect(bout.y).toBeGreaterThan(m.p[i.tete].y + 0.05);
    expect(bout.z).toBeLessThan(m.p[i.mainD].z);
  });

  it("au contact : batte devant lui, légèrement montante, à hauteur de buste, jamais dans le sol", () => {
    const tClap = 1.2;
    const t = tClap + T_IMPACT;
    const c = tenir(g.echantillonner(t, ctx({ tClap, temps: t })), 1.2);
    const { angle } = etatBatte(t, ctx({ tClap }));
    expect(Math.sin(angle)).toBeGreaterThan(0);
    expect(Math.cos(angle)).toBeGreaterThan(0.95);
    const contact = pointBatte(c, angle, POINT_CONTACT);
    // Devant lui (le centre du corps est à z = 0), à la distance que la rencontre suppose.
    expect(contact.z).toBeCloseTo(AVANCE_CONTACT, 1);
    expect(contact.y).toBeGreaterThan(0.4);
    // Pendant tout le coup, la batte reste au-dessus du sol.
    for (let s = 0; s < FIN_COUP; s += 0.02) {
      const tt = tClap + s;
      const cc = tenir(g.echantillonner(tt, ctx({ tClap, temps: tt })), 0.6);
      const a = etatBatte(tt, ctx({ tClap })).angle;
      expect(pointBatte(cc, a, 1).y, `s=${s.toFixed(2)}`).toBeGreaterThan(0.02);
    }
  });
});

describe("batte pilotée par l'animateur", () => {
  function animateur() {
    const a = creerAnimateur({ vitesse: 2.4, alea: () => 0.3, graine: 1 });
    const evs: EvenementTigre[] = [];
    a.sur((e) => evs.push(e));
    return { a, evs };
  }
  const avancer = (a: ReturnType<typeof creerAnimateur>, s: number, f?: () => void) => {
    for (let i = 0; i < Math.round(s * 60); i++) { a.maj(1 / 60); f?.(); }
  };

  it("il s'arrête au point imposé, se tourne vers Macron (derrière lui), frappe au signal", () => {
    const { a, evs } = animateur();
    avancer(a, 0.5);
    const xArret = a.corps.x + 0.8;
    a.demarrer("batte", { sensGeste: -1, xArret });
    expect(a.signaler()).toBe(false);
    let tPret = -1;
    avancer(a, 4, () => {
      const r = a.reaction;
      if (tPret < 0 && r?.tGeste != null && a.t - r.tGeste >= PRET_BATTE) tPret = a.t;
    });
    expect(tPret).toBeGreaterThan(0);
    // Près du point (il freine puis piétine pour se retourner) : le coup se cale ensuite sur sa
    // position réelle (lib/rencontre.ts, declencherFrappe), pas sur le point visé.
    expect(Math.abs(a.corps.x - xArret)).toBeLessThan(0.25);
    // De profil vers −x (Macron derrière lui), alors qu'il courait vers +x.
    expect(Math.abs(a.corps.psiE.x - -Math.PI / 2)).toBeLessThan(0.3);
    expect(a.sens).toBe(1);
    expect(a.signaler()).toBe(true);
    expect(a.signaler()).toBe(false);
    avancer(a, T_IMPACT + 0.05);
    expect(evs.filter((e) => e.type === "impact").length).toBe(1);
    expect(evs.some((e) => e.type === "bulle" && e.texte === "BONK !")).toBe(true);
    expect(evs.some((e) => e.type === "secousse")).toBe(true);
    expect(evs.some((e) => e.type === "particules" && e.genre === "clap")).toBe(true);
    avancer(a, DUREE_COUP);
    expect(a.reaction).toBeNull();
    expect(evs.filter((e) => e.type === "impact").length).toBe(1);
    expect(evs.at(-1)).toMatchObject({ type: "fin", reaction: "batte" });
  });

  it("interrompue pendant l'approche, elle s'arrête net, armée il baisse la batte et repart", () => {
    const { a, evs } = animateur();
    avancer(a, 0.5);
    a.demarrer("batte", { sensGeste: 1 });
    avancer(a, 0.1);
    a.interrompre();
    expect(a.reaction).toBeNull();
    expect(evs.at(-1)).toMatchObject({ type: "fin", reaction: "batte" });

    const b = animateur();
    avancer(b.a, 0.5);
    b.a.demarrer("batte", { sensGeste: 1 });
    avancer(b.a, 3);
    expect(b.a.reaction?.tGeste).not.toBeNull();
    b.a.interrompre();
    expect(b.a.signaler()).toBe(false);
    avancer(b.a, SORTIE_BATTE + 0.05);
    expect(b.a.reaction).toBeNull();
    expect(b.evs.some((e) => e.type === "impact")).toBe(false);
  });

  it("sans signal, il abandonne après l'attente maximale", () => {
    const { a, evs } = animateur();
    avancer(a, 0.5);
    a.demarrer("batte", { sensGeste: 1 });
    avancer(a, 3 + ATTENTE_MAX_BATTE + SORTIE_BATTE);
    expect(a.reaction).toBeNull();
    expect(evs.some((e) => e.type === "impact")).toBe(false);
  });
});
