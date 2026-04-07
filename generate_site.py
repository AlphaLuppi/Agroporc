"""
Générateur de site statique pour les Plats du Jour.
Lit les JSON (pdj.json + historique/) et produit un site dans site/.
"""
import json
import shutil
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
OUTPUT_DIR = BASE_DIR / "output"
SITE_DIR = BASE_DIR / "site"
HISTORY_DIR = OUTPUT_DIR / "historique"
PDJ_FILE = OUTPUT_DIR / "pdj.json"

MOIS = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]

JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]

# SVG icons for restaurants (inline, no emoji)
RESTAURANT_ICON = {
    "Le Bistrot Trèfle": '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C8 2 4 6 4 10c0 2.5 1.5 4.5 3.5 5.5L12 22l4.5-6.5C18.5 14.5 20 12.5 20 10c0-4-4-8-8-8z"/><circle cx="12" cy="10" r="2"/></svg>',
    "La Pause Gourmande": '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/></svg>',
    "Le Truck Muche": '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 13.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>',
}

DEFAULT_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>'


def _format_date(date_str: str) -> str:
    """'2026-04-03' → 'Jeudi 3 avril 2026'"""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return f"{JOURS[d.weekday()].capitalize()} {d.day} {MOIS[d.month - 1]} {d.year}"


def _note_class(note: int) -> str:
    if note >= 7:
        return "good"
    if note >= 5:
        return "ok"
    return "bad"


def _render_plat_card(plat: dict, is_recommended: bool = False, is_recommended_goulaf: bool = False) -> str:
    icon = RESTAURANT_ICON.get(plat["restaurant"], DEFAULT_ICON)
    note = plat.get("note", "?")
    note_cls = _note_class(note) if isinstance(note, int) else "ok"
    note_g = plat.get("note_goulaf", note)
    note_g_cls = _note_class(note_g) if isinstance(note_g, int) else "ok"
    nutri = plat.get("nutrition_estimee", {})
    reco_badge = '<span class="badge-reco mode-sportif">Recommandé</span>' if is_recommended else ""
    reco_badge_g = '<span class="badge-reco mode-goulaf" style="display:none">Recommandé</span>' if is_recommended_goulaf else ""

    reco_class_s = " recommended-sportif" if is_recommended else ""
    reco_class_g = " recommended-goulaf" if is_recommended_goulaf else ""
    ribbon_s = '<div class="reco-ribbon mode-sportif">TOP</div>' if is_recommended else ''
    ribbon_g = '<div class="reco-ribbon mode-goulaf" style="display:none">TOP</div>' if is_recommended_goulaf else ''

    justif = plat.get('justification', '')
    justif_g = plat.get('justification_goulaf', justif)

    return f"""
    <div class="plat-card{reco_class_s}{reco_class_g}">
      {ribbon_s}{ribbon_g}
      <div class="plat-header">
        <span class="restaurant-name">{icon} {plat['restaurant']}</span>
        <span class="note note-{note_cls} mode-sportif" data-note="{note}">{note}<span class="note-max">/10</span></span>
        <span class="note note-{note_g_cls} mode-goulaf" data-note="{note_g}" style="display:none">{note_g}<span class="note-max">/10</span></span>
      </div>
      <div class="plat-name">{plat['plat']} {reco_badge}{reco_badge_g}</div>
      <div class="plat-prix">{plat.get('prix', '?')}</div>
      <div class="macro-grid">
        <div class="macro-item">
          <span class="macro-value">{nutri.get('calories', '?')}</span>
          <span class="macro-label">kcal</span>
        </div>
        <div class="macro-item">
          <span class="macro-value">{nutri.get('proteines_g', '?')}g</span>
          <span class="macro-label">Protéines</span>
        </div>
        <div class="macro-item">
          <span class="macro-value">{nutri.get('glucides_g', '?')}g</span>
          <span class="macro-label">Glucides</span>
        </div>
        <div class="macro-item">
          <span class="macro-value">{nutri.get('lipides_g', '?')}g</span>
          <span class="macro-label">Lipides</span>
        </div>
      </div>
      <p class="plat-justification mode-sportif">{justif}</p>
      <p class="plat-justification mode-goulaf" style="display:none">{justif_g}</p>
    </div>"""


