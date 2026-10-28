import { describe, expect, it } from "vitest";
import {
  STATS, estZombiesSeulement, niveauxZoom, nomAffiche, nomCourtZombie, nomZombie, signatureAmelioration, statsTir, viseurLunette,
} from "./armes";
import { ARMES, ARMES_PRINCIPALES, ARMES_PRINCIPALES_ZOMBIES, ARMES_SECONDAIRES, ARMES_SECONDAIRES_ZOMBIES, ARMES_SPECIALES, ARMES_UNIQUES } from "./protocole";

describe("(v8) armes des zombies", () => {
  it("huit armes nouvelles, toutes réservées aux zombies, principales ou secondaires", () => {
    expect(ARMES_PRINCIPALES_ZOMBIES.length + ARMES_SECONDAIRES_ZOMBIES.length - 1).toBeGreaterThanOrEqual(8);
    for (const a of [...ARMES_PRINCIPALES_ZOMBIES, ...ARMES_SECONDAIRES_ZOMBIES]) {
      expect(STATS[a].zombiesSeulement, a).toBe(true);
      expect(estZombiesSeulement(a)).toBe(true);
    }
    for (const a of ARMES_PRINCIPALES_ZOMBIES) expect(STATS[a].categorie).toBe("principale");
    for (const a of ARMES_SECONDAIRES_ZOMBIES) expect(STATS[a].categorie).toBe("secondaire");
    // l'arène ne voit aucune d'elles
    for (const a of [...ARMES_PRINCIPALES, ...ARMES_SECONDAIRES, ...ARMES_SPECIALES, ...ARMES_UNIQUES]) expect(estZombiesSeulement(a)).toBe(false);
  });

  it("effets de base de BO1 : l'arbalète tire un carreau, la Soufflerie souffle, le Grille-pain foudroie en chaîne", () => {
    expect(STATS.brochette.zombie.projectile?.delaiMs).toBeGreaterThan(0);
    expect(STATS.brochette.zombie.explosion).toBeDefined();
    const s = STATS.soufflerie.zombie.souffle!;
    expect(s.porteeMortelle).toBeLessThan(s.portee);
    expect(s.rayonFin).toBeGreaterThan(s.rayonDebut);
    expect(STATS.grille_pain.zombie.arc!.sauts).toBeGreaterThanOrEqual(9);
    expect(STATS.baguette.plombs).toBeGreaterThan(1);
    expect(STATS.photocopieuse.zombie.chargeur).toBe(71);
  });
});

