import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { construireMonde, detruireBatiment, lancerRayon, resoudre } from "./collision";
import { FORME_TIGRE, enrouler, pointLocal } from "./monstres";
import { carteNavigation, invaliderNavigation } from "./navigation";
import { PAS_SNAP_ZOMBIE, decoderZombies, type Vec3 } from "./protocole";
import { DISTANCE_LEURRE_M, GRIFFE_DELAI_MAX_MS, creerSimuZombies, porteePatte, touchePatte, type ArriveeZombie, type Barricades, type EvenementZombie, type JoueurZombie, type Leurre, type SpecZombie } from "./zombies";
import { DEPARTS, construireMondeZombies, fenetreDeId, idPrisme } from "./zombies-carte";
import { ZOMBIES, degatsGriffe, echelleZombie, pvZombie, rechargeGriffe, vitesseAllure, type Allure, type TypeZombie } from "./zombies-vagues";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const DT = 1 / 60;
const CHASSE: ArriveeZombie = { mode: "chasse" };

const moitie = () => 0.5;
/** Spec d'un tigre de la manche `n` (allure imposée, hasard de vitesse à 0,5). */
function spec(n: number, type: TypeZombie = 0, allure: Allure = 0): SpecZombie {
  return { type, manche: n, pv: pvZombie(n, type), allure, vitesse: vitesseAllure(allure, 0.5, type), degats: degatsGriffe(type), rechargeGriffeS: rechargeGriffe(type) };
}
/** Barricades d'essai : `planches` par fenêtre (6 par défaut), arrachages comptés. */
function barricades(depart: number = ZOMBIES.planches): Barricades & { etat: Map<string, number>; arrachees: string[] } {
  const etat = new Map<string, number>();
  const arrachees: string[] = [];
  return {
    etat, arrachees,
    planches: (f) => etat.get(f) ?? depart,
    arracher: (f) => { etat.set(f, Math.max(0, (etat.get(f) ?? depart) - 1)); arrachees.push(f); },
  };
}
function neuf(extra: Partial<Parameters<typeof creerSimuZombies>[0]> = {}) {
  const monde = construireMondeZombies(scene);
  return { monde, simu: creerSimuZombies({ monde, alea: moitie, ...extra }) };
}
const joueur = (id: string, x: number, z: number, vivant = true): JoueurZombie => ({ id, p: [x, 0, z], vivant });
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

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

// Cour Centre : dehors, au sud de l'open space ; le joueur y est hors de portée de toute fenêtre
const COUR: [number, number] = [128, -55];

describe("apparition et état", () => {
  it("numérote les tigres, garde la spec (PV, allure, vitesse, griffe), échelle du type, plafond de 24", () => {
    const { simu } = neuf();
    const a = simu.apparaitre(spec(3), COUR, CHASSE, 0)!;
    const b = simu.apparaitre(spec(5, 1, 1), [130, -58], CHASSE, 0)!;
    const c = simu.apparaitre(spec(10, 2, 1), [124, -58], { mode: "sol" }, 0)!;
    const d = simu.apparaitre(spec(10, 3, 2), [132, -52], CHASSE, 0)!;
    expect([a, b, c, d]).toEqual([1, 2, 3, 4]);
    expect(simu.zombie(a)).toMatchObject({ pv: 350, pvMax: 350, vitesse: 3.0, echelle: 2.7, type: 0, manche: 3, allure: 0, mode: "chasse", degats: 50 });
    expect(simu.zombie(b)).toMatchObject({ pv: pvZombie(5, 1), vitesse: 6.2, echelle: echelleZombie(1), allure: 1 });
    expect(simu.zombie(c)).toMatchObject({ pv: pvZombie(10, 2), echelle: 3.4, mode: "sol", degats: 80 });
    expect(simu.zombie(d)).toMatchObject({ vitesse: 13.5, echelle: 1.5, degats: 30, rechargeGriffeS: 0.45 });
    expect(simu.zombie(a)!.p).toEqual([128, 0, -55]);
    for (let k = 4; k < ZOMBIES.plafondVivants; k++) expect(simu.apparaitre(spec(1), COUR, CHASSE, 0)).not.toBeNull();
    expect(simu.nbVivants()).toBe(24);
    expect(simu.apparaitre(spec(1), COUR, CHASSE, 0)).toBeNull();
    simu.reinitialiser();
    expect(simu.nbVivants()).toBe(0);
    expect(simu.apparaitre(spec(1), COUR, CHASSE, 0)).toBe(1); // numérotation repartie de 1
  });

  it("changerAllure : le dernier tigre sprinte, le rampant ralentit", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(4), COUR, CHASSE, 0)!;
    simu.changerAllure(id, 2, 8.4);
    expect(simu.zombie(id)).toMatchObject({ allure: 2, vitesse: 8.4 });
    simu.changerAllure(id, 3, 1.4);
    expect(simu.zombie(id)).toMatchObject({ allure: 3, vitesse: 1.4 });
    simu.changerAllure(999, 2, 8); // inconnu : sans effet
    expect(simu.retirer(id)).toBe(true);
    expect(simu.retirer(id)).toBe(false);
  });
});

describe("sortie du sol", () => {
  it("immobile pendant la sortie (1,6 s), puis en chasse ; pas de griffe avant la fin de l'apparition", () => {
    const { simu } = neuf();
    const j = joueur("j1", COUR[0] + 1.5, COUR[1]);
    const id = simu.apparaitre(spec(1), COUR, { mode: "sol" }, 0)!;
    const z = simu.zombie(id)!;
    const r = courir(simu, 0, 1.5, [j]);
    expect(z.mode).toBe("sol");
    expect([z.p[0], z.p[2]]).toEqual(COUR);
    expect(r.evenements).toEqual([]);
    const r2 = courir(simu, r.t, 1.5, [j]);
    expect(z.mode).toBe("chasse");
    expect(r2.evenements.some((e) => e.t === "griffeArmee")).toBe(true);
  });
});

