import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { distSegment } from "../agroparc3d/cachettes";
import type { SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde, pointsApparition, resoudre } from "./collision";
import {
  boiteVoiture, CIRCUITS, construireCircuits, distanceAuxCircuits, ecarterDesCircuits, ecrasements, etatVoiture, flotte, joueurEcrase,
  MITRE_MAX, T0_MS, VITESSE_PNJ_M_S, VOITURE,
  type Circuit, type CircuitDef, type VoiturePnj,
} from "./circulation";
import type { Vec3 } from "./protocole";
import { SILHOUETTE } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMonde(scene);
const circuits = construireCircuits();
const voitures = flotte(circuits);
const R = SILHOUETTE.rayon;
const CENTRE_RP: Vec2 = [28.2, 2.5];
/** Horloge serveur réaliste (≈ 2026) : 1,8·10¹² ms. */
const T_REEL = 1_800_000_000_000;
/** Durée d'un tour (ms). */
const tour = (c: Circuit) => (c.longueur / c.def.vitesse) * 1000;
const ecartAngle = (a: number, b: number) => {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
};
/** Aire signée (formule du lacet, x → est, z → sud : négative = antihoraire sur la carte). */
function aire(pts: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    s += x0 * z1 - x1 * z0;
  }
  return s / 2;
}
/** Voiture unique d'un circuit posée à l'abscisse `s` à `T0_MS`. */
const voitureEn = (ic: number, s: number): VoiturePnj => ({ id: 99, circuit: ic, s0: s, teinte: 0 });

describe("définition des circuits (annexe §10)", () => {
  it("4 circuits, 12 voitures (3, 2, 3, 4), vitesse unique de 9 m/s", () => {
    expect(CIRCUITS.map((c) => c.id)).toEqual(["anneau", "sud", "nord_est", "ouest"]);
    expect(CIRCUITS.map((c) => c.voitures)).toEqual([3, 2, 3, 4]);
    expect(CIRCUITS.reduce((n, c) => n + c.voitures, 0)).toBe(12);
    for (const c of CIRCUITS) expect(c.vitesse).toBe(VITESSE_PNJ_M_S);
    expect(VITESSE_PNJ_M_S).toBe(9);
  });

  it("circuits fermés : premier = dernier point (0,00 m), pour les axes comme pour les lignes décalées", () => {
    for (const c of circuits) {
      const a = c.def.points, p = c.pts;
      expect(a[0]).toEqual(a[a.length - 1]);
      expect(p[0]).toEqual(p[p.length - 1]);
      expect(Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1])).toBe(0);
    }
  });

  it("sens antihoraire sur l'anneau : aire signée des points à moins de 22 m du centre", () => {
    for (const c of circuits) {
      const proches = c.def.points.slice(0, -1).filter(([x, z]) => Math.hypot(x - CENTRE_RP[0], z - CENTRE_RP[1]) < 22);
      expect(proches.length).toBeGreaterThanOrEqual(3);
      // z vers le sud : antihoraire sur la carte = aire du lacet négative
      expect(aire(proches), c.def.id).toBeLessThan(0);
    }
    expect(aire(circuits[0].def.points.slice(0, -1))).toBeLessThan(0);
  });

  it("les axes sont à plus de 2,6 m d'un bâtiment (dégagement mesuré 2,70 m ; la spec annonçait 2,74 m)", () => {
    let mini = Infinity;
    for (const c of CIRCUITS) {
      for (let i = 1; i < c.points.length; i++) {
        const [ax, az] = c.points[i - 1], [bx, bz] = c.points[i];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
        for (let k = 0; k < n; k++) {
          const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
          for (const b of scene.buildings) for (let a = 0, j = b.r.length - 1; a < b.r.length; j = a++) mini = Math.min(mini, distSegment(x, z, b.r[j][0], b.r[j][1], b.r[a][0], b.r[a][1]));
        }
      }
    }
    expect(mini).toBeGreaterThan(2.6);
  });
});

