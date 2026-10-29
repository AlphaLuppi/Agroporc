import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { BR, EQUIPEMENT_DEPART_BR, MAIN_DEPART_BR } from "./br-regles";
import { LIEN_VOIX_KILLCAM_MS } from "./voix";
import { construireMonde } from "./collision";
import { Salle, HISTORIQUE_MS, INACTIF_MS, PALETTE, REWIND_MAX_MS, type JoueurSalle, type OptionsSalle, type Sortie } from "./match";
import type { ContexteSalle, ServiceBr } from "./match-contexte";
import type { OptionsServiceBr } from "./match-br";
import {
  JEU, SILHOUETTE, copierEquipement,
  type CauseMort, type EtatPartieBr, type Equipement, type MessageClient, type MessageServeur, type Slot, type Vec3,
} from "./protocole";

/**
 * Lot C2 : ce que `Salle` fait de l'option `br` (spec du Battle Royale, « Modifications de match.ts »). Le service (`match-br.ts`) est remplacé
 * par un FAUX injecté par `fabriqueBr`, pour ne tester que les crochets de la salle : capacité, couleurs, `rejoindreBr`, mort définitive, mêlée,
 * snap, inactivité, `presence` fusionnée, chat vocal coupé. Les règles du service ont leurs propres tests (match-br.test.ts).
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
/** Arène réduite : un seul bâtiment (0..10 × 0..10, h = 12) ; bornes = centroïde (5, 5) ± 25 → [−20, 30]². */
const bat: Building = { h: 12, r: [[0, 0], [10, 0], [10, 10], [0, 10]], c: [5, 5] };
const petit = { ...scene, buildings: [bat], pois: [] } as SceneData;
const mondePetit = construireMonde(petit);
const POINTS: Vec2[] = [[-15, -15], [28, 28], [-15, 28], [28, -15]];
const T0 = 2_000_000;

/** Journal et réglages du faux service. */
interface Fake {
  ctx: ContexteSalle | null;
  opts: OptionsServiceBr | null;
  appels: string[];
  admis: boolean;
  aBord: Set<string>;
  enVol: Set<string>;
  chutes: Map<string, "libre" | "voile">;
  /** équipement donné à l'entrée dans l'avion */
  equip: Equipement;
  main: Slot;
  tueurValide: boolean;
  /** `equip.speciale` de la victime vue par `surMort` (doit être encore là : le butin se lâche avant l'effacement) */
  specialeVue: string | null | undefined;
  recus: string[];
  surMorts: { cible: string; tueur: string | null; cause: CauseMort }[];
  liberes: { id: string; present: boolean }[];
  degatsVus: { id: string; cause: CauseMort }[];
  service: ServiceBr;
}

function creerFake(): Fake {
  const f: Fake = {
    ctx: null, opts: null, appels: [], admis: true, aBord: new Set(), enVol: new Set(), chutes: new Map(),
    equip: copierEquipement(EQUIPEMENT_DEPART_BR), main: MAIN_DEPART_BR, tueurValide: true, specialeVue: undefined,
    recus: [], surMorts: [], liberes: [], degatsVus: [],
    service: null as unknown as ServiceBr,
  };
  const etat = (): EtatPartieBr => ({ phase: "lobby", hote: "", capacite: BR.joueursMax, minJoueurs: BR.joueursMin, debutT: 0, finT: 0, avion: null, zone: null, vivants: 0, total: 0 });
  f.service = {
    tic: () => { f.appels.push("tic"); return []; },
    reinitialiser: () => [],
    synchro: (id) => { f.appels.push(`synchro:${id}`); return [{ a: id, m: { t: "br", etat: etat() } }]; },
    admis: () => f.admis,
    entreeJoueur: (j, t) => {
      f.appels.push(`entree:${j.id}`);
      return f.ctx!.placerJoueur(j, [0, 300, 0], 0, { pv: JEU.pvMax, equip: f.equip, main: f.main, prive: true }, t);
    },
    aBord: (id) => f.aBord.has(id),
    enVol: (id) => f.enVol.has(id) || f.aBord.has(id),
    chute: (id) => f.chutes.get(id),
    recevoir: (j, m) => { f.recus.push(`${j.id}:${m.t}`); return [{ a: j.id, m: { t: "br", etat: etat() } }]; },
    surDegats: (j, cause) => { f.degatsVus.push({ id: j.id, cause }); },
    tueurValide: () => f.tueurValide,
    surMort: (cible, tueur, cause) => {
      f.specialeVue = cible.equip.speciale;
      f.surMorts.push({ cible: cible.id, tueur: tueur?.id ?? null, cause });
      return [{ a: "tous", m: { t: "butin", ajoutes: [] } }];
    },
    liberer: (j) => { f.liberes.push({ id: j.id, present: !!f.ctx!.joueur(j.id) }); return [{ a: "tous", m: { t: "br", etat: etat() } }]; },
    arrivee: (j) => { f.appels.push(`arrivee:${j.id}`); return []; },
    enCours: () => false,
    etat,
    resume: () => ({ phase: "jeu", joueurs: 3, vivants: 2, palier: 1 }),
  };
  return f;
}

