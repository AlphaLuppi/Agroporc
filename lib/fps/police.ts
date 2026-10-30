/**
 * Descente de police (PUR, partagé client / serveur, aucune horloge ni hasard global : `alea` est toujours un paramètre) : constantes, choix de la cible
 * (arène : le joueur qui a le plus de kills ; Battle Royale : l'ennemi humain le plus proche), point de départ « de nulle part », écrasement, état de
 * la carrosserie, test de touche sur la boîte orientée de la voiture (partagé avec le client : la même boîte, la marge n'est ajoutée que côté serveur) et
 * un pas de la voiture (physique des voitures conduisibles, dérapage compris, comme le Truck Muche fou).
 * Le service qui la fait vivre est `match-police.ts` ; les règles propres à chaque mode (qui est éligible, quand une descente est permise) sont dans
 * `police-regles.ts`.
 * Spec : docs/superpowers/specs/2026-10-30-arene-police-evenements-design.md (§4)
 */
import type { Vec2 } from "../agroparc3d/types";
import type { Monde } from "./collision";
import { capContournement, capVers, commandesPoursuite, ecraseParTruck, enrouler } from "./monstres";
import type { Vec3 } from "./protocole";
import { VEH, pasVehicule, type EtatVehicule } from "./vehicule";

export const POLICE = {
  /** la caisse de la voiture de police est celle d'une voiture conduisible : la physique de `pasVehicule` est inchangée (24 m/s au plus) */
  longueur: VEH.longueur, largeur: VEH.largeur, hauteur: VEH.hauteur,
  pvMax: 700, fumeeFrac: 0.5, feuFrac: 0.2,
  /** poursuite puis retrait vers le point d'apparition (aucun écrasement pendant le retrait) */
  dureeMs: 22_000, departMs: 4_000,
  /** en dessous de cette vitesse (m/s) elle n'écrase personne ; marge (m) de la boîte d'écrasement ; au-dessus de cette hauteur de pieds, on est hors d'atteinte (toit de bus, de bâtiment) */
  vitesseEcrase: 4, margeEcrase: 0.2, hauteurMaxCibleM: 2.2,
  changementCibleMs: 2_000, cheminMs: 1_200, bloqueMs: 900, reculMs: 1_100, reessaiMs: 5_000, vitesseDepart: 14,
  /** points de départ : distance minimale à tous les joueurs, plage de distance à la cible, distance idéale, plafond de points testés à vue (coût borné) */
  departMinM: 90, departMaxM: 240, departIdealM: 160, departCibleMinM: 110, candidatsVueMax: 24,
  joueursMin: 2, margeApresEvenementMs: 20_000,
  /** aucune descente dans la première minute d'un match (arène : les kills repartent à 0) */
  premierMatchMs: 60_000,
  /** arène : délai maximal d'attente d'un premier kill avant de se rabattre sur le plus proche */
  attendreLeaderMs: 60_000,
  /** A* borné ; une cible sans chemin est écartée `inaccessibleMs` ; plus aucun candidat joignable depuis `sansCibleMs` : retrait */
  noeudsMax: 12_000, inaccessibleMs: 10_000, sansCibleMs: 3_000,
  /** marge (m) de la boîte orientée de touche, en plus du rejeu de latence */
  marges: { toucheM: 0.8 },
  /** arène : délais après la création de la salle (ou le passage à 2 joueurs en jeu), puis après la fin d'une descente (« Normal ») */
  premier: { minMs: 240_000, maxMs: 420_000 },
  entre: { minMs: 300_000, maxMs: 540_000 },
  plancherMs: 150_000,
  /** Battle Royale : armement, conditions, seconde descente */
  br: { apresAtterrissageMs: 60_000, premierMinMs: 90_000, premierMaxMs: 240_000, vivantsMin: 4, secondeJoueursMin: 20, secondeMinMs: 180_000, secondeMaxMs: 300_000, max: 2 },
} as const;

/** Un joueur que la voiture peut viser : position (pieds), kills du match, humain (un bot n'est qu'un mannequin d'entraînement). */
export interface CandidatPolice { id: string; p: Vec3; kills: number; humain: boolean }

const distanceH = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);

