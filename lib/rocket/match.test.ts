import { describe, expect, it } from "vitest";
import {
  BALLE, BUT, COUPS_D_ENVOI, DEFAUT_CONFIG, ENTREES_NULLES, MATCH, PAS_S, PLOT, PLOTS, VOITURE, creerRng, tirer, uu,
} from "./contrat";
import type { ConfigMatch, EntreesVoiture, EvenementMatch, Format, MondeRocket } from "./contrat";
import { creerArene } from "./arene";
import { balleVaEntrer, copierMonde, creerMonde, empreinteMonde, pasMonde, preparerCoupDEnvoi, resultatMatch } from "./match";
import { centreHitbox, pasVoiture } from "./voiture";
import { bornerBalle, pasBalle } from "./balle";
import { appliquerVitesseEnAttente, contactVoitureBalle } from "./contacts";
import { baseDepuisCap } from "./vec";

const arene = creerArene();
const cfg = (o: Partial<ConfigMatch> = {}): ConfigMatch => ({ ...DEFAUT_CONFIG(), ...o });
const nulles = (m: MondeRocket): EntreesVoiture[] => m.voitures.map(() => ENTREES_NULLES());

/** Avance de `n` pas sans entrée, en collectant les événements. */
function avancer(m: MondeRocket, n: number, entrees?: (m: MondeRocket) => EntreesVoiture[]): EvenementMatch[] {
  const ev: EvenementMatch[] = [];
  for (let i = 0; i < n; i++) ev.push(...pasMonde(m, entrees ? entrees(m) : nulles(m)));
  return ev;
}
/** Passe le décompte (3 s) et rend les événements. */
function lancer(m: MondeRocket): EvenementMatch[] {
  const ev: EvenementMatch[] = [];
  let garde = 0;
  while (m.phase === "decompte" && garde++ < 1000) ev.push(...pasMonde(m, nulles(m)));
  return ev;
}
const placerBalleDansLeBut = (m: MondeRocket, cote: 1 | -1): void => {
  m.balle.p = [0, 2, cote * 56];
  m.balle.v = [0, 0, 0];
  m.balle.w = [0, 0, 0];
};
/**
 * Fait comme si la voiture `id` avait touché la balle il y a `pas` pas (RocketSim BallHitInfo::tickCountWhenHit) : `pas` = 0 est une
 * touche pendant le PROCHAIN pas simulé, 1 une touche au pas précédent.
 */
const toucher = (m: MondeRocket, id: number, pas: number): void => { m.voitures[id].dernierContactBalleTick = m.tick - pas; };

describe("creation du monde", () => {
  it.each([["1v1", 2], ["2v2", 4], ["3v3", 6]] as [Format, number][])("%s : %i voitures, un humain, deux équipes égales", (format, n) => {
    const m = creerMonde(cfg({ format }), arene);
    expect(m.voitures).toHaveLength(n);
    expect(m.voitures.filter((v) => v.humain)).toHaveLength(1);
    expect(m.voitures[m.idHumain].humain).toBe(true);
    expect(m.voitures[m.idHumain].slot).toBe(0);
    expect(m.voitures.filter((v) => v.equipe === "bleue")).toHaveLength(n / 2);
    m.voitures.forEach((v, i) => expect(v.id).toBe(i));
  });

  it("l'humain est dans l'équipe choisie", () => {
    const m = creerMonde(cfg({ equipeJoueur: "orange", nomJoueur: "Toam" }), arene);
    expect(m.voitures[m.idHumain].equipe).toBe("orange");
    expect(m.voitures[m.idHumain].nom).toBe("Toam");
  });

  it("phase décompte, score 0-0, plots pleins, balle au repos au centre, voitures figées", () => {
    const m = creerMonde(cfg(), arene);
    expect(m.phase).toBe("decompte");
    expect(m.score).toEqual({ bleue: 0, orange: 0 });
    expect(m.plots).toHaveLength(34);
    expect(m.plots.every((p) => p.actif)).toBe(true);
    expect(m.balle.p).toEqual([0, BALLE.hauteurEngagement, 0]);
    expect(m.voitures.every((v) => v.figee && v.boost === VOITURE.boostInitial)).toBe(true);
    expect(m.tempsRestant).toBe(MATCH.dureeDefautS);
  });

  it("coup d'envoi : positions distinctes tirées parmi les 5, orange symétrique de la bleue", () => {
    const m = creerMonde(cfg({ format: "3v3", graine: 7 }), arene);
    const bleues = m.voitures.filter((v) => v.equipe === "bleue"), oranges = m.voitures.filter((v) => v.equipe === "orange");
    const valides = COUPS_D_ENVOI.map((c) => `${c.x.toFixed(3)}|${c.z.toFixed(3)}`);
    expect(new Set(bleues.map((v) => `${v.p[0].toFixed(3)}|${v.p[2].toFixed(3)}`)).size).toBe(3);
    for (const v of bleues) expect(valides).toContain(`${v.p[0].toFixed(3)}|${v.p[2].toFixed(3)}`);
    for (let i = 0; i < 3; i++) {
      expect(oranges[i].p[0]).toBeCloseTo(-bleues[i].p[0], 9);
      expect(oranges[i].p[2]).toBeCloseTo(-bleues[i].p[2], 9);
    }
    for (const v of bleues) expect(v.p[1]).toBeCloseTo(VOITURE.hauteurRepos, 9);
  });

  it("la graine change les positions de coup d'envoi (au moins deux dispositions différentes)", () => {
    const vu = new Set<string>();
    for (let g = 1; g <= 12; g++) {
      const m = creerMonde(cfg({ graine: g, format: "1v1" }), arene);
      vu.add(`${m.voitures[0].p[0].toFixed(2)}|${m.voitures[0].p[2].toFixed(2)}`);
    }
    expect(vu.size).toBeGreaterThanOrEqual(2);
  });
});

describe("décompte et phases", () => {
  it("3, 2, 1 puis coup d'envoi au bout de 3 s ; voitures libérées ; chrono arrêté pendant le décompte", () => {
    const m = creerMonde(cfg(), arene);
    const ev = lancer(m);
    const ns = ev.filter((e) => e.t === "decompte").map((e) => (e as { n: number }).n);
    expect(ns).toEqual([3, 2, 1]);
    expect(ev.filter((e) => e.t === "coupDEnvoi")).toHaveLength(1);
    expect(m.phase).toBe("enJeu");
    expect(m.temps).toBeCloseTo(MATCH.decompteS, 2);
    expect(m.tempsRestant).toBe(MATCH.dureeDefautS);
    expect(m.voitures.every((v) => !v.figee)).toBe(true);
  });

  it("les voitures figées ne bougent pas pendant le décompte malgré les entrées", () => {
    const m = creerMonde(cfg(), arene);
    avancer(m, 30);
    const avant = m.voitures.map((v) => [...v.p]);
    avancer(m, 100, () => m.voitures.map(() => ({ ...ENTREES_NULLES(), accel: 1, boost: true })));
    m.voitures.forEach((v, i) => {
      expect(Math.hypot(v.p[0] - avant[i][0], v.p[2] - avant[i][2])).toBeLessThan(0.05);
    });
  });

  it("le chrono décompte seulement en jeu : 1 s de jeu = 1 s de moins", () => {
    const m = creerMonde(cfg(), arene);
    lancer(m);
    const t0 = m.tempsRestant;
    avancer(m, 120);
    expect(t0 - m.tempsRestant).toBeCloseTo(1, 2);
  });

  it("le monde est figé après la fin", () => {
    const m = creerMonde(cfg(), arene);
    m.phase = "fini";
    const p = [...m.voitures[0].p];
    expect(avancer(m, 10)).toEqual([]);
    expect(m.voitures[0].p).toEqual(p);
  });
});

