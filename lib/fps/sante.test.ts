import { describe, expect, it } from "vitest";
import { JEU } from "./protocole";
import {
  appliquerDegats, memoriserSante, REGEN, regenerer, reinitialiserSante, restaurerSante, santeInitiale, soinComplet, tuer,
  type Sante,
} from "./sante";

/** Joue la régénération à 60 Hz de `t0` pendant `dureeMs` ; rend l'instant final. */
function jouer(s: Sante, t0: number, dureeMs: number): number {
  let t = t0;
  const fin = t0 + dureeMs;
  while (t < fin - 1e-6) {
    const dt = Math.min(1000 / 60, fin - t);
    t += dt;
    regenerer(s, t, dt / 1000);
  }
  return t;
}

describe("REGEN", () => {
  it("reprend les constantes de JEU", () => {
    expect(REGEN.delaiMs).toBe(5000);
    expect(REGEN.pvParS).toBe(20);
  });
});

describe("santeInitiale / reinitialiserSante", () => {
  it("100 PV, pas de bouclier", () => {
    expect(santeInitiale(42)).toEqual({ pv: 100, bouclier: 0, dernierDegatT: 42, regenAcc: 0 });
  });
  it("l'apparition remet tout à zéro sauf les PV", () => {
    const s: Sante = { pv: 3, bouclier: 80, dernierDegatT: 1, regenAcc: 0.7 };
    reinitialiserSante(s, 9000);
    expect(s).toEqual({ pv: JEU.pvMax, bouclier: 0, dernierDegatT: 9000, regenAcc: 0 });
  });
});

describe("appliquerDegats", () => {
  it("sans bouclier : les PV baissent", () => {
    const s = santeInitiale(0);
    expect(appliquerDegats(s, 30, 1000)).toEqual({ absorbe: 0, subi: 30, mort: false });
    expect(s.pv).toBe(70);
    expect(s.dernierDegatT).toBe(1000);
  });

  it("le bouclier absorbe d'abord, sans toucher aux PV", () => {
    const s = { ...santeInitiale(0), bouclier: 100 };
    expect(appliquerDegats(s, 60, 500)).toEqual({ absorbe: 60, subi: 0, mort: false });
    expect(s).toMatchObject({ pv: 100, bouclier: 40 });
  });

  it("le débordement passe aux PV", () => {
    const s = { ...santeInitiale(0), bouclier: 40 };
    expect(appliquerDegats(s, 100, 500)).toEqual({ absorbe: 40, subi: 60, mort: false });
    expect(s).toMatchObject({ pv: 40, bouclier: 0 });
  });

  it("couteau (100) : tue sans bouclier, il en faut 2 avec 100 de bouclier", () => {
    const sans = santeInitiale(0);
    expect(appliquerDegats(sans, 100, 1).mort).toBe(true);
    expect(sans.pv).toBe(0);
    const avec = { ...santeInitiale(0), bouclier: 100 };
    expect(appliquerDegats(avec, 100, 1).mort).toBe(false);
    expect(appliquerDegats(avec, 100, 2).mort).toBe(true);
  });

  it("`subi` est borné aux PV restants (coup excédentaire)", () => {
    const s = { ...santeInitiale(0), pv: 10 };
    expect(appliquerDegats(s, 200, 1)).toEqual({ absorbe: 0, subi: 10, mort: true });
    expect(s.pv).toBe(0);
  });

  it("dégâts ≤ 0 ou NaN ignorés : rien ne bouge, ni le chrono de régénération", () => {
    const s = { ...santeInitiale(0), pv: 50, regenAcc: 0.5 };
    for (const d of [0, -10, Number.NaN]) {
      expect(appliquerDegats(s, d, 9999)).toEqual({ absorbe: 0, subi: 0, mort: false });
    }
    expect(s).toEqual({ pv: 50, bouclier: 0, dernierDegatT: 0, regenAcc: 0.5 });
  });

  it("un mort ne meurt pas deux fois", () => {
    const s = { ...santeInitiale(0), pv: 0 };
    expect(appliquerDegats(s, 50, 1)).toEqual({ absorbe: 0, subi: 0, mort: false });
  });

  it("remet regenAcc à 0 et dernierDegatT à maintenant", () => {
    const s = { ...santeInitiale(0), pv: 50, regenAcc: 0.9 };
    appliquerDegats(s, 5, 7777);
    expect(s.regenAcc).toBe(0);
    expect(s.dernierDegatT).toBe(7777);
  });
});