def _load_all_pdj() -> list[dict]:
    """Charge tous les PDJ (actuel + historique), triés du plus récent au plus ancien."""
    pdjs = []

    if PDJ_FILE.exists():
        try:
            pdjs.append(json.loads(PDJ_FILE.read_text()))
        except Exception:
            pass

    if HISTORY_DIR.exists():
        for f in HISTORY_DIR.glob("pdj_*.json"):
            try:
                data = json.loads(f.read_text())
                pdjs.append(data)
            except Exception:
                continue

    seen = set()
    unique = []
    for p in pdjs:
        d = p.get("date")
        if d and d not in seen:
            seen.add(d)
            unique.append(p)

    unique.sort(key=lambda x: x.get("date", ""), reverse=True)
    return unique


def _css() -> str:
    return """
    /* ── Reset & Base ──────────────────────────────── */
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    /* ── Theme: Normal (dark elegant) ──────────────── */
    :root, [data-theme="normal"] {
      --bg: #0c0c0f;
      --bg-pattern: none;
      --surface: #16161d;
      --surface-hover: #1e1e28;
      --surface-accent: #1a1a26;
      --border: #28283a;
      --border-accent: #3a3a55;
      --text: #eaeaf0;
      --text-secondary: #9898aa;
      --text-muted: #6a6a80;
      --accent: #c8a44e;
      --accent-glow: rgba(200, 164, 78, 0.15);
      --accent-text: #0c0c0f;
      --good: #4ade80;
      --good-bg: rgba(74, 222, 128, 0.1);
      --good-border: rgba(74, 222, 128, 0.25);
      --ok: #fbbf24;
      --ok-bg: rgba(251, 191, 36, 0.1);
      --ok-border: rgba(251, 191, 36, 0.25);
      --bad: #f87171;
      --bad-bg: rgba(248, 113, 113, 0.1);
      --bad-border: rgba(248, 113, 113, 0.25);
      --radius: 16px;
      --radius-sm: 8px;
      --shadow: 0 2px 16px rgba(0,0,0,0.3);
      --font-heading: 'Playfair Display', Georgia, serif;
      --font-body: 'Karla', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --nav-bg: rgba(12, 12, 15, 0.85);
      --card-stripe: none;
    }

    /* ── Theme: Tigre ──────────────────────────────── */
    [data-theme="tigre"] {
      --bg: #1a0e00;
      --bg-pattern: repeating-linear-gradient(
        135deg,
        transparent 0px,
        transparent 18px,
        rgba(0,0,0,0.35) 18px,
        rgba(0,0,0,0.35) 22px,
        transparent 22px,
        transparent 40px
      );
      --surface: #2a1800;
      --surface-hover: #3a2200;
      --surface-accent: #331c00;
      --border: #5a3500;
      --border-accent: #e67700;
      --text: #fff3e0;
      --text-secondary: #d4a060;
      --text-muted: #8a6030;
      --accent: #ff8c00;
      --accent-glow: rgba(255, 140, 0, 0.2);
      --accent-text: #1a0e00;
      --good: #66bb6a;
      --good-bg: rgba(102, 187, 106, 0.12);
      --good-border: rgba(102, 187, 106, 0.3);
      --ok: #ffa726;
      --ok-bg: rgba(255, 167, 38, 0.12);
      --ok-border: rgba(255, 167, 38, 0.3);
      --bad: #ef5350;
      --bad-bg: rgba(239, 83, 80, 0.12);
      --bad-border: rgba(239, 83, 80, 0.3);
      --radius: 12px;
      --radius-sm: 6px;
      --shadow: 0 4px 24px rgba(0,0,0,0.5);
      --nav-bg: rgba(26, 14, 0, 0.92);
      --card-stripe: repeating-linear-gradient(
        -45deg,
        transparent 0px,
        transparent 10px,
        rgba(255, 140, 0, 0.04) 10px,
        rgba(255, 140, 0, 0.04) 12px
      );
    }

    /* ── Body ──────────────────────────────────────── */
    body {
      font-family: var(--font-body);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100dvh;
      -webkit-font-smoothing: antialiased;
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background: var(--bg-pattern);
      pointer-events: none;
      z-index: 0;
    }

    /* ── Navigation ────────────────────────────────── */
    .navbar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--nav-bg);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      padding: 0 1.5rem;
    }
    .navbar-inner {
      max-width: 860px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 56px;
    }
    .nav-left {
      display: flex;
      align-items: center;
      gap: 2rem;
    }
    .logo {
      font-family: var(--font-heading);
      font-size: 1.35rem;
      font-weight: 700;
      color: var(--accent);
      text-decoration: none;
      letter-spacing: 0.02em;
    }
    .nav-links {
      display: flex;
      gap: 0.25rem;
    }
    .nav-links a {
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      padding: 0.4rem 0.75rem;
      border-radius: var(--radius-sm);
      transition: color 0.2s, background 0.2s;
      cursor: pointer;
    }
    .nav-links a:hover {
      color: var(--text);
      background: var(--surface-hover);
    }
    .nav-links a.active {
      color: var(--accent);
      background: var(--accent-glow);
    }

    /* ── Theme Selector ────────────────────────────── */
    .theme-selector {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 3px;
    }
    .theme-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.3rem;
      padding: 0.3rem 0.7rem;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: var(--text-muted);
      font-family: var(--font-body);
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      min-height: 32px;
    }
    .theme-btn:hover {
      color: var(--text-secondary);
    }
    .theme-btn.active {
      background: var(--accent);
      color: var(--accent-text);
      box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    }
    .theme-btn svg {
      width: 14px;
      height: 14px;
    }

    /* ── Container ─────────────────────────────────── */
    .container {
      position: relative;
      z-index: 1;
      max-width: 860px;
      margin: 0 auto;
      padding: 2.5rem 1.5rem;
    }

    /* ── Page Header ───────────────────────────────── */
    .page-title {
      font-family: var(--font-heading);
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin-bottom: 0.25rem;
    }
    .page-subtitle {
      color: var(--text-secondary);
      font-size: 0.95rem;
      margin-bottom: 2rem;
    }

    /* ── Recommendation Banner ─────────────────────── */
    .reco-banner {
      background: var(--good-bg);
      border: 1px solid var(--good-border);
      border-radius: var(--radius);
      padding: 1.25rem 1.5rem;
      margin-bottom: 2rem;
      position: relative;
      overflow: hidden;
    }
    .reco-banner::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      background: var(--good);
      border-radius: 4px 0 0 4px;
    }
    .reco-label {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--good);
      margin-bottom: 0.4rem;
    }
    .reco-main {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 0.2rem;
    }
    .reco-reason {
      font-size: 0.88rem;
      color: var(--text-secondary);
      line-height: 1.5;
    }

    /* ── Plat Cards ────────────────────────────────── */
    .plat-card {
      background: var(--surface);
      background-image: var(--card-stripe);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
      margin-bottom: 1.25rem;
      position: relative;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .plat-card:hover {
      border-color: var(--border-accent);
      box-shadow: var(--shadow);
    }
    .plat-card.recommended {
      border-color: var(--good-border);
    }
    .plat-card.recommended:hover {
      border-color: var(--good);
    }
    .reco-ribbon {
      position: absolute;
      top: 12px;
      right: -28px;
      background: var(--good);
      color: #000;
      font-size: 0.65rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      padding: 0.2rem 2rem;
      transform: rotate(45deg);
    }
    .plat-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .restaurant-name {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      font-size: 0.92rem;
      color: var(--text-secondary);
    }
    .icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      color: var(--accent);
    }
    .note {
      font-weight: 800;
      font-size: 1.2rem;
      font-variant-numeric: tabular-nums;
      padding: 0.2rem 0.6rem;
      border-radius: var(--radius-sm);
    }
    .note-max {
      font-weight: 500;
      font-size: 0.75rem;
      opacity: 0.6;
    }
    .note-good { color: var(--good); background: var(--good-bg); }
    .note-ok { color: var(--ok); background: var(--ok-bg); }
    .note-bad { color: var(--bad); background: var(--bad-bg); }
    .plat-name {
      font-family: var(--font-heading);
      font-size: 1.2rem;
      font-weight: 600;
      margin-bottom: 0.2rem;
      line-height: 1.4;
    }
    .badge-reco {
      display: inline-block;
      background: var(--good);
      color: #000;
      font-family: var(--font-body);
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      vertical-align: middle;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .plat-prix {
      color: var(--accent);
      font-weight: 700;
      font-size: 1rem;
      margin-bottom: 1rem;
    }

    /* ── Macro Grid ────────────────────────────────── */
    .macro-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .macro-item {
      text-align: center;
      padding: 0.6rem 0.25rem;
      background: var(--surface-accent);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
    }
    .macro-value {
      display: block;
      font-weight: 700;
      font-size: 1.05rem;
      font-variant-numeric: tabular-nums;
      color: var(--text);
    }
    .macro-label {
      display: block;
      font-size: 0.7rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 0.1rem;
    }

    .plat-justification {
      font-size: 0.88rem;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    /* ── Error Message ─────────────────────────────── */
    .error-msg {
      background: var(--bad-bg);
      border: 1px solid var(--bad-border);
      border-radius: var(--radius);
      padding: 2rem;
      color: var(--bad);
      text-align: center;
      font-size: 1rem;
    }

    /* ── History ───────────────────────────────────── */
    /* ── Calendar / Agenda ──────────────────────────── */
    .calendar-nav {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .calendar-nav-btn {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s;
    }
    .calendar-nav-btn:hover {
      background: var(--surface-hover);
      border-color: var(--border-accent);
      color: var(--text);
    }
    .calendar-nav-btn svg {
      width: 18px;
      height: 18px;
    }
    .calendar-month-label {
      font-family: var(--font-heading);
      font-size: 1.25rem;
      font-weight: 600;
      min-width: 200px;
      text-align: center;
    }
    .calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 4px;
      margin-bottom: 1.5rem;
    }
    .calendar-day-header {
      text-align: center;
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 0.5rem 0;
    }
    .calendar-cell {
      aspect-ratio: 1;
      border-radius: var(--radius-sm);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-size: 0.85rem;
      color: var(--text-muted);
      position: relative;
      min-height: 44px;
    }
    .calendar-cell.empty {
      background: transparent;
    }
    .calendar-cell.has-pdj {
      background: var(--surface);
      background-image: var(--card-stripe);
      border: 1px solid var(--border);
      cursor: pointer;
      transition: all 0.15s;
      color: var(--text);
      font-weight: 600;
    }
    .calendar-cell.has-pdj:hover {
      border-color: var(--accent);
      background: var(--surface-hover);
      transform: scale(1.04);
    }
    .calendar-cell.has-pdj:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .calendar-cell.has-pdj.active {
      border-color: var(--accent);
      box-shadow: 0 0 12px var(--accent-glow);
    }
    .calendar-cell.today {
      color: var(--accent);
    }
    .calendar-cell.today::after {
      content: '';
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--accent);
      position: absolute;
      bottom: 4px;
    }
    .calendar-cell .pdj-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      position: absolute;
      bottom: 6px;
    }
    .calendar-cell.no-pdj {
      color: var(--text-muted);
      opacity: 0.4;
    }
    .calendar-cell.weekend {
      opacity: 0.3;
    }

    /* ── Day detail panel ─────────────────────────── */
    .day-detail {
      background: var(--surface);
      background-image: var(--card-stripe);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.5rem;
      display: none;
      animation: slideDown 0.2s ease-out;
    }
    .day-detail.visible {
      display: block;
    }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .day-detail-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border);
    }
    .day-detail-date {
      font-family: var(--font-heading);
      font-weight: 600;
      font-size: 1.1rem;
    }
    .day-detail-reco {
      font-size: 0.82rem;
      color: var(--accent);
      font-weight: 500;
    }
    .day-detail-close {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      transition: color 0.15s;
    }
    .day-detail-close:hover {
      color: var(--text);
    }
    .day-detail-close svg {
      width: 18px;
      height: 18px;
    }

    .history-plat {
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
    }
    .history-plat:last-child { border-bottom: none; }
    .history-plat-info { flex: 1; min-width: 0; }
    .history-plat-restaurant {
      font-size: 0.8rem;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .history-plat-restaurant .icon {
      width: 14px;
      height: 14px;
    }
    .history-plat-name {
      font-size: 0.92rem;
      font-weight: 500;
    }
    .history-plat .note {
      font-size: 0.9rem;
      flex-shrink: 0;
    }

    /* ── Stats bar (history) ───────────────────────── */
    .stats-bar {
      display: flex;
      gap: 1.5rem;
      margin-bottom: 2rem;
      flex-wrap: wrap;
    }
    .stat-item {
      display: flex;
      flex-direction: column;
    }
    .stat-value {
      font-family: var(--font-heading);
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--accent);
      font-variant-numeric: tabular-nums;
    }
    .stat-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    /* ── Footer ────────────────────────────────────── */
    .footer {
      text-align: center;
      color: var(--text-muted);
      font-size: 0.78rem;
      padding: 2rem 1.5rem;
      border-top: 1px solid var(--border);
      margin-top: 2rem;
      position: relative;
      z-index: 1;
    }

    /* ── Responsive ────────────────────────────────── */
    @media (max-width: 640px) {
      .navbar { padding: 0 1rem; }
      .navbar-inner { height: 50px; }
      .nav-left { gap: 1rem; }
      .nav-links a { font-size: 0.82rem; padding: 0.3rem 0.5rem; }
      .container { padding: 1.5rem 1rem; }
      .page-title { font-size: 1.5rem; }
      .plat-card { padding: 1.2rem; }
      .macro-grid { grid-template-columns: repeat(2, 1fr); }
      .theme-btn span.label-text { display: none; }
      .theme-btn { padding: 0.3rem 0.5rem; }
      .calendar-cell { font-size: 0.75rem; min-height: 38px; }
      .calendar-month-label { font-size: 1.05rem; min-width: 160px; }
      .day-detail { padding: 1rem; }
      .stats-bar { gap: 1rem; }
      .mode-btn span.label-text { display: none; }
      .mode-btn { padding: 0.4rem 0.6rem; }
    }

    /* ── Mode Selector ─────────────────────────────── */
    .mode-selector {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 3px;
      margin-bottom: 1.5rem;
      width: fit-content;
    }
    .mode-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 0.4rem 1rem;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: var(--text-muted);
      font-family: var(--font-body);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      min-height: 36px;
    }
    .mode-btn:hover {
      color: var(--text-secondary);
    }
    .mode-btn.active {
      background: var(--accent);
      color: var(--accent-text);
      box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    }
    .mode-btn svg {
      width: 16px;
      height: 16px;
    }

    /* ── Reduced Motion ────────────────────────────── */
    @media (prefers-reduced-motion: reduce) {
      * { transition-duration: 0.01ms !important; }
      .day-detail { animation: none !important; }
    }
"""


