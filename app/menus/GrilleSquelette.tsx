import { Skeleton } from "@/components/ui/skeleton";
import styles from "./menus.module.css";

/** Vue Jour en chargement : la reco en grand puis les tuiles (même grille que JourVue). */
export default function GrilleSquelette() {
  return (
    <div className={styles.grille} aria-hidden="true">
      <div className={styles.hero} style={{ cursor: "default", minHeight: 150, background: "var(--surface)", borderColor: "var(--border)" }}>
        <Skeleton style={{ width: 56, height: 56, flex: "none" }} />
        <div className="flex flex-col gap-2.5 flex-1 self-stretch">
          <Skeleton style={{ width: 70, height: 14 }} />
          <Skeleton style={{ width: "85%", height: 22 }} />
          <Skeleton style={{ width: "60%", height: 14 }} />
          <Skeleton style={{ width: "92%", height: 12 }} />
          <Skeleton style={{ width: "75%", height: 12 }} />
        </div>
      </div>
      {[78, 64, 88, 70, 58, 82].map((w, i) => (
        <div key={i} className={`${styles.tuile} pdj-skel-carte`} style={{ cursor: "default", minHeight: 104 }}>
          <div className={styles.tuileHaut}>
            <Skeleton style={{ width: 40, height: 22 }} />
            <Skeleton style={{ width: "45%", height: 10 }} />
          </div>
          <Skeleton style={{ width: `${w}%`, height: 14 }} />
          <Skeleton style={{ width: `${w - 25}%`, height: 14 }} />
          <Skeleton style={{ width: 52, height: 11, marginTop: "auto" }} />
        </div>
      ))}
    </div>
  );
}
