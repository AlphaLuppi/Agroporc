import { describe, expect, it } from "vitest";
import { creerArene } from "./arene";
import { PAS_S, type ConfigMatch, type EntreesVoiture } from "./contrat";
import { creerMonde, pasMonde } from "./match";
import { majCamera, creerEtatCamera } from "./camera";
import { CAMERA_DEFAUT } from "./contrat";
import {
  REJEU, avancerLecture, balleInterpolee, creerEnregistreurRejeu, creerVueRejeu, dureeLecture, lancerLecture, poserImage, situer, voitureInterpolee,
} from "./rejeu-but";

const config: ConfigMatch = {
  format: "1v1", equipeJoueur: "bleue", niveauAllies: "pro", niveauAdversaires: "pro", dureeS: 300, graine: 7,
  nomsEquipes: { bleue: "Les Trèfles", orange: "Les Tigres" }, nomJoueur: "Moi",
};
const nulles = (): EntreesVoiture => ({ accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false });

/** Joue un match jusqu'à un but : la voiture 0 roule, la balle est lancée dans la cage orange au bout de `attenteS`. */
function jouerUnBut(attenteS = 5) {
  const arene = creerArene();
  const m = creerMonde(config, arene);
  const enr = creerEnregistreurRejeu();
  let tBut = -1, marqueur: number | null = null;
  const entrees = m.voitures.map(() => nulles());
  entrees[0].accel = 1;
  let tLance = -1;
  for (let i = 0; i < 120 * 30 && tBut < 0; i++) {
    if (m.phase === "enJeu" && tLance < 0) tLance = m.temps + attenteS;
    if (tLance > 0 && m.temps >= tLance && m.temps < tLance + PAS_S) { m.balle.p = [0, 2, 44]; m.balle.v = [0, 0, 30]; }
    const evs = pasMonde(m, entrees);
    if (m.phase === "enJeu" || m.phase === "but") enr.enregistrer(m);
    for (const e of evs) if (e.t === "but") { tBut = m.temps; marqueur = e.idMarqueur; }
  }
  // la célébration
  while (m.phase === "but") { pasMonde(m, entrees); if (m.phase === "but") enr.enregistrer(m); }
  return { arene, m, enr, tBut, marqueur };
}

describe("rejeu d'un but", () => {
  const { arene, m, enr, tBut } = jouerUnBut();

  it("l'enregistreur garde une image tous les deux pas, sur 8 s au plus", () => {
    expect(tBut).toBeGreaterThan(0);
    expect(enr.taille()).toBeGreaterThan(200);
    expect(enr.taille()).toBeLessThanOrEqual(Math.ceil(REJEU.tamponS / (PAS_S * REJEU.cadence)));
  });

  it("le clip couvre les 4,5 s d'avant le but et l'instant d'après, dans l'ordre", () => {
    const clip = enr.extraire(tBut, 0)!;
    expect(clip).not.toBeNull();
    const t0 = clip.images[0].t, t1 = clip.images[clip.images.length - 1].t;
    expect(tBut - t0).toBeGreaterThan(REJEU.avantS - 0.05);
    expect(tBut - t0).toBeLessThanOrEqual(REJEU.avantS + 1e-6);
    expect(t1 - tBut).toBeGreaterThan(0.5);
    expect(t1 - tBut).toBeLessThanOrEqual(REJEU.apresS + 1e-6);
    for (let i = 1; i < clip.images.length; i++) expect(clip.images[i].t).toBeGreaterThan(clip.images[i - 1].t);
    // à l'instant du but la balle est dans la cage orange
    const { i } = situer(clip, tBut);
    expect(clip.images[i].balle.p[2]).toBeGreaterThan(51);
  });

  it("le clip est une copie : vider l'enregistreur ou continuer le match ne le change pas", () => {
    const clip = enr.extraire(tBut, 0)!;
    const z = clip.images[10].balle.p[2];
    const copie = creerEnregistreurRejeu();
    for (let i = 0; i < 600; i++) { pasMonde(m, m.voitures.map(() => nulles())); copie.enregistrer(m); }
    expect(clip.images[10].balle.p[2]).toBe(z);
  });

  it("un but marqué dès le coup d'envoi (moins de 0,8 s d'images) n'est pas rejoué", () => {
    const court = creerEnregistreurRejeu();
    const mm = creerMonde(config, creerArene());
    for (let i = 0; i < 60; i++) { mm.tick++; mm.temps += PAS_S; court.enregistrer(mm); }
    expect(court.extraire(mm.temps, 0)).toBeNull();
    court.vider();
    expect(court.taille()).toBe(0);
  });

  it("la lecture avance en temps réel jusqu'au but, signale le but une seule fois, finit au ralenti", () => {
    const clip = enr.extraire(tBut, 0)!;
    const l = lancerLecture(clip);
    let buts = 0, images = 0;
    while (!l.fini && images < 5000) { if (avancerLecture(l, 1 / 60)) buts++; images++; }
    expect(buts).toBe(1);
    expect(images / 60).toBeCloseTo(dureeLecture(clip), 0);
    expect(dureeLecture(clip)).toBeGreaterThan(5);
    expect(dureeLecture(clip)).toBeLessThan(7.5);
  });

  it("la vue rejouée ne touche pas au vrai monde, et sa caméra suit le buteur en regardant la balle", () => {
    const clip = enr.extraire(tBut, 0)!;
    const avant = JSON.stringify({ v: m.voitures.map((v) => v.p), b: m.balle.p, phase: m.phase });
    const vue = creerVueRejeu(m);
    const l = lancerLecture(clip);
    let alpha = poserImage(vue, clip, l.t);
    const cam = creerEtatCamera(voitureInterpolee(vue, 0, alpha), balleInterpolee(vue, alpha), true);
    let pireSaut = 0, prec: number[] | null = null;
    while (!l.fini) {
      avancerLecture(l, 1 / 60);
      alpha = poserImage(vue, clip, l.t);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
      const moi = voitureInterpolee(vue, 0, alpha), balle = balleInterpolee(vue, alpha);
      const pose = majCamera(cam, CAMERA_DEFAUT, { balleCam: true, regard: [0, 0], arriere: false }, moi, balle, arene, 1 / 60, 16 / 9, true);
      // la caméra reste derrière le buteur (2,7 m) et regarde vers la balle
      expect(Math.hypot(pose.position[0] - moi.p[0], pose.position[1] - moi.p[1], pose.position[2] - moi.p[2])).toBeLessThan(3.6);
      expect(pose.haut[1]).toBeGreaterThan(0.99);
      if (prec) pireSaut = Math.max(pireSaut, Math.hypot(pose.position[0] - prec[0], pose.position[1] - prec[1], pose.position[2] - prec[2]));
      prec = [...pose.position];
    }
    expect(pireSaut).toBeLessThan(0.8);
    expect(JSON.stringify({ v: m.voitures.map((v) => v.p), b: m.balle.p, phase: m.phase })).toBe(avant);
    expect(vue.phase).toBe("enJeu");
  });
});
