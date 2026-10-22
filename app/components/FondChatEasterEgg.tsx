"use client";

import { useEffect, useRef, useState } from "react";
import { ecouterCode } from "@/lib/code-secret";
import { CODE_CHAT, GIF_CHAT_URL, dureeGif, dureeLecture } from "@/lib/fond-chat";
import styles from "./FondChatEasterEgg.module.css";

/** Classe posée sur <html> pendant la lecture : masque le motif du thème (body::before). */
const CLASSE_HTML = "pdj-fond-chat";

/**
 * Charge le gif et mesure une lecture. En blob : chaque déclenchement repart de la première
 * image et la durée vient des octets. Si Tenor refuse le fetch (CORS), l'URL directe et la
 * durée par défaut. Rejette si l'image ne se charge pas.
 */
async function chargerGif(signal: AbortSignal): Promise<{ src: string; dureeMs: number; blob: boolean }> {
  let src = GIF_CHAT_URL;
  let duree: number | null = null;
  let blob = false;
  try {
    const rep = await fetch(GIF_CHAT_URL, { signal });
    if (rep.ok) {
      const octets = new Uint8Array(await rep.arrayBuffer());
      duree = dureeGif(octets);
      src = URL.createObjectURL(new Blob([octets], { type: "image/gif" }));
      blob = true;
    }
  } catch (e) {
    if (signal.aborted) throw e;
  }
  await new Promise<void>((ok, ko) => {
    const img = new Image();
    img.onload = () => ok();
    img.onerror = () => ko(new Error("gif introuvable"));
    img.src = src;
  }).catch((e) => {
    if (blob) URL.revokeObjectURL(src);
    throw e;
  });
  return { src, dureeMs: dureeLecture(duree), blob };
}

/**
 * Code secret « cat » : tapé n'importe où sur le site (hors champ de saisie, tous thèmes), le fond
 * du site devient le gif du chat « shake my hand » le temps d'une lecture, puis le fond du thème
 * revient. Retaper pendant la lecture ne relance rien ; rien avec prefers-reduced-motion, rien
 * (sans bruit) si le gif ne se charge pas.
 */
export function FondChatEasterEgg() {
  const [src, setSrc] = useState<string | null>(null);
  const enCoursRef = useRef(false);

  useEffect(() => {
    const ctrl = new AbortController();
    let minuteur: number | undefined;
    let blobUrl: string | null = null;
    const finir = () => {
      document.documentElement.classList.remove(CLASSE_HTML);
      setSrc(null);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = null;
      enCoursRef.current = false;
    };
    const arreter = ecouterCode(CODE_CHAT, () => {
      if (enCoursRef.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      enCoursRef.current = true;
      chargerGif(ctrl.signal).then(
        (g) => {
          if (ctrl.signal.aborted) return;
          if (g.blob) blobUrl = g.src;
          document.documentElement.classList.add(CLASSE_HTML);
          setSrc(g.src);
          minuteur = window.setTimeout(finir, g.dureeMs);
        },
        () => { enCoursRef.current = false; },
      );
    });
    return () => {
      arreter();
      ctrl.abort();
      window.clearTimeout(minuteur);
      finir();
    };
  }, []);

  if (!src) return null;
  return <div className={styles.fond} style={{ backgroundImage: `url("${src}")` }} aria-hidden="true" />;
}
