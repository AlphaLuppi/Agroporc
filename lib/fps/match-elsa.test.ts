import { describe, expect, it } from "vitest";
import { STATS } from "./armes";
import { ELSA } from "./elsa";
import { creerServiceElsa } from "./match-elsa";
import type { ContexteSalle, JoueurSalle, Sortie } from "./match-contexte";
import { copierEquipement, EQUIPEMENT_DEFAUT, JEU, type Vec3 } from "./protocole";
import { construireMonde } from "./collision";

// ---------- contexte factice (la salle est le lot S1 : le service ne voit que ContexteSalle) ----------

const monde = construireMonde({
  buildings: [], pois: [], roads: [], parkings: [], water: [], trees: [],
} as unknown as Parameters<typeof construireMonde>[0]);

function joueur(id: string, p: Vec3 = [0, 0, 0], surcharge: Partial<JoueurSalle> = {}): JoueurSalle {
  return {
    id, pseudo: id, couleur: "#ffffff", enJeu: true, kills: 0, morts: 0, ping: 0, p, v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0,
    arme: "pistolet", armeSuivante: "pistolet", pv: 40, vivant: true, protegeJusqua: 0, reapparitionT: null, reentreeT: -Infinity, seq: 0, etatT: 0, histo: [], prochainTir: 0,
    renommages: [], equip: copierEquipement(EQUIPEMENT_DEFAUT), main: "secondaire", mainSuivante: "secondaire", munSpeciale: 0, sortieJusqua: 0,
    cadenceArme: {}, bouclier: 10, dernierDegatT: 0, regenAcc: 0.5, accroupi: false, glisse: false, memoSante: null,
    tirs: 0, touches: 0, tetes: 0, degats: 0, serie: 0, serieMax: 0, killsParArme: {}, scoresOuvert: false, scoresDemandeT: 0, scoresEnvoyeT: 0,
    ...surcharge,
  };
}

/** Suite d'aléas rejouée en boucle. */
const suite = (...valeurs: number[]) => { let i = 0; return () => valeurs[i++ % valeurs.length]; };

function creerContexte(alea: () => number) {
  const joueurs = new Map<string, JoueurSalle>();
  const etat = { phaseJeu: true };
  const ctx: ContexteSalle = {
    monde, alea,
    enPhaseJeu: () => etat.phaseJeu,
    joueur: (id) => joueurs.get(id),
    joueursEnJeu: () => [...joueurs.values()].filter((j) => j.enJeu),
    memoriserPrecedent: () => {},
    libererVehicule: () => [],
    toucheJoueur: () => false,
    // v5 (zombies) : non utilisés par ce service
    joueurs: () => [...joueurs.values()], placerJoueur: () => [], retirerJoueur: () => [], equiper: () => [],
    presence: () => ({ a: "tous", m: { t: "presence", joueurs: [] } }),
    infliger: () => [],
    tuer: () => [],
  };
  const ajouter = (j: JoueurSalle) => { joueurs.set(j.id, j); return j; };
  return { ctx, etat, ajouter, joueurs };
}

const X = -120, Z = 39;
/** intervalle fixe 1 s, pas d'aléa dans l'intervalle ; l'aléa suivant décide du contenu */
const INTERVALLE = { minMs: 1000, maxMs: 1000 };
const types = (s: Sortie[]) => s.map((x) => (x.m.t === "elsa" ? `elsa:${x.m.evenement}` : x.m.t));

