"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadPhotoAction, deletePhotoAction } from "./actions";
import type { Photo } from "@/lib/db";

const RESTAURANTS = [
  { name: "Le Bistrot Trèfle", slug: "bistrot_trefle" },
  { name: "La Pause Gourmande", slug: "pause_gourmande" },
  { name: "Le Truck Muche", slug: "truck_muche" },
];

const MAX_FILE_SIZE = 3 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

interface Props {
  initialPhotos: Photo[];
}

export default function AdminPhotosClient({ initialPhotos }: Props) {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    setPhotos(initialPhotos);
  }, [initialPhotos]);

  async function handleUpload(slug: string, file: File) {
    if (file.size > MAX_FILE_SIZE) {
      setError("Fichier trop lourd (max 3 Mo)");
      return;
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Format non supporté (JPG, PNG, WEBP, GIF)");
      return;
    }
    setUploading(slug);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("slug", slug);

    startTransition(async () => {
      const result = await uploadPhotoAction(formData);
      setUploading(null);
      const input = fileInputRefs.current[slug];
      if (input) input.value = "";
      if (result.ok) {
        setSuccess("Photo ajoutée !");
        router.refresh();
      } else {
        setError(result.error || "Erreur upload");
      }
    });
  }

  async function handleDelete(id: number) {
    setConfirmDeleteId(id);
  }

  async function confirmDelete() {
    if (confirmDeleteId === null) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const result = await deletePhotoAction(id);
      if (result.ok) {
        setSuccess("Photo supprimée");
        setPhotos((prev) => prev.filter((p) => p.id !== id));
      } else {
        setError(result.error || "Erreur suppression");
      }
    });
  }

  return (
    <div className="space-y-8">
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 shadow-xl max-w-sm w-full mx-4">
            <p className="text-[var(--text)] font-medium mb-1">Supprimer cette photo ?</p>
            <p className="text-sm text-[var(--text-secondary)] mb-5">Cette action est irréversible.</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors font-medium"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
      <div>
        <h1
          className="text-2xl sm:text-3xl font-bold text-[var(--text)]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Photos de référence
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          L&apos;IA utilise ces photos pour calibrer ses estimations de grammages par restaurant.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          {success}
        </div>
      )}

      <div className="space-y-5">
        {RESTAURANTS.map(({ name, slug }) => {
          const restaurantPhotos = photos.filter((p) => p.restaurant_slug === slug);
          const isUploading = uploading === slug || (isPending && uploading === slug);
          return (
            <div
              key={slug}
              className="border border-[var(--border)] rounded-xl p-4 sm:p-6 bg-[var(--surface)]"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-[var(--text)]">{name}</h2>
                <span className="text-xs text-[var(--text-muted)]">
                  {restaurantPhotos.length} photo{restaurantPhotos.length !== 1 ? "s" : ""}
                </span>
              </div>

              {restaurantPhotos.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {restaurantPhotos.map((photo) => (
                    <div key={photo.id} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/photos/${photo.id}/image`}
                        alt={photo.filename}
                        className="w-full aspect-square object-cover rounded-lg border border-[var(--border)]"
                      />
                      <button
                        onClick={() => handleDelete(photo.id)}
                        className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                        aria-label="Supprimer"
                      >
                        ×
                      </button>
                      <p className="text-[10px] text-[var(--text-muted)] mt-1 truncate leading-tight">
                        {photo.filename}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <label
                className={`inline-flex items-center gap-2 cursor-pointer px-3 py-1.5 border border-[var(--border)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors ${
                  isUploading ? "opacity-60 pointer-events-none" : ""
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="w-4 h-4"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {isUploading ? "Upload en cours…" : "Ajouter une photo"}
                <input
                  ref={(el) => {
                    fileInputRefs.current[slug] = el;
                  }}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  disabled={isUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(slug, file);
                  }}
                />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
