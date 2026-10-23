/**
 * Garage des voitures conduisibles (PUR, logique serveur) : 6 voitures garées, attribution et libération des sièges, autorité du
 * conducteur bornée (`conduite`), historique des états pour rejouer la voiture à un instant passé (tirs de passagers, renversements),
 * vitesse MESURÉE par le serveur (jamais le `v` déclaré). N'importe pas `match.ts` : la salle (S2) l'appelle avec ses horloges.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.12, §5.7)
 */
import { resoudre, type Monde } from "./collision";
import { JEU, OEIL_SIEGE, PLAFONDS, SIEGES_PAR_VEHICULE, SILHOUETTE } from "./protocole";
import type { InfoVehicule, MessageClient, Siege, Vec3, VehiculeSnap } from "./protocole";
import { VEH, distanceVehicule, pointDeSortie, positionSiege, renverse, type EtatVehicule } from "./vehicule";
import type { Vec2 } from "../agroparc3d/types";

export interface EtatVehiculeDate { t: number; p: Vec3; cap: number; v: number }
export interface VehiculeSalle {
  id: number; p: Vec3; cap: number; v: number; sieges: (string | null)[];
  conduiteSeq: number; conduiteT: number; libreDepuisT: number | null; depart: { p: Vec3; cap: number };
  /** états reçus (conduite) des HISTORIQUE_MS dernières ms, pour rejouer la voiture à un instant passé */
  histo: EtatVehiculeDate[];
}
/** Le conducteur ne tire pas (les passagers oui) ; `true` si le conducteur doit aussi tirer (§11, décision 1). */
export const CONDUCTEUR_TIRE = false;
/** Voiture inoccupée et déplacée depuis ce délai (ms) : remise à sa place. */
export const ABANDON_MS = 60_000;
/** Un conducteur qui n'a rien envoyé depuis ce délai (ms) : la voiture est arrêtée (v = 0). */
export const SILENCE_CONDUCTEUR_MS = 500;
/**
 * Durée (ms) de l'historique des états d'une voiture. Plus longue que celle des joueurs (400 ms) : le test d'un piéton remonte de
 * `ping/2` + `JEU.interpolationMs` (110 ms) avant l'état courant, et un tir de passager de `REWIND_MAX_MS` (300 ms).
 */
export const HISTORIQUE_VEHICULE_MS = 1000;
/** Fenêtre (ms) de la vitesse mesurée : déplacement entre le dernier état et celui d'environ 100 ms avant. */
export const FENETRE_VITESSE_MS = 100;
/** Pénétration maximale (m) d'un cercle de la voiture dans un bâtiment pour accepter une `conduite`. */
export const PENETRATION_MAX_M = 0.6;
/** Écart horizontal toléré (m) entre deux états de `conduite`, en plus de vitesseVehiculeMax × dt. */
export const MARGE_DEPLACEMENT_M = 1;
/** Une voiture inoccupée à moins de ce déplacement (m) de sa place n'est pas considérée comme déplacée. */
const DEPLACEMENT_ABANDON_M = 0.5;
/** Plafond du dt (s) utilisé pour borner un déplacement : un conducteur longtemps silencieux ne gagne pas de téléportation. */
const DT_MAX_S = 1;
const DT_MIN_S = 1 / 60;
const DECALAGES_CERCLES: readonly number[] = [-1.2, 0, 1.2];
export type ResultatMonter = { ok: true; siege: Siege } | { ok: false; raison: "loin" | "plein" | "deja" | "inconnu" };

const SIEGES: readonly Siege[] = [0, 1, 2, 3];
const arrondi = (x: number, n: number) => Math.round(x * n) / n + 0;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

export class Garage {
  readonly vehicules: VehiculeSalle[] = [];
  /** Dernier instant (ms) vu par un appel : sert quand l'appelant n'en passe pas (`changerSiege`). */
  private horloge: number;

  constructor(emplacements: readonly { p: Vec2; cap: number }[], private readonly monde: Monde, maintenant: number) {
    this.horloge = maintenant;
    emplacements.forEach((e, id) => {
      this.vehicules.push({
        id, p: [e.p[0], 0, e.p[1]], cap: e.cap, v: 0, sieges: Array.from({ length: SIEGES_PAR_VEHICULE }, () => null),
        conduiteSeq: -1, conduiteT: maintenant, libreDepuisT: maintenant, depart: { p: [e.p[0], 0, e.p[1]], cap: e.cap }, histo: [],
      });
    });
  }

  /** Nouveau match : toutes les voitures à leur place, arrêtées, sièges vidés (la salle a prévenu les occupants avant : `descente{expulse}`). */
  reinitialiser(maintenant: number): void {
    this.horloge = maintenant;
    for (const v of this.vehicules) {
      v.sieges.fill(null);
      this.remettreEnPlace(v, maintenant);
    }
  }

