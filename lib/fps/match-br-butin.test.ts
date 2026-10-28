import { describe, expect, it } from "vitest";
import { aleaGraine } from "../agroparc3d/cachettes";
import { STATS } from "./armes";
import { nbObjetsPour } from "./br-butin";
import { BR, EQUIPEMENT_DEPART_BR, MAIN_DEPART_BR } from "./br-regles";
import { armeDuSlot } from "./equipement";
import type { ButinBr, ContexteSalle, JoueurSalle, Sortie } from "./match-contexte";
import { creerButinBr } from "./match-br-butin";
import {
  EQUIPEMENT_DEFAUT, JEU, copierEquipement, type ArmeFeuId, type MessageClient, type MessageServeur, type ObjetBr, type PointButin, type PoolButin,
} from "./protocole";

const T0 = 1_000_000;

function nouveauJoueur(id: string, t = T0): JoueurSalle {
  return {
    id, pseudo: `Agent ${id}`, couleur: "#ff5252", enJeu: true, kills: 0, morts: 0, ping: 0,
    p: [0, 0, 0], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0,
    arme: "couteau", armeSuivante: "pistolet", pv: JEU.pvMax, vivant: true,
    protegeJusqua: 0, reapparitionT: null, reentreeT: -Infinity, seq: 7, etatT: t, histo: [], prochainTir: -Infinity, renommages: [],
    equip: copierEquipement(EQUIPEMENT_DEPART_BR), main: MAIN_DEPART_BR, mainSuivante: "secondaire", munSpeciale: 0,
    sortieJusqua: -Infinity, cadenceArme: {}, bouclier: 0, dernierDegatT: t, regenAcc: 0, accroupi: false, glisse: false, memoSante: null,
    tirs: 0, touches: 0, tetes: 0, degats: 0, serie: 0, serieMax: 0, killsParArme: {},
    scoresOuvert: false, scoresDemandeT: -Infinity, scoresEnvoyeT: -Infinity,
  };
}

const ligne = (pool: PoolButin, n: number, pas: number, z0: number): PointButin[] =>
  Array.from({ length: n }, (_, i) => ({ p: [i * pas, 0, z0], pool }));
const POINTS: PointButin[] = [...ligne("interieur", 400, 3, 0), ...ligne("toit", 400, 5, 100), ...ligne("facade", 400, 10, 200), ...ligne("route", 400, 8, 300)];

interface Banc {
  butin: ButinBr;
  table: Map<string, JoueurSalle>;
  j: (id: string) => JoueurSalle;
  /** objets actuellement au sol, vus depuis la synchro */
  sol: () => ObjetBr[];
  memorises: string[];
  /** le joueur va à l'objet et le ramasse */
  prendre: (id: string, o: ObjetBr, t?: number) => Sortie[];
}

function banc(opts: { nb?: number; enVol?: (j: JoueurSalle) => boolean } = {}): Banc {
  const table = new Map<string, JoueurSalle>();
  const memorises: string[] = [];
  const alea = aleaGraine(9);
  const partiel: Pick<ContexteSalle, "alea" | "joueur" | "memoriserPrecedent" | "equiper"> = {
    alea,
    joueur: (id: string) => table.get(id),
    memoriserPrecedent: (j: JoueurSalle) => { memorises.push(j.id); },
    // comme la salle : équipement, main, arme ; le message privé
    equiper: (j, equip, main, _t, ravitaille) => {
      j.equip = copierEquipement(equip); j.main = main; j.arme = armeDuSlot(j.equip, main) ?? j.arme;
      return [{ a: j.id, m: { t: "equipement", equip: copierEquipement(j.equip), main, munSpeciale: j.munSpeciale, ...(ravitaille ? { ravitaille } : {}) } }];
    },
  };
  const ctx = partiel as ContexteSalle;
  const butin = creerButinBr(ctx, opts.enVol ? { enVol: opts.enVol } : {});
  butin.initialiser(POINTS, 42, opts.nb ?? 300);
  for (const id of ["a", "b"]) table.set(id, nouveauJoueur(id));
  const sol = (): ObjetBr[] => (butin.synchro("x").find((s) => s.m.t === "butin")!.m as Extract<MessageServeur, { t: "butin" }>).ajoutes!;
  return {
    butin, table, memorises, sol, j: (id) => table.get(id)!,
    prendre: (id, o, t = T0) => { const j = table.get(id)!; j.p = [...o.p]; return butin.recevoir(j, { t: "ramasser", id: o.id }, t); },
  };
}

