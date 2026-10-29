// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { boiteLocale, creerArmeEnMain } from "./rendu";
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

describe("(v8) organe de visée posé sur l'arme améliorée", () => {
  it("le point rouge du mini Uzi gratiné est sur le dessus de l'arme, même l'arme en main sous une caméra à 1,9 m", () => {
    const camera = new THREE.Group();
    camera.position.set(12, 1.9, -30);
    camera.rotation.set(-0.3, 0.8, 0);
    const arme = creerArmeEnMain("mini_uzi");
    camera.add(arme.group);
    const modele = modeleDe(arme);
    expect(boiteLocale(modele).max.y).toBeLessThan(0.3);
    arme.regler({ paire: false, viseur: "point_rouge" });
    const piece = modele.children[modele.children.length - 1];
    // la pièce part du dessus de la carcasse SOUS elle (repère du modèle), à quelques millimètres près : ni l'éclair de bouche caché ni un
    // guidon ailleurs sur l'arme ne la soulèvent (elle flottait 7 cm au-dessus)
    piece.visible = false;
    const z = piece.position.z;
    const dessous = boiteLocale(modele, [z - 0.03, z + 0.03]).max.y;
    piece.visible = true;
    expect(piece.position.y).toBeGreaterThan(dessous - 0.01);
    expect(piece.position.y).toBeLessThan(dessous + 0.02);
    // et elle est bien sur l'arme dans le monde : à moins de 30 cm de la bouche du canon
    camera.updateMatrixWorld(true);
    const p = piece.getWorldPosition(new THREE.Vector3());
    expect(p.distanceTo(arme.positionBouche(new THREE.Vector3()))).toBeLessThan(0.3);
  });
});

describe("(v8) organe de visée posé sur la carcasse, pas au-dessus", () => {
  it.each([["mitrailleuse", "holo"], ["mitraillette", "holo"], ["pompe", "point_rouge"], ["fusil_assaut", "lunette"]] as const)(
    "%s (%s) : la pièce touche le dessus de l'arme sous elle",
    (id, viseur) => {
      const arme = creerArmeEnMain(id);
      const modele = modeleDe(arme);
      arme.regler({ paire: false, viseur });
      const piece = modele.children[modele.children.length - 1];
      piece.visible = false;
      // empreinte de la pièce : 3 cm de part et d'autre, 9 cm pour le tube d'une lunette
      const z = piece.position.z, demi = viseur === "lunette" ? 0.09 : 0.03;
      const dessous = boiteLocale(modele, [z - demi, z + demi]).max.y;
      piece.visible = true;
      expect(piece.position.y - dessous).toBeGreaterThan(-0.01);
      expect(piece.position.y - dessous).toBeLessThan(0.02);
      arme.dispose();
    },
  );
});
