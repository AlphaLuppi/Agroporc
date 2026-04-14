"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Drawer } from "@/components/ui/drawer";
import { CHARACTERS_BY_NAME } from "@/lib/characters";
import type { IaProfile } from "@/lib/db";

const CHARACTER_STORAGE_KEY = "pdj-selected-character";

function timeAgo(iso?: string): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff)) return null;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString("fr-FR");
}

export default function IaProfilesList({ initialProfiles }: { initialProfiles: IaProfile[] }) {
  const [profiles, setProfiles] = useState<IaProfile[]>(initialProfiles);
  const [editorNom, setEditorNom] = useState<string | null>(null);
  const [editor, setEditor] = useState<string>("");
  const dirtyRef = useRef(false);

  useEffect(() => {
    try {
      const s = localStorage.getItem(CHARACTER_STORAGE_KEY);
      if (s) setEditor(s);
    } catch {}
  }, []);

  function requireEditor(): boolean {
    if (!editor) {
      alert("Choisissez d'abord votre personnage en haut de la page.");
      return false;
    }
    return true;
  }

  async function toggleActif(p: IaProfile) {
    if (!requireEditor()) return;
    const next = { ...p, actif: !p.actif };
    setProfiles((list) => list.map((x) => (x.nom === p.nom ? next : x)));
    try {
      const res = await fetch("/api/ia", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nom: p.nom, updated_by: editor, profile: { actif: next.actif } }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setProfiles((list) => list.map((x) => (x.nom === p.nom ? p : x)));
      alert("Erreur lors de la mise à jour");
    }
  }

  function openEditor(nom: string) {
    if (!requireEditor()) return;
    dirtyRef.current = false;
    setEditorNom(nom);
  }

  function requestCloseEditor() {
    if (dirtyRef.current) {
      const ok = window.confirm("Modifications non enregistrées. Fermer quand même ?");
      if (!ok) return;
    }
    dirtyRef.current = false;
    setEditorNom(null);
  }

  function handleSaved(updated: IaProfile) {
    setProfiles((list) => list.map((x) => (x.nom === updated.nom ? updated : x)));
    dirtyRef.current = false;
    setEditorNom(null);
  }

  const currentEditorChar = editor ? CHARACTERS_BY_NAME[editor] : null;

  return (
    <div className="space-y-3">
      <div className="sticky top-2 z-10 flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur px-3 py-2 text-xs text-[var(--text-muted)]"
           style={{ boxShadow: "var(--shadow)" }}>
        <span>Vous éditez en tant que</span>
        {currentEditorChar && (
          <Avatar className="h-6 w-6">
            {currentEditorChar.image && <AvatarImage src={currentEditorChar.image} alt={editor} />}
            <AvatarFallback style={{ background: currentEditorChar.color, color: "white", fontSize: 11 }}>
              {currentEditorChar.emoji || editor.charAt(0)}
            </AvatarFallback>
          </Avatar>
        )}
        <select
          value={editor}
          onChange={(e) => {
            setEditor(e.target.value);
            try {
              localStorage.setItem(CHARACTER_STORAGE_KEY, e.target.value);
            } catch {}
          }}
          className="bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
        >
          <option value="">— Choisir —</option>
          {Object.keys(CHARACTERS_BY_NAME).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {!editor && (
          <span className="text-[var(--bad)] ml-auto">Obligatoire pour modifier</span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {profiles.map((p) => (
          <ProfileCard
            key={p.nom}
            profile={p}
            onEdit={() => openEditor(p.nom)}
            onToggleActif={() => toggleActif(p)}
          />
        ))}
      </div>

      <Drawer
        open={editorNom !== null}
        onClose={requestCloseEditor}
        title={editorNom ? `Modifier ${profiles.find((p) => p.nom === editorNom)?.prenom ?? ""}` : ""}
      >
        {editorNom &&
          (() => {
            const p = profiles.find((x) => x.nom === editorNom);
            if (!p) return null;
            return (
              <ProfileEditor
                key={p.nom}
                profile={p}
                editor={editor}
                onDirtyChange={(d) => {
                  dirtyRef.current = d;
                }}
                onCancel={requestCloseEditor}
                onSaved={handleSaved}
              />
            );
          })()}
      </Drawer>
    </div>
  );
}

function ProfileCard({
  profile,
  onEdit,
  onToggleActif,
}: {
  profile: IaProfile;
  onEdit: () => void;
  onToggleActif: () => void;
}) {
  const avatar = CHARACTERS_BY_NAME[profile.prenom];
  const imageSrc = profile.avatar_url || avatar?.image;
  const when = timeAgo(profile.updated_at);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit();
        }
      }}
      className="cursor-pointer rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden transition-all hover:border-[var(--accent)] hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      style={{
        boxShadow: "var(--shadow)",
        borderLeft: `4px solid ${profile.couleur || "var(--border)"}`,
        opacity: profile.actif ? 1 : 0.75,
      }}
    >
      <div className="flex items-center gap-3 p-4">
        <Avatar className="h-11 w-11 shrink-0">
          {imageSrc && <AvatarImage src={imageSrc} alt={profile.prenom} />}
          <AvatarFallback
            style={{ background: profile.couleur, color: "white", fontSize: 18 }}
          >
            {profile.emoji || profile.prenom.charAt(0)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[var(--text)] truncate">
              {profile.prenom}
            </span>
            <span className="text-base">{profile.emoji}</span>
            {!profile.actif && (
              <span className="text-[0.65rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--border)] text-[var(--text-muted)]">
                Inactif
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--text-muted)] truncate">{profile.role}</div>
          {(profile.updated_by || when) && (
            <div className="text-[0.65rem] text-[var(--text-muted)] truncate mt-0.5">
              {profile.updated_by ? `modifié par ${profile.updated_by}` : "modifié"}
              {when ? ` · ${when}` : ""}
            </div>
          )}
        </div>
        <label
          className="flex items-center gap-2 cursor-pointer select-none text-xs"
          aria-label="Activer l'agent"
          onClick={(e) => e.stopPropagation()}
        >
          <span
            role="switch"
            aria-checked={profile.actif}
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onToggleActif();
            }}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                onToggleActif();
              }
            }}
            className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            style={{ background: profile.actif ? "var(--accent)" : "var(--border)" }}
          >
            <span
              className="inline-block h-5 w-5 rounded-full bg-white transition-transform"
              style={{ transform: profile.actif ? "translateX(22px)" : "translateX(2px)" }}
            />
          </span>
        </label>
      </div>
    </div>
  );
}

