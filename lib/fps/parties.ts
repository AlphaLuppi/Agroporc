/**
 * Registre des parties du serveur (PUR et générique : `S` est une salle quelconque, les tests y mettent de fausses salles ; `serveur-fps/src/index.ts`
 * y met des `Salle`). Une partie = une salle avec SON monde mutable, d'un des trois modes. Ids `ar1`, `ar2`… (arène), `z1`… (zombies), `br1`…
 * (Battle Royale) : un compteur par mode, croissant, jamais réutilisé. Les parties permanentes (`ar1`, `z1`, `br1`) sont créées avec le registre
 * et ne sont jamais refermées ; les autres sont ouvertes à la demande et refermées dès qu'elles n'ont plus aucun membre humain.
 * Contient aussi les trois garde-fous contre un client qui créerait et quitterait des parties en boucle (construire un monde coûte 17 à 90 ms et
 * la première grille de navigation ≈ 430 ms : le tic de toutes les parties gèlerait) : délai entre deux créations d'un client et rafale bornée par IP,
 * parties ouvertes par IP et par mode, disjoncteur sur plusieurs tics lents récents ; plus les réservations de places d'arène (course à 15/16).
 * Spec : docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md (§1.2, lot 1)
 */
import { MODES_SALLE, type ModeSalle } from "./protocole";

/** Préfixe de l'id d'une partie par mode. */
export const PREFIXE_PARTIE: Record<ModeSalle, string> = { arene: "ar", zombies: "z", br: "br" };

export interface Partie<S> { id: string; mode: ModeSalle; salle: S; permanente: boolean }

export interface OptionsRegistre<S> {
  /** une salle neuve (avec son monde) par mode */
  fabriques: Record<ModeSalle, () => S>;
  /** parties en même temps par mode, permanente comprise */
  max: Record<ModeSalle, number>;
  /** parties en même temps toutes salles confondues, permanentes comprises (la réserve d'un emplacement par mode peut le dépasser de 3 au plus) */
  maxTotal: number;
  /** membres HUMAINS d'une salle (lobby, spectateurs et sessions réseau coupées compris) */
  humains: (s: S) => number;
  /** modes dont la première partie est créée avec le registre et jamais refermée */
  permanentes: readonly ModeSalle[];
}

export class RegistreParties<S> {
  private readonly parties: Partie<S>[] = [];
  private readonly compteurs: Record<ModeSalle, number> = { arene: 0, zombies: 0, br: 0 };

  constructor(private readonly o: OptionsRegistre<S>) {
    // dans l'ordre des modes : ar1, z1, br1
    for (const mode of MODES_SALLE) if (o.permanentes.includes(mode)) this.creer(mode, true);
  }

  private creer(mode: ModeSalle, permanente: boolean): Partie<S> {
    const partie: Partie<S> = { id: `${PREFIXE_PARTIE[mode]}${++this.compteurs[mode]}`, mode, salle: this.o.fabriques[mode](), permanente };
    this.parties.push(partie);
    return partie;
  }

  /** Les parties d'un mode (ou toutes), dans l'ordre de création : la permanente en tête. */
  liste(mode?: ModeSalle): readonly Partie<S>[] {
    return mode ? this.parties.filter((p) => p.mode === mode) : this.parties;
  }
  parId(id: string): Partie<S> | null { return this.parties.find((p) => p.id === id) ?? null; }
  /** La partie d'une salle, par identité. */
  deSalle(s: S): Partie<S> | null { return this.parties.find((p) => p.salle === s) ?? null; }
  /** Le nombre de parties vivantes (d'un mode ou toutes). */
  nombre(mode?: ModeSalle): number { return this.liste(mode).length; }

