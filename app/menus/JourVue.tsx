"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type PointerEvent } from "react";
import type { PdjEntry } from "@/lib/db";
import type { Mode } from "@/lib/carte-tri";
import { casseLisible, indexOrpheline, macrosTuile, NOM_LONG, platsAffiches, platsAVenir, recoDuMode, restosSansPlat, type PlatAffiche } from "@/lib/menus-vue";
import { imageDuPlat, type ImagePlat, type ImagesPlats } from "@/lib/plat-image";
import type { Selection } from "./DetailPanneau";
import RestoBadge from "@/app/components/RestoBadge";
import PlatImage from "./PlatImage";
import { deltaBoite, lireScale, lireTranslate, rangStagger, type Boite } from "@/lib/motion-menus";
import { couleur, fmtPrix, NoteAnimee, PartBudget, PastilleAnimee } from "./ui";
import { estPret, finRipple, reduit, ripple, SORTIE_EXPO } from "./motion";
import styles from "./menus.module.css";

function Meta({ p }: { p: PlatAffiche }) {
  const kcal = p.variante.nutrition_estimee?.calories;
  return (
    <span className={styles.meta}>
      <b>{fmtPrix(p.plat.prix)}</b>
      <PartBudget prix={p.plat.prix} />
      {kcal ? ` · ${Math.round(kcal)} kcal` : ""}
    </span>
  );
}

/** Macros en chiffres, sans couleur (le vert/ambre/rouge est réservé aux notes) ; protéines en avant en Sportif. */
function Macros({ p, mode }: { p: PlatAffiche; mode: Mode }) {
  const macros = macrosTuile(p.variante.nutrition_estimee);
  if (!macros) return null;
  return (
    <span className={styles.macros} title={macros.map((m) => `${m.long} ${m.grammes} g`).join(" · ")}>
      {macros.map((m) => (
        <span key={m.cle} className={mode === "sportif" && m.cle === "proteines" ? styles.fort : undefined}>
          <b>{m.grammes} g</b> {m.court}
        </span>
      ))}
    </span>
  );
}

/** Au-delà, pas de FLIP (coût et lisibilité). */
const FLIP_MAX = 24;

/** Boîte de layout dans la grille (offset* ignorent les translate/scale en cours). */
const mesurer = (el: HTMLElement): Boite => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });

function Tuile({
  p,
  mode,
  image,
  pleine,
  rang,
  flipKey,
  onOpen,
}: {
  p: PlatAffiche;
  mode: Mode;
  image?: ImagePlat;
  pleine?: boolean;
  rang: number;
  flipKey: string;
  onOpen: () => void;
}) {
  const nom = casseLisible(p.variante.plat);
  const note = (
    <span className={`${styles.grosseNote} ${couleur(p.note)}`}>
      <NoteAnimee note={p.note} />
      <small>/10</small>
    </span>
  );
  return (
    <button
      type="button"
      data-flip={flipKey}
      className={`${styles.tuile} ${styles.entre} ${pleine || nom.length > NOM_LONG ? styles.large : ""}`}
      style={{ "--i": rangStagger(rang) } as CSSProperties}
      onPointerDown={ripple}
      onAnimationEnd={finRipple}
      onClick={onOpen}
    >
      {image && <PlatImage key={image.src} src={image.src} nom={nom} format="tuile" />}
      <span className={styles.tuileHaut}>
        {note}
        <RestoBadge nom={p.plat.restaurant} variante="chip" />
      </span>
      <span className={styles.nom}>{nom}</span>
      <Meta p={p} />
      <Macros p={p} mode={mode} />
    </button>
  );
}