/**
 * Cible en arène : le candidat de kills maximal ; égalité, le plus proche de la voiture ; personne n'a plus de 0 kill, le plus proche. Hystérésis : la
 * cible `courante` est gardée tant qu'elle est candidate et qu'aucun autre n'a STRICTEMENT plus de kills qu'elle. Les candidats sont déjà filtrés
 * (vivants, à pied, hors protection, joignables) : voir `police-regles.ts`.
 */
export function choisirCibleArene(c: readonly CandidatPolice[], voiture: Vec3, courante: string | null): string | null {
  if (c.length === 0) return null;
  let meilleur = c[0];
  for (const x of c) {
    if (x.kills > meilleur.kills || (x.kills === meilleur.kills && distanceH(x.p, voiture) < distanceH(meilleur.p, voiture))) meilleur = x;
  }
  const actuelle = courante === null ? undefined : c.find((x) => x.id === courante);
  if (actuelle && meilleur.kills <= actuelle.kills) return actuelle.id;
  return meilleur.id;
}

/**
 * Cible en Battle Royale : l'ennemi HUMAIN le plus proche de la voiture ; sans humain éligible, le bot le plus proche. Les kills sont ignorés. Pas
 * d'hystérésis ici : le service ne réévalue que toutes les `changementCibleMs`.
 */
export function choisirCibleBr(c: readonly CandidatPolice[], voiture: Vec3): string | null {
  const parmi = c.some((x) => x.humain) ? c.filter((x) => x.humain) : c;
  let meilleur: CandidatPolice | null = null;
  for (const x of parmi) if (!meilleur || distanceH(x.p, voiture) < distanceH(meilleur.p, voiture)) meilleur = x;
  return meilleur ? meilleur.id : null;
}

/**
 * Point de départ « de nulle part » : parmi `points` (routes), ceux à `departMinM` au moins de TOUS les joueurs (immunisés compris), à
 * `departCibleMinM`…`departMaxM` de la cible, triés par écart à `departIdealM` (avec un léger tirage par `alea` : pas toujours la même route) ; le
 * premier qui n'est vu de personne (`vu(x, z)`, évalué sur `candidatsVueMax` points au plus) l'emporte. Repli 1 : sans le critère de vue ; repli 2 :
 * `departMinM` ramené à 60 m (et la cible à 60 m aussi) ; sinon null.
 */
export function choisirDepart(
  points: readonly Vec2[], joueurs: readonly Vec3[], cible: Vec3, vu: (x: number, z: number) => boolean, alea: () => number,
): Vec2 | null {
  const filtrer = (minM: number, cibleMinM: number): Vec2[] => {
    const gardes: { p: Vec2; cle: number }[] = [];
    for (const p of points) {
      const dc = Math.hypot(p[0] - cible[0], p[1] - cible[2]);
      if (dc < cibleMinM || dc > POLICE.departMaxM) continue;
      let trop = false;
      for (const j of joueurs) if (Math.hypot(p[0] - j[0], p[1] - j[2]) < minM) { trop = true; break; }
      if (!trop) gardes.push({ p, cle: Math.abs(dc - POLICE.departIdealM) + alea() * 20 });
    }
    return gardes.sort((a, b) => a.cle - b.cle).map((g) => g.p);
  };
  const strict = filtrer(POLICE.departMinM, POLICE.departCibleMinM);
  for (const p of strict.slice(0, POLICE.candidatsVueMax)) if (!vu(p[0], p[1])) return p;
  if (strict.length) return strict[0];
  const large = filtrer(60, 60);
  return large.length ? large[0] : null;
}

/** Le joueur (pieds en `p`, cylindre de rayon `rayonJoueur`) est-il sous la caisse de la voiture lancée ? Même règle que le Truck fou, autres dimensions. */
export function ecraseParPolice(e: EtatVehicule, p: Vec3, rayonJoueur: number): boolean {
  return ecraseParTruck(e, p, rayonJoueur, POLICE.margeEcrase, POLICE);
}

/** Carrosserie abîmée : `fumee` à 50 % des PV ou moins, `feu` à 20 % ou moins (`pvMax` : essais). */
export function etatCarrosserie(pv: number, pvMax: number = POLICE.pvMax): "fumee" | "feu" | undefined {
  if (pv <= pvMax * POLICE.feuFrac) return "feu";
  if (pv <= pvMax * POLICE.fumeeFrac) return "fumee";
  return undefined;
}

