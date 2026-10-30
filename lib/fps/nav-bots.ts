/**
 * Navigation des bots du Battle Royale (PUR : l'horloge est passée à chaque appel, aucun hasard ni état global ; ne voit le monde que par `Monde`).
 *
 * Trois morceaux, tous bâtis sur la grille de navigation des tigres (`grilleNav` de `tigre-arene.ts` : cases de 1,5 m, dégagement 0,8 m, à jour des bâtiments
 * détruits ; PAS `carteNavigation`, dont les cases de 2,01 m laissent passer les murs fins et ferment les portes de 2,6 m) :
 *  - `BudgetNavigation` : au plus UNE recherche A* par tic pour tout le serveur (file FIFO partagée entre les salles BR), 3 000 nœuds au plus par recherche ;
 *  - l'étiquetage des composantes connexes de la grille (une fois par grille, ≈ 59 ms, 25 composantes dont une de 139 000 cases) : une cible d'une autre
 *    composante que le bot n'est jamais cherchée (un A* échoue en 50 à 450 ms) ;
 *  - `creerNavigateur` : l'objet `NavBot` que le cerveau (`bots-br.ts`) appelle pour savoir si la ligne est libre, chercher un chemin, viser le long de ce
 *    chemin ou trouver un abri.
 * Précalcul au démarrage du serveur (`preparerNavigationBr`, avant `listen`) puis copie dans chaque nouvelle salle (`installerNavigationBr`) : la
 * première `grilleNav` d'un monde coûte ≈ 430 ms, ce qui gèlerait toutes les parties à la création de la suivante.
 * Spec : docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md (§1.4 « Navigation » et « Budget de calcul du serveur »)
 */
import type { NavBot, ReponseChemin } from "./bots-br";
import { etiqueterComposantes } from "./bots-br";
import { lancerRayon, visible, type Monde } from "./collision";
import type { Vec3 } from "./protocole";
import { PAS_NAV_M, caseLibre, chercherCheminBorne, copierGrilleNav, grilleNav, type GrilleNav } from "./tigre-arene";

type Vec2 = [number, number];

/** Nœuds explorés au plus par une recherche (au lieu de `NOEUDS_MAX` = 20 000 de `tigre-arene.ts`) : ≈ 1 à 3 ms. */
export const NOEUDS_MAX_BOT = 3_000;
/** Un but plus lointain est approché par étapes : le chemin vise un point à cette distance sur la droite vers le but. */
export const ETAPE_MAX_M = 90;
/** Délai entre deux recherches de tout le serveur (ms) : un peu moins d'un tic à 60 Hz, pour que les salles tiquées dans la même passe se partagent un seul A*. */
export const PERIODE_BUDGET_MS = 12;
/** Une demande restée sans réponse plus longtemps est abandonnée (le bot a disparu ou ne redemande plus). */
export const PEREMPTION_DEMANDE_MS = 2_000;

// ---------------------------------------------------------------------------------------------
// budget
// ---------------------------------------------------------------------------------------------

/**
 * Au plus une recherche de chemin par période pour TOUT le serveur, accordée dans l'ordre des demandes (file FIFO) : à l'atterrissage, onze bots demandent
 * un chemin en même temps, ils passent l'un après l'autre sur plusieurs tics. Un bot qui n'est pas en tête de file n'obtient rien tant que la tête n'a pas
 * eu son tour ; une tête qui ne redemande plus (morte, retirée) est purgée après `PEREMPTION_DEMANDE_MS`.
 */
export class BudgetNavigation {
  private file: { id: string; t: number }[] = [];
  private dernierT = -Infinity;
  /** compteurs (tests, `/sante`) */
  recherches = 0;
  noeudsMax = 0;

  constructor(readonly periodeMs: number = PERIODE_BUDGET_MS, readonly peremptionMs: number = PEREMPTION_DEMANDE_MS) {}

  /** Vrai si le bot `id` peut lancer SA recherche maintenant (et la consomme) ; faux : il est (ou reste) dans la file, à redemander plus tard. */
  demander(id: string, t: number): boolean {
    if (this.file.length > 0 && t - this.file[0].t >= this.peremptionMs) this.file = this.file.filter((x) => t - x.t < this.peremptionMs);
    const tete = this.file[0];
    if (t - this.dernierT >= this.periodeMs && (!tete || tete.id === id)) {
      if (tete) this.file.shift();
      this.dernierT = t;
      this.recherches++;
      return true;
    }
    if (!this.file.some((x) => x.id === id)) this.file.push({ id, t });
    return false;
  }

  /** Note les nœuds explorés par la dernière recherche (le plus gros, pour les tests de charge). */
  noter(noeuds: number): void { if (noeuds > this.noeudsMax) this.noeudsMax = noeuds; }

