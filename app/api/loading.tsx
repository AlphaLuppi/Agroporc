import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";

/** Documentation API en chargement : cadre du Swagger. */
export default function Chargement() {
  return (
    <SkeletonPage label="Chargement de la documentation…">
      <Skeleton className="pdj-skel-carte" style={{ minHeight: "70vh" }} />
    </SkeletonPage>
  );
}
