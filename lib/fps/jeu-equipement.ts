/**
 * Contrôleur des armes côté client (PUR) : slot actif, changement d'arme (dégainage 350 ms, recharge annulée), molette, dernière arme,
 * couteau rapide, munitions par arme (gardées au changement), rechargement. L'état serveur (`apparition` / `equipement`) fait foi.
 * Les instants `t` sont en millisecondes (horloge du jeu), comme `JEU.degainageMs`.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.4, §5.13)
 */
import { JEU, copierEquipement, estMelee, type ArmeFeuId, type ArmeId, type Equipement, type MessageServeur, type Slot } from "./protocole";
import { STATS } from "./armes";
import { armeDuSlot, estArmeFeu, estSlot, meleeDe, slotVoisin, type LigneSlot } from "./equipement";

/** Slot en main quand l'appelant n'en donne pas : on entre dans l'arène avec la principale (v2 : `mainSuivante` = principale). */
const MAIN_INITIALE: Slot = "principale";
/** Slots de repli, dans l'ordre : le premier qui porte une arme (la principale peut manquer, zombies v5). */
const SLOTS_REPLI: readonly Slot[] = ["principale", "secondaire", "couteau"];

/** Options du contrôleur : `reserveChargeurs` = chargeurs de réserve par arme (zombies, v5) ; absent = réserve infinie (arène). */
export interface OptionsArmes { reserveChargeurs?: number }

export class ControleurArmes {
  private equip: Equipement;
  private main: Slot;
  /** slot tenu avant celui-ci (pour `rapide` et le repli d'une spéciale épuisée) */
  private precedent: Slot;
  /** chargeur courant par arme à feu portée */
  private mun: Partial<Record<ArmeFeuId, number>> = {};
  /** réserve (balles) par arme à feu portée, seulement si la réserve est limitée (zombies) ; les spéciales n'en ont pas */
  private reserve: Partial<Record<ArmeFeuId, number>> = {};
  /** chargeurs de réserve par arme, null = réserve infinie (arène) */
  private readonly reserveChargeurs: number | null;
  /** pas de tir ni de recharge avant cet instant */
  private sortieFin = 0;
  private sortieDebut = 0;
  /** recharge en cours : début et fin (0 = aucune) */
  private rechargeDebut = 0;
  private rechargeFin = 0;
  /** dernier instant vu (pour les actions sans `t`, comme `tirEffectue`) */
  private dernierT = 0;

  constructor(equip: Equipement, main: Slot = MAIN_INITIALE, opts: OptionsArmes = {}) {
    this.reserveChargeurs = opts.reserveChargeurs !== undefined && opts.reserveChargeurs >= 0 ? Math.floor(opts.reserveChargeurs) : null;
    this.equip = copierEquipement(equip);
    this.main = this.slotUtilisable(main) ? main : this.slotRepli();
    this.precedent = this.autrePrincipale(this.main);
    this.remplirTout();
  }

  // ---------- lecture ----------

  equipement(): Equipement { return copierEquipement(this.equip); }

  slotActif(): Slot { return this.main; }

  armeEnMain(): ArmeId { return armeDuSlot(this.equip, this.main) ?? meleeDe(this.equip); }

  /** Slot tenu avant l'actuel (celui que `rapide` rejoint). */
  slotPrecedent(): Slot { return this.precedent; }

  /** Munitions du chargeur de l'arme en main (`Infinity` pour le couteau : le HUD affiche 0). */
  munitions(): number {
    const a = this.armeEnMain();
    return estMelee(a) ? Infinity : (this.mun[a] ?? 0);
  }

  /** Taille du chargeur de l'arme en main (0 pour le couteau ; pour une spéciale, les munitions totales offertes). */
  chargeur(): number {
    const a = this.armeEnMain();
    return estMelee(a) ? 0 : STATS[a].chargeur;
  }

  munitionsDe(arme: ArmeFeuId): number { return this.mun[arme] ?? 0; }

  /** La réserve est limitée (zombies) : une recharge puise dedans. */
  reserveLimitee(): boolean { return this.reserveChargeurs !== null; }

  /** Réserve (balles) d'une arme à feu : −1 si elle est infinie (arène, ou arme sans réserve comme le couteau). */
  reserveDe(arme: ArmeFeuId): number {
    return this.reserveChargeurs === null ? -1 : (this.reserve[arme] ?? 0);
  }

  /** Réserve de l'arme en main (−1 : infinie, ou arme blanche). */
  reserveEnMain(): number {
    const a = this.armeEnMain();
    return estMelee(a) ? -1 : this.reserveDe(a);
  }

  /** Une ligne par slot, dans l'ordre principale, secondaire, couteau, spéciale (seulement si portée). */
  lignes(): LigneSlot[] {
    const res: LigneSlot[] = [];
    for (const slot of ["principale", "secondaire", "couteau", "speciale"] as const) {
      const arme = armeDuSlot(this.equip, slot);
      if (arme === null) continue;
      if (estMelee(arme)) res.push({ slot, arme, munitions: 0, chargeur: 0 });
      else res.push({ slot, arme, munitions: this.mun[arme] ?? 0, chargeur: STATS[arme].chargeur });
    }
    return res;
  }

