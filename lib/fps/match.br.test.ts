import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { pointsButin, construireMondeBr } from "./br-carte";
import { BR } from "./br-regles";
import { appliquerPartie, statsVides, type PersistanceBr, type ResultatPartieBr, type StatsBr } from "./br-stats";
import { STATS } from "./armes";
import { resoudre } from "./collision";
import { Salle, type JoueurSalle, type OptionsSalle, type Sortie } from "./match";
import type { OptionsServiceBr } from "./match-br";
import type { ServiceBr } from "./match-contexte";
import { JEU, SILHOUETTE, type ArmeFeuId, type EtatPartieBr, type EtatJoueurSnap, type MessageClient, type MessageServeur, type ObjetBr, type Vec3 } from "./protocole";

/**
 * Intégration : une vraie `Salle` en mode Battle Royale (lobby → décompte → avion → saut → chute → atterrissage → mêlée → tempête → victoire →
 * retour au lobby) sur le vrai monde BR. Les règles du service sont dans match-br*.test.ts et les crochets de la salle dans match.br-hooks.test.ts ;
 * ici on vérifie ce que le tout fait ensemble, message par message. Aucune horloge ni aucun hasard globaux : `T0` et un LCG.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
/** Un seul monde pour tout le fichier : sa construction coûte (grille, pièces creuses) et aucun test n'y perce de brèche. */
const monde = construireMondeBr(scene);
const T0 = 5_000_000;

function suite(graine = 3): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/** Persistance factice : les statistiques en mémoire, avec le journal des parties enregistrées. */
function persistance(): PersistanceBr & { parties: ResultatPartieBr[]; courant(): StatsBr } {
  let stats = statsVides();
  const parties: ResultatPartieBr[] = [];
  return {
    parties,
    courant: () => stats,
    lire: () => stats,
    enregistrer(partie) { parties.push(partie); stats = appliquerPartie(stats, partie); return stats; },
  };
}

/** Réglages d'essai communs : vol court, peu d'objets, zone lente (aucun dégât de tempête avant la fin des tests de mêlée). */
function optionsService(plus: Partial<Omit<OptionsServiceBr, "alea" | "scene">> = {}): Omit<OptionsServiceBr, "alea"> {
  return { scene, dureeVolMs: 10_000, nbObjets: 150, echelleZone: 1, partieValideMinMs: 1_000, finAffichageMs: 5_000, ...plus };
}

function salleBr(plus: Partial<Omit<OptionsServiceBr, "alea" | "scene">> = {}, options: OptionsSalle = {}): Salle {
  const depart: [number, number] = [(monde.bornes.x0 + monde.bornes.x1) / 2, (monde.bornes.z0 + monde.bornes.z1) / 2];
  return new Salle(monde, [depart], suite(), T0, { br: optionsService(plus), ...options });
}

const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
const types = (s: Sortie[]) => s.map((x) => x.m.t);
/** Messages de type `t` adressés à `id` (directement, ou par une diffusion qui l'inclut). */
function pour<T extends MessageServeur["t"]>(sorties: Sortie[], id: string, t: T, enJeu = true): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t && recoit(x, id, enJeu)).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
function recoit(x: Sortie, id: string, enJeu: boolean): boolean {
  if (x.sauf === id) return false;
  return x.a === id || x.a === "tous" || (x.a === "joueurs" && enJeu) || (x.a === "spectateurs" && !enJeu);
}
const dernierEtat = (s: Sortie[]): EtatPartieBr | undefined => messages(s, "br").at(-1)?.etat;
const dernierSnap = (s: Sortie[]): EtatJoueurSnap[] | undefined => messages(s.filter((x) => x.a === "joueurs"), "snap").at(-1)?.j;
/** Pseudos lisibles, de base distincte (les chiffres finaux compteraient comme un conflit de noms). */
const NOMS = ["Alice", "Bob", "Cora", "Dan"];

/** Pilote de la salle : le temps courant et le journal de tout ce que le serveur a émis. */
interface Banc { s: Salle; t: number; log: Sortie[]; ids: string[] }

/** Avance de `ms` en tics de `pas` ms ; `parPas` envoie les messages des clients à chaque tic. Les joueurs de `actifs` restent « actifs » (hors vol). */
function avancer(b: Banc, ms: number, o: { pas?: number; parPas?: (t: number) => void; actifs?: string[] } = {}): Sortie[] {
  const pas = o.pas ?? 100;
  const out: Sortie[] = [];
  const fin = b.t + ms;
  while (b.t < fin) {
    b.t = Math.min(fin, b.t + pas);
    for (const x of b.s.joueurs()) if (x.enJeu && (!o.actifs || o.actifs.includes(x.id))) x.etatT = b.t;
    o.parPas?.(b.t);
    out.push(...b.s.tic(b.t));
  }
  b.log.push(...out);
  return out;
}
/** Avance jusqu'à ce que `fait` soit vrai (échec après `maxMs`). */
function avancerJusque(b: Banc, fait: () => boolean, maxMs: number, pas = 100, parPas?: (t: number) => void): Sortie[] {
  const out: Sortie[] = [];
  const limite = b.t + maxMs;
  while (!fait()) {
    if (b.t >= limite) throw new Error(`condition non atteinte en ${maxMs} ms`);
    out.push(...avancer(b, pas, { pas, parPas }));
  }
  return out;
}
function envoyer(b: Banc, id: string, m: MessageClient): Sortie[] {
  const out = b.s.recevoir(id, m, b.t);
  b.log.push(...out);
  return out;
}
/** Le service de la salle (champ privé, lu pour l'état complet et la chute). */
const service = (b: Banc): ServiceBr => (b.s as unknown as { br: ServiceBr }).br;
const etatBr = (b: Banc): EtatPartieBr => service(b).etat();