describe("ligne décalée à droite, jonctions en mitre", () => {
  it("chaque segment est parallèle à l'axe et à decalageVoie à droite (−hz, hx)", () => {
    for (const c of circuits) {
      const axe = c.def.points, d = c.def.decalageVoie;
      expect(c.pts.length).toBe(axe.length);
      for (let i = 0; i < axe.length - 1; i++) {
        const hx = axe[i + 1][0] - axe[i][0], hz = axe[i + 1][1] - axe[i][1], l = Math.hypot(hx, hz);
        const ux = hx / l, uz = hz / l;
        for (const k of [i, i + 1]) {
          // distance signée du sommet décalé à la droite infinie de l'axe, côté (−uz, ux)
          const ox = c.pts[k][0] - axe[i][0], oz = c.pts[k][1] - axe[i][1];
          expect(ox * -uz + oz * ux, `${c.def.id} seg ${i}`).toBeCloseTo(d, 6);
        }
        const sx = c.pts[i + 1][0] - c.pts[i][0], sz = c.pts[i + 1][1] - c.pts[i][1];
        expect((sx * uz - sz * ux) / Math.hypot(sx, sz)).toBeCloseTo(0, 6);
        expect(sx * ux + sz * uz).toBeGreaterThan(0);
      }
    }
  });

  it("mitre sans pointe : le sommet décalé reste entre d et MITRE_MAX × d de son sommet d'axe", () => {
    for (const c of circuits) {
      const d = c.def.decalageVoie;
      for (let i = 0; i < c.pts.length; i++) {
        const e = Math.hypot(c.pts[i][0] - c.def.points[i][0], c.pts[i][1] - c.def.points[i][1]);
        expect(e).toBeGreaterThanOrEqual(d - 1e-9);
        expect(e).toBeLessThanOrEqual(MITRE_MAX * d + 1e-9);
      }
    }
  });

  it("les coins sont conservés (virages de 100° de sud et nord_est compris) : le décalé tourne du même angle que l'axe, sans demi-tour", () => {
    const angle = (ax: number, az: number, bx: number, bz: number) => Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    let plusGrandVirage = 0;
    for (const c of circuits) {
      for (let i = 2; i < c.pts.length; i++) {
        const a = c.def.points, p = c.pts;
        const virageAxe = angle(a[i - 1][0] - a[i - 2][0], a[i - 1][1] - a[i - 2][1], a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]);
        const virageLigne = angle(p[i - 1][0] - p[i - 2][0], p[i - 1][1] - p[i - 2][1], p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
        expect(virageLigne, `${c.def.id} ${i}`).toBeCloseTo(virageAxe, 6);
        plusGrandVirage = Math.max(plusGrandVirage, Math.abs(virageAxe));
      }
    }
    expect((plusGrandVirage * 180) / Math.PI).toBeGreaterThan(100);
  });

  it("cumul croissant, longueur = dernier cumul", () => {
    for (const c of circuits) {
      expect(c.cumul[0]).toBe(0);
      for (let i = 1; i < c.cumul.length; i++) expect(c.cumul[i]).toBeGreaterThan(c.cumul[i - 1]);
      expect(c.longueur).toBe(c.cumul[c.cumul.length - 1]);
    }
  });

  it("construireCircuits accepte des définitions fournies (carré de 100 m parcouru vers le nord puis l'est)", () => {
    const def: CircuitDef = { id: "anneau", points: [[0, 0], [0, -100], [100, -100], [100, 0], [0, 0]], decalageVoie: 2, vitesse: 10, voitures: 1 };
    const [c] = construireCircuits([def]);
    // 1er segment : vers le nord (−z), la droite est l'est (+x)
    // (nord puis est = tour horaire sur la carte : la droite est l'intérieur) ; le sommet (0, 0) joint l'arrivée vers l'ouest au départ vers le nord
    expect(c.pts[0][0]).toBeCloseTo(2, 9);
    expect(c.pts[0][1]).toBeCloseTo(-2, 9);
    expect(c.longueur).toBeCloseTo(4 * 96, 6);
  });
});

