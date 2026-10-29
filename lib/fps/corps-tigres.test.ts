import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde, distanceCapsule, type Capsule, type ContactCapsule, type Monde } from "./collision";
import { CORPS_TIGRE, CorpsTigres, capsuleTigre, corpsSolide, type CorpsTigre } from "./corps-tigres";
import { MOUV, etape, etatInitial, type Entrees, type EtatMouvement } from "./mouvement";
import type { Vec3 } from "./protocole";
import { creerSimuZombies, porteePatte, type JoueurZombie, type SpecZombie } from "./zombies";
import { construireMondeZombies } from "./zombies-carte";
import { ZOMBIES, degatsGriffe, echelleZombie, pvZombie, rechargeGriffe, vitesseAllure, type TypeZombie } from "./zombies-vagues";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const DT = 1 / 60;
const R = MOUV.rayon;
const contact: ContactCapsule = { d: 0, nx: 0, nz: 0 };
const dist = (c: Capsule, x: number, z: number) => distanceCapsule(c, x, z, contact).d;

function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
/** Monde réduit : deux petits bâtiments lointains élargissent les bornes à ±275 m. */
function mondeDe(...batiments: Building[]): Monde {
  const coins = [rect(-250, -250, -249, -249, 3), rect(249, 249, 250, 250, 3)];
  return construireMonde({ ...scene, buildings: [...coins, ...batiments], pois: [] });
}
/** Lacet dont l'avant (−sin, −cos) pointe vers (fx, fz). */
const lacetVers = (fx: number, fz: number): number => Math.atan2(-fx, -fz);
const tigre = (x: number, z: number, cap: number, type: TypeZombie = 0, extra: Partial<CorpsTigre> = {}): CorpsTigre =>
  ({ x, z, cap, echelle: echelleZombie(type), mode: "chasse", ...extra });

function avancer(e: EtatMouvement, secondes: number, en: Entrees, m: Monde, obs: readonly Capsule[], surPas?: (e: EtatMouvement) => void, dt = DT): EtatMouvement {
  const n = Math.round(secondes / dt);
  for (let k = 0; k < n; k++) { e = etape(e, en, dt, m, 1, obs); surPas?.(e); }
  return e;
}
const etatA = (p: Vec3, v: Vec3 = [0, 0, 0]): EtatMouvement => ({ ...etatInitial(p), v });

