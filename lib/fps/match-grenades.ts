/**
 * Service « grenades » de la salle (PUR), arène et Battle Royale (lot tactique) : grenade à fragmentation de la touche G, projectiles des armes uniques du
 * bus C3 (obus du lance-grenades, roquette du bazooka, bidon du fumigène) et fumigène de la touche B. Ne voit la salle que par `ContexteSalle`.
 *
 * Le serveur calcule UNE fois la trajectoire au lancer (`preparerLancer` de grenades.ts, même monde que le client) et diffuse `grenade{genre, o, v, t0,
 * explosionT}` : le client la recalcule et la dessine. À l'échéance, `grenadeExplose` part à tous les joueurs (le client retire le projectile et dessine
 * l'explosion), le souffle blesse chaque joueur en vue du centre (`degatsGrenadeJoueur`, protection d'apparition respectée), le kill est crédité au
 * lanceur (cause `grenade`) et sa propre grenade le blesse comme les autres (aucun kill pour lui-même). Un obus ou une roquette (percussion) explose aussi
 * dès qu'il touche un joueur : la trajectoire diffusée ne connaît que le décor, le contact avec un joueur est jugé ici à chaque tic sur ses positions
 * vivantes (le message `grenadeExplose` arrive avant l'échéance annoncée).
 *
 * Stock : arène, `GRENADES_JOUEURS.parVie` à chaque apparition (annoncé en `stockGrenades` au tic suivant, perdu à la mort) ; Battle Royale, le sac du butin
 * (`stockBr` / `retirerBr`, messages `inventaire`). Cadence : un lancer toutes les `INTERVALLE_LANCER_MS` ; fumigène de la touche B : un toutes les 15 s.
 * Aucune horloge, aucun `Math.random` : l'horloge virtuelle `maintenant` passée par la salle.
 */
import { fractionSphere } from "./effets-armes";
import {
  GENRE_DE_L_UNIQUE, GRENADES, GRENADES_JOUEURS, degatsGrenadeJoueur, estPercussion, positionLancer, preparerLancer, souffleAtteint, validerLancer, vitesseLancer,
  type Lancer,
} from "./grenades";
import type { ContexteSalle, JoueurSalle, ServiceGrenades, Sortie } from "./match-contexte";
import type { ArmeUniqueId, GenreGrenade, MessageServeur, Vec3 } from "./protocole";

export interface OptionsServiceGrenades {
  mode: "arene" | "br";
  /** Battle Royale : grenades du sac et lancer d'une (`ServiceBr.stockGrenades` / `retirerGrenade`) */
  stockBr?: (id: string) => number;
  retirerBr?: (j: JoueurSalle) => Sortie[];
  /** nuage de fumée posé en `p` (la salle tient les nuages : snap, radar, brouillard) ; renvoie le message `fumigene` */
  creerNuage: (p: Vec3, maintenant: number) => Sortie[];
  /** délai entre deux fumigènes de la touche B pour un même joueur (ms, 15 000 par défaut) */
  fumigeneMs?: number;
}

/** Délai entre deux fumigènes de la touche B (ms). */
export const FUMIGENE_B_MS = 15_000;
/** Hauteur (m) du centre du corps d'un joueur au-dessus de ses pieds (le souffle est mesuré du centre de l'explosion à ce point). */
const CENTRE_CORPS_M = 0.9;
/**
 * Corps d'un joueur pour le contact d'un obus ou d'une roquette : trois sphères (hauteur du centre au-dessus des pieds, rayon) du bassin à la tête, debout ou
 * accroupi. Une seule sphère de torse laissait passer au-dessus de la tête un projectile tiré de l'œil à même hauteur.
 */
const CORPS_DEBOUT: readonly (readonly [number, number])[] = [[0.5, 0.6], [1.2, 0.6], [1.8, 0.4]];
const CORPS_ACCROUPI: readonly (readonly [number, number])[] = [[0.45, 0.55], [1.0, 0.5]];
/** Le souffle est mesuré du centre de l'explosion au torse du joueur ; une marge de ce rayon (m) est retranchée (l'épaisseur du corps). */
const MARGE_CORPS_M = 0.4;

