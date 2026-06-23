"use client";

import { useState, type ReactNode } from "react";
import { meilleursCandidats, type Criteres, type Envie, type Cuisine, type LourdeurPlat, type Budget } from "@/lib/quiz-engine";
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
  sousTitre,
  choix,
  onPick,
}: {
  titre: string;
  sousTitre?: string;
  choix: Choix[];
  onPick: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-heading)" }}>
          {titre}
        </h2>
        {sousTitre && <p className="mt-1 text-sm text-[var(--text-muted)]">{sousTitre}</p>}
      </div>
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

function Progression({ etape, total }: { etape: number; total: number }) {
  return (
    <div className="mb-5 flex items-center gap-2" aria-hidden>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="h-1.5 flex-1 rounded-full transition-colors duration-200"
          style={{ backgroundColor: i < etape ? "var(--accent)" : "var(--border)" }}
        />
      ))}
    </div>
  );
}

const ENVIE_CHOIX: Choix[] = [
  { key: "poulet", label: "Poulet / volaille", emoji: "🍗" },
  { key: "boeuf", label: "Bœuf", emoji: "🐄" },
  { key: "porc", label: "Porc", emoji: "🐖" },
  { key: "veau", label: "Veau / agneau", emoji: "🐑" },
  { key: "poisson", label: "Poisson / fruits de mer", emoji: "🐟" },
  { key: "vege", label: "Végé (sans viande ni poisson)", emoji: "🥦" },
  { key: "peu_importe", label: "Peu importe", emoji: "🤷" },
];

const CUISINE_CHOIX: Choix[] = [
  { key: "mijote", label: "Mijoté / réconfortant", emoji: "🍲" },
  { key: "asiatique", label: "Asiatique", emoji: "🥢" },
  { key: "mediterraneen", label: "Méditerranéen", emoji: "🫒" },
  { key: "streetfood", label: "Burger / streetfood", emoji: "🍔" },
  { key: "froid", label: "Salade / froid", emoji: "🥗" },
  { key: "peu_importe", label: "Peu importe", emoji: "🤷" },
];

const LOURDEUR_CHOIX: Choix[] = [
  { key: "leger", label: "Léger", emoji: "🍃" },
  { key: "copieux", label: "Copieux", emoji: "🍛" },
  { key: "peu_importe", label: "Peu importe", emoji: "🤷" },
];

const BUDGET_CHOIX: Choix[] = [
  { key: "eco", label: "Éco (≤ 10€)", emoji: "💰" },
  { key: "standard", label: "Standard", emoji: "💳" },
  { key: "peu_importe", label: "Peu importe", emoji: "🤷" },
];

const DESSERT_SAVEUR_CHOIX: Choix[] = [
  { key: "fruite", label: "Fruité", emoji: "🍓" },
  { key: "chocolate", label: "Chocolaté", emoji: "🍫" },
  { key: "creme_lacte", label: "Crémeux / lacté", emoji: "🥛" },
  { key: "patissier", label: "Pâtissier", emoji: "🥧" },
  { key: "peu_importe", label: "Peu importe", emoji: "🤷" },
];

const DESSERT_LOURDEUR_CHOIX: Choix[] = [
  { key: "leger", label: "Léger", emoji: "🍃" },
  { key: "gourmand", label: "Gourmand", emoji: "🤤" },
  { key: "peu_importe", label: "Peu importe", emoji: "🤷" },
];

const opt = <T extends string>(k: string): T | undefined => (k === "peu_importe" ? undefined : (k as T));

