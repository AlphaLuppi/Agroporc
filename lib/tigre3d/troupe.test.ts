import { Vector3 } from "three";
import { describe, it, expect } from "vitest";
import { creerTroupe, etendueTroupe, type OptionsTroupe } from "./troupe";
import { ECHELLE_PETIT } from "../tigre-courant";

const base: OptionsTroupe = {
  evenement: "normal", petits: 0, sens: 1, vitesse: 2.4,
  largeurEcran: 1440, largeurTigrePx: 200, pxParMetre: 200 / 3.75, alea: () => 0.5,
};

/** Fait avancer la troupe à 60 i/s jusqu'à sa sortie (plafond de sécurité) ; retourne la durée simulée. */
function jusquaLaSortie(t: ReturnType<typeof creerTroupe>, plafondS = 60) {
  let s = 0;
  while (!t.termine && s < plafondS) { t.maj(1 / 60); s += 1 / 60; }
  return s;
}

describe("troupe", () => {
  it("part hors champ du côté de l'entrée et traverse en un temps cohérent avec la vitesse", () => {
    const t = creerTroupe(base);
    expect(t.mere.x).toBeLessThan(0);
    const s = jusquaLaSortie(t);
    expect(t.termine).toBe(true);
    // (écran + longueur du tigre) / (vitesse × largeur), à la louche
    const attendu = (1440 + 2 * 2.3 * (200 / 3.75)) / (2.4 * 200);
    expect(s).toBeGreaterThan(attendu * 0.8);
    expect(s).toBeLessThan(attendu * 1.3);
  });

  it("de droite à gauche : entre par la droite et sort par la gauche", () => {
    const t = creerTroupe({ ...base, sens: -1 });
    expect(t.mere.x).toBeGreaterThan(1440);
    jusquaLaSortie(t);
    expect(t.termine).toBe(true);
    expect(t.mere.x).toBeLessThan(0);
  });

  it("la vitesse de déplacement est proportionnelle à la vitesse demandée", () => {
    const lent = creerTroupe({ ...base, vitesse: 1.6 }), vif = creerTroupe({ ...base, vitesse: 3.2 });
    for (let i = 0; i < 30; i++) { lent.maj(1 / 60); vif.maj(1 / 60); }
    const dl = lent.mere.x - creerTroupe({ ...base, vitesse: 1.6 }).mere.x;
    const dv = vif.mere.x - creerTroupe({ ...base, vitesse: 3.2 }).mere.x;
    expect(dv / dl).toBeCloseTo(2, 1);
  });

  it("le déplacement ne dépend pas du framerate", () => {
    const a = creerTroupe(base), b = creerTroupe(base);
    for (let i = 0; i < 60; i++) a.maj(1 / 60);
    for (let i = 0; i < 144; i++) b.maj(1 / 144);
    expect(Math.abs(a.mere.x - b.mere.x)).toBeLessThan(6);
  });

  it("pendant un regard, la mère s'arrête puis repart", () => {
    const t = creerTroupe(base);
    for (let i = 0; i < 90; i++) t.maj(1 / 60);
    t.mere.anim.clic("regard");
    for (let i = 0; i < 60; i++) t.maj(1 / 60);
    const x = t.mere.x;
    for (let i = 0; i < 20; i++) t.maj(1 / 60);
    expect(t.mere.anim.reaction).not.toBeNull();
    expect(Math.abs(t.mere.x - x)).toBeLessThan(15);
    jusquaLaSortie(t);
    expect(t.termine).toBe(true);
  });

  it("le sursaut retourne tout le monde sur place et il ressort du côté d'entrée", () => {
    const t = creerTroupe({ ...base, evenement: "famille", petits: 3, vitesse: 2 });
    for (let i = 0; i < 100; i++) t.maj(1 / 60);
    const xAvant = t.mere.x;
    t.mere.anim.clic("sursaut");
    // Le demi-tour se fait en l'air (volte-face du geste), la fuite part à la réception.
    for (let i = 0; i < 70; i++) t.maj(1 / 60);
    expect(t.mere.anim.sens).toBe(-1);
    for (const m of t.membres) expect(m.anim.sens).toBe(-1);
    // pas de téléportation : la mère n'a pas bougé de plus de ce qu'une demi-seconde de course permet
    expect(Math.abs(t.mere.x - xAvant)).toBeLessThan(600);
    jusquaLaSortie(t);
    expect(t.termine).toBe(true);
    expect(Math.max(...t.membres.map((m) => m.x))).toBeLessThan(0);
  });

  it("les petits suivent la mère à distance fixe, derrière elle", () => {
    const t = creerTroupe({ ...base, evenement: "famille", petits: 3 });
    const ecarts = t.membres.slice(1).map((p) => t.mere.x - p.x);
    for (let i = 0; i < 120; i++) t.maj(1 / 60);
    t.membres.slice(1).forEach((p, i) => expect(t.mere.x - p.x).toBeCloseTo(ecarts[i], 4));
    expect(ecarts.every((e) => e > 0)).toBe(true);
    expect(ecarts).toEqual([...ecarts].sort((a, b) => a - b));
  });

  it("la famille compte la mère et ses petits à l'échelle ECHELLE_PETIT", () => {
    const t = creerTroupe({ ...base, evenement: "famille", petits: 4 });
    expect(t.membres).toHaveLength(5);
    expect(t.membres.slice(1).every((m) => m.echelle === ECHELLE_PETIT)).toBe(true);
    expect(etendueTroupe(4).derriere).toBeGreaterThan(etendueTroupe(2).derriere);
  });

  it("les petits se figent quand la mère réagit à l'arrêt", () => {
    const t = creerTroupe({ ...base, evenement: "famille", petits: 2 });
    for (let i = 0; i < 100; i++) t.maj(1 / 60);
    t.mere.anim.clic("regard");
    for (let i = 0; i < 60; i++) t.maj(1 / 60);
    expect(t.membres[1].anim.figee).toBe(true);
  });

  it("le centre de la troupe est entre ses extrêmes", () => {
    const t = creerTroupe({ ...base, evenement: "famille", petits: 3 });
    const xs = t.membres.map((m) => m.x);
    expect(t.centre()).toBeGreaterThanOrEqual(Math.min(...xs));
    expect(t.centre()).toBeLessThanOrEqual(Math.max(...xs));
    expect(t.largeur()).toBeGreaterThan(Math.max(...xs) - Math.min(...xs));
  });

  it("le sursaut ne téléporte pas les petits : leur cap varie par petits pas", () => {
    const t = creerTroupe({ ...base, evenement: "famille", petits: 3, vitesse: 2 });
    for (let i = 0; i < 90; i++) t.maj(1 / 60);
    t.mere.anim.clic("sursaut");
    // Cap VISUEL (racine posée) : la mère tourne en l'air par le lacet de son geste, reporté
    // ensuite sur ses caps (volte-face) ; ce qui compte est ce qu'on voit, image par image.
    const capVisuel = (m: (typeof t.membres)[number]) => {
      const sq = m.anim.corps.sq, k = sq.i.racine;
      const q = m.anim.corps.monde.q[k].clone().multiply(sq.qModele[k].clone().invert());
      const v = new Vector3(0, 0, 1).applyQuaternion(q);
      return Math.atan2(v.x, v.z);
    };
    const yaw = t.membres.map(capVisuel);
    let max = 0;
    for (let i = 0; i < 240; i++) {
      t.maj(1 / 60);
      t.membres.forEach((m, j) => {
        const y = capVisuel(m);
        let d = Math.abs(y - yaw[j]) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        max = Math.max(max, d);
        yaw[j] = y;
      });
    }
    expect(t.membres.slice(1).every((m) => m.anim.sens === -1)).toBe(true);
    // Pas de tourelle : au plus ~0,15 rad par image à 60 i/s (demi-tour en piétinant).
    expect(max).toBeLessThan(0.15);
  });

  it("cliquée à peine entrée, la mère se recentre : elle reste entière à l'écran pendant sa réaction", () => {
    for (const sens of [1, -1] as const) {
      const t = creerTroupe({ ...base, sens });
      for (let i = 0; i < 20; i++) t.maj(1 / 60);
      t.mere.anim.clic("regard");
      for (let i = 0; i < 80; i++) t.maj(1 / 60);
      const marge = 1.5 * (200 / 3.75);
      expect(t.mere.anim.reaction).not.toBeNull();
      expect(t.mere.x).toBeGreaterThan(marge - 20);
      expect(t.mere.x).toBeLessThan(1440 - marge + 20);
    }
  });

  it("freinée près de la sortie, la mère revient au pas et reste entière à l'écran pendant son geste", () => {
    const t = creerTroupe({ ...base, vitesse: 3.4 });
    while (t.mere.x < 1440 - 60) t.maj(1 / 60);
    t.mere.anim.clic("tape");
    let s = 0;
    while (t.mere.anim.reaction?.tGeste == null && s < 6) { t.maj(1 / 60); s += 1 / 60; }
    expect(t.mere.anim.reaction?.tGeste).not.toBeNull();
    expect(t.mere.x).toBeLessThan(1440 - 1.5 * (200 / 3.75) + 20);
  });
});
