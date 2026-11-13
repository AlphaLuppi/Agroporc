import { describe, expect, it } from "vitest";
import { TYPES_CLIENT, lireMessageClient, nettoyerNom } from "./validation";
import { REGLAGES_SALON_DEFAUT, RESEAU, VERSION_ROCKET } from "./protocole";
import type { MessageClient } from "./protocole";

const JETON = "0123456789abcdef0123456789abcdef";
const reglages = () => ({ ...REGLAGES_SALON_DEFAUT() });

describe("nettoyerNom", () => {
  it("garde un nom ordinaire", () => {
    expect(nettoyerNom("Thomas")).toBe("Thomas");
    expect(nettoyerNom("  Élodie  du  Sud ")).toBe("Élodie du Sud");
  });
  it("retire les caractères de contrôle", () => {
    expect(nettoyerNom("Al\u0000i\u0007ce\u007f")).toBe("Alice");
    expect(nettoyerNom("\u0001\u0002")).toBeNull();
  });
  it("retire les caractères de formatage bidirectionnels et invisibles (usurpation de nom)", () => {
    expect(nettoyerNom("\u202eecilA")).toBe("ecilA");
    expect(nettoyerNom("Bo\u200bb")).toBe("Bob");
    expect(nettoyerNom("A" + String.fromCharCode(0x200d, 0x2060) + "B")).toBe("AB");
    expect(nettoyerNom("A" + String.fromCharCode(0xfeff) + "B")).toBe("A B"); // U+FEFF est aussi une espace pour \s
  });
  it("traite les séparateurs de ligne et de paragraphe, tabulations et retours comme des espaces", () => {
    expect(nettoyerNom("a\u2028b\u2029c\td\ne")).toBe("a b c d e");
  });
  it("rend null pour vide, espaces seuls, ou non-chaîne", () => {
    expect(nettoyerNom("")).toBeNull();
    expect(nettoyerNom("   \u00a0\u3000 ")).toBeNull();
    expect(nettoyerNom(null)).toBeNull();
    expect(nettoyerNom(undefined)).toBeNull();
    expect(nettoyerNom(12)).toBeNull();
    expect(nettoyerNom({})).toBeNull();
    expect(nettoyerNom(["a"])).toBeNull();
  });
  it("tronque à 20 points de code, pas à 20 unités UTF-16", () => {
    const emojis = "🚗".repeat(30);
    expect(Array.from(nettoyerNom(emojis)!)).toHaveLength(RESEAU.nomMaxCaracteres);
    expect(nettoyerNom("a".repeat(50))).toBe("a".repeat(20));
  });
  it("ne laisse pas de demi-paire de substitution", () => {
    const n = nettoyerNom("ok\ud800seul")!;
    expect(n).toBe("okseul");
  });
  it("limite les suites de signes combinants", () => {
    const zalgo = "a" + "\u0301".repeat(40);
    expect(Array.from(nettoyerNom(zalgo)!).length).toBeLessThanOrEqual(4);
  });
  it("est idempotent", () => {
    for (const s of ["  a  b ", "\u202ex", "🚗🚗 z", "e\u0301"]) {
      const une = nettoyerNom(s);
      expect(nettoyerNom(une)).toBe(une);
    }
  });
});

