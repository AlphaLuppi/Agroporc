import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRecette } from "@/lib/db";
import { formatDateShort } from "@/lib/format";
import { casseLisible } from "@/lib/menus-vue";
import { CLE_IMAGE_RE } from "@/lib/plat-image";
import {
  BANDEAU_HONNETETE_DEBUT, BANDEAU_HONNETETE_SUITE, formaterDuree, hrefBanque, jourParis, LEGENDE_SANS_NOTE, libelleDifficulte, LIBELLES_PROTEINE,
  PROTEINES, tempsTotal,
} from "@/lib/recettes";
import type { Envie } from "@/lib/quiz-engine";
import PlatImage from "../../menus/PlatImage";
import RestoBadge from "../../components/RestoBadge";
import AjusteurRecette from "./AjusteurRecette";
import NotesRecette from "../NotesRecette";
import styles from "../recettes.module.css";

export const dynamic = "force-dynamic";

type Params = Promise<{ cle: string }>;

async function charger(cle: string) {
  return CLE_IMAGE_RE.test(cle) ? getRecette(cle) : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { cle } = await params;
  const recette = await charger(cle).catch(() => null);
  return { title: recette ? `${recette.titre} — Recettes — Agroporc` : "Recettes — Agroporc" };
}

/** Fiche d'une recette maison inspirée d'un plat du jour (jamais présentée comme celle du restaurant). */
export default async function RecettePage({ params }: { params: Params }) {
  const { cle } = await params;
  let r: Awaited<ReturnType<typeof charger>>;
  try {
    r = await charger(cle);
  } catch (e) {
    // Base indisponible : message propre plutôt qu'une erreur 500 (comme la banque /recettes).
    console.error("[recettes] fiche indisponible", e);
    return (
      <article className={styles.fiche}>
        <Link href="/recettes" className={styles.fil}>← Toutes les recettes</Link>
        <p className={styles.vide}>Recette indisponible pour le moment.</p>
      </article>
    );
  }
  if (!r) notFound();

  const creeLe = jourParis(r.cree_le);
  const dates = r.dates_service.slice(0, 10);
  const notee = r.note_sportif != null || r.note_goulaf != null;
  const proteine = r.proteine && (PROTEINES as readonly string[]).includes(r.proteine) ? (r.proteine as Envie) : null;

  return (
    <article className={styles.fiche}>
      <Link href="/recettes" className={styles.fil}>← Toutes les recettes</Link>

      {r.image && (
        <figure className={styles.ficheImage}>
          <PlatImage key={r.image.src} src={r.image.src} nom={casseLisible(r.plat)} format="panneau" />
          {r.image.credit && <figcaption>Image : {r.image.credit}</figcaption>}
        </figure>
      )}

      <header className={styles.ficheTete}>
        <h1>{r.titre}</h1>
        <p className={styles.inspiree}>
          Inspirée de « {casseLisible(r.plat)} » · <RestoBadge nom={r.restaurant} complet />
        </p>
        {r.description && <p className={styles.description}>{r.description}</p>}
      </header>

      <p className={styles.bandeau} role="note">
        <strong>{BANDEAU_HONNETETE_DEBUT}</strong>
        {BANDEAU_HONNETETE_SUITE}
      </p>

      <NotesRecette sportif={r.note_sportif} goulaf={r.note_goulaf} date={r.note_date} taille="fiche" />
      <p className={styles.legendeNotes}>
        {!notee
          ? LEGENDE_SANS_NOTE
          : r.note_date
            ? `Notes du plat du jour évalué le ${formatDateShort(r.note_date).toLowerCase()} — pas de la recette maison.`
            : "Notes du plat du jour dont la recette s'inspire."}
      </p>

      <ul className={styles.puces}>
        <li><span>Préparation</span>{formaterDuree(r.temps_preparation_min)}</li>
        <li><span>Cuisson</span>{formaterDuree(r.temps_cuisson_min)}</li>
        {r.temps_repos_min > 0 && <li><span>Repos</span>{formaterDuree(r.temps_repos_min)}</li>}
        <li><span>Total</span>{formaterDuree(tempsTotal(r))}</li>
        <li><span>Difficulté</span>{libelleDifficulte(r.difficulte)}</li>
      </ul>

      <section className={styles.section}>
        <h2>Ingrédients</h2>
        <AjusteurRecette ingredients={r.ingredients} personnes={r.personnes} />
      </section>

      <section className={styles.section}>
        <h2>Préparation</h2>
        <ol className={styles.etapes}>
          {r.etapes.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ol>
      </section>

      {r.astuces.length > 0 && (
        <section className={styles.section}>
          <h2>Astuces</h2>
          <ul className={styles.liste}>
            {r.astuces.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      {r.ustensiles.length > 0 && (
        <section className={styles.section}>
          <h2>Ustensiles</h2>
          <p className={styles.ustensiles}>{r.ustensiles.join(" · ")}</p>
        </section>
      )}

      <footer className={styles.pied}>
        {dates.length > 0 && (
          <p>
            Servi le {dates.map((d) => formatDateShort(d).toLowerCase()).join(", ")}
            {r.dates_service.length > dates.length && "…"}
          </p>
        )}
        {creeLe && <p>Recette rédigée le {formatDateShort(creeLe).toLowerCase()}</p>}
      </footer>

      {proteine && (
        <Link
          href={hrefBanque({ q: "", slug: null, tri: "recentes", proteine: null, page: 1 }, { proteine })}
          className={styles.fil}
        >
          Autres recettes {LIBELLES_PROTEINE[proteine].toLowerCase()} →
        </Link>
      )}
    </article>
  );
}
