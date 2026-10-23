/**
 * Étiquettes « 0/4 » des voitures conduisibles sur la mini-carte : à 6 voitures garées sur un même parking (3 à 4 m d'écart, soit
 * 9 px à 2,6 px/m), elles se recouvraient en un bloc illisible (capture de bout en bout du 23/10). Une étiquette qui en recouvrirait
 * une autre est omise ; les 4 points de sièges de chaque voiture disent déjà qui est assis.
 */
import { describe, expect, it } from "vitest";
import { dessinerMarqueurs, type ParamsMarqueurs } from "@/app/components/arene/hud/dessinCarte";
import { ajouterVoiture, creerRadarFrame } from "./radar";
import type { PaletteCarte } from "./minimap-couche";

const palette: PaletteCarte = {
  eau: "#000", routeM: "#000", routeS: "#000", routeF: "#000", batimentFond: "#000", batimentContour: "#000", parking: "#000", poi: "#000", sol: "#000",
  cyan: "#0ff", ambre: "#fa0", danger: "#f00", encre: "#fff", encreDiscrete: "#aaa", blanc: "#fff", cadre: "#333", fond: "#000",
};

/** Faux contexte 2D : tout est accepté, seuls les textes dessinés sont gardés (avec la position). */
function fauxContexte() {
  const textes: { texte: string; x: number; y: number }[] = [];
  const cible = {
    textes,
    measureText: (t: string) => ({ width: 6 * t.length }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    fillText: (texte: string, x: number, y: number) => { textes.push({ texte, x, y }); },
  } as Record<string, unknown>;
  return new Proxy(cible, {
    get: (o, k: string) => (k in o ? o[k] : () => undefined),
    set: (o, k: string, v) => { o[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D & { textes: typeof textes };
}

function params(): ParamsMarqueurs {
  const pxParM = 2.6;
  return {
    u: 1, palette, pxParM,
    proj: (x, z, out) => { out.x = 130 + x * pxParM; out.y = 130 + z * pxParM; },
    angle: () => 0,
    moi: { x: 130, y: 130 },
    largeur: 260, hauteur: 260,
    temps: 0, effetsReduits: true, police: "monospace", etiquettes: true,
  };
}

describe("étiquettes des voitures sur la mini-carte", () => {
  it("n'en pose pas deux qui se recouvrent (6 voitures d'un même parking)", () => {
    const f = creerRadarFrame();
    for (let i = 0; i < 6; i++) ajouterVoiture(f, { id: i, x: 8 + (i % 3) * 3.5, z: -25 + Math.floor(i / 3) * 5, cap: 0, occupants: 0, places: 4, moi: false });
    const ctx = fauxContexte();
    dessinerMarqueurs(ctx, f, params());
    const t = ctx.textes.filter((e) => e.texte === "0/4");
    expect(t.length).toBeGreaterThanOrEqual(1);
    expect(t.length).toBeLessThan(6);
    for (let i = 0; i < t.length; i++) {
      for (let j = i + 1; j < t.length; j++) {
        expect(Math.abs(t[i].x - t[j].x) >= 30 || Math.abs(t[i].y - t[j].y) >= 14).toBe(true);
      }
    }
  });

  it("garde l'étiquette de chaque voiture quand elles sont assez éloignées", () => {
    const f = creerRadarFrame();
    ajouterVoiture(f, { id: 0, x: -20, z: 0, cap: 0, occupants: 1, places: 4, moi: false });
    ajouterVoiture(f, { id: 1, x: 20, z: 0, cap: 0, occupants: 0, places: 4, moi: false });
    const ctx = fauxContexte();
    dessinerMarqueurs(ctx, f, params());
    expect(ctx.textes.map((e) => e.texte).sort()).toEqual(["0/4", "1/4"]);
  });
});
