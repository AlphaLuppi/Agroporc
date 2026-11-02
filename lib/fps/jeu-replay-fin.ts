/**
 * Lecteur du replay de fin de match d'arène (PUR, ni three ni DOM, sans horloge propre : `maj(dtS)` fait tout avancer). Possède l'enregistreur
 * (`replay-fin.ts`) que `jeu.ts` alimente pendant le match, puis, à l'entracte, attend la clôture des dernières fenêtres, choisit les moments
 * et les rejoue l'un après l'autre : joueurs et voitures interpolés dans les snaps gardés du clip, caméra cinématique, tirs / coups / dégâts
 * rejoués à leur instant. Les mêmes caches que la killcam (`joueursRejoues`, `vehiculesRejoues`, `tempsServeur`) alimentent le rendu existant.
 *
 * Phases : "" (match en cours ou rien à montrer), "attente" (fenêtres de fin encore ouvertes, ≤ `attenteMaxMs`), "lecture", "fini" (tout a
 * été vu : on peut revoir). Une seule touche (« passer ») : moment suivant pendant la lecture, revoir quand c'est fini.
 */
import type { EtatJoueurSnap, MessageServeur, VehiculeSnap, Vec3 } from "./protocole";
import { Interpolateur } from "./reseau";
import { InterpolateurVehicules } from "./interpolation-vehicules";
import {
  CameraCinemato, EnregistreurReplay, REPLAY_FIN, axeDuel, choisirMoments, MARGE_FIN_ENTRACTE_MS, tenirDansLeTemps, titreMoment, type Clip, type Lancer, type PoseCamera,
} from "./replay-fin";
import type { EvenementVue } from "./vue-joueur";

export type PhaseReplayFin = "" | "attente" | "lecture" | "fini";

/** État pour le HUD : uniquement des scalaires (comparaison champ par champ). */
export interface HudReplayFin {
  phase: PhaseReplayFin;
  /** 1..total pendant la lecture, sinon 0 */
  index: number;
  total: number;
  titre: string;
  detail: string;
  /** 0..1 dans le moment en cours (arrondi à 0,02) */
  progression: number;
}

export const HUD_REPLAY_VIDE: HudReplayFin = { phase: "", index: 0, total: 0, titre: "", detail: "", progression: 0 };

export interface OptionsReplayFin {
  /** id → pseudo, pour les titres */
  pseudo(id: string): string;
  /** premier obstacle d'un rayon (distance, ≥ `max` si rien) : ramène la caméra devant les murs ; sans : la caméra traverse */
  lancer?: Lancer;
  /** ms réels avant le match suivant (horloge serveur) ; absent ou null = inconnu. Les moments sont réduits pour tenir, le dernier kill gardé. */
  tempsRestantMs?(): number | null;
}

type Mort = Extract<MessageServeur, { t: "mort" }>;

export class ControleurReplayFin {
  readonly enreg = new EnregistreurReplay();
  private ph: PhaseReplayFin = "";
  private moments: Clip[] = [];
  private i = 0;
  private ecouleMs = 0;
  private attenteMs = 0;
  private cam = new CameraCinemato();
  private poseCourante: PoseCamera | null = null;
  private joueursInterp: Interpolateur | null = null;
  private vehiculesInterp: InterpolateurVehicules | null = null;
  private cacheJoueurs = new Map<string, EtatJoueurSnap>();
  private cacheVehicules = new Map<number, VehiculeSnap>();
  /** prochain événement du clip à jouer, et instant déjà rejoué */
  private idxEvt = 0;
  private titreCourant = { titre: "", detail: "" };

  constructor(private readonly opts: OptionsReplayFin) {}

  // ---------- enregistrement (pendant le match, et jusqu'à la clôture des dernières fenêtres) ----------

  private enregistre(): boolean {
    return this.ph === "" || this.ph === "attente";
  }

