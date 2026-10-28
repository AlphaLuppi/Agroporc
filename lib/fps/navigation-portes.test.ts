import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { detruireBatiment, releverBatiments } from "./collision";
import { carteNavigation, instantaneNavigation, invaliderNavigation, majNavigation, restaurerNavigation, type CarteNav } from "./navigation";
import { PORTES_PAYANTES, construireMondeZombies, idPrisme } from "./zombies-carte";
import { ZOMBIES } from "./zombies-vagues";

/**
 * Portes de la carte zombies et grilles de navigation des tigres : la mise à jour incrémentale (`majNavigation`) donne, case par case, la même
 * grille qu'un recalcul complet, en moins de 5 ms par porte pour les deux grilles (le recalcul complet coûtait 40 à 80 ms et gelait tout le
 * serveur, arène comprise) ; les grilles « portes fermées » photographiées se restaurent telles quelles.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const OPTS = [false, true].map((ignorerPasseTigre) => ({ taille: ZOMBIES.tailleCaseNav, ignorerPasseTigre }));
const grilles = (m: ReturnType<typeof construireMondeZombies>): CarteNav[] => OPTS.map((o) => carteNavigation(m, ZOMBIES.rayonNav, o));
/** Budget d'une porte, deux grilles (mesure seule : ≈ 1 ms ; large pour vitest en parallèle). */
const BUDGET_PORTE_MS = 5;

describe("navigation des tigres et portes achetées", () => {
  it("majNavigation : identique au recalcul complet, porte par porte, en moins de 5 ms", () => {
    const incr = construireMondeZombies(scene);
    const complet = construireMondeZombies(scene);
    const grillesIncr = grilles(incr);
    let pire = 0;
    for (const porte of PORTES_PAYANTES) {
      const ids = porte.prismes.map(idPrisme);
      for (const i of ids) { detruireBatiment(incr, i); detruireBatiment(complet, i); }
      const boites = ids.map((i) => incr.prismes[i].boite);
      // meilleure de 3 mesures (la mise à jour est idempotente) : le test ne doit pas échouer sur un ralentissement passager de la machine
      let meilleur = Infinity;
      for (let k = 0; k < 3; k++) {
        const debut = performance.now();
        majNavigation(incr, boites);
        meilleur = Math.min(meilleur, performance.now() - debut);
      }
      pire = Math.max(pire, meilleur);
      invaliderNavigation(complet);
      const ref = grilles(complet);
      // les grilles distribuées sont mises à jour sur place
      expect(grilles(incr)[0]).toBe(grillesIncr[0]);
      for (const g of [0, 1]) {
        const a = grillesIncr[g].bloque, b = ref[g].bloque;
        let differences = 0;
        for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) differences++;
        expect(differences, `porte ${porte.id}, grille ${g}`).toBe(0);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[navigation] pire porte : ${pire.toFixed(2)} ms pour les deux grilles`);
    expect(pire).toBeLessThan(BUDGET_PORTE_MS);
  });

  it("restaurerNavigation : toutes portes refermées, les grilles reviennent à la photographie, sur place", () => {
    const m = construireMondeZombies(scene);
    const avant = grilles(m).map((c) => c.bloque.slice());
    const photo = instantaneNavigation(m);
    for (const porte of PORTES_PAYANTES) for (const i of porte.prismes.map(idPrisme)) detruireBatiment(m, i);
    majNavigation(m, PORTES_PAYANTES.flatMap((p) => p.prismes.map((x) => m.prismes[idPrisme(x)].boite)));
    expect(grilles(m).some((c, g) => c.bloque.some((v, k) => v !== avant[g][k]))).toBe(true);
    const distribuees = grilles(m);
    releverBatiments(m);
    restaurerNavigation(m, photo);
    const apres = grilles(m);
    expect(apres[0]).toBe(distribuees[0]);
    apres.forEach((c, g) => expect(Array.from(c.bloque)).toEqual(Array.from(avant[g])));
  });
});
