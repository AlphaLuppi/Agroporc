/**
 * Service « descente de police » de la salle (PUR) : une voiture de police débarque de nulle part, fonce sur un joueur (arène : celui qui a le plus de
 * kills ; Battle Royale : l'ennemi humain le plus proche), l'écrase s'il est à pied (`ctx.tuer(…, "police")`, aucun kill crédité), se retire après
 * `POLICE.dureeMs` ou quand elle est détruite à coups de feu (700 PV, `tir.touches` sur `CIBLE_POLICE`, revalidés sur sa boîte orientée REJOUÉE sur son
 * historique : à 24 m/s elle parcourt 2,4 m en 100 ms). Physique des voitures conduisibles (dérapage compris), chemin A* sur la grille de dégagement du
 * Truck fou, marche arrière quand elle est bloquée : la poursuite est celle du Truck muche fou (`match-evenements.ts`), autrement réglée.
 * Le service ne décide ni QUAND ni QUI cibler : il reçoit des `ReglesPolice` (`police-regles.ts`, deux fabriques). Il appartient à `Salle`, construit EN
 * DERNIER (ses tirages de hasard ne décalent la séquence d'aucun autre service) ; il ne voit la salle que par `ContexteSalle`.
 * Aucune horloge, aucun minuteur, aucun `Math.random` : l'horloge virtuelle `maintenant` et `ctx.alea`.
 * Spec : docs/superpowers/specs/2026-10-30-arene-police-evenements-design.md (§4, §5)
 */
import type { Vec2 } from "../agroparc3d/types";
import { lancerRayon, visible } from "./collision";
import type { ContexteSalle, JoueurSalle, ServicePolice, Sortie } from "./match-contexte";
import { capVers } from "./monstres";
import { carteNavigation, chemin, pointDeVisee } from "./navigation";
import { POLICE, choisirDepart, ecraseParPolice, etatCarrosserie, pasPolice, toucheBoiteOrientee, type CandidatPolice } from "./police";
import { capablesEnJeu, type ReglesPolice } from "./police-regles";
import { CIBLE_POLICE, SILHOUETTE, type PoliceSnap, type Vec3 } from "./protocole";
import type { EtatVehicule } from "./vehicule";

type Intervalle = { minMs: number; maxMs: number };
/** Chemin d'une voiture : `null` = aucun chemin (cible « inaccessible »), `"attente"` = le budget de calcul du serveur a refusé, garder le chemin précédent. */
export type CheminPolice = (de: Vec2, vers: Vec2, t: number) => Vec2[] | null | "attente";

/** Ce que `Salle` reçoit dans `OptionsSalle.police` (les points et le chemin sont calculés une fois par `serveur-fps/src/index.ts`, avant `listen`). */
export interface OptionsPolice {
  /** départs possibles : les routes (arène : `pointsApparition`, BR : pool `route` de `pointsButin`) */
  points: readonly Vec2[];
  chemin: CheminPolice;
  /** arène : délai avant la première descente (après la création de la salle ou le passage à 2 joueurs en jeu) et entre deux descentes (`POLICE.premier` / `POLICE.entre`) */
  intervalle?: { premier?: Intervalle; entre?: Intervalle };
  /** probabilité qu'une descente finie soit suivie d'un temps mort (un `entre` de plus) ; absent ou 0 : aucun tirage de `alea` en plus */
  tempsMortP?: number;
  /** essais (`PDJ_FPS_POLICE_PV`, `PDJ_FPS_POLICE_DUREE_MS`) */
  pvMax?: number;
  dureeMs?: number;
}

export interface OptionsServicePolice extends OptionsPolice {
  mode: "arene" | "br";
  regles: ReglesPolice;
  /** horloge de la salle à la création (arène : arme le minuteur tout de suite ; BR : ignoré, `armer` s'en charge) */
  maintenant?: number;
  /** arène : un Truck fou, un tigre géant ou son annonce, un titan est en cours (`ServiceEvenements.occupe`) */
  autreEvenementEnCours?: () => boolean;
}

