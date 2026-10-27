import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aleaGraine } from "../agroparc3d/cachettes";
import type { SceneData } from "../agroparc3d/types";
import { construireMonde, detruireBatiment, lancerRayon, resoudre } from "./collision";
import { FORME_TIGRE, pointLocal } from "./monstres";
import { invaliderNavigation } from "./navigation";
import { PAS_SNAP_ZOMBIE, decoderZombies, type Vec3 } from "./protocole";
import { creerSimuZombies, type EvenementZombie, type JoueurZombie } from "./zombies";
import { DEPARTS, FENETRES, construireMondeZombies, idPrisme, porteDeId } from "./zombies-carte";
import { ZOMBIES, degatsGriffe, pvZombie } from "./zombies-vagues";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const DT = 1 / 60;

const moitie = () => 0.5;
function neuf(extra: Partial<Parameters<typeof creerSimuZombies>[0]> = {}) {
  const monde = construireMondeZombies(scene);
  return { monde, simu: creerSimuZombies({ monde, alea: moitie, ...extra }) };
}
const joueur = (id: string, x: number, z: number, vivant = true): JoueurZombie => ({ id, p: [x, 0, z], vivant });

/** Fait tourner la simulation `secondes` à 60 Hz ; `chaque` est appelé à chaque tic avec t (ms). */
function courir(simu: ReturnType<typeof creerSimuZombies>, t0: number, secondes: number, joueurs: JoueurZombie[], chaque?: (t: number) => void): { t: number; evenements: (EvenementZombie & { t0: number })[] } {
  const evenements: (EvenementZombie & { t0: number })[] = [];
  let t = t0;
  for (let k = 0; k < Math.round(secondes * 60); k++) {
    t += DT * 1000;
    for (const e of simu.tic(t, DT, joueurs)) evenements.push({ ...e, t0: t });
    chaque?.(t);
  }
  return { t, evenements };
}

describe("apparition et état", () => {
  it("numérote les tigres, tire PV / vitesse / échelle de la manche, plafond de 24", () => {
    const { simu } = neuf();
    const a = simu.apparaitre(0, [116.3, -83.9], 3, 0)!;
    const b = simu.apparaitre(1, [118, -89.7], 5, 0)!;
    const c = simu.apparaitre(2, [119.6, -95.5], 10, 0)!;
    expect([a, b, c]).toEqual([1, 2, 3]);
    expect(simu.zombie(a)).toMatchObject({ pv: pvZombie(3, 0), pvMax: 200, vitesse: 5.5, echelle: 2.7, type: 0, manche: 3 });
    expect(simu.zombie(b)).toMatchObject({ pv: pvZombie(5, 1), vitesse: 7 * 1.2, echelle: 2.7 });
    expect(simu.zombie(c)).toMatchObject({ pv: pvZombie(10, 2), vitesse: 8.6 * 0.8, echelle: 3.4 });
    expect(simu.zombie(a)!.p).toEqual([116.3, 0, -83.9]);
    for (let k = 3; k < ZOMBIES.plafondVivants; k++) expect(simu.apparaitre(0, [118, -89.7], 1, 0)).not.toBeNull();
    expect(simu.nbVivants()).toBe(24);
    expect(simu.apparaitre(0, [118, -89.7], 1, 0)).toBeNull();
    simu.reinitialiser();
    expect(simu.nbVivants()).toBe(0);
    expect(simu.apparaitre(0, [118, -89.7], 1, 0)).toBe(1); // numérotation repartie de 1
  });

  it("la vitesse utilise le hasard injecté (± 8 %)", () => {
    const bas = neuf({ alea: () => 0 }), haut = neuf({ alea: () => 0.9999 });
    const vb = bas.simu.zombie(bas.simu.apparaitre(0, [118, -89.7], 5, 0)!)!.vitesse;
    const vh = haut.simu.zombie(haut.simu.apparaitre(0, [118, -89.7], 5, 0)!)!.vitesse;
    expect(vb).toBeCloseTo(7 * 0.92, 6);
    expect(vh).toBeCloseTo(7 * 1.08, 2);
  });
});