describe("fenêtres barricadées", () => {
  it("approche de la fenêtre N2c, arrache les 6 planches au rythme de son allure, saute, puis chasse dans la cour", () => {
    const b = barricades();
    const { monde, simu } = neuf({ barricades: b });
    const f = fenetreDeId("N2c")!;
    const j = joueur("j1", ...COUR);
    const id = simu.apparaitre(spec(1), f.points[0], { mode: "fenetre", fenetre: f }, 0)!;
    const z = simu.zombie(id)!;
    const modes: string[] = [];
    const { evenements } = courir(simu, 0, 30, [j], () => {
      if (modes[modes.length - 1] !== z.mode) modes.push(z.mode);
      if (z.mode !== "saut") expect(resoudre(monde, [z.p[0], 0, z.p[2]], 0.55, 2, false).contacts, `${z.mode} p = ${z.p}`).toHaveLength(0);
    });
    expect(modes).toEqual(["approche", "fenetre", "saut", "chasse"]);
    const planches = evenements.filter((e) => e.t === "planche");
    expect(planches).toHaveLength(6);
    expect(b.arrachees).toEqual(Array(6).fill("N2c"));
    // une planche toutes les 1,4 s pour un marcheur
    for (let k = 1; k < planches.length; k++) expect(planches[k].t0 - planches[k - 1].t0).toBeCloseTo(ZOMBIES.arrachageS[0] * 1000, -2);
    const saut = evenements.find((e) => e.t === "saut")!;
    expect(saut).toMatchObject({ tigre: id, fenetre: "N2c" });
    expect(saut.t0 - planches[5].t0).toBeLessThan(100);
    // entré, il rejoint le joueur
    expect(dist(z.p, j.p)).toBeLessThan(2.5);
    expect((z.p[0] - f.milieu[0]) * f.normale[0] + (z.p[2] - f.milieu[1]) * f.normale[1]).toBeGreaterThan(0);
  });

  it("fenêtre sans planche : il saute dès l'arrivée ; un sprinteur arrache plus vite (0,9 s)", () => {
    const b = barricades(0);
    const { simu } = neuf({ barricades: b });
    const f = fenetreDeId("N2c")!;
    const id = simu.apparaitre(spec(1), f.dehors, { mode: "fenetre", fenetre: f }, 0)!;
    const r = courir(simu, 0, 0.5, [joueur("j1", ...COUR)]);
    expect(r.evenements.find((e) => e.t === "saut")).toMatchObject({ tigre: id });
    expect(r.evenements.some((e) => e.t === "planche")).toBe(false);

    const b2 = barricades(2);
    const s2 = neuf({ barricades: b2 });
    s2.simu.apparaitre(spec(8, 0, 2), f.dehors, { mode: "fenetre", fenetre: f }, 0);
    const r2 = courir(s2.simu, 0, 3, [joueur("j1", ...COUR)]);
    const pl = r2.evenements.filter((e) => e.t === "planche");
    expect(pl).toHaveLength(2);
    expect(pl[1].t0 - pl[0].t0).toBeCloseTo(ZOMBIES.arrachageS[2] * 1000, -2);
  });

  it("un joueur collé derrière la fenêtre se fait griffer à travers, et le tigre cesse d'arracher pendant ce temps", () => {
    const b = barricades();
    const { simu } = neuf({ barricades: b });
    const f = fenetreDeId("N2c")!;
    const j = joueur("j1", f.milieu[0] + f.normale[0] * 0.7, f.milieu[1] + f.normale[1] * 0.7);
    simu.apparaitre(spec(1), f.dehors, { mode: "fenetre", fenetre: f }, 0);
    const { evenements } = courir(simu, 0, 4, [j]);
    expect(evenements.some((e) => e.t === "griffe")).toBe(true);
    expect(b.etat.get("N2c") ?? 6).toBeGreaterThan(3);
  });

  it("entré, un tigre en chasse ne ressort pas par une fenêtre ; un petit du Truck, lui, la franchit d'un bond", () => {
    const f = fenetreDeId("N2c")!;
    const dehors = f.points[1];
    const j = joueur("j1", dehors[0], dehors[1]);
    const dedans: [number, number] = [f.dedans[0] - f.normale[0] * -3, f.dedans[1] - f.normale[1] * -3];
    const { simu } = neuf();
    const id = simu.apparaitre(spec(1), dedans, CHASSE, 0)!;
    courir(simu, 0, 12, [j]);
    const z = simu.zombie(id)!;
    expect((z.p[0] - f.milieu[0]) * f.normale[0] + (z.p[2] - f.milieu[1]) * f.normale[1]).toBeGreaterThan(0);
    const s2 = neuf();
    const p = s2.simu.apparaitre(spec(5, 3, 2), dedans, CHASSE, 0)!;
    courir(s2.simu, 0, 6, [j]);
    expect(dist(s2.simu.zombie(p)!.p, j.p)).toBeLessThan(2.5);
  });
});

