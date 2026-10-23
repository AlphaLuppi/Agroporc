import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import * as collision from "./collision";
import { construireMonde } from "./collision";
import type { Vec3 } from "./protocole";
import { SILHOUETTE, SILHOUETTE_ACCROUPIE } from "./protocole";
import { directionRegard } from "./vue";
import { PSEUDO, VisibilitePseudos, dansChampDeVue, hauteurPlaquePx, ligneDeVue, pointsTest } from "./visibilite";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;

function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
/** Scène réduite aux bâtiments donnés (le reste de scene.json sert de décor vide). */
function mondeAvec(...buildings: Building[]) {
  return construireMonde({ ...scene, buildings, pois: [] });
}

const OEIL: Vec3 = [0, SILHOUETTE.oeil, 0];
const VERS_MOINS_Z = directionRegard(0, 0); // [0, 0, -1]

describe("dansChampDeVue", () => {
  it("devant : oui ; derrière : non ; de côté : non", () => {
    expect(dansChampDeVue(OEIL, VERS_MOINS_Z, [0, 2, -10])).toBe(true);
    expect(dansChampDeVue(OEIL, VERS_MOINS_Z, [0, 2, 10])).toBe(false);
    expect(dansChampDeVue(OEIL, VERS_MOINS_Z, [10, 2, 0])).toBe(false);
  });
  it("limite à 60° : 59° dedans, 61° dehors, pile 60° dedans", () => {
    const a = (deg: number): Vec3 => [10 * Math.sin((deg * Math.PI) / 180), OEIL[1], -10 * Math.cos((deg * Math.PI) / 180)];
    expect(dansChampDeVue(OEIL, VERS_MOINS_Z, a(59))).toBe(true);
    expect(dansChampDeVue(OEIL, VERS_MOINS_Z, a(61))).toBe(false);
    expect(dansChampDeVue(OEIL, VERS_MOINS_Z, a(60))).toBe(true);
  });
  it("le cône est en 3D : une cible haut dans le ciel sort du champ", () => {
    expect(dansChampDeVue(OEIL, VERS_MOINS_Z, [0, 40, -10])).toBe(false);
    expect(dansChampDeVue(OEIL, directionRegard(0, 1.2), [0, 40, -10])).toBe(true);
  });
  it("accepte un regard non normalisé, un cosinus explicite, une cible confondue avec l'œil", () => {
    expect(dansChampDeVue(OEIL, [0, 0, -7], [0, OEIL[1], -3])).toBe(true);
    expect(dansChampDeVue(OEIL, VERS_MOINS_Z, [5, OEIL[1], -5], 0.9)).toBe(false);
    expect(dansChampDeVue(OEIL, VERS_MOINS_Z, [5, OEIL[1], -5], 0.5)).toBe(true);
    expect(dansChampDeVue(OEIL, VERS_MOINS_Z, [...OEIL])).toBe(true);
    expect(dansChampDeVue(OEIL, [0, 0, 0], [0, 2, -10])).toBe(false);
  });
});

describe("pointsTest", () => {
  it("tête et torse de la silhouette, abaissés si accroupi", () => {
    expect(pointsTest([3, 1, 4], false)).toEqual([[3, 1 + SILHOUETTE.tete.y, 4], [3, 1 + SILHOUETTE.centreY, 4]]);
    expect(pointsTest([3, 1, 4], true)).toEqual([[3, 1 + SILHOUETTE_ACCROUPIE.tete.y, 4], [3, 1 + SILHOUETTE_ACCROUPIE.centreY, 4]]);
  });
});

describe("ligneDeVue", () => {
  it("terrain dégagé : visible", () => {
    const m = mondeAvec();
    expect(ligneDeVue(m, OEIL, [0, 0, -30], false)).toBe(true);
  });

  it("derrière un bâtiment haut : caché ; une fois le bâtiment contourné : visible", () => {
    const m = mondeAvec(rect(-5, -20, 5, -15, 12));
    expect(ligneDeVue(m, OEIL, [0, 0, -30], false)).toBe(false);
    expect(ligneDeVue(m, OEIL, [20, 0, -30], false)).toBe(true);
  });

  it("vrai scene.json : un joueur de l'autre côté de CBA est caché", () => {
    const m = construireMonde(scene);
    const cba = scene.buildings.find((b) => b.r.some(([x, z]) => Math.hypot(x + 162.8, z + 12.7) < 80)) ?? scene.buildings[0];
    const xs = cba.r.map((q) => q[0]), zs = cba.r.map((q) => q[1]);
    const cx = cba.c[0], cz = cba.c[1];
    const oeil: Vec3 = [Math.min(...xs) - 6, SILHOUETTE.oeil, cz];
    const p: Vec3 = [Math.max(...xs) + 6, 0, cz];
    // garde-fou du test : le segment traverse bien un bâtiment (sinon le scénario ne prouve rien)
    expect(collision.visible(m, oeil, [p[0], 1, p[2]])).toBe(false);
    expect(ligneDeVue(m, oeil, p, false)).toBe(false);
    // au-dessus de la toiture / dégagé au nord de l'îlot : visible
    const nord = Math.min(...zs) - 40;
    expect(ligneDeVue(m, [cx, SILHOUETTE.oeil, nord], [cx, 0, nord - 30], false)).toBe(true);
  });

  it("muret de 1,7 m : le joueur debout reste vu par la tête, accroupi il est caché", () => {
    const m = mondeAvec(rect(-5, -16, 5, -14, 1.7));
    expect(ligneDeVue(m, OEIL, [0, 0, -30], false)).toBe(true);
    expect(ligneDeVue(m, OEIL, [0, 0, -30], true)).toBe(false);
  });
});

