"use client";

import { useState, useRef, useEffect } from "react";
import type { Commentaire } from "@/lib/db";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import CommentForm from "./CommentForm";

const AVATAR_COLORS: Record<string, string> = {
  Jimmy: "#8b5cf6",
  Nikou: "#f59e0b",
  Gab: "#22c55e",
  Tom: "#3b82f6",
  Thomas: "#ef4444",
  "Philippe Hetschebest": "#e11d48",
  Philippe: "#e11d48",
  Ricardo: "#f97316",
  Alicia: "#84cc16",
  Sylvain: "#0ea5e9",
  "Ophélie": "#d946ef",
  Ophelie: "#d946ef",
  Kilian: "#1e3a5f",
  "Hervé": "#b91c1c",
};

const AVATAR_EMOJI: Record<string, string> = {
  Jimmy: "🤖",
  Nikou: "🍔",
  Gab: "🐕",
  Tom: "🎮",
  Thomas: "👑",
  "Philippe Hetschebest": "🏆",
  Philippe: "🏆",
  Ricardo: "🏋️",
  Alicia: "🧅",
  Sylvain: "🤖",
  "Ophélie": "👸",
  Ophelie: "👸",
  Kilian: "⚽",
  "Hervé": "🤬",
};

/** Build parent→children map with index validation against reponse_a author name */
function buildCommentTree(commentaires: Commentaire[]) {
  const childrenMap: Record<number, number[]> = {};
  const topLevel: number[] = [];

  commentaires.forEach((c, i) => {
    if (c.reponse_a_index !== undefined && c.reponse_a_index !== null) {
      let parentIdx = c.reponse_a_index;

      if (
        c.reponse_a &&
        (parentIdx < 0 ||
          parentIdx >= commentaires.length ||
          commentaires[parentIdx].auteur !== c.reponse_a)
      ) {
        let found = -1;
        for (let j = i - 1; j >= 0; j--) {
          if (commentaires[j].auteur === c.reponse_a) {
            found = j;
            break;
          }
        }
        if (found >= 0) {
          parentIdx = found;
        } else {
          topLevel.push(i);
          return;
        }
      }

      if (!childrenMap[parentIdx]) {
        childrenMap[parentIdx] = [];
      }
      childrenMap[parentIdx].push(i);
    } else {
      topLevel.push(i);
    }
  });

  return { childrenMap, topLevel };
}

/** Flatten tree via DFS → [{index, depth}] in display order */
function flattenTree(
  topLevel: number[],
  childrenMap: Record<number, number[]>
): { index: number; depth: number }[] {
  const result: { index: number; depth: number }[] = [];

  function traverse(idx: number, depth: number) {
    result.push({ index: idx, depth });
    for (const childIdx of childrenMap[idx] || []) {
      traverse(childIdx, depth + 1);
    }
  }

  for (const idx of topLevel) {
    traverse(idx, 0);
  }

  return result;
}

function InlineReplyForm({
  date,
  platIndex,
  reponseA,
  reponseAIndex,
  onCancel,
}: {
  date: string;
  platIndex: number;
  reponseA: string;
  reponseAIndex: number;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (formRef.current) {
      formRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const firstInput = formRef.current.querySelector<HTMLInputElement>("input");
      if (firstInput) {
        setTimeout(() => firstInput.focus(), 250);
      }
    }
  }, []);

  return (
    <div className="ml-8 mb-2 animate-[reply-slide-in_0.25s_ease-out]" ref={formRef}>
      <CommentForm
        date={date}
        platIndex={platIndex}
        reponseA={reponseA}
        reponseAIndex={reponseAIndex}
        onCancel={onCancel}
      />
    </div>
  );
}

export default function CommentSection({
  commentaires,
  date,
  platIndex,
}: {
  commentaires: Commentaire[];
  date: string;
  platIndex: number;
}) {
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const { childrenMap, topLevel } = buildCommentTree(commentaires);
  const flatList = flattenTree(topLevel, childrenMap);

  return (
    <>
      {commentaires.length > 0 && (
        <div className="mt-4">
          <Separator className="mb-3 bg-[var(--border)]" />
          {flatList.map(({ index, depth }, pos) => {
            const c = commentaires[index];
            const showTopSeparator = depth === 0 && pos > 0 && flatList[pos - 1].depth === 0;

            return (
              <div key={index}>
                {showTopSeparator && (
                  <Separator className="my-1 bg-[var(--border)] opacity-40" />
                )}
                <div
                  className={depth > 0 ? "border-l-2 border-l-[var(--accent)]/40 pl-3" : ""}
                  style={depth > 0 ? { marginLeft: `${(depth - 1) * 1.5 + 1}rem` } : undefined}
                >
                  <div className={`flex items-start gap-2.5 py-1.5 ${depth > 0 ? "py-1" : "py-2"}`}>
                    <Avatar className={`shrink-0 text-xs ${depth > 0 ? "w-6 h-6" : "w-7 h-7"}`}>
                      <AvatarFallback style={{ background: AVATAR_COLORS[c.auteur] || "#6b7280" }} className="text-xs">
                        {AVATAR_EMOJI[c.auteur] || c.auteur[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 text-sm leading-relaxed">
                      {c.reponse_a && depth > 0 && (
                        <span className="text-[10px] text-[var(--text-muted)] opacity-60 mr-1.5">
                          ↩ {c.reponse_a}
                        </span>
                      )}
                      <span className="font-bold text-[var(--text)] mr-1.5">{c.auteur}</span>
                      <span className="text-[var(--text-secondary)]">{c.texte}</span>
                      {c.image_url && (
                        <div className="mt-1.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={c.image_url}
                            alt="image"
                            className="max-w-[300px] max-h-[250px] rounded-[var(--radius-sm)] border border-[var(--border)] object-contain cursor-pointer transition-transform hover:scale-[1.02]"
                            loading="lazy"
                          />
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setReplyingTo(replyingTo === index ? null : index)}
                        className="text-[var(--text-muted)] text-xs h-auto p-0 ml-2 hover:text-[var(--accent)] hover:bg-transparent"
                      >
                        Répondre
                      </Button>
                    </div>
                  </div>
                </div>

                {replyingTo === index && (
                  <div
                    className={depth >= 0 ? "border-l-2 border-l-[var(--accent)]/40 pl-3" : ""}
                    style={{ marginLeft: `${depth * 1.5 + 1}rem` }}
                  >
                    <InlineReplyForm
                      key={`reply-${index}`}
                      date={date}
                      platIndex={platIndex}
                      reponseA={c.auteur}
                      reponseAIndex={index}
                      onCancel={() => setReplyingTo(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {replyingTo === null && (
        <CommentForm date={date} platIndex={platIndex} />
      )}
    </>
  );
}