describe("lireMessageClient : messages valides", () => {
  it("bonjour sans et avec reprise", () => {
    expect(lireMessageClient({ t: "bonjour", v: VERSION_ROCKET, nom: "Alice" })).toEqual({ t: "bonjour", v: VERSION_ROCKET, nom: "Alice" });
    expect(lireMessageClient({ t: "bonjour", v: 1, nom: "Alice", reprise: { code: "bcdf", joueur: 3, jeton: JETON } }))
      .toEqual({ t: "bonjour", v: 1, nom: "Alice", reprise: { code: "BCDF", joueur: 3, jeton: JETON } });
    expect(lireMessageClient({ t: "bonjour", v: 1, nom: "A", reprise: null })).toEqual({ t: "bonjour", v: 1, nom: "A" });
  });
  it("les messages sans champ", () => {
    for (const t of ["lister", "quitter", "lancer", "pret", "klaxon", "retourSalon"] as const) {
      expect(lireMessageClient({ t })).toEqual({ t });
      expect(lireMessageClient({ t, extra: 1, __proto__: { a: 1 } })).toEqual({ t });
    }
  });
  it("creer avec des réglages complets", () => {
    const r = reglages();
    expect(lireMessageClient({ t: "creer", reglages: r })).toEqual({ t: "creer", reglages: r });
    const r2 = { format: "3v3", dureeS: 600, niveauBots: "allstar", visible: false };
    expect(lireMessageClient({ t: "creer", reglages: r2 })).toEqual({ t: "creer", reglages: r2 });
  });
  it("rejoindre : code normalisé, équipe facultative", () => {
    expect(lireMessageClient({ t: "rejoindre", code: " bcdf " })).toEqual({ t: "rejoindre", code: "BCDF" });
    expect(lireMessageClient({ t: "rejoindre", code: "BCDF", equipe: "orange" })).toEqual({ t: "rejoindre", code: "BCDF", equipe: "orange" });
  });
  it("equipe, reglages partiels, ping, revanche", () => {
    expect(lireMessageClient({ t: "equipe", equipe: "bleue" })).toEqual({ t: "equipe", equipe: "bleue" });
    expect(lireMessageClient({ t: "reglages", reglages: { format: "2v2" } })).toEqual({ t: "reglages", reglages: { format: "2v2" } });
    expect(lireMessageClient({ t: "reglages", reglages: { visible: false, dureeS: 180 } })).toEqual({ t: "reglages", reglages: { visible: false, dureeS: 180 } });
    expect(lireMessageClient({ t: "reglages", reglages: {} })).toEqual({ t: "reglages", reglages: {} });
    expect(lireMessageClient({ t: "ping", c: 12345.5 })).toEqual({ t: "ping", c: 12345.5 });
    expect(lireMessageClient({ t: "revanche", oui: false })).toEqual({ t: "revanche", oui: false });
  });
  it("dev balle et chrono", () => {
    expect(lireMessageClient({ t: "dev", action: "balle", p: [0, 5, 0], v: [1, 2, 3] })).toEqual({ t: "dev", action: "balle", p: [0, 5, 0], v: [1, 2, 3] });
    expect(lireMessageClient({ t: "dev", action: "chrono", tempsRestant: 3 })).toEqual({ t: "dev", action: "chrono", tempsRestant: 3 });
  });
  it("le message rendu est neuf (pas la même référence que l'entrée)", () => {
    const entree = { t: "creer", reglages: reglages() };
    const sortie = lireMessageClient(entree) as Extract<MessageClient, { t: "creer" }>;
    expect(sortie).not.toBe(entree);
    expect(sortie.reglages).not.toBe(entree.reglages);
  });
});

