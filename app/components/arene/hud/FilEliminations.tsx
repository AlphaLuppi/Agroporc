"use client";

import { memo } from "react";
import { nomPictoFil } from "@/lib/fps/hud-modele";
import { PICTO_TETE, pictoCause } from "@/lib/fps/pictos-armes";
import type { Annonce, EntreeFil } from "../contrats";
import styles from "../HudArene.module.css";
import PictoArme from "./PictoArme";

/**
 * Fil d'éliminations (haut-droite, §5.1) : 6 lignes de 6 s au plus. Une ligne d'arme : pastille + pseudo en `--ag-ink` (la couleur du
 * serveur n'est jamais du texte), PICTOGRAMME de l'arme (silhouette façon killfeed de Counter-Strike, `lib/fps/pictos-armes.ts` : jamais
 * le nom écrit, qui reste en `aria-label` et en info-bulle), crâne devant lui pour un tir à la tête, pastille + pseudo. Une mort par voiture,
 * circulation, tigre, tempête, abandon… montre l'emblème de sa cause à la place de l'arme, le kill d'un tigre allié celui d'une arme (patte).
 * Mes lignes : fond ambre et barre de 3u. Les annonces d'Elsa et d'information s'intercalent par ordre d'arrivée
 * (les ids viennent du même compteur). `aria-live="off"` : la région vive annonce l'essentiel.
 */
export interface PropsFilEliminations {
  fil: readonly EntreeFil[];
  annonces: readonly Annonce[];
}

type Ligne = { id: number; kind: "kill"; e: EntreeFil } | { id: number; kind: "annonce"; a: Annonce };

function FilBrut({ fil, annonces }: PropsFilEliminations) {
  const lignes: Ligne[] = [
    ...fil.map((e): Ligne => ({ id: e.id, kind: "kill", e })),
    ...annonces.map((a): Ligne => ({ id: a.id, kind: "annonce", a })),
  ].sort((x, y) => x.id - y.id);
  if (lignes.length === 0) return null;
  return (
    <ul className={styles.fil} aria-label="Éliminations" aria-live="off">
      {lignes.map((l) => {
        if (l.kind === "annonce") {
          return <li key={`a${l.id}`} className={styles.filAnnonce} data-genre={l.a.genre}>{l.a.texte}</li>;
        }
        const e = l.e;
        // un kill (arme, tigre allié, voiture conduite, grenade…) s'écrit : tueur, pictogramme, victime ; sans tueur : pictogramme de la cause, victime
        const parArme = e.cause === "arme" || !!e.par;
        const picto = (
          <span className={styles.filArme}>
            {e.tete && <PictoArme picto={PICTO_TETE} nom="tir à la tête" className={styles.filTete} />}
            <PictoArme picto={pictoCause(e.cause, e.arme)} nom={nomPictoFil(e.arme, e.cause, e.par)} />
          </span>
        );
        return (
          <li key={`k${l.id}`} className={`${styles.filLigne} ${e.moi ? styles.filMoi : ""}`}>
            {parArme ? (
              <>
                <i className={styles.pastille} style={{ background: e.parCouleur }} aria-hidden="true" />
                <b>{e.par}</b>
                {picto}
                <i className={styles.pastille} style={{ background: e.cibleCouleur }} aria-hidden="true" />
                <b>{e.cible}</b>
              </>
            ) : (
              <>
                {picto}
                <i className={styles.pastille} style={{ background: e.cibleCouleur }} aria-hidden="true" />
                <b>{e.cible}</b>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const FilEliminations = memo(FilBrut);
export default FilEliminations;
