"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { PART_RETOUR, VITESSES, petitsPourEvenement, type Evenement } from "@/lib/tigre-courant";
import { creerParticules, DUREES, type GenreParticule, type Particule } from "@/lib/tigre-reactions";
import type { EvenementTigre } from "@/lib/tigre3d/animateur";
import type { InfosImage, ParamsPassage, Scene3D } from "@/lib/tigre3d/scene";
import type { Embuscade } from "@/lib/tigre3d/embuscade";
import { canalRencontre } from "@/lib/rencontre";
import { useCalendrierTigre } from "./useCalendrierTigre";
import { useLassoTigre } from "./LassoTigre";
import { enregistrerCible, type LienLasso } from "@/lib/lasso-cibles";
import styles from "./Tigre3D.module.css";

interface Bulle { id: number; texte: string }
/** Particule posée dans la page : `x`, `y` = point de départ (px, repère du conteneur, fixe une fois jetée). */
type ParticulePosee = Particule & { x: number; y: number; genre: GenreParticule };

/** Largeur d'un tigre adulte à l'écran (px), du museau au bout de la queue : suit la largeur de la fenêtre. */
function largeurTigrePx() {
  return Math.round(Math.min(220, Math.max(140, window.innerWidth * 0.15)));
}

/**
 * Thème Tigre en 3D : un tigre (modèle GLB animé par lib/tigre3d/) traverse le bas de l'écran 4 à 6
 * fois par minute, à intervalles, vitesses et sens aléatoires ; rarement un tigre lancé à pleine
 * vitesse, ou une mère suivie de ses petits. Un clic (ou un appui, dès l'appui : la cible bouge)
 * sur le tigre ou sur un petit déclenche un geste qui illustre sa bulle : il se tourne vers nous,
 * lève la patte pour un « tope là », rugit, se lèche la patte… (cf. lib/tigre-reactions.ts).
 *
 * three.js est chargé à la demande (import dynamique) et un seul contexte WebGL sert tous les
 * passages ; la boucle de dessin ne tourne que pendant un passage. Le conteneur reste décoratif
 * (aria-hidden) et laisse passer les clics : seules des zones invisibles, recalées à chaque image
 * sur chaque tigre, les captent. `surEchec` bascule sur le sprite si WebGL tombe.
 */
