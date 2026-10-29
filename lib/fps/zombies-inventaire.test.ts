import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { MELEE } from "./armes";
import { COUP_RAPIDE, FACTEUR_EPEE, POIDS_ARME, minutageCoupRapide } from "./coup-rapide";
import {
  armeEcriteDansSlot, armesFeuPortees, couteauTenable, poserDansSlot, slotPourNouvelleArme, slotVoisin, slotsArmesZombies, viderSlot,
} from "./equipement";
import { ControleurArmes } from "./jeu-equipement";
import { Salle, type JoueurSalle, type Sortie } from "./match";
import { EQUIPEMENT_DEPART_ZOMBIES } from "./match-zombies";
import { ARMES, JEU, SILHOUETTE, copierEquipement, decoderZombies, type ArmeFeuId, type Equipement, type MessageServeur, type Vec3 } from "./protocole";
import { DEPARTS, construireMondeZombies } from "./zombies-carte";

/**
 * (v10) Inventaire des zombies façon Black Ops 1 : emplacements d'armes génériques (deux, trois avec le Bento), la nouvelle arme remplace
 * celle en main, l'arme blanche ne se tient plus seule à partir de deux armes, coup de couteau arme en main au minutage du poids de l'arme.
 * Les achats eux-mêmes (murs, boîte, Micro-ondes, Bento) sont testés dans match-zombies.test.ts (bloc « (v10) inventaire »).
 */

const eq = (o: Partial<Equipement>): Equipement => copierEquipement({ principale: "mitraillette", secondaire: "pistolet", speciale: null, ...o });

describe("emplacements génériques (PUR)", () => {
  it("deux emplacements, trois avec le Bento ; armes portées hors Micro-ondes", () => {
    expect(slotsArmesZombies(false)).toEqual(["principale", "secondaire"]);
    expect(slotsArmesZombies(true)).toEqual(["principale", "secondaire", "speciale"]);
    expect(armesFeuPortees(EQUIPEMENT_DEPART_ZOMBIES)).toEqual(["pistolet"]);
    expect(armesFeuPortees(eq({ principale: "pompe", secondaire: "sniper" }))).toEqual(["pompe", "sniper"]);
    expect(armesFeuPortees(eq({ principale: "pompe", secondaire: "sniper", enCuisson: "pompe" }))).toEqual(["sniper"]);
    // l'arme au Micro-ondes reste écrite dans son emplacement (qu'elle réserve)
    expect(armeEcriteDansSlot(eq({ principale: "pompe", enCuisson: "pompe" }), "principale")).toBe("pompe");
  });

  it("l'arme blanche se tient seule avec moins de deux armes à feu", () => {
    expect(couteauTenable(EQUIPEMENT_DEPART_ZOMBIES)).toBe(true);
    expect(couteauTenable(eq({ principale: "pompe", secondaire: "sniper" }))).toBe(false);
    expect(couteauTenable(eq({ principale: "pompe", secondaire: "sniper", enCuisson: "sniper" }))).toBe(true);
    // l'Arme 3 compte aussi
    expect(couteauTenable(eq({ sansPrincipale: true, speciale: "pompe" }))).toBe(false);
  });

  it("nouvelle arme : premier emplacement vide, sinon à la place de l'arme en main, quelle que soit sa catégorie", () => {
    expect(slotPourNouvelleArme(EQUIPEMENT_DEPART_ZOMBIES, "secondaire", false)).toEqual({ slot: "principale", remplacee: null });
    const pleine = eq({ principale: "pompe", secondaire: "pistolet" });
    expect(slotPourNouvelleArme(pleine, "principale", false)).toEqual({ slot: "principale", remplacee: "pompe" });
    expect(slotPourNouvelleArme(pleine, "secondaire", false)).toEqual({ slot: "secondaire", remplacee: "pistolet" });
    // Bento : l'Arme 3 se remplit d'abord
    expect(slotPourNouvelleArme(pleine, "principale", true)).toEqual({ slot: "speciale", remplacee: null });
    expect(slotPourNouvelleArme({ ...pleine, speciale: "sniper" }, "speciale", true)).toEqual({ slot: "speciale", remplacee: "sniper" });
    // sans Bento, une arme encore écrite dans l'Arme 3 n'est jamais remplacée par la règle « en main » (l'emplacement n'existe plus)
    expect(slotPourNouvelleArme({ ...pleine, speciale: "sniper" }, "speciale", false)).toEqual({ slot: "principale", remplacee: "pompe" });
  });

  it("l'emplacement d'une arme au Micro-ondes est réservé : jamais choisi, ni comme vide ni comme arme en main", () => {
    const cuit = eq({ principale: "pompe", secondaire: "pistolet", enCuisson: "pompe" });
    // arme blanche en main (une seule arme portée) : la seule arme portée est remplacée
    expect(slotPourNouvelleArme(cuit, "couteau", false)).toEqual({ slot: "secondaire", remplacee: "pistolet" });
    expect(slotPourNouvelleArme(eq({ principale: "pompe", sansSecondaire: true, enCuisson: "pompe" }), "couteau", false)).toEqual({ slot: "secondaire", remplacee: null });
  });

  it("viderSlot / poserDansSlot : drapeaux « vide » levés et posés", () => {
    const e = eq({});
    viderSlot(e, "principale");
    viderSlot(e, "secondaire");
    expect(armesFeuPortees(e)).toEqual([]);
    poserDansSlot(e, "secondaire", "sniper");
    poserDansSlot(e, "speciale", "pompe");
    expect(e).toEqual({ principale: "mitraillette", secondaire: "sniper", speciale: "pompe", sansPrincipale: true });
  });

  it("molette : un filtre écarte l'arme blanche", () => {
    const e = eq({ principale: "pompe", secondaire: "sniper" });
    expect(slotVoisin(e, "secondaire", 1)).toBe("couteau");
    expect(slotVoisin(e, "secondaire", 1, (s) => s !== "couteau")).toBe("principale");
  });
});

