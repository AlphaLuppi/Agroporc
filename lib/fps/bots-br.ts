/**
 * Cerveau des bots du Battle Royale (PUR : ni horloge ni hasard globaux, `alea` et `t` sont passés ; aucun import de three ni du DOM). Un bot est un
 * vrai membre de la table de la salle (`match-br-bots.ts`) : ce module ne fait que DÉCIDER (`decider` renvoie des consignes), le câblage les traduit
 * en messages de client (`etat`, `tir`, `chute`, `ramasser`…) qui passent par la même validation que ceux d'un humain.
 *
 * Lot 3a (plomberie) : `decider` était SCRIPTÉ (ligne droite). Lot 3b (IA) : mêmes signatures, contenu complet.
 *  - états `atterrir → fouiller → zone → combat → soigner → fuir`, mémoire par bot (`MemoireBot`) ;
 *  - navigation : `EntreeCerveau.nav` (`NavBot`, construit par `nav-bots.ts`) répond « ligne libre ? », chemin A* (budget global d'un A* par tic, 3 000 nœuds,
 *    échecs mémorisés 8 s), point à viser le long du chemin, abri ; sans `nav` (tests purs) le bot va en ligne droite ;
 *  - la zone prime sur le butin dès qu'on approche du bord du cercle courant, dès le palier 2 ou en cours de rétrécissement si l'on est hors du cercle visé ;
 *  - combat : cible gardée tant qu'elle reste visible (hystérésis), distance optimale de l'arme, esquive latérale lente, recul trop près, recharge à couvert,
 *    poursuite du dernier point vu, mêlée à moins de 2,2 m ; sous un seuil de PV (selon le niveau) le bot fuit vers un abri, puis se soigne hors de vue ;
 *  - visée à imprécision réglable (`NIVEAUX_BOT`), lue sur une cible retardée de `reactionMs`.
 *
 * Conventions de `pasChute` : x est, z sud, y haut ; `lacet` 0 regarde vers −z, l'avant vaut (−sin lacet, −cos lacet), la droite (cos lacet, −sin lacet) ;
 * `tangage` positif regarde vers le haut.
 * Spec : docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md (§1.3, §1.4, lot 3)
 */
import { STATS } from "./armes";
import { vitesseMaxSelonDirection } from "./bot-allure";
import type { Entrees } from "./mouvement";
import { estPrincipale } from "./equipement";
import type { ArmeFeuId, ArmeId, AvionBr, ClasseMunitions, ObjetBr, PhaseBr, Slot, Vec3 } from "./protocole";
import type { Difficulte } from "./zombies-vagues";

type Vec2 = [number, number];

// ---------------------------------------------------------------------------------------------
// réglages
// ---------------------------------------------------------------------------------------------

/**
 * Vitesse de déplacement d'un bot (m/s), plus lente que le sprint d'un joueur (12,5) : voulu pour l'entraînement, et plage utile du trot du tigre
 * bipède (lot 4). Valeur de départ, à fixer par le spike du lot 4 ; obtenue en réduisant les `entrees` (`avant` / `droite` ∈ [−1, 1]).
 */
export const VITESSE_BOT_M_S = 5;
/** Vitesse de marche d'un joueur (`MOUV.marche`) : l'unité des `entrees`. Dupliquée ici pour rester sans import de `mouvement.ts` (valeur, pas type). */
const MARCHE_JOUEUR_M_S = 9;

export interface ParamsBot {
  /** retard de réaction (ms) : la cible est lue dans l'historique à `t − reactionMs` (≤ 350 : le rejeu de latence du serveur remonte à `BR.rewindMaxMs` = 400) */
  reactionMs: number;
  /** écart-type (°) du bruit de visée à 30 m d'une cible immobile ; croît avec la distance et la vitesse de la cible */
  sigmaDeg: number;
  /** vitesse de rotation maximale (rad/s) */
  rotationMax: number;
  /** tirs d'une rafale avant la pause */
  rafaleMax: number;
  pauseMs: number;
  /** 0..1 : part de la portée de l'arme à laquelle le bot cherche le combat */
  agressivite: number;
}

/** Un seul tableau porte les niveaux. Entrée = débutants, Plat du jour = normal, Goulaf = redoutables. Valeurs de départ à ajuster en jeu. */
export const NIVEAUX_BOT: Record<Difficulte, ParamsBot> = {
  entree: { reactionMs: 350, sigmaDeg: 3.5, rotationMax: 6, rafaleMax: 3, pauseMs: 700, agressivite: 0.5 },
  plat: { reactionMs: 280, sigmaDeg: 1.6, rotationMax: 8, rafaleMax: 5, pauseMs: 450, agressivite: 0.75 },
  goulaf: { reactionMs: 200, sigmaDeg: 0.6, rotationMax: 10, rafaleMax: 99, pauseMs: 250, agressivite: 1 },
};

// ---------------------------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------------------------

export type EtatBot = "atterrir" | "fouiller" | "zone" | "combat" | "soigner" | "fuir";

export interface MemoireBot {
  etat: EtatBot;
  /** id de la cible de combat, null sans cible */
  cible: string | null;
  /** chemin A* (lot 3b) : vide pour le bot scripté */
  chemin: Vec2[];
  cheminT: number;
  dernierTirT: number;
  /** tirs de la rafale en cours et fin de la pause entre deux rafales */
  rafale: number;
  pauseJusqua: number;
  /** blocage : dernière référence de position et instant, sens du contournement (±1) jusqu'à `detourJusqua`, saut en cours jusqu'à `sautT` */
  refP: Vec3 | null;
  refT: number;
  coinceDepuis: number;
  detour: number;
  detourJusqua: number;
  sautT: number;
  /** tourne en rond : position de référence et instant d'une fenêtre de `TOURNE_EN_ROND_MS` (déplacement net, pas seulement l'arrêt) */
  netP: Vec3 | null;
  netT: number;
  // atterrissage
  cibleAtt: Vec3 | null;
  instantSaut: number | null;
  // butin
  cibleButin: number | null;
  /** objets refusés (id → instant jusqu'auquel on les ignore) : un ramassage refusé ne doit pas bloquer le bot devant l'objet */
  ignores: Record<number, number>;
  // errance dans la zone
  errance: Vec2 | null;
  errT: number;
  // visée
  aimLacet: number;
  aimTangage: number;
  aimInit: boolean;
  // navigation (lot 3b) : but du chemin en cours, échec récent (but cherché en vain jusqu'à `echecJusqua`)
  butChemin: Vec2 | null;
  echecBut: Vec2 | null;
  echecJusqua: number;
  // combat (lot 3b) : dernier point vu d'une cible perdue de vue, abri choisi, phase de l'esquive (tirée une fois, 0..1)
  vuP: Vec3 | null;
  vuT: number;
  abri: Vec2 | null;
  abriT: number;
  phaseEsquive: number;
}