  /** Le bot `id` n'existe plus : il quitte la file. */
  retirer(id: string): void { this.file = this.file.filter((x) => x.id !== id); }

  get enAttente(): number { return this.file.length; }
}

// ---------------------------------------------------------------------------------------------
// composantes connexes
// ---------------------------------------------------------------------------------------------

export interface Etiquetage { etiquette: Uint8Array | Uint16Array; principale: number }
const ETIQUETAGES = new WeakMap<GrilleNav, Etiquetage>();

/** Composantes connexes de la grille (étiquetées une fois, gardées avec elle). */
export function etiquetageDe(g: GrilleNav): Etiquetage {
  let e = ETIQUETAGES.get(g);
  if (!e) { e = etiqueterComposantes(g.libre, g.nx, g.nz); ETIQUETAGES.set(g, e); }
  return e;
}

/** Numéro de la composante de la case libre la plus proche de (x, z), 0 si aucune à 4 cases. */
export function composanteDe(g: GrilleNav, e: Etiquetage, x: number, z: number): number {
  const k = caseLibre(g, x, z);
  return k < 0 ? 0 : e.etiquette[k];
}

/**
 * Précalcul au démarrage : grille et composantes d'un monde de référence (hypothèse : monde BR statique pour la navigation des bots, aucun bâtiment détruit).
 * Renvoie la grille, à garder pour `installerNavigationBr`.
 */
export function preparerNavigationBr(monde: Monde): GrilleNav {
  const g = grilleNav(monde);
  etiquetageDe(g);
  return g;
}

/**
 * Donne à `monde` (celui d'une salle neuve, de même construction que la référence) une copie de la grille précalculée : `libre` ET `etats` copiés, tampons
 * neufs, composantes partagées en lecture seule. La première `grilleNav(monde)` ne coûte alors plus rien.
 */
export function installerNavigationBr(monde: Monde, reference: GrilleNav): GrilleNav | null {
  const copie = copierGrilleNav(reference, monde);
  if (copie && !ETIQUETAGES.has(copie)) ETIQUETAGES.set(copie, etiquetageDe(reference));
  return copie;
}

// ---------------------------------------------------------------------------------------------
// navigateur d'un bot
// ---------------------------------------------------------------------------------------------

export interface OptionsNavigateur {
  monde: Monde;
  budget: BudgetNavigation;
  /** clé du bot DANS le budget : unique au serveur (les ids `b<n>` de deux salles se recoupent), cf. `creerBotsBr` */
  id: string;
  /** instant de la décision (ms serveur) */
  t: number;
}

/** Hauteur (m) des rayons de la ligne libre et des flancs (demi-largeur du corps d'un bot). */
const HAUTEUR_RAYON_M = 1;
const DEMI_LARGEUR_M = 0.45;
const OEIL_M = 1.95;
const POITRINE_M = 1.2;
/** Abri : rayons d'essai (m) autour du bot et nombre de directions. */
const RAYONS_ABRI_M = [8, 14] as const;
const DIRECTIONS_ABRI = 8;
const ANGLES_ETAPE = [0, 0.45, -0.45, 0.9, -0.9] as const;

/**
 * Le but intermédiaire d'un but lointain : sur la droite vers le but à `ETAPE_MAX_M`, décalé de quelques angles tant que la case n'est pas libre (le point droit
 * peut tomber dans un bâtiment). Null si aucune case libre n'est trouvée.
 */
export function butIntermediaire(g: GrilleNav, de: Vec3, but: Vec2): Vec2 | null {
  const dx = but[0] - de[0], dz = but[1] - de[2];
  const d = Math.hypot(dx, dz);
  if (d <= ETAPE_MAX_M) return but;
  const base = Math.atan2(dz, dx);
  for (const a of ANGLES_ETAPE) {
    const x = de[0] + Math.cos(base + a) * ETAPE_MAX_M, z = de[2] + Math.sin(base + a) * ETAPE_MAX_M;
    if (caseLibre(g, x, z) >= 0) return [x, z];
  }
  return null;
}

/** Portée (m) du point visé le long d'un chemin. */
const PORTEE_VISEE_M = 40;
/** Un virage de plus de ce cosinus (≈ 60°) arrête la visée : les marches d'escalier d'un chemin de grille (45°) n'en sont pas. */
const COS_VIRAGE = 0.5;

/**
 * Indice (dans `chemin`) du premier sommet où la direction tourne de plus de ~60°, la position `de` du bot comptant comme point de départ du tracé
 * (le dernier indice si rien ne tourne).
 */