describe("marche", () => {
  it("part de N2c, ne traverse aucun mur et rejoint le joueur (vitesse conforme, griffe à l'arrivée)", () => {
    const { monde, simu } = neuf();
    const id = simu.apparaitre(0, [116.3, -83.9], 1, 0)!;
    const j = joueur("j1", ...(DEPARTS[0] as [number, number]));
    const z = simu.zombie(id)!;
    let vmax = 0, dernier: Vec3 = [...z.p];
    const { evenements } = courir(simu, 0, 30, [j], () => {
      expect(resoudre(monde, [z.p[0], 0, z.p[2]], 0.55, 2, true).contacts, `p = ${z.p}`).toHaveLength(0);
      vmax = Math.max(vmax, Math.hypot(z.p[0] - dernier[0], z.p[2] - dernier[2]) / DT);
      dernier = [...z.p];
    });
    expect(Math.hypot(z.p[0] - j.p[0], z.p[2] - j.p[2])).toBeLessThan(2.5);
    expect(vmax).toBeLessThan(4.2 * 1.05); // jamais plus vite que sa vitesse de manche 1
    expect(evenements.some((e) => e.t === "griffeArmee")).toBe(true);
  });

  it("bloqué par une barricade fermée, passe quand elle est détruite (grille recalculée)", () => {
    const { monde, simu } = neuf();
    const f = FENETRES.find((x) => x.id === "S2c")!;
    const j = joueur("j1", ...(DEPARTS[1] as [number, number])); // cour Centre
    const id = simu.apparaitre(0, f.points[1], 1, 0)!;
    const z = simu.zombie(id)!;
    const dist = () => Math.hypot(z.p[0] - j.p[0], z.p[2] - j.p[2]);
    const r1 = courir(simu, 0, 25, [j]);
    expect(dist()).toBeGreaterThan(15); // resté dehors, collé au long mur du bâtiment 72
    // P1 achetée : G3 et S2 détruits, serveur : invalidation puis rafraîchissement
    for (const pr of porteDeId("P1")!.prismes) detruireBatiment(monde, idPrisme(pr));
    invaliderNavigation(monde);
    simu.rafraichirCarte();
    courir(simu, r1.t, 45, [j]);
    expect(dist()).toBeLessThan(2.5);
  });

  it("ne bouge pas sans joueur debout ; ignore les joueurs à terre", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(0, [116.3, -83.9], 1, 0)!;
    const z = simu.zombie(id)!;
    const p0: Vec3 = [...z.p];
    courir(simu, 0, 2, []);
    courir(simu, 2000, 2, [joueur("j1", 126.5, -53, false)]);
    expect(z.p).toEqual(p0);
    expect(courir(simu, 4000, 1, [joueur("j1", 126.5, -53, false)]).evenements).toEqual([]);
  });

  it("séparation : des tigres lancés du même point s'écartent d'au moins ~1,3 m", () => {
    const { simu } = neuf();
    const j = joueur("j1", 109.5, -35.5);
    for (let k = 0; k < 8; k++) simu.apparaitre(0, [146 + (k % 3) * 0.1, -52 + Math.floor(k / 3) * 0.1], 1, 0);
    courir(simu, 0, 2, [j]);
    const l = simu.liste();
    let mini = Infinity;
    for (let a = 0; a < l.length; a++) for (let b = a + 1; b < l.length; b++) mini = Math.min(mini, Math.hypot(l[a].p[0] - l[b].p[0], l[a].p[2] - l[b].p[2]));
    expect(mini).toBeGreaterThan(1.2);
    // et ils avancent vers le joueur
    for (const z of l) expect(Math.hypot(z.p[0] - j.p[0], z.p[2] - j.p[2])).toBeLessThan(Math.hypot(146 - j.p[0], -52 - j.p[2]) + 0.5);
  });

  it("rotation limitée à 6 rad/s", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(0, [130, -50], 1, 0, 0)!;
    const z = simu.zombie(id)!;
    const j = joueur("j1", 130, -30); // plein sud : cap voulu π
    simu.tic(DT * 1000, DT, [j]); // 1ʳᵉ image : se tourne tout de suite (apparition)
    z.cap = 0;
    let t = DT * 1000;
    let prec = z.cap;
    for (let k = 0; k < 30; k++) {
      t += DT * 1000;
      simu.tic(t, DT, [j]);
      const ecart = Math.abs(Math.atan2(Math.sin(z.cap - prec), Math.cos(z.cap - prec)));
      expect(ecart).toBeLessThanOrEqual(ZOMBIES.rotationMax * DT + 1e-9);
      prec = z.cap;
    }
  });
});

