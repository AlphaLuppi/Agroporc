"use client";

import type { ReactNode } from "react";
import type { CoinMinimap } from "@/lib/fps/reglages-hud";
import styles from "../HudArene.module.css";

/**
 * Colonne de coin du HUD (§4.6) : empile du bord de l'écran vers l'intérieur la mini-map (si choisie dans ce coin) puis le bloc propre au coin
 * (fil d'éliminations en haut à droite, bloc vie en bas à gauche, bloc armes en bas à droite). Les chiffres vitaux ne changent jamais de place :
 * ils sont toujours les derniers de leur colonne et la colonne est ancrée au bord de l'écran. Rend `null` quand le coin est vide.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 */
export interface PropsCoinHud {
  /** coin de l'écran ; la mini-map n'y est empilée que si `coinMinimap` est le même */
  coin: Exclude<CoinMinimap, "off">;
  coinMinimap: CoinMinimap;
  miniMap: ReactNode;
  children?: ReactNode;
}

const CLASSE: Record<Exclude<CoinMinimap, "off">, string> = { hg: styles.coinHG, hd: styles.coinHD, bg: styles.coinBG, bd: styles.coinBD };

/** Contenu d'un coin dans l'ordre d'empilement : la mini-map d'abord (si elle est dans ce coin), puis le bloc du coin. */
export function contenuCoin(p: PropsCoinHud): ReactNode[] {
  const res: ReactNode[] = [];
  if (p.coinMinimap === p.coin && p.miniMap) res.push(p.miniMap);
  if (p.children) res.push(p.children);
  return res;
}

export default function CoinHud(p: PropsCoinHud) {
  const contenu = contenuCoin(p);
  if (contenu.length === 0) return null;
  return (
    <div className={`${styles.coin} ${CLASSE[p.coin]}`} data-coin={p.coin}>
      {p.coinMinimap === p.coin && p.miniMap}
      {p.children}
    </div>
  );
}
