import { describe, expect, it } from "vitest";
import { CAMERA_DEFAUT, LIAISONS_DEFAUT, LIAISONS_MANETTE_DEFAUT, REGLAGES_DEFAUT, type StockageMinimal } from "./contrat";
import { BORNES_CAMERA, CLE_REGLAGES, ecrireReglages, lireReglages, normaliserReglages } from "./reglages";

function stockage(init: Record<string, string> = {}): StockageMinimal & { donnees: Record<string, string> } {
  const donnees = { ...init };
  return { donnees, getItem: (k) => (k in donnees ? donnees[k] : null), setItem: (k, v) => { donnees[k] = v; } };
}

describe("normaliserReglages", () => {
  it("n'importe quelle entrée donne des réglages complets", () => {
    for (const brut of [undefined, null, 3, "x", [], {}, { camera: 5 }, { touches: [] }]) {
      expect(normaliserReglages(brut)).toEqual(REGLAGES_DEFAUT());
    }
  });
  it("les défauts du contrat sont stables", () => {
    const d = normaliserReglages(REGLAGES_DEFAUT());
    expect(d).toEqual(REGLAGES_DEFAUT());
    expect(d.camera).toEqual(CAMERA_DEFAUT);
  });
  it("valeurs bornées champ par champ, le reste intact", () => {
    const r = normaliserReglages({ camera: { fov: 500, distance: 0, hauteur: "grand", angle: -99, rigidite: 0.8 }, volume: 3, zoneMorteManette: -1 });
    expect(r.camera.fov).toBe(BORNES_CAMERA.fov[1]);
    expect(r.camera.distance).toBe(BORNES_CAMERA.distance[0]);
    expect(r.camera.hauteur).toBe(CAMERA_DEFAUT.hauteur);
    expect(r.camera.angle).toBe(BORNES_CAMERA.angle[0]);
    expect(r.camera.rigidite).toBe(0.8);
    expect(r.volume).toBe(1);
    expect(r.zoneMorteManette).toBe(0);
  });
  it("NaN et Infinity ne passent pas", () => {
    const r = normaliserReglages({ camera: { fov: NaN, distance: Infinity }, volume: NaN });
    expect(r.camera.fov).toBe(CAMERA_DEFAUT.fov);
    expect(r.camera.distance).toBe(CAMERA_DEFAUT.distance);
    expect(r.volume).toBe(REGLAGES_DEFAUT().volume);
  });
  it("touches : deux au plus, sans doublon ni code absurde, défaut si absent ou invalide, vide si le joueur l'a vidé", () => {
    const r = normaliserReglages({ touches: { saut: ["KeyJ", "KeyJ", "KeyK", "KeyL"], boost: [], klaxon: ["<script>"], accelerer: "KeyW" } });
    expect(r.touches.saut).toEqual(["KeyJ", "KeyK"]);
    expect(r.touches.boost).toEqual([]);
    expect(r.touches.klaxon).toEqual(LIAISONS_DEFAUT.klaxon);
    expect(r.touches.accelerer).toEqual(LIAISONS_DEFAUT.accelerer);
  });
  it("Échap reste toujours liée à la pause", () => {
    const r = normaliserReglages({ touches: { pause: ["KeyP"] } });
    expect(r.touches.pause).toContain("Escape");
    expect(r.touches.pause.length).toBeLessThanOrEqual(2);
  });
  it("Échap reste en premier et n'est liée à aucune autre action", () => {
    const r = normaliserReglages({ touches: { pause: ["KeyP", "Escape"], saut: ["Escape", "KeyJ"], regardLibre: ["Escape"] } });
    expect(r.touches.pause).toEqual(["Escape", "KeyP"]);
    expect(r.touches.saut).toEqual(["KeyJ"]);
    expect(r.touches.regardLibre).toEqual([]);
  });
  it("le regard libre a sa liaison (bouton du milieu par défaut)", () => {
    expect(REGLAGES_DEFAUT().touches.regardLibre).toEqual(["Souris1"]);
    expect(normaliserReglages({ touches: { regardLibre: ["KeyF"] } }).touches.regardLibre).toEqual(["KeyF"]);
    expect(normaliserReglages({ touches: { saut: ["KeyJ"] } }).touches.regardLibre).toEqual(["Souris1"]);
  });
  it("booléens : seulement de vrais booléens", () => {
    const r = normaliserReglages({ balleCamParDefaut: false, inverserTangageManette: "oui", vibrations: 0 });
    expect(r.balleCamParDefaut).toBe(false);
    expect(r.inverserTangageManette).toBe(false);
    expect(r.vibrations).toBe(true);
  });
  it("ne partage aucune référence avec les défauts du contrat", () => {
    const r = normaliserReglages({});
    r.touches.saut = ["KeyX"];
    expect(LIAISONS_DEFAUT.saut).toEqual(["Space"]);
  });
});

