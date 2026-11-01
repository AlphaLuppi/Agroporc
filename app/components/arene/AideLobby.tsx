"use client";

import type { ReactNode } from "react";
import type { CommandeLobby } from "./lobby-modele";
import styles from "./Arene.module.css";

/**
 * « Aide » repliée des lobbies (arène, zombies, Battle Royale) : tout ce qui explique le jeu (règles, commandes, notes) vit ici, fermé au départ, pour que
 * l'écran d'un lobby ne montre que ce qu'on y décide (mode, nom, équipement, parties, bouton d'entrée). Un `<details>` natif : clavier et lecteurs d'écran
 * gratuits, aucune règle perdue. Tokens `--ag-*` seulement (Arene.module.css).
 */
export default function AideLobby({ titre = "Aide", children }: { titre?: string; children: ReactNode }) {
  return (
    <details className={styles.aideLobby}>
      <summary>{titre}</summary>
      <div className={styles.aideCorps}>{children}</div>
    </details>
  );
}

/** Commandes du lobby (touches réelles du joueur) en liste de définitions. */
export function ListeCommandes({ commandes }: { commandes: readonly CommandeLobby[] }) {
  return (
    <dl className={styles.commandes} aria-label="Commandes">
      {commandes.map((c) => (
        <div key={c.libelle}>
          <dt><kbd>{c.touches}</kbd></dt>
          <dd>{c.libelle}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Liste à puces des règles d'un mode. */
export function ListeRegles({ titre, regles }: { titre: string; regles: readonly string[] }) {
  return (
    <section className={styles.regles} aria-label={titre}>
      <h3>{titre}</h3>
      <ul>
        {regles.map((r) => <li key={r}>{r}</li>)}
      </ul>
    </section>
  );
}
