import { describe, expect, it } from "vitest";
import {
  KILLCAM, avancerKillcam, cameraTueur, debutRejeu, demarrerKillcam, passerKillcam, progressionKillcam, tempsRejeuServeur, tueurPresent,
  type Killcam,
} from "./killcam";
import type { EtatJoueurSnap, InfoTueur } from "./protocole";
import { JEU, OEIL_SIEGE, SILHOUETTE, SILHOUETTE_ACCROUPIE } from "./protocole";

const T_MORT = 123_456;
const TUEUR: InfoTueur = { id: "j2", pseudo: "Zed", couleur: "#f00", p: [1, 0, 2], lacet: 0.3, tangage: -0.1, arme: "sniper", pv: 40, bouclier: 0, distance: 32 };

const avecRejeu = () => demarrerKillcam({ tueurId: "j2", tueur: TUEUR, tMortServeur: T_MORT, tueurDansTampon: true });
const sansRejeu = () => demarrerKillcam({ tueurId: "", tMortServeur: T_MORT, tueurDansTampon: false });

function etat(extra: Partial<EtatJoueurSnap> = {}): EtatJoueurSnap {
  return {
    id: "j2", p: [10, 3, -4], v: [0, 0, 0], lacet: 1.2, tangage: -0.4, posture: "sol", mur: 0,
    arme: "sniper", pv: 100, vivant: true, protege: false, ...extra,
  };
}

describe("constantes", () => {
  it("3 s de rejeu (dont 0,5 s après la mort) + 1 s de carte = délai de réapparition", () => {
    expect(KILLCAM.rejeuMs + KILLCAM.carteMs).toBe(JEU.delaiReapparitionMs);
    expect(KILLCAM.tamponMs).toBeGreaterThan(KILLCAM.rejeuMs);
    expect(KILLCAM.apresMortMs).toBeGreaterThan(0);
    expect(KILLCAM.apresMortMs).toBeLessThan(KILLCAM.rejeuMs);
    // le tampon gèle après avoir reçu la fin du rejeu (snap de `apresMortMs` après la mort, plus son trajet)
    expect(KILLCAM.gelApresMortMs).toBeGreaterThan(KILLCAM.apresMortMs + 300);
  });
});

