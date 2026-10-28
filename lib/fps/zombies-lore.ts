/**
 * Lore « Opération Plat du Jour » du mode zombies v7 (PUR : textes et objectifs, sans DOM). Huit notes à lire avec E (mails internes,
 * post-it, rapports) dispersées dans les zones, texte d'introduction, objectif courant déduit de l'état de la partie.
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (« Lore « Opération Plat du Jour » et objectifs »)
 */
import type { EtatPartieZombies } from "./protocole";

export interface NoteLore { id: number; titre: string; auteur: string; texte: string }

export const INTRO_ZOMBIES = {
  lieu: "AGROPARC — Pôle R&D",
  heure: "11 h 58",
  texte: "Le plat du jour devait être parfait. Les tigres l'ont goûté. Ils ont encore faim.",
} as const;

export const NOTES_LORE: readonly NoteLore[] = [
  {
    id: 1, titre: "Post-it jaune, écran 4", auteur: "— Kévin, stagiaire",
    texte: "Ils ont fermé les portes de l'open space « pour notre sécurité ». Le bruit derrière les fenêtres, ce n'est PAS la clim. " +
      "Si quelqu'un lit ça : les planches tiennent si on les remet. Les tigres détestent les planches.",
  },
  {
    id: 2, titre: "Mail interne — Objet : Pause Café", auteur: "De : Services généraux",
    texte: "Rappel : la machine Pause Café de la salle de pause reste branchée sur la batterie de secours. Une gorgée et vous vous " +
      "relevez plus vite. Les autres distributeurs attendent le disjoncteur général, au Local technique (cour Est).",
  },
  {
    id: 3, titre: "Rapport d'incident n° 117", auteur: "Sécurité Agroparc",
    texte: "11 h 41 : un tigre est sorti de l'écran d'accueil du site des plats du jour. 11 h 43 : trois. 11 h 50 : on a arrêté de " +
      "compter. Ils remontent du gazon de la cour. Ils sentent la note Goulaf de loin.",
  },
  {
    id: 4, titre: "Carnet du chef, page arrachée", auteur: "— Le chef du Bistrot Trèfle",
    texte: "La Recette ultime : sel de Guérande (ici), herbes du Trèfle (jardinière de la cour Ouest), truffe noire (congélateur du " +
      "labo, il faut du courant). Trente secondes au four. Ce qu'ils en ont fait au labo… je préfère ne pas le servir.",
  },
  {
    id: 5, titre: "Bon de livraison du Truck Muche", auteur: "Livraison n° 0666",
    texte: "Contenu : « petits plats ». Le livreur a refusé d'ouvrir l'arrière. Note du livreur : « ça griffe, ça miaule, je klaxonne et " +
      "je repars ». Quand vous entendez le klaxon, ils arrivent par paquets.",
  },
  {
    id: 6, titre: "Étiquette sur le disjoncteur", auteur: "Maintenance",
    texte: "NE PAS RÉARMER sans l'accord du Pôle R&D. Le réarmement rallume les distributeurs, le Micro-ondes Gratinator du labo et le " +
      "congélateur n° 3. (Quelqu'un a ajouté au feutre : « réarmez, bande de lâches ».)",
  },
  {
    id: 7, titre: "Mail — Objet : la caisse en bois", auteur: "De : Comptabilité",
    texte: "Une caisse en bois avec des points d'interrogation change de place toute seule. 950 € par ouverture, sans facture. " +
      "Quand elle sort la peluche de tigre, elle s'envole ailleurs. On ne la rembourse pas, elle se rembourse toute seule.",
  },
  {
    id: 8, titre: "Journal du Pôle R&D, dernière entrée", auteur: "— Dr Gratin",
    texte: "Le Micro-ondes Gratinator double tout ce qu'on y met : la puissance, le chargeur, le goût. Nous y avons mis le plat du jour. " +
      "Les tigres y ont goûté. Objectif Goulaf 10/10 atteint. Que Dieu nous pardonne. Le four de la cuisine peut tout réparer, ou tout empirer.",
  },
];

export const noteLore = (id: number): NoteLore | null => NOTES_LORE.find((n) => n.id === id) ?? null;

/** Objectif affiché au joueur, déduit de l'avancement de la partie (portes, courant, Pack-a-Punch, recette). */
export function objectifZombies(e: Pick<EtatPartieZombies, "portes" | "courant" | "quete" | "pap">, papUtilise = false): string {
  const ouverte = (id: string) => e.portes.some((p) => p.id === id && p.ouverte);
  if (!ouverte("D1") && !ouverte("D2")) return "Sortir de l'open space";
  if (!e.courant) return ouverte("D8") ? "Réarmer le disjoncteur du Local technique" : "Trouver le Local technique (cour Est)";
  if (!papUtilise) return ouverte("D9") ? "Gratiner une arme au Micro-ondes du Labo" : "Atteindre le Labo R&D (cour Ouest)";
  if (!e.quete.faite) {
    if (e.quete.cuissonFinT) return "Tenir pendant la cuisson de la Recette ultime";
    if (e.quete.ingredients.length < 3) return `Réunir les ingrédients de la Recette ultime (${e.quete.ingredients.length} / 3)`;
    return "Cuisiner la Recette ultime au four de la Cuisine";
  }
  return "Survivre";
}
