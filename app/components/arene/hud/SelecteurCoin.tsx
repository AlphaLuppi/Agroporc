"use client";

import { useRef, type KeyboardEvent } from "react";
import { COINS_MINIMAP, LIBELLES_COINS, type CoinMinimap } from "@/lib/fps/reglages-hud";
import styles from "./ReglageInterface.module.css";

/**
 * Sélecteur de coin de la mini-map (§4.5) : schéma d'écran 16:9 avec quatre boutons de coin, plus « Masquée », en `role="radiogroup"`.
 * Flèches du clavier (←/↑ précédent, →/↓ suivant, bouclant ; Début / Fin), un seul bouton dans l'ordre de tabulation (tabindex itinérant),
 * anneau de focus blanc 2 px. Le schéma fait 144×81 px (et non 96×54) : c'est la taille minimale pour que chaque coin offre une cible
 * de 40 px sans recouvrir son voisin.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 */
export interface PropsSelecteurCoin {
  coin: CoinMinimap;
  surChange(c: CoinMinimap): void;
  /** préfixe d'id (deux instances à l'écran : lobby et pause) */
  idGroupe: string;
}

/** Ordre de navigation : les quatre coins en lecture, puis « Masquée ». */
const ORDRE: readonly CoinMinimap[] = COINS_MINIMAP;

export default function SelecteurCoin({ coin, surChange, idGroupe }: PropsSelecteurCoin) {
  const refs = useRef(new Map<CoinMinimap, HTMLButtonElement>());
  const idTitre = `${idGroupe}-coin-titre`;

  const aller = (c: CoinMinimap) => {
    surChange(c);
    refs.current.get(c)?.focus();
  };
  const clavier = (e: KeyboardEvent<HTMLButtonElement>, c: CoinMinimap) => {
    const i = ORDRE.indexOf(c);
    let cible: CoinMinimap | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") cible = ORDRE[(i + 1) % ORDRE.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") cible = ORDRE[(i + ORDRE.length - 1) % ORDRE.length];
    else if (e.key === "Home") cible = ORDRE[0];
    else if (e.key === "End") cible = ORDRE[ORDRE.length - 1];
    if (cible === null) return;
    e.preventDefault();
    aller(cible);
  };
  const ref = (c: CoinMinimap) => (el: HTMLButtonElement | null) => {
    if (el) refs.current.set(c, el);
    else refs.current.delete(c);
  };
  const bouton = (c: CoinMinimap) => ({
    type: "button" as const,
    role: "radio" as const,
    "aria-checked": coin === c,
    // tabindex itinérant : seul le coin choisi est dans l'ordre de tabulation
    tabIndex: coin === c ? 0 : -1,
    onClick: () => surChange(c),
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => clavier(e, c),
    ref: ref(c),
  });

  return (
    <div className={styles.coin} role="radiogroup" aria-labelledby={idTitre}>
      <span id={idTitre} className={styles.etiquette}>Coin de la mini-carte</span>
      <div className={styles.ecranSchema}>
        {(["hg", "hd", "bg", "bd"] as const).map((c) => (
          <button key={c} {...bouton(c)} className={styles.coinBtn} data-coin={c} aria-label={LIBELLES_COINS[c]} title={LIBELLES_COINS[c]} />
        ))}
      </div>
      <button {...bouton("off")} className={styles.masquee}>{LIBELLES_COINS.off}</button>
      <p className={styles.valeurCoin} aria-hidden="true">{coin === "off" ? "Mini-carte masquée" : `Mini-carte : ${LIBELLES_COINS[coin].toLowerCase()}`}</p>
    </div>
  );
}
