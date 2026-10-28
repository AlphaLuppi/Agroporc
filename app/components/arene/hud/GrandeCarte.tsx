"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SceneData } from "@/lib/agroparc3d/types";
import { ZONE_CARTE, capEcranObjet, depuisZone, nomCourtPoi, versZone } from "@/lib/fps/minimap";
import { dessinerCouche, dimensionsCouche, paletteDepuisElement, type DimensionsCouche, type PaletteCarte } from "@/lib/fps/minimap-couche";
import type { RadarFrame } from "@/lib/fps/radar";
import { dessinerEtiquette, dessinerMarqueurs, type ParamsMarqueurs, type PointEcran } from "./dessinCarte";
import styles from "./GrandeCarte.module.css";
import { useMouvementReduit } from "./useMouvementReduit";

/**
 * Grande carte (§4.4) : touche M maintenue, zone entière en 600u, nord en haut, grille de 100 m, POI ; son rAF ne tourne que tant qu'elle est visible.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 *
 * Sa propre couche statique (même dessin que la mini-map, sans les chemins piétons) est construite à la première ouverture, à 1 px/m,
 * et libérée au démontage. Inactive pendant la killcam et la pause : l'hôte passe alors `visible={false}`.
 */
export interface PropsGrandeCarte {
  scene: SceneData | null;
  radar(): RadarFrame;
  visible: boolean;
  /** libellé de la touche dans la légende (« M » par défaut) */
  toucheCarte?: string;
  /** réglage « Effets : réduits » (anneaux fixes) */
  effetsReduits?: boolean;
  /** Frappe aérienne disponible (série de 5 kills) : permet de cliquer sur la carte */
  frappeDisponible?: boolean;
  surLancerFrappe?: (cible: [number, number, number]) => void;
}

/** Largeur de la carte en unités HUD (§4.4) et pas de la grille (m). */
const LARGEUR_U = 600;
const GRILLE_M = 100;
const PX_PAR_M_COUCHE = 1;

