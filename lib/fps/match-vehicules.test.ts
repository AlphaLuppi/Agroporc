import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import { construireCircuits, etatVoiture, flotte, T0_MS, type VoiturePnj } from "./circulation";
import { ABANDON_MS, SILENCE_CONDUCTEUR_MS } from "./garage";
import type { CauseMort } from "./protocole";
import type { ContexteSalle, JoueurSalle, Sortie } from "./match-contexte";
import { creerServiceVehicules } from "./match-vehicules";
import { copierEquipement, EQUIPEMENT_DEFAUT, OEIL_SIEGE, SILHOUETTE, type MessageClient, type Vec3 } from "./protocole";
import { positionSiege, VEH } from "./vehicule";

const sceneReelle = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 10, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
/** Monde vide (deux bâtiments minuscules très loin donnent des bornes de ±2 km) */
const monde = construireMonde({ ...sceneReelle, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000)], pois: [] });

// ---------- contexte factice ----------

function joueur(id: string, p: Vec3 = [0, 0, 0], surcharge: Partial<JoueurSalle> = {}): JoueurSalle {
  return {
    id, pseudo: id, couleur: "#ffffff", enJeu: true, kills: 0, morts: 0, ping: 0, p, v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0,
    arme: "pistolet", armeSuivante: "pistolet", pv: 100, vivant: true, protegeJusqua: 0, reapparitionT: null, reentreeT: -Infinity, seq: 0, etatT: 0, histo: [], prochainTir: 0,
    renommages: [], equip: copierEquipement(EQUIPEMENT_DEFAUT), main: "secondaire", mainSuivante: "secondaire", munSpeciale: 0, sortieJusqua: 0,
    cadenceArme: {}, bouclier: 0, dernierDegatT: 0, regenAcc: 0, accroupi: false, glisse: false, memoSante: null,
    tirs: 0, touches: 0, tetes: 0, degats: 0, serie: 0, serieMax: 0, killsParArme: {}, scoresOuvert: false, scoresDemandeT: 0, scoresEnvoyeT: 0,
    ...surcharge,
  };
}

interface Mort { cible: string; par: string | null; cause: CauseMort; t: number }
function creerContexte() {
  const joueurs = new Map<string, JoueurSalle>();
  const etat = { phaseJeu: true };
  const morts: Mort[] = [];
  const ctx: ContexteSalle = {
    monde, alea: () => 0.5,
    enPhaseJeu: () => etat.phaseJeu,
    joueur: (id) => joueurs.get(id),
    joueursEnJeu: () => [...joueurs.values()].filter((j) => j.enJeu),
    memoriserPrecedent: () => {},
    libererVehicule: () => [],
    toucheJoueur: () => false,
    infliger: () => [],
    // comme la salle : mort immédiate, `mort` diffusé
    tuer: (cible, par, cause, t) => {
      cible.vivant = false;
      cible.pv = 0;
      morts.push({ cible: cible.id, par: par?.id ?? null, cause, t });
      return [{ a: "tous", m: { t: "mort", cible: cible.id, par: par?.id ?? "", arme: "couteau", cause, zone: "corps", ts: t, delai: 4000 } }];
    },
  };
  const ajouter = (j: JoueurSalle) => { joueurs.set(j.id, j); return j; };
  return { ctx, etat, morts, ajouter };
}

const CAP_EST = -Math.PI / 2; // avant = (+1, 0)
/** une voiture à l'origine regardant l'est, une deuxième 100 m au sud */
const EMPLACEMENTS = [{ p: [0, 0] as [number, number], cap: CAP_EST }, { p: [0, 100] as [number, number], cap: CAP_EST }];
/** à portée de montée de la voiture 0 (caisse ±0,95 en z) */
const PRES: Vec3 = [0, 0, 3.5];
const LOIN: Vec3 = [0, 0, 30];