describe("lecture et écriture", () => {
  it("aller-retour", () => {
    const s = stockage();
    const r = { ...REGLAGES_DEFAUT(), volume: 0.3, balleCamParDefaut: false };
    r.camera = { ...r.camera, fov: 95 };
    ecrireReglages(r, s);
    expect(lireReglages(s)).toEqual(r);
    expect(s.donnees[CLE_REGLAGES]).toBeTruthy();
  });
  it("stockage absent, vide, corrompu ou qui lève : défauts, jamais d'exception", () => {
    expect(lireReglages(null)).toEqual(REGLAGES_DEFAUT());
    expect(lireReglages(stockage())).toEqual(REGLAGES_DEFAUT());
    expect(lireReglages(stockage({ [CLE_REGLAGES]: "{pas du json" }))).toEqual(REGLAGES_DEFAUT());
    const quiLeve: StockageMinimal = { getItem: () => { throw new Error("bloqué"); }, setItem: () => { throw new Error("plein"); } };
    expect(lireReglages(quiLeve)).toEqual(REGLAGES_DEFAUT());
    expect(() => ecrireReglages(REGLAGES_DEFAUT(), quiLeve)).not.toThrow();
    expect(() => ecrireReglages(REGLAGES_DEFAUT(), null)).not.toThrow();
  });
  it("une sauvegarde partielle d'une version plus ancienne est complétée", () => {
    const s = stockage({ [CLE_REGLAGES]: JSON.stringify({ volume: 0.2 }) });
    const r = lireReglages(s);
    expect(r.volume).toBe(0.2);
    expect(r.touches).toEqual(LIAISONS_DEFAUT);
  });
});

describe("liaisons de la manette", () => {
  it("une sauvegarde sans liaisons de manette reçoit les défauts", () => {
    expect(normaliserReglages({ volume: 0.2 }).liaisonsManette).toEqual(LIAISONS_MANETTE_DEFAUT);
    expect(lireReglages(stockage({ [CLE_REGLAGES]: JSON.stringify({ touches: { saut: ["KeyJ"] } }) })).liaisonsManette).toEqual(LIAISONS_MANETTE_DEFAUT);
  });
  it("entrées valides gardées, deux au plus, sans doublon ; invalides ignorées ; absent → défaut ; vide → vide", () => {
    const r = normaliserReglages({
      liaisonsManette: {
        saut: ["B5", "B5", "A0-", "B1"], boost: ["B99", "A9+x", 7, null], klaxon: [], accelerer: "B0", reculer: ["A1-", "<script>"],
        gauche: ["A00-"], tangageHaut: ["A15+"], tangageBas: ["A16+"], rouleGauche: ["B-1"],
      },
    }).liaisonsManette;
    expect(r.saut).toEqual(["B5", "A0-"]);
    expect(r.boost).toEqual(LIAISONS_MANETTE_DEFAUT.boost);
    expect(r.klaxon).toEqual([]);
    expect(r.accelerer).toEqual(LIAISONS_MANETTE_DEFAUT.accelerer);
    expect(r.reculer).toEqual(["A1-"]);
    expect(r.gauche).toEqual(LIAISONS_MANETTE_DEFAUT.gauche);
    expect(r.tangageHaut).toEqual(["A15+"]);
    expect(r.tangageBas).toEqual(LIAISONS_MANETTE_DEFAUT.tangageBas);
    expect(r.rouleGauche).toEqual(LIAISONS_MANETTE_DEFAUT.rouleGauche);
  });
  it("Start reste en premier sur la pause et ne sert à aucune autre action", () => {
    const r = normaliserReglages({ liaisonsManette: { pause: ["B3"], saut: ["B9", "B0"], klaxon: ["B9"] } }).liaisonsManette;
    expect(r.pause).toEqual(["B9", "B3"]);
    expect(r.saut).toEqual(["B0"]);
    expect(r.klaxon).toEqual([]);
    expect(normaliserReglages({ liaisonsManette: { pause: [] } }).liaisonsManette.pause).toEqual(["B9"]);
  });
  it("la pause n'accepte ni A (il relance le match) ni un bouton de souris (elle ne se lit qu'au clavier)", () => {
    expect(normaliserReglages({ liaisonsManette: { pause: ["B0", "B3"] } }).liaisonsManette.pause).toEqual(["B9", "B3"]);
    expect(normaliserReglages({ liaisonsManette: { pause: ["B0"], saut: ["B0"] } }).liaisonsManette.saut).toEqual(["B0"]);
    expect(normaliserReglages({ touches: { pause: ["Souris2", "KeyP"] } }).touches.pause).toEqual(["Escape", "KeyP"]);
    expect(normaliserReglages({ touches: { pause: ["Souris0"], saut: ["Souris0"] } }).touches.saut).toEqual(["Souris0"]);
  });
  it("n'importe quelle valeur ne lève pas d'exception", () => {
    for (const brut of [null, 3, "x", [], { liaisonsManette: 5 }, { liaisonsManette: [] }, { liaisonsManette: { saut: { a: 1 } } }]) {
      expect(() => normaliserReglages(brut)).not.toThrow();
      expect(normaliserReglages(brut).liaisonsManette.pause[0]).toBe("B9");
    }
  });
  it("aller-retour dans le stockage, sans partager de référence avec les défauts", () => {
    const s = stockage();
    const r = REGLAGES_DEFAUT();
    r.liaisonsManette = { ...r.liaisonsManette, saut: ["B5"], boost: ["B7", "A2+"], pause: ["B9", "B8"] };
    ecrireReglages(r, s);
    expect(lireReglages(s)).toEqual(r);
    const n = normaliserReglages({});
    n.liaisonsManette.saut = ["B10"];
    expect(LIAISONS_MANETTE_DEFAUT.saut).toEqual(["B0"]);
  });
});

