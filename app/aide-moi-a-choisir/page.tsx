import { ensureTable, getPdjByDate, getCarte, getDessertsObservations } from "@/lib/db";
import type { Carte } from "@/lib/db";
import type { PoolPlat } from "@/lib/quiz-plats";
import {
  DESSERTS_CONNUS,
  classerDessertNom,
  aggregateObservations,
  mergeDesserts,
  isoMinusDays,
  type DessertConnu,
} from "@/lib/desserts";
import QuizClient from "./QuizClient";

export const dynamic = "force-dynamic";

const SLUGS: { slug: string; nom: string }[] = [
  { slug: "bistrot_trefle", nom: "Le Bistrot Trèfle" },
  { slug: "pause_gourmande", nom: "La Pause Gourmande" },
  { slug: "truck_muche", nom: "Le Truck Muche" },
];

function platsFromCarte(carte: Carte | null, fallbackNom: string): PoolPlat[] {
  if (!carte) return [];
  const restaurant = carte.restaurant ?? fallbackNom;
  const out: PoolPlat[] = [];
  for (const section of carte.sections) {
    if (/dessert/i.test(section.nom)) continue; // les desserts sont gérés à part
    for (const cp of section.plats) {
      out.push({
        plat: cp.plat,
        restaurant,
        prix: cp.prix,
        note: cp.note,
        justification: cp.justification,
        note_goulaf: cp.note_goulaf,
        justification_goulaf: cp.justification_goulaf,
        ingredients_detail: cp.ingredients_detail,
      });
    }
  }
  return out;
}

function dessertsFromCarte(carte: Carte | null, fallbackNom: string): DessertConnu[] {
  if (!carte) return [];
  const restaurant = carte.restaurant ?? fallbackNom;
  const out: DessertConnu[] = [];
  for (const section of carte.sections) {
    if (!/dessert/i.test(section.nom)) continue;
    for (const cp of section.plats) {
      const { type_saveur, leger_gourmand } = classerDessertNom(cp.plat);
      out.push({
        nom: cp.plat,
        restaurant,
        type_saveur,
        leger_gourmand,
        proba: 100, // carte fiable
        note: cp.note,
      });
    }
  }
  return out;
}

export default async function AideMoiAChoisir() {
  await ensureTable();
  const today = new Date().toLocaleDateString("en-CA");
  const todayPdj = await getPdjByDate(today);
  const cartes = await Promise.all(SLUGS.map((s) => getCarte(s.slug)));

  // Pool = plats du jour + plats de toutes les cartes
  const platsJour: PoolPlat[] = (todayPdj?.plats ?? [])
    .filter((p) => !p.coming_soon)
    .map((p) => ({
      plat: p.plat,
      restaurant: p.restaurant,
      prix: p.prix,
      note: p.note,
      justification: p.justification,
      note_goulaf: p.note_goulaf,
      justification_goulaf: p.justification_goulaf,
      ingredients_detail: p.ingredients_detail,
      quiz_tags: p.quiz_tags,
    }));

  // Le quiz porte sur les plats du jour ; repli sur les cartes s'il n'y en a pas encore.
  const platsCartes = cartes.flatMap((c, i) => platsFromCarte(c, SLUGS[i].nom));
  const pool: PoolPlat[] = platsJour.length > 0 ? platsJour : platsCartes;

  // Desserts Truck Muche : observations réelles (proba = fréquence), seed en fallback cold-start.
  const observations = await getDessertsObservations(isoMinusDays(today, 60));
  const observed = aggregateObservations(observations, { today, windowDays: 60 });
  const truckDesserts = mergeDesserts(observed, DESSERTS_CONNUS);

  const desserts: DessertConnu[] = [
    ...truckDesserts,
    ...cartes.flatMap((c, i) => dessertsFromCarte(c, SLUGS[i].nom)),
  ];

  return <QuizClient pool={pool} desserts={desserts} hasJour={platsJour.length > 0} />;
}
