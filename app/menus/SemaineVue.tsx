"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { PdjEntry } from "@/lib/db";
import type { Mode } from "@/lib/carte-tri";
import { formatDateShort, formatDayShort } from "@/lib/format";
import { casseLisible, grilleSemaine, meilleureNoteDuJour, platsAffiches, restosAbsentsSemaine, type PlatAffiche } from "@/lib/menus-vue";
import RestoBadge from "@/app/components/RestoBadge";
import type { Selection } from "./DetailPanneau";
import { rangStagger } from "@/lib/motion-menus";
import { couleur, fmtPrix, MODE_LABEL, PastilleAnimee } from "./ui";
import { reduit } from "./motion";
import styles from "./menus.module.css";

interface Props {
  semaine: PdjEntry[];
  mode: Mode;
  today: string;
  jourIdx: number;
  setJourIdx: (i: number) => void;
  /** Clic sur un en-tête de jour (desktop) : bascule sur la vue Jour de ce jour-là. */
  voirJour: (i: number) => void;
  onOpen: (s: Selection) => void;
}

const numeroJour = (iso: string) => new Date(iso + "T12:00:00").getDate();

function statutJour(pdj: PdjEntry): string | null {
  if (pdj.ferie) return `Férié · ${pdj.ferie}`;
  if (pdj.erreur) return pdj.erreur;
  return null;
}

/**
 * Vue Semaine. Desktop : grille restaurants × jours. Mobile : carte de chaleur (une case par
 * resto et par jour, couleur = note) qui sert de navigation, et un swipe d'un jour à l'autre.
 */
