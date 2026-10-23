/**
 * Monde dynamique côté client (PUR, ni three ni DOM) : voitures PNJ à l'horloge serveur, voitures conduisibles interpolées, sièges,
 * Elsa (position, flèche, distance), invite d'interaction sous le viseur. Appelé par `jeu.ts` (lot J1).
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§5.20)
 *
 * Aucune horloge ni aléa ici : toutes les dates sont passées en paramètre (horloge serveur, ms).
 */
import type { Monde } from "./collision";
import { construireCircuits, etatVoiture, flotte, type Circuit, type EtatVoiture, type VoiturePnj } from "./circulation";
import { JEU, type EtatElsaMsg, type InfoVehicule, type Siege, type Vec3, type VehiculeSnap } from "./protocole";
import { InterpolateurVehicules } from "./interpolation-vehicules";
import { repereElsa as repereVers } from "./radar";
import { distanceVehicule, VEH } from "./vehicule";
import { positionElsa } from "./zones";
import type { SceneData } from "../agroparc3d/types";

export type InviteInteraction = { invite: "" | "elsa" | "monter" | "descendre"; detail: string; vehicule: number | null };

/** Distance (m) sous laquelle l'invite « prendre le cadeau d'Elsa » s'affiche (le ramassage serveur, lui, exige `ELSA.rayonRamassage`). */
export const DISTANCE_INVITE_ELSA_M = 6;
/** Nombre de sièges d'une voiture (écrit « n/4 » dans l'invite « monter »). */
const SIEGES_PAR_VOITURE = 4;
/** Sièges d'une voiture dont l'occupation n'est pas (encore) connue : tous libres. Jamais modifié. */
const SIEGES_LIBRES: readonly (string | null)[] = Object.freeze([null, null, null, null]);
const INVITE_VIDE: InviteInteraction = { invite: "", detail: "", vehicule: null };

export class MondeJeu {
  private readonly circuits: Circuit[];
  private readonly pnj: VoiturePnj[];
  private readonly interpolateur = new InterpolateurVehicules();
  private readonly sieges = new Map<number, (string | null)[]>();
  private readonly posElsaDefaut: { x: number; z: number };
  private etatElsa: EtatElsaMsg | null = null;
  private posElsa: { x: number; z: number };

  constructor(data: SceneData, _monde: Monde) {
    this.circuits = construireCircuits();
    this.pnj = flotte(this.circuits);
    const [x, z] = positionElsa(data);
    this.posElsaDefaut = { x, z };
    this.posElsa = { x, z };
  }

  /** Voitures PNJ à l'horloge serveur `tMs` (12 états, ordre de `flotte`). Pendant la killcam : `tMs` = `ControleurKillcam.tempsServeur()`. */
  etatsPnj(tMs: number): EtatVoiture[] {
    return this.pnj.map((v) => etatVoiture(this.circuits[v.circuit], v, tMs));
  }

  /**
   * Snaps de voitures conduisibles reçus (tampon de 1 s) ; `vehiculesA` les interpole à `tsServeur − interpolationMs`.
   * `undefined` (snap sans `vehicules` : spectateur à 10 Hz) est ignoré : ce n'est pas « plus aucune voiture ».
   */
  alimenterVehicules(ts: number, v: readonly VehiculeSnap[] | undefined): void {
    if (!v) return;
    this.interpolateur.ajouter(ts, v);
  }

  /** Voitures conduisibles interpolées à l'horodatage serveur demandé (extrapolation bornée à 150 ms, sauts non lissés). */
  vehiculesA(tsServeur: number): Map<number, VehiculeSnap> {
    return this.interpolateur.echantillon(tsServeur);
  }

  /** `sieges` : occupation de TOUTES les voitures (état complet), qui remplace la précédente. */
  majSieges(infos: readonly InfoVehicule[]): void {
    this.sieges.clear();
    for (const i of infos) this.sieges.set(i.id, i.sieges.slice(0, SIEGES_PAR_VOITURE));
  }

  /** Occupants par siège (`null` = libre) ; quatre places libres pour une voiture inconnue. À ne pas modifier. */
  siegesDe(vehicule: number): readonly (string | null)[] {
    return this.sieges.get(vehicule) ?? SIEGES_LIBRES;
  }

