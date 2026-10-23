import { describe, expect, it } from "vitest";
import { CHIFFRES_MAX, DUREE_CHIFFRE_MS, FENETRE_CUMUL_MS, cumulerConfirme, purgerChiffres, type ChiffreDegats, type ConfirmeBrut } from "./degats-cumul";

const conf = (p: Partial<ConfirmeBrut> = {}): ConfirmeBrut => ({ cible: "a", degats: 20, absorbe: 0, zone: "corps", tue: false, t: 0, ...p });

describe("degats-cumul", () => {
  it("constantes de la spec : fenêtre de 400 ms, chiffre visible 700 ms", () => {
    expect(FENETRE_CUMUL_MS).toBe(400);
    expect(DUREE_CHIFFRE_MS).toBe(700);
  });

  it("un premier événement crée un chiffre", () => {
    const l = cumulerConfirme([], conf({ degats: 34, zone: "tete" }), 1);
    expect(l).toEqual([{ id: 1, cible: "a", degats: 34, absorbe: 0, tete: true, bouclier: false, tue: false, debut: 0, dernier: 0, nb: 1 }]);
  });

  it("additionne les dégâts d'une même cible dans la fenêtre (pompe : 9 plombs, un seul chiffre)", () => {
    let l: ChiffreDegats[] = [];
    for (let i = 0; i < 9; i++) l = cumulerConfirme(l, conf({ degats: 8, t: 1000 + i }), i + 1);
    expect(l).toHaveLength(1);
    expect(l[0].degats).toBe(72);
    expect(l[0].id).toBe(1);
    expect(l[0].nb).toBe(9);
    expect(l[0].dernier).toBe(1008);
  });

  it("combine les drapeaux tête, bouclier et kill par OU", () => {
    let l = cumulerConfirme([], conf({ degats: 30, absorbe: 30 }), 1);
    l = cumulerConfirme(l, conf({ degats: 50, zone: "tete", t: 100 }), 2);
    l = cumulerConfirme(l, conf({ degats: 20, tue: true, t: 200 }), 3);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ degats: 100, absorbe: 30, tete: true, bouclier: true, tue: true });
  });

  it("ne fusionne pas deux cibles distinctes", () => {
    let l = cumulerConfirme([], conf({ cible: "a" }), 1);
    l = cumulerConfirme(l, conf({ cible: "b", t: 50 }), 2);
    expect(l.map((c) => c.cible)).toEqual(["a", "b"]);
  });

  it("la fenêtre expire 400 ms après le premier événement (pas de fenêtre glissante)", () => {
    let l = cumulerConfirme([], conf({ t: 0 }), 1);
    l = cumulerConfirme(l, conf({ t: 300 }), 2);
    l = cumulerConfirme(l, conf({ t: 400 }), 3);
    expect(l).toHaveLength(1);
    l = cumulerConfirme(l, conf({ t: 401 }), 4);
    expect(l).toHaveLength(2);
    expect(l[1]).toMatchObject({ id: 4, debut: 401, degats: 20 });
  });

  it("ne modifie pas la liste reçue", () => {
    const avant = cumulerConfirme([], conf(), 1);
    const copie = JSON.parse(JSON.stringify(avant));
    cumulerConfirme(avant, conf({ t: 10 }), 2);
    expect(avant).toEqual(copie);
  });

  it("garde au plus CHIFFRES_MAX chiffres, les plus récents", () => {
    let l: ChiffreDegats[] = [];
    for (let i = 0; i < CHIFFRES_MAX + 3; i++) l = cumulerConfirme(l, conf({ cible: `c${i}`, t: i }), i + 1);
    expect(l).toHaveLength(CHIFFRES_MAX);
    expect(l[CHIFFRES_MAX - 1].cible).toBe(`c${CHIFFRES_MAX + 2}`);
  });

  it("purge les chiffres affichés depuis plus de 700 ms après leur dernier événement", () => {
    let l = cumulerConfirme([], conf({ cible: "a", t: 0 }), 1);
    l = cumulerConfirme(l, conf({ cible: "b", t: 500 }), 2);
    expect(purgerChiffres(l, 699)).toHaveLength(2);
    expect(purgerChiffres(l, 700).map((c) => c.cible)).toEqual(["b"]);
    expect(purgerChiffres(l, 1200)).toEqual([]);
  });

  it("un cumul prolonge l'affichage du chiffre", () => {
    let l = cumulerConfirme([], conf({ t: 0 }), 1);
    l = cumulerConfirme(l, conf({ t: 350 }), 2);
    expect(purgerChiffres(l, 800)).toHaveLength(1);
    expect(purgerChiffres(l, 1050)).toHaveLength(0);
  });
});