describe("but, passes décisives et remise en jeu", () => {
  it("but de la bleue : score, buteur, passe, phase but puis nouveau coup d'envoi", () => {
    const m = creerMonde(cfg({ format: "2v2" }), arene);
    lancer(m);
    // bleues = ids 0, 1 ; oranges = ids 2, 3
    toucher(m, 0, 1);
    toucher(m, 1, 200);
    placerBalleDansLeBut(m, 1);
    const ev = avancer(m, 1);
    const but = ev.find((e) => e.t === "but");
    expect(but).toMatchObject({ t: "but", equipe: "bleue", idMarqueur: 0, idPasse: 1 });
    expect(m.score).toEqual({ bleue: 1, orange: 0 });
    expect(m.phase).toBe("but");
    expect(m.voitures[0].stats.buts).toBe(1);
    expect(m.voitures[0].stats.points).toBe(MATCH.points.but);
    expect(m.voitures[1].stats.passes).toBe(1);
    expect(m.voitures[1].stats.points).toBe(MATCH.points.passeDecisive);
    expect(m.dernierBut?.equipe).toBe("bleue");
    // après la célébration : remise en jeu
    const t = m.temps;
    avancer(m, Math.ceil(MATCH.celebrationS / PAS_S) + 2);
    expect(m.phase).toBe("decompte");
    expect(m.temps - t).toBeGreaterThan(MATCH.celebrationS - 0.1);
    expect(m.balle.p[0]).toBeCloseTo(0, 6);
    expect(m.balle.p[2]).toBeCloseTo(0, 6);
    expect(m.balle.dernierToucheur).toBeNull();
    expect(m.voitures.every((v) => v.figee)).toBe(true);
    // le coup d'envoi oublie les touches (RocketSim : CarState() neuf) : un but sans nouvelle touche n'a pas de buteur
    expect(m.voitures.every((v) => v.dernierContactBalleTick < 0)).toBe(true);
  });

  /** Monde 2v2 en jeu ; `touches` = [id de la voiture, il y a combien de pas] ; la balle est posée dans la cage orange. Rend le but. */
  function butApres(touches: [number, number][]): { idMarqueur: number | null; idPasse: number | null } {
    const m = creerMonde(cfg({ format: "2v2" }), arene);
    lancer(m);
    avancer(m, 1200); // 10 s de jeu : assez de pas derrière soi pour dater de vieilles touches
    for (const [id, pas] of touches) toucher(m, id, pas);
    placerBalleDansLeBut(m, 1);
    const but = avancer(m, 1).find((e) => e.t === "but");
    if (!but || but.t !== "but") throw new Error("pas de but");
    expect(but.equipe).toBe("bleue");
    return { idMarqueur: but.idMarqueur, idPasse: but.idPasse };
  }

  it("buteur : la dernière touche de l'équipe qui marque, vieille de 4 s au plus (RocketSim goalMaxTouchTime = 480 pas)", () => {
    expect(MATCH.fenetreButeurS).toBe(4);
    // RocketSim : touche + 480 >= compteur de pas APRÈS le pas du but ; une touche pendant le pas du but compte pour 1
    expect(butApres([[0, 0]]).idMarqueur).toBe(0);
    expect(butApres([[0, 479]]).idMarqueur).toBe(0);
    expect(butApres([[0, 480]]).idMarqueur).toBeNull();
    // deux coéquipiers : le plus récent marque
    expect(butApres([[0, 300], [1, 100]]).idMarqueur).toBe(1);
    // personne n'a touché la balle
    expect(butApres([])).toEqual({ idMarqueur: null, idPasse: null });
  });

  it("une déviation de l'adversaire ne retire pas le but à l'attaquant qui avait touché avant", () => {
    // la bleue 0 frappe, l'orange 2 dévie dans sa propre cage : but de la bleue 0 (RocketSim ne regarde que l'équipe qui marque)
    expect(butApres([[0, 100], [2, 5]])).toEqual({ idMarqueur: 0, idPasse: null });
  });

  it("passe décisive : un AUTRE coéquipier, 2 s au plus avant la touche du buteur (RocketSim passMaxTouchTime = 240 pas)", () => {
    expect(MATCH.fenetrePasseS).toBe(2);
    // la fenêtre part de la touche du buteur (ici vieille de 100 pas), pas de l'instant du but
    expect(butApres([[0, 100], [1, 340]])).toEqual({ idMarqueur: 0, idPasse: 1 });
    expect(butApres([[0, 100], [1, 341]])).toEqual({ idMarqueur: 0, idPasse: null });
    // ni d'un adversaire, ni sans autre touche
    expect(butApres([[0, 100], [2, 150]]).idPasse).toBeNull();
    expect(butApres([[0, 100]]).idPasse).toBeNull();
  });

  it("contre son camp : le but compte pour l'adversaire, sans buteur si l'équipe qui marque n'a pas touché la balle", () => {
    const m = creerMonde(cfg({ format: "2v2" }), arene);
    lancer(m);
    toucher(m, 2, 1);
    placerBalleDansLeBut(m, 1); // cage orange : la bleue marque
    const ev = avancer(m, 1);
    expect(ev.find((e) => e.t === "but")).toMatchObject({ equipe: "bleue", idMarqueur: null, idPasse: null });
    expect(m.score.bleue).toBe(1);
    expect(m.voitures.every((v) => v.stats.buts === 0)).toBe(true);
  });

  it("but de l'orange dans la cage de Z = -60", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    lancer(m);
    toucher(m, 1, 1);
    placerBalleDansLeBut(m, -1);
    avancer(m, 1);
    expect(m.score).toEqual({ bleue: 0, orange: 1 });
    expect(m.dernierBut?.idMarqueur).toBe(1);
  });

  it("le chrono est arrêté pendant la célébration et le coup d'envoi suivant remet tout en place (plots, boost)", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    lancer(m);
    m.plots[3].actif = false; m.plots[3].recharge = 3;
    m.voitures[0].boost = 80;
    placerBalleDansLeBut(m, 1);
    avancer(m, 1);
    const reste = m.tempsRestant;
    avancer(m, Math.round(MATCH.celebrationS / PAS_S) - 20);
    expect(m.phase).toBe("but");
    expect(m.tempsRestant).toBe(reste);
    avancer(m, 40);
    expect(m.phase).toBe("decompte");
    expect(m.plots.every((p) => p.actif)).toBe(true);
    expect(m.voitures[0].boost).toBeCloseTo(VOITURE.boostInitial, 6);
  });
});

