"use client";

import { VERSION_COOKIE, type VersionUi } from "@/lib/version-ui";

const UN_AN = 60 * 60 * 24 * 365;

/**
 * Switch V1 / V2 de la barre de navigation. Le choix part dans un cookie (lu au rendu serveur)
 * puis la page est rechargée : l'accueil V1 a besoin que ClientScripts se rebranche sur son DOM.
 */
export default function VersionSwitch({ version }: { version: VersionUi }) {
  const choisir = (v: VersionUi) => {
    if (v === version) return;
    document.cookie = `${VERSION_COOKIE}=${v}; path=/; max-age=${UN_AN}; samesite=lax`;
    window.location.reload();
  };

  return (
    <div
      role="group"
      aria-label="Version de l'affichage"
      title="Affichage : V1 = avant la refonte, V2 = nouvelle version"
      className="flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface)] p-[3px]"
    >
      {(["v1", "v2"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={version === v}
          onClick={() => choisir(v)}
          className={`min-h-7 rounded-full px-2.5 text-xs font-bold uppercase transition-colors cursor-pointer ${
            version === v ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