describe("minutage du coup rapide (PUR)", () => {
  it("chaque arme à feu a un poids ; plus l'arme est lourde, plus l'impact et la remise en joue sont tardifs", () => {
    for (const a of ARMES) expect(POIDS_ARME[a], a).toBeDefined();
    const ordre = ["leger", "moyen", "lourd", "tres_lourd"] as const;
    for (let i = 1; i < ordre.length; i++) {
      expect(COUP_RAPIDE[ordre[i]].impactS).toBeGreaterThan(COUP_RAPIDE[ordre[i - 1]].impactS);
      expect(COUP_RAPIDE[ordre[i]].dureeS).toBeGreaterThan(COUP_RAPIDE[ordre[i - 1]].dureeS);
    }
    for (const p of ordre) expect(COUP_RAPIDE[p].impactS).toBeLessThan(COUP_RAPIDE[p].dureeS);
    // le pistolet frappe aussi vite que le couteau seul ; la mitrailleuse plus de deux fois moins vite
    expect(minutageCoupRapide("pistolet", "couteau").dureeS).toBe(MELEE.couteau.cadenceS);
    expect(minutageCoupRapide("mitrailleuse", "couteau").dureeS).toBeGreaterThan(2 * MELEE.couteau.cadenceS);
    expect(minutageCoupRapide("pompe", "couteau").dureeS).toBeGreaterThan(minutageCoupRapide("mitraillette", "couteau").dureeS);
    expect(minutageCoupRapide("sniper", "couteau").dureeS).toBeGreaterThan(minutageCoupRapide("revolver", "couteau").dureeS);
  });

  it("l'épée allonge le coup", () => {
    const c = minutageCoupRapide("pompe", "couteau"), e = minutageCoupRapide("pompe", "epee");
    expect(e.dureeS).toBeCloseTo(c.dureeS * FACTEUR_EPEE, 9);
    expect(e.impactS).toBeCloseTo(c.impactS * FACTEUR_EPEE, 9);
  });
});

