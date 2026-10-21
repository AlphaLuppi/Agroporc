import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";
import styles from "./quiz.module.css";

const COLONNES = [2, 2, 6, 5, 3, 3];

/** Quiz en chargement : une question et ses choix sur mobile, l'arbre en colonnes + résultats au-delà de 1000 px. */
export default function Chargement() {
  return (
    <SkeletonPage label="Chargement du quiz…" className={styles.root}>
      <div className="flex flex-col gap-2">
        <Skeleton style={{ width: "min(260px, 70%)", height: 30 }} />
        <Skeleton style={{ width: "min(420px, 90%)", height: 14 }} />
      </div>
      <div className="flex flex-col gap-3.5 min-[1000px]:hidden">
        <Skeleton style={{ width: "100%", height: 6, borderRadius: 999 }} />
        <Skeleton style={{ width: "min(340px, 80%)", height: 24 }} />
        <div className={styles.choix}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="pdj-skel-carte" style={{ height: 64 }} />
          ))}
        </div>
      </div>
      <div className="hidden min-[1000px]:flex gap-3.5 items-start">
        {COLONNES.map((n, c) => (
          <div key={c} className="flex flex-col gap-2 flex-1 min-w-0">
            <Skeleton style={{ width: "50%", height: 10, marginBottom: 6 }} />
            {Array.from({ length: n }, (_, i) => (
              <Skeleton key={i} className="pdj-skel-carte" style={{ height: i % 3 === 1 ? 48 : 32 }} />
            ))}
          </div>
        ))}
        <div className="pdj-skel-carte flex flex-col gap-4 p-4" style={{ width: 300, flex: "none" }}>
          <Skeleton style={{ width: "45%", height: 11 }} />
          {[90, 75, 85, 60].map((w, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton style={{ width: 38, height: 38, flex: "none" }} />
              <div className="flex flex-col gap-2 flex-1">
                <Skeleton style={{ width: `${w}%`, height: 13 }} />
                <Skeleton style={{ width: "55%", height: 11 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}
