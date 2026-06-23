import type { Carte, CartePlat, CarteSection } from "@/lib/db";
import { noteClass } from "@/lib/format";
import { getIcon } from "@/lib/icons";
import { Card, CardContent } from "@/components/ui/card";
import MacrosPanel from "./MacrosPanel";

function CartePlatCard({ plat }: { plat: CartePlat }) {
  const note = plat.note ?? "?";
  const noteG = plat.note_goulaf ?? note;
  const noteCls = noteClass(note);
  const noteGCls = noteClass(noteG);

  return (
    <Card className="plat-card bg-[var(--surface)] border-[var(--border)] mb-3 relative overflow-hidden" style={{ backgroundImage: "var(--card-stripe)" }}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex justify-between items-center mb-2 gap-2">
          <span className="text-base font-semibold leading-snug" style={{ fontFamily: "var(--font-heading)" }}>
            {plat.plat}
          </span>
          <span className={`note note-${noteCls} mode-sportif shrink-0`} data-note={note}>
            {note}<span className="note-max">/10</span>
          </span>
          <span className={`note note-${noteGCls} mode-goulaf shrink-0`} data-note={noteG} style={{ display: "none" }}>
            {noteG}<span className="note-max">/10</span>
          </span>
        </div>

        <div className="text-[var(--accent)] font-bold mb-3">{plat.prix}</div>

        <MacrosPanel
          nutri={plat.nutrition_estimee}
          ingredients={plat.ingredients_detail}
          source={plat.nutrition_source}
        />

        {plat.justification && (
          <p className="mode-sportif text-sm text-[var(--text-secondary)] leading-relaxed">{plat.justification}</p>
        )}
        {(plat.justification_goulaf || plat.justification) && (
          <p className="mode-goulaf text-sm text-[var(--text-secondary)] leading-relaxed" style={{ display: "none" }}>
            {plat.justification_goulaf || plat.justification}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Note moyenne d'une section pour un mode donné (plats sans note ignorés) */
function sectionAvg(sec: CarteSection, mode: "sportif" | "goulaf"): number {
  const notes = sec.plats
    .map((p) => (mode === "goulaf" ? p.note_goulaf ?? p.note : p.note))
    .filter((n): n is number => typeof n === "number");
  if (notes.length === 0) return -1;
  return notes.reduce((a, b) => a + b, 0) / notes.length;
}

/** Trie une section : plats par note (mode sportif) décroissante */
function sortSectionPlats(sec: CarteSection): CarteSection {
  const plats = [...sec.plats].sort((a, b) => (b.note ?? -1) - (a.note ?? -1));
  return { ...sec, plats };
}

export default function CarteTrefle({ carte }: { carte: Carte }) {
  const evalDate = carte.evaluated_at
    ? new Date(carte.evaluated_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;

  // Tri par défaut (SSR) : sections de la meilleure note moyenne à la plus basse, en mode sportif.
  // Le tri dynamique selon le mode est géré côté client (applyMode).
  const sections = [...carte.sections]
    .map(sortSectionPlats)
    .sort((a, b) => sectionAvg(b, "sportif") - sectionAvg(a, "sportif"));

  return (
    <div>
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1 flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
        <span dangerouslySetInnerHTML={{ __html: getIcon("Le Bistrot Trèfle") }} />
        La carte du Trèfle
      </h2>
      {evalDate && (
        <p className="text-[var(--text-secondary)] text-sm mb-5 sm:mb-6">Notée le {evalDate}</p>
      )}

      <div data-carte-sections>
        {sections.map((sec) => (
          <section key={sec.nom} data-carte-section className="mb-6">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-3">{sec.nom}</h3>
            {sec.plats.map((p, i) => (
              <CartePlatCard key={`${sec.nom}::${p.plat ?? i}`} plat={p} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
