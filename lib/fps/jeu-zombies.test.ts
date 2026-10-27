import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aleaGraine } from "../agroparc3d/cachettes";
import type { SceneData } from "../agroparc3d/types";
import { MELEE } from "./armes";
import {
  CAPACITE_ZOMBIES, DISTANCE_AFFICHAGE_M, INVITE_VIDE, MondeZombies, Rugissements, TAMPON_ZOMBIES_MS, animerCetteImage, inviteZombies,
  periodeAnimation, segmentsPortesFermees, tigreAffiche, trouverZombieTouche, trouverZombiesMelee, type EntreeInvite, type ZombieVue,
} from "./jeu-zombies";
import { FORME_TIGRE, pointLocal, toucheTigre } from "./monstres";
import { encoderZombies, type Equipement, type Vec3, type ZombieSnap } from "./protocole";
import { ACHATS, PORTES_PAYANTES, construireMondeZombies } from "./zombies-carte";
import { ZOMBIES, echelleZombie } from "./zombies-vagues";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMondeZombies(scene);

const zs = (id: number, x: number, z: number, o: Partial<ZombieSnap> = {}): ZombieSnap => ({
  id, x, z, cap: 0, type: 0, griffe: false, apparition: false, pvPct: 100, ...o,
});
function monter(...snaps: [number, number, ZombieSnap[]][]) {
  const m = new MondeZombies();
  for (const [ts, r, l] of snaps) m.alimenter(ts, encoderZombies(r, l));
  return m;
}
const vue = (id: number, x: number, z: number, cap = 0, type: 0 | 1 | 2 = 0): ZombieVue => ({
  id, x, z, cap, type, echelle: echelleZombie(type), griffe: false, apparition: false, pvPct: 100, vitesse: 0,
});