export function Tigre3D({ surEchec }: { surEchec: () => void }) {
  const conteneurRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const zonesRef = useRef<Array<HTMLDivElement | null>>([]);
  const bulleRef = useRef<HTMLSpanElement>(null);
  const imageRef = useRef<InfosImage | null>(null);
  const passageEnCoursRef = useRef(false);
  /** Instant (horloge de la scène) où la bulle affichée disparaît. */
  const bulleFinRef = useRef<number | null>(null);
  const compteurRef = useRef(0);
  const minuteursRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const echecRef = useRef(surEchec);
  echecRef.current = surEchec;
  // Rencontre avec Macron (lib/rencontre.ts) : une embuscade par passage, créée par le module
  // chargé à la demande avec la scène (three n'est pas dans le paquet de la page).
  const creerEmbuscadeRef = useRef<typeof import("@/lib/tigre3d/embuscade").creerEmbuscade | null>(null);
  const embuscadeRef = useRef<Embuscade | null>(null);
  const numeroPassageRef = useRef(0);
  /** Rencontre forcée (crochet de développement) : appliquée au prochain passage. */
  const forceRef = useRef<{ x: number; face: 1 | -1; surArme?: () => void } | null>(null);
  const [nZones, setNZones] = useState(0);
  const [bulle, setBulle] = useState<Bulle | null>(null);
  const [particules, setParticules] = useState<ParticulePosee[]>([]);
  const lasso = useLassoTigre();
  /** Le lasso qui tient le tigre (null : libre) ; il mène la scène à chaque image. */
  const lienRef = useRef<LienLasso | null>(null);
  /** Le tigre est au lasso : passage coupé = le lasso lâche tout. */
  const lacherLasso = () => { const l = lienRef.current; lienRef.current = null; l?.perdu(); };

  // Le tigre est une cible du lasso (lib/lasso-cibles.ts) : repères de la scène (px du conteneur)
  // ramenés en px de la fenêtre.
  useEffect(() => enregistrerCible({
    taille: largeurTigrePx,
    zone: () => {
      const el = zonesRef.current[0];
      if (!passageEnCoursRef.current || !el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },
    attraper: (lien) => {
      const p = sceneRef.current?.attraper();
      if (!p) return null;
      lienRef.current = lien;
      const haut = conteneurRef.current?.getBoundingClientRect().top ?? 0;
      const f = (q: { x: number; y: number }) => ({ x: q.x, y: q.y + haut });
      return { ...p, centre: f(p.centre), cou: f(p.cou), noeud: f(p.noeud) };
    },
    serrer: () => sceneRef.current?.serrer(true),
    relacher: (x) => { lienRef.current = null; sceneRef.current?.relacher(x); },
    geler: (v) => sceneRef.current?.geler(v),
    avancer: (dt) => sceneRef.current?.avancer(dt),
  }), []);

  const apres = (ms: number, fn: () => void) => {
    const t = setTimeout(() => { minuteursRef.current.delete(t); fn(); }, ms);
    minuteursRef.current.add(t);
    return t;
  };
  const toutNettoyer = () => {
    for (const t of minuteursRef.current) clearTimeout(t);
    minuteursRef.current.clear();
    passageEnCoursRef.current = false;
    imageRef.current = null;
    bulleFinRef.current = null;
    embuscadeRef.current?.annuler();
    embuscadeRef.current = null;
    canalRencontre.publier({ type: "etat", qui: "tigre", etat: null });
    setBulle(null);
    setParticules([]);
    setNZones(0);
  };

  // Chargement de three et de la scène : dès l'arrivée sur le thème, hors du chemin critique.
  useEffect(() => {
    let annule = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Un petit délai : la page finit de s'afficher avant de créer le contexte WebGL.
    const t = setTimeout(() => {
      Promise.all([import("@/lib/tigre3d/scene"), import("@/lib/tigre3d/embuscade")]).then(([{ creerScene }, { creerEmbuscade }]) => {
        if (annule) return;
        creerEmbuscadeRef.current = creerEmbuscade;
        try {
          sceneRef.current = creerScene(canvas, { surPerte: () => echecRef.current() });
        } catch {
          echecRef.current();
        }
      }).catch(() => { if (!annule) echecRef.current(); });
    }, 400);
    return () => {
      annule = true;
      clearTimeout(t);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  /** Un événement de l'animateur : bulle, particules ; la fin du passage nettoie tout. */
  const surEvenement = (e: EvenementTigre) => {
    if (e.type === "bulle") {
      // Bulle déjà affichée (dite pendant l'approche) : on ne la rouvre pas, on la prolonge.
      if (e.prolonge && bulleFinRef.current !== null) {
        bulleFinRef.current = (imageRef.current?.temps ?? 0) + e.duree;
        return;
      }
      const id = ++compteurRef.current;
      setBulle({ id, texte: e.texte });
      // Durée comptée sur l'horloge de la scène (surImage) : une pause ne fait pas expirer la bulle.
      bulleFinRef.current = (imageRef.current?.temps ?? 0) + e.duree;
    } else if (e.type === "particules") {
      apres(e.delai * 1000, () => jeter(e.genre, e.nombre));
    } else if (e.type === "impact") {
      // Coup de batte : Macron tombe (app/components/MacronEasterEgg.tsx écoute le canal).
      canalRencontre.publier({ type: "impact" });
    }
  };

  const jeter = (genre: GenreParticule, nombre: number) => {
    const img = imageRef.current;
    if (!img) return;
    // Éclats du clap : sur la patte levée, ou sur la batte au coup sur Macron.
    const ancre = genre === "clap" ? img.batte ?? img.patte : img.tete;
    // Cœurs et Z naissent à la tête, où se trouve la bulle : ils partent de côté (alternativement
    // à droite et à gauche) pour sortir de la bulle au lieu de monter dedans.
    const lateral = genre !== "clap";
    const lot = creerParticules(genre, nombre, compteurRef.current, Math.random).map((p, i) => {
      const cote = (compteurRef.current + i) % 2 ? 1 : -1;
      return {
        ...p, genre,
        dx: lateral ? cote * (Math.abs(p.dx) + 45) : p.dx,
        x: img.gauche + ancre.x + (lateral ? cote * 30 : 0),
        y: ancre.y - (genre === "zzz" ? 8 : 0),
      };
    });
    compteurRef.current += nombre;
    setParticules((prev) => [...prev, ...lot]);
    apres(DUREES.particules, () => setParticules((prev) => prev.filter((p) => !lot.includes(p))));
  };

  /** Recale zones de clic et bulle sur le tigre à chaque image (pas de rendu React). */
  const surImage = (img: InfosImage) => {
    imageRef.current = img;
    if (bulleFinRef.current !== null && img.temps >= bulleFinRef.current) {
      bulleFinRef.current = null;
      setBulle(null);
    }
    img.zones.forEach((z, i) => {
      const el = zonesRef.current[i];
      if (!el) return;
      el.style.width = `${z.w}px`;
      el.style.height = `${z.h}px`;
      el.style.transform = `translate3d(${img.gauche + z.x}px, ${z.y}px, 0)`;
    });
    placerBulle();
    // Batte en main : le tigre passe devant Macron (z-index 41), sinon la batte disparaîtrait
    // derrière lui au moment du coup. Il y reste tant que Macron frappé est à l'écran : quand il le
    // croise ensuite (au sol ou titubant), il passe devant son corps, jamais dessous.
    const conteneur = conteneurRef.current;
    const macron = canalRencontre.etat("macron");
    const devant = img.batte || (macron?.present && !macron.disponible) ? "42" : "";
    if (conteneur && conteneur.style.zIndex !== devant) conteneur.style.zIndex = devant;
    // Rencontre : l'embuscade lit Macron dans le canal, le tigre y publie son état.
    const emb = embuscadeRef.current;
    if (emb) {
      emb.maj(canalRencontre.etat("macron"));
      canalRencontre.publier({ type: "etat", qui: "tigre", etat: emb.etatTigre(numeroPassageRef.current) });
    }
  };

  /** Bulle au-dessus de la tête, recadrée dans l'écran ; la queue de la bulle pointe toujours le tigre. */
  const placerBulle = () => {
    const el = bulleRef.current;
    const img = imageRef.current;
    if (!el || !img) return;
    const x = img.gauche + img.bulle.x;
    const demi = el.offsetWidth / 2;
    const marge = 8;
    const min = marge + demi;
    const max = Math.max(min, window.innerWidth - marge - demi);
    const centre = Math.min(max, Math.max(min, x));
    el.style.setProperty("--queue", `${Math.max(-demi + 14, Math.min(demi - 14, x - centre))}px`);
    el.style.transform = `translate3d(${centre}px, ${img.bulle.y}px, 0) translate(-50%, -100%)`;
  };
  useLayoutEffect(placerBulle, [bulle]);

  const partir = (evenement: Evenement, petitsDemandes: number, forces: Partial<ParamsPassage> = {}) => {
    // Des petits seulement pour l'événement « famille » : sinon un tigre seul (et une seule zone de clic).
    const petits = petitsPourEvenement(evenement, petitsDemandes);
    const scene = sceneRef.current;
    const conteneur = conteneurRef.current;
    if (!scene || !conteneur) return;
    const [min, max] = VITESSES[evenement];
    passageEnCoursRef.current = true;
    const params: ParamsPassage = {
      evenement, petits,
      sens: Math.random() < PART_RETOUR ? -1 : 1,
      vitesse: min + Math.random() * (max - min),
      largeurEcran: window.innerWidth,
      largeurTigrePx: largeurTigrePx(),
      ...forces,
    };
    const taille = scene.lancer(params, {
      evenement: surEvenement,
      image: surImage,
      fin: toutNettoyer,
      tenue: (dt) => {
        const t = lienRef.current?.image(dt);
        if (!t) return null;
        const haut = conteneurRef.current?.getBoundingClientRect().top ?? 0;
        return { ...t, y: t.y - haut };
      },
    });
    conteneur.style.height = `${taille.hauteur}px`;
    setNZones(1 + petits);
    // Embuscade de ce passage (rencontre avec Macron).
    const troupe = scene.troupe(), creer = creerEmbuscadeRef.current;
    numeroPassageRef.current++;
    if (troupe && creer) {
      embuscadeRef.current = creer(troupe, {
        largeurEcran: params.largeurEcran, largeurTigrePx: params.largeurTigrePx, pxParMetre: params.largeurTigrePx / 3.75,
      });
      if (forceRef.current) embuscadeRef.current.forcer(forceRef.current);
    }
    forceRef.current = null;
  };
  const partirRef = useRef(partir);
  partirRef.current = partir;

  /**
   * Le GLB du tigre (≈ 0,5 Mo) n'est téléchargé qu'au premier passage voulu : tant qu'il n'est
   * pas prêt, le calendrier réessaie (RETENTE_PASSAGE_MS) ; s'il ne se charge pas, sprite.
   */
  const modelePret = () => {
    const scene = sceneRef.current;
    if (!scene) return false;
    if (scene.pret()) return true;
    scene.precharger().catch(() => echecRef.current());
    return false;
  };

  useCalendrierTigre(true, {
    libre: () => !passageEnCoursRef.current && modelePret()
      && !(process.env.NODE_ENV !== "production" && window.__tigreAuto === false),
    partir: (evenement, petits) => partirRef.current(evenement, petits),
    arret: () => { sceneRef.current?.arreter(); toutNettoyer(); lacherLasso(); },
  });

  // Rencontre annulée sans erreur : onglet caché, ou démontage (changement de thème, WebGL perdu).
  // Le tigre reprend sa course, et Macron, s'il est au sol, se relève.
  useEffect(() => {
    const annuler = () => {
      embuscadeRef.current?.annuler();
      canalRencontre.publier({ type: "annulation" });
    };
    const cache = () => { if (document.hidden) annuler(); };
    document.addEventListener("visibilitychange", cache);
    return () => {
      document.removeEventListener("visibilitychange", cache);
      annuler();
      embuscadeRef.current = null;
      canalRencontre.publier({ type: "etat", qui: "tigre", etat: null });
    };
  }, []);

  // Crochet de test en développement seulement : lancer un passage, une réaction, figer le temps.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__tigre = {
      auto: (v) => { window.__tigreAuto = v; },
      passage: (evenement = "normal", opts = {}) => {
        sceneRef.current?.arreter();
        toutNettoyer();
        lacherLasso();
        if (!modelePret()) {
          // Premier passage : le modèle se charge, on relance une fois prêt.
          void sceneRef.current?.precharger().then(() => window.__tigre?.passage(evenement, opts));
          return;
        }
        partirRef.current(evenement, opts.petits ?? 3, {
          ...(opts.sens ? { sens: opts.sens } : {}),
          ...(opts.vitesse ? { vitesse: opts.vitesse } : {}),
          // Captures de test : un tigre plus grand que la taille d'affichage normale (détail du modèle).
          ...(opts.largeurTigrePx ? { largeurTigrePx: opts.largeurTigrePx } : {}),
        });
      },
      reaction: (nom) => sceneRef.current?.forcer(nom ?? null) ?? "ignorer",
      clic: () => sceneRef.current?.clic() ?? "ignorer",
      geler: (v) => sceneRef.current?.geler(v),
      avancer: (dt) => sceneRef.current?.avancer(dt),
      pret: () => sceneRef.current?.pret() ?? false,
      troupe: () => sceneRef.current?.troupe() ?? null,
      embuscade: () => embuscadeRef.current?.phase ?? null,
      image: () => imageRef.current,
      /**
       * Rencontre forcée : un tigre (sens `sens`, depuis le bord gauche par défaut) et Macron face à
       * face. Sans `force`, Macron part tout de suite de l'autre bord et le tigre tend son embuscade
       * comme en vrai. Avec `force`, le tigre se poste au point `x` (px, défaut : 42 % de l'écran
       * dans son sens), arme la batte, et Macron n'est lancé qu'ensuite (petit écran, où il traverse
       * trop vite pour une rencontre). `geler` : les deux scènes figées, à avancer à la main.
       */
      rencontre: (o = {}) => {
        const sens = o.sens ?? 1, w = window.innerWidth;
        const lancerMacron = () => window.__macron?.lancer({ sens: sens === 1 ? -1 : 1, geler: o.geler });
        if (o.force) forceRef.current = { x: o.x ?? (sens === 1 ? 0.42 * w : 0.58 * w), face: sens, surArme: lancerMacron };
        else lancerMacron();
        window.__tigre?.passage("normal", { petits: 0, sens, vitesse: 2.4 });
        if (o.geler) sceneRef.current?.geler(true);
        return true;
      },
    };
    return () => { delete window.__tigre; };
  }, []);

  // pointerdown et non click : le tigre bouge, un click (mousedown + mouseup sur le même
  // élément) est perdu dès que la cible a filé entre les deux, surtout en éclair.
  const toucher = (e: PointerEvent) => {
    if (e.button !== 0 || lienRef.current) return;
    sceneRef.current?.clic();
  };

  return (
    <>
      <div ref={conteneurRef} className={styles.conteneur} aria-hidden="true">
        <canvas ref={canvasRef} className={styles.canvas} />
        {Array.from({ length: nZones }, (_, i) => (
          <div
            key={i}
            ref={(el) => { zonesRef.current[i] = el; }}
            className={styles.zone}
            onPointerDown={toucher}
          />
        ))}
        {bulle && <span key={bulle.id} ref={bulleRef} className={styles.bulle}>{bulle.texte}</span>}
        {particules.map((p) => (
          <span
            key={p.id}
            className={`${styles.particule} ${p.genre === "zzz" ? styles.zzz : ""}`}
            style={{
              left: `${p.x}px`, top: `${p.y}px`,
              "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, animationDelay: `${p.retardMs}ms`,
            } as CSSProperties}
          >
            {p.glyphe}
          </span>
        ))}
      </div>
      {lasso.rendu}
    </>
  );
}

declare global {
  interface Window {
    /** Crochet de test, présent en développement seulement. */
    __tigre?: {
      auto(v: boolean): void;
      passage(evenement?: Evenement, opts?: { petits?: number; sens?: 1 | -1; vitesse?: number; largeurTigrePx?: number }): void;
      reaction(nom?: Parameters<Scene3D["forcer"]>[0]): "lancer" | "taper" | "ignorer";
      clic(): "lancer" | "taper" | "ignorer";
      geler(v: boolean): void;
      avancer(dt: number): void;
      pret(): boolean;
      troupe(): unknown;
      /** Phase de l'embuscade du passage en cours (lib/tigre3d/embuscade.ts). */
      embuscade(): string | null;
      /** Dernière image (zones, bulle, point de la batte), pour les vérifications. */
      image(): InfosImage | null;
      rencontre(o?: { sens?: 1 | -1; force?: boolean; x?: number; geler?: boolean }): boolean;
    };
    __tigreAuto?: boolean;
  }
}
