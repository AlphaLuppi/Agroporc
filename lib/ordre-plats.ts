import type { Plat } from "./db";

export interface PlatIndexe {
  plat: Plat;
  /** Position dans `pdj.plats` : clé des commentaires (`platIndex`), à conserver malgré le réordonnancement. */
  index: number;
}

/**
 * Sépare les plats d'un jour en deux groupes affichés dans cet ordre : les plats notés
 * (les restos qui ont un plat du jour) puis les « coming soon ». Les cards « sans plat »
 * viennent après, côté page. L'ordre relatif d'origine est conservé dans chaque groupe.
 */
export function separerPlats(plats: Plat[]): { notes: PlatIndexe[]; comingSoon: PlatIndexe[] } {
  const indexes = plats.map((plat, index) => ({ plat, index }));
  return {
    notes: indexes.filter(({ plat }) => !plat.coming_soon),
    comingSoon: indexes.filter(({ plat }) => plat.coming_soon),
  };
}