def _theme_js() -> str:
    return """
    <script>
    (function() {
      var saved = localStorage.getItem('pdj-theme') || 'normal';
      document.documentElement.setAttribute('data-theme', saved);

      document.addEventListener('DOMContentLoaded', function() {
        var btns = document.querySelectorAll('.theme-btn');
        btns.forEach(function(btn) {
          if (btn.dataset.theme === saved) btn.classList.add('active');
          btn.addEventListener('click', function() {
            var theme = this.dataset.theme;
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('pdj-theme', theme);
            btns.forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
          });
        });
      });
    })();
    </script>
"""


def _mode_js() -> str:
    return """
    <script>
    (function() {
      var saved = localStorage.getItem('pdj-mode') || 'sportif';

      function applyMode(mode) {
        // Toggle mode-sportif / mode-goulaf elements
        document.querySelectorAll('.mode-sportif').forEach(function(el) {
          el.style.display = mode === 'sportif' ? '' : 'none';
        });
        document.querySelectorAll('.mode-goulaf').forEach(function(el) {
          el.style.display = mode === 'goulaf' ? '' : 'none';
        });
        // Update card recommended styling
        document.querySelectorAll('.plat-card').forEach(function(card) {
          card.classList.remove('recommended');
          if (mode === 'sportif' && card.classList.contains('recommended-sportif')) {
            card.classList.add('recommended');
          }
          if (mode === 'goulaf' && card.classList.contains('recommended-goulaf')) {
            card.classList.add('recommended');
          }
        });
        // Update mode buttons
        document.querySelectorAll('.mode-btn').forEach(function(b) {
          b.classList.remove('active');
          if (b.dataset.mode === mode) b.classList.add('active');
        });
        localStorage.setItem('pdj-mode', mode);
      }

      document.addEventListener('DOMContentLoaded', function() {
        applyMode(saved);
        document.querySelectorAll('.mode-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            applyMode(this.dataset.mode);
          });
        });
      });
    })();
    </script>
"""