describe("marche", () => {
  it("rejoint le joueur dans la cour sans traverser de mur ni dépasser sa vitesse", () => {
    const { monde, simu } = neuf();
    const id = simu.apparaitre(spec(1, 0, 1), [118, -70], CHASSE, 0)!;
    const j = joueur("j1", 140, -50);
    const z = simu.zombie(id)!;
    let vmax = 0, dernier: Vec3 = [...z.p];
    const { evenements } = courir(simu, 0, 15, [j], () => {
      expect(resoudre(monde, [z.p[0], 0, z.p[2]], 0.55, 2, false).contacts, `p = ${z.p}`).toHaveLength(0);
      vmax = Math.max(vmax, dist(z.p, dernier) / DT);
      dernier = [...z.p];
    });
    expect(dist(z.p, j.p)).toBeLessThan(2.5);
    expect(vmax).toBeLessThan(6.2 * 1.05);
    expect(evenements.some((e) => e.t === "griffeArmee")).toBe(true);
  });

  it("une porte fermée coupe la cour de l'open space ; une fois ouverte (grille recalculée), le tigre passe", () => {
    const { monde, simu } = neuf();
    const j = joueur("j1", ...(DEPARTS[2] as [number, number])); // open space
    const id = simu.apparaitre(spec(1, 0, 1), COUR, CHASSE, 0)!;
    const z = simu.zombie(id)!;
    const r1 = courir(simu, 0, 15, [j]);
    expect(dist(z.p, j.p)).toBeGreaterThan(6);
    detruireBatiment(monde, idPrisme("D2"));
    invaliderNavigation(monde);
    simu.rafraichirCarte();
    courir(simu, r1.t, 20, [j]);
    expect(dist(z.p, j.p)).toBeLessThan(2.5);
  });

  it("failsafe : un tigre qui ne se rapproche plus, à plus de 25 m de tout joueur, est signalé bloqué après 30 s", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(1), [76, -68], CHASSE, 0)!; // cour Ouest, fermée
    // il serpente entre les îlots du parking vers le joueur pendant ~17 s (v8), puis ne progresse plus : signalé 30 s plus tard
    const { evenements } = courir(simu, 0, 55, [joueur("j1", ...(DEPARTS[2] as [number, number]))]);
    const b = evenements.filter((e) => e.t === "bloque");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ tigre: id });
    expect(b[0].t0).toBeGreaterThanOrEqual(30_000 + 10_000);
  });

  it("ne bouge pas sans joueur debout ; ignore les joueurs à terre", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(1), COUR, CHASSE, 0)!;
    const z = simu.zombie(id)!;
    const p0: Vec3 = [...z.p];
    courir(simu, 0, 2, []);
    courir(simu, 2000, 2, [joueur("j1", 135, -53, false)]);
    expect(z.p).toEqual(p0);
    expect(courir(simu, 4000, 1, [joueur("j1", 135, -53, false)]).evenements).toEqual([]);
  });

  it("séparation : des tigres lancés du même point s'écartent d'au moins ~1,2 m et avancent vers le joueur", () => {
    const { simu } = neuf();
    const j = joueur("j1", 140, -50);
    for (let k = 0; k < 8; k++) simu.apparaitre(spec(1, 0, 1), [124 + (k % 3) * 0.1, -60 + Math.floor(k / 3) * 0.1], CHASSE, 0);
    courir(simu, 0, 2, [j]);
    const l = simu.liste();
    let mini = Infinity;
    for (let a = 0; a < l.length; a++) for (let b = a + 1; b < l.length; b++) mini = Math.min(mini, dist(l[a].p, l[b].p));
    expect(mini).toBeGreaterThan(1.2);
    for (const z of l) expect(dist(z.p, j.p)).toBeLessThan(Math.hypot(124 - j.p[0], -60 - j.p[2]) + 0.5);
  });

  it("rotation limitée à 6 rad/s", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(1), [126, -64], CHASSE, 0, 0)!;
    const z = simu.zombie(id)!;
    const j = joueur("j1", 126, -50); // plein sud : cap voulu π
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
    const { monde, simu } = neuf();
    const c = carteNavigation(monde, ZOMBIES.rayonNav, { taille: ZOMBIES.tailleCaseNav });
    simu.apparaitre(spec(1), [118, -70], CHASSE, 0);
    // au milieu d'une case
    const cx = c.x0 + (Math.floor((140 - c.x0) / c.taille) + 0.5) * c.taille, cz = c.z0 + (Math.floor((-50 - c.z0) / c.taille) + 0.5) * c.taille;
    const j = joueur("j1", cx, cz);
    const r = courir(simu, 0, 3, [j]);
    expect(simu.diagnostic().calculsChamp).toBe(1); // une fois, joueur immobile
    j.p = [cx + 0.2, 0, cz - 0.2];
    const r2 = courir(simu, r.t, 1, [j]);
    expect(simu.diagnostic().calculsChamp).toBe(1);
    j.p = [cx + 5, 0, cz];
    courir(simu, r2.t, 1, [j]);
    expect(simu.diagnostic().calculsChamp).toBe(2);
    // un joueur qui se déplace sans cesse : au plus un calcul par 400 ms
    const avant = simu.diagnostic().calculsChamp;
    let x = 130;
    courir(simu, r2.t + 1000, 2, [j], () => { x += 0.1; j.p = [x, 0, -50]; });
    expect(simu.diagnostic().calculsChamp - avant).toBeLessThanOrEqual(5);
    expect(simu.diagnostic().calculsChamp - avant).toBeGreaterThanOrEqual(2);
  });

  it("un tigre qui passe en chasse entre deux calculs est couvert au calcul suivant", () => {
    const { simu } = neuf();
    const j = joueur("j1", 140, -50);
    simu.apparaitre(spec(1), [118, -70], CHASSE, 0);
    const r = courir(simu, 0, 1, [j]);
    const avant = simu.diagnostic().calculsChamp;
    simu.apparaitre(spec(1), [120, -72], CHASSE, r.t);
    courir(simu, r.t, 0.6, [j]);
    expect(simu.diagnostic().calculsChamp).toBeGreaterThan(avant);
  });
});

