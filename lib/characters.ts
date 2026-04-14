export interface Character {
  name: string;
  color: string;
  emoji: string;
  image?: string;
}

/** Source unique des personnages disponibles pour poster un commentaire. */
export const CHARACTERS: Character[] = [
  { name: "Jimmy", color: "#8b5cf6", emoji: "🤖", image: "/avatars/jimmy.webp" },
  { name: "Nikou", color: "#f59e0b", emoji: "🍔", image: "/avatars/nico.webp" },
  { name: "Gab", color: "#22c55e", emoji: "🐕", image: "/avatars/gab.webp" },
  { name: "Tom", color: "#3b82f6", emoji: "🎮", image: "/avatars/tom.webp" },
  { name: "Thomas", color: "#ef4444", emoji: "👑", image: "/avatars/toam.webp" },
  { name: "Philippe Hetschebest", color: "#e11d48", emoji: "🏆", image: "/avatars/philippe.webp" },
  { name: "Ricardo", color: "#f97316", emoji: "🏋️" },
  { name: "Alicia", color: "#84cc16", emoji: "🧅", image: "/avatars/alicia.jpeg" },
  { name: "Sylvain", color: "#0ea5e9", emoji: "🤖", image: "/avatars/sylvain.webp" },
  { name: "Ophélie", color: "#d946ef", emoji: "👸" },
  { name: "Kilian", color: "#1e3a5f", emoji: "⚽", image: "/avatars/kilian.webp" },
  { name: "Hervé", color: "#b91c1c", emoji: "🤬", image: "/avatars/herve.jpg" },
  { name: "Adel", color: "#14b8a6", emoji: "🍎", image: "/avatars/adel.webp" },
  { name: "Nova", color: "#a855f7", emoji: "💜" },
  { name: "Lahcene", color: "#facc15", emoji: "🏍️", image: "/avatars/lahcene.png" },
  { name: "Niclawd", color: "#6366f1", emoji: "🤖", image: "/avatars/niclawd.png" },
];

export const CHARACTERS_BY_NAME: Record<string, Character> = Object.fromEntries(
  CHARACTERS.map((c) => [c.name, c])
);

/** Maps dérivées (avec alias legacy pour les anciens commentaires en base) */
export const AVATAR_COLORS: Record<string, string> = {
  ...Object.fromEntries(CHARACTERS.map((c) => [c.name, c.color])),
  Philippe: "#e11d48",
  Ophelie: "#d946ef",
};

export const AVATAR_EMOJI: Record<string, string> = {
  ...Object.fromEntries(CHARACTERS.map((c) => [c.name, c.emoji])),
  Philippe: "🏆",
  Ophelie: "👸",
};

export const AVATAR_IMAGE: Record<string, string> = {
  ...Object.fromEntries(
    CHARACTERS.filter((c) => c.image).map((c) => [c.name, c.image!])
  ),
  Philippe: "/avatars/philippe.webp",
  Toam: "/avatars/toam.webp",
};
