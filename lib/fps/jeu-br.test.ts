import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aleaGraine } from "../agroparc3d/cachettes";
import type { Building, SceneData } from "../agroparc3d/types";
import { AVION_BR, CHUTE_BR, etatChuteInitial, pasChute, positionAvionBr, tracerVolBr, type EntreesChute } from "./br-chute";
import { BR, EQUIPEMENT_DEPART_BR } from "./br-regles";
import { genererPlanZone, zoneBrPublique } from "./br-zone";
import { construireMonde, type Boite, type Monde } from "./collision";
import {
  ButinClient, CAMERA_AVION_DY, ControleurVol, DT_RATTRAPAGE_MAX_S, ECART_ATTERRISSAGE_M, ECART_RECALAGE_M, PERIODE_CHUTE_MS, SuiviSpectateur,
  degatsDeTempete, etatBrHud, etatHudBr, inviteRamassage, libelleObjetBr, progressionUsage, reperesZone, soinInutile, vieAffichee,
  type CandidatSuivi, type EntreeHudBr, type EntreesVol, type EtatVol,
} from "./jeu-br";
import { copierEquipement, type AvionBr, type Equipement, type EtatPartieBr, type ObjetBr, type Vec3 } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const BORNES: Boite = { x0: -348.8, z0: -257.9, x1: 392.4, z1: 233.7 };
const DT = CHUTE_BR.pas;

function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
const mondeDe = (...b: Building[]): Monde => construireMonde({ ...scene, buildings: b, pois: [] });
const vide = mondeDe();

const LIBRE: EntreesVol = { lacet: 0, tangage: 0, avance: 0, lateral: 0, saut: false };
const SAUT: EntreesVol = { ...LIBRE, saut: true };

/** Le message `saut` que le serveur enverrait à `p` avec la vitesse de l'avion. */
function saut(c: ControleurVol, p: Vec3, v: Vec3 = [30, 0, 0]): void {
  c.surSaut({ t: "saut", p, v, lacet: 0 });
}

/** Avance le contrôleur de `n` images de `dt` secondes. */
function avancer(c: ControleurVol, n: number, dt: number, en: EntreesVol | ((k: number) => EntreesVol), m: Monde = vide): void {
  for (let k = 0; k < n; k++) c.maj(dt, typeof en === "function" ? en(k) : en, m);
}

describe("ControleurVol : l'avion", () => {
  const avion: AvionBr = { depart: [0, 0], arrivee: [600, 0], altitude: 350, vitesse: 30, debutT: 10_000, finT: 30_000 };

  it("entrerAvion : phase avion, position de l'avion à l'arrêt avant le départ, en route ensuite", () => {
    const c = new ControleurVol();
    expect(c.phase()).toBe("sol");
    expect(c.enVol()).toBe(false);
    c.entrerAvion(avion, 5000);
    expect(c.phase()).toBe("avion");
    expect(c.enVol()).toBe(false);
    expect(c.positionAvion(5000)).toEqual([0, 350, 0]);
    expect(c.positionAvion(20_000)).toEqual([300, 350, 0]);
    expect(c.positionAvion(99_000)).toEqual([600, 350, 0]);
    expect(c.etat().p).toEqual([600, 350, 0]);
    expect(c.etat().hauteur).toBe(350);
    expect(CAMERA_AVION_DY).toBe(2);
  });

  it("copie l'avion reçu (le message du serveur n'est pas gardé par référence)", () => {
    const c = new ControleurVol();
    const a: AvionBr = { ...avion, depart: [0, 0], arrivee: [600, 0] };
    c.entrerAvion(a, 0);
    a.arrivee[0] = 0;
    expect(c.positionAvion(30_000)[0]).toBe(600);
  });

  it("l'appui sur saut demande de sauter UNE fois (front montant), sans changer de phase avant le message du serveur", () => {
    const c = new ControleurVol();
    c.entrerAvion(avion, 0);
    expect(c.maj(DT, LIBRE, vide).sauter).toBe(false);
    expect(c.maj(DT, SAUT, vide).sauter).toBe(true);
    expect(c.maj(DT, SAUT, vide).sauter).toBe(false); // touche tenue
    expect(c.phase()).toBe("avion");
    expect(c.message(0, 0)).toBeNull();
    c.maj(DT, LIBRE, vide);
    expect(c.maj(DT, SAUT, vide).sauter).toBe(true); // nouvel appui (message perdu)
  });

  it("sans avion entré, maj ne fait rien et message est nul", () => {
    const c = new ControleurVol();
    expect(c.maj(0.1, SAUT, vide)).toEqual({ sauter: false, voile: false, atterri: false });
    expect(c.message(0, 0)).toBeNull();
  });
});

