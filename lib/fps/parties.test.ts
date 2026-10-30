import { describe, expect, it } from "vitest";
import { FenetreMax, LimiteCreation, PREFIXE_PARTIE, RegistreParties, Reservations } from "./parties";
import type { ModeSalle } from "./protocole";

interface FausseSalle { mode: ModeSalle; humains: number }

function registre(o: { max?: Partial<Record<ModeSalle, number>>; maxTotal?: number } = {}) {
  return new RegistreParties<FausseSalle>({
    fabriques: { arene: () => ({ mode: "arene", humains: 0 }), zombies: () => ({ mode: "zombies", humains: 0 }), br: () => ({ mode: "br", humains: 0 }) },
    max: { arene: 2, zombies: 3, br: 4, ...o.max },
    maxTotal: o.maxTotal ?? 6,
    humains: (s) => s.humains,
    permanentes: ["arene", "zombies", "br"],
  });
}

describe("registre de parties", () => {
  it("les parties permanentes ar1, z1 et br1 existent dès le départ, permanente en tête", () => {
    const r = registre();
    expect(r.liste().map((p) => p.id)).toEqual(["ar1", "z1", "br1"]);
    expect(r.liste("zombies").map((p) => [p.id, p.permanente])).toEqual([["z1", true]]);
    expect(PREFIXE_PARTIE).toEqual({ arene: "ar", zombies: "z", br: "br" });
  });

  it("ids ar2, z2, z3, br2… : un compteur par mode, jamais réutilisé après une fermeture", () => {
    const r = registre();
    expect(r.ouvrir("arene").id).toBe("ar2");
    expect(r.ouvrir("zombies").id).toBe("z2");
    expect(r.ouvrir("zombies").id).toBe("z3");
    expect(r.ouvrir("br").id).toBe("br2");
    // z2 refermée (vide) : la suivante est z4, pas z2
    r.parId("z2")!.salle.humains = 0;
    r.parId("z3")!.salle.humains = 1;
    expect(r.refermerVides().map((p) => p.id)).toEqual(["ar2", "z2", "br2"]);
    expect(r.parId("z2")).toBeNull();
    expect(r.ouvrir("zombies").id).toBe("z4");
  });

  it("peutOuvrir respecte le plafond du mode puis le plafond total ; ouvrir lève au-delà", () => {
    const r = registre({ max: { arene: 2, zombies: 2, br: 4 }, maxTotal: 5 });
    expect(r.peutOuvrir("arene")).toBe(true);
    r.ouvrir("arene");
    expect(r.peutOuvrir("arene")).toBe(false);          // plafond du mode (2)
    expect(() => r.ouvrir("arene")).toThrow();
    r.ouvrir("br");                                      // 3 permanentes + ar2 + br2 = 5 = total
    r.parId("br2")!.salle.humains = 1;
    expect(r.nombre()).toBe(5);
    expect(r.peutOuvrir("br")).toBe(false);              // br a déjà une partie non permanente : le total joue
  });

  it("réserve d'un emplacement par mode : quatre parties BR ne privent pas les zombies d'une deuxième partie", () => {
    const r = registre({ max: { arene: 2, zombies: 3, br: 4 }, maxTotal: 6 });
    r.ouvrir("br"); r.ouvrir("br"); r.ouvrir("br");       // br2, br3, br4 : 6 parties au total
    expect(r.nombre()).toBe(6);
    expect(r.peutOuvrir("zombies")).toBe(true);           // la réserve
    r.ouvrir("zombies");
    expect(r.nombre()).toBe(7);
    expect(r.peutOuvrir("zombies")).toBe(false);          // une seule réserve par mode : le total joue pour la suivante
    expect(r.peutOuvrir("arene")).toBe(true);
    r.ouvrir("arene");
    expect(r.nombre()).toBe(8);                           // 6 + 2 réserves
    expect(r.peutOuvrir("br")).toBe(false);               // plafond du mode atteint
  });

  it("refermerVides ne retire jamais une permanente, et pas une partie à un seul humain", () => {
    const r = registre();
    r.ouvrir("zombies");
    r.ouvrir("br");
    r.parId("z2")!.salle.humains = 1;
    expect(r.refermerVides().map((p) => p.id)).toEqual(["br2"]);
    expect(r.liste().map((p) => p.id)).toEqual(["ar1", "z1", "br1", "z2"]);
    r.parId("z2")!.salle.humains = 0;
    r.parId("z1")!.salle.humains = 0;
    expect(r.refermerVides().map((p) => p.id)).toEqual(["z2"]);
    expect(r.parId("ar1")).not.toBeNull();
    expect(r.parId("z1")).not.toBeNull();
    expect(r.parId("br1")).not.toBeNull();
  });

  it("deSalle retrouve la partie par identité de la salle", () => {
    const r = registre();
    const p = r.ouvrir("zombies");
    expect(r.deSalle(p.salle)).toBe(p);
    expect(r.deSalle({ mode: "zombies", humains: 0 })).toBeNull();
  });
});

