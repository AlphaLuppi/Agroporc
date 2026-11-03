import { describe, expect, it } from "vitest";
import {
  ELEVATION_REPOS, POURSUITE, avancerPoursuite, creerPoursuite, ecartAngle, enrouler, lacetCible, melangerPoses, tournerPoursuite,
  type EtatPoursuite, type MondePoursuite, type VoiturePoursuivie,
} from "./camera-poursuite";

const VIDE: MondePoursuite = { rayon: () => Infinity };
const DT = 1 / 60;

/** Fait rouler la caméra `s` secondes derrière une voiture (état fixe ou fonction du temps). */
function rouler(e: EtatPoursuite, v: VoiturePoursuivie | ((t: number) => VoiturePoursuivie), s: number, monde = VIDE, reduit = false) {
  let etat = e;
  let pose = avancerPoursuite(etat, typeof v === "function" ? v(0) : v, 0, monde, { reduit }).pose;
  for (let t = 0; t < s - 1e-9; t += DT) {
    const r = avancerPoursuite(etat, typeof v === "function" ? v(t) : v, DT, monde, { reduit });
    etat = r.etat; pose = r.pose;
  }
  return { etat, pose };
}
/** Direction horizontale « derrière » la caméra par rapport à la voiture (lacet de la caméra vue depuis la voiture). */
const lacetDepuis = (v: VoiturePoursuivie, pos: number[]) => Math.atan2(pos[0] - v.p[0], pos[2] - v.p[2]);

