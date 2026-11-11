"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CHARACTERS, CHARACTERS_BY_NAME, type Character } from "@/lib/characters";
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

/**
 * « Je vote en tant que [avatar] Thomas » : bouton + liste d'options (même modèle que /idees).
 * Échap referme et rend le focus au bouton, flèches haut / bas parcourent la liste.
 */
export default function SelecteurVotant({
  votant, onChoisir, libelle = "Changer de personnage",
}: {
  votant: string;
  onChoisir: (nom: string) => void;
  libelle?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const declencheur = useRef<HTMLButtonElement>(null);
  const idListe = useId();

  useEffect(() => {
    if (!ouvert) return;
    const surClic = (e: MouseEvent) => {
      if (racine.current && !racine.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("mousedown", surClic);
    // Le focus entre dans la liste, sur l'option courante.
    racine.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => document.removeEventListener("mousedown", surClic);
  }, [ouvert]);

  // Tab (ou tout autre focus) vers un élément hors du sélecteur referme la liste. Un focus perdu sans
  // destination (`relatedTarget` nul : clic sur un bouton que Safari ne focalise pas) est laissé au
  // `mousedown` ci-dessus, sinon la liste disparaîtrait avant le clic sur une option.
  function surSortieFocus(e: FocusEvent<HTMLDivElement>) {
    const vers = e.relatedTarget as Node | null;
    if (ouvert && vers && !racine.current?.contains(vers)) setOuvert(false);
  }

  function surTouche(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && ouvert) {
      e.stopPropagation();
      setOuvert(false);
      declencheur.current?.focus();
      return;
    }
    if (!ouvert || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    const options = Array.from(racine.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const i = options.indexOf(document.activeElement as HTMLElement);
    const suivant = e.key === "ArrowDown" ? (i + 1) % options.length : (i - 1 + options.length) % options.length;
    options[suivant]?.focus();
    e.preventDefault();
  }

  const actuel = CHARACTERS_BY_NAME[votant];
  return (
    <div className={styles.racine} ref={racine} onKeyDown={surTouche} onBlur={surSortieFocus}>
      <button
        ref={declencheur}
        type="button"
        className={styles.declencheur}
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        aria-controls={ouvert ? idListe : undefined}
        title={libelle}
        onClick={() => setOuvert((v) => !v)}
      >
        <AvatarPersonnage nom={votant} size="sm" />
        <span>{actuel?.name ?? votant}</span>
        <span className="sr-only"> ({libelle.toLowerCase()})</span>
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </button>
      {ouvert && (
        <div id={idListe} role="listbox" aria-label="Personnages" className={styles.liste}>
          {CHARACTERS.map((c) => (
            <button
              key={c.name}
              type="button"
              role="option"
              aria-selected={c.name === votant}
              className={styles.option}
              onClick={() => {
                setOuvert(false);
                declencheur.current?.focus();
                if (c.name !== votant) onChoisir(c.name);
              }}
            >
              <AvatarPersonnage nom={c.name} size="sm" />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
