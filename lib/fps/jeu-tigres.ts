/**
 * Tigres et avion côté client (PUR, ni three ni DOM) : tigres du snap interpolés à l'horloge serveur, passage de l'avion en cours, charge du
 * sort d'invocation du joueur, choix d'un tigre touché par un tir ou un coup de couteau, reconnaissance des coups de mon tigre allié.
 * Appelé par `jeu.ts`, dessiné par `rendu-tigres.ts`.
 * Spec : docs/superpowers/specs/2026-10-23-arene-tigres-design.md (Rendu, Sort d'invocation, Réseau)
 *
 * Aucune horloge ni aléa ici : toutes les dates sont passées en paramètre (horloge serveur, ms).
 */
import { COUTEAU } from "./armes";
import { positionAvion } from "./avion";
import type { Monde } from "./collision";
import type { MessageServeur, PassageAvion, TigreLargueSnap, Vec3, Zone } from "./protocole";
import { lerpAngle } from "./reseau";
import { TIGRE, coupTigreVraisemblable, distanceSurfaceTigre, tracerTigre, type PositionTigre } from "./tigre-arene";

/** Tampon des snaps de tigres (ms), comme celui des joueurs. */
const TAMPON_MS = 1000;
/** Extrapolation maximale au-delà du dernier snap (ms), le long du déplacement mesuré. */
const EXTRAPOLATION_MAX_MS = 150;
/** Marge (m) ajoutée à la vitesse du bond × Δt pour reconnaître un saut (tigre allié qui rejoint son lanceur d'un coup). */
const MARGE_SAUT_M = 3;
/** Un `degats` dont la source est à moins de cette distance (m) de mon tigre allié est un coup de patte de mon tigre. */
const DISTANCE_COUP_TIGRE_M = 3;

/** Tigre à dessiner : le snap interpolé et sa vitesse horizontale mesurée (m/s), qui règle la vitesse de lecture de la marche. */
export interface TigreClient extends TigreLargueSnap {
  v: number;
}

/** Avion à l'instant demandé : position (altitude comprise), cap en convention lacet (0 = vers −z) et passage. */
export interface AvionClient { p: Vec3; cap: number; passage: PassageAvion }

interface Echantillon { ts: number; tigres: Map<string, TigreLargueSnap> }

function copie(t: TigreLargueSnap): TigreLargueSnap {
  return { ...t, p: [t.p[0], t.p[1], t.p[2]] };
}

/**
 * Tampon de snaps de tigres ordonnés par `ts` : positions interpolées linéairement, cap par le plus court chemin, champs discrets (état, pose,
 * PV, action) du snap le plus proche, extrapolation bornée à 150 ms. Un écart plus grand que la vitesse du bond × Δt + 3 m est un saut (tigre
 * allié qui rejoint son lanceur) : pas d'interpolation. Un tigre absent du dernier snap est retiré.
 */
export class InterpolateurTigres {
  private echantillons: Echantillon[] = [];

  constructor(private readonly tamponMs: number = TAMPON_MS) {}

  /** `tigres` absent du snap = aucun tigre (le serveur l'omet quand la liste est vide). */
  ajouter(ts: number, tigres: readonly TigreLargueSnap[] | undefined): void {
    const e: Echantillon = { ts, tigres: new Map((tigres ?? []).map((t) => [t.id, copie(t)])) };
    let i = this.echantillons.length;
    while (i > 0 && this.echantillons[i - 1].ts > ts) i--;
    if (i > 0 && this.echantillons[i - 1].ts === ts) this.echantillons[i - 1] = e;
    else this.echantillons.splice(i, 0, e);
    const limite = this.echantillons[this.echantillons.length - 1].ts - this.tamponMs;
    while (this.echantillons.length > 2 && this.echantillons[0].ts < limite) this.echantillons.shift();
  }

  vider(): void {
    this.echantillons = [];
  }

  /** Retire un tigre de tout le tampon (mort ou départ annoncé avant le snap suivant). */
  retirer(id: string): void {
    for (const e of this.echantillons) e.tigres.delete(id);
  }

