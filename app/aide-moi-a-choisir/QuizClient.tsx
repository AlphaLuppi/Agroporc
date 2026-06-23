"use client";

import { useState } from "react";
import { resoudreFeuille, type QuizNode, type QuizLeaf } from "@/lib/quiz-tree";
import { type PoolPlat, type Mode } from "@/lib/quiz-plats";
import { choisirDessert, type DessertConnu, type SaveurDessert, type Lourdeur } from "@/lib/desserts";

interface Choix {
  key: string;
  label: string;
  emoji: string;
}

const bouton =
  "group flex w-full items-center gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-5 py-4 text-left text-[1.0625rem] font-medium text-[var(--text)] min-h-[60px] cursor-pointer " +
  "transition-[transform,background-color,border-color] duration-150 ease-out " +
  "hover:border-[var(--border-accent)] hover:bg-[var(--surface-hover)] active:scale-[0.98] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg,transparent)]";

const pastille =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-accent)] text-2xl transition-transform duration-150 ease-out group-hover:scale-110";

function Question({
  titre,
  choix,
  onPick,
}: {
  titre: string;
  choix: Choix[];
  onPick: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-heading)" }}>
        {titre}
      </h2>
      <div className="flex flex-col gap-3">
        {choix.map((c) => (
          <button key={c.key} className={bouton} onClick={() => onPick(c.key)}>
            <span className={pastille} aria-hidden>
              {c.emoji}
            </span>
            <span className="flex-1">{c.label}</span>
            <span className="text-[var(--text-muted)] transition-transform duration-150 ease-out group-hover:translate-x-0.5">
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Progression({ etape }: { etape: number }) {
  return (
    <div className="mb-5 flex items-center gap-2" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <span
          key={i}
          className="h-1.5 flex-1 rounded-full transition-colors duration-200"
          style={{ backgroundColor: i < etape ? "var(--accent)" : "var(--border)" }}
        />
      ))}
    </div>
  );
}

export default function QuizClient({
  tree,
  desserts,
  hasJour,
}: {
  tree: QuizNode;
  desserts: DessertConnu[];
  hasJour: boolean;
}) {
  const [mode, setMode] = useState<Mode>();
  const [menu, setMenu] = useState<"plat" | "menu">();
  const [node, setNode] = useState<QuizNode>(tree);
  const [leaf, setLeaf] = useState<QuizLeaf>();
  const [saveur, setSaveur] = useState<SaveurDessert>();
  const [saveurAsked, setSaveurAsked] = useState(false);
  const [lourdeur, setLourdeur] = useState<Lourdeur>();
  const [lourdeurAsked, setLourdeurAsked] = useState(false);

  const reset = () => {
    setMode(undefined);
    setMenu(undefined);
    setNode(tree);
    setLeaf(undefined);
    setSaveur(undefined);
    setSaveurAsked(false);
    setLourdeur(undefined);
    setLourdeurAsked(false);
  };

  const descendre = (next: QuizNode) => {
    if (next.kind === "leaf") setLeaf(next);
    else setNode(next);
  };

  // Étape courante (pour la barre de progression).
  const etape = !mode ? 0 : !menu ? 1 : !leaf ? 2 : 3;

  function render() {
    if (!mode) {
      return (
        <Question
          titre="Tu manges plutôt malin ou plaisir aujourd'hui ?"
          choix={[
            { key: "sportif", label: "Sportif (équilibré)", emoji: "🥗" },
            { key: "goulaf", label: "Goulaf (plaisir)", emoji: "😋" },
          ]}
          onPick={(k) => setMode(k as Mode)}
        />
      );
    }

    if (!menu) {
      return (
        <Question
          titre="Tu veux juste un plat, ou un plat + un dessert ?"
          choix={[
            { key: "plat", label: "Un plat seul", emoji: "🍽️" },
            { key: "menu", label: "Un plat + un dessert", emoji: "🍰" },
          ]}
          onPick={(k) => setMenu(k as "plat" | "menu")}
        />
      );
    }

    // Parcours de l'arbre des plats.
    if (!leaf) {
      if (node.kind === "leaf") {
        setLeaf(node);
        return null;
      }
      return (
        <Question
          titre={node.titre}
          choix={node.options.map((o, i) => ({ key: String(i), label: o.label, emoji: o.emoji }))}
          onPick={(k) => descendre(node.options[Number(k)].node)}
        />
      );
    }

    // Branche dessert.
    if (menu === "menu" && !saveurAsked) {
      return (
        <Question
          titre="Côté dessert, tu pars sur quoi ?"
          choix={[
            { key: "fruite", label: "Fruité", emoji: "🍓" },
            { key: "chocolate", label: "Chocolaté", emoji: "🍫" },
            { key: "creme_lacte", label: "Crémeux / lacté", emoji: "🥛" },
            { key: "patissier", label: "Pâtissier", emoji: "🥧" },
            { key: "peu_importe", label: "Peu importe", emoji: "🤷" },
          ]}
          onPick={(k) => {
            setSaveur(k === "peu_importe" ? undefined : (k as SaveurDessert));
            setSaveurAsked(true);
          }}
        />
      );
    }

    if (menu === "menu" && !lourdeurAsked) {
      return (
        <Question
          titre="Léger ou bien gourmand ?"
          choix={[
            { key: "leger", label: "Léger", emoji: "🍃" },
            { key: "gourmand", label: "Gourmand", emoji: "🤤" },
            { key: "peu_importe", label: "Peu importe", emoji: "🤷" },
          ]}
          onPick={(k) => {
            setLourdeur(k === "peu_importe" ? undefined : (k as Lourdeur));
            setLourdeurAsked(true);
          }}
        />
      );
    }

    const plat = resoudreFeuille(leaf, mode);
    const dessert =
      menu === "menu" ? choisirDessert(desserts, { saveur, lourdeur }) : null;

    return <Resultat mode={mode} plat={plat} menu={menu} dessert={dessert} onReset={reset} />;
  }

  return (
    <div className="mx-auto max-w-[520px]">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--accent)]" style={{ fontFamily: "var(--font-heading)" }}>
          Aide-moi à choisir
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Quelques questions, et on te trouve le plat idéal du jour.
        </p>
        {!hasJour && (
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            (Pas encore de plats du jour publiés — on cherche dans les cartes.)
          </p>
        )}
      </header>
      {etape < 3 && <Progression etape={etape} />}
      {render()}
    </div>
  );
}