describe("ControleurVol : chute libre et parachute", () => {
  it("surSaut : chute libre à l'état initial du serveur (arrondi au centimètre), hors de l'avion", () => {
    const c = new ControleurVol();
    c.entrerAvion({ depart: [0, 0], arrivee: [600, 0], altitude: 350, vitesse: 30, debutT: 0, finT: 20_000 }, 0);
    c.surSaut({ t: "saut", p: [100.004, 350, -20.006], v: [30, 0, 0], lacet: 1 });
    expect(c.phase()).toBe("libre");
    expect(c.enVol()).toBe(true);
    expect(c.etat().p).toEqual([100, 350, -20.01]);
    expect(c.etat().v).toEqual([30, 0, 0]);
    expect(c.etat().voile).toBe(false);
    expect(c.etat().tLibre).toBe(0);
  });

  it("la prédiction rejoue pasChute à l'identique (images de 1/60 s) jusqu'à l'atterrissage", () => {
    const c = new ControleurVol();
    const en: EntreesVol = { lacet: 0.7, tangage: -0.8, avance: 1, lateral: 0.5, saut: false };
    saut(c, [0, 350, 0]);
    let ref = etatChuteInitial([0, 350, 0], [30, 0, 0]);
    const ev: boolean[] = [];
    let n = 0;
    while (c.phase() !== "attenteAtterri" && n++ < 5000) {
      ref = pasChute(ref, { lacet: 0.7, tangage: -0.8, avance: 1, lateral: 0.5, ouvrir: false }, vide);
      ev.push(c.maj(DT, en, vide).voile);
    }
    expect(c.phase()).toBe("attenteAtterri");
    expect(ref.atterri).toBe(true);
    expect(c.etat().p).toEqual(ref.p);
    expect(c.etat().hauteur).toBe(0);
    expect(c.etat().tLibre).toBeCloseTo(ref.tLibre, 9);
    // le parachute s'est ouvert tout seul (sous 90 m), une seule fois
    expect(ev.filter(Boolean)).toHaveLength(1);
    // une chute depuis 350 m dure bien plus de 15 s et moins de 40 s
    expect(n * DT).toBeGreaterThan(15);
    expect(n * DT).toBeLessThan(40);
  });

  it("découpage irrégulier des images : même état que pasChute au même nombre de pas, à 0,5 m près (ici exact)", () => {
    const alea = aleaGraine(42);
    const c = new ControleurVol();
    const en: EntreesVol = { lacet: -1.2, tangage: -0.3, avance: 1, lateral: 0, saut: false };
    saut(c, [10, 300, 10]);
    let ref = etatChuteInitial([10, 300, 10], [30, 0, 0]);
    let pas = 0, total = 0;
    while (c.phase() !== "attenteAtterri" && total < 6000) {
      const dt = 0.004 + alea() * 0.04; // 4 à 44 ms : de 250 à 22 images/s
      c.maj(dt, en, vide);
      total++;
      const n = Math.round(c.etat().tLibre / DT);
      while (pas < n) { ref = pasChute(ref, { lacet: -1.2, tangage: -0.3, avance: 1, lateral: 0, ouvrir: false }, vide); pas++; }
      if (c.phase() !== "attenteAtterri") {
        const e = c.etat();
        expect(Math.hypot(e.p[0] - ref.p[0], e.p[1] - ref.p[1], e.p[2] - ref.p[2])).toBeLessThan(ECART_ATTERRISSAGE_M);
      }
    }
    expect(c.phase()).toBe("attenteAtterri");
    expect(c.etat().p).toEqual(ref.p);
  });

  it("une image très longue (onglet ralenti) ne simule que 6 pas : le retard est perdu, pas rattrapé", () => {
    const c = new ControleurVol();
    saut(c, [0, 350, 0]);
    c.maj(5, LIBRE, vide);
    expect(c.etat().tLibre).toBeCloseTo(CHUTE_BR.pasMaxParAppel * DT, 9);
    expect(c.phase()).toBe("libre");
  });

  it("majReel : sous 10 images/s la chute suit le temps réel (maj seul, plafonné à 6 pas, prendrait du retard)", () => {
    // 5 images/s pendant 2 s de temps réel : 10 images de 0,2 s
    const reel = new ControleurVol(), plafonne = new ControleurVol();
    saut(reel, [0, 350, 0]);
    saut(plafonne, [0, 350, 0]);
    for (let k = 0; k < 10; k++) { reel.majReel(0.2, LIBRE, vide); plafonne.maj(0.2, LIBRE, vide); }
    expect(reel.etat().tLibre).toBeCloseTo(2, 1);
    expect(plafonne.etat().tLibre).toBeCloseTo(1, 1);
    // la même chute à 60 images/s donne la même position (le découpage ne change pas la simulation)
    const fin = new ControleurVol();
    saut(fin, [0, 350, 0]);
    for (let k = 0; k < 120; k++) fin.maj(DT, LIBRE, vide);
    expect(reel.etat().p[1]).toBeCloseTo(fin.etat().p[1], 0);
    expect(Math.abs(reel.etat().p[1] - fin.etat().p[1])).toBeLessThan(2);
  });

  it("majReel : un retard énorme (onglet en veille) est perdu au-delà de la limite, les événements des parts sont fusionnés", () => {
    const c = new ControleurVol();
    saut(c, [0, 350, 0]);
    c.majReel(30, LIBRE, vide);
    expect(c.etat().tLibre).toBeCloseTo(DT_RATTRAPAGE_MAX_S, 1);
    // atterrissage en plein milieu d'un grand pas : un seul événement, la boucle s'arrête
    const bas = new ControleurVol();
    saut(bas, [0, 3, 0], [0, 0, 0]);
    expect(bas.majReel(1, LIBRE, vide).atterri).toBe(true);
    expect(bas.phase()).toBe("attenteAtterri");
    // dans l'avion : l'appui sur saut est vu une seule fois
    const avion = new ControleurVol();
    avion.entrerAvion({ depart: [0, 0], arrivee: [600, 0], altitude: 350, vitesse: 30, debutT: 0, finT: 20_000 }, 0);
    expect(avion.majReel(0.5, SAUT, vide).sauter).toBe(true);
    // temps nul ou invalide : une seule mise à jour des entrées, rien ne bouge
    const n = new ControleurVol();
    saut(n, [0, 350, 0]);
    n.majReel(Number.NaN, LIBRE, vide);
    n.majReel(-3, LIBRE, vide);
    expect(n.etat().tLibre).toBe(0);
  });

  it("entrées quantifiées : lacet et tangage au millième, avance et latéral au centième, valeurs aberrantes neutralisées", () => {
    const c = new ControleurVol();
    saut(c, [0, 350, 0]);
    c.maj(DT, { lacet: 0.123456, tangage: -0.987654, avance: 0.333, lateral: 7, saut: false }, vide);
    expect(c.message(0.123456, -0.987654)).toEqual({ t: "chute", lacet: 0.123, tangage: -0.988, avance: 0.33, lateral: 1, ouvrir: false });
    const d = new ControleurVol();
    saut(d, [0, 350, 0]);
    d.maj(DT, { lacet: NaN, tangage: Infinity, avance: NaN, lateral: -9, saut: false }, vide);
    expect(d.message(NaN, NaN)).toEqual({ t: "chute", lacet: 0, tangage: 0, avance: 0, lateral: -1, ouvrir: false });
    expect(Object.is(d.message(0, 0)?.lacet, -0)).toBe(false);
  });
});