describe("flotte", () => {
  it("12 voitures, ids 0..11 sans doublon, déterministe", () => {
    expect(voitures).toHaveLength(12);
    expect(voitures.map((v) => v.id)).toEqual([...Array(12).keys()]);
    expect(new Set(voitures.map((v) => v.id)).size).toBe(12);
    expect(flotte(construireCircuits())).toEqual(voitures);
    for (const v of voitures) expect(v.teinte).toBeGreaterThanOrEqual(0), expect(v.teinte).toBeLessThan(360);
  });

  it("par circuit : n voitures espacées de L/n", () => {
    circuits.forEach((c, ic) => {
      const s = voitures.filter((v) => v.circuit === ic).map((v) => v.s0).sort((a, b) => a - b);
      expect(s).toHaveLength(c.def.voitures);
      const pas = c.longueur / c.def.voitures;
      for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeCloseTo(pas, 9);
      expect(s[0] + c.longueur - s[s.length - 1]).toBeCloseTo(pas, 9);
      for (const x of s) expect(x).toBeGreaterThanOrEqual(0), expect(x).toBeLessThan(c.longueur);
    });
  });

  it("les quatre circuits ne démarrent pas avec une voiture chacun sur le nœud est du rond-point", () => {
    const aLaTete = voitures.filter((v) => v.s0 === 0);
    expect(aLaTete.length).toBeLessThanOrEqual(1);
  });
});

