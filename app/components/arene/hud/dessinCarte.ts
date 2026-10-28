/**
 * Marqueurs dynamiques de la mini-map et de la grande carte (canvas 2D, partagés) : moi + cône de vue, joueurs vus, tirs entendus,
 * Elsa et son cadeau, voitures PNJ et conduisibles, tempête du Battle Royale. Aucune allocation par image (une sortie de projection réutilisée).
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§4.3)
 */
import { CONE_VUE, chevronBord } from "@/lib/fps/minimap";
import { avecAlpha, type PaletteCarte } from "@/lib/fps/minimap-couche";
import { ECHO, type RadarFrame } from "@/lib/fps/radar";

export interface PointEcran { x: number; y: number }

/** Réglages communs du dessin des marqueurs. */
export interface ParamsMarqueurs {
  /** pixels CSS par unité HUD (`u`) */
  u: number;
  palette: PaletteCarte;
  /** pixels de carte par mètre (portée du cône de vue, rayon des échos) */
  pxParM: number;
  /** monde (x, z) → pixels du canvas, écrit dans `out` */
  proj(x: number, z: number, out: PointEcran): void;
  /** rotation de canvas d'un objet de cap monde `cap` (0 = vers le haut) */
  angle(cap: number): number;
  /** position de moi sur la carte et rotation de mon triangle */
  moi: PointEcran;
  /** côté et hauteur utiles du canvas (px) : un point plus loin que `marge` du bord n'est pas dessiné */
  largeur: number;
  hauteur: number;
  /** mini-map seulement : chevron collé au bord pour le cadeau d'Elsa hors cadre (taille du carré, ancre du joueur) */
  chevrons?: { taille: number; ancre: number };
  /** secondes écoulées (pulsations) */
  temps: number;
  effetsReduits: boolean;
  /** police du HUD (famille CSS résolue) */
  police: string;
  /** étiquette « 2/4 » des voitures à moins de 40 m */
  etiquettes: boolean;
}

const sortie: PointEcran = { x: 0, y: 0 };
const MARGE_U = 6;

function dedans(p: ParamsMarqueurs, x: number, y: number, marge: number): boolean {
  return x >= marge && x <= p.largeur - marge && y >= marge && y <= p.hauteur - marge;
}

