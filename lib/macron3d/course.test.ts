import { describe, it, expect } from "vitest";
import { creerCourse, splineHermite, tangageAppui, MESURES, REGLAGES, DEG, type IntentionsCourse, type Vec } from "./course";
import { COTES } from "./os";

const DT = 1 / 120;
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copie = (v: Vec): Vec => ({ ...v });
/** Pivot du talon (au sol, sous l'arrière du talon) d'un pied rigide, d'après la cheville. */
function talonDe(p: IntentionsCourse["pieds"]["G"]): Vec {
  const a = MESURES.talon.arriere, b = MESURES.talon.bas, c = Math.cos(p.tangage), s = Math.sin(p.tangage);
  const av = a * c - b * s, ht = a * s + b * c;
  const cl = Math.cos(p.lacet), sl = Math.sin(p.lacet);
  return { x: p.cheville.x - av * sl, y: p.cheville.y - ht, z: p.cheville.z - av * cl };
}

/** Déroule `secondes` de course et retourne les états successifs. */
function derouler(secondes: number, reglages = {}) {
  const c = creerCourse(reglages);
  const etats: IntentionsCourse[] = [];
  for (let k = 0; k < secondes / DT; k++) {
    c.avancer(DT);
    const e = c.etat();
    etats.push({ ...e, pieds: { G: { ...e.pieds.G, cheville: copie(e.pieds.G.cheville) }, D: { ...e.pieds.D, cheville: copie(e.pieds.D.cheville) } } });
  }
  return etats;
}

