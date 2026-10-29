/**
 * Corps des tigres du mode zombies (PUR : ni three ni DOM, importé par le client ET le serveur) : une capsule horizontale par tigre,
 * sur l'axe de son cap (avant = (−sin, −cos)), tête exclue, que le joueur ne traverse pas (`etape(…, obstacles)` de `mouvement.ts`).
 *
 * Dimensions, d'après `FORME_TIGRE` (monstres.ts, en m du modèle × l'échelle du tigre) : le corps va de −0,335 (croupe) à +0,315
 * (poitrail), sur 0,115 de rayon, jusqu'au dos (0,45) ; rayon d'au moins `rayonMinM`. Le ratio, à BO1 : un tigre seul (0,62 m de large)
 * dans une porte de 2,6 m laisse 0,99 m de chaque côté, le joueur (0,8 m) passe de justesse ; deux tigres côte à côte (1,4 m d'entraxe,
 * `ZOMBIES.separationM`) ne laissent que 0,78 m entre eux : ils arrêtent qui marche droit, mais on se faufile en sautant ou en pas chassé
 * (le joueur s'efface face aux tigres : `rayonContreTigres` de `mouvement.ts`) ; il faut deux tigres bien placés (de biais, ou un collé au
 * montant) pour fermer la porte. Le rayon minimal vaut aussi pour les petits du Truck : un
 * groupe de petits ferme le passage comme des grands, mais on saute par-dessus un petit (dos à 0,68 m). Un tigre arrêté à portée de patte
 * (`porteePatte − griffeMargeDepartM`) ne touche pas le joueur : on bute sur lui seulement en fonçant dedans (testé pour chaque type).
 *
 * Tigres ignorés : morts (`pvPct` ≤ 0), qui sortent du sol (`sol`), sautent la fenêtre (`saut`) ou attendent dehors derrière la barricade
 * (`fenetre`) ; côté serveur aussi ceux qui approchent de leur fenêtre (`approche`).
 */
import type { Capsule } from "./collision";
import type { ModeZombie } from "./protocole";
import type { Allure } from "./zombies-vagues";

/** Géométrie du corps (m du modèle, × l'échelle) ; `rayonMinM` en m de la carte. */
export const CORPS_TIGRE = {
  /** croupe (bout arrière du corps, rayon compris) */
  arriere: 0.335,
  /** poitrail (bout avant du corps, rayon compris, sans la tête) */
  avant: 0.315,
  rayon: 0.115,
  rayonMinM: 0.31,
  /** dos : au-dessus, les pieds passent (sauter par-dessus un petit) */
  haut: 0.45,
  /** un tigre qui rampe est plus bas d'autant */
  hautRampant: 0.6,
} as const;

/** Ce qu'il faut d'un tigre pour son corps (`ZombieVue` du client, `Zombie` du serveur). */
export interface CorpsTigre {
  x: number;
  z: number;
  cap: number;
  echelle: number;
  mode?: ModeZombie;
  allure?: Allure;
  pvPct?: number;
}

/** Le corps du tigre arrête-t-il le joueur ? (vivant, en chasse : pas en train d'émerger, de sauter ni derrière sa fenêtre) */
export function corpsSolide(t: CorpsTigre): boolean {
  if (t.pvPct !== undefined && t.pvPct <= 0) return false;
  return t.mode === undefined || t.mode === "chasse";
}

/** Capsule du corps d'un tigre (rangée dans `sortie` si fourni). */
export function capsuleTigre(t: CorpsTigre, sortie?: Capsule): Capsule {
  const e = t.echelle;
  const r = Math.max(CORPS_TIGRE.rayon * e, CORPS_TIGRE.rayonMinM);
  // le rayon minimal ne rallonge pas le corps : les bouts (rayon compris) restent à −0,335 et +0,315 × l'échelle
  let a0 = -(CORPS_TIGRE.arriere * e - r), a1 = CORPS_TIGRE.avant * e - r;
  if (a0 > a1) a0 = a1 = (a0 + a1) / 2;
  const fx = -Math.sin(t.cap), fz = -Math.cos(t.cap);
  const c = sortie ?? { ax: 0, az: 0, bx: 0, bz: 0, r: 0, haut: 0 };
  c.ax = t.x + fx * a0; c.az = t.z + fz * a0;
  c.bx = t.x + fx * a1; c.bz = t.z + fz * a1;
  c.r = r;
  c.haut = CORPS_TIGRE.haut * e * (t.allure === 3 ? CORPS_TIGRE.hautRampant : 1);
  return c;
}

/**
 * Capsules des tigres solides d'une image (client) : `maj` remplit `capsules` avec les `n` premiers tigres `vues` dont le corps est
 * solide, à moins de `portee` m de (x, z) si elle est donnée. Les objets sont réutilisés d'une image à l'autre.
 */
export class CorpsTigres {
  private readonly reserve: Capsule[] = [];
  readonly capsules: Capsule[] = [];

  maj(vues: readonly CorpsTigre[], n: number, x?: number, z?: number, portee = Infinity): readonly Capsule[] {
    this.capsules.length = 0;
    const p2 = portee * portee;
    for (let i = 0; i < n && i < vues.length; i++) {
      const v = vues[i];
      if (!corpsSolide(v)) continue;
      if (x !== undefined && z !== undefined && (v.x - x) ** 2 + (v.z - z) ** 2 > p2) continue;
      const k = this.capsules.length;
      if (k >= this.reserve.length) this.reserve.push({ ax: 0, az: 0, bx: 0, bz: 0, r: 0, haut: 0 });
      this.capsules.push(capsuleTigre(v, this.reserve[k]));
    }
    return this.capsules;
  }
}
