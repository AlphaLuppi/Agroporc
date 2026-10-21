/**
 * Livraison du tigre 3D : poids et contenu du GLB servi depuis public/, crédit CC BY affiché dans
 * le thème Tigre, détection de WebGL (repli sprite).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreditTigre, CREDIT_TIGRE } from "../../app/components/CreditTigre";

const GLB = "public/tigre/tigre.glb";

function jsonGlb(chemin: string) {
  const b = readFileSync(chemin);
  expect(b.toString("ascii", 0, 4)).toBe("glTF");
  expect(b.readUInt32LE(4)).toBe(2);
  const longueur = b.readUInt32LE(12);
  expect(b.toString("ascii", 16, 20)).toBe("JSON");
  return JSON.parse(b.toString("utf8", 20, 20 + longueur));
}

describe("GLB du tigre", () => {
  it("reste léger (< 1,5 Mo, chargé au premier passage seulement)", () => {
    expect(statSync(GLB).size).toBeLessThan(1.5 * 1024 * 1024);
  });

  it("contient un seul maillage skinné, ses 4 clips, et une géométrie compressée (meshopt)", () => {
    const j = jsonGlb(GLB);
    expect(j.skins).toHaveLength(1);
    expect(j.animations.map((a: { name: string }) => a.name.replace(/^.*\|/, "")).sort()).toEqual(["Attack jump", "Curious", "Trick", "Walking"]);
    expect(j.extensionsUsed).toContain("EXT_meshopt_compression");
  });

  it("est livré avec son fichier de crédits (auteur, lien, licence, modifications)", () => {
    const c = readFileSync("public/tigre/CREDITS.txt", "utf8");
    expect(c).toContain(CREDIT_TIGRE.auteur);
    expect(c).toContain(CREDIT_TIGRE.modele);
    expect(c).toMatch(/CC BY 4\.0/);
    expect(c).toMatch(/Modifications/);
  });
});

describe("crédit CC BY du tigre", () => {
  const html = renderToStaticMarkup(createElement(CreditTigre));

  it("nomme l'œuvre, l'auteur et la licence, avec leurs liens", () => {
    expect(html).toContain('class="pdj-credit-tigre"');
    expect(html).toContain(`href="${CREDIT_TIGRE.modele}"`);
    expect(html).toContain(`href="${CREDIT_TIGRE.profil}"`);
    expect(html).toContain(`href="${CREDIT_TIGRE.lienLicence}"`);
    expect(html).toContain("Jungle Jim");
    expect(html).toContain("CC BY 4.0");
    // Les modifications apportées au modèle sont signalées (exigence de la licence).
    expect(html).toMatch(/allégé et animé/);
  });

  it("est rendu dans le pied de page et affiché seulement dans le thème Tigre", () => {
    expect(readFileSync("app/layout.tsx", "utf8")).toContain("<CreditTigre />");
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/\.pdj-credit-tigre\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/html\[data-theme="tigre"\] \.pdj-credit-tigre\s*\{[^}]*display:\s*block/);
  });
});

describe("webglDisponible", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  const avecCanvas = (contexte: unknown) =>
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => contexte }) });

  it("vrai avec un contexte WebGL (et libère le contexte de test)", async () => {
    const perdre = vi.fn();
    avecCanvas({ getExtension: () => ({ loseContext: perdre }) });
    const { webglDisponible } = await import("./webgl");
    expect(webglDisponible()).toBe(true);
    expect(perdre).toHaveBeenCalled();
  });

  it("faux sans contexte, ou si le canvas lève une erreur : le sprite prend le relais", async () => {
    avecCanvas(null);
    expect((await import("./webgl")).webglDisponible()).toBe(false);
    vi.resetModules();
    vi.stubGlobal("document", { createElement: () => { throw new Error("pas de canvas"); } });
    expect((await import("./webgl")).webglDisponible()).toBe(false);
  });
});
