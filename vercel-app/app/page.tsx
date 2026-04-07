import { ensureTable, getWeekPdj } from "@/lib/db";
import { formatDate, formatDayShort, noteClass } from "@/lib/format";
import { getIcon } from "@/lib/icons";
import type { Plat, PdjEntry, Recommandation } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import CommentSection from "./CommentSection";

export const dynamic = "force-dynamic";

export default async function Home() {
  await ensureTable();
  const weekPdj = await getWeekPdj();
  const fullWeek = buildFullWeek(weekPdj);
  return <WeekView weekPdj={fullWeek} />;
}

function buildFullWeek(existingPdj: PdjEntry[]): PdjEntry[] {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);

  const existingByDate = new Map(existingPdj.map((p) => [p.date, p]));

  const week: PdjEntry[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const existing = existingByDate.get(dateStr);
    if (existing) {
      week.push(existing);
    } else {
      week.push({ date: dateStr, plats: [], erreur: "Pas encore de données pour ce jour" });
    }
  }
  return week;
}

function WeekView({ weekPdj }: { weekPdj: PdjEntry[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const todayIdx = weekPdj.findIndex((p) => p.date === today);
  const defaultIdx = todayIdx >= 0 ? todayIdx : 0;

  return (
    <>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1" style={{ fontFamily: "var(--font-heading)" }}>
        Plats du jour{" "}
        <Badge variant="outline" className="mode-sportif text-[var(--good)] border-[var(--good-border)] bg-[var(--good-bg)] text-[0.65rem] uppercase tracking-widest align-middle ml-2">
          Mode Sportif
        </Badge>
        <Badge variant="outline" className="mode-goulaf text-[var(--ok)] border-[var(--ok-border)] bg-[var(--ok-bg)] text-[0.65rem] uppercase tracking-widest align-middle ml-2" style={{ display: "none" }}>
          Mode Goulaf
        </Badge>
      </h1>

      {weekPdj.length > 1 && (
        <div className="day-tabs flex gap-1 mb-4 sm:mb-5 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] p-1 overflow-x-auto">
          {weekPdj.map((pdj, i) => {
            const isToday = pdj.date === today;
            return (
              <button
                key={pdj.date}
                className={`day-tab flex-1 flex flex-col items-center gap-0.5 py-2 px-3 border-none rounded-[calc(var(--radius)-4px)] bg-transparent text-[var(--text-muted)] font-semibold text-sm cursor-pointer transition-all relative min-w-0 ${i === defaultIdx ? "active !bg-[var(--accent)] !text-[var(--accent-text)] shadow" : ""} ${isToday && i !== defaultIdx ? "!text-[var(--accent)]" : ""}`}
                data-day-index={i}
              >
                <span className="text-[0.72rem] uppercase tracking-wider">{formatDayShort(pdj.date)}</span>
                <span className="text-lg font-bold leading-none">{new Date(pdj.date + "T12:00:00").getDate()}</span>
                {isToday && <span className="w-1 h-1 rounded-full bg-current absolute bottom-1" />}
              </button>
            );
          })}
        </div>
      )}

      <ModeSelector />

      {weekPdj.map((pdj, i) => (
        <DayPanel key={pdj.date} pdj={pdj} index={i} isDefault={i === defaultIdx} today={today} />
      ))}
    </>
  );
}

function DayPanel({ pdj, index, isDefault, today }: { pdj: PdjEntry; index: number; isDefault: boolean; today: string }) {
  const hidden = !isDefault ? { display: "none" as const } : undefined;
  const isFuture = pdj.date > today;

  if (pdj.ferie) {
    return (
      <div className="day-panel" data-day-panel={index} style={hidden}>
        <p className="text-[var(--text-secondary)] text-sm mb-5 sm:mb-8">{formatDate(pdj.date)}</p>
        <Card className="bg-[var(--bad-bg)] border-[var(--bad-border)] text-[var(--bad)] text-center p-8">
          <CardContent className="p-0">
            Jour férié &mdash; {pdj.ferie}<br />Les restaurants sont fermés.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (pdj.erreur) {
    return (
      <div className="day-panel" data-day-panel={index} style={hidden}>
        <p className="text-[var(--text-secondary)] text-sm mb-5 sm:mb-8">{formatDate(pdj.date)}</p>
        <Card className="bg-[var(--bad-bg)] border-[var(--bad-border)] text-[var(--bad)] text-center p-8">
          <CardContent className="p-0">{pdj.erreur}</CardContent>
        </Card>
      </div>
    );
  }

  const reco = pdj.recommandation;
  const recoG = pdj.recommandation_goulaf || reco;

  return (
    <div className="day-panel" data-day-panel={index} style={hidden}>
      <p className="text-[var(--text-secondary)] text-sm mb-5 sm:mb-8">
        {formatDate(pdj.date)}
        {isFuture && (
          <Badge variant="outline" className="ml-3 text-[0.65rem] uppercase tracking-widest bg-purple-500/10 text-purple-400 border-purple-500/25">
            Aperçu
          </Badge>
        )}
      </p>

      {reco && <RecoBanner reco={reco} mode="sportif" />}
      {recoG && <RecoBanner reco={recoG} mode="goulaf" />}

      {pdj.plats.map((plat, i) =>
        plat.coming_soon ? (
          <ComingSoonCard key={i} plat={plat} />
        ) : (
          <PlatCard key={i} plat={plat} date={pdj.date} platIndex={i} isRecoSportif={plat.plat === reco?.plat} isRecoGoulaf={plat.plat === recoG?.plat} />
        )
      )}
    </div>
  );
}

function ComingSoonCard({ plat }: { plat: Plat }) {
  return (
    <Card className="bg-[var(--surface)] border-[var(--border)] border-dashed opacity-75 mb-4 sm:mb-5" style={{ backgroundImage: "var(--card-stripe)" }}>
      <CardContent className="p-6">
        <div className="flex items-center gap-2 text-[var(--text-secondary)] font-semibold text-sm mb-4">
          <span dangerouslySetInnerHTML={{ __html: getIcon(plat.restaurant) }} />
          {plat.restaurant}
        </div>
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <svg className="text-[var(--text-muted)] opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="32" height="32">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <div className="text-lg font-semibold text-[var(--text-secondary)] italic" style={{ fontFamily: "var(--font-heading)" }}>Coming soon</div>
          <div className="text-sm text-[var(--text-muted)]">Le plat du jour sera dévoilé le matin même</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ModeSelector() {
  return (
    <div className="mode-selector flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] rounded-full p-[3px] mb-5 sm:mb-6 w-fit">
      <button
        className="mode-btn active flex items-center justify-center gap-1.5 px-4 py-1.5 border-none rounded-full bg-transparent text-[var(--text-muted)] font-semibold text-sm cursor-pointer transition-all min-h-9"
        data-mode="sportif"
        aria-label="Mode sportif"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
          <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
          <line x1="6" y1="1" x2="6" y2="4" />
          <line x1="10" y1="1" x2="10" y2="4" />
          <line x1="14" y1="1" x2="14" y2="4" />
        </svg>
        <span className="label-text hidden sm:inline">Sportif</span>
      </button>
      <button
        className="mode-btn flex items-center justify-center gap-1.5 px-4 py-1.5 border-none rounded-full bg-transparent text-[var(--text-muted)] font-semibold text-sm cursor-pointer transition-all min-h-9"
        data-mode="goulaf"
        aria-label="Mode goulaf"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" />
          <path d="M12 6v4" />
          <path d="M10 8h4" />
        </svg>
        <span className="label-text hidden sm:inline">Goulaf</span>
      </button>
    </div>
  );
}

function RecoBanner({ reco, mode }: { reco: Recommandation; mode: "sportif" | "goulaf" }) {
  const modeClass = mode === "sportif" ? "mode-sportif" : "mode-goulaf";
  const hidden = mode === "goulaf" ? { display: "none" as const } : undefined;

  return (
    <Card className={`${modeClass} bg-[var(--good-bg)] border-[var(--good-border)] mb-6 sm:mb-8 relative overflow-hidden`} style={hidden}>
      <div className="absolute top-0 left-0 w-1 h-full bg-[var(--good)] rounded-l" />
      <CardContent className="p-5 sm:p-6 pl-6 sm:pl-7">
        <div className="text-[0.72rem] font-bold uppercase tracking-widest text-[var(--good)] mb-1.5">
          Recommandation du jour
        </div>
        <div className="font-semibold mb-0.5">
          <span dangerouslySetInnerHTML={{ __html: getIcon(reco.restaurant) }} />{" "}
          {reco.restaurant} &mdash; {reco.plat}
        </div>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{reco.raison}</p>
      </CardContent>
    </Card>
  );
}

function PlatCard({ plat, date, platIndex, isRecoSportif, isRecoGoulaf }: { plat: Plat; date: string; platIndex: number; isRecoSportif: boolean; isRecoGoulaf: boolean }) {
  const note = plat.note ?? "?";
  const noteG = plat.note_goulaf ?? note;
  const noteCls = noteClass(note);
  const noteGCls = noteClass(noteG);
  const nutri = plat.nutrition_estimee;

  const cardClasses = [
    "plat-card bg-[var(--surface)] border-[var(--border)] mb-4 sm:mb-5 relative overflow-hidden transition-all hover:border-[var(--border-accent)] hover:shadow-[var(--shadow)]",
    isRecoSportif ? "recommended-sportif" : "",
    isRecoGoulaf ? "recommended-goulaf" : "",
  ].filter(Boolean).join(" ");

  return (
    <Card className={cardClasses} style={{ backgroundImage: "var(--card-stripe)" }}>
      <CardContent className="p-4 sm:p-6">
        {isRecoSportif && <div className="reco-ribbon mode-sportif">TOP</div>}
        {isRecoGoulaf && <div className="reco-ribbon mode-goulaf" style={{ display: "none" }}>TOP</div>}

        <div className="flex justify-between items-center mb-3">
          <span className="flex items-center gap-2 font-semibold text-sm text-[var(--text-secondary)]">
            <span dangerouslySetInnerHTML={{ __html: getIcon(plat.restaurant) }} />
            {plat.restaurant}
          </span>
          <span className={`note note-${noteCls} mode-sportif`} data-note={note}>
            {note}<span className="note-max">/10</span>
          </span>
          <span className={`note note-${noteGCls} mode-goulaf`} data-note={noteG} style={{ display: "none" }}>
            {noteG}<span className="note-max">/10</span>
          </span>
        </div>

        <div className="text-xl font-semibold mb-0.5 leading-snug" style={{ fontFamily: "var(--font-heading)" }}>
          {plat.plat}{" "}
          {isRecoSportif && (
            <Badge className="mode-sportif bg-[var(--good)] text-black text-[0.65rem] font-bold uppercase tracking-wide align-middle">
              Recommandé
            </Badge>
          )}
          {isRecoGoulaf && (
            <Badge className="mode-goulaf bg-[var(--good)] text-black text-[0.65rem] font-bold uppercase tracking-wide align-middle" style={{ display: "none" }}>
              Recommandé
            </Badge>
          )}
        </div>

        <div className="text-[var(--accent)] font-bold mb-4">{plat.prix}</div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {[
            { value: nutri?.calories ?? "?", label: "kcal" },
            { value: `${nutri?.proteines_g ?? "?"}g`, label: "Protéines" },
            { value: `${nutri?.glucides_g ?? "?"}g`, label: "Glucides" },
            { value: `${nutri?.lipides_g ?? "?"}g`, label: "Lipides" },
          ].map((m) => (
            <div key={m.label} className="text-center py-2.5 px-1 bg-[var(--surface-accent)] rounded-[var(--radius-sm)] border border-[var(--border)]">
              <span className="block font-bold text-base tabular-nums text-[var(--text)]">{m.value}</span>
              <span className="block text-[0.7rem] text-[var(--text-muted)] uppercase tracking-wider mt-0.5">{m.label}</span>
            </div>
          ))}
        </div>

        <p className="mode-sportif text-sm text-[var(--text-secondary)] leading-relaxed">{plat.justification}</p>
        <p className="mode-goulaf text-sm text-[var(--text-secondary)] leading-relaxed" style={{ display: "none" }}>
          {plat.justification_goulaf || plat.justification}
        </p>

        <CommentSection commentaires={plat.commentaires || []} date={date} platIndex={platIndex} />
      </CardContent>
    </Card>
  );
}
