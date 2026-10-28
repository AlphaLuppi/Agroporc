/**
 * Mode zombies côté client (PUR, testé, ni three ni DOM) : tampon des `snap.zombies` interpolé à l'instant du rendu (appariement par id,
 * apparition et disparition, tableaux préalloués), touches des tirs et de la mêlée sur les tigres, sélection du niveau de détail,
 * rugissements espacés et invite d'interaction (achat, porte, boîte, atout, Pack-a-Punch, disjoncteur, recette, planches, note, relève).
 * v7 : allure et mode des tigres, Truck Muche interpolé, balles qui percent.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« Rendu et performances côté client »), 2026-10-28-zombies-bo1-design.md
 *
 * Aucune horloge ni hasard global : les instants et le hasard sont passés en paramètre.
 */
import { visible, type Monde } from "./collision";
import { MELEE, STATS, nomZombie } from "./armes";
import { meleeDe } from "./equipement";
import { formatArgent } from "./hud-modele";
import { NOM_REMONTOIRS } from "./grenades";
import { FORME_TIGRE, enrouler, pointLocal, toucheTigre } from "./monstres";
import {
  CIBLE_LIVRAISON, decoderZombies, estMelee, idZombie, type ArmeFeuId, type ArmeId, type ArmeMeleeId, type AtoutId, type EtatPartieZombies, type Equipement,
  type SnapZombies, type Vec3, type Zone,
} from "./protocole";
import {
  ATOUTS, FENETRES, NOTES, PIECES_SYNTH, PORTES_PAYANTES, PRIX_BOITE_SOLDES, PRIX_MUNITIONS_AMELIOREE, achatsProches, porteDeId, rayonTruck,
  zonesOuvertes, type Achat,
} from "./zombies-carte";
import { ZOMBIES, echelleZombie, type Allure, type TypeZombie } from "./zombies-vagues";
import type { ModeZombie } from "./protocole";

// ---------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------

/** Profondeur (ms) du tampon des snaps de tigres. */
export const TAMPON_ZOMBIES_MS = 1_500;
/** Tigres au plus par snap (le serveur plafonne à 24 : la marge ne coûte rien). */
export const CAPACITE_ZOMBIES = 32;
/** Snaps gardés au plus (1,5 s à 20 Hz = 30, avec de la marge). */
const ANNEAU = 64;
/** Au-delà de cette distance (m), un tigre n'est ni dessiné ni animé. */
export const DISTANCE_AFFICHAGE_M = 140;
/** Marge (m) du test « devant la caméra » : le tigre a ≈ 3 m de long. */
const MARGE_DEVANT_M = 3.5;
/** Marge (m) de la sphère englobante d'un tigre (pré-filtre des tirs). */
const MARGE_TOUCHE_M = 0.25;
/** Rayon (en m du modèle) de la sphère qui contient toutes les sphères de `FORME_TIGRE`, centrée à (0, 0,3, 0). */
const RAYON_ENGLOBANT = 0.55;
const CENTRE_ENGLOBANT_H = 0.3;

// ---------------------------------------------------------------------------------------------
// Tampon et interpolation
// ---------------------------------------------------------------------------------------------

/** Tigre interpolé de l'image (objet réutilisé d'une image à l'autre : ne pas le conserver). */
export interface ZombieVue {
  id: number;
  x: number;
  z: number;
  cap: number;
  type: TypeZombie;
  /** échelle du modèle (m de la carte par m du modèle) */
  echelle: number;
  griffe: boolean;
  apparition: boolean;
  pvPct: number;
  /** vitesse mesurée entre les deux snaps encadrants (m/s), 0 s'il n'est que dans l'un des deux */
  vitesse: number;
  /** (v7) allure (marche, course, sprint, rampant) et mode (chasse, sortie du sol, fenêtre, saut) */
  allure: Allure;
  mode: Exclude<ModeZombie, "approche">;
}

