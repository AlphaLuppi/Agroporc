import { describe, expect, it } from "vitest";
import { Suspension } from "./suspension";

const OPT = { maxMs: 300_000, compteMs: 3_000, cooldownMs: 10_000, totalMs: 900_000 };

describe("Suspension : horloge virtuelle", () => {
  it("égale l'horloge réelle tant qu'aucune suspension n'a eu lieu", () => {
    const s = new Suspension(OPT);
    expect(s.virtuel(12_345)).toBe(12_345);
  });

  it("est gelée pendant la suspension et repart de V sans saut à la levée", () => {
    const s = new Suspension(OPT);
    const avant = s.virtuel(10_000);
    const r = s.suspendre("j1", "Alice", 10_000, 2);
    expect(r).toEqual({ v: avant });
    expect(s.virtuel(10_000)).toBe(avant);
    expect(s.virtuel(70_000)).toBe(avant);
    expect(s.virtuel(610_000)).toBe(avant);
    expect(s.demanderLevee(610_000, 1)).toBe("immediate");
    // continue : à la levée, l'horloge vaut V, puis avance au rythme du réel
    expect(s.virtuel(610_000)).toBe(avant);
    expect(s.virtuel(611_000)).toBe(avant + 1_000);
  });

  it("cumule plusieurs suspensions dans le décalage", () => {
    const s = new Suspension({ ...OPT, cooldownMs: 0 });
    s.suspendre("j1", "A", 1_000, 1);
    s.lever(6_000); // 5 s de pause
    s.suspendre("j1", "A", 8_000, 1);
    s.lever(10_000); // 2 s de pause
    expect(s.virtuel(10_000)).toBe(1_000 + 2_000); // 1 s avant la première, 2 s entre les deux
    expect(s.totalSuspenduMs()).toBe(7_000);
  });
});

describe("Suspension : joueur seul admis (exempté)", () => {
  it("peut suspendre à répétition sans délai ni plafond", () => {
    const s = new Suspension(OPT);
    let reel = 0;
    for (let i = 0; i < 10; i++) {
      expect(s.peutSuspendre("j1", reel, 1)).toBe("ok");
      expect(s.suspendre("j1", "Solo", reel, 1)).not.toBeNull();
      reel += 100;
      expect(s.demanderLevee(reel, 1)).toBe("immediate"); // Échap, Reprendre, Échap en moins de 10 s : deux suspensions
      reel += 100;
    }
  });

  it("20 minutes cumulées seul : toujours possible", () => {
    const s = new Suspension(OPT);
    for (let i = 0; i < 4; i++) {
      const debut = i * 400_000;
      expect(s.peutSuspendre("j1", debut, 1)).toBe("ok");
      s.suspendre("j1", "Solo", debut, 1);
      s.demanderLevee(debut + 300_000, 1);
    }
    expect(s.totalSuspenduMs()).toBe(1_200_000);
    expect(s.peutSuspendre("j1", 2_000_000, 1)).toBe("ok");
  });

  it("6 minutes seul : pas de levée automatique", () => {
    const s = new Suspension(OPT);
    s.suspendre("j1", "Solo", 0, 1);
    expect(s.tic(360_000, 1)).toBeNull();
    expect(s.active).not.toBeNull();
  });
});