describe("ControleurVol : ouverture du parachute", () => {
  it("le même appui qui quitte l'avion n'ouvre rien, même tenu : il faut relâcher puis réappuyer après 1 s", () => {
    const c = new ControleurVol();
    saut(c, [0, 350, 0]);
    avancer(c, 90, DT, SAUT); // 1,5 s à tenir la touche
    expect(c.etat().voile).toBe(false);
    expect(c.message(0, 0)?.ouvrir).toBe(false);
    c.maj(DT, LIBRE, vide);
    const ev = c.maj(DT, SAUT, vide);
    expect(ev.voile).toBe(true);
    expect(c.phase()).toBe("voile");
    expect(c.etat().voile).toBe(true);
  });

  it("un appui avant le délai minimal (1 s) est ignoré, et n'est pas retenu pour plus tard", () => {
    const c = new ControleurVol();
    saut(c, [0, 350, 0]);
    c.maj(DT, LIBRE, vide);
    avancer(c, 30, DT, (k) => (k === 10 ? SAUT : LIBRE)); // appui à ~0,2 s
    expect(c.etat().voile).toBe(false);
    avancer(c, 60, DT, LIBRE); // bien après 1 s, aucun appui
    expect(c.etat().tLibre).toBeGreaterThan(CHUTE_BR.delaiOuvertureMinMs / 1000);
    expect(c.etat().voile).toBe(false);
    expect(c.message(0, 0)?.ouvrir).toBe(false);
  });

  it("ouvrir reste vrai dans le message tant que le snap n'a pas montré la voile, puis s'arrête", () => {
    const c = new ControleurVol();
    saut(c, [0, 350, 0]);
    avancer(c, 80, DT, LIBRE);
    c.maj(DT, SAUT, vide);
    expect(c.etat().voile).toBe(true);
    let m = c.message(0, 0);
    expect(m?.ouvrir).toBe(true);
    avancer(c, 6, DT, LIBRE);
    m = c.message(0, 0);
    expect(m?.ouvrir).toBe(true);
    c.recaler(c.etat().p, "libre"); // le snap n'a pas encore la voile
    avancer(c, 3, DT, LIBRE);
    expect(c.message(0, 0)?.ouvrir).toBe(true);
    c.recaler(c.etat().p, "voile");
    avancer(c, 3, DT, LIBRE);
    expect(c.message(0, 0)?.ouvrir).toBe(false);
  });

  it("sous voile : vitesse de descente de 6,5 m/s une fois l'ouverture terminée, hauteur et vitesse lisibles pour le HUD", () => {
    const c = new ControleurVol();
    saut(c, [0, 350, 0]);
    avancer(c, 80, DT, LIBRE);
    c.maj(DT, SAUT, vide);
    avancer(c, Math.round((CHUTE_BR.voile.ouvertureMs / 1000) / DT) + 30, DT, LIBRE);
    const e = c.etat();
    expect(e.phase).toBe("voile");
    expect(e.vitesseDescente).toBeCloseTo(6.5, 1);
    expect(e.hauteur).toBeCloseTo(e.p[1], 5);
    expect(e.tVoile).toBeGreaterThan(1);
  });

  it("ouverture automatique sous 90 m de hauteur et atterrissage sur un toit", () => {
    const toit = rect(-10, -10, 10, 10, 12);
    const m = mondeDe(toit);
    const c = new ControleurVol();
    saut(c, [0, 200, 0], [0, 0, 0]);
    let voileA = Infinity;
    for (let k = 0; k < 4000 && c.phase() !== "attenteAtterri"; k++) {
      const ev = c.maj(DT, LIBRE, m);
      if (ev.voile) voileA = c.etat().hauteur;
    }
    expect(voileA).toBeLessThan(CHUTE_BR.hauteurOuvertureAutoM);
    expect(voileA).toBeGreaterThan(CHUTE_BR.hauteurOuvertureAutoM - 3);
    expect(c.phase()).toBe("attenteAtterri");
    expect(c.etat().p[1]).toBeCloseTo(12, 1); // le toit compte comme sol
  });
});

describe("ControleurVol : message chute à 30 Hz", () => {
  it("un message toutes les ~33 ms de temps de jeu, jamais deux à la même image, un dès le saut", () => {
    const c = new ControleurVol();
    saut(c, [0, 350, 0]);
    let envoyes = 0;
    for (let k = 0; k < 60; k++) { // 1 s à 60 images/s
      c.maj(DT, LIBRE, vide);
      if (c.message(0, 0)) envoyes++;
    }
    expect(envoyes).toBe(30);
    expect(PERIODE_CHUTE_MS).toBeCloseTo(33.33, 1);
    // à 144 images/s : toujours ≈ 30 par seconde
    const d = new ControleurVol();
    saut(d, [0, 350, 0]);
    let n = 0;
    for (let k = 0; k < 144; k++) { d.maj(1 / 144, LIBRE, vide); if (d.message(0, 0)) n++; }
    expect(n).toBeGreaterThanOrEqual(29);
    expect(n).toBeLessThanOrEqual(31);
  });

  it("nul en dehors du vol (avion, sol) et encore envoyé pendant l'attente du message atterri", () => {
    const c = new ControleurVol();
    expect(c.message(0, 0)).toBeNull();
    c.entrerAvion({ depart: [0, 0], arrivee: [600, 0], altitude: 350, vitesse: 30, debutT: 0, finT: 20_000 }, 0);
    c.maj(0.1, LIBRE, vide);
    expect(c.message(0, 0)).toBeNull();
    const m = mondeDe();
    saut(c, [0, 6, 0], [0, 0, 0]);
    avancer(c, 200, DT, LIBRE, m);
    expect(c.phase()).toBe("attenteAtterri");
    expect(c.message(0, 0)?.t).toBe("chute");
    c.surAtterri(c.etat().p);
    expect(c.message(0, 0)).toBeNull();
  });
});