describe("lireMessageClient : refus", () => {
  const refus: [string, unknown][] = [
    ["non objet", 3], ["null", null], ["tableau", [{ t: "lister" }]], ["chaîne", "lister"], ["sans t", {}], ["t inconnu", { t: "hack" }],
    ["t non chaîne", { t: 4 }], ["t hérité", { t: "constructor" }],
    ["bonjour sans v", { t: "bonjour", nom: "A" }], ["bonjour v flottant", { t: "bonjour", v: 1.5, nom: "A" }], ["bonjour v NaN", { t: "bonjour", v: NaN, nom: "A" }],
    ["bonjour v chaîne", { t: "bonjour", v: "1", nom: "A" }], ["bonjour v négatif", { t: "bonjour", v: -1, nom: "A" }],
    ["bonjour sans nom", { t: "bonjour", v: 1 }], ["bonjour nom vide", { t: "bonjour", v: 1, nom: "  " }], ["bonjour nom nombre", { t: "bonjour", v: 1, nom: 5 }],
    ["reprise non objet", { t: "bonjour", v: 1, nom: "A", reprise: "x" }],
    ["reprise code faux", { t: "bonjour", v: 1, nom: "A", reprise: { code: "AAAA", joueur: 1, jeton: JETON } }],
    ["reprise joueur négatif", { t: "bonjour", v: 1, nom: "A", reprise: { code: "BCDF", joueur: -1, jeton: JETON } }],
    ["reprise joueur flottant", { t: "bonjour", v: 1, nom: "A", reprise: { code: "BCDF", joueur: 1.5, jeton: JETON } }],
    ["reprise jeton court", { t: "bonjour", v: 1, nom: "A", reprise: { code: "BCDF", joueur: 1, jeton: "abc" } }],
    ["reprise jeton majuscules", { t: "bonjour", v: 1, nom: "A", reprise: { code: "BCDF", joueur: 1, jeton: JETON.toUpperCase() } }],
    ["creer sans réglages", { t: "creer" }], ["creer réglages null", { t: "creer", reglages: null }],
    ["creer format indéfini", { t: "creer", reglages: { ...reglages(), format: undefined } }],
    ["creer format inconnu", { t: "creer", reglages: { ...reglages(), format: "4v4" } }],
    ["creer dureeS inconnue", { t: "creer", reglages: { ...reglages(), dureeS: 301 } }],
    ["creer dureeS chaîne", { t: "creer", reglages: { ...reglages(), dureeS: "300" } }],
    ["creer niveau inconnu", { t: "creer", reglages: { ...reglages(), niveauBots: "dieu" } }],
    ["creer visible non booléen", { t: "creer", reglages: { ...reglages(), visible: "oui" } }],
    ["creer visible 1", { t: "creer", reglages: { ...reglages(), visible: 1 } }],
    ["creer champ manquant", { t: "creer", reglages: { format: "1v1", dureeS: 300, niveauBots: "pro" } }],
    ["rejoindre sans code", { t: "rejoindre" }], ["rejoindre code court", { t: "rejoindre", code: "ABC" }], ["rejoindre code voyelle", { t: "rejoindre", code: "ABCD" }],
    ["rejoindre code long", { t: "rejoindre", code: "BCDFG" }], ["rejoindre code nombre", { t: "rejoindre", code: 1234 }],
    ["rejoindre équipe inconnue", { t: "rejoindre", code: "BCDF", equipe: "verte" }],
    ["equipe absente", { t: "equipe" }], ["equipe inconnue", { t: "equipe", equipe: "rouge" }], ["equipe nombre", { t: "equipe", equipe: 1 }],
    ["reglages absent", { t: "reglages" }], ["reglages non objet", { t: "reglages", reglages: "x" }], ["reglages tableau", { t: "reglages", reglages: [] }],
    ["reglages format inconnu", { t: "reglages", reglages: { format: "9v9" } }], ["reglages format null", { t: "reglages", reglages: { format: null } }],
    ["reglages visible chaîne", { t: "reglages", reglages: { visible: "true" } }], ["reglages dureeS NaN", { t: "reglages", reglages: { dureeS: NaN } }],
    ["ping sans c", { t: "ping" }], ["ping c NaN", { t: "ping", c: NaN }], ["ping c Infinity", { t: "ping", c: Infinity }], ["ping c chaîne", { t: "ping", c: "1" }],
    ["ping c énorme", { t: "ping", c: 1e300 }],
    ["revanche sans oui", { t: "revanche" }], ["revanche oui chaîne", { t: "revanche", oui: "true" }], ["revanche oui 1", { t: "revanche", oui: 1 }],
    ["dev sans action", { t: "dev" }], ["dev action inconnue", { t: "dev", action: "godmode" }],
    ["dev balle p court", { t: "dev", action: "balle", p: [0, 0], v: [0, 0, 0] }], ["dev balle p NaN", { t: "dev", action: "balle", p: [NaN, 0, 0], v: [0, 0, 0] }],
    ["dev balle p énorme", { t: "dev", action: "balle", p: [1e6, 0, 0], v: [0, 0, 0] }], ["dev balle v Infinity", { t: "dev", action: "balle", p: [0, 0, 0], v: [Infinity, 0, 0] }],
    ["dev balle p chaîne", { t: "dev", action: "balle", p: ["0", "0", "0"], v: [0, 0, 0] }], ["dev balle p objet", { t: "dev", action: "balle", p: { x: 0, y: 0, z: 0 }, v: [0, 0, 0] }],
    ["dev chrono négatif", { t: "dev", action: "chrono", tempsRestant: -1 }], ["dev chrono NaN", { t: "dev", action: "chrono", tempsRestant: NaN }],
    ["dev chrono énorme", { t: "dev", action: "chrono", tempsRestant: 1e9 }],
  ];
  for (const [nom, brut] of refus) it(`refuse : ${nom}`, () => expect(lireMessageClient(brut)).toBeNull());
});

describe("lireMessageClient : réaction rapide", () => {
  it("accepte un identifiant bien formé (le fond est jugé par la salle) et reconstruit le message", () => {
    expect(lireMessageClient({ t: "reaction", id: "tie-un-tigre", extra: 1 })).toEqual({ t: "reaction", id: "tie-un-tigre" });
    expect(lireMessageClient({ t: "reaction", id: "inconnue" })).toEqual({ t: "reaction", id: "inconnue" });
  });
  it("refuse l'absent, le non-texte, le trop long, les majuscules, espaces, caractères de contrôle et injections", () => {
    for (const id of [undefined, null, 3, true, {}, [], ["balle"], "", "a".repeat(25), "Balle", "ba lle", "balle\n", "<script>", "../x", "é", "\u202e", "__proto__ x"]) {
      expect(lireMessageClient({ t: "reaction", id }), String(id)).toBeNull();
    }
    expect(lireMessageClient({ t: "reaction" })).toBeNull();
  });
  it("est un type client connu (un message mal formé reçoit `refus invalide`)", () => {
    expect(TYPES_CLIENT.has("reaction")).toBe(true);
  });
});