function salleBr(options: OptionsSalle = {}, equip?: Equipement): { s: Salle; f: Fake } {
  const f = creerFake();
  if (equip) f.equip = copierEquipement(equip);
  const s = new Salle(mondePetit, POINTS, () => 0, T0, {
    br: { scene: petit },
    fabriqueBr: (ctx, opts) => { f.ctx = ctx; f.opts = opts; return f.service; },
    ...options,
  });
  return { s, f };
}

const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
const types = (s: Sortie[]) => s.map((x) => x.m.t);

/** `n` joueurs connectés qui ont rejoint (placés par le faux service). */
function joueursEnJeu(s: Salle, ids: string[], t = T0): void {
  for (const id of ids) {
    s.connecter(id, `Joueur${id}`, t);
    s.recevoir(id, { t: "rejoindre" }, t);
  }
}

/** Avance la salle ; les joueurs de `actifs` (par défaut tous ceux en jeu) restent « actifs » (`etatT` rafraîchi). */
function avancer(s: Salle, t0: number, t1: number, pas = 100, actifs?: string[]): Sortie[] {
  const out: Sortie[] = [];
  for (let t = t0; t <= t1; t += pas) {
    for (const x of s.joueurs()) if (x.enJeu && (!actifs || actifs.includes(x.id))) x.etatT = t;
    out.push(...s.tic(t));
  }
  return out;
}

describe("option br : construction, résumé, capacité, couleurs", () => {
  it("fabrique le service avec la salle comme contexte, l'alea de la salle et les options passées", () => {
    const { s, f } = salleBr({ br: { scene: petit, joueursMin: 1, nbObjets: 120 } });
    expect(f.ctx).toBe(s);
    expect(typeof f.opts?.alea).toBe("function");
    expect(f.opts).toMatchObject({ joueursMin: 1, nbObjets: 120 });
    expect(f.opts?.scene).toBe(petit);
  });

  it("`resumeBr` vient du service, null hors salle BR ; infoMatch sans fin ni objectif de kills", () => {
    const { s } = salleBr();
    expect(s.resumeBr()).toEqual({ phase: "jeu", joueurs: 3, vivants: 2, palier: 1 });
    expect(s.infoMatch()).toMatchObject({ fin: null, objectif: 0, phase: "jeu" });
    const arene = new Salle(mondePetit, POINTS, () => 0, T0);
    expect(arene.resumeBr()).toBeNull();
    expect(arene.infoMatch().objectif).toBe(JEU.objectifKills);
  });

  it("capacité de 50 pour la salle entière : le 51e reçoit `erreur{plein}`", () => {
    const { s } = salleBr();
    for (let i = 0; i < BR.joueursMax; i++) {
      expect(types(s.connecter(`j${i}`, `Nom${i}`, T0))).not.toContain("erreur");
    }
    expect(s.nombreJoueurs()).toBe(50);
    const refus = s.connecter("de-trop", "Trop", T0);
    expect(messages(refus, "erreur")[0]).toMatchObject({ code: "plein" });
    expect(s.nombreJoueurs()).toBe(50);
  });

  it("16 couleurs de PALETTE puis `couleurJoueur` : 50 couleurs distinctes, #rrggbb", () => {
    const { s } = salleBr();
    for (let i = 0; i < 50; i++) s.connecter(`j${i}`, `Nom${i}`, T0);
    const couleurs = s.joueurs().map((x) => x.couleur);
    expect(new Set(couleurs).size).toBe(50);
    expect(couleurs.slice(0, 16)).toEqual([...PALETTE]);
    for (const c of couleurs.slice(16)) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(PALETTE).not.toContain(c);
    }
  });

  it("une couleur rendue par un départ est réutilisée, jamais deux joueurs de la même couleur", () => {
    const { s } = salleBr();
    for (let i = 0; i < 20; i++) s.connecter(`j${i}`, `Nom${i}`, T0);
    const rendue = j(s, "j5").couleur;
    s.deconnecter("j5", T0);
    s.connecter("neuf", "Neuf", T0);
    expect(j(s, "neuf").couleur).toBe(rendue);
    expect(new Set(s.joueurs().map((x) => x.couleur)).size).toBe(s.nombreJoueurs());
  });

  it("le nouvel arrivant et le départ passent par le service (`arrivee`, `liberer` avec l'objet déjà retiré de la table)", () => {
    const { s, f } = salleBr();
    s.connecter("a", "Alice", T0);
    expect(f.appels).toContain("arrivee:a");
    const sorties = s.deconnecter("a", T0 + 10);
    expect(f.liberes).toEqual([{ id: "a", present: false }]);
    expect(types(sorties)).toEqual(["presence", "br"]);
    expect(messages(sorties, "presence")[0].joueurs).toEqual([]);
  });
});

