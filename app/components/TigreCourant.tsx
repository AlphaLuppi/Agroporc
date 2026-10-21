"use client";

import { useEffect, useState } from "react";
import { webglDisponible } from "@/lib/tigre3d/webgl";
import { Tigre3D } from "./Tigre3D";
import { TigreSprite } from "./TigreSprite";

/** Le thème Tigre est actif et le visiteur accepte les animations. */
function tigreVisible() {
  return document.documentElement.getAttribute("data-theme") === "tigre"
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Thème Tigre : un tigre traverse le bas de l'écran 4 à 6 fois par minute et réagit au clic.
 * Ce composant ne décide que de ce qui s'affiche : rien hors thème Tigre (ni avec
 * prefers-reduced-motion), le tigre 3D (`Tigre3D`, three.js à la demande) si WebGL
 * répond, sinon, ou si WebGL tombe en route, le sprite webp (`TigreSprite`).
 */
export function TigreCourant() {
  const [actif, setActif] = useState(false);
  const [rendu, setRendu] = useState<"3d" | "sprite">("3d");

  useEffect(() => {
    const maj = () => setActif(tigreVisible());
    maj();
    const obs = new MutationObserver(maj);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", maj);
    return () => { obs.disconnect(); mq.removeEventListener("change", maj); };
  }, []);

  // Pas de WebGL : sprite d'emblée (testé à l'activation seulement, jamais dans les autres thèmes).
  useEffect(() => {
    if (actif && !webglDisponible()) setRendu("sprite");
  }, [actif]);

  if (!actif) return null;
  return rendu === "3d" ? <Tigre3D surEchec={() => setRendu("sprite")} /> : <TigreSprite />;
}