describe("griffe", () => {
  it("arme 0,4 s puis donne les dégâts, recharge 1,0 s, puis recommence", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(3), [COUR[0] + 1, COUR[1]], CHASSE, 0)!; // 1 m du joueur
    const j = joueur("j1", ...COUR);
    const { evenements } = courir(simu, 0, 4, [j]);
    const armees = evenements.filter((e) => e.t === "griffeArmee");
    const donnees = evenements.filter((e) => e.t === "griffe") as Extract<(typeof evenements)[number], { t: "griffe" }>[];
    expect(armees.length).toBeGreaterThanOrEqual(2);
    expect(armees[0]).toMatchObject({ tigre: id, joueur: "j1" });
    expect(armees[0].t0).toBeGreaterThanOrEqual(ZOMBIES.apparitionMs - 20);
    expect(donnees[0]).toMatchObject({ tigre: id, joueur: "j1", degats: 50 });
    expect(donnees[0].t0 - armees[0].t0).toBeGreaterThanOrEqual(ZOMBIES.griffeArmeS * 1000 - 20);
    expect(donnees[0].t0 - armees[0].t0).toBeLessThan(ZOMBIES.griffeArmeS * 1000 + 60);
    expect(armees[1].t0 - donnees[0].t0).toBeGreaterThanOrEqual(ZOMBIES.griffeRechargeS * 1000 - 20);
    expect(armees[1].t0 - donnees[0].t0).toBeLessThan(ZOMBIES.griffeRechargeS * 1000 + 60);
    expect(dist(simu.zombie(id)!.p, j.p)).toBeLessThan(2.2);
  });

  it("dégâts de la spec (chef 80) et drapeau « griffe armée » du snap", () => {
    const { simu } = neuf();
    simu.apparaitre(spec(10, 2, 1), [COUR[0] + 1.5, COUR[1]], CHASSE, 0);
    const j = joueur("j1", ...COUR);
    let drapeau = false;
    const r = courir(simu, 0, 2, [j], () => { if (decoderZombies(simu.snap())[0].griffe) drapeau = true; });
    expect(drapeau).toBe(true);
    expect((r.evenements.find((e) => e.t === "griffe") as { degats: number }).degats).toBe(80);
  });

  it("un tigre loin ne frappe pas ; un joueur qui s'écarte pendant l'armement n'est pas touché", () => {
    const { simu } = neuf();
    simu.apparaitre(spec(1), [COUR[0] + 13, COUR[1]], CHASSE, 0);
    expect(courir(simu, 0, 1, [joueur("j1", ...COUR)]).evenements).toEqual([]);
    const s2 = neuf();
    s2.simu.apparaitre(spec(1), [COUR[0] + 1, COUR[1]], CHASSE, 0);
    const j = joueur("j1", ...COUR);
    let armee = false;
    const { evenements } = courir(s2.simu, 0, 1.7, [j], () => {
      if (!armee && s2.simu.liste()[0].armeFin > 0) { armee = true; j.p = [COUR[0] - 6, 0, COUR[1]]; }
    });
    expect(armee).toBe(true);
    expect(evenements.filter((e) => e.t === "griffe")).toEqual([]);
    expect(s2.simu.liste()[0].armeFin).toBe(0);
  });

  it("un mur fin entre le tigre et le joueur arrête la griffe (pas de ligne de vue)", () => {
    const mur = { h: 10, r: [[-0.15, -30], [0.15, -30], [0.15, 30], [-0.15, 30]] as [number, number][], c: [0, 0] as [number, number] };
    const ancre = (x: number, z: number) => ({ h: 5, r: [[x, z], [x + 1, z], [x + 1, z + 1]] as [number, number][], c: [x, z] as [number, number] });
    const monde = construireMonde({ ...scene, buildings: [ancre(-30, -30), ancre(30, 30), mur], pois: [] } as SceneData);
    const simu = creerSimuZombies({ monde, alea: moitie });
    simu.apparaitre(spec(1), [-0.9, 0], CHASSE, 0);
    const j = joueur("j1", 0.9, 0);
    expect(courir(simu, 0, 3, [j]).evenements.filter((e) => e.t !== "bloque")).toEqual([]);
    const libre = construireMonde({ ...scene, buildings: [ancre(-30, -30), ancre(30, 30)], pois: [] } as SceneData);
    const s2 = creerSimuZombies({ monde: libre, alea: moitie });
    s2.apparaitre(spec(1), [-0.9, 0], CHASSE, 0);
    expect(courir(s2, 0, 3, [j]).evenements.some((e) => e.t === "griffe")).toBe(true);
  });

  it("touchePatte : le balayage de la patte est un segment de l'axe du tigre, à l'échelle du type", () => {
    const z = { p: [0, 0, 0] as Vec3, cap: 0, echelle: 2.7 }; // avant = −z
    const r = ZOMBIES.griffeRayonM + ZOMBIES.griffeRayonPatte * 2.7;
    expect(touchePatte(z, [0, 0, -1.2])).toBe(true);
    expect(touchePatte(z, [r - 0.05, 0, -1.0])).toBe(true);
    expect(touchePatte(z, [r + 0.05, 0, -1.0])).toBe(false); // un pas de côté
    expect(touchePatte(z, [0, 0, -(0.5 * 2.7 + r + 0.05)])).toBe(false); // un pas en arrière
    expect(touchePatte(z, [0, 0, 1.5])).toBe(false); // dans le dos
    expect(touchePatte(z, [0, 0, -(0.5 * 2.7 + r + 0.5)], 1)).toBe(true); // à la fenêtre, la patte passe entre les planches
    expect(porteePatte(2.7)).toBeCloseTo(0.5 * 2.7 + r, 9);
    // le chef frappe plus loin, le petit moins
    expect(porteePatte(3.4)).toBeGreaterThan(porteePatte(2.7));
    expect(porteePatte(1.5)).toBeLessThan(porteePatte(2.7));
  });

  it("esquive : immobile devant le tigre on est touché ; un pas de côté ou en arrière pendant l'armement, la patte frappe dans le vide", () => {
    const essai = (bouge: ((j: JoueurZombie, z: { p: Vec3; cap: number }) => void) | null) => {
      const { simu } = neuf();
      simu.apparaitre(spec(1), [COUR[0] + 1.4, COUR[1]], CHASSE, 0);
      const j = joueur("j1", ...COUR);
      let arme = false;
      const { evenements } = courir(simu, 0, 1.6, [j], () => {
        const z = simu.liste()[0];
        if (!arme && z.armeFin > 0) { arme = true; bouge?.(j, z); }
      });
      expect(arme).toBe(true);
      return evenements.filter((e) => e.t === "griffe").length;
    };
    expect(essai(null)).toBe(1);
    // pas de côté de 1,3 m (perpendiculaire à l'axe du tigre)
    expect(essai((j, z) => { const [fx, fz] = [-Math.sin(z.cap), -Math.cos(z.cap)]; j.p = [j.p[0] - fz * 1.3, 0, j.p[2] + fx * 1.3]; })).toBe(0);
    // pas en arrière de 1,2 m
    expect(essai((j, z) => { const [fx, fz] = [-Math.sin(z.cap), -Math.cos(z.cap)]; j.p = [j.p[0] + fx * 1.2, 0, j.p[2] + fz * 1.2]; })).toBe(0);
  });

  it("griffe jugée en faveur du joueur : un aller-retour plus tard, il doit encore être dans le balayage (délai borné à 200 ms)", () => {
    /** `delaiMs` du joueur ; `bouge` appelé `apresMs` après la fin de l'armement. Renvoie les griffes et l'instant de la première. */
    const essai = (delaiMs: number, apresMs: number | null) => {
      const { simu } = neuf();
      simu.apparaitre(spec(1), [COUR[0] + 1.4, COUR[1]], CHASSE, 0);
      const j: JoueurZombie = { ...joueur("j1", ...COUR), delaiMs };
      let finArmement = 0, bouge = false;
      const { evenements } = courir(simu, 0, 1.8, [j], (t) => {
        const z = simu.liste()[0];
        if (!finArmement && z.armeFin > 0) finArmement = z.armeFin;
        if (finArmement && apresMs !== null && !bouge && t >= finArmement + apresMs) {
          bouge = true;
          const [fx, fz] = [-Math.sin(z.cap), -Math.cos(z.cap)];
          j.p = [j.p[0] - fz * 1.3, 0, j.p[2] + fx * 1.3]; // pas de côté
        }
      });
      const griffes = evenements.filter((e) => e.t === "griffe");
      return { n: griffes.length, retard: griffes.length ? griffes[0].t0 - finArmement : null };
    };
    // immobile : touché, mais seulement un aller-retour après la fin de l'armement (borné à 200 ms)
    expect(essai(120, null).n).toBe(1);
    expect(essai(120, null).retard).toBeGreaterThanOrEqual(120);
    expect(essai(120, null).retard).toBeLessThan(120 + 40);
    expect(essai(900, null).retard).toBeLessThan(GRIFFE_DELAI_MAX_MS + 40);
    // l'esquive vue par le client arrive au serveur après la fin de l'armement : elle compte encore
    expect(essai(150, 60).n).toBe(0);
    // trop tard : le second jugement est passé
    expect(essai(150, 400).n).toBe(1);
    // sans latence, le jugement reste immédiat
    expect(essai(0, null).retard).toBeLessThan(20);
  });

  it("pendant l'armement le tigre ne tourne qu'à 0,6 rad/s : on peut le contourner", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(1), [COUR[0] + 1.4, COUR[1]], CHASSE, 0)!;
    const z = simu.zombie(id)!;
    const j = joueur("j1", ...COUR);
    let prec: number | null = null;
    let armees = 0;
    courir(simu, 0, 1.5, [j], () => {
      if (z.armeFin > 0) {
        armees++;
        // le joueur tourne autour du tigre
        const a = Math.atan2(j.p[2] - z.p[2], j.p[0] - z.p[0]) + 0.08;
        j.p = [z.p[0] + Math.cos(a) * 1.3, 0, z.p[2] + Math.sin(a) * 1.3];
        if (prec !== null) expect(Math.abs(Math.atan2(Math.sin(z.cap - prec), Math.cos(z.cap - prec)))).toBeLessThanOrEqual(ZOMBIES.griffeRotationMax * DT + 1e-9);
        prec = z.cap;
      } else prec = null;
    });
    expect(armees).toBeGreaterThan(5);
  });

  it("griffe les joueurs debout seulement, le plus proche", () => {
    const { simu } = neuf();
    simu.apparaitre(spec(1), [COUR[0] + 1, COUR[1]], CHASSE, 0);
    const { evenements } = courir(simu, 0, 1.5, [joueur("a", ...COUR, false), joueur("b", COUR[0] + 9, COUR[1]), joueur("c", COUR[0] + 0.4, COUR[1] + 0.5)]);
    expect(evenements.find((x) => x.t === "griffeArmee")!.joueur).toBe("c");
  });
});