  alimenter(ts: number, joueurs: readonly EtatJoueurSnap[], vehicules?: readonly VehiculeSnap[]): void {
    if (this.enregistre()) this.enreg.alimenter(ts, joueurs, vehicules);
  }

  evenement(e: EvenementVue): void {
    if (this.enregistre()) this.enreg.evenement(e);
  }

  surMort(m: Mort): void {
    if (!this.enregistre()) return;
    this.enreg.surMort({ cible: m.cible, par: m.par, arme: m.arme, cause: m.cause, zone: m.zone, ts: m.ts, ...(m.tueur ? { distance: m.tueur.distance } : {}) });
  }

  // ---------- cycle d'un match ----------

  /** L'entracte commence : attend la clôture des dernières fenêtres puis choisit les moments (rien à montrer : reste muet, "" ). */
  finDeMatch(): void {
    if (this.ph !== "" || !this.enreg.aDuContenu()) return;
    this.ph = "attente";
    this.attenteMs = 0;
  }

  /** Nouveau match, nouvelle apparition ou fermeture : tout est oublié. */
  arreter(): void {
    this.enreg.vider();
    this.ph = "";
    this.moments = [];
    this.i = 0;
    this.ecouleMs = 0;
    this.joueursInterp = null;
    this.vehiculesInterp = null;
    this.poseCourante = null;
    this.cacheJoueurs = new Map();
    this.cacheVehicules = new Map();
  }

  // ---------- lecture ----------

  phase(): PhaseReplayFin {
    return this.ph;
  }

  /** Vrai pendant la lecture d'un moment : le rendu emprunte la scène rejouée. */
  actif(): boolean {
    return this.ph === "lecture";
  }

  /** Un replay existe (en attente, en lecture ou fini) : le HUD passe en disposition réduite avec le classement sur le côté. */
  disponible(): boolean {
    return this.ph !== "";
  }

  /** « Passer » : moment suivant (le dernier finit le replay) ; une fois fini, revoit depuis le début. Sans effet en attente. */
  suivant(): void {
    if (this.ph === "lecture") {
      if (this.i + 1 >= this.moments.length) this.finir();
      else this.charger(this.i + 1);
    } else if (this.ph === "fini" && this.moments.length) {
      this.ph = "lecture";
      this.charger(0);
    }
  }

  maj(dtS: number): void {
    const ms = Number.isFinite(dtS) && dtS > 0 ? dtS * 1000 : 0;
    if (this.ph === "attente") {
      this.attenteMs += ms;
      if (this.enreg.enAttente() === 0 || this.attenteMs >= REPLAY_FIN.attenteMaxMs) {
        this.enreg.terminer();
        const restant = this.opts.tempsRestantMs?.();
        this.moments = tenirDansLeTemps(choisirMoments(this.enreg.lesClips()), restant == null ? null : restant - MARGE_FIN_ENTRACTE_MS);
        if (!this.moments.length) { this.arreter(); return; }
        this.ph = "lecture";
        this.charger(0);
      }
      return;
    }
    if (this.ph !== "lecture") return;
    const c = this.moments[this.i];
    this.ecouleMs += ms;
    if (this.ecouleMs >= c.fin - c.debut) {
      if (this.i + 1 >= this.moments.length) { this.finir(); return; }
      this.charger(this.i + 1);
    }
    this.echantillonner(ms / 1000);
  }

  private finir(): void {
    this.ph = "fini";
    this.poseCourante = null;
    this.cacheJoueurs = new Map();
    this.cacheVehicules = new Map();
  }

  private charger(i: number): void {
    this.i = i;
    this.ecouleMs = 0;
    this.idxEvt = 0;
    const c = this.moments[i];
    const jo = new Interpolateur(60_000);
    const ve = new InterpolateurVehicules(60_000);
    for (const s of c.snaps) {
      jo.ajouter({ ts: s.ts, j: s.j as EtatJoueurSnap[] });
      if (s.v) ve.ajouter(s.ts, s.v);
    }
    this.joueursInterp = jo;
    this.vehiculesInterp = ve;
    this.titreCourant = titreMoment(c, this.opts.pseudo);
    const auKill = jo.echantillon(c.marque.ts);
    this.cam.commencer(c.marque.ts, axeDuel(auKill.get(c.marque.cible)?.p ?? null, auKill.get(c.marque.tueur)?.p ?? null));
    this.poseCourante = null;
    this.echantillonner(0);
  }

