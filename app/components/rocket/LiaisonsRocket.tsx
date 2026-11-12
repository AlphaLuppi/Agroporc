"use client";

import { useEffect, useRef, useState } from "react";
import type { ReglagesRocket } from "@/lib/rocket/contrat";
import { debuterCapture } from "@/lib/rocket/capture";
import {
  AIDE_PLAYSTATION, GROUPES_MANETTE, GROUPES_TOUCHES, LIBELLES_ACTIONS_MANETTE, LIBELLES_ACTIONS_TOUCHES,
  actionsSansEntreeManette, actionsSansTouche, assignerManette, assignerTouche, libelleEntreeManette, libelleToucheRocket, manetteEstParDefaut, manetteParDefaut,
  messageRefus, phraseDepossession, touchesParDefaut, touchesSontParDefaut,
  type ActionManette, type ActionTouche, type Emplacement,
} from "@/lib/rocket/liaisons";
import type { PropsReglagesRocket } from "./contrats";
import { useCaptureManette, type FinCaptureManette } from "./useCaptureManette";
import { useDispositionRocket } from "./useDispositionRocket";
import styles from "./Rocket.module.css";

type Capture =
  | { mode: "clavier"; action: ActionTouche; slot: Emplacement }
  | { mode: "manette"; action: ActionManette; slot: Emplacement };

const FINS_MANETTE: Record<FinCaptureManette, string> = {
  annulee: "Capture annulée.",
  delai: "Aucune entrée détectée : capture annulée.",
  absente: "Aucune manette détectée. Branche-la, appuie sur l'un de ses boutons, puis réessaie.",
  nonstandard: "Cette manette n'a pas la disposition standard des boutons : Rocket Muche ne peut ni la lire ni la configurer.",
  perdue: "La manette a été déconnectée : capture annulée.",
};

/**
 * Après une affectation à la souris ou à Espace / Entrée, le navigateur envoie encore la suite du geste (`click`, `auxclick`, `contextmenu`
 * au relâchement du bouton ; `click` au relâchement de la touche dans Firefox) : sur le bouton sous le curseur ou focalisé, elle rouvrirait
 * aussitôt une capture ou lancerait « Rétablir ». On l'avale jusqu'au relâchement (plus un court délai), au plus 3 s.
 */
function avalerSuiteGeste(origine: "souris" | "touche", code: string): void {
  const bloquer = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const types = origine === "souris" ? ["click", "auxclick", "contextmenu"] : [];
  let fini = false;
  let garde = 0;
  const surRelache = (e: Event) => {
    if (origine === "souris") setTimeout(liberer, 150);
    else if ((e as KeyboardEvent).code === code) { bloquer(e); setTimeout(liberer, 0); }
  };
  const liberer = () => {
    if (fini) return;
    fini = true;
    clearTimeout(garde);
    for (const t of types) window.removeEventListener(t, bloquer, true);
    window.removeEventListener(origine === "souris" ? "mouseup" : "keyup", surRelache, true);
  };
  for (const t of types) window.addEventListener(t, bloquer, true);
  window.addEventListener(origine === "souris" ? "mouseup" : "keyup", surRelache, true);
  garde = window.setTimeout(liberer, 3000);
}

/** Un emplacement de liaison : bouton natif de 40 px au moins, `aria-pressed` pendant la capture. */
function EmplacementLiaison({ action, numero, texte, vide, enCapture, surClic }: {
  action: string; numero: number; texte: string; vide: boolean; enCapture: boolean; surClic(): void;
}) {
  return (
    <button
      type="button"
      className={`${styles.liaisonBtn} ${vide ? styles.liaisonVide : ""}`}
      aria-pressed={enCapture}
      aria-label={`${action}, entrée ${numero} : ${vide ? "aucune" : texte}. Changer`}
      onClick={surClic}
    >
      {enCapture ? "…" : texte}
    </button>
  );
}

/**
 * Éditeur des liaisons de Rocket Muche, clavier / souris puis manette : on clique un emplacement (deux par action), puis on appuie sur la
 * touche, clique le bouton de la souris, appuie sur le bouton ou pousse le stick voulu. Échap annule, Retour arrière vide l'emplacement.
 * Une entrée prise par une autre action lui est retirée et le dit. Échap et Start restent toujours liées à la pause (premier emplacement
 * fixe). Une seule capture à la fois ; le jeu, lui, ne lit rien tant qu'elle est ouverte (`lib/rocket/capture.ts`).
 */
