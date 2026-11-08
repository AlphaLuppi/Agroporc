import { describe, expect, it } from "vitest";
import { DEFAUT_CONFIG, ENTREES_NULLES, PLOTS, creerRng, tirer } from "../contrat";
import type { ConfigMatch, EntreesVoiture, Format, MondeRocket } from "../contrat";
import { creerArene } from "../arene";
import { creerMonde, empreinteMonde, pasMonde } from "../match";
import {
  decoderEtat, decoderSnap, decoderTrameEntrees, dequantifierEntrees, encoderEtat, encoderSnap, encoderTrameEntrees, extraireEtat, quantifierEntrees,
  restaurerEtat, typeDeTrame,
} from "./serialisation";
import { ENTREES_QUANTIFIEES_NULLES, RESEAU, TRAME_ENTREES, TRAME_SNAP, octetsEtatEgaux } from "./protocole";
import type { EntreesQuantifiees, SnapRocket, TrameEntrees } from "./protocole";

const arene = creerArene();
const cfg = (o: Partial<ConfigMatch> = {}): ConfigMatch => ({ ...DEFAUT_CONFIG(), dureeS: 30, ...o });

/** Entrées pseudo-aléatoires qui changent toutes les ~10 pas : voitures actives, sauts, boost, flips. */
function generateurEntrees(graine: number, n: number): (tick: number) => EntreesVoiture[] {
  const rng = creerRng(graine);
  const cache: EntreesVoiture[] = Array.from({ length: n }, () => ENTREES_NULLES());
  return (tick) => {
    if (tick % 10 === 0) {
      for (const e of cache) {
        const choix = (): number => Math.round((tirer(rng) * 2 - 1) * 3) / 3;
        e.accel = tirer(rng) < 0.8 ? 1 : choix();
        e.direction = choix(); e.tangage = choix(); e.lacet = choix(); e.roulis = choix();
        e.saut = tirer(rng) < 0.25; e.boost = tirer(rng) < 0.6; e.derapage = tirer(rng) < 0.15;
      }
    }
    return cache.map((e) => quantifieeEgale(e));
  };
}
/** Entrée de la forme que le serveur simule : quantifiée puis redevenue réelle. */
const quantifieeEgale = (e: EntreesVoiture): EntreesVoiture => dequantifierEntrees(quantifierEntrees(e));

function avancer(m: MondeRocket, n: number, entrees: (tick: number) => EntreesVoiture[]): void {
  for (let i = 0; i < n; i++) pasMonde(m, entrees(m.tick));
}

describe("quantification des entrées", () => {
  it("rend des entiers de −127 à 127, bornés, sans −0", () => {
    const q = quantifierEntrees({ accel: 5, direction: -9, tangage: 0.5, lacet: -0.0001, roulis: 1 / 3, saut: true, boost: false, derapage: true });
    expect(q).toEqual({ accel: 127, direction: -127, tangage: 64, lacet: 0, roulis: 42, saut: true, boost: false, derapage: true });
    expect(Object.is(q.lacet, 0)).toBe(true);
  });
  it("valeurs non finies : 0", () => {
    const q = quantifierEntrees({ accel: NaN, direction: Infinity, tangage: -Infinity, lacet: undefined as unknown as number, roulis: 0, saut: false, boost: false, derapage: false });
    expect([q.accel, q.direction, q.tangage, q.lacet, q.roulis]).toEqual([0, 0, 0, 0, 0]);
  });
  it("idempotente : quantifier(dequantifier(q)) = q pour les 255 valeurs", () => {
    for (let k = -127; k <= 127; k++) {
      const q: EntreesQuantifiees = { accel: k, direction: k, tangage: k, lacet: k, roulis: k, saut: k > 0, boost: k < 0, derapage: k % 2 === 0 };
      expect(quantifierEntrees(dequantifierEntrees(q))).toEqual(q);
    }
  });
  it("les réels rendus restent dans [−1, 1]", () => {
    const e = dequantifierEntrees({ accel: -127, direction: 127, tangage: 0, lacet: 1, roulis: -1, saut: false, boost: false, derapage: false });
    expect(e.accel).toBe(-1);
    expect(e.direction).toBe(1);
  });
});

