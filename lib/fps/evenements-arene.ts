/**
 * Cadence et variété des événements d'une arène (PUR : le hasard est TOUJOURS un paramètre `alea`, aucune horloge) : facteurs de fréquence, tirage du
 * prochain événement à tour (Truck fou / tigre géant) qui ne se répète pas quand il y a le choix, temps morts, et traduction des `ReglagesArene` d'une
 * partie en `OptionsSalle` (services décochés retirés, intervalles mis à l'échelle). Appelé par `serveur-fps/src/index.ts` à la création d'une arène ;
 * une `Salle` construite sans réglages garde exactement ses options, donc sa séquence de hasard d'avant.
 * Spec : docs/superpowers/specs/2026-10-30-arene-police-evenements-design.md (§3.1)
 */
import { AVION } from "./avion";
import { BUS_C3 } from "./bus-c3";
import { ELSA } from "./elsa";
import type { OptionsSalle } from "./match";
import { EVENEMENTS } from "./monstres";
import { POLICE } from "./police";
import type { TypeEvenement } from "./protocole";
import type { FrequenceEvenements, ReglagesArene } from "./reglages-arene";

/**
 * Facteurs de chaque fréquence : `intervalle` multiplie les délais d'Elsa, de l'avion, du bus et des événements à tour (Chaos = la cadence historique de
 * la v3) ; `tempsMort` = probabilité qu'un événement soit suivi d'un délai double (des plages sans événement) ; `police` multiplie les délais de la
 * descente de police (relatifs à « Normal », qui est la valeur de `POLICE.premier` / `POLICE.entre`).
 */
export const FACTEURS_FREQUENCE = {
  calme: { intervalle: 3, tempsMort: 0.5, police: 2 },
  normal: { intervalle: 1.6, tempsMort: 0.3, police: 1 },
  chaos: { intervalle: 1, tempsMort: 0.1, police: 0.7 },
} as const satisfies Record<FrequenceEvenements, { intervalle: number; tempsMort: number; police: number }>;

/** Les événements à tour, dans l'ordre canonique (celui de la séquence de hasard de la v3). */
const TYPES_A_TOUR: readonly TypeEvenement[] = ["truck", "tigre"];

/**
 * Prochain événement à tour parmi `actifs` (toujours dans l'ordre `["truck", "tigre"]`) : jamais deux fois de suite le même quand il y a le choix ;
 * `null` si rien n'est actif ; un seul actif, il revient. UN seul tirage `Math.floor(alea() * n)`, et seulement quand plusieurs candidats restent :
 * c'est la séquence de la v3 (un tirage pour le tout premier événement, `alea() < 0,5` donne le Truck, puis alternance sans tirage).
 */
export function choisirType(actifs: readonly TypeEvenement[], dernier: TypeEvenement | null, alea: () => number): TypeEvenement | null {
  if (actifs.length === 0) return null;
  if (actifs.length === 1) return actifs[0];
  const candidats = dernier !== null && actifs.includes(dernier) ? actifs.filter((t) => t !== dernier) : actifs;
  if (candidats.length === 1) return candidats[0];
  return candidats[Math.floor(alea() * candidats.length) % candidats.length];
}

/** Un événement qui vient de finir est-il suivi d'un temps mort (un délai supplémentaire) ? */
export function tempsMort(f: FrequenceEvenements, alea: () => number): boolean {
  return alea() < FACTEURS_FREQUENCE[f].tempsMort;
}

/** Intervalle mis à l'échelle de la fréquence (`cle` : `intervalle` pour les services à cadence d'origine, `police` pour la descente de police), arrondi à la milliseconde. */
export function echelleIntervalle(base: { minMs: number; maxMs: number }, f: FrequenceEvenements, cle: "intervalle" | "police" = "intervalle"): { minMs: number; maxMs: number } {
  const k = FACTEURS_FREQUENCE[f][cle];
  return { minMs: Math.round(base.minMs * k), maxMs: Math.round(base.maxMs * k) };
}

