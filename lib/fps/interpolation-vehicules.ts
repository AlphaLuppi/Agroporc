/**
 * Interpolation des voitures conduisibles côté client (PUR) : deux instances, 1000 ms (affichage) et `KILLCAM.tamponMs` (rejeu), alimentées
 * comme les deux `Interpolateur` de joueurs. Extrapolation bornée à 150 ms ; angles par le plus court chemin ; un écart de position entre deux
 * échantillons supérieur à PLAFONDS.vitesseVehiculeMax × Δt + 3 m est un SAUT (remise en place à 60 s, nouveau match) : pas d'interpolation.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.12, §5.8)
 */
import { PLAFONDS, type VehiculeSnap } from "./protocole";
import { lerpAngle } from "./reseau";

/** Tampon par défaut (ms), comme `Interpolateur`. */
const TAMPON_MS = 1000;
/** Extrapolation maximale au-delà du dernier échantillon (ms). */
const EXTRAPOLATION_MAX_MS = 150;
/** Marge (m) ajoutée à vitesseVehiculeMax × Δt pour reconnaître un saut. */
const MARGE_SAUT_M = 3;

interface Echantillon { ts: number; vehicules: Map<number, VehiculeSnap> }

function copie(e: VehiculeSnap): VehiculeSnap {
  return { id: e.id, p: [e.p[0], e.p[1], e.p[2]], cap: e.cap, v: e.v };
}

export class InterpolateurVehicules {
  private echantillons: Echantillon[] = [];

  /** Deux instances côté client : 1000 ms (affichage) et KILLCAM.tamponMs (rejeu), alimentées comme les deux `Interpolateur` de joueurs. */
  constructor(private readonly tamponMs: number = TAMPON_MS) {}

  ajouter(ts: number, vehicules: readonly VehiculeSnap[]): void {
    const e: Echantillon = { ts, vehicules: new Map(vehicules.map((v) => [v.id, copie(v)])) };
    // insertion ordonnée (les paquets peuvent arriver dans le désordre) ; même ts = remplacement
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

  /**
   * Positions interpolées à l'horodatage serveur demandé ; extrapolation bornée à 150 ms ; angles par le plus court chemin.
   * Un écart de position entre deux échantillons > PLAFONDS.vitesseVehiculeMax × Δt + 3 m est un SAUT (remise en place à 60 s, nouveau match) : on prend l'échantillon le plus récent, sans interpoler.
   */
  echantillon(tsServeur: number): Map<number, VehiculeSnap> {
    const res = new Map<number, VehiculeSnap>();
    const n = this.echantillons.length;
    if (!n) return res;
    const dernier = this.echantillons[n - 1];

    // tampon en retard : dernier état connu prolongé le long du cap, sur 150 ms au plus
    if (tsServeur >= dernier.ts) {
      const dt = Math.min(tsServeur - dernier.ts, EXTRAPOLATION_MAX_MS) / 1000;
      for (const e of dernier.vehicules.values()) {
        const c = copie(e);
        if (dt > 0) { c.p = [e.p[0] - Math.sin(e.cap) * e.v * dt, e.p[1], e.p[2] - Math.cos(e.cap) * e.v * dt]; }
        res.set(e.id, c);
      }
      return res;
    }

    // b = premier échantillon après tsServeur, a = celui d'avant
    let ib = 0;
    while (ib < n && this.echantillons[ib].ts <= tsServeur) ib++;
    const b = this.echantillons[ib];
    const a = ib > 0 ? this.echantillons[ib - 1] : null;

    // avant le plus ancien échantillon : on tient la position la plus ancienne connue
    if (!a) {
      for (const e of b.vehicules.values()) if (dernier.vehicules.has(e.id)) res.set(e.id, copie(e));
      return res;
    }

    const t = b.ts > a.ts ? (tsServeur - a.ts) / (b.ts - a.ts) : 1;
    const dtS = (b.ts - a.ts) / 1000;
    for (const eb of b.vehicules.values()) {
      if (!dernier.vehicules.has(eb.id)) continue; // disparu depuis
      const ea = a.vehicules.get(eb.id);
      if (!ea) { res.set(eb.id, copie(eb)); continue; }
      const ecart = Math.hypot(eb.p[0] - ea.p[0], eb.p[1] - ea.p[1], eb.p[2] - ea.p[2]);
      if (ecart > PLAFONDS.vitesseVehiculeMax * dtS + MARGE_SAUT_M) { res.set(eb.id, copie(eb)); continue; }
      res.set(eb.id, {
        id: eb.id,
        p: [ea.p[0] + (eb.p[0] - ea.p[0]) * t, ea.p[1] + (eb.p[1] - ea.p[1]) * t, ea.p[2] + (eb.p[2] - ea.p[2]) * t],
        cap: lerpAngle(ea.cap, eb.cap, t),
        v: ea.v + (eb.v - ea.v) * t,
      });
    }
    return res;
  }
}
