/**
 * Service des véhicules de la salle (PUR) : enveloppe `Garage` (voitures conduisibles) et la circulation PNJ (`flotte`, `ecrasements`) :
 * `monter` / `descendre` / `siege` / `conduite`, libération des sièges, renversements et écrasements. Ne voit la salle que par `ContexteSalle`.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.11, §2.12, §5.19, §6.1bis)
 */
import type { Vec2 } from "../agroparc3d/types";
import { VOITURE, ecrasements, etatVoiture, type Circuit, type VoiturePnj } from "./circulation";
import { Garage } from "./garage";
import type { ContexteSalle, JoueurSalle, ServiceVehicules, Sortie } from "./match-contexte";
import { SIEGES_PAR_VEHICULE, SILHOUETTE, type MessageClient, type Siege } from "./protocole";
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

const estSiege = (s: unknown): s is Siege => Number.isInteger(s) && (s as number) >= 0 && (s as number) < SIEGES_PAR_VEHICULE;
const borne = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

export function creerServiceVehicules(ctx: ContexteSalle, opts: OptionsServiceVehicules): ServiceVehicules {
  const garage = new Garage(opts.vehicules ?? [], ctx.monde, opts.maintenant ?? 0);
  const circulation = opts.circulation;

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
          circulation.circuits, circulation.voitures,
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
      return sorties;
    },

    synchro(idDest) {
      return [sieges(idDest)];
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
  };
}
