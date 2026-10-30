import { describe, expect, it } from "vitest";
import type { AidePoliceBr, ContexteSalle, JoueurSalle, ServiceEvenements } from "./match-contexte";
import { POLICE, type CandidatPolice } from "./police";
import { capablesEnJeu, reglesArene, reglesBr } from "./police-regles";
import type { Vec3 } from "./protocole";

function joueur(id: string, p: Vec3, plus: Partial<JoueurSalle> = {}): JoueurSalle {
  return { id, enJeu: true, vivant: true, p, kills: 0, protegeJusqua: 0, ...plus } as unknown as JoueurSalle;
}
function contexte(js: JoueurSalle[], sansCapacite: string[] = []): ContexteSalle {
  return { joueursEnJeu: () => js.filter((j) => j.enJeu), supportePolice: (id: string) => !sansCapacite.includes(id) } as unknown as ContexteSalle;
}
const cand = (id: string, kills = 0, humain = true): CandidatPolice => ({ id, p: [0, 0, 0], kills, humain });

describe("règles de l'arène", () => {
  it("ecrasable : vivant, en jeu, hors protection, à pied, avec la capacité", () => {
    const a = joueur("a", [0, 0, 0]);
    const r = reglesArene(contexte([a], ["sans"]), () => true, null);
    expect(r.ecrasable(a, 100)).toBe(true);
    expect(r.ecrasable(joueur("b", [0, 0, 0], { vivant: false }), 100)).toBe(false);
    expect(r.ecrasable(joueur("c", [0, 0, 0], { enJeu: false }), 100)).toBe(false);
    expect(r.ecrasable(joueur("d", [0, 0, 0], { protegeJusqua: 500 }), 100)).toBe(false);
    expect(r.ecrasable(joueur("d", [0, 0, 0], { protegeJusqua: 500 }), 500)).toBe(true);
    expect(r.ecrasable(joueur("sans", [0, 0, 0]), 100)).toBe(false);
    expect(reglesArene(contexte([a]), () => false, null).ecrasable(a, 100)).toBe(false);
  });

  it("eligible : à pied et pieds sous 2,2 m (ni toit de bus ni toit de bâtiment)", () => {
    const r = reglesArene(contexte([]), () => true, null);
    expect(r.eligible(joueur("a", [0, POLICE.hauteurMaxCibleM, 0]), 0)).toBe(true);
    expect(r.eligible(joueur("a", [0, POLICE.hauteurMaxCibleM + 0.1, 0]), 0)).toBe(false);
    expect(r.eligible(joueur("a", [0, 3.2, 0]), 0)).toBe(false);
  });

  it("choisirCible : le leader en kills", () => {
    const r = reglesArene(contexte([]), () => true, null);
    expect(r.choisirCible([{ id: "a", p: [0, 0, 0], kills: 1, humain: true }, { id: "b", p: [300, 0, 0], kills: 4, humain: true }], [0, 0, 0], null)).toBe("b");
  });

  it("permis : 2 joueurs capables au moins", () => {
    const js = [joueur("a", [0, 0, 0]), joueur("b", [0, 0, 0])];
    const permis = (ctx: ContexteSalle) => reglesArene(ctx, () => true, null).permis(1000, { candidats: [cand("a", 3)], echeanceT: 0 });
    expect(permis(contexte(js))).toBe(true);
    expect(permis(contexte(js, ["b"]))).toBe(false);
    expect(capablesEnJeu(contexte(js, ["b"]))).toBe(1);
    expect(capablesEnJeu(contexte([...js, joueur("c", [0, 0, 0], { enJeu: false })]))).toBe(2);
  });

  it("permis : un candidat avec un kill, sinon `attendreLeaderMs` après l'échéance ; jamais sans candidat", () => {
    const js = [joueur("a", [0, 0, 0]), joueur("b", [0, 0, 0])];
    const r = reglesArene(contexte(js), () => true, null);
    expect(r.permis(10_000, { candidats: [cand("a", 0), cand("b", 0)], echeanceT: 5_000 })).toBe(false);
    expect(r.permis(5_000 + POLICE.attendreLeaderMs, { candidats: [cand("a", 0), cand("b", 0)], echeanceT: 5_000 })).toBe(true);
    expect(r.permis(10_000, { candidats: [cand("a", 0), cand("b", 1)], echeanceT: 5_000 })).toBe(true);
    expect(r.permis(1e9, { candidats: [], echeanceT: 0 })).toBe(false);
  });

  it("permis : jamais pendant le titan", () => {
    const js = [joueur("a", [0, 0, 0]), joueur("b", [0, 0, 0])];
    const evt = { titanEnCours: () => true } as unknown as ServiceEvenements;
    expect(reglesArene(contexte(js), () => true, evt).permis(1e9, { candidats: [cand("a", 3)], echeanceT: 0 })).toBe(false);
  });
});

