"use client";

import { memo } from "react";
import styles from "../HudArene.module.css";

/**
 * Toast central bas de 2,5 s : « Soin complet : PV 100, bouclier 100 », « Railgun · 6 tirs · touche 4 », « Railgun épuisé ». Visuel seulement :
 * la région vive (`ZoneVive`) porte la même information aux lecteurs d'écran.
 */
function ToastBrut({ texte }: { texte: string }) {
  return <p className={`${styles.plaque} ${styles.toast}`} aria-hidden="true">{texte}</p>;
}

const ToastCentre = memo(ToastBrut);
export default ToastCentre;
