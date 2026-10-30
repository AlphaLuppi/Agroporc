import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { construireMondeBr, pointsButin } from "./br-carte";
import { BR } from "./br-regles";
import { Salle, type JoueurSalle, type OptionsSalle, type Sortie } from "./match";
import type { OptionsServiceBr } from "./match-br";
import type { ServiceBr, ServicePolice } from "./match-contexte";
import { cheminPourPolice } from "./match-police";
import { POLICE } from "./police";
import type { EtatPartieBr, MessageClient, MessageServeur } from "./protocole";

/**
 * Descente de police du Battle Royale sur une vraie `Salle` BR et le vrai monde : réglage de l'hôte, jamais en vol, une seule descente quand la partie a moins de
 * 20 joueurs, mort sans kill ni tueur, arrêt à la fin de partie. Les conditions de temps et de zone sont aussi testées sur `reglesBr` (police-regles.test.ts).
 */
const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMondeBr(scene);
const ROUTES: [number, number][] = pointsButin(scene, monde).filter((p) => p.pool === "route").map((p) => [p.p[0], p.p[2]]);
const T0 = 7_000_000;

function suite(graine = 3): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

interface Banc { s: Salle; t: number; log: Sortie[] }
type Plus = Partial<Omit<OptionsServiceBr, "alea" | "scene">>;

function banc(plus: Plus = {}, options: OptionsSalle = {}, police = true): Banc {
  const depart: [number, number] = [(monde.bornes.x0 + monde.bornes.x1) / 2, (monde.bornes.z0 + monde.bornes.z1) / 2];
  const s = new Salle(monde, [depart], suite(3), T0, {
    br: { scene, dureeVolMs: 10_000, nbObjets: 100, echelleZone: 1, partieValideMinMs: 1_000, finAffichageMs: 5_000, ...plus },
    ...(police ? { police: { points: ROUTES, chemin: cheminPourPolice(monde) } } : {}),
    ...options,
  });
  return { s, t: T0, log: [] };
}
const j = (b: Banc, id: string) => b.s.inspecter(id) as JoueurSalle;
const service = (b: Banc): ServiceBr => (b.s as unknown as { br: ServiceBr }).br;
const policeSvc = (b: Banc): ServicePolice | null => (b.s as unknown as { police: ServicePolice | null }).police;
const etat = (b: Banc): EtatPartieBr => service(b).etat();
const phase = (b: Banc) => etat(b).phase;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
const envoyer = (b: Banc, id: string, m: MessageClient): Sortie[] => { const o = b.s.recevoir(id, m, b.t); b.log.push(...o); return o; };
function avancer(b: Banc, ms: number, parPas?: (t: number) => void): Sortie[] {
  const out: Sortie[] = [];
  const fin = b.t + ms;
  while (b.t < fin) {
    b.t = Math.min(fin, b.t + 50);
    for (const x of b.s.joueurs()) if (!x.bot && x.enJeu) x.etatT = b.t;
    parPas?.(b.t);
    out.push(...b.s.tic(b.t));
  }
  b.log.push(...out);
  return out;
}
function avancerJusque(b: Banc, fait: () => boolean, maxMs: number, parPas?: (t: number) => void): Sortie[] {
  const out: Sortie[] = [];
  const limite = b.t + maxMs;
  while (!fait()) {
    if (b.t >= limite) throw new Error(`condition non atteinte en ${maxMs} ms (phase ${phase(b)})`);
    out.push(...avancer(b, 50, parPas));
  }
  return out;
}