export default function QuizClient({
  pool,
  desserts,
  hasJour,
}: {
  pool: PoolPlat[];
  desserts: DessertConnu[];
  hasJour: boolean;
}) {
  const [mode, setMode] = useState<Mode>();
  const [menu, setMenu] = useState<"plat" | "menu">();
  const [envie, setEnvie] = useState<{ v?: Envie } | undefined>();
  const [cuisine, setCuisine] = useState<{ v?: Cuisine } | undefined>();
  const [lourdeur, setLourdeur] = useState<{ v?: LourdeurPlat } | undefined>();
  const [budget, setBudget] = useState<{ v?: Budget } | undefined>();
  const [saveur, setSaveur] = useState<{ v?: SaveurDessert } | undefined>();
  const [lourdeurDessert, setLourdeurDessert] = useState<{ v?: Lourdeur } | undefined>();
  const [platChoisi, setPlatChoisi] = useState<PoolPlat | null | undefined>();

  const reset = () => {
    setMode(undefined);
    setMenu(undefined);
    setEnvie(undefined);
    setCuisine(undefined);
    setLourdeur(undefined);
    setBudget(undefined);
    setSaveur(undefined);
    setLourdeurDessert(undefined);
    setPlatChoisi(undefined);
  };

  // Nombre total d'étapes (pour la progression) : mode, menu, 4 critères plat, +2 si dessert.
  const total = 6 + (menu === "menu" ? 2 : 0);
  const repondues =
    (mode ? 1 : 0) +
    (menu ? 1 : 0) +
    (envie ? 1 : 0) +
    (cuisine ? 1 : 0) +
    (lourdeur ? 1 : 0) +
    (budget ? 1 : 0) +
    (saveur ? 1 : 0) +
    (lourdeurDessert ? 1 : 0);

  // Renvoie le contenu courant ; isResult sert à masquer la barre de progression.
  function render(): { node: ReactNode; isResult: boolean } {
    const q = (node: ReactNode) => ({ node, isResult: false });
    const r = (node: ReactNode) => ({ node, isResult: true });

    if (!mode) {
      return q(
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
      return q(
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

    if (!envie) {
      return q(
        <Question
          titre="Qu'est-ce qui te tente ?"
          choix={ENVIE_CHOIX}
          onPick={(k) => setEnvie({ v: opt<Envie>(k) })}
        />
      );
    }

    if (!cuisine) {
      return q(
        <Question
          titre="Plutôt quel style de cuisine ?"
          choix={CUISINE_CHOIX}
          onPick={(k) => setCuisine({ v: opt<Cuisine>(k) })}
        />
      );
    }

    if (!lourdeur) {
      return q(
        <Question
          titre="Léger ou copieux ?"
          choix={LOURDEUR_CHOIX}
          onPick={(k) => setLourdeur({ v: opt<LourdeurPlat>(k) })}
        />
      );
    }

    if (!budget) {
      return q(
        <Question
          titre="Quel budget pour le plat ?"
          choix={BUDGET_CHOIX}
          onPick={(k) => setBudget({ v: opt<Budget>(k) })}
        />
      );
    }

    // Branche dessert.
    if (menu === "menu" && !saveur) {
      return q(
        <Question
          titre="Côté dessert, tu pars sur quoi ?"
          choix={DESSERT_SAVEUR_CHOIX}
          onPick={(k) => setSaveur({ v: opt<SaveurDessert>(k) })}
        />
      );
    }

    if (menu === "menu" && !lourdeurDessert) {
      return q(
        <Question
          titre="Le dessert, léger ou bien gourmand ?"
          choix={DESSERT_LOURDEUR_CHOIX}
          onPick={(k) => setLourdeurDessert({ v: opt<Lourdeur>(k) })}
        />
      );
    }

    // Calcul des candidats.
    const criteres: Criteres = {
      envie: envie.v,
      cuisine: cuisine.v,
      lourdeur: lourdeur.v,
      budget: budget.v,
    };
    const { candidats, nbCriteres, scoreMax } = meilleursCandidats(pool, criteres, mode);

    // Départage par nom seulement si plusieurs plats matchent réellement (scoreMax > 0).
    if (platChoisi === undefined && scoreMax > 0 && candidats.length > 1) {
      return q(
        <Question
          titre="Plusieurs plats collent à tes envies — lequel te tente ?"
          sousTitre="On a réduit aux meilleurs candidats du jour."
          choix={candidats.slice(0, 6).map((p, i) => ({
            key: String(i),
            label: p.plat,
            emoji: "🍽️",
          }))}
          onPick={(k) => setPlatChoisi(candidats[Number(k)])}
        />
      );
    }

    const plat = platChoisi !== undefined ? platChoisi : candidats[0] ?? null;
    // Aucun plat ne correspond aux critères exprimés → on propose le plus proche.
    const auPlusProche = platChoisi === undefined && nbCriteres > 0 && scoreMax === 0;
    const dessert =
      menu === "menu" ? choisirDessert(desserts, { saveur: saveur?.v, lourdeur: lourdeurDessert?.v }) : null;

    return r(
      <Resultat mode={mode} plat={plat} menu={menu} dessert={dessert} auPlusProche={auPlusProche} onReset={reset} />
    );
  }

  const { node, isResult } = render();

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
      {!isResult && <Progression etape={repondues} total={total} />}
      {node}
    </div>
  );
}

function Resultat({
  mode,
  plat,
  menu,
  dessert,
  auPlusProche,
  onReset,
}: {
  mode: Mode;
  plat: PoolPlat | null;
  menu: "plat" | "menu";
  dessert: DessertConnu | null;
  auPlusProche: boolean;
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
        {auPlusProche ? "Rien ne colle pile, mais au plus proche…" : "Ton plat idéal aujourd'hui"}
      </h2>
      {auPlusProche && (
        <p className="-mt-2 text-sm text-[var(--text-muted)]">
          Aucun plat du jour ne correspond exactement à tes critères. Voici le mieux noté.
        </p>
      )}

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