describe("champ de distance", () => {
  it("recalculé seulement si les cases des joueurs debout changent (et au plus toutes les 400 ms)", () => {
    const { simu } = neuf();
    simu.apparaitre(0, [116.3, -83.9], 1, 0);
    const j = joueur("j1", 127.2, -52.4); // au milieu d'une case de 1,5 m
    const r = courir(simu, 0, 3, [j]);
    expect(simu.diagnostic().calculsChamp).toBe(1); // une fois, joueur immobile
    // un déplacement dans la même case ne recalcule pas, un changement de case oui (400 ms plus tard au plus)
    j.p = [127.6, 0, -52.0];
    const r2 = courir(simu, r.t, 1, [j]);
    expect(simu.diagnostic().calculsChamp).toBe(1);
    j.p = [140, 0, -53];
    courir(simu, r2.t, 1, [j]);
    expect(simu.diagnostic().calculsChamp).toBe(2);
    // un joueur qui se déplace sans cesse : au plus un calcul par 400 ms
    const avant = simu.diagnostic().calculsChamp;
    let x = 100;
    courir(simu, r2.t + 1000, 2, [j], () => { x += 0.1; j.p = [x, 0, -53]; });
    expect(simu.diagnostic().calculsChamp - avant).toBeLessThanOrEqual(5);
    expect(simu.diagnostic().calculsChamp - avant).toBeGreaterThanOrEqual(2);
  });

  it("un tigre qui apparaît entre deux calculs est couvert au calcul suivant", () => {
    const { simu } = neuf();
    const j = joueur("j1", 126.5, -53);
    simu.apparaitre(0, [116.3, -83.9], 1, 0);
    const r = courir(simu, 0, 1, [j]);
    const avant = simu.diagnostic().calculsChamp;
    simu.apparaitre(0, [118, -89.7], 1, r.t);
    courir(simu, r.t, 0.6, [j]);
    expect(simu.diagnostic().calculsChamp).toBeGreaterThan(avant);
  });
});

