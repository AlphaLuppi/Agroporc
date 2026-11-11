import Link from "next/link";
import { getDuelsAvecVoix, type DuelAvecVoix } from "@/lib/db";
import { agregerStats, type PlatCatalogue } from "@/lib/dilemme";
import { libelleNombrePlats, libelleService, libelleVictoires } from "@/lib/dilemme-libelles";
import { chargerCatalogue, imagesPourCles } from "@/lib/dilemme-serveur";
import {
  filtrerHistorique, hrefHistorique, parametresHistorique, type PlatHistorique, type TriHistorique,
} from "@/lib/historique-plats";
import { RESTAURANTS } from "@/lib/restaurants";
import { aujourdhuiParis } from "@/lib/recettes";
import PartBudgetPrix from "./PartBudgetPrix";
import NotesPlat from "./NotesPlat";
import RestoBadge from "../../components/RestoBadge";
import SousNav from "../SousNav";
import VisuelPlat from "../VisuelPlat";
import styles from "../dilemme.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tous les plats — Agroporc",
};

type SearchParams = Record<string, string | string[] | undefined>;

const LIBELLES_TRI: Record<TriHistorique, string> = {
  recents: "Plus récents",
  victoires: "Plus de victoires",
  servis: "Plus servis",
  alpha: "A à Z",
};

const RESTAURANTS_AVEC_PLATS = RESTAURANTS.filter((r) => r.type !== "lien");

export default async function PlatsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = parametresHistorique(await searchParams);

  let catalogue: PlatCatalogue[] | null = null;
  try {
    catalogue = await chargerCatalogue();
  } catch (e) {
    console.error("[dilemme] historique indisponible", e);
  }

  // Deux requêtes en parallèle au plus. Le jeu complet d'images sert au filtre « avec photo » ;
  // sans les duels, les victoires restent à 0 et le reste s'affiche.
  const [images, duels] = catalogue
    ? await Promise.all([
        imagesPourCles(catalogue.map((x) => x.cle)),
        getDuelsAvecVoix(aujourdhuiParis()).catch((e): DuelAvecVoix[] => {
          console.error("[dilemme] duels indisponibles", e);
          return [];
        }),
      ])
    : [new Map<string, { src: string; credit?: string }>(), [] as DuelAvecVoix[]];
  const stats = agregerStats(duels);

  const plats: PlatHistorique[] = (catalogue ?? []).map((x) => ({
    ...x,
    victoires: stats.get(x.cle)?.victoires ?? 0,
    aImage: images.has(x.cle),
  }));
  const r = filtrerHistorique(plats, p);
  const filtre = Boolean(p.q || p.restaurant || p.photo);
  const credit = r.plats.map((x) => images.get(x.cle)?.credit).find(Boolean);

  return (
    <div className={styles.page}>
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-heading)" }}>
          Tous les plats
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          L&apos;historique des plats déjà servis, avec leur photo quand elle existe.
        </p>
      </div>
      <SousNav actif="plats" />

      <form action="/dilemme/plats" method="get" className={styles.recherche} role="search">
        <label className={styles.champ}>
          <span>Rechercher un plat</span>
          <input type="search" name="q" defaultValue={p.q} maxLength={60} placeholder="ex. : croziflette, carbo…" />
        </label>
        <label className={styles.champ}>
          <span>Restaurant</span>
          <select name="restaurant" defaultValue={p.restaurant ?? ""}>
            <option value="">Tous les restaurants</option>
            {RESTAURANTS_AVEC_PLATS.map((x) => (
              <option key={x.slug} value={x.slug}>{x.nom}</option>
            ))}
          </select>
        </label>
        <label className={styles.champ}>
          <span>Trier par</span>
          <select name="tri" defaultValue={p.tri}>
            {(Object.keys(LIBELLES_TRI) as TriHistorique[]).map((t) => (
              <option key={t} value={t}>{LIBELLES_TRI[t]}</option>
            ))}
          </select>
        </label>
        <label className={styles.caseAvecPhoto}>
          <input type="checkbox" name="photo" value="1" defaultChecked={p.photo} />
          <span>Avec photo seulement</span>
        </label>
        <button type="submit" className={styles.bouton}>Filtrer</button>
      </form>

      {!catalogue ? (
        <p className={styles.erreur} role="alert">L&apos;historique est indisponible pour le moment.</p>
      ) : (
        <>
          <p className={styles.resultats} aria-live="polite">{libelleNombrePlats(r.total)}</p>
          {r.plats.length === 0 ? (
            <p className={styles.vide}>
              {r.total === 0 && !filtre ? "Aucun plat servi pour l'instant." : "Aucun plat ne correspond."}
              {filtre && (
                <>
                  <br />
                  <Link href="/dilemme/plats">Effacer les filtres</Link>
                </>
              )}
            </p>
          ) : (
            <ul className={styles.grille}>
              {r.plats.map((x) => {
                const service = libelleService(x.nbServices, x.premiere, x.derniere, true);
                return (
                  <li key={x.cle}>
                    <article className={styles.carte}>
                      <VisuelPlat src={images.get(x.cle)?.src ?? null} nom={x.nom} />
                      <RestoBadge nom={x.restaurant} variante="chip" complet className={styles.carteResto} />
                      <h2 className={styles.carteTitre}>{x.nom}</h2>
                      {service && <p className={styles.carteMeta}>{service}</p>}
                      <PartBudgetPrix prix={x.prix} />
                      <NotesPlat sportif={x.noteSportif} goulaf={x.noteGoulaf} />
                      {x.victoires > 0 && (
                        <span className={`${styles.badge} ${styles.badgeVictoires}`}>{libelleVictoires(x.victoires)}</span>
                      )}
                    </article>
                  </li>
                );
              })}
            </ul>
          )}

          {r.pages > 1 && (
            <nav className={styles.pagination} aria-label="Pagination">
              {r.page > 1 ? <Link href={hrefHistorique(p, { page: r.page - 1 })}>← Précédent</Link> : <span aria-hidden="true" />}
              <span>Page {r.page} sur {r.pages}</span>
              {r.page < r.pages ? <Link href={hrefHistorique(p, { page: r.page + 1 })}>Suivant →</Link> : <span aria-hidden="true" />}
            </nav>
          )}
          {credit && <p className={styles.credit}>Image : {credit}</p>}
        </>
      )}
    </div>
  );
}