/** Événements à tour (Truck fou, tigre géant) activés par les réglages. */
export function typesActifs(r: ReglagesArene): TypeEvenement[] {
  return TYPES_A_TOUR.filter((t) => r.evenements.includes(t));
}

/**
 * Intervalles fixés par une variable d'environnement (`PDJ_FPS_ELSA_*`, `_AVION_*`, `_BUS_*`, `_EVT_*`, `_POLICE_*`) : jamais mis à l'échelle (les tests
 * de bout en bout restent déterministes).
 */
export interface ImposesEnv { elsa?: boolean; avion?: boolean; bus?: boolean; evenements?: boolean; police?: boolean }

/**
 * Options d'une arène pour ces réglages : retire `elsa`, `tigres` (l'avion et le sort d'invocation), `bus`, `evenements` et `police` des cases décochées,
 * fixe les types d'événements à tour et le temps mort, met les intervalles à l'échelle de la fréquence (sauf ceux de `imposes`), la police avec son plancher
 * (`POLICE.plancherMs`). `forcerType` (`PDJ_FPS_EVT_TYPE`) l'emporte sur `types`. Ne modifie pas `base`.
 */
export function optionsDepuisReglages(r: ReglagesArene, base: OptionsSalle, imposes: ImposesEnv = {}): OptionsSalle {
  const f = r.frequence;
  const a = (id: string): boolean => (r.evenements as readonly string[]).includes(id);
  const options: OptionsSalle = { ...base, reglages: { evenements: [...r.evenements], frequence: f } };

  if (!a("elsa")) delete options.elsa;
  else if (base.elsa && !imposes.elsa) {
    options.elsa = { ...base.elsa, intervalle: echelleIntervalle(base.elsa.intervalle ?? { minMs: ELSA.intervalleMinMs, maxMs: ELSA.intervalleMaxMs }, f) };
  }

  if (!a("avion")) delete options.tigres;
  else if (base.tigres && !imposes.avion) {
    options.tigres = { ...base.tigres, intervalle: echelleIntervalle(base.tigres.intervalle ?? { minMs: AVION.intervalleMinMs, maxMs: AVION.intervalleMaxMs }, f) };
  }

  if (!a("bus")) options.bus = false;
  else if (!imposes.bus) {
    const b = base.bus ? base.bus.intervalle : undefined;
    options.bus = { intervalle: echelleIntervalle(b ?? { minMs: BUS_C3.intervalleMinMs, maxMs: BUS_C3.intervalleMaxMs }, f) };
  }

  const types = typesActifs(r);
  if (base.evenements) {
    if (types.length === 0 && !base.evenements.forcerType) delete options.evenements;
    else {
      const e = base.evenements;
      options.evenements = {
        ...e,
        types,
        // un intervalle imposé par l'environnement n'est jamais modifié, temps mort compris (aucun tirage de plus)
        ...(imposes.evenements ? {} : {
          tempsMortP: FACTEURS_FREQUENCE[f].tempsMort,
          premier: echelleIntervalle(e.premier ?? { minMs: EVENEMENTS.premierMinMs, maxMs: EVENEMENTS.premierMaxMs }, f),
          intervalle: echelleIntervalle(e.intervalle ?? { minMs: EVENEMENTS.intervalleMinMs, maxMs: EVENEMENTS.intervalleMaxMs }, f),
        }),
      };
    }
  }

  if (!a("police")) delete options.police;
  else if (base.police) {
    const p = base.police;
    const borne = (b: { minMs: number; maxMs: number }) => {
      const e = echelleIntervalle(b, f, "police");
      const minMs = Math.max(POLICE.plancherMs, e.minMs);
      return { minMs, maxMs: Math.max(minMs, e.maxMs) };
    };
    options.police = {
      ...p,
      ...(imposes.police ? {} : {
        tempsMortP: FACTEURS_FREQUENCE[f].tempsMort,
        intervalle: { premier: borne(p.intervalle?.premier ?? POLICE.premier), entre: borne(p.intervalle?.entre ?? POLICE.entre) },
      }),
    };
  }
  return options;
}
