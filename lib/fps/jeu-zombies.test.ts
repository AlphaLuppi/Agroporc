import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aleaGraine } from "../agroparc3d/cachettes";
import type { SceneData } from "../agroparc3d/types";
import { MELEE } from "./armes";
import {
  CAPACITE_ZOMBIES, DISTANCE_AFFICHAGE_M, INVITE_VIDE, MondeZombies, effetsMortZombie, Rugissements, TAMPON_ZOMBIES_MS, animerCetteImage, decisionMaintien, inviteZombies, objetSecretProche,
  periodeAnimation, segmentsPortesFermees, sonGriffe, tigreAffiche, trouverZombieTouche, trouverZombiesMelee, type EntreeInvite, type PartieInvite, type ZombieVue,
} from "./jeu-zombies";
import { FORME_TIGRE, pointLocal, toucheTigre } from "./monstres";
import { encoderZombies, type Equipement, type Vec3, type ZombieSnap } from "./protocole";
import { creerSimuZombies } from "./zombies";
import { ACHATS, FENETRES, INTERACTIONS_SECRET, PORTES_PAYANTES, construireMondeZombies } from "./zombies-carte";
import { ZOMBIES, echelleZombie, pvZombie } from "./zombies-vagues";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMondeZombies(scene);

const zs = (id: number, x: number, z: number, o: Partial<ZombieSnap> = {}): ZombieSnap => ({
  id, x, z, cap: 0, type: 0, griffe: false, apparition: false, pvPct: 100, allure: 0, mode: "chasse", ...o,
});
function monter(...snaps: [number, number, ZombieSnap[]][]) {
  const m = new MondeZombies();
  for (const [ts, r, l] of snaps) m.alimenter(ts, encoderZombies(r, l));
  return m;
}
const vue = (id: number, x: number, z: number, cap = 0, type: 0 | 1 | 2 | 3 | 4 = 0): ZombieVue => ({
  id, x, z, cap, type, echelle: echelleZombie(type), griffe: false, apparition: false, pvPct: 100, vitesse: 0, allure: 0, mode: "chasse",
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
    m.alimenter(99 * 50 - 100, encoderZombies(1, [zs(1, 999, 0)])); // retardataire
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

  it("une horloge serveur repartie de zéro (redéploiement) vide le tampon au lieu de figer les tigres", () => {
    const m = new MondeZombies();
    for (let i = 0; i < 20; i++) m.alimenter(100_000 + i * 50, encoderZombies(1, [zs(1, i, 0)]));
    // quelques secondes plus tard, l'horloge repart de 0 : les nouveaux snaps sont suivis
    m.alimenter(200, encoderZombies(1, [zs(7, 40, 0)]));
    m.alimenter(250, encoderZombies(1, [zs(7, 41, 0)]));
    expect(m.echantillon(225)).toBe(1);
    expect(m.parId(7)!.x).toBeCloseTo(40.5, 5);
    expect(m.parId(1)).toBeNull();
    // un simple retardataire de quelques dizaines de ms reste ignoré
    m.alimenter(240, encoderZombies(1, [zs(7, 999, 0)]));
    m.echantillon(250);
    expect(m.parId(7)!.x).toBe(41);
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

  it("(v8) un mini Truck se touche sur SA forme : la cabine (tête) devant, rien au-dessus du toit (1 m), le corps du tigre ne compte pas", () => {
    const M = vue(9, 128, -50, 0, 4);
    expect(M.echelle).toBe(3);
    // cabine : à 0,45 m, de face (l'avant est −z)
    expect(trouverZombieTouche([128, 0.45, -60], [0, 0, 1], 100, [M], monde)).toMatchObject({ cible: "z9", zone: "tete" });
    // de côté, au milieu de la caisse
    expect(trouverZombieTouche([140, 0.55, -50 + 0.3], [-1, 0, 0], 100, [M], monde)).toMatchObject({ cible: "z9", zone: "corps" });
    // à 1,4 m : dans la silhouette d'un tigre de cette échelle, au-dessus du toit du mini Truck
    expect(trouverZombieTouche([140, 1.4, -50 + 0.17 * 3], [-1, 0, 0], 100, [M], monde)).toBeNull();
    // mêlée : même forme
    expect(trouverZombiesMelee([128, 1.2, -51.6], [0, -0.5, 0.87], [M], "couteau", monde).map((x) => x.cible)).toEqual(["z9"]);
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
    // un mur de bâtiment coupe la ligne z = −55 vers x = 160 ; le tigre est dans la cour, de ce côté-ci (tir parti à l'est de l'olivier, en 125,5 ; −54,5)
    const tigre = vue(1, 140, -55, 0);
    expect(trouverZombieTouche([170, 1.2, -55], [-1, 0, 0], 100, [tigre], monde)).toBeNull();
    expect(trouverZombieTouche([130, 1.2, -55], [1, 0, 0], 100, [tigre], monde)).not.toBeNull();
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
    expect(inviteZombies(entree([128, -55]))).toBe(INVITE_VIDE);
    expect(INVITE_VIDE.invite).toBe("");
  });

  it("mur d'arme : nom et prix ; argent suffisant ou non", () => {
    const [x, z] = achat("mur:revolver").position;
    const a = inviteZombies(entree([x, z], { argent: 400 }));
    expect(a).toMatchObject({ invite: "acheter", id: "mur:revolver", prix: 500, assez: false, cible: null });
    expect(a.detail).toMatch(/^Revolver — 500\s\$$/);
    expect(inviteZombies(entree([x, z], { argent: 500 })).assez).toBe(true);
  });

  it("arme déjà possédée : munitions à moitié prix, 2 500 $ si elle est gratinée ; sansPrincipale : plein tarif", () => {
    const [x, z] = achat("mur:revolver").position;
    const rev: Equipement = { ...equipDepart, secondaire: "revolver" };
    const r = inviteZombies(entree([x, z], { equip: rev }));
    expect(r).toMatchObject({ invite: "acheter", id: "mur:revolver", prix: 250, assez: true });
    expect(r.detail).toMatch(/^Munitions Revolver — 250\s\$$/);
    const gratine = inviteZombies(entree([x, z], { equip: { ...rev, ameliorees: ["revolver"] }, argent: 3000 }));
    expect(gratine).toMatchObject({ prix: 2500, assez: true });
    expect(gratine.detail).toContain("Cobra flambé");
    const [mx, mz] = achat("mur:mitraillette").position;
    const avec: Equipement = { principale: "mitraillette", secondaire: "pistolet", speciale: null };
    expect(inviteZombies(entree([mx, mz], { equip: avec })).prix).toBe(600);
    expect(inviteZombies(entree([mx, mz])).prix).toBe(1200);
  });

  it("épée : en vente tant qu'on ne l'a pas, plus d'invite ensuite", () => {
    const [x, z] = achat("mur:epee").position;
    expect(inviteZombies(entree([x, z]))).toMatchObject({ invite: "acheter", id: "mur:epee", prix: 3000, assez: false });
    expect(inviteZombies(entree([x, z], { equip: { ...equipDepart, melee: "epee" } }))).toBe(INVITE_VIDE);
  });

  const partieInvite = (o: Partial<PartieInvite> = {}): PartieInvite => ({
    courant: false, boite: { emplacement: 0, etat: "fermee", finT: 0, utilisations: 0 }, pap: { etat: "libre" },
    effets: { instakillFinT: 0, doubleFinT: 0, soldesFinT: 0 },
    fenetres: FENETRES.map(() => 6), portes: PORTES_PAYANTES.map((p) => ({ id: p.id, ouverte: false })), ...o,
  });

  it("boîte mystère : seulement à son emplacement, 10 $ en Happy hour, « Prendre » pour celui qui a payé, occupée sinon", () => {
    const b1 = achat("boite:B1"), b2 = achat("boite:B2");
    const ici = (o: Partial<EntreeInvite>) => inviteZombies(entree([b1.position[0], b1.position[1]], { argent: 2000, moi: "a", ...o }));
    expect(ici({ partie: partieInvite() })).toMatchObject({ invite: "boite", id: "boite:B1", prix: 950, assez: true });
    expect(inviteZombies(entree([b2.position[0], b2.position[1]], { partie: partieInvite() })).invite).not.toBe("boite");
    expect(ici({ partie: partieInvite({ effets: { instakillFinT: 0, doubleFinT: 0, soldesFinT: 5000 } }), maintenant: 1000 }).prix).toBe(10);
    const offre = partieInvite({ boite: { emplacement: 0, etat: "offre", finT: 9000, utilisations: 1, arme: "pompe", pour: "a" } });
    expect(ici({ partie: offre })).toMatchObject({ invite: "boite", prix: 0, assez: true, detail: "Prendre : Fusil à pompe" });
    expect(ici({ partie: offre, moi: "b" })).toMatchObject({ assez: false, bloque: "Occupée" });
    // (v8) ma mitraillette cuit au Micro-ondes : la pompe offerte (même slot) ne peut pas être prise avant de la reprendre
    const auFour = { ...offre, pap: { etat: "cuisson" as const, joueur: "a", arme: "mitraillette" as const, debutT: 0, finT: 9000 } };
    expect(ici({ partie: auFour })).toMatchObject({ invite: "boite", assez: false, bloque: "Reprenez l'arme au Micro-ondes" });
    // une arme d'un autre slot au Micro-ondes ne bloque rien
    expect(ici({ partie: { ...auFour, pap: { ...auFour.pap, arme: "pistolet" as const } } }).bloque).toBeUndefined();
  });

  it("(v8) Happy hour : la boîte temporaire d'un autre emplacement s'achète à 10 $, prise ou occupée comme la principale", () => {
    const b2 = achat("boite:B2");
    const la = (o: Partial<EntreeInvite>) => inviteZombies(entree([b2.position[0], b2.position[1]], { argent: 50, moi: "a", maintenant: 1000, ...o }));
    const soldes = { instakillFinT: 0, doubleFinT: 0, soldesFinT: 5000 };
    const temporaire = { emplacement: 1, etat: "fermee" as const, finT: 0, utilisations: 0 };
    expect(la({ partie: partieInvite({ effets: soldes, boitesSoldes: [temporaire] }) })).toMatchObject({ invite: "boite", id: "boite:B2", prix: 10, assez: true });
    const occupee = { ...temporaire, etat: "tirage" as const, arme: "pompe" as const, pour: "b", finT: 3000 };
    expect(la({ partie: partieInvite({ effets: soldes, boitesSoldes: [occupee] }) })).toMatchObject({ invite: "boite", bloque: "Occupée" });
    // Happy hour fini, la temporaire ne s'est pas encore refermée : 950 $ (elle disparaîtra une fois refermée)
    expect(la({ partie: partieInvite({ boitesSoldes: [temporaire] }), argent: 2000 })).toMatchObject({ prix: 950 });
  });

  it("atouts : Pause Café à 500 $ seul ; les autres « Courant coupé » sans courant ; aucune invite pour un atout déjà pris", () => {
    const pc = achat("atout:pausecafe"), gr = achat("atout:gratin");
    expect(inviteZombies(entree([pc.position[0], pc.position[1]], { solo: true, partie: partieInvite() }))).toMatchObject({ invite: "atout", prix: 500, assez: true });
    expect(inviteZombies(entree([pc.position[0], pc.position[1]], { solo: false, argent: 2000, partie: partieInvite() }))).toMatchObject({ prix: 1500 });
    expect(inviteZombies(entree([pc.position[0], pc.position[1]], { atouts: ["pausecafe"], partie: partieInvite() })).invite).not.toBe("atout");
    expect(inviteZombies(entree([gr.position[0], gr.position[1]], { argent: 3000, partie: partieInvite() }))).toMatchObject({ invite: "atout", assez: false, bloque: "Courant coupé" });
    expect(inviteZombies(entree([gr.position[0], gr.position[1]], { argent: 3000, partie: partieInvite({ courant: true }) }))).toMatchObject({ assez: true, prix: 2500 });
  });

  it("Pack-a-Punch : courant, arme à feu en main, pas déjà gratinée ; courant ; quête", () => {
    const pap = achat("pap");
    const ici = (o: Partial<EntreeInvite>) => inviteZombies(entree([pap.position[0], pap.position[1]], { argent: 6000, enMain: "pistolet", ...o }));
    expect(ici({ partie: partieInvite() })).toMatchObject({ invite: "pap", bloque: "Courant coupé", assez: false });
    const ok = ici({ partie: partieInvite({ courant: true }) });
    expect(ok).toMatchObject({ invite: "pap", assez: true, prix: 5000 });
    expect(ok.detail).toMatch(/^Gratiner : Pistolet — 5\s000\s\$$/);
    expect(ici({ partie: partieInvite({ courant: true }), enMain: "couteau" }).bloque).toBe("Prenez une arme à feu");
    expect(ici({ partie: partieInvite({ courant: true }), equip: { ...equipDepart, ameliorees: ["pistolet"] } }).bloque).toBe("Déjà gratinée");
    // (v8) l'arme cuite attend : « Reprendre » (gratuit, couteau en main) pour celui qui l'a déposée, « Occupé » pour les autres
    const pret = partieInvite({ courant: true, pap: { etat: "pret", joueur: "a", arme: "pistolet", finT: 9000 } });
    const reprise = ici({ partie: pret, moi: "a", enMain: "couteau", argent: 0 });
    expect(reprise).toMatchObject({ invite: "pap", prix: 0, assez: true });
    expect(reprise.detail).toMatch(/^Reprendre : /);
    expect(ici({ partie: pret, moi: "b" })).toMatchObject({ invite: "pap", bloque: "Occupé", assez: false });
    expect(ici({ partie: partieInvite({ courant: true, pap: { etat: "cuisson", joueur: "a", arme: "pistolet", finT: 9000 } }), moi: "a" }).bloque).toBe("En cuisson");
    const co = achat("courant");
    expect(inviteZombies(entree([co.position[0], co.position[1]], { partie: partieInvite() }))).toMatchObject({ invite: "courant", assez: true });
    expect(inviteZombies(entree([co.position[0], co.position[1]], { partie: partieInvite({ courant: true }) })).invite).not.toBe("courant");
  });

  it("(v8) grand secret : aucune invite devant ses objets ; E sans invite près de l'un d'eux part en `secret:<objet>`, quel que soit l'état", () => {
    for (const it of INTERACTIONS_SECRET) {
      const inv = inviteZombies(entree([it.position[0], it.position[1]], { partie: partieInvite({ courant: true }) }));
      expect(["", "note"], it.id).toContain(inv.invite);
      expect(inv.detail).not.toMatch(/truffe|four|cloche|recette|ingrédient/i);
      expect(objetSecretProche(it.position)).toBe(`secret:${it.id}`);
    }
    expect(objetSecretProche([0, 0])).toBeNull();
    const [x, z] = INTERACTIONS_SECRET[0].position;
    expect(objetSecretProche([x + INTERACTIONS_SECRET[0].portee + 0.3, z])).toBeNull();
  });

  it("fenêtre à reposer : à 2,2 m de son côté intérieur, planches comptées", () => {
    const f = FENETRES[0];
    const fen = FENETRES.map((_, i) => (i === 0 ? 3 : 6));
    const r = inviteZombies(entree([f.dedans[0], f.dedans[1]], { partie: partieInvite({ fenetres: fen }) }));
    expect(r).toMatchObject({ invite: "reparer", id: f.id, prix: 0, assez: true });
    expect(r.detail).toContain("3 / 6");
  });

  it("porte : à 3 m de son segment, verrouillée sans zone ouverte d'un côté, plus d'invite une fois ouverte", () => {
    const d1 = PORTES_PAYANTES.find((p) => p.id === "D1")!;
    const r = inviteZombies(entree([d1.point[0] - 1.2, d1.point[1]], { argent: 800 }));
    expect(r).toMatchObject({ invite: "porte", id: "D1", prix: 750, assez: true });
    expect(r.detail).toMatch(/^Ouvrir : Porte de la salle de pause — 750\s\$$/);
    expect(inviteZombies(entree([d1.point[0] - 1.2, d1.point[1]], { portesOuvertes: ["D1"] })).id).not.toBe("D1");
    const g3 = PORTES_PAYANTES.find((p) => p.id === "G3")!;
    const ferme = inviteZombies(entree([g3.point[0], g3.point[1]], { argent: 5000 }));
    expect(ferme).toMatchObject({ invite: "porte", id: "G3", assez: false, bloque: "Verrouillée" });
    expect(inviteZombies(entree([g3.point[0], g3.point[1]], { argent: 5000, portesOuvertes: ["D2"] })).assez).toBe(true);
  });

  it("un coéquipier à terre à moins de 2,5 m passe avant les achats", () => {
    const [x, z] = achat("mur:revolver").position;
    const copain = { id: "j2", pseudo: "Léa", p: [x + 2, 0, z] as Vec3 };
    const r = inviteZombies(entree([x, z], { aTerre: [copain] }));
    expect(r).toMatchObject({ invite: "reanimer", cible: "j2", id: "", prix: 0, assez: true, detail: "Réanimer Léa" });
    expect(inviteZombies(entree([x, z], { aTerre: [{ ...copain, p: [x + 2.6, 0, z] }] })).invite).toBe("acheter");
    const autre = { id: "j3", pseudo: "Max", p: [x + 1, 0, z] as Vec3 };
    expect(inviteZombies(entree([x, z], { aTerre: [copain, autre] })).cible).toBe("j3");
  });
});

describe("portes fermées de la grande carte", () => {
  it("une porte ouverte disparaît ; chaque segment est celui de sa première pièce", () => {
    expect(segmentsPortesFermees([]).map((s) => s.id).sort()).toEqual(PORTES_PAYANTES.map((p) => p.id).sort());
    const sans = segmentsPortesFermees(new Set(["D1", "D2"]));
    expect(sans.map((s) => s.id)).not.toContain("D1");
    expect(sans).toHaveLength(PORTES_PAYANTES.length - 2);
    for (const s of sans) expect(Math.hypot(s.q[0] - s.p[0], s.q[1] - s.p[1])).toBeGreaterThan(1.5);
  });
});

describe("parité client / serveur", () => {
  /** Un tigre posé par la simulation serveur, passé par le snap compact puis l'interpolation du client. */
  function tigresDuServeur() {
    const simu = creerSimuZombies({ monde, alea: aleaGraine(3) });
    const pts: [number, number, number][] = [[128, -50, 0.4], [133, -46, 2.2], [123, -53, -1.1]];
    pts.forEach(([x, z, cap], i) => {
      const type = (i % 3) as 0 | 1 | 2;
      simu.apparaitre({ type, manche: 4, pv: pvZombie(4, type), allure: 1, vitesse: 6, degats: 50, rechargeGriffeS: 1 }, [x, z], { mode: "chasse" }, 0, cap);
    });
    const mz = new MondeZombies();
    mz.alimenter(1000, simu.snap(3, 1000));
    mz.echantillon(1000);
    return { simu, mz };
  }

  it("le snap compact redonne la position à 1 cm et le cap à 1 mrad : les tigres du client sont ceux du serveur", () => {
    const { simu, mz } = tigresDuServeur();
    expect(mz.nombre()).toBe(3);
    for (const v of mz.zombies().slice(0, 3)) {
      const z = simu.zombie(v.id)!;
      expect(Math.abs(v.x - z.p[0])).toBeLessThan(0.011);
      expect(Math.abs(v.z - z.p[2])).toBeLessThan(0.011);
      expect(Math.abs(Math.atan2(Math.sin(v.cap - z.cap), Math.cos(v.cap - z.cap)))).toBeLessThan(0.0011);
      expect(v.type).toBe(z.type);
      expect(v.echelle).toBe(z.echelle);
    }
  });

  it("tout tir que le client déclare touché est validé par le serveur (même zone), sur 3 000 rayons", () => {
    const { simu, mz } = tigresDuServeur();
    const alea = aleaGraine(11);
    let declares = 0;
    for (let i = 0; i < 3000; i++) {
      const o: Vec3 = [128 + (alea() - 0.5) * 24, 0.2 + alea() * 3, -50 + (alea() - 0.5) * 24];
      const a = alea() * Math.PI * 2, e = (alea() - 0.5) * 0.9;
      const d: Vec3 = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
      const c = trouverZombieTouche(o, d, 60, mz.zombies(), monde, mz.nombre());
      if (!c) continue;
      declares++;
      const s = simu.toucheZombie(Number(c.cible.slice(1)), o, d, 60, 1000);
      expect(s, `rayon ${i}`).not.toBeNull();
      expect(s!.zone).toBe(c.zone);
    }
    expect(declares).toBeGreaterThan(30);
  });

  it("tout coup que le client déclare porté est validé par le serveur (portée de l'arme + marge)", () => {
    const { simu, mz } = tigresDuServeur();
    const alea = aleaGraine(5);
    let declares = 0;
    for (const arme of ["couteau", "epee"] as const) {
      const m = MELEE[arme];
      for (let i = 0; i < 1500; i++) {
        const o: Vec3 = [128 + (alea() - 0.5) * 12, 1.2 + alea() * 0.6, -50 + (alea() - 0.5) * 12];
        const a = alea() * Math.PI * 2;
        const d: Vec3 = [Math.cos(a), 0, Math.sin(a)];
        for (const c of trouverZombiesMelee(o, d, mz.zombies(), arme, monde, mz.nombre())) {
          declares++;
          expect(simu.toucheMelee(Number(c.cible.slice(1)), o, d, m.portee + m.margePortee, m.cosCone, 1000), `${arme} ${i}`).not.toBeNull();
        }
      }
    }
    expect(declares).toBeGreaterThan(30);
  });
});

describe("sonGriffe : chaque type de tigre a son coup de patte", () => {
  it("le chef (gros tigre rouge, type 2) a le sien, le petit du Truck (3) mord, tigre et doré griffent", () => {
    expect(sonGriffe(2)).toBe("chef");
    expect(sonGriffe(3)).toBe("petit");
    expect(sonGriffe(0)).toBe("tigre");
    expect(sonGriffe(1)).toBe("tigre");
  });
});

describe("(v8) maintien de E (relève, planches)", () => {
  const reparer = { ...INVITE_VIDE, invite: "reparer" as const, detail: "Reposer les planches (3 / 6)", id: "F1" };
  const relever = { ...INVITE_VIDE, invite: "reanimer" as const, detail: "Réanimer Léa", cible: "j2" };
  const rien = { cible: null, fenetre: null };

  it("E tenue devant une fenêtre abîmée démarre la repose sans nouvel appui (on arrive la touche enfoncée)", () => {
    expect(decisionMaintien(true, true, reparer, rien)).toEqual({ action: "demarrer", invite: reparer });
    expect(decisionMaintien(true, true, relever, rien)).toEqual({ action: "demarrer", invite: relever });
    // E lâchée, mort, ou rien à maintenir : rien
    expect(decisionMaintien(false, true, reparer, rien)).toBeNull();
    expect(decisionMaintien(true, false, reparer, rien)).toBeNull();
    expect(decisionMaintien(true, true, { ...INVITE_VIDE, invite: "acheter", id: "mur:pompe" }, rien)).toBeNull();
  });

  it("le maintien en cours continue tant que l'invite le propose, s'arrête à E lâchée, fenêtre pleine ou autre fenêtre", () => {
    const en = { cible: null, fenetre: "F1" };
    expect(decisionMaintien(true, true, reparer, en)).toBeNull();
    expect(decisionMaintien(false, true, reparer, en)).toEqual({ action: "arreter" });
    expect(decisionMaintien(true, true, INVITE_VIDE, en)).toEqual({ action: "arreter" });
    expect(decisionMaintien(true, true, { ...reparer, id: "F2" }, en)).toEqual({ action: "arreter" });
    const rel = { cible: "j2", fenetre: null };
    expect(decisionMaintien(true, true, relever, rel)).toBeNull();
    expect(decisionMaintien(true, true, { ...relever, cible: "j3" }, rel)).toEqual({ action: "arreter" });
    expect(decisionMaintien(true, false, relever, rel)).toEqual({ action: "arreter" });
  });
});

describe("(v8) effets d'une mort reçue", () => {
  it("un mini Truck abattu ne saigne pas et ne rugit pas ; un tigre (ou un type inconnu) si", () => {
    expect(effetsMortZombie(4)).toEqual({ sang: false, rugissement: false });
    for (const type of [0, 1, 2, 3] as const) expect(effetsMortZombie(type)).toEqual({ sang: true, rugissement: true });
    expect(effetsMortZombie(null)).toEqual({ sang: true, rugissement: true });
  });
});
