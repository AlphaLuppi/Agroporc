import { describe, expect, it } from "vitest";
import {
  ARMES, ARMES_PRINCIPALES, ARMES_SECONDAIRES, ARMES_SPECIALES, ECHELLE_AVATAR, EQUIPEMENT_DEFAUT, JEU, OEIL_SIEGE, PLAFONDS,
  SILHOUETTE, SILHOUETTE_ACCROUPIE, SLOTS, VERSION_PROTOCOLE, copierEquipement, oeilDe, silhouetteDe,
  type CauseMort, type MessageClient, type MessageServeur, type PassageAvion, type TigreLargueSnap,
} from "./protocole";
import { STATS } from "./armes";

describe("armes", () => {
  it("ARMES : 11 armes sans doublon, listes de catégories disjointes", () => {
    expect(ARMES).toHaveLength(11);
    expect(new Set(ARMES).size).toBe(ARMES.length);
    const toutes = [...ARMES_PRINCIPALES, ...ARMES_SECONDAIRES, ...ARMES_SPECIALES];
    expect(new Set(toutes).size).toBe(toutes.length);
    expect([...ARMES].sort()).toEqual([...toutes].sort());
    expect(ARMES).not.toContain("couteau");
  });

  it("chaque arme a une entrée dans STATS", () => {
    for (const id of ARMES) expect(STATS[id]).toBeDefined();
  });

  it("les slots sont principale, secondaire, couteau, spéciale", () => {
    expect([...SLOTS].sort()).toEqual(["couteau", "principale", "secondaire", "speciale"]);
  });
});

describe("équipement par défaut", () => {
  it("est valide : principale, secondaire (pistolet pour la compatibilité v1), pas de spéciale", () => {
    expect(ARMES_PRINCIPALES).toContain(EQUIPEMENT_DEFAUT.principale);
    expect(ARMES_SECONDAIRES).toContain(EQUIPEMENT_DEFAUT.secondaire);
    expect(EQUIPEMENT_DEFAUT.secondaire).toBe("pistolet");
    expect(EQUIPEMENT_DEFAUT.speciale).toBeNull();
  });

  it("est figé, et copierEquipement renvoie une copie indépendante", () => {
    expect(Object.isFrozen(EQUIPEMENT_DEFAUT)).toBe(true);
    const copie = copierEquipement(EQUIPEMENT_DEFAUT);
    expect(Object.isFrozen(copie)).toBe(false);
    expect(copie).toEqual(EQUIPEMENT_DEFAUT);
    copie.speciale = "railgun";
    copie.principale = "sniper";
    expect(EQUIPEMENT_DEFAUT.speciale).toBeNull();
    expect(EQUIPEMENT_DEFAUT.principale).toBe("mitraillette");
    const autre = copierEquipement(EQUIPEMENT_DEFAUT);
    expect(autre.speciale).toBeNull();
    expect(autre).not.toBe(copie);
  });
});

describe("silhouette", () => {
  it("silhouetteDe choisit la silhouette debout ou accroupie", () => {
    expect(silhouetteDe(false)).toBe(SILHOUETTE);
    expect(silhouetteDe(undefined)).toBe(SILHOUETTE);
    expect(silhouetteDe(true)).toBe(SILHOUETTE_ACCROUPIE);
  });

  it("oeilDe : debout 1,95 ; accroupi 1,30 ; assis OEIL_SIEGE (1,30)", () => {
    expect(oeilDe({})).toBe(1.95);
    expect(oeilDe({ accroupi: false })).toBe(1.95);
    expect(oeilDe({ accroupi: true })).toBe(1.3);
    expect(oeilDe({ vehicule: { id: 0, siege: 0 } })).toBe(OEIL_SIEGE);
    expect(oeilDe({ accroupi: true, vehicule: { id: 0, siege: 1 } })).toBe(OEIL_SIEGE);
    expect(OEIL_SIEGE).toBe(1.3);
  });

  it("le rayon du corps reste sous 0,5 m ; le cylindre de collision ne grossit pas", () => {
    expect(SILHOUETTE.corps.rayon).toBeLessThan(0.5);
    expect(SILHOUETTE_ACCROUPIE.corps.rayon).toBeLessThan(0.5);
    expect(SILHOUETTE.rayon).toBe(0.4);
    expect(SILHOUETTE.hauteur).toBe(1.8);
    expect(SILHOUETTE_ACCROUPIE.rayon).toBe(0.4);
  });

  it("la boule englobante couvre les pieds et le haut de la tête, debout et accroupi", () => {
    for (const s of [SILHOUETTE, SILHOUETTE_ACCROUPIE]) {
      const hautTete = s.tete.y + s.tete.rayon;
      expect(s.rayonEnglobant).toBeGreaterThanOrEqual(hautTete - s.centreY);
      expect(s.rayonEnglobant).toBeGreaterThanOrEqual(s.centreY - (s.corps.y0 - s.corps.rayon));
      // les extrémités horizontales du corps y tiennent aussi
      expect(s.rayonEnglobant).toBeGreaterThanOrEqual(Math.hypot(s.corps.rayon, s.corps.y1 - s.centreY));
    }
  });

  it("la tête agrandie reste au-dessus de l'œil du joueur à ECHELLE_AVATAR", () => {
    expect(ECHELLE_AVATAR).toBe(1.25);
    expect(SILHOUETTE.tete.y).toBeGreaterThan(SILHOUETTE.oeil);
    expect(SILHOUETTE_ACCROUPIE.oeil).toBeLessThan(SILHOUETTE.oeil);
  });
});

