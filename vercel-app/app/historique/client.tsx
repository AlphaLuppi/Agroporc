"use client";

import { useEffect } from "react";

export function HistoriqueClient() {
  useEffect(() => {
    let currentActive: HTMLElement | null = null;

    function showDay(dateStr: string) {
      if (currentActive) currentActive.classList.remove("active");
      document
        .querySelectorAll<HTMLElement>(".day-detail")
        .forEach((d) => d.classList.remove("visible"));

      const detail = document.getElementById(`detail-${dateStr}`);
      const cell = document.querySelector<HTMLElement>(
        `[data-date="${dateStr}"]`
      );
      if (detail) {
        detail.classList.add("visible");
        currentActive = cell;
        if (cell) cell.classList.add("active");
        detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }

    function closeDay() {
      if (currentActive) {
        currentActive.classList.remove("active");
        currentActive = null;
      }
      document
        .querySelectorAll<HTMLElement>(".day-detail")
        .forEach((d) => d.classList.remove("visible"));
    }

    function navigateMonth(dir: number) {
      const label = document.getElementById("month-label");
      if (!label) return;
      const current = label.dataset.month!;
      const [yStr, mStr] = current.split("-");
      let y = parseInt(yStr);
      let m = parseInt(mStr) + dir;
      if (m < 1) { m = 12; y--; }
      if (m > 12) { m = 1; y++; }
      const key = `${y}-${String(m).padStart(2, "0")}`;

      document
        .querySelectorAll<HTMLElement>(".calendar-month")
        .forEach((g) => {
          g.style.display = g.dataset.month === key ? "" : "none";
        });
      label.dataset.month = key;
      label.textContent =
        label.getAttribute(`data-labels-${key}`) || key;
      closeDay();
      updateNavButtons(key);
    }

    function updateNavButtons(key: string) {
      const months: string[] = [];
      document
        .querySelectorAll<HTMLElement>(".calendar-month")
        .forEach((g) => {
          if (g.dataset.month) months.push(g.dataset.month);
        });
      months.sort();
      const prevBtn = document.getElementById("cal-prev") as HTMLElement;
      const nextBtn = document.getElementById("cal-next") as HTMLElement;
      if (prevBtn) {
        prevBtn.style.opacity = key <= months[0] ? "0.3" : "1";
        prevBtn.style.pointerEvents = key <= months[0] ? "none" : "auto";
      }
      if (nextBtn) {
        nextBtn.style.opacity =
          key >= months[months.length - 1] ? "0.3" : "1";
        nextBtn.style.pointerEvents =
          key >= months[months.length - 1] ? "none" : "auto";
      }
    }

    // Bind calendar cell clicks
    document
      .querySelectorAll<HTMLElement>(".calendar-cell.has-pdj")
      .forEach((cell) => {
        cell.onclick = () => showDay(cell.dataset.date!);
        cell.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            showDay(cell.dataset.date!);
          }
        };
      });

    // Bind close buttons
    document
      .querySelectorAll<HTMLElement>('[data-action="close-day"]')
      .forEach((btn) => {
        btn.onclick = closeDay;
      });

    // Bind nav buttons
    const prevBtn = document.getElementById("cal-prev");
    const nextBtn = document.getElementById("cal-next");
    if (prevBtn) prevBtn.onclick = () => navigateMonth(-1);
    if (nextBtn) nextBtn.onclick = () => navigateMonth(1);

    // Initial state
    const label = document.getElementById("month-label");
    if (label) updateNavButtons(label.dataset.month!);
  }, []);

  return null;
}
