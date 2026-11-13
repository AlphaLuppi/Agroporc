import { describe, expect, it, vi } from "vitest";
import { LIAISONS_DEFAUT, LIAISONS_MANETTE_DEFAUT, REGLAGES_DEFAUT, type LiaisonsManette, type LiaisonsTouches } from "./contrat";
import {
  manetteDepuisGamepad,
  manetteStandard,
  pauseDepuisManette,
  BOUTON_MANETTE,
  RAYON_REGARD_SOURIS_PX,
  creerSourceEntrees,
  entreesDepuisClavier,
  entreesDepuisManette,
  entreesJoueurNulles,
  fusionnerEntrees,
  stickAvecZoneMorte,
  type ManetteLue,
} from "./entrees";

const clavier = (codes: string[], depl: [number, number] = [0, 0]) => entreesDepuisClavier({ touches: new Set(codes), deplacementSouris: depl }, LIAISONS_DEFAUT);

function manette(opts: { axes?: number[]; boutons?: Record<number, number | boolean> } = {}) {
  const boutons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const [i, v] of Object.entries(opts.boutons ?? {})) boutons[Number(i)] = typeof v === "boolean" ? { pressed: v, value: v ? 1 : 0 } : { pressed: v > 0.5, value: v };
  return { axes: opts.axes ?? [0, 0, 0, 0], boutons };
}
const REGL = { zoneMorteManette: 0.12, inverserTangageManette: false };

describe("clavier : positions physiques", () => {
  it("rien d'enfoncé : entrées nulles", () => {
    expect(clavier([])).toEqual(entreesJoueurNulles());
  });
  it("W accélère, S recule, et les flèches font pareil", () => {
    expect(clavier(["KeyW"]).voiture.accel).toBe(1);
    expect(clavier(["ArrowUp"]).voiture.accel).toBe(1);
    expect(clavier(["KeyS"]).voiture.accel).toBe(-1);
    expect(clavier(["ArrowDown"]).voiture.accel).toBe(-1);
  });
  it("les codes sont des positions : KeyW est la touche Z d'un clavier AZERTY, aucune lettre n'est lue", () => {
    // un clavier AZERTY envoie code "KeyW" pour la touche étiquetée Z : le jeu ne regarde jamais `key`
    expect(clavier(["KeyZ"]).voiture.accel).toBe(0);
    expect(clavier(["KeyW"]).voiture.accel).toBe(1);
  });
  it("deux touches opposées s'annulent", () => {
    expect(clavier(["KeyW", "KeyS"]).voiture.accel).toBe(0);
    expect(clavier(["KeyA", "KeyD"]).voiture.direction).toBe(0);
    expect(clavier(["KeyQ", "KeyE"]).voiture.roulis).toBe(0);
  });
  it("signes : droite = +1, gauche = -1 ; E penche à droite ; en l'air S = nez en haut (tangage +1), W = nez en bas", () => {
    expect(clavier(["KeyD"]).voiture.direction).toBe(1);
    expect(clavier(["ArrowLeft"]).voiture.direction).toBe(-1);
    expect(clavier(["KeyE"]).voiture.roulis).toBe(1);
    expect(clavier(["KeyQ"]).voiture.roulis).toBe(-1);
    expect(clavier(["KeyS"]).voiture.tangage).toBe(1);
    expect(clavier(["KeyW"]).voiture.tangage).toBe(-1);
  });
  it("boutons : saut Espace, boost Maj ou clic gauche, dérapage C ou Ctrl", () => {
    expect(clavier(["Space"]).voiture.saut).toBe(true);
    expect(clavier(["ShiftLeft"]).voiture.boost).toBe(true);
    expect(clavier(["Souris0"]).voiture.boost).toBe(true);
    expect(clavier(["KeyC"]).voiture.derapage).toBe(true);
    expect(clavier(["ControlLeft"]).voiture.derapage).toBe(true);
    expect(clavier(["KeyA"]).voiture.saut).toBe(false);
  });
  it("caméra et divers : ball cam (Y ou clic droit), vue arrière V, klaxon H, pause Échap", () => {
    expect(clavier(["KeyY"]).basculerBalleCam).toBe(true);
    expect(clavier(["Souris2"]).basculerBalleCam).toBe(true);
    expect(clavier(["KeyV"]).arriere).toBe(true);
    expect(clavier(["KeyH"]).klaxon).toBe(true);
    expect(clavier(["Escape"]).pause).toBe(true);
  });
  it("les liaisons personnalisées sont suivies", () => {
    const l: LiaisonsTouches = { ...LIAISONS_DEFAUT, saut: ["KeyJ"], boost: ["KeyK"] };
    const e = entreesDepuisClavier({ touches: new Set(["KeyJ", "KeyK", "Space"]), deplacementSouris: [0, 0] }, l);
    expect(e.voiture.saut).toBe(true);
    expect(e.voiture.boost).toBe(true);
    expect(entreesDepuisClavier({ touches: new Set(["Space"]), deplacementSouris: [0, 0] }, l).voiture.saut).toBe(false);
  });
  it("regard libre : seulement avec le bouton du milieu, borné à [-1, 1], haut de l'écran = regarder en haut", () => {
    expect(clavier([], [100, 0]).regard).toEqual([0, 0]);
    expect(clavier(["Souris1"], [RAYON_REGARD_SOURIS_PX / 2, 0]).regard[0]).toBeCloseTo(0.5, 6);
    expect(clavier(["Souris1"], [10 * RAYON_REGARD_SOURIS_PX, 0]).regard[0]).toBe(1);
    expect(clavier(["Souris1"], [0, -RAYON_REGARD_SOURIS_PX]).regard[1]).toBe(1);
  });
});

