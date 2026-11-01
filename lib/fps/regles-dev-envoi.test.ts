import { describe, expect, it } from "vitest";
import { FileEnvoiDev, MARGE_ENVOI_DEV_MS } from "./regles-dev-envoi";
import { INTERVALLE_DEV_MS } from "./regles-dev";

const ECART = INTERVALLE_DEV_MS + MARGE_ENVOI_DEV_MS;

describe("FileEnvoiDev", () => {
  it("le premier message part tout de suite", () => {
    const f = new FileEnvoiDev();
    expect(f.enAttente()).toBe(false);
    expect(f.attenteMs(0)).toBe(Infinity);
    f.pousser({ regles: { degats: 2 } });
    expect(f.attenteMs(1000)).toBe(0);
    expect(f.suivant(1000)).toEqual({ regles: { degats: 2 } });
    expect(f.enAttente()).toBe(false);
  });

  it("une rafale de réglages se fusionne en un seul message, le dernier gagne", () => {
    const f = new FileEnvoiDev();
    f.pousser({ regles: { degats: 2 } });
    f.suivant(1000);
    f.pousser({ regles: { gravite: 0.5 } });
    f.pousser({ regles: { gravite: 0.25, munitionsInfinies: true } });
    f.pousser({ evenements: { frequence: "chaos" } });
    f.pousser({ evenements: { evenements: ["elsa"] } });
    expect(f.suivant(1000 + ECART - 1)).toBeNull();
    expect(f.attenteMs(1000 + 100)).toBe(ECART - 100);
    expect(f.suivant(1000 + ECART)).toEqual({
      regles: { gravite: 0.25, munitionsInfinies: true },
      evenements: { frequence: "chaos", evenements: ["elsa"] },
    });
    expect(f.enAttente()).toBe(false);
  });

  it("une action n'est jamais fusionnée : elle part seule, dans l'ordre, un intervalle après le message d'avant", () => {
    const f = new FileEnvoiDev();
    f.pousser({ regles: { degats: 2 } });
    f.pousser({ action: { k: "courant" } });
    f.pousser({ regles: { vitesse: 2 } });
    f.pousser({ action: { k: "passerManche" } });
    const envoyes = [];
    for (let t = 0; t < 10 * ECART; t += 10) {
      const m = f.suivant(t);
      if (m) envoyes.push({ t, m });
    }
    expect(envoyes.map((e) => e.m)).toEqual([
      { regles: { degats: 2 } }, { action: { k: "courant" } }, { regles: { vitesse: 2 } }, { action: { k: "passerManche" } },
    ]);
    for (let i = 1; i < envoyes.length; i++) expect(envoyes[i].t - envoyes[i - 1].t).toBeGreaterThanOrEqual(INTERVALLE_DEV_MS);
  });

  it("l'action qui accompagne un patch est suivie d'un patch séparé, pas fusionnée avec lui", () => {
    const f = new FileEnvoiDev();
    f.pousser({ action: { k: "reinitialiser" } });
    f.pousser({ regles: { degats: 3 } });
    expect(f.suivant(0)).toEqual({ action: { k: "reinitialiser" } });
    expect(f.suivant(ECART)).toEqual({ regles: { degats: 3 } });
  });

  it("vider abandonne ce qui attend", () => {
    const f = new FileEnvoiDev();
    f.pousser({ regles: { degats: 2 } });
    f.vider();
    expect(f.suivant(0)).toBeNull();
    expect(f.enAttente()).toBe(false);
  });
});