export function memoireInitiale(): MemoireBot {
  return {
    etat: "atterrir", cible: null, chemin: [], cheminT: -Infinity, dernierTirT: -Infinity, rafale: 0, pauseJusqua: -Infinity,
    refP: null, refT: -Infinity, coinceDepuis: -Infinity, detour: 1, detourJusqua: -Infinity, sautT: -Infinity, netP: null, netT: -Infinity,
    cibleAtt: null, instantSaut: null, cibleButin: null, ignores: {}, errance: null, errT: -Infinity,
    aimLacet: 0, aimTangage: 0, aimInit: false,
    butChemin: null, echecBut: null, echecJusqua: -Infinity, vuP: null, vuT: -Infinity, abri: null, abriT: -Infinity, phaseEsquive: -1,
  };
}

/** Un joueur perçu par le bot (positions lues dans l'historique à `t − reactionMs`). */
export interface Percu {
  id: string;
  p: Vec3;
  vitesse: Vec3;
  distance: number;
  /** ligne de vue dégagée depuis l'œil du bot (calculée par le câblage) */
  visible: boolean;
}

/** Ce que le bot sait de lui-même (soins compris). */
export interface EtatBotPublic {
  p: Vec3;
  pv: number;
  bandage: number;
  potion: number;
  /** la meilleure arme à feu portée (en main ou non), null si le bot n'a que son couteau */
  armeFeu: ArmeFeuId | null;
  /** son slot (`principale`, `secondaire` ou `speciale`), null sans arme à feu */
  slotArme: Slot | null;
  /** (lot 3b) bouclier actuel et classes de munitions des armes à feu portées (les boîtes de munitions n'intéressent que ces classes) */
  bouclier?: number;
  classesMun?: readonly ClasseMunitions[];
  /** toutes ses armes à feu sont à sec (chargeur et réserve) : il cherche des munitions ou une autre arme avant tout */
  armeVide?: boolean;
}

/** Réponse d'une demande de chemin : trouvé (`etape` : le chemin ne mène qu'à une étape du but lointain), pas encore (budget du tic épuisé), ou introuvable. */
export type ReponseChemin = { etat: "ok"; chemin: Vec2[]; etape?: boolean } | { etat: "attente" } | { etat: "echec" };

/**
 * Ce que le cerveau sait demander au monde (construit par `nav-bots.ts` : budget d'un A* par tic pour tout le serveur, grille de navigation précalculée).
 * Optionnel dans `EntreeCerveau` : sans lui le bot va en ligne droite et se débrouille avec l'anti-coincage.
 */
export interface NavBot {
  /** aucun mur entre `de` et `but` sur toute la droite (rayons au centre et aux flancs du corps) */
  ligneLibre(de: Vec3, but: Vec2): boolean;
  chercher(de: Vec3, but: Vec2): ReponseChemin;
  /** point à viser le long du chemin : le plus lointain visible sans mur (jusqu'à 40 m) */
  viser(de: Vec3, chemin: readonly Vec2[]): Vec2 | null;
  /** un point proche, libre, hors de vue de `danger` (à couvert) ; null si aucun */
  abri(de: Vec3, danger: Vec3): Vec2 | null;
}

export interface EntreeCerveau {
  t: number;
  /** temps écoulé depuis la dernière décision de CE bot (s) */
  dtS: number;
  phase: PhaseBr;
  moi: EtatBotPublic & {
    lacet: number; tangage: number; aBord: boolean; enChute: boolean;
    /** arme EN MAIN (`couteau` ou l'arme à feu) et dégainage terminé */
    arme: ArmeId; sortie: boolean;
  };
  /** munitions simulées par le câblage */
  munitions: { charge: number; chargeur: number; reserve: number; recharge: boolean };
  avion: AvionBr | null;
  /**
   * cercle à rejoindre (zone visée). (lot 3b) `courant` = cercle de la tempête à cet instant, `palier` et `phase` (`attente` / `retrecit` / `fermee`) ; absents :
   * le cercle visé tient lieu de cercle courant.
   */
  zone: { centre: Vec2; rayon: number; courant?: { centre: Vec2; rayon: number }; palier?: number; phase?: string } | null;
  /** joueurs vivants perçus, du plus proche au plus lointain */
  percus: readonly Percu[];
  /** objets au sol à portée de vue du bot (le câblage filtre : à moins de `PORTEE_BUTIN_M`) */
  objets: readonly ObjetBr[];
  /** points d'atterrissage possibles (hors toits) et ceux déjà choisis par d'autres bots */
  points: readonly Vec3[];
  deja: readonly Vec3[];
  /** essai déterministe : les bots cherchent le joueur humain (position de l'humain le plus proche, null sinon) */
  agressif: boolean;
  humainProche: Vec3 | null;
  /** (lot 3b) navigation ; absent : ligne droite */
  nav?: NavBot;
}

export interface Consignes {
  entrees: Entrees;
  /** angles envoyés dans le `etat` (et la direction du tir) */
  lacet: number;
  tangage: number;
  tirer: boolean;
  recharger: boolean;
  /** coup d'arme blanche (aucune arme à feu utilisable) */
  coup: boolean;
  changerArme?: Slot;
  ramasser?: number;
  utiliser?: "bandage" | "potion";
  sauter: boolean;
  ouvrirParachute?: boolean;
  quitterAvion?: boolean;
}

// ---------------------------------------------------------------------------------------------
// fonctions pures
// ---------------------------------------------------------------------------------------------