/** Deux humains (aucun bot), partie lancée, avion en vol. */
function enVol(police: boolean | undefined, plus: Plus = {}): Banc {
  const b = banc(plus);
  b.s.connecter("j1", "Alice", b.t);
  b.s.connecter("j2", "Bob", b.t);
  b.s.definirCapacites("j1", ["police"]);
  b.s.definirCapacites("j2", ["police"]);
  envoyer(b, "j1", { t: "lancerPartie", bots: 0, ...(police === undefined ? {} : { police }) });
  b.t += 100;
  envoyer(b, "j1", { t: "rejoindre" });
  envoyer(b, "j2", { t: "rejoindre" });
  avancerJusque(b, () => phase(b) === "vol", 40_000);
  return b;
}
/** Tous sautent, atterrissent ; la partie est en jeu ; chaque humain est posé sur une route à 250 m au moins de l'autre (chemin dégagé pour la voiture). */
function enJeu(police: boolean | undefined, plus: Plus = {}): { b: Banc; poser: (t: number) => void; sortiesVol: Sortie[] } {
  const b = enVol(police, plus);
  const debutVol = b.t;
  const sortiesVol: Sortie[] = [];
  const p1 = ROUTES[0];
  const p2 = ROUTES.find((p) => Math.hypot(p[0] - p1[0], p[1] - p1[1]) > 300)!;
  const poser = (t: number) => {
    for (const [id, p] of [["j1", p1], ["j2", p2]] as const) {
      const x = j(b, id);
      if (x.posture === "sol" && phase(b) === "jeu") { x.p = [p[0], 0, p[1]]; x.v = [0, 0, 0]; x.protegeJusqua = 0; x.etatT = t; }
    }
  };
  for (const id of ["j1", "j2"]) envoyer(b, id, { t: "sauter" });
  sortiesVol.push(...avancerJusque(b, () => phase(b) === "jeu" && j(b, "j1").posture === "sol" && j(b, "j2").posture === "sol", 120_000, (t) => {
    for (const id of ["j1", "j2"]) b.s.recevoir(id, { t: "chute", lacet: 0, tangage: -1.1, avance: 1, lateral: 0, ouvrir: t - debutVol >= 2_500 }, t);
  }));
  poser(b.t);
  return { b, poser, sortiesVol };
}
const NB = (sorties: Sortie[]) => messages(sorties, "police").length;

describe("réglage de l'hôte", () => {
  it("l'état de la partie annonce le réglage (activé par défaut) ; une valeur qui n'est pas un booléen vaut « activée »", () => {
    const b = banc();
    b.s.connecter("j1", "Alice", b.t);
    // dans le lobby le choix de l'hôte est inconnu du serveur : rien n'est publié (sinon un non-hôte lirait « activée » pour une case décochée)
    expect(etat(b).police).toBeUndefined();
    b.s.connecter("j2", "Bob", b.t);
    envoyer(b, "j1", { t: "lancerPartie", bots: 0, police: false });
    expect(etat(b).police).toBe(false);
    const c = banc();
    c.s.connecter("j1", "Alice", c.t);
    c.s.connecter("j2", "Bob", c.t);
    envoyer(c, "j1", { t: "lancerPartie", bots: 0, police: "non" as unknown as boolean });
    expect(etat(c).police).toBe(true);
  });

  it("police désactivée : aucune descente, ni armée ni en vol, même avec un délai d'essai de 1 s", () => {
    const { b, poser } = enJeu(false, { policeMs: 1_000 });
    const sorties = avancer(b, 90_000, poser);
    expect(NB(sorties)).toBe(0);
    expect(policeSvc(b)!.descentes()).toBe(0);
  });
});

describe("descente de police en jeu", () => {
  it("jamais en vol ; elle part en jeu, 3 s (essai) après le premier atterrissage, sur l'humain le plus proche, et écrase sans kill ni tueur", () => {
    const { b, poser, sortiesVol } = enJeu(true, { policeMs: 3_000 });
    expect(NB(sortiesVol)).toBe(0);
    expect(phase(b)).toBe("jeu");
    const apres = avancerJusque(b, () => messages(b.log, "mort").some((m) => m.cause === "police"), 70_000, poser);
    const debut = messages(b.log, "police").find((m) => m.phase === "debut")!;
    expect(debut).toBeTruthy();
    expect(["j1", "j2"]).toContain(debut.cible);
    const snaps = messages(b.log, "snap").filter((m) => m.monstres?.police);
    expect(snaps.length).toBeGreaterThan(5);
    const mort = messages(apres, "mort").find((m) => m.cause === "police")!;
    expect(mort.par).toBe("");
    expect(mort.tueur).toBeUndefined();
    expect(["j1", "j2"]).toContain(mort.cible);
    // aucun kill crédité à personne, aucun +50 PV
    expect(j(b, "j1").kills + j(b, "j2").kills).toBe(0);
    expect(messages(apres, "soin")).toEqual([]);
    expect(messages(b.log, "police").filter((m) => m.phase === "debut")).toHaveLength(1);
  });

  it("la mort de la cible termine le duel : la voiture s'arrête avec la partie (`police{fin}`) et ne roule pas sur l'écran de fin", () => {
    const { b, poser } = enJeu(true, { policeMs: 3_000 });
    avancerJusque(b, () => phase(b) === "fin", 90_000, poser);
    const fin = messages(b.log, "police").filter((m) => m.phase === "fin");
    expect(fin.length).toBeGreaterThanOrEqual(1);
    expect(policeSvc(b)!.enCours()).toBe(false);
    const apres = avancer(b, 1_000, poser);
    expect(messages(apres, "snap").filter((m) => m.monstres?.police)).toEqual([]);
    // une seule descente : la partie comptait 2 joueurs (< 20), aucune seconde n'est armée
    expect(messages(b.log, "police").filter((m) => m.phase === "debut")).toHaveLength(1);
  });

  it("retour au lobby : la voiture et ses compteurs sont remis à blanc, le réglage de l'hôte aussi", () => {
    const { b, poser } = enJeu(true, { policeMs: 3_000 });
    avancerJusque(b, () => phase(b) === "fin", 90_000, poser);
    avancerJusque(b, () => phase(b) === "lobby", 20_000);
    expect(policeSvc(b)!.enCours()).toBe(false);
    expect(policeSvc(b)!.descentes()).toBe(0);
    expect(etat(b).police).toBeUndefined();
  });

  it("sans routes de police (option absente), la partie se joue sans voiture", () => {
    const b = banc({ policeMs: 1_000 }, {}, false);
    expect(policeSvc(b)).toBeNull();
  });
});

