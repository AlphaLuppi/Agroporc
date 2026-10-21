"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadPhotoAction, deletePhotoAction } from "./actions";
import type { Photo } from "@/lib/db";
import { preparerImage } from "@/lib/image-upload";

const RESTAURANTS = [
  { name: "Le Bistrot Trèfle", slug: "bistrot_trefle" },
  { name: "La Pause Gourmande", slug: "pause_gourmande" },
  { name: "Le Truck Muche", slug: "truck_muche" },
  { name: "Basilic n'Go", slug: "basilic_ngo" },
  { name: "Dubble", slug: "dubble" },
  { name: "La Mijote", slug: "la_mijote" },
];


interface RecentDish {
  plat_nom: string;
  plat_date: string;
}

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

  // Dish picker state
  const [pendingUpload, setPendingUpload] = useState<{ slug: string; file: File } | null>(null);
  const [recentDishes, setRecentDishes] = useState<RecentDish[]>([]);
  const [loadingDishes, setLoadingDishes] = useState(false);

  useEffect(() => {
    setPhotos(initialPhotos);
  }, [initialPhotos]);

  async function handleFileSelect(slug: string, original: File) {
    setError(null);
    setSuccess(null);
    // Réduit/recompresse les photos de téléphone (souvent > 3 Mo) avant l'envoi.
    let file: File;
    try {
      file = await preparerImage(original, 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image illisible");
      return;
    }
    setPendingUpload({ slug, file });
    setLoadingDishes(true);
    try {
      const res = await fetch(`/api/photos/recent-dishes?slug=${slug}`);
      const data = await res.json();
      setRecentDishes(data.dishes ?? []);
    } catch {
      setRecentDishes([]);
    } finally {
      setLoadingDishes(false);
    }
  }

  async function handleUpload(platNom?: string, platDate?: string) {
    if (!pendingUpload) return;
    const { slug, file } = pendingUpload;
    setPendingUpload(null);
    setRecentDishes([]);
    setUploading(slug);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("slug", slug);
    if (platNom) formData.append("plat_nom", platNom);
    if (platDate) formData.append("plat_date", platDate);

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

  const confirmDeletePhoto = photos.find((p) => p.id === confirmDeleteId);

  return (
    <div className="space-y-8">
      {/* Modal suppression */}
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 shadow-xl max-w-sm w-full mx-4">
            <p className="text-[var(--text)] font-medium mb-1">Supprimer cette photo ?</p>
            {confirmDeletePhoto?.plat_nom && (
              <p className="text-xs text-[var(--text-muted)] mb-1">Liée à : {confirmDeletePhoto.plat_nom}</p>
            )}
            <p className="text-sm text-[var(--text-secondary)] mb-5">Cette action est irréversible.</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--border-control)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm rounded-lg bg-red-700 text-white hover:bg-red-800 transition-colors font-medium"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal liaison plat */}
      {pendingUpload !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 shadow-xl max-w-sm w-full mx-4">
            <p className="text-[var(--text)] font-medium mb-1">Lier cette photo à un plat</p>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Optionnel — aide l&apos;IA à calibrer les grammages par plat.
            </p>
            {loadingDishes ? (
              <p className="text-sm text-[var(--text-muted)] mb-4">Chargement des plats récents…</p>
            ) : recentDishes.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] mb-4">Aucun plat trouvé pour ce restaurant.</p>
            ) : (
              <ul className="max-h-56 overflow-y-auto space-y-1 mb-4 pr-1">
                {recentDishes.map((d) => (
                  <li key={`${d.plat_date}-${d.plat_nom}`}>
                    <button
                      onClick={() => handleUpload(d.plat_nom, d.plat_date)}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-[var(--surface-hover)] transition-colors group"
                    >
                      <span className="text-[var(--text)] group-hover:text-[var(--accent)]">{d.plat_nom}</span>
                      <span className="ml-2 text-xs text-[var(--text-muted)]">
                        {new Date(d.plat_date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-3 justify-between">
              <button
                onClick={() => {
                  setPendingUpload(null);
                  setRecentDishes([]);
                  const input = fileInputRefs.current[pendingUpload.slug];
                  if (input) input.value = "";
                }}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--border-control)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => handleUpload()}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--border-control)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                Sans liaison
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
        <div role="alert" className="p-3 bg-[var(--surface)] border border-[var(--bad-border)] text-[var(--bad)] rounded-lg text-sm">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="p-3 bg-[var(--surface)] border border-[var(--good-border)] text-[var(--good)] rounded-lg text-sm">
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
                      {/* Zone tactile de 40 px, disque visible de 24 px ; masqué au repos seulement si l'écran a un survol (sinon introuvable au doigt). */}
                      <button
                        onClick={() => handleDelete(photo.id)}
                        className="absolute top-0 right-0 w-10 h-10 flex items-center justify-center opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        aria-label="Supprimer"
                      >
                        <span aria-hidden="true" className="w-6 h-6 rounded-full bg-red-700 text-white ring-2 ring-[var(--surface)] text-base font-bold leading-none flex items-center justify-center">
                          ×
                        </span>
                      </button>
                      {photo.plat_nom ? (
                        <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2 leading-tight font-medium" title={photo.plat_nom}>
                          {photo.plat_nom}
                        </p>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2 leading-tight">
                          {photo.filename}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <label
                className={`inline-flex items-center gap-2 cursor-pointer px-3 py-1.5 border border-[var(--border-control)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors ${
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
                  accept="image/*"
                  className="sr-only"
                  disabled={isUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(slug, file);
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
