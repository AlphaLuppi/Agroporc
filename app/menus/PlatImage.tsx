"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./menus.module.css";

type Format = "panneau" | "tuile" | "hero";

/**
 * Photo d'un plat (POC). Rendue seulement quand l'image existe en base (`src` fourni) :
 * cadre à ratio fixe (pas de saut de mise en page) avec un fond d'assiette en attendant le
 * chargement ; en cas d'erreur, le fond reste, jamais d'image cassée. Cadrage centré : le
 * logo éventuel du fournisseur gratuit n'est pas masqué volontairement (crédit dans le panneau).
 * Dans une tuile / la reco, l'image est décorative (le bouton porte déjà le nom du plat).
 * Le parent passe `key={src}` : un nouveau `src` repart d'un état « charge » propre.
 */
export default function PlatImage({ src, nom, format }: { src: string; nom: string; format: Format }) {
  const ref = useRef<HTMLImageElement>(null);
  const [etat, setEtat] = useState<"charge" | "ok" | "ko">("charge");

  // Image déjà en cache avant l'hydratation : onLoad ne se déclenche pas.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete) setEtat(img.naturalWidth > 0 ? "ok" : "ko");
  }, [src]);

  return (
    <span className={`${styles.photo} ${styles[`photo_${format}`]}`} data-etat={etat}>
      <svg className={styles.photoFond} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="24" cy="26" r="13" />
        <circle cx="24" cy="26" r="8" />
        <path d="M6 12v9a3 3 0 0 0 3 3v14M9 12v9M12 12v9a3 3 0 0 1-3 3M40 12c-3 0-4 4-4 9h4v17" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {etat !== "ko" && (
        <img
          ref={ref}
          src={src}
          alt={format === "panneau" ? nom : ""}
          loading={format === "panneau" ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setEtat("ok")}
          onError={() => setEtat("ko")}
        />
      )}
    </span>
  );
}
