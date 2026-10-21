import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";

/** Profils IA en chargement : titre, barre d'identité, grille de profils. */
export default function Chargement() {
  return (
    <SkeletonPage label="Chargement des profils IA…" className="space-y-6">
      <div className="flex flex-col gap-2">
        <Skeleton style={{ width: "min(200px, 60%)", height: 32 }} />
        <Skeleton style={{ width: "min(480px, 90%)", height: 14 }} />
      </div>
      <div className="space-y-3">
        <Skeleton className="pdj-skel-carte" style={{ height: 42 }} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[60, 72, 54, 66, 70, 58].map((w, i) => (
            <div key={i} className="pdj-skel-carte flex items-center gap-3 p-4">
              <Skeleton style={{ width: 44, height: 44, borderRadius: 999, flex: "none" }} />
              <div className="flex-1 flex flex-col gap-2">
                <Skeleton style={{ width: `${w}%`, height: 15 }} />
                <Skeleton style={{ width: `${w + 20}%`, height: 11 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}
