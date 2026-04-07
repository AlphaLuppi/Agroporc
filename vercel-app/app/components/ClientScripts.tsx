"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function ClientScripts() {
  const pathname = usePathname();

  useEffect(() => {
    // Theme switching
    const saved = localStorage.getItem("pdj-theme") || "normal";
    document.documentElement.setAttribute("data-theme", saved);

    const themeBtns = document.querySelectorAll<HTMLButtonElement>(".theme-btn");
    themeBtns.forEach((btn) => {
      if (btn.dataset.theme === saved) {
        btn.classList.add("active");
        btn.style.background = "var(--accent)";
        btn.style.color = "var(--accent-text)";
        btn.style.boxShadow = "0 1px 4px rgba(0,0,0,0.2)";
      }
      btn.onclick = () => {
        const theme = btn.dataset.theme!;
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("pdj-theme", theme);
        themeBtns.forEach((b) => {
          b.classList.remove("active");
          b.style.background = "transparent";
          b.style.color = "var(--text-muted)";
          b.style.boxShadow = "none";
        });
        btn.classList.add("active");
        btn.style.background = "var(--accent)";
        btn.style.color = "var(--accent-text)";
        btn.style.boxShadow = "0 1px 4px rgba(0,0,0,0.2)";
      };
    });

    // Active nav link
    const links = document.querySelectorAll<HTMLAnchorElement>("#nav-links a");
    links.forEach((a) => {
      a.classList.remove("active");
      a.style.color = "";
      a.style.background = "";
      const href = a.getAttribute("href") || "";
      if (
        (href === "/" && pathname === "/") ||
        (href !== "/" && pathname.startsWith(href))
      ) {
        a.classList.add("active");
        a.style.color = "var(--accent)";
        a.style.background = "var(--accent-glow)";
      }
    });

    // Mode switching
    const savedMode = localStorage.getItem("pdj-mode") || "sportif";
    applyMode(savedMode);

    const modeBtns = document.querySelectorAll<HTMLButtonElement>(".mode-btn");
    modeBtns.forEach((btn) => {
      btn.onclick = () => applyMode(btn.dataset.mode!);
    });

    // Day tab switching
    const dayTabs = document.querySelectorAll<HTMLButtonElement>(".day-tab");
    dayTabs.forEach((tab) => {
      tab.onclick = () => {
        const idx = tab.dataset.dayIndex;
        dayTabs.forEach((t) => {
          t.classList.remove("active");
          t.style.background = "transparent";
          t.style.color = "var(--text-muted)";
          t.style.boxShadow = "none";
        });
        tab.classList.add("active");
        tab.style.background = "var(--accent)";
        tab.style.color = "var(--accent-text)";
        tab.style.boxShadow = "0 1px 4px rgba(0,0,0,0.2)";
        document.querySelectorAll<HTMLElement>("[data-day-panel]").forEach((panel) => {
          panel.style.display = panel.dataset.dayPanel === idx ? "" : "none";
        });
        const currentMode = localStorage.getItem("pdj-mode") || "sportif";
        applyMode(currentMode);
      };
    });
  }, [pathname]);

  return null;
}

function applyMode(mode: string) {
  document.querySelectorAll<HTMLElement>(".mode-sportif").forEach((el) => {
    el.style.display = mode === "sportif" ? "" : "none";
  });
  document.querySelectorAll<HTMLElement>(".mode-goulaf").forEach((el) => {
    el.style.display = mode === "goulaf" ? "" : "none";
  });
  document.querySelectorAll<HTMLElement>(".plat-card").forEach((card) => {
    card.classList.remove("recommended");
    if (mode === "sportif" && card.classList.contains("recommended-sportif")) {
      card.classList.add("recommended");
      card.style.borderColor = "var(--good-border)";
    } else if (mode === "goulaf" && card.classList.contains("recommended-goulaf")) {
      card.classList.add("recommended");
      card.style.borderColor = "var(--good-border)";
    } else {
      card.style.borderColor = "";
    }
  });
  document.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((b) => {
    b.classList.remove("active");
    b.style.background = "transparent";
    b.style.color = "var(--text-muted)";
    b.style.boxShadow = "none";
    if (b.dataset.mode === mode) {
      b.classList.add("active");
      b.style.background = "var(--accent)";
      b.style.color = "var(--accent-text)";
      b.style.boxShadow = "0 1px 4px rgba(0,0,0,0.2)";
    }
  });
  localStorage.setItem("pdj-mode", mode);
}
