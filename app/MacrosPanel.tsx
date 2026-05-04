"use client";

import { useState } from "react";
import type { IngredientDetail } from "@/lib/db";

interface Nutrition {
  calories: number;
  proteines_g: number;
  glucides_g: number;
  lipides_g: number;
}

export default function MacrosPanel({
  nutri,
  ingredients,
  source,
}: {
  nutri?: Nutrition;
  ingredients?: IngredientDetail[];
  source?: "ciqual" | "llm";
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = (ingredients?.length ?? 0) > 0;

  const cells = [
    { value: nutri?.calories ?? "?", label: "kcal" },
    { value: `${nutri?.proteines_g ?? "?"}g`, label: "Protéines" },
    { value: `${nutri?.glucides_g ?? "?"}g`, label: "Glucides" },
    { value: `${nutri?.lipides_g ?? "?"}g`, label: "Lipides" },
  ];

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        disabled={!hasDetail}
        aria-expanded={open}
        className={`w-full grid grid-cols-2 sm:grid-cols-4 gap-2 ${
          hasDetail
            ? "cursor-pointer hover:opacity-90 transition-opacity"
            : "cursor-default"
        }`}
        title={hasDetail ? "Voir le détail des ingrédients" : undefined}
      >
        {cells.map((m) => (
          <div
            key={m.label}
            className="text-center py-2.5 px-1 bg-[var(--surface-accent)] rounded-[var(--radius-sm)] border border-[var(--border)]"
          >
            <span className="block font-bold text-base tabular-nums text-[var(--text)]">
              {m.value}
            </span>
            <span className="block text-[0.7rem] text-[var(--text-muted)] uppercase tracking-wider mt-0.5">
              {m.label}
            </span>
          </div>
        ))}
      </button>

      {hasDetail && open && (
        <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-accent)] p-3 text-xs animate-[reply-slide-in_0.2s_ease-out]">
          <div className="flex items-center justify-between mb-2 gap-2">
            <span className="font-semibold text-[var(--text-secondary)] uppercase tracking-wider text-[0.65rem]">
              Composition estimée
            </span>
            <span className="text-[var(--text-muted)] text-[0.65rem] text-right">
              {source === "ciqual" ? "via table Ciqual" : "estimation IA"}
            </span>
          </div>

          {/* Mobile : liste empilée, plus lisible que 6 colonnes serrées */}
          <ul className="sm:hidden divide-y divide-[var(--border)]/50">
            {ingredients!.map((ing, i) => (
              <li key={i} className="py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[var(--text)] font-medium break-words min-w-0">
                    {ing.nom_query}
                  </span>
                  <span className="tabular-nums text-[var(--text-secondary)] whitespace-nowrap text-[0.7rem]">
                    {Math.round(ing.grammes)}g · {Math.round(ing.kcal)} kcal
                  </span>
                </div>
                {ing.matched_nom ? (
                  <span className="block text-[0.65rem] text-[var(--text-muted)] break-words">
                    ↳ {ing.matched_nom}
                  </span>
                ) : (
                  <span className="block text-[0.65rem] text-[var(--bad,_#c44)] italic">
                    ↳ non trouvé
                  </span>
                )}
                <div className="mt-1 flex gap-3 text-[0.65rem] tabular-nums text-[var(--text-muted)]">
                  <span>P {ing.prot.toFixed(1)}</span>
                  <span>G {ing.gluc.toFixed(1)}</span>
                  <span>L {ing.lip.toFixed(1)}</span>
                </div>
              </li>
            ))}
          </ul>

          {/* ≥ sm : tableau compact */}
          <table className="hidden sm:table w-full table-fixed">
            <thead>
              <tr className="text-[var(--text-muted)] text-[0.65rem] uppercase tracking-wider">
                <th className="text-left font-medium pb-1">Ingrédient</th>
                <th className="text-right font-medium pb-1 w-12">g</th>
                <th className="text-right font-medium pb-1 w-14">kcal</th>
                <th className="text-right font-medium pb-1 w-10">P</th>
                <th className="text-right font-medium pb-1 w-10">G</th>
                <th className="text-right font-medium pb-1 w-10">L</th>
              </tr>
            </thead>
            <tbody>
              {ingredients!.map((ing, i) => (
                <tr key={i} className="border-t border-[var(--border)]/50 align-top">
                  <td className="py-1 pr-2 min-w-0">
                    <span className="text-[var(--text)] break-words">{ing.nom_query}</span>
                    {ing.matched_nom ? (
                      <span className="block text-[0.65rem] text-[var(--text-muted)] break-words">
                        ↳ {ing.matched_nom}
                      </span>
                    ) : (
                      <span className="block text-[0.65rem] text-[var(--bad,_#c44)] italic">
                        ↳ non trouvé
                      </span>
                    )}
                  </td>
                  <td className="text-right tabular-nums text-[var(--text-secondary)] py-1">{Math.round(ing.grammes)}</td>
                  <td className="text-right tabular-nums text-[var(--text-secondary)] py-1">{Math.round(ing.kcal)}</td>
                  <td className="text-right tabular-nums text-[var(--text-secondary)] py-1">{ing.prot.toFixed(1)}</td>
                  <td className="text-right tabular-nums text-[var(--text-secondary)] py-1">{ing.gluc.toFixed(1)}</td>
                  <td className="text-right tabular-nums text-[var(--text-secondary)] py-1">{ing.lip.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