describe("fin du chrono, prolongation, vainqueur", () => {
  it("score différent à 0:00, balle au sol : fin et vainqueur", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    lancer(m);
    m.score.bleue = 2; m.score.orange = 1;
    m.tempsRestant = 0.02;
    const ev = avancer(m, 10);
    expect(ev.some((e) => e.t === "chronoZero")).toBe(true);
    expect(ev.find((e) => e.t === "fin")).toMatchObject({ vainqueur: "bleue" });
    expect(m.phase).toBe("fini");
    expect(m.vainqueur).toBe("bleue");
  });

  it("à 0:00 la fin attend que la balle touche le sol", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    lancer(m);
    m.score.orange = 1;
    m.tempsRestant = 0.01;
    // lâchée à 12 m avec une vitesse infime : une balle sans AUCUNE vitesse dort et ne tomberait pas (RocketSim)
    m.balle.p = [0, 12, 0]; m.balle.v = [0, -1e-6, 0];
    avancer(m, 20);
    expect(m.attenteSolBalle).toBe(true);
    expect(m.phase).toBe("enJeu");
    avancer(m, 400);
    expect(m.phase).toBe("fini");
    expect(m.vainqueur).toBe("orange");
    expect(m.attenteSolBalle).toBe(false);
  });

  it("la balle qui ne retombe jamais est attendue au plus la durée de grâce", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    lancer(m);
    m.score.bleue = 1;
    m.tempsRestant = 0.01;
    let garde = 0;
    while (m.phase === "enJeu" && garde++ < 20000) {
      m.balle.p = [0, 15, 0]; m.balle.v = [0, 0, 0]; // maintenue en l'air artificiellement
      pasMonde(m, nulles(m));
    }
    expect(m.phase).toBe("fini");
    expect(garde * PAS_S).toBeGreaterThanOrEqual(MATCH.graceBalleEnAirS - 0.1);
    expect(garde * PAS_S).toBeLessThan(MATCH.graceBalleEnAirS + 1);
  });

  it("égalité à 0:00 : prolongation, nouveau coup d'envoi, premier but gagne", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    lancer(m);
    m.score.bleue = 1; m.score.orange = 1;
    m.tempsRestant = 0.01;
    const ev = avancer(m, 5);
    expect(ev.some((e) => e.t === "prolongation")).toBe(true);
    expect(m.prolongation).toBe(true);
    expect(m.phase).toBe("decompte");
    lancer(m);
    expect(m.phase).toBe("enJeu");
    const t0 = m.tempsRestant;
    avancer(m, 120);
    expect(m.tempsRestant).toBe(t0); // pas de chrono en mort subite
    m.balle.dernierToucheur = { idVoiture: 1, equipe: "orange", temps: m.temps };
    placerBalleDansLeBut(m, -1);
    avancer(m, 1);
    expect(m.phase).toBe("but");
    const ev2 = avancer(m, Math.ceil(MATCH.celebrationS / PAS_S) + 2);
    expect(ev2.find((e) => e.t === "fin")).toMatchObject({ vainqueur: "orange" });
    expect(m.phase).toBe("fini");
  });

  it("un but marqué pendant l'attente de la balle fait gagner l'équipe ; l'égalisation envoie en prolongation", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    lancer(m);
    m.score.bleue = 1; m.score.orange = 1;
    m.tempsRestant = 0.01;
    m.balle.p = [0, 4, 40]; m.balle.v = [0, 3, 25];
    m.balle.dernierToucheur = { idVoiture: 0, equipe: "bleue", temps: m.temps };
    const ev: EvenementMatch[] = [];
    let g = 0;
    while (m.phase === "enJeu" && g++ < 2000) ev.push(...pasMonde(m, nulles(m)));
    expect(ev.some((e) => e.t === "chronoZero")).toBe(true);
    expect(m.phase).toBe("but");
    avancer(m, Math.ceil(MATCH.celebrationS / PAS_S) + 2);
    expect(m.phase).toBe("fini");
    expect(m.vainqueur).toBe("bleue");
  });

  it("resultatMatch : classement par points décroissants, MVP dans l'équipe gagnante", () => {
    const m = creerMonde(cfg({ format: "2v2" }), arene);
    m.voitures[0].stats.points = 120; m.voitures[1].stats.points = 40;
    m.voitures[2].stats.points = 300; m.voitures[3].stats.points = 10;
    m.score.bleue = 3; m.score.orange = 1;
    m.vainqueur = "bleue";
    const r = resultatMatch(m);
    expect(r.classement.map((l) => l.id)).toEqual([2, 0, 1, 3]);
    expect(r.mvp).toBe(0);
    expect(r.vainqueur).toBe("bleue");
    expect(r.score).toEqual({ bleue: 3, orange: 1 });
  });
});

describe("plots de boost", () => {
  it("ramassage : boost, plot inactif, recharge 4 s (petit) puis événement ; un boost plein ne consomme pas le plot", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    lancer(m);
    const v = m.voitures[0];
    const pl = PLOTS.find((p) => !p.gros && p.x === 0 && p.z > 0) as (typeof PLOTS)[number];
    v.boost = 10;
    // pose la voiture sur le plot
    const c0 = centreHitbox(v);
    v.p = [pl.x - (c0[0] - v.p[0]), v.p[1], pl.z - (c0[2] - v.p[2])];
    const ev = avancer(m, 1);
    const e = ev.find((x) => x.t === "plot");
    expect(e).toMatchObject({ idVoiture: 0, idPlot: pl.id, gros: false, gain: 12 });
    expect(v.boost).toBeCloseTo(22, 6);
    expect(m.plots[pl.id].actif).toBe(false);
    expect(m.plots[pl.id].recharge).toBeCloseTo(4, 6);
    v.p = [v.p[0] + 20, v.p[1], v.p[2] - 10]; // la voiture s'éloigne du plot
    const ev2 = avancer(m, Math.ceil(4 / PAS_S) + 2);
    expect(ev2.some((x) => x.t === "plotRecharge" && x.idPlot === pl.id)).toBe(true);
    expect(m.plots[pl.id].actif).toBe(true);
    // boost plein : pas de consommation
    v.boost = 100;
    const ev3 = avancer(m, 5);
    expect(ev3.some((x) => x.t === "plot")).toBe(false);
    expect(m.plots[pl.id].actif).toBe(true);
  });

  it("gros plot : +100 (plafonné), recharge 10 s", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    lancer(m);
    const v = m.voitures[0];
    const pl = PLOTS.find((p) => p.gros && p.x > 0 && p.z > 0) as (typeof PLOTS)[number];
    v.boost = 5;
    const c0 = centreHitbox(v);
    v.p = [pl.x - (c0[0] - v.p[0]), v.p[1], pl.z - (c0[2] - v.p[2])];
    const ev = avancer(m, 1);
    expect(ev.find((x) => x.t === "plot")).toMatchObject({ gros: true, gain: 95 });
    expect(v.boost).toBe(100);
    expect(m.plots[pl.id].recharge).toBeCloseTo(10, 6);
  });
});

