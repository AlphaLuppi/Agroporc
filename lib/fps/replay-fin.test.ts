import { describe, expect, it } from "vitest";
import {
  BONUS_DERNIER_KILL, CAMERA_REPLAY, CameraCinemato, EnregistreurReplay, REPLAY_FIN, axeDuel, choisirMoments, estKillReplay, noteMoment, octetsClip, titreMoment,
  type Clip, type MarqueMort,
} from "./replay-fin";
import type { ArmeId, CauseMort, EtatJoueurSnap, Vec3, Zone } from "./protocole";
import { JEU } from "./protocole";

const T0 = 1_000_000;

function etat(id: string, x: number, extra: Partial<EtatJoueurSnap> = {}): EtatJoueurSnap {
  return { id, p: [x, 0, 0], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0, arme: "pistolet", pv: 100, vivant: true, protege: false, ...extra };
}
const joueurs = (): EtatJoueurSnap[] => [etat("a", 0), etat("b", 10), etat("c", 20)];

/** Un snap toutes les 50 ms de `de` à `a` (ms absolues). */
function snaps(e: EnregistreurReplay, de: number, a: number): void {
  for (let ts = de; ts <= a; ts += 50) e.alimenter(ts, joueurs());
}

type Mort = { cible: string; par: string; arme: ArmeId; cause: CauseMort; zone: Zone; ts: number; distance?: number };
const mort = (ts: number, extra: Partial<Mort> = {}): Mort => ({ cible: "b", par: "a", arme: "pistolet", cause: "arme", zone: "corps", ts, distance: 12, ...extra });

describe("budget de l'entracte", () => {
  it("le replay (moments de fenêtre pleine + attente de clôture) tient dans l'entracte avec de la marge pour le podium", () => {
    const duree = REPLAY_FIN.momentsMax * (REPLAY_FIN.avantMs + REPLAY_FIN.apresMs) + REPLAY_FIN.attenteMaxMs;
    expect(duree).toBeLessThan(JEU.entracteMs);
    expect(JEU.entracteMs - duree).toBeGreaterThanOrEqual(2000);
  });
  it("l'anneau garde la fenêtre « avant » entière", () => {
    expect(REPLAY_FIN.anneauMs).toBeGreaterThan(REPLAY_FIN.avantMs + REPLAY_FIN.apresMs / 2);
  });
});

describe("estKillReplay", () => {
  it("un tueur qui n'est pas la victime, pour une cause qui lui est imputable", () => {
    expect(estKillReplay({ cible: "b", par: "a", cause: "arme" })).toBe(true);
    expect(estKillReplay({ cible: "b", par: "a", cause: "ecrase_vehicule" })).toBe(true);
    expect(estKillReplay({ cible: "b", par: "", cause: "ecrase_pnj" })).toBe(false);
    expect(estKillReplay({ cible: "b", par: "b", cause: "arme" })).toBe(false);
    expect(estKillReplay({ cible: "b", par: "a", cause: "police" })).toBe(false);
  });
});

describe("noteMoment", () => {
  const base = (m: Partial<MarqueMort>, multi = 1, serie = 1) => noteMoment({ marque: { ts: 0, tueur: "a", cible: "b", arme: "pistolet", cause: "arme", zone: "corps", distance: 10, ...m }, multi, serie });
  it("un kill ordinaire vaut la note de base", () => {
    expect(base({})).toBe(10);
  });
  it("l'arme blanche, la tête, la distance, la série et le multi-kill rapportent", () => {
    expect(base({ arme: "couteau" })).toBeGreaterThan(base({}));
    expect(base({ arme: "epee" })).toBeGreaterThan(base({ arme: "couteau" }));
    expect(base({ zone: "tete" })).toBeGreaterThan(base({}));
    expect(base({ arme: "sniper", distance: 100 })).toBeGreaterThan(base({ arme: "sniper", distance: 50 }));
    expect(base({ arme: "sniper", distance: 30 })).toBe(10);
    expect(base({}, 1, 8)).toBeGreaterThan(base({}, 1, 4));
    expect(base({}, 3)).toBe(70);
  });
  it("la distance et la série sont plafonnées", () => {
    expect(base({ arme: "sniper", distance: 5000 })).toBe(40);
    expect(base({}, 1, 500)).toBe(30);
  });
});