describe("ControleurVol : atterrissage et recalage", () => {
  function auSol(): ControleurVol {
    const c = new ControleurVol();
    saut(c, [0, 20, 0], [0, 0, 0]);
    avancer(c, 600, DT, LIBRE);
    expect(c.phase()).toBe("attenteAtterri");
    return c;
  }

  it("la prédiction s'arrête au sol : figée jusqu'à atterri, vitesse nulle", () => {
    const c = auSol();
    const avant = c.etat();
    expect(avant.v).toEqual([0, 0, 0]);
    avancer(c, 30, DT, { ...LIBRE, avance: 1 });
    expect(c.etat().p).toEqual(avant.p);
    expect(c.etat().phase).toBe("attenteAtterri");
  });

  it("atterri à moins de 0,5 m de la prédiction : le client garde sa position, phase sol", () => {
    const c = auSol();
    const prevu = c.etat().p;
    const r = c.surAtterri([prevu[0] + 0.3, prevu[1], prevu[2] - 0.2]);
    expect(r.teleporte).toBe(false);
    expect(r.p).toEqual(prevu);
    expect(c.phase()).toBe("sol");
    expect(c.enVol()).toBe(false);
    expect(c.etat().p).toEqual(prevu);
    expect(c.etat().hauteur).toBe(0);
  });

  it("atterri à plus de 0,5 m : téléportation à la position du serveur", () => {
    const c = auSol();
    const prevu = c.etat().p;
    const serveur: Vec3 = [prevu[0] + ECART_ATTERRISSAGE_M + 0.5, prevu[1], prevu[2]];
    const r = c.surAtterri(serveur);
    expect(r.teleporte).toBe(true);
    expect(r.p).toEqual(serveur);
    expect(c.etat().p).toEqual(serveur);
    expect(c.phase()).toBe("sol");
  });

  it("le serveur atterrit avant la prédiction (client en retard) : téléportation aussi, en pleine chute", () => {
    const c = new ControleurVol();
    saut(c, [0, 100, 0]);
    avancer(c, 30, DT, LIBRE);
    expect(c.phase()).toBe("libre");
    const r = c.surAtterri([300, 0, 0]);
    expect(r.teleporte).toBe(true);
    expect(c.phase()).toBe("sol");
    expect(c.etat().p).toEqual([300, 0, 0]);
  });

  it("atterri sans saut préalable (message de saut perdu) : le joueur est posé au point du serveur ; atterri répété sans effet", () => {
    const c = new ControleurVol();
    c.entrerAvion({ depart: [0, 0], arrivee: [600, 0], altitude: 350, vitesse: 30, debutT: 0, finT: 20_000 }, 0);
    const r = c.surAtterri([12, 3, -4]);
    expect(r).toEqual({ p: [12, 3, -4], teleporte: true });
    expect(c.phase()).toBe("sol");
    expect(c.surAtterri([500, 0, 500])).toEqual({ p: [12, 3, -4], teleporte: false });
    expect(c.etat().p).toEqual([12, 3, -4]);
  });

  it("recalage en vol : seulement au-delà de 25 m d'écart avec le snap retardé", () => {
    const c = new ControleurVol();
    saut(c, [0, 300, 0]);
    avancer(c, 60, DT, LIBRE);
    const p = c.etat().p;
    expect(c.recaler([p[0] + ECART_RECALAGE_M - 1, p[1], p[2]])).toBe(false);
    expect(c.etat().p).toEqual(p);
    const v = c.etat().v;
    expect(c.recaler([p[0] + ECART_RECALAGE_M + 1, p[1], p[2]])).toBe(true);
    expect(c.etat().p).toEqual([p[0] + ECART_RECALAGE_M + 1, p[1], p[2]]);
    expect(c.etat().v).toEqual(v);
    expect(c.phase()).toBe("libre");
  });

  it("pas de recalage dans l'avion, au sol ni pendant l'attente de atterri", () => {
    const c = new ControleurVol();
    expect(c.recaler([1000, 0, 0])).toBe(false);
    c.entrerAvion({ depart: [0, 0], arrivee: [600, 0], altitude: 350, vitesse: 30, debutT: 0, finT: 20_000 }, 0);
    expect(c.recaler([1000, 0, 0])).toBe(false);
    saut(c, [0, 5, 0], [0, 0, 0]);
    avancer(c, 200, DT, LIBRE);
    expect(c.phase()).toBe("attenteAtterri");
    expect(c.recaler([1000, 0, 0])).toBe(false);
  });

  it("reinitialiser : retour à blanc (phase sol, plus d'avion)", () => {
    const c = new ControleurVol();
    c.entrerAvion({ depart: [0, 0], arrivee: [600, 0], altitude: 350, vitesse: 30, debutT: 0, finT: 20_000 }, 0);
    saut(c, [0, 300, 0]);
    c.reinitialiser();
    expect(c.phase()).toBe("sol");
    expect(c.positionAvion(1000)).toEqual([0, 0, 0]);
    expect(c.message(0, 0)).toBeNull();
  });

  it("un vol complet depuis un trajet d'avion réel atterrit dans les bornes élargies de la portée de la chute", () => {
    const avion = tracerVolBr(BORNES, aleaGraine(7), 0);
    const c = new ControleurVol();
    c.entrerAvion(avion, 0);
    const p0 = c.positionAvion((avion.debutT + avion.finT) / 2);
    const v = [(avion.arrivee[0] - avion.depart[0]) / ((avion.finT - avion.debutT) / 1000), 0, (avion.arrivee[1] - avion.depart[1]) / ((avion.finT - avion.debutT) / 1000)] as Vec3;
    saut(c, p0, v);
    expect(Math.hypot(v[0], v[2])).toBeCloseTo(AVION_BR.vitesse, 5);
    expect(positionAvionBr(avion, avion.debutT)[1]).toBe(AVION_BR.altitude);
    avancer(c, 5000, DT, { ...LIBRE, avance: 1 });
    expect(c.phase()).toBe("attenteAtterri");
  });
});

// ---------- butin ----------

const obj = (id: number, genre: ObjetBr["genre"], ref: ObjetBr["ref"], p: Vec3, qte?: number): ObjetBr => (qte === undefined ? { id, genre, ref, p } : { id, genre, ref, p, qte });

