/**
 * Couche statique de la mini-map (PUR, contexte 2D INJECTABLE pour les tests) : eau, routes, bâtiments, parkings et POI de scene.json
 * dessinés une seule fois dans un canvas hors écran (à `min(1,5 px/m, 8 Mpx / aire)`), ensuite simplement translatés / tournés / mis à
 * l'échelle à chaque image. Les couleurs sont lues une fois via `getComputedStyle` (`PaletteCarte`). Libérée à la sortie de l'arène.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§4.1)
 *
 * Les noms des POI ne sont PAS dans la couche : la carte tourne, un texte tourné serait illisible, ils sont dessinés droits à chaque image
 * par `MiniMap.tsx`. La couche ne porte que le picto (losange). Tout est découpé au rectangle du canvas : aucune coordonnée hors canvas.
 */
import type { SceneData, Vec2 } from "../agroparc3d/types";
import { ZONE_CARTE, type ZoneJouable } from "./minimap";

/** Résolution de la couche : 1,5 px par mètre, 8 millions de pixels au plus. */
export const COUCHE = { pxParM: 1.5, pixelsMax: 8_000_000, margeM: 60 } as const;
/** Largeur des routes dans la couche (px) : voie principale / résidentielle, desserte, piéton (§4.1). */
export const LARGEUR_ROUTE = { M: 3, R: 3, S: 2, F: 1 } as const;
/** Demi-diagonale (px de la couche) du losange d'un POI. */
export const DEMI_POI_PX = 4;

/** Couleurs de la carte, lues une fois dans le CSS du HUD (tokens `--ag-*`). */
export interface PaletteCarte {
  eau: string; routeM: string; routeS: string; routeF: string;
  batimentFond: string; batimentContour: string; parking: string; poi: string; sol: string;
  /** couleurs des marqueurs dynamiques (dessinés par MiniMap / GrandeCarte) */
  cyan: string; ambre: string; danger: string; encre: string; encreDiscrete: string; blanc: string; cadre: string; fond: string;
}
/** Sous-ensemble du contexte 2D utilisé (un faux contexte l'implémente dans les tests). */
export interface Contexte2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
  beginPath(): void; closePath(): void;
  moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  fill(fillRule?: CanvasFillRule): void; stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText?(texte: string, x: number, y: number): void;
}
export interface DimensionsCouche { largeurPx: number; hauteurPx: number; echelle: number; x0: number; z0: number }
/** Options du dessin : les chemins piétons (classe F) ne sont tracés que de près (rayon ≤ 100 m, §4.1). */
export interface OptionsCouche { avecPietons?: boolean }

/**
 * Dimensions et échelle de la couche pour cette scène (échelle plafonnée à `COUCHE.pixelsMax`). `pxParM` permet une résolution plus
 * faible (grande carte : la taille d'affichage suffit), jamais au-delà de `COUCHE.pxParM`.
 */
export function dimensionsCouche(scene: SceneData, pxParM: number = COUCHE.pxParM, zone?: ZoneJouable): DimensionsCouche {
  const z = zone ?? ZONE_CARTE(scene);
  const lm = z.x1 - z.x0, hm = z.z1 - z.z0;
  const aire = Math.max(1, lm * hm);
  const echelle = Math.min(COUCHE.pxParM, Math.max(0.05, pxParM), Math.sqrt(COUCHE.pixelsMax / aire));
  return { largeurPx: Math.max(1, Math.ceil(lm * echelle)), hauteurPx: Math.max(1, Math.ceil(hm * echelle)), echelle, x0: z.x0, z0: z.z0 };
}

/* ---------- découpe au rectangle ---------- */

interface Rect { x0: number; y0: number; x1: number; y1: number }

