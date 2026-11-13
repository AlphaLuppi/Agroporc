/**
 * Rocket Muche : entrées du joueur humain (clavier + souris + manette).
 *
 * Deux parties :
 *  - des fonctions PURES (`entreesDepuisClavier`, `entreesDepuisManette`, `fusionnerEntrees`) testées sous Node ;
 *  - `creerSourceEntrees`, qui branche les écouteurs sur la fenêtre et lit `navigator.getGamepads()` (seul morceau qui touche le DOM).
 *
 * Les touches sont lues par `KeyboardEvent.code` (positions PHYSIQUES) : la disposition par défaut W/A/S/D devient Z/Q/S/D sur un clavier
 * AZERTY sans rien changer. Les boutons de la souris sont ajoutés aux touches sous les codes `Souris0` (gauche), `Souris1` (milieu),
 * `Souris2` (droit). Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md § 8.
 *
 * Disposition par défaut (cf. `LIAISONS_DEFAUT` du contrat) :
 *  - W / ↑ gaz, S / ↓ frein et marche arrière ; en l'air W = nez en bas, S = nez en haut ;
 *  - A / ← et D / → : volant au sol, lacet en l'air ; avec le dérapage tenu en l'air, ils font rouler la voiture (air roll libre) ;
 *  - Espace : saut (second appui = double saut, ou flip si une direction est tenue) ;
 *  - Maj gauche ou clic gauche : boost ; C ou Ctrl gauche : dérapage (frein à main) / air roll libre ;
 *  - Q / E : roulis gauche / droite ; Y ou clic droit : ball cam ; V : vue arrière (tenue) ; H : klaxon ; Échap : pause ;
 *  - 1 / 2 / 3 / 4 : réactions rapides (haut = Infos, gauche = Compliments, droite = Réactions, bas = Excuses), cf. `reactions.ts` ;
 *  - bouton du milieu tenu + déplacement de la souris : regard libre (`deplacementSouris` porte alors le levier virtuel, voir plus bas).
 *
 * Manette (mapping « standard » de la Gamepad API), liaisons par défaut (`LIAISONS_MANETTE_DEFAUT`) : RT / LT gaz et frein (analogiques),
 * stick gauche (volant au sol, tangage et lacet en l'air), A saut, B boost, X dérapage / air roll libre, Y ball cam, LB / RB roulis,
 * stick droit regard libre, R3 vue arrière, Start pause, L3 klaxon, croix directionnelle réactions rapides. Chaque action est reliée à un BOUTON (`B7`) ou à un DEMI-AXE
 * (`A0-`) au choix du joueur (cf. `liaisons.ts`) :
 *  - les deux demi-axes d'un stick passent d'abord par la zone morte radiale et la courbe de `stickAvecZoneMorte`, quelle que soit
 *    l'action qui les lit ; une action analogique (gaz, volant, tangage, regard) lit alors la valeur 0..1 de l'entrée (un bouton vaut 0 ou 1,
 *    une gâchette sa course) ;
 *  - une action à deux états (saut, boost, pause…) se déclenche sur un bouton pressé ou sur un demi-axe BRUT au-delà de 0,5.
 */
import {
  CHAT_NUL,
  type DirectionChat,
  ENTREES_NULLES,
  LIAISONS_MANETTE_DEFAUT,
  SEUIL_ENTREE_MANETTE,
  type EntreeManette,
  type EntreesDepuisManette,
  type EntreesJoueur,
  type EntreesVoiture,
  type InstantaneClavier,
  type InstantaneManette,
  type LiaisonsManette,
  type LiaisonsTouches,
  type ReglagesRocket,
  type SourceEntrees,
} from "./contrat";
import { lireEntreeManette } from "./liaisons";
import { manetteDepuisGamepad, manetteStandard, type ManetteLue } from "./manette";

export { manetteDepuisGamepad, manetteStandard, type ManetteLue } from "./manette";