describe("manette", () => {
  it("zone morte radiale : rien sous le seuil, direction conservée au-delà, courbe quadratique, plein à fond", () => {
    expect(stickAvecZoneMorte(0.1, 0.05, 0.12)).toEqual([0, 0]);
    const [x, y] = stickAvecZoneMorte(0.6, 0.3, 0.12);
    expect(y / x).toBeCloseTo(0.5, 6);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(0.6);
    const [px, py] = stickAvecZoneMorte(1, 0, 0.12);
    expect(px).toBeCloseTo(1, 6);
    expect(py).toBe(0);
    // quadratique : la moitié de la course utile donne un quart
    const mi = stickAvecZoneMorte(0.12 + 0.88 * 0.5, 0, 0.12)[0];
    expect(mi).toBeCloseTo(0.25 * 1, 2);
    expect(stickAvecZoneMorte(0.7071, 0.7071, 0.12)[0]).toBeLessThanOrEqual(1);
  });
  it("gâchettes analogiques : RT - LT", () => {
    expect(entreesDepuisManette(manette({ boutons: { 7: 0.6 } }), REGL).voiture.accel).toBeCloseTo(0.6, 6);
    expect(entreesDepuisManette(manette({ boutons: { 6: 1 } }), REGL).voiture.accel).toBe(-1);
    expect(entreesDepuisManette(manette({ boutons: { 7: 0.5, 6: 0.5 } }), REGL).voiture.accel).toBeCloseTo(0, 6);
  });
  it("un bouton numérique (pressed sans value) compte pour 1", () => {
    const m = manette();
    m.boutons[7] = { pressed: true, value: 0 };
    expect(entreesDepuisManette(m, REGL).voiture.accel).toBe(1);
  });
  it("stick gauche : volant et tangage (haut du stick = nez en bas, comme RL) ; l'inversion retourne le tangage", () => {
    const e = entreesDepuisManette(manette({ axes: [0.8, -0.6, 0, 0] }), REGL);
    expect(e.voiture.direction).toBeGreaterThan(0.3);
    expect(e.voiture.tangage).toBeLessThan(-0.1);
    expect(entreesDepuisManette(manette({ axes: [1, 0, 0, 0] }), REGL).voiture.direction).toBeCloseTo(1, 6);
    // diagonale pleine : la direction est conservée et l'amplitude plafonnée à 1
    const d = entreesDepuisManette(manette({ axes: [1, -1, 0, 0] }), REGL).voiture;
    expect(Math.hypot(d.direction, d.tangage)).toBeLessThanOrEqual(1 + 1e-9);
    const inv = entreesDepuisManette(manette({ axes: [0, -1, 0, 0] }), { ...REGL, inverserTangageManette: true });
    expect(inv.voiture.tangage).toBeGreaterThan(0);
  });
  it("boutons : A saut, B boost, X dérapage, Y ball cam, LB/RB roulis, R3 arrière, Start pause, L3 klaxon", () => {
    const e = entreesDepuisManette(manette({ boutons: { [BOUTON_MANETTE.a]: true, [BOUTON_MANETTE.b]: true, [BOUTON_MANETTE.x]: true, [BOUTON_MANETTE.y]: true, [BOUTON_MANETTE.rb]: true, [BOUTON_MANETTE.r3]: true, [BOUTON_MANETTE.start]: true, [BOUTON_MANETTE.l3]: true } }), REGL);
    expect(e.voiture).toMatchObject({ saut: true, boost: true, derapage: true, roulis: 1 });
    expect(e).toMatchObject({ basculerBalleCam: true, arriere: true, pause: true, klaxon: true });
    expect(entreesDepuisManette(manette({ boutons: { [BOUTON_MANETTE.lb]: true } }), REGL).voiture.roulis).toBe(-1);
  });
  it("stick droit : regard libre, haut = regarder en haut", () => {
    const droite = entreesDepuisManette(manette({ axes: [0, 0, 1, 0] }), REGL);
    expect(droite.regard[0]).toBeCloseTo(1, 6);
    const haut = entreesDepuisManette(manette({ axes: [0, 0, 0, -1] }), REGL);
    expect(haut.regard[1]).toBeCloseTo(1, 6);
  });
  it("axes manquants ou NaN : jamais de NaN", () => {
    const e = entreesDepuisManette({ axes: [NaN], boutons: [] }, REGL);
    expect(Object.values(e.voiture).every((v) => typeof v === "boolean" || Number.isFinite(v))).toBe(true);
    expect(e.regard.every(Number.isFinite)).toBe(true);
  });
});

