import { describe, expect, it } from "vitest";
import { ControleurArmes } from "./jeu-equipement";
import { STATS } from "./armes";
import { JEU, type Equipement } from "./protocole";
import { serialiserSlots } from "./equipement";

const equip = (): Equipement => ({ principale: "fusil_assaut", secondaire: "pistolet", speciale: null });
const avecSpeciale = (): Equipement => ({ principale: "fusil_assaut", secondaire: "pistolet", speciale: "railgun" });
const DEG = JEU.degainageMs;

/** Vide `n` coups, chacun après la fin du dégainage (t grandit). */
function tirer(c: ControleurArmes, n: number, t0: number): number {
  let t = t0;
  for (let i = 0; i < n; i++) {
    expect(c.peutTirer(t)).toBe(true);
    c.tirEffectue();
    t += 10;
  }
  return t;
}

describe("ControleurArmes : état initial", () => {
  it("chargeurs pleins, principale en main par défaut", () => {
    const c = new ControleurArmes(equip());
    expect(c.slotActif()).toBe("principale");
    expect(c.armeEnMain()).toBe("fusil_assaut");
    expect(c.munitions()).toBe(STATS.fusil_assaut.chargeur);
    expect(c.chargeur()).toBe(STATS.fusil_assaut.chargeur);
    expect(c.munitionsDe("pistolet")).toBe(STATS.pistolet.chargeur);
    expect(c.munitionsDe("sniper")).toBe(0);
  });

  it("le slot de départ peut être donné ; un slot vide retombe sur la principale", () => {
    expect(new ControleurArmes(equip(), "secondaire").armeEnMain()).toBe("pistolet");
    expect(new ControleurArmes(equip(), "speciale").slotActif()).toBe("principale");
  });

  it("prête à tirer tout de suite (aucun dégainage à l'entrée)", () => {
    expect(new ControleurArmes(equip()).peutTirer(0)).toBe(true);
  });

  it("garde sa propre copie de l'équipement", () => {
    const e = equip();
    const c = new ControleurArmes(e);
    e.principale = "sniper";
    expect(c.equipement().principale).toBe("fusil_assaut");
    c.equipement().speciale = "railgun";
    expect(c.equipement().speciale).toBeNull();
  });
});

