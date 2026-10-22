/**
 * Logique serveur de l'arène FPS (PUR : aucune I/O, ni three ni DOM ; l'horloge `maintenant` est
 * passée à chaque appel et le hasard est injecté par `alea`). Une `Salle` gère les connectés
 * (spectateurs de la vue Palantir et joueurs en jeu), les pseudos, les couleurs, les états reçus
 * (bornage de vitesse), les tirs (cadence, plombs, portée, ligne de vue, dégâts), les morts, les
 * réapparitions, la protection d'apparition et le cycle des matchs (jeu → entracte → jeu). Chaque
 * méthode renvoie les messages à émettre : le serveur Node (`serveur-fps/`) ne fait que les router.
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md
 */
import { STATS, degatsPlomb } from "./armes";
import type { Monde } from "./collision";
import {
  ARMES, JEU, SILHOUETTE,
  type ArmeId, type CoteMur, type EtatJoueurSnap, type InfoMatch, type JoueurPublic, type LigneClassement,
  type MessageClient, type MessageServeur, type Posture, type Vec3, type Zone,
} from "./protocole";
import { toucheVraisemblable } from "./tir";
import type { Vec2 } from "../agroparc3d/types";

/** Un message à émettre : à tout le monde, à tous sauf `sauf`, ou à un seul joueur (son id). */
export type Sortie = { a: "tous" | string; sauf?: string; m: MessageServeur };

/** 16 couleurs vives lisibles sur fond noir, attribuées dans l'ordre à la connexion. */
export const PALETTE: readonly string[] = [
  "#ff5252", "#ff8f2e", "#ffd93d", "#b8f13a", "#38e06b", "#22e3b4", "#2fd4ff", "#4a90ff",
  "#8a6bff", "#c561ff", "#ff55d4", "#ff7aa2", "#ffb3a0", "#e6ff8a", "#8ffff0", "#d9d9ff",
];

export const PSEUDO_MIN = 2;
export const PSEUDO_MAX = 16;
export const PSEUDO_DEFAUT = "Agent";
/** Vitesse horizontale maximale d'un joueur (m/s) ; au-delà d'`allure × dt + 1 m` l'état est refusé. */
export const VITESSE_MAX_H_M_S = 14;
/** Vitesse verticale maximale (m/s) : une chute depuis un toit dépasse la vitesse horizontale. */
export const VITESSE_MAX_V_M_S = 45;
/** Plus grand écart de temps (s) crédité à un état : borne la distance acceptée après un silence. */
export const DT_MAX_S = 5;
/** Les pieds peuvent dépasser les bornes de l'arène de cette marge (m). */
export const MARGE_HORS_BORNES_M = 0.5;
/** Cadence tolérée : fraction de la cadence nominale de l'arme. */
export const TOLERANCE_CADENCE = 0.85;
/** Crédit de rafale : un tir peut arriver jusqu'à cette fraction d'intervalle plus tôt (gigue réseau). */
export const CREDIT_RAFALE = 0.5;
/**
 * Idem pour une arme automatique, en intervalles : une coupure réseau de 150 à 200 ms livre d'un coup
 * 2 à 3 tirs de la rafale (à 13 tirs/s), qui ne doivent pas être perdus. Au plus 3 tirs d'avance, une fois.
 */
export const CREDIT_RAFALE_AUTO = 3;
/** Écart toléré entre l'œil déclaré par le client et la position connue du serveur (m + 0,15 s de vitesse). */
export const ECART_OEIL_M = 1.5;
/** Cosinus minimal entre la direction d'un plomb et la direction de visée connue (≈ 70°). */
export const COS_VISEE_MIN = 0.35;
/** Nombre de points d'apparition candidats (les plus éloignés des vivants). */
export const APPARITIONS_CANDIDATES = 6;
/** Historique des positions gardé par joueur pour la compensation de latence (ms). */
export const HISTORIQUE_MS = 400;
/**
 * Jusqu'où un tir peut « remonter le temps » (ms) : le tireur voit les autres avec `interpolationMs`
 * de retard, plus la latence du snap et celle de son tir (≈ 100 à 150 ms de ping → ≈ 250 ms).
 */
