import { describe, it, expect } from "vitest";
import {
  tirerReaction, POIDS_REACTIONS, texteBulle, TEXTES, decisionClic, passageAutorise,
  positionCourante, demiTour, hauteurSaut, imagesSaut, creerParticules, DUREES,
  DUREE_DEMI_TOUR_MIN_MS, DELAI_BULLE, humeurRegard, immobilise, VITESSE_CONTENT, VITESSE_VEXE, type Reaction, type CleTexte,
} from "./tigre-reactions";
import { ECART_MIN_MS, passage } from "./tigre-courant";

describe("tirerReaction", () => {
  it("a les 5 réactions d'origine et au moins 3 nouvelles, de poids total 1", () => {
    expect(POIDS_REACTIONS.length).toBeGreaterThanOrEqual(8);
    const noms = POIDS_REACTIONS.map(([r]) => r);
    for (const r of ["regard", "saut", "tape", "sursaut", "ronron"]) expect(noms).toContain(r);
    expect(POIDS_REACTIONS.reduce((s, [, p]) => s + p, 0)).toBeCloseTo(1, 10);
  });

  it("suit les poids du tirage", () => {
    expect(tirerReaction(0)).toBe("regard");
    expect(tirerReaction(0.149)).toBe("regard");
    expect(tirerReaction(0.16)).toBe("saut");
    expect(tirerReaction(0.4)).toBe("tape");
    expect(tirerReaction(0.5)).toBe("sursaut");
    expect(tirerReaction(0.55)).toBe("ronron");
    expect(tirerReaction(0.65)).toBe("rugir");
    expect(tirerReaction(0.7)).toBe("salut");
    expect(tirerReaction(0.8)).toBe("lecher");
    expect(tirerReaction(0.85)).toBe("etirement");
    expect(tirerReaction(0.95)).toBe("serre-main");
    expect(tirerReaction(0.999999)).toBe("serre-main");
  });

  it("atteint chaque réaction de poids non nul", () => {
    const vues = new Set<Reaction>();
    for (let a = 0; a < 1; a += 0.01) vues.add(tirerReaction(a));
    expect(vues.size).toBe(POIDS_REACTIONS.filter(([, p]) => p > 0).length);
  });

  it("ne tire jamais la batte, même par le report sur la suivante de la liste", () => {
    expect(POIDS_REACTIONS.find(([r]) => r === "batte")?.[1]).toBe(0);
    for (const precedente of [null, ...POIDS_REACTIONS.map(([r]) => r)]) {
      for (let a = 0; a < 1; a += 0.005) expect(tirerReaction(a, precedente)).not.toBe("batte");
    }
    expect(tirerReaction(0.999999, "serre-main")).toBe("regard");
  });

  it("ne répète jamais la réaction précédente", () => {
    for (const [reaction] of POIDS_REACTIONS) {
      for (let a = 0; a < 1; a += 0.01) expect(tirerReaction(a, reaction)).not.toBe(reaction);
    }
  });

  it("passe à la suivante de la liste, en bouclant", () => {
    expect(tirerReaction(0, "regard")).toBe("saut");
    expect(tirerReaction(0.999, "serre-main")).toBe("regard");
    expect(tirerReaction(0.85, "etirement")).toBe("serre-main");
  });
});

describe("texteBulle", () => {
  it("donne un texte de la liste, aux deux bornes du tirage", () => {
    for (const [cle, textes] of Object.entries(TEXTES)) {
      expect(textes.length).toBeGreaterThan(0);
      expect(textes).toContain(texteBulle(cle as CleTexte, 0));
      expect(textes).toContain(texteBulle(cle as CleTexte, 0.999999));
    }
  });

  it("chaque nouvelle réaction a une bulle qui dit ce que fait le tigre", () => {
    expect(TEXTES.rugir.join(" ")).toMatch(/ROAAR/i);
    expect(TEXTES.salut.join(" ")).toMatch(/Coucou|Salut/);
    expect(TEXTES.lecher.join(" ")).toMatch(/Slurp|toilette/);
    expect(TEXTES.etirement.join(" ")).toMatch(/sieste|bien/);
    expect(TEXTES["serre-main"].join(" ")).toMatch(/pince|Bravo/);
  });

  it("l'humeur du regard suit le texte de la bulle", () => {
    expect(humeurRegard("Grrr ?")).toBe("grognon");
    expect(humeurRegard("Tu veux ma photo ?")).toBe("fier");
    expect(humeurRegard("Miaou.")).toBe("miaou");
    for (const t of TEXTES.regard) expect(["curieux", "fier", "grognon", "miaou", "vexe"]).toContain(humeurRegard(t));
    expect(humeurRegard("texte inconnu")).toBe("curieux");
  });

  it("garde les textes de la tape dans la main", () => {
    expect(TEXTES.tape).toContain("Tape-m'en cinq !");
    expect(TEXTES.clap).toEqual(["🐾 Clap !"]);
  });
});

