import type { Metadata } from "next";
import "./globals.css";
import { ClientScripts } from "./components/ClientScripts";

export const metadata: Metadata = {
  title: "Plats du Jour",
  description: "Les plats du jour évalués chaque matin",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" data-theme="normal" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Karla:wght@300;400;500;600;700&family=Playfair+Display:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('pdj-theme')||'normal';document.documentElement.setAttribute('data-theme',t)})()`,
          }}
        />
      </head>
      <body>
        <nav className="sticky top-0 z-50 border-b border-[var(--border)] px-3 sm:px-6 backdrop-blur-xl" style={{ background: "var(--nav-bg)" }}>
          <div className="mx-auto flex h-14 max-w-[860px] items-center justify-between">
            <div className="nav-left flex items-center gap-3 sm:gap-8">
              <a href="/" className="flex items-center gap-2 text-lg sm:text-xl font-bold text-[var(--accent)] no-underline tracking-wide shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
                <img src="/logo.jpg" alt="Logo Plats du Jour" className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover" />
                <span className="hidden sm:inline">Plats du Jour</span>
                <span className="sm:hidden">PDJ</span>
              </a>
              <div className="nav-links flex gap-1" id="nav-links">
                <a href="/" className="text-[var(--text-secondary)] no-underline text-xs sm:text-sm font-medium px-2 sm:px-3 py-1.5 rounded-lg transition-colors hover:text-[var(--text)] hover:bg-[var(--surface-hover)]">
                  Aujourd&apos;hui
                </a>
<a href="/idees" className="text-[var(--text-secondary)] no-underline text-xs sm:text-sm font-medium px-2 sm:px-3 py-1.5 rounded-lg transition-colors hover:text-[var(--text)] hover:bg-[var(--surface-hover)]">
                  Idées
                </a>
                <a href="/ia" className="text-[var(--text-secondary)] no-underline text-xs sm:text-sm font-medium px-2 sm:px-3 py-1.5 rounded-lg transition-colors hover:text-[var(--text)] hover:bg-[var(--surface-hover)]">
                  IA
                </a>
              </div>
            </div>
            <div className="theme-selector flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] rounded-full p-[3px]">
              <button
                className="theme-btn flex items-center justify-center gap-1.5 px-3 py-1.5 border-none rounded-full bg-transparent text-[var(--text-muted)] text-xs font-semibold cursor-pointer transition-all min-h-8"
                data-theme="normal"
                aria-label="Thème normal"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <circle cx="12" cy="12" r="5" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
                <span className="label-text hidden sm:inline">Normal</span>
              </button>
              <button
                className="theme-btn flex items-center justify-center gap-1.5 px-3 py-1.5 border-none rounded-full bg-transparent text-[var(--text-muted)] text-xs font-semibold cursor-pointer transition-all min-h-8"
                data-theme="tigre"
                aria-label="Thème tigre"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3.5 h-3.5">
                  <path d="M3 7c3-3 7-4 9-2s1 6-2 9" />
                  <path d="M21 7c-3-3-7-4-9-2s-1 6 2 9" />
                  <circle cx="12" cy="16" r="5" />
                  <path d="M12 11v2" />
                  <circle cx="10" cy="15" r="0.5" fill="currentColor" />
                  <circle cx="14" cy="15" r="0.5" fill="currentColor" />
                </svg>
                <span className="label-text hidden sm:inline">Tigre</span>
              </button>
              <button
                className="theme-btn flex items-center justify-center gap-1.5 px-3 py-1.5 border-none rounded-full bg-transparent text-[var(--text-muted)] text-xs font-semibold cursor-pointer transition-all min-h-8"
                data-theme="terrasse"
                aria-label="Thème terrasse"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
                  <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
                  <line x1="6" y1="2" x2="6" y2="4" />
                  <line x1="10" y1="2" x2="10" y2="4" />
                  <line x1="14" y1="2" x2="14" y2="4" />
                </svg>
                <span className="label-text hidden sm:inline">Terrasse</span>
              </button>
            </div>
          </div>
        </nav>
        <div className="relative z-[2] mx-auto max-w-[860px] px-3 py-5 sm:px-6 sm:py-10">{children}</div>
        <div className="relative z-[1] text-center text-[var(--text-muted)] text-xs py-8 px-4 border-t border-[var(--border)] mt-8">
          Plats du Jour &mdash; Mis à jour automatiquement chaque matin
        </div>
        <ClientScripts />
      </body>
    </html>
  );
}