describe("EnregistreurReplay : anneau et clips", () => {
  it("l'anneau est sous-échantillonné et borné quelle que soit la durée du match", () => {
    const e = new EnregistreurReplay();
    snaps(e, T0, T0 + 120_000);
    expect(e.tailleAnneau()).toBeLessThanOrEqual(REPLAY_FIN.anneauMs / REPLAY_FIN.echantillonMs + 2);
    expect(e.tailleAnneau()).toBeGreaterThan(30);
  });

  it("une mort ouvre une fenêtre qui devient un clip une fois l'« après » écoulé", () => {
    const e = new EnregistreurReplay();
    snaps(e, T0, T0 + 10_000);
    e.surMort(mort(T0 + 10_000));
    expect(e.enAttente()).toBe(1);
    expect(e.lesClips()).toHaveLength(0);
    snaps(e, T0 + 10_050, T0 + 10_000 + REPLAY_FIN.apresMs + 100);
    expect(e.enAttente()).toBe(0);
    const [c] = e.lesClips();
    expect(c.debut).toBe(T0 + 10_000 - REPLAY_FIN.avantMs);
    expect(c.fin).toBe(T0 + 10_000 + REPLAY_FIN.apresMs);
    expect(c.snaps[0].ts).toBeGreaterThanOrEqual(c.debut);
    expect(c.snaps[c.snaps.length - 1].ts).toBeLessThanOrEqual(c.fin);
    // ≈ 11 Hz sur 5,2 s
    expect(c.snaps.length).toBeGreaterThan(40);
    expect(c.snaps.length).toBeLessThan(65);
    expect(c.octets).toBe(octetsClip(c.snaps, c.evenements));
  });

  it("garde les tirs, coups et dégâts de la fenêtre, pas ceux d'avant ni d'après", () => {
    const e = new EnregistreurReplay();
    snaps(e, T0, T0 + 6000);
    // 5,5 s avant la mort : hors fenêtre
    e.evenement({ genre: "tir", ts: T0 + 500, id: "a", arme: "pistolet", o: [0, 1.6, 0], d: [[1, 0, 0]] });
    e.evenement({ genre: "degats", ts: T0 + 5900, cible: "b", par: "a", degats: 40, pv: 0, zone: "corps" });
    e.evenement({ genre: "mort", ts: T0 + 5950, cible: "b", par: "a", zone: "corps", arme: "pistolet" });
    e.surMort(mort(T0 + 6000));
    snaps(e, T0 + 6050, T0 + 6000 + REPLAY_FIN.apresMs + 100);
    // après la fenêtre
    e.evenement({ genre: "tir", ts: T0 + 6000 + REPLAY_FIN.apresMs + 50, id: "a", arme: "pistolet", o: [0, 1.6, 0], d: [[1, 0, 0]] });
    snaps(e, T0 + 7400, T0 + 8000);
    const [c] = e.lesClips();
    expect(c.evenements.map((x) => x.genre)).toEqual(["degats"]);
  });

  it("une fenêtre sans assez de snaps est abandonnée", () => {
    const e = new EnregistreurReplay();
    e.alimenter(T0, joueurs());
    e.surMort(mort(T0));
    e.alimenter(T0 + 2000, joueurs());
    expect(e.lesClips()).toHaveLength(0);
    expect(e.aDuContenu()).toBe(false);
  });

  it("une mort sans tueur (PNJ, tempête) ou un suicide n'ouvre rien", () => {
    const e = new EnregistreurReplay();
    snaps(e, T0, T0 + 5000);
    e.surMort(mort(T0 + 5000, { par: "", cause: "ecrase_pnj" }));
    e.surMort(mort(T0 + 5000, { par: "b" }));
    expect(e.enAttente()).toBe(0);
  });

  it("ignore un snap en retard, un horodatage non fini", () => {
    const e = new EnregistreurReplay();
    e.alimenter(T0 + 1000, joueurs());
    e.alimenter(T0 + 500, joueurs());
    e.alimenter(Number.NaN, joueurs());
    expect(e.tailleAnneau()).toBe(1);
  });

  it("terminer clôt les fenêtres encore ouvertes avec ce qu'on a", () => {
    const e = new EnregistreurReplay();
    snaps(e, T0, T0 + 6000);
    e.surMort(mort(T0 + 6000));
    e.terminer();
    expect(e.enAttente()).toBe(0);
    expect(e.lesClips()).toHaveLength(1);
  });

  it("vider oublie tout", () => {
    const e = new EnregistreurReplay();
    snaps(e, T0, T0 + 6000);
    e.surMort(mort(T0 + 6000));
    e.terminer();
    e.vider();
    expect(e.aDuContenu()).toBe(false);
    expect(e.tailleAnneau()).toBe(0);
    expect(e.octets()).toBe(0);
  });
});

