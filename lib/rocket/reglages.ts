/**
 * Rocket Muche : réglages du joueur (caméra, touches, volume, manette), mémorisés dans `localStorage` sous `pdj-rocket-reglages`.
 *
 * Pur sauf le stockage, injecté (`StockageMinimal`) : aucune lecture ni écriture ne lève jamais d'exception (navigation privée, quota,
 * JSON corrompu, valeurs hors bornes → on retombe sur le défaut champ par champ, jamais sur « tout ou rien »).
 * Contrat : `NormaliserReglages`, `LireReglages`, `EcrireReglages` de `contrat.ts`.
 */
import {
  CAMERA_DEFAUT,
  LIAISONS_DEFAUT,
  REGLAGES_DEFAUT,
  type EcrireReglages,
  type LiaisonsTouches,
  type LireReglages,
  type NormaliserReglages,
  type ParamsCamera,
  type ReglagesRocket,
} from "./contrat";

/** Clé de `localStorage`. */
export const CLE_REGLAGES = "pdj-rocket-reglages";

/** Bornes des réglages de caméra (celles de Rocket League, cf. `ParamsCamera`). */
export const BORNES_CAMERA: Readonly<Record<keyof ParamsCamera, readonly [number, number]>> = {
  fov: [60, 110],
  distance: [1, 4],
  hauteur: [0.4, 2],
  angle: [-15, 0],
  rigidite: [0, 1],
  vitesseRegard: [1, 10],
  vitesseTransition: [1, 2],
};

/** Un code de touche plausible : `KeyW`, `Space`, `ArrowUp`, `Souris2`, `Numpad4`… */
const CODE_VALIDE = /^[A-Za-z][A-Za-z0-9]{0,23}$/;
/** Nombre maximal de touches par action (spec § 8.1 : deux au plus). */
const TOUCHES_PAR_ACTION = 2;

const estObjet = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Nombre fini ramené dans [min, max], ou `defaut`. */
function nombre(x: unknown, [min, max]: readonly [number, number], defaut: number): number {
  if (typeof x !== "number" || !Number.isFinite(x)) return defaut;
  return Math.min(max, Math.max(min, x));
}

function normaliserCamera(brut: unknown): ParamsCamera {
  const b = estObjet(brut) ? brut : {};
  const c = { ...CAMERA_DEFAUT };
  for (const k of Object.keys(BORNES_CAMERA) as (keyof ParamsCamera)[]) c[k] = nombre(b[k], BORNES_CAMERA[k], CAMERA_DEFAUT[k]);
  return c;
}

/** Liste de codes valides, sans doublon, deux au plus ; vide ou invalide → défaut de l'action. */
function normaliserCodes(brut: unknown, defaut: readonly string[]): readonly string[] {
  if (!Array.isArray(brut)) return [...defaut];
  const codes: string[] = [];
  for (const c of brut) if (typeof c === "string" && CODE_VALIDE.test(c) && !codes.includes(c)) codes.push(c);
  return codes.length > 0 ? codes.slice(0, TOUCHES_PAR_ACTION) : [...defaut];
}

function normaliserTouches(brut: unknown): LiaisonsTouches {
  const b = estObjet(brut) ? brut : {};
  const t = { ...LIAISONS_DEFAUT };
  for (const action of Object.keys(LIAISONS_DEFAUT) as (keyof LiaisonsTouches)[]) t[action] = normaliserCodes(b[action], LIAISONS_DEFAUT[action]);
  // Échap reste toujours une façon de mettre en pause : un joueur qui la déliait ne pourrait plus ouvrir le menu
  if (!t.pause.includes("Escape")) t.pause = ["Escape", ...t.pause].slice(0, TOUCHES_PAR_ACTION);
  return t;
}

/** Réglages valides à partir de n'importe quelle valeur lue (JSON de `localStorage`, formulaire) : champ par champ, jamais d'exception. */
export const normaliserReglages: NormaliserReglages = (brut: unknown): ReglagesRocket => {
  const d = REGLAGES_DEFAUT();
  if (!estObjet(brut)) return d;
  return {
    camera: normaliserCamera(brut.camera),
    touches: normaliserTouches(brut.touches),
    balleCamParDefaut: typeof brut.balleCamParDefaut === "boolean" ? brut.balleCamParDefaut : d.balleCamParDefaut,
    volume: nombre(brut.volume, [0, 1], d.volume),
    zoneMorteManette: nombre(brut.zoneMorteManette, [0, 0.4], d.zoneMorteManette),
    inverserTangageManette: typeof brut.inverserTangageManette === "boolean" ? brut.inverserTangageManette : d.inverserTangageManette,
    vibrations: typeof brut.vibrations === "boolean" ? brut.vibrations : d.vibrations,
  };
};

/** Lit les réglages mémorisés (défauts si le stockage est absent, vide ou illisible). */
export const lireReglages: LireReglages = (s) => {
  if (!s) return REGLAGES_DEFAUT();
  try {
    const texte = s.getItem(CLE_REGLAGES);
    if (!texte) return REGLAGES_DEFAUT();
    return normaliserReglages(JSON.parse(texte));
  } catch {
    return REGLAGES_DEFAUT();
  }
};

/** Mémorise les réglages normalisés ; sans effet (et sans erreur) si le stockage refuse. */
export const ecrireReglages: EcrireReglages = (r, s) => {
  if (!s) return;
  try {
    s.setItem(CLE_REGLAGES, JSON.stringify(normaliserReglages(r)));
  } catch {
    /* navigation privée, quota plein : les réglages restent valables pour la partie en cours */
  }
};
