import { describe, expect, it } from "vitest";
import {
  FILE_VIVE_MAX, INTERVALLE_VIF_MS, NBSP, PIPS, PRIORITE_VIVE, SEUILS_MUNITIONS, SEUILS_PV,
  cacheLiveVide, delaiVif, etapeRupture, ecrireLive, fileViveVide, formatKills, formatMetres, formatNombre, formatPourcent, formatRang, formatSecondes,
  formatVitesse, libelleFil, libellePvBas, niveauMunitions, niveauPv, palierFranchi, parseSlots, pips, prendreVif, pousserVif,
  syntheseMatch, texteBonus, texteOffreElsa, type ElementEcrivable, type MessageVif,
} from "./hud-modele";
import type { JoueurPublic } from "./protocole";

describe("hud-modele : seuils de la spec", () => {
  it("constantes", () => {
    expect(SEUILS_MUNITIONS).toEqual({ basFraction: 0.25, basBalles: 3, critiqueFraction: 0.1 });
    expect(SEUILS_PV).toEqual({ moyen: 50, bas: 25, libelleBas: 30 });
    expect(PIPS.parBalleMax).toBe(30);
  });
});

describe("parseSlots : épée", () => {
  it("le slot couteau peut porter l'épée (0 / 0, jamais d'alerte de munitions)", () => {
    const s = parseSlots("principale:fusil_assaut:23:30|secondaire:pistolet:12:12|couteau:epee:0:0");
    expect(s).toEqual([
      { slot: "principale", arme: "fusil_assaut", munitions: 23, chargeur: 30, reserve: -1 },
      { slot: "secondaire", arme: "pistolet", munitions: 12, chargeur: 12, reserve: -1 },
      { slot: "couteau", arme: "epee", munitions: 0, chargeur: 0, reserve: -1 },
    ]);
    expect(niveauMunitions(0, 0)).toBe("normal");
  });
});

describe("parseSlots", () => {
  it("décode 4 champs (réserve infinie)", () => {
    const s = parseSlots("principale:fusil_assaut:23:30|secondaire:pistolet:12:12|couteau:couteau:0:0|speciale:railgun:4:6");
    expect(s).toEqual([
      { slot: "principale", arme: "fusil_assaut", munitions: 23, chargeur: 30, reserve: -1 },
      { slot: "secondaire", arme: "pistolet", munitions: 12, chargeur: 12, reserve: -1 },
      { slot: "couteau", arme: "couteau", munitions: 0, chargeur: 0, reserve: -1 },
      { slot: "speciale", arme: "railgun", munitions: 4, chargeur: 6, reserve: -1 },
    ]);
  });

  it("décode 5 champs (réserve finie ou −1)", () => {
    const s = parseSlots("principale:fusil_assaut:23:30:90|secondaire:pistolet:12:12:-1");
    expect(s.map((x) => x.reserve)).toEqual([90, -1]);
  });

  it("le slot spécial est absent quand il n'est pas porté", () => {
    const s = parseSlots("principale:sniper:5:5|secondaire:pistolet:12:12|couteau:couteau:0:0");
    expect(s.map((x) => x.slot)).toEqual(["principale", "secondaire", "couteau"]);
  });

  it("ignore chaîne vide, slot inconnu, arme inconnue, nombres illisibles et champs en trop ou en moins", () => {
    expect(parseSlots("")).toEqual([]);
    expect(parseSlots("x:pistolet:1:1|principale:laser:1:1|principale:sniper:a:5|principale:sniper:1|principale:sniper:1:5:2:9")).toEqual([]);
    expect(parseSlots("poubelle|secondaire:pistolet:12:12")).toHaveLength(1);
  });
});

describe("niveauMunitions", () => {
  it("normal au-dessus de 25 % et de 3 balles", () => {
    expect(niveauMunitions(30, 30)).toBe("normal");
    expect(niveauMunitions(8, 30)).toBe("normal");
    expect(niveauMunitions(4, 5)).toBe("normal");
  });
  it("bas (ambre) à 25 % ou à 3 balles", () => {
    expect(niveauMunitions(7, 30)).toBe("bas");
    expect(niveauMunitions(3, 32)).toBe("critique"); // 3 ≤ 10 % de 32
    expect(niveauMunitions(4, 30)).toBe("bas");
    expect(niveauMunitions(3, 6)).toBe("bas");
    expect(niveauMunitions(2, 5)).toBe("bas");
  });
  it("critique (danger) à 10 % ou moins", () => {
    expect(niveauMunitions(3, 30)).toBe("critique");
    expect(niveauMunitions(1, 12)).toBe("critique");
    expect(niveauMunitions(10, 100)).toBe("critique");
  });
  it("vide à 0 balle, et le couteau (chargeur 0) n'alerte jamais", () => {
    expect(niveauMunitions(0, 30)).toBe("vide");
    expect(niveauMunitions(0, 0)).toBe("normal");
  });
});

