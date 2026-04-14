"use client";

import { useState, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CHARACTERS_BY_NAME } from "@/lib/characters";
import type { Idee } from "@/lib/db";

const CHARACTER_STORAGE_KEY = "pdj-selected-character";

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function FaisabiliteBadge({ faisabilite }: { faisabilite?: string | null }) {
  if (!faisabilite || faisabilite === "troll") return null;
  const map: Record<string, { label: string; cls: string }> = {
    faisable: { label: "Faisable", cls: "bg-green-500/15 text-green-600" },
    complexe: { label: "Complexe", cls: "bg-amber-500/15 text-amber-600" },
    impossible: { label: "Impossible", cls: "bg-red-500/15 text-red-500" },
  };
  const cfg = map[faisabilite];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[0.65rem] font-semibold px-1.5 py-0.5 rounded-full ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function StatutBadge({ statut }: { statut: string }) {
  if (statut === "fait") {
    return (
      <span className="inline-flex items-center gap-1 text-[0.65rem] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-600">
        Fait
      </span>
    );
  }
  if (statut === "refusé") {
    return (
      <span className="inline-flex items-center gap-1 text-[0.65rem] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-500">
        Refusé
      </span>
    );
  }
  return null;
}

export default function IdeesList({ initialIdees }: { initialIdees: Idee[] }) {
  const [idees, setIdees] = useState(initialIdees);
  const [votingId, setVotingId] = useState<number | null>(null);
  const [currentUser, setCurrentUser] = useState("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CHARACTER_STORAGE_KEY);
      if (stored) setCurrentUser(stored);
    } catch {
      /* ignore */
    }
  }, []);

  // Sync currentUser when localStorage changes (e.g. from IdeeForm)
  useEffect(() => {
    function onStorage() {
      try {
        const stored = localStorage.getItem(CHARACTER_STORAGE_KEY);
        if (stored) setCurrentUser(stored);
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  async function handleVote(ideeId: number) {
    if (!currentUser) return;
    setVotingId(ideeId);

    try {
      const res = await fetch("/api/idees/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideeId, votant: currentUser }),
      });

      if (res.ok) {
        // Update local state
        setIdees((prev) =>
          prev.map((idee) => {
            if (idee.id !== ideeId) return idee;
            const votes = [...idee.votes];
            const idx = votes.indexOf(currentUser);
            if (idx >= 0) {
              votes.splice(idx, 1);
            } else {
              votes.push(currentUser);
            }
            return { ...idee, votes };
          })
        );
      }
    } catch {
      /* ignore */
    } finally {
      setVotingId(null);
    }
  }

  if (idees.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--text-secondary)]">
        <p className="text-lg">Aucune idée pour le moment</p>
        <p className="text-sm mt-1">Soyez le premier à proposer quelque chose !</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {idees.map((idee) => {
        const char = CHARACTERS_BY_NAME[idee.auteur];
        const hasVoted = currentUser && idee.votes.includes(currentUser);

        return (
          <div
            key={idee.id}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex gap-3"
          >
            {/* Vote button */}
            <button
              onClick={() => handleVote(idee.id)}
              disabled={!currentUser || votingId === idee.id}
              title={!currentUser ? "Sélectionnez un personnage d'abord" : hasVoted ? "Retirer le vote" : "Voter"}
              className={`flex flex-col items-center gap-0.5 min-w-[40px] pt-0.5 rounded-lg px-1 py-1.5 transition-all border ${
                hasVoted
                  ? "bg-[var(--accent-glow)] border-[var(--accent)] text-[var(--accent)]"
                  : "bg-transparent border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--accent)]"
              } ${!currentUser ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <svg
                viewBox="0 0 24 24"
                fill={hasVoted ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
              >
                <path d="M7 15l5-5 5 5" />
              </svg>
              <span className="text-sm font-bold leading-none">{idee.votes.length}</span>
            </button>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Avatar className="shrink-0 w-5 h-5 text-[0.6rem]">
                  {char?.image && <AvatarImage src={char.image} alt={idee.auteur} />}
                  <AvatarFallback
                    style={{ background: char?.color || "#6b7280" }}
                    className="text-[0.6rem]"
                  >
                    {char?.emoji || idee.auteur[0]}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs font-semibold text-[var(--text)]">{idee.auteur}</span>
                <span className="text-[0.65rem] text-[var(--text-muted)]">
                  {formatDate(idee.created_at)}
                </span>
                <StatutBadge statut={idee.statut} />
                <FaisabiliteBadge faisabilite={idee.faisabilite} />
              </div>
              <p className="text-sm text-[var(--text)] m-0 whitespace-pre-wrap">{idee.texte}</p>
              {idee.evaluation && idee.faisabilite && idee.faisabilite !== "troll" && (
                <p className="text-xs italic text-[var(--text-secondary)] mt-1.5 border-l-2 border-[var(--border)] pl-2">
                  🤖 {idee.evaluation}
                </p>
              )}
              {idee.votes.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 mt-2">
                  {idee.votes.map((v) => {
                    const vc = CHARACTERS_BY_NAME[v];
                    return (
                      <Avatar key={v} className="w-4 h-4 text-[0.5rem]" title={v}>
                        {vc?.image && <AvatarImage src={vc.image} alt={v} />}
                        <AvatarFallback
                          style={{ background: vc?.color || "#6b7280" }}
                          className="text-[0.5rem]"
                        >
                          {vc?.emoji || v[0]}
                        </AvatarFallback>
                      </Avatar>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
