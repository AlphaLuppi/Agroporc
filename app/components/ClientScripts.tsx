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
    const applyThemeActive = (theme: string) => {
      themeBtns.forEach((b) => {
        const isActive = b.dataset.theme === theme;
        b.classList.toggle("active", isActive);
        b.style.background = isActive ? "var(--accent)" : "transparent";
        b.style.color = isActive ? "var(--accent-text)" : "var(--text-muted)";
        b.style.boxShadow = isActive ? "0 1px 4px rgba(0,0,0,0.2)" : "none";
      });
    };
    applyThemeActive(saved);
    themeBtns.forEach((btn) => {
      btn.onclick = () => {
        const theme = btn.dataset.theme!;
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("pdj-theme", theme);
        applyThemeActive(theme);
      };
    });

    // Active nav link (desktop + mobile)
    const links = document.querySelectorAll<HTMLAnchorElement>("[data-nav-links] a");
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

    // Mobile burger menu
    const cleanupMobileMenu = initMobileMenu();

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
        document.querySelectorAll<HTMLElement>("[data-day-panel]").forEach((panel) => {
          panel.style.display = panel.dataset.dayPanel === idx ? "" : "none";
        });
        const currentMode = localStorage.getItem("pdj-mode") || "sportif";
        applyMode(currentMode);
      };
    });

    // ── Cart / Panier ────────────────────────────────────────────────────────
    initCart();

    return () => {
      cleanupMobileMenu?.();
    };
  }, [pathname]);

  return null;
}

// ── Mobile burger menu ───────────────────────────────────────────────────────