export const REWIND_MAX_MS = 300;
/** Deux positions historiques à moins de cette distance (m) ne sont testées qu'une fois. */
export const REWIND_PAS_M = 0.5;
/** Vitesse déclarée plafonnée : elle élargit la hitbox (tir) et la tolérance d'œil (m/s). */
export const VITESSE_DECLAREE_MAX_H_M_S = 20;
/** Un joueur vivant en arène sans état accepté depuis ce délai (ms) est retiré de l'arène (onglet gelé, zombie). */
export const INACTIF_MS = 20_000;
/** Suffixe de pseudo dédoublonné : "Nom2", "Nom3"… */
const SUFFIXE_MAX = 99;

/** État interne d'un connecté. */
export interface JoueurSalle {
  id: string;
  pseudo: string;
  couleur: string;
  enJeu: boolean;
  kills: number;
  morts: number;
  ping: number;
  p: Vec3;
  v: Vec3;
  lacet: number;
  tangage: number;
  posture: Posture;
  mur: CoteMur;
  arme: ArmeId;
  armeSuivante: ArmeId;
  pv: number;
  vivant: boolean;
  /** invulnérable jusqu'à cet horodatage (ms) */
  protegeJusqua: number;
  /** horodatage de la réapparition prévue, null si vivant ou hors arène */
  reapparitionT: number | null;
  /** dernier état accepté */
  seq: number;
  etatT: number;
  /** positions acceptées des `HISTORIQUE_MS` dernières ms (compensation de latence des tirs) */
  histo: { t: number; p: Vec3 }[];
  /** horodatage avant lequel un nouveau tir est refusé */
  prochainTir: number;
}

const estNombre = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const estVec3 = (x: unknown): x is Vec3 => Array.isArray(x) && x.length === 3 && x.every(estNombre);
const estArme = (x: unknown): x is ArmeId => typeof x === "string" && (ARMES as readonly string[]).includes(x);
const estZone = (x: unknown): x is Zone => x === "tete" || x === "corps";

/**
 * Pseudo nettoyé : lettres, chiffres, espace, `_ - . '` ; espaces réduits ; 16 caractères au plus ;
 * "Agent" si moins de 2 caractères restent.
 */
