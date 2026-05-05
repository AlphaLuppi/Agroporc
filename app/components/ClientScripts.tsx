"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// --- Cart types & helpers ---

type CartItem = { restaurant: string; plat: string; prix: string; qty: number };

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getCart(): CartItem[] {
  try {
    return JSON.parse(localStorage.getItem("pdj-cart") || "[]");
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  localStorage.setItem("pdj-cart", JSON.stringify(items));
  updateCartBadge();
  renderCartItems();
}

function addToCart(restaurant: string, plat: string, prix: string) {
  const cart = getCart();
  const existing = cart.find(
    (i) => i.restaurant === restaurant && i.plat === plat
  );
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ restaurant, plat, prix, qty: 1 });
  }
  saveCart(cart);
}

function updateCartBadge() {
  const badge = document.getElementById("cart-badge");
  if (!badge) return;
  const total = getCart().reduce((s, i) => s + i.qty, 0);
  badge.textContent = String(total);
  badge.style.display = total > 0 ? "flex" : "none";
}

const ORDER_URLS: Record<string, string> = {
  "Le Bistrot Trèfle":
    "https://bistrot-trefle.com/commander-emporter-livraison-gratuite-restaurant-bistrot-trefle-avignon-agroparc/",
  "La Pause Gourmande": "https://lapausegourmandeagroparc.foxorders.com",
  "Le Truck Muche": "https://www.facebook.com/letruckmuche/",
};

