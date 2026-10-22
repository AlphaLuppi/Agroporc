/**
 * Touches de l'arène, modifiables par le joueur et gardées dans le navigateur (PUR : ni DOM ni
 * three ; le stockage est injecté). Une touche est un `KeyboardEvent.code` (position physique :
 * `KeyW` est le Z d'un clavier AZERTY) ou un bouton de souris `Souris0` (gauche), `Souris1`
 * (milieu), `Souris2` (droit), `Souris3` / `Souris4` (boutons latéraux).
 * Chaque action a deux emplacements ; une touche ne sert qu'à une action à la fois.
 * Échap n'est jamais assignable : elle libère toujours la souris (menu pause).
 */

export type Action =
  | "avant" | "arriere" | "gauche" | "droite"
  | "saut" | "sprint" | "tir" | "visee" | "recharger"
  | "arme1" | "arme2" | "arme3" | "arme4" | "scores";

export const ACTIONS: readonly Action[] = [
  "avant", "arriere", "gauche", "droite", "saut", "sprint", "tir", "visee", "recharger",
  "arme1", "arme2", "arme3", "arme4", "scores",
];

export const LIBELLES_ACTIONS: Record<Action, string> = {
  avant: "Avancer",
  arriere: "Reculer",
  gauche: "Aller à gauche",
  droite: "Aller à droite",
  saut: "Sauter, double saut, saut de mur",
  sprint: "Sprinter",
  tir: "Tirer (maintenir : rafale)",
  visee: "Viser / lunette",
  recharger: "Recharger",
  arme1: "Pistolet (prochaine apparition)",
  arme2: "Mitraillette (prochaine apparition)",
  arme3: "Fusil à pompe (prochaine apparition)",
  arme4: "Sniper (prochaine apparition)",
  scores: "Tableau des scores (maintenir)",
};

/** Deux emplacements par action ; `null` = vide. */
export type Emplacements = [string | null, string | null];
export type ConfigTouches = Record<Action, Emplacements>;

export const CLE_TOUCHES = "pdj-fps-touches";
/** Jamais assignable (libère la souris). */
export const TOUCHE_RESERVEE = "Escape";

export function touchesParDefaut(): ConfigTouches {
  return {
    avant: ["KeyW", "ArrowUp"],
    arriere: ["KeyS", "ArrowDown"],
    gauche: ["KeyA", "ArrowLeft"],
    droite: ["KeyD", "ArrowRight"],
    saut: ["Space", null],
    sprint: ["ShiftLeft", "ShiftRight"],
    tir: ["Souris0", null],
    visee: ["Souris2", null],
    recharger: ["KeyR", null],
    arme1: ["Digit1", "Numpad1"],
    arme2: ["Digit2", "Numpad2"],
    arme3: ["Digit3", "Numpad3"],
    arme4: ["Digit4", "Numpad4"],
    scores: ["Tab", null],
  };
}

/** Code plausible : lettres, chiffres et noms de touches (`KeyW`, `F5`, `Souris3`…), 1 à 24 caractères. */
export function codeValide(code: unknown): code is string {
  return typeof code === "string" && /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(code) && code !== TOUCHE_RESERVEE;
}

/**
 * Relit une configuration enregistrée : les actions absentes ou abîmées reprennent leurs
 * touches par défaut, une touche en double ne reste que sur la première action qui l'a.
 */
export function normaliser(brut: unknown): ConfigTouches {
  const defaut = touchesParDefaut();
  if (!brut || typeof brut !== "object") return defaut;
  const src = brut as Record<string, unknown>;
  const vus = new Set<string>();
  const res = {} as ConfigTouches;
  for (const a of ACTIONS) {
    const v = src[a];
    const lu: Emplacements = Array.isArray(v) && v.length === 2 && v.every((c) => c === null || codeValide(c))
      ? [v[0] as string | null, v[1] as string | null]
      : defaut[a];
    res[a] = lu.map((c) => {
      if (c === null || vus.has(c)) return null;
      vus.add(c);
      return c;
    }) as Emplacements;
  }
  return res;
}