/** Texte sur sa petite plaque (contraste ≥ 4,5:1 : encre sur `--ag-hud-fond`). */
function etiquette(ctx: CanvasRenderingContext2D, p: ParamsMarqueurs, texte: string, x: number, y: number, alignement: CanvasTextAlign = "center"): void {
  const taille = Math.max(11, Math.round(11 * p.u));
  ctx.font = `600 ${taille}px ${p.police}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = alignement;
  const l = ctx.measureText(texte).width + 6;
  const x0 = alignement === "center" ? x - l / 2 : alignement === "left" ? x - 3 : x - l + 3;
  ctx.fillStyle = p.palette.fond;
  ctx.fillRect(x0, y - taille / 2 - 1, l, taille + 2);
  ctx.fillStyle = p.palette.encre;
  ctx.fillText(texte, x, y + 0.5);
}

/** Étoile à 5 branches (cadeau « arme »). */
function etoile(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}
/** Croix (soin, joueur mort). */
function croix(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
}
function losange(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
  ctx.closePath();
}

function dessinerVoituresPnj(ctx: CanvasRenderingContext2D, f: RadarFrame, p: ParamsMarqueurs): void {
  const { u, palette } = p;
  ctx.lineWidth = Math.max(1, u);
  for (let i = 0; i < f.nPnj; i++) {
    p.proj(f.voituresPnj[i * 3], f.voituresPnj[i * 3 + 1], sortie);
    if (!dedans(p, sortie.x, sortie.y, 0)) continue;
    ctx.save();
    ctx.translate(sortie.x, sortie.y);
    ctx.rotate(p.angle(f.voituresPnj[i * 3 + 2]));
    // 3×5u hachuré : contour danger, trait de hachure en encre atténuée.
    ctx.strokeStyle = palette.danger;
    ctx.strokeRect(-1.5 * u, -2.5 * u, 3 * u, 5 * u);
    ctx.strokeStyle = palette.encreDiscrete;
    ctx.beginPath();
    ctx.moveTo(-1.5 * u, 2.5 * u); ctx.lineTo(1.5 * u, -2.5 * u);
    ctx.stroke();
    ctx.restore();
  }
}

/** Étiquettes « 2/4 » déjà posées pendant cette image (x, y par paire, sans allocation) : les voitures d'un même parking ne se recouvrent pas. */
const etiquettesPosees = new Float32Array(2 * 16);

function dessinerVoitures(ctx: CanvasRenderingContext2D, f: RadarFrame, p: ParamsMarqueurs): void {
  const { u, palette } = p;
  let nEtiquettes = 0;
  const ecartX = 30 * Math.max(1, p.u), ecartY = 14 * Math.max(1, p.u);
  for (let i = 0; i < f.nVoitures; i++) {
    const v = f.voitures[i];
    p.proj(v.x, v.z, sortie);
    if (!dedans(p, sortie.x, sortie.y, 0)) continue;
    const x = sortie.x, y = sortie.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.angle(v.cap));
    // 5×9u, contour cyan (ambre pour la mienne, remplie pour la repérer sans la couleur : épaisseur + plein).
    ctx.lineWidth = Math.max(1.5, 1.5 * u);
    ctx.strokeStyle = v.moi ? palette.ambre : palette.cyan;
    if (v.moi) { ctx.fillStyle = palette.ambre; ctx.fillRect(-2.5 * u, -4.5 * u, 5 * u, 9 * u); }
    else ctx.strokeRect(-2.5 * u, -4.5 * u, 5 * u, 9 * u);
    // 4 points de sièges (2 × 2) : plein = occupé.
    const places = Math.max(1, Math.min(4, v.places));
    for (let s = 0; s < places; s++) {
      const sx = (s % 2 ? 1 : -1) * 1.1 * u, sy = (s < 2 ? -1 : 1) * 1.6 * u;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1, 0.8 * u), 0, Math.PI * 2);
      if (s < v.occupants) { ctx.fillStyle = v.moi ? palette.fond : palette.cyan; ctx.fill(); }
      else { ctx.strokeStyle = v.moi ? palette.fond : palette.cyan; ctx.lineWidth = 1; ctx.stroke(); }
    }
    ctx.restore();
    if (p.etiquettes && Math.hypot(v.x - f.x, v.z - f.z) < 40) {
      // une étiquette qui en recouvrirait une autre est omise (les 4 points de sièges de la voiture disent déjà qui est assis)
      const ey = y + 8 * u;
      let libre = nEtiquettes < etiquettesPosees.length / 2;
      for (let k = 0; libre && k < nEtiquettes; k++) {
        if (Math.abs(etiquettesPosees[2 * k] - x) < ecartX && Math.abs(etiquettesPosees[2 * k + 1] - ey) < ecartY) libre = false;
      }
      if (libre) {
        etiquettesPosees[2 * nEtiquettes] = x;
        etiquettesPosees[2 * nEtiquettes + 1] = ey;
        nEtiquettes++;
        etiquette(ctx, p, `${v.occupants}/${v.places}`, x, ey);
      }
    }
  }
}

function dessinerEchos(ctx: CanvasRenderingContext2D, f: RadarFrame, p: ParamsMarqueurs): void {
  ctx.strokeStyle = p.palette.danger;
  for (let i = 0; i < f.nEchos; i++) {
    const e = f.echos[i];
    p.proj(e.x, e.z, sortie);
    if (!dedans(p, sortie.x, sortie.y, 0)) continue;
    const t = Math.min(1, e.age / ECHO.dureeS);
    // L'anneau s'élargit en s'estompant ; effets réduits : rayon fixe, seul le fondu reste.
    const r = (p.effetsReduits ? 9 : 4 + 12 * t) * p.u;
    ctx.globalAlpha = 1 - t;
    ctx.lineWidth = Math.max(1.5, 2 * p.u);
    ctx.beginPath();
    ctx.arc(sortie.x, sortie.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function dessinerElsa(ctx: CanvasRenderingContext2D, f: RadarFrame, p: ParamsMarqueurs): void {
  const { u, palette } = p;
  p.proj(f.elsaPos.x, f.elsaPos.z, sortie);
  const ex = sortie.x, ey = sortie.y;
  if (dedans(p, ex, ey, 0)) {
    // Losange ambre 10u, fixe.
    ctx.fillStyle = palette.ambre;
    losange(ctx, ex, ey, 5 * u);
    ctx.fill();
    ctx.strokeStyle = palette.fond;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  const o = f.elsa;
  if (!o) return;
  const cadre = p.chevrons;
  const marge = MARGE_U * u;
  if (dedans(p, ex, ey, 0) && (!cadre || dedans(p, ex, ey, marge))) {
    // Anneau ambre qui pulse (1,2 s) + croix (soin) ou étoile (arme).
    const phase = p.effetsReduits ? 0.5 : (p.temps % 1.2) / 1.2;
    ctx.strokeStyle = palette.ambre;
    ctx.lineWidth = Math.max(1.5, 2 * u);
    ctx.beginPath();
    ctx.arc(ex, ey, (9 + 5 * phase) * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.5, 2 * u);
    if (o.genre === "soin") croix(ctx, ex, ey, 3.5 * u);
    else { ctx.fillStyle = palette.ambre; etoile(ctx, ex, ey, 4.5 * u); ctx.fill(); return; }
    ctx.stroke();
    return;
  }
  if (!cadre) return;
  // Hors cadre : chevron collé au bord et distance arrondie à 10 m.
  const c = chevronBord(ex, ey, cadre.taille, marge, cadre.ancre);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.angle);
  ctx.fillStyle = palette.ambre;
  ctx.beginPath();
  ctx.moveTo(0, -6 * u); ctx.lineTo(5 * u, 4 * u); ctx.lineTo(0, 1.5 * u); ctx.lineTo(-5 * u, 4 * u);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Le texte se place du côté intérieur du chevron.
  const ty = c.y < cadre.taille / 2 ? c.y + 13 * u : c.y - 13 * u;
  const tx = Math.min(cadre.taille - 16 * u, Math.max(16 * u, c.x));
  etiquette(ctx, p, `${o.distance} m`, tx, ty);
}

function dessinerJoueurs(ctx: CanvasRenderingContext2D, f: RadarFrame, p: ParamsMarqueurs): void {
  const { u, palette } = p;
  for (let i = 0; i < f.nJoueurs; i++) {
    const j = f.joueurs[i];
    p.proj(j.x, j.z, sortie);
    if (!dedans(p, sortie.x, sortie.y, 0)) continue;
    const x = sortie.x, y = sortie.y;
    ctx.globalAlpha = j.etat === "mort" ? 1 : Math.max(0.15, Math.min(1, j.vu));
    if (j.etat === "mort") {
      // Croix (mort, 3 s) : contour clair puis trait de la couleur du joueur.
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(3, 3.5 * u);
      ctx.strokeStyle = palette.blanc;
      croix(ctx, x, y, 3.5 * u); ctx.stroke();
      ctx.lineWidth = Math.max(1.5, 1.8 * u);
      ctx.strokeStyle = j.couleur;
      croix(ctx, x, y, 3.5 * u); ctx.stroke();
      continue;
    }
    ctx.lineWidth = Math.max(1.5, 1.5 * u);
    ctx.strokeStyle = palette.blanc;
    ctx.fillStyle = j.couleur;
    ctx.beginPath();
    // Disque 7u à pied, carré en voiture.
    if (j.etat === "voiture") ctx.rect(x - 3.5 * u, y - 3.5 * u, 7 * u, 7 * u);
    else ctx.arc(x, y, 3.5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Trait de cap de 6u.
    const a = p.angle(j.cap);
    ctx.beginPath();
    ctx.moveTo(x + Math.sin(a) * 3.5 * u, y - Math.cos(a) * 3.5 * u);
    ctx.lineTo(x + Math.sin(a) * 9.5 * u, y - Math.cos(a) * 9.5 * u);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Tigres zombies VUS : points rouges (contour clair), d'autant plus nets que le fondu de visibilité est haut. */
function dessinerZombies(ctx: CanvasRenderingContext2D, f: RadarFrame, p: ParamsMarqueurs): void {
  const { u, palette } = p;
  ctx.lineWidth = Math.max(1, u);
  for (let i = 0; i < f.nZombies; i++) {
    p.proj(f.zombies[i * 3], f.zombies[i * 3 + 1], sortie);
    if (!dedans(p, sortie.x, sortie.y, 0)) continue;
    ctx.globalAlpha = Math.max(0.2, Math.min(1, f.zombies[i * 3 + 2]));
    ctx.fillStyle = palette.danger;
    ctx.strokeStyle = palette.blanc;
    ctx.beginPath();
    ctx.arc(sortie.x, sortie.y, 3 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Portes payantes encore fermées : trait ambre barré de petits traits (une porte ouverte disparaît de la carte). */
function dessinerPortes(ctx: CanvasRenderingContext2D, f: RadarFrame, p: ParamsMarqueurs): void {
  const { u, palette } = p;
  const a: PointEcran = { x: 0, y: 0 }, b: PointEcran = { x: 0, y: 0 };
  ctx.strokeStyle = palette.ambre;
  ctx.lineCap = "butt";
  for (let i = 0; i < f.nPortes; i++) {
    p.proj(f.portes[i * 4], f.portes[i * 4 + 1], a);
    p.proj(f.portes[i * 4 + 2], f.portes[i * 4 + 3], b);
    if (!dedans(p, a.x, a.y, -40 * u) && !dedans(p, b.x, b.y, -40 * u)) continue;
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    ctx.lineWidth = Math.max(2, 2.5 * u);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // barres : une tous les 3u de long, perpendiculaires
    ctx.lineWidth = Math.max(1, u);
    ctx.beginPath();
    const pas = Math.max(3 * u, 4);
    for (let d = pas / 2; d < l; d += pas) {
      const x = a.x + (dx / l) * d, y = a.y + (dy / l) * d;
      ctx.moveTo(x - nx * 2.5 * u, y - ny * 2.5 * u); ctx.lineTo(x + nx * 2.5 * u, y + ny * 2.5 * u);
    }
    ctx.stroke();
  }
  ctx.lineCap = "round";
}

function dessinerMoi(ctx: CanvasRenderingContext2D, f: RadarFrame, p: ParamsMarqueurs): void {
  const { u, palette } = p;
  const { x, y } = p.moi;
  // Cône de vue de 90° sur 40 m : dégradé cyan à 18 %.
  const portee = CONE_VUE.porteeM * p.pxParM;
  const a = p.angle(f.lacet) - Math.PI / 2;
  const degrade = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, portee));
  degrade.addColorStop(0, avecAlpha(palette.cyan, 0.18));
  degrade.addColorStop(1, avecAlpha(palette.cyan, 0));
  ctx.fillStyle = degrade;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, portee, a - CONE_VUE.ouverture / 2, a + CONE_VUE.ouverture / 2);
  ctx.closePath();
  ctx.fill();
  // Triangle blanc 11u (dans une voiture : le cap du véhicule).
  const cap = Number.isNaN(f.capVehicule) ? f.lacet : f.capVehicule;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(p.angle(cap));
  ctx.fillStyle = palette.blanc;
  ctx.strokeStyle = palette.fond;
  ctx.lineWidth = Math.max(1, u);
  ctx.beginPath();
  ctx.moveTo(0, -5.5 * u); ctx.lineTo(4.5 * u, 5 * u); ctx.lineTo(0, 2.5 * u); ctx.lineTo(-4.5 * u, 5 * u);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function dessinerBusC3(ctx: CanvasRenderingContext2D, f: RadarFrame, p: ParamsMarqueurs): void {
  if (!f.bus || !f.bus.actif) return;
  const { u, palette } = p;
  p.proj(f.bus.x, f.bus.z, sortie);
  if (!dedans(p, sortie.x, sortie.y, 0)) return;
  ctx.save();
  ctx.translate(sortie.x, sortie.y);
  ctx.rotate(p.angle(f.bus.cap));
  ctx.lineWidth = Math.max(2, 2 * u);
  ctx.strokeStyle = palette.cyan;
  ctx.fillStyle = palette.fond;
  ctx.fillRect(-3 * u, -7 * u, 6 * u, 14 * u);
  ctx.strokeRect(-3 * u, -7 * u, 6 * u, 14 * u);
  ctx.fillStyle = palette.ambre;
  ctx.font = `bold ${Math.max(9, Math.round(7 * u))}px ${p.police}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("C3", 0, 0);
  ctx.restore();
}

