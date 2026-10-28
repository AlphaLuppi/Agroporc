/**
 * Touches de l'arène, modifiables par le joueur et gardées dans le navigateur (PUR : ni DOM ni
 * three ; le stockage est injecté). Une touche est un `KeyboardEvent.code` (position physique :
 * `KeyW` est le Z d'un clavier AZERTY) ou un bouton de souris `Souris0` (gauche), `Souris1`
 * (milieu), `Souris2` (droit), `Souris3` / `Souris4` (boutons latéraux).
 * Chaque action a deux emplacements ; une touche ne sert qu'à une action à la fois, sauf entre le contexte « mort » (`ACTIONS_MORT` :
 * passer le rejeu de la killcam) et le contexte « en vie » : on ne saute pas pendant qu'on regarde son rejeu, Espace sert aux deux.
 * Échap n'est jamais assignable : elle libère toujours la souris (menu pause).
 */

export type Action =
  | "avant" | "arriere" | "gauche" | "droite"
  | "saut" | "sprint" | "tir" | "visee" | "recharger" | "scores"
  | "armePrincipale" | "armeSecondaire" | "couteau" | "armeSpeciale" | "armePrecedente" | "couteauRapide"
  | "accroupi" | "interagir" | "siege"
  | "carte" | "minimapCoin" | "passer"
  | "zoomLunette" | "parler" | "invoquer"
  | "fumigene" | "frappeAerienne"
  | "soigner" | "potion" | "lacher" | "spectateurSuivant" | "spectateurPrecedent";

/**
 * Les 10 actions de la v1 qui restent (`arme1..arme4` ont disparu). Leurs touches enregistrées sont relues AVANT celles des
 * actions nouvelles : une sauvegarde v1 ne perd jamais une touche à cause d'une nouveauté (cf. `normaliser`).
 */
export const ACTIONS_V1: readonly Action[] = [
  "avant", "arriere", "gauche", "droite", "saut", "sprint", "tir", "visee", "recharger", "scores",
];

/**
 * Actions apparues avec la v2 (équipement, accroupi, véhicules), le HUD (grande carte, coin de la mini-map), la v3 (niveau de zoom
 * de la lunette, appuyer pour parler au chat vocal), les tigres largués (sort d'invocation) puis le Battle Royale (v8 : bandage, potion de
 * bouclier, lâcher une arme, changer de joueur suivi une fois mort).
 */
export const ACTIONS_NOUVELLES: readonly Action[] = [
  "armePrincipale", "armeSecondaire", "couteau", "armeSpeciale", "armePrecedente", "couteauRapide",
  "accroupi", "interagir", "siege", "carte", "minimapCoin", "passer", "zoomLunette", "parler", "invoquer",
  "fumigene", "frappeAerienne",
  "soigner", "potion", "lacher", "spectateurSuivant", "spectateurPrecedent",
];

/**
 * Actions du contexte « mort » (killcam, puis spectateur du Battle Royale). Elles ne se disputent une touche qu'entre elles : Espace est à la
 * fois « Sauter » (en vie) et « Passer le rejeu » (mort), les flèches sont à la fois « Aller à gauche / droite » (en vie) et « Joueur
 * précédent / suivant » (mort), sans conflit puisque les deux ne sont jamais actives ensemble.
 */
export const ACTIONS_MORT: readonly Action[] = ["passer", "spectateurSuivant", "spectateurPrecedent"];
const contexteDe = (a: Action): "mort" | "vie" => (ACTIONS_MORT.includes(a) ? "mort" : "vie");

/** Ordre de priorité du dédoublonnage : les actions v1, puis les nouvelles. */
export const ACTIONS: readonly Action[] = [...ACTIONS_V1, ...ACTIONS_NOUVELLES];

/** Actions qui peuvent rester sans touche sans que ce soit un problème (pas d'avertissement dans le menu pause). */
export const ACTIONS_FACULTATIVES: readonly Action[] = [
  "minimapCoin", "passer", "zoomLunette", "parler", "fumigene", "frappeAerienne", "soigner", "potion", "lacher", "spectateurSuivant", "spectateurPrecedent",
];

export const LIBELLES_ACTIONS: Record<Action, string> = {
  avant: "Avancer",
  arriere: "Reculer",
  gauche: "Aller à gauche",
  droite: "Aller à droite",
  saut: "Sauter, double saut, saut de mur (en voiture : déraper)",
  sprint: "Sprinter",
  accroupi: "S'accroupir (en sprint : glissade)",
  tir: "Tirer (maintenir : rafale)",
  visee: "Viser / lunette",
  recharger: "Recharger",
  armePrincipale: "Arme principale",
  armeSecondaire: "Arme secondaire",
  couteau: "Couteau",
  armeSpeciale: "Arme spéciale (si portée)",
  armePrecedente: "Dernière arme utilisée",
  couteauRapide: "Couteau rapide (rappuyer : retour)",
  interagir: "Monter / descendre d'une voiture",
  siege: "Changer de place dans la voiture",
  scores: "Tableau des scores (maintenir)",
  carte: "Grande carte (maintenir)",
  minimapCoin: "Mini-carte : coin suivant",
  passer: "Passer le rejeu (mort)",
  zoomLunette: "Lunette : niveau de zoom suivant (molette en lunette)",
  parler: "Chat vocal : appuyer pour parler",
  invoquer: "Invoquer le tigre (sort gagné)",
  fumigene: "Lancer un fumigène",
  frappeAerienne: "Cibler la frappe aérienne (série de 5)",
  soigner: "Battle Royale : utiliser un bandage",
  potion: "Battle Royale : boire une potion de bouclier",
  lacher: "Battle Royale : lâcher l'arme en main",
  spectateurSuivant: "Spectateur : joueur suivant",
  spectateurPrecedent: "Spectateur : joueur précédent",
};