describe("caméra de poursuite", () => {
  it("se tient derrière la voiture, ≈ 6–7 m en arrière et ≈ 2,5–3 m au-dessus, regard un peu plongeant", () => {
    const v: VoiturePoursuivie = { p: [10, 0, 20], cap: 0, v: 0 };
    const { pose } = rouler(creerPoursuite(v), v, 0.5);
    // cap 0 : l'avant est −z, donc la caméra est en +z
    expect(pose.pos[2] - 20).toBeGreaterThan(6);
    expect(pose.pos[2] - 20).toBeLessThan(7);
    expect(pose.pos[0]).toBeCloseTo(10, 6);
    expect(pose.pos[1]).toBeGreaterThan(2.5);
    expect(pose.pos[1]).toBeLessThan(3.2);
    expect(pose.lacet).toBeCloseTo(0, 6);
    expect(pose.tangage).toBeLessThan(-0.1);
    expect(pose.tangage).toBeGreaterThan(-0.35);
    expect(pose.champ).toBe(0);
  });

  it("suit le cap avec du retard, sans dépasser (ressort critique)", () => {
    const v0: VoiturePoursuivie = { p: [0, 0, 0], cap: 0, v: 15 };
    const e = creerPoursuite(v0);
    const v1 = { ...v0, cap: 1 };
    const court = rouler(e, v1, 0.1);
    expect(court.etat.lacet).toBeGreaterThan(0);
    expect(court.etat.lacet).toBeLessThan(0.3);
    let max = 0;
    let etat = e;
    for (let t = 0; t < 3; t += DT) { etat = avancerPoursuite(etat, v1, DT, VIDE).etat; max = Math.max(max, etat.lacet); }
    expect(max).toBeLessThanOrEqual(1 + 1e-6);
    expect(etat.lacet).toBeCloseTo(1, 3);
  });

  it("passe ±π par le plus court chemin, jamais un tour complet", () => {
    const v0: VoiturePoursuivie = { p: [0, 0, 0], cap: Math.PI - 0.1, v: 12 };
    let etat = creerPoursuite(v0);
    const v1 = { ...v0, cap: -Math.PI + 0.1 }; // 0,2 rad plus loin en passant par π
    let plusGrandSaut = 0, prec = etat.lacet;
    for (let t = 0; t < 2; t += DT) {
      etat = avancerPoursuite(etat, v1, DT, VIDE).etat;
      plusGrandSaut = Math.max(plusGrandSaut, Math.abs(ecartAngle(prec, etat.lacet)));
      prec = etat.lacet;
    }
    expect(plusGrandSaut).toBeLessThan(0.05);
    expect(Math.abs(ecartAngle(etat.lacet, -Math.PI + 0.1))).toBeLessThan(1e-3);
  });

  it("en dérapage, suit la direction de la vitesse plutôt que le nez, sans à-coup", () => {
    const sansGlisse: VoiturePoursuivie = { p: [0, 0, 0], cap: 0, v: 15 };
    expect(lacetCible(sansGlisse)).toBe(0);
    // la caisse a pivoté de 0,8 rad à gauche, la voiture file encore droit devant (−z)
    const cap = 0.8, vitesse = 15;
    const glisse: VoiturePoursuivie = { p: [0, 0, 0], cap, v: vitesse * Math.cos(cap), vl: vitesse * Math.sin(cap) };
    const c = lacetCible(glisse);
    expect(c).toBeLessThan(cap - 0.3);
    expect(c).toBeGreaterThanOrEqual(-1e-9);
    // fondu continu selon la part de glissade
    let prec = lacetCible({ ...glisse, vl: 0 });
    for (let k = 1; k <= 40; k++) {
      const vl = (vitesse * Math.sin(cap) * k) / 40;
      const x = lacetCible({ ...glisse, vl });
      expect(Math.abs(x - prec)).toBeLessThan(0.08);
      prec = x;
    }
    // prefers-reduced-motion : le cap seul
    expect(lacetCible(glisse, true)).toBeCloseTo(cap, 9);
  });

  it("marche arrière : la caméra reste derrière le coffre, aucun demi-tour", () => {
    const v: VoiturePoursuivie = { p: [0, 0, 0], cap: 0.4, v: -8 };
    expect(lacetCible(v)).toBeCloseTo(0.4, 9);
    expect(lacetCible({ ...v, vl: 3 })).toBeCloseTo(0.4, 9);
    const { pose } = rouler(creerPoursuite(v), (t) => ({ ...v, p: [Math.sin(0.4) * 8 * t, 0, Math.cos(0.4) * 8 * t] }), 2);
    expect(Math.abs(ecartAngle(pose.lacet, 0.4))).toBeLessThan(0.02);
  });

  it("recul et champ s'élargissent avec la vitesse (sauf mouvement réduit)", () => {
    const arret: VoiturePoursuivie = { p: [0, 0, 0], cap: 0, v: 0 };
    const vite: VoiturePoursuivie = { p: [0, 0, 0], cap: 0, v: 24 };
    const a = rouler(creerPoursuite(arret), arret, 3).pose;
    const b = rouler(creerPoursuite(arret), vite, 3).pose;
    expect(b.pos[2]).toBeGreaterThan(a.pos[2] + 0.8);
    expect(b.champ).toBeGreaterThan(5);
    expect(b.champ).toBeLessThanOrEqual(POURSUITE.champVitesse);
    expect(rouler(creerPoursuite(arret), vite, 3, VIDE, true).pose.champ).toBe(0);
  });

  it("regard libre : la souris tourne autour de la voiture, puis la caméra revient derrière après ≈ 1,2 s si la voiture roule", () => {
    const v: VoiturePoursuivie = { p: [0, 0, 0], cap: 0, v: 10 };
    let e = rouler(creerPoursuite(v), v, 0.5).etat;
    e = tournerPoursuite(e, 1.5, 0); // vers la gauche
    let r = rouler(e, v, 0.05);
    expect(r.pose.lacet).toBeGreaterThan(1.3);
    // la caméra regarde à gauche : elle est passée sur la droite de la voiture (+x)
    expect(r.pose.pos[0]).toBeGreaterThan(3);
    // avant le délai : le regard libre tient
    r = rouler(r.etat, v, POURSUITE.retourS - 0.15);
    expect(r.etat.orbite).toBeCloseTo(1.5, 6);
    // après : retour derrière
    r = rouler(r.etat, v, 2.5);
    expect(Math.abs(r.etat.orbite)).toBeLessThan(0.02);
    expect(Math.abs(lacetDepuis(v, r.pose.pos))).toBeLessThan(0.03);
    // à l'arrêt, le regard libre reste où on l'a mis
    const arret = { ...v, v: 0 };
    const s = rouler(tournerPoursuite(r.etat, -1, 0), arret, 3);
    expect(s.etat.orbite).toBeCloseTo(r.etat.orbite - 1, 6);
  });

  it("regard libre en hauteur borné, passage ±π de l'orbite enroulé", () => {
    const v: VoiturePoursuivie = { p: [0, 0, 0], cap: 0, v: 0 };
    let e = creerPoursuite(v);
    e = tournerPoursuite(e, 0, -10); // regarder très bas : la caméra monte, bornée
    expect(ELEVATION_REPOS + e.elevation).toBeCloseTo(POURSUITE.elevationMax, 9);
    e = tournerPoursuite(e, 0, 20);
    expect(ELEVATION_REPOS + e.elevation).toBeCloseTo(POURSUITE.elevationMin, 9);
    e = tournerPoursuite(creerPoursuite(v), 3, 0);
    e = tournerPoursuite(e, 0.5, 0);
    expect(e.orbite).toBeCloseTo(enrouler(3.5), 9);
  });

  it("un mur entre la voiture et la caméra la rapproche aussitôt, puis elle se réécarte doucement", () => {
    const v: VoiturePoursuivie = { p: [0, 0, 0], cap: 0, v: 0 };
    let e = rouler(creerPoursuite(v), v, 1).etat;
    const libre = e.distance;
    const mur: MondePoursuite = { rayon: (_o, _d, max) => Math.min(max, 3) };
    const r = avancerPoursuite(e, v, DT, mur);
    expect(r.etat.distance).toBeCloseTo(3 - POURSUITE.margeMur, 6);
    expect(Math.hypot(r.pose.pos[0], r.pose.pos[1] - POURSUITE.hauteurVisee, r.pose.pos[2])).toBeCloseTo(3 - POURSUITE.margeMur, 6);
    // le regard vise toujours la voiture
    expect(r.pose.lacet).toBeCloseTo(0, 6);
    // enfermée de partout : jamais dans l'obstacle (avant : posée à `distanceMin`, donc dans le mur)
    const colle: MondePoursuite = { rayon: () => 0.2 };
    const dc = avancerPoursuite(e, v, DT, colle).etat.distance;
    expect(dc).toBeGreaterThan(0);
    expect(dc).toBeLessThan(0.2);
    // mur parti : retour progressif
    e = r.etat;
    const un = avancerPoursuite(e, v, DT, VIDE).etat.distance;
    expect(un).toBeLessThan(libre);
    expect(un).toBeGreaterThan(e.distance);
    expect(rouler(e, v, 2).etat.distance).toBeCloseTo(libre, 6);
  });

  it("ne passe jamais sous le sol", () => {
    const v: VoiturePoursuivie = { p: [0, 0, 0], cap: 0, v: 0 };
    // regarder vers le haut au maximum : la caméra descend vers le sol
    let e = tournerPoursuite(creerPoursuite(v), 0, 20);
    const bas = rouler(e, v, 0.5).pose;
    expect(bas.pos[1]).toBeGreaterThanOrEqual(POURSUITE.hauteurSol - 1e-9);
    // un talus de 2 m derrière la voiture
    const talus: MondePoursuite = { rayon: () => Infinity, sol: (_x, z) => (z > 3 ? 2 : 0) };
    e = tournerPoursuite(creerPoursuite(v), 0, 20);
    const p = rouler(e, v, 0.5, talus).pose;
    expect(p.pos[1]).toBeGreaterThanOrEqual(2 + POURSUITE.hauteurSol - 1e-9);
  });

  it("prefers-reduced-motion : moins de balancement en virage", () => {
    const v0: VoiturePoursuivie = { p: [0, 0, 0], cap: 0, v: 15 };
    const v1 = { ...v0, cap: 1 };
    const normal = rouler(creerPoursuite(v0), v1, 0.3).etat.lacet;
    const reduit = rouler(creerPoursuite(v0), v1, 0.3, VIDE, true).etat.lacet;
    expect(reduit).toBeGreaterThan(normal);
  });

  it("transition entre deux poses : bornes exactes, lacet par le plus court chemin", () => {
    const a = { pos: [0, 1, 0] as [number, number, number], lacet: Math.PI - 0.1, tangage: 0, champ: 0 };
    const b = { pos: [2, 3, 4] as [number, number, number], lacet: -Math.PI + 0.1, tangage: -0.2, champ: 4 };
    expect(melangerPoses(a, b, 0)).toEqual({ ...a, lacet: enrouler(a.lacet) });
    const fin = melangerPoses(a, b, 1);
    expect(fin.pos).toEqual(b.pos);
    expect(fin.lacet).toBeCloseTo(b.lacet, 9);
    const milieu = melangerPoses(a, b, 0.5);
    expect(Math.abs(milieu.lacet)).toBeCloseTo(Math.PI, 6);
  });

  it("mur collé derrière la voiture : la caméra monte au-dessus d'elle au lieu d'entrer dans le mur", () => {
    const v: VoiturePoursuivie = { p: [0, 0, 0], cap: 0, v: 0 };
    const e = rouler(creerPoursuite(v), v, 1).etat;
    // paroi verticale à 0,5 m derrière le pivot (z = +0,5) : un rayon d'élévation `el` la touche à 0,5 / cos(el)
    const paroi: MondePoursuite = {
      rayon: (_o, d, max) => (d[2] > 1e-6 ? Math.min(max, 0.5 / d[2]) : max),
    };
    const r = avancerPoursuite(e, v, DT, paroi);
    // jamais derrière la paroi
    expect(r.pose.pos[2]).toBeLessThan(0.5);
    // assez loin de la voiture pour la voir, en hauteur
    expect(r.etat.distance).toBeGreaterThanOrEqual(POURSUITE.distanceMin - 1e-9);
    expect(r.pose.pos[1]).toBeGreaterThan(POURSUITE.hauteurVisee + 1);
    // le regard vise toujours le point au-dessus de la voiture (plongée forte)
    expect(r.pose.tangage).toBeLessThan(-0.7);
    // mur parti : la caméra reprend son élévation de repos
    expect(rouler(r.etat, v, 2).pose.tangage).toBeCloseTo(-ELEVATION_REPOS, 2);
  });

  it("frein à main : la cible ne bascule pas du flanc au nez quand la vitesse avant passe par 0", () => {
    // 8 m/s de glisse latérale, vitesse avant qui oscille autour de 0
    const base: VoiturePoursuivie = { p: [0, 0, 0], cap: 0, v: 0, vl: 8 };
    const a = lacetCible({ ...base, v: 0.01 });
    const b = lacetCible({ ...base, v: -0.01 });
    expect(Math.abs(ecartAngle(a, b))).toBeLessThan(0.01);
    // continue sur tout le passage de −2 à +6 m/s
    let prec = lacetCible({ ...base, v: -2 });
    for (let k = 1; k <= 80; k++) {
      const x = lacetCible({ ...base, v: -2 + k * 0.1 });
      expect(Math.abs(ecartAngle(prec, x))).toBeLessThan(0.08);
      prec = x;
    }
    // à pleine vitesse avant, la glisse compte toujours
    expect(Math.abs(lacetCible({ ...base, v: 12 }))).toBeGreaterThan(0.2);
  });
});
