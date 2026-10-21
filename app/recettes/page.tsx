import Link from "next/link";
import { redirect } from "next/navigation";
import { listerRecettes, type BanqueRecettes } from "@/lib/db";
import { formatDateShort } from "@/lib/format";
import { casseLisible } from "@/lib/menus-vue";
import type { Mode } from "@/lib/carte-tri";
import {
  formaterDuree, hrefBanque, libelleDifficulte, libelleResultats, LIBELLES_PROTEINE, LIBELLES_TRI, MENTION_NOTES, PAR_PAGE,
  parametresBanque, parametresANettoyer, PROTEINES, RESTAURANTS_RECETTES, TRIS, type ResumeRecette,
} from "@/lib/recettes";
import PlatImage from "../menus/PlatImage";
import RestoBadge from "../components/RestoBadge";
import NotesRecette from "./NotesRecette";
import styles from "./recettes.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Recettes — Agroporc",
};

type SearchParams = Record<string, string | string[] | undefined>;

const FORMULAIRE = "recherche-recettes";

function Couverts({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="24" cy="26" r="13" />
      <circle cx="24" cy="26" r="8" />
      <path d="M6 12v9a3 3 0 0 0 3 3v14M9 12v9M12 12v9a3 3 0 0 1-3 3M40 12c-3 0-4 4-4 9h4v17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CarteRecette({ r, enAvant }: { r: ResumeRecette; enAvant?: Mode }) {
  return (
    <Link href={`/recettes/${r.cle}`} className={styles.carte}>
      {r.image ? (
        <PlatImage key={r.image.src} src={r.image.src} nom={r.titre} format="tuile" />
      ) : (
        <span className={styles.sansImage}>
          <Couverts className={styles.sansImageIcone} />
        </span>
      )}
      <NotesRecette sportif={r.note_sportif} goulaf={r.note_goulaf} date={r.note_date} enAvant={enAvant} />
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

/**
 * Banque de recettes maison inspirées des plats du jour : recherche GET (sans JS), tri par note
 * Sportif / Goulaf ou durée, filtre par protéine principale et pagination. Le tri et les puces
 * de protéine sont des boutons du formulaire (`form=`) : ils envoient aussi la recherche et le
 * restaurant saisis mais pas encore validés.
 */
export default async function RecettesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const brut = await searchParams;
  const params = parametresBanque(brut);
  const erreurParams = params.ok ? null : params.erreur;
  const p = params.ok
    ? params
    : { q: "", qNorm: "", slug: null, restaurant: null, tri: "recentes" as const, proteine: null, page: 1 };
  // Soumission du formulaire (champs vides, tri / protéine répétés) : URL nettoyée, une valeur par paramètre.
  if (params.ok && parametresANettoyer(brut)) redirect(hrefBanque(p));

  let resultat: BanqueRecettes | null = null;
  try {
    resultat = await listerRecettes({
      q: p.qNorm, restaurant: p.restaurant, proteine: p.proteine, tri: p.tri, page: p.page, parPage: PAR_PAGE,
    });
  } catch (e) {
    console.error("[recettes] banque indisponible", e);
  }
  const pages = resultat ? Math.max(1, Math.ceil(resultat.total / PAR_PAGE)) : 1;
  const notes = Boolean(resultat?.notesDisponibles);
  const filtre = Boolean(p.qNorm || p.restaurant || (notes && p.proteine));
  const enAvant: Mode | undefined = notes && (p.tri === "sportif" || p.tri === "goulaf") ? p.tri : undefined;

  return (
    <div className={styles.page}>
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-heading)" }}>
          Recettes
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Recettes maison inspirées des plats du jour, pour les refaire chez soi.
        </p>
        {notes && <p className={styles.mention}>{MENTION_NOTES}</p>}
      </div>

      <form id={FORMULAIRE} action="/recettes" method="get" className={styles.recherche} role="search">
        <label className={styles.champ}>
          <span>Rechercher un plat ou un ingrédient</span>
          <input type="search" name="q" defaultValue={p.q} maxLength={100} placeholder="ex. : poulet, tajine, courgette…" />
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
        {/* Une nouvelle recherche garde le tri et la protéine choisis ; un bouton de tri ou de
            protéine, placé après dans l'ordre du formulaire, les remplace (cf. parametresBanque). */}
        {p.tri !== "recentes" && <input type="hidden" name="tri" value={p.tri} />}
        {p.proteine && <input type="hidden" name="proteine" value={p.proteine} />}
        <button type="submit" className={styles.bouton}>Rechercher</button>
      </form>

      {erreurParams && <p className={styles.erreur} role="alert">{erreurParams}</p>}

      {resultat && notes && (
        <div className={styles.filtres}>
          <div className={styles.filtre} role="group" aria-label="Trier les recettes">
            <p className={styles.libelleFiltre} aria-hidden="true">Trier par</p>
            <div className={styles.tri}>
              {TRIS.map((tri) => (
                <button key={tri} type="submit" form={FORMULAIRE} name="tri" value={tri} aria-pressed={p.tri === tri}>
                  {LIBELLES_TRI[tri]}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.filtre} role="group" aria-labelledby="titre-proteine">
            <p id="titre-proteine" className={styles.libelleFiltre}>Protéine principale (estimée)</p>
            <div className={styles.proteines}>
              <button
                type="submit"
                form={FORMULAIRE}
                name="proteine"
                value=""
                className={styles.puceProteine}
                aria-pressed={!p.proteine}
              >
                Toutes
              </button>
              {PROTEINES.map((pr) => {
                const n = resultat.proteines[pr] ?? 0;
                const actif = p.proteine === pr;
                if (n === 0 && !actif) return null;
                return (
                  <button
                    key={pr}
                    type="submit"
                    form={FORMULAIRE}
                    name="proteine"
                    value={actif ? "" : pr}
                    className={styles.puceProteine}
                    aria-pressed={actif}
                  >
                    {LIBELLES_PROTEINE[pr]}
                    <span className={styles.compte} aria-hidden="true">{n}</span>
                    <span className="sr-only">({n} recette{n > 1 ? "s" : ""})</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {resultat && !notes && (p.tri !== "recentes" || p.proteine) && (
        <p className={styles.info}>Tri et filtres par note bientôt disponibles : recettes affichées par date.</p>
      )}

      {resultat && resultat.recettes.length > 0 && (
        <p className={styles.resultats} aria-live="polite">
          {libelleResultats(resultat.total, notes ? p.tri : "recentes", notes ? p.proteine : null)}
        </p>
      )}

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
            <CarteRecette key={r.cle} r={r} enAvant={enAvant} />
          ))}
        </div>
      )}

      {resultat && resultat.total > PAR_PAGE && (
        <nav className={styles.pagination} aria-label="Pagination">
          {p.page > 1 ? <Link href={hrefBanque(p, { page: p.page - 1 })}>← Précédent</Link> : <span aria-hidden="true" />}
          <span>Page {p.page} sur {pages}</span>
          {p.page < pages ? <Link href={hrefBanque(p, { page: p.page + 1 })}>Suivant →</Link> : <span aria-hidden="true" />}
        </nav>
      )}
    </div>
  );
}
