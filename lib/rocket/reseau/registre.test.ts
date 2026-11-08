import { describe, expect, it } from "vitest";
import { creerRegistreRocket } from "./registre";
import { REGLAGES_SALON_DEFAUT, RESEAU } from "./protocole";
import type { EtatSalon, OptionsSalleRocket, PhaseSalle, ResumeSalle, SalleRocket } from "./protocole";

/** Salle factice : seuls les accesseurs que le registre consulte, pilotés par le test. */
interface SalleFausse extends SalleRocket {
  opts: OptionsSalleRocket;
  etatTest: { phase: PhaseSalle; humains: number; places: number; visible: boolean; echeance: boolean; activite: number };
}
function fabrique(): { creerSalle: (o: OptionsSalleRocket) => SalleRocket; creees: SalleFausse[] } {
  const creees: SalleFausse[] = [];
  const creerSalle = (opts: OptionsSalleRocket): SalleRocket => {
    const etatTest = { phase: "salon" as PhaseSalle, humains: 1, places: 2, visible: opts.reglages.visible, echeance: false, activite: opts.maintenantMs };
    const s = {
      opts, etatTest,
      code: opts.code,
      get phase() { return etatTest.phase; },
      humains: () => etatTest.humains,
      vide: () => etatTest.humains === 0,
      enMatch: () => etatTest.phase === "chargement" || etatTest.phase === "match",
      aEcheance: () => etatTest.echeance,
      activiteMs: () => etatTest.activite,
      resume: (): ResumeSalle => ({ code: opts.code, hote: opts.hote.nom, format: opts.reglages.format, dureeS: opts.reglages.dureeS, niveauBots: opts.reglages.niveauBots, humains: etatTest.humains, places: etatTest.places }),
      etat: () => ({ code: opts.code, phase: etatTest.phase, reglages: { ...opts.reglages, visible: etatTest.visible } }) as unknown as EtatSalon,
    } as unknown as SalleFausse;
    creees.push(s);
    return s;
  };
  return { creerSalle, creees };
}

const hote = (id = 1) => ({ id, nom: `H${id}` });
type Reg = ReturnType<typeof creerRegistreRocket>;
function registre(sur: Partial<Parameters<typeof creerRegistreRocket>[0]> = {}) {
  const f = fabrique();
  const r = creerRegistreRocket({ sallesMax: 8, matchsMax: 6, sallesParIp: 4, creerSalle: f.creerSalle, graine: 1234, ...sur });
  return { r, f };
}
const creerOk = (r: Reg, ip = "1.1.1.1", t = 0, id = 1) => {
  const x = r.creer(hote(id), REGLAGES_SALON_DEFAUT(), ip, t);
  if (!x.ok) throw new Error(`création refusée : ${x.raison}`);
  return x.salle;
};

describe("registre Rocket : création et codes", () => {
  it("crée une salle avec un code de 4 lettres de l'alphabet, les options du registre et une graine", () => {
    const { r, f } = registre({ dev: true, humainsMin: 1, dureeForceeS: 20 });
    const s = creerOk(r);
    expect(s.code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(f.creees[0].opts).toMatchObject({ dev: true, humainsMin: 1, dureeForceeS: 20, hote: { id: 1, nom: "H1" }, maintenantMs: 0 });
    expect(Number.isInteger(f.creees[0].opts.graine)).toBe(true);
    expect(r.nombre()).toBe(1);
  });
  it("les options facultatives absentes ne sont pas posées", () => {
    const { r, f } = registre();
    creerOk(r);
    expect("dev" in f.creees[0].opts).toBe(false);
    expect("humainsMin" in f.creees[0].opts).toBe(false);
  });
  it("les réglages sont copiés", () => {
    const { r, f } = registre();
    const reglages = REGLAGES_SALON_DEFAUT();
    r.creer(hote(), reglages, "ip", 0);
    reglages.format = "3v3";
    expect(f.creees[0].opts.reglages.format).toBe("1v1");
  });
  it("tous les codes sont uniques (200 salles, plafonds relevés)", () => {
    const { r } = registre({ sallesMax: 500, sallesParIp: 500 });
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) codes.add(creerOk(r, "ip", 0, i).code);
    expect(codes.size).toBe(200);
  });
  it("même graine, mêmes codes (déterministe) ; graines différentes, séquences différentes", () => {
    const a = registre({ graine: 7 }).r, b = registre({ graine: 7 }).r, c = registre({ graine: 8 }).r;
    const sa = [creerOk(a).code, creerOk(a, "2").code], sb = [creerOk(b).code, creerOk(b, "2").code], sc = [creerOk(c).code, creerOk(c, "2").code];
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });
  it("plafond de salles", () => {
    const { r } = registre({ sallesMax: 2, sallesParIp: 10 });
    creerOk(r, "a"); creerOk(r, "b");
    expect(r.creer(hote(3), REGLAGES_SALON_DEFAUT(), "c", 0)).toEqual({ ok: false, raison: "limite" });
  });
  it("plafond de salles par adresse, libéré à la fermeture", () => {
    const { r } = registre({ sallesParIp: 2 });
    const s1 = creerOk(r, "ip"); creerOk(r, "ip");
    expect(r.creer(hote(3), REGLAGES_SALON_DEFAUT(), "ip", 0)).toEqual({ ok: false, raison: "limite" });
    expect(r.creer(hote(4), REGLAGES_SALON_DEFAUT(), "autre", 0).ok).toBe(true);
    r.retirer(s1.code, 10);
    expect(r.creer(hote(5), REGLAGES_SALON_DEFAUT(), "ip", 10).ok).toBe(true);
  });
});

