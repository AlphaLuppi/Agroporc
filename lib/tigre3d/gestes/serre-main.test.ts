import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vector3 } from "three";
import {
  serreMain, CLIP_SERRE_MAIN, DUREE_CLIP_SERRE_MAIN, ENTREE_SERRE_MAIN, SORTIE_SERRE_MAIN,
  EVENEMENTS_SERRE_MAIN, BULLES_SERRE_MAIN, BULLES_AFFICHEES, BULLE_MIN,
  poidsMainHumaine, DEBUT_MAIN_HUMAINE, FIN_MAIN_HUMAINE,
} from "./serre-main";
import { GESTES } from "./index";
import { creerCorps, avancerCorps, corpsVersSol, type Corps, type Couche } from "../corps";
import { creerAnimateur } from "../animateur";
import { amortir, ressort, type Ressort } from "../ressorts";
import { GROUPE_DE, GROUPES, ROLES, type Groupe, type Role } from "../os";
import { reposDe } from "../squelette";
import { clipNomme } from "../clips";
import type { PoseGeste } from "./types";
import trajectoires from "../../../scripts/tigre/donnees/chat-shake-trajectoires.json";

const FPS = 60;
const OMEGA: Record<Groupe, number> = {
  corps: 7, colonne: 7, cou: 10, tete: 12, machoire: 16, oreilles: 14, queue: 5, avG: 9, avD: 9, arG: 9, arD: 9,
};
const ctx = { sens: 1 as const, tClap: null, tVexe: null, humeur: "curieux" as const, clip: clipNomme, temps: 0 };

function touches(p: PoseGeste): Set<Groupe> {
  const s = new Set<Groupe>();
  if (p.corps) s.add("corps");
  for (const r of Object.keys(p.deltas ?? {}) as Role[]) s.add(GROUPE_DE[r]);
  for (const pt of Object.keys(p.pattes ?? {}) as Groupe[]) s.add(pt);
  return s;
}

/** Le geste joué sur le corps à l'arrêt, face caméra, poids sur ressorts comme dans l'animateur. */
function jouer(chaque: (c: Corps, t: number, p: PoseGeste) => void) {
  const c = creerCorps({ cap: 0, graine: 3 });
  for (let k = 0; k < 90; k++) avancerCorps(c, 1 / FPS, { vitesse: 0, sens: 1, cap: 0, regard: 1, couches: [] });
  const poids = Object.fromEntries(GROUPES.map((g) => [g, ressort(0)])) as Record<Groupe, Ressort>;
  const n = Math.round((serreMain.duree + 0.8) * FPS);
  for (let k = 0; k <= n; k++) {
    const t = k / FPS;
    const p = serreMain.echantillonner(Math.min(t, serreMain.duree), ctx);
    const actif = t <= serreMain.duree;
    const tg = touches(p);
    const w = {} as Record<Groupe, number>;
    for (const g of GROUPES) w[g] = Math.min(1, Math.max(0, amortir(poids[g], actif ? (p.poids?.[g] ?? (tg.has(g) ? 1 : 0)) : 0, OMEGA[g], 1 / FPS)));
    const couche: Couche = { pose: p, poids: w };
    avancerCorps(c, 1 / FPS, { vitesse: 0, sens: 1, cap: 0, regard: 1, couches: [couche] });
    chaque(c, t, p);
  }
}

