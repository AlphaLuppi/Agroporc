"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  delaiVif, fileViveVide, pousserVif, prendreVif, PRIORITE_VIVE, type FileVive, type MessageVif,
} from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Région vive du HUD (§12) : un message toutes les 2 s au plus, les moins importants jetés (file pure de `hud-modele.ts`).
 * `aria-live="polite"` pour tout, `assertive` seulement pour « PV critiques » (un nœud séparé : l'attribut d'un nœud existant ne
 * se change pas de façon fiable). Visuellement cachée. Le fil d'éliminations reste `aria-live="off"`.
 */
export { PRIORITE_VIVE };

/** File anti-bavardage : `pousser(texte, priorite, assertif?)` ; `courant` = le message actuellement dans la région. */
export function useFileVive(): { courant: MessageVif | null; pousser(texte: string, priorite: number, assertif?: boolean): void } {
  const [courant, setCourant] = useState<MessageVif | null>(null);
  const file = useRef<FileVive>(fileViveVide());
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useRef(0);

  const liberer = useCallback(function liberer() {
    minuteur.current = null;
    const t = performance.now();
    const r = prendreVif(file.current, t);
    file.current = r.file;
    if (r.message) setCourant(r.message);
    const d = delaiVif(file.current, performance.now());
    if (d >= 0) minuteur.current = setTimeout(liberer, d + 5);
  }, []);

  const pousser = useCallback((texte: string, priorite: number, assertif = false) => {
    file.current = pousserVif(file.current, { id: ++id.current, texte, priorite, assertif });
    if (!minuteur.current) liberer();
  }, [liberer]);

  useEffect(() => () => { if (minuteur.current) clearTimeout(minuteur.current); }, []);
  return { courant, pousser };
}

function ZoneViveBrute({ message }: { message: MessageVif | null }) {
  return (
    <div className={styles.srSeul}>
      <p role="status" aria-live="polite" aria-atomic="true">{message && !message.assertif ? message.texte : ""}</p>
      <p role="alert" aria-live="assertive" aria-atomic="true">{message?.assertif ? message.texte : ""}</p>
    </div>
  );
}

const ZoneVive = memo(ZoneViveBrute);
export default ZoneVive;