describe("MondeZombies : interpolation", () => {
  it("interpole position, cap et vitesse entre deux snaps, apparie par id même si l'ordre change", () => {
    const m = monter([1000, 5, [zs(1, 10, 20, { cap: 0 }), zs(2, 50, 50)]], [1100, 5, [zs(2, 52, 50), zs(1, 14, 20, { cap: 1 })]]);
    expect(m.echantillon(1050)).toBe(2);
    const a = m.parId(1)!, b = m.parId(2)!;
    expect(a.x).toBeCloseTo(12, 5);
    expect(a.z).toBeCloseTo(20, 5);
    expect(a.cap).toBeCloseTo(0.5, 2);
    expect(a.vitesse).toBeCloseTo(40, 3); // 4 m en 0,1 s
    expect(b.x).toBeCloseTo(51, 5);
    expect(b.vitesse).toBeCloseTo(20, 3);
    expect(m.restants()).toBe(5);
    expect(m.vivants()).toBe(2);
  });

  it("le cap passe par le chemin le plus court (±π)", () => {
    const m = monter([0, 1, [zs(1, 0, 0, { cap: 3.1 })]], [100, 1, [zs(1, 0, 1, { cap: -3.1 })]]);
    m.echantillon(50);
    const c = m.parId(1)!.cap;
    expect(Math.abs(Math.abs(c) - Math.PI)).toBeLessThan(0.05);
  });

  it("un tigre apparaît avec le snap le plus proche qui le contient et disparaît de même", () => {
    const m = monter([1000, 2, [zs(1, 10, 10)]], [1100, 2, [zs(1, 11, 10), zs(2, 30, 30, { apparition: true })]], [1200, 1, [zs(2, 31, 30)]]);
    m.echantillon(1030);
    expect(m.parId(2)).toBeNull(); // pas encore apparu
    expect(m.parId(1)).not.toBeNull();
    m.echantillon(1060);
    expect(m.parId(2)).toMatchObject({ x: 30, z: 30, apparition: true });
    m.echantillon(1130);
    expect(m.parId(1)).not.toBeNull(); // encore dans le snap de 1100
    m.echantillon(1160);
    expect(m.parId(1)).toBeNull(); // mort dans le snap de 1200
    expect(m.parId(2)!.vitesse).toBeGreaterThan(0);
  });

  it("avant le plus ancien et après le plus récent, le snap est tenu (pas d'extrapolation)", () => {
    const m = monter([1000, 1, [zs(1, 0, 0)]], [1100, 1, [zs(1, 10, 0)]]);
    m.echantillon(500);
    expect(m.parId(1)!.x).toBe(0);
    m.echantillon(5000);
    expect(m.parId(1)!.x).toBe(10);
    // un seul snap
    const seul = monter([1000, 1, [zs(1, 3, 4)]]);
    expect(seul.echantillon(900)).toBe(1);
    expect(seul.parId(1)).toMatchObject({ x: 3, z: 4, vitesse: 0 });
  });

  it("type, échelle, griffe, apparition et PV viennent du snap le plus proche", () => {
    const m = monter([0, 3, [zs(7, 1, 1, { type: 2, griffe: true, pvPct: 40 })]], [100, 3, [zs(7, 2, 1, { type: 2, griffe: false, pvPct: 30 })]]);
    m.echantillon(10);
    expect(m.parId(7)).toMatchObject({ type: 2, echelle: ZOMBIES.echelleBrute, griffe: true, pvPct: 40 });
    m.echantillon(90);
    expect(m.parId(7)).toMatchObject({ griffe: false, pvPct: 30 });
  });

  it("tableaux préalloués : mêmes objets d'une image à l'autre, aucun tigre en trop", () => {
    const m = monter([0, 2, [zs(1, 0, 0), zs(2, 5, 5)]], [100, 2, [zs(1, 1, 0), zs(2, 6, 5)]]);
    const tableau = m.zombies();
    m.echantillon(30);
    const premier = tableau[0];
    m.echantillon(60);
    expect(m.zombies()).toBe(tableau);
    expect(m.zombies()[0]).toBe(premier);
    expect(m.nombre()).toBe(2);
    expect(tableau.length).toBe(CAPACITE_ZOMBIES);
  });

  it("purge le tampon au-delà de 1,5 s, ignore un snap arrivé dans le désordre, remplace un même horodatage, tolère un snap sans tigres", () => {
    const m = new MondeZombies();
    for (let i = 0; i < 100; i++) m.alimenter(i * 50, encoderZombies(1, [zs(1, i, 0)]));
    // le plus ancien gardé est à ≤ 1,5 s du plus récent : en deçà le snap est tenu
    m.echantillon(0);
    expect(m.parId(1)!.x).toBeGreaterThanOrEqual((99 * 50 - TAMPON_ZOMBIES_MS) / 50 - 1);
    m.alimenter(10, encoderZombies(1, [zs(1, 999, 0)])); // trop vieux
    m.echantillon(99 * 50);
    expect(m.parId(1)!.x).toBe(99);
    m.alimenter(99 * 50, encoderZombies(1, [zs(1, 500, 0)]));
    m.echantillon(99 * 50);
    expect(m.parId(1)!.x).toBe(500);
    m.alimenter(99 * 50 + 50, undefined);
    expect(m.echantillon(99 * 50 + 50)).toBe(0);
    expect(m.restants()).toBe(0);
    m.vider();
    expect(m.echantillon(0)).toBe(0);
  });
});

