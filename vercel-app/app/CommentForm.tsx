"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImagePlus, X, Upload } from "lucide-react";

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
  const [auteur, setAuteur] = useState("");
  const [texte, setTexte] = useState("");
  const [website, setWebsite] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [showImageInput, setShowImageInput] = useState(false);
  const [imageError, setImageError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) {
    return (
      <button
        className="mt-3 w-full border border-dashed border-[var(--border)] rounded-[var(--radius)] text-[var(--text-secondary)] py-2 px-3 text-sm cursor-pointer transition-all bg-transparent hover:border-[var(--accent)] hover:text-[var(--accent)]"
        onClick={() => setOpen(true)}
      >
        + Ajouter un commentaire
      </button>
    );
  }

  function handleCancel() {
    if (onCancel) {
      onCancel();
    } else {
      setOpen(false);
    }
    setAuteur("");
    setTexte("");
    setImageUrl("");
    setShowImageInput(false);
    setImageError(false);
    setError("");
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

  const [dragOver, setDragOver] = useState(false);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!auteur.trim() || (!texte.trim() && !imageUrl)) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/commentaire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          platIndex,
          auteur: auteur.trim(),
          texte: texte.trim(),
          website,
          ...(imageUrl ? { image_url: imageUrl } : {}),
          ...(reponseA ? { reponse_a: reponseA } : {}),
          ...(reponseAIndex !== undefined ? { reponse_a_index: reponseAIndex } : {}),
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
    <form className="mt-3 flex flex-col gap-2" onSubmit={handleSubmit}>
      {reponseA && (
        <div className="text-xs text-[var(--accent)] px-2 py-1.5 bg-[var(--accent-glow)] rounded-[var(--radius-sm)] border-l-[3px] border-l-[var(--accent)]">
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
      <Input
        type="text"
        placeholder="Votre pseudo"
        value={auteur}
        onChange={(e) => setAuteur(e.target.value)}
        maxLength={50}
        required
        className="comment-input bg-[var(--surface)] border-[var(--border)] text-[var(--text)] text-sm placeholder:text-[var(--text-secondary)] placeholder:opacity-60 focus:border-[var(--accent)]"
      />
      <Input
        type="text"
        placeholder={reponseA ? `Répondre à ${reponseA}...` : "Votre commentaire"}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        onPaste={handlePaste}
        maxLength={500}
        required={!imageUrl}
        className="bg-[var(--surface)] border-[var(--border)] text-[var(--text)] text-sm placeholder:text-[var(--text-secondary)] placeholder:opacity-60 focus:border-[var(--accent)]"
      />

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
          className="bg-[var(--surface)] border-[var(--border)] text-[var(--text-secondary)] text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] w-fit"
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
          className={`flex flex-col items-center justify-center gap-1.5 py-5 px-4 rounded-[var(--radius)] border-2 border-dashed cursor-pointer transition-all bg-transparent ${
            dragOver
              ? "border-[var(--accent)] bg-[var(--accent-glow)]"
              : "border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent-glow)]"
          }`}
        >
          <Upload className={`size-5 ${dragOver ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`} />
          <span className="text-xs text-[var(--text-secondary)]">
            Cliquer ou glisser-déposer une image
          </span>
          <span className="text-[0.65rem] text-[var(--text-secondary)] opacity-60">
            PNG, JPG, GIF, WebP · 5 Mo max
          </span>
        </button>
      )}

      {imageUrl && (
        <div className="relative inline-block max-w-[200px]">
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
            className="absolute -top-1.5 -right-1.5 bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] rounded-full w-5 h-5 cursor-pointer flex items-center justify-center hover:text-[var(--bad)] hover:border-[var(--bad)] transition-colors"
            aria-label="Supprimer l'image"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          className="text-[var(--text-secondary)]"
        >
          Annuler
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={loading || !auteur.trim() || (!texte.trim() && !imageUrl)}
          className="bg-[var(--accent)] text-[var(--bg)] font-semibold hover:bg-[var(--accent)]/90 disabled:opacity-40"
        >
          {loading ? "..." : "Envoyer"}
        </Button>
      </div>
      {error && <p className="text-[var(--bad)] text-sm m-0">{error}</p>}
    </form>
  );
}
