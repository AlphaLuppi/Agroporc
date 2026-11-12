import { describe, expect, it } from "vitest";
import { creerArene } from "./arene";
import { bornerBalle, creerBalle, pasBalle } from "./balle";
import {
  BALLE, CONTACT_BALLE, CONTACT_MONDE, CONTACT_VOITURES, ENTREES_NULLES, PAS_S, VOITURE, interpolerTable,
  type EtatBalle, type EtatVoiture, type Equipe, type Vec3,
} from "./contrat";
import {
  appliquerVitesseEnAttente, contactVoitureBalle as contactBalleBrut, contactVoitureVoiture as contactVoituresBrut, rouesSurLaBalle,
  rouesTouchantLaBalle,
} from "./contacts";
import { centreHitbox, creerVoiture, DEMI_HITBOX, pasVoiture, plafonnerVitesse } from "./voiture";
import { norme } from "./vec";

/**
 * Le contact voiture ↔ balle tel que le voit `pasMonde` quand une seule voiture touche la balle : le contact, puis la fin de pas de
 * la balle (l'impulsion de Psyonix en attente entre dans sa vitesse). Les plafonds restent à la charge du test (`bornerBalle`).
 */
const contactVoitureBalle = (v: EtatVoiture, b: EtatBalle, tick: number, dt: number) => {
  const r = contactBalleBrut(v, b, tick, dt);
  appliquerVitesseEnAttente(b);
  return r;
};
/** Le contact voiture ↔ voiture tel que le voit `pasMonde` pour une seule paire : le contact, puis la vitesse des bumps en attente. */
const contactVoitureVoiture = (a: EtatVoiture, b: EtatVoiture, tick: number) => {
  const r = contactVoituresBrut(a, b, tick);
  appliquerVitesseEnAttente(a); appliquerVitesseEnAttente(b);
  return r;
};

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
    // la balle a été repoussée hors de la boîte : elle affleure le nez, sans pénétration
    expect(b.p[2]).toBeCloseTo(centreHitbox(v)[2] + DEMI_HITBOX[0] + BALLE.rayon, 9);
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
    w.v.derniereImpulsionPsyonixTick = 99; // impulsion donnée au pas précédent : celle-ci est sautée
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

  it("balle posée sur le toit (dribble), à l'aplomb de l'origine de la voiture : elle s'y tient plusieurs secondes sans exploser", () => {
    const v = auto(0, "bleue", 0, 0, 0);
    const c = centreHitbox(v);
    const toit = c[1] + DEMI_HITBOX[2];
    // le point d'équilibre de l'impulsion de Psyonix est l'ORIGINE de la voiture (13,9 cm derrière le centre de la hitbox) : c'est de
    // là que part sa direction (RocketSim Ball.cpp:266)
    const b = creerBalle([v.p[0], toit + BALLE.rayon + 0.01, v.p[2]]);
    b.v[1] = -1e-6; // lâchée (une balle sans aucune vitesse dort)
    let vmax = 0, contacts = 0;
    for (let i = 0; i < 360; i++) {
      pasVoiture(arene, v, ENTREES_NULLES(), PAS_S, i);
      pasBalle(arene, b, PAS_S);
      if (contactVoitureBalle(v, b, i, PAS_S)) contacts++;
      bornerBalle(b);
      vmax = Math.max(vmax, norme(b.v));
    }
    expect(contacts).toBeGreaterThan(300);
    expect(vmax).toBeLessThan(3);
    expect(Math.hypot(b.p[0] - v.p[0], b.p[2] - v.p[2])).toBeLessThan(0.5);
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

  /** Voiture en l'air à 18 m, à plat (cap 0 : avant = +Z, droite = -X), et une balle sous elle, centre à `dy` sous l'origine, décalée de (dx, dz). */
  function auDessus(dx: number, dy: number, dz: number): { v: EtatVoiture; b: EtatBalle } {
    const v = auto(0, "bleue", 0, 0, 0);
    v.p[1] = 18;
    return { v, b: creerBalle([dx, 18 - dy, dz]) };
  }
  /** Point du monde d'un point local `[avant, droite, haut]` de la voiture, descendu de `sous` le long de -haut. */
  function pointLocal(v: EtatVoiture, l: readonly [number, number, number], sous: number): Vec3 {
    const { avant, droite, haut } = v.base;
    return [
      v.p[0] + avant[0] * l[0] + droite[0] * l[1] + haut[0] * (l[2] - sous),
      v.p[1] + avant[1] * l[0] + droite[1] * l[1] + haut[1] * (l[2] - sous),
      v.p[2] + avant[2] * l[0] + droite[2] * l[1] + haut[2] * (l[2] - sous),
    ];
  }

  it("roues sur la balle : c'est le RAYON de suspension qui compte (48,755 uu à l'avant, 49,555 uu à l'arrière, RocketSim btVehicleRL::rayCast)", () => {
    // balle centrée sous la voiture : les quatre rayons la touchent
    const { v, b } = auDessus(0.1, 0.86, 0);
    const roues = [false, false, false, false];
    expect(rouesTouchantLaBalle(v, b.p, roues)).toBe(4);
    expect(roues).toEqual([true, true, true, true]);
    expect(rouesSurLaBalle(v, b.p)).toBe(true);
    // portée exacte d'un rayon avant : balle à l'aplomb de l'attache de la roue avant droite, sa surface à 48,7 puis 48,8 uu dessous
    const att = VOITURE.roues[0].attache;
    const sous = (ecart: number): Vec3 => pointLocal(v, att, ecart + BALLE.rayon);
    const r2 = [false, false, false, false];
    rouesTouchantLaBalle(v, sous(0.487), r2);
    expect(r2[0]).toBe(true);
    rouesTouchantLaBalle(v, sous(0.488), r2);
    expect(r2[0]).toBe(false);
    // et d'un rayon arrière : 49,5 puis 49,6 uu
    const arr = VOITURE.roues[2].attache;
    const sousArr = (ecart: number): Vec3 => pointLocal(v, arr, ecart + BALLE.rayon);
    rouesTouchantLaBalle(v, sousArr(0.495), r2);
    expect(r2[2]).toBe(true);
    rouesTouchantLaBalle(v, sousArr(0.496), r2);
    expect(r2[2]).toBe(false);
    // un rayon qui part de l'intérieur de la balle ne la touche pas
    rouesTouchantLaBalle(v, pointLocal(v, att, 0.2), r2);
    expect(r2[0]).toBe(false);
  });

  it("trois roues suffisent (RocketSim : isOnGround = 3 roues au contact), deux non", () => {
    // balle décalée vers l'avant gauche : la roue arrière droite (3ᵉ) n'y est plus
    const { v, b } = auDessus(0.3, 0.8, 0.3);
    const roues = [false, false, false, false];
    const n = rouesTouchantLaBalle(v, b.p, roues);
    expect(n).toBe(3);
    expect(roues).toEqual([true, true, false, true]);
    expect(rouesSurLaBalle(v, b.p)).toBe(true);
    // balle sous le seul côté gauche : deux roues
    const cote = auDessus(0.8, 0.6, 0);
    expect(rouesTouchantLaBalle(cote.v, cote.b.p)).toBe(2);
    expect(rouesSurLaBalle(cote.v, cote.b.p)).toBe(false);
  });

  it("roues sur la balle : la normale de la balle sous chaque roue est notée (RocketSim m_contactNormalWS du rayon), pour la direction des contacts", () => {
    const { v, b } = auDessus(0.3, 0.8, 0.3);
    // sentinelle : la normale d'une roue qui ne touche pas la balle n'est pas modifiée
    v.normalesRouesBalle[2] = [9, 9, 9];
    expect(contactBalleBrut(v, b, 10, PAS_S)).not.toBeNull();
    expect(v.rouesBalle).toEqual([true, true, false, true]);
    expect(v.normalesRouesBalle[2]).toEqual([9, 9, 9]);
    const { avant, droite, haut } = v.base;
    for (const i of [0, 1, 3]) {
      const n = v.normalesRouesBalle[i], att = VOITURE.roues[i].attache;
      expect(norme(n)).toBeCloseTo(1, 12);
      // le point d'impact (centre de la balle + rayon × normale) est sur le rayon de la roue : à l'aplomb de l'attache, le long de -haut
      const pt: Vec3 = [b.p[0] + n[0] * BALLE.rayon, b.p[1] + n[1] * BALLE.rayon, b.p[2] + n[2] * BALLE.rayon];
      const a0: Vec3 = pointLocal(v, att, 0);
      const d: Vec3 = [pt[0] - a0[0], pt[1] - a0[1], pt[2] - a0[2]];
      expect(d[0] * avant[0] + d[1] * avant[1] + d[2] * avant[2]).toBeCloseTo(0, 12);
      expect(d[0] * droite[0] + d[1] * droite[1] + d[2] * droite[2]).toBeCloseTo(0, 12);
      const le = -(d[0] * haut[0] + d[1] * haut[1] + d[2] * haut[2]);
      expect(le).toBeGreaterThan(0);
      expect(le).toBeLessThan(0.5);
      // la balle est sous la voiture : sa normale au point d'impact regarde vers le haut de la voiture
      expect(n[0] * haut[0] + n[1] * haut[1] + n[2] * haut[2]).toBeGreaterThan(0.5);
    }
  });

  it("flip reset : trois roues posées sur la balle valent « au sol » au pas suivant, le second saut et le flip sont rendus", () => {
    const { v, b } = auDessus(0.1, 0.86, 0);
    v.saut.aSaute = true; v.saut.secondUtilise = true; v.saut.depuisFinSaut = 2; v.saut.temps = 2;
    // un flip était en cours : il s'arrête, son temps et son verrou de tangage repartent de zéro (RocketSim : isFlipping = false, flipTime = 0)
    v.flip.actif = true; v.flip.temps = 0.3; v.flip.verrouTangage = 0.65; v.flip.dir = [1, 0];
    contactVoitureBalle(v, b, 10, PAS_S);
    expect(v.rouesBalle).toEqual([true, true, true, true]);
    pasVoiture(arene, v, ENTREES_NULLES(), PAS_S, 11);
    expect(v.auSol).toBe(true);
    expect(v.rouesContact).toBe(0); // aucune roue sur le décor : pas de force de pneu
    expect(v.saut.aSaute).toBe(false);
    expect(v.saut.secondUtilise).toBe(false);
    expect(v.saut.depuisFinSaut).toBe(0);
    expect(v.flip.actif).toBe(false);
    expect(v.flip.temps).toBe(0);
    expect(v.flip.verrouTangage).toBe(0);
    // la balle s'en va : les roues ne la touchent plus
    contactVoitureBalle(v, creerBalle([30, 1, 30]), 11, PAS_S);
    expect(v.rouesBalle).toEqual([false, false, false, false]);
    // le flip est de nouveau possible, sans limite de temps (la voiture n'a pas « sauté ») : 1,5 s plus tard, un appui avec le manche
    for (let i = 12; i < 192; i++) pasVoiture(arene, v, ENTREES_NULLES(), PAS_S, i);
    expect(v.auSol).toBe(false);
    expect(v.p[1]).toBeGreaterThan(5);
    const evs = pasVoiture(arene, v, { ...ENTREES_NULLES(), saut: true, tangage: -1 }, PAS_S, 192);
    expect(evs.some((e) => e.t === "flip")).toBe(true);
  });

  it("flip reset : un appui sur saut PENDANT que les roues touchent la balle est un saut au sol, le flip reste disponible ensuite", () => {
    const { v, b } = auDessus(0.1, 0.86, 0);
    v.saut.aSaute = true; v.saut.secondUtilise = true; v.saut.depuisFinSaut = 2; v.saut.temps = 2;
    contactVoitureBalle(v, b, 10, PAS_S);
    const vy = v.v[1];
    const evs = pasVoiture(arene, v, { ...ENTREES_NULLES(), saut: true }, PAS_S, 11);
    expect(evs.some((e) => e.t === "saut")).toBe(true);
    expect(evs.some((e) => e.t === "flip" || e.t === "doubleSaut")).toBe(false);
    expect(v.v[1]).toBeGreaterThan(vy + 2.5); // impulsion de saut le long du haut (2,92 m/s)
    expect(v.saut.secondUtilise).toBe(false);
  });

  it("pas de flip reset si deux roues seulement touchent la balle, ni pour une voiture démolie", () => {
    const { v, b } = auDessus(0.8, 0.6, 0);
    v.saut.aSaute = true; v.saut.secondUtilise = true; v.saut.depuisFinSaut = 2; v.saut.temps = 2;
    contactVoitureBalle(v, b, 10, PAS_S);
    expect(v.rouesBalle.filter(Boolean)).toHaveLength(2);
    pasVoiture(arene, v, ENTREES_NULLES(), PAS_S, 11);
    expect(v.auSol).toBe(false);
    expect(v.saut.secondUtilise).toBe(true);
    const d = auDessus(0.1, 0.86, 0);
    d.v.rouesBalle = [true, true, true, true];
    d.v.demolie = true;
    expect(contactVoitureBalle(d.v, d.b, 10, PAS_S)).toBeNull();
    expect(d.v.rouesBalle).toEqual([false, false, false, false]);
  });

  it("l'impulsion de Psyonix saute UN pas : en contact continu elle repart un pas sur deux (RocketSim Ball.cpp:262)", () => {
    expect(CONTACT_BALLE.delaiImpulsionPas).toBe(1);
    const { v, b } = frontal(15);
    const c = centreHitbox(v);
    const remettre = () => {
      b.p[0] = c[0]; b.p[1] = c[1]; b.p[2] = c[2] + DEMI_HITBOX[0] + BALLE.rayon - 0.05;
      b.v[0] = b.v[1] = b.v[2] = 0; b.w[0] = b.w[1] = b.w[2] = 0;
      v.v[0] = 0; v.v[1] = 0; v.v[2] = 15; v.w[0] = v.w[1] = v.w[2] = 0;
    };
    contactVoitureBalle(v, b, 100, PAS_S);
    const avec = norme(b.v);
    expect(v.derniereImpulsionPsyonixTick).toBe(100);
    // pas suivant : contact, mais pas d'impulsion supplémentaire (choc physique seul)
    remettre();
    expect(contactVoitureBalle(v, b, 101, PAS_S)).not.toBeNull();
    expect(v.derniereImpulsionPsyonixTick).toBe(100);
    expect(v.dernierContactBalleTick).toBe(101);
    expect(norme(b.v)).toBeLessThan(avec * 0.85);
    // deux pas après la première : elle repart, alors que le contact n'a jamais cessé
    remettre();
    v.dernierContactBalleTick = -1e9; // (vitesses relues avant le choc, comme pour un nouveau contact)
    contactVoitureBalle(v, b, 102, PAS_S);
    expect(v.derniereImpulsionPsyonixTick).toBe(102);
    expect(norme(b.v)).toBeCloseTo(avec, 6);
    // un compteur de pas revenu en arrière ne bloque pas l'impulsion (second test de RocketSim)
    remettre();
    v.dernierContactBalleTick = -1e9;
    contactVoitureBalle(v, b, 50, PAS_S);
    expect(v.derniereImpulsionPsyonixTick).toBe(50);
  });

  it("l'impulsion de Psyonix part de l'ORIGINE de la voiture, vers la balle d'avant la séparation : direction et intensité de RocketSim", () => {
    // balle posée au sol (centre à 0,9275 m), 1,5 m devant l'origine d'une voiture qui roule à 10 m/s
    const essai = (sansPsyonix: boolean) => {
      const v = auto(0, "bleue", 0, 0, 0);
      v.v[2] = 10;
      const b = creerBalle([0, 0.9275, 1.5]);
      if (sansPsyonix) v.derniereImpulsionPsyonixTick = 99;
      expect(contactVoitureBalle(v, b, 100, PAS_S)).not.toBeNull();
      return b;
    };
    const avec = essai(false), sans = essai(true);
    const d: Vec3 = [avec.v[0] - sans.v[0], avec.v[1] - sans.v[1], avec.v[2] - sans.v[2]];
    // hitDir = normalise((Δx, 0,35·Δy, Δz)) puis composante avant × 0,65 : élévation = atan(0,35 × 0,7575 / (0,65 × 1,5)) ≈ 15,2°
    const dy = 0.35 * (0.9275 - VOITURE.hauteurRepos), dz = 0.65 * 1.5;
    expect(d[0]).toBeCloseTo(0, 9);
    expect(Math.atan2(d[1], d[2])).toBeCloseTo(Math.atan2(dy, dz), 9);
    // intensité = vitesse relative × courbe : 10 m/s × 0,6222 (entre 0,65 à 5 m/s et 0,55 à 23 m/s)
    const facteur = interpolerTable(CONTACT_BALLE.courbeImpulsion, 10);
    expect(facteur).toBeCloseTo(0.65 - (5 / 18) * 0.1, 9);
    expect(norme(d)).toBeCloseTo(10 * facteur, 9);
    // (depuis le centre de la hitbox, 13,9 cm devant et 20,8 cm au-dessus de l'origine, la frappe partirait plus à plat : ≈ 12,7°)
    expect(Math.atan2(d[1], d[2]) * 180 / Math.PI).toBeGreaterThan(15);
  });

  it("l'impulsion de Psyonix part même si la balle s'éloigne déjà (RocketSim : aucune condition sur la vitesse d'approche)", () => {
    const v = auto(0, "bleue", 0, -5, 0);
    const c = centreHitbox(v);
    const b = creerBalle([0, c[1], c[2] + DEMI_HITBOX[0] + BALLE.rayon - 0.05]);
    b.v[2] = 5; // elle fuit le nez d'une voiture immobile
    expect(contactVoitureBalle(v, b, 100, PAS_S)).not.toBeNull();
    // aucun choc physique (la voiture n'a pas bougé), mais 0,65 × 5 m/s de plus le long de la direction de frappe
    expect(v.v).toEqual([0, 0, 0]);
    expect(norme(b.v)).toBeGreaterThan(5 + 0.65 * 5 * 0.9);
    expect(v.derniereImpulsionPsyonixTick).toBe(100);
    // sans vitesse relative, rien (RocketSim : relSpeed > 0), mais le délai est armé quand même
    const w = auto(1, "bleue", 0, -5, 0);
    const immobile = creerBalle([0, c[1], c[2] + DEMI_HITBOX[0] + BALLE.rayon - 0.05]);
    expect(contactVoitureBalle(w, immobile, 100, PAS_S)).not.toBeNull();
    expect(immobile.v).toEqual([0, 0, 0]);
    expect(w.derniereImpulsionPsyonixTick).toBe(100);
  });

  it("le contact existe à distance : jusqu'à 1,905 cm de la boîte (seuil de rupture de Bullet), sans séparation", () => {
    const pose = (ecart: number) => {
      const v = auto(0, "bleue", 0, -5, 0);
      v.v[2] = 10;
      const c = centreHitbox(v);
      return { v, b: creerBalle([0, c[1], c[2] + DEMI_HITBOX[0] + BALLE.rayon + ecart]) };
    };
    const pres = pose(0.015);
    const z = pres.b.p[2];
    expect(contactVoitureBalle(pres.v, pres.b, 100, PAS_S)).not.toBeNull();
    expect(pres.b.p[2]).toBe(z); // pas de pénétration : la balle n'est pas déplacée
    expect(pres.b.v[2]).toBeGreaterThan(10); // choc physique (elles se rapprochent) + impulsion de Psyonix
    expect(pres.v.derniereImpulsionPsyonixTick).toBe(100);
    const loin = pose(0.02);
    expect(contactVoitureBalle(loin.v, loin.b, 100, PAS_S)).toBeNull();
    expect(loin.b.v).toEqual([0, 0, 0]);
  });

  it("arêtes de la hitbox arrondies de 2 cm (marge de collision de Bullet) : les faces ne bougent pas, les coins reculent", () => {
    expect(CONTACT_BALLE.arrondiHitbox).toBeCloseTo(0.02, 12);
    const v = auto(0, "bleue", 0, 0, 0);
    const c = centreHitbox(v);
    // le long de la diagonale d'un coin avant haut droit : la surface arrondie est (√3 - 1) × 2 cm ≈ 1,46 cm en retrait du coin vif
    const u = 1 / Math.sqrt(3);
    const coin: Vec3 = [c[0] + DEMI_HITBOX[1], c[1] + DEMI_HITBOX[2], c[2] + DEMI_HITBOX[0]];
    const a = (d: number) => creerBalle([coin[0] + u * d, coin[1] + u * d, coin[2] + u * d]);
    const retrait = (Math.sqrt(3) - 1) * 0.02;
    expect(contactVoitureBalle(v, a(BALLE.rayon + BALLE.margeContact - retrait - 0.001), 0, PAS_S)).not.toBeNull();
    expect(contactVoitureBalle(v, a(BALLE.rayon + BALLE.margeContact - retrait + 0.001), 0, PAS_S)).toBeNull();
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
      bornerBalle(b); // comme `pasMonde` : plafonds une fois, après les contacts
      vmax = Math.max(vmax, norme(b.v));
      if (Math.abs(b.p[2]) < 60) expect(arene.sd(b.p)).toBeGreaterThan(BALLE.rayon - 0.1);
    }
    expect(vmax).toBeGreaterThan(25);
    expect(vmax).toBeLessThanOrEqual(60.0001);
  });
});