describe("ButinClient", () => {
  it("la liste initiale complète arrive en un message, les écarts ensuite", () => {
    const b = new ButinClient();
    const initiaux = [obj(1, "arme", "pompe", [0, 0, 0]), obj(2, "munitions", "legeres", [5, 0, 0]), obj(3, "bandage", null, [0, 0, 5])];
    b.appliquer({ t: "butin", ajoutes: initiaux });
    expect(b.taille()).toBe(3);
    expect(b.pourDessin().map((o) => o.id)).toEqual([1, 2, 3]);
    b.appliquer({ t: "butin", retires: [2], ajoutes: [obj(10, "arme", "pistolet", [1, 0, 1])] });
    expect(b.pourDessin().map((o) => o.id)).toEqual([1, 3, 10]);
    expect(b.objet(2)).toBeUndefined();
    expect(b.objet(10)?.ref).toBe("pistolet");
    b.appliquer({ t: "butin" });
    expect(b.taille()).toBe(3);
  });

  it("retirer un id inconnu ou rajouter un id existant (le serveur renvoie la liste complète) ne casse rien : remplacé, pas dupliqué", () => {
    const b = new ButinClient();
    b.appliquer({ t: "butin", ajoutes: [obj(1, "bandage", null, [0, 0, 0], 2)] });
    b.appliquer({ t: "butin", retires: [99] });
    b.appliquer({ t: "butin", ajoutes: [obj(1, "bandage", null, [0, 0, 0], 3)] });
    expect(b.taille()).toBe(1);
    expect(b.objet(1)?.qte).toBe(3);
  });

  it("copie les objets reçus : les modifier après coup ne change pas l'état du client", () => {
    const b = new ButinClient();
    const o = obj(1, "arme", "sniper", [1, 2, 3]);
    b.appliquer({ t: "butin", ajoutes: [o] });
    o.p[0] = 999;
    expect(b.objet(1)?.p).toEqual([1, 2, 3]);
  });

  it("pourDessin : même tableau tant que rien ne change, révision incrémentée seulement sur modification", () => {
    const b = new ButinClient();
    b.appliquer({ t: "butin", ajoutes: [obj(1, "arme", "pompe", [0, 0, 0])] });
    const r = b.revision(), t = b.pourDessin();
    expect(b.pourDessin()).toBe(t);
    b.appliquer({ t: "butin" });
    b.appliquer({ t: "butin", retires: [42] });
    expect(b.revision()).toBe(r);
    expect(b.pourDessin()).toBe(t);
    b.appliquer({ t: "butin", ajoutes: [obj(2, "arme", "pompe", [3, 0, 0])] });
    expect(b.revision()).toBe(r + 1);
    expect(b.pourDessin()).not.toBe(t);
    b.vider();
    expect(b.taille()).toBe(0);
    expect(b.revision()).toBe(r + 2);
    b.vider();
    expect(b.revision()).toBe(r + 2);
  });

  it("proches : distance 3D, du plus proche au plus lointain, à égalité par id", () => {
    const b = new ButinClient();
    b.appliquer({ t: "butin", ajoutes: [
      obj(5, "arme", "pompe", [10, 0, 0]), obj(2, "arme", "pompe", [0, 0, 3]), obj(7, "arme", "pompe", [0, 0, -3]),
      obj(9, "arme", "pompe", [0, 80, 0]), obj(1, "arme", "pompe", [100, 0, 0]),
    ] });
    expect(b.proches([0, 0, 0], 60).map((o) => o.id)).toEqual([2, 7, 5]);
    expect(b.proches([0, 0, 0], 2)).toEqual([]);
    expect(b.proches([0, 0, 0], 1000).map((o) => o.id)).toEqual([2, 7, 5, 9, 1]);
  });
});

// ---------- invite de ramassage ----------

describe("inviteRamassage", () => {
  const depart = (): Equipement => copierEquipement(EQUIPEMENT_DEPART_BR);
  const SOINS = { bandage: 0, potion: 0 };
  const avec = (...o: ObjetBr[]): ButinClient => { const b = new ButinClient(); b.appliquer({ t: "butin", ajoutes: o }); return b; };

  it("rien à portée : null (2,5 m en horizontal et en hauteur)", () => {
    expect(inviteRamassage(avec(), [0, 0, 0], depart(), SOINS)).toBeNull();
    expect(inviteRamassage(avec(obj(1, "arme", "pompe", [BR.rayonRamassageM + 0.1, 0, 0])), [0, 0, 0], depart(), SOINS)).toBeNull();
    expect(inviteRamassage(avec(obj(1, "arme", "pompe", [0, BR.rayonRamassageM + 0.1, 0])), [0, 0, 0], depart(), SOINS)).toBeNull();
    expect(inviteRamassage(avec(obj(1, "arme", "pompe", [BR.rayonRamassageM - 0.01, 0, 0])), [0, 0, 0], depart(), SOINS)?.id).toBe(1);
    // un objet sur un toit, juste au-dessus de la tête, mais à 2,4 m : à portée
    expect(inviteRamassage(avec(obj(1, "arme", "pompe", [0, 2.4, 0])), [0, 0, 0], depart(), SOINS)?.id).toBe(1);
  });

  it("avec le monde, un objet derrière un mur n'est pas proposé même à portée ; un autre du même côté l'est", () => {
    const m = mondeDe({ h: 10, r: [[1, -5], [1.4, -5], [1.4, 5], [1, 5]], c: [1.2, 0] });
    const b = avec(obj(1, "arme", "pompe", [2, 0, 0]), obj(2, "arme", "pistolet", [-2, 0, 0]));
    expect(inviteRamassage(b, [0, 0, 0], depart(), SOINS)?.id).toBe(1);
    expect(inviteRamassage(b, [0, 0, 0], depart(), SOINS, m)?.id).toBe(2);
    expect(inviteRamassage(avec(obj(1, "arme", "pompe", [2, 0, 0])), [0, 0, 0], depart(), SOINS, m)).toBeNull();
  });

  it("une arme : « Ramasser Fusil d'assaut (rare) », l'objet le plus proche gagne, à égalité le plus petit id", () => {
    const b = avec(obj(4, "arme", "pistolet", [2, 0, 0]), obj(3, "arme", "fusil_assaut", [1, 0, 0]));
    const inv = inviteRamassage(b, [0, 0, 0], depart(), SOINS)!;
    expect(inv.id).toBe(3);
    expect(inv.libelle).toBe("Fusil d'assaut (rare)");
    expect(inv.detail).toBe("Ramasser Fusil d'assaut (rare)");
    expect(inv.refuse).toBeUndefined();
    expect(inv.objet.ref).toBe("fusil_assaut");
    const egal = avec(obj(8, "arme", "pistolet", [1, 0, 0]), obj(6, "arme", "mini_uzi", [-1, 0, 0]), obj(7, "arme", "pistolet", [0, 0, 1]));
    expect(inviteRamassage(egal, [0, 0, 0], depart(), SOINS)?.id).toBe(6);
  });

  it("une arme qui remplace celle du slot le dit ; la même arme donne +1 chargeur", () => {
    const eq: Equipement = { principale: "pompe", secondaire: "pistolet", speciale: null, sansSecondaire: true };
    const rempl = inviteRamassage(avec(obj(1, "arme", "fusil_assaut", [0, 0, 0])), [0, 0, 0], eq, SOINS)!;
    expect(rempl.detail).toBe("Ramasser Fusil d'assaut (rare), remplace Fusil à pompe");
    const meme = inviteRamassage(avec(obj(1, "arme", "pompe", [0, 0, 0])), [0, 0, 0], eq, SOINS)!;
    expect(meme.detail).toBe("Ramasser Fusil à pompe (peu commun), +1 chargeur");
    // une spéciale légendaire
    const leg = inviteRamassage(avec(obj(1, "arme", "railgun", [0, 0, 0])), [0, 0, 0], depart(), SOINS)!;
    expect(leg.detail).toBe("Ramasser Railgun (légendaire)");
  });

  it("l'épée remplace le couteau ; déjà portée, elle est refusée", () => {
    const b = avec(obj(1, "arme", "epee", [0, 0, 0]));
    expect(inviteRamassage(b, [0, 0, 0], depart(), SOINS)?.detail).toBe("Ramasser Épée (rare)");
    const eq = { ...depart(), melee: "epee" as const };
    const r = inviteRamassage(b, [0, 0, 0], eq, SOINS)!;
    expect(r.refuse).toBe(true);
    expect(r.detail).toBe("Épée (rare) (déjà portée)");
  });

  it("une boîte de munitions sans arme compatible est refusée, avec l'arme elle donne 2 chargeurs", () => {
    const b = avec(obj(1, "munitions", "cartouches", [0, 0, 0]));
    const refus = inviteRamassage(b, [0, 0, 0], depart(), SOINS)!;
    expect(refus.refuse).toBe(true);
    expect(refus.detail).toBe("Boîte de cartouches (aucune arme compatible)");
    expect(refus.libelle).toBe("Boîte de cartouches");
    const eq: Equipement = { principale: "mitraillette", secondaire: "revolver", speciale: null, sansPrincipale: true };
    const ok = inviteRamassage(b, [0, 0, 0], eq, SOINS)!;
    expect(ok.refuse).toBeUndefined();
    expect(ok.detail).toBe("Ramasser Boîte de cartouches, +2 chargeurs");
    expect(libelleObjetBr(obj(2, "munitions", "legeres", [0, 0, 0]))).toBe("Boîte de munitions légères");
    expect(libelleObjetBr(obj(3, "munitions", "moyennes", [0, 0, 0]))).toBe("Boîte de munitions moyennes");
  });

  it("soins : libellés, quantité lâchée à la mort, pile pleine refusée", () => {
    const b = avec(obj(1, "bandage", null, [0, 0, 0], 3));
    expect(inviteRamassage(b, [0, 0, 0], depart(), SOINS)?.detail).toBe("Ramasser Bandage ×3");
    const plein = inviteRamassage(b, [0, 0, 0], depart(), { bandage: BR.usage.bandage.pile, potion: 0 })!;
    expect(plein.refuse).toBe(true);
    expect(plein.detail).toBe("Bandage ×3 (pile pleine)");
    const p = avec(obj(2, "potion", null, [0, 0, 0]));
    expect(inviteRamassage(p, [0, 0, 0], depart(), SOINS)?.detail).toBe("Ramasser Potion de bouclier");
    expect(inviteRamassage(p, [0, 0, 0], depart(), { bandage: 0, potion: BR.usage.potion.pile })?.refuse).toBe(true);
  });
});