describe("Suspension : plusieurs humains", () => {
  it("refuse une deuxième suspension du même joueur avant le délai", () => {
    const s = new Suspension(OPT);
    s.suspendre("j1", "A", 0, 2);
    expect(s.demanderLevee(1_000, 2)).toBe("compte");
    expect(s.tic(4_000, 2)).toBe("leve");
    expect(s.peutSuspendre("j1", 5_000, 2)).toBe("limite"); // 1 s après la levée de SA suspension
    expect(s.peutSuspendre("j2", 5_000, 2)).toBe("ok");
    expect(s.peutSuspendre("j1", 14_000, 2)).toBe("ok");
  });

  it("levée avec compte à rebours : le jeu reste figé jusqu'à son terme", () => {
    const s = new Suspension(OPT);
    const v = s.suspendre("j1", "A", 5_000, 2)!.v;
    expect(s.demanderLevee(20_000, 2)).toBe("compte");
    expect(s.active?.compteFinReel).toBe(23_000);
    expect(s.demanderLevee(21_000, 2)).toBe("rien"); // déjà en cours
    expect(s.tic(22_999, 2)).toBeNull();
    expect(s.virtuel(22_999)).toBe(v);
    expect(s.tic(23_000, 2)).toBe("leve");
    expect(s.active).toBeNull();
    expect(s.virtuel(23_000)).toBe(v);
  });

  it("compteMs = 0 : levée immédiate", () => {
    const s = new Suspension({ ...OPT, compteMs: 0 });
    s.suspendre("j1", "A", 0, 2);
    expect(s.demanderLevee(100, 2)).toBe("immediate");
    expect(s.active).toBeNull();
  });

  it("le compte à rebours est annulable UNE seule fois par suspension, le délai du joueur s'applique", () => {
    const s = new Suspension(OPT);
    s.suspendre("j1", "A", 0, 2);
    s.demanderLevee(20_000, 2);
    // j2 annule (retour à la suspension pleine)
    expect(s.peutSuspendre("j2", 21_000, 2)).toBe("ok");
    expect(s.suspendre("j2", "B", 21_000, 2)).not.toBeNull();
    expect(s.active?.compteFinReel).toBeNull();
    // deuxième compte à rebours : plus d'annulation possible
    s.demanderLevee(22_000, 2);
    expect(s.suspendre("j1", "A", 23_000, 2)).toBeNull();
    expect(s.active?.compteFinReel).toBe(25_000);
    // et j2 qui vient d'annuler est sous délai
    expect(s.peutSuspendre("j2", 25_000, 2)).toBe("limite");
  });

  it("suspendre une partie déjà suspendue ne fait rien (idempotent)", () => {
    const s = new Suspension(OPT);
    s.suspendre("j1", "A", 0, 2);
    expect(s.suspendre("j2", "B", 100, 2)).toBeNull();
    expect(s.active?.par).toBe("j1");
  });

  it("durée maximale d'une suspension : compte à rebours non annulable", () => {
    const s = new Suspension(OPT);
    s.suspendre("j1", "A", 0, 2);
    expect(s.tic(299_999, 2)).toBeNull();
    expect(s.tic(300_000, 2)).toBe("auto");
    expect(s.active?.compteFinReel).toBe(303_000);
    expect(s.suspendre("j2", "B", 301_000, 2)).toBeNull(); // non annulable
    expect(s.tic(303_000, 2)).toBe("leve");
  });

  it("pause cumulée par partie : appliquée aussi à la suspension en cours, puis refus", () => {
    const s = new Suspension({ ...OPT, cooldownMs: 0, maxMs: 10_000_000, totalMs: 60_000 });
    s.suspendre("j1", "A", 0, 2);
    expect(s.tic(59_999, 2)).toBeNull();
    expect(s.tic(60_000, 2)).toBe("force");
    expect(s.suspendre("j2", "B", 61_000, 2)).toBeNull();
    expect(s.tic(63_000, 2)).toBe("leve");
    expect(s.peutSuspendre("j2", 64_000, 2)).toBe("limite");
  });

  it("reinitialiserPartie remet pause cumulée et délais à zéro mais conserve le décalage d'horloge", () => {
    const s = new Suspension({ ...OPT, totalMs: 60_000 });
    s.suspendre("j1", "A", 0, 2);
    s.lever(60_000);
    expect(s.peutSuspendre("j1", 61_000, 2)).toBe("limite");
    const v = s.virtuel(61_000);
    s.reinitialiserPartie();
    expect(s.peutSuspendre("j1", 61_000, 2)).toBe("ok");
    expect(s.virtuel(61_000)).toBe(v);
    expect(s.totalSuspenduMs()).toBe(0);
  });

  it("deux parties successives dans la même salle", () => {
    const s = new Suspension({ ...OPT, totalMs: 30_000, cooldownMs: 0 });
    s.suspendre("j1", "A", 0, 2);
    s.lever(30_000);
    expect(s.peutSuspendre("j1", 31_000, 2)).toBe("limite");
    s.reinitialiserPartie();
    s.suspendre("j1", "A", 40_000, 2);
    expect(s.tic(60_000, 2)).toBeNull();
    s.lever(60_000);
    expect(s.virtuel(60_000)).toBe(40_000 - 30_000);
  });
});

describe("Suspension : levée d'office", () => {
  it("lever sans suspension ne fait rien", () => {
    const s = new Suspension(OPT);
    s.lever(1_000);
    expect(s.virtuel(1_000)).toBe(1_000);
  });
  it("lever repart de V", () => {
    const s = new Suspension(OPT);
    s.suspendre("j1", "A", 1_000, 2);
    s.lever(4_000);
    expect(s.virtuel(4_000)).toBe(1_000);
    expect(s.active).toBeNull();
  });
});