describe("decisionClic (anti-spam)", () => {
  it("lance une réaction quand le tigre est libre", () => {
    expect(decisionClic(null, false)).toBe("lancer");
  });

  it("ignore les clics pendant une réaction", () => {
    for (const r of ["regard", "saut", "sursaut", "ronron", "rugir", "salut", "lecher", "etirement", "serre-main"] as Reaction[]) {
      expect(decisionClic(r, false)).toBe("ignorer");
      expect(decisionClic(r, true)).toBe("ignorer");
    }
  });

  it("valide la tape pendant la fenêtre, pas avant ni après", () => {
    expect(decisionClic("tape", true)).toBe("taper");
    expect(decisionClic("tape", false)).toBe("ignorer");
  });
});

describe("réactions : durées, bulles, immobilisation", () => {
  const toutes = POIDS_REACTIONS.map(([r]) => r);

  it("chaque réaction a une durée, un texte et un instant de bulle dans sa durée", () => {
    for (const r of toutes) {
      const duree = r === "tape" ? DUREES.entreeTape + DUREES.fenetreTape : DUREES[r];
      expect(duree).toBeGreaterThan(0);
      expect(TEXTES[r].length).toBeGreaterThan(0);
      expect(DELAI_BULLE[r]).toBeGreaterThanOrEqual(0);
      expect(DELAI_BULLE[r]).toBeLessThan(duree);
    }
  });

  it("le tigre s'immobilise sauf pour le saut et le sursaut", () => {
    expect(immobilise("saut")).toBe(false);
    expect(immobilise("sursaut")).toBe(false);
    for (const r of toutes.filter((x) => x !== "saut" && x !== "sursaut")) expect(immobilise(r)).toBe(true);
  });
});

describe("passageAutorise", () => {
  it("attend la fin du passage en cours et de la réaction", () => {
    expect(passageAutorise(false, null)).toBe(true);
    expect(passageAutorise(true, null)).toBe(false);
    expect(passageAutorise(false, "tape")).toBe(false);
    expect(passageAutorise(true, "saut")).toBe(false);
  });
});

describe("durées et vitesses", () => {
  it("la tape laisse le temps de réagir, le clap rend content, le dépit ralentit", () => {
    expect(DUREES.fenetreTape).toBeGreaterThanOrEqual(2000);
    expect(VITESSE_CONTENT).toBeGreaterThan(1);
    expect(VITESSE_VEXE).toBeLessThan(1);
  });
});

describe("positionCourante", () => {
  const versDroite = { sens: 1 as const, deX: -180, aX: 1440, dureeMs: 4000 };

  it("interpole entre départ et arrivée, bornée", () => {
    expect(positionCourante(versDroite, 0)).toBe(-180);
    expect(positionCourante(versDroite, 2000)).toBe(630);
    expect(positionCourante(versDroite, 4000)).toBe(1440);
    expect(positionCourante(versDroite, 9000)).toBe(1440);
    expect(positionCourante(versDroite, -5)).toBe(-180);
  });

  it("marche aussi de droite à gauche", () => {
    expect(positionCourante({ sens: -1, deX: 1440, aX: -180, dureeMs: 4000 }, 1000)).toBe(1035);
  });
});