/** (v7) Truck Muche d'une manche de livraison, interpolé : position, cap, étape (0 arrivée, 1 livraison, 2 départ, 3 épave), PV en %. */
export interface TruckVue { x: number; z: number; cap: number; phase: number; pvPct: number }
const MODES: readonly ZombieVue["mode"][] = ["chasse", "sol", "fenetre", "saut"];

class Instantane {
  ts = 0;
  n = 0;
  restants = 0;
  readonly ids = new Int32Array(CAPACITE_ZOMBIES);
  readonly x = new Float64Array(CAPACITE_ZOMBIES);
  readonly z = new Float64Array(CAPACITE_ZOMBIES);
  readonly cap = new Float64Array(CAPACITE_ZOMBIES);
  readonly type = new Uint8Array(CAPACITE_ZOMBIES);
  readonly drapeaux = new Uint16Array(CAPACITE_ZOMBIES);
  readonly pv = new Uint8Array(CAPACITE_ZOMBIES);
  /** Truck Muche : [xCm, zCm, capMrad, phase, pvPct] ou null */
  truck: number[] | null = null;

  trouver(id: number): number {
    for (let i = 0; i < this.n; i++) if (this.ids[i] === id) return i;
    return -1;
  }
}

const lerpAngle = (a: number, b: number, k: number) => a + enrouler(b - a) * k;

export class MondeZombies {
  private readonly anneau: Instantane[] = Array.from({ length: ANNEAU }, () => new Instantane());
  /** rang du plus ancien snap gardé et nombre de snaps gardés */
  private debut = 0;
  private compte = 0;
  private readonly vues: ZombieVue[] = Array.from({ length: CAPACITE_ZOMBIES }, () => ({
    id: 0, x: 0, z: 0, cap: 0, type: 0 as TypeZombie, echelle: echelleZombie(0), griffe: false, apparition: false, pvPct: 100, vitesse: 0,
    allure: 0 as Allure, mode: "chasse" as ZombieVue["mode"],
  }));
  private nVues = 0;
  private readonly truckVue: TruckVue = { x: 0, z: 0, cap: 0, phase: 0, pvPct: 100 };
  private truckPresent = false;

  private e(k: number): Instantane {
    return this.anneau[(this.debut + k) % ANNEAU];
  }

  /** Un snap reçu à l'horodatage serveur `ts` ; `snap` absent = aucun tigre (lobby, spectateur). */
  alimenter(ts: number, snap: SnapZombies | undefined): void {
    if (this.compte > 0) {
      const dernier = this.e(this.compte - 1);
      // horloge serveur repartie de zéro (serveur redéployé, resynchronisation) : l'ancien tampon ne sert plus à rien, sinon tous les snaps
      // suivants seraient pris pour des retardataires et les tigres figés
      if (ts < dernier.ts - TAMPON_ZOMBIES_MS) this.vider();
      else if (ts < dernier.ts) return; // snap arrivé dans le désordre
      else if (ts === dernier.ts) this.compte--; // même horodatage : remplace
    }
    if (this.compte >= ANNEAU) { this.debut = (this.debut + 1) % ANNEAU; this.compte--; }
    const cible = this.anneau[(this.debut + this.compte) % ANNEAU];
    this.compte++;
    cible.ts = ts;
    cible.n = 0;
    cible.restants = snap ? snap.r : 0;
    cible.truck = snap?.t && snap.t.length >= 5 ? snap.t.slice(0, 5) : null;
    if (snap) {
      const liste = decoderZombies(snap);
      const n = Math.min(liste.length, CAPACITE_ZOMBIES);
      for (let i = 0; i < n; i++) {
        const m = liste[i];
        cible.ids[i] = m.id; cible.x[i] = m.x; cible.z[i] = m.z; cible.cap[i] = m.cap; cible.type[i] = m.type;
        cible.drapeaux[i] = (m.griffe ? 4 : 0) | (m.apparition ? 8 : 0) | (m.allure << 4) | (Math.max(0, MODES.indexOf(m.mode)) << 6);
        cible.pv[i] = m.pvPct;
      }
      cible.n = n;
    }
    while (this.compte > 2 && ts - this.e(0).ts > TAMPON_ZOMBIES_MS) { this.debut = (this.debut + 1) % ANNEAU; this.compte--; }
  }