/**
 * Distance (m) à laquelle le rayon (o, d normalisé) entre dans la boîte orientée de la voiture (posée en `p` — pieds —, orientée par `cap`) agrandie
 * de `marge` de chaque côté, ou null s'il la manque ou si elle est au-delà de `portee`. Origine dans la boîte : 0. Les murs ne sont pas regardés ici.
 */
export function toucheBoiteOrientee(o: Vec3, d: Vec3, portee: number, p: Vec3, cap: number, marge = 0): number | null {
  const fx = -Math.sin(cap), fz = -Math.cos(cap);
  const rx = Math.cos(cap), rz = -Math.sin(cap);
  const ox = o[0] - p[0], oy = o[1] - p[1], oz = o[2] - p[2];
  // repère local : (avant, droite, haut)
  const origine = [ox * fx + oz * fz, ox * rx + oz * rz, oy];
  const dir = [d[0] * fx + d[2] * fz, d[0] * rx + d[2] * rz, d[1]];
  const bas = [-POLICE.longueur / 2 - marge, -POLICE.largeur / 2 - marge, -marge];
  const haut = [POLICE.longueur / 2 + marge, POLICE.largeur / 2 + marge, POLICE.hauteur + marge];
  let t0 = 0, t1 = portee;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]) < 1e-9) {
      if (origine[k] < bas[k] || origine[k] > haut[k]) return null;
      continue;
    }
    let a = (bas[k] - origine[k]) / dir[k], b = (haut[k] - origine[k]) / dir[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

/** Sous cette distance (m) de sa cible, la voiture ne roule plus plus vite que son virage ne le permet (voir `pasPolice`). */
const APPROCHE_M = 70;
/** Vitesse maximale (m/s) selon l'écart de cap (rad) à la cible dans la dernière approche : plus on est de travers, plus on ralentit pour pouvoir tourner. */
const vitesseMaxApproche = (ecart: number): number => (ecart > 0.8 ? 7 : ecart > 0.4 ? 11 : ecart > 0.2 ? 16 : VEH.vitesseMax);

/**
 * Un pas de la voiture (physique des voitures, dérapage compris) vers `cible` (null : roule droit) ; en marche arrière (`recul`) elle braque à l'envers
 * pour se dégager. Un bâtiment entre elle et sa cible : elle vise un point dégagé à côté (contournement par moustaches), comme le Truck fou.
 * Dans les 70 derniers mètres, elle lève le pied quand sa cible est de travers (son rayon de braquage à 24 m/s est de l'ordre de 35 m : à pleine vitesse, un joueur
 * à 10 m de côté est manqué puis la voiture tourne autour de lui sans jamais l'atteindre) ; sur 252 approches finales mesurées (écarts de cap jusqu'à 1,5 rad,
 * de 15 à 40 m), toutes aboutissent, contre 71 % sans cette règle.
 */
export function pasPolice(e: EtatVehicule, cible: Vec3 | null, recul: boolean, dt: number, monde: Monde): EtatVehicule {
  let vise = cible;
  if (cible && !recul) {
    const dist = Math.hypot(cible[0] - e.p[0], cible[2] - e.p[2]);
    const voulu = capVers(e.p[0], e.p[2], cible[0], cible[2]);
    const cap = capContournement(monde, e.p, voulu, Math.min(dist, 18), POLICE.largeur / 2);
    if (cap !== voulu) vise = [e.p[0] - Math.sin(cap) * 20, 0, e.p[2] - Math.cos(cap) * 20];
  }
  const commandes = commandesPoursuite(e, vise, recul);
  if (cible && vise && !recul && Math.hypot(cible[0] - e.p[0], cible[2] - e.p[2]) < APPROCHE_M) {
    const ecart = Math.abs(enrouler(capVers(e.p[0], e.p[2], vise[0], vise[2]) - e.cap));
    if (e.v > vitesseMaxApproche(ecart)) { commandes.accel = -1; commandes.frein = false; }
  }
  return pasVehicule(e, commandes, dt, monde).etat;
}