describe("contacts : voiture ↔ balle, fin de pas (RocketSim Ball::_velocityImpulseCache, état lu avant le solveur)", () => {
  it("l'impulsion de Psyonix attend la fin du pas dans `vitesseEnAttente` : la vitesse de la balle ne reçoit d'abord que le choc physique", () => {
    const { v, b } = frontal(15);
    expect(contactBalleBrut(v, b, 100, PAS_S)).not.toBeNull();
    // choc inélastique seul : la balle va à peu près à la vitesse de la voiture, pas plus
    const choc = norme(b.v);
    expect(choc).toBeGreaterThan(11);
    expect(choc).toBeLessThan(15.5);
    // l'impulsion attend : 15 m/s × courbe, vers l'avant
    const attente: Vec3 = [...b.vitesseEnAttente];
    expect(norme(attente)).toBeCloseTo(15 * interpolerTable(CONTACT_BALLE.courbeImpulsion, 15), 9);
    expect(attente[2]).toBeGreaterThan(8);
    // fin de pas : elle entre dans la vitesse, une seule fois
    const avantFin: Vec3 = [...b.v];
    appliquerVitesseEnAttente(b);
    expect(b.v).toEqual([avantFin[0] + attente[0], avantFin[1] + attente[1], avantFin[2] + attente[2]]);
    expect(b.vitesseEnAttente).toEqual([0, 0, 0]);
    appliquerVitesseEnAttente(b);
    expect(b.v).toEqual([avantFin[0] + attente[0], avantFin[1] + attente[1], avantFin[2] + attente[2]]);
  });

  /**
   * 50/50 : deux voitures face à face de part et d'autre de la balle, qui la touchent au même pas (a à 20 m/s, b à 12 m/s). Rend la
   * balle après les contacts résolus dans l'ordre donné (comme la boucle de `match.ts`), AVANT la fin de pas. `fige` : l'état de la
   * balle d'avant les contacts est passé à chaque contact (ce que fait `match.ts`) ; sinon chaque voiture lit la balle déjà modifiée
   * par la précédente, et l'impulsion de Psyonix de la première est ajoutée tout de suite (l'ancien comportement).
   */
  function cinquanteCinquante(ordre: "ab" | "ba", fige: boolean): EtatBalle {
    const a = auto(0, "bleue", 0, -1.5, 0), b = auto(1, "orange", 0, 1.5, Math.PI);
    a.v[2] = 20; b.v[2] = -12;
    const balle = creerBalle([0, BALLE.rayon + 0.01, 0]);
    const avant = { p: [...balle.p] as Vec3, v: [...balle.v] as Vec3 };
    for (const v of ordre === "ab" ? [a, b] : [b, a]) {
      expect(contactBalleBrut(v, balle, 100, PAS_S, fige ? avant : undefined)).not.toBeNull();
      if (!fige) appliquerVitesseEnAttente(balle);
      expect(v.derniereImpulsionPsyonixTick).toBe(100);
    }
    return balle;
  }
  /** L'impulsion de Psyonix que la voiture donnerait SEULE à la balle du 50/50. */
  function seule(qui: "a" | "b"): Vec3 {
    const v = qui === "a" ? auto(0, "bleue", 0, -1.5, 0) : auto(1, "orange", 0, 1.5, Math.PI);
    v.v[2] = qui === "a" ? 20 : -12;
    const balle = creerBalle([0, BALLE.rayon + 0.01, 0]);
    contactBalleBrut(v, balle, 100, PAS_S);
    return [...balle.vitesseEnAttente];
  }

  it("deux voitures sur la balle au même pas : l'impulsion de Psyonix de chacune ne dépend ni de l'autre ni de l'ordre des voitures", () => {
    const ab = cinquanteCinquante("ab", true), ba = cinquanteCinquante("ba", true);
    // même cumul dans les deux ordres, à l'octet
    expect(ab.vitesseEnAttente).toEqual(ba.vitesseEnAttente);
    // et c'est la somme de ce que chacune donnerait seule : aucune ne voit le choc ni l'impulsion de l'autre
    const sa = seule("a"), sb = seule("b");
    expect(norme(sa)).toBeCloseTo(20 * interpolerTable(CONTACT_BALLE.courbeImpulsion, 20), 9);
    expect(norme(sb)).toBeCloseTo(12 * interpolerTable(CONTACT_BALLE.courbeImpulsion, 12), 9);
    for (let k = 0; k < 3; k++) expect(ab.vitesseEnAttente[k]).toBeCloseTo(sa[k] + sb[k], 12);
    // la plus rapide l'emporte, dans les deux ordres : l'impulsion cumulée va vers +Z (le camp de b) et vers le haut
    expect(ab.vitesseEnAttente[2]).toBeGreaterThan(3);
    expect(ab.vitesseEnAttente[1]).toBeGreaterThan(0);
  });

  it("sans l'état d'avant les contacts, la seconde voiture lirait la balle déjà frappée par la première : impulsion faussée, selon l'ordre", () => {
    // contre-épreuve du test précédent : c'est bien l'état figé (et la vitesse en attente) qui rend l'impulsion indépendante de l'ordre
    const sa = seule("a"), sb = seule("b");
    const attendu = Math.hypot(sa[0] + sb[0], sa[1] + sb[1], sa[2] + sb[2]);
    // b passe en second : elle voit une balle que a vient d'envoyer vers elle à plus de 25 m/s, sa vitesse relative est gonflée
    const ab = cinquanteCinquante("ab", false), abFige = cinquanteCinquante("ab", true);
    appliquerVitesseEnAttente(abFige);
    expect(Math.hypot(ab.v[0] - abFige.v[0], ab.v[1] - abFige.v[1], ab.v[2] - abFige.v[2])).toBeGreaterThan(0.2 * attendu);
  });

  it("contact qui dure : la vitesse relative relue après le choc est corrigée de ce que les voitures précédentes ont donné à la balle", () => {
    // balle posée sur le toit (contact déjà là au pas précédent), qui glisse à 0,5 m/s sur la voiture, sans approche (pas de choc)
    const essai = (donne: Vec3 | null) => {
      const v = auto(0, "bleue", 0, 0, 0);
      v.v[2] = 10;
      v.dernierContactBalleTick = 99;
      const c = centreHitbox(v);
      const balle = creerBalle([c[0], c[1] + DEMI_HITBOX[2] + BALLE.rayon + 0.005, c[2]]);
      balle.v[0] = 0.3; balle.v[2] = 10.4;
      const avant = { p: [...balle.p] as Vec3, v: [...balle.v] as Vec3 };
      // une voiture passée plus tôt dans ce pas a déjà donné `donne` à la balle (vers le haut : toujours pas d'approche)
      if (donne) { balle.v[0] += donne[0]; balle.v[1] += donne[1]; balle.v[2] += donne[2]; }
      expect(contactBalleBrut(v, balle, 100, PAS_S, donne ? avant : undefined)).not.toBeNull();
      return [...balle.vitesseEnAttente] as Vec3;
    };
    const seule_ = essai(null), apres = essai([1, 6, -2]);
    expect(norme(seule_)).toBeCloseTo(0.5 * interpolerTable(CONTACT_BALLE.courbeImpulsion, 0.5), 9);
    for (let k = 0; k < 3; k++) expect(apres[k]).toBeCloseTo(seule_[k], 9);
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

  it("deux voitures supersoniques face à face : la première du couple démolit l'autre, le second sens n'est pas testé (ordre de RocketSim)", () => {
    const { a, b } = faceAFace(22.2, 22.6);
    const res = jusquAuContact(a, b);
    expect(res).not.toBeNull();
    // b fonce plus vite, mais c'est `a` (premier sens testé) qui démolit ; b, démolie, ne bumpe ni ne démolit
    expect(res!.r.demolition).toEqual({ auteur: 0, victime: 1 });
    expect(res!.r.bump).toBeNull();
    expect(a.bumpAutreId).toBe(1);
    expect(b.bumpAutreId).toBe(-1);
  });

  it("bump sans démolition entre coéquipiers, même supersonique", () => {
    const { a, b } = faceAFace(22.5, 0, "bleue");
    const res = jusquAuContact(a, b);
    expect(res).not.toBeNull();
    expect(res!.r.demolition).toBeNull();
    expect(res!.r.bump).not.toBeNull();
    expect(res!.r.bump!.vitesse).toBeGreaterThan(15);
  });

  it("bump : la victime reçoit un surcroît de vitesse ; le délai de 0,25 s est celui de l'ATTAQUANT contre CETTE victime", () => {
    const pose = (ida: number, idb: number) => {
      const a = auto(ida, "bleue", 0, 0, 0), b = auto(idb, "orange", 0, 1.2, Math.PI);
      a.v[2] = 10;
      return { a, b };
    };
    const { a, b } = pose(0, 1);
    // a attaque b (pas supersonique : simple bump)
    const r = contactVoitureVoiture(a, b, 500);
    expect(r).not.toBeNull();
    expect(r!.bump).not.toBeNull();
    expect(b.v[2]).toBeGreaterThan(5); // choc élastique faible + bump
    // le délai est armé chez l'attaquant seulement, contre sa victime (RocketSim CarContact : otherCarID, cooldownTimer)
    expect(a.bumpAutreId).toBe(1);
    expect(a.bumpDelaiTick).toBe(500);
    expect(b.bumpAutreId).toBe(-1);
    const vb = b.v[2];
    // encore en contact au pas suivant : pas de second bump de a sur b
    a.p[2] = 0.3; a.v[2] = 10; b.p[2] = 1.3;
    const r2 = contactVoitureVoiture(a, b, 501);
    expect(r2 === null || r2.bump === null).toBe(true);
    expect(b.v[2]).toBeLessThan(vb + 6);
    // 29 pas après : toujours non ; 30 pas après (0,25 s, le minuteur de RocketSim tombe à 0 au 30ᵉ décrément) : oui
    const tard = (ecart: number) => {
      const w = pose(2, 3);
      w.a.bumpAutreId = 3; w.a.bumpDelaiTick = 500;
      return contactVoitureVoiture(w.a, w.b, 500 + ecart)!.bump;
    };
    expect(tard(29)).toBeNull();
    expect(tard(30)).not.toBeNull();
    // le délai ne vaut que contre la même victime : a peut bumper une AUTRE voiture aussitôt
    const autre = pose(4, 5);
    autre.a.bumpAutreId = 9; autre.a.bumpDelaiTick = 500;
    expect(contactVoitureVoiture(autre.a, autre.b, 501)!.bump).not.toBeNull();
    // et la victime peut bumper son attaquant aussitôt : ici c'est d (la seconde du couple) qui fonce sur c, laquelle vient de la bumper
    const c = auto(6, "bleue", 0, 0, 0), d = auto(7, "orange", 0, 1.2, Math.PI);
    d.v[2] = -10;
    c.bumpAutreId = 7; c.bumpDelaiTick = 500;
    const r3 = contactVoitureVoiture(c, d, 501);
    expect(r3!.bump).not.toBeNull();
    expect(c.v[2]).toBeLessThan(-5);
    expect(d.bumpAutreId).toBe(6);
    expect(d.bumpDelaiTick).toBe(501);
  });

  it("bump : ni seuil de 1 m/s ni condition sur la normale ; il suffit d'aller vers l'autre plus vite qu'elle ne s'éloigne, pare-chocs engagé", () => {
    // approche lente (0,5 m/s) : bump quand même, minuscule (courbe de RocketSim : 5/6 uu/s à vitesse nulle)
    expect(CONTACT_VOITURES.bumpSol[0]).toEqual([0, (5 / 6) / 100]);
    expect(CONTACT_VOITURES.bumpAir[0]).toEqual([0, (5 / 6) / 100]);
    expect(CONTACT_VOITURES.bumpHaut[0]).toEqual([0, (2 / 6) / 100]);
    const a = auto(0, "bleue", 0, 0, 0), b = auto(1, "orange", 0, 1.2, Math.PI);
    a.v[2] = 0.5;
    const r = contactVoitureVoiture(a, b, 10);
    expect(r!.bump).not.toBeNull();
    expect(a.bumpAutreId).toBe(1);
    // rattrapée par une voiture à peine plus rapide dans le même sens : pas de bump tant que la victime fuit aussi vite que l'attaquant approche
    const c = auto(2, "bleue", 0, 0, 0), d = auto(3, "orange", 0, 1.15, 0);
    c.v[2] = 10; d.v[2] = 10.5;
    const r2 = contactVoitureVoiture(c, d, 10);
    expect(r2).not.toBeNull();
    expect(r2!.bump).toBeNull();
    expect(c.bumpAutreId).toBe(-1);
    const e = auto(4, "bleue", 0, 0, 0), f = auto(5, "orange", 0, 1.15, 0);
    e.v[2] = 10; f.v[2] = 9;
    expect(contactVoitureVoiture(e, f, 10)!.bump).not.toBeNull();
  });

  it("bump en l'air : courbe de l'air et poussée verticale monde (RocketSim BUMP_VEL_AMOUNT_AIR_CURVE, haut = +Z monde)", () => {
    const essai = (victimeAuSol: boolean) => {
      const a = auto(0, "bleue", 0, 0, 0), b = auto(1, "orange", 0, 1.2, Math.PI);
      a.v[2] = 14; b.auSol = victimeAuSol;
      // on isole le bump : même choc, délai armé ou non
      const t = auto(2, "bleue", 0, 0, 0), u = auto(1, "orange", 0, 1.2, Math.PI);
      t.v[2] = 14; u.auSol = victimeAuSol; t.bumpAutreId = 1; t.bumpDelaiTick = 99;
      contactVoitureVoiture(a, b, 100);
      contactVoitureVoiture(t, u, 100);
      return [b.v[0] - u.v[0], b.v[1] - u.v[1], b.v[2] - u.v[2]];
    };
    // l'entrée des courbes est la vitesse de l'attaquant vers la victime (origine → origine) : 14 m/s ici
    const sol = essai(true);
    expect(sol[2]).toBeCloseTo(11, 6); // 1400 → 1100 uu/s
    expect(sol[1]).toBeCloseTo(2.78, 6); // 1400 → 278 uu/s le long du haut de la victime
    const air = essai(false);
    expect(air[2]).toBeCloseTo(13.9, 6); // 1400 → 1390 uu/s
    expect(air[1]).toBeCloseTo(2.78, 6);
  });

  it("frottement et restitution du choc voiture ↔ voiture : 0,09 et 0,1 (RocketSim CARCAR_COLLISION_*), caisse ↔ décor : 0,3 et 0,3", () => {
    expect(CONTACT_VOITURES.frottement).toBe(0.09);
    expect(CONTACT_VOITURES.restitution).toBe(0.1);
    expect(CONTACT_MONDE).toEqual({ frottement: 0.3, restitution: 0.3, seuilRebond: 0.1 });
    // choc de face avec une vitesse de travers : l'impulsion tangentielle reçue par la victime ne dépasse pas 0,09 × l'impulsion normale
    const a = auto(0, "bleue", 0, 0, 0), b = auto(1, "orange", 0, 1.2, Math.PI);
    a.v[2] = 10; a.v[0] = 6;
    a.bumpAutreId = 1; a.bumpDelaiTick = 99; // pas de bump : choc seul
    contactVoitureVoiture(a, b, 100);
    expect(b.v[2]).toBeGreaterThan(3);
    expect(Math.abs(b.v[0])).toBeLessThanOrEqual(0.09 * b.v[2] + 1e-9);
    expect(Math.abs(b.v[0])).toBeGreaterThan(0);
  });

  it("une démolition arme aussi le délai de l'attaquant, et attend le délai comme un bump", () => {
    const pose = () => {
      const a = auto(0, "bleue", 0, 0, 0), b = auto(1, "orange", 0, 1.15, 0);
      a.v[2] = 22.5; a.supersonique = true;
      return { a, b };
    };
    const { a, b } = pose();
    expect(contactVoitureVoiture(a, b, 100)!.demolition).toEqual({ auteur: 0, victime: 1 });
    expect(a.bumpAutreId).toBe(1);
    expect(a.bumpDelaiTick).toBe(100);
    // délai en cours contre cette voiture : ni démolition ni bump
    const w = pose();
    w.a.bumpAutreId = 1; w.a.bumpDelaiTick = 90;
    const r = contactVoitureVoiture(w.a, w.b, 100)!;
    expect(r.demolition).toBeNull();
    expect(r.bump).toBeNull();
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

  it("démolition : il faut foncer vers l'autre plus vite qu'il ne s'éloigne (condition d'approche de RocketSim)", () => {
    // a supersonique à 22,5 m/s, pare-chocs dans l'arrière de b qui file dans le même sens à 23 m/s : b s'éloigne plus vite, pas de démolition
    const fuit = (vitesseB: number) => {
      const a = auto(0, "bleue", 0, 0, 0), b = auto(1, "orange", 0, 1.15, 0);
      a.v[2] = 22.5; a.supersonique = true;
      b.v[2] = vitesseB;
      return contactVoitureVoiture(a, b, 10);
    };
    const r = fuit(23);
    expect(r).not.toBeNull();
    expect(r!.demolition).toBeNull();
    // b plus lente (15 m/s) : rattrapée par le pare-chocs avant, elle est démolie
    expect(fuit(15)!.demolition).toEqual({ auteur: 0, victime: 1 });
    // a qui s'éloigne de b (vitesse opposée à l'écart des origines) ne démolit pas, même supersonique et pare-chocs engagé
    const a = auto(0, "bleue", 0, 0, 0), b = auto(1, "orange", 0, 1.15, 0);
    a.v[2] = -22.5; a.supersonique = true;
    expect(contactVoitureVoiture(a, b, 10)!.demolition).toBeNull();
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
    a.v[2] = 8; a.bumpAutreId = 1; a.bumpDelaiTick = 10; // bump de a sur b déjà consommé
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

describe("contacts : voiture ↔ voiture, fin de pas (RocketSim Car::_velocityImpulseCache, état lu avant le solveur)", () => {
  it("la vitesse d'un bump attend la fin du pas dans `vitesseEnAttente` : la victime ne reçoit d'abord que le choc physique", () => {
    const a = auto(0, "bleue", 0, 0, 0), b = auto(1, "orange", 0, 1.2, Math.PI);
    a.v[2] = 14; b.auSol = true;
    const r = contactVoituresBrut(a, b, 500);
    expect(r!.bump).not.toBeNull();
    // choc physique seul (≈ la moitié de la vitesse d'approche, restitution 0,1)
    expect(b.v[2]).toBeGreaterThan(4);
    expect(b.v[2]).toBeLessThan(9);
    // le bump attend : 1400 uu/s → 1100 uu/s le long de la marche de l'attaquant, 278 uu/s le long du haut de la victime
    expect(b.vitesseEnAttente[0]).toBeCloseTo(0, 9);
    expect(b.vitesseEnAttente[1]).toBeCloseTo(2.78, 6);
    expect(b.vitesseEnAttente[2]).toBeCloseTo(11, 6);
    expect(a.vitesseEnAttente).toEqual([0, 0, 0]);
    // fin de pas (comme `match.ts`) : vitesse en attente puis plafond de 23 m/s, une fois
    const choc = b.v[2];
    appliquerVitesseEnAttente(b);
    expect(b.v[2]).toBeCloseTo(choc + 11, 6);
    expect(b.vitesseEnAttente).toEqual([0, 0, 0]);
    plafonnerVitesse(b);
    expect(norme(b.v)).toBeLessThanOrEqual(VOITURE.vitesseMax + 1e-9);
  });

  /**
   * Trois voitures à la file qui se touchent au même pas : a (14 m/s) emboutit b (à l'arrêt), dont le nez est déjà contre l'arrière
   * de c (à l'arrêt). Paires dans l'ordre de `match.ts` : (a, b), (a, c), (b, c). `fige` : les vitesses d'avant les contacts sont
   * passées à chaque paire et la vitesse en attente n'entre qu'à la fin (ce que fait `match.ts`) ; sinon la vitesse du bump est
   * ajoutée dès la fin de sa paire, et chaque paire lit les vitesses du moment (l'ancien comportement).
   */
  function file(fige: boolean) {
    const a = auto(0, "bleue", 0, -2.3, 0), b = auto(1, "orange", 0, -1.16, 0), c = auto(2, "orange", 0, 0, 0);
    a.v[2] = 14;
    for (const v of [a, b, c]) v.auSol = true;
    const vs = [a, b, c];
    const avant = vs.map((v) => [...v.v] as Vec3);
    const bumps: [number, number][] = [];
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const r = contactVoituresBrut(vs[i], vs[j], 500, fige ? avant[i] : undefined, fige ? avant[j] : undefined);
      if (!fige) { appliquerVitesseEnAttente(vs[i]); appliquerVitesseEnAttente(vs[j]); }
      if (r?.bump) bumps.push([i, j]);
    }
    return { a, b, c, bumps };
  }

  it("trois voitures au même pas : la voiture bumpée dans la paire (a, b) n'entre pas dans la paire (b, c) avec cette vitesse", () => {
    const { a, b, c, bumps } = file(true);
    // un seul bump : a sur b. b était à l'arrêt avant les contacts : elle ne va « vers » c dans aucun rappel (RocketSim lit l'état
    // d'avant le solveur), donc elle ne bumpe pas c, quoi que lui ait donné le choc de a
    expect(bumps).toEqual([[0, 1]]);
    expect(a.bumpAutreId).toBe(1);
    expect(b.bumpAutreId).toBe(-1);
    expect(b.vitesseEnAttente[2]).toBeCloseTo(11, 6);
    expect(c.vitesseEnAttente).toEqual([0, 0, 0]);
    // c ne reçoit que le choc physique transmis par b (le solveur), sans surcroît de bump
    expect(c.v[2]).toBeGreaterThan(0);
    expect(c.v[2]).toBeLessThan(6);
    expect(c.v[1]).toBeLessThan(0.5); // aucune poussée le long du haut
  });

  it("sans les vitesses d'avant les contacts ni la vitesse en attente, b bumperait c à son tour avec l'élan reçu de a", () => {
    // contre-épreuve du test précédent : l'ancien enchaînement transmettait le bump d'une paire à l'autre
    const { b, c, bumps } = file(false);
    expect(bumps).toEqual([[0, 1], [1, 2]]);
    expect(b.bumpAutreId).toBe(2);
    expect(c.v[2]).toBeGreaterThan(10);
  });
});
