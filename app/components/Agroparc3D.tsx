"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Chakra_Petch, IBM_Plex_Mono } from "next/font/google";
import type { Carte, PdjEntry, Plat } from "@/lib/db";
import type { Poi, SceneData } from "@/lib/agroparc3d/types";
import type { SceneHandle } from "@/lib/agroparc3d/scene";
import { etatRestaurant } from "@/lib/agroparc3d/panneau";
import { couleurNote, remplissage } from "@/lib/agroparc3d/jauge";
import { noteMode, trierCarte, type Mode } from "@/lib/carte-tri";
import styles from "./Agroparc3D.module.css";

const display = Chakra_Petch({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--ag-display", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--ag-mono", display: "swap" });

interface Ev { id: number; time: string; tag: string; text: string }

const MODES: Mode[] = ["sportif", "goulaf"];
const MODE_LABEL: Record<Mode, string> = { sportif: "Sportif", goulaf: "Goulaf" };
/** Même clé que le site (ClientScripts) : le mode choisi ici suit sur la page derrière et inversement. */
const MODE_KEY = "pdj-mode";

const fmtDate = (iso: string, long = true) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", long
    ? { weekday: "long", day: "numeric", month: "long" }
    : { weekday: "short", day: "numeric", month: "short" });
};
const fmtNote = (n?: number) => (n == null ? "—" : `${n}/10`);

function modeInitial(): Mode {
  try { return localStorage.getItem(MODE_KEY) === "goulaf" ? "goulaf" : "sportif"; } catch { return "sportif"; }
}

/** Menu du jour : celui d'aujourd'hui si publié, sinon le plus récent. */
async function fetchPdj(): Promise<PdjEntry | null> {
  const today = new Date().toLocaleDateString("en-CA");
  for (const url of [`/api/pdj?date=${today}`, "/api/pdj"]) {
    try {
      const r = await fetch(url);
      if (r.ok) return (await r.json()) as PdjEntry;
    } catch { /* on tente l'URL suivante */ }
  }
  return null;
}

