/**
 * Charge de la salle Rocket (spec § 10) : six salles 3v3 (deux humains + quatre bots all-star) simulées 60 s de temps virtuel, réveils de 8 ms comme
 * le minuteur du serveur. À lancer SEUL (`npx vitest run lib/rocket/reseau/salle.charge.test.ts`) : les mesures de temps se faussent quand d'autres
 * fichiers de test tournent en parallèle.
 *
 * Critères : tic moyen < 1 ms, instantané ≤ 3,3 ko. Les maxima sont rapportés (JIT à froid, ramasse-miettes) mais ne sont pas bloquants.
 */
import { describe, expect, it } from "vitest";
import { creerSalleRocket } from "./salle";
import { encoderSnap } from "./serialisation";
import { REGLAGES_SALON_DEFAUT, RESEAU } from "./protocole";
import type { EntreesQuantifiees, SalleRocket, SnapRocket } from "./protocole";

const SALLES = 6;
const DUREE_S = 60;

interface Banc {
  salle: SalleRocket;
  numero: number;
}

function creerBanc(i: number): Banc {
  const salle = creerSalleRocket({
    code: "BCDF", hote: { id: 1, nom: `Alice${i}` }, reglages: { ...REGLAGES_SALON_DEFAUT(), format: "3v3", niveauBots: "allstar" }, graine: 100 + i, maintenantMs: 0,
  });
  salle.rejoindre({ id: 2, nom: `Bob${i}` }, 0);
  const sorties = salle.recevoir(1, { t: "lancer" }, 0);
  const debut = sorties.flatMap((s) => ("msg" in s && s.msg.t === "debut" && s.a === 1 ? [s.msg] : []))[0];
  salle.recevoir(1, { t: "pret" }, 0);
  salle.recevoir(2, { t: "pret" }, 0);
  expect(salle.phase).toBe("match");
  return { salle, numero: debut.numero };
}

/** Entrées de conduite pseudo-aléatoires mais déterministes (une trame de 12 ticks contigus). */
function trame(tickDebut: number, graine: number): EntreesQuantifiees[] {
  return Array.from({ length: 12 }, (_, i) => {
    const k = tickDebut + i + graine;
    return {
      accel: 127, direction: ((Math.floor(k / 40) % 3) - 1) * 100, tangage: 0, lacet: 0, roulis: 0,
      saut: k % 97 === 0, boost: (Math.floor(k / 60) % 2) === 0, derapage: false,
    };
  });
}

describe("charge : six salles 3v3 pendant 60 s", () => {
  it("tic moyen < 1 ms, instantané ≤ 3,3 ko, aucun pas perdu", () => {
    const bancs = Array.from({ length: SALLES }, (_, i) => creerBanc(i));
    const duree: number[] = [];
    let maxOctets = 0, snapsTotal = 0, octetsTotal = 0, encodageMs = 0;
    const periodes = Math.floor((DUREE_S * 1000) / RESEAU.periodeMinuteurServeurMs);
    for (let p = 1; p <= periodes; p++) {
      const t = p * RESEAU.periodeMinuteurServeurMs;
      for (const b of bancs) {
        // les deux humains envoient une trame de 12 entrées toutes les ~96 ms (tous les 12 réveils), en avance de 6 ticks sur le monde
        if (p % 12 === 0) {
          const tick = b.salle.monde()!.tick;
          for (const id of [1, 2]) b.salle.recevoirEntrees(id, { numero: b.numero, tickDebut: tick + 2, snapRecu: 0, entrees: trame(tick + 2, id) }, t);
        }
        const t0 = performance.now();
        const sorties = b.salle.tic(t);
        duree.push(performance.now() - t0);
        for (const s of sorties) {
          if (!("snap" in s)) continue;
          const e0 = performance.now();
          const octets = encoderSnap(s.snap as SnapRocket).length;
          encodageMs += performance.now() - e0;
          maxOctets = Math.max(maxOctets, octets);
          octetsTotal += octets;
          snapsTotal++;
        }
      }
    }
    const moyenne = duree.reduce((a, x) => a + x, 0) / duree.length;
    const tries = [...duree].sort((a, b) => a - b);
    const p99 = tries[Math.floor(tries.length * 0.99)];
    // eslint-disable-next-line no-console
    console.log(
      `charge salle : ${SALLES} salles 3v3, ${DUREE_S} s : tic moyen ${(moyenne * 1000).toFixed(0)} µs, p99 ${(p99 * 1000).toFixed(0)} µs, max ${(tries.at(-1)! * 1000).toFixed(0)} µs ; ` +
      `${snapsTotal} instantanés, ${(octetsTotal / snapsTotal).toFixed(0)} o en moyenne, max ${maxOctets} o ; encodage ${((encodageMs / snapsTotal) * 1000).toFixed(0)} µs par instantané`,
    );
    expect(moyenne).toBeLessThan(1);
    // 3000 avant la physique de RocketSim (#100), dont l'état caché (pneus, contacts, bumps) pèse ≈ 110 o de plus par voiture : 3062 o mesurés au pire
    expect(maxOctets).toBeLessThanOrEqual(3300);
    for (const b of bancs) {
      const m = b.salle.mesures();
      expect(m.tempsAbandonneMs).toBe(0);
      // 60 s de temps virtuel = 7 200 pas (à un pas près : l'accumulateur garde le reste)
      expect(m.pas).toBeGreaterThanOrEqual(DUREE_S * 120 - 2);
      expect(m.pas).toBeLessThanOrEqual(DUREE_S * 120 + 2);
      expect(b.salle.monde()!.voitures).toHaveLength(6);
    }
    // 20 instantanés par seconde et par humain
    expect(snapsTotal / (SALLES * 2 * DUREE_S)).toBeGreaterThan(18);
    expect(snapsTotal / (SALLES * 2 * DUREE_S)).toBeLessThan(23);
  }, 120_000);
});