/** Entrées d'un joueur qui ne touche à rien. */
export function entreesJoueurNulles(): EntreesJoueur {
  return { voiture: ENTREES_NULLES(), basculerBalleCam: false, regard: [0, 0], arriere: false, klaxon: false, pause: false, chat: CHAT_NUL() };
}

const borne = (x: number, min = -1, max = 1): number => (x < min ? min : x > max ? max : x);

/** Rayon (px) de déplacement de la souris, bouton du milieu tenu, qui pousse le levier de regard libre à fond. */
export const RAYON_REGARD_SOURIS_PX = 220;

// ============================================================================================================================
// Clavier / souris
// ============================================================================================================================

/** Vrai si l'une des touches de l'action est enfoncée. */
function tenue(touches: ReadonlySet<string>, codes: readonly string[]): boolean {
  for (const c of codes) if (touches.has(c)) return true;
  return false;
}
/** +1 / -1 / 0 : deux touches opposées tenues ensemble s'annulent. */
const axe = (touches: ReadonlySet<string>, positif: readonly string[], negatif: readonly string[]): number =>
  (tenue(touches, positif) ? 1 : 0) - (tenue(touches, negatif) ? 1 : 0);

/**
 * Clavier / souris → entrées (pure). Convention de signe du contrat : tangage +1 = nez en haut, direction et lacet +1 = à droite,
 * roulis +1 = penche à droite. Les touches de gaz remplissent à la fois le gaz (`accel`) et le tangage (`tangage = -accel`) : la voiture
 * n'utilise que celui qui convient (sol : gaz ; air : tangage). Le volant sert aussi de lacet en l'air (`lacet` reste à 0 : la voiture
 * le prend dans `direction`).
 *
 * Regard libre : si la liaison `regardLibre` (le bouton du milieu `Souris1` par défaut) est tenue, `deplacementSouris` est le levier virtuel déjà intégré par la source,
 * en pixels depuis l'appui, converti en [-1, 1] ; il vaut `[0, 0]` sinon (le retour au centre est lissé par la caméra).
 */
export function entreesDepuisClavier(i: InstantaneClavier, l: Readonly<LiaisonsTouches>): EntreesJoueur {
  const t = i.touches;
  const accel = axe(t, l.accelerer, l.reculer);
  const voiture: EntreesVoiture = {
    accel,
    direction: axe(t, l.droite, l.gauche),
    tangage: 0 - accel,
    lacet: 0,
    roulis: axe(t, l.rouleDroite, l.rouleGauche),
    saut: tenue(t, l.saut),
    boost: tenue(t, l.boost),
    derapage: tenue(t, l.derapage),
  };
  const regardActif = tenue(t, l.regardLibre);
  return {
    voiture,
    basculerBalleCam: tenue(t, l.balleCam),
    regard: regardActif
      ? [borne(i.deplacementSouris[0] / RAYON_REGARD_SOURIS_PX), borne(0 - i.deplacementSouris[1] / RAYON_REGARD_SOURIS_PX)]
      : [0, 0],
    arriere: tenue(t, l.arriere),
    klaxon: tenue(t, l.klaxon),
    pause: tenue(t, l.pause),
    chat: { haut: tenue(t, l.chatHaut), gauche: tenue(t, l.chatGauche), droite: tenue(t, l.chatDroite), bas: tenue(t, l.chatBas) },
  };
}

// ============================================================================================================================
// Manette
// ============================================================================================================================

/** Indices du mapping « standard » de la Gamepad API. */
export const BOUTON_MANETTE = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, retour: 8, start: 9, l3: 10, r3: 11, haut: 12, bas: 13, gauche: 14, droite: 15 } as const;

/**
 * Zone morte RADIALE puis courbe quadratique sur le stick `(x, y)` : sous `zoneMorte` rien ; au-delà, l'amplitude est ramenée à
 * [0, 1], élevée au carré (précision au centre, pleine course au bord) et la direction du stick est conservée. Pure.
 */