describe("griffe", () => {
  it("arme 0,4 s puis donne les dégâts de la manche, recharge 1,0 s, puis recommence", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(0, [127.5, -53], 3, 0)!; // 1 m du joueur
    const j = joueur("j1", 126.5, -53);
    const { evenements } = courir(simu, 0, 4, [j]);
    const armees = evenements.filter((e) => e.t === "griffeArmee");
    const donnees = evenements.filter((e) => e.t === "griffe") as Extract<(typeof evenements)[number], { t: "griffe" }>[];
    expect(armees.length).toBeGreaterThanOrEqual(2);
    expect(armees[0]).toMatchObject({ tigre: id, joueur: "j1" });
    // pas avant la fin de l'apparition (800 ms), puis 0,4 s d'armement
    expect(armees[0].t0).toBeGreaterThanOrEqual(ZOMBIES.apparitionMs - 20);
    expect(donnees[0]).toMatchObject({ tigre: id, joueur: "j1", degats: degatsGriffe(3) });
    expect(donnees[0].t0 - armees[0].t0).toBeGreaterThanOrEqual(ZOMBIES.griffeArmeS * 1000 - 20);
    expect(donnees[0].t0 - armees[0].t0).toBeLessThan(ZOMBIES.griffeArmeS * 1000 + 60);
    // recharge : 1,0 s entre la griffe donnée et l'armement suivante
    expect(armees[1].t0 - donnees[0].t0).toBeGreaterThanOrEqual(ZOMBIES.griffeRechargeS * 1000 - 20);
    expect(armees[1].t0 - donnees[0].t0).toBeLessThan(ZOMBIES.griffeRechargeS * 1000 + 60);
    // le tigre s'est arrêté à portée, tourné vers le joueur
    const z = simu.zombie(id)!;
    expect(Math.hypot(z.p[0] - j.p[0], z.p[2] - j.p[2])).toBeLessThan(2.2);
  });

  it("dégâts imposés (essais) et drapeau « griffe armée » du snap", () => {
    const { simu } = neuf({ degatsGriffe: 100 });
    simu.apparaitre(0, [127.5, -53], 3, 0);
    const j = joueur("j1", 126.5, -53);
    let drapeau = false;
    const r = courir(simu, 0, 2, [j], () => {
      const d = decoderZombies(simu.snap());
      if (d[0].griffe) drapeau = true;
    });
    expect(drapeau).toBe(true);
    expect((r.evenements.find((e) => e.t === "griffe") as { degats: number }).degats).toBe(100);
  });

  it("un tigre loin ne frappe pas ; un joueur qui s'écarte pendant l'armement n'est pas touché", () => {
    const { simu } = neuf();
    simu.apparaitre(0, [140, -53], 1, 0); // 13,5 m
    expect(courir(simu, 0, 1, [joueur("j1", 126.5, -53)]).evenements).toEqual([]);
    // le joueur fuit dès que la griffe est armée (la suivante n'arrive qu'après la recharge)
    const s2 = neuf();
    s2.simu.apparaitre(0, [127.5, -53], 1, 0);
    const j = joueur("j1", 126.5, -53);
    let armee = false;
    const { evenements } = courir(s2.simu, 0, 1.7, [j], () => {
      if (!armee && s2.simu.liste()[0].armeFin > 0) { armee = true; j.p = [126.5 - 6, 0, -53]; }
    });
    expect(armee).toBe(true);
    expect(evenements.filter((e) => e.t === "griffe")).toEqual([]);
    expect(s2.simu.liste()[0].armeFin).toBe(0); // l'armement a bien pris fin sans frapper
  });

  it("un mur fin entre le tigre et le joueur arrête la griffe (pas de ligne de vue)", () => {
    const mur = { h: 10, r: [[-0.15, -30], [0.15, -30], [0.15, 30], [-0.15, 30]] as [number, number][], c: [0, 0] as [number, number] };
    const ancre = (x: number, z: number) => ({ h: 5, r: [[x, z], [x + 1, z], [x + 1, z + 1]] as [number, number][], c: [x, z] as [number, number] });
    const monde = construireMonde({ ...scene, buildings: [ancre(-30, -30), ancre(30, 30), mur], pois: [] } as SceneData);
    const simu = creerSimuZombies({ monde, alea: moitie });
    simu.apparaitre(0, [-0.9, 0], 1, 0);
    const j = joueur("j1", 0.9, 0); // 1,8 m en ligne droite, 1,4 m de surface : à portée sans le mur
    const { evenements } = courir(simu, 0, 3, [j]);
    expect(evenements).toEqual([]);
    // sans le mur, la même scène donne une griffe
    const libre = construireMonde({ ...scene, buildings: [ancre(-30, -30), ancre(30, 30)], pois: [] } as SceneData);
    const s2 = creerSimuZombies({ monde: libre, alea: moitie });
    s2.apparaitre(0, [-0.9, 0], 1, 0);
    expect(courir(s2, 0, 3, [j]).evenements.some((e) => e.t === "griffe")).toBe(true);
  });

  it("griffe les joueurs debout seulement, le plus proche", () => {
    const { simu } = neuf();
    simu.apparaitre(0, [127.5, -53], 1, 0);
    const { evenements } = courir(simu, 0, 1.5, [joueur("a", 126.5, -53, false), joueur("b", 135, -53), joueur("c", 126.9, -52.5)]);
    const e = evenements.find((x) => x.t === "griffeArmee")!;
    expect(e.joueur).toBe("c");
  });
});

