"use client";

import dynamic from "next/dynamic";
import { useId } from "react";
import type { ModeRocket } from "@/lib/rocket/reseau/lobby-en-ligne";
import type { PropsLobbyRocketEnLigne, PropsPanneauRocket } from "./contrats";
import styles from "./Rocket.module.css";

/**
 * Le lobby en ligne n'est chargé que quand « En ligne » est choisi : `next/dynamic`, jamais d'import statique.
 * Le client réseau, lui, n'est chargé qu'à la connexion, par `import()` dans le hook `useSalonRocket`.
 */
const LobbyRocketEnLigne = dynamic<PropsLobbyRocketEnLigne>(() => import("./LobbyRocketEnLigne"), {
  ssr: false,
  loading: () => <aside className={styles.lobby} aria-label="Rocket Muche en ligne"><p className={styles.statut} role="status">Chargement du mode en ligne…</p></aside>,
});

const MODES: readonly { valeur: ModeRocket; libelle: string; titre: string }[] = [
  { valeur: "local", libelle: "Hors ligne", titre: "Seul contre des bots, sans serveur." },
  { valeur: "ligne", libelle: "En ligne", titre: "Contre une autre personne, sur le serveur du site." },
];

/**
 * Panneau « Rocket Muche » : un commutateur Hors ligne / En ligne (radios natives, mémorisé par l'appelant) au-dessus du lobby choisi.
 * Hors ligne, le lobby historique (`children`, `LobbyRocket` tel quel) ; en ligne, `LobbyRocketEnLigne`. Rien du réseau n'est chargé
 * tant que « En ligne » n'est pas sélectionné.
 */
export default function PanneauRocket({ mode, surMode, children, enLigne }: PropsPanneauRocket) {
  const id = useId();
  return (
    <div className={styles.panneau} data-mode={mode}>
      <fieldset className={styles.basculeMode}>
        <legend className={styles.reserveLecteurs}>Mode de jeu</legend>
        {MODES.map((m) => (
          <label key={m.valeur} className={styles.segment} title={m.titre}>
            <input type="radio" name={`${id}-mode`} value={m.valeur} checked={mode === m.valeur} onChange={() => surMode(m.valeur)} />
            {m.libelle}
          </label>
        ))}
      </fieldset>
      {mode === "ligne" ? <LobbyRocketEnLigne {...enLigne} /> : children}
    </div>
  );
}
