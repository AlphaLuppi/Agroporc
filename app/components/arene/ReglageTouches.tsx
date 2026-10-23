"use client";

import { useEffect, useState } from "react";
import {
  GROUPES_ACTIONS, LIBELLES_ACTIONS, TOUCHE_RESERVEE, assigner, codeSouris, estParDefaut, libelleTouche,
  touchesParDefaut, type Action, type ConfigTouches,
} from "@/lib/fps/touches";
import styles from "./HudArene.module.css";

interface Props {
  config: ConfigTouches;
  surChange(cfg: ConfigTouches): void;
}

/** Disposition du clavier du joueur (Chrome) : affiche « Z » et non « W » sur un AZERTY. */
export function useDisposition(): ReadonlyMap<string, string> | null {
  const [d, setD] = useState<ReadonlyMap<string, string> | null>(null);
  useEffect(() => {
    const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<ReadonlyMap<string, string>> } }).keyboard;
    let annule = false;
    kb?.getLayoutMap?.().then((m) => { if (!annule) setD(m); }).catch(() => { /* API indisponible : libellés QWERTY */ });
    return () => { annule = true; };
  }, []);
  return d;
}

/**
 * Touches de l'arène dans le menu pause, groupées (`GROUPES_ACTIONS` : Déplacement, Combat, Équipement, Véhicule, Divers) :
 * on clique un emplacement puis on appuie sur la touche ou le bouton de souris voulu (Échap annule, Retour arrière vide
 * l'emplacement). Une touche déjà prise quitte son ancienne action, qui est signalée. Enregistré par l'hôte (localStorage).
 */
export default function ReglageTouches({ config, surChange }: Props) {
  const disposition = useDisposition();
  const [capture, setCapture] = useState<{ action: Action; slot: 0 | 1 } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // En capture, la prochaine touche ou le prochain clic est intercepté avant le jeu et la vue.
  useEffect(() => {
    if (!capture) return;
    const poser = (code: string | null) => {
      const r = assigner(config, capture.action, capture.slot, code);
      surChange(r.cfg);
      setMessage(r.depossedee ? `« ${libelleTouche(code, disposition)} » a été retirée de « ${LIBELLES_ACTIONS[r.depossedee]} ».` : null);
      setCapture(null);
    };
    const clavier = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.code === TOUCHE_RESERVEE) { setCapture(null); return; }
      if (e.code === "Backspace" || e.code === "Delete") { poser(null); return; }
      if (!e.code) return;
      poser(e.code);
    };
    const souris = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      poser(codeSouris(e.button));
    };
    const bloquer = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    // armé au tour suivant : le clic qui a ouvert la capture ne doit pas être pris pour la touche
    const t = setTimeout(() => {
      window.addEventListener("keydown", clavier, true);
      window.addEventListener("mousedown", souris, true);
      window.addEventListener("contextmenu", bloquer, true);
      window.addEventListener("click", bloquer, true);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", clavier, true);
      window.removeEventListener("mousedown", souris, true);
      window.removeEventListener("contextmenu", bloquer, true);
      // le clic qui suit le mousedown capturé est encore bloqué, puis on lâche
      setTimeout(() => window.removeEventListener("click", bloquer, true), 0);
    };
  }, [capture, config, surChange, disposition]);

  return (
    <section className={styles.touches} aria-label="Touches">
      <div className={styles.touchesTete}>
        <span>Touches</span>
        <button
          type="button"
          className={styles.touchesDefaut}
          disabled={estParDefaut(config)}
          onClick={() => { surChange(touchesParDefaut()); setMessage("Touches par défaut rétablies."); }}
        >
          Par défaut
        </button>
      </div>
      <p className={styles.touchesAide} role="status" aria-live="polite">
        {capture
          ? <>Appuyez sur une touche ou cliquez pour « {LIBELLES_ACTIONS[capture.action]} » · <kbd>Échap</kbd> annule · <kbd>Retour arrière</kbd> vide</>
          : message ?? "Cliquez sur une touche pour la changer. Enregistré dans ce navigateur."}
      </p>
      {GROUPES_ACTIONS.map((g, i) => (
        <div key={g.titre} className={styles.touchesGroupe} role="group" aria-labelledby={`touches-groupe-${i}`}>
          <h3 id={`touches-groupe-${i}`}>{g.titre}</h3>
          <dl className={styles.touchesListe}>
            {g.actions.map((a) => (
              <div key={a}>
                <dt>{LIBELLES_ACTIONS[a]}</dt>
                <dd>
                  {([0, 1] as const).map((slot) => {
                    const code = config[a][slot];
                    const enCapture = capture?.action === a && capture.slot === slot;
                    return (
                      <button
                        key={slot}
                        type="button"
                        className={`${styles.toucheBtn} ${code === null ? styles.toucheVide : ""}`}
                        aria-pressed={enCapture}
                        aria-label={`${LIBELLES_ACTIONS[a]}, touche ${slot + 1} : ${code === null ? "aucune" : libelleTouche(code, disposition)}. Changer`}
                        onClick={() => { setMessage(null); setCapture(enCapture ? null : { action: a, slot }); }}
                      >
                        {enCapture ? "…" : libelleTouche(code, disposition)}
                      </button>
                    );
                  })}
                </dd>
              </div>
            ))}
            {g.titre === "Divers" && (
              <div>
                <dt>Menu pause</dt>
                <dd><span className={styles.toucheFixe}>Échap</span></dd>
              </div>
            )}
          </dl>
        </div>
      ))}
    </section>
  );
}