function Hero({ p, mode, raison, image, flipKey, onOpen }: { p: PlatAffiche; mode: Mode; raison?: string; image?: ImagePlat; flipKey: string; onOpen: () => void }) {
  const n = p.variante.nutrition_estimee;
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // Tilt 3D léger (≤ 3°) et halo qui suit le pointeur : souris uniquement, throttlé en rAF.
  const suivre = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== "mouse" || raf.current || reduit()) return;
    const el = e.currentTarget;
    const { clientX, clientY } = e;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      const x = (clientX - r.left) / r.width;
      const y = (clientY - r.top) / r.height;
      el.style.setProperty("--rx", `${((0.5 - y) * 5).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${((x - 0.5) * 5).toFixed(2)}deg`);
      el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    });
  };
  const quitter = (e: PointerEvent<HTMLButtonElement>) => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    e.currentTarget.style.setProperty("--rx", "0deg");
    e.currentTarget.style.setProperty("--ry", "0deg");
  };
  return (
    <button
      type="button"
      data-flip={flipKey}
      className={`${styles.hero} ${styles.entre} ${image ? styles.heroPhoto : ""}`}
      style={{ "--i": 0 } as CSSProperties}
      onPointerMove={suivre}
      onPointerLeave={quitter}
      onPointerDown={ripple}
      onAnimationEnd={finRipple}
      onClick={onOpen}
    >
      {image && <PlatImage key={image.src} src={image.src} nom={casseLisible(p.variante.plat)} format="hero" />}
      <PastilleAnimee note={p.note} cle={`${p.platIndex}::${p.variante.plat}::${mode}`} />
      <span className={styles.heroTexte}>
        <span className={styles.heroTags}>
          <span className={styles.tagReco}>Reco du jour</span>
          <RestoBadge nom={p.plat.restaurant} variante="chip" complet className={styles.restoHero} />
        </span>
        <span className={styles.heroNom}>{casseLisible(p.variante.plat)}</span>
        <span className={styles.meta}>
          <b>{fmtPrix(p.plat.prix)}</b>
          <PartBudget prix={p.plat.prix} />
        </span>
        {raison && <span className={styles.raison}>{raison}</span>}
        {n && (
          <span className={styles.macrosLigne}>
            <span><b>{Math.round(n.calories)}</b> kcal</span>
            <span>Protéines <b>{Math.round(n.proteines_g)}</b> g</span>
            <span>Glucides <b>{Math.round(n.glucides_g)}</b> g</span>
            <span>Lipides <b>{Math.round(n.lipides_g)}</b> g</span>
          </span>
        )}
      </span>
    </button>
  );
}