  echantillon(tsServeur: number): Map<string, TigreClient> {
    const res = new Map<string, TigreClient>();
    const n = this.echantillons.length;
    if (!n) return res;
    const dernier = this.echantillons[n - 1];
    const avant = n > 1 ? this.echantillons[n - 2] : null;

    // tampon en retard : dernier état prolongé de son déplacement mesuré entre les deux derniers snaps, sur 150 ms au plus
    if (tsServeur >= dernier.ts) {
      const dt = Math.min(tsServeur - dernier.ts, EXTRAPOLATION_MAX_MS) / 1000;
      for (const t of dernier.tigres.values()) {
        const a = avant?.tigres.get(t.id);
        const dtS = avant ? (dernier.ts - avant.ts) / 1000 : 0;
        let vx = 0, vz = 0;
        if (a && dtS > 0 && !this.saut(a, t, dtS)) { vx = (t.p[0] - a.p[0]) / dtS; vz = (t.p[2] - a.p[2]) / dtS; }
        res.set(t.id, { ...copie(t), p: [t.p[0] + vx * dt, t.p[1], t.p[2] + vz * dt], v: Math.hypot(vx, vz) });
      }
      return res;
    }

    let ib = 0;
    while (ib < n && this.echantillons[ib].ts <= tsServeur) ib++;
    const b = this.echantillons[ib];
    const a = ib > 0 ? this.echantillons[ib - 1] : null;
    if (!a) {
      for (const t of b.tigres.values()) if (dernier.tigres.has(t.id)) res.set(t.id, { ...copie(t), v: 0 });
      return res;
    }
    const k = b.ts > a.ts ? (tsServeur - a.ts) / (b.ts - a.ts) : 1;
    const dtS = (b.ts - a.ts) / 1000;
    for (const tb of b.tigres.values()) {
      if (!dernier.tigres.has(tb.id)) continue;
      const ta = a.tigres.get(tb.id);
      if (!ta || this.saut(ta, tb, dtS)) { res.set(tb.id, { ...copie(tb), v: 0 }); continue; }
      const base = copie(k < 0.5 ? ta : tb);
      base.p = [ta.p[0] + (tb.p[0] - ta.p[0]) * k, ta.p[1] + (tb.p[1] - ta.p[1]) * k, ta.p[2] + (tb.p[2] - ta.p[2]) * k];
      base.cap = lerpAngle(ta.cap, tb.cap, k);
      res.set(tb.id, { ...base, v: dtS > 0 ? Math.hypot(tb.p[0] - ta.p[0], tb.p[2] - ta.p[2]) / dtS : 0 });
    }
    return res;
  }

  private saut(a: TigreLargueSnap, b: TigreLargueSnap, dtS: number): boolean {
    return Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]) > TIGRE.bond.vitesse * dtS + MARGE_SAUT_M;
  }
}

/** Son d'un tigre à jouer : action nouvelle vue dans les snaps (le bond annoncé rugit, le coup de patte frappe). */
export interface SonTigre { id: string; son: "rugissement" | "patte"; p: Vec3 }

/** Touche d'un rayon sur un tigre : le plus proche le long du rayon. */
export interface ToucheTigre { id: string; distance: number; zone: Zone }

/**
 * Tigres, avion et sort côté client. `moi` = mon id de joueur (null avant `bienvenue`) : mes tigres alliés ne sont jamais des cibles (le
 * serveur refuse qu'un lanceur touche son propre tigre, un tir sur lui serait perdu pour l'ennemi caché derrière).
 */
export class MondeTigres {
  private readonly interp = new InterpolateurTigres();
  private passage: PassageAvion | null = null;
  private charge = false;
  /** dernière action vue par tigre (`action@actionT`) : une action nouvelle donne un son */
  private actions = new Map<string, string>();

  /** Snap reçu (tous les snaps des joueurs en arène, avec ou sans `tigres`). */
  alimenter(ts: number, tigres: readonly TigreLargueSnap[] | undefined): void {
    this.interp.ajouter(ts, tigres);
  }

  /** Tigres interpolés à l'horodatage serveur demandé (en pratique `maintenantServeur() − JEU.interpolationMs`). */
  tigresA(tsServeur: number): Map<string, TigreClient> {
    return this.interp.echantillon(tsServeur);
  }

  /**
   * Messages `avion`, `tigre` et `sort` du serveur. Renvoie vrai si le message me concerne directement (sort gagné, lancé ou perdu par moi)
   * pour que l'appelant mette son HUD à jour.
   */
  recevoir(m: MessageServeur, moi: string | null): boolean {
    switch (m.t) {
      case "avion":
        // `etat` et `passage` portent le passage complet (ou null), `largage` le rappelle
        this.passage = m.avion;
        return false;
      case "tigre":
        if (m.evenement === "mort" || m.evenement === "parti") this.interp.retirer(m.id);
        return false;
      case "sort":
        if (!moi || m.joueur !== moi) return false;
        this.charge = m.evenement === "gagne";
        return true;
      default:
        return false;
    }
  }

  /** J'ai une charge du sort (dernier `sort` me concernant : `gagne`, et ni `lance` ni `perdu` depuis). */
  aCharge(): boolean {
    return this.charge;
  }

  /**
   * Avion à l'instant serveur `ts`, null hors survol. L'avion disparaît à `finT` même sans message : le serveur n'annonce pas la fin d'un
   * passage, et un tigre tué pendant sa descente efface le passage côté serveur (`avion: null` à la synchronisation suivante).
   */
  avionA(ts: number): AvionClient | null {
    const p = this.passage;
    if (!p || ts < p.debutT || ts > p.finT) return null;
    return { p: positionAvion(p, ts), cap: Math.atan2(-(p.arrivee[0] - p.depart[0]), -(p.arrivee[1] - p.depart[1])), passage: p };
  }