/** Plus grand pas de temps (s) de la simulation : un tic en retard ne téléporte pas la voiture. */
const DT_MAX_S = 0.05;
const arrondi = (x: number): number => Math.round(x * 100) / 100 + 0;
const cm = (p: Vec3): Vec3 => [arrondi(p[0]), arrondi(p[1]), arrondi(p[2])];
const mrad = (a: number): number => Math.round(a * 1000) / 1000 + 0;
/** Historique de la voiture gardé pour le rejeu de latence (ms) ; la fenêtre demandée par la salle est plus courte (300 ms en arène, 400 en BR). */
const HISTORIQUE_MS = 1_000;
/** Distance (m) du point d'apparition à laquelle la voiture en retrait disparaît. */
const DISPARITION_M = 8;
/** Essais de départ de l'arène avant d'abandonner et de réarmer à la moitié d'un `entre`. */
const ESSAIS_DEPART_ARENE = 3;
/** Yeux des joueurs testés pour savoir si un point de départ est vu : les plus proches du point (Battle Royale, 50 joueurs). */
const YEUX_MAX = 12;
const HAUTEUR_OEIL_M = 1.7;
/** Distance (m) sous laquelle la voiture vise sa cible directement quand la ligne est libre. */
const VISEE_DIRECTE_M = 30;

type Phase =
  /** `t` : prochain essai ; `echeanceT` : instant où le minuteur est échu (attente d'un premier kill en arène) ; `essais` : départs ratés d'affilée */
  | { k: "attente"; t: number; echeanceT: number; essais: number }
  | {
    k: "course"; debutT: number; finT: number; e: EtatVehicule; depart: Vec2; cible: string | null; cibleT: number; bloqueDepuis: number | null; reculJusqua: number;
    ch: Vec2[] | null; chT: number; pv: number; sansCandidatDepuis: number | null;
  }
  | { k: "retrait"; debutT: number; finT: number; e: EtatVehicule; depart: Vec2; pv: number };