def _history_js() -> str:
    return """
    <script>
    (function() {
      var currentActive = null;

      function showDay(dateStr) {
        // Hide previous
        if (currentActive) {
          currentActive.classList.remove('active');
        }
        document.querySelectorAll('.day-detail').forEach(function(d) {
          d.classList.remove('visible');
        });
        // Show new
        var detail = document.getElementById('detail-' + dateStr);
        var cell = document.querySelector('[data-date="' + dateStr + '"]');
        if (detail) {
          detail.classList.add('visible');
          currentActive = cell;
          if (cell) cell.classList.add('active');
          detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      function closeDay() {
        if (currentActive) {
          currentActive.classList.remove('active');
          currentActive = null;
        }
        document.querySelectorAll('.day-detail').forEach(function(d) {
          d.classList.remove('visible');
        });
      }

      function navigateMonth(dir) {
        var label = document.getElementById('month-label');
        var current = label.dataset.month; // "YYYY-MM"
        var parts = current.split('-');
        var y = parseInt(parts[0]);
        var m = parseInt(parts[1]) + dir;
        if (m < 1) { m = 12; y--; }
        if (m > 12) { m = 1; y++; }
        var key = y + '-' + String(m).padStart(2, '0');
        // Show/hide month grids
        document.querySelectorAll('.calendar-month').forEach(function(g) {
          g.style.display = g.dataset.month === key ? '' : 'none';
        });
        label.dataset.month = key;
        label.textContent = label.getAttribute('data-labels-' + key) || key;
        closeDay();
        // Update nav button states
        updateNavButtons(key);
      }

      function updateNavButtons(key) {
        var months = [];
        document.querySelectorAll('.calendar-month').forEach(function(g) {
          months.push(g.dataset.month);
        });
        months.sort();
        var prevBtn = document.getElementById('cal-prev');
        var nextBtn = document.getElementById('cal-next');
        if (prevBtn) prevBtn.style.opacity = key <= months[0] ? '0.3' : '1';
        if (prevBtn) prevBtn.style.pointerEvents = key <= months[0] ? 'none' : 'auto';
        if (nextBtn) nextBtn.style.opacity = key >= months[months.length - 1] ? '0.3' : '1';
        if (nextBtn) nextBtn.style.pointerEvents = key >= months[months.length - 1] ? 'none' : 'auto';
      }

      // Expose to onclick handlers
      window.showDay = showDay;
      window.closeDay = closeDay;
      window.navigateMonth = navigateMonth;

      document.addEventListener('DOMContentLoaded', function() {
        var label = document.getElementById('month-label');
        if (label) updateNavButtons(label.dataset.month);
      });
    })();
    </script>
"""