// ---------- spectateur ----------

describe("SuiviSpectateur", () => {
  const c = (id: string, x: number, vivant = true): CandidatSuivi => ({ id, p: [x, 0, 0], vivant });

  it("suit le tueur s'il vit, sinon le vivant le plus proche du lieu de la mort", () => {
    const vivants = [c("j2", 10), c("j3", 50), c("j4", 200)];
    const s = new SuiviSpectateur("j1");
    expect(s.commencer("j4", [0, 0, 0], vivants)).toBe("j4");
    const t = new SuiviSpectateur("j1");
    expect(t.commencer("j9", [0, 0, 0], vivants)).toBe("j2"); // tueur mort ou parti
    const u = new SuiviSpectateur("j1");
    expect(u.commencer(null, [190, 0, 0], vivants)).toBe("j4");
    expect(u.cible()).toBe("j4");
    const v = new SuiviSpectateur("j1");
    expect(v.commencer("j2", [0, 0, 0], [c("j2", 10, false), c("j3", 50)])).toBe("j3"); // tueur marqué mort
  });

  it("jamais soi-même, même si le snap garde l'entrée du joueur mort ; personne : null", () => {
    const s = new SuiviSpectateur("j1");
    expect(s.commencer("j1", [0, 0, 0], [c("j1", 0), c("j2", 30)])).toBe("j2");
    const seul = new SuiviSpectateur("j1");
    expect(seul.commencer(null, [0, 0, 0], [c("j1", 0, false)])).toBeNull();
    expect(seul.suivant([])).toBeNull();
    expect(seul.precedent([])).toBeNull();
    expect(seul.maj([])).toBeNull();
  });

  it("bascule quand la cible meurt ou part : sur le plus proche de sa dernière position", () => {
    const s = new SuiviSpectateur("j1");
    s.commencer("j2", [0, 0, 0], [c("j2", 10), c("j3", 300), c("j4", 120)]);
    s.maj([c("j2", 100), c("j3", 300), c("j4", 120)]); // la cible a couru jusqu'à x = 100
    expect(s.cible()).toBe("j2");
    expect(s.maj([c("j2", 100, false), c("j3", 300), c("j4", 120)])).toBe("j4"); // morte à x = 100 : j4 est à 20 m, j3 à 200 m
    expect(s.maj([c("j3", 300)])).toBe("j3"); // j4 a quitté
    expect(s.maj([c("j3", 300)])).toBe("j3"); // stable
    expect(s.maj([])).toBeNull();
    expect(s.maj([c("j5", 10)])).toBe("j5"); // un vivant réapparaît dans la liste : on le reprend
  });

  it("suivant et precedent parcourent les vivants par numéro d'id, en boucle (j10 après j9)", () => {
    const vivants = [c("j10", 0), c("j2", 0), c("j9", 0), c("j3", 0), c("j1", 0)];
    const s = new SuiviSpectateur("j1");
    s.commencer("j2", [0, 0, 0], vivants);
    expect(s.cible()).toBe("j2");
    const suivants = [s.suivant(vivants), s.suivant(vivants), s.suivant(vivants), s.suivant(vivants)];
    expect(suivants).toEqual(["j3", "j9", "j10", "j2"]);
    expect(s.precedent(vivants)).toBe("j10");
    expect(s.precedent(vivants)).toBe("j9");
    expect(s.precedent(vivants)).toBe("j3");
    expect(s.precedent(vivants)).toBe("j2");
    expect(s.precedent(vivants)).toBe("j10"); // boucle
  });

  it("sans cible, suivant prend le premier et precedent le dernier ; une cible disparue y ramène", () => {
    const vivants = [c("j3", 0), c("j5", 0), c("j8", 0)];
    const a = new SuiviSpectateur("j1");
    expect(a.suivant(vivants)).toBe("j3");
    const b = new SuiviSpectateur("j1");
    expect(b.precedent(vivants)).toBe("j8");
    // un seul vivant : suivant et precedent restent dessus
    const un = [c("j5", 0)];
    expect(b.suivant(un)).toBe("j5");
    expect(b.suivant(un)).toBe("j5");
    expect(b.precedent(un)).toBe("j5");
  });
});

