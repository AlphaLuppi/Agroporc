import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import scene from "../../public/agroparc/scene.json";
import type { SceneData } from "../agroparc3d/types";
import { amorcerProcedural, centresBatimentsEligibles, choisirBatimentsProcedurals, donneesBr, piecesProcedurales, proceduralPrecalcule, serialiserProceduralPrecalcule, type ProceduralPrecalcule } from "./br-carte";
import precalcule from "./br-procedural-precalcule.json";

const FICHIER = new URL("./br-procedural-precalcule.json", import.meta.url);
const sc = scene as unknown as SceneData;

// Pour régénérer le fichier (scene.json ou constantes de sélection modifiés) :
//   PDJ_REGENERER=1 npx vitest run lib/fps/br-procedural-precalcule.test.ts
if (process.env.PDJ_REGENERER) writeFileSync(FICHIER, serialiserProceduralPrecalcule(proceduralPrecalcule(sc)));

describe("bâtiments procéduraux précalculés hors ligne (aperçu de la vue Palantir)", () => {
  it("le fichier se régénère à l'octet", () => {
    expect(readFileSync(FICHIER, "utf8")).toBe(serialiserProceduralPrecalcule(proceduralPrecalcule(sc)));
  });
  it("la sélection est celle de choisirBatimentsProcedurals", () => {
    expect(precalcule.map((c) => c.i)).toEqual(choisirBatimentsProcedurals(sc));
  });
  it("une scène amorcée donne les mêmes données de carte qu'une scène calculée", () => {
    // copie superficielle : un autre objet SceneData, donc un cache `procedural` vierge
    const copie: SceneData = { ...sc };
    amorcerProcedural(copie, precalcule as readonly ProceduralPrecalcule[]);
    const ref = donneesBr(sc);
    const amorcee = donneesBr(copie);
    expect(amorcee.creux).toEqual(ref.creux);
    expect(amorcee.pieces).toEqual(ref.pieces);
    expect(centresBatimentsEligibles(copie)).toEqual(centresBatimentsEligibles(sc));
    expect(piecesProcedurales(copie, precalcule.map((c) => c.i))).toEqual(piecesProcedurales(sc, precalcule.map((c) => c.i)));
  });
  it("amorcer ne remplace pas un cache déjà rempli", () => {
    const copie: SceneData = { ...sc };
    const avant = donneesBr(copie).creux;
    amorcerProcedural(copie, []);
    expect(donneesBr(copie).creux).toEqual(avant);
  });
});