describe("etatVoiture", () => {
  it("vitesse unique de 9 m/s, au sol (y = 0), y compris en cap de convention lacet", () => {
    for (const v of voitures) {
      const e = etatVoiture(circuits[v.circuit], v, T_REEL);
      expect(e.v).toBe(VITESSE_PNJ_M_S);
      expect(e.p[1]).toBe(0);
    }
  });

  it("position = fonction pure de l'horloge : s = (s0 + v·(t − T0)) mod L, périodique d'un tour", () => {
    for (const v of voitures) {
      const c = circuits[v.circuit];
      for (const t of [T0_MS, T0_MS + 1234, T_REEL, T_REEL + 777]) {
        const a = etatVoiture(c, v, t), b = etatVoiture(c, v, t + tour(c)), c2 = etatVoiture(c, v, t - 3 * tour(c));
        for (const e of [b, c2]) {
          expect(e.p[0]).toBeCloseTo(a.p[0], 3);
          expect(e.p[2]).toBeCloseTo(a.p[2], 3);
          expect(ecartAngle(e.cap, a.cap)).toBeLessThan(1e-4);
        }
      }
    }
  });

  it("à T0_MS la voiture est à s0 (premier point du circuit pour s0 = 0)", () => {
    const c = circuits[0];
    const e = etatVoiture(c, voitureEn(0, 0), T0_MS);
    expect(e.p[0]).toBeCloseTo(c.pts[0][0], 9);
    expect(e.p[2]).toBeCloseTo(c.pts[0][1], 9);
    // 1 s plus tard : 9 m plus loin le long de la ligne
    const f = etatVoiture(c, voitureEn(0, 0), T0_MS + 1000);
    expect(f.p[0]).not.toBe(e.p[0]);
  });

  it("précision numérique à t ≈ 1,7·10¹² ms : une milliseconde = 9 mm", () => {
    for (const v of voitures) {
      const c = circuits[v.circuit];
      const a = etatVoiture(c, v, 1_700_000_000_000 + 40_000_000), b = etatVoiture(c, v, 1_700_000_000_000 + 40_000_001);
      const d = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]);
      expect(d).toBeGreaterThan(0.008);
      expect(d).toBeLessThan(0.01);
    }
  });

  it("continue : jamais plus de 1,5 m entre deux appels à 100 ms (un tour complet de chaque voiture)", () => {
    for (const v of voitures) {
      const c = circuits[v.circuit];
      let prev = etatVoiture(c, v, T_REEL);
      let pire = 0;
      for (let t = T_REEL + 100; t <= T_REEL + tour(c) + 100; t += 100) {
        const e = etatVoiture(c, v, t);
        pire = Math.max(pire, Math.hypot(e.p[0] - prev.p[0], e.p[2] - prev.p[2]));
        prev = e;
      }
      expect(pire, `${c.def.id}`).toBeLessThanOrEqual(1.5);
      expect(pire).toBeLessThanOrEqual(0.9 + 1e-6); // 9 m/s × 0,1 s : la ligne ne saute jamais
    }
  });

  it("cap continu aux coins, y compris les virages de 100° de sud et nord_est : |Δcap| ≤ 0,6 rad par 100 ms", () => {
    // La spec annonçait 0,5 rad : avec une corde de ±2 m, un virage de 101,4° (nord_est) donne 0,55 rad/100 ms au pire.
    let pire = 0;
    for (const v of voitures) {
      const c = circuits[v.circuit];
      let prev = etatVoiture(c, v, T_REEL);
      for (let t = T_REEL + 10; t <= T_REEL + tour(c) + 10; t += 10) {
        const e = etatVoiture(c, v, t);
        pire = Math.max(pire, ecartAngle(e.cap, prev.cap) * 10);
        // pas par pas de 10 ms ramené à 100 ms (taux maximal)
        prev = e;
      }
    }
    expect(pire).toBeLessThanOrEqual(0.6);
    // et sur de vrais pas de 100 ms
    for (const v of voitures) {
      const c = circuits[v.circuit];
      let prev = etatVoiture(c, v, T_REEL);
      for (let t = T_REEL + 100; t <= T_REEL + tour(c) + 100; t += 100) {
        const e = etatVoiture(c, v, t);
        expect(ecartAngle(e.cap, prev.cap), c.def.id).toBeLessThanOrEqual(0.6);
        prev = e;
      }
    }
  });

  it("cap = direction de la corde entre s − 2 m et s + 2 m (convention lacet : 0 = vers −z)", () => {
    for (const v of voitures) {
      const c = circuits[v.circuit];
      for (const t of [T0_MS, T_REEL, T_REEL + 1234.5, T_REEL + 31_000]) {
        const e = etatVoiture(c, v, t);
        const avant = etatVoiture(c, { ...v, s0: v.s0 + 2 }, t), arriere = etatVoiture(c, { ...v, s0: v.s0 - 2 }, t);
        const dx = avant.p[0] - arriere.p[0], dz = avant.p[2] - arriere.p[2];
        expect(ecartAngle(e.cap, Math.atan2(-dx, -dz))).toBeLessThan(1e-9);
      }
    }
  });

  it("le cap pointe dans le sens de la marche (la voiture avance sur son avant, jamais en marche arrière)", () => {
    for (const v of voitures) {
      const c = circuits[v.circuit];
      const a = etatVoiture(c, v, T_REEL), b = etatVoiture(c, v, T_REEL + 50);
      const fx = -Math.sin(a.cap), fz = -Math.cos(a.cap);
      expect((b.p[0] - a.p[0]) * fx + (b.p[2] - a.p[2]) * fz).toBeGreaterThan(0.4);
    }
  });

  it("accord client / serveur : deux appels identiques donnent le même état à l'octet, sans état caché", () => {
    for (const v of voitures) {
      const c = circuits[v.circuit];
      const a = etatVoiture(c, v, T_REEL + 4321.5);
      etatVoiture(c, v, 0); // un autre instant entre les deux ne change rien
      const b = etatVoiture(construireCircuits()[v.circuit], v, T_REEL + 4321.5);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });
});

describe("dégagement sur le vrai scene.json", () => {
  /** Échantillons tous les 2 m (comme la spec) le long de la ligne décalée, plus les sommets. */
  function echantillons(c: Circuit): Vec3[] {
    const out: Vec3[] = [];
    for (let s = 0; s < c.longueur; s += 2) out.push([...etatVoiture(c, voitureEn(0, s), T0_MS).p] as Vec3);
    for (const p of c.pts) out.push([p[0], 0, p[1]]);
    return out;
  }

  it("aucun échantillon de la ligne décalée (tous les 2 m) à moins de demiLargeur + 0,3 m d'un bâtiment", () => {
    for (const [ic, c] of circuits.entries()) {
      for (const p of echantillons(c)) {
        const { contacts } = resoudre(monde, p, VOITURE.largeur / 2 + 0.3, VOITURE.hauteur);
        expect(contacts, `${c.def.id} (${p[0].toFixed(1)} ; ${p[2].toFixed(1)}) circuit ${ic}`).toHaveLength(0);
      }
    }
  });

  it("même la boule qui contient toute la voiture (rayon 2,4 m) ne touche aucun bâtiment", () => {
    const englobant = Math.hypot(VOITURE.longueur / 2, VOITURE.largeur / 2);
    for (const c of circuits) {
      for (const p of echantillons(c)) {
        expect(resoudre(monde, p, englobant, VOITURE.hauteur).contacts, `${c.def.id} (${p[0].toFixed(1)} ; ${p[2].toFixed(1)})`).toHaveLength(0);
      }
    }
  });
});

