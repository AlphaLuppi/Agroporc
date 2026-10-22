import { describe, it, expect } from "vitest";
import { dureeGif, dureeLecture, DUREE_CHAT_DEFAUT_MS, DUREE_CHAT_MAX_MS } from "./fond-chat";

/** Gif minimal : table globale de 2 couleurs, une image 1 × 1 par délai (en centièmes). */
function gif(delais: number[], { tableLocale = false } = {}): Uint8Array {
  const o: number[] = [...Array.from("GIF89a", (c) => c.charCodeAt(0)), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
  // Extension d'application (boucle) : à sauter sans la compter.
  o.push(0x21, 0xff, 11, ...Array.from("NETSCAPE2.0", (c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  for (const d of delais) {
    o.push(0x21, 0xf9, 4, 0, d & 0xff, d >> 8, 0, 0);
    o.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, tableLocale ? 0x80 : 0);
    if (tableLocale) o.push(0, 0, 0, 255, 255, 255);
    o.push(2, 2, 0x44, 0x01, 0);
  }
  o.push(0x3b);
  return new Uint8Array(o);
}

describe("dureeGif", () => {
  it("additionne les délais des images (centièmes → ms)", () => {
    expect(dureeGif(gif([3, 4, 300]))).toBe(3070);
    expect(dureeGif(gif([5, 5], { tableLocale: true }))).toBe(100);
  });

  it("compte un délai de 0 ou 1 centième pour 10, comme les navigateurs", () => {
    expect(dureeGif(gif([0, 1, 2]))).toBe(220);
  });

  it("refuse ce qui n'est pas un gif ou n'a aucune image", () => {
    expect(dureeGif(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(dureeGif(gif([]))).toBeNull();
    expect(dureeGif(new Uint8Array(3))).toBeNull();
  });

  it("garde les images complètes d'un fichier tronqué", () => {
    const g = gif([10, 10, 10]);
    expect(dureeGif(g.subarray(0, g.length - 10))).toBe(200);
  });
});

describe("dureeLecture", () => {
  it("retombe sur la durée par défaut et plafonne", () => {
    expect(dureeLecture(null)).toBe(DUREE_CHAT_DEFAUT_MS);
    expect(dureeLecture(0)).toBe(DUREE_CHAT_DEFAUT_MS);
    expect(dureeLecture(4200)).toBe(4200);
    expect(dureeLecture(10 ** 7)).toBe(DUREE_CHAT_MAX_MS);
  });
});