describe("trouverZombieTouche", () => {
  /** Tigre au milieu de la cour, cap 0 (avant = −z), à l'échelle du type. */
  const T = vue(4, 128, -50, 0);

  it("touche le corps (rayon vers le centre de la poitrine) et la tête (zone « tete », prioritaire)", () => {
    const corps = FORME_TIGRE[1], tete = FORME_TIGRE[0];
    const c = pointLocal([T.x, 0, T.z], T.cap, T.echelle, corps.d, corps.h, corps.a);
    const o: Vec3 = [c[0] + 10, c[1], c[2]];
    const h = trouverZombieTouche(o, [-1, 0, 0], 100, [T], monde);
    expect(h).toMatchObject({ cible: "z4", zone: "corps" });
    expect(h!.distance).toBeGreaterThan(8);
    const ct = pointLocal([T.x, 0, T.z], T.cap, T.echelle, tete.d, tete.h, tete.a);
    const ot: Vec3 = [ct[0] + 6, ct[1], ct[2]];
    expect(trouverZombieTouche(ot, [-1, 0, 0], 100, [T], monde)).toMatchObject({ cible: "z4", zone: "tete" });
  });

  it("rate à côté, derrière le tireur ou au-delà de la limite (premier mur ou joueur touché)", () => {
    const c = pointLocal([T.x, 0, T.z], T.cap, T.echelle, 0, 0.35, 0.17);
    const o: Vec3 = [c[0] + 10, c[1], c[2]];
    expect(trouverZombieTouche(o, [-1, 0, 0], 5, [T], monde)).toBeNull();
    expect(trouverZombieTouche(o, [1, 0, 0], 100, [T], monde)).toBeNull();
    expect(trouverZombieTouche([o[0], o[1], o[2] + 8], [-1, 0, 0], 100, [T], monde)).toBeNull();
    expect(trouverZombieTouche(o, [-1, 0, 0], 100, [], monde)).toBeNull();
  });

  it("le plus proche des tigres l'emporte, n limite la lecture du tableau", () => {
    const proche = vue(1, 120, -50), loin = vue(2, 110, -50);
    const o: Vec3 = [140, 1.0, -50 + 0.17 * proche.echelle];
    const h = trouverZombieTouche(o, [-1, 0, 0], 100, [loin, proche], monde);
    expect(h?.cible).toBe("z1");
    expect(trouverZombieTouche(o, [-1, 0, 0], 100, [loin, proche], monde, 1)?.cible).toBe("z2");
  });

  it("une brute (échelle 3,4) se touche plus loin du centre qu'un rôdeur", () => {
    const rodeur = vue(1, 128, -50, 0, 0), brute = vue(2, 128, -50, 0, 2);
    // rayon à 1,6 m au-dessus du sol : dans la silhouette de la brute seulement ?
    const o: Vec3 = [140, 1.55, -50 + 0.17 * 3.4];
    expect(trouverZombieTouche(o, [-1, 0, 0], 100, [brute], monde)).not.toBeNull();
    expect(trouverZombieTouche(o, [-1, 0, 0], 100, [rodeur], monde)).toBeNull();
  });

  it("un bâtiment fermé entre le tireur et le tigre arrête la balle", () => {
    // un mur de bâtiment coupe la ligne z = −55 vers x = 160 ; le tigre est dans la cour, de ce côté-ci
    const tigre = vue(1, 140, -55, 0);
    expect(trouverZombieTouche([170, 1.2, -55], [-1, 0, 0], 100, [tigre], monde)).toBeNull();
    expect(trouverZombieTouche([125, 1.2, -55], [1, 0, 0], 100, [tigre], monde)).not.toBeNull();
  });

  it("le pré-filtre ne perd aucun tir : même résultat que toucheTigre sur 2 000 rayons au hasard", () => {
    const alea = aleaGraine(7);
    const liste = [vue(1, 128, -50, 0.4), vue(2, 133, -46, 2.2, 1), vue(3, 123, -53, -1.1, 2)];
    let touches = 0;
    for (let i = 0; i < 2000; i++) {
      const o: Vec3 = [128 + (alea() - 0.5) * 24, 0.2 + alea() * 3, -50 + (alea() - 0.5) * 24];
      const a = alea() * Math.PI * 2, e = (alea() - 0.5) * 0.9;
      const d: Vec3 = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
      let ref: { cible: string; distance: number } | null = null;
      for (const z of liste) {
        const h = toucheTigre(o, d, ref ? ref.distance : 60, [z.x, 0, z.z], z.cap, z.echelle, monde, 0.25);
        if (h && (!ref || h.distance < ref.distance)) ref = { cible: `z${z.id}`, distance: h.distance };
      }
      const r = trouverZombieTouche(o, d, 60, liste, monde);
      expect(r?.cible ?? null).toBe(ref?.cible ?? null);
      if (r && ref) { expect(r.distance).toBeCloseTo(ref.distance, 6); touches++; }
    }
    expect(touches).toBeGreaterThan(30);
  });
});

