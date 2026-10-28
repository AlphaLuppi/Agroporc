/**
 * Service des véhicules de la salle (PUR) : enveloppe `Garage` (voitures conduisibles) et la circulation PNJ (`flotte`, `ecrasements`) :
 * `monter` / `descendre` / `siege` / `conduite`, libération des sièges, renversements et écrasements. Ne voit la salle que par `ContexteSalle`.
 * v3 §4 : les voitures (PNJ et conduisibles) encaissent les balles et explosent (`Carrosseries` de epaves.ts) : souffle, occupants tués,
 * voitures voisines abîmées, épave, puis retour de la voiture.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.11, §2.12, §5.19, §6.1bis), 2026-10-23-arene-v3-design.md (§4)
 */
import type { Vec2 } from "../agroparc3d/types";
import { degatsPlomb, STATS } from "./armes";
import { VOITURE, ecrasements, etatVoiture, type Circuit, type VoiturePnj } from "./circulation";
import { visible, lancerRayon } from "./collision";
import { CARROSSERIE, Carrosseries, degatsSouffle, degatsVoisine, rayonVoiture, type RefVoiture } from "./epaves";
import { Garage } from "./garage";
import type { ContexteSalle, JoueurSalle, ServiceVehicules, Sortie } from "./match-contexte";
import { SIEGES_PAR_VEHICULE, SILHOUETTE, type ArmeFeuId, type MessageClient, type Siege, type Vec3 } from "./protocole";
import type { ObstacleVoiture } from "./tigre-arene";
import { VEH } from "./vehicule";

/** Durée (ms) de l'historique des occupants (même valeur que `HISTORIQUE_MS` de match.ts, qui importe ce module). */
const HISTORIQUE_OCCUPANT_MS = 400;

export interface OptionsServiceVehicules {
  /** emplacements des voitures conduisibles (une voiture par emplacement) */
  vehicules?: readonly { p: Vec2; cap: number }[];
  /** circuits et voitures PNJ (écrasements) */
  circulation?: { circuits: Circuit[]; voitures: VoiturePnj[] };
  /** horloge de la salle à la création (ms) : date l'abandon des voitures neuves ; défaut 0 (sans effet tant que personne ne conduit) */
  maintenant?: number;
}

/** Une touche de voiture est cherchée sur la caisse rejouée de 0 à `REWIND_VOITURE_MS` en arrière, par pas de `PAS_REWIND_VOITURE_MS`. */
const REWIND_VOITURE_MS = 300;
const PAS_REWIND_VOITURE_MS = 50;
/** Hauteur (m) du centre d'une explosion au-dessus du sol (souffle et ligne de vue). */
const Y_EXPLOSION = 0.9;
/** Réaction en chaîne : au plus ce nombre d'explosions par tir (12 PNJ + 6 voitures, borne de sûreté). */
const EXPLOSIONS_MAX = 18;

const estSiege = (s: unknown): s is Siege => Number.isInteger(s) && (s as number) >= 0 && (s as number) < SIEGES_PAR_VEHICULE;
const borne = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

