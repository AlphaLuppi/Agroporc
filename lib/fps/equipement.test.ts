import { describe, expect, it } from "vitest";
import {
  CLE_EQUIPEMENT, armeDuSlot, depuisAlias, ecrireEquipement, estArmeFeu, estPrincipale, estSecondaire, estSlot, estSpeciale, estUnique,
  lireEquipement, lireSlots, meleeDe, normaliserEquipement, serialiserSlots, slotDeLArme, slotVoisin, type LigneSlot,
} from "./equipement";
import { ARMES, EQUIPEMENT_DEFAUT, copierEquipement, type Equipement } from "./protocole";
import { STATS } from "./armes";

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
      // (v7) le pistolet à rayons, secondaire des zombies seulement, n'est dans aucune liste de l'arène
      // (v8) les armes des zombies (Brochette, Soufflerie, Perforeuse…) non plus
      if (STATS[a].zombiesSeulement) { expect(estPrincipale(a) || estSecondaire(a)).toBe(false); continue; }
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

  it("(v10) emplacements génériques : toute arme à feu dans la principale, la secondaire ou la spéciale (inventaire des zombies)", () => {
    expect(lireSlots("principale:pistolet:12:12|secondaire:pompe:8:8|speciale:sniper:5:5")).toEqual([
      { slot: "principale", arme: "pistolet", munitions: 12, chargeur: 12 },
      { slot: "secondaire", arme: "pompe", munitions: 8, chargeur: 8 },
      { slot: "speciale", arme: "sniper", munitions: 5, chargeur: 5 },
    ]);
  });

  it("tolère une 5e colonne (réserve) et saute les lignes abîmées", () => {
    expect(lireSlots("principale:fusil_assaut:23:30:90|n'importe:quoi|couteau:bazooka:1:1|speciale:epee:0:0|secondaire:pistolet:x:12|secondaire:pistolet:12:12:-1"))
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

describe("arme blanche : melee optionnel (épée)", () => {
  it("meleeDe : couteau tant que la clé est absente", () => {
    expect(meleeDe(base())).toBe("couteau");
    expect(meleeDe({ ...base(), melee: "epee" })).toBe("epee");
    expect(meleeDe(EQUIPEMENT_DEFAUT)).toBe("couteau");
  });

  it("armeDuSlot(couteau) renvoie l'arme blanche équipée ; slotDeLArme('epee') = couteau", () => {
    const eq: Equipement = { ...base(), melee: "epee" };
    expect(armeDuSlot(eq, "couteau")).toBe("epee");
    expect(armeDuSlot(base(), "couteau")).toBe("couteau");
    expect(slotDeLArme(eq, "epee")).toBe("couteau");
    expect(slotDeLArme(base(), "epee")).toBe("couteau");
    expect(slotDeLArme(eq, "couteau")).toBe("couteau");
    // le reste ne change pas
    expect(armeDuSlot(eq, "principale")).toBe("fusil_assaut");
  });

  it("normaliserEquipement : seul l'épée écrit la clé, 'couteau' = absent, valeur inconnue = ancienne valeur", () => {
    expect(normaliserEquipement({ melee: "epee" }, base())).toEqual({ ...base(), melee: "epee" });
    const rendu = normaliserEquipement({ melee: "couteau" }, { ...base(), melee: "epee" });
    expect(rendu).toEqual(base());
    expect("melee" in rendu).toBe(false);
    expect(normaliserEquipement({ melee: "hache" }, { ...base(), melee: "epee" }).melee).toBe("epee");
    expect("melee" in normaliserEquipement({ melee: "hache" }, base())).toBe(false);
    expect("melee" in normaliserEquipement({ principale: "pompe" }, base())).toBe(false);
  });

  it("lireEquipement / ecrireEquipement : aller-retour de l'épée, sauvegarde ancienne sans melee toujours valide", () => {
    const s = memoire();
    expect(ecrireEquipement({ principale: "sniper", secondaire: "revolver", melee: "epee" }, s)).toBe(true);
    expect(JSON.parse(s.donnees[CLE_EQUIPEMENT])).toEqual({ principale: "sniper", secondaire: "revolver", melee: "epee" });
    expect(lireEquipement(s)).toEqual({ principale: "sniper", secondaire: "revolver", melee: "epee" });
    // le couteau n'écrit pas la clé
    const s2 = memoire();
    ecrireEquipement({ principale: "sniper", secondaire: "revolver", melee: "couteau" }, s2);
    expect(JSON.parse(s2.donnees[CLE_EQUIPEMENT])).toEqual({ principale: "sniper", secondaire: "revolver" });
    expect(lireEquipement(s2)).toEqual({ principale: "sniper", secondaire: "revolver" });
    // sauvegarde d'avant la v5
    const ancienne = memoire({ [CLE_EQUIPEMENT]: JSON.stringify({ principale: "pompe", secondaire: "mini_uzi" }) });
    const lu = lireEquipement(ancienne);
    expect(lu).toEqual({ principale: "pompe", secondaire: "mini_uzi" });
    expect("melee" in lu).toBe(false);
    // valeur abîmée
    expect(lireEquipement(memoire({ [CLE_EQUIPEMENT]: JSON.stringify({ principale: "pompe", secondaire: "mini_uzi", melee: 3 }) })))
      .toEqual({ principale: "pompe", secondaire: "mini_uzi" });
  });

  it("lireSlots / serialiserSlots acceptent l'épée", () => {
    const lignes: LigneSlot[] = [
      { slot: "secondaire", arme: "pistolet", munitions: 12, chargeur: 12 },
      { slot: "couteau", arme: "epee", munitions: 0, chargeur: 0 },
    ];
    const s = serialiserSlots(lignes);
    expect(s).toBe("secondaire:pistolet:12:12|couteau:epee:0:0");
    expect(lireSlots(s)).toEqual(lignes);
    expect(lireSlots("couteau:hache:0:0")).toEqual([]);
  });

  it("copierEquipement garde melee", () => {
    expect(copierEquipement({ ...base(), melee: "epee" }).melee).toBe("epee");
  });
});

describe("équipement sans arme principale (zombies)", () => {
  const sans = (): Equipement => ({ principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true });

  it("armeDuSlot(principale) = null, les autres slots inchangés", () => {
    expect(armeDuSlot(sans(), "principale")).toBeNull();
    expect(armeDuSlot(sans(), "secondaire")).toBe("pistolet");
    expect(armeDuSlot(sans(), "couteau")).toBe("couteau");
    expect(armeDuSlot({ ...sans(), melee: "epee" }, "couteau")).toBe("epee");
  });

  it("slotDeLArme : la valeur de remplissage n'est pas portée", () => {
    expect(slotDeLArme(sans(), "mitraillette")).toBeNull();
    expect(slotDeLArme(sans(), "pistolet")).toBe("secondaire");
    // sans le drapeau, la mitraillette est bien la principale
    expect(slotDeLArme({ ...sans(), sansPrincipale: undefined }, "mitraillette")).toBe("principale");
  });

  it("slotVoisin saute la principale (et la spéciale vide), dans les deux sens", () => {
    const eq = sans();
    expect(slotVoisin(eq, "secondaire", 1)).toBe("couteau");
    expect(slotVoisin(eq, "couteau", 1)).toBe("secondaire");
    expect(slotVoisin(eq, "secondaire", -1)).toBe("couteau");
    expect(slotVoisin(eq, "couteau", -1)).toBe("secondaire");
  });

  it("depuisAlias avec une principale retire le drapeau, avec une secondaire le garde", () => {
    const a = depuisAlias("sniper", sans());
    expect(a?.equip.principale).toBe("sniper");
    expect(a?.equip.sansPrincipale).toBeUndefined();
    expect(armeDuSlot(a!.equip, "principale")).toBe("sniper");
    expect(depuisAlias("revolver", sans())?.equip.sansPrincipale).toBe(true);
  });
});

describe("sansSecondaire (Battle Royale, v8)", () => {
  const nu = (): Equipement => ({ principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true, sansSecondaire: true });

  it("armeDuSlot : la secondaire est vide, le couteau reste en main", () => {
    expect(armeDuSlot(nu(), "secondaire")).toBeNull();
    expect(armeDuSlot(nu(), "principale")).toBeNull();
    expect(armeDuSlot(nu(), "couteau")).toBe("couteau");
    expect(armeDuSlot({ ...nu(), sansSecondaire: undefined }, "secondaire")).toBe("pistolet");
    expect(armeDuSlot(base(), "secondaire")).toBe("revolver");
  });

  it("slotDeLArme : la valeur de remplissage n'est pas portée", () => {
    expect(slotDeLArme(nu(), "pistolet")).toBeNull();
    expect(slotDeLArme(nu(), "mitraillette")).toBeNull();
    const seulePrincipale: Equipement = { ...base(), sansSecondaire: true };
    expect(slotDeLArme(seulePrincipale, "revolver")).toBeNull();
    expect(slotDeLArme(seulePrincipale, "fusil_assaut")).toBe("principale");
  });

  it("slotVoisin saute le slot secondaire vide", () => {
    const eq: Equipement = { ...base(), sansSecondaire: true };
    expect(slotVoisin(eq, "principale", 1)).toBe("couteau");
    expect(slotVoisin(eq, "couteau", -1)).toBe("principale");
    expect(slotVoisin(nu(), "couteau", 1)).toBe("couteau");
  });

  it("normaliserEquipement garde le drapeau tant qu'aucune secondaire n'est fournie, et le retire sinon", () => {
    const prec = nu();
    expect(normaliserEquipement({}, prec).sansSecondaire).toBe(true);
    expect(normaliserEquipement({ principale: "sniper" }, prec).sansSecondaire).toBe(true);
    expect(normaliserEquipement({ secondaire: "pompe" }, prec).sansSecondaire).toBe(true); // `pompe` n'est pas une secondaire
    const r = normaliserEquipement({ secondaire: "revolver" }, prec);
    expect(r.secondaire).toBe("revolver");
    expect("sansSecondaire" in r).toBe(false);
    // `prec` n'est pas modifié
    expect(prec.sansSecondaire).toBe(true);
  });

  it("depuisAlias : choisir une secondaire en fournit une", () => {
    const r = depuisAlias("revolver", nu());
    expect(r?.main).toBe("secondaire");
    expect("sansSecondaire" in r!.equip).toBe(false);
    expect(r!.equip.sansPrincipale).toBe(true);
  });

  it("copierEquipement garde le drapeau (équipement de départ copié par joueur)", () => {
    expect(copierEquipement(nu()).sansSecondaire).toBe(true);
  });
});

describe("(v8) arme au Micro-ondes (`enCuisson`)", () => {
  const eq = (): Equipement => ({ principale: "pompe", secondaire: "pistolet", speciale: null, enCuisson: "pistolet" });
  it("son slot est vide : armeDuSlot / slotDeLArme renvoient null, le slot voisin la saute ; les autres slots ne changent pas", () => {
    expect(armeDuSlot(eq(), "secondaire")).toBeNull();
    expect(slotDeLArme(eq(), "pistolet")).toBeNull();
    expect(armeDuSlot(eq(), "principale")).toBe("pompe");
    expect(slotVoisin(eq(), "principale", 1)).toBe("couteau");
    // une autre arme écrite dans le slot (Rayon de la recette) n'est pas concernée
    expect(armeDuSlot({ ...eq(), secondaire: "rayon" }, "secondaire")).toBe("rayon");
  });
  it("copierEquipement la garde (jamais de clé `undefined`)", () => {
    expect(copierEquipement(eq()).enCuisson).toBe("pistolet");
    expect("enCuisson" in copierEquipement({ ...eq(), enCuisson: undefined })).toBe(false);
  });
});
