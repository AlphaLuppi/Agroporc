/**
 * Service des tigres de la salle (PUR) : avion et largage, tigre sauvage, sort d'invocation et tigres alliés. Il valide les tirs et
 * coups de couteau sur un tigre (positions rejouées sur son historique serveur, compensation de latence), applique leurs dégâts et ceux
 * des voitures, porte les coups des tigres aux joueurs par `ctx.infliger` (cause "tigre", kill crédité au lanceur d'un tigre allié) et
 * tient les charges du sort. Messages `avion`, `tigre`, `sort`, tigres du snap. Ne voit la salle que par `ContexteSalle`.
 * Spec : docs/superpowers/specs/2026-10-23-arene-tigres-design.md (Architecture, Avion et largage, Tigre sauvage, Sort, Réseau)
 */
import { avancerAvion, cachettesDansAnneau, creerAvion, rearmerAvion, type EtatAvion, type IntervalleAvion } from "./avion";
import type { ContexteSalle, JoueurSalle, ServiceTigres, Sortie } from "./match-contexte";
import type { MessageClient, MessageServeur, TigreSnap, Vec3, Zone } from "./protocole";
import {
  avancerTigreAllie, avancerTigreSauvage, blesserTigre, coupTigreVraisemblable, creerTigreAllie, creerTigreSauvage, distanceTigre,
  grilleNav, toucheTigreVraisemblable, type CachetteTigre, type EnvTigre, type EvenementTigre, type JoueurVu, type ObstacleVoiture,
  type PositionTigre, type Tigre,
} from "./tigre-arene";
import type { Vec2 } from "../agroparc3d/types";

/** Durée (ms) de l'historique des positions d'un tigre (même valeur que `HISTORIQUE_MS` de match.ts, qui importe ce module). */
const HISTORIQUE_TIGRE_MS = 400;
/** Deux positions historiques à moins de cette distance (m) et de même pose ne sont testées qu'une fois (`REWIND_PAS_M` de match.ts). */
const PAS_REJEU_M = 0.5;
/** Plus grand pas de temps (s) d'un tic de tigre : un serveur figé ne téléporte pas les tigres. */
const DT_MAX_S = 0.1;
/** Hauteur (m) de la source d'un coup de tigre (marqueur de dégât du client). */
const HAUTEUR_SOURCE = 0.8;

export interface OptionsServiceTigres {
  /** toutes les cachettes (public/agroparc/cachettes.json, cap en convention lacet) : seules celles de l'anneau servent */
  cachettes: readonly CachetteTigre[];
  /** anneau de jeu (`ZONE_APPARITION` autour du rond-point) */
  anneau: { centre: Vec2; rMin: number; rMax: number };
  intervalle?: IntervalleAvion;
  /** horloge de la salle à la création (ms) : arme le minuteur de l'avion tout de suite (sinon au premier tic) */
  maintenant?: number;
  /** le joueur est-il à pied ? (un occupant de véhicule n'est ni ciblé ni frappé, et n'invoque pas) Par défaut, tout le monde */
  aPied?: (j: JoueurSalle) => boolean;
  /** voitures conduisibles et PNJ à l'instant donné (obstacles et chocs) */
  voitures?: (maintenant: number) => ObstacleVoiture[];
}

interface TigreSalle extends Tigre {
  histo: { t: number; p: Vec3; cap: number; pose: Tigre["pose"] }[];
  /** vitesse horizontale mesurée (m/s), élargit la tolérance de touche comme pour un joueur */
  vitesse: number;
}

const arrondi = (x: number, pas: number): number => Math.round(x * pas) / pas + 0;
const cm = (v: Vec3): Vec3 => [arrondi(v[0], 100), arrondi(v[1], 100), arrondi(v[2], 100)];