describe("plots et réapparition : règles de RocketSim", () => {
  const petit = PLOTS.find((p) => !p.gros && p.x === 0 && p.z > 0) as (typeof PLOTS)[number];
  /** Monde 1v1 en jeu, voiture 0 immobile en l'air au point voulu (elle ne tombe que d'un demi-millimètre en un pas). */
  function avecVoitureEn(x: number, y: number, z: number): MondeRocket {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    lancer(m);
    const v = m.voitures[0];
    v.p = [x, y, z]; v.v = [0, 0, 0]; v.boost = 10;
    return m;
  }
  const pris = (m: MondeRocket): boolean => avancer(m, 1).some((e) => e.t === "plot" && e.idVoiture === 0);

  it("c'est l'ORIGINE de la voiture qui prend le plot : cylindre de 1,44 m de rayon (petit), 2,08 m (gros)", () => {
    // voiture tournée vers +Z : le centre de sa hitbox est 13,9 cm devant l'origine
    expect(pris(avecVoitureEn(petit.x, 0.17, petit.z - 1.43))).toBe(true);
    expect(pris(avecVoitureEn(petit.x, 0.17, petit.z - 1.45))).toBe(false); // l'origine est dehors, le centre de la hitbox dedans
    expect(pris(avecVoitureEn(petit.x, 0.17, petit.z + 1.43))).toBe(true); // l'origine est dedans, le centre de la hitbox dehors
    const gros = PLOTS.find((p) => p.gros && p.x > 0 && p.z > 0) as (typeof PLOTS)[number];
    expect(pris(avecVoitureEn(gros.x + 2.07, 0.17, gros.z))).toBe(true);
    expect(pris(avecVoitureEn(gros.x + 2.09, 0.17, gros.z))).toBe(false);
  });

  it("en hauteur : l'origine à moins de 0,95 m du centre du plot (0,70 m), soit jusqu'à 1,65 m du sol (RocketSim CYL_HEIGHT)", () => {
    expect(pris(avecVoitureEn(petit.x, 1.6, petit.z))).toBe(true);
    expect(pris(avecVoitureEn(petit.x, 1.64, petit.z))).toBe(true);
    expect(pris(avecVoitureEn(petit.x, 1.67, petit.z))).toBe(false);
  });

  it("un plot qui revient peut être pris au pas même où il se recharge", () => {
    const m = avecVoitureEn(petit.x, 0.17, petit.z);
    m.plots[petit.id].actif = false; m.plots[petit.id].recharge = PAS_S;
    const ev = avancer(m, 1);
    expect(ev.some((e) => e.t === "plotRecharge" && e.idPlot === petit.id)).toBe(true);
    expect(ev.some((e) => e.t === "plot" && e.idPlot === petit.id && e.idVoiture === 0)).toBe(true);
    expect(m.plots[petit.id].actif).toBe(false);
    expect(m.plots[petit.id].recharge).toBeCloseTo(4, 6);
  });

  it("deux voitures dans le cylindre au même pas : la dernière de la liste prend le plot (RocketSim)", () => {
    const m = avecVoitureEn(petit.x - 0.6, 0.17, petit.z);
    const autre = m.voitures[1];
    autre.p = [petit.x + 0.6, 0.17, petit.z]; autre.v = [0, 0, 0]; autre.boost = 10;
    const ev = avancer(m, 1);
    expect(ev.filter((e) => e.t === "plot")).toHaveLength(1);
    expect(ev.find((e) => e.t === "plot")).toMatchObject({ idVoiture: 1 });
    expect(m.voitures[0].boost).toBeCloseTo(10, 6);
  });

  it("recharge : un petit plot revient au 480ᵉ pas, un gros au 1201ᵉ (décompte en simple précision de RocketSim)", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    lancer(m);
    const gros = PLOTS.find((p) => p.gros) as (typeof PLOTS)[number];
    m.plots[petit.id].actif = false; m.plots[petit.id].recharge = PLOT.petit.rechargeS;
    m.plots[gros.id].actif = false; m.plots[gros.id].recharge = PLOT.gros.rechargeS;
    avancer(m, 479);
    expect(m.plots[petit.id].actif).toBe(false);
    expect(avancer(m, 1).some((e) => e.t === "plotRecharge" && e.idPlot === petit.id)).toBe(true);
    expect(m.plots[petit.id]).toMatchObject({ actif: true, recharge: 0 });
    avancer(m, 720); // 1200 pas en tout : 10 − 1200 × (1/120) ne vaut pas 0 en simple précision
    expect(m.plots[gros.id].actif).toBe(false);
    expect(avancer(m, 1).some((e) => e.t === "plotRecharge" && e.idPlot === gros.id)).toBe(true);
    expect(m.plots[gros.id]).toMatchObject({ actif: true, recharge: 0 });
  });

  it("verrou : une voiture restée au sol sur un plot en recharge est verrouillée un pas sur deux (boîte de 0,70 à 1,34 m)", () => {
    const m = avecVoitureEn(petit.x, VOITURE.hauteurRepos, petit.z);
    expect(m.plots[petit.id].verrou).toBe(-1);
    expect(avancer(m, 1).some((e) => e.t === "plot")).toBe(true);
    // pas 1 : dans le cylindre, elle prend le plot et le verrouille ; pas 2 : jugée sur la boîte, que sa hitbox (sous 0,57 m) n'atteint pas
    const verrous: number[] = [m.plots[petit.id].verrou];
    for (let i = 0; i < 5; i++) { avancer(m, 1); verrous.push(m.plots[petit.id].verrou); }
    expect(verrous).toEqual([0, -1, 0, -1, 0, -1]);
    // les autres plots n'ont pas de verrou ; le coup d'envoi les efface tous
    expect(m.plots.filter((p) => p.verrou !== -1)).toHaveLength(0);
    m.plots[petit.id].verrou = 0;
    preparerCoupDEnvoi(m);
    expect(m.plots.every((p) => p.verrou === -1 && p.actif)).toBe(true);
  });

  it("verrou : le plot qui revient pendant un pas verrouillé n'est pris qu'au pas suivant", () => {
    const m = avecVoitureEn(petit.x, VOITURE.hauteurRepos, petit.z);
    m.plots[petit.id].actif = false; m.plots[petit.id].recharge = PAS_S; m.plots[petit.id].verrou = 0;
    const ev = avancer(m, 1);
    expect(ev.some((e) => e.t === "plotRecharge" && e.idPlot === petit.id)).toBe(true);
    expect(ev.some((e) => e.t === "plot")).toBe(false);
    expect(m.plots[petit.id]).toMatchObject({ actif: true, verrou: -1 });
    expect(pris(m)).toBe(true);
  });

  it("verrou : en l'air, la voiture verrouillée est retenue par la boîte (1,20 m de demi-côté + sa hitbox), plus large que le cylindre", () => {
    // voiture tournée vers +Z, à 1 m du sol : sa boîte englobante fait 0,4335 m de demi-largeur en X et va de 1,01 à 1,40 m de haut
    const essai = (dx: number, y: number, verrou: number): boolean => {
      const m = avecVoitureEn(petit.x + dx, y, petit.z);
      m.plots[petit.id].verrou = verrou;
      return pris(m);
    };
    // à 1,55 m du plot : hors du cylindre (1,44 m), dans la boîte (1,20 + 0,4335 = 1,6335 m)
    expect(essai(1.55, 1, -1)).toBe(false);
    expect(essai(1.55, 1, 0)).toBe(true);
    expect(essai(1.62, 1, 0)).toBe(true);
    expect(essai(1.65, 1, 0)).toBe(false);
    // verrouillée sur une AUTRE voiture : c'est le cylindre qui juge
    expect(essai(1.55, 1, 1)).toBe(false);
    // au-dessus de la boîte (bas de la hitbox à 1,34 m quand l'origine est à 1,3258 m) : la voiture verrouillée ne prend plus rien,
    // alors que le cylindre monte jusqu'à 1,65 m
    expect(essai(0, 1.31, 0)).toBe(true);
    expect(essai(0, 1.34, 0)).toBe(false);
    expect(essai(0, 1.34, -1)).toBe(true);
    // gros plot : demi-côté 1,60 m (BOX_RAD_BIG), boîte de 0,73 à 1,37 m
    const gros = PLOTS.find((p) => p.gros && p.x > 0 && p.z > 0) as (typeof PLOTS)[number];
    const essaiGros = (dx: number, verrou: number): boolean => {
      const m = avecVoitureEn(gros.x - dx, 1, gros.z);
      m.plots[gros.id].verrou = verrou;
      return pris(m);
    };
    expect(essaiGros(2.02, 0)).toBe(true); // 1,60 + 0,4335 = 2,0335 m
    expect(essaiGros(2.05, 0)).toBe(false);
    expect(essaiGros(2.05, -1)).toBe(true); // dans le cylindre de 2,08 m
  });

  it("réapparition : 360 pas après la démolition, sur l'un des quatre emplacements de Rocket League, lâchée de 36 cm, boost 33,33", () => {
    const places = new Set<string>();
    for (let graine = 1; graine <= 12; graine++) {
      const m = creerMonde(cfg({ format: "1v1", graine }), arene);
      lancer(m);
      const [a, v] = [m.voitures[0], m.voitures[1]];
      a.p = [0, VOITURE.hauteurRepos, -12]; a.v = [0, 0, 23]; a.base = baseDepuisCap(0); a.supersonique = true; a.boost = 100;
      v.p = [0, VOITURE.hauteurRepos, -4]; v.v = [0, 0, 0]; v.base = baseDepuisCap(Math.PI);
      for (let i = 0; i < 120 && !v.demolie; i++) pasMonde(m, [{ ...ENTREES_NULLES(), accel: 1, boost: true }, ENTREES_NULLES()]);
      expect(v.demolie).toBe(true);
      // 3 s = exactement 360 pas (RocketSim DEMO_RESPAWN_TIME) : rien au 359ᵉ, la voiture revient au 360ᵉ
      expect(avancer(m, 359).some((e) => e.t === "reapparition")).toBe(false);
      expect(v.demolie).toBe(true);
      expect(avancer(m, 1).some((e) => e.t === "reapparition" && e.idVoiture === 1)).toBe(true);
      expect(v.demolie).toBe(false);
      // voiture orange : emplacements de la bleue avec z inversé (z = +46,08 m) et cap tourné de π, face au but adverse (-Z)
      expect(v.p[2]).toBeCloseTo(uu(4608), 9);
      expect([uu(2304), uu(2688)]).toContain(Math.round(Math.abs(v.p[0]) * 1e6) / 1e6);
      expect(v.p[1]).toBeCloseTo(uu(36), 9);
      expect(v.base.avant[2]).toBeCloseTo(-1, 9);
      expect(v.boost).toBeCloseTo(VOITURE.boostInitial, 9);
      expect(v.v).toEqual([0, 0, 0]);
      expect(v.supersonique).toBe(false);
      places.add(`${Math.round(v.p[0] * 100)}`);
      // lâchée de 36 cm : elle retombe sur ses roues
      avancer(m, 60);
      expect(v.auSol).toBe(true);
      expect(v.p[1]).toBeLessThan(0.2);
    }
    // le tirage (Rng du monde) visite plusieurs emplacements selon la graine
    expect(places.size).toBeGreaterThanOrEqual(3);
  });
});