describe("rejoindreBr", () => {
  it("non admis : `refus{rejoindre, lobby}`, ni enJeu ni appel au service", () => {
    const { s, f } = salleBr();
    s.connecter("a", "Alice", T0);
    f.admis = false;
    const sorties = s.recevoir("a", { t: "rejoindre" }, T0);
    expect(sorties).toEqual([{ a: "a", m: { t: "refus", action: "rejoindre", raison: "lobby" } }]);
    expect(j(s, "a").enJeu).toBe(false);
    expect(f.appels.some((x) => x.startsWith("entree:"))).toBe(false);
  });

  it("admis : placé par le service (apparition PRIVÉE, pas de presence), puis sa synchro ; un second `rejoindre` ne fait rien", () => {
    const { s, f } = salleBr();
    s.connecter("a", "Alice", T0);
    const sorties = s.recevoir("a", { t: "rejoindre" }, T0 + 5);
    expect(j(s, "a").enJeu).toBe(true);
    expect(types(sorties)).toEqual(["apparition", "br"]);
    expect(sorties[0].a).toBe("a");
    expect(f.appels).toEqual(["arrivee:a", "entree:a", "synchro:a"]);
    expect(s.recevoir("a", { t: "rejoindre" }, T0 + 6)).toEqual([]);
    expect(s.nombreEnJeu()).toBe(1);
  });

  it("le joueur arrive avec l'équipement de départ du BR : aucune arme à feu, couteau en main", () => {
    const { s } = salleBr();
    joueursEnJeu(s, ["a"]);
    expect(j(s, "a").main).toBe("couteau");
    expect(j(s, "a").arme).toBe("couteau");
    expect(j(s, "a").equip).toMatchObject({ sansPrincipale: true, sansSecondaire: true, speciale: null });
    expect(j(s, "a").pv).toBe(JEU.pvMax);
  });

  it("50 `rejoindre` en rafale : AUCUNE presence dans les réponses, une seule presence fusionnée au tic suivant", () => {
    const { s } = salleBr();
    const reponses: Sortie[] = [];
    for (let i = 0; i < 50; i++) {
      s.connecter(`j${i}`, `Nom${i}`, T0);
      reponses.push(...s.recevoir(`j${i}`, { t: "rejoindre" }, T0 + i));
    }
    expect(s.nombreEnJeu()).toBe(50);
    expect(messages(reponses, "presence")).toHaveLength(0);
    // les apparitions ne sont adressées qu'à leur joueur
    for (const a of reponses.filter((x) => x.m.t === "apparition")) expect(a.a).toBe((a.m as { id: string }).id);
    const premier = avancer(s, T0 + 100, T0 + 100);
    const presences = messages(premier, "presence");
    expect(presences).toHaveLength(1);
    expect(presences[0].joueurs).toHaveLength(50);
    expect(presences[0].joueurs.every((x) => x.enJeu)).toBe(true);
    // rien de neuf : plus de presence au tic suivant
    expect(messages(avancer(s, T0 + 200, T0 + 400), "presence")).toHaveLength(0);
  });

  it("`arme` et `equiper` sont ignorés en BR (l'équipement est celui du service)", () => {
    const { s } = salleBr();
    joueursEnJeu(s, ["a"]);
    s.recevoir("a", { t: "arme", arme: "sniper" }, T0 + 10);
    s.recevoir("a", { t: "equiper", principale: "sniper", secondaire: "revolver" }, T0 + 11);
    expect(j(s, "a").equip).toMatchObject({ sansPrincipale: true, sansSecondaire: true });
    expect(s.equipementProchain("a")).toMatchObject({ principale: "mitraillette" });
  });
});

