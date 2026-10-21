/**
 * « Quoi ? » / « Grrr ? » / « Miaou. » / « Tu veux ma photo ? » / « J'ai l'air d'un chat ? » :
 * il freine, tourne la TÊTE vers nous (le moteur : la tête devance les épaules, puis le bassin),
 * puis le corps, et s'arrête presque de face. Là, il nous dévisage : tête qui penche d'un côté puis
 * de l'autre, tirée du clip « Curious » du modèle en ADDITIF (l'inclinaison du clip par-dessus le
 * regard vers la caméra, son balayage atténué : il ne détourne pas les yeux), avec la mimique de
 * l'humeur tirée du texte de la bulle (cf. humeurRegard).
 */
import { DELAI_BULLE } from "../../tigre-reactions";
import { echantillonnerClip } from "../clips";
import { bosse, rampe, echelon, impact, bruit, tete, oreilles, gueule, queue, deltasDepuisClip } from "./outils";
import type { Geste, PoseGeste } from "./types";
import type { Role } from "../os";

const OS_CLIP: readonly Role[] = ["cou", "tete", "machoire", "oreilleG", "oreilleD"];
const DUREE = 2.4;

export const regard: Geste = {
  duree: DUREE,
  immobile: true,
  bulleTot: true,
  cap: (sens) => sens * 0.12,
  evenements: [{ t: DELAI_BULLE.regard / 1000, type: "bulle" }],
  echantillonner(t, ctx) {
    const h = ctx.humeur;
    const s = ctx.sens;
    const k = bosse(t, 0, 0.25, DUREE - 0.45, DUREE);
    const deltas: NonNullable<PoseGeste["deltas"]> = {};
    // Petit sursaut de surprise en nous découvrant : menton qui remonte d'un coup, puis se pose.
    const decouvre = impact(t, 0.02, 14, 0.4);
    const bulle = DELAI_BULLE.regard / 1000;
    // Inclinaison de tête : le clip Curious (1,4 → 5,6 s du clip, accéléré), sinon procédurale.
    const curieux = ctx.clip("Curious");
    const gainPenche = h === "grognon" ? 0.4 : h === "fier" ? 0.3 : 1.1;
    if (curieux) {
      const p = echantillonnerClip(curieux, 1.4 + t * 1.75);
      deltasDepuisClip(p, OS_CLIP, [0.5, 0.25, gainPenche], deltas);
    } else {
      tete(deltas, 0, gainPenche * 0.45 * Math.sin(Math.PI * rampe(t, 0.2, 2.0)) * s);
    }
    tete(deltas, 0, 0.05 * bruit(ctx.temps * 0.8, 4), -0.12 * decouvre);
    let tangage = 0, dy = 0, regard = 1;
    switch (h) {
      case "curieux":
        // Oreilles en avant, menton qui se lève sur le « Quoi ? ».
        oreilles(deltas, -0.45);
        tete(deltas, 0, 0, -0.12 * echelon(t, bulle - 0.05, 12, 0.6) * (1 - rampe(t, 1.6, 2.1)));
        break;
      case "grognon":
        // Oreilles plaquées, tête basse, mâchoire qui vibre (le grondement).
        oreilles(deltas, 0.7 * echelon(t, 0.1, 12, 0.7));
        tete(deltas, 0, 0, 0.16 * echelon(t, 0.1, 10, 0.8));
        gueule(deltas, (0.08 + 0.03 * Math.sin(t * 45)) * bosse(t, bulle - 0.05, bulle + 0.05, 1.4, 1.7));
        queue(deltas, 0, 0, 0.5 * Math.sin(t * 9));
        break;
      case "miaou":
        // « Mi-a-ou » : la mâchoire s'ouvre deux fois, oreilles en avant.
        oreilles(deltas, -0.35);
        gueule(deltas, 0.22 * bosse(t, bulle - 0.05, bulle + 0.05, bulle + 0.18, bulle + 0.28) + 0.3 * bosse(t, bulle + 0.32, bulle + 0.42, bulle + 0.55, bulle + 0.75));
        break;
      case "fier":
        // Il prend la pose : poitrail bombé, menton haut, trois quarts « profil photo ».
        tangage = 0.07 * echelon(t, 0.15, 8, 0.7);
        dy = 0.015 * echelon(t, 0.15, 8, 0.7);
        tete(deltas, s * 0.35 * echelon(t, 0.25, 9, 0.6), -0.08 * s, -0.22 * echelon(t, 0.25, 9, 0.6));
        oreilles(deltas, -0.3);
        regard = 1 - 0.5 * rampe(t, 0.3, 0.6);
        break;
      case "vexe": {
        // « J'ai l'air d'un chat ? » : oreilles en arrière, il détourne la tête, puis nous fixe.
        const detourne = bosse(t, 0.5, 0.8, 1.2, 1.5);
        oreilles(deltas, 0.55 * rampe(t, 0.1, 0.4));
        tete(deltas, -s * 0.5 * detourne, 0, -0.12 * detourne);
        regard = 1 - 0.6 * detourne;
        break;
      }
    }
    return {
      corps: { tangage, dy },
      deltas,
      regard,
      poids: { corps: k, cou: k, tete: k, machoire: k, oreilles: k, queue: k },
    };
  },
};