export interface Stockage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export function lireTouches(stockage?: Stockage | null): ConfigTouches {
  try {
    const s = stockage?.getItem(CLE_TOUCHES);
    return s ? normaliser(JSON.parse(s)) : touchesParDefaut();
  } catch {
    return touchesParDefaut();
  }
}

/** Enregistre (ou efface si c'est la configuration par défaut). Faux si le stockage refuse. */
export function ecrireTouches(cfg: ConfigTouches, stockage?: Stockage | null): boolean {
  try {
    if (!stockage) return false;
    if (estParDefaut(cfg)) stockage.removeItem(CLE_TOUCHES);
    else stockage.setItem(CLE_TOUCHES, JSON.stringify(cfg));
    return true;
  } catch {
    return false;
  }
}

export function estParDefaut(cfg: ConfigTouches): boolean {
  const d = touchesParDefaut();
  return ACTIONS.every((a) => cfg[a][0] === d[a][0] && cfg[a][1] === d[a][1]);
}

/**
 * Pose `code` dans l'emplacement `slot` de `action` (null = vider l'emplacement). La touche est
 * retirée de toute autre action qui l'utilisait : renvoie aussi l'action dépossédée, pour le dire.
 */
export function assigner(cfg: ConfigTouches, action: Action, slot: 0 | 1, code: string | null): { cfg: ConfigTouches; depossedee: Action | null } {
  if (code !== null && !codeValide(code)) return { cfg, depossedee: null };
  const res = {} as ConfigTouches;
  let depossedee: Action | null = null;
  for (const a of ACTIONS) {
    res[a] = cfg[a].map((c, i) => {
      if (a === action && i === slot) return code;
      if (code !== null && c === code) {
        if (a !== action) depossedee = a;
        return null;
      }
      return c;
    }) as Emplacements;
  }
  return { cfg: res, depossedee };
}

/** Index inverse : touche → actions (une seule en pratique, cf. `assigner`). */
export function indexTouches(cfg: ConfigTouches): Map<string, Action[]> {
  const m = new Map<string, Action[]>();
  for (const a of ACTIONS) {
    for (const c of cfg[a]) {
      if (c === null) continue;
      const l = m.get(c);
      if (l) l.push(a);
      else m.set(c, [a]);
    }
  }
  return m;
}

/** Code d'un bouton de souris (`MouseEvent.button`). */
export const codeSouris = (bouton: number) => `Souris${bouton}`;

const NOMS: Record<string, string> = {
  Space: "Espace", ShiftLeft: "Maj gauche", ShiftRight: "Maj droite", ControlLeft: "Ctrl gauche",
  ControlRight: "Ctrl droite", AltLeft: "Alt", AltRight: "Alt Gr", MetaLeft: "Cmd gauche", MetaRight: "Cmd droite",
  Tab: "Tab", CapsLock: "Verr. maj", Enter: "Entrée", Backspace: "Retour arrière", Delete: "Suppr",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Backquote: "²", Minus: ")", Equal: "=",
  Souris0: "Clic gauche", Souris1: "Clic milieu", Souris2: "Clic droit", Souris3: "Souris 4", Souris4: "Souris 5",
};

/**
 * Libellé lisible d'une touche. `disposition` (facultatif) traduit un code physique selon le
 * clavier du joueur (`navigator.keyboard.getLayoutMap()`, Chrome) : `KeyW` → « z » en AZERTY.
 * Sans elle, on affiche la lettre QWERTY.
 */
export function libelleTouche(code: string | null, disposition?: ReadonlyMap<string, string> | null): string {
  if (code === null) return "—";
  if (NOMS[code]) return NOMS[code];
  // la rangée des chiffres reste « 1, 2, 3… » (en AZERTY elle produit « &, é, " » sans Maj)
  let m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  const d = disposition?.get(code);
  if (d && d.trim()) return d.toUpperCase();
  m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Pavé ${m[1]}`;
  return code;
}

/** `localStorage` du navigateur s'il est utilisable (navigation privée stricte, rendu serveur : null). */
export function stockageNavigateur(): Stockage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
