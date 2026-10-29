import { describe, expect, it } from "vitest";
import {
  ACTIONS, ACTIONS_MORT, ACTIONS_NOUVELLES, ACTIONS_V1, ACTIONS_ZOMBIES, CLE_TOUCHES, GROUPES_ACTIONS, LIBELLES_ACTIONS, actionsSansTouche, assigner, conflit,
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
  it("par défaut : ZQSD/WASD physiques, aucune touche en double entre actions qui coexistent", () => {
    const d = touchesParDefaut();
    expect(d.avant[0]).toBe("KeyW");
    // « passer » (contexte mort) partage Espace avec « saut » (contexte vivant) ; les zombies partagent G et B avec l'arène
    const toutes = ACTIONS.filter((a) => !ACTIONS_MORT.includes(a) && !ACTIONS_ZOMBIES.includes(a)).flatMap((a) => d[a]).filter(Boolean);
    expect(new Set(toutes).size).toBe(toutes.length);
    for (const a of ACTIONS) for (const b of ACTIONS) {
      if (a !== b && d[a].some((c) => c !== null && d[b].includes(c))) expect(conflit(a, b)).toBe(false);
    }
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

  it("actions de l'équipement, du HUD, « passer », de la v3, « invoquer » et du Battle Royale : 10 de la v1 conservées, 22 nouvelles, aucune arme1..4", () => {
    expect(ACTIONS_V1).toHaveLength(10);
    expect(ACTIONS_NOUVELLES).toHaveLength(24);
    expect(ACTIONS).toHaveLength(34);
    expect(new Set(ACTIONS).size).toBe(34);
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
    expect(d.invoquer).toEqual(["KeyG", null]);
    // T reste au chat vocal : le sort du tigre ne partage aucune touche avec « parler »
    expect(d.parler).toEqual(["KeyT", null]);
  });

  it("une sauvegarde qui a déjà mis G ailleurs laisse « invoquer » sans touche, signalé dans le menu pause", () => {
    const cfg = normaliser({ ...touchesParDefaut(), recharger: ["KeyG", null], invoquer: undefined });
    expect(cfg.recharger).toEqual(["KeyG", null]);
    expect(cfg.invoquer).toEqual([null, null]);
    expect(actionsSansTouche(cfg)).toContain("invoquer");
  });

  it("(v8) grenades des zombies : G et B, partagés avec le sort et le fumigène de l'arène, jamais avec une action « en vie »", () => {
    const d = touchesParDefaut();
    expect(d.grenade).toEqual(["KeyG", null]);
    expect(d.remontoir).toEqual(["KeyB", null]);
    expect(conflit("grenade", "invoquer")).toBe(false);
    expect(conflit("remontoir", "fumigene")).toBe(false);
    expect(conflit("grenade", "remontoir")).toBe(true);
    expect(conflit("grenade", "recharger")).toBe(true);
    expect(conflit("invoquer", "recharger")).toBe(true);
    expect(conflit("passer", "grenade")).toBe(false);
    expect(indexTouches(d).get("KeyG")).toEqual(["invoquer", "grenade"]);
    // une touche « en vie » sur G dépossède les deux modes
    const { cfg } = assigner(d, "recharger", 1, "KeyG");
    expect(cfg.invoquer).toEqual([null, null]);
    expect(cfg.grenade).toEqual([null, null]);
    // la grenade sur une touche de l'arène ne la lui prend pas ; sur une touche des zombies, si
    const r = assigner(d, "grenade", 1, "KeyK");
    expect(r.cfg.frappeAerienne).toEqual(["KeyK", null]);
    expect(r.depossedee).toBeNull();
    expect(assigner(d, "grenade", 1, "KeyB").depossedee).toBe("remontoir");
  });

  it("(v8) une sauvegarde d'avant les grenades leur donne G et B, même si le sort et le fumigène les ont", () => {
    const brut = Object.fromEntries(ACTIONS.filter((a) => !ACTIONS_ZOMBIES.includes(a)).map((a) => [a, touchesParDefaut()[a]]));
    const cfg = normaliser(brut);
    expect(cfg.invoquer).toEqual(["KeyG", null]);
    expect(cfg.grenade).toEqual(["KeyG", null]);
    expect(cfg.remontoir).toEqual(["KeyB", null]);
    expect(actionsSansTouche(cfg)).toEqual([]);
    // mais pas si une action « en vie » a déjà G
    const pris = normaliser({ ...brut, recharger: ["KeyG", null] });
    expect(pris.grenade).toEqual([null, null]);
    expect(actionsSansTouche(pris)).toContain("grenade");
  });

  it("GROUPES_ACTIONS couvre chaque action exactement une fois", () => {
    const toutes = GROUPES_ACTIONS.flatMap((g) => g.actions);
    expect(toutes).toHaveLength(ACTIONS.length);
    expect([...toutes].sort()).toEqual([...ACTIONS].sort());
    expect(GROUPES_ACTIONS.find((g) => g.titre === "Divers")!.actions).toContain("passer");
    expect(GROUPES_ACTIONS.map((g) => g.titre)).toEqual(["Déplacement", "Combat", "Équipement", "Véhicule", "Battle Royale", "Divers"]);
    expect(GROUPES_ACTIONS.find((g) => g.titre === "Battle Royale")!.actions).toEqual(["soigner", "potion", "lacher", "spectateurSuivant", "spectateurPrecedent"]);
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
    // le contexte « mort » regroupe « passer » et les deux actions du spectateur
    expect(ACTIONS_MORT).toEqual(["passer", "spectateurSuivant", "spectateurPrecedent"]);
    // facultative : sans touche, pas d'avertissement (le bouton « Passer » existe)
    expect(actionsSansTouche(assigner(d, "passer", 0, null).cfg)).toEqual([]);
  });

  describe("Battle Royale (v8)", () => {
    it("défauts : soigner H, potion J, lâcher U, spectateur sur les flèches droite / gauche", () => {
      const d = touchesParDefaut();
      expect(d.soigner).toEqual(["KeyH", null]);
      expect(d.potion).toEqual(["KeyJ", null]);
      expect(d.lacher).toEqual(["KeyU", null]);
      expect(d.spectateurSuivant).toEqual(["ArrowRight", null]);
      expect(d.spectateurPrecedent).toEqual(["ArrowLeft", null]);
      // aucune de ces touches n'était déjà prise par une action « en vie » (hors flèches, qui sont du contexte mort)
      for (const code of ["KeyH", "KeyJ", "KeyU"]) expect(indexTouches(d).get(code)).toHaveLength(1);
    });

    it("libellés en français pour les cinq actions, toutes facultatives (aucun avertissement du menu pause)", () => {
      for (const a of ["soigner", "potion", "lacher", "spectateurSuivant", "spectateurPrecedent"] as const) {
        expect(LIBELLES_ACTIONS[a].length).toBeGreaterThan(5);
        expect(ACTIONS_NOUVELLES).toContain(a);
      }
      expect(actionsSansTouche(assigner(assigner(touchesParDefaut(), "soigner", 0, null).cfg, "lacher", 0, null).cfg)).toEqual([]);
    });

    it("les flèches servent à la fois à se déplacer (en vie) et à changer de joueur suivi (mort), sans dépossession", () => {
      const d = touchesParDefaut();
      expect(indexTouches(d).get("ArrowRight")).toEqual(["droite", "spectateurSuivant"]);
      expect(indexTouches(d).get("ArrowLeft")).toEqual(["gauche", "spectateurPrecedent"]);
      const r = assigner(d, "droite", 1, "ArrowRight");
      expect(r.depossedee).toBeNull();
      expect(r.cfg.spectateurSuivant).toEqual(["ArrowRight", null]);
      // deux actions du contexte mort ne se partagent pas une touche
      const p = assigner(d, "spectateurSuivant", 1, "ArrowLeft");
      expect(p.cfg.spectateurPrecedent).toEqual([null, null]);
      expect(p.depossedee).toBe("spectateurPrecedent");
      expect(p.cfg.gauche).toEqual(["KeyA", "ArrowLeft"]);
    });

    it("une sauvegarde d'avant le BR reçoit les nouvelles actions ; une touche déjà prise les laisse sans touche, sans avertissement", () => {
      const ancien = Object.fromEntries(ACTIONS.filter((a) => !["soigner", "potion", "lacher", "spectateurSuivant", "spectateurPrecedent"].includes(a)).map((a) => [a, touchesParDefaut()[a]]));
      expect(normaliser(ancien)).toEqual(touchesParDefaut());
      const cfg = normaliser({ ...ancien, recharger: ["KeyH", null] });
      expect(cfg.recharger).toEqual(["KeyH", null]);
      expect(cfg.soigner).toEqual([null, null]);
      expect(actionsSansTouche(cfg)).toEqual([]);
      // aller-retour par le stockage
      const s = memoire();
      const perso = assigner(touchesParDefaut(), "potion", 1, "KeyN").cfg;
      ecrireTouches(perso, s);
      expect(lireTouches(s)).toEqual(perso);
    });
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
      const sauve = { ...v1(), avant: ["KeyZ", null], tir: ["Souris0", "KeyG"], arme1: ["KeyP", null] };
      const cfg = lire(sauve);
      expect(cfg.avant).toEqual(["KeyZ", null]);
      expect(cfg.tir).toEqual(["Souris0", "KeyG"]);
      expect(Object.values(cfg).flat()).not.toContain("KeyP");
      expect("arme1" in cfg).toBe(false);
    });

    for (const code of ["KeyE", "KeyC", "KeyF", "KeyQ", "KeyV", "KeyM"]) {
      it(`recharger sur ${code} : l'action v1 la garde, la nouvelle correspondante reste sans touche et est signalée`, () => {
        const cfg = lire({ ...v1(), recharger: [code, null] });
        expect(cfg.recharger).toEqual([code, null]);
        const nouvelle = (Object.keys(touchesParDefaut()) as Action[]).find((a) => a !== "recharger" && touchesParDefaut()[a][0] === code)!;
        expect(cfg[nouvelle]).toEqual([null, null]);
        expect(actionsSansTouche(cfg)).toEqual([nouvelle]);
        const toutes = ACTIONS.filter((a) => !ACTIONS_MORT.includes(a) && !ACTIONS_ZOMBIES.includes(a)).flatMap((a) => cfg[a]).filter(Boolean);
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