describe("(v8) Pack-a-Punch qui change l'arme", () => {
  const amelioreesPossibles = ARMES.filter((a) => STATS[a].categorie !== "unique");

  it("chaque arme améliorée a un nom de plat et un nom court du rack (≤ 10 caractères, uniques, différents des noms de base)", () => {
    const courts = ARMES.map((a) => STATS[a].zombie.ameliore.nomCourt);
    for (const c of courts) { expect(c.length, c).toBeLessThanOrEqual(10); expect(c.length).toBeGreaterThan(0); }
    expect(new Set(courts).size).toBe(courts.length);
    const base = new Set(ARMES.map((a) => STATS[a].nomCourt));
    for (const c of courts) expect(base.has(c), c).toBe(false);
    for (const a of ARMES) {
      expect(nomCourtZombie(a, true)).toBe(STATS[a].zombie.ameliore.nomCourt);
      expect(nomCourtZombie(a, false)).toBe(STATS[a].nomCourt);
      expect(nomZombie(a, true)).not.toBe(STATS[a].nom);
    }
    expect(nomAffiche("pistolet", ["pistolet"])).toBe("Moutarde & Sally");
    expect(nomAffiche("pistolet", [])).toBe("Pistolet");
    expect(nomAffiche("pistolet")).toBe("Pistolet");
    expect(nomAffiche("epee", ["pistolet"])).toBe("Épée");
  });

  it("chaque arme améliorée a au moins un effet NON scalaire, et sa signature est propre (deux armes gratinées ne se ressemblent pas)", () => {
    const vues = new Map<string, string>();
    for (const a of amelioreesPossibles) {
      const sig = signatureAmelioration(a);
      expect(sig.length, a).toBeGreaterThan(0);
      const cle = sig.join("+");
      expect(vues.get(cle), `${a} a la même signature que ${vues.get(cle)} : ${cle}`).toBeUndefined();
      vues.set(cle, a);
    }
  });

  it("effets de BO1 : Mustang & Sally (akimbo à grenades), Cobra, Porter's X2 électrique, Thundergun, monkey bolt, CZ75 akimbo auto", () => {
    expect(signatureAmelioration("pistolet")).toEqual(expect.arrayContaining(["akimbo", "projectile", "explosive"]));
    expect(signatureAmelioration("perforeuse")).toEqual(expect.arrayContaining(["akimbo", "auto"]));
    expect(signatureAmelioration("revolver")).toEqual(expect.arrayContaining(["incendiaire", "viseur:point_rouge"]));
    expect(signatureAmelioration("rayon")).toEqual(["electrique"]);
    expect(signatureAmelioration("sniper")).toEqual(expect.arrayContaining(["perce", "viseur:thermique"]));
    expect(signatureAmelioration("brochette")).toEqual(["leurre"]);
    expect(signatureAmelioration("soufflerie")).toEqual(["gel"]);
    // la Moutarde tire deux fois plus (deux armes) mais chaque arme garde 0,2 s (BO1 : fireTime 0,2)
    expect(STATS.pistolet.zombie.ameliore.cadenceS).toBe(0.2);
  });

  it("statsTir : identique à STATS dans l'arène, et en zombies sans amélioration pour les armes de l'arène", () => {
    for (const a of ARMES) {
      const st = statsTir(a);
      expect(st.cadenceS).toBe(STATS[a].cadenceS);
      expect(st.auto).toBe(STATS[a].auto);
      expect(st.akimbo).toBe(false);
      expect(st.projectile).toBe(false);
      expect(st.souffle).toBe(false);
      expect(st.ricochets).toBe(0);
      expect(st.viseur).toBe(a === "sniper" ? "lunette" : "fer");
      expect(st.zooms).toEqual(niveauxZoom(a));
      const z = statsTir(a, { zombies: true });
      expect(z.cadenceS).toBe(STATS[a].cadenceS);
      expect(z.auto).toBe(STATS[a].auto);
      expect(z.akimbo).toBe(false);
    }
  });

  it("statsTir amélioré : cadence et auto propres, viseur, lunette à niveaux, akimbo, projectile, ricochets bornés", () => {
    const opts = { zombies: true, ameliore: true };
    expect(statsTir("essoreuse", opts)).toMatchObject({ auto: true, cadenceS: 0.22 });
    expect(statsTir("pistolet", opts)).toMatchObject({ akimbo: true, projectile: true, cadenceS: 0.2 });
    expect(statsTir("fusil_assaut", opts)).toMatchObject({ viseur: "lunette", zooms: [53.13, 36.87], zoomDefaut: 0 });
    expect(viseurLunette(statsTir("fusil_assaut", opts).viseur)).toBe(true);
    expect(statsTir("sniper", opts).viseur).toBe("thermique");
    expect(statsTir("mitraillette", opts).viseur).toBe("holo");
    expect(viseurLunette(statsTir("mitraillette", opts).viseur)).toBe(false);
    expect(statsTir("mini_uzi", opts).ricochets).toBe(2);
    expect(statsTir("soufflerie", { zombies: true }).souffle).toBe(true);
    expect(statsTir("brochette", { zombies: true }).projectile).toBe(true);
    // jamais rien d'amélioré dans l'arène, même si l'appelant le demande
    expect(statsTir("pistolet", { ameliore: true })).toMatchObject({ akimbo: false, projectile: false, cadenceS: STATS.pistolet.cadenceS });
  });
});
