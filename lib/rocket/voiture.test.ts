import { describe, expect, it } from "vitest";
import { creerArene } from "./arene";
import {
  AIR, BOOST, CONDUITE, ENTREES_NULLES, FLIP, GRAVITE, PAS_S, SAUT, STADE, VOITURE, creerRng, interpolerTable, tirer,
  type EntreesVoiture, type EtatVoiture, type EvenementVoiture, type Vec3,
} from "./contrat";
import {
  INERTIE_VOITURE, angleRoulis, centreHitbox, coinsHitbox, creerVoiture, DEMI_HITBOX, flipEstArriere, pasVoiture, plafonnerVitesse, replacerVoiture,
} from "./voiture";
import { baseDepuisCap, capDeBase, dot, norme, tournerVec, type Base } from "./vec";

const arene = creerArene();

/** Banc d'essai : une voiture, son compteur de pas, et un `pas(entrees)` qui avance d'un pas et garde les événements. */
function banc(x = 0, z = 0, cap = 0, y: number = VOITURE.hauteurRepos) {
  const v = creerVoiture({ id: 0, equipe: "bleue", slot: 0, humain: true, nom: "essai", p: [x, y, z], cap });
  const b = {
    v,
    tick: 0,
    evs: [] as EvenementVoiture[],
    pas(e: Partial<EntreesVoiture> = {}): EvenementVoiture[] {
      const r = pasVoiture(arene, v, { ...ENTREES_NULLES(), ...e }, PAS_S, b.tick++);
      b.evs.push(...r);
      return r;
    },
    /** n pas avec les mêmes entrées */
    suite(n: number, e: Partial<EntreesVoiture> = {}): void { for (let i = 0; i < n; i++) b.pas(e); },
    /** durée en secondes */
    duree(s: number, e: Partial<EntreesVoiture> = {}): void { b.suite(Math.round(s / PAS_S), e); },
    t: () => b.tick * PAS_S,
    vit: () => norme(v.v),
    vitAvant: () => dot(v.v, v.base.avant),
  };
  return b;
}

/** Voiture posée et au repos depuis 0,1 s (les réglages des pneus du « pas précédent » sont ceux d'une voiture arrêtée). */
function posee(x = 0, z = 0, cap = 0) {
  const b = banc(x, z, cap);
  b.suite(12);
  return b;
}

/** Voiture en l'air, loin de tout. */
const enAir = () => { const b = banc(0, 0, 0, 12); b.v.v[2] = 0; return b; };

/** Angle (degrés) entre deux vecteurs unitaires. */
const ecartDeg = (u: Readonly<Vec3>, w: Readonly<Vec3>): number => (Math.acos(Math.min(1, Math.max(-1, dot(u, w)))) * 180) / Math.PI;

/** Penche la voiture de `angle` rad autour de son avant (angle > 0 : le côté droit descend). */
function pencher(base: Base, angle: number): void {
  base.droite = tournerVec(base.droite, base.avant, -angle);
  base.haut = tournerVec(base.haut, base.avant, -angle);
}

/**
 * Voiture penchée de 0,7 rad sur ses deux roues DROITES (les roues gauches sont à plus de 30 cm du sol, la caisse ne touche pas) :
 * exactement deux roues en contact au premier pas.
 */
function surDeuxRoues(garde = 0) {
  const b = banc(0, 0, 0, 0.33 + garde);
  pencher(b.v.base, 0.7);
  return b;
}

/** Voiture arrêtée sur le toit, au sol, après s'être posée. */
function surLeToit() {
  const b = banc(0, 0, 0, 1.5);
  b.v.base = { avant: [0, 0, 1], droite: [1, 0, 0], haut: [0, -1, 0] };
  b.duree(1.5);
  return b;
}

