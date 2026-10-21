import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";

/** Idées en chargement : titre, formulaire, liste d'idées avec votes. */
export default function Chargement() {
  return (
    <SkeletonPage label="Chargement des idées…" className="space-y-6">
      <div className="flex flex-col gap-2">
        <Skeleton style={{ width: "min(320px, 80%)", height: 32 }} />
        <Skeleton style={{ width: "min(300px, 70%)", height: 14 }} />
      </div>
      <Skeleton className="pdj-skel-carte" style={{ height: 120, borderRadius: 12 }} />
      <div className="space-y-3">
        {[82, 64, 74, 58].map((w, i) => (
          <div key={i} className="pdj-skel-carte rounded-xl p-4 flex gap-3">
            <Skeleton style={{ width: 40, height: 48, flex: "none" }} />
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Skeleton style={{ width: 20, height: 20, borderRadius: 999 }} />
                <Skeleton style={{ width: 90, height: 11 }} />
              </div>
              <Skeleton style={{ width: `${w}%`, height: 15 }} />
              <Skeleton style={{ width: `${w - 20}%`, height: 12 }} />
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
