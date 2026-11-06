/**
 * Rocket Muche : outils de SIMULATION sans rendu (tests, réglage des bots, scripts de mesure). Fait jouer un monde entier à des
 * cerveaux, y compris pour la voiture de l'« humain », et relève les événements et les anomalies. Pur : aucune horloge.
 * Non importé par le jeu.
 */
import { PAS_S } from "./contrat";
import type { ConfigMatch, EntreesVoiture, EvenementMatch, MondeRocket, NiveauBot, Vec3 } from "./contrat";
import { creerArene } from "./arene";
import { creerCerveau } from "./bots";
import type { Cerveau } from "./contrat";
import { creerMonde, pasMonde } from "./match";

export interface OptionsSimulation {
  /** niveau de la voiture de l'humain (ses entrées viennent d'un cerveau) */
  niveauHumain?: NiveauBot;
  /** durée maximale de la simulation en s de temps de jeu (décompte compris) */
  dureeS: number;
  /** s'arrête dès que la partie est finie */
  jusquALaFin?: boolean;
  /** voitures sans cerveau (entrées nulles), par id */
  sansCerveau?: readonly number[];
  /** appelé après chaque pas (mesures) */
  surPas?(m: MondeRocket, ev: readonly EvenementMatch[]): void;
}

export interface BilanSimulation {
  monde: MondeRocket;
  evenements: EvenementMatch[];
  /** type d'événement → nombre */
  compte: Record<string, number>;
  /** une valeur non finie est apparue dans l'état */
  nan: boolean;
  /** plus grande profondeur dans le décor d'une origine de voiture (m, positif = hors du stade) */
  horsStade: number;
  /** plus longue immobilité d'une voiture au sol hors décompte / démolition (s), par id */
  immobiliteMax: number[];
  /** plus longue durée continue (s) qu'une voiture a passée le toit vers le bas (haut.y < -0,3) hors démolition ni décompte */
  retourneMax: number;
  /** temps de jeu écoulé au premier contact avec la balle depuis le début du premier « enJeu » (s), null s'il n'y en a pas eu */
  premiereTouche: number | null;
}

const estFini = (...vs: number[]): boolean => vs.every((x) => Number.isFinite(x));

/** Simule une partie complète dont tous les joueurs sont des bots. `niveaux[equipe]` : niveau des bots de l'équipe. */
export function simuler(
  config: ConfigMatch, niveaux: { bleue: NiveauBot; orange: NiveauBot }, opts: OptionsSimulation, monde?: MondeRocket,
): BilanSimulation {
  const arene = monde?.arene ?? creerArene();
  const m = monde ?? creerMonde(config, arene);
  const cerveaux: (Cerveau | null)[] = m.voitures.map((v) =>
    opts.sansCerveau?.includes(v.id) ? null : creerCerveau(v.humain ? (opts.niveauHumain ?? niveaux[v.equipe]) : niveaux[v.equipe], config.graine * 1009 + v.id * 31 + 7));
  const entrees: EntreesVoiture[] = m.voitures.map(() => ({ accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false }));
  const evenements: EvenementMatch[] = [];
  const compte: Record<string, number> = {};
  const immobile = m.voitures.map(() => 0), immobiliteMax = m.voitures.map(() => 0), retourne = m.voitures.map(() => 0);
  let retourneMax = 0;
  let nan = false, horsStade = -Infinity, premiereTouche: number | null = null, tDebutJeu: number | null = null;
  const n = Math.ceil(opts.dureeS / PAS_S);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < m.voitures.length; k++) {
      const c = cerveaux[k];
      if (c) Object.assign(entrees[k], c.decider(m, m.voitures[k], PAS_S));
      else Object.assign(entrees[k], { accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false });
    }
    const ev = pasMonde(m, entrees, PAS_S);
    for (const e of ev) {
      evenements.push(e);
      compte[e.t] = (compte[e.t] ?? 0) + 1;
      if (e.t === "coupDEnvoi" && tDebutJeu === null) tDebutJeu = m.temps;
      if (e.t === "toucheBalle" && premiereTouche === null && tDebutJeu !== null) premiereTouche = m.temps - tDebutJeu;
    }
    opts.surPas?.(m, ev);
    for (const v of m.voitures) {
      if (!estFini(v.p[0], v.p[1], v.p[2], v.v[0], v.v[1], v.v[2], v.w[0], v.w[1], v.w[2], v.base.avant[0], v.base.haut[1])) nan = true;
      else if (!v.demolie) horsStade = Math.max(horsStade, -m.arene.sd(v.p as Vec3));
      const bouge = Math.hypot(v.v[0], v.v[1], v.v[2]) > 0.8;
      if (m.phase === "enJeu" && !v.demolie && !v.figee && !bouge && v.auSol) immobile[v.id] += PAS_S; else immobile[v.id] = 0;
      immobiliteMax[v.id] = Math.max(immobiliteMax[v.id], immobile[v.id]);
      if (!v.demolie && !v.figee && v.base.haut[1] < -0.3) retourne[v.id] += PAS_S; else retourne[v.id] = 0;
      retourneMax = Math.max(retourneMax, retourne[v.id]);
    }
    if (!estFini(m.balle.p[0], m.balle.p[1], m.balle.p[2], m.balle.v[0], m.balle.v[1], m.balle.v[2])) nan = true;
    if (opts.jusquALaFin && m.phase === "fini") break;
  }
  return { monde: m, evenements, compte, nan, horsStade, immobiliteMax, retourneMax, premiereTouche };
}