describe("voiture : repos et conduite au sol", () => {
  it("posée à 17 cm, elle reste immobile sur ses quatre roues", () => {
    const b = banc();
    b.duree(3);
    expect(b.v.p[1]).toBeGreaterThan(0.165);
    expect(b.v.p[1]).toBeLessThan(0.175);
    expect(b.vit()).toBeLessThan(0.05);
    expect(b.v.rouesContact).toBe(4);
    expect(b.v.auSol).toBe(true);
    expect(b.v.normaleSurface![1]).toBeGreaterThan(0.99);
  });

  it("une roue « touche » jusqu'à 11 cm au-dessus du sol (portée du rayon de RocketSim), plus au-delà", () => {
    const pres = banc(0, 0, 0, VOITURE.hauteurRepos + 0.1);
    pres.pas();
    expect(pres.v.rouesContact).toBe(4);
    const loin = banc(0, 0, 0, VOITURE.hauteurRepos + 0.125);
    loin.pas();
    expect(loin.v.rouesContact).toBe(0);
    // l'arrière porte un peu plus loin que l'avant (11,8 contre 11,0 uu)
    const entre = banc(0, 0, 0, VOITURE.hauteurRepos + 0.114);
    entre.pas();
    expect(entre.v.rouesContact).toBe(2);
    expect(entre.v.auSol).toBe(false);
  });

  it("0 → 14 m/s sans boost en 2,0 à 2,5 s", () => {
    const b = banc();
    let t = -1;
    for (let i = 0; i < 600 && t < 0; i++) { b.pas({ accel: 1 }); if (b.vitAvant() >= 14) t = b.t(); }
    expect(t).toBeGreaterThan(2.0);
    expect(t).toBeLessThan(2.5);
  });

  it("gaz : 16 m/s² à l'arrêt, quatre roues × 4 m/s² (RocketSim THROTTLE_TORQUE_AMOUNT), avec un pas de retard sur la commande", () => {
    const b = posee(0, -45);
    b.pas({ accel: 1 });
    // au pas de l'appui, les pneus appliquent encore les réglages du pas précédent (voiture arrêtée)
    expect(b.vitAvant()).toBeLessThan(0.01);
    expect(b.v.pneus.moteur).toBeCloseTo(4, 2);
    b.pas({ accel: 1 });
    expect(b.vitAvant()).toBeGreaterThan((16 / 120) * 0.97);
    expect(b.vitAvant()).toBeLessThan((16 / 120) * 1.03);
  });

  it("sans boost la vitesse plafonne à 14,1 m/s (1410 uu/s)", () => {
    const b = banc(0, -45);
    b.duree(5, { accel: 1 });
    expect(b.vitAvant()).toBeGreaterThan(14.0);
    expect(b.vitAvant()).toBeLessThan(14.15);
  });

  it("0 → 23 m/s avec boost en 1,5 à 1,9 s, supersonique vers 1,6 s, vitesse max 23,00", () => {
    const b = banc(0, -45);
    b.v.boost = 100;
    let t23 = -1, tSuper = -1, vmax = 0;
    for (let i = 0; i < 300; i++) {
      b.pas({ accel: 1, boost: true });
      vmax = Math.max(vmax, b.vit());
      if (tSuper < 0 && b.v.supersonique) tSuper = b.t();
      if (t23 < 0 && b.vit() >= 22.999) t23 = b.t();
    }
    expect(t23).toBeGreaterThan(1.5);
    expect(t23).toBeLessThan(1.9);
    expect(tSuper).toBeGreaterThan(1.4);
    expect(tSuper).toBeLessThan(1.8);
    expect(vmax).toBeLessThanOrEqual(23.0000001);
    expect(vmax).toBeGreaterThan(22.99);
  });

  it("le boost consomme 33,33 par seconde, exactement 12 pas (0,1 s) pour un appui d'un pas, et se vide", () => {
    const b = banc(0, -45);
    b.v.boost = 100;
    b.duree(1, { boost: true });
    expect(b.v.boost).toBeGreaterThan(66.0);
    expect(b.v.boost).toBeLessThan(67.3);
    // un appui d'un pas brûle 12 pas, ni 11 ni 13 (RocketSim BOOST_MIN_TIME = 0,1 s, compté en simple précision)
    const c = banc(0, -45);
    c.v.boost = 100;
    c.pas({ boost: true });
    let pas = 1;
    for (let i = 0; i < 60; i++) { c.pas(); if (c.v.boostActif) pas++; }
    expect(pas).toBe(12);
    expect(100 - c.v.boost).toBeCloseTo((100 / 3) * 0.1, 9);
    // à zéro : plus d'effet
    const d = banc(0, -45);
    d.v.boost = 0;
    d.duree(1, { boost: true });
    expect(d.vit()).toBeLessThan(0.1);
    expect(d.v.boostActif).toBe(false);
  });

  it("le boost pousse le long de l'avant : 9,92 m/s² au sol, 10,58 m/s² en l'air (RocketSim BOOST_ACCEL_GROUND / _AIR)", () => {
    // au sol : deux voitures identiques lancées à 10 m/s, l'une boost un pas ; l'écart de vitesse est la poussée du boost seule
    const sol = (boost: boolean) => {
      const b = posee(0, -45);
      b.v.boost = 100; b.v.v[2] = 10;
      b.suite(6, { accel: 1 });
      b.pas({ accel: 1, boost });
      return b.vitAvant();
    };
    expect(sol(true) - sol(false)).toBeCloseTo(BOOST.acceleration / 120, 6);
    expect(BOOST.acceleration).toBeCloseTo(9.91667, 4);
    const air = enAir();
    air.v.boost = 100;
    air.pas({ boost: true });
    expect(air.v.v[2]).toBeCloseTo(BOOST.accelerationAir / 120, 9);
    expect(BOOST.accelerationAir).toBeCloseTo(10.58333, 4);
  });

  it("gaz réel : un appui sur le boost avec de la réserve vaut plein gaz (pas de frein), sans réserve le gaz arrière freine", () => {
    const avec = posee(0, -45);
    avec.v.v[2] = 10; avec.v.boost = 100;
    avec.pas({ accel: -1, boost: true });
    expect(avec.v.pneus.moteur).toBeGreaterThan(0);
    expect(avec.v.pneus.frein).toBe(0);
    const sans = posee(0, -45);
    sans.v.v[2] = 10; sans.v.boost = 0;
    sans.pas({ accel: -1, boost: true });
    expect(sans.v.pneus.moteur).toBe(0);
    expect(sans.v.pneus.frein).toBeCloseTo(CONDUITE.frein / 4, 9);
    // pendant la traîne de 0,1 s d'un appui bref, c'est l'ENTRÉE qui compte : le gaz arrière freine alors que le boost pousse encore
    avec.pas({ accel: -1 });
    expect(avec.v.boostActif).toBe(true);
    expect(avec.v.pneus.frein).toBeCloseTo(CONDUITE.frein / 4, 9);
  });

  it("événements de boost et de supersonique", () => {
    const b = banc(0, -45);
    b.v.boost = 100;
    b.duree(2.5, { accel: 1, boost: true });
    expect(b.evs.some((e) => e.t === "boost" && e.actif)).toBe(true);
    expect(b.evs.some((e) => e.t === "supersonique" && e.actif)).toBe(true);
    b.duree(2);
    expect(b.evs.some((e) => e.t === "boost" && !e.actif)).toBe(true);
    expect(b.evs.some((e) => e.t === "supersonique" && !e.actif)).toBe(true);
    expect(b.v.supersonique).toBe(false);
  });

  it("supersonique : le maintien entre 21 et 22 m/s ne dure que la première seconde (RocketSim SUPERSONIC_MAINTAIN_MAX_TIME)", () => {
    const b = banc(0, -45);
    b.v.boost = 100;
    for (let i = 0; i < 400 && !b.v.supersonique; i++) { b.v.boost = 100; b.pas({ accel: 1, boost: true }); }
    expect(b.v.supersonique).toBe(true);
    expect(b.vit()).toBeGreaterThanOrEqual(22);
    // vitesse tenue à 21,5 m/s : supersonique pendant une seconde encore (121 pas, minuteur en simple précision), puis plus
    const tenir = (vit: number) => { const f = b.v.base.avant; b.v.v[0] = f[0] * vit; b.v.v[1] = 0; b.v.v[2] = f[2] * vit; b.v.p[2] = -45; };
    let pas = 0;
    while (b.v.supersonique && pas < 400) { tenir(21.5); b.pas({ accel: 1 }); pas++; }
    expect(pas).toBe(121);
    expect(b.v.supersoniqueDepuis).toBe(0);
    // sous 22 m/s on ne le redevient pas ; à 22 m/s si, et l'on retombe aussitôt sous 21 m/s
    tenir(21.9); b.pas({ accel: 1 });
    expect(b.v.supersonique).toBe(false);
    tenir(22.05); b.pas({ accel: 1 });
    expect(b.v.supersonique).toBe(true);
    tenir(20.5); b.pas({ accel: 1 });
    expect(b.v.supersonique).toBe(false);
  });

  it("freinage : le gaz opposé freine à 35 m/s² quelle que soit son amplitude, puis repart en arrière", () => {
    for (const gaz of [-1, -0.2]) {
      const b = posee(0, -45);
      b.v.v[2] = 20;
      b.pas({ accel: gaz }); // les réglages du frein sont prêts pour le pas suivant
      const v0 = b.vitAvant();
      b.suite(24, { accel: gaz });
      expect(v0 - b.vitAvant()).toBeCloseTo(CONDUITE.frein * 0.2, 1);
    }
    const b = banc(0, 0);
    b.duree(1.5, { accel: 1 });
    b.duree(3.3, { accel: -1 });
    expect(b.vitAvant()).toBeLessThan(-5);
  });

  it("zone morte du gaz : sous 0,001 le gaz est ignoré (RocketSim THROTTLE_DEADZONE)", () => {
    const b = posee(0, -45);
    b.pas({ accel: 0.0005 });
    expect(b.v.pneus.moteur).toBe(0);
    b.pas({ accel: 0.002 });
    expect(b.v.pneus.moteur).toBeGreaterThan(0);
  });

  it("roue libre : sans gaz la voiture ralentit à 5,25 m/s², puis s'arrête net sous 0,25 m/s sans passer en marche arrière", () => {
    const b = posee(0, -45);
    b.v.v[2] = 10;
    b.suite(2);
    const v0 = b.vitAvant();
    b.duree(1);
    expect(v0 - b.vitAvant()).toBeCloseTo(CONDUITE.rouleLibre, 1);
    expect(CONDUITE.rouleLibre).toBeCloseTo(CONDUITE.frein * CONDUITE.facteurRoueLibre, 9);
    b.duree(3);
    expect(b.vitAvant()).toBeCloseTo(0, 2);
    // sous 0,25 m/s : frein plein (RocketSim STOPPING_FORWARD_VEL)
    const c = posee(0, -45);
    c.v.v[2] = 0.2;
    c.pas();
    expect(c.v.pneus.frein).toBeCloseTo(CONDUITE.frein / 4, 9);
    c.suite(6);
    expect(Math.abs(c.vitAvant())).toBeLessThan(0.02);
  });

  it("virage en régime établi : courbures mesurées dans Rocket League à 5, 10, 15 et 23 m/s (± 8 %), issues du braquage des roues", () => {
    // RL (mesures en jeu) : 0,398 / 0,235 / 0,1375 / 0,09 par mètre ; ici le virage n'est plus imposé, il sort du modèle de pneu
    const attendu: [number, number][] = [[5, 0.398], [10, 0.235], [15, 0.1375], [23, 0.09]];
    for (const [vit, courbure] of attendu) {
      const b = posee(0, 0);
      let lacet = 0, vMoy = 0, n = 0;
      for (let i = 0; i < 600; i++) {
        b.v.boost = 100;
        const vf = b.vitAvant();
        const cap0 = capDeBase(b.v.base);
        b.pas({ direction: 1, accel: vf < vit ? 1 : 0, boost: vf < vit - 0.3 && vit > 14 });
        let d = capDeBase(b.v.base) - cap0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        if (i >= 300) { lacet += -d; vMoy += b.vit(); n++; } // tourner à droite fait diminuer le cap
      }
      const mesure = lacet / (n * PAS_S) / (vMoy / n);
      expect(mesure).toBeGreaterThan(courbure * 0.92);
      expect(mesure).toBeLessThan(courbure * 1.08);
      // et la table des bots (`CONDUITE.courbeCourbure`) dit la même chose à 5 % près
      expect(interpolerTable(CONDUITE.courbeCourbure, vMoy / n) / mesure).toBeGreaterThan(0.95);
      expect(interpolerTable(CONDUITE.courbeCourbure, vMoy / n) / mesure).toBeLessThan(1.05);
    }
  });

  it("le volant à droite tourne à droite, à gauche à gauche", () => {
    const d = banc(0, 0);
    d.duree(1, { accel: 1, direction: 1 });
    expect(d.v.base.avant[0]).toBeLessThan(-0.1); // à droite de +Z = vers -X
    const g = banc(0, 0);
    g.duree(1, { accel: 1, direction: -1 });
    expect(g.v.base.avant[0]).toBeGreaterThan(0.1);
  });

  it("angle de braquage selon la vitesse (RocketSim STEER_ANGLE_FROM_SPEED_CURVE), mélangé avec celui du frein à main", () => {
    const angle = (vit: number, derapage: boolean, pasFrein = 0) => {
      const b = posee(0, -30);
      b.suite(pasFrein, { derapage: true });
      b.v.v[0] = 0; b.v.v[2] = vit;
      b.pas({ direction: 1, derapage });
      return b.v.pneus.angle;
    };
    expect(angle(0, false)).toBeCloseTo(0.53356, 5);
    expect(angle(5, false)).toBeCloseTo(0.3193, 4);
    expect(angle(10, false)).toBeCloseTo(0.18203, 4);
    expect(angle(23, false)).toBeCloseTo(0.08507 + ((0.03454 - 0.08507) * (23 - 17.5)) / 12.5, 4);
    // frein à main à fond (tenu 0,2 s avant) : angle de la courbe du powerslide, 0,39235 → 0,12610 à 25 m/s
    expect(angle(10, true, 24)).toBeCloseTo(0.39235 + ((0.1261 - 0.39235) * 10) / 25, 4);
    // à mi-course du frein à main (12 pas : 0,5) : moyenne des deux
    const mi = angle(10, true, 11);
    expect(mi).toBeCloseTo((0.18203 + 0.39235 + ((0.1261 - 0.39235) * 10) / 25) / 2, 4);
    // volant à gauche : angle opposé
    const g = posee(0, -30);
    g.pas({ direction: -1 });
    expect(g.v.pneus.angle).toBeCloseTo(-0.53356, 2);
  });

  it("le volant agit avec un pas de retard : les pneus appliquent les réglages du pas précédent (RocketSim)", () => {
    const b = posee(0, -30);
    b.v.v[2] = 10;
    b.suite(6, { accel: 1 });
    const w0 = b.v.w[1];
    b.pas({ accel: 1, direction: 1 });
    expect(Math.abs(b.v.w[1] - w0)).toBeLessThan(0.01);
    b.pas({ accel: 1, direction: 1 });
    expect(b.v.w[1]).toBeLessThan(w0 - 0.2); // à droite : rotation négative autour de Y
  });

  it("frein à main analogique : monte en 0,2 s, retombe en 0,5 s, au sol comme en l'air (RocketSim handbrakeVal)", () => {
    for (const b of [posee(0, -30), enAir()]) {
      b.suite(12, { derapage: true });
      expect(b.v.frein).toBeCloseTo(0.5, 9);
      b.suite(12, { derapage: true });
      expect(b.v.frein).toBeCloseTo(1, 9);
      b.suite(30, { derapage: true });
      expect(b.v.frein).toBe(1);
      b.suite(30);
      expect(b.v.frein).toBeCloseTo(0.5, 9);
      b.suite(31);
      expect(b.v.frein).toBe(0);
    }
    const sol = posee(0, -30);
    sol.pas({ derapage: true });
    expect(sol.v.derapage).toBe(true);
    const air = enAir();
    air.pas({ derapage: true });
    expect(air.v.derapage).toBe(false); // `derapage` = frein à main efficace : il faut une roue au sol
  });

  it("adhérence latérale selon le glissement : une voiture qui glisse de côté n'a que 20 % d'adhérence (≈ 4,3 /s), 2 % au frein à main", () => {
    const b = posee(0, -30);
    b.v.v[0] = 10; // 10 m/s de côté (la voiture regarde +Z)
    b.suite(2);
    const v0 = Math.abs(b.v.v[0]);
    b.suite(24);
    const taux = Math.log(v0 / Math.abs(b.v.v[0])) / 0.2;
    expect(taux).toBeGreaterThan(3.6);
    expect(taux).toBeLessThan(5);
    expect(b.v.pneus.lat[0]).toBeCloseTo(0.2, 2);
    // frein à main à fond : adhérence × 0,1
    const c = posee(0, -30);
    c.suite(30, { derapage: true });
    c.v.v[0] = 10;
    c.suite(2, { derapage: true });
    const w0 = Math.abs(c.v.v[0]);
    c.suite(24, { derapage: true });
    const tauxFrein = Math.log(w0 / Math.abs(c.v.v[0])) / 0.2;
    expect(c.v.pneus.lat[0]).toBeCloseTo(0.02, 2);
    expect(tauxFrein).toBeLessThan(taux * 0.15);
    expect(tauxFrein).toBeGreaterThan(taux * 0.05);
    // une roue qui roule droit garde toute son adhérence
    const d = posee(0, -30);
    d.v.v[2] = 10;
    d.suite(3, { accel: 1 });
    expect(d.v.pneus.lat[0]).toBeCloseTo(1, 6);
  });

  it("frein à main : ni frein ni roue libre, et le gaz opposé ne freine pas, il pousse au moteur (RocketSim)", () => {
    const b = posee(0, -45);
    b.v.v[2] = 15;
    b.duree(1, { derapage: true });
    expect(b.vitAvant()).toBeGreaterThan(14.5); // sans frein à main : 9,75 m/s
    expect(b.v.pneus.frein).toBe(0);
    const c = posee(0, -45);
    c.v.v[2] = 10;
    c.duree(0.25, { derapage: true, accel: -1 });
    // le frein aurait retiré 8,75 m/s ; le moteur en marche arrière (5,7 m/s² à 10 m/s, × 0,5 à 0,9) en retire moins de 1,5
    expect(c.vitAvant()).toBeGreaterThan(8.5);
    expect(c.vitAvant()).toBeLessThan(9.9);
    expect(c.v.pneus.moteur).toBeLessThan(0);
  });

  it("frein à main : le lacet est plus vif et la voiture garde sa vitesse latérale (traces de pneus)", () => {
    const essai = (derapage: boolean) => {
      const b = banc(0, -40);
      b.duree(1.5, { accel: 1 });
      b.duree(0.5, { accel: 1, direction: 1, derapage });
      return { lacet: Math.abs(b.v.w[1]), lateral: Math.abs(dot(b.v.v, b.v.base.droite)) };
    };
    const glisse = essai(true), normal = essai(false);
    expect(glisse.lacet).toBeGreaterThan(normal.lacet * 1.2);
    expect(glisse.lateral).toBeGreaterThan(normal.lateral + 2);
  });

  it("sans gaz, l'adhérence fond avec la pente : arrêtée de travers sur un mur la voiture glisse, avec du gaz elle tient", () => {
    const surLeMur = () => {
      const b = banc(0, 0, 0, 8);
      // posée contre le mur +X : haut vers l'intérieur du stade, avant horizontal
      b.v.p = [STADE.demiLargeur - VOITURE.hauteurRepos, 8, 0];
      b.v.base = { avant: [0, 0, 1], droite: [0, -1, 0], haut: [-1, 0, 0] };
      return b;
    };
    const sans = surLeMur();
    sans.duree(1);
    expect(sans.v.rouesContact).toBe(4);
    expect(sans.v.p[1]).toBeLessThan(6.5);
    // adhérences × 0,1 sur une paroi verticale (RocketSim NON_STICKY_FRICTION_FACTOR_CURVE), en plus des 20 % du glissement
    expect(sans.v.pneus.lat[0]).toBeCloseTo(0.02, 3);
    expect(sans.v.pneus.long[0]).toBeCloseTo(0.1, 6);
    const avec = surLeMur();
    avec.duree(1, { accel: 1 });
    expect(avec.v.rouesContact).toBe(4);
    expect(avec.v.p[1]).toBeGreaterThan(7.5);
    expect(avec.v.v[2]).toBeGreaterThan(8);
  });
});