  // ---------- changement d'arme ----------

  /** Change de slot (refus si vide ou identique) : annule la recharge, `sortieFin = t + degainageMs`, mémorise le précédent. */
  equiper(slot: Slot, t: number): boolean {
    this.dernierT = t;
    if (!estSlot(slot) || slot === this.main || !this.slotUtilisable(slot)) return false;
    this.precedent = this.main;
    this.main = slot;
    this.annulerRecharge();
    this.debuterSortie(t);
    return true;
  }

  /** Slot suivant / précédent portant une arme (saute la spéciale vide), cyclique. */
  molette(sens: 1 | -1, t: number): boolean {
    return this.equiper(slotVoisin(this.equip, this.main, sens), t);
  }

  /** Dernier slot utilisé (aller-retour entre deux armes). */
  rapide(t: number): boolean {
    return this.equiper(this.precedentUtilisable(), t);
  }

  /** Couteau, ou retour à l'arme tenue avant lui si on l'a déjà en main. */
  couteauRapide(t: number): boolean {
    return this.main === "couteau" ? this.rapide(t) : this.equiper("couteau", t);
  }

  // ---------- tir ----------

  /** Sortie terminée, arme à feu en main, munitions > 0, pas en recharge. Le couteau a son propre message (`coup`). */
  peutTirer(t: number): boolean {
    this.dernierT = t;
    const a = this.armeEnMain();
    return !estMelee(a) && t >= this.sortieFin && (this.mun[a] ?? 0) > 0 && !this.rechargeEnCours();
  }

  /**
   * −1 munition. Une spéciale vide est retirée de l'équipement et le joueur retombe sur le slot précédent (nouveau dégainage,
   * daté du dernier instant vu : `peutTirer` précède toujours un tir).
   */
  tirEffectue(): void {
    const a = this.armeEnMain();
    if (estMelee(a)) return;
    const reste = Math.max(0, (this.mun[a] ?? 0) - 1);
    if (this.main === "speciale" && reste === 0) {
      this.retirerSpeciale(this.dernierT);
      return;
    }
    this.mun[a] = reste;
  }

  // ---------- recharge ----------

  /** Refus : couteau, spéciale, chargeur plein, déjà en cours, sortie de l'arme pas terminée. */
  demarrerRecharge(t: number): boolean {
    this.dernierT = t;
    const a = this.armeEnMain();
    if (estMelee(a) || STATS[a].sansRecharge) return false;
    if (this.rechargeEnCours() || t < this.sortieFin) return false;
    if ((this.mun[a] ?? 0) >= STATS[a].chargeur) return false;
    if (this.reserveChargeurs !== null && (this.reserve[a] ?? 0) <= 0) return false;
    this.rechargeDebut = t;
    this.rechargeFin = t + STATS[a].rechargeS * 1000;
    return true;
  }

  rechargeEnCours(): boolean { return this.rechargeFin > 0; }

  /** Vrai quand la recharge se termine (le chargeur est alors plein). */
  majRecharge(t: number): boolean {
    this.dernierT = t;
    if (!this.rechargeEnCours() || t < this.rechargeFin) return false;
    const a = this.armeEnMain();
    if (!estMelee(a)) {
      const manque = STATS[a].chargeur - (this.mun[a] ?? 0);
      if (this.reserveChargeurs === null) this.mun[a] = STATS[a].chargeur;
      else {
        // réserve limitée : on ne recharge que ce que la réserve contient
        const pris = Math.max(0, Math.min(manque, this.reserve[a] ?? 0));
        this.mun[a] = (this.mun[a] ?? 0) + pris;
        this.reserve[a] = (this.reserve[a] ?? 0) - pris;
      }
    }
    this.annulerRecharge();
    return true;
  }

  /** 0..1, 0 = aucune recharge en cours. */
  rechargeProgression(t: number): number {
    if (!this.rechargeEnCours()) return 0;
    const duree = this.rechargeFin - this.rechargeDebut;
    return duree <= 0 ? 1 : Math.min(1, Math.max(0, (t - this.rechargeDebut) / duree));
  }

  // ---------- dégainage ----------

  /** Dégainage en cours (aucun tir ni recharge possible). */
  degainage(t: number): boolean { return t < this.sortieFin; }

  /** 0..1 : remplissage de la ligne du slot pendant le dégainage, 1 une fois l'arme prête. */
  degainageProgression(t: number): number {
    const duree = this.sortieFin - this.sortieDebut;
    return duree <= 0 ? 1 : Math.min(1, Math.max(0, (t - this.sortieDebut) / duree));
  }

  // ---------- serveur ----------

