import { describe, expect, it } from "vitest";
import type { EvenementMatch } from "./contrat";
import { creerAntiSpam, reactionParId } from "./reactions";
import { COOLDOWN_BOT_S, DELAI_MAX_S, ECART_GLOBAL_S, creerReacteurBots, type EnvoiBot, type VoitureReacteur } from "./reactions-bots";

// 2v2 : voitures 0 (humain, bleue), 1 (bot, bleue), 2 et 3 (bots, orange)
const VOITURES: VoitureReacteur[] = [
  { id: 0, equipe: "bleue", bot: false },
  { id: 1, equipe: "bleue", bot: true },
  { id: 2, equipe: "orange", bot: true },
  { id: 3, equipe: "orange", bot: true },
];
const but = (equipe: "bleue" | "orange", marqueur: number | null = null): EvenementMatch => ({ t: "but", equipe, idMarqueur: marqueur, idPasse: null, vitesseKmh: 80 });

/** Joue une longue partie d'événements et rend tout ce que les bots ont dit : (instant, voiture, id). */
function partie(graine: number, evenements: [number, EvenementMatch][], fin = 400, voitures: VoitureReacteur[] = VOITURES): { t: number; idVoiture: number; id: string }[] {
  const r = creerReacteurBots({ graine, voitures });
  const dit: { t: number; idVoiture: number; id: string }[] = [];
  for (let t = 0; t <= fin; t += 0.1) {
    for (const [te, e] of evenements) if (Math.abs(te - t) < 0.05) r.observer([e], t);
    for (const e of r.echeances(t)) dit.push({ t, ...e });
  }
  return dit;
}
const scenario = (): [number, EvenementMatch][] => {
  const ev: [number, EvenementMatch][] = [];
  for (let i = 0; i < 25; i++) {
    const t = 10 + i * 15;
    ev.push([t, but(i % 2 ? "bleue" : "orange", i % 2 ? 1 : 2)]);
    ev.push([t + 5, { t: "demolition", victime: 2, auteur: 1, p: [0, 0, 0] }]);
    ev.push([t + 7, { t: "arret", idVoiture: 3 }]);
    ev.push([t + 9, { t: "coupDEnvoi" }]);
  }
  return ev;
};

describe("réacteur de bots", () => {
  it("déterministe : même graine, mêmes événements → exactement les mêmes réactions", () => {
    expect(partie(7, scenario())).toEqual(partie(7, scenario()));
    expect(partie(7, scenario()).length).toBeGreaterThan(5);
  });
  it("une autre graine donne un autre bavardage", () => {
    expect(partie(7, scenario())).not.toEqual(partie(8, scenario()));
  });
  it("ne dit que des réactions du catalogue, par des BOTS jamais par l'humain", () => {
    const dit = partie(3, scenario());
    for (const d of dit) {
      expect(reactionParId(d.id), d.id).toBeDefined();
      expect(VOITURES[d.idVoiture].bot, `voiture ${d.idVoiture}`).toBe(true);
    }
  });
  it("réagit après un délai, jamais sur l'instant même de l'événement", () => {
    const dit = partie(5, scenario());
    for (const d of dit) {
      const evenementPrecedent = Math.max(...scenario().map(([t]) => t).filter((t) => t <= d.t));
      expect(d.t - evenementPrecedent).toBeGreaterThan(0.4);
      expect(d.t - evenementPrecedent).toBeLessThan(DELAI_MAX_S + 20); // bornée par le cooldown, jamais instantanée
    }
  });
  it("silences : un bot se tait `COOLDOWN_BOT_S`, l'ensemble des bots `ECART_GLOBAL_S`", () => {
    const dit = partie(11, scenario());
    for (let i = 1; i < dit.length; i++) expect(dit[i].t - dit[i - 1].t, `écart ${i}`).toBeGreaterThanOrEqual(ECART_GLOBAL_S - 0.11);
    const dernier = new Map<number, number>();
    for (const d of dit) {
      const avant = dernier.get(d.idVoiture);
      if (avant !== undefined) expect(d.t - avant).toBeGreaterThanOrEqual(COOLDOWN_BOT_S - 0.11);
      dernier.set(d.idVoiture, d.t);
    }
  });
  it("respecte le même anti-spam que les humains, sur une rafale d'événements", () => {
    const r = creerReacteurBots({ graine: 1, voitures: VOITURES });
    const ev: EvenementMatch[] = [];
    for (let i = 0; i < 40; i++) ev.push(but(i % 2 ? "bleue" : "orange", i % 2 ? 1 : 2));
    r.observer(ev, 0);
    const dites: EnvoiBot[] = [];
    for (let t = 0; t < 4; t += 0.05) dites.push(...r.echeances(t));
    // en 4 s : au plus `ceil(4 / ECART_GLOBAL_S)` réactions, loin des 40 événements
    expect(dites.length).toBeLessThanOrEqual(Math.ceil(4 / ECART_GLOBAL_S));
    const a = creerAntiSpam();
    for (const _ of dites) expect(a.essayer(0)).toBe(true);
  });
  it("les infos d'équipe viennent d'un allié : un bot adverse ne parle jamais « à l'équipe » de l'humain", () => {
    // coup d'envoi : chaque bot dit une info à SA propre équipe (le serveur ne la relaie qu'à elle)
    for (let g = 0; g < 30; g++) {
      for (const d of partie(g, [[1, { t: "coupDEnvoi" }]], 20)) {
        expect(reactionParId(d.id)?.categorie).toBe("infos");
        expect(VOITURES[d.idVoiture].bot).toBe(true);
      }
    }
  });
  it("un but fait réagir : le buteur bot se vante, ses coéquipiers le félicitent, la défense s'excuse", () => {
    const vus = new Set<string>();
    for (let g = 0; g < 80; g++) for (const d of partie(g, [[1, but("orange", 2)]], 30)) vus.add(`${VOITURES[d.idVoiture].equipe}:${reactionParId(d.id)?.categorie}`);
    expect(vus.has("orange:reactions") || vus.has("orange:compliments")).toBe(true);
    expect(vus.has("bleue:excuses")).toBe(true);
  });
  it("sans bot (1v1 humain contre humain) : jamais rien", () => {
    const humains: VoitureReacteur[] = [{ id: 0, equipe: "bleue", bot: false }, { id: 1, equipe: "orange", bot: false }];
    expect(partie(2, scenario(), 400, humains)).toEqual([]);
  });
  it("un humain remplacé par un bot (champ `bot` modifié en cours de match) se met à parler", () => {
    const voitures: VoitureReacteur[] = [{ id: 0, equipe: "bleue", bot: false }, { id: 1, equipe: "orange", bot: false }];
    const r = creerReacteurBots({ graine: 4, voitures });
    voitures[1].bot = true;
    let dit = 0;
    for (let k = 0; k < 40 && dit === 0; k++) {
      r.observer([but("bleue", 0)], k * 30);
      for (let t = k * 30; t < k * 30 + 29; t += 0.1) dit += r.echeances(t).length;
    }
    expect(dit).toBeGreaterThan(0);
  });
  it("réinitialiser vide la file et les silences", () => {
    const r = creerReacteurBots({ graine: 9, voitures: VOITURES });
    for (let i = 0; i < 20; i++) r.observer([but("bleue", 1)], 0);
    expect(r.enAttente()).toBeGreaterThan(0);
    r.reinitialiser();
    expect(r.enAttente()).toBe(0);
    expect(r.echeances(100)).toEqual([]);
  });
  it("n'utilise jamais l'horloge ni le hasard globaux (Math.random, Date.now)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./reactions-bots.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now|new Date/);
  });
});
