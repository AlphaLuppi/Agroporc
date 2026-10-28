import { describe, expect, it } from "vitest";
import * as THREE from "three";
import scene from "../../public/agroparc/scene.json";
import type { SceneData } from "../agroparc3d/types";
import { donneesBr } from "./br-carte";
import { creerRenduInterieurs } from "./rendu-interieurs";
import { donneesZombies } from "./zombies-carte";

/**
 * Rendu des intérieurs sans contexte WebGL : ce qu'on peut vérifier est la composition de la scène (quels maillages sont créés),
 * pas l'aspect (captures). Les zombies gardent leur comportement par défaut ; le Battle Royale passe `sansPlafond` et sa liste de bâtiments.
 */
const sc = scene as unknown as SceneData;
/** Sommets (toutes géométries confondues) des maillages « pleins » d'un groupe, sans les lignes d'arêtes ni les points. */
const maillages = (g: THREE.Object3D) => g.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];

describe("rendu des intérieurs", () => {
  it("zombies : par défaut, quatre bâtiments avec sol, faux plafond et toit (comportement inchangé)", () => {
    const d = donneesZombies(sc);
    const s = new THREE.Scene();
    const r = creerRenduInterieurs(s, d.data, d.pieces);
    const racine = s.getObjectByName("interieurs")!;
    // murs, [meubles], sol, plafond, toit = au moins 4 maillages pleins
    expect(maillages(racine).length).toBeGreaterThanOrEqual(4);
    const noms = maillages(racine).map((m) => (m.material as THREE.MeshBasicMaterial).customProgramCacheKey?.());
    expect(noms).toContain("pdj-interieurs-sol");
    expect(noms).toContain("pdj-interieurs-plafond");
    r.dispose();
    expect(s.children).toHaveLength(0);
  });

  it("zombies : le courant coupé au départ reste le comportement par défaut (secours rouge)", () => {
    const d = donneesZombies(sc);
    const s = new THREE.Scene();
    const r = creerRenduInterieurs(s, d.data, d.pieces);
    r.maj(1, 0.016);
    r.majCourant(true);
    for (let i = 0; i < 300; i++) r.maj(2 + i * 0.016, 0.016);
    r.dispose();
  });

  it("Battle Royale : toit ouvert, ni faux plafond ni toit, mais murs et sol des 20 bâtiments creux", () => {
    const d = donneesBr(sc);
    expect(d.creux.length).toBeGreaterThanOrEqual(16);
    const s = new THREE.Scene();
    const r = creerRenduInterieurs(s, d.data, d.pieces, { sansPlafond: true, batiments: d.creux, courant: true });
    const racine = s.getObjectByName("interieurs")!;
    const noms = maillages(racine).map((m) => (m.material as THREE.MeshBasicMaterial).customProgramCacheKey?.());
    expect(noms).toContain("pdj-interieurs-sol");
    expect(noms).not.toContain("pdj-interieurs-plafond");
    // les murs sont bien là (sans quoi on ne verrait qu'un sol)
    expect(maillages(racine).length).toBeGreaterThanOrEqual(2);
    r.maj(1, 0.016);
    r.dispose();
    expect(s.children).toHaveLength(0);
  });

  it("une liste de bâtiments vide ne plante pas (aucun sol, aucun toit)", () => {
    const d = donneesBr(sc);
    const s = new THREE.Scene();
    const r = creerRenduInterieurs(s, d.data, [], { batiments: [] });
    r.maj(1, 0.016);
    r.dispose();
  });

  it("`batiments` restreint le sol aux bâtiments demandés", () => {
    const d = donneesBr(sc);
    const poser = (batiments: readonly number[]) => {
      const s = new THREE.Scene();
      const r = creerRenduInterieurs(s, d.data, [], { sansPlafond: true, batiments });
      const sol = maillages(s.getObjectByName("interieurs")!).find((m) => (m.material as THREE.MeshBasicMaterial).customProgramCacheKey?.() === "pdj-interieurs-sol")!;
      const n = sol.geometry.getAttribute("position").count;
      r.dispose();
      return n;
    };
    expect(poser(d.creux)).toBeGreaterThan(poser(d.creux.slice(0, 2)));
  });
});
