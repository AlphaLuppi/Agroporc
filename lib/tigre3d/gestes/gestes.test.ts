import { describe, it, expect } from "vitest";
import { Quaternion, Euler, Vector3 } from "three";
import { GESTES, GESTES_ARENE } from "./index";
import { solVersCorps, extremiteMonde, patteAuSol, deltasDepuisClip, assis, echelon, aller, repos } from "./outils";
import { creerCorps, avancerCorps, type Couche } from "../corps";
import { creerAnimateur } from "../animateur";
import { GROUPES, type Groupe } from "../os";
import { squelette } from "../squelette";
import { POIDS_REACTIONS, TEXTES, tirerReaction, type Reaction } from "../../tigre-reactions";
import { griffe } from "./griffe";
import type { ContexteGeste, PoseGeste } from "./types";

const ctx = (o: Partial<ContexteGeste> = {}): ContexteGeste => ({
  sens: 1, tClap: null, tVexe: null, humeur: "curieux", clip: () => null, temps: 0, ...o,
});
const poidsUn = Object.fromEntries(GROUPES.map((g) => [g, 1])) as Record<Groupe, number>;

/** Corps à l'arrêt face caméra, une pose de geste tenue à poids 1 pendant `s` secondes. */
function tenir(pose: PoseGeste, s = 1.2) {
  const c = creerCorps({ cap: 0 });
  const couches: Couche[] = [{ pose, poids: { ...poidsUn, ...(pose.poids ?? {}) } as Record<Groupe, number> }];
  for (let i = 0; i < Math.round(s * 60); i++) avancerCorps(c, 1 / 60, { vitesse: 0, sens: 1, cap: 0, regard: 0, couches });
  return c;
}

describe("outils des gestes", () => {
  it("solVersCorps : une patte tenue au sol y reste quand le corps s'assoit", () => {
    const co = assis(1);
    const c = tenir({ corps: co, pattes: { avG: patteAuSol(co, "avG", 0, -0.1) } });
    const main = c.monde.p[c.sq.i.mainG];
    const r = repos("mainG");
    expect(main.y).toBeCloseTo(r[1], 2);
    expect(main.z - (r[2] - 0.1)).toBeCloseTo(0, 2);
    // Main à plat malgré le poitrail redressé : sa rotation monde reste celle du repos.
    const qRepos = c.sq.qModele[c.sq.i.mainG];
    expect(c.monde.q[c.sq.i.mainG].angleTo(qRepos)).toBeLessThan(0.08);
  });

  it("solVersCorps et extremiteMonde inversent la rotation du corps", () => {
    const co = { tangage: 0.4, roulis: -0.1, lacet: 0.3, dy: -0.1, dz: 0.02, pivot: "hanches" as const };
    const p = solVersCorps(co, [0.1, 0.3, 0.2]);
    // Retour au sol à la main : R · (p - pivot) + pivot + (0, dy, dz).
    const q = new Quaternion().setFromEuler(new Euler(-0.4, 0.3, -0.1, "YXZ"));
    const v = new Vector3(p[0], p[1] - 0.211, p[2] + 0.274).applyQuaternion(q).add(new Vector3(0, 0.211 - 0.1, -0.274 + 0.02));
    expect(v.x).toBeCloseTo(0.1, 6); expect(v.y).toBeCloseTo(0.3, 6); expect(v.z).toBeCloseTo(0.2, 6);
    const e = extremiteMonde(co, [0.5, 0, 0]);
    const qe = q.clone().multiply(new Quaternion().setFromEuler(new Euler(e[0], e[1], e[2], "XYZ")));
    expect(qe.angleTo(new Quaternion().setFromEuler(new Euler(0.5, 0, 0, "XYZ")))).toBeLessThan(1e-6);
  });

  it("deltasDepuisClip rend l'écart du clip au repos, dans la convention du moteur", () => {
    const sq = squelette();
    const k = sq.i.tete;
    const x = new Quaternion().setFromEuler(new Euler(0.2, -0.3, 0.4, "XYZ"));
    const clip = sq.qRepos[k].clone().multiply(x);
    const d = deltasDepuisClip({ os: { tete: [clip.x, clip.y, clip.z, clip.w] } }, ["tete"]).tete!;
    // Même formule que corps.ts (appliquerCouchesOs) : repos · (modèle⁻¹ · D · modèle).
    const qd = new Quaternion().setFromEuler(new Euler(d[0], d[1], d[2], "XYZ"));
    const q = sq.qRepos[k].clone().multiply(sq.qModele[k].clone().invert().multiply(qd).multiply(sq.qModele[k]));
    expect(q.angleTo(clip)).toBeLessThan(1e-5);
    // Le repos ne donne aucun delta.
    const r = sq.qRepos[k];
    const z = deltasDepuisClip({ os: { tete: [r.x, r.y, r.z, r.w] } }, ["tete"]).tete!;
    expect(Math.hypot(...z)).toBeLessThan(1e-6);
  });

  it("echelon : part de 0, dépasse un peu, se pose sur 1 ; aller revient à 0", () => {
    expect(echelon(-1, 0)).toBe(0);
    let max = 0;
    for (let t = 0; t < 2; t += 0.01) max = Math.max(max, echelon(t, 0, 14, 0.55));
    expect(max).toBeGreaterThan(1.02);
    expect(max).toBeLessThan(1.2);
    expect(echelon(3, 0)).toBeCloseTo(1, 4);
    expect(aller(5, 0, 1)).toBeCloseTo(0, 4);
  });
});

