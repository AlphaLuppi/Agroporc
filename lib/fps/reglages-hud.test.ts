import { describe, expect, it } from "vitest";
import {
  CLE_HUD, CLE_MINIMAP, REGLAGES_HUD_DEFAUT, attributsHud, coinSuivant, ecrireReglagesHud, lireReglagesHud, orientationEffective,
  validerReglagesInterface, validerReglagesMinimap, type CoinMinimap, type ReglagesHud,
} from "./reglages-hud";

/** Stockage en mémoire, avec options pour faire lever la lecture ou l'écriture. */
function faux(init: Record<string, string> = {}, leve: "lecture" | "ecriture" | null = null) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem(k: string) { if (leve === "lecture") throw new Error("SecurityError"); return m.get(k) ?? null; },
    setItem(k: string, v: string) { if (leve === "ecriture") throw new Error("QuotaExceededError"); m.set(k, v); },
  };
}

describe("reglages-hud : constantes de la spec HUD §4.5", () => {
  it("clés et défauts", () => {
    expect(CLE_MINIMAP).toBe("pdj-fps-minimap");
    expect(CLE_HUD).toBe("pdj-fps-hud");
    expect(REGLAGES_HUD_DEFAUT.minimap).toEqual({ v: 1, coin: "hg", taille: "m", rayon: 100 });
    expect(REGLAGES_HUD_DEFAUT.interface).toEqual({ v: 1, echelle: 1, effets: "auto" });
  });
});

describe("validerReglagesMinimap", () => {
  it("accepte une sauvegarde valide, orientation comprise", () => {
    const r = { v: 1, coin: "bd", taille: "l", orientation: "nord", rayon: 160 };
    expect(validerReglagesMinimap(r)).toEqual(r);
  });

  it("orientation absente : la clé reste absente (décidé par prefers-reduced-motion)", () => {
    const r = validerReglagesMinimap({ v: 1, coin: "hd", taille: "s", rayon: 60 });
    expect("orientation" in r).toBe(false);
    expect(r).toEqual({ v: 1, coin: "hd", taille: "s", rayon: 60 });
  });

  it("valeur hors liste : défaut de ce champ seulement", () => {
    const r = validerReglagesMinimap({ v: 1, coin: "milieu", taille: "xl", orientation: "sud", rayon: 120 });
    expect(r).toEqual({ v: 1, coin: "hg", taille: "m", rayon: 100 });
    expect(validerReglagesMinimap({ v: 1, coin: "bg", taille: "l", rayon: "160" })).toEqual({ v: 1, coin: "bg", taille: "l", rayon: 100 });
  });

  it("version inconnue, type inattendu ou null : défauts, sans erreur et sans partager la référence", () => {
    for (const brut of [{ v: 2, coin: "bd", taille: "l", rayon: 160 }, { coin: "bd" }, [], "texte", 12, null, undefined]) {
      expect(validerReglagesMinimap(brut)).toEqual({ v: 1, coin: "hg", taille: "m", rayon: 100 });
    }
    const a = validerReglagesMinimap(null);
    a.coin = "off";
    expect(validerReglagesMinimap(null).coin).toBe("hg");
  });
});

describe("validerReglagesInterface", () => {
  it("accepte les trois échelles et les deux modes d'effets", () => {
    expect(validerReglagesInterface({ v: 1, echelle: 0.9, effets: "reduits" })).toEqual({ v: 1, echelle: 0.9, effets: "reduits" });
    expect(validerReglagesInterface({ v: 1, echelle: 1.15, effets: "auto" })).toEqual({ v: 1, echelle: 1.15, effets: "auto" });
  });
  it("hors liste ou version inconnue : défauts", () => {
    expect(validerReglagesInterface({ v: 1, echelle: 2, effets: "max" })).toEqual({ v: 1, echelle: 1, effets: "auto" });
    expect(validerReglagesInterface({ v: 3, echelle: 0.9, effets: "reduits" })).toEqual({ v: 1, echelle: 1, effets: "auto" });
    expect(validerReglagesInterface("0.9")).toEqual({ v: 1, echelle: 1, effets: "auto" });
  });
});

