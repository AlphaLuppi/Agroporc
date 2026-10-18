import { ensureTable, getWeekPdj, getCartesDisponibles } from "@/lib/db";
import type { PdjEntry } from "@/lib/db";
import MenusClient from "./menus/MenusClient";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ semaine?: string }> }) {
  await ensureTable();
  const params = await searchParams;
  const monday = resolveMonday(params.semaine);
  const mondayStr = monday.toLocaleDateString("en-CA");
  const weekPdj = await getWeekPdj(mondayStr);
  const cartes = await getCartesDisponibles();
  const semaine = buildFullWeek(weekPdj, monday);
  const prev = new Date(monday); prev.setDate(monday.getDate() - 7);
  const next = new Date(monday); next.setDate(monday.getDate() + 7);

  const today = new Date().toLocaleDateString("en-CA");
  const todayIdx = semaine.findIndex((p) => p.date === today);

  return (
    <MenusClient
      semaine={semaine}
      cartes={cartes.map((c) => c.slug)}
      today={today}
      defaultIdx={todayIdx >= 0 ? todayIdx : 0}
      weekLabel={formatWeekRange(semaine[0].date, semaine[semaine.length - 1].date)}
      prevHref={`/?semaine=${prev.toLocaleDateString("en-CA")}`}
      nextHref={`/?semaine=${next.toLocaleDateString("en-CA")}`}
      isCurrentWeek={mondayStr === resolveMonday().toLocaleDateString("en-CA")}
    />
  );
}

function resolveMonday(semaine?: string): Date {
  if (semaine && /^\d{4}-\d{2}-\d{2}$/.test(semaine)) {
    const d = new Date(semaine + "T12:00:00");
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    return d;
  }
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return monday;
}

function buildFullWeek(existingPdj: PdjEntry[], monday: Date): PdjEntry[] {
  const existingByDate = new Map(existingPdj.map((p) => [p.date, p]));

  const week: PdjEntry[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = d.toLocaleDateString('en-CA');
    const existing = existingByDate.get(dateStr);
    if (existing) {
      week.push(existing);
    } else {
      week.push({ date: dateStr, plats: [], erreur: "Pas encore de données pour ce jour" });
    }
  }
  return week;
}

const MOIS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « 12 au 16 oct. 2026 » ; « 29 sept. au 3 oct. 2026 » quand la semaine chevauche deux mois. */
function formatWeekRange(startIso: string, endIso: string): string {
  const s = new Date(startIso + "T12:00:00");
  const e = new Date(endIso + "T12:00:00");
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  if (sameMonth) {
    return `${s.getDate()} au ${e.getDate()} ${MOIS_FR[e.getMonth()]} ${e.getFullYear()}`;
  }
  return `${s.getDate()} ${MOIS_FR[s.getMonth()]} au ${e.getDate()} ${MOIS_FR[e.getMonth()]} ${e.getFullYear()}`;
}
