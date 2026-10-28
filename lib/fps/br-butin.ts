/**
 * Tables et règles du butin du Battle Royale (PUR : PRNG `mulberry32` à graine, aucune horloge ni hasard global, aucun import de `three`).
 * Tirage initial des objets au sol sur les points de `pointsButin` (br-carte.ts) et effet d'un ramassage sur l'équipement et les soins.
 * Le serveur est seul à tirer (service `match-br-butin.ts`) ; le client ne régénère rien.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (§Butin, §Inventaire)
 */
import { STATS } from "./armes";
import { BR } from "./br-regles";
import { estPrincipale, estSecondaire, estSpecialeOuUnique } from "./equipement";
import {
  copierEquipement,
  type ArmeFeuId, type ClasseMunitions, type Equipement, type GenreObjetBr, type ObjetBr, type PoolButin, type PointButin, type Rarete, type Slot, type Vec3,
} from "./protocole";

/** Les quatre pools, dans l'ordre de tirage. */
export const POOLS_BUTIN: readonly PoolButin[] = ["interieur", "toit", "facade", "route"];
/** Les quatre raretés, dans l'ordre des poids de `POIDS_RARETE_PAR_POOL`. */
export const RARETES: readonly Rarete[] = ["commun", "peu_commun", "rare", "legendaire"];

/**
 * Armes du butin par rareté (ids du registre `armes.ts`, plus l'épée, arme blanche). Exclus : `rayon` (zombies) et `fumigene` (dépend du bus C3).
 */
export const ARMES_PAR_RARETE: Record<Rarete, readonly (ArmeFeuId | "epee")[]> = {
  commun: ["pistolet", "mini_uzi"],
  peu_commun: ["revolver", "mitraillette", "pompe"],
  rare: ["fusil_assaut", "mitrailleuse", "sniper", "epee"],
  legendaire: ["railgun", "minigun", "magnum_dore", "bazooka", "lance_grenades"],
};

/** Poids [commun, peu commun, rare, légendaire] du tirage de la rareté d'une arme, selon le pool du point : le meilleur butin est dans les bâtiments. */
export const POIDS_RARETE_PAR_POOL: Record<PoolButin, [number, number, number, number]> = {
  interieur: [30, 30, 25, 15],
  toit: [35, 35, 22, 8],
  facade: [60, 28, 10, 2],
  route: [75, 20, 5, 0],
};

/** Part des objets posés dans chaque pool (somme = 1). */
export const REPARTITION_POOLS: Record<PoolButin, number> = { interieur: 0.45, toit: 0.10, facade: 0.30, route: 0.15 };

/** Genre d'un objet tiré : arme 46 %, munitions 24 %, bandage 18 %, potion de bouclier 12 %. */
export const POIDS_GENRES: readonly (readonly [GenreObjetBr, number])[] = [["arme", 46], ["munitions", 24], ["bandage", 18], ["potion", 12]];

/** Distance minimale entre deux objets posés (m, en 3D). */
export const ESPACEMENT_BUTIN_M = 1.8;
/** Chargeurs de réserve donnés par une boîte de munitions. */
export const CHARGEURS_PAR_BOITE = 2;
/** Classes de munitions, dans l'ordre du tirage d'une boîte. */
export const CLASSES_MUNITIONS: readonly ClasseMunitions[] = ["legeres", "moyennes", "cartouches"];

/** Nombre d'objets du butin initial : 9 par joueur, entre 120 et 480 (2 joueurs : 120, 50 joueurs : 450). */
export const nbObjetsPour = (nbJoueurs: number): number => {
  const n = Number.isFinite(nbJoueurs) ? Math.round(9 * nbJoueurs) : 0;
  return Math.min(480, Math.max(120, n));
};

