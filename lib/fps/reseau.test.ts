import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EtatJoueurSnap, MessageServeur } from "./protocole";
import { KILLCAM } from "./killcam";
import { HorlogeServeur, Interpolateur, connecterArene, gardePosition, lerpAngle, urlArene, type SocketLike } from "./reseau";

describe("gardePosition (v8, relève sans téléportation)", () => {
  it("garde la position du client à moins de 3 m de celle du serveur, se replace au-delà ou pour une vraie apparition", () => {
    expect(gardePosition({ p: [10, 0, 5], garder: true }, [11.5, 0, 6])).toBe(true);
    expect(gardePosition({ p: [10, 0, 5], garder: true }, [14, 0, 5])).toBe(false);
    expect(gardePosition({ p: [10, 0, 5] }, [10, 0, 5])).toBe(false);
    // reprise après une coupure, debout : on reste où l'on est, même loin (la position serveur rattrape)
    expect(gardePosition({ p: [10, 0, 5], garder: true }, [30, 0, 5], true)).toBe(true);
    expect(gardePosition({ p: [10, 0, 5] }, [30, 0, 5], true)).toBe(false);
  });
});

function joueur(id: string, x: number, extra: Partial<EtatJoueurSnap> = {}): EtatJoueurSnap {
  return {
    id, p: [x, 0, 0], v: [10, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0,
    arme: "pistolet", pv: 100, vivant: true, protege: false, ...extra,
  };
}

describe("lerpAngle", () => {
  it("prend le plus court chemin à travers ±π", () => {
    const r = lerpAngle(3.0, -3.0, 0.5);
    // 3,0 → −3,0 passe par π (écart de 0,283 rad), pas par 0
    expect(Math.abs(Math.abs(r) - Math.PI)).toBeLessThan(0.01);
  });
  it("interpole normalement sans franchissement", () => {
    expect(lerpAngle(0.2, 0.6, 0.25)).toBeCloseTo(0.3, 10);
  });
});

describe("Interpolateur", () => {
  it("interpole linéairement entre deux snaps", () => {
    const it = new Interpolateur();
    it.ajouter({ ts: 1000, j: [joueur("a", 0, { lacet: 0.2, tangage: -0.2 })] });
    it.ajouter({ ts: 1050, j: [joueur("a", 1, { lacet: 0.6, tangage: 0.2 })] });
    const e = it.echantillon(1025).get("a")!;
    expect(e.p[0]).toBeCloseTo(0.5, 10);
    expect(e.lacet).toBeCloseTo(0.4, 10);
    expect(e.tangage).toBeCloseTo(0, 10);
  });

  it("tourne par le plus court chemin", () => {
    const it = new Interpolateur();
    it.ajouter({ ts: 0, j: [joueur("a", 0, { lacet: 3.0 })] });
    it.ajouter({ ts: 100, j: [joueur("a", 0, { lacet: -3.0 })] });
    const e = it.echantillon(50).get("a")!;
    expect(Math.abs(Math.abs(e.lacet) - Math.PI)).toBeLessThan(0.01);
  });

  it("extrapole avec la vitesse, bornée à 150 ms", () => {
    const it = new Interpolateur();
    it.ajouter({ ts: 1000, j: [joueur("a", 0)] });
    it.ajouter({ ts: 1050, j: [joueur("a", 0.5)] });
    expect(it.echantillon(1100).get("a")!.p[0]).toBeCloseTo(0.5 + 10 * 0.05, 10);
    expect(it.echantillon(1050 + 150).get("a")!.p[0]).toBeCloseTo(0.5 + 1.5, 10);
    // très en retard : plafonné
    expect(it.echantillon(5000).get("a")!.p[0]).toBeCloseTo(0.5 + 1.5, 10);
  });

  it("n'extrapole pas un joueur mort", () => {
    const it = new Interpolateur();
    it.ajouter({ ts: 0, j: [joueur("a", 3, { vivant: false, posture: "mort" })] });
    expect(it.echantillon(100).get("a")!.p[0]).toBe(3);
  });

  it("retire le joueur absent du dernier snap", () => {
    const it = new Interpolateur();
    it.ajouter({ ts: 0, j: [joueur("a", 0), joueur("b", 5)] });
    it.ajouter({ ts: 50, j: [joueur("a", 1)] });
    const milieu = it.echantillon(25);
    expect(milieu.has("a")).toBe(true);
    expect(milieu.has("b")).toBe(false);
    expect(it.echantillon(80).has("b")).toBe(false);
  });

  it("un joueur qui arrive est pris tel quel", () => {
    const it = new Interpolateur();
    it.ajouter({ ts: 0, j: [joueur("a", 0)] });
    it.ajouter({ ts: 50, j: [joueur("a", 0.5), joueur("b", 20)] });
    expect(it.echantillon(25).get("b")!.p[0]).toBe(20);
  });

  it("ne glisse pas à travers l'arène à une réapparition", () => {
    const it = new Interpolateur();
    it.ajouter({ ts: 0, j: [joueur("a", 0, { vivant: false, posture: "mort" })] });
    it.ajouter({ ts: 50, j: [joueur("a", 200)] });
    expect(it.echantillon(10).get("a")!.p[0]).toBe(0);
    expect(it.echantillon(40).get("a")!.p[0]).toBe(200);
  });

  it("avant le plus ancien snap, tient la plus ancienne position", () => {
    const it = new Interpolateur();
    it.ajouter({ ts: 100, j: [joueur("a", 4)] });
    it.ajouter({ ts: 150, j: [joueur("a", 5)] });
    expect(it.echantillon(10).get("a")!.p[0]).toBe(4);
  });

  it("accepte les snaps dans le désordre et les doublons", () => {
    const it = new Interpolateur();
    it.ajouter({ ts: 100, j: [joueur("a", 1)] });
    it.ajouter({ ts: 0, j: [joueur("a", 0)] });
    it.ajouter({ ts: 100, j: [joueur("a", 1)] });
    expect(it.echantillon(50).get("a")!.p[0]).toBeCloseTo(0.5, 10);
  });

  it("borne le tampon à environ 1 s", () => {
    const it = new Interpolateur();
    for (let i = 0; i <= 60; i++) it.ajouter({ ts: i * 50, j: [joueur("a", i)] });
    // l'état de 0 ms est oublié : on tient le plus ancien conservé (≈ 2000 ms)
    expect(it.echantillon(0).get("a")!.p[0]).toBeGreaterThanOrEqual(39);
    expect(it.echantillon(2500).get("a")!.p[0]).toBeCloseTo(50, 10);
  });

  it("ne modifie pas les snaps reçus", () => {
    const it = new Interpolateur();
    const s = joueur("a", 0);
    it.ajouter({ ts: 0, j: [s] });
    it.ajouter({ ts: 50, j: [joueur("a", 1)] });
    const e = it.echantillon(100).get("a")!;
    e.p[0] = 999;
    expect(s.p[0]).toBe(0);
    expect(it.echantillon(100).get("a")!.p[0]).not.toBe(999);
  });

  it("renvoie une table vide sans snap", () => {
    expect(new Interpolateur().echantillon(100).size).toBe(0);
  });

  it("tampon long (killcam) : garde 5 s là où le tampon par défaut en garde 1", () => {
    const court = new Interpolateur();
    const long = new Interpolateur(KILLCAM.tamponMs);
    for (let i = 0; i <= 200; i++) { // 10 s à 20 Hz
      const snap = { ts: i * 50, j: [joueur("a", i)] };
      court.ajouter(snap);
      long.ajouter(snap);
    }
    // dernier snap à 10 000 ms : le long remonte à 5 000 ms (x = 100), le court seulement à 9 000 ms (x = 180)
    expect(long.echantillon(5000).get("a")!.p[0]).toBeCloseTo(100, 10);
    expect(long.echantillon(7500).get("a")!.p[0]).toBeCloseTo(150, 10);
    expect(court.echantillon(7500).get("a")!.p[0]).toBeCloseTo(180, 10); // trop ancien : plus ancien état conservé
    expect(long.echantillon(4000).get("a")!.p[0]).toBeCloseTo(100, 10); // avant l'historique : tient le plus ancien
  });

  it("Interpolateur() garde 1 s (valeur par défaut inchangée)", () => {
    const it = new Interpolateur();
    for (let i = 0; i <= 100; i++) it.ajouter({ ts: i * 50, j: [joueur("a", i)] });
    expect(it.echantillon(0).get("a")!.p[0]).toBeGreaterThanOrEqual(80);
  });

  it("recopie aussi l'occupation d'un véhicule (pas de référence partagée)", () => {
    const it = new Interpolateur();
    const s = joueur("a", 0, { vehicule: { id: 3, siege: 1 } });
    it.ajouter({ ts: 0, j: [s] });
    it.ajouter({ ts: 50, j: [joueur("a", 1, { vehicule: { id: 3, siege: 1 } })] });
    const e = it.echantillon(25).get("a")!;
    expect(e.vehicule).toEqual({ id: 3, siege: 1 });
    e.vehicule!.id = 99;
    expect(s.vehicule!.id).toBe(3);
  });
});

describe("HorlogeServeur", () => {
  it("retrouve le décalage avec un aller-retour symétrique", () => {
    const h = new HorlogeServeur();
    // serveur = local + 5000 ; aller 40 ms, retour 40 ms
    const t0 = 1000;
    h.ajouter(t0, t0 + 40 + 5000, t0 + 80);
    expect(h.decalage).toBeCloseTo(5000, 6);
    expect(h.maintenant(2000)).toBeCloseTo(7000, 6);
  });

  it("se cale sur la mesure au RTT minimal, pas sur les pings lents", () => {
    const h = new HorlogeServeur();
    h.ajouter(0, 20 + 1000, 40); // rtt 40, décalage 1000
    // pings lents asymétriques : biaisent la mesure brute de +100
    for (let i = 1; i <= 6; i++) h.ajouter(i * 2000, i * 2000 + 200 + 1000, i * 2000 + 200);
    expect(h.rttMin()).toBe(40);
    expect(h.decalage).toBeCloseTo(1000, 0);
  });

  it("lisse les changements au lieu de sauter", () => {
    const h = new HorlogeServeur();
    h.ajouter(0, 10 + 1000, 20);
    expect(h.decalage).toBeCloseTo(1000, 6);
    // le rtt devient meilleur et révèle un décalage de 1100
    h.ajouter(100, 105 + 1100, 110);
    // la mesure retenue (rtt 10 → 1100) n'est pas appliquée d'un coup
    expect(h.decalage).toBeGreaterThan(1000);
    expect(h.decalage).toBeLessThan(1100);
  });

  it("l'amorce de « bienvenue » est grossière puis remplacée par le 1er ping", () => {
    const h = new HorlogeServeur();
    h.amorcer(9000, 1000);
    expect(h.decalage).toBe(8000);
    h.ajouter(2000, 2000 + 20 + 8100, 2040);
    expect(h.decalage).toBeCloseTo(8100, 6);
    h.amorcer(0, 0); // sans effet une fois précis
    expect(h.decalage).toBeCloseTo(8100, 6);
  });
});

// ---------- connecterArene avec un faux socket ----------

class FauxSocket implements SocketLike {
  static tous: FauxSocket[] = [];
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onerror: SocketLike["onerror"] = null;
  onclose: SocketLike["onclose"] = null;
  envoyes: string[] = [];
  constructor(public url: string) { FauxSocket.tous.push(this); }
  send(data: string) { this.envoyes.push(data); }
  codeFermeture: number | undefined;
  close(code?: number) { this.codeFermeture = code; this.readyState = 3; this.onclose?.({}); }
  ouvrir() { this.readyState = 1; this.onopen?.({}); }
  recevoir(m: MessageServeur) { this.onmessage?.({ data: JSON.stringify(m) }); }
  couper() { this.readyState = 3; this.onclose?.({}); }
  types() { return this.envoyes.map((s) => JSON.parse(s).t as string); }
}

describe("connecterArene", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    FauxSocket.tous = [];
  });
  afterEach(() => vi.useRealTimers());

  const demarrer = () => {
    const messages: MessageServeur[] = [];
    const etats: string[] = [];
    const client = connecterArene("ws://x", "Bob", (m) => messages.push(m), (e) => etats.push(e), {
      creerSocket: (u) => new FauxSocket(u),
    });
    return { client, messages, etats, socket: () => FauxSocket.tous[FauxSocket.tous.length - 1] };
  };

  it("garde les messages avant l'ouverture puis les envoie après le bonjour", () => {
    const { client, etats, socket } = demarrer();
    client.envoyer({ t: "rejoindre", arme: "sniper" });
    expect(socket().envoyes).toEqual([]);
    socket().ouvrir();
    expect(socket().types().slice(0, 2)).toEqual(["bonjour", "rejoindre"]);
    expect(JSON.parse(socket().envoyes[0])).toMatchObject({ t: "bonjour", pseudo: "Bob" });
    expect(etats).toEqual(["connexion", "ouvert"]);
    client.fermer();
  });

  it("remplit l'id à « bienvenue » et règle l'horloge", () => {
    const { client, socket } = demarrer();
    socket().ouvrir();
    expect(client.id).toBeNull();
    socket().recevoir({ t: "bienvenue", id: "j7", couleur: "#fff", joueurs: [], maintenant: 100_000 + 7000, match: { numero: 1, fin: null, objectif: 25, phase: "jeu", prochain: null } });
    expect(client.id).toBe("j7");
    expect(client.maintenantServeur()).toBe(107_000);
    client.fermer();
  });

  it("(v8) reconnexion : le bonjour demande à reprendre la session (id + jeton du dernier bienvenue), et la reprise garde l'id", () => {
    const { client, socket } = demarrer();
    const match = { numero: 1, fin: null, objectif: 0, phase: "jeu" as const, prochain: null };
    socket().ouvrir();
    expect(JSON.parse(socket().envoyes[0]).reprise).toBeUndefined();
    socket().recevoir({ t: "bienvenue", id: "j7", couleur: "#fff", joueurs: [], maintenant: 0, match, jeton: "secret" });
    // changement de salle : nouveau bienvenue sans jeton, même id, la session reste
    socket().recevoir({ t: "bienvenue", id: "j7", couleur: "#fff", joueurs: [], maintenant: 0, match });
    socket().couper();
    vi.advanceTimersByTime(1000);
    socket().ouvrir();
    expect(JSON.parse(socket().envoyes[0])).toMatchObject({ t: "bonjour", reprise: { id: "j7", jeton: "secret" } });
    socket().recevoir({ t: "bienvenue", id: "j7", couleur: "#fff", joueurs: [], maintenant: 0, match, jeton: "neuf", reprise: true });
    expect(client.id).toBe("j7");
    // reprise refusée (délai dépassé) : nouvelle inscription, nouvel id, la reconnexion suivante reprend celle-ci
    socket().couper();
    vi.advanceTimersByTime(1000);
    socket().ouvrir();
    expect(JSON.parse(socket().envoyes[0]).reprise).toEqual({ id: "j7", jeton: "neuf" });
    socket().recevoir({ t: "bienvenue", id: "j9", couleur: "#fff", joueurs: [], maintenant: 0, match, jeton: "autre" });
    expect(client.id).toBe("j9");
    client.fermer();
  });

  it("(v8) fermer() est un départ volontaire : code 1000, le serveur ne garde pas la session pour une reprise", () => {
    const { client, socket } = demarrer();
    socket().ouvrir();
    const s = socket();
    client.fermer();
    expect(s.codeFermeture).toBe(1000);
  });

  it("ping toutes les 2 s et applique le décalage du pong", () => {
    const { client, socket } = demarrer();
    socket().ouvrir();
    const pings = () => socket().types().filter((t) => t === "ping").length;
    expect(pings()).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(pings()).toBe(2);
    const dernier = JSON.parse(socket().envoyes.filter((s) => s.includes('"ping"')).pop()!);
    vi.advanceTimersByTime(60); // rtt 60 ms
    socket().recevoir({ t: "pong", t0: dernier.t0, maintenant: Date.now() - 30 + 4000 });
    expect(client.maintenantServeur()).toBeCloseTo(Date.now() + 4000, -1);
    client.fermer();
  });

  it("se reconnecte avec backoff 1, 2, 4, 8, 8 s et rejoue le bonjour", () => {
    const { client, etats, socket } = demarrer();
    socket().ouvrir();
    socket().recevoir({ t: "bienvenue", id: "a", couleur: "#fff", joueurs: [], maintenant: 0, match: { numero: 1, fin: null, objectif: 25, phase: "jeu", prochain: null } });
    socket().couper();
    expect(client.id).toBeNull();
    expect(etats.at(-1)).toBe("ferme");
    const attendus = [1000, 2000, 4000, 8000, 8000];
    for (const ms of attendus) {
      const avant = FauxSocket.tous.length;
      vi.advanceTimersByTime(ms - 1);
      expect(FauxSocket.tous.length).toBe(avant);
      vi.advanceTimersByTime(1);
      expect(FauxSocket.tous.length).toBe(avant + 1);
      socket().couper(); // échoue sans s'ouvrir : le backoff continue
    }
    // une ouverture réussie remet le backoff à 1 s et renvoie le bonjour
    vi.advanceTimersByTime(8000);
    socket().ouvrir();
    expect(socket().types()[0]).toBe("bonjour");
    socket().couper();
    const avant = FauxSocket.tous.length;
    vi.advanceTimersByTime(1000);
    expect(FauxSocket.tous.length).toBe(avant + 1);
    client.fermer();
  });

  it("fermer() arrête tout, sans reconnexion", () => {
    const { client, etats, socket } = demarrer();
    socket().ouvrir();
    client.fermer();
    expect(etats.at(-1)).toBe("ferme");
    const n = FauxSocket.tous.length;
    vi.advanceTimersByTime(60_000);
    expect(FauxSocket.tous.length).toBe(n);
    client.envoyer({ t: "quitter" }); // sans effet ni exception
  });

  it("ignore le JSON invalide et ne reconnecte pas après une erreur de version", () => {
    const { client, messages, socket } = demarrer();
    socket().ouvrir();
    socket().onmessage?.({ data: "{pas du json" });
    expect(messages).toEqual([]);
    socket().recevoir({ t: "erreur", code: "version", message: "x" });
    expect(messages).toHaveLength(1);
    socket().couper();
    const n = FauxSocket.tous.length;
    vi.advanceTimersByTime(30_000);
    expect(FauxSocket.tous.length).toBe(n);
    client.fermer();
  });

  it("borne la file d'attente pendant une coupure", () => {
    const { client, socket } = demarrer();
    for (let i = 0; i < 200; i++) client.envoyer({ t: "arme", arme: i % 2 ? "sniper" : "pompe" });
    socket().ouvrir();
    const armes = socket().envoyes.map((s) => JSON.parse(s)).filter((m) => m.t === "arme");
    expect(armes).toHaveLength(64);
    expect(armes.at(-1).arme).toBe("sniper");
    client.fermer();
  });

  it("ne rejoue pas les états, tirs et pings périmés après une coupure (sinon rafale > 90 msg/s = flood)", () => {
    const { client, socket } = demarrer();
    for (let i = 0; i < 200; i++) {
      client.envoyer({ t: "etat", seq: i, p: [0, 0, 0], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 });
      client.envoyer({ t: "tir", arme: "pistolet", o: [0, 0, 0], d: [[0, 0, -1]], touches: [] });
      client.envoyer({ t: "ping", t0: i });
    }
    client.envoyer({ t: "rejoindre", arme: "sniper" });
    socket().ouvrir();
    // bonjour, rejoindre (message durable gardé) et le ping propre à l'ouverture
    expect(socket().types()).toEqual(["bonjour", "rejoindre", "ping"]);
    client.fermer();
  });
});

