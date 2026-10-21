import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";

/** Admin en chargement : titre puis liste des derniers runs du pipeline. */
export default function Chargement() {
  return (
    <SkeletonPage label="Chargement de l'admin…" className="mx-auto max-w-3xl p-6 space-y-4">
      <Skeleton style={{ width: 240, height: 30 }} />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="pdj-skel-carte" style={{ height: 56 }} />
      ))}
    </SkeletonPage>
  );
}
