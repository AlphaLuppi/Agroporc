"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  angleSuspendu, boucleLancee, boucleSerree, balistique, creerCorde, distance, DUREE_LANCER_S, DUREE_SERRE_S, majCorde,
  majVol, melange, noeud, plafonner, pointsAnneau, RAYON_ARRIVEE, tournoyer, tourner, touche, v3, vitesseBalistique,
  VITESSE_MAX, type Anneau, type Corde, type V3, type Vec, type Vol,
} from "@/lib/tigre-lasso";
import type { RenduLasso } from "@/lib/tigre-lasso-rendu";
import type { Scene3D, Tenue } from "@/lib/tigre3d/scene";
import styles from "./LassoTigre.module.css";

/**
 * - pose : le lasso traîne en bas de la page ;
 * - main : la boucle tournoie au-dessus de la main du cowboy (sous le bas de l'écran) ;
 * - lance : la boucle vole vers le point visé, la corde se déroule derrière elle ;
 * - serre : la boucle tombe autour du cou et se ferme (le cowboy reprend le mou d'un coup sec) ;
 * - tenu : le tigre est hissé et pend par la nuque au bout de la corde, sous le pointeur ;
 * - vol : lâché, il vole et rebondit, la corde traîne derrière lui (on peut le rattraper au vol) ;
 * - ramene : boucle ratée (elle retombe) ou tigre dégagé : le cowboy ramène la corde.
 */
type Etat = "pose" | "main" | "lance" | "serre" | "tenu" | "vol" | "ramene";

/** Particules de la corde. */
const N = 28;
/** Corde du tigre pendu (en largeurs de tigre) et durée de la hisse (s). */
const CORDE_TENU = 0.5;
const HISSE_S = 0.55;
/** Ramener la corde (s). */
const RAMENE_S = 0.6;
/** Raideur et amortissement de l'angle du tigre pendu : il suit la corde avec de l'inertie. */
const RAIDEUR_ANGLE = 70, AMORTI_ANGLE = 7;

interface Options {
  sceneRef: RefObject<Scene3D | null>;
  conteneurRef: RefObject<HTMLDivElement | null>;
  /** Zone de clic de la mère (la première) : la cible du lasso. */
  zoneMere: () => HTMLDivElement | null;
  /** Largeur d'un tigre à l'écran (px) : longueur de corde, rayon de rebond. */
  largeurTigre: () => number;
}

export interface Lasso {
  /** À passer à la scène (`RappelsScene.tenue`) : position du tigre attrapé à chaque image. */
  tenue(dt: number): Tenue | null;
  /** Le tigre est au lasso (tenu ou en vol) : ses zones ne déclenchent pas de réaction. */
  occupe(): boolean;
  /** Le passage est coupé : on lâche tout (le lasso reste en main). */
  oublier(): void;
  rendu: ReactNode;
}

interface Prise {
  /** Nœud (nuque) → centre du corps (px) : le corps pend dans le prolongement de la corde. */
  d: Vec;
  /** Hauteur du centre du corps debout (px de la fenêtre) : le sol du vol. */
  centreY: number;
  angle: number;
  omega: number;
  t0: number;
  /** Main au début de la hisse (bas de l'écran, ou là où on a rattrapé la corde). */
  mainDe: V3;
  /** Longueur de corde au début de la hisse. */
  reposDe: number;
}

/** Serrage : la boucle arrivée, le collier visé (fenêtre), et de quoi suspendre le tigre ensuite. */
interface Serrage {
  arrivee: Anneau;
  cou: V3;
  axe: V3;
  rayon: number;
  noeud: V3;
  centre: V3;
}

/**
 * Lasso du thème Tigre : physique de la corde dans lib/tigre-lasso.ts, rendu 3D dans
 * lib/tigre-lasso-rendu.ts (chargé à la prise du lasso). Pris en main, un calque plein écran capte
 * le pointeur : clic = lancer la boucle, Échap ou « Ranger » = la reposer. Attrapé, le tigre suit le
 * pointeur au bout de la corde ; relâcher le bouton (ou un second appui) le lance. Pendant la
 * capture, la simulation tourne dans la boucle de dessin de la scène du tigre (`tenue`) : corde et
 * tigre bougent à la même image.
 */
