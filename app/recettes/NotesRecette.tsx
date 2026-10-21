import { MODE_LABEL, type Mode } from "@/lib/carte-tri";
import { fmtNote, formatDateShort, noteClass } from "@/lib/format";
import { LEGENDE_SANS_NOTE, libelleNote, NOTE_INDISPONIBLE } from "@/lib/recettes";
import styles from "./recettes.module.css";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

/**
 * Notes Sportif et Goulaf du plat du jour dont la recette s'inspire (pas de la recette maison),
 * colorées comme partout (vert / ambre / rouge). Sans aucune note : une seule pastille « Non notée »
 * (texte visible, le « ? » ne s'explique pas au toucher) ; une seule note absente : « ? » visuel,
 * « note indisponible » pour les lecteurs d'écran. Sans état, rendu serveur. `enAvant` : mode du tri courant, affiché en premier et souligné.
 */
export default function NotesRecette({
  sportif, goulaf, date, enAvant, taille = "carte",
}: {
  sportif: number | null;
  goulaf: number | null;
  date?: string | null;
  enAvant?: Mode;
  taille?: "carte" | "fiche";
}) {
  const notes: Record<Mode, number | null> = { sportif, goulaf };
  if (sportif == null && goulaf == null) {
    return (
      <span className={styles.scores}>
        <span className={cx(styles.score, styles.none, taille === "fiche" && styles.scoreFiche)} title={LEGENDE_SANS_NOTE}>
          <span className={styles.scoreLibelle}>Non notée</span>
        </span>
      </span>
    );
  }
  const ordre: Mode[] = enAvant === "goulaf" ? ["goulaf", "sportif"] : ["sportif", "goulaf"];
  return (
    <span className={styles.scores}>
      {ordre.map((mode) => {
        const n = notes[mode];
        const title = date && n != null
          ? `Note du plat du jour évalué le ${formatDateShort(date).toLowerCase()}`
          : libelleNote(mode, n);
        return (
          <span
            key={mode}
            className={cx(styles.score, styles[n == null ? "none" : noteClass(n)], taille === "fiche" && styles.scoreFiche)}
            data-actif={mode === enAvant || undefined}
            title={title}
          >
            <span className={styles.scoreLibelle}>{MODE_LABEL[mode]}</span>
            {n == null ? <b aria-hidden="true">?</b> : <b>{fmtNote(n)}</b>}
            {n != null && <span className={styles.scoreSur} aria-hidden="true">/10</span>}
            <span className="sr-only">{n == null ? NOTE_INDISPONIBLE : "sur 10"}</span>
          </span>
        );
      })}
    </span>
  );
}