describe("changement d'arme", () => {
  it("equiper : sortie de 350 ms pendant laquelle on ne tire pas", () => {
    const c = new ControleurArmes(equip());
    expect(c.equiper("secondaire", 1000)).toBe(true);
    expect(c.armeEnMain()).toBe("pistolet");
    expect(c.degainage(1000)).toBe(true);
    expect(c.peutTirer(1000 + DEG - 1)).toBe(false);
    expect(c.peutTirer(1000 + DEG)).toBe(true);
    expect(c.degainage(1000 + DEG)).toBe(false);
    expect(c.degainageProgression(1000 + DEG / 2)).toBeCloseTo(0.5, 5);
  });

  it("refus : même slot, spéciale vide, slot inconnu", () => {
    const c = new ControleurArmes(equip());
    expect(c.equiper("principale", 0)).toBe(false);
    expect(c.equiper("speciale", 0)).toBe(false);
    expect(c.equiper("nimporte" as never, 0)).toBe(false);
    expect(c.slotActif()).toBe("principale");
    expect(c.peutTirer(0)).toBe(true);
  });

  it("les munitions sont gardées au changement", () => {
    const c = new ControleurArmes(equip());
    const t = tirer(c, 5, 0);
    expect(c.munitions()).toBe(STATS.fusil_assaut.chargeur - 5);
    c.equiper("secondaire", t);
    c.equiper("principale", t + 1000);
    expect(c.munitions()).toBe(STATS.fusil_assaut.chargeur - 5);
    expect(c.munitionsDe("pistolet")).toBe(STATS.pistolet.chargeur);
  });

  it("la recharge en cours est annulée au changement", () => {
    const c = new ControleurArmes(equip());
    const t = tirer(c, 3, 0);
    expect(c.demarrerRecharge(t)).toBe(true);
    expect(c.rechargeEnCours()).toBe(true);
    c.equiper("secondaire", t + 100);
    expect(c.rechargeEnCours()).toBe(false);
    expect(c.rechargeProgression(t + 200)).toBe(0);
    // l'arme quittée n'a pas été rechargée en secret
    c.equiper("principale", t + 2000);
    expect(c.majRecharge(t + 60_000)).toBe(false);
    expect(c.munitions()).toBe(STATS.fusil_assaut.chargeur - 3);
  });

  it("molette : cycle des slots, le couteau compris, la spéciale vide sautée", () => {
    const c = new ControleurArmes(equip());
    expect(c.molette(1, 0)).toBe(true);
    expect(c.slotActif()).toBe("secondaire");
    c.molette(1, 1000);
    expect(c.slotActif()).toBe("couteau");
    c.molette(1, 2000);
    expect(c.slotActif()).toBe("principale");
    c.molette(-1, 3000);
    expect(c.slotActif()).toBe("couteau");
  });

  it("molette avec une spéciale portée", () => {
    const c = new ControleurArmes(avecSpeciale(), "couteau");
    c.molette(1, 0);
    expect(c.slotActif()).toBe("speciale");
    expect(c.armeEnMain()).toBe("railgun");
  });

  it("rapide : revient au dernier slot utilisé, aller-retour", () => {
    const c = new ControleurArmes(equip());
    c.equiper("secondaire", 0);
    expect(c.rapide(1000)).toBe(true);
    expect(c.slotActif()).toBe("principale");
    expect(c.rapide(2000)).toBe(true);
    expect(c.slotActif()).toBe("secondaire");
  });

  it("rapide sans historique : bascule entre principale et secondaire", () => {
    const c = new ControleurArmes(equip());
    expect(c.rapide(0)).toBe(true);
    expect(c.slotActif()).toBe("secondaire");
  });

  it("couteauRapide : couteau puis retour à l'arme précédente", () => {
    const c = new ControleurArmes(equip(), "secondaire");
    expect(c.couteauRapide(0)).toBe(true);
    expect(c.armeEnMain()).toBe("couteau");
    expect(c.couteauRapide(1000)).toBe(true);
    expect(c.slotActif()).toBe("secondaire");
  });

  it("le couteau ne tire pas, n'a pas de chargeur et ne se recharge pas", () => {
    const c = new ControleurArmes(equip());
    c.equiper("couteau", 0);
    expect(c.peutTirer(10_000)).toBe(false);
    expect(c.munitions()).toBe(Infinity);
    expect(c.chargeur()).toBe(0);
    expect(c.demarrerRecharge(10_000)).toBe(false);
    c.tirEffectue();
    expect(c.slotActif()).toBe("couteau");
  });
});

describe("ControleurArmes : épée", () => {
  const avecEpee = (): Equipement => ({ principale: "fusil_assaut", secondaire: "pistolet", melee: "epee", speciale: null });

  it("le slot 3 (couteau) porte l'épée : touche 3 et arme blanche rapide la sortent", () => {
    const c = new ControleurArmes(avecEpee());
    expect(c.equiper("couteau", 0)).toBe(true);
    expect(c.slotActif()).toBe("couteau");
    expect(c.armeEnMain()).toBe("epee");
    const d = new ControleurArmes(avecEpee(), "secondaire");
    expect(d.couteauRapide(0)).toBe(true);
    expect(d.armeEnMain()).toBe("epee");
    expect(d.couteauRapide(1000)).toBe(true);
    expect(d.armeEnMain()).toBe("pistolet");
  });

  it("sans arme blanche choisie, le slot 3 reste le couteau", () => {
    const c = new ControleurArmes(equip());
    c.equiper("couteau", 0);
    expect(c.armeEnMain()).toBe("couteau");
  });

  it("l'épée ne tire pas, n'a pas de chargeur et ne se recharge pas", () => {
    const c = new ControleurArmes(avecEpee());
    c.equiper("couteau", 0);
    expect(c.peutTirer(10_000)).toBe(false);
    expect(c.munitions()).toBe(Infinity);
    expect(c.chargeur()).toBe(0);
    expect(c.demarrerRecharge(10_000)).toBe(false);
  });

  it("lignes : le slot couteau montre l'épée avec 0 / 0 ; la sérialisation HUD la garde", () => {
    const l = new ControleurArmes(avecEpee()).lignes();
    expect(l).toContainEqual({ slot: "couteau", arme: "epee", munitions: 0, chargeur: 0 });
    expect(serialiserSlots(l)).toContain("couteau:epee:0:0");
  });

  it("l'équipement reçu du serveur remplace le couteau par l'épée (apparition suivante)", () => {
    const c = new ControleurArmes(equip());
    c.appliquerServeur({ t: "apparition", equip: avecEpee(), main: "principale", munSpeciale: 0 } as never, 0);
    c.equiper("couteau", 0);
    expect(c.armeEnMain()).toBe("epee");
  });
});