describe("messages confiés au service", () => {
  const MESSAGES: MessageClient[] = [
    { t: "lancerPartie" }, { t: "sauter" },
    { t: "chute", lacet: 0, tangage: 0, avance: 1, lateral: 0, ouvrir: false },
    { t: "ramasser", id: 3 }, { t: "lacher", slot: "principale" }, { t: "utiliser", objet: "bandage" }, { t: "statsBr" },
  ];

  it("lancerPartie, sauter, chute, ramasser, lacher, utiliser, statsBr : routés vers le service, sa réponse est renvoyée", () => {
    const { s, f } = salleBr();
    s.connecter("a", "Alice", T0);
    for (const m of MESSAGES) {
      const sorties = s.recevoir("a", m, T0 + 10);
      expect(types(sorties)).toEqual(["br"]);
    }
    expect(f.recus).toEqual(MESSAGES.map((m) => `a:${m.t}`));
  });

  it("hors BR (arène), ces messages ne font rien", () => {
    const arene = new Salle(mondePetit, POINTS, () => 0, T0);
    arene.connecter("a", "Alice", T0);
    for (const m of MESSAGES) expect(arene.recevoir("a", m, T0 + 10)).toEqual([]);
  });

  it("`acheter` et `reanimer` (zombies) ne vont pas au service BR", () => {
    const { s, f } = salleBr();
    s.connecter("a", "Alice", T0);
    expect(s.recevoir("a", { t: "reanimer", cible: "b" } as unknown as MessageClient, T0 + 10)).toEqual([]);
    expect(f.recus).toEqual([]);
  });

  it("chat vocal de killcam seulement : `voixActif` retenu (présence fusionnée), aucun relais hors d'un lien victime ↔ tueur", () => {
    const { s } = salleBr();
    joueursEnJeu(s, ["a", "b", "c"]);
    expect(s.recevoir("a", { t: "voixActif", actif: true }, T0 + 10)).toEqual([]);
    expect(s.recevoir("b", { t: "voixActif", actif: true }, T0 + 10)).toEqual([]);
    expect(s.recevoir("c", { t: "voixActif", actif: true }, T0 + 10)).toEqual([]);
    expect(j(s, "a").voix).toBe(true);
    // pas de lien : rien n'est relayé
    expect(s.recevoir("a", { t: "voix", a: "b", s: { type: "offre", sdp: "v=0" } }, T0 + 11)).toEqual([]);
    // a tue b : ils peuvent se parler (dans les deux sens), pas c
    const t = T0 + JEU.protectionMs + 100;
    s.infliger(j(s, "b"), 100, j(s, "a"), "arme", "corps", "pistolet", t);
    expect(s.recevoir("a", { t: "voix", a: "b", s: { type: "offre", sdp: "v=0" } }, t + 10)).toEqual([{ a: "b", m: { t: "voix", de: "a", s: { type: "offre", sdp: "v=0" } } }]);
    expect(s.recevoir("b", { t: "voix", a: "a", s: { type: "reponse", sdp: "v=1" } }, t + 20)).toHaveLength(1);
    expect(s.recevoir("c", { t: "voix", a: "a", s: { type: "offre", sdp: "v=0" } }, t + 20)).toEqual([]);
    // le lien expire ; « fin » passe toujours (il referme la connexion)
    const apres = t + LIEN_VOIX_KILLCAM_MS + 1;
    expect(s.recevoir("a", { t: "voix", a: "b", s: { type: "offre", sdp: "v=0" } }, apres)).toEqual([]);
    expect(s.recevoir("a", { t: "voix", a: "b", s: { type: "fin" } }, apres)).toHaveLength(1);
  });

  it("changer d'arme (`main`) interrompt l'usage d'un soin : `surDegats(j, \"arme\")`", () => {
    const { s, f } = salleBr({}, { principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true });
    joueursEnJeu(s, ["a"]);
    s.recevoir("a", { t: "main", slot: "secondaire" }, T0 + 500);
    expect(f.degatsVus).toEqual([{ id: "a", cause: "arme" }]);
    // un changement refusé (même slot) n'interrompt rien
    s.recevoir("a", { t: "main", slot: "secondaire" }, T0 + 600);
    expect(f.degatsVus).toHaveLength(1);
  });
});

