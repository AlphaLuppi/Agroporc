import { describe, expect, it } from "vitest";
import {
  BALLE, COUPS_D_ENVOI, DEFAUT_CONFIG, ENTREES_NULLES, MATCH, PAS_S, PLOTS, VOITURE, creerRng, tirer, uu,
} from "./contrat";
import type { ConfigMatch, EntreesVoiture, EvenementMatch, Format, MondeRocket } from "./contrat";
import { creerArene } from "./arene";
import { balleVersCage, copierMonde, creerMonde, empreinteMonde, pasMonde, preparerCoupDEnvoi, resultatMatch } from "./match";
import { centreHitbox } from "./voiture";

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
    m.balle.dernierToucheur = { idVoiture: 0, equipe: "bleue", temps: m.temps };
    m.balle.avantDernierToucheur = { idVoiture: 1, equipe: "bleue", temps: m.temps - 2 };
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
  });

  it("pas de passe décisive au-delà de 5 s, ni d'un adversaire, ni du buteur lui-même", () => {
    const essai = (avant: { idVoiture: number; equipe: "bleue" | "orange"; temps: number } | null): number | null => {
      const m = creerMonde(cfg({ format: "2v2" }), arene);
      lancer(m);
      m.balle.dernierToucheur = { idVoiture: 0, equipe: "bleue", temps: m.temps };
      m.balle.avantDernierToucheur = avant && { ...avant, temps: m.temps - avant.temps };
      placerBalleDansLeBut(m, 1);
      const but = avancer(m, 1).find((e) => e.t === "but");
      return but && but.t === "but" ? but.idPasse : -1;
    };
    expect(essai({ idVoiture: 1, equipe: "bleue", temps: 4.9 })).toBe(1);
    expect(essai({ idVoiture: 1, equipe: "bleue", temps: 5.5 })).toBeNull();
    expect(essai({ idVoiture: 2, equipe: "orange", temps: 1 })).toBeNull();
    expect(essai({ idVoiture: 0, equipe: "bleue", temps: 1 })).toBeNull();
    expect(essai(null)).toBeNull();
  });

  it("contre son camp : le but compte pour l'adversaire, sans buteur", () => {
    const m = creerMonde(cfg({ format: "2v2" }), arene);
    lancer(m);
    m.balle.dernierToucheur = { idVoiture: 2, equipe: "orange", temps: m.temps };
    placerBalleDansLeBut(m, 1); // cage orange : la bleue marque
    const ev = avancer(m, 1);
    expect(ev.find((e) => e.t === "but")).toMatchObject({ equipe: "bleue", idMarqueur: null, idPasse: null });
    expect(m.score.bleue).toBe(1);
    expect(m.voitures.every((v) => v.stats.buts === 0)).toBe(true);
  });

  it("but de l'orange dans la cage de Z = -60", () => {
    const m = creerMonde(cfg({ format: "1v1" }), arene);
    lancer(m);
    m.balle.dernierToucheur = { idVoiture: 1, equipe: "orange", temps: m.temps };
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
    avancer(m, 200);
    expect(m.tempsRestant).toBe(reste);
    avancer(m, 400);
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
    m.balle.p = [0, 12, 0]; m.balle.v = [0, 0, 0];
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

describe("démolition, tirs, arrêts", () => {
  /** Monde 1v1 en jeu, les deux voitures posées à l'écart, pour des scènes scriptées. */
  function scene(): MondeRocket {
    const m = creerMonde(cfg({ format: "1v1", graine: 2 }), arene);
    lancer(m);
    m.voitures[0].p = [-30, VOITURE.hauteurRepos, -30]; m.voitures[1].p = [30, VOITURE.hauteurRepos, 30];
    m.balle.p = [0, 20, 0]; m.balle.v = [0, 0, 0];
    return m;
  }

  it("démolition par un adversaire supersonique : victime démolie, 3 s, points ; réapparition sur un emplacement libre", () => {
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
    // pendant 3 s la voiture démolie est inerte et ne ramasse rien ; puis elle revient à un coup d'envoi libre de son équipe
    const ev2 = avancer(m, Math.ceil(MATCH.reapparitionS / PAS_S) + 3);
    expect(ev2.some((e) => e.t === "reapparition" && e.idVoiture === 1)).toBe(true);
    expect(v.demolie).toBe(false);
    expect(v.boost).toBeCloseTo(VOITURE.boostInitial, 6);
    expect(Math.abs(v.p[2])).toBeGreaterThan(25);
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

  it("tir cadré : touche, tir compté une fois par seconde, points", () => {
    const m = scene();
    const a = m.voitures[0];
    a.p = [0, VOITURE.hauteurRepos, 28]; a.v = [0, 0, 18];
    m.balle.p = [0, BALLE.rayon + 0.02, 36]; m.balle.v = [0, 0, 0];
    avancer(m, 90, () => [{ ...ENTREES_NULLES(), accel: 1 }, ENTREES_NULLES()]);
    expect(a.stats.touches).toBeGreaterThanOrEqual(1);
    expect(a.stats.tirs).toBe(1);
    expect(a.stats.points).toBeGreaterThanOrEqual(MATCH.points.tir + MATCH.points.touche);
    expect(m.balle.dernierToucheur?.idVoiture).toBe(0);
  });

  it("arrêt : une voiture touche une balle qui allait vers sa cage (+50 points), événement émis", () => {
    const m = scene();
    const [, g] = m.voitures; // l'orange défend Z = +60
    g.p = [0, VOITURE.hauteurRepos, 46]; // devant la cage, face à la balle
    m.balle.p = [0, 1.2, 38]; m.balle.v = [0, 0, 16]; m.balle.w = [0, 0, 0];
    const ev = avancer(m, 120);
    expect(ev.some((e) => e.t === "arret" && e.idVoiture === 1)).toBe(true);
    expect(g.stats.arrets).toBe(1);
    expect(g.stats.points).toBeGreaterThanOrEqual(MATCH.points.arret);
  });

  it("un coéquipier qui renvoie sa propre balle vers sa cage ne fait pas d'arrêt", () => {
    const m = scene();
    const g = m.voitures[1];
    g.p = [0, VOITURE.hauteurRepos, 46];
    m.balle.dernierToucheur = { idVoiture: 1, equipe: "orange", temps: m.temps };
    m.balle.p = [0, 1.2, 38]; m.balle.v = [0, 0, 16];
    avancer(m, 120);
    expect(g.stats.arrets).toBe(0);
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
  it("balleVersCage : cadrée, vitesse minimale, horizon, distance", () => {
    // tir cadré vers la cage de Z = +60 (signe +1)
    expect(balleVersCage([0, 1, 40], [0, 0, 20], 1, 45)).toBe(true);
    // hors du cadre latéral
    expect(balleVersCage([0, 1, 40], [20, 0, 20], 1, 45)).toBe(false);
    // trop lente
    expect(balleVersCage([0, 1, 49], [0, 0, 5], 1, 12)).toBe(false);
    // dans l'autre sens
    expect(balleVersCage([0, 1, 40], [0, 0, -20], 1, 45)).toBe(false);
    // trop loin pour un arrêt (12 m)
    expect(balleVersCage([0, 1, 20], [0, 0, 20], 1, 12)).toBe(false);
    // trop haute
    expect(balleVersCage([0, 15, 40], [0, 8, 20], 1, 45)).toBe(false);
    // cage de Z = -60
    expect(balleVersCage([2, 1, -45], [0, 0, -15], -1, 45)).toBe(true);
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