describe("capsule du corps d'un tigre", () => {
  it("sur l'axe du cap, tête exclue : de −0,335 à +0,315 × l'échelle, rayon 0,115 × l'échelle (au moins 0,31 m), dos à 0,45 × l'échelle", () => {
    const e = ZOMBIES.echelle;
    // cap 0 : avant = −z
    const c = capsuleTigre(tigre(10, 20, 0));
    expect(c.r).toBeCloseTo(Math.max(0.115 * e, 0.31), 9);
    expect(c.ax).toBeCloseTo(10, 9);
    expect(c.bx).toBeCloseTo(10, 9);
    expect(c.bz - c.r).toBeCloseTo(20 - 0.315 * e, 9); // poitrail
    expect(c.az + c.r).toBeCloseTo(20 + 0.335 * e, 9); // croupe
    expect(c.haut).toBeCloseTo(0.45 * e, 9);
    // cap π/2 : avant = −x
    const d = capsuleTigre(tigre(0, 0, Math.PI / 2));
    expect(d.bx - d.r).toBeCloseTo(-0.315 * e, 9);
    expect(d.az).toBeCloseTo(0, 9);
    expect(d.bz).toBeCloseTo(0, 9);
  });

  it("selon le type : normal ≈ 0,31 m de rayon, chef plus gros, petit au rayon minimal (un groupe de petits ferme un passage) et bas", () => {
    const normal = capsuleTigre(tigre(0, 0, 0, 0)), chef = capsuleTigre(tigre(0, 0, 0, 2)), petit = capsuleTigre(tigre(0, 0, 0, 3));
    expect(normal.r).toBeCloseTo(0.3105, 3);
    expect(chef.r).toBeCloseTo(0.115 * ZOMBIES.echelleBrute, 9);
    expect(petit.r).toBe(CORPS_TIGRE.rayonMinM);
    // le rayon minimal ne rallonge pas le petit : poitrail toujours à 0,315 × 1,5
    expect(-(petit.bz - petit.r)).toBeCloseTo(0.315 * ZOMBIES.echellePetit, 9);
    expect(petit.haut).toBeLessThan(0.7);
    expect(normal.haut).toBeGreaterThan(1.2);
    // un tigre qui rampe est plus bas
    expect(capsuleTigre(tigre(0, 0, 0, 0, { allure: 3 })).haut).toBeCloseTo(normal.haut * CORPS_TIGRE.hautRampant, 9);
  });

  it("seuls les tigres vivants en chasse sont solides (ni sortie du sol, ni saut, ni fenêtre, ni approche, ni mort)", () => {
    expect(corpsSolide(tigre(0, 0, 0))).toBe(true);
    expect(corpsSolide({ x: 0, z: 0, cap: 0, echelle: 2.7 })).toBe(true);
    for (const mode of ["sol", "saut", "fenetre", "approche"] as const) expect(corpsSolide(tigre(0, 0, 0, 0, { mode }))).toBe(false);
    expect(corpsSolide(tigre(0, 0, 0, 0, { pvPct: 0 }))).toBe(false);
    const corps = new CorpsTigres();
    const vues = [tigre(0, 0, 0), tigre(1, 0, 0, 0, { mode: "sol" }), tigre(2, 0, 0, 0, { pvPct: 0 }), tigre(30, 0, 0), tigre(3, 0, 0, 3)];
    expect(corps.maj(vues, vues.length)).toHaveLength(3);
    expect(corps.maj(vues, vues.length, 0, 0, 8)).toHaveLength(2);
    // `n` borne la lecture (tableau stable de l'interpolation) et les objets sont réutilisés
    const premiere = corps.maj(vues, 1)[0];
    expect(corps.maj(vues, 1)[0]).toBe(premiere);
    expect(corps.maj(vues, 0)).toHaveLength(0);
  });

  it("un tigre arrêté à portée de patte ne touche pas le joueur, quel que soit son cap (il ne pousse pas en approche normale)", () => {
    for (const type of [0, 1, 2, 3] as TypeZombie[]) {
      const e = echelleZombie(type);
      const d = porteePatte(e) - ZOMBIES.griffeMargeDepartM;
      for (let deg = 0; deg <= 180; deg += 15) {
        // joueur en (0, −d) ; cap 0 = face au joueur, tourné de `deg`
        const c = capsuleTigre(tigre(0, 0, (deg * Math.PI) / 180, type));
        expect(dist(c, 0, -d), `type ${type}, ${deg}°`).toBeGreaterThan(c.r + R + 0.05);
      }
    }
  });
});

// Mur d'est en ouest (z de −0,2 à 0,2) percé d'une porte de 2,6 m (x de −1,3 à 1,3), comme une porte intérieure de la carte zombies.
const LARGEUR_PORTE = 2.6;
const mondePorte = mondeDe(rect(-30, -0.2, -LARGEUR_PORTE / 2, 0.2, 40), rect(LARGEUR_PORTE / 2, -0.2, 30, 0.2, 40));
/** Marche vers −z depuis (x, 3) pendant 3 s : z final, et vrai si l'anti-coinçage s'est déclenché. */
function traverser(x: number, obs: readonly Capsule[], sprint = false): { z: number; fantome: boolean } {
  let fantome = false;
  const e = avancer(etatA([x, 0, 3]), 3, { avant: 1, droite: 0, saut: false, sprint, lacet: lacetVers(0, -1) }, mondePorte, obs, (s) => {
    if ((s.coince?.fantome ?? 0) > 0) fantome = true;
  });
  return { z: e.p[2], fantome };
}

/** La même porte dans le monde des zombies (sans parkour : sauter contre un montant ne lance pas de course au mur). */
const mondePorteZ: Monde = { ...mondePorte, sansParkour: true };
/** Pas chassé vers −z (regard vers −x, entrée « droite ») depuis (x, 3) pendant 3 s : z final. */
function traverserEnCrabe(x: number, obs: readonly Capsule[]): number {
  return avancer(etatA([x, 0, 3]), 3, { avant: 0, droite: 1, saut: false, sprint: false, lacet: lacetVers(-1, 0) }, mondePorteZ, obs).p[2];
}
/** Saut en courant vers −z, lancé de (x, 2) à 9 m/s : z final après 1,5 s. */
function traverserEnSautant(x: number, obs: readonly Capsule[]): number {
  return avancer(etatA([x, 0, 2], [0, 0, -9]), 1.5, { avant: 1, droite: 0, saut: true, sprint: false, lacet: lacetVers(0, -1) }, mondePorteZ, obs).p[2];
}