const PI = Math.PI;
const borne = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const degRad = (d: number): number => (d * PI) / 180;
/** Angle ramené dans ]−π, π]. */
export function normaliserAngle(a: number): number {
  let x = a % (2 * PI);
  if (x > PI) x -= 2 * PI;
  else if (x <= -PI) x += 2 * PI;
  return x;
}

/** Lacet (convention de `pasChute`) d'un déplacement (dx, dz). */
export function capVers(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/**
 * Entrées `avant` / `droite` (∈ [−1, 1], norme ≤ 1) qui font avancer dans la direction (dirX, dirZ) quand le regard est `lacet`
 * (avant = (−sin, −cos), droite = (cos, −sin)). Direction nulle : (0, 0).
 */
export function entreesDepuisDirection(dirX: number, dirZ: number, lacet: number): { avant: number; droite: number } {
  const n = Math.hypot(dirX, dirZ);
  if (n < 1e-9) return { avant: 0, droite: 0 };
  const x = dirX / n, z = dirZ / n;
  return { avant: -Math.sin(lacet) * x - Math.cos(lacet) * z, droite: Math.cos(lacet) * x - Math.sin(lacet) * z };
}

/** Tourne `actuel` vers `voulu` (radians, plus court chemin) d'au plus `max` rad/s pendant `dtS`. */
export function limiterRotation(actuel: number, voulu: number, dtS: number, max: number): number {
  const delta = normaliserAngle(voulu - actuel);
  const pas = Math.max(0, max) * Math.max(0, dtS);
  return normaliserAngle(actuel + borne(delta, -pas, pas));
}

/** Loi normale centrée réduite (Box-Muller) à partir de deux tirages de `alea`. */
export function gaussien(alea: () => number): number {
  const u = Math.max(1e-12, alea());
  const v = alea();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * PI * v);
}

/**
 * Écart-type (rad) du bruit de visée : `sigmaDeg` à 30 m sur une cible immobile, proportionnel à la distance, et gonflé par la vitesse de la cible
 * (+ 5 % par m/s).
 */
export function sigmaVisee(p: ParamsBot, distance: number, vitesseCible: number): number {
  return degRad(p.sigmaDeg) * (0.35 + Math.max(0, distance) / 30 * 0.65) * (1 + 0.05 * Math.max(0, vitesseCible));
}

/** Angles de visée bruités : le bruit croît avec la distance et la vitesse de la cible. */
export function bruitVisee(lacet: number, tangage: number, p: ParamsBot, distance: number, vitesseCible: number, alea: () => number): { lacet: number; tangage: number } {
  const s = sigmaVisee(p, distance, vitesseCible);
  return { lacet: normaliserAngle(lacet + gaussien(alea) * s), tangage: borne(tangage + gaussien(alea) * s, -PI / 2, PI / 2) };
}

/** La cible de combat : la plus proche visible (les percus arrivent triées, mais on ne s'y fie pas). */
export function choisirCible(percus: readonly Percu[], _moi: Vec3, _p: ParamsBot, portee = Infinity): Percu | null {
  let meilleur: Percu | null = null;
  for (const c of percus) {
    if (!c.visible || c.distance > portee) continue;
    if (!meilleur || c.distance < meilleur.distance) meilleur = c;
  }
  return meilleur;
}

/** Rang d'une arme à feu pour le butin (plus haut = meilleure) ; les armes à projectile explosif n'ont aucune valeur pour un bot (il tire en hitscan). */
export const RANG_ARME: Readonly<Record<string, number>> = {
  pistolet: 1, mini_uzi: 2, revolver: 2, mitraillette: 3, sniper: 3, pompe: 4, fusil_assaut: 4, mitrailleuse: 4, railgun: 5, minigun: 5, magnum_dore: 5, bazooka: 0, lance_grenades: 0,
};
/**
 * Priorité d'un objet pour un bot : arme (selon son rang) > munitions de l'arme portée > bandage si PV bas > potion ; 0 = sans intérêt.
 * Sans arme à feu, n'importe laquelle passe devant tout ; avec une secondaire seule, une principale ; avec une principale, une arme d'au moins deux rangs de
 * mieux. Des munitions n'intéressent que la classe d'une arme portée (et passent devant tout quand toutes les armes sont à sec).
 */
export function prioriteButin(o: ObjetBr, moi: EtatBotPublic): number {
  if (o.genre === "arme") {
    if (o.ref === "epee") return moi.armeFeu ? 0 : 1;
    const rang = RANG_ARME[o.ref ?? ""] ?? 2;
    if (!moi.armeFeu) return 10 + rang;
    if (moi.armeVide && rang > 0) return 11 + rang;
    if (moi.slotArme === "secondaire" && estPrincipale(o.ref) && rang > 0) return 8 + rang;
    return rang >= (RANG_ARME[moi.armeFeu] ?? 2) + 2 ? 7 : 0;
  }
  if (o.genre === "munitions") {
    if (!moi.armeFeu) return 0;
    const classe = o.ref as ClasseMunitions | null;
    if (moi.classesMun && (classe === null || !moi.classesMun.includes(classe))) return 0;
    return moi.armeVide ? 20 : 6;
  }
  if (o.genre === "bandage") return moi.pv < 60 && moi.bandage < 5 ? 5 : moi.bandage < 2 ? 2 : 0;
  if (o.genre === "potion") return moi.potion < 2 ? 3 : 0;
  return 0;
}

/**
 * L'objet à aller chercher : meilleure priorité, à égalité le plus proche. `accessibles` (lot 3b) restreint aux objets de la même composante
 * connexe que le bot ; absent : tous. Null si rien ne l'intéresse.
 */
export function choisirButin(objets: readonly ObjetBr[], moi: EtatBotPublic, accessibles?: ReadonlySet<number>, ignores: Readonly<Record<number, number>> = {}, t = 0): number | null {
  let meilleur: { id: number; prio: number; d: number } | null = null;
  for (const o of objets) {
    if (accessibles && !accessibles.has(o.id)) continue;
    if ((ignores[o.id] ?? -Infinity) > t) continue;
    const prio = prioriteButin(o, moi);
    if (prio <= 0) continue;
    const d = Math.hypot(o.p[0] - moi.p[0], o.p[2] - moi.p[2]);
    if (!meilleur || prio > meilleur.prio || (prio === meilleur.prio && d < meilleur.d)) meilleur = { id: o.id, prio, d };
  }
  return meilleur ? meilleur.id : null;
}

