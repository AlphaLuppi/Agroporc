/**
 * Zones de l'arène (PUR) : rond-point, zone d'apparition près du rond-point, Truck Muche garé et point de service d'Elsa, emplacements des
 * voitures conduisibles, conversions lacet / cap. Repère de scene.json : x est, z sud ; lacet / cap 0 = vers −z.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.7, §2.10, §5.3, annexe §10)
 */
import type { SceneData, Vec2 } from "../agroparc3d/types";

/** Le rond-point (ways M `roads[4, 120, 121, 122]`), centre (28,2 ; 2,5), rayon 18,1 m. */
export const ROND_POINT: { readonly centre: Vec2; readonly rayon: number } = { centre: [28.2, 2.5], rayon: 18.1 };
/** Anneau d'apparition 25–140 m autour du rond-point ; bande de choix 40–110 m de l'ennemi le plus proche, repli sur 75 m. */
export const ZONE_APPARITION: { readonly rMin: number; readonly rMax: number; readonly bandeMin: number; readonly bandeMax: number; readonly bandeCible: number } = {
  rMin: 25, rMax: 140, bandeMin: 40, bandeMax: 110, bandeCible: 75,
};
export interface ZoneApparition { centre: Vec2; rMin: number; rMax: number; bandeMin: number; bandeMax: number; bandeCible: number }

/** Zone d'apparition par défaut : l'anneau de la spec autour du rond-point. */
const ZONE_PAR_DEFAUT: ZoneApparition = { centre: ROND_POINT.centre, ...ZONE_APPARITION };
/** Points de `points` dans l'anneau rMin..rMax autour du centre. */
export function filtrerApparitions(points: readonly Vec2[], zone: ZoneApparition = ZONE_PAR_DEFAUT): Vec2[] {
  const [cx, cz] = zone.centre;
  return points.filter(([x, z]) => {
    const d = Math.hypot(x - cx, z - cz);
    return d >= zone.rMin && d <= zone.rMax;
  });
}
/**
 * Règle de choix (§2.10) : parmi `reservoir`, tirage uniforme des points dont la distance à l'ennemi vivant le plus proche est dans [bandeMin, bandeMax] ;
 * si la bande contient moins de 3 points, tirage parmi les 6 points dont cette distance est la plus proche de `bandeCible` ; sans ennemi, tirage uniforme.
 * `alea` injecté ; `reservoir` vide ⇒ le centre de la zone.
 */
export function choisirPointZone(reservoir: readonly Vec2[], ennemis: readonly Vec2[], zone: ZoneApparition, alea: () => number): Vec2 {
  if (!reservoir.length) return [zone.centre[0], zone.centre[1]];
  const tirer = <T>(liste: readonly T[]): T => liste[Math.min(liste.length - 1, Math.floor(alea() * liste.length))];
  if (!ennemis.length) return tirer(reservoir);
  // Distance de chaque point à l'ennemi vivant le plus proche.
  const mesures = reservoir.map((p) => {
    let d = Infinity;
    for (const [ex, ez] of ennemis) d = Math.min(d, Math.hypot(p[0] - ex, p[1] - ez));
    return { p, d };
  });
  const bande = mesures.filter((m) => m.d >= zone.bandeMin && m.d <= zone.bandeMax);
  if (bande.length >= 3) return tirer(bande).p;
  // Bande trop pauvre (ennemi hors de l'anneau, loin du rond-point) : les 6 points les plus proches de la distance cible.
  const proches = [...mesures].sort((a, b) => Math.abs(a.d - zone.bandeCible) - Math.abs(b.d - zone.bandeCible)).slice(0, 6);
  return tirer(proches).p;
}
/** Retrouve l'anneau (les ways M qui se referment autour du centre) dans scene.json ; null si absent. */
export function trouverRondPoint(data: SceneData): { centre: Vec2; rayon: number } | null {
  // 1. Arcs candidats : voies principales courtes dont les points sont cocirculaires (rayon d'un rond-point, pas une droite).
  const arcs: { centre: Vec2; rayon: number; points: Vec2[] }[] = [];
  for (const r of data.roads) {
    if (r.c !== "M" || r.p.length < 3 || r.p.length > 8) continue;
    const c = ajusterCercle(r.p);
    if (c && c.rayon >= 8 && c.rayon <= 40 && c.residu <= 1) arcs.push({ centre: c.centre, rayon: c.rayon, points: r.p });
  }
  // 2. Regrouper les arcs de même cercle ; un rond-point = au moins 3 arcs qui font le tour (aucun trou angulaire de plus de 120°).
  for (const a of arcs) {
    const groupe = arcs.filter((b) => Math.hypot(b.centre[0] - a.centre[0], b.centre[1] - a.centre[1]) < 2 && Math.abs(b.rayon - a.rayon) < 2);
    if (groupe.length < 3) continue;
    const pts = groupe.flatMap((g) => g.points);
    const c = ajusterCercle(pts);
    if (!c || c.residu > 1) continue;
    const angles = pts.map(([x, z]) => Math.atan2(z - c.centre[1], x - c.centre[0])).sort((u, v) => u - v);
    let trou = angles[0] + 2 * Math.PI - angles[angles.length - 1];
    for (let i = 1; i < angles.length; i++) trou = Math.max(trou, angles[i] - angles[i - 1]);
    if (trou <= (120 * Math.PI) / 180) return { centre: c.centre, rayon: c.rayon };
  }
  return null;
}

