"use client";

import { useEffect, useState, type AnimationEvent, type PointerEvent } from "react";
import { fmtCompteur, pointArc, valeurCompteur } from "@/lib/motion-menus";

/**
 * Helpers d'animation de l'accueil (WAAPI / rAF). Tous vérifient `reduit()` avant de bouger quoi
 * que ce soit, et rien n'est calculé au rendu : le HTML serveur reste identique au premier rendu client.
 */

export const RESSORT = "cubic-bezier(.34,1.56,.64,1)";
export const SORTIE_EXPO = "cubic-bezier(.16,1,.3,1)";

/** L'utilisateur a demandé à réduire les animations. */
export function reduit(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/**
 * Flag module : passe à vrai deux frames après la première hydratation, une fois que le mode et
 * la vue ont été relus du stockage. Avant, rien ne doit s'animer (pas de pastille qui glisse ni
 * de FLIP « tout seuls » au chargement). Les composants montés plus tard le voient déjà à vrai.
 */
let pretGlobal = false;
export const estPret = () => pretGlobal;

/** Booléen « les transitions peuvent tourner » : faux au rendu serveur et au premier rendu client. */
export function usePret(): boolean {
  const [pret, setPret] = useState(false);
  useEffect(() => {
    if (pretGlobal) {
      setPret(true);
      return;
    }
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        pretGlobal = true;
        setPret(true);
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, []);
  return pret;
}

/** Réécrit le texte d'un élément en gardant le nœud texte que React possède. */
export function ecrireTexte(el: HTMLElement, texte: string) {
  const t = el.firstChild;
  // On réécrit le nœud texte que React possède déjà : son prochain rendu le retrouvera intact.
  if (t && t.nodeType === Node.TEXT_NODE && el.childNodes.length === 1) t.nodeValue = texte;
  else el.textContent = texte;
}

/** Count-up de `de` à `a` (une décimale), puis la valeur finale formatée. Renvoie l'annulation. */
export function compter(el: HTMLElement, de: number, a: number, final: string, ms = 260): () => void {
  let id = 0;
  const debut = performance.now();
  const pas = (now: number) => {
    const t = (now - debut) / ms;
    if (t >= 1) {
      ecrireTexte(el, final);
      return;
    }
    ecrireTexte(el, fmtCompteur(valeurCompteur(de, a, t)));
    id = requestAnimationFrame(pas);
  };
  ecrireTexte(el, fmtCompteur(de));
  id = requestAnimationFrame(pas);
  return () => cancelAnimationFrame(id);
}

/** Petit « pop » (scale) rejoué à la demande, sans toucher au DOM ni aux classes. */
export function popper(el: Element | null | undefined, force = 1) {
  if (!el || reduit()) return;
  el.animate(
    [{ scale: "1" }, { scale: String(1 - 0.08 * force), offset: 0.3 }, { scale: String(1 + 0.06 * force), offset: 0.65 }, { scale: "1" }],
    { duration: 320, easing: "ease-out" },
  );
}

/** Ripple : pose l'origine (coordonnées locales) puis rejoue l'animation `data-ripple` du CSS. */
export function ripple(e: PointerEvent<HTMLElement>) {
  if (reduit()) return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--px", `${e.clientX - r.left}px`);
  el.style.setProperty("--py", `${e.clientY - r.top}px`);
  el.removeAttribute("data-ripple");
  requestAnimationFrame(() => el.setAttribute("data-ripple", ""));
}

/**
 * animationend d'une tuile : retire le ripple (::after) ; à la fin de l'entrée, pose `data-vu` pour
 * que l'entrée ne se rejoue pas quand React déplace la tuile dans le DOM (tri au changement de mode).
 */
export function finRipple(e: AnimationEvent<HTMLElement>) {
  if (e.pseudoElement === "::after") e.currentTarget.removeAttribute("data-ripple");
  else if (e.target === e.currentTarget) e.currentTarget.setAttribute("data-vu", "");
}

/**
 * « Ajouter » : une pastille vole en arc du bouton jusqu'au panier de la nav, puis le panier
 * rebondit. Élément fixed temporaire dans body, aria-hidden et sans pointeur.
 */
export function volerVersPanier(source: HTMLElement) {
  if (reduit()) return;
  const panier = document.getElementById("cart-btn");
  if (!panier) return;
  const a = source.getBoundingClientRect();
  const b = panier.getBoundingClientRect();
  if (a.width === 0 || b.width === 0) return;
  const depart = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  const arrivee = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  const bille = document.createElement("span");
  bille.setAttribute("aria-hidden", "true");
  Object.assign(bille.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "14px",
    height: "14px",
    margin: "-7px 0 0 -7px",
    borderRadius: "50%",
    background: "var(--accent)",
    boxShadow: "0 0 0 3px var(--accent-glow), 0 4px 12px rgba(0,0,0,.3)",
    pointerEvents: "none",
    zIndex: "200",
  });
  document.body.appendChild(bille);
  const etapes = 10;
  const keyframes = Array.from({ length: etapes + 1 }, (_, i) => {
    const t = i / etapes;
    const p = pointArc(depart, arrivee, t, Math.min(120, Math.abs(depart.y - arrivee.y) * 0.25 + 40));
    return { translate: `${p.x}px ${p.y}px`, scale: String(1 - 0.45 * t), opacity: i === etapes ? 0.6 : 1 };
  });
  const vol = bille.animate(keyframes, { duration: 520, easing: "cubic-bezier(.45,0,.55,1)" });
  const fin = () => {
    bille.remove();
    panier.animate([{ scale: "1" }, { scale: "1.18", offset: 0.4 }, { scale: "0.96", offset: 0.75 }, { scale: "1" }], {
      duration: 360,
      easing: "ease-out",
    });
  };
  vol.onfinish = fin;
  vol.oncancel = () => bille.remove();
}