  /**
   * `elsa` (état complet) ; `null` = plus d'offre : le cadeau disparaît mais Elsa reste où elle était (sa position est fixe).
   * Une offre déjà expirée côté serveur arrive toujours avec `offre: null`.
   */
  majElsa(m: EtatElsaMsg | null): void {
    if (!m) {
      if (this.etatElsa) this.etatElsa = { x: this.etatElsa.x, z: this.etatElsa.z, offre: null };
      return;
    }
    this.etatElsa = { x: m.x, z: m.z, offre: m.offre ? { ...m.offre } : null };
    this.posElsa = { x: m.x, z: m.z };
  }

  /** Dernier état reçu (offre comprise), null avant le premier message ; à ne pas modifier. */
  elsa(): EtatElsaMsg | null {
    return this.etatElsa;
  }

  /** Position d'Elsa : celle du dernier message, sinon celle de la scène (POI `truck` + 5 m). */
  position(): { x: number; z: number } {
    return { x: this.posElsa.x, z: this.posElsa.z };
  }

  /**
   * Flèche vers Elsa : angle relatif au regard (rad, 0 = devant, + = à droite) et distance arrondie à 10 m ; distance −1 sans offre.
   * `maintenantServeur` (facultatif) écarte une offre dont `finT` est passée (message `expiree` en retard).
   */
  repereElsa(p: Vec3, lacet: number, maintenantServeur?: number): { elsaAngle: number; elsaDistance: number } {
    if (!this.offreEnCours(maintenantServeur)) return { elsaAngle: 0, elsaDistance: -1 };
    const r = repereVers(p[0], p[2], lacet, this.posElsa);
    return { elsaAngle: r.angle, elsaDistance: r.distance };
  }

  /**
   * Invite sous le viseur. En véhicule : « descendre ». Sinon le cadeau d'Elsa à moins de `DISTANCE_INVITE_ELSA_M` (prioritaire), sinon la
   * voiture la plus proche à `VEH.distanceMontee` au plus (« monter », `detail` = « occupants/4 » : « 4/4 » avertit que la voiture est pleine,
   * le serveur refusera). Les voitures sont lues à `maintenantServeur − interpolationMs`, là où le joueur les voit.
   */
  invite(p: Vec3, siege: Siege | null, maintenantServeur: number): InviteInteraction {
    if (siege !== null) return { invite: "descendre", detail: "", vehicule: null };

    if (this.offreEnCours(maintenantServeur) && Math.hypot(p[0] - this.posElsa.x, p[2] - this.posElsa.z) < DISTANCE_INVITE_ELSA_M) {
      return { invite: "elsa", detail: "", vehicule: null };
    }

    let meilleur: { id: number; d: number } | null = null;
    for (const v of this.interpolateur.echantillon(maintenantServeur - JEU.interpolationMs).values()) {
      const d = distanceVehicule({ p: v.p, cap: v.cap, v: v.v }, p);
      if (d <= VEH.distanceMontee && (!meilleur || d < meilleur.d)) meilleur = { id: v.id, d };
    }
    if (!meilleur) return { ...INVITE_VIDE };
    const occupants = this.siegesDe(meilleur.id).filter((s) => s !== null).length;
    return { invite: "monter", detail: `${occupants}/${SIEGES_PAR_VOITURE}`, vehicule: meilleur.id };
  }

  /** Changement de partie ou d'id de client : plus de voiture, de siège ni d'offre ; Elsa revient à sa position de la scène. */
  reinitialiser(): void {
    this.interpolateur.vider();
    this.sieges.clear();
    this.etatElsa = null;
    this.posElsa = { x: this.posElsaDefaut.x, z: this.posElsaDefaut.z };
  }

  /** Une offre existe et n'est pas échue (si l'horloge est connue). */
  private offreEnCours(maintenantServeur?: number): boolean {
    const o = this.etatElsa?.offre;
    if (!o) return false;
    return maintenantServeur === undefined || maintenantServeur < o.finT;
  }
}