/** Regroupement du menu pause : chaque action y figure une seule fois. */
export const GROUPES_ACTIONS: { titre: string; actions: Action[] }[] = [
  { titre: "Déplacement", actions: ["avant", "arriere", "gauche", "droite", "saut", "sprint", "accroupi"] },
  { titre: "Combat", actions: ["tir", "visee", "recharger", "zoomLunette", "invoquer", "fumigene", "frappeAerienne"] },
  { titre: "Équipement", actions: ["armePrincipale", "armeSecondaire", "couteau", "armeSpeciale", "armePrecedente", "couteauRapide"] },
  { titre: "Véhicule", actions: ["interagir", "siege"] },
  { titre: "Battle Royale", actions: ["soigner", "potion", "lacher", "spectateurSuivant", "spectateurPrecedent"] },
  { titre: "Divers", actions: ["scores", "carte", "minimapCoin", "passer", "parler"] },
];

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
    scores: ["Tab", null],
    armePrincipale: ["Digit1", "Numpad1"],
    armeSecondaire: ["Digit2", "Numpad2"],
    couteau: ["Digit3", "Numpad3"],
    armeSpeciale: ["Digit4", "Numpad4"],
    armePrecedente: ["KeyQ", null],
    couteauRapide: ["KeyV", null],
    // C, jamais Ctrl gauche : Ctrl+W ferme l'onglet et Ctrl+1..4 en change (v2 §2.8)
    accroupi: ["KeyC", null],
    interagir: ["KeyE", null],
    siege: ["KeyF", null],
    carte: ["KeyM", null],
    minimapCoin: [null, null],
    passer: ["Space", null],
    // clic milieu : la molette, elle, change d'arme hors lunette et de zoom en lunette
    zoomLunette: ["Souris1", "KeyX"],
    parler: ["KeyT", null],
    // G et non T : T appuie pour parler au chat vocal (v3 de l'arène)
    invoquer: ["KeyG", null],
    fumigene: ["KeyB", null],
    frappeAerienne: ["KeyK", null],
    // Battle Royale (v8) : H, J et U sont libres ; les flèches du spectateur ne gênent pas « gauche » / « droite » (contexte mort)
    soigner: ["KeyH", null],
    potion: ["KeyJ", null],
    lacher: ["KeyU", null],
    spectateurSuivant: ["ArrowRight", null],
    spectateurPrecedent: ["ArrowLeft", null],
  };
}

/** Code plausible : lettres, chiffres et noms de touches (`KeyW`, `F5`, `Souris3`…), 1 à 24 caractères. */
export function codeValide(code: unknown): code is string {
  return typeof code === "string" && /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(code) && code !== TOUCHE_RESERVEE;
}

/**
 * Relit une configuration enregistrée : les actions absentes ou abîmées reprennent leurs touches par défaut, une touche en
 * double ne reste que sur la première action qui l'a. Les actions v1 passent d'abord (elles gardent leurs touches, y compris
 * une sauvegarde v1 qui aurait mis `recharger` sur `KeyE`) ; une action nouvelle absente de la sauvegarde ne prend que celles
 * de ses touches par défaut encore libres, ramenées vers le premier emplacement (aucune : sans touche, cf. `actionsSansTouche`).
 * Une touche peut servir à une action « en vie » et à une action « mort » (`ACTIONS_MORT`). Les clés inconnues (`arme1..arme4` d'une sauvegarde v1) sont ignorées.
 */
export function normaliser(brut: unknown): ConfigTouches {
  const defaut = touchesParDefaut();
  const src: Record<string, unknown> = brut && typeof brut === "object" ? (brut as Record<string, unknown>) : {};
  const vusParContexte = { vie: new Set<string>(), mort: new Set<string>() };
  const res = {} as ConfigTouches;
  for (const a of ACTIONS) {
    const vus = vusParContexte[contexteDe(a)];
    const v = src[a];
    const valide = Array.isArray(v) && v.length === 2 && v.every((c) => c === null || codeValide(c));
    if (!valide && ACTIONS_NOUVELLES.includes(a)) {
      const libres = defaut[a].filter((c): c is string => c !== null && !vus.has(c));
      res[a] = [libres[0] ?? null, libres[1] ?? null];
      for (const c of libres) vus.add(c);
      continue;
    }
    const lu: Emplacements = valide ? [v[0] as string | null, v[1] as string | null] : defaut[a];
    res[a] = lu.map((c) => {
      if (c === null || vus.has(c)) return null;
      vus.add(c);
      return c;
    }) as Emplacements;
  }
  return res;
}

/**
 * Actions obligatoires restées sans aucune touche (conflit d'une sauvegarde plus ancienne, touche vidée) : affichées en
 * avertissement dans le menu pause. Les actions facultatives (`minimapCoin`) n'en font pas partie.
 */
export function actionsSansTouche(cfg: ConfigTouches): Action[] {
  return ACTIONS.filter((a) => !ACTIONS_FACULTATIVES.includes(a) && cfg[a].every((c) => c === null));
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
      // un contexte ne dépossède pas l'autre (Espace : saut en vie, rejeu de la killcam à la mort)
      if (code !== null && c === code && contexteDe(a) === contexteDe(action)) {
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