/** Vue Jour : la reco du mode en grand, puis les autres plats en tuiles, triés par note. */
export default function JourVue({ pdj, mode, images, onOpen }: { pdj: PdjEntry; mode: Mode; images?: ImagesPlats; onOpen: (s: Selection) => void }) {
  const grilleRef = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, Boite>());
  const modePrecedent = useRef(mode);

  // FLIP au changement de mode : chaque plat (clé stable, hero compris) glisse vers son nouveau
  // rang. Le hero qui redescend en tuile et la tuile promue hero changent aussi de taille : on
  // anime translate + scale depuis leur ancienne boîte. On mesure offsetLeft/Top/Width/Height
  // (insensibles aux translate/scale en cours) + le translate/scale courant pour partir de la
  // boîte visuelle si une animation précédente tourne encore.
  useLayoutEffect(() => {
    const grille = grilleRef.current;
    if (!grille) return;
    const els = Array.from(grille.querySelectorAll<HTMLElement>(":scope > [data-flip]"));
    const modeChange = modePrecedent.current !== mode;
    modePrecedent.current = mode;
    const animer = modeChange && estPret() && !reduit() && els.length <= FLIP_MAX;
    const avant = positions.current;
    const apres = new Map<string, Boite>();
    for (const el of els) {
      const cle = el.dataset.flip!;
      // Tuile déjà connue : son entrée est jouée. On le marque AVANT toute lecture de style, sinon
      // le déplacement DOM du tri relance `.entre` (cas du rendu serveur : animationend jamais reçu).
      if (avant.has(cle)) el.setAttribute("data-vu", "");
      if (el.offsetParent === null) continue; // caché : rien à mesurer
      let visuel = avant.get(cle);
      if (animer && visuel) {
        const cs = getComputedStyle(el);
        const t = lireTranslate(cs.translate);
        const s = lireScale(cs.scale);
        visuel = { x: visuel.x + t.x, y: visuel.y + t.y, w: visuel.w * s.x, h: visuel.h * s.y };
        for (const a of el.getAnimations()) if (a.id === "flip") a.cancel();
      }
      const boite = mesurer(el);
      apres.set(cle, boite);
      if (!animer) continue;
      const d = deltaBoite(visuel, boite);
      if (d) {
        const redim = d.sx !== 1 || d.sy !== 1;
        // Ceux qui changent de taille passent au-dessus des tuiles qu'ils croisent.
        const commun = redim ? { transformOrigin: "0 0", zIndex: 2 } : {};
        const a = el.animate(
          [
            { ...commun, translate: `${d.x}px ${d.y}px`, scale: `${d.sx} ${d.sy}` },
            { ...commun, translate: "0 0", scale: "1 1" },
          ],
          { duration: redim ? 380 : 320, easing: SORTIE_EXPO },
        );
        a.id = "flip";
      } else if (!avant.has(cle)) {
        // Une tuile qui apparaît (pas encore mesurée) fait un pop, seul : pas d'entrée CSS en plus.
        el.setAttribute("data-vu", "");
        el.animate([{ scale: "0.9", opacity: 0.4 }, { scale: "1.03", offset: 0.6 }, { scale: "1", opacity: 1 }], { duration: 300, easing: "ease-out" });
      }
    }
    positions.current = apres;
  }, [mode, pdj]);

  // Rendu serveur : les entrées terminées avant l'hydratation n'ont pas émis d'animationend
  // capté par React. On marque `data-vu` sur celles qui ne tournent plus.
  useEffect(() => {
    grilleRef.current?.querySelectorAll<HTMLElement>(`.${styles.entre}:not([data-vu])`).forEach((el) => {
      const enCours = el.getAnimations().some((a) => "animationName" in a && a.playState !== "finished");
      if (!enCours) el.setAttribute("data-vu", "");
    });
  }, []);

  // Les positions mémorisées doivent suivre les changements de largeur (rotation, fenêtre).
  useEffect(() => {
    const grille = grilleRef.current;
    if (!grille || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const m = new Map<string, Boite>();
      grille.querySelectorAll<HTMLElement>(":scope > [data-flip]").forEach((el) => {
        if (el.offsetParent !== null) m.set(el.dataset.flip!, mesurer(el));
      });
      positions.current = m;
    });
    ro.observe(grille);
    return () => ro.disconnect();
  }, []);

  if (pdj.ferie) {
    return <div className={styles.message}>Jour férié, {pdj.ferie}. Les restaurants sont fermés.</div>;
  }
  if (pdj.erreur) {
    return <div className={styles.message}>{pdj.erreur}</div>;
  }

  const plats = platsAffiches(pdj, mode);
  const reco = recoDuMode(pdj, mode);
  const [premier, ...autres] = plats;
  const hero = premier?.reco ? premier : null;
  const tuiles = hero ? autres : plats;
  const ouvrir = (p: PlatAffiche) => () => onOpen({ kind: "plat", date: pdj.date, platIndex: p.platIndex, variante: p.variante.plat });
  const aVenir = platsAVenir(pdj);
  const sans = restosSansPlat(pdj);
  const cleDe = (p: PlatAffiche) => `${p.platIndex}::${p.variante.plat}`;
  const image = (p: PlatAffiche) => imageDuPlat(images, p.plat.restaurant, p.variante.plat);
  const orpheline = indexOrpheline(tuiles);

  return (
    <div className={styles.grille} ref={grilleRef}>
      {hero && <Hero p={hero} mode={mode} raison={reco?.raison} image={image(hero)} flipKey={cleDe(hero)} onOpen={ouvrir(hero)} />}
      {tuiles.map((p, i) => {
        const cle = cleDe(p);
        return (
          <Tuile
            key={cle}
            flipKey={cle}
            rang={i + (hero ? 1 : 0)}
            p={p}
            mode={mode}
            image={image(p)}
            pleine={i === orpheline}
            onOpen={ouvrir(p)}
          />
        );
      })}
      {(aVenir.length > 0 || sans.length > 0) && (
        <div className={`${styles.puces} ${styles.entre}`} style={{ "--i": rangStagger(tuiles.length + 1) } as CSSProperties}>
          {/* Un groupe par intitulé : « Sans plat » ne se retrouve jamais en fin de ligne après une puce d'un autre groupe. */}
          {aVenir.length > 0 && (
            <div className={styles.pucesGroupe}>
              <span className={styles.pucesTitreLigne}><span className={styles.pucesTitre}>Dévoilé le matin même</span></span>
              {aVenir.map((p) => (
                <button key={p.restaurant} type="button" onClick={() => onOpen({ kind: "resto", date: pdj.date, nom: p.restaurant })}>
                  <RestoBadge nom={p.restaurant} complet />
                </button>
              ))}
            </div>
          )}
          {sans.length > 0 && (
            <div className={styles.pucesGroupe}>
              <span className={styles.pucesTitreLigne}><span className={styles.pucesTitre}>Sans plat</span></span>
              {sans.map((r) => (
                <button key={r.slug} type="button" onClick={() => onOpen({ kind: "resto", date: pdj.date, nom: r.nom })}>
                  <RestoBadge nom={r.nom} complet />
                  {r.type === "lien" && <span>· salades</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
