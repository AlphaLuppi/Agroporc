import { describe, expect, it } from "vitest";
import { ControleurKillcam } from "./jeu-killcam";
import { KILLCAM } from "./killcam";
import type { EtatJoueurSnap, InfoTueur, MessageServeur, VehiculeSnap } from "./protocole";
import { JEU, OEIL_SIEGE, SILHOUETTE, SILHOUETTE_ACCROUPIE } from "./protocole";

const T_MORT = 1_000_000;
const PAS_SNAP_MS = 50;
const MOI = "moi";
const TUEUR = "tueur";

const INFO: InfoTueur = { id: TUEUR, pseudo: "Zed", couleur: "#f00", p: [40, 0, 0], lacet: 0.3, tangage: -0.1, arme: "sniper", pv: 40, bouclier: 0, distance: 32 };

type Mort = Extract<MessageServeur, { t: "mort" }>;
const mort = (extra: Partial<Mort> = {}): Mort => ({
  t: "mort", cible: MOI, par: TUEUR, arme: "sniper", cause: "arme", zone: "corps", ts: T_MORT, delai: JEU.delaiReapparitionMs, tueur: INFO, ...extra,
});

function etat(id: string, x: number, extra: Partial<EtatJoueurSnap> = {}): EtatJoueurSnap {
  return {
    id, p: [x, 0, 0], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0, arme: "sniper", pv: 100, vivant: true, protege: false, ...extra,
  };
}

/** Le tueur avance de 1 m par seconde le long de x (x = ts/1000 − T_MORT/1000 + 40), moi reste en 0, un autre en 5. */
function joueursA(ts: number, o: { tueur?: boolean; extraTueur?: Partial<EtatJoueurSnap> } = {}): EtatJoueurSnap[] {
  const l = [etat(MOI, 0), etat("autre", 5)];
  if (o.tueur !== false) l.push(etat(TUEUR, 40 + (ts - T_MORT) / 1000, { lacet: 1.2, tangage: -0.4, ...o.extraTueur }));
  return l;
}

const voitureA = (ts: number): VehiculeSnap[] => [{ id: 3, p: [100 + (ts - T_MORT) / 100, 0, 7], cap: 0, v: 0 }];

/** Remplit le tampon de `debut` à `fin` inclus. */
function remplir(c: ControleurKillcam, debut: number, fin: number, o: Parameters<typeof joueursA>[1] = {}): void {
  for (let ts = debut; ts <= fin; ts += PAS_SNAP_MS) c.alimenter(ts, joueursA(ts, o), voitureA(ts));
}

function pret(): ControleurKillcam {
  const c = new ControleurKillcam();
  remplir(c, T_MORT - 4000, T_MORT);
  return c;
}

describe("hors killcam", () => {
  it("rien n'est actif et tout est neutre", () => {
    const c = pret();
    expect(c.actif()).toBe(false);
    expect(c.phase()).toBe("");
    expect(c.progression()).toBe(-1);
    expect(c.info()).toBeNull();
    expect(c.tueurId()).toBeNull();
    expect(c.tempsServeur()).toBeNull();
    expect(c.camera()).toBeNull();
    expect(c.cameraFigee()).toBeNull();
    expect(c.joueursRejoues().size).toBe(0);
    expect(c.vehiculesRejoues().size).toBe(0);
    c.maj(1);
    c.passer();
    expect(c.actif()).toBe(false);
  });

  it("la mort d'un autre joueur est ignorée", () => {
    const c = pret();
    c.surMort(mort({ cible: "autre" }), MOI);
    expect(c.actif()).toBe(false);
    c.maj(1);
    // le tampon n'est pas gelé non plus
    c.alimenter(T_MORT + 100, joueursA(T_MORT + 100), voitureA(T_MORT + 100));
    expect(c.actif()).toBe(false);
  });
});

