import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CODE_BONJOUR, CODE_FLOOD, CODE_REMPLACE, CODE_TROP_DE_CONNEXIONS, CODE_VERSION, RESEAU, TRAME_ENTREES, TRAME_SNAP, VERSION_ROCKET, type MessageClient, type MessageServeur, type SnapRocket, type SocketRocket, type TrameEntrees } from "./protocole";

/** Codec factice : le vrai (`serialisation.ts`) est un autre lot ; le client ne fait que l'appeler. Premier octet = type de trame. */
const decoder = vi.fn((octets: Uint8Array): SnapRocket | null => (octets[1] === 0xff ? null : ({ tick: octets[1], numero: octets[2] } as unknown as SnapRocket)));
vi.mock("./serialisation", () => ({
  typeDeTrame: (o: Uint8Array) => (o[0] === 1 || o[0] === 2 ? o[0] : null),
  decoderSnap: (o: Uint8Array) => decoder(o),
  encoderTrameEntrees: (t: TrameEntrees) => Uint8Array.from([TRAME_ENTREES, t.numero, t.entrees.length]),
}));

import { ATTENTES_RECONNEXION_MS, creerClientRocket, urlRocket } from "./client";

class SocketFausse implements SocketRocket {
  static toutes: SocketFausse[] = [];
  readyState = 0;
  binaryType = "blob";
  envoyes: (string | ArrayBufferLike | ArrayBufferView)[] = [];
  ferme: number | null = null;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public url: string) { SocketFausse.toutes.push(this); }
  send(d: string | ArrayBufferLike | ArrayBufferView): void { if (this.readyState !== 1) throw new Error("socket fermée"); this.envoyes.push(d); }
  close(code?: number): void { this.ferme = code ?? 1000; this.readyState = 3; }
  // ---- côté test ----
  ouvrir(): void { this.readyState = 1; this.onopen?.({}); }
  recevoir(m: MessageServeur): void { this.onmessage?.({ data: JSON.stringify(m) }); }
  recevoirBrut(data: unknown): void { this.onmessage?.({ data }); }
  couper(code = 1006): void { this.readyState = 3; this.onclose?.({ code }); }
  textes(): MessageClient[] { return this.envoyes.filter((x): x is string => typeof x === "string").map((x) => JSON.parse(x) as MessageClient); }
  binaires(): Uint8Array[] { return this.envoyes.filter((x) => typeof x !== "string").map((x) => x as Uint8Array); }
}
const derniere = (): SocketFausse => SocketFausse.toutes[SocketFausse.toutes.length - 1];