describe("regenerer", () => {
  const blesse = (): Sante => {
    const s = santeInitiale(0);
    appliquerDegats(s, 60, 0);
    return s; // pv 40, dégât à t = 0
  };

  it("inactive avant 5 s sans dégât", () => {
    const s = blesse();
    jouer(s, 0, 4990);
    expect(s.pv).toBe(40);
    expect(regenerer(s, 4999, 0.016)).toBe(false);
  });

  it("+20 PV/s ensuite, en entiers", () => {
    const s = blesse();
    const t = jouer(s, 0, 5000);
    expect(s.pv).toBe(40);
    let changements = 0;
    let tt = t;
    for (let k = 0; k < 30; k++) {
      tt += 1000 / 60;
      const avant = s.pv;
      if (regenerer(s, tt, 1 / 60)) changements++;
      expect(Number.isInteger(s.pv)).toBe(true);
      expect(s.pv).toBeGreaterThanOrEqual(avant);
    }
    // 0,5 s à 20 PV/s
    expect(s.pv).toBe(50);
    expect(changements).toBe(10);
    jouer(s, tt, 500);
    expect(s.pv).toBe(60);
  });

  it("plafonne à 100 et s'arrête", () => {
    const s = blesse();
    jouer(s, 0, 5000 + 10_000);
    expect(s.pv).toBe(JEU.pvMax);
    expect(s.regenAcc).toBe(0);
    expect(regenerer(s, 99_999, 0.1)).toBe(false);
  });

  it("un dégât relance le délai", () => {
    const s = blesse();
    jouer(s, 0, 6000);
    expect(s.pv).toBe(60);
    appliquerDegats(s, 10, 6000);
    jouer(s, 6000, 4900);
    expect(s.pv).toBe(50);
    jouer(s, 10_900, 1100);
    expect(s.pv).toBeGreaterThan(50);
  });

  it("jamais sur un mort", () => {
    const s = santeInitiale(0);
    appliquerDegats(s, 100, 0);
    expect(regenerer(s, 20_000, 0.1)).toBe(false);
    expect(s.pv).toBe(0);
  });

  it("le bouclier ne se régénère jamais", () => {
    const s = { ...santeInitiale(0), bouclier: 30 };
    appliquerDegats(s, 20, 0); // bouclier 10, PV 100
    appliquerDegats(s, 30, 0); // bouclier 0, PV 80
    jouer(s, 0, 20_000);
    expect(s.bouclier).toBe(0);
    expect(s.pv).toBe(100);
  });

  it("dtS est borné à 0,25 s (onglet gelé) et la part antérieure au délai ne compte pas", () => {
    const s = blesse();
    expect(regenerer(s, 60_000, 10)).toBe(true);
    expect(s.pv).toBe(45); // 0,25 s × 20
    const t = blesse();
    // le pas de 0,1 s enjambe la fin du délai de 0,05 s : seule la dernière moitié compte, 1 PV
    expect(regenerer(t, 5050, 0.1)).toBe(true);
    expect(t.pv).toBe(41);
    expect(regenerer(blesse(), 5000, 0.1)).toBe(false);
    expect(regenerer(blesse(), 6000, -1)).toBe(false);
  });

  it("rend vrai exactement quand `pv` change", () => {
    const s = blesse();
    expect(regenerer(s, 5010, 0.01)).toBe(false); // 0,2 PV accumulé
    expect(regenerer(s, 5060, 0.05)).toBe(true); // 1,2 PV
    expect(s.pv).toBe(41);
  });
});

describe("tuer / soinComplet", () => {
  it("tuer : PV et bouclier à 0, plus de régénération en attente", () => {
    const s = { ...santeInitiale(0), bouclier: 50, regenAcc: 0.4 };
    tuer(s, 1234);
    expect(s).toEqual({ pv: 0, bouclier: 0, dernierDegatT: 1234, regenAcc: 0 });
    expect(regenerer(s, 99_999, 0.1)).toBe(false);
  });

  it("soinComplet : 100 PV et 100 de bouclier", () => {
    const s = { pv: 12, bouclier: 3, dernierDegatT: 5, regenAcc: 0.8 };
    soinComplet(s);
    expect(s).toMatchObject({ pv: 100, bouclier: 100, regenAcc: 0 });
  });
});

describe("memoriserSante / restaurerSante", () => {
  const blesse = (): Sante => {
    const s = { ...santeInitiale(0), bouclier: 25 };
    appliquerDegats(s, 65, 10_000); // bouclier 0, PV 60
    return s;
  };

  it("mémorise PV, bouclier et temps écoulé depuis le dernier dégât", () => {
    expect(memoriserSante(blesse(), 14_000)).toEqual({ pv: 60, bouclier: 0, sansDegatMs: 4000, t: 14_000 });
  });

  it("moins de 60 s dehors : santé restaurée, le temps dehors ne compte pas pour la régénération", () => {
    const memo = memoriserSante(blesse(), 14_000);
    const s = santeInitiale(0);
    expect(restaurerSante(s, memo, 14_000 + 59_999)).toBe(true);
    expect(s.pv).toBe(60);
    expect(s.dernierDegatT).toBe(14_000 + 59_999 - 4000);
    expect(s.regenAcc).toBe(0);
    // il manque 1 s de délai : rien avant, régénération après
    const retour = 14_000 + 59_999;
    expect(regenerer(s, retour + 900, 0.05)).toBe(false);
    expect(regenerer(s, retour + 1100, 0.05)).toBe(true);
  });

  it("le bouclier est restauré aussi", () => {
    const b = { ...santeInitiale(0), bouclier: 80 };
    const s = santeInitiale(0);
    expect(restaurerSante(s, memoriserSante(b, 100), 200)).toBe(true);
    expect(s).toMatchObject({ pv: 100, bouclier: 80 });
  });

  it("60 s ou plus : refusé et rien n'est changé", () => {
    const memo = memoriserSante(blesse(), 14_000);
    const s = { pv: 100, bouclier: 0, dernierDegatT: 1, regenAcc: 0.3 };
    expect(restaurerSante(s, memo, 14_000 + JEU.memoSanteMs)).toBe(false);
    expect(restaurerSante(s, memo, 14_000 + 120_000)).toBe(false);
    expect(s).toEqual({ pv: 100, bouclier: 0, dernierDegatT: 1, regenAcc: 0.3 });
  });

  it("pas de mémo, ou mémo d'un mort : refusé", () => {
    const s = santeInitiale(0);
    expect(restaurerSante(s, null, 10)).toBe(false);
    const mort = santeInitiale(0);
    tuer(mort, 5);
    expect(restaurerSante(s, memoriserSante(mort, 6), 7)).toBe(false);
    expect(s.pv).toBe(100);
  });

  it("horloge qui recule : refusé", () => {
    expect(restaurerSante(santeInitiale(0), memoriserSante(blesse(), 14_000), 13_000)).toBe(false);
  });
});
