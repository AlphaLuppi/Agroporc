export const RESTAURANT_ICON: Record<string, string> = {
  "Le Bistrot Trèfle":
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C8 2 4 6 4 10c0 2.5 1.5 4.5 3.5 5.5L12 22l4.5-6.5C18.5 14.5 20 12.5 20 10c0-4-4-8-8-8z"/><circle cx="12" cy="10" r="2"/></svg>',
  "La Pause Gourmande":
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/></svg>',
  "Le Truck Muche":
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 13.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>',
  "Basilic n'Go":
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>',
  "Dubble":
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h18a9 9 0 0 1-18 0Z"/><path d="M7 20h10"/><path d="M12 15v5"/><path d="M8 11c0-2 1-3 2-4"/><path d="M13 11c0-2 1-3 2-4"/></svg>',
  "La Mijote":
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-5Z"/><path d="M2 11h20"/><path d="M8 11V9a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M4 14H2"/><path d="M22 14h-2"/><path d="M10 5c0-1 1-1 1-2"/><path d="M14 5c0-1 1-1 1-2"/></svg>',
};

export const DEFAULT_ICON =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>';

export function getIcon(restaurant: string): string {
  return RESTAURANT_ICON[restaurant] || DEFAULT_ICON;
}

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
};

export function getRestaurantLinks(restaurant: string): RestaurantLink[] {
  return RESTAURANT_LINKS[restaurant] || [];
}