describe("joueurs hors d'atteinte : la descente ne démarre pas et garde son quota", () => {
  /** place les deux humains où l'on veut (tant qu'ils sont au sol et la partie en jeu), à chaque pas */
  function placer(b: Banc, pos: { j1: [number, number, number]; j2: [number, number, number] }): (t: number) => void {
    return (t) => {
      for (const id of ["j1", "j2"] as const) {
        const x = j(b, id);
        if (x.posture === "sol" && phase(b) === "jeu") { x.p = [...pos[id]]; x.v = [0, 0, 0]; x.protegeJusqua = 0; x.etatT = t; }
      }
    };
  }

  it("deux joueurs à l'intérieur de bâtiments creux (aucun chemin pour la voiture) : pas de sirène, pas de quota consommé ; dès que l'un rejoint la route, elle part", () => {
    const { b } = enJeu(true, { policeMs: 3_000 });
    const pos = { j1: [-273, 0, 33] as [number, number, number], j2: [-270, 0, 33] as [number, number, number] };
    const poser = placer(b, pos);
    avancer(b, 90_000, poser);
    expect(messages(b.log, "police").filter((m) => m.phase === "debut")).toEqual([]);
    expect(policeSvc(b)!.enCours()).toBe(false);
    expect(policeSvc(b)!.descentes()).toBe(0);
    pos.j1 = [ROUTES[0][0], 0, ROUTES[0][1]];
    avancerJusque(b, () => messages(b.log, "police").some((m) => m.phase === "debut"), 40_000, poser);
    expect(policeSvc(b)!.descentes()).toBe(1);
  });

  it("deux joueurs sur des toits : jamais visés, pas de descente gaspillée ; l'un redescend, elle part sur lui", () => {
    const { b } = enJeu(true, { policeMs: 3_000 });
    const pos = { j1: [-250, 6.7, 90] as [number, number, number], j2: [-255, 6.7, 95] as [number, number, number] };
    const poser = placer(b, pos);
    avancer(b, 60_000, poser);
    expect(messages(b.log, "police").filter((m) => m.phase === "debut")).toEqual([]);
    expect(policeSvc(b)!.descentes()).toBe(0);
    pos.j2 = [ROUTES[0][0], 0, ROUTES[0][1]];
    avancerJusque(b, () => messages(b.log, "police").some((m) => m.phase === "debut"), 40_000, poser);
    expect(messages(b.log, "police").find((m) => m.phase === "debut")!.cible).toBe("j2");
  });
});