  /** Joueurs, voitures et caméra à l'instant du clip. */
  private echantillonner(dtS: number): void {
    const c = this.moments[this.i];
    if (!c || !this.joueursInterp || !this.vehiculesInterp) return;
    const t = c.debut + this.ecouleMs;
    this.cacheJoueurs = this.joueursInterp.echantillon(t);
    this.cacheVehicules = this.vehiculesInterp.echantillon(t);
    const pied = (id: string): Vec3 | null => {
      const e = this.cacheJoueurs.get(id);
      return e && !e.titan ? e.p : null;
    };
    this.poseCourante = this.cam.maj(dtS, this.ecouleMs / 1000, (c.marque.ts - c.debut) / 1000, pied(c.marque.cible), pied(c.marque.tueur), this.opts.lancer) ?? this.poseCourante;
  }

  // ---------- ce que le rendu lit ----------

  /** Pose de la caméra cinématique ; null hors lecture. */
  camera(): PoseCamera | null {
    return this.ph === "lecture" ? this.poseCourante : null;
  }

  /** Horodatage serveur rejoué (circulation des voitures PNJ, événements) ; null hors lecture. */
  tempsServeur(): number | null {
    const c = this.moments[this.i];
    return this.ph === "lecture" && c ? c.debut + this.ecouleMs : null;
  }

  /** Tous les joueurs du clip à l'instant rejoué (moi compris : on se voit jouer). Vide hors lecture. Ne pas modifier la Map. */
  joueurs(): Map<string, EtatJoueurSnap> {
    return this.ph === "lecture" ? this.cacheJoueurs : VIDE_JOUEURS;
  }

  vehicules(): Map<number, VehiculeSnap> {
    return this.ph === "lecture" ? this.cacheVehicules : VIDE_VEHICULES;
  }

  /** Le tueur et la victime du moment en cours (pseudos au-dessus d'eux) ; vides hors lecture. */
  acteurs(): { tueur: string; cible: string } {
    const c = this.ph === "lecture" ? this.moments[this.i] : null;
    return c ? { tueur: c.marque.tueur, cible: c.marque.cible } : { tueur: "", cible: "" };
  }

  /** Événements du clip arrivés depuis l'image précédente (tirs, coups, dégâts à leur instant), chacun une fois ; vide hors lecture. */
  evenementsAJouer(): EvenementVue[] {
    const c = this.moments[this.i];
    if (this.ph !== "lecture" || !c) return [];
    const t = c.debut + this.ecouleMs;
    const r: EvenementVue[] = [];
    while (this.idxEvt < c.evenements.length && c.evenements[this.idxEvt].ts <= t) r.push(c.evenements[this.idxEvt++]);
    return r;
  }

  hud(): HudReplayFin {
    if (this.ph === "") return HUD_REPLAY_VIDE;
    if (this.ph !== "lecture") return { ...HUD_REPLAY_VIDE, phase: this.ph, total: this.moments.length };
    const c = this.moments[this.i];
    const p = Math.min(1, Math.max(0, this.ecouleMs / Math.max(1, c.fin - c.debut)));
    return {
      phase: "lecture", index: this.i + 1, total: this.moments.length, titre: this.titreCourant.titre, detail: this.titreCourant.detail,
      progression: Math.round(p * 50) / 50,
    };
  }

  /** (essais) Moments retenus, dans l'ordre. */
  lesMoments(): readonly Clip[] {
    return this.moments;
  }
}

const VIDE_JOUEURS: Map<string, EtatJoueurSnap> = new Map();
const VIDE_VEHICULES: Map<number, VehiculeSnap> = new Map();