/** Point d'atterrissage : tiré parmi `points`, à 30 m au moins de ceux déjà choisis par d'autres bots (12 essais, sinon le dernier tirage). */
export function choisirAtterrissage(points: readonly Vec3[], deja: readonly Vec3[], alea: () => number, ecartM = 30): Vec3 {
  if (points.length === 0) return [0, 0, 0];
  let choix = points[Math.min(points.length - 1, Math.floor(alea() * points.length))];
  for (let i = 0; i < 12; i++) {
    const c = points[Math.min(points.length - 1, Math.floor(alea() * points.length))];
    choix = c;
    if (deja.every((d) => Math.hypot(d[0] - c[0], d[2] - c[2]) >= ecartM)) break;
  }
  return [choix[0], choix[1], choix[2]];
}

/**
 * Instant (ms serveur) auquel le bot saute : le premier où l'avion passe à portée de planée du point visé (entre 180 et 300 m, tirée), sinon
 * l'instant de plus grand rapprochement. Toujours dans [debutT, finT].
 */
export function instantDeSaut(avion: { debutT: number; finT: number; depart: Vec2; arrivee: Vec2 }, cible: Vec3, alea: () => number): number {
  const portee = 180 + alea() * 120;
  const duree = Math.max(1, avion.finT - avion.debutT);
  const pas = Math.max(50, duree / 200);
  let meilleurT = avion.finT, meilleurD = Infinity;
  for (let t = avion.debutT; t <= avion.finT + 1e-6; t += pas) {
    const k = borne((t - avion.debutT) / duree, 0, 1);
    const x = avion.depart[0] + (avion.arrivee[0] - avion.depart[0]) * k, z = avion.depart[1] + (avion.arrivee[1] - avion.depart[1]) * k;
    const d = Math.hypot(x - cible[0], z - cible[2]);
    if (d <= portee) return t;
    if (d < meilleurD) { meilleurD = d; meilleurT = t; }
  }
  return borne(meilleurT, avion.debutT, avion.finT);
}

/**
 * Composantes connexes (4 voisins) des cases libres d'une grille `largeur × hauteur` (rangée par z puis x : `i = z·largeur + x`), `libre[i] ≠ 0` =
 * case franchissable. `etiquette[i]` vaut 0 pour une case bloquée, sinon le numéro (≥ 1) de sa composante ; `principale` = le numéro de la plus
 * grande. Flood-fill itératif (pas de récursion : la grille BR fait plus de 150 000 cases).
 */
export function etiqueterComposantes(libre: ArrayLike<number>, largeur: number, hauteur: number): { etiquette: Uint8Array | Uint16Array; principale: number } {
  const n = largeur * hauteur;
  const etiquette: Uint8Array | Uint16Array = n > 0 ? new Uint16Array(n) : new Uint8Array(0);
  const pile = new Int32Array(n);
  const tailles: number[] = [0];
  let numero = 0;
  for (let depart = 0; depart < n; depart++) {
    if (!libre[depart] || etiquette[depart]) continue;
    numero++;
    if (numero > 0xffff) break; // jamais en pratique (25 composantes sur la grille BR)
    let sommet = 0, taille = 0;
    pile[sommet++] = depart;
    etiquette[depart] = numero;
    while (sommet > 0) {
      const i = pile[--sommet];
      taille++;
      const x = i % largeur;
      const voisins = [x > 0 ? i - 1 : -1, x < largeur - 1 ? i + 1 : -1, i - largeur, i + largeur];
      for (const v of voisins) {
        if (v < 0 || v >= n || !libre[v] || etiquette[v]) continue;
        etiquette[v] = numero;
        pile[sommet++] = v;
      }
    }
    tailles.push(taille);
  }
  let principale = 0, max = 0;
  for (let k = 1; k < tailles.length; k++) if (tailles[k] > max) { max = tailles[k]; principale = k; }
  return { etiquette, principale };
}

const NOMS_BOTS: readonly string[] = [
  "Rayure", "Moustache", "Safran", "Tigrou", "Griffe", "Zebrure", "Fauve", "Sultan", "Bengal", "Mirabelle", "Rizotto", "Paprika", "Cannelle", "Poivron",
  "Brochette", "Tajine", "Gratin", "Raclette", "Fondue", "Tartine", "Croissant", "Baguette", "Camembert", "Cassoulet", "Ratatouille", "Clafoutis", "Navarin",
  "Blanquette", "Pistou", "Aioli", "Crumble", "Meringue", "Praline", "Nougat", "Calisson", "Guimauve", "Bretzel", "Spatzle", "Gaufre", "Pancake",
];

/**
 * `n` noms de bots, uniques entre eux et distincts des pseudos déjà pris (sans tenir compte de la casse), SANS chiffre final : `nomDeBase` retire les
 * chiffres, « Tigre1 » et « Tigre2 » seraient en conflit. À court de noms, on enchaîne des noms composés (« Rayure Gratin »).
 */
export function nomsDeBots(n: number, pris: readonly string[], alea: () => number): string[] {
  const cle = (s: string): string => s.toLocaleLowerCase("fr");
  const vus = new Set(pris.map(cle));
  const reserve = [...NOMS_BOTS];
  // mélange de Fisher-Yates (le hasard est injecté)
  for (let i = reserve.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [reserve[i], reserve[j]] = [reserve[j], reserve[i]];
  }
  const sortie: string[] = [];
  for (const nom of reserve) {
    if (sortie.length >= n) break;
    if (vus.has(cle(nom))) continue;
    vus.add(cle(nom));
    sortie.push(nom);
  }
  for (let a = 0; sortie.length < n && a < 10_000; a++) {
    const nom = `${NOMS_BOTS[Math.floor(alea() * NOMS_BOTS.length)]} ${NOMS_BOTS[Math.floor(alea() * NOMS_BOTS.length)]}`;
    if (vus.has(cle(nom))) continue;
    vus.add(cle(nom));
    sortie.push(nom);
  }
  return sortie;
}

// ---------------------------------------------------------------------------------------------
// cerveau
// ---------------------------------------------------------------------------------------------

