import { AvatarPersonnage } from "../components/SelecteurVotant";
import { listeVotants } from "@/lib/dilemme";
import { libelleVoix } from "@/lib/dilemme-libelles";
import styles from "./dilemme.module.css";

/**
 * Résultats d'un côté du duel : barre, « 62 % », « 5 voix », avatars des votants et leur liste écrite
 * (jamais réservée à l'infobulle). Sans état : testable en rendu statique.
 */
export default function ResultatsCote({ voix, pct, votants }: { voix: number; pct: number; votants: string[] }) {
  return (
    <div className={styles.resultat}>
      <div className={styles.barre} aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className={styles.chiffres}>
        <strong>{pct} %</strong> · {libelleVoix(voix)}
      </p>
      <div className={styles.votants}>
        {votants.length > 0 ? (
          <>
            <span className={styles.avatars}>
              {votants.map((nom) => (
                <AvatarPersonnage key={nom} nom={nom} size="sm" />
              ))}
            </span>
            <span className={styles.phraseVotants}>{listeVotants(votants)}</span>
          </>
        ) : (
          <span className={styles.phraseVotants}>Aucun vote</span>
        )}
      </div>
    </div>
  );
}