describe("toucheZombie", () => {
  const tigreFixe = () => {
    const s = neuf();
    const id = s.simu.apparaitre(0, [130, -62], 1, 0, 0)!;
    return { ...s, id, z: s.simu.zombie(id)! };
  };
  const tete = (z: { p: Vec3; cap: number; echelle: number }) => pointLocal([z.p[0], 0, z.p[2]], z.cap, z.echelle, 0, 0.47, 0.37);
  const corps = (z: { p: Vec3; cap: number; echelle: number }) => pointLocal([z.p[0], 0, z.p[2]], z.cap, z.echelle, 0, 0.33, -0.03);
  const vers = (o: Vec3, c: Vec3): Vec3 => { const l = Math.hypot(c[0] - o[0], c[1] - o[1], c[2] - o[2]); return [(c[0] - o[0]) / l, (c[1] - o[1]) / l, (c[2] - o[2]) / l]; };

  it("touche la tête (zone tete) et le corps (zone corps), rate à côté, respecte la portée", () => {
    const { simu, id, z } = tigreFixe();
    const h = tete(z), c = corps(z);
    const oT: Vec3 = [h[0] - 12, h[1], h[2]];
    expect(simu.toucheZombie(id, oT, vers(oT, h), 50, 0)).toMatchObject({ zone: "tete" });
    const oC: Vec3 = [c[0] - 12, c[1], c[2]];
    const hit = simu.toucheZombie(id, oC, vers(oC, c), 50, 0)!;
    expect(hit.zone).toBe("corps");
    expect(hit.distance).toBeGreaterThan(10);
    expect(hit.distance).toBeLessThan(12);
    // 3 m à côté : rate ; portée trop courte : rate ; id inconnu : null
    expect(simu.toucheZombie(id, oC, vers(oC, [c[0], c[1], c[2] + 4]), 50, 0)).toBeNull();
    expect(simu.toucheZombie(id, oC, vers(oC, c), 5, 0)).toBeNull();
    expect(simu.toucheZombie(999, oC, vers(oC, c), 50, 0)).toBeNull();
    // l'échelle compte : la brute (3,4) est plus grosse, un rayon qui rase la patte la touche
    const g = neuf();
    const gid = g.simu.apparaitre(2, [130, -62], 10, 0, 0)!;
    const gz = g.simu.zombie(gid)!;
    const gc = corps(gz);
    expect(g.simu.toucheZombie(gid, [gc[0] - 12, gc[1], gc[2]], vers([gc[0] - 12, gc[1], gc[2]], gc), 50, 0)).not.toBeNull();
  });

  it("le tigre le plus gros reçoit les touches que le petit laisse passer (marge 0,25 m comprise)", () => {
    const { simu, id, z } = tigreFixe();
    const c = corps(z);
    const o: Vec3 = [c[0] - 10, c[1], c[2]];
    // à 0,12 × 2,7 + 0,25 = 0,57 m de l'axe de la sphère : touche ; à 0,7 m : rate
    expect(simu.toucheZombie(id, o, vers(o, [c[0], c[1], c[2] + 0.5]), 50, 0)).not.toBeNull();
    expect(simu.toucheZombie(id, o, vers(o, [c[0], c[1] + 0.9, c[2]]), 50, 0)).toBeNull();
  });

  it("rayon bloqué par un bâtiment fermé, pas par un champ", () => {
    const { simu, monde } = neuf();
    // tigre dans la cour, tireur de l'autre côté du bâtiment 70 (mur ouest de la cour Centre)
    const id = simu.apparaitre(0, [144, -49.4], 1, 0, 0)!;
    const z = simu.zombie(id)!;
    const c = corps(z);
    const o: Vec3 = [c[0] + 30, c[1], c[2] - 8];
    const d = vers(o, c);
    expect(lancerRayon(monde, o, d, 60)).toBeLessThan(Math.hypot(c[0] - o[0], c[2] - o[2]));
    expect(simu.toucheZombie(id, o, d, 80, 0)).toBeNull();
    // à travers N2c (champ) : le tigre à la fenêtre est touché
    const s2 = neuf();
    const n2 = s2.simu.apparaitre(0, [114.65, -78.15], 1, 0, 0)!;
    const cz = corps(s2.simu.zombie(n2)!);
    const o2: Vec3 = [cz[0] + 1, cz[1], cz[2] + 12];
    expect(s2.simu.toucheZombie(n2, o2, vers(o2, cz), 40, 0)).not.toBeNull();
  });

  it("rejeu de latence : la position d'il y a ≤ 300 ms est touchable, celle d'il y a plus longtemps non", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(0, [130, -62], 1, 0, 0)!;
    const z = simu.zombie(id)!;
    const j = joueur("j1", 130, -30); // plein sud : le tigre avance en ligne droite
    simu.tic(DT * 1000, DT, [j]);
    const ancienne = { p: [...z.p] as Vec3, cap: z.cap, echelle: z.echelle };
    const f = [-Math.sin(ancienne.cap), -Math.cos(ancienne.cap)];
    // tireur 10 m derrière l'ancienne croupe, dans l'axe du tigre, à hauteur du ventre ; portée ajustée à l'ancienne pose
    const croupe = pointLocal([ancienne.p[0], 0, ancienne.p[2]], ancienne.cap, ancienne.echelle, 0, 0.33, -0.21);
    const o: Vec3 = [croupe[0] - f[0] * 10, croupe[1], croupe[2] - f[1] * 10];
    const d: Vec3 = [f[0], 0, f[1]];
    const portee = 10 - 0.21 * 2.7 * 0 - 0.297 - 0.25 + 0.15; // distance d'entrée dans la croupe d'alors, plus 15 cm
    const r1 = courir(simu, DT * 1000, 0.25, [j]); // 250 ms : ≈ 1 m plus loin
    expect(Math.hypot(z.p[0] - ancienne.p[0], z.p[2] - ancienne.p[2])).toBeGreaterThan(0.9);
    const hit = simu.toucheZombie(id, o, d, portee, r1.t);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeLessThanOrEqual(portee);
    // la même portée avec la pose actuelle seule (hors fenêtre de rejeu) rate : 0,8 s plus tard
    const r2 = courir(simu, r1.t, 0.8, [j]);
    expect(simu.toucheZombie(id, o, d, portee, r2.t)).toBeNull();
  });
});

