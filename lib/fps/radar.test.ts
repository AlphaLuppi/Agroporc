import { describe, expect, it } from "vitest";
import {
  ECHO, ECHOS_TIR, RADAR_CAPACITES, RADAR_DUREES, RADAR_PORTEES, ajouterEcho, ajouterJoueur, ajouterVoiture, ajouterVoiturePnj, creerRadarFrame, definirElsa,
  lisserVu, purgerEchos, repereElsa, viderRadarFrame,
} from "./radar";

const joueur = (surcharge = {}) => ({ id: "a", x: 10, z: 20, cap: 0.5, couleur: "#ff00ff", etat: "pied" as const, vu: 1, age: 0, ...surcharge });

describe("creerRadarFrame", () => {
  it("préalloue des tableaux à leur capacité", () => {
    const f = creerRadarFrame();
    expect(f.joueurs).toHaveLength(RADAR_CAPACITES.joueurs);
    expect(f.voitures).toHaveLength(RADAR_CAPACITES.voitures);
    expect(f.echos).toHaveLength(RADAR_CAPACITES.echos);
    expect(f.voituresPnj.length).toBe(RADAR_CAPACITES.pnj * 3);
    expect(f.nJoueurs + f.nVoitures + f.nEchos + f.nPnj).toBe(0);
    expect(f.elsa).toBeNull();
  });
});

describe("joueurs : pas de wallhack", () => {
  it("un joueur non vu (vu = 0) n'apparaît jamais", () => {
    const f = creerRadarFrame();
    expect(ajouterJoueur(f, joueur({ vu: 0 }))).toBe(false);
    expect(f.nJoueurs).toBe(0);
    expect(ajouterJoueur(f, joueur({ vu: 0.4 }))).toBe(true);
    expect(f.nJoueurs).toBe(1);
    expect(f.joueurs[0]).toMatchObject({ id: "a", x: 10, z: 20, vu: 0.4, etat: "pied" });
  });
  it("`vu` monte aussitôt et décroît en 0,6 s", () => {
    expect(RADAR_DUREES.fonduVuS).toBe(0.6);
    expect(lisserVu(0, true, 0.016)).toBe(1);
    let vu = 1;
    for (let i = 0; i < 30; i++) vu = lisserVu(vu, false, 0.01); // 0,3 s
    expect(vu).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 30; i++) vu = lisserVu(vu, false, 0.01); // 0,6 s au total
    expect(vu).toBe(0);
    expect(lisserVu(0.2, false, -1)).toBe(0.2);
  });
  it("un mort reste en croix 3 s puis disparaît", () => {
    const f = creerRadarFrame();
    expect(ajouterJoueur(f, joueur({ etat: "mort", age: 2.9 }))).toBe(true);
    expect(ajouterJoueur(f, joueur({ etat: "mort", age: 3 }))).toBe(false);
    expect(f.nJoueurs).toBe(1);
  });
  it("capacité de 16 : au-delà, ignoré sans erreur", () => {
    const f = creerRadarFrame();
    for (let i = 0; i < 20; i++) ajouterJoueur(f, joueur({ id: String(i) }));
    expect(f.nJoueurs).toBe(16);
  });
});

describe("identité des tableaux d'une image à l'autre (zéro allocation)", () => {
  it("vider puis remplir réutilise les mêmes objets", () => {
    const f = creerRadarFrame();
    const tableaux = [f.joueurs, f.voitures, f.echos, f.voituresPnj];
    const premier = f.joueurs[0], pnj = f.voituresPnj;
    ajouterJoueur(f, joueur());
    f.x = 0; f.z = 0;
    ajouterEcho(f, 16, 16);
    viderRadarFrame(f);
    expect(f.nJoueurs).toBe(0);
    ajouterJoueur(f, joueur({ id: "b" }));
    expect(f.joueurs[0]).toBe(premier);
    expect(f.joueurs[0].id).toBe("b");
    expect([f.joueurs, f.voitures, f.echos, f.voituresPnj]).toEqual(tableaux);
    expect(f.voituresPnj).toBe(pnj);
    expect(f.joueurs).toHaveLength(16);
  });
  it("vider remet capVehicule à NaN et efface Elsa", () => {
    const f = creerRadarFrame();
    f.capVehicule = 1; f.elsa = { x: 0, z: 0, genre: "soin", finT: 1, angle: 0, distance: 0 };
    viderRadarFrame(f);
    expect(f.capVehicule).toBeNaN();
    expect(f.elsa).toBeNull();
  });
});