describe("EnregistreurReplay : séries et multi-kills", () => {
  function match(instants: number[], tueur = "a", opts: { mortDeTueurEntre?: number } = {}): Clip[] {
    const e = new EnregistreurReplay();
    const fin = instants[instants.length - 1] + REPLAY_FIN.apresMs + 200;
    let i = 0;
    for (let ts = T0; ts <= fin; ts += 50) {
      e.alimenter(ts, joueurs());
      while (i < instants.length && instants[i] <= ts) {
        e.surMort(mort(instants[i], { par: tueur, cible: `v${i}` }));
        if (opts.mortDeTueurEntre !== undefined && i === opts.mortDeTueurEntre) e.surMort(mort(instants[i] + 10, { par: "z", cible: tueur }));
        i++;
      }
    }
    e.terminer();
    return e.lesClips().sort((a, b) => a.marque.ts - b.marque.ts);
  }

  it("kills du même tueur espacés de moins de chaineMs : le multi grandit", () => {
    const cs = match([T0 + 8000, T0 + 9500, T0 + 11_000]);
    expect(cs.map((c) => c.multi)).toEqual([1, 2, 3]);
    expect(cs.map((c) => c.serie)).toEqual([1, 2, 3]);
  });

  it("au-delà de chaineMs, ce sont des kills isolés (mais la série continue)", () => {
    const cs = match([T0 + 8000, T0 + 8000 + REPLAY_FIN.chaineMs + 500]);
    expect(cs.map((c) => c.multi)).toEqual([1, 1]);
    expect(cs.map((c) => c.serie)).toEqual([1, 2]);
  });

  it("la mort du tueur remet sa série à zéro", () => {
    const cs = match([T0 + 8000, T0 + 20_000], "a", { mortDeTueurEntre: 0 }).filter((c) => c.marque.tueur === "a");
    expect(cs.map((c) => c.serie)).toEqual([1, 1]);
  });

  it("le dernier kill est marqué final avec son bonus", () => {
    const e = new EnregistreurReplay();
    snaps(e, T0, T0 + 8000);
    e.surMort(mort(T0 + 8000));
    snaps(e, T0 + 8050, T0 + 19_000);
    e.surMort(mort(T0 + 19_000, { cible: "c" }));
    snaps(e, T0 + 19_050, T0 + 20_000);
    e.terminer();
    const cs = e.lesClips();
    const [premier, dernier] = cs.sort((a, b) => a.marque.ts - b.marque.ts);
    expect(premier.final).toBe(false);
    expect(dernier.final).toBe(true);
    expect(dernier.score).toBe(noteMoment(dernier) + BONUS_DERNIER_KILL);
  });
});