def _html_head(title: str, active_page: str = "index") -> str:
    nav_index = "active" if active_page == "index" else ""
    nav_history = "active" if active_page == "historique" else ""

    return f"""<!DOCTYPE html>
<html lang="fr" data-theme="normal">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Karla:wght@300;400;500;600;700&family=Playfair+Display:wght@400;600;700&display=swap" rel="stylesheet">
  <style>{_css()}</style>
  {_theme_js()}
  {_mode_js()}
</head>
<body>
  <nav class="navbar">
    <div class="navbar-inner">
      <div class="nav-left">
        <a href="index.html" class="logo">Plats du Jour</a>
        <div class="nav-links">
          <a href="index.html" class="{nav_index}">Aujourd'hui</a>
          <a href="historique.html" class="{nav_history}">Historique</a>
        </div>
      </div>
      <div class="theme-selector">
        <button class="theme-btn" data-theme="normal" aria-label="Thème normal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          <span class="label-text">Normal</span>
        </button>
        <button class="theme-btn" data-theme="tigre" aria-label="Thème tigre">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7c3-3 7-4 9-2s1 6-2 9"/><path d="M21 7c-3-3-7-4-9-2s-1 6 2 9"/><circle cx="12" cy="16" r="5"/><path d="M12 11v2"/><circle cx="10" cy="15" r="0.5" fill="currentColor"/><circle cx="14" cy="15" r="0.5" fill="currentColor"/></svg>
          <span class="label-text">Tigre</span>
        </button>
      </div>
    </div>
  </nav>
  <div class="container">
"""