describe("règles du Battle Royale", () => {
  function aide(plus: Partial<AidePoliceBr> = {}): AidePoliceBr {
    return {
      phase: () => "jeu", zone: () => ({ centre: [0, 0], rayon: 100 }), vivants: () => 10, premierAtterrissageT: () => 1_000,
      enVol: () => false, estSpectateur: () => false, nbJoueursDepart: () => 12, ...plus,
    };
  }
  const apres = 1_000 + POLICE.br.apresAtterrissageMs;

  it("eligible : au sol (ni avion ni chute), non spectateur, hors invulnérabilité d'atterrissage, DANS la zone courante", () => {
    const ctx = contexte([]);
    const r = reglesBr(ctx, aide({ enVol: (id) => id === "vol", estSpectateur: (id) => id === "spec" }));
    expect(r.eligible(joueur("a", [50, 0, 0]), 100)).toBe(true);
    expect(r.eligible(joueur("vol", [50, 0, 0]), 100)).toBe(false);
    expect(r.eligible(joueur("spec", [50, 0, 0]), 100)).toBe(false);
    expect(r.eligible(joueur("pro", [50, 0, 0], { protegeJusqua: Infinity }), 100)).toBe(false);
    expect(r.eligible(joueur("pro", [50, 0, 0], { protegeJusqua: 200 }), 300)).toBe(true);
    expect(r.eligible(joueur("tempete", [150, 0, 0]), 100)).toBe(false);
    expect(r.eligible(joueur("sans", [50, 0, 0]), 100)).toBe(true);
    expect(reglesBr(contexte([], ["sans"]), aide()).eligible(joueur("sans", [50, 0, 0]), 100)).toBe(false);
  });

  it("l'écrasement s'applique à tout joueur au sol, même hors zone (un bot sur le chemin reste écrasable)", () => {
    const r = reglesBr(contexte([]), aide());
    expect(r.ecrasable(joueur("tempete", [150, 0, 0]), 100)).toBe(true);
  });

  it("choisirCible : l'humain le plus proche de la voiture, avant un bot", () => {
    const r = reglesBr(contexte([]), aide());
    expect(r.choisirCible([{ id: "b", p: [10, 0, 0], kills: 0, humain: false }, { id: "h", p: [80, 0, 0], kills: 0, humain: true }], [0, 0, 0], null)).toBe("h");
  });

  it("permis : phase de jeu, 60 s après le premier atterrissage humain, 4 vivants, un humain candidat", () => {
    const humains = [cand("h", 0, true)];
    const permis = (a: AidePoliceBr, t = apres, c = humains) => reglesBr(contexte([]), a).permis(t, { candidats: c, echeanceT: 0 });
    expect(permis(aide())).toBe(true);
    expect(permis(aide({ phase: () => "vol" }))).toBe(false);
    expect(permis(aide({ premierAtterrissageT: () => null }))).toBe(false);
    expect(permis(aide(), apres - 1)).toBe(false);
    expect(permis(aide({ vivants: () => POLICE.br.vivantsMin - 1 }))).toBe(false);
    expect(permis(aide({ vivants: () => POLICE.br.vivantsMin }))).toBe(true);
    expect(permis(aide(), apres, [cand("b", 0, false)])).toBe(false);
    expect(permis(aide(), apres, [])).toBe(false);
  });

  it("essai (`policeMs`) : délai après atterrissage ramené à `policeMs` (60 s au plus) et 2 vivants suffisent", () => {
    const r = reglesBr(contexte([]), aide({ vivants: () => 2 }), 5_000);
    expect(r.permis(6_000, { candidats: [cand("h")], echeanceT: 0 })).toBe(true);
    expect(r.permis(5_999, { candidats: [cand("h")], echeanceT: 0 })).toBe(false);
    const long = reglesBr(contexte([]), aide({ vivants: () => 2 }), 600_000);
    expect(long.permis(1_000 + POLICE.br.apresAtterrissageMs, { candidats: [cand("h")], echeanceT: 0 })).toBe(true);
  });

  it("pointPermis : un point de départ doit être dans la zone courante (jamais dans la tempête) ; sans zone, tout convient", () => {
    const r = reglesBr(contexte([]), aide());
    expect(r.pointPermis!(60, 60, 0)).toBe(true);
    expect(r.pointPermis!(90, 90, 0)).toBe(false);
    expect(reglesBr(contexte([]), aide({ zone: () => null })).pointPermis!(9999, 0, 0)).toBe(true);
  });
});
