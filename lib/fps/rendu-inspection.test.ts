// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { creerArmeEnMain } from "./rendu";
import { dureeInspection } from "./inspection";

type ArmeMain = ReturnType<typeof creerArmeEnMain>;
const REPOS = { vitesseH: 0, auSol: true, vise: false };
const PAS = 1 / 60;

/** Modèle d'arme : 3e enfant du groupe, après les deux avant-bras. */
const modeleDe = (arme: ArmeMain) => arme.group.children[2];
const jouer = (arme: ArmeMain, s: number, ctx: Partial<typeof REPOS & { sprint: boolean }> = {}) => {
  for (let t = 0; t < s; t += PAS) arme.maj(PAS, { ...REPOS, ...ctx });
};
const intact = (arme: ArmeMain) => {
  const m = modeleDe(arme);
  return m.position.lengthSq() < 1e-12 && Math.abs(m.quaternion.w - 1) < 1e-9;
};

describe("inspection de l'arme en main", () => {
  it("démarre, tourne l'arme autour de sa prise, puis la remet exactement à sa place", () => {
    for (const id of ["couteau", "epee", "pistolet", "fusil_assaut"] as const) {
      const arme = creerArmeEnMain(id);
      expect(arme.inspection).toBe(false);
      expect(arme.inspecter()).toBe(true);
      expect(arme.inspection).toBe(true);
      // à mi-chemin l'arme est tournée ou déplacée
      let bouge = false;
      for (let t = 0; t < dureeInspection(id); t += PAS) {
        arme.maj(PAS, REPOS);
        if (!intact(arme)) bouge = true;
      }
      expect(bouge, id).toBe(true);
      jouer(arme, 0.2);
      expect(arme.inspection, id).toBe(false);
      expect(intact(arme), id).toBe(true);
      arme.dispose();
    }
  });

  it("l'avant-bras droit reste sur la poignée pendant que l'arme tourne", () => {
    const arme = creerArmeEnMain("pistolet");
    const [brasD] = arme.group.children;
    const repos = new THREE.Vector3();
    jouer(arme, 0.1);
    repos.copy(brasD.position);
    expect(arme.inspecter()).toBe(true);
    let ecartMax = 0;
    for (let t = 0; t < 1.2; t += PAS) {
      arme.maj(PAS, REPOS);
      ecartMax = Math.max(ecartMax, brasD.position.distanceTo(repos));
    }
    // la poignée est le pivot : la main arrière ne s'en éloigne que du décalage voulu de l'arme (quelques centimètres)
    expect(ecartMax).toBeLessThan(0.15);
    arme.dispose();
  });

  it("un tir, un coup, la visée, le sprint, un rechargement ou un changement d'arme la coupent", () => {
    const coupures: [string, (a: ArmeMain) => void][] = [
      ["tir", (a) => a.tirer()],
      ["coup", (a) => a.coup()],
      ["recharge", (a) => a.recharger(1.5)],
      ["changement", (a) => a.changer("revolver")],
      ["annulation", (a) => a.annulerInspection()],
      ["visée", (a) => jouer(a, PAS, { vise: true })],
      ["sprint", (a) => jouer(a, PAS, { sprint: true, vitesseH: 9 })],
    ];
    for (const [nom, coupe] of coupures) {
      const arme = creerArmeEnMain("pistolet");
      arme.inspecter();
      jouer(arme, 0.7);
      expect(arme.inspection, nom).toBe(true);
      coupe(arme);
      if (nom !== "visée" && nom !== "sprint") expect(arme.inspection, nom).toBe(false);
      expect(arme.inspection, nom).toBe(false);
      expect(intact(arme), nom).toBe(true);
      arme.dispose();
    }
  });

  it("refusée pendant un rechargement ou une inspection déjà en cours", () => {
    const arme = creerArmeEnMain("mitraillette");
    arme.recharger(1.5);
    jouer(arme, 0.1);
    expect(arme.inspecter()).toBe(false);
    jouer(arme, 2);
    expect(arme.inspecter()).toBe(true);
    expect(arme.inspecter()).toBe(false);
    arme.dispose();
  });

  it("la bouche revient à sa position de repos une fois l'inspection coupée (la traçante part du bon endroit)", () => {
    const arme = creerArmeEnMain("fusil_assaut");
    jouer(arme, 0.1);
    const repos = arme.positionBouche(new THREE.Vector3()).clone();
    arme.inspecter();
    jouer(arme, 1);
    arme.annulerInspection();
    // (seule la respiration au repos de l'arme, ~1 mm, bouge d'une image à l'autre)
    expect(arme.positionBouche(new THREE.Vector3()).distanceTo(repos)).toBeLessThan(0.005);
    arme.dispose();
  });
});

describe("viseur posé et visée", () => {
  const camera = new THREE.PerspectiveCamera();
  /** Hauteur du groupe de l'arme en pleine visée. */
  function hauteurEnVisee(viseur: "fer" | "point_rouge" | "holo", id: "mitraillette" | "fusil_assaut" | "pistolet"): number {
    const arme = creerArmeEnMain(id);
    camera.add(arme.group);
    arme.regler({ paire: false, viseur });
    jouer(arme, 1.5, { vise: true });
    const y = arme.group.position.y;
    arme.dispose();
    return y;
  }
  it("l'arme se recale d'au plus 3 cm pour que le point lumineux tombe sur l'axe", () => {
    for (const id of ["mitraillette", "fusil_assaut", "pistolet"] as const) {
      const fer = hauteurEnVisee("fer", id);
      for (const v of ["point_rouge", "holo"] as const) {
        const e = Math.abs(hauteurEnVisee(v, id) - fer);
        expect(e, `${id} ${v}`).toBeLessThanOrEqual(0.03 + 1e-9);
      }
    }
  });
  it("une lunette ×4 a un tube plus long qu'une lunette ×2", () => {
    const longueur = (grossissement: number) => {
      const arme = creerArmeEnMain("fusil_assaut");
      arme.regler({ paire: false, viseur: "lunette", grossissement });
      const piece = modeleDe(arme).children[modeleDe(arme).children.length - 1];
      const boite = new THREE.Box3().setFromObject(piece);
      arme.dispose();
      return boite.max.z - boite.min.z;
    };
    expect(longueur(4)).toBeGreaterThan(longueur(2));
  });
  it("changer le grossissement repose la pièce (une seule à la fois)", () => {
    const arme = creerArmeEnMain("fusil_assaut");
    const n0 = modeleDe(arme).children.length;
    arme.regler({ paire: false, viseur: "lunette", grossissement: 2 });
    arme.regler({ paire: false, viseur: "lunette", grossissement: 4 });
    arme.regler({ paire: false, viseur: "fer" });
    expect(modeleDe(arme).children.length).toBe(n0);
    arme.dispose();
  });
});