describe("registre Rocket : trouver et anti-énumération", () => {
  it("trouve par code, quelle que soit la casse et les espaces", () => {
    const { r } = registre();
    const s = creerOk(r);
    const x = r.trouver(` ${s.code.toLowerCase()} `, "ip", 0);
    expect(x.ok && x.salle).toBe(s);
  });
  it("code de forme invalide : raison « code », sans compter comme essai", () => {
    const { r } = registre({ essaisCodeParMinute: 2 });
    for (let i = 0; i < 10; i++) expect(r.trouver("zz", "ip", 0)).toEqual({ ok: false, raison: "code" });
    expect(r.trouver("BCDF", "ip", 0)).toEqual({ ok: false, raison: "inconnue" });
  });
  it("code valide mais inconnu : « inconnue », puis « limite » après 20 essais ratés par minute (même pour un code existant)", () => {
    const { r } = registre();
    const s = creerOk(r);
    const faux = s.code === "BCDF" ? "CCCD" : "BCDF";
    for (let i = 0; i < RESEAU.essaisCodeParMinute; i++) expect(r.trouver(faux, "ip", i * 100)).toEqual({ ok: false, raison: "inconnue" });
    expect(r.trouver(s.code, "ip", 3000)).toEqual({ ok: false, raison: "limite" });
    // une autre adresse n'est pas affectée
    expect(r.trouver(s.code, "autre", 3000).ok).toBe(true);
  });
  it("la fenêtre glisse : une minute plus tard, l'adresse retrouve ses essais", () => {
    const { r } = registre({ essaisCodeParMinute: 3 });
    const s = creerOk(r);
    const faux = s.code === "BCDF" ? "CCCD" : "BCDF";
    for (let i = 0; i < 3; i++) r.trouver(faux, "ip", 1000);
    expect(r.trouver(s.code, "ip", 30_000)).toEqual({ ok: false, raison: "limite" });
    expect(r.trouver(s.code, "ip", 61_001).ok).toBe(true);
  });
  it("les recherches réussies ne comptent pas", () => {
    const { r } = registre({ essaisCodeParMinute: 2 });
    const s = creerOk(r);
    for (let i = 0; i < 50; i++) expect(r.trouver(s.code, "ip", i).ok).toBe(true);
  });
});

