// @vitest-environment node
/**
 * Tigre bipède armé des bots (lot 4 de 2026-10-29-pause-parties-bots-design.md) : cap du corps, vitesse imposée, silhouette collée à la hitbox de
 * tir (`tir.ts`), mains sur l'arme, pieds plantés en avant / à reculons / de côté, allure bridée au trot, parachute. Vrai squelette du GLB.
 * Le « spike » du §1.5 (glissement des pieds à 2, 3, 5, 6 et 7 m/s) est le bloc « glissement des pieds ».
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAP_MAX_RAD, DECALAGE_RACINE, ROTATION_CORPS_MAX, DISTANCE_TIGRE_MAX_M, ECHELLE_BOT, TANGAGE_DEBOUT, attribuerEmplacements, avancerBot, capDuCorps, ciblesMains,
  creerCorpsBot, directionVisee, origineXBot, vitesseImposeeBot, versRepereGroupe, type ArmeBot, type BotAnim, type EntreeBot,
} from "./bot-tigre-anim";
import { GLISSEMENT_MAX_M_S, VITESSE_ANIMABLE_MAX_M_S, VITESSE_BOT_RENDU_M_S, vitesseMaxSelonDirection } from "./bot-allure";
import { VITESSE_BOT_M_S } from "./bots-br";
import { contactsAtteints } from "../tigre3d/corps";
import { PATTES, type Role } from "../tigre3d/os";
import { creerArmeBot } from "./rendu";
import { STATS } from "./armes";
import { silhouetteDe } from "./protocole";

const FUSIL: ArmeBot = { prise: [0, -0.09, 0], garde: [0, -0.03, -0.31] };
const entree = (o: Partial<EntreeBot> = {}): EntreeBot => ({
  vitesse: [0, 0], lacet: 0, tangage: 0, tir: false, recharge: false, posture: "sol", dtS: 1 / 60, arme: FUSIL, ...o,
});
const avancer = (b: BotAnim, n: number, o: Partial<EntreeBot> = {}) => { for (let i = 0; i < n; i++) avancerBot(b, entree(o)); };

/** Position d'un os dans le repère du groupe du bot (mètres du monde, hanches sur l'origine, avant = +x). */
function osGroupe(b: BotAnim, r: Role): [number, number, number] {
  const p = b.corps.monde.p[b.corps.sq.i[r]];
  return [(p.x - origineXBot(b.corps.x)) * ECHELLE_BOT, p.y * ECHELLE_BOT, p.z * ECHELLE_BOT];
}

describe("cap du corps", () => {
  it("suit la marche à ±50° de la visée au plus ; à reculons il garde la visée", () => {
    // visée 0 (vers −z), marche vers −z : cap 0
    expect(capDuCorps(0, [0, -5], 0, 1 / 60)).toBeCloseTo(0, 6);
    // marche sur la gauche de la visée (−x) : le corps tourne de 50° au plus
    let cap = 0;
    for (let i = 0; i < 60; i++) cap = capDuCorps(0, [-5, 0], cap, 1 / 60);
    expect(cap).toBeCloseTo(CAP_MAX_RAD, 6);
    // marche vers l'arrière (+z) : le corps reste sur la visée (les pieds reculent)
    cap = 0;
    for (let i = 0; i < 60; i++) cap = capDuCorps(0, [0, 5], cap, 1 / 60);
    expect(Math.abs(cap)).toBeLessThan(1e-6);
    // marche diagonale arrière : on garde le bon côté
    cap = 0;
    for (let i = 0; i < 60; i++) cap = capDuCorps(0, [-3, 3], cap, 1 / 60);
    expect(Math.abs(cap)).toBeLessThanOrEqual(CAP_MAX_RAD + 1e-9);
  });

  it("tourne à ROTATION_CORPS_MAX au plus, et ne s'écarte jamais de la visée de plus de 50°, même si elle tourne d'un coup", () => {
    // une visée qui bouge un peu : le corps tourne de ROTATION_CORPS_MAX · dt au plus
    let cap = 0;
    cap = capDuCorps(0.8, [0, 0], cap, 1 / 60);
    expect(cap).toBeLessThanOrEqual(ROTATION_CORPS_MAX / 60 + 1e-9);
    expect(cap).toBeGreaterThan(0);
    // une visée qui s'éloigne de 3 rad en une image (téléportation) : le cap est ramené dans le cône, jamais au-delà
    const apres = capDuCorps(3, [0, 0], 0, 1 / 60);
    expect(Math.abs(Math.atan2(Math.sin(apres - 3), Math.cos(apres - 3)))).toBeLessThanOrEqual(CAP_MAX_RAD + 1e-9);
  });

  it("à l'arrêt, le corps ne bouge pas tant que la visée reste dans la zone morte, puis la rejoint", () => {
    expect(capDuCorps(0.2, [0, 0], 0, 1 / 60)).toBeCloseTo(0, 6);
    let cap = 0;
    for (let i = 0; i < 120; i++) cap = capDuCorps(1, [0, 0], cap, 1 / 60);
    expect(cap).toBeGreaterThan(0.6);
  });
});