describe("limites de création de partie", () => {
  const limite = () => new LimiteCreation({ delaiMs: 10_000, parIpMax: 1, rafaleIp: 3, ticsLentsMax: 3 });

  it("un client ne crée pas deux parties en moins de 10 s", () => {
    const l = limite();
    expect(l.verifier("j1", "1.1.1.1", "zombies", 1000, 0)).toBe("ok");
    l.noter("z2", "zombies", "j1", "1.1.1.1", 1000);
    l.oublierPartie("z2");
    expect(l.verifier("j1", "1.1.1.1", "zombies", 5000, 0)).toBe("delai");
    expect(l.verifier("j1", "1.1.1.1", "zombies", 11_000, 0)).toBe("ok");
    expect(l.verifier("j2", "2.2.2.2", "zombies", 5000, 0)).toBe("ok");
  });

  it("dix créations en dix secondes par le même client : une seule passe", () => {
    const l = limite();
    let ok = 0;
    for (let i = 0; i < 10; i++) {
      const t = 1000 + i * 1000;
      if (l.verifier("j1", "1.1.1.1", "zombies", t, 0) !== "ok") continue;
      ok++;
      l.noter(`z${i + 2}`, "zombies", "j1", "1.1.1.1", t);
      l.oublierPartie(`z${i + 2}`);
    }
    expect(ok).toBe(1);
  });

  it("des connexions successives de la même IP (id régénéré, partie refermée) ne contournent pas le délai : `rafaleIp` créations par fenêtre", () => {
    const l = limite();
    let ok = 0;
    for (let i = 0; i < 10; i++) {
      const t = 1000 + i * 900;   // dix reconnexions en 9 s, chacune avec un nouvel id et la partie vide refermée
      if (l.verifier(`j${i}`, "1.1.1.1", "br", t, 0) !== "ok") continue;
      ok++;
      l.noter(`br${i + 2}`, "br", `j${i}`, "1.1.1.1", t);
      l.oublierPartie(`br${i + 2}`);
    }
    expect(ok).toBe(3);
    // la fenêtre s'éteint d'elle-même, sans rien effacer à la fermeture d'une socket
    expect(l.verifier("j99", "1.1.1.1", "br", 30_000, 0)).toBe("ok");
    // une autre adresse n'est pas touchée
    expect(l.verifier("j98", "2.2.2.2", "br", 5000, 0)).toBe("ok");
  });

  it("parties ouvertes par IP ET par mode : un autre mode, une autre adresse ou une partie refermée ne comptent pas", () => {
    const l = limite();
    l.noter("z2", "zombies", "j1", "1.1.1.1", 0);
    expect(l.verifier("j9", "1.1.1.1", "zombies", 60_000, 0)).toBe("ip");
    expect(l.verifier("j9", "1.1.1.1", "br", 60_000, 0)).toBe("ok");
    expect(l.verifier("j9", "2.2.2.2", "zombies", 60_000, 0)).toBe("ok");
    l.oublierPartie("z2");
    expect(l.verifier("j9", "1.1.1.1", "zombies", 60_000, 0)).toBe("ok");
    // plafond relevé : deux groupes d'un même bureau ont chacun leur partie
    const deux = new LimiteCreation({ delaiMs: 10_000, parIpMax: 2, rafaleIp: 3, ticsLentsMax: 3 });
    deux.noter("z2", "zombies", "j1", "1.1.1.1", 0);
    expect(deux.verifier("j2", "1.1.1.1", "zombies", 60_000, 0)).toBe("ok");
    deux.noter("z3", "zombies", "j2", "1.1.1.1", 60_000);
    expect(deux.verifier("j3", "1.1.1.1", "zombies", 120_000, 0)).toBe("ip");
  });

  it("disjoncteur : refusé seulement si plusieurs secondes distinctes ont un tic lent, pas à cause d'un pic isolé", () => {
    const l = limite();
    expect(l.verifier("j1", "1.1.1.1", "zombies", 0, 0)).toBe("ok");
    expect(l.verifier("j1", "1.1.1.1", "zombies", 0, 1)).toBe("ok");
    expect(l.verifier("j1", "1.1.1.1", "zombies", 0, 2)).toBe("ok");
    expect(l.verifier("j1", "1.1.1.1", "zombies", 0, 3)).toBe("charge");
  });

  it("FenetreMax : le plus long tic des 10 dernières secondes, puis il s'oublie", () => {
    const f = new FenetreMax(10_000);
    f.noter(3, 1000);
    f.noter(15, 2000);
    f.noter(4, 3000);
    expect(f.max(4000)).toBe(15);
    expect(f.max(11_500)).toBe(15);
    expect(f.max(13_500)).toBe(4);
    expect(f.max(30_000)).toBe(0);
  });

  it("FenetreMax.secondesAuDessus : compte les secondes (pas les tics) au-dessus du seuil, dans la fenêtre", () => {
    const f = new FenetreMax(10_000);
    f.noter(20, 1000); f.noter(30, 1200);   // même seconde : une seule
    f.noter(5, 2000);
    f.noter(13, 3000);
    expect(f.secondesAuDessus(12, 4000)).toBe(2);
    expect(f.secondesAuDessus(12, 12_500)).toBe(1);   // la seconde 1 est sortie de la fenêtre
    expect(f.secondesAuDessus(12, 30_000)).toBe(0);
  });
});