  /**
   * `apparition` (équipement complet, chargeurs pleins, recharge et dégainage effacés) ou `equipement` (spéciale ramassée ou
   * épuisée : les chargeurs des armes déjà portées sont gardés, la recharge continue si l'arme en main n'a pas changé).
   */
  appliquerServeur(m: Extract<MessageServeur, { t: "apparition" | "equipement" }>, t: number): void {
    this.dernierT = t;
    const apparition = m.t === "apparition";
    const ancien = this.main;
    this.equip = copierEquipement(m.equip);
    this.main = estSlot(m.main) && this.slotUtilisable(m.main) ? m.main : this.slotRepli();
    if (apparition) {
      this.mun = {};
      this.reserve = {};
      this.annulerRecharge();
      this.sortieFin = 0;
      this.sortieDebut = 0;
      this.precedent = this.autrePrincipale(this.main);
    } else if (this.main !== ancien) {
      this.precedent = ancien;
      this.annulerRecharge();
      this.debuterSortie(t);
    }
    // chargeurs : pleins pour toute arme nouvellement portée, gardés sinon ; les armes quittées sont oubliées
    const portees = new Set<ArmeFeuId>();
    for (const slot of ["principale", "secondaire", "speciale"] as const) {
      const a = armeDuSlot(this.equip, slot);
      if (a !== null && estArmeFeu(a)) portees.add(a);
    }
    for (const a of Object.keys(this.mun) as ArmeFeuId[]) if (!portees.has(a)) delete this.mun[a];
    for (const a of Object.keys(this.reserve) as ArmeFeuId[]) if (!portees.has(a)) delete this.reserve[a];
    for (const a of portees) {
      if (this.mun[a] === undefined) { this.mun[a] = STATS[a].chargeur; this.reserve[a] = this.reservePleine(a); }
    }
    // ravitaillement acheté (zombies) : chargeur ET réserve de l'arme sont remplis
    if (m.t === "equipement" && m.ravitaille !== undefined && portees.has(m.ravitaille)) {
      this.mun[m.ravitaille] = STATS[m.ravitaille].chargeur;
      this.reserve[m.ravitaille] = this.reservePleine(m.ravitaille);
    }
    if (this.equip.speciale !== null) this.mun[this.equip.speciale] = Math.max(0, Math.floor(m.munSpeciale));
    // une recharge qui n'est plus celle de l'arme en main n'a plus de sens
    const a = this.armeEnMain();
    if (this.rechargeEnCours() && (estMelee(a) || STATS[a].sansRecharge)) this.annulerRecharge();
  }

  // ---------- interne ----------

  /** Le slot porte une arme (le couteau toujours, la spéciale seulement si portée). */
  private slotUtilisable(slot: Slot): boolean {
    return armeDuSlot(this.equip, slot) !== null;
  }

  /** Le slot de repli le plus naturel : la principale (`MAIN_INITIALE`), sinon le premier slot utilisable. */
  private slotRepli(): Slot {
    return SLOTS_REPLI.find((s) => this.slotUtilisable(s)) ?? MAIN_INITIALE;
  }

  /** Le slot « autre » le plus naturel : la principale, ou la secondaire si c'est la principale qui est en main (premier slot utilisable différent de `main`). */
  private autrePrincipale(main: Slot): Slot {
    const nominal: Slot = main === "principale" ? "secondaire" : "principale";
    if (this.slotUtilisable(nominal)) return nominal;
    return SLOTS_REPLI.find((s) => s !== main && this.slotUtilisable(s)) ?? nominal;
  }

  private precedentUtilisable(): Slot {
    if (this.precedent !== this.main && this.slotUtilisable(this.precedent)) return this.precedent;
    return this.autrePrincipale(this.main);
  }

  private remplirTout(): void {
    this.mun = {};
    this.reserve = {};
    for (const slot of ["principale", "secondaire", "speciale"] as const) {
      const a = armeDuSlot(this.equip, slot);
      if (a !== null && estArmeFeu(a)) { this.mun[a] = STATS[a].chargeur; this.reserve[a] = this.reservePleine(a); }
    }
  }

  /** Réserve initiale d'une arme (balles) : `reserveChargeurs` chargeurs, rien pour une spéciale (sans recharge). */
  private reservePleine(a: ArmeFeuId): number {
    if (this.reserveChargeurs === null || STATS[a].sansRecharge) return 0;
    return this.reserveChargeurs * STATS[a].chargeur;
  }

  private debuterSortie(t: number): void {
    this.sortieDebut = t;
    this.sortieFin = t + JEU.degainageMs;
  }

  private annulerRecharge(): void {
    this.rechargeDebut = 0;
    this.rechargeFin = 0;
  }

  private retirerSpeciale(t: number): void {
    const a = this.equip.speciale;
    if (a !== null) delete this.mun[a];
    this.equip.speciale = null;
    this.main = this.precedent !== "speciale" && this.slotUtilisable(this.precedent) ? this.precedent : this.slotRepli();
    this.precedent = this.autrePrincipale(this.main);
    this.annulerRecharge();
    this.debuterSortie(t);
  }
}