/** Générateur pseudo-aléatoire à graine (mulberry32), valeurs dans [0, 1[. */
export function mulberry32(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rareté d'une arme du butin ; une arme hors table (rayon, fumigène) compte comme commune. */
export function raretePourArme(ref: ArmeFeuId | "epee"): Rarete {
  for (const r of RARETES) if ((ARMES_PAR_RARETE[r] as readonly string[]).includes(ref)) return r;
  return "commun";
}

/** Classe de munitions d'une arme à feu, null pour une arme sans réserve (spéciales, uniques, rayon). */
export function classeMunitions(arme: ArmeFeuId): ClasseMunitions | null {
  switch (arme) {
    case "pistolet": case "mini_uzi": case "mitraillette": return "legeres";
    case "fusil_assaut": case "mitrailleuse": return "moyennes";
    case "pompe": case "revolver": case "sniper": return "cartouches";
    default: return null;
  }
}

// ---------- tirage ----------

/** Tirage pondéré : indice du premier poids dont la somme cumulée dépasse `r × total`. */
function indicePondere(poids: readonly number[], alea: () => number): number {
  const total = poids.reduce((s, x) => s + x, 0);
  let r = alea() * total;
  for (let i = 0; i < poids.length; i++) {
    r -= poids[i];
    if (r < 0 && poids[i] > 0) return i;
  }
  for (let i = poids.length - 1; i >= 0; i--) if (poids[i] > 0) return i; // arrondi flottant : dernier poids non nul
  return 0;
}

/** Répartit `total` unités au prorata des `poids` (plus fortes parties fractionnaires d'abord, départage par ordre) : somme exacte. */
function repartir(total: number, poids: readonly number[]): number[] {
  const somme = poids.reduce((s, x) => s + x, 0);
  if (total <= 0 || somme <= 0) return poids.map(() => 0);
  const brut = poids.map((p) => (total * p) / somme);
  const res = brut.map(Math.floor);
  let reste = total - res.reduce((s, x) => s + x, 0);
  const ordre = brut.map((b, i) => ({ i, frac: b - Math.floor(b) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; reste > 0 && k < ordre.length; k++, reste--) res[ordre[k].i]++;
  return res;
}

/** Grille de 1,8 m sur (x, z) : « y a-t-il un objet à moins de 1,8 m ? » en temps constant. */
class GrilleEspacement {
  private readonly cellules = new Map<string, Vec3[]>();
  private cle(i: number, j: number) { return `${i}:${j}`; }
  private cell(v: number) { return Math.floor(v / ESPACEMENT_BUTIN_M); }

  libre(p: Vec3): boolean {
    const ci = this.cell(p[0]), cj = this.cell(p[2]);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const l = this.cellules.get(this.cle(i, j));
        if (!l) continue;
        for (const q of l) if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < ESPACEMENT_BUTIN_M) return false;
      }
    }
    return true;
  }

  poser(p: Vec3): void {
    const k = this.cle(this.cell(p[0]), this.cell(p[2]));
    const l = this.cellules.get(k);
    if (l) l.push(p); else this.cellules.set(k, [p]);
  }
}

/**
 * Butin initial : `nb` objets (moins si les points manquent) posés sur `points` d'après la graine, ids 1..n.
 * Quotas par pool (`REPARTITION_POOLS`) ; un pool qui ne peut pas placer son quota (plus de point à 1,8 m des objets déjà posés) reverse le reste
 * aux pools qui ont encore des candidats, au prorata de leur part. Genre et rareté sont tirés ensuite, objet par objet.
 */