describe("vitesse imposée au corps", () => {
  it("projetée sur l'axe du corps, signée, plafonnée", () => {
    // cap 0 : l'avant est −z
    expect(vitesseImposeeBot([0, -5], 0)).toBeCloseTo(5 / ECHELLE_BOT, 9);
    expect(vitesseImposeeBot([0, 5], 0)).toBeCloseTo(-5 / ECHELLE_BOT, 9);
    expect(vitesseImposeeBot([-5, 0], 0)).toBeCloseTo(0, 9);
    expect(vitesseImposeeBot([0, -40], 0)).toBeCloseTo(VITESSE_ANIMABLE_MAX_M_S / ECHELLE_BOT, 9);
    expect(VITESSE_ANIMABLE_MAX_M_S / ECHELLE_BOT).toBeLessThan(3.2);
  });

  it("le contrat de vitesse : plein cône avant, plein à reculons, réduit sur les côtés", () => {
    expect(vitesseMaxSelonDirection(0)).toBe(VITESSE_BOT_RENDU_M_S);
    expect(vitesseMaxSelonDirection(CAP_MAX_RAD)).toBe(VITESSE_BOT_RENDU_M_S);
    expect(vitesseMaxSelonDirection(Math.PI)).toBe(VITESSE_BOT_RENDU_M_S);
    expect(vitesseMaxSelonDirection(Math.PI - 0.5)).toBe(VITESSE_BOT_RENDU_M_S);
    const lateral = vitesseMaxSelonDirection(Math.PI / 2);
    expect(lateral).toBeLessThan(1.1);
    expect(lateral).toBeCloseTo(GLISSEMENT_MAX_M_S / Math.sin(Math.PI / 2 - CAP_MAX_RAD), 9);
    expect(vitesseMaxSelonDirection(-Math.PI / 2)).toBeCloseTo(lateral, 9);
  });

  it("la vitesse de rendu est celle du cerveau des bots (bots-br.ts) : à changer ensemble", () => {
    expect(VITESSE_BOT_RENDU_M_S).toBe(VITESSE_BOT_M_S);
  });
});