function dessinerFumigenes(ctx: CanvasRenderingContext2D, f: RadarFrame, p: ParamsMarqueurs): void {
  if (!f.fumigenes || !f.fumigenes.length) return;
  const { u, pxParM } = p;
  for (const fum of f.fumigenes) {
    p.proj(fum.x, fum.z, sortie);
    if (!dedans(p, sortie.x, sortie.y, 0)) continue;
    const rPx = fum.r * pxParM;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sortie.x, sortie.y, rPx, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(200, 210, 225, 0.25)";
    ctx.fill();
    ctx.strokeStyle = "rgba(200, 210, 225, 0.6)";
    ctx.lineWidth = Math.max(1, u);
    ctx.setLineDash([3 * u, 3 * u]);
    ctx.stroke();
    ctx.restore();
  }
}

function dessinerFrappeZone(ctx: CanvasRenderingContext2D, f: RadarFrame, p: ParamsMarqueurs): void {
  if (!f.frappeZone) return;
  const { u, pxParM } = p;
  p.proj(f.frappeZone.x, f.frappeZone.z, sortie);
  if (!dedans(p, sortie.x, sortie.y, 0)) return;
  const rPx = f.frappeZone.r * pxParM;
  ctx.save();
  ctx.beginPath();
  ctx.arc(sortie.x, sortie.y, rPx, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 30, 60, 0.2)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 30, 60, 0.85)";
  ctx.lineWidth = Math.max(2, 2 * u);
  ctx.stroke();
  ctx.restore();
}