function banc(opts: Parameters<typeof creerServiceVehicules>[1] = { vehicules: EMPLACEMENTS, maintenant: 0 }) {
  const c = creerContexte();
  const svc = creerServiceVehicules(c.ctx, opts);
  const monter = (j: JoueurSalle, vehicule = 0, siege?: 0 | 1 | 2 | 3, t = 1000) =>
    svc.recevoir(j, siege === undefined ? { t: "monter", vehicule } : { t: "monter", vehicule, siege }, t);
  return { ...c, svc, monter };
}
const types = (s: Sortie[]) => s.map((x) => x.m.t);
const siegesDe = (s: Sortie[]) => {
  const m = s.find((x) => x.m.t === "sieges")?.m;
  return m && m.t === "sieges" ? m.vehicules : undefined;
};

/** message `conduite` ; la voiture roule vers l'est depuis x = 0 */
function msgConduite(seq: number, x: number, v: number, vehicule = 0, surcharge: Partial<Extract<MessageClient, { t: "conduite" }>> = {}): MessageClient {
  return { t: "conduite", seq, vehicule, p: [x, 0, 0], cap: CAP_EST, v, lacet: 1.2, tangage: 0.1, ...surcharge };
}
/** Le conducteur roule à `v` m/s pendant `n` messages espacés de 40 ms à partir de t0 (x = v·(t − t0)). Renvoie l'instant et l'abscisse du dernier. */
function rouler(b: ReturnType<typeof banc>, conducteur: JoueurSalle, v: number, n: number, t0 = 1000, seq0 = 0) {
  let t = t0, x = 0;
  for (let k = 1; k <= n; k++) {
    t = t0 + 40 * k;
    x = (v * (t - t0)) / 1000;
    b.svc.recevoir(conducteur, msgConduite(seq0 + k, x, v), t);
    b.svc.tic(t);
  }
  return { t, x };
}

describe("monter", () => {
  it("à portée : embarque (privé) + sieges (tous), siège 0 d'abord, position du siège recopiée", () => {
    const { svc, monter, ajouter } = banc();
    const a = ajouter(joueur("a", PRES));
    const s = monter(a);
    expect(types(s)).toEqual(["embarque", "sieges"]);
    expect(s[0].a).toBe("a");
    expect(s[0].m).toEqual({ t: "embarque", vehicule: 0, siege: 0, p: [0, 0, 0], cap: CAP_EST });
    expect(s[1].a).toBe("tous");
    expect(siegesDe(s)?.[0]).toEqual({ id: 0, sieges: ["a", null, null, null] });
    expect(svc.occupation("a")).toEqual({ vehicule: 0, siege: 0 });
    expect(a.p).toEqual(positionSiege({ p: [0, 0, 0], cap: CAP_EST, v: 0 }, 0));
    expect(a.accroupi).toBe(false);
  });

  it("le suivant prend le siège libre le plus bas, ou celui demandé", () => {
    const { monter, ajouter } = banc();
    const a = ajouter(joueur("a", PRES)), b = ajouter(joueur("b", PRES)), c = ajouter(joueur("c", PRES));
    monter(a);
    expect(monter(b)[0].m).toMatchObject({ t: "embarque", siege: 1 });
    expect(monter(c, 0, 3)[0].m).toMatchObject({ t: "embarque", siege: 3 });
  });

  it("refus : loin, plein, deja, inconnu, mort ; jamais `erreur`, jamais de sieges", () => {
    const { monter, ajouter, svc } = banc();
    const raison = (s: Sortie[]) => (s[0].m.t === "refus" ? s[0].m.raison : s[0].m.t);
    const loin = ajouter(joueur("loin", LOIN));
    const s = monter(loin);
    expect(s).toHaveLength(1);
    expect(s[0]).toEqual({ a: "loin", m: { t: "refus", action: "monter", raison: "loin" } });
    expect(raison(monter(loin, 7))).toBe("inconnu");
    expect(raison(monter(loin, 1.5))).toBe("inconnu");
    const mort = ajouter(joueur("mort", PRES, { vivant: false, pv: 0 }));
    expect(raison(monter(mort))).toBe("mort");
    const a = ajouter(joueur("a", PRES));
    monter(a);
    expect(raison(monter(a))).toBe("deja");
    expect(raison(monter(ajouter(joueur("x", PRES)), 0, 0))).toBe("plein"); // siège 0 occupé
    expect(raison(monter(ajouter(joueur("y", PRES)), 0, 9 as 0))).toBe("inconnu"); // siège invalide
    for (const id of ["p1", "p2", "p3"]) monter(ajouter(joueur(id, PRES)));
    expect(svc.occupation("p3")).not.toBeNull(); // 4 places occupées (a, p1, p2, p3)
    const tardif = ajouter(joueur("tardif", PRES));
    expect(raison(monter(tardif))).toBe("plein");
    expect(svc.occupation("tardif")).toBeNull();
  });

  it("un spectateur (hors arène) est ignoré sans réponse", () => {
    const { monter, ajouter } = banc();
    expect(monter(ajouter(joueur("spec", PRES, { enJeu: false })))).toEqual([]);
  });

  it("les autres types de message renvoient []", () => {
    const { svc, ajouter } = banc();
    const a = ajouter(joueur("a"));
    expect(svc.recevoir(a, { t: "ping", t0: 1 }, 0)).toEqual([]);
  });
});