const msgs = <T extends MessageServeur["t"]>(s: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] =>
  s.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
const ARMES_PRINCIPALES = ["mitraillette", "pompe", "fusil_assaut", "mitrailleuse", "sniper"];
const ARMES_SECONDAIRES = ["pistolet", "revolver", "mini_uzi"];
const ARMES_SPECIALES = ["railgun", "minigun", "magnum_dore", "bazooka", "lance_grenades"];
const arme = (ref: string) => (o: ObjetBr) => o.genre === "arme" && o.ref === ref;
const genre = (g: ObjetBr["genre"]) => (o: ObjetBr) => o.genre === g;
function trouver(b: Banc, f: (o: ObjetBr) => boolean, n = 0): ObjetBr {
  const o = b.sol().filter(f)[n];
  if (!o) throw new Error("objet introuvable dans le tirage de test");
  return o;
}
const dist = (a: readonly number[], c: readonly number[]) => Math.hypot(a[0] - c[0], a[2] - c[2]);

describe("synchro et tirage", () => {
  it("la synchro envoie la liste complète des objets en un butin{ajoutes} puis l'inventaire vide, au destinataire seul", () => {
    const b = banc({ nb: nbObjetsPour(50) });
    const s = b.butin.synchro("a");
    expect(s.map((x) => x.m.t)).toEqual(["butin", "inventaire"]);
    expect(s.every((x) => x.a === "a")).toBe(true);
    const ajoutes = msgs(s, "butin")[0].ajoutes!;
    expect(ajoutes).toHaveLength(450);
    expect(new Set(ajoutes.map((o) => o.id)).size).toBe(450);
    expect(msgs(s, "inventaire")[0]).toEqual({ t: "inventaire", bandage: 0, potion: 0, usage: null });
  });

  it("le serveur est seul à tirer : même graine, même butin ; le client reçoit des copies", () => {
    const b1 = banc(), b2 = banc();
    expect(b1.sol()).toEqual(b2.sol());
    b1.sol()[0].p[0] = 9999;
    expect(b1.sol()[0].p[0]).not.toBe(9999);
  });

  it("initialiser remet les inventaires à zéro", () => {
    const b = banc();
    b.prendre("a", trouver(b, genre("bandage")));
    expect(msgs(b.butin.synchro("a"), "inventaire")[0].bandage).toBe(1);
    b.butin.initialiser(POINTS, 1, 10);
    expect(msgs(b.butin.synchro("a"), "inventaire")[0].bandage).toBe(0);
    expect(b.sol()).toHaveLength(10);
  });
});

