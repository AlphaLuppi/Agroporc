/**
 * Vol du Battle Royale (PUR) : avion, saut, éjection forcée, chute simulée en temps réel à partir des dernières entrées du client,
 * atterrissage et invulnérabilité. Ne voit la salle que par `ContexteSalle`.
 *
 * Le serveur est seul maître de la chute : à chaque tic il avance de `pasDuTemps(dt)` pas fixes (au plus 6) chaque joueur en vol avec les
 * DERNIÈRES entrées reçues (`chute{lacet, tangage, avance, lateral, ouvrir}`), sans numéro de séquence ni budget : un client ne peut pas
 * simuler plus vite que le temps réel. Sans message, les dernières entrées continuent de servir et l'ouverture automatique sous 90 m
 * s'applique : un joueur absent atterrit quand même. Un joueur invulnérable (`protegeJusqua = Infinity`) de son placement dans l'avion
 * jusqu'à l'atterrissage, puis `protectionAtterrissageMs` ; ce marqueur Infinity sert aussi au butin (`match-br-butin.ts`) pour savoir
 * qu'un joueur est encore en l'air.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (§Avion, §Chute libre et parachute)
 */
import {
  capAvionBr, etatChuteInitial, pasChute, pasDuTemps, positionAvionBr, tracerVolBr, vitesseAvionBr, AVION_BR, CHUTE_BR,
  type EntreesChute, type EtatChute,
} from "./br-chute";
import type { Boite } from "./collision";
import type { ContexteSalle, JoueurSalle, Sortie, VolBr } from "./match-contexte";
import { BR, EQUIPEMENT_DEPART_BR, MAIN_DEPART_BR } from "./br-regles";
import { JEU, copierEquipement, type AvionBr, type MessageClient, type Vec3 } from "./protocole";

export interface OptionsVolBr {
  /** invulnérabilité après l'atterrissage (ms, `BR.protectionAtterrissageMs` par défaut) */
  protectionAtterrissageMs?: number;
}

/** Un joueur en chute : état simulé, dernières entrées reçues, temps déjà simulé. */
interface Chute {
  etat: EtatChute;
  entrees: EntreesChute;
  /** instant du saut (ms serveur) : une ouverture demandée avant `delaiOuvertureMinMs` est ignorée */
  saut: number;
  /** dernier tic simulé (ms) et fraction de pas restante (ms) */
  tPrec: number;
  reste: number;
}

const PI_2 = Math.PI / 2;
const borne = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const fini = (x: unknown, repli = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : repli);