HTML_FOOTER = """
  </div>
  <div class="footer">
    Plats du Jour &mdash; Mis à jour automatiquement chaque matin
  </div>
</body>
</html>"""


def generate_index(pdj: dict | None) -> str:
    """Génère la page d'accueil avec le PDJ du jour."""
    html = _html_head("Plats du Jour", "index")

    if not pdj or pdj.get("erreur"):
        err = pdj.get("erreur", "Aucune donnée disponible") if pdj else "Aucune donnée disponible"
        html += f'<h1 class="page-title">Plats du jour</h1>\n<div class="error-msg">{err}</div>\n'
        html += HTML_FOOTER
        return html

    if pdj.get("ferie"):
        date_label = _format_date(pdj["date"])
        html += f'<h1 class="page-title">Plats du jour</h1>\n<p class="page-subtitle">{date_label}</p>\n'
        html += f'<div class="error-msg">Jour férié — {pdj["ferie"]}<br>Les restaurants sont fermés aujourd\'hui.</div>\n'
        html += HTML_FOOTER
        return html

    date_label = _format_date(pdj["date"])
    html += f'<h1 class="page-title">Plats du jour</h1>\n<p class="page-subtitle">{date_label}</p>\n'

    # Mode selector
    html += """
    <div class="mode-selector">
      <button class="mode-btn active" data-mode="sportif" aria-label="Mode sportif">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
        <span class="label-text">Sportif</span>
      </button>
      <button class="mode-btn" data-mode="goulaf" aria-label="Mode goulaf">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z"/><path d="M12 6v4"/><path d="M10 8h4"/></svg>
        <span class="label-text">Goulaf</span>
      </button>
    </div>\n"""

    # Recommandation sportif
    reco = pdj.get("recommandation")
    if reco:
        icon = RESTAURANT_ICON.get(reco.get("restaurant", ""), DEFAULT_ICON)
        html += f"""
    <div class="reco-banner mode-sportif">
      <div class="reco-label">Recommandation du jour</div>
      <div class="reco-main">{icon} {reco.get('restaurant', '')} &mdash; {reco.get('plat', '')}</div>
      <p class="reco-reason">{reco.get('raison', '')}</p>
    </div>\n"""

    # Recommandation goulaf
    reco_g = pdj.get("recommandation_goulaf", reco)
    if reco_g:
        icon_g = RESTAURANT_ICON.get(reco_g.get("restaurant", ""), DEFAULT_ICON)
        html += f"""
    <div class="reco-banner mode-goulaf" style="display:none">
      <div class="reco-label">Recommandation du jour</div>
      <div class="reco-main">{icon_g} {reco_g.get('restaurant', '')} &mdash; {reco_g.get('plat', '')}</div>
      <p class="reco-reason">{reco_g.get('raison', '')}</p>
    </div>\n"""

    # Plats (triés par note décroissante)
    reco_name = reco.get("plat") if reco else None
    reco_g_name = reco_g.get("plat") if reco_g else None
    plats_sorted = sorted(pdj.get("plats", []), key=lambda p: p.get("note", 0), reverse=True)
    for plat in plats_sorted:
        is_reco = plat.get("plat") == reco_name
        is_reco_g = plat.get("plat") == reco_g_name
        html += _render_plat_card(plat, is_recommended=is_reco, is_recommended_goulaf=is_reco_g)

    html += HTML_FOOTER
    return html


