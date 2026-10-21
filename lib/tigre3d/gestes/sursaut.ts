/**
 * « Aaah ! » / « Wouh ! » / « !? » : le chat effrayé. En pleine course il se fige (sursaut de tout
 * le corps, tête rentrée, oreilles plaquées, il nous regarde), puis bondit à la verticale, dos rond,
 * pattes raides, queue hérissée, et fait demi-tour EN L'AIR : il retombe tourné vers l'autre bord
 * (événement « volteface » : le tour sur lui-même passe dans les caps du corps) et l'animateur le
 * fait filer à l'éclair. Pas de piétinement de demi-tour : il n'a pas le temps, il a peur.
 */
import { DELAI_BULLE } from "../../tigre-reactions";
import { bosse, rampe, lisse, echelon, impact, oreilles, tete, ajouter, queue, solVersCorps, extremiteMonde, repos } from "./outils";
import type { CorpsGeste } from "./outils";
import type { Geste, PoseGeste } from "./types";
import type { Patte } from "../os";

/** Décollage, retombée (s depuis le début du geste) ; le tour sur lui-même couvre l'envol. */
const DECOLLE = 0.16, RETOMBE = 0.7;
/** Fin du tour (s) : la volte-face est reportée sur les caps à cet instant. */
const VOLTE = 0.74;
const HAUTEUR = 0.4;

const PATTES: Patte[] = ["avG", "avD", "arG", "arD"];
const EXTREMITE: Record<Patte, "mainG" | "mainD" | "piedG" | "piedD"> = { avG: "mainG", avD: "mainD", arG: "piedG", arD: "piedD" };

export const sursaut: Geste = {
  duree: 0.95,
  immobile: false,
  freine: true,
  evenements: [{ t: DELAI_BULLE.sursaut / 1000, type: "bulle" }, { t: VOLTE, type: "volteface" }],
  echantillonner(t, ctx) {
    // Vol balistique : montée rapide, sommet, chute (parabole), puis amorti à la réception.
    const u = Math.min(1, Math.max(0, (t - DECOLLE) / (RETOMBE - DECOLLE)));
    const vol = t > DECOLLE && t < RETOMBE ? 4 * u * (1 - u) : 0;
    // Il se ramasse d'un coup (sursaut), puis s'écrase à la réception.
    const tasse = -0.05 * bosse(t, 0, 0.06, 0.1, DECOLLE) - 0.06 * impact(t, RETOMBE, 16, 0.45);
    // Tour sur lui-même pendant le vol, en passant face à nous (on voit sa frayeur, pas son dos).
    const tour = t < VOLTE ? -ctx.sens * Math.PI * lisse((t - DECOLLE + 0.06) / (VOLTE - DECOLLE + 0.06)) : 0;
    const peur = bosse(t, 0, 0.05, 0.75, 0.95);
    const dosRond = bosse(t, 0.02, 0.14, 0.6, 0.85);
    const co: CorpsGeste = { dy: HAUTEUR * vol + tasse, lacet: tour, tangage: 0.08 * Math.sin(Math.PI * u) * (t > DECOLLE ? 1 : 0) - 0.04 * dosRond * (1 - u) };

    const deltas: NonNullable<PoseGeste["deltas"]> = {};
    // Dos rond (chat d'Halloween) : thorax et lombaires cambrés vers le haut.
    ajouter(deltas, "thorax", [-0.22 * dosRond, 0, 0]);
    ajouter(deltas, "lombaires", [-0.26 * dosRond, 0, 0]);
    // Tête rentrée, oreilles plaquées, mâchoire qui tombe (« Aaah ! »).
    tete(deltas, 0, 0, -0.18 * echelon(t, 0, 20, 0.4) * (1 - rampe(t, 0.6, 0.9)));
    oreilles(deltas, 1.0 * peur);
    ajouter(deltas, "machoire", [0.3 * bosse(t, 0.02, 0.08, 0.35, 0.55), 0, 0]);
    // Queue hérissée, dressée en point d'interrogation.
    queue(deltas, 0.9 * dosRond, 0, 0.3 * dosRond * Math.sin(t * 20));

    // Pattes : raides sous le corps en l'air, puis posées au sol à la réception (dans le repère du
    // corps qui tourne : elles tournent avec lui), les avant un peu écartées pour amortir.
    const pattes: NonNullable<PoseGeste["pattes"]> = {};
    const sol = rampe(t, RETOMBE - 0.12, RETOMBE);
    for (const p of PATTES) {
      const r = repos(EXTREMITE[p]);
      const raide: [number, number, number] = [r[0] * 1.15, r[1] - 0.025, r[2] + (p.startsWith("av") ? 0.02 : -0.02)];
      const auSol = solVersCorps({ ...co, lacet: 0 }, [r[0] * 1.15, r[1], r[2]]);
      pattes[p] = {
        cible: [raide[0] + (auSol[0] - raide[0]) * sol, raide[1] + (auSol[1] - raide[1]) * sol, raide[2] + (auSol[2] - raide[2]) * sol],
        extremite: extremiteMonde({ ...co, lacet: 0 }, [0.35 * (1 - sol) * (p.startsWith("av") ? 1 : -1), 0, 0]),
      };
    }
    const libres = bosse(t, 0.04, DECOLLE, 0.8, 0.95);
    const k = bosse(t, 0, 0.04, 0.8, 0.95);
    return {
      corps: co,
      deltas,
      pattes,
      // Il nous regarde au sursaut, puis regarde où il fuit (le regard ne connaît pas le tour en l'air).
      regard: 1 - rampe(t, DECOLLE, DECOLLE + 0.12),
      poids: { corps: 1, colonne: k, queue: k, oreilles: k, cou: k, tete: k, machoire: k, avG: libres, avD: libres, arG: libres, arD: libres },
    };
  },
};
