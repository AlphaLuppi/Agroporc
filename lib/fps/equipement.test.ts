import { describe, expect, it } from "vitest";
import {
  CLE_EQUIPEMENT, armeDuSlot, depuisAlias, ecrireEquipement, estArmeFeu, estPrincipale, estSecondaire, estSlot, estSpeciale, estUnique,
  lireEquipement, lireSlots, normaliserEquipement, serialiserSlots, slotDeLArme, slotVoisin, type LigneSlot,
} from "./equipement";
import { ARMES, EQUIPEMENT_DEFAUT, copierEquipement, type Equipement } from "./protocole";

function memoire(init: Record<string, string> = {}) {
  const donnees = { ...init };
  return {
    donnees,
    getItem: (k: string) => (k in donnees ? donnees[k] : null),
    setItem: (k: string, v: string) => { donnees[k] = v; },
  };
}

const base = (): Equipement => ({ principale: "fusil_assaut", secondaire: "revolver", speciale: null });

describe("garde-fous de types", () => {
  it("chaque arme est dans une seule catégorie", () => {
    for (const a of ARMES) {
      const n = [estPrincipale(a), estSecondaire(a), estSpeciale(a), estUnique(a)].filter(Boolean).length;
      expect(n, a).toBe(1);
      expect(estArmeFeu(a)).toBe(true);
    }
    expect(estArmeFeu("couteau")).toBe(false);
    expect(estPrincipale("pistolet")).toBe(false);
    expect(estSecondaire(42)).toBe(false);
    expect(estSpeciale(null)).toBe(false);
  });

  it("estSlot", () => {
    for (const s of ["principale", "secondaire", "couteau", "speciale"]) expect(estSlot(s)).toBe(true);
    expect(estSlot("arme")).toBe(false);
    expect(estSlot(undefined)).toBe(false);
  });
});

describe("armeDuSlot / slotDeLArme", () => {
  it("lit chaque slot, le couteau est toujours là, la spéciale peut être vide", () => {
    const eq = base();
    expect(armeDuSlot(eq, "principale")).toBe("fusil_assaut");
    expect(armeDuSlot(eq, "secondaire")).toBe("revolver");
    expect(armeDuSlot(eq, "couteau")).toBe("couteau");
    expect(armeDuSlot(eq, "speciale")).toBeNull();
    eq.speciale = "railgun";
    expect(armeDuSlot(eq, "speciale")).toBe("railgun");
  });

  it("slotDeLArme est l'inverse, null pour une arme non portée", () => {
    const eq = { ...base(), speciale: "minigun" as const };
    expect(slotDeLArme(eq, "fusil_assaut")).toBe("principale");
    expect(slotDeLArme(eq, "revolver")).toBe("secondaire");
    expect(slotDeLArme(eq, "minigun")).toBe("speciale");
    expect(slotDeLArme(eq, "couteau")).toBe("couteau");
    expect(slotDeLArme(eq, "sniper")).toBeNull();
    expect(slotDeLArme(base(), "minigun")).toBeNull();
  });
});

describe("normaliserEquipement", () => {
  it("garde les valeurs valides, remplace les autres par `prec`, ne touche pas à la spéciale", () => {
    const prec = { ...base(), speciale: "railgun" as const };
    expect(normaliserEquipement({ principale: "sniper", secondaire: "mini_uzi" }, prec))
      .toEqual({ principale: "sniper", secondaire: "mini_uzi", speciale: "railgun" });
    expect(normaliserEquipement({ principale: "pistolet", secondaire: "pompe" }, prec)).toEqual(prec);
    expect(normaliserEquipement({ principale: "railgun" }, prec).principale).toBe("fusil_assaut");
    expect(normaliserEquipement({}, prec)).toEqual(prec);
  });

  it("rend une copie : ni `prec` ni EQUIPEMENT_DEFAUT ne sont partagés", () => {
    const r = normaliserEquipement({}, EQUIPEMENT_DEFAUT);
    expect(r).not.toBe(EQUIPEMENT_DEFAUT);
    r.speciale = "railgun";
    expect(EQUIPEMENT_DEFAUT.speciale).toBeNull();
  });
});

