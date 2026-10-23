import { describe, expect, it } from "vitest";
import {
  ACTIONS, ACTIONS_MORT, ACTIONS_NOUVELLES, ACTIONS_V1, CLE_TOUCHES, GROUPES_ACTIONS, LIBELLES_ACTIONS, actionsSansTouche, assigner,
  ecrireTouches, estParDefaut, indexTouches, libelleTouche, lireTouches, normaliser, touchesParDefaut, type Action, type Stockage,
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
    // « passer » (contexte mort) partage Espace avec « saut » (contexte vivant) : c'est le seul recouvrement permis
    const toutes = ACTIONS.filter((a) => !ACTIONS_MORT.includes(a)).flatMap((a) => d[a]).filter(Boolean);
    expect(new Set(toutes).size).toBe(toutes.length);
    expect(d.passer).toEqual(["Space", null]);
    expect(d.saut[0]).toBe("Space");
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

  it("19 actions de l'équipement + 2 du HUD + « passer » : 10 de la v1 conservées, 12 nouvelles, aucune arme1..4", () => {
    expect(ACTIONS_V1).toHaveLength(10);
    expect(ACTIONS_NOUVELLES).toHaveLength(12);
    expect(ACTIONS).toHaveLength(22);
    expect(new Set(ACTIONS).size).toBe(22);
    expect(Object.keys(touchesParDefaut()).sort()).toEqual([...ACTIONS].sort());
    expect(Object.keys(LIBELLES_ACTIONS).sort()).toEqual([...ACTIONS].sort());
    expect(ACTIONS as readonly string[]).not.toContain("arme1");
  });

  it("défauts de la spec : accroupi sur C (jamais Ctrl gauche), équipement, véhicule, grande carte", () => {
    const d = touchesParDefaut();
    expect(d.accroupi).toEqual(["KeyC", null]);
    expect(Object.values(d).flat()).not.toContain("ControlLeft");
    expect(d.armePrincipale).toEqual(["Digit1", "Numpad1"]);
    expect(d.armeSecondaire).toEqual(["Digit2", "Numpad2"]);
    expect(d.couteau).toEqual(["Digit3", "Numpad3"]);
    expect(d.armeSpeciale).toEqual(["Digit4", "Numpad4"]);
    expect(d.armePrecedente).toEqual(["KeyQ", null]);
    expect(d.couteauRapide).toEqual(["KeyV", null]);
    expect(d.interagir).toEqual(["KeyE", null]);
    expect(d.siege).toEqual(["KeyF", null]);
    expect(d.carte).toEqual(["KeyM", null]);
    expect(d.minimapCoin).toEqual([null, null]);
  });

  it("GROUPES_ACTIONS couvre chaque action exactement une fois", () => {
    const toutes = GROUPES_ACTIONS.flatMap((g) => g.actions);
    expect(toutes).toHaveLength(ACTIONS.length);
    expect([...toutes].sort()).toEqual([...ACTIONS].sort());
    expect(GROUPES_ACTIONS.find((g) => g.titre === "Divers")!.actions).toContain("passer");
    expect(GROUPES_ACTIONS.map((g) => g.titre)).toEqual(["Déplacement", "Combat", "Équipement", "Véhicule", "Divers"]);
  });

  it("assigner entre actions nouvelles : déplace la touche et signale l'action dépossédée", () => {
    const { cfg, depossedee } = assigner(touchesParDefaut(), "armePrecedente", 1, "KeyV");
    expect(cfg.armePrecedente).toEqual(["KeyQ", "KeyV"]);
    expect(cfg.couteauRapide).toEqual([null, null]);
    expect(depossedee).toBe("couteauRapide");
    const m = assigner(touchesParDefaut(), "minimapCoin", 0, "KeyM");
    expect(m.cfg.minimapCoin).toEqual(["KeyM", null]);
    expect(m.cfg.carte).toEqual([null, null]);
    expect(m.depossedee).toBe("carte");
  });

  it("« passer » (rejeu de la killcam) : Espace par défaut, partagé avec « saut » ; remappable ; un contexte ne dépossède pas l'autre", () => {
    const d = touchesParDefaut();
    expect(indexTouches(d).get("Space")).toEqual(["saut", "passer"]);
    // reprendre Espace pour « saut » ne retire rien à « passer » (et réciproquement)
    const r = assigner(d, "saut", 1, "Space");
    expect(r.depossedee).toBeNull();
    expect(r.cfg.passer).toEqual(["Space", null]);
    const p = assigner(d, "passer", 1, "KeyE");
    expect(p.cfg.passer).toEqual(["Space", "KeyE"]);
    expect(p.cfg.interagir).toEqual(["KeyE", null]); // KeyE sert aux deux contextes
    expect(p.depossedee).toBeNull();
    // deux actions « mort » ne se partagent pas une touche (il n'y en a qu'une aujourd'hui : le test garde la règle)
    expect(ACTIONS_MORT).toEqual(["passer"]);
    // facultative : sans touche, pas d'avertissement (le bouton « Passer » existe)
    expect(actionsSansTouche(assigner(d, "passer", 0, null).cfg)).toEqual([]);
  });

  it("une sauvegarde sans « passer » (avant cette action) la reçoit avec Espace, même si « saut » a Espace", () => {
    const brut = Object.fromEntries(ACTIONS.filter((a) => a !== "passer").map((a) => [a, touchesParDefaut()[a]]));
    const cfg = normaliser(brut);
    expect(cfg.saut[0]).toBe("Space");
    expect(cfg.passer).toEqual(["Space", null]);
  });

  it("défauts : aucune action obligatoire sans touche ; minimapCoin est facultative", () => {
    expect(actionsSansTouche(touchesParDefaut())).toEqual([]);
    const { cfg } = assigner(touchesParDefaut(), "siege", 0, null);
    expect(actionsSansTouche(cfg)).toEqual(["siege"]);
  });

  describe("migration d'une sauvegarde v1 (14 actions)", () => {
    const v1 = (): Record<string, [string | null, string | null]> => ({
      avant: ["KeyW", "ArrowUp"], arriere: ["KeyS", "ArrowDown"], gauche: ["KeyA", "ArrowLeft"], droite: ["KeyD", "ArrowRight"],
      saut: ["Space", null], sprint: ["ShiftLeft", "ShiftRight"], tir: ["Souris0", null], visee: ["Souris2", null],
      recharger: ["KeyR", null], arme1: ["Digit1", "Numpad1"], arme2: ["Digit2", "Numpad2"], arme3: ["Digit3", "Numpad3"],
      arme4: ["Digit4", "Numpad4"], scores: ["Tab", null],
    });
    const lire = (brut: unknown) => lireTouches(memoire({ [CLE_TOUCHES]: JSON.stringify(brut) }));

    it("une sauvegarde v1 intacte donne la configuration par défaut", () => {
      expect(lire(v1())).toEqual(touchesParDefaut());
    });

    it("les touches v1 personnalisées sont conservées, arme1..4 sont ignorées", () => {
      const sauve = { ...v1(), avant: ["KeyZ", null], tir: ["Souris0", "KeyG"], arme1: ["KeyH", null] };
      const cfg = lire(sauve);
      expect(cfg.avant).toEqual(["KeyZ", null]);
      expect(cfg.tir).toEqual(["Souris0", "KeyG"]);
      expect(Object.values(cfg).flat()).not.toContain("KeyH");
      expect("arme1" in cfg).toBe(false);
    });

    for (const code of ["KeyE", "KeyC", "KeyF", "KeyQ", "KeyV", "KeyM"]) {
      it(`recharger sur ${code} : l'action v1 la garde, la nouvelle correspondante reste sans touche et est signalée`, () => {
        const cfg = lire({ ...v1(), recharger: [code, null] });
        expect(cfg.recharger).toEqual([code, null]);
        const nouvelle = (Object.keys(touchesParDefaut()) as Action[]).find((a) => a !== "recharger" && touchesParDefaut()[a][0] === code)!;
        expect(cfg[nouvelle]).toEqual([null, null]);
        expect(actionsSansTouche(cfg)).toEqual([nouvelle]);
        const toutes = ACTIONS.filter((a) => !ACTIONS_MORT.includes(a)).flatMap((a) => cfg[a]).filter(Boolean);
        expect(new Set(toutes).size).toBe(toutes.length);
      });
    }

    it("conflit sur le premier emplacement seulement : la nouvelle action reprend son second emplacement par défaut", () => {
      const cfg = lire({ ...v1(), saut: ["Digit1", null] });
      expect(cfg.saut).toEqual(["Digit1", null]);
      expect(cfg.armePrincipale).toEqual(["Numpad1", null]);
      expect(actionsSansTouche(cfg)).toEqual([]);
    });

    it("une action v1 vidée par le joueur ne rend pas sa touche à une nouvelle action si celle-ci l'a déjà", () => {
      const cfg = lire({ ...v1(), recharger: [null, null] });
      expect(cfg.recharger).toEqual([null, null]);
      expect(actionsSansTouche(cfg)).toEqual(["recharger"]);
    });
  });

  it("une sauvegarde v2 est relue telle quelle ; une action nouvelle abîmée retombe sur son défaut libre", () => {
    const perso = assigner(touchesParDefaut(), "interagir", 1, "KeyT").cfg;
    const s = memoire();
    ecrireTouches(perso, s);
    expect(lireTouches(s)).toEqual(perso);
    const abimee = lireTouches(memoire({ [CLE_TOUCHES]: JSON.stringify({ ...perso, accroupi: "oups" }) }));
    expect(abimee.accroupi).toEqual(["KeyC", null]);
  });
});