function initMobileMenu(): (() => void) | undefined {
  const btn = document.getElementById("mobile-menu-btn");
  const menu = document.getElementById("mobile-menu");
  const burgerIcon = document.getElementById("burger-icon");
  const closeIcon = document.getElementById("burger-close-icon");
  if (!btn || !menu) return;

  const setOpen = (open: boolean) => {
    menu.classList.toggle("hidden", !open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    burgerIcon?.classList.toggle("hidden", open);
    closeIcon?.classList.toggle("hidden", !open);
  };

  setOpen(false);

  btn.onclick = (e) => {
    e.stopPropagation();
    setOpen(menu.classList.contains("hidden"));
  };

  menu.querySelectorAll<HTMLAnchorElement>("a").forEach((a) => {
    a.onclick = () => setOpen(false);
  });

  const onDocClick = (e: MouseEvent) => {
    const target = e.target as Node;
    if (!menu.contains(target) && !btn.contains(target)) {
      setOpen(false);
    }
  };
  document.addEventListener("click", onDocClick);

  return () => {
    document.removeEventListener("click", onDocClick);
  };
}

// ── Types cart ───────────────────────────────────────────────────────────────

interface CartItem {
  restaurant: string;
  plat: string;
  prix: string;
  quantity: number;
}

// ── Helpers persistance ──────────────────────────────────────────────────────

function loadCart(): CartItem[] {
  try {
    return JSON.parse(localStorage.getItem("pdj-cart") || "[]");
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  localStorage.setItem("pdj-cart", JSON.stringify(items));
}

function isAdmin(): boolean {
  return document.cookie.split(";").some((c) => c.trim() === "pdj-admin=1");
}

// ── Rendu du drawer ──────────────────────────────────────────────────────────

function renderCart() {
  const items = loadCart();
  const badge = document.getElementById("cart-badge");
  const body = document.getElementById("cart-body");
  const footer = document.getElementById("cart-footer");
  if (!body || !footer) return;

  const total = items.reduce((s, i) => s + parsePrix(i.prix) * i.quantity, 0);
  const count = items.reduce((s, i) => s + i.quantity, 0);

  if (badge) {
    badge.style.display = count > 0 ? "block" : "none";
    badge.textContent = String(count);
  }

  if (items.length === 0) {
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:var(--text-muted);gap:0.75rem;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem;opacity:0.4;">
          <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        </svg>
        <span style="font-size:0.875rem;">Votre panier est vide</span>
        <span style="font-size:0.75rem;text-align:center;color:var(--text-muted);">Ajoutez des plats depuis la page principale</span>
      </div>`;
    footer.innerHTML = "";
    return;
  }

  // Grouper par restaurant
  const byRestaurant: Record<string, CartItem[]> = {};
  items.forEach((item) => {
    if (!byRestaurant[item.restaurant]) byRestaurant[item.restaurant] = [];
    byRestaurant[item.restaurant].push(item);
  });

  const admin = isAdmin();

  body.innerHTML = Object.entries(byRestaurant)
    .map(([restaurant, restItems]) => {
      const restTotal = restItems.reduce(
        (s, i) => s + parsePrix(i.prix) * i.quantity,
        0
      );
      const itemsHtml = restItems
        .map(
          (item, idx) => `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.5rem 0;border-bottom:1px solid var(--border);">
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.875rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.plat}</div>
              <div style="font-size:0.75rem;color:var(--accent);">${item.prix}</div>
            </div>
            <div style="display:flex;align-items:center;gap:0.25rem;flex-shrink:0;">
              <button class="qty-btn" data-restaurant="${encodeURIComponent(restaurant)}" data-plat="${encodeURIComponent(item.plat)}" data-delta="-1"
                style="width:1.5rem;height:1.5rem;border-radius:50%;border:1px solid var(--border);background:var(--surface-hover);color:var(--text);cursor:pointer;font-size:0.875rem;display:flex;align-items:center;justify-content:center;">−</button>
              <span style="min-width:1.25rem;text-align:center;font-size:0.875rem;font-weight:600;">${item.quantity}</span>
              <button class="qty-btn" data-restaurant="${encodeURIComponent(restaurant)}" data-plat="${encodeURIComponent(item.plat)}" data-delta="1"
                style="width:1.5rem;height:1.5rem;border-radius:50%;border:1px solid var(--border);background:var(--surface-hover);color:var(--text);cursor:pointer;font-size:0.875rem;display:flex;align-items:center;justify-content:center;">+</button>
            </div>
          </div>`
        )
        .join("");

      const commanderBtn = admin
        ? `<button class="commander-btn" data-restaurant="${encodeURIComponent(restaurant)}"
            style="width:100%;margin-top:0.75rem;padding:0.5rem 1rem;background:var(--accent);border:none;border-radius:var(--radius);color:var(--accent-text);font-weight:600;font-size:0.85rem;cursor:pointer;transition:opacity 0.15s;">
            Commander via ${getPlatform(restaurant)} →
          </button>`
        : `<button class="commander-login-btn"
            style="width:100%;margin-top:0.75rem;padding:0.5rem 1rem;background:var(--surface-hover);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-secondary);font-weight:600;font-size:0.85rem;cursor:pointer;">
            🔒 Connexion requise pour commander
          </button>`;

      return `
        <div style="margin-bottom:1.25rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
            <span style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);">${restaurant}</span>
            <span style="font-size:0.8rem;font-weight:600;color:var(--accent);">${restTotal.toFixed(2)} €</span>
          </div>
          ${itemsHtml}
          ${commanderBtn}
        </div>`;
    })
    .join("");

  footer.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
      <span style="font-size:0.9rem;font-weight:700;">Total estimé</span>
      <span style="font-size:1rem;font-weight:700;color:var(--accent);">${total.toFixed(2)} €</span>
    </div>
    <button id="clear-cart-btn"
      style="width:100%;padding:0.4rem;background:none;border:1px solid var(--border);border-radius:var(--radius);color:var(--text-muted);font-size:0.8rem;cursor:pointer;">
      Vider le panier
    </button>`;

  // Bind events
  body.querySelectorAll<HTMLButtonElement>(".qty-btn").forEach((btn) => {
    btn.onclick = () => {
      const restaurant = decodeURIComponent(btn.dataset.restaurant || "");
      const plat = decodeURIComponent(btn.dataset.plat || "");
      const delta = parseInt(btn.dataset.delta || "0");
      updateQty(restaurant, plat, delta);
    };
  });

  body.querySelectorAll<HTMLButtonElement>(".commander-btn").forEach((btn) => {
    btn.onclick = () => {
      const restaurant = decodeURIComponent(btn.dataset.restaurant || "");
      handleCommander(restaurant);
    };
  });

  body.querySelectorAll<HTMLButtonElement>(".commander-login-btn").forEach((btn) => {
    btn.onclick = () => openLoginModal();
  });

  const clearBtn = document.getElementById("clear-cart-btn");
  if (clearBtn) {
    clearBtn.onclick = () => {
      saveCart([]);
      renderCart();
    };
  }
}

function parsePrix(prix: string): number {
  const m = prix.replace(",", ".").match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

function getPlatform(restaurant: string): string {
  if (restaurant === "Le Bistrot Trèfle") return "Obypay";
  if (restaurant === "La Pause Gourmande") return "Foxorders";
  if (restaurant === "Le Truck Muche") return "téléphone";
  return "la plateforme";
}

function updateQty(restaurant: string, plat: string, delta: number) {
  const items = loadCart();
  const idx = items.findIndex(
    (i) => i.restaurant === restaurant && i.plat === plat
  );
  if (idx === -1) return;
  items[idx].quantity += delta;
  if (items[idx].quantity <= 0) items.splice(idx, 1);
  saveCart(items);
  renderCart();
}

// ── Commander ────────────────────────────────────────────────────────────────

async function handleCommander(restaurant: string) {
  const items = loadCart().filter((i) => i.restaurant === restaurant);
  if (!items.length) return;

  if (restaurant === "Le Truck Muche") {
    handleTruckMuche(items);
    return;
  }

  const btn = document.querySelector<HTMLButtonElement>(
    `.commander-btn[data-restaurant="${encodeURIComponent(restaurant)}"]`
  );
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Commande en cours…";
  }

  try {
    const res = await fetch("/api/commander", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurant, items }),
    });
    const data = await res.json();
    showOrderResult(data, restaurant);
  } catch (e) {
    showOrderResult(
      { ok: false, error: String(e) },
      restaurant
    );
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = `Commander via ${getPlatform(restaurant)} →`;
    }
  }
}

