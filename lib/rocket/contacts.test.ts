import { describe, expect, it } from "vitest";
import { creerArene } from "./arene";
import { creerBalle, pasBalle } from "./balle";
import { BALLE, ENTREES_NULLES, PAS_S, VOITURE, type EtatBalle, type EtatVoiture, type Equipe } from "./contrat";
import { contactVoitureBalle, contactVoitureVoiture, rouesSurLaBalle } from "./contacts";
import { centreHitbox, creerVoiture, DEMI_HITBOX, pasVoiture } from "./voiture";
import { norme } from "./vec";

const arene = creerArene();
const auto = (id: number, equipe: Equipe, x: number, z: number, cap: number) =>
  creerVoiture({ id, equipe, slot: 0, humain: id === 0, nom: `v${id}`, p: [x, VOITURE.hauteurRepos, z], cap });

/** Une voiture à `vitesse` m/s (cap 0 = +Z) et une balle immobile, au niveau du centre de la hitbox, juste devant le nez. */
function frontal(vitesse: number): { v: EtatVoiture; b: EtatBalle } {
  const v = auto(0, "bleue", 0, -5, 0);
  v.v[2] = vitesse;
  const c = centreHitbox(v);
  const b = creerBalle([0, c[1], c[2] + DEMI_HITBOX[0] + BALLE.rayon - 0.05]);
  return { v, b };
}