describe("minuteur", () => {
  it("l'offre apparaît à l'échéance exacte, pas avant (minuteur armé à la création)", () => {
    const { ctx, ajouter } = creerContexte(suite(0.9)); // 0,9 : arme
    ajouter(joueur("a", [500, 0, 500]));
    const elsa = creerServiceElsa(ctx, { x: X, z: Z, intervalle: INTERVALLE, maintenant: 10_000 });
    expect(elsa.tic(10_999)).toEqual([]);
    const s = elsa.tic(11_000);
    expect(types(s)).toEqual(["elsa:apparue"]);
    expect(s[0].a).toBe("tous");
    const m = s[0].m;
    if (m.t !== "elsa") throw new Error("elsa attendu");
    expect(m.elsa.x).toBe(X);
    expect(m.elsa.z).toBe(Z);
    expect(m.elsa.offre).toMatchObject({ id: 1, genre: "arme", finT: 11_000 + ELSA.dureeOffreMs });
  });

  it("sans horloge à la création, le minuteur est armé au premier tic", () => {
    const { ctx, ajouter } = creerContexte(suite(0.9));
    ajouter(joueur("a", [500, 0, 500]));
    const elsa = creerServiceElsa(ctx, { x: X, z: Z, intervalle: INTERVALLE });
    expect(elsa.tic(5_000_000)).toEqual([]);
    expect(elsa.tic(5_000_999)).toEqual([]);
    expect(types(elsa.tic(5_001_000))).toEqual(["elsa:apparue"]);
  });

  it("intervalle par défaut 20-50 s : bornes de l'aléa", () => {
    for (const [a, attendu] of [[0, 20_000], [0.999999, 50_000]] as const) {
      const { ctx, ajouter } = creerContexte(suite(a, 0.9));
      ajouter(joueur("x", [500, 0, 500]));
      const elsa = creerServiceElsa(ctx, { x: X, z: Z, maintenant: 0 });
      expect(elsa.tic(attendu - 100)).toEqual([]);
      expect(types(elsa.tic(attendu + 100))).toEqual(["elsa:apparue"]);
    }
  });

  it("rien tant qu'aucun joueur n'est en arène, ni hors phase jeu ; l'échéance est repoussée", () => {
    const { ctx, etat, ajouter } = creerContexte(suite(0.9));
    const elsa = creerServiceElsa(ctx, { x: X, z: Z, intervalle: INTERVALLE, maintenant: 0 });
    expect(elsa.tic(1000)).toEqual([]); // personne en arène
    ajouter(joueur("a", [500, 0, 500]));
    expect(elsa.tic(1500)).toEqual([]); // l'échéance a été repoussée d'un intervalle entier à 1000
    etat.phaseJeu = false;
    expect(elsa.tic(2000)).toEqual([]); // entracte
    etat.phaseJeu = true;
    expect(elsa.tic(2100)).toEqual([]); // échéance repoussée à 3000 (atteinte en entracte)
    expect(types(elsa.tic(3000))).toEqual(["elsa:apparue"]);
  });

  it("un spectateur (hors arène) ne compte pas comme joueur en arène", () => {
    const { ctx, ajouter } = creerContexte(suite(0.9));
    ajouter(joueur("spec", [500, 0, 500], { enJeu: false }));
    const elsa = creerServiceElsa(ctx, { x: X, z: Z, intervalle: INTERVALLE, maintenant: 0 });
    expect(elsa.tic(1000)).toEqual([]);
    expect(elsa.tic(1001)).toEqual([]);
  });

  it("l'offre expire au bout de 40 s : elsa{expiree} à tous, offre nulle, puis une nouvelle offre un intervalle plus tard", () => {
    const { ctx, ajouter } = creerContexte(suite(0.9));
    ajouter(joueur("a", [500, 0, 500]));
    const elsa = creerServiceElsa(ctx, { x: X, z: Z, intervalle: INTERVALLE, maintenant: 0 });
    elsa.tic(1000); // apparue, finT = 41 000
    expect(elsa.tic(40_999)).toEqual([]);
    const s = elsa.tic(41_000);
    expect(types(s)).toEqual(["elsa:expiree"]);
    expect(s[0].a).toBe("tous");
    if (s[0].m.t === "elsa") expect(s[0].m.elsa.offre).toBeNull();
    expect(elsa.tic(41_999)).toEqual([]);
    const n = elsa.tic(42_000);
    expect(types(n)).toEqual(["elsa:apparue"]);
    if (n[0].m.t === "elsa") expect(n[0].m.elsa.offre?.id).toBe(2); // un id n'est jamais réutilisé
  });
});