describe("voiture : saut, double saut, flip", () => {
  it("saut maintenu : sommet de l'origine entre 2,1 et 2,6 m, puis retour au sol", () => {
    const b = banc();
    b.duree(0.3);
    let apex = 0, vuEnLAir = false;
    for (let i = 0; i < 400; i++) {
      b.pas({ saut: i < 60 });
      apex = Math.max(apex, b.v.p[1]);
      if (!b.v.auSol && i > 20) vuEnLAir = true;
    }
    expect(vuEnLAir).toBe(true);
    expect(apex).toBeGreaterThan(2.1);
    expect(apex).toBeLessThan(2.6);
    expect(b.v.auSol).toBe(true);
    expect(b.evs.filter((e) => e.t === "saut")).toHaveLength(1);
    expect(b.evs.some((e) => e.t === "atterrissage")).toBe(true);
  });

  it("maintien du saut : exactement 24 pas bouton tenu, 3 pas à 62 % sur un appui bref (RocketSim JUMP_MAX_TIME / JUMP_MIN_TIME)", () => {
    const tenus = (pasAppuyes: number) => {
      const b = posee();
      let n = 0;
      for (let i = 0; i < 60; i++) { b.pas({ saut: i < pasAppuyes }); if (b.v.saut.tenue) n++; }
      return n;
    };
    expect(tenus(60)).toBe(24);
    expect(tenus(1)).toBe(3);
    expect(tenus(10)).toBe(10);
    // vitesse le long du haut juste après un saut tenu : impulsion + 3 pas à 62 % + 21 pas pleins, moins gravité et collage
    const b = posee();
    b.suite(24, { saut: true });
    const pousse = SAUT.impulsion + (SAUT.maintien / 120) * (3 * SAUT.echelleAvantMin + 21);
    expect(pousse).toBeCloseTo(5.695, 2);
    expect(b.v.v[1]).toBeLessThan(pousse - (24 * GRAVITE) / 120 + 0.001);
    expect(b.v.v[1]).toBeGreaterThan(pousse - (24 * GRAVITE) / 120 - 0.25); // le collage agit tant que les roues sont à portée du sol
  });

  it("saut court (bouton lâché tout de suite) : bien plus bas qu'un saut maintenu", () => {
    const b = banc();
    b.duree(0.3);
    let apex = 0;
    for (let i = 0; i < 300; i++) { b.pas({ saut: i < 2 }); apex = Math.max(apex, b.v.p[1]); }
    expect(apex).toBeGreaterThan(0.6);
    expect(apex).toBeLessThan(1.1);
  });

  it("un second appui pendant les premiers pas du saut ne coupe pas le maintien et ne dépense pas le second saut", () => {
    const b = posee();
    b.pas({ saut: true });
    b.pas();
    b.pas({ saut: true }); // les roues sont encore à portée du sol : ni double saut ni nouveau saut, le maintien continue
    expect(b.v.saut.tenue).toBe(true);
    expect(b.v.saut.secondUtilise).toBe(false);
    expect(b.evs.filter((e) => e.t === "saut")).toHaveLength(1);
    expect(b.evs.some((e) => e.t === "doubleSaut")).toBe(false);
  });

  it("au sol, l'état de saut n'est remis à zéro qu'après 0,05 s (RocketSim JUMP_MIN_TIME + JUMP_RESET_TIME_PAD)", () => {
    const b = posee();
    b.pas({ saut: true });
    // appui d'un pas : maintien de 3 pas, roues encore à portée du sol ; l'état « a sauté » survit aux pas 4 et 5
    b.suite(4);
    expect(b.v.auSol).toBe(true);
    expect(b.v.saut.tenue).toBe(false);
    expect(b.v.saut.aSaute).toBe(true);
    b.duree(1.5);
    expect(b.v.auSol).toBe(true);
    expect(b.v.saut.aSaute).toBe(false);
    expect(b.v.saut.temps).toBe(0);
  });

  it("le saut ne part qu'avec trois roues : sur une ou deux roues, l'appui est un double saut ou un dodge (RocketSim)", () => {
    const b = surDeuxRoues();
    b.pas({ saut: true });
    expect(b.v.rouesContact).toBe(2);
    expect(b.evs.some((e) => e.t === "saut")).toBe(false);
    expect(b.evs.some((e) => e.t === "doubleSaut")).toBe(true);
    expect(b.v.saut.aSaute).toBe(false);
    expect(b.v.saut.secondUtilise).toBe(true);
    const c = surDeuxRoues();
    c.pas({ saut: true, tangage: -1 });
    expect(c.evs.some((e) => e.t === "flip")).toBe(true);
    expect(c.evs.some((e) => e.t === "saut")).toBe(false);
  });

  it("double saut : la fenêtre de 1,25 s court depuis la FIN du premier saut (RL), pas depuis le décollage", () => {
    const essai = (delaiApresSaut: number, maintien: number) => {
      const b = banc();
      b.duree(0.3);
      for (let i = 0; i < maintien; i++) b.pas({ saut: true });
      b.pas(); // bouton relâché : fin du saut
      b.v.p[1] += 10; // assez haut pour rester en l'air pendant tout l'essai
      b.suite(Math.round(delaiApresSaut / PAS_S) - 1);
      expect(b.v.auSol).toBe(false);
      const vAvant = b.v.v[1];
      b.pas({ saut: true });
      return { gain: b.v.v[1] - vAvant, evs: b.evs };
    };
    for (const maintien of [2, 24]) {
      const ok = essai(1.2, maintien);
      expect(ok.evs.some((e) => e.t === "doubleSaut")).toBe(true);
      expect(ok.gain).toBeGreaterThan(2.5);
      const non = essai(1.3, maintien);
      expect(non.evs.some((e) => e.t === "doubleSaut" || e.t === "flip")).toBe(false);
      expect(non.gain).toBeLessThan(0.5);
    }
  });

  it("sans premier saut (chute d'un mur, bump), le saut reste disponible sans limite de temps (RL)", () => {
    const b = banc(0, 0, 0, 30);
    b.duree(2);
    expect(b.v.auSol).toBe(false);
    b.pas({ saut: true, tangage: -1 });
    expect(b.evs.some((e) => e.t === "flip")).toBe(true);
  });

  it("appui bref : la poussée du saut dure quand même 0,025 s à 62 % (RocketSim JUMP_MIN_TIME)", () => {
    const b = banc();
    b.duree(0.3);
    b.pas({ saut: true });
    b.suite(5);
    // 2,917 d'impulsion + 3 pas de poussée à 62 % (≈ 0,23) - 6 pas de gravité (≈ 0,33) et le collage tant que les roues sont à portée
    expect(b.v.v[1]).toBeGreaterThan(2.6);
    expect(b.v.v[1]).toBeLessThan(2.83);
  });

  it("un seul second saut par envol, et la fenêtre se rouvre au sol", () => {
    const b = banc();
    b.duree(0.3);
    b.pas({ saut: true }); b.suite(20);
    b.pas({ saut: true }); b.pas();
    b.pas({ saut: true }); b.pas();
    expect(b.evs.filter((e) => e.t === "doubleSaut")).toHaveLength(1);
    b.duree(4);
    expect(b.v.auSol).toBe(true);
    b.pas({ saut: true });
    expect(b.evs.filter((e) => e.t === "saut")).toHaveLength(2);
  });

  it("un décollage sans saut (chute) ouvre la même fenêtre : l'appui compte comme second saut", () => {
    const b = banc(0, 0, 0, 6);
    b.suite(5);
    expect(b.v.auSol).toBe(false);
    b.pas({ saut: true });
    expect(b.evs.some((e) => e.t === "doubleSaut")).toBe(true);
  });

  it("flip avant à 14 m/s : +5 m/s (échelle avant 1,0 de RL, indépendante de la vitesse)", () => {
    const b = banc(0, -30);
    b.v.v[2] = 14;
    b.pas({ saut: true }); b.suite(18, { saut: false });
    b.pas();
    const avant = dot(b.v.v, [0, 0, 1]);
    b.pas({ saut: true, tangage: -1 });
    const gain = dot(b.v.v, [0, 0, 1]) - avant;
    expect(gain).toBeGreaterThan(4.8);
    expect(gain).toBeLessThan(5.2);
    const flip = b.evs.find((e) => e.t === "flip");
    expect(flip && flip.t === "flip" && flip.dir[0]).toBeCloseTo(1, 5);
  });

  it("flip arrière à 14 m/s : freine de ≈ 10,2 m/s ; flip latéral : 5 m/s à l'arrêt, 7,7 m/s (échelle 1,9) à 14 m/s", () => {
    const arriere = banc(0, -30);
    arriere.v.v[2] = 14;
    arriere.pas({ saut: true }); arriere.suite(18);
    const av = arriere.v.v[2];
    arriere.pas({ saut: true, tangage: 1 });
    expect(av - arriere.v.v[2]).toBeGreaterThan(9.8);
    expect(av - arriere.v.v[2]).toBeLessThan(10.6);
    const cote = banc(0, -30);
    cote.pas({ saut: true }); cote.suite(18);
    cote.pas({ saut: true, direction: 1 });
    expect(cote.v.v[0]).toBeLessThan(-4.5); // droite = -X quand on regarde +Z
    expect(cote.v.v[0]).toBeGreaterThan(-5.5);
    const coteRapide = banc(0, -30);
    coteRapide.v.v[2] = 14;
    coteRapide.pas({ saut: true }); coteRapide.suite(18);
    coteRapide.pas({ saut: true, direction: 1 });
    expect(coteRapide.v.v[0]).toBeLessThan(-7.4);
    expect(coteRapide.v.v[0]).toBeGreaterThan(-8.1);
  });

  it("dodge latéral : la poussée suit la perpendiculaire horizontale de l'avant, jamais la droite de la voiture (RocketSim)", () => {
    // voiture penchée de 100° sur la droite : sa droite pointe vers le bas et un peu à GAUCHE ; le dodge à droite part quand même à droite
    const b = enAir();
    pencher(b.v.base, (100 * Math.PI) / 180);
    expect(b.v.base.droite[0]).toBeGreaterThan(0.1); // droite de la voiture : vers +X (la gauche du cap)
    b.pas({ saut: true, lacet: 1 });
    expect(b.v.v[0]).toBeCloseTo(-FLIP.impulsionBase, 6); // droite du cap 0 = -X
    expect(b.v.v[2]).toBeCloseTo(0, 6);
  });

  it("dodge : le rapport de vitesse lit la vitesse le long de l'avant en 3D (RocketSim forwardSpeed)", () => {
    // nez levé de 60°, 20 m/s le long du nez : rapport 20 / 23 (et non 10 / 23 à l'horizontale), échelle latérale 1 + 0,9 × 20 / 23
    const b = enAir();
    const a = Math.PI / 3;
    b.v.base = { avant: [0, Math.sin(a), Math.cos(a)], droite: [-1, 0, 0], haut: [0, Math.cos(a), -Math.sin(a)] };
    b.v.v = [0, 20 * Math.sin(a), 20 * Math.cos(a)];
    b.pas({ saut: true, lacet: 1 });
    expect(b.v.v[0]).toBeCloseTo(-FLIP.impulsionBase * (1 + (0.9 * 20) / 23), 6);
  });

  it("flipEstArriere suit le sens de la marche (RocketSim)", () => {
    expect(flipEstArriere(-1, 0)).toBe(true);
    expect(flipEstArriere(1, 0)).toBe(false);
    expect(flipEstArriere(1, 14)).toBe(false);
    expect(flipEstArriere(-1, 14)).toBe(true);
    expect(flipEstArriere(1, -14)).toBe(true); // vers l'avant en marche arrière : « arrière » pour RL
    expect(flipEstArriere(-1, -14)).toBe(false);
  });

  it("flip : couple pendant 78 pas à partir du pas qui suit l'appui, plafond de 5,5 rad/s APRÈS l'intégration : ≈ 269° de rotation, ≈ 330° à 0,95 s", () => {
    const b = banc(0, -30, 0, 12); // lancé en l'air : pas de contact avec le sol pendant l'essai
    b.v.v[2] = 10;
    b.suite(6);
    const tangage = () => dot(b.v.w, b.v.base.droite);
    b.pas({ saut: true, tangage: -1 });
    // au pas de l'appui : l'impulsion, pas encore le couple du dodge ; le contrôle aérien ordinaire agit encore (manche poussé)
    const w0 = AIR.coupleTangage / 120;
    expect(Math.abs(tangage())).toBeCloseTo(w0, 9);
    let rotation = 0, wMax = 0, pasCouple = 0;
    const pas = () => {
      const avant0 = [...b.v.base.avant] as Vec3;
      const actif = b.v.flip.actif;
      b.pas();
      if (actif && b.v.flip.actif) pasCouple++; // le flip était actif à l'entrée du pas et l'est resté : le couple a été appliqué
      rotation += ecartDeg(b.v.base.avant, avant0);
      wMax = Math.max(wMax, norme(b.v.w));
    };
    pas();
    // premier pas de couple : 224 rad/s² pendant 1/120 s, sans contrôle ni amortissement
    expect(Math.abs(tangage())).toBeCloseTo(w0 + FLIP.coupleTangage / 120, 6);
    for (let i = 1; i < 78; i++) pas();
    expect(b.v.flip.actif).toBe(true);
    // 78 pas de couple : la vitesse est ramenée à 5,5 rad/s après chaque pas, mais chaque pas tourne à 5,5 + 224 / 120 = 7,37 rad/s
    expect(wMax).toBeLessThanOrEqual(5.5 + 1e-9);
    const attendu = ((3 * w0 + (224 / 120) * (1 + 2 + 3) + 75 * (5.5 + 224 / 120)) / 120) * (180 / Math.PI);
    expect(attendu).toBeCloseTo(269.3, 1);
    expect(rotation).toBeCloseTo(attendu, 1);
    pas();
    expect(b.v.flip.actif).toBe(false); // 79ᵉ pas : plus de couple (RocketSim FLIP_TORQUE_TIME, compté en simple précision)
    expect(pasCouple).toBe(78);
    // puis la vitesse résiduelle s'amortit (2,876 /s) sans être remise à zéro d'un coup : ≈ 330° à 0,95 s, ≈ 354° à 1,2 s
    expect(norme(b.v.w)).toBeGreaterThan(5.3);
    for (let i = 79; i < 114; i++) pas();
    expect(rotation).toBeGreaterThan(326);
    expect(rotation).toBeLessThan(334);
    for (let i = 114; i < 144; i++) pas();
    expect(rotation).toBeGreaterThan(349);
    expect(rotation).toBeLessThan(357);
    expect(norme(b.v.w)).toBeLessThan(1.5);
  });

  it("le flip « flotte » : amortissement vertical appliqué AVANT la gravité du pas, la voiture descend à 0,155 m/s (RocketSim)", () => {
    const b = banc(0, -30, 0, 12);
    b.v.v[1] = 0;
    b.suite(6);
    const y0 = b.v.p[1];
    b.pas({ saut: true, tangage: -1 });
    b.duree(0.5);
    // régime établi : v = 0,65 × v - g·dt, soit -g·dt / 0,35 = -0,1548 m/s (et non -0,1006 si la gravité du pas était amortie)
    expect(b.v.v[1]).toBeCloseTo(-(GRAVITE / 120) / FLIP.amortissementVertical, 3);
    b.duree(0.1);
    expect(Math.abs(b.v.v[1])).toBeLessThan(0.6);
    expect(y0 - b.v.p[1]).toBeLessThan(0.4);
  });

  it("le tangage est verrouillé jusqu'à 0,95 s après le début du flip", () => {
    const rotation = (tangage: number) => {
      const b = banc(0, -30, 0, 14);
      b.v.v[2] = 10;
      b.suite(6);
      b.pas({ saut: true, tangage: -1 });
      expect(b.v.flip.verrouTangage).toBeGreaterThan(0.9);
      b.duree(0.7);
      b.duree(0.2, { tangage });
      return dot(b.v.w, b.v.base.droite);
    };
    // pendant le verrou, le manche de tangage n'a aucun effet
    expect(rotation(1)).toBeCloseTo(rotation(0), 6);
    // le verrou tombe à 0,95 s (114 pas) : au-delà le manche reprend la main
    const b = banc(0, -30, 0, 14);
    b.suite(6);
    b.pas({ saut: true, tangage: -1 });
    b.suite(113);
    expect(b.v.flip.verrouTangage).toBeGreaterThan(0);
    b.suite(2);
    expect(b.v.flip.verrouTangage).toBe(0);
  });

  it("annulation du flip : tirer le manche à l'opposé coupe le couple de tangage, la rotation s'amortit", () => {
    const rotation = (annuler: boolean) => {
      const b = banc(0, -30);
      b.v.v[2] = 10;
      b.pas({ saut: true }); b.suite(18);
      b.pas({ saut: true, tangage: -1 });
      b.suite(2, { tangage: annuler ? 1 : -1 });
      b.duree(0.6, { tangage: annuler ? 1 : -1 });
      return Math.acos(Math.max(-1, Math.min(1, b.v.base.haut[1])));
    };
    expect(rotation(false)).toBeGreaterThan(1.8);
    expect(rotation(true)).toBeLessThan(1.2);
  });

  it("speed flip : un flip en diagonale annulé garde son tonneau et perd son tangage (RL : seul le tangage s'annule)", () => {
    const b = banc(0, -30, 0, 14);
    b.v.v[2] = 20;
    b.suite(6);
    b.pas({ saut: true, tangage: -1, lacet: 1 }); // dodge avant droit
    const f = b.evs.find((e) => e.t === "flip");
    expect(f && f.t === "flip" && f.dir[0]).toBeCloseTo(Math.SQRT1_2, 5);
    // impulsion : avant + côté
    expect(dot(b.v.v, b.v.base.droite)).toBeGreaterThan(4);
    b.duree(0.45, { tangage: 1 }); // manche tiré : annulation
    const roulis = Math.abs(dot(b.v.w, b.v.base.avant)), tangage = Math.abs(dot(b.v.w, b.v.base.droite));
    expect(roulis).toBeGreaterThan(5);
    expect(tangage).toBeLessThan(1.5);
    // le nez n'a pas plongé : la voiture file à plat en tonneau
    expect(Math.abs(b.v.base.avant[1])).toBeLessThan(0.6);
  });

  it("le flip écrase la vitesse verticale", () => {
    const b = banc(0, -30);
    b.pas({ saut: true }); b.suite(24, { saut: true });
    b.suite(30);
    const vy = b.v.v[1];
    b.pas({ saut: true, tangage: -1 });
    b.duree(0.25);
    // sans amortissement la vitesse aurait changé de -g·0,25 = -1,6 seulement ; elle s'est effondrée vers 0 puis la gravité reprend
    expect(Math.abs(b.v.v[1])).toBeLessThan(Math.abs(vy) * 0.6 + 1.8);
  });

  it("stall : lacet et roulis opposés au flip = ni impulsion ni couple, la voiture reste pilotable (RL)", () => {
    const b = banc(0, -30);
    b.v.v[2] = 14;
    b.pas({ saut: true }); b.suite(18);
    const vz = b.v.v[2];
    b.pas({ saut: true, lacet: -1, roulis: 1 }); // lacet et roulis opposés : direction du dodge nulle
    const f = b.evs.find((e) => e.t === "flip");
    expect(f && f.t === "flip" && f.stall).toBe(true);
    expect(b.v.v[2]).toBeCloseTo(vz, 1);
    expect(b.v.flip.verrouTangage).toBeGreaterThan(0.9);
    b.duree(0.2);
    expect(Math.hypot(b.v.w[0], b.v.w[1], b.v.w[2])).toBeLessThan(0.5);
    b.duree(0.2, { roulis: 1 });
    expect(Math.abs(dot(b.v.w, b.v.base.avant))).toBeGreaterThan(3);
  });
});

