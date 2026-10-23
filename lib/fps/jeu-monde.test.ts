import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { construireCircuits, etatVoiture, flotte, T0_MS } from "./circulation";
import { construireMonde } from "./collision";
import { DISTANCE_INVITE_ELSA_M, MondeJeu } from "./jeu-monde";
import { JEU, PLAFONDS, type EtatElsaMsg, type Vec3, type VehiculeSnap } from "./protocole";
import { VEH } from "./vehicule";
import { positionElsa } from "./zones";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMonde(scene);
const creer = () => new MondeJeu(scene, monde);
const [EX, EZ] = positionElsa(scene);
/** Horloge serveur réaliste (≈ 2026). */
const T = 1_800_000_000_000;

const offre = (finT: number): EtatElsaMsg => ({ x: EX, z: EZ, offre: { id: 1, genre: "soin", finT } });
/** voiture à l'arrêt, cap 0 (avant vers −z) */
const voiture = (id: number, x: number, z: number, cap = 0, v = 0): VehiculeSnap => ({ id, p: [x, 0, z], cap, v });
/** point à `d` mètres de la caisse d'une voiture posée en (0, 0) (côté +x ; la caisse fait 1,9 m de large) */
const aDistanceDe = (d: number): Vec3 => [VEH.largeur / 2 + d, 0, 0];

describe("MondeJeu : voitures PNJ", () => {
  it("12 états, dans l'ordre de flotte, identiques à etatVoiture du serveur", () => {
    const m = creer();
    const circuits = construireCircuits();
    const voitures = flotte(circuits);
    for (const t of [T0_MS, T, T + 1234, T + 3_600_000]) {
      const etats = m.etatsPnj(t);
      expect(etats).toHaveLength(12);
      etats.forEach((e, i) => expect(e).toEqual(etatVoiture(circuits[voitures[i].circuit], voitures[i], t)));
    }
  });

  it("est déterministe et sans état : même instant, mêmes voitures, quelles que soient les requêtes précédentes", () => {
    const m = creer(), n = creer();
    m.etatsPnj(T + 50_000);
    expect(m.etatsPnj(T)).toEqual(n.etatsPnj(T));
  });

  it("les voitures avancent à vitesse constante et restent au sol", () => {
    const m = creer();
    const a = m.etatsPnj(T), b = m.etatsPnj(T + 100);
    a.forEach((e, i) => {
      expect(e.p[1]).toBe(0);
      expect(e.v).toBeGreaterThan(0);
      expect(Math.hypot(b[i].p[0] - e.p[0], b[i].p[2] - e.p[2])).toBeLessThan(e.v * 0.1 + 0.05);
    });
  });

  it("n'est pas touchée par reinitialiser (horloge serveur)", () => {
    const m = creer();
    const avant = m.etatsPnj(T);
    m.reinitialiser();
    expect(m.etatsPnj(T)).toEqual(avant);
  });
});