describe("niveauPv et libellé PV BAS", () => {
  it("50, 25 et 30", () => {
    expect(niveauPv(100)).toBe("normal");
    expect(niveauPv(51)).toBe("normal");
    expect(niveauPv(50)).toBe("moyen");
    expect(niveauPv(26)).toBe("moyen");
    expect(niveauPv(25)).toBe("bas");
    expect(niveauPv(0)).toBe("bas");
    expect(libellePvBas(31)).toBe(false);
    expect(libellePvBas(30)).toBe(true);
  });
});

describe("pips", () => {
  it("un cran par balle jusqu'à 30", () => {
    expect(pips(12, 12)).toEqual({ crans: 12, pleins: 12, parCran: 1 });
    expect(pips(23, 30)).toEqual({ crans: 30, pleins: 23, parCran: 1 });
    expect(pips(4, 5)).toEqual({ crans: 5, pleins: 4, parCran: 1 });
  });
  it("de 31 à 40, 30 crans proportionnels", () => {
    expect(pips(36, 36)).toEqual({ crans: 30, pleins: 30, parCran: 1.2 });
    const p = pips(20, 40);
    expect(p.crans).toBe(30);
    expect(p.pleins).toBe(15);
  });
  it("au-delà de 40, un cran pour 5 balles", () => {
    expect(pips(60, 60)).toEqual({ crans: 12, pleins: 12, parCran: 5 });
    expect(pips(150, 150)).toEqual({ crans: 30, pleins: 30, parCran: 5 });
    expect(pips(51, 150).pleins).toBe(11);
  });
  it("un chargeur non vide garde un cran plein, un chargeur vide aucun, et borne les valeurs", () => {
    expect(pips(1, 150).pleins).toBe(1);
    expect(pips(0, 30).pleins).toBe(0);
    expect(pips(99, 30).pleins).toBe(30);
    expect(pips(-4, 30).pleins).toBe(0);
    expect(pips(0, 0)).toEqual({ crans: 0, pleins: 0, parCran: 1 });
  });
});

describe("formats français", () => {
  it("virgule décimale et espace insécable avant l'unité", () => {
    expect(formatMetres(112.4)).toBe(`112${NBSP}m`);
    expect(formatSecondes(2.5)).toBe(`2,5${NBSP}s`);
    expect(formatSecondes(27)).toBe(`27${NBSP}s`);
    expect(formatSecondes(1.96)).toBe(`2${NBSP}s`);
    expect(formatSecondes(-3)).toBe(`0${NBSP}s`);
    expect(formatPourcent(0.436)).toBe(`44${NBSP}%`);
    expect(formatVitesse(10.6)).toBe(`11${NBSP}m/s`);
    expect(formatKills(12)).toBe(`12${NBSP}K`);
    expect(formatNombre(2310)).toMatch(/^2[\s  ]310$/);
  });
  it("rangs", () => {
    expect(formatRang(1)).toBe("1er");
    expect(formatRang(2)).toBe("2e");
    expect(formatRang(13)).toBe("13e");
  });
  it("libellé du fil : nom court de l'arme, cause en toutes lettres pour une voiture", () => {
    expect(libelleFil("fusil_assaut", "arme", "Lea")).toBe("Fusil");
    expect(libelleFil("mitrailleuse", "arme", "Lea")).toBe("M. lourde");
    expect(libelleFil("couteau", "arme", "Lea")).toBe("Couteau");
    expect(libelleFil("epee", "arme", "Lea")).toBe("Épée");
    expect(libelleFil("couteau", "ecrase_pnj", "")).toBe("Écrasé par la circulation");
    expect(libelleFil("couteau", "ecrase_vehicule", "Lea")).toBe("Renversé par Lea");
  });
  it("textes d'Elsa", () => {
    expect(texteOffreElsa("soin")).toBe("SOIN COMPLET : PV 100 + BOUCLIER 100");
    expect(texteOffreElsa("arme", "railgun")).toBe("ARME : RAILGUN, 6 tirs");
    expect(texteBonus("arme", "railgun", "4")).toBe("Railgun · 6 tirs · touche 4");
    expect(texteBonus("arme", "railgun", "")).toBe("Railgun · 6 tirs");
  });
});

const joueur = (id: string, kills: number, morts: number, extra: Partial<JoueurPublic> = {}): JoueurPublic => ({
  id, pseudo: id.toUpperCase(), couleur: "#112233", enJeu: true, kills, morts, ping: 30, ...extra,
});

