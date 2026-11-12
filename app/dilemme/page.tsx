import Link from "next/link";
import { getDuelsAvecVoix, type DuelAvecVoix } from "@/lib/db";
import { agregerStats, classerStats, joursNavigation, voisinsDuel } from "@/lib/dilemme";
import { detailClassement, resumeDuelPasse } from "@/lib/dilemme-libelles";
import { lireEtatDuel, type ResultatEtat } from "@/lib/dilemme-serveur";
import { formatDateCourte } from "@/lib/format";
import { aujourdhuiParis } from "@/lib/recettes";
import DilemmeDuel from "./DilemmeDuel";
import SousNav from "./SousNav";
import styles from "./dilemme.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dilemme du jour — Agroporc",
};

type SearchParams = Record<string, string | string[] | undefined>;

const NB_DUELS_PRECEDENTS = 14;
const NB_CLASSEMENT = 10;

function Entete() {
  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-heading)" }}>
        Dilemme du jour
      </h1>
      <p className="text-sm text-[var(--text-secondary)] mt-1">
        Deux plats déjà servis, un seul choix. Un nouveau duel chaque jour.
      </p>
    </div>
  );
}

function Indisponible({ r }: { r: Extract<ResultatEtat, { ok: false }> }) {
  // Vivier vide ou jour sans duel : message d'information ; erreur technique : alerte.
  if (r.status === 404) {
    return (
      <p className={styles.vide}>
        {r.erreur}
        {r.code !== "vivier" && (
          <>
            <br />
            <Link href="/dilemme">Retour au duel du jour</Link>
          </>
        )}
      </p>
    );
  }
  return <p className={styles.erreur} role="alert">{r.erreur}</p>;
}

export default async function DilemmePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const brut = await searchParams;
  const jourBrut = Array.isArray(brut.jour) ? brut.jour[brut.jour.length - 1] : brut.jour;
  const aujourdhui = aujourdhuiParis();

  // Pas plus de deux requêtes en parallèle (pool pg de 3) : le duel d'abord, puis les listes.
  const r = await lireEtatDuel(jourBrut ?? null, null);
  let duels: DuelAvecVoix[] | null = null;
  try {
    duels = await getDuelsAvecVoix(aujourdhui);
  } catch (e) {
    console.error("[dilemme] duels passés indisponibles", e);
  }

  const passes = duels ?? [];
  const stats = classerStats(agregerStats(passes).values()).slice(0, NB_CLASSEMENT);
  // Le duel du jour est toujours le « suivant » du plus récent duel clos, même quand on consulte un duel passé.
  const jours = joursNavigation(passes.map((d) => d.jour), aujourdhui, r.ok ? r.etat.jour : null);
  const voisins = r.ok ? voisinsDuel(jours, r.etat.jour) : { precedent: null, suivant: null };

  return (
    <div className={styles.page}>
      <Entete />
      <SousNav actif="duel" />

      {r.ok ? (
        <DilemmeDuel
          key={r.etat.jour}
          etatInitial={r.etat}
          affichageDuJour={r.etat.jour === aujourdhui}
          precedent={voisins.precedent}
          suivant={voisins.suivant}
          aujourdhui={aujourdhui}
        />
      ) : (
        <Indisponible r={r} />
      )}

      {duels === null && r.ok && (
        <p className={styles.erreur} role="alert">L&apos;historique des duels est indisponible pour le moment.</p>
      )}

      {passes.length > 0 && (
        <section className={styles.section} aria-labelledby="titre-precedents">
          <h2 id="titre-precedents">Duels précédents</h2>
          <ul className={styles.liste}>
            {passes.slice(0, NB_DUELS_PRECEDENTS).map((d) => {
              const { texte, mention } = resumeDuelPasse(d);
              return (
                <li key={d.jour}>
                  <Link href={`/dilemme?jour=${d.jour}`} className={styles.ligneDuel}>
                    <span className={styles.ligneDate}>{formatDateCourte(d.jour)}</span>
                    <span className={styles.ligneTexte}>{texte}</span>
                    <span className={styles.ligneMention}>{mention}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {stats.length > 0 && (
        <section className={styles.section} aria-labelledby="titre-classement">
          <h2 id="titre-classement">Classement des plats</h2>
          <ol className={styles.classement}>
            {stats.map((s) => (
              <li key={s.cle}>
                <b>{s.nom}</b> · {s.restaurant}
                <span className={styles.classementDetail}>{detailClassement(s)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