describe("EnregistreurReplay : plafonds de mémoire", () => {
  /** `n` kills isolés (30 s d'écart), le i-ième avec `scores[i]` de distance de tir au sniper (note croissante avec la distance). */
  function remplir(distances: number[]): EnregistreurReplay {
    const e = new EnregistreurReplay();
    let ts = T0;
    for (let i = 0; i < distances.length; i++) {
      const tm = T0 + 10_000 + i * 30_000;
      for (; ts <= tm + REPLAY_FIN.apresMs + 100; ts += 50) e.alimenter(ts, joueurs());
      e.surMort(mort(tm, { cible: `v${i}`, arme: "sniper", distance: distances[i] }));
    }
    for (let k = 0; k < 40; k++, ts += 50) e.alimenter(ts, joueurs());
    return e;
  }

  it("ne garde jamais plus de clipsMax clips", () => {
    const e = remplir(Array.from({ length: 25 }, () => 20));
    expect(e.lesClips().length).toBe(REPLAY_FIN.clipsMax);
  });

  it("l'éviction retire le moins bon et garde le plus récent même s'il est médiocre", () => {
    const d = Array.from({ length: 12 }, (_, i) => (i === 0 ? 120 : i === 11 ? 20 : 60 + i));
    const e = remplir(d);
    const cs = e.lesClips();
    expect(cs.length).toBe(REPLAY_FIN.clipsMax);
    // le meilleur (120 m, tout premier) est resté, le dernier (20 m) aussi
    expect(cs.some((c) => c.marque.cible === "v0")).toBe(true);
    expect(cs.some((c) => c.marque.cible === "v11" && c.final)).toBe(true);
    // les deux moins bons parmi les autres sont partis (v1 : 61 m, v2 : 62 m)
    expect(cs.some((c) => c.marque.cible === "v1")).toBe(false);
  });

  it("respecte le plafond d'octets", () => {
    const e = remplir(Array.from({ length: 10 }, () => 20));
    expect(e.octets()).toBeLessThanOrEqual(REPLAY_FIN.octetsMax);
    // un match de 16 joueurs reste très en dessous du plafond avec clipsMax clips
    const gros = new EnregistreurReplay();
    const seize = Array.from({ length: 16 }, (_, i) => etat(`p${i}`, i));
    for (let ts = T0; ts <= T0 + 6000; ts += 50) gros.alimenter(ts, seize, [{ id: 1, p: [0, 0, 0], cap: 0, v: 0 }]);
    gros.surMort(mort(T0 + 5000));
    gros.terminer();
    const [c] = gros.lesClips();
    expect(c.octets).toBeLessThan(REPLAY_FIN.octetsMax / REPLAY_FIN.clipsMax);
  });
});

type ExtraClip = Omit<Partial<Clip>, "marque"> & { marque?: Partial<MarqueMort> };

function clip(ts: number, extra: ExtraClip = {}): Clip {
  const marque: MarqueMort = { ts, tueur: "a", cible: "b", arme: "pistolet", cause: "arme", zone: "corps", distance: 10, ...extra.marque };
  const base = { marque, multi: extra.multi ?? 1, serie: extra.serie ?? 1 };
  return { ...base, final: extra.final ?? false, debut: ts - REPLAY_FIN.avantMs, fin: ts + REPLAY_FIN.apresMs, snaps: [], evenements: [], score: extra.score ?? noteMoment(base), octets: 0 };
}

describe("choisirMoments", () => {
  it("garde les meilleurs, dans l'ordre chronologique", () => {
    const cs = [clip(T0 + 10_000, { score: 20 }), clip(T0 + 30_000, { score: 50 }), clip(T0 + 60_000, { score: 35 }), clip(T0 + 90_000, { score: 15 }), clip(T0 + 120_000, { score: 99 })];
    const m = choisirMoments(cs);
    expect(m).toHaveLength(REPLAY_FIN.momentsMax);
    expect(m.map((c) => c.marque.ts)).toEqual([T0 + 10_000, T0 + 30_000, T0 + 60_000, T0 + 120_000]);
  });

  it("n'en montre pas deux à moins de exclusionMs : un multi-kill n'est montré qu'une fois", () => {
    const cs = [clip(T0 + 10_000, { score: 40 }), clip(T0 + 11_500, { score: 70, multi: 2 }), clip(T0 + 13_000, { score: 100, multi: 3 })];
    const m = choisirMoments(cs);
    expect(m).toHaveLength(1);
    expect(m[0].multi).toBe(3);
  });

  it("le dernier kill du match est toujours rejoué, même médiocre, et clôt le replay", () => {
    const cs = [clip(T0 + 10_000, { score: 80 }), clip(T0 + 30_000, { score: 70 }), clip(T0 + 50_000, { score: 60 }), clip(T0 + 70_000, { score: 55 }), clip(T0 + 90_000, { score: 11, final: true })];
    const m = choisirMoments(cs);
    expect(m).toHaveLength(REPLAY_FIN.momentsMax);
    expect(m[m.length - 1].final).toBe(true);
  });

  it("écarte les notes faibles au-delà des deux premiers", () => {
    const cs = [clip(T0 + 10_000, { score: 12 }), clip(T0 + 30_000, { score: 11 }), clip(T0 + 50_000, { score: 10 }), clip(T0 + 70_000, { score: 10 })];
    expect(choisirMoments(cs)).toHaveLength(2);
  });

  it("rien en entrée, rien en sortie", () => {
    expect(choisirMoments([])).toEqual([]);
  });
});

