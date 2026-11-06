import { describe, expect, it } from "vitest";
import { CAMERA_DEFAUT, LIAISONS_DEFAUT, REGLAGES_DEFAUT, type StockageMinimal } from "./contrat";
import { BORNES_CAMERA, CLE_REGLAGES, ecrireReglages, lireReglages, normaliserReglages } from "./reglages";

function stockage(init: Record<string, string> = {}): StockageMinimal & { donnees: Record<string, string> } {
  const donnees = { ...init };
  return { donnees, getItem: (k) => (k in donnees ? donnees[k] : null), setItem: (k, v) => { donnees[k] = v; } };
}

describe("normaliserReglages", () => {
  it("n'importe quelle entrée donne des réglages complets", () => {
    for (const brut of [undefined, null, 3, "x", [], {}, { camera: 5 }, { touches: [] }]) {
      expect(normaliserReglages(brut)).toEqual(REGLAGES_DEFAUT());
    }
  });
  it("les défauts du contrat sont stables", () => {
    const d = normaliserReglages(REGLAGES_DEFAUT());
    expect(d).toEqual(REGLAGES_DEFAUT());
    expect(d.camera).toEqual(CAMERA_DEFAUT);
  });
  it("valeurs bornées champ par champ, le reste intact", () => {
    const r = normaliserReglages({ camera: { fov: 500, distance: 0, hauteur: "grand", angle: -99, rigidite: 0.8 }, volume: 3, zoneMorteManette: -1 });
    expect(r.camera.fov).toBe(BORNES_CAMERA.fov[1]);
    expect(r.camera.distance).toBe(BORNES_CAMERA.distance[0]);
    expect(r.camera.hauteur).toBe(CAMERA_DEFAUT.hauteur);
    expect(r.camera.angle).toBe(BORNES_CAMERA.angle[0]);
    expect(r.camera.rigidite).toBe(0.8);
    expect(r.volume).toBe(1);
    expect(r.zoneMorteManette).toBe(0);
  });
  it("NaN et Infinity ne passent pas", () => {
    const r = normaliserReglages({ camera: { fov: NaN, distance: Infinity }, volume: NaN });
    expect(r.camera.fov).toBe(CAMERA_DEFAUT.fov);
    expect(r.camera.distance).toBe(CAMERA_DEFAUT.distance);
    expect(r.volume).toBe(REGLAGES_DEFAUT().volume);
  });
  it("touches : deux au plus, sans doublon ni code absurde, défaut si vide", () => {
    const r = normaliserReglages({ touches: { saut: ["KeyJ", "KeyJ", "KeyK", "KeyL"], boost: [], klaxon: ["<script>"], accelerer: "KeyW" } });
    expect(r.touches.saut).toEqual(["KeyJ", "KeyK"]);
    expect(r.touches.boost).toEqual(LIAISONS_DEFAUT.boost);
    expect(r.touches.klaxon).toEqual(LIAISONS_DEFAUT.klaxon);
    expect(r.touches.accelerer).toEqual(LIAISONS_DEFAUT.accelerer);
  });
  it("Échap reste toujours liée à la pause", () => {
    const r = normaliserReglages({ touches: { pause: ["KeyP"] } });
    expect(r.touches.pause).toContain("Escape");
    expect(r.touches.pause.length).toBeLessThanOrEqual(2);
  });
  it("booléens : seulement de vrais booléens", () => {
    const r = normaliserReglages({ balleCamParDefaut: false, inverserTangageManette: "oui", vibrations: 0 });
    expect(r.balleCamParDefaut).toBe(false);
    expect(r.inverserTangageManette).toBe(false);
    expect(r.vibrations).toBe(true);
  });
  it("ne partage aucune référence avec les défauts du contrat", () => {
    const r = normaliserReglages({});
    r.touches.saut = ["KeyX"];
    expect(LIAISONS_DEFAUT.saut).toEqual(["Space"]);
  });
});

describe("lecture et écriture", () => {
  it("aller-retour", () => {
    const s = stockage();
    const r = { ...REGLAGES_DEFAUT(), volume: 0.3, balleCamParDefaut: false };
    r.camera = { ...r.camera, fov: 95 };
    ecrireReglages(r, s);
    expect(lireReglages(s)).toEqual(r);
    expect(s.donnees[CLE_REGLAGES]).toBeTruthy();
  });
  it("stockage absent, vide, corrompu ou qui lève : défauts, jamais d'exception", () => {
    expect(lireReglages(null)).toEqual(REGLAGES_DEFAUT());
    expect(lireReglages(stockage())).toEqual(REGLAGES_DEFAUT());
    expect(lireReglages(stockage({ [CLE_REGLAGES]: "{pas du json" }))).toEqual(REGLAGES_DEFAUT());
    const quiLeve: StockageMinimal = { getItem: () => { throw new Error("bloqué"); }, setItem: () => { throw new Error("plein"); } };
    expect(lireReglages(quiLeve)).toEqual(REGLAGES_DEFAUT());
    expect(() => ecrireReglages(REGLAGES_DEFAUT(), quiLeve)).not.toThrow();
    expect(() => ecrireReglages(REGLAGES_DEFAUT(), null)).not.toThrow();
  });
  it("une sauvegarde partielle d'une version plus ancienne est complétée", () => {
    const s = stockage({ [CLE_REGLAGES]: JSON.stringify({ volume: 0.2 }) });
    const r = lireReglages(s);
    expect(r.volume).toBe(0.2);
    expect(r.touches).toEqual(LIAISONS_DEFAUT);
  });
});