describe("ramasser", () => {
  it("inconnu, trop loin (horizontal ou en hauteur)", () => {
    const b = banc();
    const o = trouver(b, arme("pompe"));
    const j = b.j("a");
    expect(msgs(b.butin.recevoir(j, { t: "ramasser", id: 99999 }, T0), "ramasse")[0]).toEqual({ t: "ramasse", ok: false, id: 99999, raison: "inconnu" });
    j.p = [o.p[0] + BR.rayonRamassageM + 0.1, o.p[1], o.p[2]];
    expect(msgs(b.butin.recevoir(j, { t: "ramasser", id: o.id }, T0), "ramasse")[0]).toEqual({ t: "ramasse", ok: false, id: o.id, raison: "loin" });
    j.p = [o.p[0], o.p[1] + BR.rayonRamassageM + 0.1, o.p[2]];
    expect(msgs(b.butin.recevoir(j, { t: "ramasser", id: o.id }, T0), "ramasse")[0].raison).toBe("loin");
    j.p = [o.p[0] + 2.4, o.p[1], o.p[2]];
    expect(msgs(b.butin.recevoir(j, { t: "ramasser", id: o.id }, T0), "ramasse")[0].ok).toBe(true);
    expect(b.sol().find((x) => x.id === o.id)).toBeUndefined();
  });

  it("refusé pour un mort, hors partie ou en l'air", () => {
    const o = (b: Banc) => trouver(b, arme("pompe"));
    const b = banc();
    b.j("a").vivant = false;
    expect(msgs(b.prendre("a", o(b)), "ramasse")[0].ok).toBe(false);
    b.j("a").vivant = true; b.j("a").enJeu = false;
    expect(msgs(b.prendre("a", o(b)), "ramasse")[0].ok).toBe(false);
    b.j("a").enJeu = true; b.j("a").protegeJusqua = Infinity; // marqueur du vol
    expect(msgs(b.prendre("a", o(b)), "ramasse")[0].ok).toBe(false);
    expect(b.sol().find((x) => x.id === o(b).id)).toBeDefined();
    const c = banc({ enVol: () => false });
    c.j("a").protegeJusqua = Infinity;
    expect(msgs(c.prendre("a", o(c)), "ramasse")[0].ok).toBe(true);
  });

  it("une arme principale va dans son slot, passe en main, retire l'objet à tous et ravitaille l'arme", () => {
    const b = banc();
    const o = trouver(b, (x) => x.genre === "arme" && ARMES_PRINCIPALES.includes(x.ref as string));
    const s = b.prendre("a", o);
    const j = b.j("a");
    expect(j.equip.principale).toBe(o.ref);
    expect(j.equip.sansPrincipale).toBeUndefined();
    expect(j.equip.sansSecondaire).toBe(true);
    expect(j.main).toBe("principale");
    expect(msgs(s, "ramasse")[0]).toEqual({ t: "ramasse", ok: true, id: o.id });
    const bu = s.find((x) => x.m.t === "butin")!;
    expect(bu.a).toBe("tous");
    expect((bu.m as Extract<MessageServeur, { t: "butin" }>).retires).toEqual([o.id]);
    expect((bu.m as Extract<MessageServeur, { t: "butin" }>).ajoutes).toBeUndefined();
    const eq = s.find((x) => x.m.t === "equipement")!;
    expect(eq.a).toBe("a");
    expect(eq.m).toMatchObject({ t: "equipement", main: "principale", ravitaille: o.ref });
  });

  it("échange : l'arme qui occupait le slot tombe aux pieds (nouvel id, à moins de 1,5 m), annoncée à tous", () => {
    const b = banc();
    const principales = (x: ObjetBr) => x.genre === "arme" && ARMES_PRINCIPALES.includes(x.ref as string);
    const o1 = trouver(b, principales);
    const o2 = trouver(b, (x) => principales(x) && x.ref !== o1.ref);
    const avant = Math.max(...b.sol().map((x) => x.id));
    b.prendre("a", o1);
    const premiere = b.j("a").equip.principale;
    const s = b.prendre("a", o2);
    const lache = (s.find((x) => x.m.t === "butin")!.m as Extract<MessageServeur, { t: "butin" }>);
    expect(lache.ajoutes).toHaveLength(1);
    const tombe = lache.ajoutes![0];
    expect(tombe.genre).toBe("arme");
    expect(tombe.ref).toBe(premiere);
    expect(tombe.id).toBeGreaterThan(avant);
    expect(dist(tombe.p, b.j("a").p)).toBeLessThan(1.5);
    expect(b.sol().find((x) => x.id === tombe.id)).toBeDefined();
    // et on peut la reprendre
    const j = b.j("a");
    expect(msgs(b.butin.recevoir(j, { t: "ramasser", id: tombe.id }, T0), "ramasse")[0].ok).toBe(true);
  });

  it("une secondaire retire sansSecondaire", () => {
    const b = banc();
    const o = trouver(b, (x) => x.genre === "arme" && ARMES_SECONDAIRES.includes(x.ref as string));
    b.prendre("a", o);
    expect(b.j("a").equip.secondaire).toBe(o.ref);
    expect(b.j("a").equip.sansSecondaire).toBeUndefined();
    expect(b.j("a").main).toBe("secondaire");
  });

  it("une spéciale ou unique : slot spéciale, chargeur plein, mémorise l'arme précédente, sans ravitaille", () => {
    const b = banc();
    const o = trouver(b, (x) => x.genre === "arme" && ARMES_SPECIALES.includes(x.ref as string));
    const s = b.prendre("a", o);
    const j = b.j("a");
    expect(j.equip.speciale).toBe(o.ref);
    expect(j.main).toBe("speciale");
    expect(j.munSpeciale).toBe(STATS[o.ref as ArmeFeuId].chargeur);
    expect(b.memorises).toEqual(["a"]);
    expect(s.find((x) => x.m.t === "equipement")!.m).toMatchObject({ munSpeciale: STATS[o.ref as ArmeFeuId].chargeur });
    expect((s.find((x) => x.m.t === "equipement")!.m as { ravitaille?: string }).ravitaille).toBeUndefined();
  });

  it("l'épée remplace l'arme blanche sans rien lâcher", () => {
    const b = banc();
    const o = trouver(b, arme("epee"));
    const s = b.prendre("a", o);
    expect(b.j("a").equip.melee).toBe("epee");
    expect(b.j("a").main).toBe("couteau");
    expect((s.find((x) => x.m.t === "butin")!.m as Extract<MessageServeur, { t: "butin" }>).ajoutes).toBeUndefined();
  });

  it("une boîte de munitions : +2 chargeurs pour l'arme de la classe portée ; sans arme compatible, refusée et laissée au sol", () => {
    const b = banc();
    const boite = trouver(b, (x) => x.genre === "munitions" && x.ref === "legeres");
    const refus = msgs(b.prendre("a", boite), "ramasse")[0];
    expect(refus).toEqual({ t: "ramasse", ok: false, id: boite.id, raison: "inutile" });
    expect(b.sol().find((x) => x.id === boite.id)).toBeDefined();
    b.j("a").equip = copierEquipement({ ...EQUIPEMENT_DEFAUT, principale: "mitraillette" });
    const s = b.prendre("a", boite);
    expect(s.find((x) => x.m.t === "equipement")!.m).toMatchObject({ t: "equipement", ajoutMunitions: { arme: "mitraillette", chargeurs: 2 } });
    expect(b.sol().find((x) => x.id === boite.id)).toBeUndefined();
    expect(b.j("a").main).toBe("couteau"); // les munitions ne changent pas la main
  });

  it("bandages et potions : pile de 5 et de 3, inventaire privé, au-delà refusé", () => {
    const b = banc({ nb: 480 });
    for (let k = 0; k < 5; k++) {
      const s = b.prendre("a", trouver(b, genre("bandage")));
      expect(msgs(s, "inventaire")[0]).toMatchObject({ bandage: k + 1, potion: 0 });
      expect(s.find((x) => x.m.t === "inventaire")!.a).toBe("a");
    }
    const refus = b.prendre("a", trouver(b, genre("bandage")));
    expect(msgs(refus, "ramasse")[0]).toMatchObject({ ok: false, raison: "inutile" });
    for (let k = 0; k < 3; k++) b.prendre("a", trouver(b, genre("potion")));
    expect(msgs(b.butin.synchro("a"), "inventaire")[0]).toMatchObject({ bandage: 5, potion: 3 });
    expect(msgs(b.prendre("a", trouver(b, genre("potion"))), "ramasse")[0].ok).toBe(false);
    // l'inventaire de l'autre joueur est à part
    expect(msgs(b.butin.synchro("b"), "inventaire")[0]).toMatchObject({ bandage: 0, potion: 0 });
  });

  it("un tas de soins lâché à la mort ne tient pas toujours dans la pile : le reste reste au sol sous un nouvel id", () => {
    const b = banc({ nb: 480 });
    const mort = b.j("b");
    mort.p = [10, 0, 10];
    for (let k = 0; k < 5; k++) b.prendre("b", trouver(b, genre("bandage")));
    mort.p = [10, 0, 10];
    b.butin.lacherALaMort(mort, T0);
    const tas = b.sol().find((o) => o.genre === "bandage" && o.qte === 5)!;
    expect(tas).toBeDefined();
    const j = b.j("a");
    for (let k = 0; k < 3; k++) b.prendre("a", trouver(b, genre("bandage")));
    const s = b.prendre("a", tas);
    expect(msgs(s, "inventaire")[0].bandage).toBe(5);
    const reste = b.sol().find((o) => o.genre === "bandage" && o.qte === 3)!;
    expect(reste).toBeDefined();
    expect(reste.id).not.toBe(tas.id);
    expect(dist(reste.p, tas.p)).toBe(0);
    expect(j.pv).toBe(100);
  });
});

