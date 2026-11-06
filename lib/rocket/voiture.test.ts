import { describe, expect, it } from "vitest";
import { creerArene } from "./arene";
import { ENTREES_NULLES, PAS_S, STADE, VOITURE, creerRng, tirer, type EntreesVoiture, type EtatVoiture, type EvenementVoiture, type Vec3 } from "./contrat";
import { centreHitbox, coinsHitbox, creerVoiture, DEMI_HITBOX, flipEstArriere, pasVoiture, replacerVoiture } from "./voiture";
import { baseDepuisCap, dot, norme } from "./vec";

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

  it("0 → 14 m/s sans boost en 2,0 à 2,5 s", () => {
    const b = banc();
    let t = -1;
    for (let i = 0; i < 600 && t < 0; i++) { b.pas({ accel: 1 }); if (b.vitAvant() >= 14) t = b.t(); }
    expect(t).toBeGreaterThan(2.0);
    expect(t).toBeLessThan(2.5);
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

  it("le boost consomme 33,33 par seconde, au moins 0,1 s par appui, et se vide", () => {
    const b = banc(0, -45);
    b.v.boost = 100;
    b.duree(1, { boost: true });
    expect(b.v.boost).toBeGreaterThan(66.0);
    expect(b.v.boost).toBeLessThan(67.3);
    // un appui d'un pas brûle quand même 0,1 s
    const c = banc(0, -45);
    c.v.boost = 100;
    c.pas({ boost: true });
    c.duree(0.5);
    expect(100 - c.v.boost).toBeGreaterThan(3.1);
    expect(100 - c.v.boost).toBeLessThan(3.7);
    // à zéro : plus d'effet
    const d = banc(0, -45);
    d.v.boost = 0;
    d.duree(1, { boost: true });
    expect(d.vit()).toBeLessThan(0.1);
    expect(d.v.boostActif).toBe(false);
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

  it("freinage : la marche arrière freine puis repart en arrière", () => {
    const b = banc(0, 0);
    b.duree(1.5, { accel: 1 });
    const v0 = b.vitAvant();
    b.duree(0.3, { accel: -1 });
    expect(b.vitAvant()).toBeLessThan(v0 - 8);
    b.duree(3, { accel: -1 });
    expect(b.vitAvant()).toBeLessThan(-5);
  });

  it("roue libre : sans gaz la voiture ralentit à ≈ 5,25 m/s² jusqu'à l'arrêt, sans passer en marche arrière", () => {
    const b = banc(0, -45);
    b.v.v[2] = 10;
    b.duree(1);
    expect(b.vitAvant()).toBeGreaterThan(4.3);
    expect(b.vitAvant()).toBeLessThan(5.2);
    b.duree(3);
    expect(b.vitAvant()).toBeCloseTo(0, 2);
  });

  it("rayon de virage à 5 m/s : 2,5 m ± 15 %", () => {
    const b = banc(0, 0);
    let ang = 0;
    for (let i = 0; i < 240; i++) {
      // la vitesse est tenue à 5 m/s le long de l'avant (on mesure le virage seul)
      const f = b.v.base.avant;
      b.v.v[0] = f[0] * 5; b.v.v[2] = f[2] * 5;
      const cap0 = Math.atan2(f[0], f[2]);
      b.pas({ direction: 1 });
      const cap1 = Math.atan2(b.v.base.avant[0], b.v.base.avant[2]);
      let d = cap1 - cap0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      if (i >= 60) ang += -d; // tourner à droite fait diminuer le cap
    }
    const omega = ang / (180 * PAS_S);
    expect(5 / omega).toBeGreaterThan(2.5 * 0.85);
    expect(5 / omega).toBeLessThan(2.5 * 1.15);
  });

  it("le volant à droite tourne à droite, à gauche à gauche", () => {
    const d = banc(0, 0);
    d.duree(1, { accel: 1, direction: 1 });
    expect(d.v.base.avant[0]).toBeLessThan(-0.1); // à droite de +Z = vers -X
    const g = banc(0, 0);
    g.duree(1, { accel: 1, direction: -1 });
    expect(g.v.base.avant[0]).toBeGreaterThan(0.1);
  });

  it("à l'arrêt, un appui sur le gaz fait pivoter doucement (vitesse effective minimale)", () => {
    const b = banc(0, 0);
    b.duree(0.3, { accel: 1, direction: 1 });
    expect(Math.abs(b.v.w[1])).toBeGreaterThan(0.3);
  });

  it("dérapage : la vitesse latérale décroît 10 fois moins vite", () => {
    const lat = (derapage: boolean) => {
      const b = banc(0, -30);
      b.v.v[0] = 10; // 10 m/s de côté (la voiture regarde +Z)
      b.duree(0.25, { derapage });
      return Math.abs(b.v.v[0]);
    };
    const normal = lat(false), glisse = lat(true);
    expect(normal).toBeLessThan(0.2);
    expect(glisse).toBeGreaterThan(5);
  });

  it("dérapage : le lacet est plus vif et la voiture garde sa vitesse latérale (traces de pneus)", () => {
    const rate = (derapage: boolean) => {
      const b = banc(0, -40);
      b.duree(1.5, { accel: 1 });
      b.duree(0.5, { accel: 1, direction: 1, derapage });
      return Math.abs(b.v.w[1]);
    };
    expect(rate(true)).toBeGreaterThan(rate(false) * 1.2);
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

  it("saut court (bouton lâché tout de suite) : bien plus bas qu'un saut maintenu", () => {
    const b = banc();
    b.duree(0.3);
    let apex = 0;
    for (let i = 0; i < 300; i++) { b.pas({ saut: i < 2 }); apex = Math.max(apex, b.v.p[1]); }
    expect(apex).toBeGreaterThan(0.6);
    expect(apex).toBeLessThan(1.1);
  });

  it("double saut : possible 1,2 s après le décollage, refusé à 1,3 s", () => {
    const essai = (delai: number) => {
      const b = banc();
      b.duree(0.3);
      for (let i = 0; i < 24; i++) b.pas({ saut: true }); // saut maintenu 0,2 s
      const vz = (n: number) => { for (let i = 0; i < n; i++) b.pas(); };
      vz(Math.round(delai / PAS_S) - 24);
      expect(b.v.auSol).toBe(false);
      const vAvant = b.v.v[1];
      b.pas({ saut: true });
      return { gain: b.v.v[1] - vAvant, evs: b.evs };
    };
    const ok = essai(1.2);
    expect(ok.evs.some((e) => e.t === "doubleSaut")).toBe(true);
    expect(ok.gain).toBeGreaterThan(2.5);
    const non = essai(1.3);
    expect(non.evs.some((e) => e.t === "doubleSaut" || e.t === "flip")).toBe(false);
    expect(non.gain).toBeLessThan(0.5);
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

  it("flipEstArriere suit le sens de la marche (RocketSim)", () => {
    expect(flipEstArriere(-1, 0)).toBe(true);
    expect(flipEstArriere(1, 0)).toBe(false);
    expect(flipEstArriere(1, 14)).toBe(false);
    expect(flipEstArriere(-1, 14)).toBe(true);
    expect(flipEstArriere(1, -14)).toBe(true); // vers l'avant en marche arrière : « arrière » pour RL
    expect(flipEstArriere(-1, -14)).toBe(false);
  });

  it("flip : rotation plafonnée à 5,5 rad/s, ≈ 205° à 0,65 s puis la vitesse résiduelle s'amortit (≈ 314° au total)", () => {
    const b = banc(0, -30, 0, 12); // lancé en l'air : pas de contact avec le sol pendant l'essai
    b.v.v[2] = 10;
    b.suite(6);
    const avant0 = [...b.v.base.avant];
    b.pas({ saut: true, tangage: -1 });
    let wMax = 0;
    for (let i = 0; i < Math.round(0.65 / PAS_S) - 1; i++) { b.pas(); wMax = Math.max(wMax, Math.hypot(b.v.w[0], b.v.w[1], b.v.w[2])); }
    expect(wMax).toBeLessThanOrEqual(5.5 + 1e-6);
    const ecart = (u: number[], w: number[]) => (Math.acos(Math.min(1, Math.max(-1, dot(u as Vec3, w as Vec3)))) * 180) / Math.PI;
    // 0,65 s à 5,5 rad/s ≈ 205° de rotation (l'angle avec l'orientation de départ est donc ≈ 155°), la voiture est encore sur le dos
    expect(ecart(b.v.base.avant, avant0)).toBeGreaterThan(130);
    expect(ecart(b.v.base.avant, avant0)).toBeLessThan(175);
    expect(b.v.base.haut[1]).toBeLessThan(0.5);
    // puis la vitesse résiduelle s'amortit (≈ 2,8 /s) sans être remise à zéro d'un coup
    expect(Math.hypot(b.v.w[0], b.v.w[1], b.v.w[2])).toBeGreaterThan(3);
    b.duree(0.6);
    expect(Math.hypot(b.v.w[0], b.v.w[1], b.v.w[2])).toBeLessThan(1.5);
  });

  it("le flip « flotte » : vitesse verticale quasi nulle pendant tout le couple de dodge (RL : chute ≈ 0,15 m)", () => {
    const b = banc(0, -30, 0, 12);
    b.v.v[1] = 0;
    b.suite(6);
    const y0 = b.v.p[1];
    b.pas({ saut: true, tangage: -1 });
    b.duree(0.6);
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
  });

  it("annulation du flip : tirer le manche à l'opposé arrête la rotation", () => {
    const rotation = (annuler: boolean) => {
      const b = banc(0, -30);
      b.v.v[2] = 10;
      b.pas({ saut: true }); b.suite(18);
      b.pas({ saut: true, tangage: -1 });
      b.duree(0.35, { tangage: annuler ? 1 : -1 });
      return Math.acos(Math.max(-1, Math.min(1, b.v.base.haut[1])));
    };
    expect(rotation(false)).toBeGreaterThan(1.8);
    expect(rotation(true)).toBeLessThan(1.5); // 0,15 s de rotation à 5,5 rad/s restent acquises
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

  it("stall : roulis + tangage au flip = rotation de roulis sans impulsion horizontale", () => {
    const b = banc(0, -30);
    b.v.v[2] = 14;
    b.pas({ saut: true }); b.suite(18);
    const vz = b.v.v[2];
    b.pas({ saut: true, lacet: -1, roulis: 1 }); // lacet et roulis opposés : direction du dodge nulle
    const f = b.evs.find((e) => e.t === "flip");
    expect(f && f.t === "flip" && f.stall).toBe(true);
    expect(b.v.v[2]).toBeCloseTo(vz, 1);
    b.duree(0.2);
    expect(Math.abs(dot(b.v.w, b.v.base.avant))).toBeGreaterThan(5);
  });
});

describe("voiture : contrôle aérien", () => {
  const enAir = () => { const b = banc(0, 0, 0, 12); b.v.v[2] = 0; return b; };

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
});

describe("voiture : murs, plafond, retournement", () => {
  it("lancée à 15 m/s vers le mur latéral, elle reste en contact ≥ 95 % des pas en montant (boost)", () => {
    const b = banc(20, 0, Math.PI / 2); // regarde +X
    b.v.v[0] = 15;
    b.v.boost = 100;
    let pas = 0, contact = 0, hmax = 0;
    for (let i = 0; i < 360; i++) {
      b.pas({ accel: 1, boost: true });
      pas++;
      if (b.v.rouesContact >= 1) contact++;
      hmax = Math.max(hmax, b.v.p[1]);
      if (i % 40 === 0) b.v.boost = 100;
    }
    expect(contact / pas).toBeGreaterThanOrEqual(0.95);
    expect(hmax).toBeGreaterThan(8);
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

  it("le mur monte jusqu'au plafond, qui se roule de même (roues collées)", () => {
    const b = banc(20, 0, Math.PI / 2);
    b.v.v[0] = 15;
    let pas = 0, contact = 0, auPlafond = 0;
    for (let i = 0; i < 720; i++) {
      b.v.boost = 100;
      b.pas({ accel: 1, boost: true });
      if (i > 150) { pas++; if (b.v.rouesContact >= 1) contact++; }
      if (b.v.base.haut[1] < -0.9 && b.v.auSol) auPlafond++;
    }
    expect(auPlafond).toBeGreaterThan(60);
    expect(contact / pas).toBeGreaterThanOrEqual(0.9);
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

  it("atterrissage retourné : un saut sur le toit la remet sur ses roues", () => {
    const b = banc(0, 0, 0, 1.5);
    b.v.base = { avant: [0, 0, 1], droite: [1, 0, 0], haut: [0, -1, 0] };
    b.duree(1.5);
    expect(b.v.auSol).toBe(false);
    expect(b.v.base.haut[1]).toBeLessThan(-0.9);
    expect(b.vit()).toBeLessThan(0.5);
    b.pas({ saut: true });
    expect(b.v.redressement.actif).toBe(true);
    b.duree(2);
    expect(b.v.auSol).toBe(true);
    expect(b.v.base.haut[1]).toBeGreaterThan(0.95);
    expect(b.v.redressement.actif).toBe(false);
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

  it("une voiture démolie ne bouge plus et décompte sa réapparition", () => {
    const b = banc(0, 0);
    b.v.demolie = true; b.v.reapparitionDans = 3;
    const p0 = [...b.v.p];
    b.duree(1, { accel: 1 });
    expect(b.v.p).toEqual(p0);
    expect(b.v.reapparitionDans).toBeCloseTo(2, 5);
    b.duree(3);
    expect(b.v.reapparitionDans).toBe(0);
  });

  it("replacerVoiture remet tout à zéro", () => {
    const b = banc(0, -30);
    b.v.boost = 5; b.v.demolie = true; b.v.saut.aSaute = true;
    b.v.v[2] = 12; b.v.flip.actif = true;
    replacerVoiture(b.v, [3, VOITURE.hauteurRepos, 4], Math.PI / 2);
    expect(b.v.p).toEqual([3, VOITURE.hauteurRepos, 4]);
    expect(b.v.v).toEqual([0, 0, 0]);
    expect(b.v.boost).toBeCloseTo(100 / 3, 6);
    expect(b.v.demolie).toBe(false);
    expect(b.v.saut.aSaute).toBe(false);
    expect(b.v.flip.actif).toBe(false);
    expect(b.v.base.avant[0]).toBeCloseTo(1, 9);
    replacerVoiture(b.v, [0, VOITURE.hauteurRepos, 0], 0, 80);
    expect(b.v.boost).toBe(80);
  });

  it("centre et coins de la hitbox : décalage (0,1388 ; 0 ; 0,2075) et dimensions de l'Octane", () => {
    const b = banc(1, 2, 0);
    const c = centreHitbox(b.v);
    expect(c[0]).toBeCloseTo(1, 9);
    expect(c[1]).toBeCloseTo(VOITURE.hauteurRepos + 0.2075, 9);
    expect(c[2]).toBeCloseTo(2 + 0.1388, 9);
    const coins = coinsHitbox(b.v);
    expect(coins).toHaveLength(8);
    const zs = coins.map((p) => p[2]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(DEMI_HITBOX[0] * 2, 9);
    const ys = coins.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(DEMI_HITBOX[2] * 2, 9);
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
        b.pas(entrees);
        const c = centreHitbox(b.v);
        expect(Number.isFinite(c[0] + c[1] + c[2] + b.v.v[0] + b.v.w[1])).toBe(true);
        // la hitbox ne s'enfonce jamais de plus de 35 cm dans la matière
        for (const p of coinsHitbox(b.v)) {
          if (arene.sd(p) < -0.35 && Math.abs(p[2]) < 51) throw new Error(`coin dans la matière à i=${i} : sd=${arene.sd(p)} p=${p}`);
        }
        expect(arene.sd(b.v.p) > -0.5 || Math.abs(b.v.p[2]) > 50).toBe(true);
        expect(b.vit()).toBeLessThanOrEqual(23.0001);
        expect(norme(b.v.w)).toBeLessThan(16);
      }
    }
  });

  it("déterminisme : mêmes entrées, même état à l'octet près", () => {
    const run = () => {
      const rng = creerRng(42);
      const b = banc(5, -10, 1);
      for (let i = 0; i < 2000; i++) {
        b.pas({ accel: tirer(rng) < 0.7 ? 1 : -1, direction: tirer(rng) * 2 - 1, saut: tirer(rng) < 0.05, boost: tirer(rng) < 0.5, tangage: tirer(rng) * 2 - 1 });
        if (i % 500 === 0) b.v.boost = 100;
      }
      return JSON.stringify([b.v.p, b.v.v, b.v.w, b.v.base]);
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