describe("contacts : voiture ↔ balle", () => {
  it("pas de contact à distance, ni pour une voiture démolie", () => {
    const v = auto(0, "bleue", 0, 0, 0);
    expect(contactVoitureBalle(v, creerBalle([0, 1, 5]), 0, PAS_S)).toBeNull();
    const c = centreHitbox(v);
    const b = creerBalle([c[0], c[1] + 0.2 + BALLE.rayon - 0.02, c[2]]);
    v.demolie = true;
    expect(contactVoitureBalle(v, b, 0, PAS_S)).toBeNull();
    v.demolie = false;
    expect(contactVoitureBalle(v, b, 0, PAS_S)).not.toBeNull();
  });

  it("voiture à 23 m/s heurtant de face une balle immobile : la balle sort entre 30 et 34 m/s (RL ≈ 32,4 : choc inélastique + Psyonix)", () => {
    const { v, b } = frontal(23);
    const r = contactVoitureBalle(v, b, 100, PAS_S);
    expect(r).not.toBeNull();
    expect(r!.force).toBeGreaterThan(22);
    const vit = norme(b.v);
    expect(vit).toBeGreaterThan(30);
    expect(vit).toBeLessThan(34);
    expect(b.v[2]).toBeGreaterThan(b.v[1]);
    // la balle a été repoussée hors de la boîte
    expect(contactVoitureBalle(v, b, 200, PAS_S)).toBeNull();
    // la voiture a ralenti
    expect(v.v[2]).toBeLessThan(23);
    expect(v.v[2]).toBeGreaterThan(10);
  });

  it("à 5 m/s : la balle sort entre 6,5 et 8,5 m/s (RL ≈ 7,5)", () => {
    const { v, b } = frontal(5);
    contactVoitureBalle(v, b, 100, PAS_S);
    const vit = norme(b.v);
    expect(vit).toBeGreaterThan(6.5);
    expect(vit).toBeLessThan(8.5);
  });

  it("l'impulsion supplémentaire de Psyonix s'ajoute au choc physique", () => {
    const { v, b } = frontal(23);
    contactVoitureBalle(v, b, 100, PAS_S);
    const avec = norme(b.v);
    const w = frontal(23);
    w.v.dernierContactBalleTick = 99; // contact tout récent : pas d'impulsion supplémentaire
    contactVoitureBalle(w.v, w.b, 100, PAS_S);
    const sans = norme(w.b.v);
    // choc physique seul, inélastique (restitution 0 comme RocketSim) : 180 / 210 × 23 ≈ 19,7 m/s
    expect(sans).toBeGreaterThan(18);
    expect(sans).toBeLessThan(21);
    expect(avec - sans).toBeGreaterThan(10);
  });

  it("frapper sous le centre de la balle la lance vers le haut", () => {
    const v = auto(0, "bleue", 0, -5, 0);
    v.v[2] = 15;
    const c = centreHitbox(v);
    // balle plus haute que le nez, prise par le dessous : son centre est 0,45 m au-dessus du centre de la hitbox
    const b = creerBalle([0, c[1] + 0.55, c[2] + DEMI_HITBOX[0] + 0.45]);
    expect(contactVoitureBalle(v, b, 100, PAS_S)).not.toBeNull();
    expect(b.v[1]).toBeGreaterThan(5);
    expect(b.v[2]).toBeGreaterThan(10);
  });

  it("le frottement donne du spin à une balle qui glisse sur la voiture, sans emballement", () => {
    const { v, b } = frontal(23);
    v.v[0] = 6;
    contactVoitureBalle(v, b, 100, PAS_S);
    expect(norme(b.w)).toBeGreaterThan(0);
    expect(norme(b.w)).toBeLessThan(80);
  });

  it("balle posée sur le toit (dribble) : elle s'y tient plusieurs secondes sans exploser", () => {
    const v = auto(0, "bleue", 0, 0, 0);
    const c = centreHitbox(v);
    const toit = c[1] + DEMI_HITBOX[2];
    const b = creerBalle([c[0], toit + BALLE.rayon + 0.01, c[2]]);
    let vmax = 0, contacts = 0;
    for (let i = 0; i < 360; i++) {
      pasVoiture(arene, v, ENTREES_NULLES(), PAS_S, i);
      pasBalle(arene, b, PAS_S);
      if (contactVoitureBalle(v, b, i, PAS_S)) contacts++;
      vmax = Math.max(vmax, norme(b.v));
    }
    expect(contacts).toBeGreaterThan(300);
    expect(vmax).toBeLessThan(3);
    expect(Math.hypot(b.p[0] - c[0], b.p[2] - c[2])).toBeLessThan(0.5);
    expect(b.p[1]).toBeGreaterThan(toit + BALLE.rayon - 0.05);
    expect(v.p[1]).toBeGreaterThan(0.16);
  });

  it("dribble en mouvement : même vitesse que la voiture, pas d'envol", () => {
    const v = auto(0, "bleue", 0, -30, 0);
    v.v[2] = 8;
    const c = centreHitbox(v);
    const b = creerBalle([c[0], c[1] + DEMI_HITBOX[2] + BALLE.rayon + 0.01, c[2]]);
    b.v[2] = 8;
    let hmax = 0;
    for (let i = 0; i < 120; i++) {
      pasVoiture(arene, v, { ...ENTREES_NULLES(), accel: v.v[2] < 8 ? 0.4 : 0 }, PAS_S, i);
      pasBalle(arene, b, PAS_S);
      contactVoitureBalle(v, b, i, PAS_S);
      hmax = Math.max(hmax, b.p[1]);
    }
    expect(hmax).toBeLessThan(2.6);
  });

  it("flip reset : en l'air, les quatre roues sur la balle rendent le second saut", () => {
    const v = auto(0, "bleue", 0, 0, 0);
    v.p[1] = 8;
    v.saut.aSaute = true; v.saut.secondUtilise = true; v.saut.tempsEnLAir = 2;
    // la balle est sous la voiture, centrée sur son axe vertical, au contact des roues
    const b = creerBalle([v.p[0] + 0.1, v.p[1] - 0.86, v.p[2]]);
    expect(rouesSurLaBalle(v, b.p)).toBe(true);
    contactVoitureBalle(v, b, 10, PAS_S);
    expect(v.saut.secondUtilise).toBe(false);
    expect(v.saut.tempsEnLAir).toBe(0);
    // le flip est de nouveau possible : un appui avec le manche déclenche un flip, alors que la fenêtre de 1,25 s était dépassée
    const evs = pasVoiture(arene, v, { ...ENTREES_NULLES(), saut: true, tangage: -1 }, PAS_S, 11);
    expect(evs.some((e) => e.t === "flip")).toBe(true);
  });

  it("pas de flip reset si une seule roue touche la balle ou si la voiture est au sol", () => {
    const v = auto(0, "bleue", 0, 0, 0);
    v.p[1] = 8;
    v.saut.secondUtilise = true;
    const cote = creerBalle([v.p[0] + 1.1, v.p[1] - 0.2, v.p[2] + 0.6]);
    expect(rouesSurLaBalle(v, cote.p)).toBe(false);
    contactVoitureBalle(v, cote, 10, PAS_S);
    expect(v.saut.secondUtilise).toBe(true);
    const sol = auto(1, "bleue", 0, 0, 0);
    sol.auSol = true; sol.saut.secondUtilise = true;
    contactVoitureBalle(sol, creerBalle([0.1, sol.p[1] - 0.86, 0]), 10, PAS_S);
    expect(sol.saut.secondUtilise).toBe(true);
  });

  it("l'impulsion de Psyonix n'est pas rejouée tant que le contact précédent date de moins de 0,1 s", () => {
    const { v, b } = frontal(15);
    contactVoitureBalle(v, b, 100, PAS_S);
    const apres1 = norme(b.v);
    // on remet la balle en contact et on rappelle au pas suivant
    const c = centreHitbox(v);
    b.p[0] = c[0]; b.p[1] = c[1]; b.p[2] = c[2] + DEMI_HITBOX[0] + BALLE.rayon - 0.05;
    b.v[0] = b.v[1] = b.v[2] = 0;
    contactVoitureBalle(v, b, 101, PAS_S);
    expect(norme(b.v)).toBeLessThan(apres1 * 0.85);
    // plus tard (13 pas = 0,108 s) elle revient
    b.p[2] = c[2] + DEMI_HITBOX[0] + BALLE.rayon - 0.05;
    b.v[0] = b.v[1] = b.v[2] = 0;
    v.v[2] = 15;
    contactVoitureBalle(v, b, 101 + 13, PAS_S);
    expect(norme(b.v)).toBeGreaterThan(apres1 * 0.85);
  });

  it("balle ramassée au sol par une voiture lancée : elle part vite et haut dans le stade, sans traverser les murs", () => {
    const v = auto(0, "bleue", 0, -30, 0);
    const b = creerBalle([0, BALLE.rayon, -10]);
    v.v[2] = 20;
    let vmax = 0;
    for (let i = 0; i < 240; i++) {
      pasVoiture(arene, v, { ...ENTREES_NULLES(), accel: 1, boost: true }, PAS_S, i);
      pasBalle(arene, b, PAS_S);
      contactVoitureBalle(v, b, i, PAS_S);
      vmax = Math.max(vmax, norme(b.v));
      if (Math.abs(b.p[2]) < 60) expect(arene.sd(b.p)).toBeGreaterThan(BALLE.rayon - 0.1);
    }
    expect(vmax).toBeGreaterThan(25);
    expect(vmax).toBeLessThanOrEqual(60.0001);
  });
});

