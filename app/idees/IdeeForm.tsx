"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChevronDown } from "lucide-react";
import { CHARACTERS, CHARACTERS_BY_NAME, type Character } from "@/lib/characters";

const CHARACTER_STORAGE_KEY = "pdj-selected-character";

export default function IdeeForm() {
  const [character, setCharacter] = useState<Character>(CHARACTERS[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [texte, setTexte] = useState("");
  const [website, setWebsite] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CHARACTER_STORAGE_KEY);
      if (stored && CHARACTERS_BY_NAME[stored]) {
        setCharacter(CHARACTERS_BY_NAME[stored]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [pickerOpen]);

  function selectCharacter(c: Character) {
    setCharacter(c);
    setPickerOpen(false);
    try {
      localStorage.setItem(CHARACTER_STORAGE_KEY, c.name);
    } catch {
      /* ignore */
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!texte.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/idees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auteur: character.name,
          texte: texte.trim(),
          website,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Erreur");
        setLoading(false);
        return;
      }

      window.location.reload();
    } catch {
      setError("Erreur de connexion");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3"
    >
      {/* Honeypot */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        autoComplete="off"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute -left-[9999px] opacity-0 h-0 w-0"
      />

      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="w-full flex items-center gap-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--text)] hover:border-[var(--accent)] focus:border-[var(--accent)] focus:outline-none transition-colors"
        >
          <Avatar className="shrink-0 w-6 h-6 text-xs">
            {character.image && <AvatarImage src={character.image} alt={character.name} />}
            <AvatarFallback style={{ background: character.color }} className="text-xs">
              {character.emoji}
            </AvatarFallback>
          </Avatar>
          <span className="flex-1 text-left truncate">
            <span className="text-[var(--text-secondary)] opacity-60 text-xs mr-1">en tant que</span>
            <span className="font-semibold">{character.name}</span>
          </span>
          <ChevronDown
            className={`size-4 text-[var(--text-secondary)] transition-transform ${pickerOpen ? "rotate-180" : ""}`}
          />
        </button>
        {pickerOpen && (
          <div
            role="listbox"
            className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg py-1"
          >
            {CHARACTERS.map((c) => {
              const selected = c.name === character.name;
              return (
                <button
                  key={c.name}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => selectCharacter(c)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-left hover:bg-[var(--accent-glow)] transition-colors ${
                    selected ? "bg-[var(--accent-glow)] text-[var(--accent)]" : "text-[var(--text)]"
                  }`}
                >
                  <Avatar className="shrink-0 w-6 h-6 text-xs">
                    {c.image && <AvatarImage src={c.image} alt={c.name} />}
                    <AvatarFallback style={{ background: c.color }} className="text-xs">
                      {c.emoji}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate font-medium">{c.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <textarea
        placeholder="Votre idée d'amélioration..."
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
          }
        }}
        maxLength={500}
        required
        rows={3}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-secondary)] placeholder:opacity-60 focus:border-[var(--accent)] focus:outline-none resize-y"
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)]">
          {texte.length}/500
        </span>
        <Button
          type="submit"
          size="sm"
          disabled={loading || !texte.trim()}
          className="bg-[var(--accent)] text-[var(--bg)] font-semibold hover:bg-[var(--accent)]/90 disabled:opacity-40"
        >
          {loading ? "..." : "Proposer"}
        </Button>
      </div>

      {error && <p className="text-[var(--bad)] text-sm m-0">{error}</p>}
    </form>
  );
}