function handleTruckMuche(items: CartItem[]) {
  const lines = items.map(
    (i) => `${i.quantity > 1 ? i.quantity + " fois " : ""}${i.plat}`
  );
  const ttsText = `Bonjour, je voudrais commander : ${lines.join(", ")}. Merci.`;

  fetch("/api/commander", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restaurant: "Le Truck Muche", items }),
  })
    .then((r) => r.json())
    .then((data) => {
      const phone = data.phone || "";
      const method = data.method || "tts_browser";

      if (method === "twilio") {
        showOrderResult(data, "Le Truck Muche");
        return;
      }

      // Fallback TTS navigateur
      const content = document.getElementById("order-result-content");
      if (content) {
        content.innerHTML = `
          <h3 style="font-family:var(--font-heading);font-weight:700;margin-bottom:0.75rem;font-size:1rem;">
            📞 Appeler Le Truck Muche
          </h3>
          <div style="background:var(--surface-hover);border-radius:var(--radius);padding:0.875rem;margin-bottom:1rem;font-size:0.85rem;line-height:1.6;color:var(--text-secondary);">
            ${ttsText}
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button id="tts-speak-btn"
              style="flex:1;min-width:120px;padding:0.5rem 0.75rem;background:var(--accent);border:none;border-radius:var(--radius);color:var(--accent-text);font-weight:600;font-size:0.8rem;cursor:pointer;">
              🔊 Lire à voix haute
            </button>
            ${phone ? `<a href="tel:${phone}"
              style="flex:1;min-width:120px;padding:0.5rem 0.75rem;background:var(--good-bg);border:1px solid var(--good-border);border-radius:var(--radius);color:var(--good);font-weight:600;font-size:0.8rem;text-align:center;text-decoration:none;">
              📱 Appeler ${phone}
            </a>` : `<div style="font-size:0.75rem;color:var(--text-muted);">Numéro non configuré (TRUCK_MUCHE_PHONE)</div>`}
          </div>`;
        const speakBtn = document.getElementById("tts-speak-btn");
        if (speakBtn) {
          speakBtn.onclick = () => {
            if (!window.speechSynthesis) return;
            window.speechSynthesis.cancel();
            const utt = new SpeechSynthesisUtterance(ttsText);
            utt.lang = "fr-FR";
            utt.rate = 0.9;
            window.speechSynthesis.speak(utt);
          };
        }
      }
      const modal = document.getElementById("order-result-modal");
      if (modal) {
        modal.style.display = "flex";
      }
    })
    .catch((e) => showOrderResult({ ok: false, error: String(e) }, "Le Truck Muche"));
}