describe("extraireEtat / encoderEtat / decoderEtat", () => {
  it.each(["1v1", "2v2", "3v3"] as Format[])("%s : aller-retour exact (égalité profonde) à plusieurs moments du match", (format) => {
    const m = creerMonde(cfg({ format }), arene);
    const ent = generateurEntrees(7, m.voitures.length);
    let vus = 0;
    for (let etape = 0; etape < 12; etape++) {
      avancer(m, etape === 0 ? 1 : 250, ent);
      const e = extraireEtat(m);
      const octets = encoderEtat(e);
      const d = decoderEtat(octets);
      expect(d).toEqual(e);
      // ré-encodage identique octet à octet
      expect(octetsEtatEgaux(encoderEtat(d!), octets)).toBe(true);
      vus++;
    }
    expect(vus).toBe(12);
  });

  it("conserve −Infinity de `interne` (monde neuf), un dernier but et des toucheurs", () => {
    const m = creerMonde(cfg(), arene);
    const e0 = extraireEtat(m);
    expect(e0.interne.touchePoints.every((x) => x === -Infinity)).toBe(true);
    expect(decoderEtat(encoderEtat(e0))).toEqual(e0);
    // monde avancé jusqu'à une balle marquée
    avancer(m, 400, () => m.voitures.map(() => ENTREES_NULLES()));
    m.balle.p = [0, 2, 56];
    m.balle.dernierToucheur = { idVoiture: 1, equipe: "orange", temps: 1.25 };
    m.balle.avantDernierToucheur = { idVoiture: 0, equipe: "bleue", temps: 0.5 };
    for (let i = 0; i < 5; i++) pasMonde(m, m.voitures.map(() => ENTREES_NULLES()));
    expect(m.dernierBut).not.toBeNull();
    const e = extraireEtat(m);
    expect(e.dernierBut).not.toBeNull();
    expect(decoderEtat(encoderEtat(e))).toEqual(e);
  });

  it("dernierBut null et plein, vainqueur, plots rechargeant : tout revient", () => {
    const m = creerMonde(cfg({ format: "2v2" }), arene);
    m.plots[3].actif = false; m.plots[3].recharge = 7.123456789;
    m.plots[10].recharge = -0;
    m.vainqueur = "orange";
    m.phase = "fini";
    m.score.bleue = 3; m.score.orange = 4;
    m.dernierBut = { equipe: "orange", idMarqueur: 2, idPasse: null, vitesseKmh: 87.5 };
    const e = extraireEtat(m);
    const d = decoderEtat(encoderEtat(e))!;
    expect(d).toEqual(e);
    expect(Object.is(d.plots[10].recharge, -0)).toBe(true);
    m.dernierBut = null;
    expect(decoderEtat(encoderEtat(extraireEtat(m)))!.dernierBut).toBeNull();
  });

  it("NaN et ±Infinity traversent le codage binaire", () => {
    const m = creerMonde(cfg(), arene);
    m.balle.p = [NaN, Infinity, -Infinity];
    const d = decoderEtat(encoderEtat(extraireEtat(m)))!;
    expect(Number.isNaN(d.balle.p[0])).toBe(true);
    expect(d.balle.p[1]).toBe(Infinity);
    expect(d.balle.p[2]).toBe(-Infinity);
  });

  it("extraireEtat est une copie : modifier le monde ensuite ne change pas l'état extrait", () => {
    const m = creerMonde(cfg(), arene);
    const e = extraireEtat(m);
    const avant = JSON.stringify(e, (_k, v) => (v === -Infinity ? "-inf" : v));
    avancer(m, 500, generateurEntrees(3, m.voitures.length));
    expect(JSON.stringify(e, (_k, v) => (v === -Infinity ? "-inf" : v))).toBe(avant);
  });

  it("taille de la section : de l'ordre de 0,9 ko en 1v1 à 2,3 ko en 3v3", () => {
    const t1 = encoderEtat(extraireEtat(creerMonde(cfg({ format: "1v1" }), arene))).length;
    const t3 = encoderEtat(extraireEtat(creerMonde(cfg({ format: "3v3" }), arene))).length;
    expect(t1).toBeGreaterThan(500);
    expect(t1).toBeLessThan(1100);
    expect(t3).toBeLessThan(2400);
    expect(t3).toBeGreaterThan(t1);
  });
});