describe("descendre et changer de siège", () => {
  it("descendre : descente{volontaire} privée + sieges, le joueur est téléporté au point de sortie, vitesse nulle", () => {
    const { svc, monter, ajouter } = banc();
    const a = ajouter(joueur("a", PRES));
    monter(a);
    const s = svc.recevoir(a, { t: "descendre" }, 2000);
    expect(types(s)).toEqual(["descente", "sieges"]);
    expect(s[0].a).toBe("a");
    const d = s[0].m;
    if (d.t !== "descente") throw new Error("descente attendue");
    expect(d.raison).toBe("volontaire");
    expect(d.lacet).toBe(CAP_EST);
    expect(a.p).toEqual(d.p);
    expect(a.v).toEqual([0, 0, 0]);
    expect(Math.hypot(d.p[0], d.p[2])).toBeGreaterThan(1);
    expect(svc.occupation("a")).toBeNull();
    expect(siegesDe(s)?.[0].sieges[0]).toBeNull();
  });

  it("descendre à pied : rien", () => {
    const { svc, ajouter } = banc();
    expect(svc.recevoir(ajouter(joueur("a")), { t: "descendre" }, 0)).toEqual([]);
  });

  it("le conducteur qui descend laisse la voiture à l'arrêt", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES));
    b.monter(a);
    rouler(b, a, 12, 10);
    expect(b.svc.snap()[0].v).toBeCloseTo(12, 5);
    b.svc.recevoir(a, { t: "descendre" }, 2000);
    expect(b.svc.snap()[0].v).toBe(0);
  });

  it("siege : changement vers un siège libre ⇒ embarque + sieges ; occupé ⇒ refus plein ; même siège ⇒ deja ; à pied ⇒ inconnu", () => {
    const { svc, monter, ajouter } = banc();
    const a = ajouter(joueur("a", PRES)), b = ajouter(joueur("b", PRES));
    monter(a); monter(b); // a = 0, b = 1
    const s = svc.recevoir(b, { t: "siege", siege: 3 }, 2000);
    expect(types(s)).toEqual(["embarque", "sieges"]);
    expect(s[0].m).toMatchObject({ t: "embarque", vehicule: 0, siege: 3 });
    expect(svc.occupation("b")).toEqual({ vehicule: 0, siege: 3 });
    expect(b.p).toEqual(positionSiege({ p: [0, 0, 0], cap: CAP_EST, v: 0 }, 3));
    expect(svc.recevoir(b, { t: "siege", siege: 0 }, 2100)[0].m).toEqual({ t: "refus", action: "siege", raison: "plein" });
    expect(svc.recevoir(b, { t: "siege", siege: 3 }, 2100)[0].m).toEqual({ t: "refus", action: "siege", raison: "deja" });
    expect(svc.recevoir(ajouter(joueur("p", LOIN)), { t: "siege", siege: 1 }, 2100)[0].m).toEqual({ t: "refus", action: "siege", raison: "inconnu" });
    expect(svc.recevoir(b, { t: "siege", siege: 8 as 0 }, 2100)[0].m).toMatchObject({ t: "refus", raison: "inconnu" });
  });

  it("le conducteur qui passe passager arrête la voiture, le passager qui passe au volant reprend une séquence neuve", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES)), p = b.ajouter(joueur("p", PRES));
    b.monter(a); b.monter(p);
    rouler(b, a, 10, 10); // seq 1..10
    b.svc.recevoir(a, { t: "siege", siege: 2 }, 1500);
    expect(b.svc.snap()[0].v).toBe(0);
    b.svc.recevoir(p, { t: "siege", siege: 0 }, 1600);
    expect(b.svc.estConducteur("p")).toBe(true);
    // la séquence repart de zéro : seq 1 est acceptée
    b.svc.recevoir(p, msgConduite(1, 4.5, 3), 1640);
    expect(b.svc.snap()[0].p[0]).toBeCloseTo(4.5, 5);
  });
});

