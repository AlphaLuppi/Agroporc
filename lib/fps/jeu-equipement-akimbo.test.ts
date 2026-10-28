import { describe, expect, it } from "vitest";
import { ControleurArmes } from "./jeu-equipement";
import { STATS } from "./armes";
import type { Equipement } from "./protocole";

describe("(v8) paire akimbo (zombies)", () => {
  const jumelles = (): Equipement => ({ principale: "fusil_assaut", secondaire: "perforeuse", speciale: null, sansPrincipale: true, ameliorees: ["perforeuse"] });
  const cap = STATS.perforeuse.zombie.ameliore.chargeur;

  it("deux chargeurs pleins, comptés ensemble dans le rack ; une main se vide sans toucher l'autre", () => {
    const c = new ControleurArmes(jumelles(), "secondaire", { zombies: true, reserveChargeurs: 5 });
    expect(c.akimbo()).toBe(true);
    expect(c.munitionsMain("d")).toBe(cap);
    expect(c.munitionsMain("g")).toBe(cap);
    expect(c.munitions()).toBe(2 * cap);
    expect(c.chargeur()).toBe(2 * cap);
    expect(c.lignes().find((l) => l.slot === "secondaire")).toMatchObject({ munitions: 2 * cap, chargeur: 2 * cap });
    expect(c.reserveDe("perforeuse")).toBe(5 * cap * 2);
    for (let i = 0; i < cap; i++) { expect(c.peutTirer(10_000, "g")).toBe(true); c.tirEffectue("g"); }
    expect(c.peutTirer(10_000, "g")).toBe(false);
    expect(c.peutTirer(10_000, "d")).toBe(true);
    expect(c.munitions()).toBe(cap);
  });

  it("une recharge remplit les deux chargeurs depuis la réserve commune", () => {
    const c = new ControleurArmes(jumelles(), "secondaire", { zombies: true, reserveChargeurs: 5 });
    c.tirEffectue("d"); c.tirEffectue("g"); c.tirEffectue("g");
    expect(c.demarrerRecharge(10_000)).toBe(true);
    expect(c.majRecharge(10_000 + 60_000)).toBe(true);
    expect(c.munitionsMain("d")).toBe(cap);
    expect(c.munitionsMain("g")).toBe(cap);
    expect(c.reserveDe("perforeuse")).toBe(10 * cap - 3);
    // deux chargeurs pleins : rien à recharger
    expect(c.demarrerRecharge(80_000)).toBe(false);
  });

  it("arme seule : pas de main gauche ; une arme qui devient une paire au Micro-ondes reçoit son second chargeur", () => {
    const seule: Equipement = { ...jumelles(), ameliorees: [] };
    const c = new ControleurArmes(seule, "secondaire", { zombies: true, reserveChargeurs: 5 });
    expect(c.akimbo()).toBe(false);
    expect(c.munitionsMain("g")).toBe(0);
    expect(c.peutTirer(10_000, "g")).toBe(false);
    c.appliquerServeur({ t: "equipement", equip: jumelles(), main: "secondaire", munSpeciale: 0, ravitaille: "perforeuse" }, 20_000);
    expect(c.akimbo()).toBe(true);
    expect(c.munitionsMain("g")).toBe(cap);
    // dans l'arène, jamais de paire
    expect(new ControleurArmes(jumelles(), "secondaire").akimbo()).toBe(false);
  });
});