describe("contacts : voiture ↔ voiture", () => {
  /** Deux voitures face à face qui se foncent dessus (a à `va` m/s, b à `vb` m/s) ; avance pas à pas jusqu'au premier contact. */
  function faceAFace(va: number, vb: number, equipeB: Equipe = "orange", demiEcart = 10) {
    const a = auto(0, "bleue", 0, -demiEcart, 0);
    const b = auto(1, equipeB, 0, demiEcart, Math.PI);
    a.v[2] = va; b.v[2] = -vb;
    return { a, b };
  }
  function jusquAuContact(a: EtatVoiture, b: EtatVoiture, boost = true) {
    // les attaquants gardent leur vitesse (gaz + boost) : sans cela la roue libre les ferait ralentir avant le choc
    const tient = { ...ENTREES_NULLES(), accel: boost ? 1 : 0, boost };
    for (let i = 0; i < 600; i++) {
      a.boost = 100; b.boost = 100;
      pasVoiture(arene, a, a.v[2] > 0 ? tient : ENTREES_NULLES(), PAS_S, i);
      pasVoiture(arene, b, b.v[2] < 0 ? tient : ENTREES_NULLES(), PAS_S, i);
      const r = contactVoitureVoiture(a, b, i);
      if (r) return { r, i };
    }
    return null;
  }

  it("pas de contact à distance, ni avec une voiture démolie", () => {
    const a = auto(0, "bleue", 0, 0, 0), b = auto(1, "orange", 5, 0, 0);
    expect(contactVoitureVoiture(a, b, 0)).toBeNull();
    b.p[0] = 0.3; // chevauchement net
    expect(contactVoitureVoiture(a, b, 0)).not.toBeNull();
    const c = auto(2, "orange", 0.3, 0, 0);
    c.demolie = true;
    expect(contactVoitureVoiture(auto(0, "bleue", 0, 0, 0), c, 0)).toBeNull();
  });

  it("démolition à 22,5 m/s supersonique de face contre un adversaire", () => {
    const { a, b } = faceAFace(22.5, 0);
    const res = jusquAuContact(a, b);
    expect(res).not.toBeNull();
    expect(a.supersonique).toBe(true);
    expect(res!.r.demolition).toEqual({ auteur: 0, victime: 1 });
    // ce module ne démolit pas lui-même
    expect(b.demolie).toBe(false);
  });

  it("jamais à 18 m/s, même de face", () => {
    const { a, b } = faceAFace(18, 0, "orange", 3.2);
    const res = jusquAuContact(a, b, false);
    expect(res).not.toBeNull();
    expect(a.supersonique).toBe(false);
    expect(res!.r.demolition).toBeNull();
  });

  it("deux voitures supersoniques face à face : l'une démolit l'autre (une seule est désignée)", () => {
    const { a, b } = faceAFace(22.6, 22.2);
    const res = jusquAuContact(a, b);
    expect(res).not.toBeNull();
    expect(res!.r.demolition).not.toBeNull();
    const d = res!.r.demolition!;
    expect(d.auteur + d.victime).toBe(1); // l'un démolit l'autre, jamais lui-même
  });

  it("bump sans démolition entre coéquipiers, même supersonique", () => {
    const { a, b } = faceAFace(22.5, 0, "bleue");
    const res = jusquAuContact(a, b);
    expect(res).not.toBeNull();
    expect(res!.r.demolition).toBeNull();
    expect(res!.r.bump).not.toBeNull();
    expect(res!.r.bump!.vitesse).toBeGreaterThan(15);
  });

  it("bump : la victime reçoit un surcroît de vitesse, le délai de 0,25 s empêche un second bump", () => {
    const a = auto(0, "bleue", 0, 0, 0), b = auto(1, "orange", 0, 1.2, Math.PI);
    a.v[2] = 10;
    // a attaque b (pas supersonique : simple bump)
    const r = contactVoitureVoiture(a, b, 500);
    expect(r).not.toBeNull();
    expect(r!.bump).not.toBeNull();
    expect(b.v[2]).toBeGreaterThan(5); // choc élastique faible + 0,4 × 10
    const vb = b.v[2];
    // encore en contact au pas suivant : pas de second bump
    a.p[2] = 0.3; a.v[2] = 10; b.p[2] = 1.3;
    const r2 = contactVoitureVoiture(a, b, 501);
    expect(r2 === null || r2.bump === null).toBe(true);
    expect(b.v[2]).toBeLessThan(vb + 6);
    // après le délai (voitures neuves : seul le décompte du bump compte)
    const c = auto(2, "bleue", 0, 0, 0), d = auto(3, "orange", 0, 1.2, Math.PI);
    c.v[2] = 10; c.dernierBumpTick = d.dernierBumpTick = 500;
    expect(contactVoitureVoiture(c, d, 520)!.bump).toBeNull(); // 20 pas = 0,17 s : trop tôt
    const e = auto(4, "bleue", 0, 0, 0), f = auto(5, "orange", 0, 1.2, Math.PI);
    e.v[2] = 10; e.dernierBumpTick = f.dernierBumpTick = 500;
    expect(contactVoitureVoiture(e, f, 531)!.bump).not.toBeNull(); // 31 pas > 0,25 s
  });

  it("bump de RocketSim : à 14 m/s, la victime au repos part à ≈ 17 m/s (choc ≈ 6 + bump 11, plus une poussée verticale), seul le pare-chocs avant bumpe", () => {
    const a = auto(0, "bleue", 0, 0, 0), b = auto(1, "orange", 0, 1.2, Math.PI);
    a.v[2] = 14; a.auSol = true; b.auSol = true;
    const r = contactVoitureVoiture(a, b, 500);
    expect(r!.bump).not.toBeNull();
    expect(b.v[2]).toBeGreaterThan(15);
    expect(b.v[2]).toBeLessThan(21);
    expect(b.v[1]).toBeGreaterThan(2); // poussée le long du haut de la victime (≈ 2,8 m/s)
    // le côté d'une voiture ne bumpe pas : a longe b flanc contre flanc, aucun coin de son nez dans b
    const c = auto(2, "bleue", -0.7, 0, 0), d = auto(3, "orange", 0.05, 0, 0);
    c.v[2] = 14;
    const vd = d.v[2];
    const r2 = contactVoitureVoiture(c, d, 600);
    expect(r2 === null || r2.bump === null).toBe(true);
    expect(d.v[2]).toBeLessThan(vd + 8);
  });

  it("choc de côté ou de l'arrière : pas de démolition même supersonique", () => {
    // a supersonique roule le long de b (côté contre côté)
    const a = auto(0, "bleue", -0.7, 0, 0);
    a.v[2] = 22.5; a.supersonique = true;
    const b = auto(1, "orange", 0.05, 0, 0);
    const r = contactVoitureVoiture(a, b, 10);
    expect(r).not.toBeNull();
    expect(r!.demolition).toBeNull();
  });

  it("séparation et impulsion : plus de pénétration, la quantité de mouvement est conservée (hors bump)", () => {
    const a = auto(0, "bleue", 0, 0, 0), b = auto(1, "orange", 0, 1.3, Math.PI);
    a.v[2] = 8; a.dernierBumpTick = b.dernierBumpTick = 10; // bump déjà consommé
    const pz0 = a.v[2] * 1 + b.v[2] * 1;
    const r = contactVoitureVoiture(a, b, 11);
    expect(r).not.toBeNull();
    expect(r!.bump).toBeNull();
    expect(a.v[2] + b.v[2]).toBeCloseTo(pz0, 6);
    expect(a.v[2] - b.v[2]).toBeLessThan(8 * 0.5); // les deux ne se rapprochent presque plus
    expect(contactVoitureVoiture(a, b, 12)).toBeNull();
  });

  it("empilées l'une dans l'autre (centres confondus) : le SAT sépare sans NaN", () => {
    const a = auto(0, "bleue", 0, 0, 0), b = auto(1, "orange", 0.1, 0, 0.3);
    for (let i = 0; i < 50; i++) {
      pasVoiture(arene, a, ENTREES_NULLES(), PAS_S, i);
      pasVoiture(arene, b, ENTREES_NULLES(), PAS_S, i);
      contactVoitureVoiture(a, b, i);
    }
    expect(Number.isFinite(a.p[0] + b.p[2] + a.v[0] + b.w[1])).toBe(true);
    expect(contactVoitureVoiture(a, b, 99)).toBeNull();
  });
});