describe("mort définitive", () => {
  /** Deux joueurs en jeu, protection d'atterrissage écoulée ; A porte un pistolet (secondaire) et une spéciale. */
  function duel() {
    const { s, f } = salleBr({}, { principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true });
    joueursEnJeu(s, ["a", "b"]);
    const t = T0 + JEU.protectionMs + 100;
    j(s, "a").p = [-10, 0, 20];
    j(s, "b").p = [10, 0, 20];
    return { s, f, t };
  }

  it("la branche BR : message `mort` à tous (delai 0, tueur), pas de réapparition, pas de `match`, pas de presence immédiate", () => {
    const { s, f, t } = duel();
    const sorties = s.infliger(j(s, "b"), 100, j(s, "a"), "arme", "corps", "pistolet", t, [0, 1, 0]);
    expect(types(sorties)).toEqual(["degats", "mort", "butin"]);
    const mort = messages(sorties, "mort")[0];
    expect(mort).toMatchObject({ cible: "b", par: "a", arme: "pistolet", cause: "arme", delai: 0, ts: t });
    expect(mort.tueur).toMatchObject({ id: "a", pseudo: "Joueura" });
    expect(sorties.find((x) => x.m.t === "mort")!.a).toBe("tous");
    const b = j(s, "b");
    expect(b).toMatchObject({ vivant: false, posture: "mort", morts: 1, serie: 0, reapparitionT: null });
    expect(f.surMorts).toEqual([{ cible: "b", tueur: "a", cause: "arme" }]);
    expect(types(sorties)).not.toContain("presence");
    expect(types(sorties)).not.toContain("match");
  });

  it("le tueur valide marque : kills, série, meilleure série, kills par arme ; une seule presence au tic suivant", () => {
    const { s, t } = duel();
    s.infliger(j(s, "b"), 100, j(s, "a"), "arme", "corps", "pistolet", t);
    const a = j(s, "a");
    expect(a.kills).toBe(1);
    expect(a.serie).toBe(1);
    expect(a.serieMax).toBe(1);
    expect(a.killsParArme).toEqual({ pistolet: 1 });
    const tic = avancer(s, t + 100, t + 100);
    const presences = messages(tic, "presence");
    expect(presences).toHaveLength(1);
    expect(presences[0].joueurs.find((x) => x.id === "a")).toMatchObject({ kills: 1 });
    expect(presences[0].joueurs.find((x) => x.id === "b")).toMatchObject({ morts: 1 });
  });

  it("tueur non valide (mort avant) : le service le sait, aucun kill, ni série ni kills par arme, `surMort` sans tueur ; le message `mort` garde `par`", () => {
    const { s, f, t } = duel();
    f.tueurValide = false;
    const sorties = s.infliger(j(s, "b"), 100, j(s, "a"), "arme", "corps", "pistolet", t);
    expect(j(s, "a")).toMatchObject({ kills: 0, serie: 0 });
    expect(j(s, "a").killsParArme).toEqual({});
    expect(f.surMorts).toEqual([{ cible: "b", tueur: null, cause: "arme" }]);
    expect(messages(sorties, "mort")[0]).toMatchObject({ par: "a" });
  });

  it("mort de tempête : cause `tempete`, `par` vide, aucun kill, arme du message = couteau, cause signalée au service", () => {
    const { s, f, t } = duel();
    const sorties = s.infliger(j(s, "b"), 100, null, "tempete", "corps", "couteau", t);
    expect(messages(sorties, "degats")[0]).toMatchObject({ cible: "b", par: "", degats: 100 });
    expect(messages(sorties, "mort")[0]).toMatchObject({ cible: "b", par: "", cause: "tempete", arme: "couteau", delai: 0 });
    expect(messages(sorties, "mort")[0].tueur).toBeUndefined();
    expect(j(s, "a").kills).toBe(0);
    expect(f.degatsVus).toEqual([{ id: "b", cause: "tempete" }]);
    expect(f.surMorts).toEqual([{ cible: "b", tueur: null, cause: "tempete" }]);
  });

  it("chaque dégât signale le coup au service (interruption d'un soin), y compris sans mort", () => {
    const { s, f, t } = duel();
    s.infliger(j(s, "b"), 30, j(s, "a"), "arme", "corps", "pistolet", t);
    expect(f.degatsVus).toEqual([{ id: "b", cause: "arme" }]);
    expect(j(s, "b").pv).toBe(70);
    expect(j(s, "b").vivant).toBe(true);
  });

  it("l'arme spéciale est encore là quand `surMort` s'exécute (lâcher du butin), puis effacée", () => {
    const { s, f, t } = duel();
    const b = j(s, "b");
    b.equip.speciale = "railgun";
    b.munSpeciale = 4;
    s.infliger(b, 100, j(s, "a"), "arme", "corps", "pistolet", t);
    expect(f.specialeVue).toBe("railgun");
    expect(b.equip.speciale).toBeNull();
    expect(b.munSpeciale).toBe(0);
  });

  it("jamais de réapparition ni de fin de match, même bien après `delaiReapparitionMs` et `dureeMatchMs`", () => {
    const { s, t } = duel();
    s.infliger(j(s, "b"), 100, j(s, "a"), "arme", "corps", "pistolet", t);
    const sorties = avancer(s, t + 100, t + JEU.dureeMatchMs + 5_000, 5_000);
    expect(types(sorties)).not.toContain("apparition");
    expect(types(sorties)).not.toContain("match");
    expect(j(s, "b")).toMatchObject({ vivant: false, reapparitionT: null, enJeu: true });
    expect(s.infoMatch()).toMatchObject({ phase: "jeu", fin: null });
  });

  it("un mort ne tire plus ni ne frappe, et ne peut plus être touché (jamais deux morts)", () => {
    const { s, t } = duel();
    s.infliger(j(s, "b"), 100, j(s, "a"), "arme", "corps", "pistolet", t);
    expect(s.infliger(j(s, "b"), 100, j(s, "a"), "arme", "corps", "pistolet", t + 10)).toEqual([]);
    expect(j(s, "b").morts).toBe(1);
  });

  it("pas de régénération : les PV ne remontent pas, même 30 s après les dégâts", () => {
    const { s, t } = duel();
    s.infliger(j(s, "b"), 40, j(s, "a"), "arme", "corps", "pistolet", t);
    avancer(s, t + 100, t + 30_000, 500);
    expect(j(s, "b").pv).toBe(60);
  });
});