/** Manette avec liaisons du joueur (les autres champs gardent les défauts). */
const avec = (m: ReturnType<typeof manette>, liaisons: Partial<LiaisonsManette>, r = REGL) => entreesDepuisManette(m, r, { ...LIAISONS_MANETTE_DEFAUT, ...liaisons });

describe("manette : liaisons du joueur", () => {
  it("sans liaisons passées, la disposition par défaut de Rocket League est celle d'avant", () => {
    const m = manette({ axes: [0.8, -0.6, 0.5, -0.5], boutons: { 7: 0.6, [BOUTON_MANETTE.a]: true } });
    expect(entreesDepuisManette(m, REGL)).toEqual(entreesDepuisManette(m, REGL, LIAISONS_MANETTE_DEFAUT));
    expect(entreesDepuisManette(m, REGL).voiture.saut).toBe(true);
  });
  it("gaz sur A, saut sur RB, boost sur une gâchette", () => {
    const l: Partial<LiaisonsManette> = { accelerer: ["B0"], saut: ["B5"], boost: ["B7"], reculer: ["B1"] };
    expect(avec(manette({ boutons: { 0: true } }), l).voiture.accel).toBe(1);
    expect(avec(manette({ boutons: { 1: true } }), l).voiture.accel).toBe(-1);
    // l'ancien RT ne fait plus le gaz, il fait le boost
    const rt = avec(manette({ boutons: { 7: 0.9 } }), l).voiture;
    expect(rt.accel).toBe(0);
    expect(rt.boost).toBe(true);
    expect(avec(manette({ boutons: { 5: true } }), l).voiture.saut).toBe(true);
    expect(avec(manette({ boutons: { 0: true } }), l).voiture.saut).toBe(false);
  });
  it("une gâchette garde sa course analogique sur le gaz, un bouton binaire vaut 0 ou 1", () => {
    expect(avec(manette({ boutons: { 6: 0.4 } }), { accelerer: ["B6"], reculer: [] }).voiture.accel).toBeCloseTo(0.4, 6);
    expect(avec(manette({ boutons: { 2: true } }), { accelerer: ["B2"], reculer: [] }).voiture.accel).toBe(1);
  });
  it("volant sur le stick droit : zone morte et courbe conservées, l'autre stick n'a plus d'effet sur le volant", () => {
    const l: Partial<LiaisonsManette> = { gauche: ["A2-"], droite: ["A2+"] };
    expect(avec(manette({ axes: [0, 0, 0.1, 0] }), l).voiture.direction).toBe(0);
    const d = avec(manette({ axes: [0, 0, 0.6, 0] }), l).voiture.direction;
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(0.6);
    expect(avec(manette({ axes: [0, 0, -1, 0] }), l).voiture.direction).toBeCloseTo(-1, 6);
    expect(avec(manette({ axes: [1, 0, 0, 0] }), l).voiture.direction).toBe(0);
  });
  it("une direction poussée à la diagonale reste à la même amplitude que par défaut (zone morte radiale)", () => {
    const m = manette({ axes: [0.7071, -0.7071, 0, 0] });
    const defaut = entreesDepuisManette(m, REGL).voiture;
    expect(Math.hypot(defaut.direction, defaut.tangage)).toBeLessThanOrEqual(1 + 1e-9);
  });
  it("un demi-axe sur une action à deux états se déclenche à mi-course (axe brut, hors zone morte)", () => {
    const l: Partial<LiaisonsManette> = { boost: ["A1-"], saut: ["A3+"] };
    expect(avec(manette({ axes: [0, -0.4, 0, 0] }), l).voiture.boost).toBe(false);
    expect(avec(manette({ axes: [0, -0.5, 0, 0] }), l).voiture.boost).toBe(true);
    expect(avec(manette({ axes: [0, 0.9, 0, 0] }), l).voiture.boost).toBe(false);
    expect(avec(manette({ axes: [0, 0, 0, 0.8] }), l).voiture.saut).toBe(true);
    // zone morte large : le seuil ne dépend pas d'elle
    expect(avec(manette({ axes: [0, -0.55, 0, 0] }), l, { ...REGL, zoneMorteManette: 0.4 }).voiture.boost).toBe(true);
  });
  it("un bouton sur un axe analogique : 0 ou 1 (volant sur la croix)", () => {
    const l: Partial<LiaisonsManette> = { gauche: ["B14"], droite: ["B15"] };
    expect(avec(manette({ boutons: { 15: true } }), l).voiture.direction).toBe(1);
    expect(avec(manette({ boutons: { 14: true } }), l).voiture.direction).toBe(-1);
    expect(avec(manette({ boutons: { 14: true, 15: true } }), l).voiture.direction).toBe(0);
  });
  it("tangage : nez en haut / en bas sur ce qu'on veut, et l'inversion marche toujours", () => {
    const l: Partial<LiaisonsManette> = { tangageHaut: ["B12"], tangageBas: ["B13"] };
    expect(avec(manette({ boutons: { 12: true } }), l).voiture.tangage).toBe(1);
    expect(avec(manette({ boutons: { 13: true } }), l).voiture.tangage).toBe(-1);
    expect(avec(manette({ boutons: { 12: true } }), l, { ...REGL, inverserTangageManette: true }).voiture.tangage).toBe(-1);
    // le stick n'agit plus sur le tangage
    expect(avec(manette({ axes: [0, 1, 0, 0] }), l).voiture.tangage).toBe(0);
  });
  it("roulis, dérapage, ball cam, vue arrière, klaxon : reliés où l'on veut", () => {
    const l: Partial<LiaisonsManette> = { rouleGauche: ["B14"], rouleDroite: ["B15"], derapage: ["B6"], balleCam: ["B10"], arriere: ["B8"], klaxon: ["B0"] };
    expect(avec(manette({ boutons: { 15: true } }), l).voiture.roulis).toBe(1);
    expect(avec(manette({ boutons: { 14: true } }), l).voiture.roulis).toBe(-1);
    expect(avec(manette({ boutons: { 4: true, 5: true } }), l).voiture.roulis).toBe(0);
    expect(avec(manette({ boutons: { 6: 1 } }), l).voiture.derapage).toBe(true);
    expect(avec(manette({ boutons: { 10: true } }), l).basculerBalleCam).toBe(true);
    expect(avec(manette({ boutons: { 8: true } }), l).arriere).toBe(true);
    expect(avec(manette({ boutons: { 0: true } }), l).klaxon).toBe(true);
    expect(avec(manette({ boutons: { 0: true } }), l).voiture.saut).toBe(true);
  });
  it("regard libre sur le stick gauche, ou sur un bouton", () => {
    const l: Partial<LiaisonsManette> = { regardGauche: ["A0-"], regardDroite: ["A0+"], regardHaut: ["A1-"], regardBas: ["A1+"] };
    expect(avec(manette({ axes: [1, 0, 0, 0] }), l).regard[0]).toBeCloseTo(1, 6);
    expect(avec(manette({ axes: [0, -1, 0, 0] }), l).regard[1]).toBeCloseTo(1, 6);
    expect(avec(manette({ axes: [0, 0, 1, 0] }), l).regard).toEqual([0, 0]);
    expect(avec(manette({ boutons: { 13: true } }), { regardBas: ["B13"] }).regard[1]).toBe(-1);
  });
  it("une action sans liaison ne fait rien", () => {
    const m = manette({ axes: [1, 1, 1, 1], boutons: { 0: true, 1: true, 7: 1, 6: 1, 9: true } });
    const vide = Object.fromEntries(Object.keys(LIAISONS_MANETTE_DEFAUT).map((k) => [k, []])) as unknown as LiaisonsManette;
    expect(entreesDepuisManette(m, REGL, vide)).toEqual(entreesJoueurNulles());
  });
  it("deux liaisons pour une action : la plus forte l'emporte (analogique) ou l'une des deux suffit (deux états)", () => {
    expect(avec(manette({ boutons: { 0: true, 5: true } }), { saut: ["B0", "B5"] }).voiture.saut).toBe(true);
    expect(avec(manette({ boutons: { 5: true } }), { saut: ["B0", "B5"] }).voiture.saut).toBe(true);
    expect(avec(manette({ boutons: { 2: 0.3, 3: 0.8 } }), { accelerer: ["B2", "B3"] }).voiture.accel).toBeCloseTo(0.8, 6);
  });
  it("entrées illisibles ignorées, axe de gâchette au repos à -1 sans effet, jamais de NaN ni de -0", () => {
    const e = avec(manette({ axes: [0, 0, 0, 0, -1, -1] }), { boost: ["A4+"], accelerer: ["A5+", "KeyW"] });
    expect(e.voiture.boost).toBe(false);
    expect(e.voiture.accel).toBe(0);
    expect(Object.is(e.voiture.accel, -0)).toBe(false);
    expect(avec(manette({ axes: [0, 0, 0, 0, 1, 1] }), { boost: ["A4+"], accelerer: ["A5+"] }).voiture).toMatchObject({ boost: true, accel: 1 });
    for (const v of Object.values(entreesDepuisManette(manette(), REGL).regard)) expect(Object.is(v, -0)).toBe(false);
  });
  it("pauseDepuisManette suit la liaison pause (Start et la seconde)", () => {
    expect(pauseDepuisManette(manette({ boutons: { 9: true } }), LIAISONS_MANETTE_DEFAUT)).toBe(true);
    expect(pauseDepuisManette(manette({ boutons: { 8: true } }), LIAISONS_MANETTE_DEFAUT)).toBe(false);
    const l = { ...LIAISONS_MANETTE_DEFAUT, pause: ["B9", "B8"] };
    expect(pauseDepuisManette(manette({ boutons: { 8: true } }), l)).toBe(true);
    expect(pauseDepuisManette(manette({ boutons: { 9: true } }), l)).toBe(true);
    expect(entreesDepuisManette(manette({ boutons: { 8: true } }), REGL, l).pause).toBe(true);
    expect(pauseDepuisManette(manette({ axes: [0, 0, 0, 0.9] }), { ...l, pause: ["B9", "A3+"] })).toBe(true);
  });
  it("manetteStandard choisit la première manette connectée au mapping standard", () => {
    const a = { connected: true, mapping: "" };
    const b = { connected: false, mapping: "standard" };
    const c = { connected: true, mapping: "standard" };
    expect(manetteStandard([null, a, b, c])).toBe(c);
    expect(manetteStandard([null, a, b])).toBeNull();
    expect(manetteStandard([])).toBeNull();
    expect(manetteStandard([{}])).not.toBeNull();
  });
});