export function premierVirage(de: Vec3, chemin: readonly Vec2[]): number {
  let px = de[0], pz = de[2];
  for (let i = 0; i < chemin.length - 1; i++) {
    const ax = chemin[i][0] - px, az = chemin[i][1] - pz;
    const bx = chemin[i + 1][0] - chemin[i][0], bz = chemin[i + 1][1] - chemin[i][1];
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la > 1e-6 && lb > 1e-6 && (ax * bx + az * bz) / (la * lb) < COS_VIRAGE) return i;
    if (la > 1e-6) { px = chemin[i][0]; pz = chemin[i][1]; }
  }
  return chemin.length - 1;
}

/** Le `NavBot` d'un bot pour une décision. Les calculs coûteux (grille, composantes) ne se font qu'à la demande. */
export function creerNavigateur(o: OptionsNavigateur): NavBot {
  const { monde, budget, id, t } = o;
  const ligneLibreDe = (de: Vec3, but: Vec2): boolean => {
    const dx = but[0] - de[0], dz = but[1] - de[2];
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) return true;
    const ux = dx / l, uz = dz / l;
    for (const k of [0, -1, 1]) {
      const origine: Vec3 = [de[0] - uz * DEMI_LARGEUR_M * k, HAUTEUR_RAYON_M, de[2] + ux * DEMI_LARGEUR_M * k];
      if (lancerRayon(monde, origine, [ux, 0, uz], l) !== Infinity) return false;
    }
    return true;
  };
  return {
    ligneLibre: ligneLibreDe,

    chercher(de: Vec3, but: Vec2): ReponseChemin {
      const g = grilleNav(monde);
      const e = etiquetageDe(g);
      const cs = composanteDe(g, e, de[0], de[2]);
      const cb = composanteDe(g, e, but[0], but[1]);
      // un but d'une autre composante (ou sans case libre à côté) ne se rejoint jamais : inutile de chercher
      if (cs === 0 || cb === 0 || cs !== cb) return { etat: "echec" };
      const objectif = butIntermediaire(g, de, but);
      if (!objectif) return { etat: "echec" };
      if (!budget.demander(id, t)) return { etat: "attente" };
      const r = chercherCheminBorne(g, de[0], de[2], objectif[0], objectif[1], NOEUDS_MAX_BOT);
      budget.noter(r.noeuds);
      return r.chemin ? { etat: "ok", chemin: r.chemin, etape: objectif !== but } : { etat: "echec" };
    },

    viser(de: Vec3, chemin: readonly Vec2[]): Vec2 | null {
      if (chemin.length === 0) return null;
      // jamais au-delà du premier virage serré du chemin : couper un angle vu de loin fait buter le bot sur l'arête d'un mur que la grille ne voit pas, il longe
      // alors le mur, le chemin refait depuis ce nouvel endroit repart dans l'autre sens et le bot oscille. On passe le virage point par point.
      const fin = Math.min(chemin.length - 1, premierVirage(de, chemin));
      // le plus lointain point jusque-là (40 m au plus) vu sans mur (rayons au centre et aux flancs)
      let choisi: Vec2 | null = null;
      for (let i = 0; i <= fin; i++) {
        const q = chemin[i];
        const l = Math.hypot(q[0] - de[0], q[1] - de[2]);
        if (l > PORTEE_VISEE_M) break;
        if (l >= PAS_NAV_M * 2 && ligneLibreDe(de, q)) choisi = q;
      }
      if (choisi) return choisi;
      for (let i = 0; i <= fin; i++) if (Math.hypot(chemin[i][0] - de[0], chemin[i][1] - de[2]) >= PAS_NAV_M * 2) return chemin[i];
      return chemin[fin];
    },

    abri(de: Vec3, danger: Vec3): Vec2 | null {
      const g = grilleNav(monde);
      const oeil: Vec3 = [danger[0], danger[1] + OEIL_M, danger[2]];
      for (const r of RAYONS_ABRI_M) {
        // le plus proche des points à couvert du rayon, en commençant par la direction opposée au danger
        const fuite = Math.atan2(de[2] - danger[2], de[0] - danger[0]);
        for (let i = 0; i < DIRECTIONS_ABRI; i++) {
          const a = fuite + ((i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 2 * Math.PI) / DIRECTIONS_ABRI;
          const x = de[0] + Math.cos(a) * r, z = de[2] + Math.sin(a) * r;
          const k = caseLibre(g, x, z);
          if (k < 0 || !g.libre[k]) continue;
          const cx = g.x0 + ((k % g.nx) + 0.5) * PAS_NAV_M, cz = g.z0 + (Math.floor(k / g.nx) + 0.5) * PAS_NAV_M;
          if (!visible(monde, oeil, [cx, de[1] + POITRINE_M, cz])) return [cx, cz];
        }
      }
      return null;
    },
  };
}