describe("aidePolice : ce que la police voit du service BR", () => {
  it("phase, premier atterrissage d'un humain (les bots ne comptent pas), joueurs au départ", () => {
    const b = banc();
    b.s.connecter("j1", "Alice", b.t);
    b.s.connecter("j2", "Bob", b.t);
    const aide = service(b).aidePolice();
    expect(aide.phase()).toBe("lobby");
    expect(aide.premierAtterrissageT()).toBeNull();
    expect(aide.nbJoueursDepart()).toBe(0);
    envoyer(b, "j1", { t: "lancerPartie", bots: 0 });
    b.t += 100;
    envoyer(b, "j1", { t: "rejoindre" });
    envoyer(b, "j2", { t: "rejoindre" });
    avancerJusque(b, () => phase(b) === "vol", 40_000);
    expect(aide.nbJoueursDepart()).toBe(2);
    expect(aide.enVol("j1")).toBe(true);
    expect(aide.premierAtterrissageT()).toBeNull();
    envoyer(b, "j1", { t: "sauter" });
    const saut = b.t;
    avancerJusque(b, () => aide.premierAtterrissageT() !== null, 120_000, (t) => {
      for (const id of ["j1", "j2"]) b.s.recevoir(id, { t: "chute", lacet: 0, tangage: -1.1, avance: 1, lateral: 0, ouvrir: t - saut >= 2_500 }, t);
    });
    // le premier à toucher le sol (ici Bob, éjecté de force à la fin du vol : Alice est encore en l'air) n'est plus « en vol »
    const [au, enAir] = j(b, "j2").posture === "sol" ? ["j2", "j1"] : ["j1", "j2"];
    expect(aide.enVol(au)).toBe(false);
    expect(aide.enVol(enAir)).toBe(true);
    expect(aide.premierAtterrissageT()).toBeGreaterThan(saut);
    expect(aide.zone(b.t)).toMatchObject({ rayon: expect.any(Number) });
    expect(aide.vivants()).toBe(2);
  });
});

describe("seconde descente : seulement à 20 joueurs ou plus au départ, jamais une troisième", () => {
  it("`POLICE.br` : une seconde descente est réservée aux grandes parties (20 joueurs), 3 à 5 min après la fin de la première, maximum 2", () => {
    expect(POLICE.br.secondeJoueursMin).toBe(20);
    expect(POLICE.br.secondeMinMs).toBe(180_000);
    expect(POLICE.br.secondeMaxMs).toBe(300_000);
    expect(POLICE.br.max).toBe(2);
    expect(BR.joueursMax).toBeGreaterThanOrEqual(POLICE.br.secondeJoueursMin);
  });

  it("à 20 joueurs au départ, la seconde descente est armée après la fin de la première, une seule fois", () => {
    const armes: (number | null)[] = [];
    let descentes = 0, enCours = false;
    const faussePolice = {
      armer: (t: number | null) => { armes.push(t); },
      descentes: () => descentes, enCours: () => enCours,
      reinitialiser: () => [], tic: () => [], snap: () => undefined, synchro: () => [], toucher: () => null, blesser: () => [], liberer: () => {},
    } as unknown as ServicePolice;
    const grande = banc({ police: () => faussePolice, nbObjets: 10 }, {}, false);
    for (let k = 0; k < 20; k++) grande.s.connecter(`g${k}`, `Joueur${String.fromCharCode(65 + k)}`, grande.t);
    envoyer(grande, "g0", { t: "lancerPartie", bots: 0 });
    grande.t += 100;
    for (let k = 0; k < 20; k++) envoyer(grande, `g${k}`, { t: "rejoindre" });
    avancerJusque(grande, () => phase(grande) === "jeu", 60_000);
    expect(armes).toHaveLength(1);
    expect(armes[0]).toBeGreaterThan(grande.t - 1);
    // la première descente a eu lieu et est finie : la seconde est armée 3 à 5 min plus tard
    descentes = 1; enCours = true;
    avancer(grande, 1_000);
    expect(armes).toHaveLength(1);
    enCours = false;
    avancer(grande, 1_000);
    expect(armes).toHaveLength(2);
    expect(armes[1]! - grande.t).toBeGreaterThanOrEqual(POLICE.br.secondeMinMs - 2_000);
    expect(armes[1]! - grande.t).toBeLessThanOrEqual(POLICE.br.secondeMaxMs);
    // jamais une troisième : même après une deuxième descente
    descentes = 2;
    avancer(grande, 5_000);
    expect(armes).toHaveLength(2);
  });

  it("à 2 joueurs au départ, aucune seconde descente n'est armée", () => {
    const armes: (number | null)[] = [];
    const faussePolice = {
      armer: (t: number | null) => { armes.push(t); }, descentes: () => 1, enCours: () => false,
      reinitialiser: () => [], tic: () => [], snap: () => undefined, synchro: () => [], toucher: () => null, blesser: () => [], liberer: () => {},
    } as unknown as ServicePolice;
    const b = banc({ police: () => faussePolice }, {}, false);
    b.s.connecter("j1", "Alice", b.t);
    b.s.connecter("j2", "Bob", b.t);
    envoyer(b, "j1", { t: "lancerPartie", bots: 0 });
    b.t += 100;
    envoyer(b, "j1", { t: "rejoindre" });
    envoyer(b, "j2", { t: "rejoindre" });
    avancerJusque(b, () => phase(b) === "jeu", 60_000);
    avancer(b, 10_000);
    expect(armes).toHaveLength(1);
  });
});

