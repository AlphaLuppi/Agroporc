"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CHARACTERS, type Character } from "@/lib/characters";
import styles from "./SelecteurVotant.module.css";

/** Avatar d'un personnage (photo, repli emoji sur sa couleur). Décoratif : le nom est toujours écrit à côté. */
export function AvatarPersonnage({ nom, size = "default" }: { nom: string; size?: "default" | "sm" | "lg" }) {
  const c: Character | undefined = CHARACTERS.find((x) => x.name === nom);
  return (
    <Avatar size={size} aria-hidden="true" title={nom}>
      {c?.image && <AvatarImage src={c.image} alt="" />}
      <AvatarFallback style={{ background: c?.color ?? "var(--surface-hover)" }}>{c?.emoji ?? "?"}</AvatarFallback>
    </Avatar>
  );
}

/** Grille « Qui es-tu ? » : les 16 personnages, un bouton par personnage (pas de nom libre). */
export function GrilleVotants({ votant, onChoisir }: { votant?: string | null; onChoisir: (nom: string) => void }) {
  return (
    <ul className={styles.grille}>
      {CHARACTERS.map((c) => (
        <li key={c.name}>
          <button type="button" className={styles.perso} aria-pressed={c.name === votant} onClick={() => onChoisir(c.name)}>
            <AvatarPersonnage nom={c.name} size="lg" />
            <span>{c.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