function Resultat({
  mode,
  plat,
  menu,
  dessert,
  onReset,
}: {
  mode: Mode;
  plat: PoolPlat | null;
  menu: "plat" | "menu";
  dessert: DessertConnu | null;
  onReset: () => void;
}) {
  const note = plat ? (mode === "sportif" ? plat.note : plat.note_goulaf) : undefined;
  const justif = plat
    ? mode === "sportif"
      ? plat.justification
      : plat.justification_goulaf
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-heading)" }}>
        Ton plat idéal aujourd'hui
      </h2>

      {plat ? (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-start justify-between gap-3">
            <span className="text-lg font-bold text-[var(--text)]">{plat.plat}</span>
            {typeof note === "number" && (
              <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--accent)]">{note}/10</span>
            )}
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            {plat.restaurant} · {plat.prix}
          </div>
          {justif && <p className="mt-3 text-sm text-[var(--text-secondary)]">{justif}</p>}
        </div>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">
          Aucun plat trouvé aujourd'hui. Reviens un peu plus tard !
        </p>
      )}

      {menu === "menu" && (
        <>
          <h2 className="mt-2 text-xl font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-heading)" }}>
            …et le dessert
          </h2>
          {dessert ? (
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="text-lg font-bold text-[var(--text)]">{dessert.nom}</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">{dessert.restaurant}</div>
              <div className="mt-3 text-xs text-[var(--text-secondary)]">
                ≈ {dessert.proba}% de chances de l'avoir aujourd'hui
                {dessert.proba < 100 && " — à vérifier sur place"}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">
              Pas de dessert correspondant dans nos infos.
            </p>
          )}
        </>
      )}

      <button
        className="mt-2 inline-flex min-h-[52px] items-center justify-center gap-2 self-start rounded-[var(--radius)] bg-[var(--accent)] px-6 text-base font-semibold text-[var(--accent-text)] transition-[transform,filter] duration-150 ease-out hover:brightness-105 active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-accent)]"
        onClick={onReset}
      >
        ↻ Recommencer
      </button>
    </div>
  );
}