function showOrderResult(data: Record<string, unknown>, restaurant: string) {
  const content = document.getElementById("order-result-content");
  const modal = document.getElementById("order-result-modal");
  if (!content || !modal) return;

  if (data.ok) {
    const method = data.method as string;
    let icon = "✅";
    let title = "Commande confirmée !";
    let details = "";

    if (method === "obypay") {
      details = `Commande ${data.order_id ? `#${data.order_id}` : ""} passée sur Obypay. Paiement à la livraison/retrait.`;
    } else if (method === "twilio") {
      icon = "📞";
      title = "Appel en cours !";
      details = `Un appel TTS a été lancé vers ${data.phone}. Le Truck Muche va recevoir votre commande par téléphone.`;
    } else if (method === "foxorders_redirect") {
      icon = "🔗";
      title = "Commande Foxorders";
      details = data.message as string;
      if (data.redirect_url) {
        details += ` <a href="${data.redirect_url}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">Ouvrir Foxorders →</a>`;
      }
    }

    content.innerHTML = `
      <div style="text-align:center;margin-bottom:1rem;font-size:2rem;">${icon}</div>
      <h3 style="font-family:var(--font-heading);font-weight:700;margin-bottom:0.5rem;font-size:1rem;">${title}</h3>
      <p style="font-size:0.85rem;color:var(--text-secondary);">${details}</p>`;
  } else {
    const errorMsg = (data.error || data.message || "Erreur inconnue") as string;
    content.innerHTML = `
      <div style="text-align:center;margin-bottom:1rem;font-size:2rem;">⚠️</div>
      <h3 style="font-family:var(--font-heading);font-weight:700;margin-bottom:0.5rem;font-size:1rem;">Commande impossible</h3>
      <p style="font-size:0.85rem;color:var(--text-secondary);">${errorMsg}</p>`;
  }

  modal.style.display = "flex";
}

// ── Drawer open/close ─────────────────────────────────────────────────────────

function openCart() {
  const drawer = document.getElementById("cart-drawer");
  const overlay = document.getElementById("cart-overlay");
  if (drawer) drawer.style.transform = "translateX(0)";
  if (overlay) overlay.style.display = "block";
  renderCart();
}

function closeCart() {
  const drawer = document.getElementById("cart-drawer");
  const overlay = document.getElementById("cart-overlay");
  if (drawer) drawer.style.transform = "translateX(100%)";
  if (overlay) overlay.style.display = "none";
}

// ── Login modal ───────────────────────────────────────────────────────────────

function openLoginModal() {
  const modal = document.getElementById("login-modal");
  if (modal) modal.style.display = "flex";
  const input = document.getElementById("login-password") as HTMLInputElement;
  if (input) {
    input.value = "";
    input.focus();
  }
  const err = document.getElementById("login-error");
  if (err) err.style.display = "none";
}