  private remettreEnPlace(v: VehiculeSalle, maintenant: number): void {
    v.p = [v.depart.p[0], 0, v.depart.p[2]];
    v.cap = v.depart.cap;
    v.v = 0;
    v.histo = []; // un saut de 40 m ne doit jamais être interpolé par etatAu
    v.conduiteSeq = -1;
    v.conduiteT = maintenant;
    if (v.sieges.every((s) => s === null)) v.libreDepuisT = maintenant;
  }

  private etat(v: VehiculeSalle): EtatVehicule {
    return { p: v.p, cap: v.cap, v: v.v };
  }

  occupation(joueurId: string): { vehicule: number; siege: Siege } | null {
    for (const v of this.vehicules) {
      const i = v.sieges.indexOf(joueurId);
      if (i >= 0) return { vehicule: v.id, siege: i as Siege };
    }
    return null;
  }

  monter(joueurId: string, p: Vec3, vehicule: number, siege: Siege | undefined, maintenant: number): ResultatMonter {
    this.horloge = maintenant;
    const v = this.vehicules[vehicule];
    if (!v || !Number.isInteger(vehicule)) return { ok: false, raison: "inconnu" };
    if (this.occupation(joueurId)) return { ok: false, raison: "deja" };
    if (distanceVehicule(this.etat(v), p) > VEH.distanceMontee) return { ok: false, raison: "loin" };
    let s: Siege | -1 = -1;
    if (siege === undefined) s = (SIEGES.find((k) => v.sieges[k] === null) ?? -1) as Siege | -1;
    else if (SIEGES.includes(siege) && v.sieges[siege] === null) s = siege;
    if (s < 0) return { ok: false, raison: "plein" };
    this.asseoir(v, joueurId, s as Siege, maintenant);
    return { ok: true, siege: s as Siege };
  }

  /** Occupe le siège ; au siège 0 le conducteur repart d'une séquence neuve et dispose de SILENCE_CONDUCTEUR_MS pour parler. */
  private asseoir(v: VehiculeSalle, joueurId: string, siege: Siege, maintenant: number): void {
    v.sieges[siege] = joueurId;
    v.libreDepuisT = null;
    if (siege === 0) { v.conduiteSeq = -1; v.conduiteT = maintenant; }
  }

  /** Vide le siège ; si c'était le conducteur, la voiture est arrêtée. */
  private vider(v: VehiculeSalle, siege: number, maintenant: number): void {
    v.sieges[siege] = null;
    if (siege === 0) v.v = 0;
    if (v.sieges.every((s) => s === null)) v.libreDepuisT = maintenant;
  }

  /** Libère le siège ; renvoie le point de sortie ou null. Un conducteur qui descend arrête la voiture. */
  descendre(joueurId: string, maintenant: number): { p: Vec3; lacet: number } | null {
    this.horloge = maintenant;
    const o = this.occupation(joueurId);
    if (!o) return null;
    const v = this.vehicules[o.vehicule];
    // le point est calculé sur la voiture AVANT de la lâcher (la sortie ne dépend pas de la vitesse)
    const p = pointDeSortie(this.etat(v), o.siege, this.monde);
    this.vider(v, o.siege, maintenant);
    return { p, lacet: v.cap };
  }

  /** Le siège cible doit être libre. Passer au siège 0 réinitialise la séquence de `conduite` ; quitter le siège 0 arrête la voiture. */
  changerSiege(joueurId: string, siege: Siege, maintenant: number = this.horloge): boolean {
    this.horloge = maintenant;
    const o = this.occupation(joueurId);
    if (!o || !SIEGES.includes(siege) || siege === o.siege) return false;
    const v = this.vehicules[o.vehicule];
    if (v.sieges[siege] !== null) return false;
    this.vider(v, o.siege, maintenant);
    this.asseoir(v, joueurId, siege, maintenant);
    return true;
  }

  /**
   * Libère le siège dans TOUS les cas de départ : mort, quitter, déconnexion, éviction, nouveau match (≠ `descendre`, qui est volontaire et renvoie le point de sortie).
   * Un conducteur qui part arrête la voiture (v = 0). Renvoie les ids de véhicules dont l'occupation a changé (pour diffuser `sieges`).
   */
  liberer(joueurId: string, maintenant: number): number[] {
    this.horloge = maintenant;
    const o = this.occupation(joueurId);
    if (!o) return [];
    this.vider(this.vehicules[o.vehicule], o.siege, maintenant);
    return [o.vehicule];
  }