describe("hauteurPlaquePx", () => {
  it("24 px jusqu'à 30 m, 14 px à partir de 55 m", () => {
    expect(hauteurPlaquePx(0)).toBe(24);
    expect(hauteurPlaquePx(12)).toBe(24);
    expect(hauteurPlaquePx(30)).toBe(24);
    expect(hauteurPlaquePx(55)).toBeCloseTo(14, 10);
    expect(hauteurPlaquePx(70)).toBe(14);
    expect(hauteurPlaquePx(500)).toBe(14);
  });
  it("décroît de façon monotone et continue entre les deux, en 1/distance", () => {
    let prec = hauteurPlaquePx(30);
    for (let d = 30.5; d <= 60; d += 0.5) {
      const px = hauteurPlaquePx(d);
      expect(px).toBeLessThanOrEqual(prec + 1e-12);
      expect(px).toBeGreaterThanOrEqual(14);
      prec = px;
    }
    // 1/d : le point du milieu en 1/d est exactement à mi-hauteur
    const dm = 2 / (1 / 30 + 1 / 55);
    expect(hauteurPlaquePx(dm)).toBeCloseTo(19, 8);
    expect(hauteurPlaquePx(Number.NaN)).toBe(24);
  });
});

describe("VisibilitePseudos", () => {
  const DT = 1 / 60;
  const devant = (id: string, z = -20, extra: Partial<{ vivant: boolean; accroupi: boolean }> = {}) =>
    ({ id, p: [0, 0, z] as Vec3, vivant: true, ...extra });

  /** Fait tourner la visibilité `s` secondes à 60 images/s ; renvoie le temps final. */
  function jouer(v: VisibilitePseudos, t0: number, s: number, joueurs: ReturnType<typeof devant>[], oeil = OEIL, regard = VERS_MOINS_Z) {
    let t = t0;
    const n = Math.round(s / DT);
    for (let i = 0; i < n; i++) { t += DT; v.maj(t, DT, oeil, regard, joueurs); }
    return t;
  }

  it("alpha 0 pour un inconnu ; monte en 0,15 s pour un joueur vu", () => {
    const v = new VisibilitePseudos(mondeAvec());
    expect(v.alpha("a")).toBe(0);
    const j = [devant("a")];
    v.maj(0, DT, OEIL, VERS_MOINS_Z, j);
    expect(v.alpha("a")).toBeCloseTo(DT / PSEUDO.fonduMonteeS, 8);
    jouer(v, 0, 0.1, j);
    expect(v.alpha("a")).toBeGreaterThan(0.5);
    expect(v.alpha("a")).toBeLessThan(1);
    jouer(v, 0.1, 0.1, j);
    expect(v.alpha("a")).toBe(1);
  });

  it("redescend en 0,10 s quand le joueur est masqué ou sort du champ", () => {
    const v = new VisibilitePseudos(mondeAvec());
    const j = [devant("a")];
    let t = jouer(v, 0, 0.3, j);
    expect(v.alpha("a")).toBe(1);
    // le regard se détourne
    t = jouer(v, t, 0.05, j, OEIL, [0, 0, 1]);
    expect(v.alpha("a")).toBeGreaterThan(0.3);
    expect(v.alpha("a")).toBeLessThan(0.7);
    jouer(v, t, 0.06, j, OEIL, [0, 0, 1]);
    expect(v.alpha("a")).toBe(0);
  });

  it("derrière un bâtiment : jamais de plaque", () => {
    const v = new VisibilitePseudos(mondeAvec(rect(-8, -15, 8, -12, 15)));
    jouer(v, 0, 1, [devant("a", -30)]);
    expect(v.alpha("a")).toBe(0);
  });

  it("au-delà de 70 m : aucune plaque, à 69 m : une plaque", () => {
    const v = new VisibilitePseudos(mondeAvec());
    jouer(v, 0, 0.5, [devant("loin", -PSEUDO.distanceMax - 5), devant("proche", -(PSEUDO.distanceMax - 2))]);
    expect(v.alpha("loin")).toBe(0);
    expect(v.alpha("proche")).toBe(1);
  });

  it("un joueur mort n'a pas de plaque, même devant", () => {
    const v = new VisibilitePseudos(mondeAvec());
    jouer(v, 0, 0.5, [devant("mort", -10, { vivant: false })]);
    expect(v.alpha("mort")).toBe(0);
  });

  it("accroupi derrière un muret : pas de plaque ; debout au même endroit : plaque", () => {
    const v = new VisibilitePseudos(mondeAvec(rect(-5, -16, 5, -14, 1.7)));
    jouer(v, 0, 0.5, [devant("bas", -30, { accroupi: true }), devant("haut", -30)]);
    expect(v.alpha("bas")).toBe(0);
    expect(v.alpha("haut")).toBe(1);
  });

  it("ne lance le rayon qu'à 10 Hz par joueur (monde espion sur collision.visible)", () => {
    const espion = vi.spyOn(collision, "visible");
    try {
      const v = new VisibilitePseudos(mondeAvec());
      const joueurs = ["a", "b", "c", "d"].map((id) => devant(id));
      jouer(v, 0, 2, joueurs);
      // tête visible du premier coup : un seul appel par rayon ⇒ 4 joueurs × 10 Hz × 2 s = 80 (+ au plus 1 de tranche par joueur)
      expect(espion.mock.calls.length).toBeGreaterThanOrEqual(4 * 10 * 2 - 4);
      expect(espion.mock.calls.length).toBeLessThanOrEqual(4 * 10 * 2 + 4);
      // et jamais plus d'un rayon (tête) quand elle est visible : pas de second point inutile
    } finally {
      espion.mockRestore();
    }
  });

  it("phases décalées : les joueurs ne sont pas tous testés à la même image", () => {
    const espion = vi.spyOn(collision, "visible");
    try {
      const v = new VisibilitePseudos(mondeAvec());
      const joueurs = Array.from({ length: 16 }, (_, i) => devant(`joueur-${i}`));
      let t = 0;
      let maxParImage = 0;
      // première image : tous les joueurs sont nouveaux (un rayon chacun) ; on mesure ensuite en régime établi
      v.maj(t, DT, OEIL, VERS_MOINS_Z, joueurs);
      for (let i = 0; i < 120; i++) {
        t += DT;
        const avant = espion.mock.calls.length;
        v.maj(t, DT, OEIL, VERS_MOINS_Z, joueurs);
        maxParImage = Math.max(maxParImage, espion.mock.calls.length - avant);
      }
      expect(maxParImage).toBeLessThan(16);
      expect(maxParImage).toBeLessThanOrEqual(6);
    } finally {
      espion.mockRestore();
    }
  });

  it("aucun rayon pour un joueur déjà écarté (trop loin, derrière, mort)", () => {
    const espion = vi.spyOn(collision, "visible");
    try {
      const v = new VisibilitePseudos(mondeAvec());
      jouer(v, 0, 0.5, [devant("loin", -120), devant("derriere", 20), devant("mort", -10, { vivant: false })]);
      expect(espion).not.toHaveBeenCalled();
    } finally {
      espion.mockRestore();
    }
  });

  it("le résultat du rayon est gardé entre deux lancers, et relancé dès qu'un joueur rentre dans le champ", () => {
    const m = mondeAvec(rect(-5, -20, 5, -15, 12));
    const v = new VisibilitePseudos(m);
    const j = [devant("a", -30)];
    let t = jouer(v, 0, 0.5, j);
    expect(v.alpha("a")).toBe(0);
    // le joueur contourne le bâtiment : visible dans les 100 ms
    const j2 = [{ id: "a", p: [20, 0, -30] as Vec3, vivant: true }];
    t = jouer(v, t, 0.1 + 0.15 + 0.02, j2);
    expect(v.alpha("a")).toBe(1);
  });

  it("oublier et vider remettent l'alpha à 0 ; un joueur absent d'une image est oublié", () => {
    const v = new VisibilitePseudos(mondeAvec());
    const j = [devant("a"), devant("b")];
    const t = jouer(v, 0, 0.5, j);
    expect(v.alpha("a")).toBe(1);
    v.oublier("a");
    expect(v.alpha("a")).toBe(0);
    expect(v.alpha("b")).toBe(1);
    v.maj(t + DT, DT, OEIL, VERS_MOINS_Z, []);
    expect(v.alpha("b")).toBe(0);
    jouer(v, t, 0.5, j);
    v.vider();
    expect(v.alpha("a")).toBe(0);
    expect(v.alpha("b")).toBe(0);
  });

  it("dt nul, négatif ou non fini : l'alpha ne bouge pas", () => {
    const v = new VisibilitePseudos(mondeAvec());
    const j = [devant("a")];
    for (const dt of [0, -1, Number.NaN]) {
      v.maj(0, dt, OEIL, VERS_MOINS_Z, j);
      expect(v.alpha("a")).toBe(0);
    }
  });
});