describe("balle : engagement et plafonds (RocketSim)", () => {
  it("à l'engagement la balle dort à 93,15 uu du sol (BALL_REST_Z) tant qu'aucune voiture ne la touche", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    expect(BALLE.hauteurEngagement).toBeCloseTo(0.9315, 12);
    lancer(m);
    avancer(m, 120); // une seconde de jeu sans entrée : personne n'atteint la balle
    expect(m.balle.p).toEqual([0, BALLE.hauteurEngagement, 0]);
    expect(m.balle.v).toEqual([0, 0, 0]);
    // la première voiture qui la touche la réveille
    const v = m.voitures[0];
    v.p = [0, VOITURE.hauteurRepos, -1.6]; v.v = [0, 0, 10]; v.base = baseDepuisCap(0);
    const ev = avancer(m, 3);
    expect(ev.some((e) => e.t === "toucheBalle" && e.idVoiture === 0)).toBe(true);
    expect(m.balle.v[2]).toBeGreaterThan(5);
    avancer(m, 60);
    expect(m.balle.p[2]).toBeGreaterThan(3);
  });

  it("les plafonds de la balle (60 m/s, 6 rad/s) passent une fois, APRÈS les contacts des voitures du pas", () => {
    // une voiture frappe de biais une balle qui tourne déjà à 6 rad/s : le frottement du choc (2,0) lui donne plus de spin que le plafond
    const poser = (v: MondeRocket["voitures"][number], b: MondeRocket["balle"]): void => {
      v.p = [0, VOITURE.hauteurRepos, -1.5]; v.v = [8, 0, 23]; v.w = [0, 0, 0]; v.base = baseDepuisCap(0);
      b.p = [0, BALLE.rayon + 0.01, 0]; b.v = [0, 0, 1e-3]; b.w = [0, 6, 0];
    };
    // le contact seul ne plafonne rien (c'est le rôle de `bornerBalle`, une fois, en fin de pas)
    const brut = creerMonde(cfg({ format: "1v1", graine: 2 }), arene);
    poser(brut.voitures[0], brut.balle);
    expect(contactVoitureBalle(brut.voitures[0], brut.balle, 0, PAS_S)).not.toBeNull();
    expect(Math.hypot(brut.balle.w[0], brut.balle.w[1], brut.balle.w[2])).toBeGreaterThan(BALLE.vitesseAngMax + 0.5);
    // dans le match : jamais au-dessus des plafonds à la fin d'un pas
    const m = creerMonde(cfg({ format: "1v1", graine: 2 }), arene);
    lancer(m);
    m.voitures[1].p = [30, VOITURE.hauteurRepos, 30];
    poser(m.voitures[0], m.balle);
    let touchee = false;
    for (let i = 0; i < 6; i++) {
      const ev = pasMonde(m, nulles(m));
      touchee ||= ev.some((e) => e.t === "toucheBalle");
      expect(Math.hypot(m.balle.v[0], m.balle.v[1], m.balle.v[2])).toBeLessThanOrEqual(BALLE.vitesseMax + 1e-9);
      expect(Math.hypot(m.balle.w[0], m.balle.w[1], m.balle.w[2])).toBeLessThanOrEqual(BALLE.vitesseAngMax + 1e-9);
    }
    expect(touchee).toBe(true);
  });
});