describe("clavier : regard libre reliable", () => {
  it("le regard libre suit sa liaison, plus seulement le bouton du milieu", () => {
    const l: LiaisonsTouches = { ...LIAISONS_DEFAUT, regardLibre: ["KeyF"] };
    const lire = (codes: string[], d: [number, number]) => entreesDepuisClavier({ touches: new Set(codes), deplacementSouris: d }, l);
    expect(lire(["Souris1"], [RAYON_REGARD_SOURIS_PX, 0]).regard).toEqual([0, 0]);
    expect(lire(["KeyF"], [RAYON_REGARD_SOURIS_PX / 2, 0]).regard[0]).toBeCloseTo(0.5, 6);
    expect(entreesDepuisClavier({ touches: new Set(["KeyF"]), deplacementSouris: [0, 0] }, { ...l, regardLibre: [] }).regard).toEqual([0, 0]);
  });
});

describe("fusion", () => {
  it("l'axe le plus fort l'emporte, les boutons font un OU", () => {
    const a = clavier(["KeyW", "Space"]);
    const b = entreesDepuisManette(manette({ boutons: { 7: 0.4, [BOUTON_MANETTE.b]: true }, axes: [-0.9, 0, 0, 0] }), REGL);
    const f = fusionnerEntrees(a, b);
    expect(f.voiture.accel).toBe(1);
    expect(f.voiture.direction).toBeLessThan(-0.3);
    expect(f.voiture.saut).toBe(true);
    expect(f.voiture.boost).toBe(true);
    expect(fusionnerEntrees(entreesJoueurNulles(), entreesJoueurNulles())).toEqual(entreesJoueurNulles());
  });
});

