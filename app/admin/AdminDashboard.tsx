"use client";
import { useEffect, useState } from "react";
import type { PipelineRun } from "@/lib/db";

const STATUS_STYLE: Record<string, string> = {
  requested: "bg-gray-200 text-gray-800",
  running: "bg-blue-200 text-blue-900",
  success: "bg-green-200 text-green-900",
  error: "bg-red-200 text-red-900",
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
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          Relancer (jour)
        </button>
        <button
          onClick={() => trigger("semaine")}
          disabled={busy || active}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          Relancer (semaine)
        </button>
      </div>
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
      {active && <p className="text-sm text-blue-700">Un run est en cours… (rafraîchissement auto)</p>}

      <ul className="flex flex-col gap-2">
        {runs.map((r) => (
          <li key={r.id} className="rounded border">
            <button
              onClick={() => setOpen(open === r.id ? null : r.id)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
            >
              <span className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? ""}`}>
                  {r.status}
                </span>
                <span className="font-medium">{r.mode}</span>
                <span className="text-xs text-gray-500">{r.triggered_by}</span>
              </span>
              <span className="text-xs text-gray-500">
                {new Date(r.created_at).toLocaleString("fr-FR")} · {duration(r)}
              </span>
            </button>
            {open === r.id && (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t bg-gray-50 p-3 text-xs">
                {r.log || "(pas encore de log)"}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
