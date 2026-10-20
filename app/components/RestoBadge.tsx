import type { CSSProperties } from "react";
import { repereResto } from "@/lib/restaurants";
import s from "./RestoBadge.module.css";

/**
 * Repère visuel d'un restaurant : pictogramme coloré (+ nom court ou complet).
 * - `chip` : picto 14 px + nom en capitales sur fond teinté (tuiles, panneau d'un plat, /recettes).
 * - `ligne` : picto à la taille du texte + nom, sans fond (lignes meta, pastilles, en-têtes).
 * - `icone` : pastille ronde teintée, picto seul, décorative (le nom est écrit à côté), taille via `taille`.
 * - `picto` : picto coloré seul, décoratif (le nom est écrit à côté), taille via `taille`.
 * Quand le nom court est affiché (« La Pause »), le nom complet reste dans `title` et pour les lecteurs
 * d'écran (texte masqué), le nom court visible leur étant caché.
 * Sans état ni hook : utilisable côté serveur comme côté client.
 */
export type VarianteBadge = "icone" | "chip" | "ligne" | "picto";

export default function RestoBadge({
  nom,
  variante = "ligne",
  complet = false,
  taille,
  className,
}: {
  nom: string;
  variante?: VarianteBadge;
  complet?: boolean;
  /** Diamètre de la variante `icone` ou taille du `picto`, en px. */
  taille?: number;
  className?: string;
}) {
  const r = repereResto(nom);
  const style = { "--c": r.couleur, ...(taille ? { "--taille": `${taille}px` } : {}) } as CSSProperties;
  const seul = variante === "icone" || variante === "picto";
  const affiche = complet ? nom : r.court;
  const abrege = !seul && affiche !== nom;
  return (
    <span
      className={[s.rb, s[variante], className].filter(Boolean).join(" ")}
      style={style}
      {...(seul ? { "aria-hidden": true } : {})}
      {...(abrege ? { title: nom } : {})}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        // Chaînes constantes internes (lib/resto-pictos.ts), jamais de contenu utilisateur.
        dangerouslySetInnerHTML={{ __html: r.picto }}
      />
      {!seul && (abrege ? (
        <>
          <span className={s.nom} aria-hidden="true">{affiche}</span>
          <span className={s.srOnly}>{nom}</span>
        </>
      ) : (
        <span className={s.nom}>{affiche}</span>
      ))}
    </span>
  );
}