/** Distance (m) à laquelle le bot cherche des objets au sol (le câblage filtre avec la même valeur). */
export const PORTEE_BUTIN_M = 120;
/** Distance (m) à laquelle un bot sans arme à feu se rapproche d'un joueur pour le frapper. */
const PORTEE_POURSUITE_M = 30;
/** Un bot n'engage pas au-delà (la perception du câblage s'arrête à 160 m). */
const PORTEE_COMBAT_MAX_M = 140;
const DISTANCE_RAMASSAGE_M = 2;
const DISTANCE_COUP_M = 2.1;
const EN_CIBLE_RAD = degRad(7);
const ERRANCE_PERIODE_MS = 15_000;
/** Marge (m) avant le bord du cercle courant (ou du cercle visé) à partir de laquelle la zone prime sur le butin. */
export const MARGE_ZONE_M = 12;
/** Un chemin vieux de plus de ceci est recalculé (ms) ; un échec de recherche est oublié après `ECHEC_NAV_MS`. */
export const RECALCUL_CHEMIN_MS = 2_500;
export const ECHEC_NAV_MS = 8_000;
/** Un abri choisi reste valable ce temps (ms) : pas de recherche à chaque décision. */
const ABRI_VALIDE_MS = 1_500;
/** Un joueur perdu de vue est poursuivi vers son dernier point vu pendant ce temps (ms). */
const SOUVENIR_CIBLE_MS = 4_000;
/** Plus près que ça, un bot blessé se bat au lieu de fuir (un dos tourné à 5 m est une cible). */
const DISTANCE_FUITE_MIN_M = 6;
const ARRIVEE_M = 0.6;
/** Fenêtre (ms) et déplacement net minimal (m) d'un bot qui veut marcher ; en dessous il tourne en rond, et l'objet visé est ignoré `IGNORE_TOURNE_EN_ROND_MS`. */
const TOURNE_EN_ROND_MS = 5_000;
const TOURNE_EN_ROND_M = 3;
const IGNORE_TOURNE_EN_ROND_MS = 10_000;

/** Part de la portée de l'arme à laquelle un bot cherche à se tenir (le pompe de près, le sniper de loin). */
const FRACTION_IDEALE: Partial<Record<ArmeFeuId, number>> = { pompe: 0.3, sniper: 0.6, revolver: 0.45, pistolet: 0.45, mini_uzi: 0.4 };
/** Distance de combat voulue (m) : entre 7 m et 70 % de la portée d'engagement. */
export function distanceIdeale(arme: ArmeFeuId, porteeArme: number, engage: number): number {
  return borne(porteeArme * (FRACTION_IDEALE[arme] ?? 0.45), 7, Math.max(7, engage * 0.7));
}

/** PV sous lesquels le bot fuit : plus prudent aux niveaux faibles (37,5 en Entrée, 33,8 en Plat du jour, 30 en Goulaf). */
export function seuilFuite(p: ParamsBot): number { return 45 - 15 * p.agressivite; }

/** Position du bot par rapport à la tempête : distances aux bords (< 0 dedans), et si la zone doit primer sur le butin. */
export interface InfoZone { dBord: number; dCible: number; dehors: boolean; urgent: boolean }
export function infoZone(e: EntreeCerveau): InfoZone | null {
  const z = e.zone;
  if (!z) return null;
  const cur = z.courant ?? { centre: z.centre, rayon: z.rayon };
  const dBord = Math.hypot(e.moi.p[0] - cur.centre[0], e.moi.p[2] - cur.centre[1]) - cur.rayon;
  const dCible = Math.hypot(e.moi.p[0] - z.centre[0], e.moi.p[2] - z.centre[1]) - z.rayon;
  const avance = (z.palier ?? 1) >= 2 || z.phase === "retrecit";
  return { dBord, dCible, dehors: dBord > 0, urgent: dBord > -MARGE_ZONE_M || (avance && dCible > -MARGE_ZONE_M) };
}

/** La cible gardée : la précédente tant qu'elle reste visible à portée, sauf si une autre est à moins de 60 % de sa distance (pas de flottement entre deux cibles). */
export function cibleStable(percus: readonly Percu[], courante: string | null, moi: Vec3, p: ParamsBot, portee: number): Percu | null {
  const plus = choisirCible(percus, moi, p, portee);
  if (!plus || !courante || plus.id === courante) return plus;
  const garde = percus.find((x) => x.id === courante && x.visible && x.distance <= portee);
  return garde && plus.distance >= 0.6 * garde.distance ? garde : plus;
}

function consignesNeutres(e: EntreeCerveau): Consignes {
  return {
    entrees: { avant: 0, droite: 0, saut: false, sprint: false, lacet: e.moi.lacet },
    lacet: e.moi.lacet, tangage: e.moi.tangage, tirer: false, recharger: false, coup: false, sauter: false,
  };
}

/** Déplace le bot vers (gx, gz) à `vitesseM` : `avant` / `droite` réduits à la fraction de la marche d'un joueur. */
function marcherVers(c: Consignes, e: EntreeCerveau, gx: number, gz: number, vitesseM = VITESSE_BOT_M_S): void {
  const { avant, droite } = entreesDepuisDirection(gx - e.moi.p[0], gz - e.moi.p[2], c.lacet);
  const k = borne(vitesseM / MARCHE_JOUEUR_M_S, 0, 1);
  c.entrees = { avant: avant * k, droite: droite * k, saut: false, sprint: false, lacet: c.lacet };
}

/** Direction de regard vers un point (le bot se tourne dans le sens de sa marche). */
function lacetVersPoint(e: EntreeCerveau, gx: number, gz: number): number {
  return capVers(gx - e.moi.p[0], gz - e.moi.p[2]);
}

