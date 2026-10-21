"use client";

import { useState, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CHARACTERS_BY_NAME, nomPersonnage, texteSur } from "@/lib/characters";
import type { Idee } from "@/lib/db";

const CHARACTER_STORAGE_KEY = "pdj-selected-character";
/** Repli d'un auteur inconnu : gris, initiale lisible dessus (le texte par défaut de l'avatar y tombe à 1,4:1). */
const COULEUR_INCONNU = "#6b7280";

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function FaisabiliteBadge({ faisabilite }: { faisabilite?: string | null }) {
  if (!faisabilite || faisabilite === "troll") return null;
  const map: Record<string, { label: string; cls: string }> = {
    faisable: { label: "Faisable", cls: "bg-[var(--good-soft)] text-[var(--good)]" },
    complexe: { label: "Complexe", cls: "bg-[var(--ok-soft)] text-[var(--ok)]" },
    impossible: { label: "Impossible", cls: "bg-[var(--bad-soft)] text-[var(--bad)]" },
  };
  const cfg = map[faisabilite];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[0.72rem] font-semibold px-1.5 py-0.5 rounded-full ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function StatutBadge({ statut }: { statut: string }) {
  if (statut === "fait") {
    return (
      <span className="inline-flex items-center gap-1 text-[0.72rem] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--good-soft)] text-[var(--good)]">
        Fait
      </span>
    );
  }
  if (statut === "refusé") {
    return (
      <span className="inline-flex items-center gap-1 text-[0.72rem] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--bad-soft)] text-[var(--bad)]">
        Refusé
      </span>
    );
  }
  return null;
}

function ReponseEquipe({ idee }: { idee: Idee }) {
  if (!idee.reponse) return null;
  return (
    <div className="mt-2 rounded-lg bg-[var(--good-soft)] px-2.5 py-1.5">
      <p className="text-xs font-semibold text-[var(--good)] m-0">
        Réponse de l&apos;équipe{idee.reponse_at ? ` · ${formatDate(idee.reponse_at)}` : ""}
      </p>
      <p className="text-sm text-[var(--text)] m-0 mt-0.5 whitespace-pre-wrap">{idee.reponse}</p>
    </div>
  );
}

function IdeeArchivee({ idee }: { idee: Idee }) {
  return (
    <li className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-[var(--text)]">{idee.auteur}</span>
        <span className="text-[0.65rem] text-[var(--text-muted)]">{formatDate(idee.created_at)}</span>
        <StatutBadge statut={idee.statut} />
        {idee.votes.length > 0 && (
          <span className="text-[0.65rem] text-[var(--text-muted)]">
            {idee.votes.length} vote{idee.votes.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <p className="text-sm text-[var(--text)] m-0 whitespace-pre-wrap">{idee.texte}</p>
      <ReponseEquipe idee={idee} />
    </li>
  );
}

export default function IdeesList({ initialIdees }: { initialIdees: Idee[] }) {
  const [idees, setIdees] = useState(() => initialIdees.filter((i) => !i.archived_at));
  const archivees = initialIdees.filter((i) => i.archived_at);
  const [votingId, setVotingId] = useState<number | null>(null);
  const [currentUser, setCurrentUser] = useState("");
  // Idée sur laquelle on a voté sans avoir choisi de personnage : affiche l'invitation à en choisir un
  const [inviteId, setInviteId] = useState<number | null>(null);

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
    let votant = currentUser;
    if (!votant) {
      // Le choix fait dans IdeeForm ne déclenche pas l'événement `storage` de cet onglet : on relit.
      try {
        votant = localStorage.getItem(CHARACTER_STORAGE_KEY) ?? "";
      } catch {
        /* ignore */
      }
      if (!votant) {
        setInviteId(ideeId);
        return;
      }
      setCurrentUser(votant);
    }
    setInviteId(null);
    setVotingId(ideeId);

    try {
      const res = await fetch("/api/idees/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideeId, votant }),
      });

      if (res.ok) {
        // Update local state
        setIdees((prev) =>
          prev.map((idee) => {
            if (idee.id !== ideeId) return idee;
            const votes = [...idee.votes];
            const idx = votes.indexOf(votant);
            if (idx >= 0) {
              votes.splice(idx, 1);
            } else {
              votes.push(votant);
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

  const sorties = archivees.length > 0 && (
    <details className="group">
      <summary className="cursor-pointer list-none flex items-center gap-2 min-h-10 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--accent)]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4 transition-transform group-open:rotate-90"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        Idées sorties ({archivees.length})
      </summary>
      <ul className="space-y-3 mt-2 p-0 list-none">
        {archivees.map((idee) => (
          <IdeeArchivee key={idee.id} idee={idee} />
        ))}
      </ul>
    </details>
  );

  if (idees.length === 0) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12 text-[var(--text-secondary)]">
          <p className="text-lg">Aucune idée pour le moment</p>
          <p className="text-sm mt-1">Soyez le premier à proposer quelque chose !</p>
        </div>
        {sorties}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {idees.map((idee) => {
          const char = CHARACTERS_BY_NAME[nomPersonnage(idee.auteur)];
          const hasVoted = currentUser && idee.votes.includes(currentUser);

          return (
            <div
              key={idee.id}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex gap-3"
            >
              {/* Vote button */}
              <button
                onClick={() => handleVote(idee.id)}
                disabled={votingId === idee.id}
                title={!currentUser ? "Choisissez d'abord un personnage" : hasVoted ? "Retirer le vote" : "Voter"}
                className={`flex flex-col items-center gap-0.5 min-w-[40px] pt-0.5 rounded-lg px-1 py-1.5 transition-all border ${
                  hasVoted
                    ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]"
                    : `bg-transparent border-transparent hover:bg-[var(--surface-hover)] hover:text-[var(--accent)] ${
                        currentUser ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"
                      }`
                } cursor-pointer`}
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
                      style={{ background: char?.color || COULEUR_INCONNU, color: texteSur(char?.color || COULEUR_INCONNU) }}
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
                <ReponseEquipe idee={idee} />
                {inviteId === idee.id && !currentUser && (
                  <p role="status" className="text-xs text-[var(--text-secondary)] mt-2">
                    Choisissez d&apos;abord un personnage (« en tant que », en haut de la page) pour voter.
                  </p>
                )}
                {idee.votes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mt-2">
                    {idee.votes.map((v) => {
                      const vc = CHARACTERS_BY_NAME[nomPersonnage(v)];
                      return (
                        <Avatar key={v} className="w-4 h-4 text-[0.5rem]" title={v}>
                          {vc?.image && <AvatarImage src={vc.image} alt={v} />}
                          <AvatarFallback
                            style={{ background: vc?.color || COULEUR_INCONNU, color: texteSur(vc?.color || COULEUR_INCONNU) }}
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
      {sorties}
    </div>
  );
}