export default function SemaineVue({ semaine, mode, today, jourIdx, setJourIdx, voirJour, onOpen }: Props) {
  const grille = grilleSemaine(semaine, mode);
  const absents = restosAbsentsSemaine(semaine);
  const meilleures = semaine.map((pdj) => meilleureNoteDuJour(pdj, mode));
  const ouvrir = (date: string, p: PlatAffiche) => () => onOpen({ kind: "plat", date, platIndex: p.platIndex, variante: p.variante.plat });

  // Swipe mobile : la page visible suit le jour choisi, et un swipe change le jour choisi.
  const pagesRef = useRef<HTMLDivElement>(null);
  const premierRendu = useRef(true);
  useEffect(() => {
    const el = pagesRef.current;
    if (!el || el.clientWidth === 0) return;
    const cible = jourIdx * el.clientWidth;
    // À l'ouverture de la vue, on se place directement sur le jour choisi, sans animation.
    if (Math.abs(el.scrollLeft - cible) > 4) el.scrollTo({ left: cible, behavior: premierRendu.current || reduit() ? "auto" : "smooth" });
    premierRendu.current = false;
  }, [jourIdx]);
  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (el.clientWidth === 0) return;
        const i = Math.round(el.scrollLeft / el.clientWidth);
        if (i >= 0 && i < semaine.length) setJourIdx(i);
      }, 120);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(t);
      el.removeEventListener("scroll", onScroll);
    };
  }, [semaine.length, setJourIdx]);

  return (
    <>
      {/* ── Desktop ── */}
      <div className={`${styles.table} ${styles.large1180}`} data-mode={mode}>
        <div className={styles.th}>Restaurant</div>
        {semaine.map((pdj, i) => (
          <button
            key={pdj.date}
            type="button"
            style={{ "--i": i } as CSSProperties}
            className={`${styles.th} ${pdj.date === today ? styles.auj : ""}`}
            onClick={() => voirJour(i)}
            title="Voir ce jour"
          >
            <span>{formatDayShort(pdj.date)} {numeroJour(pdj.date)}{pdj.date === today ? " · auj." : ""}</span>
            <span className={`${styles.point} ${couleur(meilleures[i])}`} style={{ background: "currentColor", marginTop: 0 }} />
          </button>
        ))}
        {grille.map((ligne) => {
          const prix = ligne.cases.flat()[0]?.plat.prix;
          return [
            <div key={ligne.resto.slug} className={styles.rh}>
              <RestoBadge nom={ligne.resto.nom} variante="picto" taille={18} className={styles.rhPicto} />
              <span>{ligne.resto.nom}</span>
              {prix && <small>{fmtPrix(prix)}</small>}
            </div>,
            ...ligne.cases.map((plats, i) => {
              const pdj = semaine[i];
              const statut = statutJour(pdj);
              return (
                <div
                  key={`${ligne.resto.slug}-${pdj.date}`}
                  className={`${styles.cellule} ${pdj.date === today ? styles.aujC : ""}`}
                  style={{ "--i": i } as CSSProperties}
                >
                  {plats.length === 0 ? (
                    <span className={styles.celluleVide}>{statut ? (pdj.ferie ? "Férié" : "–") : "Pas de plat"}</span>
                  ) : (
                    plats.map((p) => (
                      <button
                        key={p.variante.plat}
                        type="button"
                        className={p.note != null && p.note === meilleures[i] ? styles.meilleure : undefined}
                        onClick={ouvrir(pdj.date, p)}
                      >
                        <PastilleAnimee note={p.note} />
                        <span>{casseLisible(p.variante.plat)}</span>
                      </button>
                    ))
                  )}
                </div>
              );
            }),
          ];
        })}
      </div>

      {/* ── Mobile ── */}
      <div className={styles.chaleur}>
        <div className={styles.chaleurGrille}>
          <span />
          {semaine.map((pdj, i) => (
            <button key={pdj.date} type="button" className={styles.tete} aria-pressed={i === jourIdx} onClick={() => setJourIdx(i)}>
              {formatDayShort(pdj.date).replace(".", "")} <b>{numeroJour(pdj.date)}</b>
            </button>
          ))}
          {grille.map((ligne, l) => [
            <RestoBadge key={ligne.resto.slug} nom={ligne.resto.nom} className={styles.ligneNom} />,
            ...ligne.cases.map((plats, i) => (
              <button
                key={`${ligne.resto.slug}-${i}`}
                type="button"
                style={{ "--i": l + i } as CSSProperties}
                className={`${styles.case} ${plats[0] ? couleur(plats[0].note) : ""} ${i === jourIdx ? styles.colonne : ""}`}
                onClick={() => setJourIdx(i)}
                aria-label={`${ligne.resto.nom}, ${formatDateShort(semaine[i].date)} : ${plats[0] ? `${plats[0].note ?? "?"} sur 10` : "pas de plat"}`}
              />
            )),
          ])}
        </div>
        <span className={styles.meta}>Couleur = meilleure note {MODE_LABEL[mode]} du resto ce jour-là. Touche une colonne ou swipe.</span>

        <div className={styles.pages} ref={pagesRef}>
          {semaine.map((pdj, j) => {
            const plats = platsAffiches(pdj, mode);
            const statut = statutJour(pdj);
            return (
              <section
                key={pdj.date}
                className={`${styles.page} ${j === jourIdx ? styles.pageActive : ""}`}
                aria-label={formatDateShort(pdj.date)}
              >
                <h2>
                  {formatDateShort(pdj.date)}
                  <span>{pdj.date === today ? "aujourd'hui" : ""}</span>
                </h2>
                {statut && <p className={styles.vide}>{statut}</p>}
                {!statut && plats.length === 0 && <p className={styles.vide}>Plats dévoilés le matin même.</p>}
                {plats.map((p, k) => (
                  <button
                    key={`${p.platIndex}::${p.variante.plat}`}
                    type="button"
                    className={styles.ligne}
                    style={{ "--i": rangStagger(k + 1) } as CSSProperties}
                    onClick={ouvrir(pdj.date, p)}
                  >
                    <PastilleAnimee note={p.note} />
                    <span className={styles.ligneTexte}>
                      <span className={styles.nom}>
                        {casseLisible(p.variante.plat)} {p.reco && <span className={styles.tagReco}>Reco</span>}
                      </span>
                      <span className={styles.meta}>
                        <RestoBadge nom={p.plat.restaurant} complet /> · <b>{fmtPrix(p.plat.prix)}</b>
                      </span>
                    </span>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      </div>

      {absents.length > 0 && (
        <p className={styles.meta}>
          Aucun plat du jour cette semaine :{" "}
          {absents.map((r, i) => (
            <span key={r.slug}>
              {i > 0 && ", "}
              <RestoBadge nom={r.nom} complet />
            </span>
          ))}
          .
        </p>
      )}
    </>
  );
}
