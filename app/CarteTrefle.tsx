"use client";

import { useState } from "react";
import type { Carte, CartePlat } from "@/lib/db";
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

export default function CarteTrefle({ carte }: { carte: Carte }) {
  const [open, setOpen] = useState(false);
  const evalDate = carte.evaluated_at
    ? new Date(carte.evaluated_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className="mt-8 sm:mt-10">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="carte-trefle-content"
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] text-left hover:border-[var(--border-accent)] transition-colors"
      >
        <span className="flex items-center gap-2 font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
          <span dangerouslySetInnerHTML={{ __html: getIcon("Le Bistrot Trèfle") }} />
          La carte du Trèfle
        </span>
        <span className="flex items-center gap-2 text-[var(--text-muted)] text-xs">
          {evalDate && <span className="hidden sm:inline">notée le {evalDate}</span>}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      <div hidden={!open} id="carte-trefle-content" className="mt-4">
        {carte.sections.map((sec) => (
          <section key={sec.nom} className="mb-6">
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