interface Vol { id: number; par: string; lancer: Lancer; dernierP: Vec3 }

export function creerServiceGrenades(ctx: ContexteSalle, opts: OptionsServiceGrenades): ServiceGrenades {
  const arene = opts.mode === "arene";
  const fumigeneMs = opts.fumigeneMs ?? FUMIGENE_B_MS;
  let vols: Vol[] = [];
  let prochainId = 1;
  /** arène : grenades en poche, et joueurs dont le stock reste à annoncer */
  const stocks = new Map<string, number>();
  const sales = new Set<string>();
  const dernierLancer = new Map<string, number>();
  const dernierFumigene = new Map<string, number>();

  const stock = (id: string): number => (arene ? stocks.get(id) ?? 0 : opts.stockBr?.(id) ?? 0);

  /** Un joueur peut lancer : en jeu (match en cours), debout. */
  const peutLancer = (j: JoueurSalle): boolean => ctx.enPhaseJeu() && j.enJeu && j.vivant;

  const messageGrenade = (v: Vol, a: string): Sortie => ({
    a, m: { t: "grenade", id: v.id, par: v.par, genre: v.lancer.genre, o: v.lancer.o, v: v.lancer.v, t0: v.lancer.t0, explosionT: v.lancer.explosionT },
  });

  /** Met un projectile en vol et l'annonce aux joueurs en partie (lanceur compris : sa trajectoire remplace sa prédiction). */
  function partir(j: JoueurSalle, genre: GenreGrenade, o: Vec3, d: Vec3, cuissonMs: number, t: number): Sortie[] {
    j.protegeJusqua = 0; // lancer annule la protection d'apparition, comme tirer
    const oc: Vec3 = [o[0], o[1], o[2]];
    const lancer = preparerLancer(ctx.monde, genre, oc, vitesseLancer(genre, d), t, cuissonMs);
    const v: Vol = { id: prochainId++, par: j.id, lancer, dernierP: oc };
    vols.push(v);
    return [messageGrenade(v, "joueurs")];
  }

  /** Dégâts du souffle `genre` en `c` : joueurs vivants en vue du centre, du plus au moins touché. Renvoie les sorties (dégâts, morts, présence unique). */
  function souffler(v: Vol, c: Vec3, t: number): Sortie[] {
    const prof = GRENADES[v.lancer.genre];
    if (!prof.joueurs) return [];
    const par = ctx.joueur(v.par) ?? null;
    const sorties: Sortie[] = [];
    for (const h of ctx.joueursEnJeu()) {
      if (!h.vivant || t < h.protegeJusqua) continue;
      const torse: Vec3 = [h.p[0], h.p[1] + CENTRE_CORPS_M, h.p[2]];
      const d = Math.hypot(torse[0] - c[0], torse[1] - c[1], torse[2] - c[2]);
      const degats = degatsGrenadeJoueur(v.lancer.genre, Math.max(0, d - MARGE_CORPS_M));
      if (degats <= 0 || !souffleAtteint(ctx.monde, c, [h.p[0], h.p[1] + 0.3, h.p[2]])) continue;
      sorties.push(...ctx.infliger(h, degats, par, "grenade", "corps", "couteau", t, c));
    }
    // une explosion qui tue plusieurs joueurs : une seule présence (la dernière, qui a tous les scores), avant la fin de match éventuelle
    let presence: Sortie | null = null;
    const res: Sortie[] = [];
    for (const s of sorties) { if (s.m.t === "presence") presence = s; else res.push(s); }
    if (presence) {
      const i = res.findIndex((s) => s.m.t === "match");
      res.splice(i < 0 ? res.length : i, 0, presence);
    }
    return res;
  }

  /** Explosion du projectile `v` en `c` : message à tous, nuage pour le fumigène, souffle sinon. */
  function exploser(v: Vol, c: Vec3, t: number): Sortie[] {
    const genre = v.lancer.genre;
    const m: MessageServeur = { t: "grenadeExplose", id: v.id, genre, p: [c[0], c[1], c[2]], rayon: GRENADES[genre].rayonM, par: v.par };
    const sorties: Sortie[] = [{ a: "joueurs", m }];
    if (genre === "fumi") sorties.push(...opts.creerNuage(c, t));
    else sorties.push(...souffler(v, c, t));
    return sorties;
  }

  /** Contact d'un obus ou d'une roquette avec un joueur entre deux tics : fraction du segment au premier joueur touché, null sinon. */
  function contactJoueur(v: Vol, de: Vec3, vers: Vec3): number | null {
    let meilleur: number | null = null;
    for (const h of ctx.joueursEnJeu()) {
      if (!h.vivant || h.id === v.par) continue;
      for (const [dy, r] of h.accroupi ? CORPS_ACCROUPI : CORPS_DEBOUT) {
        const k = fractionSphere(de, vers, [h.p[0], h.p[1] + dy, h.p[2]], r);
        if (k !== null && (meilleur === null || k < meilleur)) meilleur = k;
      }
    }
    return meilleur;
  }

  /** Une grenade de moins en poche (arène : le stock du service ; Battle Royale : le sac). */
  function consommer(j: JoueurSalle): Sortie[] {
    if (arene) {
      stocks.set(j.id, Math.max(0, stock(j.id) - 1));
      sales.add(j.id);
      return [];
    }
    return opts.retirerBr?.(j) ?? [];
  }

  return {
    tic(t: number): Sortie[] {
      const sorties: Sortie[] = [];
      if (vols.length) {
        const restent: Vol[] = [];
        for (const v of vols) {
          const l = v.lancer;
          if (t >= l.explosionT) { sorties.push(...exploser(v, positionLancer(l, l.explosionT), t)); continue; }
          if (estPercussion(l.genre) && t > l.t0) {
            const p = positionLancer(l, t);
            const k = contactJoueur(v, v.dernierP, p);
            if (k !== null) {
              const c: Vec3 = [v.dernierP[0] + (p[0] - v.dernierP[0]) * k, v.dernierP[1] + (p[1] - v.dernierP[1]) * k, v.dernierP[2] + (p[2] - v.dernierP[2]) * k];
              sorties.push(...exploser(v, c, t));
              continue;
            }
            v.dernierP = p;
          }
          restent.push(v);
        }
        vols = restent;
      }
      if (sales.size) {
        for (const id of sales) sorties.push({ a: id, m: { t: "stockGrenades", n: stock(id) } });
        sales.clear();
      }
      return sorties;
    },

    lancer(j, o, d, cuissonMs, t) {
      if (!peutLancer(j)) return [];
      const v = validerLancer("frag", stock(j.id), dernierLancer.get(j.id), t, cuissonMs);
      if (!v.ok) return [];
      dernierLancer.set(j.id, t);
      const sorties = consommer(j);
      sorties.push(...partir(j, "frag", o, d, v.cuissonMs, t));
      return sorties;
    },

    tirerUnique(j, arme: ArmeUniqueId, o, d, t) {
      if (!peutLancer(j)) return [];
      return partir(j, GENRE_DE_L_UNIQUE[arme], o, d, 0, t);
    },

    lancerFumigene(j, o, d, t) {
      if (!arene || !peutLancer(j)) return [];
      const dernier = dernierFumigene.get(j.id);
      if (dernier !== undefined && t - dernier < fumigeneMs) return [];
      dernierFumigene.set(j.id, t);
      return partir(j, "fumi", o, d, 0, t);
    },

    apparu(j) {
      if (!arene) return;
      stocks.set(j.id, GRENADES_JOUEURS.parVie);
      sales.add(j.id);
    },

    stock,

    perdu(id) {
      stocks.delete(id);
      dernierLancer.delete(id);
      dernierFumigene.delete(id);
      sales.delete(id);
    },

    reinitialiser() {
      vols = [];
      stocks.clear();
      sales.clear();
      dernierLancer.clear();
      dernierFumigene.clear();
    },

    synchro(idDest) {
      return vols.map((v) => messageGrenade(v, idDest));
    },

    enVol: () => vols.length,
  };
}