describe("restaurerEtat : continuité exacte", () => {
  it.each(["1v1", "2v2", "3v3"] as Format[])("%s : un monde restauré poursuit 3 000 pas à l'identique de l'original (empreinte ET état binaire)", (format) => {
    const original = creerMonde(cfg({ format, dureeS: 25 }), arene);
    const n = original.voitures.length;
    avancer(original, 1700, generateurEntrees(11, n));
    const etat = decoderEtat(encoderEtat(extraireEtat(original)))!;
    const copie = creerMonde(cfg({ format, dureeS: 25, graine: 99 }), arene); // autre graine : tout doit être écrasé
    avancer(copie, 37, generateurEntrees(5, n));
    restaurerEtat(etat, copie);
    expect(empreinteMonde(copie)).toBe(empreinteMonde(original));
    expect(octetsEtatEgaux(encoderEtat(extraireEtat(copie)), encoderEtat(extraireEtat(original)))).toBe(true);
    const e1 = generateurEntrees(23, n), e2 = generateurEntrees(23, n);
    // la suite : les entrées sont rejouées depuis le même tick (les générateurs dépendent du tick)
    for (let i = 0; i < 3000; i++) {
      const a = pasMonde(original, e1(original.tick));
      const b = pasMonde(copie, e2(copie.tick));
      expect(b.length).toBe(a.length);
      if (i % 250 === 0) {
        expect(empreinteMonde(copie)).toBe(empreinteMonde(original));
        expect(octetsEtatEgaux(encoderEtat(extraireEtat(copie)), encoderEtat(extraireEtat(original)))).toBe(true);
      }
    }
    expect(empreinteMonde(copie)).toBe(empreinteMonde(original));
    expect(octetsEtatEgaux(encoderEtat(extraireEtat(copie)), encoderEtat(extraireEtat(original)))).toBe(true);
    expect(copie.phase).toBe(original.phase);
  });

  it("couvre la fin de match et la prolongation : événements identiques jusqu'à la phase « fini »", () => {
    const original = creerMonde(cfg({ format: "1v1", dureeS: 6 }), arene);
    const n = original.voitures.length;
    avancer(original, 400, generateurEntrees(2, n));
    const copie = creerMonde(cfg({ format: "1v1", dureeS: 6 }), arene);
    restaurerEtat(extraireEtat(original), copie);
    const e1 = generateurEntrees(4, n), e2 = generateurEntrees(4, n);
    let ev1 = "", ev2 = "";
    original.tempsRestant = 0.5; copie.tempsRestant = 0.5;
    let prolongation = false;
    for (let i = 0; i < 4000 && original.phase !== "fini"; i++) {
      if (original.prolongation && !prolongation) { prolongation = true; original.balle.p = [0, 2, 56]; copie.balle.p = [0, 2, 56]; }
      ev1 += JSON.stringify(pasMonde(original, e1(original.tick)));
      ev2 += JSON.stringify(pasMonde(copie, e2(copie.tick)));
    }
    expect(prolongation).toBe(true);
    expect(original.phase).toBe("fini");
    expect(ev2).toBe(ev1);
    expect(copie.phase).toBe("fini");
    expect(empreinteMonde(copie)).toBe(empreinteMonde(original));
  });

  it("recopie `precedent` depuis l'état restauré et écrit sur place (les objets du monde ne changent pas)", () => {
    const a = creerMonde(cfg(), arene);
    avancer(a, 600, generateurEntrees(1, a.voitures.length));
    const b = creerMonde(cfg(), arene);
    const refVoitures = b.voitures.map((v) => v);
    const refP = b.voitures[0].p;
    const refBalle = b.balle.p;
    restaurerEtat(extraireEtat(a), b);
    expect(b.voitures.every((v, i) => v === refVoitures[i])).toBe(true);
    expect(b.voitures[0].p).toBe(refP);
    expect(b.balle.p).toBe(refBalle);
    for (let i = 0; i < b.voitures.length; i++) {
      expect(b.precedent.voitures[i].p).toEqual(b.voitures[i].p);
      expect(b.precedent.voitures[i].base).toEqual(b.voitures[i].base);
    }
    expect(b.precedent.balle.p).toEqual(b.balle.p);
  });

  it("refuse un état d'un autre nombre de voitures (erreur de programmation)", () => {
    const a = creerMonde(cfg({ format: "1v1" }), arene);
    const b = creerMonde(cfg({ format: "2v2" }), arene);
    expect(() => restaurerEtat(extraireEtat(a), b)).toThrow();
  });
});