/** Atterrissage : cible, instant de saut, puis chute vers le point (piqué, parachute ouvert sous 150 m). */
function decisionAtterrissage(m: MemoireBot, e: EntreeCerveau, c: Consignes, alea: () => number): void {
  if (!m.cibleAtt) {
    const base = e.agressif && e.humainProche ? [e.humainProche] : e.points;
    m.cibleAtt = choisirAtterrissage(base.length > 0 ? base : e.points, e.deja, alea);
  }
  if (e.moi.aBord) {
    if (m.instantSaut === null && e.avion) m.instantSaut = instantDeSaut(e.avion, m.cibleAtt, alea);
    if (m.instantSaut !== null && e.t >= m.instantSaut) c.quitterAvion = true;
    return;
  }
  // en chute : cap sur le point, piqué tant qu'on est loin, le parachute s'ouvre bas (le serveur l'ouvre seul sous 90 m)
  const dx = m.cibleAtt[0] - e.moi.p[0], dz = m.cibleAtt[2] - e.moi.p[2];
  const loin = Math.hypot(dx, dz) > 60;
  c.lacet = capVers(dx, dz);
  c.tangage = loin ? -PI / 6 : -PI / 3;
  c.entrees = { avant: 1, droite: 0, saut: false, sprint: false, lacet: c.lacet };
  c.ouvrirParachute = e.moi.p[1] < 150;
}

/** Détecte un bot qui n'avance plus (moins de 0,3 m en 1 s alors qu'il voulait marcher) : saut, contournement d'un côté, chemin à refaire. */
function anticoincage(m: MemoireBot, e: EntreeCerveau, c: Consignes, veutMarcher: boolean): void {
  if (m.refP === null || e.t - m.refT >= 1000) {
    if (m.refP && veutMarcher && Math.hypot(e.moi.p[0] - m.refP[0], e.moi.p[2] - m.refP[2]) < 0.3) {
      m.coinceDepuis = e.t;
      m.sautT = e.t + 450;
      m.detour = -m.detour;
      m.detourJusqua = e.t + 1500;
      m.chemin = [];
      m.cheminT = -Infinity;
      m.butChemin = null;
    }
    m.refP = [...e.moi.p];
    m.refT = e.t;
  }
  // un bot qui bouge sans avancer (oscille dans un virage, longe un obstacle) échappe au test ci-dessus : déplacement net sur 5 s en route vers un butin ou la zone
  if (m.netP === null || e.t - m.netT >= TOURNE_EN_ROND_MS) {
    if (m.netP && veutMarcher && (m.etat === "fouiller" || m.etat === "zone") && Math.hypot(e.moi.p[0] - m.netP[0], e.moi.p[2] - m.netP[2]) < TOURNE_EN_ROND_M) {
      // l'objet visé est écarté un moment (un autre butin, ou la zone, prend le relais), la destination d'errance tirée à nouveau, le chemin refait ailleurs
      if (m.cibleButin !== null) { m.ignores[m.cibleButin] = e.t + IGNORE_TOURNE_EN_ROND_MS; m.cibleButin = null; }
      m.errance = null;
      m.detour = -m.detour;
      m.detourJusqua = e.t + 1500;
      m.chemin = [];
      m.cheminT = -Infinity;
      m.butChemin = null;
    }
    m.netP = [...e.moi.p];
    m.netT = e.t;
  }
  if (e.t < m.sautT) { c.sauter = true; c.entrees.saut = true; }
}

/** Contourne : tourne la direction de marche de ±70° tant que `detourJusqua` n'est pas échu. */
function dirAvecDetour(m: MemoireBot, e: EntreeCerveau, gx: number, gz: number): [number, number] {
  const dx = gx - e.moi.p[0], dz = gz - e.moi.p[2];
  if (e.t >= m.detourJusqua) return [gx, gz];
  const a = degRad(70) * m.detour, ca = Math.cos(a), sa = Math.sin(a);
  return [e.moi.p[0] + dx * ca - dz * sa, e.moi.p[2] + dx * sa + dz * ca];
}

/**
 * Le point vers lequel marcher pour rejoindre `but` : le but lui-même s'il est proche ou en ligne libre, sinon le point à viser le long du chemin A*. Le chemin est
 * refait toutes les `RECALCUL_CHEMIN_MS` ou quand le but a bougé de plus de 6 m ; la réponse « attente » (budget du tic épuisé) garde l'ancien chemin ; un échec est
 * mémorisé `ECHEC_NAV_MS` (marche droite + anti-coincage entre-temps). Sans `nav`, le but.
 */
export function pointDeRoute(m: MemoireBot, e: EntreeCerveau, but: Vec2): Vec2 {
  const nav = e.nav;
  if (!nav) return but;
  const p = e.moi.p;
  if (Math.hypot(but[0] - p[0], but[1] - p[2]) < 5 || nav.ligneLibre(p, but)) { m.chemin = []; m.butChemin = null; return but; }
  if (m.echecBut && e.t < m.echecJusqua && Math.hypot(m.echecBut[0] - but[0], m.echecBut[1] - but[1]) < 20) return but;
  const perime = !m.butChemin || Math.hypot(m.butChemin[0] - but[0], m.butChemin[1] - but[1]) > 6 || e.t - m.cheminT >= RECALCUL_CHEMIN_MS || m.chemin.length === 0;
  if (perime) {
    const r = nav.chercher(p, but);
    if (r.etat === "ok") { m.chemin = r.chemin; m.butChemin = [but[0], but[1]]; m.cheminT = e.t; }
    else if (r.etat === "echec") { m.echecBut = [but[0], but[1]]; m.echecJusqua = e.t + ECHEC_NAV_MS; m.chemin = []; m.butChemin = null; return but; }
  }
  if (m.chemin.length === 0) return but;
  // les points déjà atteints sont retirés (jamais le dernier)
  let i = 0;
  while (i < m.chemin.length - 1 && Math.hypot(m.chemin[i][0] - p[0], m.chemin[i][1] - p[2]) < 1.6) i++;
  if (i > 0) m.chemin = m.chemin.slice(i);
  const vise = nav.viser(p, m.chemin);
  if (!vise) return m.chemin[0];
  // le suivi ne recule jamais : tout ce qui précède le point visé est derrière nous (on l'a coupé en ligne droite), sinon le repli de `viser` (premier point à 3 m)
  // ramènerait le bot vers un point sauté, et il oscillerait dans un virage en épingle
  const k = m.chemin.findIndex((q) => q[0] === vise[0] && q[1] === vise[1]);
  if (k > 0) m.chemin = m.chemin.slice(k);
  return vise;
}

/** L'abri du bot (point proche hors de vue de `danger`), gardé `ABRI_VALIDE_MS` ; null sans `nav` ou sans abri. */
function abriContre(m: MemoireBot, e: EntreeCerveau, danger: Vec3): Vec2 | null {
  if (!e.nav) return null;
  if (e.t - m.abriT >= ABRI_VALIDE_MS) { m.abri = e.nav.abri(e.moi.p, danger); m.abriT = e.t; }
  return m.abri;
}

