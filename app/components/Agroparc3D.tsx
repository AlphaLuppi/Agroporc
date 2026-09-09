"use client";

import { useEffect, useRef, useState } from "react";
import { Chakra_Petch, IBM_Plex_Mono } from "next/font/google";
import type { PdjEntry, Plat } from "@/lib/db";
import type { Poi, SceneData } from "@/lib/agroparc3d/types";
import type { SceneHandle } from "@/lib/agroparc3d/scene";
import styles from "./Agroparc3D.module.css";

const display = Chakra_Petch({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--ag-display", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--ag-mono", display: "swap" });

interface Ev { id: number; time: string; tag: string; text: string }

const fmtDate = (iso: string, long = true) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", long
    ? { weekday: "long", day: "numeric", month: "long" }
    : { weekday: "short", day: "numeric", month: "short" });
};
const fmtNote = (n?: number) => (n == null ? "—" : `${n}/10`);

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

  const plat: Plat | undefined = selected && pdj ? pdj.plats.find((p) => p.restaurant === selected.name) : undefined;

  return (
    <div className={`${styles.root} ${display.variable} ${mono.variable}`} role="dialog" aria-modal="true" aria-label="Agroparc en 3D">
      <canvas ref={canvasRef} className={styles.canvas} />
      <div ref={labelsRef} className={styles.labels} />
      <div className={styles.vignette} />

      <header className={`${styles.hud} ${styles.hudTl}`}>
        <h1 className={styles.title}>Agroporc x Palantir</h1>
      </header>

      <div className={`${styles.hud} ${styles.hudBl}`}>
        <div className={styles.legend}>
          <span className={styles.kHome}>CBA</span>
          <span className={styles.kResto}>Restaurants PDJ</span>
          <span className={styles.kBat}>Bâtiments IGN</span>
        </div>
        <div className={styles.hint}>
          Glisser : pivoter · Clic droit ou deux doigts : déplacer · Molette : zoom · Flèches : déplacer · Clic sur un restaurant : menu du jour · Retape <b>myrtille</b> pour revenir au site
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

      {selected && (
        <aside className={styles.panel} aria-live="polite">
          <p className={`${styles.eyebrow} ${styles.panelHead}`}>
            <span>{pdj?.date ? `Plat du jour · ${fmtDate(pdj.date, false)}` : "Plat du jour"}</span>
            <button type="button" className={styles.close} onClick={() => setSelected(null)}>Fermer</button>
          </p>
          <h2>{selected.name}</h2>
          <p className={styles.addr}>{selected.addr}</p>
          {!plat || plat.coming_soon ? (
            <p className={styles.empty}>Menu pas encore publié pour cette date. Le pipeline le récupérera au prochain passage.</p>
          ) : (
            <>
              <p className={styles.plat}>{plat.plat}</p>
              {plat.prix && <p className={styles.prix}>{plat.prix}</p>}
              <div className={styles.scores}>
                <div>
                  <div className={styles.scoreK}>Sportif <b>{fmtNote(plat.note)}</b></div>
                  <div className={styles.bar}><i style={{ width: `${(plat.note ?? 0) * 10}%` }} /></div>
                </div>
                <div className={styles.goulaf}>
                  <div className={styles.scoreK}>Goulaf <b>{fmtNote(plat.note_goulaf)}</b></div>
                  <div className={styles.bar}><i style={{ width: `${(plat.note_goulaf ?? 0) * 10}%` }} /></div>
                </div>
              </div>
              {plat.nutrition_estimee && (
                <div className={styles.nutri}>
                  <span><b>{Math.round(plat.nutrition_estimee.calories)}</b> kcal</span>
                  <span>P <b>{Math.round(plat.nutrition_estimee.proteines_g)}</b> g</span>
                  <span>G <b>{Math.round(plat.nutrition_estimee.glucides_g)}</b> g</span>
                  <span>L <b>{Math.round(plat.nutrition_estimee.lipides_g)}</b> g</span>
                </div>
              )}
              {plat.justification && <p className={styles.just}>{plat.justification}</p>}
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
