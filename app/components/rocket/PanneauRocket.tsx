"use client";

import dynamic from "next/dynamic";
import { Children, Component, cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from "react";
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

/**
 * Barrière d'erreur locale : après un redéploiement, un onglet resté ouvert peut référencer un chunk disparu (`ChunkLoadError`). Sans barrière
 * l'erreur de rendu remplacerait toute la vue Palantir ; ici seul le lobby en ligne est remplacé, et le commutateur reste utilisable.
 */
class LimiteLobbyEnLigne extends Component<{ children: ReactNode }, { erreur: boolean }> {
  state = { erreur: false };
  static getDerivedStateFromError() { return { erreur: true }; }
  render() {
    if (!this.state.erreur) return this.props.children;
    return (
      <aside className={styles.lobby} aria-label="Rocket Muche en ligne">
        <p className={styles.erreur} role="alert">Le mode en ligne n&apos;a pas pu se charger (le site a peut-être été mis à jour). Rechargez la page, ou jouez hors ligne.</p>
        <div className={styles.pied2}>
          <button type="button" className={styles.boutonPrincipal} onClick={() => window.location.reload()}>Recharger la page</button>
        </div>
      </aside>
    );
  }
}

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
  const verrouille = enLigne.etat.salon !== null;
  // le champ du nom ne prend le focus qu'à l'ouverture du panneau : basculer Hors ligne / En ligne à la radio ne doit pas le lui voler
  const [aBascule, setABascule] = useState(false);
  const enLigneProps = aBascule ? { ...enLigne, pseudoParDefaut: false } : enLigne;
  const contenuLocal = aBascule ? Children.map(children, (c) => (isValidElement(c) ? cloneElement(c as ReactElement<{ pseudoParDefaut?: boolean }>, { pseudoParDefaut: false }) : c)) : children;
  return (
    <div className={styles.panneau} data-mode={mode}>
      <fieldset className={styles.basculeMode}>
        <legend className={styles.reserveLecteurs}>Mode de jeu</legend>
        {MODES.map((m) => (
          <label key={m.valeur} className={styles.segment} title={m.titre}>
            <input
              type="radio" name={`${id}-mode`} value={m.valeur} checked={mode === m.valeur} onChange={() => { setABascule(true); surMode(m.valeur); }}
              // passer en « Hors ligne » dans un salon couperait la connexion : il faut d'abord le quitter
              disabled={verrouille && m.valeur !== mode}
            />
            {m.libelle}
          </label>
        ))}
      </fieldset>
      {mode === "ligne" ? <LimiteLobbyEnLigne key="ligne"><LobbyRocketEnLigne {...enLigneProps} /></LimiteLobbyEnLigne> : contenuLocal}
    </div>
  );
}