function ProfileEditor({
  profile,
  editor,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  profile: IaProfile;
  editor: string;
  onSaved: (p: IaProfile) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const initial = {
    prenom: profile.prenom,
    emoji: profile.emoji,
    couleur: profile.couleur,
    avatar_url: profile.avatar_url ?? "",
    role: profile.role,
    personnalite: profile.personnalite,
    style_de_parole: profile.style_de_parole,
    traits: (profile.traits ?? []) as string[],
    sujets_fetiches: (profile.sujets_fetiches ?? []) as string[],
    blagues_recurrentes: (profile.blagues_recurrentes ?? []) as string[],
    gifs: (profile.gifs_fetiches ?? []) as string[],
  };
  const [form, setForm] = useState(initial);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    onDirtyChange(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    try {
      const body = {
        nom: profile.nom,
        updated_by: editor,
        profile: {
          prenom: form.prenom,
          emoji: form.emoji,
          couleur: form.couleur,
          role: form.role,
          personnalite: form.personnalite,
          style_de_parole: form.style_de_parole,
          traits: form.traits,
          sujets_fetiches: form.sujets_fetiches,
          blagues_recurrentes: form.blagues_recurrentes,
          gifs_fetiches: form.gifs,
          avatar_url: form.avatar_url.trim(),
          actif: profile.actif,
        },
      };
      const res = await fetch("/api/ia", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "Erreur");
        setLoading(false);
        return;
      }
      onSaved(data.profile);
    } catch {
      setErr("Erreur de connexion");
      setLoading(false);
    }
  }

  const textareaClass =
    "w-full bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-y";

  const MAX_PERSONNALITE = 1000;
  const MAX_STYLE = 500;
  const MAX_ROLE = 200;

  const steps = [
    { key: "identite", label: "Identité" },
    { key: "personnalite", label: "Personnalité" },
    { key: "traits", label: "Traits" },
    { key: "sujets", label: "Sujets fétiches" },
    { key: "blagues", label: "Blagues" },
    { key: "gifs", label: "Gifs" },
  ] as const;

  const isLast = step === steps.length - 1;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-[var(--text-secondary)]">
            Étape {step + 1} / {steps.length} · {steps[step].label}
          </span>
        </div>
        <div className="flex gap-1">
          {steps.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStep(i)}
              aria-label={`Aller à l'étape ${s.label}`}
              className="flex-1 flex items-center justify-center py-2 group"
            >
              <span
                className="block w-full h-2 rounded-full transition-colors group-hover:opacity-80"
                style={{
                  background: i <= step ? "var(--accent)" : "var(--border)",
                }}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-3 overflow-y-auto">
        {step === 0 && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Prénom">
                <Input
                  value={form.prenom}
                  onChange={(e) => update("prenom", e.target.value)}
                  maxLength={80}
                />
              </Field>
              <Field label="Emoji">
                <Input
                  value={form.emoji}
                  onChange={(e) => update("emoji", e.target.value)}
                  maxLength={8}
                />
              </Field>
              <Field label="Couleur">
                <Input
                  type="color"
                  value={form.couleur || "#888888"}
                  onChange={(e) => update("couleur", e.target.value)}
                  className="h-9 p-1 cursor-pointer"
                />
              </Field>
            </div>

            <Field label="Photo de profil" hint="URL vers une image — laisser vide pour la photo par défaut">
              <div className="flex items-center gap-3">
                <Avatar className="h-14 w-14 shrink-0">
                  {(form.avatar_url || CHARACTERS_BY_NAME[form.prenom]?.image) && (
                    <AvatarImage
                      src={form.avatar_url || CHARACTERS_BY_NAME[form.prenom]?.image}
                      alt={form.prenom}
                    />
                  )}
                  <AvatarFallback
                    style={{ background: form.couleur, color: "white", fontSize: 20 }}
                  >
                    {form.emoji || form.prenom.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <Input
                  placeholder="https://…"
                  value={form.avatar_url}
                  onChange={(e) => update("avatar_url", e.target.value)}
                  maxLength={500}
                  className="flex-1"
                />
              </div>
            </Field>

            <Field label="Rôle" hint={`${form.role.length} / ${MAX_ROLE}`}>
              <Input
                value={form.role}
                onChange={(e) => update("role", e.target.value)}
                maxLength={MAX_ROLE}
              />
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <Field label="Personnalité" hint={`${form.personnalite.length} / ${MAX_PERSONNALITE}`}>
              <textarea
                className={textareaClass}
                rows={4}
                maxLength={MAX_PERSONNALITE}
                value={form.personnalite}
                onChange={(e) => update("personnalite", e.target.value)}
              />
            </Field>
            <Field label="Style de parole" hint={`${form.style_de_parole.length} / ${MAX_STYLE}`}>
              <textarea
                className={textareaClass}
                rows={3}
                maxLength={MAX_STYLE}
                value={form.style_de_parole}
                onChange={(e) => update("style_de_parole", e.target.value)}
              />
            </Field>
          </>
        )}

        {step === 2 && (
          <ListField
            label="Traits"
            placeholder="Ex. Arrive en retard avec une excuse improbable"
            items={form.traits}
            onChange={(v) => update("traits", v)}
          />
        )}

        {step === 3 && (
          <ListField
            label="Sujets fétiches"
            placeholder="Ex. Ses chats Bibou et Babou"
            items={form.sujets_fetiches}
            onChange={(v) => update("sujets_fetiches", v)}
          />
        )}

        {step === 4 && (
          <ListField
            label="Blagues récurrentes"
            placeholder="Ex. Prétend que ses pets viennent du futur"
            items={form.blagues_recurrentes}
            onChange={(v) => update("blagues_recurrentes", v)}
          />
        )}

        {step === 5 && (
          <Field label="Gifs / photos fétiches" hint="URL directe d'une image ou d'un gif (Tenor, Giphy, .gif/.jpg/.png)">
            <GifListField
              items={form.gifs}
              onChange={(v) => update("gifs", v)}
            />
          </Field>
        )}

        {err && <div className="text-xs text-[var(--bad)]">{err}</div>}
      </div>

      <div className="sticky bottom-0 px-4 py-3 flex gap-2 bg-[var(--surface)]/95 backdrop-blur border-t border-[var(--border)]">
        {step === 0 ? (
          <Button type="button" variant="ghost" onClick={onCancel} className="flex-1">
            Annuler
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="flex-1"
          >
            Précédent
          </Button>
        )}
        {isLast ? (
          <Button type="submit" disabled={loading} className="flex-1">
            {loading ? "Enregistrement…" : "Enregistrer"}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
            className="flex-1"
          >
            Suivant
          </Button>
        )}
      </div>
    </form>
  );
}

