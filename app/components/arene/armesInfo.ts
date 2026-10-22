import { STATS } from "@/lib/fps/armes";
import type { ArmeId } from "@/lib/fps/protocole";

/** Texte et barres de stats d'une arme pour les cartes du lobby et de l'écran de mort. */
export interface InfoArme {
  id: ArmeId;
  nom: string;
  description: string;
  /** 0..1 */
  barres: { degats: number; cadence: number; portee: number; precision: number };
}

const DESCRIPTIONS: Record<ArmeId, string> = {
  pistolet: "Précis et polyvalent. Une balle à la tête fait 56.",
  mitraillette: "Cadence folle. La dispersion monte quand on arrose.",
  pompe: "Dévastateur de près, presque inoffensif au-delà de 30 m.",
  sniper: "Un tir à la tête tue, au corps 95. Lunette au clic droit.",
};

const borne = (x: number) => Math.min(1, Math.max(0, x));

function calculer(id: ArmeId): InfoArme {
  const a = STATS[id];
  // dégâts d'un tir réaliste : pour la pompe, 5 plombs sur 9 touchent
  const parTir = a.degats * (a.plombs > 1 ? 5 : 1);
  return {
    id,
    nom: a.nom,
    description: DESCRIPTIONS[id],
    barres: {
      degats: borne(parTir / 100),
      cadence: borne(1 / a.cadenceS / (1 / 0.075)),
      portee: borne(Math.sqrt(a.portee / 400)),
      precision: borne(1 - a.dispersion.base / 0.1),
    },
  };
}

export const INFOS_ARMES: Record<ArmeId, InfoArme> = {
  pistolet: calculer("pistolet"),
  mitraillette: calculer("mitraillette"),
  pompe: calculer("pompe"),
  sniper: calculer("sniper"),
};

export const LIBELLES_BARRES: { cle: keyof InfoArme["barres"]; nom: string }[] = [
  { cle: "degats", nom: "Dégâts" },
  { cle: "cadence", nom: "Cadence" },
  { cle: "portee", nom: "Portée" },
  { cle: "precision", nom: "Précision" },
];