  /**
   * Tigres interpolés à l'instant serveur `ts` (en général maintenant − `JEU.interpolationMs`) : renvoie leur nombre, ils sont lisibles dans
   * `zombies()`. Un tigre n'existe que s'il figure dans le snap le plus proche de `ts` (il apparaît et disparaît avec lui) ; entre deux snaps
   * qui le contiennent tous les deux, position, cap et vitesse sont interpolés. Avant le plus ancien ou après le plus récent, le snap est tenu.
   */
  echantillon(ts: number): number {
    this.nVues = 0;
    if (this.compte === 0) return 0;
    let A: Instantane, B: Instantane, k: number;
    if (this.compte === 1) { A = B = this.e(0); k = 0; }
    else {
      let i = 0;
      while (i < this.compte - 2 && this.e(i + 1).ts <= ts) i++;
      A = this.e(i);
      B = this.e(i + 1);
      k = Math.min(1, Math.max(0, (ts - A.ts) / Math.max(1, B.ts - A.ts)));
    }
    const proche = k < 0.5 ? A : B;
    const autre = proche === A ? B : A;
    // Truck Muche : interpolé entre les deux snaps qui l'ont, sinon tenu
    this.truckPresent = proche.truck !== null;
    if (proche.truck) {
      const a = A.truck ?? proche.truck, b = B.truck ?? proche.truck;
      this.truckVue.x = (a[0] + (b[0] - a[0]) * k) / 100;
      this.truckVue.z = (a[1] + (b[1] - a[1]) * k) / 100;
      this.truckVue.cap = lerpAngle(a[2] / 1000, b[2] / 1000, k);
      this.truckVue.phase = proche.truck[3];
      this.truckVue.pvPct = proche.truck[4];
    }
    // la fenêtre d'un pas du tampon, pour les vitesses
    const dtS = Math.max(0.001, Math.abs(B.ts - A.ts) / 1000);
    for (let i = 0; i < proche.n; i++) {
      const v = this.vues[this.nVues++];
      const j = autre === proche ? -1 : autre.trouver(proche.ids[i]);
      v.id = proche.ids[i];
      v.type = proche.type[i] as TypeZombie;
      v.echelle = echelleZombie(v.type);
      v.griffe = (proche.drapeaux[i] & 4) !== 0;
      v.apparition = (proche.drapeaux[i] & 8) !== 0;
      v.allure = ((proche.drapeaux[i] >> 4) & 3) as Allure;
      v.mode = MODES[(proche.drapeaux[i] >> 6) & 3];
      v.pvPct = proche.pv[i];
      if (j < 0) {
        v.x = proche.x[i]; v.z = proche.z[i]; v.cap = proche.cap[i]; v.vitesse = 0;
      } else {
        // a = valeur dans A, b = valeur dans B
        const ia = A === proche ? i : j, ib = B === proche ? i : j;
        v.x = A.x[ia] + (B.x[ib] - A.x[ia]) * k;
        v.z = A.z[ia] + (B.z[ib] - A.z[ia]) * k;
        v.cap = lerpAngle(A.cap[ia], B.cap[ib], k);
        v.vitesse = Math.hypot(B.x[ib] - A.x[ia], B.z[ib] - A.z[ia]) / dtS;
      }
    }
    return this.nVues;
  }

  /** Tigres de la dernière interpolation (tableau stable : lire seulement les `n` premiers). */
  zombies(): readonly ZombieVue[] {
    return this.vues;
  }

  nombre(): number {
    return this.nVues;
  }

  /** Tigre interpolé par id (dernière interpolation), null s'il n'y est pas. */
  parId(id: number): ZombieVue | null {
    for (let i = 0; i < this.nVues; i++) if (this.vues[i].id === id) return this.vues[i];
    return null;
  }