describe("MondeJeu : voitures conduisibles", () => {
  it("interpole entre deux snaps", () => {
    const m = creer();
    m.alimenterVehicules(T, [voiture(2, 0, 0, 0, 10)]);
    m.alimenterVehicules(T + 50, [voiture(2, 0, -0.5, 0, 10)]);
    m.alimenterVehicules(T + 100, [voiture(2, 0, -1, 0, 10)]);
    const v = m.vehiculesA(T + 25).get(2)!;
    expect(v.p[2]).toBeCloseTo(-0.25, 6);
    expect(v.v).toBe(10);
  });

  it("interpole l'angle par le plus court chemin", () => {
    const m = creer();
    m.alimenterVehicules(T, [voiture(1, 0, 0, Math.PI - 0.1)]);
    m.alimenterVehicules(T + 100, [voiture(1, 0, 0, -Math.PI + 0.1)]);
    const cap = m.vehiculesA(T + 50).get(1)!.cap;
    expect(Math.abs(Math.abs(cap) - Math.PI)).toBeLessThan(1e-6);
  });

  it("ne lisse pas un saut (remise en place à 60 s, nouveau match)", () => {
    const m = creer();
    m.alimenterVehicules(T, [voiture(3, 0, 0)]);
    m.alimenterVehicules(T + 50, [voiture(3, 120, 0)]);
    expect(120).toBeGreaterThan(PLAFONDS.vitesseVehiculeMax * 0.05 + 3);
    expect(m.vehiculesA(T + 25).get(3)!.p[0]).toBe(120);
  });

  it("extrapole au plus 150 ms au-delà du dernier snap", () => {
    const m = creer();
    m.alimenterVehicules(T, [voiture(1, 0, 0, 0, 10)]);
    expect(m.vehiculesA(T + 100).get(1)!.p[2]).toBeCloseTo(-1, 6);
    expect(m.vehiculesA(T + 5000).get(1)!.p[2]).toBeCloseTo(-1.5, 6);
  });

  it("un snap sans vehicules (undefined) est ignoré : les voitures ne disparaissent pas", () => {
    const m = creer();
    m.alimenterVehicules(T, [voiture(1, 5, 5), voiture(2, 9, 9)]);
    m.alimenterVehicules(T + 100, undefined);
    expect(m.vehiculesA(T + 50).size).toBe(2);
  });

  it("une voiture absente du dernier snap disparaît", () => {
    const m = creer();
    m.alimenterVehicules(T, [voiture(1, 0, 0), voiture(2, 9, 9)]);
    m.alimenterVehicules(T + 50, [voiture(1, 0, 0)]);
    expect([...m.vehiculesA(T + 25).keys()]).toEqual([1]);
  });

  it("ne garde pas de référence aux snaps reçus", () => {
    const m = creer();
    const s = voiture(1, 4, 0);
    m.alimenterVehicules(T, [s]);
    s.p[0] = 99;
    expect(m.vehiculesA(T).get(1)!.p[0]).toBe(4);
  });
});

describe("MondeJeu : sièges", () => {
  it("siegesDe : quatre places libres pour une voiture inconnue", () => {
    expect(creer().siegesDe(7)).toEqual([null, null, null, null]);
  });

  it("majSieges remplace l'état complet", () => {
    const m = creer();
    m.majSieges([{ id: 1, sieges: ["a", null, "b", null] }, { id: 2, sieges: ["c", null, null, null] }]);
    expect(m.siegesDe(1)).toEqual(["a", null, "b", null]);
    expect(m.siegesDe(2)).toEqual(["c", null, null, null]);
    m.majSieges([{ id: 2, sieges: [null, null, null, null] }]);
    expect(m.siegesDe(1)).toEqual([null, null, null, null]);
    expect(m.siegesDe(2)).toEqual([null, null, null, null]);
  });

  it("copie le message reçu", () => {
    const m = creer();
    const info = { id: 1, sieges: ["a", null, null, null] };
    m.majSieges([info]);
    info.sieges[1] = "pirate";
    expect(m.siegesDe(1)[1]).toBeNull();
  });
});

