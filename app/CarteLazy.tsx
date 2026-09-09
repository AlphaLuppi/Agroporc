"use client";

import { useEffect, useState, type SyntheticEvent } from "react";
import type { Carte } from "@/lib/db";
import CarteRestaurant from "./CarteRestaurant";

type Etat =
  | { statut: "idle" }
  | { statut: "chargement" }
  | { statut: "erreur" }
  | { statut: "ok"; carte: Carte };

interface Props {
  slug: string;
  /** « La carte du Bistrot Trèfle »… (affiché en mode non compact). */
  titre: string;
  /** SVG inline de l'icône du resto (getIcon), affiché en mode non compact. */
  icon: string;
  evaluatedAt: string | null;
  /** compact : résumé « Voir la carte » dans une card ; sinon en-tête pleine largeur (onglet). */
  compact?: boolean;
}

/** Dépliant qui va chercher la carte (`/api/carte?slug=`) au premier dépliage. */
export default function CarteLazy({ slug, titre, icon, evaluatedAt, compact = false }: Props) {
  const [etat, setEtat] = useState<Etat>({ statut: "idle" });

  // Les nœuds insérés après coup doivent recevoir le mode courant (Sportif/Goulaf) et le tri.
  useEffect(() => {
    if (etat.statut === "ok") window.dispatchEvent(new Event("pdj:mode-refresh"));
  }, [etat.statut]);

  const charger = async () => {
    setEtat({ statut: "chargement" });
    try {
      const res = await fetch(`/api/carte?slug=${encodeURIComponent(slug)}`);
      const carte = res.ok ? ((await res.json()) as Carte | null) : null;
      setEtat(carte ? { statut: "ok", carte } : { statut: "erreur" });
    } catch {
      setEtat({ statut: "erreur" });
    }
  };

  const onToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    if (e.currentTarget.open && (etat.statut === "idle" || etat.statut === "erreur")) void charger();
  };

  const evalDate = evaluatedAt
    ? new Date(evaluatedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;

  const chevron = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="carte-chevron w-4 h-4 shrink-0">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  return (
    <details
      onToggle={onToggle}
      className={
        compact
          ? "mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-accent)]"
          : "mb-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
      }
    >
      <summary className="carte-summary flex items-center justify-between gap-3 px-4 py-3 cursor-pointer rounded-[var(--radius)]">
        {compact ? (
          <span className="text-sm font-semibold text-[var(--accent)]">Voir la carte</span>
        ) : (
          <span className="flex items-center gap-2 text-lg font-bold tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
            <span dangerouslySetInnerHTML={{ __html: icon }} />
            {titre}
          </span>
        )}
        <span className="flex items-center gap-2 text-[var(--text-muted)] text-xs">
          {evalDate && <span className="hidden sm:inline">notée le {evalDate}</span>}
          {chevron}
        </span>
      </summary>
      <div className="px-4 pb-4 pt-1">
        {etat.statut === "chargement" && (
          <p className="text-sm text-[var(--text-muted)] italic py-2">Chargement de la carte…</p>
        )}
        {etat.statut === "erreur" && (
          <p className="text-sm text-[var(--bad)] py-2">Carte indisponible pour le moment.</p>
        )}
        {etat.statut === "ok" && <CarteRestaurant carte={etat.carte} />}
      </div>
    </details>
  );
}