function ListField({
  label,
  placeholder,
  items,
  onChange,
}: {
  label: string;
  placeholder?: string;
  items: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (items.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...items, v]);
    setDraft("");
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      <span className="text-xs font-semibold text-[var(--text-secondary)]">
        {label} <span className="text-[var(--text-muted)] font-normal">({items.length})</span>
      </span>
      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="flex-1"
        />
        <Button type="button" onClick={add} disabled={!draft.trim()}>
          Ajouter
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] italic">Aucun élément pour l'instant.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li
              key={`${item}-${i}`}
              className="group flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            >
              <span className="flex-1 text-sm text-[var(--text)] break-words">{item}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Supprimer : ${item}`}
                className="shrink-0 h-7 w-7 rounded-full text-[var(--text-muted)] hover:text-[var(--bad)] hover:bg-[var(--surface-hover)] flex items-center justify-center transition-colors"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GifListField({
  items,
  onChange,
}: {
  items: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const url = draft.trim();
    if (!url) return;
    if (items.includes(url)) {
      setDraft("");
      return;
    }
    onChange([...items, url]);
    setDraft("");
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <div className="flex gap-2">
        <Input
          placeholder="https://media.tenor.com/..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="flex-1"
        />
        <Button type="button" onClick={add} disabled={!draft.trim()}>
          Ajouter
        </Button>
      </div>
      {items.length > 0 && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {items.map((url, i) => {
            const tenorMatch = url.match(/tenor\.com\/(?:[a-z]{2}\/)?view\/[^/?#]*-(\d+)(?:[/?#]|$)/i);
            const tenorId = tenorMatch ? tenorMatch[1] : null;
            return (
            <div
              key={`${url}-${i}`}
              className="group relative aspect-square overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)]"
            >
              {tenorId ? (
                <iframe
                  src={`https://tenor.com/embed/${tenorId}`}
                  className="absolute inset-0 h-full w-full"
                  loading="lazy"
                  allow="encrypted-media"
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={url}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
              )}
              <button
                type="button"
                aria-label="Retirer"
                onClick={() => remove(i)}
                className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/70 text-white text-xs flex items-center justify-center opacity-100 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              >
                ×
              </button>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-[var(--text-secondary)]">{label}</span>
      {children}
      {hint && <span className="block text-[0.65rem] text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}