describe("lireMessageClient : fuzz", () => {
  /** générateur déterministe (mulberry32) : le test ne dépend d'aucun hasard global */
  function alea(graine: number): () => number {
    let a = graine >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const TYPES = ["bonjour", "lister", "creer", "rejoindre", "quitter", "equipe", "reglages", "lancer", "pret", "ping", "klaxon", "reaction", "revanche", "retourSalon", "dev", "x", ""];
  const CLES = ["t", "v", "nom", "reprise", "reglages", "code", "equipe", "c", "oui", "action", "p", "tempsRestant", "format", "dureeS", "niveauBots", "visible", "code", "joueur", "jeton", "__proto__", "constructor"];
  const SOUS = ["bleue", "orange", "1v1", "2v2", "3v3", "pro", "debutant", "allstar", "BCDF", "bcdf", "\u202e", "a".repeat(5000)];

  function valeur(r: () => number, profondeur: number): unknown {
    const k = Math.floor(r() * 10);
    switch (k) {
      case 0: return null;
      case 1: return undefined;
      case 2: return r() < 0.5;
      case 3: return [NaN, Infinity, -Infinity, 0, -0, 1, -1, 1e300, 2 ** 53, 300, 180, 600][Math.floor(r() * 12)];
      case 4: return Math.floor(r() * 1000) - 500;
      case 5: return SOUS[Math.floor(r() * SOUS.length)];
      case 6: return profondeur > 0 ? Array.from({ length: Math.floor(r() * 4) }, () => valeur(r, profondeur - 1)) : [];
      case 7: return profondeur > 0 ? objet(r, profondeur - 1) : {};
      case 8: return JETON_ALEA(r);
      default: return TYPES[Math.floor(r() * TYPES.length)];
    }
  }
  const JETON_ALEA = (r: () => number) => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("");
  function objet(r: () => number, profondeur: number): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    const n = Math.floor(r() * 6);
    for (let i = 0; i < n; i++) o[CLES[Math.floor(r() * CLES.length)]] = valeur(r, profondeur);
    if (r() < 0.8) o.t = TYPES[Math.floor(r() * TYPES.length)];
    return o;
  }

  it("5 000 objets aléatoires : jamais de levée, résultat null ou message de type connu", () => {
    const r = alea(42);
    let acceptes = 0;
    for (let i = 0; i < 5000; i++) {
      const brut = r() < 0.1 ? valeur(r, 2) : objet(r, 2);
      let m: MessageClient | null = null;
      expect(() => { m = lireMessageClient(brut); }).not.toThrow();
      if (m) {
        acceptes++;
        expect(TYPES).toContain((m as MessageClient).t);
        // le message rendu doit pouvoir passer JSON sans perte (aucune valeur non finie, aucun undefined caché)
        expect(JSON.parse(JSON.stringify(m))).toEqual(m);
      }
    }
    expect(acceptes).toBeGreaterThan(0);
  });

  it("des messages valides mutés champ par champ : accepté ou null, jamais d'exception, et le message accepté reste valide", () => {
    const r = alea(7);
    const base: unknown[] = [
      { t: "bonjour", v: 1, nom: "Alice", reprise: { code: "BCDF", joueur: 2, jeton: JETON } },
      { t: "creer", reglages: reglages() }, { t: "rejoindre", code: "BCDF", equipe: "bleue" }, { t: "reglages", reglages: reglages() },
      { t: "ping", c: 5 }, { t: "dev", action: "balle", p: [0, 1, 2], v: [1, 1, 1] }, { t: "revanche", oui: true },
    ];
    for (let i = 0; i < 2000; i++) {
      const copie = JSON.parse(JSON.stringify(base[i % base.length])) as Record<string, unknown>;
      const cles = Object.keys(copie);
      const cle = cles[Math.floor(r() * cles.length)];
      copie[cle] = valeur(r, 1);
      let m: MessageClient | null = null;
      expect(() => { m = lireMessageClient(copie); }).not.toThrow();
      if (m) expect(lireMessageClient(JSON.parse(JSON.stringify(m)))).toEqual(m);
    }
  });

  it("ne lève jamais sur des objets hostiles (accesseurs, prototype nul, JSON.parse de __proto__)", () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    hostile.t = "lister";
    expect(lireMessageClient(hostile)).toEqual({ t: "lister" });
    const parse = JSON.parse('{"t":"creer","__proto__":{"x":1},"reglages":{"format":"1v1","dureeS":300,"niveauBots":"pro","visible":true,"__proto__":{"y":2}}}');
    const m = lireMessageClient(parse) as Extract<MessageClient, { t: "creer" }>;
    expect(m.reglages).toEqual({ format: "1v1", dureeS: 300, niveauBots: "pro", visible: true });
    expect(Object.keys(m)).toEqual(["t", "reglages"]);
  });
});
