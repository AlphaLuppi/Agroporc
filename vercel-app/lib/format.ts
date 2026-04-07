const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

const JOURS = [
  "dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi",
];

/** "2026-04-03" → "Jeudi 3 avril 2026" */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const jour = JOURS[d.getDay()];
  return `${jour.charAt(0).toUpperCase() + jour.slice(1)} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "2026-04-03" → "Jeudi 3 avril" (sans année) */
export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const jour = JOURS[d.getDay()];
  return `${jour.charAt(0).toUpperCase() + jour.slice(1)} ${d.getDate()} ${MOIS[d.getMonth()]}`;
}

/** "2026-04-03" → "Jeu." */
export function formatDayShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const jour = JOURS[d.getDay()];
  return jour.charAt(0).toUpperCase() + jour.slice(1, 3) + ".";
}

/** "2026-04-03" → "Jeudi" */
export function formatDayName(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const jour = JOURS[d.getDay()];
  return jour.charAt(0).toUpperCase() + jour.slice(1);
}

export function noteClass(note: number | string): string {
  if (typeof note !== "number") return "ok";
  if (note >= 7) return "good";
  if (note >= 5) return "ok";
  return "bad";
}

export function monthLabel(year: number, month: number): string {
  return `${MOIS[month - 1].charAt(0).toUpperCase() + MOIS[month - 1].slice(1)} ${year}`;
}
