"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { groupesBarre, choixApres } from "@/lib/fps/barre-armes";
import type { ArmeId } from "@/lib/fps/protocole";
import type { Vitrine, TuileVitrine } from "@/lib/fps/rendu-armes-apercu";
import { useMouvementReduit } from "./hud/useMouvementReduit";
import type { EquipementChoisi } from "./contrats";
import styles from "./BarreArmes.module.css";

/**
 * Choix de l'équipement de la prochaine apparition, en bas de l'écran de mort et de l'entracte : chaque arme est une tuile avec son modèle 3D
 * (fil de fer qui se balance, tour complet au survol ou au focus), regroupées en Principale / Secondaire / Blanche. Un clic (souris libre :
 * Échap) ou les flèches choisissent ; les touches d'arme (1 / 2 / 3 par défaut) passent à l'arme d'après de leur groupe, câblées par `HudArene`.
 * Les tuiles sont des radios natives (l'état et les flèches ne dépendent pas de la 3D) ; le dessin vit dans UN canvas partagé, chargé à la demande
 * (`rendu-armes-apercu.ts`) : sans WebGL les tuiles restent lisibles, avec le seul nom. `reglageArme` : emplacement facultatif sous chaque groupe pour
 * l'arme CHOISIE (réglage propre à l'arme, ex. viseur), rendu tel quel.
 * Spec : lot UI du 2026-10-31 (retour « changer d'arme directement à la mort, voir leur 3D »).
 */
export interface PropsBarreArmes {
  equipement: EquipementChoisi;
  surChoisir(principale: EquipementChoisi["principale"], secondaire: EquipementChoisi["secondaire"], melee?: EquipementChoisi["melee"]): void;
  /** une ligne sous la barre (touches réelles du joueur) ; vide : rien */
  aide?: string;
  /** `killcam` : la barre se pose au-dessus de la bande basse de la killcam ; `libre` : au ras du bas de l'écran */
  habillage?: "killcam" | "libre";
  /** réglage propre à une arme, rendu sous son groupe quand cette arme est CHOISIE (facultatif, vide par défaut) */
  reglageArme?(arme: ArmeId): ReactNode;
}

export default function BarreArmes({ equipement, surChoisir, aide, habillage = "libre", reglageArme }: PropsBarreArmes) {
  const id = useId();
  const mouvementReduit = useMouvementReduit();
  const groupes = useMemo(() => groupesBarre(equipement), [equipement]);
  const piste = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const elements = useRef(new Map<ArmeId, HTMLElement>());
  const actifs = useRef(new Set<ArmeId>());
  const vitrine = useRef<Vitrine | null>(null);
  const [sans3d, setSans3d] = useState(false);

  // liste des tuiles lue par la vitrine : états d'interaction vivants (survol, focus), choix du dernier rendu
  const tuiles = useCallback((): TuileVitrine[] => groupes.flatMap((g) => g.tuiles.flatMap((t) => {
    const el = elements.current.get(t.id);
    return el ? [{ id: t.id, el, actif: actifs.current.has(t.id), choisie: t.choisie }] : [];
  })), [groupes]);
  const tuilesRef = useRef(tuiles);
  tuilesRef.current = tuiles;

  // la vitrine (three) n'est chargée qu'ici, à l'ouverture de la barre
  useEffect(() => {
    let annule = false;
    let v: Vitrine | null = null;
    let ro: ResizeObserver | null = null;
    const cv = canvas.current, zn = piste.current;
    if (!cv || !zn) return;
    void import("@/lib/fps/rendu-armes-apercu").then(({ creerVitrine }) => {
      if (annule) return;
      try {
        v = creerVitrine(cv, zn, { mouvementReduit });
      } catch {
        setSans3d(true);
        return;
      }
      vitrine.current = v;
      v.definir(tuilesRef.current());
      v.animer(!mouvementReduit);
      v.dessiner();
      ro = new ResizeObserver(() => { v?.definir(tuilesRef.current()); v?.dessiner(); });
      ro.observe(zn);
    }).catch(() => { if (!annule) setSans3d(true); });
    return () => {
      annule = true;
      ro?.disconnect();
      vitrine.current = null;
      v?.dispose();
    };
  }, [mouvementReduit]);

  // chaque rendu : la vitrine relit les tuiles ; en mouvement réduit (pas de boucle) on redessine à la main
  useEffect(() => {
    vitrine.current?.definir(tuiles());
    if (mouvementReduit) vitrine.current?.dessiner();
  });

  const marquer = (arme: ArmeId, actif: boolean) => {
    if (actif) actifs.current.add(arme); else actifs.current.delete(arme);
    if (mouvementReduit) vitrine.current?.dessiner();
  };

  return (
    <section className={styles.barre} data-habillage={habillage} data-sans3d={sans3d ? "oui" : undefined} aria-label="Armes de la prochaine apparition">
      <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
      <div ref={piste} className={styles.piste} onScroll={() => { if (mouvementReduit) vitrine.current?.dessiner(); }}>
        {groupes.map((g) => (
          <fieldset key={g.cle} className={styles.groupe}>
            <legend>{g.titre}</legend>
            <div className={styles.tuiles}>
              {g.tuiles.map((t) => (
                <label
                  key={t.id}
                  className={`${styles.tuile} ${t.choisie ? styles.choisie : ""}`}
                  onPointerEnter={() => marquer(t.id, true)}
                  onPointerLeave={() => marquer(t.id, false)}
                >
                  <input
                    type="radio"
                    name={`${id}-${g.cle}`}
                    value={t.id}
                    checked={t.choisie}
                    onChange={() => surChoisir(...choixApres(equipement, t.id))}
                    onFocus={() => marquer(t.id, true)}
                    onBlur={() => marquer(t.id, false)}
                  />
                  <span ref={(el) => { if (el) elements.current.set(t.id, el); else elements.current.delete(t.id); }} className={styles.vitrine} aria-hidden="true" />
                  <span className={styles.nom}>{t.nom}</span>
                </label>
              ))}
            </div>
            {reglageArme && <div className={styles.reglage}>{reglageArme(g.tuiles.find((t) => t.choisie)?.id ?? g.tuiles[0].id)}</div>}
          </fieldset>
        ))}
      </div>
      {aide && <p className={styles.aide}>{aide}</p>}
    </section>
  );
}