describe("lireReglagesHud / ecrireReglagesHud", () => {
  it("stockage vide ou absent : défauts", () => {
    expect(lireReglagesHud(faux())).toEqual(REGLAGES_HUD_DEFAUT);
    expect(lireReglagesHud(null)).toEqual(REGLAGES_HUD_DEFAUT);
  });

  it("JSON invalide : défauts, sans erreur", () => {
    const s = faux({ [CLE_MINIMAP]: "{pas du json", [CLE_HUD]: "" });
    expect(lireReglagesHud(s)).toEqual(REGLAGES_HUD_DEFAUT);
  });

  it("stockage qui lève à la lecture : défauts", () => {
    const s = faux({ [CLE_MINIMAP]: JSON.stringify({ v: 1, coin: "bd", taille: "m", rayon: 100 }) }, "lecture");
    expect(lireReglagesHud(s)).toEqual(REGLAGES_HUD_DEFAUT);
  });

  it("aller-retour : ce qui est écrit est relu à l'identique", () => {
    const r: ReglagesHud = {
      minimap: { v: 1, coin: "bg", taille: "s", orientation: "nord", rayon: 160 },
      interface: { v: 1, echelle: 1.15, effets: "reduits" },
    };
    const s = faux();
    expect(ecrireReglagesHud(r, s)).toBe(true);
    expect(JSON.parse(s.m.get(CLE_MINIMAP) ?? "")).toEqual(r.minimap);
    expect(JSON.parse(s.m.get(CLE_HUD) ?? "")).toEqual(r.interface);
    expect(lireReglagesHud(s)).toEqual(r);
  });

  it("n'écrit jamais d'orientation quand elle est absente", () => {
    const s = faux();
    ecrireReglagesHud(REGLAGES_HUD_DEFAUT, s);
    expect(s.m.get(CLE_MINIMAP)).toBe('{"v":1,"coin":"hg","taille":"m","rayon":100}');
  });

  it("écriture : faux si le stockage lève ou manque, sans erreur", () => {
    expect(ecrireReglagesHud(REGLAGES_HUD_DEFAUT, faux({}, "ecriture"))).toBe(false);
    expect(ecrireReglagesHud(REGLAGES_HUD_DEFAUT, null)).toBe(false);
  });

  it("sans stockage injecté, sous Node (pas de localStorage) : défauts et écriture refusée sans erreur", () => {
    expect(lireReglagesHud()).toEqual(REGLAGES_HUD_DEFAUT);
    expect(ecrireReglagesHud(REGLAGES_HUD_DEFAUT)).toBe(false);
  });
});

describe("orientationEffective", () => {
  const base = REGLAGES_HUD_DEFAUT.minimap;
  it("orientation absente : « regard », ou « nord » avec prefers-reduced-motion", () => {
    expect(orientationEffective(base, false)).toBe("regard");
    expect(orientationEffective(base, true)).toBe("nord");
  });
  it("un choix du joueur l'emporte sur prefers-reduced-motion", () => {
    expect(orientationEffective({ ...base, orientation: "regard" }, true)).toBe("regard");
    expect(orientationEffective({ ...base, orientation: "nord" }, false)).toBe("nord");
  });
});

describe("coinSuivant (action minimapCoin)", () => {
  it("fait défiler les cinq états et revient au départ", () => {
    const vus: CoinMinimap[] = [];
    let c: CoinMinimap = "hg";
    for (let i = 0; i < 5; i++) { c = coinSuivant(c); vus.push(c); }
    expect(vus).toEqual(["hd", "bd", "bg", "off", "hg"]);
    expect(new Set(vus).size).toBe(5);
  });
});

describe("attributsHud", () => {
  it("expose data-effets et --echelle-hud", () => {
    expect(attributsHud({ minimap: REGLAGES_HUD_DEFAUT.minimap, interface: { v: 1, echelle: 0.9, effets: "reduits" } })).toEqual({
      "data-effets": "reduits", style: { "--echelle-hud": 0.9 },
    });
  });
});