/** Cercle des moindres carrés (méthode algébrique de Kåsa) ; `residu` = écart maximal d'un point au cercle. null si dégénéré (points alignés). */
function ajusterCercle(pts: readonly Vec2[]): { centre: Vec2; rayon: number; residu: number } | null {
  const n = pts.length;
  let mx = 0, mz = 0;
  for (const [x, z] of pts) { mx += x; mz += z; }
  mx /= n; mz /= n;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const [x, z] of pts) {
    const u = x - mx, v = z - mz;
    suu += u * u; suv += u * v; svv += v * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const b1 = 0.5 * (suuu + suvv), b2 = 0.5 * (svvv + svuu);
  const uc = (b1 * svv - b2 * suv) / det, vc = (suu * b2 - suv * b1) / det;
  const cx = uc + mx, cz = vc + mz;
  const rayon = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  if (!Number.isFinite(rayon)) return null;
  let residu = 0;
  for (const [x, z] of pts) residu = Math.max(residu, Math.abs(Math.hypot(x - cx, z - cz) - rayon));
  return { centre: [cx, cz], rayon, residu };
}
/**
 * Le Truck Muche garé dans l'arène (v3 §2) : Elsa est DEDANS et sert par le passe-plat, sur le flanc droit (côté trottoir). Repère local
 * du truck : avant = −z (cabine), droite = +x (passe-plat), y haut ; le groupe three est tourné de `cap` (convention lacet).
 * Dimensions en mètres ; le truck est un obstacle du monde de collision (`obstacleTruck`, ajouté par `construireMonde`).
 */
export const TRUCK = {
  /** caisse + cabine, de l'arrière (+z) à l'avant (−z) */
  longueur: 7.4,
  largeur: 2.4,
  /** toit de la caisse */
  hauteur: 3.2,
  /** la cabine (à l'avant) : longueur et hauteur */
  cabine: 2,
  hauteurCabine: 2.5,
  /** plancher de la caisse, où se tient Elsa */
  plancher: 0.9,
  /** passe-plat : comptoir (bas), linteau (haut), centre et largeur le long du flanc (z local) */
  comptoir: 1.85,
  linteau: 3.0,
  fenetreZ: 1.0,
  fenetreLargeur: 3.2,
  /** Elsa : distance du flanc vers l'intérieur ; point de service : distance du flanc vers l'extérieur */
  retraitElsa: 0.75,
  avanceService: 1.4,
} as const;

/** Place du truck : centre au sol, cap, point de service (dehors, devant le passe-plat) et position d'Elsa (dedans, sur le plancher). */
export interface PlaceTruck { x: number; z: number; cap: number; service: Vec2; elsa: Vec2 }

/** Repli quand le POI ou la voie d'arrivée manquent : POI historique, nez vers l'ouest-sud-ouest. */
const TRUCK_REPLI = { x: -125, z: 39, cap: capDepuisDirection(-0.83, -0.56) };

