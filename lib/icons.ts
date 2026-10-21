export type RestaurantLinkKind = "order" | "facebook" | "site";

export interface RestaurantLink {
  kind: RestaurantLinkKind;
  url: string;
  label: string;
}

export const RESTAURANT_LINKS: Record<string, RestaurantLink[]> = {
  "Le Bistrot Trèfle": [
    {
      kind: "order",
      url: "https://bistrot-trefle.com/commander-emporter-livraison-gratuite-restaurant-bistrot-trefle-avignon-agroparc/",
      label: "Commander",
    },
  ],
  "La Pause Gourmande": [
    {
      kind: "order",
      url: "https://lapausegourmandeagroparc.foxorders.com",
      label: "Commander",
    },
  ],
  "Le Truck Muche": [
    {
      kind: "facebook",
      url: "https://www.facebook.com/letruckmuche/",
      label: "Facebook",
    },
  ],
  "Basilic n'Go": [
    {
      kind: "order",
      url: "https://go.obypay.com/api/cashless/hws/4o2y",
      label: "Commander",
    },
  ],
  "Dubble": [
    {
      kind: "site",
      url: "https://www.dubble-food.com/restaurants/avignon-agroparc",
      label: "Site",
    },
  ],
  "La Mijote": [
    {
      kind: "site",
      url: "https://la-mijote-avignon.fr/menu.html",
      label: "Menu",
    },
  ],
  "Vival": [
    {
      kind: "site",
      url: "https://magasins.vival.fr/fr/vival-montfavet",
      label: "Site",
    },
    {
      kind: "site",
      url: "https://www.picadeli.com/fr/barasalades/",
      label: "Picadeli",
    },
  ],
};

export function getRestaurantLinks(restaurant: string): RestaurantLink[] {
  return RESTAURANT_LINKS[restaurant] || [];
}