/** Salle avec les joueurs connectés (le premier est l'hôte), dans le lobby. */
function lobby(ids: string[], plus: Partial<Omit<OptionsServiceBr, "alea" | "scene">> = {}, options: OptionsSalle = {}): Banc {
  const s = salleBr(plus, options);
  const b: Banc = { s, t: T0, log: [], ids };
  ids.forEach((id, i) => b.log.push(...s.connecter(id, NOMS[i] ?? `Joueur${String.fromCharCode(65 + i)}`, T0)));
  return b;
}

/** L'hôte lance, tous rejoignent (dans l'avion à l'arrêt), le décompte se termine : l'avion est parti. */
function jusquAuVol(ids: string[], plus: Partial<Omit<OptionsServiceBr, "alea" | "scene">> = {}): Banc {
  const b = lobby(ids, plus);
  envoyer(b, ids[0], { t: "lancerPartie" });
  b.t = T0 + 100;
  for (const id of ids) envoyer(b, id, { t: "rejoindre" });
  avancerJusque(b, () => etatBr(b).phase === "vol", 40_000);
  return b;
}

/** Entrées de chute d'un client : piqué vers l'avant, parachute ouvert à la demande. */
const chuteMsg = (ouvrir: boolean): MessageClient => ({ t: "chute", lacet: 0, tangage: -1.1, avance: 1, lateral: 0, ouvrir });

/** Tout le monde saute (libre ou forcé), chacun atterrit ; la protection d'atterrissage est écoulée. */
function jusquAuSol(ids: string[], plus: Partial<Omit<OptionsServiceBr, "alea" | "scene">> = {}): Banc {
  const b = jusquAuVol(ids, plus);
  for (const id of ids.slice(1)) envoyer(b, id, { t: "sauter" });
  const saut = b.t;
  const piloter = (t: number) => {
    for (const id of ids.slice(1)) b.s.recevoir(id, chuteMsg(t - saut >= 1_500), t);
  };
  avancerJusque(b, () => ids.every((id) => j(b.s, id).posture === "sol") && etatBr(b).phase === "jeu", 120_000, 100, piloter);
  avancer(b, BR.protectionAtterrissageMs + 200);
  return b;
}

/** Deux joueurs face à face sur la chaussée, à 1,2 m (compensation de latence : historique remis à la position). */
function rapprocher(b: Banc, a: string, c: string, decalage = 0): void {
  const pts = pointsButin(scene, monde).filter((x) => x.pool === "route");
  const libre = pts.find((x, i) => i >= decalage && ![0, 1.2, 2.4].some((dx) => {
    const p: Vec3 = [x.p[0] + dx, x.p[1], x.p[2]];
    const r = resoudre(monde, p, 0.4, 1.8).p;
    return Math.hypot(r[0] - p[0], r[2] - p[2]) > 1e-6;
  }));
  if (!libre) throw new Error("aucune chaussée libre");
  for (const [id, dx] of [[a, 0], [c, 1.2]] as const) {
    const x = j(b.s, id);
    x.p = [libre.p[0] + dx, libre.p[1], libre.p[2]];
    x.histo = [{ t: b.t, p: [...x.p] as Vec3, accroupi: false }];
    x.etatT = b.t;
  }
}

/** Un coup d'arme blanche de `a` sur `c`, œil et visée recalculés. */
function frapper(b: Banc, a: string, c: string): Sortie[] {
  const x = j(b.s, a), y = j(b.s, c);
  const o: Vec3 = [x.p[0], x.p[1] + SILHOUETTE.oeil, x.p[2]];
  const v = [y.p[0] - o[0], y.p[1] + SILHOUETTE.centreY - o[1], y.p[2] - o[2]];
  const l = Math.hypot(v[0], v[1], v[2]);
  const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
  x.lacet = Math.atan2(-d[0], -d[2]);
  x.tangage = Math.asin(d[1]);
  return envoyer(b, a, { t: "coup", o, d, cibles: [c] });
}