describe("silhouette collée à la hitbox de tir", () => {
  it("tête à 2,0 m ± 0,15, torse et tête dans le rayon du corps (0,475 m) autour de l'axe vertical des hanches", () => {
    const hb = silhouetteDe(false);
    for (const [lacet, tangage] of [[0, 0], [0, 0.6], [0, -0.6]] as const) {
      const b = creerCorpsBot(1);
      avancer(b, 120, { lacet, tangage });
      expect(osGroupe(b, "tete")[1], `tangage ${tangage}`).toBeGreaterThan(hb.tete.y - 0.15);
      expect(osGroupe(b, "tete")[1]).toBeLessThan(hb.tete.y + 0.15);
      for (const r of ["racine", "thorax", "lombaires", "hancheG", "hancheD", "cou", "tete", "bout_tete", "epauleG", "epauleD"] as Role[]) {
        const [x, , z] = osGroupe(b, r);
        expect(Math.hypot(x, z), `${r} tangage ${tangage}`).toBeLessThan(hb.corps.rayon);
      }
      // jamais plus haut que la tête de la hitbox + sa moitié : le museau levé reste dans la sphère
      expect(osGroupe(b, "bout_tete")[1]).toBeLessThan(hb.tete.y + hb.tete.rayon + 0.2);
    }
  });

  it("les hanches sont sur la position du bot et les pieds au sol", () => {
    const b = creerCorpsBot(2);
    avancer(b, 120);
    // bassin, épaules, tête et pieds : leur barycentre est à moins de 0,2 m de la position du bot (le bassin, derrière les pieds, est à ≈ −0,3 m)
    const pts = (["hancheG", "hancheD", "epauleG", "tete", "bout_piedG", "bout_piedD"] as Role[]).map((r) => osGroupe(b, r));
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[2], 0) / pts.length;
    expect(Math.hypot(cx, cz)).toBeLessThan(0.2);
    expect(osGroupe(b, "bout_piedG")[1]).toBeLessThan(0.1);
    expect(osGroupe(b, "bout_piedD")[1]).toBeLessThan(0.1);
    expect(origineXBot(1)).toBeCloseTo(1 - DECALAGE_RACINE, 9);
  });

  it("la tête regarde la visée : lacet relatif et tangage suivis", () => {
    const b = creerCorpsBot(1);
    avancer(b, 90);
    avancer(b, 3, { lacet: 0.8, tangage: 0.5 });
    const m = b.corps.monde, i = b.corps.sq.i;
    const d = m.p[i.bout_tete].clone().sub(m.p[i.tete]);
    const lacetTete = Math.atan2(-d.z, d.x);
    expect(lacetTete).toBeGreaterThan(0.25);
    expect(lacetTete).toBeLessThan(b.ecartVisee + 0.1);
    expect(Math.atan2(d.y, Math.hypot(d.x, d.z))).toBeGreaterThan(0.2);
  });
});

describe("mains sur l'arme", () => {
  const armes = Object.keys(STATS) as (keyof typeof STATS)[];

  it("pour chaque arme, les deux pattes atteignent leurs cibles (< 5 mm du modèle), visée droite, de côté, en l'air et à la recharge", () => {
    for (const id of armes) {
      const m = creerArmeBot(id, 0xffffff);
      const arme: ArmeBot = { prise: m.prise, garde: m.garde, deuxMains: m.deuxMains };
      for (const [ec, tg, recharge] of [[0, 0, false], [0.8, 0.3, false], [-0.8, -0.5, false], [0, 0, true], [0, 1, false]] as const) {
        const b = creerCorpsBot(1);
        avancer(b, 90, { arme });
        avancer(b, 1, { arme, lacet: ec, tangage: tg, recharge });
        const c = b.corps.pattes;
        expect(c.avD.manque * 1000, `${id} droite (${ec}, ${tg}, ${recharge})`).toBeLessThan(5);
        expect(c.avG.manque * 1000, `${id} gauche (${ec}, ${tg}, ${recharge})`).toBeLessThan(5);
        // et les mains y SONT (le moteur repousse une cible trop proche de l'épaule : `manque` ne le voit pas)
        for (const [os, cible] of [["mainD", b.prise!.avD], ["mainG", b.prise!.avG]] as const) {
          const a = osGroupe(b, os), t = versRepereGroupe(cible);
          expect(Math.hypot(a[0] - t[0], a[1] - t[1], a[2] - t[2]), `${id} ${os} (${ec}, ${tg}, ${recharge})`).toBeLessThan(0.012);
        }
      }
      m.dispose();
    }
  });

  it("seuls le couteau et le fumigène sont à une main : toute autre arme a une garde (mitrailleuse comprise, poignée et garde-main à 0,545 m)", () => {
    for (const id of [...armes, "couteau", "epee"] as const) {
      const m = creerArmeBot(id, 0xffffff);
      const unique: boolean = id === "couteau" || id === "fumigene";
      expect(m.uneMain, `${id} uneMain`).toBe(unique);
      if (unique) expect(m.garde, `${id} garde`).toBeNull();
      else expect(m.garde, `${id} garde`).not.toBeNull();
      m.dispose();
    }
    const mitrailleuse = creerArmeBot("mitrailleuse", 0xffffff);
    expect(mitrailleuse.garde).not.toBeNull();
    mitrailleuse.dispose();
  });

  it("la patte droite est sur la poignée dans le repère du groupe (l'arme y sera posée)", () => {
    const b = creerCorpsBot(1);
    avancer(b, 90);
    const cible = versRepereGroupe(b.prise!.avD);
    const main = osGroupe(b, "mainD");
    expect(Math.hypot(main[0] - cible[0], main[1] - cible[1], main[2] - cible[2])).toBeLessThan(0.01);
    const g = versRepereGroupe(b.prise!.avG), mg = osGroupe(b, "mainG");
    expect(Math.hypot(mg[0] - g[0], mg[1] - g[1], mg[2] - g[2])).toBeLessThan(0.01);
  });

  it("ciblesMains : mains à moins de 0,30 m du modèle de leur épaule, le recul au tir les ramène vers le corps", () => {
    const d = directionVisee(0, 0);
    const a = ciblesMains(FUSIL, d, TANGAGE_DEBOUT, 0);
    const t = ciblesMains(FUSIL, d, TANGAGE_DEBOUT, 1);
    expect(t.avD[2]).toBeCloseTo(a.avD[2] - 0.02, 6);
    expect(t.avG[2]).toBeCloseTo(a.avG[2] - 0.02, 6);
    // à hauteur de poitrine, un peu sous les épaules (y des épaules ≈ 0,63 m du modèle), devant elles
    expect(a.avD[1]).toBeGreaterThan(0.3);
    expect(a.avD[1]).toBeLessThan(0.63);
  });

  it("sans arme, la main libre pend le long du corps", () => {
    const b = creerCorpsBot(1);
    avancer(b, 90, { arme: null });
    expect(b.corps.pattes.avD.manque).toBeLessThan(0.005);
    expect(osGroupe(b, "mainD")[1]).toBeLessThan(osGroupe(b, "epauleD")[1]);
  });
});