describe("conduite", () => {
  it("le conducteur est autoritaire, borné : y imposé à 0, lacet / tangage / etatT recopiés", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES));
    b.monter(a);
    b.svc.recevoir(a, msgConduite(1, 0.5, 5, 0, { p: [0.5, 50, 0] }), 1040);
    expect(b.svc.snap()[0].p).toEqual([0.5, 0, 0]);
    expect(a.p[1]).toBe(0);
    expect(a.lacet).toBe(1.2);
    expect(a.tangage).toBe(0.1);
    expect(a.etatT).toBe(1040);
    const xSiege = positionSiege({ p: [0.5, 0, 0], cap: CAP_EST, v: 5 }, 0);
    expect(a.p).toEqual(xSiege);
  });

  it("refus silencieux : un passager ne conduit pas, séquence non croissante, saut impossible, mauvaise voiture", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES)), p = b.ajouter(joueur("p", PRES));
    b.monter(a); b.monter(p);
    expect(b.svc.recevoir(p, msgConduite(1, 3, 3), 1040)).toEqual([]);
    expect(b.svc.snap()[0].p[0]).toBe(0);
    b.svc.recevoir(a, msgConduite(5, 0.4, 5), 1040);
    b.svc.recevoir(a, msgConduite(5, 0.8, 5), 1080); // seq répétée
    b.svc.recevoir(a, msgConduite(4, 0.8, 5), 1080); // seq décroissante
    expect(b.svc.snap()[0].p[0]).toBeCloseTo(0.4, 5);
    b.svc.recevoir(a, msgConduite(6, 40, 5), 1120); // 40 m en 40 ms
    expect(b.svc.snap()[0].p[0]).toBeCloseTo(0.4, 5);
    b.svc.recevoir(a, msgConduite(7, 0.9, 5, 1), 1120); // voiture 1 : pas la sienne
    expect(b.svc.snap()[0].p[0]).toBeCloseTo(0.4, 5);
    b.svc.recevoir(a, msgConduite(8, Number.NaN, 5), 1160);
    expect(b.svc.snap()[0].p[0]).toBeCloseTo(0.4, 5);
  });

  it("j.v de tous les occupants = vitesse de la voiture (cap × v), p = leur siège", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES)), p = b.ajouter(joueur("p", PRES)), q = b.ajouter(joueur("q", PRES));
    b.monter(a); b.monter(p); b.monter(q, 0, 3);
    const { x } = rouler(b, a, 20, 5);
    for (const j of [a, p, q]) {
      expect(j.v[0]).toBeCloseTo(20, 5);
      expect(j.v[1]).toBe(0);
      expect(Math.abs(j.v[2])).toBeLessThan(1e-9);
    }
    expect(p.p).toEqual(positionSiege({ p: [x, 0, 0], cap: CAP_EST, v: 20 }, 1));
    expect(q.p).toEqual(positionSiege({ p: [x, 0, 0], cap: CAP_EST, v: 20 }, 3));
  });

  it("l'historique des occupants porte la hitbox accroupie à la position du siège, purgé à 400 ms", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES));
    b.monter(a);
    rouler(b, a, 10, 30);
    expect(a.histo.length).toBeGreaterThan(5);
    expect(a.histo.every((h) => h.accroupi)).toBe(true);
    const dernier = a.histo[a.histo.length - 1];
    expect(a.histo[0].t).toBeGreaterThanOrEqual(dernier.t - 400);
    expect(dernier.p).toEqual(a.p);
  });
});