describe("geste serre-main (chat « shake my hand » reciblé)", () => {
  it("clip : une pose par image vidéo, au timing de la vidéo", () => {
    expect(CLIP_SERRE_MAIN.fps).toBe(30);
    expect(CLIP_SERRE_MAIN.images).toHaveLength(205);
    expect(DUREE_CLIP_SERRE_MAIN).toBeCloseTo(204 / 30, 6);
    for (const im of CLIP_SERRE_MAIN.images) {
      expect(im.corps?.pivot).toBe("hanches");
      // Debout : cabré entre ~70° et ~95° (le chat se penche au plus de ~13° vers la caméra).
      expect(im.corps!.tangage!).toBeGreaterThan(1.2);
      expect(im.corps!.tangage!).toBeLessThan(1.7);
      for (const pt of ["avG", "avD"] as const) {
        const p = im.pattes![pt]!;
        expect([...p.cible, ...p.extremite!].every(Number.isFinite)).toBe(true);
      }
      for (const r of ["cou", "tete", "machoire", "oreilleG", "oreilleD", "queue1"] as Role[]) expect(im.deltas![r]).toHaveLength(3);
    }
  });

  it("le clip est reproductible : le script de reciblage redonne exactement le fichier", () => {
    const sortie = join(mkdtempSync(join(tmpdir(), "chat-")), "clip.json");
    execFileSync("node", ["scripts/tigre/retargeting_chat.mjs", "scripts/tigre/donnees/chat-shake-trajectoires.json", sortie], { stdio: "pipe" });
    expect(readFileSync(sortie, "utf8")).toBe(readFileSync("lib/tigre3d/clips/chat-serre-main.json", "utf8"));
  });

  it("face à nous, immobile ; entrée tenue sur la première image, sortie : poids à zéro", () => {
    expect(serreMain.immobile).toBe(true);
    expect(serreMain.cap!(1)).toBe(0);
    expect(serreMain.cap!(-1)).toBe(0);
    expect(serreMain.duree).toBeCloseTo(ENTREE_SERRE_MAIN + DUREE_CLIP_SERRE_MAIN + SORTIE_SERRE_MAIN, 6);
    const debut = serreMain.echantillonner(0, ctx), image0 = serreMain.echantillonner(ENTREE_SERRE_MAIN, ctx);
    expect({ ...debut, poids: undefined }).toEqual({ ...image0, poids: undefined });
    // La queue part la première (elle passe derrière lui avant qu'il se cabre).
    expect(debut.poids).toMatchObject({ queue: 1, corps: 0, avG: 0, avD: 0, tete: 0 });
    expect(serreMain.echantillonner(0.5, ctx).poids).toBeUndefined();
    const fin = serreMain.echantillonner(serreMain.duree, ctx);
    expect(Object.values(fin.poids ?? {}).every((w) => w === 0)).toBe(true);
    // Au milieu du clip : la pose de l'image vidéo correspondante.
    const p = serreMain.echantillonner(ENTREE_SERRE_MAIN + 100 / 30, ctx);
    expect(p.pattes!.avD!.cible[1]).toBeCloseTo(CLIP_SERRE_MAIN.images[100].pattes!.avD!.cible[1], 6);
  });

  it("une bulle par phase de la vidéo, au début du segment, jusqu'à la suivante ; aucune trop brève", () => {
    const segments = CLIP_SERRE_MAIN.segments;
    expect(segments).toHaveLength(11);
    expect(EVENEMENTS_SERRE_MAIN).toHaveLength(BULLES_AFFICHEES.length);
    const debuts = new Set(segments.map((s) => s.debut));
    // Le segment 0 (3 images) est réuni aux applaudissements qui suivent.
    for (const b of BULLES_SERRE_MAIN) expect(debuts.has(b.image) || b.image === segments[1].debut).toBe(true);
    BULLES_AFFICHEES.forEach((b, k) => {
      const e = EVENEMENTS_SERRE_MAIN[k];
      // La première dès qu'il se dresse ; les suivantes au début de leur phase.
      expect(e.t).toBeCloseTo(k === 0 ? 0.3 : ENTREE_SERRE_MAIN + b.image / 30, 6);
      // Lisible : au moins BULLE_MIN s (la bulle précédente reste quand une phase est trop brève).
      expect(e.duree).toBeGreaterThanOrEqual(BULLE_MIN - 1e-6);
      // Chaque bulle tient jusqu'à la suivante (léger recouvrement : jamais d'image sans bulle).
      if (k > 0) {
        const fin = EVENEMENTS_SERRE_MAIN[k - 1].t + EVENEMENTS_SERRE_MAIN[k - 1].duree;
        expect(fin).toBeGreaterThanOrEqual(e.t);
        expect(fin - e.t).toBeLessThan(0.1);
      }
      expect(e.texte.length).toBeGreaterThan(2);
    });
    // Chaque segment assez long (sauf le 0) commence avec sa bulle.
    for (const s of segments.slice(1)) if ((s.fin + 1 - s.debut) / 30 >= BULLE_MIN && s !== segments.at(-1)) expect(BULLES_AFFICHEES.some((b) => b.image === s.debut), `${s.debut}`).toBe(true);
    expect(new Set(BULLES_SERRE_MAIN.map((b) => b.texte)).size).toBe(BULLES_SERRE_MAIN.length);
    expect(BULLES_AFFICHEES.at(-1)!.texte).toMatch(/pince/);
    const dernier = EVENEMENTS_SERRE_MAIN.at(-1)!;
    expect(dernier.t + dernier.duree).toBeGreaterThan(ENTREE_SERRE_MAIN + DUREE_CLIP_SERRE_MAIN);
  });

  it("sur le moteur : il se dresse, pieds arrière plantés, poignets sur les cibles, puis retombe", () => {
    let hMax = 0, hFin = 0, glisse = 0, ecart = 0, n = 0;
    const pieds0: Vector3[] = [];
    jouer((c, t, p) => {
      const sq = c.sq;
      const h = c.monde.p[sq.i.epauleG].y;
      if (t > ENTREE_SERRE_MAIN && t < ENTREE_SERRE_MAIN + DUREE_CLIP_SERRE_MAIN) {
        hMax = Math.max(hMax, h);
        // Poignets : là où le clip les veut (hors portée, la cible est déjà ramenée sur le bord).
        for (const [pt, r] of [["avG", "mainG"], ["avD", "mainD"]] as const) {
          const cible = corpsVersSol(c, new Vector3(...p.pattes![pt]!.cible), new Vector3());
          ecart += cible.distanceTo(c.monde.p[sq.i[r]]); n++;
        }
      }
      hFin = h;
      for (const [k, r] of (["bout_piedG", "bout_piedD"] as Role[]).entries()) {
        const q = c.monde.p[sq.i[r]];
        pieds0[k] ??= q.clone();
        glisse = Math.max(glisse, Math.hypot(q.x - pieds0[k].x, q.z - pieds0[k].z));
      }
    });
    const repos = reposDe(creerCorps().sq, "epauleG").y;
    expect(hMax).toBeGreaterThan(repos + 0.2); // debout : le rachis monte de plus de 20 cm
    expect(hFin).toBeCloseTo(repos, 1); // revenu à quatre pattes
    expect(glisse).toBeLessThan(0.01);
    expect(ecart / n).toBeLessThan(0.012);
  });

  it("fidélité : les bouts de pattes du tigre, vus par la caméra de la vidéo, suivent ceux du chat", () => {
    // Caméra de la vidéo : plongée de 50° (cf. ELEVATION dans scripts/tigre/retargeting_chat.mjs).
    const e = (50 * Math.PI) / 180;
    const proj = (v: Vector3) => [v.x, v.y * Math.cos(e) - v.z * Math.sin(e)];
    const tigre: Record<"G" | "D", number[][]> = { G: [], D: [] };
    let image = 0;
    jouer((c, t) => {
      const i = Math.round((t - ENTREE_SERRE_MAIN) * 30);
      if (i !== image || Math.abs(t - ENTREE_SERRE_MAIN - i / 30) > 1e-6 || i > 204) return;
      image++;
      const sq = c.sq;
      const [mx, my] = proj(c.monde.p[sq.i.brasG].clone().add(c.monde.p[sq.i.brasD]).multiplyScalar(0.5));
      const l = c.monde.p[sq.i.brasG].distanceTo(c.monde.p[sq.i.brasD]);
      for (const cote of ["G", "D"] as const) {
        const [x, y] = proj(c.monde.p[sq.i[`bout_main${cote}`]]);
        tigre[cote].push([(x - mx) / l, (y - my) / l]);
      }
    });
    expect(tigre.G).toHaveLength(205);
    const pts = (trajectoires as { images: Array<{ points: Record<string, { x: number; y: number }> }> }).images;
    const correlation = (a: number[], b: number[]) => {
      const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
      let c = 0, va = 0, vb = 0;
      a.forEach((x, k) => { c += (x - ma) * (b[k] - mb); va += (x - ma) ** 2; vb += (b[k] - mb) ** 2; });
      return c / Math.sqrt(va * vb);
    };
    for (const [cote, s] of [["G", "g"], ["D", "d"]] as const) {
      const larg = pts.map((im) => Math.hypot(im.points.epaule_g.x - im.points.epaule_d.x, im.points.epaule_g.y - im.points.epaule_d.y));
      const chatX = pts.map((im, i) => (im.points[`bout_patte_${s}`].x - (im.points.epaule_g.x + im.points.epaule_d.x) / 2) / larg[i]);
      const chatY = pts.map((im, i) => -(im.points[`bout_patte_${s}`].y - (im.points.epaule_g.y + im.points.epaule_d.y) / 2) / larg[i]);
      expect(correlation(chatX, tigre[cote].map((v) => v[0])), `${cote} x`).toBeGreaterThan(0.85);
      expect(correlation(chatY, tigre[cote].map((v) => v[1])), `${cote} y`).toBeGreaterThan(0.85);
    }
  });

  it("fidélité vue du site : patte au museau, pattes croisées, patte tendue vers nous à la fin", () => {
    const parImage: Array<{ museau: number; croise: number; avanceD: number }> = [];
    let image = 0;
    jouer((c, t) => {
      const i = Math.round((t - ENTREE_SERRE_MAIN) * 30);
      if (i !== image || Math.abs(t - ENTREE_SERRE_MAIN - i / 30) > 1e-6 || i > 204) return;
      image++;
      const p = c.monde.p, k = c.sq.i;
      parImage.push({
        // Distance 3D bout de patte D ↔ museau (contact patte → nez, images 96–155).
        museau: p[k.bout_mainD].distanceTo(p[k.bout_tete]),
        // Croisement : bout G à droite (x < ) du bout D (le tigre est face à nous : +X = sa gauche).
        croise: p[k.bout_mainG].x - p[k.bout_mainD].x,
        // Patte D tendue vers nous : avance (z monde) du poignet devant le garrot.
        avanceD: p[k.mainD].z - p[k.epauleD].z,
      });
    });
    const moy = (a: number, b: number, f: (x: typeof parImage[number]) => number) => {
      const xs = parImage.slice(a, b + 1).map(f);
      return xs.reduce((s, x) => s + x, 0) / xs.length;
    };
    // Patte au museau (vidéo : bout de patte sur le nez) : moins de 9 cm du museau du tigre en moyenne.
    expect(moy(110, 130, (x) => x.museau)).toBeLessThan(0.09);
    // Applaudissements croisés (images 33–42) et pattes croisées (80–95) : les bouts se croisent.
    expect(parImage.slice(80, 96).filter((x) => x.croise < 0).length).toBeGreaterThan(8);
    // Fin : la patte D est tendue devant (vers nous) bien plus qu'aux claps.
    expect(moy(175, 204, (x) => x.avanceD)).toBeGreaterThan(moy(33, 42, (x) => x.avanceD) + 0.03);
  });

  it("via l'animateur : réaction « serre-main » branchée, une bulle par phase avec son texte, sans saut de pose", () => {
    expect(GESTES["serre-main"]).toBe(serreMain);
    const a = creerAnimateur({ vitesse: 2.4, alea: () => 0.3, graine: 1 });
    const bulles: Array<{ t: number; texte: string; duree: number }> = [];
    let fin = false;
    a.sur((ev) => { if (ev.type === "bulle") bulles.push({ t: a.t, texte: ev.texte, duree: ev.duree }); if (ev.type === "fin") fin = true; });
    const sq = a.corps.sq;
    const suivis = ROLES.filter((r) => !/^(av|ar)[GD]$/.test(GROUPE_DE[r]) && r !== "queue6").map((r) => sq.i[r]);
    for (let k = 0; k < 24; k++) a.maj(1 / FPS);
    expect(a.clic("serre-main")).toBe("lancer");
    const prec = a.pose.q.map((q) => q.clone());
    let max = 0;
    for (let k = 0; k < 14 * FPS && !fin; k++) {
      a.maj(1 / FPS);
      for (const kk of suivis) { max = Math.max(max, a.pose.q[kk].angleTo(prec[kk])); prec[kk].copy(a.pose.q[kk]); }
    }
    expect(fin).toBe(true);
    // Les textes et durées propres à chaque phase (et non 10 fois le même texte jusqu'à la fin du geste).
    expect(bulles.map((b) => b.texte)).toEqual(EVENEMENTS_SERRE_MAIN.map((e) => e.texte));
    bulles.forEach((b, k) => expect(b.duree).toBeCloseTo(EVENEMENTS_SERRE_MAIN[k].duree, 6));
    // Corps, tête, queue : jamais plus de ~8° d'une image à l'autre (60 i/s), entrée et sortie comprises.
    expect(max).toBeLessThan(0.14);
  });

  it("main humaine : 0 avant l'image 156, montée lissée en 0,5 s, 1 jusqu'à la fin du clip, 0 avant 8,2 s", () => {
    // Image 156 (début de la poignée de main) : ≈ 6,15 s. Fin du clip : ≈ 7,75 s.
    expect(DEBUT_MAIN_HUMAINE).toBeCloseTo(ENTREE_SERRE_MAIN + 156 / 30, 6);
    expect(DEBUT_MAIN_HUMAINE).toBeCloseTo(6.15, 2);
    expect(FIN_MAIN_HUMAINE).toBeCloseTo(ENTREE_SERRE_MAIN + DUREE_CLIP_SERRE_MAIN, 6);
    expect(FIN_MAIN_HUMAINE).toBeGreaterThan(7.7);
    for (const t of [-1, 0, 3, 6, 6.1, DEBUT_MAIN_HUMAINE]) expect(poidsMainHumaine(t)).toBe(0);
    // Montée : environ 0,5 s, lissée (pente nulle aux deux bouts), croissante.
    expect(poidsMainHumaine(DEBUT_MAIN_HUMAINE + 0.25)).toBeCloseTo(0.5, 6);
    expect(poidsMainHumaine(DEBUT_MAIN_HUMAINE + 0.02)).toBeLessThan(0.01);
    expect(poidsMainHumaine(DEBUT_MAIN_HUMAINE + 0.5)).toBe(1);
    for (const t of [6.7, 7, 7.5, FIN_MAIN_HUMAINE]) expect(poidsMainHumaine(t)).toBe(1);
    // Descente : 0,4 s au plus, finie avant 8,2 s.
    expect(poidsMainHumaine(FIN_MAIN_HUMAINE + 0.2)).toBeCloseTo(0.5, 6);
    expect(poidsMainHumaine(FIN_MAIN_HUMAINE + 0.4)).toBe(0);
    for (const t of [8.2, 8.5, serreMain.duree, 20]) expect(poidsMainHumaine(t)).toBe(0);
    expect(poidsMainHumaine(Number.NaN)).toBe(0);
    // Sans saut : à 60 i/s, jamais plus de 0,07 d'une image à l'autre (pente max 1,5 / 0,4 s), monotone sur chaque rampe.
    let prec = 0, max = 0;
    for (let k = 0; k <= 10 * 60; k++) {
      const t = k / 60, w = poidsMainHumaine(t);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      if (t < FIN_MAIN_HUMAINE) expect(w).toBeGreaterThanOrEqual(prec - 1e-12);
      else expect(w).toBeLessThanOrEqual(prec + 1e-12);
      max = Math.max(max, Math.abs(w - prec));
      prec = w;
    }
    expect(max).toBeLessThan(0.07);
  });
});