  /** (v7) Truck Muche de la dernière interpolation, null s'il n'y en a pas (objet réutilisé). */
  truck(): TruckVue | null {
    return this.truckPresent ? this.truckVue : null;
  }

  /** Tigres restants à tuer annoncés par le dernier snap (pas encore apparus compris), 0 sans snap. */
  restants(): number {
    return this.compte ? this.e(this.compte - 1).restants : 0;
  }

  /** Nombre de tigres du dernier snap reçu. */
  vivants(): number {
    return this.compte ? this.e(this.compte - 1).n : 0;
  }

  vider(): void {
    this.debut = 0;
    this.compte = 0;
    this.nVues = 0;
    this.truckPresent = false;
  }
}

// ---------------------------------------------------------------------------------------------
// Touches
// ---------------------------------------------------------------------------------------------

export interface ToucheZombie { cible: string; zone: Zone; distance: number }

/**
 * Tigre touché par le rayon (o, d normalisé) avant `limite` (premier mur ou joueur) : le plus proche des `n` premiers de `zombies`, forme de
 * touche de `FORME_TIGRE` à l'échelle du type, marge 0,25 m, tête prioritaire sur son propre corps, bloqué par un bâtiment fermé. Pré-filtre par
 * sphère englobante : un tigre loin de la ligne de tir ne coûte qu'un calcul de distance.
 */
export function trouverZombieTouche(
  o: Vec3, d: Vec3, limite: number, zombies: readonly ZombieVue[], monde: Monde | null, n: number = zombies.length,
): ToucheZombie | null {
  let meilleur: ToucheZombie | null = null;
  for (let i = 0; i < n; i++) {
    const z = zombies[i];
    const r = RAYON_ENGLOBANT * z.echelle + MARGE_TOUCHE_M;
    const cx = z.x - o[0], cy = CENTRE_ENGLOBANT_H * z.echelle - o[1], cz = z.z - o[2];
    const proj = cx * d[0] + cy * d[1] + cz * d[2];
    // derrière le tireur (hors de la sphère) ou trop loin pour la limite
    if (proj < -r || proj - r > (meilleur ? meilleur.distance : limite)) continue;
    // distance du centre au rayon
    const perp2 = cx * cx + cy * cy + cz * cz - proj * proj;
    if (perp2 > r * r) continue;
    const h = toucheTigre(o, d, meilleur ? meilleur.distance : limite, [z.x, 0, z.z], z.cap, z.echelle, monde, MARGE_TOUCHE_M);
    if (h && (!meilleur || h.distance < meilleur.distance)) meilleur = { cible: idZombie(z.id), zone: h.zone, distance: h.distance };
  }
  return meilleur;
}

/**
 * (v7) Tous les tigres que traverse une balle qui perce (railgun, sniper amélioré), du plus proche au plus lointain, avant `limite`.
 */
export function trouverZombiesTouches(
  o: Vec3, d: Vec3, limite: number, zombies: readonly ZombieVue[], monde: Monde | null, n: number = zombies.length,
): ToucheZombie[] {
  const res: ToucheZombie[] = [];
  for (let i = 0; i < n; i++) {
    const h = trouverZombieTouche(o, d, limite, zombies.slice(i, i + 1), monde, 1);
    if (h) res.push(h);
  }
  return res.sort((a, b) => a.distance - b.distance);
}

/** (v7) Le Truck Muche touché par le rayon avant `limite` : cible réservée et distance, ou null. */
export function toucheTruckClient(o: Vec3, d: Vec3, limite: number, truck: TruckVue | null): { cible: string; distance: number } | null {
  if (!truck || truck.phase === 3) return null;
  const dist = rayonTruck(o, d, [truck.x, truck.z], truck.cap, limite);
  return dist === null ? null : { cible: CIBLE_LIVRAISON, distance: dist };
}

/**
 * Tigres frappés par l'arme blanche `arme` (mêmes règles que le serveur : sphère la plus proche à ≤ portée de surface, cône de frappe élargi du
 * rayon apparent de la sphère, ligne de vue jusqu'à elle), triés de la plus proche à la plus lointaine. Le tri et la coupe à `nbCiblesMax`,
 * qui mêlent joueurs et tigres, se font chez l'appelant.
 */