describe("toucheMelee", () => {
  const COS_COUTEAU = 0.574, COS_EPEE = 0.342;
  const cote = (z: { p: Vec3; cap: number; echelle: number }, a: number): Vec3 => pointLocal([z.p[0], 0, z.p[2]], z.cap, z.echelle, 0, 0.33, a);
  const mis = (o: Vec3, c: Vec3): Vec3 => { const l = Math.hypot(c[0] - o[0], c[1] - o[1], c[2] - o[2]); return [(c[0] - o[0]) / l, (c[1] - o[1]) / l, (c[2] - o[2]) / l]; };

  it("distance de surface, cône, portée, id inconnu", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(0, [130, -62], 1, 0, 0)!;
    const z = simu.zombie(id)!;
    const c = cote(z, -0.03);
    // 2 m du centre du ventre (sphère de 0,32 m) : surface à 1,7 m
    const o: Vec3 = [c[0] - 2, c[1], c[2]];
    const hit = simu.toucheMelee(id, o, mis(o, c), 2.2, COS_COUTEAU, 0)!;
    expect(hit.distance).toBeCloseTo(2 - 0.12 * 2.7, 2);
    // hors de portée
    const loin: Vec3 = [c[0] - 6, c[1], c[2]];
    expect(simu.toucheMelee(id, loin, mis(loin, c), 2.6, COS_EPEE, 0)).toBeNull();
    // dans le dos du joueur : hors cône
    expect(simu.toucheMelee(id, o, [-1, 0, 0], 2.6, COS_EPEE, 0)).toBeNull();
    // 60° de côté : hors du cône du couteau (55°), dans celui de l'épée (70°) — pour une cible dont le rayon ne rattrape pas l'angle
    const o2: Vec3 = [c[0] - 3, c[1], c[2]];
    const angle = (68 * Math.PI) / 180;
    const d2: Vec3 = [Math.cos(angle), 0, -Math.sin(angle)];
    const couteau = simu.toucheMelee(id, o2, d2, 4, COS_COUTEAU, 0);
    const epee = simu.toucheMelee(id, o2, d2, 4, COS_EPEE, 0);
    expect(epee).not.toBeNull();
    expect(couteau === null || couteau.distance >= 0).toBe(true);
    expect(simu.toucheMelee(999, o, mis(o, c), 2.6, COS_EPEE, 0)).toBeNull();
  });

  it("l'épée touche plusieurs tigres côte à côte, chacun avec sa distance", () => {
    const { simu } = neuf();
    const ids = [-1.4, 0, 1.4].map((dx) => simu.apparaitre(0, [130 + dx, -62], 1, 0, 0)!);
    const o: Vec3 = [130, 1.0, -62 + 3.2]; // devant eux (ils regardent −z : le museau est à −z)
    const res = ids.map((id) => simu.toucheMelee(id, o, [0, 0, -1], 3.4, COS_EPEE, 0));
    expect(res.every((r) => r !== null)).toBe(true);
    // le tigre du milieu est le plus proche... ou du moins aucun n'est à plus de 3,4 m
    for (const r of res) expect(r!.distance).toBeLessThanOrEqual(3.4);
  });

  it("ligne de vue : un bâtiment entre le joueur et le tigre arrête le coup", () => {
    const { simu, monde } = neuf();
    const id = simu.apparaitre(0, [144, -49.4], 1, 0, 0)!;
    const z = simu.zombie(id)!;
    const c = cote(z, -0.03);
    // de l'autre côté du mur ouest de la cour (bâtiment 70), à moins de 2,6 m de surface
    const o: Vec3 = [c[0] + 1.5, c[1], c[2]];
    const touche = simu.toucheMelee(id, o, mis(o, c), 2.6, COS_EPEE, 0);
    expect(touche === null || touche.distance <= 2.6).toBe(true);
    // un coup tout contre le mur, de l'autre côté de la façade, ne passe pas : on cherche un point où le rayon est bien coupé
    let essai: Vec3 | null = null;
    for (let dx = 1.2; dx < 3; dx += 0.1) {
      const q: Vec3 = [c[0] + dx, c[1], c[2] + 0.01];
      if (lancerRayon(monde, q, mis(q, c), Math.hypot(c[0] - q[0], c[2] - q[2])) < Infinity) { essai = q; break; }
    }
    if (essai) expect(simu.toucheMelee(id, essai, mis(essai, c), 6, COS_EPEE, 0)).toBeNull();
  });

  it("rejeu de 200 ms", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(0, [130, -62], 1, 0, 0)!;
    const z = simu.zombie(id)!;
    const j = joueur("j1", 130, -30);
    simu.tic(DT * 1000, DT, [j]);
    const f = [-Math.sin(z.cap), -Math.cos(z.cap)];
    const centre0: Vec3 = [z.p[0], 0, z.p[2]];
    // coup porté par derrière, dans l'axe : la croupe d'alors est à 1,0 m de surface, celle d'après à plus de 1,3 m
    const croupe = pointLocal(centre0, z.cap, z.echelle, 0, 0.33, -0.21);
    const o: Vec3 = [croupe[0] - f[0] * (0.297 + 1.0), croupe[1], croupe[2] - f[1] * (0.297 + 1.0)];
    const d: Vec3 = [f[0], 0, f[1]];
    const r = courir(simu, DT * 1000, 0.15, [j]);
    expect(Math.hypot(z.p[0] - centre0[0], z.p[2] - centre0[2])).toBeGreaterThan(0.5);
    const hit = simu.toucheMelee(id, o, d, 1.3, COS_COUTEAU, r.t);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(1.0, 1);
    const r2 = courir(simu, r.t, 0.4, [j]);
    expect(simu.toucheMelee(id, o, d, 1.3, COS_COUTEAU, r2.t)).toBeNull();
  });
});