/**
 * Tempête du Battle Royale (v8) : l'extérieur du cercle courant est voilé de danger (règle pair-impair sur le canvas entier), le cercle courant
 * est cerclé de danger, le prochain cercle suit en tirets blancs. Les cercles ne tournent pas : seuls leurs centres passent par `proj`.
 * Dessinée avant les joueurs et le marqueur « moi », qui restent lisibles dans la tempête.
 */
function dessinerZoneBr(ctx: CanvasRenderingContext2D, f: RadarFrame, p: ParamsMarqueurs): void {
  const z = f.zoneBr;
  if (!z) return;
  const { u, pxParM, palette } = p;
  p.proj(z.x, z.z, sortie);
  const cx = sortie.x, cy = sortie.y, r = Math.max(0, z.r) * pxParM;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, p.largeur, p.hauteur);
  if (r > 0) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, Math.PI * 2); }
  ctx.fillStyle = avecAlpha(palette.danger, 0.22);
  ctx.fill("evenodd");
  if (r > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = palette.danger;
    ctx.lineWidth = Math.max(2, 2 * u);
    ctx.stroke();
  }
  p.proj(z.prochainX, z.prochainZ, sortie);
  const rp = Math.max(0, z.prochainR) * pxParM;
  if (rp > 0) {
    ctx.beginPath();
    ctx.arc(sortie.x, sortie.y, rp, 0, Math.PI * 2);
    ctx.strokeStyle = palette.blanc;
    ctx.lineWidth = Math.max(1, u);
    ctx.setLineDash([4 * u, 3 * u]);
    ctx.stroke();
  }
  ctx.restore();
}

/** Dessine tous les marqueurs dynamiques du `RadarFrame` (ordre : PNJ, voitures, échos, Elsa, portes fermées, tigres, joueurs, moi). */
export function dessinerMarqueurs(ctx: CanvasRenderingContext2D, f: RadarFrame, p: ParamsMarqueurs): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  dessinerZoneBr(ctx, f, p);
  dessinerFumigenes(ctx, f, p);
  dessinerFrappeZone(ctx, f, p);
  dessinerBusC3(ctx, f, p);
  dessinerVoituresPnj(ctx, f, p);
  dessinerVoitures(ctx, f, p);
  dessinerEchos(ctx, f, p);
  dessinerElsa(ctx, f, p);
  dessinerPortes(ctx, f, p);
  dessinerZombies(ctx, f, p);
  dessinerJoueurs(ctx, f, p);
  dessinerMoi(ctx, f, p);
}

/** Nom d'un POI, droit, sur sa plaque (dessiné à chaque image : la carte tourne, pas le texte). */
export function dessinerNomPoi(ctx: CanvasRenderingContext2D, p: ParamsMarqueurs, texte: string, x: number, y: number): void {
  etiquette(ctx, p, texte, x, y + 9 * p.u);
}
export { etiquette as dessinerEtiquette };