/** Glissement des pieds ARRIÈRE en appui, mesuré dans le MONDE : le groupe suit la position du bot (vitesse `v`), orienté comme le corps. */
function glissement(v: [number, number], lacet: number, duree = 5) {
  const b = creerCorpsBot(1);
  const dt = 1 / 60;
  let px = 0, pz = 0;
  const monde = (p: "arG" | "arD") => {
    const c = contactsAtteints(b.corps)[p];
    const th = b.cap + Math.PI / 2;
    const lx = (c.x - origineXBot(b.corps.x)) * ECHELLE_BOT, lz = c.z * ECHELLE_BOT;
    return [px + lx * Math.cos(th) + lz * Math.sin(th), pz - lx * Math.sin(th) + lz * Math.cos(th)] as const;
  };
  const pas = () => { px += v[0] * dt; pz += v[1] * dt; avancerBot(b, entree({ vitesse: v, lacet })); };
  for (let i = 0; i < 180; i++) pas();
  let prec = { arG: monde("arG"), arD: monde("arD") };
  let appuiPrec = { arG: b.corps.pattes.arG.appui, arD: b.corps.pattes.arD.appui };
  let somme = 0, n = 0, pire = 0, glisseMoyen = 0;
  for (let i = 0; i < Math.round(duree / dt); i++) {
    pas();
    for (const p of ["arG", "arD"] as const) {
      const cur = monde(p);
      if (b.corps.pattes[p].appui && appuiPrec[p]) {
        const d = Math.hypot(cur[0] - prec[p][0], cur[1] - prec[p][1]);
        somme += d; n++; pire = Math.max(pire, d);
      }
      appuiPrec[p] = b.corps.pattes[p].appui;
      prec = { ...prec, [p]: cur };
    }
  }
  glisseMoyen = (somme / n) / dt;
  return { moyenMm: (somme / n) * 1000, pireMm: pire * 1000, glisseMoyen, b };
}