describe("porte de 2,6 m (ratio de Black Ops 1)", () => {
  it("sans tigre, on passe", () => {
    expect(traverser(0, []).z).toBeLessThan(-3);
  });

  it("un tigre seul dans la porte (dans l'axe du passage) laisse passer de justesse de chaque côté", () => {
    const corps = [capsuleTigre(tigre(0, 0, 0))];
    expect(traverser(0.82, corps).z).toBeLessThan(-3);
    expect(traverser(-0.82, corps).z).toBeLessThan(-3);
    // un peu décalé : on bute sur le poitrail, on glisse le long et on passe quand même
    expect(traverser(0.55, corps).z).toBeLessThan(-3);
    // de face, on reste devant lui
    expect(traverser(0, corps).z).toBeGreaterThan(0.3);
    // collé à un montant, il ferme ce côté-là (0,19 m entre son flanc et le mur) : seul l'autre côté passe
    const pres = [capsuleTigre(tigre(0.8, 0, 0))];
    for (const x of [0.9, 1.0, 1.1]) expect(traverser(x, pres).z, `x = ${x}`).toBeGreaterThan(0.2);
    expect(traverser(-0.3, pres).z).toBeLessThan(-3);
  });

  it("deux tigres côte à côte (1,4 m d'entraxe) arrêtent qui marche droit, sans que l'anti-coinçage ne les traverse", () => {
    const L = ZOMBIES.separationM;
    const corps = [capsuleTigre(tigre(-L / 2, 0, 0)), capsuleTigre(tigre(L / 2, 0, 0))];
    for (let x = -1.2; x <= 1.2 + 1e-9; x += 0.1) {
      for (const sprint of [false, true]) {
        const r = traverser(x, corps, sprint);
        expect(r.z, `x = ${x.toFixed(1)}`).toBeGreaterThan(0.2);
        expect(r.fantome).toBe(false);
      }
    }
  });

  it("deux tigres côte à côte dans l'axe : on se faufile entre eux en sautant ou en pas chassé (0,78 m entre leurs flancs)", () => {
    const L = ZOMBIES.separationM;
    const corps = [capsuleTigre(tigre(-L / 2, 0, 0)), capsuleTigre(tigre(L / 2, 0, 0))];
    expect(traverserEnCrabe(0, corps)).toBeLessThan(-2.5);
    expect(traverserEnSautant(0, corps)).toBeLessThan(-2.5);
    // mais pas entre un tigre et le montant (0,29 m)
    expect(traverserEnCrabe(-1.15, corps)).toBeGreaterThan(0.2);
    expect(traverserEnSautant(-1.15, corps)).toBeGreaterThan(0.2);
  });

  it("entre un tigre et le montant : on passe en sautant ou en crabe s'il en est à 0,79 m, pas s'il en est à 0,44 m", () => {
    // contre le montant, le joueur garde son rayon de 0,4 m : il faut 0,4 + 0,33 en crabe, 0,4 + 0,26 en l'air, 0,8 en marchant
    const loin = [capsuleTigre(tigre(0.2, 0, 0))];
    expect(traverser(0.87, loin).z).toBeGreaterThan(0.2);
    expect(traverserEnCrabe(0.87, loin)).toBeLessThan(-2.5);
    expect(traverserEnSautant(0.87, loin)).toBeLessThan(-2.5);
    const pres = [capsuleTigre(tigre(0.55, 0, 0))];
    expect(traverserEnCrabe(1.08, pres)).toBeGreaterThan(0.2);
    expect(traverserEnSautant(1.08, pres)).toBeGreaterThan(0.2);
  });

  it("deux tigres bien placés (de biais en travers de la porte) la ferment même à qui saute ou passe en crabe", () => {
    // deux tigres de biais (cap ±60°, 1,4 m d'entraxe) : leurs corps se recouvrent presque d'un montant à l'autre
    const L = ZOMBIES.separationM;
    const corps = [capsuleTigre(tigre(-L / 2, 0, Math.PI / 3)), capsuleTigre(tigre(L / 2, 0, -Math.PI / 3))];
    for (let x = -1.1; x <= 1.1 + 1e-9; x += 0.2) {
      expect(traverserEnCrabe(x, corps), `crabe x = ${x.toFixed(1)}`).toBeGreaterThan(0.2);
      expect(traverserEnSautant(x, corps), `saut x = ${x.toFixed(1)}`).toBeGreaterThan(0.2);
    }
  });

  it("deux petits du Truck ferment aussi la porte, mais on saute par-dessus un petit", () => {
    const L = ZOMBIES.separationM;
    const petits = [capsuleTigre(tigre(-L / 2, 0, 0, 3)), capsuleTigre(tigre(L / 2, 0, 0, 3))];
    expect(traverser(0, petits).z).toBeGreaterThan(0.2);
    // saut en courant par-dessus un petit (dos à 0,68 m) dans un couloir libre
    const m = mondeDe();
    const petit = [capsuleTigre(tigre(0, 0, Math.PI / 2, 3))];
    const en: Entrees = { avant: 1, droite: 0, saut: true, sprint: true, lacet: lacetVers(0, -1) };
    expect(avancer(etatA([0, 0, 3.5], [0, 0, -12.5]), 1.2, en, m, petit).p[2]).toBeLessThan(-2);
    // un grand, non (dos à 1,2 m, au-dessus du sommet du saut)
    const grand = [capsuleTigre(tigre(0, 0, Math.PI / 2, 0))];
    expect(avancer(etatA([0, 0, 3.5], [0, 0, -12.5]), 1.2, en, m, grand).p[2]).toBeGreaterThan(0);
  });
});

