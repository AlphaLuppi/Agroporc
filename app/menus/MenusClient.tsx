"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition, type CSSProperties, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import type { PdjEntry } from "@/lib/db";
import { formatDateShort, formatDayShort } from "@/lib/format";
import { meilleureNoteDuJour } from "@/lib/menus-vue";
import type { ImagesPlats } from "@/lib/plat-image";
import { decalageEntree, directionJour } from "@/lib/motion-menus";
import { RESTAURANTS, titreCarte } from "@/lib/restaurants";
import RestoBadge from "@/app/components/RestoBadge";
import { useModeSite } from "./useModeSite";
import JourVue from "./JourVue";
import SemaineVue from "./SemaineVue";
import CarteVue from "./CarteVue";
import GrilleSquelette from "./GrilleSquelette";
import DetailPanneau, { type Selection } from "./DetailPanneau";
import { couleur, ModeToggle } from "./ui";
import { popper, reduit, usePret } from "./motion";
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
  // Jour choisi + sens du dernier changement (slide directionnel de la vue Jour).
  const [jour, setJour] = useState<{ idx: number; dir: -1 | 0 | 1 }>({ idx: defaultIdx, dir: 0 });
  const jourIdx = jour.idx;
  const setJourIdx = useCallback((i: number) => setJour((j) => (j.idx === i ? j : { idx: i, dir: directionJour(j.idx, i) })), []);
  const pret = usePret();
  const restosRef = useRef<HTMLDivElement>(null);
  const restosCarte = RESTAURANTS.filter((r) => cartes.includes(r.slug));
  const [slug, setSlug] = useState(restosCarte[0]?.slug ?? "");
  const restoCarte = restosCarte.find((r) => r.slug === slug) ?? restosCarte[0];
  const [selection, setSelection] = useState<Selection>(null);

  // Changement de semaine : navigation client (la page reste, seul le contenu se recharge).
  // Pendant le chargement, la vue Jour affiche un squelette et la vue Semaine s'estompe.
  const router = useRouter();
  const [chargeSemaine, startSemaine] = useTransition();
  const allerSemaine = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const href = e.currentTarget.getAttribute("href")!;
    startSemaine(() => router.push(href));
  };
  // Nouvelle semaine reçue : on repart du jour par défaut, avec un slide dans le sens de la navigation.
  const lundi = semaine[0].date;
  const [lundiVu, setLundiVu] = useState(lundi);
  if (lundi !== lundiVu) {
    setLundiVu(lundi);
    setJour({ idx: defaultIdx, dir: lundi > lundiVu ? 1 : -1 });
    setSelection(null);
  }

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

  // La carte choisie défile dans la barre des restos (largeurs variables : pas de pastille glissante).
  const slugPrecedent = useRef(slug);
  useEffect(() => {
    if (slugPrecedent.current === slug) return;
    slugPrecedent.current = slug;
    const b = restosRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    b?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: reduit() ? "auto" : "smooth" });
  }, [slug]);

  const pdj = semaine[jourIdx];
  const vues = VUES.filter((v) => v.id !== "carte" || restosCarte.length > 0);
  const vueIdx = Math.max(0, vues.findIndex((v) => v.id === vue));
  const entree = decalageEntree(jour.dir);
  const attrPret = pret ? "" : undefined;

  const semaineNav = (
    <nav className={styles.semaineNav} aria-label="Changer de semaine">
      <Link href={prevHref} onClick={allerSemaine} aria-label="Semaine précédente"><Chevron sens="g" /></Link>
      {vue === "jour" && <span className={styles.semaineLabel}>{weekLabel}</span>}
      {!isCurrentWeek && <Link href="/" onClick={allerSemaine} className={styles.auj}>Aujourd&apos;hui</Link>}
      <Link href={nextHref} onClick={allerSemaine} aria-label="Semaine suivante"><Chevron sens="d" /></Link>
    </nav>
  );

  return (
    <div className={styles.root} aria-busy={chargeSemaine || undefined}>
      <div
        className={styles.vues}
        role="group"
        aria-label="Vue"
        data-pret={attrPret}
        style={{ "--idx": vueIdx, "--n": vues.length } as CSSProperties}
      >
        {vues.map((v) => (
          <button key={v.id} type="button" aria-pressed={vue === v.id} onClick={() => setVue(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      {vue === "jour" && pdj && (
        <>
          <div key="vue-jour" className={styles.vueEntre}>
            <div className={styles.titre}>
              <h1 key={pdj.date} className={styles.fondu}>
                {formatDateShort(pdj.date)}
                {pdj.date > today && <span className={styles.apercu}>Aperçu</span>}
              </h1>
              {semaineNav}
            </div>
          </div>
          {/* Le dock (sticky) reste hors des enveloppes animées : un translate casserait son ancrage. */}
          <div className={styles.dock}>
            <div
              className={styles.jours}
              data-charge={chargeSemaine ? "" : undefined}
              role="group"
              aria-label="Jour"
              data-pret={attrPret}
              style={{ "--idx": jourIdx, "--n": semaine.length } as CSSProperties}
            >
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
          <div className={styles.jourCadre}>
            <div
              key={pdj.date}
              className={styles.jourEntre}
              style={{ "--dx": `${entree.dx}px`, "--dy": `${entree.dy}px` } as CSSProperties}
            >
              {chargeSemaine ? <GrilleSquelette /> : <JourVue pdj={pdj} mode={mode} images={images} onOpen={setSelection} />}
            </div>
          </div>
        </>
      )}

      {vue === "semaine" && (
        <div key="vue-semaine" className={`${styles.vueEntre} ${styles.pile}`} data-charge={chargeSemaine ? "" : undefined}>
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
              setJour({ idx: i, dir: 0 });
              setVue("jour");
            }}
            onOpen={setSelection}
          />
        </div>
      )}

      {vue === "carte" && restoCarte && (
        <div key="vue-carte" className={`${styles.vueEntre} ${styles.pile}`}>
          <div className={styles.titre}>
            <h1 key={slug} className={`${styles.titreResto} ${styles.fondu}`}>
              <RestoBadge nom={restoCarte.nom} variante="icone" taille={30} />
              {titreCarte(restoCarte)}
            </h1>
          </div>
          <div className={styles.carteBarre}>
            <div className={styles.restos} role="group" aria-label="Restaurant" ref={restosRef}>
              {restosCarte.map((r) => (
                <button
                  key={r.slug}
                  type="button"
                  aria-pressed={r.slug === slug}
                  onClick={(e) => {
                    if (r.slug === slug) popper(e.currentTarget);
                    setSlug(r.slug);
                  }}
                >
                  <RestoBadge nom={r.nom} complet />
                </button>
              ))}
            </div>
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
          <CarteVue slug={slug} mode={mode} />
        </div>
      )}

      {selection && (
        <DetailPanneau
          key={`${selection.kind}|${selection.date}|${selection.kind === "plat" ? `${selection.platIndex}|${selection.variante}` : selection.nom}`}
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
