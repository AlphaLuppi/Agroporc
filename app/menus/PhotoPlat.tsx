"use client";

import { useRef, useState } from "react";
import { preparerImage } from "@/lib/image-upload";
import styles from "./menus.module.css";

/**
 * Ajout d'une photo de référence directement depuis le détail d'un plat : la photo est liée au
 * plat et à la date (comme dans /admin/photos, sans passer par le choix du plat).
 */
export default function PhotoPlat({ slug, plat, date }: { slug: string; plat: string; date: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [ajoutees, setAjoutees] = useState<number[]>([]);

  async function envoyer(fichier: File | undefined) {
    if (!fichier) return;
    setEnCours(true);
    setMessage(null);
    try {
      const pret = await preparerImage(fichier, 1600);
      const formData = new FormData();
      formData.append("file", pret);
      formData.append("slug", slug);
      formData.append("plat_nom", plat);
      formData.append("plat_date", date);
      const res = await fetch("/api/photos", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Erreur lors de l'envoi");
      if (typeof data.photo?.id === "number") setAjoutees((a) => [...a, data.photo.id]);
      setMessage({ ok: true, texte: "Photo ajoutée, merci ! Elle aidera l'IA à estimer les portions." });
    } catch (e) {
      setMessage({ ok: false, texte: e instanceof Error ? e.message : "Erreur lors de l'envoi" });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        type="button"
        className={styles.bouton}
        style={{ alignSelf: "flex-start" }}
        onClick={() => inputRef.current?.click()}
        disabled={enCours}
      >
        {enCours ? "Envoi…" : "📷 Ajouter une photo du plat"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          envoyer(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {ajoutees.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ajoutees.map((id) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={id}
              src={`/api/photos/${id}/image`}
              alt={`Photo de ${plat}`}
              style={{ width: 64, height: 64, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}
            />
          ))}
        </div>
      )}
      {message && (
        <p className={styles.texte} style={{ color: message.ok ? "var(--good)" : "var(--bad)" }} role="status">
          {message.texte}
        </p>
      )}
    </div>
  );
}