describe("lacher", () => {
  it("jette l'arme du slot à ses pieds, repasse au couteau si elle était en main, et ne fait rien sur un slot vide", () => {
    const b = banc();
    const o = trouver(b, (x) => x.genre === "arme" && ARMES_PRINCIPALES.includes(x.ref as string));
    b.prendre("a", o);
    const j = b.j("a");
    const s = b.butin.recevoir(j, { t: "lacher", slot: "principale" }, T0);
    expect(j.equip.sansPrincipale).toBe(true);
    expect(j.main).toBe("couteau");
    const bu = s.find((x) => x.m.t === "butin")!;
    expect(bu.a).toBe("tous");
    const [tombe] = (bu.m as Extract<MessageServeur, { t: "butin" }>).ajoutes!;
    expect(tombe.ref).toBe(o.ref);
    expect(dist(tombe.p, j.p)).toBeLessThan(1.5);
    expect(s.find((x) => x.m.t === "equipement")!.m).toMatchObject({ main: "couteau" });
    // rien d'autre à lâcher
    expect(b.butin.recevoir(j, { t: "lacher", slot: "principale" }, T0)).toEqual([]);
    expect(b.butin.recevoir(j, { t: "lacher", slot: "secondaire" }, T0)).toEqual([]);
    expect(b.butin.recevoir(j, { t: "lacher", slot: "speciale" }, T0)).toEqual([]);
  });

  it("la spéciale lâchée remet ses munitions à zéro", () => {
    const b = banc();
    b.prendre("a", trouver(b, (x) => x.genre === "arme" && ARMES_SPECIALES.includes(x.ref as string)));
    const j = b.j("a");
    b.butin.recevoir(j, { t: "lacher", slot: "speciale" }, T0);
    expect(j.equip.speciale).toBeNull();
    expect(j.munSpeciale).toBe(0);
    expect(j.main).toBe("couteau");
  });

  it("une arme lâchée d'un slot qui n'est pas en main laisse la main", () => {
    const b = banc();
    b.prendre("a", trouver(b, (x) => x.genre === "arme" && ARMES_SECONDAIRES.includes(x.ref as string)));
    b.prendre("a", trouver(b, (x) => x.genre === "arme" && ARMES_PRINCIPALES.includes(x.ref as string)));
    const j = b.j("a");
    expect(j.main).toBe("principale");
    b.butin.recevoir(j, { t: "lacher", slot: "secondaire" }, T0);
    expect(j.main).toBe("principale");
    expect(j.equip.sansSecondaire).toBe(true);
  });
});

