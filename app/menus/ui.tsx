import type { Mode } from "@/lib/carte-tri";
import { noteClass } from "@/lib/format";
import { getRestaurantLinks, type RestaurantLink } from "@/lib/icons";
import styles from "./menus.module.css";

export const MODE_LABEL: Record<Mode, string> = { sportif: "Sportif", goulaf: "Goulaf" };

/** Classe de couleur d'une note (mêmes seuils que `noteClass`), neutre sans note. */
export function couleur(note?: number): string {
  return note == null ? styles.none : styles[noteClass(note)];
}

export function fmtNote(note?: number): string {
  if (note == null) return "?";
  return Number.isInteger(note) ? String(note) : note.toFixed(1).replace(".", ",");
}

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

export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className={styles.mode} role="group" aria-label="Mode de notation">
      <button type="button" aria-pressed={mode === "sportif"} aria-label="Mode sportif" onClick={() => onChange("sportif")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {/* Haltère : sans libellé (dock mobile), l'icône doit dire « sport » à elle seule. */}
          <path d="m6.5 6.5 11 11" />
          <path d="m21 21-1-1" />
          <path d="m3 3 1 1" />
          <path d="m18 22 4-4" />
          <path d="m2 6 4-4" />
          <path d="m3 10 7-7" />
          <path d="m14 21 7-7" />
        </svg>
        <span>Sportif</span>
      </button>
      <button type="button" aria-pressed={mode === "goulaf"} aria-label="Mode goulaf" onClick={() => onChange("goulaf")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {/* Burger : la gourmandise. */}
          <path d="M12 16H4a2 2 0 1 1 0-4h16a2 2 0 1 1 0 4h-4.25" />
          <path d="M5 12a2 2 0 0 1-2-2 9 7 0 0 1 18 0 2 2 0 0 1-2 2" />
          <path d="M5 16a2 2 0 0 0-2 2 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 2 2 0 0 0-2-2" />
          <path d="m6.67 12 6.13 4.6a2 2 0 0 0 2.8-.4l3.15-4.2" />
        </svg>
        <span>Goulaf</span>
      </button>
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

/** Bouton « Ajouter » : le panier (ClientScripts) l'écoute par délégation sur `.add-to-cart-btn`. */
export function AjouterButton({ restaurant, plat, prix, date }: { restaurant: string; plat: string; prix: string; date: string }) {
  return (
    <button
      type="button"
      className={`add-to-cart-btn ${styles.bouton}`}
      data-restaurant={restaurant}
      data-plat={plat}
      data-prix={prix}
      data-date={date}
    >
      + Ajouter
    </button>
  );
}
