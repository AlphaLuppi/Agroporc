import Link from "next/link";
import styles from "./dilemme.module.css";

/** Sous-navigation commune aux deux pages du dilemme. Sans état : rendu serveur. */
export default function SousNav({ actif }: { actif: "duel" | "plats" }) {
  return (
    <nav className={styles.sousNav} aria-label="Dilemme">
      <Link href="/dilemme" aria-current={actif === "duel" ? "page" : undefined}>Le duel</Link>
      <Link href="/dilemme/plats" aria-current={actif === "plats" ? "page" : undefined}>Tous les plats</Link>
    </nav>
  );
}