describe("titreMoment", () => {
  const pseudo = (id: string) => ({ a: "Alice", b: "Bob" } as Record<string, string>)[id] ?? id;
  const t = (extra: ExtraClip) => titreMoment(clip(T0, extra), pseudo);

  it("multi-kills", () => {
    expect(t({ multi: 2 }).titre).toBe("Double kill · Alice");
    expect(t({ multi: 3 }).titre).toBe("Triple kill · Alice");
    expect(t({ multi: 4 }).titre).toBe("Quadruple kill · Alice");
    expect(t({ multi: 6 }).titre).toBe("Multi-kill ×6 · Alice");
  });
  it("arme blanche, tir de loin, headshot au sniper", () => {
    expect(t({ marque: { arme: "couteau" } }).titre).toBe("Kill au couteau · Alice");
    expect(t({ marque: { arme: "epee" } }).titre).toBe("Coup d'épée · Alice");
    expect(t({ marque: { arme: "sniper", distance: 112.4 } }).titre).toBe("Tir à 112 m · Alice");
    expect(t({ marque: { arme: "sniper", distance: 50, zone: "tete" } }).titre).toBe("Headshot au sniper · Alice");
  });
  it("détail : tueur → victime, arme, distance, dernier kill", () => {
    const d = t({ marque: { arme: "sniper", distance: 50, zone: "tete" }, final: true }).detail;
    expect(d).toContain("Alice → Bob");
    expect(d).toContain("Sniper");
    expect(d).toContain("50 m");
    expect(d).toContain("dernier kill du match");
  });
  it("le dernier kill sans autre mérite s'annonce comme tel ; sinon « Élimination »", () => {
    expect(t({ final: true }).titre).toBe("Dernier kill du match · Alice");
    expect(t({}).titre).toBe("Élimination · Alice");
    expect(t({ serie: 7 }).titre).toBe("Série de 7 · Alice");
  });
});