/** Un pas de décision d'un bot. Renvoie la mémoire mise à jour (copie) et les consignes ; ne modifie pas `m0`. */
export function decider(m0: MemoireBot, e: EntreeCerveau, p: ParamsBot, alea: () => number): { m: MemoireBot; c: Consignes } {
  const m: MemoireBot = { ...m0, ignores: { ...m0.ignores } };
  const c = consignesNeutres(e);
  if (!m.aimInit) { m.aimLacet = e.moi.lacet; m.aimTangage = e.moi.tangage; m.aimInit = true; }

  if (e.moi.aBord || e.moi.enChute) {
    m.etat = "atterrir";
    decisionAtterrissage(m, e, c, alea);
    m.aimLacet = c.lacet; m.aimTangage = c.tangage;
    return { m, c };
  }

  const armeFeu = e.moi.armeFeu;
  const stats = armeFeu ? STATS[armeFeu] : null;
  const utilisable = !!stats && (e.munitions.charge > 0 || e.munitions.reserve > 0);
  const portee = utilisable && stats ? Math.min(stats.portee * p.agressivite, PORTEE_COMBAT_MAX_M) : DISTANCE_COUP_M;
  const porteePoursuite = utilisable ? portee : PORTEE_POURSUITE_M;
  const zi = infoZone(e);
  const seuil = seuilFuite(p);

  // ---- cible de combat : la plus proche visible à portée de poursuite, gardée tant qu'elle reste visible ----
  const cible = cibleStable(e.percus, m.cible, e.moi.p, p, porteePoursuite);
  if (m0.cible && !cible && !e.percus.some((x) => x.id === m0.cible)) m.vuP = null; // elle a disparu (morte, trop loin) : plus de poursuite
  m.cible = cible ? cible.id : null;
  if (cible) { m.vuP = [cible.p[0], cible.p[1], cible.p[2]]; m.vuT = e.t; }

  let but: Vec2 | null = null;
  let vitesse = VITESSE_BOT_M_S;
  /** déplacement sans chemin (esquive, recul : quelques mètres autour de soi) */
  let direct = false;
  let viser = false;
  let rechargeAbritee = false;

  if (cible) {
    if (e.moi.pv < seuil && cible.distance >= DISTANCE_FUITE_MIN_M) {
      // ---- fuir : vers un abri hors de sa vue, sinon vers la zone, sinon à l'opposé ----
      m.etat = "fuir";
      const abri = abriContre(m, e, cible.p);
      if (abri) but = abri;
      else if (e.zone) but = [e.zone.centre[0], e.zone.centre[1]];
      else {
        const dx = e.moi.p[0] - cible.p[0], dz = e.moi.p[2] - cible.p[2], n = Math.max(1e-6, Math.hypot(dx, dz));
        but = [e.moi.p[0] + (dx / n) * 20, e.moi.p[2] + (dz / n) * 20];
      }
    } else {
      // ---- combat ----
      m.etat = "combat";
      viser = true;
      const ideale = utilisable && stats && armeFeu ? distanceIdeale(armeFeu, stats.portee, portee) : 0;
      const aRecharger = utilisable && (e.munitions.recharge || (e.munitions.reserve > 0 && e.munitions.charge < e.munitions.chargeur * 0.25));
      const ax = cible.p[0] - e.moi.p[0], az = cible.p[2] - e.moi.p[2];
      const n = Math.max(1e-6, Math.hypot(ax, az));
      const abri = aRecharger && cible.distance > DISTANCE_FUITE_MIN_M ? abriContre(m, e, cible.p) : null;
      if (abri) { but = abri; rechargeAbritee = true; }
      else if (zi?.dehors) { but = [e.zone!.centre[0], e.zone!.centre[1]]; } // la tempête fait mal : on tire en courant vers le cercle
      else if (!utilisable || cible.distance > ideale * 1.15) but = [cible.p[0], cible.p[2]];
      else {
        if (m.phaseEsquive < 0) m.phaseEsquive = alea();
        direct = true;
        if (cible.distance < ideale * 0.55) but = [e.moi.p[0] - (ax / n) * 8, e.moi.p[2] - (az / n) * 8]; // trop près : recule en tirant
        else {
          const sens = Math.floor(e.t / 1200 + m.phaseEsquive * 2) % 2 === 0 ? 1 : -1; // esquive latérale, dans un sens qui change toutes les 1,2 s
          but = [e.moi.p[0] - (az / n) * 8 * sens, e.moi.p[2] + (ax / n) * 8 * sens];
        }
      }
    }
  } else {
    m.etat = "zone"; // au repos : il erre (les branches ci-dessous précisent)
    const dernier = m.vuP;
    const aBandage = e.moi.pv < 60 && e.moi.bandage > 0;
    const aPotion = !aBandage && e.moi.potion > 0 && (e.moi.bouclier ?? 100) < 25;
    if (zi?.dehors) {
      // hors du cercle : la tempête prime sur tout
      m.etat = "zone";
      but = [e.zone!.centre[0], e.zone!.centre[1]];
    } else if (aBandage || aPotion) {
      // hors de vue : il se soigne sur place (3 à 4 s ; un dégât interrompt)
      m.etat = "soigner";
      c.utiliser = aBandage ? "bandage" : "potion";
    } else if (zi?.urgent) {
      m.etat = "zone";
      but = [e.zone!.centre[0], e.zone!.centre[1]];
    } else if (dernier && e.t - m.vuT < SOUVENIR_CIBLE_MS && e.moi.pv >= seuil && (utilisable || p.agressivite >= 0.75)) {
      // un joueur vient de disparaître : on va voir où il était
      m.etat = "combat";
      if (Math.hypot(dernier[0] - e.moi.p[0], dernier[2] - e.moi.p[2]) < 3) m.vuP = null;
      else but = [dernier[0], dernier[2]];
    } else if (e.agressif && e.humainProche) {
      m.etat = "zone";
      but = [e.humainProche[0], e.humainProche[2]];
    } else {
      // ---- butin : tant qu'il n'a pas d'arme à feu, ou pour des soins / munitions proches ----
      const nouveau = choisirButin(e.objets, e.moi, undefined, m.ignores, e.t);
      const encore = m.cibleButin !== null && e.objets.some((o) => o.id === m.cibleButin);
      m.cibleButin = encore && m.cibleButin !== null && (m.ignores[m.cibleButin] ?? -Infinity) <= e.t ? m.cibleButin : nouveau;
      const objet = m.cibleButin !== null ? e.objets.find((o) => o.id === m.cibleButin) : undefined;
      if (objet) {
        m.etat = "fouiller";
        const d = Math.hypot(objet.p[0] - e.moi.p[0], objet.p[2] - e.moi.p[2]);
        if (d <= DISTANCE_RAMASSAGE_M) {
          c.ramasser = objet.id;
          // le serveur refuse un ramassage inutile ou impossible : l'objet est ignoré quelques secondes pour ne pas bloquer le bot devant lui
          m.ignores[objet.id] = e.t + 4000;
          m.cibleButin = null;
        } else but = [objet.p[0], objet.p[2]];
      } else if (e.zone) {
        m.etat = "zone";
        const dCentre = Math.hypot(e.zone.centre[0] - e.moi.p[0], e.zone.centre[1] - e.moi.p[2]);
        // loin du centre du cercle visé : on le rejoint ; dedans, on erre
        if (dCentre > e.zone.rayon * 0.8) but = [e.zone.centre[0], e.zone.centre[1]];
        else {
          if (!m.errance || e.t - m.errT > ERRANCE_PERIODE_MS || Math.hypot(m.errance[0] - e.moi.p[0], m.errance[1] - e.moi.p[2]) < 6) {
            const a = alea() * 2 * PI, r = Math.sqrt(alea()) * e.zone.rayon * 0.7;
            m.errance = [e.zone.centre[0] + Math.cos(a) * r, e.zone.centre[1] + Math.sin(a) * r];
            m.errT = e.t;
          }
          but = m.errance;
        }
      }
    }
  }

  // ---- où marcher : le but, ou le point à viser le long du chemin ----
  let direction: Vec2 | null = null;
  if (but) {
    const arrive = Math.hypot(but[0] - e.moi.p[0], but[1] - e.moi.p[2]) < ARRIVEE_M;
    if (!arrive) direction = direct ? but : pointDeRoute(m, e, but);
  }
  const veutMarcher = direction !== null;

  // ---- regard et visée ----
  let enCible = false;
  if (viser && cible) {
    const dx = cible.p[0] - e.moi.p[0], dz = cible.p[2] - e.moi.p[2];
    const dy = cible.p[1] + 1.2 - (e.moi.p[1] + 1.95);
    const exact = { lacet: capVers(dx, dz), tangage: Math.atan2(dy, Math.hypot(dx, dz)) };
    const vitesseCible = Math.hypot(cible.vitesse[0], cible.vitesse[2]);
    const bruite = bruitVisee(exact.lacet, exact.tangage, p, cible.distance, vitesseCible, alea);
    m.aimLacet = limiterRotation(m.aimLacet, bruite.lacet, e.dtS, p.rotationMax);
    m.aimTangage = limiterRotation(m.aimTangage, bruite.tangage, e.dtS, p.rotationMax);
    const marge = EN_CIBLE_RAD + sigmaVisee(p, cible.distance, vitesseCible);
    enCible = Math.abs(normaliserAngle(m.aimLacet - exact.lacet)) < marge && Math.abs(m.aimTangage - exact.tangage) < marge;
  } else if (direction) {
    m.aimLacet = limiterRotation(m.aimLacet, lacetVersPoint(e, direction[0], direction[1]), e.dtS, p.rotationMax);
    m.aimTangage = limiterRotation(m.aimTangage, 0, e.dtS, p.rotationMax);
  } else {
    m.aimLacet = limiterRotation(m.aimLacet, e.moi.lacet, e.dtS, p.rotationMax);
    m.aimTangage = limiterRotation(m.aimTangage, 0, e.dtS, p.rotationMax);
  }
  c.lacet = m.aimLacet;
  c.tangage = m.aimTangage;

  // ---- déplacement ----
  if (direction) {
    const [dx, dz] = dirAvecDetour(m, e, direction[0], direction[1]);
    // en combat (le corps garde la visée), la vitesse est bornée par le contrat de rendu : pleine vitesse dans le cône de ±50° et à reculons,
    // ≈ 0,93 m/s en latéral pur, pour que les pieds arrière ne patinent pas (`bot-allure.ts`, spec §1.4)
    if (viser) vitesse = Math.min(vitesse, vitesseMaxSelonDirection(normaliserAngle(capVers(dx - e.moi.p[0], dz - e.moi.p[2]) - c.lacet)));
    marcherVers(c, e, dx, dz, vitesse);
  }
  anticoincage(m, e, c, veutMarcher);

  // ---- armes : recharge, tir, coup ----
  if (utilisable && stats) {
    // l'arme à feu doit être en main (le serveur ne valide un tir que de l'arme tenue, dégainée)
    if (e.moi.arme !== armeFeu && e.moi.slotArme) c.changerArme = e.moi.slotArme;
    if (e.moi.arme !== armeFeu) { /* en cours de dégainage */ }
    else if (e.munitions.recharge) { /* en cours : le câblage termine la recharge */ }
    else if (e.munitions.charge <= 0 || (!viser && e.munitions.charge < e.munitions.chargeur * 0.3 && e.munitions.reserve > 0)
      || (rechargeAbritee && e.munitions.reserve > 0)) c.recharger = true;
    else if (viser && cible && e.moi.sortie && enCible && e.t >= m.pauseJusqua) {
      c.tirer = true;
      if (++m.rafale >= p.rafaleMax) { m.rafale = 0; m.pauseJusqua = e.t + p.pauseMs; }
      m.dernierTirT = e.t;
    }
    if (!cible) m.rafale = 0;
  } else {
    // sans arme à feu utilisable : couteau en main, coup quand la cible est à portée
    if (e.moi.arme !== "couteau") c.changerArme = "couteau";
    if (viser && cible && cible.distance <= DISTANCE_COUP_M && enCible) c.coup = true;
  }
  return { m, c };
}