describe("toucheZombie", () => {
  const tigreFixe = () => {
    const s = neuf();
    const id = s.simu.apparaitre(spec(1), [130, -62], CHASSE, 0, 0)!;
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
    expect(simu.toucheZombie(id, oC, vers(oC, [c[0], c[1], c[2] + 4]), 50, 0)).toBeNull();
    expect(simu.toucheZombie(id, oC, vers(oC, c), 5, 0)).toBeNull();
    expect(simu.toucheZombie(999, oC, vers(oC, c), 50, 0)).toBeNull();
    // le chef (3,4) est plus gros que le tigre (2,7), le petit (1,5) plus petit
    const g = neuf();
    const gid = g.simu.apparaitre(spec(10, 2), [130, -62], CHASSE, 0, 0)!;
    const gc = corps(g.simu.zombie(gid)!);
    expect(g.simu.toucheZombie(gid, [gc[0] - 12, gc[1], gc[2]], vers([gc[0] - 12, gc[1], gc[2]], gc), 50, 0)).not.toBeNull();
    const p = neuf();
    const pid = p.simu.apparaitre(spec(10, 3, 2), [130, -62], CHASSE, 0, 0)!;
    const pc = corps(p.simu.zombie(pid)!);
    const o: Vec3 = [pc[0] - 10, pc[1], pc[2]];
    expect(p.simu.toucheZombie(pid, o, vers(o, pc), 50, 0)).not.toBeNull();
    expect(p.simu.toucheZombie(pid, o, vers(o, [pc[0], pc[1] + 1.2, pc[2]]), 50, 0)).toBeNull();
  });

  it("marge de 0,25 m comprise", () => {
    const { simu, id, z } = tigreFixe();
    const c = corps(z);
    const o: Vec3 = [c[0] - 10, c[1], c[2]];
    expect(simu.toucheZombie(id, o, vers(o, [c[0], c[1], c[2] + 0.5]), 50, 0)).not.toBeNull();
    expect(simu.toucheZombie(id, o, vers(o, [c[0], c[1] + 0.9, c[2]]), 50, 0)).toBeNull();
  });

  it("rayon arrêté par une porte fermée, pas par une fenêtre", () => {
    const { simu, monde } = neuf();
    // tigre dans la cour, tireur dans l'open space : la porte D2 (fermée) est entre eux
    const d2 = fenetreDeId("N2c")!; // (repère de la cour)
    void d2;
    const id = simu.apparaitre(spec(1), [120, -38], CHASSE, 0, 0)!;
    const c = corps(simu.zombie(id)!);
    const o: Vec3 = [120.2, c[1], -28];
    const d = vers(o, c);
    expect(lancerRayon(monde, o, d, 60)).toBeLessThan(Math.hypot(c[0] - o[0], c[2] - o[2]));
    expect(simu.toucheZombie(id, o, d, 80, 0)).toBeNull();
    // à travers N2c (fenêtre) : le tigre de l'autre côté est touché
    const f = fenetreDeId("N2c")!;
    const s2 = neuf();
    const n2 = s2.simu.apparaitre(spec(1), f.dehors, CHASSE, 0, 0)!;
    const cz = corps(s2.simu.zombie(n2)!);
    const o2: Vec3 = [f.dedans[0] + f.normale[0] * 8, cz[1], f.dedans[1] + f.normale[1] * 8];
    expect(s2.simu.toucheZombie(n2, o2, vers(o2, cz), 40, 0)).not.toBeNull();
  });

  it("rejeu de latence : la position d'il y a ≤ 300 ms est touchable, celle d'il y a plus longtemps non", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(1, 0, 1), [128, -60], CHASSE, 0, 0)!;
    const z = simu.zombie(id)!;
    const j = joueur("j1", 128, -40); // plein sud : le tigre avance en ligne droite
    simu.tic(DT * 1000, DT, [j]);
    const ancienne = { p: [...z.p] as Vec3, cap: z.cap, echelle: z.echelle };
    const f = [-Math.sin(ancienne.cap), -Math.cos(ancienne.cap)];
    const croupe = pointLocal([ancienne.p[0], 0, ancienne.p[2]], ancienne.cap, ancienne.echelle, 0, 0.33, -0.21);
    const o: Vec3 = [croupe[0] - f[0] * 10, croupe[1], croupe[2] - f[1] * 10];
    const d: Vec3 = [f[0], 0, f[1]];
    const portee = 10 - 0.297 - 0.25 + 0.15;
    const r1 = courir(simu, DT * 1000, 0.25, [j]); // 250 ms : ≈ 1,5 m plus loin
    expect(dist(z.p, ancienne.p)).toBeGreaterThan(0.9);
    const hit = simu.toucheZombie(id, o, d, portee, r1.t);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeLessThanOrEqual(portee);
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
    const id = simu.apparaitre(spec(1), [130, -62], CHASSE, 0, 0)!;
    const z = simu.zombie(id)!;
    const c = cote(z, -0.03);
    const o: Vec3 = [c[0] - 2, c[1], c[2]];
    const hit = simu.toucheMelee(id, o, mis(o, c), 2.2, COS_COUTEAU, 0)!;
    expect(hit.distance).toBeCloseTo(2 - 0.12 * 2.7, 2);
    const loin: Vec3 = [c[0] - 6, c[1], c[2]];
    expect(simu.toucheMelee(id, loin, mis(loin, c), 2.6, COS_EPEE, 0)).toBeNull();
    expect(simu.toucheMelee(id, o, [-1, 0, 0], 2.6, COS_EPEE, 0)).toBeNull();
    const o2: Vec3 = [c[0] - 3, c[1], c[2]];
    const angle = (68 * Math.PI) / 180;
    const d2: Vec3 = [Math.cos(angle), 0, -Math.sin(angle)];
    expect(simu.toucheMelee(id, o2, d2, 4, COS_EPEE, 0)).not.toBeNull();
    expect(simu.toucheMelee(999, o, mis(o, c), 2.6, COS_EPEE, 0)).toBeNull();
  });

  it("l'épée touche plusieurs tigres côte à côte, chacun avec sa distance", () => {
    const { simu } = neuf();
    const ids = [-1.4, 0, 1.4].map((dx) => simu.apparaitre(spec(1), [130 + dx, -62], CHASSE, 0, 0)!);
    const o: Vec3 = [130, 1.0, -62 + 3.2];
    const res = ids.map((id) => simu.toucheMelee(id, o, [0, 0, -1], 3.4, COS_EPEE, 0));
    expect(res.every((r) => r !== null)).toBe(true);
    for (const r of res) expect(r!.distance).toBeLessThanOrEqual(3.4);
  });

  it("ligne de vue : un mur entre le joueur et le tigre arrête le coup", () => {
    const mur = { h: 10, r: [[-0.15, -30], [0.15, -30], [0.15, 30], [-0.15, 30]] as [number, number][], c: [0, 0] as [number, number] };
    const ancre = (x: number, z: number) => ({ h: 5, r: [[x, z], [x + 1, z], [x + 1, z + 1]] as [number, number][], c: [x, z] as [number, number] });
    const monde = construireMonde({ ...scene, buildings: [ancre(-30, -30), ancre(30, 30), mur], pois: [] } as SceneData);
    const simu = creerSimuZombies({ monde, alea: moitie });
    const id = simu.apparaitre(spec(1), [-1.2, 0], CHASSE, 0, Math.PI / 2)!;
    const c = cote(simu.zombie(id)!, -0.03);
    const o: Vec3 = [0.8, 1, 0];
    expect(simu.toucheMelee(id, o, mis(o, c), 6, COS_EPEE, 0)).toBeNull();
  });

  it("rejeu de 200 ms", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(1, 0, 1), [126, -70], CHASSE, 0, 0)!;
    const z = simu.zombie(id)!;
    const j = joueur("j1", 126, -40);
    simu.tic(DT * 1000, DT, [j]);
    const f = [-Math.sin(z.cap), -Math.cos(z.cap)];
    const centre0: Vec3 = [z.p[0], 0, z.p[2]];
    const croupe = pointLocal(centre0, z.cap, z.echelle, 0, 0.33, -0.21);
    const o: Vec3 = [croupe[0] - f[0] * (0.297 + 1.0), croupe[1], croupe[2] - f[1] * (0.297 + 1.0)];
    const d: Vec3 = [f[0], 0, f[1]];
    const r = courir(simu, DT * 1000, 0.15, [j]);
    expect(dist(z.p, centre0)).toBeGreaterThan(0.5);
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
    const id = simu.apparaitre(spec(1), [130, -62], CHASSE, 0)!; // 150 PV
    expect(simu.blesser(id, 30, 0)).toEqual({ mort: false, pvPct: 80, type: 0 });
    expect(simu.zombie(id)!.pv).toBe(120);
    expect(simu.blesser(id, 119.4, 0).pvPct).toBe(1); // vivant : au moins 1 %
    const fin = simu.blesser(id, 10, 0);
    expect(fin).toMatchObject({ mort: true, pvPct: 0, type: 0 });
    expect(fin.p).toEqual([130, 0, -62]);
    expect(simu.zombie(id)).toBeUndefined();
    expect(simu.nbVivants()).toBe(0);
    expect(simu.blesser(id, 10, 0)).toEqual({ mort: false, pvPct: 0 });
  });

  it("des dégâts négatifs ne soignent pas", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(1), [130, -62], CHASSE, 0)!;
    simu.blesser(id, -50, 0);
    expect(simu.zombie(id)!.pv).toBe(150);
  });

  it("snap : stride 6, restants, positions au centimètre, type, PV, allure, mode, apparition, Truck", () => {
    const { simu } = neuf();
    const f = fenetreDeId("N2c")!;
    const a = simu.apparaitre(spec(1), [130.123, -62.456], CHASSE, 1000, 0.5)!;
    const b = simu.apparaitre(spec(10, 2, 1), f.points[0], { mode: "fenetre", fenetre: f }, 1000)!;
    const c = simu.apparaitre(spec(6, 3, 2), [124, -60], { mode: "sol" }, 1000)!;
    simu.blesser(b, pvZombie(10, 2) / 2, 1000);
    const s = simu.snap(7, 1100);
    expect(s.r).toBe(7);
    expect(s.t).toBeUndefined();
    expect(s.z).toHaveLength(3 * PAS_SNAP_ZOMBIE);
    expect(s.z.every(Number.isInteger)).toBe(true);
    const d = decoderZombies(s);
    expect(d[0]).toMatchObject({ id: a, type: 0, griffe: false, apparition: true, pvPct: 100, allure: 0, mode: "chasse" });
    expect(d[0].x).toBeCloseTo(130.12, 2);
    expect(d[0].z).toBeCloseTo(-62.46, 2);
    expect(d[0].cap).toBeCloseTo(0.5, 3);
    expect(d[1]).toMatchObject({ id: b, type: 2, pvPct: 50, allure: 1, mode: "fenetre" });
    expect(d[2]).toMatchObject({ id: c, type: 3, allure: 2, mode: "sol" });
    expect(decoderZombies(simu.snap(2, 1000 + ZOMBIES.apparitionMs + 10))[0].apparition).toBe(false);
    expect(simu.snap().r).toBe(3);
    expect(simu.snap(0, 1100, [1, 2, 3]).t).toEqual([1, 2, 3]);
  });
});