  /** Tigres que je peux viser (tous sauf mes alliés), avec leur position de touche. */
  cibles(tigres: ReadonlyMap<string, TigreClient>, moi: string | null): (PositionTigre & { id: string })[] {
    const r: (PositionTigre & { id: string })[] = [];
    for (const t of tigres.values()) {
      if (t.pv <= 0 || (moi && t.lanceur === moi)) continue;
      r.push({ id: t.id, p: t.p, cap: t.cap, pose: t.pose });
    }
    return r;
  }

  /**
   * Sons des actions nouvelles depuis l'appel précédent : le bond annoncé (`ramasse`) rugit, le coup de patte frappe. Le bond lui-même et
   * l'alerte (message `tigre{alerte}`, qui rugit aussi) n'en donnent pas ici. À appeler une fois par image avec les tigres dessinés.
   */
  sons(tigres: ReadonlyMap<string, TigreClient>): SonTigre[] {
    const r: SonTigre[] = [];
    for (const t of tigres.values()) {
      const cle = t.action ? `${t.action}@${t.actionT ?? 0}` : "";
      const avant = this.actions.get(t.id);
      this.actions.set(t.id, cle);
      if (avant === undefined || avant === cle || !t.action) continue;
      if (t.action === "ramasse") r.push({ id: t.id, son: "rugissement", p: t.p });
      else if (t.action === "patte") r.push({ id: t.id, son: "patte", p: t.p });
    }
    for (const id of [...this.actions.keys()]) if (!tigres.has(id)) this.actions.delete(id);
    return r;
  }

  /**
   * Sortie de l'arène sans message du serveur (éviction d'un onglet gelé) : la charge est perdue côté serveur, l'icône du sort et la
   * touche « invoquer » ne doivent pas survivre à la réentrée. Tigres et avion restent (les snaps et la synchronisation les tiennent).
   */
  perdreCharge(): void {
    this.charge = false;
  }

  /** Changement de partie ou d'id de client : plus de tigre, d'avion ni de charge. */
  reinitialiser(): void {
    this.interp.vider();
    this.passage = null;
    this.charge = false;
    this.actions.clear();
  }
}

/** Tigre le plus proche touché par le rayon (o, d normalisé) avant `limite` (m), null sinon. */
export function tracerTigres(o: Vec3, d: Vec3, limite: number, cibles: readonly (PositionTigre & { id: string })[]): ToucheTigre | null {
  let meilleur: ToucheTigre | null = null;
  for (const c of cibles) {
    const t = tracerTigre(o, d, c, meilleur ? meilleur.distance : limite);
    if (t && (!meilleur || t.distance < meilleur.distance)) meilleur = { id: c.id, distance: t.distance, zone: t.zone };
  }
  return meilleur;
}

/**
 * Coup de couteau : tigre le plus proche dont la surface est à la portée du couteau (sans la marge du serveur), dans le cône de frappe et en
 * vue (mêmes règles que la validation serveur `coupTigreVraisemblable`). Null sinon.
 */
export function trouverTigreCouteau(monde: Monde, o: Vec3, d: Vec3, cibles: readonly (PositionTigre & { id: string })[]): { id: string; distance: number } | null {
  let meilleur: { id: string; distance: number } | null = null;
  for (const c of cibles) {
    const distance = distanceSurfaceTigre(o, c).distance;
    if (distance > COUTEAU.portee || (meilleur && distance >= meilleur.distance)) continue;
    if (!coupTigreVraisemblable(monde, o, d, c)) continue;
    meilleur = { id: c.id, distance };
  }
  return meilleur;
}

/**
 * Un `degats` dont je suis l'auteur vient-il d'un coup de patte de mon tigre allié ? Le serveur crédite le lanceur des coups de son tigre
 * (`par` = moi) et met en source la position du tigre : une source à moins de 3 m d'un de mes tigres et à plus de 3 m de mon œil n'est pas un
 * de mes tirs (ma source est mon œil).
 */
export function coupDeMonTigre(src: Vec3 | undefined, oeil: Vec3, tigres: ReadonlyMap<string, TigreClient>, moi: string | null): boolean {
  if (!src || !moi) return false;
  if (Math.hypot(src[0] - oeil[0], src[1] - oeil[1], src[2] - oeil[2]) <= DISTANCE_COUP_TIGRE_M) return false;
  for (const t of tigres.values()) {
    if (t.lanceur !== moi) continue;
    if (Math.hypot(src[0] - t.p[0], src[2] - t.p[2]) <= DISTANCE_COUP_TIGRE_M) return true;
  }
  return false;
}