describe("tir et recharge", () => {
  it("peutTirer faux sans munitions ou en recharge", () => {
    const c = new ControleurArmes(equip(), "secondaire");
    const t = tirer(c, STATS.pistolet.chargeur, 0);
    expect(c.munitions()).toBe(0);
    expect(c.peutTirer(t)).toBe(false);
    expect(c.demarrerRecharge(t)).toBe(true);
    expect(c.peutTirer(t + 100)).toBe(false);
  });

  it("recharge : durée de l'arme, progression 0..1, chargeur plein à la fin", () => {
    const c = new ControleurArmes(equip(), "secondaire");
    const t = tirer(c, 4, 0);
    expect(c.demarrerRecharge(t)).toBe(true);
    const duree = STATS.pistolet.rechargeS * 1000;
    expect(c.rechargeProgression(t)).toBe(0);
    expect(c.rechargeProgression(t + duree / 2)).toBeCloseTo(0.5, 5);
    expect(c.majRecharge(t + duree - 1)).toBe(false);
    expect(c.majRecharge(t + duree)).toBe(true);
    expect(c.munitions()).toBe(STATS.pistolet.chargeur);
    expect(c.rechargeEnCours()).toBe(false);
    expect(c.majRecharge(t + duree + 1)).toBe(false);
    expect(c.peutTirer(t + duree + 1)).toBe(true);
  });

  it("recharge refusée : chargeur plein, déjà en cours, pendant le dégainage", () => {
    const c = new ControleurArmes(equip());
    expect(c.demarrerRecharge(0)).toBe(false);
    const t = tirer(c, 1, 0);
    expect(c.demarrerRecharge(t)).toBe(true);
    expect(c.demarrerRecharge(t + 10)).toBe(false);
    c.equiper("secondaire", t + 20);
    tirer(c, 1, t + 20 + DEG);
    expect(c.demarrerRecharge(t + 20 + 100)).toBe(false);
    expect(c.demarrerRecharge(t + 20 + DEG + 50)).toBe(true);
  });

  it("recharge refusée pour une spéciale", () => {
    const c = new ControleurArmes(avecSpeciale(), "speciale");
    const t = tirer(c, 1, 0);
    expect(c.munitions()).toBe(STATS.railgun.chargeur - 1);
    expect(c.demarrerRecharge(t)).toBe(false);
  });
});

describe("spéciale épuisée", () => {
  it("retirée de l'équipement, retour au slot précédent avec un nouveau dégainage", () => {
    const c = new ControleurArmes(avecSpeciale(), "secondaire");
    c.equiper("speciale", 0);
    let t = DEG;
    for (let i = 0; i < STATS.railgun.chargeur - 1; i++) {
      expect(c.peutTirer(t)).toBe(true);
      c.tirEffectue();
      t += 2000;
    }
    expect(c.munitions()).toBe(1);
    expect(c.peutTirer(t)).toBe(true);
    c.tirEffectue();
    expect(c.equipement().speciale).toBeNull();
    expect(c.slotActif()).toBe("secondaire");
    expect(c.munitionsDe("railgun")).toBe(0);
    expect(c.lignes().map((l) => l.slot)).toEqual(["principale", "secondaire", "couteau"]);
    expect(c.peutTirer(t + DEG - 1)).toBe(false);
    expect(c.peutTirer(t + DEG)).toBe(true);
  });
});

