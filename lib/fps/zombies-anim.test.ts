import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { griffe } from "../tigre3d/gestes/griffe";
import { squelette } from "../tigre3d/squelette";
import { creerAnimZombie, vitesseModele, VITESSE_MODELE_MAX } from "./zombies-anim";
import { ZOMBIES } from "./zombies-vagues";

const E = ZOMBIES.echelle;
const DT = 1 / 60;

function jouer(a: ReturnType<typeof creerAnimZombie>, s: number, v: number, g = false) {
  for (let i = 0; i < Math.round(s * 60); i++) a.maj(DT, v, E, g);
}
/** Position du bout de la patte avant droite dans le repère du modèle (posé par `corps.monde`). */
function pointesPattes(a: ReturnType<typeof creerAnimZombie>) {
  const sq = squelette();
  // la pose exprimée en os locaux : on se contente de comparer deux poses entre elles
  return a.pose().q.map((q) => [q.x, q.y, q.z, q.w]).flat().concat(a.pose().t.map((t: Vector3) => [t.x, t.y, t.z]).flat(), [sq.noms.length]);
}
const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));

describe("vitesse du modèle", () => {
  it("v / échelle, plafonnée à 3,2, jamais négative", () => {
    expect(vitesseModele(E * 1.5, E)).toBeCloseTo(1.5, 6);
    expect(vitesseModele(1000, E)).toBe(VITESSE_MODELE_MAX);
    expect(vitesseModele(-E, E)).toBeCloseTo(1, 6);
    expect(vitesseModele(0, E)).toBe(0);
  });
});

describe("animation d'un tigre zombie", () => {
  it("la pose évolue avec la vitesse : à l'arrêt elle ne bouge plus, en course elle change à chaque foulée", () => {
    const a = creerAnimZombie(1);
    jouer(a, 2, 0);
    const repos1 = pointesPattes(a);
    jouer(a, 0.3, 0);
    expect(distance(repos1, pointesPattes(a))).toBeLessThan(0.5);
    jouer(a, 1.5, 7);
    expect(a.vitesseModele()).toBeCloseTo(7 / E, 3);
    const m1 = pointesPattes(a);
    jouer(a, 0.2, 7);
    const m2 = pointesPattes(a);
    expect(distance(m1, m2)).toBeGreaterThan(0.2);
    // le corps avance sur son axe en marchant
    const x0 = a.x();
    jouer(a, 1, 7);
    expect(a.x()).toBeGreaterThan(x0);
  });

  it("à l'allure de marche, de trot et de galop la pose reste finie", () => {
    const a = creerAnimZombie(2);
    for (const v of [0, 3, 5.5, 8.6, 12, 50]) {
      jouer(a, 1, v);
      for (const q of a.pose().q) for (const x of [q.x, q.y, q.z, q.w]) expect(Number.isFinite(x), `v=${v}`).toBe(true);
    }
    expect(a.vitesseModele()).toBe(VITESSE_MODELE_MAX);
  });

  it("la griffe se joue UNE fois par front montant du drapeau, 0,55 s, et la patte avant droite bouge", () => {
    const a = creerAnimZombie(3);
    jouer(a, 1, 0);
    let lancees = 0;
    let duree = 0;
    const avant = pointesPattes(a);
    let ecartMax = 0;
    // drapeau tenu 0,4 s (comme le serveur) : un seul lancement
    for (let i = 0; i < Math.round(0.4 * 60); i++) {
      if (a.maj(DT, 0, E, true)) lancees++;
      if (a.geste()) duree += DT;
      ecartMax = Math.max(ecartMax, distance(avant, pointesPattes(a)));
    }
    for (let i = 0; i < Math.round(1 * 60); i++) {
      if (a.maj(DT, 0, E, false)) lancees++;
      if (a.geste()) duree += DT;
      ecartMax = Math.max(ecartMax, distance(avant, pointesPattes(a)));
    }
    expect(lancees).toBe(1);
    expect(duree).toBeGreaterThan(0.5);
    expect(duree).toBeLessThan(0.6);
    expect(ecartMax).toBeGreaterThan(0.3);
    expect(a.geste()).toBeNull();
    // un second front montant relance la griffe
    expect(a.maj(DT, 0, E, true)).toBe(true);
    expect(a.geste()).toBe(griffe);
  });

  it("la patte avant droite monte puis claque vers l'avant et le bas ; les autres pattes restent au sol (à l'arrêt)", () => {
    const a = creerAnimZombie(5);
    jouer(a, 2, 0);
    const sq = squelette();
    const main = () => a.corps().monde.p[sq.i.mainD].clone();
    const mainG = () => a.corps().monde.p[sq.i.mainG].clone();
    const repos = main(), reposG = mainG();
    // griffe armée (le corps marche le long de +x) : au bout de 0,2 s la patte est levée, vers 0,4 s elle est devant (+x) et bas
    a.maj(DT, 0, E, true);
    let haut = 0, hautG = 0;
    let zFrappe = -Infinity, yFrappe = Infinity;
    for (let i = 1; i <= Math.round(0.55 * 60); i++) {
      a.maj(DT, 0, E, true);
      haut = Math.max(haut, main().y - repos.y);
      hautG = Math.max(hautG, mainG().y - reposG.y);
      if (i / 60 > 0.38 && i / 60 < 0.46) { zFrappe = Math.max(zFrappe, main().x - repos.x); yFrappe = Math.min(yFrappe, main().y - repos.y); }
    }
    expect(haut).toBeGreaterThan(0.15);
    expect(hautG).toBeLessThan(0.03);
    expect(zFrappe).toBeGreaterThan(0.08);
    expect(yFrappe).toBeLessThan(haut - 0.1);
  });

  it("la griffe se joue aussi en marchant, et les trois autres pattes continuent", () => {
    const a = creerAnimZombie(4);
    jouer(a, 1.5, 7);
    const x0 = a.x();
    expect(a.maj(DT, 7, E, true)).toBe(true);
    jouer(a, 0.6, 7, true);
    expect(a.x()).toBeGreaterThan(x0);
    for (const q of a.pose().q) expect(Number.isFinite(q.w)).toBe(true);
  });
});
