import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";
import GrilleSquelette from "./menus/GrilleSquelette";
import styles from "./menus/menus.module.css";

/** Accueil en chargement : même gabarit que la vue Jour (onglets, titre, jours + mode, reco puis tuiles). */
export default function Chargement() {
  return (
    <SkeletonPage label="Chargement des plats du jour…" className={styles.root}>
      <Skeleton className="pdj-skel-carte self-start" style={{ width: "min(360px, 100%)", height: 42 }} />
      <div className={styles.titre}>
        <Skeleton style={{ width: "min(220px, 55%)", height: 28 }} />
        <div className="flex gap-1.5">
          <Skeleton style={{ width: 32, height: 32 }} />
          <Skeleton style={{ width: 32, height: 32 }} />
        </div>
      </div>
      <div className={styles.dock}>
        <Skeleton className="pdj-skel-carte flex-1" style={{ height: 52 }} />
        <Skeleton style={{ width: 88, height: 40, borderRadius: 999 }} />
      </div>
      <GrilleSquelette />
    </SkeletonPage>
  );
}