describe("état serveur", () => {
  it("apparition : tout remis à plein, recharge et dégainage effacés", () => {
    const c = new ControleurArmes(equip());
    const t = tirer(c, 10, 0);
    c.equiper("secondaire", t);
    tirer(c, 3, t + DEG);
    c.demarrerRecharge(t + DEG + 100);
    c.appliquerServeur({
      t: "apparition", id: "j1", p: [0, 0, 0], lacet: 0, arme: "sniper", pv: 100, bouclier: 0,
      equip: { principale: "sniper", secondaire: "revolver", speciale: null }, main: "principale", munSpeciale: 0,
    }, 99_000);
    expect(c.slotActif()).toBe("principale");
    expect(c.armeEnMain()).toBe("sniper");
    expect(c.munitions()).toBe(STATS.sniper.chargeur);
    expect(c.munitionsDe("revolver")).toBe(STATS.revolver.chargeur);
    expect(c.munitionsDe("fusil_assaut")).toBe(0);
    expect(c.rechargeEnCours()).toBe(false);
    expect(c.peutTirer(99_000)).toBe(true);
  });

  it("apparition avec une spéciale : ses munitions viennent du message", () => {
    const c = new ControleurArmes(equip());
    c.appliquerServeur({
      t: "apparition", id: "j1", p: [0, 0, 0], lacet: 0, arme: "pistolet", pv: 100, bouclier: 0,
      equip: avecSpeciale(), main: "secondaire", munSpeciale: 4,
    }, 0);
    expect(c.slotActif()).toBe("secondaire");
    expect(c.munitionsDe("railgun")).toBe(4);
    c.equiper("speciale", 100);
    expect(c.munitions()).toBe(4);
  });

  it("equipement : pose la spéciale sans toucher aux chargeurs gardés ni à la recharge", () => {
    const c = new ControleurArmes(equip());
    const t = tirer(c, 7, 0);
    expect(c.demarrerRecharge(t)).toBe(true);
    c.appliquerServeur({ t: "equipement", equip: avecSpeciale(), main: "principale", munSpeciale: 6 }, t + 100);
    expect(c.equipement().speciale).toBe("railgun");
    expect(c.munitionsDe("railgun")).toBe(6);
    expect(c.munitionsDe("fusil_assaut")).toBe(STATS.fusil_assaut.chargeur - 7);
    expect(c.rechargeEnCours()).toBe(true);
    expect(c.lignes().map((l) => l.slot)).toEqual(["principale", "secondaire", "couteau", "speciale"]);
  });

  it("equipement : spéciale épuisée côté serveur, le slot en main change, recharge annulée, nouveau dégainage", () => {
    const c = new ControleurArmes(avecSpeciale(), "speciale");
    c.appliquerServeur({ t: "equipement", equip: equip(), main: "secondaire", munSpeciale: 0 }, 5000);
    expect(c.slotActif()).toBe("secondaire");
    expect(c.equipement().speciale).toBeNull();
    expect(c.peutTirer(5000 + DEG - 1)).toBe(false);
    expect(c.peutTirer(5000 + DEG)).toBe(true);
  });

  it("equipement identique à ce que le client a déjà fait : pas de second dégainage", () => {
    const c = new ControleurArmes(avecSpeciale(), "secondaire");
    c.equiper("speciale", 0);
    const t = tirer(c, STATS.railgun.chargeur, DEG);
    expect(c.slotActif()).toBe("secondaire");
    const tFin = t + 10_000;
    c.appliquerServeur({ t: "equipement", equip: equip(), main: "secondaire", munSpeciale: 0 }, tFin);
    expect(c.peutTirer(tFin)).toBe(true);
  });
});