function closeLoginModal() {
  const modal = document.getElementById("login-modal");
  if (modal) modal.style.display = "none";
}

async function submitLogin() {
  const input = document.getElementById("login-password") as HTMLInputElement;
  const err = document.getElementById("login-error");
  if (!input) return;

  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: input.value }),
  });

  if (res.ok) {
    closeLoginModal();
    renderCart();
  } else {
    if (err) err.style.display = "block";
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

function initCart() {
  // Boutons "Ajouter"
  document.querySelectorAll<HTMLButtonElement>(".add-to-cart-btn").forEach((btn) => {
    btn.onclick = () => {
      const restaurant = btn.dataset.restaurant || "";
      const plat = btn.dataset.plat || "";
      const prix = btn.dataset.prix || "";
      if (!restaurant || !plat) return;

      const items = loadCart();
      const existing = items.find(
        (i) => i.restaurant === restaurant && i.plat === plat
      );
      if (existing) {
        existing.quantity += 1;
      } else {
        items.push({ restaurant, plat, prix, quantity: 1 });
      }
      saveCart(items);
      renderCart();

      // Feedback visuel
      const orig = btn.textContent;
      btn.textContent = "Ajouté ✓";
      btn.style.background = "var(--good-bg)";
      btn.style.color = "var(--good)";
      btn.style.borderColor = "var(--good-border)";
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.background = "var(--accent-glow)";
        btn.style.color = "var(--accent)";
        btn.style.borderColor = "var(--accent)";
      }, 1200);
    };
  });

  // Bouton cart dans navbar
  const cartBtn = document.getElementById("cart-btn");
  if (cartBtn) cartBtn.onclick = openCart;

  // Fermer drawer
  const closeBtn = document.getElementById("cart-close");
  if (closeBtn) closeBtn.onclick = closeCart;

  const overlay = document.getElementById("cart-overlay");
  if (overlay) overlay.onclick = closeCart;

  // Login modal
  const loginCancel = document.getElementById("login-cancel");
  if (loginCancel) loginCancel.onclick = closeLoginModal;

  const loginSubmit = document.getElementById("login-submit");
  if (loginSubmit) loginSubmit.onclick = submitLogin;

  const loginInput = document.getElementById("login-password");
  if (loginInput) {
    loginInput.onkeydown = (e) => {
      if ((e as KeyboardEvent).key === "Enter") submitLogin();
    };
  }

  // Fermer modal login en cliquant l'overlay
  const loginModal = document.getElementById("login-modal");
  if (loginModal) {
    loginModal.onclick = (e) => {
      if (e.target === loginModal) closeLoginModal();
    };
  }

  // Fermer modal résultat
  const orderResultClose = document.getElementById("order-result-close");
  if (orderResultClose) orderResultClose.onclick = () => {
    const modal = document.getElementById("order-result-modal");
    if (modal) modal.style.display = "none";
  };

  const orderResultModal = document.getElementById("order-result-modal");
  if (orderResultModal) {
    orderResultModal.onclick = (e) => {
      if (e.target === orderResultModal) orderResultModal.style.display = "none";
    };
  }

  // Mettre à jour le badge au chargement
  renderCart();
}

// ── Mode / theme ─────────────────────────────────────────────────────────────

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

  // Sort plat cards by note (best first) within each day panel
  document.querySelectorAll<HTMLElement>("[data-day-panel]").forEach((panel) => {
    const cards = Array.from(panel.querySelectorAll<HTMLElement>(".plat-card"));
    if (cards.length < 2) return;
    const noteSelector = mode === "sportif" ? ".note.mode-sportif" : ".note.mode-goulaf";
    cards.sort((a, b) => {
      const noteA = parseFloat(a.querySelector<HTMLElement>(noteSelector)?.dataset.note || "0");
      const noteB = parseFloat(b.querySelector<HTMLElement>(noteSelector)?.dataset.note || "0");
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
