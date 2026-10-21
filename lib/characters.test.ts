import { describe, expect, it } from "vitest";
import { avatarAuteur, avatarsDesProfils, nomPersonnage, texteSur } from "./characters";

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

  it("retrouve le personnage quelle que soit la casse de l'auteur", () => {
    expect(nomPersonnage("NOVA")).toBe("Nova");
    expect(avatarAuteur("NOVA")).toEqual(avatarAuteur("Nova", undefined));
    expect(avatarAuteur("NOVA").couleur).toBe("#a855f7");
  });

  it("retombe sur gris + initiale pour un auteur inconnu", () => {
    expect(avatarAuteur("Zoé")).toEqual({ image: undefined, couleur: "#6b7280", emoji: "Z" });
  });
});

describe("texteSur", () => {
  it("choisit le noir sur une couleur claire, le blanc sur une couleur sombre", () => {
    expect(texteSur("#ff8647")).toBe("#111");
    expect(texteSur("#facc15")).toBe("#111");
    expect(texteSur("#0433ff")).toBe("#fff");
    expect(texteSur("#1e3a5f")).toBe("#fff");
  });

  it("accepte #rgb et retombe sur blanc pour un format inconnu", () => {
    expect(texteSur("#fff")).toBe("#111");
    expect(texteSur("rouge")).toBe("#fff");
  });
});