/** Point local (x à droite, z vers l'arrière) du truck garé → monde. */
export function versMondeTruck(t: { x: number; z: number; cap: number }, lx: number, lz: number): Vec2 {
  const c = Math.cos(t.cap), s = Math.sin(t.cap);
  // rotation.y = cap : (lx, lz) → (lx·cos + lz·sin, −lx·sin + lz·cos)
  return [t.x + lx * c + lz * s, t.z - lx * s + lz * c];
}

/**
 * Le truck garé sur sa place (POI `truck`), dans le sens où il y arrive (dernier segment du trajet de la vue aérienne : du point de la voie
 * `truckRoad` le plus proche jusqu'à la place). Arrondis au centimètre / milliradian : identiques côté client et serveur.
 */
export function placeTruck(data: SceneData): PlaceTruck {
  const poi = data.pois.find((p) => p.type === "truck");
  let base = TRUCK_REPLI;
  if (poi) {
    let cap = TRUCK_REPLI.cap;
    const route = data.truckRoad ?? [];
    if (route.length >= 2) {
      let best = { d: Infinity, x: 0, z: 0 };
      for (let i = 0; i < route.length - 1; i++) {
        const [ax, az] = route[i], [bx, bz] = route[i + 1];
        const abx = bx - ax, abz = bz - az;
        const u = Math.min(1, Math.max(0, ((poi.x - ax) * abx + (poi.z - az) * abz) / Math.max(abx * abx + abz * abz, 1e-6)));
        const x = ax + abx * u, z = az + abz * u;
        const d = Math.hypot(poi.x - x, poi.z - z);
        if (d < best.d) best = { d, x, z };
      }
      if (best.d > 1) cap = capDepuisDirection(poi.x - best.x, poi.z - best.z);
    }
    base = { x: poi.x, z: poi.z, cap: Math.round(cap * 1000) / 1000 };
  }
  const arrondi = (v: Vec2): Vec2 => [Math.round(v[0] * 100) / 100, Math.round(v[1] * 100) / 100];
  const flanc = TRUCK.largeur / 2;
  return {
    ...base,
    service: arrondi(versMondeTruck(base, flanc + TRUCK.avanceService, TRUCK.fenetreZ)),
    elsa: arrondi(versMondeTruck(base, flanc - TRUCK.retraitElsa, TRUCK.fenetreZ)),
  };
}

/** Emprise (rectangle, sens trigonométrique) et hauteur du truck garé, comme un bâtiment de scene.json (obstacle du monde de collision). */
export function obstacleTruck(data: SceneData): { r: Vec2[]; h: number } | null {
  if (!data.pois.some((p) => p.type === "truck")) return null;
  const t = placeTruck(data);
  const l = TRUCK.largeur / 2, L = TRUCK.longueur / 2;
  return { r: [versMondeTruck(t, -l, -L), versMondeTruck(t, l, -L), versMondeTruck(t, l, L), versMondeTruck(t, -l, L)], h: TRUCK.hauteur };
}

/** Point de service d'Elsa (le ramassage se fait là, devant le passe-plat du truck) ; repli (−120 ; 39) sans POI `truck`. */
export function positionElsa(data: SceneData): Vec2 {
  if (!data.pois.some((p) => p.type === "truck")) return [-120, 39];
  return placeTruck(data).service;
}
/** Six emplacements de `parkings[3]` (rangée A puis B, 9 m entre eux), cap en convention lacet (−1,808 rad : voitures vers l'est-sud-est). */
export const EMPLACEMENTS_VOITURES: readonly { readonly p: Vec2; readonly cap: number }[] = [
  { p: [8.2, -24.5], cap: -1.808 }, { p: [-0.8, -26.5], cap: -1.808 }, { p: [-9.8, -28.5], cap: -1.808 },
  { p: [10.2, -33.5], cap: -1.808 }, { p: [1.2, -35.5], cap: -1.808 }, { p: [-7.8, -37.5], cap: -1.808 },
];
/** Lacet/cap pour regarder de `de` vers `vers` (0 = −z). */
export function lacetVers(de: Vec2, vers: Vec2): number {
  return capDepuisDirection(vers[0] - de[0], vers[1] - de[1]);
}
/** Cap pour un vecteur direction (dx, dz) : atan2(−dx, −dz). */
export function capDepuisDirection(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}