describe("tir d'un passager et conducteur", () => {
  it("passager à 24 m/s : `o` pris sur la voiture rejouée 130 ms plus tôt est accepté (yeux possibles), pas l'état courant", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES)), p = b.ajouter(joueur("p", PRES));
    b.monter(a); b.monter(p);
    const { t, x } = rouler(b, a, 24, 30);
    const attendu = positionSiege({ p: [x - (24 * 130) / 1000, 0, 0], cap: CAP_EST, v: 24 }, 1);
    const oeilVu: Vec3 = [attendu[0], attendu[1] + OEIL_SIEGE, attendu[2]];
    const oeilCourant: Vec3 = (() => { const s = positionSiege({ p: [x, 0, 0], cap: CAP_EST, v: 24 }, 1); return [s[0], s[1] + OEIL_SIEGE, s[2]]; })();
    expect(Math.hypot(oeilVu[0] - oeilCourant[0], oeilVu[2] - oeilCourant[2])).toBeGreaterThan(3); // l'état courant seul refuserait
    const yeux = b.svc.oeilsPossibles(p, t, 300);
    expect(yeux).not.toBeNull();
    const ecart = Math.min(...yeux!.map((y) => Math.hypot(y[0] - oeilVu[0], y[1] - oeilVu[1], y[2] - oeilVu[2])));
    expect(ecart).toBeLessThan(1.5); // ECART_OEIL_M
    // et le passager voit aussi une tolérance de vitesse cohérente : sa vitesse est celle de la voiture
    expect(p.v[0]).toBeCloseTo(24, 5);
  });

  it("à pied : oeilsPossibles renvoie null ; le conducteur est identifié (il ne tire pas)", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES)), p = b.ajouter(joueur("p", PRES)), piéton = b.ajouter(joueur("pieton", LOIN));
    b.monter(a); b.monter(p);
    expect(b.svc.estConducteur("a")).toBe(true);
    expect(b.svc.estConducteur("p")).toBe(false);
    expect(b.svc.estConducteur("pieton")).toBe(false);
    expect(b.svc.oeilsPossibles(piéton, 2000, 300)).toBeNull();
    expect(b.svc.oeilsPossibles(a, 2000, 300)).not.toBeNull(); // le conducteur a des yeux ; c'est `estConducteur` qui refuse son tir
  });
});

