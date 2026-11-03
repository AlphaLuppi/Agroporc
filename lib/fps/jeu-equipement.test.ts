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
  it("(v8) une apparition `garder` (relève, reprise) garde les chargeurs ; une vraie apparition les remplit", () => {
    const c = new ControleurArmes(equip(), "secondaire");
    tirer(c, 5, 0);
    const reste = c.munitions();
    expect(reste).toBe(STATS.pistolet.chargeur - 5);
    c.appliquerServeur({ t: "apparition", equip: equip(), main: "secondaire", munSpeciale: 0, garder: true } as never, 5000);
    expect(c.munitions()).toBe(reste);
    c.appliquerServeur({ t: "apparition", equip: equip(), main: "secondaire", munSpeciale: 0 } as never, 6000);
    expect(c.munitions()).toBe(STATS.pistolet.chargeur);
  });

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

// ---------- Battle Royale (v8) : départ sans arme à feu, boîtes de munitions ----------

describe("ControleurArmes : départ du Battle Royale (ni principale ni secondaire)", () => {
  const depart = (): Equipement => ({ principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true, sansSecondaire: true });
  const br = (main: "couteau" | "principale" | "secondaire" = "couteau") => new ControleurArmes(depart(), main, { reserveChargeurs: 2 });

  it("le couteau en main, aucune ligne d'arme à feu, jamais de tir ni de recharge", () => {
    const c = br();
    expect(c.slotActif()).toBe("couteau");
    expect(c.armeEnMain()).toBe("couteau");
    expect(c.lignes()).toEqual([{ slot: "couteau", arme: "couteau", munitions: 0, chargeur: 0 }]);
    expect(serialiserSlots(c.lignes())).toBe("couteau:couteau:0:0");
    expect(c.peutTirer(1000)).toBe(false);
    expect(c.demarrerRecharge(1000)).toBe(false);
    // les armes de remplissage n'ont ni chargeur ni réserve
    expect(c.munitionsDe("mitraillette")).toBe(0);
    expect(c.munitionsDe("pistolet")).toBe(0);
    expect(c.reserveDe("pistolet")).toBe(0);
  });

  it("un slot vide demandé en main retombe sur l'arme blanche (repli), molette et dernière arme n'ont nulle part où aller", () => {
    for (const main of ["principale", "secondaire"] as const) expect(br(main).slotActif()).toBe("couteau");
    expect(new ControleurArmes(depart(), undefined, { reserveChargeurs: 2 }).slotActif()).toBe("couteau");
    const c = br();
    expect(c.molette(1, 0)).toBe(false);
    expect(c.molette(-1, 0)).toBe(false);
    expect(c.rapide(0)).toBe(false);
    expect(c.equiper("principale", 0)).toBe(false);
    expect(c.equiper("secondaire", 0)).toBe(false);
    expect(c.equiper("speciale", 0)).toBe(false);
  });

  it("ramasser une secondaire (message equipement) : chargeur plein, réserve de départ de 2 chargeurs, en main", () => {
    const c = br();
    c.appliquerServeur({ t: "equipement", equip: { principale: "mitraillette", secondaire: "revolver", speciale: null, sansPrincipale: true }, main: "secondaire", munSpeciale: 0 }, 5000);
    expect(c.slotActif()).toBe("secondaire");
    expect(c.armeEnMain()).toBe("revolver");
    expect(c.munitions()).toBe(STATS.revolver.chargeur);
    expect(c.reserveDe("revolver")).toBe(2 * STATS.revolver.chargeur);
    expect(c.lignes().map((l) => l.slot)).toEqual(["secondaire", "couteau"]);
    // le couteau est le slot d'avant : « dernière arme » y retourne
    expect(c.slotPrecedent()).toBe("couteau");
    expect(c.rapide(6000)).toBe(true);
    expect(c.slotActif()).toBe("couteau");
  });

  it("échange dans le même slot (autre secondaire) : chargeur plein, recharge de l'ancienne annulée, dégainage", () => {
    const c = br("couteau");
    const eq = (secondaire: "pistolet" | "revolver"): Extract<Parameters<ControleurArmes["appliquerServeur"]>[0], { t: "equipement" }> => ({
      t: "equipement", equip: { principale: "mitraillette", secondaire, speciale: null, sansPrincipale: true }, main: "secondaire", munSpeciale: 0,
    });
    c.appliquerServeur(eq("pistolet"), 0);
    let t = 1000;
    t = tirer(c, 5, t);
    expect(c.demarrerRecharge(t)).toBe(true);
    c.appliquerServeur(eq("revolver"), t + 10);
    expect(c.armeEnMain()).toBe("revolver");
    expect(c.rechargeEnCours()).toBe(false);
    expect(c.degainage(t + 11)).toBe(true);
    expect(c.munitions()).toBe(STATS.revolver.chargeur);
    // l'ancienne arme est oubliée
    expect(c.munitionsDe("pistolet")).toBe(0);
  });

  it("lâcher la dernière arme à feu en main : retour au couteau", () => {
    const c = br();
    c.appliquerServeur({ t: "equipement", equip: { principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true }, main: "secondaire", munSpeciale: 0 }, 0);
    c.appliquerServeur({ t: "equipement", equip: { principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true, sansSecondaire: true }, main: "couteau", munSpeciale: 0 }, 100);
    expect(c.slotActif()).toBe("couteau");
    expect(c.lignes().map((l) => l.slot)).toEqual(["couteau"]);
    expect(c.munitionsDe("pistolet")).toBe(0);
  });
});