describe("rejeu", () => {
  it("démarre en rejeu avec le tueur, son info et la progression à 0", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    expect(c.actif()).toBe(true);
    expect(c.phase()).toBe("rejeu");
    expect(c.avecRejeu()).toBe(true);
    expect(c.progression()).toBe(0);
    expect(c.tueurId()).toBe(TUEUR);
    expect(c.info()).toEqual(INFO);
  });

  it("tempsServeur() est monotone de m.ts − 2500 à m.ts, à 1×", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    expect(c.tempsServeur()).toBe(T_MORT - KILLCAM.rejeuMs);
    let prec = c.tempsServeur()!;
    for (let i = 0; i < 25; i++) {
      c.maj(0.1);
      if (c.phase() !== "rejeu") break;
      const t = c.tempsServeur()!;
      expect(t).toBeGreaterThan(prec);
      expect(t - prec).toBeCloseTo(100, 6);
      prec = t;
    }
    // dernière image du rejeu : on a atteint tMort sans le dépasser
    expect(prec).toBeLessThanOrEqual(T_MORT);
    expect(prec).toBeGreaterThan(T_MORT - 200);
  });

  it("rejeu puis carte à 2,5 s, la carte reste jusqu'à terminer()", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    c.maj(2.4);
    expect(c.phase()).toBe("rejeu");
    c.maj(0.2);
    expect(c.phase()).toBe("carte");
    expect(c.tempsServeur()).toBeNull();
    c.maj(10);
    // fin des 4 s : la carte tient, la barre est pleine, aucune phase « termine » n'est exposée
    expect(c.phase()).toBe("carte");
    expect(c.actif()).toBe(true);
    expect(c.progression()).toBe(1);
    c.terminer();
    expect(c.actif()).toBe(false);
    expect(c.phase()).toBe("");
  });

  it("la caméra est à l'œil du tueur et suit son mouvement", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    const cam0 = c.camera()!;
    expect(cam0.pos[1]).toBeCloseTo(SILHOUETTE.oeil, 6);
    expect(cam0.lacet).toBeCloseTo(1.2, 6);
    expect(cam0.tangage).toBeCloseTo(-0.4, 6);
    // à tMort − 2500 le tueur est en x = 40 − 2,5
    expect(cam0.pos[0]).toBeCloseTo(37.5, 3);
    c.maj(1);
    expect(c.camera()!.pos[0]).toBeCloseTo(38.5, 3);
  });

  it("caméra d'un tueur accroupi : œil abaissé", () => {
    const c = new ControleurKillcam();
    remplir(c, T_MORT - 4000, T_MORT, { extraTueur: { accroupi: true } });
    c.surMort(mort(), MOI);
    expect(c.camera()!.pos[1]).toBeCloseTo(SILHOUETTE_ACCROUPIE.oeil, 6);
  });

  it("caméra d'un tueur assis : position du siège + OEIL_SIEGE", () => {
    const c = new ControleurKillcam();
    remplir(c, T_MORT - 4000, T_MORT, { extraTueur: { p: [40, 0.4, 0], vehicule: { id: 3, siege: 0 }, accroupi: true } });
    c.surMort(mort(), MOI);
    const cam = c.camera()!;
    // l'extra écrase `p` : x reste 40 pendant tout le rejeu, y vaut celui du siège
    expect(cam.pos[0]).toBeCloseTo(40, 6);
    expect(cam.pos[1]).toBeCloseTo(0.4 + OEIL_SIEGE, 6);
  });

  it("joueursRejoues() contient moi et les autres, pas le tueur", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    const j = c.joueursRejoues();
    expect(j.has(MOI)).toBe(true);
    expect(j.has("autre")).toBe(true);
    expect(j.has(TUEUR)).toBe(false);
    // la Map n'est pas rendue entre deux images pour rien, mais change quand le temps avance
    c.maj(0.5);
    expect(c.joueursRejoues().has(TUEUR)).toBe(false);
  });

  it("je meurs dans le rejeu : mon état rejoué est celui du passé, pas le présent", () => {
    const c = new ControleurKillcam();
    for (let ts = T_MORT - 4000; ts <= T_MORT; ts += PAS_SNAP_MS) {
      const mortSnap = ts >= T_MORT - 1000;
      c.alimenter(ts, [etat(MOI, 0, { vivant: !mortSnap, pv: mortSnap ? 0 : 100 }), etat(TUEUR, 40)], undefined);
    }
    c.surMort(mort(), MOI);
    expect(c.joueursRejoues().get(MOI)!.vivant).toBe(true);
    c.maj(2.0);
    expect(c.joueursRejoues().get(MOI)!.vivant).toBe(false);
  });

  it("vehiculesRejoues() rend la voiture conduite par le tueur à l'instant rejoué", () => {
    const c = new ControleurKillcam();
    remplir(c, T_MORT - 4000, T_MORT, { extraTueur: { vehicule: { id: 3, siege: 0 } } });
    c.surMort(mort(), MOI);
    const v0 = c.vehiculesRejoues().get(3)!;
    // x = 100 + (t − T_MORT)/100, à tMort − 2500
    expect(v0.p[0]).toBeCloseTo(100 - 25, 3);
    c.maj(1);
    expect(c.vehiculesRejoues().get(3)!.p[0]).toBeCloseTo(100 - 15, 3);
  });

  it("hors rejeu (carte, sans killcam) les rejoués sont vides", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    c.maj(2.6);
    expect(c.phase()).toBe("carte");
    expect(c.joueursRejoues().size).toBe(0);
    expect(c.vehiculesRejoues().size).toBe(0);
    expect(c.camera()).toBeNull();
  });

  it("carte après rejeu : le monde reste figé à l'instant de la mort, joueurs et voitures présents (jamais vides), sans le tueur", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    expect(c.tempsFige()).toBeNull();
    expect(c.joueursFiges().size).toBe(0);
    c.maj(2.6);
    expect(c.phase()).toBe("carte");
    expect(c.tempsFige()).toBe(T_MORT);
    const js = c.joueursFiges();
    expect([...js.keys()].sort()).toEqual(["autre", MOI]);
    expect(js.get("autre")!.p[0]).toBeCloseTo(5, 6);
    expect(c.vehiculesFiges().get(3)!.p[0]).toBeCloseTo(100, 3);
    // figé : la même chose une demi-seconde plus tard
    c.maj(0.5);
    expect(c.vehiculesFiges().get(3)!.p[0]).toBeCloseTo(100, 3);
  });

  it("« passer » en plein rejeu : la carte montre aussi le monde à l'instant de la mort, pas celui du moment du saut", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    c.maj(0.5);
    c.passer();
    expect(c.phase()).toBe("carte");
    expect(c.tempsFige()).toBe(T_MORT);
    expect(c.vehiculesFiges().get(3)!.p[0]).toBeCloseTo(100, 3);
  });

  it("sans rejeu (repli) il n'y a pas de monde figé", () => {
    const c = pret();
    c.surMort(mort({ par: "absent" }), MOI);
    c.maj(0.5);
    expect(c.avecRejeu()).toBe(false);
    expect(c.tempsFige()).toBeNull();
    expect(c.joueursFiges().size).toBe(0);
  });

  it("cameraFigee() : le dernier état du tueur pendant la carte seulement", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    expect(c.cameraFigee()).toBeNull();
    c.maj(2.6);
    const f = c.cameraFigee()!;
    expect(f.pos[0]).toBeCloseTo(40, 3);
    expect(f.pos[1]).toBeCloseTo(SILHOUETTE.oeil, 6);
    c.maj(0.5);
    expect(c.cameraFigee()!.pos[0]).toBeCloseTo(40, 3);
  });
});