describe("mêlée propre au BR : couteau 34, épée 70", () => {
  /** A au couteau (ou à l'épée) contre B, à 1,2 m, protection écoulée. */
  function corpsACorps(melee: "couteau" | "epee") {
    const { s } = salleBr({}, { ...EQUIPEMENT_DEPART_BR, ...(melee === "epee" ? { melee: "epee" as const } : {}) });
    joueursEnJeu(s, ["a", "b"]);
    const t = T0 + JEU.protectionMs + 100;
    j(s, "a").p = [-10, 0, 20];
    j(s, "b").p = [-8.8, 0, 20];
    return { s, t };
  }
  function frapper(s: Salle, t: number): Sortie[] {
    const a = j(s, "a"), b = j(s, "b");
    const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
    const vx = b.p[0] - o[0], vy = b.p[1] + SILHOUETTE.centreY - o[1], vz = b.p[2] - o[2];
    const l = Math.hypot(vx, vy, vz);
    const d: Vec3 = [vx / l, vy / l, vz / l];
    a.lacet = Math.atan2(-d[0], -d[2]);
    a.tangage = Math.asin(d[1]);
    return s.recevoir("a", { t: "coup", o, d, cibles: ["b"] }, t);
  }

  it("couteau : trois coups pour tuer (34, 34, puis la mort), au lieu d'un seul en arène", () => {
    const { s, t } = corpsACorps("couteau");
    const un = frapper(s, t);
    expect(messages(un, "degats")[0]).toMatchObject({ cible: "b", degats: 34, pv: 66 });
    expect(j(s, "b").vivant).toBe(true);
    const deux = frapper(s, t + 700);
    expect(messages(deux, "degats")[0]).toMatchObject({ degats: 34, pv: 32 });
    expect(j(s, "b").vivant).toBe(true);
    const trois = frapper(s, t + 1400);
    expect(messages(trois, "mort")[0]).toMatchObject({ cible: "b", par: "a", cause: "arme", arme: "couteau" });
    expect(j(s, "b").vivant).toBe(false);
    expect(j(s, "a").kills).toBe(1);
  });

  it("épée : deux coups (70, puis la mort)", () => {
    const { s, t } = corpsACorps("epee");
    expect(j(s, "a").arme).toBe("epee");
    const un = frapper(s, t);
    expect(messages(un, "degats")[0]).toMatchObject({ degats: 70, pv: 30 });
    const deux = frapper(s, t + 1500);
    expect(messages(deux, "mort")[0]).toMatchObject({ cible: "b", arme: "epee" });
  });

  it("en arène (sans `br`) le même coup de couteau tue en un coup", () => {
    const arene = new Salle(mondePetit, POINTS, () => 0, T0);
    for (const id of ["a", "b"]) { arene.connecter(id, `Joueur${id}`, T0); arene.recevoir(id, { t: "rejoindre", arme: "pistolet" }, T0); }
    const t = T0 + JEU.protectionMs + 100;
    j(arene, "a").p = [-10, 0, 20];
    j(arene, "b").p = [-8.8, 0, 20];
    j(arene, "a").main = "couteau";
    j(arene, "a").arme = "couteau";
    j(arene, "a").sortieJusqua = T0;
    const sorties = frapper(arene, t);
    expect(messages(sorties, "mort")).toHaveLength(1);
  });
});