describe("ControleurArmes.ajouterReserve (boîtes de munitions du Battle Royale)", () => {
  const avecPistolet = (opts = {}): ControleurArmes => new ControleurArmes(
    { principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true }, "secondaire", { reserveChargeurs: 2, ...opts });
  const CAP = STATS.pistolet.chargeur;

  it("ajoute des chargeurs entiers à la réserve sans toucher au chargeur", () => {
    const c = avecPistolet();
    tirer(c, 4, 1000);
    expect(c.ajouterReserve("pistolet", 2)).toBe(2 * CAP);
    expect(c.reserveDe("pistolet")).toBe(4 * CAP);
    expect(c.munitions()).toBe(CAP - 4);
  });

  it("plafonne à 6 chargeurs et ne rogne jamais une réserve déjà au-dessus", () => {
    const c = avecPistolet();
    expect(c.ajouterReserve("pistolet", 3)).toBe(3 * CAP);
    expect(c.ajouterReserve("pistolet", 2)).toBe(CAP); // 5 + 2 -> plafonné à 6
    expect(c.reserveDe("pistolet")).toBe(6 * CAP);
    expect(c.ajouterReserve("pistolet", 1)).toBe(0);
    expect(c.reserveDe("pistolet")).toBe(6 * CAP);
    // plafond réglable ; une réserve de départ au-dessus du plafond est conservée
    const bas = avecPistolet({ reserveChargeursMax: 1 });
    expect(bas.ajouterReserve("pistolet", 1)).toBe(0);
    expect(bas.reserveDe("pistolet")).toBe(2 * CAP);
  });

  it("sans effet : arme non portée, slot vide, spéciale, réserve infinie, quantité nulle", () => {
    const c = avecPistolet();
    expect(c.ajouterReserve("revolver", 2)).toBe(0);
    expect(c.ajouterReserve("mitraillette", 2)).toBe(0); // remplissage de la principale vide
    expect(c.reserveDe("revolver")).toBe(0);
    expect(c.ajouterReserve("pistolet", 0)).toBe(0);
    expect(c.ajouterReserve("pistolet", -2)).toBe(0);
    const arene = new ControleurArmes(equip());
    expect(arene.ajouterReserve("pistolet", 2)).toBe(0);
    expect(arene.reserveDe("pistolet")).toBe(-1);
    const sp = new ControleurArmes(avecSpeciale(), "principale", { reserveChargeurs: 2 });
    expect(sp.ajouterReserve("railgun", 2)).toBe(0);
  });

  it("la recharge puise ensuite dans la réserve augmentée", () => {
    const c = avecPistolet();
    let t = tirer(c, CAP, 1000);
    c.ajouterReserve("pistolet", 1);
    expect(c.demarrerRecharge(t)).toBe(true);
    t += STATS.pistolet.rechargeS * 1000 + 1;
    expect(c.majRecharge(t)).toBe(true);
    expect(c.munitions()).toBe(CAP);
    expect(c.reserveDe("pistolet")).toBe(2 * CAP);
  });
});

