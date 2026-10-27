import { STATS, nomArme, type CategorieArme } from "@/lib/fps/armes";
import { ARMES, type ArmeFeuId, type ArmeId, type CauseMort } from "@/lib/fps/protocole";

/**
 * Texte et barres de stats des armes pour les cartes du lobby, l'écran de mort et le HUD. TOUT est dérivé de `STATS`
 * (lib/fps/armes.ts) : ajouter une arme là-bas suffit, aucune constante magique ici (barres normalisées sur le MAX du catalogue).
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§4)
 */
export interface InfoArme {
  id: ArmeFeuId;
  nom: string;
  /** libellé court pour le HUD (≤ 10 caractères), jamais tronqué */
  nomCourt: string;
  categorie: CategorieArme;
  description: string;
  /** 0..1, relatif au maximum du catalogue */
  barres: { degats: number; cadence: number; portee: number; controle: number };
}

const borne = (x: number) => Math.min(1, Math.max(0, x));

/** Dégâts d'un tir réaliste : pour une arme à plombs, la majorité des plombs touche. */
const degatsParTir = (id: ArmeFeuId) => {
  const a = STATS[id];
  return a.degats * (a.plombs > 1 ? Math.floor(a.plombs / 2) + 1 : 1);
};

/** Maxima du catalogue : les barres s'y rapportent (pas de constante magique). */
const MAX = {
  degats: Math.max(...ARMES.map(degatsParTir)),
  cadence: Math.max(...ARMES.map((id) => 1 / STATS[id].cadenceS)),
  portee: Math.max(...ARMES.map((id) => STATS[id].portee)),
  recul: Math.max(...ARMES.map((id) => STATS[id].recul.tangage)),
};

function calculer(id: ArmeFeuId): InfoArme {
  const a = STATS[id];
  return {
    id,
    nom: a.nom,
    nomCourt: a.nomCourt,
    categorie: a.categorie,
    description: a.description,
    barres: {
      degats: borne(degatsParTir(id) / MAX.degats),
      cadence: borne(1 / a.cadenceS / MAX.cadence),
      portee: borne(Math.sqrt(a.portee / MAX.portee)),
      // plus de dispersion (v2 §13.1) : la maîtrise de l'arme tient à son recul
      controle: borne(1 - a.recul.tangage / MAX.recul),
    },
  };
}

export const INFOS_ARMES = Object.fromEntries(ARMES.map((id) => [id, calculer(id)])) as Record<ArmeFeuId, InfoArme>;

/** Armes d'une catégorie, dans l'ordre du catalogue (principales : mitraillette, pompe, sniper…). */
export function armesParCategorie(cat: CategorieArme): InfoArme[] {
  return ARMES.filter((id) => STATS[id].categorie === cat).map((id) => INFOS_ARMES[id]);
}

export const LIBELLES_BARRES: { cle: keyof InfoArme["barres"]; nom: string }[] = [
  { cle: "degats", nom: "Dégâts" },
  { cle: "cadence", nom: "Cadence" },
  { cle: "portee", nom: "Portée" },
  { cle: "controle", nom: "Contrôle" },
];

/**
 * Libellé d'une élimination : le nom de l'arme (« Pistolet », « Couteau ») pour la cause "arme", sinon la cause en toutes
 * lettres (« Écrasé par la circulation », « Renversé par <pseudo> », « Tigre de <pseudo> », « Tué par le tigre »). `par` = pseudo du
 * tueur (vide pour la circulation et le tigre sauvage).
 */
export function libelleCause(arme: ArmeId, cause: CauseMort, par: string): string {
  if (cause === "ecrase_pnj") return "Écrasé par la circulation";
  if (cause === "ecrase_vehicule") return par ? `Renversé par ${par}` : "Renversé";
  if (cause === "tigre") return par ? `Tigre de ${par}` : "Tué par le tigre";
  if (cause === "explosion") return par ? `Explosé par ${par}` : "Explosion de voiture";
  if (cause === "truck_fou") return "Écrasé par le Truck Muche fou";
  if (cause === "tigre_robot") return "Déchiqueté par le tigre robot";
  if (cause === "titan") return par ? `Titan tigre de ${par}` : "Titan tigre";
  if (cause === "bus_c3") return "Écrasé par le Bus C3";
  if (cause === "frappe_aerienne") return par ? `Frappe aérienne de ${par}` : "Frappe aérienne";
  return nomArme(arme);
}