describe("performance", () => {
  it("24 tigres, 8 joueurs : moins de 2 ms par tic en moyenne", () => {
    const { simu } = neuf();
    const joueurs = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => joueur(`j${k}`, 132 + (k % 4) * 3, -48 - Math.floor(k / 4) * 3));
    for (let k = 0; k < 24; k++) simu.apparaitre(spec(5, k % 3 === 2 ? 1 : 0, 1), [118 + (k % 6) * 2, -66 - Math.floor(k / 6) * 2], CHASSE, 0);
    const r0 = courir(simu, 0, 3, joueurs);
    const n = 200;
    let t = r0.t;
    let moyenne = Infinity;
    for (let lot = 0; lot < 3; lot++) {
      const t0 = performance.now();
      t = courir(simu, t, n / 60, joueurs).t;
      moyenne = Math.min(moyenne, (performance.now() - t0) / n);
    }
    expect(moyenne).toBeLessThan(2);
    let x = 0;
    let moyenne2 = Infinity;
    for (let lot = 0; lot < 3; lot++) {
      const t1 = performance.now();
      t = courir(simu, t, n / 60, joueurs, () => { x += 0.15; joueurs[0].p = [120 + (x % 25), 0, -50]; joueurs[1].p = [145 - (x % 25), 0, -56]; }).t;
      moyenne2 = Math.min(moyenne2, (performance.now() - t1) / n);
    }
    expect(moyenne2).toBeLessThan(2);
  }, 30_000);
});

