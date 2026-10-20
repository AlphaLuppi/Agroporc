"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { PdjEntry } from "@/lib/db";
import { noteMode, type Mode } from "@/lib/carte-tri";
import { formatDateShort } from "@/lib/format";
import { casseLisible, recoDuMode } from "@/lib/menus-vue";
import { variantesPlat } from "@/lib/plat-options";
import { baseClePlatImage, imageDuPlat, type ImagesPlats } from "@/lib/plat-image";
import { RESTAURANTS, statutSansPlat } from "@/lib/restaurants";
import CommentSection from "../CommentSection";
import MacrosPanel from "../MacrosPanel";
import RestoBadge from "../components/RestoBadge";
import PlatImage from "./PlatImage";
import PhotoPlat from "./PhotoPlat";
import RecettePanneau from "./RecettePanneau";
import { recetteAttendue } from "@/lib/recettes";
import { AjouterButton, fmtNote, fmtPrix, MODE_LABEL, OrderLinks, Pastille } from "./ui";
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

/** Détail d'un plat : feuille du bas sur mobile, panneau à droite sur desktop. Échap ou le voile ferment. */
export default function DetailPanneau({ selection, semaine, mode, today, cartesSlugs, onClose, voirCarte, images, clesPlats }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const precedent = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      precedent?.focus?.();
    };
  }, [onClose]);

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
          <div className={styles.panneauTete}>
            <Pastille note={noteMode(v, mode)} />
            <div className={styles.panneauTexte}>
              <RestoBadge nom={plat.restaurant} variante="chip" complet className={styles.panneauResto} />
              <h2>{titre}</h2>
              <div className={styles.meta}>
                <b>{fmtPrix(plat.prix)}</b> · {formatDateShort(pdj.date)}
              </div>
              <div className={styles.autreMode}>
                {MODE_LABEL[autre]} : {fmtNote(noteMode(v, autre))}/10 {estReco && <span className={styles.tagReco}>Reco du jour</span>}
              </div>
            </div>
          </div>
          {image && (
            <figure style={{ margin: 0 }}>
              <PlatImage key={image.src} src={image.src} nom={titre} format="panneau" />
              {image.credit && <figcaption className={styles.legendeIa}>Image : {image.credit}</figcaption>}
            </figure>
          )}
          {estReco && reco?.raison && <p className={styles.texte} style={{ color: "var(--good)" }}>{reco.raison}</p>}
          <MacrosPanel nutri={v.nutrition_estimee} ingredients={v.ingredients_detail} source={v.nutrition_source} />
          {justification && <p className={styles.texte}>{justification}</p>}
          <div className={styles.actions}>
            <OrderLinks restaurant={plat.restaurant} />
            <AjouterButton restaurant={plat.restaurant} plat={v.plat} prix={plat.prix} date={pdj.date} />
          </div>
          {cleRecette && <RecettePanneau key={cleRecette} cle={cleRecette} date={pdj.date} today={today} />}
          {slugPhotos && <PhotoPlat key={`${pdj.date}-${v.plat}`} slug={slugPhotos} plat={v.plat} date={pdj.date} />}
          <CommentSection commentaires={plat.commentaires || []} date={pdj.date} platIndex={selection.platIndex} />
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
        <div className={styles.panneauTete}>
          <RestoBadge nom={selection.nom} variante="icone" taille={34} />
          <div className={styles.panneauTexte}>
            <h2>{selection.nom}</h2>
            <div className={styles.meta}>{statut}</div>
          </div>
        </div>
        <OrderLinks restaurant={selection.nom} />
        {resto && cartesSlugs.has(resto.slug) && (
          <button type="button" className={styles.bouton} style={{ alignSelf: "flex-start" }} onClick={() => voirCarte(resto.slug)}>
            Voir la carte
          </button>
        )}
      </>
    );
  }

  if (!contenu) return null;

  return createPortal(
    <>
      <div className={styles.voile} onClick={onClose} aria-hidden="true" />
      <div ref={ref} className={styles.panneau} role="dialog" aria-modal="true" aria-label={titre} tabIndex={-1}>
        <div className={styles.poignee} aria-hidden="true" />
        <Fermer onClose={onClose} />
        {contenu}
      </div>
    </>,
    document.body,
  );
}