describe("ramassage", () => {
  /** l'aléa sert d'abord à l'intervalle (armement), puis au genre (< 0,4 : soin), puis à l'arme spéciale */
  const prete = (alea: () => number) => {
    const c = creerContexte(alea);
    const elsa = creerServiceElsa(c.ctx, { x: X, z: Z, intervalle: INTERVALLE, maintenant: 0 });
    return { ...c, elsa };
  };

  it("soin : PV et bouclier à 100, messages elsa{prise} et ramassage à tous, pas d'équipement", () => {
    const { elsa, ajouter } = prete(suite(0.1));
    const a = ajouter(joueur("a", [X + 1, 0, Z], { pv: 12, bouclier: 0 }));
    const s = elsa.tic(1000);
    expect(types(s)).toEqual(["elsa:apparue", "elsa:prise", "ramassage"]);
    expect(a.pv).toBe(JEU.pvMax);
    expect(a.bouclier).toBe(JEU.bouclierMax);
    expect(a.regenAcc).toBe(0);
    expect(a.equip.speciale).toBeNull();
    expect(a.main).toBe("secondaire");
    const rama = s.find((x) => x.m.t === "ramassage");
    expect(rama?.a).toBe("tous");
    expect(rama?.m).toEqual({ t: "ramassage", offre: 1, par: "a", genre: "soin" });
    const prise = s.find((x) => x.m.t === "elsa" && x.m.evenement === "prise");
    if (prise?.m.t === "elsa") expect(prise.m.elsa.offre).toBeNull();
  });

  it("arme spéciale : équipement, munitions de STATS (décomptées côté appelant), arme en main, dégainage, message privé", () => {
    const { elsa, ajouter } = prete(suite(0, 0.9, 0.5)); // armement du minuteur, puis arme, puis index floor(0,5 × 3) = 1 : minigun
    const a = ajouter(joueur("a", [X, 0, Z + 2]));
    const s = elsa.tic(1000);
    expect(types(s)).toEqual(["elsa:apparue", "elsa:prise", "ramassage", "equipement"]);
    expect(a.equip.speciale).toBe("minigun");
    expect(a.munSpeciale).toBe(STATS.minigun.chargeur);
    expect(a.main).toBe("speciale");
    expect(a.arme).toBe("minigun");
    expect(a.sortieJusqua).toBe(1000 + JEU.degainageMs);
    const eq = s[s.length - 1];
    expect(eq.a).toBe("a");
    expect(eq.m).toEqual({ t: "equipement", equip: { ...a.equip }, main: "speciale", munSpeciale: STATS.minigun.chargeur });
    const rama = s.find((x) => x.m.t === "ramassage");
    expect(rama?.m).toEqual({ t: "ramassage", offre: 1, par: "a", genre: "arme", arme: "minigun" });
  });

  it("une arme spéciale remplace la précédente, munitions remises à plein, cadence de cette arme effacée", () => {
    const { elsa, ajouter } = prete(suite(0.9, 0.99)); // magnum_dore
    const a = ajouter(joueur("a", [X, 0, Z], { main: "principale", arme: "mitraillette" }));
    a.equip.speciale = "railgun";
    a.munSpeciale = 1;
    a.cadenceArme = { magnum_dore: 99_999 };
    elsa.tic(1000);
    expect(a.equip.speciale).toBe("magnum_dore");
    expect(a.munSpeciale).toBe(STATS.magnum_dore.chargeur);
    expect(a.cadenceArme.magnum_dore).toBeUndefined();
  });

  it("l'équipement du joueur est sa propre copie : EQUIPEMENT_DEFAUT n'est jamais modifié", () => {
    const { elsa, ajouter } = prete(suite(0.9, 0.1));
    ajouter(joueur("a", [X, 0, Z]));
    elsa.tic(1000);
    expect(EQUIPEMENT_DEFAUT.speciale).toBeNull();
  });

  it("premier arrivé servi : un seul bénéficiaire, l'offre n'est pas reprise", () => {
    const { elsa, ajouter } = prete(suite(0.1));
    const a = ajouter(joueur("a", [X + 2, 0, Z], { pv: 10 }));
    const b = ajouter(joueur("b", [X + 1, 0, Z], { pv: 10 }));
    const s = elsa.tic(1000);
    expect(s.filter((x) => x.m.t === "ramassage")).toHaveLength(1);
    expect(a.pv).toBe(JEU.pvMax);
    expect(b.pv).toBe(10);
    expect(elsa.tic(1001)).toEqual([]);
  });

  it("l'arrivant seul à portée plus tard prend l'offre en cours (aucun message client)", () => {
    const { elsa, ajouter } = prete(suite(0.1));
    const a = ajouter(joueur("a", [X + 50, 0, Z], { pv: 10 }));
    expect(types(elsa.tic(1000))).toEqual(["elsa:apparue"]);
    a.p = [X + 2.4, 0, Z];
    expect(types(elsa.tic(5000))).toEqual(["elsa:prise", "ramassage"]);
    expect(a.pv).toBe(JEU.pvMax);
  });

  it("portée : |dy| < 3, vivant, en arène ; seul le joueur à portée est servi", () => {
    const { elsa, ajouter } = prete(suite(0.1));
    const loin = ajouter(joueur("loin", [X + 2.6, 0, Z], { pv: 10 }));
    const haut = ajouter(joueur("haut", [X, 3, Z], { pv: 10 }));
    const mort = ajouter(joueur("mort", [X, 0, Z], { pv: 0, vivant: false }));
    const spec = ajouter(joueur("spec", [X, 0, Z], { pv: 10, enJeu: false }));
    const bon = ajouter(joueur("bon", [X, 2.9, Z], { pv: 10 }));
    expect(types(elsa.tic(1000))).toEqual(["elsa:apparue", "elsa:prise", "ramassage"]);
    expect([loin.pv, haut.pv, mort.pv, spec.pv]).toEqual([10, 10, 0, 10]);
    expect(bon.pv).toBe(JEU.pvMax);
  });

  it("pile 2,5 m : pris", () => {
    const { elsa, ajouter } = prete(suite(0.1));
    const a = ajouter(joueur("a", [X + 2.5, 0, Z], { pv: 10 }));
    elsa.tic(1000);
    expect(a.pv).toBe(JEU.pvMax);
  });

  it("un occupant de véhicule n'est pas servi (filtre `aPied` de la salle)", () => {
    const c = creerContexte(suite(0.1));
    const dansVoiture = c.ajouter(joueur("v", [X, 0, Z], { pv: 10 }));
    const apied = c.ajouter(joueur("p", [X + 1, 0, Z], { pv: 10 }));
    const elsa = creerServiceElsa(c.ctx, { x: X, z: Z, intervalle: INTERVALLE, maintenant: 0, aPied: (j) => j.id !== "v" });
    const s = elsa.tic(1000);
    expect(s.find((x) => x.m.t === "ramassage")?.m).toMatchObject({ par: "p" });
    expect(dansVoiture.pv).toBe(10);
    expect(apied.pv).toBe(JEU.pvMax);
  });

  it("pas de ramassage en entracte, l'offre en cours peut y expirer", () => {
    const { elsa, ajouter, etat } = prete(suite(0.1));
    const a = ajouter(joueur("a", [X + 50, 0, Z], { pv: 10 }));
    elsa.tic(1000); // apparue
    etat.phaseJeu = false;
    a.p = [X, 0, Z];
    expect(elsa.tic(2000)).toEqual([]);
    expect(a.pv).toBe(10);
    expect(types(elsa.tic(41_000))).toEqual(["elsa:expiree"]);
  });

  it("une offre qui apparaît sur un joueur déjà présent est prise au même tic", () => {
    const { elsa, ajouter } = prete(suite(0.1));
    ajouter(joueur("a", [X, 0, Z]));
    expect(types(elsa.tic(1000))).toEqual(["elsa:apparue", "elsa:prise", "ramassage"]);
  });
});