describe("trames d'entrées", () => {
  const entree = (k: number): EntreesQuantifiees => ({ accel: k, direction: -k || 0, tangage: k % 100, lacet: 0, roulis: -127, saut: k % 2 === 0, boost: k % 3 === 0, derapage: k % 5 === 0 });
  it("aller-retour et taille (11 + 6 × n)", () => {
    for (const n of [0, 1, 5, 12]) {
      const t: TrameEntrees = { numero: 7, tickDebut: 123456, snapRecu: 123450, entrees: Array.from({ length: n }, (_, i) => entree(i * 11)) };
      const o = encoderTrameEntrees(t);
      expect(o.length).toBe(11 + 6 * n);
      expect(typeDeTrame(o)).toBe(TRAME_ENTREES);
      expect(decoderTrameEntrees(o)).toEqual(t);
    }
  });
  it("numero modulo 256, snapRecu = −1 conservé, tick au-delà de 2^31", () => {
    const t: TrameEntrees = { numero: 300, tickDebut: 3_000_000_000, snapRecu: -1, entrees: [ENTREES_QUANTIFIEES_NULLES()] };
    const d = decoderTrameEntrees(encoderTrameEntrees(t))!;
    expect(d.numero).toBe(300 & 255);
    expect(d.tickDebut).toBe(3_000_000_000);
    expect(d.snapRecu).toBe(-1);
  });
  it("−128 d'un client modifié est ramené à −127 (jamais hors [−127, 127])", () => {
    const o = encoderTrameEntrees({ numero: 1, tickDebut: 0, snapRecu: 0, entrees: [ENTREES_QUANTIFIEES_NULLES()] });
    new DataView(o.buffer).setInt8(11, -128);
    expect(decoderTrameEntrees(o)!.entrees[0].accel).toBe(-127);
  });
  it("rejette : trop courte, tronquée, trop longue, plus de 12 entrées, boutons inconnus, mauvais type", () => {
    const t: TrameEntrees = { numero: 1, tickDebut: 5, snapRecu: 0, entrees: [entree(1), entree(2), entree(3)] };
    const o = encoderTrameEntrees(t);
    for (let k = 0; k < o.length; k++) expect(decoderTrameEntrees(o.slice(0, k))).toBeNull();
    expect(decoderTrameEntrees(new Uint8Array([...o, 0]))).toBeNull();
    const trop = o.slice(); trop[10] = 13;
    expect(decoderTrameEntrees(trop)).toBeNull();
    const bits = o.slice(); bits[11 + 5] = 0xff;
    expect(decoderTrameEntrees(bits)).toBeNull();
    const type = o.slice(); type[0] = TRAME_SNAP;
    expect(decoderTrameEntrees(type)).toBeNull();
    expect(decoderTrameEntrees(new Uint8Array(0))).toBeNull();
  });
  it("l'encodeur refuse plus de 12 entrées", () => {
    expect(() => encoderTrameEntrees({ numero: 1, tickDebut: 0, snapRecu: 0, entrees: Array.from({ length: 13 }, () => ENTREES_QUANTIFIEES_NULLES()) })).toThrow();
  });
});

describe("instantanés", () => {
  function snapDe(m: MondeRocket, o: Partial<SnapRocket> = {}): SnapRocket {
    return {
      tick: m.tick, ralenti: false, numero: 3, nbVoitures: m.voitures.length, entreesRecuesJusqua: m.tick + 4, avance: 6, manquees: 2,
      entrees: m.voitures.map((_, i) => ({ accel: i * 20 - 40, direction: 5, tangage: 0, lacet: -3, roulis: 127, saut: i % 2 === 0, boost: true, derapage: false })),
      etat: extraireEtat(m), ...o,
    };
  }
  it.each(["1v1", "2v2", "3v3"] as Format[])("%s : aller-retour, en-tête de 14 octets, octetsEtat exact", (format) => {
    const m = creerMonde(cfg({ format }), arene);
    avancer(m, 700, generateurEntrees(9, m.voitures.length));
    const s = snapDe(m);
    const o = encoderSnap(s);
    expect(typeDeTrame(o)).toBe(TRAME_SNAP);
    const d = decoderSnap(o)!;
    expect(d).not.toBeNull();
    const { octetsEtat, ...reste } = d;
    expect(reste).toEqual(s);
    expect(octetsEtat).toBeDefined();
    expect(octetsEtatEgaux(octetsEtat!, encoderEtat(s.etat))).toBe(true);
    expect(o.length).toBe(14 + 6 * s.nbVoitures + encoderEtat(s.etat).length);
  });
  it("tailles : ≤ 3 ko même en 3v3", () => {
    const m = creerMonde(cfg({ format: "3v3" }), arene);
    avancer(m, 2000, generateurEntrees(9, 6));
    expect(encoderSnap(snapDe(m)).length).toBeLessThanOrEqual(3000);
  });
  it("drapeau ralenti, avance −128 (inconnue), entreesRecuesJusqua −1, manquees saturé", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    const s = snapDe(m, { ralenti: true, avance: -128, entreesRecuesJusqua: -1, manquees: 255 });
    const d = decoderSnap(encoderSnap(s))!;
    expect(d.ralenti).toBe(true);
    expect(d.avance).toBe(-128);
    expect(d.entreesRecuesJusqua).toBe(-1);
    expect(d.manquees).toBe(255);
  });
  it("le décodeur copie la section état (le tampon source peut être réutilisé)", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    const o = encoderSnap(snapDe(m));
    const d = decoderSnap(o)!;
    const avant = d.octetsEtat!.slice();
    o.fill(0xab);
    expect(octetsEtatEgaux(d.octetsEtat!, avant)).toBe(true);
  });
  it("décode une vue (subarray) d'un tampon plus grand", () => {
    const m = creerMonde(cfg({ format: "2v2" }), arene);
    const s = snapDe(m);
    const o = encoderSnap(s);
    const grand = new Uint8Array(o.length + 20);
    grand.set(o, 9);
    expect(decoderSnap(grand.subarray(9, 9 + o.length))!.etat).toEqual(s.etat);
  });
  it("toute troncature ou rallonge de la trame donne null", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    const o = encoderSnap(snapDe(m));
    for (let k = 0; k < o.length; k++) expect(decoderSnap(o.slice(0, k))).toBeNull();
    expect(decoderSnap(new Uint8Array([...o, 1]))).toBeNull();
  });
  it("nbVoitures de l'en-tête différent de celui de l'état : null", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    const o = encoderSnap(snapDe(m));
    const mal = o.slice(); mal[2] = 4;
    expect(decoderSnap(mal)).toBeNull();
  });
  it("l'encodeur refuse des entrées en nombre différent de nbVoitures", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    expect(() => encoderSnap(snapDe(m, { entrees: [] }))).toThrow();
  });
});