export default function Agroparc3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const [scene, setScene] = useState<SceneData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pdj, setPdj] = useState<PdjEntry | null>(null);
  const [selected, setSelected] = useState<Poi | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  // Le composant n'est monté qu'au clavier (jamais rendu côté serveur) : lecture directe du mode du site.
  const [mode, setMode] = useState<Mode>(modeInitial);

  const changerMode = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* stockage indisponible : le mode reste local à la vue */ }
    // Le site derrière réapplique le mode courant sur cet événement (ClientScripts).
    window.dispatchEvent(new Event("pdj:mode-refresh"));
  };

  // Le site derrière ne doit plus défiler tant que la vue 3D est ouverte.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/agroparc/scene.json")
      .then((r) => { if (!r.ok) throw new Error(`scene.json ${r.status}`); return r.json() as Promise<SceneData>; })
      .then((d) => { if (!cancelled) setScene(d); })
      .catch((e: Error) => { if (!cancelled) setError(`Impossible de charger la carte (${e.message}).`); });
    fetchPdj().then((d) => { if (!cancelled) setPdj(d); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!scene || !canvasRef.current || !labelsRef.current) return;
    let handle: SceneHandle | null = null;
    let cancelled = false;
    import("@/lib/agroparc3d/scene")
      .then(({ createAgroparcScene }) => {
        if (cancelled || !canvasRef.current || !labelsRef.current) return;
        handle = createAgroparcScene(canvasRef.current, labelsRef.current, scene, {
          onSelect: (poi) => setSelected(poi),
          onEvent: (tag, text) => {
            const now = new Date();
            const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
            setEvents((evs) => [...evs, { id: now.getTime() + Math.random(), time, tag, text }].slice(-3));
          },
        });
        handleRef.current = handle;
        setReady(true);
      })
      .catch((e: Error) => setError(`Le rendu 3D n'a pas pu démarrer (${e.message}). WebGL est-il activé ?`));
    return () => { cancelled = true; handle?.dispose(); handleRef.current = null; };
  }, [scene]);

  // Plat du jour du POI cliqué (+ carte permanente en dépliant), ou statut + carte quand il n'en a pas.
  const etat = selected ? etatRestaurant(selected, pdj, new Date().toLocaleDateString("en-CA")) : null;

  return (
    <div className={`${styles.root} ${display.variable} ${mono.variable}`} role="dialog" aria-modal="true" aria-label="Agroparc en 3D">
      <canvas ref={canvasRef} className={styles.canvas} />
      <div ref={labelsRef} className={styles.labels} />
      <div className={styles.vignette} />

      <header className={`${styles.hud} ${styles.hudTl}`}>
        <h1 className={styles.title}>Agroporc x Palantir</h1>
        <div className={styles.modes} role="group" aria-label="Mode de notation">
          {MODES.map((m) => (
            <button key={m} type="button" data-mode={m} aria-pressed={mode === m} onClick={() => changerMode(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </header>

      <div className={`${styles.hud} ${styles.hudBl}`}>
        <div className={styles.legend}>
          <span className={styles.kHome}>CBA</span>
          <span className={styles.kResto}>Restaurants PDJ</span>
          <span className={styles.kBat}>Bâtiments IGN</span>
        </div>
        <div className={styles.hint}>
          Glisser : pivoter · Clic droit ou deux doigts : déplacer · Molette : zoom · Flèches : déplacer · Clic sur un restaurant : plat du jour et carte · Retape <b>myrtille</b> pour revenir au site
        </div>
        <div className={styles.ctl}>
          <button type="button" onClick={() => handleRef.current?.spin(1)} aria-label="Pivoter vers la gauche">↺ Pivoter</button>
          <button type="button" onClick={() => handleRef.current?.spin(-1)} aria-label="Pivoter vers la droite">Pivoter ↻</button>
          <button type="button" onClick={() => { setSelected(null); handleRef.current?.recenter(); }}>Recentrer</button>
        </div>
      </div>

      <div className={`${styles.hud} ${styles.hudBr}`}>
        <div className={styles.date}>{pdj?.date ? `Menus du ${fmtDate(pdj.date)}` : "Menus indisponibles"}</div>
        <div className={styles.log}>
          {events.map((e) => (
            <div key={e.id}>{e.time} {e.text}<b>{e.tag}</b></div>
          ))}
        </div>
      </div>

      {selected && etat && (
        <aside className={styles.panel} aria-live="polite">
          <p className={`${styles.eyebrow} ${styles.panelHead}`}>
            <span>{[etat.kind === "plat" ? "Plat du jour" : "Restaurant", pdj?.date && fmtDate(pdj.date, false)].filter(Boolean).join(" · ")}</span>
            <button type="button" className={styles.close} onClick={() => setSelected(null)}>Fermer</button>
          </p>
          <h2>{selected.name}</h2>
          <p className={styles.addr}>{selected.addr}</p>
          {etat.kind === "plat" ? (
            <>
              <PlatDuJour plat={etat.plat} mode={mode} />
              {etat.carteSlug && <CarteDepliante key={etat.carteSlug} slug={etat.carteSlug} mode={mode} />}
            </>
          ) : (
            <>
              <p className={styles.empty}>{etat.statut}</p>
              {etat.carteSlug && <CarteMini key={etat.carteSlug} slug={etat.carteSlug} mode={mode} />}
            </>
          )}
        </aside>
      )}

      {(!ready || error) && (
        <div className={styles.loading}>
          {error ? <span className={styles.err}>{error}</span> : <span>Radiographie en cours</span>}
        </div>
      )}
    </div>
  );
}

function PlatDuJour({ plat, mode }: { plat: Plat; mode: Mode }) {
  const note = noteMode(plat, mode);
  const justification = mode === "goulaf" ? plat.justification_goulaf ?? plat.justification : plat.justification;
  return (
    <>
      <p className={styles.plat}>{plat.plat}</p>
      <div className={styles.platMeta}>
        {plat.prix && <p className={styles.prix}>{plat.prix}</p>}
        <Jauge note={note} label={MODE_LABEL[mode]} />
      </div>
      {plat.nutrition_estimee && (
        <div className={styles.nutri}>
          <span><b>{Math.round(plat.nutrition_estimee.calories)}</b> kcal</span>
          <span>P <b>{Math.round(plat.nutrition_estimee.proteines_g)}</b> g</span>
          <span>G <b>{Math.round(plat.nutrition_estimee.glucides_g)}</b> g</span>
          <span>L <b>{Math.round(plat.nutrition_estimee.lipides_g)}</b> g</span>
        </div>
      )}
      {justification && <p className={styles.just}>{justification}</p>}
    </>
  );
}

/** Demi-cercle de rayon 44 centré en (56, 56) dans une boîte 112 × 62. */
const ARC = "M 12 56 A 44 44 0 0 1 100 56";
const ARC_LEN = Math.PI * 44;

/** Jauge en arc : remplie à note/10, colorée du rouge au vert (cf. lib/agroparc3d/jauge.ts). */
function Jauge({ note, label }: { note?: number; label: string }) {
  const style = { "--jauge": couleurNote(note) } as CSSProperties;
  return (
    <div className={styles.jauge} style={style} role="img" aria-label={`Note ${label} : ${fmtNote(note)}`}>
      <svg viewBox="0 0 112 62" aria-hidden="true">
        <path className={styles.jaugeFond} d={ARC} />
        <path className={styles.jaugeArc} d={ARC} style={{ strokeDasharray: `${remplissage(note) * ARC_LEN} ${ARC_LEN}` }} />
      </svg>
      <div className={styles.jaugeVal}><b>{note == null ? "—" : note}</b><span>/10</span></div>
      <div className={styles.jaugeK}>{label}</div>
    </div>
  );
}

/** Version compacte pour les lignes de carte : barre remplie + note, même échelle de couleur. */
function MiniJauge({ note }: { note?: number }) {
  const style = { "--jauge": couleurNote(note) } as CSSProperties;
  return (
    <span className={styles.mini} style={style} role="img" aria-label={`Note ${fmtNote(note)}`}>
      <i><i style={{ width: `${remplissage(note) * 100}%` }} /></i>
      <b>{fmtNote(note)}</b>
    </span>
  );
}

/** Sous le plat du jour : la carte permanente du resto, chargée au premier dépliage. */
function CarteDepliante({ slug, mode }: { slug: string; mode: Mode }) {
  const [ouverte, setOuverte] = useState(false);
  return (
    <div className={styles.depliant}>
      <button type="button" className={styles.depliantBtn} aria-expanded={ouverte} onClick={() => setOuverte((o) => !o)}>
        {ouverte ? "Masquer la carte" : "Voir aussi la carte"}
        <span aria-hidden="true">{ouverte ? "▴" : "▾"}</span>
      </button>
      {ouverte && <CarteMini slug={slug} mode={mode} />}
    </div>
  );
}

/** Cartes déjà demandées pendant la session 3D : un seul fetch par resto, retentable en cas d'échec. */
const cartesCache = new Map<string, Promise<Carte | null>>();

function chargerCarte(slug: string): Promise<Carte | null> {
  let p = cartesCache.get(slug);
  if (!p) {
    p = fetch(`/api/carte?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Carte | null>) : null))
      .catch(() => null);
    cartesCache.set(slug, p);
    void p.then((c) => { if (c === null) cartesCache.delete(slug); });
  }
  return p;
}

/** Carte permanente en liste compacte : sections puis plats triés par la note du mode courant. */
function CarteMini({ slug, mode }: { slug: string; mode: Mode }) {
  // undefined = chargement en cours, null = indisponible
  const [carte, setCarte] = useState<Carte | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    chargerCarte(slug).then((c) => { if (!cancelled) setCarte(c); });
    return () => { cancelled = true; };
  }, [slug]);

  if (carte === undefined) return <p className={`${styles.empty} ${styles.carteEtat}`}>Chargement de la carte…</p>;
  if (carte === null) return <p className={`${styles.empty} ${styles.carteEtat}`}>Carte indisponible pour le moment.</p>;

  const noteeLe = carte.evaluated_at
    ? new Date(carte.evaluated_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
    : null;

  return (
    <div className={styles.carte}>
      <p className={styles.eyebrow}>Carte permanente · notes {MODE_LABEL[mode]}{noteeLe && ` · notée le ${noteeLe}`}</p>
      {trierCarte(carte, mode).map((sec) => (
        <section key={sec.nom} className={styles.carteSection}>
          <h3>{sec.nom} <span>{sec.plats.length}</span></h3>
          <ul>
            {sec.plats.map((p, i) => (
              <li key={`${sec.nom}::${p.plat ?? i}`}>
                <span className={styles.carteNom}>{p.plat}</span>
                <span className={styles.carteMeta}>
                  {p.prix && <span>{p.prix}</span>}
                  <MiniJauge note={noteMode(p, mode)} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