describe("trouverZombiesMelee", () => {
  const o: Vec3 = [128, 1.5, -50];
  const devant: Vec3 = [0, 0, -1];

  it("frappe les tigres à portée de surface, dans l'arc, triés par distance (au-delà de nbCiblesMax : coupe chez l'appelant)", () => {
    // tigre de profil dont la poitrine est à ≈ 1,5 m devant
    const proche = vue(1, 128, -50 - 1.0, Math.PI / 2);
    const un_peu_plus = vue(2, 128 + 0.6, -50 - 2.0, Math.PI / 2);
    const loin = vue(3, 128, -50 - 12);
    const derriere = vue(4, 128, -50 + 2, Math.PI / 2);
    const res = trouverZombiesMelee(o, devant, [loin, un_peu_plus, proche, derriere], "epee", monde);
    expect(res.map((r) => r.cible)).toEqual(expect.arrayContaining(["z1"]));
    expect(res.map((r) => r.cible)).not.toContain("z3");
    expect(res.map((r) => r.cible)).not.toContain("z4");
    for (let i = 1; i < res.length; i++) expect(res[i].distance).toBeGreaterThanOrEqual(res[i - 1].distance);
    for (const r of res) expect(r.distance).toBeLessThanOrEqual(MELEE.epee.portee);
  });

  it("le couteau a un cône plus étroit et une portée plus courte que l'épée", () => {
    const decale = vue(1, 128 + 2.4, -50 - 0.8, 0);
    const epee = trouverZombiesMelee(o, devant, [decale], "epee", monde);
    const couteau = trouverZombiesMelee(o, devant, [decale], "couteau", monde);
    expect(epee.length).toBeGreaterThanOrEqual(couteau.length);
    const limite = vue(2, 128, -50 - 2.5 - 1.5, Math.PI / 2);
    expect(trouverZombiesMelee(o, devant, [limite], "couteau", monde)).toEqual([]);
  });

  it("un mur entre le joueur et le tigre arrête le coup", () => {
    // la face ouest du bâtiment 70 est à x ≈ 147 sur la ligne z = −55 : un tigre de 2,4 m de surface, mais derrière
    const derriereMur = vue(1, 148.2, -55, Math.PI / 2);
    const o: Vec3 = [145, 1.5, -55];
    expect(trouverZombiesMelee(o, [1, 0, 0], [derriereMur], "epee", null).map((r) => r.cible)).toEqual(["z1"]);
    expect(trouverZombiesMelee(o, [1, 0, 0], [derriereMur], "epee", monde)).toEqual([]);
  });
});

