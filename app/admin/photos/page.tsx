"use client";

import { useState, useEffect, useRef } from "react";

const RESTAURANTS = [
  { name: "Le Bistrot Trèfle", slug: "bistrot_trefle" },
  { name: "La Pause Gourmande", slug: "pause_gourmande" },
  { name: "Le Truck Muche", slug: "truck_muche" },
];

const MAX_FILE_SIZE = 3 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

interface Photo {
  id: number;
  restaurant_slug: string;
  filename: string;
  content_type: string;
  created_at: string;
}

export default function AdminPhotosPage() {
  const [token, setToken] = useState("");
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    const saved = localStorage.getItem("pdj-admin-token");
    if (saved) {
      setSavedToken(saved);
      fetchPhotos(saved);
    }
  }, []);

  async function fetchPhotos(t: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/photos", {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) {
        localStorage.removeItem("pdj-admin-token");
        setSavedToken(null);
        setError("Token invalide");
        return;
      }
      const data = await res.json();
      setPhotos(data.photos || []);
    } catch {
      setError("Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    localStorage.setItem("pdj-admin-token", token.trim());
    setSavedToken(token.trim());
    fetchPhotos(token.trim());
  }

  async function handleUpload(slug: string, file: File) {
    if (!savedToken) return;
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
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("slug", slug);
      const res = await fetch("/api/photos", {
        method: "POST",
        headers: { Authorization: `Bearer ${savedToken}` },
        body: formData,
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Erreur upload");
        return;
      }
      setSuccess("Photo ajoutée !");
      await fetchPhotos(savedToken);
    } catch {
      setError("Erreur réseau");
    } finally {
      setUploading(null);
      const input = fileInputRefs.current[slug];
      if (input) input.value = "";
    }
  }

  async function handleDelete(id: number) {
    if (!savedToken) return;
    if (!confirm("Supprimer cette photo ?")) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/photos/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${savedToken}` },
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Erreur suppression");
        return;
      }
      setSuccess("Photo supprimée");
      setPhotos((prev) => prev.filter((p) => p.id !== id));
    } catch {
      setError("Erreur réseau");
    }
  }

  if (!savedToken) {
    return (
      <div className="max-w-sm mx-auto mt-16">
        <h1
          className="text-2xl font-bold text-[var(--text)] mb-6"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Admin — Photos
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          Photos utilisées par l&apos;IA pour calibrer les portions estimées de chaque restaurant.
        </p>
        <form onSubmit={handleLogin} className="space-y-4">
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              Token d&apos;accès
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="API_SECRET_TOKEN"
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 px-4 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Accéder
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
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
        <button
          onClick={() => {
            localStorage.removeItem("pdj-admin-token");
            setSavedToken(null);
            setPhotos([]);
          }}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors px-2 py-1 rounded border border-[var(--border)]"
        >
          Déconnexion
        </button>
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

      {loading ? (
        <p className="text-[var(--text-muted)] text-sm">Chargement...</p>
      ) : (
        <div className="space-y-5">
          {RESTAURANTS.map(({ name, slug }) => {
            const restaurantPhotos = photos.filter((p) => p.restaurant_slug === slug);
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
                    uploading === slug ? "opacity-60 pointer-events-none" : ""
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
                  {uploading === slug ? "Upload en cours…" : "Ajouter une photo"}
                  <input
                    ref={(el) => {
                      fileInputRefs.current[slug] = el;
                    }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="sr-only"
                    disabled={uploading === slug}
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
      )}
    </div>
  );
}
