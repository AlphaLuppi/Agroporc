"use client";

import { useState, useRef, useEffect } from "react";
import type { Commentaire } from "@/lib/db";
import { AVATAR_COLORS, AVATAR_EMOJI, AVATAR_IMAGE } from "@/lib/characters";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import CommentForm from "./CommentForm";

// Matches ![alt](url) markdown images or raw image/GIF URLs (including Giphy/Tenor)
const IMAGE_MD_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
const IMAGE_URL_RE = /https?:\/\/\S+\.(?:gif|png|jpe?g|webp)(?:\?[^\s]*)?/gi;
const GIPHY_RE = /https?:\/\/(?:media\d*\.giphy\.com|giphy\.com\/media|(?:[a-z]{2}\.)?tenor\.com\/(?:[a-z]{2}\/)?view)\S*/gi;

function tenorEmbedId(url: string): string | null {
  const m = url.match(/tenor\.com\/(?:[a-z]{2}\/)?view\/[^/?#]*-(\d+)(?:[/?#]|$)/i);
  return m ? m[1] : null;
}

interface TextPart {
  type: "text" | "image";
  content: string;
  alt?: string;
}

function parseCommentText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  // Collect all image tokens with their positions
  const tokens: { start: number; end: number; url: string; alt: string }[] = [];

  let m: RegExpExecArray | null;
  const mdRe = new RegExp(IMAGE_MD_RE.source, "g");
  while ((m = mdRe.exec(text)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length, url: m[2], alt: m[1] });
  }
  const urlRe = new RegExp(`(${IMAGE_URL_RE.source})|(${GIPHY_RE.source})`, "gi");
  while ((m = urlRe.exec(text)) !== null) {
    const url = m[0];
    // Skip if already covered by a markdown token
    if (tokens.some((t) => m!.index >= t.start && m!.index < t.end)) continue;
    tokens.push({ start: m.index, end: m.index + url.length, url, alt: "" });
  }
  tokens.sort((a, b) => a.start - b.start);

  let pos = 0;
  for (const tok of tokens) {
    if (tok.start > pos) parts.push({ type: "text", content: text.slice(pos, tok.start) });
    parts.push({ type: "image", content: tok.url, alt: tok.alt });
    pos = tok.end;
  }
  if (pos < text.length) parts.push({ type: "text", content: text.slice(pos) });
  return parts.length > 0 ? parts : [{ type: "text", content: text }];
}

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
      const firstField = formRef.current.querySelector<HTMLTextAreaElement | HTMLInputElement>("textarea, input[type='text']");
      if (firstField) {
        setTimeout(() => firstField.focus(), 250);
      }
    }
  }, []);

  return (
    <div className="ml-4 sm:ml-8 mb-2 animate-[reply-slide-in_0.25s_ease-out]" ref={formRef}>
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
  readOnly = false,
}: {
  commentaires: Commentaire[];
  date: string;
  platIndex: number;
  readOnly?: boolean;
}) {
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { childrenMap, topLevel } = buildCommentTree(commentaires);
  const fullFlatList = flattenTree(topLevel, childrenMap);
  const COLLAPSED_COUNT = 3;
  const shouldCollapse = fullFlatList.length > COLLAPSED_COUNT && !showAll;
  const flatList = shouldCollapse ? fullFlatList.slice(0, COLLAPSED_COUNT) : fullFlatList;
  const hiddenCount = fullFlatList.length - flatList.length;

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
                  className={depth > 0 ? "border-l-2 border-l-[var(--accent)]/40 pl-2 sm:pl-3" : ""}
                  style={depth > 0 ? { marginLeft: `${Math.min((depth - 1) * 1.5 + 1, 4)}rem` } : undefined}
                >
                  <div className={`flex items-start gap-2.5 py-1.5 ${depth > 0 ? "py-1" : "py-2"}`}>
                    <Avatar className={`shrink-0 text-xs ${depth > 0 ? "w-6 h-6" : "w-7 h-7"}`}>
                      {AVATAR_IMAGE[c.auteur] && (
                        <AvatarImage src={AVATAR_IMAGE[c.auteur]} alt={c.auteur} />
                      )}
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
                      {c.is_human ? (
                        <span
                          title="Écrit par un humain"
                          className="inline-flex items-center gap-0.5 align-middle text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 mr-1.5 rounded-full bg-[var(--accent-glow)] text-[var(--accent)] border border-[var(--accent)]/30"
                        >
                          ✋ humain
                        </span>
                      ) : (
                        <span
                          title="Généré par l'IA"
                          className="inline-flex items-center gap-0.5 align-middle text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 mr-1.5 rounded-full bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)]"
                        >
                          🤖 ia
                        </span>
                      )}
                      {parseCommentText(c.texte).map((part, i) =>
                        part.type === "text" ? (
                          <span key={i} className="text-[var(--text-secondary)] whitespace-pre-wrap">{part.content}</span>
                        ) : (
                          (() => {
                            const tenorId = tenorEmbedId(part.content);
                            return (
                              <div key={i} className="mt-1.5">
                                {tenorId ? (
                                  <iframe
                                    src={`https://tenor.com/embed/${tenorId}`}
                                    className="w-full max-w-[300px] h-[250px] rounded-[var(--radius-sm)] border border-[var(--border)]"
                                    loading="lazy"
                                    allow="encrypted-media"
                                  />
                                ) : (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img
                                    src={part.content}
                                    alt={part.alt || "image"}
                                    className="w-full max-w-[300px] max-h-[250px] rounded-[var(--radius-sm)] border border-[var(--border)] object-contain cursor-pointer transition-transform hover:scale-[1.02]"
                                    loading="lazy"
                                  />
                                )}
                              </div>
                            );
                          })()
                        )
                      )}
                      {c.image_url && (
                        <div className="mt-1.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={c.image_url}
                            alt="image"
                            className="w-full max-w-[300px] max-h-[250px] rounded-[var(--radius-sm)] border border-[var(--border)] object-contain cursor-pointer transition-transform hover:scale-[1.02]"
                            loading="lazy"
                          />
                        </div>
                      )}
                      {!readOnly && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setReplyingTo(replyingTo === index ? null : index)}
                          className="text-[var(--text-muted)] text-xs h-auto p-0 ml-2 hover:text-[var(--accent)] hover:bg-transparent"
                        >
                          Répondre
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {!readOnly && replyingTo === index && (
                  <div
                    className={depth >= 0 ? "border-l-2 border-l-[var(--accent)]/40 pl-2 sm:pl-3" : ""}
                    style={{ marginLeft: `${Math.min(depth * 1.5 + 1, 4.5)}rem` }}
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
          {(hiddenCount > 0 || showAll) && fullFlatList.length > COLLAPSED_COUNT && (
            <div className="mt-1 mb-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAll(!showAll)}
                className="text-[var(--text-muted)] text-xs h-auto py-1 px-2 hover:text-[var(--accent)] hover:bg-transparent"
              >
                {showAll
                  ? "Masquer les commentaires"
                  : `Afficher ${hiddenCount} commentaire${hiddenCount > 1 ? "s" : ""} de plus`}
              </Button>
            </div>
          )}
        </div>
      )}

      {!readOnly && replyingTo === null && (
        <CommentForm date={date} platIndex={platIndex} />
      )}
    </>
  );
}