describe("synchro et réinitialisation", () => {
  it("synchro : elsa{etat} adressé au seul destinataire, avec l'offre en cours", () => {
    const { ctx, ajouter } = creerContexte(suite(0.9, 0.99));
    ajouter(joueur("a", [500, 0, 500]));
    const elsa = creerServiceElsa(ctx, { x: X, z: Z, intervalle: INTERVALLE, maintenant: 0 });
    const vide = elsa.synchro("neuf");
    expect(vide).toEqual([{ a: "neuf", m: { t: "elsa", evenement: "etat", elsa: { x: X, z: Z, offre: null } } }]);
    elsa.tic(1000);
    const s = elsa.synchro("tardif");
    expect(s).toHaveLength(1);
    expect(s[0].a).toBe("tardif");
    expect(s[0].m).toEqual({
      t: "elsa", evenement: "etat",
      elsa: { x: X, z: Z, offre: { id: 1, genre: "arme", arme: "magnum_dore", finT: 1000 + ELSA.dureeOffreMs } },
    });
  });

  it("réinitialiser : offre retirée, minuteur ré-armé, les clients l'apprennent au tic suivant", () => {
    const { ctx, ajouter } = creerContexte(suite(0.9));
    ajouter(joueur("a", [500, 0, 500]));
    const elsa = creerServiceElsa(ctx, { x: X, z: Z, intervalle: INTERVALLE, maintenant: 0 });
    elsa.tic(1000); // offre en cours
    elsa.reinitialiser(5000);
    expect(elsa.synchro("b")[0].m).toMatchObject({ elsa: { offre: null } });
    const s = elsa.tic(5001);
    expect(s).toEqual([{ a: "tous", m: { t: "elsa", evenement: "etat", elsa: { x: X, z: Z, offre: null } } }]);
    expect(elsa.tic(5999)).toEqual([]);
    expect(types(elsa.tic(6000))).toEqual(["elsa:apparue"]); // nouvelle offre un intervalle après le reset
  });

  it("réinitialiser sans offre en cours : aucun message", () => {
    const { ctx, ajouter } = creerContexte(suite(0.9));
    ajouter(joueur("a", [500, 0, 500]));
    const elsa = creerServiceElsa(ctx, { x: X, z: Z, intervalle: INTERVALLE, maintenant: 0 });
    elsa.reinitialiser(500);
    expect(elsa.tic(501)).toEqual([]);
  });

  it("réinitialiser avant tout tic arme le minuteur à partir de l'instant du reset", () => {
    const { ctx, ajouter } = creerContexte(suite(0.9));
    ajouter(joueur("a", [500, 0, 500]));
    const elsa = creerServiceElsa(ctx, { x: X, z: Z, intervalle: INTERVALLE });
    elsa.reinitialiser(7000);
    expect(elsa.tic(7999)).toEqual([]);
    expect(types(elsa.tic(8000))).toEqual(["elsa:apparue"]);
  });
});

