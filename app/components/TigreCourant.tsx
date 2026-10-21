"use client";

import { useEffect, useRef, useState } from "react";
import { ecartAvantPassage, nombrePetits, passage, tirerEvenement, type Evenement } from "@/lib/tigre-courant";
import styles from "./TigreCourant.module.css";

const GIF = "/textures/tigre-court.webp";

/** Le thème Tigre est actif et le visiteur accepte les animations. */
function tigreVisible() {
  return document.documentElement.getAttribute("data-theme") === "tigre"
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Course { id: number; evenement: Evenement; petits: number }

/**
 * Thème Tigre : un tigre traverse le bas de l'écran 4 à 6 fois par minute,
 * à intervalles, vitesses et sens aléatoires. Rarement (3 % chacun) un
 * tigre lancé à pleine vitesse, ou une mère suivie de ses petits.
 * Le gif n'est chargé que dans ce thème.
 */
export function TigreCourant() {
  const [actif, setActif] = useState(false);
  const [course, setCourse] = useState<Course | null>(null);
  const troupeRef = useRef<HTMLDivElement>(null);
  const mereRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const maj = () => setActif(tigreVisible());
    maj();
    const obs = new MutationObserver(maj);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", maj);
    return () => { obs.disconnect(); mq.removeEventListener("change", maj); };
  }, []);

  // Calendrier : tire le prochain passage ; l'animation part une fois la troupe rendue.
  useEffect(() => {
    if (!actif) return;
    let minuteur: ReturnType<typeof setTimeout>;
    let id = 0;
    const courir = () => {
      // Onglet caché : on saute ce passage plutôt que d'en accumuler.
      if (!document.hidden) {
        setCourse({ id: ++id, evenement: tirerEvenement(Math.random()), petits: nombrePetits(Math.random()) });
      }
      minuteur = setTimeout(courir, ecartAvantPassage(Math.random()));
    };
    // Premier passage peu après l'arrivée sur le thème, pour qu'on le remarque.
    minuteur = setTimeout(courir, 2500);
    return () => { clearTimeout(minuteur); setCourse(null); };
  }, [actif]);

  useEffect(() => {
    const troupe = troupeRef.current;
    const mere = mereRef.current;
    if (!course || !troupe || !mere) return;
    const { sens, deX, aX, dureeMs } = passage(
      window.innerWidth, troupe.offsetWidth, mere.offsetWidth, course.evenement, Math.random(), Math.random(),
    );
    troupe.style.visibility = "visible";
    const anim = troupe.animate(
      [
        { transform: `translateX(${deX}px) scaleX(${sens})` },
        { transform: `translateX(${aX}px) scaleX(${sens})` },
      ],
      { duration: dureeMs, easing: "linear" },
    );
    anim.onfinish = () => { troupe.style.visibility = ""; };
    return () => { anim.cancel(); troupe.style.visibility = ""; };
  }, [course]);

  if (!actif) return null;
  const petits = course?.evenement === "famille" ? course.petits : 0;
  return (
    <div ref={troupeRef} className={`${styles.troupe} ${course?.evenement === "eclair" ? styles.eclair : ""}`} aria-hidden="true">
      {Array.from({ length: petits }, (_, i) => <img key={i} src={GIF} alt="" className={styles.petit} />)}
      <div ref={mereRef} className={styles.mere}><img src={GIF} alt="" /></div>
    </div>
  );
}
