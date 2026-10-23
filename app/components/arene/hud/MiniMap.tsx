"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SceneData } from "@/lib/agroparc3d/types";
import {
  BISEAU_U, Cadence, TAILLE_CARTE_U, capEcranObjet, nomCourtPoi, nomZone, polygoneCadre, positionNord, projeter, matriceCouche, rayonAuto, tailleEffective,
  type VueCarte,
} from "@/lib/fps/minimap";
import { dessinerCouche, dimensionsCouche, paletteDepuisElement, type DimensionsCouche, type PaletteCarte } from "@/lib/fps/minimap-couche";
import type { RadarFrame } from "@/lib/fps/radar";
import { orientationEffective, type ReglagesMinimap } from "@/lib/fps/reglages-hud";
import { lissage } from "@/lib/fps/vue";
import { dessinerMarqueurs, dessinerNomPoi, dessinerEtiquette, type ParamsMarqueurs, type PointEcran } from "./dessinCarte";
import styles from "./MiniMap.module.css";
import { useMouvementReduit } from "./useMouvementReduit";

/**
 * Mini-map (§4) : canvas 2D en rAF (aucun rendu React), couche statique translatée / tournée, marqueurs dynamiques lus dans `radar()`, adaptatif 60 → 30 Hz.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 *
 * Le composant occupe la largeur de la carte (`--tm` × `--u`) : la colonne de coin (`CoinHud`) le place, il ne se positionne pas lui-même.
 * Les noms de POI sont dessinés droits à chaque image ; la couche statique n'en porte que le picto. Rien ne s'affiche (ni rAF) quand
 * le coin est « off » ou que le HUD est masqué.
 */
export interface PropsMiniMap {
  scene: SceneData | null;
  /** `JeuHandle.radar()` : même objet à chaque image */
  radar(): RadarFrame;
  reglages: ReglagesMinimap;
  /** HUD masqué (killcam, entracte) : la boucle rAF s'arrête */
  masque?: boolean;
  /** libellé de la touche de la grande carte dans la légende (« M » par défaut) */
  toucheCarte?: string;
  /** réglage « Effets : réduits » (anneaux fixes) ; `prefers-reduced-motion` est lu ici */
  effetsReduits?: boolean;
}

/** Demi-largeur ≤ 100 m : les chemins piétons sont tracés dans la couche (§4.1). */
const RAYON_PIETONS_MAX = 100;
/** Raideur (1/s) du lissage du rayon automatique en voiture. */
const RAIDEUR_RAYON = 4;
/** Intervalle (s) de rafraîchissement du nom de zone sous la carte. */
const PERIODE_ZONE_S = 0.25;

interface EtatBoucle {
  radar: () => RadarFrame;
  reglages: ReglagesMinimap;
  scene: SceneData | null;
  cote: number;
  dpr: number;
  taille: "s" | "m" | "l";
  orientation: "regard" | "nord";
  effetsReduits: boolean;
}

export default function MiniMap(p: PropsMiniMap) {
  if (p.reglages.coin === "off") return null;
  return <MiniMapActive {...p} />;
}