export function trouverZombiesMelee(
  o: Vec3, d: Vec3, zombies: readonly ZombieVue[], arme: ArmeMeleeId, monde: Monde | null, n: number = zombies.length,
): { cible: string; distance: number }[] {
  const m = MELEE[arme];
  const angleCone = Math.acos(Math.max(-1, Math.min(1, m.cosCone)));
  const res: { cible: string; distance: number }[] = [];
  for (let i = 0; i < n; i++) {
    const z = zombies[i];
    // pré-filtre : la sphère englobante doit être à portée
    if (Math.hypot(z.x - o[0], z.z - o[2]) - RAYON_ENGLOBANT * z.echelle > m.portee + 1) continue;
    let meilleure = Infinity;
    for (const s of FORME_TIGRE) {
      const c = pointLocal([z.x, 0, z.z], z.cap, z.echelle, s.d, s.h, s.a);
      const r = s.r * z.echelle;
      const vx = c[0] - o[0], vy = c[1] - o[1], vz = c[2] - o[2];
      const l = Math.hypot(vx, vy, vz);
      const distance = Math.max(0, l - r);
      if (distance > m.portee || distance >= meilleure) continue;
      if (l > r) {
        const cos = Math.max(-1, Math.min(1, (vx * d[0] + vy * d[1] + vz * d[2]) / l));
        if (Math.acos(cos) > angleCone + Math.asin(Math.min(1, r / l))) continue;
        if (monde) {
          const k = (l - r) / l;
          if (!visible(monde, o, [o[0] + vx * k, o[1] + vy * k, o[2] + vz * k])) continue;
        }
      }
      meilleure = distance;
    }
    if (meilleure !== Infinity) res.push({ cible: idZombie(z.id), distance: meilleure });
  }
  res.sort((a, b) => a.distance - b.distance);
  return res;
}

// ---------------------------------------------------------------------------------------------
// Affichage : niveau de détail, culling, rugissements
// ---------------------------------------------------------------------------------------------

/** Une image sur combien la pose d'un tigre est recalculée : chaque image à moins de 40 m, une sur deux jusqu'à 80 m, une sur quatre au-delà. */
export function periodeAnimation(distance: number): 1 | 2 | 4 {
  return distance < 40 ? 1 : distance < 80 ? 2 : 4;
}

/** La pose du tigre `id` est-elle recalculée à l'image `image` ? (phases décalées par id : les tigres ne sont pas tous mis à jour ensemble). */
export function animerCetteImage(distance: number, image: number, id: number): boolean {
  const p = periodeAnimation(distance);
  return p === 1 || (image + id) % p === 0;
}

/** Culling manuel : le tigre est dessiné s'il est à moins de 140 m et devant la caméra (demi-plan du regard horizontal, marge de sa longueur). */
export function tigreAffiche(cam: Vec3, regardX: number, regardZ: number, x: number, z: number): boolean {
  const dx = x - cam[0], dz = z - cam[2];
  if (dx * dx + dz * dz > DISTANCE_AFFICHAGE_M * DISTANCE_AFFICHAGE_M) return false;
  const l = Math.hypot(regardX, regardZ) || 1;
  return (dx * regardX + dz * regardZ) / l > -MARGE_DEVANT_M;
}

/** Rugissements espacés : un tigre proche (≤ 60 m) rugit de temps en temps, plus souvent quand il y en a beaucoup. */
export class Rugissements {
  private reste = 2;