describe("mouvement contre les corps des tigres", () => {
  const m = mondeDe();
  const sprintVers = (fx: number, fz: number): Entrees => ({ avant: 1, droite: 0, saut: false, sprint: true, lacet: lacetVers(fx, fz) });

  it("sprint de face (12,5 m/s) : on ne traverse pas, à 60 Hz comme avec un pas de 0,25 s", () => {
    const corps = [capsuleTigre(tigre(0, 0, Math.PI / 2))];
    for (const dt of [DT, 0.25]) {
      let e = etatA([0, 0, 6], [0, 0, -12.5]);
      avancer(e, 2, sprintVers(0, -1), m, corps, (s) => {
        expect(dist(corps[0], s.p[0], s.p[2])).toBeGreaterThan(corps[0].r + R - 1e-6);
        e = s;
      }, dt);
      expect(e.p[2]).toBeGreaterThan(0);
      expect(e.p[2]).toBeLessThan(corps[0].r + R + 0.05);
      // pas de collage : la vitesse ne garde rien qui entre dans le corps
      expect(e.v[2]).toBeGreaterThan(-1e-6);
    }
  });

  it("en biais, on glisse le long du flanc au lieu de s'y coller", () => {
    // tigre couché le long de x (cap π/2), on court vers −z en biais de 30° vers +x
    const corps = [capsuleTigre(tigre(0, 0, Math.PI / 2))];
    const e = avancer(etatA([-1, 0, 2]), 1.5, sprintVers(Math.sin(Math.PI / 6), -Math.cos(Math.PI / 6)), m, corps);
    expect(e.p[0]).toBeGreaterThan(3); // a filé le long du flanc puis l'a dépassé
  });

  it("un mur reste prioritaire : un tigre qui chevauche le joueur contre un mur ne le fait pas entrer dans le mur", () => {
    const mm = mondeDe(rect(-30, 0, 30, 10, 40)); // face nord en z = 0
    const corps = [capsuleTigre(tigre(0, -0.8, Math.PI / 2))];
    avancer(etatA([0, 0, -R - 0.01]), 1, { avant: 0, droite: 0, saut: false, sprint: false, lacet: 0 }, mm, corps, (s) => {
      expect(s.p[2]).toBeLessThan(-R + 1e-6);
    });
    // coincé ainsi, on peut encore filer le long du mur (on ne s'enfonce pas plus dans le tigre)
    const e = avancer(etatA([0, 0, -R - 0.01]), 1, { avant: 1, droite: 0, saut: false, sprint: false, lacet: lacetVers(1, 0) }, mm, corps, (s) => {
      expect(s.p[2]).toBeLessThan(-R + 1e-6);
    });
    expect(e.p[0]).toBeGreaterThan(3);
  });

  it("un tigre apparu sur le joueur le repousse doucement (capsulePoussee), sans saut de position", () => {
    const corps = [capsuleTigre(tigre(0, 0, Math.PI / 2))];
    let e = etatA([0.3, 0, 0.2]);
    const repos: Entrees = { avant: 0, droite: 0, saut: false, sprint: false, lacet: 0 };
    let sorti = Infinity;
    for (let k = 0; k < 60; k++) {
      const n = etape(e, repos, DT, m, 1, corps);
      expect(Math.hypot(n.p[0] - e.p[0], n.p[2] - e.p[2])).toBeLessThanOrEqual(MOUV.capsulePoussee * DT + 1e-6);
      e = n;
      if (sorti === Infinity && dist(corps[0], e.p[0], e.p[2]) >= corps[0].r + R - 1e-6) sorti = (k + 1) * DT;
    }
    expect(sorti).toBeLessThan(0.3);
  });

  it("pas d'escalade sur un tigre (même hors zombies, monde sans `sansParkour`)", () => {
    const corps = [capsuleTigre(tigre(0, 0, Math.PI / 2))];
    let yMax = 0;
    avancer(etatA([0, 0, 1.5]), 1.5, { ...sprintVers(0, -1), saut: true }, m, corps, (s) => { yMax = Math.max(yMax, s.p[1]); });
    expect(yMax).toBeLessThan(MOUV.saut ** 2 / (2 * MOUV.gravite) + 0.02);
  });

  it("pris en étau (coin et tigre) en voulant sortir : on traverse le tigre au bout de coinceS ; sans entrée, on reste", () => {
    // coin : mur à l'ouest (face x = 0) et au nord... ici au sud (face z = 0, solide en z > 0)
    const mm = mondeDe(rect(-30, -30, 0, 30, 40), rect(-30, 0, 30, 30, 40));
    const corps = [capsuleTigre(tigre(0.8, -0.8, lacetVers(1, 1)))];
    const depart = etatA([R, 0, -R]);
    let tFantome = Infinity, t = 0;
    const e = avancer(depart, 2, sprintVers(1, -1), mm, corps, (s) => {
      t += DT;
      if (tFantome === Infinity && (s.coince?.fantome ?? 0) > 0) tFantome = t;
    });
    expect(tFantome).toBeGreaterThanOrEqual(MOUV.coinceS - DT);
    expect(tFantome).toBeLessThan(MOUV.coinceS + 0.2);
    expect(e.p[0]).toBeGreaterThan(2);
    const reste = avancer(depart, 2, { avant: 0, droite: 0, saut: false, sprint: false, lacet: 0 }, mm, corps);
    expect(reste.coince?.fantome ?? 0).toBe(0);
    expect(Math.hypot(reste.p[0], reste.p[2])).toBeLessThan(1);
  });

  it("sans obstacles, le contrôleur est inchangé (l'arène ne voit rien)", () => {
    const en: Entrees = { avant: 1, droite: 0.3, saut: true, sprint: true, lacet: 0.7 };
    let a = etatA([0, 0, 0]), b = etatA([0, 0, 0]);
    for (let k = 0; k < 120; k++) { a = etape(a, en, DT, m); b = etape(b, en, DT, m, 1, undefined); }
    expect(b).toEqual(a);
    expect(a.coince).toBeUndefined();
  });
});