describe("échos de tir", () => {
  it("constantes : 1,2 s, 70 m, pas de 8 m, activés", () => {
    expect(ECHO).toEqual({ rayonM: 70, dureeS: 1.2, pasM: 8 });
    expect(ECHOS_TIR).toBe(true);
  });
  it("arrondis à 8 m, purgés après 1,2 s", () => {
    const f = creerRadarFrame();
    expect(ajouterEcho(f, 13, -29)).toBe(true);
    expect(f.echos[0]).toMatchObject({ x: 16, z: -32, age: 0 });
    purgerEchos(f, 0.6);
    expect(f.nEchos).toBe(1);
    expect(f.echos[0].age).toBeCloseTo(0.6, 9);
    purgerEchos(f, 0.59);
    expect(f.nEchos).toBe(1);
    purgerEchos(f, 0.02);
    expect(f.nEchos).toBe(0);
  });
  it("tireur vu exclu, tireur à plus de 70 m exclu", () => {
    const f = creerRadarFrame();
    expect(ajouterEcho(f, 10, 10, true)).toBe(false);
    expect(ajouterEcho(f, 71, 0)).toBe(false);
    expect(ajouterEcho(f, 69, 0)).toBe(true);
    expect(f.nEchos).toBe(1);
  });
  it("une rafale dans la même case rafraîchit l'écho au lieu d'en créer", () => {
    const f = creerRadarFrame();
    ajouterEcho(f, 17, 17);
    purgerEchos(f, 0.5);
    ajouterEcho(f, 18.5, 15.5);
    expect(f.nEchos).toBe(1);
    expect(f.echos[0].age).toBe(0);
  });
  it("file pleine : le plus ancien est remplacé", () => {
    const f = creerRadarFrame();
    for (let i = 0; i < RADAR_CAPACITES.echos; i++) { ajouterEcho(f, i * 8, 0); purgerEchos(f, 0.1); }
    expect(f.nEchos).toBe(8);
    // le premier posé (x = 0) est le plus âgé
    ajouterEcho(f, 40, 40);
    expect(f.nEchos).toBe(8);
    expect(f.echos.slice(0, 8).some((e) => e.x === 0 && e.z === 0)).toBe(false);
    expect(f.echos.slice(0, 8).some((e) => e.x === 40 && e.z === 40)).toBe(true);
  });
  it("la purge compacte en place sans partager d'objets", () => {
    const f = creerRadarFrame();
    ajouterEcho(f, 0, 0); purgerEchos(f, 1.0);
    ajouterEcho(f, 8, 0); purgerEchos(f, 0.1);
    ajouterEcho(f, 16, 0);
    purgerEchos(f, 0.15); // le premier (1,25 s) part
    expect(f.nEchos).toBe(2);
    expect(new Set(f.echos).size).toBe(RADAR_CAPACITES.echos);
    expect(f.echos.slice(0, 2).map((e) => e.x).sort((a, b) => a - b)).toEqual([8, 16]);
  });
});

describe("voitures", () => {
  it("PNJ : filtrées à 100 m de moi, 12 au plus", () => {
    const f = creerRadarFrame();
    f.x = 50; f.z = 50;
    expect(RADAR_PORTEES.pnjM).toBe(100);
    expect(ajouterVoiturePnj(f, 50 + 99, 50, 1)).toBe(true);
    expect(ajouterVoiturePnj(f, 50 + 101, 50, 1)).toBe(false);
    expect(f.nPnj).toBe(1);
    expect(Array.from(f.voituresPnj.slice(0, 3))).toEqual([149, 50, 1]);
    for (let i = 0; i < 20; i++) ajouterVoiturePnj(f, 50, 50, 0);
    expect(f.nPnj).toBe(12);
  });
  it("conduisibles : à moins de 160 m, la mienne toujours gardée", () => {
    const f = creerRadarFrame();
    const v = { id: 1, x: 150, z: 0, cap: 0, occupants: 2, places: 4, moi: false };
    expect(ajouterVoiture(f, v)).toBe(true);
    expect(ajouterVoiture(f, { ...v, id: 2, x: 161 })).toBe(false);
    expect(ajouterVoiture(f, { ...v, id: 3, x: 500, moi: true })).toBe(true);
    expect(f.nVoitures).toBe(2);
    expect(f.voitures[1]).toMatchObject({ id: 3, moi: true });
  });
});

describe("Elsa", () => {
  it("repereElsa : angle relatif à la vue (0 = devant, + = droite), distance arrondie à 10 m", () => {
    // lacet 0 = regard vers −z : Elsa au nord → devant
    expect(repereElsa(0, 0, 0, { x: 0, z: -100 }).angle).toBeCloseTo(0, 9);
    expect(repereElsa(0, 0, 0, { x: 100, z: 0 }).angle).toBeCloseTo(Math.PI / 2, 9);
    expect(repereElsa(0, 0, 0, { x: -100, z: 0 }).angle).toBeCloseTo(-Math.PI / 2, 9);
    expect(Math.abs(repereElsa(0, 0, 0, { x: 0, z: 100 }).angle)).toBeCloseTo(Math.PI, 9);
    // lacet π/2 : regard vers −x ; Elsa à l'ouest → devant
    expect(repereElsa(0, 0, Math.PI / 2, { x: -100, z: 0 }).angle).toBeCloseTo(0, 9);
    expect(repereElsa(0, 0, 0, { x: 2, z: 3 }).distance).toBe(0);
    expect(repereElsa(0, 0, 0, { x: 300, z: 400 }).distance).toBe(500);
    expect(repereElsa(0, 0, 0, { x: 0, z: -344 }).distance).toBe(340);
    expect(repereElsa(0, 0, 0, { x: 0, z: -346 }).distance).toBe(350);
    expect(repereElsa(5, 5, 1, { x: 5, z: 5 })).toEqual({ angle: 0, distance: 0 });
  });
  it("definirElsa remplit l'offre avec angle et distance, null hors offre", () => {
    const f = creerRadarFrame();
    f.x = 0; f.z = 0; f.lacet = 0; f.elsaPos = { x: 0, z: -123 };
    definirElsa(f, { genre: "arme", finT: 42 });
    expect(f.elsa).toMatchObject({ x: 0, z: -123, genre: "arme", finT: 42, distance: 120 });
    expect(f.elsa!.angle).toBeCloseTo(0, 9);
    definirElsa(f, null);
    expect(f.elsa).toBeNull();
  });
});