  /** Id du tigre qui rugit à cette image, ou null. `alea` ∈ [0, 1[ (injecté). */
  maj(dt: number, zombies: readonly ZombieVue[], n: number, cam: Vec3, alea: () => number): number | null {
    this.reste -= dt;
    if (this.reste > 0) return null;
    const proches: number[] = [];
    for (let i = 0; i < n; i++) if (Math.hypot(zombies[i].x - cam[0], zombies[i].z - cam[2]) <= 60) proches.push(i);
    // prochain rugissement : 1,5 à 4 s, divisé par le nombre de tigres proches (au plus 3)
    this.reste = (1.5 + alea() * 2.5) / Math.min(3, Math.max(1, proches.length));
    if (!proches.length) return null;
    return zombies[proches[Math.min(proches.length - 1, Math.floor(alea() * proches.length))]].id;
  }
}

// ---------------------------------------------------------------------------------------------
// Invite d'interaction
// ---------------------------------------------------------------------------------------------

export type GenreInvite = "" | "acheter" | "porte" | "boite" | "atout" | "pap" | "courant" | "ingredient" | "four" | "reanimer" | "reparer" | "note";

export interface InviteZombies {
  invite: GenreInvite;
  /** texte après « [E] » : « Pompe — 900 $ », « Ouvrir : Labo R&D — 1 500 $ », « Réanimer Léa », « Reposer les planches » */
  detail: string;
  /** prix en $ (0 pour une relève) et argent suffisant (et achat possible) */
  prix: number;
  assez: boolean;
  /** id du catalogue à envoyer à `acheter` ("" pour une relève ; id de fenêtre pour `reparer` ; `note:<n>` pour une note) */
  id: string;
  /** coéquipier à relever (`reanimer`), null sinon */
  cible: string | null;
  /** raison écrite d'un achat impossible (« Courant coupé », « Occupé »…), absente sinon */
  bloque?: string;
}

export const INVITE_VIDE: InviteZombies = Object.freeze({ invite: "", detail: "", prix: 0, assez: true, id: "", cible: null });

export interface CoequipierATerre { id: string; pseudo: string; p: Vec3 }

/** Ce que l'invite lit de la partie (sous-ensemble de `EtatPartieZombies`). */
export type PartieInvite = Pick<EtatPartieZombies, "courant" | "boite" | "pap" | "quete" | "effets" | "fenetres" | "portes">;

export interface EntreeInvite {
  /** position (x, z) du joueur */
  pos: readonly [number, number];
  argent: number;
  portesOuvertes: ReadonlySet<string> | readonly string[];
  equip: Equipement;
  /** arme en main (Pack-a-Punch) */
  enMain?: ArmeId;
  pv: number;
  /** coéquipiers à terre (état `terre` de la partie), positions interpolées */
  aTerre: readonly CoequipierATerre[];
  /** (v7) état de la partie, mes atouts, mon id, partie en solo, horloge serveur (ms) */
  partie?: PartieInvite | null;
  atouts?: readonly AtoutId[];
  moi?: string;
  solo?: boolean;
  maintenant?: number;
}

function possede(eq: Equipement, a: ArmeFeuId): boolean {
  return (!eq.sansPrincipale && eq.principale === a) || eq.secondaire === a || eq.speciale === a;
}

const NOMS_INGREDIENTS: Readonly<Record<string, string>> = { sel: "Sel de Guérande", herbes: "Herbes du Trèfle", truffe: "Truffe noire" };

type Description = Omit<InviteZombies, "assez" | "cible"> & { bloque?: string };