export function creerServicePolice(ctx: ContexteSalle, opts: OptionsServicePolice): ServicePolice {
  const { regles } = opts;
  const arene = opts.mode === "arene";
  const premier = opts.intervalle?.premier ?? POLICE.premier;
  const entre = opts.intervalle?.entre ?? POLICE.entre;
  const pvMax = opts.pvMax ?? POLICE.pvMax;
  const dureeMs = opts.dureeMs ?? POLICE.dureeMs;
  const delai = (b: Intervalle) => b.minMs + (b.maxMs - b.minMs) * ctx.alea();
  const attente = (t: number): Phase => ({ k: "attente", t, echeanceT: t, essais: 0 });
  /** arène : le minuteur s'arme seul ; Battle Royale : jamais avant `armer` */
  const initiale = (maintenant: number): Phase => attente(arene ? maintenant + delai(premier) : Infinity);
  let phase: Phase | null = arene && opts.maintenant !== undefined ? initiale(opts.maintenant) : null;
  let dernierTicT: number | null = null;
  let descentes = 0;
  /** historique {t, p, cap} de la voiture, élagué au-delà de `HISTORIQUE_MS` */
  let histo: { t: number; p: Vec3; cap: number }[] = [];
  /** cible écartée jusqu'à cet instant (aucun chemin pour une voiture : intérieur d'un bâtiment creux, cour fermée…) */
  const inaccessible = new Map<string, number>();
  /** arène : état « au moins `joueursMin` joueurs capables en jeu » au tic précédent, et dernier instant où un autre événement était en cours */
  let assezDeJoueurs = false;
  let autreVuT = -Infinity;

  const vers = (m: Sortie["m"]): Sortie => ({ a: "joueurs", m });
  const enCours = (): boolean => phase !== null && phase.k !== "attente";

  // ---------- candidats, départ ----------

  /** Joueurs que la voiture peut viser : éligibles selon le mode, et pas écartés comme inaccessibles. */
  function candidats(t: number): CandidatPolice[] {
    const r: CandidatPolice[] = [];
    for (const j of ctx.joueursEnJeu()) {
      if (!regles.eligible(j, t)) continue;
      const jusque = inaccessible.get(j.id);
      if (jusque !== undefined) { if (t < jusque) continue; inaccessible.delete(j.id); }
      r.push({ id: j.id, p: j.p, kills: j.kills, humain: !j.bot });
    }
    return r;
  }

  /** Le point est-il vu d'au moins un joueur ? Les yeux testés sont les `YEUX_MAX` plus proches du point (la plupart des 50 joueurs du BR sont loin). */
  function vuDePersonne(vivants: readonly JoueurSalle[]): (x: number, z: number) => boolean {
    return (x, z) => {
      const point: Vec3 = [x, 1.2, z];
      const proches = vivants.length <= YEUX_MAX
        ? vivants
        : [...vivants].sort((a, b) => Math.hypot(a.p[0] - x, a.p[2] - z) - Math.hypot(b.p[0] - x, b.p[2] - z)).slice(0, YEUX_MAX);
      return proches.some((j) => visible(ctx.monde, [j.p[0], j.p[1] + HAUTEUR_OEIL_M, j.p[2]], point));
    };
  }

  /** Après une descente (fin, destruction, abandon) : arène, le prochain essai dans un `entre` (et un second en cas de temps mort) ; BR, plus jamais sans `armer`. */
  function apresDescente(t: number, base = entre): void {
    if (!arene) { phase = attente(Infinity); return; }
    const mort = opts.tempsMortP && ctx.alea() < opts.tempsMortP ? delai(base) : 0;
    phase = attente(t + delai(base) + mort);
  }

  function finMessage(ph: Extract<Phase, { k: "course" | "retrait" }>, t: number, raison: "temps" | "detruite", par?: string): Sortie {
    return vers({ t: "police", phase: "fin", debutT: ph.debutT, finT: t, raison, ...(par ? { par } : {}) });
  }

  function tenterDepart(ph: Extract<Phase, { k: "attente" }>, t: number): Sortie[] {
    // jamais pendant un autre événement, ni dans les 20 s qui suivent sa fin
    if (arene && (opts.autreEvenementEnCours?.() || t - autreVuT < POLICE.margeApresEvenementMs)) { ph.t = t + POLICE.reessaiMs; return []; }
    let cands = candidats(t);
    const bornes = ctx.monde.bornes;
    const centre: Vec3 = [(bornes.x0 + bornes.x1) / 2, 0, (bornes.z0 + bornes.z1) / 2];
    const vivants = ctx.joueursEnJeu().filter((j) => j.vivant);
    const points = regles.pointPermis ? opts.points.filter((p) => regles.pointPermis!(p[0], p[1], t)) : opts.points;
    // Battle Royale : une cible sans chemin depuis la route (joueur dans un bâtiment creux, cour fermée…) est écartée AVANT de lancer la course ; la descente
    // ne démarre, et ne consomme son quota, que si `permis` tient encore sans elle. Arène : aucun bâtiment creux, la poursuite révise seule.
    while (cands.length > 0 && regles.permis(t, { candidats: cands, echeanceT: ph.echeanceT })) {
      // cible provisoire (la plus proche du centre de la carte) : elle ne sert qu'à choisir le point de départ ; la cible retenue est ensuite choisie depuis ce point
      const provisoire = ctx.joueur(regles.choisirCible(cands, centre, null) ?? "");
      if (!provisoire) break;
      const depart = choisirDepart(points, vivants.map((j) => j.p), provisoire.p, vuDePersonne(vivants), ctx.alea);
      if (!depart) {
        if (arene && ++ph.essais >= ESSAIS_DEPART_ARENE) phase = attente(t + delai(entre) / 2);
        else ph.t = t + POLICE.reessaiMs;
        return [];
      }
      const cible = ctx.joueur(regles.choisirCible(cands, [depart[0], 0, depart[1]], null) ?? "") ?? provisoire;
      let ch: Vec2[] | null = null;
      if (!arene) {
        const r = opts.chemin(depart, [cible.p[0], cible.p[2]], t);
        if (r === "attente") { ph.t = t + POLICE.reessaiMs; return []; }
        if (r === null) {
          inaccessible.set(cible.id, t + POLICE.inaccessibleMs);
          cands = cands.filter((c) => c.id !== cible.id);
          continue;
        }
        ch = r;
      }
      const cap = capVers(depart[0], depart[1], cible.p[0], cible.p[2]);
      const e: EtatVehicule = { p: [depart[0], 0, depart[1]], cap, v: POLICE.vitesseDepart };
      phase = {
        k: "course", debutT: t, finT: t + dureeMs, e, depart, cible: cible.id, cibleT: t, bloqueDepuis: null, reculJusqua: -Infinity,
        ch, chT: ch ? t : -Infinity, pv: pvMax, sansCandidatDepuis: null,
      };
      histo = [{ t, p: e.p, cap }];
      descentes++;
      return [vers({ t: "police", phase: "debut", debutT: t, finT: phase.finT, cible: cible.id })];
    }
    ph.t = t + POLICE.reessaiMs;
    return [];
  }

  // ---------- simulation ----------

  /** Aucun bâtiment entre `de` et `a` (rayons au centre et aux flancs de la caisse). */
  function ligneLibre(de: Vec3, a: Vec3): boolean {
    const dx = a[0] - de[0], dz = a[2] - de[2];
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) return true;
    const ux = dx / l, uz = dz / l;
    for (const k of [0, -1, 1]) {
      const o: Vec3 = [de[0] - uz * (POLICE.largeur / 2) * k, 1, de[2] + ux * (POLICE.largeur / 2) * k];
      if (lancerRayon(ctx.monde, o, [ux, 0, uz], l) !== Infinity) return false;
    }
    return true;
  }

  function noterPose(e: EtatVehicule, t: number): void {
    histo.push({ t, p: e.p, cap: e.cap });
    while (histo.length > 1 && t - histo[0].t > HISTORIQUE_MS) histo.shift();
  }

  /** La voiture finit sa poursuite : elle roule vers son point d'apparition, sans rien écraser. */
  function passerRetrait(ph: Extract<Phase, { k: "course" }>, t: number): Sortie[] {
    phase = { k: "retrait", debutT: ph.debutT, finT: t + POLICE.departMs, e: ph.e, depart: ph.depart, pv: ph.pv };
    return [];
  }

  function ticCourse(ph: Extract<Phase, { k: "course" }>, dt: number, t: number): Sortie[] {
    if (t >= ph.finT) return passerRetrait(ph, t);
    const cands = candidats(t);
    // plus aucun candidat joignable depuis `sansCibleMs` : la voiture rentre
    if (cands.length === 0) {
      ph.sansCandidatDepuis ??= t;
      if (t - ph.sansCandidatDepuis >= POLICE.sansCibleMs) return passerRetrait(ph, t);
    } else ph.sansCandidatDepuis = null;
    // cible : révisée toutes les `changementCibleMs`, ou tout de suite si elle n'est plus candidate
    const actuelle = ph.cible ? cands.find((c) => c.id === ph.cible) : undefined;
    if (!actuelle || t - ph.cibleT >= POLICE.changementCibleMs) {
      const nouvelle = regles.choisirCible(cands, ph.e.p, actuelle ? actuelle.id : null);
      if (nouvelle !== ph.cible) { ph.ch = null; ph.chT = -Infinity; }
      ph.cible = nouvelle;
      ph.cibleT = t;
    }
    const cible = ph.cible ? ctx.joueur(ph.cible) : undefined;
    // bloquée contre un mur : marche arrière braquée un instant
    if (Math.abs(ph.e.v) < 3 && t >= ph.reculJusqua) {
      ph.bloqueDepuis ??= t;
      if (t - ph.bloqueDepuis >= POLICE.bloqueMs) { ph.reculJusqua = t + POLICE.reculMs; ph.bloqueDepuis = null; }
    } else if (Math.abs(ph.e.v) >= 3) ph.bloqueDepuis = null;
    if (cible && t - ph.chT >= POLICE.cheminMs) {
      const r = opts.chemin([ph.e.p[0], ph.e.p[2]], [cible.p[0], cible.p[2]], t);
      if (r === "attente") { /* le budget du serveur a refusé : on garde le chemin précédent et on redemande au tic suivant */ }
      else {
        ph.chT = t;
        ph.ch = r;
        // aucun chemin : la cible est écartée (elle est dans un bâtiment creux, une cour fermée…), la suivante est choisie au tic suivant
        if (r === null) { inaccessible.set(cible.id, t + POLICE.inaccessibleMs); ph.cibleT = -Infinity; }
      }
    }
    // sous `VISEE_DIRECTE_M` d'une cible en ligne libre, la voiture la vise elle-même : `pointDeVisee` ignore les points à moins de 4 m, donc à l'approche
    // finale elle braquerait vers un point plus ancien du chemin et tournerait autour de sa cible sans l'atteindre
    const vise = !cible ? null
      : Math.hypot(cible.p[0] - ph.e.p[0], cible.p[2] - ph.e.p[2]) <= VISEE_DIRECTE_M && ligneLibre(ph.e.p, cible.p) ? cible.p
        : ph.ch ? pointDeVisee(ctx.monde, ph.e.p, [...ph.ch, [cible.p[0], cible.p[2]]], POLICE.largeur / 2) ?? cible.p : cible.p;
    ph.e = pasPolice(ph.e, vise, t < ph.reculJusqua, dt, ctx.monde);
    noterPose(ph.e, t);
    return ecraser(ph.e, t);
  }

  /** Écrase tout joueur à pied sous la caisse (mort `police`, aucun kill) ; la protection d'apparition est vérifiée ici (`tuer` l'ignore). */
  function ecraser(e: EtatVehicule, t: number): Sortie[] {
    const sorties: Sortie[] = [];
    for (const j of ctx.joueursEnJeu()) {
      if (regles.ecrasable(j, t) && ecraseParPolice(e, j.p, SILHOUETTE.rayon)) sorties.push(...ctx.tuer(j, null, "police", t));
    }
    return sorties;
  }

  function ticRetrait(ph: Extract<Phase, { k: "retrait" }>, dt: number, t: number): Sortie[] {
    ph.e = pasPolice(ph.e, [ph.depart[0], 0, ph.depart[1]], false, dt, ctx.monde);
    noterPose(ph.e, t);
    const fini = Math.hypot(ph.e.p[0] - ph.depart[0], ph.e.p[2] - ph.depart[1]) < DISPARITION_M || t >= ph.finT;
    if (!fini) return [];
    const sorties = [finMessage(ph, t, "temps")];
    apresDescente(t);
    return sorties;
  }

  // ---------- suivis d'un tic à l'autre ----------

  /** Arène : passage de moins de 2 à 2 joueurs capables ⇒ le minuteur repart d'un `premier` (une salle restée vide des heures n'a pas un minuteur échu). */
  function suivreJoueurs(t: number): void {
    const assez = capablesEnJeu(ctx) >= POLICE.joueursMin;
    if (assez && !assezDeJoueurs && phase?.k === "attente") {
      const tt = Math.max(phase.t, t + delai(premier));
      phase.t = tt;
      phase.echeanceT = Math.max(phase.echeanceT, tt);
    }
    assezDeJoueurs = assez;
  }

  return {
    tic(t) {
      const dt = dernierTicT === null ? 0 : Math.min(DT_MAX_S, Math.max(0, (t - dernierTicT) / 1000));
      dernierTicT = t;
      phase ??= initiale(t);
      if (arene) {
        suivreJoueurs(t);
        if (opts.autreEvenementEnCours?.()) autreVuT = t;
      }
      // ni descente ni écrasement pendant l'entracte et le podium
      if (!ctx.enPhaseJeu()) return [];
      const ph = phase;
      if (ph.k === "attente") return t >= ph.t ? tenterDepart(ph, t) : [];
      if (ph.k === "course") return ticCourse(ph, dt, t);
      return ticRetrait(ph, dt, t);
    },

    snap() {
      const ph = phase;
      if (!ph || ph.k === "attente") return undefined;
      const etat = etatCarrosserie(ph.pv, pvMax);
      const s: PoliceSnap = {
        p: cm(ph.e.p), cap: mrad(ph.e.cap), v: arrondi((ph.e.v < 0 ? -1 : 1) * Math.hypot(ph.e.v, ph.e.vl ?? 0)), pv: Math.max(0, Math.round(ph.pv)), pvMax,
        ...(ph.k === "course" && ph.cible ? { cible: ph.cible } : {}), ...(etat ? { etat } : {}), ...(ph.k === "retrait" ? { depart: true } : {}),
      };
      return s;
    },

    synchro(idDest) {
      const ph = phase;
      if (!ph || ph.k === "attente") return [];
      const fin = ph.k === "course" ? ph.finT : ph.debutT + dureeMs;
      return [{ a: idDest, m: { t: "police", phase: "etat", debutT: ph.debutT, finT: fin, ...(ph.k === "course" && ph.cible ? { cible: ph.cible } : {}) } }];
    },

    armer(t) {
      if (phase && phase.k !== "attente") return;
      phase = attente(t ?? Infinity);
    },

    reinitialiser(t, rearmer) {
      const sorties: Sortie[] = [];
      const ph = phase;
      histo = [];
      inaccessible.clear();
      if (ph && ph.k !== "attente") sorties.push(finMessage(ph, t, "temps"));
      if (!arene) {
        phase = attente(Infinity);
        descentes = 0;
        return sorties;
      }
      if (!phase) phase = initiale(t);
      else if (ph && ph.k !== "attente") apresDescente(t);
      // nouveau match : aucune descente dans sa première minute (les kills repartent à 0)
      if (rearmer && phase.k === "attente") {
        phase.t = Math.max(phase.t, t + POLICE.premierMatchMs);
        phase.echeanceT = Math.max(phase.echeanceT, phase.t);
      }
      return sorties;
    },

    enCours,
    descentes: () => descentes,

    toucher(o, d, portee, t, fenetreMs) {
      const ph = phase;
      if (!ph || ph.k === "attente") return null;
      // la position courante puis l'historique sur la fenêtre de latence : une touche est valable si la boîte d'UNE de ces positions est touchée
      const distances: number[] = [];
      const poses = [{ p: ph.e.p, cap: ph.e.cap }, ...histo.filter((h) => t - h.t <= fenetreMs)];
      for (const pose of poses) {
        const dist = toucheBoiteOrientee(o, d, portee, pose.p, pose.cap, POLICE.marges.toucheM);
        if (dist !== null) distances.push(dist);
      }
      if (distances.length === 0) return null;
      const distance = Math.min(...distances);
      // la voiture doit être la première chose touchée : aucun mur plus proche
      return lancerRayon(ctx.monde, o, d, portee) < distance - 0.3 ? null : distance;
    },

    blesser(tireur, degats, t) {
      const ph = phase;
      if (!ph || ph.k === "attente" || !ctx.enPhaseJeu()) return [];
      const dg = Math.max(0, Math.round(degats));
      if (dg <= 0) return [];
      // seuls les PV réellement ôtés comptent (le surplus d'un coup de grâce n'enrichit pas le tableau des scores)
      const subi = Math.min(dg, ph.pv);
      ph.pv -= subi;
      tireur.degats += subi;
      const sorties: Sortie[] = [{ a: tireur.id, m: { t: "degats", cible: CIBLE_POLICE, par: tireur.id, degats: subi, pv: ph.pv, bouclier: 0, zone: "corps" } }];
      if (ph.pv > 0) return sorties;
      // détruite : explosion sans dégât de souffle, aucun kill, aucun point (pas d'exploit de score)
      sorties.push(vers({ t: "explosionMonstre", p: cm([ph.e.p[0], 1, ph.e.p[2]]), rayon: 5 }));
      sorties.push(finMessage(ph, t, "detruite", tireur.id));
      apresDescente(t);
      return sorties;
    },

    liberer(id) {
      inaccessible.delete(id);
      const ph = phase;
      if (ph?.k === "course" && ph.cible === id) ph.cibleT = -Infinity;
    },
  };
}

/**
 * Chemin d'une voiture sur la grille de dégagement du Truck fou (1,8 m) de `monde`, borné à `POLICE.noeudsMax` nœuds : le calcul passe par `demander(t)`
 * (le budget de recherches du serveur, un A* par 12 ms toutes parties confondues, clé propre à la salle) qui répond faux ⇒ `"attente"`. Sans budget
 * (tests) : toujours.
 */
export function cheminPourPolice(monde: ContexteSalle["monde"], demander?: (t: number) => boolean): CheminPolice {
  return (de, versP, t) => {
    if (demander && !demander(t)) return "attente";
    return chemin(carteNavigation(monde, 1.8), de, versP, POLICE.noeudsMax);
  };
}