describe("formes", () => {
  it("la forme du tigre est celle de monstres.ts (8 sphères dont une tête)", () => {
    expect(FORME_TIGRE.filter((s) => s.zone === "tete")).toHaveLength(1);
    expect(FORME_TIGRE).toHaveLength(8);
  });
});

describe("leurres (tigre à remontoir, v8)", () => {
  /** Fait tourner la simulation avec des leurres ; renvoie les événements. */
  function courirLeurres(simu: ReturnType<typeof creerSimuZombies>, t0: number, secondes: number, joueurs: JoueurZombie[], leurres: Leurre[]) {
    const evenements: EvenementZombie[] = [];
    let t = t0;
    for (let k = 0; k < Math.round(secondes * 60); k++) {
      t += DT * 1000;
      evenements.push(...simu.tic(t, DT, joueurs, leurres));
    }
    return { t, evenements };
  }

  it("un tigre à portée court au leurre plutôt qu'au joueur collé à lui, ne griffe pas, et l'entoure", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(1, 0, 1), COUR, CHASSE, 0)!;
    const moi = joueur("a", COUR[0] + 1, COUR[1]);
    const leurre: Leurre = { id: 1, p: [COUR[0] - 6, 0.15, COUR[1]], rayon: 40 };
    const { t, evenements } = courirLeurres(simu, 1_000, 5, [moi], [leurre]);
    expect(evenements.filter((e) => e.t === "griffeArmee" || e.t === "griffe")).toEqual([]);
    expect(dist(simu.zombie(id)!.p, leurre.p)).toBeLessThanOrEqual(DISTANCE_LEURRE_M + 0.6);
    // le leurre saute : le tigre revient au joueur et le griffe
    const apres = courirLeurres(simu, t, 6, [moi], []);
    expect(apres.evenements.some((e) => e.t === "griffeArmee")).toBe(true);
  });

  it("un coup de patte abandonné pour un leurre pendant son jugement différé ne fausse pas le délai du coup suivant", () => {
    const { simu } = neuf();
    simu.apparaitre(spec(1), [COUR[0] + 1.4, COUR[1]], CHASSE, 0);
    const j: JoueurZombie = { ...joueur("j1", ...COUR), delaiMs: 150 };
    // leurre posé aux pieds du joueur : le tigre, déjà à 1,4 m, reste sur place, tourné vers le joueur
    const leurre: Leurre = { id: 1, p: [COUR[0], 0.15, COUR[1]], rayon: 40 };
    const armements: number[] = [];
    const griffes: number[] = [];
    let premier = 0, t = 0;
    for (let k = 0; k < 8 * 60; k++) {
      t += DT * 1000;
      // le leurre est posé 20 ms après la fin du premier armement (pendant le jugement différé) et saute 0,8 s plus tard
      const leurres = premier && t >= premier + 20 && t < premier + 820 ? [leurre] : [];
      for (const e of simu.tic(t, DT, [j], leurres)) if (e.t === "griffe") griffes.push(t);
      const z = simu.liste()[0];
      if (z.armeFin > 0 && armements[armements.length - 1] !== z.armeFin) armements.push(z.armeFin);
      if (!premier && armements.length) premier = armements[0];
    }
    expect(armements.length).toBeGreaterThanOrEqual(2);
    // le premier coup a été abandonné ; chaque coup suivant est jugé un aller-retour après la fin de son armement
    expect(griffes.length).toBeGreaterThanOrEqual(1);
    expect(griffes[0]).toBeGreaterThan(armements[1]);
    for (const g of griffes) {
      const a = armements.filter((x) => x <= g).pop()!;
      expect(g - a).toBeGreaterThanOrEqual(150);
      expect(g - a).toBeLessThan(150 + 40);
    }
  });

  it("hors de portée du leurre, le tigre chasse toujours les joueurs", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(1, 0, 1), COUR, CHASSE, 0)!;
    const moi = joueur("a", COUR[0] + 2, COUR[1]);
    const leurre: Leurre = { id: 1, p: [COUR[0] - 6, 0.15, COUR[1]], rayon: 3 };
    const { evenements } = courirLeurres(simu, 1_000, 4, [moi], [leurre]);
    expect(evenements.some((e) => e.t === "griffeArmee")).toBe(true);
    expect(dist(simu.zombie(id)!.p, moi.p)).toBeLessThan(dist(simu.zombie(id)!.p, leurre.p));
  });
});

