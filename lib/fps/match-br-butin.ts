/**
 * Butin du Battle Royale (PUR) : tirage et synchro des objets au sol, ramassage, lâcher, inventaires, soins et usages. Ne voit la salle que
 * par `ContexteSalle`.
 *
 * Le serveur est seul à tirer les objets (`genererButin`) ; la synchro d'un arrivant envoie l'état COURANT complet en un `butin{ajoutes}`
 * (liste initiale moins les objets ramassés plus les objets lâchés : équivalent à « liste initiale + écarts cumulés »). Les objets lâchés
 * (arme échangée, `lacher`, mort) prennent des ids qui continuent ceux du tirage. Les stocks de soins vivent ici (messages privés
 * `inventaire`) ; un usage (bandage 3 s, potion 4 s) s'applique à sa fin et est interrompu par un coup reçu ou un changement d'arme, jamais
 * par la tempête.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (§Butin, §Inventaire)
 */
import { appliquerRamassage, genererButin } from "./br-butin";
import { BR } from "./br-regles";
import { armeDuSlot } from "./equipement";
import type { ButinBr, ContexteSalle, JoueurSalle, Sortie } from "./match-contexte";
import { enLAir } from "./match-br-vol";
import {
  JEU, copierEquipement,
  type ArmeFeuId, type CauseMort, type GenreObjetBr, type MessageClient, type ObjetBr, type PointButin, type Slot, type Vec3,
} from "./protocole";

export interface OptionsButinBr {
  /** distance maximale de ramassage (m, `BR.rayonRamassageM` par défaut) */
  rayonRamassageM?: number;
  /** le joueur est-il à bord ou en chute ? (repli : le marqueur d'invulnérabilité du vol, `enLAir`) */
  enVol?: (j: JoueurSalle) => boolean;
}

type Soin = "bandage" | "potion";

interface Inventaire {
  bandage: number;
  potion: number;
  usage: { objet: Soin; finT: number } | null;
}

/** Rayon (m) autour du joueur où tombent les objets lâchés : toujours à moins de 1,5 m de son corps. */
const DISPERSION_MIN_M = 0.4;
const DISPERSION_M = 1.0;

