import { useEffect, useRef, useState, type CSSProperties } from "react";
import { MODE_LABEL, type Mode } from "@/lib/carte-tri";
import { etincelles } from "@/lib/motion-menus";
import { fmtNote, noteClass } from "@/lib/format";
import { getRestaurantLinks, type RestaurantLink } from "@/lib/icons";
import { compter, ecrireTexte, estPret, popper, reduit, RESSORT, usePret, volerVersPanier } from "./motion";
import styles from "./menus.module.css";

// Déplacé dans lib/carte-tri.ts (partagé avec la banque de recettes) ; réexporté pour les imports existants.
export { MODE_LABEL };

/** Classe de couleur d'une note (mêmes seuils que `noteClass`), neutre sans note. */
export function couleur(note?: number): string {
  return note == null ? styles.none : styles[noteClass(note)];
}

// Déplacé dans lib/format.ts (utilisable par les pages serveur) ; réexporté pour les imports existants.
export { fmtNote };

/** « 11.9€ » → « 11,90 € » ; renvoie la chaîne telle quelle si elle n'est pas un prix simple. */
export function fmtPrix(prix?: string): string {
  if (!prix) return "";
  const m = prix.replace(",", ".").match(/^\s*(\d+(?:\.\d+)?)\s*€?\s*$/);
  return m ? `${parseFloat(m[1]).toFixed(2).replace(".", ",")} €` : prix;
}

export function Pastille({ note }: { note?: number }) {
  return (
    <span className={`${styles.pastille} ${couleur(note)}`}>
      {fmtNote(note)}
      <small>/10</small>
    </span>
  );
}

/**
 * Note qui « compte » jusqu'à sa nouvelle valeur quand elle change après le montage. Le rendu
 * React (et donc le HTML serveur) est toujours la valeur finale ; seul le nœud texte est animé.
 * `depuisZero` : compte de 0 à la note au montage (instances montées après un clic uniquement).
 */