  /** Validation (conducteur du siège 0, seq croissante, bornes, vitesse ≤ PLAFONDS.vitesseVehiculeMax, pas dans un bâtiment) ; `y` imposé à 0 ; alimente `histo`. */
  recevoirConduite(joueurId: string, m: Extract<MessageClient, { t: "conduite" }>, maintenant: number): boolean {
    this.horloge = maintenant;
    const o = this.occupation(joueurId);
    if (!o || o.siege !== 0 || o.vehicule !== m.vehicule) return false;
    const veh = this.vehicules[o.vehicule];
    if (!Number.isFinite(m.seq) || m.seq <= veh.conduiteSeq) return false;
    if (!Array.isArray(m.p) || ![m.p[0], m.p[2], m.cap, m.v, m.lacet, m.tangage].every(Number.isFinite)) return false;
    const x = m.p[0], z = m.p[2]; // m.p[1] est ignoré : la voiture reste au sol
    const b = this.monde.bornes;
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return false;
    // vitesse : déplacement horizontal depuis le dernier état accepté (ou la position actuelle), borné par la vitesse max d'une voiture
    const dt = Math.min(Math.max((maintenant - veh.conduiteT) / 1000, DT_MIN_S), DT_MAX_S);
    const dh = Math.hypot(x - veh.p[0], z - veh.p[2]);
    if (dh > PLAFONDS.vitesseVehiculeMax * dt + MARGE_DEPLACEMENT_M) return false;
    // pas dans un bâtiment : les 3 cercles de la caisse ne pénètrent pas de plus de PENETRATION_MAX_M
    const fx = -Math.sin(m.cap), fz = -Math.cos(m.cap);
    for (const d of DECALAGES_CERCLES) {
      const r = resoudre(this.monde, [x + fx * d, 0, z + fz * d], VEH.rayonCercle, VEH.hauteur);
      for (const c of r.contacts) if (c.prisme >= 0 && c.profondeur > PENETRATION_MAX_M) return false;
    }
    veh.p = [x, 0, z];
    veh.cap = m.cap;
    veh.v = Math.min(Math.max(m.v, -VEH.vitesseArriere), VEH.vitesseMax);
    veh.conduiteSeq = m.seq;
    veh.conduiteT = maintenant;
    veh.histo.push({ t: maintenant, p: [x, 0, z], cap: m.cap, v: veh.v });
    this.purger(veh, maintenant);
    return true;
  }

  private purger(v: VehiculeSalle, maintenant: number): void {
    let n = 0;
    while (n < v.histo.length - 1 && maintenant - v.histo[n].t > HISTORIQUE_VEHICULE_MS) n++;
    if (n) v.histo.splice(0, n);
  }

  /** Position des pieds d'un occupant (siège) ou null. */
  positionOccupant(joueurId: string): Vec3 | null {
    const o = this.occupation(joueurId);
    return o ? positionSiege(this.etat(this.vehicules[o.vehicule]), o.siege) : null;
  }

  /** Vecteur vitesse (m/s) du véhicule d'un occupant (cap × v) ou null : le serveur le recopie dans `j.v` de TOUS les occupants. */
  vitesseOccupant(joueurId: string): Vec3 | null {
    const o = this.occupation(joueurId);
    if (!o) return null;
    const v = this.vehicules[o.vehicule];
    return [-Math.sin(v.cap) * v.v, 0, -Math.cos(v.cap) * v.v];
  }

  /** Yeux possibles d'un occupant sur les `fenetreMs` dernières ms (siège de chaque état de `histo` + OEIL_SIEGE) : un tir de passager est valide si `o` est près de l'un d'eux. */
  yeuxPossibles(joueurId: string, maintenant: number, fenetreMs: number): Vec3[] {
    const o = this.occupation(joueurId);
    if (!o) return [];
    const v = this.vehicules[o.vehicule];
    const yeux: Vec3[] = [];
    const ajouter = (e: EtatVehicule) => {
      const s = positionSiege(e, o.siege);
      yeux.push([s[0], s[1] + OEIL_SIEGE, s[2]]);
    };
    for (const h of v.histo) if (maintenant - h.t <= fenetreMs) ajouter(h);
    ajouter(this.etat(v)); // l'état courant (immobile : l'historique peut être vide ou périmé)
    return yeux;
  }

  /** État interpolé de la voiture à l'instant `tMs` (serveur) ; l'état courant si `tMs` est postérieur au dernier. */
  etatAu(vehicule: number, tMs: number): EtatVehiculeDate | null {
    const v = this.vehicules[vehicule];
    if (!v) return null;
    const h = v.histo;
    const courant = (t: number): EtatVehiculeDate => ({ t, p: [v.p[0], v.p[1], v.p[2]], cap: v.cap, v: v.v });
    if (!h.length) return courant(tMs);
    const dernier = h[h.length - 1];
    if (tMs >= dernier.t) return courant(dernier.t);
    if (tMs <= h[0].t) return { ...h[0], p: [...h[0].p] as Vec3 };
    let i = 1;
    while (h[i].t < tMs) i++;
    const a = h[i - 1], b = h[i];
    const k = b.t > a.t ? (tMs - a.t) / (b.t - a.t) : 1;
    return {
      t: tMs,
      p: [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k],
      cap: lerpAngle(a.cap, b.cap, k),
      v: a.v + (b.v - a.v) * k,
    };
  }