describe("MondeJeu : Elsa", () => {
  it("position par défaut : celle de la scène (truck + 5 m), sans message", () => {
    const m = creer();
    expect(m.position()).toEqual({ x: EX, z: EZ });
    expect(m.elsa()).toBeNull();
  });

  it("position et état suivent le dernier message", () => {
    const m = creer();
    m.majElsa({ x: 10, z: 20, offre: { id: 3, genre: "arme", arme: "railgun", finT: T + 40_000 } });
    expect(m.position()).toEqual({ x: 10, z: 20 });
    expect(m.elsa()!.offre!.arme).toBe("railgun");
  });

  it("majElsa(null) retire l'offre mais garde la position ; avant tout message, ne fait rien", () => {
    const m = creer();
    m.majElsa(null);
    expect(m.elsa()).toBeNull();
    m.majElsa({ x: 10, z: 20, offre: { id: 3, genre: "soin", finT: T + 1000 } });
    m.majElsa(null);
    expect(m.elsa()).toEqual({ x: 10, z: 20, offre: null });
    expect(m.position()).toEqual({ x: 10, z: 20 });
  });

  it("copie le message reçu", () => {
    const m = creer();
    const msg = offre(T + 1000);
    m.majElsa(msg);
    msg.offre!.finT = 0;
    expect(m.elsa()!.offre!.finT).toBe(T + 1000);
  });

  describe("repereElsa", () => {
    it("distance -1 sans offre (jamais reçue, offre nulle, majElsa(null))", () => {
      const m = creer();
      expect(m.repereElsa([EX, 0, EZ + 50], 0).elsaDistance).toBe(-1);
      m.majElsa({ x: EX, z: EZ, offre: null });
      expect(m.repereElsa([EX, 0, EZ + 50], 0).elsaDistance).toBe(-1);
      m.majElsa(offre(T + 1000));
      m.majElsa(null);
      expect(m.repereElsa([EX, 0, EZ + 50], 0).elsaDistance).toBe(-1);
    });

    it("distance arrondie à 10 m", () => {
      const m = creer();
      m.majElsa(offre(T + 1000));
      expect(m.repereElsa([EX, 0, EZ + 33], 0).elsaDistance).toBe(30);
      expect(m.repereElsa([EX, 0, EZ + 37], 0).elsaDistance).toBe(40);
      expect(m.repereElsa([EX, 0, EZ + 104], 0).elsaDistance).toBe(100);
      expect(m.repereElsa([EX, 0, EZ + 2], 0).elsaDistance).toBe(0);
    });

    it("angle relatif au regard : 0 devant, + à droite, ±π derrière", () => {
      const m = creer();
      m.majElsa(offre(T + 1000));
      // lacet 0 : on regarde vers −z, la droite est +x
      expect(m.repereElsa([EX, 0, EZ + 40], 0).elsaAngle).toBeCloseTo(0, 6); // Elsa au −z : devant
      expect(m.repereElsa([EX - 40, 0, EZ], 0).elsaAngle).toBeCloseTo(Math.PI / 2, 6); // Elsa à +x : à droite
      expect(m.repereElsa([EX + 40, 0, EZ], 0).elsaAngle).toBeCloseTo(-Math.PI / 2, 6); // à gauche
      expect(Math.abs(m.repereElsa([EX, 0, EZ - 40], 0).elsaAngle)).toBeCloseTo(Math.PI, 6); // derrière
    });

    it("tourner la tête décale l'angle d'autant", () => {
      const m = creer();
      m.majElsa(offre(T + 1000));
      const p: Vec3 = [EX, 0, EZ + 40];
      const a0 = m.repereElsa(p, 0).elsaAngle;
      const a1 = m.repereElsa(p, 0.5).elsaAngle;
      expect(Math.abs(a1 - a0)).toBeCloseTo(0.5, 6);
    });

    it("ignore une offre échue quand l'horloge est donnée", () => {
      const m = creer();
      m.majElsa(offre(T + 1000));
      expect(m.repereElsa([EX, 0, EZ + 40], 0, T + 999).elsaDistance).toBe(40);
      expect(m.repereElsa([EX, 0, EZ + 40], 0, T + 1000).elsaDistance).toBe(-1);
    });
  });
});

