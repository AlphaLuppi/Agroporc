"use client";

import { useState } from "react";
import { choisirPlat, type PoolPlat, type Mode } from "@/lib/quiz-plats";
import { choisirDessert, type DessertConnu, type SaveurDessert, type Lourdeur } from "@/lib/desserts";
import type { Famille, Proteine } from "@/lib/quiz-tags";

type Answers = {
  mode?: Mode;
  menu?: "plat" | "menu";
  famille?: Famille;
  proteine?: Proteine;
  saveur?: SaveurDessert;
  lourdeur?: Lourdeur;
  _familleAsked?: boolean;
  _proteineAsked?: boolean;
  _saveurAsked?: boolean;
  _lourdeurAsked?: boolean;
};

interface Choice<T> {
  label: string;
  value: T;
}

const card =
  "w-full text-left px-4 py-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-accent)] hover:bg-[var(--surface-hover)] transition-colors text-[var(--text)] font-medium cursor-pointer";

function QuestionStep<T extends string>({
  titre,
  choices,
  onPick,
}: {
  titre: string;
  choices: Choice<T>[];
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-heading)" }}>
        {titre}
      </h2>
      <div className="flex flex-col gap-2">
        {choices.map((c) => (
          <button key={c.value} className={card} onClick={() => onPick(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function QuizClient({
  pool,
  desserts,
  hasJour,
}: {
  pool: PoolPlat[];
  desserts: DessertConnu[];
  hasJour: boolean;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [done, setDone] = useState(false);

  const reset = () => {
    setAnswers({});
    setDone(false);
  };

  // Détermine l'étape courante à partir des réponses.
  function render() {
    if (done) return <Resultat answers={answers} pool={pool} desserts={desserts} onReset={reset} />;

    if (!answers.mode) {
      return (
        <QuestionStep<Mode>
          titre="Tu manges plutôt malin ou plaisir aujourd'hui ?"
          choices={[
            { label: "🥗 Sportif (équilibré)", value: "sportif" },
            { label: "😋 Goulaf (plaisir)", value: "goulaf" },
          ]}
          onPick={(mode) => setAnswers((a) => ({ ...a, mode }))}
        />
      );
    }

    if (!answers.menu) {
      return (
        <QuestionStep<"plat" | "menu">
          titre="Tu veux juste un plat, ou un plat + un dessert ?"
          choices={[
            { label: "🍽️ Un plat seul", value: "plat" },
            { label: "🍰 Un plat + un dessert", value: "menu" },
          ]}
          onPick={(menu) => setAnswers((a) => ({ ...a, menu }))}
        />
      );
    }

    if (!answers.famille && !answers._familleAsked) {
      return (
        <QuestionStep<Famille | "peu_importe">
          titre="Plutôt viande, poisson, ou sans viande ?"
          choices={[
            { label: "🥩 De la viande", value: "viande" },
            { label: "🐟 Du poisson", value: "poisson" },
            { label: "🥦 Sans viande ni poisson", value: "vege" },
            { label: "🤷 Peu importe", value: "peu_importe" },
          ]}
          onPick={(v) =>
            setAnswers((a) => ({
              ...a,
              famille: v === "peu_importe" ? undefined : v,
              _familleAsked: true,
            }))
          }
        />
      );
    }

    // Question protéine uniquement si "viande"
    if (answers.famille === "viande" && !answers.proteine && !answers._proteineAsked) {
      return (
        <QuestionStep<Proteine | "peu_importe">
          titre="Quelle viande te fait envie ?"
          choices={[
            { label: "🍗 Poulet", value: "poulet" },
            { label: "🐄 Bœuf", value: "boeuf" },
            { label: "🐖 Porc", value: "porc" },
            { label: "🐑 Veau / agneau", value: "veau" },
            { label: "🤷 Peu importe", value: "peu_importe" },
          ]}
          onPick={(v) =>
            setAnswers((a) => ({
              ...a,
              proteine: v === "peu_importe" ? undefined : v,
              _proteineAsked: true,
            }))
          }
        />
      );
    }

    // Branche dessert
    if (answers.menu === "menu" && !answers.saveur && !answers._saveurAsked) {
      return (
        <QuestionStep<SaveurDessert | "peu_importe">
          titre="Côté dessert, tu pars sur quoi ?"
          choices={[
            { label: "🍓 Fruité", value: "fruite" },
            { label: "🍫 Chocolaté", value: "chocolate" },
            { label: "🥛 Crémeux / lacté", value: "creme_lacte" },
            { label: "🥧 Pâtissier", value: "patissier" },
            { label: "🤷 Peu importe", value: "peu_importe" },
          ]}
          onPick={(v) =>
            setAnswers((a) => ({
              ...a,
              saveur: v === "peu_importe" ? undefined : v,
              _saveurAsked: true,
            }))
          }
        />
      );
    }

    if (answers.menu === "menu" && !answers.lourdeur && !answers._lourdeurAsked) {
      return (
        <QuestionStep<Lourdeur | "peu_importe">
          titre="Léger ou bien gourmand ?"
          choices={[
            { label: "🍃 Léger", value: "leger" },
            { label: "🤤 Gourmand", value: "gourmand" },
            { label: "🤷 Peu importe", value: "peu_importe" },
          ]}
          onPick={(v) =>
            setAnswers((a) => ({
              ...a,
              lourdeur: v === "peu_importe" ? undefined : v,
              _lourdeurAsked: true,
            }))
          }
        />
      );
    }

    // Plus de questions → résultat
    setDone(true);
    return null;
  }

  return (
    <div className="max-w-[520px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--accent)]" style={{ fontFamily: "var(--font-heading)" }}>
          Aide-moi à choisir
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Quelques questions, et on te trouve le plat idéal du jour.
        </p>
        {!hasJour && (
          <p className="text-xs text-[var(--text-muted)] mt-2">
            (Pas encore de plats du jour publiés — on cherche dans les cartes.)
          </p>
        )}
      </header>
      {render()}
    </div>
  );
}

function Resultat({
  answers,
  pool,
  desserts,
  onReset,
}: {
  answers: Answers;
  pool: PoolPlat[];
  desserts: DessertConnu[];
  onReset: () => void;
}) {
  const mode: Mode = answers.mode ?? "sportif";
  const { resultat: plat, exact } = choisirPlat(
    pool,
    { famille: answers.famille, proteine: answers.proteine },
    mode
  );
  const dessert =
    answers.menu === "menu"
      ? choisirDessert(desserts, { saveur: answers.saveur, lourdeur: answers.lourdeur })
      : null;

  const noteAffichee = (p: PoolPlat) => (mode === "sportif" ? p.note : p.note_goulaf);
  const justifAffichee = (p: PoolPlat) =>
    mode === "sportif" ? p.justification : p.justification_goulaf;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-heading)" }}>
        {exact ? "Ton plat idéal aujourd'hui" : "Pas de match exact — au plus proche"}
      </h2>

      {plat ? (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-[var(--text)]">{plat.plat}</span>
            {typeof noteAffichee(plat) === "number" && (
              <span className="text-sm font-bold text-[var(--accent)]">{noteAffichee(plat)}/10</span>
            )}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {plat.restaurant} · {plat.prix}
          </div>
          {justifAffichee(plat) && (
            <p className="text-sm text-[var(--text-secondary)] mt-2">{justifAffichee(plat)}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">
          Aucun plat trouvé aujourd'hui. Reviens un peu plus tard !
        </p>
      )}

      {answers.menu === "menu" && (
        <>
          <h2 className="text-lg font-bold text-[var(--text)] mt-2" style={{ fontFamily: "var(--font-heading)" }}>
            …et le dessert
          </h2>
          {dessert ? (
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="font-bold text-[var(--text)]">{dessert.nom}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">{dessert.restaurant}</div>
              <div className="text-xs mt-2 text-[var(--text-secondary)]">
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
        className="mt-2 self-start px-4 py-2 rounded-[var(--radius)] bg-[var(--accent)] text-[var(--accent-text)] font-semibold cursor-pointer"
        onClick={onReset}
      >
        ↻ Recommencer
      </button>
    </div>
  );
}
