import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dedans } from "../agroparc3d/cachettes";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde, resoudre } from "./collision";
import { OEIL_SIEGE, SILHOUETTE, type Siege } from "./protocole";
import {
  SIEGES_LOCAUX, VEH, coinsVehicule, distanceVehicule, etatVehiculeInitial, intensiteDerapage, pasVehicule, pointDeSortie, positionSiege, renverse,
  type CommandesVehicule, type EtatVehicule,
} from "./vehicule";

const sceneReelle = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;

function rect(x0: number, z0: number, x1: number, z1: number, h = 10): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
/** Monde réduit à quelques bâtiments ; deux bâtiments minuscules très loin donnent des bornes de ±2 km (la voiture ne les touche pas). */
function mondeAvec(...batiments: Building[]) {
  return construireMonde({ ...sceneReelle, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000), ...batiments], pois: [] });
}
const vide = mondeAvec();
const monde = construireMonde(sceneReelle);

const CAP_EST = -Math.PI / 2; // avant = (−sin cap, −cos cap) = (+1, 0)
const GAZ: CommandesVehicule = { accel: 1, direction: 0, frein: false };
const RIEN: CommandesVehicule = { accel: 0, direction: 0, frein: false };

/** Écart d'angle a − b ramené dans ]−π, π]. */
const ecart = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** Rejoue `secondes` de commandes constantes par pas de 1/60. */
function rouler(e: EtatVehicule, c: CommandesVehicule, secondes: number, m = vide) {
  let etat = e, choc = 0;
  const n = Math.round(secondes * 60);
  for (let i = 0; i < n; i++) { const r = pasVehicule(etat, c, 1 / 60, m); etat = r.etat; choc += r.choc; }
  return { etat, choc };
}

describe("constantes de la spec §2.12", () => {
  it("valeurs", () => {
    expect(VEH.vitesseMax).toBe(24);
    expect(VEH.vitesseRenverse).toBe(6);
    expect(VEH.distanceMontee).toBe(3.5);
    expect(VEH.oeilSiege).toBe(OEIL_SIEGE);
    expect(SIEGES_LOCAUX).toHaveLength(4);
  });
});

describe("pasVehicule : longitudinal", () => {
  it("part de l'arrêt, accélère à 14 m/s² et plafonne à 24 m/s", () => {
    const e0 = etatVehiculeInitial([0, 0], CAP_EST);
    expect(e0.v).toBe(0);
    expect(rouler(e0, GAZ, 1).etat.v).toBeCloseTo(14, 1);
    const apres = rouler(e0, GAZ, 4).etat;
    expect(apres.v).toBeCloseTo(VEH.vitesseMax, 6);
    // la voiture avance vers l'est (cap −π/2) et reste sur sa ligne
    expect(apres.p[0]).toBeGreaterThan(30);
    expect(Math.abs(apres.p[2])).toBeLessThan(1e-6);
  });

  it("marche arrière plafonnée à 8 m/s, vers l'ouest", () => {
    const r = rouler(etatVehiculeInitial([0, 0], CAP_EST), { accel: -1, direction: 0, frein: false }, 3).etat;
    expect(r.v).toBeCloseTo(-VEH.vitesseArriere, 6);
    expect(r.p[0]).toBeLessThan(0);
  });

  it("freine plus fort que le frottement, et le frottement ralentit sans pédale", () => {
    const lancee: EtatVehicule = { p: [0, 0, 0], cap: CAP_EST, v: 20 };
    const frein = rouler(lancee, { accel: -1, direction: 0, frein: false }, 0.5).etat.v;
    const libre = rouler(lancee, RIEN, 0.5).etat.v;
    expect(frein).toBeCloseTo(20 - 28 * 0.5, 1);
    expect(libre).toBeCloseTo(20 - 3 * 0.5, 1);
    expect(rouler(lancee, RIEN, 20).etat.v).toBe(0);
    expect(rouler(lancee, { accel: 0, direction: 0, frein: true }, 3).etat.v).toBe(0);
  });

  it("n'avance pas sur un dt nul et ne bouge pas à l'arrêt sans commande", () => {
    const e = etatVehiculeInitial([5, 6], 1.2);
    expect(pasVehicule(e, GAZ, 0, vide).etat).toEqual(e);
    const r = pasVehicule(e, RIEN, 1 / 60, vide);
    expect(r.etat.p).toEqual(e.p);
    expect(r.choc).toBe(0);
  });
});