describe("affichage", () => {
  it("la pose est recalculée chaque image à moins de 40 m, une sur deux jusqu'à 80 m, une sur quatre au-delà", () => {
    expect([periodeAnimation(10), periodeAnimation(39.9), periodeAnimation(40), periodeAnimation(79), periodeAnimation(80), periodeAnimation(200)]).toEqual([1, 1, 2, 2, 4, 4]);
    for (let i = 0; i < 8; i++) expect(animerCetteImage(10, i, 3)).toBe(true);
    let sur2 = 0, sur4 = 0;
    for (let i = 0; i < 8; i++) { if (animerCetteImage(60, i, 3)) sur2++; if (animerCetteImage(120, i, 3)) sur4++; }
    expect(sur2).toBe(4);
    expect(sur4).toBe(2);
    // phases décalées par id : deux tigres ne sont pas mis à jour aux mêmes images
    expect(animerCetteImage(120, 0, 0)).not.toBe(animerCetteImage(120, 0, 1));
  });

  it("culling : au-delà de 140 m ou derrière la caméra, le tigre n'est pas dessiné", () => {
    const cam: Vec3 = [0, 1.7, 0];
    expect(tigreAffiche(cam, 0, -1, 0, -50)).toBe(true);
    expect(tigreAffiche(cam, 0, -1, 0, -(DISTANCE_AFFICHAGE_M + 1))).toBe(false);
    expect(tigreAffiche(cam, 0, -1, 0, 50)).toBe(false);
    expect(tigreAffiche(cam, 0, -1, 0, 2)).toBe(true); // collé derrière : sa longueur déborde encore
    expect(tigreAffiche(cam, 1, 0, 30, 20)).toBe(true);
  });

  it("rugissements : espacés de 0,5 à 4 s, seulement par un tigre à moins de 60 m, jamais sans tigre proche", () => {
    const r = new Rugissements();
    const proche = [vue(5, 10, 0), vue(6, 200, 0)];
    const cam: Vec3 = [0, 1.7, 0];
    let t = 0;
    const evts: { t: number; id: number }[] = [];
    const alea = aleaGraine(3);
    for (let i = 0; i < 60 * 40; i++) {
      t += 1 / 60;
      const id = r.maj(1 / 60, proche, 2, cam, alea);
      if (id !== null) evts.push({ t, id });
    }
    expect(evts.length).toBeGreaterThan(5);
    expect(evts.every((e) => e.id === 5)).toBe(true);
    for (let i = 1; i < evts.length; i++) expect(evts[i].t - evts[i - 1].t).toBeGreaterThan(0.45);
    const seul = new Rugissements();
    for (let i = 0; i < 600; i++) expect(seul.maj(1 / 60, [vue(6, 200, 0)], 1, cam, alea)).toBeNull();
  });
});

