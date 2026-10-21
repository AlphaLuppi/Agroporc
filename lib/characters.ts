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

/** Repère visuel d'un personnage IA créé ou modifié depuis /ia (table `ia_profiles`). */
export interface AvatarIa {
  image?: string;
  couleur?: string;
  emoji?: string;
}

/** Prénom → repère, tel qu'il signe ses commentaires ; seuls les champs renseignés sont gardés. */
export function avatarsDesProfils(
  profils: { prenom: string; avatar_url?: string; couleur?: string; emoji?: string }[]
): Record<string, AvatarIa> {
  const avatars: Record<string, AvatarIa> = {};
  for (const p of profils) {
    const avatar: AvatarIa = {};
    if (p.avatar_url?.trim()) avatar.image = p.avatar_url.trim();
    if (p.couleur?.trim()) avatar.couleur = p.couleur.trim();
    if (p.emoji?.trim()) avatar.emoji = p.emoji.trim();
    if (Object.keys(avatar).length > 0) avatars[p.prenom] = avatar;
  }
  return avatars;
}

/**
 * Avatar d'un auteur de commentaire : le profil en base l'emporte (comme sur /ia),
 * sinon la liste statique, sinon gris + initiale.
 */
export function avatarAuteur(
  auteur: string,
  avatarsIa?: Record<string, AvatarIa>
): { image?: string; couleur: string; emoji: string } {
  const ia = avatarsIa?.[auteur];
  return {
    image: ia?.image || AVATAR_IMAGE[auteur],
    couleur: ia?.couleur || AVATAR_COLORS[auteur] || "#6b7280",
    emoji: ia?.emoji || AVATAR_EMOJI[auteur] || auteur.charAt(0),
  };
}