describe("état, snap, inactivité", () => {
  it("`etat` ignoré pour un joueur à bord ou en chute, accepté sinon", () => {
    const { s, f } = salleBr();
    joueursEnJeu(s, ["a", "b"]);
    f.enVol.add("a");
    const etat = (seq: number): MessageClient => ({ t: "etat", seq, p: [0, 300, 1], v: [0, 0, 0], lacet: 1, tangage: 0, posture: "air", mur: 0 });
    s.recevoir("a", etat(0), T0 + 100);
    s.recevoir("b", etat(0), T0 + 100);
    expect(j(s, "a").p).toEqual([0, 300, 0]);
    expect(j(s, "a").seq).toBe(-1);
    expect(j(s, "b").seq).toBe(0);
    expect(j(s, "b").p).toEqual([0, 300, 1]);
  });

  it("snap BR : un message `joueurs` à 10 Hz, sans spectateurs ; ni joueurs à bord, ni morts de plus de 5 s ; champ `chute`", () => {
    const { s, f } = salleBr();
    joueursEnJeu(s, ["sol", "bord", "recent", "ancien", "air"]);
    s.connecter("spectateur", "Spectateur", T0);
    f.aBord.add("bord");
    f.chutes.set("air", "libre");
    const tMort = T0 + 20_000;
    j(s, "recent").protegeJusqua = 0;
    j(s, "ancien").protegeJusqua = 0;
    // "ancien" meurt 6 s avant le snap observé, "recent" 2 s avant
    s.infliger(j(s, "ancien"), 100, null, "tempete", "corps", "couteau", tMort - 6_000);
    s.infliger(j(s, "recent"), 100, null, "tempete", "corps", "couteau", tMort - 2_000);
    const sorties = avancer(s, tMort, tMort + 1_000, 50);
    const snaps = sorties.filter((x) => x.m.t === "snap");
    expect(snaps.every((x) => x.a === "joueurs")).toBe(true);
    expect(snaps.length).toBeGreaterThanOrEqual(10);
    expect(snaps.length).toBeLessThanOrEqual(11);
    const dernier = (snaps.at(-1)!.m as Extract<MessageServeur, { t: "snap" }>);
    expect(dernier.j.map((x) => x.id).sort()).toEqual(["air", "recent", "sol"]);
    expect(dernier.j.find((x) => x.id === "air")?.chute).toBe("libre");
    expect(dernier.j.find((x) => x.id === "sol")?.chute).toBeUndefined();
    expect(dernier.j.find((x) => x.id === "recent")).toMatchObject({ vivant: false, posture: "mort" });
    expect(dernier.monstres).toBeUndefined();
    expect(dernier.vehicules).toBeUndefined();
    // le mort est encore dans la présence, même sorti du snap
    expect(s.joueursPublics().map((x) => x.id)).toContain("ancien");
  });

  it("un mort de plus de 5 s sort du snap mais reste en jeu (présence)", () => {
    const { s } = salleBr();
    joueursEnJeu(s, ["a"]);
    s.infliger(j(s, "a"), 100, null, "tempete", "corps", "couteau", T0 + 1_000);
    const loin = avancer(s, T0 + 8_000, T0 + 8_000, 50);
    expect((loin.find((x) => x.m.t === "snap")!.m as Extract<MessageServeur, { t: "snap" }>).j).toEqual([]);
  });

  it("aucun bus C3, fumigène ni frappe en BR", () => {
    const { s } = salleBr();
    joueursEnJeu(s, ["a"]);
    const sorties = avancer(s, T0 + 100, T0 + 200_000, 2_000);
    expect(types(sorties)).not.toContain("busC3");
    expect(sorties.filter((x) => x.m.t === "snap").every((x) => (x.m as Extract<MessageServeur, { t: "snap" }>).monstres === undefined)).toBe(true);
    expect(s.recevoir("a", { t: "lancerFumigene", p: [0, 0, 0], v: [0, 0, 0] }, T0 + 300_000)).toEqual([]);
  });

  it("le service est appelé à chaque tic", () => {
    const { s, f } = salleBr();
    s.tic(T0 + 50);
    s.tic(T0 + 100);
    expect(f.appels.filter((x) => x === "tic")).toHaveLength(2);
  });

  it("inactivité : un vivant sans état depuis BR.inactifMs est retiré (`liberer`), une seule presence ; jamais en vol", () => {
    expect(BR.inactifMs).toBe(INACTIF_MS);
    const { s, f } = salleBr();
    joueursEnJeu(s, ["gel", "vol", "actif"]);
    f.enVol.add("vol");
    const sorties = avancer(s, T0 + 100, T0 + BR.inactifMs + 2_000, 1_000, ["actif"]);
    expect(f.liberes).toEqual([{ id: "gel", present: true }]);
    expect(j(s, "gel")).toMatchObject({ enJeu: false, vivant: false });
    expect(j(s, "vol").enJeu).toBe(true);
    expect(j(s, "actif").enJeu).toBe(true);
    // la presence de l'éviction (et celle des trois entrées) est fusionnée : une seule, puis rien
    const presences = messages(sorties, "presence");
    expect(presences.length).toBeGreaterThanOrEqual(1);
    expect(presences.at(-1)!.joueurs.find((x) => x.id === "gel")?.enJeu).toBe(false);
    expect(presences.length).toBeLessThanOrEqual(2);
  });

  it("`quitter` passe par le service (éliminé s'il était en partie)", () => {
    const { s, f } = salleBr();
    joueursEnJeu(s, ["a"]);
    const sorties = s.recevoir("a", { t: "quitter" }, T0 + 100);
    expect(f.liberes).toEqual([{ id: "a", present: true }]);
    expect(j(s, "a").enJeu).toBe(false);
    expect(types(sorties)).toEqual(["br", "presence"]);
  });
});