describe("constantes", () => {
  it("version 5 du protocole (événements de la v4 et tigres largués, avion, sort d'invocation)", () => {
    expect(VERSION_PROTOCOLE).toBe(5);
  });

  it("chaîne de plafonds de vitesse : sprint couteau ≤ plafond horizontal ≤ plafond déclaré", () => {
    expect(PLAFONDS.vitesseHorizontaleMax).toBeLessThan(PLAFONDS.vitesseDeclareeMax + 1e-9);
    expect(PLAFONDS.vitesseDeclareeMax).toBeLessThan(PLAFONDS.vitesseVehiculeMax);
    expect(12.5 * 1.3).toBeLessThanOrEqual(PLAFONDS.vitesseHorizontaleMax);
  });

  it("JEU : réapparition 4 s (2,5 s de rejeu + 1,5 s de carte), bouclier et régénération", () => {
    expect(JEU.delaiReapparitionMs).toBe(4000);
    expect(JEU.bouclierMax).toBe(100);
    expect(JEU.regenDelaiMs).toBe(5000);
    expect(JEU.regenPvParS).toBe(20);
    expect(JEU.degainageMs).toBe(350);
    expect(JEU.memoSanteMs).toBe(60_000);
    expect(JEU.etatPassagerHz).toBeLessThan(JEU.etatHz);
    expect(JEU.protectionMs).toBeLessThan(JEU.delaiReapparitionMs);
  });
});

describe("messages v5 (tigres largués à côté des événements)", () => {
  // littéraux typés : la compilation vérifie la forme, le test vérifie qu'ils passent tels quels en JSON
  const passage: PassageAvion = { id: 1, depart: [-300, 10], arrivee: [350, -40], altitude: 120, vitesse: 60, debutT: 1000, finT: 11_850, largageT: 6000 };
  const tigre: TigreLargueSnap = { id: "t1", genre: "sauvage", p: [60, 0, 0], cap: 0.5, etat: "attaque", pose: "course", pv: 2478, action: "ramasse", actionT: 5000 };
  const allie: TigreLargueSnap = { id: "t2", genre: "allie", lanceur: "j1", p: [1, 0, 2], cap: 0, etat: "suivi", pose: "debout", pv: 500 };
  const serveur: MessageServeur[] = [
    { t: "snap", ts: 1, j: [], tigres: [tigre, allie] },
    { t: "avion", evenement: "passage", avion: passage },
    { t: "avion", evenement: "largage", avion: passage, tigre: "t1" },
    { t: "avion", evenement: "etat", avion: null },
    { t: "tigre", evenement: "apparu", id: "t2", genre: "allie", lanceur: "j1", p: [1, 0, 2] },
    { t: "tigre", evenement: "touche", id: "t1", genre: "sauvage", p: [60, 0, 0], par: "j2", degats: 22, pv: 2478, zone: "corps" },
    { t: "tigre", evenement: "mort", id: "t1", genre: "sauvage", p: [60, 0, 0], par: "j2" },
    { t: "sort", evenement: "gagne", joueur: "j2" },
    { t: "sort", evenement: "lance", joueur: "j2", tigre: "t3" },
    { t: "sort", evenement: "perdu", joueur: "j2", raison: "mort" },
    { t: "mort", cible: "j3", par: "j1", arme: "couteau", cause: "tigre", zone: "corps", ts: 1, delai: 4000 },
  ];
  const client: MessageClient = { t: "invoquer" };

  it("chaque message survit à JSON tel quel", () => {
    for (const m of [...serveur, client]) expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  it("les causes de mort des deux côtés coexistent : « tigre » (tigres largués) et « tigre_robot » (tigre géant) sont distinctes", () => {
    const causes: CauseMort[] = ["arme", "ecrase_pnj", "ecrase_vehicule", "tigre", "explosion", "truck_fou", "tigre_robot", "titan"];
    expect(new Set(causes).size).toBe(8);
  });

  it("un snap porte à la fois les tigres largués (`tigres`) et les monstres des événements (`monstres`)", () => {
    const snap: MessageServeur = {
      t: "snap", ts: 1, j: [], tigres: [tigre, allie],
      monstres: { tigre: { p: [80, 0, 0], cap: 0, v: 8, pv: 5500, pvMax: 5500, rage: true }, titan: { pilote: "j4", p: [0, 0, 0], cap: 0, v: 0, pv: 2500, pvMax: 2500 } },
    };
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});