  /**
   * Une partie de plus de ce mode est-elle permise ? Le plafond du mode ET le plafond total, sauf pour la première partie NON permanente de
   * chaque mode (réserve d'un emplacement par mode : quatre parties de Battle Royale ne privent pas les zombies d'une deuxième partie).
   */
  peutOuvrir(mode: ModeSalle): boolean {
    const duMode = this.liste(mode);
    if (duMode.length >= this.o.max[mode]) return false;
    if (this.parties.length < this.o.maxTotal) return true;
    return duMode.every((p) => p.permanente);
  }

  /** Ouvre une partie de plus ; lève si `peutOuvrir(mode)` est faux. */
  ouvrir(mode: ModeSalle): Partie<S> {
    if (!this.peutOuvrir(mode)) throw new Error(`plus de partie possible en mode ${mode}`);
    return this.creer(mode, false);
  }

  /** Retire les parties non permanentes sans aucun membre humain ; renvoie les retirées. */
  refermerVides(): Partie<S>[] {
    const retirees: Partie<S>[] = [];
    for (let i = this.parties.length - 1; i >= 0; i--) {
      const p = this.parties[i];
      if (p.permanente || this.o.humains(p.salle) > 0) continue;
      this.parties.splice(i, 1);
      retirees.unshift(p);
    }
    return retirees;
  }
}

// ---------------------------------------------------------------------------------------------
// Limites de création
// ---------------------------------------------------------------------------------------------

export interface OptionsLimiteCreation {
  /** délai minimal entre deux créations d'un même client (ms) ; c'est aussi la fenêtre de `rafaleIp` */
  delaiMs: number;
  /** parties non permanentes ouvertes en même temps par adresse IP ET par mode (un bureau entier partage une adresse : plusieurs groupes jouent) */
  parIpMax: number;
  /** créations de partie par adresse IP dans une fenêtre de `delaiMs`, connexions différentes comprises (une reconnexion remet l'id du client à zéro) */
  rafaleIp: number;
  /** création refusée si au moins ce nombre de secondes distinctes de la fenêtre récente ont un tic au-dessus du seuil (un pic isolé n'est pas une surcharge) */
  ticsLentsMax: number;
}

export type RefusCreation = "delai" | "ip" | "charge";

/**
 * Qui a créé quoi : un client ne crée pas deux parties en moins de `delaiMs` ; une IP ne crée pas plus de `rafaleIp` parties par fenêtre de `delaiMs`
 * (quelle que soit la connexion : un client qui boucle connexion / création / fermeture n'échappe pas au délai en changeant d'id) et n'a pas plus de
 * `parIpMax` parties ouvertes PAR MODE (une partie créée compte jusqu'à ce qu'elle soit refermée) ; aucune création tant que le serveur peine
 * (`ticsLents`). Rien n'est effacé à la fermeture d'une socket : les dates de création s'éteignent d'elles-mêmes au bout de `delaiMs`.
 */
export class LimiteCreation {
  private readonly derniere = new Map<string, number>();       // id de connexion → dernière création
  private readonly recentes = new Map<string, number[]>();     // ip → dates des créations de la fenêtre
  private readonly ouvertes = new Map<string, { ip: string; mode: ModeSalle }>();   // id de partie → créateur

  constructor(private readonly o: OptionsLimiteCreation) {}

  /**
   * "ok" : la création est permise. "delai" : ce client ou cette adresse a créé il y a moins de `delaiMs` (rafale comprise). "ip" : trop de parties
   * de ce mode ouvertes par cette adresse. "charge" : le serveur peine (`ticsLents` = secondes récentes avec un tic au-dessus du seuil).
   */
  verifier(client: string, ip: string, mode: ModeSalle, maintenant: number, ticsLents: number): "ok" | RefusCreation {
    const avant = this.derniere.get(client);
    if (avant !== undefined && maintenant - avant < this.o.delaiMs) return "delai";
    if (this.datesIp(ip, maintenant).length >= this.o.rafaleIp) return "delai";
    let ouvertes = 0;
    for (const c of this.ouvertes.values()) if (c.ip === ip && c.mode === mode) ouvertes++;
    if (ouvertes >= this.o.parIpMax) return "ip";
    if (ticsLents >= this.o.ticsLentsMax) return "charge";
    return "ok";
  }