export function nettoyerPseudo(brut: unknown): string {
  const texte = typeof brut === "string" ? brut.normalize("NFC") : "";
  const propre = texte.replace(/[^\p{L}\p{N} _.'-]/gu, "").replace(/\s+/g, " ").trim();
  const coupe = Array.from(propre).slice(0, PSEUDO_MAX).join("").trim();
  return Array.from(coupe).length >= PSEUDO_MIN ? coupe : PSEUDO_DEFAUT;
}

/** Pseudo unique (sans tenir compte de la casse) : suffixe 2, 3… en raccourcissant la base au besoin. */
export function pseudoUnique(base: string, pris: ReadonlySet<string>): string {
  const cle = (s: string) => s.toLocaleLowerCase("fr");
  if (!pris.has(cle(base))) return base;
  for (let n = 2; n <= SUFFIXE_MAX; n++) {
    const suffixe = String(n);
    const candidat = Array.from(base).slice(0, PSEUDO_MAX - suffixe.length).join("").trimEnd() + suffixe;
    if (!pris.has(cle(candidat))) return candidat;
  }
  return Array.from(base).slice(0, PSEUDO_MAX - 4).join("") + String(1000 + pris.size);
}

export class Salle {
  private readonly joueurs = new Map<string, JoueurSalle>();
  private numero = 1;
  private phase: "jeu" | "entracte" = "jeu";
  private fin: number | null;
  private prochain: number | null = null;
  private prochainSnap: number;

  constructor(
    private readonly monde: Monde,
    private readonly apparitions: Vec2[],
    private readonly alea: () => number,
    maintenant: number,
  ) {
    this.fin = maintenant + JEU.dureeMatchMs;
    this.prochainSnap = maintenant;
  }

  // ---------- lecture ----------

  infoMatch(): InfoMatch {
    return { numero: this.numero, fin: this.fin, objectif: JEU.objectifKills, phase: this.phase, prochain: this.prochain };
  }
  nombreJoueurs(): number { return this.joueurs.size; }
  nombreEnJeu(): number { let n = 0; for (const j of this.joueurs.values()) if (j.enJeu) n++; return n; }
  /** État interne d'un joueur (lecture seule : tests et supervision). */
  inspecter(id: string): Readonly<JoueurSalle> | undefined { return this.joueurs.get(id); }
  joueursPublics(): JoueurPublic[] {
    return [...this.joueurs.values()].map((j) => ({
      id: j.id, pseudo: j.pseudo, couleur: j.couleur, enJeu: j.enJeu, kills: j.kills, morts: j.morts, ping: j.ping,
    }));
  }
  classement(): LigneClassement[] {
    return [...this.joueurs.values()]
      .filter((j) => j.enJeu || j.kills > 0 || j.morts > 0)
      .sort((a, b) => b.kills - a.kills || a.morts - b.morts || a.pseudo.localeCompare(b.pseudo, "fr"))
      .map((j) => ({ id: j.id, pseudo: j.pseudo, couleur: j.couleur, kills: j.kills, morts: j.morts }));
  }
  /** Dernière mesure de latence (ms), mesurée par le serveur ; pas de diffusion immédiate. */
  majPing(id: string, ms: number): void {
    const j = this.joueurs.get(id);
    if (j && estNombre(ms) && ms >= 0) j.ping = Math.round(ms);
  }

  // ---------- connexion ----------

  connecter(id: string, pseudo: string, maintenant: number): Sortie[] {
    if (this.joueurs.has(id)) return [];
    if (this.joueurs.size >= JEU.joueursMax) {
      return [{ a: id, m: { t: "erreur", code: "plein", message: "L'arène est pleine (16 agents)." } }];
    }
    const pris = new Set([...this.joueurs.values()].map((j) => j.pseudo.toLocaleLowerCase("fr")));
    const couleursPrises = new Set([...this.joueurs.values()].map((j) => j.couleur));
    const couleur = PALETTE.find((c) => !couleursPrises.has(c)) ?? PALETTE[this.joueurs.size % PALETTE.length];
    const j: JoueurSalle = {
      id, pseudo: pseudoUnique(nettoyerPseudo(pseudo), pris), couleur, enJeu: false, kills: 0, morts: 0, ping: 0,
      p: [0, 0, 0], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0,
      arme: "pistolet", armeSuivante: "pistolet", pv: JEU.pvMax, vivant: false,
      protegeJusqua: 0, reapparitionT: null, seq: -1, etatT: maintenant, histo: [], prochainTir: -Infinity,
    };
    this.joueurs.set(id, j);
    return [
      { a: id, m: { t: "bienvenue", id, couleur, joueurs: this.joueursPublics(), match: this.infoMatch(), maintenant } },
      { a: "tous", sauf: id, m: { t: "presence", joueurs: this.joueursPublics() } },
    ];
  }

  deconnecter(id: string, _maintenant: number): Sortie[] {
    if (!this.joueurs.delete(id)) return [];
    return [this.presence()];
  }

  // ---------- messages des clients ----------

  recevoir(id: string, msg: MessageClient, maintenant: number): Sortie[] {
    const j = this.joueurs.get(id);
    if (!j || !msg || typeof msg !== "object") return [];
    switch (msg.t) {
      case "rejoindre": return this.rejoindre(j, msg.arme, maintenant);
      case "quitter": return this.quitter(j);
      case "arme": return this.changerArme(j, msg.arme);
      case "etat": this.recevoirEtat(j, msg, maintenant); return [];
      case "tir": return this.recevoirTir(j, msg, maintenant);
      case "ping": return estNombre(msg.t0) ? [{ a: id, m: { t: "pong", t0: msg.t0, maintenant } }] : [];
      default: return []; // "bonjour" : déjà traité par connecter
    }
  }

  private rejoindre(j: JoueurSalle, arme: unknown, maintenant: number): Sortie[] {
    const choisie = estArme(arme) ? arme : j.armeSuivante;
    j.armeSuivante = choisie;
    if (j.enJeu) return [];
    j.enJeu = true;
    return [this.placer(j, maintenant), this.presence()];
  }

  private quitter(j: JoueurSalle): Sortie[] {
    if (!j.enJeu) return [];
    j.enJeu = false;
    j.vivant = false;
    j.reapparitionT = null;
    j.histo = [];
    return [this.presence()];
  }

  private changerArme(j: JoueurSalle, arme: unknown): Sortie[] {
    if (!estArme(arme)) return [];
    j.armeSuivante = arme;
    // mort : la prochaine apparition est celle qui arrive, l'arme est donc déjà la bonne
    if (j.enJeu && !j.vivant) j.arme = arme;
    return [];
  }

  /** État prédit par le client : accepté s'il reste dans les bornes et dans la vitesse permise. */
  private recevoirEtat(j: JoueurSalle, e: Extract<MessageClient, { t: "etat" }>, maintenant: number): void {
    if (!j.enJeu || !j.vivant) return;
    if (!estNombre(e.seq) || e.seq <= j.seq) return;
    if (!estVec3(e.p) || !estVec3(e.v) || !estNombre(e.lacet) || !estNombre(e.tangage)) return;
    const b = this.monde.bornes;
    if (e.p[0] < b.x0 - MARGE_HORS_BORNES_M || e.p[0] > b.x1 + MARGE_HORS_BORNES_M) return;
    if (e.p[2] < b.z0 - MARGE_HORS_BORNES_M || e.p[2] > b.z1 + MARGE_HORS_BORNES_M) return;
    if (e.p[1] < -10 || e.p[1] > 400) return;
    // La référence (position, temps) ne bouge qu'à l'acceptation : après un refus, le temps écoulé
    // grandit et l'écart permis avec lui, comme pour un joueur réellement parti plus loin.
    const dt = Math.min(DT_MAX_S, Math.max(0, (maintenant - j.etatT) / 1000));
    const dh = Math.hypot(e.p[0] - j.p[0], e.p[2] - j.p[2]);
    if (dh > VITESSE_MAX_H_M_S * dt + 1) return;
    if (Math.abs(e.p[1] - j.p[1]) > VITESSE_MAX_V_M_S * dt + 1.5) return;
    j.seq = e.seq;
    j.etatT = maintenant;
    j.p = [e.p[0], e.p[1], e.p[2]];
    // vitesse bornée comme la position : un `v` gonflé agrandirait sa propre hitbox et sa tolérance d'œil
    const vh = Math.hypot(e.v[0], e.v[2]);
    const k = vh > VITESSE_DECLAREE_MAX_H_M_S ? VITESSE_DECLAREE_MAX_H_M_S / vh : 1;
    j.v = [e.v[0] * k, Math.max(-VITESSE_MAX_V_M_S, Math.min(VITESSE_MAX_V_M_S, e.v[1])), e.v[2] * k];
    j.lacet = e.lacet;
    j.tangage = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, e.tangage));
    j.posture = e.posture === "sol" || e.posture === "mur" ? e.posture : "air";
    j.mur = e.mur === -1 || e.mur === 1 ? e.mur : 0;
    j.histo.push({ t: maintenant, p: [e.p[0], e.p[1], e.p[2]] });
    while (j.histo.length > 1 && maintenant - j.histo[0].t > HISTORIQUE_MS) j.histo.shift();
  }

  /**
   * Positions candidates d'une cible pour valider une touche : la position courante puis, en
   * remontant jusqu'à `REWIND_MAX_MS`, celles qu'elle occupait quand le tireur l'a vue (il la voit
   * avec ~200 ms de retard : sans cela, une cible qui s'arrête ou change de direction échappe à
   * des tirs pourtant justes). Les positions voisines (< `REWIND_PAS_M`) ne sont gardées qu'une fois.
   */
  private positionsCible(c: JoueurSalle, maintenant: number): Vec3[] {
    const r: Vec3[] = [c.p];
    for (let i = c.histo.length - 1; i >= 0; i--) {
      const h = c.histo[i];
      if (maintenant - h.t > REWIND_MAX_MS) break;
      const d = r[r.length - 1];
      if (Math.hypot(h.p[0] - d[0], h.p[1] - d[1], h.p[2] - d[2]) >= REWIND_PAS_M) r.push(h.p);
    }
    return r;
  }

  /** Un tir : validé (cadence, plombs, portée, angle, ligne de vue) puis dégâts calculés ici. */
  private recevoirTir(j: JoueurSalle, tir: Extract<MessageClient, { t: "tir" }>, maintenant: number): Sortie[] {
    if (!j.enJeu || !j.vivant || this.phase !== "jeu") return [];
    if (tir.arme !== j.arme) return [];
    const arme = STATS[j.arme];
    if (!estVec3(tir.o) || !Array.isArray(tir.d) || tir.d.length < 1 || tir.d.length > arme.plombs) return [];
    if (!tir.d.every(estVec3)) return [];

    // l'œil déclaré reste près de la position connue du serveur
    const oeil: Vec3 = [j.p[0], j.p[1] + SILHOUETTE.oeil, j.p[2]];
    const ecart = Math.hypot(tir.o[0] - oeil[0], tir.o[1] - oeil[1], tir.o[2] - oeil[2]);
    if (ecart > ECART_OEIL_M + 0.15 * Math.hypot(j.v[0], j.v[1], j.v[2])) return [];

    // directions normalisées, orientées dans le sens de la visée connue
    const cosLacet = Math.cos(j.tangage);
    const visee: Vec3 = [-Math.sin(j.lacet) * cosLacet, Math.sin(j.tangage), -Math.cos(j.lacet) * cosLacet];
    const dirs: Vec3[] = [];
    for (const d of tir.d) {
      const l = Math.hypot(d[0], d[1], d[2]);
      if (l < 0.95 || l > 1.05) return [];
      const n: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
      if (n[0] * visee[0] + n[1] * visee[1] + n[2] * visee[2] < COS_VISEE_MIN) return [];
      dirs.push(n);
    }

    // cadence (85 % du nominal, un demi-intervalle de crédit pour la gigue réseau)
    const intervalle = arme.cadenceS * 1000 * TOLERANCE_CADENCE;
    if (maintenant < j.prochainTir) return [];
    const credit = (arme.auto ? CREDIT_RAFALE_AUTO : CREDIT_RAFALE) * intervalle;
    j.prochainTir = Math.max(j.prochainTir, maintenant - credit) + intervalle;
    j.protegeJusqua = 0; // tirer annule la protection d'apparition

    const sorties: Sortie[] = [{ a: "tous", sauf: j.id, m: { t: "tir", id: j.id, arme: j.arme, o: tir.o, d: dirs } }];
    const touches = Array.isArray(tir.touches) ? tir.touches : [];
    const plombsVus = new Set<number>();
    const cumul = new Map<string, { degats: number; zone: Zone }>();
    for (const t of touches) {
      if (!t || typeof t.cible !== "string" || !estZone(t.zone) || !Number.isInteger(t.plomb)) continue;
      if (t.plomb < 0 || t.plomb >= dirs.length || plombsVus.has(t.plomb)) continue;
      const c = this.joueurs.get(t.cible);
      if (!c || c.id === j.id || !c.enJeu || !c.vivant || maintenant < c.protegeJusqua) continue;
      const vitesseCible = Math.hypot(c.v[0], c.v[1], c.v[2]);
      const vue = this.positionsCible(c, maintenant).find((p) =>
        toucheVraisemblable(this.monde, tir.o, dirs[t.plomb], arme.portee, { id: c.id, p, vivant: true }, vitesseCible));
      if (!vue) continue;
      plombsVus.add(t.plomb);
      const distance = Math.hypot(vue[0] - tir.o[0], vue[1] + SILHOUETTE.hauteur / 2 - tir.o[1], vue[2] - tir.o[2]);
      const degats = degatsPlomb(j.arme, t.zone, distance);
      const cu = cumul.get(c.id);
      if (cu) { cu.degats += degats; if (t.zone === "tete") cu.zone = "tete"; }
      else cumul.set(c.id, { degats, zone: t.zone });
    }

    let score = false;
    for (const [cibleId, { degats, zone }] of cumul) {
      const c = this.joueurs.get(cibleId)!;
      c.pv = Math.max(0, c.pv - degats);
      sorties.push({ a: "tous", m: { t: "degats", cible: c.id, par: j.id, degats, pv: c.pv, zone } });
      if (c.pv > 0) continue;
      c.vivant = false;
      c.posture = "mort";
      c.mur = 0;
      c.morts++;
      j.kills++;
      score = true;
      c.reapparitionT = maintenant + JEU.delaiReapparitionMs;
      sorties.push({ a: "tous", m: { t: "mort", cible: c.id, par: j.id, arme: j.arme, zone, delai: JEU.delaiReapparitionMs } });
    }
    if (score) {
      sorties.push(this.presence());
      if (j.kills >= JEU.objectifKills) sorties.push(...this.terminer(maintenant));
    }
    return sorties;
  }

  // ---------- temps ----------

  tic(maintenant: number): Sortie[] {
    const sorties: Sortie[] = [];
    if (this.phase === "entracte" && this.prochain !== null && maintenant >= this.prochain) {
      sorties.push(...this.demarrerMatch(maintenant));
    } else if (this.phase === "jeu" && this.fin !== null && maintenant >= this.fin) {
      sorties.push(...this.terminer(maintenant));
    }
    let evince = false;
    for (const j of this.joueurs.values()) {
      if (j.enJeu && !j.vivant && j.reapparitionT !== null && maintenant >= j.reapparitionT) {
        sorties.push(this.placer(j, maintenant));
      } else if (j.enJeu && j.vivant && maintenant - j.etatT > INACTIF_MS) {
        // plus aucun état accepté : onglet gelé ou connexion zombie. Sinon il resterait en cible immobile.
        this.quitter(j);
        evince = true;
      }
    }
    if (evince) sorties.push(this.presence());
    if (maintenant >= this.prochainSnap) {
      const periode = 1000 / JEU.snapHz;
      this.prochainSnap += periode;
      if (this.prochainSnap <= maintenant) this.prochainSnap = maintenant + periode;
      if (this.nombreEnJeu() > 0) sorties.push({ a: "tous", m: { t: "snap", ts: maintenant, j: this.snap(maintenant) } });
    }
    return sorties;
  }

  private snap(maintenant: number): EtatJoueurSnap[] {
    const r: EtatJoueurSnap[] = [];
    for (const j of this.joueurs.values()) {
      if (!j.enJeu) continue;
      r.push({
        id: j.id, p: j.p, v: j.v, lacet: j.lacet, tangage: j.tangage,
        posture: j.vivant ? j.posture : "mort", mur: j.mur, arme: j.arme, pv: j.pv, vivant: j.vivant,
        protege: j.vivant && maintenant < j.protegeJusqua,
      });
    }
    return r;
  }

  /** Fin du match (objectif atteint ou temps écoulé) : classement affiché pendant l'entracte. */
  private terminer(maintenant: number): Sortie[] {
    if (this.phase !== "jeu") return [];
    this.phase = "entracte";
    this.fin = null;
    this.prochain = maintenant + JEU.entracteMs;
    return [{ a: "tous", m: { t: "match", match: this.infoMatch(), classement: this.classement() } }];
  }

  /** Nouveau match : scores à 0, tout le monde en jeu réapparaît. */
  private demarrerMatch(maintenant: number): Sortie[] {
    this.numero++;
    this.phase = "jeu";
    this.fin = maintenant + JEU.dureeMatchMs;
    this.prochain = null;
    const sorties: Sortie[] = [];
    for (const j of this.joueurs.values()) {
      j.kills = 0;
      j.morts = 0;
      if (j.enJeu) { j.vivant = false; j.reapparitionT = null; }
    }
    sorties.push({ a: "tous", m: { t: "match", match: this.infoMatch(), classement: this.classement() } });
    for (const j of this.joueurs.values()) if (j.enJeu) sorties.push(this.placer(j, maintenant));
    sorties.push(this.presence());
    return sorties;
  }

  // ---------- apparition ----------

  /** Fait (ré)apparaître un joueur au point le plus éloigné des vivants (parmi les 6 meilleurs). */
  private placer(j: JoueurSalle, maintenant: number): Sortie {
    const [x, z] = this.choisirApparition(j.id);
    const b = this.monde.bornes;
    // regard vers le centre de l'arène (lacet 0 = −z)
    const lacet = Math.atan2(-((b.x0 + b.x1) / 2 - x), -((b.z0 + b.z1) / 2 - z));
    j.p = [x, 0, z];
    j.v = [0, 0, 0];
    j.lacet = lacet;
    j.tangage = 0;
    j.posture = "sol";
    j.mur = 0;
    j.arme = j.armeSuivante;
    j.pv = JEU.pvMax;
    j.vivant = true;
    j.protegeJusqua = maintenant + JEU.protectionMs;
    j.reapparitionT = null;
    j.etatT = maintenant;
    j.histo = [];
    j.prochainTir = -Infinity;
    return { a: "tous", m: { t: "apparition", id: j.id, p: j.p, lacet, arme: j.arme, pv: j.pv } };
  }

  private choisirApparition(id: string): Vec2 {
    const points = this.apparitions;
    if (!points.length) {
      const b = this.monde.bornes;
      return [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];
    }
    const vivants = [...this.joueurs.values()].filter((o) => o.id !== id && o.enJeu && o.vivant);
    if (!vivants.length) return points[Math.min(points.length - 1, Math.floor(this.alea() * points.length))];
    const notes = points.map((pt) => {
      let dmin = Infinity;
      for (const o of vivants) dmin = Math.min(dmin, (o.p[0] - pt[0]) ** 2 + (o.p[2] - pt[1]) ** 2);
      return { pt, dmin };
    });
    notes.sort((a, b) => b.dmin - a.dmin);
    const n = Math.min(APPARITIONS_CANDIDATES, notes.length);
    return notes[Math.min(n - 1, Math.floor(this.alea() * n))].pt;
  }

  private presence(): Sortie {
    return { a: "tous", m: { t: "presence", joueurs: this.joueursPublics() } };
  }
}