export function genererButin(points: readonly PointButin[], graine: number, nb: number): ObjetBr[] {
  if (!(nb > 0) || points.length === 0) return [];
  const alea = mulberry32(graine);
  const parts = POOLS_BUTIN.map((pool) => REPARTITION_POOLS[pool]);
  const quotas = repartir(Math.floor(nb), parts);

  // candidats de chaque pool, mélangés (Fisher-Yates) ; le curseur n'avance que sur les points essayés
  const candidats = POOLS_BUTIN.map((pool) => {
    const l = points.filter((pt) => pt.pool === pool);
    for (let i = l.length - 1; i > 0; i--) {
      const j = Math.floor(alea() * (i + 1));
      [l[i], l[j]] = [l[j], l[i]];
    }
    return l;
  });
  const curseurs = POOLS_BUTIN.map(() => 0);
  const grille = new GrilleEspacement();
  const posees: { p: Vec3; pool: PoolButin }[] = [];

  /** Pose jusqu'à `n` objets dans le pool `k` ; renvoie combien ont pu l'être. */
  const placer = (k: number, n: number): number => {
    let fait = 0;
    while (fait < n && curseurs[k] < candidats[k].length) {
      const pt = candidats[k][curseurs[k]++];
      if (!grille.libre(pt.p)) continue;
      grille.poser(pt.p);
      posees.push({ p: [pt.p[0], pt.p[1], pt.p[2]], pool: pt.pool });
      fait++;
    }
    return fait;
  };

  let manque = 0;
  for (let k = 0; k < POOLS_BUTIN.length; k++) manque += quotas[k] - placer(k, quotas[k]);
  // débordement : le manque est reversé aux pools qui ont encore des candidats, jusqu'à épuisement
  while (manque > 0) {
    const actifs = POOLS_BUTIN.map((_, k) => k).filter((k) => curseurs[k] < candidats[k].length);
    if (actifs.length === 0) break;
    const don = repartir(manque, actifs.map((k) => parts[k]));
    for (let a = 0; a < actifs.length; a++) manque -= placer(actifs[a], don[a]);
  }

  const genres = POIDS_GENRES.map(([, w]) => w);
  return posees.map(({ p, pool }, i): ObjetBr => {
    const genre = POIDS_GENRES[indicePondere(genres, alea)][0];
    const id = i + 1;
    switch (genre) {
      case "arme": {
        const rarete = RARETES[indicePondere(POIDS_RARETE_PAR_POOL[pool], alea)];
        const liste = ARMES_PAR_RARETE[rarete];
        return { id, genre, ref: liste[Math.floor(alea() * liste.length)], p };
      }
      case "munitions":
        return { id, genre, ref: CLASSES_MUNITIONS[Math.floor(alea() * CLASSES_MUNITIONS.length)], p };
      default:
        return { id, genre, ref: null, p };
    }
  });
}

// ---------- ramassage ----------

export interface ResultatRamassage {
  ok: boolean;
  /** `inutile` : rien à gagner (boîte sans arme compatible, soins au plafond de la pile, épée déjà portée) ; `inconnu` : objet incohérent ; `loin` est réservé au service (distance) */
  raison?: "inutile" | "loin" | "inconnu";
  /** équipement après ramassage (toujours présent quand `ok`) */
  equip?: Equipement;
  /** slot à mettre en main (absent : la main ne change pas) */
  main?: Slot;
  /** nouvelles munitions de l'arme spéciale ou unique ramassée (`STATS[arme].chargeur`) */
  munSpeciale?: number;
  /** objets à déposer aux pieds du joueur (arme remplacée) */
  lache?: { genre: GenreObjetBr; ref: ObjetBr["ref"] }[];
  /** chargeurs de réserve à ajouter à l'arme (boîte de munitions, ou même arme ramassée une seconde fois : +1 chargeur) */
  ajoutMunitions?: { arme: ArmeFeuId; chargeurs: number };
  /** NOUVEAUX totaux des soins (et non des écarts), présents pour un bandage ou une potion */
  soins?: Partial<Record<"bandage" | "potion", number>>;
  /** soins qui ne tiennent pas dans la pile : quantité restée sur l'objet au sol (absent : l'objet est entièrement ramassé) */
  reste?: number;
}

const REFUS = (raison: "inutile" | "inconnu"): ResultatRamassage => ({ ok: false, raison });

/**
 * Effet de `objet` ramassé par un joueur qui porte `equip` et `soins`. Pur : ni distance ni existence de l'objet (ce sont l'affaire du service).
 *  - arme : rangée dans le slot de sa catégorie (principale, secondaire, spéciale ; l'épée remplace l'arme blanche, le couteau ne tombe pas), le
 *    slot passe en main, l'arme qui l'occupait tombe aux pieds ; `sansPrincipale` / `sansSecondaire` disparaissent ; une spéciale ou unique donne
 *    `munSpeciale` = son chargeur plein (déjà portée : chargeur rempli) ; une arme à feu déjà portée donne +1 chargeur de réserve et ne change pas la main ;
 *  - munitions : +2 chargeurs pour l'arme de la classe portée (principale, sinon secondaire), sinon refus `inutile` ;
 *  - bandage / potion : dans la pile (5 / 3), `qte` (1 par défaut) en tenant compte de la place restante.
 */
