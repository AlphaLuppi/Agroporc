import { ensureTable, getAllPdj } from "@/lib/db";
import { formatDate, noteClass, monthLabel } from "@/lib/format";
import { getIcon } from "@/lib/icons";
import type { PdjEntry, Plat } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HistoriqueClient } from "./client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Historique - Plats du Jour" };

export default async function HistoriquePage() {
  await ensureTable();
  const allPdj = await getAllPdj();

  let totalNotes = 0;
  let countNotes = 0;
  for (const p of allPdj) {
    for (const plat of p.plats || []) {
      if (typeof plat.note === "number") {
        totalNotes += plat.note;
        countNotes++;
      }
    }
  }
  const avgNote = countNotes ? (totalNotes / countNotes).toFixed(1) : "0";

  const pdjByDate: Record<string, PdjEntry> = {};
  const monthsSet = new Set<string>();
  for (const pdj of allPdj) {
    if (!pdj.date) continue;
    pdjByDate[pdj.date] = pdj;
    monthsSet.add(pdj.date.substring(0, 7));
  }
  const monthsSorted = [...monthsSet].sort().reverse();
  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1" style={{ fontFamily: "var(--font-heading)" }}>
        Historique
      </h1>

      <div className="flex gap-4 sm:gap-6 mb-6 sm:mb-8 flex-wrap">
        {[
          { value: allPdj.length, label: `jour${allPdj.length > 1 ? "s" : ""}` },
          { value: countNotes, label: "plats notés" },
          { value: avgNote, label: "note moyenne" },
        ].map((s) => (
          <div key={s.label} className="flex flex-col">
            <span className="text-xl sm:text-2xl font-bold text-[var(--accent)] tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>
              {s.value}
            </span>
            <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{s.label}</span>
          </div>
        ))}
      </div>

      {monthsSorted.length > 0 && (
        <CalendarView monthsSorted={monthsSorted} pdjByDate={pdjByDate} todayStr={todayStr} />
      )}

      <HistoriqueClient />
    </>
  );
}

function CalendarView({
  monthsSorted,
  pdjByDate,
  todayStr,
}: {
  monthsSorted: string[];
  pdjByDate: Record<string, PdjEntry>;
  todayStr: string;
}) {
  const latestKey = monthsSorted[0];
  const [latestY, latestM] = latestKey.split("-").map(Number);

  const labelAttrs: Record<string, string> = {};
  for (const key of monthsSorted) {
    const [y, m] = key.split("-").map(Number);
    labelAttrs[`data-labels-${key}`] = monthLabel(y, m);
  }

  return (
    <>
      <div className="flex items-center justify-center gap-4 mb-6">
        <Button
          variant="outline"
          size="icon"
          id="cal-prev"
          aria-label="Mois précédent"
          data-action="prev"
          className="calendar-nav-btn bg-[var(--surface)] border-[var(--border)] text-[var(--text-secondary)] w-9 h-9 hover:bg-[var(--surface-hover)] hover:border-[var(--border-accent)] hover:text-[var(--text)]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4.5 h-4.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Button>
        <span
          className="calendar-month-label text-xl font-semibold min-w-[200px] text-center"
          id="month-label"
          data-month={latestKey}
          style={{ fontFamily: "var(--font-heading)" }}
          {...labelAttrs}
        >
          {monthLabel(latestY, latestM)}
        </span>
        <Button
          variant="outline"
          size="icon"
          id="cal-next"
          aria-label="Mois suivant"
          data-action="next"
          className="calendar-nav-btn bg-[var(--surface)] border-[var(--border)] text-[var(--text-secondary)] w-9 h-9 hover:bg-[var(--surface-hover)] hover:border-[var(--border-accent)] hover:text-[var(--text)]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4.5 h-4.5">
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </Button>
      </div>

      {monthsSorted.map((key) => {
        const [y, m] = key.split("-").map(Number);
        const isLatest = key === latestKey;
        return (
          <MonthGrid key={key} year={y} month={m} pdjByDate={pdjByDate} todayStr={todayStr} hidden={!isLatest} />
        );
      })}
    </>
  );
}

function MonthGrid({
  year,
  month,
  pdjByDate,
  todayStr,
  hidden,
}: {
  year: number;
  month: number;
  pdjByDate: Record<string, PdjEntry>;
  todayStr: string;
  hidden: boolean;
}) {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const dayNames = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  const firstDay = new Date(year, month - 1, 1);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells = [];

  for (let i = 0; i < firstWeekday; i++) {
    cells.push(<div key={`empty-${i}`} className="calendar-cell empty" />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dt = new Date(year, month - 1, day);
    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
    const hasPdj = dateStr in pdjByDate;
    const isToday = dateStr === todayStr;

    const classes = ["calendar-cell"];
    if (hasPdj) classes.push("has-pdj");
    else if (isWeekend) classes.push("weekend");
    else classes.push("no-pdj");
    if (isToday) classes.push("today");

    if (hasPdj) {
      cells.push(
        <div key={day} className={classes.join(" ")} data-date={dateStr} role="button" tabIndex={0}>
          {day}
          <span className="pdj-dot" />
        </div>
      );
    } else {
      cells.push(
        <div key={day} className={classes.join(" ")}>{day}</div>
      );
    }
  }

  const details = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!(dateStr in pdjByDate)) continue;
    const pdj = pdjByDate[dateStr];
    const reco = pdj.recommandation;
    const recoText = reco ? `${reco.restaurant} — ${reco.plat}` : "";

    details.push(
      <div key={dateStr} className="day-detail" id={`detail-${dateStr}`}>
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-[var(--border)]">
          <div>
            <div className="font-semibold text-lg" style={{ fontFamily: "var(--font-heading)" }}>
              {formatDate(dateStr)}
            </div>
            <div className="text-sm text-[var(--accent)] font-medium">{recoText}</div>
          </div>
          <button
            className="bg-transparent border-none text-[var(--text-muted)] cursor-pointer p-1 rounded transition-colors hover:text-[var(--text)]"
            data-action="close-day"
            aria-label="Fermer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4.5 h-4.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {(pdj.plats || []).map((plat, i) => (
          <HistoryPlat key={i} plat={plat} />
        ))}
      </div>
    );
  }

  return (
    <div className="calendar-month" data-month={key} style={hidden ? { display: "none" } : undefined}>
      <div className="calendar-grid">
        {dayNames.map((dn) => (
          <div key={dn} className="text-center text-[0.72rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider py-2">
            {dn}
          </div>
        ))}
        {cells}
      </div>
      {details}
    </div>
  );
}

function HistoryPlat({ plat }: { plat: Plat }) {
  const note = plat.note ?? "?";
  const noteG = plat.note_goulaf ?? note;
  const noteCls = noteClass(note);
  const noteGCls = noteClass(noteG);

  return (
    <div className="py-3 border-b border-[var(--border)] last:border-b-0 flex justify-between items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
          <span dangerouslySetInnerHTML={{ __html: getIcon(plat.restaurant) }} className="[&_.icon]:w-3.5 [&_.icon]:h-3.5" />
          {plat.restaurant}
        </div>
        <div className="text-sm font-medium">
          {plat.plat} &mdash; {plat.prix || "?"}
        </div>
      </div>
      <span className={`note note-${noteCls} mode-sportif text-sm shrink-0`}>
        {note}<span className="note-max">/10</span>
      </span>
      <span className={`note note-${noteGCls} mode-goulaf text-sm shrink-0`} style={{ display: "none" }}>
        {noteG}<span className="note-max">/10</span>
      </span>
    </div>
  );
}