export function stickAvecZoneMorte(x: number, y: number, zoneMorte: number): [number, number] {
  const norme = Math.hypot(x, y);
  const z = borne(zoneMorte, 0, 0.9);
  if (norme <= z || norme < 1e-9) return [0, 0];
  const a = borne((norme - z) / (1 - z), 0, 1);
  const k = (a * a) / norme;
  return [x * k, y * k];
}

const axeManette = (m: InstantaneManette, i: number): number => {
  const v = m.axes[i];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};
/** Valeur analogique d'une gâchette ou d'un bouton, dans [0, 1] (un bouton binaire donne 0 ou 1). */
const boutonManette = (m: InstantaneManette, i: number): number => {
  const b = m.boutons[i];
  if (!b) return 0;
  const v = borne(Number.isFinite(b.value) ? b.value : 0, 0, 1);
  if (b.pressed && v === 0) return 1;
  return v < 0.05 ? 0 : v;
};
const presse = (m: InstantaneManette, i: number): boolean => !!m.boutons[i]?.pressed;
/** Évite les -0 (`toEqual` les distingue de 0). */
const net = (x: number): number => x || 0;

/**
 * Axes de la manette après zone morte radiale et courbe, stick par stick : (0, 1) = stick gauche, (2, 3) = stick droit. Les éventuels axes
 * suivants restent bruts.
 */
function axesCorriges(m: InstantaneManette, zoneMorte: number): number[] {
  const n = Math.max(m.axes.length, 4);
  const res = Array.from({ length: n }, (_, i) => axeManette(m, i));
  const [gx, gy] = stickAvecZoneMorte(res[0], res[1], zoneMorte);
  const [dx, dy] = stickAvecZoneMorte(res[2], res[3], zoneMorte);
  res[0] = gx; res[1] = gy; res[2] = dx; res[3] = dy;
  return res;
}

/** Valeur 0..1 d'une entrée : course d'un bouton / d'une gâchette, ou demi-axe (corrigé) poussé dans le bon sens. */
function valeurEntree(m: InstantaneManette, axes: readonly number[], code: EntreeManette): number {
  const e = lireEntreeManette(code);
  if (!e) return 0;
  if (e.type === "bouton") return boutonManette(m, e.index);
  const v = axes[e.index];
  return net(Math.max(0, e.signe * (typeof v === "number" ? v : 0)));
}
/** Le plus fort des codes d'une action (0 sans liaison). */
const valeurAction = (m: InstantaneManette, axes: readonly number[], codes: readonly EntreeManette[]): number => {
  let v = 0;
  for (const c of codes) v = Math.max(v, valeurEntree(m, axes, c));
  return v;
};
/** Entrée à deux états : bouton pressé, ou demi-axe BRUT au-delà du seuil (indépendant de la zone morte). */
function entreeActive(m: InstantaneManette, code: EntreeManette): boolean {
  const e = lireEntreeManette(code);
  if (!e) return false;
  if (e.type === "bouton") return presse(m, e.index);
  return e.signe * axeManette(m, e.index) >= SEUIL_ENTREE_MANETTE;
}
const actionActive = (m: InstantaneManette, codes: readonly EntreeManette[]): boolean => codes.some((c) => entreeActive(m, c));

/**
 * Manette → entrées (pure), selon `liaisons` (défaut : disposition de Rocket League). Avec les liaisons par défaut, RT - LT donne le gaz
 * analogique ; le stick gauche donne le volant (X) et le tangage (Y : vers le haut = nez en bas, comme Rocket League, sauf
 * `inverserTangageManette`) ; le stick droit donne le regard libre (haut = regarder vers le haut).
 */