// ---------------------------------------------------------------------------------------------
describe("lobby, lancement, admission", () => {
  it("la connexion fait un membre du lobby : bienvenue, présence, `br{etat}` ; hôte = premier arrivé", () => {
    const s = salleBr();
    const sorties = s.connecter("a", "Alice", T0);
    expect(types(sorties)).toEqual(["bienvenue", "presence", "br"]);
    expect(messages(sorties, "bienvenue")[0].match).toMatchObject({ phase: "jeu", objectif: 0, fin: null });
    expect(dernierEtat(sorties)).toMatchObject({ phase: "lobby", hote: "a", capacite: BR.joueursMax, minJoueurs: BR.joueursMin, avion: null, zone: null });
    expect(s.resumeBr()).toEqual({ phase: "lobby", joueurs: 1, vivants: 0 });
    expect(s.nombreEnJeu()).toBe(0);
    // le deuxième arrive : tout le monde apprend la liste
    const deux = s.connecter("b", "Bob", T0 + 10);
    expect(dernierEtat(deux)!.joueurs!.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("`statsBr` : palmarès privé (avec la ligne du demandeur une fois comptée), au plus une demande toutes les 2 s", () => {
    const b = lobby(["a"]);
    const un = envoyer(b, "a", { t: "statsBr" });
    expect(un).toEqual([{ a: "a", m: { t: "statsBr", lignes: [] } }]);
    expect(envoyer(b, "a", { t: "statsBr" })).toEqual([]);
    b.t += 2_100;
    expect(types(envoyer(b, "a", { t: "statsBr" }))).toEqual(["statsBr"]);
  });

  it("`rejoindre` est refusé (`lobby`) avant le lancement ; seul l'hôte lance, avec au moins deux membres", () => {
    const b = lobby(["a", "b"]);
    expect(envoyer(b, "a", { t: "rejoindre" })).toEqual([{ a: "a", m: { t: "refus", action: "rejoindre", raison: "lobby" } }]);
    expect(j(b.s, "a").enJeu).toBe(false);
    expect(envoyer(b, "b", { t: "lancerPartie" })).toEqual([]);
    expect(b.s.resumeBr()!.phase).toBe("lobby");

    const seul = lobby(["a"]);
    expect(envoyer(seul, "a", { t: "lancerPartie" })).toEqual([]);
    expect(seul.s.resumeBr()!.phase).toBe("lobby");

    const lance = envoyer(b, "a", { t: "lancerPartie" });
    expect(dernierEtat(lance)).toMatchObject({ phase: "decompte", total: 2, vivants: 2, hote: "a" });
    expect(dernierEtat(lance)!.avion).not.toBeNull();
    expect(dernierEtat(lance)!.zone).toBeNull();
    expect(types(lance)).toContain("presence");
  });

  it("deux noms de base identiques bloquent le lancement (`conflitNoms`)", () => {
    const s = salleBr();
    const b: Banc = { s, t: T0, log: [], ids: ["a", "b"] };
    s.connecter("a", "Toto", T0);
    s.connecter("b", "Toto", T0);
    expect(j(s, "b").pseudo).toBe("Toto2");
    const sorties = envoyer(b, "a", { t: "lancerPartie" });
    expect(s.resumeBr()!.phase).toBe("lobby");
    expect(dernierEtat(avancer(b, 300)) ?? dernierEtat(sorties)).toMatchObject({ phase: "lobby", conflitNoms: true });
  });

  it("admis : placé dans l'avion à l'arrêt, équipement de départ sans arme à feu, apparition PRIVÉE, butin complet, inventaire, état ; aucune présence", () => {
    const b = lobby(["a", "b"]);
    envoyer(b, "a", { t: "lancerPartie" });
    b.t = T0 + 100;
    const sorties = envoyer(b, "a", { t: "rejoindre" });
    expect(types(sorties)).toEqual(["apparition", "br", "butin", "inventaire"]);
    const ap = messages(sorties, "apparition")[0];
    expect(sorties[0].a).toBe("a"); // privée : les autres ne voient personne à bord
    expect(ap).toMatchObject({
      id: "a", pv: JEU.pvMax, bouclier: 0, arme: "couteau", main: "couteau",
      equip: { sansPrincipale: true, sansSecondaire: true, speciale: null },
    });
    expect(ap.p[1]).toBeGreaterThanOrEqual(300);
    expect(j(b.s, "a")).toMatchObject({ enJeu: true, vivant: true, posture: "air" });
    expect(j(b.s, "a").protegeJusqua).toBe(Infinity);
    // la liste initiale complète du butin, une fois, à lui seul
    const butin = messages(sorties, "butin")[0];
    expect(butin.ajoutes).toHaveLength(150);
    expect(butin.retires).toBeUndefined();
    expect(sorties.every((x) => x.a === "a")).toBe(true);
    expect(messages(sorties, "inventaire")[0]).toEqual({ t: "inventaire", bandage: 0, potion: 0, usage: null });
    // un deuxième `rejoindre` ne fait rien ; `sauter` n'est pas permis pendant le décompte (avion immobile)
    expect(envoyer(b, "a", { t: "rejoindre" })).toEqual([]);
    expect(envoyer(b, "a", { t: "sauter" })).toEqual([]);
    expect(b.s.resumeBr()!.phase).toBe("decompte");
    // l'hôte et ses compagnons : `arme` / `equiper` ignorés
    envoyer(b, "a", { t: "equiper", principale: "sniper", secondaire: "revolver", melee: "epee" });
    envoyer(b, "a", { t: "arme", arme: "pompe" });
    expect(j(b.s, "a").equip).toMatchObject({ sansPrincipale: true, sansSecondaire: true });
  });

  it("le décompte se termine dès que tous les admis ont rejoint, jamais avant `decompteMinMs`", () => {
    const b = lobby(["a", "b"]);
    envoyer(b, "a", { t: "lancerPartie" });
    b.t = T0 + 100;
    envoyer(b, "a", { t: "rejoindre" });
    envoyer(b, "b", { t: "rejoindre" });
    expect(etatBr(b).phase).toBe("decompte");
    avancer(b, 2_000);
    expect(etatBr(b).phase).toBe("decompte"); // 3 s de décompte au moins, depuis le lancement
    const sorties = avancer(b, 1_200);
    expect(etatBr(b).phase).toBe("vol");
    const etat = messages(sorties, "br").find((m) => m.etat.phase === "vol")!.etat;
    expect(etat.avion).toMatchObject({ altitude: expect.any(Number) });
    expect(etat.avion!.finT - etat.avion!.debutT).toBe(10_000);
    expect(etat.zone).toMatchObject({ palier: 1, phase: "attente" });
    expect(etat.vivants).toBe(2);
  });

  it("décompte non terminé par un absent : le plafond tranche ; moins de deux à bord, la partie est annulée", () => {
    const b = lobby(["a", "b"], { decompteMaxMs: 6_000 });
    envoyer(b, "a", { t: "lancerPartie" });
    b.t = T0 + 100;
    envoyer(b, "a", { t: "rejoindre" }); // b ne rejoint pas
    const sorties = avancer(b, 6_500);
    expect(etatBr(b).phase).toBe("lobby");
    expect(messages(sorties, "br").some((m) => m.etat.annule === true)).toBe(true);
    expect(j(b.s, "a").enJeu).toBe(false);
    expect(b.s.nombreEnJeu()).toBe(0);
  });

  it("un joueur arrivé en cours de partie reste dans le lobby en attente : il reçoit `br{etat}` seul, ne peut ni lancer ni rejoindre", () => {
    const b = jusquAuVol(["a", "b"]);
    const sorties = b.s.connecter("c", "Cora", b.t);
    b.log.push(...sorties);
    const etats = messages(sorties, "br");
    expect(etats).toHaveLength(1);
    expect(sorties.find((x) => x.m.t === "br")!.a).toBe("c"); // privé : les autres ne voient pas son arrivée comme un changement de phase
    expect(etats[0].etat).toMatchObject({ phase: "vol", total: 2 });
    expect(envoyer(b, "c", { t: "rejoindre" })).toEqual([{ a: "c", m: { t: "refus", action: "rejoindre", raison: "lobby" } }]);
    expect(envoyer(b, "c", { t: "lancerPartie" })).toEqual([]);
    expect(envoyer(b, "c", { t: "sauter" })).toEqual([]);
    expect(j(b.s, "c").enJeu).toBe(false);
    const snap = dernierSnap(avancer(b, 300));
    expect(snap?.some((x) => x.id === "c") ?? false).toBe(false);
    expect(b.s.nombreEnJeu()).toBe(2);
    expect(b.s.resumeBr()).toMatchObject({ phase: "vol", joueurs: 3, vivants: 2 });
    // la partie se termine (b part, a gagne) puis le lobby revient : le retardataire est admis à la suivante
    b.log.push(...b.s.deconnecter("b", b.t));
    expect(etatBr(b).phase).toBe("fin");
    avancerJusque(b, () => etatBr(b).phase === "lobby", 60_000);
    expect(b.s.nombreEnJeu()).toBe(0);
    const relance = envoyer(b, "a", { t: "lancerPartie" });
    expect(dernierEtat(relance)).toMatchObject({ phase: "decompte", total: 2 });
    const rejoint = envoyer(b, "c", { t: "rejoindre" });
    expect(types(rejoint)).toContain("apparition");
    expect(j(b.s, "c").enJeu).toBe(true);
  });

  it("50 `rejoindre` en rafale : aucune présence dans les réponses, une seule présence fusionnée au tic suivant", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `j${i}`);
    const s = salleBr();
    const b: Banc = { s, t: T0, log: [], ids };
    ids.forEach((id, i) => s.connecter(id, `Pilote${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`, T0));
    envoyer(b, "j0", { t: "lancerPartie" });
    b.t = T0 + 100;
    const reponses: Sortie[] = [];
    for (const id of ids) reponses.push(...envoyer(b, id, { t: "rejoindre" }));
    expect(messages(reponses, "presence")).toHaveLength(0);
    expect(messages(reponses, "apparition")).toHaveLength(50);
    expect(reponses.filter((x) => x.m.t === "apparition").every((x) => ids.includes(x.a))).toBe(true);
    const tic = avancer(b, 100);
    expect(messages(tic, "presence")).toHaveLength(1);
    expect(messages(tic, "presence")[0].joueurs.filter((x) => x.enJeu)).toHaveLength(50);
    expect(b.s.nombreEnJeu()).toBe(50);
    expect(dernierEtat(reponses)!.joueurs).toHaveLength(50);
  });
});

// ---------------------------------------------------------------------------------------------
describe("avion, saut, chute, atterrissage", () => {
  it("saut libre : `saut` privé à l'ordre, snap avec `chute`, joueur à bord absent du snap, `etat` d'un client en vol ignoré", () => {
    const b = jusquAuVol(["a", "b"]);
    const avion = etatBr(b).avion!;
    expect(j(b.s, "a").posture).toBe("air");
    // à bord : absents du snap
    expect(dernierSnap(avancer(b, 300))?.map((x) => x.id) ?? []).toEqual([]);
    const sorties = envoyer(b, "a", { t: "sauter" });
    expect(types(sorties)).toEqual(["saut"]);
    expect(sorties[0].a).toBe("a");
    const saut = messages(sorties, "saut")[0];
    expect(saut.p[1]).toBeCloseTo(avion.altitude, 0);
    expect(Math.hypot(saut.v[0], saut.v[2])).toBeCloseTo(avion.vitesse, 0);
    // sauter deux fois ne fait rien (déjà en chute)
    expect(envoyer(b, "a", { t: "sauter" })).toEqual([]);
    // en chute : snap avec `chute: libre`, b toujours à bord
    const snap = dernierSnap(avancer(b, 300))!;
    expect(snap.map((x) => x.id)).toEqual(["a"]);
    expect(snap[0]).toMatchObject({ chute: "libre", posture: "air", vivant: true, protege: true });
    // le serveur est seul maître de la chute : un `etat` truqué est refusé
    const avant = [...j(b.s, "a").p];
    envoyer(b, "a", { t: "etat", seq: 1, p: [avant[0] + 5, 0, avant[2]], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 });
    expect(j(b.s, "a").seq).toBe(-1);
    expect(j(b.s, "a").p[1]).toBeGreaterThan(100);
  });

  it("ouverture manuelle du parachute (refusée avant 1 s), puis atterrissage : `atterri` privé, posture au sol, invulnérable 5 s", () => {
    const b = jusquAuVol(["a", "b"]);
    envoyer(b, "a", { t: "sauter" });
    const saut = b.t;
    const vus: string[] = [];
    // ouverture demandée trop tôt (à 0,2 s) : ignorée ; acceptée ensuite
    b.s.recevoir("a", chuteMsg(true), saut + 200);
    const sorties = avancerJusque(b, () => messages(b.log.filter((x) => x.a === "a"), "atterri").length > 0, 120_000, 100, (t) => {
      b.s.recevoir("a", chuteMsg(t - saut >= 1_500), t);
      const c = service(b).chute("a");
      if (c && vus[vus.length - 1] !== c) vus.push(c);
    });
    expect(vus).toEqual(["libre", "voile"]);
    const atterri = messages(sorties.filter((x) => x.a === "a"), "atterri")[0];
    const a = j(b.s, "a");
    expect(a.posture).toBe("sol");
    expect(a.p).toEqual(atterri.p);
    expect(a.seq).toBe(-1);
    expect(a.v).toEqual([0, 0, 0]);
    expect(a.protegeJusqua).toBeGreaterThan(b.t);
    expect(a.protegeJusqua - b.t).toBeLessThanOrEqual(BR.protectionAtterrissageMs);
    expect(a.protegeJusqua).not.toBe(Infinity);
    // le snap le montre au sol, sans champ `chute`
    const snap = dernierSnap(avancer(b, 200))!.find((x) => x.id === "a")!;
    expect(snap.chute).toBeUndefined();
    expect(snap.posture).toBe("sol");
    // après l'atterrissage ses `etat` normaux reprennent
    envoyer(b, "a", { t: "etat", seq: 1, p: [a.p[0] + 0.1, a.p[1], a.p[2]], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 });
    expect(a.seq).toBe(1);
  });

  it("éjection forcée à la fin du vol et pilote automatique : un joueur qui n'envoie rien atterrit quand même", () => {
    const b = jusquAuVol(["a", "b"]);
    const avion = etatBr(b).avion!;
    // personne ne saute : à `finT`, les deux sont éjectés
    const sorties = avancerJusque(b, () => b.t >= avion.finT + 100, 20_000);
    expect(pour(sorties, "a", "saut")).toHaveLength(1);
    expect(pour(sorties, "b", "saut")).toHaveLength(1);
    expect(etatBr(b).phase).toBe("jeu");
    // sans le moindre message de chute : ouverture automatique sous 90 m, puis atterrissage
    const suite = avancerJusque(b, () => j(b.s, "a").posture === "sol" && j(b.s, "b").posture === "sol", 120_000);
    expect(pour(suite, "a", "atterri")).toHaveLength(1);
    expect(pour(suite, "b", "atterri")).toHaveLength(1);
  });

  it("un `rejoindre` après la fin du vol est refusé (`lobby`) et le retardataire reste en attente", () => {
    const b = lobby(["a", "b", "c"]);
    envoyer(b, "a", { t: "lancerPartie" });
    b.t = T0 + 100;
    envoyer(b, "a", { t: "rejoindre" });
    envoyer(b, "b", { t: "rejoindre" }); // c est admis mais ne rejoint pas
    avancerJusque(b, () => etatBr(b).phase === "jeu", 60_000);
    expect(envoyer(b, "c", { t: "rejoindre" })).toEqual([{ a: "c", m: { t: "refus", action: "rejoindre", raison: "lobby" } }]);
    expect(j(b.s, "c").enJeu).toBe(false);
    expect(etatBr(b).total).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
describe("butin et mêlée", () => {
  it("ramasser une arme à portée : `ramasse`, retrait diffusé, `equipement` privé, arme en main ; hors de portée : refusé", () => {
    const b = jusquAuSol(["a", "b"]);
    const objets = messages(b.log.filter((x) => x.a === "a"), "butin")[0].ajoutes!;
    const arme = objets.find((o) => o.genre === "arme" && o.ref === "mitraillette") ?? objets.find((o) => o.genre === "arme" && o.ref !== "epee" && o.ref !== "rayon")!;
    const a = j(b.s, "a");
    // trop loin : refus
    a.p = [arme.p[0] + 20, arme.p[1], arme.p[2]];
    expect(envoyer(b, "a", { t: "ramasser", id: arme.id })).toEqual([{ a: "a", m: { t: "ramasse", ok: false, id: arme.id, raison: "loin" } }]);
    a.p = [arme.p[0] + 0.5, arme.p[1], arme.p[2]];
    const sorties = envoyer(b, "a", { t: "ramasser", id: arme.id });
    expect(messages(sorties, "ramasse")[0]).toEqual({ t: "ramasse", ok: true, id: arme.id });
    const retrait = sorties.find((x) => x.m.t === "butin")!;
    expect(retrait.a).toBe("tous");
    expect((retrait.m as { retires?: number[] }).retires).toEqual([arme.id]);
    const equip = messages(sorties, "equipement")[0];
    expect(equip.equip.principale === arme.ref || equip.equip.secondaire === arme.ref || equip.equip.speciale === arme.ref).toBe(true);
    expect(equip.main).not.toBe("couteau");
    // l'objet n'existe plus : un second ramassage est « inconnu » (b ne le ramasse pas non plus)
    const b2 = envoyer(b, "b", { t: "ramasser", id: arme.id });
    expect(messages(b2, "ramasse")[0]).toMatchObject({ ok: false, raison: "inconnu" });
  });

  it("tir à l'arme ramassée : validé par le serveur, kill à l'arme à feu (`killsParArme`) et +50 PV", () => {
    const b = jusquAuSol(["a", "b", "c"]);
    const objets = messages(b.log.filter((x) => x.a === "a"), "butin")[0].ajoutes!;
    // une arme principale ou secondaire à un seul plomb, hors sniper (dispersé sans lunette)
    const arme = objets.find((o) => o.genre === "arme" && o.ref !== null && o.ref in STATS && o.ref !== "sniper"
      && ["principale", "secondaire"].includes(STATS[o.ref as ArmeFeuId].categorie) && STATS[o.ref as ArmeFeuId].plombs === 1)!;
    const ref = arme.ref as ArmeFeuId;
    j(b.s, "a").p = [arme.p[0] + 0.3, arme.p[1], arme.p[2]];
    envoyer(b, "a", { t: "ramasser", id: arme.id });
    expect(j(b.s, "a").arme).toBe(ref);
    expect(j(b.s, "a").main).not.toBe("couteau");
    avancer(b, 1_500); // dégainage
    rapprocher(b, "a", "b", 3);
    j(b.s, "a").pv = 70;
    j(b.s, "b").pv = 1;
    const x = j(b.s, "a"), y = j(b.s, "b");
    const o: Vec3 = [x.p[0], x.p[1] + SILHOUETTE.oeil, x.p[2]];
    const v = [y.p[0] - o[0], y.p[1] + SILHOUETTE.centreY - o[1], y.p[2] - o[2]];
    const l = Math.hypot(v[0], v[1], v[2]);
    const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
    x.lacet = Math.atan2(-d[0], -d[2]);
    x.tangage = Math.asin(d[1]);
    const sorties = envoyer(b, "a", { t: "tir", arme: ref, o, d: [d], touches: [{ cible: "b", zone: "corps", plomb: 0 }] });
    expect(messages(sorties, "mort")[0]).toMatchObject({ cible: "b", par: "a", cause: "arme", arme: ref, delai: 0 });
    expect(x.killsParArme[ref]).toBe(1);
    expect(x.pv).toBe(100); // 70 + 50 plafonnés
    expect(sorties.filter((m) => m.m.t === "soin")).toEqual([{ a: "a", m: { t: "soin", pv: 100, bouclier: 0, motif: "kill" } }]);
  });

  it("bandage : 3 s d'usage puis +20 PV (`soin`) ; interrompu par un coup reçu", () => {
    const b = jusquAuSol(["a", "b", "c"]);
    const objets = messages(b.log.filter((x) => x.a === "a"), "butin")[0].ajoutes!;
    const bandages = objets.filter((o) => o.genre === "bandage").slice(0, 2);
    expect(bandages).toHaveLength(2);
    for (const o of bandages) {
      j(b.s, "a").p = [o.p[0] + 0.3, o.p[1], o.p[2]];
      expect(messages(envoyer(b, "a", { t: "ramasser", id: o.id }), "ramasse")[0].ok).toBe(true);
    }
    expect(messages(b.log, "inventaire").at(-1)).toMatchObject({ bandage: 2, usage: null });
    rapprocher(b, "a", "b", 9);
    const a = j(b.s, "a");
    // sain : rien à soigner au-dessus de 75 PV
    expect(envoyer(b, "a", { t: "utiliser", objet: "bandage" })).toEqual([]);
    a.pv = 50;
    const debut = envoyer(b, "a", { t: "utiliser", objet: "bandage" });
    expect(messages(debut, "inventaire")[0].usage).toMatchObject({ objet: "bandage", finT: b.t + BR.usage.bandage.ms });
    // un seul usage à la fois
    expect(envoyer(b, "a", { t: "utiliser", objet: "bandage" })).toEqual([]);
    const fin = avancer(b, BR.usage.bandage.ms + 200);
    expect(pour(fin, "a", "soin")).toEqual([{ t: "soin", pv: 70, bouclier: 0, motif: "bandage" }]);
    expect(a.pv).toBe(70);
    expect(messages(fin, "inventaire").at(-1)).toMatchObject({ bandage: 1, usage: null });
    // deuxième bandage interrompu par un coup de b au bout d'une seconde
    envoyer(b, "a", { t: "utiliser", objet: "bandage" });
    avancer(b, 1_000);
    j(b.s, "b").sortieJusqua = b.t;
    const coup = frapper(b, "b", "a");
    expect(messages(coup, "degats")).toHaveLength(1);
    // l'interruption est annoncée au tic suivant (message privé `inventaire`)
    const apres = avancer(b, BR.usage.bandage.ms + 200);
    expect(pour(apres, "a", "inventaire")[0]).toMatchObject({ bandage: 1, usage: null });
    expect(pour(apres, "a", "soin")).toEqual([]);
    expect(a.pv).toBe(70 - 34);
  });

  it("kill de mêlée en trois coups, +50 PV plafonnés à 100, mort définitive sans réapparition ni `terminer`, victoire unique, retour au lobby", () => {
    const stats = persistance();
    const b = jusquAuSol(["a", "b", "c"], { stats });
    const s = b.s;
    expect(etatBr(b)).toMatchObject({ phase: "jeu", vivants: 3, total: 3 });
    // b ramasse une arme (elle tombera à sa mort)
    const objets = messages(b.log.filter((x) => x.a === "b"), "butin")[0].ajoutes!;
    const arme = objets.find((o) => o.genre === "arme" && o.ref !== "epee" && o.ref !== "rayon")!;
    j(s, "b").p = [arme.p[0] + 0.3, arme.p[1], arme.p[2]];
    envoyer(b, "b", { t: "ramasser", id: arme.id });
    expect(messages(b.log, "ramasse").some((m) => m.ok && m.id === arme.id)).toBe(true);

    // a (30 PV) contre b, à 1,2 m, au couteau
    rapprocher(b, "a", "b");
    j(s, "a").pv = 30;
    j(s, "a").sortieJusqua = b.t;
    const premier = frapper(b, "a", "b");
    expect(messages(premier, "degats")[0]).toMatchObject({ cible: "b", par: "a", degats: 34, pv: 66 });
    expect(j(s, "b").vivant).toBe(true);
    avancer(b, 700);
    const deuxieme = frapper(b, "a", "b");
    expect(messages(deuxieme, "degats")[0]).toMatchObject({ degats: 34, pv: 32 });
    expect(types(deuxieme)).not.toContain("mort");
    avancer(b, 700);
    const troisieme = frapper(b, "a", "b");
    const mort = messages(troisieme, "mort")[0];
    expect(mort).toMatchObject({ cible: "b", par: "a", cause: "arme", arme: "couteau", delai: 0 });
    expect(mort.tueur).toMatchObject({ id: "a", pseudo: "Alice" });
    // +50 PV au tueur (30 -> 80), message privé
    expect(j(s, "a").pv).toBe(80);
    const soin = troisieme.filter((x) => x.m.t === "soin");
    expect(soin).toEqual([{ a: "a", m: { t: "soin", pv: 80, bouclier: 0, motif: "kill" } }]);
    expect(j(s, "a")).toMatchObject({ kills: 1, serie: 1 });
    // mort définitive : l'arme de b tombe (butin diffusé), il reste dans la salle, mort
    const lache = troisieme.find((x) => x.m.t === "butin" && (x.m as { ajoutes?: ObjetBr[] }).ajoutes?.some((o) => o.ref === arme.ref));
    expect(lache?.a).toBe("tous");
    expect(j(s, "b")).toMatchObject({ enJeu: true, vivant: false, posture: "mort", morts: 1, reapparitionT: null });
    expect(etatBr(b)).toMatchObject({ phase: "jeu", vivants: 2 });

    // ni réapparition ni fin de match : 30 s plus tard b est toujours mort, aucune apparition, aucun `match`, aucun `terminer`
    const apres = avancer(b, 30_000);
    expect(types(apres)).not.toContain("apparition");
    expect(types(apres)).not.toContain("match");
    expect(j(s, "b")).toMatchObject({ enJeu: true, vivant: false, reapparitionT: null });
    // le client de b perd son entrée dans le snap (5 s après sa mort) mais reste dans `presence`
    expect(dernierSnap(apres)!.some((x) => x.id === "b")).toBe(false);
    expect(dernierSnap(apres)!.map((x) => x.id).sort()).toEqual(["a", "c"]);
    expect(s.joueurs().find((x) => x.id === "b")!.enJeu).toBe(true);
    // un mort ne frappe plus
    expect(envoyer(b, "b", { t: "coup", o: [0, 0, 0], d: [1, 0, 0], cibles: ["a"] })).toEqual([]);

    // a (60 PV) contre c : +50 plafonnés à 100, victoire
    rapprocher(b, "a", "c", 7);
    j(s, "a").pv = 60;
    const kc: Sortie[] = [];
    for (let k = 0; k < 3; k++) {
      kc.push(...frapper(b, "a", "c"));
      if (k < 2) avancer(b, 700);
    }
    expect(messages(kc, "mort")[0]).toMatchObject({ cible: "c", par: "a" });
    expect(j(s, "a").pv).toBe(100);
    expect(kc.filter((x) => x.m.t === "soin")).toEqual([{ a: "a", m: { t: "soin", pv: 100, bouclier: 0, motif: "kill" } }]);
    expect(j(s, "a")).toMatchObject({ kills: 2, serie: 2, serieMax: 2 });

    // la victoire se constate au tic suivant : `br{etat}` immédiat avec le bilan, un seul vainqueur, `statsBr` à chacun
    const fin = avancer(b, 100);
    expect(etatBr(b).phase).toBe("fin");
    const etat = messages(fin, "br").find((m) => m.etat.phase === "fin")!.etat;
    expect(etat.bilan!.vainqueurs).toEqual(["a"]);
    expect(etat.bilan!.lignes.map((l) => [l.id, l.place, l.kills])).toEqual([["a", 1, 2], ["c", 2, 0], ["b", 3, 0]]);
    expect(etat.nonComptee).toBeUndefined();
    expect(etat.vivants).toBe(1);
    for (const id of ["a", "b", "c"]) expect(pour(fin, id, "statsBr")).toHaveLength(1);
    expect(types(fin)).not.toContain("match");
    expect(messages(fin, "statsBr").find((m) => m.moi?.pseudo === "Alice")!.moi).toMatchObject({ top1: 1, parties: 1, kills: 2, meilleurePlace: 1 });
    expect(stats.parties).toHaveLength(1);
    expect(stats.courant().joueurs["alice"].top1).toBe(1);
    expect(stats.courant().joueurs["bob"].top1).toBe(0);
    expect(stats.courant().joueurs["cora"]).toMatchObject({ parties: 1, meilleurePlace: 2 });
    // plus de victoire ni de nouveau bilan pendant l'affichage de la fin
    expect(messages(avancer(b, 2_000), "statsBr")).toHaveLength(0);

    // retour au lobby au bout de `finAffichageMs` : tous sortent de l'arène, une présence, état lobby
    const retour = avancer(b, 3_000);
    expect(etatBr(b).phase).toBe("lobby");
    expect(b.s.nombreEnJeu()).toBe(0);
    expect(messages(retour, "presence").at(-1)!.joueurs.every((x) => !x.enJeu)).toBe(true);
    expect(dernierEtat(retour)).toMatchObject({ phase: "lobby", hote: "a", vivants: 0, total: 0 });
    expect(dernierEtat(retour)!.bilan).toBeUndefined();
    // une nouvelle partie repart de zéro : compteurs remis à zéro, 3 admis (le retardataire éventuel inclus)
    const relance = envoyer(b, "a", { t: "lancerPartie" });
    expect(dernierEtat(relance)).toMatchObject({ phase: "decompte", total: 3 });
    expect(j(s, "a")).toMatchObject({ kills: 0, morts: 0, serie: 0, serieMax: 0, killsParArme: {} });
    expect(j(s, "b").morts).toBe(0);
  });

  it("un kill croisé au même tic compte pour les deux, sans soin pour celui qui était déjà mort ; le troisième gagne", () => {
    const b = jusquAuSol(["a", "b", "c"]);
    const s = b.s;
    const x = j(s, "a"), y = j(s, "b");
    x.pv = 20; y.pv = 20;
    b.t += 100;
    // a tue b, puis b (déjà mort, dans le même tic) tue a : les deux kills comptent
    const sorties = [
      ...s.infliger(y, 500, x, "arme", "corps", "couteau", b.t),
      ...s.infliger(x, 500, y, "arme", "corps", "couteau", b.t),
    ];
    b.log.push(...sorties);
    expect(messages(sorties, "mort").map((m) => [m.cible, m.par])).toEqual([["b", "a"], ["a", "b"]]);
    expect(x.kills).toBe(1);
    expect(y.kills).toBe(1);
    // a vivant au moment de son kill : +50 PV (20 -> 70) ; b déjà mort au sien : aucun soin
    expect(sorties.filter((m) => m.m.t === "soin").map((m) => m.a)).toEqual(["a"]);
    const fin = avancer(b, 100);
    expect(etatBr(b).phase).toBe("fin");
    const bilan = messages(fin, "br").find((m) => m.etat.bilan)!.etat.bilan!;
    expect(bilan.vainqueurs).toEqual(["c"]);
    expect(bilan.lignes.find((l) => l.id === "a")!.kills).toBe(1);
    expect(bilan.lignes.find((l) => l.id === "b")!.kills).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("tempête, victoire, partie non comptée", () => {
  it("la tempête tue hors zone (cause `tempete`, `degats` sans auteur), sans kill ni +50 PV ; le dernier debout est TOP 1 et la partie compte", () => {
    const stats = persistance();
    const b = jusquAuSol(["a", "b"], { stats, altitude: 100, echelleZone: 0.1, partieValideMinMs: 1_000 });
    const sorties = avancerJusque(b, () => etatBr(b).phase === "fin", 150_000);
    const morts = messages(sorties, "mort");
    expect(morts).toHaveLength(1);
    expect(morts[0]).toMatchObject({ par: "", cause: "tempete", arme: "couteau", delai: 0 });
    expect(morts[0].tueur).toBeUndefined();
    const degats = messages(sorties, "degats");
    expect(degats.length).toBeGreaterThan(0);
    expect(degats.every((d) => d.par === "")).toBe(true);
    expect(j(b.s, "a").kills + j(b.s, "b").kills).toBe(0);
    const vainqueur = etatBr(b).bilan!.vainqueurs;
    expect(vainqueur).toHaveLength(1);
    expect(vainqueur[0]).not.toBe(morts[0].cible);
    expect(types(sorties)).not.toContain("soin");
    expect(types(sorties)).not.toContain("match");
    // un seul TOP 1 persisté
    const tops = Object.values(stats.courant().joueurs).map((l) => l.top1);
    expect(tops.sort()).toEqual([0, 1]);
    expect(stats.parties).toHaveLength(1);
    expect(etatBr(b).nonComptee).toBeUndefined();
  });

  it("zéro survivant (deux morts au même tic) : jamais deux TOP 1, le plus proche du centre de la zone gagne", () => {
    const stats = persistance();
    const b = jusquAuSol(["a", "b"], { stats });
    const zone = etatBr(b).zone!;
    // a est près du centre du cercle, b loin : les deux meurent dans le même tic
    j(b.s, "a").p = [zone.c0[0] + 10, 0, zone.c0[1]];
    j(b.s, "b").p = [zone.c0[0] + 200, 0, zone.c0[1]];
    const s = b.s;
    b.t += 100;
    const sorties = [
      ...s.infliger(j(s, "a"), 500, null, "tempete", "corps", "couteau", b.t),
      ...s.infliger(j(s, "b"), 500, null, "tempete", "corps", "couteau", b.t),
      ...s.tic(b.t),
    ];
    b.log.push(...sorties);
    expect(messages(sorties, "mort")).toHaveLength(2);
    const bilan = etatBr(b).bilan!;
    expect(etatBr(b).phase).toBe("fin");
    expect(bilan.vainqueurs).toEqual(["a"]);
    expect(bilan.lignes.map((l) => [l.id, l.place])).toEqual([["a", 1], ["b", 2]]);
    expect(Object.values(stats.courant().joueurs).filter((l) => l.top1 > 0)).toHaveLength(1);
  });

  it("abandon (déconnexion) du dernier adversaire : mort `abandon` sans +50 PV, victoire du survivant", () => {
    const b = jusquAuSol(["a", "b"]);
    j(b.s, "a").pv = 40;
    const sorties = b.s.deconnecter("b", b.t);
    b.log.push(...sorties);
    expect(messages(sorties, "mort")).toEqual([
      expect.objectContaining({ t: "mort", cible: "b", par: "", cause: "abandon", delai: 0 }),
    ]);
    expect(j(b.s, "a").pv).toBe(40);
    expect(types(sorties)).not.toContain("soin");
    expect(etatBr(b).phase).toBe("fin");
    expect(etatBr(b).bilan!.vainqueurs).toEqual(["a"]);
  });

  it("partie non comptée : abandon en plein vol (aucun atterri) ; le bilan s'affiche mais les statistiques ne bougent pas", () => {
    const stats = persistance();
    const b = jusquAuVol(["a", "b"], { stats, partieValideMinMs: BR.partieValideMinMs });
    avancer(b, 1_000);
    const sorties = b.s.deconnecter("b", b.t);
    b.log.push(...sorties);
    expect(etatBr(b)).toMatchObject({ phase: "fin", nonComptee: true });
    expect(etatBr(b).bilan!.vainqueurs).toEqual(["a"]);
    expect(stats.parties).toHaveLength(0);
    expect(stats.courant().joueurs).toEqual({});
  });

  it("salle vidée en cours de partie : retour synchrone au lobby dans `deconnecter`, sans statistiques", () => {
    const stats = persistance();
    const b = jusquAuVol(["a", "b"], { stats });
    b.s.deconnecter("a", b.t);
    const dernier = b.s.deconnecter("b", b.t + 10);
    expect(b.s.nombreJoueurs()).toBe(0);
    expect(b.s.resumeBr()).toEqual({ phase: "lobby", joueurs: 0, vivants: 0 });
    expect(etatBr(b)).toMatchObject({ phase: "lobby", vivants: 0, total: 0 });
    expect(types(dernier)).not.toContain("statsBr");
    expect(stats.parties).toHaveLength(0);
  });

  it("inactivité : un joueur au sol sans `etat` depuis 20 s est retiré de l'arène et éliminé (`abandon`), la partie continue", () => {
    const b = jusquAuSol(["a", "b", "c"], { echelleZone: 1 });
    const sorties = avancer(b, BR.inactifMs + 2_000, { actifs: ["b", "c"] });
    const morts = messages(sorties, "mort");
    expect(morts).toHaveLength(1);
    expect(morts[0]).toMatchObject({ cible: "a", cause: "abandon", par: "" });
    expect(j(b.s, "a").enJeu).toBe(false);
    expect(etatBr(b)).toMatchObject({ phase: "jeu", vivants: 2, total: 3 });
    expect(messages(sorties, "presence")).toHaveLength(1);
  });

  it("aucune réapparition, aucun bus, aucune voix : messages d'arène absents de toute la partie", () => {
    const b = jusquAuSol(["a", "b"], { echelleZone: 1 });
    avancer(b, 20_000);
    const interdits = ["match", "elsa", "busC3", "avion", "tigre", "sort", "frappe", "fumigene", "explosion", "sieges", "zombies", "monstres"];
    for (const t of new Set(types(b.log))) expect(interdits).not.toContain(t);
    expect(envoyer(b, "a", { t: "voixActif", actif: true })).toEqual([]);
  });
});