export function creerServiceTigres(ctx: ContexteSalle, opts: OptionsServiceTigres): ServiceTigres {
  const cachettes = cachettesDansAnneau(opts.cachettes, opts.anneau);
  // grille de navigation construite tout de suite (une fois par monde) : pas de pic au premier chemin calculé en jeu
  grilleNav(ctx.monde);
  const aPied = opts.aPied ?? (() => true);
  const intervalle = opts.intervalle;
  // minuteur non armé (échéance infinie) tant qu'aucune horloge n'est connue, comme Elsa
  const avion: EtatAvion = opts.maintenant !== undefined
    ? creerAvion(opts.maintenant, ctx.alea, intervalle)
    : { prochaineT: Infinity, passage: null, cachette: null, largue: false, compteur: 0 };
  let arme = opts.maintenant !== undefined;
  const tigres = new Map<string, TigreSalle>();
  const charges = new Set<string>();
  let compteur = 0;
  let dernierTicT: number | null = null;

  const vers = (m: MessageServeur): Sortie => ({ a: "joueurs", m });
  /**
   * Charge perdue : adressée au joueur lui-même. Sorti de l'arène, il n'est plus dans l'audience « joueurs » et ne recevrait pas
   * l'annonce, son icône du sort resterait affichée (lui seul en a besoin, le HUD des autres ne montre pas les charges).
   */
  const perdue = (id: string, raison: "mort" | "quitte" | "fin_match"): Sortie => ({ a: id, m: { t: "sort", evenement: "perdu", joueur: id, raison } });
  const infoTigre = (t: Tigre) => ({ id: t.id, genre: t.genre, ...(t.lanceur ? { lanceur: t.lanceur } : {}), p: cm(t.p) });
  const sauvageEnVie = () => [...tigres.values()].some((t) => t.genre === "sauvage");

  function ajouter(t: Tigre, maintenant: number): TigreSalle {
    const ts: TigreSalle = Object.assign(t, { histo: [{ t: maintenant, p: [...t.p] as Vec3, cap: t.cap, pose: t.pose }], vitesse: 0 });
    tigres.set(t.id, ts);
    return ts;
  }

  /** Retire un tigre. Un sauvage qui disparaît ré-arme l'avion. */
  function retirer(t: TigreSalle, maintenant: number): void {
    tigres.delete(t.id);
    if (t.genre === "sauvage") rearmerAvion(avion, maintenant, ctx.alea, intervalle);
  }

  /** Mort d'un tigre : `tigre{mort}`, et pour un sauvage abattu par un joueur vivant en arène, une charge du sort (au plus une). */
  function mourir(t: TigreSalle, par: JoueurSalle | null, maintenant: number): Sortie[] {
    retirer(t, maintenant);
    const sorties: Sortie[] = [vers({ t: "tigre", evenement: "mort", ...infoTigre(t), par: par?.id ?? "" })];
    if (t.genre === "sauvage" && par && par.enJeu && par.vivant && !charges.has(par.id)) {
      charges.add(par.id);
      sorties.push(vers({ t: "sort", evenement: "gagne", joueur: par.id }));
    }
    return sorties;
  }

  /** Tout s'arrête (fin de match, entracte) : tigres partis, charges perdues, avion au sol. */
  function vider(): Sortie[] {
    const sorties: Sortie[] = [];
    for (const t of tigres.values()) sorties.push(vers({ t: "tigre", evenement: "parti", ...infoTigre(t) }));
    tigres.clear();
    for (const id of charges) sorties.push(perdue(id, "fin_match"));
    charges.clear();
    if (avion.passage) sorties.push(vers({ t: "avion", evenement: "etat", avion: null }));
    avion.passage = null;
    avion.cachette = null;
    avion.largue = false;
    return sorties;
  }

  /** Coup d'un tigre sur un joueur vivant, à pied et non protégé : `ctx.infliger`, crédité au lanceur d'un tigre allié. */
  function frapper(t: TigreSalle, cibleId: string, degats: number, maintenant: number): Sortie[] {
    const c = ctx.joueur(cibleId);
    if (!c || !c.enJeu || !c.vivant || maintenant < c.protegeJusqua || !aPied(c)) return [];
    const par = t.lanceur ? ctx.joueur(t.lanceur) ?? null : null;
    const src: Vec3 = [t.p[0], t.p[1] + HAUTEUR_SOURCE, t.p[2]];
    return ctx.infliger(c, degats, par && par !== c ? par : null, "tigre", "corps", "couteau", maintenant, src);
  }

  function traduire(t: TigreSalle, ev: EvenementTigre[], maintenant: number): Sortie[] {
    const sorties: Sortie[] = [];
    for (const e of ev) {
      switch (e.type) {
        case "alerte":
          sorties.push(vers({ t: "tigre", evenement: "alerte", ...infoTigre(t), cible: e.cible }));
          break;
        case "coup":
          sorties.push(...frapper(t, e.cible, e.degats, maintenant));
          break;
        case "voiture": {
          const par = e.conducteur ? ctx.joueur(e.conducteur) ?? null : null;
          sorties.push(vers({ t: "tigre", evenement: "touche", ...infoTigre(t), par: par?.id ?? "", degats: e.degats, pv: t.pv, zone: "corps" }));
          if (e.mort) sorties.push(...mourir(t, par, maintenant));
          break;
        }
        case "parti":
          retirer(t, maintenant);
          sorties.push(vers({ t: "tigre", evenement: "parti", ...infoTigre(t) }));
          break;
        default:
          break; // atterri, fuite : le snap porte l'état
      }
    }
    return sorties;
  }

  /** Positions candidates d'un tigre pour valider une touche : la courante puis l'historique sur `fenetreMs` (une par 0,5 m et par pose). */
  function positions(t: TigreSalle, maintenant: number, fenetreMs: number): PositionTigre[] {
    const r: PositionTigre[] = [{ p: t.p, cap: t.cap, pose: t.pose }];
    for (let i = t.histo.length - 1; i >= 0; i--) {
      const h = t.histo[i];
      if (maintenant - h.t > fenetreMs) break;
      const d = r[r.length - 1];
      if (h.pose !== d.pose || Math.hypot(h.p[0] - d.p[0], h.p[1] - d.p[1], h.p[2] - d.p[2]) >= PAS_REJEU_M) r.push({ p: h.p, cap: h.cap, pose: h.pose });
    }
    return r;
  }

  return {
    tic(maintenant) {
      const sorties: Sortie[] = [];
      if (!arme) {
        rearmerAvion(avion, maintenant, ctx.alea, intervalle);
        arme = true;
      }
      const dt = dernierTicT === null ? 0 : Math.min(DT_MAX_S, Math.max(0, (maintenant - dernierTicT) / 1000));
      dernierTicT = maintenant;
      if (!ctx.enPhaseJeu()) return tigres.size || charges.size || avion.passage ? vider() : sorties;

      // charges du sort : perdues à la mort du joueur ou à sa sortie de l'arène
      for (const id of charges) {
        const j = ctx.joueur(id);
        if (j && j.enJeu && j.vivant) continue;
        charges.delete(id);
        sorties.push(perdue(id, j && j.enJeu ? "mort" : "quitte"));
      }

      const enJeu = ctx.joueursEnJeu();
      const vivants = enJeu.filter((j) => j.vivant);
      const vus: JoueurVu[] = vivants.map((j) => ({ id: j.id, p: j.p, protege: maintenant < j.protegeJusqua, aPied: aPied(j) }));

      // avion : passage, largage du tigre sauvage
      const evAvion = avancerAvion(avion, maintenant, ctx.alea, {
        phaseJeu: true, enArene: enJeu.length, vivants: vivants.map((j): Vec2 => [j.p[0], j.p[2]]), tigreSauvage: sauvageEnVie(),
      }, cachettes, ctx.monde.bornes, intervalle);
      for (const e of evAvion) {
        if (e.type === "passage") sorties.push(vers({ t: "avion", evenement: "passage", avion: e.passage }));
        else if (e.type === "largage") {
          if (!e.cachette) {
            sorties.push(vers({ t: "avion", evenement: "largage", avion: e.passage }));
            continue;
          }
          const t = ajouter(creerTigreSauvage(`t${(++compteur).toString(36)}`, e.point, e.cachette, maintenant), maintenant);
          sorties.push(vers({ t: "avion", evenement: "largage", avion: e.passage, tigre: t.id }));
          sorties.push(vers({ t: "tigre", evenement: "apparu", ...infoTigre(t) }));
        }
      }

      if (!tigres.size) return sorties;
      const env: EnvTigre = { monde: ctx.monde, alea: ctx.alea, joueurs: vus, voitures: opts.voitures?.(maintenant) ?? [], cachettes };
      for (const t of [...tigres.values()]) {
        const avant: Vec3 = [t.p[0], t.p[1], t.p[2]];
        let ev: EvenementTigre[];
        if (t.genre === "sauvage") ev = avancerTigreSauvage(t, maintenant, dt, env);
        else {
          const l = t.lanceur ? vus.find((j) => j.id === t.lanceur) ?? null : null;
          ev = avancerTigreAllie(t, l, maintenant, dt, env);
        }
        sorties.push(...traduire(t, ev, maintenant));
        if (!tigres.has(t.id)) continue;
        t.vitesse = dt > 0 ? Math.hypot(t.p[0] - avant[0], t.p[2] - avant[2]) / dt : 0;
        t.histo.push({ t: maintenant, p: [t.p[0], t.p[1], t.p[2]], cap: t.cap, pose: t.pose });
        while (t.histo.length > 1 && maintenant - t.histo[0].t > HISTORIQUE_TIGRE_MS) t.histo.shift();
      }
      return sorties;
    },

    recevoir(j, m, maintenant) {
      if (m.t !== "invoquer") return [];
      if (!ctx.enPhaseJeu() || !j.enJeu || !j.vivant || !charges.has(j.id) || !aPied(j)) return [];
      charges.delete(j.id);
      const t = ajouter(creerTigreAllie(`t${(++compteur).toString(36)}`, j, ctx.monde, maintenant), maintenant);
      return [
        vers({ t: "sort", evenement: "lance", joueur: j.id, tigre: t.id }),
        vers({ t: "tigre", evenement: "apparu", ...infoTigre(t) }),
      ];
    },

    estTigre(id) {
      return tigres.has(id);
    },

    validerTir(tireur, id, o, d, portee, maintenant, fenetreMs) {
      const t = tigres.get(id);
      if (!t || t.lanceur === tireur.id) return null;
      const pos = positions(t, maintenant, fenetreMs).find((p) => toucheTigreVraisemblable(ctx.monde, o, d, portee, p, t.vitesse));
      return pos ? distanceTigre(o, pos) : null;
    },

    validerCoup(tireur, id, o, d, maintenant, fenetreMs) {
      const t = tigres.get(id);
      if (!t || t.lanceur === tireur.id) return false;
      return positions(t, maintenant, fenetreMs).some((p) => coupTigreVraisemblable(ctx.monde, o, d, p));
    },

    blesser(id, degats, par, zone: Zone, maintenant) {
      const t = tigres.get(id);
      if (!t || t.lanceur === par.id) return [];
      const r = blesserTigre(t, degats, par.id, maintenant);
      if (r.subi <= 0) return [];
      const sorties: Sortie[] = [vers({ t: "tigre", evenement: "touche", ...infoTigre(t), par: par.id, degats: r.subi, pv: t.pv, zone })];
      if (r.mort) sorties.push(...mourir(t, par, maintenant));
      return sorties;
    },

    reinitialiser(maintenant) {
      const sorties = vider();
      rearmerAvion(avion, maintenant, ctx.alea, intervalle);
      arme = true;
      return sorties;
    },

    synchro(idDest) {
      return [{ a: idDest, m: { t: "avion", evenement: "etat", avion: avion.passage } }];
    },

    snap() {
      const r: TigreSnap[] = [];
      for (const t of tigres.values()) {
        r.push({
          id: t.id, genre: t.genre, ...(t.lanceur ? { lanceur: t.lanceur } : {}), p: cm(t.p), cap: arrondi(t.cap, 1000),
          etat: t.etat, pose: t.pose, pv: t.pv, ...(t.action ? { action: t.action, actionT: t.actionT } : {}),
        });
      }
      return r;
    },

    charge(id) {
      return charges.has(id);
    },

    accorderCharge(id) {
      const j = ctx.joueur(id);
      if (!j || !j.enJeu || !j.vivant || charges.has(id)) return [];
      charges.add(id);
      return [vers({ t: "sort", evenement: "gagne", joueur: id })];
    },

    tigre(id) {
      return tigres.get(id);
    },
  };
}