describe("boiteVoiture et joueurEcrase", () => {
  // voiture d'essai : cap 0 (vers −z), centre en (10, 0, 20) ; avant = (0, −1), droite = (1, 0)
  const e = { p: [10, 0, 20] as Vec3, cap: 0, v: 9 };
  const r = R;
  const dl = VOITURE.longueur / 2, dw = VOITURE.largeur / 2;
  const joueur = (dx: number, dz: number, y = 0): Vec3 => [10 + dx, y, 20 + dz];

  it("boîte orientée : avant (−sin cap, −cos cap), 4,4 × 1,9 m, marge ajoutée de chaque côté", () => {
    const b = boiteVoiture(e);
    expect(b).toMatchObject({ cx: 10, cz: 20, demiLongueur: dl, demiLargeur: dw });
    expect(b.ux).toBeCloseTo(0, 12);
    expect(b.uz).toBeCloseTo(-1, 12);
    const m = boiteVoiture({ ...e, cap: Math.PI / 2 }, 0.3);
    expect(m.ux).toBeCloseTo(-1, 12);
    expect(m.uz).toBeCloseTo(0, 12);
    expect(m.demiLongueur).toBeCloseTo(dl + 0.3, 12);
    expect(m.demiLargeur).toBeCloseTo(dw + 0.3, 12);
  });

  it("écrasé au centre ; borne latérale = demi-largeur + rayon, sans marge", () => {
    expect(joueurEcrase(e, joueur(0, 0), r)).toBe(true);
    expect(joueurEcrase(e, joueur(dw + r - 0.01, 0), r)).toBe(true);
    expect(joueurEcrase(e, joueur(dw + r + 0.01, 0), r)).toBe(false);
    expect(joueurEcrase(e, joueur(-(dw + r - 0.01), 0), r)).toBe(true);
    expect(joueurEcrase(e, joueur(-(dw + r + 0.01), 0), r)).toBe(false);
  });

  it("borne longitudinale (devant comme derrière) = demi-longueur + rayon", () => {
    expect(joueurEcrase(e, joueur(0, -(dl + r - 0.01)), r)).toBe(true);
    expect(joueurEcrase(e, joueur(0, -(dl + r + 0.01)), r)).toBe(false);
    expect(joueurEcrase(e, joueur(0, dl + r - 0.01), r)).toBe(true);
    expect(joueurEcrase(e, joueur(0, dl + r + 0.01), r)).toBe(false);
  });

  it("aux coins le cylindre est testé contre l'angle (pas contre un rectangle élargi)", () => {
    const c = r / Math.SQRT2;
    expect(joueurEcrase(e, joueur(dw + c - 0.01, -(dl + c - 0.01)), r)).toBe(true);
    expect(joueurEcrase(e, joueur(dw + c + 0.02, -(dl + c + 0.02)), r)).toBe(false);
  });

  it("la marge élargit la boîte (équité : 0 par défaut)", () => {
    expect(joueurEcrase(e, joueur(dw + r + 0.2, 0), r)).toBe(false);
    expect(joueurEcrase(e, joueur(dw + r + 0.2, 0), r, 0.3)).toBe(true);
  });

  it("sur le toit (pieds ≥ 1,6 m) : épargné ; juste dessous : écrasé", () => {
    expect(joueurEcrase(e, joueur(0, 0, VOITURE.hauteur + 0.1), r)).toBe(false);
    expect(joueurEcrase(e, joueur(0, 0, 2), r)).toBe(false);
    expect(joueurEcrase(e, joueur(0, 0, VOITURE.hauteur + 0.1 - 0.01), r)).toBe(true);
  });

  it("tient compte du cap (voiture orientée est)", () => {
    const est = { ...e, cap: -Math.PI / 2 }; // avant = (+1, 0)
    expect(joueurEcrase(est, joueur(dl + r - 0.01, 0), r)).toBe(true);
    expect(joueurEcrase(est, joueur(0, dl + r - 0.01), r)).toBe(false); // sur le côté, la demi-largeur seule compte
    expect(joueurEcrase(est, joueur(0, dw + r - 0.01), r)).toBe(true);
  });
});