describe("passer()", () => {
  it("saute le rejeu vers la carte, sans raccourcir l'attente (la barre saute à 62,5 %)", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    c.maj(0.5);
    c.passer();
    expect(c.phase()).toBe("carte");
    expect(c.tempsServeur()).toBeNull();
    expect(c.camera()).toBeNull();
    expect(c.progression()).toBeCloseTo(KILLCAM.rejeuMs / (KILLCAM.rejeuMs + KILLCAM.carteMs), 6);
    c.passer();
    expect(c.phase()).toBe("carte");
  });
});

describe("gel du tampon", () => {
  it("un snap reçu 200 ms après la mort n'est pas ajouté ; un snap à +100 ms l'est", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    c.maj(0.1);
    c.alimenter(T_MORT + 100, [etat(MOI, 0), etat(TUEUR, 41), etat("nouveau", 9)], undefined);
    c.maj(0.1); // +200 ms : gelé
    c.alimenter(T_MORT + 300, [etat(MOI, 0), etat(TUEUR, 43), etat("tard", 9)], undefined);
    // on rejoue jusqu'à la fin du rejeu : le snap tardif n'a jamais existé
    c.maj(2.2);
    expect(c.phase()).toBe("rejeu");
    for (const t of [c.tempsServeur()!]) expect(t).toBeLessThanOrEqual(T_MORT);
    expect(c.joueursRejoues().has("tard")).toBe(false);
  });

  it("le snap tardif n'allonge pas le tampon : l'extrapolation est celle du dernier snap accepté", () => {
    const c = new ControleurKillcam();
    c.alimenter(T_MORT - 100, [etat(MOI, 0), etat(TUEUR, 10)], undefined);
    c.surMort(mort({ ts: T_MORT - 100 + 1 }), MOI);
    c.maj(0.2);
    c.alimenter(T_MORT + 900, [etat(MOI, 0), etat(TUEUR, 99)], undefined);
    expect(c.camera()).not.toBeNull();
    expect(c.camera()!.pos[0]).toBeCloseTo(10, 6);
  });

  it("un tueur qui disparaît du snap 1 s après reste dans le rejeu", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    c.maj(0.2); // gel
    // 1 s plus tard le tueur a quitté : snaps sans lui, refusés
    for (let ts = T_MORT + 50; ts <= T_MORT + 1500; ts += PAS_SNAP_MS) c.alimenter(ts, joueursA(ts, { tueur: false }), voitureA(ts));
    c.maj(0.8);
    expect(c.phase()).toBe("rejeu");
    const cam = c.camera();
    expect(cam).not.toBeNull();
    expect(cam!.pos[0]).toBeCloseTo(40 + (c.tempsServeur()! - T_MORT) / 1000, 3);
  });

  it("sans gel (avant les 150 ms) un tueur qui quitte retire le rejeu : repli en carte", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    c.maj(0.05);
    c.alimenter(T_MORT + 50, joueursA(T_MORT + 50, { tueur: false }), voitureA(T_MORT + 50));
    c.maj(0.1); // gel : le tueur n'est plus dans le dernier snap accepté
    expect(c.phase()).toBe("carte");
    expect(c.avecRejeu()).toBe(false);
    expect(c.camera()).toBeNull();
    expect(c.info()).toEqual(INFO);
  });

  it("terminer() vide les tampons et dégèle", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    c.maj(0.5);
    c.terminer();
    expect(c.actif()).toBe(false);
    // tampon vidé : une nouvelle mort sans nouveaux snaps → repli
    c.surMort(mort(), MOI);
    expect(c.phase()).toBe("carte");
    expect(c.avecRejeu()).toBe(false);
    c.terminer();
    // dégelé : on peut ré-alimenter, et le rejeu marche de nouveau
    remplir(c, T_MORT - 4000, T_MORT);
    c.surMort(mort(), MOI);
    expect(c.phase()).toBe("rejeu");
    expect(c.camera()).not.toBeNull();
  });
});

