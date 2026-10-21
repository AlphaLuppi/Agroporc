import { describe, it, expect } from "vitest";
import { clipDepuisPistes, echantillonnerClip, dureeClip, enregistrerClip, clipNomme, oublierClips } from "./clips";
import { squelette } from "./squelette";
import type { ClipImages } from "./gestes/types";

describe("clips d'images", () => {
  // Images à 10 i/s : dy et la cible avancent de 1 par image, la tête tourne de 45° par image autour de Y.
  const clip: ClipImages = {
    nom: "test", fps: 10,
    images: [0, 1, 2, 3, 4].map((i) => ({
      corps: { dy: i }, pattes: { avG: { cible: [i, 0, 0] as const } },
      os: { tete: [0, Math.sin(i * Math.PI / 8), 0, Math.cos(i * Math.PI / 8)] as const },
    })),
  };
  it("interpole nombres, cibles et rotations entre les images", () => {
    expect(dureeClip(clip)).toBeCloseTo(0.4);
    const p = echantillonnerClip(clip, 0.15);
    expect(p.corps?.dy).toBeCloseTo(1.5, 5);
    expect(p.pattes?.avG?.cible[0]).toBeCloseTo(1.5, 5);
    const q = p.os!.tete!;
    expect(2 * Math.acos(q[3])).toBeCloseTo(1.5 * Math.PI / 4, 4);
  });
  it("hors bornes : première / dernière image, ou bouclé", () => {
    expect(echantillonnerClip(clip, -1).corps?.dy).toBe(0);
    expect(echantillonnerClip(clip, 5).corps?.dy).toBe(4);
    expect(echantillonnerClip(clip, 0.55, true).corps?.dy).toBeCloseTo(1.5, 5);
  });
  it("registre", () => {
    enregistrerClip("x", clip);
    expect(clipNomme("x")).toBe(clip);
    oublierClips();
    expect(clipNomme("x")).toBeNull();
  });
  it("conversion d'un clip three : la root motion est extraite en `avance`", () => {
    const sq = squelette();
    const t0 = sq.tRepos[sq.i.thorax];
    // Les enfants de la racine avancent ensemble de 1 m (modèle) vers +Z : en local de la racine,
    // +Z modèle = -Y local (rotation -90° autour de X) / échelle.
    const d = 1 / sq.racine.s;
    const pistes = ["thorax", "epauleG", "cou", "epauleD"].map((r) => ({
      name: `${sq.noms[sq.i[r as "thorax"]]}.position`, times: [0, 1],
      values: [t0.x, t0.y, t0.z, t0.x, t0.y - d, t0.z],
    }));
    const c = clipDepuisPistes("Attack jump", 1, pistes, sq, 10, true);
    expect(c.images[c.images.length - 1].avance).toBeCloseTo(1, 3);
    const t = c.images[c.images.length - 1].t!.thorax!;
    expect(t[1]).toBeCloseTo(t0.y, 3);
  });
});
