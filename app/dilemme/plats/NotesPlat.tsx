import { fmtNote, noteClass } from "@/lib/format";
import styles from "../dilemme.module.css";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

/**
 * Notes Sportif et Goulaf du plat, écrites en clair et colorées comme partout (vert / ambre / rouge).
 * Sans aucune note : une seule pastille « Non noté » (le « ? » ne s'explique pas au toucher) ;
 * une seule note absente : « ? » visuel, « note indisponible » pour les lecteurs d'écran. Sans état.
 */
export default function NotesPlat({ sportif, goulaf }: { sportif: number | null; goulaf: number | null }) {
  if (sportif == null && goulaf == null) {
    return (
      <span className={styles.scores}>
        <span className={cx(styles.score, styles.none)}>
          <span className={styles.scoreLibelle}>Non noté</span>
        </span>
      </span>
    );
  }
  const notes: [string, number | null][] = [["Sportif", sportif], ["Goulaf", goulaf]];
  return (
    <span className={styles.scores}>
      {notes.map(([libelle, n]) => (
        <span key={libelle} className={cx(styles.score, styles[n == null ? "none" : noteClass(n)])}>
          <span className={styles.scoreLibelle}>{libelle}</span>
          {n == null ? <b aria-hidden="true">?</b> : <b>{fmtNote(n)}</b>}
          {n != null && <span className={styles.scoreSur} aria-hidden="true">/10</span>}
          <span className="sr-only">{n == null ? "note indisponible" : "sur 10"}</span>
        </span>
      ))}
    </span>
  );
}
