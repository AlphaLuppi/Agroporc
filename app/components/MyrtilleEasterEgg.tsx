"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { listenForCode } from "@/lib/agroparc3d/myrtille";
import type { PartieTigre } from "./Agroparc3D";

// three.js n'est chargé qu'au premier « myrtille » : aucun coût pour les visiteurs ordinaires.
const Agroparc3D = dynamic(() => import("./Agroparc3D"), { ssr: false });

/**
 * Taper « myrtille » n'importe où sur le site ouvre la vue 3D d'Agroparc ;
 * le retaper dans la vue 3D referme et rend le site tel qu'il était.
 */
export function MyrtilleEasterEgg() {
  const [open, setOpen] = useState(false);
  // Score de la chasse au tigre : gardé ici, il survit à la fermeture de la vue (pas au rechargement).
  const [partie, setPartie] = useState<PartieTigre>({ score: 0, tigres: 0 });
  useEffect(
    () => listenForCode(() => {
      // En pleine partie dans l'arène (Agroparc3D pose `data-arene`), retaper le code ne ferme rien :
      // on ne quitte pas un match par accident, le menu pause a son bouton « Quitter l'arène ».
      if (document.querySelector('[data-arene="actif"]')) return;
      setOpen((o) => !o);
    }),
    [],
  );
  return open ? (
    <Agroparc3D
      onClose={() => setOpen(false)}
      partie={partie}
      surTigre={(c) => setPartie((p) => ({ score: p.score + c.points, tigres: p.tigres + 1 }))}
      remettreAZero={() => setPartie({ score: 0, tigres: 0 })}
    />
  ) : null;
}
