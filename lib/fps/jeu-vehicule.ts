/**
 * Contrôle d'une voiture côté client (PUR, entrées injectées) : le conducteur simule en local et envoie `conduite` à 30 Hz ; le passager
 * suit l'état interpolé de la voiture. Touches → commandes : avant/arrière → accel, gauche/droite → direction, saut → frein à main.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.12, §5.9)
 */
import type { Monde } from "./collision";
import type { EtatJoueurSnap, MessageClient, Siege, Vec3 } from "./protocole";
import { pasVehicule, positionSiege, type EtatVehicule, type CommandesVehicule } from "./vehicule";

export interface InfoSiegeLocal { vehicule: number; siege: Siege }

/** Pas maximal (s) d'un appel à `pasVehicule` ; un dt d'image plus long (onglet ralenti) est découpé, puis plafonné. */
const PAS_MAX_S = 1 / 60;
const DT_MAX_S = 0.1;
const MS_PAR_KMH = 3.6;

/** Arrondi à 1/n ; le `+ 0` évite un -0 dans le JSON. */
const arrondi = (x: number, n: number) => Math.round(x * n) / n + 0;
const borne = (x: number) => (x < -1 ? -1 : x > 1 ? 1 : x);

export class ControleurVehicule {
  private info: InfoSiegeLocal | null = null;
  private e: EtatVehicule | null = null;
  private seq = 0;
  private chocPas = 0;

  constructor(private readonly monde: Monde) {}

  actif(): InfoSiegeLocal | null {
    return this.info ? { ...this.info } : null;
  }

  /** Prend (ou change de) place. Le serveur remet sa séquence de `conduite` à zéro à chaque arrivée au siège 0 : la nôtre aussi. */
  entrer(info: InfoSiegeLocal, etat: EtatVehicule): void {
    this.info = { ...info };
    this.e = { p: [etat.p[0], etat.p[1], etat.p[2]], cap: etat.cap, v: etat.v };
    this.seq = 0;
    this.chocPas = 0;
  }

  sortir(): void {
    this.info = null;
    this.e = null;
    this.chocPas = 0;
  }

  /** Conducteur : avance la simulation locale. Passager : ne fait rien. */
  maj(dt: number, cmd: CommandesVehicule): void {
    this.chocPas = 0;
    if (!this.e || !this.estConducteur() || !(dt > 0)) return;
    let reste = Math.min(dt, DT_MAX_S);
    while (reste > 1e-9) {
      const h = Math.min(reste, PAS_MAX_S);
      const r = pasVehicule(this.e, cmd, h, this.monde);
      this.e = r.etat;
      this.chocPas = Math.max(this.chocPas, r.choc);
      reste -= h;
    }
  }

  /** Vitesse perdue au contact (m/s) pendant le dernier `maj`, pour le son de choc ; 0 sans contact. */
  choc(): number {
    return this.chocPas;
  }

  /** Passager : l'état de la voiture vient du snap interpolé. */
  suivre(etat: EtatVehicule): void {
    if (!this.info || this.estConducteur()) return;
    this.e = { p: [etat.p[0], etat.p[1], etat.p[2]], cap: etat.cap, v: etat.v };
  }

  etat(): EtatVehicule | null {
    return this.e ? { p: [this.e.p[0], this.e.p[1], this.e.p[2]], cap: this.e.cap, v: this.e.v } : null;
  }

  estConducteur(): boolean {
    return this.info?.siege === 0;
  }

  vitesseKmh(): number {
    return this.e ? Math.abs(this.e.v) * MS_PAR_KMH : 0;
  }

  positionSiege(): Vec3 | null {
    return this.e && this.info ? positionSiege(this.e, this.info.siege) : null;
  }

  /** Message `conduite` du conducteur (seq croissante gérée ici). */
  messageConduite(lacet: number, tangage: number): Extract<MessageClient, { t: "conduite" }> | null {
    if (!this.e || !this.info || !this.estConducteur()) return null;
    return {
      t: "conduite", seq: this.seq++, vehicule: this.info.vehicule,
      p: [arrondi(this.e.p[0], 100), 0, arrondi(this.e.p[2], 100)], cap: arrondi(this.e.cap, 1000), v: arrondi(this.e.v, 100),
      lacet, tangage,
    };
  }
}

/** Touches → commandes : avant/arrière → accel, gauche/droite → direction, saut → frein à main. */
export function commandesDepuisEntrees(e: { avant: number; droite: number; saut: boolean }): CommandesVehicule {
  return { accel: borne(e.avant || 0), direction: borne(e.droite || 0), frein: !!e.saut };
}

/**
 * Conducteur : sa voiture est dessinée à l'état LOCAL (sans retard) mais les autres occupants viennent des snaps interpolés (110 ms de
 * retard + latence). Sans recalage, à 24 m/s les passagers se décrochent de la caisse de 3 à 4 m. Renvoie `etats` tel quel s'il n'y a
 * aucun autre occupant de cette voiture, sinon une copie où leur position est celle de leur siège sur l'état local de la voiture.
 */
export function recalerOccupants(
  etats: Map<string, EtatJoueurSnap>, moiId: string | null, voiture: number, etat: EtatVehicule,
): Map<string, EtatJoueurSnap> {
  let res: Map<string, EtatJoueurSnap> | null = null;
  for (const [id, e] of etats) {
    if (id === moiId || e.vehicule?.id !== voiture) continue;
    res ??= new Map(etats);
    res.set(id, { ...e, p: positionSiege(etat, e.vehicule.siege) });
  }
  return res ?? etats;
}