export function creerVolBr(ctx: ContexteSalle, opts: OptionsVolBr = {}): VolBr {
  const protectionMs = opts.protectionAtterrissageMs ?? BR.protectionAtterrissageMs;
  let avion: AvionBr | null = null;
  /** dans l'avion (ordre d'arrivée) */
  const bord = new Set<string>();
  const chutes = new Map<string, Chute>();
  /** joueurs qui ont touché le sol depuis le départ de l'avion (un joueur parti ensuite reste compté) */
  const atterris = new Set<string>();
  /** messages produits hors d'un appel qui peut les rendre (`demarrer`) : émis au prochain tic */
  let enAttente: Sortie[] = [];

  /** Position, vitesse et lacet d'un joueur à bord à l'instant `t` (avant le départ de l'avion : immobile, à son point de départ). */
  const etatAvion = (t: number): { p: Vec3; v: Vec3; lacet: number } =>
    avion
      ? { p: positionAvionBr(avion, t), v: t >= avion.debutT ? vitesseAvionBr(avion) : [0, 0, 0], lacet: capAvionBr(avion) }
      : { p: [0, AVION_BR.altitude, 0], v: [0, 0, 0], lacet: 0 };

  /** Monte le joueur : équipement de départ (couteau seul), invulnérable, à la position de l'avion. */
  function monter(j: JoueurSalle, t: number): Sortie[] {
    const a = etatAvion(t);
    const sorties = ctx.placerJoueur(
      j, a.p, a.lacet, { pv: JEU.pvMax, equip: copierEquipement(EQUIPEMENT_DEPART_BR), main: MAIN_DEPART_BR, prive: true }, t,
    );
    j.v = [...a.v];
    j.posture = "air";
    j.protegeJusqua = Infinity;
    j.etatT = t;
    bord.add(j.id);
    return sorties;
  }

  /** Le joueur quitte l'avion au point courant, à la vitesse de l'avion. */
  function quitter(j: JoueurSalle, t: number): Sortie[] {
    const a = etatAvion(t);
    bord.delete(j.id);
    const etat = etatChuteInitial(a.p, a.v);
    chutes.set(j.id, {
      etat, saut: t, tPrec: t, reste: 0,
      entrees: { lacet: a.lacet, tangage: 0, avance: 0, lateral: 0, ouvrir: false },
    });
    j.p = [...etat.p];
    j.v = [...etat.v];
    j.lacet = a.lacet;
    j.tangage = 0;
    j.posture = "air";
    j.protegeJusqua = Infinity;
    j.etatT = t;
    return [{ a: j.id, m: { t: "saut", p: [...etat.p], v: [...etat.v], lacet: a.lacet } }];
  }

  /** Recopie l'état simulé dans le joueur de la salle (positions pour les tirs, le snap et l'anti-inactivité). */
  function recopier(j: JoueurSalle, c: Chute, t: number): void {
    j.p = [...c.etat.p];
    j.v = [...c.etat.v];
    j.lacet = c.entrees.lacet;
    j.tangage = c.entrees.tangage;
    j.posture = "air";
    j.protegeJusqua = Infinity;
    j.etatT = t;
  }

  return {
    demarrer(liste: JoueurSalle[], bornes: Boite, alea: () => number, debutT: number, o: { dureeMs?: number; altitude?: number }): AvionBr {
      chutes.clear();
      atterris.clear();
      avion = tracerVolBr(bornes, alea, debutT, o);
      for (const j of liste) {
        if (!bord.has(j.id)) enAttente.push(...monter(j, debutT));
      }
      // ceux qui attendaient dans l'avion (avant le tracé) rejoignent son point de départ
      for (const id of bord) {
        const j = ctx.joueur(id);
        if (j) { const a = etatAvion(debutT); j.p = [...a.p]; j.v = [...a.v]; j.lacet = a.lacet; j.etatT = debutT; }
      }
      return avion;
    },

    entrer(j: JoueurSalle, t: number): Sortie[] {
      if (bord.has(j.id) || chutes.has(j.id)) return [];
      return monter(j, t);
    },

    sauter(j: JoueurSalle, t: number): Sortie[] {
      // seulement en vol : ni pendant le décompte (avion immobile), ni sans être à bord
      if (!avion || t < avion.debutT || !bord.has(j.id)) return [];
      return quitter(j, t);
    },

    recevoirChute(j: JoueurSalle, m: Extract<MessageClient, { t: "chute" }>, t: number): void {
      const c = chutes.get(j.id);
      if (!c) return;
      // l'ouverture est collante (idempotente, un message perdu ne la retarde pas) mais refusée avant `delaiOuvertureMinMs`
      const ouvrir = m.ouvrir === true && t - c.saut >= CHUTE_BR.delaiOuvertureMinMs;
      c.entrees = {
        lacet: fini(m.lacet, c.entrees.lacet),
        tangage: borne(fini(m.tangage, c.entrees.tangage), -PI_2, PI_2),
        avance: borne(fini(m.avance), -1, 1),
        lateral: borne(fini(m.lateral), -1, 1),
        ouvrir: c.entrees.ouvrir || ouvrir,
      };
    },

    tic(t: number): Sortie[] {
      const sorties: Sortie[] = enAttente;
      enAttente = [];
      if (!avion) return sorties;

      // à bord : suivent l'avion ; à `finT`, éjection forcée
      for (const id of [...bord]) {
        const j = ctx.joueur(id);
        if (!j || !j.vivant) { bord.delete(id); continue; }
        if (t >= avion.finT) { sorties.push(...quitter(j, avion.finT)); continue; }
        const a = etatAvion(t);
        j.p = [...a.p];
        j.v = [...a.v];
        j.lacet = a.lacet;
        j.protegeJusqua = Infinity;
        j.etatT = t;
      }

      // en chute : le serveur avance en temps réel avec les dernières entrées
      for (const [id, c] of [...chutes]) {
        const j = ctx.joueur(id);
        if (!j || !j.vivant || !j.enJeu) { chutes.delete(id); continue; }
        const { pas, reste } = pasDuTemps(t - c.tPrec, c.reste);
        c.tPrec = t;
        c.reste = reste;
        for (let k = 0; k < pas && !c.etat.atterri; k++) c.etat = pasChute(c.etat, c.entrees, ctx.monde);
        if (c.etat.atterri) {
          chutes.delete(id);
          atterris.add(id);
          j.p = [...c.etat.p];
          j.v = [0, 0, 0];
          j.lacet = c.entrees.lacet;
          j.tangage = 0;
          j.posture = "sol";
          j.seq = -1;
          j.histo = [{ t, p: [...c.etat.p], accroupi: false }];
          j.protegeJusqua = t + protectionMs;
          j.etatT = t;
          sorties.push({ a: id, m: { t: "atterri", p: [...c.etat.p] } });
        } else {
          recopier(j, c, t);
        }
      }
      return sorties;
    },

    aBord: (id: string): boolean => bord.has(id),
    enVol: (id: string): boolean => bord.has(id) || chutes.has(id),
    chute(id: string): "libre" | "voile" | undefined {
      const c = chutes.get(id);
      return c ? (c.etat.voile ? "voile" : "libre") : undefined;
    },
    avion: (): AvionBr | null => avion,
    atterris: (): number => atterris.size,

    retirer(id: string): void {
      bord.delete(id);
      chutes.delete(id);
    },

    reinitialiser(): void {
      avion = null;
      bord.clear();
      chutes.clear();
      atterris.clear();
      enAttente = [];
    },
  };
}

/** Vrai tant que le joueur est encore en l'air (avion ou chute) : marqueur de `creerVolBr`, lu par le butin. */
export const enLAir = (j: Pick<JoueurSalle, "protegeJusqua">): boolean => j.protegeJusqua === Infinity;