def generate_historique(all_pdj: list[dict]) -> str:
    """Génère la page d'historique sous forme d'agenda calendrier."""
    import calendar as cal_mod
    from collections import defaultdict

    html = _html_head("Historique - Plats du Jour", "historique")
    html += '<h1 class="page-title">Historique</h1>\n'

    # Stats
    nb = len(all_pdj)
    total_notes = 0
    count_notes = 0
    for p in all_pdj:
        for plat in p.get("plats", []):
            n = plat.get("note")
            if isinstance(n, (int, float)):
                total_notes += n
                count_notes += 1
    avg_note = round(total_notes / count_notes, 1) if count_notes else 0

    html += f"""
    <div class="stats-bar">
      <div class="stat-item">
        <span class="stat-value">{nb}</span>
        <span class="stat-label">jour{"s" if nb > 1 else ""}</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{count_notes}</span>
        <span class="stat-label">plats notés</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{avg_note}</span>
        <span class="stat-label">note moyenne</span>
      </div>
    </div>\n"""

    # Group PDJ by month
    pdj_by_date: dict[str, dict] = {}
    months_set: set[tuple[int, int]] = set()
    for pdj in all_pdj:
        d = pdj.get("date", "")
        pdj_by_date[d] = pdj
        try:
            dt = datetime.strptime(d, "%Y-%m-%d")
            months_set.add((dt.year, dt.month))
        except ValueError:
            pass

    months_sorted = sorted(months_set, reverse=True)
    if not months_sorted:
        html += _history_js()
        html += HTML_FOOTER
        return html

    # Start with the most recent month
    latest_year, latest_month = months_sorted[0]
    latest_key = f"{latest_year}-{latest_month:02d}"

    # Build month label map
    month_labels = {}
    for y, m in months_sorted:
        key = f"{y}-{m:02d}"
        month_labels[key] = f"{MOIS[m - 1].capitalize()} {y}"

    today_str = datetime.now().strftime("%Y-%m-%d")
    day_names_short = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]

    # Navigation
    prev_svg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
    next_svg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>'

    # data-labels attributes for JS
    label_attrs = " ".join(
        f'data-labels-{y}-{m:02d}="{MOIS[m - 1].capitalize()} {y}"'
        for y, m in months_sorted
    )

    html += f"""
    <div class="calendar-nav">
      <button class="calendar-nav-btn" id="cal-prev" onclick="navigateMonth(-1)" aria-label="Mois précédent">{prev_svg}</button>
      <span class="calendar-month-label" id="month-label" data-month="{latest_key}" {label_attrs}>{month_labels[latest_key]}</span>
      <button class="calendar-nav-btn" id="cal-next" onclick="navigateMonth(1)" aria-label="Mois suivant">{next_svg}</button>
    </div>\n"""

    # Render each month grid
    for y, m in months_sorted:
        key = f"{y}-{m:02d}"
        display = "" if key == latest_key else "display:none"
        html += f'<div class="calendar-month" data-month="{key}" style="{display}">\n'

        # Day headers
        html += '  <div class="calendar-grid">\n'
        for dn in day_names_short:
            html += f'    <div class="calendar-day-header">{dn}</div>\n'

        # Calendar cells
        first_weekday, days_in_month = cal_mod.monthrange(y, m)
        # Monday=0, fill empty cells before first day
        for _ in range(first_weekday):
            html += '    <div class="calendar-cell empty"></div>\n'

        for day in range(1, days_in_month + 1):
            date_str = f"{y}-{m:02d}-{day:02d}"
            dt = datetime(y, m, day)
            is_weekend = dt.weekday() >= 5
            has_pdj = date_str in pdj_by_date
            is_today = date_str == today_str

            classes = ["calendar-cell"]
            if has_pdj:
                classes.append("has-pdj")
            elif is_weekend:
                classes.append("weekend")
            else:
                classes.append("no-pdj")
            if is_today:
                classes.append("today")

            cls_str = " ".join(classes)

            if has_pdj:
                html += f'    <div class="{cls_str}" data-date="{date_str}" role="button" tabindex="0" onclick="showDay(\'{date_str}\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){{event.preventDefault();showDay(\'{date_str}\')}}">{day}<span class="pdj-dot"></span></div>\n'
            else:
                html += f'    <div class="{cls_str}">{day}</div>\n'

        html += '  </div>\n'  # close calendar-grid

        # Day detail panels for this month
        for day in range(1, days_in_month + 1):
            date_str = f"{y}-{m:02d}-{day:02d}"
            if date_str not in pdj_by_date:
                continue
            pdj = pdj_by_date[date_str]
            date_label = _format_date(date_str)
            reco = pdj.get("recommandation")
            reco_text = ""
            if reco:
                reco_text = f"{reco.get('restaurant', '')} — {reco.get('plat', '')}"

            close_svg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

            html += f"""
    <div class="day-detail" id="detail-{date_str}">
      <div class="day-detail-header">
        <div>
          <div class="day-detail-date">{date_label}</div>
          <div class="day-detail-reco">{reco_text}</div>
        </div>
        <button class="day-detail-close" onclick="closeDay()" aria-label="Fermer">{close_svg}</button>
      </div>\n"""

            for plat in pdj.get("plats", []):
                icon = RESTAURANT_ICON.get(plat["restaurant"], DEFAULT_ICON)
                note = plat.get("note", "?")
                note_cls = _note_class(note) if isinstance(note, int) else "ok"
                note_g = plat.get("note_goulaf", note)
                note_g_cls = _note_class(note_g) if isinstance(note_g, int) else "ok"
                html += f"""
      <div class="history-plat">
        <div class="history-plat-info">
          <div class="history-plat-restaurant">{icon} {plat['restaurant']}</div>
          <div class="history-plat-name">{plat['plat']} — {plat.get('prix', '?')}</div>
        </div>
        <span class="note note-{note_cls} mode-sportif">{note}<span class="note-max">/10</span></span>
        <span class="note note-{note_g_cls} mode-goulaf" style="display:none">{note_g}<span class="note-max">/10</span></span>
      </div>\n"""

            html += "    </div>\n"

        html += '</div>\n'  # close calendar-month

    html += _history_js()
    html += HTML_FOOTER
    return html


def generate_site():
    """Point d'entrée : génère le site complet dans site/."""
    SITE_DIR.mkdir(parents=True, exist_ok=True)

    all_pdj = _load_all_pdj()
    current = all_pdj[0] if all_pdj else None

    # Pages HTML
    (SITE_DIR / "index.html").write_text(generate_index(current), encoding="utf-8")
    print(f"[site] index.html généré")

    (SITE_DIR / "historique.html").write_text(generate_historique(all_pdj), encoding="utf-8")
    print(f"[site] historique.html généré ({len(all_pdj)} jours)")

    # JSON bruts pour le bot Discord
    api_dir = SITE_DIR / "api"
    api_dir.mkdir(exist_ok=True)

    if PDJ_FILE.exists():
        shutil.copy2(PDJ_FILE, api_dir / "pdj.json")

    # Tous les PDJ en un seul fichier pour l'historique
    (api_dir / "historique.json").write_text(
        json.dumps(all_pdj, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[site] API JSON générée")


if __name__ == "__main__":
    generate_site()
