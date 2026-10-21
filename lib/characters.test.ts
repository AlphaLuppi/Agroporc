import { describe, expect, it } from "vitest";
import { avatarAuteur, avatarsDesProfils } from "./characters";

describe("avatarsDesProfils", () => {
  it("indexe par prénom et ignore les champs vides", () => {
    const avatars = avatarsDesProfils([
      { prenom: "Johnny", avatar_url: " https://exemple.fr/johnny.jpg ", couleur: "#ff8647", emoji: "" },
      { prenom: "Tom", couleur: "", emoji: "" },
    ]);
    expect(avatars).toEqual({ Johnny: { image: "https://exemple.fr/johnny.jpg", couleur: "#ff8647" } });
  });
});

describe("avatarAuteur", () => {
  it("prend la photo du profil en base pour un personnage créé depuis /ia", () => {
    const avatars = avatarsDesProfils([{ prenom: "Rosso", avatar_url: "/api/images/12.webp", couleur: "#ff4013" }]);
    expect(avatarAuteur("Rosso", avatars)).toEqual({ image: "/api/images/12.webp", couleur: "#ff4013", emoji: "R" });
  });

  it("garde la liste statique quand le profil n'a pas de photo", () => {
    const avatars = avatarsDesProfils([{ prenom: "Tom", couleur: "#3b82f6", emoji: "🎮" }]);
    expect(avatarAuteur("Tom", avatars).image).toBe("/avatars/tom.webp");
  });

  it("la photo du profil en base remplace la photo statique", () => {
    const avatars = avatarsDesProfils([{ prenom: "Tom", avatar_url: "/api/images/3.png" }]);
    expect(avatarAuteur("Tom", avatars).image).toBe("/api/images/3.png");
  });

  it("retombe sur gris + initiale pour un auteur inconnu", () => {
    expect(avatarAuteur("Zoé")).toEqual({ image: undefined, couleur: "#6b7280", emoji: "Z" });
  });
});
