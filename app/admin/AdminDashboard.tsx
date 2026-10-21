"use client";
import { useEffect, useState } from "react";
import type { PipelineRun } from "@/lib/db";

// Pastilles de statut aux tokens du thème (fonds opaques --*-soft, texte --text) ; bordure en couleur pleine
// pour distinguer les statuts (running en pointillés : en Normal l'accent et l'ambre se ressemblent).
const STATUS_STYLE: Record<string, string> = {
  requested: "border-[var(--border-control)] bg-[var(--surface-hover)] text-[var(--text)]",
  running: "border-dashed border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]",
  success: "border-[var(--good)] bg-[var(--good-soft)] text-[var(--text)]",
  error: "border-[var(--bad)] bg-[var(--bad-soft)] text-[var(--text)]",
  partial: "border-[var(--ok)] bg-[var(--ok-soft)] text-[var(--text)]",
};

function duration(run: PipelineRun): string {
  if (!run.started_at || !run.finished_at) return "—";
  const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

export default function AdminDashboard({ initialRuns }: { initialRuns: PipelineRun[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const active = runs.some((r) => r.status === "requested" || r.status === "running");

  async function refresh() {
    const res = await fetch("/api/pipeline/runs");
    if (res.ok) setRuns((await res.json()).runs);
  }

  useEffect(() => {
    if (!active) return;
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [active]);

  async function trigger(mode: "jour" | "semaine") {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/pipeline/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg(`Relance « ${mode} » demandée.`);
      refresh();
    } else if (res.status === 409) {
      setMsg("Un run est déjà en cours.");
    } else {
      setMsg("Erreur lors de la demande.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        <button
          onClick={() => trigger("jour")}
          disabled={busy || active}
          className="rounded border border-transparent bg-[var(--accent)] px-4 py-2 font-semibold text-[var(--accent-text)] hover:brightness-110 disabled:cursor-not-allowed disabled:border-[var(--border-control)] disabled:bg-[var(--surface-hover)] disabled:text-[var(--text-muted)] disabled:hover:brightness-100"
        >
          Relancer (jour)
        </button>
        <button
          onClick={() => trigger("semaine")}
          disabled={busy || active}
          className="rounded border border-transparent bg-[var(--accent)] px-4 py-2 font-semibold text-[var(--accent-text)] hover:brightness-110 disabled:cursor-not-allowed disabled:border-[var(--border-control)] disabled:bg-[var(--surface-hover)] disabled:text-[var(--text-muted)] disabled:hover:brightness-100"
        >
          Relancer (semaine)
        </button>
      </div>
      {msg && <p className="text-sm text-[var(--text-secondary)]">{msg}</p>}
      {active && <p className="text-sm text-[var(--accent)]">Un run est en cours… (rafraîchissement auto)</p>}

      <ul className="flex flex-col gap-2">
        {runs.map((r) => (
          <li key={r.id} className="rounded border border-[var(--border)] bg-[var(--surface)]">
            <button
              onClick={() => setOpen(open === r.id ? null : r.id)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
            >
              <span className="flex items-center gap-2">
                <span className={`rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? ""}`}>
                  {r.status}
                </span>
                <span className="font-medium">{r.mode}</span>
                <span className="text-xs text-[var(--text-muted)]">{r.triggered_by}</span>
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {new Date(r.created_at).toLocaleString("fr-FR")} · {duration(r)}
              </span>
            </button>
            {open === r.id && (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-[var(--border)] bg-[var(--surface-accent)] p-3 text-xs text-[var(--text)]">
                {r.log || "(pas encore de log)"}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