describe("repli (sans rejeu)", () => {
  it("tueur absent du tampon : phase carte, caméra nulle, carte sur toute l'attente", () => {
    const c = new ControleurKillcam();
    remplir(c, T_MORT - 4000, T_MORT, { tueur: false });
    c.surMort(mort(), MOI);
    expect(c.phase()).toBe("carte");
    expect(c.avecRejeu()).toBe(false);
    expect(c.camera()).toBeNull();
    expect(c.tempsServeur()).toBeNull();
    expect(c.info()).toEqual(INFO);
    expect(c.progression()).toBe(0);
    c.maj(2);
    expect(c.progression()).toBeCloseTo(0.5, 6);
    expect(c.phase()).toBe("carte");
  });

  it("mort par la circulation (par = \"\", pas de tueur) : carte seule, tueurId nul", () => {
    const c = pret();
    c.surMort(mort({ par: "", cause: "ecrase_pnj", arme: "couteau", tueur: undefined }), MOI);
    expect(c.phase()).toBe("carte");
    expect(c.tueurId()).toBeNull();
    expect(c.info()).toBeNull();
    expect(c.camera()).toBeNull();
    expect(c.actif()).toBe(true);
  });

  it("tampon vide : repli", () => {
    const c = new ControleurKillcam();
    c.surMort(mort(), MOI);
    expect(c.phase()).toBe("carte");
    expect(c.joueursRejoues().size).toBe(0);
  });

  it("passer() sans rejeu ne change rien", () => {
    const c = new ControleurKillcam();
    c.surMort(mort(), MOI);
    c.maj(1);
    c.passer();
    expect(c.progression()).toBeCloseTo(0.25, 6);
  });
});

describe("robustesse", () => {
  it("dt négatif ou non fini : rien n'avance, rien ne gèle", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    c.maj(-1);
    c.maj(Number.NaN);
    c.maj(Number.POSITIVE_INFINITY);
    expect(c.progression()).toBe(0);
    c.alimenter(T_MORT + 50, joueursA(T_MORT + 50), voitureA(T_MORT + 50));
    c.maj(0.04);
    c.alimenter(T_MORT + 100, joueursA(T_MORT + 100), voitureA(T_MORT + 100));
    expect(c.phase()).toBe("rejeu");
  });

  it("une seconde mort relance la machine et le gel", () => {
    const c = pret();
    c.surMort(mort(), MOI);
    c.maj(0.5);
    c.terminer();
    remplir(c, T_MORT - 4000, T_MORT);
    c.surMort(mort(), MOI);
    expect(c.progression()).toBe(0);
    expect(c.tempsServeur()).toBe(T_MORT - KILLCAM.rejeuMs);
  });

  it("snaps sans voitures (champ absent) : les voitures déjà reçues restent rejouables", () => {
    const c = new ControleurKillcam();
    for (let ts = T_MORT - 4000; ts <= T_MORT; ts += PAS_SNAP_MS) c.alimenter(ts, joueursA(ts), ts < T_MORT - 3000 ? voitureA(ts) : undefined);
    c.surMort(mort(), MOI);
    expect(c.vehiculesRejoues().has(3)).toBe(true);
  });
});