/** Libellé, prix et genre d'un achat pour ce joueur ; null s'il n'y a rien à acheter (épée déjà possédée…). */
function descriptionAchat(a: Achat, e: EntreeInvite): Description | null {
  const p = e.partie ?? null;
  const t = e.maintenant ?? 0;
  const ameliorees = new Set(e.equip.ameliorees ?? []);
  switch (a.genre) {
    case "porte": {
      const porte = a.porte ? porteDeId(a.porte) : null;
      if (!porte) return null;
      const accessibles = zonesOuvertes(e.portesOuvertes instanceof Set ? e.portesOuvertes : new Set(e.portesOuvertes));
      const d: Description = { invite: "porte", detail: `Ouvrir : ${porte.nom} — ${formatArgent(a.prix)}`, prix: a.prix, id: a.id };
      if (!accessibles.has(porte.zones[0]) && !accessibles.has(porte.zones[1])) return { ...d, bloque: "Verrouillée" };
      return d;
    }
    case "boite": {
      if (p && p.boite.emplacement !== a.emplacement) return null;
      if (p && p.boite.etat === "offre") {
        if (p.boite.pour !== e.moi || !p.boite.arme || p.boite.arme === "peluche") return { invite: "boite", detail: "Boîte mystère", prix: 0, id: a.id, bloque: "Occupée" };
        return { invite: "boite", detail: `Prendre : ${p.boite.arme === "remontoir" ? NOM_REMONTOIRS : STATS[p.boite.arme].nom}`, prix: 0, id: a.id };
      }
      if (p && p.boite.etat !== "fermee") return { invite: "boite", detail: "Boîte mystère", prix: 0, id: a.id, bloque: "Occupée" };
      const prix = p && t < p.effets.soldesFinT ? PRIX_BOITE_SOLDES : a.prix;
      return { invite: "boite", detail: `Boîte mystère — ${formatArgent(prix)}`, prix, id: a.id };
    }
    case "atout": {
      const at = a.atout!;
      const info = ATOUTS[at];
      if (e.atouts?.includes(at)) return null;
      const prix = at === "pausecafe" && e.solo ? info.prixSolo ?? info.prix : info.prix;
      const d: Description = { invite: "atout", detail: `${info.nom} — ${formatArgent(prix)}`, prix, id: a.id };
      if (at !== "pausecafe" && p && !p.courant) return { ...d, bloque: "Courant coupé" };
      return d;
    }
    case "pap": {
      const arme = e.enMain;
      const d: Description = { invite: "pap", detail: `Micro-ondes Gratinator — ${formatArgent(a.prix)}`, prix: a.prix, id: a.id };
      if (p && !p.courant) return { ...d, bloque: "Courant coupé" };
      if (p && p.pap.etat !== "libre") return { ...d, bloque: "En cuisson" };
      if (!arme || estMelee(arme)) return { ...d, bloque: "Prenez une arme à feu" };
      if (ameliorees.has(arme)) return { ...d, bloque: "Déjà gratinée" };
      return { ...d, detail: `Gratiner : ${STATS[arme].nom} — ${formatArgent(a.prix)}` };
    }
    case "courant":
      if (p?.courant) return null;
      return { invite: "courant", detail: "Rétablir le courant", prix: 0, id: a.id };
    case "ingredient": {
      if (p && p.quete.ingredients.includes(a.ingredient!)) return null;
      if (a.ingredient === "truffe" && p && !p.courant) return null;
      return { invite: "ingredient", detail: `Ramasser : ${NOMS_INGREDIENTS[a.ingredient!] ?? a.ingredient}`, prix: 0, id: a.id };
    }
    case "four": {
      if (!p || p.quete.faite) return null;
      const d: Description = { invite: "four", detail: "Cuisiner la Recette ultime", prix: 0, id: a.id };
      if (p.quete.cuissonFinT) return { ...d, bloque: "En cuisson" };
      if (!p.courant) return { ...d, bloque: "Courant coupé" };
      if (p.quete.ingredients.length < 3) return { ...d, bloque: `Ingrédients ${p.quete.ingredients.length} / 3` };
      return d;
    }
    case "mur": {
      const arme = a.arme!;
      if (arme === "epee") {
        if (meleeDe(e.equip) === "epee") return null;
        return { invite: "acheter", detail: `${MELEE.epee.nom} — ${formatArgent(a.prix)}`, prix: a.prix, id: a.id };
      }
      if (possede(e.equip, arme)) {
        if (a.prixMunitions === undefined) return null;
        const am = ameliorees.has(arme);
        const prix = am ? PRIX_MUNITIONS_AMELIOREE : a.prixMunitions;
        return { invite: "acheter", detail: `Munitions ${nomZombie(arme, am)} — ${formatArgent(prix)}`, prix, id: a.id };
      }
      return { invite: "acheter", detail: `${STATS[arme].nom} — ${formatArgent(a.prix)}`, prix: a.prix, id: a.id };
    }
  }
}

