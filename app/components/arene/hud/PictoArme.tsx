import { memo } from "react";
import { HAUTEUR_PICTO, type Picto } from "@/lib/fps/pictos-armes";
import styles from "../HudArene.module.css";

/**
 * Silhouette d'une arme ou d'une cause de mort (registre `lib/fps/pictos-armes.ts`) : SVG monochrome (`currentColor`), `role="img"`,
 * `aria-label` et `<title>` (info-bulle, et texte lu par les lecteurs d'écran) = `nom`. Sans état, utilisable côté serveur.
 */
export interface PropsPictoArme {
  picto: Picto;
  /** nom lisible : « Fusil d'assaut », « Écrasé par la police »… */
  nom: string;
  /** classe CSS en plus de `.filPicto` */
  className?: string;
}

function PictoArmeBrut({ picto, nom, className }: PropsPictoArme) {
  return (
    <svg
      className={`${styles.filPicto} ${className ?? ""}`}
      data-picto={picto.id}
      viewBox={`0 0 ${picto.largeur} ${HAUTEUR_PICTO}`}
      style={{ aspectRatio: `${picto.largeur} / ${HAUTEUR_PICTO}` }}
      role="img"
      aria-label={nom}
      focusable="false"
    >
      <title>{nom}</title>
      {picto.chemins.map((d, i) => <path key={i} d={d} fillRule="evenodd" />)}
    </svg>
  );
}

const PictoArme = memo(PictoArmeBrut);
export default PictoArme;