describe("connecterArene : messages périssables", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    FauxSocket.tous = [];
  });
  afterEach(() => vi.useRealTimers());

  it("ne rejoue pas les coups ni les commandes de conduite après une coupure", () => {
    const messages: MessageServeur[] = [];
    const client = connecterArene("ws://x", "Bob", (m) => messages.push(m), () => {}, { creerSocket: (u) => new FauxSocket(u) });
    const socket = () => FauxSocket.tous[FauxSocket.tous.length - 1];
    for (let i = 0; i < 100; i++) {
      client.envoyer({ t: "coup", o: [0, 0, 0], d: [0, 0, -1], cibles: [] });
      client.envoyer({ t: "conduite", seq: i, vehicule: 1, p: [0, 0, 0], cap: 0, v: 0, lacet: 0, tangage: 0 });
    }
    client.envoyer({ t: "descendre" });
    socket().ouvrir();
    // bonjour, le message durable (descendre) puis le ping d'ouverture
    expect(socket().types()).toEqual(["bonjour", "descendre", "ping"]);
    client.fermer();
  });

  it("envoie coup et conduite tels quels quand le socket est ouvert", () => {
    const client = connecterArene("ws://x", "Bob", () => {}, () => {}, { creerSocket: (u) => new FauxSocket(u) });
    const s = FauxSocket.tous[FauxSocket.tous.length - 1];
    s.ouvrir();
    client.envoyer({ t: "coup", o: [0, 0, 0], d: [0, 0, -1], cibles: ["j2"] });
    client.envoyer({ t: "conduite", seq: 1, vehicule: 1, p: [0, 0, 0], cap: 0, v: 0, lacet: 0, tangage: 0 });
    expect(s.types().slice(-2)).toEqual(["coup", "conduite"]);
    client.fermer();
  });
});

