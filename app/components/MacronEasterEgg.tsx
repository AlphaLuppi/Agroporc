"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ecouterCode } from "@/lib/code-secret";
import { webglDisponible } from "@/lib/tigre3d/webgl";
import type { InfosImage, SceneMacron } from "@/lib/macron3d/scene";
import { BULLE, hauteurCoureurPx } from "@/lib/macron3d/passage";
import { enregistrerCible, type LienLasso } from "@/lib/lasso-cibles";
import { creerDeclencheur, jouerPassage } from "@/lib/macron3d/declencheur";
import { canalRencontre } from "@/lib/rencontre";
import styles from "./MacronEasterEgg.module.css";

export const CODE_MACRON = "macron";

/** Options d'un passage (crochet de développement : captures reproductibles). */
interface OptionsPassage { sens?: 1 | -1; graine?: number; geler?: boolean }

/** Délai entre la sortie de l'écran et le démontage (ms) : la bulle finit son fondu CSS. */
const FONDU_FIN_MS = 220;
/** Constante de temps du lissage vertical de la bulle (s) : elle ne suit pas chaque rebond. */
const LISSAGE_BULLE_S = 0.15;

/**
 * Le visiteur accepte les animations, le navigateur sait faire du WebGL, et aucune fenêtre
 * modale n'est ouverte (vue 3D « myrtille », panneau d'un plat) : elle cacherait le passage.
 */
function passagePossible() {
  if (document.querySelector('[aria-modal="true"]')) return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches && webglDisponible();
}

/**
 * Code secret « macron » : tapé n'importe où sur le site (hors champ de saisie, tous thèmes), un
 * personnage 3D traverse le bas de l'écran en courant, d'un bord à l'autre (sens au hasard),
 * puis disparaît. Dans le thème Tigre, le lasso peut l'attraper (lib/lasso-cibles.ts) : il pend au
 * bout de la corde en courant dans le vide, puis repart. Retaper pendant le passage ne le relance pas. Rien avec
 * prefers-reduced-motion, rien (sans bruit) sans WebGL ou si le modèle ne se charge pas.
 * three.js et le GLB (≈ 0,7 Mo) ne sont téléchargés qu'au premier déclenchement.
 */
export function MacronEasterEgg() {
  const [passage, setPassage] = useState<{ id: number; options: OptionsPassage } | null>(null);
  const compteurRef = useRef(0);
  const sceneRef = useRef<SceneMacron | null>(null);
  const optionsRef = useRef<OptionsPassage>({});
  // Un seul passage à la fois (lib/macron3d/declencheur.ts, testé).
  const [declencheur] = useState(() => creerDeclencheur(passagePossible, () => {
    setPassage({ id: ++compteurRef.current, options: optionsRef.current });
  }));
  const declencher = (options: OptionsPassage = {}, force = false) => {
    optionsRef.current = options;
    declencheur.declencher(force);
  };
  const declencherRef = useRef(declencher);
  declencherRef.current = declencher;

  useEffect(() => ecouterCode(CODE_MACRON, () => declencherRef.current()), []);

  // Crochet de test en développement seulement : lancer un passage, figer et avancer le temps.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__macron = {
      lancer: (o = {}) => declencherRef.current(o, true),
      geler: (v) => sceneRef.current?.geler(v),
      avancer: (dt) => sceneRef.current?.avancer(dt),
      pret: () => !!sceneRef.current?.pret() && !!sceneRef.current?.etat(),
      enCours: () => declencheur.enCours(),
      etat: () => sceneRef.current?.etat() ?? null,
      ko: () => sceneRef.current?.phaseKO() ?? null,
      // Rencontre forcée (thème Tigre) : le tigre et Macron face à face, cf. window.__tigre.rencontre.
      rencontre: (o) => window.__tigre?.rencontre(o) ?? false,
    };
    return () => { delete window.__macron; };
  }, []);

  if (!passage) return null;
  return (
    <Coureur
      key={passage.id}
      id={passage.id}
      options={passage.options}
      sceneRef={sceneRef}
      fin={() => { declencheur.liberer(); setPassage(null); }}
    />
  );
}