describe("cycle de course", () => {
  const etats = derouler(4, { graine: 7 });

  it("alterne appui et vol, avec une vraie phase de vol (aucun pied au sol)", () => {
    const vol = etats.filter((e) => !e.pieds.G.appui && !e.pieds.D.appui).length / etats.length;
    const double = etats.filter((e) => e.pieds.G.appui && e.pieds.D.appui).length;
    expect(vol).toBeGreaterThan(0.25);
    expect(vol).toBeLessThan(0.55);
    expect(double).toBe(0);
    // Les deux pieds se posent tour à tour, une fois par foulée chacun.
    for (const c of COTES) {
      const contacts = etats.filter((e, k) => k > 0 && e.pieds[c].appui && !etats[k - 1].pieds[c].appui).length;
      const foulees = etats[etats.length - 1].phase - etats[0].phase;
      expect(Math.abs(contacts - foulees)).toBeLessThanOrEqual(1);
    }
  });

  it("pied verrouillé : le point d'appui (talon puis plante) ne bouge pas pendant l'appui", () => {
    for (const c of COTES) {
      let talon: Vec | null = null, plante: Vec | null = null, glisse = 0, n = 0;
      etats.forEach((e, k) => {
        const p = e.pieds[c];
        if (!p.appui || (k > 0 && !etats[k - 1].pieds[c].appui)) { talon = plante = null; }
        if (p.talon) { if (talon) glisse = Math.max(glisse, dist(talon, p.talon)); talon = copie(p.talon); n++; }
        if (p.plante) { if (plante) glisse = Math.max(glisse, dist(plante, p.plante)); plante = copie(p.plante); n++; }
      });
      expect(n).toBeGreaterThan(50);
      expect(glisse).toBeLessThan(1e-9);
    }
  });

  it("vitesse d'avance = balayage : pendant l'appui le bassin passe au-dessus du pied à la vitesse de course", () => {
    for (const c of COTES) {
      const k0 = etats.findIndex((e, k) => k > 0 && e.pieds[c].appui && !etats[k - 1].pieds[c].appui);
      let k1 = k0;
      while (etats[k1 + 1].pieds[c].appui) k1++;
      const balayage = (etats[k1].bassin.p.z - etats[k0].bassin.p.z) / ((k1 - k0) * DT);
      expect(balayage / etats[k0].vitesse).toBeGreaterThan(0.9);
      expect(balayage / etats[k0].vitesse).toBeLessThan(1.1);
      // Le pied se pose devant le bassin et décolle derrière.
      expect(etats[k0].pieds[c].cheville.z).toBeGreaterThan(etats[k0].bassin.p.z + 0.1);
      expect(etats[k1].pieds[c].cheville.z).toBeLessThan(etats[k1].bassin.p.z - 0.2);
    }
  });

  it("le pied en vol ne saute jamais (continuité de position et de vitesse aux contacts et décollages)", () => {
    for (const c of COTES) {
      let sautMax = 0, dvMax = 0;
      for (let k = 2; k < etats.length; k++) {
        const [a, b, d] = [etats[k - 2], etats[k - 1], etats[k]].map((e) => e.pieds[c].cheville);
        sautMax = Math.max(sautMax, dist(b, d));
        // Variation de vitesse entre deux images (m/s) : bornée partout, transitions comprises.
        const v1 = { x: (b.x - a.x) / DT, y: (b.y - a.y) / DT, z: (b.z - a.z) / DT };
        const v2 = { x: (d.x - b.x) / DT, y: (d.y - b.y) / DT, z: (d.z - b.z) / DT };
        dvMax = Math.max(dvMax, dist(v1, v2));
      }
      expect(sautMax).toBeLessThan(0.08); // < 9,6 m/s
      expect(dvMax).toBeLessThan(1.6); // < 190 m/s² : aucun « pop »
    }
  });

  it("au contact, le talon arrive presque immobile (pas de glissade à l'atterrissage)", () => {
    for (const c of COTES) {
      const k = etats.findIndex((e, i) => i > 1 && e.pieds[c].appui && !etats[i - 1].pieds[c].appui);
      const a = talonDe(etats[k - 2].pieds[c]), b = talonDe(etats[k - 1].pieds[c]);
      // Image précédant le contact : le talon finit sa course à vitesse nulle (≈ 4 mm parcourus en 1/120 s).
      expect(Math.hypot(b.x - a.x, b.z - a.z) / DT).toBeLessThan(0.6);
    }
  });

  it("aucun saut de vitesse de la cheville au contact : le vol finit à la vitesse du début de l'appui", () => {
    const c = creerCourse({ graine: 3, phase: 0.9 });
    const h = 1 / 4000;
    let prec: Vec | null = null, vPrec: Vec | null = null, appuiPrec = false, saut = -1;
    for (let k = 0; k < 2000 && saut < 0; k++) {
      c.avancer(h);
      const p = c.etat().pieds.G;
      const x = copie(p.cheville);
      if (prec) {
        const v = { x: (x.x - prec.x) / h, y: (x.y - prec.y) / h, z: (x.z - prec.z) / h };
        if (vPrec && p.appui && !appuiPrec) saut = dist(v, vPrec);
        vPrec = v;
      }
      prec = x;
      appuiPrec = p.appui;
    }
    expect(saut).toBeGreaterThanOrEqual(0);
    expect(saut).toBeLessThan(0.1);
  });

  it("talon qui remonte au vol, bassin qui rebondit (bas à l'appui), pieds jamais sous le sol", () => {
    const hautTalon = Math.max(...etats.map((e) => e.pieds.G.cheville.y));
    expect(hautTalon).toBeGreaterThan(0.38);
    const ys = etats.map((e) => e.bassin.p.y);
    const rebond = Math.max(...ys) - Math.min(...ys);
    expect(rebond).toBeGreaterThan(0.04);
    expect(rebond).toBeLessThan(0.08);
    const appui = etats.filter((e) => e.pieds.G.appui && Math.abs(e.pieds.G.avancement - 0.5) < 0.1).map((e) => e.bassin.p.y);
    const vol = etats.filter((e) => !e.pieds.G.appui && !e.pieds.D.appui).map((e) => e.bassin.p.y);
    expect(Math.max(...appui)).toBeLessThan(Math.min(...vol) + 0.01);
    for (const e of etats) for (const c of COTES) expect(e.pieds[c].cheville.y).toBeGreaterThan(0.075);
  });

  it("bras en opposition des jambes, coudes fléchis ≈ 90°, épaules en contre-rotation du bassin", () => {
    // Jambe G devant (cheville G plus en avant que la D) ⇔ bras D devant : corrélation nettement positive.
    const jambes = etats.map((e) => e.pieds.G.cheville.z - e.pieds.D.cheville.z);
    const bras = etats.map((e) => e.bras.D.balancement - e.bras.G.balancement);
    const moy = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
    const mj = moy(jambes), mb = moy(bras);
    const cov = moy(jambes.map((j, k) => (j - mj) * (bras[k] - mb)));
    const sd = (x: number[], m: number) => Math.sqrt(moy(x.map((v) => (v - m) ** 2)));
    expect(cov / (sd(jambes, mj) * sd(bras, mb))).toBeGreaterThan(0.6);
    for (const e of etats) {
      for (const c of COTES) {
        expect(e.bras[c].coude).toBeGreaterThan(70 * DEG);
        expect(e.bras[c].coude).toBeLessThan(110 * DEG);
      }
      // Thorax (bassin + colonne) et bassin tournent en sens contraires.
      const thorax = e.bassin.lacet + e.dos.lacet;
      if (Math.abs(e.bassin.lacet) > 3 * DEG) expect(Math.sign(thorax)).toBe(-Math.sign(e.bassin.lacet));
      expect(e.dos.tangage).toBeGreaterThan(5 * DEG); // inclinaison vers l'avant
    }
  });

  it("tête stabilisée : elle tourne bien moins que les épaules", () => {
    const thorax = etats.map((e) => e.bassin.lacet + e.dos.lacet);
    const tete = etats.map((e) => e.tete.lacet);
    const ecart = (x: number[]) => Math.max(...x) - Math.min(...x);
    expect(ecart(tete)).toBeLessThan(ecart(thorax) / 2);
  });

  it("reproductible pour une graine, jamais exactement périodique", () => {
    const a = derouler(2, { graine: 3 }), b = derouler(2, { graine: 3 }), c = derouler(2, { graine: 4 });
    expect(a[200].pieds.G.cheville).toEqual(b[200].pieds.G.cheville);
    expect(a[200].bras.G.balancement).not.toBe(c[200].bras.G.balancement);
    // Deux foulées successives diffèrent (dérives lentes de cadence, d'amplitude, de tête).
    const T = Math.round(2 / REGLAGES.cadence / DT);
    expect(Math.abs(a[100].bras.G.balancement - a[100 + T].bras.G.balancement)).toBeGreaterThan(1e-4);
  });

  it("un grand pas de temps (onglet repris) ne saute ni contact ni décollage", () => {
    const c1 = creerCourse({ graine: 5 }), c2 = creerCourse({ graine: 5 });
    for (let k = 0; k < 60; k++) c1.avancer(DT);
    c2.avancer(60 * DT);
    expect(dist(c1.etat().pieds.G.cheville, c2.etat().pieds.G.cheville)).toBeLessThan(1e-6);
  });
});

describe("outils du cycle", () => {
  it("splineHermite passe par ses nœuds et respecte les tangentes d'extrémité", () => {
    const s = [0, 0.3, 1], p = [0, 1, 0];
    expect(splineHermite(s, p, 2, -3, 0)).toBeCloseTo(0);
    expect(splineHermite(s, p, 2, -3, 0.3)).toBeCloseTo(1);
    expect(splineHermite(s, p, 2, -3, 1)).toBeCloseTo(0);
    const e = 1e-5;
    expect((splineHermite(s, p, 2, -3, e) - splineHermite(s, p, 2, -3, 0)) / e).toBeCloseTo(2, 2);
  });

  it("tangage du pied à l'appui : pointe levée au contact, à plat, talon levé au décollage", () => {
    expect(tangageAppui(REGLAGES, 0)).toBeCloseTo(REGLAGES.tangageContact);
    expect(tangageAppui(REGLAGES, 0.35)).toBe(0);
    expect(tangageAppui(REGLAGES, 1)).toBeCloseTo(REGLAGES.tangageDecollage);
  });
});