describe("syntheseMatch", () => {
  const liste = [joueur("lea", 18, 7), joueur("zoe", 15, 9), joueur("max", 13, 10), joueur("moi", 12, 8, { serie: 2 }), joueur("tom", 9, 12)];

  it("rang, leader, retard et progression", () => {
    const s = syntheseMatch(liste, "moi", 30);
    expect(s.rang).toBe(4);
    expect(s.leader).toMatchObject({ id: "lea", kills: 18 });
    expect(s.ecart).toBe(6);
    expect(s.jeMene).toBe(false);
    expect(s.serie).toBe(2);
    expect(s.enJeu).toBe(5);
    expect(s.progressionLeader).toBeCloseTo(0.6);
    expect(s.maProgression).toBeCloseTo(0.4);
    expect(s.pointDeMatch).toBe(false);
  });

  it("je mène : avance sur le deuxième", () => {
    const s = syntheseMatch([joueur("moi", 18, 3), joueur("zoe", 15, 9)], "moi", 30);
    expect(s).toMatchObject({ rang: 1, jeMene: true, egalite: false, ecart: 3 });
  });

  it("seul en jeu : je mène", () => {
    const s = syntheseMatch([joueur("moi", 4, 0)], "moi", 30);
    expect(s).toMatchObject({ rang: 1, jeMene: true, ecart: 4 });
  });

  it("égalité de kills en tête : ni mène ni retard", () => {
    const s = syntheseMatch([joueur("moi", 10, 2), joueur("zoe", 10, 5)], "moi", 30);
    expect(s).toMatchObject({ rang: 1, jeMene: false, egalite: true, ecart: 0 });
  });

  it("ex aequo : mêmes kills et morts", () => {
    const s = syntheseMatch([joueur("a", 10, 5), joueur("moi", 10, 5), joueur("b", 3, 3)], "moi", 30);
    expect(s.exAequo).toBe(true);
    expect(syntheseMatch([joueur("a", 10, 5), joueur("moi", 10, 6)], "moi", 30)).toMatchObject({ rang: 2, exAequo: false });
  });

  it("les spectateurs ne comptent pas", () => {
    const s = syntheseMatch([joueur("a", 99, 0, { enJeu: false }), joueur("moi", 2, 1)], "moi", 30);
    expect(s.rang).toBe(1);
    expect(s.enJeu).toBe(1);
  });

  it("POINT DE MATCH quand le leader est à 3 kills ou moins de l'objectif, mais pas une fois atteint", () => {
    expect(syntheseMatch([joueur("a", 26, 0), joueur("moi", 1, 1)], "moi", 30).pointDeMatch).toBe(false);
    expect(syntheseMatch([joueur("a", 27, 0), joueur("moi", 1, 1)], "moi", 30).pointDeMatch).toBe(true);
    expect(syntheseMatch([joueur("a", 30, 0), joueur("moi", 1, 1)], "moi", 30).pointDeMatch).toBe(false);
  });

  it("sans moi (id inconnu) : rang 0 et pas d'écart", () => {
    const s = syntheseMatch(liste, null, 30);
    expect(s.rang).toBe(0);
    expect(s.ecart).toBe(0);
    expect(s.jeMene).toBe(false);
  });
});

describe("palierFranchi", () => {
  it("60, 30 et 10 s", () => {
    expect(palierFranchi(61, 60)).toBe(60);
    expect(palierFranchi(60, 59)).toBeNull();
    expect(palierFranchi(31, 30)).toBe(30);
    expect(palierFranchi(11, 10)).toBe(10);
    expect(palierFranchi(120, 100)).toBeNull();
  });
});

describe("file anti-bavardage de la région vive", () => {
  const m = (id: number, priorite: number, assertif = false): MessageVif => ({ id, texte: `m${id}`, priorite, assertif });

  it("un message part tout de suite, le suivant attend 2 s", () => {
    let f = pousserVif(fileViveVide(), m(1, 1));
    f = pousserVif(f, m(2, 1));
    let r = prendreVif(f, 1000);
    expect(r.message?.id).toBe(1);
    f = r.file;
    expect(delaiVif(f, 1500)).toBe(INTERVALLE_VIF_MS - 500);
    expect(prendreVif(f, 1500).message).toBeNull();
    r = prendreVif(f, 3000);
    expect(r.message?.id).toBe(2);
    expect(delaiVif(r.file, 3000)).toBe(-1);
  });

  it("le plus important passe d'abord, à égalité le plus ancien", () => {
    let f = fileViveVide();
    f = pousserVif(f, m(1, PRIORITE_VIVE.info));
    f = pousserVif(f, m(2, PRIORITE_VIVE.critique, true));
    f = pousserVif(f, m(3, PRIORITE_VIVE.critique));
    const r = prendreVif(f, 0);
    expect(r.message?.id).toBe(2);
    expect(r.message?.assertif).toBe(true);
    expect(prendreVif(r.file, 2000).message?.id).toBe(3);
  });

  it("jette les moins importants au-delà de la capacité", () => {
    let f = fileViveVide();
    for (let i = 1; i <= FILE_VIVE_MAX; i++) f = pousserVif(f, m(i, 2));
    f = pousserVif(f, m(99, 1));
    expect(f.attente.map((x) => x.id)).not.toContain(99);
    f = pousserVif(f, m(100, 5));
    expect(f.attente).toHaveLength(FILE_VIVE_MAX);
    expect(f.attente.map((x) => x.id)).toContain(100);
    // à priorité égale, le plus ancien est jeté
    expect(f.attente.map((x) => x.id)).not.toContain(1);
  });

  it("file vide : rien à prendre", () => {
    expect(delaiVif(fileViveVide(), 0)).toBe(-1);
    expect(prendreVif(fileViveVide(), 0).message).toBeNull();
  });
});