function renderCartItems() {
  const itemsEl = document.getElementById("cart-items");
  const footerEl = document.getElementById("cart-footer");
  if (!itemsEl || !footerEl) return;

  const cart = getCart();

  if (cart.length === 0) {
    itemsEl.innerHTML = `<div style="text-align:center;padding:2rem 0;color:var(--text-muted)"><div style="font-size:2rem;margin-bottom:0.5rem">🛒</div><p style="font-size:0.875rem">Votre panier est vide</p></div>`;
    footerEl.innerHTML = "";
    return;
  }

  const byRestaurant: Record<string, CartItem[]> = {};
  for (const item of cart) {
    (byRestaurant[item.restaurant] ??= []).push(item);
  }

  let html = "";
  for (const [restaurant, items] of Object.entries(byRestaurant)) {
    html += `<div style="margin-bottom:1.25rem"><div style="font-weight:600;font-size:0.75rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem">${escHtml(restaurant)}</div>`;

    for (const item of items) {
      const cartIdx = cart.findIndex(
        (i) => i.restaurant === item.restaurant && i.plat === item.plat
      );
      html += `<div style="display:flex;align-items:center;gap:0.75rem;padding:0.625rem 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-size:0.875rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHtml(item.plat)}">${escHtml(item.plat)}</div>
          <div style="font-size:0.75rem;color:var(--accent);font-weight:600">${escHtml(item.prix)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:0.4rem;flex-shrink:0">
          <button class="cart-qty-btn" data-index="${cartIdx}" data-delta="-1" style="width:1.75rem;height:1.75rem;border-radius:50%;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center">−</button>
          <span style="min-width:1.5rem;text-align:center;font-size:0.875rem;font-weight:600">${item.qty}</span>
          <button class="cart-qty-btn" data-index="${cartIdx}" data-delta="1" style="width:1.75rem;height:1.75rem;border-radius:50%;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center">+</button>
        </div>
      </div>`;
    }

    const orderUrl = ORDER_URLS[restaurant];
    if (orderUrl) {
      html += `<div style="margin-top:0.625rem;text-align:right"><a href="${escHtml(orderUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:0.375rem;font-size:0.75rem;font-weight:600;padding:0.375rem 0.875rem;border-radius:var(--radius);border:1px solid var(--accent);color:var(--accent);background:var(--accent-glow);text-decoration:none">Commander →</a></div>`;
    }

    html += "</div>";
  }

  itemsEl.innerHTML = html;

  document.querySelectorAll<HTMLButtonElement>(".cart-qty-btn").forEach((btn) => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.index ?? "0");
      const delta = parseInt(btn.dataset.delta ?? "0");
      const c = getCart();
      if (c[idx]) {
        c[idx].qty += delta;
        if (c[idx].qty <= 0) c.splice(idx, 1);
        saveCart(c);
      }
    };
  });

  const grandTotal = cart.reduce((s, i) => {
    const price = parseFloat(
      i.prix.replace(/[^0-9,.]/g, "").replace(",", ".")
    );
    return s + (isNaN(price) ? 0 : price * i.qty);
  }, 0);

  footerEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
      <span style="font-size:0.875rem;color:var(--text-secondary)">Total estimé</span>
      <span style="font-size:1rem;font-weight:700">${grandTotal > 0 ? grandTotal.toFixed(2).replace(".", ",") + " €" : "—"}</span>
    </div>
    <div style="display:flex;gap:0.5rem">
      <button id="cart-tts-btn" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:0.4rem;font-size:0.8rem;font-weight:600;padding:0.625rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface);color:var(--text-secondary);cursor:pointer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        Lire à voix haute
      </button>
      <button id="cart-clear-btn" style="display:inline-flex;align-items:center;justify-content:center;padding:0.625rem 0.875rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface);color:var(--text-muted);font-size:0.8rem;font-weight:600;cursor:pointer">
        Vider
      </button>
    </div>
  `;

  const ttsBtn = document.getElementById("cart-tts-btn");
  if (ttsBtn) ttsBtn.onclick = speakCart;
  const clearBtn = document.getElementById("cart-clear-btn");
  if (clearBtn) clearBtn.onclick = () => saveCart([]);
}

function speakCart() {
  if (!("speechSynthesis" in window)) {
    alert("La synthèse vocale n'est pas supportée par votre navigateur.");
    return;
  }
  const cart = getCart();
  if (cart.length === 0) {
    speakText("Votre panier est vide.");
    return;
  }
  const byRestaurant: Record<string, CartItem[]> = {};
  for (const i of cart) (byRestaurant[i.restaurant] ??= []).push(i);

  let text = "Votre commande. ";
  for (const [restaurant, items] of Object.entries(byRestaurant)) {
    text += `${restaurant} : `;
    for (const item of items) {
      if (item.qty > 1) text += `${item.qty} fois `;
      text += `${item.plat}, ${item.prix}. `;
    }
  }
  const total = cart.reduce((s, i) => {
    const p = parseFloat(i.prix.replace(/[^0-9,.]/g, "").replace(",", "."));
    return s + (isNaN(p) ? 0 : p * i.qty);
  }, 0);
  if (total > 0)
    text += `Total estimé : ${total.toFixed(2).replace(".", ",")} euros.`;

  speakText(text);
}

function speakText(text: string) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

// Prevents duplicate event listener across re-renders
let cartListenerAdded = false;

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
          const dot = t.querySelector<HTMLElement>(".today-dot");
          if (dot) dot.style.background = "var(--accent)";
        });
        tab.classList.add("active");
        tab.style.background = "var(--accent)";
        tab.style.color = "var(--accent-text)";
        tab.style.boxShadow = "0 1px 4px rgba(0,0,0,0.2)";
        const activeDot = tab.querySelector<HTMLElement>(".today-dot");
        if (activeDot) activeDot.style.background = "var(--accent-text)";
        document
          .querySelectorAll<HTMLElement>("[data-day-panel]")
          .forEach((panel) => {
            panel.style.display = panel.dataset.dayPanel === idx ? "" : "none";
          });
        const currentMode = localStorage.getItem("pdj-mode") || "sportif";
        applyMode(currentMode);
      };
    });

    // Cart setup
    updateCartBadge();
    renderCartItems();

    const toggle = document.getElementById("cart-toggle");
    const overlay = document.getElementById("cart-overlay");
    const closeBtn = document.getElementById("cart-close");

    const openCart = () => {
      if (overlay) {
        overlay.style.display = "";
        renderCartItems();
      }
    };
    const closeCart = () => {
      if (overlay) overlay.style.display = "none";
    };

    if (toggle) toggle.onclick = openCart;
    if (closeBtn) closeBtn.onclick = closeCart;
    if (overlay) {
      overlay.onclick = (e) => {
        if (e.target === overlay) closeCart();
      };
    }

    // Event delegation for add-to-cart buttons (set once only)
    if (!cartListenerAdded) {
      cartListenerAdded = true;
      document.body.addEventListener("click", (e) => {
        const btn = (e.target as Element).closest<HTMLButtonElement>(
          ".add-to-cart"
        );
        if (!btn) return;

        const restaurant = btn.dataset.restaurant ?? "";
        const plat = btn.dataset.plat ?? "";
        const prix = btn.dataset.prix ?? "";

        addToCart(restaurant, plat, prix);

        const originalHtml = btn.innerHTML;
        const savedBg = btn.style.background;
        const savedBorder = btn.style.borderColor;
        const savedColor = btn.style.color;

        btn.textContent = "Ajouté !";
        btn.style.background = "var(--good-bg)";
        btn.style.borderColor = "var(--good-border)";
        btn.style.color = "var(--good)";

        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.style.background = savedBg;
          btn.style.borderColor = savedBorder;
          btn.style.color = savedColor;
        }, 1500);
      });
    }
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
    } else if (
      mode === "goulaf" &&
      card.classList.contains("recommended-goulaf")
    ) {
      card.classList.add("recommended");
      card.style.borderColor = "var(--good-border)";
    } else {
      card.style.borderColor = "";
    }
  });

  // Sort plat cards by note (best first) within each day panel
  document
    .querySelectorAll<HTMLElement>("[data-day-panel]")
    .forEach((panel) => {
      const cards = Array.from(
        panel.querySelectorAll<HTMLElement>(".plat-card")
      );
      if (cards.length < 2) return;
      const noteSelector =
        mode === "sportif" ? ".note.mode-sportif" : ".note.mode-goulaf";
      cards.sort((a, b) => {
        const noteA = parseFloat(
          a.querySelector<HTMLElement>(noteSelector)?.dataset.note || "0"
        );
        const noteB = parseFloat(
          b.querySelector<HTMLElement>(noteSelector)?.dataset.note || "0"
        );
        return noteB - noteA;
      });
      cards.forEach((card) => panel.appendChild(card));
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