describe("griffe (tigre zombie)", () => {
  it("est enregistrée hors du thème Tigre (poids nul : ni réaction, ni tirage), dure 0,55 s et ne retient pas le tigre", () => {
    expect(GESTES_ARENE.griffe).toBe(griffe);
    // jamais une réaction du thème : absente du tirage, du registre des réactions, sans bulle
    expect(POIDS_REACTIONS.some(([n]) => (n as string) === "griffe")).toBe(false);
    expect((GESTES as Record<string, unknown>).griffe).toBeUndefined();
    for (let a = 0; a < 1; a += 0.01) expect(tirerReaction(a) as string).not.toBe("griffe");
    expect(griffe.evenements ?? []).toEqual([]);
    expect(griffe.duree).toBeCloseTo(0.55, 6);
    expect(griffe.immobile).toBe(false);
  });

  it("la patte avant droite se lève et part en arrière, puis claque vers l'avant et vers le bas, puis revient", () => {
    const main = (t: number) => {
      const c = tenir(griffe.echantillonner(t, ctx()), 0.8);
      return { y: c.monde.p[c.sq.i.mainD].y, z: c.monde.p[c.sq.i.mainD].z };
    };
    const r = repos("mainD");
    const arme = main(0.22);
    const frappe = main(0.4);
    const fin = main(0.55);
    expect(arme.y).toBeGreaterThan(r[1] + 0.2);
    expect(arme.z).toBeLessThan(r[2] + 0.02);
    expect(frappe.z).toBeGreaterThan(arme.z + 0.15);
    expect(frappe.y).toBeLessThan(arme.y - 0.2);
    expect(Math.abs(fin.y - r[1])).toBeLessThan(0.06);
    // l'autre patte avant n'est pas touchée par le geste
    expect(Object.keys(griffe.echantillonner(0.3, ctx()).pattes ?? {})).toEqual(["avD"]);
  });
});