describe("voiture : contrôle aérien", () => {
  it("couples et amortissements de RocketSim : 130 / 95 / 400 et 30 / 20 / 50 × CAR_TORQUE_SCALE", () => {
    expect(AIR.coupleTangage).toBeCloseTo(12.4636, 4);
    expect(AIR.coupleLacet).toBeCloseTo(9.108, 4);
    expect(AIR.coupleRoulis).toBeCloseTo(38.3495, 4);
    expect(AIR.amortTangage).toBeCloseTo(2.8762, 4);
    expect(AIR.amortLacet).toBeCloseTo(1.9175, 4);
    expect(AIR.amortRoulis).toBeCloseTo(4.7937, 4);
    // un pas d'entrée pleine depuis l'arrêt = couple / 120
    const t = enAir(); t.pas({ tangage: 1 });
    expect(dot(t.v.w, t.v.base.droite)).toBeCloseTo(AIR.coupleTangage / 120, 9);
    const l = enAir(); l.pas({ lacet: 1 });
    expect(dot(l.v.w, l.v.base.haut)).toBeCloseTo(-AIR.coupleLacet / 120, 9);
    const r = enAir(); r.pas({ roulis: 1 });
    expect(dot(r.v.w, r.v.base.avant)).toBeCloseTo(AIR.coupleRoulis / 120, 9);
  });

  it("l'amortissement du roulis agit toujours, même manche à fond ; ceux du tangage et du lacet sont levés par l'entrée (RocketSim)", () => {
    const r = enAir();
    r.v.w = [0, 0, 3]; // 3 rad/s autour de l'avant (+Z)
    r.pas({ roulis: 1 });
    expect(dot(r.v.w, r.v.base.avant)).toBeCloseTo(3 + (AIR.coupleRoulis - AIR.amortRoulis * 3) / 120, 6);
    const t = enAir();
    t.v.w = [-3, 0, 0]; // 3 rad/s autour de la droite (-X)
    t.pas({ tangage: 1 });
    expect(dot(t.v.w, t.v.base.droite)).toBeCloseTo(3 + AIR.coupleTangage / 120, 6);
    const s = enAir();
    s.v.w = [-3, 0, 0];
    s.pas();
    expect(dot(s.v.w, s.v.base.droite)).toBeCloseTo(3 - (AIR.amortTangage * 3) / 120, 6);
  });

  it("roulis tenu depuis l'arrêt : 130° en 0,5 s, plafond de 5,5 rad/s atteint vers 0,24 s (RocketSim)", () => {
    const b = enAir();
    let angle = 0, pasPlafond = -1;
    for (let i = 0; i < 60; i++) {
      const haut0 = [...b.v.base.haut] as Vec3;
      b.pas({ roulis: 1 });
      angle += ecartDeg(b.v.base.haut, haut0);
      if (pasPlafond < 0 && norme(b.v.w) >= 5.5 - 1e-9) pasPlafond = i + 1;
    }
    expect(angle).toBeGreaterThan(129);
    expect(angle).toBeLessThan(131);
    expect(pasPlafond).toBeGreaterThanOrEqual(28);
    expect(pasPlafond).toBeLessThanOrEqual(29);
  });

  it("plafond de 5,5 rad/s appliqué APRÈS l'intégration : le pas tourne avec la vitesse non plafonnée (RocketSim)", () => {
    const b = enAir();
    b.v.w = [-5.5, 0, 0]; // 5,5 rad/s en tangage (nez vers le haut)
    const avant0 = [...b.v.base.avant] as Vec3;
    b.pas({ tangage: 1 });
    expect(norme(b.v.w)).toBeCloseTo(5.5, 9);
    expect((ecartDeg(b.v.base.avant, avant0) * Math.PI) / 180).toBeCloseTo((5.5 + AIR.coupleTangage / 120) / 120, 6);
  });

  it("tangage max 5,5 rad/s atteint en moins de 0,6 s ; le roulis est plus rapide", () => {
    const tang = enAir();
    let t = -1;
    for (let i = 0; i < 120 && t < 0; i++) { tang.pas({ tangage: 1 }); if (Math.abs(dot(tang.v.w, tang.v.base.droite)) >= 5.49) t = tang.t(); }
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(0.6);
    const roul = enAir();
    let tr = -1;
    for (let i = 0; i < 120 && tr < 0; i++) { roul.pas({ roulis: 1 }); if (Math.abs(dot(roul.v.w, roul.v.base.avant)) >= 5.49) tr = roul.t(); }
    expect(tr).toBeGreaterThan(0);
    expect(tr).toBeLessThan(t);
    tang.duree(1, { tangage: 1 });
    expect(norme(tang.v.w)).toBeLessThanOrEqual(5.5000001);
  });

  it("signes : tangage +1 nez en haut, lacet +1 à droite, roulis +1 penche à droite", () => {
    const a = enAir(); a.duree(0.3, { tangage: 1 });
    expect(a.v.base.avant[1]).toBeGreaterThan(0.3);
    const b = enAir(); b.duree(0.3, { lacet: 1 });
    expect(b.v.base.avant[0]).toBeLessThan(-0.1); // à droite = -X
    const c = enAir(); c.duree(0.3, { roulis: 1 });
    expect(dot(c.v.base.haut, [-1, 0, 0])).toBeGreaterThan(0.3); // le haut penche vers la droite (-X)
  });

  it("sans entrée la rotation s'amortit ; en dérapage le volant devient roulis (air roll libre)", () => {
    const a = enAir(); a.v.w = [0, 0, 3];
    a.duree(1);
    expect(norme(a.v.w)).toBeLessThan(2);
    const b = enAir(); b.duree(0.3, { derapage: true, direction: 1 });
    expect(dot(b.v.base.haut, [-1, 0, 0])).toBeGreaterThan(0.3);
    expect(b.v.base.avant[0]).toBeGreaterThan(-0.05); // pas de lacet
  });

  it("le boost en l'air pousse le long de l'avant, sans effet à boost = 0", () => {
    const b = enAir(); b.v.boost = 100; b.v.base = baseDepuisCap(0);
    b.duree(0.5, { boost: true });
    expect(b.v.v[2]).toBeGreaterThan(4);
    const c = enAir(); c.v.boost = 0;
    c.duree(0.5, { boost: true });
    expect(c.v.v[2]).toBeCloseTo(0, 5);
  });

  it("une ou deux roues au sol : ni couple ni amortissement de contrôle aérien, mais le gaz en l'air pousse encore (RocketSim)", () => {
    const etat = (e: Partial<EntreesVoiture>) => { const b = surDeuxRoues(); b.pas(e); return b.v; };
    const neutre = etat({}), roulis = etat({ roulis: 1, tangage: 1, lacet: 1 });
    expect(neutre.rouesContact).toBe(2);
    for (let i = 0; i < 3; i++) expect(roulis.w[i]).toBeCloseTo(neutre.w[i], 12);
    // le gaz : 0,667 m/s² le long de l'avant (les pneus, eux, n'ont pas encore de moteur : réglages du pas précédent)
    const gaz = etat({ accel: 1 });
    expect(dot(gaz.v, gaz.base.avant) - dot(neutre.v, neutre.base.avant)).toBeCloseTo(AIR.gazAerien / 120, 9);
    expect(AIR.gazAerien).toBeCloseTo(0.66667, 4);
    // et le moteur est divisé par 4 avec moins de trois roues (RocketSim : driveSpeedScale /= 4)
    expect(gaz.pneus.moteur).toBeCloseTo(1, 2);
  });
});