export const entreesDepuisManette: EntreesDepuisManette = (m, r, liaisons = LIAISONS_MANETTE_DEFAUT) => {
  const axes = axesCorriges(m, r.zoneMorteManette);
  const l = liaisons;
  const signeTangage = r.inverserTangageManette ? -1 : 1;
  const analogique = (positif: readonly EntreeManette[], negatif: readonly EntreeManette[]): number =>
    net(borne(valeurAction(m, axes, positif) - valeurAction(m, axes, negatif)));
  const voiture: EntreesVoiture = {
    accel: analogique(l.accelerer, l.reculer),
    direction: analogique(l.droite, l.gauche),
    tangage: net(borne(analogique(l.tangageHaut, l.tangageBas) * signeTangage)),
    lacet: 0,
    roulis: (actionActive(m, l.rouleDroite) ? 1 : 0) - (actionActive(m, l.rouleGauche) ? 1 : 0),
    saut: actionActive(m, l.saut),
    boost: actionActive(m, l.boost),
    derapage: actionActive(m, l.derapage),
  };
  return {
    voiture,
    basculerBalleCam: actionActive(m, l.balleCam),
    regard: [analogique(l.regardDroite, l.regardGauche), analogique(l.regardHaut, l.regardBas)],
    arriere: actionActive(m, l.arriere),
    klaxon: actionActive(m, l.klaxon),
    pause: actionActive(m, l.pause),
    chat: { haut: actionActive(m, l.chatHaut), gauche: actionActive(m, l.chatGauche), droite: actionActive(m, l.chatDroite), bas: actionActive(m, l.chatBas) },
  };
};

/** Un des codes de la liaison « pause » est-il actif sur cette manette ? (Start y est toujours.) */
export const pauseDepuisManette = (m: InstantaneManette, liaisons: Readonly<LiaisonsManette>): boolean => actionActive(m, liaisons.pause);

// ============================================================================================================================
// Fusion
// ============================================================================================================================

/** L'axe de plus grande amplitude l'emporte (clavier et manette branchés ensemble ne se gênent pas). */
const plusFort = (a: number, b: number): number => (Math.abs(b) > Math.abs(a) ? b : a);

/** Combine deux sources : la plus forte l'emporte pour chaque axe, OU logique pour les boutons. */
export function fusionnerEntrees(a: EntreesJoueur, b: EntreesJoueur): EntreesJoueur {
  return {
    voiture: {
      accel: plusFort(a.voiture.accel, b.voiture.accel),
      direction: plusFort(a.voiture.direction, b.voiture.direction),
      tangage: plusFort(a.voiture.tangage, b.voiture.tangage),
      lacet: plusFort(a.voiture.lacet, b.voiture.lacet),
      roulis: plusFort(a.voiture.roulis, b.voiture.roulis),
      saut: a.voiture.saut || b.voiture.saut,
      boost: a.voiture.boost || b.voiture.boost,
      derapage: a.voiture.derapage || b.voiture.derapage,
    },
    basculerBalleCam: a.basculerBalleCam || b.basculerBalleCam,
    regard: [plusFort(a.regard[0], b.regard[0]), plusFort(a.regard[1], b.regard[1])],
    arriere: a.arriere || b.arriere,
    klaxon: a.klaxon || b.klaxon,
    pause: a.pause || b.pause,
    chat: { haut: a.chat.haut || b.chat.haut, gauche: a.chat.gauche || b.chat.gauche, droite: a.chat.droite || b.chat.droite, bas: a.chat.bas || b.chat.bas },
  };
}

// ============================================================================================================================
// Source (DOM)
// ============================================================================================================================

/** Source d'entrées + quelques accès supplémentaires pour `jeu.ts` (pause à la manette, boutons du menu). */
export interface SourceEntreesEtendue extends SourceEntrees {
  /** vrai si le bouton `index` de la manette (mapping standard) est enfoncé à cet instant */
  boutonManette(index: number): boolean;
  /** vrai si une entrée liée à la pause (Start et la seconde liaison du joueur) est active sur la manette */
  pauseManette(): boolean;
}

/** Cible d'un événement qui ne doit PAS être volée au navigateur (champ de saisie, bouton, lien, boîte de dialogue du menu pause). */
function cibleInteractive(t: EventTarget | null): boolean {
  const el = t as (Partial<HTMLElement> & { closest?: (s: string) => Element | null }) | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || tag === "a" || tag === "summary") return true;
  if (el.isContentEditable) return true;
  // la racine de la vue Palantir est elle-même un `role="dialog"` (porteur de `data-arene`) qui contient le canvas : elle n'est pas un
  // dialogue du menu. Seuls les vrais dialogues (pause, fin) et menus volent les touches.
  return typeof el.closest === "function" && !!el.closest('[role="dialog"]:not([data-arene]), [role="menu"]');
}

