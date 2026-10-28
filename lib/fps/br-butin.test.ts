import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { STATS } from "./armes";
import {
  ARMES_PAR_RARETE, CHARGEURS_PAR_BOITE, CLASSES_MUNITIONS, ESPACEMENT_BUTIN_M, POIDS_RARETE_PAR_POOL, RARETES, REPARTITION_POOLS,
  appliquerRamassage, classeMunitions, genererButin, mulberry32, nbObjetsPour, raretePourArme,
} from "./br-butin";
import { construireMondeBr, pointsButin } from "./br-carte";
import { BR, EQUIPEMENT_DEPART_BR } from "./br-regles";
import { ARMES, copierEquipement, type ArmeFeuId, type Equipement, type ObjetBr, type PointButin, type PoolButin } from "./protocole";

/** Grille de points de pool donné : `n` points espacés de `pas` mètres sur une ligne qui commence en (x0, z0). */
function ligne(pool: PoolButin, n: number, pas: number, x0 = 0, z0 = 0, y = 0): PointButin[] {
  return Array.from({ length: n }, (_, i) => ({ p: [x0 + i * pas, y, z0], pool }));
}

/** Monde jouet : chaque pool a beaucoup de points bien espacés. */
function pointsJouet(): PointButin[] {
  return [
    ...ligne("interieur", 600, 3, 0, 0),
    ...ligne("toit", 600, 5, 0, 100, 8),
    ...ligne("facade", 600, 10, 0, 200),
    ...ligne("route", 600, 8, 0, 300),
  ];
}