const bienvenue = (joueur = 4): MessageServeur => ({ t: "bienvenue", v: VERSION_ROCKET, joueur, maintenantMs: 0 });
function creer(over: Partial<Parameters<typeof creerClientRocket>[0]> = {}) {
  return creerClientRocket({ url: "wss://test/rocket", nom: "Léa", creerSocket: (u) => new SocketFausse(u), maintenant: () => Date.now(), ...over });
}
/** Client connecté et ayant reçu `bienvenue`. */
function connecte(over: Partial<Parameters<typeof creerClientRocket>[0]> = {}) {
  const c = creer(over);
  c.connecter();
  const s = derniere();
  s.ouvrir();
  s.recevoir(bienvenue());
  return { c, s };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); SocketFausse.toutes = []; decoder.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe("urlRocket", () => {
  const sauve = { r: process.env.NEXT_PUBLIC_ROCKET_WS_URL, f: process.env.NEXT_PUBLIC_FPS_WS_URL };
  afterEach(() => {
    for (const [k, v] of [["NEXT_PUBLIC_ROCKET_WS_URL", sauve.r], ["NEXT_PUBLIC_FPS_WS_URL", sauve.f]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    vi.unstubAllGlobals();
  });
  it("la variable dédiée l'emporte, avec le chemin /rocket ajouté une seule fois", () => {
    process.env.NEXT_PUBLIC_ROCKET_WS_URL = "wss://exemple.test/";
    process.env.NEXT_PUBLIC_FPS_WS_URL = "wss://arene.test";
    expect(urlRocket()).toBe("wss://exemple.test/rocket");
    process.env.NEXT_PUBLIC_ROCKET_WS_URL = "wss://exemple.test/rocket";
    expect(urlRocket()).toBe("wss://exemple.test/rocket");
  });
  it("sinon la base de l'arène", () => {
    delete process.env.NEXT_PUBLIC_ROCKET_WS_URL;
    process.env.NEXT_PUBLIC_FPS_WS_URL = "wss://arene.test";
    expect(urlRocket()).toBe("wss://arene.test/rocket");
  });
  it("sinon le serveur local en développement, la production ailleurs", () => {
    delete process.env.NEXT_PUBLIC_ROCKET_WS_URL;
    delete process.env.NEXT_PUBLIC_FPS_WS_URL;
    vi.stubGlobal("location", { hostname: "localhost" });
    expect(urlRocket()).toBe("ws://localhost:8787/rocket");
    vi.stubGlobal("location", { hostname: "pdj.exemple.fr" });
    expect(urlRocket()).toBe("wss://pdj-fps.toam.tech/rocket");
    vi.unstubAllGlobals();
    expect(urlRocket()).toBe("wss://pdj-fps.toam.tech/rocket");
  });
});

describe("connexion et bonjour", () => {
  it("rien ne part avant connecter() ; la socket binaire est en ArrayBuffer", () => {
    const c = creer();
    expect(SocketFausse.toutes).toHaveLength(0);
    expect(c.etat()).toBe("connexion");
    c.connecter();
    expect(SocketFausse.toutes).toHaveLength(1);
    expect(derniere().url).toBe("wss://test/rocket");
    expect(derniere().binaryType).toBe("arraybuffer");
  });
  it("le premier message est bonjour{v, nom} puis l'état passe à ouverte", () => {
    const c = creer();
    const etats: string[] = [];
    c.ecouter({ etat: (e) => etats.push(e) });
    c.connecter();
    derniere().ouvrir();
    expect(derniere().textes()[0]).toEqual({ t: "bonjour", v: VERSION_ROCKET, nom: "Léa" });
    expect(etats).toEqual(["ouverte"]);
    expect(c.etat()).toBe("ouverte");
  });
  it("une reprise fournie part dans le bonjour", () => {
    const reprise = { code: "BCDF", joueur: 3, jeton: "0123456789abcdef0123456789abcdef" };
    const c = creer({ reprise });
    c.connecter();
    derniere().ouvrir();
    expect(derniere().textes()[0]).toEqual({ t: "bonjour", v: VERSION_ROCKET, nom: "Léa", reprise });
  });
  it("un message demandé avant l'ouverture part après le bonjour", () => {
    const c = creer();
    c.connecter();
    c.envoyer({ t: "lister" });
    c.envoyer({ t: "creer", reglages: { format: "1v1", dureeS: 300, niveauBots: "pro", visible: true } });
    derniere().ouvrir();
    expect(derniere().textes().map((m) => m.t)).toEqual(["bonjour", "ping", "lister", "creer"]);
  });
  it("connecter() deux fois ne crée pas deux sockets", () => {
    const c = creer();
    c.connecter();
    c.connecter();
    expect(SocketFausse.toutes).toHaveLength(1);
  });
});

describe("ping et horloge", () => {
  it("un ping part à l'ouverture avec l'heure du client, puis toutes les 2 s au salon", () => {
    const { s } = connecte();
    const pings = () => s.textes().filter((m) => m.t === "ping");
    expect(pings()).toHaveLength(1);
    expect(pings()[0]).toMatchObject({ c: 1_000_000 });
    vi.advanceTimersByTime(RESEAU.pingSalonMs);
    expect(pings()).toHaveLength(2);
    expect(pings()[1]).toMatchObject({ c: 1_000_000 + RESEAU.pingSalonMs });
  });
  it("en match le ping passe à 500 ms, et revient à 2 s à la fin", () => {
    const { s } = connecte();
    const pings = () => s.textes().filter((m) => m.t === "ping").length;
    s.recevoir({ t: "debut", numero: 1, moi: 0, voitures: [], config: {} as never });
    const avant = pings();
    vi.advanceTimersByTime(2000);
    expect(pings() - avant).toBe(4);
    s.recevoir({ t: "fin", tick: 1, resultat: {} as never });
    const apres = pings();
    vi.advanceTimersByTime(4000);
    expect(pings() - apres).toBe(2);
  });
  it("le pong donne le RTT brut sur la même horloge que le ping", () => {
    const { c, s } = connecte();
    expect(c.rttBrutMs()).toBe(0);
    const ping = s.textes().filter((m) => m.t === "ping")[0] as Extract<MessageClient, { t: "ping" }>;
    vi.advanceTimersByTime(48);
    s.recevoir({ t: "pong", c: ping.c, tick: 120.5, ralenti: false });
    expect(c.rttBrutMs()).toBe(48);
  });
  it("le pong est aussi transmis aux écouteurs (l'horloge en tire le tick)", () => {
    const { c, s } = connecte();
    const recus: MessageServeur[] = [];
    c.ecouter({ message: (m) => recus.push(m) });
    s.recevoir({ t: "pong", c: 1, tick: -1, ralenti: false });
    expect(recus).toEqual([{ t: "pong", c: 1, tick: -1, ralenti: false }]);
  });
  it("fermer() arrête les pings", () => {
    const { c, s } = connecte();
    c.fermer();
    const n = s.textes().length;
    vi.advanceTimersByTime(10_000);
    expect(s.textes()).toHaveLength(n);
  });
});

describe("décodage", () => {
  it("les messages texte arrivent à `message` ; les textes mal formés sont ignorés", () => {
    const { c, s } = connecte();
    const recus: MessageServeur[] = [];
    c.ecouter({ message: (m) => recus.push(m) });
    s.recevoirBrut("{pas du json");
    s.recevoirBrut("[]");
    s.recevoirBrut("42");
    s.recevoirBrut(JSON.stringify({ sans: "t" }));
    s.recevoirBrut(JSON.stringify({ t: 5 }));
    s.recevoir({ t: "liste", parties: [] });
    expect(recus).toEqual([{ t: "liste", parties: [] }]);
  });
  it("une trame binaire d'instantané est décodée sans état externe et envoyée à `snap`", () => {
    const { c, s } = connecte();
    const recus: SnapRocket[] = [];
    c.ecouter({ snap: (x) => recus.push(x) });
    s.recevoirBrut(Uint8Array.from([TRAME_SNAP, 12, 3]).buffer);
    expect(recus).toHaveLength(1);
    expect(recus[0]).toMatchObject({ tick: 12, numero: 3 });
  });
  it("accepte aussi une vue typée dont le tampon est partagé (offset non nul)", () => {
    const { c, s } = connecte();
    const recus: SnapRocket[] = [];
    c.ecouter({ snap: (x) => recus.push(x) });
    const grand = Uint8Array.from([9, 9, TRAME_SNAP, 77, 1, 9]);
    s.recevoirBrut(new Uint8Array(grand.buffer, 2, 3));
    expect(recus[0]).toMatchObject({ tick: 77, numero: 1 });
  });
  it("trame binaire d'un autre type, vide ou non décodable : ignorée sans bruit", () => {
    const { c, s } = connecte();
    const recus: SnapRocket[] = [];
    c.ecouter({ snap: (x) => recus.push(x) });
    s.recevoirBrut(Uint8Array.from([TRAME_ENTREES, 1, 1]).buffer);
    s.recevoirBrut(new ArrayBuffer(0));
    s.recevoirBrut(Uint8Array.from([TRAME_SNAP, 0xff]).buffer);
    s.recevoirBrut(Uint8Array.from([77, 1]).buffer);
    s.recevoirBrut({ blob: true });
    expect(recus).toHaveLength(0);
  });
  it("un écouteur qui lève n'empêche pas les autres de recevoir", () => {
    const { c, s } = connecte();
    const vus: string[] = [];
    c.ecouter({ message: () => { throw new Error("boum"); } });
    c.ecouter({ message: (m) => vus.push(m.t) });
    s.recevoir({ t: "liste", parties: [] });
    expect(vus).toEqual(["liste"]);
  });
  it("se désabonner arrête les envois", () => {
    const { c, s } = connecte();
    const vus: string[] = [];
    const stop = c.ecouter({ message: (m) => vus.push(m.t) });
    s.recevoir({ t: "liste", parties: [] });
    stop();
    s.recevoir({ t: "liste", parties: [] });
    expect(vus).toHaveLength(1);
  });
});

describe("envois", () => {
  it("envoyerTrame encode la trame en binaire ; sans socket ouverte elle est jetée", () => {
    const { c, s } = connecte();
    c.envoyerTrame({ numero: 5, tickDebut: 0, snapRecu: 0, entrees: [] });
    expect(s.binaires()).toHaveLength(1);
    expect(Array.from(s.binaires()[0])).toEqual([TRAME_ENTREES, 5, 0]);
    const c2 = creer();
    expect(() => c2.envoyerTrame({ numero: 5, tickDebut: 0, snapRecu: 0, entrees: [] })).not.toThrow();
  });
  it("une socket qui lève à l'envoi ne fait pas planter l'appelant", () => {
    const { c, s } = connecte();
    s.send = () => { throw new Error("coupée"); };
    expect(() => c.envoyer({ t: "klaxon" })).not.toThrow();
    expect(() => c.envoyerTrame({ numero: 1, tickDebut: 0, snapRecu: 0, entrees: [] })).not.toThrow();
  });
  it("après fermer(), plus rien ne part", () => {
    const { c, s } = connecte();
    c.fermer();
    const n = s.envoyes.length;
    c.envoyer({ t: "lister" });
    expect(s.envoyes).toHaveLength(n);
    expect(s.ferme).toBe(1000);
    expect(c.etat()).toBe("fermee");
  });
});

describe("session", () => {
  const jeton = "0123456789abcdef0123456789abcdef";
  it("`session` est mémorisée, `quitter` et `salon{null}` l'oublient", () => {
    const { c, s } = connecte();
    expect(c.session()).toBeNull();
    s.recevoir({ t: "session", code: "BCDF", joueur: 4, jeton });
    expect(c.session()).toEqual({ code: "BCDF", joueur: 4, jeton });
    c.envoyer({ t: "quitter" });
    expect(c.session()).toBeNull();
    s.recevoir({ t: "session", code: "MNPQ", joueur: 4, jeton });
    s.recevoir({ t: "salon", salon: null, raison: "expire" });
    expect(c.session()).toBeNull();
  });
  it("`reprise{code: null}` fait oublier la reprise : la reconnexion suivante n'en porte plus", () => {
    const reprise = { code: "BCDF", joueur: 3, jeton };
    const c = creer({ reprise });
    c.connecter();
    derniere().ouvrir();
    derniere().recevoir(bienvenue(3));
    derniere().recevoir({ t: "reprise", code: null });
    derniere().couper();
    vi.advanceTimersByTime(ATTENTES_RECONNEXION_MS[0]);
    derniere().ouvrir();
    expect((derniere().textes()[0] as Extract<MessageClient, { t: "bonjour" }>).reprise).toBeUndefined();
  });
  it("après une coupure, la session est rejouée dans le bonjour (avec le jeton émis par le serveur)", () => {
    const { c, s } = connecte();
    s.recevoir({ t: "session", code: "BCDF", joueur: 4, jeton });
    s.couper();
    vi.advanceTimersByTime(ATTENTES_RECONNEXION_MS[0]);
    const s2 = derniere();
    expect(s2).not.toBe(s);
    s2.ouvrir();
    expect(s2.textes()[0]).toEqual({ t: "bonjour", v: VERSION_ROCKET, nom: "Léa", reprise: { code: "BCDF", joueur: 4, jeton } });
    expect(c.session()).toEqual({ code: "BCDF", joueur: 4, jeton });
  });
  it("definirReprise remplace la reprise rejouée", () => {
    const { c, s } = connecte();
    c.definirReprise({ code: "TVWX", joueur: 1, jeton });
    s.couper();
    vi.advanceTimersByTime(ATTENTES_RECONNEXION_MS[0]);
    derniere().ouvrir();
    expect((derniere().textes()[0] as Extract<MessageClient, { t: "bonjour" }>).reprise?.code).toBe("TVWX");
  });
});

describe("reconnexion", () => {
  it("coupure : état « reconnexion » puis nouvelle tentative après 0,5 s ; l'ouverture rend l'état « ouverte »", () => {
    const { c, s } = connecte();
    const etats: string[] = [];
    c.ecouter({ etat: (e) => etats.push(e) });
    s.couper();
    expect(c.etat()).toBe("reconnexion");
    expect(SocketFausse.toutes).toHaveLength(1);
    vi.advanceTimersByTime(ATTENTES_RECONNEXION_MS[0] - 1);
    expect(SocketFausse.toutes).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(SocketFausse.toutes).toHaveLength(2);
    derniere().ouvrir();
    expect(etats).toEqual(["reconnexion", "ouverte"]);
  });
  it("les attentes suivent 0,5 / 1 / 2 / 2 s tant que les tentatives échouent", () => {
    const { s } = connecte();
    s.couper();
    const instants: number[] = [];
    let t0 = Date.now();
    for (let i = 0; i < 4; i++) {
      const avant = SocketFausse.toutes.length;
      let ecoule = 0;
      while (SocketFausse.toutes.length === avant) { vi.advanceTimersByTime(50); ecoule += 50; }
      instants.push(ecoule);
      derniere().couper();
      t0 = Date.now();
    }
    expect(instants).toEqual([...ATTENTES_RECONNEXION_MS]);
    expect(t0).toBeGreaterThan(0);
  });
  it("au-delà de la fenêtre de reprise la connexion est abandonnée (« fermee »)", () => {
    const { c, s } = connecte();
    s.couper();
    for (let i = 0; i < 120 && c.etat() === "reconnexion"; i++) {
      vi.advanceTimersByTime(500);
      if (SocketFausse.toutes.length > 0 && derniere().readyState !== 3) derniere().couper();
    }
    expect(c.etat()).toBe("fermee");
    expect(c.raisonFermeture()).toBe("coupure");
    const n = SocketFausse.toutes.length;
    vi.advanceTimersByTime(30_000);
    expect(SocketFausse.toutes).toHaveLength(n);
  });
  it("une série de coupures est mesurée depuis la PREMIÈRE ; une reconnexion réussie remet le compteur à zéro", () => {
    const { c, s } = connecte();
    s.couper();
    vi.advanceTimersByTime(ATTENTES_RECONNEXION_MS[0]);
    derniere().ouvrir();
    derniere().recevoir(bienvenue());
    vi.advanceTimersByTime(RESEAU.repriseMs + 5000);
    derniere().couper();
    expect(c.etat()).toBe("reconnexion");
    vi.advanceTimersByTime(ATTENTES_RECONNEXION_MS[0]);
    expect(SocketFausse.toutes.length).toBeGreaterThanOrEqual(3);
  });
  it("fermer() pendant l'attente annule la reconnexion", () => {
    const { c, s } = connecte();
    s.couper();
    c.fermer();
    vi.advanceTimersByTime(60_000);
    expect(SocketFausse.toutes).toHaveLength(1);
    expect(c.etat()).toBe("fermee");
  });
  it("la toute première connexion qui échoue : serveur injoignable, sans reconnexion", () => {
    const c = creer();
    c.connecter();
    derniere().couper(1006);
    expect(c.etat()).toBe("fermee");
    expect(c.raisonFermeture()).toBe("injoignable");
    vi.advanceTimersByTime(60_000);
    expect(SocketFausse.toutes).toHaveLength(1);
  });
  it("création de socket qui lève (URL invalide) : injoignable, pas d'exception", () => {
    const c = creer({ creerSocket: () => { throw new Error("SyntaxError"); } });
    expect(() => c.connecter()).not.toThrow();
    expect(c.etat()).toBe("fermee");
    expect(c.raisonFermeture()).toBe("injoignable");
  });
  it("reessayer() repart de zéro après un échec", () => {
    const c = creer();
    c.connecter();
    derniere().couper(1006);
    expect(c.etat()).toBe("fermee");
    c.reessayer();
    expect(c.etat()).toBe("connexion");
    expect(SocketFausse.toutes).toHaveLength(2);
    derniere().ouvrir();
    expect(c.etat()).toBe("ouverte");
    expect(c.raisonFermeture()).toBeNull();
  });
  it("reessayer() ne fait rien sur une connexion qui vit", () => {
    const { c } = connecte();
    c.reessayer();
    expect(SocketFausse.toutes).toHaveLength(1);
  });
  it("une socket périmée (remplacée par la reconnexion) ne peut plus rien déclencher", () => {
    const { c, s } = connecte();
    s.couper();
    vi.advanceTimersByTime(ATTENTES_RECONNEXION_MS[0]);
    const vus: string[] = [];
    c.ecouter({ message: (m) => vus.push(m.t) });
    s.recevoir({ t: "liste", parties: [] });
    s.couper();
    expect(vus).toEqual([]);
    expect(SocketFausse.toutes).toHaveLength(2);
  });
});

describe("refus et fermetures définitives", () => {
  it("erreur{version} : état « refusee », message transmis, socket fermée, aucune reconnexion", () => {
    const c = creer();
    const etats: string[] = [];
    const msgs: string[] = [];
    c.ecouter({ etat: (e) => etats.push(e), message: (m) => msgs.push(m.t) });
    c.connecter();
    derniere().ouvrir();
    derniere().recevoir({ t: "erreur", code: "version", message: "rechargez la page" });
    expect(c.etat()).toBe("refusee");
    expect(c.raisonFermeture()).toBe("version");
    expect(msgs).toContain("erreur");
    expect(derniere().ferme).toBe(1000);
    vi.advanceTimersByTime(60_000);
    expect(SocketFausse.toutes).toHaveLength(1);
    expect(etats).toEqual(["ouverte", "refusee"]);
  });
  it("une fermeture avant tout « bienvenue » (ancien serveur d'arène, code 1008) est un refus de version", () => {
    const c = creer();
    c.connecter();
    derniere().ouvrir();
    derniere().couper(1008);
    expect(c.etat()).toBe("refusee");
    expect(c.raisonFermeture()).toBe("version");
    vi.advanceTimersByTime(60_000);
    expect(SocketFausse.toutes).toHaveLength(1);
  });
  it("le code 4001 est un refus de version, même après un bienvenue", () => {
    const { c, s } = connecte();
    s.couper(CODE_VERSION);
    expect(c.etat()).toBe("refusee");
  });
  it("un bonjour trop tardif (4003) reste une coupure ordinaire à reprendre", () => {
    const c = creer();
    c.connecter();
    derniere().ouvrir();
    derniere().couper(CODE_BONJOUR);
    expect(c.etat()).toBe("reconnexion");
  });
  it("serveur plein (1013) : refus « plein », sans insister", () => {
    const { c, s } = connecte();
    s.couper(CODE_TROP_DE_CONNEXIONS);
    expect(c.etat()).toBe("refusee");
    expect(c.raisonFermeture()).toBe("plein");
    vi.advanceTimersByTime(60_000);
    expect(SocketFausse.toutes).toHaveLength(1);
  });
  it("socket remplacée par une reprise ailleurs (4004) : fermée, pas de reconnexion qui volerait la place", () => {
    const { c, s } = connecte();
    s.couper(CODE_REMPLACE);
    expect(c.etat()).toBe("fermee");
    expect(c.raisonFermeture()).toBe("remplacee");
    vi.advanceTimersByTime(60_000);
    expect(SocketFausse.toutes).toHaveLength(1);
  });
  it("coupure pour flood (4002) : fermée sans reconnexion", () => {
    const { c, s } = connecte();
    s.couper(CODE_FLOOD);
    expect(c.etat()).toBe("fermee");
    vi.advanceTimersByTime(60_000);
    expect(SocketFausse.toutes).toHaveLength(1);
  });
});

describe("avec le vrai codec (serialisation.ts)", () => {
  it("un instantané réel encodé par le serveur est décodé par le client et ses entrées partent en trame binaire valide", async () => {
    vi.doUnmock("./serialisation");
    vi.resetModules();
    const { creerClientRocket: creerReel } = await import("./client");
    const reel = await import("./serialisation");
    const { creerMondeEnLigne } = await import("./monde-ligne");
    const { DEFAUT_CONFIG } = await import("../contrat");
    const config = { ...DEFAUT_CONFIG(), format: "1v1" as const };
    const voitures = [
      { id: 0, equipe: "bleue" as const, slot: 0, humain: true, nom: "Léa", joueur: 0 },
      { id: 1, equipe: "orange" as const, slot: 0, humain: true, nom: "Max", joueur: 1 },
    ];
    const monde = creerMondeEnLigne(config, voitures, 0);
    const nulles = reel.quantifierEntrees({ accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false });
    const snap: SnapRocket = { tick: 6, ralenti: false, numero: 3, nbVoitures: 2, entreesRecuesJusqua: 5, avance: 4, manquees: 0, entrees: [nulles, nulles], etat: reel.extraireEtat(monde) };
    const octets = reel.encoderSnap(snap);

    const c = creerReel({ url: "wss://test/rocket", nom: "Léa", creerSocket: (u) => new SocketFausse(u), maintenant: () => Date.now() });
    const recus: SnapRocket[] = [];
    c.ecouter({ snap: (x) => recus.push(x) });
    c.connecter();
    const s = derniere();
    s.ouvrir();
    s.recevoirBrut(octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength));
    expect(recus).toHaveLength(1);
    expect(recus[0]).toMatchObject({ tick: 6, numero: 3, nbVoitures: 2, avance: 4, manquees: 0, entreesRecuesJusqua: 5 });
    expect(recus[0].etat.voitures).toHaveLength(2);
    expect(recus[0].octetsEtat).toBeInstanceOf(Uint8Array);

    c.envoyerTrame({ numero: 3, tickDebut: 5, snapRecu: 6, entrees: [nulles, nulles] });
    const trame = s.binaires()[0];
    expect(reel.typeDeTrame(trame)).toBe(TRAME_ENTREES);
    expect(reel.decoderTrameEntrees(trame)).toMatchObject({ numero: 3, tickDebut: 5, snapRecu: 6 });
  });
  it("des octets qui ne forment pas un instantané sont ignorés sans lever", async () => {
    vi.doUnmock("./serialisation");
    vi.resetModules();
    const { creerClientRocket: creerReel } = await import("./client");
    const c = creerReel({ url: "wss://test/rocket", nom: "Léa", creerSocket: (u) => new SocketFausse(u), maintenant: () => Date.now() });
    const recus: SnapRocket[] = [];
    c.ecouter({ snap: (x) => recus.push(x) });
    c.connecter();
    derniere().ouvrir();
    expect(() => derniere().recevoirBrut(Uint8Array.from([TRAME_SNAP, 1, 2, 3]).buffer)).not.toThrow();
    expect(() => derniere().recevoirBrut(Uint8Array.from([TRAME_SNAP]).buffer)).not.toThrow();
    expect(recus).toHaveLength(0);
  });
});

describe("essais : couperSocket", () => {
  it("la socket meurt avec un code non volontaire, le client tente la reprise", () => {
    const { c, s } = connecte();
    c.couperSocket();
    expect(s.ferme).toBe(4999);
    // un vrai navigateur déclenche ensuite onclose
    s.couper(4999);
    expect(c.etat()).toBe("reconnexion");
    vi.advanceTimersByTime(ATTENTES_RECONNEXION_MS[0]);
    expect(SocketFausse.toutes).toHaveLength(2);
  });
  it("sans socket, rien ne se passe", () => {
    expect(() => creer().couperSocket()).not.toThrow();
  });
});
