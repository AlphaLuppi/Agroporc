"use client";

import { useCallback, useEffect, useState } from "react";
import type { PdjEntry } from "@/lib/db";
import { formatDateShort, formatDayShort } from "@/lib/format";
import { meilleureNoteDuJour } from "@/lib/menus-vue";
import type { ImagesPlats } from "@/lib/plat-image";
import { RESTAURANTS, titreCarte } from "@/lib/restaurants";
import { useModeSite } from "./useModeSite";
import JourVue from "./JourVue";
import SemaineVue from "./SemaineVue";
import CarteVue from "./CarteVue";
import DetailPanneau, { type Selection } from "./DetailPanneau";
import { couleur, ModeToggle } from "./ui";
import styles from "./menus.module.css";

type Vue = "jour" | "semaine" | "carte";
const VUE_KEY = "pdj-vue";
const VUES: { id: Vue; label: string }[] = [
  { id: "jour", label: "Jour" },
  { id: "semaine", label: "Semaine" },
  { id: "carte", label: "La carte" },
];

interface Props {
  semaine: PdjEntry[];
  /** Slugs des restos dont la carte permanente est en base. */
  cartes: string[];
  today: string;
  defaultIdx: number;
  weekLabel: string;
  prevHref: string;
  nextHref: string;
  isCurrentWeek: boolean;
  /** Images IA existantes des plats de la semaine (POC) : base de clé → URL. */
  images?: ImagesPlats;
  /** Base de clé → clé de chaque plat de la semaine (le client ne hache rien) : recettes (POC). */
  clesPlats?: Record<string, string>;
}

function Chevron({ sens }: { sens: "g" | "d" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points={sens === "g" ? "15 18 9 12 15 6" : "9 6 15 12 9 18"} />
    </svg>
  );
}

export default function MenusClient({ semaine, cartes, today, defaultIdx, weekLabel, prevHref, nextHref, isCurrentWeek, images, clesPlats }: Props) {
  const [mode, setMode] = useModeSite();
  const [vue, setVueState] = useState<Vue>("jour");
  const [jourIdx, setJourIdx] = useState(defaultIdx);
  const restosCarte = RESTAURANTS.filter((r) => cartes.includes(r.slug));
  const [slug, setSlug] = useState(restosCarte[0]?.slug ?? "");
  const [selection, setSelection] = useState<Selection>(null);

  // La vue choisie est mémorisée comme le mode (lue au montage : le serveur rend la vue Jour).
  useEffect(() => {
    try {
      const v = localStorage.getItem(VUE_KEY);
      if (v === "semaine" || (v === "carte" && restosCarte.length > 0)) setVueState(v);
    } catch {
      /* stockage indisponible */
    }
    // restosCarte ne change pas après le rendu serveur
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setVue = (v: Vue) => {
    setVueState(v);
    try {
      localStorage.setItem(VUE_KEY, v);
    } catch {
      /* stockage indisponible */
    }
  };
  const fermer = useCallback(() => setSelection(null), []);
  const voirCarte = (s: string) => {
    setSelection(null);
    setSlug(s);
    setVue("carte");
  };

  const pdj = semaine[jourIdx];
  const vues = VUES.filter((v) => v.id !== "carte" || restosCarte.length > 0);

  const semaineNav = (
    <nav className={styles.semaineNav} aria-label="Changer de semaine">
      <a href={prevHref} aria-label="Semaine précédente"><Chevron sens="g" /></a>
      {vue === "jour" && <span className={styles.semaineLabel}>{weekLabel}</span>}
      {!isCurrentWeek && <a href="/" className={styles.auj}>Aujourd&apos;hui</a>}
      <a href={nextHref} aria-label="Semaine suivante"><Chevron sens="d" /></a>
    </nav>
  );

  return (
    <div className={styles.root}>
      <div className={styles.vues} role="group" aria-label="Vue">
        {vues.map((v) => (
          <button key={v.id} type="button" aria-pressed={vue === v.id} onClick={() => setVue(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      {vue === "jour" && pdj && (
        <>
          <div className={styles.titre}>
            <h1>
              {formatDateShort(pdj.date)}
              {pdj.date > today && <span className={styles.apercu}>Aperçu</span>}
            </h1>
            {semaineNav}
          </div>
          <div className={styles.dock}>
            <div className={styles.jours} role="group" aria-label="Jour">
              {semaine.map((p, i) => (
                <button
                  key={p.date}
                  type="button"
                  aria-pressed={i === jourIdx}
                  className={p.date === today ? styles.auj : undefined}
                  onClick={() => setJourIdx(i)}
                  aria-label={formatDateShort(p.date)}
                >
                  <small>{formatDayShort(p.date)}</small>
                  <b>{new Date(p.date + "T12:00:00").getDate()}</b>
                  <span className={`${styles.point} ${couleur(meilleureNoteDuJour(p, mode))}`} style={meilleureNoteDuJour(p, mode) != null ? { background: "currentColor" } : undefined} />
                </button>
              ))}
            </div>
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
          <JourVue pdj={pdj} mode={mode} images={images} onOpen={setSelection} />
        </>
      )}

      {vue === "semaine" && (
        <>
          <div className={`${styles.titre} ${styles.large1180}`}>
            <h1>Semaine du {weekLabel}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              {semaineNav}
              <ModeToggle mode={mode} onChange={setMode} />
            </div>
          </div>
          <SemaineVue
            semaine={semaine}
            mode={mode}
            today={today}
            jourIdx={jourIdx}
            setJourIdx={setJourIdx}
            voirJour={(i) => {
              setJourIdx(i);
              setVue("jour");
            }}
            onOpen={setSelection}
          />
        </>
      )}

      {vue === "carte" && (
        <>
          <div className={styles.titre}>
            <h1>{titreCarte(restosCarte.find((r) => r.slug === slug) ?? restosCarte[0])}</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className={styles.restos} role="group" aria-label="Restaurant">
              {restosCarte.map((r) => (
                <button key={r.slug} type="button" aria-pressed={r.slug === slug} onClick={() => setSlug(r.slug)}>
                  {r.nom}
                </button>
              ))}
            </div>
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
          <CarteVue slug={slug} mode={mode} />
        </>
      )}

      {selection && (
        <DetailPanneau
          selection={selection}
          semaine={semaine}
          mode={mode}
          today={today}
          cartesSlugs={new Set(cartes)}
          images={images}
          clesPlats={clesPlats}
          onClose={fermer}
          voirCarte={voirCarte}
        />
      )}
    </div>
  );
}