describe("source branchée sur une cible d'événements", () => {
  function evt(type: string, props: Record<string, unknown>): Event {
    return Object.assign(new Event(type, { cancelable: true }), props);
  }
  function creer(lire?: () => (ManetteLue | null)[]) {
    const cible = new EventTarget() as unknown as Window;
    const src = creerSourceEntrees(cible, () => LIAISONS_DEFAUT, () => REGLAGES_DEFAUT(), lire ?? (() => []));
    return { cible, src };
  }

  it("suit les touches enfoncées puis relâchées", () => {
    const { cible, src } = creer();
    cible.dispatchEvent(evt("keydown", { code: "KeyW" }));
    cible.dispatchEvent(evt("keydown", { code: "KeyD" }));
    expect(src.echantillonner().voiture).toMatchObject({ accel: 1, direction: 1 });
    cible.dispatchEvent(evt("keyup", { code: "KeyW" }));
    expect(src.echantillonner().voiture).toMatchObject({ accel: 0, direction: 1 });
  });

  it("un appui plus court qu'une image est rendu une fois", () => {
    const { cible, src } = creer();
    cible.dispatchEvent(evt("keydown", { code: "Space" }));
    cible.dispatchEvent(evt("keyup", { code: "Space" }));
    expect(src.echantillonner().voiture.saut).toBe(true);
    expect(src.echantillonner().voiture.saut).toBe(false);
  });

  it("réactions : chaque ENFONCEMENT est un appui (chatAppuis), même relâché entre deux images ; la touche tenue et sa répétition automatique n'en font pas de nouveaux", () => {
    const { cible, src } = creer();
    const appuis = () => src.echantillonner().chatAppuis;
    expect(appuis()).toEqual({ haut: false, gauche: false, droite: false, bas: false });
    cible.dispatchEvent(evt("keydown", { code: "Digit1" }));
    cible.dispatchEvent(evt("keyup", { code: "Digit1" }));
    expect(appuis()).toEqual({ haut: true, gauche: false, droite: false, bas: false });
    // la même touche, appuyée dans l'image SUIVANT immédiatement celle où elle était déjà vue « tenue » : l'événement compte quand même
    cible.dispatchEvent(evt("keydown", { code: "Digit1" }));
    expect(src.echantillonner().chat.haut).toBe(true);
    cible.dispatchEvent(evt("keyup", { code: "Digit1" }));
    cible.dispatchEvent(evt("keydown", { code: "Digit1" }));
    expect(appuis()?.haut).toBe(true);
    // touche tenue : tenue (chat) mais plus d'appui nouveau, et la répétition automatique du système n'en crée pas
    expect(src.echantillonner().chat.haut).toBe(true);
    cible.dispatchEvent(evt("keydown", { code: "Digit1", repeat: true }));
    const e = src.echantillonner();
    expect(e.chat.haut).toBe(true);
    expect(e.chatAppuis?.haut).toBe(false);
    cible.dispatchEvent(evt("keyup", { code: "Digit1" }));
    expect(src.echantillonner().chat.haut).toBe(false);
  });
  it("réactions : chatSuite garde l'ORDRE et le nombre des appuis entre deux images (3 puis 1 reste 3 puis 1), vidée à l'échantillon suivant", () => {
    const { cible, src } = creer();
    for (const code of ["Digit3", "Digit1", "Digit1"]) { cible.dispatchEvent(evt("keydown", { code })); cible.dispatchEvent(evt("keyup", { code })); }
    expect(src.echantillonner().chatSuite).toEqual(["droite", "haut", "haut"]);
    expect(src.echantillonner().chatSuite).toEqual([]);
  });
  it("réactions : l'appui d'une touche d'une autre action n'ouvre rien, la perte de focus oublie les appuis", () => {
    const { cible, src } = creer();
    cible.dispatchEvent(evt("keydown", { code: "KeyW" }));
    expect(src.echantillonner().chatAppuis).toEqual({ haut: false, gauche: false, droite: false, bas: false });
    cible.dispatchEvent(evt("keydown", { code: "Digit4" }));
    cible.dispatchEvent(evt("blur", {}));
    expect(src.echantillonner().chatAppuis?.bas).toBe(false);
  });

  it("souris : boutons ajoutés aux touches, contextmenu bloqué, levier de regard borné et remis à zéro", () => {
    const { cible, src } = creer();
    cible.dispatchEvent(evt("mousedown", { button: 0 }));
    expect(src.echantillonner().voiture.boost).toBe(true);
    cible.dispatchEvent(evt("mouseup", { button: 0 }));
    expect(src.echantillonner().voiture.boost).toBe(false);
    const ctx = evt("contextmenu", {});
    cible.dispatchEvent(ctx);
    expect(ctx.defaultPrevented).toBe(true);
    cible.dispatchEvent(evt("mousedown", { button: 1 }));
    cible.dispatchEvent(evt("mousemove", { movementX: 1000, movementY: 0 }));
    expect(src.echantillonner().regard[0]).toBe(1);
    cible.dispatchEvent(evt("mouseup", { button: 1 }));
    expect(src.echantillonner().regard).toEqual([0, 0]);
  });

  it("la racine de la vue (dialog porteur de data-arene) ne vole pas les touches ni la souris, un vrai dialogue de menu si", () => {
    const { cible, src } = creer();
    // mini-DOM : `closest` n'évalue que le sélecteur de cibleInteractive, appliqué à une chaîne d'ancêtres
    type Noeud = { tagName: string; role?: string; arene?: boolean; parent?: Noeud };
    const fabrique = (n: Noeud) => ({
      tagName: n.tagName,
      closest: (sel: string) => {
        const exclut = sel.includes('[role="dialog"]:not([data-arene])');
        for (let c: Noeud | undefined = n; c; c = c.parent) {
          if (c.role === "dialog" && (!exclut || !c.arene)) return c;
          if (c.role === "menu") return c;
        }
        return null;
      },
    });
    const racine: Noeud = { tagName: "DIV", role: "dialog", arene: true };
    const canvas: Noeud = { tagName: "CANVAS", parent: racine };
    const dialoguePause: Noeud = { tagName: "DIV", role: "dialog", parent: racine };
    const contenuPause: Noeud = { tagName: "P", parent: dialoguePause };
    const tirer = (type: string, props: Record<string, unknown>, n: Noeud) => {
      const e = evt(type, props);
      Object.defineProperty(e, "target", { get: () => fabrique(n), configurable: true });
      cible.dispatchEvent(e);
    };
    tirer("keydown", { code: "KeyW" }, racine);
    expect(src.echantillonner().voiture.accel).toBe(1);
    tirer("keyup", { code: "KeyW" }, racine);
    tirer("mousedown", { button: 0 }, canvas);
    expect(src.echantillonner().voiture.boost).toBe(true);
    tirer("mouseup", { button: 0 }, canvas);
    tirer("keydown", { code: "KeyS" }, contenuPause);
    expect(src.echantillonner().voiture.accel).toBe(0);
  });

  it("n'avale pas les touches d'un bouton ou d'un champ (menu pause), bloque Espace sinon", () => {
    const { cible, src } = creer();
    const surBouton = evt("keydown", { code: "Space" });
    // `target` n'est posé par dispatchEvent que sur la cible elle-même : on le simule par un getter
    Object.defineProperty(surBouton, "target", { get: () => ({ tagName: "BUTTON" }), configurable: true });
    cible.dispatchEvent(surBouton);
    expect(surBouton.defaultPrevented).toBe(false);
    expect(src.echantillonner().voiture.saut).toBe(false);
    const libre = evt("keydown", { code: "Space" });
    cible.dispatchEvent(libre);
    expect(libre.defaultPrevented).toBe(true);
    expect(src.echantillonner().voiture.saut).toBe(true);
  });

  it("perte de focus : tout est relâché", () => {
    const { cible, src } = creer();
    cible.dispatchEvent(evt("keydown", { code: "KeyW" }));
    cible.dispatchEvent(new Event("blur"));
    expect(src.echantillonner().voiture.accel).toBe(0);
  });

  it("manette : fusionnée avec le clavier, boutons exposés, vibration appelée seulement si l'actionneur existe", () => {
    const playEffect = vi.fn(() => Promise.resolve());
    const pad: ManetteLue = { ...manette({ boutons: { 7: 1, 9: true } }), connected: true, mapping: "standard", vibrationActuator: { playEffect } };
    const { cible, src } = creer(() => [null, pad]);
    cible.dispatchEvent(evt("keydown", { code: "KeyD" }));
    expect(src.manetteConnectee()).toBe(true);
    const e = src.echantillonner();
    expect(e.voiture.accel).toBe(1);
    expect(e.voiture.direction).toBe(1);
    expect(src.boutonManette(BOUTON_MANETTE.start)).toBe(true);
    expect(src.boutonManette(BOUTON_MANETTE.b)).toBe(false);
    src.vibrer(0.5, 120);
    expect(playEffect).toHaveBeenCalledTimes(1);
    const sans = creer(() => []);
    expect(sans.src.manetteConnectee()).toBe(false);
    expect(() => sans.src.vibrer(1, 100)).not.toThrow();
  });

  it("la source lit les liaisons de manette du joueur et expose la pause (Start et seconde liaison)", () => {
    const reglages = REGLAGES_DEFAUT();
    reglages.liaisonsManette = { ...LIAISONS_MANETTE_DEFAUT, accelerer: ["B0"], pause: ["B9", "B8"] };
    const base = manette({ boutons: { 0: true } });
    const pad: ManetteLue = { ...base, connected: true, mapping: "standard" };
    const cible = new EventTarget() as unknown as Window;
    const src = creerSourceEntrees(cible, () => LIAISONS_DEFAUT, () => reglages, () => [pad]);
    expect(src.echantillonner().voiture.accel).toBe(1);
    expect(src.pauseManette()).toBe(false);
    base.boutons[8] = { pressed: true, value: 1 };
    expect(src.pauseManette()).toBe(true);
    base.boutons[8] = { pressed: false, value: 0 };
    base.boutons[9] = { pressed: true, value: 1 };
    expect(src.pauseManette()).toBe(true);
    src.dispose();
    expect(creerSourceEntrees(cible, () => LIAISONS_DEFAUT, () => reglages, () => []).pauseManette()).toBe(false);
  });

  it("regard libre relié à une touche : le levier suit la souris tant que la touche est tenue, puis revient au centre", () => {
    const cible = new EventTarget() as unknown as Window;
    const l: LiaisonsTouches = { ...LIAISONS_DEFAUT, regardLibre: ["KeyF"] };
    const src = creerSourceEntrees(cible, () => l, () => REGLAGES_DEFAUT(), () => []);
    cible.dispatchEvent(evt("mousemove", { movementX: 500, movementY: 0 }));
    cible.dispatchEvent(evt("keydown", { code: "KeyF" }));
    cible.dispatchEvent(evt("mousemove", { movementX: RAYON_REGARD_SOURIS_PX / 2, movementY: 0 }));
    expect(src.echantillonner().regard[0]).toBeCloseTo(0.5, 6);
    cible.dispatchEvent(evt("keyup", { code: "KeyF" }));
    expect(src.echantillonner().regard).toEqual([0, 0]);
    // le bouton du milieu ne fait plus rien
    cible.dispatchEvent(evt("mousedown", { button: 1 }));
    cible.dispatchEvent(evt("mousemove", { movementX: 1000, movementY: 0 }));
    expect(src.echantillonner().regard).toEqual([0, 0]);
    src.dispose();
  });

  it("une manette au mapping non standard est ignorée", () => {
    const pad: ManetteLue = { ...manette({ boutons: { 7: 1 } }), connected: true, mapping: "" };
    const { src } = creer(() => [pad]);
    expect(src.manetteConnectee()).toBe(false);
    expect(src.echantillonner().voiture.accel).toBe(0);
  });

  it("dispose retire les écouteurs", () => {
    const { cible, src } = creer();
    src.dispose();
    cible.dispatchEvent(evt("keydown", { code: "KeyW" }));
    expect(src.echantillonner().voiture.accel).toBe(0);
  });
});

