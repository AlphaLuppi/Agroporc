import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";

/** Photos en chargement : titre puis grille de vignettes. */
export default function Chargement() {
  return (
    <SkeletonPage label="Chargement des photos…" className="space-y-6">
      <Skeleton style={{ width: "min(220px, 60%)", height: 30 }} />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="pdj-skel-carte overflow-hidden flex flex-col">
            <Skeleton className="pdj-skel-bloc" style={{ aspectRatio: "4 / 3", borderRadius: 0 }} />
            <div className="p-3 flex flex-col gap-2">
              <Skeleton style={{ width: "80%", height: 13 }} />
              <Skeleton style={{ width: "50%", height: 11 }} />
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
