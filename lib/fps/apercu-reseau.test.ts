import { describe, expect, it } from "vitest";
import { APERCU, ageApercu, construireApercu, decoderApercu } from "./apercu-reseau";
import { encoderZombies, type BrApercu, type EtatJoueurSnap, type ZombieSnap } from "./protocole";

const joueur = (i: number, plus: Partial<EtatJoueurSnap> = {}): EtatJoueurSnap => ({
  id: `j${i}`, p: [i * 3.14159, 0.04 + (i % 3), -i * 2.71828], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: "aucun" as never,
  arme: "pistolet" as never, pv: 100, vivant: true, protege: false, ...plus,
});
const noms = (id: string) => ({ pseudo: `Nom${id}`, couleur: "#a1b2c3" });
const tigre = (i: number, plus: Partial<ZombieSnap> = {}): ZombieSnap => ({
  id: i, x: 100 + i * 1.5, z: -20 + i, cap: 1.234, type: (i % 5) as ZombieSnap["type"], griffe: false, apparition: false, pvPct: 80, allure: 1, mode: "chasse", ...plus,
});
const zoneBr = { palier: 3, nbPaliers: 6, phase: "retrecit", t0: 1, t1: 2, t2: 3, c0: [10, 20], r0: 100, c1: [12, 22], r1: 60, degats: 3 } as const;

describe("construireApercu / decoderApercu", () => {
  it("aller-retour JSON : positions au décimètre, drapeaux, pseudos, tigres, manche", () => {
    const snap = [joueur(1), joueur(2, { vivant: false }), joueur(3, { chute: "libre" }), joueur(4, { chute: "voile" })];
    const z = encoderZombies(5, [tigre(1), tigre(2, { mode: "fenetre", type: 4 })]);
    const m = JSON.parse(JSON.stringify(construireApercu({ mode: "zombies", ts: 12345, snap, noms, zombies: z, manche: 4 })));
    expect(m.t).toBe("apercu");
    const d = decoderApercu(m, 12000);
    expect(d.mode).toBe("zombies");
    expect(d.manche).toBe(4);
    expect(d.decalageServeurMs).toBe(345);
    expect(d.joueurs.map((j) => j.id)).toEqual(["j1", "j2", "j3", "j4"]);
    expect(d.joueurs[0].p[0]).toBeCloseTo(3.1, 5);
    expect(d.joueurs[0].p[2]).toBeCloseTo(-2.7, 5);
    expect(d.joueurs[0].pseudo).toBe("Nomj1");
    expect(d.joueurs[0].couleur).toBe("#a1b2c3");
    expect(d.joueurs[0].hors).toBeUndefined();
    expect(d.joueurs[1].hors).toBe("terre");
    expect(d.joueurs[2].chute).toBe("libre");
    expect(d.joueurs[3].chute).toBe("voile");
    expect(d.tigres).toHaveLength(2);
    expect(d.tigres[1]).toMatchObject({ id: 2, type: 4, mode: "fenetre" });
    expect(d.tigres[0].x).toBeCloseTo(101.5, 5);
  });

  it("Battle Royale : zone, avion, effectifs ; un éliminé est « mort »", () => {
    const br: BrApercu = { phase: "jeu", vivants: 7, total: 9, zone: { ...zoneBr, c0: [10, 20], c1: [12, 22] }, avion: null };
    const m = construireApercu({ mode: "br", ts: 1, snap: [joueur(1, { vivant: false })], noms, br, partie: "br2" });
    const d = decoderApercu(JSON.parse(JSON.stringify(m)), 1);
    expect(d).toMatchObject({ mode: "br", partie: "br2", vivants: 7, total: 9 });
    expect(d.zone?.palier).toBe(3);
    expect(d.joueurs[0].hors).toBe("mort");
  });

  it("ignore un joueur dont la salle ne connaît pas le nom", () => {
    const m = construireApercu({ mode: "zombies", ts: 1, snap: [joueur(1), joueur(2)], noms: (id) => (id === "j1" ? noms(id) : undefined) });
    expect(m.j).toHaveLength(1);
  });

  it("budgets de taille : Battle Royale à 50 joueurs <= 3,6 Ko ; zombies 8 joueurs + 24 tigres <= 1,8 Ko", () => {
    const snap50 = Array.from({ length: 50 }, (_, i) => joueur(i + 10, { p: [(i - 25) * 12.34, 3, (i % 7) * -31.7] }));
    const br = construireApercu({ mode: "br", ts: 1_700_000_000_000, snap: snap50, noms: (id) => ({ pseudo: `Joueur${id}`.slice(0, 8), couleur: "#12ab34" }), br: { phase: "jeu", vivants: 50, total: 50, zone: null, avion: null } });
    // la zone et l'avion pèsent ~0,4 Ko de plus quand ils sont présents
    expect(JSON.stringify(br).length).toBeLessThanOrEqual(3600);
    const snap8 = Array.from({ length: 8 }, (_, i) => joueur(i + 1));
    const tigres = Array.from({ length: 24 }, (_, i) => tigre(i + 1, { x: 100 + i * 3, z: -50 + i * 2 }));
    const z = construireApercu({ mode: "zombies", ts: 1_700_000_000_000, snap: snap8, noms, zombies: encoderZombies(10, tigres), manche: 12 });
    expect(JSON.stringify(z).length).toBeLessThanOrEqual(1800);
  });

  it("coût de construction à 50 joueurs <= 0,15 ms en moyenne", () => {
    const snap50 = Array.from({ length: 50 }, (_, i) => joueur(i + 10));
    const n = 2000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) construireApercu({ mode: "br", ts: i, snap: snap50, noms, br: { phase: "jeu", vivants: 50, total: 50, zone: null, avion: null } });
    expect((performance.now() - t0) / n).toBeLessThan(0.15);
  });

  it("ageApercu et constantes", () => {
    const d = decoderApercu(construireApercu({ mode: "zombies", ts: 5, snap: [], noms }), 1000);
    expect(ageApercu(d, 1800)).toBe(800);
    expect(APERCU.zombiesTousLesSnaps).toBe(4);
    expect(APERCU.brTousLesSnaps).toBe(3);
  });
});
