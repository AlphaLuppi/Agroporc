import { describe, expect, it } from "vitest";
import { ARMES } from "./protocole";
import type { ArmeId } from "./protocole";
import {
  amplitudeInspection, dureeInspection, familleInspection, inspectionAnnulee, inspectionFinie, poseInspection, poseNeutre,
  type PoseInspection,
} from "./inspection";

const TOUTES: ArmeId[] = [...ARMES, "couteau", "epee"];

/** Les 12 nombres d'une pose, les angles ramenés à (cos, sin) : l'orientation compte, pas le nombre de tours. */
function aplatir(p: PoseInspection): number[] {
  const r: number[] = [];
  for (const o of [p.ensemble, p.arme]) r.push(o.x, o.y, o.z, Math.cos(o.rx), Math.sin(o.rx), Math.cos(o.ry), Math.sin(o.ry), Math.cos(o.rz), Math.sin(o.rz));
  return r;
}
const ecart = (a: PoseInspection, b: PoseInspection) => Math.max(...aplatir(a).map((x, i) => Math.abs(x - aplatir(b)[i])));

describe("familles d'inspection", () => {
  it("couteau, épée, armes de poing et armes d'épaule", () => {
    expect(familleInspection("couteau")).toBe("couteau");
    expect(familleInspection("epee")).toBe("epee");
    for (const a of ["pistolet", "revolver", "mini_uzi", "magnum_dore"] as const) expect(familleInspection(a)).toBe("arme_courte");
    for (const a of ["mitraillette", "pompe", "sniper", "fusil_assaut", "mitrailleuse", "railgun", "minigun", "bazooka", "lance_grenades"] as const) {
      expect(familleInspection(a)).toBe("arme_longue");
    }
  });
  it("chaque arme (spéciales, uniques et zombies comprises) a une durée raisonnable", () => {
    for (const a of TOUTES) {
      const d = dureeInspection(a);
      expect(d).toBeGreaterThan(2);
      expect(d).toBeLessThan(5);
    }
  });
  it("les armes très lourdes bougent moins que les autres", () => {
    expect(amplitudeInspection("bazooka")).toBeLessThan(amplitudeInspection("fusil_assaut"));
    expect(amplitudeInspection("fusil_assaut")).toBe(1);
  });
});

describe("chronologie de l'inspection", () => {
  it("part de la pose neutre et y revient à la fin, pour chaque arme", () => {
    for (const a of TOUTES) {
      const d = dureeInspection(a);
      expect(ecart(poseInspection(a, 0), poseNeutre())).toBeLessThan(1e-9);
      expect(ecart(poseInspection(a, d - 1e-6), poseNeutre())).toBeLessThan(1e-3);
      expect(ecart(poseInspection(a, d), poseNeutre())).toBe(0);
      expect(ecart(poseInspection(a, d + 5), poseNeutre())).toBe(0);
      expect(ecart(poseInspection(a, -1), poseNeutre())).toBe(0);
    }
  });
  it("est continue (pas de saut d'orientation ni de position d'un pas de 10 ms à l'autre) et sans NaN", () => {
    for (const a of TOUTES) {
      const d = dureeInspection(a);
      let prec = poseInspection(a, 0);
      for (let t = 0.01; t <= d; t += 0.01) {
        const p = poseInspection(a, t);
        for (const x of aplatir(p)) expect(Number.isFinite(x)).toBe(true);
        // plus gros mouvement : deux tours en 0,9 s, soit 14 rad/s : 0,14 rad par pas, jamais plus de 0,2 sur cos / sin
        expect(ecart(prec, p), `${a} à ${t.toFixed(2)} s`).toBeLessThan(0.25);
        prec = p;
      }
    }
  });
  it("bouge vraiment : l'arme est tournée ou déplacée à mi-parcours", () => {
    for (const a of TOUTES) {
      const d = dureeInspection(a);
      let maxi = 0;
      for (let t = 0; t < d; t += 0.05) maxi = Math.max(maxi, ecart(poseInspection(a, t), poseNeutre()));
      expect(maxi, a).toBeGreaterThan(0.2);
    }
  });
  it("le couteau fait plusieurs tours complets (tricks), l'arme longue montre ses deux flancs", () => {
    // le couteau : la rotation en z (vrille) passe par une demi-tour au moins
    let rzMax = 0;
    for (let t = 0; t < dureeInspection("couteau"); t += 0.02) rzMax = Math.max(rzMax, Math.abs(poseInspection("couteau", t).arme.rz));
    expect(rzMax).toBeGreaterThan(Math.PI * 0.9);
    // l'arme longue : lacet de signe opposé de part et d'autre du centre
    let min = 0, max = 0;
    for (let t = 0; t < dureeInspection("fusil_assaut"); t += 0.02) {
      const ry = poseInspection("fusil_assaut", t).arme.ry;
      min = Math.min(min, ry);
      max = Math.max(max, ry);
    }
    expect(min).toBeLessThan(-0.7);
    expect(max).toBeGreaterThan(0.7);
  });
  it("l'épée tourne dans le plan de l'écran (ordre ZXY)", () => {
    expect(poseInspection("epee", 1.5).arme.ordre).toBe("ZXY");
    expect(poseInspection("couteau", 1.5).arme.ordre).toBe("XYZ");
  });
  it("inspectionFinie", () => {
    expect(inspectionFinie("couteau", 1)).toBe(false);
    expect(inspectionFinie("couteau", dureeInspection("couteau"))).toBe(true);
  });
});

describe("annulation", () => {
  const repos = { vise: false, tire: false, recharge: false, sprint: false, changement: false };
  it("rien ne coupe l'inspection au repos", () => {
    expect(inspectionAnnulee(repos)).toBe(false);
  });
  it("tir, visée, recharge, sprint et changement d'arme l'annulent", () => {
    for (const k of ["vise", "tire", "recharge", "sprint", "changement"] as const) expect(inspectionAnnulee({ ...repos, [k]: true }), k).toBe(true);
  });
});