describe("soins", () => {
  /** Alice porte `n` bandages et `m` potions. */
  function soigne(n: number, m = 0): Banc {
    const b = banc({ nb: 480 });
    for (let k = 0; k < n; k++) b.prendre("a", trouver(b, genre("bandage")));
    for (let k = 0; k < m; k++) b.prendre("a", trouver(b, genre("potion")));
    return b;
  }
  const utiliser = (objet: "bandage" | "potion" | null): MessageClient => ({ t: "utiliser", objet });
  const inventaire = (s: Sortie[]) => msgs(s, "inventaire").at(-1);

  it("bandage : 3 s, +20 PV plafonné à 75, une unité consommée à la fin", () => {
    const b = soigne(2);
    const j = b.j("a");
    j.pv = 60;
    const s = b.butin.recevoir(j, utiliser("bandage"), T0);
    expect(inventaire(s)).toEqual({ t: "inventaire", bandage: 2, potion: 0, usage: { objet: "bandage", finT: T0 + 3_000 } });
    expect(b.butin.tic(T0 + 2_999)).toEqual([]);
    expect(j.pv).toBe(60);
    const fin = b.butin.tic(T0 + 3_000);
    expect(j.pv).toBe(75); // 60 + 20 plafonné
    expect(msgs(fin, "soin")[0]).toEqual({ t: "soin", pv: 75, bouclier: 0, motif: "bandage" });
    expect(fin.find((x) => x.m.t === "soin")!.a).toBe("a");
    expect(inventaire(fin)).toEqual({ t: "inventaire", bandage: 1, potion: 0, usage: null });
    // plus rien ensuite
    expect(b.butin.tic(T0 + 4_000)).toEqual([]);
  });

  it("bandage : +20 PV quand il y a de la place", () => {
    const b = soigne(1);
    const j = b.j("a");
    j.pv = 40;
    b.butin.recevoir(j, utiliser("bandage"), T0);
    b.butin.tic(T0 + 3_000);
    expect(j.pv).toBe(60);
  });

  it("bandage : refusé à 75 PV ou plus, sans stock", () => {
    const b = soigne(1);
    const j = b.j("a");
    j.pv = 75;
    expect(b.butin.recevoir(j, utiliser("bandage"), T0)).toEqual([]);
    j.pv = 50;
    expect(b.butin.recevoir(b.j("b"), utiliser("bandage"), T0)).toEqual([]);
  });

  it("potion : 4 s, +50 de bouclier plafonné à 100, refusée à 100", () => {
    const b = soigne(0, 2);
    const j = b.j("a");
    j.bouclier = 70;
    const s = b.butin.recevoir(j, utiliser("potion"), T0);
    expect(inventaire(s)!.usage).toEqual({ objet: "potion", finT: T0 + 4_000 });
    expect(b.butin.tic(T0 + 3_999)).toEqual([]);
    const fin = b.butin.tic(T0 + 4_000);
    expect(j.bouclier).toBe(100);
    expect(msgs(fin, "soin")[0]).toEqual({ t: "soin", pv: 100, bouclier: 100, motif: "potion" });
    expect(inventaire(fin)!.potion).toBe(1);
    expect(b.butin.recevoir(j, utiliser("potion"), T0 + 5_000)).toEqual([]);
  });

  it("un seul usage à la fois", () => {
    const b = soigne(1, 1);
    const j = b.j("a");
    j.pv = 30; j.bouclier = 0;
    b.butin.recevoir(j, utiliser("bandage"), T0);
    expect(b.butin.recevoir(j, utiliser("potion"), T0 + 100)).toEqual([]);
    expect(b.butin.recevoir(j, utiliser("bandage"), T0 + 100)).toEqual([]);
  });

  it("utiliser{null} interrompt sans rien consommer", () => {
    const b = soigne(1);
    const j = b.j("a");
    j.pv = 30;
    b.butin.recevoir(j, utiliser("bandage"), T0);
    const s = b.butin.recevoir(j, utiliser(null), T0 + 1_000);
    expect(inventaire(s)).toEqual({ t: "inventaire", bandage: 1, potion: 0, usage: null });
    expect(b.butin.tic(T0 + 5_000)).toEqual([]);
    expect(j.pv).toBe(30);
    // rien à interrompre : silence
    expect(b.butin.recevoir(j, utiliser(null), T0 + 6_000)).toEqual([]);
  });

  it("un coup reçu interrompt l'usage (message au tic suivant) ; la tempête, non", () => {
    const b = soigne(2);
    const j = b.j("a");
    j.pv = 30;
    b.butin.recevoir(j, utiliser("bandage"), T0);
    b.butin.surDegats(j, "tempete", T0 + 500);
    b.butin.surDegats(j, "tempete", T0 + 600);
    const fin = b.butin.tic(T0 + 3_000);
    expect(j.pv).toBe(50);
    expect(msgs(fin, "soin")).toHaveLength(1);
    // un coup d'arme
    b.butin.recevoir(j, utiliser("bandage"), T0 + 4_000);
    b.butin.surDegats(j, "arme", T0 + 5_000);
    const s = b.butin.tic(T0 + 5_050);
    expect(inventaire(s)).toEqual({ t: "inventaire", bandage: 1, potion: 0, usage: null });
    expect(b.butin.tic(T0 + 8_000)).toEqual([]);
    expect(j.pv).toBe(50);
  });

  it("un changement d'arme (ramassage qui change la main, lâcher de l'arme en main) interrompt l'usage", () => {
    const b = soigne(1);
    const j = b.j("a");
    j.pv = 30;
    b.butin.recevoir(j, utiliser("bandage"), T0);
    const s = b.prendre("a", trouver(b, (x) => x.genre === "arme" && ARMES_PRINCIPALES.includes(x.ref as string)), T0 + 1_000);
    expect(inventaire(s)!.usage).toBeNull();
    expect(b.butin.tic(T0 + 4_000).filter((x) => x.m.t === "soin")).toEqual([]);
    // un ramassage qui ne change pas la main ne l'interrompt pas
    j.pv = 30;
    b.butin.recevoir(j, utiliser("bandage"), T0 + 5_000);
    b.prendre("a", trouver(b, genre("bandage"), 3), T0 + 5_100);
    expect(inventaire(b.butin.synchro("a"))!.usage).not.toBeNull();
  });

  it("un joueur mort pendant l'usage : rien ne s'applique", () => {
    const b = soigne(1);
    const j = b.j("a");
    j.pv = 30;
    b.butin.recevoir(j, utiliser("bandage"), T0);
    j.vivant = false;
    expect(b.butin.tic(T0 + 3_000)).toEqual([]);
    expect(j.pv).toBe(30);
  });

  it("pas d'usage en l'air", () => {
    const b = soigne(1);
    const j = b.j("a");
    j.pv = 30;
    j.protegeJusqua = Infinity;
    expect(b.butin.recevoir(j, utiliser("bandage"), T0)).toEqual([]);
  });

  it("si les PV dépassent le plafond pendant l'usage (+50 d'un kill), le bandage n'est pas gâché", () => {
    const b = soigne(1);
    const j = b.j("a");
    j.pv = 40;
    b.butin.recevoir(j, utiliser("bandage"), T0);
    j.pv = 90;
    const fin = b.butin.tic(T0 + 3_000);
    expect(j.pv).toBe(90);
    expect(msgs(fin, "soin")).toHaveLength(0);
    expect(inventaire(fin)).toEqual({ t: "inventaire", bandage: 1, potion: 0, usage: null });
  });
});

