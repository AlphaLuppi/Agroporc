import { describe, expect, it } from "vitest";
import {
  ACTIONS, CLE_TOUCHES, assigner, ecrireTouches, estParDefaut, indexTouches, libelleTouche, lireTouches,
  normaliser, touchesParDefaut, type Stockage,
} from "./touches";

function memoire(init: Record<string, string> = {}): Stockage & { donnees: Record<string, string> } {
  const donnees = { ...init };
  return {
    donnees,
    getItem: (k) => (k in donnees ? donnees[k] : null),
    setItem: (k, v) => { donnees[k] = v; },
    removeItem: (k) => { delete donnees[k]; },
  };
}

describe("touches de l'arène", () => {
  it("par défaut : ZQSD/WASD physiques, aucune touche en double", () => {
    const d = touchesParDefaut();
    expect(d.avant[0]).toBe("KeyW");
    const toutes = ACTIONS.flatMap((a) => d[a]).filter(Boolean);
    expect(new Set(toutes).size).toBe(toutes.length);
    expect(estParDefaut(d)).toBe(true);
  });

  it("assigner déplace une touche déjà prise et signale l'action dépossédée", () => {
    const { cfg, depossedee } = assigner(touchesParDefaut(), "saut", 1, "KeyR");
    expect(cfg.saut).toEqual(["Space", "KeyR"]);
    expect(cfg.recharger).toEqual([null, null]);
    expect(depossedee).toBe("recharger");
    expect(indexTouches(cfg).get("KeyR")).toEqual(["saut"]);
  });

  it("réassigner la même touche au même emplacement ne dépossède personne", () => {
    const { cfg, depossedee } = assigner(touchesParDefaut(), "avant", 0, "KeyW");
    expect(cfg.avant).toEqual(["KeyW", "ArrowUp"]);
    expect(depossedee).toBeNull();
  });

  it("Échap et les codes farfelus ne sont jamais assignés", () => {
    const d = touchesParDefaut();
    expect(assigner(d, "tir", 0, "Escape").cfg).toBe(d);
    expect(assigner(d, "tir", 0, "<script>").cfg).toBe(d);
  });

  it("vider un emplacement", () => {
    expect(assigner(touchesParDefaut(), "avant", 1, null).cfg.avant).toEqual(["KeyW", null]);
  });

  it("enregistre, relit, et efface quand on revient au défaut", () => {
    const s = memoire();
    const { cfg } = assigner(touchesParDefaut(), "tir", 1, "KeyF");
    expect(ecrireTouches(cfg, s)).toBe(true);
    expect(lireTouches(s)).toEqual(cfg);
    ecrireTouches(touchesParDefaut(), s);
    expect(s.donnees[CLE_TOUCHES]).toBeUndefined();
  });

  it("une configuration abîmée retombe sur le défaut action par action, sans doublon", () => {
    const s = memoire({ [CLE_TOUCHES]: JSON.stringify({ avant: ["KeyZ", null], arriere: "x", tir: ["KeyZ", "Souris0"] }) });
    const cfg = lireTouches(s);
    expect(cfg.avant).toEqual(["KeyZ", null]);
    expect(cfg.arriere).toEqual(touchesParDefaut().arriere);
    expect(cfg.tir).toEqual([null, "Souris0"]);
    expect(lireTouches(memoire({ [CLE_TOUCHES]: "{pas du json" }))).toEqual(touchesParDefaut());
    expect(normaliser(null)).toEqual(touchesParDefaut());
  });

  it("libellés : disposition du clavier, noms français, souris", () => {
    expect(libelleTouche("KeyW")).toBe("W");
    expect(libelleTouche("KeyW", new Map([["KeyW", "z"]]))).toBe("Z");
    expect(libelleTouche("Space")).toBe("Espace");
    expect(libelleTouche("Souris2")).toBe("Clic droit");
    expect(libelleTouche("Numpad3")).toBe("Pavé 3");
    expect(libelleTouche("Digit1", new Map([["Digit1", "&"]]))).toBe("1");
    expect(libelleTouche(null)).toBe("—");
  });
});