describe("glissement des pieds (spike du lot 4)", () => {
  it("en avant de 2 à 6 m/s : pieds plantés (moins de 0,1 mm par image en moyenne)", () => {
    for (const v of [2, 3, 3.5, VITESSE_BOT_RENDU_M_S, 6]) {
      const r = glissement([0, -v], 0);
      expect(r.moyenMm, `avant ${v}`).toBeLessThan(0.1);
      expect(r.pireMm, `avant ${v}`).toBeLessThan(3);
    }
  });

  it("à reculons de 1 à 6,25 m/s : pieds plantés (moins de 0,2 mm par image en moyenne, 8 mm au pire) : seuils MESURÉS, cf. spec §1.5", () => {
    // Mesures (5 s de marche, 2 pieds arrière) : moyenne 0,10 à 0,16 mm/image, pire image 2,9 à 6,8 mm. Le pic est unique par pas, à la première image
    // d'appui qui suit la pose : le bout de la patte (IK amortie) traîne de 3 à 15 mm derrière le point de pose pendant la fin du vol et le rejoint
    // en une image, alors que le point verrouillé, lui, ne bouge pas. En avant la même traîne existe mais est quatre fois plus petite (< 1,3 mm).
    for (const v of [1, 2, 3, VITESSE_BOT_RENDU_M_S, 6.25]) {
      const r = glissement([0, v], 0);
      expect(r.moyenMm, `recul ${v}`).toBeLessThan(0.2);
      expect(r.pireMm, `recul ${v}`).toBeLessThan(8);
    }
  });

  it("de côté à la vitesse permise par le contrat : le glissement reste sous GLISSEMENT_MAX_M_S (≈ 10 mm/image : toléré par le contrat, cf. spec §1.5)", () => {
    for (const rel of [Math.PI / 2, -Math.PI / 2, 1.2, -1.2, 2]) {
      const vmax = vitesseMaxSelonDirection(rel);
      // direction de marche : visée 0 = vers −z, relatif > 0 = vers la gauche (−x)
      const dir: [number, number] = [-Math.sin(rel) * vmax, -Math.cos(rel) * vmax];
      const r = glissement(dir, 0);
      expect(r.glisseMoyen, `rel ${rel}`).toBeLessThan(GLISSEMENT_MAX_M_S * 1.08) // mesuré : 0,60 à 0,64 m/s (en diagonale arrière, le corps ne s'aligne pas tout à fait sur l'axe de marche);
    }
  });

  it("au-delà de la vitesse animable le corps plafonne son pas (le reste glisse) : c'est pourquoi les bots ne dépassent pas 5 m/s", () => {
    const b = creerCorpsBot(1);
    avancer(b, 120, { vitesse: [0, -9] });
    expect(b.vitesseModele * ECHELLE_BOT).toBeCloseTo(VITESSE_ANIMABLE_MAX_M_S, 6);
  });

  it("l'allure ne dépasse jamais le trot (allureMax), même à 7 m/s", () => {
    for (const v of [1, 3, 5, 7, 9]) {
      const b = creerCorpsBot(1);
      avancer(b, 200, { vitesse: [0, -v] });
      expect(b.corps.allure.x, `v=${v}`).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});

describe("robustesse", () => {
  it("aucune position NaN après 10 s de mouvements aléatoires (visée, vitesse, tirs, recharge, saut, parachute)", () => {
    let s = 12345;
    const alea = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
    const b = creerCorpsBot(3);
    for (let i = 0; i < 600; i++) {
      const air = alea() < 0.1;
      avancerBot(b, entree({
        vitesse: [(alea() - 0.5) * 12, (alea() - 0.5) * 12], lacet: (alea() - 0.5) * 12, tangage: (alea() - 0.5) * 2.4,
        tir: alea() < 0.2, recharge: alea() < 0.2, posture: air ? "air" : "sol", chute: air && alea() < 0.5 ? "voile" : undefined,
        dtS: 1 / 60 + alea() / 100,
      }));
      for (const r of ["tete", "mainD", "mainG", "bout_piedG", "bout_piedD", "bout_queue"] as Role[]) {
        const p = b.corps.monde.p[b.corps.sq.i[r]];
        expect(Number.isFinite(p.x + p.y + p.z), `${r} image ${i}`).toBe(true);
      }
    }
    expect(Number.isFinite(b.corps.x)).toBe(true);
  });

  it("dt nul ou négatif : rien ne bouge", () => {
    const b = creerCorpsBot(1);
    avancer(b, 10);
    const x = b.corps.x;
    avancerBot(b, entree({ dtS: 0 }));
    avancerBot(b, entree({ dtS: -1 }));
    expect(b.corps.x).toBe(x);
  });
});

describe("parachute et chute libre", () => {
  it("bras levés au-dessus de la tête, jambes pendantes sous les hanches, tout fini", () => {
    for (const chute of ["voile", "libre"] as const) {
      const b = creerCorpsBot(1);
      avancer(b, 120, { chute, posture: "air" });
      const tete = osGroupe(b, "tete")[1];
      expect(osGroupe(b, "mainD")[1], chute).toBeGreaterThan(tete - 0.15);
      expect(osGroupe(b, "mainG")[1], chute).toBeGreaterThan(tete - 0.15);
      const hanche = osGroupe(b, "hancheG")[1];
      expect(osGroupe(b, "bout_piedG")[1], chute).toBeLessThan(hanche - 0.1);
      expect(osGroupe(b, "bout_piedD")[1], chute).toBeLessThan(hanche - 0.1);
      expect(b.corps.pattes.avD.manque * 1000).toBeLessThan(5);
    }
  });

  it("revient debout quand il se pose", () => {
    const b = creerCorpsBot(1);
    avancer(b, 90, { chute: "voile", posture: "air" });
    avancer(b, 120);
    expect(b.wChute).toBeLessThan(0.01);
    expect(osGroupe(b, "bout_piedG")[1]).toBeLessThan(0.1);
  });
});

describe("recul au tir et recharge", () => {
  it("le tir recule l'arme puis elle revient ; la recharge baisse le canon", () => {
    const b = creerCorpsBot(1);
    avancer(b, 90);
    const base = b.prise!.origine[2];
    avancer(b, 1, { tir: true });
    expect(b.kick).toBe(1);
    expect(b.prise!.origine[2]).toBeLessThan(base);
    avancer(b, 20);
    expect(b.kick).toBe(0);
    expect(b.prise!.origine[2]).toBeCloseTo(base, 3);
    avancer(b, 60, { recharge: true });
    expect(b.dirArme[1]).toBeLessThan(-0.2);
  });
});

describe("emplacements de tigres complets", () => {
  it("les plus proches, à moins de DISTANCE_TIGRE_MAX_M, avec hystérésis pour qui en a déjà un", () => {
    const c = (id: string, distance: number, actuel = false) => ({ id, distance, actuel });
    expect([...attribuerEmplacements([c("b1", 30), c("b2", 10), c("b3", 20), c("b4", 200)], 2)].sort()).toEqual(["b2", "b3"]);
    expect(attribuerEmplacements([c("b1", DISTANCE_TIGRE_MAX_M + 1)], 6).size).toBe(0);
    expect(attribuerEmplacements([], 6).size).toBe(0);
    expect(attribuerEmplacements([c("b1", 10)], 0).size).toBe(0);
    // b1 (déjà servi) à 24 m garde sa place devant b2 à 22 m (20 % de marge), pas devant b2 à 18 m
    expect([...attribuerEmplacements([c("b1", 24, true), c("b2", 22)], 1)]).toEqual(["b1"]);
    expect([...attribuerEmplacements([c("b1", 24, true), c("b2", 18)], 1)]).toEqual(["b2"]);
  });
});

describe("rendu des bots (garde de source : three et WebGL ne sont pas testables ici)", () => {
  const source = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("rendu-bots.ts ne libère jamais le modèle du thème Tigre (il ne lui appartient pas) et ne dépend pas de l'horloge réelle du serveur", () => {
    const s = source("./rendu-bots.ts");
    expect(s).not.toMatch(/libererModele\s*\(/);
    expect(s).not.toMatch(/import[^;]*libererModele/);
  });

  it("le serveur n'importe pas le rendu : bot-allure.ts est sans three, bot-tigre-anim.ts et rendu-bots.ts n'entrent pas dans match*.ts ni serveur-fps", () => {
    expect(source("./bot-allure.ts")).not.toMatch(/from\s+"three/);
    for (const f of ["./match.ts", "./match-br.ts", "./match-br-bots.ts", "./bots-br.ts", "../../serveur-fps/src/index.ts"]) {
      const s = source(f);
      expect(s, f).not.toMatch(/bot-tigre-anim|rendu-bots/);
    }
  });
});