describe("réservations de places d'arène", () => {
  it("une place réservée compte 5 s, par client ; libérée à l'arrivée ; expirée sinon", () => {
    const r = new Reservations(5000);
    r.reserver("j1", "ar2", 0);
    r.reserver("j2", "ar2", 1000);
    r.reserver("j3", "ar1", 1000);
    expect(r.compter("ar2", 2000)).toBe(2);
    r.liberer("j1");
    expect(r.compter("ar2", 2000)).toBe(1);
    expect(r.compter("ar2", 7000)).toBe(0);              // j2 expiré à 6000
    expect(r.compter("ar1", 7000)).toBe(0);
  });
  it("un client qui reserve ailleurs libère l'ancienne réservation", () => {
    const r = new Reservations(5000);
    r.reserver("j1", "ar1", 0);
    r.reserver("j1", "ar2", 100);
    expect(r.compter("ar1", 200)).toBe(0);
    expect(r.compter("ar2", 200)).toBe(1);
  });
});

describe("(2026-10-30) configuration portée par la partie (réglages d'événements d'une arène)", () => {
  function registreConfig() {
    const reçues: { mode: ModeSalle; config: unknown }[] = [];
    const r = new RegistreParties<FausseSalle & { config?: unknown }>({
      fabriques: {
        arene: (config) => { reçues.push({ mode: "arene", config }); return { mode: "arene", humains: 0, config }; },
        zombies: (config) => { reçues.push({ mode: "zombies", config }); return { mode: "zombies", humains: 0, config }; },
        br: (config) => { reçues.push({ mode: "br", config }); return { mode: "br", humains: 0, config }; },
      },
      max: { arene: 2, zombies: 3, br: 4 }, maxTotal: 6, humains: (s) => s.humains, permanentes: ["arene", "zombies", "br"],
    });
    return { r, reçues };
  }

  it("les parties permanentes sont créées sans configuration", () => {
    const { r, reçues } = registreConfig();
    expect(reçues).toEqual([{ mode: "arene", config: undefined }, { mode: "zombies", config: undefined }, { mode: "br", config: undefined }]);
    expect(r.parId("ar1")!.config).toBeUndefined();
    expect("config" in r.parId("ar1")!).toBe(false);
  });

  it("`ouvrir(mode, config)` passe la configuration à la fabrique et la garde sur la partie", () => {
    const { r, reçues } = registreConfig();
    const reglages = { evenements: ["elsa"], frequence: "calme" };
    const p = r.ouvrir("arene", reglages);
    expect(p.id).toBe("ar2");
    expect(p.config).toBe(reglages);
    expect(p.salle.config).toBe(reglages);
    expect(reçues.at(-1)).toEqual({ mode: "arene", config: reglages });
    expect(r.parId("ar2")!.config).toBe(reglages);
    expect(r.deSalle(p.salle)!.config).toBe(reglages);
  });

  it("sans configuration, la partie n'en porte pas", () => {
    const { r } = registreConfig();
    const p = r.ouvrir("zombies");
    expect("config" in p).toBe(false);
  });
});