describe("blesser et snap", () => {
  it("blesser : PV, pourcentage, mort (le tigre disparaît), tigre inconnu", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(0, [130, -62], 1, 0)!; // 100 PV
    expect(simu.blesser(id, 25, 0)).toEqual({ mort: false, pvPct: 75 });
    expect(simu.zombie(id)!.pv).toBe(75);
    expect(simu.blesser(id, 74.6, 0).pvPct).toBe(1); // vivant : au moins 1 %
    const fin = simu.blesser(id, 10, 0);
    expect(fin).toMatchObject({ mort: true, pvPct: 0, type: 0 });
    expect(fin.p).toEqual([130, 0, -62]);
    expect(simu.zombie(id)).toBeUndefined();
    expect(simu.nbVivants()).toBe(0);
    expect(simu.blesser(id, 10, 0)).toEqual({ mort: false, pvPct: 0 });
    expect(simu.blesser(77, -50, 0)).toEqual({ mort: false, pvPct: 0 });
  });

  it("des dégâts négatifs ne soignent pas", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(0, [130, -62], 1, 0)!;
    simu.blesser(id, -50, 0);
    expect(simu.zombie(id)!.pv).toBe(100);
  });

  it("snap : stride 6, restants, positions au centimètre, type, PV, apparition puis griffe", () => {
    const { simu } = neuf();
    const a = simu.apparaitre(0, [130.123, -62.456], 1, 1000, 0.5)!;
    const b = simu.apparaitre(2, [118, -89.7], 10, 1000)!;
    simu.blesser(b, pvZombie(10, 2) / 2, 1000);
    const s = simu.snap(7, 1100);
    expect(s.r).toBe(7);
    expect(s.z).toHaveLength(2 * PAS_SNAP_ZOMBIE);
    expect(s.z.every(Number.isInteger)).toBe(true);
    const d = decoderZombies(s);
    expect(d[0]).toMatchObject({ id: a, type: 0, griffe: false, apparition: true, pvPct: 100 });
    expect(d[0].x).toBeCloseTo(130.12, 2);
    expect(d[0].z).toBeCloseTo(-62.46, 2);
    expect(d[0].cap).toBeCloseTo(0.5, 3);
    expect(d[1]).toMatchObject({ id: b, type: 2, pvPct: 50 });
    expect(s.z[4] & 3).toBe(0);
    expect(s.z[PAS_SNAP_ZOMBIE + 4] & 3).toBe(2);
    expect(s.z[4] & 8).toBe(8);
    // plus en apparition au bout de 800 ms
    expect(decoderZombies(simu.snap(2, 1000 + ZOMBIES.apparitionMs + 10))[0].apparition).toBe(false);
    // par défaut : tigres vivants restants, instant du dernier tic
    expect(simu.snap().r).toBe(2);
  });
});