describe("réactions rapides : migration et réglage", () => {
  it("un réglage d'avant les réactions (klaxon sur la croix) garde le klaxon du joueur : la réaction nouvelle n'a pas le bouton déjà pris", () => {
    const r = normaliserReglages({ liaisonsManette: { klaxon: ["B12"], saut: ["B0"] }, touches: { klaxon: ["Digit1"] } });
    expect(r.liaisonsManette.klaxon).toEqual(["B12"]);
    expect(r.liaisonsManette.chatHaut).toEqual([]);
    expect(r.liaisonsManette.chatBas).toEqual(["B13"]);
    expect(r.touches.klaxon).toEqual(["Digit1"]);
    expect(r.touches.chatHaut).toEqual([]);
    expect(r.touches.chatGauche).toEqual(["Digit2"]);
  });
  it("un réglage d'avant sans conflit reçoit les défauts des réactions", () => {
    const r = normaliserReglages({ liaisonsManette: { saut: ["B5"] }, touches: { saut: ["KeyJ"] } });
    expect(r.touches.chatHaut).toEqual(["Digit1"]);
    expect(r.liaisonsManette.chatDroite).toEqual(["B15"]);
  });
  it("les réactions déjà mémorisées sont gardées telles quelles, même vides", () => {
    const r = normaliserReglages({ touches: { chatHaut: ["KeyU"], chatBas: [] }, liaisonsManette: { chatGauche: ["B0"] } });
    expect(r.touches.chatHaut).toEqual(["KeyU"]);
    expect(r.touches.chatBas).toEqual([]);
    expect(r.liaisonsManette.chatGauche).toEqual(["B0"]);
  });
  it("réactions des adversaires : vrai par défaut, booléen seulement, mémorisé", () => {
    expect(REGLAGES_DEFAUT().reactionsAdversaires).toBe(true);
    expect(normaliserReglages({ reactionsAdversaires: false }).reactionsAdversaires).toBe(false);
    expect(normaliserReglages({ reactionsAdversaires: "non" }).reactionsAdversaires).toBe(true);
    const st = stockage();
    ecrireReglages({ ...REGLAGES_DEFAUT(), reactionsAdversaires: false }, st);
    expect(lireReglages(st).reactionsAdversaires).toBe(false);
  });
});