const compter = <T>(l: readonly T[], f: (x: T) => string) => {
  const m: Record<string, number> = {};
  for (const x of l) m[f(x)] = (m[f(x)] ?? 0) + 1;
  return m;
};

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("tables", () => {
  it("la répartition des pools somme à 1 et reprend la spec", () => {
    expect(REPARTITION_POOLS).toEqual({ interieur: 0.45, toit: 0.10, facade: 0.30, route: 0.15 });
    expect(Object.values(REPARTITION_POOLS).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
  });

  it("poids de rareté par pool", () => {
    expect(POIDS_RARETE_PAR_POOL.interieur).toEqual([30, 30, 25, 15]);
    expect(POIDS_RARETE_PAR_POOL.toit).toEqual([35, 35, 22, 8]);
    expect(POIDS_RARETE_PAR_POOL.facade).toEqual([60, 28, 10, 2]);
    expect(POIDS_RARETE_PAR_POOL.route).toEqual([75, 20, 5, 0]);
  });

  it("les armes du butin existent au registre, sans rayon ni fumigène, sans doublon", () => {
    const toutes = RARETES.flatMap((r) => ARMES_PAR_RARETE[r]);
    expect(new Set(toutes).size).toBe(toutes.length);
    expect(toutes).not.toContain("rayon");
    expect(toutes).not.toContain("fumigene");
    for (const a of toutes) if (a !== "epee") expect(ARMES).toContain(a);
    expect(ARMES_PAR_RARETE.rare).toContain("epee");
  });

  it("raretePourArme est l'inverse de la table", () => {
    for (const r of RARETES) for (const a of ARMES_PAR_RARETE[r]) expect(raretePourArme(a)).toBe(r);
  });

  it("classeMunitions : trois classes, aucune pour les spéciales et uniques", () => {
    expect(classeMunitions("pistolet")).toBe("legeres");
    expect(classeMunitions("mini_uzi")).toBe("legeres");
    expect(classeMunitions("mitraillette")).toBe("legeres");
    expect(classeMunitions("fusil_assaut")).toBe("moyennes");
    expect(classeMunitions("mitrailleuse")).toBe("moyennes");
    expect(classeMunitions("pompe")).toBe("cartouches");
    expect(classeMunitions("revolver")).toBe("cartouches");
    expect(classeMunitions("sniper")).toBe("cartouches");
    for (const a of ["railgun", "minigun", "magnum_dore", "bazooka", "lance_grenades", "fumigene", "rayon"] as const) expect(classeMunitions(a)).toBeNull();
  });

  it("nbObjetsPour : 9 par joueur entre 120 et 480", () => {
    expect(nbObjetsPour(2)).toBe(120);
    expect(nbObjetsPour(13)).toBe(120);
    expect(nbObjetsPour(14)).toBe(126);
    expect(nbObjetsPour(50)).toBe(450);
    expect(nbObjetsPour(60)).toBe(480);
    expect(nbObjetsPour(1000)).toBe(480);
    expect(nbObjetsPour(0)).toBe(120);
  });

  it("mulberry32 est déterministe et reste dans [0, 1[", () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("genererButin", () => {
  const points = pointsJouet();

  it("est déterministe pour une graine, et change avec elle", () => {
    const a = genererButin(points, 1234, 300);
    expect(genererButin(points, 1234, 300)).toEqual(a);
    expect(genererButin(points, 1235, 300)).not.toEqual(a);
  });

  it("pose exactement le nombre demandé, ids 1..n uniques", () => {
    for (const nb of [1, 120, 450, 480]) {
      const l = genererButin(points, 7, nb);
      expect(l).toHaveLength(nb);
      expect(l.map((o) => o.id)).toEqual(Array.from({ length: nb }, (_, i) => i + 1));
    }
  });

  it("renvoie une liste vide sans point ou sans objet demandé", () => {
    expect(genererButin([], 1, 100)).toEqual([]);
    expect(genererButin(points, 1, 0)).toEqual([]);
  });

  it("répartit les objets par pool selon les quotas", () => {
    const l = genererButin(points, 99, 450);
    const parPool = compter(l, (o) => poolDe(points, o));
    expect(parPool.interieur).toBe(203); // 202,5 : somme exacte de 450 par plus forts restes
    expect(parPool.toit).toBe(45);
    expect(parPool.facade).toBe(135);
    expect(parPool.route).toBe(67);
    expect((parPool.interieur ?? 0) + parPool.toit + parPool.facade + parPool.route).toBe(450);
  });

  it("répartit les genres dans des tolérances (arme 46, munitions 24, bandage 18, potion 12)", () => {
    const l = genererButin(points, 5, 480);
    const g = compter(l, (o) => o.genre);
    expect(g.arme / 480).toBeGreaterThan(0.38);
    expect(g.arme / 480).toBeLessThan(0.54);
    expect(g.munitions / 480).toBeGreaterThan(0.17);
    expect(g.munitions / 480).toBeLessThan(0.31);
    expect(g.bandage / 480).toBeGreaterThan(0.12);
    expect(g.bandage / 480).toBeLessThan(0.24);
    expect(g.potion / 480).toBeGreaterThan(0.07);
    expect(g.potion / 480).toBeLessThan(0.18);
  });

  it("les références sont cohérentes avec le genre, sans rayon ni fumigène", () => {
    const l = genererButin(points, 11, 480);
    const toutes = new Set<string>(RARETES.flatMap((r) => ARMES_PAR_RARETE[r]));
    for (const o of l) {
      if (o.genre === "arme") expect(toutes.has(o.ref as string)).toBe(true);
      else if (o.genre === "munitions") expect(CLASSES_MUNITIONS).toContain(o.ref);
      else expect(o.ref).toBeNull();
      expect(o.ref).not.toBe("rayon");
      expect(o.ref).not.toBe("fumigene");
    }
  });

  it("n'a jamais deux objets à moins de 1,8 m", () => {
    // points volontairement serrés (1 m) pour que l'espacement soit contraignant
    const serres: PointButin[] = [...ligne("interieur", 400, 1), ...ligne("facade", 400, 1, 0, 50), ...ligne("route", 400, 1, 0, 100)];
    const l = genererButin(serres, 3, 200);
    expect(l.length).toBeGreaterThan(50);
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) expect(dist(l[i].p, l[j].p)).toBeGreaterThanOrEqual(ESPACEMENT_BUTIN_M - 1e-9);
  });

  it("l'espacement tient aussi à cheval sur une frontière de cellule de la grille", () => {
    const serres = ligne("route", 200, 0.5, -50);
    const l = genererButin(serres, 8, 40);
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) expect(dist(l[i].p, l[j].p)).toBeGreaterThanOrEqual(ESPACEMENT_BUTIN_M - 1e-9);
  });

  it("reverse le débordement d'un pool trop petit aux autres, au prorata", () => {
    // 10 points seulement à l'intérieur pour un quota de 90 : le manque (80) va aux autres pools
    const maigre: PointButin[] = [...ligne("interieur", 10, 3), ...ligne("toit", 300, 5, 0, 100, 8), ...ligne("facade", 300, 10, 0, 200), ...ligne("route", 300, 8, 0, 300)];
    const l = genererButin(maigre, 21, 200);
    expect(l).toHaveLength(200);
    const parPool = compter(l, (o) => poolDe(maigre, o));
    expect(parPool.interieur).toBe(10);
    // sans débordement : toit 20, facade 60, route 30 ; avec : 80 de plus au prorata 0,10 / 0,30 / 0,15
    expect(parPool.toit).toBeGreaterThan(20);
    expect(parPool.facade).toBeGreaterThan(60);
    expect(parPool.route).toBeGreaterThan(30);
    const supp = { toit: parPool.toit - 20, facade: parPool.facade - 60, route: parPool.route - 30 };
    expect(supp.toit + supp.facade + supp.route).toBe(80);
    expect(supp.facade).toBeGreaterThan(supp.route);
    expect(supp.route).toBeGreaterThan(supp.toit);
  });

  it("un pool absent reverse tout son quota", () => {
    const sansToit = pointsJouet().filter((p) => p.pool !== "toit");
    const l = genererButin(sansToit, 4, 450);
    expect(l).toHaveLength(450);
    expect(compter(l, (o) => poolDe(sansToit, o)).toit).toBeUndefined();
  });

  it("s'arrête quand il n'y a plus de point, sans boucler", () => {
    const peu = ligne("route", 5, 3);
    expect(genererButin(peu, 1, 450)).toHaveLength(5);
    // tous les points au même endroit : un seul objet
    const empiles: PointButin[] = Array.from({ length: 50 }, () => ({ p: [1, 0, 1] as [number, number, number], pool: "facade" as const }));
    expect(genererButin(empiles, 1, 100)).toHaveLength(1);
  });

  it("ne mute pas les points reçus", () => {
    const pts = pointsJouet();
    const copie = JSON.stringify(pts);
    const l = genererButin(pts, 17, 200);
    expect(JSON.stringify(pts)).toBe(copie);
    l[0].p[0] = 99999;
    expect(JSON.stringify(pts)).toBe(copie);
  });

  it("raretés : rare + légendaire plus fréquents à l'intérieur que sur les toits, façade et route moins bien lotis", () => {
    // 10 000 tirages d'armes par pool : un point par butin, le genre arme est isolé
    const part = (pool: PoolButin) => {
      const pts = ligne(pool, 10_000, 2);
      let armes = 0, hauts = 0;
      const parRarete: Record<string, number> = {};
      for (let g = 0; g < 4; g++) {
        for (const o of genererButin(pts, 1000 + g, 480)) {
          if (o.genre !== "arme") continue;
          armes++;
          const r = raretePourArme(o.ref as ArmeFeuId | "epee");
          parRarete[r] = (parRarete[r] ?? 0) + 1;
          if (r === "rare" || r === "legendaire") hauts++;
        }
      }
      return { armes, part: hauts / armes, parRarete };
    };
    const interieur = part("interieur"), toit = part("toit"), facade = part("facade"), route = part("route");
    expect(interieur.armes).toBeGreaterThan(700);
    expect(interieur.part).toBeGreaterThan(toit.part);
    expect(toit.part).toBeGreaterThan(facade.part);
    expect(facade.part).toBeGreaterThan(route.part);
    // proches des poids : intérieur 40 %, toit 30 %, façade 12 %, route 5 %
    expect(interieur.part).toBeGreaterThan(0.33);
    expect(interieur.part).toBeLessThan(0.47);
    expect(toit.part).toBeGreaterThan(0.23);
    expect(toit.part).toBeLessThan(0.37);
    expect(route.parRarete.legendaire).toBeUndefined();
  });

  it("raretés sur 10 000 tirages d'un même pool (somme des graines)", () => {
    const pts = ligne("interieur", 20_000, 2);
    const n = { commun: 0, peu_commun: 0, rare: 0, legendaire: 0 };
    let armes = 0;
    for (let g = 0; armes < 10_000; g++) {
      for (const o of genererButin(pts, 50 + g, 480)) {
        if (o.genre !== "arme") continue;
        n[raretePourArme(o.ref as ArmeFeuId | "epee")]++;
        armes++;
      }
    }
    expect(n.commun / armes).toBeCloseTo(0.30, 1);
    expect(n.peu_commun / armes).toBeCloseTo(0.30, 1);
    expect(n.rare / armes).toBeCloseTo(0.25, 1);
    expect(n.legendaire / armes).toBeCloseTo(0.15, 1);
  });
});

/** Pool d'un objet : celui du point d'où il vient (coordonnées exactes). */
function poolDe(points: readonly PointButin[], o: ObjetBr): string {
  const pt = points.find((q) => q.p[0] === o.p[0] && q.p[1] === o.p[1] && q.p[2] === o.p[2]);
  if (!pt) throw new Error(`objet ${o.id} hors des points`);
  return pt.pool;
}

describe("genererButin sur les vrais points", () => {
  it("l'intérieur couvre son quota à 50 joueurs et l'espacement tient", () => {
    const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
    const monde = construireMondeBr(scene);
    const pts = pointsButin(scene, monde);
    const nb = nbObjetsPour(50);
    const quota = Math.round(REPARTITION_POOLS.interieur * nb);
    expect(pts.filter((p) => p.pool === "interieur").length).toBeGreaterThanOrEqual(quota);
    for (const graine of [1, 2, 3]) {
      const l = genererButin(pts, graine, nb);
      expect(l).toHaveLength(nb);
      const interieur = l.filter((o) => pts.find((q) => q.p[0] === o.p[0] && q.p[1] === o.p[1] && q.p[2] === o.p[2])?.pool === "interieur").length;
      expect(interieur).toBeGreaterThanOrEqual(quota);
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) expect(dist(l[i].p, l[j].p)).toBeGreaterThanOrEqual(ESPACEMENT_BUTIN_M - 1e-9);
    }
  });
});

describe("appliquerRamassage", () => {
  const SANS_SOINS = { bandage: 0, potion: 0 };
  const depart = (): Equipement => copierEquipement(EQUIPEMENT_DEPART_BR);
  const arme = (ref: ArmeFeuId | "epee", id = 1): ObjetBr => ({ id, genre: "arme", ref, p: [0, 0, 0] });
  const boite = (ref: "legeres" | "moyennes" | "cartouches"): ObjetBr => ({ id: 2, genre: "munitions", ref, p: [0, 0, 0] });

  it("ne modifie pas l'équipement reçu", () => {
    const eq = depart();
    const avant = JSON.stringify(eq);
    const r = appliquerRamassage(eq, SANS_SOINS, arme("pompe"));
    expect(JSON.stringify(eq)).toBe(avant);
    expect(r.equip).not.toBe(eq);
  });

  it("une principale prend le slot principale, retire sansPrincipale et passe en main (rien ne tombe)", () => {
    const r = appliquerRamassage(depart(), SANS_SOINS, arme("fusil_assaut"));
    expect(r.ok).toBe(true);
    expect(r.equip?.principale).toBe("fusil_assaut");
    expect(r.equip?.sansPrincipale).toBeUndefined();
    expect(r.equip?.sansSecondaire).toBe(true); // l'autre slot reste vide
    expect(r.main).toBe("principale");
    expect(r.lache).toBeUndefined();
  });

  it("une secondaire prend le slot secondaire et retire sansSecondaire", () => {
    const r = appliquerRamassage(depart(), SANS_SOINS, arme("revolver"));
    expect(r.ok).toBe(true);
    expect(r.equip?.secondaire).toBe("revolver");
    expect(r.equip?.sansSecondaire).toBeUndefined();
    expect(r.equip?.sansPrincipale).toBe(true);
    expect(r.main).toBe("secondaire");
    expect(r.lache).toBeUndefined();
  });

  it("échange : l'arme remplacée tombe aux pieds, la nouvelle passe en main", () => {
    const eq = { ...depart(), principale: "pompe" as const };
    delete eq.sansPrincipale;
    const r = appliquerRamassage(eq, SANS_SOINS, arme("sniper"));
    expect(r.equip?.principale).toBe("sniper");
    expect(r.lache).toEqual([{ genre: "arme", ref: "pompe" }]);
    expect(r.main).toBe("principale");

    const eqS = { ...depart(), secondaire: "pistolet" as const };
    delete eqS.sansSecondaire;
    const rS = appliquerRamassage(eqS, SANS_SOINS, arme("mini_uzi"));
    expect(rS.equip?.secondaire).toBe("mini_uzi");
    expect(rS.lache).toEqual([{ genre: "arme", ref: "pistolet" }]);
  });

  it("l'épée remplace l'arme blanche sans lâcher le couteau, et la main passe au slot couteau", () => {
    const r = appliquerRamassage(depart(), SANS_SOINS, arme("epee"));
    expect(r.ok).toBe(true);
    expect(r.equip?.melee).toBe("epee");
    expect(r.main).toBe("couteau");
    expect(r.lache).toBeUndefined();
  });

  it("une épée déjà portée est inutile", () => {
    const eq = { ...depart(), melee: "epee" as const };
    expect(appliquerRamassage(eq, SANS_SOINS, arme("epee"))).toEqual({ ok: false, raison: "inutile" });
  });

  it("une spéciale va dans le slot spécial avec son chargeur plein ; une unique aussi", () => {
    for (const a of ["railgun", "minigun", "magnum_dore", "lance_grenades", "bazooka"] as const) {
      const r = appliquerRamassage(depart(), SANS_SOINS, arme(a));
      expect(r.ok).toBe(true);
      expect(r.equip?.speciale).toBe(a);
      expect(r.munSpeciale).toBe(STATS[a].chargeur);
      expect(r.main).toBe("speciale");
      expect(r.lache).toBeUndefined();
    }
    expect(STATS.railgun.chargeur).toBe(6);
    expect(STATS.minigun.chargeur).toBe(150);
    expect(STATS.bazooka.chargeur).toBe(3);
  });

  it("une spéciale en remplace une autre, qui tombe ; la même spéciale remplit le chargeur sans rien lâcher", () => {
    const eq = { ...depart(), speciale: "railgun" as const };
    const r = appliquerRamassage(eq, SANS_SOINS, arme("minigun"));
    expect(r.equip?.speciale).toBe("minigun");
    expect(r.lache).toEqual([{ genre: "arme", ref: "railgun" }]);
    expect(r.munSpeciale).toBe(150);
    const meme = appliquerRamassage(eq, SANS_SOINS, arme("railgun"));
    expect(meme.ok).toBe(true);
    expect(meme.lache).toBeUndefined();
    expect(meme.munSpeciale).toBe(6);
  });

  it("la même arme à feu donne +1 chargeur, sans échange ni changement de main", () => {
    const eq = { ...depart(), principale: "pompe" as const, secondaire: "revolver" as const };
    delete eq.sansPrincipale;
    delete eq.sansSecondaire;
    const p = appliquerRamassage(eq, SANS_SOINS, arme("pompe"));
    expect(p).toMatchObject({ ok: true, ajoutMunitions: { arme: "pompe", chargeurs: 1 } });
    expect(p.main).toBeUndefined();
    expect(p.lache).toBeUndefined();
    const s = appliquerRamassage(eq, SANS_SOINS, arme("revolver"));
    expect(s).toMatchObject({ ok: true, ajoutMunitions: { arme: "revolver", chargeurs: 1 } });
  });

  it("un slot vide dont la valeur de remplissage égale l'arme ramassée la prend vraiment (pas de +1 chargeur)", () => {
    // EQUIPEMENT_DEPART_BR : principale "mitraillette" (remplissage) et secondaire "pistolet" (remplissage)
    const r = appliquerRamassage(depart(), SANS_SOINS, arme("mitraillette"));
    expect(r.ajoutMunitions).toBeUndefined();
    expect(r.main).toBe("principale");
    const s = appliquerRamassage(depart(), SANS_SOINS, arme("pistolet"));
    expect(s.ajoutMunitions).toBeUndefined();
    expect(s.main).toBe("secondaire");
  });

  it("refuse le rayon, le fumigène et les références incohérentes", () => {
    expect(appliquerRamassage(depart(), SANS_SOINS, arme("rayon"))).toEqual({ ok: false, raison: "inconnu" });
    expect(appliquerRamassage(depart(), SANS_SOINS, arme("fumigene"))).toEqual({ ok: false, raison: "inconnu" });
    expect(appliquerRamassage(depart(), SANS_SOINS, { id: 1, genre: "arme", ref: null, p: [0, 0, 0] })).toEqual({ ok: false, raison: "inconnu" });
    expect(appliquerRamassage(depart(), SANS_SOINS, { id: 1, genre: "arme", ref: "legeres", p: [0, 0, 0] })).toEqual({ ok: false, raison: "inconnu" });
    expect(appliquerRamassage(depart(), SANS_SOINS, { id: 1, genre: "munitions", ref: "pistolet", p: [0, 0, 0] })).toEqual({ ok: false, raison: "inconnu" });
  });

  describe("munitions", () => {
    it("sans arme à feu portée, la boîte est refusée", () => {
      for (const c of CLASSES_MUNITIONS) expect(appliquerRamassage(depart(), SANS_SOINS, boite(c))).toEqual({ ok: false, raison: "inutile" });
    });

    it("donne +2 chargeurs à la principale de la classe", () => {
      const eq = { ...depart(), principale: "fusil_assaut" as const };
      delete eq.sansPrincipale;
      const r = appliquerRamassage(eq, SANS_SOINS, boite("moyennes"));
      expect(r.ok).toBe(true);
      expect(r.ajoutMunitions).toEqual({ arme: "fusil_assaut", chargeurs: CHARGEURS_PAR_BOITE });
      expect(CHARGEURS_PAR_BOITE).toBe(2);
      expect(r.equip).toEqual(eq);
    });

    it("à défaut de principale compatible, la secondaire de la classe", () => {
      const eq = { ...depart(), secondaire: "revolver" as const };
      delete eq.sansSecondaire;
      expect(appliquerRamassage(eq, SANS_SOINS, boite("cartouches")).ajoutMunitions).toEqual({ arme: "revolver", chargeurs: 2 });
      // principale d'une autre classe : la secondaire reste la cible
      const eq2 = { ...eq, principale: "mitraillette" as const };
      delete eq2.sansPrincipale;
      expect(appliquerRamassage(eq2, SANS_SOINS, boite("cartouches")).ajoutMunitions?.arme).toBe("revolver");
      expect(appliquerRamassage(eq2, SANS_SOINS, boite("legeres")).ajoutMunitions?.arme).toBe("mitraillette");
    });

    it("la principale prime quand les deux armes sont de la classe", () => {
      const eq = { ...depart(), principale: "mitraillette" as const, secondaire: "pistolet" as const };
      delete eq.sansPrincipale;
      delete eq.sansSecondaire;
      expect(appliquerRamassage(eq, SANS_SOINS, boite("legeres")).ajoutMunitions?.arme).toBe("mitraillette");
    });

    it("la valeur de remplissage d'un slot vide ne compte pas", () => {
      // principale "mitraillette" (légères) en remplissage, mais sansPrincipale : la boîte de légères est inutile
      expect(appliquerRamassage(depart(), SANS_SOINS, boite("legeres")).ok).toBe(false);
    });

    it("une spéciale seule n'accepte aucune boîte (pas de réserve)", () => {
      const eq = { ...depart(), speciale: "minigun" as const };
      for (const c of CLASSES_MUNITIONS) expect(appliquerRamassage(eq, SANS_SOINS, boite(c)).ok).toBe(false);
    });
  });

  describe("soins", () => {
    const soin = (genre: "bandage" | "potion", qte?: number): ObjetBr => ({ id: 3, genre, ref: null, p: [0, 0, 0], ...(qte !== undefined ? { qte } : {}) });

    it("un bandage s'ajoute à la pile, la potion à la sienne, sans toucher l'autre", () => {
      const b = appliquerRamassage(depart(), { bandage: 1, potion: 2 }, soin("bandage"));
      expect(b).toMatchObject({ ok: true, soins: { bandage: 2 } });
      expect(b.soins?.potion).toBeUndefined();
      const p = appliquerRamassage(depart(), { bandage: 1, potion: 2 }, soin("potion"));
      expect(p).toMatchObject({ ok: true, soins: { potion: 3 } });
      expect(p.soins?.bandage).toBeUndefined();
      expect(b.reste).toBeUndefined();
    });

    it("la pile de bandages plafonne à 5, celle de potions à 3", () => {
      expect(BR.usage.bandage.pile).toBe(5);
      expect(BR.usage.potion.pile).toBe(3);
      expect(appliquerRamassage(depart(), { bandage: 5, potion: 0 }, soin("bandage"))).toEqual({ ok: false, raison: "inutile" });
      expect(appliquerRamassage(depart(), { bandage: 0, potion: 3 }, soin("potion"))).toEqual({ ok: false, raison: "inutile" });
      expect(appliquerRamassage(depart(), { bandage: 4, potion: 0 }, soin("bandage")).soins?.bandage).toBe(5);
    });

    it("un objet lâché à la mort porte sa quantité ; ce qui ne tient pas reste au sol", () => {
      const r = appliquerRamassage(depart(), { bandage: 1, potion: 0 }, soin("bandage", 3));
      expect(r.soins?.bandage).toBe(4);
      expect(r.reste).toBeUndefined();
      const trop = appliquerRamassage(depart(), { bandage: 3, potion: 0 }, soin("bandage", 4));
      expect(trop.ok).toBe(true);
      expect(trop.soins?.bandage).toBe(5);
      expect(trop.reste).toBe(2);
      const potions = appliquerRamassage(depart(), { bandage: 0, potion: 2 }, soin("potion", 3));
      expect(potions.soins?.potion).toBe(3);
      expect(potions.reste).toBe(2);
    });

    it("une quantité invalide compte pour 1", () => {
      expect(appliquerRamassage(depart(), SANS_SOINS, soin("bandage", 0)).soins?.bandage).toBe(1);
      expect(appliquerRamassage(depart(), SANS_SOINS, soin("potion", NaN)).soins?.potion).toBe(1);
    });
  });

  it("toutes les armes du butin se ramassent depuis le départ", () => {
    for (const r of RARETES) for (const a of ARMES_PAR_RARETE[r]) {
      const res = appliquerRamassage(depart(), SANS_SOINS, arme(a));
      expect(res.ok, a).toBe(true);
      expect(res.main, a).toBeDefined();
    }
  });
});