describe("manette du navigateur (Gamepad)", () => {
  it("adapte `buttons` en `boutons` : RT accélère, A saute, B boost", () => {
    const btn = (pressed: boolean, value = pressed ? 1 : 0) => ({ pressed, touched: pressed, value });
    const buttons = Array.from({ length: 17 }, () => btn(false));
    buttons[7] = btn(true, 0.8); buttons[0] = btn(true); buttons[1] = btn(true);
    const g = { axes: [0.6, 0, 0, 0], buttons, connected: true, mapping: "standard", id: "pad", index: 0, timestamp: 0 } as unknown as Gamepad;
    const m = manetteDepuisGamepad(g);
    expect(m).not.toBeNull();
    const e = entreesDepuisManette(m!, REGLAGES_DEFAUT()).voiture;
    expect(e.accel).toBeCloseTo(0.8);
    expect(e.saut).toBe(true);
    expect(e.boost).toBe(true);
    expect(e.direction).toBeGreaterThan(0);
    expect(manetteDepuisGamepad(null)).toBeNull();
  });
});

describe("réactions rapides (croix)", () => {
  it("clavier : 1 2 3 4 = haut, gauche, droite, bas ; rien d'enfoncé = rien", () => {
    expect(clavier([]).chat).toEqual({ haut: false, gauche: false, droite: false, bas: false });
    expect(clavier(["Digit1"]).chat).toEqual({ haut: true, gauche: false, droite: false, bas: false });
    expect(clavier(["Digit2"]).chat.gauche).toBe(true);
    expect(clavier(["Digit3"]).chat.droite).toBe(true);
    expect(clavier(["Digit4"]).chat.bas).toBe(true);
  });
  it("clavier : les chiffres ne touchent pas à la conduite", () => {
    expect(clavier(["Digit1", "Digit2", "Digit3", "Digit4"]).voiture).toEqual(entreesJoueurNulles().voiture);
  });
  it("manette : la croix B12 haut, B14 gauche, B15 droite, B13 bas ; le klaxon est sur L3, plus sur la croix", () => {
    const e = entreesDepuisManette(manette({ boutons: { [BOUTON_MANETTE.haut]: true, [BOUTON_MANETTE.droite]: true } }), REGL);
    expect(e.chat).toEqual({ haut: true, gauche: false, droite: true, bas: false });
    expect(e.klaxon).toBe(false);
    expect(entreesDepuisManette(manette({ boutons: { [BOUTON_MANETTE.gauche]: true } }), REGL).chat.gauche).toBe(true);
    expect(entreesDepuisManette(manette({ boutons: { [BOUTON_MANETTE.bas]: true } }), REGL).chat.bas).toBe(true);
    expect(entreesDepuisManette(manette({ boutons: { [BOUTON_MANETTE.l3]: true } }), REGL)).toMatchObject({ klaxon: true, chat: { haut: false, gauche: false, droite: false, bas: false } });
  });
  it("liaisons personnalisées suivies (clavier et manette)", () => {
    const l = { ...LIAISONS_DEFAUT, chatHaut: ["KeyU"] };
    expect(entreesDepuisClavier({ touches: new Set(["KeyU"]), deplacementSouris: [0, 0] }, l).chat.haut).toBe(true);
    expect(entreesDepuisClavier({ touches: new Set(["Digit1"]), deplacementSouris: [0, 0] }, l).chat.haut).toBe(false);
    const m: LiaisonsManette = { ...LIAISONS_MANETTE_DEFAUT, chatBas: ["B0"] };
    expect(entreesDepuisManette(manette({ boutons: { 0: true } }), REGL, m).chat.bas).toBe(true);
  });
  it("fusion : un OU par direction", () => {
    const a = { ...entreesJoueurNulles(), chat: { haut: true, gauche: false, droite: false, bas: false } };
    const b = { ...entreesJoueurNulles(), chat: { haut: false, gauche: false, droite: true, bas: false } };
    expect(fusionnerEntrees(a, b).chat).toEqual({ haut: true, gauche: false, droite: true, bas: false });
  });
});
