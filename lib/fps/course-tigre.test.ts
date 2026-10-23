import { describe, expect, it } from "vitest";
import { avancerCourse, creerCourse } from "./course-tigre";
import { DEF_PATTES, PATTES } from "../tigre3d/os";
import { creerMonde, fk, nouvellePose, squelette } from "../tigre3d/squelette";
import { ECHELLE_MODELE } from "../tigre3d/troupe";

const sq = squelette();
const DT = 1 / 30;

/**
 * Tigre dessiné qui court droit devant lui à `vMonde` m/s : la pose de `avancerCourse` (museau vers +z, corps à l'origine) posée sur un
 * groupe qui avance de vMonde × t le long de +z (dans le repère du modèle : vMonde / ECHELLE_MODELE). Renvoie, image par image, la position
 * de chaque bout de patte dans ce repère qui avance (donc au sol) et l'état d'appui du moteur.
 */
function courir(vMonde: number, secondes: number) {
  const c = creerCourse(3);
  const pose = nouvellePose(sq);
  const monde = creerMonde(sq);
  const vModele = vMonde / ECHELLE_MODELE;
  const images: { pieds: Record<string, [number, number, number]>; appui: Record<string, boolean> }[] = [];
  let avance = 0;
  for (let i = 0; i < Math.round(secondes / DT); i++) {
    avancerCourse(c, vMonde, DT, pose);
    avance += vModele * DT;
    fk(sq, pose, monde, sq.i.racine);
    const pieds: Record<string, [number, number, number]> = {};
    const appui: Record<string, boolean> = {};
    for (const p of PATTES) {
      const b = monde.p[sq.i[DEF_PATTES[p].bout]];
      pieds[p] = [b.x, b.y, b.z + avance];
      appui[p] = c.pattes[p].appui;
    }
    images.push({ pieds, appui });
  }
  return { c, pose, monde, images };
}

describe("course du tigre de l'arène (moteur du corps)", () => {
  it("à 10,5 m/s, il galope (allure du moteur au-delà du trot)", () => {
    const { c } = courir(10.5, 2);
    expect(c.allure.x).toBeGreaterThan(1.9);
  });

  it("le corps reste à l'origine, museau vers +z, tête devant la croupe", () => {
    const { monde } = courir(10.5, 1.5);
    const tete = monde.p[sq.i.bout_tete], croupe = monde.p[sq.i.queue1], racine = monde.p[sq.i.racine];
    expect(tete.z).toBeGreaterThan(croupe.z + 0.2);
    expect(Math.abs(tete.x - croupe.x)).toBeLessThan(0.1);
    expect(Math.hypot(racine.x, racine.z)).toBeLessThan(0.15);
  });

  it("de 6 à 11 m/s, un pied en appui ne glisse pas au sol (moins de 2 % de la vitesse en moyenne)", () => {
    for (const v of [6, 8.5, 10.5]) {
      const { images } = courir(v, 4);
      let somme = 0, temps = 0, pire = 0;
      // les 2 premières secondes laissent le moteur prendre son allure
      for (let i = Math.round(2 / DT); i < images.length; i++) {
        const a = images[i - 1], b = images[i];
        for (const p of PATTES) {
          if (!a.appui[p] || !b.appui[p]) continue;
          const d = Math.hypot(b.pieds[p][0] - a.pieds[p][0], b.pieds[p][2] - a.pieds[p][2]) * ECHELLE_MODELE;
          somme += d;
          temps += DT;
          pire = Math.max(pire, d / DT);
        }
      }
      expect(temps, `v=${v}`).toBeGreaterThan(0.5);
      expect(somme / temps, `v=${v} glissement moyen (m/s)`).toBeLessThan(0.02 * v);
      expect(pire, `v=${v} pire image (m/s)`).toBeLessThan(0.15 * v);
    }
  });

  it("une image longue (rendu lent) est découpée en pas du moteur, sans rattraper plus de 1/3 s", () => {
    const a = creerCourse(1), b = creerCourse(1);
    const pa = nouvellePose(sq), pb = nouvellePose(sq);
    avancerCourse(a, 10.5, 0.3, pa);
    for (let i = 0; i < 18; i++) avancerCourse(b, 10.5, 1 / 60, pb);
    expect(a.x).toBeCloseTo(b.x, 6);
    const c = creerCourse(1);
    avancerCourse(c, 10.5, 5, nouvellePose(sq));
    expect(c.x).toBeLessThan((10.5 / ECHELLE_MODELE) * 0.34);
  });
});