export function useLassoTigre({ sceneRef, conteneurRef, zoneMere, largeurTigre }: Options): Lasso {
  const [etat, setEtat] = useState<Etat>("pose");
  const etatRef = useRef<Etat>("pose");
  /** Tests en développement : la boucle d'images est gelée, on avance à la main. */
  const gele = useRef(false);
  const [pied, setPied] = useState<Element | null>(null);
  const [rate, setRate] = useState<{ id: number; x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renduRef = useRef<RenduLasso | null>(null);
  const viseurRef = useRef<SVGGElement>(null);
  const pointeur = useRef<Vec | null>(null);
  const corde = useRef<Corde | null>(null);
  const anneau = useRef<Anneau | null>(null);
  /** Instant d'entrée dans l'état (s, horloge de la simulation). */
  const t0 = useRef(0);
  const horloge = useRef(0);
  const lancer = useRef<{ depart: Anneau; cible: V3; v: V3 } | null>(null);
  const prise = useRef<Prise | null>(null);
  const serrage = useRef<Serrage | null>(null);
  const vol = useRef<Vol | null>(null);
  /** Ramener : la main part d'ici ; la boucle d'abord retombe (raté) avec cette vitesse. */
  const ramene = useRef<{ mainDe: V3; reposDe: number; chute: { a: Anneau; v: V3 } | null } | null>(null);
  /** Entrée dans le tournoiement : le nœud part d'ici et rejoint la boucle. */
  const entree = useRef<{ noeud: V3; anneau: Anneau | null } | null>(null);

  /** Tigre attrapé : c'est la boucle de dessin de la scène du tigre qui mène la simulation. */
  const pilotee = (e: Etat) => e === "serre" || e === "tenu" || e === "vol";
  const changer = (e: Etat) => { etatRef.current = e; t0.current = horloge.current; setEtat(e); };
  /** Main du cowboy, juste sous le bas de l'écran. */
  const mainBas = (): V3 => v3(window.innerWidth / 2, window.innerHeight + 30, 0);
  const sol = () => window.innerHeight - 3;
  const hautConteneur = () => conteneurRef.current?.getBoundingClientRect().top ?? 0;
  const lisse = (u: number) => { const k = Math.min(1, Math.max(0, u)); return k * k * (3 - 2 * k); };

  // Le lasso est posé dans le pied de page ; Next peut remplacer ce pied (hydratation, page
  // d'erreur) : on le recherche dès qu'il change.
  useEffect(() => {
    const chercher = () => setPied(document.querySelector(".pdj-page-pied"));
    chercher();
    const obs = new MutationObserver(chercher);
    obs.observe(document.body, { childList: true });
    return () => obs.disconnect();
  }, []);

  // Rendu 3D (three) chargé à la prise du lasso, libéré quand on le range.
  const actif = etat !== "pose";
  useEffect(() => {
    if (!actif) return;
    let annule = false;
    import("@/lib/tigre-lasso-rendu").then(({ creerRenduLasso }) => {
      if (annule || !canvasRef.current) return;
      try { renduRef.current = creerRenduLasso(canvasRef.current); } catch { /* sans WebGL : pas de corde */ }
    }).catch(() => {});
    return () => {
      annule = true;
      renduRef.current?.dispose();
      renduRef.current = null;
    };
  }, [actif]);

  /* ───────── Simulation, état par état ───────── */

  /** Tournoiement : la main au bas de l'écran, la boucle au-dessus, la corde entre les deux. */
  const simulerMain = (c: Corde, dt: number) => {
    const t = horloge.current - t0.current;
    let a = tournoyer(mainBas(), horloge.current);
    // En entrant (corde ramenée), le nœud et la boucle rejoignent le tournoiement en douceur.
    const e = entree.current;
    const k = lisse(t / 0.3);
    if (e?.anneau && k < 1) a = { ...a, c: melange(e.anneau.c, a.c, k), r: e.anneau.r + (a.r - e.anneau.r) * k };
    anneau.current = a;
    const n = noeud(a);
    c.repos += (distance(mainBas(), n) * 1.08 / (N - 1) - c.repos) * Math.min(1, 6 * dt);
    majCorde(c, dt, { epingles: [[0, mainBas()], [N - 1, e && k < 1 ? melange(e.noeud, n, k) : n]], sol: sol() });
  };

  /** Lancer : la boucle suit sa parabole, la corde se déroule (jamais plus courte que la distance). */
  const simulerLance = (c: Corde, dt: number) => {
    const l = lancer.current;
    if (!l) return;
    const t = horloge.current - t0.current;
    const a = boucleLancee(l.depart, l.cible, l.v, t);
    anneau.current = a;
    const n = noeud(a);
    c.repos = Math.max(c.repos, (distance(mainBas(), n) * 1.12) / (N - 1));
    majCorde(c, dt, { epingles: [[0, mainBas()], [N - 1, n]], sol: sol() });
    if (t >= DUREE_LANCER_S) arrivee(a, l);
  };

  /** La boucle se pose sur la cible : tigre dessous → nœud serré au cou, sinon elle retombe. */
  const arrivee = (a: Anneau, l: NonNullable<typeof lancer.current>) => {
    const zone = zoneMere()?.getBoundingClientRect();
    const p = sceneRef.current && zone && zone.width > 0
      && touche(a.c, { x: zone.left, y: zone.top, w: zone.width, h: zone.height })
      ? sceneRef.current.attraper() : null;
    lancer.current = null;
    if (!p) {
      setRate({ id: Date.now(), x: a.c.x, y: a.c.y });
      // Elle garde sa vitesse d'arrivée et retombe avant qu'on la ramène.
      const v = v3(l.v.x, l.v.y + 2600 * DUREE_LANCER_S, l.v.z);
      ramene.current = { mainDe: mainBas(), reposDe: corde.current?.repos ?? 10, chute: { a, v } };
      changer("ramene");
      return;
    }
    const haut = hautConteneur();
    serrage.current = {
      arrivee: a,
      cou: v3(p.cou.x, p.cou.y + haut, 0),
      axe: v3(p.axe.x, p.axe.y, 0.35),
      rayon: p.rayon,
      noeud: v3(p.noeud.x, p.noeud.y + haut, 0),
      centre: v3(p.centre.x, p.centre.y + haut, 0),
    };
    pointeur.current ??= { x: a.c.x, y: a.c.y };
    changer("serre");
  };

  /**
   * Serrage : la boucle tombe autour du cou et se ferme, la main reprend le mou (elle recule d'un
   * coup sec) ; le tigre ne bouge pas encore. Fermée, la boucle devient le collier de la scène du
   * tigre (dans son relief : elle passe derrière le cou) et le tigre pend à la corde.
   */
  const simulerSerre = (c: Corde, dt: number): Tenue | null => {
    const s = serrage.current;
    if (!s) return null;
    const u = (horloge.current - t0.current) / DUREE_SERRE_S;
    const a = boucleSerree(s.arrivee, s.cou, s.axe, s.rayon, u);
    anneau.current = a;
    const coup = Math.max(0, u - 0.6) / 0.4;
    const main = v3(mainBas().x, mainBas().y + 60 * Math.min(1, coup), 0);
    c.repos = Math.max(distance(main, noeud(a)) * 1.02 / (N - 1), c.repos * (1 - 1.5 * dt));
    majCorde(c, dt, { epingles: [[0, main], [N - 1, noeud(a)]], sol: sol() });
    const haut = hautConteneur();
    if (u >= 1) {
      sceneRef.current?.serrer(true);
      c.p[N - 1] = { ...s.noeud };
      c.prec[N - 1] = { ...s.noeud };
      c.inv[N - 1] = 0.03;
      anneau.current = null;
      prise.current = {
        d: { x: s.centre.x - s.noeud.x, y: s.centre.y - s.noeud.y },
        centreY: s.centre.y, angle: 0, omega: 0, t0: horloge.current, mainDe: main, reposDe: c.repos,
      };
      serrage.current = null;
      changer("tenu");
    }
    return { x: s.centre.x, y: s.centre.y - haut, angle: 0 };
  };

  /** Le tigre pendu : la main rejoint le pointeur, la corde se raccourcit et le hisse par la nuque. */
  const simulerTenu = (c: Corde, dt: number): Tenue | null => {
    const p = prise.current;
    if (!p) return null;
    const k = lisse((horloge.current - p.t0) / HISSE_S);
    const cible = pointeur.current ?? { x: c.p[N - 1].x, y: c.p[N - 1].y };
    const main = melange(p.mainDe, v3(cible.x, cible.y, 0), k);
    const repos = (CORDE_TENU * largeurTigre()) / (N - 1);
    c.repos = p.reposDe + (repos - p.reposDe) * k;
    majCorde(c, dt, { epingles: [[0, main]], sol: sol(), tendue: k >= 1 ? c.repos * (N - 1) : undefined, freinFin: 1.6 });
    // Le corps pend dans l'axe de la traction (main → nuque), pas dans celui des derniers brins.
    const nuque = c.p[N - 1];
    let ecart = angleSuspendu(main, nuque, p.d) - p.angle;
    ecart = Math.atan2(Math.sin(ecart), Math.cos(ecart));
    p.omega += (RAIDEUR_ANGLE * ecart - AMORTI_ANGLE * p.omega) * dt;
    p.angle += p.omega * dt;
    return transformation(nuque, p.angle, p.d);
  };

  const transformation = (cou: Vec, angle: number, d: Vec): Tenue => {
    const o = tourner(d, angle);
    return { x: cou.x + o.x, y: cou.y + o.y - hautConteneur(), angle };
  };

  /** Lâché : il vole et rebondit, la corde (tenue à son cou) traîne derrière lui. */
  const simulerVol = (c: Corde, dt: number): Tenue | null => {
    const p = prise.current, v = vol.current;
    if (!p || !v) return null;
    const { vol: suite, pose } = majVol(v, { gauche: 0, droite: window.innerWidth, haut: 0, sol: p.centreY }, 0.28 * largeurTigre(), dt);
    vol.current = suite;
    const o = tourner(p.d, suite.angle);
    majCorde(c, dt, { epingles: [[N - 1, v3(suite.c.x - o.x, suite.c.y - o.y, 0)]], sol: sol() });
    if (pose) {
      // Retombé à l'endroit : il se dégage du nœud, se relève et file ; on ramène la corde.
      sceneRef.current?.relacher(suite.c.x);
      c.inv[N - 1] = 1;
      prise.current = null;
      vol.current = null;
      ramene.current = { mainDe: { ...c.p[0] }, reposDe: c.repos, chute: null };
      changer("ramene");
      return null;
    }
    return { x: suite.c.x, y: suite.c.y - hautConteneur(), angle: suite.angle };
  };

  /** Ramener la corde : (boucle ratée qui retombe d'abord) la main rejoint le bas de l'écran en tirant. */
  const simulerRamene = (c: Corde, dt: number) => {
    const r = ramene.current;
    if (!r) return;
    const t = horloge.current - t0.current;
    if (r.chute) {
      const a = { ...r.chute.a, c: balistique(r.chute.a.c, r.chute.v, t), n: melange(r.chute.a.n, v3(0, 1, 0.3), lisse(t / 0.4)) };
      anneau.current = a;
      majCorde(c, dt, { epingles: [[0, mainBas()], [N - 1, noeud(a)]], sol: sol() });
      if (a.c.y >= sol() - 6 || t > 0.6) {
        ramene.current = { mainDe: mainBas(), reposDe: c.repos, chute: null };
        t0.current = horloge.current;
      }
      return;
    }
    const k = lisse(t / RAMENE_S);
    c.repos = r.reposDe + (8 - r.reposDe) * k;
    majCorde(c, dt, { epingles: [[0, melange(r.mainDe, mainBas(), k)]], sol: sol() });
    // La boucle, desserrée, suit le bout de la corde.
    const bout = c.p[N - 1], amont = c.p[N - 3];
    const tour = Math.atan2(amont.y - bout.y, amont.x - bout.x);
    const rayon = RAYON_ARRIVEE * 0.8;
    anneau.current = { c: v3(bout.x - Math.cos(tour) * rayon, bout.y - Math.sin(tour) * rayon, 0), n: v3(0, 0.6, 1), r: rayon, tour };
    if (k >= 1) {
      entree.current = { noeud: { ...bout }, anneau: anneau.current };
      changer("main");
    }
  };

  /** Une image : simulation de l'état courant, puis dessin de la corde et de la boucle. */
  const simuler = (dt: number): Tenue | null => {
    horloge.current += dt;
    let c = corde.current;
    if (!c) c = corde.current = creerCorde(N, mainBas(), noeud(tournoyer(mainBas(), horloge.current)));
    let tenue: Tenue | null = null;
    switch (etatRef.current) {
      case "main": simulerMain(c, dt); break;
      case "lance": simulerLance(c, dt); break;
      case "serre": tenue = simulerSerre(c, dt); break;
      case "tenu": tenue = simulerTenu(c, dt); break;
      case "vol": tenue = simulerVol(c, dt); break;
      case "ramene": simulerRamene(c, dt); break;
      default: return null;
    }
    const a = anneau.current;
    renduRef.current?.dessiner(c.p, a ? pointsAnneau(a) : null);
    return tenue;
  };

  // Hors capture, la simulation a sa propre boucle d'images ; tigre attrapé, c'est la scène qui la mène.
  useEffect(() => {
    if (etat === "pose" || pilotee(etat)) return;
    let raf = 0, avant = performance.now();
    const image = (now: number) => {
      raf = requestAnimationFrame(image);
      const dt = Math.min(0.05, (now - avant) / 1000);
      avant = now;
      const viseur = viseurRef.current, p = pointeur.current;
      if (viseur) {
        viseur.style.visibility = etatRef.current === "main" && p ? "visible" : "hidden";
        if (p) viseur.setAttribute("transform", `translate(${p.x} ${p.y}) rotate(${(now / 4) % 360})`);
      }
      if (!pilotee(etatRef.current) && !gele.current) simuler(dt);
    };
    raf = requestAnimationFrame(image);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etat]);

  const simulerRef = useRef(simuler);
  simulerRef.current = simuler;

  const tenue = (dt: number): Tenue | null => {
    if (!pilotee(etatRef.current)) return null;
    return simuler(dt);
  };

  /** Lâché : il part avec la vitesse du bout de corde (son cou) et la rotation qu'il avait. */
  const lacher = () => {
    const p = prise.current, c = corde.current;
    if (!p || !c) return;
    const nuque = c.p[N - 1], q = c.prec[N - 1];
    const v = plafonner({ x: (nuque.x - q.x) * 120, y: (nuque.y - q.y) * 120 }, VITESSE_MAX);
    const o = tourner(p.d, p.angle);
    vol.current = { c: { x: nuque.x + o.x, y: nuque.y + o.y }, v, angle: p.angle, omega: p.omega, auSol: 0 };
    changer("vol");
  };

  /** Rattrapé au vol : on reprend le bout de la corde, la main le ramène sous le pointeur. */
  const rattraper = (pt: Vec) => {
    const p = prise.current, c = corde.current, v = vol.current;
    if (!p || !c || !v) return;
    p.t0 = horloge.current;
    p.mainDe = { ...c.p[0] };
    p.reposDe = c.repos;
    p.angle = v.angle;
    p.omega = v.omega;
    vol.current = null;
    pointeur.current = pt;
    changer("tenu");
  };

  const oublier = () => {
    prise.current = null;
    serrage.current = null;
    vol.current = null;
    lancer.current = null;
    if (corde.current) corde.current.inv[N - 1] = 1;
    if (etatRef.current !== "pose" && etatRef.current !== "main") {
      ramene.current = { mainDe: corde.current ? { ...corde.current.p[0] } : mainBas(), reposDe: corde.current?.repos ?? 10, chute: null };
      changer("ramene");
    }
  };

  const ranger = () => {
    lancer.current = null;
    pointeur.current = null;
    corde.current = null;
    anneau.current = null;
    entree.current = null;
    changer("pose");
  };

  // Échap range le lasso (sauf tigre au bout de la corde).
  useEffect(() => {
    if (etat === "pose") return;
    const clavier = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pilotee(etatRef.current)) ranger();
    };
    window.addEventListener("keydown", clavier);
    return () => window.removeEventListener("keydown", clavier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etat]);

  // Crochet de test en développement : état du lasso.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__lasso = {
      etat: () => etatRef.current,
      geler: (v) => { gele.current = v; sceneRef.current?.geler(v); },
      // Une image à la main : la scène du tigre si elle mène (tigre attrapé), sinon le lasso seul.
      avancer: (dt) => { if (pilotee(etatRef.current)) sceneRef.current?.avancer(dt); else simulerRef.current(dt); },
    };
    return () => { delete window.__lasso; };
  }, []);

  const position = (e: ReactPointerEvent): Vec => ({ x: e.clientX, y: e.clientY });

  const surAppui = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = position(e);
    pointeur.current = p;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (etatRef.current === "main" && anneau.current) {
      const cible = v3(p.x, p.y, 0);
      lancer.current = { depart: anneau.current, cible, v: vitesseBalistique(anneau.current.c, cible, DUREE_LANCER_S) };
      changer("lance");
    } else if (etatRef.current === "vol") {
      const zone = zoneMere()?.getBoundingClientRect();
      if (zone && touche(p, { x: zone.left, y: zone.top, w: zone.width, h: zone.height }, 12)) rattraper(p);
    }
  };
  const surDeplacement = (e: ReactPointerEvent) => { pointeur.current = position(e); };
  const surRelache = (e: ReactPointerEvent) => {
    pointeur.current = position(e);
    // Le relâchement du clic qui a lancé la boucle ne compte pas : il faut l'avoir tenu un instant.
    const p = prise.current;
    if (etatRef.current === "tenu" && p && horloge.current - p.t0 > 0.25) lacher();
  };

  const prendre = () => {
    pointeur.current = null;
    entree.current = null;
    changer("main");
  };

  const rendu = (
    <>
      {etat === "pose" && pied && createPortal(
        <button type="button" className={styles.pose} onClick={prendre} aria-label="Un lasso traîne là… le prendre" title="Un lasso traîne là…">
          <svg viewBox="-34 -20 68 40" aria-hidden="true">
            <ellipse rx={26} ry={9} className={styles.corde} />
            <ellipse rx={21} ry={7} cy={3} className={styles.corde} />
            <ellipse rx={16} ry={5} cy={6} className={styles.corde} />
            <path d="M14,8 q10,6 16,2" className={styles.corde} />
          </svg>
        </button>,
        pied,
      )}
      {etat !== "pose" && (
        <div
          className={`${styles.calque} ${etat === "main" || etat === "lance" ? styles.vise : ""} ${etat === "tenu" ? styles.tient : ""}`}
          onPointerDown={surAppui}
          onPointerMove={surDeplacement}
          onPointerUp={surRelache}
          onPointerCancel={surRelache}
          onContextMenu={(e) => e.preventDefault()}
        >
          <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
          <svg className={styles.svg} aria-hidden="true">
            <g ref={viseurRef} style={{ visibility: "hidden" }}>
              <ellipse rx={22} ry={22} className={styles.viseur} />
            </g>
          </svg>
          {rate && (
            <span key={rate.id} className={styles.rate} style={{ left: rate.x, top: rate.y }} onAnimationEnd={() => setRate(null)}>
              Raté !
            </span>
          )}
          {(etat === "main" || etat === "lance" || etat === "ramene") && (
            <div className={styles.main} onPointerDown={(e) => e.stopPropagation()}>
              <span className={styles.aide}>Vise le tigre et clique pour lancer</span>
              <button type="button" className={styles.ranger} onClick={ranger}>Ranger le lasso</button>
            </div>
          )}
        </div>
      )}
    </>
  );

  return { tenue, occupe: () => pilotee(etatRef.current), oublier, rendu };
}

declare global {
  interface Window {
    /** Crochet de test, présent en développement seulement. */
    __lasso?: { etat(): string; geler(v: boolean): void; avancer(dt: number): void };
  }
}