describe("ecrireLive", () => {
  const faux = (duree?: string): ElementEcrivable & { vars: Record<string, string>; attrs: Record<string, string> } => {
    const vars: Record<string, string> = {};
    const attrs: Record<string, string> = {};
    return { vars, attrs, style: { setProperty: (n, v) => { vars[n] = v; } }, textContent: "", dataset: duree ? { duree } : {}, setAttribute: (n, v) => { attrs[n] = v; } };
  };
  const live = { recharge: 0.5, vitesse: 10.6, vitesseKmh: 87.2, regenDelai: 0.4 };

  it("écrit variables CSS, aria et textes sur les éléments concernés", () => {
    const anneau = faux(), barre = faux(), temps = faux("2"), trait = faux(), vitesse = faux(), kmh = faux();
    ecrireLive(live, {
      anneauRecharge: { current: anneau }, barreRecharge: { current: barre }, tempsRecharge: { current: temps },
      traitRegen: { current: trait }, vitesse: { current: vitesse }, kmh: { current: kmh },
    }, cacheLiveVide());
    expect(anneau.vars["--recharge"]).toBe("0.5");
    expect(barre.vars["--recharge"]).toBe("0.5");
    expect(barre.attrs["aria-valuenow"]).toBe("50");
    expect(temps.textContent).toBe(`1${NBSP}s`);
    expect(trait.vars["--regen"]).toBe("0.4");
    expect(vitesse.textContent).toBe(`11${NBSP}m/s`);
    expect(kmh.textContent).toBe("87");
  });

  it("ne réécrit rien quand les valeurs n'ont pas changé", () => {
    const anneau = faux();
    let n = 0;
    anneau.style.setProperty = () => { n++; };
    const cache = cacheLiveVide();
    const c = { anneauRecharge: { current: anneau } };
    ecrireLive(live, c, cache);
    ecrireLive(live, c, cache);
    ecrireLive({ ...live, vitesse: 3 }, c, cache);
    expect(n).toBe(1);
    ecrireLive({ ...live, recharge: 0.75 }, c, cache);
    expect(n).toBe(2);
  });

  it("remplit un élément remonté entre deux images (texte vide) même si la valeur n'a pas changé", () => {
    const cache = cacheLiveVide();
    const a = faux();
    ecrireLive(live, { vitesse: { current: a } }, cache);
    const b = faux();
    ecrireLive(live, { vitesse: { current: b } }, cache);
    expect(b.textContent).toBe(`11${NBSP}m/s`);
  });

  it("ignore les éléments absents et borne les valeurs", () => {
    expect(() => ecrireLive({ recharge: 7, vitesse: -3, vitesseKmh: 0, regenDelai: -2 }, { anneauRecharge: { current: null }, vitesse: null }, cacheLiveVide())).not.toThrow();
    const a = faux();
    ecrireLive({ recharge: 7, vitesse: 0, vitesseKmh: 0, regenDelai: -2 }, { anneauRecharge: { current: a }, traitRegen: { current: a } }, cacheLiveVide());
    expect(a.vars["--recharge"]).toBe("1");
    expect(a.vars["--regen"]).toBe("0");
  });
});

describe("hud-modele : rupture du bouclier", () => {
  it("démarre au passage de > 0 à 0 pendant le combat, pas autrement", () => {
    expect(etapeRupture(40, 0, true)).toBe("demarrer");
    expect(etapeRupture(0, 0, true)).toBe("rien");
    expect(etapeRupture(40, 10, true)).toBe("rien");
    expect(etapeRupture(0, 30, true)).toBe("rien");
  });
  it("hors combat (mort, entracte) la rupture est annulée : ni minuteur perdu ni vignette bleue qui reste affichée (régression)", () => {
    // bouclier brisé, puis mort moins de 400 ms plus tard : le rendu suivant est « inactif » et doit tout remettre à faux
    expect(etapeRupture(0, 0, false)).toBe("annuler");
    expect(etapeRupture(40, 0, false)).toBe("annuler");
  });
});