describe("registre Rocket : liste, actives, nettoyage", () => {
  it("liste les salons visibles et non pleins en phase « salon »", () => {
    const { r, f } = registre({ sallesParIp: 10 });
    const a = creerOk(r, "i", 0, 1);
    creerOk(r, "i", 0, 2); creerOk(r, "i", 0, 3); creerOk(r, "i", 0, 4);
    const e = creerOk(r, "i", 0, 5);
    f.creees[1].etatTest.visible = false;
    f.creees[2].etatTest.humains = 2;
    f.creees[3].etatTest.phase = "match";
    expect(r.lister().map((x) => x.code).sort()).toEqual([a.code, e.code].sort());
  });
  it("actives = salles à échéance (chargement, fin) et pas seulement « match »", () => {
    const { r, f } = registre({ sallesParIp: 10 });
    creerOk(r);
    const b = creerOk(r, "2"), c = creerOk(r, "3");
    f.creees[1].etatTest.phase = "chargement"; f.creees[1].etatTest.echeance = true;
    f.creees[2].etatTest.phase = "fin"; f.creees[2].etatTest.echeance = true;
    expect(r.actives().map((s) => s.code).sort()).toEqual([b.code, c.code].sort());
  });
  it("nombreMatchs compte chargement et match", () => {
    const { r, f } = registre({ sallesParIp: 10 });
    for (let i = 0; i < 4; i++) creerOk(r, "ip", 0, i);
    f.creees[0].etatTest.phase = "chargement"; f.creees[1].etatTest.phase = "match"; f.creees[2].etatTest.phase = "fin";
    expect(r.nombreMatchs()).toBe(2);
  });
  it("nettoyer retire les salles vides et rend les salles retirées", () => {
    const { r, f } = registre();
    const a = creerOk(r), b = creerOk(r, "2");
    f.creees[0].etatTest.humains = 0;
    const retirees = r.nettoyer(1000);
    expect(retirees.map((s) => s.code)).toEqual([a.code]);
    expect(r.nombre()).toBe(1);
    expect(r.trouver(b.code, "x", 1000).ok).toBe(true);
  });
  it("nettoyer referme un salon inactif depuis plus de 10 minutes, mais pas un match", () => {
    const { r, f } = registre({ sallesParIp: 10 });
    const salon = creerOk(r, "i", 0, 1);
    creerOk(r, "i", 0, 2);
    creerOk(r, "i", 0, 3);
    f.creees[1].etatTest.phase = "match";
    f.creees[2].etatTest.activite = RESEAU.salonInactifMs;
    const retirees = r.nettoyer(RESEAU.salonInactifMs + 1);
    expect(retirees.map((s) => s.code)).toEqual([salon.code]);
    expect(r.nombre()).toBe(2);
  });
  it("retirer un code inconnu est sans effet", () => {
    const { r } = registre();
    creerOk(r);
    r.retirer("BCDF", 0);
    expect(r.nombre()).toBe(1);
  });
});

describe("registre Rocket : un code libéré n'est pas réattribué pendant la réserve", () => {
  /**
   * Cherche une graine pour laquelle le registre re-tire, à la salle suivante, le code qu'il vient de libérer (sans réserve). Le hasard du
   * registre étant une pure fonction de la graine, la recherche est déterministe ; elle sert à PROVOQUER la collision que la réserve doit empêcher.
   */
  function graineACollision(): number {
    for (let g = 1; g < 3_000_000; g++) {
      const { r } = registre({ graine: g, codeReserveMs: 0, sallesParIp: 9 });
      const a = creerOk(r, "ip", 0).code;
      r.retirer(a, 0);
      if (creerOk(r, "ip", 0, 2).code === a) return g;
    }
    throw new Error("aucune graine à collision trouvée");
  }
  const g = graineACollision();

  it("sans réserve, la graine choisie réattribue bien le code (contrôle du montage)", () => {
    const { r } = registre({ graine: g, codeReserveMs: 0 });
    const a = creerOk(r, "ip", 0).code;
    r.retirer(a, 0);
    expect(creerOk(r, "ip", 0, 2).code).toBe(a);
  });
  it("avec la réserve par défaut (60 s), le même tirage est refusé puis un autre code est donné", () => {
    const { r } = registre({ graine: g });
    const a = creerOk(r, "ip", 0).code;
    r.retirer(a, 0);
    expect(creerOk(r, "ip", 59_999, 2).code).not.toBe(a);
  });
  it("et le code redevient disponible quand la réserve est écoulée", () => {
    const { r } = registre({ graine: g, codeReserveMs: 1000 });
    const a = creerOk(r, "ip", 0).code;
    r.retirer(a, 0);
    expect(creerOk(r, "ip", 1000, 2).code).toBe(a);
  });
  it("nettoyer purge aussi les réserves échues", () => {
    const { r } = registre({ graine: g, codeReserveMs: 1000 });
    const a = creerOk(r, "ip", 0).code;
    r.retirer(a, 0);
    r.nettoyer(5000);
    expect(creerOk(r, "ip", 5000, 2).code).toBe(a);
  });
});
