"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { PdjEntry } from "@/lib/db";
import type { AvatarIa } from "@/lib/characters";
import { noteMode, type Mode } from "@/lib/carte-tri";
import { formatDateShort } from "@/lib/format";
import { casseLisible, recoDuMode } from "@/lib/menus-vue";
import { variantesPlat } from "@/lib/plat-options";
import { decisionLacher, suiviDoigt } from "@/lib/motion-menus";
import { baseClePlatImage, imageDuPlat, type ImagesPlats } from "@/lib/plat-image";
import { RESTAURANTS, statutSansPlat } from "@/lib/restaurants";
import CommentSection from "../CommentSection";
import MacrosPanel from "../MacrosPanel";
import RestoBadge from "../components/RestoBadge";
import PlatImage from "./PlatImage";
import PhotoPlat from "./PhotoPlat";
import RecettePanneau from "./RecettePanneau";
import { recetteAttendue } from "@/lib/recettes";
import { BUDGET_EDENRED_MOIS, fmtPartBudget, repasParMois } from "@/lib/budget";
import { AjouterButton, fmtNote, fmtPrix, MODE_LABEL, OrderLinks, PastilleAnimee } from "./ui";
import { reduit } from "./motion";
import styles from "./menus.module.css";

/** Ce que montre le panneau : un plat (une variante d'un `Plat`) ou un resto sans plat. */
export type Selection =
  | { kind: "plat"; date: string; platIndex: number; variante: string }
  | { kind: "resto"; date: string; nom: string }
  | null;

interface Props {
  selection: Exclude<Selection, null>;
  semaine: PdjEntry[];
  mode: Mode;
  today: string;
  cartesSlugs: Set<string>;
  onClose: () => void;
  voirCarte: (slug: string) => void;
  images?: ImagesPlats;
  /** Base de clé → clé du plat, pour charger sa recette (POC). */
  clesPlats?: Record<string, string>;
  /** Repères des personnages IA en base, pour les avatars des commentaires. */
  avatars?: Record<string, AvatarIa>;
}

function Fermer({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className={styles.fermer} onClick={onClose} aria-label="Fermer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    </button>
  );
}

/** Cascade d'entrée du contenu (rang 0 à 4). */
const rang = (i: number) => ({ "--i": i }) as CSSProperties;

/** Durée max de la sortie avant de démonter quand même (animationend manqué, onglet caché…). */
const SORTIE_SECOURS = 260;

/**
 * Détail d'un plat : feuille du bas sur mobile, panneau à droite sur desktop. Échap, le voile, le
 * bouton fermer ou un glissé vers le bas (mobile) ferment, avec une courte sortie animée.
 */
