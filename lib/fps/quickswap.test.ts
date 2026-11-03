import { describe, expect, it } from "vitest";
import {
  CHANGEMENT_ARME, DEGAINE_MS, abaissementChangement, changerArme, chargeurInsere, delaiAnnulation, estAnnulation, poseSortie,
  type DemandeChangement,
} from "./quickswap";
import { JEU } from "./protocole";

const aller = (t: number, pretActuel = 0): DemandeChangement =>
  ({ depuis: "principale", armeDepuis: "fusil_assaut", vers: "secondaire", armeVers: "pistolet", t, pretActuel });
const retour = (t: number, pretActuel: number, margeMs?: number): DemandeChangement =>
  ({ depuis: "secondaire", armeDepuis: "pistolet", vers: "principale", armeVers: "fusil_assaut", t, pretActuel, margeMs });

describe("quickswap : changement en deux temps", () => {
  it("un changement simple dure toujours JEU.degainageMs (350 ms) : rengainer puis dégainer", () => {
    expect(CHANGEMENT_ARME.rengaineMs + DEGAINE_MS).toBe(JEU.degainageMs);
    const r = changerArme(null, aller(1000));
    expect(r).toMatchObject({ annule: false, pret: 1000 + JEU.degainageMs, depart: 0 });
    expect(r.changement).toEqual({ depuis: "principale", armeDepuis: "fusil_assaut", debut: 1000, fin: 1350, pretDepuis: 0 });
  });

  it("abaissement de l'arme visible : la quittée descend (0 → 1), puis la nouvelle monte (1 → 0)", () => {
    const ch = changerArme(null, aller(0)).changement!;
    expect(abaissementChangement(ch, 0)).toBe(0);
    expect(abaissementChangement(ch, 70)).toBeCloseTo(0.5, 5);
    expect(abaissementChangement(ch, 140)).toBeCloseTo(1, 5);
    expect(abaissementChangement(ch, 140 + DEGAINE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(abaissementChangement(ch, 350)).toBe(0);
    expect(abaissementChangement(ch, 900)).toBe(0);
  });
});

describe("quickswap : swap cancel", () => {
  it("retour à l'arme quittée pendant le changement : prête en 50 à 120 ms selon sa hauteur, pas de nouvel aller-retour", () => {
    const ch = changerArme(null, aller(0)).changement!;
    const tot = changerArme(ch, retour(10, ch.fin));
    expect(tot.annule).toBe(true);
    expect(tot.pret).toBeCloseTo(10 + delaiAnnulation(10 / 140), 5);
    expect(tot.changement).toBeNull();
    const bas = changerArme(ch, retour(140, ch.fin));
    expect(bas.pret).toBeCloseTo(140 + CHANGEMENT_ARME.annulationMaxMs, 5);
    expect(bas.depart).toBeCloseTo(1, 5);
    // toujours bien plus tôt qu'un nouveau dégainage complet
    for (const t of [0, 50, 140, 250, 349]) {
      const r = changerArme(ch, retour(t, ch.fin));
      expect(r.annule).toBe(true);
      expect(r.pret - t).toBeGreaterThanOrEqual(CHANGEMENT_ARME.annulationMinMs);
      expect(r.pret - t).toBeLessThanOrEqual(CHANGEMENT_ARME.annulationMaxMs);
    }
  });

  it("délai proportionnel à l'abaissement, borné", () => {
    expect(delaiAnnulation(0)).toBe(CHANGEMENT_ARME.annulationMinMs);
    expect(delaiAnnulation(1)).toBe(CHANGEMENT_ARME.annulationMaxMs);
    expect(delaiAnnulation(0.5)).toBe(85);
    expect(delaiAnnulation(-3)).toBe(50);
    expect(delaiAnnulation(9)).toBe(120);
  });

  it("pas d'annulation : après la fin (sauf marge du serveur), vers une troisième arme, arme du slot changée, autre sortie entre-temps", () => {
    const ch = changerArme(null, aller(0)).changement!;
    expect(estAnnulation(ch, retour(350, ch.fin))).toBe(false);
    const limite = ch.fin + CHANGEMENT_ARME.margeServeurMs;
    expect(estAnnulation(ch, retour(limite - 1, ch.fin, CHANGEMENT_ARME.margeServeurMs))).toBe(true);
    expect(estAnnulation(ch, retour(limite, ch.fin, CHANGEMENT_ARME.margeServeurMs))).toBe(false);
    expect(estAnnulation(ch, { ...retour(100, ch.fin), vers: "couteau", armeVers: "couteau" })).toBe(false);
    expect(estAnnulation(ch, { ...retour(100, ch.fin), armeVers: "sniper" })).toBe(false); // butin échangé (BR)
    expect(estAnnulation(ch, retour(100, 900))).toBe(false); // apparition, achat, spéciale épuisée : autre `sortieFin`
    expect(estAnnulation(null, retour(100, 350))).toBe(false);
    expect(estAnnulation(ch, retour(-1, ch.fin))).toBe(false);
  });

  it("anti-triche : un aller-retour ne saute pas le dégainage en cours de l'arme d'origine", () => {
    // l'arme d'origine se dégainait jusqu'à 1350 quand on l'a quittée à 1010
    const ch = changerArme(null, aller(1010, 1350)).changement!;
    const r = changerArme(ch, retour(1020, ch.fin));
    expect(r.annule).toBe(true);
    expect(r.pret).toBe(1350);
  });

  it("pas d'annulation en chaîne : le changement suivant est un changement simple", () => {
    const ch = changerArme(null, aller(0)).changement!;
    const r = changerArme(ch, retour(20, ch.fin));
    const s = changerArme(r.changement, aller(30, r.pret));
    expect(s.annule).toBe(false);
    expect(s.pret).toBe(30 + JEU.degainageMs);
  });
});

describe("quickswap : reload cancel et animation", () => {
  it("le chargeur est inséré à 75 % du rechargement", () => {
    expect(chargeurInsere(0.74)).toBe(false);
    expect(chargeurInsere(0.75)).toBe(true);
    expect(chargeurInsere(1)).toBe(true);
  });

  it("poseSortie : arme quittée visible pendant le rengainage, continuité au swap cancel (aucun saut)", () => {
    const anim = { genre: "changement" as const, debut: 0, fin: 350, armeQuittee: "fusil_assaut" as const };
    expect(poseSortie(anim, 0)).toEqual({ quittee: true, abaissement: 0 });
    expect(poseSortie(anim, 100).quittee).toBe(true);
    expect(poseSortie(anim, 141).quittee).toBe(false);
    expect(poseSortie(anim, 350)).toEqual({ quittee: false, abaissement: 0 });
    for (const t of [30, 100, 200, 300]) {
      const ch = changerArme(null, aller(0)).changement!;
      const r = changerArme(ch, retour(t, ch.fin));
      const avant = poseSortie(anim, t).abaissement;
      // le client passe l'abaissement VISIBLE (celui de `poseSortie`) comme départ de la remontée
      const apres = poseSortie({ genre: "retour", debut: t, fin: r.pret, depart: avant }, t).abaissement;
      expect(apres).toBeCloseTo(avant, 5);
      expect(poseSortie({ genre: "retour", debut: t, fin: r.pret, depart: avant }, r.pret).abaissement).toBe(0);
    }
    expect(poseSortie({ genre: "sortie", debut: 0, fin: 350 }, 0).abaissement).toBe(1);
    expect(poseSortie(null, 0)).toEqual({ quittee: false, abaissement: 0 });
  });

  it("changements enchaînés : l'arme quittée repart de sa hauteur visible, sans remonter d'un coup", () => {
    // A → B à 0, puis B → C à 250 alors que B remonte (hors annulation) : B redescend de là où elle est
    const ab = { genre: "changement" as const, debut: 0, fin: 350, armeQuittee: "fusil_assaut" as const };
    const visible = poseSortie(ab, 250).abaissement;
    expect(visible).toBeGreaterThan(0.2);
    const bc = { genre: "changement" as const, debut: 250, fin: 600, armeQuittee: "pistolet" as const, depart: visible };
    expect(poseSortie(bc, 250)).toEqual({ quittee: true, abaissement: visible });
    // la descente est monotone jusqu'en bas, puis C monte
    let prec = visible;
    for (let t = 260; t < 390; t += 10) {
      const p = poseSortie(bc, t);
      expect(p.quittee).toBe(true);
      expect(p.abaissement).toBeGreaterThanOrEqual(prec - 1e-9);
      prec = p.abaissement;
    }
    expect(poseSortie(bc, 391)).toMatchObject({ quittee: false });
    expect(poseSortie(bc, 391).abaissement).toBeCloseTo(1, 1);
    // sans `depart` : comme avant (en joue au départ)
    expect(poseSortie(ab, 0).abaissement).toBe(0);
  });
});