describe("MondeJeu : invite", () => {
  it("rien : pas d'Elsa, pas de voiture", () => {
    const m = creer();
    expect(m.invite([0, 0, 0], null, T)).toEqual({ invite: "", detail: "", vehicule: null });
  });

  it("Elsa à 5 m avec une offre : « elsa »", () => {
    const m = creer();
    m.majElsa(offre(T + 10_000));
    expect(m.invite([EX + 5, 0, EZ], null, T).invite).toBe("elsa");
    expect(m.invite([EX, 0, EZ - 5.9], null, T).invite).toBe("elsa");
  });

  it("Elsa à 6 m ou plus : rien", () => {
    const m = creer();
    m.majElsa(offre(T + 10_000));
    expect(m.invite([EX + DISTANCE_INVITE_ELSA_M, 0, EZ], null, T).invite).toBe("");
    expect(m.invite([EX + 20, 0, EZ], null, T).invite).toBe("");
  });

  it("Elsa sans offre ou offre échue : rien", () => {
    const m = creer();
    m.majElsa({ x: EX, z: EZ, offre: null });
    expect(m.invite([EX + 2, 0, EZ], null, T).invite).toBe("");
    m.majElsa(offre(T + 1000));
    expect(m.invite([EX + 2, 0, EZ], null, T + 1000).invite).toBe("");
    expect(m.invite([EX + 2, 0, EZ], null, T + 999).invite).toBe("elsa");
  });

  it("voiture à 3 m : « monter » avec le nombre d'occupants sur 4", () => {
    const m = creer();
    m.alimenterVehicules(T, [voiture(5, 0, 0)]);
    m.alimenterVehicules(T + 100, [voiture(5, 0, 0)]);
    m.majSieges([{ id: 5, sieges: ["a", null, "b", null] }]);
    expect(m.invite(aDistanceDe(3), null, T + 100 + JEU.interpolationMs)).toEqual({ invite: "monter", detail: "2/4", vehicule: 5 });
  });

  it("voiture inconnue des sièges : 0/4 ; pleine : 4/4 (le serveur refusera)", () => {
    const m = creer();
    m.alimenterVehicules(T, [voiture(5, 0, 0)]);
    expect(m.invite(aDistanceDe(1), null, T + JEU.interpolationMs).detail).toBe("0/4");
    m.majSieges([{ id: 5, sieges: ["a", "b", "c", "d"] }]);
    expect(m.invite(aDistanceDe(1), null, T + JEU.interpolationMs)).toEqual({ invite: "monter", detail: "4/4", vehicule: 5 });
  });

  it("voiture trop loin (au-delà de distanceMontee de la caisse) : rien ; juste en deçà : monter", () => {
    const m = creer();
    m.alimenterVehicules(T, [voiture(5, 0, 0)]);
    const t = T + JEU.interpolationMs;
    expect(m.invite(aDistanceDe(VEH.distanceMontee + 0.2), null, t).invite).toBe("");
    expect(m.invite(aDistanceDe(VEH.distanceMontee - 0.01), null, t).invite).toBe("monter");
  });

  it("la distance se mesure à la caisse, pas au centre : 4 m du centre, 3,05 m de la caisse", () => {
    const m = creer();
    m.alimenterVehicules(T, [voiture(5, 0, 0)]);
    expect(m.invite([4.0, 0, 0], null, T + JEU.interpolationMs).invite).toBe("monter");
  });

  it("plusieurs voitures à portée : la plus proche", () => {
    const m = creer();
    m.alimenterVehicules(T, [voiture(1, 0, 0), voiture(2, 5, 0)]);
    const t = T + JEU.interpolationMs;
    expect(m.invite([1.8, 0, 0], null, t).vehicule).toBe(1);
    expect(m.invite([3.2, 0, 0], null, t).vehicule).toBe(2);
  });

  it("en véhicule : « descendre », même avec Elsa ou une autre voiture à côté", () => {
    const m = creer();
    m.majElsa(offre(T + 10_000));
    m.alimenterVehicules(T, [voiture(1, EX, EZ)]);
    for (const s of [0, 1, 2, 3] as const) {
      expect(m.invite([EX, 0, EZ], s, T)).toEqual({ invite: "descendre", detail: "", vehicule: null });
    }
  });

  it("Elsa prime sur une voiture quand les deux sont à portée", () => {
    const m = creer();
    m.majElsa(offre(T + 10_000));
    m.alimenterVehicules(T, [voiture(1, EX + 2, EZ)]);
    expect(m.invite([EX + 3, 0, EZ], null, T + JEU.interpolationMs).invite).toBe("elsa");
  });

  it("un point très au-dessus du toit n'est pas à portée (écart vertical compté)", () => {
    const m = creer();
    m.alimenterVehicules(T, [voiture(1, 0, 0)]);
    expect(m.invite([0, 30, 0], null, T + JEU.interpolationMs).invite).toBe("");
  });
});

describe("MondeJeu : reinitialiser", () => {
  it("vide voitures, sièges et offre ; Elsa revient à sa place de la scène", () => {
    const m = creer();
    m.alimenterVehicules(T, [voiture(1, 0, 0)]);
    m.majSieges([{ id: 1, sieges: ["a", null, null, null] }]);
    m.majElsa({ x: 1, z: 2, offre: { id: 1, genre: "soin", finT: T + 1000 } });
    m.reinitialiser();
    expect(m.vehiculesA(T).size).toBe(0);
    expect(m.siegesDe(1)).toEqual([null, null, null, null]);
    expect(m.elsa()).toBeNull();
    expect(m.position()).toEqual({ x: EX, z: EZ });
    expect(m.repereElsa([0, 0, 0], 0).elsaDistance).toBe(-1);
    expect(m.invite([EX, 0, EZ], null, T).invite).toBe("");
  });

  it("reste utilisable ensuite", () => {
    const m = creer();
    m.reinitialiser();
    m.alimenterVehicules(T, [voiture(1, 0, 0)]);
    expect(m.vehiculesA(T).size).toBe(1);
    m.majElsa(offre(T + 1000));
    expect(m.invite([EX, 0, EZ], null, T).invite).toBe("elsa");
  });
});