export function creerButinBr(ctx: ContexteSalle, opts: OptionsButinBr = {}): ButinBr {
  const rayon = opts.rayonRamassageM ?? BR.rayonRamassageM;
  const enVol = opts.enVol ?? enLAir;
  const objets = new Map<number, ObjetBr>();
  let prochainId = 1;
  const inventaires = new Map<string, Inventaire>();
  /** messages produits hors d'un appel qui peut les rendre (`surDegats`) : émis au prochain tic ou appel */
  let enAttente: Sortie[] = [];

  const inv = (id: string): Inventaire => {
    let i = inventaires.get(id);
    if (!i) { i = { bandage: 0, potion: 0, usage: null }; inventaires.set(id, i); }
    return i;
  };

  const messageInventaire = (id: string): Sortie => {
    const i = inv(id);
    return { a: id, m: { t: "inventaire", bandage: i.bandage, potion: i.potion, usage: i.usage ? { objet: i.usage.objet, finT: i.usage.finT } : null } };
  };

  /** Pose un objet aux pieds de `j` (dispersé, à moins de 1,5 m) et le renvoie. */
  function lacherObjet(j: JoueurSalle, genre: GenreObjetBr, ref: ObjetBr["ref"], qte?: number): ObjetBr {
    const angle = ctx.alea() * 2 * Math.PI;
    const d = DISPERSION_MIN_M + ctx.alea() * DISPERSION_M;
    const o: ObjetBr = {
      id: prochainId++, genre, ref, p: [j.p[0] + Math.cos(angle) * d, j.p[1], j.p[2] + Math.sin(angle) * d],
      ...(qte !== undefined ? { qte } : {}),
    };
    objets.set(o.id, o);
    return o;
  }

  const copie = (o: ObjetBr): ObjetBr => ({ ...o, p: [...o.p] as Vec3 });

  /** Interrompt l'usage en cours ; vrai s'il y en avait un. */
  function interrompre(id: string): boolean {
    const i = inventaires.get(id);
    if (!i || !i.usage) return false;
    i.usage = null;
    return true;
  }

  /** `equipement` privé (équipement, main, munitions de la spéciale, réserve ajoutée) après un changement d'inventaire d'armes. */
  function equipement(j: JoueurSalle, main: Slot, t: number, ravitaille?: ArmeFeuId, ajoutMunitions?: { arme: ArmeFeuId; chargeurs: number }): Sortie[] {
    const sorties = ctx.equiper(j, j.equip, main, t, ravitaille);
    return ajoutMunitions
      ? sorties.map((s) => (s.m.t === "equipement" ? { ...s, m: { ...s.m, ajoutMunitions } } : s))
      : sorties;
  }

  function ramasser(j: JoueurSalle, id: number, t: number): Sortie[] {
    const refus = (raison: "inutile" | "loin" | "inconnu"): Sortie[] => [{ a: j.id, m: { t: "ramasse", ok: false, id, raison } }];
    if (!j.vivant || !j.enJeu || enVol(j)) return refus("inconnu");
    const objet = objets.get(id);
    if (!objet) return refus("inconnu");
    if (Math.hypot(objet.p[0] - j.p[0], objet.p[2] - j.p[2]) > rayon || Math.abs(objet.p[1] - j.p[1]) > rayon) return refus("loin");

    const stock = inv(j.id);
    const r = appliquerRamassage(j.equip, stock, objet);
    if (!r.ok || !r.equip) return refus(r.raison ?? "inconnu");

    const sorties: Sortie[] = [];
    // l'objet disparaît ; des soins qui ne tiennent pas en entier laissent le reste sous un nouvel id
    const retires = [id];
    const ajoutes: ObjetBr[] = [];
    objets.delete(id);
    if (r.reste !== undefined && r.reste > 0) ajoutes.push(copie(lacherSurPlace(objet, r.reste)));
    for (const l of r.lache ?? []) ajoutes.push(copie(lacherObjet(j, l.genre, l.ref)));
    sorties.push({ a: "tous", m: { t: "butin", ...(ajoutes.length ? { ajoutes } : {}), retires } });
    sorties.push({ a: j.id, m: { t: "ramasse", ok: true, id } });

    if (r.soins) {
      if (r.soins.bandage !== undefined) stock.bandage = r.soins.bandage;
      if (r.soins.potion !== undefined) stock.potion = r.soins.potion;
      sorties.push(messageInventaire(j.id));
    }

    if (r.ajoutMunitions || r.main || r.munSpeciale !== undefined || r.lache) {
      const main = r.main ?? j.main;
      if (r.main && r.main !== j.main) {
        if (r.main === "speciale") ctx.memoriserPrecedent(j);
        if (interrompre(j.id)) sorties.push(messageInventaire(j.id));
      }
      j.equip = copierEquipement(r.equip);
      if (r.munSpeciale !== undefined) j.munSpeciale = r.munSpeciale;
      // une arme neuve (principale ou secondaire) arrive chargeur plein et réserve de départ : le client la ravitaille
      const ravitaille = (r.main === "principale" || r.main === "secondaire") && !r.ajoutMunitions
        ? (armeDuSlot(j.equip, r.main) as ArmeFeuId | null) ?? undefined : undefined;
      sorties.push(...equipement(j, main, t, ravitaille, r.ajoutMunitions));
    }
    return sorties;
  }

  /** Un reste de soins reposé là où était l'objet, sous un nouvel id. */
  function lacherSurPlace(objet: ObjetBr, qte: number): ObjetBr {
    const o: ObjetBr = { id: prochainId++, genre: objet.genre, ref: objet.ref, p: [...objet.p] as Vec3, qte };
    objets.set(o.id, o);
    return o;
  }

  function lacher(j: JoueurSalle, slot: "principale" | "secondaire" | "speciale", t: number): Sortie[] {
    if (!j.vivant || !j.enJeu || enVol(j)) return [];
    const arme = armeDuSlot(j.equip, slot);
    if (arme === null || arme === "couteau") return [];
    const equip = copierEquipement(j.equip);
    if (slot === "principale") equip.sansPrincipale = true;
    else if (slot === "secondaire") equip.sansSecondaire = true;
    else equip.speciale = null;
    const objet = lacherObjet(j, "arme", arme as ArmeFeuId);
    const sorties: Sortie[] = [{ a: "tous", m: { t: "butin", ajoutes: [copie(objet)] } }];
    const main: Slot = j.main === slot ? "couteau" : j.main;
    if (main !== j.main && interrompre(j.id)) sorties.push(messageInventaire(j.id));
    j.equip = equip;
    if (slot === "speciale") j.munSpeciale = 0;
    sorties.push(...equipement(j, main, t));
    return sorties;
  }

  function utiliser(j: JoueurSalle, objet: Soin | null, t: number): Sortie[] {
    if (objet === null) return interrompre(j.id) ? [messageInventaire(j.id)] : [];
    if (!j.vivant || !j.enJeu || enVol(j)) return [];
    const i = inv(j.id);
    if (i.usage) return []; // un seul usage à la fois
    if (i[objet] <= 0) return [];
    // inutile si le soin n'apporterait rien
    if (objet === "bandage" ? j.pv >= BR.usage.bandage.plafondPv : j.bouclier >= JEU.bouclierMax) return [];
    i.usage = { objet, finT: t + BR.usage[objet].ms };
    return [messageInventaire(j.id)];
  }

  /** Fin d'un usage : le soin s'applique, la pile diminue (rien si les PV ou le bouclier ont dépassé le plafond entre-temps). */
  function terminerUsage(j: JoueurSalle): Sortie[] {
    const i = inv(j.id);
    const u = i.usage;
    i.usage = null;
    if (!u) return [];
    let gain = 0;
    if (u.objet === "bandage") {
      const apres = Math.max(j.pv, Math.min(BR.usage.bandage.plafondPv, j.pv + BR.usage.bandage.pv));
      gain = apres - j.pv;
      j.pv = apres;
    } else {
      const apres = Math.max(j.bouclier, Math.min(JEU.bouclierMax, j.bouclier + BR.usage.potion.bouclier));
      gain = apres - j.bouclier;
      j.bouclier = apres;
    }
    if (gain <= 0) return [messageInventaire(j.id)];
    i[u.objet] = Math.max(0, i[u.objet] - 1);
    j.regenAcc = 0;
    return [messageInventaire(j.id), { a: j.id, m: { t: "soin", pv: j.pv, bouclier: j.bouclier, motif: u.objet } }];
  }

  return {
    initialiser(points: readonly PointButin[], graine: number, nb: number): void {
      objets.clear();
      inventaires.clear();
      enAttente = [];
      for (const o of genererButin(points, graine, nb)) objets.set(o.id, o);
      prochainId = Math.max(0, ...objets.keys()) + 1;
    },

    recevoir(j: JoueurSalle, m: MessageClient, t: number): Sortie[] {
      const avant = enAttente;
      enAttente = [];
      switch (m.t) {
        case "ramasser": return [...avant, ...ramasser(j, m.id, t)];
        case "lacher": return [...avant, ...lacher(j, m.slot, t)];
        case "utiliser": return [...avant, ...utiliser(j, m.objet, t)];
        default: return avant;
      }
    },

    tic(t: number): Sortie[] {
      const sorties = enAttente;
      enAttente = [];
      for (const [id, i] of inventaires) {
        if (!i.usage || t < i.usage.finT) continue;
        const j = ctx.joueur(id);
        if (!j || !j.vivant || !j.enJeu) { i.usage = null; continue; }
        sorties.push(...terminerUsage(j));
      }
      return sorties;
    },

    surDegats(j: JoueurSalle, cause: CauseMort, _t: number): void {
      // la tempête n'interrompt rien (sinon un soin ne s'achèverait jamais hors zone)
      if (cause === "tempete") return;
      if (interrompre(j.id)) enAttente.push(messageInventaire(j.id));
    },

    lacherALaMort(j: JoueurSalle, _t: number): Sortie[] {
      const ajoutes: ObjetBr[] = [];
      const e = j.equip;
      if (!e.sansPrincipale) ajoutes.push(copie(lacherObjet(j, "arme", e.principale)));
      if (!e.sansSecondaire) ajoutes.push(copie(lacherObjet(j, "arme", e.secondaire)));
      if (e.speciale !== null) ajoutes.push(copie(lacherObjet(j, "arme", e.speciale)));
      if (e.melee === "epee") ajoutes.push(copie(lacherObjet(j, "arme", "epee")));
      const i = inv(j.id);
      if (i.bandage > 0) ajoutes.push(copie(lacherObjet(j, "bandage", null, i.bandage)));
      if (i.potion > 0) ajoutes.push(copie(lacherObjet(j, "potion", null, i.potion)));
      i.bandage = 0;
      i.potion = 0;
      i.usage = null;
      const sorties: Sortie[] = [messageInventaire(j.id)];
      if (ajoutes.length > 0) sorties.unshift({ a: "tous", m: { t: "butin", ajoutes } });
      return sorties;
    },

    synchro(idDest: string): Sortie[] {
      return [
        { a: idDest, m: { t: "butin", ajoutes: [...objets.values()].map(copie) } },
        messageInventaire(idDest),
      ];
    },

    reinitialiser(): void {
      objets.clear();
      inventaires.clear();
      enAttente = [];
      prochainId = 1;
    },
  };
}
