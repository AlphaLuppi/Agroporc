import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";
import styles from "../dilemme.module.css";

/** Historique des plats en chargement : titre, sous-navigation, barre de filtres, grille de cartes avec image. */
export default function Chargement() {
  return (
    <SkeletonPage label="Chargement des plats…" className={styles.page}>
      <div className="flex flex-col gap-2">
        <Skeleton style={{ width: "min(220px, 60%)", height: 32 }} />
        <Skeleton style={{ width: "min(420px, 90%)", height: 14 }} />
      </div>
      <Skeleton style={{ width: 240, height: 40 }} />
      <div className={styles.recherche}>
        <Skeleton className="pdj-skel-carte" style={{ height: 42 }} />
        <Skeleton className="pdj-skel-carte" style={{ height: 42 }} />
        <Skeleton className="pdj-skel-carte" style={{ height: 42 }} />
        <Skeleton style={{ width: 120, height: 42 }} />
      </div>
      <div className={styles.grille}>
        {[80, 64, 72, 58, 76, 68].map((w, i) => (
          <div key={i} className={`${styles.carte} pdj-skel-carte`} style={{ gap: 8 }}>
            <Skeleton className="pdj-skel-bloc" style={{ aspectRatio: "16 / 9", margin: "-12px -14px 2px", width: "calc(100% + 28px)", borderRadius: 0 }} />
            <Skeleton style={{ width: 72, height: 28 }} />
            <Skeleton style={{ width: `${w}%`, height: 17 }} />
            <Skeleton style={{ width: "55%", height: 12 }} />
            <div className="flex gap-1.5">
              <Skeleton style={{ width: 84, height: 28 }} />
              <Skeleton style={{ width: 84, height: 28 }} />
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