describe("CameraCinemato", () => {
  const victime: Vec3 = [10, 0, 0], tueur: Vec3 = [0, 0, 0];
  function pose(ecoule: number, v: Vec3 | null = victime, k: Vec3 | null = tueur, cam = nouvelle()) {
    return cam.maj(1 / 60, ecoule, 4, v, k);
  }
  function nouvelle(graine = 2): CameraCinemato {
    const c = new CameraCinemato();
    c.commencer(graine, axeDuel(victime, tueur));
    return c;
  }

  it("regarde le centre du duel, à bonne distance et au-dessus du sol", () => {
    const p = pose(0)!;
    const centre: Vec3 = [5, CAMERA_REPLAY.poitrine, 0];
    const d = Math.hypot(p.pos[0] - centre[0], p.pos[2] - centre[2]);
    expect(d).toBeGreaterThanOrEqual(CAMERA_REPLAY.rayonMin * (1 - CAMERA_REPLAY.poussee) - 0.01);
    expect(d).toBeLessThanOrEqual(CAMERA_REPLAY.rayonMax);
    expect(p.pos[1]).toBeGreaterThan(centre[1]);
    // vise le centre : la direction de la caméra (lacet, tangage) pointe vers lui
    const dir: Vec3 = [-Math.sin(p.lacet) * Math.cos(p.tangage), Math.sin(p.tangage), -Math.cos(p.lacet) * Math.cos(p.tangage)];
    const vers: Vec3 = [centre[0] - p.pos[0], centre[1] + 0.15 - p.pos[1], centre[2] - p.pos[2]];
    const n = Math.hypot(...vers);
    expect(dir[0] * vers[0] / n + dir[1] * vers[1] / n + dir[2] * vers[2] / n).toBeGreaterThan(0.999);
  });

  it("filme le duel de côté (perpendiculaire à l'axe tueur → victime) au départ", () => {
    const p = pose(0)!;
    // l'axe est x : la caméra est décalée surtout en z
    expect(Math.abs(p.pos[2] - 0)).toBeGreaterThan(Math.abs(p.pos[0] - 5));
  });

  it("tourne autour de l'action", () => {
    const c = nouvelle();
    const a = c.maj(0, 0, 4, victime, tueur)!;
    const b = c.maj(0.1, 3, 4, victime, tueur)!;
    expect(Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2])).toBeGreaterThan(1);
  });

  it("se resserre à l'instant de la mort", () => {
    const c = nouvelle();
    c.maj(0, 0, 4, victime, tueur);
    const avant = c.maj(1 / 60, 1, 4, victime, tueur)!;
    const dAvant = Math.hypot(avant.pos[0] - 5, avant.pos[2]);
    const c2 = nouvelle();
    c2.maj(0, 0, 4, victime, tueur);
    const mort = c2.maj(1 / 60, 4.1, 4, victime, tueur)!;
    expect(Math.hypot(mort.pos[0] - 5, mort.pos[2])).toBeLessThan(dAvant);
  });

  it("ne suit que la victime si le tueur est loin ou absent, et rend null si personne", () => {
    const loin = pose(0, victime, [200, 0, 0])!;
    expect(Math.hypot(loin.pos[0] - 10, loin.pos[2])).toBeLessThanOrEqual(CAMERA_REPLAY.rayonMax);
    expect(pose(0, victime, null)).not.toBeNull();
    expect(pose(0, null, tueur)).not.toBeNull();
    expect(pose(0, null, null)).toBeNull();
  });

  it("est ramenée devant un mur, sans jamais passer sous la marge minimale", () => {
    const c = nouvelle();
    const lancer = () => 3;
    const p = c.maj(0, 0, 4, victime, tueur, lancer)!;
    expect(Math.hypot(p.pos[0] - 5, p.pos[2])).toBeLessThan(CAMERA_REPLAY.rayonMin);
    const c2 = nouvelle();
    const colle = c2.maj(0, 0, 4, victime, tueur, () => 0.1)!;
    expect(Math.hypot(colle.pos[0] - 5, colle.pos[2])).toBeGreaterThanOrEqual(1.59);
  });

  it("est déterministe pour une graine donnée, et le sens d'orbite dépend de la graine", () => {
    const a = pose(1.2, victime, tueur, nouvelle(2))!;
    const b = pose(1.2, victime, tueur, nouvelle(2))!;
    expect(a).toEqual(b);
    const paire = nouvelle(2).maj(0, 2, 4, victime, tueur)!;
    const impaire = nouvelle(3).maj(0, 2, 4, victime, tueur)!;
    expect(paire.pos[2]).not.toBeCloseTo(impaire.pos[2], 1);
  });

  it("suit le mouvement avec un lissage (pas de saut de caméra)", () => {
    const c = nouvelle();
    const a = c.maj(0, 0, 4, victime, tueur)!;
    const b = c.maj(1 / 60, 0.02, 4, [victime[0] + 30, 0, 0], [tueur[0] + 30, 0, 0])!;
    expect(Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2])).toBeLessThan(5);
  });

  it("axeDuel : 0 sans l'un des deux", () => {
    expect(axeDuel(null, tueur)).toBe(0);
    expect(axeDuel(victime, tueur)).toBeCloseTo(Math.PI / 2);
  });
});