describe("lignes", () => {
  it("une ligne par slot, couteau à 0/0, spéciale avec ses munitions", () => {
    const c = new ControleurArmes(avecSpeciale());
    tirer(c, 2, 0);
    expect(c.lignes()).toEqual([
      { slot: "principale", arme: "fusil_assaut", munitions: STATS.fusil_assaut.chargeur - 2, chargeur: STATS.fusil_assaut.chargeur },
      { slot: "secondaire", arme: "pistolet", munitions: STATS.pistolet.chargeur, chargeur: STATS.pistolet.chargeur },
      { slot: "couteau", arme: "couteau", munitions: 0, chargeur: 0 },
      { slot: "speciale", arme: "railgun", munitions: STATS.railgun.chargeur, chargeur: STATS.railgun.chargeur },
    ]);
  });
});

// ---------- zombies (v5) : équipement sans principale, réserve limitée, ravitaillement ----------

describe("ControleurArmes : équipement sans arme principale (zombies)", () => {
  const sans = (): Equipement => ({ principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true });

  it("main initiale = premier slot utilisable (jamais la principale vide), lignes() sans principale", () => {
    const c = new ControleurArmes(sans());
    expect(c.slotActif()).toBe("secondaire");
    expect(c.armeEnMain()).toBe("pistolet");
    expect(c.lignes().map((l) => l.slot)).toEqual(["secondaire", "couteau"]);
    expect(serialiserSlots(c.lignes())).toBe("secondaire:pistolet:12:12|couteau:couteau:0:0");
    // même en demandant explicitement la principale
    expect(new ControleurArmes(sans(), "principale").slotActif()).toBe("secondaire");
    // la mitraillette de remplissage n'a ni chargeur ni réserve
    expect(c.munitionsDe("mitraillette")).toBe(0);
  });

  it("molette et dernière arme sautent le slot vide", () => {
    const c = new ControleurArmes(sans(), "secondaire");
    expect(c.molette(1, 0)).toBe(true);
    expect(c.slotActif()).toBe("couteau");
    expect(c.molette(1, 1000)).toBe(true);
    expect(c.slotActif()).toBe("secondaire");
    expect(c.equiper("principale", 2000)).toBe(false);
  });

  it("acheter une principale (message equipement) la fait apparaître, chargeur plein, en main", () => {
    const c = new ControleurArmes(sans(), "secondaire", { reserveChargeurs: 5 });
    c.appliquerServeur({
      t: "equipement", equip: { principale: "pompe", secondaire: "pistolet", speciale: null }, main: "principale", munSpeciale: 0,
    }, 5000);
    expect(c.slotActif()).toBe("principale");
    expect(c.armeEnMain()).toBe("pompe");
    expect(c.munitions()).toBe(STATS.pompe.chargeur);
    expect(c.reserveDe("pompe")).toBe(5 * STATS.pompe.chargeur);
    expect(c.lignes().map((l) => l.slot)).toEqual(["principale", "secondaire", "couteau"]);
  });
});

