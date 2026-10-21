"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { Carte, CartePlat } from "@/lib/db";
import { noteMode, trierCarte, type Mode } from "@/lib/carte-tri";
import { casseLisible } from "@/lib/menus-vue";
import MacrosPanel from "../MacrosPanel";
import { rangStagger } from "@/lib/motion-menus";
import { couleur, fmtPrix, NoteAnimee, PartBudget } from "./ui";
import styles from "./menus.module.css";

/** Cartes déjà chargées pendant la visite : un seul fetch par resto, retentable en cas d'échec. */
const cache = new Map<string, Promise<Carte | null>>();

function chargerCarte(slug: string): Promise<Carte | null> {
  let p = cache.get(slug);
  if (!p) {
    p = fetch(`/api/carte?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Carte | null>) : null))
      .catch(() => null);
    cache.set(slug, p);
    void p.then((c) => {
      if (c === null) cache.delete(slug);
    });
  }
  return p;
}

function PlatCarte({ p, mode }: { p: CartePlat; mode: Mode }) {
  const [ouvert, setOuvert] = useState(false);
  const note = noteMode(p, mode);
  const justification = mode === "goulaf" ? p.justification_goulaf || p.justification : p.justification;
  return (
    <div className={styles.plat}>
      <button type="button" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)}>
        <span className={styles.platNom}>{casseLisible(p.plat)}</span>
        <span className={styles.platPrix}>{fmtPrix(p.prix)}<PartBudget prix={p.prix} /></span>
        <span className={`${styles.platNote} ${couleur(note)}`}>
          <NoteAnimee note={note} />
        </span>
      </button>
      {ouvert && (
        <div className={styles.platDetail}>
          {justification && <p className={styles.texte}>{justification}</p>}
          <MacrosPanel nutri={p.nutrition_estimee} ingredients={p.ingredients_detail} source={p.nutrition_source} />
        </div>
      )}
    </div>
  );
}

/** Vue La carte : la carte permanente d'un resto, sections et plats triés par note du mode. */
export default function CarteVue({ slug, mode }: { slug: string; mode: Mode }) {
  // undefined = chargement, null = indisponible
  const [carte, setCarte] = useState<Carte | null | undefined>(undefined);

  useEffect(() => {
    let annule = false;
    setCarte(undefined);
    chargerCarte(slug).then((c) => {
      if (!annule) setCarte(c);
    });
    return () => {
      annule = true;
    };
  }, [slug]);

  if (carte === undefined) {
    return (
      <div className={styles.carte} aria-busy="true">
        <p className="sr-only" aria-live="polite">Chargement de la carte…</p>
        {[5, 3, 4, 2].map((n, s) => (
          <div key={s} className={styles.squelette} aria-hidden="true">
            <span className={styles.squeletteTitre} />
            {Array.from({ length: n }, (_, i) => (
              <span key={i} className={styles.squeletteLigne} style={{ "--w": `${88 - ((i * 17 + s * 11) % 34)}%` } as CSSProperties} />
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (carte === null) return <p className={styles.vide}>Carte indisponible pour le moment.</p>;

  const noteeLe = carte.evaluated_at
    ? new Date(carte.evaluated_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <>
      <div className={styles.carte}>
        {trierCarte(carte, mode).map((sec, i) => (
          <section key={sec.nom} className={styles.section} style={{ "--i": rangStagger(i) } as CSSProperties}>
            <h2>
              {casseLisible(sec.nom)}
              <span>{sec.plats.length}</span>
            </h2>
            {sec.plats.map((p, i) => (
              <PlatCarte key={`${sec.nom}::${p.plat ?? i}`} p={p} mode={mode} />
            ))}
          </section>
        ))}
      </div>
      {noteeLe && <p className={styles.meta}>Carte notée le {noteeLe}. Touche un plat pour voir l&apos;avis et les macros.</p>}
    </>
  );
}