describe("inviteZombies", () => {
  const equipDepart: Equipement = { principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true };
  const entree = (pos: [number, number], o: Partial<EntreeInvite> = {}): EntreeInvite => ({
    pos, argent: 500, portesOuvertes: [], equip: equipDepart, pv: 100, aTerre: [], ...o,
  });
  const achat = (id: string) => ACHATS.find((a) => a.id === id)!;

  it("rien à portée : invite vide", () => {
    expect(inviteZombies(entree([116.3, -83.9]))).toBe(INVITE_VIDE);
    expect(INVITE_VIDE.invite).toBe("");
  });

  it("mur d'arme : nom et prix ; argent suffisant ou non", () => {
    const [x, z] = achat("mur:revolver").position;
    const a = inviteZombies(entree([x, z], { argent: 500 }));
    expect(a).toMatchObject({ invite: "acheter", id: "mur:revolver", prix: 650, assez: false, cible: null });
    expect(a.detail).toMatch(/^Revolver — 650\s\$$/);
    expect(inviteZombies(entree([x, z], { argent: 650 })).assez).toBe(true);
  });

  it("arme déjà possédée : recharge de munitions à moitié prix", () => {
    const [x, z] = achat("mur:pistolet").position;
    const r = inviteZombies(entree([x, z]));
    expect(r).toMatchObject({ invite: "acheter", id: "mur:pistolet", prix: 125, assez: true });
    expect(r.detail).toMatch(/^Munitions Pistolet — 125\s\$$/);
    // une principale possédée aussi
    const [mx, mz] = achat("mur:mitraillette").position;
    const avec: Equipement = { principale: "mitraillette", secondaire: "pistolet", speciale: null };
    expect(inviteZombies(entree([mx, mz], { equip: avec, portesOuvertes: ["P3", "P4"] })).prix).toBe(500);
    // sansPrincipale : la mitraillette n'est pas possédée, plein tarif
    expect(inviteZombies(entree([mx, mz], { portesOuvertes: ["P3", "P4"] })).prix).toBe(1000);
  });

  it("épée : en vente tant qu'on ne l'a pas, plus d'invite ensuite", () => {
    const [x, z] = achat("mur:epee").position;
    expect(inviteZombies(entree([x, z]))).toMatchObject({ invite: "acheter", id: "mur:epee", prix: 500 });
    expect(inviteZombies(entree([x, z], { equip: { ...equipDepart, melee: "epee" } }))).toBe(INVITE_VIDE);
  });

  it("boîte mystère et soin (inutile à pleine santé, bloqué pendant l'attente)", () => {
    const [bx, bz] = achat("boite").position;
    expect(inviteZombies(entree([bx, bz], { argent: 2000 }))).toMatchObject({ invite: "boite", id: "boite", prix: 950, assez: true });
    const [sx, sz] = achat("soin").position;
    expect(inviteZombies(entree([sx, sz], { pv: 100 }))).toBe(INVITE_VIDE);
    expect(inviteZombies(entree([sx, sz], { pv: 40 }))).toMatchObject({ invite: "soin", id: "soin", prix: 400, assez: true });
    const attente = inviteZombies(entree([sx, sz], { pv: 40, soinDans: 12.2 }));
    expect(attente).toMatchObject({ invite: "soin", assez: false });
    expect(attente.detail).toContain("13 s");
  });

  it("porte : à 3 m de son segment, verrouillée sans le prérequis, plus d'invite une fois ouverte", () => {
    const p1 = PORTES_PAYANTES.find((p) => p.id === "P1")!;
    const r = inviteZombies(entree([p1.point[0] - 1.2, p1.point[1] + 0.6], { argent: 800 }));
    expect(r).toMatchObject({ invite: "porte", id: "P1", prix: 750, assez: true });
    expect(r.detail).toMatch(/^Ouvrir la porte — 750\s\$$/);
    expect(inviteZombies(entree([p1.point[0] - 1.2, p1.point[1] + 0.6], { portesOuvertes: ["P1"] })).id).not.toBe("P1");
    const p2 = PORTES_PAYANTES.find((p) => p.id === "P2")!;
    const ferme = inviteZombies(entree([p2.point[0], p2.point[1]], { argent: 5000 }));
    expect(ferme).toMatchObject({ invite: "porte", id: "P2", prix: 1250 });
    expect(ferme.detail).toMatch(/verrouillée/i);
    expect(inviteZombies(entree([p2.point[0], p2.point[1]], { argent: 5000, portesOuvertes: ["P1"] })).detail).toMatch(/^Ouvrir la porte/);
  });

  it("un coéquipier à terre à moins de 2,5 m passe avant les achats", () => {
    const [x, z] = achat("mur:pistolet").position;
    const copain = { id: "j2", pseudo: "Léa", p: [x + 2, 0, z] as Vec3 };
    const r = inviteZombies(entree([x, z], { aTerre: [copain] }));
    expect(r).toMatchObject({ invite: "reanimer", cible: "j2", id: "", prix: 0, assez: true, detail: "Réanimer Léa" });
    expect(inviteZombies(entree([x, z], { aTerre: [{ ...copain, p: [x + 2.6, 0, z] }] })).invite).toBe("acheter");
    // le plus proche des coéquipiers à terre
    const autre = { id: "j3", pseudo: "Max", p: [x + 1, 0, z] as Vec3 };
    expect(inviteZombies(entree([x, z], { aTerre: [copain, autre] })).cible).toBe("j3");
  });
});

describe("portes fermées de la grande carte", () => {
  it("une porte ouverte disparaît ; chaque segment est celui de sa première pièce", () => {
    expect(segmentsPortesFermees([]).map((s) => s.id).sort()).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    const sans = segmentsPortesFermees(new Set(["P1", "P3"]));
    expect(sans.map((s) => s.id).sort()).toEqual(["P2", "P4", "P5"]);
    for (const s of sans) {
      expect(Math.hypot(s.q[0] - s.p[0], s.q[1] - s.p[1])).toBeGreaterThan(2);
    }
  });
});
