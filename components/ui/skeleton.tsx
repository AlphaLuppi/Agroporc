import * as React from "react"

import { cn } from "@/lib/utils"

/** Bloc de chargement neutre (styles `.pdj-skel` dans globals.css). Décoratif : masqué aux lecteurs d'écran. */
function Skeleton({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="skeleton" aria-hidden="true" className={cn("pdj-skel", className)} {...props} />
}

/** Enveloppe d'une page en chargement : annonce l'état aux lecteurs d'écran, apparaît après un court délai. */
function SkeletonPage({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("pdj-skel-zone", className)} aria-busy="true">
      <p className="sr-only" role="status">{label}</p>
      {children}
    </div>
  )
}

export { Skeleton, SkeletonPage }