describe("gestes", () => {
  it("chaque réaction a son geste, sa bulle pendant le geste, et des poses finies", () => {
    for (const [nom] of POIDS_REACTIONS) {
      const g = GESTES[nom as Reaction];
      expect(g, nom).toBeDefined();
      const bulles = (g.evenements ?? []).filter((e) => e.type === "bulle");
      // Une bulle par geste ; le serre-main en a une par phase de la vidéo, chacune avec son texte.
      // La batte n'en a aucune avant le coup : « BONK ! » part à l'impact (cf. batte.test.ts).
      if (nom === "serre-main") expect(bulles.every((b) => b.type === "bulle" && !!b.texte), nom).toBe(true);
      else if (nom !== "batte") expect(bulles.length, nom).toBe(1);
      if (bulles.length) expect(bulles.at(-1)!.t).toBeLessThan(g.duree);
      for (let t = 0; t <= g.duree + 0.5; t += 0.05) {
        const p = g.echantillonner(t, ctx({ temps: t }));
        // JSON.stringify écrit NaN et ±Infinity en null.
        expect(JSON.stringify(p), `${nom} t=${t}`).not.toMatch(/null/);
      }
    }
  });

  it("les gestes à l'arrêt tournent le tigre vers nous (jamais de profil)", () => {
    for (const [nom] of POIDS_REACTIONS) {
      const g = GESTES[nom as Reaction];
      // La batte, elle, se joue de profil face à Macron (cf. batte.test.ts).
      if (!g.immobile || nom === "batte") continue;
      for (const sens of [1, -1] as const) expect(Math.abs(g.cap!(sens)), nom).toBeLessThan(0.7);
    }
    expect(GESTES.tape.cap!(1)).toBe(0);
  });

  it("tape : patte levée à hauteur de joue, coussinets vers l'écran ; le clap la pousse vers nous", () => {
    const tenue = tenir(GESTES.tape.echantillonner(1.4, ctx()));
    const sq = tenue.sq, k = sq.i.mainG;
    const main = tenue.monde.p[k];
    expect(main.y).toBeGreaterThan(0.38);
    // Normale des coussinets : -Y de la main au repos, tournée par sa rotation monde.
    const pad = new Vector3(0, -1, 0).applyQuaternion(sq.qModele[k].clone().invert()).applyQuaternion(tenue.monde.q[k]);
    expect(pad.z).toBeGreaterThan(0.6);
    const clap = tenir(GESTES.tape.echantillonner(1.5, ctx({ tClap: 1.4 })), 1.2);
    // Échantillonné juste après le second clic, la patte est plus près de l'écran.
    const pz = (c: ReturnType<typeof tenir>) => c.monde.p[c.sq.i.mainG].z;
    expect(pz(clap)).toBeGreaterThan(pz(tenue) + 0.05);
    // Vexé : la patte est retombée au sol.
    const vexe = tenir(GESTES.tape.echantillonner(4.0, ctx({ tVexe: 3.2 })));
    expect(vexe.monde.p[vexe.sq.i.mainG].y).toBeLessThan(0.07);
  });

  it("lecher : la patte monte jusqu'à la bouche", () => {
    // Milieu de la main (poignet → bout des doigts) : la langue est dessus (au repos : ≈ 0,37 m),
    // au plus près à chaque coup de langue.
    let d = Infinity;
    for (const t of [1.0, 1.1, 1.2, 1.3]) {
      const c = tenir(GESTES.lecher.echantillonner(t, ctx()));
      const main = c.monde.p[c.sq.i.mainG].clone().add(c.monde.p[c.sq.i.bout_mainG]).multiplyScalar(0.5);
      d = Math.min(d, main.distanceTo(c.monde.p[c.sq.i.bout_machoire]));
    }
    expect(d).toBeLessThan(0.1);
  });

  it("etirement : poitrail au sol, pattes avant tendues devant", () => {
    const c = tenir(GESTES.etirement.echantillonner(1.4, ctx()), 2);
    const r = repos("mainG");
    expect(c.monde.p[c.sq.i.thorax].y).toBeLessThan(repos("thorax")[1] - 0.08);
    expect(c.monde.p[c.sq.i.mainG].z).toBeGreaterThan(r[2] + 0.1);
    expect(c.monde.p[c.sq.i.mainG].y).toBeCloseTo(r[1], 1);
  });

  it("sursaut : il retombe retourné, sans piétiner, et la bulle dit sa peur", () => {
    const a = creerAnimateur({ vitesse: 2.4, alea: () => 0.3, graine: 1 });
    const textes: string[] = [];
    a.sur((e) => { if (e.type === "bulle") textes.push(e.texte); });
    for (let i = 0; i < 30; i++) a.maj(1 / 60);
    a.clic("sursaut");
    // Tout de suite après la réception, épaules et bassin regardent déjà l'autre bord.
    for (let i = 0; i < Math.round(0.8 * 60); i++) a.maj(1 / 60);
    expect(a.sens).toBe(-1);
    expect(Math.abs(a.corps.psiE.x - -Math.PI / 2) % (2 * Math.PI)).toBeLessThan(0.25);
    expect(Math.abs(a.corps.psiB.x - -Math.PI / 2) % (2 * Math.PI)).toBeLessThan(0.35);
    expect(TEXTES.sursaut).toContain(textes[0]);
  });

  it("saut : le corps s'envole au-dessus de sa hauteur de course", () => {
    const a = creerAnimateur({ vitesse: 2.4, alea: () => 0.3, graine: 1 });
    for (let i = 0; i < 30; i++) a.maj(1 / 60);
    let yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < 60; i++) { a.maj(1 / 60); yMin = Math.min(yMin, a.corps.monde.p[a.corps.sq.i.racine].y); }
    a.clic("saut");
    for (let i = 0; i < 60; i++) { a.maj(1 / 60); yMax = Math.max(yMax, a.corps.monde.p[a.corps.sq.i.racine].y); }
    expect(yMax - yMin).toBeGreaterThan(0.15);
  });
});