// =================================================================================================
describe("(v8) ennemis des manches du Truck Muche : petits vénères et mini Trucks explosifs", () => {
  it("la morsure d'un petit tombe 0,22 s après son armement, deux morsures sont espacées de l'armement plus 0,45 s de recharge", () => {
    const { simu } = neuf();
    simu.apparaitre(spec(5, 3, 2), [COUR[0] + 0.9, COUR[1]], CHASSE, 0);
    const j = joueur("j1", ...COUR);
    const { evenements } = courir(simu, 0, 3, [j]);
    const armees = evenements.filter((e) => e.t === "griffeArmee");
    const morsures = evenements.filter((e) => e.t === "griffe");
    expect(morsures.length).toBeGreaterThanOrEqual(3);
    const tic = DT * 1000;
    expect(morsures[0].t0 - armees[0].t0).toBeGreaterThanOrEqual(ZOMBIES.morsureArmeS * 1000 - 1);
    expect(morsures[0].t0 - armees[0].t0).toBeLessThanOrEqual(ZOMBIES.morsureArmeS * 1000 + tic + 1);
    const ecart = armees[1].t0 - armees[0].t0;
    expect(ecart).toBeGreaterThanOrEqual((ZOMBIES.morsureArmeS + ZOMBIES.morsureRechargeS) * 1000 - 1);
    expect(ecart).toBeLessThanOrEqual((ZOMBIES.morsureArmeS + ZOMBIES.morsureRechargeS) * 1000 + 2 * tic + 1);
    // ≈ 1,5 morsure par seconde
    expect((morsures.length - 1) / ((morsures[morsures.length - 1].t0 - morsures[0].t0) / 1000)).toBeGreaterThan(1.4);
  });

  it("un petit rattrape un joueur qui sprinte (13,5 m/s contre 12,5) et vire sec", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(5, 3, 2), [118, -70], CHASSE, 0)!;
    const z = simu.zombie(id)!;
    let vmax = 0, dernier: Vec3 = [...z.p];
    courir(simu, 0, 2, [joueur("j1", 160, -40)], () => { vmax = Math.max(vmax, dist(z.p, dernier) / DT); dernier = [...z.p]; });
    expect(vmax).toBeGreaterThan(12.5);
    expect(vmax).toBeLessThan(13.5 * 1.07);
  });

  it("un mini Truck fonce sur le joueur, allume sa mèche au contact (drapeau du snap) puis saute une seule fois, sans griffer", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(5, 4, 2), [COUR[0] + 14, COUR[1]], CHASSE, 0)!;
    expect(simu.zombie(id)).toMatchObject({ echelle: 3, vitesse: 14, degats: 0 });
    const j = joueur("j1", ...COUR);
    let drapeau = false;
    const { evenements } = courir(simu, 0, 4, [j], () => { const d = decoderZombies(simu.snap()); if (d[0]?.type === 4 && d[0].griffe) drapeau = true; });
    expect(drapeau).toBe(true);
    expect(evenements.some((e) => e.t === "griffe" || e.t === "griffeArmee")).toBe(false);
    const meche = evenements.find((e) => e.t === "meche")!;
    const explose = evenements.filter((e) => e.t === "explose");
    expect(meche).toMatchObject({ tigre: id, joueur: "j1" });
    expect(explose).toHaveLength(1);
    expect(explose[0].t0 - meche.t0).toBeLessThanOrEqual(ZOMBIES.miniTruck.mecheS * 1000 + DT * 1000 + 1);
    // il saute près du joueur (le simulateur ne le retire pas : c'est le service qui applique le souffle)
    expect(dist((explose[0] as { p: Vec3 }).p, j.p)).toBeLessThan(ZOMBIES.miniTruck.contactM + 0.5);
  });

  it("un mini Truck vire mal (2,5 rad/s) et ne ralentit pas dans les virages : il fonce, on le prend de côté", () => {
    const { simu } = neuf();
    // il part vers −x, le joueur est sur son flanc
    const id = simu.apparaitre(spec(5, 4, 2), [COUR[0] + 8, COUR[1]], CHASSE, 0, Math.PI / 2)!;
    const z = simu.zombie(id)!;
    courir(simu, 0, DT, [joueur("j1", COUR[0] + 20, COUR[1])]); // pose d'apparition
    z.cap = Math.PI / 2;
    const j = joueur("j1", COUR[0] + 4, COUR[1] - 12);
    let cap = z.cap, p: Vec3 = [...z.p], vmin = Infinity;
    courir(simu, 0, 0.5, [j], () => {
      expect(Math.abs(enrouler(z.cap - cap))).toBeLessThanOrEqual(ZOMBIES.miniTruck.rotation * DT + 1e-9);
      vmin = Math.min(vmin, dist(z.p, p) / DT);
      cap = z.cap; p = [...z.p];
    });
    expect(vmin).toBeGreaterThan(ZOMBIES.miniTruck.vitesse * 0.9);
  });

  it("forme de touche du mini Truck : cabine (tête) à l'avant, caisse derrière, rien au-dessus d'un mètre", () => {
    const { simu } = neuf();
    const id = simu.apparaitre(spec(5, 4, 2), COUR, CHASSE, 0, 0)!;
    // avant = −z : la cabine est vers −z
    expect(simu.toucheZombie(id, [COUR[0], 0.45, COUR[1] - 6], [0, 0, 1], 20, 0)?.zone).toBe("tete");
    expect(simu.toucheZombie(id, [COUR[0], 0.5, COUR[1] + 6], [0, 0, -1], 20, 0)?.zone).toBe("corps");
    expect(simu.toucheZombie(id, [COUR[0], 1.6, COUR[1] + 6], [0, 0, -1], 20, 0)).toBeNull();
  });

  it("séparation par type : les petits se serrent (0,9 m), les mini Trucks s'écartent (1,8 m)", () => {
    for (const [type, sep] of [[3, ZOMBIES.separationPetitM], [4, ZOMBIES.miniTruck.separationM]] as const) {
      const { simu } = neuf();
      const a = simu.apparaitre(spec(5, type, 2), [COUR[0], COUR[1]], CHASSE, 0)!;
      const b = simu.apparaitre(spec(5, type, 2), [COUR[0] + 0.1, COUR[1]], CHASSE, 0)!;
      courir(simu, 0, 0.05, [joueur("j1", COUR[0] + 40, COUR[1] + 20)]);
      const d = dist(simu.zombie(a)!.p, simu.zombie(b)!.p);
      expect(d).toBeGreaterThan(sep * 0.85);
      expect(d).toBeLessThan(sep * 1.6);
    }
  });

  it("snap : le type 4 (mini Truck) passe par le bit 8 des drapeaux", () => {
    const { simu } = neuf();
    simu.apparaitre(spec(5, 4, 2), COUR, CHASSE, 0);
    simu.apparaitre(spec(5, 3, 2), [COUR[0] + 5, COUR[1]], CHASSE, 0);
    const s = simu.snap(2, 10);
    expect(s.z[4] & 3).toBe(0);
    expect((s.z[4] >> 8) & 1).toBe(1);
    expect(decoderZombies(s).map((z) => z.type)).toEqual([4, 3]);
  });
});
