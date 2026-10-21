import { describe, it, expect } from "vitest";
import { creerAnimateur, type Animateur, type EvenementTigre } from "./animateur";
import { POIDS_REACTIONS, VITESSE_VEXE, TEXTES, type Reaction } from "../tigre-reactions";
import { GROUPE_DE, ROLES } from "./os";

function anim(o: Parameters<typeof creerAnimateur>[0] = {}) {
  const a = creerAnimateur({ vitesse: 2.4, alea: () => 0.3, graine: 1, ...o });
  const evs: Array<EvenementTigre & { t: number }> = [];
  a.sur((e) => evs.push({ ...e, t: a.t }));
  return { a, evs };
}
const avancer = (a: Animateur, s: number, f?: () => void) => { for (let i = 0; i < Math.round(s * 60); i++) { a.maj(1 / 60); f?.(); } };

/**
 * Plus grande rotation d'une image à l'autre (rad) des os du corps, de la tête et de la queue
 * (les pattes, menées par l'allure, sont testées dans corps.test.ts).
 */
function sautMax(a: Animateur, s: number): number {
  const sq = a.corps.sq;
  // Le bout de la queue (6 cm) fouette par nature : exclu, comme les pattes.
  const suivis = ROLES.filter((r) => !/^(av|ar)[GD]$/.test(GROUPE_DE[r]) && r !== "queue6").map((r) => sq.i[r]);
  const prec = a.pose.q.map((q) => q.clone());
  let max = 0;
  avancer(a, s, () => {
    for (const k of suivis) { max = Math.max(max, a.pose.q[k].angleTo(prec[k])); prec[k].copy(a.pose.q[k]); }
  });
  return max;
}

describe("animateur", () => {
  it("regard : il freine, se tourne vers nous, la bulle vient avec le geste, puis il repart", () => {
    const { a, evs } = anim();
    avancer(a, 0.5);
    expect(a.clic("regard")).toBe("lancer");
    expect(a.reaction?.tGeste).toBeNull();
    avancer(a, 2.0);
    expect(Math.abs(a.corps.v)).toBeLessThan(0.05);
    expect(Math.abs(a.cap)).toBeLessThan(0.6);
    const bulle = evs.find((e) => e.type === "bulle");
    expect(bulle && TEXTES.regard.includes((bulle as { texte: string }).texte)).toBe(true);
    avancer(a, 3);
    expect(evs.some((e) => e.type === "fin")).toBe(true);
    expect(a.reaction).toBeNull();
    avancer(a, 2);
    expect(a.corps.v).toBeGreaterThan(1);
    expect(a.cap).toBeCloseTo(Math.PI / 2, 1);
  });

  it("retour rapide : la tête se tourne dès le clic, la bulle d'un geste qui nous répond vient à l'arrêt", () => {
    const { a, evs } = anim();
    avancer(a, 0.5);
    const t0 = a.t;
    a.clic("salut");
    avancer(a, 0.3);
    expect(a.corps.regard.x).toBeGreaterThan(0.5);
    avancer(a, 0.6);
    const bulles = evs.filter((e) => e.type === "bulle");
    expect(bulles.length).toBe(1);
    expect(bulles[0].t - t0).toBeLessThan(0.8);
    expect(a.reaction?.tGeste).toBeNull(); // il se tourne encore vers nous
    avancer(a, 2);
    // La bulle du geste prolonge la première au lieu de la rouvrir.
    const suivantes = evs.filter((e) => e.type === "bulle").slice(1) as Array<{ prolonge?: boolean }>;
    expect(suivantes.length).toBe(1);
    expect(suivantes[0].prolonge).toBe(true);
  });

  it("tape : un second clic donné avant que la patte soit levée est gardé, puis joué (« Clap ! »)", () => {
    const { a, evs } = anim();
    a.clic("tape");
    for (let i = 0; i < 120 && !a.reaction?.bulleDite; i++) a.maj(1 / 60);
    expect(a.reaction?.bulleDite).toBe(true);
    expect(a.clic()).toBe("ignorer");
    avancer(a, 3);
    expect(evs.some((e) => e.type === "particules" && e.genre === "clap")).toBe(true);
  });

  it("un clic pendant une réaction est ignoré", () => {
    const { a } = anim();
    a.clic("ronron");
    avancer(a, 0.3);
    expect(a.clic()).toBe("ignorer");
  });

  it("tape : le second clic n'est pris que patte levée ; sinon il baisse la patte, vexé", () => {
    const { a, evs } = anim();
    a.clic("tape");
    avancer(a, 0.3);
    expect(a.clic()).toBe("ignorer");
    avancer(a, 6);
    const textes = evs.filter((e) => e.type === "bulle").map((e) => (e as { texte: string }).texte);
    expect(textes.some((t) => TEXTES.vexe.includes(t))).toBe(true);
    const fin = evs.find((e) => e.type === "fin") as { vitesse?: number } | undefined;
    expect(fin?.vitesse).toBe(VITESSE_VEXE);
  });

  it("tape réussie : « Clap ! » et particules", () => {
    const { a, evs } = anim();
    a.clic("tape");
    let tape = "ignorer";
    for (let i = 0; i < 300 && tape !== "taper"; i++) { a.maj(1 / 60); if (a.reaction?.tGeste != null && a.t - a.reaction.tGeste > 0.9) tape = a.clic(); }
    expect(tape).toBe("taper");
    expect(evs.some((e) => e.type === "particules" && e.genre === "clap")).toBe(true);
  });

  it("sursaut : il fait demi-tour et file à l'éclair dans l'autre sens", () => {
    const { a, evs } = anim();
    avancer(a, 0.3);
    a.clic("sursaut");
    avancer(a, 1);
    expect(evs.find((e) => e.type === "fuite")).toMatchObject({ sens: -1 });
    expect(a.sens).toBe(-1);
    expect(a.mode).toBe("eclair");
    avancer(a, 2);
    expect(a.corps.v).toBeLessThan(-1);
  });

  it("saut : il ne s'arrête pas", () => {
    const { a } = anim();
    avancer(a, 0.3);
    a.clic("saut");
    let vmin = Infinity;
    avancer(a, 0.9, () => { vmin = Math.min(vmin, a.corps.v); });
    expect(vmin).toBeGreaterThan(1.5);
  });

  it("aucune réaction ne fait sauter la pose : entrées et sorties par ressorts", () => {
    const { a } = anim();
    const course = sautMax(a, 1.5);
    for (const [nom] of POIDS_REACTIONS) {
      const { a: b } = anim();
      avancer(b, 0.4);
      b.clic(nom as Reaction);
      const max = sautMax(b, 6);
      // Corps, tête, queue : jamais plus de ~8° d'une image à l'autre (60 i/s), entrée et sortie comprises.
      expect(max, nom).toBeLessThan(Math.max(0.14, course * 1.3));
    }
  });

  it("le pas de temps est plafonné : un onglet qui reprend ne fait pas bondir le tigre", () => {
    const { a } = anim();
    const x = a.corps.x;
    a.maj(5);
    expect(a.corps.x - x).toBeLessThan(0.5);
  });
});