describe("libération des sièges", () => {
  it("mort / quitter / déconnexion : `liberer` diffuse sieges ; la voiture du conducteur est arrêtée", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES)), p = b.ajouter(joueur("p", PRES));
    b.monter(a); b.monter(p);
    rouler(b, a, 15, 5);
    expect(b.svc.snap()[0].v).toBe(15);
    const s = b.svc.liberer(a, 2000);
    expect(types(s)).toEqual(["sieges"]);
    expect(s[0].a).toBe("tous");
    expect(siegesDe(s)?.[0].sieges).toEqual([null, "p", null, null]);
    expect(b.svc.occupation("a")).toBeNull();
    expect(b.svc.snap()[0].v).toBe(0);
    // passager : la voiture ne bouge pas, mais le siège est diffusé
    expect(siegesDe(b.svc.liberer(p, 2100))?.[0].sieges).toEqual([null, null, null, null]);
  });

  it("à pied : liberer renvoie []", () => {
    const { svc, ajouter } = banc();
    expect(svc.liberer(ajouter(joueur("a", LOIN)), 0)).toEqual([]);
  });

  it("conducteur muet depuis 500 ms : la voiture est arrêtée au tic", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES));
    b.monter(a);
    const { t } = rouler(b, a, 10, 5);
    b.svc.tic(t + SILENCE_CONDUCTEUR_MS - 1);
    expect(b.svc.snap()[0].v).toBe(10);
    b.svc.tic(t + SILENCE_CONDUCTEUR_MS + 1);
    expect(b.svc.snap()[0].v).toBe(0);
    expect(a.v).toEqual([0, 0, 0]); // les occupants suivent
  });

  it("voiture inoccupée déplacée depuis 60 s : remise à sa place (le snap la porte)", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES));
    b.monter(a);
    const { t } = rouler(b, a, 10, 10);
    b.svc.liberer(a, t);
    expect(b.svc.snap()[0].p[0]).toBeGreaterThan(3);
    b.svc.tic(t + ABANDON_MS - 1);
    expect(b.svc.snap()[0].p[0]).toBeGreaterThan(3);
    b.svc.tic(t + ABANDON_MS + 1);
    expect(b.svc.snap()[0].p).toEqual([0, 0, 0]);
  });

  it("reinitialiser (nouveau match) : descente{expulse} privée à chaque occupant, sieges, voitures remises en place", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES)), p = b.ajouter(joueur("p", PRES));
    b.monter(a); b.monter(p);
    rouler(b, a, 10, 10);
    const s = b.svc.reinitialiser(5000);
    const descentes = s.filter((x) => x.m.t === "descente");
    expect(descentes.map((x) => x.a).sort()).toEqual(["a", "p"]);
    expect(descentes.every((x) => x.m.t === "descente" && x.m.raison === "expulse")).toBe(true);
    expect(s[s.length - 1].a).toBe("tous");
    expect(s[s.length - 1].m.t).toBe("sieges");
    expect(b.svc.occupation("a")).toBeNull();
    expect(b.svc.occupation("p")).toBeNull();
    expect(b.svc.snap()[0]).toEqual({ id: 0, p: [0, 0, 0], cap: -1.571, v: 0 }); // cap arrondi au milliradian par le snap
    expect(a.v).toEqual([0, 0, 0]);
    expect(b.svc.reinitialiser(6000)).toEqual([]); // plus personne : rien à diffuser
  });

  it("synchro : sieges puis voitures abîmées, adressés au seul destinataire", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES));
    b.monter(a);
    const s = b.svc.synchro("tardif");
    expect(s).toHaveLength(2);
    expect(s[1]).toEqual({ a: "tardif", m: { t: "voitures", etats: [] } });
    expect(s[0].a).toBe("tardif");
    expect(siegesDe(s)).toEqual([{ id: 0, sieges: ["a", null, null, null] }, { id: 1, sieges: [null, null, null, null] }]);
  });

  it("sans emplacements, le service est valide (snap vide)", () => {
    const { svc } = banc({ maintenant: 0 });
    expect(svc.snap()).toEqual([]);
    expect(svc.tic(0)).toEqual([]);
  });
});