describe("ControleurArmes : réserve limitée (zombies)", () => {
  const depart = (): Equipement => ({ principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true });
  const zombies = () => new ControleurArmes(depart(), "secondaire", { reserveChargeurs: 5 });

  it("l'arène a une réserve infinie (−1), les zombies 5 chargeurs par arme", () => {
    const arene = new ControleurArmes(equip());
    expect(arene.reserveLimitee()).toBe(false);
    expect(arene.reserveDe("fusil_assaut")).toBe(-1);
    expect(arene.reserveEnMain()).toBe(-1);
    const c = zombies();
    expect(c.reserveLimitee()).toBe(true);
    expect(c.reserveDe("pistolet")).toBe(5 * STATS.pistolet.chargeur);
    expect(c.reserveEnMain()).toBe(60);
    // l'arme blanche n'a pas de réserve à afficher
    c.equiper("couteau", 0);
    expect(c.reserveEnMain()).toBe(-1);
  });

  it("une recharge puise dans la réserve : seulement ce qui manque, puis la recharge est refusée à sec", () => {
    const c = zombies();
    let t = tirer(c, 5, 0);
    expect(c.munitions()).toBe(7);
    expect(c.demarrerRecharge(t)).toBe(true);
    t += STATS.pistolet.rechargeS * 1000 + 1;
    expect(c.majRecharge(t)).toBe(true);
    expect(c.munitions()).toBe(12);
    expect(c.reserveDe("pistolet")).toBe(55);
    // on vide toute la réserve : 11 chargeurs en tout, la 12e recharge n'a plus rien à donner
    for (let k = 0; k < 4; k++) {
      t = tirer(c, 12, t);
      expect(c.demarrerRecharge(t)).toBe(true);
      t += STATS.pistolet.rechargeS * 1000 + 1;
      c.majRecharge(t);
    }
    expect(c.reserveDe("pistolet")).toBe(7);
    t = tirer(c, 12, t);
    expect(c.demarrerRecharge(t)).toBe(true);
    t += STATS.pistolet.rechargeS * 1000 + 1;
    c.majRecharge(t);
    // 7 balles seulement dans le chargeur, plus rien en réserve
    expect(c.munitions()).toBe(7);
    expect(c.reserveDe("pistolet")).toBe(0);
    t = tirer(c, 7, t);
    expect(c.munitions()).toBe(0);
    expect(c.demarrerRecharge(t)).toBe(false);
    expect(c.rechargeEnCours()).toBe(false);
  });

  it("ravitaille : chargeur ET réserve de l'arme sont remplis, les autres armes gardent leur état", () => {
    const c = zombies();
    c.appliquerServeur({
      t: "equipement", equip: { principale: "pompe", secondaire: "pistolet", speciale: null }, main: "secondaire", munSpeciale: 0,
    }, 0);
    let t = DEG + 1;
    t = tirer(c, 8, t);
    c.equiper("principale", t);
    t += DEG + 1;
    t = tirer(c, 2, t);
    expect(c.munitionsDe("pompe")).toBe(STATS.pompe.chargeur - 2);
    // vide la réserve du pistolet pour voir le ravitaillement la remplir
    c.equiper("secondaire", t);
    t += DEG + 1;
    expect(c.demarrerRecharge(t)).toBe(true);
    t += STATS.pistolet.rechargeS * 1000 + 1;
    c.majRecharge(t);
    const reserveAvant = c.reserveDe("pistolet");
    expect(reserveAvant).toBeLessThan(60);
    c.appliquerServeur({
      t: "equipement", equip: { principale: "pompe", secondaire: "pistolet", speciale: null }, main: "secondaire", munSpeciale: 0, ravitaille: "pistolet",
    }, t);
    expect(c.munitionsDe("pistolet")).toBe(STATS.pistolet.chargeur);
    expect(c.reserveDe("pistolet")).toBe(60);
    expect(c.munitionsDe("pompe")).toBe(STATS.pompe.chargeur - 2);
    expect(c.reserveDe("pompe")).toBe(5 * STATS.pompe.chargeur);
    // une arme non portée n'est pas ravitaillée
    c.appliquerServeur({
      t: "equipement", equip: { principale: "pompe", secondaire: "pistolet", speciale: null }, main: "secondaire", munSpeciale: 0, ravitaille: "sniper",
    }, t + 10);
    expect(c.munitionsDe("sniper")).toBe(0);
  });

  it("apparition (relève, retour après élimination) : chargeurs et réserves de nouveau pleins", () => {
    const c = zombies();
    let t = tirer(c, 12, 0);
    c.demarrerRecharge(t);
    t += STATS.pistolet.rechargeS * 1000 + 1;
    c.majRecharge(t);
    expect(c.reserveDe("pistolet")).toBe(48);
    c.appliquerServeur({
      t: "apparition", id: "j1", p: [0, 0, 0], lacet: 0, arme: "pistolet", pv: 50, bouclier: 0, equip: depart(), main: "secondaire", munSpeciale: 0,
    }, t);
    expect(c.munitionsDe("pistolet")).toBe(12);
    expect(c.reserveDe("pistolet")).toBe(60);
  });

  it("une spéciale n'a pas de réserve", () => {
    const c = new ControleurArmes(avecSpeciale(), "principale", { reserveChargeurs: 5 });
    expect(c.reserveDe("railgun")).toBe(0);
    expect(c.reserveDe("fusil_assaut")).toBe(5 * STATS.fusil_assaut.chargeur);
  });
});