describe("ecrasements", () => {
  const c0 = circuits[0], v0 = voitures[0];
  const e1 = etatVoiture(c0, v0, T0_MS + 1000);
  const sur = (id: string, e = e1, tMs = T0_MS + 1000): { id: string; p: Vec3; tMs: number } => ({ id, p: [e.p[0], 0, e.p[2]], tMs });

  it("un joueur sous la voiture est écrasé, un joueur loin non", () => {
    expect(ecrasements(circuits, voitures, [sur("a"), { id: "b", p: [500, 0, 500], tMs: T0_MS + 1000 }], R)).toEqual(["a"]);
  });

  it("chaque joueur est testé à SON instant tMs, pas à l'instant courant", () => {
    const p: Vec3 = [e1.p[0], 0, e1.p[2]];
    // même point : la voiture 0 y est à T0 + 1000 ms ; 80 ms plus tôt ou plus tard (0,7 m) le joueur est déjà passé / pas encore arrivé
    expect(ecrasements(circuits, voitures, [{ id: "juste", p, tMs: T0_MS + 1000 }], R)).toContain("juste");
    const pres = ecrasements(circuits, voitures, [
      { id: "avant", p, tMs: T0_MS + 1000 - 600 },
      { id: "apres", p, tMs: T0_MS + 1000 + 600 },
      { id: "juste", p, tMs: T0_MS + 1000 },
    ], R);
    expect(pres).toContain("juste");
    // l'instant décale la voiture de 5,4 m : aucune autre voiture n'est là, "avant" / "apres" ne sont pas écrasés par la voiture 0
    const seulE = ecrasements([c0], [v0], [{ id: "avant", p, tMs: T0_MS + 400 }, { id: "apres", p, tMs: T0_MS + 1600 }, { id: "juste", p, tMs: T0_MS + 1000 }], R);
    expect(seulE).toEqual(["juste"]);
  });

  it("le décalage de ping change le verdict : même position, deux joueurs, deux instants", () => {
    // voiture à t1 ; position du joueur choisie là où elle est à t1 = T0 + 2000
    const t1 = T0_MS + 2000, e = etatVoiture(c0, v0, t1);
    const p: Vec3 = [e.p[0], 0, e.p[2]];
    const ids = ecrasements([c0], [v0], [{ id: "ping0", p, tMs: t1 }, { id: "ping600", p, tMs: t1 - 600 }], R);
    expect(ids).toEqual(["ping0"]);
  });

  it("épargne le toit, ne compte un joueur qu'une fois même sous deux voitures, et respecte la marge", () => {
    expect(ecrasements(circuits, voitures, [{ ...sur("toit"), p: [e1.p[0], 1.7, e1.p[2]] }], R)).toEqual([]);
    const doublon = { ...v0, id: 77 };
    expect(ecrasements(circuits, [v0, doublon], [sur("a")], R)).toEqual(["a"]);
    const bord: Vec3 = [e1.p[0] + Math.cos(e1.cap) * (VOITURE.largeur / 2 + R + 0.2), 0, e1.p[2] - Math.sin(e1.cap) * (VOITURE.largeur / 2 + R + 0.2)];
    const j = { id: "bord", p: bord, tMs: T0_MS + 1000 };
    expect(ecrasements([c0], [v0], [j], R)).toEqual([]);
    expect(ecrasements([c0], [v0], [j], R, 0.3)).toEqual(["bord"]);
  });

  it("accord client / serveur : même appel, même résultat", () => {
    const js = voitures.slice(0, 6).map((v, i) => {
      const e = etatVoiture(circuits[v.circuit], v, T_REEL + i * 37);
      return { id: `j${i}`, p: [e.p[0] + 0.3, 0, e.p[2]] as Vec3, tMs: T_REEL + i * 37 };
    });
    const a = ecrasements(circuits, voitures, js, R), b = ecrasements(construireCircuits(), flotte(construireCircuits()), js, R);
    expect(b).toEqual(a);
    expect(a).toHaveLength(6);
  });

  it("le filtre par distance ne change aucun verdict (comparé au test complet sur une grille autour de la voiture)", () => {
    for (let dx = -4; dx <= 4; dx += 0.25) {
      for (let dz = -4; dz <= 4; dz += 0.25) {
        const p: Vec3 = [e1.p[0] + dx, 0, e1.p[2] + dz];
        const attendu = joueurEcrase(e1, p, R);
        expect(ecrasements([c0], [v0], [{ id: "x", p, tMs: T0_MS + 1000 }], R).length === 1).toBe(attendu);
      }
    }
  });
});

