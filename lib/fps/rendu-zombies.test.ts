import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { ZombieVue } from "./jeu-zombies";

/**
 * Rendu des tigres zombies : le modèle (GLB) est remplacé par un faux (groupe vide, `appliquer` espionné) ; on vérifie que chaque tigre
 * GARDE son emplacement, donc son animation, d'une image à l'autre (régression : l'emplacement était rendu à chaque image et l'animation
 * repartait de la pose de repos, les tigres glissaient figés).
 */
const appliques: { x: number }[] = [];
vi.mock("../tigre3d/modele", () => ({
  chargerModele: () => Promise.resolve({ maillages: [], scene: new THREE.Group() }),
  creerTigre: () => ({
    groupe: new THREE.Group(), ombre: { visible: true },
    appliquer: (_pose: unknown, x: number) => { appliques.push({ x }); },
    dispose: () => {},
  }),
}));
const creations = vi.hoisted(() => ({ n: 0 }));
vi.mock("./zombies-anim", async (orig) => {
  const m = await orig<typeof import("./zombies-anim")>();
  return { ...m, creerAnimZombie: (g?: number) => { creations.n++; return m.creerAnimZombie(g); } };
});

const { creerRenduZombies } = await import("./rendu-zombies");

const vue = (o: Partial<ZombieVue> = {}): ZombieVue => ({
  id: 7, x: 0, z: -6, cap: 0, type: 0, echelle: 2.7, griffe: false, apparition: false, pvPct: 100, vitesse: 3, allure: 0, mode: "chasse", ...o,
});

describe("rendu des tigres zombies", () => {
  it("un tigre garde son emplacement et son animation d'une image à l'autre ; la foulée avance", async () => {
    const r = creerRenduZombies(new THREE.Scene());
    await Promise.resolve();
    await Promise.resolve();
    // le pool se crée par 2 clones par image
    for (let i = 1; i <= 15; i++) r.maj([], 0, [0, 1.8, 0], 0, -1, 1 / 30, i);
    expect(r.pret()).toBe(true);
    const avant = creations.n;
    appliques.length = 0;
    for (let i = 16; i < 76; i++) r.maj([vue({ z: -6 + (i - 16) * 0.1 })], 1, [0, 1.8, 0], 0, -1, 1 / 30, i);
    // une seule animation créée pour ce tigre (pas une par image)
    expect(creations.n - avant).toBe(1);
    expect(appliques.length).toBe(60);
    // le corps avance sur son axe : la foulée n'est pas remise à zéro
    expect(appliques[59].x).toBeGreaterThan(appliques[0].x + 1);
    // absent d'une image : son emplacement est rendu, il revient avec une animation neuve
    r.maj([], 0, [0, 1.8, 0], 0, -1, 1 / 30, 76);
    r.maj([], 0, [0, 1.8, 0], 0, -1, 1 / 30, 77);
    r.maj([vue()], 1, [0, 1.8, 0], 0, -1, 1 / 30, 78);
    expect(creations.n - avant).toBe(2);
    r.dispose();
  });
});
