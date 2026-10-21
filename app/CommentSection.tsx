"use client";

import { useState, useRef, useEffect } from "react";
import type { Commentaire } from "@/lib/db";
import { avatarAuteur, type AvatarIa } from "@/lib/characters";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import CommentForm from "./CommentForm";
import styles from "./commentaires.module.css";

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

/** Image chargée après l'hydratation : déclenche le léger scale d'entrée (cf. .media[data-charge]). */
function marquerCharge(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.dataset.charge = "1";
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
    <div className={`ml-4 sm:ml-8 mb-2 ${styles.replyIn}`} ref={formRef}>
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
  avatars,
}: {
  commentaires: Commentaire[];
  date: string;
  platIndex: number;
  readOnly?: boolean;
  /** Repères des personnages IA en base (photo ajoutée depuis /ia). */
  avatars?: Record<string, AvatarIa>;
}) {
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Filtre défensif : on a déjà observé en prod des entrées malformées
  // (strings au lieu d'objets) renvoyées par le pipeline sur des jours
  // particuliers. Sans ça, l'expand crash à l'accès de c.auteur.
  const safeCommentaires = (commentaires ?? []).filter(
    (c): c is Commentaire =>
      c != null && typeof c === "object" && typeof (c as Commentaire).auteur === "string"
  );
  const { childrenMap, topLevel } = buildCommentTree(safeCommentaires);
  const flatList = flattenTree(topLevel, childrenMap);
  const totalCount = flatList.length;

  if (!expanded) {
    if (readOnly && totalCount === 0) return null;
    return (
      <div className="mt-4">
        <Separator className="mb-2 bg-[var(--border)]" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(true)}
          className={`pdj-press ${styles.pressCouleurs} ${styles.replie} text-[var(--text-muted)] text-xs h-auto py-1.5 px-2 hover:text-[var(--accent)] hover:bg-transparent`}
        >
          <span className={styles.bulle} aria-hidden="true">💬</span>{" "}
          {totalCount === 0
            ? "Laisser un commentaire"
            : `${totalCount} commentaire${totalCount > 1 ? "s" : ""}`}
        </Button>
      </div>
    );
  }

  return (
    <>
      {safeCommentaires.length > 0 && (
        <div className="mt-4">
          <Separator className="mb-3 bg-[var(--border)]" />
          {flatList.map(({ index, depth }, pos) => {
            const c = safeCommentaires[index];
            const avatar = avatarAuteur(c.auteur, avatars);
            const showTopSeparator = depth === 0 && pos > 0 && flatList[pos - 1].depth === 0;
            // Entrée en cascade : 35 ms par ligne, plafonnée à 8 (cf. .ligne/.reponse)
            const rang = { "--i": Math.min(pos, 8) } as React.CSSProperties;

            return (
              <div key={index}>
                {showTopSeparator && (
                  <Separator className="my-1 bg-[var(--border)] opacity-40" />
                )}
                <div
                  className={depth > 0 ? `${styles.reponse} pl-2 sm:pl-3` : `pdj-rise-in ${styles.ligne}`}
                  style={depth > 0 ? { ...rang, marginLeft: `${Math.min((depth - 1) * 1.5 + 1, 4)}rem` } : rang}
                >
                  <div className={`flex items-start gap-2.5 py-1.5 ${depth > 0 ? "py-1" : "py-2"}`}>
                    <Avatar className={`${styles.avatar} shrink-0 text-xs ${depth > 0 ? "w-6 h-6" : "w-7 h-7"}`}>
                      {avatar.image && <AvatarImage src={avatar.image} alt={c.auteur} />}
                      <AvatarFallback style={{ background: avatar.couleur }} className="text-xs">
                        {avatar.emoji}
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
                          className={`${styles.badgeHumain} inline-flex items-center gap-0.5 align-middle text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 mr-1.5 rounded-full bg-[var(--accent-glow)] text-[var(--accent)] border border-[var(--accent)]/30`}
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
                                    className={`${styles.media} w-full max-w-[300px] max-h-[250px] rounded-[var(--radius-sm)] border border-[var(--border)] object-contain cursor-pointer`}
                                    loading="lazy"
                                    onLoad={marquerCharge}
                                  />
                                )}
                              </div>
                            );
                          })()
                        )
                      )}
                      {c.image_url && (() => {
                        const tenorId = tenorEmbedId(c.image_url);
                        return (
                          <div className="mt-1.5">
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
                                src={c.image_url}
                                alt="image"
                                className={`${styles.media} w-full max-w-[300px] max-h-[250px] rounded-[var(--radius-sm)] border border-[var(--border)] object-contain cursor-pointer`}
                                loading="lazy"
                                onLoad={marquerCharge}
                              />
                            )}
                          </div>
                        );
                      })()}
                      {!readOnly && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setReplyingTo(replyingTo === index ? null : index)}
                          aria-expanded={replyingTo === index}
                          className={`pdj-press ${styles.pressCouleurs} ${styles.souligne} text-[var(--text-muted)] text-xs h-auto p-0 ml-2 hover:text-[var(--accent)] hover:bg-transparent`}
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
        </div>
      )}

      {!readOnly && replyingTo === null && (
        <CommentForm date={date} platIndex={platIndex} />
      )}

      <div className="mt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(false)}
          className="text-[var(--text-muted)] text-xs h-auto py-1 px-2 hover:text-[var(--accent)] hover:bg-transparent"
        >
          Masquer les commentaires
        </Button>
      </div>
    </>
  );
}
