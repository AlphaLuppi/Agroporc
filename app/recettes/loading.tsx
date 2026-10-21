import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";
import styles from "./recettes.module.css";

/** Banque de recettes en chargement : titre, recherche, grille de cartes avec image. */
export default function Chargement() {
  return (
    <SkeletonPage label="Chargement des recettes…" className={styles.page}>
      <div className="flex flex-col gap-2">
        <Skeleton style={{ width: "min(180px, 50%)", height: 32 }} />
        <Skeleton style={{ width: "min(420px, 90%)", height: 14 }} />
      </div>
      <div className={styles.recherche}>
        <Skeleton className="pdj-skel-carte" style={{ height: 42 }} />
        <Skeleton className="pdj-skel-carte" style={{ height: 42 }} />
        <Skeleton style={{ width: 120, height: 40 }} />
      </div>
      <div className={styles.grille}>
        {[80, 64, 72, 58, 76, 68].map((w, i) => (
          <div key={i} className={`${styles.carte} pdj-skel-carte`} style={{ gap: 8 }}>
            <Skeleton style={{ aspectRatio: "16 / 9", margin: "-12px -14px 2px", width: "calc(100% + 28px)", borderRadius: 0 }} />
            <Skeleton style={{ width: `${w}%`, height: 17 }} />
            <Skeleton style={{ width: `${w - 15}%`, height: 12 }} />
            <Skeleton style={{ width: 110, height: 20, borderRadius: 999 }} />
            <Skeleton style={{ width: "45%", height: 11 }} />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
