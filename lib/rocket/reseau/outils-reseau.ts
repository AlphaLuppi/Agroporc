/**
 * Rocket Muche en ligne : outils de SIMULATION RÉSEAU pour les tests (jamais importés par le jeu ni par le serveur). PUR et déterministe par graine :
 * aucune horloge globale, aucun `Math.random`, le temps est un argument.
 *
 * Le lien simule une connexion TCP (la WebSocket) :
 *  - latence + gigue (loi uniforme) par paquet ;
 *  - perte : un paquet perdu n'est pas supprimé, il est RETRANSMIS après un délai de retransmission (`rtoMs`), éventuellement plusieurs fois ;
 *  - blocage en tête de file : l'ordre est conservé, un paquet retardé retient tous les suivants, qui sont livrés d'un coup (rafale) ;
 *  - `retenir(ms)` : rien n'est livré pendant `ms` (rafale de retard, coupure Wi-Fi), tout arrive ensuite d'un coup.
 * Aucun réordonnancement (TCP n'en produit pas).
 */

/** Générateur pseudo-aléatoire mulberry32 (déterministe, 32 bits). */
export function creerAlea(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OptionsLien {
  /** latence moyenne d'un sens (ms) */
  latenceMs: number;
  /** gigue : chaque paquet reçoit une latence uniforme dans [latence − gigue, latence + gigue] (ms) */
  gigueMs: number;
  /** probabilité qu'une transmission soit perdue (0 à 1) ; le paquet est alors retransmis après `rtoMs` */
  perte: number;
  /** délai de retransmission après une perte (ms) ; défaut : max(200, 3 × latence) */
  rtoMs?: number;
  graine: number;
}

export interface LienSimule<T> {
  /** émet une charge à l'instant `maintenantMs` */
  envoyer(charge: T, maintenantMs: number): void;
  /** charges arrivées au plus tard à `maintenantMs`, dans l'ordre d'émission (vide pendant un blocage) */
  livrer(maintenantMs: number): T[];
  /** bloque toute livraison jusqu'à `maintenantMs + dureeMs` : tout ce qui arrive entre-temps est livré d'un coup ensuite */
  retenir(dureeMs: number, maintenantMs: number): void;
  /** change les paramètres du lien (les paquets déjà en vol gardent leur échéance) */
  reconfigurer(p: Partial<Pick<OptionsLien, "latenceMs" | "gigueMs" | "perte" | "rtoMs">>): void;
  /** paquets en vol */
  enVol(): number;
  /** nombre de retransmissions simulées depuis le début */
  retransmissions(): number;
}

export function creerLien<T>(options: OptionsLien): LienSimule<T> {
  const o = { ...options };
  const alea = creerAlea(options.graine);
  const file: { arrivee: number; charge: T }[] = [];
  let derniereArrivee = -Infinity;
  let bloqueJusqua = -Infinity;
  let retrans = 0;

  return {
    envoyer(charge: T, maintenantMs: number): void {
      const rto = o.rtoMs ?? Math.max(200, 3 * o.latenceMs);
      let delai = o.latenceMs + (alea() * 2 - 1) * o.gigueMs;
      // Une transmission perdue est renvoyée après le délai de retransmission (au plus 5 fois : la probabilité suffit à le borner en pratique).
      for (let essai = 0; essai < 5 && o.perte > 0 && alea() < o.perte; essai++) {
        delai += rto;
        retrans++;
      }
      // Blocage en tête de file : jamais livré avant le paquet précédent.
      const arrivee = Math.max(maintenantMs + Math.max(0, delai), derniereArrivee);
      derniereArrivee = arrivee;
      file.push({ arrivee, charge });
    },

    livrer(maintenantMs: number): T[] {
      if (maintenantMs < bloqueJusqua) return [];
      const sortie: T[] = [];
      while (file.length > 0 && file[0].arrivee <= maintenantMs) sortie.push((file.shift() as { charge: T }).charge);
      return sortie;
    },

    retenir(dureeMs: number, maintenantMs: number): void {
      bloqueJusqua = Math.max(bloqueJusqua, maintenantMs + dureeMs);
    },

    reconfigurer(p): void {
      Object.assign(o, p);
    },

    enVol: () => file.length,
    retransmissions: () => retrans,
  };
}

/** Une liaison client <-> serveur : deux liens indépendants (montant et descendant), chacun avec ses réglages et sa graine. */
export interface LiaisonSimulee<Montant, Descendant> {
  montant: LienSimule<Montant>;
  descendant: LienSimule<Descendant>;
  /** applique les mêmes réglages aux deux sens */
  configurer(p: Partial<Pick<OptionsLien, "latenceMs" | "gigueMs" | "perte" | "rtoMs">>): void;
  /** bloque les deux sens pendant `dureeMs` */
  retenirTout(dureeMs: number, maintenantMs: number): void;
}

export function creerLiaison<Montant, Descendant>(options: OptionsLien): LiaisonSimulee<Montant, Descendant> {
  const montant = creerLien<Montant>({ ...options, graine: options.graine * 2 + 1 });
  const descendant = creerLien<Descendant>({ ...options, graine: options.graine * 2 + 2 });
  return {
    montant,
    descendant,
    configurer(p) { montant.reconfigurer(p); descendant.reconfigurer(p); },
    retenirTout(dureeMs, maintenantMs) { montant.retenir(dureeMs, maintenantMs); descendant.retenir(dureeMs, maintenantMs); },
  };
}

/** Entrées d'un joueur qui change de consigne toutes les 0,15 à 0,8 s par défaut (déterministe par graine) : de quoi faire dévier les prédictions. */
export interface PiloteSimule {
  /** entrées brutes (réels) au temps de jeu `tempsS` */
  entrees(tempsS: number): { accel: number; direction: number; tangage: number; lacet: number; roulis: number; saut: boolean; boost: boolean; derapage: boolean };
}

export function creerPilote(graine: number, options: { changeMinS?: number; changeMaxS?: number } = {}): PiloteSimule {
  const alea = creerAlea(graine);
  const mini = options.changeMinS ?? 0.15, maxi = options.changeMaxS ?? 0.8;
  let jusqua = -1;
  let courant = { accel: 1, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false };
  return {
    entrees(tempsS: number) {
      if (tempsS >= jusqua) {
        jusqua = tempsS + mini + alea() * (maxi - mini);
        const r = alea();
        courant = {
          accel: r < 0.15 ? -1 : r < 0.25 ? 0 : 1,
          direction: Math.round((alea() * 2 - 1) * 4) / 4,
          tangage: alea() < 0.3 ? Math.round((alea() * 2 - 1) * 2) / 2 : 0,
          lacet: 0,
          roulis: 0,
          saut: alea() < 0.12,
          boost: alea() < 0.4,
          derapage: alea() < 0.1,
        };
      }
      return courant;
    },
  };
}
