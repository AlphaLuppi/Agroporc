"use client";

import { useEffect, useRef, useState } from "react";
import { ecartAvantPassage, passage } from "@/lib/tigre-courant";
import styles from "./TigreCourant.module.css";

/** Le thème Tigre est actif et le visiteur accepte les animations. */
function tigreVisible() {
  return document.documentElement.getAttribute("data-theme") === "tigre"
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Thème Tigre : un tigre traverse le bas de l'écran 4 à 6 fois par minute,
 * à intervalles, vitesses et sens aléatoires. Le gif n'est chargé que dans ce thème.
 */
export function TigreCourant() {
  const [actif, setActif] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const maj = () => setActif(tigreVisible());
    maj();
    const obs = new MutationObserver(maj);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", maj);
    return () => { obs.disconnect(); mq.removeEventListener("change", maj); };
  }, []);

  useEffect(() => {
    if (!actif) return;
    let minuteur: ReturnType<typeof setTimeout>;
    let anim: Animation | undefined;
    const planifier = () => { minuteur = setTimeout(courir, ecartAvantPassage(Math.random())); };
    const courir = () => {
      const img = imgRef.current;
      // Onglet caché : on saute ce passage plutôt que d'en accumuler.
      if (img && !document.hidden) {
        const { sens, deX, aX, dureeMs } = passage(window.innerWidth, img.offsetWidth, Math.random(), Math.random());
        img.style.visibility = "visible";
        anim = img.animate(
          [
            { transform: `translateX(${deX}px) scaleX(${sens})` },
            { transform: `translateX(${aX}px) scaleX(${sens})` },
          ],
          { duration: dureeMs, easing: "linear" },
        );
        anim.onfinish = () => { img.style.visibility = ""; };
      }
      planifier();
    };
    // Premier passage peu après l'arrivée sur le thème, pour qu'on le remarque.
    minuteur = setTimeout(courir, 2500);
    return () => { clearTimeout(minuteur); anim?.cancel(); };
  }, [actif]);

  if (!actif) return null;
  return <img ref={imgRef} src="/textures/tigre-court.webp" alt="" aria-hidden="true" className={styles.tigre} />;
}