export default function LiaisonsRocket({ reglages, surReglages }: PropsReglagesRocket) {
  const disposition = useDispositionRocket();
  const [capture, setCapture] = useState<Capture | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const courant = useRef({ reglages, surReglages });
  courant.current = { reglages, surReglages };

  const libTouche = (code: string | null) => libelleToucheRocket(code, disposition);

  /** Affecte une touche (`null` : vide l'emplacement) et referme la capture. */
  function poserTouche(c: Extract<Capture, { mode: "clavier" }>, code: string | null) {
    const { reglages: r, surReglages: sr } = courant.current;
    const res = assignerTouche(r.touches, c.action, c.slot, code);
    if (res.refus) setMessage(messageRefus(res.refus, "clavier", libTouche(code)));
    else {
      sr({ ...r, touches: res.liaisons });
      setMessage(code === null ? null : phraseDepossession(libTouche(code), res.depossedees, LIBELLES_ACTIONS_TOUCHES));
    }
    setCapture(null);
  }
  function poserManette(c: Extract<Capture, { mode: "manette" }>, code: string | null) {
    const { reglages: r, surReglages: sr } = courant.current;
    const res = assignerManette(r.liaisonsManette, c.action, c.slot, code);
    if (res.refus) setMessage(messageRefus(res.refus, "manette", libelleEntreeManette(code)));
    else {
      sr({ ...r, liaisonsManette: res.liaisons });
      setMessage(code === null ? null : phraseDepossession(libelleEntreeManette(code), res.depossedees, LIBELLES_ACTIONS_MANETTE));
    }
    setCapture(null);
  }

  // Capture clavier / souris : la prochaine touche ou le prochain clic est pris avant le jeu et la vue (phase de capture de `window`).
  // Le drapeau de `capture.ts` tient le menu pause (Échap) et le jeu à l'écart pendant ce temps.
  useEffect(() => {
    if (capture?.mode !== "clavier") return;
    const c = capture;
    const fin = debuterCapture();
    const clavier = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat || !e.code) return;
      if (e.code === "Escape") { setCapture(null); return; }
      if (e.code === "Backspace" || e.code === "Delete") { poserTouche(c, null); return; }
      poserTouche(c, e.code);
      avalerSuiteGeste("touche", e.code);
    };
    const souris = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      poserTouche(c, `Souris${e.button}`);
      avalerSuiteGeste("souris", `Souris${e.button}`);
    };
    const bloquer = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    // la touche est écoutée tout de suite ; la souris n'est armée qu'au tour suivant : le clic qui a ouvert la capture ne doit pas être pris
    // pour le bouton choisi
    window.addEventListener("keydown", clavier, true);
    const t = setTimeout(() => {
      window.addEventListener("mousedown", souris, true);
      window.addEventListener("contextmenu", bloquer, true);
      window.addEventListener("click", bloquer, true);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", clavier, true);
      window.removeEventListener("mousedown", souris, true);
      window.removeEventListener("contextmenu", bloquer, true);
      window.removeEventListener("click", bloquer, true); // la suite d'un clic affecté est avalée par `avalerSuiteGeste`
      fin();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `poserTouche` ne lit que des refs et des setters
  }, [capture, disposition]);

  // Capture de la manette
  useCaptureManette(
    capture?.mode === "manette",
    (code) => { if (capture?.mode === "manette") poserManette(capture, code); },
    (raison) => { setMessage(FINS_MANETTE[raison]); setCapture(null); },
  );

  const demarrer = (c: Capture) => {
    setMessage(null);
    const meme = capture !== null && capture.mode === c.mode && capture.action === c.action && capture.slot === c.slot;
    setCapture(meme ? null : c);
  };

  const manquantsClavier = actionsSansTouche(reglages.touches);
  const manquantsManette = actionsSansEntreeManette(reglages.liaisonsManette);
  const statut = capture
    ? capture.mode === "clavier"
      ? <>Appuie sur une touche ou clique pour « {LIBELLES_ACTIONS_TOUCHES[capture.action]} » · <kbd>Échap</kbd> annule · <kbd>Retour arrière</kbd> vide</>
      : <>Appuie sur un bouton ou pousse un stick pour « {LIBELLES_ACTIONS_MANETTE[capture.action]} » · <kbd>Échap</kbd> annule · <kbd>Retour arrière</kbd> vide</>
    : message;

  return (
    <>
      <p className={styles.liaisonsStatut} role="status" aria-live="polite">{statut}</p>

      <fieldset className={styles.groupe}>
        <legend>Clavier et souris</legend>
        <div className={styles.liaisonsTete}>
          <span>Clique une entrée, puis appuie sur la touche ou le bouton de la souris voulu.</span>
          <button
            type="button"
            className={styles.boutonDiscret}
            disabled={touchesSontParDefaut(reglages.touches)}
            onClick={() => { setCapture(null); surReglages({ ...reglages, touches: touchesParDefaut() }); setMessage("Touches par défaut rétablies."); }}
          >
            Rétablir les touches par défaut
          </button>
        </div>
        {GROUPES_TOUCHES.map((g) => (
          <div key={g.titre} className={styles.liaisonsGroupe} role="group" aria-label={g.titre}>
            <h3>{g.titre}</h3>
            <dl className={styles.liaisonsListe}>
              {g.actions.map((a) => (
                <div key={a}>
                  <dt>{LIBELLES_ACTIONS_TOUCHES[a]}</dt>
                  <dd>
                    {a === "pause" && <span className={styles.liaisonFixe} title="Échap ouvre toujours la pause">Échap</span>}
                    {(a === "pause" ? ([1] as const) : ([0, 1] as const)).map((slot) => {
                      const code = reglages.touches[a][slot] ?? null;
                      return (
                        <EmplacementLiaison
                          key={slot}
                          action={LIBELLES_ACTIONS_TOUCHES[a]}
                          numero={slot + 1}
                          texte={libTouche(code)}
                          vide={code === null}
                          enCapture={capture?.mode === "clavier" && capture.action === a && capture.slot === slot}
                          surClic={() => demarrer({ mode: "clavier", action: a, slot })}
                        />
                      );
                    })}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        {manquantsClavier.length > 0 && (
          <p className={styles.liaisonsAvertissement}>Sans touche : {manquantsClavier.map((a) => LIBELLES_ACTIONS_TOUCHES[a]).join(", ")}.</p>
        )}
      </fieldset>

      <fieldset className={styles.groupe}>
        <legend>Boutons de la manette</legend>
        <div className={styles.liaisonsTete}>
          <span>Clique une entrée, puis appuie sur un bouton ou pousse un stick. Libellés Xbox ({AIDE_PLAYSTATION}).</span>
          <button
            type="button"
            className={styles.boutonDiscret}
            disabled={manetteEstParDefaut(reglages.liaisonsManette)}
            onClick={() => { setCapture(null); surReglages({ ...reglages, liaisonsManette: manetteParDefaut() }); setMessage("Manette par défaut rétablie."); }}
          >
            Rétablir la manette par défaut
          </button>
        </div>
        {GROUPES_MANETTE.map((g) => (
          <div key={g.titre} className={styles.liaisonsGroupe} role="group" aria-label={`Manette : ${g.titre}`}>
            <h3>{g.titre}</h3>
            <dl className={styles.liaisonsListe}>
              {g.actions.map((a) => (
                <div key={a}>
                  <dt>{LIBELLES_ACTIONS_MANETTE[a]}</dt>
                  <dd>
                    {a === "pause" && <span className={styles.liaisonFixe} title="Start ouvre toujours la pause">Start</span>}
                    {(a === "pause" ? ([1] as const) : ([0, 1] as const)).map((slot) => {
                      const code = reglages.liaisonsManette[a][slot] ?? null;
                      return (
                        <EmplacementLiaison
                          key={slot}
                          action={LIBELLES_ACTIONS_MANETTE[a]}
                          numero={slot + 1}
                          texte={libelleEntreeManette(code)}
                          vide={code === null}
                          enCapture={capture?.mode === "manette" && capture.action === a && capture.slot === slot}
                          surClic={() => demarrer({ mode: "manette", action: a, slot })}
                        />
                      );
                    })}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <p className={styles.liaisonsNote}>
          Un stick garde la zone morte et la courbe réglées plus haut, quelle que soit l&apos;action qu&apos;on lui donne. Sur un bouton, une action
          progressive (gaz, volant, regard) vaut tout ou rien ; sur un stick, une action à deux états (saut, boost…) se déclenche à mi-course.
          Aucune manette détectée ? Branche-la puis appuie sur l&apos;un de ses boutons.
        </p>
        {manquantsManette.length > 0 && (
          <p className={styles.liaisonsAvertissement}>Sans entrée : {manquantsManette.map((a) => LIBELLES_ACTIONS_MANETTE[a]).join(", ")}.</p>
        )}
      </fieldset>
    </>
  );
}