describe("décodeurs : trames malformées", () => {
  it("1 000 trames aléatoires : jamais de levée, toujours null (type 1, type 2, n'importe quoi)", () => {
    const rng = creerRng(42);
    for (let i = 0; i < 1000; i++) {
      const n = Math.floor(tirer(rng) * 700);
      const o = new Uint8Array(n);
      for (let k = 0; k < n; k++) o[k] = Math.floor(tirer(rng) * 256);
      if (n > 0 && i % 3 === 0) o[0] = TRAME_SNAP;
      if (n > 0 && i % 3 === 1) o[0] = TRAME_ENTREES;
      expect(() => { decoderSnap(o); decoderTrameEntrees(o); decoderEtat(o); typeDeTrame(o); }).not.toThrow();
      expect(decoderSnap(o)).toBeNull();
    }
  });
  it("mutations d'un octet d'un instantané valide : ne lève jamais", () => {
    const m = creerMonde(cfg({ format: "2v2" }), arene);
    const o = encoderSnap({
      tick: 0, ralenti: false, numero: 1, nbVoitures: 4, entreesRecuesJusqua: -1, avance: -128, manquees: 0,
      entrees: m.voitures.map(() => ENTREES_QUANTIFIEES_NULLES()), etat: extraireEtat(m),
    });
    const rng = creerRng(5);
    for (let i = 0; i < 1500; i++) {
      const c = o.slice();
      c[Math.floor(tirer(rng) * c.length)] = Math.floor(tirer(rng) * 256);
      expect(() => decoderSnap(c)).not.toThrow();
    }
  });
  it("états absurdes : trop de voitures, nombre de plots faux, phase inconnue", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    const o = encoderEtat(extraireEtat(m));
    const voitures = o.slice(); voitures[0] = 200;
    expect(decoderEtat(voitures)).toBeNull();
    const plots = o.slice(); plots[1] = PLOTS.length - 1;
    expect(decoderEtat(plots)).toBeNull();
    const phase = o.slice(); phase[2] = 9;
    expect(decoderEtat(phase)).toBeNull();
    expect(decoderEtat(new Uint8Array(0))).toBeNull();
    expect(decoderEtat(null as unknown as Uint8Array)).toBeNull();
  });
  it("typeDeTrame : 1, 2, sinon null", () => {
    expect(typeDeTrame(new Uint8Array([1]))).toBe(1);
    expect(typeDeTrame(new Uint8Array([2, 0]))).toBe(2);
    expect(typeDeTrame(new Uint8Array([0]))).toBeNull();
    expect(typeDeTrame(new Uint8Array([3]))).toBeNull();
    expect(typeDeTrame(new Uint8Array(0))).toBeNull();
  });
  it("RESEAU.entreesMaxParTrame est bien la borne du décodeur", () => {
    expect(RESEAU.entreesMaxParTrame).toBe(12);
  });
});