describe("renversements (voiture conduisible)", () => {
  /** Conducteur à 15 m/s pendant 1 s ; renvoie l'instant, l'abscisse du dernier état et l'abscisse de la voiture à `t − 110` */
  function lancer() {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES));
    b.monter(a);
    const r = rouler(b, a, 15, 25);
    return { b, a, ...r, xVu: r.x - (15 * 110) / 1000 };
  }

  it("piéton sur la voiture telle qu'il la voyait (t − 110) : mort crédité au conducteur, cause ecrase_vehicule", () => {
    const { b, t, xVu } = lancer();
    const ped = b.ajouter(joueur("ped", [xVu, 0, 0], { etatT: t }));
    const s = b.svc.tic(t);
    expect(b.morts).toEqual([{ cible: "ped", par: "a", cause: "ecrase_vehicule", t }]);
    expect(types(s)).toEqual(["mort"]);
    expect(ped.vivant).toBe(false);
  });

  it("le piéton qui s'écarte de la voiture visible est épargné, même si la voiture actuelle le recouvrirait", () => {
    const { b, t, x } = lancer();
    b.ajouter(joueur("ped", [x + VEH.longueur / 2, 0, 0], { etatT: t })); // sur l'avant de la voiture ACTUELLE, 1,65 m devant celle qu'il voyait
    b.svc.tic(t);
    expect(b.morts).toEqual([]);
  });

  it("testé à `etatT − ping/2` du piéton : un ping élevé recule l'instant de capture", () => {
    const { b, t, x } = lancer();
    const ped = b.ajouter(joueur("ped", [x - 1.0, 0, 0], { etatT: t, ping: 400 })); // capturé à t − 200, voiture à t − 310 : centre x − 4,65
    b.svc.tic(t);
    expect(ped.vivant).toBe(true); // x − 1,0 est à 3,65 m de ce centre (> 2,2 + 0,4)
    const ped2 = b.ajouter(joueur("ped2", [x - 4.65 - 2.0, 0, 0], { etatT: t, ping: 400 })); // à 2,0 m derrière ce centre : dedans
    b.svc.tic(t + 1);
    expect(ped2.vivant).toBe(false);
  });

  it("vitesse MESURÉE, pas déclarée : une voiture immobile qui déclare 24 m/s ne tue pas", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES));
    b.monter(a);
    let t = 1000;
    for (let k = 1; k <= 20; k++) { t = 1000 + 40 * k; b.svc.recevoir(a, msgConduite(k, 0, 24), t); b.svc.tic(t); }
    const ped = b.ajouter(joueur("ped", [0, 0, 0], { etatT: t }));
    b.svc.tic(t);
    expect(ped.vivant).toBe(true);
  });

  it("épargnés : protégé, mort, occupant (passager), hors arène, voiture trop lente", () => {
    const b = banc();
    const a = b.ajouter(joueur("a", PRES)), passager = b.ajouter(joueur("passager", PRES));
    b.monter(a); b.monter(passager);
    const { t, x } = rouler(b, a, 15, 25);
    const xVu = x - (15 * 110) / 1000;
    const prot = b.ajouter(joueur("prot", [xVu, 0, 0], { etatT: t, protegeJusqua: t + 1000 }));
    const mort = b.ajouter(joueur("mort", [xVu, 0, 0], { etatT: t, vivant: false, pv: 0 }));
    const spec = b.ajouter(joueur("spec", [xVu, 0, 0], { etatT: t, enJeu: false }));
    b.svc.tic(t);
    expect(b.morts).toEqual([]);
    expect([prot.vivant, mort.vivant, spec.vivant, passager.vivant]).toEqual([true, false, true, true]);
  });

  it("sur le toit d'un bâtiment (pieds au-dessus du toit de la voiture) : épargné", () => {
    const { b, t, xVu } = lancer();
    const ped = b.ajouter(joueur("ped", [xVu, VEH.hauteur + 0.5, 0], { etatT: t }));
    b.svc.tic(t);
    expect(ped.vivant).toBe(true);
  });

  it("pas de mort hors phase jeu", () => {
    const { b, t, xVu } = lancer();
    const ped = b.ajouter(joueur("ped", [xVu, 0, 0], { etatT: t }));
    b.etat.phaseJeu = false;
    b.svc.tic(t);
    expect(ped.vivant).toBe(true);
  });

  it("deux piétons, un seul conducteur : chacun meurt une fois", () => {
    const { b, t, xVu } = lancer();
    b.ajouter(joueur("p1", [xVu, 0, 0], { etatT: t }));
    b.ajouter(joueur("p2", [xVu + 1, 0, 0.3], { etatT: t }));
    b.svc.tic(t);
    expect(b.morts.map((m) => m.cible).sort()).toEqual(["p1", "p2"]);
    b.svc.tic(t);
    expect(b.morts).toHaveLength(2);
  });
});