/**
 * Invite sous le viseur : un coéquipier à terre à ≤ 2,5 m passe avant tout (la relève se maintient), puis le plus proche des achats à portée
 * (murs, objets à 2,5 m, portes à 3 m de leur segment, portes déjà ouvertes écartées), des fenêtres à reposer (≤ 2,2 m du côté intérieur) et
 * des notes (≤ 1,8 m). Le prix et l'argent disent si l'achat est possible ; le serveur reste seul juge (ligne de vue, partie en cours).
 */
export function inviteZombies(e: EntreeInvite): InviteZombies {
  let proche: CoequipierATerre | null = null;
  let dMin: number = ZOMBIES.reanimationPortee;
  for (const c of e.aTerre) {
    const d = Math.hypot(c.p[0] - e.pos[0], c.p[2] - e.pos[1]);
    if (d <= dMin) { dMin = d; proche = c; }
  }
  if (proche) return { invite: "reanimer", detail: `Réanimer ${proche.pseudo}`, prix: 0, assez: true, id: "", cible: proche.id };
  const candidats: { d: number; inv: InviteZombies }[] = [];
  const p = e.partie ?? null;
  for (const a of achatsProches([e.pos[0], e.pos[1]], {
    ouvertes: e.portesOuvertes instanceof Set ? [...e.portesOuvertes] : e.portesOuvertes,
    ...(p ? { boite: p.boite.emplacement, ingredientsPris: p.quete.ingredients, courant: p.courant } : {}),
  })) {
    const d = descriptionAchat(a, e);
    if (!d) continue;
    const { bloque, ...reste } = d;
    const dist = a.genre === "porte" ? 0.5 : Math.hypot(a.position[0] - e.pos[0], a.position[1] - e.pos[1]);
    candidats.push({ d: dist, inv: { ...reste, assez: e.argent >= d.prix && !bloque, cible: null, ...(bloque ? { bloque } : {}) } });
    break;
  }
  if (p) {
    FENETRES.forEach((f, i) => {
      const n = p.fenetres[i] ?? ZOMBIES.planches;
      if (n >= ZOMBIES.planches) return;
      const d = Math.hypot(f.dedans[0] - e.pos[0], f.dedans[1] - e.pos[1]);
      if (d > ZOMBIES.reposePortee) return;
      candidats.push({ d, inv: { invite: "reparer", detail: `Reposer les planches (${n} / ${ZOMBIES.planches})`, prix: 0, assez: true, id: f.id, cible: null } });
    });
  }
  for (const n of NOTES) {
    const d = Math.hypot(n.position[0] - e.pos[0], n.position[1] - e.pos[1]);
    if (d <= 1.8) candidats.push({ d: d + 0.3, inv: { invite: "note", detail: "Lire la note", prix: 0, assez: true, id: `note:${n.id}`, cible: null } });
  }
  if (!candidats.length) return INVITE_VIDE;
  candidats.sort((x, y) => x.d - y.d);
  return candidats[0].inv;
}

/**
 * Portes payantes encore fermées, avec le segment p → q (repère de la carte) de leur première pièce : la grande carte les dessine en
 * ambre barré. Les portes ouvertes (`portesOuvertes`) disparaissent de la liste.
 */
export function segmentsPortesFermees(ouvertes: ReadonlySet<string> | readonly string[]): { id: string; p: [number, number]; q: [number, number] }[] {
  const o = ouvertes instanceof Set ? ouvertes : new Set(ouvertes);
  const res: { id: string; p: [number, number]; q: [number, number] }[] = [];
  for (const porte of PORTES_PAYANTES) {
    if (o.has(porte.id)) continue;
    const piece = PIECES_SYNTH.find((x) => x.id === porte.prismes[0]);
    if (piece) res.push({ id: porte.id, p: [piece.p[0], piece.p[1]], q: [piece.q[0], piece.q[1]] });
  }
  return res;
}