// ---------- HUD ----------

describe("etatHudBr et etatBrHud", () => {
  const bornes = BORNES;
  const plan = genererPlanZone({ bornes, debutT: 1000, alea: aleaGraine(3), echelle: 1 });
  const zone = zoneBrPublique(plan, 1000);
  const partie = (phase: EtatPartieBr["phase"], z: EtatPartieBr["zone"] = zone): EtatPartieBr => ({
    phase, hote: "j1", capacite: 50, minJoueurs: 2, debutT: 1000, finT: 0, avion: null, zone: z, vivants: 10, total: 12,
  });
  const volSol = (phase: EtatVol["phase"], p: Vec3 = [0, 0, 0], extra: Partial<EtatVol> = {}): EtatVol => ({
    phase, p, v: [0, 0, 0], hauteur: 0, vitesseDescente: 0, voile: false, tVoile: 0, tLibre: 0, ...extra,
  });
  const base = (o: Partial<EntreeHudBr> = {}): EntreeHudBr => ({
    partie: partie("jeu"), vol: volSol("sol"), serveurT: 1000, p: [zone.c0[0], 0, zone.c0[1]], lacet: 0, vivant: true,
    bandage: 0, potion: 0, usage: null, spectateur: false, suivi: null, ...o,
  });

  it("au sol dans la zone : phase sol, pas hors zone, soins recopiés", () => {
    const h = etatHudBr(base({ bandage: 3, potion: 1 }));
    expect(h).toEqual({ phaseVol: "sol", altitude: 0, vitesseChute: 0, bandages: 3, potions: 1, usageSoin: "", horsZone: false, spectateur: false, spectateurCible: "" });
  });

  it("hors zone : seulement vivant, en jeu, et pas dans l'avion ; en vol compris", () => {
    const dehors: Vec3 = [zone.c0[0] + zone.r0 + 5, 0, zone.c0[1]];
    expect(etatHudBr(base({ p: dehors })).horsZone).toBe(true);
    expect(etatHudBr(base({ p: dehors, vol: volSol("libre", dehors, { hauteur: 200, vitesseDescente: 40 }) })).horsZone).toBe(true);
    expect(etatHudBr(base({ p: dehors, vol: volSol("avion", dehors, { hauteur: 350 }) })).horsZone).toBe(false);
    expect(etatHudBr(base({ p: dehors, vivant: false })).horsZone).toBe(false);
    expect(etatHudBr(base({ p: dehors, partie: partie("lobby") })).horsZone).toBe(false);
    expect(etatHudBr(base({ p: dehors, partie: partie("jeu", null) })).horsZone).toBe(false);
  });

  it("en chute : altitude et vitesse entières ; sous voile aussi ; dans l'avion l'altitude seule", () => {
    const libre = etatHudBr(base({ vol: volSol("libre", [0, 0, 0], { hauteur: 183.6, vitesseDescente: 44.4 }) }));
    expect(libre.phaseVol).toBe("libre");
    expect(libre.altitude).toBe(184);
    expect(libre.vitesseChute).toBe(44);
    const voile = etatHudBr(base({ vol: volSol("voile", [0, 0, 0], { hauteur: 60, vitesseDescente: 6.5 }) }));
    expect(voile.vitesseChute).toBe(7);
    const avion = etatHudBr(base({ vol: volSol("avion", [0, 0, 0], { hauteur: 350 }), partie: partie("vol") }));
    expect(avion.phaseVol).toBe("avion");
    expect(avion.altitude).toBe(350);
    expect(avion.vitesseChute).toBe(0);
    // attente de atterri : ni altitude ni vitesse (le sol est atteint)
    expect(etatHudBr(base({ vol: volSol("attenteAtterri") })).altitude).toBe(0);
  });

  it("hors partie (lobby, décompte, fin) ou spectateur : phase vide ; le suivi n'est donné qu'au spectateur", () => {
    expect(etatHudBr(base({ partie: partie("lobby") })).phaseVol).toBe("");
    expect(etatHudBr(base({ partie: null })).phaseVol).toBe("");
    const s = etatHudBr(base({ vivant: false, spectateur: true, suivi: "j7" }));
    expect(s.phaseVol).toBe("");
    expect(s.spectateur).toBe(true);
    expect(s.spectateurCible).toBe("j7");
    expect(etatHudBr(base({ vivant: false, spectateur: true, suivi: null })).spectateurCible).toBe("");
    expect(etatHudBr(base({ suivi: "j7" })).spectateurCible).toBe("");
  });

  it("usage d'un soin : nom et progression 0..1", () => {
    const u = { objet: "bandage" as const, finT: 5000 };
    expect(etatHudBr(base({ usage: u })).usageSoin).toBe("bandage");
    expect(etatHudBr(base({ usage: { objet: "potion", finT: 9000 } })).usageSoin).toBe("potion");
    expect(progressionUsage(null, 4000)).toBe(0);
    expect(progressionUsage(u, 5000 - BR.usage.bandage.ms)).toBe(0);
    expect(progressionUsage(u, 5000 - BR.usage.bandage.ms / 2)).toBeCloseTo(0.5, 6);
    expect(progressionUsage(u, 5000)).toBe(1);
    expect(progressionUsage(u, 99_999)).toBe(1);
    expect(progressionUsage(u, 0)).toBe(0);
    expect(progressionUsage({ objet: "potion", finT: 8000 }, 6000)).toBeCloseTo(0.5, 6);
  });

  it("reperesZone : distance signée au bord et cap relatif du centre (+ à droite, 0 devant)", () => {
    const z = zoneBrPublique(plan, 1000);
    const [cx, cz] = z.c0;
    // le centre est au nord (−z) : je le regarde en face avec lacet 0
    const sud: Vec3 = [cx, 0, cz + 100];
    const r = reperesZone(z, 1000, sud, 0);
    expect(r.distanceBord).toBeCloseTo(100 - z.r0, 6);
    expect(r.capCentre).toBeCloseTo(0, 6);
    // je tourne la tête vers la gauche (lacet > 0) : le centre passe à ma droite
    expect(reperesZone(z, 1000, sud, 0.5).capCentre).toBeCloseTo(0.5, 6);
    expect(reperesZone(z, 1000, sud, -0.5).capCentre).toBeCloseTo(-0.5, 6);
    // le centre à l'est, regard au nord : à 90° à droite ; à l'ouest, à gauche
    expect(reperesZone(z, 1000, [cx - 50, 0, cz], 0).capCentre).toBeCloseTo(Math.PI / 2, 6);
    expect(reperesZone(z, 1000, [cx + 50, 0, cz], 0).capCentre).toBeCloseTo(-Math.PI / 2, 6);
    // enroulement : toujours dans ]−π, π]
    expect(Math.abs(reperesZone(z, 1000, sud, 3 * Math.PI).capCentre)).toBeCloseTo(Math.PI, 6);
    expect(reperesZone(null, 1000, sud, 0)).toEqual({ distanceBord: 0, capCentre: 0 });
  });

  it("etatBrHud : objet neuf à chaque appel, place seulement une fois mort, valeurs neutres hors partie", () => {
    const proches = [obj(1, "arme", "pompe", [1, 0, 0])];
    const vivant = etatBrHud(base({ usage: { objet: "potion", finT: 4000 } }), proches, 7);
    expect(vivant.place).toBeNull();
    expect(vivant.suivi).toBeNull();
    expect(vivant.zone).toBe(zone);
    expect(vivant.avion).toBeNull();
    expect(vivant.proches).toEqual(proches);
    expect(vivant.proches).not.toBe(proches);
    expect(vivant.usage).toEqual({ objet: "potion", finT: 4000 });
    expect(vivant.phaseVol).toBe("sol");
    expect(vivant.serveurT).toBe(1000);
    const mort = etatBrHud(base({ vivant: false, spectateur: true, suivi: "j4" }), [], 7);
    expect(mort.place).toBe(7);
    expect(mort.suivi).toBe("j4");
    expect(mort.phaseVol).toBe("");
    const lobby = etatBrHud(base({ partie: partie("lobby") }), [], null);
    expect(lobby.distanceBord).toBe(0);
    expect(lobby.capCentre).toBe(0);
    const rien = etatBrHud(base({ partie: null }), [], null);
    expect(rien.partie).toBeNull();
    expect(rien.zone).toBeNull();
  });
});