describe("demiTour", () => {
  it("repart de la position courante dans l'autre sens, vers la sortie opposée", () => {
    const aller = passage(1440, 180, 180, "normal", 0.9, 0.5);
    const retour = demiTour(aller, aller.dureeMs / 2, 1440, 180, 180, 0.5);
    expect(retour.sens).toBe(-1);
    expect(retour.deX).toBeCloseTo(630, 0);
    expect(retour.aX).toBe(-180);
  });

  it("repart vers la droite quand il courait vers la gauche", () => {
    const aller = passage(1440, 180, 180, "normal", 0.1, 0.5);
    const retour = demiTour(aller, aller.dureeMs / 4, 1440, 180, 180, 0.5);
    expect(retour.sens).toBe(1);
    expect(retour.aX).toBe(1440);
    expect(retour.deX).toBeCloseTo(1440 - 0.25 * 1620, 0);
  });

  it("file à vitesse d'éclair, plus vite que l'aller, et finit avant le passage suivant", () => {
    const aller = passage(1440, 180, 180, "normal", 0.9, 0.999);
    const retour = demiTour(aller, aller.dureeMs * 0.6, 1440, 180, 180, 0);
    expect(retour.dureeMs).toBeLessThan(ECART_MIN_MS);
    expect(Math.abs(retour.aX - retour.deX) / retour.dureeMs)
      .toBeGreaterThan(Math.abs(aller.aX - aller.deX) / aller.dureeMs);
  });

  it("garde une durée minimale quand il est déjà collé à la sortie visée", () => {
    // Arrivé au bord droit, il repart vers la gauche : sortie à -180, mais s'il
    // se trouvait déjà sur cette abscisse, la distance serait nulle.
    const collee = demiTour({ sens: -1, deX: 1440, aX: -180, dureeMs: 4000 }, 4000, 1440, 180, 180, 0.999);
    expect(collee.sens).toBe(1);
    expect(collee.deX).toBe(-180);
    const proche = demiTour({ sens: 1, deX: -180, aX: 1440, dureeMs: 4000 }, 3999, 1440, 180, 180, 0.999);
    expect(proche.aX).toBe(-180);
    expect(proche.dureeMs).toBeGreaterThanOrEqual(DUREE_DEMI_TOUR_MIN_MS);
    const nul = demiTour({ sens: -1, deX: 1440, aX: -180, dureeMs: 4000 }, 4000, 1440, 180, 180, 0.999);
    expect(nul.dureeMs).toBeGreaterThanOrEqual(DUREE_DEMI_TOUR_MIN_MS);
  });

  it("deux demi-tours de suite ramènent dans le sens d'origine", () => {
    const aller = passage(1440, 180, 180, "normal", 0.9, 0.5);
    const retour = demiTour(aller, 1500, 1440, 180, 180, 0.5);
    expect(demiTour(retour, 100, 1440, 180, 180, 0.5).sens).toBe(aller.sens);
  });
});

describe("saut", () => {
  it("monte puis redescend, hauteur proportionnelle et plafonnée", () => {
    expect(hauteurSaut(120)).toBe(60);
    expect(hauteurSaut(190)).toBe(95);
    expect(hauteurSaut(1000)).toBe(110);
    const images = imagesSaut(80);
    expect(images).toHaveLength(3);
    expect(images[1].transform).toContain("translateY(-80px)");
    expect(images[0].transform).toBe(images[2].transform);
  });
});

describe("creerParticules", () => {
  const fixe = () => 0.5;

  it("crée le nombre demandé, avec des ids consécutifs", () => {
    const p = creerParticules("clap", 6, 10, fixe);
    expect(p).toHaveLength(6);
    expect(p.map((x) => x.id)).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it("le clap éclate dans toutes les directions", () => {
    const p = creerParticules("clap", 8, 0, fixe);
    expect(p.some((x) => x.dx > 0)).toBe(true);
    expect(p.some((x) => x.dx < 0)).toBe(true);
    expect(p.some((x) => x.dy > 0)).toBe(true);
    expect(p.some((x) => x.dy < 0)).toBe(true);
  });

  it("les cœurs du ronron montent, en décalé", () => {
    const p = creerParticules("ronron", 4, 0, fixe);
    expect(p.every((x) => x.dy < 0 && x.glyphe === "♥")).toBe(true);
    expect(p[3].retardMs).toBeGreaterThan(p[0].retardMs);
  });

  it("les Z de la sieste montent aussi", () => {
    const p = creerParticules("zzz", 3, 0, fixe);
    expect(p.every((x) => x.dy < 0 && /z/i.test(x.glyphe))).toBe(true);
  });
});
