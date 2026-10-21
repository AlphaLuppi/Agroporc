/**
 * « Hop ! » / « Hop là ! » / « Yeehaa ! » : un bond en pleine course, sans s'arrêter. Il se ramasse
 * sur une foulée, s'envole nez en l'air, plane pattes avant tendues comme dans le clip « Attack
 * jump » du modèle (pattes du clip, corps et trajectoire procéduraux : la course continue), pique du
 * nez et se reçoit sur les pattes avant, puis les arrière ; la locomotion reprend les pattes là où
 * elles se posent.
 */
import { DELAI_BULLE } from "../../tigre-reactions";
import { echantillonnerClip } from "../clips";
import { bosse, rampe, impact, oreilles, tete, queue, repos } from "./outils";
import type { Geste, PoseGeste } from "./types";

/** Instants (s) : appel, décollage, réception des pattes avant. */
const APPEL = 0.0, DECOLLE = 0.14, RECOIT = 0.7;
const HAUTEUR = 0.42;
/** Plage du clip « Attack jump » qui donne les pattes en vol (s du clip) : décollage → réception. */
const CLIP_DEBUT = 0.62, CLIP_FIN = 1.95;

export const saut: Geste = {
  duree: 1.0,
  immobile: false,
  evenements: [{ t: DELAI_BULLE.saut / 1000, type: "bulle" }],
  echantillonner(t, ctx) {
    const u = Math.min(1, Math.max(0, (t - DECOLLE) / (RECOIT - DECOLLE)));
    const enVol = t > DECOLLE && t < RECOIT;
    const h = enVol ? HAUTEUR * 4 * u * (1 - u) : 0;
    const ramasse = bosse(t, APPEL, 0.08, 0.1, DECOLLE + 0.04);
    const reception = impact(t, RECOIT, 15, 0.45);
    // Nez en l'air au décollage, à plat au sommet, nez en bas avant la réception.
    const tangage = 0.3 * Math.cos(Math.PI * u) * bosse(t, DECOLLE - 0.08, DECOLLE + 0.06, RECOIT - 0.06, RECOIT + 0.1);
    const deltas: NonNullable<PoseGeste["deltas"]> = {};
    // La tête reste de niveau (elle compense le tangage) et regarde un peu vers nous.
    tete(deltas, 0, 0, 0.6 * tangage + 0.12 * ramasse - 0.1 * reception);
    oreilles(deltas, 0.5 * bosse(t, DECOLLE, DECOLLE + 0.1, RECOIT, RECOIT + 0.2));
    // Queue en balancier : haute au décollage, basse à la réception.
    queue(deltas, 0.4 * Math.cos(Math.PI * u) * bosse(t, DECOLLE - 0.08, DECOLLE + 0.06, RECOIT - 0.06, RECOIT + 0.1));

    // Pattes du clip pendant le vol ; elles sont rendues à la foulée AVANT la réception (le poids
    // suit sa cible avec retard) : la locomotion, qui continue sous le saut, tend les pattes vers
    // le sol et les y pose à sa vitesse, sans traîner au sol des pattes restées en pose de vol.
    const vol = bosse(t, APPEL + 0.04, DECOLLE, RECOIT - 0.3, RECOIT - 0.1);
    const pose: PoseGeste = {
      corps: { dy: h - 0.05 * ramasse - 0.06 * reception, tangage: tangage - 0.08 * ramasse + 0.05 * reception },
      deltas,
      regard: 0.35,
      poids: { corps: 1, cou: 1, tete: 1, oreilles: 1, queue: 1, avG: vol, avD: vol, arG: vol, arD: vol },
    };
    const clip = ctx.clip("Attack jump");
    if (clip) {
      // Pattes du clip, dépliées sur la durée du vol.
      const p = echantillonnerClip(clip, CLIP_DEBUT + (CLIP_FIN - CLIP_DEBUT) * u);
      const os: NonNullable<PoseGeste["os"]> = {};
      for (const r of ["epauleG", "brasG", "mainG", "epauleD", "brasD", "mainD", "hancheG", "cuisseG", "jarretG", "piedG", "hancheD", "cuisseD", "jarretD", "piedD"] as const) {
        const q = p.os?.[r];
        if (q) os[r] = q;
      }
      pose.os = os;
    } else {
      // Sans le clip (tests) : pattes avant tendues devant, arrière derrière puis ramenées.
      const av = repos("mainG"), ar = repos("piedG");
      const z = rampe(u, 0, 0.5);
      pose.pattes = {
        avG: { cible: [av[0], av[1] + 0.06, av[2] + 0.05 + 0.08 * z] },
        avD: { cible: [-av[0], av[1] + 0.06, av[2] + 0.05 + 0.08 * z] },
        arG: { cible: [ar[0], ar[1] + 0.05, ar[2] - 0.08 + 0.06 * z] },
        arD: { cible: [-ar[0], ar[1] + 0.05, ar[2] - 0.08 + 0.06 * z] },
      };
    }
    return pose;
  },
};
