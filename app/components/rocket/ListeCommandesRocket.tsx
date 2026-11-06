import type { CommandeRocket } from "@/lib/rocket/lobby";
import styles from "./Rocket.module.css";

/** Commandes en liste de définitions (touches du joueur à gauche, effet à droite). Sans état : rendable côté serveur. */
export default function ListeCommandesRocket({ commandes }: { commandes: readonly CommandeRocket[] }) {
  return (
    <dl className={styles.commandes} aria-label="Commandes">
      {commandes.map((c) => (
        <div key={c.id}>
          <dt><kbd>{c.touches}</kbd></dt>
          <dd>{c.libelle}</dd>
        </div>
      ))}
    </dl>
  );
}