export function appliquerRamassage(equip: Readonly<Equipement>, soins: Readonly<{ bandage: number; potion: number }>, objet: ObjetBr): ResultatRamassage {
  const eq = copierEquipement(equip);
  switch (objet.genre) {
    case "arme": return ramasserArme(eq, objet.ref);
    case "munitions": {
      const classe = objet.ref;
      if (classe !== "legeres" && classe !== "moyennes" && classe !== "cartouches") return REFUS("inconnu");
      const porteePrincipale = !eq.sansPrincipale && classeMunitions(eq.principale) === classe;
      const porteeSecondaire = !eq.sansSecondaire && classeMunitions(eq.secondaire) === classe;
      if (!porteePrincipale && !porteeSecondaire) return REFUS("inutile");
      return { ok: true, equip: eq, ajoutMunitions: { arme: porteePrincipale ? eq.principale : eq.secondaire, chargeurs: CHARGEURS_PAR_BOITE } };
    }
    case "bandage": return ramasserSoin(eq, "bandage", soins.bandage, BR.usage.bandage.pile, objet.qte);
    case "potion": return ramasserSoin(eq, "potion", soins.potion, BR.usage.potion.pile, objet.qte);
    default: return REFUS("inconnu");
  }
}

function ramasserSoin(eq: Equipement, genre: "bandage" | "potion", stock: number, pile: number, qte: number | undefined): ResultatRamassage {
  const n = qte !== undefined && Number.isFinite(qte) && qte >= 1 ? Math.floor(qte) : 1;
  const place = Math.max(0, pile - Math.max(0, Math.floor(stock)));
  if (place === 0) return REFUS("inutile");
  const pris = Math.min(n, place);
  const res: ResultatRamassage = { ok: true, equip: eq, soins: { [genre]: Math.max(0, Math.floor(stock)) + pris } };
  if (pris < n) res.reste = n - pris;
  return res;
}

function ramasserArme(eq: Equipement, ref: ObjetBr["ref"]): ResultatRamassage {
  if (ref === "epee") {
    if (eq.melee === "epee") return REFUS("inutile");
    eq.melee = "epee"; // le couteau ne tombe pas
    return { ok: true, equip: eq, main: "couteau" };
  }
  if (ref === null || (CLASSES_MUNITIONS as readonly string[]).includes(ref)) return REFUS("inconnu");
  const arme = ref as ArmeFeuId;
  if (estPrincipale(arme)) {
    if (!eq.sansPrincipale && eq.principale === arme) return { ok: true, equip: eq, ajoutMunitions: { arme, chargeurs: 1 } };
    const lache = eq.sansPrincipale ? undefined : [{ genre: "arme" as const, ref: eq.principale }];
    eq.principale = arme;
    delete eq.sansPrincipale;
    return { ok: true, equip: eq, main: "principale", ...(lache ? { lache } : {}) };
  }
  if (estSecondaire(arme)) {
    if (!eq.sansSecondaire && eq.secondaire === arme) return { ok: true, equip: eq, ajoutMunitions: { arme, chargeurs: 1 } };
    const lache = eq.sansSecondaire ? undefined : [{ genre: "arme" as const, ref: eq.secondaire }];
    eq.secondaire = arme;
    delete eq.sansSecondaire;
    return { ok: true, equip: eq, main: "secondaire", ...(lache ? { lache } : {}) };
  }
  if (estSpecialeOuUnique(arme) && arme !== "fumigene") {
    const lache = eq.speciale !== null && eq.speciale !== arme ? [{ genre: "arme" as const, ref: eq.speciale }] : undefined;
    eq.speciale = arme;
    return { ok: true, equip: eq, main: "speciale", munSpeciale: STATS[arme].chargeur, ...(lache ? { lache } : {}) };
  }
  return REFUS("inconnu"); // rayon, fumigène : jamais dans le butin
}