describe("arme spéciale épuisée sans principale ni secondaire", () => {
  it("retombe sur l'arme blanche (couteau) avec le message `equipement`", () => {
    const { s } = salleBr({}, { ...EQUIPEMENT_DEPART_BR, speciale: "railgun" });
    joueursEnJeu(s, ["a"]);
    const a = j(s, "a");
    a.munSpeciale = 1;
    a.main = "speciale";
    a.arme = "railgun";
    a.p = [-10, 0, 20];
    a.protegeJusqua = 0;
    const t = T0 + 1_000;
    const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
    const sorties = s.recevoir("a", { t: "tir", arme: "railgun", o, d: [[-Math.sin(a.lacet), 0, -Math.cos(a.lacet)]], touches: [] }, t);
    const eq = messages(sorties, "equipement")[0];
    expect(eq).toBeDefined();
    expect(eq.main).toBe("couteau");
    expect(eq.equip.speciale).toBeNull();
    expect(a.main).toBe("couteau");
    expect(a.arme).toBe("couteau");
  });

  it("un joueur à bord ne peut ni tirer ni frapper", () => {
    const { s, f } = salleBr({}, { ...EQUIPEMENT_DEPART_BR, speciale: "railgun" });
    joueursEnJeu(s, ["a"]);
    f.aBord.add("a");
    const a = j(s, "a");
    const protection = a.protegeJusqua;
    a.munSpeciale = 3;
    a.main = "speciale";
    a.arme = "railgun";
    const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
    expect(s.recevoir("a", { t: "tir", arme: "railgun", o, d: [[-Math.sin(a.lacet), 0, -Math.cos(a.lacet)]], touches: [] }, T0 + 1_000)).toEqual([]);
    a.main = "couteau";
    a.arme = "couteau";
    expect(s.recevoir("a", { t: "coup", o, d: [-Math.sin(a.lacet), 0, -Math.cos(a.lacet)], cibles: [] }, T0 + 2_000)).toEqual([]);
    expect(a.protegeJusqua).toBe(protection); // frapper aurait annulé la protection
  });
});

describe("placerJoueur et compensation de latence", () => {
  it("`prive` adresse l'apparition au seul joueur ; par défaut elle part à tous", () => {
    const { s } = salleBr();
    s.connecter("a", "Alice", T0);
    const equip = copierEquipement(EQUIPEMENT_DEPART_BR);
    const prive = s.placerJoueur(j(s, "a"), [0, 0, 0], 0, { pv: 100, equip, main: "couteau", prive: true }, T0);
    const public_ = s.placerJoueur(j(s, "a"), [0, 0, 0], 0, { pv: 100, equip, main: "couteau" }, T0);
    expect(prive[0].a).toBe("a");
    expect(public_[0].a).toBe("tous");
  });

  /** Salle (BR ou arène) avec un joueur "a" posé à pied en (−10, 0, 20), protection levée, `etatT` = T0. */
  function salleAvecA(br: boolean): Salle {
    const s = br ? salleBr().s : new Salle(mondePetit, POINTS, () => 0, T0);
    s.connecter("a", "Alice", T0);
    s.recevoir("a", br ? { t: "rejoindre" } : { t: "rejoindre", arme: "pistolet" }, T0);
    const a = j(s, "a");
    a.p = [-10, 0, 20];
    a.v = [0, 0, 0];
    a.protegeJusqua = 0;
    a.etatT = T0;
    a.seq = -1;
    return s;
  }
  const etatA = (seq: number, x: number): MessageClient => ({ t: "etat", seq, p: [x, 0, 20], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 });

  it("historique de positions : 500 ms en BR, 400 ms en arène", () => {
    for (const [br, attendu] of [[true, BR.historiqueMs], [false, HISTORIQUE_MS]] as const) {
      const s = salleAvecA(br);
      for (let i = 1; i <= 20; i++) s.recevoir("a", etatA(i, -10 + i * 0.1), T0 + i * 100);
      expect(j(s, "a").histo[0].t - T0).toBe(2_000 - attendu);
    }
    expect([BR.historiqueMs, HISTORIQUE_MS]).toEqual([500, 400]);
  });

  it("l'option `historiqueMs` surcharge le défaut", () => {
    const { s } = salleBr({ historiqueMs: 200 });
    s.connecter("a", "Alice", T0);
    s.recevoir("a", { t: "rejoindre" }, T0);
    const a = j(s, "a");
    a.p = [-10, 0, 20];
    a.etatT = T0;
    for (let i = 1; i <= 10; i++) s.recevoir("a", etatA(i, -10 + i * 0.1), T0 + i * 100);
    expect(a.histo[0].t - T0).toBe(800);
  });

  it("un tir remonte le temps de 400 ms en BR (300 ms en arène)", () => {
    const resultats: boolean[] = [];
    for (const br of [true, false]) {
      const s = salleAvecA(br);
      // la cible était en (10, 0, 20) il y a 350 ms et vient de partir à 5 m de là
      j(s, "a").p = [10, 0, 20];
      s.recevoir("a", etatA(0, 10), T0 + 1_000);
      s.recevoir("a", etatA(1, 15), T0 + 1_350);
      // le rayon, d'une portée de 21 m depuis x = −10, atteint x = 10 mais pas x = 15 : seul le rejeu retrouve la cible
      resultats.push(s.toucheJoueur(j(s, "a"), [-10, 1, 20], [1, 0, 0], 21, T0 + 1_350));
    }
    expect(resultats).toEqual([true, false]);
    expect([BR.rewindMaxMs, REWIND_MAX_MS]).toEqual([400, 300]);
  });
});