describe("lacherALaMort", () => {
  it("jette toutes les armes (4 au plus) et un objet par pile de soins non vide avec sa quantité, à moins de 1,5 m, annoncés à tous", () => {
    const b = banc({ nb: 480 });
    const j = b.j("a");
    b.prendre("a", trouver(b, (x) => x.genre === "arme" && ARMES_PRINCIPALES.includes(x.ref as string)));
    b.prendre("a", trouver(b, (x) => x.genre === "arme" && ARMES_SECONDAIRES.includes(x.ref as string)));
    b.prendre("a", trouver(b, (x) => x.genre === "arme" && ARMES_SPECIALES.includes(x.ref as string)));
    b.prendre("a", trouver(b, arme("epee")));
    for (let k = 0; k < 3; k++) b.prendre("a", trouver(b, genre("bandage")));
    for (let k = 0; k < 2; k++) b.prendre("a", trouver(b, genre("potion")));
    j.p = [50, 0, 50];
    j.pv = 0; j.vivant = false;
    const principale = j.equip.principale, secondaire = j.equip.secondaire, speciale = j.equip.speciale;
    const s = b.butin.lacherALaMort(j, T0);
    const bu = s.find((x) => x.m.t === "butin")!;
    expect(bu.a).toBe("tous");
    const ajoutes = (bu.m as Extract<MessageServeur, { t: "butin" }>).ajoutes!;
    expect(ajoutes.map((o) => o.genre === "arme" ? o.ref : o.genre).sort()).toEqual([principale, secondaire, speciale, "epee", "bandage", "potion"].sort());
    expect(ajoutes.find((o) => o.genre === "bandage")!.qte).toBe(3);
    expect(ajoutes.find((o) => o.genre === "potion")!.qte).toBe(2);
    for (const o of ajoutes) expect(dist(o.p, j.p)).toBeLessThan(1.5);
    expect(new Set(ajoutes.map((o) => o.id)).size).toBe(ajoutes.length);
    for (const o of ajoutes) expect(b.sol().find((x) => x.id === o.id)).toBeDefined();
    // l'inventaire du mort est vidé
    expect(msgs(b.butin.synchro("a"), "inventaire")[0]).toEqual({ t: "inventaire", bandage: 0, potion: 0, usage: null });
    // l'équipement n'est pas modifié (c'est la salle qui l'efface après)
    expect(j.equip.speciale).toBe(speciale);
  });

  it("un joueur qui n'a rien ne lâche rien (couteau et départ vide)", () => {
    const b = banc();
    const s = b.butin.lacherALaMort(b.j("a"), T0);
    expect(s.some((x) => x.m.t === "butin")).toBe(false);
    expect(b.sol()).toHaveLength(300);
  });

  it("interrompt l'usage en cours", () => {
    const b = banc({ nb: 480 });
    const j = b.j("a");
    b.prendre("a", trouver(b, genre("bandage")));
    j.pv = 30;
    b.butin.recevoir(j, { t: "utiliser", objet: "bandage" }, T0);
    b.butin.lacherALaMort(j, T0 + 100);
    expect(b.butin.tic(T0 + 3_000)).toEqual([]);
  });
});

describe("reinitialiser", () => {
  it("vide les objets, les inventaires et les usages", () => {
    const b = banc({ nb: 480 });
    b.prendre("a", trouver(b, genre("bandage")));
    b.butin.reinitialiser();
    expect(b.sol()).toEqual([]);
    expect(msgs(b.butin.synchro("a"), "inventaire")[0]).toEqual({ t: "inventaire", bandage: 0, potion: 0, usage: null });
    expect(b.butin.tic(T0 + 9_000)).toEqual([]);
  });
});
