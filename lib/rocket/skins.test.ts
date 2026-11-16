import { describe, expect, it } from "vitest";
import { SKINS, VOITURE, estSkin, type SkinVoiture } from "./contrat";
import {
  DEFINITIONS_SKIN, EMPATTEMENT_MODELE, LARGEUR_OCTANE, PROFIL_OCTANE, aSurFace, apercuSkin, echellesSkin, hautA, modeleSkin, skinBot,
  skinsDesVoitures, skinsEnLigne, type Point2,
} from "./skins";

const SERIE = ["308", "2008", "rio"] as const;

/** Point strictement intérieur au polygone (règle pair-impair). */
function dedans(poly: readonly Point2[], [x, y]: Point2): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Deux segments se coupent-ils (hors extrémités communes) ? */
function croisent(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const o = (p: Point2, q: Point2, r: Point2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
}
const aire = (poly: readonly Point2[]) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

describe("catalogue", () => {
  it("quatre skins, l'Octane d'abord (défaut), tous reconnus", () => {
    expect(SKINS).toEqual(["octane", "308", "2008", "rio"]);
    for (const s of SKINS) expect(estSkin(s)).toBe(true);
    for (const x of ["", "Octane", "306", 308, null, undefined, {}]) expect(estSkin(x)).toBe(false);
  });
  it("l'Octane garde exactement son profil historique", () => {
    const m = modeleSkin("octane");
    expect(m.volumes).toHaveLength(1);
    expect(m.volumes[0].profil).toBe(PROFIL_OCTANE);
    expect(m.volumes[0].largeur).toBe(LARGEUR_OCTANE);
    expect(m.segments).toHaveLength(0);
  });
  it("un identifiant inconnu donne l'Octane, les modèles sont mémoïsés", () => {
    expect(modeleSkin("inconnu" as SkinVoiture).id).toBe("octane");
    expect(modeleSkin("308")).toBe(modeleSkin("308"));
  });
});

describe.each(SERIE)("voiture de série %s", (id) => {
  const d = DEFINITIONS_SKIN[id];
  const m = modeleSkin(id);
  const [caisse, cabine] = m.volumes.map((v) => v.profil);

  it("mise à l'échelle sur l'empattement des roues physiques, proportions de la fiche", () => {
    const { k, kh } = echellesSkin(d);
    expect(k * d.fiche.empattement).toBeCloseTo(EMPATTEMENT_MODELE, 10);
    const as = caisse.map((p) => p[0]), hs = [...caisse, ...cabine].map((p) => p[1]);
    const longueur = Math.max(...as) - Math.min(...as);
    expect(longueur).toBeCloseTo(d.fiche.longueur * k, 1);
    // plus longue que la hitbox (comme les voitures de RL) mais pas démesurée
    expect(longueur).toBeGreaterThan(VOITURE.hitbox.longueur);
    expect(longueur).toBeLessThan(1.45);
    // toit sous le haut de la hitbox, à la hauteur de la fiche étirée
    const toit = Math.max(...hs);
    expect(toit + VOITURE.hauteurRepos).toBeCloseTo(d.fiche.hauteur * kh, 2);
    expect(toit).toBeLessThan(VOITURE.decalageHitbox[2] + VOITURE.hitbox.hauteur / 2);
    // rien sous le sol
    expect(Math.min(...hs)).toBeGreaterThan(-VOITURE.hauteurRepos);
  });

  it("caisse et habitacle sont des polygones simples dans le sens trigonométrique", () => {
    for (const poly of [caisse, cabine]) {
      expect(aire(poly)).toBeGreaterThan(0);
      for (let i = 0; i < poly.length; i++) {
        for (let j = i + 2; j < poly.length; j++) {
          if (i === 0 && j === poly.length - 1) continue;
          expect(croisent(poly[i], poly[(i + 1) % poly.length], poly[j], poly[(j + 1) % poly.length]), `${i}/${j}`).toBe(false);
        }
      }
    }
  });

  it("les roues physiques passent dans leurs passages : aucun point d'une roue dans la caisse", () => {
    for (const r of VOITURE.roues) {
      for (let k = 0; k < 48; k++) {
        const th = (2 * Math.PI * k) / 48;
        for (const f of [1, 0.6]) {
          expect(dedans(caisse, [r.local[0] + Math.cos(th) * r.rayon * f, r.local[2] + Math.sin(th) * r.rayon * f])).toBe(false);
        }
      }
      // et la caisse couvre le dessus de la roue (le passage ne crève pas le capot)
      expect(hautA(caisse, r.local[0])!).toBeGreaterThan(r.local[2] + r.rayon + 0.04);
    }
  });

  it("la caisse couvre les roues en largeur, l'habitacle est plus étroit et repose sur la caisse", () => {
    const exterieur = Math.max(...VOITURE.roues.map((r) => Math.abs(r.local[1]) + 0.13));
    expect(m.volumes[0].largeur / 2).toBeGreaterThanOrEqual(exterieur);
    expect(m.volumes[1].largeur).toBeLessThan(m.volumes[0].largeur);
    // chaque point du bas de l'habitacle est dans la caisse (pas de fente entre les deux)
    for (const p of cabine) {
      const hc = hautA(caisse, p[0]);
      if (hc !== null && p[1] < hc) expect(dedans(caisse, [p[0], p[1] + 0.001])).toBe(true);
    }
  });

  it("détails : feux et calandre posés sur les faces avant et arrière, à l'extérieur", () => {
    expect(m.segments.length % 6).toBe(0);
    expect(m.segments.length).toBeGreaterThan(6 * 10);
    const aAvant = Math.max(...caisse.map((p) => p[0])), aArriere = Math.min(...caisse.map((p) => p[0]));
    for (let i = 0; i < m.segments.length; i += 3) {
      const [a, dr, h] = [m.segments[i], m.segments[i + 1], m.segments[i + 2]];
      expect(Number.isFinite(a) && Number.isFinite(dr) && Number.isFinite(h)).toBe(true);
      expect(a).toBeLessThanOrEqual(aAvant + 0.01);
      expect(a).toBeGreaterThanOrEqual(aArriere - 0.01);
      expect(Math.abs(dr)).toBeLessThanOrEqual(m.volumes[0].largeur / 2 + 0.01);
    }
    // des feux à l'avant ET à l'arrière, symétriques
    const avant: number[] = [], arriere: number[] = [];
    for (let i = 0; i < m.debutFlanc; i += 3) (m.segments[i] > 0 ? avant : arriere).push(m.segments[i + 1]);
    expect(avant.length).toBeGreaterThan(0);
    expect(arriere.length).toBeGreaterThan(0);
    expect(arriere.some((x) => x > 0) && arriere.some((x) => x < 0)).toBe(true);
    // un point de feu avant est juste devant la face avant à sa hauteur
    const h0 = m.segments[2], a0 = m.segments[0];
    if (a0 > 0) expect(a0 - aSurFace(caisse, h0, "avant")).toBeCloseTo(0.006, 4);
  });

  it("flamme et traînée sortent de l'arrière de la caisse", () => {
    const aArriere = Math.min(...caisse.map((p) => p[0]));
    expect(m.echappement[0]).toBeLessThan(aArriere + 0.1);
    expect(m.coinArriere[0]).toBeLessThan(aArriere + 0.15);
    expect(m.coinArriere[1]).toBeGreaterThan(0);
  });
});

describe("silhouettes distinctes", () => {
  it("le 2008 est le plus haut et a le bas de caisse le plus haut, la Rio la plus courte", () => {
    const toit = (s: SkinVoiture) => Math.max(...modeleSkin(s).volumes.flatMap((v) => v.profil.map((p) => p[1])));
    const long = (s: SkinVoiture) => { const as = modeleSkin(s).volumes[0].profil.map((p) => p[0]); return Math.max(...as) - Math.min(...as); };
    expect(toit("2008")).toBeGreaterThan(toit("308"));
    expect(toit("2008")).toBeGreaterThan(toit("rio"));
    expect(long("rio")).toBeLessThan(long("308"));
    expect(long("rio")).toBeLessThan(long("2008"));
    expect(DEFINITIONS_SKIN["2008"].bas).toBeGreaterThan(DEFINITIONS_SKIN["308"].bas);
  });
});

describe("attribution", () => {
  it("bots : déterministe par graine et par voiture, tous les skins sortent", () => {
    expect(skinBot(42, 3)).toBe(skinBot(42, 3));
    const vus = new Set<SkinVoiture>();
    for (let g = 0; g < 50; g++) for (let v = 0; v < 6; v++) vus.add(skinBot(g, v));
    expect([...vus].sort()).toEqual([...SKINS].sort());
    for (const s of vus) expect(estSkin(s)).toBe(true);
  });
  it("match local : l'humain a son skin, les bots le leur", () => {
    const voitures = [{ id: 0, humain: false }, { id: 1, humain: true }, { id: 2, humain: false }];
    const s = skinsDesVoitures(voitures, "rio", 7);
    expect(s[1]).toBe("rio");
    expect(s[0]).toBe(skinBot(7, 0));
    expect(s[2]).toBe(skinBot(7, 2));
  });
  it("en ligne : skin annoncé par le serveur, Octane à défaut, mon skin pour ma voiture", () => {
    const s = skinsEnLigne([{ id: 0, skin: "2008" }, { id: 1 }, { id: 2, skin: "306" as SkinVoiture }, { id: 3, skin: "octane" }], 3, "308");
    expect(s).toEqual(["2008", "octane", "octane", "308"]);
  });
});

describe("aperçu du lobby", () => {
  it.each(SKINS)("%s : un chemin par volume, deux roues, un cadre commun", (id) => {
    const a = apercuSkin(id);
    expect(a.chemins).toHaveLength(modeleSkin(id).volumes.length);
    for (const c of a.chemins) expect(c).toMatch(/^M-?[\d.]+ -?[\d.]+( L-?[\d.]+ -?[\d.]+)+ Z$/);
    expect(a.roues).toHaveLength(2);
    expect(a.vue).toBe(apercuSkin("octane").vue);
    // tout tient dans le cadre
    const [x0, y0, w, h] = a.vue.split(" ").map(Number);
    for (const v of modeleSkin(id).volumes) for (const [x, y] of v.profil) {
      expect(x).toBeGreaterThan(x0); expect(x).toBeLessThan(x0 + w);
      expect(-y).toBeGreaterThan(y0); expect(-y).toBeLessThan(y0 + h);
    }
  });
});
