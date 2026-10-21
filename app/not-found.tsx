import type { Metadata } from "next";
import Link from "next/link";

// Remplace l'onglet anglais « 404: This page could not be found. » de Next.
export const metadata: Metadata = { title: "Page introuvable" };

/**
 * 404 aux couleurs du thème : sans ce fichier, la feuille par défaut de Next
 * (body noir sur blanc, en anglais) écrase les tokens et rend le texte
 * illisible sur le pelage du thème tigre.
 */
export default function NonTrouvee() {
  return (
    <div
      style={{
        maxWidth: 480,
        margin: "64px auto",
        padding: 32,
        textAlign: "center",
        background: "var(--surface)",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
      }}
    >
      <h1 style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "1.5rem", marginBottom: "0.5rem" }}>
        Page introuvable
      </h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "1.25rem" }}>
        Ce plat n&apos;est pas au menu.
      </p>
      <Link href="/" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>
        Retour aux plats du jour
      </Link>
    </div>
  );
}