export default function GrandeCarte({
  scene,
  radar,
  visible,
  toucheCarte = "M",
  effetsReduits = false,
  frappeDisponible = false,
  surLancerFrappe,
}: PropsGrandeCarte) {
  const cadreRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coucheRef = useRef<{ canvas: HTMLCanvasElement; dim: DimensionsCouche } | null>(null);
  const paletteRef = useRef<PaletteCarte | null>(null);
  const mouvementReduit = useMouvementReduit();
  const reduits = effetsReduits || mouvementReduit;
  const radarRef = useRef(radar);
  const reduitsRef = useRef(reduits);
  const [curseur, setCurseur] = useState<{ x: number; y: number } | null>(null);
  const curseurRef = useRef(curseur);
  curseurRef.current = curseur;

  useEffect(() => { radarRef.current = radar; reduitsRef.current = reduits; });

  const zone = scene ? ZONE_CARTE(scene) : null;
  const ratio = zone ? (zone.x1 - zone.x0) / (zone.z1 - zone.z0) : 4 / 3;

  // Libère la couche statique au démontage (sortie de l'arène).
  useEffect(() => () => {
    if (coucheRef.current) coucheRef.current.canvas.width = 0;
    coucheRef.current = null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current, cadre = cadreRef.current;
    if (!visible || !scene || !canvas || !cadre) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const z = ZONE_CARTE(scene);
    if (!paletteRef.current) paletteRef.current = paletteDepuisElement(canvas);
    const palette = paletteRef.current;
    if (!coucheRef.current) {
      const dim = dimensionsCouche(scene, PX_PAR_M_COUCHE);
      const hors = document.createElement("canvas");
      hors.width = dim.largeurPx; hors.height = dim.hauteurPx;
      const c = hors.getContext("2d");
      if (c) { dessinerCouche(scene, palette, c, dim, { avecPietons: false }); coucheRef.current = { canvas: hors, dim }; }
    }
    const police = getComputedStyle(canvas).fontFamily || "monospace";
    const pt: PointEcran = { x: 0, y: 0 }, moi: PointEcran = { x: 0, y: 0 };
    let W = 0, H = 0, dpr = 1, u = 1;
    const mesurer = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = cadre.getBoundingClientRect();
      W = Math.round(r.width); H = Math.round(r.height);
      if (W < 8 || H < 8) return;
      u = W / LARGEUR_U;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    };
    mesurer();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(mesurer) : null;
    ro?.observe(cadre);

    const params: ParamsMarqueurs = {
      u, palette, pxParM: 1, largeur: 1, hauteur: 1, temps: 0, effetsReduits: false, etiquettes: true, police, moi,
      proj: (x, zz, out) => { const p = versZone(z, W, H, x, zz); out.x = p.x; out.y = p.y; },
      // Nord en haut : un objet de cap `c` tourne de −c.
      angle: (cap) => capEcranObjet("nord", 0, cap),
    };
    let raf = 0;
    const boucle = (now: number) => {
      raf = requestAnimationFrame(boucle);
      if (W < 8 || H < 8) return;
      const f = radarRef.current();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = palette.sol;
      ctx.fillRect(0, 0, W, H);
      const couche = coucheRef.current;
      if (couche && couche.canvas.width > 0) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(couche.canvas, 0, 0, W, H);
      }
      // Grille de 100 m (lignes aux multiples de 100 m du repère de la scène).
      ctx.strokeStyle = palette.encreDiscrete;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.ceil(z.x0 / GRILLE_M) * GRILLE_M; x < z.x1; x += GRILLE_M) {
        const p = versZone(z, W, H, x, z.z0); ctx.moveTo(Math.round(p.x) + 0.5, 0); ctx.lineTo(Math.round(p.x) + 0.5, H);
      }
      for (let zz = Math.ceil(z.z0 / GRILLE_M) * GRILLE_M; zz < z.z1; zz += GRILLE_M) {
        const p = versZone(z, W, H, z.x0, zz); ctx.moveTo(0, Math.round(p.y) + 0.5); ctx.lineTo(W, Math.round(p.y) + 0.5);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      params.u = u; params.pxParM = W / (z.x1 - z.x0); params.largeur = W; params.hauteur = H; params.temps = now / 1000;
      params.effetsReduits = reduitsRef.current;
      versZoneDans(z, W, H, f.x, f.z, moi);
      for (const poi of scene.pois) {
        versZoneDans(z, W, H, poi.x, poi.z, pt);
        dessinerEtiquette(ctx, params, nomCourtPoi(poi), pt.x, pt.y + 9 * u);
      }
      dessinerMarqueurs(ctx, f, params);

      // Réticule de ciblage pour la frappe aérienne sous le curseur
      const cur = curseurRef.current;
      if (frappeDisponible && cur) {
        const rPx = 18 * params.pxParM; // rayon de zone 18m
        const clignote = Math.floor(now / 250) % 2 === 0;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cur.x, cur.y, rPx, 0, 2 * Math.PI);
        ctx.fillStyle = clignote ? "rgba(255, 59, 48, 0.2)" : "rgba(255, 149, 0, 0.2)";
        ctx.fill();
        ctx.strokeStyle = clignote ? "#ff3b30" : "#ff9500";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Réticule croisé
        ctx.beginPath();
        ctx.moveTo(cur.x - rPx - 8, cur.y);
        ctx.lineTo(cur.x + rPx + 8, cur.y);
        ctx.moveTo(cur.x, cur.y - rPx - 8);
        ctx.lineTo(cur.x, cur.y + rPx + 8);
        ctx.stroke();

        ctx.font = `bold ${Math.max(11, Math.round(11 * u))}px ${police}`;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText("FRAPPE AÉRIENNE (18m)", cur.x, cur.y - rPx - 6);
        ctx.restore();
      }

      ctx.strokeStyle = palette.cadre;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, W - 2, H - 2);
    };
    raf = requestAnimationFrame(boucle);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [visible, scene, frappeDisponible]);

  if (!visible || !scene) return null;
  const style = { "--ratio": ratio } as CSSProperties;

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!frappeDisponible || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setCurseur({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handlePointerLeave = () => {
    setCurseur(null);
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!frappeDisponible || !surLancerFrappe || !canvasRef.current || !zone) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const cibleMonde = depuisZone(zone, rect.width, rect.height, cx, cy);
    surLancerFrappe([cibleMonde.x, 0, cibleMonde.z]);
    setCurseur(null);
  };

  return (
    <div className={styles.voile} data-ciblage={frappeDisponible ? "oui" : undefined} role="region" aria-label="Grande carte">
      <div className={styles.panneau} style={style}>
        <div className={styles.cadre} ref={cadreRef}>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            data-ciblage={frappeDisponible ? "oui" : undefined}
            role="img"
            aria-label="Grande carte de la zone de jeu, nord en haut"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onClick={handleClick}
          />
        </div>
        <p className={styles.legende}>
          {frappeDisponible && (
            <span className={styles.legendeAlerte}>⚡ FRAPPE AÉRIENNE DISPONIBLE : Cliquez sur la carte pour cibler l&apos;attaque ! · </span>
          )}
          Nord en haut · grille de {GRILLE_M} m · relâcher <kbd className={styles.touche}>{toucheCarte}</kbd> pour fermer
        </p>
      </div>
    </div>
  );
}

function versZoneDans(z: ReturnType<typeof ZONE_CARTE>, W: number, H: number, x: number, zz: number, out: PointEcran): void {
  const p = versZone(z, W, H, x, zz);
  out.x = p.x; out.y = p.y;
}