export function creerServiceVehicules(ctx: ContexteSalle, opts: OptionsServiceVehicules): ServiceVehicules {
  const garage = new Garage(opts.vehicules ?? [], ctx.monde, opts.maintenant ?? 0);
  const circulation = opts.circulation;
  const carrosseries = new Carrosseries();
  const messageVoitures = (a: string): Sortie => ({ a, m: { t: "voitures", etats: carrosseries.etats() } });

  /** Caisse d'une voiture à l'instant `t` (null si elle n'existe pas ou est en épave). */
  function caisse(ref: RefVoiture, t: number): { p: Vec3; cap: number } | null {
    if (carrosseries.detruite(ref)) return null;
    if (ref.genre === "pnj") {
      const v = circulation?.voitures[ref.id];
      if (!circulation || !v) return null;
      const e = etatVoiture(circulation.circuits[v.circuit], v, t);
      return { p: e.p, cap: e.cap };
    }
    if (garage.estHorsService(ref.id)) return null;
    const e = garage.etatAu(ref.id, t);
    return e ? { p: e.p, cap: e.cap } : null;
  }

  /** Toutes les voitures en service, à l'instant `t`. */
  function toutesLesVoitures(t: number): { ref: RefVoiture; p: Vec3; cap: number }[] {
    const r: { ref: RefVoiture; p: Vec3; cap: number }[] = [];
    for (const v of circulation?.voitures ?? []) {
      const ref: RefVoiture = { genre: "pnj", id: v.id };
      const c = caisse(ref, t);
      if (c) r.push({ ref, ...c });
    }
    for (const v of garage.vehicules) {
      const ref: RefVoiture = { genre: "vehicule", id: v.id };
      const c = caisse(ref, t);
      if (c) r.push({ ref, ...c });
    }
    return r;
  }

  /**
   * Explosions en cascade à partir de `premiere` : message `explosion`, occupants tués (et sièges diffusés), souffle sur les joueurs (ligne
   * de vue depuis le centre de l'explosion), dégâts aux voitures voisines (qui peuvent exploser à leur tour, crédit au même tireur).
   */
  function exploser(premiere: { ref: RefVoiture; p: Vec3; cap: number }, par: JoueurSalle, arme: ArmeFeuId, maintenant: number): Sortie[] {
    const sorties: Sortie[] = [];
    const file = [premiere];
    let n = 0;
    while (file.length && n < EXPLOSIONS_MAX) {
      const { ref, p } = file.shift()!;
      n++;
      sorties.push({ a: "tous", m: { t: "explosion", genre: ref.genre, id: ref.id, p: [p[0], p[1], p[2]], par: par.id } });
      if (ref.genre === "vehicule") {
        const occupants = garage.mettreHorsService(ref.id, maintenant);
        for (const id of occupants) {
          const c = ctx.joueur(id);
          if (c) sorties.push(...ctx.tuer(c, par, "explosion", maintenant));
        }
        sorties.push(sieges("tous"));
      }
      const centre: Vec3 = [p[0], p[1] + Y_EXPLOSION, p[2]];
      for (const c of ctx.joueursEnJeu()) {
        if (!c.vivant || maintenant < c.protegeJusqua) continue;
        const cible: Vec3 = [c.p[0], c.p[1] + SILHOUETTE.centreY, c.p[2]];
        const d = Math.hypot(cible[0] - centre[0], cible[1] - centre[1], cible[2] - centre[2]);
        const degats = degatsSouffle(d);
        if (degats <= 0 || !visible(ctx.monde, centre, cible)) continue;
        sorties.push(...ctx.infliger(c, degats, par, "explosion", "corps", arme, maintenant, centre));
      }
      for (const v of toutesLesVoitures(maintenant)) {
        const degats = degatsVoisine(Math.hypot(v.p[0] - p[0], v.p[2] - p[2]));
        if (degats <= 0) continue;
        const r = carrosseries.toucher(v.ref, degats, maintenant, v);
        if (r.detruite) file.push(v);
      }
    }
    return sorties;
  }

  const sieges = (a: string): Sortie => ({ a, m: { t: "sieges", vehicules: garage.infos() } });

  /** `p` = siège, `v` = vitesse de la voiture (cap × v) : la tolérance d'œil et la marge de touche d'un occupant sont celles d'un joueur qui roule */
  const recopier = (j: JoueurSalle): void => {
    const p = garage.positionOccupant(j.id), v = garage.vitesseOccupant(j.id);
    // `+ 0` : jamais de -0 (cap × 0) dans l'état de la salle
    if (p) j.p = [p[0] + 0, p[1] + 0, p[2] + 0];
    if (v) j.v = [v[0] + 0, v[1] + 0, v[2] + 0];
  };
  const occupants = (): JoueurSalle[] => {
    const r: JoueurSalle[] = [];
    for (const veh of garage.vehicules) {
      for (const id of veh.sieges) {
        const j = id === null ? undefined : ctx.joueur(id);
        if (j) r.push(j);
      }
    }
    return r;
  };
  /** un joueur assis ne s'accroupit pas : sa hitbox est celle du siège (l'historique la porte) */
  const assis = (j: JoueurSalle, maintenant: number): void => {
    j.accroupi = false;
    j.glisse = false;
    j.etatT = maintenant;
    recopier(j);
  };

  /** Réponse à un `monter` / `siege` accepté : état de la voiture, puis occupation de tous les sièges. */
  const embarque = (j: JoueurSalle, vehicule: number, siege: Siege): Sortie[] => {
    const veh = garage.vehicules[vehicule];
    return [
      { a: j.id, m: { t: "embarque", vehicule, siege, p: [veh.p[0], veh.p[1], veh.p[2]], cap: veh.cap } },
      sieges("tous"),
    ];
  };
  const refus = (j: JoueurSalle, action: "monter" | "siege", raison: "loin" | "plein" | "deja" | "inconnu" | "mort"): Sortie[] =>
    [{ a: j.id, m: { t: "refus", action, raison } }];

  function monter(j: JoueurSalle, m: Extract<MessageClient, { t: "monter" }>, maintenant: number): Sortie[] {
    if (!j.enJeu) return [];
    if (!j.vivant) return refus(j, "monter", "mort");
    if (m.siege !== undefined && !estSiege(m.siege)) return refus(j, "monter", "inconnu");
    const r = garage.monter(j.id, j.p, m.vehicule, m.siege, maintenant);
    if (!r.ok) return refus(j, "monter", r.raison);
    assis(j, maintenant);
    return embarque(j, m.vehicule, r.siege);
  }

  function descendre(j: JoueurSalle, maintenant: number): Sortie[] {
    const sortie = garage.descendre(j.id, maintenant);
    if (!sortie) return [];
    poserDehors(j, sortie.p, sortie.lacet, maintenant);
    return [{ a: j.id, m: { t: "descente", p: sortie.p, lacet: sortie.lacet, raison: "volontaire" } }, sieges("tous")];
  }

  /** Le serveur téléporte le joueur au point de sortie : sa position connue suit, sinon son prochain `etat` serait refusé (vitesse). */
  function poserDehors(j: JoueurSalle, p: [number, number, number], lacet: number, maintenant: number): void {
    j.p = [p[0], p[1], p[2]];
    j.v = [0, 0, 0];
    j.lacet = lacet;
    j.posture = "sol";
    j.mur = 0;
    j.accroupi = false;
    j.etatT = maintenant;
    j.histo.push({ t: maintenant, p: [p[0], p[1], p[2]], accroupi: false });
  }

  function changerSiege(j: JoueurSalle, siege: unknown, maintenant: number): Sortie[] {
    const o = garage.occupation(j.id);
    if (!o || !estSiege(siege)) return refus(j, "siege", "inconnu");
    if (siege === o.siege) return refus(j, "siege", "deja");
    if (!garage.changerSiege(j.id, siege, maintenant)) return refus(j, "siege", "plein");
    recopier(j);
    return embarque(j, o.vehicule, siege);
  }

  function conduite(j: JoueurSalle, m: Extract<MessageClient, { t: "conduite" }>, maintenant: number): Sortie[] {
    if (!garage.recevoirConduite(j.id, m, maintenant)) return [];
    // la voiture a bougé : le conducteur et ses passagers suivent ; seul le conducteur donne `lacet` / `tangage` ici
    j.lacet = m.lacet;
    j.tangage = borne(m.tangage, -Math.PI / 2, Math.PI / 2);
    j.etatT = maintenant;
    const o = garage.occupation(j.id);
    if (o) for (const id of garage.vehicules[o.vehicule].sieges) { const c = id === null ? undefined : ctx.joueur(id); if (c) recopier(c); }
    return [];
  }

  return {
    recevoir(j, m, maintenant) {
      switch (m.t) {
        case "monter": return monter(j, m, maintenant);
        case "descendre": return descendre(j, maintenant);
        case "siege": return changerSiege(j, m.siege, maintenant);
        case "conduite": return conduite(j, m, maintenant);
        default: return [];
      }
    },

    occupation(id) {
      return garage.occupation(id);
    },

    liberer(j, maintenant) {
      return garage.liberer(j.id, maintenant).length ? [sieges("tous")] : [];
    },

    tic(maintenant) {
      const sorties: Sortie[] = [];
      garage.tic(maintenant); // abandon (60 s) et conducteur muet (500 ms) : l'état de la voiture change, le snap le porte
      // épaves arrivées à échéance : la PNJ reprend son circuit, la conduisible revient neuve à sa place
      const revenues = carrosseries.tic(maintenant);
      for (const r of revenues) if (r.genre === "vehicule") garage.remettreEnService(r.id, maintenant);
      if (revenues.length) sorties.push(messageVoitures("tous"));
      for (const j of occupants()) {
        recopier(j);
        j.histo.push({ t: maintenant, p: [j.p[0], j.p[1], j.p[2]], accroupi: true });
        while (j.histo.length > 1 && maintenant - j.histo[0].t > HISTORIQUE_OCCUPANT_MS) j.histo.shift();
      }
      if (!ctx.enPhaseJeu()) return sorties;

      // piétons candidats : vivants, en arène, non protégés, à pied ; `tMs` = instant de capture estimé de leur `p`
      const morts = new Set<string>();
      const candidats = ctx.joueursEnJeu()
        .filter((j) => j.vivant && maintenant >= j.protegeJusqua && !garage.occupation(j.id))
        .map((j) => ({ j, tMs: j.etatT - j.ping / 2 }));

      // renversement par une voiture conduisible (vitesse mesurée), crédité au conducteur
      const renversements = garage.renversements(
        candidats.map(({ j, tMs }) => ({ id: j.id, p: j.p, tMs, vivant: true, protege: false })), maintenant,
      );
      for (const r of renversements) {
        const cible = ctx.joueur(r.cible), conducteur = ctx.joueur(r.conducteur);
        if (!cible || !conducteur || cible === conducteur || morts.has(cible.id)) continue;
        morts.add(cible.id);
        sorties.push(...ctx.tuer(cible, conducteur, "ecrase_vehicule", maintenant));
      }

      // circulation PNJ : mort immédiate, aucun kill
      if (circulation) {
        const ecrases = ecrasements(
          circulation.circuits, circulation.voitures.filter((v) => !carrosseries.detruite({ genre: "pnj", id: v.id })),
          candidats.filter(({ j }) => !morts.has(j.id)).map(({ j, tMs }) => ({ id: j.id, p: j.p, tMs })),
          SILHOUETTE.rayon,
        );
        for (const id of ecrases) {
          const cible = ctx.joueur(id);
          if (!cible || morts.has(id)) continue;
          morts.add(id);
          sorties.push(...ctx.tuer(cible, null, "ecrase_pnj", maintenant));
        }
      }
      return sorties;
    },

    reinitialiser(maintenant) {
      // les occupants sont lus AVANT la remise en place (Garage.reinitialiser vide les sièges sans prévenir)
      const sorties: Sortie[] = [];
      let quelquun = false;
      for (const j of occupants()) {
        const sortie = garage.descendre(j.id, maintenant);
        if (!sortie) continue;
        quelquun = true;
        poserDehors(j, sortie.p, sortie.lacet, maintenant);
        sorties.push({ a: j.id, m: { t: "descente", p: sortie.p, lacet: sortie.lacet, raison: "expulse" } });
      }
      garage.reinitialiser(maintenant);
      // les voitures ont aussi changé de place, mais le snap les porte : `sieges` n'est utile que si des sièges ont été vidés
      if (quelquun) sorties.push(sieges("tous"));
      // toutes les voitures neuves, plus aucune épave
      const abimees = carrosseries.etats().length > 0;
      carrosseries.reinitialiser();
      if (abimees) sorties.push(messageVoitures("tous"));
      return sorties;
    },

    synchro(idDest) {
      return [sieges(idDest), messageVoitures(idDest)];
    },

    snap() {
      return garage.snap();
    },

    oeilsPossibles(j, maintenant, fenetreMs) {
      return garage.occupation(j.id) ? garage.yeuxPossibles(j.id, maintenant, fenetreMs) : null;
    },

    estConducteur(id) {
      return garage.occupation(id)?.siege === 0;
    },

    voitures(maintenant) {
      const r: ObstacleVoiture[] = garage.vehicules.map((v) => ({
        p: v.p, cap: v.cap, demiLongueur: VEH.longueur / 2, demiLargeur: VEH.largeur / 2,
        vitesse: v.sieges[0] !== null ? garage.vitesseMesuree(v.id, maintenant) : 0, conducteur: v.sieges[0],
      }));
      if (circulation) {
        for (const v of circulation.voitures) {
          const e = etatVoiture(circulation.circuits[v.circuit], v, maintenant);
          r.push({ p: e.p, cap: e.cap, demiLongueur: VOITURE.longueur / 2, demiLargeur: VOITURE.largeur / 2, vitesse: e.v, conducteur: null });
        }
      }
      return r;
    },

    tirVoitures(j, o, dirs, declarations, arme, plombsPris, maintenant) {
      if (!Array.isArray(declarations) || !declarations.length || !ctx.enPhaseJeu()) return [];
      const portee = STATS[arme].portee;
      const cumul = new Map<string, { ref: RefVoiture; degats: number }>();
      const plombs = new Set(plombsPris);
      for (const t of declarations.slice(0, dirs.length)) {
        if (!t || (t.genre !== "pnj" && t.genre !== "vehicule") || !Number.isInteger(t.id) || !Number.isInteger(t.plomb)) continue;
        if (t.plomb < 0 || t.plomb >= dirs.length || plombs.has(t.plomb)) continue;
        const ref: RefVoiture = { genre: t.genre, id: t.id };
        const d = dirs[t.plomb];
        // la caisse rejouée sur la latence du tireur ; la balle ne traverse pas un bâtiment avant d'y arriver
        let distance: number | null = null;
        for (let dt = 0; dt <= REWIND_VOITURE_MS && distance === null; dt += PAS_REWIND_VOITURE_MS) {
          const c = caisse(ref, maintenant - dt);
          if (!c) break;
          const k = rayonVoiture(o, d, c.p, c.cap, portee, CARROSSERIE.margeValidation);
          if (k !== null && lancerRayon(ctx.monde, o, d, k) === Infinity) distance = k;
        }
        if (distance === null) continue;
        plombs.add(t.plomb);
        const cle = `${ref.genre}:${ref.id}`;
        const degats = degatsPlomb(arme, "corps", distance);
        const cu = cumul.get(cle);
        if (cu) cu.degats += degats;
        else cumul.set(cle, { ref, degats });
      }
      const sorties: Sortie[] = [];
      let change = false;
      for (const { ref, degats } of cumul.values()) {
        const c = caisse(ref, maintenant);
        if (!c) continue;
        const r = carrosseries.toucher(ref, degats, maintenant, c);
        change ||= r.change;
        if (r.detruite) sorties.push(...exploser({ ref, ...c }, j, arme, maintenant));
      }
      if (change) sorties.push(messageVoitures("tous"));
      return sorties;
    },
  };
}
