/**
 * Couche de pose sur le vrai squelette du GLB : ce que l'on verrait à l'écran (positions des
 * os après IK et visée), mesuré en Node.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Quaternion, Vector3 } from "three";
import { extraireSquelette } from "../tigre3d/extraction.mjs";
import { creerSquelette } from "./squelette";
import { creerPoseur } from "./pose";
import { creerCourse, MESURES } from "./course";
import { COTES, cleOs, deCote, type Cote } from "./os";

const sq = creerSquelette(extraireSquelette(readFileSync("public/macron/macron.glb")).os);
const DT = 1 / 120;
const os = (r: Parameters<typeof deCote>[0], c: Cote) => sq.i[deCote(r, c)];
const angle = (a: Vector3, b: Vector3, c: Vector3) =>
  180 - (a.clone().sub(b).angleTo(c.clone().sub(b)) * 180) / Math.PI;

/** Talon du modèle (pivot d'appui) exprimé dans le repère local de l'os du pied, au repos. */
function talonLocal(c: Cote) {
  const k = os("pied", c);
  const versPlante = sq.pM[os("orteils", c)].clone().sub(sq.pM[k]);
  const f = new Vector3(versPlante.x, 0, versPlante.z).normalize();
  const talon = sq.pM[k].clone().addScaledVector(f, -MESURES.talon.arriere).add(new Vector3(0, -MESURES.talon.bas, 0));
  return talon.sub(sq.pM[k]).applyQuaternion(sq.qM[k].clone().invert());
}

