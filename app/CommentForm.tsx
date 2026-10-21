"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ImagePlus, X, Upload, ChevronDown } from "lucide-react";
import { CHARACTERS, CHARACTERS_BY_NAME, type Character } from "@/lib/characters";
import { etatCompteur, gerbe, prefereMoinsDeMouvement } from "@/lib/motion-commentaires";
import styles from "./commentaires.module.css";

const CHARACTER_STORAGE_KEY = "pdj-selected-character";
const MAX_TEXTE = 500;
/** Délai entre « Envoyé ✓ » et le rechargement (0 sous prefers-reduced-motion). */
const DELAI_RELOAD_MS = 450;
const GERBE = gerbe(8, 26);
const COULEURS_GERBE = ["var(--good)", "var(--accent)", "var(--ok)"];

function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

export default function CommentForm({
  date,
  platIndex,
  reponseA,
  reponseAIndex,
  onCancel,
}: {
  date: string;
  platIndex: number;
  reponseA?: string;
  reponseAIndex?: number;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(!!reponseA);
  const [character, setCharacter] = useState<Character>(CHARACTERS[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [texte, setTexte] = useState("");
  const [website, setWebsite] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [envoye, setEnvoye] = useState(false);
  const [gerbeVisible, setGerbeVisible] = useState(false);
  // Incrémenté à chaque erreur : rejoue l'entrée du message
  const [erreurN, setErreurN] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [showImageInput, setShowImageInput] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Restaurer le dernier personnage sélectionné depuis localStorage
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

  // Fermer le dropdown au clic extérieur
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

  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Ce fichier n'est pas une image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image trop lourde (max 5 Mo)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageUrl(reader.result as string);
      setShowImageInput(true);
      setImageError(false);
      setError("");
    };
    reader.readAsDataURL(file);
  }, []);

  function handleCancel() {
    if (onCancel) {
      onCancel();
    } else {
      setOpen(false);
    }
    setTexte("");
    setImageUrl("");
    setShowImageInput(false);
    setImageError(false);
    setError("");
    setPickerOpen(false);
  }

  if (!open) {
    return (
      <button
        className={`pdj-press ${styles.ajouter} mt-3 w-full border border-dashed border-[var(--border-control)] rounded-[var(--radius)] text-[var(--text-secondary)] py-2 px-3 text-sm cursor-pointer bg-transparent hover:border-[var(--accent)] hover:text-[var(--accent)]`}
        onClick={() => setOpen(true)}
      >
        <span className={styles.plus} aria-hidden="true">+</span> Ajouter un commentaire
      </button>
    );
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) processFile(file);
        return;
      }
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  /** Erreur d'envoi : message + petit shake du formulaire (WAAPI, sauf reduce). */
  function signalerErreur(message: string) {
    setError(message);
    setErreurN((n) => n + 1);
    const form = formRef.current;
    if (!form || prefereMoinsDeMouvement() || typeof form.animate !== "function") return;
    form.animate(
      [
        { translate: "0 0" },
        { translate: "-4px 0" },
        { translate: "4px 0" },
        { translate: "-4px 0" },
        { translate: "4px 0" },
        { translate: "-2px 0" },
        { translate: "0 0" },
      ],
      { duration: 280, easing: "ease-in-out" }
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (envoye || !character || (!texte.trim() && !imageUrl)) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/commentaire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          platIndex,
          auteur: character.name,
          texte: texte.trim(),
          website,
          ...(imageUrl ? { image_url: imageUrl } : {}),
          ...(reponseA ? { reponse_a: reponseA } : {}),
          ...(reponseAIndex !== undefined ? { reponse_a_index: reponseAIndex } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setLoading(false);
        signalerErreur(data.error || "Erreur");
        return;
      }

      // Succès : « Envoyé ✓ » (pop + gerbe) le temps de le voir, puis rechargement.
      // Le bouton reste désactivé pendant le délai (pas de double envoi).
      const reduit = prefereMoinsDeMouvement();
      setLoading(false);
      setEnvoye(true);
      setGerbeVisible(!reduit);
      window.setTimeout(() => window.location.reload(), reduit ? 0 : DELAI_RELOAD_MS);
    } catch {
      setLoading(false);
      signalerErreur("Erreur de connexion");
    }
  }

  const compteur = etatCompteur(texte.length, MAX_TEXTE);

  const formContent = (
    <form
      ref={formRef}
      className={isMobile ? "flex flex-col gap-3" : `mt-3 flex flex-col gap-2${reponseA ? "" : " pdj-rise-in"}`}
      onSubmit={handleSubmit}
    >
      {reponseA && (
        <div className="text-xs text-[var(--accent)] px-2 py-1.5 bg-[var(--accent-soft)] rounded-[var(--radius-sm)] border-l-[3px] border-l-[var(--accent)]">
          ↩ En réponse à {reponseA}
        </div>
      )}
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
          className="w-full flex items-center gap-2 bg-[var(--surface)] border border-[var(--border-control)] rounded-[var(--radius)] px-2.5 py-1.5 text-sm text-[var(--text)] hover:border-[var(--accent)] focus:border-[var(--accent)] transition-colors"
          aria-haspopup="listbox"
          aria-expanded={pickerOpen}
        >
          <Avatar key={character.name} className={`${styles.avatarChoisi} shrink-0 w-6 h-6 text-xs`}>
            {character.image && <AvatarImage src={character.image} alt={character.name} />}
            <AvatarFallback style={{ background: character.color }} className="text-xs">
              {character.emoji}
            </AvatarFallback>
          </Avatar>
          <span className="flex-1 text-left truncate">
            <span className="text-[var(--text-muted)] text-xs mr-1">en tant que</span>
            <span className="font-semibold">{character.name}</span>
          </span>
          <ChevronDown
            className={`${styles.chevron} size-4 text-[var(--text-secondary)] ${pickerOpen ? "rotate-180" : ""}`}
          />
        </button>
        {pickerOpen && (
          <div
            role="listbox"
            className={`${styles.liste} absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] shadow-lg py-1`}
          >
            {CHARACTERS.map((c, i) => {
              const selected = c.name === character.name;
              return (
                <button
                  key={c.name}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => selectCharacter(c)}
                  style={{ "--i": i } as React.CSSProperties}
                  className={`${styles.option} w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-left hover:bg-[var(--accent-soft)] transition-colors ${
                    selected ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--text)]"
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
      <div className="relative">
      <textarea
        placeholder={reponseA ? `Répondre à ${reponseA}...` : "Votre commentaire"}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
          }
        }}
        maxLength={MAX_TEXTE}
        required={!imageUrl}
        rows={3}
        className={`${styles.zone} block w-full min-w-0 rounded-lg border border-[var(--border-control)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent)] resize-y`}
      />
      {compteur !== "cache" && (
        <span className={`${styles.compteur} ${compteur === "limite" ? styles.compteurLimite : ""}`}>
          {texte.length}/{MAX_TEXTE}
        </span>
      )}
      </div>

      <input
        type="file"
        ref={fileInputRef}
        accept="image/gif,image/png,image/jpeg,image/webp"
        onChange={handleFilePick}
        className="hidden"
        aria-label="Choisir une image"
      />

      {!imageUrl && !showImageInput && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowImageInput(true)}
          className="bg-[var(--surface)] border-[var(--border-control)] text-[var(--text-secondary)] text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] w-fit"
        >
          <ImagePlus className="size-3.5" />
          Image / GIF
        </Button>
      )}

      {showImageInput && !imageUrl && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`${styles.depot} pdj-press flex flex-col items-center justify-center gap-1.5 py-5 px-4 rounded-[var(--radius)] border-2 border-dashed cursor-pointer bg-transparent ${
            dragOver
              ? `${styles.depotActif} border-[var(--accent)] bg-[var(--accent-soft)]`
              : "border-[var(--border-control)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
          }`}
        >
          <Upload className={`${styles.icone} size-5 ${dragOver ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`} />
          <span className="text-xs text-[var(--text-secondary)]">
            Cliquer ou glisser-déposer une image
          </span>
          <span className="text-[0.65rem] text-[var(--text-muted)]">
            PNG, JPG, GIF, WebP · 5 Mo max
          </span>
        </button>
      )}

      {imageUrl && (
        <div className={`${styles.apercu} relative inline-block max-w-[200px]`}>
          {!imageError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt="Aperçu"
              className="max-w-[200px] max-h-[150px] rounded-[var(--radius-sm)] border border-[var(--border)] object-contain"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="text-xs text-[var(--bad)] p-2 bg-[var(--bad-bg)] rounded-[var(--radius-sm)]">
              Impossible de charger l&apos;image
            </div>
          )}
          <button
            type="button"
            onClick={() => { setImageUrl(""); setShowImageInput(false); setImageError(false); }}
            className={`${styles.fermer} absolute -top-1.5 -right-1.5 bg-[var(--surface)] border border-[var(--border-control)] text-[var(--text-secondary)] rounded-full w-5 h-5 cursor-pointer flex items-center justify-center hover:text-[var(--bad)] hover:border-[var(--bad)] transition-colors`}
            aria-label="Supprimer l'image"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      <div className="flex gap-2 justify-end">
        {!isMobile && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            className="text-[var(--text-secondary)]"
          >
            Annuler
          </Button>
        )}
        <span className={isMobile ? styles.envoiPlein : styles.envoi}>
          <Button
            type="submit"
            size="sm"
            disabled={loading || envoye || (!texte.trim() && !imageUrl)}
            aria-live="polite"
            className={`pdj-press ${styles.pressCouleurs} bg-[var(--accent)] text-[var(--accent-text)] font-semibold hover:bg-[var(--accent)]/90 disabled:opacity-100 disabled:bg-[var(--surface-hover)] disabled:text-[var(--text-muted)] disabled:border-[var(--border-control)] ${envoye ? styles.envoye : ""} ${isMobile ? "w-full h-10 text-sm" : ""}`}
          >
            {envoye ? (
              "Envoyé ✓"
            ) : loading ? (
              <>
                <span className={styles.points} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="sr-only">Envoi…</span>
              </>
            ) : (
              "Envoyer"
            )}
          </Button>
          {gerbeVisible && (
            <span className={styles.gerbe} aria-hidden="true">
              {GERBE.map((p, i) => (
                <span
                  key={i}
                  style={
                    {
                      "--dx": `${p.dx}px`,
                      "--dy": `${p.dy}px`,
                      background: COULEURS_GERBE[i % COULEURS_GERBE.length],
                    } as React.CSSProperties
                  }
                />
              ))}
            </span>
          )}
        </span>
      </div>
      {error && (
        <p key={erreurN} role="alert" className="pdj-rise-in text-[var(--bad)] text-sm m-0">
          {error}
        </p>
      )}
    </form>
  );

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onClose={handleCancel}
        title={reponseA ? `Répondre à ${reponseA}` : "Ajouter un commentaire"}
      >
        {formContent}
      </Drawer>
    );
  }

  return formContent;
}