describe("voiture : murs, plafond, retournement", () => {
  it("lancée à 15 m/s vers le mur latéral, elle reste en contact ≥ 95 % des pas en montant (boost)", () => {
    const b = banc(20, 0, Math.PI / 2); // regarde +X
    b.v.v[0] = 15;
    b.v.boost = 100;
    let pas = 0, contact = 0;
    for (let i = 0; i < 360 && b.v.p[1] < 15; i++) {
      b.pas({ accel: 1, boost: true });
      pas++;
      if (b.v.rouesContact >= 1) contact++;
      if (i % 40 === 0) b.v.boost = 100;
    }
    expect(contact / pas).toBeGreaterThanOrEqual(0.95);
    expect(b.v.p[1]).toBeGreaterThanOrEqual(15);
    expect(b.v.auSol).toBe(true);
  });

  it("à pleine vitesse (23 m/s) elle passe le raccord sol → mur sans décrocher, malgré le plafond de 5,5 rad/s", () => {
    const b = banc(10, 0, Math.PI / 2);
    b.v.v[0] = 23;
    let pas = 0, contact = 0, wMax = 0;
    for (let i = 0; i < 240 && b.v.p[1] < 12; i++) {
      b.v.boost = 100;
      b.pas({ accel: 1, boost: true });
      pas++;
      if (b.v.rouesContact >= 3) contact++;
      wMax = Math.max(wMax, norme(b.v.w));
    }
    expect(b.v.p[1]).toBeGreaterThanOrEqual(12);
    expect(contact / pas).toBeGreaterThanOrEqual(0.95);
    expect(b.vit()).toBeGreaterThan(17);
    expect(b.v.base.haut[0]).toBeLessThan(-0.95);
    // le raccord de 2,56 m demande 23 / 2,56 ≈ 9 rad/s : la rotation donnée par les roues n'est plafonnée qu'après l'intégration suivante
    expect(wMax).toBeGreaterThan(7);
  });

  it("à 8 m/s le sol → mur ne décroche pas non plus (vitesse moyenne)", () => {
    const b = banc(30, 0, Math.PI / 2);
    b.v.v[0] = 9;
    let pas = 0, contact = 0, hmax = 0;
    for (let i = 0; i < 300; i++) {
      b.pas({ accel: 1 });
      pas++;
      if (b.v.rouesContact >= 1) contact++;
      hmax = Math.max(hmax, b.v.p[1]);
    }
    expect(contact / pas).toBeGreaterThanOrEqual(0.95);
    expect(hmax).toBeGreaterThan(1.5);
  });

  it("la voiture suit la normale de la surface : sur le mur, son haut regarde l'intérieur du stade", () => {
    const b = banc(20, 0, Math.PI / 2);
    b.v.v[0] = 15;
    b.v.boost = 100;
    for (let i = 0; i < 200; i++) { b.pas({ accel: 1, boost: true }); if (i % 40 === 0) b.v.boost = 100; if (b.v.p[1] > 6 && b.v.auSol) break; }
    expect(b.v.p[1]).toBeGreaterThan(3);
    expect(b.v.auSol).toBe(true);
    expect(b.v.base.haut[0]).toBeLessThan(-0.8);
    expect(Math.abs(b.v.base.haut[1])).toBeLessThan(0.45);
  });

  it("le mur monte jusqu'au plafond, mais on n'y roule pas : le collage (3,25 m/s²) ne vaut pas la gravité, la voiture en tombe (RL)", () => {
    const b = banc(20, 0, Math.PI / 2);
    b.v.v[0] = 15;
    let auPlafond = 0, tombee = false;
    for (let i = 0; i < 720; i++) {
      b.v.boost = 100;
      b.pas({ accel: 1, boost: true });
      if (b.v.base.haut[1] < -0.9 && b.v.auSol) auPlafond++;
      if (auPlafond > 0 && b.v.rouesContact === 0) { tombee = true; break; }
    }
    // elle passe le raccord mur → plafond les roues collées, roule quelques mètres sous le plafond, puis s'en détache
    expect(auPlafond).toBeGreaterThan(10);
    expect(auPlafond).toBeLessThan(120);
    expect(tombee).toBe(true);
    expect(b.v.p[1]).toBeGreaterThan(STADE.hauteur - 1);
    b.duree(0.5);
    expect(b.v.p[1]).toBeLessThan(STADE.hauteur - 1);
  });

  it("collage : demi-gravité au sol, 1,5 gravité sur un mur avec du gaz, demi-gravité seulement sans gaz à l'arrêt (RocketSim)", () => {
    // au sol, voiture soulevée de 5 cm (roues à portée, pas en appui) : gravité + collage = 9,75 m/s² vers le sol
    const sol = banc(0, 0, 0, VOITURE.hauteurRepos + 0.05);
    sol.pas();
    expect(sol.v.rouesContact).toBe(4);
    expect(sol.v.v[1]).toBeCloseTo((-(1 + CONDUITE.collage) * GRAVITE) / 120, 9);
    // contre le mur +X, à 5 cm : vers le mur, 0,5 g sans gaz à l'arrêt, 1,5 g avec du gaz
    const mur = (accel: number) => {
      const b = banc(0, 0, 0, 8);
      b.v.p = [STADE.demiLargeur - VOITURE.hauteurRepos - 0.05, 8, 0];
      b.v.base = { avant: [0, 1, 0], droite: [0, 0, 1], haut: [-1, 0, 0] };
      b.pas({ accel });
      return b.v.v[0];
    };
    expect(mur(0)).toBeCloseTo((0.5 * GRAVITE) / 120, 6);
    expect(mur(1)).toBeCloseTo((1.5 * GRAVITE) / 120 + 0, 2);
  });

  it("saut depuis le mur : la voiture s'écarte de la paroi", () => {
    const b = banc(20, 0, Math.PI / 2);
    b.v.v[0] = 15; b.v.boost = 100;
    for (let i = 0; i < 300; i++) { b.pas({ accel: 1, boost: true }); b.v.boost = 100; if (b.v.p[1] > 5 && b.v.auSol) break; }
    expect(b.v.auSol).toBe(true);
    const x0 = b.v.p[0];
    b.pas({ saut: true }); b.suite(30, { saut: true });
    expect(b.v.auSol).toBe(false);
    expect(b.v.p[0]).toBeLessThan(x0 - 0.3);
  });

  it("chute du plafond : elle retombe et finit sur ses roues ou sur le toit sans traverser le stade", () => {
    const b = banc(0, 0, 0, STADE.hauteur - 0.18);
    b.v.base = { avant: [0, 0, 1], droite: [1, 0, 0], haut: [0, -1, 0] };
    b.duree(4);
    expect(b.v.p[1]).toBeGreaterThan(0.1);
    expect(b.v.p[1]).toBeLessThan(STADE.hauteur);
  });

  it("sur le toit : la caisse touche le sol (contact noté pour le pas suivant), le roulis vaut π", () => {
    const b = surLeToit();
    expect(b.v.auSol).toBe(false);
    expect(b.v.rouesContact).toBe(0);
    expect(b.v.base.haut[1]).toBeLessThan(-0.9);
    expect(b.vit()).toBeLessThan(0.5);
    expect(b.v.contactMonde.actif).toBe(true);
    expect(b.v.contactMonde.normale[1]).toBeGreaterThan(0.99);
    expect(Math.abs(angleRoulis(b.v.base))).toBeGreaterThan(3.1);
    // à plat sur ses roues : la caisse ne touche rien, roulis nul
    const p = posee();
    expect(p.v.contactMonde.actif).toBe(false);
    expect(angleRoulis(p.v.base)).toBeCloseTo(0, 2);
  });

  it("redressement sur le toit : 2 m/s le long de -haut, 50 rad/s² autour de l'avant pendant 0,4 s × |roulis| / π, puis retour sur les roues", () => {
    const b = surLeToit();
    const vy = b.v.v[1];
    b.pas({ saut: true });
    expect(b.v.redressement.actif).toBe(true);
    // impulsion le long de -haut (vers le sol... donc vers le HAUT du monde, la voiture étant sur le dos), moins la gravité du pas
    expect(b.v.v[1] - vy).toBeCloseTo(CONDUITE.redressement.impulsion - GRAVITE / 120, 2);
    // premier pas de couple : 50 rad/s² autour de l'avant, pas de tangage
    expect(Math.abs(dot(b.v.w, b.v.base.avant))).toBeCloseTo(CONDUITE.redressement.couple / 120, 1);
    expect(Math.abs(dot(b.v.w, b.v.base.droite))).toBeLessThan(0.05);
    // l'état de saut n'est pas touché, et le second saut n'est pas dépensé par cet appui
    expect(b.v.saut.aSaute).toBe(false);
    expect(b.v.saut.secondUtilise).toBe(false);
    let pasCouple = 1, angle = 0, wMax = 0;
    while (b.v.redressement.actif && pasCouple < 200) {
      const haut0 = [...b.v.base.haut] as Vec3;
      b.pas();
      angle += ecartDeg(b.v.base.haut, haut0);
      wMax = Math.max(wMax, norme(b.v.w));
      if (b.v.redressement.actif) pasCouple++;
    }
    // roulis de π : 0,4 s, 48 pas de couple (RocketSim CAR_AUTOFLIP_TIME), ≈ 120° parcourus, plafond de 5,5 rad/s respecté
    expect(pasCouple).toBeGreaterThanOrEqual(47);
    expect(pasCouple).toBeLessThanOrEqual(49);
    expect(angle).toBeGreaterThan(110);
    expect(angle).toBeLessThan(128);
    expect(wMax).toBeLessThanOrEqual(5.5 + 1e-9);
    b.duree(2);
    expect(b.v.auSol).toBe(true);
    expect(b.v.base.haut[1]).toBeGreaterThan(0.95);
    expect(b.v.redressement.actif).toBe(false);
  });

  it("redressement : ni dodge ni contrôle aérien pendant le couple ; rien si la caisse ne touche pas ou si le roulis est sous 2,8 rad", () => {
    const b = surLeToit();
    b.pas({ saut: true });
    b.suite(3);
    b.pas({ saut: true, tangage: -1 }); // nouvel appui pendant le redressement : pas de dodge
    expect(b.evs.some((e) => e.t === "flip" || e.t === "doubleSaut")).toBe(false);
    // contrôle aérien coupé : le manche de lacet ne change rien
    const sansManche = surLeToit(); sansManche.pas({ saut: true }); sansManche.suite(10);
    const avecManche = surLeToit(); avecManche.pas({ saut: true }); avecManche.suite(10, { lacet: 1, tangage: 1 });
    for (let i = 0; i < 3; i++) expect(avecManche.v.w[i]).toBeCloseTo(sansManche.v.w[i], 9);
    // en l'air sur le dos, sans contact de la caisse : l'appui est un double saut, pas un redressement
    const air = enAir();
    air.v.base = { avant: [0, 0, 1], droite: [1, 0, 0], haut: [0, -1, 0] };
    air.pas({ saut: true });
    expect(air.v.redressement.actif).toBe(false);
    expect(air.evs.some((e) => e.t === "doubleSaut")).toBe(true);
    // couchée sur le flanc (roulis π/2 < 2,8 rad), la caisse au sol : pas de redressement
    const flanc = banc(0, 0, 0, 1);
    flanc.v.base = { avant: [0, 0, 1], droite: [0, -1, 0], haut: [-1, 0, 0] };
    flanc.duree(1.5);
    if (flanc.v.contactMonde.actif && Math.abs(angleRoulis(flanc.v.base)) < 2.8) {
      flanc.pas({ saut: true });
      expect(flanc.v.redressement.actif).toBe(false);
    }
  });

  it("sur le toit sans saut, elle reste retournée (le saut est le seul redressement)", () => {
    const b = banc(0, 0, 0, 1.5);
    b.v.base = { avant: [0, 0, 1], droite: [1, 0, 0], haut: [0, -1, 0] };
    b.duree(4);
    expect(b.v.base.haut[1]).toBeLessThan(-0.9);
  });

  it("atterrit sur les roues après une chute avec un peu de roulis", () => {
    const b = banc(0, 0, 0, 5);
    b.v.base = { avant: [0, 0, 1], droite: [-0.9, -0.43, 0], haut: [0, 0.9, 0] };
    b.v.base = baseOrthonorme(b.v.base);
    b.duree(2);
    expect(b.v.auSol).toBe(true);
    expect(b.v.base.haut[1]).toBeGreaterThan(0.95);
  });

  it("alignement sur la surface (auto-roll) : sur deux roues, le gaz ramène la voiture à plat plus vite que sans gaz", () => {
    const roulisApres = (accel: number, pas: number) => {
      const b = banc(0, 0, 0, 0.45);
      pencher(b.v.base, 0.9);
      b.suite(pas, { accel });
      return Math.abs(angleRoulis(b.v.base));
    };
    // à 0,25 s : avec du gaz la voiture est presque à plat, sans gaz elle penche encore nettement
    expect(roulisApres(1, 30)).toBeLessThan(0.25);
    expect(roulisApres(0, 30)).toBeGreaterThan(0.45);
    expect(roulisApres(1, 60)).toBeLessThan(0.05);
    // le sens : penchée de l'autre côté, elle revient aussi
    const g = banc(0, 0, 0, 0.45);
    pencher(g.v.base, -0.9);
    g.suite(60, { accel: 1 });
    expect(Math.abs(angleRoulis(g.v.base))).toBeLessThan(0.05);
  });

  it("auto-roll : 80 rad/s² × défaut d'alignement et 1 m/s² vers la surface, seulement avec du gaz (RocketSim CAR_AUTOROLL_*)", () => {
    // deux roues à portée du sol mais pas en appui (5 cm de garde) : aucune impulsion de contact ne brouille la mesure
    const dw = (accel: number) => {
      const b = surDeuxRoues(0.05);
      b.pas({ accel });
      return b.v;
    };
    expect(dw(0).rouesContact).toBe(2);
    const sans = dw(0), avec = dw(1);
    // penchée de 0,7 rad sur la droite : défaut d'alignement latéral 1 - cos(0,7), couple autour de l'avant qui relève le côté droit
    const attendu = (CONDUITE.autoRoll.couple * (1 - Math.cos(0.7))) / 120;
    expect(attendu).toBeCloseTo(0.1568, 3);
    // + autour de l'avant : le côté droit (le bas) remonte
    expect(dot(avec.w, avec.base.avant) - dot(sans.w, sans.base.avant)).toBeCloseTo(attendu, 6);
    expect(dot(avec.w, avec.base.droite) - dot(sans.w, sans.base.droite)).toBeCloseTo(0, 6);
    // la force vers la surface : 1 m/s² vers le bas en plus
    expect(sans.v[1] - avec.v[1]).toBeCloseTo(CONDUITE.autoRoll.force / 120, 6);
  });

  it("roues posées sur la balle : elles comptent pour le moteur (÷ 4 sous trois roues) et pour l'auto-roll (1 à 3 roues), comme le numWheelsInContact de RocketSim", () => {
    // voiture en l'air, loin du décor : seules les roues notées sur la balle « touchent » (normale de la balle : verticale)
    const essai = (sur: [boolean, boolean, boolean, boolean], roulis = 0) => {
      const b = enAir();
      if (roulis) pencher(b.v.base, roulis);
      b.v.rouesBalle = sur;
      b.v.normalesRouesBalle = [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]];
      b.pas({ accel: 1 });
      return b.v;
    };
    const parRoue = interpolerTable(CONDUITE.courbeGaz, 0) / 4;
    // trois roues sur la balle : « au sol » sans aucune roue sur le décor, le moteur du pas suivant est ENTIER
    const trois = essai([true, true, true, false]);
    expect(trois.rouesContact).toBe(0);
    expect(trois.auSol).toBe(true);
    expect(trois.pneus.moteur).toBeCloseTo(parRoue, 12);
    // deux roues, ou aucune : divisé par 4
    expect(essai([true, true, false, false]).pneus.moteur).toBeCloseTo(parRoue / 4, 12);
    expect(essai([false, false, false, false]).pneus.moteur).toBeCloseTo(parRoue / 4, 12);

    // auto-roll, voiture penchée de 0,7 rad : avec une à trois roues sur la balle, 80 rad/s² × (1 - cos 0,7) autour de l'avant et
    // 1 m/s² vers la surface (ici la normale de la balle, verticale)
    const attendu = (CONDUITE.autoRoll.couple * (1 - Math.cos(0.7))) / 120;
    for (const sur of [[true, false, false, false], [true, true, false, false], [true, true, true, false]] as [boolean, boolean, boolean, boolean][]) {
      const v = essai(sur, 0.7);
      expect(dot(v.w, v.base.avant)).toBeCloseTo(attendu, 6);
      expect(dot(v.w, v.base.droite)).toBeCloseTo(0, 6);
      expect(v.v[1]).toBeCloseTo(-(GRAVITE + CONDUITE.autoRoll.force) / 120, 9);
    }
    // quatre roues sur la balle : plus d'auto-roll (RocketSim : numWheelsInContact < 4), et pas de contrôle aérien non plus
    const quatre = essai([true, true, true, true], 0.7);
    expect(norme(quatre.w)).toBe(0);
    expect(quatre.v[1]).toBeCloseTo(-GRAVITE / 120, 9);
    // aucune roue et caisse sans contact : pas d'auto-roll
    const aucune = essai([false, false, false, false], 0.7);
    expect(norme(aucune.w)).toBeCloseTo(0, 12);
    expect(aucune.v[1]).toBeCloseTo(-GRAVITE / 120, 9);
  });

  it("deux roues sur le décor et une sur la balle : trois roues en contact (moteur entier), direction des contacts = moyenne des trois normales", () => {
    // sur deux roues d'un même côté, à 5 cm du sol (aucune impulsion de contact) ; `surBalle` : la roue avant du côté levé (la
    // première de `VOITURE.roues`) est sur la balle, dont la normale à cet endroit est horizontale (+X)
    const essai = (surBalle: boolean) => {
      const b = surDeuxRoues(0.05);
      if (surBalle) { b.v.rouesBalle[0] = true; b.v.normalesRouesBalle[0] = [1, 0, 0]; }
      b.pas({ accel: 1 });
      return b.v;
    };
    const parRoue = interpolerTable(CONDUITE.courbeGaz, 0) / 4;
    const deux = essai(false), trois = essai(true);
    expect(deux.rouesContact).toBe(2);
    expect(trois.rouesContact).toBe(2); // le décor seulement
    expect(deux.auSol).toBe(false);
    expect(trois.auSol).toBe(true);
    expect(deux.pneus.moteur).toBeCloseTo(parRoue / 4, 12);
    expect(trois.pneus.moteur).toBeCloseTo(parRoue, 12);
    // `normaleSurface` reste celle du décor ; le collage et l'auto-roll suivent la moyenne des trois contacts : (1, 2, 0) / √5
    expect(trois.normaleSurface).toEqual([0, 1, 0]);
    const nx = 1 / Math.sqrt(5), ny = 2 / Math.sqrt(5);
    // collage : demi-gravité + (1 - |n vertical|) × gravité (du gaz) ; auto-roll : 1 m/s² ; les deux le long de -n
    const k = ((CONDUITE.collage + 1 - ny) * GRAVITE + CONDUITE.autoRoll.force) / 120;
    expect(trois.v[0]).toBeCloseTo(-nx * k, 9);
    expect(trois.v[1]).toBeCloseTo(-GRAVITE / 120 - ny * k, 9);
    // sans roue sur la balle : tout le long de la verticale
    expect(deux.v[0]).toBeCloseTo(0, 9);
  });

  it("une roue qui touche le décor ET la balle compte une fois, avec la normale du décor", () => {
    const essai = (surBalle: boolean) => {
      const b = posee();
      if (surBalle) { b.v.rouesBalle = [true, true, true, true]; b.v.normalesRouesBalle = [[1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0]]; }
      b.suite(3, { accel: 1 });
      return b.v;
    };
    const sans = essai(false), avec = essai(true);
    expect(avec.rouesContact).toBe(4);
    expect(avec.p).toEqual(sans.p);
    expect(avec.v).toEqual(sans.v);
    expect(avec.w).toEqual(sans.w);
    expect(avec.pneus).toEqual(sans.pneus);
  });
});

