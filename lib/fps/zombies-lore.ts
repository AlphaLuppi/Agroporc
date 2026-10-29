/**
 * Lore « Opération Plat du Jour » du mode zombies v7 (PUR : textes et objectifs, sans DOM). Huit notes à lire avec E (mails internes,
 * post-it, rapports) dispersées dans les zones, texte d'introduction, objectif courant déduit de l'état de la partie. (v8) Les notes restent du
 * lore : quelques phrases y font allusion au grand secret (zombies-secret.ts), sans lieu, ni nombre, ni ordre.
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
      "Les planches tiennent si on les remet. PS : ne décollez pas mes post-it. Le local technique me les dicte toute la nuit, " +
      "et il ne se trompe jamais d'ordre.",
  },
  {
    id: 2, titre: "Mail interne — Objet : Pause Café", auteur: "De : Services généraux",
    texte: "Rappel : la machine Pause Café de la salle de pause reste branchée sur la batterie de secours. Une gorgée et vous vous " +
      "relevez plus vite. Les autres distributeurs attendent le disjoncteur général, au Local technique (cour Est).",
  },
  {
    id: 3, titre: "Rapport d'incident n° 117", auteur: "Sécurité Agroparc",
    texte: "11 h 41 : un tigre est sorti de l'écran d'accueil du site des plats du jour. 11 h 43 : trois. 11 h 50 : on a arrêté de " +
      "compter. 11 h 58 : toutes les pendules du Pôle se sont arrêtées en même temps, et personne n'a pensé à les remonter.",
  },
  {
    id: 4, titre: "Carnet du chef, page arrachée", auteur: "— Le chef du Bistrot Trèfle",
    texte: "Mon menu ne s'écrit que sur l'ardoise, et ma batterie de cuivre le chante, pourvu qu'on la fasse sonner dans l'ordre. " +
      "Le fumet ne monte que quand le Truck livre. Ensuite le froid, ensuite le feu. Ce qu'ils en ont fait au labo… je préfère ne pas le servir.",
  },
  {
    id: 5, titre: "Bon de livraison du Truck Muche", auteur: "Livraison n° 0666",
    texte: "Contenu : « petits plats ». Le livreur a refusé d'ouvrir l'arrière. Note du livreur : « ça griffe, ça miaule, je klaxonne et " +
      "je repars ». Au dos, d'une autre main : « à la troisième livraison, le chef sera servi. Qu'il ne reparte pas. »",
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
    texte: "Le Micro-ondes Gratinator double tout ce qu'on y met : la puissance, le chargeur, le goût. Il ne se trompe qu'à une heure, " +
      "celle que l'ampoule lui répète. Les tigres y ont goûté. Le four de la cuisine peut tout réparer, ou tout empirer. Le hachoir du chef, lui, " +
      "a encore faim.",
  },
];

export const noteLore = (id: number): NoteLore | null => NOTES_LORE.find((n) => n.id === id) ?? null;

/**
 * Objectif affiché au joueur, déduit de l'avancement de la partie (portes, courant, Pack-a-Punch) : la progression ordinaire seulement. Le grand
 * secret (v8, zombies-secret.ts) n'apparaît JAMAIS ici : une fois l'arme gratinée, il ne reste que « Survivre ».
 */
export function objectifZombies(e: Pick<EtatPartieZombies, "portes" | "courant" | "pap">, papUtilise = false): string {
  const ouverte = (id: string) => e.portes.some((p) => p.id === id && p.ouverte);
  if (!ouverte("D1") && !ouverte("D2")) return "Sortir de l'open space";
  if (!e.courant) return ouverte("D8") ? "Réarmer le disjoncteur du Local technique" : "Trouver le Local technique (cour Est)";
  if (!papUtilise) return ouverte("D9") ? "Gratiner une arme au Micro-ondes du Labo" : "Atteindre le Labo R&D (cour Ouest)";
  return "Survivre";
}