// ---------- cohérence avec le serveur ----------

describe("parité avec br-chute", () => {
  it("le contrôleur utilise les entrées envoyées : rejouer le flux des messages `chute` donne l'état du client à 0,5 m près", () => {
    const c = new ControleurVol();
    saut(c, [0, 350, 0]);
    const envoyes: Extract<ReturnType<ControleurVol["message"]>, object>[] = [];
    const alea = aleaGraine(11);
    let lacet = 0, tangage = -0.2;
    for (let k = 0; k < 400; k++) {
      lacet += (alea() - 0.5) * 0.1;
      tangage = Math.max(-1.4, Math.min(0.5, tangage + (alea() - 0.5) * 0.1));
      c.maj(DT, { lacet, tangage, avance: 1, lateral: k % 100 < 50 ? 0 : 1, saut: k === 200 }, vide);
      const m = c.message(lacet, tangage);
      if (m) envoyes.push(m);
    }
    // « serveur » : 60 pas par seconde, les dernières entrées reçues (l'image d'un envoi, avec un envoi sur deux)
    let ref = etatChuteInitial([0, 350, 0], [30, 0, 0]);
    let i = 0;
    for (let k = 0; k < 400; k++) {
      if (k % 2 === 0 && i < envoyes.length) i++;
      const m = envoyes[Math.max(0, i - 1)];
      const en: EntreesChute = { lacet: m.lacet, tangage: m.tangage, avance: m.avance, lateral: m.lateral, ouvrir: m.ouvrir };
      ref = pasChute(ref, en, vide);
    }
    const e = c.etat();
    expect(Math.hypot(e.p[0] - ref.p[0], e.p[1] - ref.p[1], e.p[2] - ref.p[2])).toBeLessThan(ECART_ATTERRISSAGE_M);
  });
});

describe("vieAffichee", () => {
  it("vivant : ma vie ; spectateur : celle du joueur suivi (la mienne vaut 0 depuis ma mort) ; sans cible, la mienne", () => {
    const moi = { pv: 0, bouclier: 0 };
    expect(vieAffichee(false, { pv: 80, bouclier: 30 }, { pv: 55, bouclier: 5 })).toEqual({ pv: 55, bouclier: 5 });
    expect(vieAffichee(true, { pv: 80, bouclier: 30 }, moi)).toEqual({ pv: 80, bouclier: 30 });
    expect(vieAffichee(true, { pv: 42 }, moi)).toEqual({ pv: 42, bouclier: 0 });
    expect(vieAffichee(true, undefined, moi)).toEqual({ pv: 0, bouclier: 0 });
  });
});

describe("degatsDeTempete / soinInutile", () => {
  it("les dégâts sans tireur ni source sont ceux de la tempête ; un tir ou une explosion ne le sont pas", () => {
    expect(degatsDeTempete({ par: "" })).toBe(true);
    expect(degatsDeTempete({ par: "j2" })).toBe(false);
    expect(degatsDeTempete({ par: "", src: [1, 2, 3] })).toBe(false);
  });

  it("soin inutile : bandage au-dessus du plafond de PV, potion avec le bouclier plein (mêmes seuils que le serveur)", () => {
    const max = BR.usage.bandage.plafondPv;
    expect(soinInutile("bandage", max - 1, 0, 50)).toBe(false);
    expect(soinInutile("bandage", max, 0, 50)).toBe(true);
    expect(soinInutile("potion", 10, 49, 50)).toBe(false);
    expect(soinInutile("potion", 10, 50, 50)).toBe(true);
  });
});
