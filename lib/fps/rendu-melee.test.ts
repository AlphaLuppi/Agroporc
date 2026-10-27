// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { creerArmeEnMain } from "./rendu";
import { MELEE } from "./armes";

/** Avance l'arme en main par pas de 1/60 s pendant `dureeS` ; renvoie la rotation lacet de l'arme à chaque pas (via la bouche, monde). */
function jouer(arme: ReturnType<typeof creerArmeEnMain>, dureeS: number, parPas?: () => void) {
  const pas = 1 / 60;
  for (let t = 0; t < dureeS; t += pas) {
    arme.maj(pas, { vitesseH: 0, auSol: true, vise: false });
    parPas?.();
  }
}

type ArmeMain = ReturnType<typeof creerArmeEnMain>;
/** Position de bouche statique (repère du groupe de l'arme) : sert à comparer les longueurs de modèle. */
const bouche = (arme: ArmeMain) => arme.positionBouche(new THREE.Vector3()).clone();

/** Modèle d'arme (3e enfant de `group` après les deux avant-bras). */
const modeleDe = (arme: ArmeMain) => arme.group.children[2];

/** Pièce du modèle la plus éloignée de l'origine au repos : la pointe de lame. Renvoie une fonction qui la lit dans le repère de la caméra. */
function suivrePointe(arme: ArmeMain): () => THREE.Vector3 {
  arme.group.updateMatrixWorld(true);
  const modele = modeleDe(arme);
  const origine = new THREE.Vector3();
  modele.getWorldPosition(origine);
  let pointe: THREE.Object3D = modele;
  let max = -1;
  const v = new THREE.Vector3();
  modele.traverse((o) => {
    o.getWorldPosition(v);
    const d = v.distanceTo(origine);
    if (d > max) { max = d; pointe = o; }
  });
  return () => {
    arme.group.updateMatrixWorld(true);
    return pointe.getWorldPosition(new THREE.Vector3());
  };
}

describe("arme blanche en main : modèle et animation de coup", () => {
  it("le modèle de l'épée est plus long que celui du couteau (bouche = pointe de la lame)", () => {
    const couteau = creerArmeEnMain("couteau");
    const epee = creerArmeEnMain("epee");
    jouer(couteau, 0.05);
    jouer(epee, 0.05);
    const pc = bouche(couteau).sub(couteau.group.position);
    const pe = bouche(epee).sub(epee.group.position);
    // la pointe de l'épée est nettement plus loin devant la main que celle du couteau
    expect(pe.length()).toBeGreaterThan(pc.length() + 0.25);
    expect(pe.length()).toBeGreaterThan(0.5);
    expect(pe.length()).toBeLessThan(0.9);
    couteau.dispose();
    epee.dispose();
  });

  it("le coup dure dureeCoupS de l'arme : 0,40 s au couteau, 0,55 s à l'épée", () => {
    for (const id of ["couteau", "epee"] as const) {
      const arme = creerArmeEnMain(id);
      const pointe = suivrePointe(arme);
      jouer(arme, 0.02);
      const repos = pointe();
      arme.coup();
      let bouge = 0;
      jouer(arme, MELEE[id].dureeCoupS * 0.5, () => { bouge = Math.max(bouge, pointe().distanceTo(repos)); });
      // à mi-course le coup est bien en cours (la pointe a bougé)
      expect(bouge, id).toBeGreaterThan(0.05);
      // un peu après la durée nominale, l'arme est revenue à sa pose de repos
      jouer(arme, MELEE[id].dureeCoupS * 0.5 + 0.1);
      expect(pointe().distanceTo(repos), id).toBeLessThan(6e-3);
      arme.dispose();
    }
  });

  it("l'épée est encore en plein geste quand le couteau a fini (coup plus lent)", () => {
    const couteau = creerArmeEnMain("couteau");
    const epee = creerArmeEnMain("epee");
    const pc = suivrePointe(couteau), pe = suivrePointe(epee);
    jouer(couteau, 0.02);
    jouer(epee, 0.02);
    const reposC = pc(), reposE = pe();
    couteau.coup();
    epee.coup();
    jouer(couteau, 0.45);
    jouer(epee, 0.45);
    expect(pc().distanceTo(reposC)).toBeLessThan(6e-3);
    expect(pe().distanceTo(reposE)).toBeGreaterThan(0.01);
    couteau.dispose();
    epee.dispose();
  });

  it("l'épée frappe en taille horizontale, d'un côté puis de l'autre, à chaque coup", () => {
    const arme = creerArmeEnMain("epee");
    const pointe = suivrePointe(arme);
    jouer(arme, 0.02);
    const repos = pointe();
    const coup = () => {
      arme.coup();
      let xMin = Infinity, xMax = -Infinity, yMax = -Infinity, premier = 0;
      jouer(arme, MELEE.epee.dureeCoupS, () => {
        const p = pointe().sub(repos);
        xMin = Math.min(xMin, p.x);
        xMax = Math.max(xMax, p.x);
        yMax = Math.max(yMax, Math.abs(p.y));
        if (premier === 0 && Math.abs(p.x) > 0.05) premier = Math.sign(p.x);
      });
      jouer(arme, 0.15);
      return { xMin, xMax, yMax, premier };
    };
    const a = coup();
    const b = coup();
    // le balayage latéral est large (plusieurs dizaines de centimètres), plus que vertical : c'est une taille horizontale
    for (const c of [a, b]) {
      expect(c.xMax - c.xMin).toBeGreaterThan(0.4);
      expect(c.xMax - c.xMin).toBeGreaterThan(c.yMax);
    }
    // d'un coup à l'autre le sens s'inverse : le côté où la pointe part en premier change
    expect(a.premier).not.toBe(0);
    expect(b.premier).toBe(-a.premier);
    // un troisième coup revient au sens du premier
    expect(coup().premier).toBe(a.premier);
    arme.dispose();
  });

  it("changer d'arme en main : couteau vers épée remplace le modèle", () => {
    const arme = creerArmeEnMain("couteau");
    jouer(arme, 0.05);
    const longueurC = bouche(arme).sub(arme.group.position).length();
    arme.changer("epee");
    jouer(arme, 0.05);
    expect(bouche(arme).sub(arme.group.position).length()).toBeGreaterThan(longueurC + 0.25);
    arme.changer("pistolet");
    jouer(arme, 0.05);
    arme.dispose();
  });
});