describe("machine de la killcam", () => {
  it("démarre en rejeu quand le tueur est dans le tampon", () => {
    const k = avecRejeu();
    expect(k).toMatchObject({ tueurId: "j2", tueur: TUEUR, tMortServeur: T_MORT, avecRejeu: true, ecouleMs: 0, phase: "rejeu" });
  });

  it("rejeu 3 s → carte 1 s → terminé", () => {
    let k = avecRejeu();
    k = avancerKillcam(k, 2.9);
    expect(k.phase).toBe("rejeu");
    k = avancerKillcam(k, 0.1);
    expect(k.ecouleMs).toBeCloseTo(3000, 6);
    expect(k.phase).toBe("carte");
    k = avancerKillcam(k, 0.9);
    expect(k.phase).toBe("carte");
    k = avancerKillcam(k, 0.1);
    expect(k.phase).toBe("termine");
    // jamais au-delà
    k = avancerKillcam(k, 10);
    expect(k.ecouleMs).toBe(KILLCAM.rejeuMs + KILLCAM.carteMs);
    expect(k.phase).toBe("termine");
  });

  it("est pur : renvoie un nouvel objet sans toucher à l'ancien", () => {
    const k = avecRejeu();
    const k2 = avancerKillcam(k, 1);
    expect(k.ecouleMs).toBe(0);
    expect(k2).not.toBe(k);
    expect(k2.ecouleMs).toBe(1000);
    const k3 = passerKillcam(k);
    expect(k.phase).toBe("rejeu");
    expect(k3).not.toBe(k);
  });

  it("temps négatif ou non fini : n'avance pas", () => {
    for (const dt of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(avancerKillcam(avecRejeu(), dt).ecouleMs).toBe(0);
    }
  });

  it("passerKillcam saute le rejeu pour la carte, sans raccourcir l'attente", () => {
    const k = passerKillcam(avancerKillcam(avecRejeu(), 0.5));
    expect(k.phase).toBe("carte");
    expect(k.ecouleMs).toBe(KILLCAM.rejeuMs);
    // la carte garde sa seconde
    expect(avancerKillcam(k, 0.9).phase).toBe("carte");
    expect(avancerKillcam(k, 1).phase).toBe("termine");
    // sans effet en carte et une fois terminé
    expect(passerKillcam(k)).toEqual(k);
    const fin = avancerKillcam(avecRejeu(), 10);
    expect(passerKillcam(fin).phase).toBe("termine");
  });

  it("repli sans rejeu : carte d'emblée, tueur null, carte jusqu'à la fin de l'attente", () => {
    let k = sansRejeu();
    expect(k).toMatchObject({ avecRejeu: false, phase: "carte", tueur: null });
    k = avancerKillcam(k, 3.9);
    expect(k.phase).toBe("carte");
    k = avancerKillcam(k, 0.1);
    expect(k.phase).toBe("termine");
    // passer n'a rien à sauter
    expect(passerKillcam(sansRejeu()).phase).toBe("carte");
    expect(passerKillcam(sansRejeu()).ecouleMs).toBe(0);
  });

  it("tueur absent du tampon mais carte connue : repli avec la carte", () => {
    const k = demarrerKillcam({ tueurId: "j2", tueur: TUEUR, tMortServeur: T_MORT, tueurDansTampon: false });
    expect(k.phase).toBe("carte");
    expect(k.tueur).toBe(TUEUR);
  });

  it("tempsRejeuServeur : monotone de tMort − 2500 à tMort + 500 (on voit la victime tomber), figé en carte", () => {
    let k: Killcam = avecRejeu();
    expect(tempsRejeuServeur(k)).toBe(T_MORT - 2500);
    expect(debutRejeu(T_MORT)).toBe(T_MORT - 2500);
    let prec = tempsRejeuServeur(k);
    for (let i = 0; i < 360; i++) {
      k = avancerKillcam(k, 1 / 60);
      const t = tempsRejeuServeur(k);
      expect(t).toBeGreaterThanOrEqual(prec);
      expect(t).toBeLessThanOrEqual(T_MORT + KILLCAM.apresMortMs);
      prec = t;
    }
    expect(tempsRejeuServeur(k)).toBe(T_MORT + KILLCAM.apresMortMs);
    // 1× : 1 s écoulée = 1000 ms de temps serveur
    expect(tempsRejeuServeur(avancerKillcam(avecRejeu(), 1))).toBeCloseTo(T_MORT - 1500, 6);
    // passer : on est à la fin du rejeu
    expect(tempsRejeuServeur(passerKillcam(avecRejeu()))).toBe(T_MORT + KILLCAM.apresMortMs);
  });

  it("progression 0..1 sur rejeu + carte", () => {
    let k = avecRejeu();
    expect(progressionKillcam(k)).toBe(0);
    k = avancerKillcam(k, 2);
    expect(progressionKillcam(k)).toBeCloseTo(0.5, 10);
    k = avancerKillcam(k, 10);
    expect(progressionKillcam(k)).toBe(1);
    expect(progressionKillcam({ ...k, ecouleMs: -5 })).toBe(0);
    expect(progressionKillcam(sansRejeu())).toBe(0);
    expect(progressionKillcam(avancerKillcam(sansRejeu(), 2))).toBeCloseTo(0.5, 10);
  });
});

describe("cameraTueur", () => {
  it("debout : œil à 1,95 m au-dessus des pieds, angles recopiés", () => {
    const c = cameraTueur(etat());
    expect(c.pos).toEqual([10, 3 + SILHOUETTE.oeil, -4]);
    expect(c.lacet).toBe(1.2);
    expect(c.tangage).toBe(-0.4);
  });
  it("accroupi : œil abaissé", () => {
    const c = cameraTueur(etat({ accroupi: true }));
    expect(c.pos[1]).toBeCloseTo(3 + SILHOUETTE_ACCROUPIE.oeil, 10);
    expect(c.pos[1]).toBeLessThan(3 + SILHOUETTE.oeil);
  });
  it("assis : p est la position du siège, œil à OEIL_SIEGE (même si accroupi)", () => {
    const c = cameraTueur(etat({ vehicule: { id: 2, siege: 0 }, accroupi: true }));
    expect(c.pos).toEqual([10, 3 + OEIL_SIEGE, -4]);
  });
  it("ne modifie pas l'état reçu", () => {
    const e = etat();
    const c = cameraTueur(e);
    c.pos[0] = 999;
    expect(e.p[0]).toBe(10);
  });
});

describe("tueurPresent", () => {
  it("vrai seulement si l'échantillon contient le tueur", () => {
    const ech = new Map<string, EtatJoueurSnap>([["j2", etat()], ["j3", etat({ id: "j3" })]]);
    expect(tueurPresent(ech, "j2")).toBe(true);
    expect(tueurPresent(ech, "j9")).toBe(false);
    expect(tueurPresent(new Map(), "j2")).toBe(false);
    expect(tueurPresent(ech, "")).toBe(false);
  });
});