export default function DetailPanneau({ selection, semaine, mode, today, cartesSlugs, onClose, voirCarte, images, clesPlats, avatars }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [sortie, setSortie] = useState(false);
  const ferme = useRef(false);
  const secours = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fermerVraiment = useCallback(() => {
    if (ferme.current) return;
    ferme.current = true;
    clearTimeout(secours.current);
    onClose();
  }, [onClose]);

  // Stable tant que onClose l'est : l'effet focus / overflow / Échap ne se relance pas.
  const demanderFermeture = useCallback(() => {
    if (ferme.current) return;
    if (reduit()) return fermerVraiment();
    setSortie(true);
    clearTimeout(secours.current);
    secours.current = setTimeout(fermerVraiment, SORTIE_SECOURS);
  }, [fermerVraiment]);

  useEffect(() => () => clearTimeout(secours.current), []);

  // ── Glisser pour fermer (mobile) : depuis la poignée ou l'en-tête, contenu en haut seulement. ──
  const drag = useRef<{ id: number; y0: number; y: number; t: number; v: number } | null>(null);
  const debutDrag = (e: PointerEvent<HTMLDivElement>) => {
    const panneau = ref.current;
    if (!panneau || sortie || panneau.scrollTop > 0) return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    if ((e.target as Element).closest("button, a, input, textarea")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { id: e.pointerId, y0: e.clientY, y: 0, t: e.timeStamp, v: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    // L'entrée CSS (`monte`, sur translate) écraserait le translate inline : on la termine.
    for (const a of panneau.getAnimations()) {
      if (a.id === "retour") a.cancel();
      else if ("animationName" in a) a.finish(); // getAnimations() sans subtree : celles du panneau seul
    }
  };
  const suivreDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const panneau = ref.current;
    if (!d || d.id !== e.pointerId || !panneau) return;
    const y = suiviDoigt(e.clientY - d.y0);
    const dt = Math.max(1, e.timeStamp - d.t);
    d.v = (y - d.y) / dt;
    d.y = y;
    d.t = e.timeStamp;
    panneau.style.translate = `0 ${y}px`;
  };
  const finDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const panneau = ref.current;
    if (!d || d.id !== e.pointerId || !panneau) return;
    drag.current = null;
    if (Math.abs(d.y) < 1) {
      panneau.style.translate = "";
      return;
    }
    if (e.type !== "pointercancel" && decisionLacher(d.y, d.v) === "fermer") {
      // La sortie part de la position courante (translate inline) ; sous reduce, fermeture immédiate.
      demanderFermeture();
      return;
    }
    const depart = d.y;
    panneau.style.translate = "";
    if (reduit()) return;
    const a = panneau.animate([{ translate: `0 ${depart}px` }, { translate: "0 0" }], { duration: 280, easing: "cubic-bezier(.34,1.4,.64,1)" });
    a.id = "retour";
  };
  const zoneDrag = {
    onPointerDown: debutDrag,
    onPointerMove: suivreDrag,
    onPointerUp: finDrag,
    onPointerCancel: finDrag,
  };

  useEffect(() => {
    const precedent = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // preventScroll : le panneau est encore hors écran (début de `monte`), pas de saut sur iOS.
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") demanderFermeture();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      precedent?.focus?.();
    };
  }, [demanderFermeture]);

  const pdj = semaine.find((p) => p.date === selection.date);
  let contenu: React.ReactNode = null;
  let titre = "";

  if (selection.kind === "plat" && pdj) {
    const plat = pdj.plats[selection.platIndex];
    const v = plat && variantesPlat(plat).find((x) => x.plat === selection.variante);
    if (plat && v) {
      const autre: Mode = mode === "sportif" ? "goulaf" : "sportif";
      const reco = recoDuMode(pdj, mode);
      const estReco = reco?.restaurant === plat.restaurant && reco.plat === v.plat;
      const justification = mode === "goulaf" ? v.justification_goulaf || v.justification : v.justification;
      titre = casseLisible(v.plat);
      const image = imageDuPlat(images, plat.restaurant, v.plat);
      const resto = RESTAURANTS.find((r) => r.nom === plat.restaurant);
      const slugPhotos = resto && resto.type !== "lien" ? resto.slug : undefined;
      // Même filtre que le pipeline (`a_cuisiner`) : ni « coming soon », ni nom vide une fois normalisé.
      const cleRecette = plat.coming_soon || !recetteAttendue(plat.restaurant, v.plat)
        ? undefined
        : clesPlats?.[baseClePlatImage(plat.restaurant, v.plat)];
      contenu = (
        <>
          <div className={`${styles.panneauTete} ${styles.cascade}`} style={rang(0)} {...zoneDrag}>
            <PastilleAnimee note={noteMode(v, mode)} cle={mode} depuisZero />
            <div className={styles.panneauTexte}>
              <RestoBadge nom={plat.restaurant} variante="chip" complet className={styles.panneauResto} />
              <h2>{titre}</h2>
              <div className={styles.meta}>
                <b>{fmtPrix(plat.prix)}</b> · {formatDateShort(pdj.date)}
              </div>
              {fmtPartBudget(plat.prix) && (
                <div className={styles.budgetLigne}>
                  <b>{fmtPartBudget(plat.prix)}</b> des {BUDGET_EDENRED_MOIS} € Edenred du mois · {repasParMois(plat.prix)} repas comme celui-ci
                </div>
              )}
              <div className={styles.autreMode}>
                {MODE_LABEL[autre]} : {fmtNote(noteMode(v, autre))}/10 {estReco && <span className={styles.tagReco}>Reco du jour</span>}
              </div>
            </div>
          </div>
          {image && (
            <figure className={styles.cascade} style={{ ...rang(1), margin: 0 }}>
              <PlatImage key={image.src} src={image.src} nom={titre} format="panneau" />
              {image.credit && <figcaption className={styles.legendeIa}>Image : {image.credit}</figcaption>}
            </figure>
          )}
          {estReco && reco?.raison && (
            <p className={`${styles.texte} ${styles.cascade}`} style={{ ...rang(1), color: "var(--good)" }}>
              {reco.raison}
            </p>
          )}
          <div className={styles.cascade} style={rang(2)}>
            <MacrosPanel nutri={v.nutrition_estimee} ingredients={v.ingredients_detail} source={v.nutrition_source} />
          </div>
          {justification && (
            <p className={`${styles.texte} ${styles.cascade}`} style={rang(2)}>
              {justification}
            </p>
          )}
          <div className={`${styles.actions} ${styles.cascade}`} style={rang(3)}>
            <OrderLinks restaurant={plat.restaurant} />
            <AjouterButton restaurant={plat.restaurant} plat={v.plat} prix={plat.prix} date={pdj.date} />
          </div>
          {/* Commentaires (repliés) juste sous les macros : c'est ce qu'on vient lire ; puis la recette
              repliée et les photos. Un seul dernier palier de la cascade (pas d'attente en bas de feuille). */}
          <div className={styles.cascade} style={rang(4)}>
            <CommentSection commentaires={plat.commentaires || []} date={pdj.date} platIndex={selection.platIndex} avatars={avatars} />
            {cleRecette && <RecettePanneau key={cleRecette} cle={cleRecette} date={pdj.date} today={today} />}
            {slugPhotos && <PhotoPlat key={`${pdj.date}-${v.plat}`} slug={slugPhotos} plat={v.plat} date={pdj.date} />}
          </div>
        </>
      );
    }
  } else if (selection.kind === "resto") {
    const resto = RESTAURANTS.find((r) => r.nom === selection.nom);
    const aVenir = pdj?.plats.some((p) => p.restaurant === selection.nom && p.coming_soon);
    titre = selection.nom;
    const statut = aVenir
      ? "Plat du jour dévoilé le matin même"
      : resto
        ? statutSansPlat(resto, selection.date > today)
        : "";
    contenu = (
      <>
        <div className={`${styles.panneauTete} ${styles.cascade}`} style={rang(0)} {...zoneDrag}>
          <RestoBadge nom={selection.nom} variante="icone" taille={34} />
          <div className={styles.panneauTexte}>
            <h2>{selection.nom}</h2>
            <div className={styles.meta}>{statut}</div>
          </div>
        </div>
        <div className={styles.cascade} style={rang(1)}>
          <OrderLinks restaurant={selection.nom} />
        </div>
        {resto && cartesSlugs.has(resto.slug) && (
          <button
            type="button"
            className={`${styles.bouton} ${styles.cascade}`}
            style={{ ...rang(2), alignSelf: "flex-start" }}
            onClick={() => voirCarte(resto.slug)}
          >
            Voir la carte
          </button>
        )}
      </>
    );
  }

  if (!contenu) return null;

  return createPortal(
    <>
      <div className={styles.voile} onClick={demanderFermeture} aria-hidden="true" data-sortie={sortie ? "" : undefined} />
      <div
        ref={ref}
        className={styles.panneau}
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        tabIndex={-1}
        data-sortie={sortie ? "" : undefined}
        onAnimationEnd={(e) => {
          if (sortie && e.target === e.currentTarget) fermerVraiment();
        }}
      >
        <div className={styles.poignee} aria-hidden="true" {...zoneDrag} />
        <Fermer onClose={demanderFermeture} />
        {contenu}
      </div>
    </>,
    document.body,
  );
}
