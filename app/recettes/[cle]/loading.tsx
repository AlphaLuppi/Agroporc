import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";
import styles from "../recettes.module.css";

/** Fiche recette en chargement : image, titre, durées, ingrédients et étapes. */
export default function Chargement() {
  return (
    <SkeletonPage label="Chargement de la recette…" className={styles.fiche}>
      <Skeleton style={{ width: 150, height: 14 }} />
      <Skeleton className="pdj-skel-carte" style={{ aspectRatio: "16 / 9" }} />
      <div className="flex flex-col gap-2.5">
        <Skeleton style={{ width: "75%", height: 30 }} />
        <Skeleton style={{ width: "55%", height: 14 }} />
        <Skeleton style={{ width: "95%", height: 13 }} />
        <Skeleton style={{ width: "80%", height: 13 }} />
      </div>
      <div className="flex flex-wrap gap-2">
        {[92, 80, 76, 96].map((w, i) => (
          <Skeleton key={i} className="pdj-skel-carte" style={{ width: w, height: 44 }} />
        ))}
      </div>
      {[5, 4].map((n, s) => (
        <div key={s} className="flex flex-col gap-2.5">
          <Skeleton style={{ width: 130, height: 20 }} />
          {Array.from({ length: n }, (_, i) => (
            <Skeleton key={i} style={{ width: `${90 - ((i * 13 + s * 7) % 30)}%`, height: 14 }} />
          ))}
        </div>
      ))}
    </SkeletonPage>
  );
}