describe("ControleurArmes en zombies (v10)", () => {
  const zombies = (e: Equipement, main: "principale" | "secondaire" | "couteau" | "speciale" = "principale") =>
    new ControleurArmes(e, main, { zombies: true, reserveChargeurs: 4 });

  it("deux armes : l'arme blanche ne se prend plus seule (touche, molette, aller-retour) ; une seule : si", () => {
    const c = zombies(eq({ principale: "pompe", secondaire: "sniper" }));
    expect(c.couteauTenable()).toBe(false);
    expect(c.equiper("couteau", 1000)).toBe(false);
    expect(c.molette(1, 1000)).toBe(true);
    expect(c.slotActif()).toBe("secondaire");
    expect(c.molette(1, 2000)).toBe(true);
    expect(c.slotActif()).toBe("principale");
    // le slot demandé à la construction est refusé aussi
    expect(zombies(eq({ principale: "pompe", secondaire: "sniper" }), "couteau").slotActif()).toBe("principale");
    const seul = zombies(EQUIPEMENT_DEPART_ZOMBIES, "secondaire");
    expect(seul.couteauTenable()).toBe(true);
    expect(seul.equiper("couteau", 1000)).toBe(true);
  });

  it("l'arène n'est pas concernée : le couteau se prend toujours", () => {
    const c = new ControleurArmes(eq({ principale: "pompe", secondaire: "pistolet" }));
    expect(c.couteauTenable()).toBe(true);
    expect(c.equiper("couteau", 1000)).toBe(true);
  });

  it("une arme ordinaire dans l'Arme 3 : chargeur et réserve normaux, recharge possible, la molette y passe", () => {
    const c = zombies(eq({ principale: "pompe", secondaire: "pistolet", speciale: "sniper" }), "speciale");
    expect(c.armeEnMain()).toBe("sniper");
    expect(c.reserveEnMain()).toBeGreaterThan(0);
    c.tirEffectue();
    expect(c.demarrerRecharge(1000)).toBe(true);
    expect(c.lignes().map((l) => l.slot)).toEqual(["principale", "secondaire", "couteau", "speciale"]);
  });

  it("une arme à munitions limitées vidée reste en place (Munitions max la remplit) ; dans l'arène elle disparaît", () => {
    const c = zombies(eq({ principale: "pompe", secondaire: "pistolet", speciale: "railgun" }), "speciale");
    const n = c.munitions();
    for (let i = 0; i < n; i++) { expect(c.peutTirer(1000 + i)).toBe(true); c.tirEffectue(); }
    expect(c.armeEnMain()).toBe("railgun");
    expect(c.munitions()).toBe(0);
    c.appliquerServeur({ t: "equipement", equip: c.equipement(), main: "speciale", munSpeciale: 0, ravitaille: "tout" }, 5000);
    expect(c.munitions()).toBe(n);
    const arene = new ControleurArmes(eq({ principale: "pompe", secondaire: "pistolet", speciale: "railgun" }), "speciale");
    arene.appliquerServeur({ t: "equipement", equip: arene.equipement(), main: "speciale", munSpeciale: 1 }, 0);
    arene.tirEffectue();
    expect(arene.equipement().speciale).toBeNull();
  });

  it("coup rapide : refusé arme blanche en main ou pendant le dégainage ; annule la recharge ; ni tir, ni recharge, ni changement avant la fin", () => {
    const c = zombies(eq({ principale: "pompe", secondaire: "pistolet" }));
    c.tirEffectue();
    expect(c.demarrerRecharge(1000)).toBe(true);
    const coup = c.coupRapide(1100)!;
    const { impactS, dureeS } = minutageCoupRapide("pompe", "couteau");
    expect(coup).toEqual({ impactMs: 1100 + impactS * 1000, finMs: 1100 + dureeS * 1000, impactS, dureeS });
    expect(c.rechargeEnCours()).toBe(false);
    const fin = coup.finMs;
    expect(c.coupEnCours(fin - 1)).toBe(true);
    expect(c.peutTirer(fin - 1)).toBe(false);
    expect(c.demarrerRecharge(fin - 1)).toBe(false);
    expect(c.equiper("secondaire", fin - 1)).toBe(false);
    expect(c.coupRapide(fin - 1)).toBeNull();
    expect(c.coupProgression(1100 + (fin - 1100) / 2)).toBeCloseTo(0.5, 6);
    expect(c.peutTirer(fin)).toBe(true);
    expect(c.coupRapide(fin)).not.toBeNull();
    // pendant le dégainage
    expect(c.equiper("secondaire", 10_000)).toBe(true);
    expect(c.coupRapide(10_000 + JEU.degainageMs - 1)).toBeNull();
    expect(c.coupRapide(10_000 + JEU.degainageMs)).not.toBeNull();
    // arme blanche en main (une seule arme)
    const seul = zombies(EQUIPEMENT_DEPART_ZOMBIES, "couteau");
    expect(seul.coupRapide(1000)).toBeNull();
  });

  it("une arme lourde frappe plus tard et se remet en joue plus tard qu'une arme légère", () => {
    const leger = zombies(eq({ principale: "pistolet", sansSecondaire: true })).coupRapide(0)!;
    const lourd = zombies(eq({ principale: "mitrailleuse", sansSecondaire: true })).coupRapide(0)!;
    expect(lourd.impactMs).toBeGreaterThan(leger.impactMs);
    expect(lourd.finMs).toBeGreaterThan(leger.finMs);
  });

  it("une apparition (nouvelle vie) efface le coup en cours", () => {
    const c = zombies(eq({ principale: "pompe", secondaire: "pistolet" }));
    c.coupRapide(1000);
    c.appliquerServeur({ t: "apparition", id: "a", p: [0, 0, 0], lacet: 0, arme: "pistolet", pv: 100, bouclier: 0, equip: c.equipement(), main: "secondaire", munSpeciale: 0 }, 1100);
    expect(c.coupEnCours(1100)).toBe(false);
    expect(c.peutTirer(1100)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// la salle (serveur)

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const T0 = 5_000_000;
function suite(graine = 3): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}
const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
/** Salle des zombies (ou l'arène sur la même carte, `zombies` false), le joueur « a » en jeu à T0. */
function salle(zombies = true): Salle {
  const s = new Salle(construireMondeZombies(scene), DEPARTS.map((d) => [d[0], d[1]] as [number, number]), suite(), T0, zombies ? { zombies: { pauseMs: 1000, degatsGriffe: 0 } } : {});
  s.connecter("a", "Agent a", T0);
  if (zombies) s.recevoir("a", { t: "lancerPartie" }, T0);
  s.recevoir("a", { t: "rejoindre" }, T0);
  return s;
}
/** Regard horizontal vers le nord : œil et direction cohérents avec le lacet du joueur. */
function viser(s: Salle): { o: Vec3; d: Vec3 } {
  const a = j(s, "a");
  a.lacet = 0;
  a.tangage = 0;
  return { o: [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]], d: [0, 0, -1] };
}
/** Coups envoyés toutes les 50 ms pendant `dureeMs` : combien le serveur en accepte (diffusés aux autres). */
function coupsAcceptes(s: Salle, t0: number, dureeMs: number): number {
  let n = 0;
  for (let t = t0; t <= t0 + dureeMs; t += 50) {
    j(s, "a").etatT = t;
    const { o, d } = viser(s);
    n += messages(s.recevoir("a", { t: "coup", o, d, cibles: [] }, t), "coup").length;
  }
  return n;
}

describe("la salle des zombies (v10)", () => {
  it("deux armes : `main{couteau}` refusé ; une arme : accepté", () => {
    const s = salle();
    const a = j(s, "a");
    s.equiper(a, eq({ principale: "pompe", secondaire: "pistolet" }), "principale", T0 + 100);
    s.recevoir("a", { t: "main", slot: "couteau" }, T0 + 1000);
    expect(a.main).toBe("principale");
    s.equiper(a, copierEquipement(EQUIPEMENT_DEPART_ZOMBIES), "secondaire", T0 + 2000);
    s.recevoir("a", { t: "main", slot: "couteau" }, T0 + 3000);
    expect(a).toMatchObject({ main: "couteau", arme: "couteau" });
  });

  it("l'Arme 3 est un emplacement ordinaire : on la prend sans munitions « spéciales » et ses tirs ne la retirent jamais", () => {
    const s = salle();
    const a = j(s, "a");
    s.equiper(a, eq({ principale: "pompe", secondaire: "pistolet", speciale: "mitraillette" }), "principale", T0 + 100);
    expect(a.munSpeciale).toBe(0);
    s.recevoir("a", { t: "main", slot: "speciale" }, T0 + 1000);
    expect(a).toMatchObject({ main: "speciale", arme: "mitraillette" });
    a.etatT = T0 + 2000;
    const { o, d } = viser(s);
    const sorties = s.recevoir("a", { t: "tir", arme: "mitraillette", o, d: [d], touches: [] }, T0 + 2000);
    expect(messages(sorties, "tir")).toHaveLength(1);
    expect(messages(sorties, "equipement")).toEqual([]);
    expect(a.equip.speciale).toBe("mitraillette");
  });

  it("coup arme à feu en main : accepté (l'arme blanche de l'équipement frappe), à la cadence du poids de l'arme", () => {
    const parArme = (arme: ArmeFeuId, melee?: "epee") => {
      const s = salle();
      const a = j(s, "a");
      s.equiper(a, eq({ principale: arme, sansSecondaire: true, ...(melee ? { melee } : {}) }), "principale", T0 + 100);
      const sorties = s.recevoir("a", { t: "coup", ...viser(s), cibles: [] }, T0 + 1000);
      expect(messages(sorties, "coup")[0], arme).toMatchObject({ id: "a", arme: melee ?? "couteau" });
      expect(a.arme).toBe(arme);
      return coupsAcceptes(s, T0 + 1000 + 2000, 6000);
    };
    const pistolet = parArme("pistolet"), pompe = parArme("pompe"), mitrailleuse = parArme("mitrailleuse");
    expect(pistolet).toBeGreaterThan(pompe);
    expect(pompe).toBeGreaterThan(mitrailleuse);
    expect(parArme("pompe", "epee")).toBeLessThan(pompe);
    // bornes : jamais plus d'un coup par 85 % de la durée nominale (+ le crédit d'un demi-intervalle)
    const intervalle = minutageCoupRapide("pompe", "couteau").dureeS * 1000 * 0.85;
    expect(pompe).toBeLessThanOrEqual(Math.floor((6000 + intervalle / 2) / intervalle) + 1);
  });

  it("dans l'arène, un coup arme à feu en main est ignoré (le coup rapide est propre aux zombies)", () => {
    const s = salle(false);
    const a = j(s, "a");
    expect(a.main).not.toBe("couteau");
    a.etatT = T0 + 1000;
    expect(messages(s.recevoir("a", { t: "coup", ...viser(s), cibles: [] }, T0 + 1000), "coup")).toEqual([]);
  });

  it("le coup rapide blesse un tigre comme l'arme blanche seule (dégâts du couteau, revalidés par le serveur)", () => {
    const s = new Salle(construireMondeZombies(scene), DEPARTS.map((d) => [d[0], d[1]] as [number, number]), suite(), T0, { zombies: { pauseMs: 1000, degatsGriffe: 0, total1: 3 } });
    s.connecter("a", "Agent a", T0);
    s.recevoir("a", { t: "lancerPartie" }, T0);
    s.recevoir("a", { t: "rejoindre" }, T0);
    let z: { id: number; x: number; z: number } | undefined;
    for (let t = T0 + 50; t <= T0 + 8000 && !z; t += 50) {
      for (const x of s.joueurs()) if (x.enJeu) x.etatT = t;
      const snap = messages(s.tic(t).filter((x) => x.a === "joueurs"), "snap").filter((m) => m.zombies).at(-1);
      if (snap) z = decoderZombies(snap.zombies!)[0];
    }
    expect(z).toBeDefined();
    const a = j(s, "a");
    s.equiper(a, eq({ principale: "pompe", secondaire: "pistolet" }), "principale", T0 + 8000);
    const t = T0 + 9000;
    a.p = [z!.x + 1.2, 0, z!.z];
    a.etatT = t;
    const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
    const v = [z!.x - o[0], 1.0 - o[1], z!.z - o[2]], l = Math.hypot(v[0], v[1], v[2]);
    const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
    a.lacet = Math.atan2(-d[0], -d[2]);
    a.tangage = Math.asin(d[1]);
    const sorties = s.recevoir("a", { t: "coup", o, d, cibles: [`z${z!.id}`] }, t);
    expect(messages(sorties, "degats")[0]).toMatchObject({ cible: `z${z!.id}`, par: "a", degats: MELEE.couteau.degatsZombie });
  });
});