  /** Note une création effective (pas la reprise d'une partie vide). */
  noter(partie: string, mode: ModeSalle, client: string, ip: string, maintenant: number): void {
    for (const [c, t] of this.derniere) if (maintenant - t >= this.o.delaiMs) this.derniere.delete(c);
    this.derniere.set(client, maintenant);
    this.recentes.set(ip, [...this.datesIp(ip, maintenant), maintenant]);
    this.ouvertes.set(partie, { ip, mode });
  }

  /** La partie est refermée : l'adresse de son créateur peut en ouvrir une autre (le délai, lui, court toujours). */
  oublierPartie(partie: string): void { this.ouvertes.delete(partie); }

  /** Dates de création de l'adresse dans la fenêtre (les périmées sont retirées). */
  private datesIp(ip: string, maintenant: number): number[] {
    const dates = (this.recentes.get(ip) ?? []).filter((t) => maintenant - t < this.o.delaiMs);
    if (dates.length) this.recentes.set(ip, dates); else this.recentes.delete(ip);
    return dates;
  }
}

/**
 * Plus long tic de chaque seconde des `fenetreMs` dernières millisecondes : le disjoncteur de création compte les SECONDES au-dessus d'un seuil
 * (`secondesAuDessus`), pas le pic le plus haut. Un tic de 0 ms ne se note pas.
 */
export class FenetreMax {
  private readonly seaux = new Map<number, number>();
  constructor(private readonly fenetreMs = 10_000) {}

  noter(valeur: number, maintenant: number): void {
    const s = Math.floor(maintenant / 1000);
    if (valeur > (this.seaux.get(s) ?? 0)) this.seaux.set(s, valeur);
    const limite = Math.floor((maintenant - this.fenetreMs) / 1000);
    for (const k of this.seaux.keys()) if (k < limite) this.seaux.delete(k);
  }

  max(maintenant: number): number {
    const limite = Math.floor((maintenant - this.fenetreMs) / 1000);
    let m = 0;
    for (const [k, v] of this.seaux) if (k >= limite && v > m) m = v;
    return m;
  }

  /** Nombre de secondes de la fenêtre dont le plus long tic dépasse `seuil`. */
  secondesAuDessus(seuil: number, maintenant: number): number {
    const limite = Math.floor((maintenant - this.fenetreMs) / 1000);
    let n = 0;
    for (const [k, v] of this.seaux) if (k >= limite && v > seuil) n++;
    return n;
  }
}

// ---------------------------------------------------------------------------------------------
// Réservations de places d'arène
// ---------------------------------------------------------------------------------------------

/**
 * Places d'arène choisies mais pas encore occupées : un client dirigé vers une arène par `mode{arene, partie:"auto"}` la réserve `dureeMs` (5 s),
 * le temps d'envoyer `rejoindre` ; sans cela, deux clients simultanés prendraient la même seizième place.
 */
export class Reservations {
  private readonly par = new Map<string, { partie: string; fin: number }>();   // client → réservation
  constructor(private readonly dureeMs = 5_000) {}

  reserver(client: string, partie: string, maintenant: number): void { this.par.set(client, { partie, fin: maintenant + this.dureeMs }); }
  liberer(client: string): void { this.par.delete(client); }

  /** Réservations en cours sur une partie (celles d'un client déjà en jeu dans cette partie, ou expirées, sont nettoyées par l'appelant via `liberer`). */
  compter(partie: string, maintenant: number): number {
    let n = 0;
    for (const [client, r] of this.par) {
      if (r.fin <= maintenant) { this.par.delete(client); continue; }
      if (r.partie === partie) n++;
    }
    return n;
  }
}