  /** Vitesse MESURÉE (m/s) par déplacement entre états sur ≈ 100 ms ; 0 si moins de 2 états. */
  vitesseMesuree(vehicule: number, maintenant: number): number {
    const v = this.vehicules[vehicule];
    if (!v || v.histo.length < 2) return 0;
    const b = v.histo[v.histo.length - 1];
    // plus d'état récent : le conducteur est muet (ou parti), la voiture n'a plus de vitesse crédible
    if (maintenant - b.t > SILENCE_CONDUCTEUR_MS) return 0;
    // l'état le plus récent qui a au moins FENETRE_VITESSE_MS d'avance, sinon le plus ancien disponible
    let a = v.histo[0];
    for (let i = v.histo.length - 2; i >= 0; i--) {
      if (b.t - v.histo[i].t >= FENETRE_VITESSE_MS) { a = v.histo[i]; break; }
    }
    const dt = (b.t - a.t) / 1000;
    if (!(dt > 0)) return 0;
    return Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) / dt;
  }

  /** Voitures inoccupées déplacées depuis ≥ ABANDON_MS : remises à leur place ; conducteur muet depuis SILENCE_CONDUCTEUR_MS : v = 0 ; renvoie les ids remis en place. */
  tic(maintenant: number): number[] {
    this.horloge = maintenant;
    const remis: number[] = [];
    for (const v of this.vehicules) {
      this.purger(v, maintenant);
      if (v.sieges[0] !== null) {
        if (v.v !== 0 && maintenant - v.conduiteT > SILENCE_CONDUCTEUR_MS) v.v = 0; // client gelé : sans cela, voiture extrapolée puis fantôme
        continue;
      }
      if (v.sieges.some((s) => s !== null) || v.libreDepuisT === null) continue;
      if (maintenant - v.libreDepuisT < ABANDON_MS) continue;
      const deplace = Math.hypot(v.p[0] - v.depart.p[0], v.p[2] - v.depart.p[2]) > DEPLACEMENT_ABANDON_M
        || Math.abs(Math.atan2(Math.sin(v.cap - v.depart.cap), Math.cos(v.cap - v.depart.cap))) > 0.05;
      if (!deplace) continue;
      this.remettreEnPlace(v, maintenant);
      v.libreDepuisT = maintenant;
      remis.push(v.id);
    }
    return remis;
  }

  infos(): InfoVehicule[] {
    return this.vehicules.map((v) => ({ id: v.id, sieges: [...v.sieges] }));
  }

  snap(): VehiculeSnap[] {
    return this.vehicules.map((v) => ({
      id: v.id, p: [arrondi(v.p[0], 100), arrondi(v.p[1], 100), arrondi(v.p[2], 100)], cap: arrondi(v.cap, 1000), v: arrondi(v.v, 100),
    }));
  }

  /**
   * Joueurs à pied renversés (vivants, non protégés, non occupants) avec le conducteur responsable. Pour chaque piéton, `tMs` = instant de capture estimé de `p`
   * (`etatT − ping/2`) : la voiture est testée à `tMs − JEU.interpolationMs` (`etatAu`), c'est ce que la victime voyait. Seuil : `vitesseMesuree` ≥ VEH.vitesseRenverse.
   */
  renversements(
    joueurs: readonly { id: string; p: Vec3; tMs: number; vivant: boolean; protege: boolean }[], maintenant: number,
  ): { cible: string; conducteur: string }[] {
    const res: { cible: string; conducteur: string }[] = [];
    for (const v of this.vehicules) {
      const conducteur = v.sieges[0];
      if (conducteur === null) continue; // sans conducteur, personne à créditer (et la voiture n'a pas de vitesse mesurée)
      const vitesse = this.vitesseMesuree(v.id, maintenant);
      if (vitesse < VEH.vitesseRenverse) continue;
      for (const j of joueurs) {
        if (!j.vivant || j.protege || res.some((r) => r.cible === j.id) || this.occupation(j.id)) continue;
        const e = this.etatAu(v.id, j.tMs - JEU.interpolationMs);
        if (e && renverse(e, j.p, SILHOUETTE.rayon, vitesse)) res.push({ cible: j.id, conducteur });
      }
    }
    return res;
  }
}
