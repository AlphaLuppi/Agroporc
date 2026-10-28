"use client";

import { memo } from "react";
import { libelleFil } from "@/lib/fps/hud-modele";
import type { Annonce, EntreeFil } from "../contrats";
import styles from "../HudArene.module.css";

/**
 * Fil d'éliminations (haut-droite, §5.1) : 6 lignes de 6 s au plus. Une ligne d'arme : pastille + pseudo en `--ag-ink` (la couleur du
 * serveur n'est jamais du texte), arme en nom court (« ◎ » pour la tête), pastille + pseudo. Une mort par voiture, circulation ou tigre
 * sauvage s'écrit en toutes lettres, le kill d'un tigre allié comme celui d'une arme (« Tigre »). Mes lignes : fond ambre et barre de 3u. Les annonces d'Elsa et d'information s'intercalent par ordre d'arrivée
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
        // le kill d'un tigre allié s'écrit comme celui d'une arme : lanceur, « Tigre », victime
        const parArme = e.cause === "arme" || (e.cause === "tigre" && !!e.par);
        return (
          <li key={`k${l.id}`} className={`${styles.filLigne} ${e.moi ? styles.filMoi : ""}`}>
            {parArme ? (
              <>
                <i className={styles.pastille} style={{ background: e.parCouleur }} aria-hidden="true" />
                <b>{e.par}</b>
                <span className={styles.filArme}>
                  {e.tete && <span title="Tir à la tête" role="img" aria-label="tir à la tête">◎ </span>}
                  {libelleFil(e.arme, e.cause, e.par)}
                </span>
                <i className={styles.pastille} style={{ background: e.cibleCouleur }} aria-hidden="true" />
                <b>{e.cible}</b>
              </>
            ) : (
              <>
                <i className={styles.pastille} style={{ background: e.cibleCouleur }} aria-hidden="true" />
                <b>{e.cible}</b>
                <span className={styles.filArme}>{libelleFil(e.arme, e.cause, e.par)}</span>
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