function baseOrthonorme(b: { avant: Vec3; droite: Vec3; haut: Vec3 }) {
  const h = b.haut, n = norme(h);
  const hh: Vec3 = [h[0] / n, h[1] / n, h[2] / n];
  const d = dot(b.avant, hh);
  const av: Vec3 = [b.avant[0] - hh[0] * d, b.avant[1] - hh[1] * d, b.avant[2] - hh[2] * d];
  const na = norme(av);
  const a2: Vec3 = [av[0] / na, av[1] / na, av[2] / na];
  const dr: Vec3 = [a2[1] * hh[2] - a2[2] * hh[1], a2[2] * hh[0] - a2[0] * hh[2], a2[0] * hh[1] - a2[1] * hh[0]];
  return { avant: a2, droite: dr, haut: hh };
}

describe("voiture : états particuliers", () => {
  it("une voiture figée ignore les entrées mais garde sa physique", () => {
    const b = banc(0, 0, 0, 3);
    b.v.figee = true;
    b.duree(2, { accel: 1, boost: true, saut: true });
    expect(b.v.auSol).toBe(true);
    expect(b.vit()).toBeLessThan(0.1);
    expect(b.v.boost).toBeCloseTo(VOITURE.boostInitial, 5);
    expect(b.evs.some((e) => e.t === "saut" || e.t === "boost")).toBe(false);
  });

  it("une voiture démolie ne bouge plus et décompte sa réapparition : 3 s = exactement 360 pas (RocketSim)", () => {
    const b = banc(0, 0);
    b.v.demolie = true; b.v.reapparitionDans = 3;
    const p0 = [...b.v.p];
    b.duree(1, { accel: 1 });
    expect(b.v.p).toEqual(p0);
    expect(b.v.reapparitionDans).toBeCloseTo(2, 4);
    b.suite(239);
    expect(b.v.reapparitionDans).toBeGreaterThan(0);
    b.pas();
    expect(b.v.reapparitionDans).toBe(0);
  });

  it("replacerVoiture remet tout à zéro", () => {
    const b = banc(0, -30);
    b.v.boost = 5; b.v.demolie = true; b.v.saut.aSaute = true;
    b.v.v[2] = 12; b.v.flip.actif = true;
    b.v.frein = 0.7; b.v.supersonique = true; b.v.supersoniqueDepuis = 0.4; b.v.contactMonde.actif = true;
    b.v.pneus.angle = 0.3; b.v.pneus.moteur = 4; b.v.pneus.lat[2] = 1; b.v.redressement.actif = true;
    replacerVoiture(b.v, [3, VOITURE.hauteurRepos, 4], Math.PI / 2);
    expect(b.v.p).toEqual([3, VOITURE.hauteurRepos, 4]);
    expect(b.v.v).toEqual([0, 0, 0]);
    expect(b.v.boost).toBeCloseTo(100 / 3, 6);
    expect(b.v.demolie).toBe(false);
    expect(b.v.saut.aSaute).toBe(false);
    expect(b.v.flip.actif).toBe(false);
    expect(b.v.base.avant[0]).toBeCloseTo(1, 9);
    expect(b.v.frein).toBe(0);
    expect(b.v.supersonique).toBe(false);
    expect(b.v.supersoniqueDepuis).toBe(0);
    expect(b.v.contactMonde.actif).toBe(false);
    expect(b.v.redressement.actif).toBe(false);
    expect(b.v.pneus).toEqual({ angle: 0, moteur: 0, frein: 0, lat: [0, 0, 0, 0], long: [0, 0, 0, 0] });
    replacerVoiture(b.v, [0, VOITURE.hauteurRepos, 0], 0, 80);
    expect(b.v.boost).toBe(80);
  });

  it("centre et coins de la hitbox : décalage (0,138757 ; 0 ; 0,20755) et dimensions de l'Octane de RocketSim", () => {
    const b = banc(1, 2, 0);
    const c = centreHitbox(b.v);
    expect(c[0]).toBeCloseTo(1, 9);
    expect(c[1]).toBeCloseTo(VOITURE.hauteurRepos + 0.20755, 9);
    expect(c[2]).toBeCloseTo(2 + 0.138757, 9);
    const coins = coinsHitbox(b.v);
    expect(coins).toHaveLength(8);
    const zs = coins.map((p) => p[2]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(DEMI_HITBOX[0] * 2, 9);
    const ys = coins.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(DEMI_HITBOX[2] * 2, 9);
    expect(DEMI_HITBOX[0] * 2).toBeCloseTo(1.20507, 9);
    expect(DEMI_HITBOX[1] * 2).toBeCloseTo(0.866994, 9);
    expect(DEMI_HITBOX[2] * 2).toBeCloseTo(0.386591, 9);
  });

  it("moments d'inertie de Rocket League : roulis 13,517, tangage 24,025, lacet 33,058 kg·m² (boîte de RocketSim, masse 180)", () => {
    expect(INERTIE_VOITURE.avant).toBeCloseTo(13.517, 3);
    expect(INERTIE_VOITURE.droite).toBeCloseTo(24.025, 3);
    expect(INERTIE_VOITURE.haut).toBeCloseTo(33.058, 3);
  });

  it("plafonnerVitesse ramène la vitesse à 23 m/s sans changer sa direction", () => {
    const b = banc();
    b.v.v = [30, 0, 40];
    plafonnerVitesse(b.v);
    expect(b.vit()).toBeCloseTo(23, 9);
    expect(b.v.v[0] / b.v.v[2]).toBeCloseTo(0.75, 9);
    b.v.v = [3, 0, 4];
    plafonnerVitesse(b.v);
    expect(b.v.v).toEqual([3, 0, 4]);
  });

  it("en l'air, la vitesse est plafonnée à 23 m/s après l'intégration : le pas avance avec la vitesse non plafonnée (RocketSim)", () => {
    const b = enAir();
    b.v.boost = 100;
    b.v.v = [0, 0, 23];
    const z0 = b.v.p[2];
    b.pas({ boost: true });
    expect(b.vit()).toBeLessThanOrEqual(23 + 1e-9);
    // position : 23 + la poussée du boost du pas, pendant 1/120 s
    expect(b.v.p[2] - z0).toBeCloseTo((23 + BOOST.accelerationAir / 120) / 120, 9);
  });
});

describe("voiture : robustesse", () => {
  it("jamais de traversée du décor : 10 000 pas d'entrées aléatoires, sans NaN", () => {
    const rng = creerRng(7);
    for (const depart of [[0, 0, 0], [30, 0, 20], [-30, 10, -45], [0, 0, 55]] as const) {
      const b = banc(depart[0], depart[2], tirer(rng) * 6, VOITURE.hauteurRepos + depart[1]);
      let entrees: Partial<EntreesVoiture> = {};
      for (let i = 0; i < 10000; i++) {
        if (i % 24 === 0) {
          entrees = {
            accel: Math.round(tirer(rng) * 2 - 1), direction: Math.round(tirer(rng) * 2 - 1), tangage: Math.round(tirer(rng) * 2 - 1),
            lacet: Math.round(tirer(rng) * 2 - 1), roulis: Math.round(tirer(rng) * 2 - 1), saut: tirer(rng) < 0.4, boost: tirer(rng) < 0.6, derapage: tirer(rng) < 0.2,
          };
        }
        if (i % 600 === 0) b.v.boost = 100;
        const wAvant = norme(b.v.w);
        b.pas(entrees);
        const c = centreHitbox(b.v);
        expect(Number.isFinite(c[0] + c[1] + c[2] + b.v.v[0] + b.v.w[1])).toBe(true);
        // la hitbox ne s'enfonce jamais de plus de 35 cm dans la matière
        for (const p of coinsHitbox(b.v)) {
          if (arene.sd(p) < -0.35 && Math.abs(p[2]) < 51) throw new Error(`coin dans la matière à i=${i} : sd=${arene.sd(p)} p=${p}`);
        }
        expect(arene.sd(b.v.p) > -0.5 || Math.abs(b.v.p[2]) > 50).toBe(true);
        expect(b.vit()).toBeLessThanOrEqual(23.0001);
        // la vitesse angulaire est plafonnée à 5,5 rad/s après chaque intégration ; un choc du pas peut la relever jusqu'au pas suivant
        expect(norme(b.v.w)).toBeLessThan(60);
        // sans contact avec le décor, elle ne dépasse jamais le plafond
        if (b.v.rouesContact === 0 && !b.v.contactMonde.actif && wAvant <= 5.5 + 1e-9) expect(norme(b.v.w)).toBeLessThanOrEqual(5.5 + 1e-9);
      }
    }
  });

  it("déterminisme : mêmes entrées, même état à l'octet près", () => {
    const run = () => {
      const rng = creerRng(42);
      const b = banc(5, -10, 1);
      for (let i = 0; i < 2000; i++) {
        b.pas({ accel: tirer(rng) < 0.7 ? 1 : -1, direction: tirer(rng) * 2 - 1, saut: tirer(rng) < 0.05, boost: tirer(rng) < 0.5, tangage: tirer(rng) * 2 - 1, derapage: tirer(rng) < 0.1 });
        if (i % 500 === 0) b.v.boost = 100;
      }
      return JSON.stringify([b.v.p, b.v.v, b.v.w, b.v.base, b.v.pneus, b.v.frein]);
    };
    expect(run()).toBe(run());
  });

  it("coût d'un pas de six voitures (mesure, non bloquante)", () => {
    const vs = Array.from({ length: 6 }, (_, i) => banc(-20 + i * 8, -20, i));
    const t0 = performance.now();
    const n = 600;
    for (let k = 0; k < n; k++) for (const b of vs) b.pas({ accel: 1, direction: Math.sin(k / 30) });
    const ms = (performance.now() - t0) / n;
    console.log(`pasVoiture x6 : ${ms.toFixed(3)} ms par pas`);
    expect(ms).toBeLessThan(5);
  });
});

/** Garde-fou de typage : l'état créé porte bien les champs ajoutés pour RocketSim. */
const _etat: Pick<EtatVoiture, "frein" | "pneus" | "contactMonde" | "supersoniqueDepuis"> = creerVoiture({ id: 9, equipe: "bleue", slot: 0, humain: false, nom: "t", p: [0, 0, 0], cap: 0 });
void _etat;