describe("urlArene", () => {
  const env = process.env.NEXT_PUBLIC_FPS_WS_URL;
  afterEach(() => {
    if (env === undefined) delete process.env.NEXT_PUBLIC_FPS_WS_URL;
    else process.env.NEXT_PUBLIC_FPS_WS_URL = env;
    vi.unstubAllGlobals();
  });

  it("préfère la variable d'environnement", () => {
    process.env.NEXT_PUBLIC_FPS_WS_URL = "wss://exemple.test";
    expect(urlArene()).toBe("wss://exemple.test");
  });
  it("utilise le serveur local sur localhost et 127.0.0.1", () => {
    delete process.env.NEXT_PUBLIC_FPS_WS_URL;
    vi.stubGlobal("location", { hostname: "localhost" });
    expect(urlArene()).toBe("ws://localhost:8787");
    vi.stubGlobal("location", { hostname: "127.0.0.1" });
    expect(urlArene()).toBe("ws://localhost:8787");
  });
  it("utilise la prod v2 ailleurs (et hors navigateur)", () => {
    delete process.env.NEXT_PUBLIC_FPS_WS_URL;
    vi.stubGlobal("location", { hostname: "pdj.toam.tech" });
    expect(urlArene()).toBe("wss://pdj-fps.toam.tech");
    vi.unstubAllGlobals();
    expect(urlArene()).toBe("wss://pdj-fps.toam.tech");
  });
});
