import { describe, expect, it } from "vitest";
import { aleaGraine } from "../agroparc3d/cachettes";
import { STATS } from "./armes";
import {
  ELSA, avancerElsa, creerElsa, intervalleAleatoire, munitionsOffertes, peutRamasser, prendre, reinitialiserElsa, type EtatElsa,
} from "./elsa";
import { ARMES_SPECIALES } from "./protocole";

describe("constantes (spec §2.7)", () => {
  it("20-50 s, offre de 40 s, 2,5 m, 40 % de soin", () => {
    expect(ELSA.intervalleMinMs).toBe(20_000);
    expect(ELSA.intervalleMaxMs).toBe(50_000);
    expect(ELSA.dureeOffreMs).toBe(40_000);
    expect(ELSA.rayonRamassage).toBe(2.5);
    expect(ELSA.hauteurRamassageMax).toBe(3);
    expect(ELSA.probaSoin).toBe(0.4);
  });
});

describe("intervalleAleatoire", () => {
  it("dans [20 s ; 50 s] aux bornes et en général", () => {
    expect(intervalleAleatoire(() => 0)).toBe(20_000);
    expect(intervalleAleatoire(() => 1)).toBe(50_000);
    expect(intervalleAleatoire(() => 0.5)).toBe(35_000);
    const alea = aleaGraine(1);
    for (let k = 0; k < 1000; k++) {
      const v = intervalleAleatoire(alea);
      expect(v).toBeGreaterThanOrEqual(20_000);
      expect(v).toBeLessThanOrEqual(50_000);
    }
  });
  it("intervalle surchargé", () => {
    expect(intervalleAleatoire(() => 0.5, { minMs: 100, maxMs: 300 })).toBe(200);
    const e = creerElsa(0, 0, 1000, () => 0, { minMs: 100, maxMs: 300 });
    expect(e.prochaineT).toBe(1100);
  });
});

describe("creerElsa", () => {
  it("position, échéance dans 20-50 s, pas d'offre", () => {
    const e = creerElsa(-120, 39, 5000, () => 0.5);
    expect(e).toEqual({ x: -120, z: 39, prochaineT: 40_000, offre: null, compteur: 0 });
  });
});

describe("avancerElsa", () => {
  it("rien avant l'échéance, offre de 40 s à l'échéance", () => {
    const e = creerElsa(0, 0, 0, () => 0); // échéance à 20 s
    expect(avancerElsa(e, 19_999, () => 0.5, true)).toBeNull();
    const ev = avancerElsa(e, 20_000, () => 0.9, true);
    expect(ev?.type).toBe("apparue");
    expect(e.offre).toBe(ev!.offre);
    expect(ev!.offre.finT).toBe(60_000);
    expect(ev!.offre.id).toBe(1);
    expect(e.compteur).toBe(1);
  });
  it("soin si alea < 0,4, sinon arme spéciale (l'alea suivant la choisit)", () => {
    const soin = creerElsa(0, 0, 0, () => 0);
    expect(avancerElsa(soin, 20_000, () => 0.39, true)!.offre).toMatchObject({ genre: "soin" });
    expect(soin.offre!.arme).toBeUndefined();
    const arme = creerElsa(0, 0, 0, () => 0);
    const suite = [0.4, 0.5];
    const ev = avancerElsa(arme, 20_000, () => suite.shift()!, true)!;
    expect(ev.offre.genre).toBe("arme");
    expect(ev.offre.arme).toBe(ARMES_SPECIALES[1]);
  });
  it("l'offre expire après 40 s, une nouvelle échéance est armée", () => {
    const e = creerElsa(0, 0, 0, () => 0);
    avancerElsa(e, 20_000, () => 0.9, true);
    const offre = e.offre!;
    expect(avancerElsa(e, 59_999, () => 0.5, true)).toBeNull();
    expect(e.offre).toBe(offre);
    const ev = avancerElsa(e, 60_000, () => 0.5, true);
    expect(ev).toEqual({ type: "expiree", offre });
    expect(e.offre).toBeNull();
    expect(e.prochaineT).toBe(60_000 + 35_000);
  });
  it("l'offre expire même si le jeu devient inactif", () => {
    const e = creerElsa(0, 0, 0, () => 0);
    avancerElsa(e, 20_000, () => 0.9, true);
    expect(avancerElsa(e, 61_000, () => 0, false)?.type).toBe("expiree");
  });
  it("inactif : ne crée rien et repousse l'échéance", () => {
    const e = creerElsa(0, 0, 0, () => 0);
    expect(avancerElsa(e, 25_000, () => 0.5, false)).toBeNull();
    expect(e.offre).toBeNull();
    expect(e.compteur).toBe(0);
    expect(e.prochaineT).toBe(25_000 + 35_000);
    // redevenu actif juste après : pas d'offre immédiate
    expect(avancerElsa(e, 26_000, () => 0.5, true)).toBeNull();
    expect(avancerElsa(e, 60_000, () => 0.9, true)?.type).toBe("apparue");
  });
  it("ids croissants d'une offre à l'autre", () => {
    const e = creerElsa(0, 0, 0, () => 0);
    let t = 0;
    const ids: number[] = [];
    for (let k = 0; k < 4; k++) {
      t = e.prochaineT;
      ids.push(avancerElsa(e, t, () => 0, true)!.offre.id);
      prendre(e, t, () => 0);
    }
    expect(ids).toEqual([1, 2, 3, 4]);
  });
  it("répartition 40 % soin / 60 % arme sur 10 000 tirages (± 3 %), armes uniformes", () => {
    const alea = aleaGraine(2024);
    let soins = 0;
    const armes: Record<string, number> = {};
    const e = creerElsa(0, 0, 0, alea);
    for (let k = 0; k < 10_000; k++) {
      e.offre = null;
      e.prochaineT = 0;
      const o = avancerElsa(e, 0, alea, true)!.offre;
      if (o.genre === "soin") soins++;
      else armes[o.arme!] = (armes[o.arme!] ?? 0) + 1;
    }
    expect(soins / 10_000).toBeGreaterThan(0.37);
    expect(soins / 10_000).toBeLessThan(0.43);
    expect(Object.keys(armes).sort()).toEqual([...ARMES_SPECIALES].sort());
    for (const n of Object.values(armes)) expect(n / (10_000 - soins)).toBeGreaterThan(0.3);
  });
  it("déterministe pour une même graine", () => {
    const suite = (g: number) => {
      const alea = aleaGraine(g);
      const e = creerElsa(0, 0, 0, alea);
      const sortie: unknown[] = [];
      for (let t = 0; t < 600_000; t += 1000) sortie.push(avancerElsa(e, t, alea, true));
      return sortie;
    };
    expect(suite(5)).toEqual(suite(5));
    expect(suite(5)).not.toEqual(suite(6));
  });
});