describe("depuisAlias (champ v1 `arme`)", () => {
  it("une principale se range en principale, main principale", () => {
    expect(depuisAlias("sniper", base())).toEqual({ equip: { principale: "sniper", secondaire: "revolver", speciale: null }, main: "principale" });
  });

  it("une secondaire se range en secondaire, main secondaire", () => {
    expect(depuisAlias("pistolet", base())).toEqual({ equip: { principale: "fusil_assaut", secondaire: "pistolet", speciale: null }, main: "secondaire" });
  });

  it("spéciale, couteau ou invalide : null", () => {
    expect(depuisAlias("railgun", base())).toBeNull();
    expect(depuisAlias("couteau", base())).toBeNull();
    expect(depuisAlias("bazooka", base())).toBeNull();
    expect(depuisAlias(undefined, base())).toBeNull();
  });

  it("ne modifie pas `prec`", () => {
    const prec = base();
    depuisAlias("sniper", prec);
    expect(prec).toEqual(base());
  });
});

describe("slotVoisin", () => {
  it("cyclique dans les deux sens, spéciale vide sautée", () => {
    const eq = base();
    expect(slotVoisin(eq, "principale", 1)).toBe("secondaire");
    expect(slotVoisin(eq, "secondaire", 1)).toBe("couteau");
    expect(slotVoisin(eq, "couteau", 1)).toBe("principale");
    expect(slotVoisin(eq, "principale", -1)).toBe("couteau");
    expect(slotVoisin(eq, "couteau", -1)).toBe("secondaire");
  });

  it("avec une spéciale portée, elle est dans le cycle", () => {
    const eq = { ...base(), speciale: "railgun" as const };
    expect(slotVoisin(eq, "couteau", 1)).toBe("speciale");
    expect(slotVoisin(eq, "speciale", 1)).toBe("principale");
    expect(slotVoisin(eq, "principale", -1)).toBe("speciale");
  });

  it("depuis un slot spécial devenu vide : rejoint le slot voisin portant une arme", () => {
    expect(slotVoisin(base(), "speciale", 1)).toBe("principale");
    expect(slotVoisin(base(), "speciale", -1)).toBe("couteau");
  });
});