function MiniMapActive({ scene, radar, reglages, masque, toucheCarte = "M", effetsReduits = false }: PropsMiniMap) {
  const mouvementReduit = useMouvementReduit();
  const orientation = orientationEffective(reglages, mouvementReduit);
  const [hauteurFenetre, setHauteurFenetre] = useState(1080);
  useEffect(() => {
    const maj = () => setHauteurFenetre(window.innerHeight);
    maj();
    window.addEventListener("resize", maj);
    return () => window.removeEventListener("resize", maj);
  }, []);
  const taille = tailleEffective(reglages.taille, hauteurFenetre);

  const cadreRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoneRef = useRef<HTMLSpanElement>(null);
  const coucheRef = useRef<{ canvas: HTMLCanvasElement; dim: DimensionsCouche } | null>(null);
  const paletteRef = useRef<PaletteCarte | null>(null);
  const etat = useRef<EtatBoucle>({ radar, reglages, scene, cote: 0, dpr: 1, taille, orientation, effetsReduits });
  // Valeurs du rendu courant, lues par la boucle (aucun effet à relancer quand elles changent).
  useEffect(() => {
    const e = etat.current;
    e.radar = radar; e.reglages = reglages; e.scene = scene; e.taille = taille; e.orientation = orientation; e.effetsReduits = effetsReduits || mouvementReduit;
  });

  const avecPietons = reglages.rayon <= RAYON_PIETONS_MAX;

  // Taille réelle du carré (px CSS) et densité de pixels (plafonnée à 2).
  useEffect(() => {
    const cadre = cadreRef.current, canvas = canvasRef.current;
    if (!cadre || !canvas) return;
    const mesurer = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cote = Math.round(cadre.getBoundingClientRect().width);
      if (cote < 8) return;
      etat.current.cote = cote; etat.current.dpr = dpr;
      const px = Math.round(cote * dpr);
      if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    };
    mesurer();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(mesurer);
    ro.observe(cadre);
    return () => ro.disconnect();
  }, [taille]);

  // Couche statique : construite hors écran quand le navigateur est au repos, libérée au démontage.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!scene || !canvas) return;
    paletteRef.current = paletteDepuisElement(canvas);
    let annule = false;
    const construire = () => {
      if (annule) return;
      const dim = dimensionsCouche(scene);
      const hors = document.createElement("canvas");
      hors.width = dim.largeurPx; hors.height = dim.hauteurPx;
      const ctx = hors.getContext("2d");
      if (!ctx || !paletteRef.current) return;
      dessinerCouche(scene, paletteRef.current, ctx, dim, { avecPietons });
      const ancienne = coucheRef.current;
      coucheRef.current = { canvas: hors, dim };
      if (ancienne) ancienne.canvas.width = 0;
    };
    const idle = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    let poignee = 0;
    if (idle.requestIdleCallback) poignee = idle.requestIdleCallback(construire, { timeout: 500 });
    else poignee = window.setTimeout(construire, 0);
    return () => {
      annule = true;
      if (idle.requestIdleCallback && idle.cancelIdleCallback) idle.cancelIdleCallback(poignee);
      else window.clearTimeout(poignee);
    };
  }, [scene, avecPietons]);
  useEffect(() => () => {
    const c = coucheRef.current;
    if (c) c.canvas.width = 0;
    coucheRef.current = null;
  }, []);

  // Boucle de dessin.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (masque || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cadence = new Cadence();
    const vue: VueCarte = { px: 0, pz: 0, psi: 0, taille: 1, rayonM: 100, mode: "regard" };
    const pt: PointEcran = { x: 0, y: 0 };
    const moi: PointEcran = { x: 0, y: 0 };
    let rayonLisse = 0;
    let dernier = performance.now();
    let derniereZone = -Infinity;
    let nomAffiche = "";
    let police = "";
    let raf = 0;

    const params: ParamsMarqueurs = {
      u: 1, pxParM: 1, largeur: 1, hauteur: 1, temps: 0, effetsReduits: false, etiquettes: true, police: "", moi,
      palette: paletteRef.current as PaletteCarte,
      proj: (x, z, out) => projeter(vue, x, z, out),
      angle: (cap) => capEcranObjet(vue.mode, vue.psi, cap),
      chevrons: { taille: 1, ancre: 0.58 },
    };

    const dessiner = (now: number, dt: number) => {
      const e = etat.current;
      const cote = e.cote;
      if (cote < 8) return;
      if (!paletteRef.current) paletteRef.current = paletteDepuisElement(canvas);
      const palette = paletteRef.current;
      if (!police) police = getComputedStyle(canvas).fontFamily || "monospace";
      const f = e.radar();
      const u = cote / TAILLE_CARTE_U[e.taille];
      const enVoiture = !Number.isNaN(f.capVehicule);
      const cible = enVoiture ? rayonAuto(e.reglages.rayon, f.vitesse) : e.reglages.rayon;
      rayonLisse = rayonLisse === 0 ? cible : rayonLisse + (cible - rayonLisse) * lissage(RAIDEUR_RAYON, dt);
      vue.px = f.x; vue.pz = f.z; vue.psi = enVoiture ? f.capVehicule : f.lacet;
      vue.taille = cote; vue.rayonM = rayonLisse; vue.mode = e.orientation;
      projeter(vue, f.x, f.z, moi);

      const dpr = e.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cote, cote);
      const biseau = BISEAU_U * u;
      const cadre = polygoneCadre(cote, biseau, e.reglages.coin);
      ctx.save();
      ctx.beginPath();
      cadre.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.clip();
      // Fond uni (hors zone jouable) puis couche statique translatée / tournée / mise à l'échelle.
      ctx.fillStyle = palette.sol;
      ctx.fillRect(0, 0, cote, cote);
      const couche = coucheRef.current;
      if (couche && couche.canvas.width > 0) {
        const m = matriceCouche(vue, couche.dim);
        ctx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";
        ctx.drawImage(couche.canvas, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const k = cote / 2 / rayonLisse;
      params.u = u; params.pxParM = k; params.largeur = cote; params.hauteur = cote; params.temps = now / 1000;
      params.effetsReduits = e.effetsReduits; params.palette = palette; params.police = police;
      params.chevrons = { taille: cote, ancre: vue.mode === "regard" ? 0.58 : 0.5 };
      // Noms des POI (droits) : seulement ceux qui tiennent dans le cadre.
      if (e.scene) {
        const marge = 14 * u;
        for (const poi of e.scene.pois) {
          projeter(vue, poi.x, poi.z, pt);
          if (pt.x > marge && pt.x < cote - marge && pt.y > marge && pt.y < cote - marge) dessinerNomPoi(ctx, params, nomCourtPoi(poi), pt.x, pt.y);
        }
      }
      dessinerMarqueurs(ctx, f, params);
      // « N » qui orbite sur le bord.
      const n = positionNord(vue.mode, vue.psi, cote);
      dessinerEtiquette(ctx, params, "N", n.x, n.y);
      ctx.restore();

      // Cadre essentiel (2 px, --ag-cadre) tracé à l'intérieur du carré, biseau compris.
      ctx.strokeStyle = palette.cadre;
      ctx.lineWidth = 2;
      ctx.beginPath();
      polygoneCadre(cote - 2, biseau, e.reglages.coin).forEach(([x, y], i) => (i ? ctx.lineTo(x + 1, y + 1) : ctx.moveTo(x + 1, y + 1)));
      ctx.closePath();
      ctx.stroke();

      // Nom de la zone sous la carte (texte réel, relu quelques fois par seconde).
      if (now / 1000 - derniereZone > PERIODE_ZONE_S && zoneRef.current) {
        derniereZone = now / 1000;
        const nom = e.scene ? nomZone(e.scene, f.x, f.z) ?? "" : "";
        if (nom !== nomAffiche) { nomAffiche = nom; zoneRef.current.textContent = nom; }
      }
    };

    const boucle = (now: number) => {
      raf = requestAnimationFrame(boucle);
      if (!cadence.autoriser()) return;
      const dt = Math.min(0.1, Math.max(0, (now - dernier) / 1000));
      dernier = now;
      const t0 = performance.now();
      dessiner(now, dt);
      cadence.noter(performance.now() - t0);
    };
    raf = requestAnimationFrame(boucle);
    return () => cancelAnimationFrame(raf);
  }, [masque, taille]);

  const style = { "--tm": TAILLE_CARTE_U[taille] } as CSSProperties;
  return (
    <div className={styles.mm} style={style} data-coin={reglages.coin} data-orientation={orientation}>
      <div className={styles.cadre} ref={cadreRef}>
        <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label={`Mini-carte, rayon ${reglages.rayon} m`} />
      </div>
      <p className={styles.legende}>
        <span>{reglages.rayon} m</span> · <kbd className={styles.touche}>{toucheCarte}</kbd> grande carte
        <span ref={zoneRef} className={styles.zone} />
      </p>
    </div>
  );
}