/** Segments d'une polyligne découpée au rectangle (Liang-Barsky) : chaque morceau continu est une polyligne. */
export function decouperPolyligne(pts: readonly Vec2[], r: Rect): Vec2[][] {
  const morceaux: Vec2[][] = [];
  let courant: Vec2[] | null = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = decouperSegment(pts[i], pts[i + 1], r);
    if (!seg) { courant = null; continue; }
    const [a, b, entreEn0, sortEn1] = seg;
    if (courant && entreEn0) courant.push(b);
    else { courant = [a, b]; morceaux.push(courant); }
    if (!sortEn1) courant = null;
  }
  return morceaux;
}
/** [début, fin, début inchangé, fin inchangée] du segment dans le rectangle, null s'il est entièrement dehors. */
function decouperSegment(p: Vec2, q: Vec2, r: Rect): [Vec2, Vec2, boolean, boolean] | null {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  let t0 = 0, t1 = 1;
  const bornes: [number, number][] = [[-dx, p[0] - r.x0], [dx, r.x1 - p[0]], [-dy, p[1] - r.y0], [dy, r.y1 - p[1]]];
  for (const [pk, qk] of bornes) {
    if (pk === 0) { if (qk < 0) return null; continue; }
    const t = qk / pk;
    if (pk < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [[p[0] + t0 * dx, p[1] + t0 * dy], [p[0] + t1 * dx, p[1] + t1 * dy], t0 === 0, t1 === 1];
}
/** Polygone découpé au rectangle (Sutherland-Hodgman) ; vide s'il est entièrement dehors. */
export function decouperPolygone(pts: readonly Vec2[], r: Rect): Vec2[] {
  let sortie: Vec2[] = pts.map((p) => [p[0], p[1]]);
  const bords: { dedans: (p: Vec2) => boolean; coupe: (a: Vec2, b: Vec2) => Vec2 }[] = [
    { dedans: (p) => p[0] >= r.x0, coupe: (a, b) => [r.x0, a[1] + ((b[1] - a[1]) * (r.x0 - a[0])) / (b[0] - a[0])] },
    { dedans: (p) => p[0] <= r.x1, coupe: (a, b) => [r.x1, a[1] + ((b[1] - a[1]) * (r.x1 - a[0])) / (b[0] - a[0])] },
    { dedans: (p) => p[1] >= r.y0, coupe: (a, b) => [a[0] + ((b[0] - a[0]) * (r.y0 - a[1])) / (b[1] - a[1]), r.y0] },
    { dedans: (p) => p[1] <= r.y1, coupe: (a, b) => [a[0] + ((b[0] - a[0]) * (r.y1 - a[1])) / (b[1] - a[1]), r.y1] },
  ];
  for (const bord of bords) {
    const entree = sortie;
    sortie = [];
    for (let i = 0; i < entree.length; i++) {
      const a = entree[i], b = entree[(i + 1) % entree.length];
      const da = bord.dedans(a), db = bord.dedans(b);
      if (da && db) sortie.push(b);
      else if (da && !db) sortie.push(bord.coupe(a, b));
      else if (!da && db) { sortie.push(bord.coupe(a, b), b); }
    }
    if (!sortie.length) break;
  }
  return sortie;
}

/* ---------- dessin ---------- */

/** Dessine la couche statique dans `ctx` (aucune coordonnée hors canvas). */
export function dessinerCouche(scene: SceneData, palette: PaletteCarte, ctx: Contexte2D, dim: DimensionsCouche, options: OptionsCouche = {}): void {
  const avecPietons = options.avecPietons !== false;
  const e = dim.echelle;
  const rect: Rect = { x0: 0, y0: 0, x1: dim.largeurPx, y1: dim.hauteurPx };
  const px = (p: Vec2): Vec2 => [(p[0] - dim.x0) * e, (p[1] - dim.z0) * e];
  const trace = (pts: readonly Vec2[], ferme: boolean) => {
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    if (ferme) ctx.closePath();
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Eau : plans d'eau pleins et cours d'eau en trait.
  ctx.fillStyle = palette.eau;
  for (const w of scene.water) {
    const d = decouperPolygone(w.map(px), rect);
    if (d.length < 3) continue;
    ctx.beginPath(); trace(d, true); ctx.fill();
  }
  ctx.strokeStyle = palette.eau;
  ctx.lineWidth = 2;
  for (const l of scene.wlines) {
    ctx.beginPath();
    for (const m of decouperPolyligne(l.map(px), rect)) trace(m, false);
    ctx.stroke();
  }

  // Parkings : contour fin.
  ctx.strokeStyle = palette.parking;
  ctx.lineWidth = 1;
  for (const p of scene.parkings) {
    const d = decouperPolygone(p.map(px), rect);
    if (d.length < 3) continue;
    ctx.beginPath(); trace(d, true); ctx.stroke();
  }

  // Routes : du plus fin au plus large (les voies principales passent par-dessus).
  const ordre: { classes: string[]; couleur: string; largeur: number }[] = [
    { classes: ["F"], couleur: palette.routeF, largeur: LARGEUR_ROUTE.F },
    { classes: ["S"], couleur: palette.routeS, largeur: LARGEUR_ROUTE.S },
    { classes: ["R", "M"], couleur: palette.routeM, largeur: LARGEUR_ROUTE.M },
  ];
  for (const groupe of ordre) {
    if (groupe.classes[0] === "F" && !avecPietons) continue;
    ctx.strokeStyle = groupe.couleur;
    ctx.lineWidth = groupe.largeur;
    ctx.beginPath();
    for (const r of scene.roads) {
      if (!groupe.classes.includes(r.c)) continue;
      for (const m of decouperPolyligne(r.p.map(px), rect)) trace(m, false);
    }
    ctx.stroke();
  }

  // Bâtiments : remplissage 10 % d'encre, contour 1 px ; les cours intérieures sont des trous (règle paire-impaire).
  ctx.fillStyle = palette.batimentFond;
  ctx.strokeStyle = palette.batimentContour;
  ctx.lineWidth = 1;
  for (const b of scene.buildings) {
    const d = decouperPolygone(b.r.map(px), rect);
    if (d.length < 3) continue;
    ctx.beginPath(); trace(d, true);
    for (const h of b.holes ?? []) {
      const dh = decouperPolygone(h.map(px), rect);
      if (dh.length >= 3) trace(dh, true);
    }
    ctx.fill("evenodd");
    ctx.stroke();
  }

  // POI : losange (le nom est dessiné droit à chaque image par la mini-map).
  ctx.fillStyle = palette.poi;
  for (const poi of scene.pois) {
    const [x, y] = px([poi.x, poi.z]);
    if (x < DEMI_POI_PX || y < DEMI_POI_PX || x > dim.largeurPx - DEMI_POI_PX || y > dim.hauteurPx - DEMI_POI_PX) continue;
    ctx.beginPath();
    ctx.moveTo(x, y - DEMI_POI_PX); ctx.lineTo(x + DEMI_POI_PX, y); ctx.lineTo(x, y + DEMI_POI_PX); ctx.lineTo(x - DEMI_POI_PX, y);
    ctx.closePath();
    ctx.fill();
  }
}

/* ---------- palette ---------- */

/** `#rrggbb` / `#rgb` → `rgba(r, g, b, alpha)` ; toute autre syntaxe est rendue telle quelle (l'alpha est alors perdu). */
export function avecAlpha(couleur: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(couleur.trim());
  if (!m) return couleur;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
/** Repli par jeton si le CSS ne définit pas le token (rendu hors de la racine du HUD, tests). */
const REPLI: Record<string, string> = {
  "--ag-ground": "#04060a", "--ag-ink": "#e6f1f6", "--ag-ink-dim": "#93abb7", "--ag-cyan": "#9be9ff", "--ag-amber": "#ffb35c",
  "--ag-white": "#f2f7fa", "--ag-line-strong": "#43657a", "--ag-danger": "#ff7a6b", "--ag-cadre": "#93abb7", "--ag-hud-fond": "rgba(4, 6, 10, 0.86)",
};
/** Construit la palette à partir d'un lecteur de tokens CSS (`(jeton) => valeur`), injectable. */
export function construirePalette(lire: (jeton: string) => string): PaletteCarte {
  const v = (jeton: string) => (lire(jeton) || "").trim() || REPLI[jeton];
  return {
    eau: avecAlpha(v("--ag-cyan"), 0.14),
    routeM: v("--ag-line-strong"), routeS: v("--ag-line-strong"), routeF: avecAlpha(v("--ag-line-strong"), 0.7),
    batimentFond: avecAlpha(v("--ag-ink"), 0.1), batimentContour: v("--ag-ink-dim"),
    parking: avecAlpha(v("--ag-ink-dim"), 0.6), poi: v("--ag-amber"), sol: v("--ag-ground"),
    cyan: v("--ag-cyan"), ambre: v("--ag-amber"), danger: v("--ag-danger"), encre: v("--ag-ink"), encreDiscrete: v("--ag-ink-dim"),
    blanc: v("--ag-white"), cadre: v("--ag-cadre"), fond: v("--ag-hud-fond"),
  };
}
/** Palette lue UNE FOIS dans le CSS d'un élément du HUD. */
export function paletteDepuisElement(el: Element): PaletteCarte {
  const style = getComputedStyle(el);
  return construirePalette((jeton) => style.getPropertyValue(jeton));
}

export type { ZoneJouable };