export function NoteAnimee({ note, depuisZero = false }: { note?: number; depuisZero?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const precedente = useRef<number | undefined>(note);
  const premier = useRef(true);
  useEffect(() => {
    const el = ref.current;
    const de = premier.current ? (depuisZero ? 0 : undefined) : precedente.current;
    premier.current = false;
    precedente.current = note;
    if (!el) return;
    if (note == null || de == null || de === note || !estPret() || reduit()) {
      // Un count-up interrompu (StrictMode, changement rapide) ne doit jamais laisser une valeur intermédiaire.
      ecrireTexte(el, fmtNote(note));
      return;
    }
    return compter(el, de, note, fmtNote(note));
    // depuisZero n'est lu qu'au montage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);
  return <span ref={ref}>{fmtNote(note)}</span>;
}

/**
 * Pastille dont la note compte et qui fait un pop quand `cle` change (reco qui change de plat ou
 * de mode). Même rendu que `Pastille` au premier passage.
 */
export function PastilleAnimee({ note, cle, depuisZero = false }: { note?: number; cle?: string; depuisZero?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const cleRef = useRef(cle);
  useEffect(() => {
    if (depuisZero && estPret()) popper(ref.current, 1.4);
    // montage seulement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (cleRef.current === cle) return;
    cleRef.current = cle;
    if (estPret()) popper(ref.current, 1.4);
  }, [cle]);
  return (
    <span ref={ref} className={`${styles.pastille} ${couleur(note)}`}>
      <NoteAnimee note={note} depuisZero={depuisZero} />
      <small>/10</small>
    </span>
  );
}

const HALTERE = (
  <>
    {/* Haltère : sans libellé (dock mobile), l'icône doit dire « sport » à elle seule. */}
    <path d="m6.5 6.5 11 11" />
    <path d="m21 21-1-1" />
    <path d="m3 3 1 1" />
    <path d="m18 22 4-4" />
    <path d="m2 6 4-4" />
    <path d="m3 10 7-7" />
    <path d="m14 21 7-7" />
  </>
);
const BURGER = (
  <>
    {/* Burger : la gourmandise. */}
    <path d="M12 16H4a2 2 0 1 1 0-4h16a2 2 0 1 1 0 4h-4.25" />
    <path d="M5 12a2 2 0 0 1-2-2 9 7 0 0 1 18 0 2 2 0 0 1-2 2" />
    <path d="M5 16a2 2 0 0 0-2 2 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 2 2 0 0 0-2-2" />
    <path d="m6.67 12 6.13 4.6a2 2 0 0 0 2.8-.4l3.15-4.2" />
  </>
);

/**
 * Switch Sportif / Goulaf : une pastille unique glisse sous les deux boutons (même largeur grâce
 * à la grille). `data-pret` n'est posé qu'après la relecture du stockage : pas de glissade au chargement.
 */
export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const pret = usePret();
  const icones = useRef<Record<Mode, SVGSVGElement | null>>({ sportif: null, goulaf: null });
  const precedent = useRef(mode);
  useEffect(() => {
    if (precedent.current === mode) return;
    precedent.current = mode;
    const svg = icones.current[mode];
    if (!svg || !estPret() || reduit()) return;
    svg.animate(
      [{ rotate: "0deg", scale: "1" }, { rotate: "-14deg", scale: "1.15", offset: 0.3 }, { rotate: "10deg", offset: 0.6 }, { rotate: "0deg", scale: "1" }],
      { duration: 300, easing: "ease-out" },
    );
  }, [mode]);
  const bouton = (m: Mode, label: string, dessin: React.ReactNode) => (
    <button type="button" aria-pressed={mode === m} aria-label={`Mode ${label.toLowerCase()}`} onClick={() => onChange(m)}>
      <svg
        ref={(el) => {
          icones.current[m] = el;
        }}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {dessin}
      </svg>
      <span>{label}</span>
    </button>
  );
  return (
    <div
      className={styles.mode}
      role="group"
      aria-label="Mode de notation"
      data-mode={mode}
      data-pret={pret ? "" : undefined}
      style={{ "--idx": mode === "goulaf" ? 1 : 0 } as CSSProperties}
    >
      {bouton("sportif", "Sportif", HALTERE)}
      {bouton("goulaf", "Goulaf", BURGER)}
    </div>
  );
}

function LinkIcon({ kind }: { kind: RestaurantLink["kind"] }) {
  if (kind === "facebook") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
        <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.45 2.89h-2.33v6.99A10 10 0 0 0 22 12z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

/** Liens de commande / réseaux d'un resto (repris de l'ancienne card). */
export function OrderLinks({ restaurant }: { restaurant: string }) {
  const links = getRestaurantLinks(restaurant);
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-accent)] text-[var(--accent)] hover:bg-[var(--accent-glow)] hover:border-[var(--border-accent)] transition-colors whitespace-nowrap tabular-nums"
        >
          <LinkIcon kind={link.kind} />
          {link.label}
        </a>
      ))}
    </div>
  );
}

const ETINCELLES = etincelles(8);

/**
 * Bouton « Ajouter » : le panier (ClientScripts) l'écoute par délégation sur `.add-to-cart-btn`
 * et remplace son texte pendant 1,2 s. Le feedback animé vit donc HORS du bouton : pop en WAAPI,
 * gerbe d'étincelles dans un span frère, pastille qui vole jusqu'au panier.
 */
export function AjouterButton({ restaurant, plat, prix, date }: { restaurant: string; plat: string; prix: string; date: string }) {
  const [rafale, setRafale] = useState(0);
  useEffect(() => {
    if (!rafale) return;
    const t = setTimeout(() => setRafale(0), 500);
    return () => clearTimeout(t);
  }, [rafale]);
  return (
    <span className={styles.ajouter}>
      <button
        type="button"
        className={`add-to-cart-btn ${styles.bouton}`}
        data-restaurant={restaurant}
        data-plat={plat}
        data-prix={prix}
        data-date={date}
        onClick={(e) => {
          if (reduit()) return;
          const btn = e.currentTarget;
          btn.animate([{ scale: "1" }, { scale: "1.12", offset: 0.35 }, { scale: "1" }], { duration: 300, easing: RESSORT });
          setRafale((r) => r + 1);
          volerVersPanier(btn);
        }}
      >
        + Ajouter
      </button>
      {rafale > 0 && (
        <span key={rafale} className={styles.etincelles} aria-hidden="true">
          {ETINCELLES.map((p, i) => (
            <i key={i} style={{ "--x": `${p.x}px`, "--y": `${p.y}px` } as CSSProperties} />
          ))}
        </span>
      )}
    </span>
  );
}