/** Un passage : crée la scène (three à la demande), court, puis se démonte (tout est libéré). */
function Coureur({ id, options, sceneRef, fin }: {
  id: number;
  options: OptionsPassage;
  sceneRef: React.MutableRefObject<SceneMacron | null>;
  fin: () => void;
}) {
  const conteneurRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bulleRef = useRef<HTMLSpanElement>(null);
  const etoilesRef = useRef<HTMLSpanElement>(null);
  const imageRef = useRef<InfosImage | null>(null);
  const finRef = useRef(fin);
  finRef.current = fin;
  const [bulle, setBulle] = useState(false);
  const [texteBulle, setTexteBulle] = useState<string>(BULLE.texte);
  const [etoiles, setEtoiles] = useState(false);
  /** Le lasso qui le tient (null : libre) ; il mène la scène à chaque image. */
  const lienRef = useRef<LienLasso | null>(null);
  const hautConteneur = () => conteneurRef.current?.getBoundingClientRect().top ?? 0;
  const [visible, setVisible] = useState(false);
  const lissage = useRef<{ y: number; t: number } | null>(null);

  const placerBulle = () => {
    const el = bulleRef.current, img = imageRef.current;
    if (!el || !img) return;
    // Recadrée dans l'écran (le coureur entre et sort par les bords) ; la pointe vise toujours la tête.
    const x = img.gauche + img.tete.x;
    const demi = el.offsetWidth / 2, marge = 8;
    const centre = Math.min(Math.max(x, marge + demi), Math.max(marge + demi, window.innerWidth - marge - demi));
    // Hauteur lissée : la bulle flotte au-dessus de la tête au lieu de rebondir à chaque pas.
    const now = performance.now() / 1000, l = lissage.current;
    const y = l ? l.y + (img.tete.y - l.y) * (1 - Math.exp(-Math.max(0, now - l.t) / LISSAGE_BULLE_S)) : img.tete.y;
    lissage.current = { y, t: now };
    el.style.setProperty("--queue", `${Math.max(-demi + 14, Math.min(demi - 14, x - centre))}px`);
    el.style.transform = `translate3d(${centre}px, ${y}px, 0) translate(-50%, -100%)`;
  };
  useLayoutEffect(placerBulle, [visible]);

  /** Étoiles qui tournent au-dessus de la tête de Macron sonné (coup de batte du tigre). */
  const placerEtoiles = () => {
    const el = etoilesRef.current, img = imageRef.current;
    if (!el || !img?.etoiles) return;
    el.style.transform = `translate3d(${img.gauche + img.etoiles.x}px, ${img.etoiles.y}px, 0)`;
  };
  useLayoutEffect(placerEtoiles, [etoiles]);

  useEffect(() => {
    const canvas = canvasRef.current, conteneur = conteneurRef.current;
    if (!canvas || !conteneur) return;
    let scene: SceneMacron | null = null;
    let minuteur = 0, termine = false;
    let retirerCible = () => {};
    const redimensionner = () => {
      const t = scene?.redimensionner({ largeur: window.innerWidth, hauteur: window.innerHeight });
      if (t) conteneur.style.height = `${t.hauteur}px`;
    };
    // Échec (GLB introuvable, contexte perdu) : fin immédiate et silencieuse (lib/macron3d/declencheur.ts).
    const annuler = jouerPassage({
      importer: () => import("@/lib/macron3d/scene"),
      creer: ({ creerScene }, perte) => {
        scene = creerScene(canvas, { surPerte: perte });
        sceneRef.current = scene;
        return scene;
      },
      lancer: (s) => {
        if (options.geler) s.geler(true);
        const sens = options.sens ?? (Math.random() < 0.5 ? 1 : -1);
        const taille = s.lancer(
          { ecran: { largeur: window.innerWidth, hauteur: window.innerHeight }, sens, graine: options.graine },
          {
            image: (img) => {
              imageRef.current = img;
              setBulle(img.bulle);
              setTexteBulle(img.texteBulle);
              setEtoiles(!!img.etoiles);
              placerBulle();
              placerEtoiles();
              // Rencontre avec le tigre (thème Tigre) : position, sens, vitesse, déjà frappé ou non.
              canalRencontre.publier({
                type: "etat", qui: "macron",
                etat: {
                  present: img.centre > 0 && img.centre < window.innerWidth, x: img.centre, sens: img.sens,
                  vitesse: img.vitesse, disponible: !img.frappe, passage: id, rayon: img.rayon,
                },
              });
            },
            tenue: (dt) => {
              const t = lienRef.current?.image(dt);
              return t ? { ...t, y: t.y - hautConteneur() } : null;
            },
            // Sorti de l'écran : démontage après un court délai.
            fin: () => {
              if (termine) return;
              termine = true;
              minuteur = window.setTimeout(() => finRef.current(), FONDU_FIN_MS);
            },
          },
        );
        conteneur.style.height = `${taille.hauteur}px`;
        window.addEventListener("resize", redimensionner);
        setVisible(true);
        // Cible du lasso (thème Tigre) tant qu'il court : repères du conteneur → px de la fenêtre.
        retirerCible = enregistrerCible({
          taille: () => hauteurCoureurPx({ largeur: window.innerWidth, hauteur: window.innerHeight }),
          zone: () => {
            const img = imageRef.current;
            if (!img) return null;
            return { x: img.gauche + img.boite.x, y: img.boite.y + hautConteneur(), w: img.boite.w, h: img.boite.h };
          },
          attraper: (lien) => {
            const p = s.attraper();
            if (!p) return null;
            lienRef.current = lien;
            const f = (q: { x: number; y: number }) => ({ x: q.x, y: q.y + hautConteneur() });
            return { ...p, centre: f(p.centre), cou: f(p.cou), noeud: f(p.noeud) };
          },
          serrer: () => s.serrer(),
          relacher: (x) => { lienRef.current = null; s.relacher(x); },
          geler: (v) => s.geler(v),
          avancer: (dt) => s.avancer(dt),
        });
      },
      fin: () => finRef.current(),
    });
    // Le tigre frappe (impact) ou la rencontre est annulée (thème changé, tigre démonté).
    const desabonner = canalRencontre.sur((m) => {
      if (m.type === "impact") scene?.frapper();
      else if (m.type === "annulation") scene?.annulerKO();
    });
    // Onglet caché pendant la rencontre : s'il est au sol, il se relève.
    const cache = () => { if (document.hidden) scene?.annulerKO(); };
    document.addEventListener("visibilitychange", cache);
    return () => {
      retirerCible();
      // Démonté au bout de la corde : le lasso lâche tout.
      const lien = lienRef.current;
      lienRef.current = null;
      lien?.perdu();
      window.clearTimeout(minuteur);
      window.removeEventListener("resize", redimensionner);
      document.removeEventListener("visibilitychange", cache);
      desabonner();
      canalRencontre.publier({ type: "etat", qui: "macron", etat: null });
      annuler();
      if (sceneRef.current === scene) sceneRef.current = null;
    };
    // Un passage par montage (clé = numéro du passage) : options lues une fois.
  }, []);

  return (
    <div ref={conteneurRef} className={styles.conteneur}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      {visible && (
        <span ref={bulleRef} className={`${styles.bulle} ${bulle ? styles.bulleVue : ""}`} aria-hidden="true">
          {texteBulle}
        </span>
      )}
      {etoiles && (
        <span ref={etoilesRef} className={styles.etoiles} aria-hidden="true">
          {["★", "✦", "★", "✦", "★"].map((g, i) => (
            <span key={i} className={styles.etoile} style={{ "--i": i } as React.CSSProperties}><span>{g}</span></span>
          ))}
        </span>
      )}
    </div>
  );
}

declare global {
  interface Window {
    /** Crochet de test, présent en développement seulement. */
    __macron?: {
      lancer(o?: OptionsPassage): void;
      geler(v: boolean): void;
      avancer(dt: number): void;
      pret(): boolean;
      enCours(): boolean;
      etat(): unknown;
      /** Phase du coup de batte (« chute », « sol », « releve », « reprise »), null s'il court. */
      ko(): string | null;
      rencontre(o?: { sens?: 1 | -1; force?: boolean; x?: number; geler?: boolean }): boolean;
    };
  }
}
