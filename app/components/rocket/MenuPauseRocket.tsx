"use client";

import { useEffect, useId, useRef, useState } from "react";
import { commandesRocket } from "@/lib/rocket/lobby";
import { useDispositionRocket } from "./useDispositionRocket";
import type { PropsMenuPauseRocket } from "./contrats";
import PanneauReglagesRocket from "./PanneauReglagesRocket";
import ListeCommandesRocket from "./ListeCommandesRocket";
import { usePiegeFocus } from "./usePiegeFocus";
import styles from "./Rocket.module.css";

type Vue = "menu" | "reglages" | "aide";
const TITRES: Record<Vue, string> = { menu: "Pause", reglages: "Réglages", aide: "Aide des touches" };

/**
 * Menu pause de Rocket Muche (dialogue modal : `role="dialog"`, `aria-modal`, focus piégé et rendu à la fermeture). Reprendre, Recommencer,
 * Réglages, Aide des touches, Quitter (retour au lobby) et « Quitter vers Agroparc » (ferme aussi le panneau).
 * En ligne (`enLigne`) le jeu NE s'arrête PAS pendant le menu : pas de « Recommencer », un bandeau le dit, « Quitter la partie » laisse un bot
 * à la place du joueur.
 *
 * Échap : le jeu ENTRE en pause sur la touche enfoncée mais ne la quitte pas (une seule touche ne doit pas faire l'aller-retour) ; ici
 * Échap relâchée reprend la partie, ou revient au menu depuis Réglages / Aide. On n'agit qu'au relâchement d'un Échap dont on a vu
 * l'appui : l'Échap qui vient d'ouvrir ce menu et que l'on relâche peu après ne le referme donc pas.
 */
export default function MenuPauseRocket({ reglages, surReglages, surReprendre, surRecommencer, surQuitter, surQuitterVue, manette, enLigne = false, etatConnexion }: PropsMenuPauseRocket) {
  const connexionPerdue = enLigne && etatConnexion !== undefined && etatConnexion !== "ouverte";
  const idTitre = useId();
  const [vue, setVue] = useState<Vue>("menu");
  const racine = useRef<HTMLDivElement>(null);
  const disposition = useDispositionRocket();
  usePiegeFocus(racine, undefined, vue);

  // les rappels changent à chaque rendu du parent : l'écouteur lit toujours les derniers
  const dernier = useRef({ vue, surReprendre });
  dernier.current = { vue, surReprendre };
  useEffect(() => {
    let armee = false;
    const bas = (e: KeyboardEvent) => { if (e.code === "Escape" && !e.repeat) armee = true; };
    const haut = (e: KeyboardEvent) => {
      if (e.code !== "Escape" || !armee) return;
      armee = false;
      e.preventDefault();
      if (dernier.current.vue === "menu") dernier.current.surReprendre();
      else setVue("menu");
    };
    window.addEventListener("keydown", bas, true);
    window.addEventListener("keyup", haut, true);
    return () => { window.removeEventListener("keydown", bas, true); window.removeEventListener("keyup", haut, true); };
  }, []);

  return (
    <div className={styles.voile}>
      <div ref={racine} className={styles.dialogue} role="dialog" aria-modal="true" aria-labelledby={idTitre}>
        <h2 id={idTitre} className={styles.titreDialogue}>{TITRES[vue]}</h2>
        {vue === "menu" && (
          <>
            <div className={styles.menu}>
              <button type="button" className={styles.boutonPrincipal} onClick={surReprendre}>Reprendre</button>
              {!enLigne && <button type="button" className={styles.boutonSecondaire} onClick={surRecommencer}>Recommencer</button>}
              <button type="button" className={styles.boutonSecondaire} onClick={() => setVue("reglages")}>Réglages</button>
              <button type="button" className={styles.boutonSecondaire} onClick={() => setVue("aide")}>Aide des touches</button>
              <button type="button" className={styles.boutonDanger} onClick={surQuitter}>{enLigne ? "Quitter la partie" : "Quitter"}</button>
              <button type="button" className={styles.boutonDiscret} onClick={surQuitterVue}>Quitter vers Agroparc</button>
            </div>
            {connexionPerdue ? (
              <>
                <p className={styles.bandeauEnLigne} role="status">Connexion perdue, reconnexion en cours… Vos commandes sont suspendues.</p>
                <p className={styles.noteDialogue}>La partie reprend si la connexion revient dans les 20 secondes. Échap reprend les commandes.</p>
              </>
            ) : enLigne ? (
              <>
                <p className={styles.bandeauEnLigne} role="status">Le jeu continue en ligne. Vos commandes sont suspendues.</p>
                <p className={styles.noteDialogue}>Échap reprend la partie. Quitter la partie confie votre voiture à un bot.</p>
              </>
            ) : (
              <p className={styles.noteDialogue}>
                Échap reprend la partie.{manette ? " Start sur la manette aussi." : ""} Recommencer relance un match avec les mêmes réglages.
              </p>
            )}
          </>
        )}
        {vue === "reglages" && (
          <>
            <div className={styles.defilement}>
              <PanneauReglagesRocket reglages={reglages} surReglages={surReglages} />
            </div>
            <div className={styles.boutons}><button type="button" className={styles.boutonSecondaire} onClick={() => setVue("menu")}>Retour</button></div>
          </>
        )}
        {vue === "aide" && (
          <>
            <div className={styles.defilement}>
              <ListeCommandesRocket commandes={commandesRocket(reglages.touches, disposition)} />
            </div>
            <div className={styles.boutons}><button type="button" className={styles.boutonSecondaire} onClick={() => setVue("menu")}>Retour</button></div>
          </>
        )}
      </div>
    </div>
  );
}