describe("voitures PNJ (circulation)", () => {
  const circuits = construireCircuits();
  const T = T0_MS + 123_456;
  /** une seule voiture PNJ, sur le circuit 0 */
  const pnj: VoiturePnj = { id: 0, circuit: 0, s0: 20, teinte: 0 };
  const sur = (tMs: number) => etatVoiture(circuits[0], pnj, tMs);
  const avant = (cap: number): [number, number] => [-Math.sin(cap), -Math.cos(cap)];
  const R = SILHOUETTE.rayon;

  function banc2(extra: Parameters<typeof creerServiceVehicules>[1] = {}) {
    return banc({ circulation: { circuits, voitures: [pnj] }, maintenant: 0, ...extra });
  }

  it("écrasé : ctx.tuer(cible, null, \"ecrase_pnj\"), aucun kill crédité", () => {
    const b = banc2();
    const e = sur(T);
    const ped = b.ajouter(joueur("ped", e.p, { etatT: T, ping: 0 }));
    const s = b.svc.tic(T);
    expect(b.morts).toEqual([{ cible: "ped", par: null, cause: "ecrase_pnj", t: T }]);
    expect(types(s)).toEqual(["mort"]);
    expect(ped.vivant).toBe(false);
    expect(b.svc.tic(T + 1)).toEqual([]); // déjà mort : pas deux fois
  });

  it("testé à `etatT − ping/2` : touché à l'instant de capture, pas à l'instant courant", () => {
    const e = sur(T - 100);
    const [fx, fz] = avant(e.cap);
    // 0,3 m derrière l'arrière de la caisse à T − 100 (rayon 0,4 : touché) ; 1,2 m derrière à T (voiture avancée de 0,9 m : manqué)
    const p: Vec3 = [e.p[0] - fx * (2.2 + 0.3), 0, e.p[2] - fz * (2.2 + 0.3)];
    const b1 = banc2();
    const pingEleve = b1.ajouter(joueur("ping", p, { etatT: T, ping: 200 }));
    b1.svc.tic(T);
    expect(pingEleve.vivant).toBe(false);
    const b2 = banc2();
    const pingNul = b2.ajouter(joueur("nul", p, { etatT: T, ping: 0 }));
    b2.svc.tic(T);
    expect(pingNul.vivant).toBe(true);
    expect(R).toBe(0.4);
  });

  it("protégé, mort, hors arène, sur un toit (pieds ≥ 1,6 m), hors phase jeu : épargnés", () => {
    const b = banc2();
    const e = sur(T);
    b.ajouter(joueur("prot", e.p, { etatT: T, protegeJusqua: T + 10 }));
    b.ajouter(joueur("mort", e.p, { etatT: T, vivant: false, pv: 0 }));
    b.ajouter(joueur("spec", e.p, { etatT: T, enJeu: false }));
    b.ajouter(joueur("toit", [e.p[0], 12, e.p[2]], { etatT: T }));
    expect(b.svc.tic(T)).toEqual([]);
    expect(b.morts).toEqual([]);
    const ped = b.ajouter(joueur("ped", e.p, { etatT: T }));
    b.etat.phaseJeu = false;
    b.svc.tic(T);
    expect(ped.vivant).toBe(true);
    b.etat.phaseJeu = true;
    b.svc.tic(T);
    expect(ped.vivant).toBe(false);
  });

  it("un occupant de voiture conduisible n'est pas écrasé (sa position est celle du siège)", () => {
    const e = sur(T);
    // voiture conduisible posée sous la voiture PNJ
    const b = banc2({ vehicules: [{ p: [e.p[0], e.p[2]], cap: e.cap }], circulation: { circuits, voitures: [pnj] }, maintenant: 0 });
    const a = b.ajouter(joueur("a", [e.p[0], 0, e.p[2]], { etatT: T }));
    expect(b.monter(a, 0, undefined, T)[0].m.t).toBe("embarque");
    b.svc.tic(T);
    expect(a.vivant).toBe(true);
    b.svc.recevoir(a, { t: "descendre" }, T + 10);
    expect(Math.hypot(a.p[0] - e.p[0], a.p[2] - e.p[2])).toBeGreaterThan(0.5);
  });

  it("la flotte complète (12 voitures) : un joueur posé sur chacune est écrasé, un joueur loin de tout circuit ne l'est pas", () => {
    const voitures = flotte(circuits);
    const b = banc({ circulation: { circuits, voitures }, maintenant: 0 });
    voitures.forEach((v) => {
      const e = etatVoiture(circuits[v.circuit], v, T);
      b.ajouter(joueur(`p${v.id}`, e.p, { etatT: T }));
    });
    const loin = b.ajouter(joueur("loin", [-1500, 0, -1500], { etatT: T }));
    b.svc.tic(T);
    expect(b.morts).toHaveLength(12);
    expect(b.morts.every((m) => m.par === null && m.cause === "ecrase_pnj")).toBe(true);
    expect(loin.vivant).toBe(true);
  });
});