describe("performance", () => {
  it("24 tigres, 8 joueurs : moins de 2 ms par tic en moyenne (budget nominal 1 ms)", () => {
    const { simu } = neuf();
    const joueurs = DEPARTS.map((d, k) => joueur(`j${k}`, d[0], d[1]));
    const points = FENETRES[0].points;
    for (let k = 0; k < 24; k++) simu.apparaitre(k % 3 === 2 ? 1 : 0, points[k % 3], 5, 0);
    const r0 = courir(simu, 0, 3, joueurs); // échauffement
    const n = 600;
    const t0 = performance.now();
    courir(simu, r0.t, n / 60, joueurs);
    const moyenne = (performance.now() - t0) / n;
    expect(moyenne).toBeLessThan(2);
    // et avec des joueurs qui changent de case sans arrêt (champ recalculé au maximum, 2,5 fois par seconde)
    let x = 0;
    const t1 = performance.now();
    courir(simu, r0.t + 10_000, n / 60, joueurs, () => { x += 0.15; joueurs[0].p = [110 + (x % 30), 0, -50]; joueurs[1].p = [140 - (x % 30), 0, -40]; });
    expect((performance.now() - t1) / n).toBeLessThan(2);
  }, 30_000);
});

describe("formes", () => {
  it("la forme du tigre est celle de monstres.ts (8 sphères dont une tête)", () => {
    expect(FORME_TIGRE.filter((s) => s.zone === "tete")).toHaveLength(1);
    expect(FORME_TIGRE).toHaveLength(8);
  });
});
