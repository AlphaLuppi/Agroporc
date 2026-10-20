import { describe, expect, it } from "vitest";
import vecteurs from "./plat-image-vecteurs.json";
import type { PdjEntry } from "./db";
import { baseClePlatImage, CLE_IMAGE_RE, creditFournisseur, imageDuPlat, normPlatImage, paramVersion, srcPlatImage, typeImage, versionDepuisParam } from "./plat-image";
import { clePlatImage, clesSemaine, imagesDeSemaine } from "./plat-image-cle";

describe("clé d'image : concordance avec le pipeline Python (vecteurs partagés)", () => {
  it.each(vecteurs.vecteurs.map((v) => [v.restaurant, v.plat, v.base, v.cle]))(
    "%s | %s",
    (restaurant, plat, base, cle) => {
      expect(baseClePlatImage(restaurant, plat)).toBe(base);
      expect(clePlatImage(restaurant, plat)).toBe(cle);
      expect(cle).toMatch(CLE_IMAGE_RE);
    },
  );
});

describe("normPlatImage", () => {
  it("ignore accents, casse, ponctuation et espaces multiples", () => {
    expect(normPlatImage("  Rôti   de DINDE, sauce gribiche. ")).toBe("roti de dinde sauce gribiche");
  });
  it("décompose les ligatures que NFKD laisse", () => {
    expect(normPlatImage("Œuf cocotte & bœuf")).toBe("oeuf cocotte boeuf");
  });
  it("l'apostrophe typographique ou droite donne la même base", () => {
    expect(baseClePlatImage("Basilic n'Go", "x")).toBe(baseClePlatImage("Basilic n’Go", "x"));
  });
});

const semaine: PdjEntry[] = [
  {
    date: "2026-10-19",
    plats: [
      { restaurant: "Le Truck Muche", plat: "POKE BOWL", prix: "12€" },
      { restaurant: "Dubble", plat: ["Hot Bowl", "Hot Bowl Végé"], prix: "10,90€", options: [{ plat: "Hot Bowl" }, { plat: "Hot Bowl Végé" }] },
      { restaurant: "La Pause Gourmande", plat: "Coming soon", prix: "", coming_soon: true },
    ],
  },
  { date: "2026-10-20", plats: [{ restaurant: "Le Truck Muche", plat: "Poke bowl.", prix: "12€" }] },
];

describe("clesSemaine / imagesDeSemaine", () => {
  it("une clé par variante, sans coming soon, dédoublonnée sur la semaine", () => {
    const cles = clesSemaine(semaine);
    expect([...cles.keys()]).toEqual(["le truck muche|poke bowl", "dubble|hot bowl", "dubble|hot bowl vege"]);
    expect(cles.get("dubble|hot bowl")).toBe(clePlatImage("Dubble", "Hot Bowl"));
  });
  it("ne garde que les images existantes, URL versionnée", () => {
    const cles = clesSemaine(semaine);
    const cle = clePlatImage("Dubble", "Hot Bowl Végé");
    const autre = clePlatImage("Dubble", "Hot Bowl");
    const images = imagesDeSemaine(cles, new Map([
      [cle, { creeLe: "2026-10-20T08:00:00.000Z", fournisseur: "pollinations" }],
    ]));
    expect(Object.keys(images)).toEqual(["dubble|hot bowl vege"]);
    expect(imageDuPlat(images, "Dubble", "HOT BOWL VÉGÉ")).toEqual({
      src: srcPlatImage(cle, "2026-10-20T08:00:00.000Z"),
      credit: "pollinations.ai",
    });
    const sansCredit = imagesDeSemaine(cles, new Map([[autre, { creeLe: "2026-10-20T08:00:00.000Z", fournisseur: "cloudflare" }]]));
    expect(imageDuPlat(sansCredit, "Dubble", "Hot Bowl")).toEqual({ src: srcPlatImage(autre, "2026-10-20T08:00:00.000Z") });
    expect(imageDuPlat(images, "Dubble", "Hot Bowl")).toBeUndefined();
    expect(imageDuPlat(undefined, "Dubble", "Hot Bowl")).toBeUndefined();
  });
});

describe("version d'URL", () => {
  it("versionDepuisParam inverse srcPlatImage, refuse le reste", () => {
    const ms = Date.parse("2026-10-20T08:00:00.123Z");
    const v = new URL(srcPlatImage("a".repeat(24), new Date(ms)), "http://x").searchParams.get("v");
    expect(v).toBe(paramVersion(ms));
    expect(versionDepuisParam(v)).toBe(ms);
    expect(versionDepuisParam(null)).toBeNull();
    expect(versionDepuisParam("ABC")).toBeNull();
    expect(versionDepuisParam("z".repeat(20))).toBeNull();
  });
  it("crédit seulement pour Pollinations", () => {
    expect(creditFournisseur("pollinations")).toBe("pollinations.ai");
    expect(creditFournisseur("cloudflare")).toBeUndefined();
    expect(creditFournisseur(null)).toBeUndefined();
  });
});

describe("srcPlatImage", () => {
  it("ajoute ?v= quand la date est valide", () => {
    expect(srcPlatImage("a".repeat(24), "2026-10-20T08:00:00Z")).toMatch(/^\/api\/plat-image\/a{24}\?v=[0-9a-z]+$/);
    expect(srcPlatImage("a".repeat(24), "nimporte")).toBe(`/api/plat-image/${"a".repeat(24)}`);
  });
});

describe("typeImage", () => {
  const avec = (...o: number[]) => new Uint8Array([...o, ...new Array(20).fill(0)]);
  it("reconnaît jpeg, png, webp", () => {
    expect(typeImage(avec(0xff, 0xd8, 0xff))).toBe("image/jpeg");
    expect(typeImage(avec(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(typeImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });
  it("refuse un JSON d'erreur ou du vide", () => {
    expect(typeImage(new TextEncoder().encode('{"error":"FREE_LIMIT"}'))).toBeNull();
    expect(typeImage(new Uint8Array())).toBeNull();
  });
});
