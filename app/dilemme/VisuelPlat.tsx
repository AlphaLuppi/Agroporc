import PlatImage from "../menus/PlatImage";
import styles from "./dilemme.module.css";

function Couverts({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="24" cy="26" r="13" />
      <circle cx="24" cy="26" r="8" />
      <path d="M6 12v9a3 3 0 0 0 3 3v14M9 12v9M12 12v9a3 3 0 0 1-3 3M40 12c-3 0-4 4-4 9h4v17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Photo 16/9 d'un plat bord à bord dans sa carte (le parent définit `--pad-x` / `--pad-y`),
 * ou un fond d'assiette quand il n'y a pas d'image. Sans état.
 */
export default function VisuelPlat({ src, nom }: { src: string | null; nom: string }) {
  return src ? (
    <PlatImage key={src} src={src} nom={nom} format="tuile" />
  ) : (
    <span className={styles.sansImage}>
      <Couverts className={styles.sansImageIcone} />
    </span>
  );
}
