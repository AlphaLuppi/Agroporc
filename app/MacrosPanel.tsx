"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { IngredientDetail } from "@/lib/db";
import { prefereMoinsDeMouvement, repartitionCalories, valeurCountUp } from "@/lib/motion-commentaires";
import styles from "./MacrosPanel.module.css";

const DUREE_COUNT_UP_MS = 500;

const sAbonner = () => () => {};
/**
 * Vrai si l'instance est montée après l'hydratation (panneau V2 ouvert au clic, CarteVue),
 * faux au rendu serveur et pendant l'hydratation (V1) : `getServerSnapshot` sert pendant
 * l'hydratation, `getSnapshot` pour un montage purement client. Figé au premier rendu par
 * l'appelant (useRef), donc ni mismatch ni flash sur le HTML SSR.
 */
function useMonteApresHydratation(): boolean {
  return useSyncExternalStore(
    sAbonner,
    () => true,
    () => false
  );
}

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
  // Animations (count-up, remplissage, cascade) seulement pour un montage client
  const monte = useMonteApresHydratation();
  const anime = useRef(monte).current;

  const cells = [
    { value: nutri?.calories ?? "?", label: "kcal", cible: nutri?.calories, suffixe: "" },
    { value: `${nutri?.proteines_g ?? "?"}g`, label: "Protéines", cible: nutri?.proteines_g, suffixe: "g" },
    { value: `${nutri?.glucides_g ?? "?"}g`, label: "Glucides", cible: nutri?.glucides_g, suffixe: "g" },
    { value: `${nutri?.lipides_g ?? "?"}g`, label: "Lipides", cible: nutri?.lipides_g, suffixe: "g" },
  ];

  // Count-up : React rend toujours la valeur finale ; on réécrit le nœud texte existant
  // (nodeValue, sans le remplacer) de 0 jusqu'à la cible, avant la première peinture.
  const valeursRef = useRef<(HTMLSpanElement | null)[]>([]);
  const ciblesRef = useRef(cells);
  ciblesRef.current = cells;
  useLayoutEffect(() => {
    if (!anime || prefereMoinsDeMouvement()) return;
    const ecrire = (t: number) => {
      ciblesRef.current.forEach((c, i) => {
        const noeud = valeursRef.current[i]?.firstChild;
        if (!noeud || noeud.nodeType !== Node.TEXT_NODE) return;
        if (typeof c.cible !== "number" || !Number.isFinite(c.cible)) return;
        noeud.nodeValue = `${valeurCountUp(c.cible, t)}${c.suffixe}`;
      });
    };
    ecrire(0);
    const debut = performance.now();
    let raf = requestAnimationFrame(function pas(maintenant) {
      const t = Math.min(1, (maintenant - debut) / DUREE_COUNT_UP_MS);
      ecrire(t);
      if (t < 1) raf = requestAnimationFrame(pas);
    });
    return () => {
      cancelAnimationFrame(raf);
      ecrire(1);
    };
  }, [anime]);

  const repartition = repartitionCalories(nutri?.proteines_g, nutri?.glucides_g, nutri?.lipides_g);
  const segments = repartition
    ? [
        { label: "Protéines", court: "P", pct: repartition.proteines, couleur: "var(--good)" },
        { label: "Glucides", court: "G", pct: repartition.glucides, couleur: "var(--ok)" },
        // --bad et pas --accent : sur les 3 thèmes, accent et --ok (glucides) sont deux ambres indiscernables.
        { label: "Lipides", court: "L", pct: repartition.lipides, couleur: "var(--bad)" },
      ]
    : [];

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        disabled={!hasDetail}
        aria-expanded={open}
        className={`w-full grid grid-cols-2 sm:grid-cols-4 gap-2 ${
          hasDetail ? `pdj-press ${styles.grilleActive} cursor-pointer` : "cursor-default"
        }`}
        title={hasDetail ? "Voir le détail des ingrédients" : undefined}
      >
        {cells.map((m, i) => (
          <div
            key={m.label}
            className={`${anime ? styles.cellule : ""} text-center py-2.5 px-1 bg-[var(--surface-accent)] rounded-[var(--radius-sm)] border border-[var(--border)]`}
            style={anime ? ({ "--i": i } as React.CSSProperties) : undefined}
          >
            <span
              ref={(el) => {
                valeursRef.current[i] = el;
              }}
              className="block font-bold text-base tabular-nums text-[var(--text)]"
            >
              {m.value}
            </span>
            <span className="block text-[0.7rem] text-[var(--text-muted)] uppercase tracking-wider mt-0.5">
              {m.label}
            </span>
          </div>
        ))}
      </button>

      {repartition && (
        <div
          className={`mt-2 ${anime ? styles.remplir : ""}`}
          role="img"
          aria-label={`Répartition des calories : ${segments.map((s) => `${s.label} ${s.pct} %`).join(", ")}`}
        >
          <div className={styles.barre} aria-hidden="true">
            {segments.map((s, i) =>
              s.pct > 0 ? (
                <span
                  key={s.court}
                  className={styles.segment}
                  style={{ flexGrow: s.pct, flexBasis: 0, background: s.couleur, "--i": i } as React.CSSProperties}
                />
              ) : null
            )}
          </div>
          <div
            className="mt-1 flex justify-center gap-3 text-[0.65rem] tabular-nums text-[var(--text-muted)]"
            aria-hidden="true"
          >
            {segments.map((s) => (
              <span key={s.court} title={s.label}>
                <span className={styles.pastille} style={{ background: s.couleur }} />
                {s.court} {s.pct} %
              </span>
            ))}
          </div>
        </div>
      )}

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
              <li key={i} className={`${styles.ligneDetail} py-2`} style={{ "--i": i } as React.CSSProperties}>
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
                <tr
                  key={i}
                  className={`${styles.ligneDetail} border-t border-[var(--border)]/50 align-top`}
                  style={{ "--i": i } as React.CSSProperties}
                >
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
