"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { listenForCode } from "@/lib/agroparc3d/myrtille";

// three.js n'est chargé qu'au premier « myrtille » : aucun coût pour les visiteurs ordinaires.
const Agroparc3D = dynamic(() => import("./Agroparc3D"), { ssr: false });

/**
 * Taper « myrtille » n'importe où sur le site ouvre la vue 3D d'Agroparc ;
 * le retaper dans la vue 3D referme et rend le site tel qu'il était.
 */
export function MyrtilleEasterEgg() {
  const [open, setOpen] = useState(false);
  useEffect(() => listenForCode(() => setOpen((o) => !o)), []);
  return open ? <Agroparc3D /> : null;
}
