/**
 * Rocket Muche : réglages du joueur (caméra, touches du clavier et de la souris, boutons de la manette, volume, manette), mémorisés dans `localStorage` sous `pdj-rocket-reglages`.
 *
 * Pur sauf le stockage, injecté (`StockageMinimal`) : aucune lecture ni écriture ne lève jamais d'exception (navigation privée, quota,
 * JSON corrompu, valeurs hors bornes → on retombe sur le défaut champ par champ, jamais sur « tout ou rien »).
 * Contrat : `NormaliserReglages`, `LireReglages`, `EcrireReglages` de `contrat.ts`.
 */
import {
  CAMERA_DEFAUT,
  LIAISONS_DEFAUT,
  LIAISONS_MANETTE_DEFAUT,
  REGLAGES_DEFAUT,
  type EcrireReglages,
  type LiaisonsManette,
  type LiaisonsTouches,
  type LireReglages,
  type NormaliserReglages,
  type ParamsCamera,
  type ReglagesRocket,
} from "./contrat";
import { BOUTON_PAUSE, BOUTON_REJOUER, TOUCHE_PAUSE, conflitManette, conflitTouches, entreeManetteValide, estBoutonSouris, type ActionManette, type ActionTouche } from "./liaisons";

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

/**
 * Liste de codes valides, sans doublon, deux au plus. Une liste ABSENTE ou dont rien n'est valide retombe sur le défaut de l'action ; une liste
 * VIDE est un choix du joueur (il a effacé les liaisons de l'action) et reste vide.
 */
function normaliserCodes(brut: unknown, defaut: readonly string[], valide: (c: unknown) => c is string): readonly string[] {
  if (!Array.isArray(brut)) return [...defaut];
  if (brut.length === 0) return [];
  const codes: string[] = [];
  for (const c of brut) if (valide(c) && !codes.includes(c)) codes.push(c);
  return codes.length > 0 ? codes.slice(0, TOUCHES_PAR_ACTION) : [...defaut];
}
const codeTouche = (c: unknown): c is string => typeof c === "string" && CODE_VALIDE.test(c);

/**
 * La pause garde son entrée de secours en PREMIER emplacement (Échap au clavier, Start à la manette) ; aucune autre action ne la garde :
 * elle est réservée, sinon un joueur qui la déliait ne pourrait plus ouvrir le menu. `inerte` écarte ce que la pause ne peut pas lire (un
 * bouton de souris) ou ne doit pas prendre (A, qui relance le match).
 */
function avecPauseReservee<L extends { pause: readonly string[] }>(l: L, secours: string, inerte: (c: string) => boolean): L {
  const res: Record<string, readonly string[]> = { ...l };
  for (const k of Object.keys(res)) if (k !== "pause") res[k] = res[k].filter((c) => c !== secours);
  res.pause = [secours, ...l.pause.filter((c) => c !== secours && !inerte(c))].slice(0, TOUCHES_PAR_ACTION);
  return res as unknown as L;
}

/**
 * Une action ABSENTE du JSON mémorisé (réglages d'avant son ajout : les réactions rapides par exemple) reçoit son défaut, mais jamais une
 * entrée que le joueur a donnée à une autre action : ce qu'il a choisi l'emporte sur le défaut d'une nouveauté. Les actions présentes ne sont pas touchées.
 */
function sansEntreesPrises<A extends string>(
  res: Record<A, readonly string[]>,
  brut: Record<string, unknown>,
  actions: readonly A[],
  enConflit: (a: A, b: A) => boolean,
): void {
  const presentes = actions.filter((a) => Array.isArray(brut[a]));
  if (presentes.length === 0 || presentes.length === actions.length) return;
  for (const a of actions) {
    if (Array.isArray(brut[a])) continue;
    res[a] = res[a].filter((c) => !presentes.some((b) => enConflit(a, b) && res[b].includes(c)));
  }
}

function normaliserTouches(brut: unknown): LiaisonsTouches {
  const b = estObjet(brut) ? brut : {};
  const actions = Object.keys(LIAISONS_DEFAUT) as ActionTouche[];
  const t = { ...LIAISONS_DEFAUT };
  for (const action of actions) t[action] = normaliserCodes(b[action], LIAISONS_DEFAUT[action], codeTouche);
  sansEntreesPrises(t, b, actions, conflitTouches);
  return avecPauseReservee(t, TOUCHE_PAUSE, estBoutonSouris);
}

function normaliserManette(brut: unknown): LiaisonsManette {
  const b = estObjet(brut) ? brut : {};
  const actions = Object.keys(LIAISONS_MANETTE_DEFAUT) as ActionManette[];
  const m = { ...LIAISONS_MANETTE_DEFAUT };
  for (const action of actions) m[action] = normaliserCodes(b[action], LIAISONS_MANETTE_DEFAUT[action], entreeManetteValide);
  sansEntreesPrises(m, b, actions, conflitManette);
  return avecPauseReservee(m, BOUTON_PAUSE, (c) => c === BOUTON_REJOUER);
}

/** Réglages valides à partir de n'importe quelle valeur lue (JSON de `localStorage`, formulaire) : champ par champ, jamais d'exception. */
export const normaliserReglages: NormaliserReglages = (brut: unknown): ReglagesRocket => {
  const d = REGLAGES_DEFAUT();
  if (!estObjet(brut)) return d;
  return {
    camera: normaliserCamera(brut.camera),
    touches: normaliserTouches(brut.touches),
    liaisonsManette: normaliserManette(brut.liaisonsManette),
    balleCamParDefaut: typeof brut.balleCamParDefaut === "boolean" ? brut.balleCamParDefaut : d.balleCamParDefaut,
    volume: nombre(brut.volume, [0, 1], d.volume),
    zoneMorteManette: nombre(brut.zoneMorteManette, [0, 0.4], d.zoneMorteManette),
    inverserTangageManette: typeof brut.inverserTangageManette === "boolean" ? brut.inverserTangageManette : d.inverserTangageManette,
    vibrations: typeof brut.vibrations === "boolean" ? brut.vibrations : d.vibrations,
    reactionsAdversaires: typeof brut.reactionsAdversaires === "boolean" ? brut.reactionsAdversaires : d.reactionsAdversaires,
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