describe("ControleurArmes : swap cancel et reload cancel (quickswap.ts)", () => {
  it("aller-retour rapide : l'arme d'origine est prête en 50 à 120 ms au lieu de 350", () => {
    const c = new ControleurArmes(equip());
    expect(c.equiper("secondaire", 1000)).toBe(true);
    expect(c.rapide(1080)).toBe(true); // Q : retour au fusil d'assaut
    expect(c.armeEnMain()).toBe("fusil_assaut");
    expect(c.annulationEnCours(1080)).toBe(true);
    expect(c.peutTirer(1080 + 49)).toBe(false);
    expect(c.peutTirer(1080 + 120)).toBe(true);
    expect(c.degainageProgression(1080)).toBe(0);
    expect(c.degainageProgression(1080 + 120)).toBe(1);
  });

  it("la molette et les touches 1 / 2 / 3 annulent aussi ; un changement vers une troisième arme non", () => {
    const c = new ControleurArmes(equip());
    c.equiper("secondaire", 1000);
    c.equiper("principale", 1100);
    expect(c.peutTirer(1100 + 120)).toBe(true);
    const d = new ControleurArmes(equip());
    d.equiper("secondaire", 1000);
    d.equiper("couteau", 1400); // pistolet sorti
    d.equiper("secondaire", 1450); // retour à l'arme quittée (pistolet) : annulation
    expect(d.peutTirer(1450 + 120)).toBe(true);
    // pistolet quitté avant d'être sorti : l'aller-retour ne le rend pas prêt avant la fin de son dégainage (anti-triche)
    const f = new ControleurArmes(equip());
    f.equiper("secondaire", 1000);
    f.equiper("couteau", 1100);
    f.equiper("secondaire", 1150);
    expect(f.peutTirer(1000 + DEG - 1)).toBe(false);
    expect(f.peutTirer(1000 + DEG)).toBe(true);
    const e = new ControleurArmes(equip());
    e.equiper("secondaire", 1000);
    e.equiper("couteau", 1100); // troisième arme : changement simple
    expect(e.degainage(1100 + DEG - 1)).toBe(true);
  });

  it("pas d'annulation après la fin du changement : un nouveau dégainage complet", () => {
    const c = new ControleurArmes(equip());
    c.equiper("secondaire", 1000);
    c.rapide(1000 + DEG);
    expect(c.peutTirer(1000 + DEG + DEG - 1)).toBe(false);
    expect(c.peutTirer(1000 + DEG + DEG)).toBe(true);
  });

  it("poseArme : l'arme quittée descend puis la nouvelle monte ; en swap cancel l'arme d'origine remonte d'où elle est", () => {
    const c = new ControleurArmes(equip());
    c.equiper("secondaire", 1000);
    expect(c.poseArme(1070).arme).toBe("fusil_assaut");
    expect(c.poseArme(1200).arme).toBe("pistolet");
    expect(c.poseArme(1000 + DEG)).toEqual({ arme: "pistolet", abaissement: 0 });
    const avant = c.poseArme(1100).abaissement;
    c.rapide(1100);
    const apres = c.poseArme(1100);
    expect(apres.arme).toBe("fusil_assaut");
    expect(apres.abaissement).toBeCloseTo(avant, 5);
    expect(c.poseArme(1100 + 120).abaissement).toBe(0);
  });

  it("reload cancel : quitter l'arme après l'insertion du chargeur (75 %) garde le rechargement ; avant, il est perdu", () => {
    const duree = STATS.fusil_assaut.rechargeS * 1000;
    const c = new ControleurArmes(equip());
    let t = tirer(c, 5, 0);
    expect(c.demarrerRecharge(t)).toBe(true);
    c.equiper("secondaire", t + duree * 0.8);
    c.rapide(t + duree * 0.8 + 30);
    expect(c.armeEnMain()).toBe("fusil_assaut");
    expect(c.munitions()).toBe(STATS.fusil_assaut.chargeur);
    expect(c.rechargeEnCours()).toBe(false);
    const d = new ControleurArmes(equip());
    t = tirer(d, 5, 0);
    d.demarrerRecharge(t);
    d.equiper("secondaire", t + duree * 0.7);
    d.rapide(t + duree * 0.7 + 30);
    expect(d.munitions()).toBe(STATS.fusil_assaut.chargeur - 5);
  });

  it("reload cancel avec réserve limitée (zombies) : le chargeur puise dans la réserve", () => {
    const duree = STATS.pistolet.rechargeS * 1000;
    const c = new ControleurArmes({ principale: "fusil_assaut", secondaire: "pistolet", speciale: null }, "secondaire", { reserveChargeurs: 1 });
    const t = tirer(c, 3, 0);
    const reserve = c.reserveDe("pistolet");
    c.demarrerRecharge(t);
    c.equiper("principale", t + duree * 0.9);
    expect(c.munitionsDe("pistolet")).toBe(STATS.pistolet.chargeur);
    expect(c.reserveDe("pistolet")).toBe(reserve - 3);
  });

  it("pas de changement pendant un coup de couteau rapide ; une apparition efface le changement en cours", () => {
    const c = new ControleurArmes(equip());
    c.equiper("secondaire", 1000);
    c.appliquerServeur({ t: "apparition", id: "a", p: [0, 0, 0], lacet: 0, arme: "pistolet", pv: 100, bouclier: 0, equip: equip(), main: "secondaire", munSpeciale: 0 }, 1050);
    expect(c.equiper("principale", 1060)).toBe(true);
    expect(c.degainage(1060 + DEG - 1)).toBe(true); // pas d'annulation : l'apparition a remis le changement à zéro
  });

  it("changements enchaînés (molette rapide) : l'arme visible repart de sa hauteur, jamais remontée d'un coup en joue", () => {
    const c = new ControleurArmes(equip());
    c.equiper("secondaire", 1000); // fusil → pistolet
    const a = c.poseArme(1070); // le fusil descend
    expect(a.arme).toBe("fusil_assaut");
    expect(a.abaissement).toBeGreaterThan(0.2);
    c.equiper("couteau", 1070); // pistolet → couteau alors que le fusil est encore à mi-hauteur
    const b = c.poseArme(1070);
    expect(b.arme).toBe("fusil_assaut");
    expect(b.abaissement).toBeCloseTo(a.abaissement, 5);
    // il continue de descendre puis le couteau monte
    expect(c.poseArme(1150).abaissement).toBeGreaterThan(a.abaissement);
    expect(c.poseArme(1070 + DEG).arme).toBe("couteau");
    // pendant que la nouvelle arme monte : elle redescend d'où elle est
    const d = new ControleurArmes(equip());
    d.equiper("secondaire", 1000);
    const monte = d.poseArme(1250);
    expect(monte.arme).toBe("pistolet");
    d.equiper("couteau", 1250);
    expect(d.poseArme(1250)).toEqual({ arme: "pistolet", abaissement: monte.abaissement });
  });

  it("rechargement interrompu avant l'insertion : compté (le rendu coupe l'animation) ; acquis ou fini : non", () => {
    const duree = STATS.fusil_assaut.rechargeS * 1000;
    const c = new ControleurArmes(equip());
    let t = tirer(c, 5, 0);
    const n0 = c.rechargesInterrompues;
    c.demarrerRecharge(t);
    c.equiper("secondaire", t + duree * 0.3);
    c.rapide(t + duree * 0.3 + 30); // swap cancel : même arme, même modèle, rechargement perdu
    expect(c.rechargesInterrompues).toBe(n0 + 1);
    expect(c.rechargeEnCours()).toBe(false);
    // après l'insertion : acquis, pas interrompu
    t = t + duree * 0.3 + 30 + 1000;
    c.demarrerRecharge(t);
    c.equiper("secondaire", t + duree * 0.8);
    expect(c.rechargesInterrompues).toBe(n0 + 1);
    // rechargement mené à son terme : pas interrompu
    c.equiper("principale", t + duree * 0.8 + DEG);
    t = tirer(c, 2, t + duree * 0.8 + 2 * DEG);
    c.demarrerRecharge(t);
    expect(c.majRecharge(t + duree + 1)).toBe(true);
    expect(c.rechargesInterrompues).toBe(n0 + 1);
  });
});