describe("pasVehicule : direction", () => {
  it("braquage nul à l'arrêt : le cap ne change pas", () => {
    const e0 = etatVehiculeInitial([0, 0], 0.7);
    const r = rouler(e0, { accel: 0, direction: 1, frein: false }, 2).etat;
    expect(r.cap).toBeCloseTo(0.7, 9);
    expect(r.p).toEqual(e0.p);
  });

  it("direction +1 en avançant tourne à droite (déplacement latéral vers la droite, cap qui diminue)", () => {
    const e0: EtatVehicule = { p: [0, 0, 0], cap: CAP_EST, v: 10 };
    const r = rouler(e0, { accel: 0.4, direction: 1, frein: false }, 0.5).etat;
    // cap est : la droite est +z ; le lacet positif tourne à gauche, donc il diminue à droite
    expect(r.p[2]).toBeGreaterThan(0.5);
    expect(ecart(r.cap, CAP_EST)).toBeLessThan(-0.2);
    const g = rouler(e0, { accel: 0.4, direction: -1, frein: false }, 0.5).etat;
    expect(g.p[2]).toBeLessThan(-0.5);
    expect(ecart(g.cap, CAP_EST)).toBeGreaterThan(0.2);
  });

  it("le rayon de virage grandit avec la vitesse et l'adhérence borne l'accélération latérale", () => {
    const omega = (v: number) => {
      const r = pasVehicule({ p: [0, 0, 0], cap: CAP_EST, v }, { accel: 0, direction: 1, frein: false }, 1 / 120, vide).etat;
      return Math.abs(ecart(r.cap, CAP_EST)) * 120; // rad/s
    };
    const rayon = (v: number) => v / omega(v);
    expect(rayon(6)).toBeLessThan(rayon(12));
    expect(rayon(12)).toBeLessThan(rayon(24));
    // à 24 m/s la rotation est plafonnée par l'adhérence : v × ω ≤ 17 m/s²
    expect(24 * omega(24)).toBeLessThanOrEqual(17.1);
  });

  it("le frein à main fait décrocher l'arrière : rotation plus vive qu'au même braquage sans frein", () => {
    const e0: EtatVehicule = { p: [0, 0, 0], cap: CAP_EST, v: 20 };
    const sans = rouler(e0, { accel: 0, direction: 1, frein: false }, 0.5).etat;
    const avec = rouler(e0, { accel: 0, direction: 1, frein: true }, 0.5).etat;
    expect(Math.abs(avec.cap - CAP_EST)).toBeGreaterThanOrEqual(Math.abs(sans.cap - CAP_EST));
    expect(avec.v).toBeLessThan(sans.v);
  });

  it("dérapage (Espace) : la caisse pivote plus que la trajectoire, la voiture glisse de côté, puis se raccroche", () => {
    const e0: EtatVehicule = { p: [0, 0, 0], cap: CAP_EST, v: 20 };
    const derive = rouler(e0, { accel: 1, direction: 1, frein: true }, 0.6).etat;
    const normal = rouler(e0, { accel: 1, direction: 1, frein: false }, 0.6).etat;
    // la caisse a bien plus tourné qu'en virage normal
    expect(Math.abs(ecart(derive.cap, CAP_EST))).toBeGreaterThan(Math.abs(ecart(normal.cap, CAP_EST)) * 1.5);
    // virage à droite : l'élan pousse la voiture vers l'extérieur, donc vers sa gauche (vl < 0), et franchement
    expect(derive.vl ?? 0).toBeLessThan(-4);
    expect(intensiteDerapage(derive)).toBeGreaterThan(0.3);
    // en virage normal les pneus tiennent : pas de glissade audible
    expect(intensiteDerapage(normal)).toBe(0);
    // la vitesse totale se conserve en grande partie (on entretient la glissade aux gaz)
    expect(Math.hypot(derive.v, derive.vl ?? 0)).toBeGreaterThan(14);
    // relâcher Espace : les pneus ramènent la voiture dans son axe en moins d'une seconde
    const raccroche = rouler(derive, { accel: 1, direction: 0, frein: false }, 1).etat;
    expect(Math.abs(raccroche.vl ?? 0)).toBeLessThan(0.01);
    expect(intensiteDerapage(raccroche)).toBe(0);
  });

  it("dérapage : la trajectoire suit l'élan (la voiture avance encore vers l'est alors que le capot est tourné)", () => {
    const e0: EtatVehicule = { p: [0, 0, 0], cap: CAP_EST, v: 22 };
    const r = rouler(e0, { accel: 0, direction: 1, frein: true }, 0.4).etat;
    const tourne = Math.abs(ecart(r.cap, CAP_EST));
    // direction réelle du déplacement (monde) vs direction du capot
    const ax = -Math.sin(r.cap), az = -Math.cos(r.cap), dx = Math.cos(r.cap), dz = -Math.sin(r.cap);
    const wx = ax * r.v + dx * (r.vl ?? 0), wz = az * r.v + dz * (r.vl ?? 0);
    const angleTrajectoire = Math.abs(Math.atan2(wz, wx)); // 0 = plein est
    expect(tourne).toBeGreaterThan(0.5);
    expect(angleTrajectoire).toBeLessThan(tourne - 0.2);
  });

  it("un état sans `vl` (serveur, snap) reste valide et une voiture qui roule droit n'en a jamais", () => {
    const r = rouler({ p: [0, 0, 0], cap: CAP_EST, v: 10 }, GAZ, 1).etat;
    expect(r.vl).toBeUndefined();
  });

  it("déterministe : mêmes entrées, mêmes sorties à l'octet", () => {
    const cmd: CommandesVehicule = { accel: 0.8, direction: -0.3, frein: false };
    const a = rouler(etatVehiculeInitial([3, 4], 0.4), cmd, 2, monde);
    const b = rouler(etatVehiculeInitial([3, 4], 0.4), cmd, 2, monde);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("un dt plus gros que 1/60 est sous-découpé (même résultat qu'en pas fins)", () => {
    const e0: EtatVehicule = { p: [0, 0, 0], cap: CAP_EST, v: 8 };
    const gros = pasVehicule(e0, { accel: 1, direction: 0.5, frein: false }, 1 / 30, vide).etat;
    let fin = e0;
    for (let i = 0; i < 4; i++) fin = pasVehicule(fin, { accel: 1, direction: 0.5, frein: false }, 1 / 120, vide).etat;
    expect(gros.p[0]).toBeCloseTo(fin.p[0], 9);
    expect(gros.cap).toBeCloseTo(fin.cap, 9);
  });
});

describe("pasVehicule : collisions", () => {
  const mur = mondeAvec(rect(30, -50, 40, 50));

  it("ne traverse pas un bâtiment, perd la composante normale de sa vitesse et signale le choc", () => {
    const e0: EtatVehicule = { p: [0, 0, 0], cap: CAP_EST, v: 0 };
    const r = rouler(e0, GAZ, 4, mur);
    // le cercle avant (centre à +1,2 m, rayon 1,0) bute sur le mur x = 30
    expect(r.etat.p[0]).toBeLessThanOrEqual(30 - 1.2 - 1.0 + 1e-6);
    expect(r.etat.p[0]).toBeGreaterThan(30 - 1.2 - 1.0 - 0.5);
    expect(r.etat.v).toBeLessThan(0.5);
    expect(r.choc).toBeGreaterThan(15);
  });

  it("choc oblique : glisse le long du mur au lieu de s'arrêter", () => {
    const e0: EtatVehicule = { p: [0, 0, 0], cap: CAP_EST + 0.3, v: 15 }; // cap légèrement tourné : avant = (+cos 0.3.., −sin) vers −z
    const r = rouler(e0, GAZ, 1.5, mur);
    expect(r.etat.p[0]).toBeLessThanOrEqual(30 - 1.0 - 1.2 * Math.cos(0.3) + 1e-6);
    expect(Math.abs(r.etat.p[2])).toBeGreaterThan(5); // a glissé le long du mur
    expect(r.choc).toBeGreaterThan(0);
  });

  it("reste dans les bornes de la carte", () => {
    const petit = mondeAvec();
    const e0: EtatVehicule = { p: [petit.bornes.x1 - 5, 0, 0], cap: CAP_EST, v: 20 };
    const r = rouler(e0, GAZ, 2, petit);
    expect(r.etat.p[0]).toBeLessThanOrEqual(petit.bornes.x1 - VEH.rayonCercle - 1.2 + 1e-6);
  });

  it("vrai scene.json : lancée à fond contre un bâtiment, aucun cercle ne finit dans le bâtiment", () => {
    const iCba = sceneReelle.buildings.findIndex((b) => dedans(-162.8, -12.7, b.r));
    const cba = sceneReelle.buildings[iCba];
    // plus longue arête, milieu et normale sortante
    let m = { l: 0, mx: 0, mz: 0, nx: 0, nz: 0 };
    for (let i = 0, j = cba.r.length - 1; i < cba.r.length; j = i++) {
      const [ax, az] = cba.r[j], [bx, bz] = cba.r[i];
      const l = Math.hypot(bx - ax, bz - az);
      if (l <= m.l) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      let nx = (bz - az) / l, nz = -(bx - ax) / l;
      if (dedans(mx + nx * 0.05, mz + nz * 0.05, cba.r)) { nx = -nx; nz = -nz; }
      m = { l, mx, mz, nx, nz };
    }
    // départ à 25 m du mur, face au mur : avant = −normale ⇒ cap = atan2(−avant.x, −avant.z) avec avant = (−nx, −nz)
    const cap = Math.atan2(m.nx, m.nz);
    let e: EtatVehicule = { p: [m.mx + m.nx * 25, 0, m.mz + m.nz * 25], cap, v: 0 };
    // le point de départ doit être libre (sinon le test ne dit rien)
    expect(resoudre(monde, e.p, VEH.rayonCercle, VEH.hauteur).contacts).toHaveLength(0);
    for (let i = 0; i < 60 * 5; i++) {
      e = pasVehicule(e, GAZ, 1 / 60, monde).etat;
      const fx = -Math.sin(e.cap), fz = -Math.cos(e.cap);
      for (const d of [-1.2, 0, 1.2]) {
        expect(dedans(e.p[0] + fx * d, e.p[2] + fz * d, cba.r)).toBe(false);
      }
    }
  });
});

describe("sièges, sortie, distance", () => {
  const e: EtatVehicule = { p: [10, 0, -5], cap: 0.9, v: 0 };

  it("4 sièges distincts, dans la boîte, avant-gauche pour le conducteur", () => {
    const pos = ([0, 1, 2, 3] as Siege[]).map((s) => positionSiege(e, s));
    for (const p of pos) expect(distanceVehicule(e, p)).toBe(0);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      expect(Math.hypot(pos[i][0] - pos[j][0], pos[i][2] - pos[j][2])).toBeGreaterThan(0.8);
    }
    // cap 0 : avant = −z, droite = +x ; siège 0 = avant-gauche = (−x, −z) du centre
    const s0 = positionSiege(etatVehiculeInitial([0, 0], 0), 0);
    expect(s0[0]).toBeCloseTo(-0.45, 9);
    expect(s0[2]).toBeCloseTo(-0.6, 9);
    const s3 = positionSiege(etatVehiculeInitial([0, 0], 0), 3);
    expect(s3[0]).toBeCloseTo(0.45, 9);
    expect(s3[2]).toBeCloseTo(0.6, 9);
  });

  it("distanceVehicule : 0 dans la boîte, distance à l'arête sinon, toit compté", () => {
    const e0 = etatVehiculeInitial([0, 0], CAP_EST); // longueur le long de x
    expect(distanceVehicule(e0, [0, 0, 0])).toBe(0);
    expect(distanceVehicule(e0, [VEH.longueur / 2 + 3, 0, 0])).toBeCloseTo(3, 9);
    expect(distanceVehicule(e0, [0, 0, VEH.largeur / 2 + 2])).toBeCloseTo(2, 9);
    expect(distanceVehicule(e0, [VEH.longueur / 2 + 3, 0, VEH.largeur / 2 + 4])).toBeCloseTo(5, 9);
    expect(distanceVehicule(e0, [0, VEH.hauteur + 2, 0])).toBeCloseTo(2, 9);
  });

  it("coinsVehicule : rectangle de 4,4 × 1,9 centré sur la voiture", () => {
    const c = coinsVehicule(e);
    expect(Math.hypot(c[0][0] - c[1][0], c[0][1] - c[1][1])).toBeCloseTo(VEH.largeur, 9);
    expect(Math.hypot(c[1][0] - c[2][0], c[1][1] - c[2][1])).toBeCloseTo(VEH.longueur, 9);
    const cx = c.reduce((s, p) => s + p[0], 0) / 4, cz = c.reduce((s, p) => s + p[1], 0) / 4;
    expect(cx).toBeCloseTo(10, 9);
    expect(cz).toBeCloseTo(-5, 9);
  });

  it("pointDeSortie : côté du siège, hors boîte et hors bâtiment", () => {
    const e0 = etatVehiculeInitial([0, 0], CAP_EST); // droite = +z, gauche = −z
    const p0 = pointDeSortie(e0, 0, vide);
    const p1 = pointDeSortie(e0, 1, vide);
    expect(p0[2]).toBeLessThan(-VEH.largeur / 2);
    expect(p1[2]).toBeGreaterThan(VEH.largeur / 2);
    expect(distanceVehicule(e0, p0)).toBeGreaterThan(0.5);
  });

  it("pointDeSortie : un mur côté siège reporte la sortie de l'autre côté", () => {
    const m = mondeAvec(rect(-20, -20, 20, -1.2)); // mur le long du côté gauche (−z)
    const e0 = etatVehiculeInitial([0, 0], CAP_EST);
    const p = pointDeSortie(e0, 0, m);
    expect(p[2]).toBeGreaterThan(0);
    expect(resoudre(m, p, SILHOUETTE.rayon, SILHOUETTE.hauteur).contacts).toHaveLength(0);
  });

  it("pointDeSortie : jamais dans un bâtiment sur le vrai scene.json (voiture collée à un mur)", () => {
    const b = sceneReelle.buildings[0];
    const [ax, az] = b.r[0], [bx, bz] = b.r[1];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, l = Math.hypot(bx - ax, bz - az);
    let nx = (bz - az) / l, nz = -(bx - ax) / l;
    if (dedans(mx + nx * 0.05, mz + nz * 0.05, b.r)) { nx = -nx; nz = -nz; }
    const e1: EtatVehicule = { p: [mx + nx * 1.1, 0, mz + nz * 1.1], cap: Math.atan2(-nz, nx), v: 0 };
    for (const s of [0, 1, 2, 3] as Siege[]) {
      const p = pointDeSortie(e1, s, monde);
      expect(dedans(p[0], p[2], b.r)).toBe(false);
    }
  });
});

describe("renverse", () => {
  const e = etatVehiculeInitial([0, 0], CAP_EST);
  const R = SILHOUETTE.rayon;

  it("≥ 6 m/s mesurés et cylindre qui recoupe la boîte : oui", () => {
    expect(renverse(e, [0, 0, 0], R, 6)).toBe(true);
    expect(renverse(e, [VEH.longueur / 2 + R - 0.01, 0, 0], R, 20)).toBe(true);
  });
  it("3 m/s mesurés : non", () => {
    expect(renverse(e, [0, 0, 0], R, 3)).toBe(false);
    expect(renverse(e, [0, 0, 0], R, 5.99)).toBe(false);
  });
  it("sans marge : à R de la caisse, ou plus, c'est manqué", () => {
    expect(renverse(e, [VEH.longueur / 2 + R + 0.01, 0, 0], R, 20)).toBe(false);
    expect(renverse(e, [0, 0, VEH.largeur / 2 + R + 0.01], R, 20)).toBe(false);
  });
  it("la vitesse déclarée par l'état est sans effet : seule la vitesse mesurée compte", () => {
    const declaree: EtatVehicule = { ...e, v: 24 };
    expect(renverse(declaree, [0, 0, 0], R, 0)).toBe(false);
    expect(renverse({ ...e, v: 0 }, [0, 0, 0], R, 10)).toBe(true);
  });
  it("un joueur dont les pieds sont au-dessus du toit n'est pas renversé", () => {
    expect(renverse(e, [0, VEH.hauteur + 0.1, 0], R, 20)).toBe(false);
  });
});