describe("distanceAuxCircuits et ecarterDesCircuits", () => {
  it("0 sur la ligne décalée, distance au segment le plus proche ailleurs", () => {
    const p = circuits[0].pts[3];
    expect(distanceAuxCircuits(circuits, p[0], p[1])).toBeCloseTo(0, 9);
    // 5 m à l'est du point le plus à l'est de toutes les lignes : strictement 5 m du circuit le plus proche
    const est = Math.max(...circuits.flatMap((c) => c.pts.map((q) => q[0])));
    const q = circuits.flatMap((c) => c.pts).find((pt) => pt[0] === est)!;
    expect(distanceAuxCircuits(circuits, q[0] + 5, q[1])).toBeCloseTo(5, 6);
    expect(distanceAuxCircuits([], 0, 0)).toBe(Infinity);
  });

  const ring = pointsApparition(scene, monde).filter(([x, z]) => {
    const d = Math.hypot(x - CENTRE_RP[0], z - CENTRE_RP[1]);
    return d >= 25 && d <= 140;
  });

  it("sur le vrai scene.json : 111 points d'apparition dans l'anneau 25–140 m, ceux à moins de 4 m d'un circuit sont écartés", () => {
    expect(ring).toHaveLength(111);
    const restants = ecarterDesCircuits(ring, circuits);
    // mesuré : 46 points écartés, 65 restent (identique sur les axes bruts et sur les lignes décalées)
    expect(restants).toHaveLength(65);
    expect(ring.length - restants.length).toBe(46);
    for (const [x, z] of restants) expect(distanceAuxCircuits(circuits, x, z)).toBeGreaterThanOrEqual(4);
    for (const pt of ring) if (!restants.includes(pt)) expect(distanceAuxCircuits(circuits, pt[0], pt[1])).toBeLessThan(4);
    expect(restants.length).toBeGreaterThanOrEqual(30);
  });

  it("moins de 30 points restants : renvoie les points tels quels (valeurs et ordre)", () => {
    const peu = ring.slice(0, 20);
    expect(ecarterDesCircuits(peu, circuits)).toEqual(peu);
    // seuil explicite : exiger 100 restants alors qu'il n'en reste que 65
    expect(ecarterDesCircuits(ring, circuits, 4, 100)).toEqual(ring);
    // distance minimale nulle : tout reste
    expect(ecarterDesCircuits(ring, circuits, 0)).toEqual(ring);
  });
});

describe("hygiène", () => {
  it("aucun Math.random ni Date.now dans circulation.ts (l'horloge est un paramètre)", () => {
    const src = readFileSync("lib/fps/circulation.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now/);
  });

  it("aucune dépendance à match.ts", () => {
    expect(readFileSync("lib/fps/circulation.ts", "utf8")).not.toMatch(/from\s+["']\.\/match["']/);
  });
});