describe("serveur : les tigres ne chevauchent pas les joueurs debout", () => {
  // Ouest de la Cour Centre, à plus de 8,5 m de tout obstacle (v8 : l'olivier OL1 occupe le centre de la cour).
  const COUR: [number, number] = [114, -51];
  const spec = (type: TypeZombie = 0): SpecZombie => ({
    type, manche: 5, pv: pvZombie(5, type), allure: 1, vitesse: vitesseAllure(1, 0.5, type), degats: degatsGriffe(type), rechargeGriffeS: rechargeGriffe(type),
  });
  const chevauchement = (simu: ReturnType<typeof creerSimuZombies>, id: number, j: JoueurZombie): number => {
    const z = simu.zombie(id)!;
    const c = capsuleTigre({ x: z.p[0], z: z.p[2], cap: z.cap, echelle: z.echelle });
    return c.r + R - dist(c, j.p[0], j.p[2]);
  };

  it("un tigre apparu sur le joueur en est écarté dès le tic suivant ; une meute qui converge ne l'enfonce jamais", () => {
    const simu = creerSimuZombies({ monde: construireMondeZombies(scene), alea: () => 0.5 });
    const j: JoueurZombie = { id: "j1", p: [COUR[0], 0, COUR[1]], vivant: true };
    const seul = simu.apparaitre(spec(), [COUR[0] + 0.2, COUR[1]], { mode: "chasse" }, 0)!;
    simu.tic(1000 / 60, DT, [j]);
    expect(chevauchement(simu, seul, j)).toBeLessThan(1e-6);
    const ids = [seul];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * 2 * Math.PI;
      ids.push(simu.apparaitre(spec(k % 4 === 3 ? 3 : 0), [COUR[0] + Math.cos(a) * 6, COUR[1] + Math.sin(a) * 6], { mode: "chasse" }, 0)!);
    }
    let t = 1000 / 60;
    for (let k = 0; k < 240; k++) {
      t += DT * 1000;
      simu.tic(t, DT, [j]);
      for (const id of ids) expect(chevauchement(simu, id, j)).toBeLessThan(1e-6);
    }
  });
});