describe("répartition du contenu", () => {
  it("≈ 40 % soin / 60 % arme sur 2 000 offres, les 3 armes spéciales sortent", () => {
    let graine = 12345;
    const alea = () => { graine = (graine * 1664525 + 1013904223) >>> 0; return graine / 2 ** 32; };
    const { ctx, ajouter } = creerContexte(alea);
    ajouter(joueur("a", [500, 0, 500]));
    const elsa = creerServiceElsa(ctx, { x: X, z: Z, intervalle: { minMs: 1, maxMs: 1 }, maintenant: 0 });
    let soins = 0, armes = 0;
    const vues = new Set<string>();
    // cycle : apparition à t, expiration 40 s plus tard, nouvelle échéance 1 ms après
    for (let t = 1; soins + armes < 2000; t += ELSA.dureeOffreMs + 1) {
      for (const s of elsa.tic(t)) {
        if (s.m.t === "elsa" && s.m.evenement === "apparue" && s.m.elsa.offre) {
          if (s.m.elsa.offre.genre === "soin") soins++; else { armes++; vues.add(s.m.elsa.offre.arme ?? ""); }
        }
      }
      elsa.tic(t + ELSA.dureeOffreMs);
    }
    expect(soins / (soins + armes)).toBeGreaterThan(0.36);
    expect(soins / (soins + armes)).toBeLessThan(0.44);
    expect([...vues].sort()).toEqual(["magnum_dore", "minigun", "railgun"]);
  });
});