/** Touches dont l'action par défaut du navigateur (défilement, focus, menu) gênerait le jeu. */
const TOUCHES_BLOQUEES = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "ControlLeft", "ControlRight"]);

/**
 * Branche les écouteurs sur `cible` (la fenêtre). `liaisons` et `reglages` sont relus à chaque échantillon (le menu de réglages peut
 * les changer en pleine partie). Une touche pressée ENTRE deux échantillons est mémorisée jusqu'au prochain : un appui plus court
 * qu'une image (rendu logiciel à 5 images/s) n'est jamais perdu. `lireManettes` est injectable pour les tests.
 */
const APPUIS_CHAT_MAX = 8;

export function creerSourceEntrees(
  cible: Window,
  liaisons: () => Readonly<LiaisonsTouches>,
  reglages: () => Readonly<ReglagesRocket>,
  lireManettes: () => readonly (ManetteLue | null)[] = () =>
    (typeof navigator !== "undefined" && typeof navigator.getGamepads === "function" ? Array.from(navigator.getGamepads(), manetteDepuisGamepad) : []),
): SourceEntreesEtendue {
  const enfoncees = new Set<string>();
  /** touches pressées depuis le dernier échantillon (même relâchées depuis) */
  const memoire = new Set<string>();
  /** levier virtuel du regard libre : déplacement cumulé de la souris (px) depuis l'appui du bouton du milieu */
  const levier: [number, number] = [0, 0];

  /** directions de réaction dont une touche a été enfoncée (événement) depuis le dernier échantillon */
  const appuisChat: DirectionChat[] = [];
  /** Dans l'ORDRE où le joueur a appuyé (et autant de fois), borné : à 3 images/s « 3 puis 1 » doit rester « 3 puis 1 ». */
  const marquerChat = (code: string) => {
    const l = liaisons();
    const ajouter = (d: DirectionChat) => { if (appuisChat.length < APPUIS_CHAT_MAX) appuisChat.push(d); };
    if (l.chatHaut.includes(code)) ajouter("haut");
    if (l.chatGauche.includes(code)) ajouter("gauche");
    if (l.chatDroite.includes(code)) ajouter("droite");
    if (l.chatBas.includes(code)) ajouter("bas");
  };
  const presser = (code: string) => { enfoncees.add(code); memoire.add(code); marquerChat(code); };
  const relacherCode = (code: string) => {
    const etait = regardActif();
    enfoncees.delete(code);
    // le levier du regard libre revient au centre quand sa liaison n'est plus tenue
    if (etait && !regardActif()) { levier[0] = 0; levier[1] = 0; }
  };

  const surKeyDown = (e: Event) => {
    const k = e as KeyboardEvent;
    if (cibleInteractive(k.target)) return;
    // la répétition automatique d'une touche tenue n'est pas un nouvel appui
    if (k.repeat) { enfoncees.add(k.code); memoire.add(k.code); } else presser(k.code);
    if (!k.metaKey && (TOUCHES_BLOQUEES.has(k.code) || utilisee(k.code))) k.preventDefault();
  };
  const surKeyUp = (e: Event) => {
    const k = e as KeyboardEvent;
    relacherCode(k.code);
  };
  const surMouseDown = (e: Event) => {
    const m = e as MouseEvent;
    if (cibleInteractive(m.target)) return;
    presser(`Souris${m.button}`);
    // le bouton du milieu déclencherait le défilement automatique du navigateur
    if (m.button === 1) m.preventDefault();
  };
  const surMouseUp = (e: Event) => { relacherCode(`Souris${(e as MouseEvent).button}`); };
  const surMouseMove = (e: Event) => {
    if (!regardActif()) return;
    const m = e as MouseEvent;
    levier[0] += m.movementX || 0;
    levier[1] += m.movementY || 0;
    const n = Math.hypot(levier[0], levier[1]);
    if (n > RAYON_REGARD_SOURIS_PX) { levier[0] *= RAYON_REGARD_SOURIS_PX / n; levier[1] *= RAYON_REGARD_SOURIS_PX / n; }
  };
  const surContexte = (e: Event) => { e.preventDefault(); };
  const surPerteFocus = () => { enfoncees.clear(); memoire.clear(); appuisChat.length = 0; levier[0] = 0; levier[1] = 0; };
  const surManette = () => { /* connectée() relit navigator à chaque appel */ };

  /** le regard libre est-il tenu ? (liaison `regardLibre`, le bouton du milieu par défaut) */
  const regardActif = (): boolean => tenue(enfoncees, liaisons().regardLibre);

  /** `code` est-il lié à une action ? (pour ne bloquer que les touches du jeu) */
  function utilisee(code: string): boolean {
    const l = liaisons();
    for (const k of Object.keys(l) as (keyof LiaisonsTouches)[]) if (l[k].includes(code)) return true;
    return false;
  }

  function manette(): ManetteLue | null {
    return manetteStandard(lireManettes());
  }

  cible.addEventListener("keydown", surKeyDown);
  cible.addEventListener("keyup", surKeyUp);
  cible.addEventListener("mousedown", surMouseDown);
  cible.addEventListener("mouseup", surMouseUp);
  cible.addEventListener("mousemove", surMouseMove);
  cible.addEventListener("contextmenu", surContexte);
  cible.addEventListener("blur", surPerteFocus);
  cible.addEventListener("gamepadconnected", surManette);
  cible.addEventListener("gamepaddisconnected", surManette);

  return {
    echantillonner() {
      const touches = new Set<string>(enfoncees);
      for (const c of memoire) touches.add(c);
      // les touches mémorisées ont vécu leur image : celles qui sont encore tenues restent dans `enfoncees`
      memoire.clear();
      const clavier = entreesDepuisClavier({ touches, deplacementSouris: [levier[0], levier[1]] }, liaisons());
      const pad = manette();
      const res = pad ? fusionnerEntrees(clavier, entreesDepuisManette(pad, reglages(), reglages().liaisonsManette)) : clavier;
      res.chatSuite = [...appuisChat];
      res.chatAppuis = { haut: appuisChat.includes("haut"), gauche: appuisChat.includes("gauche"), droite: appuisChat.includes("droite"), bas: appuisChat.includes("bas") };
      appuisChat.length = 0;
      return res;
    },
    manetteConnectee() { return manette() !== null; },
    boutonManette(index) { const p = manette(); return !!p && presse(p, index); },
    pauseManette() { const p = manette(); return !!p && pauseDepuisManette(p, reglages().liaisonsManette); },
    relacher() { surPerteFocus(); },
    vibrer(intensite, dureeMs) {
      const pad = manette();
      const act = pad?.vibrationActuator;
      if (!act) return;
      const i = borne(intensite, 0, 1);
      try {
        const r = act.playEffect("dual-rumble", { startDelay: 0, duration: Math.max(1, Math.round(dureeMs)), weakMagnitude: i * 0.7, strongMagnitude: i });
        if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(() => {});
      } catch { /* vibration refusée : sans importance */ }
    },
    dispose() {
      cible.removeEventListener("keydown", surKeyDown);
      cible.removeEventListener("keyup", surKeyUp);
      cible.removeEventListener("mousedown", surMouseDown);
      cible.removeEventListener("mouseup", surMouseUp);
      cible.removeEventListener("mousemove", surMouseMove);
      cible.removeEventListener("contextmenu", surContexte);
      cible.removeEventListener("blur", surPerteFocus);
      cible.removeEventListener("gamepadconnected", surManette);
      cible.removeEventListener("gamepaddisconnected", surManette);
      enfoncees.clear();
      memoire.clear();
    },
  };
}