describe("peutRamasser", () => {
  const etatAvecOffre = (): EtatElsa => {
    const e = creerElsa(-120, 39, 0, () => 0);
    avancerElsa(e, 20_000, () => 0.9, true);
    return e;
  };
  it("2,4 m oui, 2,5 m oui, 2,6 m non (horizontal)", () => {
    const e = etatAvecOffre();
    expect(peutRamasser(e, [-120 + 2.4, 0, 39], 21_000)).toBe(true);
    expect(peutRamasser(e, [-120, 0, 39 - 2.5], 21_000)).toBe(true);
    expect(peutRamasser(e, [-120 + 2.6, 0, 39], 21_000)).toBe(false);
    expect(peutRamasser(e, [-120 + 1.9, 0, 39 + 1.9], 21_000)).toBe(false); // 2,69 m en diagonale
  });
  it("|dy| ≥ 3 non", () => {
    const e = etatAvecOffre();
    expect(peutRamasser(e, [-120, 2.9, 39], 21_000)).toBe(true);
    expect(peutRamasser(e, [-120, 3, 39], 21_000)).toBe(false);
    expect(peutRamasser(e, [-120, -3.5, 39], 21_000)).toBe(false);
  });
  it("pas d'offre ou offre expirée non", () => {
    const sans = creerElsa(-120, 39, 0, () => 0);
    expect(peutRamasser(sans, [-120, 0, 39], 1000)).toBe(false);
    const e = etatAvecOffre();
    expect(peutRamasser(e, [-120, 0, 39], 59_999)).toBe(true);
    expect(peutRamasser(e, [-120, 0, 39], 60_000)).toBe(false);
  });
});

describe("prendre / reinitialiserElsa", () => {
  it("prendre retire l'offre, ré-arme le minuteur, renvoie l'offre", () => {
    const e = creerElsa(0, 0, 0, () => 0);
    const ev = avancerElsa(e, 20_000, () => 0.9, true)!;
    const prise = prendre(e, 25_000, () => 0.5);
    expect(prise).toBe(ev.offre);
    expect(e.offre).toBeNull();
    expect(e.prochaineT).toBe(25_000 + 35_000);
    // plus rien à prendre, minuteur intact
    expect(prendre(e, 26_000, () => 0)).toBeNull();
    expect(e.prochaineT).toBe(60_000);
  });
  it("reinitialiserElsa efface l'offre et ré-arme, le compteur continue", () => {
    const e = creerElsa(0, 0, 0, () => 0);
    avancerElsa(e, 20_000, () => 0.9, true);
    reinitialiserElsa(e, 30_000, () => 0, { minMs: 1000, maxMs: 2000 });
    expect(e.offre).toBeNull();
    expect(e.prochaineT).toBe(31_000);
    expect(e.compteur).toBe(1);
    expect(avancerElsa(e, 31_000, () => 0.9, true)!.offre.id).toBe(2);
  });
});

describe("munitionsOffertes", () => {
  it("= chargeur de l'arme (munitions totales des armes sans recharge)", () => {
    for (const a of ARMES_SPECIALES) {
      expect(munitionsOffertes(a)).toBe(STATS[a].chargeur);
      expect(munitionsOffertes(a)).toBeGreaterThan(0);
    }
  });
});
