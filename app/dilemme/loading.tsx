import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";
import styles from "./dilemme.module.css";

/** Dilemme en chargement : titre, sous-navigation, deux grands blocs côte à côte (empilés en mobile), puis des lignes. */
export default function Chargement() {
  return (
    <SkeletonPage label="Chargement du dilemme…" className={styles.page}>
      <div className="flex flex-col gap-2">
        <Skeleton style={{ width: "min(240px, 60%)", height: 32 }} />
        <Skeleton style={{ width: "min(420px, 90%)", height: 14 }} />
      </div>
      <Skeleton style={{ width: 240, height: 40 }} />
      <Skeleton style={{ width: 200, height: 22 }} />
      <div className={styles.duel}>
        <div className={`${styles.cote} pdj-skel-carte`} style={{ gap: 10 }}>
          <Skeleton className="pdj-skel-bloc" style={{ aspectRatio: "16 / 9", margin: "-14px -14px 2px", width: "calc(100% + 28px)", borderRadius: 0 }} />
          <Skeleton style={{ width: 90, height: 24, borderRadius: 999 }} />
          <Skeleton style={{ width: "70%", height: 22 }} />
          <Skeleton style={{ width: "50%", height: 12 }} />
          <Skeleton style={{ width: "100%", height: 48 }} />
        </div>
        <Skeleton className={styles.contre} style={{ borderRadius: 999 }} />
        <div className={`${styles.cote} pdj-skel-carte`} style={{ gap: 10 }}>
          <Skeleton className="pdj-skel-bloc" style={{ aspectRatio: "16 / 9", margin: "-14px -14px 2px", width: "calc(100% + 28px)", borderRadius: 0 }} />
          <Skeleton style={{ width: 90, height: 24, borderRadius: 999 }} />
          <Skeleton style={{ width: "60%", height: 22 }} />
          <Skeleton style={{ width: "45%", height: 12 }} />
          <Skeleton style={{ width: "100%", height: 48 }} />
        </div>
      </div>
      <div className={styles.liste}>
        {[85, 70, 78].map((w, i) => (
          <div key={i} className={`${styles.ligneDuel} pdj-skel-carte`} style={{ gap: 6 }}>
            <Skeleton style={{ width: 80, height: 11 }} />
            <Skeleton style={{ width: `${w}%`, height: 16 }} />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
