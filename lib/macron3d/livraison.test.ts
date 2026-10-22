/**
 * Livraison de l'easter egg « macron » : GLB léger servi depuis public/, crédits dans public/macron/CREDITS.txt (rien à l'écran), montage
 * dans le layout, three et le GLB chargés seulement au déclenchement.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { jsonGLB } from "../tigre3d/extraction.mjs";

const GLB = "public/macron/macron.glb";

describe("GLB du coureur", () => {
  it("reste sous 2,5 Mo, géométrie compressée (meshopt), crédit dans les métadonnées", () => {
    expect(statSync(GLB).size).toBeLessThan(2.5 * 1024 * 1024);
    const j = jsonGLB(readFileSync(GLB)) as unknown as { extensionsUsed?: string[]; skins: unknown[]; animations?: unknown[]; asset: unknown };
    expect(j.extensionsUsed).toContain("EXT_meshopt_compression");
    expect(j.skins.length).toBeGreaterThan(0);
    expect(JSON.stringify(j.asset)).toContain("jamray747");
    // Aucune animation embarquée : la course est calculée par le code.
    expect(j.animations ?? []).toHaveLength(0);
  });

  it("est livré avec son fichier de crédits (auteur, lien, licence, modifications)", () => {
    const c = readFileSync("public/macron/CREDITS.txt", "utf8");
    expect(c).toContain("jamray747");
    expect(c).toContain("https://sketchfab.com/3d-models/emmanuel-m-0ede7d2d38454ad190f643315196ff26");
    expect(c).toMatch(/CC BY 4\.0/);
    expect(c).toMatch(/allégé et animé/);
  });
});

describe("montage", () => {
  const composant = readFileSync("app/components/MacronEasterEgg.tsx", "utf8");

  it("l'easter egg est monté dans le layout, à côté de « myrtille »", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toContain("<MacronEasterEgg />");
    expect(layout).toContain("<MyrtilleEasterEgg />");
  });

  it("écoute le code « macron » avec l'écouteur commun, et ne charge three qu'au déclenchement", () => {
    expect(composant).toContain('CODE_MACRON = "macron"');
    expect(composant).toContain("ecouterCode(CODE_MACRON");
    // Aucun import statique de three ni de la scène : seulement des types et un import() dynamique.
    expect(composant).not.toMatch(/^import [^t].*from "three"/m);
    expect(composant).not.toMatch(/^import \{[^}]*\} from "@\/lib\/macron3d\/scene"/m);
    expect(composant).toContain('import("@/lib/macron3d/scene")');
    // Respect de prefers-reduced-motion et repli silencieux sans WebGL.
    expect(composant).toContain("prefers-reduced-motion: reduce");
    expect(composant).toContain("webglDisponible()");
  });

  it("un seul passage à la fois, jamais sous une fenêtre modale", () => {
    expect(composant).not.toContain("Credit");
    expect(composant).toContain("creerDeclencheur(passagePossible");
    expect(composant).toContain("jouerPassage({");
    // Pas de passage sous une fenêtre modale (vue 3D « myrtille », panneau d'un plat).
    expect(composant).toContain('[aria-modal="true"]');
  });
});