describe("lireEquipement / ecrireEquipement", () => {
  it("défaut sans stockage ou stockage vide", () => {
    const d = { principale: EQUIPEMENT_DEFAUT.principale, secondaire: EQUIPEMENT_DEFAUT.secondaire };
    expect(lireEquipement()).toEqual(d);
    expect(lireEquipement(null)).toEqual(d);
    expect(lireEquipement(memoire())).toEqual(d);
  });

  it("aller-retour, sans la spéciale", () => {
    const s = memoire();
    expect(ecrireEquipement({ principale: "pompe", secondaire: "mini_uzi" }, s)).toBe(true);
    expect(JSON.parse(s.donnees[CLE_EQUIPEMENT])).toEqual({ principale: "pompe", secondaire: "mini_uzi" });
    expect(lireEquipement(s)).toEqual({ principale: "pompe", secondaire: "mini_uzi" });
  });

  it("écrire sans stockage ou avec un stockage qui refuse renvoie faux", () => {
    expect(ecrireEquipement({ principale: "pompe", secondaire: "pistolet" })).toBe(false);
    expect(ecrireEquipement({ principale: "pompe", secondaire: "pistolet" }, { setItem: () => { throw new Error("quota"); } })).toBe(false);
  });

  it("migre pdj-fps-arme : une principale prend sa place, l'autre slot garde le défaut", () => {
    expect(lireEquipement(memoire({ "pdj-fps-arme": "sniper" }))).toEqual({ principale: "sniper", secondaire: EQUIPEMENT_DEFAUT.secondaire });
    expect(lireEquipement(memoire({ "pdj-fps-arme": "pistolet" }))).toEqual({ principale: EQUIPEMENT_DEFAUT.principale, secondaire: "pistolet" });
  });

  it("la clé v2 l'emporte sur l'ancienne", () => {
    const s = memoire({ "pdj-fps-arme": "sniper", [CLE_EQUIPEMENT]: JSON.stringify({ principale: "pompe", secondaire: "revolver" }) });
    expect(lireEquipement(s)).toEqual({ principale: "pompe", secondaire: "revolver" });
  });

  it("ignore le JSON abîmé, les valeurs inconnues et une arme spéciale ou inconnue en v1", () => {
    const d = { principale: EQUIPEMENT_DEFAUT.principale, secondaire: EQUIPEMENT_DEFAUT.secondaire };
    expect(lireEquipement(memoire({ [CLE_EQUIPEMENT]: "{pas du json" }))).toEqual(d);
    expect(lireEquipement(memoire({ [CLE_EQUIPEMENT]: "42" }))).toEqual(d);
    expect(lireEquipement(memoire({ [CLE_EQUIPEMENT]: "[1,2]" }))).toEqual(d);
    expect(lireEquipement(memoire({ [CLE_EQUIPEMENT]: JSON.stringify({ principale: "railgun", secondaire: 3 }) }))).toEqual(d);
    expect(lireEquipement(memoire({ [CLE_EQUIPEMENT]: JSON.stringify({ principale: "sniper", secondaire: "lance-roquettes" }) })))
      .toEqual({ principale: "sniper", secondaire: d.secondaire });
    expect(lireEquipement(memoire({ "pdj-fps-arme": "railgun" }))).toEqual(d);
    expect(lireEquipement(memoire({ "pdj-fps-arme": "n'importe quoi" }))).toEqual(d);
  });

  it("JSON abîmé sur la clé v2 : retombe sur l'ancienne clé", () => {
    expect(lireEquipement(memoire({ [CLE_EQUIPEMENT]: "{", "pdj-fps-arme": "pompe" })).principale).toBe("pompe");
  });

  it("un stockage qui lève ne casse pas la lecture", () => {
    const d = { principale: EQUIPEMENT_DEFAUT.principale, secondaire: EQUIPEMENT_DEFAUT.secondaire };
    expect(lireEquipement({ getItem: () => { throw new Error("bloqué"); } })).toEqual(d);
  });
});

describe("serialiserSlots / lireSlots", () => {
  const lignes: LigneSlot[] = [
    { slot: "principale", arme: "fusil_assaut", munitions: 23, chargeur: 30 },
    { slot: "secondaire", arme: "pistolet", munitions: 12, chargeur: 12 },
    { slot: "couteau", arme: "couteau", munitions: 0, chargeur: 0 },
    { slot: "speciale", arme: "railgun", munitions: 4, chargeur: 6 },
  ];

  it("format de la spec et aller-retour", () => {
    const s = serialiserSlots(lignes);
    expect(s).toBe("principale:fusil_assaut:23:30|secondaire:pistolet:12:12|couteau:couteau:0:0|speciale:railgun:4:6");
    expect(lireSlots(s)).toEqual(lignes);
  });

  it("chaîne vide : aucune ligne", () => {
    expect(serialiserSlots([])).toBe("");
    expect(lireSlots("")).toEqual([]);
  });

  it("les munitions infinies ou négatives sont écrites 0", () => {
    expect(serialiserSlots([{ slot: "couteau", arme: "couteau", munitions: Infinity, chargeur: -1 }])).toBe("couteau:couteau:0:0");
  });

  it("tolère une 5e colonne (réserve) et saute les lignes abîmées", () => {
    expect(lireSlots("principale:fusil_assaut:23:30:90|n'importe:quoi|secondaire:bazooka:1:1|secondaire:pistolet:x:12|secondaire:pistolet:12:12:-1"))
      .toEqual([
        { slot: "principale", arme: "fusil_assaut", munitions: 23, chargeur: 30 },
        { slot: "secondaire", arme: "pistolet", munitions: 12, chargeur: 12 },
      ]);
  });
});

describe("copie", () => {
  it("copierEquipement reste indépendant (garde-fou du test d'aliasing)", () => {
    const a = copierEquipement(base());
    a.speciale = "minigun";
    expect(base().speciale).toBeNull();
  });
});