describe("démolition, tirs, arrêts", () => {
  /** Monde 1v1 en jeu, les deux voitures posées à l'écart, pour des scènes scriptées. */
  function scene(): MondeRocket {
    const m = creerMonde(cfg({ format: "1v1", graine: 2 }), arene);
    lancer(m);
    m.voitures[0].p = [-30, VOITURE.hauteurRepos, -30]; m.voitures[1].p = [30, VOITURE.hauteurRepos, 30];
    m.balle.p = [0, 20, 0]; m.balle.v = [0, 0, 0];
    return m;
  }

  it("démolition par un adversaire supersonique : victime démolie, 3 s, points ; réapparition sur un emplacement de réapparition", () => {
    const m = scene();
    const [a, v] = [m.voitures[0], m.voitures[1]];
    a.p = [0, VOITURE.hauteurRepos, -12]; a.v = [0, 0, 23]; a.supersonique = true; a.boost = 100;
    v.p = [0, VOITURE.hauteurRepos, -4];
    const ev: EvenementMatch[] = [];
    for (let i = 0; i < 120 && !v.demolie; i++) ev.push(...pasMonde(m, [{ ...ENTREES_NULLES(), accel: 1, boost: true }, ENTREES_NULLES()]));
    const demo = ev.find((e) => e.t === "demolition");
    expect(demo).toMatchObject({ t: "demolition", victime: 1, auteur: 0 });
    expect(v.demolie).toBe(true);
    expect(v.reapparitionDans).toBeGreaterThan(MATCH.reapparitionS - 0.1);
    expect(a.stats.demolitions).toBe(1);
    expect(a.stats.points).toBe(MATCH.points.demolition);
    expect(v.stats.demolie).toBe(1);
    // pendant 3 s la voiture démolie est inerte et ne ramasse rien ; puis elle revient à un emplacement de réapparition de son équipe
    const ev2 = avancer(m, Math.ceil(MATCH.reapparitionS / PAS_S) + 3);
    expect(ev2.some((e) => e.t === "reapparition" && e.idVoiture === 1)).toBe(true);
    expect(v.demolie).toBe(false);
    expect(v.boost).toBeCloseTo(VOITURE.boostInitial, 6);
    expect(Math.abs(v.p[2])).toBeCloseTo(uu(4608), 6);
  });

  it("jamais de démolition entre coéquipiers, ni à vitesse sous le seuil supersonique", () => {
    const m = creerMonde(cfg({ format: "2v2", graine: 2 }), arene);
    lancer(m);
    m.balle.p = [0, 20, 0];
    m.voitures.forEach((x, i) => { x.p = [-30 + i * 10, VOITURE.hauteurRepos, i < 2 ? -40 : 40]; });
    const [a, b] = [m.voitures[0], m.voitures[1]];
    a.p = [0, VOITURE.hauteurRepos, -30]; a.v = [0, 0, 23]; a.supersonique = true;
    b.p = [0, VOITURE.hauteurRepos, -22];
    avancer(m, 100, () => m.voitures.map((_, i) => (i === 0 ? { ...ENTREES_NULLES(), accel: 1, boost: true } : ENTREES_NULLES())));
    expect(b.demolie).toBe(false);
    // adversaire à 18 m/s (non supersonique)
    const m2 = scene();
    const [c, d] = [m2.voitures[0], m2.voitures[1]];
    c.p = [0, VOITURE.hauteurRepos, -12]; c.v = [0, 0, 18];
    d.p = [0, VOITURE.hauteurRepos, -4];
    const ev = avancer(m2, 90, () => [{ ...ENTREES_NULLES(), accel: 0.5 }, ENTREES_NULLES()]);
    expect(ev.some((e) => e.t === "demolition")).toBe(false);
    expect(d.demolie).toBe(false);
  });

  /** Balle lancée vers la cage orange (Z = +60), « touchée » par la bleue 0 il y a `pas` pas ; les voitures sont à l'écart. */
  function tirVersOrange(pas: number, v: [number, number, number] = [0, 2, 25], p: [number, number, number] = [0, 1.5, 20]): MondeRocket {
    const m = scene();
    m.balle.p = p; m.balle.v = v; m.balle.w = [0, 0, 0];
    toucher(m, 0, pas);
    return m;
  }

  it("tir cadré : compté 0,3 s (36 pas) après la touche, si la balle va au but à 17,5 m/s au moins, en moins de 2 s (RocketSim)", () => {
    expect(MATCH.suivi).toMatchObject({ vitesseMin: 17.5, delaiToucheS: 0.3, delaiTirS: 1, horizonS: 2, margeCadreRayons: 0.1 });
    // touche vieille de 34 pas : au premier pas elle en a 35 (trop tôt), au deuxième 36 : le tir est compté, une seule fois
    const m = tirVersOrange(34);
    const a = m.voitures[0];
    avancer(m, 1);
    expect(a.stats.tirs).toBe(0);
    avancer(m, 1);
    expect(a.stats.tirs).toBe(1);
    expect(a.stats.points).toBe(MATCH.points.tir);
    avancer(m, 30);
    expect(a.stats.tirs).toBe(1);
    expect(m.voitures[1].stats.tirs).toBe(0);
    // trop lente (17 m/s), trop loin (plus de 2 s de la ligne), hors cadre, ou touche trop ancienne (le créneau de 36-37 pas est passé)
    for (const essai of [tirVersOrange(34, [0, 0, 17]), tirVersOrange(34, [0, 2, 25], [0, 1.5, -5]), tirVersOrange(34, [14, 2, 25]), tirVersOrange(37)]) {
      avancer(essai, 10);
      expect(essai.voitures[0].stats.tirs).toBe(0);
    }
    // la touche d'un DÉFENSEUR (orange vers sa propre cage) ne fait pas un tir
    const csc = scene();
    csc.balle.p = [0, 1.5, 20]; csc.balle.v = [0, 2, 25];
    toucher(csc, 1, 34);
    avancer(csc, 10);
    expect(csc.voitures.every((v) => v.stats.tirs === 0)).toBe(true);
  });

  it("tir cadré : une vraie frappe vers la cage est comptée une fois", () => {
    const m = scene();
    const a = m.voitures[0];
    a.p = [0, VOITURE.hauteurRepos, 24]; a.v = [0, 0, 22]; a.base = baseDepuisCap(0);
    m.balle.p = [0, BALLE.rayon + 0.02, 30]; m.balle.v = [0, 0, 1e-3];
    avancer(m, 110, () => [ENTREES_NULLES(), ENTREES_NULLES()]);
    expect(a.stats.touches).toBeGreaterThanOrEqual(1);
    expect(a.stats.tirs).toBe(1);
    expect(a.stats.points).toBeGreaterThanOrEqual(MATCH.points.tir + MATCH.points.touche);
    expect(m.balle.dernierToucheur?.idVoiture).toBe(0);
  });

  it("un seul tir par seconde : le délai court une fois la balle retombée hors cadre (RocketSim shotEventCooldown)", () => {
    const m = tirVersOrange(34);
    const a = m.voitures[0];
    avancer(m, 2);
    expect(a.stats.tirs).toBe(1);
    // la balle part de côté : elle n'est plus « tirée », sans arrêt puisque personne ne l'a touchée
    m.balle.v = [20, 0, 0];
    const ev = avancer(m, 1);
    expect(ev.some((e) => e.t === "arret")).toBe(false);
    // nouvelle frappe aussitôt : le délai d'une seconde n'est pas écoulé, elle ne compte pas
    m.balle.p = [0, 1.5, 20]; m.balle.v = [0, 2, 25];
    toucher(m, 0, 34);
    avancer(m, 10);
    expect(a.stats.tirs).toBe(1);
    // une seconde plus tard, la même frappe compte
    avancer(m, 120);
    m.balle.p = [0, 1.5, 20]; m.balle.v = [0, 2, 25];
    toucher(m, 0, 34);
    avancer(m, 3);
    expect(a.stats.tirs).toBe(2);
  });

  it("arrêt : la balle tirée n'entre plus et un défenseur vient de la toucher au même pas (+50 points), événement émis", () => {
    const m = tirVersOrange(34);
    const g = m.voitures[1]; // l'orange défend Z = +60
    avancer(m, 2);
    expect(m.voitures[0].stats.tirs).toBe(1);
    // le défenseur touche mais la balle file toujours au but : pas d'arrêt
    toucher(m, 1, 0);
    expect(avancer(m, 1).some((e) => e.t === "arret")).toBe(false);
    expect(g.stats.arrets).toBe(0);
    // il la renvoie : arrêt, une seule fois
    toucher(m, 1, 0);
    m.balle.v = [0, 3, -12];
    const ev = avancer(m, 1);
    expect(ev.filter((e) => e.t === "arret")).toEqual([{ t: "arret", idVoiture: 1 }]);
    expect(g.stats.arrets).toBe(1);
    expect(g.stats.points).toBe(MATCH.points.arret);
    toucher(m, 1, 0);
    expect(avancer(m, 1).some((e) => e.t === "arret")).toBe(false);
  });

  it("pas d'arrêt si le tir manque le cadre tout seul, ni si la touche du défenseur date d'un pas précédent", () => {
    const m = tirVersOrange(34);
    avancer(m, 2);
    toucher(m, 1, 1);
    m.balle.v = [20, 0, 5];
    expect(avancer(m, 1).some((e) => e.t === "arret")).toBe(false);
    expect(m.voitures[1].stats.arrets).toBe(0);
  });

  it("arrêt : un gardien posé devant sa cage repousse une vraie frappe", () => {
    const m = tirVersOrange(34, [0, 0, 24], [0, 1.1, 30]);
    const g = m.voitures[1];
    g.p = [0, VOITURE.hauteurRepos, 46]; g.v = [0, 0, 0]; g.base = baseDepuisCap(Math.PI); // devant la cage, face à la balle
    const ev = avancer(m, 120);
    expect(m.voitures[0].stats.tirs).toBe(1);
    expect(ev.some((e) => e.t === "arret" && e.idVoiture === 1)).toBe(true);
    expect(g.stats.arrets).toBe(1);
    expect(m.phase).toBe("enJeu");
  });

  it("une balle qui n'a pas été tirée par l'adversaire ne donne pas d'arrêt (renvoi d'un coéquipier vers sa cage, balle lente)", () => {
    // l'orange renvoie elle-même la balle vers sa cage : aucun tir de la bleue, donc aucun arrêt
    const m = scene();
    const g = m.voitures[1];
    g.p = [0, VOITURE.hauteurRepos, 46]; g.v = [0, 0, 0]; g.base = baseDepuisCap(Math.PI);
    toucher(m, 1, 34);
    m.balle.p = [0, 1.1, 30]; m.balle.v = [0, 0, 24];
    avancer(m, 120);
    expect(g.stats.arrets).toBe(0);
    // frappe de la bleue trop lente pour être un tir (16 m/s) : le gardien la touche, sans arrêt
    const lent = tirVersOrange(34, [0, 0, 16], [0, 1.1, 38]);
    const g2 = lent.voitures[1];
    g2.p = [0, VOITURE.hauteurRepos, 46]; g2.v = [0, 0, 0]; g2.base = baseDepuisCap(Math.PI);
    avancer(lent, 120);
    expect(g2.stats.touches).toBeGreaterThanOrEqual(1);
    expect(g2.stats.arrets).toBe(0);
  });
});

