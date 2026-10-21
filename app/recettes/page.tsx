import Link from "next/link";
import { listerRecettes } from "@/lib/db";
import { formatDateShort } from "@/lib/format";
import { casseLisible } from "@/lib/menus-vue";
import {
  formaterDuree, libelleDifficulte, PAR_PAGE, parametresBanque, RESTAURANTS_RECETTES, type ResumeRecette,
} from "@/lib/recettes";
import PlatImage from "../menus/PlatImage";
import RestoBadge from "../components/RestoBadge";
import styles from "./recettes.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Recettes — Agroporc",
};

type SearchParams = Record<string, string | string[] | undefined>;

/** Lien de pagination qui conserve la recherche et le filtre resto. */
function hrefPage(q: string, slug: string | null, page: number): string {
  const sp = new URLSearchParams();
  if (q) sp.set("q", q);
  if (slug) sp.set("restaurant", slug);
  if (page > 1) sp.set("page", String(page));
  const s = sp.toString();
  return s ? `/recettes?${s}` : "/recettes";
}

function Couverts({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="24" cy="26" r="13" />
      <circle cx="24" cy="26" r="8" />
      <path d="M6 12v9a3 3 0 0 0 3 3v14M9 12v9M12 12v9a3 3 0 0 1-3 3M40 12c-3 0-4 4-4 9h4v17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CarteRecette({ r }: { r: ResumeRecette }) {
  return (
    <Link href={`/recettes/${r.cle}`} className={styles.carte}>
      {r.image ? (
        <PlatImage key={r.image.src} src={r.image.src} nom={r.titre} format="tuile" />
      ) : (
        <span className={styles.sansImage}>
          <Couverts className={styles.sansImageIcone} />
        </span>
      )}
      <span className={styles.carteTitre}>{r.titre}</span>
      <span className={styles.carteInspiree}>Inspirée de « {casseLisible(r.plat)} »</span>
      <RestoBadge nom={r.restaurant} variante="chip" complet className={styles.carteResto} />
      <span className={styles.carteMeta}>
        {formaterDuree(r.temps_total_min)} · {libelleDifficulte(r.difficulte)}
      </span>
      {r.derniere_date && (
        <span className={styles.carteMeta}>
          Servi le {formatDateShort(r.derniere_date).toLowerCase()}
          {r.nb_services > 1 && ` · ${r.nb_services} fois`}
        </span>
      )}
    </Link>
  );
}

/** Banque de recettes maison inspirées des plats du jour : recherche GET (sans JS) et pagination. */
export default async function RecettesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const brut = await searchParams;
  const params = parametresBanque(brut);
  const erreurParams = params.ok ? null : params.erreur;
  const p = params.ok ? params : { q: "", qNorm: "", slug: null, restaurant: null, page: 1 };

  let resultat: { recettes: ResumeRecette[]; total: number } | null = null;
  try {
    resultat = await listerRecettes({ q: p.qNorm, restaurant: p.restaurant, page: p.page, parPage: PAR_PAGE });
  } catch (e) {
    console.error("[recettes] banque indisponible", e);
  }
  const pages = resultat ? Math.max(1, Math.ceil(resultat.total / PAR_PAGE)) : 1;
  const filtre = Boolean(p.qNorm || p.restaurant);

  return (
    <div className={styles.page}>
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-heading)" }}>
          Recettes
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Recettes maison inspirées des plats du jour, pour les refaire chez soi.
        </p>
      </div>

      <form action="/recettes" method="get" className={styles.recherche} role="search">
        <label className={styles.champ}>
          <span>Rechercher un plat ou un ingrédient</span>
          <input type="search" name="q" defaultValue={p.q} maxLength={100} placeholder="ex. : tajine, courgette…" />
        </label>
        <label className={styles.champ}>
          <span>Restaurant</span>
          <select name="restaurant" defaultValue={p.slug ?? ""}>
            <option value="">Tous les restaurants</option>
            {RESTAURANTS_RECETTES.map((r) => (
              <option key={r.slug} value={r.slug}>{r.nom}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={styles.bouton}>Rechercher</button>
      </form>

      {erreurParams && <p className={styles.erreur} role="alert">{erreurParams}</p>}

      {!resultat ? (
        <p className={styles.vide}>Banque indisponible pour le moment.</p>
      ) : resultat.recettes.length === 0 ? (
        <p className={styles.vide}>
          {filtre
            ? "Aucune recette ne correspond à cette recherche."
            : p.page > 1 && resultat.total > 0
              ? "Cette page est vide."
              : "Aucune recette pour l'instant : elles apparaissent au fil des plats du jour."}
        </p>
      ) : (
        <div className={styles.grille}>
          {resultat.recettes.map((r) => (
            <CarteRecette key={r.cle} r={r} />
          ))}
        </div>
      )}

      {resultat && resultat.total > PAR_PAGE && (
        <nav className={styles.pagination} aria-label="Pagination">
          {p.page > 1 ? <Link href={hrefPage(p.q, p.slug, p.page - 1)}>← Précédent</Link> : <span aria-hidden="true" />}
          <span>Page {p.page} sur {pages}</span>
          {p.page < pages ? <Link href={hrefPage(p.q, p.slug, p.page + 1)}>Suivant →</Link> : <span aria-hidden="true" />}
        </nav>
      )}
    </div>
  );
}