describe("pose du coureur (squelette du GLB)", () => {
  const P = creerPoseur(sq);
  const course = creerCourse({ graine: 11 });
  const mesures = {
    glissePlante: 0, glisseTalon: 0, manqueIK: 0, genouAppuiMin: 180, genouAppuiMax: 0, genouVolMax: 0,
    coudeMin: 180, coudeMax: 0, solMin: 1, teteVar: 0, thoraxVar: 0,
  };
  const prec: Record<Cote, { plante: Vector3 | null; talon: Vector3 | null }> = { G: { plante: null, talon: null }, D: { plante: null, talon: null } };
  const tl = { G: talonLocal("G"), D: talonLocal("D") };
  let tete0: Quaternion | null = null, thorax0: Quaternion | null = null;

  for (let k = 0; k < 3 / DT; k++) {
    course.avancer(DT);
    const it = course.etat();
    P.poser(it);
    const m = P.monde;
    for (const c of COTES) {
      const p = it.pieds[c];
      mesures.manqueIK = Math.max(mesures.manqueIK, P.portee[c].demande - P.portee[c].atteinte);
      const plante = m.p[os("orteils", c)];
      const talon = tl[c].clone().applyQuaternion(m.q[os("pied", c)]).add(m.p[os("pied", c)]);
      if (p.plante && prec[c].plante) mesures.glissePlante = Math.max(mesures.glissePlante, plante.distanceTo(prec[c].plante!));
      if (p.talon && prec[c].talon) mesures.glisseTalon = Math.max(mesures.glisseTalon, talon.distanceTo(prec[c].talon!));
      prec[c].plante = p.plante ? plante.clone() : null;
      prec[c].talon = p.talon ? talon.clone() : null;
      const g = angle(m.p[os("cuisse", c)], m.p[os("tibia", c)], m.p[os("pied", c)]);
      if (p.appui) { mesures.genouAppuiMin = Math.min(mesures.genouAppuiMin, g); mesures.genouAppuiMax = Math.max(mesures.genouAppuiMax, g); }
      else mesures.genouVolMax = Math.max(mesures.genouVolMax, g);
      const coude = angle(m.p[os("bras", c)], m.p[os("avantBras", c)], m.p[os("main", c)]);
      mesures.coudeMin = Math.min(mesures.coudeMin, coude);
      mesures.coudeMax = Math.max(mesures.coudeMax, coude);
      mesures.solMin = Math.min(mesures.solMin, m.p[os("boutPied", c)].y, m.p[os("orteils", c)].y);
    }
    tete0 ??= m.q[sq.i.tete].clone();
    thorax0 ??= m.q[sq.i.dos3].clone();
    mesures.teteVar = Math.max(mesures.teteVar, m.q[sq.i.tete].angleTo(tete0));
    mesures.thoraxVar = Math.max(mesures.thoraxVar, m.q[sq.i.dos3].angleTo(thorax0));
  }

  it("pieds verrouillés sur le vrai maillage : plante et talon immobiles pendant l'appui (< 0,1 mm par image)", () => {
    expect(mesures.glissePlante).toBeLessThan(1e-4);
    expect(mesures.glisseTalon).toBeLessThan(1e-4);
  });

  it("l'IK atteint toujours sa cible (aucune jambe trop courte, donc aucun glissement caché)", () => {
    expect(mesures.manqueIK).toBeLessThan(1e-4);
  });

  it("genou fléchi à l'appui (amorti), très fléchi au vol (talon vers la fesse), jamais en hyperextension", () => {
    expect(mesures.genouAppuiMin).toBeGreaterThan(12);
    expect(mesures.genouAppuiMax).toBeGreaterThan(35);
    expect(mesures.genouAppuiMax).toBeLessThan(50);
    expect(mesures.genouVolMax).toBeGreaterThan(85);
  });

  it("coudes fléchis autour de 90°, orteils jamais sous le sol, tête plus stable que le buste", () => {
    expect(mesures.coudeMin).toBeGreaterThan(65);
    expect(mesures.coudeMax).toBeLessThan(115);
    expect(mesures.solMin).toBeGreaterThan(0.02);
    expect(mesures.teteVar).toBeLessThan(mesures.thoraxVar);
  });

  it("le genou plie vers l'avant et la main avant reste à hauteur de poitrine, poing fermé", () => {
    course.avancer(0.2);
    const it = course.etat();
    P.poser(it);
    const m = P.monde;
    for (const c of COTES) {
      const h = m.p[os("cuisse", c)], g = m.p[os("tibia", c)], ch = m.p[os("pied", c)];
      // Le genou est devant la droite hanche → cheville.
      const t = g.clone().sub(h).dot(ch.clone().sub(h).normalize());
      const surLigne = h.clone().add(ch.clone().sub(h).normalize().multiplyScalar(t));
      expect(g.z - surLigne.z).toBeGreaterThan(0);
      const main = m.p[os("main", c)];
      expect(main.y).toBeGreaterThan(0.85);
      expect(main.y).toBeLessThan(1.35);
      // Poing : le bout du majeur revient près de la paume.
      const k3 = sq.i[`majeur3${c}`];
      expect(m.p[k3].distanceTo(main)).toBeLessThan(sq.pM[k3].distanceTo(sq.pM[os("main", c)]) - 0.015);
      // Poing léger, pas une griffe : le pouce se pose contre la phalange moyenne de l'index et
      // les bouts des doigts se rapprochent (doigts serrés).
      const bout = (d: string) => sq.noms.findIndex((n) => cleOs(n) === `${c === "G" ? "Left" : "Right"}Hand${d}4`);
      const milieuIndex = m.p[os("index2", c)].clone().lerp(m.p[os("index3", c)], 0.5);
      expect(m.p[bout("Thumb")].distanceTo(milieuIndex)).toBeLessThan(0.025);
      const ecartBouts = (p: Vector3[]) => p[bout("Index")].distanceTo(p[bout("Pinky")]);
      expect(ecartBouts(m.p)).toBeLessThan(ecartBouts(sq.pM) * 0.85);
    }
  });

  it("la main qui recule passe à côté de la veste (jamais dans la hanche)", () => {
    const c2 = creerCourse({ graine: 5 });
    const P2 = creerPoseur(sq);
    let min = 1;
    for (let k = 0; k < 2 / DT; k++) {
      c2.avancer(DT);
      const it = c2.etat();
      P2.poser(it);
      const b = P2.monde.p[sq.i.bassin];
      for (const c of COTES) {
        const main = P2.monde.p[os("main", c)];
        if (main.y < 1.1 && main.z < b.z) min = Math.min(min, Math.abs(main.x - b.x));
      }
    }
    expect(min).toBeGreaterThan(0.17);
  });

  it("aucun à-coup au contact : la vitesse du genou et de la cheville est continue", () => {
    const c2 = creerCourse({ graine: 3, phase: 0.9 });
    const P2 = creerPoseur(sq);
    const h = 1 / 4000;
    const prec: Record<string, Vector3 | null> = { g: null, ch: null };
    const vPrec: Record<string, Vector3 | null> = { g: null, ch: null };
    const saut = { g: -1, ch: -1 };
    let appuiPrec = false;
    for (let k = 0; k < 2000 && saut.g < 0; k++) {
      c2.avancer(h);
      const it = c2.etat();
      P2.poser(it);
      const pos = { g: P2.monde.p[os("tibia", "G")].clone(), ch: P2.monde.p[os("pied", "G")].clone() };
      for (const r of ["g", "ch"] as const) {
        if (prec[r]) {
          const v = pos[r].clone().sub(prec[r]!).divideScalar(h);
          if (vPrec[r] && it.pieds.G.appui && !appuiPrec) saut[r] = v.distanceTo(vPrec[r]!);
          vPrec[r] = v;
        }
        prec[r] = pos[r];
      }
      appuiPrec = it.pieds.G.appui;
    }
    expect(saut.g).toBeGreaterThanOrEqual(0);
    expect(saut.g).toBeLessThan(0.1);
    expect(saut.ch).toBeLessThan(0.1);
  });
});

describe("bras levé (pris au lasso par le poignet)", () => {
  it("poignet au-dessus du sommet du crâne, coude tendu, l'autre bras court toujours", () => {
    const P = creerPoseur(sq);
    const course = creerCourse({ graine: 5 });
    for (let k = 0; k < 60; k++) course.avancer(DT);
    const it = course.etat();
    P.poser(it, undefined, { cote: "D", poids: 1 });
    const m = P.monde;
    const sommet = m.p[sq.i.sommet];
    const main = m.p[os("main", "D")].clone(), coude = m.p[os("avantBras", "D")].clone(), epaule = m.p[os("bras", "D")].clone();
    expect(main.y).toBeGreaterThan(sommet.y + 0.1);
    expect(angle(epaule, coude, main)).toBeLessThan(8);
    // Le bras gauche n'est pas levé : sa main reste sous l'épaule.
    expect(m.p[os("main", "G")].y).toBeLessThan(m.p[os("bras", "G")].y);
    // À mi-geste, la main est entre les deux.
    P.poser(it, undefined, { cote: "D", poids: 0.5 });
    const mi = P.monde.p[os("main", "D")].y;
    P.poser(it);
    expect(mi).toBeGreaterThan(P.monde.p[os("main", "D")].y);
    expect(mi).toBeLessThan(main.y);
  });
});