describe("déterminisme", () => {
  function partie(graine: number, pas: number): number {
    const m = creerMonde(cfg({ format: "2v2", graine }), arene);
    const r = creerRng(graine * 31 + 5);
    const e = m.voitures.map(() => ENTREES_NULLES());
    for (let i = 0; i < pas; i++) {
      if (i % 20 === 0) {
        for (const x of e) {
          x.accel = tirer(r) < 0.8 ? 1 : -1; x.direction = tirer(r) * 2 - 1; x.boost = tirer(r) < 0.6;
          x.saut = tirer(r) < 0.1; x.tangage = tirer(r) * 2 - 1; x.roulis = 0; x.lacet = tirer(r) * 2 - 1; x.derapage = tirer(r) < 0.2;
        }
      }
      pasMonde(m, e);
    }
    return empreinteMonde(m);
  }
  it("même graine et mêmes entrées : même empreinte ; autre graine : autre empreinte", () => {
    const a = partie(11, 900), b = partie(11, 900), c = partie(12, 900);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("une copie du monde évolue comme l'original", () => {
    const m = creerMonde(cfg({ format: "2v2", graine: 3 }), arene);
    lancer(m);
    const c = copierMonde(m);
    for (let i = 0; i < 200; i++) {
      const e = m.voitures.map(() => ({ ...ENTREES_NULLES(), accel: 1, boost: i % 50 < 25 }));
      pasMonde(m, e); pasMonde(c, e);
    }
    expect(empreinteMonde(c)).toBe(empreinteMonde(m));
  });
});

describe("règles de comptage", () => {
  it("balleVaEntrer : cage visée, horizon, cadre élargi de 0,1 rayon, gravité (RocketSim IsBallProbablyGoingIn)", () => {
    // vers la cage de Z = +60, que défend l'orange : 11,24 m à 20 m/s = 0,56 s
    expect(balleVaEntrer([0, 1, 40], [0, 0, 20], 2)).toBe("orange");
    // vers la cage de Z = -60, que défend la bleue
    expect(balleVaEntrer([2, 1, -45], [0, 0, -15], 2)).toBe("bleue");
    // sans vitesse en Z
    expect(balleVaEntrer([0, 1, 40], [5, 0, 0], 2)).toBeNull();
    // le temps se compte jusqu'à la ligne de but (51,2425 m) : 2,56 s > 2 s ; un horizon plus long l'accepte
    expect(balleVaEntrer([0, 1, 0], [0, 0, 20], 2)).toBeNull();
    expect(balleVaEntrer([0, 1, 0], [0, 0, 20], 3)).toBe("orange");
    // dans l'autre sens, c'est l'autre cage qui est visée (91 m à 20 m/s)
    expect(balleVaEntrer([0, 1, 40], [0, 0, -20], 2)).toBeNull();
    expect(balleVaEntrer([0, 1, 40], [0, 0, -20], 5)).toBe("bleue");
    // hors du cadre latéral ; le cadre est élargi de 0,1 rayon de balle (9,1 cm) de chaque côté
    expect(balleVaEntrer([0, 1, 40], [20, 0, 20], 2)).toBeNull();
    expect(balleVaEntrer([BUT.demiLargeur + 0.08, 1, 40], [0, 0, 20], 2)).toBe("orange");
    expect(balleVaEntrer([BUT.demiLargeur + 0.1, 1, 40], [0, 0, 20], 2)).toBeNull();
    expect(balleVaEntrer([BUT.demiLargeur + 0.3, 1, 40], [0, 0, 20], 2, 0.25)).toBe("orange"); // marge supplémentaire
    // trop haute à la ligne ; la gravité la ramène dans le cadre si elle a le temps
    expect(balleVaEntrer([0, 15, 40], [0, 8, 20], 2)).toBeNull();
    expect(balleVaEntrer([0, 8, 25], [0, 0, 20], 2)).toBe("orange"); // 1,31 s : 8 − 0,5 × 6,5 × 1,31² = 2,4 m
    // une trajectoire qui passerait sous le sol reste cadrée (pas de rebond dans la prolongation)
    expect(balleVaEntrer([0, 1, 30], [0, -5, 20], 2)).toBe("orange");
  });

  it("uu : conversion (garde-fou du contrat)", () => {
    expect(uu(100)).toBe(1);
  });

  it("préparer un coup d'envoi ressuscite les voitures démolies", () => {
    const m = creerMonde(cfg({ format: "2v2" }), arene);
    lancer(m);
    m.voitures[2].demolie = true; m.voitures[2].reapparitionDans = 2;
    preparerCoupDEnvoi(m);
    expect(m.voitures[2].demolie).toBe(false);
    expect(m.phase).toBe("decompte");
  });
});

describe("contacts simultanés : état d'avant les contacts et vitesse en attente (RocketSim _velocityImpulseCache, _FinishPhysicsTick)", () => {
  it("deux voitures sur la balle au même pas : chaque impulsion de Psyonix se calcule sur la balle d'avant les contacts, et n'entre qu'en fin de pas", () => {
    const m = creerMonde(cfg({ format: "1v1", graine: 2 }), arene);
    lancer(m);
    const [a, b] = m.voitures;
    a.p = [0, VOITURE.hauteurRepos, -1.5]; a.v = [0, 0, 20]; a.w = [0, 0, 0]; a.base = baseDepuisCap(0);
    b.p = [0, VOITURE.hauteurRepos, 1.5]; b.v = [0, 0, -12]; b.w = [0, 0, 0]; b.base = baseDepuisCap(Math.PI);
    m.balle.p = [0, BALLE.rayon + 0.01, 0]; m.balle.v = [0, 0, 1e-3]; m.balle.w = [0, 0, 0];

    // référence : le même pas déroulé à la main (voitures, balle, puis les contacts)
    const ref = copierMonde(m);
    for (const v of ref.voitures) pasVoiture(arene, v, ENTREES_NULLES(), PAS_S, ref.tick);
    pasBalle(arene, ref.balle, PAS_S);
    const avant = { p: [...ref.balle.p] as [number, number, number], v: [...ref.balle.v] as [number, number, number] };
    // ce que chaque voiture donnerait SEULE à cette balle
    const seule = (i: number): number[] => {
      const c = copierMonde(ref);
      expect(contactVoitureBalle(c.voitures[i], c.balle, c.tick, PAS_S)).not.toBeNull();
      return [...c.balle.vitesseEnAttente];
    };
    const sa = seule(0), sb = seule(1);
    expect(Math.hypot(sa[0], sa[1], sa[2])).toBeGreaterThan(8);
    expect(Math.hypot(sb[0], sb[1], sb[2])).toBeGreaterThan(5);
    // les deux contacts dans l'ordre de la liste, sur la balle figée : le cumul est la somme des deux impulsions solitaires
    for (const v of ref.voitures) expect(contactVoitureBalle(v, ref.balle, ref.tick, PAS_S, avant)).not.toBeNull();
    for (let k = 0; k < 3; k++) expect(ref.balle.vitesseEnAttente[k]).toBeCloseTo(sa[k] + sb[k], 12);
    appliquerVitesseEnAttente(ref.balle);
    bornerBalle(ref.balle);

    // le match fait exactement cela
    const ev = pasMonde(m, nulles(m));
    expect(ev.filter((e) => e.t === "toucheBalle")).toHaveLength(2);
    expect(m.balle.v).toEqual(ref.balle.v);
    expect(m.balle.vitesseEnAttente).toEqual([0, 0, 0]);
    expect(a.derniereImpulsionPsyonixTick).toBe(m.tick - 1);
    expect(b.derniereImpulsionPsyonixTick).toBe(m.tick - 1);
  });

  it("trois voitures qui se touchent au même pas : un bump ne passe pas d'une paire à l'autre, la vitesse est plafonnée une fois, à la fin", () => {
    const m = creerMonde(cfg({ format: "2v2", graine: 2 }), arene);
    lancer(m);
    m.balle.p = [0, 20, 0]; m.balle.v = [0, 0, 0]; m.balle.w = [0, 0, 0];
    const [a, b, c, d] = m.voitures;
    // à la file le long de +Z : a (14 m/s) va emboutir b, à l'arrêt, dont le nez est déjà contre l'arrière de c, à l'arrêt
    const poser = (v: MondeRocket["voitures"][number], z: number): void => {
      v.p = [20, VOITURE.hauteurRepos, z]; v.v = [0, 0, 0]; v.w = [0, 0, 0]; v.base = baseDepuisCap(0);
    };
    poser(a, -22.39); poser(b, -21.16); poser(c, -20);
    a.v = [0, 0, 14];
    d.p = [-30, VOITURE.hauteurRepos, 30];
    const ev = pasMonde(m, nulles(m));
    // un seul bump : a sur b. Avant les contacts du pas, b était à l'arrêt : elle ne bumpe pas c avec l'élan qu'elle vient de recevoir
    const bumps = ev.filter((e) => e.t === "bump");
    expect(bumps).toHaveLength(1);
    expect(bumps[0]).toMatchObject({ idVoiture: 0, autre: 1 });
    expect(a.bumpAutreId).toBe(1);
    expect(b.bumpAutreId).toBe(-1);
    // b : choc + bump (11 m/s le long de la marche de a, 2,78 m/s vers le haut) ; c : seulement le choc que b lui transmet
    expect(b.v[2]).toBeGreaterThan(11);
    expect(b.v[1]).toBeGreaterThan(2);
    expect(c.v[2]).toBeGreaterThan(0);
    expect(c.v[2]).toBeLessThan(6);
    expect(c.v[1]).toBeLessThan(0.5);
    // fin de pas : plus rien en attente, personne au-dessus du plafond
    for (const v of m.voitures) {
      expect(v.vitesseEnAttente).toEqual([0, 0, 0]);
      expect(Math.hypot(v.v[0], v.v[1], v.v[2])).toBeLessThanOrEqual(VOITURE.vitesseMax + 1e-9);
    }
  });

  it("une voiture démolie au pas où elle recevait un bump l'oublie : rien ne l'attend à sa réapparition", () => {
    const m = creerMonde(cfg({ format: "2v2", graine: 2 }), arene);
    lancer(m);
    m.balle.p = [0, 20, 0]; m.balle.v = [0, 0, 0]; m.balle.w = [0, 0, 0];
    // la victime (orange) est bumpée par l'arrière par une bleue, puis démolie de face par l'autre bleue, supersonique, au même pas
    // (la paire du bump passe avant celle de la démolition : le bump attend déjà quand la victime est démolie)
    const [pousseuse, demolisseuse] = m.voitures.filter((v) => v.equipe === "bleue");
    const [victime, autre] = m.voitures.filter((v) => v.equipe === "orange");
    expect(pousseuse.id).toBeLessThan(demolisseuse.id);
    const poser = (v: MondeRocket["voitures"][number], z: number, cap: number, vz: number): void => {
      v.p = [20, VOITURE.hauteurRepos, z]; v.v = [0, 0, vz]; v.w = [0, 0, 0]; v.base = baseDepuisCap(cap);
    };
    poser(victime, -20, 0, 0);
    poser(pousseuse, -21.23, 0, 14); // derrière la victime, la pousse vers +Z
    poser(demolisseuse, -18.62, Math.PI, -23); // face à la victime, supersonique
    demolisseuse.supersonique = true;
    autre.p = [-30, VOITURE.hauteurRepos, 30];
    const ev = pasMonde(m, nulles(m));
    expect(ev.some((e) => e.t === "bump" && e.idVoiture === pousseuse.id && e.autre === victime.id)).toBe(true);
    expect(ev.some((e) => e.t === "demolition" && e.victime === victime.id && e.auteur === demolisseuse.id)).toBe(true);
    expect(victime.demolie).toBe(true);
    for (const v of m.voitures) expect(v.vitesseEnAttente).toEqual([0, 0, 0]);
    // trois secondes plus tard elle réapparaît à l'arrêt (lâchée de 36 cm), sans le bump
    const ev2 = avancer(m, Math.ceil(MATCH.reapparitionS / PAS_S) + 1);
    expect(ev2.some((e) => e.t === "reapparition" && e.idVoiture === victime.id)).toBe(true);
    expect(Math.hypot(victime.v[0], victime.v[2])).toBeLessThan(0.5);
  });
});
